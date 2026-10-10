// Public 13F holdings: what the slow public money holds. SEC EDGAR is public and
// keyless; it asks automated clients to name themselves (SEC_USER_AGENT in .env).
//
//   discover()          13F filers whose names read like public pensions (state and
//                       municipal) or university endowments, found with EDGAR full-text
//                       search; Jev sorts each name into a kind
//   holdings(cik)       the latest 13F information table (and the one before), parsed
//   exposure(...)       how far each upcoming release would move a fund, measured the
//                       same way as the user's own portfolio (engine buckets x kernels)
//
// 13F covers US-listed equities, ETFs, listed options and some convertibles. It does
// not show bonds, private equity or real estate, so a pension's 13F is only its public
// stock book; every figure here says so.

const https = require('https');
const engine = require('./engine');
const jev = require('./jev');

const UA = () => process.env.SEC_USER_AGENT || 'Atropos hackathon research tool';

function get(url, { json = true, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': UA(), Accept: json ? 'application/json' : '*/*', 'Accept-Encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), { json, timeout })); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} ${url.slice(0, 90)}`));
        if (!json) return resolve(buf);
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('non-JSON from ' + url.slice(0, 90))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// EDGAR asks for no more than ten requests a second; stay well under it.
let lastAt = 0;
async function sec(url, opts) {
  const wait = Math.max(0, lastAt + 150 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  return get(url, opts);
}

/* ------------------------------------------------------------ discovery */
const QUERIES = ['"retirement system"', '"retirement fund"', '"pension fund"', '"pension plan"', '"teachers retirement"',
  '"state board of administration"', '"investment board"', '"employees retirement"', '"municipal employees"',
  '"regents of the university"', '"university of"', '"endowment"', '"investment management company"'];
const NAME_RE = /retire|pension|teacher|state board|investment board|employees|municipal|county|city of|regents|universit|college|endowment|board of|common retirement|public/i;
const KINDS = {
  state_pension: 'A US state public pension or retirement system, or a state investment board managing public pension money.',
  municipal_pension: 'A city, county or municipal public employee pension or retirement system.',
  public_university: 'A public (state) university, its regents, or its endowment investment company.',
  private_university: 'A private university or college endowment.',
  other: 'Anything else: a private company plan, an asset manager, a bank, an insurer.',
};

async function discover({ since = '2026-01-01', perQuery = 100 } = {}) {
  const found = new Map();
  for (const q of QUERIES) {
    let j;
    try { j = await sec(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=13F-HR&dateRange=custom&startdt=${since}&enddt=2026-12-31&from=0`); }
    catch (e) { continue; }
    for (const h of (j.hits && j.hits.hits) || []) {
      const s = h._source || {};
      (s.ciks || []).forEach((cik, i) => {
        const name = String((s.display_names || [])[i] || '').replace(/\s*\(CIK \d+\)\s*$/, '').trim();
        if (!name || !NAME_RE.test(name)) return;
        const prev = found.get(cik);
        if (!prev || String(s.file_date) > prev.lastFiled) found.set(cik, { cik, name, lastFiled: String(s.file_date || ''), adsh: h._id ? String(h._id).split(':')[0] : null });
      });
    }
    if (found.size > perQuery * 4) break;
  }
  const filers = [...found.values()];
  // Jev sorts the names; anything it is unsure of stays "other"
  if (jev.configured() && filers.length) {
    for (let i = 0; i < filers.length; i += 40) {
      const batch = filers.slice(i, i + 40), qs = {};
      batch.forEach((f, k) => { qs[`f${k}`] = { type: 'choice', instructions: `What kind of investor is the 13F filer named "${f.name}"?`, criteria: KINDS }; });
      try {
        const out = await jev.ask({ note: 'Classify SEC 13F filers by their legal names.' }, qs);
        batch.forEach((f, k) => { const a = out.answers[`f${k}`] || {}; f.kind = (a.confidence || 0) >= 0.5 ? a.choice : 'other'; f.kindConfidence = a.confidence || 0; });
      } catch (e) { batch.forEach((f) => { f.kind = f.kind || 'other'; }); }
    }
  }
  return filers;
}

/* ------------------------------------------------------------- holdings */
const pad = (cik) => String(cik).padStart(10, '0');

async function filings(cik, n = 2) {
  const j = await sec(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`);
  const r = j.filings.recent, out = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    if (r.form[i] === '13F-HR' || r.form[i] === '13F-HR/A' && !out.length) {
      if (r.form[i] !== '13F-HR') continue;
      out.push({ accession: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] });
    }
  }
  return { name: j.name, filings: out };
}

const tagv = (xml, t) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${t}>([^<]*)</(?:\\w+:)?${t}>`, 'i')); return m ? m[1].trim() : ''; };

async function infoTable(cik, accession) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}`;
  const idx = await sec(`${dir}/index.json`);
  const xmls = idx.directory.item.filter((it) => /\.xml$/i.test(it.name) && !/primary_doc/i.test(it.name));
  if (!xmls.length) throw new Error('no information table in ' + accession);
  const xml = await sec(`${dir}/${xmls.sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0].name}`, { json: false });
  const rows = [];
  for (const block of xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/gi) || []) {
    rows.push({ issuer: tagv(block, 'nameOfIssuer'), cls: tagv(block, 'titleOfClass'), cusip: tagv(block, 'cusip').toUpperCase(),
      value: Number(tagv(block, 'value')) || 0, shares: Number(tagv(block, 'sshPrnamt')) || 0, putCall: tagv(block, 'putCall') || null });
  }
  // Since 2023 values are in dollars, but some filers still report thousands: if the
  // median implied share price is under a dollar, the column is in thousands.
  const px = rows.filter((r) => r.shares > 0 && !r.putCall && r.value > 0).map((r) => r.value / r.shares).sort((x, y) => x - y);
  if (px.length && px[Math.floor(px.length / 2)] < 1) for (const r of rows) r.value *= 1000;
  return rows;
}

