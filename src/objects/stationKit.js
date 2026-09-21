// STATION KIT. A station built from separate Tripo parts instead of one model: a tower on the axis,
// one or more rings turning around it on a collar, arms and hangars repeated around the ring, and
// satellites scattered outside. Every repeated part is one instanced draw, so twelve arms cost about
// the same as one.
//
// Each part arrives with its own size and facing, so the kit measures every one at load and works in
// metres from then on: the ring's radius sets the scale of everything else.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hullMaterial, boxProjectUVs, sideMaterial, splitSides } from './hull.js';

export const RING_FILES = ['ring', 'ring1', 'ring2', 'ring3', 'ring3t', 'ring4', 'ring5', 'ring5t', 'ring7'];
export const PART_FILES = [...RING_FILES, 'tower', 'arm1', 'arm2', 'hangar', 'hangar2', 'satellite', 'fighter', 'ship1', 'ship2', 'freighter'];
// Parts modelled with their mouth or nose along +z are turned at load so they lie along +x like the
// rest of the kit (long axis outward, the hangar's back toward the arm).
const TURN_TO_X = { hangar2: true, ship1: true };      // ship2 already lies along +x, nose at +x (it was parked sideways while it was turned too)
// The inside of each hangar model, measured in its own units after that turn: where the deck is,
// how far in the back wall is and how far out the mouth, and the half width between the side
// walls. A fighter is parked on the deck by these.
export const BAYS = {
  hangar2: { deckY: 0.142, back: -0.177, mouth: 0.21, halfWidth: 0.245 },
};
// What else stands on a hangar's deck, the same in the station's hangars and in the human-scale
// one, so the cut from outside to inside changes nothing: the two ship2 fighters at the back,
// either side, noses to the mouth. `along` is the fraction of the way from the back wall to the
// mouth, `side` the fraction of the half width (negative to the right of the mouth's view), and
// `length` a multiple of the deck fighter's length.
export const PARKED = [
  { kind: 'ship2a', along: 0.16, side: -0.66, length: 1.15, turn: 0 },     // noses out of the mouth
  { kind: 'ship2b', along: 0.16, side: 0.66, length: 1.15, turn: 0 },
];
export const G = 9.81;

export const DEFAULT_LAYOUT = {
  // Jacob's station, as he set it in the builder (2026-09-20)
  // which ring model, and what covers it: 'auto' keeps a part's own texture and gives a bare part
  // the generated panel hull; 'panels' puts the hull on any ring; 'texture' shows the part as it is
  ringModel: 'ring5t',    // the newest ring (ring5 with its Tripo texture)
  ringSurface: 'auto',
  panelMetres: 600,       // how wide one tile of the panel hull is on the surface
  sideMetres: 50,         // how wide one repeat of the side-face window tile is
  ringRadius: 780,        // metres, to the outside of the rim
  rings: 1,
  ringGap: 1500,          // metres between rings, when there is more than one
  ringY: 900,             // metres, first ring above the tower's middle
  hubCut: 0,              // cut the ring's middle inside this fraction of its radius
  collar: false,
  collarAuto: false,
  collarRadius: 120,      // metres
  collarLength: 1100,     // metres, the cylinder the rings turn on
  towerHeight: 1620,      // metres (the tower part is about 0.4 as wide as it is tall)
  towerFlip: true,        // the tower part upside down: its wide end at the top, above the ring
  // arms mounted on the ring, which turn with it
  ringArms: { count: 8, kind: 'arm2', scale: 500, inset: -200, y: 0, tilt: 0 },
  // arms out from the tower, which stay put; every nth one carries a hangar on its end
  towerArms: { count: 6, kind: 'arm1', radius: 220, y: 360, scale: 650, tilt: 0 },
  hangars: { every: 2, scale: 250, y: -26, side: -5, reach: 0 },   // nudges in metres on top of the measured fit
  hangarModel: 'hangar2',
  // one fighter parked on the deck of every hangar: its length as a fraction of the hangar's
  // width, and where it stands between the back wall (0) and the mouth (1)
  fighterModel: 'ship1',
  bay: { length: 0.2, along: 0.45 },
  // solar panels mounted on the tower, standing out from it like wings
  panels: { count: 4, y: -550, scale: 940, tilt: 0, radius: 250 },
  // a few free-flying craft, off by default
  satellites: { count: 0, radius: 4900, scale: 120, seed: 7 },
  // traffic: fighters parked around the hangars, freighters standing off the station
  fighters: { count: 0, radius: 200, y: -1200, scale: 10 },
  freighters: { count: 0, radius: 2500, y: 200, scale: 260 },   // nothing parked in space: traffic flies by on the intro's timeline
  spin: true,
  timeScale: 1,
};

