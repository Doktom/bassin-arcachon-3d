// Environnement terrestre low-poly : relief à facettes, pins maritimes, Dune du Pilat, cabanes, nuages.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/**
 * Relief terrestre « low-poly » : les sommets de terre (> 5,5 m) sont ramenés sur une triangulation grossière
 * et légèrement irrégulière (pas K). L'eau et l'estran gardent la bathymétrie d'origine, intacte.
 */
export function lowPolyLand(H0, GW, GH, K = 5, skip = () => false) {
  const out = Float32Array.from(H0);
  const rnd = mulberry32(1872);
  const CWn = Math.ceil((GW - 1) / K) + 1, CHn = Math.ceil((GH - 1) / K) + 1;
  const cx = new Float32Array(CWn * CHn), cy = new Float32Array(CWn * CHn), ch = new Float32Array(CWn * CHn);
  const samp = (x, y) => {
    x = Math.min(Math.max(x, 0), GW - 1); y = Math.min(Math.max(y, 0), GH - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, GW - 1), y1 = Math.min(y0 + 1, GH - 1), tx = x - x0, ty = y - y0;
    return (H0[y0 * GW + x0] * (1 - tx) + H0[y0 * GW + x1] * tx) * (1 - ty) + (H0[y1 * GW + x0] * (1 - tx) + H0[y1 * GW + x1] * tx) * ty;
  };
  for (let cj = 0; cj < CHn; cj++) for (let ci = 0; ci < CWn; ci++) {
    const k = cj * CWn + ci;
    const jx = ci === 0 || ci === CWn - 1 ? 0 : (rnd() - 0.5) * 0.7 * K;
    const jy = cj === 0 || cj === CHn - 1 ? 0 : (rnd() - 0.5) * 0.7 * K;
    cx[k] = Math.min(ci * K + jx, GW - 1); cy[k] = Math.min(cj * K + jy, GH - 1); ch[k] = samp(cx[k], cy[k]);
  }
  const tri = (px, py, a, b, c) => {
    const x1 = cx[a], y1 = cy[a], x2 = cx[b], y2 = cy[b], x3 = cx[c], y3 = cy[c];
    const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3); if (Math.abs(d) < 1e-9) return null;
    const l1 = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / d, l2 = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / d, l3 = 1 - l1 - l2;
    return l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6 ? l1 * ch[a] + l2 * ch[b] + l3 * ch[c] : null;
  };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i, h0 = H0[k];
    if (h0 < 5.5 || skip(i, j)) continue;
    const s = smooth(5.5, 9, h0), ci0 = Math.floor(i / K), cj0 = Math.floor(j / K);
    let hc = null;
    for (let dj = -1; dj <= 1 && hc == null; dj++) for (let di = -1; di <= 1 && hc == null; di++) {
      const ci = ci0 + di, cj = cj0 + dj; if (ci < 0 || cj < 0 || ci >= CWn - 1 || cj >= CHn - 1) continue;
      const a = cj * CWn + ci, b = a + 1, c = a + CWn, d = c + 1;
      hc = (ci + cj) & 1 ? tri(i, j, a, b, d) ?? tri(i, j, a, d, c) : tri(i, j, a, b, c) ?? tri(i, j, b, d, c);
    }
    if (hc != null) out[k] = h0 + (Math.max(hc, 6) - h0) * s;
  }
  return out;
}

/** Gradient (dh/dx, dh/dz en m/m) d'une grille régulière. */
export function gradients(Hs, w, h, dxm, dzm) {
  const g = new Float32Array(w * h * 2);
  const H = (i, j) => Hs[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    g[k * 2] = (H(i + 1, j) - H(i - 1, j)) / (2 * dxm); g[k * 2 + 1] = (H(i, j + 1) - H(i, j - 1)) / (2 * dzm);
  }
  return g;
}

