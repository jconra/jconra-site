// FOLIAGE SHAPE: light a tree's leaf cards by how much sky they see through the rest of the tree, not
// each card by its own facing. A card on its own is a flat picture turned any which way, so lit by itself
// the tree reads as thousands of flickering cards. Lit this way, the top of every branch tier sees open sky
// (bright, a touch yellower) and its underside sees only the leaves above (dark, a little greyer), so the
// tree reads as stacked lumps, which is how stylised trees look good with few triangles.
//
// How: the leaves are smeared into a soft cloud (a 3D grid marking where there are leaves, blurred by
// `lump`). From each corner of each card, rays go out in 14 directions (mostly skyward) through the cloud:
//   - how much light gets through, sky-weighted, is how much the corner sees: few rays through, dark;
//   - the average of the open directions is its normal (the way the light reaches it), mixed with its own.
// The branches get the darkening too, so wood hanging under the foliage goes dark as it should.
// Worked out once per tree type at load: no extra triangles, no pictures. The imposters are baked from
// the same normals and colours, so far-off trees get it too.
//
//   shapeFoliage(root, unit, settings) -> { leaves, ms, grid }   root: the tree (as loaded); unit: metres per model unit
//   settings: SHAPE_DEFAULTS, any of them
import * as THREE from 'three';

// (a starting point from the Foliage Lab, measured against Jacob's reference front-, side- and back-lit, 2026-10-02)
export const SHAPE_DEFAULTS = {
  lump: 0.65,      // how soft the cloud is (m): small, each sprig counts on its own; big, branches merge into masses
  mix: 0.95,       // how far each card's normal turns to the way its light comes from (0: its own, 1: all the light's)
  dark: 0.9,       // how dark a corner that sees no sky gets (0: not at all)
  tip: 0.6,        // how much lighter and yellower the tops in open sky get
  olive: 0.6,      // all the leaves turned from pure green toward olive (0: as they are)
  branchDark: 0.95, // the branches darkened too, by this share of `dark`
  under: 0.5,      // (forest material) a sprig seen from underneath, darker by this much
  glow: 0.5,       // (forest material) sunlight through the outer leaves when you look toward the sun
  soften: 0.3,     // (forest species) the normals bent this far toward straight up, on top
};

// the directions the rays go: straight up, two rings round the sky, one just under the horizon; and
// how much each counts (the sky above matters most, the ground below little)
const DIRS = [];
{ const ring = (n, el, off) => { for (let k = 0; k < n; k++) { const a = (k + off) / n * Math.PI * 2; DIRS.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el))); } };
  DIRS.push(new THREE.Vector3(0, 1, 0)); ring(5, 1.0, 0); ring(5, 0.35, 0.5); ring(3, -0.3, 0.25); }
const WEIGHT = DIRS.map((d) => Math.max(0.12, 0.45 + 0.55 * d.y));

const isLeaves = (o) => o.isMesh && !Array.isArray(o.material) && (o.material.alphaTest > 0 || /lea[fv]/i.test(o.material.name || ''));

