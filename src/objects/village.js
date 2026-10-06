// THE VILLAGE: Jacob's Tripo buildings, the procedural props (townProps.js) and town trees, placed from a layout,
// with stone roads painted on. The layout is plain data, so it saves, copies and pastes:
//   { v: 1, items: [{ id, type: 'model' | 'prop' | 'tree', kind, x, z, rot (degrees: where the front faces, 0 = +z), size, level, y (raised or sunk, m) }],
//          roads: [{ mat: 'cobbles' | 'flagstones' | 'erase', w (m), pts: [[x, z], ...] }] }
//   size: a model's longest side in metres; a prop's or a tree's scale (1 = as made)
// It knows nothing of the Terrain Lab: the land is handed in (heights, a ground-ray function), and the lab asks it
// for the ground pads (levelPads), the cells to keep clear of plants and trees (blockGrid) and the road picture.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeProp, PROP_KINDS } from './townProps.js';

// THE BUILDINGS: file (models/town/<file>.glb, 2K pictures; models/town/lo/ 1K), box: the model's bounding box in its own
// units, front: which of its sides has the entrance (turned to face +z), size: its longest side in metres, level: flatten
// the ground under it. Fronts and sizes from rendering each from all sides and judging doors, windows and steps
// (sizes a little up from those estimates where a building reads small among the others).
export const TOWN_ASSETS = {
  townHall: { name: 'Town hall', box: [1.0, 0.85, 0.81], front: '+Z', size: 24, category: 'landmark' },
  tavern: { name: 'Tavern', box: [0.93, 0.88, 1.0], front: '+Z', size: 12, category: 'work' },
  brewery: { name: 'Brewery', box: [0.99, 0.93, 0.97], front: '+Z', size: 11, category: 'work' },
  school: { name: 'School', box: [1.0, 0.57, 0.77], front: '+Z', size: 22, category: 'work' },
  observatory: { name: 'Observatory', box: [1.0, 0.79, 0.92], front: '+Z', size: 11, category: 'landmark' },
  hanger: { name: 'Hangar', box: [1.0, 0.67, 0.96], front: '+Z', size: 22, category: 'work' },
  workshop: { name: 'Workshop', box: [1.0, 0.94, 0.97], front: '+Z', size: 7, category: 'work' },
  fountain: { name: 'Orrery fountain', box: [0.99, 0.9, 1.0], front: '+Z', size: 5, category: 'landmark' },
  playground: { name: 'Treehouse playground', box: [1.0, 0.7, 0.76], front: '+Z', size: 10, category: 'park' },
  hottubHouse: { name: 'Hot tub house', box: [0.94, 0.78, 1.0], front: '+X', size: 11, category: 'home' },
  Lcottage: { name: 'L cottage', box: [1.0, 0.66, 0.8], front: '+Z', size: 10, category: 'home' },
  Tcottage: { name: 'T cottage', box: [1.0, 0.64, 0.74], front: '+Z', size: 11, category: 'home' },
  solarpunkCottage: { name: 'Solarpunk cottage', box: [0.73, 0.74, 1.0], front: '+Z', size: 9.5, category: 'home' },
  solarpunkHouse: { name: 'Solarpunk house', box: [1.0, 0.89, 0.81], front: '+Z', size: 11, category: 'home' },
  bridge: { name: 'Stone footbridge', box: [1.0, 0.37, 0.53], front: '+X', size: 12, category: 'infrastructure', level: false },   // spans along its front-back line once turned
};
// town trees (drawn by the Terrain Lab's forest, so they get its imposters, wind and shade): kind -> base height (m)
export const TOWN_TREES = { oak: 'Oak', ash: 'Ash', aspen: 'Aspen', pine: 'Pine' };
const FRONT_YAW = { '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 };   // turns the model so its front faces +z

// an item's footprint (width along its own x, depth along its own z, metres) and height
export function footprintOf(it) {
  if (it.type === 'model') { const A = TOWN_ASSETS[it.kind]; if (!A) return { w: 4, d: 4, h: 4 };
    const side = A.front === '+X' || A.front === '-X', bx = side ? A.box[2] : A.box[0], bz = side ? A.box[0] : A.box[2], s = it.size / Math.max(A.box[0], A.box[2]);
    return { w: bx * s, d: bz * s, h: A.box[1] * s }; }
  if (it.type === 'prop') { const P = PROP_KINDS.find(p => p.kind === it.kind); const f = P ? P.footprint : [1.5, 1.5]; return { w: f[0] * it.size, d: f[1] * it.size, h: propHeight(it.kind) * it.size }; }
  return { w: 5 * it.size, d: 5 * it.size, h: 14 * it.size };                               // a tree: its trunk's surroundings
}
// a prop's real height (measured once a kind), for its pick box
const PROP_H = {};
function propHeight(kind) { if (!(kind in PROP_H)) { try { const b = new THREE.Box3().setFromObject(makeProp(kind)); PROP_H[kind] = Math.max(0.5, b.max.y); } catch (e) { PROP_H[kind] = 2; } } return PROP_H[kind]; }
// (a building sits on the land as it is unless asked to level it, level: true: most have foundations enough for a gentle slope)
export const levels = (it) => it.type === 'model' && it.level === true && (TOWN_ASSETS[it.kind] || {}).level !== false;

// (world -> an item's own frame: x' = cos x - sin z, z' = sin x + cos z, its turn being rot)
// THE GROUND PADS: H = Hpre, then under each building that levels the ground, its footprint flattened (to the average
// height there) and blended back to the land over `margin` m. Grid N x N over SIZE m, a cell TEX m.
// Order doesn't matter: each cell takes the pad that holds it most (inside a footprint beats a neighbour's blend).
export function levelPads(H, Hpre, layout, N, SIZE, TEX, margin = 5) {
  H.set(Hpre);
  const F = new Float32Array(N * N), TGT = new Float32Array(N * N);
  for (const it of layout.items) {
    if (!levels(it)) continue;
    const { w, d } = footprintOf(it), a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hw = w / 2 + 1, hd = d / 2 + 1, R = Math.hypot(hw, hd) + margin;
    const i0 = Math.max(0, Math.floor((it.x - R + SIZE / 2) / TEX)), i1 = Math.min(N - 1, Math.ceil((it.x + R + SIZE / 2) / TEX));
    const j0 = Math.max(0, Math.floor((it.z - R + SIZE / 2) / TEX)), j1 = Math.min(N - 1, Math.ceil((it.z + R + SIZE / 2) / TEX));
    let sum = 0, n = 0; const cells = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * TEX - SIZE / 2 - it.x, z = (j + 0.5) * TEX - SIZE / 2 - it.z, lx = c * x - s * z, lz = s * x + c * z;
      const out = Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd));   // how far outside the footprint
      if (out <= 0) { sum += Hpre[j * N + i]; n++; }
      if (out < margin) cells.push([j * N + i, out]);
    }
    if (!n) continue;
    const target = sum / n;
    for (const [k, out] of cells) { const t = out / margin, f = out <= 0 ? 1.01 : 1 - t * t * (3 - 2 * t); if (f > F[k]) { F[k] = f; TGT[k] = target; } }
  }
  for (let k = 0; k < N * N; k++) if (F[k] > 0) H[k] = Hpre[k] + (TGT[k] - Hpre[k]) * Math.min(1, F[k]);
}

