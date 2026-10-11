// SAMPLE DATA, frontend only. Lets the Screener be built and clicked through with no backend.
// Shapes match the API contract, so a real backend can replace this later without UI changes.
// Names (CO1A, HC2B ...) are made up; none of these numbers describe real securities.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function lastWeekdays(n) {
  const out = [];
  const d = new Date();
  while (out.length < n) {
    if (d.getDay() % 6 !== 0) out.unshift(d.toISOString().slice(0, 10)); // skip Sat and Sun
    d.setDate(d.getDate() - 1);
  }
  return out;
}

// Two price series rebased to 100, plus the spread z-score. theta = how fast the spread reverts.
function makeSeries(seed, theta, n = 120) {
  const r = rng(seed);
  let x = 0;
  let s = 0;
  const base = [];
  const spread = [];
  for (let i = 0; i < n; i += 1) {
    x += gauss(r) * 0.012;
    s = s * (1 - theta) + gauss(r) * 0.01;
    base.push(x);
    spread.push(s);
  }
  const mean = spread.reduce((p, q) => p + q, 0) / n;
  const sd = Math.sqrt(spread.reduce((p, q) => p + (q - mean) ** 2, 0) / n) || 1;
  return {
    dates: lastWeekdays(n),
    a: base.map((v) => +(100 * Math.exp(v - base[0])).toFixed(2)),
    b: base.map((v, i) => +(100 * Math.exp(0.8 * (v - base[0]) + spread[i] - spread[0])).toFixed(2)),
    z: spread.map((v) => +((v - mean) / sd).toFixed(3)),
  };
}

const PAIRS = {
  CO1: { a: 'CO1A', b: 'CO1B', seed: 11, theta: 0.15, stats: { corr: 0.666, coint_p: 0.0001, half_life: 5.77, zscore: 0.21, hedge_ratio: 1.19, return_beta: 0.56, hedge_effectiveness: 0.44, spread_std: 0.0312, vol_a: 0.19, vol_b: 0.21 } },
  CO2: { a: 'CO2A', b: 'CO2B', seed: 22, theta: 0.05, stats: { corr: 0.658, coint_p: 0.003, half_life: 14.22, zscore: -1.79, hedge_ratio: 1.225, return_beta: 0.554, hedge_effectiveness: 0.43, spread_std: 0.0407, vol_a: 0.19, vol_b: 0.22 } },
  HC1: { a: 'HC1A', b: 'HC1B', seed: 33, theta: 0.005, stats: { corr: -0.774, coint_p: 0.937, half_life: 274.26, zscore: 1.0, hedge_ratio: -0.98, return_beta: -0.86, hedge_effectiveness: 0.6, spread_std: 0.0991, vol_a: 0.2, vol_b: 0.21 } },
  HC2: { a: 'HC2A', b: 'HC2B', seed: 44, theta: 0.05, stats: { corr: 0.822, coint_p: 0.017, half_life: 21.68, zscore: 1.36, hedge_ratio: 0.94, return_beta: 0.81, hedge_effectiveness: 0.68, spread_std: 0.0524, vol_a: 0.18, vol_b: 0.19 } },
};

// Which pairs each strategy keeps, with a fit score out of 100.
const BY_STRATEGY = {
  mean_reversion: [['CO2', 85.3], ['CO1', 72.1], ['HC2', 69.6]],
  arbitrage: [['CO1', 90.0], ['CO2', 80.1]],
  hedging: [['HC1', 52.1]],
};

const EXPLANATIONS = {
  mean_reversion:
    'Sample reading. CO2A/CO2B has the strongest case: its spread is cointegrated, reverts in about two weeks, and sits near the lower entry band. CO1A/CO1B reverts faster but is close to its mean, so there is no entry signal yet. HC2A/HC2B passes the tests but is slower, and its cointegration is weaker.',
  arbitrage:
    'Sample reading. CO1A/CO1B is the cleanest fit: a very strong cointegration result and a half-life under a week, which suits high turnover. CO2A/CO2B also qualifies but reverts more slowly, so each trade ties up capital longer.',
  hedging:
    'Sample reading. HC1A/HC1B moves in opposite directions day to day and is not cointegrated, so one leg offsets the other: it is a hedge, not a pairs trade. Holding both removes roughly 60 percent of the variance of the first leg.',
};

function buildPair(id, score) {
  const p = PAIRS[id];
  return { a: p.a, b: p.b, score, ...p.stats, series: makeSeries(p.seed, p.theta) };
}

export function sampleScan({ strategies, tickers }) {
  const out = {};
  strategies.forEach((key) => {
    out[key] = {
      explanation: EXPLANATIONS[key] || '',
      results: (BY_STRATEGY[key] || []).map(([id, score]) => buildPair(id, score)),
    };
  });
  return { sample: true, universe_size: tickers?.length || 12, pairs_screened: 4, strategies: out };
}