// BUILDINGS. The town's kinds, each with a few varieties, each a flat-roofed box whose roof carries
// the project's picture, dressed for what it is:
//   office      glass   - a glass tower: curtain-wall bays, a dark rim, a lobby canopy
//               banded  - a podium with the tower set back on it: concrete bands and ribbon windows
//               stone   - a stone mid-rise: punched windows, a cornice, a colonnaded entrance
//   apartments  stucco  - four to seven storeys: a window and a balcony door per bay, glass balconies
//               modern  - white panels and timber strips, tall windows, balconies in coloured glass
//   house       clapboard - one or two storeys of siding, a porch, a hedged lawn, bushes, a tree
//               modern    - a white box with big glass, a timber fence, a pool to one side
//               brick     - a brick bungalow with a garage and a driveway
// Built with the front at +z; the town turns each one round so the front faces the way the
// fighter comes in. Walls are drawn per bay on a canvas and repeated by the metre, so windows keep
// their size on any footprint. Extras are merged into a few meshes per building for the draw count.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const FLOOR = 3.2;       // metres a storey
const BAY = 3.4;         // metres a window bay
export const VARIANTS = { office: ['glass', 'banded', 'stone'], apartments: ['stucco', 'modern'], house: ['clapboard', 'modern', 'brick'] };

// ── wall bays, drawn once per kind and colour and repeated ─────────────────────
const bayCache = new Map();
function glassPane(g, x, y, w, h, frame = '#f2efe8', f = 4) {
  g.fillStyle = frame; g.fillRect(x - f, y - f, w + f * 2, h + f * 2);
  const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#3f5a72'); gr.addColorStop(0.6, '#24384c'); gr.addColorStop(1, '#4a6680');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(x, y + h * 0.7); g.lineTo(x + w * 0.45, y); g.lineTo(x + w * 0.7, y); g.lineTo(x, y + h); g.fill();
}
function bricks(g, W, H, base, mortar) {
  g.fillStyle = mortar; g.fillRect(0, 0, W, H);
  const bh = 8, bw = 22;
  for (let row = 0, y = 0; y < H; row++, y += bh) for (let x = -(row % 2) * bw / 2; x < W; x += bw) {
    const k = 0.88 + ((x * 7 + y * 13) % 17) / 17 * 0.24;
    const c = new THREE.Color(base).multiplyScalar(k);
    g.fillStyle = `#${c.getHexString()}`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
  }
}
function bayTexture(kind, tone) {
  const key = kind + tone;
  if (bayCache.has(key)) return bayCache.get(key);
  const wide = kind === 'apartments/stucco' || kind === 'apartments/modern';
  const W = 128, H = 120, cv = document.createElement('canvas'); cv.width = W * (wide ? 2 : 1); cv.height = H; const g = cv.getContext('2d');
  switch (kind) {
    case 'office/glass': {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3b5670'); gr.addColorStop(0.55, '#22364a'); gr.addColorStop(1, '#4b6a86');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#9aa6b0'; g.fillRect(0, H - 16, W, 16);
      g.fillStyle = '#c9d0d6'; g.fillRect(0, 0, 4, H); g.fillRect(W / 2 - 2, 0, 3, H - 16);
      break; }
    case 'office/banded': {
      g.fillStyle = tone; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 50, W, 3);
      const gr = g.createLinearGradient(0, 56, 0, H); gr.addColorStop(0, '#2a3f54'); gr.addColorStop(1, '#43607a');
      g.fillStyle = gr; g.fillRect(0, 56, W, H - 60);
      g.fillStyle = '#b8c0c6'; g.fillRect(0, 56, 2, H - 60); g.fillRect(W / 2, 56, 2, H - 60);
      break; }
    case 'office/stone': {
      g.fillStyle = tone; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 0; y < H; y += 20) g.fillRect(0, y, W, 1);
      glassPane(g, 36, 20, 56, 76, '#6b6358', 5);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(30, 100, 68, 5);
      break; }
    case 'apartments/stucco': {
      g.fillStyle = tone; g.fillRect(0, 0, W * 2, H);
      glassPane(g, 34, 30, 60, 52); g.fillStyle = '#f2efe8'; g.fillRect(62, 30, 4, 52);
      g.fillStyle = '#d8d2c4'; g.fillRect(28, 88, 72, 6);
      glassPane(g, W + 36, 18, 56, H - 22); g.fillStyle = '#f2efe8'; g.fillRect(W + 62, 18, 4, H - 22);
      break; }
    case 'apartments/modern': {
      g.fillStyle = '#f1f0ec'; g.fillRect(0, 0, W * 2, H);
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(W - 1, 0, 2, H); g.fillRect(0, H - 2, W * 2, 2);
      // a timber strip beside a tall window, and a floor-to-ceiling balcony door
      g.fillStyle = tone; g.fillRect(8, 6, 22, H - 12);
      g.fillStyle = 'rgba(0,0,0,0.15)'; for (let x = 12; x < 30; x += 5) g.fillRect(x, 6, 1, H - 12);
      glassPane(g, 44, 14, 70, H - 26, '#3a3a3a', 3);
      glassPane(g, W + 18, 6, W - 36, H - 10, '#3a3a3a', 3);
      break; }
    case 'house/clapboard': {
      g.fillStyle = tone; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 6; y < H; y += 9) g.fillRect(0, y, W, 2);
      glassPane(g, 36, 32, 56, 50, '#f7f5ef', 6);
      g.fillStyle = '#f7f5ef'; g.fillRect(62, 32, 4, 50); g.fillRect(36, 55, 56, 4);
      // shutters
      g.fillStyle = 'rgba(40,60,50,0.85)'; g.fillRect(18, 28, 12, 58); g.fillRect(98, 28, 12, 58);
      break; }
    case 'house/modern': {
      g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, W, H);
      glassPane(g, 10, 12, W - 20, H - 18, '#2e2e2e', 3);
      g.fillStyle = '#2e2e2e'; g.fillRect(W / 2 - 1, 12, 3, H - 18);
      break; }
    case 'house/brick': {
      bricks(g, W, H, tone, '#cfc6b8');
      g.fillStyle = '#e9e4da'; g.fillRect(28, 26, 72, 6);
      glassPane(g, 36, 34, 56, 46, '#f5f2ea', 5);
      g.fillStyle = '#f5f2ea'; g.fillRect(62, 34, 4, 46);
      g.fillStyle = '#d8d1c3'; g.fillRect(30, 84, 68, 6);
      break; }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  bayCache.set(key, t); return t;
}
function wallMat(kind, tone, across, floors, { gloss = false } = {}) {
  const t = bayTexture(kind, tone).clone(); t.needsUpdate = true;
  const wide = kind.startsWith('apartments');
  t.repeat.set(Math.max(1, Math.round(across / (wide ? BAY * 2 : BAY))), floors);
  return new THREE.MeshStandardMaterial({ map: t, roughness: gloss ? 0.35 : 0.85, metalness: gloss ? 0.3 : 0 });
}
function plainTex(draw, w = 256, h = 128) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

