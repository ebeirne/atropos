import { useEffect, useRef } from 'react';

/**
 * The hero background.
 * Each band is a pair: a random walk (line A) and A plus an Ornstein-Uhlenbeck spread (line B).
 * The spread is pulled back to zero, so the two lines drift apart and snap back together,
 * which is exactly the behaviour Leaf screens for. The area between them is the "leaf".
 *
 * Performance:
 *  - the vertical scale and the drawing paths are built once per new data point, not every frame;
 *  - each frame only slides those cached paths sideways;
 *  - it draws at about 30 fps and at no more than 1.5x pixel density (it is a background);
 *  - it stops completely while the hero is scrolled out of view.
 */
const POINTS = 240;   // points kept per line
const STEP_MS = 70;   // time between new points
const FRAME_MS = 33;  // minimum time between drawn frames (about 30 fps)
const MAX_DPR = 1.5;  // cap on canvas pixel density
const BANDS = [
  { y: 0.36, theta: 0.05, sigma: 1.0 },   // theta = how hard the spread is pulled back
  { y: 0.6, theta: 0.11, sigma: 1.0 },    // fast reverter
  { y: 0.82, theta: 0.025, sigma: 1.0 },  // slow reverter
];

const gauss = () => {
  // Box-Muller: a normally distributed random number
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function advance(b) {
  b.x += gauss() * 0.9;                           // line A: random walk
  b.s = b.s * (1 - b.theta) + gauss() * b.sigma;  // spread: pulled back toward 0
  b.base.push(b.x);
  b.spread.push(b.s);
  if (b.base.length > POINTS) {
    b.base.shift();
    b.spread.shift();
  }
}

// Vertical scale for a band. Only changes when a point is added, so compute it then.
function measure(b) {
  let lo = Infinity;
  let hi = -Infinity;
  let sMax = 0;
  for (let i = 0; i < b.base.length; i += 1) {
    if (b.base[i] < lo) lo = b.base[i];
    if (b.base[i] > hi) hi = b.base[i];
    const s = Math.abs(b.spread[i]);
    if (s > sMax) sMax = s;
  }
  b.mid = (lo + hi) / 2;
  b.range = hi - lo || 1;
  b.sMax = sMax || 1;
}

function makeBand(cfg) {
  const b = { ...cfg, base: [], spread: [], x: 0, s: 0, mid: 0, range: 1, sMax: 1, paths: null };
  for (let i = 0; i < POINTS; i += 1) advance(b);
  measure(b);
  return b;
}

export default function HeroField() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bands = BANDS.map(makeBand);
    let w = 0;
    let h = 0;
    let dx = 0;
    let raf = 0;
    let running = false;
    let onScreen = true;
    let last = 0;
    let lastDraw = 0;
    let acc = 0;

    // Build the three shapes of one band (the leaf and both lines), once per new point.
    function buildPaths(b) {
      const amp = h * 0.11;
      const cy = h * b.y;
      const ya = (i) => cy - ((b.base[i] - b.mid) / b.range) * amp * 2;
      const yb = (i) => ya(i) + (b.spread[i] / b.sMax) * amp * 0.9;
      const lineA = new Path2D();
      const lineB = new Path2D();
      const leaf = new Path2D();
      for (let i = 0; i < POINTS; i += 1) {
        const x = i * dx;
        const op = i ? 'lineTo' : 'moveTo';
        lineA[op](x, ya(i));
        lineB[op](x, yb(i));
        leaf[op](x, ya(i));
      }
      for (let i = POINTS - 1; i >= 0; i -= 1) leaf.lineTo(i * dx, yb(i));
      leaf.closePath();
      b.paths = { lineA, lineB, leaf };
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(-(acc / STEP_MS) * dx, 0); // slide between data points so motion looks continuous
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      bands.forEach((b) => {
        ctx.fillStyle = 'rgba(143,224,189,0.09)';
        ctx.fill(b.paths.leaf);
        ctx.strokeStyle = 'rgba(143,224,189,0.7)';
        ctx.stroke(b.paths.lineA);
        ctx.strokeStyle = 'rgba(169,177,245,0.7)';
        ctx.stroke(b.paths.lineB);
      });
      ctx.restore();
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dx = w / (POINTS - 2);
      bands.forEach(buildPaths);
      draw();
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      acc += Math.min(t - last, 100);
      last = t;

      let moved = false;
      while (acc >= STEP_MS) {
        bands.forEach((b) => {
          advance(b);
          measure(b);
        });
        acc -= STEP_MS;
        moved = true;
      }
      if (moved) bands.forEach(buildPaths);

      if (t - lastDraw < FRAME_MS - 2) return; // skip frames to hold about 30 fps
      lastDraw = t;
      draw();
    }

    function start() {
      if (running || calm || !onScreen) return; // reduced motion: one still frame, no loop
      running = true;
      last = performance.now();
      lastDraw = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Do no work at all while the hero is scrolled out of view.
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    visibility.observe(canvas);

    return () => {
      stop();
      resizeObserver.disconnect();
      visibility.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="hero-field" aria-hidden="true" />;
}