export function shapeFoliage(root, unit, settings = {}) {
  const t0 = performance.now(), S = { ...SHAPE_DEFAULTS, ...settings };
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const leaves = [], branches = [], seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    if (seen.has(o.geometry)) o.geometry = o.geometry.clone();          // two meshes sharing one geometry: each its own (the shade depends on where it stands)
    seen.add(o.geometry);
    (isLeaves(o) ? leaves : branches).push(o);
  });
  if (!leaves.length) return { leaves: 0, ms: 0 };
  const local = (o) => { m.multiplyMatrices(toRoot, o.matrixWorld); const p = o.geometry.attributes.position, out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; } return out; };
  const leafPts = leaves.map(local), woodPts = branches.map(local);
  const box = new THREE.Box3();
  for (const a of leafPts) for (let i = 0; i < a.length; i += 3) box.expandByPoint(v.set(a[i], a[i + 1], a[i + 2]));
  // the grid: cells a third of a lump across, at most ~700,000 of them, with a margin all round
  const lumpU = Math.max(1e-4, S.lump / unit);
  box.expandByScalar(lumpU * 1.5);
  const ext = box.getSize(new THREE.Vector3());
  let cell = lumpU / 3; const cap = 700000;
  if ((ext.x / cell + 2) * (ext.y / cell + 2) * (ext.z / cell + 2) > cap) cell = Math.cbrt(ext.x * ext.y * ext.z / cap) * 1.05;
  const nx = Math.ceil(ext.x / cell) + 2, ny = Math.ceil(ext.y / cell) + 2, nz = Math.ceil(ext.z / cell) + 2, D = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => (k * ny + j) * nx + i;
  for (const a of leafPts) for (let n = 0; n < a.length; n += 3) {          // each corner spread over its 8 nearest cells
    const gx = (a[n] - box.min.x) / cell, gy = (a[n + 1] - box.min.y) / cell, gz = (a[n + 2] - box.min.z) / cell;
    const i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz), u = gx - i, w = gy - j, s = gz - k;
    for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2;
      D[id(i + di, j + dj, k + dk)] += (di ? u : 1 - u) * (dj ? w : 1 - w) * (dk ? s : 1 - s); }
  }
  // where there are leaves, not how many: each cell capped at a 'full' cell (the median of the cells with
  // leaves in), so a crowded crown counts as solid as the rest of the tree, no more
  { const filled = []; for (let q = 0; q < D.length; q++) if (D[q] > 0.05) filled.push(D[q]);
    filled.sort((a, b) => a - b); const full = Math.max(1e-6, filled[Math.floor(filled.length / 2)] || 1);
    for (let q = 0; q < D.length; q++) D[q] = Math.min(1, D[q] / full); }
  // blurred by a lump: three box blurs along each axis (close to a smooth bell)
  const r = Math.max(1, Math.round(lumpU / cell / 1.7)), tmp = new Float32Array(Math.max(nx, ny, nz));
  const blurAxis = (len, stride, starts) => {
    for (let pass = 0; pass < 3; pass++) for (const b of starts) {
      let sum = 0; for (let t = -r; t <= r; t++) sum += t >= 0 && t < len ? D[b + t * stride] : 0;
      for (let t = 0; t < len; t++) { tmp[t] = sum / (2 * r + 1); const add = t + r + 1, sub = t - r; if (add < len) sum += D[b + add * stride]; if (sub >= 0) sum -= D[b + sub * stride]; }
      for (let t = 0; t < len; t++) D[b + t * stride] = tmp[t];
    }
  };
  { const sx = [], sy = [], sz = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) sx.push(id(0, j, k));
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) sy.push(id(i, 0, k));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sz.push(id(i, j, 0));
    blurAxis(nx, 1, sx); blurAxis(ny, nx, sy); blurAxis(nz, nx * ny, sz); }
  const at = (x, y, z) => {                                               // the cloud at a spot (smoothly between cells; 0 outside)
    const gx = (x - box.min.x) / cell, gy = (y - box.min.y) / cell, gz = (z - box.min.z) / cell;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= nx - 1 || gy >= ny - 1 || gz >= nz - 1) return 0;
    const i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz), u = gx - i, w = gy - j, s = gz - k;
    let d = 0; for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2; d += D[id(i + di, j + dj, k + dk)] * (di ? u : 1 - u) * (dj ? w : 1 - w) * (dk ? s : 1 - s); }
    return d;
  };
  // the rays: from just off the corner, out through the cloud for a few lumps; light left = e^-(cloud passed)
  const step = Math.max(cell, lumpU / 2), steps = Math.ceil((4 * lumpU + Math.max(ext.x, ext.z) * 0.25) / step), start = lumpU * 0.6;
  const bent = new THREE.Vector3(), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, absorb = 1.6 * step / lumpU;
  const sees = (x, y, z) => {                                             // -> how much sky (0..1); `bent`: the way it comes from
    let lit = 0, all = 0; bent.set(0, 0, 0);
    for (let d = 0; d < DIRS.length; d++) {
      const dir = DIRS[d]; let tau = 0;
      for (let s = 0; s < steps && tau < 6; s++) { const t = start + s * step; tau += at(x + dir.x * t, y + dir.y * t, z + dir.z * t) * absorb * Math.exp(-t / (4 * lumpU)); }   // (near leaves shade more than far ones: stacked tiers keep their gaps)
      const T = Math.exp(-tau) * WEIGHT[d];
      lit += T; all += WEIGHT[d]; bent.addScaledVector(dir, T);
    }
    const seen = lit / all, shut = 1 - smoothstep(0, 0.05, seen);       // shut in on every side: more and more straight out from the trunk
    bent.normalize(); if (shut > 0) bent.lerp(v.set(x - cx, 0.5, z - cz).normalize(), shut).normalize();
    return seen;
  };
  // the colour a corner gets: shut in, darker and a little greyer; in open sky facing up (a tier's top), lighter and
  // yellower; all of it toward olive (the leaves' green is low in blue: raising blue and red greys it toward olive)
  const ol = [1 + 0.15 * S.olive, 1 - 0.08 * S.olive, 1 + 1.2 * S.olive];
  const shade = (seen01, up, isLeaf, base, out, o) => {
    const shut = 1 - smoothstep(0.02, 0.85, seen01), dk = 1 - S.dark * (isLeaf ? 1 : S.branchDark) * shut;
    const open = isLeaf ? S.tip * smoothstep(0.4, 0.9, seen01) * smoothstep(-0.1, 0.5, up) : 0, grey = isLeaf ? 0.35 * S.dark * shut : 0;
    const f = [dk * (1 + open * 0.6) * (1 + grey * 0.1), dk * (1 + open * 0.4) * (1 - grey * 0.08), dk * (1 - open * 0.05) * (1 + grey * 0.5)];
    for (let c = 0; c < 3; c++) out[o + c] = (base ? base[o + c] : 1) * f[c] * (isLeaf ? ol[c] : 1);
  };
  const keep = (geo) => {                                                 // the geometry as it came, to start from on every reshape
    if (!geo.userData.base) geo.userData.base = { normal: geo.attributes.normal ? geo.attributes.normal.array.slice() : null, color: geo.attributes.color ? geo.attributes.color.array.slice() : null };
    return geo.userData.base;
  };
  const n = new THREE.Vector3(), nm = new THREE.Matrix3();
  leaves.forEach((o, li) => {
    const geo = o.geometry, a = leafPts[li], count = a.length / 3, base = keep(geo);
    const N = new Float32Array(count * 3), C = new Float32Array(count * 3), K = new Float32Array(count);
    m.multiplyMatrices(toRoot, o.matrixWorld); nm.getNormalMatrix(m); const back = nm.clone().invert();
    for (let i = 0; i < count; i++) {
      const s01 = sees(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      n.set(base.normal[i * 3], base.normal[i * 3 + 1], base.normal[i * 3 + 2]).applyMatrix3(nm).normalize();
      if (n.dot(bent) < 0) n.negate();                                    // a card faces both ways: take the side facing its light
      n.lerp(bent, S.mix).normalize().applyMatrix3(back).normalize();     // back into the mesh's own frame
      N[i * 3] = n.x; N[i * 3 + 1] = n.y; N[i * 3 + 2] = n.z;
      shade(s01, bent.y, true, base.color, C, i * 3); K[i] = s01;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('aSky', new THREE.BufferAttribute(K, 1));          // how much sky it sees, for the forest material's glow
    o.material.vertexColors = true; o.material.needsUpdate = true;
  });
  branches.forEach((o, bi) => {                                           // the wood: only darker where it's shut in
    const geo = o.geometry, a = woodPts[bi], count = a.length / 3, base = keep(geo), C = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { const s01 = sees(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); shade(s01, bent.y, false, base.color, C, i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); o.material.vertexColors = true; o.material.needsUpdate = true;
  });
  return { leaves: leaves.length, ms: performance.now() - t0, grid: [nx, ny, nz] };
}

// the tree back as it came (its own normals and colours)
export function unshapeFoliage(root) {
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const geo = o.geometry, base = geo.userData.base;
    if (!base) return;
    if (base.normal) geo.setAttribute('normal', new THREE.BufferAttribute(base.normal.slice(), 3));
    if (base.color) geo.setAttribute('color', new THREE.BufferAttribute(base.color.slice(), 3));
    else { geo.deleteAttribute('color'); o.material.vertexColors = false; }
    if (geo.attributes.aSky) geo.deleteAttribute('aSky');
    o.material.needsUpdate = true;
  });
}

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
