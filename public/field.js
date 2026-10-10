// The odds field: a terraced, iridescent surface whose rings are shaped by the
// week's de-arbitraged distribution - and the particles it is made of.
//
// Two layers share one camera:
//   surface    the rings, lit and iridescent (fragment shader)
//   particles  tens of thousands of streaks that ride those same rings, denser
//              where the market puts its money; a quarter drift outward across
//              them like wind. Scrolling dissolves the surface into the
//              particles, tilts the disc from oblique to face-on, then (on the
//              landing page) bursts them radially through the portal.
//              fieldPulse() fires a spray of sparks from the centre.
//
// Motion model: scroll, pointer, camera and the odds' shape are damped springs
// chasing their targets, so nothing jumps. Resolution adapts to hold the frame
// rate; grain steps at film speed. WebGL2, no libraries.
//
// Canvas data attributes:
//   data-track   id of the element whose scroll span drives the camera
//   data-portal  "1" dives through a portal at the end (landing), "0" not
//   data-intro   "full" (black, fog, opening) or "short"
(function () {
  var canvas = document.getElementById('field');
  if (!canvas) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // No preserveDrawingBuffer: keeping the last frame costs a copy every frame, and at 120Hz there is no slack for it.
  var gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  var track = document.getElementById(canvas.dataset.track || 'hero');
  var PORTAL = canvas.dataset.portal !== '0';
  var SHORT = canvas.dataset.intro === 'short';

  function fallback() {
    canvas.style.background = 'radial-gradient(120% 90% at 68% 30%, #e9e8e3 0%, #b9b8b3 38%, #3a3a38 78%, #151515 100%)';
    document.documentElement.classList.add('field-ready');
    window.setFieldOdds = window.fieldPulse = function () {};
  }
  if (!gl) { fallback(); return; }

  /* ------------------------------------------------------------ shaders */
  // Shared GLSL: the odds shape (lobes) and the camera, so both layers agree exactly.
  var COMMON = [
    'uniform vec2 uRes,uPtr;uniform float uTime,uProg,uIntro;uniform float uLobe[8];',
    'const float N=13.;',
    'float lobe(float a){float x=a/6.2831853*8.;int i=int(floor(x));float f=fract(x);',
    '  float s0=uLobe[i%8],s1=uLobe[(i+1)%8];return mix(s0,s1,f*f*(3.-2.*f));}',
    'vec2 camC(){return mix(vec2(.34,.17),vec2(0.),smoothstep(0.,.75,uProg))+uPtr*vec2(.035,.025);}',
    'float camTilt(){return mix(2.4,1.05,smoothstep(0.,.8,uProg))+uPtr.y*.12;}',
    'float camZoom(){float open=1.-pow(1.-uIntro,3.);',
    '  return mix(7.,1.,open)*mix(1.55,.32,pow(smoothstep(0.,.95,uProg),1.3))*(1.+.018*sin(uTime*.45));}',
    'float camRot(){return uTime*.035;}',
    'float sqN(){return mix(2.,3.8,smoothstep(.15,.85,uProg));}'
  ].join('\n');

  var SURF_VS = '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var SURF_FS = [
    '#version 300 es',
    'precision highp float;',
    COMMON,
    'uniform float uFade,uPortal,uGrain,uPulse,uDissolve;',
    'out vec4 o;',
    'const vec3 BG=vec3(0.0824);',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float H(vec2 p){',
    '  float n=sqN();',
    '  vec2 ap=abs(p)+1e-4;',
    '  float r=pow(pow(ap.x,n)+pow(ap.y,n),1./n);',
    '  float a=atan(p.y,p.x)+3.14159265;',
    '  r/=mix(1.,lobe(a),.6);',
    '  r+=sin(r*7.5-uTime*.9)*.014;',
    '  float w=uPulse*1.15;',
    '  r-=exp(-pow((r-w)*7.,2.))*.05*smoothstep(1.6,0.,w);',
    '  return exp(-r*r*1.35);}',
    'float T(float h){float x=h*N;float f=fract(x);return (floor(x)+smoothstep(0.,.62,f))/N;}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;',
    '  float pr=uProg;',
    '  vec2 c=camC(); float tilt=camTilt(); float zoom=camZoom(); float rot=camRot();',
    '  vec2 q=uv-c; q.y*=tilt; q.x+=q.y*uPtr.x*.08;',
    '  vec2 p=q*zoom;',
    '  p=mat2(cos(rot),-sin(rot),sin(rot),cos(rot))*p;',
    '  float e=.004*zoom;',
    '  float raw=H(p);',
    '  float h=T(raw),hx=T(H(p+vec2(e,0.))),hy=T(H(p+vec2(0.,e)));',
    '  vec2 g=vec2(hx-h,hy-h)/e;',
    '  float slope=length(g);',
    '  vec3 n=normalize(vec3(-g*.28,1.));',
    '  vec3 L=normalize(vec3(-.5+uPtr.x*.25,.62+uPtr.y*.2,.6));',
    '  float lam=max(0.,dot(n,L));',
    '  float spec=pow(max(0.,dot(reflect(-L,n),vec3(0.,0.,1.))),24.);',
    '  float f=fract(raw*N);',
    '  float ao=mix(1.,mix(.72,1.,smoothstep(0.,.5,f)),smoothstep(.015,.07,raw));',
    '  vec3 col=vec3(.965,.962,.955)*(.66+.42*lam)*ao+spec*.16;',
    '  float ang=atan(q.y,q.x);',
    '  float riser=smoothstep(.02,.34,f)*(1.-smoothstep(.5,.66,f));',
    '  float ir=riser*smoothstep(.15,2.5,slope)*mix(.6,1.,smoothstep(.1,.9,pr));',
    '  vec3 film=.5+.5*cos(6.2831*(f*.85+ang*.16+dot(n.xy,vec2(.6,.4))+uTime*.04+vec3(0.,.33,.67)));',
    '  film=mix(film,vec3(1.),.12);',
    '  col=mix(col,film*(.7+.4*lam)*ao,ir*.95);',
    '  col=mix(col,mix(BG,col,.1),uDissolve);',                    // the surface gives way to its particles
    '  float vy=gl_FragCoord.y/uRes.y;',
    '  col=mix(BG,col,smoothstep(0.,.42,vy)*.85+.15*smoothstep(0.,.2,vy));',
    '  float pd=uPortal*smoothstep(.76,.95,pr);',
    '  float d=length((uv-c*(1.-pd))*vec2(1.,mix(1.6,1.,pd)));',
    '  col=mix(col,BG,smoothstep(pd*1.9,pd*1.9-.03,d)*step(.001,pd));',
    '  col=mix(BG,col,uFade);',
    '  col+=(hash(gl_FragCoord.xy+uGrain*91.)-.5)*.075;',
    '  o=vec4(col,1.);}'
  ].join('\n');

  // Particles: two vertices each (head, tail), positioned analytically from the
  // vertex id, so there is no simulation state and no CPU cost per particle.
  var PART_VS = [
    '#version 300 es',
    'precision highp float;',
    COMMON,
    'in float aZ;',
    'uniform float uDissolve,uBurst,uPulse,uPortal;',
    'out float vA;',
    'float h1(float n){return fract(sin(n*91.3458)*47453.5453);}',
    'vec2 onRing(float L,float a,float n){',
    '  float re=sqrt(-log(max(L,1e-4))/1.35);',
    '  float r=re*mix(1.,lobe(a),.6);',
    '  vec2 d=-vec2(cos(a),sin(a));',
    '  vec2 ad=abs(d)+1e-4;',
    '  return r*d/pow(pow(ad.x,n)+pow(ad.y,n),1./n);}',
    'vec2 toNdc(vec2 p){',
    '  float rot=camRot();',
    '  vec2 q=mat2(cos(-rot),-sin(-rot),sin(-rot),cos(-rot))*p/camZoom();',
    '  q.x-=q.y*uPtr.x*.08;',
    '  q.y/=camTilt();',
    '  vec2 uv=q+camC();',
    '  return vec2(uv.x*2.*uRes.y/uRes.x,uv.y*2.);}',
    'void main(){',
    '  float id=float(gl_VertexID/2);',
    '  float head=float(gl_VertexID%2)+aZ*0.;',
    '  float s1=h1(id*1.13+.1),s2=h1(id*2.71+.3),s3=h1(id*3.97+.7),s4=h1(id*5.31+.9),s5=h1(id*7.77+.2);',
    '  float n=sqN();',
    '  float s6=h1(id*11.31+.4),s7=h1(id*13.7+.6);',
    // Mostly dots, some dashes, a few long streaks - the mix that reads as particles, not line art.
    '  float len=.012+.11*s6*s6*s6;',
    '  float lag=head>.5?0.:(len+.4*uBurst);',
    '  float t=uTime-lag;',
    '  float flow=step(.64,s5);',                                    // a third drift outward, across the rings
    '  float k=floor(s1*(N-1.))+1.;',
    '  float rate=.012+.02*s3;',
    '  float uh=s1-uTime*rate,ut=s1-t*rate,utail=s1-(uTime-len-.4*uBurst)*rate;',
    '  float wrap=flow>.5&&floor(uh)!=floor(utail)?1.:0.;',           // both ends see a re-entry, so the line is never drawn across the field
    '  float L=flow>.5?.03+.94*fract(ut):(k+.31+(s7-.5)*.55)/N;',
    '  float edgeFade=flow>.5?smoothstep(.03,.12,L)*smoothstep(.97,.85,L):1.;',
    '  float re=sqrt(-log(L)/1.35);',
    '  float w=(.05+.2*s3)/(.35+re)*(1.+2.2*uProg);',               // inner orbits run faster; scrolling spins them up
    '  float a=mod(s2*6.2831853+w*t*3.,6.2831853);',
    '  vec2 p=onRing(L,a,n);',
    '  float b=uBurst*(.8+1.8*s3);',                                 // the portal: everything streaks outward
    '  float bl=max(0.,uBurst-.14)*(.8+1.8*s3);',
    '  p*=1.+(head>.5?b:bl);',
    '  float spark=0.;',
    '  if(s4<.16&&uPulse<2.2){',                                     // a run sends sparks from the centre
    '    float pt=max(0.,uPulse-(head>.5?0.:.06));',
    '    p=-vec2(cos(s2*6.2831853),sin(s2*6.2831853))*pt*.95*(.45+s3);',
    '    spark=pow(1.-uPulse/2.2,2.);}',
    '  vec2 ndc=toNdc(p);',
    '  gl_Position=vec4(ndc,0.,1.);',
    '  float vy=(ndc.y+1.)*.5;',
    '  float dens=mix(.3,1.4,clamp((lobe(a)-.55)/1.05,0.,1.));',     // more light where the money is
    '  float glint=.3+1.5*pow(s6,4.)+.35*sin(uTime*(1.+3.*s7)+s2*40.);', // most faint, a few bright, all flickering a little
    '  float base=mix(.12,.95,uDissolve)*dens*max(.1,glint)*edgeFade*smoothstep(.35,1.,uIntro);',
    '  base*=smoothstep(0.,.32,vy)*(1.-uPortal*smoothstep(.9,.985,uProg))*(1.-wrap);',
    '  base=max(base,spark*1.15);',
    '  vA=head>.5?base:0.;}'
  ].join('\n');
  var PART_FS = '#version 300 es\nprecision mediump float;in float vA;out vec4 o;void main(){o=vec4(vec3(1.,.985,.96)*vA,1.);}';

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('field shader:', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function program(vsSrc, fsSrc) {
    var vs = sh(gl.VERTEX_SHADER, vsSrc), fs = sh(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('field link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  function uniforms(p, names) {
    var u = {}; names.forEach(function (k) { u[k] = gl.getUniformLocation(p, k); }); return u;
  }

  var surf = program(SURF_VS, SURF_FS);
  if (!surf) { fallback(); return; }
  var surfVao = gl.createVertexArray();
  gl.bindVertexArray(surfVao);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aLoc = gl.getAttribLocation(surf, 'a');
  gl.enableVertexAttribArray(aLoc); gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  var SU = uniforms(surf, ['uRes', 'uPtr', 'uTime', 'uProg', 'uIntro', 'uLobe', 'uFade', 'uPortal', 'uGrain', 'uPulse', 'uDissolve']);

  // Particles are optional: if their program fails, the surface still stands.
  var part = program(PART_VS, PART_FS), partVao = null, PU = null, COUNT = 0;
  // Particle count follows the viewport (about one per 22 CSS px), recomputed on resize.
  var zb = null;
  function sizeParticles() {
    if (!part) return;
    var area = (canvas.clientWidth || window.innerWidth) * (canvas.clientHeight || window.innerHeight);
    var next = Math.round(Math.min(42000, Math.max(12000, area / 22)));
    if (next === COUNT) return;
    COUNT = next;
    gl.bindVertexArray(partVao);
    if (!zb) zb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, zb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(COUNT * 2), gl.STATIC_DRAW);
    var zl = gl.getAttribLocation(part, 'aZ');
    gl.enableVertexAttribArray(zl); gl.vertexAttribPointer(zl, 1, gl.FLOAT, false, 0, 0);
  }
  if (part) {
    partVao = gl.createVertexArray();
    PU = uniforms(part, ['uRes', 'uPtr', 'uTime', 'uProg', 'uIntro', 'uLobe', 'uDissolve', 'uBurst', 'uPulse', 'uPortal']);
    sizeParticles();
  }

  /* -------------------------------------------------------------- ascii */
  // The whole scene, re-drawn as type. It renders into a texture, then each
  // screen cell becomes the glyph whose ink matches the cell's brightness,
  // tinted by the colour underneath. Cells read a mip level that averages their
  // whole area, so a one-pixel particle streak still turns a ':' on.
  var ASCII_VS = '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var ASCII_FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uScene,uAtlas;uniform vec2 uRes,uCell;uniform float uGlyphs,uMix,uSeed,uLod;',
    'out vec4 o;',
    'const vec3 BG=vec3(0.0824);',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'void main(){',
    '  vec2 fc=gl_FragCoord.xy;',
    '  vec3 scene=texture(uScene,fc/uRes).rgb;',
    '  vec2 cell=floor(fc/uCell);',
    '  vec2 cuv=(cell+.5)*uCell/uRes;',
    '  vec3 c=textureLod(uScene,cuv,uLod).rgb;',
    '  const vec3 Y=vec3(.299,.587,.114);',
    // Four fine taps per cell, keeping the brightest: one particle streak through a cell should light it.
    '  vec2 o1=uCell*.25/uRes;',
    '  float lmax=max(max(dot(textureLod(uScene,cuv+vec2(-o1.x,-o1.y),1.).rgb,Y),dot(textureLod(uScene,cuv+vec2(o1.x,-o1.y),1.).rgb,Y)),',
    '                 max(dot(textureLod(uScene,cuv+vec2(-o1.x,o1.y),1.).rgb,Y),dot(textureLod(uScene,cuv+vec2(o1.x,o1.y),1.).rgb,Y)));',
    '  float l=dot(c,Y);',
    // Density follows structure, not brightness: flat fog becomes a light dust,
    // ring edges and particles - where a cell differs from its surroundings - become the heavy strokes.
    '  float lb=dot(textureLod(uScene,cuv,uLod+1.6).rgb,vec3(.299,.587,.114));',
    '  float sat=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));',     // only the iridescent risers carry colour
    '  float d=clamp(.1*smoothstep(.07,.95,l)+5.*abs(l-lb)+3.5*max(lmax-lb-.03,0.)+2.2*sat,0.,1.);',
    '  d=clamp(d+(hash(cell+uSeed)-.5)*.05,0.,1.);',               // glyphs shimmer, stepped like film grain
    '  float gi=floor(d*(uGlyphs-1.)+.5);',
    '  vec2 local=fract(fc/uCell);',
    '  float m=texture(uAtlas,vec2((gi+local.x)/uGlyphs,1.-local.y)).r;',
    // Brightness comes from structure, hue from the scene: dust stays dim, edges and streaks burn.
    '  vec3 hue=mix(vec3(1.),c/max(.12,max(c.r,max(c.g,c.b))),.7);',
    '  vec3 ink=hue*(.3+.95*d)*mix(.55,1.,smoothstep(.0,.3,max(l,lmax)));',
    '  o=vec4(mix(scene,mix(BG,ink,m),uMix),1.);}'
  ].join('\n');
  var ascii = program(ASCII_VS, ASCII_FS), AU = null, asciiVao = null, fbo = null, sceneTex = null, atlasTex = null, GLYPHS = 1;
  if (ascii) {
    AU = uniforms(ascii, ['uScene', 'uAtlas', 'uRes', 'uCell', 'uGlyphs', 'uMix', 'uSeed', 'uLod']);
    asciiVao = gl.createVertexArray();
    gl.bindVertexArray(asciiVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var al = gl.getAttribLocation(ascii, 'a');
    gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    fbo = gl.createFramebuffer();
    sceneTex = gl.createTexture();
    atlasTex = gl.createTexture();
    buildAtlas();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildAtlas);
  }

  /** Glyphs sorted by how much ink they actually lay down in this font. */
  function buildAtlas() {
    var set = ' .`\'-:;,~^=+*!/|ixo%#@'.split('');
    var gw = 18, gh = 30, font = '500 24px "Geist Mono", ui-monospace, Menlo, Consolas, monospace';
    var probe = document.createElement('canvas'); probe.width = gw; probe.height = gh;
    var pc = probe.getContext('2d');
    var ink = set.map(function (ch) {
      pc.clearRect(0, 0, gw, gh); pc.fillStyle = '#fff'; pc.font = font; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.fillText(ch, gw / 2, gh / 2 + 1);
      var d = pc.getImageData(0, 0, gw, gh).data, s = 0;
      for (var i = 0; i < d.length; i += 4) s += d[i];
      return { ch: ch, ink: s };
    }).sort(function (a, b) { return a.ink - b.ink; });
    // keep 16 evenly spread steps of density
    var ramp = [];
    for (var k = 0; k < 16; k++) ramp.push(ink[Math.round(k * (ink.length - 1) / 15)].ch);
    GLYPHS = ramp.length;
    var at = document.createElement('canvas'); at.width = gw * GLYPHS; at.height = gh;
    var ac = at.getContext('2d');
    ac.fillStyle = '#000'; ac.fillRect(0, 0, at.width, at.height);
    ac.fillStyle = '#fff'; ac.font = font; ac.textAlign = 'center'; ac.textBaseline = 'middle';
    ramp.forEach(function (ch, i) { ac.fillText(ch, i * gw + gw / 2, gh / 2 + 1); });
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, at);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    window.__asciiRamp = ramp.join('');
  }

  function sizeScene() {
    if (!ascii) return;
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // On by default; the choice is remembered per viewer. ?ascii=0 or =1 overrides.
  // The field stays particles; type is for the charts. ?ascii=1 still shows the type pass.
  var asciiOn = false;
  var q = /[?&]ascii=([01])/.exec(location.search); if (q) asciiOn = q[1] === '1';
  if (!ascii) asciiOn = false;
  var asciiMix = asciiOn ? 1 : 0;
  window.__fieldAscii = asciiOn;
  window.setFieldAscii = function (on) {
    asciiOn = !!on && !!ascii; window.__fieldAscii = asciiOn;
    document.dispatchEvent(new CustomEvent('fieldascii', { detail: asciiOn }));
  };

  /* ------------------------------------------------------------ inputs */
  var lobes = new Float32Array([1, 1.1, 1.25, 1.1, .95, .85, .8, .9]);
  var lobeTarget = new Float32Array(lobes);

  /** Bucket probabilities -> 8 angular lobes; the field eases into the new shape. */
  window.setFieldOdds = function (p) {
    if (!p || p.length < 2) return;
    var out = new Float32Array(8);
    for (var i = 0; i < 8; i++) {
      var x = i / 8 * (p.length - 1), k = Math.floor(x), f = x - k;
      out[i] = p[k] * (1 - f) + p[Math.min(k + 1, p.length - 1)] * f;
    }
    var mean = out.reduce(function (s, v) { return s + v; }, 0) / 8;
    for (var j = 0; j < 8; j++) out[j] = Math.min(1.6, Math.max(0.55, 1 + 0.55 * (out[j] / mean - 1)));
    lobeTarget = out;
  };

  var pulseAt = -1e9;
  /** Send a wave through the rings and a spray of sparks from the centre. */
  window.fieldPulse = function () { pulseAt = performance.now(); };

  var ptr = { x: 0, y: 0 }, ptrT = { x: 0, y: 0 };
  window.addEventListener('pointermove', function (e) {
    ptrT.x = (e.clientX / window.innerWidth - 0.5) * 2;
    ptrT.y = -(e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
  window.addEventListener('pointerleave', function () { ptrT.x = 0; ptrT.y = 0; });

  /* ------------------------------------------------- adaptive resolution */
  // The target is the display's own refresh, measured, not an assumed 60Hz:
  // a 120Hz screen gets an 8.3ms budget, a 60Hz one 16.7ms. Pixels are shed when
  // frames overrun it and taken back when there is room.
  var MAXS = Math.min(window.devicePixelRatio || 1, 1.5), MINS = 0.45;
  var scale = Math.min(1, MAXS), ema = 8.3, slow = 0, fast = 0;
  var samples = [], refreshMs = 16.7;
  var W = 0, H = 0;
  function size() {
    W = canvas.clientWidth || window.innerWidth || 1280; H = canvas.clientHeight || window.innerHeight || 720;
    canvas.width = Math.max(2, Math.round(W * scale)); canvas.height = Math.max(2, Math.round(H * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    sizeParticles();
    sizeScene();
  }
  function adapt(dt) {
    if (dt > 100 || dt <= 0) return;
    // Learn the refresh interval from the first second of frames (median, so one hitch cannot skew it).
    if (samples.length < 90) {
      if (dt < 3 || dt > 40) return;                   // not a vsync interval
      samples.push(dt);
      if (samples.length === 90) {
        var s = samples.slice().sort(function (a, b) { return a - b; });
        refreshMs = Math.max(4, Math.min(34, s[45]));
        ema = refreshMs;
      }
      return;
    }
    // A GPU that cannot keep up misses by one or two intervals; a gap of more than three
    // is a throttled tab or a hitch, and must not cost the page its resolution.
    if (dt > refreshMs * 3) return;
    ema += (dt - ema) * 0.08;
    if (ema > refreshMs * 1.18) { slow++; fast = 0; }
    else if (ema < refreshMs * 1.04 && scale < MAXS) { fast++; slow = 0; }
    else { slow = fast = 0; }
    if (slow > 20 && scale > MINS) { scale = Math.max(MINS, scale * 0.85); size(); slow = 0; }
    if (fast > 240) { scale = Math.min(MAXS, scale * 1.08); size(); fast = 0; }
  }

  function targetProgress() {
    if (!track) return 0;
    var r = track.getBoundingClientRect();
    var span = r.height - window.innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
  }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /* -------------------------------------------------------------- loop */
  var t0 = performance.now(), last = t0, progS = targetProgress(), frames = 0, fpsWin = t0, fps = 0;
  var introStart = SHORT ? 0.0 : 0.35;
  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt / 1000)); }

  function common(U, t, intro) {
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uPtr, reduce ? 0 : ptr.x, reduce ? 0 : ptr.y);
    gl.uniform1f(U.uTime, reduce ? 0 : t);
    gl.uniform1f(U.uProg, progS);
    gl.uniform1f(U.uIntro, intro);
    gl.uniform1fv(U.uLobe, lobes);
  }

  function frame(now) {
    var dt = now - last; last = now;
    var t = (now - t0) / 1000;
    if ((canvas.clientWidth && canvas.clientWidth !== W) || (canvas.clientHeight && canvas.clientHeight !== H)) size();

    progS = damp(progS, targetProgress(), 7, dt);
    ptr.x = damp(ptr.x, ptrT.x, 3.2, dt); ptr.y = damp(ptr.y, ptrT.y, 3.2, dt);
    for (var i = 0; i < 8; i++) lobes[i] = damp(lobes[i], lobeTarget[i], 2.2, dt);

    var fade = reduce ? 1 : Math.min(1, Math.max(0, (t - introStart) / 0.55));
    var intro = reduce ? 1 : Math.min(1, Math.max(0, (t - (SHORT ? 0.15 : 0.9)) / (SHORT ? 1.6 : 2.3)));
    var pulse = (now - pulseAt) / 1000;
    var pulseU = pulse > 0 && pulse < 2.2 ? pulse : 9;
    var dissolve = PORTAL ? smooth(0.12, 0.55, progS) : smooth(0.15, 0.85, progS);
    var burst = PORTAL ? smooth(0.72, 0.95, progS) : 0;
    asciiMix = reduce ? (asciiOn ? 1 : 0) : damp(asciiMix, asciiOn ? 1 : 0, 6, dt);
    var toTexture = ascii && asciiMix > 0.002;

    gl.bindFramebuffer(gl.FRAMEBUFFER, toTexture ? fbo : null);
    gl.disable(gl.BLEND);
    gl.useProgram(surf); gl.bindVertexArray(surfVao);
    common(SU, t, intro);
    gl.uniform1f(SU.uFade, fade);
    gl.uniform1f(SU.uPortal, PORTAL ? 1 : 0);
    gl.uniform1f(SU.uGrain, reduce ? 0 : Math.floor(t * 24) % 97);
    gl.uniform1f(SU.uPulse, pulseU);
    gl.uniform1f(SU.uDissolve, dissolve);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (part) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);            // light adds up, like long exposure
      gl.useProgram(part); gl.bindVertexArray(partVao);
      common(PU, t, intro * fade);
      gl.uniform1f(PU.uDissolve, dissolve);
      gl.uniform1f(PU.uBurst, burst);
      gl.uniform1f(PU.uPulse, pulseU);
      gl.uniform1f(PU.uPortal, PORTAL ? 1 : 0);
      gl.drawArrays(gl.LINES, 0, COUNT * 2);
      gl.disable(gl.BLEND);
    }

    if (toTexture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      if (!(window.__fieldFlags && window.__fieldFlags.noMip)) gl.generateMipmap(gl.TEXTURE_2D);
      gl.useProgram(ascii); gl.bindVertexArray(asciiVao);
      var px = canvas.width / Math.max(1, canvas.clientWidth || W);   // buffer pixels per CSS pixel
      var cw = 7 * px, ch = 12 * px;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(AU.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(AU.uAtlas, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(AU.uRes, canvas.width, canvas.height);
      gl.uniform2f(AU.uCell, cw, ch);
      gl.uniform1f(AU.uGlyphs, GLYPHS);
      gl.uniform1f(AU.uMix, asciiMix);
      gl.uniform1f(AU.uSeed, reduce ? 0 : Math.floor(t * 12) % 61);
      gl.uniform1f(AU.uLod, Math.log2(Math.max(cw, ch) * 0.7));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    document.documentElement.style.setProperty('--prog', progS.toFixed(4));
    if (t > 0.9) document.documentElement.classList.add('field-ready');
    frames++;
    if (now - fpsWin >= 1000) { fps = Math.round(frames * 1000 / (now - fpsWin)); frames = 0; fpsWin = now; }
    if (!reduce && !benching) adapt(dt);
    window.__field = { fps: fps, refreshHz: Math.round(1000 / refreshMs), scale: Math.round(scale * 100) / 100, prog: progS,
      particles: part ? COUNT : 0, dissolve: Math.round(dissolve * 100) / 100, buffer: [canvas.width, canvas.height] };
    if (hud && now - hudAt > 250) {
      hudAt = now;
      hud.textContent = fps + ' fps · ' + Math.round(1000 / refreshMs) + ' Hz display · ' +
        Math.round(scale * 100) + '% res · ' + (part ? COUNT.toLocaleString('en-US') : 0) + ' particles';
    }
  }

  /** Dev: full frames (surface + particles) rendered back to back, GPU-synchronised. ms per frame. */
  var benching = false;
  window.__fieldBench = function (n, w, h) {
    benching = true;
    var px = new Uint8Array(4), keepW = canvas.width, keepH = canvas.height;
    if (w && h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); sizeScene(); }
    var now = performance.now();
    frame(now); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var t = performance.now();
    for (var i = 0; i < n; i++) { frame(t + i * 8); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    var ms = (performance.now() - t) / n;
    canvas.width = keepW; canvas.height = keepH; gl.viewport(0, 0, keepW, keepH); sizeScene();
    benching = false;
    return Math.round(ms * 100) / 100;
  };

  /* ---------------------------------------------------------------- hud */
  // ?hud in the URL, or F, shows the live frame rate against the display's refresh.
  var hud = null, hudAt = 0;
  function toggleHud() {
    if (hud) { hud.remove(); hud = null; return; }
    hud = document.createElement('div');
    hud.setAttribute('aria-hidden', 'true');
    hud.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;font:500 11px/1 "Geist Mono",ui-monospace,monospace;' +
      'letter-spacing:.04em;color:#f3f1ea;background:rgba(21,21,21,.78);padding:8px 10px;border:1px solid rgba(228,226,216,.24);pointer-events:none';
    document.body.appendChild(hud);
  }
  if (/[?&]hud\b/.test(location.search)) toggleHud();
  window.addEventListener('keydown', function (e) {
    if ((e.key === 'f' || e.key === 'F') && !/input|textarea|select/i.test((e.target && e.target.tagName) || '')) toggleHud();
  });

  function loop(now) {
    var r = track ? track.getBoundingClientRect() : { bottom: 1 };
    if (r.bottom > -40 && !document.hidden) frame(now);
    else last = now;
    requestAnimationFrame(loop);
  }

  size();
  if (reduce) {
    var still = function () { last = performance.now(); frame(performance.now() + 4000); };
    still();
    window.addEventListener('scroll', still, { passive: true });
    window.addEventListener('resize', function () { size(); still(); });
  } else {
    requestAnimationFrame(loop);
  }
})();
