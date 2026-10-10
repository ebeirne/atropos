// How stable is Jev's consistency score on the real order text, and does
// checking it in smaller parts help? Uses the order from data/last-run.json.
const fs = require('fs');
const path = require('path');
require('../lib/env').load(path.join(__dirname, '..', '.env'));
const jev = require('../lib/jev');

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'last-run.json'), 'utf8'));
const x = run.orders[0];
const o = x.order;
const numbers = {
  underlying: o.underlying, legs: o.legs, limitPerShare: o.limitPerShare, maxDebitPerShare: o.maxDebitPerShare,
  premiumAtRisk: o.premiumAtRisk, maxPayout: o.maxPayout, eventName: o.eventName, eventDate: o.eventDate,
  tail: o.tail, covers: o.covers.map((c) => c.holding),
};
const parts = {
  headline: x.headline, rationale: x.rationale, risk: x.risk, invalidation: x.invalidation,
};
const whole = Object.values(parts).join(' ');
const wrong = whole.replace(`$${o.premiumAtRisk}`, `$${o.premiumAtRisk + 200}`).replace('670/675', '675/680');

(async () => {
  const N = 5;
  const wholeScores = [], partMins = [], wrongScores = [], wrongPartMins = [];
  for (let i = 0; i < N; i++) {
    const items = [{ id: 'whole', text: whole, numbers }, { id: 'wrong', text: wrong, numbers }];
    for (const [k, v] of Object.entries(parts)) items.push({ id: 'p_' + k, text: v, numbers });
    // the wrong version, split the same way
    const wrongParts = { headline: x.headline.replace('670/675', '675/680'), rationale: x.rationale,
      risk: x.risk.replace(`$${o.premiumAtRisk}`, `$${o.premiumAtRisk + 200}`), invalidation: x.invalidation };
    for (const [k, v] of Object.entries(wrongParts)) items.push({ id: 'w_' + k, text: v, numbers });
    const r = await jev.checkRationales(items);
    const c = r.checks;
    wholeScores.push(c.whole); wrongScores.push(c.wrong);
    partMins.push(Math.min(...Object.keys(parts).map((k) => c['p_' + k])));
    wrongPartMins.push(Math.min(...Object.keys(parts).map((k) => c['w_' + k])));
    console.log(`run ${i + 1}: whole=${c.whole}  parts=[${Object.keys(parts).map((k) => c['p_' + k]).join(', ')}]  ` +
      `wrong=${c.wrong}  wrongParts=[${Object.keys(parts).map((k) => c['w_' + k]).join(', ')}]  ${r.latency_ms}ms`);
  }
  const stat = (a) => `min ${Math.min(...a).toFixed(2)}  mean ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2)}  max ${Math.max(...a).toFixed(2)}`;
  console.log('\ncorrect, whole text    ', stat(wholeScores));
  console.log('correct, min over parts', stat(partMins));
  console.log('wrong,   whole text    ', stat(wrongScores));
  console.log('wrong,   min over parts', stat(wrongPartMins));
})().catch((e) => { console.error(e.message); process.exit(1); });
