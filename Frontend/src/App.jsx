import { useEffect, useState } from 'react';
import { getStrategies } from './api.js';
import { useRoute } from './hooks/useRoute.js';
import SiteHeader from './components/SiteHeader.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import Home from './pages/Home.jsx';
import Screener from './pages/Screener.jsx';

export default function App() {
  const route = useRoute();
  const [meta, setMeta] = useState(null);

  // Strategy content loads once and is shared by the pages.
  useEffect(() => {
    getStrategies().then(setMeta);
  }, []);

  // New page, start at the top. (Section links like #/?to=how scroll themselves.)
  useEffect(() => {
    if (!route.query.to) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
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
          <Screener
            key={route.query.s || ''}
            strategies={meta?.strategies}
            query={route.query}
          />
        ) : (
          <Home route={route} strategies={meta?.strategies} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}