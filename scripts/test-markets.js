// Parser tests against Kalshi-shaped market lists, since the live API is not
// reachable from every network. Covers the two continuous formats and a thin
// market that contradicts itself.
const assert = require('assert');
const { continuousFromMarkets, isotonicDecreasing } = require('../lib/markets');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok  ', name); }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

t('isotonic leaves a clean survival curve alone', () => {
  assert.deepStrictEqual(isotonicDecreasing([0.9, 0.6, 0.3, 0.1]), [0.9, 0.6, 0.3, 0.1]);
});

t('isotonic pools a violation ("above 3.2" priced over "above 3.0")', () => {
  const out = isotonicDecreasing([0.80, 0.40, 0.46, 0.10]);
  assert.ok(close(out[1], 0.43) && close(out[2], 0.43), JSON.stringify(out));
  for (let i = 1; i < out.length; i++) assert.ok(out[i] <= out[i - 1] + 1e-12);
});

t('threshold markets become a distribution that sums to 1', () => {
  const ms = [2.8, 3.0, 3.2, 3.4].map((k, i) => ({
    strike_type: 'greater', floor_strike: k,
    yes_bid: [80, 40, 44, 8][i], yes_ask: [82, 42, 48, 10][i],      // 3.2 contradicts 3.0
  }));
  const d = continuousFromMarkets(ms, 2);
  assert.strictEqual(d.method, 'thresholds');
  assert.strictEqual(d.monotoneFixes, 2);
  assert.ok(close(d.p.reduce((a, b) => a + b, 0), 1));
  assert.ok(d.p.every((x) => x >= 0));
  assert.strictEqual(d.labels[0], 'under 2.8');
  assert.strictEqual(d.labels[d.labels.length - 1], 'over 3.4');
  assert.strictEqual(d.edges.length, d.p.length + 1);
});

t('bracket markets keep their overround and normalise it away', () => {
  const ms = [
    { strike_type: 'less', cap_strike: 2.6, yes_bid_dollars: '0.0400', yes_ask_dollars: '0.0500' },
    { strike_type: 'between', floor_strike: 2.6, cap_strike: 2.8, yes_bid: 10, yes_ask: 12 },
    { strike_type: 'between', floor_strike: 2.8, cap_strike: 3.0, yes_bid: 28, yes_ask: 30 },
    { strike_type: 'between', floor_strike: 3.0, cap_strike: 3.2, yes_bid: 33, yes_ask: 35 },
    { strike_type: 'between', floor_strike: 3.2, cap_strike: 3.4, yes_bid: 16, yes_ask: 18 },
    { strike_type: 'greater', floor_strike: 3.4, yes_bid: 7, yes_ask: 9 },
  ];
  const d = continuousFromMarkets(ms, 2);
  assert.strictEqual(d.method, 'brackets');
  assert.strictEqual(d.p.length, 6);
  assert.ok(d.overround > 0, 'overround ' + d.overround);
  assert.ok(close(d.p.reduce((a, b) => a + b, 0), 1));
  assert.ok(close(d.edges[0], 2.4) && close(d.edges[6], 3.6), JSON.stringify(d.edges));
});

t('markets without prices are ignored, too few means no distribution', () => {
  const d = continuousFromMarkets([{ strike_type: 'greater', floor_strike: 3 }, { strike_type: 'greater', floor_strike: 3.2 }], 2);
  assert.strictEqual(d, null);
});

// Fed outcomes map by title.
const markets = require('../lib/markets');
const discrete = markets.__test && markets.__test.discreteFromMarkets;
if (discrete) {
  t('Fed outcomes map by title, order cut-big / cut-25 / hold / hike', () => {
    const d = discrete([
      { title: 'Fed cuts rates by 25bps', yes_bid: 60, yes_ask: 62 },
      { title: 'Fed maintains rates', yes_bid: 34, yes_ask: 36 },
      { title: 'Fed cuts by more than 25bps', yes_bid: 2, yes_ask: 4 },
      { title: 'Fed hikes rates', yes_bid: 0, yes_ask: 2 },
    ]);
    assert.deepStrictEqual(d.labels, ['Cut 0.50+', 'Cut 0.25', 'Hold', 'Hike']);
    assert.ok(d.p[1] > 0.55 && d.p[2] > 0.3 && d.p[0] > 0.01, JSON.stringify(d.p));
  });
}
console.log(`\n${pass} passed`);