// Measured from the geometry, which already carries the part's own transform: measuring the mesh
// instead would apply that transform a second time (it made the tower twice its size, and rotated).
function measure(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox.clone();
  return { box, size: box.getSize(new THREE.Vector3()), centre: box.getCenter(new THREE.Vector3()) };
}

// The centre and outer radius of a flat, round part, from a circle fitted to its outer shell. The
// bounding box will not do: masts and pods pull it off the axis the part actually turns about, and
// everything else here (where the ring sits, where its middle is cut away) is measured from this.
function rimCircle(geometry) {
  const p = geometry.attributes.position, n = p.count;
  let gx = 0, gz = 0;
  for (let i = 0; i < n; i++) { gx += p.getX(i); gz += p.getZ(i); }
  gx /= n; gz /= n;
  const r = [];
  for (let i = 0; i < n; i++) r.push(Math.hypot(p.getX(i) - gx, p.getZ(i) - gz));
  const sorted = [...r].sort((a, b) => a - b);
  const cut = sorted[Math.floor(n * 0.88)];
  // least squares circle through the outer shell
  let Sxx = 0, Sxz = 0, Szz = 0, Sx = 0, Sz = 0, Sxb = 0, Szb = 0, Sb = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (r[i] < cut) continue;
    const x = p.getX(i), z = p.getZ(i), b = x * x + z * z;
    Sxx += x * x; Sxz += x * z; Szz += z * z; Sx += x; Sz += z; Sxb += x * b; Szb += z * b; Sb += b; m++;
  }
  const A = [[2 * Sxx, 2 * Sxz, Sx], [2 * Sxz, 2 * Szz, Sz], [2 * Sx, 2 * Sz, m]];
  const rhs = [Sxb, Szb, Sb];
  // 3x3 solve
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const solve = (col) => {
    const M = A.map((row, i) => row.map((v, j) => (j === col ? rhs[i] : v)));
    return (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) / det;
  };
  const cx = det ? solve(0) : gx, cz = det ? solve(1) : gz;
  let radius = 0;
  for (let i = 0; i < n; i++) radius = Math.max(radius, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz));
  return { x: cx, z: cz, radius };
}

// A copy of the ring without its middle: the tower and collar fill that space, and two surfaces in
// the same place flicker against each other.
function cutHub(geometry, fraction, rim, centre) {
  if (fraction <= 0) return geometry;
  const limit = fraction * rim;
  const pos = geometry.attributes.position, idx = geometry.index;
  const keep = [];
  const n = idx ? idx.count : pos.count;
  const mid = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    mid.set((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - centre.x, 0, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - centre.z);
    if (Math.hypot(mid.x, mid.z) >= limit) keep.push(a, b, c);
  }
  const out = geometry.clone();
  out.setIndex(keep);
  return out;
}

// The height of the ring's deck: the middle of its rim, not of its bounding box, which is dragged
// upward by the masts. This is the plane the ring should turn in.
function deckHeight(geometry, rim) {
  const p = geometry.attributes.position, ys = [];
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i));
    if (r > rim * 0.82 && r < rim * 0.99) ys.push(p.getY(i));
  }
  ys.sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : 0;
}

// The radius of the tower's central column, as a fraction of its height: the bounding box is much
// wider, because booms and dishes stick out, and a collar sized to that swallows the whole tower.
function coreFraction(geometry) {
  const p = geometry.attributes.position;
  geometry.computeBoundingBox();
  const lo = geometry.boundingBox.min.y, hi = geometry.boundingBox.max.y, h = hi - lo;
  const r = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > lo + 0.35 * h && y < lo + 0.65 * h) r.push(Math.hypot(p.getX(i), p.getZ(i)));
  }
  r.sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length * 0.75)] / h : 0.1;
}

