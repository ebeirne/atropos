// FedWatch two-point split, and a live read when the network allows it.
const assert = require('assert');
const { bucketsFromSteps, contractFor, oddsForMeeting } = require('../lib/fedfutures');
const close = (a, b) => Math.abs(a - b) < 1e-9;
let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok  ', n); };

t('+4.5bp is 18% hike, 82% hold', () => { const p = bucketsFromSteps(4.5 / 25); assert.ok(close(p[2], 0.82) && close(p[3], 0.18), JSON.stringify(p)); });
t('-30bp is 80% cut 25, 20% cut 50+', () => { const p = bucketsFromSteps(-30 / 25); assert.ok(close(p[1], 0.8) && close(p[0], 0.2), JSON.stringify(p)); });
t('no change is all hold', () => { assert.deepStrictEqual(bucketsFromSteps(0), [0, 0, 1, 0]); });
t('contract codes', () => { assert.strictEqual(contractFor(2026, 10), 'ZQX26.CBT'); assert.strictEqual(contractFor(2027, 0), 'ZQF27.CBT'); });
console.log(`\n${pass} passed`);

oddsForMeeting('2026-10-28').then((r) => {
  console.log(`live: EFFR ${r.rPre}% -> post ${r.rPost}% via ${r.method}: ${r.deltaBp}bp ->`,
    ['cut50+', 'cut25', 'hold', 'hike'].map((k, i) => `${k} ${Math.round(r.probs[i] * 1000) / 10}%`).join(' '));
}).catch((e) => console.log('live read skipped:', e.message));
