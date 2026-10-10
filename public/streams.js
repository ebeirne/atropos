// Odds bars as rising particle streams: each outcome is a column of ink
// streaks climbing to its probability, denser and quicker where more money
// sits. The plain bars stay underneath, so the chart is complete without this.
// Runs only while a chart is on screen; respects reduced motion.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var live = [];

  function attach(bar) {
    if (bar.dataset.streams || reduce) return;
    bar.dataset.streams = '1';
    var cols = [].slice.call(bar.children).filter(function (n) { return n.tagName === 'I'; });
    if (!cols.length) return;
    var c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.appendChild(c);
    bar.classList.add('streaming');
    var ctx = c.getContext('2d');
    var onPaper = !!bar.closest('.paper');
    var ink = onPaper ? '23,23,23' : '243,241,234';
    var state = { bar: bar, c: c, ctx: ctx, cols: cols, ink: ink, parts: [], visible: false, w: 0, h: 0, dpr: 1 };

    function layout() {
      var r = bar.getBoundingClientRect();
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = r.width; state.h = r.height;
      c.width = Math.max(1, Math.round(r.width * state.dpr)); c.height = Math.max(1, Math.round(r.height * state.dpr));
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      // Column geometry and target heights come straight from the rendered bars.
      state.spec = cols.map(function (col) {
        var cr = col.getBoundingClientRect();
        var frac = parseFloat(col.style.height) / 100 || 0;
        return { x: cr.left - r.left, w: cr.width, frac: frac };
      });
      state.parts = [];
      state.spec.forEach(function (s, i) {
        var n = Math.round(3 + 34 * s.frac);
        for (var k = 0; k < n; k++) state.parts.push(spawn(i, Math.random()));
      });
    }
    function spawn(i, phase) {
      var s = state.spec[i];
      return { i: i, x: s.x + 1 + Math.random() * Math.max(1, s.w - 2), y: phase,
        v: (0.35 + 0.9 * s.frac) * (0.6 + Math.random() * 0.8), len: 3 + Math.random() * 9, a: 0.25 + Math.random() * 0.6 };
    }
    state.layout = layout;
    layout();
    live.push(state);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { state.visible = es[0].isIntersecting; }).observe(bar);
    } else state.visible = true;
  }

  function draw(s, dt) {
    var ctx = s.ctx, H = s.h;
    ctx.clearRect(0, 0, s.w, H);
    ctx.lineCap = 'round';
    var type = !!window.__fieldAscii;                   // in ASCII mode the streams are type too
    if (type) { ctx.font = '500 10px "Geist Mono", ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
    for (var k = 0; k < s.parts.length; k++) {
      var p = s.parts[k], sp = s.spec[p.i];
      var top = H * (1 - sp.frac);                       // the column climbs to its probability
      p.y += p.v * dt;
      if (p.y > 1) { s.parts[k] = spawn(p.i, 0); continue; }
      var y = H - p.y * (H - top);
      var near = 1 - Math.min(1, (y - top) / 18);        // brighter as it reaches the cap
      var alpha = Math.min(1, p.a * (0.55 + 0.6 * near)).toFixed(3);
      if (type) {
        ctx.fillStyle = 'rgba(' + s.ink + ',' + alpha + ')';
        ctx.fillText(near > 0.6 ? '|' : p.len > 8 ? ':' : '.', Math.round(p.x / 6) * 6 + 3, Math.round(y / 9) * 9);
      } else {
        ctx.strokeStyle = 'rgba(' + s.ink + ',' + alpha + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x, Math.min(H, y + p.len)); ctx.stroke();
      }
    }
    // a cap at each column's level: a hairline, or a run of underscores in type
    ctx.fillStyle = 'rgba(' + s.ink + ',.9)';
    s.spec.forEach(function (sp) {
      var cy = H * (1 - sp.frac);
      if (type) { for (var x = sp.x + 3; x < sp.x + sp.w; x += 6) ctx.fillText('-', x, cy); }
      else ctx.fillRect(sp.x, cy - 0.5, sp.w, 1.5);
    });
  }

  var last = performance.now();
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!document.hidden) for (var i = 0; i < live.length; i++) if (live[i].visible) draw(live[i], dt);
    requestAnimationFrame(loop);
  }
  if (!reduce) requestAnimationFrame(loop);
  window.addEventListener('resize', function () { live.forEach(function (s) { s.layout(); }); });

  window.Streams = {
    scan: function (root) { [].forEach.call((root || document).querySelectorAll('.oddsbar'), attach); }
  };
})();