// THE ROADS, painted: a picture over the whole land (P x P, R cobbles, G flagstones), strokes drawn in order, erase strokes
// cutting both. Returns the canvas (the shader reads it).
export function paintRoads(canvas, layout, SIZE, P = 2048) {
  canvas.width = canvas.height = P;
  const g = canvas.getContext('2d', { willReadFrequently: true }), k = P / SIZE;
  g.clearRect(0, 0, P, P); g.lineCap = g.lineJoin = 'round';
  for (const r of layout.roads) drawStroke(g, r, SIZE, P);
  return canvas;
}
export function drawStroke(g, r, SIZE, P = 2048, from = 0) {
  const k = P / SIZE;
  g.globalCompositeOperation = r.mat === 'erase' ? 'destination-out' : 'source-over';   // the newest stroke wins: cobbles over flagstones and back
  g.strokeStyle = g.fillStyle = r.mat === 'flagstones' ? 'rgb(0,255,0)' : r.mat === 'erase' ? '#fff' : 'rgb(255,0,0)';
  g.lineWidth = Math.max(1, r.w * k);
  const p = (q) => [(q[0] + SIZE / 2) * k, (q[1] + SIZE / 2) * k];
  if (r.pts.length === 1 || from >= r.pts.length - 1) { const [x, y] = p(r.pts[r.pts.length - 1]); g.beginPath(); g.arc(x, y, g.lineWidth / 2, 0, 6.283); g.fill(); }
  else { g.beginPath(); const [x0, y0] = p(r.pts[Math.max(0, from)]); g.moveTo(x0, y0); for (let q = Math.max(0, from) + 1; q < r.pts.length; q++) { const [x, y] = p(r.pts[q]); g.lineTo(x, y); } g.stroke(); }
  g.globalCompositeOperation = 'source-over';
}

