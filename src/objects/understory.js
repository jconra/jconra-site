// UNDERSTORY. Ferns and low bushes on the forest floor: each plant is two crossed upright quads
// with a cut-out picture, thousands of them instanced, laid out on the same tiles as the trees
// and thinned with distance. Pictures come from textures/ground/fern.png and salal.png (a side
// view of one plant on a transparent background); a drawn stand-in fills in until they exist.
import * as THREE from 'three';

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// a drawn fern / bush, for before the real pictures land
function drawPlant(kind) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  const r = rnd(kind === 'fern' ? 3 : 9);
  if (kind === 'fern') {
    for (let f = 0; f < 9; f++) {
      const a = -Math.PI / 2 + (f - 4) * 0.33 + (r() - 0.5) * 0.15, L = 95 + r() * 40;
      g.strokeStyle = '#3f6b2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 250); g.quadraticCurveTo(128 + Math.cos(a) * L * 0.5, 250 + Math.sin(a) * L * 0.5 - 20, 128 + Math.cos(a) * L, 250 + Math.sin(a) * L); g.stroke();
      for (let k = 0; k < 14; k++) { const t = 0.15 + k / 14 * 0.85, x = 128 + Math.cos(a) * L * t, y = 250 + Math.sin(a) * L * t - 20 * t * (1 - t) * 2, w = (1 - t) * 22 + 4;
        g.fillStyle = ['#4e8a34', '#3a6d26', '#5c9a3c'][k % 3]; g.beginPath(); g.ellipse(x, y, w, 4, a + Math.PI / 2, 0, Math.PI * 2); g.fill(); }
    }
  } else {
    for (let i = 0; i < 70; i++) { const x = 50 + r() * 156, y = 90 + r() * 150, s = 10 + r() * 16;
      g.fillStyle = ['#2f5a2a', '#3e7236', '#4a8040', '#284d24'][Math.floor(r() * 4)]; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * Math.PI, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Understory {
  constructor(scene, { base = '../../textures/ground/', tile = 420, tiles = 5, perTile = 260, reach = 220, clear = null, kinds = null } = {}) {
    Object.assign(this, { scene, base, tile, tiles, perTile, reach, clear });
    this.group = new THREE.Group(); scene.add(this.group);
    this.kinds = kinds || [{ name: 'fern', file: 'fern', height: 1.1, weight: 1.4 }, { name: 'salal', file: 'salal', height: 1.4, weight: 1 }];
    const cap = tiles * tiles * perTile;
    // two crossed quads standing on y = 0
    const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
    const q2 = quad.clone(); q2.rotateY(Math.PI / 2);
    const geo = mergePlanes(quad, q2);
    for (const k of this.kinds) {
      const map = drawPlant(k.name);
      new THREE.TextureLoader().load(`${base}${k.file}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; map.image = t.image; map.needsUpdate = true; }, undefined, () => {});
      const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
      const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      k.mesh = m; this.group.add(m);
    }
    this.tilesLaid = new Map();
  }
  layTile(tx, tz) {
    const r = rnd(tx * 3571 + tz * 7877 + 5), T = this.tile, out = [];
    const total = this.kinds.reduce((a, k) => a + k.weight, 0);
    for (let i = 0; i < this.perTile; i++) {
      const x = tx * T + (r() - 0.5) * T, z = tz * T + (r() - 0.5) * T;
      if (this.clear && this.clear(x, z)) continue;
      let pick = r() * total, kind = this.kinds[0]; for (const k of this.kinds) { pick -= k.weight; if (pick <= 0) { kind = k; break; } }
      out.push({ x, z, yaw: r() * Math.PI * 2, scale: (0.7 + r() * 0.6) * kind.height, tint: 0.75 + r() * 0.35, kind });
    }
    return out;
  }
  // every frame: tiles around `at`, and only the plants within reach of the camera are placed
  update(at, camPos) {
    const T = this.tile, half = (this.tiles - 1) / 2, cx = Math.round(at.x / T), cz = Math.round(at.z / T);
    const want = new Set(); let changed = false;
    for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) { const key = (cx + i) + ',' + (cz + j); want.add(key); if (!this.tilesLaid.has(key)) { this.tilesLaid.set(key, this.layTile(cx + i, cz + j)); changed = true; } }
    for (const key of [...this.tilesLaid.keys()]) if (!want.has(key)) { this.tilesLaid.delete(key); changed = true; }
    if (!changed && this.lastCam && this.lastCam.distanceToSquared(camPos) < 9) return;
    this.lastCam = camPos.clone();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const counts = new Map(this.kinds.map(k => [k, 0]));
    const R2 = this.reach * this.reach;
    for (const list of this.tilesLaid.values()) for (const pl of list) {
      const dx = pl.x - camPos.x, dz = pl.z - camPos.z; if (dx * dx + dz * dz > R2) continue;
      const k = pl.kind, n = counts.get(k); if (n >= k.mesh.instanceMatrix.count) continue;
      p.set(pl.x, 0, pl.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.yaw); s.set(pl.scale, pl.scale, pl.scale);
      k.mesh.setMatrixAt(n, m4.compose(p, q, s)); c.setScalar(pl.tint); k.mesh.setColorAt(n, c); counts.set(k, n + 1);
    }
    for (const k of this.kinds) { k.mesh.count = counts.get(k); k.mesh.instanceMatrix.needsUpdate = true; k.mesh.instanceColor.needsUpdate = true; }
  }
}

function mergePlanes(a, b) {
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]);
  const nrm = new Float32Array([...a.attributes.normal.array, ...b.attributes.normal.array]);
  const uv = new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]);
  const na = a.attributes.position.count, idx = [...a.index.array, ...Array.from(b.index.array, i => i + na)];
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx); return out;
}
