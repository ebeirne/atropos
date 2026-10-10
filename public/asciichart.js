// Charts in type, set in Chinese. Every chart on Prior Desk is a block of
// full-width text you can select and copy. Everything inside a chart is
// full-width - CJK characters, full-width digits (４５％), ideographic spaces -
// so each cell is exactly one em and no column can drift.
//
//   columns   filled with 概率 赔率 市场 价格 (probability, odds, market, price)
//   tops      一 二 三 for the fractional last row
//   axis      a run of ＿, the full-width low line
//   drizzle   丶 ｜ ・ climbing each column: the particle field, in type
//
//   AsciiChart.histogram(el, { values, labels, valueFmt })
//   AsciiChart.bar(share, width)              仓仓仓仓・・・
//   AsciiChart.diverging(loss, gain, max, half)   ・・跌跌｜涨涨涨・・
//   AsciiChart.fw(text)                       ASCII -> full width
//   AsciiChart.zh(word)                       the few English words the charts use -> Chinese
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var charts = [];

  var SP = '　';                                   // ideographic space: one em, like every glyph here
  var FILL = '概率赔率市场价格'.split('');
  var TOPS = ['一', '二', '三'];
  var DRIZZLE = ['丶', '｜', '・'];
  var AXIS = '＿';                                 // full-width low line: sits under the 一 tops, never merges with them

  /** ASCII to its full-width form, so digits and signs keep the one-em pitch. */
  function fw(s) {
    return String(s).replace(/[!-~]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xfee0); })
      .replace(/ /g, SP).replace(/−/g, '－');
  }
  var ZH = {
    'inflation report': '通胀', 'jobs report': '非农', 'fed decision': '美联储',
    hot: '偏热', soft: '偏软', weak: '偏弱', strong: '偏强', dovish: '偏鸽', hawkish: '偏鹰',
    cut: '降息', hold: '不变', hike: '加息',
  };
  function zh(w) { var k = String(w).toLowerCase(); return ZH[k] || fw(w); }

  function cellOf(el) {
    var probe = document.createElement('span');
    probe.textContent = '国国国国国国国国国国';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    el.appendChild(probe);
    var r = probe.getBoundingClientRect();
    el.removeChild(probe);
    var lh = parseFloat(getComputedStyle(el).lineHeight) || r.height;
    return { w: r.width / 10 || 10, h: lh || 14 };
  }

  function histogram(el, opt) {
    var values = opt.values, labels = opt.labels || [];
    var fmt = opt.valueFmt || function (v) { return Math.round(v * 100) + '%'; };
    var rows = opt.rows || 10;
    var max = Math.max.apply(null, values) || 1;
    el.classList.add('ascii-chart');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', (opt.ariaLabels || labels).map(function (l, i) { return l + ' ' + fmt(values[i]); }).join(', '));
    var st = { el: el, values: values, labels: labels, fmt: fmt, rows: rows, max: max, grow: reduce ? 1 : 0,
      started: false, drops: [], cols: 0, bw: 0 };

    function layout() {
      var c = cellOf(el);
      var width = el.clientWidth || el.parentNode.clientWidth || 600;
      st.cols = Math.max(values.length * 2, Math.floor(width / c.w));
      st.bw = Math.max(2, Math.floor((st.cols - (values.length - 1)) / values.length));
      st.drops = [];
      values.forEach(function (v, i) {
        var n = Math.round(1 + 7 * (v / max));
        for (var k = 0; k < n; k++) st.drops.push({ i: i, x: Math.floor(Math.random() * st.bw), y: Math.random(),
          v: 0.25 + 0.9 * (v / max) * (0.5 + Math.random()), g: DRIZZLE[k % DRIZZLE.length] });
      });
      draw(st);
    }
    st.layout = layout;
    layout();
    charts.push(st);
    if ('IntersectionObserver' in window && !reduce) {
      new IntersectionObserver(function (es) {
        st.visible = es[0].isIntersecting;
        if (st.visible) st.started = true;
      }, { rootMargin: '0px 0px -10% 0px' }).observe(el);
    } else { st.started = true; st.visible = true; st.grow = 1; draw(st); }
    return st;
  }

  function draw(st) {
    var n = st.values.length, bw = st.bw, R = st.rows;
    var W = n * bw + (n - 1);
    var grid = [];
    for (var y = 0; y < R + 1; y++) grid.push(new Array(W).fill(SP));
    var ease = 1 - Math.pow(1 - st.grow, 3);
    st.values.forEach(function (v, i) {
      var h = (v / st.max) * R * ease;
      var x0 = i * (bw + 1);
      var full = Math.floor(h), frac = h - full;
      for (var y = 0; y < full; y++) {
        for (var x = 0; x < bw; x++) grid[R - y][x0 + x] = FILL[(y + x + i * 3) % FILL.length];
      }
      if (full < R && frac > 0.08) {
        var top = frac > 0.66 ? TOPS[2] : frac > 0.33 ? TOPS[1] : TOPS[0];
        for (var x2 = 0; x2 < bw; x2++) grid[R - full][x0 + x2] = top;
      }
      if (ease > 0.85) {
        var label = fw(st.fmt(v));
        var ly = Math.max(0, R - Math.ceil(h) - 1);
        if (label.length <= bw + 1) {
          var lx = x0 + Math.max(0, Math.floor((bw - label.length) / 2));
          for (var k = 0; k < label.length && lx + k < W; k++) grid[ly][lx + k] = label[k];
        }
      }
    });
    if (st.started && !reduce) {
      st.drops.forEach(function (d) {
        var v = st.values[d.i], top = (v / st.max) * R * ease;
        var yy = Math.floor(d.y * Math.max(0, top - 0.5));
        var row = R - yy, col = d.i * (bw + 1) + d.x;
        if (row >= 0 && row <= R && col < W && FILL.indexOf(grid[row][col]) >= 0) grid[row][col] = d.g;
      });
    }
    var axis = new Array(W + 1).join(AXIS);
    var lab = new Array(W).fill(SP);
    // Labels never get cut: when they outgrow a column, every other one (or every third) is shown whole.
    var labs = st.labels.map(function (l) { return fw(String(l).replace(/\s+/g, '')); });
    var longest = Math.max.apply(null, labs.map(function (s) { return s.length; }).concat([0]));
    var step = 1;
    while (step < n && longest > step * (bw + 1) - 1) step++;
    labs.forEach(function (s, i) {
      if (i % step) return;
      var x0 = Math.round(i * (bw + 1) + bw / 2 - s.length / 2);
      x0 = Math.max(0, Math.min(W - s.length, x0));
      for (var k = 0; k < s.length && x0 + k < W; k++) lab[x0 + k] = s[k];
    });
    st.el.textContent = grid.map(function (r) { return r.join(''); }).join('\n') + '\n' + axis + '\n' + lab.join('');
  }

  var last = performance.now(), acc = 0;
  function loop(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
    if (acc >= 1 / 24) {
      for (var i = 0; i < charts.length; i++) {
        var st = charts[i];
        if (!st.visible || !st.started) continue;
        st.grow = Math.min(1, st.grow + acc / 1.1);
        st.drops.forEach(function (d) { d.y += d.v * acc * 0.6; if (d.y > 1) { d.y = 0; d.x = Math.floor(Math.random() * st.bw); } });
        draw(st);
      }
      acc = 0;
    }
    if (!document.hidden) requestAnimationFrame(loop); else setTimeout(function () { requestAnimationFrame(loop); }, 250);
  }
  if (!reduce) requestAnimationFrame(loop);
  window.addEventListener('resize', function () { charts.forEach(function (s) { s.layout(); }); });

  function rep(ch, n) { return new Array(Math.max(0, n) + 1).join(ch); }
  function bar(share, width) {
    var n = Math.max(0, Math.min(width, Math.round(share * width)));
    return rep('仓', n) + rep('・', width - n);
  }
  /** Losses fill left of the zero mark with 跌, gains right with 涨. */
  function diverging(loss, gain, max, half) {
    var ln = Math.min(half, Math.round(Math.abs(loss || 0) / (max || 1) * half));
    var gn = Math.min(half, Math.round(Math.abs(gain || 0) / (max || 1) * half));
    return rep('・', half - ln) + rep('跌', ln) + '｜' + rep('涨', gn) + rep('・', half - gn);
  }
  /** Pad a full-width string to n cells. */
  function pad(s, n, right) { s = String(s); return right ? rep(SP, n - s.length) + s : s + rep(SP, n - s.length); }

  window.AsciiChart = { histogram: histogram, bar: bar, diverging: diverging, fw: fw, zh: zh, pad: pad };
})();