// THE CELLS KEPT CLEAR (0..1 a cell, N x N over SIZE): under and round the buildings and props (`pad` m beyond their
// footprints), round the town trees' trunks, and the roads (from the road picture). And THE YARDS: round the buildings
// (fading out over `yardM` m) and along the roads (~6 m), where the wild meadow gives way to mown lawn
export function blockGrid(layout, roadCanvas, N, SIZE, TEX, pad = 2, yardM = 14) {
  const B = new Float32Array(N * N), road = new Float32Array(N * N), yard = new Float32Array(N * N), bridge = new Float32Array(N * N);
  for (const it of layout.items) {
    if (it.type === 'model' && it.kind === 'bridge') {                  // a bridge is a way across, not in the way: its deck counts as road
      const { w, d } = footprintOf(it), a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), R = Math.hypot(w, d) / 2 + TEX;
      for (let j = Math.max(0, Math.floor((it.z - R + SIZE / 2) / TEX)); j <= Math.min(N - 1, Math.ceil((it.z + R + SIZE / 2) / TEX)); j++)
        for (let i = Math.max(0, Math.floor((it.x - R + SIZE / 2) / TEX)); i <= Math.min(N - 1, Math.ceil((it.x + R + SIZE / 2) / TEX)); i++) {
          const x = (i + 0.5) * TEX - SIZE / 2 - it.x, z = (j + 0.5) * TEX - SIZE / 2 - it.z;
          if (Math.abs(c * x - s * z) < w / 2 && Math.abs(s * x + c * z) < d / 2 + TEX) bridge[j * N + i] = 1;
        }
      continue;
    }
    const { w, d } = footprintOf(it), a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hw = w / 2 + pad, hd = d / 2 + pad, Y = it.type === 'model' ? yardM : it.type === 'prop' ? 4 : 0, R = Math.hypot(hw, hd) + Math.max(TEX, Y);
    const i0 = Math.max(0, Math.floor((it.x - R + SIZE / 2) / TEX)), i1 = Math.min(N - 1, Math.ceil((it.x + R + SIZE / 2) / TEX));
    const j0 = Math.max(0, Math.floor((it.z - R + SIZE / 2) / TEX)), j1 = Math.min(N - 1, Math.ceil((it.z + R + SIZE / 2) / TEX));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * TEX - SIZE / 2 - it.x, z = (j + 0.5) * TEX - SIZE / 2 - it.z, lx = c * x - s * z, lz = s * x + c * z;
      const out = Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd));
      const v = it.type === 'tree' ? 0.6 * Math.max(0, 1 - out / TEX) : Math.max(0, 1 - out / TEX); if (v > B[j * N + i]) B[j * N + i] = v;
      if (Y) { const t = Math.min(1, out / Y), y = 1 - t * t * (3 - 2 * t); if (y > yard[j * N + i]) yard[j * N + i] = y; }
    }
  }
  if (roadCanvas && roadCanvas.width) {
    const P = roadCanvas.width, d = roadCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, P, P).data, f = P / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let m = 0; for (let y = 0; y < f; y += 2) for (let x = 0; x < f; x += 2) { const o = ((j * f + y) * P + i * f + x) * 4; m = Math.max(m, d[o], d[o + 1]); }
      road[j * N + i] = m / 255; if (road[j * N + i] > B[j * N + i]) B[j * N + i] = road[j * N + i];
    }
    // the verges: the roads spread two cells each way (~6 m)
    const tmp = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let m = 0; for (let d = -2; d <= 2; d++) { const ii = i + d; if (ii >= 0 && ii < N) m = Math.max(m, road[j * N + ii] * (1 - Math.abs(d) * 0.3)); } tmp[j * N + i] = m; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let m = 0; for (let d = -2; d <= 2; d++) { const jj = j + d; if (jj >= 0 && jj < N) m = Math.max(m, tmp[jj * N + i] * (1 - Math.abs(d) * 0.3)); } if (m > yard[j * N + i]) yard[j * N + i] = m; }
  }
  for (let k = 0; k < N * N; k++) if (bridge[k] > road[k]) road[k] = bridge[k];
  return { block: B, road, yard, bridge };
}

// ── the things themselves ───────────────────────────────────────────────────────────────────────────────────────
const loader = new GLTFLoader(), modelCache = {};
export function loadModel(kind, lo) {   // -> { scene (the model as loaded, shared: clone it to use it), centre, minY, box }
  const key = kind + (lo ? '-lo' : '');
  return modelCache[key] || (modelCache[key] = new Promise((ok, bad) => loader.load(`/models/town/${lo ? 'lo/' : ''}${kind}.glb`, g => {
    const o = g.scene; o.updateMatrixWorld(true);
    o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; for (const mt of [].concat(m.material)) { mt.side = THREE.DoubleSide; if (mt.map) mt.map.anisotropy = 4; } } });   // (both sides: a gable or wall made as one face shows from behind too)
    const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
    ok({ scene: o, centre: c, minY: bb.min.y, box: bb.getSize(new THREE.Vector3()) });
  }, undefined, bad)));
}

