// Bassin d'Arcachon — carte 3D interactive
// Relief marin : EMODnet Bathymetry (≈ zéro hydrographique). Dune du Pilat : IGN RGE ALTI.
// Milieux, forêts, ports, balisage, cabanes, toponymes : OpenStreetMap (ODbL).
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { lowPolyLand, gridGeometry, pineGeometry, buildForest, stiltHut, groundHut, layoutStilt, buildClouds, mulberry32 } from './land.js';
import { initTuto } from './tuto.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const DATA_V = '6'; // invalide le cache navigateur à chaque mise à jour des données
const getJSON = (u) => fetch(`${u}?v=${DATA_V}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const getBin = (u) => fetch(`${u}?v=${DATA_V}`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
const getImg = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = `${u}?v=${DATA_V}`; });
const EMPTY = { type: 'FeatureCollection', features: [] };
const fmt = (v, n = 1) => v.toFixed(n).replace('.', ',').replace('-', '−');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const MOBILE = innerWidth < 760 || matchMedia('(pointer: coarse)').matches;

// ================================================================ données
const [META, bin, ZONES0, SEAMARKS0, NAVLINES0, PORTS0, PLACES0, COMMUNES, PMETA, pbin, LANDMARKS0, COVER_IMG, LAKES0] = await Promise.all([
  getJSON('data/bathy.json'), getBin('data/bathy.bin'),
  getJSON('data/zones.geojson'), getJSON('data/seamarks.geojson'), getJSON('data/navlines.geojson'),
  getJSON('data/ports.geojson'), getJSON('data/places.geojson'), getJSON('data/communes.json'),
  getJSON('data/pilat.json'), getBin('data/pilat.bin'), getJSON('data/landmarks.json'), getImg('data/landcover.png'), getJSON('data/lakes.geojson'),
]);
const ZONES = ZONES0 ?? EMPTY, SEAMARKS = SEAMARKS0 ?? EMPTY, NAVLINES = NAVLINES0 ?? EMPTY, PORTS = PORTS0 ?? EMPTY, PLACES = PLACES0 ?? EMPTY;
const LANDMARKS = LANDMARKS0 ?? [];
const LAKES = LAKES0 ?? EMPTY;
const HCM = new Int16Array(bin);
const GW = META.width, GH = META.height;
// GeoTIFF « pixel-is-area » : chaque sommet est placé au CENTRE de son pixel.
const pxLon = (META.east - META.west) / GW, pxLat = (META.north - META.south) / GH;
const W = META.west + pxLon / 2, E = META.east - pxLon / 2, N = META.north - pxLat / 2, S = META.south + pxLat / 2;
const LON0 = (W + E) / 2, LAT0 = (S + N) / 2;
const U = 10; // 1 unité de scène = 10 m
const MX = (111320 * Math.cos((LAT0 * Math.PI) / 180)) / U, MZ = 111132 / U;
const WU = (E - W) * MX, HU = (N - S) * MZ;
const proj = (lon, lat) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const unproj = (x, z) => [x / MX + LON0, -z / MZ + LAT0];
const dxm = ((E - W) / (GW - 1)) * MX * U, dzm = ((N - S) / (GH - 1)) * MZ * U;
const bilin = (A, w, h, fx, fy) => {
  if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), tx = fx - x0, ty = fy - y0;
  return (A[y0 * w + x0] * (1 - tx) + A[y0 * w + x1] * tx) * (1 - ty) + (A[y1 * w + x0] * (1 - tx) + A[y1 * w + x1] * tx) * ty;
};

// ---- relief fin de la Dune du Pilat (IGN), raccordé à la grille EMODnet
const H0 = new Float32Array(GW * GH); for (let k = 0; k < H0.length; k++) H0[k] = HCM[k] / 100;
const mainAt = (A, lon, lat) => bilin(A, GW, GH, ((lon - W) / (E - W)) * (GW - 1), ((N - lat) / (N - S)) * (GH - 1));
let PIL = null;
if (PMETA && pbin) {
  const { west: pw, east: pe, south: ps, north: pn, width: pw_, height: ph_ } = PMETA;
  const raw = new Int16Array(pbin), PH = new Float32Array(pw_ * ph_);
  for (let j = 0; j < ph_; j++) for (let i = 0; i < pw_; i++) {
    const k = j * pw_ + i, lon = pw + (i / (pw_ - 1)) * (pe - pw), lat = pn - (j / (ph_ - 1)) * (pn - ps);
    const ign = raw[k] / 100, base = mainAt(H0, lon, lat) ?? ign;
    let h = base + (ign - base) * smooth(1.5, 3.5, ign);            // la mer reste EMODnet, la dune vient de l'IGN
    h = base + (h - base) * smooth(0, 8, Math.min(i, j, pw_ - 1 - i, ph_ - 1 - j)); // raccord progressif sur les bords
    PH[k] = h;
  }
  PIL = { w: pw, e: pe, s: ps, n: pn, cols: pw_, rows: ph_, H: PH };
}
const inPilat = (lon, lat) => PIL && lon > PIL.w && lon < PIL.e && lat > PIL.s && lat < PIL.n;

// ---- terre « low-poly » (l'eau et l'estran ne sont pas modifiés)
const HS = lowPolyLand(H0, GW, GH, MOBILE ? 6 : 5, (i, j) => inPilat(W + (i / (GW - 1)) * (E - W), N - (j / (GH - 1)) * (N - S)));
function heightAt(lon, lat) {
  if (inPilat(lon, lat)) return bilin(PIL.H, PIL.cols, PIL.rows, ((lon - PIL.w) / (PIL.e - PIL.w)) * (PIL.cols - 1), ((PIL.n - lat) / (PIL.n - PIL.s)) * (PIL.rows - 1));
  return mainAt(HS, lon, lat);
}

// ---- occupation du sol (masque OSM rastérisé : R forêt, G urbain, B sable)
let coverCtx = null, coverW = 0, coverH = 0, coverData = null;
const coverTex = new THREE.Texture();
if (COVER_IMG) {
  const c = document.createElement('canvas'); c.width = coverW = COVER_IMG.width; c.height = coverH = COVER_IMG.height;
  coverCtx = c.getContext('2d', { willReadFrequently: true }); coverCtx.drawImage(COVER_IMG, 0, 0);
  coverData = coverCtx.getImageData(0, 0, coverW, coverH).data;
  coverTex.image = COVER_IMG; coverTex.needsUpdate = true;
} else { coverTex.image = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }); coverTex.needsUpdate = true; }
// plans d'eau intérieurs : petit masque raster pour éviter d'y planter des pins
const LAKE_RES = 1400, lakeCv = document.createElement('canvas'); lakeCv.width = LAKE_RES; lakeCv.height = Math.round(LAKE_RES * (N - S) / (E - W) * 0.7116);
{
  const g = lakeCv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff';
  for (const f of LAKES.features) { g.beginPath(); for (const poly of f.geometry.coordinates) for (const ring of poly) ring.forEach(([lo, la], i) => {
    const x = ((lo - W) / (E - W)) * lakeCv.width, y = ((N - la) / (N - S)) * lakeCv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.fill('evenodd'); }
}
const lakeData = lakeCv.getContext('2d').getImageData(0, 0, lakeCv.width, lakeCv.height).data;
const inLake = (lon, lat) => { const x = Math.floor(((lon - W) / (E - W)) * lakeCv.width), y = Math.floor(((N - lat) / (N - S)) * lakeCv.height);
  return x >= 0 && y >= 0 && x < lakeCv.width && y < lakeCv.height && lakeData[(y * lakeCv.width + x) * 4] > 128; };
function coverAt(lon, lat) {
  if (!coverData) return null;
  const x = Math.round(((lon - W) / (E - W)) * (coverW - 1)), y = Math.round(((N - lat) / (N - S)) * (coverH - 1));
  if (x < 0 || y < 0 || x >= coverW || y >= coverH) return null;
  const k = (y * coverW + x) * 4, f = coverData[k] / 255, u = coverData[k + 1] / 255, s = coverData[k + 2] / 255;
  return { forest: f, urban: u, sand: s, open: Math.max(0, 1 - f - u - s) };
}

// ================================================================ état
const TIDE = { T: 12.42, mean: 2.45, rangePer100: 3.9 }; // indicatif Arcachon-Eyrac
const state = {
  tide: 2.45, phase: -3.1, coef: 95, exag: 14, style: 0, night: false, playing: false, selected: null,
  layers: { trees: true, landmarks: true, crassat: true, sable: true, presale: true, marais: true, names: true, iso: true, nav: true, navlines: true, ports: true, navnames: false },
};
const LAND_K = 0.34; // la terre (> 5 m) est compressée : l'attention reste sur l'eau
const dispH = (h) => (h > 5 ? 5 + (h - 5) * LAND_K : h);
const yOf = (h) => dispH(h) * state.exag * 0.1;

// ================================================================ scène
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
$('#scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 5, 90000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.maxPolarAngle = 1.32; controls.minDistance = 40; controls.maxDistance = 7500;
controls.zoomToCursor = true; controls.zoomSpeed = 1.2;
const SUN = new THREE.Vector3(-0.5, 0.78, 0.38).normalize();
const sun = new THREE.DirectionalLight(0xfff4e2, 2.0); sun.position.copy(SUN).multiplyScalar(5000); scene.add(sun);
const hemi = new THREE.HemisphereLight(0xe3f0ff, 0x6b6450, 1.05); scene.add(hemi);

// ================================================================ textures drapées
const OV = 4096;
const mkCanvasTex = () => { const c = document.createElement('canvas'); c.width = c.height = OV; const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return [c, t]; };
const [underCanvas, underTex] = mkCanvasTex(); // sous l'eau (teinté par la marée) : crassats, prés salés, marais
const [topCanvas, topTex] = mkCanvasTex();     // par-dessus : bancs émergés, zones de navigation, sélection
const [orthoCanvas, orthoTex] = mkCanvasTex();

// ================================================================ terrain (shader commun grille + Dune du Pilat)
const [cx0, cz0] = PIL ? proj(PIL.w, PIL.n) : [0, 0], [cx1, cz1] = PIL ? proj(PIL.e, PIL.s) : [0, 0];
const U_ = {
  uTide: { value: state.tide }, uExag: { value: state.exag }, uLand: { value: LAND_K }, uStyle: { value: 0 }, uIso: { value: 1 }, uNight: { value: 0 },
  uUnder: { value: underTex }, uTop: { value: topTex }, uOrtho: { value: orthoTex }, uCover: { value: coverTex }, uSun: { value: SUN }, uTime: { value: 0 },
  uFog: { value: new THREE.Color(0xe4e9ea) }, uClip: { value: new THREE.Vector4(cx0 + 0.5, cz0 + 0.5, cx1 - 0.5, cz1 - 0.5) },
};
const VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float h; attribute vec2 grad;
  uniform float uExag, uLand;
  varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
  void main() {
    vH = h; vUv = uv;
    float hd = h > 5.0 ? 5.0 + (h - 5.0) * uLand : h;
    float gk = h > 5.0 ? uExag * uLand : uExag;
    vec3 p = position; p.y = hd * uExag * 0.1;
    vN = normalize(vec3(-grad.x * gk, 1.0, -grad.y * gk));
    vec4 wp = modelMatrix * vec4(p, 1.0); vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTide, uIso, uNight, uStyle;
  uniform sampler2D uUnder, uTop, uOrtho, uCover; uniform vec3 uSun, uFog; uniform vec4 uClip;
  varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
  float aa(float h, float e, float w) { return smoothstep(e - w, e + w, h); }
  float iso(float h, float L, float w) { return 1.0 - smoothstep(0.35, 1.25, abs(h - L) / max(w, 1e-4)); }
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    #ifdef IS_MAIN
      if (vPos.x > uClip.x && vPos.x < uClip.z && vPos.z > uClip.y && vPos.z < uClip.w) discard; // remplacé par la dune fine
    #endif
    float h = vH, w = fwidth(h), d = uTide - h;
    // normale : lisse sur l'eau, à facettes (low-poly) sur la terre
    vec3 fn = normalize(cross(dFdx(vPos), dFdy(vPos))); if (fn.y < 0.0) fn = -fn;
    #ifdef IS_PATCH
      float landK = smoothstep(2.0, 4.0, h);
    #else
      float landK = smoothstep(4.8, 6.5, h);
    #endif
    vec3 n = normalize(mix(normalize(vN), fn, landK));
    float facet = hash(floor(fn * 40.0));
    vec3 cov = texture2D(uCover, vUv).rgb;
    vec3 col;
    if (uStyle < 0.5) {
      vec3 mud = vec3(.60,.56,.46), flat_ = vec3(.79,.72,.56), sand = vec3(.94,.87,.68);
      vec3 shore = mix(mud, flat_, smoothstep(.3, 3.2, h)); shore = mix(shore, sand, smoothstep(3.4, 4.6, h));
      // terre low-poly : lande, forêt de pins, sable (dunes), zones bâties
      vec3 land = mix(vec3(.70,.76,.50), vec3(.64,.70,.44), smoothstep(10., 40., h));
      land = mix(land, vec3(.40,.55,.30), cov.r);
      land = mix(land, vec3(.96,.88,.66), cov.b);
      land = mix(land, vec3(.90,.87,.80), cov.g * .9);
      land *= .93 + .14 * facet;
      col = mix(shore, land, smoothstep(5.0, 7.0, h));
    } else if (uStyle < 1.5) {
      vec3 cLand = vec3(.97,.91,.73), cDry = vec3(.71,.79,.58), c2 = vec3(.56,.76,.91), c5 = vec3(.70,.84,.95), c10 = vec3(.83,.91,.97), cDeep = vec3(.97,.985,1.);
      col = mix(cDeep, c10, aa(h, -10., w));
      col = mix(col, c5, aa(h, -5., w)); col = mix(col, c2, aa(h, -2., w)); col = mix(col, cDry, aa(h, 0., w)); col = mix(col, cLand, aa(h, 4.6, w));
      col *= 1.0 - .05 * facet * landK;
    } else {
      col = min(texture2D(uOrtho, vUv).rgb * 1.16, vec3(1.));
    }
    vec4 un = texture2D(uUnder, vUv);
    col = mix(col, un.rgb, un.a * (uStyle > 1.5 ? .5 : 1.0));
    if (uStyle < 1.5) col *= mix(.80, 1., smoothstep(0., .45, -d)); // estran mouillé
    if (uStyle < 0.5 || uStyle > 1.5) {
      float wet = smoothstep(-w * .6, w * .6, d);
      vec3 c0 = vec3(.56,.86,.81), c1 = vec3(.20,.60,.71), c2 = vec3(.07,.33,.52), c3 = vec3(.03,.17,.33);
      vec3 water = mix(c0, c1, smoothstep(0., 3., d)); water = mix(water, c2, smoothstep(3., 10., d)); water = mix(water, c3, smoothstep(10., 26., d));
      float k = uStyle > 1.5 ? .28 + .55 * smoothstep(0., 12., d) : .38 + .62 * smoothstep(0., 1.8, d);
      col = mix(col, mix(col, water, k), wet);
      col = mix(col, vec3(.95,.99,1.), (1.0 - smoothstep(0., .18, d)) * wet * .45);
    }
    vec4 tp = texture2D(uTop, vUv);
    col = mix(col, tp.rgb, tp.a);
    float dif = max(dot(n, normalize(uSun)), 0.0);
    float amb = uStyle > .5 && uStyle < 1.5 ? .80 : .50;
    col *= amb + (1.12 - amb) * dif * 1.05;
    if (uIso > .5) {
      float l0 = iso(h, 0., w);
      float l = max(max(iso(h, -2., w), iso(h, -5., w)), max(iso(h, -10., w), iso(h, -20., w)));
      if (uStyle > .5 && uStyle < 1.5) { col = mix(col, vec3(.16,.42,.66), l * .8); col = mix(col, vec3(.10,.30,.20), l0 * .7); }
      else { col = mix(col, vec3(.88,.96,1.), l * .42); col = mix(col, vec3(.10,.22,.34), l0 * .55); }
    }
    if (uStyle > .5 && uStyle < 1.5) col = mix(col, vec3(.05,.42,.78), iso(h, uTide, w * 1.3) * .9);
    if (uNight > .5) col *= vec3(.22,.27,.40);
    float fd = distance(vPos, cameraPosition);
    col = mix(col, uFog, smoothstep(9000., 26000., fd) * .7);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
const tGeo = gridGeometry(GW, GH, (i, j) => [-WU / 2 + (i / (GW - 1)) * WU, -HU / 2 + (j / (GH - 1)) * HU], HS, (i, j) => [i / (GW - 1), 1 - j / (GH - 1)], dxm, dzm);
const terrain = new THREE.Mesh(tGeo, new THREE.ShaderMaterial({ uniforms: U_, vertexShader: VERT, fragmentShader: FRAG, defines: PIL ? { IS_MAIN: 1 } : {} }));
terrain.frustumCulled = false; scene.add(terrain);
if (PIL) {
  const pdx = ((PIL.e - PIL.w) / (PIL.cols - 1)) * MX * U, pdz = ((PIL.n - PIL.s) / (PIL.rows - 1)) * MZ * U;
  const lonOf = (i) => PIL.w + (i / (PIL.cols - 1)) * (PIL.e - PIL.w), latOf = (j) => PIL.n - (j / (PIL.rows - 1)) * (PIL.n - PIL.s);
  const pGeo = gridGeometry(PIL.cols, PIL.rows, (i, j) => proj(lonOf(i), latOf(j)), PIL.H,
    (i, j) => [(lonOf(i) - W) / (E - W), 1 - (N - latOf(j)) / (N - S)], pdx, pdz);
  const dune = new THREE.Mesh(pGeo, new THREE.ShaderMaterial({ uniforms: U_, vertexShader: VERT, fragmentShader: FRAG, defines: { IS_PATCH: 1 } }));
  dune.frustumCulled = false; scene.add(dune);
}

// ================================================================ surface de l'eau (reflets animés)
const waterMat = new THREE.ShaderMaterial({
  uniforms: U_, transparent: true, depthWrite: false,
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vPos;
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uTime, uNight, uStyle; uniform vec3 uSun;
    varying vec3 vPos;
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vPos.xz; float t = uTime;
      vec3 n = normalize(vec3(
        sin(p.x * .061 + t * .9) * .5 + sin(p.y * .093 - t * 1.3) * .3 + sin((p.x + p.y) * .171 + t * 1.9) * .2, 9.0,
        cos(p.y * .067 + t * .8) * .5 + cos(p.x * .101 - t * 1.1) * .3 + sin((p.x - p.y) * .143 + t * 1.6) * .2));
      vec3 v = normalize(cameraPosition - vPos);
      float fr = pow(1.0 - max(dot(v, n), 0.0), 4.0);
      float sp = pow(max(dot(reflect(-normalize(uSun), n), v), 0.0), 220.0);
      vec3 sky = uNight > .5 ? vec3(.06,.10,.18) : vec3(.86,.93,.98);
      vec3 col = mix(vec3(.12,.42,.56), sky, fr) + sp * (uNight > .5 ? .2 : .9);
      float a = (uStyle > .5 && uStyle < 1.5 ? .0 : .07) + .5 * fr + sp * .8;
      gl_FragColor = vec4(col, clamp(a, 0., .85));
    }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(WU, HU, 1, 1), waterMat);
water.rotation.x = -Math.PI / 2; water.renderOrder = 2; scene.add(water);

// ================================================================ socle du diorama
const BASE_H = -48;
const edges = [[0, 0, 1, 0, GW, 0.92], [0, GH - 1, 1, 0, GW, 1.0], [0, 0, 0, 1, GH, 0.78], [GW - 1, 0, 0, 1, GH, 0.86]];
const earthMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const wallWaterMat = new THREE.MeshBasicMaterial({ color: 0x2b86b4, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
const earthGeo = new THREE.BufferGeometry(), wallWaterGeo = new THREE.BufferGeometry();
const earth = new THREE.Mesh(earthGeo, earthMat), wallWater = new THREE.Mesh(wallWaterGeo, wallWaterMat);
earth.frustumCulled = wallWater.frustumCulled = false; wallWater.renderOrder = 3;
scene.add(earth, wallWater);
function buildWalls() {
  const ep = [], ec = [], wp = [], ei = [];
  const yb = yOf(BASE_H) - 25, yt = yOf(state.tide);
  for (const [i0, j0, di, dj, n, sh] of edges) {
    for (let k = 0; k < n; k++) {
      const i = i0 + di * k, j = j0 + dj * k, h = HS[j * GW + i];
      const x = -WU / 2 + (i / (GW - 1)) * WU, z = -HU / 2 + (j / (GH - 1)) * HU, y = yOf(h);
      const top = h > 5 ? [0.55, 0.62, 0.38] : h > 0 ? [0.78, 0.70, 0.52] : [0.62, 0.56, 0.44];
      // strates : sol, sable, argile
      ep.push(x, y, z, x, (y + yb) * 0.5 - 6, z, x, yb, z);
      ec.push(top[0] * sh, top[1] * sh, top[2] * sh, 0.62 * sh, 0.50 * sh, 0.36 * sh, 0.32 * sh, 0.25 * sh, 0.20 * sh);
      wp.push(x, Math.max(y, yt), z, x, y, z);
      if (k < n - 1) {
        const b = ep.length / 3 - 3, wb = wp.length / 3 - 2;
        ei.push(b, b + 1, b + 3, b + 1, b + 4, b + 3, b + 1, b + 2, b + 4, b + 2, b + 5, b + 4);
        (wallWaterGeo.userData.tmp ??= []).push(wb, wb + 1, wb + 2, wb + 1, wb + 3, wb + 2);
      }
    }
  }
  earthGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  earthGeo.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
  earthGeo.setIndex(ei);
  wallWaterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wallWaterGeo.setIndex(wallWaterGeo.userData.tmp); wallWaterGeo.userData.tmp = [];
}
const shadow = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  gr.addColorStop(0, 'rgba(10,30,50,.35)'); gr.addColorStop(1, 'rgba(10,30,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WU * 1.7, HU * 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; scene.add(m); return m;
})();

// ================================================================ forêt de pins (instanciée)
const rng = mulberry32(44);
const pines = buildForest({
  coverAt: (lo, la) => (inLake(lo, la) ? null : coverAt(lo, la)), heightAt, rng, density: MOBILE ? 0.16 : 0.42, cols: GW - 1, rows: GH - 1,
  cellLonLat: (fi, fj) => [W + (fi / (GW - 1)) * (E - W), N - (fj / (GH - 1)) * (N - S)],
});
const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const forest = new THREE.InstancedMesh(pineGeometry(), pineMat, Math.max(pines.length, 1));
forest.count = pines.length; forest.frustumCulled = false;
{
  const c = new THREE.Color();
  pines.forEach((p, i) => { c.setRGB(0.86 + p.t * 0.24, 0.92 + p.t * 0.16, 0.84 + p.t * 0.1); forest.setColorAt(i, c); });
  if (forest.instanceColor) forest.instanceColor.needsUpdate = true;
}
scene.add(forest);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function placeForest() {
  pines.forEach((p, i) => {
    const [x, z] = proj(p.lon, p.lat);
    _p.set(x, yOf(p.h) - 0.3, z); _q.setFromAxisAngle(_up, p.r); _s.setScalar(p.s);
    forest.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  forest.instanceMatrix.needsUpdate = true;
}

// ================================================================ cabanes tchanquées & cabanes de l'Île aux Oiseaux
const landmarkGroup = new THREE.Group(); scene.add(landmarkGroup);
const huts = LANDMARKS.map((m) => {
  const g = m.kind === 'tchanquee' ? stiltHut(/blanc/i.test(m.name) ? 'white' : 'red') : groundHut(rng);
  g.rotation.y = m.angle || 0; g.traverse((o) => { o.userData.hut = m; });
  landmarkGroup.add(g); return { g, m, h: heightAt(m.lon, m.lat) ?? 1 };
});
function placeHuts(scale = 1) {
  for (const { g, m, h } of huts) {
    const [x, z] = proj(m.lon, m.lat); g.position.x = x; g.position.z = z;
    if (m.kind === 'tchanquee') layoutStilt(g, yOf(h), yOf(5.9), 2.2 * scale);
    else { g.position.y = yOf(Math.max(h, 3.5)); g.scale.setScalar(1.25 * scale); }
  }
}

// ================================================================ nuages
const clouds = buildClouds(mulberry32(9), { x: WU, z: HU });
scene.add(clouds.group);

// ================================================================ couches vectorielles drapées
const cU = underCanvas.getContext('2d'), cT = topCanvas.getContext('2d');
const toPx = (lon, lat) => [((lon - W) / (E - W)) * OV, ((N - lat) / (N - S)) * OV];
const byCls = {};
for (const f of ZONES.features) (byCls[f.properties.cls] ??= []).push(f);
function pattern(fn) { const c = document.createElement('canvas'); c.width = c.height = 12; fn(c.getContext('2d')); return cU.createPattern(c, 'repeat'); }
const patPresale = pattern((g) => { g.fillStyle = 'rgba(147,171,98,.82)'; g.fillRect(0, 0, 12, 12); g.fillStyle = 'rgba(96,124,58,.9)'; g.fillRect(2, 2, 1.6, 1.6); g.fillRect(8, 7, 1.6, 1.6); });
const patMarais = pattern((g) => { g.fillStyle = 'rgba(95,139,108,.85)'; g.fillRect(0, 0, 12, 12); g.strokeStyle = 'rgba(48,88,62,.95)'; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(3, 9); g.lineTo(3, 4); g.moveTo(1.5, 9); g.lineTo(0.8, 6); g.moveTo(4.5, 9); g.lineTo(5.2, 6); g.stroke(); });
function path(g, coords) {
  g.beginPath();
  for (const poly of coords) for (const ring of poly) { ring.forEach(([lo, la], i) => { const [x, y] = toPx(lo, la); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
}
function zones(g, list, fill, stroke, lw = 2, dash = []) {
  for (const f of list ?? []) {
    path(g, f.geometry.coordinates);
    if (fill) { g.fillStyle = fill; g.fill('evenodd'); }
    if (stroke) { g.setLineDash(dash); g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); g.setLineDash([]); }
  }
}
function navStyle(t) {
  if (/cable|pipeline/.test(t)) return ['rgba(140,80,210,.9)', [10, 8], 2];
  if (/restricted|military|marine_farm|dumping/.test(t)) return ['rgba(194,57,143,.9)', [16, 6, 3, 6], 2.6];
  if (/harbour|small_craft|mooring|anchorage/.test(t)) return ['rgba(194,57,143,.75)', [8, 6], 2.2];
  return ['rgba(194,57,143,.95)', [18, 10], 3];
}
function drawOverlay() {
  const L = state.layers;
  cU.clearRect(0, 0, OV, OV); cT.clearRect(0, 0, OV, OV);
  zones(cU, LAKES.features, 'rgba(92,163,198,.96)', 'rgba(52,112,150,.9)', 2.2); // lacs et réservoirs
  if (L.crassat) zones(cU, byCls.crassat, 'rgba(150,115,60,.10)', 'rgba(118,86,40,.75)', 2, [7, 5]);
  if (L.presale) zones(cU, byCls.pre_sale, patPresale, 'rgba(84,110,48,.85)', 1.4);
  if (L.marais) zones(cU, byCls.marais, patMarais, 'rgba(48,88,62,.85)', 1.4);
  if (L.sable) { zones(cT, byCls.banc_sable, 'rgba(240,227,186,.93)', 'rgba(170,138,80,.95)', 2); zones(cT, byCls.plage, 'rgba(244,232,196,.88)', null); }
  if (L.navlines) for (const f of NAVLINES.features) {
    const [col, dash, lw] = navStyle(f.properties['seamark:type'] || '');
    cT.beginPath(); f.geometry.coordinates.forEach(([lo, la], i) => { const [x, y] = toPx(lo, la); i ? cT.lineTo(x, y) : cT.moveTo(x, y); });
    cT.setLineDash(dash); cT.strokeStyle = col; cT.lineWidth = lw; cT.stroke(); cT.setLineDash([]);
  }
  if (state.selected?.geometry?.type === 'MultiPolygon') {
    path(cT, state.selected.geometry.coordinates);
    cT.fillStyle = 'rgba(255,214,90,.18)'; cT.fill('evenodd');
    cT.lineWidth = 9; cT.strokeStyle = 'rgba(255,255,255,.9)'; cT.stroke();
    cT.lineWidth = 4.5; cT.strokeStyle = '#f0a524'; cT.stroke();
  }
  underTex.needsUpdate = true; topTex.needsUpdate = true;
}

let orthoLoaded = false;
function loadOrtho() {
  if (orthoLoaded) return; orthoLoaded = true;
  const g = orthoCanvas.getContext('2d'); g.fillStyle = '#7d8c7a'; g.fillRect(0, 0, OV, OV);
  const z = 14, n = 2 ** z;
  const tx = (lon) => ((lon + 180) / 360) * n, ty = (lat) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const tlat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, tlon = (x) => (x / n) * 360 - 180;
  let pending = 0;
  for (let y = Math.floor(ty(N)); y <= Math.floor(ty(S)); y++) for (let x = Math.floor(tx(W)); x <= Math.floor(tx(E)); x++) {
    const img = new Image(); img.crossOrigin = 'anonymous'; pending++;
    const done = () => { if (--pending % 30 === 0) orthoTex.needsUpdate = true; };
    img.onload = () => { const [x0, y0] = toPx(tlon(x), tlat(y)), [x1, y1] = toPx(tlon(x + 1), tlat(y + 1)); g.drawImage(img, x0, y0, x1 - x0 + 0.6, y1 - y0 + 0.6); done(); };
    img.onerror = done;
    img.src = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
  }
}

// ================================================================ balisage 3D
const COLORS = { red: 0xd7263d, green: 0x1e9e4a, yellow: 0xf2c80f, black: 0x1a1a1a, white: 0xf6f6f6, orange: 0xff8c1a, blue: 0x2b6fd6, grey: 0x8a8f94, brown: 0x7a4a2a };
const matCache = {};
const mat = (c) => (matCache[c] ??= new THREE.MeshLambertMaterial({ color: COLORS[c] ?? 0xcccccc, emissive: COLORS[c] ?? 0xcccccc, emissiveIntensity: 0.18 }));
const G = { can: new THREE.CylinderGeometry(1, 1, 1, 16), cone: new THREE.ConeGeometry(1, 1, 16), sphere: new THREE.SphereGeometry(1, 16, 12), pole: new THREE.CylinderGeometry(0.16, 0.16, 1, 8) };
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const LIGHT_RGB = { white: 0xfff2c4, red: 0xff4040, green: 0x40ff70, yellow: 0xffd84a, blue: 0x5aa0ff, orange: 0xffa040, violet: 0xc070ff };
const NAV_TYPES = /buoy_|beacon_|light_|light_float|daymark|landmark|fog_signal|pile|rock|wreck|obstruction/;
const TYPE_FR = {
  buoy_lateral: 'Bouée latérale', beacon_lateral: 'Balise latérale', buoy_cardinal: 'Bouée cardinale', beacon_cardinal: 'Balise cardinale',
  buoy_special_purpose: 'Bouée spéciale', beacon_special_purpose: 'Balise spéciale', buoy_safe_water: 'Bouée eaux saines', beacon_safe_water: 'Balise eaux saines',
  buoy_isolated_danger: 'Bouée danger isolé', beacon_isolated_danger: 'Balise danger isolé', light_major: 'Feu principal', light_minor: 'Feu secondaire',
  light_float: 'Feu flottant', landmark: 'Amer', wreck: 'Épave', rock: 'Roche', obstruction: 'Obstruction', pile: 'Pieu', daymark: 'Marque de jour', fog_signal: 'Signal de brume',
  harbour: 'Zone portuaire', small_craft_facility: 'Équipement plaisance', restricted_area: 'Zone réglementée', mooring: 'Mouillage',
};
const CAT_FR = { port: 'bâbord', starboard: 'tribord', preferred_channel_port: 'chenal préféré à bâbord', preferred_channel_starboard: 'chenal préféré à tribord',
  north: 'Nord', south: 'Sud', east: 'Est', west: 'Ouest', tower: 'tour' };
const COL_FR = { red: 'rouge', green: 'vert', yellow: 'jaune', black: 'noir', white: 'blanc', orange: 'orange', blue: 'bleu', grey: 'gris', brown: 'brun' };
const SHAPE_FR = { can: 'cylindrique', conical: 'conique', pillar: 'charpente', spar: 'espar', sphere: 'sphérique', stake: 'perche', pole: 'perche', perch: 'perche',
  tower: 'tourelle', lattice: 'pylône', cairn: 'cairn', barrel: 'tonne', super_buoy: 'super-bouée' };
const TOP_FR = { cylinder: 'cylindre', 'cone, point up': 'cône pointe en haut', 'cone, point down': 'cône pointe en bas', '2 cones up': '2 cônes pointes en haut',
  '2 cones down': '2 cônes pointes en bas', '2 cones base together': '2 cônes opposés par la base', '2 cones point together': '2 cônes opposés par la pointe',
  sphere: 'sphère', '2 spheres': '2 sphères', 'x-shape': 'croix de Saint-André', cross: 'croix' };
const CH_ABBR = { white: 'W', red: 'R', green: 'G', yellow: 'Y', blue: 'Bu', orange: 'Or', violet: 'Vi' };
const KIND_COLOR = (m) => {
  const cat = m.props[`seamark:${m.type}:category`];
  if (cat === 'port') return '#d7263d'; if (cat === 'starboard') return '#1e9e4a';
  if (/cardinal|special/.test(m.type)) return '#e0b80c'; return '#888';
};
function lightsOf(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) { const m = k.match(/^seamark:light:(?:(\d+):)?([a-z_]+)$/); if (m) (out[m[1] || '0'] ??= {})[m[2]] = v; }
  return Object.values(out).filter((l) => l.character || l.colour);
}
function lightText(l) {
  const col = (l.colour || '').split(';').map((c) => CH_ABBR[c] || c).join('');
  return [`${l.character || ''}${l.group ? `(${l.group})` : ''}`, col, l.period ? `${l.period}s` : '', l.height ? `${l.height}m` : '', l.range ? `${l.range}M` : ''].filter(Boolean).join(' ');
}
function flashFn(l) {
  const ch = (l.character || 'F').replace(/\(.*\)/, '');
  const P = parseFloat(l.period) || ({ Q: 1, VQ: 0.5, IQ: 1, Fl: 4, LFl: 8, Iso: 4, Oc: 4 }[ch] ?? 4);
  const n = parseInt(l.group) || 1, off = Math.random() * P;
  if (ch === 'F') return () => 1;
  if (l.sequence) {
    const segs = l.sequence.split(/[+,]/).map((s) => ({ on: !/\(/.test(s), d: parseFloat(s.replace(/[()]/g, '')) || 0 }));
    const tot = segs.reduce((a, s) => a + s.d, 0);
    if (tot > 0) return (t) => { let u = (t + off) % tot; for (const s of segs) { if (u < s.d) return s.on ? 1 : 0; u -= s.d; } return 0; };
  }
  if (/^Iso/.test(ch)) return (t) => (((t + off) % P) < P / 2 ? 1 : 0);
  if (/^Oc/.test(ch)) return (t) => { const u = (t + off) % P; return u > P - n && ((u - (P - n)) % 1) < 0.6 ? 0 : 1; };
  const fd = /^LFl/.test(ch) ? 2 : /VQ/.test(ch) ? 0.2 : /Q/.test(ch) ? 0.35 : 0.5;
  return (t) => { const u = (t + off) % P; const k = Math.floor(u / (fd * 2)); return k < n && (u % (fd * 2)) < fd ? 1 : 0; };
}
const navGroup = new THREE.Group(); scene.add(navGroup);
const marks = [];
for (const f of SEAMARKS.features) {
  const p = f.properties, t = p['seamark:type'] || '';
  const lights = lightsOf(p);
  if (!NAV_TYPES.test(t) && !lights.length) continue;
  const [lon, lat] = f.geometry.coordinates;
  const g = new THREE.Group();
  // OSM liste les bandes de couleur de haut en bas : on empile donc dans l'ordre inverse.
  const colours = (p[`seamark:${t}:colour`] || '').split(';').filter(Boolean).reverse();
  const shape = p[`seamark:${t}:shape`] || '';
  const isBuoy = t.startsWith('buoy') || t === 'light_float';
  const isTower = t === 'landmark' || t.startsWith('light_');
  let top = 0;
  const cs = colours.length ? colours : [t.includes('special') ? 'yellow' : isTower ? 'white' : 'grey'];
  if (isTower) {
    const hh = 9 / cs.length;
    cs.forEach((c, i) => { const m = new THREE.Mesh(G.can, mat(c)); m.scale.set(1 - i * 0.08, hh, 1 - i * 0.08); m.position.y = hh * (i + 0.5); g.add(m); });
    top = 9;
  } else {
    const Hh = isBuoy ? 3.2 : 5.2, R = isBuoy ? 1.25 : 0.5;
    const geom = /conical/.test(shape) ? G.cone : /spher/.test(shape) ? G.sphere : G.can;
    if (!isBuoy) { const pole = new THREE.Mesh(G.pole, mat('grey')); pole.scale.set(1, 3, 1); pole.position.y = 1.5; g.add(pole); top = 3; }
    const bh = Hh / cs.length;
    cs.forEach((c, i) => {
      const last = i === cs.length - 1;
      const m = new THREE.Mesh(geom === G.cone ? (last ? G.cone : G.can) : geom, mat(c));
      if (geom === G.sphere) { m.scale.setScalar(R * 1.1); m.position.y = top + R; }
      else { const r = geom === G.cone ? R * 1.2 : R; m.scale.set(r, bh, r); m.position.y = top + bh * (i + 0.5); }
      g.add(m);
    });
    top += geom === G.sphere ? R * 2.2 : Hh;
    const tm = p['seamark:topmark:shape'] || '';
    if (tm) {
      const tc = (p['seamark:topmark:colour'] || 'black').split(';')[0];
      if (/cone/.test(tm)) {
        const ups = /2 cones up/.test(tm) ? [1, 1] : /2 cones down/.test(tm) ? [-1, -1] : /base/.test(tm) ? [-1, 1] : /point together/.test(tm) ? [1, -1] : /down/.test(tm) ? [-1] : [1];
        ups.forEach((u, i) => { const c = new THREE.Mesh(G.cone, mat(tc)); c.scale.set(0.8, 1.1, 0.8); c.rotation.z = u < 0 ? Math.PI : 0; c.position.y = top + 0.9 + i * 1.3; g.add(c); });
      } else if (/sphere/.test(tm)) {
        const k = /2 spheres/.test(tm) ? 2 : 1;
        for (let i = 0; i < k; i++) { const s = new THREE.Mesh(G.sphere, mat(tc)); s.scale.setScalar(0.6); s.position.y = top + 0.8 + i * 1.3; g.add(s); }
      } else if (/x-shape|cross/.test(tm)) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), mat(tc)); s.rotation.z = Math.PI / 4; s.position.y = top + 1; g.add(s);
        const s2 = s.clone(); s2.rotation.z = -Math.PI / 4; g.add(s2);
      } else { const c = new THREE.Mesh(G.can, mat(tc)); c.scale.set(0.7, 1, 0.7); c.position.y = top + 0.8; g.add(c); }
      top += 2.6;
    }
  }
  const sprites = [];
  if (lights.length) {
    const l = lights[0], c = (l.colour || 'white').split(';')[0], big = isTower ? 11 : 5.5;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: LIGHT_RGB[c] ?? 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.y = top + 0.8; sp.renderOrder = 5; g.add(sp);
    sprites.push({ sprite: sp, fn: flashFn(l), base: big });
  }
  g.traverse((o) => { o.userData.mark = marks.length; });
  navGroup.add(g);
  marks.push({ obj: g, lon, lat, floating: isBuoy, sprites, props: p, type: t, lights, h: heightAt(lon, lat) });
}

// ================================================================ étiquettes
const labelsEl = $('#labels');
const labels = [];
function addLabel(text, lon, lat, cls, layer, pri, maxDist, extra = {}) {
  if (!text) return null;
  const el = document.createElement('div'); el.className = 'lbl ' + cls; el.textContent = text; labelsEl.appendChild(el);
  const L = { el, lon, lat, layer, pri, maxDist, w: 0, h: 0, anchorLeft: /commune|port/.test(cls), ...extra };
  labels.push(L); return L;
}
function ringCentroid(r) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < r.length - 1; i++) { const [x0, y0] = r[i], [x1, y1] = r[i + 1], c = x0 * y1 - x1 * y0; a += c; x += (x0 + x1) * c; y += (y0 + y1) * c; }
  return Math.abs(a) < 1e-14 ? r[0] : [x / (3 * a), y / (3 * a)];
}
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
const CLS_FR = (c) => ({ crassat: 'Crassat', pre_sale: 'Pré salé', marais: 'Marais', banc_sable: 'Banc de sable', plage: 'Plage', ile: 'Île' }[c] || c);
const searchIndex = [];
for (const f of ZONES.features) {
  let best = null, ba = -1; const bb = [180, 90, -180, -90];
  for (const poly of f.geometry.coordinates) {
    const a = ringArea(poly[0]); if (a > ba) { ba = a; best = poly[0]; }
    for (const [x, y] of poly[0]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
  }
  f.bbox = bb; f.area = ba; f.center = ringCentroid(best);
  const { cls, name } = f.properties;
  if (!name || /^FR-/.test(name)) continue;
  const [lo, la] = f.center;
  const big = ba > 2.5e-6 || cls === 'ile' || cls === 'banc_sable';
  if (cls === 'ile' && /Oiseaux/.test(name)) addLabel(name, lo, la, 'landmark', 'names', 90, 99999);
  else if (cls === 'crassat' || cls === 'banc_sable' || cls === 'ile')
    addLabel(name, lo, la, 'crassat' + (big ? ' big' : ''), cls === 'crassat' ? 'crassat' : 'sable', big ? 58 : 38 + Math.min(ba * 4e6, 15), big ? 3200 : 1100);
  else if (cls === 'pre_sale' || cls === 'marais') addLabel(name, lo, la, 'marais', cls === 'pre_sale' ? 'presale' : 'marais', 36, 1300);
  else if (cls === 'plage') continue;
  searchIndex.push({ name, kind: CLS_FR(cls), lon: lo, lat: la, dist: big ? 900 : 550, zone: f });
}
const placeByName = Object.fromEntries(PLACES.features.filter((f) => /town|village/.test(f.properties.kind)).map((f) => [f.properties.name, f.geometry.coordinates]));
for (const c of COMMUNES) {
  const p = placeByName[c.name] || [c.lon, c.lat];
  addLabel(c.name, p[0], p[1], 'commune', 'communes', 100, 99999);
  searchIndex.push({ name: c.name, kind: `Commune · ${c.epci}`, lon: p[0], lat: p[1], dist: 1300 });
}
const MAJOR_WATER = /Teychan|Piquey|Rade d|Courbey|Passe|Chenal de L[èe]ge|Chenal d'Ar[èe]s|Chenal de Lanton|Chenal d'Audenge|Chenal de Gujan|Chenal du Courant|Chenal de l'[ÎI]le/;
for (const f of PLACES.features) {
  const k = f.properties.kind, nm = f.properties.name; const [lo, la] = f.geometry.coordinates;
  if (COMMUNES.some((c) => c.name === nm) || /town|village/.test(k)) continue;
  if (k === 'channel') {
    const major = MAJOR_WATER.test(nm);
    addLabel(nm, lo, la, 'water', 'names', major ? 82 : 60, major ? 6000 : 2400);
    searchIndex.push({ name: nm, kind: 'Chenal', lon: lo, lat: la, dist: 900 });
  } else if (k === 'estey') { addLabel(nm, lo, la, 'water small', 'names', 30, 850); searchIndex.push({ name: nm, kind: 'Estey', lon: lo, lat: la, dist: 500 }); }
  else if (/Tchanqu/i.test(nm)) { addLabel('Cabanes tchanquées', lo, la, 'landmark', 'landmarks', 88, 3500); }
  else if (/dune/.test(k)) { addLabel(nm, lo, la, 'landmark', 'names', 92, 99999); }
  else if (/bay/.test(k)) { addLabel(nm, lo, la, 'water', 'names', 70, 3000); searchIndex.push({ name: nm, kind: 'Anse', lon: lo, lat: la, dist: 700 }); }
  else if (/cape|peninsula/.test(k)) { addLabel(nm, lo, la, 'place major', 'names', 78, 7000); searchIndex.push({ name: nm, kind: 'Lieu', lon: lo, lat: la, dist: 900 }); }
  else if (/suburb/.test(k)) { addLabel(nm, lo, la, 'place major', 'names', 52, 2200); searchIndex.push({ name: nm, kind: 'Quartier', lon: lo, lat: la, dist: 800 }); }
  else if (/hamlet|locality/.test(k)) { addLabel(nm, lo, la, 'place', 'names', 26, 900); }
  else if (/waterway/.test(k)) { addLabel(nm, lo, la, 'water small', 'names', 44, 1800); searchIndex.push({ name: nm, kind: 'Cours d’eau', lon: lo, lat: la, dist: 800 }); }
}
for (const f of PORTS.features) {
  const p = f.properties; if (!p.name || p.name.length < 3 || /^zone \d+$/i.test(p.name) || p.kind === 'pier') continue;
  const [lo, la] = f.geometry.coordinates;
  const main = p.kind === 'marina' || p.kind === 'harbour' || p.kind === 'lighthouse';
  const L = addLabel(p.name, lo, la, 'port' + (p.kind === 'slipway' ? ' slip' : ''), 'ports', main ? 80 : 28, main ? 3800 : 650, { port: f });
  if (L) L.el.addEventListener('click', (e) => { e.stopPropagation(); showPort(f); });
  searchIndex.push({ name: p.name, kind: p.kind === 'slipway' ? 'Cale' : 'Port', lon: lo, lat: la, dist: 450, port: f });
}
marks.forEach((m, i) => {
  const nm = m.props['seamark:name'] || m.props.name; if (!nm) return;
  addLabel(nm, m.lon, m.lat, 'seamark', 'navnames', 20, 800, { mark: i });
  searchIndex.push({ name: nm, kind: TYPE_FR[m.type] || 'Marque', lon: m.lon, lat: m.lat, dist: 300, mark: m });
});
huts.filter((h) => h.m.kind === 'tchanquee').forEach((h) => searchIndex.push({ name: h.m.name, kind: 'Cabane tchanquée', lon: h.m.lon, lat: h.m.lat, dist: 220, hut: h.m }));

// ================================================================ placement selon marée / exagération
function placeObjects() {
  water.position.y = yOf(state.tide);
  shadow.position.y = yOf(BASE_H) - 30;
  for (const m of marks) {
    const [x, z] = proj(m.lon, m.lat), g = m.h ?? 0;
    m.obj.position.set(x, yOf(m.floating ? Math.max(g, state.tide) : g), z);
  }
  buildWalls();
}
let exagDirty = true;

// ================================================================ picking
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const setRay = (cx, cy) => { ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); };
function pickTerrain(cx, cy) {
  setRay(cx, cy);
  const o = raycaster.ray.origin, d = raycaster.ray.direction, q = new THREE.Vector3();
  const below = (t) => { q.copy(o).addScaledVector(d, t); const [lo, la] = unproj(q.x, q.z); const h = heightAt(lo, la); return h != null && q.y <= yOf(h); };
  let t = 0, step = 3;
  for (let i = 0; i < 8000 && t < 60000; i++) {
    t += step;
    if (below(t)) { let a = t - step, b = t; for (let k = 0; k < 20; k++) { const m = (a + b) / 2; below(m) ? (b = m) : (a = m); } return o.clone().addScaledVector(d, b); }
    step = Math.min(30, 3 + t * 0.003);
  }
  return null;
}
function pickObject(cx, cy) {
  setRay(cx, cy);
  const targets = [];
  if (navGroup.visible) targets.push(...navGroup.children);
  if (landmarkGroup.visible) targets.push(...landmarkGroup.children);
  const hit = raycaster.intersectObjects(targets, true).find((h) => h.object.type !== 'Sprite');
  if (!hit) return null;
  return hit.object.userData.hut ? { hut: hit.object.userData.hut } : { mark: marks[hit.object.userData.mark] };
}
function pip(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function zonesAt(lon, lat) {
  const out = [];
  for (const f of ZONES.features) {
    const b = f.bbox; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const poly of f.geometry.coordinates) if (pip([lon, lat], poly[0]) && !poly.slice(1).some((r) => pip([lon, lat], r))) { out.push(f); break; }
  }
  return out.sort((a, b) => a.area - b.area);
}
const dm = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${d}°${m.toFixed(3).padStart(6, '0')}′ ${v >= 0 ? p : n}`; };
const PILAT_NGF = PMETA?.offset_ngf_to_grid_m ?? 2.1;
function depthText(h, lon, lat) {
  const wd = state.tide - h;
  if (h < 0) return `Sonde ${fmt(-h)} m · ${fmt(wd)} m d’eau`;
  if (h < 5) return wd > 0 ? `Estran +${fmt(h)} m · ${fmt(wd)} m d’eau` : `Découvert · couvre à ${fmt(h)} m`;
  if (inPilat(lon, lat) && h > 15) return `Dune du Pilat · altitude ≈ ${Math.round(h - PILAT_NGF)} m`;
  return 'Terre';
}

