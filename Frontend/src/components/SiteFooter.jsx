import Wordmark from "./Wordmark.jsx";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap foot">
        <div>
          <a href="#/" className="brand" aria-label="Leaf home"><Wordmark /></a>
          <p className="foot-line">Pick the strategies you trade. Leaf finds the pairs that fit.</p>
        </div>
        <nav aria-label="Footer">
          <a href="#/?to=how">How it works</a>
          <a href="#/?to=strategies">Strategies</a>
          <a href="#/screener">Screener</a>
        </nav>
      </div>
      <p className="wrap foot-legal">
        Leaf is a research tool. Statistics are computed in sample, ignore trading costs and
        transaction frictions, and are not investment advice.
      </p>
    </footer>
  );
}