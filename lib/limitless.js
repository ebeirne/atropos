// Limitless Exchange: a second live source for prediction-market odds, used
// when Kalshi is unreachable. Public REST, no key.
//
// Its macro markets are "group" markets: one parent (e.g. "September Inflation
// US - Annual") with a child market per bracket ("<=2.9%", "3.0%", ... ">=4.0%").
// Books are often thin, and an empty book quotes a meaningless 50c mid
// (bid 0.1c, ask 99.8c). Those are read at their bid - the most anyone will
// actually pay - and counted, so the credibility gate can see them.

const https = require('https');

const BASE = 'https://api.limitless.exchange';

function getJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { Accept: 'application/json', 'User-Agent': 'prior-desk/0.1' } }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Limitless HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch (_) { reject(new Error('Limitless returned non-JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Limitless timeout')));
    req.on('error', reject);
  });
}

const EMPTY_SPREAD = 0.25;   // wider than this and the book says nothing

function quote(child) {
  const buy = child.tradePrices && child.tradePrices.buy;
  const ask = buy && buy.market ? Number(buy.market[0]) : NaN;   // pay this to buy YES now
  const bid = buy && buy.limit ? Number(buy.limit[0]) : NaN;     // best resting YES bid
  const mid = Array.isArray(child.prices) ? Number(child.prices[0]) : NaN;
  const spread = Number.isFinite(ask) && Number.isFinite(bid) ? ask - bid : NaN;
  const empty = !(Number.isFinite(spread) && spread <= EMPTY_SPREAD);
  return {
    price: empty ? (Number.isFinite(bid) ? Math.max(0, bid) : 0) : mid,
    bid, ask, spread, empty, volume: Number(child.volumeFormatted || 0),
  };
}

function depthOf(quotes) {
  const spreads = quotes.filter((q) => !q.empty).map((q) => q.spread).sort((a, b) => a - b);
  return {
    volume: Math.round(quotes.reduce((s, q) => s + q.volume, 0) * 100) / 100,
    medianSpread: spreads.length ? Math.round(spreads[Math.floor(spreads.length / 2)] * 1000) / 1000 : null,
    emptyBooks: quotes.filter((q) => q.empty).length,
    markets: quotes.length,
  };
}

/** Percent brackets: "<=2.9%", "3.0%", ">=4.0%" -> cells with edges halfway between. */
function bracketsFromChildren(children) {
  const cells = [];
  for (const c of children) {
    const m = String(c.title || '').replace(/\s+/g, '').match(/^(≤|<=|<)?(≥|>=|>)?(-?\d+(?:\.\d+)?)%?$/);
    if (!m) continue;
    const x = Number(m[3]);
    cells.push({ kind: m[1] ? 'le' : m[2] ? 'ge' : 'eq', x, label: c.title, q: quote(c) });
  }
  if (cells.length < 3) return null;
  cells.sort((a, b) => a.x - b.x);
  const eqs = cells.filter((c) => c.kind === 'eq').map((c) => c.x);
  const step = eqs.length >= 2 ? Math.round((eqs[1] - eqs[0]) * 1000) / 1000 : 0.1;
  const edges = [];
  cells.forEach((c, i) => {
    const lo = c.kind === 'le' ? c.x + step / 2 - step : c.x - step / 2;
    if (i === 0) edges.push(Math.round(lo * 1000) / 1000);
    const hi = c.kind === 'ge' ? c.x - step / 2 + step : c.x + step / 2;
    edges.push(Math.round(hi * 1000) / 1000);
  });
  const sum = cells.reduce((s, c) => s + c.q.price, 0);
  if (!(sum > 0)) return null;
  return {
    labels: cells.map((c) => c.label),
    edges,
    raw: cells.map((c) => Math.round(c.q.price * 1000) / 10),
    p: cells.map((c) => c.q.price / sum),
    overround: Math.round((sum - 1) * 1000) / 10,
    method: 'brackets',
    depth: depthOf(cells.map((c) => c.q)),
  };
}

function outcomesFromChildren(children, buckets) {
  const raw = buckets.map(() => 0);
  const quotes = [];
  let hit = 0;
  for (const c of children) {
    const i = buckets.findIndex((b) => b.re.test(String(c.title || '')));
    if (i < 0) continue;
    const q = quote(c);
    raw[i] += q.price; quotes.push(q); hit++;
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  if (hit < 2 || !(sum > 0)) return null;
  return {
    labels: buckets.map((b) => b.label),
    raw: raw.map((v) => Math.round(v * 1000) / 10),
    p: raw.map((v) => v / sum),
    overround: Math.round((sum - 1) * 1000) / 10,
    method: 'outcomes',
    depth: depthOf(quotes),
  };
}

/** The soonest open group market whose title matches, with its children. */
async function findGroup(query, titleRe) {
  const j = await getJSON(`${BASE}/markets/search?query=${encodeURIComponent(query)}&limit=25`);
  const list = (Array.isArray(j) ? j : j.markets || j.data || [])
    .filter((m) => titleRe.test(m.title || '') && !m.expired && (m.expirationTimestamp || 0) > Date.now());
  list.sort((a, b) => a.expirationTimestamp - b.expirationTimestamp);
  if (!list.length) throw new Error(`no open "${query}" market matching ${titleRe} on Limitless`);
  const full = await getJSON(`${BASE}/markets/${encodeURIComponent(list[0].slug)}`);
  if (!Array.isArray(full.markets) || !full.markets.length) throw new Error(`${list[0].slug} has no child markets`);
  return full;
}

async function liveEvent(spec, buckets) {
  const g = await findGroup(spec.limitless.query, spec.limitless.re);
  const dist = spec.kind === 'discrete' ? outcomesFromChildren(g.markets, buckets) : bracketsFromChildren(g.markets);
  if (!dist) throw new Error(`${g.slug} did not form a distribution`);
  return {
    ...dist, source: 'limitless', title: g.title, ticker: g.slug,
    date: new Date(g.expirationTimestamp).toISOString().slice(0, 10), asOf: new Date().toISOString(),
  };
}

module.exports = { liveEvent, __test: { quote, bracketsFromChildren, outcomesFromChildren } };
