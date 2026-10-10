// Interactive Brokers' ForecastTrader: the public book behind its prediction-market
// app. Found with Scrapling's browser mode (scripts/survey_venues.py --browser):
// the app reads keyless JSON from www.interactivebrokers.com/tws.proxy/public/
// forecasttrader/prediction/*, and each product there carries contracts from
// several exchanges at once: ForecastEx itself, Kalshi and CME event contracts.
// Requests name themselves (User-Agent Atropos/1.0); the feed refuses anonymous ones.
// So one read gives three venues, each with bids, asks and open interest; Kalshi's
// book arrives this way even where Kalshi's own API is unreachable.
//
//   liveEvent(spec, helpers, exchange)   exchange: 'KALSHI' | 'FORECASTX' | 'CME'

const https = require('https');

const BASE = 'https://www.interactivebrokers.com/tws.proxy/public/forecasttrader/prediction';
const VENUE = { KALSHI: 'Kalshi via IBKR', FORECASTX: 'ForecastEx', CME: 'CME via IBKR' };

function getJSON(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { Accept: 'application/json', 'User-Agent': 'Atropos/1.0 (local research tool)' } }, (res) => {
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

// One product list per release, cached for a minute: three exchanges share one read.
const cache = new Map();
async function contracts(conid) {
  const hit = cache.get(conid);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const data = await getJSON(`${BASE}/contract/list?conid=${conid}&exchange=FORECASTX`);
  cache.set(conid, { at: Date.now(), data });
  return data;
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Thresholds like "Above 3.6%", "Above 50,000", "At least -25,000" -> a number in the spec's unit. */
function strikeOf(label, scale) {
  const m = String(label).match(/(?:above|at least|more than|over)\s+(-?[\d,.]+)/i);
  return m ? Number(m[1].replace(/,/g, '')) * (scale || 1) : null;
}

async function liveEvent(spec, { continuousFromMarkets, buckets }, exchange) {
  if (!spec.forecastex) throw new Error('no ForecastTrader product for ' + spec.id);
  const j = await contracts(spec.forecastex.conid);
  const all = (j.complex_contracts || []).filter((c) => (c.contracts || []).some((k) => k.exchange === exchange));
  if (!all.length) throw new Error(`${VENUE[exchange]} lists no ${spec.id} contracts`);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const exps = [...new Set(all.map((c) => c.expiration))].filter((e) => e >= today).sort();
  if (!exps.length) throw new Error(`${VENUE[exchange]}: no open ${spec.id} expiry`);
  const exp = exps[0];
  const book = all.filter((c) => c.expiration === exp);
  // A missing bid under a live ask is a zero bid, as on any book.
  const quotes = book.map((c) => {
    let bid = num(c.bid_yes), ask = num(c.ask_yes);
    if (!Number.isFinite(bid) && Number.isFinite(ask)) bid = 0;
    if (!Number.isFinite(ask) && Number.isFinite(bid)) ask = Math.min(1, bid + 0.01);
    return { c, bid, ask, ok: Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 };
  }).filter((q) => q.ok);
  const spreads = quotes.map((q) => q.ask - q.bid).sort((a, b) => a - b);
  const depth = { volume: quotes.reduce((s, q) => s + (Number(q.c.open_interest) || 0), 0), openInterest: true,
    medianSpread: spreads.length ? Math.round(spreads[Math.floor(spreads.length / 2)] * 1000) / 1000 : null,
    emptyBooks: book.length - quotes.length, markets: book.length };
  let dist = null;
  if (spec.kind === 'discrete') {
    const raw = buckets.map(() => 0);
    let hit = 0;
    for (const q of quotes) {
      const i = buckets.findIndex((b) => b.re.test(q.c.strike_label));
      if (i >= 0) { raw[i] += (q.bid + q.ask) / 2; hit++; }
    }
    const sum = raw.reduce((a, b) => a + b, 0);
    if (hit >= 2 && sum > 0) {
      dist = { labels: buckets.map((b) => b.label), raw: raw.map((v) => Math.round(v * 1000) / 10),
        p: raw.map((v) => v / sum), overround: Math.round((sum - 1) * 1000) / 10, method: 'outcomes' };
    }
  } else {
    const ladder = quotes.map((q) => {
      const x = strikeOf(q.c.strike_label, spec.forecastex.scale);
      return x === null ? null : { strike_type: 'greater', floor_strike: x, yes_bid_dollars: q.bid, yes_ask_dollars: q.ask };
    }).filter(Boolean);
    dist = continuousFromMarkets(ladder, spec.dp);
  }
  if (!dist) throw new Error(`${VENUE[exchange]} ${spec.id} ${exp} did not form a distribution`);
  return {
    ...dist, depth, source: exchange === 'KALSHI' ? 'kalshi-ibkr' : exchange === 'CME' ? 'cme-ibkr' : 'forecastex',
    venue: VENUE[exchange], title: `${j.product_name} · ${book[0].measured_period || ymd(exp)}`, ticker: `${spec.forecastex.conid}:${exp}`,
    date: ymd(exp), asOf: new Date().toISOString(),
  };
}

module.exports = { liveEvent, VENUE, __test: { strikeOf } };
