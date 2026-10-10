// Prediction-market data. Live from the first venue that answers, in order:
// Kalshi, Kalshi via IBKR, ForecastEx, Limitless, Futuur (all public, no key); otherwise a dated sample
// snapshot, always labeled. compareVenues() asks every venue separately, so the
// same release can be read side by side across venues.
//
// Consensus and options-implied tail probabilities are reference inputs typed in
// by hand - there is no free live feed for either. They are the first thing to
// wire to a real vendor.

const https = require('https');
const limitless = require('./limitless');
const futuur = require('./futuur');
const forecastex = require('./forecastex');
const fedfutures = require('./fedfutures');
const archive = require('./archive');

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

const SPECS = [
  {
    id: 'cpi', name: 'Inflation (CPI, year over year)', short: 'inflation report', tailWords: { low: 'soft', high: 'hot' }, kind: 'continuous', unit: '%', dp: 2,
    series: ['KXCPIYOY', 'CPIYOY'],
    limitless: { query: 'inflation', re: /Inflation US - Annual/i },
    forecastex: { conid: 712856687, scale: 1 },            // US Consumer Price Index Yearly
    kernels: { spx: -0.525, rate2y: 4.2 },
    reference: { consensus: 3.0, trailSigma: 0.15, lowThreshold: 2.75, highThreshold: 3.35,
      optLow: 0.092, optHigh: 0.114, optUnderlying: 'SPY' },
    snapshot: {
      date: '2026-10-13',
      labels: ['under 2.5', '2.6-2.7', '2.8-2.9', '3.0-3.1', '3.2-3.3', 'over 3.4'],
      edges: [2.35, 2.55, 2.75, 2.95, 3.15, 3.35, 3.55],
      raw: [4.2, 11.3, 29.1, 34.0, 17.1, 7.7],
    },
  },
  {
    id: 'fomc', name: 'Fed rate decision', short: 'Fed decision', tailWords: { low: 'dovish', high: 'hawkish' }, kind: 'discrete', unit: '', dp: 1,
    series: ['KXFEDDECISION', 'FEDDECISION'],
    limitless: { query: 'fed', re: /Fed Decision in/i },
    futuur: { query: 'fed', re: /Fed interest rate decision/i },
    forecastex: { conid: 791099758 },                      // Fed Decision
    kernels: { rateFull: 25, spx: 0, rate2y: 0 },
    focusIndex: 1,
    reference: { ois: [0.020, 0.580, 0.395, 0.005] },
    snapshot: {
      date: '2026-10-28',
      labels: ['Cut 0.50+', 'Cut 0.25', 'Hold', 'Hike'],
      raw: [3.1, 62.4, 35.4, 0.7],
    },
  },
  {
    id: 'nfp', name: 'Jobs report (payrolls)', short: 'jobs report', tailWords: { low: 'weak', high: 'strong' }, kind: 'continuous', unit: 'k', dp: 0,
    series: ['KXPAYROLLS', 'PAYROLLS'],
    futuur: { query: 'payrolls', re: /nonfarm payrolls/i, scale: 0.001 },
    forecastex: { conid: 582530260, scale: 0.001 },        // US Payroll Employment
    kernels: { spx: 0.41, rate2y: 3.1 },
    reference: { consensus: 175, trailSigma: 71, lowThreshold: 74.5, highThreshold: 299.5,
      optLow: 0.185, optHigh: 0.102, optUnderlying: 'SPY' },
    snapshot: {
      date: '2026-11-06',
      labels: ['negative', '0-74', '75-149', '150-224', '225-299', '300+'],
      edges: [-75, 0, 74.5, 149.5, 224.5, 299.5, 375],
      raw: [6.5, 14.4, 27.9, 30.2, 14.8, 9.9],
    },
  },
];

const SNAPSHOT_AS_OF = '2026-10-09';

/* --------------------------------------------------------------- http */

