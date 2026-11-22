// Bassin d'Arcachon — carte 3D interactive
// Relief : EMODnet Bathymetry (réf. ~ zéro hydrographique). Milieux / ports / balisage : OpenStreetMap.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

const $ = (s) => document.querySelector(s);
const getJSON = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const EMPTY = { type: 'FeatureCollection', features: [] };

// ---------------------------------------------------------------- données
const [META, bin, ZONES, SEAMARKS, NAVLINES, PORTS, PLACES, COMMUNES] = await Promise.all([
  getJSON('data/bathy.json'),
  fetch('data/bathy.bin').then((r) => r.arrayBuffer()),
  getJSON('data/zones.geojson'), getJSON('data/seamarks.geojson'), getJSON('data/navlines.geojson'),
  getJSON('data/ports.geojson'), getJSON('data/places.geojson'), getJSON('data/communes.json'),
]);
const HCM = new Int16Array(bin);
const GW = META.width, GH = META.height;
const { west: W, east: E, south: S, north: N } = META;
const LON0 = (W + E) / 2, LAT0 = (S + N) / 2;
const U = 10; // 1 unité scène = 10 m
const MX = (111320 * Math.cos((LAT0 * Math.PI) / 180)) / U; // unités / degré lon
const MZ = 111132 / U; // unités / degré lat
const WU = (E - W) * MX, HU = (N - S) * MZ;

const proj = (lon, lat) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const unproj = (x, z) => [x / MX + LON0, -z / MZ + LAT0];

function heightAt(lon, lat) { // m, bilinéaire
  const fx = ((lon - W) / (E - W)) * (GW - 1), fy = ((N - lat) / (N - S)) * (GH - 1);
  if (fx < 0 || fy < 0 || fx > GW - 1 || fy > GH - 1) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, GW - 1), y1 = Math.min(y0 + 1, GH - 1);
  const tx = fx - x0, ty = fy - y0, g = (x, y) => HCM[y * GW + x] / 100;
  return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
}

// ---------------------------------------------------------------- état
const state = {
  tide: 2.4, exag: 14, iso: true, night: false, ortho: false,
  layers: { crassat: true, sable: true, presale: true, marais: true, names: true, communes: true, ports: true, nav: true, navlines: true, navnames: false },
};

// ---------------------------------------------------------------- scène
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('#scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color(0xbcd3e3), SKY_NIGHT = new THREE.Color(0x050b16);
scene.background = SKY_DAY.clone();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 5, 60000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 60; controls.maxDistance = 9000;
controls.zoomToCursor = true;
const [cx, cz] = proj(-1.13, 44.675);
controls.target.set(cx, 0, cz);
camera.position.set(cx - 900, 2300, cz + 2600);
controls.update();

const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.5, 1, 0.35).multiplyScalar(5000); scene.add(sun);
const hemi = new THREE.HemisphereLight(0xdfefff, 0x445566, 0.9); scene.add(hemi);
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();

// ---------------------------------------------------------------- terrain (shader)
const geo = new THREE.BufferGeometry();
const nV = GW * GH;
const pos = new Float32Array(nV * 3), hAttr = new Float32Array(nV), grad = new Float32Array(nV * 2), uvs = new Float32Array(nV * 2);
const dxm = ((E - W) / (GW - 1)) * MX * U, dzm = ((N - S) / (GH - 1)) * MZ * U; // pas en mètres
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const k = j * GW + i;
  pos[k * 3] = -WU / 2 + (i / (GW - 1)) * WU; pos[k * 3 + 2] = -HU / 2 + (j / (GH - 1)) * HU;
  hAttr[k] = HCM[k] / 100;
  const hl = HCM[j * GW + Math.max(i - 1, 0)] / 100, hr = HCM[j * GW + Math.min(i + 1, GW - 1)] / 100;
  const hu = HCM[Math.max(j - 1, 0) * GW + i] / 100, hd = HCM[Math.min(j + 1, GH - 1) * GW + i] / 100;
  grad[k * 2] = (hr - hl) / (2 * dxm); grad[k * 2 + 1] = (hd - hu) / (2 * dzm);
  uvs[k * 2] = i / (GW - 1); uvs[k * 2 + 1] = 1 - j / (GH - 1);
}
const idx = new Uint32Array((GW - 1) * (GH - 1) * 6);
for (let j = 0, p = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
  const a = j * GW + i, b = a + 1, c = a + GW, d = c + 1;
  idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
}
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('h', new THREE.BufferAttribute(hAttr, 1));
geo.setAttribute('grad', new THREE.BufferAttribute(grad, 2));
geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
geo.setIndex(new THREE.BufferAttribute(idx, 1));
geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(WU, HU));

const OV_SIZE = 4096;
const ovCanvas = document.createElement('canvas'); ovCanvas.width = ovCanvas.height = OV_SIZE;
const ovTex = new THREE.CanvasTexture(ovCanvas); ovTex.anisotropy = 8; ovTex.colorSpace = THREE.SRGBColorSpace;
const topCanvas = document.createElement('canvas'); topCanvas.width = topCanvas.height = OV_SIZE;
const topTex = new THREE.CanvasTexture(topCanvas); topTex.anisotropy = 8; topTex.colorSpace = THREE.SRGBColorSpace;
const orthoCanvas = document.createElement('canvas'); orthoCanvas.width = orthoCanvas.height = OV_SIZE;
const orthoTex = new THREE.CanvasTexture(orthoCanvas); orthoTex.anisotropy = 8; orthoTex.colorSpace = THREE.SRGBColorSpace;