// every item's object: a group placed at (x, ground, z), turned by rot, scaled; inside it the thing, centred and with its
// front to +z; and an invisible box the size of its footprint, for picking it with the mouse
export class Village {
  constructor({ scene, lo = false, heightAt, size }) {
    this.scene = scene; this.lo = lo; this.heightAt = heightAt; this.size = size;    // size: the land's width (m), for the road picture
    this.group = new THREE.Group(); scene.add(this.group);
    this.objs = new Map();                                        // id -> { group, pick, it }
    this.pickMat = new THREE.MeshBasicMaterial({ visible: false });
    this.layout = { v: 1, items: [], roads: [] };
  }
  setLayout(layout) { this.layout = normalise(layout); this.sync(); }
  // makes the scene match the layout (new items built, gone ones removed, the rest placed)
  sync() {
    const ids = new Set(this.layout.items.map(i => i.id));
    for (const [id, o] of this.objs) if (!ids.has(id)) { this.group.remove(o.group); this.objs.delete(id); }
    for (const it of this.layout.items) { let o = this.objs.get(it.id); if (!o || o.kind !== it.kind) { if (o) this.group.remove(o.group); o = this.build(it); } o.it = it; this.place(o); }
  }
  build(it) {
    const group = new THREE.Group(), pick = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.pickMat); pick.userData.id = it.id; group.add(pick);
    const o = { group, pick, it, kind: it.kind, inner: null };
    if (it.type === 'model') loadModel(it.kind, this.lo).then(m => { if (this.objs.get(it.id) !== o) return;
      const A = TOWN_ASSETS[it.kind], inner = new THREE.Group(), body = m.scene.clone(true);
      body.position.set(-m.centre.x, -m.minY, -m.centre.z); inner.add(body); inner.rotation.y = FRONT_YAW[A.front] || 0; o.inner = inner; group.add(inner); this.place(o); this.onLoaded && this.onLoaded(); });
    else if (it.type === 'prop') { o.inner = makeProp(it.kind); group.add(o.inner); }
    this.group.add(group); this.objs.set(it.id, o);
    return o;
  }
  place(o) {
    const it = o.it, { w, d, h } = footprintOf(it);
    o.group.position.set(it.x, this.heightAt(it.x, it.z) + (it.y || 0), it.z); o.group.rotation.y = it.rot * Math.PI / 180;   // (y: raised or sunk from the ground, m)
    if (o.inner) { if (it.type === 'model') { const A = TOWN_ASSETS[it.kind]; o.inner.scale.setScalar(it.size / Math.max(A.box[0], A.box[2])); } else o.inner.scale.setScalar(it.size); }
    o.pick.scale.set(w, h, d); o.pick.position.set(0, h / 2, 0);
    o.group.visible = it.type !== 'tree' || !!this.showTreePicks;   // trees are drawn by the forest; their group only holds the pick box
  }
  pickables() { return [...this.objs.values()].map(o => o.pick); }
  item(id) { return this.layout.items.find(i => i.id === id); }
}
let nextId = 1;
export const newId = () => 'i' + (Date.now().toString(36)) + (nextId++).toString(36);
export function normalise(L) {
  const out = { v: 1, items: [], roads: [] };
  for (const it of (L && L.items) || []) {
    if (!['model', 'prop', 'tree'].includes(it.type)) continue;
    if (it.type === 'model' && !TOWN_ASSETS[it.kind]) continue;
    if (it.type === 'prop' && !PROP_KINDS.some(p => p.kind === it.kind)) continue;   // (a layout from a newer page: skipped, not a crash)
    if (it.type === 'tree' && !TOWN_TREES[it.kind]) continue;
    out.items.push({ id: it.id || newId(), type: it.type, kind: it.kind, x: +it.x || 0, z: +it.z || 0, rot: ((+it.rot || 0) % 360 + 360) % 360,
      size: +it.size || (it.type === 'model' ? TOWN_ASSETS[it.kind].size : 1), ...(it.level === true ? { level: true } : {}), ...(+it.y ? { y: +(+it.y).toFixed(2) } : {}) });
  }
  for (const r of (L && L.roads) || []) if (r && r.pts && r.pts.length) out.roads.push({ mat: r.mat || 'cobbles', w: +r.w || 4, pts: r.pts.map(p => [+(+p[0]).toFixed(2), +(+p[1]).toFixed(2)]) });
  return out;
}
