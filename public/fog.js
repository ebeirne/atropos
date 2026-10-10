// Grey fog falling to near-black, with moving film grain on top. The fog lifts
// as the page scrolls, so the hero sits in light and the work below in dark.
(function () {
  var canvas = document.getElementById('fog');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var strength = Number(canvas.dataset.strength || 1);   // console uses a lighter dose
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, grain = null, raf = 0, last = 0;

  function makeGrain() {
    var g = document.createElement('canvas');
    g.width = g.height = 160;
    var gx = g.getContext('2d');
    var img = gx.createImageData(160, 160);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 22;
    }
    gx.putImageData(img, 0, 0);
    return g;
  }

  function size() {
    // The canvas can measure 0 while its frame is still being laid out (a
    // hidden pane, a thumbnail pass); fall back to the window so nothing divides by zero.
    W = canvas.clientWidth || window.innerWidth || 1280;
    H = canvas.clientHeight || window.innerHeight || 800;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    if ((canvas.clientWidth && canvas.clientWidth !== W) || (canvas.clientHeight && canvas.clientHeight !== H)) size();
    var y = window.scrollY || 0;
    var lift = Math.max(0, Math.min(1, 1 - y / (H * 0.9)));   // 1 at the top, 0 a screen down
    var a = 0.62 * strength * lift;
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(160,160,158,' + a + ')');
    g.addColorStop(0.42, 'rgba(118,118,116,' + a * 0.92 + ')');
    g.addColorStop(0.78, 'rgba(40,40,39,' + a * 0.6 + ')');
    g.addColorStop(1, 'rgba(21,21,21,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a slow drifting bank of light, so the fog is never perfectly flat
    var cx = W * (0.62 + 0.08 * Math.sin(t / 9000)), cy = H * (0.18 + 0.05 * Math.cos(t / 11000));
    var r = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    r.addColorStop(0, 'rgba(230,229,224,' + 0.16 * strength * lift + ')');
    r.addColorStop(1, 'rgba(230,229,224,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
    if (grain) {
      var ox = reduce ? 0 : Math.floor(Math.random() * 160), oy = reduce ? 0 : Math.floor(Math.random() * 160);
      ctx.save(); ctx.translate(-ox, -oy);
      ctx.fillStyle = ctx.createPattern(grain, 'repeat');
      ctx.fillRect(ox, oy, W + 160, H + 160);
      ctx.restore();
    }
  }

  function loop(t) {
    if (t - last > 80) { draw(t); last = t; }               // ~12fps reads as film, not video
    raf = requestAnimationFrame(loop);
  }

  grain = makeGrain();
  size();
  draw(0);
  window.addEventListener('resize', function () { size(); draw(performance.now()); });
  if (reduce) window.addEventListener('scroll', function () { draw(0); }, { passive: true });
  else raf = requestAnimationFrame(loop);
})();