const uniforms = {
  uTide: { value: state.tide }, uExag: { value: state.exag }, uLand: { value: 0.3 }, uIso: { value: 1 }, uNight: { value: 0 }, uOrthoOn: { value: 0 },
  uOverlay: { value: ovTex }, uTop: { value: topTex }, uOrtho: { value: orthoTex }, uSun: { value: SUN_DIR },
  uFogColor: { value: scene.background }, uFogNear: { value: 3500 }, uFogFar: { value: 14000 },
};
const terrainMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute float h; attribute vec2 grad;
    uniform float uExag, uLand;
    varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
    void main() {
      vH = h; vUv = uv;
      // la terre (> 5 m) est compressée pour garder l'attention sur l'eau
      float hd = h > 5.0 ? 5.0 + (h - 5.0) * uLand : h;
      float gk = h > 5.0 ? uExag * uLand : uExag;
      vec3 p = position; p.y = hd * uExag * 0.1;
      vN = normalize(vec3(-grad.x * gk, 1.0, -grad.y * gk));
      vec4 wp = modelMatrix * vec4(p, 1.0); vPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uTide, uIso, uNight, uOrthoOn, uFogNear, uFogFar;
    uniform sampler2D uOverlay, uTop, uOrtho; uniform vec3 uSun, uFogColor;
    varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
    float iso(float h, float L) { float w = fwidth(h); return 1.0 - smoothstep(0.4, 1.4, abs(h - L) / max(w, 1e-4)); }
    vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
    void main() {
      #include <logdepthbuf_fragment>
      float h = vH, d = uTide - h;
      vec3 mud = vec3(.60,.55,.44), sand = vec3(.86,.79,.60), land = vec3(.80,.81,.76), landHi = vec3(.72,.75,.66), dune = vec3(.93,.86,.66);
      vec3 col;
      if (h > 5.0) col = mix(land, landHi, smoothstep(6., 30., h));
      else col = mix(mud, sand, smoothstep(.5, 4.5, h));
      if (h > 4.5 && h < 7.0) col = mix(sand, col, smoothstep(4.5, 7.0, h));
      if (uOrthoOn > .5) col = min(texture2D(uOrtho, vUv).rgb * 1.18, vec3(1.0));
      vec4 ov = texture2D(uOverlay, vUv);
      col = mix(col, ov.rgb, ov.a * (uOrthoOn > .5 ? .55 : 1.0));
      // eau
      if (d > 0.0) {
        vec3 shallow = vec3(.42,.78,.78), mid = vec3(.12,.46,.62), deep = vec3(.03,.15,.30);
        vec3 water = mix(shallow, mid, smoothstep(0., 5., d)); water = mix(water, deep, smoothstep(5., 25., d));
        float k = uOrthoOn > .5 ? .25 + .55 * smoothstep(0., 12., d) : .45 + .55 * smoothstep(0., 3., d);
        col = mix(col, water, k);
        col = mix(col, vec3(.9,.97,1.), (1.0 - smoothstep(0., .25, d)) * .35); // liseré d'écume
      }
      vec4 tp = texture2D(uTop, vUv);
      col = mix(col, tp.rgb, tp.a * (uOrthoOn > .5 && tp.r > .8 ? .35 : 1.0));
      vec3 n = normalize(vN);
      float dif = max(dot(n, normalize(uSun)), 0.0);
      col *= .52 + .62 * dif;
      if (uIso > .5) {
        float l0 = iso(h, 0.0);
        float l = max(max(iso(h, -2.), iso(h, -5.)), max(iso(h, -10.), iso(h, -20.)));
        col = mix(col, vec3(.05,.13,.25), l0 * .85);
        col = mix(col, vec3(.85,.95,1.), l * .55);
      }
      if (uNight > .5) col *= vec3(.24,.28,.4);
      float fd = distance(vPos, cameraPosition);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fd));
      gl_FragColor = vec4(toLin(col), 1.0);
      #include <colorspace_fragment>
    }`,
  extensions: { derivatives: true },
});
const terrain = new THREE.Mesh(geo, terrainMat);
terrain.frustumCulled = false;
scene.add(terrain);

// ---------------------------------------------------------------- eau, océan et abords hors grille
const waterMat = new THREE.MeshPhongMaterial({ color: 0x2f86b8, transparent: true, opacity: 0.16, shininess: 90, specular: 0x99bbdd, depthWrite: false });
const water = new THREE.Mesh(new THREE.PlaneGeometry(WU, HU), waterMat);
water.rotation.x = -Math.PI / 2; water.renderOrder = 2; scene.add(water);
const oceanMat = new THREE.MeshPhongMaterial({ color: 0x0f3150, shininess: 60, specular: 0x335577 });
const landMat = new THREE.MeshLambertMaterial({ color: 0xa9ad9f });
const BIG = 40000;
function coastX(row) { // abscisse du premier point « terre » d'une ligne de la grille (depuis l'ouest)
  for (let i = 0; i < GW; i++) if (HCM[row * GW + i] > 600) return -WU / 2 + (i / (GW - 1)) * WU;
  return WU / 2;
}
const outer = new THREE.Group(); scene.add(outer);
function quad(x0, x1, z0, z1, mat, y = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
  m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.userData.baseY = y; outer.add(m); return m;
}
const xN = coastX(0), xS = coastX(GH - 1);
const oceanQuads = [
  quad(-BIG, -WU / 2, -BIG, BIG, oceanMat),
  quad(-WU / 2, xN, -BIG, -HU / 2, oceanMat),
  quad(-WU / 2, xS, HU / 2, BIG, oceanMat),
];
const landQuads = [
  quad(xN, BIG, -BIG, -HU / 2, landMat, 1),
  quad(xS, BIG, HU / 2, BIG, landMat, 1),
  quad(WU / 2, BIG, -HU / 2, HU / 2, landMat, 1),
];

// ---------------------------------------------------------------- calque vectoriel drapé (canvas)
const ctxUnder = ovCanvas.getContext('2d'), ctxTop = topCanvas.getContext('2d');
let ctx = ctxUnder;
const toPx = (lon, lat) => [((lon - W) / (E - W)) * OV_SIZE, ((N - lat) / (N - S)) * OV_SIZE];
const zoneByCls = (c) => ZONES.features.filter((f) => f.properties.cls === c);
function pattern(fn) { const c = document.createElement('canvas'); c.width = c.height = 16; fn(c.getContext('2d')); return ctx.createPattern(c, 'repeat'); }
const patCrassat = pattern((g) => { g.strokeStyle = 'rgba(120,92,50,.55)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 16); g.lineTo(16, 0); g.stroke(); });
const patMarais = pattern((g) => { g.fillStyle = 'rgba(93,138,108,.85)'; g.fillRect(0, 0, 16, 16); g.strokeStyle = 'rgba(40,80,55,.9)'; g.lineWidth = 1.5;
  for (const x of [3, 11]) { g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 6); g.moveTo(x - 2, 12); g.lineTo(x - 3, 8); g.moveTo(x + 2, 12); g.lineTo(x + 3, 8); g.stroke(); } });
function tracePoly(coords) {
  for (const ring of coords) { ring.forEach(([lo, la], i) => { const [x, y] = toPx(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
}
function drawZones(list, fill, stroke, lw = 2, dash = []) {
  for (const f of list) {
    ctx.beginPath();
    for (const poly of f.geometry.coordinates) tracePoly(poly);
    if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    if (stroke) { ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]); }
  }
}
function navLineStyle(t) {
  if (/cable|pipeline/.test(t)) return ['rgba(150,90,220,.9)', [10, 8], 2];
  if (/restricted|anchorage|military|marine_farm|seaplane|dumping/.test(t)) return ['rgba(214,63,180,.85)', [16, 6, 3, 6], 2.5];
  if (/harbour|small_craft|mooring/.test(t)) return ['rgba(255,209,102,.8)', [], 2];
  return ['rgba(214,63,180,.95)', [18, 10], 3.2]; // chenaux, alignements, routes
}
function drawOverlay() {
  ctxUnder.clearRect(0, 0, OV_SIZE, OV_SIZE); ctxTop.clearRect(0, 0, OV_SIZE, OV_SIZE);
  ctx = ctxUnder;
  const L = state.layers;
  if (L.crassat) drawZones(zoneByCls('crassat'), patCrassat, 'rgba(120,88,40,.75)', 2.2);
  if (L.presale) drawZones(zoneByCls('pre_sale'), 'rgba(141,164,90,.88)', 'rgba(70,95,40,.9)', 1.6);
  if (L.marais) drawZones(zoneByCls('marais'), patMarais, 'rgba(40,80,55,.9)', 1.6);
  ctx = ctxTop;
  if (L.sable) {
    drawZones(zoneByCls('banc_sable'), 'rgba(242,228,186,.92)', 'rgba(170,140,80,.9)', 2);
    drawZones(zoneByCls('plage'), 'rgba(245,232,192,.9)', null);
  }
  drawZones(zoneByCls('ile'), null, 'rgba(60,70,60,.6)', 1.5);
  if (L.navlines) for (const f of NAVLINES.features) {
    const t = f.properties['seamark:type'] || '';
    const [col, dash, lw] = navLineStyle(t);
    ctx.beginPath();
    f.geometry.coordinates.forEach(([lo, la], i) => { const [x, y] = toPx(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx = ctxUnder;
  ovTex.needsUpdate = true; topTex.needsUpdate = true;
}

// ---------------------------------------------------------------- orthophoto IGN (chargée à la demande)
let orthoLoaded = false;
function loadOrtho() {
  if (orthoLoaded) return; orthoLoaded = true;
  const g = orthoCanvas.getContext('2d'); g.fillStyle = '#8a9a88'; g.fillRect(0, 0, OV_SIZE, OV_SIZE);
  const z = 14, n = 2 ** z;
  const tx = (lon) => ((lon + 180) / 360) * n;
  const ty = (lat) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const tlat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const tlon = (x) => (x / n) * 360 - 180;
  let pending = 0;
  for (let y = Math.floor(ty(N)); y <= Math.floor(ty(S)); y++) for (let x = Math.floor(tx(W)); x <= Math.floor(tx(E)); x++) {
    const img = new Image(); img.crossOrigin = 'anonymous'; pending++;
    img.onload = () => {
      const [x0, y0] = toPx(tlon(x), tlat(y)), [x1, y1] = toPx(tlon(x + 1), tlat(y + 1));
      g.drawImage(img, x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
      if (--pending % 25 === 0 || pending === 0) orthoTex.needsUpdate = true;
    };
    img.onerror = () => { if (--pending === 0) orthoTex.needsUpdate = true; };
    img.src = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
  }
}

// ---------------------------------------------------------------- balisage 3D
const COLORS = { red: 0xd7263d, green: 0x1e9e4a, yellow: 0xf2c80f, black: 0x151515, white: 0xf4f4f4, orange: 0xff8c1a, blue: 0x2b6fd6, grey: 0x888888, brown: 0x7a4a2a };
const matCache = {};
const mat = (c) => (matCache[c] ??= new THREE.MeshLambertMaterial({ color: COLORS[c] ?? 0xcccccc }));
const G = {
  can: new THREE.CylinderGeometry(1, 1, 1, 14), cone: new THREE.ConeGeometry(1, 1, 14), sphere: new THREE.SphereGeometry(1, 14, 10),
  pole: new THREE.CylinderGeometry(0.18, 0.18, 1, 8),
};
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const LIGHT_RGB = { white: 0xfff4c8, red: 0xff3b3b, green: 0x3bff6a, yellow: 0xffd84a, blue: 0x5aa0ff, orange: 0xffa040, violet: 0xc070ff };
const NAV_TYPES = /buoy_|beacon_|light_|light_float|light_vessel|daymark|landmark|fog_signal|pile|rock|wreck|obstruction/;
const TYPE_FR = {
  buoy_lateral: 'Bouée latérale', beacon_lateral: 'Balise latérale', buoy_cardinal: 'Bouée cardinale', beacon_cardinal: 'Balise cardinale',
  buoy_special_purpose: 'Bouée spéciale', beacon_special_purpose: 'Balise spéciale', buoy_safe_water: 'Bouée eaux saines', beacon_safe_water: 'Balise eaux saines',
  buoy_isolated_danger: 'Bouée danger isolé', beacon_isolated_danger: 'Balise danger isolé', light_major: 'Feu principal', light_minor: 'Feu secondaire',
  light_float: 'Feu flottant', landmark: 'Amer', harbour: 'Port', mooring: 'Mouillage / corps-mort', small_craft_facility: 'Équipement plaisance',
  anchorage: 'Zone de mouillage', restricted_area: 'Zone réglementée', wreck: 'Épave', rock: 'Roche', obstruction: 'Obstruction', pile: 'Pieu',
  daymark: 'Marque de jour', fog_signal: 'Signal de brume', notice: 'Panneau', marine_farm: 'Concession conchylicole',
  navigation_line: 'Ligne de navigation / alignement', recommended_track: 'Route recommandée', fairway: 'Chenal', cable_submarine: 'Câble sous-marin',
  pipeline_submarine: 'Canalisation sous-marine', bridge: 'Pont', berth: 'Poste à quai', gate: 'Écluse / porte',
};
const CAT_FR = { port: 'bâbord', starboard: 'tribord', preferred_channel_port: 'chenal préféré à bâbord', preferred_channel_starboard: 'chenal préféré à tribord',
  north: 'Nord', south: 'Sud', east: 'Est', west: 'Ouest' };
const COL_FR = { red: 'rouge', green: 'vert', yellow: 'jaune', black: 'noir', white: 'blanc', orange: 'orange', blue: 'bleu', grey: 'gris', brown: 'brun' };
const SHAPE_FR = { can: 'cylindrique (plate)', conical: 'conique', pillar: 'charpente', spar: 'espar', sphere: 'sphérique', stake: 'perche', pole: 'perche',
  tower: 'tourelle', lattice: 'pylône', cairn: 'cairn', buoyant: 'flotteur', barrel: 'tonne', super_buoy: 'super-bouée', perch: 'perche' };
const TOP_FR = { cylinder: 'cylindre', 'cone, point up': 'cône pointe en haut', 'cone, point down': 'cône pointe en bas', '2 cones up': '2 cônes pointes en haut',
  '2 cones down': '2 cônes pointes en bas', '2 cones base together': '2 cônes opposés par la base', '2 cones point together': '2 cônes opposés par la pointe',
  sphere: 'sphère', '2 spheres': '2 sphères', 'x-shape': 'croix de Saint-André', cross: 'croix' };
const CH_ABBR = { white: 'W', red: 'R', green: 'G', yellow: 'Y', blue: 'Bu', orange: 'Or', violet: 'Vi' };

function lightsOf(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    const m = k.match(/^seamark:light:(?:(\d+):)?([a-z_]+)$/); if (!m) continue;
    (out[m[1] || '0'] ??= {})[m[2]] = v;
  }
  return Object.values(out).filter((l) => l.character || l.colour);
}
function lightText(l) {
  const col = (l.colour || '').split(';').map((c) => CH_ABBR[c] || c).join('');
  const grp = l.group ? `(${l.group})` : '';
  return [`${l.character || ''}${grp}`, col, l.period ? `${l.period}s` : '', l.height ? `${l.height}m` : '', l.range ? `${l.range}M` : ''].filter(Boolean).join(' ');
}
function flashFn(l) { // renvoie f(t) -> 0..1
  const ch = (l.character || 'F').replace(/\(.*\)/, '');
  const P = parseFloat(l.period) || ({ Q: 1, VQ: 0.5, IQ: 1, IVQ: 0.5, Fl: 4, LFl: 8, Iso: 4, Oc: 4 }[ch] ?? 4);
  const n = parseInt(l.group) || 1;
  const off = Math.random() * P;
  if (ch === 'F') return () => 1;
  if (l.sequence) { // ex. "0.5+(1.5)+0.5+(3.5)" : durées allumé / (éteint)
    const segs = l.sequence.split(/[+,]/).map((s) => ({ on: !/\(/.test(s), d: parseFloat(s.replace(/[()]/g, '')) || 0 }));
    const tot = segs.reduce((a, s) => a + s.d, 0);
    if (tot > 0) return (t) => { let u = (t + off) % tot; for (const s of segs) { if (u < s.d) return s.on ? 1 : 0; u -= s.d; } return 0; };
  }
  if (/^Iso/.test(ch)) return (t) => (((t + off) % P) < P / 2 ? 1 : 0);
  if (/^Oc/.test(ch)) return (t) => { const u = (t + off) % P; return u > P - n * 1.0 && ((u - (P - n * 1.0)) % 1.0) < 0.6 ? 0 : 1; };
  const fd = /^LFl/.test(ch) ? 2 : /VQ/.test(ch) ? 0.2 : /Q/.test(ch) ? 0.35 : 0.5;
  const cyc = /Q/.test(ch) && !l.group ? P : P;
  return (t) => { const u = (t + off) % cyc; const k = Math.floor(u / (fd * 2)); return k < n && (u % (fd * 2)) < fd ? 1 : 0; };
}

const navGroup = new THREE.Group(); scene.add(navGroup);
const marks = []; // {obj, lon, lat, floating, sprites:[{sprite, fn}], props}
for (const f of SEAMARKS.features) {
  const p = f.properties, t = p['seamark:type'] || '';
  const lights = lightsOf(p);
  if (!NAV_TYPES.test(t) && !lights.length) continue;
  const [lon, lat] = f.geometry.coordinates;
  const g = new THREE.Group();
  const colours = (p[`seamark:${t}:colour`] || '').split(';').filter(Boolean);
  const shape = p[`seamark:${t}:shape`] || '';
  const isBuoy = t.startsWith('buoy') || t === 'light_float';
  const isLight = t.startsWith('light_');
  let top = 0;
  if (!isLight || colours.length) {
    const cs = colours.length ? colours : [t.includes('special') ? 'yellow' : 'grey'];
    const H = isBuoy ? 3.2 : 5.5, R = isBuoy ? 1.3 : 0.5;
    const geom = /conical/.test(shape) ? G.cone : /spher/.test(shape) ? G.sphere : G.can;
    if (!isBuoy) { const pole = new THREE.Mesh(G.pole, mat('grey')); pole.scale.set(1, 3, 1); pole.position.y = 1.5; g.add(pole); top = 3; }
    const bh = H / cs.length;
    cs.forEach((c, i) => {
      const m = new THREE.Mesh(geom === G.cone ? (i === cs.length - 1 ? G.cone : G.can) : geom, mat(c));
      if (geom === G.sphere) { m.scale.setScalar(R * 1.1); m.position.y = top + R; }
      else { m.scale.set(R * (geom === G.cone ? 1.2 : 1), bh, R * (geom === G.cone ? 1.2 : 1)); m.position.y = top + bh * (i + 0.5); }
      g.add(m);
    });
    top += geom === G.sphere ? R * 2.2 : H;
    const tm = p['seamark:topmark:shape'] || '';
    if (tm) {
      const tc = (p['seamark:topmark:colour'] || 'black').split(';')[0];
      const cones = tm.match(/(\d) cones? (up|down)/) || tm.match(/(\d) cones?, (point up|point down)/);
      if (/cone/.test(tm)) {
        const ups = /2 cones up/.test(tm) ? [1, 1] : /2 cones down/.test(tm) ? [-1, -1] : /base/.test(tm) ? [-1, 1] : /point together|point to point/.test(tm) ? [1, -1] : /down/.test(tm) ? [-1] : [1];
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
  } else {
    const tower = new THREE.Mesh(G.can, mat('white')); tower.scale.set(0.9, 7, 0.9); tower.position.y = 3.5; g.add(tower);
    const lantern = new THREE.Mesh(G.can, mat('black')); lantern.scale.set(1.1, 1, 1.1); lantern.position.y = 7.5; g.add(lantern); top = 8;
  }
  const sprites = [];
  lights.slice(0, 1).forEach((l) => {
    const c = (l.colour || 'white').split(';')[0];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: LIGHT_RGB[c] ?? 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.y = top + 0.8; sp.scale.setScalar(t === 'light_major' ? 9 : 5); sp.renderOrder = 5; g.add(sp);
    sprites.push({ sprite: sp, fn: flashFn(l), base: t === 'light_major' ? 9 : 5 });
  });
  g.traverse((o) => { o.userData.mark = marks.length; });
  navGroup.add(g);
  marks.push({ obj: g, lon, lat, floating: isBuoy, sprites, props: p, type: t, lights, h: heightAt(lon, lat) });
}

// ---------------------------------------------------------------- étiquettes HTML
const labelsEl = $('#labels');
const labels = [];
function addLabel(text, lon, lat, cls, layer, pri, maxDist, extra = {}) {
  if (!text) return;
  const el = document.createElement('div'); el.className = 'lbl ' + cls; el.textContent = text; labelsEl.appendChild(el);
  labels.push({ el, lon, lat, layer, pri, maxDist, w: 0, h: 0, ...extra });
}
function ringCentroid(r) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < r.length - 1; i++) { const [x0, y0] = r[i], [x1, y1] = r[i + 1], c = x0 * y1 - x1 * y0; a += c; x += (x0 + x1) * c; y += (y0 + y1) * c; }
  if (Math.abs(a) < 1e-12) return r[0];
  return [x / (3 * a), y / (3 * a)];
}
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
// zones : centroïde + bbox pour l'identification au survol
for (const f of ZONES.features) {
  let best = null, ba = -1, bb = [180, 90, -180, -90];
  for (const poly of f.geometry.coordinates) {
    const a = ringArea(poly[0]); if (a > ba) { ba = a; best = poly[0]; }
    for (const [x, y] of poly[0]) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
  }
  f.bbox = bb; f.area = ba;
  const c = ringCentroid(best);
  const cls = f.properties.cls;
  const name = f.properties.name;
  if (!name || /^FR-/.test(name)) continue;
  if (cls === 'crassat' || cls === 'banc_sable' || cls === 'ile') addLabel(name, c[0], c[1], 'crassat', cls === 'crassat' ? 'crassat' : 'sable', cls === 'ile' || cls === 'banc_sable' ? 70 : 40 + Math.min(ba * 4e5, 25), cls === 'ile' || cls === 'banc_sable' ? 5000 : 1500);
  else if (cls === 'pre_sale' || cls === 'marais') addLabel(name, c[0], c[1], 'marais', cls === 'pre_sale' ? 'presale' : 'marais', 35, 1400);
}
// communes (coordonnées OSM si disponibles)
const placeByName = Object.fromEntries((PLACES?.features ?? []).filter((f) => /town|village|city/.test(f.properties.kind)).map((f) => [f.properties.name, f.geometry.coordinates]));
for (const c of COMMUNES) { const p = placeByName[c.name] || [c.lon, c.lat]; addLabel(c.name, p[0], p[1], 'commune', 'communes', 100, 20000); }
for (const f of PLACES?.features ?? []) {
  const k = f.properties.kind, nm = f.properties.name;
  if (COMMUNES.some((c) => c.name === nm)) continue;
  const [lo, la] = f.geometry.coordinates;
  if (k === 'channel') addLabel(nm, lo, la, 'water', 'names', /Teychan|Piquey|Rade|Courbey|Passe/.test(nm) ? 82 : 62, /Teychan|Piquey|Rade|Passe/.test(nm) ? 9000 : 3200);
  else if (k === 'estey') addLabel(nm, lo, la, 'water small', 'names', 34, 1100);
  else if (/town|village/.test(k)) continue;
  else if (/sea|bay|strait/.test(k)) addLabel(nm, lo, la, 'water', 'names', 85, 20000);
  else if (/cape|peninsula|dune/.test(k)) addLabel(nm, lo, la, 'place', 'names', 75, 9000);
  else if (/hamlet|suburb|village|locality|quarter/.test(k)) addLabel(nm, lo, la, 'place', 'names', 50, 1800);
  else if (/waterway/.test(k)) addLabel(nm, lo, la, 'water', 'names', 45, 1500);
}
for (const f of PORTS?.features ?? []) {
  const p = f.properties; if (!p.name || p.name.length < 3 || /^zone \d+$/i.test(p.name)) continue;
  const [lo, la] = f.geometry.coordinates;
  addLabel(p.name, lo, la, 'port' + (p.kind === 'slipway' ? ' slip' : ''), 'ports', p.kind === 'marina' || p.kind === 'harbour' ? 80 : 30, p.kind === 'slipway' ? 700 : 3500);
}
marks.forEach((m, i) => { const nm = m.props['seamark:name'] || m.props.name; if (nm) addLabel(nm, m.lon, m.lat, 'seamark', 'navnames', 20, 900, { mark: i }); });
// ports : petites épingles 3D
const portGeom = new THREE.CylinderGeometry(0, 1.6, 4, 10); portGeom.translate(0, 2, 0);
const portMat = new THREE.MeshLambertMaterial({ color: 0xffd166 });
const portGroup = new THREE.Group(); scene.add(portGroup);
const portPins = (PORTS?.features ?? []).filter((f) => f.properties.kind !== 'pier').map((f) => {
  const m = new THREE.Mesh(portGeom, portMat); m.rotation.x = Math.PI; m.userData.port = f; portGroup.add(m);
  const [lo, la] = f.geometry.coordinates; return { obj: m, lon: lo, lat: la, h: heightAt(lo, la) ?? 2, f };
});

// ---------------------------------------------------------------- mise à jour géométrique
const yOf = (hm) => (hm > 5 ? 5 + (hm - 5) * 0.3 : hm) * state.exag * 0.1;
function placeObjects() {
  water.position.y = yOf(state.tide);
  for (const q of oceanQuads) q.position.y = yOf(state.tide);
  for (const q of landQuads) q.position.y = yOf(10);
  for (const m of marks) {
    const [x, z] = proj(m.lon, m.lat);
    const ground = m.h ?? 0;
    const y = m.floating ? Math.max(ground, state.tide) : Math.max(ground, m.type.startsWith('light') ? ground : Math.min(ground, state.tide));
    m.obj.position.set(x, yOf(m.floating ? Math.max(ground, state.tide) : Math.max(ground, y)), z);
  }
  for (const p of portPins) { const [x, z] = proj(p.lon, p.lat); p.obj.position.set(x, yOf(Math.max(p.h, state.tide)) + 0.5, z); }
}

// ---------------------------------------------------------------- interactions
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickTerrain(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin.clone(), d = raycaster.ray.direction;
  const surf = (p) => { const [lo, la] = unproj(p.x, p.z); const h = heightAt(lo, la); return h == null ? null : yOf(h); };
  let prev = o.clone(), step = 4, t = 0;
  for (let i = 0; i < 6000 && t < 40000; i++) {
    t += step; const p = o.clone().addScaledVector(d, t);
    const s = surf(p);
    if (s != null && p.y <= s) { // bissection
      let a = t - step, b = t;
      for (let k = 0; k < 18; k++) { const mdl = (a + b) / 2, q = o.clone().addScaledVector(d, mdl), sq = surf(q); if (sq != null && q.y <= sq) b = mdl; else a = mdl; }
      return o.clone().addScaledVector(d, b);
    }
    step = Math.min(40, 4 + t * 0.004); prev = p;
  }
  return null;
}
function pickMark(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [];
  if (navGroup.visible) targets.push(navGroup);
  if (portGroup.visible) targets.push(portGroup);
  const hits = raycaster.intersectObjects(targets, true).filter((h) => h.object.type !== 'Sprite' || h.object.material.opacity > 0.05);
  return hits[0]?.object ?? null;
}
function pip(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const CLS_FR = { crassat: 'Crassat (banc intertidal)', pre_sale: 'Pré salé', marais: 'Marais / zone humide', banc_sable: 'Banc de sable', plage: 'Plage', ile: 'Île' };
function zonesAt(lon, lat) {
  const out = [];
  for (const f of ZONES.features) {
    const b = f.bbox; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const poly of f.geometry.coordinates) if (pip([lon, lat], poly[0]) && !poly.slice(1).some((r) => pip([lon, lat], r))) { out.push(f); break; }
  }
  return out.sort((a, b) => a.area - b.area);
}
const dm = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${d}°${m.toFixed(3).padStart(6, '0')}′${v >= 0 ? pos : neg}`; };
const fmt = (v, n = 1) => v.toFixed(n).replace('.', ',');

