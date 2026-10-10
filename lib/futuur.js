// Futuur: a prediction market with public, keyless JSON (Django REST). Found by
// the venue survey (scripts/survey_venues.py, Scrapling). It lists the Fed
// decision as outcomes ("No change", "25 bps increase") and payrolls, CPI and
// unemployment as threshold ladders ("Above 50,000"). Prices are read in USDC
// (real money) and fall back to play money only when a real price is missing;
// real-money volume is what the credibility gate sees.

const https = require('https');

const BASE = 'https://api.futuur.com/api/v1';

function getJSON(url, timeout = 10000) {
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

function priceOf(o) {
  const p = o.price || {};
  const v = p.USDC != null ? p.USDC : p.OOM;
  return Number.isFinite(Number(v)) ? Number(v) : NaN;
}

/** The soonest open market whose title matches, with its outcomes. */
async function findMarket(query, titleRe) {
  const j = await getJSON(`${BASE}/markets/?search=${encodeURIComponent(query)}&format=json&limit=40`);
  const list = (j.results || []).filter((m) => titleRe.test(m.title || '') && m.status === 'open' &&
    Date.parse(m.bet_end_date || 0) > Date.now());
  list.sort((a, b) => Date.parse(a.bet_end_date) - Date.parse(b.bet_end_date));
  if (!list.length) throw new Error(`no open "${query}" market matching ${titleRe} on Futuur`);
  return getJSON(`${BASE}/markets/${list[0].id}/?format=json`);
}

/**
 * spec.futuur = { query, re, scale } . A threshold ladder ("Above 10,000") becomes
 * Kalshi-shaped "greater" markets so the same survival-curve reader (with its
 * monotone fix) turns it into a distribution; outcomes go through the Fed buckets.
 */
async function liveEvent(spec, { continuousFromMarkets, buckets }) {
  const m = await findMarket(spec.futuur.query, spec.futuur.re);
  const outs = (m.outcomes || []).filter((o) => !o.disabled && Number.isFinite(priceOf(o)));
  const depth = { volume: Math.round((m.volume_real_money || 0) * 100) / 100, medianSpread: null, emptyBooks: 0,
    markets: outs.length, playMoney: Math.round(m.volume_play_money || 0) };
  let dist = null;
  if (spec.kind === 'discrete') {
    const raw = buckets.map(() => 0);
    let hit = 0;
    for (const o of outs) {
      const i = buckets.findIndex((b) => b.re.test(o.title));
      if (i >= 0) { raw[i] += priceOf(o); hit++; }
    }
    const sum = raw.reduce((a, b) => a + b, 0);
    if (hit >= 2 && sum > 0) {
      dist = { labels: buckets.map((b) => b.label), raw: raw.map((v) => Math.round(v * 1000) / 10),
        p: raw.map((v) => v / sum), overround: Math.round((sum - 1) * 1000) / 10, method: 'outcomes' };
    }
  } else {
    const scale = spec.futuur.scale || 1;
    const ladder = outs.map((o) => {
      const x = String(o.title).match(/above\s+(-?[\d,.]+)/i);
      return x ? { strike_type: 'greater', floor_strike: Number(x[1].replace(/,/g, '')) * scale, last_price_dollars: priceOf(o) } : null;
    }).filter(Boolean);
    dist = continuousFromMarkets(ladder, spec.dp);
  }
  if (!dist) throw new Error(`${m.slug || m.id} did not form a distribution`);
  return {
    ...dist, depth, source: 'futuur', title: m.title, ticker: m.slug || String(m.id),
    date: String(m.bet_end_date || '').slice(0, 10), asOf: new Date().toISOString(),
  };
}

module.exports = { liveEvent, __test: { priceOf } };
