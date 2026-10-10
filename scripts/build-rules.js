// Turn Kalshi's contract terms (data/rules/*.txt, from scripts/fetch_rules.py) into the
// few facts Atty needs: when trading stops, the latest a contract can settle, and what
// it settles on if the government never publishes the number. Code pulls the clauses
// out; Jev reads each fallback clause and says which kind it is.
//   node scripts/build-rules.js      -> data/rules.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const DIR = path.join(__dirname, '..', 'data', 'rules');
const FAMILY = { cpi: 'YOYCPI', nfp: 'PAYROLLS', fomc: 'FEDDECISION' };
const DELAY = { cpi: 'CPIDELAY', nfp: 'NFPDELAY' };

function sentence(t, start) {
  const i = t.indexOf(start); if (i < 0) return null;
  const rest = t.slice(i); const m = rest.match(/^.*?\.(?=\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)*:|\s+If\s|\s*$)/);
  return (m ? m[0] : rest.slice(0, 400)).trim();
}
function clause(t, label) {
  const i = t.indexOf(label + ':'); if (i < 0) return null;
  const rest = t.slice(i + label.length + 1); const j = rest.search(/\s[A-Z][A-Za-z ]{2,40}:\s/);
  return rest.slice(0, j < 0 ? 600 : j).trim();
}

(async () => {
  const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  const out = { built_at: new Date().toISOString(), source: idx.source, fetched_at: idx.fetched_at, releases: {} };
  for (const [rel, fam] of Object.entries(FAMILY)) {
    const t = fs.readFileSync(path.join(DIR, fam + '.txt'), 'utf8').replace(/�/g, '"');
    const fallback = sentence(t, 'If no data is available') || sentence(t, 'If no data is released') || null;
    out.releases[rel] = {
      family: fam, url: idx.source + fam + '.pdf',
      underlying: clause(t, 'Underlying'),
      lastTrading: clause(t, 'Last Trading Date'),
      expiration: clause(t, 'Expiration Date'),
      fallback,
      contingencies: clause(t, 'Contingencies'),
      exchangeCanReview: /Market Outcome Review/.test(t),
      delayMarket: DELAY[rel] ? { family: DELAY[rel], url: idx.source + DELAY[rel] + '.pdf' } : null,
    };
  }
  // Jev: what does each contract settle on if the number never comes out?
  if (jev.configured()) {
    const Q = {};
    for (const [rel, r] of Object.entries(out.releases)) {
      Q['fb_' + rel] = { type: 'choice', instructions: `Contract terms for the ${rel} contract. Fallback clause: "${r.fallback || '(none stated)'}". If the government never publishes the number, what value does this clause say the contract settles on?`,
        criteria: {
          formula: 'A value calculated by a stated formula from the last published data.',
          last_month: 'The last month of data that was published.',
          exchange_decides: 'The exchange decides the payout under its rulebook; no value is stated.',
          waits: 'It waits for the number, with no stated fallback.',
        } };
    }
    const avg = {};
    for (let i = 0; i < 3; i++) {
      const a = await jev.ask({ context: ['Read prediction-market contract terms literally.'] }, Q);
      for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
    }
    for (const rel of Object.keys(out.releases)) {
      const ranked = Object.entries(avg['fb_' + rel]).sort((a, b) => b[1] - a[1]);
      out.releases[rel].fallbackKind = { pick: ranked[0][0], confidence: Math.round(ranked[0][1] * 100) / 100, all: Object.fromEntries(ranked.map(([o, p]) => [o, Math.round(p * 100) / 100])) };
      console.log(rel.padEnd(5), ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
    }
  }
  for (const [rel, r] of Object.entries(out.releases)) console.log(`${rel}: trading stops: ${r.lastTrading}\n      fallback: ${r.fallback}\n`);
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'rules.json'), JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e.message); process.exit(1); });