const MATS = {};
function mat(name, make) { return MATS[name] || (MATS[name] = make()); }
const M = {
  trim: () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 })),
  white: () => mat('white', () => new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.8 })),
  stone: () => mat('stoneTrim', () => new THREE.MeshStandardMaterial({ color: 0xd6cdbb, roughness: 0.9 })),
  hedge: () => mat('hedge', () => new THREE.MeshStandardMaterial({ color: 0x2f5a26, roughness: 0.95 })),
  bush: () => mat('bush', () => new THREE.MeshStandardMaterial({ color: 0x3d6e2e, roughness: 0.95, flatShading: true })),
  leaf: () => mat('leaf', () => new THREE.MeshStandardMaterial({ color: 0x4f7f34, roughness: 0.95, flatShading: true })),
  bark: () => mat('bark', () => new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 })),
  wood: () => mat('wood', () => new THREE.MeshStandardMaterial({ color: 0x9a6a42, roughness: 0.8 })),
  path: () => mat('path', () => new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.9 })),
  drive: () => mat('drive', () => new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.95 })),
  gravel: () => mat('gravel', () => new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 1 })),
  rail: () => mat('rail', () => new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.4, metalness: 0.5 })),
  glassRail: (c = 0xbfd8e6, o = 0.35) => mat('rg' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: o, depthWrite: false })),
  water: () => mat('water', () => new THREE.MeshStandardMaterial({ color: 0x3fa7d6, roughness: 0.08, metalness: 0.2 })),
  lawn: () => mat('lawn', () => { const t = new THREE.TextureLoader().load('/textures/ground/grassMed.jpg'); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); }),
  door: (i) => mat('door' + i, () => new THREE.MeshStandardMaterial({ color: [0x7a2a22, 0x2a3a5a, 0x3a2a1e, 0x2f4a3a][i], roughness: 0.5 })),
  garage: () => mat('garage', () => new THREE.MeshStandardMaterial({ roughness: 0.7, map: plainTex((g, w, h) => { g.fillStyle = '#ebe7df'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.13)'; for (let y = 14; y < h; y += 22) g.fillRect(0, y, w, 3); }) })),
};

// `w`, `d` the lot in metres, the building centred on the group's origin; returns { group, body }.
// `body` is the pickable box, the one whose top face is the roof.
export function makeBuilding({ style, variant, w, d, roofMat, seed = 1 }) {
  const r = rnd(seed * 97 + 13), group = new THREE.Group();
  const list = VARIANTS[style] || VARIANTS.office;
  const v = list.includes(variant) ? variant : list[Math.floor(r() * list.length)];
  const kind = style + '/' + v;
  const add = (geos, m, shadow = true) => { if (!geos.length) return null; const mm = new THREE.Mesh(mergeGeometries(geos), m); mm.castShadow = shadow; mm.receiveShadow = true; group.add(mm); return mm; };
  const flat = (pw, pd, x, z, m, y = 0.08) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; group.add(p); return p; };
  const under = mat('under', () => new THREE.MeshStandardMaterial({ color: 0x333333 }));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const makeBody = (bw, h, bd, x, y, z, side, front, roof = roofMat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), [side, side, roof, under, front, front]);
    b.position.set(x, y + h / 2, z); b.castShadow = b.receiveShadow = true; group.add(b); return b;
  };
  let body, h;

  // ── OFFICES ────────────────────────────────────────────────────────────────
  if (style === 'office') {
    const floors = Math.max(5, Math.round((18 + r() * 24) / FLOOR));
    if (v === 'glass') {
      h = floors * FLOOR;
      body = makeBody(w, h, d, 0, 0, 0, wallMat(kind, '', d, floors, { gloss: true }), wallMat(kind, '', w, floors, { gloss: true }));
      add([box(w + 1.6, 1.2, d + 1.6, 0, h - 0.75, 0)], M.trim());
      add([box(Math.min(12, w * 0.4), 0.3, 3, 0, 4.2, d / 2 + 1.5)], M.trim());
      add([box(0.3, 4.1, 0.3, -Math.min(12, w * 0.4) / 2 + 0.3, 2.05, d / 2 + 2.8), box(0.3, 4.1, 0.3, Math.min(12, w * 0.4) / 2 - 0.3, 2.05, d / 2 + 2.8)], M.trim());
      add([box(Math.min(8, w * 0.3), 3.4, 0.15, 0, 1.7, d / 2 + 0.05)], M.glassRail(0x1c2a36, 0.9));   // the lobby's glass doors
    } else if (v === 'banded') {
      // a two-storey podium over the whole lot, the tower set back on it; the podium's roof is gravel
      const tone = pick(['#d9d6cf', '#cfd3d6', '#e0d9cc']);
      const pf = 2, ph = pf * FLOOR, tw = w * 0.84, td = d * 0.84, tf = floors - pf;
      h = ph + tf * FLOOR;
      makeBody(w, ph, d, 0, 0, 0, wallMat(kind, tone, d, pf, { gloss: true }), wallMat(kind, tone, w, pf, { gloss: true }), M.gravel());
      body = makeBody(tw, tf * FLOOR, td, 0, ph, -d * 0.04, wallMat(kind, tone, td, tf, { gloss: true }), wallMat(kind, tone, tw, tf, { gloss: true }));
      add([box(tw + 0.8, 0.8, td + 0.8, 0, h - 0.55, -d * 0.04), box(w + 0.6, 0.6, d + 0.6, 0, ph - 0.4, 0)], M.white());
      // planters along the podium's edge, and the entrance canopy
      add([box(w * 0.7, 0.7, 1.2, 0, ph + 0.35, d / 2 - 1)], M.hedge());
      add([box(w * 0.35, 0.35, 3.2, 0, 3.4, d / 2 + 1.6)], M.white());
      add([box(w * 0.25, 3.0, 0.15, 0, 1.5, d / 2 + 0.05)], M.glassRail(0x1c2a36, 0.9));
    } else {
      // stone: a cornice, a plinth, columns at the entrance
      const tone = pick(['#cbbf9f', '#bfb6a6', '#d4c8ae', '#b9ab93']);
      const sf = Math.min(floors, 7); h = sf * FLOOR + 1.2;
      body = makeBody(w, h, d, 0, 0, 0, wallMat(kind, tone, d, sf), wallMat(kind, tone, w, sf));
      add([box(w + 1.4, 0.9, d + 1.4, 0, h - 0.45, 0), box(w + 0.6, 1.1, d + 0.6, 0, 0.55, 0)], M.stone());
      const cols = [], cw = Math.min(14, w * 0.45);
      for (let i = 0; i < 5; i++) cols.push(new THREE.CylinderGeometry(0.35, 0.4, 5.5, 10).translate(-cw / 2 + i * cw / 4, 2.75, d / 2 + 2.4));
      cols.push(box(cw + 1.4, 0.8, 3.4, 0, 5.9, d / 2 + 1.7), box(cw + 2, 0.4, 3.8, 0, 0.2, d / 2 + 1.9));
      add(cols, M.stone());
      add([box(cw * 0.5, 4.2, 0.15, 0, 2.3, d / 2 + 0.05)], M.door(2));                 // the doors behind the columns
    }
  }

  // ── APARTMENTS ─────────────────────────────────────────────────────────────
  if (style === 'apartments') {
    const floors = 4 + Math.floor(r() * 4); h = floors * FLOOR + 0.8;
    const tone = v === 'stucco' ? pick(['#e3d6bf', '#d9c3a5', '#e8e2d4', '#cdb79a', '#d7cfc4', '#e6c9b4']) : pick(['#a2754a', '#b58457', '#8c6440']);
    body = makeBody(w, h, d, 0, 0, 0, wallMat(kind, tone, d, floors), wallMat(kind, tone, w, floors));
    add([box(w + 0.8, 0.9, d + 0.8, 0, h - 0.55, 0)], v === 'stucco' ? M.white() : M.trim());
    // balconies on every floor above the ground, on the balcony-door bays, front and back
    const slabs = [], rails = [], glassBy = new Map(), nBays = Math.max(1, Math.round(w / (BAY * 2))), pitch = w / nBays;
    const glassCols = v === 'modern' ? [0xf0a24a, 0x49b3a8, 0xe8d24a, 0xe0664f] : [0xbfd8e6];
    for (let f = 1; f < floors; f++) for (let b = 0; b < nBays; b++) for (const s of [1, -1]) {
      const x = -w / 2 + pitch * (b + 0.75), y = f * FLOOR + 0.1, z = s * (d / 2 + 0.65), bwid = pitch * 0.44;
      slabs.push(box(bwid, 0.18, 1.3, x, y, z));
      const gc = glassCols[(f * 7 + b * 3 + (s > 0 ? 0 : 1)) % glassCols.length];
      if (!glassBy.has(gc)) glassBy.set(gc, []);
      glassBy.get(gc).push(box(bwid, 0.9, 0.04, x, y + 0.55, s * (d / 2 + 1.28)), box(0.04, 0.9, 1.3, x - bwid / 2, y + 0.55, z), box(0.04, 0.9, 1.3, x + bwid / 2, y + 0.55, z));
      rails.push(box(bwid + 0.08, 0.07, 0.08, x, y + 1.02, s * (d / 2 + 1.28)));
    }
    add(slabs, v === 'modern' ? M.trim() : M.white());
    add(rails, M.rail());
    for (const [c, geos] of glassBy) { const gm = new THREE.Mesh(mergeGeometries(geos), M.glassRail(c, v === 'modern' ? 0.7 : 0.35)); group.add(gm); }
    // the entrance, a canopy, planters and a couple of street trees
    add([box(3.2, 2.6, 0.2, 0, 1.3, d / 2 + 0.05)], M.door(2));
    add([box(5, 0.25, 2.4, 0, 3.0, d / 2 + 1.2)], M.trim());
    add([box(w * 0.3, 0.8, 1.2, -w * 0.3, 0.4, d / 2 + 1.5), box(w * 0.3, 0.8, 1.2, w * 0.3, 0.4, d / 2 + 1.5)], M.hedge());
    trees(group, [[-w / 2 + 3, d / 2 + 4], [w / 2 - 3, d / 2 + 4]], r);
  }

  // ── HOUSES ─────────────────────────────────────────────────────────────────
  if (style === 'house') {
    flat(w, d, 0, 0, M.lawn(), 0.07);
    const doorCol = Math.floor(r() * 4);
    if (v === 'clapboard') {
      const floors = r() < 0.5 ? 1 : 2, bw = w * 0.62, bd = d * 0.58, zOff = -d * 0.08; h = floors * FLOOR + 0.6;
      const tone = pick(['#b9c9d6', '#e6dcc6', '#c9d6b8', '#e4c7b0', '#d8d8d2', '#f0e6c8']);
      body = makeBody(bw, h, bd, 0, 0, zOff, wallMat(kind, tone, bd, floors), wallMat(kind, tone, bw, floors));
      add([box(bw + 0.6, 0.35, bd + 0.6, 0, h - 0.3, zOff)], M.white());
      const doorX = (r() - 0.5) * bw * 0.3, front = zOff + bd / 2;
      add([box(1.2, 2.2, 0.15, doorX, 1.1, front + 0.05)], M.door(doorCol));
      // a porch: floor, two posts and a roof
      add([box(3.4, 0.3, 2.2, doorX, 0.15, front + 1.1), box(3.8, 0.2, 2.6, doorX, 2.9, front + 1.2), box(0.18, 2.7, 0.18, doorX - 1.6, 1.5, front + 2.2), box(0.18, 2.7, 0.18, doorX + 1.6, 1.5, front + 2.2)], M.white());
      hedgeRing(add, w, d, doorX);
      flat(1.6, d / 2 - front - 2.2, doorX, (front + 2.2 + d / 2) / 2, M.path(), 0.09);
      bushesAlong(add, r, bw, doorX, front, zOff);
      trees(group, [[w / 2 - 3.2, -d / 2 + 3.2]], r);
    } else if (v === 'modern') {
      // the house to one side, a pool on the other, a timber fence round the lot
      const bw = w * 0.56, bd = d * 0.6, xOff = -w * 0.16, zOff = -d * 0.06, floors = r() < 0.6 ? 2 : 1; h = floors * FLOOR + 0.4;
      body = makeBody(bw, h, bd, xOff, 0, zOff, wallMat(kind, '', bd, floors), wallMat(kind, '', bw, floors));
      add([box(bw + 1.2, 0.3, bd + 1.2, xOff, h - 0.2, zOff)], M.trim());
      if (floors === 2) add([box(bw * 0.45, 0.25, 2.4, xOff - bw * 0.2, FLOOR, zOff + bd / 2 + 1.2)], M.trim());   // a cantilevered slab over the terrace
      const doorX = xOff + bw * 0.25, front = zOff + bd / 2;
      add([box(1.4, 2.4, 0.15, doorX, 1.2, front + 0.05)], M.door(3));
      // the terrace and the pool, with its coping
      const px = w / 2 - (w - bw) / 2 + xOff * 0 - w * 0.12, pw = Math.max(3, w * 0.2), pd = Math.max(5, d * 0.34);
      flat(pw + 1.4, pd + 1.4, px, zOff, M.white(), 0.1);
      flat(pw, pd, px, zOff, M.water(), 0.13);
      flat(bw, 3, xOff, front + 1.5, M.wood(), 0.1);
      fenceRing(add, w, d, doorX);
      flat(1.6, d / 2 - front - 3, doorX, (front + 3 + d / 2) / 2, M.path(), 0.09);
      const bs = []; for (let i = 0; i < 4; i++) { const s = 0.6 + r() * 0.5; bs.push(new THREE.IcosahedronGeometry(s, 0).scale(1, 1.3, 1).translate(xOff - bw / 2 + 1 + i * 1.8, s, front + 3.5)); }
      add(bs, M.bush());
    } else {
      // brick bungalow, a garage on one side with a driveway to the lot edge
      const bw = w * 0.5, bd = d * 0.56, xOff = -w * 0.1, zOff = -d * 0.06; h = FLOOR + 0.7;
      const tone = pick(['#9a4a36', '#a85c40', '#8a4432', '#b0694c']);
      body = makeBody(bw, h, bd, xOff, 0, zOff, wallMat(kind, tone, bd, 1), wallMat(kind, tone, bw, 1));
      add([box(bw + 0.8, 0.4, bd + 0.8, xOff, h - 0.25, zOff)], M.white());
      const gw = Math.min(7, w * 0.26), gx = xOff + bw / 2 + gw / 2, gd = bd * 0.8, front = zOff + bd / 2;
      const brickM = new THREE.MeshStandardMaterial({ map: bayTexture(kind, tone).clone(), roughness: 0.9 }); brickM.map.needsUpdate = true;
      add([box(gw, 3, gd, gx, 1.5, zOff + (bd - gd) / 2)], brickM);
      add([box(gw + 0.4, 0.3, gd + 0.4, gx, 3.1, zOff + (bd - gd) / 2)], M.white());
      add([box(gw * 0.8, 2.3, 0.12, gx, 1.15, front + 0.05)], M.garage());
      flat(gw * 0.9, d / 2 - front, gx, (front + d / 2) / 2, M.drive(), 0.09);
      const doorX = xOff - bw * 0.15;
      add([box(1.1, 2.1, 0.15, doorX, 1.05, front + 0.05)], M.door(doorCol));
      add([box(2, 0.25, 1.1, doorX, 0.12, front + 0.55)], M.stone());
      flat(1.4, d / 2 - front - 1.1, doorX, (front + 1.1 + d / 2) / 2, M.path(), 0.09);
      bushesAlong(add, r, bw * 0.8, doorX, front, zOff, xOff - bw * 0.1);
      trees(group, [[-w / 2 + 3, d / 2 - 3.5], [-w / 2 + 3.4, -d / 2 + 3.4]], r);
    }
  }
  return { group, body, height: h, variant: v };
}

