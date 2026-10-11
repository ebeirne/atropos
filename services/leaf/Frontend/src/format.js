const dash = '–';

export const num = (v, d = 2) => (v == null ? dash : Number(v).toFixed(d));
export const pval = (v) => (v == null ? dash : v < 0.001 ? '<0.001' : Number(v).toFixed(3));
export const days = (v) => (v == null ? 'never' : v >= 100 ? '100+ d' : `${Number(v).toFixed(1)} d`);
export const signed = (v) => (v == null ? dash : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`);
export const percent = (v) => (v == null ? dash : `${Math.round(v * 100)}%`);

export const monthYear = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

// Plain names for the requirement keys.
export const REQ_LABELS = {
  coint_p: 'Cointegration p',
  half_life: 'Half-life',
  corr: 'Correlation',
  hedge_effectiveness: 'Variance cut',
};

export const prettyReq = (s) => s.replace('<=', '≤').replace('>=', '≥');

// Which numbers matter most for each strategy, in reading order (used by the screener table).
export const COLUMNS = {
  mean_reversion: [
    { key: 'coint_p', label: 'Coint. p', fmt: pval },
    { key: 'half_life', label: 'Half-life', fmt: days },
    { key: 'zscore', label: 'Z now', fmt: signed, signal: true },
  ],
  arbitrage: [
    { key: 'coint_p', label: 'Coint. p', fmt: pval },
    { key: 'half_life', label: 'Half-life', fmt: days },
    { key: 'corr', label: 'Corr', fmt: (v) => num(v, 2) },
  ],
  hedging: [
    { key: 'corr', label: 'Corr', fmt: (v) => num(v, 2) },
    { key: 'return_beta', label: 'Hedge ratio', fmt: (v) => num(v, 2) },
    { key: 'hedge_effectiveness', label: 'Variance cut', fmt: percent },
  ],
};

export const DEFAULT_COLUMNS = [
  { key: 'corr', label: 'Corr', fmt: (v) => num(v, 2) },
  { key: 'coint_p', label: 'Coint. p', fmt: pval },
  { key: 'half_life', label: 'Half-life', fmt: days },
];

// Every statistic shown in a pair's detail panel.
export const DETAIL_STATS = [
  ['Correlation (daily returns)', 'corr', (v) => num(v, 3)],
  ['Cointegration p-value', 'coint_p', pval],
  ['Half-life of the spread', 'half_life', days],
  ['Z-score now', 'zscore', signed],
  ['Hedge ratio (log prices)', 'hedge_ratio', (v) => num(v, 3)],
  ['Hedge ratio (returns)', 'return_beta', (v) => num(v, 3)],
  ['Variance cut by hedging', 'hedge_effectiveness', percent],
  ['Spread std (log)', 'spread_std', (v) => num(v, 4)],
  ['Volatility, first name', 'vol_a', percent],
  ['Volatility, second name', 'vol_b', percent],
];