let hoverRAF = 0;
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0;
    const p = pickTerrain(ev.clientX, ev.clientY);
    if (!p) { $('#ro-pos').textContent = 'Hors zone'; $('#ro-depth').textContent = ''; $('#ro-zone').textContent = ''; return; }
    const [lon, lat] = unproj(p.x, p.z); const h = heightAt(lon, lat);
    $('#ro-pos').textContent = `${dm(lat, 'N', 'S')}  ${dm(lon, 'E', 'W')}`;
    if (h == null) return;
    const wd = state.tide - h;
    $('#ro-depth').textContent = h < 0 ? `Sonde ${fmt(-h)} m · eau ${fmt(wd)} m` : h < 5 ? (wd > 0 ? `Estran +${fmt(h)} m · eau ${fmt(wd)} m` : `Découvert (+${fmt(h)} m)`) : `Terre +${fmt(h, 0)} m`;
    const z = zonesAt(lon, lat).find((f) => f.properties.name);
    $('#ro-zone').textContent = z ? `${z.properties.name}` : '';
  });
});

const popup = $('#popup');
let popupAnchor = null;
popup.querySelector('.close').onclick = () => { popup.hidden = true; popupAnchor = null; };
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const obj = pickMark(e.clientX, e.clientY);
  if (obj && obj.userData.mark != null) return showMark(marks[obj.userData.mark]);
  if (obj && obj.userData.port) return showPort(obj.userData.port, obj);
  const p = pickTerrain(e.clientX, e.clientY);
  if (p) showPoint(p);
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const osmLink = (id) => (id ? `<a href="https://www.openstreetmap.org/${id}" target="_blank" rel="noopener">voir sur OpenStreetMap ↗</a>` : '');
function openPopup(html, anchor) { popup.querySelector('.content').innerHTML = html; popup.hidden = false; popupAnchor = anchor; }
function showMark(m) {
  const p = m.props, t = m.type;
  const rows = [];
  const cat = p[`seamark:${t}:category`]; if (cat) rows.push(['Catégorie', CAT_FR[cat] || cat]);
  const col = p[`seamark:${t}:colour`]; if (col) rows.push(['Couleurs', col.split(';').map((c) => COL_FR[c] || c).join(' / ')]);
  const sh = p[`seamark:${t}:shape`]; if (sh) rows.push(['Forme', SHAPE_FR[sh] || sh]);
  if (p['seamark:topmark:shape']) rows.push(['Voyant', TOP_FR[p['seamark:topmark:shape']] || p['seamark:topmark:shape']]);
  if (p['seamark:information']) rows.push(['Info', esc(p['seamark:information'])]);
  m.lights.forEach((l, i) => {
    rows.push([m.lights.length > 1 ? `Feu ${i + 1}` : 'Feu', `<span class="lightchar">${esc(lightText(l))}</span>`]);
    if (l.sector_start) rows.push(['Secteur', `${l.sector_start}° → ${l.sector_end}°`]);
  });
  if (m.h != null) rows.push(['Sonde', m.h < 0 ? `${fmt(-m.h)} m` : `découvre de ${fmt(m.h)} m`]);
  rows.push(['Position', `${dm(m.lat, 'N', 'S')}<br>${dm(m.lon, 'E', 'W')}`]);
  const name = p['seamark:name'] || p.name || TYPE_FR[t] || t;
  openPopup(`<div class="kind">${esc(TYPE_FR[t] || t)}</div><h3>${esc(name)}</h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>${osmLink(p.osm)}`,
    m.obj.position.clone().add(new THREE.Vector3(0, 8 * m.obj.scale.y, 0)));
}
function showPort(f, obj) {
  const p = f.properties; const KF = { marina: 'Port de plaisance', harbour: 'Port', slipway: 'Cale de mise à l’eau', lighthouse: 'Phare' };
  const rows = [];
  if (p.capacity) rows.push(['Places', p.capacity]);
  if (p.operator) rows.push(['Gestion', esc(p.operator)]);
  if (p.harbour) rows.push(['Type', esc(p.harbour)]);
  if (p['seamark:harbour:category']) rows.push(['Catégorie', esc(p['seamark:harbour:category'])]);
  if (p.website) rows.push(['Site', `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ''))}</a>`]);
  const [lo, la] = f.geometry.coordinates;
  rows.push(['Position', `${dm(la, 'N', 'S')}<br>${dm(lo, 'E', 'W')}`]);
  openPopup(`<div class="kind">${KF[p.kind] || 'Port'}</div><h3>${esc(p.name || KF[p.kind])}</h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>${osmLink(p.osm)}`,
    obj.position.clone().add(new THREE.Vector3(0, 4 * obj.scale.y, 0)));
}
function showPoint(p) {
  const [lon, lat] = unproj(p.x, p.z); const h = heightAt(lon, lat);
  const zs = zonesAt(lon, lat);
  const rows = [['Position', `${dm(lat, 'N', 'S')}<br>${dm(lon, 'E', 'W')}`]];
  if (h != null) {
    rows.push([h < 0 ? 'Sonde (ZH)' : 'Altitude / ZH', h < 0 ? `${fmt(-h)} m` : `+${fmt(h)} m`]);
    const wd = state.tide - h;
    rows.push(['Hauteur d’eau', wd > 0 ? `${fmt(wd)} m à marée ${fmt(state.tide, 2)} m` : 'à sec']);
    if (h < 5 && h >= 0) rows.push(['Couvre à', `marée > ${fmt(h, 2)} m`]);
  }
  zs.forEach((f) => rows.push([CLS_FR[f.properties.cls] || f.properties.cls, esc(f.properties.name || '—')]));
  const title = zs.find((f) => f.properties.name)?.properties.name || (h == null ? 'Point' : h < 0 ? 'Chenal / plan d’eau' : h < 5 ? 'Estran' : 'Terre');
  openPopup(`<div class="kind">Point</div><h3>${esc(title)}</h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`, p.clone());
}

