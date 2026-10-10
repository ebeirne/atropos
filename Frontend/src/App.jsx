import { useEffect } from 'react';
import { useRoute } from './hooks/useRuter.js';
import SiteHeader from './components/SiteHeader.jsx';
import SiteFooter from './components/SiteFooter.jsx';

export default function App() {
  const route = useRoute();

  // New page, start at the top. (Section links like #/?to=how scroll themselves, later.)
  useEffect(() => {
    if (!route.query.to) window.scrollTo(0, 0);
  }, [route.path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault(); // the hash belongs to the router, so move focus by hand
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <SiteHeader path={route.path} />
      <main id="main" tabIndex={-1}>
        {route.path === '/screener' ? (
          <section className="wrap" style={{ paddingTop: 140, minHeight: '70vh' }}>
            <h1 style={{ font: '300 56px/1.1 var(--display)' }}>Screener</h1>
            <p style={{ marginTop: 12, color: 'var(--ink-2)' }}>Placeholder. We build this page in Step 6.</p>
          </section>
        ) : (
          <>
            {/* temporary stand-in for the hero (Step 3) */}
            <section style={{ minHeight: '100svh', background: 'var(--spruce)', color: 'var(--on-dark)', display: 'grid', alignItems: 'center' }}>
              <div className="wrap">
                <h1 style={{ font: '300 clamp(44px, 7vw, 96px)/1 var(--display)', letterSpacing: '-0.03em' }}>
                  Find the pairs that move together.
                </h1>
              </div>
            </section>
            {/* temporary stand-in for the page body (Steps 4 and 5) */}
            <section className="wrap" style={{ padding: '96px var(--gutter)', minHeight: '120vh' }}>
              <p>Scroll position test: the header should turn solid light once you pass about 60% of the first screen.</p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}