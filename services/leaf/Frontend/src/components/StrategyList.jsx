import { REQ_LABELS, prettyReq } from '../format.js';

export default function StrategyList({ strategies, selected, onToggle }) {
  return (
    <ul className="strats">
      {Object.entries(strategies).map(([key, s]) => {
        const on = selected.has(key);
        return (
          <li key={key} className={on ? 'strat on' : 'strat'}>
            <label className="strat-head">
              <input type="checkbox" checked={on} onChange={() => onToggle(key)} />
              <span className="strat-name">{s.label}</span>
            </label>
            <p className="strat-sum">{s.summary}</p>
            <dl className="reqs">
              {Object.entries(s.requires).map(([k, v]) => (
                <div key={k}>
                  <dt>{REQ_LABELS[k] || k}</dt>
                  <dd>{prettyReq(v)}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Show the math</summary>
              <ul className="math">
                {s.math.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}