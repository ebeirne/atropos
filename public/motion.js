// Shared motion for every Prior Desk page. One easing family throughout
// (expo-out: fast start, long settle), so the site moves like one object.
//
//   data-split          words rise out of a mask, staggered
//   data-reveal         children fade up, staggered
//   data-grow[="y"]     a bar grows from its origin
//   data-count="414"    a number counts up (data-format: money | signed | int | pct)
//   .btn, .pill         lean a few pixels toward the pointer
//   nav[data-solid-after="id"]   the nav gets its own ground once that element has scrolled away
//   data-scramble       hovering a word lets a few letters fall to dust for a moment
//                       (words split by data-split do the same)
//
// Everything is visible without this file; it only adds the starting states.
// Motion.prime(root) processes content rendered after load.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------- smooth scrolling */
  var lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
    var raf = function (t) { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    var el = id.length > 1 && document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { offset: -72, duration: 1.4 });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ------------------------------------------------------- count-ups */
  function fmt(v, f) {
    if (f === 'money') return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
    if (f === 'signed') return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString('en-US');
    if (f === 'pct') return Math.round(v) + '%';
    return Math.round(v).toLocaleString('en-US');
  }
  function count(el) {
    var to = Number(el.dataset.count), f = el.dataset.format;
    if (!isFinite(to)) return;
    if (reduce) { el.textContent = fmt(to, f); return; }
    var t0 = performance.now(), dur = 1300;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);          // expo-out
      el.textContent = fmt(to * e, f);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ------------------------------------------------------ word masks */
  function split(el) {
    if (el.dataset.splitDone) return;
    el.dataset.splitDone = '1';
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.trim());
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (w, i) {
      var outer = document.createElement('span'); outer.className = 'wm'; outer.setAttribute('aria-hidden', 'true');
      var inner = document.createElement('span'); inner.className = 'wi'; inner.textContent = w;
      inner.style.setProperty('--i', i);
      outer.appendChild(inner); el.appendChild(outer);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }

  /* ---------------------------------------------------------- reveal */
  function show(el) {
    el.classList.add('in');
    if (el.hasAttribute('data-count')) count(el);
    [].forEach.call(el.querySelectorAll('[data-count]'), function (c) { if (!c.classList.contains('pre')) count(c); });
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 }) : null;

  function prime(scope) {
    scope = scope || document;
    [].forEach.call(scope.querySelectorAll('[data-scramble]'), wordSpans);
    [].forEach.call(scope.querySelectorAll('[data-split]'), split);
    [].forEach.call(scope.querySelectorAll('[data-reveal]'), function (el) {
      [].forEach.call(el.children, function (c, i) { c.style.setProperty('--i', i); });
    });
    [].forEach.call(scope.querySelectorAll('[data-split],[data-reveal],[data-grow],[data-count]'), function (el) {
      if (el.dataset.primed) return;
      el.dataset.primed = '1';
      if (reduce || !io) { show(el); return; }
      el.classList.add('pre');
      io.observe(el);
    });
  }

  /* -------------------------------------------- pointer-leaning buttons */
  if (!reduce && window.matchMedia('(pointer: fine)').matches) {
    document.addEventListener('pointermove', function (e) {
      var b = e.target.closest && e.target.closest('.btn, .pill');
      if (!b || b.disabled) return;
      var r = b.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      b.style.transform = 'translate(' + (dx * 7).toFixed(1) + 'px,' + (dy * 5).toFixed(1) + 'px)';
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      var b = e.target.closest && e.target.closest('.btn, .pill');
      if (b && !b.contains(e.relatedTarget)) b.style.transform = '';
    });
  }

  /* ------------------------------------------------- hover: dust words */
  function wordSpans(el) {
    if (el.dataset.scrambleDone) return;
    el.dataset.scrambleDone = '1';
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.trim());
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (w, i) {
      var s = document.createElement('span'); s.className = 'sw'; s.textContent = w; s.setAttribute('aria-hidden', 'true');
      el.appendChild(s); if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }
  var DUST = ['.', ':', '\u00b7'];
  function shimmer(el) {
    if (el._busy) return; el._busy = true;
    var word = el.dataset.word || (el.dataset.word = el.textContent);
    el.style.width = el.getBoundingClientRect().width + 'px';
    var f = 0, id = setInterval(function () {
      f++;
      el.textContent = word.split('').map(function (c) {
        return Math.random() < 0.3 * (1 - f / 9) ? DUST[(Math.random() * DUST.length) | 0] : c;
      }).join('');
      if (f >= 9) { clearInterval(id); el.textContent = word; el.style.width = ''; el._busy = false; }
    }, 45);
  }
  if (!reduce && window.matchMedia('(pointer: fine)').matches) {
    document.addEventListener('pointerover', function (e) {
      var w = e.target.closest && e.target.closest('.sw, .wi');
      if (w) shimmer(w);
    });
  }

  /* -------------------------------------------------------------- nav */
  var nav = document.querySelector('nav[data-solid-after]');
  var anchor = nav && document.getElementById(nav.dataset.solidAfter);
  function onScroll() {
    if (nav && anchor) nav.classList.toggle('solid', anchor.getBoundingClientRect().bottom < 80);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  window.Motion = { prime: prime, count: count, lenis: lenis, reduce: reduce };
  prime(document);
})();
