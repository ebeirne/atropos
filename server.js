// Atropos server.
//
//   node server.js            then open http://127.0.0.1:4411
//
// Keys live in .env (built by scripts/make-env.js) and never reach the browser.
// SnapTrade links Robinhood or Fidelity read-only; Kalshi supplies the odds;
// the engine computes every number; Sonnet 5.5 picks and explains; Jev checks.

const http = require('http');
const fs = require('fs');
const path = require('path');

require('./lib/env').load(path.join(__dirname, '.env'));

const markets = require('./lib/markets');
const engine = require('./lib/engine');
const snaptrade = require('./lib/snaptrade');
const jev = require('./lib/jev');
const claude = require('./lib/claude');
const archive = require('./lib/archive');
const news = require('./lib/news');
const agent = require('./lib/agent');
const funds = require('./lib/funds');
const voice = require('./lib/voice');
const history = require('./lib/history');
const rules = require('./lib/rules');
const ledger = require('./lib/ledger');
const guard = require('./lib/guard');
const AttyBeats = require('./public/atty/beats');

const PORT = Number(process.env.PORT || 4411);
const HOST = process.env.HOST || (guard.PUBLIC ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');

/* ------------------------------------------------------- sample inputs */
// Used until a brokerage is linked. Prices are illustrative, not quotes.

const SAMPLE_PORTFOLIO = {
  accounts: [{ id: 'sample', broker: 'Sample', name: 'Sample brokerage', number: '' }],
  cash: 4200,
  positions: [
    ['SPY', 'SPDR S&P 500 ETF', 40, 668.20],
    ['QQQ', 'Invesco QQQ Trust', 15, 602.40],
    ['NVDA', 'NVIDIA Corp', 30, 186.50],
    ['AAPL', 'Apple Inc', 25, 251.30],
    ['TSLA', 'Tesla Inc', 12, 438.90],
    ['JPM', 'JPMorgan Chase', 20, 307.10],
    ['TLT', 'iShares 20+ Year Treasury', 80, 89.60],
    ['O', 'Realty Income', 50, 58.30],
  ].map(([symbol, description, units, price]) => ({
    account: 'Sample brokerage', broker: 'Sample', type: 'equity',
    symbol, description, units, price, value: units * price, avgCost: null, openPnl: null,
  })).concat([{
    account: 'Sample brokerage', broker: 'Sample', type: 'option', symbol: 'NVDA 261120C00200000',
    underlying: 'NVDA', right: 'call', strike: 200, expiry: '2026-11-20', units: 2, price: 6.10, value: 1220,
  }]),
};

// Proxy prices when the user does not hold the proxy and quotes are
// unavailable. Illustrative; a ticket built on one says so.
const REFERENCE_PRICES = {
  SPY: 668.20, QQQ: 602.40, IWM: 245.10, TLT: 89.60, IEF: 96.80,
  XLF: 53.20, XLU: 86.40, XLE: 89.70, GLD: 368.90,
};

/* --------------------------------------------------------------- state */

const LINKED = path.join(__dirname, 'data');
fs.mkdirSync(LINKED, { recursive: true });

async function portfolio() {
  // the public demo never touches a brokerage: it always shows the sample portfolio
  if (guard.PUBLIC) return { ...SAMPLE_PORTFOLIO, source: 'sample', reason: 'Public demo' };
  if (!snaptrade.configured()) return { ...SAMPLE_PORTFOLIO, source: 'sample', reason: 'SnapTrade keys not set' };
  try {
    const live = await snaptrade.holdings();
    if (!live.accounts.length) return { ...SAMPLE_PORTFOLIO, source: 'sample', reason: 'No brokerage linked yet' };
    return { ...live, source: 'snaptrade' };
  } catch (e) {
    return { ...SAMPLE_PORTFOLIO, source: 'sample', reason: 'SnapTrade error: ' + snaptrade.describe(e) };
  }
}

/* ------------------------------------------------------------ pipeline */

async function runPipeline({ forceSample = false } = {}) {
  const timings = {};
  const t = (k, t0) => { timings[k] = Date.now() - t0; };

  let t0 = Date.now();
  const pf = forceSample ? { ...SAMPLE_PORTFOLIO, source: 'sample', reason: 'Demo mode' } : await portfolio();
  t('portfolio', t0);

  t0 = Date.now();
  const events = await markets.loadEvents({ forceSnapshot: forceSample });
  const signals = events.map(engine.analyseEvent);
  signals.forEach((s, i) => { s.change = archive.changeFor(events[i]); });
  t('markets', t0);

  // Buckets: the table first, Jev for anything it does not know.
  const equities = pf.positions.filter((p) => p.type === 'equity');
  const unknown = equities.filter((p) => !engine.bucketOf(p.symbol))
    .map((p) => ({ symbol: p.symbol, description: p.description }));
  let classified = { buckets: {}, latency_ms: 0 };
  if (unknown.length && jev.configured()) {
    t0 = Date.now();
    try { classified = await jev.classify(unknown); } catch (e) { classified.error = e.message; }
    t('jev_classify', t0);
  }
  for (const p of equities) {
    const known = engine.bucketOf(p.symbol);
    p.bucket = known || (classified.buckets[p.symbol] || {}).bucket || 'other';
    p.bucketSource = known ? 'table' : classified.buckets[p.symbol] ? 'jev' : 'default';
    p.bucketLabel = engine.BUCKETS[p.bucket].label;
  }

  // Prices for every proxy a ticket might use.
  const prices = { ...REFERENCE_PRICES };
  const priceSource = Object.fromEntries(Object.keys(REFERENCE_PRICES).map((k) => [k, 'reference']));
  for (const p of equities) if (p.price) { prices[p.symbol] = p.price; priceSource[p.symbol] = pf.source; }
  if (pf.source === 'snaptrade' && pf.accounts[0]) {
    const need = Object.keys(REFERENCE_PRICES).filter((s) => priceSource[s] === 'reference');
    const q = await snaptrade.quotes(pf.accounts[0].id, need);
    for (const [s, px] of Object.entries(q)) { prices[s] = px; priceSource[s] = 'quote'; }
  }

  const planned = engine.plan(equities, signals, prices);

  // Sonnet decides and explains; the deterministic writer stands in without a key.
  t0 = Date.now();
  let composed, composer = 'deterministic', composeError = null;
  if (claude.configured()) {
    try { composed = await claude.compose(pf, signals, planned); composer = composed.model; }
    catch (e) { composeError = e.message; }
  }
  if (!composed) composed = claude.composeDeterministic(planned, signals);
  t('compose', t0);

  // Merge. Numbers always come from the engine; text from the composer, with
  // the deterministic writer filling any order or holding the model skipped.
  const orders = planned.orders.map((o) => {
    const note = composed.orders.find((x) => x.order_id === o.id) || claude.writeOrder(o);
    return { ...note, order: o, priceSource: priceSource[o.underlying] || 'reference' };
  });
  const holdingsOut = planned.perHolding.map((ph) => {
    const note = composed.holdings.find((x) => x.holding === ph.holding) || claude.writeHolding(ph, planned.orders, signals);
    const h = equities.find((p) => p.symbol === ph.holding);
    return { ...ph, ...note, position: { units: h.units, price: h.price, value: h.value,
      bucket: h.bucketLabel, bucketSource: h.bucketSource } };
  });

  // Jev reads each order's written case against the order's own numbers, one
  // part at a time, and the order is only as good as its weakest part. Measured
  // on the same correct text: asked whole it scored 0.53-0.61 (one run 0.44,
  // which held a correct order); split this way, 0.79-0.85, with planted errors
  // at 0.05. See scripts/test-jev-single.js.
  const PARTS = ['headline', 'rationale', 'risk', 'invalidation'];
  const toCheck = [];
  for (const x of orders) {
    const numbers = {
      underlying: x.order.underlying, legs: x.order.legs, limitPerShare: x.order.limitPerShare,
      maxDebitPerShare: x.order.maxDebitPerShare, premiumAtRisk: x.order.premiumAtRisk,
      maxPayout: x.order.maxPayout, eventName: x.order.eventName, eventDate: x.order.eventDate,
      tail: x.order.tail, covers: x.order.covers.map((c) => c.holding),
    };
    for (const part of PARTS) toCheck.push({ id: `${x.order.id}#${part}`, text: x[part], numbers });
  }
  let checked = { checks: {}, latency_ms: 0 };
  if (toCheck.length && jev.configured()) {
    t0 = Date.now();
    try { checked = await jev.checkRationales(toCheck); } catch (e) { checked.error = e.message; }
    t('jev_check', t0);
  }
  for (const x of orders) {
    const scores = PARTS.map((p) => [p, checked.checks[`${x.order.id}#${p}`]]).filter(([, s]) => s != null);
    if (!scores.length) continue;
    const [weakest, score] = scores.reduce((a, b) => (b[1] < a[1] ? b : a));
    x.check = { consistent: score, passed: score >= 0.5, weakest, parts: Object.fromEntries(scores) };
    if (!x.check.passed && x.decision === 'place') x.decision = 'review';
  }
  const rank = { in_order: 0, avoid: 1, hold: 2 };
  const edge = (h) => (h.tailEdge ? h.tailEdge.dollars : 0);
  holdingsOut.sort((a, b) => (rank[a.decision] - rank[b.decision]) || (edge(a) - edge(b)));

  return {
    generatedAt: new Date().toISOString(),
    summary: composed.summary,
    portfolio: { source: pf.source, reason: pf.reason || null, accounts: pf.accounts, cash: pf.cash, positions: pf.positions },
    signals, orders, holdings: holdingsOut, skipped: planned.skipped,
    meta: {
      composer, composeError, classifyError: classified.error || null, checkError: checked.error || null,
      jevLatency: { classify: classified.latency_ms, check: checked.latency_ms },
      claudeUsage: composed.usage || null, timings,
      marketSources: [...new Set(signals.map((s) => s.source))],
    },
  };
}

/* -------------------------------------------------------------- routes */

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

async function fetchWithTimeout(target, req, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const init = { method: req.method, headers: { accept: 'application/json' }, signal: ac.signal };
    if (req.method === 'POST') { init.headers['content-type'] = req.headers['content-type'] || 'application/json'; init.body = await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); }); }
    return await fetch(target, init);
  } finally { clearTimeout(t); }
}
const SNAP = path.join(PUBLIC, 'data');
function readSnap(...p) { try { return JSON.parse(fs.readFileSync(path.join(SNAP, ...p), 'utf8')); } catch (_) { return null; } }
function snapshotBasis(rest) {
  if (rest === 'events') return readSnap('basis', 'events.json');
  if (rest === 'calibration') return readSnap('basis', 'calibration.json');
  if (rest === 'divergence') return readSnap('basis', 'divergence.json');
  if (rest === 'health') return { ok: true, demo_mode: true, snapshot: true };
  const m = rest.match(/^events\/([a-z0-9.-]+)$/); if (m) return readSnap('basis', 'events', m[1] + '.json');
  return null;
}
function snapshotLeaf(rest) {
  // Leaf's own routes start with /api; the landing page asks for the short 'scan'
  const scan = readSnap('leaf', 'scan.json'), r = rest.replace(/^api\//, '');
  if (r === 'scan' || r === 'scan/multi') return scan;
  if (r === 'strategies' && scan) return { strategies: Object.fromEntries(Object.entries(scan.strategies).map(([k, v]) => [k, { label: v.spec.name, summary: v.spec.summary, requires: v.spec.needs }])) };
  if (r === 'universe/yahoo' && scan) return { provider: 'yahoo', tickers: scan.universe };
  if (r === 'health') return { ok: true, snapshot: true };
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const route = url.pathname;
  try {
    if (guard.PUBLIC) {
      // linking a brokerage is for your own machine only
      if (route === '/api/link') return send(res, 404, { error: 'Linking a brokerage only works when you run Atropos yourself.' });
      if (route.startsWith('/api/')) {
        const kind = route === '/api/try' || route === '/api/tickets' ? 'try' : route === '/api/news' ? 'news' : route === '/api/voice' ? 'voice' : 'api';
        if (!guard.allow(req, kind) || (kind !== 'api' && !guard.allow(req, 'api'))) return send(res, 429, { error: 'Too many requests. Try again in a few minutes.' });
      }
    }
    // the two engines we joined: Basis (FastAPI on :8000) and Leaf (FastAPI on :8001), reached
    // through this server so the pages have one origin; when either is not running, the
    // committed snapshots in public/data answer instead
    if (route.startsWith('/api/basis/') || route.startsWith('/api/leaf/')) {
      const basis = route.startsWith('/api/basis/'), rest = route.slice(basis ? 11 : 10);
      const base = basis ? (process.env.BASIS_URL || 'http://127.0.0.1:8000') : (process.env.LEAF_URL || 'http://127.0.0.1:8001');
      try {
        const r = await fetchWithTimeout(base + '/' + rest + (url.search || ''), req, 2500);
        const body = Buffer.from(await r.arrayBuffer());
        return send(res, r.status, body, r.headers.get('content-type') || 'application/json; charset=utf-8');
      } catch (_) { /* not running: fall through to the snapshot */ }
      const snap = basis ? snapshotBasis(rest) : snapshotLeaf(rest);
      if (snap) return send(res, 200, snap);
      return send(res, 503, { error: (basis ? 'Basis' : 'Leaf') + ' is not running and no snapshot covers ' + rest });
    }

    if (route === '/api/status' && guard.PUBLIC) {
      // the public demo: no accounts or brokers, just what the console needs to run on the sample
      return send(res, 200, { live: true, public: true, snaptrade: { configured: false, accounts: [], error: null, brokers: [] },
        jev: { configured: jev.configured() }, claude: { configured: claude.configured(), model: claude.MODEL } });
    }
    if (route === '/api/status') {
      const [j, accts, brokers] = await Promise.all([
        jev.health(),
        snaptrade.configured() ? snaptrade.accounts().catch((e) => ({ error: snaptrade.describe(e) })) : null,
        snaptrade.configured() ? snaptrade.brokers().catch(() => []) : [],
      ]);
      const ev = await markets.loadEvents();
      return send(res, 200, {
        live: true,
        snaptrade: { configured: snaptrade.configured(), accounts: Array.isArray(accts) ? accts : [], error: accts && accts.error || null, brokers },
        jev: j, claude: { configured: claude.configured(), model: claude.MODEL },
        markets: ev.map((e) => ({ id: e.id, source: e.source, date: e.date, error: e.liveError || null })),
      });
    }

    if (route === '/api/link') {
      const broker = String(url.searchParams.get('broker') || '').toUpperCase();
      if (!/^(ROBINHOOD|FIDELITY)$/.test(broker)) return send(res, 400, { error: 'broker must be ROBINHOOD or FIDELITY' });
      const redirect = `http://${HOST}:${PORT}/console.html?linked=${broker.toLowerCase()}`;
      return send(res, 200, { url: await snaptrade.linkUrl(broker, redirect) });
    }

    if (route === '/api/archive') {
      const t = url.searchParams.get('asof');
      return send(res, 200, t ? { asOf: t, snapshots: archive.asOf(t) } : archive.status());
    }

    if (route === '/api/events') return send(res, 200, await tapeNow());

    if (route === '/api/agent') {
      // the latest round of Atty's agent; ?run=1 asks for a fresh round now
      if (url.searchParams.get('run') === '1' && agentRound && !guard.PUBLIC) await agentRound();
      return send(res, 200, agent.status());
    }

    if (route === '/api/funds') {
      return send(res, 200, await funds.benchmark(engineSignals(await markets.loadEvents()), url.searchParams.get('tickers')));
    }

    if (route === '/api/news') {
      return send(res, 200, await news.search(url.searchParams.get('q')));
    }

    if (route === '/api/try') {
      // anyone's own tickers, no login: "NVDA 20000, SPY, TLT" (amounts in dollars, default $10,000)
      const parts = String(url.searchParams.get('h') || '').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
      if (!parts.length || parts.length > 15) return send(res, 400, { error: 'give 1 to 15 tickers' });
      const positions = [];
      for (const part of parts) {
        const m = part.match(/^([A-Z][A-Z.]{0,5})(?:[\s:=]+\$?([\d,]+(?:\.\d+)?))?$/);
        if (!m) return send(res, 400, { error: `could not read "${part.slice(0, 20)}"` });
        const value = m[2] ? Number(m[2].replace(/,/g, '')) : 10000;
        if (!(value > 0 && value <= 1e7)) return send(res, 400, { error: `amount for ${m[1]} must be between $1 and $10,000,000` });
        positions.push({ symbol: m[1], description: m[1], value, type: 'equity' });
      }
      const unknown = positions.filter((p) => !engine.bucketOf(p.symbol)).map((p) => ({ symbol: p.symbol, description: p.symbol }));
      let buckets = {};
      if (unknown.length && jev.configured()) { try { buckets = (await jev.classify(unknown)).buckets; } catch (_) { buckets = {}; } }
      const withBuckets = positions.map((p) => ({ ...p, bucket: engine.bucketOf(p.symbol) || (buckets[p.symbol] && buckets[p.symbol].bucket) || 'other' }));
      const result = await agent.runOnce({ positions: withBuckets, signals: engineSignals(await markets.loadEvents()), portfolioId: 'try', quick: true });
      const holdings = result.holdings.map((h) => ({ symbol: h.symbol, value: h.value }));
      const [check, cpiData] = await Promise.all([history.check(holdings), history.cpi()]);
      const fine = {};
      for (const p of result.portfolio) if (p.best) fine[`${p.release}:${p.side}`] = rules.edge(p.best, { cpi: cpiData, nfpDays: check.days.nfp, gaps: check.gaps });
      const thread = { at: new Date().toISOString(), history: check, fine, ledger: [] };
      await learnLines({ result }, thread);
      return send(res, 200, { agent: { result }, thread });
    }

    if (route === '/api/thread') {
      // does protection pay when you lose (release-day history), the fine print on each
      // quote (contract terms), and Atty's record of calls
      const r = agent.status().result;
      if (!r) return send(res, 503, { error: 'the agent has not finished its first round yet' });
      return send(res, 200, await threadFor(r));
    }

    if (route === '/api/voice') {
      // Atty reads one line aloud (ElevenLabs, cached on disk per line)
      const t = url.searchParams.get('t');
      if (guard.PUBLIC && !voice.cached(t) && !guard.lineAllowed(t)) {
        await refreshLines();
        if (!guard.lineAllowed(t)) return send(res, 403, { error: 'Atty only reads her own lines' });
      }
      try { return send(res, 200, await voice.speak(t), 'audio/mpeg'); }
      catch (e) { return send(res, e.code || 500, { error: e.message }); }
    }

    if (route === '/api/venues') {
      // live side-by-side odds, plus the last Scrapling survey of every venue (scripts/survey_venues.py)
      let survey = null;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'venues.json'), 'utf8'));
        survey = { at: r.surveyed_at, venues: r.venues.map((x) => ({ name: x.name, reachable: x.reachable,
          counts: Object.fromEntries(Object.entries(x.releases).map(([k, y]) => [k, y.count])) })) };
      } catch (_) { /* no survey yet */ }
      return send(res, 200, { ...(await markets.compareVenues()), survey });
    }

    if (route === '/api/tickets') {
      return send(res, 200, await runPipeline({ forceSample: url.searchParams.get('sample') === '1' }));
    }

    const file = route === '/' || route.endsWith('/') ? route.replace(/^\/+/, '') + 'index.html' : route.replace(/^\/+/, '');
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return send(res, 404, { error: 'not found' });
    }
    let body = fs.readFileSync(full);
    // Pages are authored in the artifact format (no doctype; the host adds the
    // skeleton). Served locally they need one, or the browser drops to quirks mode.
    if (path.extname(full) === '.html' && !/^\s*<!doctype/i.test(body.toString('utf8', 0, 64))) {
      body = Buffer.concat([Buffer.from('<!doctype html>\n<meta charset="utf-8">\n'), body]);
    }
    return send(res, 200, body, MIME[path.extname(full)] || 'application/octet-stream');
  } catch (e) {
    console.error(route, e);
    return send(res, 500, { error: e.message });
  }
});

