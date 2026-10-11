const LIMIT = 3.5;

/** Spread z-score over time. Dashed lines mark the ±2 entry zone used by mean reversion. */
export default function SpreadChart({ z, name }) {
  const W = 480;
  const H = 150;
  const L = 30;
  const R = 50;
  const T = 8;
  const B = 8;
  const n = z.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (Math.max(-LIMIT, Math.min(LIMIT, v)) + LIMIT) / (2 * LIMIT)) * (H - T - B);

  const path = `M${z.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L')}`;
  const last = z[n - 1];
  const inZone = Math.abs(last) >= 2;

  return (
    <svg className="spread" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spread z-score for ${name}, now ${last.toFixed(2)}`}>
      <rect x={L} y={T} width={W - L - R} height={y(2) - T} className="zone" />
      <rect x={L} y={y(-2)} width={W - L - R} height={H - B - y(-2)} className="zone" />
      {[2, 0, -2].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? 'mid' : 'band'} />
          <text x={L - 6} y={y(v) + 4} className="axis" textAnchor="end">{v > 0 ? `+${v}` : v}</text>
        </g>
      ))}
      <path d={path} className="z-line" fill="none" />
      <circle cx={x(n - 1)} cy={y(last)} r="3.5" className={inZone ? 'z-dot hot' : 'z-dot'} />
      <text x={x(n - 1) + 8} y={y(last) + 4} className={inZone ? 'end-hot' : 'end-z'}>
        {last > 0 ? '+' : ''}{last.toFixed(2)}
      </text>
    </svg>
  );
}