// TOWN PROPS. Small procedural pieces for the village park: benches, an artist's easel, street
// lamps, planters, picnic tables, a market stall, a signpost and a round flower bed. Chunky and a
// little rounded (every board is a box with chamfered edges, so its edges catch the light), warm
// wood, dark green-black iron, cream stone and some greenery, to sit beside the hand-painted
// building models.
//
// Every prop is built once and cached: its parts are merged into one mesh per material, coloured
// by vertex, and a call to makeProp() hands back a new Group of meshes that share that geometry and
// those materials, so a park full of benches costs almost nothing. Don't dispose a prop's geometry
// or materials - every copy shares them.
//
// Local frame: real metres, standing on y = 0, centred on x = z = 0, its front facing +z.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeValehexGlobe } from './valehexGlobe.js';
import { makeStateMap } from './stateMap.js';
import { makeObelisk } from './obelisk.js';

// footprint is [width along x, depth along z] in metres. The signpost's is its post and the stones
// round it: it turns about the post, and its arrows reach out 0.8 m above head height.
export const PROP_KINDS = [
  { kind: 'bench', name: 'Park bench', footprint: [1.8, 0.7] },
  { kind: 'easel', name: "Artist's easel", footprint: [1.0, 0.85] },
  { kind: 'lamp', name: 'Street lamp', footprint: [0.5, 0.5] },
  { kind: 'planter', name: 'Planter box', footprint: [1.65, 0.65] },
  { kind: 'picnicTable', name: 'Picnic table', footprint: [1.8, 1.6] },
  { kind: 'stall', name: 'Market stall', footprint: [2.7, 1.3] },
  { kind: 'signpost', name: 'Signpost', footprint: [0.5, 0.5] },
  { kind: 'flowerBed', name: 'Flower bed', footprint: [2.45, 2.45] },
  { kind: 'valehexGlobe', name: 'Valehex globe', footprint: [1.2, 1.2] },   // (its own module: shaders of its own, and it turns)
  { kind: 'stateMap', name: 'Montana (its outline)', footprint: [4, 2.3] },   // (its own module: the state's shape, unseen; its border is planted in flowers)
  { kind: 'dock', name: 'Wooden dock', footprint: [1.7, 6.2] },
  { kind: 'obelisk', name: 'Hex obelisk', footprint: [0.9, 0.9] },          // (its own module: shaders of its own, and a message in its cells)
];

// ── palette ─────────────────────────────────────────────────────────────────
const C = {
  wood: 0xb27b46, woodLight: 0xcf9d63, woodDark: 0x7f5432, woodRed: 0x9a5a3a,
  iron: 0x33443a, ironDark: 0x232e28,
  stone: 0xe3d8bf, stoneDark: 0xc6b797,
  soil: 0x5b3f2b, leaf: 0x5d9440, leafDark: 0x3f6f30, leafLight: 0x86b84f, stem: 0x4f7c34,
  canvas: 0xf2ead8, cream: 0xf4ead2, awning: 0xc8553d,
  panel: 0x22385a, panelLine: 0x9db4d2,
};
const FLOWERS = [0xf28cb1, 0xffd34f, 0xb48cf2, 0xfff4e2, 0xff7d4d, 0x7fb2ff, 0xe8505b];

// The flower bed's drifts: five colours, each owning a slice of the bed round its centre.
// driftOf(x, z) -> [which drift, how far across its slice 0..1]
const DRIFTS = [FLOWERS[0], FLOWERS[1], FLOWERS[2], FLOWERS[4], FLOWERS[6]];
const driftOf = (x, z) => { const u = ((Math.atan2(x, z) / (Math.PI * 2) + 1.07) % 1) * DRIFTS.length; return [Math.floor(u), u % 1]; };
const BED_R = 0.97;   // the flower bed's planted dome, in metres

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ── materials (made on first use, shared by every prop) ───────────────────────
let MAT = null;
function materials() {
  if (MAT) return MAT;
  MAT = {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
    iron: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x8a6a40, emissive: 0xffcf80, emissiveIntensity: 1.5, roughness: 0.4 }),
    paint: new THREE.MeshStandardMaterial({ map: paintingTexture(), roughness: 0.92 }),
    bloom: new THREE.MeshStandardMaterial({ map: bloomTexture(), roughness: 0.95 }),
  };
  return MAT;
}

