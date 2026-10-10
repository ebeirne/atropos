// Ladders: the site's charts, set like a trading screen. Each chart is a real
// <table>: a label column, a thin bar on a rail, and tabular figures that line
// up. The most likely outcome is marked in the accent. Green and red mean what
// they mean on a quote screen: up and down, gains and losses, nothing else. Bars grow in through motion.js (data-grow).
//
//   Ladder.odds(el, { labels, values, change, fmt, caption })   probability ladder; change = points moved per outcome
//   Ladder.diverging(el, { rows: [{ label, loss, gain, lossText, gainText }], max, caption })
//   Ladder.share(el, { rows: [{ label, share }], caption })  sizing bars
(function () {
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function table(el, caption, extra) {
    el.textContent = '';
    var t = h('table', 'ladder' + (extra ? ' ' + extra : ''));
    var c = h('caption', 'sr', caption || ''); t.appendChild(c);
    var body = h('tbody'); t.appendChild(body);
    el.appendChild(t);
    return body;
  }
  function bar(width, cls, i) {
    var rail = h('span', 'rail');
    var b = h('span', 'fill' + (cls ? ' ' + cls : ''));
    b.style.width = Math.max(0, Math.min(100, width)).toFixed(1) + '%';
    b.setAttribute('data-grow', ''); b.style.setProperty('--i', i || 0);
    rail.appendChild(b);
    return rail;
  }

  function odds(el, o) {
    var values = o.values, fmt = o.fmt || function (v) { return Math.round(v * 100) + '%'; };
    var max = Math.max.apply(null, values) || 1, top = values.indexOf(max);
    var body = table(el, o.caption, 'odds');
    values.forEach(function (v, i) {
      var tr = h('tr', i === top ? 'top' : null);
      var th = h('th', 'lab', o.labels[i]); th.scope = 'row'; tr.appendChild(th);
      var td = h('td', 'barcell'); td.appendChild(bar(v / max * 100, i === top ? 'accent' : null, i)); tr.appendChild(td);
      tr.appendChild(h('td', 'num', fmt(v)));
      if (o.change) tr.appendChild(move(o.change[i], 'td'));
      body.appendChild(tr);
    });
    if (window.Motion) window.Motion.prime(el);
  }

  /** A change in points, as a quote screen shows it: arrow, sign, colour. */
  function move(d, tag) {
    var n = h(tag || 'span', 'chg');
    if (d == null || Math.abs(d) < 0.05) { n.className += ' flat'; n.textContent = '– 0.0'; return n; }
    n.className += d > 0 ? ' up' : ' down';
    n.textContent = (d > 0 ? '▲ +' : '▼ −') + Math.abs(d).toFixed(1);
    return n;
  }

  function diverging(el, o) {
    var max = o.max || 1;
    var body = table(el, o.caption, 'div');
    o.rows.forEach(function (r, i) {
      var tr = h('tr');
      var th = h('th', 'lab', r.label); th.scope = 'row'; tr.appendChild(th);
      tr.appendChild(h('td', 'num down', r.lossText || ''));
      var l = h('td', 'barcell left'); l.appendChild(bar(Math.abs(r.loss || 0) / max * 100, 'down', i * 2)); tr.appendChild(l);
      var g = h('td', 'barcell right'); g.appendChild(bar(Math.abs(r.gain || 0) / max * 100, 'up', i * 2 + 1)); tr.appendChild(g);
      tr.appendChild(h('td', 'num up', r.gainText || ''));
      body.appendChild(tr);
    });
    if (window.Motion) window.Motion.prime(el);
  }

  function share(el, o) {
    var top = Math.max.apply(null, o.rows.map(function (r) { return r.share; })) || 1;
    var body = table(el, o.caption, 'share');
    o.rows.forEach(function (r, i) {
      var tr = h('tr');
      var th = h('th', 'lab', r.label); th.scope = 'row'; tr.appendChild(th);
      var td = h('td', 'barcell'); td.appendChild(bar(r.share / top * 100, i === 0 ? 'accent' : null, i)); tr.appendChild(td);
      tr.appendChild(h('td', 'num', Math.round(r.share * 100) + '%'));
      body.appendChild(tr);
    });
    if (window.Motion) window.Motion.prime(el);
  }

  /** The market-data strip, set like a ticker board: for each release the likeliest
      outcome, its odds and how far they moved, repeated so it scrolls without a seam.
      opts.note is a small second line under the title (e.g. the time of a snapshot). */
  var CODE = { cpi: 'CPI', fomc: 'FOMC', nfp: 'NFP' };
  function tape(el, signals, title, opts) {
    if (!el) return;
    opts = opts || {};
    var day = function (iso) {
      return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
    };
    var items = signals.map(function (s) {
      var top = s.p.indexOf(Math.max.apply(null, s.p));
      return { s: s, top: top, parts: [[CODE[s.id] || s.id.toUpperCase(), 'code'], [day(s.date), 'd'],
        [label(s, s.labels[top]).toUpperCase(), 'o'], [Math.round(s.p[top] * 100) + '%', 'v']],
        d: s.change ? s.change.deltaPp[top] : null };
    });
    el.textContent = '';
    var lab = h('span', 'tape-label'); lab.appendChild(h('b', null, title || 'Odds this week'));
    if (opts.note) lab.appendChild(h('small', null, opts.note));
    el.appendChild(lab);
    var track = h('span', 'tape-track');
    var run = h('span', 'tape-run');
    for (var rep = 0; rep < 4; rep++) {
      items.forEach(function (it) {
        var n = h('span', 'tape-item');
        it.parts.forEach(function (p) { n.appendChild(h('span', 'tp-' + p[1], p[0])); });
        if (it.s.change) n.appendChild(move(it.d));
        run.appendChild(n);
      });
    }
    track.appendChild(run); el.appendChild(track);
    el.setAttribute('aria-label', (title || 'Odds this week') + (opts.note ? ' (' + opts.note + ')' : '') + ': ' + items.map(function (it) {
      return it.parts.map(function (p) { return p[0]; }).join(' ') + (it.d != null ? ', ' + (it.d >= 0 ? 'up ' : 'down ') + Math.abs(it.d).toFixed(1) + ' points' : '');
    }).join('; '));
  }

  /** An outcome label as a trader would write it: units on, words for the open ends. */
  function label(s, l) {
    l = String(l);
    var fed = { 'Cut 0.50+': 'Cut 50bp+', 'Cut 0.25': 'Cut 25bp', 'Hold': 'Hold', 'Hike': 'Hike' };
    if (fed[l]) return fed[l];
    if (l === 'negative') return 'Below 0';
    var u = s.unit === 'k' ? 'K' : s.unit || '';
    if (u) l = l.replace(/\s*(%|k|K)$/, '');          // some sources already carry the unit
    var m;
    if ((m = l.match(/^under\s*(.+)$/i)) || (m = l.match(/^[<≤]\s*(.+)$/))) return '≤ ' + m[1] + u;
    if ((m = l.match(/^over\s*(.+)$/i)) || (m = l.match(/^[>≥]\s*(.+)$/))) return '≥ ' + m[1] + u;
    if ((m = l.match(/^(.+)\+$/))) return '≥ ' + m[1] + u;
    return l.replace(/-/g, '–') + u;
  }

  window.Ladder = { odds: odds, diverging: diverging, share: share, tape: tape, label: label };
})();
