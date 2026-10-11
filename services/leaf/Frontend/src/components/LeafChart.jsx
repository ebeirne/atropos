import { monthYear } from '../format.js';

/**
 * Two price lines rebased to 100, with the area between them filled.
 * The filled lens is the "leaf": wide when the pair drifts apart, pinched shut when it converges.
 */
export default function LeafChart({ a, b, dates, nameA, nameB, mini = false, order = 0 }) {
  const W = mini ? 104 : 480;
  const H = mini ? 34 : 190;
  const L = mini ? 1 : 8;
  const R = mini ? 1 : 50;
  const T = mini ? 3 : 10;
  const B = mini ? 3 : 24;

  const all = [...a, ...b];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const n = a.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const pts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);

  const ptsA = pts(a);
  const ptsB = pts(b);
  const lens = `M${ptsA.join('L')}L${[...ptsB].reverse().join('L')}Z`;

  return (
    <svg
      className={mini ? 'leaf leaf-mini reveal' : 'leaf'}
      style={mini ? { '--i': order } : undefined}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${nameA} and ${nameB} prices, rebased to 100 at the start of the window`}
    >
      <path d={lens} className="lens" />
      <path d={`M${ptsA.join('L')}`} className="line-a" fill="none" />
      <path d={`M${ptsB.join('L')}`} className="line-b" fill="none" />
      {!mini && (
        <>
          <text x={x(n - 1) + 6} y={y(a[n - 1]) + 4} className="end-a">{nameA}</text>
          <text x={x(n - 1) + 6} y={y(b[n - 1]) + 4} className="end-b">{nameB}</text>
          <text x={L} y={H - 6} className="axis">{monthYear(dates[0])}</text>
          <text x={W - R} y={H - 6} className="axis" textAnchor="end">{monthYear(dates[n - 1])}</text>
        </>
      )}
    </svg>
  );
}