// ── yard pieces ──────────────────────────────────────────────────────────────
function hedgeRing(add, w, d, doorX) {
  const hH = 1.1, hw = 0.8, gapL = doorX - 1.2, gapR = doorX + 1.2, fz = d / 2 - hw / 2;
  add([box(gapL + w / 2, hH, hw, (-w / 2 + gapL) / 2, hH / 2, fz), box(w / 2 - gapR, hH, hw, (gapR + w / 2) / 2, hH / 2, fz),
       box(w, hH, hw, 0, hH / 2, -d / 2 + hw / 2), box(hw, hH, d, -w / 2 + hw / 2, hH / 2, 0), box(hw, hH, d, w / 2 - hw / 2, hH / 2, 0)], M.hedge());
}
function fenceRing(add, w, d, doorX) {
  const geos = [], fH = 1.3, gapL = doorX - 1.3, gapR = doorX + 1.3;
  const run = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(len / 0.35));
    for (let i = 0; i <= n; i++) { const t = i / n; geos.push(box(0.16, fH, 0.08, x0 + (x1 - x0) * t, fH / 2, z0 + (z1 - z0) * t)); } };
  run(-w / 2, d / 2, gapL, d / 2); run(gapR, d / 2, w / 2, d / 2); run(-w / 2, -d / 2, w / 2, -d / 2);
  // the side runs, turned: slats along z
  for (const x of [-w / 2, w / 2]) { const n = Math.floor(d / 0.35); for (let i = 0; i <= n; i++) geos.push(box(0.08, fH, 0.16, x, fH / 2, -d / 2 + d * i / n)); }
  add(geos, M.wood());
}
function bushesAlong(add, r, bw, doorX, front, zOff, xc = 0) {
  const g = [];
  for (let i = 0; i < 6 + Math.floor(r() * 5); i++) {
    const s = 0.6 + r() * 0.8; let x = xc - bw / 2 + r() * bw;
    if (Math.abs(x - doorX) < 1.8) x += 2.4 * Math.sign(x - doorX || 1);
    g.push(new THREE.IcosahedronGeometry(s, 0).scale(1, 0.8, 1).translate(x, s * 0.7, front + 0.9 + r() * 0.6));
  }
  add(g, M.bush());
}
// small yard trees: a trunk and three lumps of leaf
function trees(group, spots, r) {
  const trunk = [], leaf = [];
  for (const [x, z] of spots) {
    const hgt = 4 + r() * 2.5, s = 1.6 + r() * 1.0;
    trunk.push(new THREE.CylinderGeometry(0.18, 0.26, hgt, 6).translate(x, hgt / 2, z));
    for (let i = 0; i < 3; i++) leaf.push(new THREE.IcosahedronGeometry(s * (0.8 + r() * 0.4), 0).translate(x + (r() - 0.5) * s, hgt + (r() - 0.2) * s * 0.8, z + (r() - 0.5) * s));
  }
  const t = new THREE.Mesh(mergeGeometries(trunk), M.bark()); t.castShadow = true; group.add(t);
  const l = new THREE.Mesh(mergeGeometries(leaf), M.leaf()); l.castShadow = true; group.add(l);
}

// the style for a lot when none is set: small lots are houses, big ones offices, the rest apartments
export function autoStyle(w, d) { const a = w * d; return Math.min(w, d) < 28 || a < 800 ? 'house' : a > 2600 ? 'office' : 'apartments'; }
