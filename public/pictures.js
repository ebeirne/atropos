// Pictures for each release, drawn in the site's own dust: a small scene made of
// tiny glyphs, a few grains always blowing off it in the wind, stars behind.
// Nothing is an image file; each picture is a few canvas paths turned into type.
//
//   Pictures.draw(canvas, 'cpi' | 'fomc' | 'nfp')
//
// cpi   a shopping cart under a rising arrow (prices)
// fomc  a central bank's columned facade (the Fed decision)
// nfp   three people, the workforce (jobs)
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var RAMP = ['.', '·', ':', '+', '*', 'x', '#', '@'];
  var LABEL = {
    cpi: 'A shopping cart under a rising arrow, for the inflation report',
    fomc: 'A columned central-bank building, for the Fed decision',
    nfp: 'Three people, for the jobs report',
  };

  /* Each scene is drawn on a 200 x 150 board, white on black. */
  var SCENES = {
    cpi: function (x) {
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.lineWidth = 5;
      x.beginPath(); x.moveTo(14, 30); x.lineTo(36, 30); x.lineTo(52, 96); x.lineTo(60, 112); x.lineTo(160, 112); x.stroke();
      x.beginPath(); x.moveTo(42, 46); x.lineTo(176, 46); x.lineTo(162, 96); x.lineTo(52, 96); x.closePath();
      x.globalAlpha = 0.1; x.fill(); x.globalAlpha = 1; x.stroke();
      x.lineWidth = 2.5;
      for (var i = 1; i < 6; i++) { var gx = 42 + i * 22; x.beginPath(); x.moveTo(gx, 46); x.lineTo(gx - 2 * i + 4, 96); x.stroke(); }
      x.beginPath(); x.moveTo(46, 71); x.lineTo(170, 71); x.stroke();
      x.globalAlpha = 0.8; x.fillRect(70, 30, 26, 18); x.fillRect(102, 22, 20, 26); x.fillRect(128, 34, 30, 14); x.globalAlpha = 1;
      x.beginPath(); x.arc(76, 126, 10, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(148, 126, 10, 0, Math.PI * 2); x.fill();
      // the rising arrow
      x.lineWidth = 5;
      x.beginPath(); x.moveTo(132, 18); x.lineTo(160, 6); x.lineTo(186, 10); x.stroke();
      x.beginPath(); x.moveTo(186, 2); x.lineTo(196, 10); x.lineTo(186, 20); x.closePath(); x.fill();
    },
    fomc: function (x) {
      x.beginPath(); x.moveTo(26, 46); x.lineTo(100, 12); x.lineTo(174, 46); x.closePath();
      x.globalAlpha = 0.2; x.fill(); x.globalAlpha = 1; x.lineWidth = 4; x.stroke();
      x.fillRect(24, 46, 152, 12);
      for (var i = 0; i < 6; i++) {
        var cx = 38 + i * 25;
        x.globalAlpha = 0.9; x.fillRect(cx - 6, 62, 12, 50); x.globalAlpha = 1;
        x.fillRect(cx - 9, 58, 18, 5); x.fillRect(cx - 9, 110, 18, 4);
      }
      x.fillRect(20, 116, 160, 7); x.fillRect(12, 125, 176, 7); x.fillRect(4, 134, 192, 8);
      x.beginPath(); x.arc(100, 33, 6, 0, Math.PI * 2); x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
    },
    nfp: function (x) {
      // three people, the one in front larger: the workforce
      function person(cx, top, r, alpha) {
        x.globalAlpha = alpha;
        x.beginPath(); x.arc(cx, top + r, r, 0, Math.PI * 2); x.fill();
        var sw = r * 2.3, by = top + r * 2.5;
        x.beginPath(); x.moveTo(cx - sw, 140); x.lineTo(cx - sw, by + r * 1.4);
        x.quadraticCurveTo(cx - sw, by, cx - sw + r * 1.4, by); x.lineTo(cx + sw - r * 1.4, by);
        x.quadraticCurveTo(cx + sw, by, cx + sw, by + r * 1.4); x.lineTo(cx + sw, 140); x.closePath(); x.fill();
        x.globalAlpha = 1;
      }
      person(46, 34, 13, 0.55);
      person(154, 34, 13, 0.55);
      x.fillStyle = '#000'; person(100, 14, 20, 1); x.fillStyle = '#fff';   // a dark gap so the front figure stands apart
      person(100, 18, 17, 1);
      x.fillRect(4, 140, 192, 4);
    },
  };

  function hash(n) { var s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

  function draw(canvas, kind) {
    if (!canvas || !SCENES[kind]) return;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', LABEL[kind]);
    var ctx = canvas.getContext('2d');
    var st = { canvas: canvas, ctx: ctx, kind: kind, cells: [], grains: [], stars: [], visible: false, t0: performance.now(),
      mouse: null };

    function layout() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth || 360, h = canvas.clientHeight || 270;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      st.dpr = dpr; st.w = w; st.h = h;
      st.cw = 4; st.ch = 7;
      st.cols = Math.floor(w / st.cw); st.rows = Math.floor(h / st.ch);
      // the scene, fitted with a margin, rasterised 4x per cell then averaged
      var S = 4, mw = st.cols * S, mh = st.rows * S;
      var m = document.createElement('canvas'); m.width = mw; m.height = mh;
      var x = m.getContext('2d');
      var scale = Math.min(mw / 200, mh / 150) * 0.94;
      x.translate((mw - 200 * scale) / 2, (mh - 150 * scale) / 2); x.scale(scale, scale);
      x.fillStyle = '#fff'; x.strokeStyle = '#fff';
      SCENES[kind](x);
      var d = m.getContext('2d').getImageData(0, 0, mw, mh).data;
      st.cells = [];
      for (var r = 0; r < st.rows; r++) for (var c = 0; c < st.cols; c++) {
        var sum = 0;
        for (var yy = 0; yy < S; yy++) for (var xx = 0; xx < S; xx++) sum += d[((r * S + yy) * mw + c * S + xx) * 4];
        var cov = sum / (S * S * 255);
        if (cov > 0.04) st.cells.push({ c: c, r: r, v: cov, s: hash(c * 31.7 + r * 7.3 + kind.length) });
      }
      st.stars = [];
      for (var i = 0; i < Math.round(st.cols * st.rows / 70); i++) st.stars.push({ x: hash(i * 3.1) * w, y: hash(i * 7.9) * h, s: hash(i * 1.7) });
      st.grains = [];
      for (i = 0; i < 90; i++) st.grains.push(spawn(i * 0.37));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '500 ' + (st.ch - 1) + 'px "Geist Mono", ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      paint(performance.now());
    }
    /* a grain leaves from a random part of the picture and drifts right */
    function spawn(age) {
      var cell = st.cells.length ? st.cells[Math.floor(Math.random() * st.cells.length)] : { c: 0, r: 0 };
      return { x: (cell.c + 0.5) * st.cw, y: (cell.r + 0.5) * st.ch, age: age || 0, life: 3 + Math.random() * 4,
        vx: 8 + Math.random() * 18, ph: Math.random() * 6.28 };
    }

    function paint(now) {
      var t = (now - st.t0) / 1000, w = st.w, h = st.h;
      ctx.fillStyle = '#040404'; ctx.fillRect(0, 0, w, h);
      // stars
      for (var i = 0; i < st.stars.length; i++) {
        var s = st.stars[i], tw = 0.5 + 0.5 * Math.sin(t * (0.7 + s.s * 2) + s.s * 40);
        ctx.fillStyle = 'rgba(243,241,234,' + (0.12 + 0.35 * tw * tw).toFixed(3) + ')';
        ctx.fillText(tw > 0.92 ? '+' : '.', s.x, s.y);
      }
      // the picture: each cell a glyph by how much of the scene covers it, breathing slightly
      var m = st.mouse;
      for (i = 0; i < st.cells.length; i++) {
        var c = st.cells[i];
        var b = c.v * (0.82 + 0.18 * Math.sin(t * 1.3 + c.s * 30));
        var px = (c.c + 0.5) * st.cw, py = (c.r + 0.5) * st.ch;
        if (m) {                                   // the cursor is a light wind
          var dx = px - m.x, dy = py - m.y, f = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 70);
          if (f > 0) { px += (m.vx * 0.012 + 2) * f * f; py += m.vy * 0.012 * f * f; b *= 1 + 0.25 * f; }
        }
        var g = RAMP[Math.min(RAMP.length - 1, Math.floor(Math.pow(b, 0.8) * RAMP.length))];
        ctx.fillStyle = 'rgba(243,241,234,' + Math.min(1, 0.35 + b * 0.75).toFixed(3) + ')';
        ctx.fillText(g, px, py);
      }
      // grains in the wind
      for (i = 0; i < st.grains.length; i++) {
        var gr = st.grains[i], k = gr.age / gr.life;
        var gx = gr.x + gr.vx * gr.age * (1 + k), gy = gr.y + Math.sin(gr.age * 1.6 + gr.ph) * 5 - gr.age * 2;
        ctx.fillStyle = 'rgba(243,241,234,' + (0.75 * (1 - k) * Math.min(1, gr.age * 4)).toFixed(3) + ')';
        ctx.fillText(k < 0.5 ? '·' : '.', gx, gy);
      }
    }

    var last = performance.now();
    function step(now) {
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      for (var i = 0; i < st.grains.length; i++) {
        st.grains[i].age += dt;
        if (st.grains[i].age > st.grains[i].life) st.grains[i] = spawn(0);
      }
      if (st.mouse) { st.mouse.vx *= Math.exp(-dt * 5); st.mouse.vy *= Math.exp(-dt * 5); }
      paint(now);
    }
    st.step = step;
    st.layout = layout;

    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), nx = e.clientX - r.left, ny = e.clientY - r.top, now = performance.now();
      var prev = st.mouse;
      var dt = prev ? Math.max(8, now - prev.t) : 16;
      st.mouse = { x: nx, y: ny, t: now, vx: prev ? (nx - prev.x) / dt * 1000 : 0, vy: prev ? (ny - prev.y) / dt * 1000 : 0 };
    });
    canvas.addEventListener('pointerleave', function () { st.mouse = null; });

    all.push(st);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { st.visible = es[0].isIntersecting; }).observe(canvas);
    else st.visible = true;
    var go = function () { layout(); };
    if (document.fonts && document.fonts.load) document.fonts.load('500 8px "Geist Mono"').then(go, go); else go();
    return st;
  }

  var all = [], acc = 0, prev = performance.now();
  function loop(now) {
    acc += now - prev; prev = now;
    if (acc >= 1000 / 40) {                       // forty frames a second is plenty for drifting dust
      acc = 0;
      for (var i = 0; i < all.length; i++) if (all[i].visible && all[i].cells.length) all[i].step(now);
    }
    requestAnimationFrame(loop);
  }
  if (!reduce) requestAnimationFrame(loop);
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { all.forEach(function (s) { s.layout(); }); }, 120); });

  window.Pictures = { draw: draw, step: function (n) { all.forEach(function (s) { for (var i = 0; i < (n || 1); i++) s.step(performance.now()); }); } };
})();
