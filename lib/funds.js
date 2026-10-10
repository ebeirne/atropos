// The benchmark: public pensions (state and municipal) and public university
// endowments, from their latest 13F, measured for exposure to this week's releases
// with the same model as the user's own holdings. Built offline by
// scripts/build-13f.js into data/funds.json (13F only shows US-listed equities and
// ETFs, so this is "disclosed equity exposure as of the filing", never total risk).

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

const FILE = path.join(__dirname, '..', 'data', 'funds.json');
const KIND_LABEL = { state_pension: 'State pensions', municipal_pension: 'Municipal pensions', public_university: 'Public universities' };

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return null; }
}

/** Percent move of a book (value by bucket) at each tail of each release. */
function bookExposure(bucketValues, signals) {
  const total = Object.values(bucketValues).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const sig of signals) {
    if (!sig.tails || !sig.kernels) continue;
    out[sig.id] = {};
    for (const [side, t] of Object.entries(sig.tails)) {
      let d = 0;
      for (const [b, v] of Object.entries(bucketValues)) d += v * engine.movePerZ(b, sig.kernels) * t.z / 100;
      out[sig.id][side] = Math.round(d / total * 10000) / 100;
    }
  }
  return out;
}

async function benchmark(signals, tickersCsv) {
  const data = load();
  if (!data) return { ready: false, note: 'Run node scripts/build-13f.js to build the 13F benchmark.' };
  const funds = data.funds.map((f) => ({ cik: f.cik, name: f.name, kind: f.kind, period: f.period, filed: f.filed, total: f.total,
    positions: f.positions, coverage: f.coverage, top: f.top, changes: f.changes, exposure: bookExposure(f.bucketValues, signals) }));
  // the average of each kind, weighted by size
  const kinds = {};
  for (const f of data.funds) {
    const k = kinds[f.kind] || (kinds[f.kind] = { kind: f.kind, label: KIND_LABEL[f.kind] || f.kind, count: 0, total: 0, bucketValues: {} });
    k.count++; k.total += f.total;
    for (const [b, v] of Object.entries(f.bucketValues)) k.bucketValues[b] = (k.bucketValues[b] || 0) + v;
  }
  const byKind = Object.values(kinds).map((k) => ({ kind: k.kind, label: k.label, count: k.count, total: k.total, exposure: bookExposure(k.bucketValues, signals) }));
  // who holds the user's tickers, and what they did last quarter
  const want = String(tickersCsv || '').toUpperCase().split(',').map((t) => t.trim()).filter(Boolean);
  const holders = want.map((t) => {
    const rows = data.funds.map((f) => ({ name: f.name, kind: f.kind, ...(f.tickers[t] || {}) })).filter((r) => r.value);
    return { ticker: t, funds: rows.length, value: rows.reduce((s, r) => s + r.value, 0), shareChange: rows.reduce((s, r) => s + (r.shareChange || 0), 0),
      added: rows.filter((r) => r.shareChange > 0).length, cut: rows.filter((r) => r.shareChange < 0).length,
      biggest: rows.sort((a, b) => b.value - a.value).slice(0, 3).map((r) => ({ name: r.name, value: r.value, shareChange: r.shareChange })) };
  });
  return { ready: true, builtAt: data.builtAt, note: '13F shows US-listed stocks and ETFs only, as of each filing date.', funds, byKind, holders, leftOut: data.leftOut || [] };
}

module.exports = { benchmark, bookExposure, load };
