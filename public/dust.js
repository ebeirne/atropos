// Dust: the landing page's first section, drawn as type.
//
// A face in profile, made of dust, looks at a small light standing on the
// horizon. The back of the head blows away in the wind as streams of dust; the
// face and the light reflect in the water below. Nothing here is an image: every
// particle lands in a grid of tiny character cells, and each cell becomes the
// glyph that fits how much dust is in it (. : + * # @) or which way it is moving
// (- \ | /).
//
// Everything that leaves the face leaves as single points. Scrolling dissolves the
// face into the wind; stars float up the whole length of the page at their own
// depths and drag with the scroll. The cursor is a light wind: grains near it
// drift the way it moves, then settle. window.dustPulse() brightens everything
// for a moment (the console calls it when a run lands).
//
//   <canvas id="dust" data-track="hero">   the section whose scroll dissolves the face
//
//   <canvas id="dust" data-scene="stars">   the sky alone (the console)
//   ?cell=4x7   cell size in CSS px (default 4x7, 3x5 on phones)
(function () {
  var canvas = document.getElementById('dust');
  if (!canvas) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) { document.documentElement.classList.add('no-dust'); return; }
  var floatGrid = !!gl.getExtension('EXT_color_buffer_float');
  var params = new URLSearchParams(location.search);

  /* --------------------------------------------------------------- rng */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var R = rng(7);
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------ the face
     A woman in profile, facing left, in a unit frame: soft brow, small upturned
     nose, full lips, gentle chin, long neck. Long hair falls behind her and is
     what the wind takes first. The horizon sits at y = 0.80, so the neck sinks
     below it. Outlines are joined with closed Catmull-Rom curves. */
  var PROFILE = [
    // the face, top of the forehead to the throat
    [0.392, 0.205], [0.360, 0.250], [0.340, 0.305], [0.331, 0.360], [0.330, 0.410], [0.336, 0.440],
    [0.345, 0.458], [0.338, 0.485], [0.326, 0.515], [0.312, 0.540], [0.303, 0.553], [0.309, 0.563],
    [0.322, 0.568], [0.337, 0.573], [0.336, 0.590], [0.326, 0.603], [0.325, 0.616], [0.338, 0.626],
    [0.330, 0.637], [0.333, 0.651], [0.347, 0.667], [0.343, 0.690], [0.350, 0.713], [0.370, 0.730],
    [0.405, 0.742], [0.432, 0.770], [0.440, 0.860], [0.446, 1.000],
    // the back of the neck and head (the hair covers most of it)
    [0.600, 1.000], [0.612, 0.840], [0.640, 0.700], [0.668, 0.560], [0.670, 0.420], [0.640, 0.300],
    [0.580, 0.215], [0.490, 0.175],
  ];
  var HAIR = [
    [0.378, 0.232], [0.405, 0.185], [0.470, 0.150], [0.550, 0.138], [0.630, 0.150], [0.700, 0.190],
    [0.750, 0.250], [0.785, 0.330], [0.800, 0.420], [0.808, 0.520], [0.825, 0.620], [0.855, 0.715],
    [0.890, 0.795], [0.865, 0.860], [0.785, 0.840], [0.705, 0.800], [0.648, 0.740], [0.622, 0.640],
    [0.600, 0.540], [0.570, 0.460], [0.520, 0.380], [0.460, 0.310], [0.420, 0.270],
  ];
  var NOSE_X = 0.303, HORIZON = 0.80, STAR_Y = 0.548, BEACON_DX = 0.085;

  function tracePath(ctx, M, P) {
    var n = P.length;
    ctx.beginPath();
    ctx.moveTo(P[0][0] * M, P[0][1] * M);
    for (var i = 0; i < n; i++) {
      var p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      ctx.bezierCurveTo(
        (p1[0] + (p2[0] - p0[0]) / 6) * M, (p1[1] + (p2[1] - p0[1]) / 6) * M,
        (p2[0] - (p3[0] - p1[0]) / 6) * M, (p2[1] - (p3[1] - p1[1]) / 6) * M,
        p2[0] * M, p2[1] * M);
    }
    ctx.closePath();
  }

  /** Masks for the face and the hair, and a shading map that carves her features. */
  function faceDensity(M) {
    var c = document.createElement('canvas'); c.width = c.height = M;
    var x = c.getContext('2d', { willReadFrequently: true });
    tracePath(x, M, PROFILE); x.fillStyle = '#fff'; x.fill();
    var face = x.getImageData(0, 0, M, M).data;
    x.clearRect(0, 0, M, M);
    tracePath(x, M, HAIR); x.fillStyle = '#fff'; x.fill();
    var hair = x.getImageData(0, 0, M, M).data;

    // shading: 200 means 1.0; darker and lighter strokes carve the features
    x.clearRect(0, 0, M, M);
    x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, M, M);
    x.lineCap = 'round'; x.lineJoin = 'round';
    function ell(cx, cy, rx, ry, col, blur, rot) {
      x.filter = blur ? 'blur(' + blur * M + 'px)' : 'none';
      x.beginPath(); x.ellipse(cx * M, cy * M, rx * M, ry * M, rot || 0, 0, Math.PI * 2); x.fillStyle = col; x.fill();
    }
    function line(pts, w, col, blur) {
      x.filter = blur ? 'blur(' + blur * M + 'px)' : 'none';
      x.beginPath(); x.moveTo(pts[0][0] * M, pts[0][1] * M);
      for (var i = 1; i < pts.length; i++) x.lineTo(pts[i][0] * M, pts[i][1] * M);
      x.lineWidth = w * M; x.strokeStyle = col; x.stroke();
    }
    var D = function (a) { return 'rgba(0,0,0,' + a + ')'; }, L = function (a) { return 'rgba(255,255,255,' + a + ')'; };
    // the eye: a soft socket, the iris, a lid line and lashes sweeping forward
    ell(0.368, 0.462, 0.034, 0.019, D(0.85), 0.005);
    ell(0.360, 0.464, 0.007, 0.009, D(1));
    line([[0.346, 0.459], [0.356, 0.452], [0.372, 0.452], [0.384, 0.459]], 0.0045, L(0.85));   // upper lid
    for (var k = 0; k < 6; k++) {                                                                 // lashes
      var lx = 0.348 + k * 0.006;
      line([[lx, 0.454 - k * 0.0006], [lx - 0.009, 0.443 - k * 0.001]], 0.0022, L(0.75));
    }
    line([[0.350, 0.472], [0.362, 0.476], [0.378, 0.472]], 0.002, L(0.35));                      // lower lid
    line([[0.338, 0.425], [0.356, 0.418], [0.378, 0.419], [0.398, 0.428]], 0.0045, L(0.5), 0.002); // a fine brow
    // nose and mouth
    line([[0.346, 0.470], [0.338, 0.520], [0.331, 0.548]], 0.008, L(0.35), 0.004);              // bridge highlight
    ell(0.322, 0.561, 0.010, 0.006, D(0.95), 0, -0.3);                                        // nostril
    line([[0.334, 0.626], [0.352, 0.628], [0.368, 0.622]], 0.007, D(1));                      // the line of the lips
    ell(0.333, 0.611, 0.011, 0.0085, L(0.45), 0.003);                                           // upper lip
    ell(0.336, 0.641, 0.012, 0.0095, L(0.5), 0.003);                                            // lower lip
    // cheek, jaw and throat
    ell(0.410, 0.530, 0.050, 0.030, L(0.45), 0.014);                                            // cheekbone
    ell(0.435, 0.600, 0.045, 0.030, D(0.25), 0.015);
    line([[0.362, 0.716], [0.420, 0.712], [0.500, 0.672], [0.560, 0.600]], 0.014, D(0.75), 0.005); // jaw
    ell(0.440, 0.760, 0.040, 0.020, D(0.45), 0.008);                                            // under the jaw
    x.filter = 'none';
    var shade = x.getImageData(0, 0, M, M).data;

    // hair texture: long strands flowing back and down
    x.clearRect(0, 0, M, M);
    x.fillStyle = '#000'; x.fillRect(0, 0, M, M);
    var r = rng(23);
    for (var s = 0; s < 120; s++) {
      var sx = 0.38 + r() * 0.30, sy = 0.15 + r() * 0.20, len = 0.35 + r() * 0.5;
      line([[sx, sy], [sx + 0.10 + r() * 0.12, sy + 0.08 + r() * 0.10], [sx + 0.18 + r() * 0.15, sy + len * 0.5],
        [sx + 0.20 + r() * 0.18, sy + len]], 0.003 + r() * 0.005, L(0.45 + r() * 0.55), 0.001);
    }
    x.filter = 'none';
    var strands = x.getImageData(0, 0, M, M).data;

    // the face's leading edge, row by row: dust is thickest along it
    var front = new Float32Array(M);
    for (var y = 0; y < M; y++) {
      front[y] = -1;
      for (var xx = 0; xx < M; xx++) if (face[(y * M + xx) * 4 + 3] > 127) { front[y] = xx / M; break; }
    }
    return { M: M, face: face, hair: hair, shade: shade, strands: strands, front: front };
  }

  function sampleFace(n) {
    var F = faceDensity(420), M = F.M, out = [];
    var tries = 0, quota = { face: Math.round(n * 0.64), hair: n - Math.round(n * 0.64) }, got = { face: 0, hair: 0 };
    while (out.length < n && tries < n * 200) {
      tries++;
      var u = 0.28 + R() * 0.58, v = 0.10 + R() * (HORIZON - 0.10);   // only what shows above the horizon
      var px = Math.floor(u * M), py = Math.floor(v * M), k = (py * M + px) * 4;
      var inHair = F.hair[k + 3] > 127, inFace = F.face[k + 3] > 127;
      if (!inHair && !inFace) continue;
      var d, loose, region = inFace && (!inHair || u < 0.38) ? 'face' : 'hair';
      if (got[region] >= quota[region]) continue;
      if (region === 'face') {
        var dx = u - Math.max(0, F.front[py]);
        var base = 0.10 + 0.75 * Math.exp(-dx / 0.03) + 0.5 * Math.exp(-dx / 0.12);
        var grain = 0.75 + 0.25 * Math.sin(u * 160 + Math.sin(v * 47) * 4) * Math.sin(v * 131 + u * 23);
        d = base * (F.shade[k] / 200) * grain;
        loose = smooth(0.12, 0.34, dx) * 0.6 + (R() - 0.5) * 0.15;
      } else {
        // hair: strands carry the dust; the further back, the looser it is
        d = 0.05 + 0.95 * Math.pow(F.strands[k] / 255, 1.2);
        loose = 0.15 + 0.75 * smooth(0.6, 0.88, u) + (v < 0.2 ? 0.15 : 0) + (R() - 0.5) * 0.25;
      }
      if (R() * 1.5 > d) continue;
      got[region]++;
      out.push([u + (R() - 0.5) / M, v + (R() - 0.5) / M, Math.min(1, Math.max(0, loose)), R(),
        region === 'face' ? 0.6 + 0.4 * R() : 0.45 + 0.35 * R()]);
    }
    return out;
  }

  /* ------------------------------------------------------- the particles
     Six kinds share one buffer: 0 face, 4 its reflection, 2 horizon,
     3 beacon (pole, core, rays), 5 streaks, 6 stars, 1 ambient dust (last, so its
     count can follow the screen size). Each: x, y, loose|part|depth, seed, bright, kind. */
  var small = innerWidth * innerHeight < 520000 || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  var NFACE = small ? 20000 : 42000, NDUST = 9000, NSTAR = small ? 130 : 260;
  var data = [];
  function push(a, b, c, d, e, k) { data.push(a, b, c, d, e, k); }
  // data-scene="stars": only the sky (stars, faint dust, the odd shooting star), no face, light or horizon
  var scene = canvas.dataset.scene || 'face';
  var face = scene === 'stars' ? [] : sampleFace(NFACE);
  face.forEach(function (p) { push(p[0], p[1], p[2], p[3], p[4], 0); });
  face.forEach(function (p, i) { if (i % 3 === 0) push(p[0], p[1], p[2], p[3], p[4], 4); });
  var i;
  if (scene !== 'stars') {
  for (i = 0; i < 2200; i++) push(R(), 0, R(), R(), 0.5 + 0.5 * R(), 2);
  for (i = 0; i < 520; i++) push(R(), R(), 0, R(), 0.8 + 0.2 * R(), 3);         // pole
  for (i = 0; i < 380; i++) push(Math.sqrt(R()), R(), 1, R(), 1, 3);            // core
  for (i = 0; i < 420; i++) push(R(), R(), 2, R(), 1, 3);                       // horizontal ray
  for (i = 0; i < 420; i++) push(R(), R(), 3, R(), 1, 3);                       // vertical ray
  }
  for (var s = 0; s < 8; s++) for (i = 0; i < 48; i++) push(i / 47, 0, s, R(), 1, 5);
  for (i = 0; i < NSTAR; i++) push(R(), R(), Math.pow(R(), 1.3), R(), 1, 6);
  var FIXED = data.length / 6;
  for (i = 0; i < NDUST; i++) { var dep = Math.pow(R(), 1.6); push(R(), R(), dep, R(), 0.5 + 0.5 * R(), 1); }
  var verts = new Float32Array(data); data = null;

  /* ------------------------------------------------------------ shaders */
  var VS_P = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 aA;',   // x, y, loose|part|depth|index, seed
    'layout(location=1) in vec2 aB;',   // bright, kind
    'uniform vec2 uView, uCell, uGrid, uBeacon;',
    'uniform vec4 uFrame;',             // left, top, size, horizon (css px)
    'uniform float uTime, uProg, uScrollY, uVel, uAfter, uScale;',
    'uniform vec3 uMouse;',
    'uniform vec2 uWind;',
    'uniform float uPulse;',
    'out vec3 vC;',
    'float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }',
    'void main() {',
    '  float kind = aB.y, seed = aA.w, b = aB.x, S = uFrame.z, H = uFrame.w;',
    '  vec2 pos, ori = vec2(1.0, 0.0); float w = 0.0;',
    '  if (kind < 0.5 || (kind > 3.5 && kind < 4.5)) {',
    '    vec2 home = uFrame.xy + aA.xy * S + (vec2(h1(seed * 91.0), h1(seed * 37.0)) - 0.5) * 0.005 * S;',
    '    float L = clamp(aA.z + uProg * 1.7 * (0.25 + 0.75 * fract(seed * 3.17)), 0.0, 1.0);',
    '    float age = fract(uTime * (0.045 + 0.075 * fract(seed * 7.31)) + seed * 17.0);',
    '    vec2 dir = normalize(vec2(1.0, (aA.y - 0.52) * (1.1 + uProg * 0.9) - 0.08));',
    '    vec2 perp = vec2(-dir.y, dir.x);',
    '    float travel = age * (0.35 + 0.75 * fract(seed * 5.13)) * S * L * (1.0 + uProg * 1.6);',
    '    float wob = sin(age * 6.0 + aA.y * 34.0 + seed * 2.0 + uTime * 0.35) * (0.035 + 0.06 * uProg) * S * age * L;',
    '    vec2 jit = vec2(sin(uTime * 0.9 + seed * 61.0), cos(uTime * 0.7 + seed * 37.0)) * 1.4 * (1.0 - L);',
    '    pos = home + dir * travel + perp * wob + jit;',
    '    float fade = pow(1.0 - age, 1.25) * smoothstep(0.0, 0.05, age);',
    '    b *= mix(0.8 + 0.2 * sin(uTime * 1.7 + seed * 90.0), fade, L);',
    '    b *= 1.0 - smoothstep(0.72, 1.0, uProg);',
    '    if (kind > 3.5) {',
    '      if (pos.y > H) b = 0.0;',
    '      float d = H - pos.y;',
    '      pos.y = H + 2.0 + d * 0.85;',
    '      pos.x += sin(pos.y * 0.09 + uTime * 1.3) * 4.0 + sin(pos.y * 0.023 - uTime * 0.6) * 7.0;',
    '      b *= 0.3 * exp(-d / (0.22 * S));',
    '',
    '    } else if (pos.y > H - 1.0) b = 0.0;',
    '  } else if (kind < 1.5) {',
    '    float depth = aA.z;',
    '    float x = fract(aA.x + uTime * (0.002 + 0.008 * seed) * (1.0 + uProg));',
    '    float y = fract(aA.y - uScrollY * (0.12 + 0.6 * depth) / uView.y + sin(x * 9.0 + seed * 6.0 + uTime * 0.2) * 0.006);',
    '    pos = vec2(x, y) * uView;',
    '    pos.y += clamp(uVel * 0.03 * depth, -70.0, 70.0);',
    '    b *= (0.3 + 0.7 * depth) * (0.6 + 0.4 * sin(uTime * (0.6 + seed * 2.0) + seed * 40.0)) * mix(1.0, 0.18, uAfter);',
    '  } else if (kind < 2.5) {',
    '    float x = aA.x * uView.x;',
    '    pos = vec2(x, H + (aA.z - 0.5) * 2.0);',
    '    float dash = step(0.45, fract(aA.x * 61.0 + floor(uTime * 0.5 + seed * 3.0) * 0.13));',
    '    float near = exp(-abs(x - uBeacon.x) / (0.3 * uView.x));',
    '    b *= (0.2 + 0.8 * dash) * (0.3 + 0.7 * near) * (1.0 - smoothstep(0.6, 1.0, uProg)) * clamp(uView.x / 1400.0, 0.3, 1.0);',
    '  } else if (kind < 3.5) {',
    '    float part = aA.z, tw = 0.85 + 0.15 * sin(uTime * 3.1) * sin(uTime * 1.7 + 1.0);',
    '    if (part < 0.5) { pos = vec2(uBeacon.x + (aA.x - 0.5) * 3.0, mix(H, uBeacon.y, aA.y)); b *= 0.35; }',
    '    else if (part < 1.5) { float a = aA.y * 6.2831853; pos = uBeacon + vec2(cos(a), sin(a)) * aA.x * 0.008 * S; b *= 2.6 * tw; }',
    '    else if (part < 2.5) { float s = aA.x * 2.0 - 1.0; pos = uBeacon + vec2(s * 0.055 * S * tw, (aA.y - 0.5));',
    '      b *= pow(1.0 - abs(s), 2.2) * 2.2; w = 1.0; }',
    '    else { float s = aA.x * 2.0 - 1.0; pos = uBeacon + vec2(aA.y - 0.5, s * 0.07 * S * tw);',
    '      b *= pow(1.0 - abs(s), 2.2) * 2.2; ori = vec2(0.0, 1.0); w = 1.0; }',
    '    b *= 1.0 - smoothstep(0.55, 0.92, uProg);',
    '  } else if (kind > 5.5) {',
    '    float depth = aA.z;',
    '    float y = fract(aA.y - uTime * (0.006 + 0.016 * depth) - uScrollY * (0.08 + 0.5 * depth) / uView.y);',
    '    float x = fract(aA.x + sin(uTime * (0.15 + 0.2 * seed) + seed * 40.0) * 0.012);',
    '    pos = vec2(x, y) * uView;',
    '    pos.y += clamp(uVel * 0.05 * depth, -90.0, 90.0);',
    '    float tw = pow(0.5 + 0.5 * sin(uTime * (0.8 + seed * 2.2) + seed * 50.0), 3.0);',
    '    b *= (1.1 + 4.2 * tw) * (0.45 + 0.55 * depth);',
    '  } else {',
    '    float i = aA.z, P = 5.0 + i * 1.7, cyc = floor(uTime / P + i * 0.37), ph = fract(uTime / P + i * 0.37), life = 0.09;',
    '    vec2 start = vec2(h1(cyc * 3.1 + i), h1(cyc * 7.7 + i * 2.0) * 0.6) * uView;',
    '    vec2 d = normalize(vec2(0.55, 0.85));',
    '    pos = start + d * (ph / life * 0.12 * uView.y + aA.x * (0.07 * uView.y + 40.0));',
    '    b = ph < life ? (1.0 - ph / life) * aA.x * 1.2 : 0.0;',
    '    ori = d; w = 1.0;',
    '  }',
    '  vec2 m = pos - uMouse.xy; float ml = length(m);',
    '  float f = uMouse.z * (1.0 - smoothstep(0.0, 150.0, ml));',
    '  if (f > 0.0) {',
    '    float g = 0.55 + 0.45 * sin(uTime * 2.1 + seed * 31.0);',
    '    pos += (uWind * 22.0 + vec2(2.5, -0.8)) * f * f * g;',
    '    b *= 1.0 + 0.2 * f;',
    '  }',
    '  b *= 1.0 + 0.7 * uPulse;',
    '  if (b <= 0.002) { gl_Position = vec4(3.0, 3.0, 0.0, 1.0); gl_PointSize = 1.0; vC = vec3(0.0); return; }',
    '  vec2 cell = pos / uCell;',
    '  gl_Position = vec4(cell.x / uGrid.x * 2.0 - 1.0, 1.0 - cell.y / uGrid.y * 2.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '  float t2 = 2.0 * atan(ori.y, ori.x);',
    '  vC = vec3(b, vec2(cos(t2), sin(t2)) * w * b) * uScale;',
    '}',
  ].join('\n');
  var FS_P = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vC; out vec4 o;',
    'void main() { o = vec4(vC, 1.0); }',
  ].join('\n');

  var VS_Q = [
    '#version 300 es',
    'void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }',
  ].join('\n');
  // the type pass: one glyph per cell, chosen by how much dust is there and which way it moves
  var FS_Q = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uGridTex, uAtlas;',
    'uniform vec2 uCellDev, uGrid;',
    'uniform float uCanvasH, uGlyphs, uUnscale, uOri, uTime;',
    'uniform vec3 uInk, uBg;',
    'out vec4 o;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main() {',
    '  vec2 fc = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);',
    '  vec2 cell = floor(fc / uCellDev);',
    '  vec2 uv = (fc - cell * uCellDev) / uCellDev;',
    '  vec4 g = texelFetch(uGridTex, ivec2(int(cell.x), int(uGrid.y) - 1 - int(cell.y)), 0);',
    '  float b = g.r * uUnscale;',
    '  vec3 col = uBg;',
    '  if (b > 0.03) {',
    '    vec2 o2 = g.gb / max(g.r, 1e-5);',
    '    float s = length(o2) * uOri, idx;',
    '    float lvl = pow(clamp(b / 9.0, 0.0, 1.0), 0.85) * 10.0 + (hash(cell + floor(uTime * 3.0)) - 0.5) * 0.2;',
    '    if (s > 0.6 && b < 2.6) {',
    '      float th = 0.5 * atan(o2.y, o2.x);',
    '      idx = 10.0 + mod(floor(th / 0.78539816 + 0.5) + 4.0, 4.0);',
    '    } else idx = clamp(floor(lvl), 0.0, 9.0);',
    '    float a = texture(uAtlas, vec2((idx + uv.x) / uGlyphs, uv.y)).a;',
    '    col = mix(uBg, uInk, a * clamp(0.22 + 0.16 * b, 0.0, 1.0));',
    '  }',
    '  o = vec4(col, 1.0);',
    '}',
  ].join('\n');

  function compile(type, src) {
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u };
  }
  var P, Q;
  try { P = program(VS_P, FS_P); Q = program(VS_Q, FS_Q); }
  catch (e) { console.warn('dust:', e.message); document.documentElement.classList.add('no-dust'); return; }

  var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
  var qvao = gl.createVertexArray();

  /* ------------------------------------------------------ grid and glyphs */
  var DENS = ['.', '·', ':', ';', '+', '*', 'x', '%', '#', '@'];
  var DIRS = ['-', '\\', '|', '/'];
  var GLYPHS = DENS.concat(DIRS);
  var gridTex = gl.createTexture(), fbo = gl.createFramebuffer(), atlasTex = gl.createTexture();
  var G = { cols: 1, rows: 1, cw: 5, ch: 8, dpr: 1, w: 1, h: 1, cssW: 1, cssH: 1, dust: NDUST };

  function buildAtlas() {
    var c = document.createElement('canvas');
    c.width = G.cw * GLYPHS.length; c.height = G.ch;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '500 ' + Math.max(6, Math.round(G.ch * 0.92)) + 'px "Geist Mono", "Space Mono", ui-monospace, Menlo, Consolas, monospace';
    GLYPHS.forEach(function (g, i) { x.fillText(g, (i + 0.5) * G.cw, G.ch * 0.56); });
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
    var cell = (params.get('cell') || (cssW < 560 ? '3x5' : '4x7')).split('x').map(Number);
    G.dpr = dpr; G.cssW = cssW; G.cssH = cssH;
    G.cw = Math.max(3, Math.round(cell[0] * dpr)); G.ch = Math.max(5, Math.round((cell[1] || cell[0] * 1.7) * dpr));
    G.w = Math.round(cssW * dpr); G.h = Math.round(cssH * dpr);
    canvas.width = G.w; canvas.height = G.h;
    G.cols = Math.ceil(G.w / G.cw); G.rows = Math.ceil(G.h / G.ch);
    G.dust = Math.min(NDUST, Math.round(cssW * cssH / 210));
    gl.bindTexture(gl.TEXTURE_2D, gridTex);
    if (floatGrid) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, G.cols, G.rows, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, G.cols, G.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gridTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    buildAtlas();
    layout();
  }

  /* ------------------------------------------------------------ layout */
  var hero = document.getElementById(canvas.dataset.track || 'hero');
  var L = { left: 0, top: 0, S: 1, H: 1, bx: 0, by: 0 };
  function layout() {
    var w = G.cssW, h = G.cssH, portrait = w < h * 0.9;
    var S = portrait ? Math.min(w * 1.45, h * 0.72) : Math.min(h * 1.12, w * 0.78);
    var H = portrait ? h * 0.6 : h * 0.9;
    var noseX = portrait ? w * 0.22 : w * 0.26;
    L.S = S; L.H0 = H; L.left = noseX - NOSE_X * S; L.top0 = H - HORIZON * S;
    L.bx = noseX - BEACON_DX * S;
  }

  /* -------------------------------------------------------------- input */
  var mouse = { x: -9999, y: -9999, z: 0, on: false, t: 0, ivx: 0, ivy: 0, wx: 0, wy: 0 };
  if (window.matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', function (e) {
      var now = performance.now(), dt = Math.max(8, now - (mouse.t || now - 16));
      if (mouse.on) { mouse.ivx = (e.clientX - mouse.x) / dt * 1000; mouse.ivy = (e.clientY - mouse.y) / dt * 1000; }
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = now; mouse.on = true;
    }, { passive: true });
    document.addEventListener('pointerleave', function () { mouse.on = false; });
  }
  var lastY = scrollY, vel = 0;

  function progress() {
    if (!hero) return 1;
    var r = hero.getBoundingClientRect(), span = r.height - G.cssH;
    return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
  }

  var ink = [0.953, 0.945, 0.918], bgHero = [0, 0, 0], bgPage = [0, 0, 0];
  var t0 = performance.now(), last = t0, prog = 0, pulse = 0;
  window.dustPulse = function () { pulse = 1; };
  function draw(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var t = reduce ? 9.0 : (now - t0) / 1000 + 4.0;
    var y = scrollY;
    vel += ((y - lastY) / Math.max(dt, 1e-3) - vel) * Math.min(1, dt * 9); lastY = y;
    if (reduce) vel = 0;
    var target = progress();
    prog += (target - prog) * (reduce ? 1 : Math.min(1, dt * 7));
    mouse.z += ((mouse.on ? 1 : 0) - mouse.z) * Math.min(1, dt * 4);
    // the wind is the cursor's own motion, eased in and fading once it stops
    mouse.ivx *= Math.exp(-dt * 5); mouse.ivy *= Math.exp(-dt * 5);
    mouse.wx += (mouse.ivx - mouse.wx) * Math.min(1, dt * 6); mouse.wy += (mouse.ivy - mouse.wy) * Math.min(1, dt * 6);
    var wl = Math.hypot(mouse.wx, mouse.wy) / 1200, ws = wl > 1 ? 1 / wl : 1;
    pulse *= Math.exp(-dt * 1.6);
    var after = Math.min(1, Math.max(0, (prog - 0.85) / 0.15));
    var lift = Math.min(y, hero ? hero.offsetHeight : 0) * 0.16;
    var H = L.H0 - lift;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G.cols, G.rows);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(P.p); var u = P.u;
    gl.uniform2f(u.uView, G.cssW, G.cssH);
    gl.uniform2f(u.uCell, G.cw / G.dpr, G.ch / G.dpr);
    gl.uniform2f(u.uGrid, G.cols, G.rows);
    gl.uniform4f(u.uFrame, L.left, L.top0 - lift, L.S, H);
    gl.uniform2f(u.uBeacon, L.bx, L.top0 - lift + STAR_Y * L.S);
    gl.uniform1f(u.uTime, t); gl.uniform1f(u.uProg, prog);
    gl.uniform1f(u.uScrollY, y); gl.uniform1f(u.uVel, vel); gl.uniform1f(u.uAfter, after);
    gl.uniform1f(u.uScale, floatGrid ? 1 : 0.16);
    gl.uniform3f(u.uMouse, mouse.x, mouse.y, mouse.z);
    gl.uniform2f(u.uWind, mouse.wx / 1200 * ws, mouse.wy / 1200 * ws);
    gl.uniform1f(u.uPulse, pulse);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, FIXED + G.dust);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G.w, G.h);
    gl.useProgram(Q.p); u = Q.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gridTex); gl.uniform1i(u.uGridTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(u.uAtlas, 1);
    gl.uniform2f(u.uCellDev, G.cw, G.ch); gl.uniform2f(u.uGrid, G.cols, G.rows);
    gl.uniform1f(u.uCanvasH, G.h); gl.uniform1f(u.uGlyphs, GLYPHS.length);
    gl.uniform1f(u.uUnscale, floatGrid ? 1 : 1 / 0.16); gl.uniform1f(u.uOri, floatGrid ? 1 : 0);
    gl.uniform1f(u.uTime, t);
    gl.uniform3fv(u.uInk, ink);
    gl.uniform3f(u.uBg, bgHero[0] + (bgPage[0] - bgHero[0]) * after, bgHero[1] + (bgPage[1] - bgHero[1]) * after, bgHero[2] + (bgPage[2] - bgHero[2]) * after);
    gl.bindVertexArray(qvao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    window.__dust = { prog: prog, vel: vel, cols: G.cols, rows: G.rows, particles: FIXED + G.dust, face: face.length, float: floatGrid };
  }

  // debug: step frames by hand where rAF is throttled (hidden tabs, previews)
  window.__dustStep = function (n) { for (var i = 0; i < (n || 1); i++) { last -= 16; draw(performance.now()); } return window.__dust; };
  function loop(now) {
    if (!document.hidden) draw(now);
    requestAnimationFrame(loop);
  }
  var resizeTimer = 0;
  addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { size(); if (reduce) draw(performance.now()); }, 80);
  });
  function start() {
    size();
    if (reduce) { draw(performance.now()); addEventListener('scroll', function () { draw(performance.now()); }, { passive: true }); }
    else requestAnimationFrame(loop);
    document.documentElement.classList.add('dust-on');
  }
  // glyphs are drawn in Geist Mono, so wait for it (but never for long)
  var started = false;
  function go() { if (!started) { started = true; start(); } }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('500 12px "Geist Mono"').then(go, go);
    setTimeout(go, 900);
  } else go();
})();
