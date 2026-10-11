// The surface behind the page: a stack of twenty planes, each cut by the same noise height
// field at a different threshold, so only the rim of each terrace shows and the field reads
// as contour rings. Grey plates lit from one side; the cursor stirs a small fluid field that
// ripples the rings; then a directional blur, exposure, chromatic aberration and grain.
//
//   const s = await createSurface(canvas);
//   s.setTime(t)          // position on the 13-unit timeline (0-2 intro, 2-10.27 scroll, 11-13 footer)
//   s.quality(0.5..1)     // render scale
//   s.pause() / s.resume()
import * as THREE from 'three';
import { TIMELINE, evalTrack } from './timeline.js';

const SIMPLEX = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;

// the height field: two octaves of simplex, drawn once (hero) or slowly drifting (footer).
// A bowl can be sunk into it, centred where the camera dives, so the terraces ring that point.
const HEIGHT_FRAG = /* glsl */`
varying vec2 vUv; uniform float uSeed,uTime,uScale,uTimeScale,uNoiseOffset,uBowlDepth,uBowlRadius,uWobble; uniform vec2 uNoiseTranslation,uBowlCenter;
${SIMPLEX}
void main(){
  vec2 uv=(vUv+uNoiseTranslation)*uScale;
  float n=.5+.5*snoise(vec3(uv.x,uv.y,uSeed+uTime*uTimeScale));
  float n2=.5+.5*snoise(vec3(2.*uv.x,2.*uv.y,1.+uSeed+uTime*uTimeScale));
  n=mix(n,n2,.5);
  vec2 d=vUv-uBowlCenter; float bowl=1.0-exp(-dot(d,d)/(uBowlRadius*uBowlRadius));
  n=mix(n,0.5+(n-0.5)*uWobble+bowl*uBowlDepth,step(0.001,uBowlDepth))+uNoiseOffset;
  gl_FragColor=vec4(vec3(n),1.0);
}`;

// a tileable three-channel noise used to jitter the field (stands in for a noise photo)
const RGB_NOISE_FRAG = /* glsl */`
varying vec2 vUv;
${SIMPLEX}
void main(){
  vec2 p=vUv*6.0;
  float a=.5+.5*snoise(vec3(p,3.1)); float b=.5+.5*snoise(vec3(p+7.0,9.7)); float c=.5+.5*snoise(vec3(p-3.0,17.3));
  gl_FragColor=vec4(a,b,c,1.0);
}`;