// ---------------------------------------------------------------- UI
function setTide(v) {
  state.tide = v; uniforms.uTide.value = v; $('#tide').value = v; $('#tide-out').textContent = `${fmt(v, 2)} m`; placeObjects();
}
$('#tide').oninput = (e) => { stopAnim(); setTide(+e.target.value); };
document.querySelectorAll('[data-tide]').forEach((b) => (b.onclick = () => { stopAnim(); setTide(+b.dataset.tide); }));
$('#exag').oninput = (e) => { state.exag = +e.target.value; uniforms.uExag.value = state.exag; $('#exag-out').textContent = `×${state.exag}`; placeObjects(); };
let anim = null;
function stopAnim() { if (anim) { anim = null; $('#tide-anim').textContent = '▶ Animer un cycle de marée'; $('#tide-phase').innerHTML = '&nbsp;'; } }
$('#tide-anim').onclick = () => {
  if (anim) return stopAnim();
  anim = { t0: performance.now() }; $('#tide-anim').textContent = '■ Arrêter';
};
const TIDE_T = 12.42, SEC_PER_H = 2.2; // 1 h de marée = 2,2 s
function stepAnim(now) {
  if (!anim) return;
  const hrs = ((now - anim.t0) / 1000 / SEC_PER_H) % TIDE_T; // 0 = pleine mer
  const v = 2.42 + 1.88 * Math.cos((2 * Math.PI * hrs) / TIDE_T);
  setTide(Math.round(v * 100) / 100);
  const fromPM = hrs <= TIDE_T / 2 ? hrs : hrs - TIDE_T;
  const h = Math.floor(Math.abs(fromPM)), m = Math.floor((Math.abs(fromPM) - h) * 60);
  $('#tide-phase').textContent = `Marée de vives-eaux type · PM ${fromPM >= 0 ? '+' : '−'} ${h} h ${String(m).padStart(2, '0')} · ${hrs < TIDE_T / 2 ? 'jusant ↓' : 'flot ↑'}`;
}
$('#l-iso').onchange = (e) => (uniforms.uIso.value = e.target.checked ? 1 : 0);
$('#l-night').onchange = (e) => {
  state.night = e.target.checked; uniforms.uNight.value = state.night ? 1 : 0;
  scene.background.copy(state.night ? SKY_NIGHT : SKY_DAY);
  hemi.intensity = state.night ? 0.15 : 0.9; sun.intensity = state.night ? 0.12 : 1.6;
  oceanMat.color.set(state.night ? 0x040c18 : 0x0f3150); landMat.color.set(state.night ? 0x1a1f26 : 0xa9ad9f);
};
document.querySelectorAll('#basemap button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('#basemap button').forEach((x) => x.classList.toggle('on', x === b));
  state.ortho = b.dataset.v === 'ortho'; uniforms.uOrthoOn.value = state.ortho ? 1 : 0; if (state.ortho) loadOrtho();
}));
const layerIds = { crassat: 'l-crassat', sable: 'l-sable', presale: 'l-presale', marais: 'l-marais', names: 'l-names', communes: 'l-communes', ports: 'l-ports', nav: 'l-nav', navlines: 'l-navlines', navnames: 'l-navnames' };
for (const [k, id] of Object.entries(layerIds)) $('#' + id).onchange = (e) => {
  state.layers[k] = e.target.checked;
  navGroup.visible = state.layers.nav; portGroup.visible = state.layers.ports;
  if (['crassat', 'sable', 'presale', 'marais', 'navlines'].includes(k)) drawOverlay();
};
$('#toggle-panel').onclick = () => { const p = $('#panel'); p.classList.toggle('collapsed'); $('#toggle-panel').textContent = p.classList.contains('collapsed') ? '+' : '–'; };
$('#compass').onclick = () => {
  const off = camera.position.clone().sub(controls.target); const r = Math.hypot(off.x, off.z);
  camera.position.set(controls.target.x, camera.position.y, controls.target.z + r); controls.update();
};
if (innerWidth < 720) { $('#panel').classList.add('collapsed'); $('#toggle-panel').textContent = '+'; }

