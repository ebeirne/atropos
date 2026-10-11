// The one timeline the page scrubs. Positions are in sequence units: 0-2 plays on load, 2-10.27
// is tied to the scroll above the content, 11-13 to the footer. Each keyframe is
// [position, value, handles]; a segment between two keyframes eases along a cubic bezier whose
// first control point is the left keyframe's right handle and whose second is the right
// keyframe's left handle (handles are [lx, ly, rx, ry]).
const K = (position, value, handles = [0.5, 1, 0.5, 0]) => ({ position, value, handles });

export const TIMELINE = {
  'cam.px': [K(0.5, -0.6652, [0.5, 1, 0.645, 0.045]), K(2, -0.6852, [0.355, 1, 0.25, 0.46]), K(6.733, -0.2683, [0.45, 0.94, 0.55, 0.085]), K(10, -0.1952, [0.68, 0.53, 0.5, 0]), K(11, 0.08), K(13, -0.06)],
  'cam.py': [K(0.5, -1.0778, [0.5, 1, 0.645, 0.045]), K(2, -1.3878, [0.355, 1, 0.25, 0.46]), K(6.733, -0.8283, [0.45, 0.94, 0.55, 0.085]), K(10, -0.6878, [0.68, 0.53, 0.5, 0]), K(11, -2.5208), K(13, -3.1208)],
  'cam.pz': [K(0.5, 1.4021, [0.5, 1, 0.645, 0.045]), K(2, 1.1821, [0.355, 1, 0.455, 0.03]), K(10, 0.4121, [0.515, 0.955, 0.5, 0]), K(11, 2.3096), K(13, 2.5696)],
  'cam.rx': [K(0.5, 0.6224, [0.5, 1, 0.645, 0.045]), K(2, 0.6984, [0.355, 1, 0.25, 0.46]), K(6.733, 0.283, [0.45, 0.94, 0.55, 0.085]), K(10, 0.283), K(11, 0.64)],
  'cam.ry': [K(0.5, -0.3428), K(2, -0.2678, [0.355, 1, 0.455, 0.03]), K(6.733, -0.1398, [0.515, 0.955, 0.5, 0]), K(10, -0.1398), K(11, 0)],
  'cam.rz': [K(0.5, -0.448, [0.5, 1, 0.645, 0.045]), K(2, -0.362, [0.355, 1, 0.455, 0.03]), K(6.733, -0.297, [0.515, 0.955, 0.5, 0]), K(10, -0.297), K(11, 0)],
  'cam.fov': [K(0, 70.7143), K(2, 70.7143), K(5.667, 124.0804), K(11, 35.7143), K(13, 38.9096)],
  'cam.mouseAngle': [K(2, 0.032), K(7, 0.024), K(8.567, 0), K(10, 0), K(11, 0.01)],
  'hero.uCycleOffset': [K(0.5, 0, [0.355, 1, 0.5, 0]), K(2.167, 0, [0.5, 1, 0.455, 0.03]), K(6.733, 0.381, [0.556, 0.779, 0.5, 0])],
  'hero.uHeight': [K(0.5, 0.266, [0.5, 1, 0.645, 0.045]), K(2, 0.426, [0.355, 1, 0.5, 0]), K(6.333, 0.426), K(10, 0.647)],
  'hero.uShadowStrength': [K(0.5, 0.528, [0.5, 1, 0.645, 0.045]), K(2, 0.787, [0.355, 1, 0.5, 0])],
  'hero.uLightStrength': [K(3.367, 0.437), K(5.667, 0)],
  'hero.uShadowOffset': [K(3.367, 0.0075), K(5.667, 0)],
  'hero.uHeightNoiseStrength': [K(2.7, 0.024), K(6.333, 0.0528)],
  'hero.uHeightNoiseScale': [K(2.7, 0.16), K(6.333, 0.219)],
  'post.bend': [K(3.933, -0.152), K(6.733, -0.542), K(8.867, -0.542), K(11, -0.25)],
  'post.noise': [K(2, 0.1), K(7.733, 0.054), K(8.867, 0), K(11, 0.054)],
  'post.vignette': [K(7.733, 0.89), K(8.867, 0), K(11, 0.89)],
  'footer.uHeight': [K(11, 0.659, [0.5, 1, 0.455, 0.03]), K(13, 0.403, [0.515, 0.955, 0.5, 0])],
  'footer.uDepthOffset': [K(11, 0.734), K(13, 1)],
  // the words: 0 hidden, 1 shown
  'ui.heroHide': [K(2, 0), K(2.7, 1)],
  'ui.title0': [K(2.533, 0), K(3.667, 1), K(4.067, 1), K(5.167, 0)],
  'ui.title1': [K(5.1, 0), K(6.3, 1), K(6.567, 1), K(7.533, 0)],
};

// y of a cubic bezier (0,0)-(x1,y1)-(x2,y2)-(1,1) at x = t, solved by bisection
function bezier(t, x1, y1, x2, y2) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  const cx = (u) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const cy = (u) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 24; i++) { const x = cx(u); if (Math.abs(x - t) < 1e-4) break; if (x < t) lo = u; else hi = u; u = (lo + hi) / 2; }
  return cy(u);
}

export function evalTrack(track, t) {
  if (!track || !track.length) return null;
  if (t <= track[0].position) return track[0].value;
  const last = track[track.length - 1];
  if (t >= last.position) return last.value;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t >= a.position && t <= b.position) {
      const span = b.position - a.position || 1, k = (t - a.position) / span;
      const e = bezier(k, a.handles[2], a.handles[3], b.handles[0], b.handles[1]);
      return a.value + (b.value - a.value) * e;
    }
  }
  return last.value;
}