/** Positions merged by CUSIP (options kept apart), largest first. Values are dollars. */
function merge(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.cusip + (r.putCall ? ':' + r.putCall : '');
    const p = by.get(k) || { ...r, value: 0, shares: 0 };
    p.value += r.value; p.shares += r.shares; by.set(k, p);
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

async function holdings(cik) {
  const f = await filings(cik, 2);
  if (!f.filings.length) throw new Error('no 13F-HR filings for CIK ' + cik);
  const now = merge(await infoTable(cik, f.filings[0].accession));
  let before = [];
  if (f.filings[1]) { try { before = merge(await infoTable(cik, f.filings[1].accession)); } catch (_) { before = []; } }
  return { cik: String(cik), name: f.name, filing: f.filings[0], previous: f.filings[1] || null, positions: now, before };
}

/* ------------------------------------------------------------- exposure */
// CUSIPs of common names, so a fund's line can be matched to a ticker the engine knows.
const CUSIP_TICKER = {
  '037833100': 'AAPL', '594918104': 'MSFT', '67066G104': 'NVDA', '023135106': 'AMZN', '02079K305': 'GOOGL', '02079K107': 'GOOG',
  '30303M102': 'META', '88160R101': 'TSLA', '11135F101': 'AVGO', '46625H100': 'JPM', '084670702': 'BRK.B', '78462F103': 'SPY',
  '46090E103': 'QQQ', '464287432': 'TLT', '756109104': 'O', '30231G102': 'XOM', '166764100': 'CVX', '931142103': 'WMT',
  '742718109': 'PG', '478160104': 'JNJ', '191216100': 'KO', '713448108': 'PEP', '22160K105': 'COST', '060505104': 'BAC',
  '949746101': 'WFC', '38141G104': 'GS', '617446448': 'MS', '808513105': 'SCHW', '65339F101': 'NEE', '922908769': 'VTI',
  '922908363': 'VOO', '464287655': 'IWM', '464287200': 'IVV', '64110L106': 'NFLX', '007903107': 'AMD', '69608A108': 'PLTR',
  '78463V107': 'GLD', '464287226': 'AGG', '921937835': 'BND', '57636Q104': 'MA', '92826C839': 'V', '91324P102': 'UNH',
  '532457108': 'LLY', '00287Y109': 'ABBV', '58933Y105': 'MRK', '17275R102': 'CSCO', '68389X105': 'ORCL', '79466L302': 'CRM',
  '458140100': 'INTC', '747525103': 'QCOM', '882508104': 'TXN', '00724F101': 'ADBE', '46120E602': 'ISRG', '20825C104': 'COP',
  '172967424': 'C', '58155Q103': 'MCK', '580135101': 'MCD', '437076102': 'HD', '254687106': 'DIS', '20030N101': 'CMCSA',
};
// When a name is not in the table, a few words in the issuer name are enough for a bucket.
function bucketByName(issuer, cls) {
  const s = `${issuer} ${cls}`.toUpperCase();
  if (/TREAS|20\+ YR|LONG.?TERM.*BOND|LONG TREAS/.test(s)) return 'long_bond';
  if (/BOND|AGGREGATE|FIXED INC|INCOME FD|MUNI/.test(s)) return 'aggregate_bond';
  if (/GOLD|PRECIOUS/.test(s)) return 'gold';
  if (/REIT|REALTY|PROPERT|UTILIT|POWER|ELEC|ENERGY TRANS|WATER/.test(s)) return 'rate_sensitive_equity';
  if (/BANK|BANCORP|FINANCIAL|CAPITAL ONE|INSUR|ASSURANCE|TRUST CO|SECURITIES|CREDIT/.test(s)) return 'financials';
  if (/OIL|PETROL|ENERGY|EXPLOR|GAS|MIDSTREAM/.test(s)) return 'energy';
  if (/SEMICOND|MICRO DEVICES|NVIDIA|TESLA|SOFTWARE|CLOUD|CYBER/.test(s)) return 'high_beta_tech';
  if (/PHARM|HEALTH|MEDIC|THERAP|BIO|FOODS|BEVERAGE|CONSUMER STAPLE|PROCTER|COCA|PEPSI|WALMART|COSTCO|TOBACCO/.test(s)) return 'defensive';
  if (/S&P 500|TOTAL STOCK|TOTAL MKT|CORE S&P|500 ETF|INDEX FD/.test(s)) return 'broad_equity';
  if (/RUSSELL 2000|SMALL.?CAP/.test(s)) return 'small_cap';
  if (/TECH|INTERNET|PLATFORMS|ALPHABET|AMAZON|MICROSOFT|APPLE|META|NASDAQ/.test(s)) return 'growth_tech';
  return null;
}
function tagPositions(positions) {
  return positions.filter((p) => !p.putCall).map((p) => {
    const ticker = CUSIP_TICKER[p.cusip] || null;
    const bucket = (ticker && engine.bucketOf(ticker)) || bucketByName(p.issuer, p.cls) || 'other';
    return { ...p, ticker, bucket };
  });
}

/**
 * How far each release's tails would move a book, in percent of the book: the same
 * engine buckets and kernels used for the user's own holdings.
 */
function exposure(book, signals) {
  const total = book.reduce((s, p) => s + p.value, 0) || 1;
  const out = {};
  for (const sig of signals) {
    if (!sig.tails || !sig.kernels) continue;
    const row = {};
    for (const [side, t] of Object.entries(sig.tails)) {
      const dollars = book.reduce((s, p) => s + p.value * engine.movePerZ(p.bucket, sig.kernels) * t.z / 100, 0);
      row[side] = { pct: Math.round(dollars / total * 10000) / 100, dollars: Math.round(dollars) };
    }
    out[sig.id] = row;
  }
  return out;
}

/** What changed since the previous filing, by CUSIP: added, trimmed, new, sold out. */
function changes(now, before, top = 12) {
  const prev = new Map(before.filter((p) => !p.putCall).map((p) => [p.cusip, p]));
  const cur = new Map(now.filter((p) => !p.putCall).map((p) => [p.cusip, p]));
  const rows = [];
  for (const [c, p] of cur) {
    const b = prev.get(c);
    rows.push({ issuer: p.issuer, cusip: c, ticker: CUSIP_TICKER[c] || null, value: p.value, shares: p.shares,
      shareChange: b ? p.shares - b.shares : p.shares, isNew: !b });
  }
  for (const [c, b] of prev) if (!cur.has(c)) rows.push({ issuer: b.issuer, cusip: c, ticker: CUSIP_TICKER[c] || null, value: 0, shares: 0, shareChange: -b.shares, soldOut: true, priorValue: b.value });
  const moved = rows.filter((r) => r.shareChange !== 0);
  const scale = (r) => Math.abs(r.shareChange) * ((r.value || r.priorValue || 0) / Math.max(1, r.shares || Math.abs(r.shareChange)));
  return moved.sort((a, b) => scale(b) - scale(a)).slice(0, top);
}

module.exports = { discover, holdings, tagPositions, exposure, changes, CUSIP_TICKER, KINDS, __test: { merge, bucketByName } };
