import { useEffect, useRef, useState } from 'react';
import Wordmark from './Wordmark.jsx';

const LINKS = [
  { label: 'How it works', href: '#/?to=how' },
  { label: 'Strategies', href: '#/?to=strategies' },
  { label: 'Screener', href: '#/screener' },
];

/**
 * Fixed top bar. Over the dark hero it is transparent with light text, then turns solid once you
 * scroll past the hero. "Menu" opens a full-screen overlay, the way institutional sites do.
 */
export default function SiteHeader({ path }) {
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState(false);
  const menuBtn = useRef(null);
  const firstLink = useRef(null);

  const overHero = path === '/' && !past;

  // Check the scroll position at most once per frame, not once per scroll event.
  useEffect(() => {
    let queued = false;
    const update = () => {
      queued = false;
      setPast(window.scrollY > window.innerHeight * 0.6);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the menu on navigation, lock page scroll while open, and close on Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    firstLink.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuBtn.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <header className={overHero ? 'site-header dark' : 'site-header light'}>
        <div className="wrap bar">
          <a href="#/" className="brand" aria-label="Leaf home">
            <Wordmark />
          </a>
          <div className="bar-actions">
            <a className="bar-cta" href="#/screener">Open the screener</a>
            <button
              ref={menuBtn}
              type="button"
              className="menu-btn"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen(true)}
            >
              Menu
              <span className="burger" aria-hidden="true"><i /><i /></span>
            </button>
          </div>
        </div>
      </header>

      <div id="site-menu" className={open ? 'menu open' : 'menu'} hidden={!open}>
        <div className="wrap menu-bar">
          <a href="#/" className="brand" aria-label="Leaf home"><Wordmark /></a>
          <button type="button" className="menu-btn" onClick={() => { setOpen(false); menuBtn.current?.focus(); }}>
            Close
            <span className="burger x" aria-hidden="true"><i /><i /></span>
          </button>
        </div>
        <nav className="wrap menu-links" aria-label="Main">
          {LINKS.map((l, i) => (
            <a key={l.label} href={l.href} ref={i === 0 ? firstLink : null} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <p className="wrap menu-note">
          Leaf is a research tool. Results are in-sample and are not investment advice.
        </p>
      </div>
    </>
  );
}