import { useEffect } from 'react';
import HeroField from '../components/HeroField.jsx';
import StrategyArt from '../components/StrategyArt.jsx';
import { DETAIL_STATS, REQ_LABELS, prettyReq } from '../format.js';

// A real sequence, so this is the one place numbers are used.
const STEPS = [
  {
    title: 'Choose strategies',
    text: 'Pick mean reversion, statistical arbitrage, hedging, or any mix. Each one carries its own math and the parameters a pair must meet.',
  },
  {
    title: 'Screen the universe',
    text: 'Leaf tests every pair for correlation and cointegration, then measures half-life, spread width and where the spread sits right now.',
  },
  {
    title: 'Read the shortlist',
    text: 'Pairs come back ranked per strategy, with charts, the numbers behind each one, and a plain-language reading of why they fit.',
  },
];

export default function Home({ route, strategies }) {
  const list = strategies ? Object.entries(strategies) : [];

  // Three things that are true of the product, counted from real data.
  const facts = [
    { value: list.length || 3, label: 'Strategies, each with its own math' },
    { value: DETAIL_STATS.length, label: 'Statistics measured for every pair' },
    { value: 1, label: 'Screen shared across every strategy you pick' },
  ];

  // Section links look like #/?to=how. Scroll there, then tidy the URL back to '#/' so that
  // clicking the same link a second time changes the hash again and scrolls again.
  useEffect(() => {
    const id = route.query.to;
    if (!id) return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.history.replaceState(null, '', '#/');
    });
  }, [route]);

  return (
    <>
      {/* hero (Step 3) */}
      <section className="hero">
        <HeroField />
        <div className="wrap hero-inner">
          <h1>Find the pairs that move together.</h1>
          <p className="lede">
            Leaf screens a universe for cointegration, correlation and how fast a spread snaps back,
            then matches pairs to the strategy you trade.
          </p>
          <div className="hero-actions">
            <a className="btn solid" href="#/screener">Open the screener</a>
            <a className="btn ghost" href="#/?to=how">See how it works</a>
          </div>
        </div>
      </section>

      {/* facts strip (Step 4) */}
      <section className="facts" aria-label="Leaf at a glance">
        <dl className="wrap facts-row">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* how it works (Step 4) */}
      <section className="block" id="how">
        <div className="wrap split">
          <h2>From a strategy to a shortlist in three steps</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="step-no" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* strategy cards (Step 5) */}
      <section className="block alt" id="strategies">
        <div className="wrap">
          <h2>Strategies</h2>
          <p className="block-sub">
            Each strategy is a set of requirements a pair must meet. Open a card to learn how it works,
            when it fits, and what to watch for.
          </p>

          <ul className="cards">
            {list.map(([key, s]) => (
              <li key={key} className="card">
                <div className="card-art"><StrategyArt id={key} /></div>
                <div className="card-body">
                  <h3>{s.label}</h3>
                  <p className="card-sum">{s.summary}</p>

                  <dl className="req-line">
                    {Object.entries(s.requires).map(([k, v]) => (
                      <div key={k}>
                        <dt>{REQ_LABELS[k] || k}</dt>
                        <dd>{prettyReq(v)}</dd>
                      </div>
                    ))}
                  </dl>

                  <details>
                    <summary>Learn more</summary>
                    <div className="learn">
                      <h4>How the math works</h4>
                      <ul className="math">
                        {s.math.map((m) => <li key={m}>{m}</li>)}
                      </ul>
                      {s.when && (
                        <>
                          <h4>When it fits</h4>
                          <p>{s.when}</p>
                        </>
                      )}
                      {s.watch && (
                        <>
                          <h4>What to watch</h4>
                          <p>{s.watch}</p>
                        </>
                      )}
                    </div>
                  </details>
                </div>
                <a className="card-link" href={`#/screener?s=${key}`}>Open in screener</a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* closing band (Step 5) */}
      <section className="closing">
        <div className="wrap closing-inner">
          <h2>Start with a strategy.</h2>
          <a className="btn solid" href="#/screener">Open the screener</a>
        </div>
      </section>
    </>
  );
}