// The middle of one end of a part: the median of the vertices in the last 6% of its long axis.
function endFace(part, axis, end) {
  const pos = part.geometry.attributes.position, lo = part.box.min[axis], hi = part.box.max[axis];
  const get = 'get' + axis.toUpperCase(), ys = [], zs = [], xs = [];
  for (let i = 0; i < pos.count; i++) {
    const v = pos[get](i);
    if (end === 'max' ? v > hi - 0.06 * (hi - lo) : v < lo + 0.06 * (hi - lo)) { xs.push(pos.getX(i)); ys.push(pos.getY(i)); zs.push(pos.getZ(i)); }
  }
  const med = (a) => { a.sort((u, w) => u - w); return a.length ? a[a.length >> 1] : 0; };
  return new THREE.Vector3(med(xs), med(ys), med(zs));
}

export async function loadKit(base = '../../models/kit/', onProgress) {
  const loader = new GLTFLoader();
  const loaded = {}, totals = {};
  const report = () => {
    if (!onProgress) return;
    const t = Object.values(totals).reduce((a, b) => a + b, 0);
    if (t) onProgress(Object.values(loaded).reduce((a, b) => a + b, 0) / t);
  };
  const parts = {};
  await Promise.all(PART_FILES.map(name => new Promise((res, rej) => {
    loader.load(`${base}${name}.glb`, (gltf) => {
      let mesh = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
      mesh.geometry.applyMatrix4(mesh.matrixWorld);
      if (TURN_TO_X[name]) mesh.geometry.rotateY(Math.PI / 2);
      mesh.geometry.computeVertexNormals();
      const mat = mesh.material;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.metalness = 0.35; mat.roughness = 0.62;
      parts[name] = { geometry: mesh.geometry, material: mat, ...measure(mesh.geometry) };
      res();
    }, (e) => { loaded[name] = e.loaded; totals[name] = e.total || totals[name] || 0; report(); }, rej);
  })));
  // ship2 came as two of the same fighter stacked, one canopy shut and one open: split into ship2a
  // (shut, the lower) and ship2b (open), each stood on y = 0 and centred
  if (parts.ship2) {
    const g = parts.ship2.geometry, pos = g.attributes.position;
    const pick = (keep) => {
      const src = g.index ? g.toNonIndexed() : g, sp = src.attributes.position, sn = src.attributes.normal, su = src.attributes.uv, idx = [];
      for (let i = 0; i < sp.count; i += 3) { const y = (sp.getY(i) + sp.getY(i + 1) + sp.getY(i + 2)) / 3; if (keep(y)) idx.push(i, i + 1, i + 2); }
      const out = new THREE.BufferGeometry(), P = new Float32Array(idx.length * 3), N = new Float32Array(idx.length * 3), U = su ? new Float32Array(idx.length * 2) : null;
      idx.forEach((k, j) => { P[j * 3] = sp.getX(k); P[j * 3 + 1] = sp.getY(k); P[j * 3 + 2] = sp.getZ(k); N[j * 3] = sn.getX(k); N[j * 3 + 1] = sn.getY(k); N[j * 3 + 2] = sn.getZ(k); if (U) { U[j * 2] = su.getX(k); U[j * 2 + 1] = su.getY(k); } });
      out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      out.computeBoundingBox(); const b = out.boundingBox, c = b.getCenter(new THREE.Vector3());
      out.translate(-c.x, -b.min.y, -c.z);
      return out;
    };
    const cut = (parts.ship2.box.min.y + parts.ship2.box.max.y) / 2 - 0.05;
    for (const [name, keep] of [['ship2a', y => y < cut], ['ship2b', y => y >= cut]]) {
      const geo = pick(keep); parts[name] = { geometry: geo, material: parts.ship2.material, ...measure(geo) };
    }
  }
  for (const k of RING_FILES) if (parts[k]) { parts[k].circle = rimCircle(parts[k].geometry); parts[k].rim = parts[k].circle.radius; }
  // Where the parts meet: the middle of an arm's far end, and the middle of the hangar's back face,
  // in the part's own units. The hangar hangs off the arm's tip, and its back is not centred on
  // its base, so placing both by their origins left every hangar low and off to one side.
  for (const k of ['arm1', 'arm2']) if (parts[k]) parts[k].tip = endFace(parts[k], k === 'arm2' ? 'z' : 'x', 'max');
  for (const k of ['hangar', 'hangar2']) if (parts[k]) parts[k].back = endFace(parts[k], 'x', 'min');
  for (const k of RING_FILES) if (parts[k]) parts[k].deckY = deckHeight(parts[k].geometry, parts[k].rim);
  parts.tower.coreFraction = coreFraction(parts.tower.geometry);
  return parts;
}

