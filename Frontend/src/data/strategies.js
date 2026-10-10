// Built-in copy of the strategy definitions, used when the Leaf API is not running.
// It mirrors app/strategies.py on the backend.
export const FALLBACK = {
  providers: ['synthetic', 'yahoo'],
  strategies: {
    mean_reversion: {
      label: 'Mean reversion',
      summary: "Trade a cointegrated pair's spread back to its mean.",
      math: [
        'Spread: S_t = ln(A_t) - alpha - beta * ln(B_t)',
        'Z-score: z_t = (S_t - mean(S)) / std(S)',
        'Half-life: -ln(2) / b, from dS_t = a + b*S_(t-1) + e',
        'Entry |z| > 2, exit |z| < 0.5',
      ],
      requires: { coint_p: '<= 0.05', half_life: '3 to 40 days', corr: '>= 0.5' },
    },
    arbitrage: {
      label: 'Statistical arbitrage',
      summary: 'Tightest, fastest-reverting cointegrated pairs; small edges, high turnover.',
      math: [
        'Same spread and z-score as mean reversion, stricter filters',
        'Edge per trade ~ |z_entry| * std(S) minus round-trip costs',
        'Prefer short half-life: turnover scales as 1 / half_life',
      ],
      requires: { coint_p: '<= 0.01', half_life: '<= 15 days', corr: '>= 0.6' },
    },
    hedging: {
      label: 'Hedging',
      summary: 'Highly correlated pairs that are NOT cointegrated: hedge direction, not the level.',
      math: [
        'Hedge ratio (return space): h = Cov(r_A, r_B) / Var(r_B)',
        'Hedged return: r_A - h * r_B',
        'Hedge effectiveness: 1 - Var(hedged) / Var(r_A) = corr^2',
      ],
      requires: { corr: '>= 0.7', coint_p: '> 0.10', hedge_effectiveness: '>= 0.5' },
    },
  },
};