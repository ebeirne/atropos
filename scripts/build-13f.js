// Build the 13F benchmark: every public pension (state and municipal) and public
// university fund that discovery finds, its latest 13F and the one before, holdings
// sorted into the engine's buckets (Jev for names the tables do not know).
//   node scripts/build-13f.js            -> data/funds.json and public/funds.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const t = require('../lib/thirteenf');
const jev = require('../lib/jev');

const KEEP = new Set(['state_pension', 'municipal_pension', 'public_university']);
const CACHE = path.join(__dirname, '..', 'data', 'issuer-buckets.json');

(async () => {
  let filers;
  try { filers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'filers.json'), 'utf8')); }
  catch (_) { filers = await t.discover(); fs.writeFileSync(path.join(__dirname, '..', 'data', 'filers.json'), JSON.stringify(filers, null, 1)); }
  // US public money only: foreign national pensions are not state or municipal funds
  filers = filers.filter((f) => KEEP.has(f.kind) && !/SWEDISH|AP-FONDEN|PUBLIC SECTOR PENSION INVESTMENT BOARD|CANADA|ONTARIO|QUEBEC/i.test(f.name));
  console.log(filers.length, 'public filers');
  const issuerBuckets = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const funds = [], left = [];
  for (const f of filers) {
    try {
      const h = await t.holdings(f.cik);
      let tagged = t.tagPositions(h.positions);
      // the largest unknown names, sorted by Jev once and remembered
      const unknown = tagged.filter((p) => p.bucket === 'other' && !issuerBuckets[p.cusip]).slice(0, 30);
      if (unknown.length && jev.configured()) {
        try {
          const r = await jev.classify(unknown.map((p) => ({ symbol: p.cusip, description: `${p.issuer} ${p.cls}`.trim() })));
          for (const p of unknown) issuerBuckets[p.cusip] = (r.buckets[p.cusip] || {}).bucket || 'other';
        } catch (e) { console.log('  jev classify skipped:', e.message); }
      }
      tagged = tagged.map((p) => (p.bucket === 'other' && issuerBuckets[p.cusip] ? { ...p, bucket: issuerBuckets[p.cusip] } : p));
      const total = tagged.reduce((s, p) => s + p.value, 0);
      const bucketValues = {};
      for (const p of tagged) bucketValues[p.bucket] = (bucketValues[p.bucket] || 0) + p.value;
      const classified = total - (bucketValues.other || 0);
      const before = new Map(h.before.filter((p) => !p.putCall).map((p) => [p.cusip, p]));
      const tickers = {};
      for (const p of tagged) if (p.ticker) {
        const b = before.get(p.cusip);
        tickers[p.ticker] = { value: p.value, shares: p.shares, shareChange: b ? p.shares - b.shares : p.shares };
      }
      if (tagged.length < 5 || total < 50e6) { console.log(`  thin  ${(h.name || f.name).slice(0, 52)}: ${tagged.length} positions, left out`); left.push({ name: h.name || f.name, reason: 'fewer than 5 disclosed positions or under $50M' }); continue; }
      // the largest US public pension discloses about $180B; a book far above that means the filing's units are off
      if (total > 300e9) { console.log(`  units ${(h.name || f.name).slice(0, 52)}: ${(total / 1e9).toFixed(0)}B does not add up, left out`); left.push({ name: h.name || f.name, reason: 'reported values and share counts do not add up' }); continue; }
      funds.push({ cik: f.cik, name: h.name || f.name, kind: f.kind, period: h.filing.period, filed: h.filing.filed, total,
        positions: tagged.length, coverage: Math.round(classified / (total || 1) * 1000) / 1000, bucketValues,
        top: tagged.slice(0, 8).map((p) => ({ issuer: p.issuer, ticker: p.ticker, value: p.value, bucket: p.bucket })),
        changes: t.changes(h.positions, h.before, 6), tickers });
      console.log(`  ${f.kind.padEnd(18)} ${(h.name || f.name).slice(0, 52).padEnd(52)} $${(total / 1e9).toFixed(1)}B  ${tagged.length} pos  coverage ${(classified / (total || 1) * 100).toFixed(0)}%`);
    } catch (e) { console.log(`  skip ${f.name}: ${e.message}`); }
  }
  fs.writeFileSync(CACHE, JSON.stringify(issuerBuckets, null, 1));
  const out = { builtAt: new Date().toISOString(), source: 'SEC EDGAR 13F-HR information tables', funds, leftOut: left };
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'funds.json'), JSON.stringify(out));
  console.log('wrote data/funds.json:', funds.length, 'funds');
})().catch((e) => { console.error(e.message); process.exit(1); });
