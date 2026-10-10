// Does the protection pay when you lose? A protection contract pays on the printed
// number; your portfolio loses on how markets react to it. Those can split apart (a hot
// print already priced in, stocks falling on a soft one). So for every past release day
// we check both: how your current holdings moved that day, and which way the number came
// in compared with the month before.
//
// Sources (all public, no keys):
//   release dates   BLS news-release archive pages (also lists releases never published)
//   CPI             BLS API v1, CPI-U all items before seasonal adjustment (never revised,
//                   so these are the numbers as first printed)
//   payrolls        ALFRED (St. Louis Fed), PAYEMS as it stood on each release day
//   prices          Yahoo Finance daily closes
//
// The "came in above the month before" test is a stand-in for a surprise: forecasts are
// not free to download, so this is what we can measure honestly, and it is labeled so.

const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Atropos/1.0 (local research tool)' };
const CACHE = path.join(__dirname, '..', 'data', 'history-cache.json');
const DAY = 86400e3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let cache = null;
function loadCache() { if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (_) { cache = {}; } } return cache; }
function saveCache() { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
async function cached(key, maxAgeMs, fn) {
  const c = loadCache(), hit = c[key];
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const data = await fn();
  c[key] = { at: Date.now(), data }; saveCache();
  return data;
}
async function text(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every release in the BLS archive: { month: 'YYYY-MM', date: 'YYYY-MM-DD' } or { month, notPublished: note }. */
async function releases(kind) {
  const page = kind === 'cpi' ? 'cpi' : 'empsit';
  return cached('releases:' + page, 12 * 3600e3, async () => {
    const html = (await text(`https://www.bls.gov/bls/news-release/${page}.htm`)).replace(/<!--[\s\S]*?-->/g, '');
    const out = [];
    const label = kind === 'cpi' ? 'Consumer Price Index' : 'Employment Situation';
    const re = new RegExp(`<li>\\s*(?:<a href="/news\\.release/archives/${page}_(\\d{2})(\\d{2})(\\d{4})\\.htm">)?\\s*(${MONTHS.join('|')}) (\\d{4}) ${label}\\s*(?:</a>)?([^<]*)`, 'g');
    for (const m of html.matchAll(re)) {
      const month = `${m[5]}-${String(MONTHS.indexOf(m[4]) + 1).padStart(2, '0')}`;
      if (m[1]) out.push({ month, date: `${m[3]}-${m[1]}-${m[2]}` });
      else if (/not published/i.test(m[6])) out.push({ month, notPublished: m[6].replace(/&ndash;|–/g, '').trim() });
    }
    return out.sort((a, b) => (a.month < b.month ? -1 : 1));
  });
}

/** CPI-U NSA index by month, and the 12-month change to one decimal as BLS prints it. */
async function cpi() {
  return cached('cpi', 12 * 3600e3, async () => {
    const now = new Date().getUTCFullYear(), idx = {};
    for (const [a, b] of [[now - 7, now - 3], [now - 2, now]]) {
      const j = JSON.parse(await text('https://api.bls.gov/publicAPI/v1/timeseries/data/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesid: ['CUUR0000SA0'], startyear: String(a), endyear: String(b) }) }));
      if (j.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS: ' + (j.message || []).join(' '));
      for (const d of j.Results.series[0].data) if (/^M(0\d|1[0-2])$/.test(d.period)) idx[`${d.year}-${d.period.slice(1)}`] = Number(d.value);
    }
    const yoy = {};
    for (const m of Object.keys(idx)) {
      const [y, mo] = m.split('-'), prev = idx[`${Number(y) - 1}-${mo}`];
      if (prev) yoy[m] = Math.round((idx[m] / prev - 1) * 1000) / 10;
    }
    return { index: idx, yoy };
  });
}

/** Payroll change (thousands) for a month, as first printed on its release day (ALFRED vintage). */
async function payrollFirstPrint(month, releaseDate) {
  return cached(`payems:${month}:${releaseDate}`, 3650 * DAY, async () => {
    await sleep(150);
    const csv = await text(`https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=PAYEMS&vintage_date=${releaseDate}`);
    const rows = csv.trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[1] && r[1] !== '.');
    const i = rows.findIndex((r) => r[0].slice(0, 7) === month);
    if (i < 1) return null;
    return Math.round(Number(rows[i][1]) - Number(rows[i - 1][1]));
  });
}

/** Daily closes (adjusted) for a symbol over five years: { 'YYYY-MM-DD': close }. */
async function closes(symbol) {
  return cached('px:' + symbol, 12 * 3600e3, async () => {
    const j = JSON.parse(await text(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`));
    const r = j.chart.result && j.chart.result[0]; if (!r) return {};
    const adj = (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) || r.indicators.quote[0].close, out = {};
    r.timestamp.forEach((t, i) => { if (adj[i] != null) out[new Date(t * 1000).toISOString().slice(0, 10)] = adj[i]; });
    return out;
  });
}

/** Your portfolio's return on a day, with today's dollar weights; null when no prices that day. */
function dayReturn(date, holdings, px) {
  let w = 0, r = 0;
  for (const h of holdings) {
    const p = px[h.symbol]; if (!p || p[date] == null) continue;
    const days = Object.keys(p); const i = days.indexOf(date); if (i < 1) continue;
    r += h.value * (p[date] / p[days[i - 1]] - 1); w += h.value;
  }
  return w ? r / w : null;
}

/** Release-day series for CPI and payrolls: the number, the month before, and your move. */
async function series(holdings) {
  const px = {};
  for (const h of holdings) { try { px[h.symbol] = await closes(h.symbol); } catch (_) { /* a symbol without history is left out */ } }
  const first = Object.values(px).map((p) => Object.keys(p)[0]).filter(Boolean).sort()[0];
  const out = { cpi: [], nfp: [], gaps: [] };

  const c = await cpi(), cr = await releases('cpi');
  for (const r of cr) {
    if (r.notPublished) { out.gaps.push({ release: 'cpi', month: r.month, note: r.notPublished }); continue; }
    if (first && r.date < first) continue;
    const [y, m] = r.month.split('-').map(Number), prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    if (c.yoy[r.month] == null || c.yoy[prev] == null) continue;
    const ret = dayReturn(r.date, holdings, px);
    if (ret != null) out.cpi.push({ date: r.date, month: r.month, value: c.yoy[r.month], before: c.yoy[prev], ret });
  }

  const er = await releases('nfp');
  let lastFirst = null;
  for (const r of er) {
    if (r.notPublished) { out.gaps.push({ release: 'nfp', month: r.month, note: r.notPublished }); lastFirst = null; continue; }
    if (first && r.date < first) continue;
    let v = null; try { v = await payrollFirstPrint(r.month, r.date); } catch (_) { v = null; }
    const ret = dayReturn(r.date, holdings, px);
    if (v != null && lastFirst != null && ret != null) out.nfp.push({ date: r.date, month: r.month, value: v, before: lastFirst.value, ret });
    if (v != null) lastFirst = { value: v };
  }
  return out;
}

/** For each tail Atty quotes: on the days you lost, did that tail happen? */
function fit(rows, side, lossCut = -0.005) {
  const happened = (x) => (side === 'high' ? x.value > x.before : x.value < x.before);
  const lost = rows.filter((x) => x.ret <= lossCut), paid = lost.filter(happened);
  const sideDays = rows.filter(happened), sideHurt = sideDays.filter((x) => x.ret < 0);
  return {
    days: rows.length, from: rows.length ? rows[0].date : null, to: rows.length ? rows[rows.length - 1].date : null,
    lossDays: lost.length, paidOnLoss: paid.length, hitRate: lost.length ? Math.round(paid.length / lost.length * 100) / 100 : null,
    sideDays: sideDays.length, sideHurt: sideHurt.length,
    worst: rows.slice().sort((a, b) => a.ret - b.ret).slice(0, 4).map((x) => ({ date: x.date, ret: Math.round(x.ret * 10000) / 100, value: x.value, before: x.before, happened: happened(x) })),
  };
}

/** The whole check for a set of holdings: per release and side, plus every release day for the thread. */
async function check(holdings) {
  const s = await series(holdings);
  const r2 = (x) => ({ date: x.date, month: x.month, value: x.value, before: x.before, ret: Math.round(x.ret * 10000) / 100 });
  return {
    at: new Date().toISOString(),
    test: 'A tail "happened" when the number came in above (hot, strong) or below (soft, weak) the month before, as first printed. A loss day is a release day when your current holdings fell 0.5% or more.',
    fits: { 'cpi:high': fit(s.cpi, 'high'), 'cpi:low': fit(s.cpi, 'low'), 'nfp:low': fit(s.nfp, 'low'), 'nfp:high': fit(s.nfp, 'high') },
    days: { cpi: s.cpi.map(r2), nfp: s.nfp.map(r2) },
    gaps: s.gaps,
  };
}

module.exports = { check, releases, cpi, payrollFirstPrint, closes };
