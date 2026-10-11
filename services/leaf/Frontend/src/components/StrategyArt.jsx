const W = 240;
const H = 92;

// For each strategy: where the first line sits, and how far the second line is from it.
const SHAPES = {
  mean_reversion: {
    base: (x) => 46 + 9 * Math.sin(x / 38),
    gap: (x) => 30 * Math.exp(-x / 80) * Math.cos(x / 15), // a gap that dies away
  },
  arbitrage: {
    base: (x) => 46 + 10 * Math.sin(x / 30) + 4 * Math.sin(x / 9),
    gap: (x) => 5 * Math.cos(x / 5), // always tight, opens and shuts fast
  },
  hedging: {
    base: (x) => 46 + 14 * Math.sin(x / 34) + 6 * Math.sin(x / 11),
    gap: (x) => 16 + 2 * Math.sin(x / 17), // constant offset: moves together, never meets
  },
};

const line = (pts) => `M${pts.map(([x, y]) => `${x},${y.toFixed(1)}`).join('L')}`;

export default function StrategyArt({ id }) {
  const s = SHAPES[id] || SHAPES.mean_reversion;
  const xs = Array.from({ length: 61 }, (_, i) => i * 4);
  const a = xs.map((x) => [x, s.base(x)]);
  const b = xs.map((x) => [x, s.base(x) + s.gap(x)]);
  const lens = `${line(a)}L${[...b].reverse().map(([x, y]) => `${x},${y.toFixed(1)}`).join('L')}Z`;

  return (
    <svg className="art" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How a ${id.replace('_', ' ')} pair behaves`}>
      <path d={lens} className="art-lens" />
      <path d={line(a)} className="art-a" fill="none" />
      <path d={line(b)} className="art-b" fill="none" />
    </svg>
  );
}