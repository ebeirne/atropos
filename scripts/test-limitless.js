// Limitless parsing against the shapes its API returned on 2026-10-09:
// percent brackets with "<=" / ">=" ends, and Fed outcomes where two books
// were empty (bid 0.001, ask 0.998) and quoted a meaningless 50c mid.
const assert = require('assert');
const { __test: { quote, bracketsFromChildren, outcomesFromChildren } } = require('../lib/limitless');
const markets = require('../lib/markets');

const child = (title, mid, ask, bid, vol = '0') => ({
  title, prices: [mid, 1 - mid], tradePrices: { buy: { market: [ask, 1 - bid], limit: [bid, 1 - ask] } }, volumeFormatted: vol,
});
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  ', name); };

t('an empty book is read at its bid, not its 50c mid', () => {
  const q = quote(child('50+ bps decrease', 0.4995, 0.998, 0.001));
  assert.strictEqual(q.empty, true);
  assert.strictEqual(q.price, 0.001);
});

t('a quoted book is read at its mid', () => {
  const q = quote(child('3.6%', 0.47, 0.5, 0.44, '19.14'));
  assert.strictEqual(q.empty, false);
  assert.strictEqual(q.price, 0.47);
  assert.ok(Math.abs(q.spread - 0.06) < 1e-9);
});

t('percent brackets with open ends become a distribution', () => {
  const titles = ['≤2.9%', '3.0%', '3.1%', '3.2%', '3.3%', '3.4%', '3.5%', '3.6%', '3.7%', '3.8%', '3.9%', '≥4.0%'];
  const mids = [0.0055, 0.0055, 0.005, 0.0055, 0.0105, 0.04, 0.115, 0.47, 0.3, 0.0675, 0.01, 0.0255];
  const d = bracketsFromChildren(titles.map((x, i) => child(x, mids[i], mids[i] + 0.02, Math.max(0, mids[i] - 0.02), i === 7 ? '19.14' : i === 8 ? '65.36' : '0')));
  assert.strictEqual(d.p.length, 12);
  assert.strictEqual(d.edges.length, 13);
  assert.ok(Math.abs(d.edges[1] - 2.95) < 1e-9 && Math.abs(d.edges[12] - 4.05) < 1e-9, JSON.stringify(d.edges));
  assert.ok(Math.abs(d.p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(d.overround > 5 && d.overround < 7, 'overround ' + d.overround);
  assert.ok(Math.abs(d.depth.volume - 84.5) < 0.01);
});

t('Fed outcomes: empty books do not inflate the total to 200%', () => {
  const kids = [
    child('50+ bps decrease', 0.4995, 0.998, 0.001), child('25 bps decrease', 0.4995, 0.998, 0.001),
    child('No change', 0.835, 0.855, 0.815), child('25 bps increase', 0.155, 0.175, 0.135), child('50+ bps increase', 0.008, 0.015, 0.001),
  ];
  const buckets = markets.__test.FED_BUCKETS;
  const d = outcomesFromChildren(kids, buckets);
  assert.deepStrictEqual(d.labels, ['Cut 0.50+', 'Cut 0.25', 'Hold', 'Hike']);
  assert.ok(Math.abs(d.overround) < 1, 'overround ' + d.overround);
  assert.ok(d.p[2] > 0.8 && d.p[3] > 0.15 && d.p[0] < 0.01 && d.p[1] < 0.01, JSON.stringify(d.p));
  assert.strictEqual(d.depth.emptyBooks, 2);
});
console.log(`\n${pass} passed`);
