// Headless run of the full pipeline. `--sample` forces the sample portfolio and
// the market snapshot; `--json` dumps the raw result to data/last-run.json.
const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../server');

const sample = process.argv.includes('--sample');
const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString('en-US');

(async () => {
  const t0 = Date.now();
  const r = await runPipeline({ forceSample: sample });
  console.log(`portfolio: ${r.portfolio.source}${r.portfolio.reason ? ' (' + r.portfolio.reason + ')' : ''}`);
  console.log(`markets:   ${r.meta.marketSources.join(', ')}`);
  console.log(`composer:  ${r.meta.composer}${r.meta.composeError ? '  ERROR ' + r.meta.composeError : ''}`);
  console.log(`timings:   ${JSON.stringify(r.meta.timings)}  total ${Date.now() - t0}ms`);
  for (const k of ['classifyError', 'checkError']) if (r.meta[k]) console.log(k, r.meta[k]);

  console.log('\nSIGNALS');
  for (const s of r.signals) console.log(`  ${s.id.padEnd(5)} ${s.verdict.padEnd(9)} ${s.notes.join(' | ')}`);
  for (const s of r.skipped) console.log(`  skipped ${s.event}: ${s.reason}`);

  console.log('\nSUMMARY  ' + r.summary);
  console.log('\nORDERS');
  for (const x of r.orders) {
    const o = x.order;
    console.log(`  [${x.decision.toUpperCase()}] ${o.legs.map((l) => `${l.action} ${l.qty} ${o.underlying} ${l.expiry} ${l.strike}${l.type[0].toUpperCase()}`).join(' / ')}`);
    console.log(`     limit $${o.limitPerShare}/sh  max $${o.maxDebitPerShare}/sh  at risk ${money(o.premiumAtRisk)}  ` +
      `max pay ${money(o.maxPayout)}  EV ${money(o.expectedValue)}  ${o.budgetShare}% of ${money(o.exposedNotional)} exposed  ` +
      `price=${x.priceSource}${x.check ? '  jev=' + x.check.consistent : ''}`);
    console.log(`     covers ${o.covers.map((c) => `${c.holding} ${Math.round(c.share * 100)}%`).join(', ')}`);
    console.log(`     ${x.headline}`);
  }
  console.log('\nHOLDINGS');
  for (const h of r.holdings) {
    const imp = h.impacts.map((i) => `${i.event} ${money(i.low.dollars)}/${money(i.high.dollars)}`).join('  ');
    const e = h.tailEdge;
    console.log(`  ${h.decision.padEnd(8)} ${h.holding.padEnd(5)} ${money(h.position.value).padStart(8)}  ` +
      `edge ${e ? money(e.dollars).padStart(6) + ' (' + e.word + ' ' + e.event + ')' : '-'}  [${imp}]`);
    console.log(`           ${h.headline}`);
    console.log(`           ${h.note}`);
  }
  if (process.argv.includes('--json')) {
    const out = path.join(__dirname, '..', 'data', 'last-run.json');
    fs.writeFileSync(out, JSON.stringify(r, null, 2));
    console.log('\nwrote', out);
  }
})().catch((e) => { console.error(e); process.exit(1); });