export class StationKit extends THREE.Group {
  constructor(parts) {
    super();
    this.parts = parts;
    this.spinners = [];          // the rings, each with its own turn rate
    this.built = new THREE.Group();
    this.add(this.built);
    this.collarMaterial = new THREE.MeshStandardMaterial({ color: 0x4e565f, metalness: 0.65, roughness: 0.45 });
    this.layout = { ...DEFAULT_LAYOUT };
    this.lampMeshes = [];        // the unique (non-repeated) meshes, where hull lamps can go
  }

  // metres per unit of the ring part, which sets the scale of the whole station
  get ringPart() { return this.parts[this.layout.ringModel] || this.parts.ring; }
  get scale1() { return this.layout.ringRadius / this.ringPart.rim; }

  build(layout = this.layout) {
    this.layout = layout;
    for (const child of [...this.built.children]) {
      this.built.remove(child);
      child.traverse?.(o => { if (o.isMesh && o.geometry && o.geometry.userData.temp) o.geometry.dispose(); });
    }
    this.spinners = []; this.lampMeshes = [];
    const L = layout, S = this.scale1, P = this.parts;

    // TOWER, on the axis, its middle at the origin
    const tower = new THREE.Mesh(P.tower.geometry, P.tower.material);
    const towerScale = L.towerHeight / P.tower.size.y;
    tower.scale.setScalar(towerScale);
    // flipped, the part turns over about its own middle, so its centre lands in the same place
    tower.rotation.x = L.towerFlip ? Math.PI : 0;
    tower.position.set(-P.tower.centre.x * towerScale, (L.towerFlip ? 1 : -1) * L.towerHeight / 2, (L.towerFlip ? 1 : -1) * P.tower.centre.z * towerScale);
    tower.castShadow = tower.receiveShadow = true;
    this.built.add(tower); this.lampMeshes.push(tower);

    // COLLAR, the cylinder the rings turn on. It runs past them at both ends so the join reads as a
    // mounting, not a gap.
    if (L.collar) {
      const core = P.tower.coreFraction * L.towerHeight;
      const radius = L.collarAuto === false ? L.collarRadius : core * 1.15;
      const span = (L.rings - 1) * L.ringGap;
      const length = L.collarAuto === false ? L.collarLength : span + L.ringRadius * 0.55;
      const geo = new THREE.CylinderGeometry(radius, radius, length, 48, 1);
      geo.userData.temp = true;
      const collar = new THREE.Mesh(geo, this.collarMaterial);
      collar.position.y = L.ringY + (L.rings - 1) * L.ringGap / 2;
      collar.castShadow = collar.receiveShadow = true;
      // no lamps on the collar: it is a plain cylinder, and a row of glows on it reads as a lit tube
      this.built.add(collar);
    }

    // RINGS, each on its own turntable so they can spin at their own rate.
    const RP = this.ringPart;
    let ringGeo = cutHub(RP.geometry, L.hubCut, RP.rim, RP.circle);
    ringGeo.userData.temp = L.hubCut > 0;
    // the surface: the part's own texture, or the generated panel hull projected onto it in metres;
    // or the two flat side faces carry the window tile and only the rim keeps the part's own
    const bare = !RP.material.map;
    const panels = L.ringSurface === 'panels' || (L.ringSurface !== 'texture' && L.ringSurface !== 'tile' && bare);
    const pieces = [];                                   // [geometry, material] pairs making up the ring
    if (L.ringSurface === 'tile') {
      const { side, rest } = splitSides(ringGeo, S, L.sideMetres || 70);
      pieces.push([side, sideMaterial()]);
      pieces.push(bare ? [boxProjectUVs(rest, S, L.panelMetres || 220), hullMaterial()] : [rest, RP.material]);
    } else if (panels) pieces.push([boxProjectUVs(ringGeo, S, L.panelMetres || 220), hullMaterial()]);
    else pieces.push([ringGeo, RP.material]);
    for (let i = 0; i < L.rings; i++) {
      const turntable = new THREE.Group();
      turntable.position.y = L.ringY + i * L.ringGap;
      const ring = new THREE.Group();
      for (const [geo, mat] of pieces) {
        const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; ring.add(m);
      }
      ring.scale.setScalar(S);
      // stand it on the axis its rim turns about, not the middle of its bounding box
      ring.position.set(-RP.circle.x * S, -RP.deckY * S, -RP.circle.z * S);
      turntable.add(ring);
      // arms on the ring: mounted just inside the rim, pointing outward, turning with it
      const RA = L.ringArms;
      if (RA.count) this.addRing(turntable, RA.kind, RA.count, L.ringRadius - RA.inset, RA.y, RA.scale, RA.tilt);
      this.built.add(turntable);
      this.spinners.push({ turntable, radius: L.ringRadius, sign: i % 2 ? -1 : 1 });
      this.lampMeshes.push(ring.children[0]);
    }

    // ARMS on the tower, which stay put, with a hangar on the end of every nth one
    const TA = L.towerArms;
    this.addRing(this.built, TA.kind, TA.count, TA.radius, TA.y, TA.scale, TA.tilt);
    const hangarKind = P[L.hangarModel] ? L.hangarModel : 'hangar';
    this.hangars = [];                                   // each hangar's matrix in the station's frame, its mouth along its local +x
    if (L.hangars.every > 0 && TA.count && P[hangarKind]) {
      const H = P[hangarKind];
      const arm = P[TA.kind], armUnit = TA.scale / (TA.kind === 'arm2' ? arm.size.z : arm.size.x), hUnit = L.hangars.scale / H.size.x;
      const tip = arm.tip || new THREE.Vector3(), back = H.back || new THREE.Vector3();
      // the hangar's back face meets the arm's tip: same height, same line, a little overlap
      const reach = TA.radius + TA.scale / 2 + L.hangars.scale * 0.45 + (L.hangars.reach || 0);
      const y = TA.y + tip.y * armUnit - back.y * hUnit + (L.hangars.y || 0);
      const side = -back.z * hUnit + (L.hangars.side || 0);
      const angles = [];
      for (let i = 0; i < TA.count; i += L.hangars.every) angles.push((i / TA.count) * Math.PI * 2);
      const hangars = this.addRing(this.built, hangarKind, angles.length, reach, y, L.hangars.scale, 0, angles, side);
      for (let i = 0; i < angles.length; i++) { const m = new THREE.Matrix4(); hangars.getMatrixAt(i, m); this.hangars.push(m); }
      this.hangarUnit = hUnit;
      // a fighter on every deck, nose to the mouth
      const bay = BAYS[hangarKind], fighterKind = P[L.fighterModel] ? L.fighterModel : null;
      if (bay && fighterKind && L.bay) {
        const F = P[fighterKind];
        const k = (L.bay.length * H.size.x) / F.size.x;                    // fighter units per hangar unit
        const mesh = new THREE.InstancedMesh(F.geometry, F.material, this.hangars.length);
        mesh.castShadow = mesh.receiveShadow = true;
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(bay.back + (bay.mouth - bay.back) * L.bay.along, bay.deckY - F.box.min.y * k, 0),
          new THREE.Quaternion(), new THREE.Vector3(k, k, k));
        this.hangars.forEach((hm, i) => mesh.setMatrixAt(i, hm.clone().multiply(local)));
        mesh.instanceMatrix.needsUpdate = true;
        this.built.add(mesh);
        this.bayLocal = local;                             // where the fighter sits inside a hangar, in hangar units
        // and the parked ships, the same on every deck
        for (const pk of PARKED) {
          const Q = P[pk.kind]; if (!Q) continue;
          const kk = (pk.length * L.bay.length * H.size.x) / Q.size.x;
          const pm = new THREE.InstancedMesh(Q.geometry, Q.material, this.hangars.length);
          pm.castShadow = pm.receiveShadow = true;
          const pl = new THREE.Matrix4().compose(
            new THREE.Vector3(bay.back + (bay.mouth - bay.back) * pk.along, bay.deckY - Q.box.min.y * kk, -pk.side * bay.halfWidth),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(pk.turn || 0)), new THREE.Vector3(kk, kk, kk));
          this.hangars.forEach((hm, i) => pm.setMatrixAt(i, hm.clone().multiply(pl)));
          pm.instanceMatrix.needsUpdate = true;
          this.built.add(pm);
        }
      }
    }
    // SOLAR PANELS on the tower: at the tower's surface unless pushed further out
    const PA = L.panels;
    if (PA.count) {
      const core = P.tower.coreFraction * L.towerHeight;
      this.addRing(this.built, 'satellite', PA.count, PA.radius || core + PA.scale / 2, PA.y, PA.scale, PA.tilt);
    }
    // TRAFFIC: fighters parked around the station, freighters standing off it
    if (L.fighters?.count) this.addRing(this.built, 'fighter', L.fighters.count, L.fighters.radius, L.fighters.y, L.fighters.scale, 0);
    if (L.freighters?.count) this.addRing(this.built, 'freighter', L.freighters.count, L.freighters.radius, L.freighters.y, L.freighters.scale, 0);
    this.addSatellites(L.satellites);
    return this;
  }

  // `count` copies of a part standing out from the axis, each turned to face outward. `parent` is
  // the built group for anything fixed, or a ring's turntable for parts that turn with it.
  addRing(parent, kind, count, radius, y, scale, tiltDeg, angles = null, side = 0) {
    if (!count || !this.parts[kind]) return;
    const part = this.parts[kind];
    const along = kind === 'arm2' ? 'z' : 'x';                    // which way the part is long
    const unit = scale / (along === 'z' ? part.size.z : part.size.x);
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
    mesh.castShadow = mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), sc = new THREE.Vector3(unit, unit, unit);
    for (let i = 0; i < count; i++) {
      const a = angles ? angles[i] : (i / count) * Math.PI * 2;
      // local +x (or +z) points away from the axis
      // turned to point outward, then tilted about its own crosswise axis, so a positive tilt
      // lifts every arm the same way whichever direction it points (tilting about the world's x
      // lifted some and dropped others)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), along === 'z' ? a : a - Math.PI / 2);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(along === 'z' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(tiltDeg) * (along === 'z' ? -1 : 1)));
      pos.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
      if (side) pos.add(new THREE.Vector3(-Math.cos(a), 0, Math.sin(a)).multiplyScalar(side));   // along the part's own z, sideways
      mesh.setMatrixAt(i, m.compose(pos, q, sc));
    }
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  }

  addSatellites({ count, radius, scale, seed }) {
    if (!count) return;
    const part = this.parts.satellite;
    const unit = scale / part.size.x;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
    let s = seed >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, h = (rand() - 0.5) * 1.2, r = radius * (0.7 + rand() * 0.6);
      pos.set(Math.sin(a) * r, h * radius * 0.5, Math.cos(a) * r);
      e.set(rand() * 0.6 - 0.3, rand() * Math.PI * 2, rand() * 0.6 - 0.3);
      const k = unit * (0.7 + rand() * 0.6);
      mesh.setMatrixAt(i, m.compose(pos, q.setFromEuler(e), sc.set(k, k, k)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.built.add(mesh);
  }

  // Seconds per turn for one gravity at a given radius, and the speed of the rim.
  static get BAYS() { return BAYS; }
  static period(radius) { return 2 * Math.PI * Math.sqrt(radius / G); }
  static rimSpeed(radius) { return Math.sqrt(G * radius); }

  update(dt) {
    if (!this.layout.spin) return;
    for (const s of this.spinners) {
      s.turntable.rotation.y += s.sign * dt * this.layout.timeScale * (2 * Math.PI / StationKit.period(s.radius));
    }
  }
}
