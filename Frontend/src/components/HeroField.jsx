import { useEffect, useRef } from 'react';

/**
 * The hero background.
 * Each band is a pair: a random walk (line A) and A plus an Ornstein-Uhlenbeck spread (line B).
 * The spread is pulled back to zero, so the two lines drift apart and snap back together,
 * which is exactly the behaviour Leaf screens for. The area between them is the "leaf".
 */
const POINTS = 240;   // points kept per line
const STEP_MS = 70;   // time between new points
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

function makeBand(cfg) {
  const band = { ...cfg, base: [], spread: [], x: 0, s: 0 };
  for (let i = 0; i < POINTS; i += 1) advance(band, true);
  return band;
}

function advance(b, fill = false) {
  b.x += gauss() * 0.9;                           // line A: random walk
  b.s = b.s * (1 - b.theta) + gauss() * b.sigma;  // spread: pulled back toward 0
  b.base.push(b.x);
  b.spread.push(b.s);
  if (!fill) {
    b.base.shift();
    b.spread.shift();
  }
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
    let raf = 0;
    let last = 0;
    let acc = 0;

    const colour = (alpha, second) =>
      second ? `rgba(169,177,245,${alpha})` : `rgba(143,224,189,${alpha})`;

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const dx = w / (POINTS - 2);
      const shift = (acc / STEP_MS) * dx; // sub-step offset keeps the scroll smooth
      const amp = h * 0.11;

      bands.forEach((b) => {
        const cy = h * b.y;
        const lo = Math.min(...b.base);
        const hi = Math.max(...b.base);
        const mid = (lo + hi) / 2;
        const range = hi - lo || 1;
        const sMax = Math.max(...b.spread.map(Math.abs)) || 1;

        const ya = (i) => cy - ((b.base[i] - mid) / range) * amp * 2;
        const yb = (i) => ya(i) + (b.spread[i] / sMax) * amp * 0.9;
        const px = (i) => i * dx - shift;

        // the leaf: area between the two lines
        ctx.beginPath();
        for (let i = 0; i < POINTS; i += 1) ctx[i ? 'lineTo' : 'moveTo'](px(i), ya(i));
        for (let i = POINTS - 1; i >= 0; i -= 1) ctx.lineTo(px(i), yb(i));
        ctx.closePath();
        ctx.fillStyle = 'rgba(143,224,189,0.09)';
        ctx.fill();

        // the two lines
        [[ya, false], [yb, true]].forEach(([fy, second]) => {
          ctx.beginPath();
          for (let i = 0; i < POINTS; i += 1) ctx[i ? 'lineTo' : 'moveTo'](px(i), fy(i));
          ctx.strokeStyle = colour(0.7, second);
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.stroke();
        });
      });
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function frame(t) {
      acc += Math.min(t - last, 100);
      last = t;
      while (acc >= STEP_MS) {
        bands.forEach((b) => advance(b));
        acc -= STEP_MS;
      }
      draw();
      raf = requestAnimationFrame(frame);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!calm) {          // reduced motion: one still frame, no loop
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="hero-field" aria-hidden="true" />;
}