function getJSON(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { Accept: 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('non-JSON response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* ----------------------------------------------------- kalshi parsing */

function price(m, side) {
  const dollars = m[`${side}_dollars`];
  if (dollars !== undefined && dollars !== null && dollars !== '') return Number(dollars);
  const cents = m[side];
  return typeof cents === 'number' ? cents / 100 : NaN;
}

function midOf(m) {
  const bid = price(m, 'yes_bid'), ask = price(m, 'yes_ask');
  // A zero bid under a live ask is a real (small) price, not a missing one.
  if (bid >= 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  const last = price(m, 'last_price');
  return last > 0 ? last : NaN;
}

// Pool-adjacent-violators: force a non-increasing sequence, the property a
// survival curve must have and a thin market does not always respect.
function isotonicDecreasing(ys) {
  const blocks = ys.map((y) => ({ sum: y, n: 1 }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].sum / blocks[i].n < blocks[i + 1].sum / blocks[i + 1].n) {
      blocks[i] = { sum: blocks[i].sum + blocks[i + 1].sum, n: blocks[i].n + blocks[i + 1].n };
      blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else i++;
  }
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n);
  return out;
}

function fmtEdge(x, dp) { return dp === 0 ? String(Math.round(x)) : x.toFixed(1); }

function continuousFromMarkets(markets, dp) {
  const usable = markets.filter((m) => Number.isFinite(midOf(m)));
  const between = usable.filter((m) => m.strike_type === 'between' && m.floor_strike != null && m.cap_strike != null);
  const greater = usable.filter((m) => m.strike_type === 'greater' && m.floor_strike != null);

  if (between.length >= 3) {
    between.sort((a, b) => a.floor_strike - b.floor_strike);
    const less = usable.find((m) => m.strike_type === 'less' && m.cap_strike != null);
    const above = usable.find((m) => m.strike_type === 'greater' && m.floor_strike != null);
    const cells = [];
    if (less) cells.push({ lo: null, hi: less.cap_strike, raw: midOf(less) });
    for (const m of between) cells.push({ lo: m.floor_strike, hi: m.cap_strike, raw: midOf(m) });
    if (above) cells.push({ lo: above.floor_strike, hi: null, raw: midOf(above) });
    const w = between[0].cap_strike - between[0].floor_strike || 1;
    const edges = [cells[0].lo ?? cells[0].hi - w];
    for (const c of cells) edges.push(c.hi ?? c.lo + w);
    const sum = cells.reduce((s, c) => s + c.raw, 0);
    return {
      edges, raw: cells.map((c) => Math.round(c.raw * 1000) / 10),
      p: cells.map((c) => c.raw / sum), overround: Math.round((sum - 1) * 1000) / 10,
      labels: cells.map((c) => c.lo == null ? `under ${fmtEdge(c.hi, dp)}` : c.hi == null
        ? `over ${fmtEdge(c.lo, dp)}` : `${fmtEdge(c.lo, dp)}-${fmtEdge(c.hi, dp)}`),
      method: 'brackets',
    };
  }

  if (greater.length >= 3) {
    greater.sort((a, b) => a.floor_strike - b.floor_strike);
    const ts = greater.map((m) => m.floor_strike);
    const rawS = greater.map(midOf);
    const S = isotonicDecreasing(rawS);
    const violations = rawS.filter((v, i) => Math.abs(v - S[i]) > 1e-9).length;
    const w = ts[1] - ts[0];
    const edges = [ts[0] - w, ...ts, ts[ts.length - 1] + w];
    const p = [1 - S[0]];
    for (let i = 0; i < S.length - 1; i++) p.push(Math.max(0, S[i] - S[i + 1]));
    p.push(S[S.length - 1]);
    const tot = p.reduce((a, b) => a + b, 0);
    return {
      edges, raw: rawS.map((v) => Math.round(v * 1000) / 10), p: p.map((x) => x / tot),
      overround: null, monotoneFixes: violations,
      labels: p.map((_, i) => i === 0 ? `under ${fmtEdge(ts[0], dp)}` : i === p.length - 1
        ? `over ${fmtEdge(ts[ts.length - 1], dp)}` : `${fmtEdge(ts[i - 1], dp)}-${fmtEdge(ts[i], dp)}`),
      method: 'thresholds',
    };
  }
  return null;
}

// Venues word these differently: "Fed cuts by more than 25bps" (Kalshi-style),
// "50+ bps decrease" (Limitless). Order matters: the bigger cut is tested first.
const FED_BUCKETS = [
  { label: 'Cut 0.50+', re: /cut.*(more than|over|greater than|>)\s*25|cut.*\b(50|75|100)\b|\b(50|75|100)\b.*cut|\b(50|75|100)\+?\s*bps?\s*decrease/i },
  { label: 'Cut 0.25', re: /cut.*25|25.*cut|\b25\s*bps?\s*decrease/i },
  { label: 'Hold', re: /hold|maintain|no change|unchanged/i },
  { label: 'Hike', re: /hike|raise|increase/i },
];

function discreteFromMarkets(markets) {
  const raw = FED_BUCKETS.map(() => 0);
  let hit = 0;
  for (const m of markets) {
    const mid = midOf(m);
    if (!Number.isFinite(mid)) continue;
    const text = `${m.title || ''} ${m.subtitle || ''} ${m.yes_sub_title || ''}`;
    const i = FED_BUCKETS.findIndex((b) => b.re.test(text));
    if (i >= 0) { raw[i] += mid; hit++; }
  }
  if (hit < 2) return null;
  const sum = raw.reduce((a, b) => a + b, 0);
  return { labels: FED_BUCKETS.map((b) => b.label), raw: raw.map((v) => Math.round(v * 1000) / 10),
    p: raw.map((v) => v / sum), overround: Math.round((sum - 1) * 1000) / 10, method: 'outcomes' };
}

async function liveEvent(spec) {
  const errors = [];
  for (const series of spec.series) {
    let j;
    try {
      j = await getJSON(`${KALSHI}/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=10`);
    } catch (e) { errors.push(`${series}: ${e.code || ''} ${e.message}`.trim()); continue; }
    const events = (j.events || []).filter((e) => (e.markets || []).length);
    if (!events.length) { errors.push(`${series}: no open events`); continue; }
    const closeOf = (e) => Math.min(...e.markets.map((m) => Date.parse(m.close_time || m.expiration_time) || Infinity));
    events.sort((a, b) => closeOf(a) - closeOf(b));
    const ev = events[0];
    const dist = spec.kind === 'discrete' ? discreteFromMarkets(ev.markets) : continuousFromMarkets(ev.markets, spec.dp);
    if (!dist) { errors.push(`${series}: ${ev.event_ticker} markets did not form a distribution`); continue; }
    const when = ev.markets.map((m) => m.expected_expiration_time || m.close_time).filter(Boolean).sort()[0];
    return {
      ...dist, source: 'kalshi', ticker: ev.event_ticker, title: ev.title,
      date: when ? when.slice(0, 10) : spec.snapshot.date, asOf: new Date().toISOString(),
    };
  }
  throw new Error(errors.join('; ') || 'no series configured');
}

function snapshotEvent(spec) {
  const s = spec.snapshot;
  const sum = s.raw.reduce((a, b) => a + b, 0);
  return {
    labels: s.labels, edges: s.edges, raw: s.raw, p: s.raw.map((v) => v / sum),
    overround: Math.round((sum - 100) * 10) / 10, source: 'sample', date: s.date,
    asOf: SNAPSHOT_AS_OF, method: spec.kind === 'discrete' ? 'outcomes' : 'brackets',
  };
}

/* ---------------------------------------------------------------- api */

let cache = { at: 0, data: null };
// An unreachable venue costs a timeout per series per run; remember it for a while.
let kalshiDownUntil = 0;

async function loadEvents({ maxAgeMs = 60000, forceSnapshot = false } = {}) {
  if (!forceSnapshot && cache.data && Date.now() - cache.at < maxAgeMs) return cache.data;
  const out = [];
  for (const spec of SPECS) {
    let dist = null;
    const errors = [];
    if (!forceSnapshot) {
      if (Date.now() > kalshiDownUntil) {
        try { dist = await liveEvent(spec); }
        catch (e) { errors.push('Kalshi: ' + e.message); if (/ECONNRESET|ENOTFOUND|ETIMEDOUT|timeout/i.test(e.message)) kalshiDownUntil = Date.now() + 10 * 60 * 1000; }
      } else errors.push('Kalshi: unreachable earlier, skipped for 10 minutes');
      // Interactive Brokers carries Kalshi's and ForecastEx's books on one public feed
      for (const ex of ['KALSHI', 'FORECASTX']) {
        if (dist || !spec.forecastex) break;
        try { dist = await forecastex.liveEvent(spec, { continuousFromMarkets, buckets: FED_BUCKETS }, ex); }
        catch (e) { errors.push(forecastex.VENUE[ex] + ': ' + e.message); }
      }
      if (!dist && spec.limitless) {
        try { dist = await limitless.liveEvent(spec, FED_BUCKETS); } catch (e) { errors.push('Limitless: ' + e.message); }
      }
      if (!dist && spec.futuur) {
        try { dist = await futuur.liveEvent(spec, { continuousFromMarkets, buckets: FED_BUCKETS }); } catch (e) { errors.push('Futuur: ' + e.message); }
      }
    }
    if (!dist) dist = snapshotEvent(spec);
    let reference = dist.source === 'sample' ? spec.reference : null;
    // Live Fed odds get a live reference: what fed funds futures imply for the same meeting.
    if (dist.source !== 'sample' && spec.id === 'fomc') {
      try {
        const f = await fedfutures.oddsForMeeting(dist.date);
        reference = { ois: f.probs, label: 'fed funds futures', source: f.source, contract: f.contract,
          deltaBp: f.deltaBp, rPre: f.rPre, rPost: f.rPost, asOf: f.asOf, method: f.method };
      } catch (e) { errors.push('Fed futures: ' + e.message); }
    }
    // The hand-entered consensus and options references were written for the
    // sample snapshot. Applied to live odds they invent an edge, so live events
    // carry none until a real reference feed is wired.
    out.push({
      id: spec.id, name: spec.name, short: spec.short, tailWords: spec.tailWords,
      kind: spec.kind, unit: spec.unit, dp: spec.dp,
      kernels: spec.kernels, focusIndex: spec.focusIndex,
      reference,
      ...dist, liveError: errors.length ? errors.join(' | ') : null,
    });
  }
  if (!forceSnapshot) {
    cache = { at: Date.now(), data: out };
    try { archive.record(out); } catch (e) { console.warn('archive:', e.message); }
  }
  return out;
}

/* ------------------------------------------------------- across venues */

let venueCache = { at: 0, data: null };

/** Every venue asked on its own for every release: the same question, priced side by side. */
async function compareVenues({ maxAgeMs = 120000 } = {}) {
  if (venueCache.data && Date.now() - venueCache.at < maxAgeMs) return venueCache.data;
  const summarize = (venue, d) => {
    const top = d.p.indexOf(Math.max(...d.p));
    return { venue, ok: true, title: d.title || null, date: d.date, labels: d.labels, p: d.p, top: d.labels[top], topP: d.p[top],
      volume: d.depth ? d.depth.volume : null, ticker: d.ticker || null };
  };
  const fail = (venue, e) => ({ venue, ok: false, error: String(e.message || e).slice(0, 160) });
  const out = [];
  for (const spec of SPECS) {
    const jobs = [];
    jobs.push(Date.now() > kalshiDownUntil ? liveEvent(spec).then((d) => summarize('Kalshi', d), (e) => fail('Kalshi', e))
      : Promise.resolve(fail('Kalshi', new Error('unreachable from this network (connection reset)'))));
    if (spec.forecastex) for (const ex of ['KALSHI', 'FORECASTX', 'CME']) {
      jobs.push(forecastex.liveEvent(spec, { continuousFromMarkets, buckets: FED_BUCKETS }, ex)
        .then((d) => summarize(forecastex.VENUE[ex], d), (e) => fail(forecastex.VENUE[ex], e)));
    }
    if (spec.limitless) jobs.push(limitless.liveEvent(spec, FED_BUCKETS).then((d) => summarize('Limitless', d), (e) => fail('Limitless', e)));
    if (spec.futuur) jobs.push(futuur.liveEvent(spec, { continuousFromMarkets, buckets: FED_BUCKETS }).then((d) => summarize('Futuur', d), (e) => fail('Futuur', e)));
    let venues = await Promise.all(jobs);
    // IBKR pools some products across exchanges into one book: show a shared book once
    const merged = [];
    for (const v of venues) {
      const twin = v.ok && merged.find((m) => m.ok && JSON.stringify(m.p) === JSON.stringify(v.p));
      if (twin) { twin.venue += ' + ' + v.venue; twin.shared = true; } else merged.push(v);
    }
    venues = merged;
    if (spec.id === 'fomc') {
      const live = venues.find((v) => v.ok);
      if (live) {
        try {
          const f = await fedfutures.oddsForMeeting(live.date);
          venues.push({ venue: 'Fed funds futures', ok: true, reference: true, labels: FED_BUCKETS.map((b) => b.label), p: f.probs,
            top: FED_BUCKETS[f.probs.indexOf(Math.max(...f.probs))].label, topP: Math.max(...f.probs), volume: null, date: live.date });
        } catch (e) { venues.push(fail('Fed funds futures', e)); }
      }
    }
    // where venues agree on the likeliest outcome, how far apart their odds for it are
    const ok = venues.filter((v) => v.ok);
    const lead = ok[0];
    let spreadPp = null;
    if (lead && ok.length >= 2) {
      const same = ok.filter((v) => v.top === lead.top);
      if (same.length >= 2) spreadPp = Math.round((Math.max(...same.map((v) => v.topP)) - Math.min(...same.map((v) => v.topP))) * 1000) / 10;
    }
    out.push({ id: spec.id, name: spec.name, unit: spec.unit, venues, spreadPp });
  }
  venueCache = { at: Date.now(), data: { asOf: new Date().toISOString(), releases: out } };
  return venueCache.data;
}

module.exports = { loadEvents, compareVenues, isotonicDecreasing, continuousFromMarkets, SPECS, __test: { discreteFromMarkets, FED_BUCKETS } };
