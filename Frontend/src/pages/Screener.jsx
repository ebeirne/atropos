import { useRef, useState } from 'react';
import { getUniverse, scanMulti } from '../api.js';
import StrategyList from '../components/StrategyList.jsx';
import ScanControls from '../components/ScanControls.jsx';
import ResultsPanel from '../components/ResultsPanel.jsx';

const parseTickers = (text) =>
  [...new Set(text.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];

export default function Screener({ strategies, providers, query }) {
  const initial = (query.s || 'mean_reversion').split(',').filter(Boolean);
  const [selected, setSelected] = useState(() => new Set(initial));
  const [provider, setProvider] = useState('synthetic');
  const [days, setDays] = useState(750);
  const [tickers, setTickers] = useState('');
  const [scan, setScan] = useState({ status: 'idle' });
  const resultsRef = useRef(null);

  const chosen = strategies ? [...selected].filter((k) => strategies[k]) : [];

  const toggle = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const loadDefaults = () =>
    getUniverse(provider).then(
      (d) => setTickers(d.tickers.join(', ')),
      (e) => setScan({ status: 'error', error: e.message }),
    );

  const run = async () => {
    setScan({ status: 'loading' });
    // On narrow screens the controls sit above the results, so bring the results into view.
    if (window.matchMedia('(max-width: 960px)').matches) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      resultsRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
    try {
      const list = parseTickers(tickers);
      const data = await scanMulti({
        strategies: chosen,
        provider,
        days: Number(days) || 750,
        tickers: list.length ? list : null,
      });
      setScan({ status: 'done', data });
    } catch (e) {
      setScan({ status: 'error', error: e.message });
    }
  };

  return (
    <div className="screener">
      <header className="wrap page-head">
        <h1>Screener</h1>
        <p>Pick one or more strategies, set the universe, and Leaf returns the pairs that fit each.</p>
      </header>

      {strategies && (
        <div className="wrap workspace">
          <aside className="controls-col" aria-label="Scan setup">
            <h2>Strategies</h2>
            <StrategyList strategies={strategies} selected={new Set(chosen)} onToggle={toggle} />

            <h2>Data</h2>
            <ScanControls
              providers={providers}
              provider={provider}
              onProvider={setProvider}
              days={days}
              onDays={setDays}
              tickers={tickers}
              onTickers={setTickers}
              onLoadDefaults={loadDefaults}
              onScan={run}
              busy={scan.status === 'loading'}
              selectedCount={chosen.length}
            />
          </aside>

          <div className="results-col" ref={resultsRef}>
            <ResultsPanel scan={scan} strategies={strategies} />
          </div>
        </div>
      )}
    </div>
  );
}