// ================================================================ survol
const tooltip = $('#tooltip'), readout = $('#readout');
let hoverRAF = 0, lastMove = null;
renderer.domElement.addEventListener('pointermove', (ev) => {
  lastMove = ev;
  if (hoverRAF || ev.pointerType === 'touch') return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0; const e = lastMove;
    if (e.buttons) { tooltip.hidden = true; return; }
    const o = pickObject(e.clientX, e.clientY);
    renderer.domElement.style.cursor = o ? 'pointer' : '';
    const p = pickTerrain(e.clientX, e.clientY);
    readout.classList.toggle('idle', !p);
    if (p) {
      const [lon, lat] = unproj(p.x, p.z), h = heightAt(lon, lat);
      $('#ro-pos').textContent = `${dm(lat, 'N', 'S')}   ${dm(lon, 'E', 'W')}`;
      $('#ro-depth').textContent = h == null ? '' : depthText(h, lon, lat);
    }
    let html = '';
    if (o?.mark) {
      const m = o.mark, nm = m.props['seamark:name'] || m.props.name || '';
      html = `<b>${esc(nm || TYPE_FR[m.type] || m.type)}</b><small>${esc(nm ? TYPE_FR[m.type] || '' : '')}</small>${m.lights[0] ? `<span class="lc">${esc(lightText(m.lights[0]))}</span>` : ''}`;
    } else if (o?.hut) html = `<b>${esc(o.hut.name || 'Cabane ostréicole')}</b><small>${o.hut.kind === 'tchanquee' ? 'Cabane tchanquée' : 'Île aux Oiseaux'}</small>`;
    else if (p) {
      const [lon, lat] = unproj(p.x, p.z);
      const z = zonesAt(lon, lat).find((f) => f.properties.name && !/^FR-/.test(f.properties.name));
      if (z) html = `<b>${esc(z.properties.name)}</b><small>${CLS_FR(z.properties.cls)}</small>`;
    }
    if (html) { tooltip.innerHTML = html; tooltip.hidden = false; tooltip.style.left = e.clientX + 'px'; tooltip.style.top = e.clientY + 'px'; }
    else tooltip.hidden = true;
  });
});
renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; readout.classList.add('idle'); });

