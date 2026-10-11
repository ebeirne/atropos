// Screen on the numbers directly, without a strategy. Each parameter becomes one need in a spec
// that Lego runs like any other (see `toSpec`). Keys match app/metrics.py on the backend.
export const PARAMS = [
  {
    scope: 'pair',
    key: 'corr',
    label: 'Correlation',
    hint: 'Of daily returns. Negative: when one rises, the other falls. Positive: they move together.',
    kind: 'range',
    min: -1,
    max: 1,
    step: 0.05,
    start: [-0.9, -0.5],
    ticks: [-1, 0, 1],
    fmt: (v) => v.toFixed(2),
  },
  {
    scope: 'pair',
    key: 'coint_p',
    label: 'Cointegration p-value',
    hint: 'At most this value. Lower means the two prices are more tightly tied over the long run.',
    kind: 'max',
    min: 0.01,
    max: 0.5,
    step: 0.01,
    start: 0.05,
    ticks: [0.01, 0.5],
    fmt: (v) => v.toFixed(2),
  },
  {
    scope: 'pair',
    key: 'half_life',
    label: 'Half-life',
    hint: 'Days the spread takes to close half the gap back to its average. Shorter snaps back faster.',
    kind: 'range',
    min: 1,
    max: 120,
    step: 1,
    start: [3, 40],
    ticks: [1, 120],
    fmt: (v) => `${v} d`,
  },
  {
    scope: 'stock',
    key: 'volatility',
    label: 'Volatility',
    hint: 'Annualized price variation. Lower values select steadier stocks.',
    kind: 'max',
    min: 0,
    max: 1.5,
    step: 0.05,
    start: 0.35,
    ticks: [0, 0.5, 1.5],
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
  {
    scope: 'stock',
    key: 'avg_volume',
    label: 'Average volume',
    hint: 'Average shares traded per day. Higher values select more liquid stocks.',
    kind: 'min',
    min: 0,
    max: 50_000_000,
    step: 500_000,
    start: 1_000_000,
    ticks: [0, 10_000_000, 50_000_000],
    fmt: (v) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v),
  },
  {
    scope: 'stock',
    key: 'total_return',
    label: 'Total return',
    hint: 'Price change over the selected lookback period.',
    kind: 'range',
    min: -1,
    max: 5,
    step: 0.05,
    start: [-0.2, 0.5],
    ticks: [-1, 0, 5],
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
];

export const CUSTOM_KEY = 'custom';
export const CUSTOM_LABEL = 'Your parameters';

/** The chosen values as a spec in EX's format, or null when nothing is chosen. */
export function toSpec(values) {
  const needs = PARAMS.filter((p) => values[p.key] != null).map((p) =>
    p.kind === 'range'
      ? { metric: p.key, op: 'between', value: values[p.key] }
      : { metric: p.key, op: p.kind === 'min' ? '>=' : '<=', value: values[p.key] },
  );
  return needs.length ? { name: CUSTOM_LABEL, summary: '', needs, unmapped: [] } : null;
}

const pct = (p, v) => ((v - p.min) / (p.max - p.min)) * 100;
const snap = (p, v) => Number((Math.round(v / p.step) * p.step).toFixed(4));

function Slider({ p, value, onChange }) {
  const [lo, hi] = p.kind === 'range' ? value : p.kind === 'min' ? [value, p.max] : [p.min, value];
  const fill = { left: `${pct(p, lo)}%`, width: `${pct(p, hi) - pct(p, lo)}%` };
  const thumb = (which, v, set) => (
    <input
      type="range"
      min={p.min}
      max={p.max}
      step={p.step}
      value={v}
      aria-label={p.kind === 'range' ? `${which} ${p.label.toLowerCase()}` : p.label}
      aria-valuetext={p.fmt(v)}
      onChange={(e) => set(snap(p, Number(e.target.value)))}
    />
  );

  return (
    <div className="slider">
      <div className="range">
        <div className="track" aria-hidden="true">
          <div className="fill" style={fill} />
          {p.ticks.includes(0) && <div className="zero" style={{ left: `${pct(p, 0)}%` }} />}
        </div>
        {p.kind === 'range' ? (
          <>
            {/* The handles cannot cross: each one stops a step short of the other. */}
            {thumb('Lowest', lo, (v) => onChange([Math.min(v, snap(p, hi - p.step)), hi]))}
            {thumb('Highest', hi, (v) => onChange([lo, Math.max(v, snap(p, lo + p.step))]))}
          </>
        ) : (
          thumb('', value, onChange)
        )}
      </div>
      <div className="ticks" aria-hidden="true">
        {p.ticks.map((t) => (
          <span key={t} style={{ left: `${pct(p, t)}%` }}>{p.fmt(t)}</span>
        ))}
      </div>
    </div>
  );
}

function ParamItem({ p, values, set }) {
  const value = values[p.key];
  const on = value != null;
  const toggle = () => set(p.key, on ? null : p.start);

  return (
    <li className={on ? 'param on' : 'param'}>
      <label className="strat-head">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span className="param-name">{p.label}</span>
        {on && (
          <span className="param-value">
            {p.kind === 'range'
              ? `${p.fmt(value[0])} to ${p.fmt(value[1])}`
              : `${p.kind === 'min' ? '≥' : '≤'} ${p.fmt(value)}`}
          </span>
        )}
      </label>
      {on && (
        <>
          <Slider p={p} value={value} onChange={(v) => set(p.key, v)} />
          <p className="param-hint">{p.hint}</p>
        </>
      )}
    </li>
  );
}

export default function ParamBuilder({ values, onChange }) {
  const set = (key, v) => onChange({ ...values, [key]: v });

  return (
    <ul className="params">
      <li className="param-divider"><h3>Pairs</h3></li>
      {PARAMS.filter((p) => p.scope === 'pair').map((p) => <ParamItem key={p.key} p={p} values={values} set={set} />)}
      <li className="param-divider"><h3>Individual stocks</h3></li>
      {PARAMS.filter((p) => p.scope === 'stock').map((p) => <ParamItem key={p.key} p={p} values={values} set={set} />)}
    </ul>
  );
}
