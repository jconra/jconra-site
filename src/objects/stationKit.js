// STATION KIT. A station built from separate Tripo parts instead of one model: a tower on the axis,
// one or more rings turning around it on a collar, arms and hangars repeated around the ring, and
// satellites scattered outside. Every repeated part is one instanced draw, so twelve arms cost about
// the same as one.
//
// Each part arrives with its own size and facing, so the kit measures every one at load and works in
// metres from then on: the ring's radius sets the scale of everything else.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PART_FILES = ['ring', 'tower', 'arm1', 'arm2', 'hangar', 'satellite'];
export const G = 9.81;

export const DEFAULT_LAYOUT = {
  ringRadius: 600,        // metres, to the outside of the rim
  rings: 1,
  ringGap: 420,           // metres between rings, when there is more than one
  ringY: 0,               // metres, first ring above the tower's middle
  hubCut: 0.22,           // cut the ring's middle inside this fraction of its radius
  collar: true,
  collarRadius: 90,       // metres
  collarLength: 900,      // metres, the cylinder the rings turn on
  towerHeight: 1800,      // metres
  // arms mounted on the ring, which turn with it
  ringArms: { count: 8, kind: 'arm2', scale: 260, inset: 40, y: -40, tilt: 0 },
  // arms out from the tower, which stay put; every nth one carries a hangar on its end
  towerArms: { count: 6, kind: 'arm1', radius: 300, y: -420, scale: 460, tilt: 0 },
  hangars: { every: 2, scale: 240 },
  satellites: { count: 14, radius: 1400, scale: 120, seed: 7 },
  spin: true,
  timeScale: 1,
};

function measure(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  return { box, size, centre };
}

// The outer radius of a flat, round part, ignoring the few points that stick out furthest.
function rimRadius(geometry) {
  const p = geometry.attributes.position, r = [];
  for (let i = 0; i < p.count; i++) r.push(Math.hypot(p.getX(i), p.getZ(i)));
  r.sort((a, b) => a - b);
  return r[Math.floor(r.length * 0.99)];
}

// A copy of the ring without its middle: the tower and collar fill that space, and two surfaces in
// the same place flicker against each other.
function cutHub(geometry, fraction, rim) {
  if (fraction <= 0) return geometry;
  const limit = fraction * rim;
  const pos = geometry.attributes.position, idx = geometry.index;
  const keep = [];
  const n = idx ? idx.count : pos.count;
  const mid = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    mid.set((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, 0, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3);
    if (Math.hypot(mid.x, mid.z) >= limit) keep.push(a, b, c);
  }
  const out = geometry.clone();
  out.setIndex(keep);
  return out;
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
      mesh.geometry.computeVertexNormals();
      const mat = mesh.material;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.metalness = 0.35; mat.roughness = 0.62;
      parts[name] = { geometry: mesh.geometry, material: mat, ...measure(mesh) };
      res();
    }, (e) => { loaded[name] = e.loaded; totals[name] = e.total || totals[name] || 0; report(); }, rej);
  })));
  parts.ring.rim = rimRadius(parts.ring.geometry);
  return parts;
}

export class StationKit extends THREE.Group {
  constructor(parts) {
    super();
    this.parts = parts;
    this.spinners = [];          // the rings, each with its own turn rate
    this.built = new THREE.Group();
    this.add(this.built);
    this.collarMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.45, roughness: 0.5 });
    this.layout = { ...DEFAULT_LAYOUT };
    this.lampMeshes = [];        // the unique (non-repeated) meshes, where hull lamps can go
  }

  // metres per unit of the ring part, which sets the scale of the whole station
  get scale1() { return this.layout.ringRadius / this.parts.ring.rim; }

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
    tower.position.set(-P.tower.centre.x * towerScale, -L.towerHeight / 2, -P.tower.centre.z * towerScale);
    tower.castShadow = tower.receiveShadow = true;
    this.built.add(tower); this.lampMeshes.push(tower);

    // COLLAR, the cylinder the rings turn on. It runs past them at both ends so the join reads as a
    // mounting, not a gap.
    if (L.collar) {
      const geo = new THREE.CylinderGeometry(L.collarRadius, L.collarRadius, L.collarLength, 48, 1);
      geo.userData.temp = true;
      const collar = new THREE.Mesh(geo, this.collarMaterial);
      collar.position.y = L.ringY + (L.rings - 1) * L.ringGap / 2;
      collar.castShadow = collar.receiveShadow = true;
      this.built.add(collar); this.lampMeshes.push(collar);
    }

    // RINGS, each on its own turntable so they can spin at their own rate
    const ringGeo = cutHub(P.ring.geometry, L.hubCut, P.ring.rim);
    ringGeo.userData.temp = L.hubCut > 0;
    for (let i = 0; i < L.rings; i++) {
      const turntable = new THREE.Group();
      turntable.position.y = L.ringY + i * L.ringGap;
      const ring = new THREE.Mesh(ringGeo, P.ring.material);
      ring.scale.setScalar(S);
      ring.position.set(-P.ring.centre.x * S, -P.ring.centre.y * S, -P.ring.centre.z * S);
      ring.castShadow = ring.receiveShadow = true;
      turntable.add(ring);
      // arms on the ring: mounted just inside the rim, pointing outward, turning with it
      const RA = L.ringArms;
      if (RA.count) this.addRing(turntable, RA.kind, RA.count, L.ringRadius - RA.inset, RA.y, RA.scale, RA.tilt);
      this.built.add(turntable);
      this.spinners.push({ turntable, radius: L.ringRadius, sign: i % 2 ? -1 : 1 });
      this.lampMeshes.push(ring);
    }

    // ARMS on the tower, which stay put, with a hangar on the end of every nth one
    const TA = L.towerArms;
    this.addRing(this.built, TA.kind, TA.count, TA.radius, TA.y, TA.scale, TA.tilt);
    if (L.hangars.every > 0 && TA.count) {
      const reach = TA.radius + TA.scale / 2 + L.hangars.scale * 0.45;
      const angles = [];
      for (let i = 0; i < TA.count; i += L.hangars.every) angles.push((i / TA.count) * Math.PI * 2);
      this.addRing(this.built, 'hangar', angles.length, reach, TA.y, L.hangars.scale, 0, angles);
    }
    this.addSatellites(L.satellites);
    return this;
  }

  // `count` copies of a part standing out from the axis, each turned to face outward. `parent` is
  // the built group for anything fixed, or a ring's turntable for parts that turn with it.
  addRing(parent, kind, count, radius, y, scale, tiltDeg, angles = null) {
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
      e.set(THREE.MathUtils.degToRad(tiltDeg), along === 'z' ? a : a - Math.PI / 2, 0);
      q.setFromEuler(e);
      pos.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
      mesh.setMatrixAt(i, m.compose(pos, q, sc));
    }
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
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
  static period(radius) { return 2 * Math.PI * Math.sqrt(radius / G); }
  static rimSpeed(radius) { return Math.sqrt(G * radius); }

  update(dt) {
    if (!this.layout.spin) return;
    for (const s of this.spinners) {
      s.turntable.rotation.y += s.sign * dt * this.layout.timeScale * (2 * Math.PI / StationKit.period(s.radius));
    }
  }
}