// ================================================================ fiches
const popup = $('#popup');
let popupAnchor = null;
function closePopup() { popup.hidden = true; popupAnchor = null; if (state.selected) { state.selected = null; drawOverlay(); } }
popup.querySelector('.close').onclick = closePopup;
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePopup(); toggleLayers(false); } });
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; toggleLayers(false); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const o = pickObject(e.clientX, e.clientY);
  if (o?.mark) return showMark(o.mark);
  if (o?.hut) return showHut(o.hut);
  const p = pickTerrain(e.clientX, e.clientY);
  if (p) showPoint(p); else closePopup();
});
const table = (rows) => `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
const osmLink = (id) => (id ? `<a class="more" href="https://www.openstreetmap.org/${id}" target="_blank" rel="noopener">Voir la source sur OpenStreetMap ↗</a>` : '');
function openPopup(html, anchor, sel = null) {
  popup.querySelector('.content').innerHTML = html; popup.hidden = false; popupAnchor = anchor;
  if (state.selected !== sel) { state.selected = sel; drawOverlay(); }
}
function showMark(m) {
  const p = m.props, t = m.type, rows = [];
  const cat = p[`seamark:${t}:category`]; if (cat) rows.push(['Catégorie', CAT_FR[cat] || cat]);
  const col = p[`seamark:${t}:colour`]; if (col) rows.push(['Couleurs', col.split(';').map((c) => COL_FR[c] || c).join(' / ')]);
  const sh = p[`seamark:${t}:shape`]; if (sh) rows.push(['Forme', SHAPE_FR[sh] || sh]);
  if (p['seamark:topmark:shape']) rows.push(['Voyant', TOP_FR[p['seamark:topmark:shape']] || p['seamark:topmark:shape']]);
  m.lights.forEach((l, i) => {
    rows.push([m.lights.length > 1 ? `Feu ${i + 1}` : 'Feu', `<span class="lightchar">${esc(lightText(l))}</span>`]);
    if (l.sector_start) rows.push(['Secteur', `${l.sector_start}° → ${l.sector_end}°`]);
  });
  if (m.h != null && m.h < 5) rows.push(['Sonde', m.h < 0 ? `${fmt(-m.h)} m` : `découvre de ${fmt(m.h)} m`]);
  rows.push(['Position', `${dm(m.lat, 'N', 'S')}<br>${dm(m.lon, 'E', 'W')}`]);
  const name = p['seamark:name'] || p.name || TYPE_FR[t] || t;
  openPopup(`<div class="kind"><i style="background:${KIND_COLOR(m)}"></i>${esc(TYPE_FR[t] || t)}</div><h3>${esc(name)}</h3>${table(rows)}${osmLink(p.osm)}`,
    m.obj.position.clone().add(new THREE.Vector3(0, 10 * m.obj.scale.y, 0)));
}
function showHut(m) {
  const [x, z] = proj(m.lon, m.lat), h = heightAt(m.lon, m.lat) ?? 0;
  const tch = m.kind === 'tchanquee';
  const desc = tch ? 'Maison de bois sur pilotis (« tchanques », échasses en gascon), plantée sur l’estran au bord de l’Île aux Oiseaux. Emblème du Bassin.'
    : 'Cabane ostréicole de l’Île aux Oiseaux.';
  const rows = [['Sol (ZH)', h < 0 ? `${fmt(-h)} m sous le zéro` : `+${fmt(h)} m`], ['Hauteur d’eau', state.tide > h ? `${fmt(state.tide - h)} m` : 'à sec'],
    ['Position', `${dm(m.lat, 'N', 'S')}<br>${dm(m.lon, 'E', 'W')}`]];
  openPopup(`<div class="kind"><i style="background:#8a5a35"></i>${tch ? 'Cabane tchanquée' : 'Cabane'}</div><h3>${esc(m.name || 'Cabane ostréicole')}</h3><p class="desc">${desc}</p>${table(rows)}${osmLink(m.osm)}`,
    new THREE.Vector3(x, yOf(6.5) + 12, z));
}
function showPort(f) {
  const p = f.properties, KF = { marina: 'Port de plaisance', harbour: 'Port', slipway: 'Cale de mise à l’eau', lighthouse: 'Phare' };
  const rows = [];
  if (p.capacity) rows.push(['Places', p.capacity]);
  if (p.operator) rows.push(['Gestion', esc(p.operator)]);
  if (p.website) rows.push(['Site', `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`]);
  const [lo, la] = f.geometry.coordinates, h = heightAt(lo, la);
  if (h != null && h < 5) rows.push(['Au droit du port', depthText(h, lo, la)]);
  rows.push(['Position', `${dm(la, 'N', 'S')}<br>${dm(lo, 'E', 'W')}`]);
  const [x, z] = proj(lo, la);
  openPopup(`<div class="kind"><i style="background:#f0a524"></i>${KF[p.kind] || 'Port'}</div><h3>${esc(p.name || KF[p.kind])}</h3>${table(rows)}${osmLink(p.osm)}`,
    new THREE.Vector3(x, yOf(Math.max(h ?? 0, state.tide)) + 6, z));
}
function showPoint(p, forceZone = null) {
  const [lon, lat] = unproj(p.x, p.z), h = heightAt(lon, lat);
  if (inPilat(lon, lat) && h > 15) {
    const rows = [['Altitude', `<span class="depth-big">≈ ${Math.round(h - PILAT_NGF)} m</span> <small>NGF</small>`], ['Position', `${dm(lat, 'N', 'S')}<br>${dm(lon, 'E', 'W')}`]];
    return openPopup(`<div class="kind"><i style="background:#ecd59a"></i>Dune</div><h3>Dune du Pilat</h3><p class="desc">Plus haute dune d’Europe, face au Banc d’Arguin. Relief issu du RGE ALTI de l’IGN.</p>${table(rows)}`, p.clone());
  }
  const zs = forceZone ? [forceZone] : zonesAt(lon, lat).filter((f) => !/^FR-/.test(f.properties.name || ''));
  const named = zs.find((f) => f.properties.name);
  const rows = [];
  if (h != null) {
    const wd = state.tide - h;
    if (h < 5) rows.push(['Hauteur d’eau', wd > 0 ? `<span class="depth-big">${fmt(wd)} m</span> <small>à ${fmt(state.tide, 2)} m de marée</small>` : 'à sec']);
    if (h < 5) rows.push([h < 0 ? 'Sonde (ZH)' : 'Cote (ZH)', h < 0 ? `${fmt(-h)} m sous le zéro` : `+${fmt(h)} m`]);
    if (h >= 0 && h < 5) rows.push(['Couvre', `au-delà de ${fmt(h, 2)} m de marée`]);
    if (h >= 5) { const c = coverAt(lon, lat); rows.push(['Terre', c ? (c.urban > .5 ? 'zone bâtie' : c.forest > .5 ? 'forêt de pins' : c.sand > .5 ? 'sable / dune' : 'lande, prairie') : '—']); }
  }
  zs.forEach((f) => rows.push([CLS_FR(f.properties.cls), esc(f.properties.name || '—')]));
  rows.push(['Position', `${dm(lat, 'N', 'S')}<br>${dm(lon, 'E', 'W')}`]);
  const title = named?.properties.name || (h == null ? 'Point' : h < -0.5 ? 'Chenal / plan d’eau' : h < 5 ? 'Estran' : 'Terre');
  const kind = named ? CLS_FR(named.properties.cls) : 'Point';
  openPopup(`<div class="kind">${kind}</div><h3>${esc(title)}</h3>${table(rows)}${named ? osmLink(named.properties.osm) : ''}`, p.clone(), named || null);
}

// ================================================================ caméra : vols animés
let flight = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function flyTo(lon, lat, dist, { pitch = 0.95, az = null, dur = 1500 } = {}) {
  if (innerWidth < 760) dist *= 1.45;
  const [x, z] = proj(lon, lat), h = heightAt(lon, lat);
  const target = new THREE.Vector3(x, yOf(Math.max(h ?? 0, state.tide, 0)), z);
  const off = camera.position.clone().sub(controls.target);
  const a = az ?? Math.atan2(off.x, off.z);
  const end = target.clone().add(new THREE.Vector3(Math.sin(a) * Math.sin(pitch) * dist, Math.cos(pitch) * dist, Math.cos(a) * Math.sin(pitch) * dist));
  flight = { t0: performance.now(), dur, p0: camera.position.clone(), t0v: controls.target.clone(), p1: end, t1v: target };
}
function stepFlight(now) {
  if (!flight) return;
  const k = Math.min((now - flight.t0) / flight.dur, 1), e = ease(k);
  controls.target.lerpVectors(flight.t0v, flight.t1v, e);
  camera.position.lerpVectors(flight.p0, flight.p1, e);
  camera.position.y += Math.sin(Math.PI * e) * Math.min(flight.p0.distanceTo(flight.p1) * 0.25, 1500);
  if (k >= 1) flight = null;
}
const VIEWS = [
  { name: 'Vue d’ensemble', lon: -1.14, lat: 44.665, d: 5000, az: -0.55, pitch: 0.92 },
  { name: 'Dune du Pilat', lon: -1.2135, lat: 44.5885, d: 700, az: -1.25, pitch: 1.08 },
  { name: 'Cabanes tchanquées', lon: -1.1667, lat: 44.6944, d: 150, az: 0.35, pitch: 1.12 },
  { name: 'Les Passes & Arguin', lon: -1.252, lat: 44.592, d: 2000, az: -0.35, pitch: 0.95 },
  { name: 'Pointe du Cap Ferret', lon: -1.245, lat: 44.634, d: 1000, az: -0.45, pitch: 1.0 },
  { name: 'Île aux Oiseaux', lon: -1.155, lat: 44.705, d: 1250, az: 0.3, pitch: 0.95 },
  { name: 'Rade d’Eyrac', lon: -1.162, lat: 44.668, d: 850, az: 0.1, pitch: 1.0 },
  { name: 'Ports ostréicoles', lon: -1.075, lat: 44.648, d: 1000, az: 0.4, pitch: 1.0 },
  { name: 'Delta de l’Eyre', lon: -1.02, lat: 44.66, d: 1150, az: 0.6, pitch: 0.95 },
  { name: 'Arès – Andernos', lon: -1.12, lat: 44.745, d: 1300, az: -0.2, pitch: 0.95 },
];

// ================================================================ recherche + « à découvrir »
const sInput = $('#search'), sRes = $('#results');
let sSel = 0, sItems = [];
const sIdx = searchIndex.map((e) => ({ ...e, key: norm(e.name) }));
function renderResults(groups) {
  let i = 0; sItems = [];
  sRes.innerHTML = groups.map(([title, items]) => (title ? `<li class="group">${title}</li>` : '') + items.map((e) => {
    sItems.push(e); const k = i++;
    return `<li class="opt" role="option" data-i="${k}" aria-selected="${k === sSel}"><span>${esc(e.name)}</span><span>${esc(e.kind)}</span></li>`;
  }).join('')).join('') || '<li class="empty">Aucun résultat</li>';
  sRes.hidden = false;
}
function runSearch() {
  const q = norm(sInput.value.trim()); sSel = 0;
  if (!q) return renderResults([['À découvrir', VIEWS.slice(1).map((v) => ({ ...v, kind: 'Vue', view: v }))]]);
  const words = q.split(/\s+/);
  const seen = new Set();
  const items = sIdx.filter((e) => words.every((w) => e.key.includes(w)))
    .map((e) => ({ e, s: (e.key.startsWith(q) ? 0 : 1) + (/Commune|Chenal|Port|Cabane/.test(e.kind) ? 0 : 0.5) + e.key.length / 200 }))
    .sort((a, b) => a.s - b.s).map((x) => x.e)
    .filter((e) => { const k = e.name + e.kind; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 9);
  const views = VIEWS.filter((v) => norm(v.name).includes(q)).map((v) => ({ ...v, kind: 'Vue', view: v }));
  renderResults([[views.length ? 'Vues' : '', views], [items.length && views.length ? 'Lieux' : '', items]].filter((g) => g[1].length));
}
function choose(e) {
  if (!e) return;
  sRes.hidden = true; sInput.blur(); sInput.value = e.view ? '' : e.name;
  closePopup();
  if (e.view) return flyTo(e.lon, e.lat, e.d, { az: e.az, pitch: e.pitch });
  flyTo(e.lon, e.lat, e.dist, { pitch: 0.9 });
  setTimeout(() => {
    if (e.mark) showMark(e.mark);
    else if (e.hut) showHut(e.hut);
    else if (e.port) showPort(e.port);
    else { const [x, z] = proj(e.lon, e.lat); showPoint(new THREE.Vector3(x, yOf(Math.max(heightAt(e.lon, e.lat) ?? 0, state.tide)), z), e.zone || null); }
  }, 1550);
}
sInput.addEventListener('input', runSearch);
sInput.addEventListener('focus', runSearch);
sInput.addEventListener('keydown', (ev) => {
  if (sRes.hidden) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault(); sSel = (sSel + (ev.key === 'ArrowDown' ? 1 : -1) + sItems.length) % Math.max(sItems.length, 1);
    $$('#results li.opt').forEach((li, i) => li.setAttribute('aria-selected', i === sSel));
  } else if (ev.key === 'Enter') choose(sItems[sSel]);
  else if (ev.key === 'Escape') { sRes.hidden = true; sInput.blur(); }
});
sRes.addEventListener('pointerdown', (ev) => { const li = ev.target.closest('li[data-i]'); if (li) { ev.preventDefault(); choose(sItems[+li.dataset.i]); } });
sInput.addEventListener('blur', () => setTimeout(() => (sRes.hidden = true), 150));

// ================================================================ marée
const amp = () => (TIDE.rangePer100 * state.coef) / 100 / 2;
const tideAt = (ph) => TIDE.mean + amp() * Math.cos((2 * Math.PI * ph) / TIDE.T);
const CW = 280, CH = 48, CY0 = 3;
const hToY = (h) => CY0 + (1 - h / 5) * (CH - CY0);
const phToX = (ph) => ((ph + TIDE.T / 2) / TIDE.T) * CW;
function drawCurve() {
  let d = '';
  for (let i = 0; i <= 70; i++) { const ph = -TIDE.T / 2 + (i / 70) * TIDE.T; d += `${i ? 'L' : 'M'}${phToX(ph).toFixed(1)},${hToY(tideAt(ph)).toFixed(1)}`; }
  $('#tc-line').setAttribute('d', d);
  $('#tc-fill').setAttribute('d', `${d}L${CW},${CH}L0,${CH}Z`);
}
function phaseLabel(ph) {
  const a = Math.abs(ph);
  if (a < 0.25) return 'Pleine mer';
  if (a > TIDE.T / 2 - 0.25) return 'Basse mer';
  const h = Math.floor(a), m = Math.round((a - h) * 60);
  return `PM ${ph < 0 ? '−' : '+'} ${h} h ${String(m).padStart(2, '0')} · ${ph < 0 ? 'montant ↑' : 'descendant ↓'}`;
}
function applyTide(h) {
  state.tide = Math.round(h * 100) / 100; U_.uTide.value = state.tide;
  $('#tide-out').textContent = fmt(state.tide, 2);
  const x = phToX(state.phase), y = hToY(state.tide);
  $('#tc-dot').setAttribute('cx', x); $('#tc-dot').setAttribute('cy', y);
  $('#tc-now').setAttribute('x1', x); $('#tc-now').setAttribute('x2', x);
  $('#tide-phase').textContent = phaseLabel(state.phase);
  placeObjects();
}
function setPhase(ph) { ph = ((ph + TIDE.T / 2) % TIDE.T + TIDE.T) % TIDE.T - TIDE.T / 2; state.phase = ph; applyTide(tideAt(ph)); }
const curve = $('#tide-curve');
function curveEvent(ev) {
  const r = curve.getBoundingClientRect();
  stopPlay(); setPhase((Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1)) * TIDE.T - TIDE.T / 2);
}
curve.addEventListener('pointerdown', (e) => { curve.setPointerCapture(e.pointerId); curveEvent(e); });
curve.addEventListener('pointermove', (e) => { if (e.buttons) curveEvent(e); });
$('#coef').addEventListener('change', (e) => { state.coef = +e.target.value; drawCurve(); setPhase(state.phase); });
const playBtn = $('#tide-play');
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', PAUSE_ICON = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
function stopPlay() { state.playing = false; playBtn.innerHTML = PLAY_ICON; }
playBtn.onclick = () => { state.playing = !state.playing; playBtn.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON; };
const HOURS_PER_SEC = 0.6;

// ================================================================ calques, fonds, réglages
const DEPTH_LEGENDS = [
  `<div class="grad" style="background:linear-gradient(90deg,#c9b98f 0 6%,#8fdbcf 6%,#33a0b5 25%,#125488 55%,#082b54)"></div>
   <div class="ticks"><span>à sec</span><span>3 m d’eau</span><span>10 m</span><span>25 m</span></div>`,
  `<div class="bands"><i style="background:#f6e8b8"></i><i style="background:#b5c993"></i><i style="background:#8fc2e8"></i><i style="background:#b3d6f2"></i><i style="background:#d4e8f7"></i><i style="background:#f6f9fd"></i></div>
   <div class="ticks"><span>terre</span><span>découvre</span><span>0–2</span><span>2–5</span><span>5–10</span><span>&gt;10 m</span></div>`,
  `<div class="grad" style="background:linear-gradient(90deg,#8a8a6a,#6fb7b9 20%,#1f6c95 60%,#0b335e)"></div>
   <div class="ticks"><span>à sec</span><span>3 m d’eau</span><span>10 m</span><span>25 m</span></div>`,
];
function setStyle(s) {
  state.style = s; U_.uStyle.value = s;
  $$('#style button').forEach((b) => b.classList.toggle('on', +b.dataset.style === s));
  if (s === 2) loadOrtho();
  document.body.classList.toggle('dark-labels', s === 2 || state.night);
  $('#depth-legend').innerHTML = DEPTH_LEGENDS[s];
}
$$('#style button').forEach((b) => (b.onclick = () => setStyle(+b.dataset.style)));
$$('.tile').forEach((b) => (b.onclick = () => {
  const k = b.dataset.layer; state.layers[k] = !state.layers[k]; b.classList.toggle('on', state.layers[k]);
  navGroup.visible = state.layers.nav; forest.visible = state.layers.trees; landmarkGroup.visible = state.layers.landmarks; U_.uIso.value = state.layers.iso ? 1 : 0;
  if (['crassat', 'sable', 'presale', 'marais', 'navlines'].includes(k)) drawOverlay();
}));
$('#exag').oninput = (e) => { state.exag = +e.target.value; U_.uExag.value = state.exag; $('#exag-out').textContent = `×${state.exag}`; placeObjects(); exagDirty = true; };
const layersEl = $('#layers'), layersBtn = $('#layers-btn');
function toggleLayers(open = layersEl.hidden) { layersEl.hidden = !open; layersBtn.classList.toggle('on', open); layersBtn.setAttribute('aria-expanded', open); }
layersBtn.onclick = () => toggleLayers();
$('#layers-close').onclick = () => toggleLayers(false);
$('#night').onclick = () => {
  state.night = !state.night; U_.uNight.value = state.night ? 1 : 0;
  document.body.classList.toggle('night', state.night); $('#night').classList.toggle('on', state.night);
  document.body.classList.toggle('dark-labels', state.style === 2 || state.night);
  hemi.intensity = state.night ? 0.16 : 1.05; sun.intensity = state.night ? 0.12 : 2.0;
  U_.uFog.value.set(state.night ? 0x08111f : 0xe4e9ea);
  earthMat.color.setScalar(state.night ? 0.35 : 1); wallWaterMat.color.set(state.night ? 0x0d2f4a : 0x2b86b4);
  clouds.mat.color.set(state.night ? 0x4a5a74 : 0xffffff); clouds.mat.emissive.set(state.night ? 0x0a1220 : 0x8aa0b4); clouds.mat.opacity = state.night ? 0.35 : 0.94;
};

// commandes de vue
$('#compass').onclick = () => { const off = camera.position.clone().sub(controls.target); const r = Math.hypot(off.x, off.z);
  flight = { t0: performance.now(), dur: 700, p0: camera.position.clone(), t0v: controls.target.clone(), t1v: controls.target.clone(),
    p1: new THREE.Vector3(controls.target.x, camera.position.y, controls.target.z + r) }; };
const dolly = (k) => { const p1 = controls.target.clone().add(camera.position.clone().sub(controls.target).multiplyScalar(k));
  flight = { t0: performance.now(), dur: 450, p0: camera.position.clone(), t0v: controls.target.clone(), t1v: controls.target.clone(), p1 }; };
$('#zoom-in').onclick = () => dolly(0.6);
$('#zoom-out').onclick = () => dolly(1.6);
let flat = false;
$('#pitch').onclick = () => {
  flat = !flat; $('#pitch').textContent = flat ? '3D' : '2D';
  const d = camera.position.distanceTo(controls.target), [lo, la] = unproj(controls.target.x, controls.target.z);
  flyTo(lo, la, d, { pitch: flat ? 0.001 : 0.95, az: flat ? 0 : null, dur: 900 });
};

// tutoriel
const tuto = initTuto();
$('#help').onclick = () => { closePopup(); toggleLayers(false); tuto.open(); };

// ================================================================ étiquettes : projection + collisions
const tmp = new THREE.Vector3();
const GATE = {
  crassat: () => state.layers.crassat && state.layers.names, sable: () => state.layers.sable && state.layers.names,
  presale: () => state.layers.presale && state.layers.names, marais: () => state.layers.marais && state.layers.names,
  names: () => state.layers.names, communes: () => true, ports: () => state.layers.ports, navnames: () => state.layers.nav && state.layers.navnames,
  landmarks: () => state.layers.landmarks,
};
function updateLabels() {
  const camD = camera.position.distanceTo(controls.target);
  const cand = [];
  for (const L of labels) {
    let show = GATE[L.layer]();
    if (show && camD > L.maxDist) show = false;
    if (show) {
      const [x, z] = proj(L.lon, L.lat); const h = heightAt(L.lon, L.lat) ?? 0;
      tmp.set(x, yOf(Math.max(h, state.tide)) + (L.layer === 'communes' ? 12 : L.layer === 'navnames' ? 16 : 3), z).project(camera);
      if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) show = false;
      else { L.sx = (tmp.x * 0.5 + 0.5) * innerWidth; L.sy = (-tmp.y * 0.5 + 0.5) * innerHeight; }
    }
    if (show) cand.push(L);
    else if (L.disp) { L.el.style.display = 'none'; L.el.classList.remove('on'); L.disp = false; }
  }
  cand.sort((a, b) => b.pri - a.pri);
  const placed = [];
  for (const L of cand) {
    if (!L.disp) { L.el.style.display = 'block'; L.disp = true; }
    if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const x = L.anchorLeft ? L.sx - 8 : L.sx - L.w / 2, y = L.sy - L.h / 2;
    const r = [x - 4, y - 3, x + L.w + 4, y + L.h + 3];
    const hit = placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
    L.el.classList.toggle('on', !hit);
    L.el.style.pointerEvents = hit ? 'none' : '';
    if (hit) continue;
    placed.push(r);
    L.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
  }
}
const NICE = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
function updateScale() {
  const a = controls.target.clone(), b = a.clone().add(new THREE.Vector3(100, 0, 0));
  a.project(camera); b.project(camera);
  const pxPerKm = Math.hypot((b.x - a.x) * innerWidth / 2, (b.y - a.y) * innerHeight / 2);
  if (!isFinite(pxPerKm) || pxPerKm <= 0) return;
  const m = NICE.find((n) => (n / 1000) * pxPerKm >= 60) ?? 10000;
  $('#scale .bar').style.width = `${(m / 1000) * pxPerKm}px`;
  $('#scale span').textContent = `${m >= 1000 ? `${m / 1000} km` : `${m} m`} · ${fmt(m / 1852, m < 1000 ? 2 : 1)} M`;
}

// ================================================================ boucle de rendu
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); labels.forEach((l) => (l.w = 0)); });
const clock = new THREE.Clock();
const needle = $('#needle');
let lastT = performance.now(), frameN = 0, lastHutScale = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  if (state.playing) setPhase(state.phase + dt * HOURS_PER_SEC);
  stepFlight(now);
  controls.enabled = !flight;
  if (!flight) controls.update();
  const t = controls.target;
  t.x = THREE.MathUtils.clamp(t.x, -WU * 0.55, WU * 0.55); t.z = THREE.MathUtils.clamp(t.z, -HU * 0.55, HU * 0.55);
  const minY = yOf(Math.max(state.tide, 0)) + 12; if (camera.position.y < minY) camera.position.y = minY;
  if (flight) camera.lookAt(t);
  const el = clock.getElapsedTime(); U_.uTime.value = el;
  const camD = camera.position.distanceTo(t);
  const sc = THREE.MathUtils.clamp(camD / 650, 0.45, 4.2);
  for (const m of marks) {
    m.obj.scale.setScalar(sc);
    for (const s of m.sprites) { s.sprite.material.opacity = s.fn(el) * (state.night ? 1 : 0.7); s.sprite.scale.setScalar(s.base * (state.night ? 1.8 : 1)); }
  }
  const hs = Math.round(THREE.MathUtils.clamp(camD / 700, 1, 3.2) * 20) / 20;
  if (exagDirty || hs !== lastHutScale) { placeHuts(hs); lastHutScale = hs; }
  if (exagDirty) { placeForest(); exagDirty = false; }
  for (const c of clouds.clouds) { c.g.position.x += c.v * dt; if (c.g.position.x > WU * 0.95) c.g.position.x = -WU * 0.95; }
  needle.setAttribute('transform', `rotate(${(Math.atan2(camera.position.x - t.x, camera.position.z - t.z) * 180) / Math.PI} 20 20)`);
  if (popupAnchor && !popup.hidden) {
    tmp.copy(popupAnchor).project(camera);
    if (tmp.z > 1) popup.style.visibility = 'hidden';
    else { popup.style.visibility = ''; popup.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`; popup.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight}px`; }
  }
  updateLabels();
  if (frameN++ % 6 === 0) updateScale();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ================================================================ démarrage
drawOverlay();
drawCurve();
setStyle(0);
setPhase(state.phase);
{
  const v = VIEWS[0], [x, z] = proj(v.lon, v.lat);
  controls.target.set(x, 0, z);
  camera.position.set(x + Math.sin(v.az) * Math.sin(v.pitch) * v.d * 1.6, Math.cos(v.pitch) * v.d * 1.6 + 1500, z + Math.cos(v.az) * Math.sin(v.pitch) * v.d * 1.6);
  controls.update();
  flyTo(v.lon, v.lat, v.d, { az: v.az, pitch: v.pitch, dur: 2600 });
}
requestAnimationFrame(frame);
$('#loading').classList.add('done');
setTimeout(() => $('#loading').remove(), 900);
if (!tuto.seen()) setTimeout(() => tuto.open(), 1400);
window.__bassin = { state, marks, labels, camera, controls, setPhase, setStyle, flyTo, pines, huts, tuto };
