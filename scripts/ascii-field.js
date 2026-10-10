// The odds field, in a terminal. Same maths as public/field.js: terraced rings
// shaped by the week's odds, iridescent where they are steep, particles riding
// them as strokes that point the way they move. Loops through the scroll dive.
//
//   node scripts/ascii-field.js [seconds=40] [--sample]
//
// Shape comes from the live odds when the local server is up (/api/events),
// otherwise from the bundled sample.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SECONDS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 40);
const out = process.stdout;
const RAMP = ' .\'`:-~=+*xo%#@';

/* ----------------------------------------------------------- the odds */
function fetchSignals() {
  return new Promise((resolve) => {
    if (process.argv.includes('--sample')) return resolve(null);
    const req = http.get('http://127.0.0.1:4411/api/events', { timeout: 6000 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b).signals); } catch (_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
function lobesFrom(p) {
  const outL = [];
  for (let i = 0; i < 8; i++) {
    const x = i / 8 * (p.length - 1), k = Math.floor(x), f = x - k;
    outL.push(p[k] * (1 - f) + p[Math.min(k + 1, p.length - 1)] * f);
  }
  const mean = outL.reduce((s, v) => s + v, 0) / 8;
  return outL.map((v) => Math.min(1.6, Math.max(0.55, 1 + 0.55 * (v / mean - 1))));
}

/* ----------------------------------------------------------- the field */
let LOBES = [1, 1.1, 1.25, 1.1, 0.95, 0.85, 0.8, 0.9];
const N = 13;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function lobe(a) {
  const x = a / (2 * Math.PI) * 8, i = Math.floor(x), f = x - i;
  const s0 = LOBES[((i % 8) + 8) % 8], s1 = LOBES[(((i + 1) % 8) + 8) % 8];
  return mix(s0, s1, f * f * (3 - 2 * f));
}
function sqN(pr) { return mix(2, 3.8, smooth(0.15, 0.85, pr)); }
function H(px, py, pr, t) {
  const n = sqN(pr);
  const ax = Math.abs(px) + 1e-4, ay = Math.abs(py) + 1e-4;
  let r = Math.pow(Math.pow(ax, n) + Math.pow(ay, n), 1 / n);
  const a = Math.atan2(py, px) + Math.PI;
  r /= mix(1, lobe(a), 0.6);
  r += Math.sin(r * 7.5 - t * 0.9) * 0.014;
  return Math.exp(-r * r * 1.35);
}
const T = (h) => { const x = h * N, f = x - Math.floor(x); return (Math.floor(x) + smooth(0, 0.62, f)) / N; };

function camera(pr, t) {
  const open = 1;
  return {
    c: [mix(0.34, 0, smooth(0, 0.75, pr)), mix(0.17, 0, smooth(0, 0.75, pr))],
    tilt: mix(2.4, 1.05, smooth(0, 0.8, pr)),
    zoom: mix(7, 1, open) * mix(1.55, 0.32, Math.pow(smooth(0, 0.95, pr), 1.3)) * (1 + 0.018 * Math.sin(t * 0.45)),
    rot: t * 0.035,
  };
}

/* -------------------------------------------------------------- frame */
function render(cols, rows, pr, t, label) {
  const cam = camera(pr, t);
  const cr = Math.cos(cam.rot), sr = Math.sin(cam.rot);
  const dissolve = smooth(0.12, 0.55, pr), burst = smooth(0.72, 0.95, pr);
  const portal = smooth(0.76, 0.95, pr);
  const chars = new Array(cols * rows).fill(' ');
  const colors = new Array(cols * rows).fill(null);
  const aspect = 0.5;                                      // a terminal cell is about twice as tall as wide

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const uvx = (x + 0.5 - cols / 2) * aspect / rows, uvy = -(y + 0.5 - rows / 2) / rows;
      let qx = uvx - cam.c[0], qy = (uvy - cam.c[1]) * cam.tilt;
      let px = qx * cam.zoom, py = qy * cam.zoom;
      const rx = cr * px - sr * py, ry = sr * px + cr * py; px = rx; py = ry;
      const e = 0.004 * cam.zoom;
      const raw = H(px, py, pr, t);
      const h = T(raw), hx = T(H(px + e, py, pr, t)), hy = T(H(px, py + e, pr, t));
      const gx = (hx - h) / e, gy = (hy - h) / e, slope = Math.hypot(gx, gy);
      const nz = 1 / Math.hypot(gx * 0.28, gy * 0.28, 1);
      const lam = Math.max(0, (-gx * 0.28 * -0.5 + -gy * 0.28 * 0.62 + 0.6) * nz);
      const f = raw * N - Math.floor(raw * N);
      const riser = smooth(0.02, 0.34, f) * (1 - smooth(0.5, 0.66, f));
      const ir = riser * smooth(0.15, 2.5, slope);
      const ang = Math.atan2(qy, qx);
      const ph = f * 0.85 + ang * 0.16 + t * 0.04;
      let r = 0.5 + 0.5 * Math.cos(6.2831 * ph), g = 0.5 + 0.5 * Math.cos(6.2831 * (ph + 0.33)), b = 0.5 + 0.5 * Math.cos(6.2831 * (ph + 0.67));
      let L = (0.66 + 0.42 * lam);
      let cr2 = mix(L, r * L, ir), cg = mix(L, g * L, ir), cb = mix(L, b * L, ir);
      const fade = smooth(0, 0.42, 1 - y / rows);           // falls to dark toward the bottom
      let lum = (0.299 * cr2 + 0.587 * cg + 0.114 * cb) * fade * mix(1, 0.12, dissolve);
      const d = Math.hypot(uvx - cam.c[0] * (1 - portal), (uvy - cam.c[1] * (1 - portal)) * mix(1.6, 1, portal));
      if (portal > 0.001 && d < portal * 1.9) lum *= 0.05;
      // Density follows structure, not brightness: open fog is a light dust of dots,
      // the ring edges are the heavy strokes. Colour still carries the light.
      const edge = smooth(0.15, 2.5, slope) * (0.4 + 0.6 * riser);
      const dens = Math.min(1, (0.22 * lum + 0.95 * edge) * fade * mix(1, 0.15, dissolve));
      const gi = Math.max(0, Math.min(RAMP.length - 1, Math.round(dens * (RAMP.length - 1))));
      const k = y * cols + x;
      chars[k] = RAMP[gi];
      colors[k] = [cr2 * fade * 255, cg * fade * 255, cb * fade * 255].map((v) => Math.max(40, Math.min(255, Math.round(v * mix(1, 0.35, dissolve)))));
    }
  }

  // particles: strokes along the rings, pointing the way they travel
  const COUNT = Math.round(cols * rows * 0.22);
  const glyphFor = (dx, dy) => {
    const a = Math.atan2(dy, dx * aspect * 2), s = Math.abs(Math.sin(a)), c = Math.abs(Math.cos(a));
    if (s < 0.38) return '-'; if (c < 0.38) return '|'; return Math.sign(dx) === Math.sign(dy) ? '\\' : '/';
  };
  for (let i = 0; i < COUNT; i++) {
    const h1 = (n) => { const s = Math.sin(n * 91.3458) * 47453.5453; return s - Math.floor(s); };
    const s1 = h1(i * 1.13 + 0.1), s2 = h1(i * 2.71 + 0.3), s3 = h1(i * 3.97 + 0.7), s7 = h1(i * 13.7 + 0.6);
    const k = Math.floor(s1 * (N - 1)) + 1;
    const Lv = (k + 0.31 + (s7 - 0.5) * 0.55) / N;
    const re = Math.sqrt(-Math.log(Lv) / 1.35);
    const w = (0.05 + 0.2 * s3) / (0.35 + re) * (1 + 2.2 * pr);
    const pos = (tt) => {
      const a = (s2 * 6.2831853 + w * tt * 3) % 6.2831853;
      const n = sqN(pr), dx = -Math.cos(a), dy = -Math.sin(a);
      const rr = re * mix(1, lobe(a), 0.6) * (1 + burst * (0.8 + 1.8 * s3));
      const nn = Math.pow(Math.pow(Math.abs(dx) + 1e-4, n) + Math.pow(Math.abs(dy) + 1e-4, n), 1 / n);
      let px = rr * dx / nn, py = rr * dy / nn;
      const ix = cr * px + sr * py, iy = -sr * px + cr * py;   // undo the rotation
      const qx = ix / cam.zoom, qy = iy / cam.zoom / cam.tilt;
      const uvx = qx + cam.c[0], uvy = qy + cam.c[1];
      return [uvx * rows / aspect + cols / 2 - 0.5, -uvy * rows + rows / 2 - 0.5];
    };
    const [hx2, hy2] = pos(t), [tx, ty] = pos(t - 0.08);
    const cx = Math.round(hx2), cy = Math.round(hy2);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows - 1) continue;
    const vis = mix(0.15, 1, dissolve) * smooth(0, 0.32, 1 - cy / rows);
    if (h1(i * 5.5) > vis) continue;
    const kk = cy * cols + cx;
    chars[kk] = glyphFor(hx2 - tx, hy2 - ty);
    const v = Math.round(mix(150, 255, dissolve));
    colors[kk] = [v, v, Math.round(v * 0.96)];
  }

  let s = '\x1b[H';
  for (let y = 0; y < rows; y++) {
    let line = '', last = '';
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x, c = colors[k];
      const code = c ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : '';
      if (code !== last) { line += code; last = code; }
      line += chars[k];
    }
    s += line + '\x1b[0m\n';
  }
  s += `\x1b[48;2;21;21;21m\x1b[38;2;228;226;216m ${label.padEnd(cols - 1).slice(0, cols - 1)}\x1b[0m`;
  return s;
}