// the fluid: a velocity field the cursor pushes, carried along itself and slowly fading
const FLUID_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tPrev; uniform vec2 uMouse,uPrevMouse,uTexel; uniform float uRadius,uForce,uDissipate,uAspect,uDt; uniform bool uActive;
void main(){
  vec2 v=texture2D(tPrev,vUv).xy;
  vec2 back=vUv-v*uDt*0.35;
  v=texture2D(tPrev,back).xy*uDissipate;
  if(uActive){
    vec2 d=vUv-uMouse; d.x*=uAspect;
    float r=length(d);
    vec2 push=(uMouse-uPrevMouse)*uForce;
    v+=push*exp(-r*r/(uRadius*uRadius));
  }
  gl_FragColor=vec4(v,0.0,1.0);
}`;

const LAYER_VERT = /* glsl */`
attribute float aLayerOffset; varying vec2 vUv; varying float vLayerOffset; varying vec3 vWorldPosition;
uniform float uTime,uCycleOffset,uCycleSpeed;
void main(){
  vUv=uv;
  vec4 p=instanceMatrix*vec4(position,1.0);
  float lo=mod(uTime*uCycleSpeed+aLayerOffset+uCycleOffset,1.0);
  p.z+=lo; vLayerOffset=lo; vWorldPosition=p.xyz;
  gl_Position=projectionMatrix*modelViewMatrix*p;
}`;

const LAYER_FRAG = /* glsl */`
varying vec2 vUv; varying float vLayerOffset; varying vec3 vWorldPosition;
uniform sampler2D tHeightNoise,tNoise,tFluid;
uniform vec3 uColor1,uColor2,uColor3,uColor4,uColor5,uLineColor,uShadowColor,uLightColor;
uniform float uColorStep1,uColorStep2,uColorStep3,uColorStep4,uColorStep5;
uniform vec2 uColorHeightRange,uShadowRange,uLightRange,uResolution,uLightPos;
uniform float uShadowStrength,uShadowOffset,uLightOffset,uLightStrength,uLightShininess,uDepthOffset,uHeight;
uniform float uHeightNoiseSpeed,uHeightNoiseStrength,uHeightNoiseScale,uTime,uFluidStrength;
uniform bool uIsFooter,uFluidEnabled,uFluidEdgeEnabled;
float map(float v,float a,float b,float c,float d){return c+(v-a)*(d-c)/(b-a);}
float aastep(float value,float threshold){float w=fwidth(value);return smoothstep(threshold-w,threshold+w,value);}
float sampleNoise(vec2 uv,float layer){
  float n=texture2D(tHeightNoise,uv).r; n-=layer;
  float fluid=0.;
  if(uFluidEdgeEnabled){vec2 f=texture2D(tFluid,gl_FragCoord.xy/uResolution).rg; fluid=(f.r+f.g)*0.004;}
  return n+fluid;
}
void main(){
  float layerOffset;
  if(uIsFooter){layerOffset=vLayerOffset*abs(uDepthOffset*((vLayerOffset+0.3)*2.-1.))*0.25;}
  else{layerOffset=vLayerOffset*uDepthOffset;}
  vec3 noise=texture2D(tNoise,vUv*uHeightNoiseScale+uTime*uHeightNoiseSpeed).rgb;
  vec2 off=noise.rg*uHeightNoiseStrength;
  if(vLayerOffset<0.94){
    float above=aastep(sampleNoise(vUv+off,layerOffset+0.05),uHeight+0.1);
    if(above>.01) discard;
  }
  float shape=sampleNoise(vUv+off,layerOffset);
  float n=aastep(shape,uHeight);
  if(uIsFooter&&vLayerOffset<0.06) n=1.;
  if(n<0.001) discard;
  float fluid=0.;
  if(uFluidEnabled){vec2 f=texture2D(tFluid,gl_FragCoord.xy/uResolution).rg; fluid=(f.r+f.g)*uFluidStrength;}
  vec3 lightPos=vec3(uLightPos,100.); vec3 dir=-lightPos;
  vec2 uvc=(vUv+off)-uShadowOffset*normalize(dir.xy);
  float shadow=texture2D(tHeightNoise,uvc).r; shadow-=layerOffset; shadow+=fluid*0.1;
  shadow=smoothstep(uHeight+uShadowRange.x,uHeight+uShadowRange.y,shadow)*uShadowStrength;
  if(vLayerOffset>0.94) shadow=0.;
  float dist=map(vWorldPosition.z,uColorHeightRange.x,uColorHeightRange.y,0.,1.); dist+=fluid*2.;
  vec3 c=mix(uColor1,uColor2,smoothstep(uColorStep1,uColorStep2,dist));
  c=mix(c,uColor3,smoothstep(uColorStep2,uColorStep3,dist));
  c=mix(c,uColor4,smoothstep(uColorStep3,uColorStep4,dist));
  c=mix(c,uColor5,smoothstep(uColorStep4,uColorStep5,dist*0.2));
  c+=abs(fluid)*5.;
  c+=c*smoothstep(uHeight+0.002,uHeight,shape)*0.05;
  lightPos=vec3(-uLightPos,100.); dir=-lightPos;
  uvc=(vUv+off)-uLightOffset*normalize(dir.xy);
  float hl=texture2D(tHeightNoise,uvc).r; hl-=layerOffset;
  hl=smoothstep(uHeight+uLightRange.x,uHeight+uLightRange.y,hl);
  if(vLayerOffset>0.94) hl=0.;
  c+=uLightColor*pow(hl,uLightShininess)*uLightStrength;
  c=mix(c,uShadowColor,shadow);
  gl_FragColor=vec4(c,n);
}`;

// pass 1: a directional blur, exposure, lifted shadows, a darker foot
const BLUR_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform float uAngle,uDistance,uExposure,uShadowLift,uBottomFadeStrength,uBottomFadeStart; uniform int uSamples;
void main(){
  vec4 col;
  if(uDistance>0.0){
    float a=radians(uAngle); vec2 dir=vec2(cos(a),sin(a)); vec2 step=dir*uDistance/uResolution;
    vec4 acc=vec4(0.0); float tw=0.0;
    for(int i=0;i<29;i++){ if(i>=uSamples) break; float t=float(i)/float(uSamples-1)-0.5; float w=1.0-abs(t*2.0); acc+=texture2D(tDiffuse,clamp(vUv+step*t,0.0,1.0))*w; tw+=w; }
    col=acc/tw;
  } else col=texture2D(tDiffuse,vUv);
  col.rgb*=uExposure;
  col.rgb=mix(vec3(uShadowLift),vec3(1.0),col.rgb);
  float fade=smoothstep(0.0,uBottomFadeStart,vUv.y);
  col.rgb*=mix(1.0-uBottomFadeStrength,1.0,fade);
  gl_FragColor=vec4(col.rgb,1.0);
}`;