/* ------------------------------------------------------- Atty's agent */
function engineSignals(events) { return events.map(engine.analyseEvent); }
async function tapeNow() {
  const ev = await markets.loadEvents();
  const signals = ev.map(engine.analyseEvent);
  signals.forEach((s, i) => { s.change = archive.changeFor(ev[i]); });
  return { signals };
}
/** Does protection pay when you lose (release-day history), the fine print on each quote, and Atty's record. */
async function threadFor(r) {
  const holdings = r.holdings.map((h) => ({ symbol: h.symbol, value: h.value }));
  const [check, cpiData] = await Promise.all([history.check(holdings), history.cpi()]);
  const fine = {};
  for (const p of r.portfolio) if (p.best) fine[`${p.release}:${p.side}`] = rules.edge(p.best, { cpi: cpiData, nfpDays: check.days.nfp, gaps: check.gaps });
  return { at: new Date().toISOString(), history: check, fine, ledger: ledger.list() };
}
/** The lines Atty would say about this result, the only ones she may record new audio for in public. */
async function learnLines(agentPayload, thread) {
  if (!guard.PUBLIC) return;
  try {
    const hs = agentPayload.result.holdings;
    const [tape, fundsData] = await Promise.all([tapeNow(), funds.benchmark(engineSignals(await markets.loadEvents()), hs.map((h) => h.symbol).join(','))]);
    guard.allowLines(AttyBeats.beats({ agent: agentPayload, thread, tape, funds: fundsData }).map((b) => b.say));
  } catch (e) { console.log('learnLines', e.message); }
}
let linesAt = 0;
async function refreshLines() {
  if (Date.now() - linesAt < 60e3) return;
  linesAt = Date.now();
  const st = agent.status(); if (!st.result) return;
  await learnLines(st, await threadFor(st.result));
}
/** The holdings the agent works on: the linked (or sample) portfolio, buckets filled in by Jev where unknown. */
async function agentInputs() {
  const pf = await portfolio();
  const positions = pf.positions.filter((p) => p.type === 'equity');
  const unknown = positions.filter((p) => !engine.bucketOf(p.symbol)).map((p) => ({ symbol: p.symbol, description: p.description }));
  let buckets = {};
  if (unknown.length && jev.configured()) { try { buckets = (await jev.classify(unknown)).buckets; } catch (_) { buckets = {}; } }
  const withBuckets = positions.map((p) => ({ ...p, bucket: engine.bucketOf(p.symbol) || (buckets[p.symbol] && buckets[p.symbol].bucket) || 'other' }));
  return { positions: withBuckets, signals: engineSignals(await markets.loadEvents()), portfolioId: pf.source };
}
let agentRound = null;

if (require.main === module) {
  // every round also records Atty's calls, and settles the ones whose release is out
  agentRound = agent.start(agentInputs, Number(process.env.AGENT_EVERY_MIN || 10) * 60000, async (result) => {
    ledger.record(result);
    await ledger.settle(result.holdings.map((h) => ({ symbol: h.symbol, value: h.value })));
  });
  server.listen(PORT, HOST, () => {
    console.log(`Atropos  http://${HOST}:${PORT}`);
    console.log(`  snaptrade  ${guard.PUBLIC ? 'off (public demo: sample portfolio only)' : snaptrade.configured() ? 'keys set (personal, read-only)' : 'MISSING keys'}`);
    console.log(`  jev        ${jev.configured() ? 'key set' : 'MISSING key'}`);
    console.log(`  claude     ${claude.configured() ? claude.MODEL : 'no ANTHROPIC_API_KEY - deterministic writer in use'}`);
    console.log(`  agent      every ${Number(process.env.AGENT_EVERY_MIN || 10)} min`);
  });
}

module.exports = { runPipeline };