/* --------------------------------------------------------------- loop */
(async () => {
  const signals = await fetchSignals();
  let source = 'sample shape';
  if (signals) {
    const lead = signals.find((s) => s.verdict === 'shape') || signals.find((s) => s.source !== 'sample') || signals[0];
    if (lead) { LOBES = lobesFrom(lead.p); source = `${lead.short || lead.id} odds from ${lead.source}`; }
  } else {
    try {
      const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'demo.json'), 'utf8'));
      LOBES = lobesFrom(demo.signals[0].p); source = 'sample odds (server not running)';
    } catch (_) { /* keep the default shape */ }
  }
  out.write('\x1b[?25l\x1b[2J');
  const restore = () => { out.write('\x1b[0m\x1b[?25h\n'); process.exit(0); };
  process.on('SIGINT', restore);
  const t0 = Date.now(), CYCLE = 14;
  let frames = 0, fpsWin = Date.now(), fps = 0;
  const tick = () => {
    const t = (Date.now() - t0) / 1000;
    if (t > SECONDS) return restore();
    const cols = Math.max(40, (out.columns || 120) - 1), rows = Math.max(16, (out.rows || 36) - 2);
    const cyc = (t % CYCLE) / CYCLE;
    const pr = cyc < 0.15 ? 0 : cyc > 0.95 ? 0.95 : (cyc - 0.15) / 0.8 * 0.95;   // hold, dive, portal, repeat
    frames++;
    if (Date.now() - fpsWin > 1000) { fps = frames; frames = 0; fpsWin = Date.now(); }
    out.write(render(cols, rows, pr, t, `PRIOR DESK  ·  ascii  ·  ${source}  ·  scroll ${Math.round(pr * 100)}%  ·  ${fps} fps  ·  ctrl+c to stop`));
    setTimeout(tick, 33);
  };
  tick();
})();