// The little landscape on the easel: sky, a low sun, hills going blue with distance, a meadow and
// a couple of trees, all laid on in short soft strokes so it reads as paint rather than a picture.
function paintingTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const r = rnd(7);
  const sky = g.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, '#78afdc'); sky.addColorStop(0.65, '#f1dcb6'); sky.addColorStop(1, '#f7c48c');
  g.fillStyle = sky; g.fillRect(0, 0, S, S);
  const glow = g.createRadialGradient(176, 96, 8, 176, 96, 70);
  glow.addColorStop(0, 'rgba(255,244,190,1)'); glow.addColorStop(0.35, 'rgba(255,214,130,0.75)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = glow; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff3c0'; g.beginPath(); g.arc(176, 96, 17, 0, Math.PI * 2); g.fill();
  // clouds: soft white dabs
  for (let i = 0; i < 26; i++) {
    const cx = 20 + (i % 13) * 9 + r() * 10 + (i < 13 ? 0 : 120), cy = (i < 13 ? 40 : 28) + r() * 12;
    g.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.3})`; g.beginPath(); g.ellipse(cx, cy, 10 + r() * 8, 4 + r() * 3, 0, 0, Math.PI * 2); g.fill();
  }
  const hill = (base, amp, colour, phase, freq) => {
    g.fillStyle = colour; g.beginPath(); g.moveTo(0, S);
    for (let x = 0; x <= S; x += 8) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * freq + phase)) - amp * 0.3 * Math.sin(x * freq * 2.7 + phase * 2));
    g.lineTo(S, S); g.closePath(); g.fill();
  };
  hill(132, 26, '#9aa8cc', 0.6, 0.025);
  hill(150, 22, '#6f9a86', 2.2, 0.03);
  hill(172, 18, '#5f9a4a', 4.1, 0.022);
  hill(200, 12, '#8cba52', 1.3, 0.035);
  // a river winding to the front
  g.fillStyle = '#8ec3e0'; g.beginPath(); g.moveTo(118, 176); g.quadraticCurveTo(100, 210, 60, 256); g.lineTo(110, 256); g.quadraticCurveTo(128, 214, 126, 176); g.closePath(); g.fill();
  // brush strokes over the land, in the colours already there
  for (let i = 0; i < 220; i++) {
    const x = r() * S, y = 140 + r() * 116;
    const pal = y > 200 ? ['#9cc85a', '#7fb047', '#b9d66b', '#6e9e3f'] : y > 165 ? ['#5c9447', '#4f8640', '#73a853'] : ['#6f9a86', '#86a897'];
    g.fillStyle = pal[Math.floor(r() * pal.length)]; g.globalAlpha = 0.45;
    g.beginPath(); g.ellipse(x, y, 4 + r() * 6, 1.5 + r() * 2, (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
  }
  // flowers in the meadow
  for (let i = 0; i < 40; i++) { g.fillStyle = ['#ffd34f', '#f28cb1', '#ffffff', '#ff7d4d'][i % 4]; g.globalAlpha = 0.85; g.beginPath(); g.arc(r() * S, 215 + r() * 40, 1.5 + r() * 1.5, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  // two trees
  for (const [tx, ty, s] of [[46, 178, 1], [212, 186, 1.25]]) {
    g.fillStyle = '#5a3c26'; g.fillRect(tx - 2 * s, ty, 4 * s, 18 * s);
    g.fillStyle = '#3e6f34'; g.beginPath(); g.ellipse(tx, ty - 4 * s, 13 * s, 17 * s, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5d9440'; g.beginPath(); g.ellipse(tx - 4 * s, ty - 9 * s, 7 * s, 9 * s, 0, 0, Math.PI * 2); g.fill();
  }
  // canvas weave, faintly
  g.globalAlpha = 0.06; g.fillStyle = '#000';
  for (let y = 0; y < S; y += 3) g.fillRect(0, y, S, 1);
  for (let x = 0; x < S; x += 3) g.fillRect(x, 0, 1, S);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// The flower bed's planting seen from above: leafy green, thick with little five-petalled flowers
// in the drifts' colours, a bit of green left where two drifts meet. Mapped flat onto the dome.
function bloomTexture() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const r = rnd(11), hex = (h) => '#' + new THREE.Color(h).getHexString();
  g.fillStyle = '#3d6b2e'; g.fillRect(0, 0, S, S);
  const greens = ['#4a7e36', '#5d9440', '#35602a', '#6aa448'];
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = greens[i % 4]; g.beginPath();
    g.ellipse(r() * S, r() * S, 4 + r() * 6, 2 + r() * 2.5, r() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  const cols = DRIFTS.map(hex), white = hex(FLOWERS[3]);
  for (let i = 0; i < 1500; i++) {
    const px = r() * S, py = r() * S;
    const x = (px / S - 0.5) * 2 * BED_R, z = ((1 - py / S) - 0.5) * 2 * BED_R;   // canvas is flipped onto the texture
    const [d, f] = driftOf(x, z), edge = Math.min(f, 1 - f);
    if (edge < 0.12 && r() > edge / 0.12) continue;           // thinning out where drifts meet
    const pr = 2.2 + r() * 1.6, col = r() < 0.05 ? white : cols[d];
    g.fillStyle = col;
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2 + i; g.beginPath(); g.arc(px + Math.cos(a) * pr, py + Math.sin(a) * pr, pr * 0.8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = d === 1 ? '#c98a1c' : '#ffe27a'; g.beginPath(); g.arc(px, py, pr * 0.55, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ── geometry helpers ────────────────────────────────────────────────────────
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

// position / rotation (Euler XYZ, or a quaternion) / scale applied to a geometry in place
function place(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  if (r.isQuaternion) _q.copy(r); else _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  g.applyMatrix4(_m.compose(V(p[0], p[1], p[2]), _q, V(s[0], s[1], s[2])));
  return g;
}

// A box whose twelve edges are chamfered by `b`: six faces, twelve bevel strips, eight corner
// triangles (44 triangles), flat-shaded so the bevels catch a highlight like a worn edge.
function chamferBox(w, h, d, b = 0.012) {
  b = Math.max(0.0005, Math.min(b, w * 0.3, h * 0.3, d * 0.3));
  const X = w / 2, Y = h / 2, Z = d / 2;
  const v = (sx, sy, sz, t) => [sx * (t === 0 ? X : X - b), sy * (t === 1 ? Y : Y - b), sz * (t === 2 ? Z : Z - b)];
  const tris = [];
  const quad = (a, b2, c, d2) => tris.push(a, b2, c, a, c, d2);
  for (const s of [-1, 1]) {
    quad(v(s, -1, -1, 0), v(s, 1, -1, 0), v(s, 1, 1, 0), v(s, -1, 1, 0));
    quad(v(-1, s, -1, 1), v(1, s, -1, 1), v(1, s, 1, 1), v(-1, s, 1, 1));
    quad(v(-1, -1, s, 2), v(1, -1, s, 2), v(1, 1, s, 2), v(-1, 1, s, 2));
  }
  for (const a of [-1, 1]) for (const c of [-1, 1]) {
    quad(v(-1, a, c, 1), v(1, a, c, 1), v(1, a, c, 2), v(-1, a, c, 2));   // edges along x
    quad(v(a, -1, c, 0), v(a, 1, c, 0), v(a, 1, c, 2), v(a, -1, c, 2));   // along y
    quad(v(a, c, -1, 0), v(a, c, 1, 0), v(a, c, 1, 1), v(a, c, -1, 1));   // along z
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) tris.push(v(sx, sy, sz, 0), v(sx, sy, sz, 1), v(sx, sy, sz, 2));
  // wind every triangle outward: the box is convex round the origin, so outward faces its centroid
  const pos = new Float32Array(tris.length * 3);
  const A = V(0, 0, 0), B = V(0, 0, 0), Cc = V(0, 0, 0), n = V(0, 0, 0), e1 = V(0, 0, 0), e2 = V(0, 0, 0);
  for (let i = 0; i < tris.length; i += 3) {
    A.fromArray(tris[i]); B.fromArray(tris[i + 1]); Cc.fromArray(tris[i + 2]);
    n.crossVectors(e1.subVectors(B, A), e2.subVectors(Cc, A));
    const out = n.dot(A.clone().add(B).add(Cc)) >= 0;
    pos.set(tris[i], i * 3); pos.set(out ? tris[i + 1] : tris[i + 2], i * 3 + 3); pos.set(out ? tris[i + 2] : tris[i + 1], i * 3 + 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

// a chamfered beam from point a to point b; `t` across (local x), `d` deep (local z)
function beam(a, b, t, d, bevel = 0.01) {
  const A = V(...a), B = V(...b), dir = B.clone().sub(A), len = dir.length();
  const g = chamferBox(t, len, d, bevel);
  _q.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  g.applyMatrix4(_m.compose(A.add(B).multiplyScalar(0.5), _q, V(1, 1, 1)));
  return g;
}
const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
// a soft lump: a twenty-faced ball with its normals smoothed, round enough for a flower head,
// a fruit or a clump of leaves at twenty triangles
function blob(r) {
  const g = new THREE.IcosahedronGeometry(r, 0); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g); m.computeVertexNormals(); return m;
}

// darken towards the ground (a painted-in contact shadow); k = 1 above 30 cm
const ao = (y) => { const t = Math.min(1, Math.max(0, y / 0.3)); return 0.74 + 0.26 * t * t * (3 - 2 * t); };

const TEXTURED = new Set(['paint', 'bloom']);   // materials whose parts keep their uvs

// Collects parts per material; `build()` merges each material's parts into one geometry.
class Kit {
  constructor(seed) { this.parts = {}; this.r = rnd(seed); }
  // a colour nudged lighter or darker by up to `amt`, so boards and stones are never identical
  tone(hex, amt = 0.08) { return new THREE.Color(hex).multiplyScalar(1 + (this.r() * 2 - 1) * amt); }
  add(mat, geo, colour, { shade = true } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(TEXTURED.has(mat) && k === 'uv')) g.deleteAttribute(k);
    g.clearGroups();
    // `colour`: a hex, a THREE.Color, or a function (x, y, z) => THREE.Color for colour that varies over the part
    const fn = typeof colour === 'function' ? colour : null, c = fn ? null : colour instanceof THREE.Color ? colour : new THREE.Color(colour);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const cc = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : c, k = shade ? ao(p.getY(i)) : 1;
      col[i * 3] = cc.r * k; col[i * 3 + 1] = cc.g * k; col[i * 3 + 2] = cc.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (this.parts[mat] || (this.parts[mat] = [])).push(g);
    return this;
  }
  // `centre`: slide the prop so its footprint is centred on x = z = 0
  build({ centre = true } = {}) {
    const out = [], box = new THREE.Box3();
    for (const [mat, geos] of Object.entries(this.parts)) {
      const g = mergeGeometries(geos); g.computeBoundingBox(); box.union(g.boundingBox);
      out.push({ mat, geo: g });
    }
    const cx = centre ? (box.min.x + box.max.x) / 2 : 0, cz = centre ? (box.min.z + box.max.z) / 2 : 0;
    for (const { geo } of out) { if (cx || cz) geo.translate(-cx, 0, -cz); geo.computeBoundingBox(); geo.computeBoundingSphere(); }
    return out;
  }
}

// ── the props ───────────────────────────────────────────────────────────────

// Park bench: four seat slats and three back slats on two cast-iron side frames, the frames
// joined low down by a stretcher with a strut up to a middle seat bracket.
function bench(k) {
  const W = 1.8, FX = 0.78;
  const I = (a, b, t = 0.05, d = 0.055) => k.add('iron', beam(a, b, t, d, 0.012), k.tone(C.iron, 0.04));
  // the back upright's line, (y, z): the back slats are laid along it
  const P0 = [0.44, -0.2], P1 = [0.92, -0.33];
  for (const sx of [-1, 1]) {
    const x = sx * FX;
    I([x, 0.02, 0.24], [x, 0.64, 0.25]);                // front leg, up to the arm
    I([x, 0.02, -0.24], [x, P0[0], P0[1]]);             // rear leg
    I([x, P0[0], P0[1]], [x, P1[0], P1[1]]);            // back upright
    I([x, 0.41, 0.28], [x, 0.41, -0.215]);              // seat rail
    I([x, 0.13, 0.245], [x, 0.13, -0.235], 0.04, 0.04); // low side rail
    I([x, 0.645, 0.31], [x, 0.665, -0.255], 0.06, 0.045); // armrest
    for (const z of [0.245, -0.24]) k.add('iron', place(chamferBox(0.085, 0.03, 0.13, 0.01), [x, 0.015, z]), C.ironDark);
    // a scroll under the front of the arm
    k.add('iron', place(new THREE.TorusGeometry(0.045, 0.012, 4, 8, Math.PI * 1.5), [x, 0.585, 0.29], [0, Math.PI / 2, 0]), C.iron);
  }
  // middle: stretcher, strut and a bracket under the seat
  I([-FX, 0.13, 0.0], [FX, 0.13, 0.0], 0.035, 0.035);
  I([0, 0.13, 0.0], [0, 0.41, 0.0], 0.035, 0.035);
  I([0, 0.41, 0.26], [0, 0.41, -0.2], 0.035, 0.05);
  // seat slats, resting on the rails (rail top 0.4375)
  for (const z of [0.215, 0.1, -0.015, -0.13]) k.add('matte', place(chamferBox(W, 0.035, 0.1, 0.01), [0, 0.455, z]), k.tone(C.wood));
  // back slats along the upright, standing just proud of it
  const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), uy = (P1[0] - P0[0]) / L, uz = (P1[1] - P0[1]) / L, ny = -uz, nz = uy;
  const tilt = Math.atan2(uz, uy);
  for (const t of [0.3, 0.6, 0.9]) {
    const y = P0[0] + uy * t * L + ny * 0.044, z = P0[1] + uz * t * L + nz * 0.044;
    k.add('matte', place(chamferBox(W, 0.11, 0.032, 0.01), [0, y, z], [tilt, 0, 0]), k.tone(C.wood));
  }
}

// Artist's easel: two splayed front legs and a back leg meeting at a hinge, a centre mast, a
// wide ledge holding a painted canvas, a jar of brushes at one end and a palette at the other.
function easel(k) {
  const W = C.woodLight;
  const zl = (y) => 0.2 - 0.1294 * y;               // the front legs' lean: z at height y
  const xl = (y) => 0.34 - 0.1794 * y;              // and their half-spread
  for (const s of [-1, 1]) k.add('matte', beam([s * 0.34, 0, 0.2], [s * xl(1.7), 1.7, zl(1.7)], 0.045, 0.035, 0.01), k.tone(W, 0.05));
  k.add('matte', beam([0, 0, -0.56], [0, 1.62, -0.07], 0.045, 0.035, 0.01), k.tone(W, 0.05));   // back leg
  k.add('matte', place(chamferBox(0.11, 0.07, 0.1, 0.012), [0, 1.66, -0.035]), C.wood);        // hinge block
  k.add('matte', place(chamferBox(0.05, 0.06, 0.05, 0.01), [0, 1.73, zl(1.73)]), C.wood);       // finial
  // low crossbar and centre mast, in the plane of the front legs
  k.add('matte', beam([-xl(0.5), 0.5, zl(0.5)], [xl(0.5), 0.5, zl(0.5)], 0.035, 0.03, 0.008), k.tone(W, 0.05));
  k.add('matte', beam([0, 0.5, zl(0.5)], [0, 1.68, zl(1.68)], 0.04, 0.03, 0.008), k.tone(W, 0.05));
  // the ledge: a tray with a lip, on two brackets
  const ly = 0.88, lz = zl(ly) + 0.0175 + 0.075;
  k.add('matte', place(chamferBox(1.0, 0.03, 0.15, 0.008), [0, ly, lz]), C.wood);
  k.add('matte', place(chamferBox(1.0, 0.035, 0.016, 0.006), [0, ly + 0.025, lz + 0.068]), C.woodDark);
  for (const s of [-1, 1]) k.add('matte', place(chamferBox(0.04, 0.07, 0.09, 0.008), [s * xl(0.83), 0.83, zl(0.83) + 0.06]), C.woodDark);
  k.add('matte', place(chamferBox(0.06, 0.07, 0.09, 0.008), [0, 0.83, zl(0.83) + 0.06]), C.woodDark);
  // the canvas, leaning back with the legs; its picture on the front face
  const tilt = -Math.atan(0.1294), q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt);
  const foot = V(0, ly + 0.015, zl(ly + 0.015) + 0.0175 + 0.001);   // bottom of the canvas's back face
  const at = (y, z) => V(0, y, z).applyQuaternion(q).add(foot);
  const CW = 0.6, CH = 0.5, CT = 0.025, mid = at(CH / 2, CT / 2), face = at(CH / 2, CT + 0.0012);
  k.add('matte', place(chamferBox(CW, CH, CT, 0.004), mid.toArray(), q), C.canvas, { shade: false });
  k.add('paint', place(new THREE.PlaneGeometry(CW - 0.012, CH - 0.012), face.toArray(), q), 0xffffff, { shade: false });
  // top clamp, holding the canvas to the mast
  const top = at(CH + 0.02, 0.0);
  k.add('matte', place(chamferBox(0.12, 0.04, 0.075, 0.008), [0, top.y, (top.z + zl(top.y)) / 2 + 0.012], q), C.wood);
  // palette: a flat oval with dabs of paint, at the right end of the ledge
  const py = ly + 0.015 + 0.006, pz = lz - 0.002;
  k.add('matte', place(cyl(1, 1, 0.012, 12), [0.39, py, pz], [0, 0.4, 0], [0.095, 1, 0.06]), 0xd9b47e, { shade: false });
  FLOWERS.slice(0, 6).forEach((c, i) => {
    const a = 0.5 + i * 0.85;
    k.add('matte', place(blob(0.013), [0.39 + Math.cos(a) * 0.06, py + 0.008, pz + Math.sin(a) * 0.035], [0, 0, 0], [1, 0.5, 1]), c, { shade: false });
  });
  // a jar of brushes at the left end
  const jx = -0.4, jy = ly + 0.015;
  k.add('matte', place(cyl(0.032, 0.028, 0.085, 8), [jx, jy + 0.0425, lz]), 0x7fa7b8, { shade: false });
  [[-0.2, 0.12, 0.17], [0.15, -0.1, 0.2], [0.05, 0.2, 0.15]].forEach(([rz, rx, h], i) => {
    const g = place(cyl(0.004, 0.005, h, 4), [0, h / 2, 0]); place(g, [jx + rz * 0.05, jy + 0.03, lz + rx * 0.05], [rx, 0, rz]);
    k.add('matte', g, [0xc8553d, 0x2f4a6a, 0xe0b04a][i], { shade: false });
  });
}

// Street lamp: a stepped base, a tall post with collars, four scrolls under a hexagonal lantern
// whose glass glows, a roof and finial, and a little solar panel on top.
function lamp(k) {
  const I = (g, c = C.iron) => k.add('iron', g, k.tone(c, 0.03));
  const POST = 2.88;
  I(place(cyl(0.19, 0.24, 0.1, 8), [0, 0.05, 0]), C.ironDark);
  I(place(cyl(0.13, 0.18, 0.38, 8), [0, 0.29, 0]));
  I(place(cyl(0.15, 0.15, 0.045, 8), [0, 0.49, 0]), C.ironDark);
  I(place(cyl(0.05, 0.068, POST - 0.5, 8), [0, (POST + 0.5) / 2, 0]));
  I(place(cyl(0.08, 0.08, 0.05, 8), [0, 1.55, 0]), C.ironDark);
  I(place(cyl(0.085, 0.065, 0.07, 8), [0, POST + 0.02, 0]), C.ironDark);
  // scrolls: half-rings bulging out from the post up to the lantern's base
  const L0 = POST + 0.05, LH = 0.33;
  for (let i = 0; i < 4; i++) {
    const g = place(new THREE.TorusGeometry(0.075, 0.012, 4, 8, Math.PI), [0.045, 0, 0], [0, 0, -Math.PI / 2]);   // a ")" off the post
    I(place(g, [0, L0 - 0.065, 0], [0, i * Math.PI / 2 + Math.PI / 4, 0]));
  }
  // lantern: base, glowing glass, corner bars, top ring, roof, finial
  I(place(cyl(0.155, 0.1, 0.06, 6), [0, L0 + 0.03, 0]), C.ironDark);
  k.add('glow', place(cyl(0.15, 0.11, LH, 6), [0, L0 + 0.06 + LH / 2, 0]), 0xffffff, { shade: false });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, s = Math.sin(a), c = Math.cos(a);
    I(beam([s * 0.115, L0 + 0.06, c * 0.115], [s * 0.155, L0 + 0.06 + LH, c * 0.155], 0.018, 0.018, 0.004));
  }
  const LT = L0 + 0.06 + LH;
  I(place(cyl(0.175, 0.17, 0.035, 6), [0, LT + 0.0175, 0]), C.ironDark);
  I(place(new THREE.ConeGeometry(0.23, 0.15, 6), [0, LT + 0.035 + 0.075, 0]));
  I(place(new THREE.SphereGeometry(0.025, 6, 4), [0, LT + 0.19, 0]));
  // solar panel on a short stub, tilted to the front
  I(place(cyl(0.014, 0.014, 0.1, 5), [0, LT + 0.22, 0]));
  const tilt = 0.45, q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt), PY = LT + 0.285;
  I(place(chamferBox(0.36, 0.022, 0.26, 0.005), [0, PY, 0], q), C.panel);
  const up = V(0, 0.0115, 0).applyQuaternion(q);
  for (const x of [-0.06, 0.06]) I(place(new THREE.BoxGeometry(0.004, 0.002, 0.24), [x, PY + up.y, up.z], q), C.panelLine);
  I(place(new THREE.BoxGeometry(0.34, 0.002, 0.004), [0, PY + up.y, up.z], q), C.panelLine);
}

// a flower: a thin three-sided stem and a coloured blob for the head
function flower(k, x, y, z, h, r, colour) {
  k.add('matte', place(cyl(0.006, 0.009, h, 3, true), [x, y + h / 2, z]), C.stem);
  k.add('matte', place(blob(r), [x, y + h, z], [k.r() * 3, k.r() * 3, 0], [1, 0.75, 1]), k.tone(colour, 0.06), { shade: false });
}

// Planter: a box of boards between four corner posts, capped with a rim, full of soil, leafy
// clumps and a mix of flowers.
function planter(k) {
  const L = 1.6, D = 0.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add('matte', place(chamferBox(0.09, 0.5, 0.09, 0.014), [sx * (L / 2 - 0.045), 0.25, sz * (D / 2 - 0.045)]), k.tone(C.woodDark, 0.05));
  for (const y of [0.135, 0.375]) {
    for (const s of [-1, 1]) {
      k.add('matte', place(chamferBox(L - 0.1, 0.23, 0.045, 0.012), [0, y, s * (D / 2 - 0.035)]), k.tone(C.wood));
      k.add('matte', place(chamferBox(0.045, 0.23, D - 0.1, 0.012), [s * (L / 2 - 0.035), y, 0]), k.tone(C.wood));
    }
  }
  for (const s of [-1, 1]) {
    k.add('matte', place(chamferBox(L + 0.04, 0.035, 0.1, 0.01), [0, 0.515, s * (D / 2 - 0.03)]), k.tone(C.woodLight, 0.04));
    k.add('matte', place(chamferBox(0.1, 0.034, D - 0.12, 0.01), [s * (L / 2 - 0.03), 0.515, 0]), k.tone(C.woodLight, 0.04));
  }
  k.add('matte', place(chamferBox(L - 0.12, 0.05, D - 0.12, 0.01), [0, 0.47, 0]), C.soil, { shade: false });
  // leafy clumps along the box, flowers rising out of them
  for (let i = 0; i < 7; i++) {
    const x = -0.62 + i * 0.207 + (k.r() - 0.5) * 0.06, z = (k.r() - 0.5) * 0.16;
    k.add('matte', place(blob(0.13 + k.r() * 0.04), [x, 0.5, z], [k.r() * 3, k.r() * 3, 0], [1.1, 0.55, 0.9]), k.tone(i % 2 ? C.leaf : C.leafDark, 0.06), { shade: false });
  }
  for (let i = 0; i < 18; i++) {
    const x = -0.66 + (i + k.r() * 0.8) * (1.32 / 18), z = (k.r() - 0.5) * 0.3;
    flower(k, x, 0.49, z, 0.1 + k.r() * 0.18, 0.035 + k.r() * 0.017, FLOWERS[Math.floor(k.r() * FLOWERS.length)]);
  }
}

// Picnic table: five top boards on two cleats, a bench board pair each side, A-frame legs at each
// end and a diagonal brace from each bench support up under the middle of the top.
function picnicTable(k) {
  const L = 1.8, FX = 0.6;
  for (let i = 0; i < 5; i++) k.add('matte', place(chamferBox(L, 0.045, 0.135, 0.012), [0, 0.7525, (i - 2) * 0.145]), k.tone(C.wood));
  for (const s of [-1, 1]) for (const z of [0.535, 0.665]) k.add('matte', place(chamferBox(L, 0.04, 0.12, 0.012), [0, 0.445, s * z]), k.tone(C.wood));
  for (const sx of [-1, 1]) {
    const x = sx * FX;
    k.add('matte', place(chamferBox(0.06, 0.06, 0.72, 0.01), [x, 0.7, 0]), k.tone(C.woodDark, 0.05));
    k.add('matte', place(chamferBox(0.06, 0.07, 1.56, 0.01), [x, 0.39, 0]), k.tone(C.woodDark, 0.05));
    for (const sz of [-1, 1]) k.add('matte', beam([x - sx * 0.055, 0, sz * 0.62], [x - sx * 0.055, 0.73, sz * 0.12], 0.05, 0.11, 0.012), k.tone(C.woodDark, 0.05));
    k.add('matte', beam([x - sx * 0.02, 0.4, 0], [sx * 0.12, 0.73, 0], 0.05, 0.07, 0.01), k.tone(C.woodDark, 0.05));
  }
}

// Market stall: a plank-fronted counter, four posts, a striped awning sloping to the front with a
// scalloped valance, and three crates of produce on the counter.
function stall(k) {
  const HW = 1.19;                                          // posts' x
  k.add('matte', place(chamferBox(2.3, 0.86, 0.62, 0.015), [0, 0.43, -0.02]), C.woodDark);
  for (let i = 0; i < 6; i++) k.add('matte', place(chamferBox(0.38, 0.8, 0.03, 0.01), [-0.95 + i * 0.38, 0.42, 0.3]), k.tone(i % 2 ? C.wood : C.woodRed, 0.06));
  k.add('matte', place(chamferBox(2.46, 0.06, 0.8, 0.015), [0, 0.89, 0.04]), C.woodLight);
  // awning plane: from the back (y 2.48, z -0.5) down to the front (y 2.12, z 0.78)
  const B = [2.48, -0.5], F = [2.12, 0.78], len = Math.hypot(F[0] - B[0], F[1] - B[1]);
  const at = (z) => B[0] + (F[0] - B[0]) * (z - B[1]) / (F[1] - B[1]);     // awning height over z
  for (const [x, z] of [[-HW, -0.33], [HW, -0.33], [-HW, 0.37], [HW, 0.37]]) {
    const h = at(z) - 0.015;
    k.add('matte', place(chamferBox(0.08, h, 0.08, 0.012), [x, h / 2, z]), k.tone(C.woodDark, 0.05));
  }
  const slope = Math.asin((B[0] - F[0]) / len), N = 8, SW = 2.66 / N;
  for (let i = 0; i < N; i++) {
    const x = -1.33 + SW * (i + 0.5), c = i % 2 ? C.cream : C.awning;
    k.add('matte', place(new THREE.BoxGeometry(SW, 0.025, len), [x, (B[0] + F[0]) / 2, (B[1] + F[1]) / 2], [slope, 0, 0]), c, { shade: false });
    // a valance flap with a rounded bottom
    const fy = F[0] - 0.012;
    k.add('matte', place(new THREE.BoxGeometry(SW, 0.1, 0.02), [x, fy - 0.05, F[1]]), c, { shade: false });
    k.add('matte', place(new THREE.CylinderGeometry(SW / 2, SW / 2, 0.02, 6, 1, false, Math.PI / 2, Math.PI), [x, fy - 0.1, F[1]], [-Math.PI / 2, 0, 0]), c, { shade: false });
  }
  // crates of produce on the counter (top at 0.92)
  [[-0.72, 0xf08a24], [0, 0xc8352c], [0.72, 0x8bbf3c]].forEach(([x, fruit]) => {
    k.add('matte', place(chamferBox(0.44, 0.16, 0.32, 0.012), [x, 1.0, 0.13]), k.tone(C.wood, 0.05));
    k.add('matte', place(new THREE.BoxGeometry(0.446, 0.012, 0.326), [x, 1.0, 0.13]), C.woodDark);         // the gap between two slats
    k.add('matte', place(new THREE.BoxGeometry(0.4, 0.004, 0.28), [x, 1.081, 0.13]), 0x3a2618, { shade: false });   // the dark inside
    for (let i = 0; i < 6; i++) {
      const fx = x + ((i % 3) - 1) * 0.125 + (k.r() - 0.5) * 0.02, fz = 0.13 + (i < 3 ? -0.068 : 0.068);
      k.add('matte', place(blob(0.06), [fx, 1.11 + (i === 1 || i === 5 ? 0.025 : 0), fz], [k.r() * 3, k.r() * 3, 0]), k.tone(fruit, 0.08), { shade: false });
    }
  });
}

// Signpost: a square post with a pyramid cap, three painted arrow boards pointing different ways
// (dark strokes standing in for the lettering), and a few stones and tufts round its foot.
function signpost(k) {
  k.add('matte', place(chamferBox(0.11, 2.2, 0.11, 0.015), [0, 1.1, 0]), C.woodDark);
  k.add('matte', place(new THREE.ConeGeometry(0.095, 0.12, 4), [0, 2.26, 0], [0, Math.PI / 4, 0]), C.woodDark);
  const shape = new THREE.Shape(), AL = 0.78, AH = 0.17, TIP = 0.13;
  shape.moveTo(-0.07, -AH / 2); shape.lineTo(AL - TIP, -AH / 2); shape.lineTo(AL, 0); shape.lineTo(AL - TIP, AH / 2); shape.lineTo(-0.07, AH / 2); shape.closePath();
  const DEPTH = 0.03, BV = 0.007;
  const arrows = [[1.98, -0.25, 0x7aa886], [1.76, Math.PI + 0.3, 0xe0b04a], [1.54, 0.5, 0xc9694a]];
  for (const [y, ang, colour] of arrows) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ang);
    const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: BV, bevelSize: BV, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -DEPTH / 2);
    k.add('matte', place(g, [0, y, 0], q), colour, { shade: false });
    // "lettering" on both faces
    for (const side of [-1, 1]) for (const [lx, ly, lw] of [[0.29, 0.03, 0.34], [0.25, -0.03, 0.26]]) {
      const s = place(new THREE.BoxGeometry(lw, 0.024, 0.004), [lx, ly, side * (DEPTH / 2 + BV + 0.001)]);
      k.add('matte', place(s, [0, y, 0], q), 0x3a2a1e, { shade: false });
    }
  }
  // stones and grass round the foot
  [[0.13, 0.07, 0.12], [-0.12, 0.1, 0.1], [0.02, -0.14, 0.13]].forEach(([x, z, r]) =>
    k.add('matte', place(new THREE.DodecahedronGeometry(r, 0), [x, r * 0.35, z], [k.r() * 3, k.r() * 3, 0], [1.2, 0.6, 1]), k.tone(C.stone, 0.08)));
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + k.r() * 0.5, d = 0.1 + k.r() * 0.12, h = 0.08 + k.r() * 0.08;
    k.add('matte', place(new THREE.ConeGeometry(0.035, h, 4), [Math.cos(a) * d, h / 2, Math.sin(a) * d], [(k.r() - 0.5) * 0.4, k.r(), (k.r() - 0.5) * 0.4]), k.tone(C.leaf, 0.1), { shade: false });
  }
}

// Flower bed: a ring of cream cobbles round a disc of soil, a low dome of foliage thick with
// drifts of flowers (each colour in its own patch, as a gardener plants them) - painted on, with
// flower heads standing out of them - and a round shrub in the middle.
function flowerBed(k) {
  const R = 1.08;
  k.add('matte', place(cyl(1.04, 1.06, 0.14, 18), [0, 0.07, 0]), C.soil, { shade: false });
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i + k.r() * 0.2) / N * Math.PI * 2;
    k.add('matte', place(cyl(0.16, 0.18, 0.17 + k.r() * 0.04, 6), [Math.sin(a) * R, 0.085, Math.cos(a) * R], [0, a, 0], [1.3, 1, 0.82]), k.tone(i % 3 ? C.stone : C.stoneDark, 0.06));
  }
  // the planted dome, a hemisphere wearing the bloom picture laid flat from above
  const DR = BED_R, DH = 0.3, DY = 0.12;
  const surf = (rho) => DY + DH * Math.sqrt(Math.max(0, 1 - (rho / DR) ** 2));
  const dome = place(new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0, DY, 0], [0, 0, 0], [DR, DH, DR]);
  const p = dome.attributes.position, uv = dome.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * DR) + 0.5, p.getZ(i) / (2 * DR) + 0.5);
  k.add('bloom', dome, 0xffffff, { shade: false });
  // flower heads standing out of the drifts
  for (let i = 0; i < 30; i++) {
    const a = (i + k.r() * 0.7) / 30 * Math.PI * 2, rho = 0.36 + (i % 3) * 0.2 + (k.r() - 0.5) * 0.12, x = Math.sin(a) * rho, z = Math.cos(a) * rho;
    const [d, f] = driftOf(x, z);
    const colour = i % 9 === 4 ? FLOWERS[3] : f < 0.1 || f > 0.9 ? C.leaf : DRIFTS[d];   // the odd white one; leafy tufts where drifts meet
    k.add('matte', place(blob(0.04 + k.r() * 0.02), [x, surf(rho) + 0.025, z], [k.r() * 3, k.r() * 3, 0], [1, 0.7, 1]), k.tone(colour, 0.07), { shade: false });
  }
  // the shrub
  [[0, 0.62, 0, 0.32], [0.14, 0.52, 0.1, 0.24], [-0.13, 0.5, -0.08, 0.23]].forEach(([x, y, z, r], i) =>
    k.add('matte', place(new THREE.IcosahedronGeometry(r, 1), [x, y, z], [k.r(), k.r(), 0], [1, 0.9, 1]), k.tone(i ? C.leaf : C.leafDark, 0.05), { shade: false }));
}

// Wooden dock: plank boards across two stringers, running out along +z over the water on posts that go down into it, a
// mooring post at the far end with a coil of rope. Its deck stands 0.45 m up; the posts reach 1.4 m below the ground
function dock(k) {
  const L = 6, W = 1.6, Y = 0.45;
  for (let z = 0.1; z < L; z += 0.21) k.add('matte', place(chamferBox(W, 0.05, 0.18, 0.012), [0, Y, z - L / 2]), k.tone(C.wood, 0.12));   // (the boards)
  for (const x of [-0.62, 0.62]) k.add('matte', place(chamferBox(0.12, 0.14, L, 0.015), [x, Y - 0.095, 0]), k.tone(C.woodDark));          // (the stringers)
  for (let z = 0.2; z <= L; z += 1.45) for (const x of [-0.78, 0.78]) k.add('matte', place(new THREE.CylinderGeometry(0.08, 0.09, 2.0, 7).translate(0, -0.4, 0), [x, 0, z - L / 2]), k.tone(C.woodDark, 0.1));
  k.add('matte', place(new THREE.CylinderGeometry(0.11, 0.12, 1.1, 8).translate(0, 0.55, 0), [0.55, Y, L / 2 - 0.25]), k.tone(C.woodDark));   // (the mooring post)
  k.add('matte', place(new THREE.TorusGeometry(0.16, 0.035, 5, 12).rotateX(Math.PI / 2), [0.55, Y + 0.06, L / 2 - 0.6]), C.canvas);            // (a coil of rope)
}
const BUILDERS = { bench, easel, lamp, planter, picnicTable, stall, signpost, flowerBed, dock };
const CACHE = new Map();

// A new Group for the prop: meshes sharing the cached geometry and materials.
export function makeProp(kind) {
  if (kind === 'valehexGlobe') return makeValehexGlobe();
  if (kind === 'stateMap') return makeStateMap();
  if (kind === 'obelisk') return makeObelisk();
  const make = BUILDERS[kind];
  if (!make) throw new Error(`townProps: no prop called "${kind}"`);
  const M = materials();
  if (!CACHE.has(kind)) {
    const k = new Kit(Object.keys(BUILDERS).indexOf(kind) * 131 + 17);
    make(k);
    CACHE.set(kind, k.build({ centre: kind !== 'signpost' }));   // a signpost turns about its post
  }
  const group = new THREE.Group(); group.name = kind; group.userData.kind = kind;
  for (const { mat, geo } of CACHE.get(kind)) {
    const m = new THREE.Mesh(geo, M[mat]); m.castShadow = true; m.receiveShadow = true; m.name = `${kind}:${mat}`;
    group.add(m);
  }
  if (kind === 'lamp') group.userData.lightAt = [0, 3.17, 0];   // where a caller could hang a light
  return group;
}

// triangles in one copy of the prop
export function propTriangles(kind) {
  makeProp(kind);
  return CACHE.get(kind).reduce((n, { geo }) => n + geo.attributes.position.count / 3, 0);
}