// pass 2: chromatic aberration (five spectral samples through a barrel distortion), vignette, grain
const POST_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform float uMaxDistort,uBendAmount,uNoiseStrength,uVignetteStrength,uVignetteInner,uVignetteOuter,uTime; uniform bool uChroma,uVignette;
vec2 barrel(vec2 coord,float amt){vec2 cc=coord-0.5; float d=dot(cc,cc); return coord+cc*d*amt;}
float sat(float t){return clamp(t,0.0,1.0);}
float linterp(float t){return sat(1.0-abs(2.0*t-1.0));}
float remap(float t,float a,float b){return sat((t-a)/(b-a));}
vec4 spectrum(float t){ float lo=step(t,0.5); float hi=1.0-lo; float w=linterp(remap(t,1.0/6.0,5.0/6.0)); vec4 r=vec4(lo,1.0,hi,1.)*vec4(1.0-w,w,1.0-w,1.); return pow(r,vec4(1.0/2.2)); }
float random(vec2 p){vec3 p3=fract(vec3(p.xyx)*443.8975); p3+=dot(p3,p3.yzx+19.19); return fract((p3.x+p3.y)*p3.z);}
vec3 softLight(vec3 b,vec3 s,float k){ vec3 r=mix(2.0*b*s+b*b*(1.0-2.0*s), sqrt(b)*(2.0*s-1.0)+2.0*b*(1.0-s), step(0.5,s)); return mix(b,r,k); }
void main(){
  vec4 col;
  if(uChroma){
    vec4 sum=vec4(0.0),sw=vec4(0.0);
    for(int i=0;i<5;i++){ float t=float(i)/5.0; vec4 w=spectrum(t); sw+=w; sum+=w*texture2D(tDiffuse,barrel(vUv,uBendAmount*uMaxDistort*t)); }
    col=sum/sw;
  } else col=texture2D(tDiffuse,vUv);
  if(uVignette){
    vec2 coord=(vUv-0.5)*(uResolution.x/uResolution.y)*2.0;
    float rf=1.0+dot(coord,coord)*uVignetteInner*uVignetteInner; float v=1.0/(rf*rf);
    vec2 uv2=vUv*(1.0-vUv.yx); v*=pow(uv2.x*uv2.y*20.0,uVignetteOuter); v=clamp(v,0.0,1.0);
    col.rgb=mix(vec3(0.0),col.rgb,sat(v+(1.-uVignetteStrength)));
  }
  float g=random(vUv+fract(uTime))-0.5;
  col.rgb=softLight(col.rgb,vec3(g),uNoiseStrength);
  gl_FragColor=vec4(col.rgb,1.0);
}`;

const GREY = new THREE.Color(0.7765, 0.7765, 0.7765);
const BASE = {
  // the hero plates (static overrides of the timeline, in order of the file)
  hero: {
    uColor1: GREY.clone(), uColor2: GREY.clone(), uColor3: GREY.clone(), uColor4: GREY.clone(), uColor5: GREY.clone(),
    uColorStep1: 0.192, uColorStep2: 0.373, uColorStep3: 0.6194, uColorStep4: 0.8164, uColorStep5: 1,
    uColorHeightRange: new THREE.Vector2(0, 1),
    uLineColor: new THREE.Color(0.141, 0.137, 0.102), uShadowColor: new THREE.Color(0, 0, 0),
    uShadowStrength: 0.858, uShadowRange: new THREE.Vector2(0.00635, 0.01429), uShadowOffset: 0.0075,
    uLightColor: new THREE.Color(0.839, 0.812, 0.780), uLightRange: new THREE.Vector2(0.046, 0.1063), uLightOffset: 0.068,
    uLightStrength: 0.437, uLightShininess: 1.04, uLightPos: new THREE.Vector2(-0.37, 0.107),
    uDepthOffset: 0.175, uHeight: 0.426, uHeightNoiseSpeed: 0.00111, uHeightNoiseStrength: 0.024, uHeightNoiseScale: 0.16,
    uCycleSpeed: 0, uCycleOffset: 0, uFluidStrength: 0.057, uIsFooter: false,
    // a bowl where the camera dives (its floor just under the first cut height), simplex wobble on top
    noise: { uSeed: 1230, uScale: 0.727, uTimeScale: 0, uNoiseOffset: 0.0, uNoiseTranslation: new THREE.Vector2(-0.19, -0.12), bowl: { center: new THREE.Vector2(0.45, 0.37), radius: 0.34, depth: 0.62, wobble: 0.16 } },
  },
  footer: {
    uColor1: new THREE.Color(0.694, 0.694, 0.694), uColor2: GREY.clone(), uColor3: GREY.clone(), uColor4: GREY.clone(), uColor5: GREY.clone(),
    uColorStep1: 0, uColorStep2: 0.31, uColorStep3: 0.524, uColorStep4: 0.7947, uColorStep5: 0.9493,
    uColorHeightRange: new THREE.Vector2(0, 1),
    uLineColor: new THREE.Color(0.718, 0.349, 0.192), uShadowColor: new THREE.Color(0, 0, 0),
    uShadowStrength: 0.642, uShadowRange: new THREE.Vector2(0.00794, 0.03651), uShadowOffset: 0.001,
    uLightColor: new THREE.Color(0.239, 0.318, 0.459), uLightRange: new THREE.Vector2(0, 0.1), uLightOffset: 0.05,
    uLightStrength: 0.043, uLightShininess: 5, uLightPos: new THREE.Vector2(-0.77, 1.186),
    uDepthOffset: 0.298, uHeight: 0.541, uHeightNoiseSpeed: 0.00351, uHeightNoiseStrength: 0.026, uHeightNoiseScale: 0.23,
    uCycleSpeed: 0, uCycleOffset: 0, uFluidStrength: 0.07, uIsFooter: true,
    // lifted so the plates sit above the cut and shade grey, with the rims where the field dips
    noise: { uSeed: 100, uScale: 0.87, uTimeScale: 0.0553, uNoiseOffset: 0.08, uNoiseTranslation: new THREE.Vector2(-0.434, -0.236) },
  },
};

function uniformsFrom(cfg, shared) {
  const u = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== 'noise') u[k] = { value: v && v.clone ? v.clone() : v };
  Object.assign(u, shared);
  return u;
}

export async function createSurface(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x151515, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let scale = opts.quality || Math.min(1.5, window.devicePixelRatio || 1);
  const size = new THREE.Vector2();

  const camera = new THREE.PerspectiveCamera(70.71, 1, 0.1, 50);
  camera.rotation.order = 'XYZ';
  const scene = new THREE.Scene();

  // ---- offscreen generators
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const rtScene = new THREE.Scene(); rtScene.add(quad);
  const rtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function renderTo(target, material) { quad.material = material; renderer.setRenderTarget(target); renderer.render(rtScene, rtCam); renderer.setRenderTarget(null); }
  const noiseOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, wrapS: THREE.MirroredRepeatWrapping, wrapT: THREE.MirroredRepeatWrapping, depthBuffer: false };
  const heightRT = { hero: new THREE.WebGLRenderTarget(256, 256, noiseOpts), footer: new THREE.WebGLRenderTarget(256, 256, noiseOpts) };
  const heightMat = { hero: null, footer: null };
  for (const k of ['hero', 'footer']) {
    const n = BASE[k].noise;
    const b = n.bowl || { center: new THREE.Vector2(0.5, 0.5), radius: 1, depth: 0, wobble: 1 };
    heightMat[k] = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: HEIGHT_FRAG, uniforms: { uSeed: { value: n.uSeed }, uTime: { value: 0 }, uScale: { value: n.uScale }, uTimeScale: { value: n.uTimeScale }, uNoiseOffset: { value: n.uNoiseOffset }, uNoiseTranslation: { value: n.uNoiseTranslation.clone() }, uBowlCenter: { value: b.center.clone() }, uBowlRadius: { value: b.radius }, uBowlDepth: { value: b.depth }, uWobble: { value: b.wobble } } });
    renderTo(heightRT[k], heightMat[k]);
  }
  const rgbRT = new THREE.WebGLRenderTarget(256, 256, { ...noiseOpts, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  renderTo(rgbRT, new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: RGB_NOISE_FRAG }));

  // ---- the fluid the cursor stirs
  const fluidOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: false };
  let fluidA = new THREE.WebGLRenderTarget(128, 128, fluidOpts), fluidB = new THREE.WebGLRenderTarget(128, 128, fluidOpts);
  const fluidMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: FLUID_FRAG, uniforms: {
    tPrev: { value: null }, uMouse: { value: new THREE.Vector2(-1, -1) }, uPrevMouse: { value: new THREE.Vector2(-1, -1) }, uTexel: { value: new THREE.Vector2(1 / 128, 1 / 128) },
    uRadius: { value: 0.07 }, uForce: { value: 4.23 }, uDissipate: { value: 0.96 }, uAspect: { value: 1 }, uDt: { value: 1 / 60 }, uActive: { value: false } } });
  const mouse = { x: -1, y: -1, px: -1, py: -1, active: false, t: 0 };
  const onMove = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width; mouse.y = 1 - (e.clientY - r.top) / r.height; mouse.active = true; mouse.t = performance.now(); };
  window.addEventListener('pointermove', onMove, { passive: true });

  // ---- the plates
  const shared = { tHeightNoise: { value: heightRT.hero.texture }, tNoise: { value: rgbRT.texture }, tFluid: { value: fluidA.texture }, uResolution: { value: size }, uTime: { value: 0 }, uFluidEnabled: { value: true }, uFluidEdgeEnabled: { value: !window.matchMedia('(pointer: coarse)').matches } };
  function plates(kind) {
    const geo = new THREE.PlaneGeometry(1, 1);   // five units across once the instances scale it
    const mat = new THREE.ShaderMaterial({ vertexShader: LAYER_VERT, fragmentShader: LAYER_FRAG, uniforms: uniformsFrom(BASE[kind], { ...shared, tHeightNoise: { value: heightRT[kind].texture } }), transparent: true, depthWrite: true, side: THREE.FrontSide });
    const mesh = new THREE.InstancedMesh(geo, mat, 20);
    const m = new THREE.Matrix4().makeScale(5, 5, 5), offs = new Float32Array(20);
    for (let i = 0; i < 20; i++) { mesh.setMatrixAt(i, m); offs[i] = (i + 1) / 20; }
    geo.setAttribute('aLayerOffset', new THREE.InstancedBufferAttribute(offs, 1));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }
  const hero = plates('hero'), footer = plates('footer');
  footer.visible = false;

  // ---- post
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
  const blurRT = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const blurMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, uniforms: { tDiffuse: { value: sceneRT.texture }, uResolution: { value: size }, uAngle: { value: -45 }, uDistance: { value: 58 }, uExposure: { value: 1.6 }, uShadowLift: { value: 0.3 }, uBottomFadeStrength: { value: 0.6 }, uBottomFadeStart: { value: 0.45 }, uSamples: { value: 29 } } });
  const postMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: POST_FRAG, uniforms: { tDiffuse: { value: blurRT.texture }, uResolution: { value: size }, uMaxDistort: { value: 2.016 }, uBendAmount: { value: -0.152 }, uNoiseStrength: { value: 0.1 }, uVignetteStrength: { value: 0.89 }, uVignetteInner: { value: 0.19 }, uVignetteOuter: { value: 0.45 }, uTime: { value: 0 }, uChroma: { value: true }, uVignette: { value: false } } });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(1); renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
    size.set(Math.round(w * scale), Math.round(h * scale));
    sceneRT.setSize(size.x, size.y); blurRT.setSize(size.x, size.y);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fluidMat.uniforms.uAspect.value = w / h;
  }
  resize(); window.addEventListener('resize', resize);

  // ---- the timeline: one position drives the camera, the plates and the post passes
  const state = { t: 0, active: true, mouseAngle: 0.03, roll: 0.1 };
  const look = { x: 0, y: 0 };
  function setTime(t) { state.t = t; }
  function applyTimeline(now) {
    const T = state.t, v = (track, dflt) => { const x = evalTrack(TIMELINE[track], T); return x == null ? dflt : x; };
    const px = v('cam.px', -0.665), py = v('cam.py', -1.078), pz = v('cam.pz', 1.402);
    const rx = v('cam.rx', 0.622), ry = v('cam.ry', -0.343), rz = v('cam.rz', -0.448);
    camera.fov = v('cam.fov', 70.71); camera.updateProjectionMatrix();
    const ma = v('cam.mouseAngle', 0.03);
    // a little parallax and roll with the cursor
    const tx = mouse.active ? (mouse.x - 0.5) * 2 : 0, ty = mouse.active ? (mouse.y - 0.5) * 2 : 0;
    look.x += (tx - look.x) * 0.04; look.y += (ty - look.y) * 0.04;
    camera.position.set(px, py, pz);
    camera.rotation.set(rx + look.y * ma, ry + look.x * ma, rz + look.x * ma * state.roll);
    const hu = hero.material.uniforms;
    hu.uHeight.value = v('hero.uHeight', 0.426); hu.uCycleOffset.value = v('hero.uCycleOffset', 0); hu.uShadowStrength.value = v('hero.uShadowStrength', 0.787);
    hu.uLightStrength.value = v('hero.uLightStrength', 0.437); hu.uShadowOffset.value = v('hero.uShadowOffset', 0.0075);
    hu.uHeightNoiseStrength.value = v('hero.uHeightNoiseStrength', 0.024); hu.uHeightNoiseScale.value = v('hero.uHeightNoiseScale', 0.16);
    hero.visible = T < 10.267;
    const fu = footer.material.uniforms;
    footer.visible = T >= 11; fu.uHeight.value = v('footer.uHeight', 0.659); fu.uDepthOffset.value = v('footer.uDepthOffset', 0.734);
    postMat.uniforms.uBendAmount.value = v('post.bend', -0.152);
    postMat.uniforms.uNoiseStrength.value = v('post.noise', 0.1);
    postMat.uniforms.uVignette.value = false;
    postMat.uniforms.uTime.value = now / 1000;
    shared.uTime.value = now / 1000; hu.uTime.value = now / 1000; fu.uTime.value = now / 1000;
  }

  let last = performance.now(), raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!state.active) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // the footer field drifts slowly; redraw it only while the footer shows
    if (footer.visible) { heightMat.footer.uniforms.uTime.value = now / 1000; renderTo(heightRT.footer, heightMat.footer); }
    // fluid step
    fluidMat.uniforms.tPrev.value = fluidA.texture; fluidMat.uniforms.uDt.value = dt;
    fluidMat.uniforms.uActive.value = mouse.active && now - mouse.t < 120;
    fluidMat.uniforms.uMouse.value.set(mouse.x, mouse.y); fluidMat.uniforms.uPrevMouse.value.set(mouse.px < 0 ? mouse.x : mouse.px, mouse.py < 0 ? mouse.y : mouse.py);
    renderTo(fluidB, fluidMat); [fluidA, fluidB] = [fluidB, fluidA];
    hero.material.uniforms.tFluid.value = fluidA.texture; footer.material.uniforms.tFluid.value = fluidA.texture;
    mouse.px = mouse.x; mouse.py = mouse.y;
    applyTimeline(now);
    renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x151515, 1); renderer.clear(); renderer.render(scene, camera);
    renderTo(blurRT, blurMat);
    quad.material = postMat; renderer.setRenderTarget(null); renderer.render(rtScene, rtCam);
  }
  raf = requestAnimationFrame(frame);

  return {
    setTime, renderer, camera, scene, hero, footer, post: postMat, blur: blurMat, state,
    quality(q) { scale = q; resize(); },
    pause() { state.active = false; }, resume() { state.active = true; last = performance.now(); },
    dispose() { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); window.removeEventListener('resize', resize); renderer.dispose(); },
  };
}