/** Maillage indexé d'une grille w×h. */
export function gridGeometry(w, h, posFn, Hs, uvFn, dxm, dzm) {
  const n = w * h, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, [x, z] = posFn(i, j), [u, v] = uvFn(i, j);
    pos[k * 3] = x; pos[k * 3 + 2] = z; uv[k * 2] = u; uv[k * 2 + 1] = v;
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  for (let j = 0, p = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    else { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('h', new THREE.BufferAttribute(Hs, 1));
  g.setAttribute('grad', new THREE.BufferAttribute(gradients(Hs, w, h, dxm, dzm), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ------------------------------------------------------------------ pin maritime low-poly
function colored(geo, hex) {
  const g = geo.toNonIndexed(); const c = new THREE.Color(hex); const n = g.attributes.position.count;
  const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g;
}
export function pineGeometry() {
  // Pin maritime des Landes : fût haut et nu, houppier irrégulier en parasol.
  const trunk = new THREE.CylinderGeometry(0.16, 0.27, 4.2, 5, 1, true); trunk.translate(0, 2.1, 0);
  const crown = new THREE.IcosahedronGeometry(1.55, 0); crown.scale(1.3, 0.62, 1.15); crown.translate(0, 4.75, 0);
  const crown2 = new THREE.IcosahedronGeometry(1.0, 0); crown2.scale(1.2, 0.6, 1.1); crown2.translate(0.55, 5.35, -0.3);
  return mergeGeometries([colored(trunk, 0x7a5236), colored(crown, 0x3f6e38), colored(crown2, 0x4c7d40)]);
}

/** Place les pins sur les cellules boisées (masque OSM) de la grille. */
export function buildForest({ coverAt, heightAt, cellLonLat, cols, rows, density, rng }) {
  const pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const [lon, lat] = cellLonLat(i + rng() * 0.9, j + rng() * 0.9);
    const c = coverAt(lon, lat); if (!c) continue;
    const p = c.forest * density + c.open * density * 0.06;
    if (c.urban > 0.4 || c.sand > 0.4 || rng() > p) continue;
    const h = heightAt(lon, lat); if (h == null || h < 6.5) continue;
    pts.push({ lon, lat, h, s: 1.25 + rng() * 0.85, r: rng() * Math.PI * 2, t: rng() });
  }
  return pts;
}

// ------------------------------------------------------------------ cabanes
const M = (hex, o = {}) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...o });
const WOOD = M(0x8a5a35), WOOD_D = M(0x5e3b22), ROOF = M(0x6b4a33), PILE = M(0x4a3626), WHITE = M(0xf1ece2), RED = M(0xb8322c), TILE = M(0xb0603e);
function prismRoof(w, d, h, mat) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  return new THREE.Mesh(g, mat);
}
/** Cabane tchanquée : maison de bois sur pilotis, volets colorés. Échelle stylisée. */
export function stiltHut(shutter = 'red') {
  const g = new THREE.Group();
  const pile = new THREE.CylinderGeometry(0.09, 0.11, 1, 5);
  for (const [x, z] of [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8], [0, -0.8], [0, 0.8]]) {
    const p = new THREE.Mesh(pile, PILE); p.position.set(x, 0, z); p.userData.pile = true; g.add(p);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 2.3), WOOD_D); deck.userData.deck = true; g.add(deck);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.25, 1.65), WOOD); box.userData.body = 0.7; g.add(box);
  const roof = prismRoof(2.6, 1.95, 0.85, ROOF); roof.userData.body = 1.33; g.add(roof);
  const sh = shutter === 'red' ? RED : WHITE;
  for (const x of [-0.55, 0.55]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.05), sh); s.position.set(x, 0, 0.84); s.userData.body = 0.75; g.add(s); }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.05), sh); door.position.set(0, 0, -0.84); door.userData.body = 0.55; g.add(door);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1, 0.06), WOOD_D); ladder.position.set(1.3, 0, 1.2); ladder.rotation.x = -0.35; ladder.userData.pile = true; g.add(ladder);
  return g;
}
/** Cabane ostréicole de l'Île aux Oiseaux (au sol). */
export function groundHut(rng) {
  const g = new THREE.Group();
  const w = 1.6 + rng() * 0.8, d = 1.1 + rng() * 0.4;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), rng() > 0.5 ? WOOD : WOOD_D); box.position.y = 0.45; g.add(box);
  const roof = prismRoof(w + 0.3, d + 0.25, 0.55, rng() > 0.6 ? TILE : ROOF); roof.position.y = 0.9; roof.rotation.y = Math.PI / 2 * (rng() > 0.5 ? 1 : 0);
  if (roof.rotation.y) roof.scale.set((d + 0.3) / (w + 0.3), 1, (w + 0.25) / (d + 0.25));
  g.add(roof); return g;
}
/** Place les étages d'une cabane tchanquée selon le sol et le niveau de plancher (unités scène). */
export function layoutStilt(g, yGround, yFloor, s) {
  g.position.y = yGround; g.scale.setScalar(s);
  const hp = Math.max((yFloor - yGround) / s, 0.4); // hauteur des pilotis en unités locales
  g.children.forEach((m) => {
    if (m.userData.pile) { m.scale.y = hp; m.position.y = hp / 2; }
    else if (m.userData.deck) m.position.y = hp;
    else if (m.userData.body != null) m.position.y = hp + m.userData.body;
  });
}

// ------------------------------------------------------------------ nuages low-poly
export function buildClouds(rng, span) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.94, emissive: 0x8aa0b4, emissiveIntensity: 0.25 });
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const clouds = [];
  for (let c = 0; c < 9; c++) {
    const cg = new THREE.Group();
    const n = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat); const r = 26 + rng() * 40;
      m.scale.set(r * 1.4, r * 0.8, r); m.position.set((i - n / 2) * 42 + rng() * 25, rng() * 18, (rng() - 0.5) * 50); m.rotation.set(rng(), rng(), rng()); cg.add(m);
    }
    const side = rng() > 0.5 ? 1 : -1;
    cg.position.set((rng() - 0.5) * span.x * 1.8, 520 + rng() * 260, side * (span.z * 0.35 + rng() * span.z * 0.5) * (rng() > 0.5 ? 1 : 0.3));
    group.add(cg); clouds.push({ g: cg, v: 4 + rng() * 6 });
  }
  return { group, clouds, mat };
}