// ---------------------------------------------------------------- rendu des étiquettes
const tmpV = new THREE.Vector3();
const LAYER_GATE = { crassat: () => state.layers.crassat && state.layers.names, sable: () => state.layers.sable && state.layers.names,
  presale: () => state.layers.presale && state.layers.names, marais: () => state.layers.marais && state.layers.names, names: () => state.layers.names,
  communes: () => state.layers.communes, ports: () => state.layers.ports, navnames: () => state.layers.nav && state.layers.navnames };
function updateLabels() {
  const camDist = camera.position.distanceTo(controls.target);
  const cand = [];
  for (const L of labels) {
    let show = LAYER_GATE[L.layer]?.() ?? true;
    if (show) {
      const [x, z] = proj(L.lon, L.lat); const h = heightAt(L.lon, L.lat) ?? 0;
      tmpV.set(x, yOf(Math.max(h, state.tide)) + (L.layer === 'communes' ? 20 : L.layer === 'navnames' ? 14 : 4), z);
      const dist = tmpV.distanceTo(camera.position);
      if (dist > L.maxDist * 1.6 || camDist > L.maxDist) show = false;
      else {
        tmpV.project(camera);
        if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) show = false;
        else { L.sx = (tmpV.x * 0.5 + 0.5) * innerWidth; L.sy = (-tmpV.y * 0.5 + 0.5) * innerHeight; }
      }
    }
    if (show) cand.push(L); else if (L.vis) { L.el.style.display = 'none'; L.vis = false; }
  }
  cand.sort((a, b) => b.pri - a.pri);
  const placed = [];
  for (const L of cand) {
    if (!L.vis) { L.el.style.display = 'block'; L.vis = true; }
    if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const x = L.sx - L.w / 2, y = L.sy - L.h / 2;
    const r = [x - 3, y - 2, x + L.w + 3, y + L.h + 2];
    if (placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) { L.el.style.display = 'none'; L.vis = false; continue; }
    placed.push(r);
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

// ---------------------------------------------------------------- boucle
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const clock = new THREE.Clock();
const compassSvg = $('#compass svg');
function frame(now) {
  stepAnim(now);
  controls.update();
  // contraintes de navigation
  const t = controls.target; const lim = 0.62;
  t.x = THREE.MathUtils.clamp(t.x, -WU * lim, WU * lim); t.z = THREE.MathUtils.clamp(t.z, -HU * lim, HU * lim);
  if (camera.position.y < yOf(Math.max(state.tide, 0)) + 15) camera.position.y = yOf(Math.max(state.tide, 0)) + 15;
  const el = clock.getElapsedTime();
  const camD = camera.position.distanceTo(controls.target);
  const sc = THREE.MathUtils.clamp(camD / 380, 0.6, 10);
  for (const m of marks) {
    m.obj.scale.setScalar(sc);
    for (const s of m.sprites) {
      const on = s.fn(el);
      s.sprite.material.opacity = on * (state.night ? 1 : 0.75);
      s.sprite.scale.setScalar(s.base * (state.night ? 1.6 : 1));
    }
  }
  for (const p of portPins) p.obj.scale.setScalar(sc * 0.9);
  const az = Math.atan2(camera.position.x - t.x, camera.position.z - t.z);
  compassSvg.style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
  if (popupAnchor && !popup.hidden) {
    tmpV.copy(popupAnchor).project(camera);
    if (tmpV.z > 1) popup.style.visibility = 'hidden';
    else { popup.style.visibility = ''; popup.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`; popup.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`; }
  }
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

drawOverlay();
setTide(state.tide);
placeObjects();
requestAnimationFrame(frame);
$('#loading').classList.add('done');
window.__bassin = { state, marks, labels, camera, controls, setTide };
