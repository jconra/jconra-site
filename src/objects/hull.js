// HULL SURFACE. A generated, tileable panel skin for parts that arrive without a texture (or whose
// texture is too soft to survive a close-up): plating split into panels by recessed seams, with
// rivets, a few hatches and the odd trim stripe. Colour, normal and roughness maps are drawn once
// on canvases, and the mesh gets box-projected UVs so the seams run straight along the hull in
// metres, whatever UVs the part came with.
import * as THREE from 'three';

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// split the square into panels: a k-d subdivision, so every edge is straight and the tile's own
// border is a seam, which is what makes it repeat without a visible join
function panels(size, rand, depth) {
  const out = [];
  const split = (x, y, w, h, d) => {
    const minSide = size / 9;
    if (d === 0 || (w < minSide * 1.6 && h < minSide * 1.6) || (d < 2 && rand() < 0.08)) { out.push([x, y, w, h]); return; }
    const vertical = w > h ? true : (h > w ? false : rand() < 0.5);
    const t = 0.35 + rand() * 0.3;
    if (vertical) { const c = Math.round(w * t); split(x, y, c, h, d - 1); split(x + c, y, w - c, h, d - 1); }
    else { const c = Math.round(h * t); split(x, y, w, c, d - 1); split(x, y + c, w, h - c, d - 1); }
  };
  split(0, 0, size, size, depth);
  return out;
}

export function makeHullMaps({ size = 1024, seed = 11, base = '#7e858c', trim = '#d9691f' } = {}) {
  const rand = rnd(seed);
  const cells = panels(size, rand, 5);
  const seam = Math.max(2, Math.round(size / 340));

  // COLOUR: plating with slight per-panel tone, seams dark, a few details
  const col = document.createElement('canvas'); col.width = col.height = size;
  const c = col.getContext('2d');
  c.fillStyle = base; c.fillRect(0, 0, size, size);
  for (const [x, y, w, h] of cells) {
    const tone = 0.93 + rand() * 0.1;
    c.fillStyle = `rgba(${Math.round(124 * tone)},${Math.round(131 * tone)},${Math.round(138 * tone)},1)`;
    c.fillRect(x, y, w, h);
    // grime toward the bottom edge of the panel
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,25,30,${0.05 + rand() * 0.08})`);
    c.fillStyle = g; c.fillRect(x, y, w, h);
    if (rand() < 0.18) { c.fillStyle = trim; c.globalAlpha = 0.85; c.fillRect(x + seam * 2, y + seam * 2, w - seam * 4, Math.max(seam, h * 0.06)); c.globalAlpha = 1; }
    if (rand() < 0.3 && w > size / 8 && h > size / 8) {   // a hatch
      const hw = w * (0.3 + rand() * 0.25), hh = h * (0.3 + rand() * 0.25), hx = x + (w - hw) * rand(), hy = y + (h - hh) * rand();
      c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(hx, hy, hw, hh);
      c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(hx + seam, hy + seam, hw - seam * 2, hh - seam * 2);
    }
    // rivets along the edges
    c.fillStyle = 'rgba(40,45,50,0.55)';
    const step = Math.max(size / 40, 12);
    for (let i = seam * 3; i < w - seam * 3; i += step) { c.fillRect(x + i, y + seam * 2, 2, 2); c.fillRect(x + i, y + h - seam * 2 - 2, 2, 2); }
    for (let i = seam * 3; i < h - seam * 3; i += step) { c.fillRect(x + seam * 2, y + i, 2, 2); c.fillRect(x + w - seam * 2 - 2, y + i, 2, 2); }
  }
  c.strokeStyle = 'rgba(30,34,40,0.9)'; c.lineWidth = seam;
  for (const [x, y, w, h] of cells) c.strokeRect(x + seam / 2, y + seam / 2, w - seam, h - seam);
  // speckle
  const id = c.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rand() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  c.putImageData(id, 0, 0);

  // HEIGHT: seams recessed, hatches slightly proud; then a normal map from its slopes
  const height = new Float32Array(size * size).fill(1);
  const H = document.createElement('canvas'); H.width = H.height = size;
  const hc = H.getContext('2d'); hc.fillStyle = '#fff'; hc.fillRect(0, 0, size, size);
  hc.strokeStyle = '#000'; hc.lineWidth = seam * 1.5;
  for (const [x, y, w, h] of cells) hc.strokeRect(x + seam / 2, y + seam / 2, w - seam, h - seam);
  const hd = hc.getImageData(0, 0, size, size).data;
  for (let i = 0; i < size * size; i++) height[i] = hd[i * 4] / 255;
  // soften once so the groove has a slope to catch light on
  const soft = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += height[((y + dy + size) % size) * size + ((x + dx + size) % size)];
    soft[y * size + x] = s / 9;
  }
  const nrm = document.createElement('canvas'); nrm.width = nrm.height = size;
  const nc = nrm.getContext('2d'), nid = nc.createImageData(size, size), nd = nid.data;
  const strength = 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = soft[y * size + ((x - 1 + size) % size)], r = soft[y * size + ((x + 1) % size)];
    const u = soft[((y - 1 + size) % size) * size + x], dn = soft[((y + 1) % size) * size + x];
    const v = new THREE.Vector3(-(r - l) * strength, -(dn - u) * strength, 1).normalize();
    const i = (y * size + x) * 4;
    nd[i] = (v.x * 0.5 + 0.5) * 255; nd[i + 1] = (v.y * 0.5 + 0.5) * 255; nd[i + 2] = (v.z * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  nc.putImageData(nid, 0, 0);

  // ROUGHNESS: plating fairly matt, seams and grime rougher, trim a little glossier
  const rough = document.createElement('canvas'); rough.width = rough.height = size;
  const rc = rough.getContext('2d');
  rc.fillStyle = '#9a9a9a'; rc.fillRect(0, 0, size, size);
  rc.strokeStyle = '#d0d0d0'; rc.lineWidth = seam * 2;
  for (const [x, y, w, h] of cells) rc.strokeRect(x + seam / 2, y + seam / 2, w - seam, h - seam);

  const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rough, false) };
}

let shared = null;
export function hullMaterial() {
  if (!shared) {
    const maps = makeHullMaps();
    shared = new THREE.MeshStandardMaterial({ ...maps, metalness: 0.25, roughness: 1.0, normalScale: new THREE.Vector2(0.9, 0.9) });
  }
  return shared;
}

// Box-projected UVs: each triangle is mapped along the axis its normal mostly faces, using the
// other two coordinates in metres over the panel size, so seams run straight along the hull and a
// tile is `metresPerTile` across on the surface. Returns a new, non-indexed geometry.
export function boxProjectUVs(geometry, metresPerUnit, metresPerTile) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.attributes.position, n = pos.count, uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  const k = metresPerUnit / metresPerTile;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    nn.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(nn.x), ay = Math.abs(nn.y), az = Math.abs(nn.z);
    for (let j = 0; j < 3; j++) {
      const p = [a, b, c][j];
      let u, v;
      if (ax >= ay && ax >= az) { u = p.z; v = p.y; }
      else if (ay >= az) { u = p.x; v = p.z; }
      else { u = p.x; v = p.y; }
      uv[(i + j) * 2] = u * k; uv[(i + j) * 2 + 1] = v * k;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.userData.temp = true;
  return g;
}
