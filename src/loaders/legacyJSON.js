// LEGACY JSON MODELS. Shipwrecked and the 2019 site saved their models in three.js's old JSON
// format (the Blender exporter's "formatVersion 3"), which JSONLoader read until three r99 dropped
// it. This reads the same files into today's three: a BufferGeometry split into one group per
// material, a SkinnedMesh when the file has bones, and its animations as AnimationClips.
//
// The face array packs each face as a bitmask followed by the indices that mask says are present:
//   bit 0 quad, 1 material index, 3 per-vertex uvs (one set per uv layer), 4 face normal,
//   5 per-vertex normals, 6 face colour, 7 per-vertex colours.
// A quad a b c d is two triangles, a b d and b c d, as JSONLoader split it.
import * as THREE from 'three';

export async function loadLegacyJSON(url, { textures = null } = {}) {
  const json = await (await fetch(url)).json();
  const base = textures || url.slice(0, url.lastIndexOf('/') + 1);
  return parseLegacyJSON(json, base);
}

export function parseLegacyJSON(json, textureBase = '') {
  const scale = json.scale !== undefined ? 1 / json.scale : 1;
  const V = json.vertices || [], F = json.faces || [], N = json.normals || [];
  const layers = (json.uvs || []).filter(l => l && l.length);
  const skinned = json.bones && json.bones.length && json.skinIndices && json.skinIndices.length;
  const per = json.influencesPerVertex || 2;
  const nBones = skinned ? json.bones.length : 0;
  const bit = (v, b) => (v & (1 << b)) !== 0;

  const tris = [];                          // { v:[3], uv:[3]|null, n:[3]|null, fn, mat }
  let o = 0;
  while (o < F.length) {
    const type = F[o++], quad = bit(type, 0);
    const k = quad ? 4 : 3;
    const v = F.slice(o, o + k); o += k;
    const mat = bit(type, 1) ? F[o++] : 0;
    let uv = null;
    if (bit(type, 3)) for (let l = 0; l < layers.length; l++) { const u = F.slice(o, o + k); o += k; if (l === 0) uv = u; }
    const fn = bit(type, 4) ? F[o++] : -1;
    let n = null;
    if (bit(type, 5)) { n = F.slice(o, o + k); o += k; }
    if (bit(type, 6)) o++;
    if (bit(type, 7)) o += k;
    const pick = (arr, idx) => arr && idx.map(i => arr[i]);
    const sets = quad ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2]];
    for (const s of sets) tris.push({ v: pick(v, s), uv: pick(uv, s), n: pick(n, s), fn, mat });
  }
  tris.sort((a, b) => a.mat - b.mat);

  const count = tris.length * 3;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const si = skinned ? new Uint16Array(count * 4) : null, sw = skinned ? new Float32Array(count * 4) : null;
  const geo = new THREE.BufferGeometry();
  let hasNormals = true, group = null;
  tris.forEach((t, ti) => {
    if (!group || group.materialIndex !== t.mat) { group = { start: ti * 3, count: 0, materialIndex: t.mat }; geo.groups.push(group); }
    group.count += 3;
    for (let c = 0; c < 3; c++) {
      const i = ti * 3 + c, vi = t.v[c];
      pos[i * 3] = V[vi * 3] * scale; pos[i * 3 + 1] = V[vi * 3 + 1] * scale; pos[i * 3 + 2] = V[vi * 3 + 2] * scale;
      const ni = t.n ? t.n[c] : t.fn;
      if (ni >= 0 && N.length) { nor[i * 3] = N[ni * 3]; nor[i * 3 + 1] = N[ni * 3 + 1]; nor[i * 3 + 2] = N[ni * 3 + 2]; } else hasNormals = false;
      if (t.uv) { const L = layers[0]; uvs[i * 2] = L[t.uv[c] * 2]; uvs[i * 2 + 1] = L[t.uv[c] * 2 + 1]; }
      if (skinned) for (let w = 0; w < per && w < 4; w++) {
        const bi = json.skinIndices[vi * per + w];
        if (bi >= 0 && bi < nBones) { si[i * 4 + w] = bi; sw[i * 4 + w] = json.skinWeights[vi * per + w] || 0; }   // some exports point past the last bone
      }
    }
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (hasNormals) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); else geo.computeVertexNormals();
  if (layers.length) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (skinned) { geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }

  // the exporter wrote Lambert/Phong settings; the lab lights everything as standard materials
  const loader = new THREE.TextureLoader();
  const mats = (json.materials && json.materials.length ? json.materials : [{}]).map(m => {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().fromArray(m.colorDiffuse || [0.8, 0.8, 0.8]), roughness: 0.85, metalness: 0,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide, transparent: !!m.transparent, opacity: m.opacity ?? 1 });
    if (m.mapDiffuse) {
      mat.map = loader.load(textureBase + m.mapDiffuse.split('/').pop(), t => { t.colorSpace = THREE.SRGBColorSpace; });
      if (m.mapDiffuseWrap && m.mapDiffuseWrap[0] === 'repeat') { mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; }
      if (m.mapDiffuseRepeat) mat.map.repeat.fromArray(m.mapDiffuseRepeat);
      if (!m.colorDiffuse) mat.color.set(0xffffff);
    }
    if (m.transparent && mat.map) mat.alphaTest = 0.5;
    mat.name = m.DbgName || '';
    return mat;
  });
  const material = mats.length === 1 ? mats[0] : mats;
  if (!Array.isArray(material)) geo.clearGroups();

  let mesh, animations = [];
  if (skinned) {
    mesh = new THREE.SkinnedMesh(geo, material);
    const bones = json.bones.map(b => {
      const bone = new THREE.Bone(); bone.name = b.name;
      if (b.pos) bone.position.fromArray(b.pos);
      if (b.rotq) bone.quaternion.fromArray(b.rotq); else if (b.rot) bone.rotation.fromArray(b.rot);
      if (b.scl) bone.scale.fromArray(b.scl);
      return bone;
    });
    json.bones.forEach((b, i) => (b.parent >= 0 && bones[b.parent] ? bones[b.parent] : mesh).add(bones[i]));
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
    const anims = json.animations || (json.animation ? [json.animation] : []);
    for (const a of anims) { const clip = THREE.AnimationClip.parseAnimation(a, json.bones); if (clip) animations.push(clip); }
  } else {
    mesh = new THREE.Mesh(geo, material);
  }
  mesh.name = json.name || '';
  return { scene: mesh, animations };
}
