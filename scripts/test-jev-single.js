// Same correct order text, asked alone (as the pipeline did) versus split into
// its four parts in one call. Five runs each.
const fs = require('fs');
const path = require('path');
require('../lib/env').load(path.join(__dirname, '..', '.env'));
const jev = require('../lib/jev');

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'last-run.json'), 'utf8'));
const x = run.orders[0], o = x.order;
const numbers = {
  underlying: o.underlying, legs: o.legs, limitPerShare: o.limitPerShare, maxDebitPerShare: o.maxDebitPerShare,
  premiumAtRisk: o.premiumAtRisk, maxPayout: o.maxPayout, eventName: o.eventName, eventDate: o.eventDate,
  tail: o.tail, covers: o.covers.map((c) => c.holding),
};
const whole = `${x.headline} ${x.rationale} ${x.risk} ${x.invalidation}`;

(async () => {
  const single = [], split = [];
  for (let i = 0; i < 5; i++) {
    const a = await jev.checkRationales([{ id: o.id, text: whole, numbers }]);
    single.push(a.checks[o.id]);
    const parts = ['headline', 'rationale', 'risk', 'invalidation'].map((k) => ({ id: `${o.id}#${k}`, text: x[k], numbers }));
    const b = await jev.checkRationales(parts);
    split.push(Math.min(...parts.map((p) => b.checks[p.id])));
  }
  console.log('alone, whole text :', single.join('  '));
  console.log('split, min of four:', split.join('  '));
})().catch((e) => { console.error(e.message); process.exit(1); });
