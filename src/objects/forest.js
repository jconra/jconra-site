// FOREST. The Tree Lab's system packaged for a scene: species baked to GLB, their imposter atlases
// baked here at load (a row of views per frame), the trees laid out on tiles that are re-laid
// around a moving point so the forest never ends, meshes for the nearest ring and imposters for
// the rest with a dithered crossfade. Settings come from the Tree Lab's findings: 192 px cells,
// the mesh circle ahead of the camera, and a light mode for machines without WebGL2 (imposters
// only, no shadows).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeImposterSteps, imposterMaterial } from './imposter.js';
import { lampStandard } from './lampLight.js';
import { swayMaterial } from './wind.js';
import { shapeFoliage, SHAPE_DEFAULTS } from './foliage.js';

// a thin tree filled out: each leaf card (four corners in a row, as ez-tree makes them) grown about its middle, and `copies`
// copies of each added, turned about the upright through its middle and nudged out from the trunk, so the crown fills in
function fillLeaves(root, scale, copies) {
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !(o.material.alphaTest > 0 || /lea[fv]/i.test(o.material.name || ''))) return;
    const g = o.geometry, P = g.attributes.position, n = P.count; if (n % 4) return;
    const attrs = Object.keys(g.attributes), out = {}, idx = g.index ? g.index.array : null, v = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (const a of attrs) out[a] = new Float32Array(g.attributes[a].array.length * (1 + copies));
    const cards = n / 4;
    for (let k = 0; k < cards; k++) {
      c.set(0, 0, 0); for (let i = 0; i < 4; i++) c.add(v.fromBufferAttribute(P, k * 4 + i)); c.multiplyScalar(0.25);
      for (let r = 0; r <= copies; r++) {
        q.setFromAxisAngle(Y, r * Math.PI / (copies + 1) + 0.6 * r);          // (each copy turned a different way)
        const push = r ? 0.15 : 0, out0 = (r * cards + k) * 4;
        for (let i = 0; i < 4; i++) {
          const s = k * 4 + i, d = out0 + i;
          for (const a of attrs) { const A = g.attributes[a], sz = A.itemSize; for (let e = 0; e < sz; e++) out[a][d * sz + e] = A.array[s * sz + e]; }
          v.fromBufferAttribute(P, s).sub(c).multiplyScalar(scale).applyQuaternion(q);
          const size = Math.max(1e-6, Math.hypot(c.x, c.z)), ox = r ? c.x / size * push * scale : 0, oz = r ? c.z / size * push * scale : 0;
          out.position[d * 3] = c.x + v.x + ox; out.position[d * 3 + 1] = c.y + v.y; out.position[d * 3 + 2] = c.z + v.z + oz;
          if (r && out.normal) { v.set(out.normal[d * 3], out.normal[d * 3 + 1], out.normal[d * 3 + 2]).applyQuaternion(q); out.normal[d * 3] = v.x; out.normal[d * 3 + 1] = v.y; out.normal[d * 3 + 2] = v.z; }
        }
      }
    }
    const ng = new THREE.BufferGeometry();
    for (const a of attrs) ng.setAttribute(a, new THREE.BufferAttribute(out[a], g.attributes[a].itemSize));
    if (idx) { const ni = new (n * (1 + copies) > 65535 ? Uint32Array : Uint16Array)(idx.length * (1 + copies)); for (let r = 0; r <= copies; r++) for (let i = 0; i < idx.length; i++) ni[r * idx.length + i] = idx[i] + r * n; ng.setIndex(new THREE.BufferAttribute(ni, 1)); }
    o.geometry = ng;
  });
}

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// the shadow edge (see the constructor): how far a tree at vLand has eased from its real shadow to the even shade
// (round, not square, so no straight line; each thing's own start pushed out by up to edgeJitter, so no round line either)
export const EDGE_GLSL = `uniform vec3 shadowAt; uniform float shadowRange, edgeFrom, edgeTo, edgeShade, edgeJitter;
float edgeHash(vec2 c) { vec3 p = fract(vec3(c.xyx) * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float edgeK(vec2 at) { if (shadowRange <= 0.0) return 0.0; return smoothstep(edgeFrom, edgeTo, length(at - shadowAt.xz) / shadowRange + edgeHash(floor(at * 4.0)) * edgeJitter); }
`;
// three's own light loop with the sun's shadow eased the same way (the whole tree at once: vLand is its root)
// and the land's baked sun shade (landSun, see the map patch below) on the sun's light alone, shadow map or not
const EDGE_LIGHTS = (() => { let c = THREE.ShaderChunk.lights_fragment_begin; const re = /(getShadow\( directionalShadowMap\[ i \][^;]*?vDirectionalShadowCoord\[ i \] \)) : 1\.0;/, info = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (c.includes(info)) c = c.replace(info, info + ' directLight.color *= landSun;'); else console.warn('forest: no sun line found in lights_fragment_begin; the land\'s hill shadow darkens the trees evenly');
  if (!re.test(c)) { console.warn('forest: no shadow line found in lights_fragment_begin; trees keep a hard shadow edge'); return c; }
  return c.replace(re, 'mix($1, edgeShade, edgeK(vLand)) : 1.0;'); })();
// ALPHA TO COVERAGE for a species' leaf cards (species option `coverage`). An alpha-clipped leaf is all or nothing per
// pixel: hard, shimmering edges up close, and far off, where the texture's smaller copies average a leaf's edge into the
// background, its alpha falls under the cutoff and the leaf vanishes (a tree goes thin with distance). So: near, the
// alpha is sharpened into a pixel-wide ramp round the cutoff and the GPU keeps that share of each pixel's edge samples
// (smooth leaf edges; needs edge smoothing on); farther than coverFar levels down the smaller copies it is a plain clip
// again, of an alpha raised coverMip a level so the leaves keep their size. (Far, partial coverage doesn't work for
// foliage: layers with the same alpha get the same samples, so a crown never fills and goes pale with the sky through
// it.) three.js r158 forces alpha to 1 on solid materials, so the output keeps it. (After Ben Golus, "Anti-aliased Alpha
// Test: The Esoteric Alpha To Coverage".)
const COVER_U = { coverFar: { value: 1.0 }, coverMip: { value: 0.08 } };   // (shared by every covered material; 0.08: a row of aspens stayed at 1.06-1.10 of a 4x-resolution reference from 40 to 300 m, where the plain clip fell to 0.30)
const COVER_ALPHA = `#ifdef USE_ALPHATEST
  #if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
  { vec2 tx = vMapUv * coverTexels, dx = dFdx(tx), dy = dFdy(tx);
    float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    float a = diffuseColor.a * (1.0 + lod * coverMip), sharp = clamp((a - alphaTest) / max(fwidth(a), 0.0001) + 0.5, 0.0, 1.0);
    diffuseColor.a = mix(sharp, step(alphaTest, a), smoothstep(coverFar, coverFar + 1.0, lod));
    if (diffuseColor.a < 0.004) discard; }
  #else
  if (diffuseColor.a < alphaTest) discard;
  #endif
#endif`;
const COVER_OUT = `#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4(outgoingLight, diffuseColor.a);`;
// a leaf picture's clear texels given the colour of the nearest leaf texel (alpha kept), so the texture's smaller copies,
// which far trees are drawn with, average leaf into leaf rather than whatever colour hides under the transparency (the
// leaves' own light edges stay: they're part of how a leaf looks up close, and far it should average them in). Uploaded as raw
// texels: a canvas would drop the colour under alpha 0 again. Once per picture (it stays on the shared model).
function bleedLeafMap(tex) {
  if (tex.userData.bled || !tex.image || !tex.image.width) return tex;
  const W = tex.image.width, H = tex.image.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.image, 0, 0);
  const px = g.getImageData(0, 0, W, H).data, solid = new Uint8Array(W * H); let front = [];
  for (let q = 0; q < W * H; q++) if (px[q * 4 + 3] >= 8) { solid[q] = 1; front.push(q); }   // (every texel with any leaf in it keeps its own colour, its light edge too: only the clear ones are filled)
  while (front.length) {   // grow the solid colour outward a texel a pass: each new texel the average of its solid neighbours
    const next = [];
    for (const q of front) { const x = q % W, y = (q / W) | 0;
      for (const n of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1]) if (n >= 0 && !solid[n]) { solid[n] = 2; next.push(n); } }
    for (const n of next) { const x = n % W, y = (n / W) | 0; let r = 0, gg = 0, b = 0, k = 0;
      for (const m of [x > 0 ? n - 1 : -1, x < W - 1 ? n + 1 : -1, y > 0 ? n - W : -1, y < H - 1 ? n + W : -1]) if (m >= 0 && solid[m] === 1) { r += px[m * 4]; gg += px[m * 4 + 1]; b += px[m * 4 + 2]; k++; }
      px[n * 4] = r / k; px[n * 4 + 1] = gg / k; px[n * 4 + 2] = b / k; }
    for (const n of next) solid[n] = 1; front = next; }
  const out = new THREE.DataTexture(new Uint8Array(px.buffer.slice(0)), W, H, THREE.RGBAFormat);
  out.colorSpace = tex.colorSpace; out.wrapS = tex.wrapS; out.wrapT = tex.wrapT; out.magFilter = THREE.LinearFilter; out.minFilter = THREE.LinearMipmapLinearFilter;
  out.generateMipmaps = true; out.anisotropy = tex.anisotropy; out.flipY = tex.flipY;
  out.userData.bled = true; out.needsUpdate = true; return out;
}
// SENDING PER-PLANT DATA to the graphics card: a stretch of an attribute (items lo..hi); a stretch asked for while another is
// still waiting to go (two moves before a draw) is joined to it, so neither is lost
const PENDING = new WeakMap();
function sent() { PENDING.delete(this); this.updateRange.count = -1; }   // (its first sending is all of it, which leaves the stretch asked for set: cleared)
function sendPart(a, lo, hi) {
  const w = PENDING.get(a);
  if (w) { lo = Math.min(lo, w[0]); hi = Math.max(hi, w[1]); }
  PENDING.set(a, [lo, hi]); a.onUploadCallback = sent; a.updateRange.offset = lo * a.itemSize; a.updateRange.count = (hi - lo + 1) * a.itemSize; a.needsUpdate = true;
}
const switchHash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };   // (a tree's own 0..1 from where it stands)

export const FOREST_SPECIES = [
  // soften: the foliage's normals bent this far toward up (both the meshes and the imposters)
  // shape (optional): light the leaves by the lumps they form, darker inside (src/objects/foliage.js settings)
  // sink (optional): stand it this share of its height down into the ground (a plant's root clump)
  // leafScale, leafCopies (optional): each leaf card made this much bigger about its middle, and this many crossed copies of each added
  { name: 'ash',   file: 'ash',   height: 20, weight: 1, soften: 0.5 },
  { name: 'aspen', file: 'aspen', height: 17, weight: 1, soften: 0.5, leafScale: 1.6, leafCopies: 1, coverage: true },   // (its model has a fifth of the ash's leaves: bigger, and a crossed copy of each; coverage: they thinned out with distance)
  { name: 'oak',   file: 'oak',   height: 18, weight: 1.2, soften: 0.5 },
  { name: 'pine',  file: 'pine',  height: 22, weight: 1.4, soften: 0.5 },
  { name: 'bush',  file: 'bush',  height: 5,  weight: 0.5, soften: 0.5 },
];

export class Forest {
  // `clear(x, z)` says whether a spot is kept free of trees (the town); `light` is the weak-GPU mode
  // `species`: a list like FOREST_SPECIES; an entry may bring its own `root` (an Object3D, already
  // loaded) instead of a file, its own `grid` / `cell` for a cheaper atlas, `upNormals` (lit like the
  // ground, both sides of every card) and `tint: false`. `fixed`: a list of { x, z, sp (index), scale,
  // yaw, tint (optional THREE.Color) } to plant instead of the endless tiles; `heightAt(x, z)` stands them on uneven ground.
  constructor(renderer, scene, { base = '/models/trees/', tile = 420, tiles = 7, perTile = 90, imposterAt = 140, band = 40, ahead = 0.75,
                                 grid = 12, cell = 192, light = false, detail = 'coarse', clear = null, sunDir = new THREE.Vector3(0.5, 1, 0.3), shadows = false,
                                 species = null, fixed = null, heightAt = null, nearCap = 400, wind = false, spread = 0, shadowEdge = null, lamps = null } = {}) {
    this.wind = wind;                   // sway in the shared breeze (src/objects/wind.js); a species' `sway` (0..1, default 1) says how much
    Object.assign(this, { renderer, scene, base, tile, tiles, perTile, imposterAt: light ? 0 : imposterAt, band, ahead, spread, grid: light ? 8 : grid, cell, detail, clear, sunDir, shadows: shadows && !light, light, fixed, heightAt, nearCap , lamps });
    this.group = new THREE.Group(); scene.add(this.group);
    this.species = (species || FOREST_SPECIES).map(s => ({ ...s }));
    this.tilesLaid = new Map();          // "tx,tz" -> [{ pos, yaw, scale, tint, sp }]
    this.built = [];
    // the land's baked shade, shared by every species' imposter and meshes: set .landShade.value (a
    // texture covering landShadeSize metres, centred on 0,0) and landShadeK (hill, hollow, tree, on)
    this.landU = { landShade: { value: null }, landShadeSize: { value: 1600 }, landShadeK: { value: new THREE.Vector4() } };
    // SHADOW EDGE: real shadows reach only a square round the camera (the page's shadow camera: centre `at`,
    // half-width `range`, as uniforms the page moves); past it every tree would light up at once. From `from` to
    // `to` of the way out (0 centre, 1 edge; round, each tree's start pushed out by up to `jitter`) each tree's sun shadow eases into an even `shade` (0 dark .. 1 lit),
    // the average a shadowed wood comes to, so a wood is as dark past the edge as inside it. Range 0: off.
    const E = shadowEdge || {};
    this.edgeU = { shadowAt: E.at || { value: new THREE.Vector3() }, shadowRange: E.range || { value: 0 }, edgeFrom: E.from || { value: 0.55 }, edgeTo: E.to || { value: 0.97 }, edgeShade: E.shade || { value: 0.55 }, edgeJitter: E.jitter || { value: 0.12 } };   // (0.55: what five views of real-shadowed woods averaged, 0.34 to 0.74)
    this.ready = false; this.baking = null;
    this.loaded = this.load();
  }

  async load() {
    const loader = new GLTFLoader();
    for (const sp of this.species) {
      if (!sp.root) { sp.root = (await loader.loadAsync(`${this.base}${sp.file}${this.detail === 'fine' ? '' : '_' + this.detail}.glb`)).scene; sp.ownRoot = true; }
      if (this.disposed) return;                                          // replaced while it loaded: go no further
      const root = sp.root; root.updateMatrixWorld(true);
      if ((sp.leafScale || sp.leafCopies) && !root.userData.leavesGrown) { fillLeaves(root, sp.leafScale || 1, sp.leafCopies || 0); root.userData.leavesGrown = true; }
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
      sp.unit = sp.height / size.y; sp.box0 = box.min.y; sp.boxH = size.y; sp.baseY = box.min.y + (sp.sink || 0) * size.y; sp.root = root;   // (sink: that share of its height under the ground)
      const shapeKey = sp.shape ? JSON.stringify(sp.shape) : '';          // (a species handed on to a new forest is already shaped)
      if (sp.shape && root.userData.shapedWith !== shapeKey) { sp.shapeInfo = shapeFoliage(root, sp.unit, sp.shape); root.userData.shapedWith = shapeKey; }
      root.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) { o.material.side = THREE.DoubleSide; if (o.material.map) o.material.map.anisotropy = 4; if (o.material.transparent) { o.material.alphaTest = 0.5; o.material.transparent = false; } } });
      if (sp.coverage) root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.alphaTest > 0 && m.map) m.map = bleedLeafMap(m.map); });   // (before the meshes and the atlas copy it)
    }
    // the atlases, a row of views per frame
    const todo = this.species.slice();
    const self = this;
    const steps = (function* () { for (const sp of todo) { if (sp.bake) continue;   // brought already baked
 const it = bakeImposterSteps(self.renderer, sp.root, { grid: self.light ? Math.min(8, sp.grid || self.grid) : (sp.grid || self.grid), cell: sp.cell || self.cell, hemi: true, upNormals: !!(sp.upNormals || sp.soften || sp.shape), floor: sp.sink ? sp.baseY : null }); try { for (;;) { const s = it.next(); if (s.done) { sp.bake = s.value; break; } yield; } } finally { if (!sp.bake) it.return(); } } })();   // (abandoned: the half-done bake cleans up)
    this.baking = steps;
  }
  get progress() { return this.species.filter(s => s.bake).length / this.species.length; }

  // called every frame; bakes a little, then keeps the tiles around `at` and the near/far split
  update(camera, target, at, dt) {
    if (this.baking) {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) { if (this.baking.next().done) { this.baking = null; this.buildDraws(); this.ready = true; break; } }
      if (!this.ready) return;
    }
    if (!this.ready) return;
    if (this.relay(at)) this.refill();
    this.assign(camera, target);
  }

  // which tiles exist around `at`; new ones are laid out from their own seed, so they come back the same
  relay(at) {
    if (this.fixed) {                                       // a set list: laid once
      if (this.tilesLaid.size) return false;
      this.tilesLaid.set('fixed', this.fixed.map((f, i) => this.layOne(f, i)));
      return true;
    }
    const T = this.tile, half = (this.tiles - 1) / 2, cx = Math.round(at.x / T), cz = Math.round(at.z / T);
    const want = new Set(); let changed = false;
    for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) {
      const key = (cx + i) + ',' + (cz + j); want.add(key);
      if (!this.tilesLaid.has(key)) { this.tilesLaid.set(key, this.layTile(cx + i, cz + j)); changed = true; }
    }
    for (const key of [...this.tilesLaid.keys()]) if (!want.has(key)) { this.tilesLaid.delete(key); changed = true; }
    return changed;
  }
  layTile(tx, tz) {
    const r = rnd(tx * 7919 + tz * 104729 + 17), T = this.tile, out = [];
    const total = this.species.reduce((a, s) => a + s.weight, 0);
    for (let i = 0; i < this.perTile; i++) {
      const x = tx * T + (r() - 0.5) * T, z = tz * T + (r() - 0.5) * T;
      let pick = r() * total, sp = this.species[0]; for (const s of this.species) { pick -= s.weight; if (pick <= 0) { sp = s; break; } }
      const yaw = r() * Math.PI * 2, scale = 0.7 + r() * 0.6, tint = new THREE.Color().setHSL(0.26 + r() * 0.08, 0.35 + r() * 0.25, 0.62 + r() * 0.18);
      if (this.clear && this.clear(x, z)) continue;
      out.push({ pos: new THREE.Vector3(x, this.heightAt ? this.heightAt(x, z) : 0, z), yaw, scale, tint, sp });
    }
    return out;
  }

  // a new set list (the same species, already built): laid in place of the old one, the draws kept (grown if
  // the list outgrew them), so moving it costs the laying, not a rebuild. `laid` (optional): the list already laid
  // by layFixedSteps, a little at a time
  setFixed(list, laid = null) {
    this.fixed = list; this.tilesLaid.clear(); this.assignDirty = true;
    if (!this.ready) return;
    if (list.length > this.cap) this.growDraws(Math.ceil(list.length * 1.25));
    if (laid) this.tilesLaid.set('fixed', laid); else this.relay();
    this.refill();
  }
  // lays a set list (heights, turns, sizes, colours) yielding whenever `budget` ms have gone; returns the laid list
  *layFixedSteps(list, budget = 6) {
    const out = new Array(list.length); let t0 = performance.now();
    for (let i = 0; i < list.length; i++) {
      out[i] = this.layOne(list[i], i);
      if ((i & 255) === 0 && performance.now() - t0 > budget) { yield; t0 = performance.now(); }
    }
    return out;
  }
  layOne(f, i) {
    const r = rnd(i * 2654435761 + 7), sp = this.species[f.sp];
    return { pos: new THREE.Vector3(f.x, this.heightAt ? this.heightAt(f.x, f.z) : 0, f.z), yaw: f.yaw ?? r() * Math.PI * 2, scale: f.scale ?? 0.7 + r() * 0.6,
      tint: f.tint ? f.tint.clone() : sp.tint === false ? new THREE.Color(1, 1, 1).multiplyScalar(0.85 + r() * 0.3) : new THREE.Color().setHSL(0.26 + r() * 0.08, 0.35 + r() * 0.25, 0.62 + r() * 0.18), sp };
  }
  growDraws(cap) {
    for (const b of this.built) { const g = b.imposter.geometry;
      for (const [name, size] of [['iPos', 3], ['iYaw', 1], ['iScale', 1], ['iTint', 3], ['iFade', 1]]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); }
      delete g._maxInstanceCount;                                       // (three fixes the most instances it will draw at a geometry's first draw and never raises it: without this, plants past the old room were never drawn)
      g.instanceCount = 0; }
    this.cap = cap;
  }

  // the draws: per species, an imposter draw with room for every tree of that species, and mesh draws for the near ring
  buildDraws() {
    const cap = this.fixed ? Math.max(1, Math.ceil(this.fixed.length * 1.25)) : this.tiles * this.tiles * this.perTile;
    this.cap = cap;
    for (const sp of this.species) {
      const geo = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1); geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
      const n = cap;
      for (const [name, size] of [['iPos', 3], ['iYaw', 1], ['iScale', 1], ['iTint', 3], ['iFade', 1]]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
      geo.instanceCount = 0;
      let glow = 0, sheen = 0; sp.root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (m.lightMap) glow = Math.max(glow, m.lightMapIntensity); if (m.isMeshStandardMaterial) sheen = Math.max(sheen, (1 - m.metalness) * (sp.upNormals ? 0.25 : 1)); } });      // (a tree with its own even light, as the low-poly pines have: its far versions get it too; drawn with MeshStandardMaterial: its far versions get the same faint sheen)
      const mat = imposterMaterial(sp.bake, { sunDir: this.sunDir, blend: true, depth: !this.light, shadows: this.shadows, soften: sp.soften || 0, wind: this.wind ? (sp.sway ?? 1) : 0, glow, sheen, lamps: this.lamps });
      if (this.calm) for (const [k, v] of Object.entries(this.calm)) mat.uniforms[k].value = v;
      Object.assign(mat.uniforms, this.landU, this.edgeU);
      mat.uniforms.blendDist.value = 300;
      const imposter = new THREE.Mesh(geo, mat); imposter.frustumCulled = false; imposter.castShadow = this.shadows; imposter.customDepthMaterial = mat.userData.depthMaterial;
      this.group.add(imposter);
      const meshes = [];
      if (!this.light) sp.root.traverse(o => {
        if (!o.isMesh) return;
        const NC = this.nearCap, m = new THREE.InstancedMesh(o.geometry.clone(), Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone(), NC);
        m.count = 0; m.frustumCulled = false; m.castShadow = this.shadows; m.receiveShadow = this.shadows;
        const mf = new THREE.InstancedBufferAttribute(new Float32Array(NC), 1); mf.setUsage(THREE.DynamicDrawUsage); m.geometry.setAttribute('iFade', mf);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NC * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        // shaped leaves (they carry how much sky each corner sees): a sprig seen from underneath darker, and
        // sunlight through the outer leaves when you look toward the sun
        const leafy = !!(sp.shape && o.geometry.attributes.aSky), under = sp.shape?.under ?? SHAPE_DEFAULTS.under, glow = sp.shape?.glow ?? SHAPE_DEFAULTS.glow;
        for (const mat of [].concat(m.material)) {
          const cover = !!(sp.coverage && mat.alphaTest > 0 && mat.map && mat.map.image);   // (leaf cards drawn with alpha to coverage: see COVER_ALPHA)
          mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, this.landU, this.edgeU);
            sh.vertexShader = 'attribute float iFade; varying float vFade; varying vec2 vLand;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = iFade; vLand = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;');
            sh.fragmentShader = 'uniform sampler2D landShade; uniform float landShadeSize; uniform vec4 landShadeK; varying vec2 vLand;\n' + EDGE_GLSL + sh.fragmentShader.replace('#include <lights_fragment_begin>', EDGE_LIGHTS).replace('#include <map_fragment>', `#include <map_fragment>
              float landSun = 1.0;   // (the hill's and the trees' shadow: the sun's light only, in EDGE_LIGHTS; the hollows darken it all)
              if (landShadeK.w > 0.5) { vec3 sd = texture2D(landShade, vLand / landShadeSize + 0.5).rgb;
                landSun = mix(1.0, sd.r, landShadeK.x) * (1.0 - landShadeK.z * sd.b);
                diffuseColor.rgb *= mix(1.0, 0.3 + 0.7 * sd.g, landShadeK.y) * (1.0 - landShadeK.z * sd.b * 0.6); }`);
            // a plant lit like the ground (upNormals: every face as if facing up) would catch a low sun ahead of you as a glare off
            // that made-up surface, washing it out to cream: a quarter of the sun's shine for those
            if (sp.upNormals) sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.25;\n#include <aomap_fragment>');
            if (sp.upNormals || sp.soften || sp.shape) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')
              + (sp.soften ? `\nnormal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), ${sp.soften.toFixed(2)}));` : ''));
            if (leafy) {
              sh.vertexShader = 'attribute float aSky; varying float vSky;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSky = aSky;');
              sh.fragmentShader = 'varying float vSky;\n' + sh.fragmentShader
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                  diffuseColor.rgb *= mix(${(1 - under).toFixed(3)}, 1.0, smoothstep(-0.3, 0.2, dot(normal, normalize(vViewPosition))));`)
                .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                  #if NUM_DIR_LIGHTS > 0
                  reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * pow(max(0.0, dot(-normalize(vViewPosition), directionalLights[0].direction)), 3.0) * vSky * vSky * ${glow.toFixed(3)};
                  #endif`);
            }
            sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{ float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (vFade < dither) discard; }');
            if (cover) { sh.uniforms.coverTexels = { value: new THREE.Vector2(mat.map.image.width, mat.map.image.height) }; sh.uniforms.coverMip = COVER_U.coverMip; sh.uniforms.coverFar = COVER_U.coverFar;
              sh.fragmentShader = 'uniform vec2 coverTexels; uniform float coverMip, coverFar;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', COVER_ALPHA).replace('#include <opaque_fragment>', COVER_OUT); }
            if (this.lamps) { Object.assign(sh.uniforms, this.lamps); sh.fragmentShader = lampStandard(sh.fragmentShader); }   // (street lamps: lampLight.js)
          };
          mat.alphaToCoverage = cover;
          mat.customProgramCacheKey = () => 'forest-mesh' + (sp.upNormals ? '-up2' : '') + (sp.soften ? '-s' + sp.soften : '') + (sp.shape ? '-shape' : '') + (leafy ? `-leaf${under}-${glow}` : '') + (cover ? '-cover' : '') + (this.lamps ? '-lamps' : ''); mat.needsUpdate = true;
          if (this.wind) { m.geometry.computeBoundingBox(); swayMaterial(mat, Math.max(0.001, m.geometry.boundingBox.max.y), sp.sway ?? 1, '-' + (sp.sway ?? 1)); }
        }
        m.userData.local = o.matrixWorld.clone(); m.userData.fade = mf;
        this.group.add(m); meshes.push(m);
      });
      this.built.push({ sp, imposter, meshes, trees: [] });
    }
    this.refill();
  }

  // each species sunk anew (sinkOf(sp, index) -> its share of its height under the ground), the plants laid again in place
  setSinks(sinkOf) {
    this.species.forEach((sp, i) => { if (sp.boxH == null) return; sp.sink = sinkOf(sp, i); sp.baseY = sp.box0 + sp.sink * sp.boxH; });
    if (this.ready) this.refill();
  }

  // gone for good: off the scene, its draws freed, and its baked atlases too unless another forest goes on
  // using these species (bakes: false)
  dispose({ bakes = true } = {}) {
    this.disposed = true;
    if (this.baking) { this.baking.return(); this.baking = null; }
    this.scene.remove(this.group);
    for (const b of this.built) {
      b.imposter.geometry.dispose(); for (const m of b.meshes) { m.geometry.dispose(); m.dispose(); }
      if (bakes) {                                                        // (kept when the species go on: the next forest compiles the same shaders)
        b.imposter.material.dispose(); b.imposter.material.userData.depthMaterial?.dispose();
        for (const m of b.meshes) [].concat(m.material).forEach((x) => x.dispose());
      }
    }
    if (bakes) for (const sp of this.species) {
      if (sp.bake && sp.bake.targets) { sp.bake.targets.forEach((t) => t.dispose()); sp.bake = null; }
      if (sp.ownRoot && sp.root) {                                        // the tree as loaded: its geometry and every picture it has
        sp.root.traverse((o) => { if (!o.isMesh) return; o.geometry.dispose(); for (const mt of [].concat(o.material)) { for (const v of Object.values(mt)) if (v && v.isTexture) v.dispose(); mt.dispose(); } });
        sp.root = null;
      }
    }
    this.built = []; this.ready = false;
  }

  // far plants calmed toward one colour: { calmCol (THREE.Color), calmFrom, calmTo (m), calmAmt (0..1) };
  // kept for species not built yet
  setCalm(c) {
    this.calm = { ...(this.calm || {}), ...c };
    for (const b of this.built) { const u = b.imposter.material.uniforms; for (const [k, v] of Object.entries(this.calm)) if (u[k]) u[k].value = v; }
  }

  // what changes as you move: which plants near you are real meshes (and how far faded). Each plant's own data
  // (place, turn, size, colour) was written once, by refill; here only the plants within the mesh range are
  // looked at closely and only their imposters' fades changed, so a move costs a pass over distances, not a sort
  // and rewrite of every plant (with 90,000 of them that stalled a frame for ~0.1 s every 2 m)
  assign(camera, target) {
    const D = this.imposterAt, B = this.band / 2;
    const fwd = new THREE.Vector3().subVectors(target, camera.position).setY(0).normalize();
    const camP = camera.position.clone().addScaledVector(fwd, D * this.ahead);
    if (!this.assignDirty && this.lastAt && this.lastAt.distanceToSquared(camP) < 4) return;
    const full = this.assignDirty; this.assignDirty = false; this.lastAt = camP.clone();   // (full: everything was written again, so all of it is sent)
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    // SPREAD: each tree switches at its own distance, D * (1 - spread / 2 .. 1 + spread / 2), so the change
    // comes a tree at a time instead of as one line across the wood
    const S = THREE.MathUtils.clamp(this.spread || 0, 0, 1.5);
    const reach = D * (1 + S / 2) + B, reach2 = reach * reach, cx = camP.x, cy = camP.y, cz = camP.z;
    for (const b of this.built) {
      const { sp, imposter, meshes, trees } = b, iFade = imposter.geometry.attributes.iFade, aFade = iFade.array;
      let lo = Infinity, hi = -1;                                          // (the imposter fades changed: only that stretch is sent)
      if (b.near) for (const k of b.near) { aFade[k] = 1; if (k < lo) lo = k; if (k > hi) hi = k; }   // last time's near plants: whole imposters again
      b.near = [];
      const live = Math.min(trees.length, aFade.length);                 // (the plants drawn: past them nothing need be sent)
      if (!meshes.length || D <= 0) { if (full && live) sendPart(iFade, 0, live - 1); else if (hi >= lo) sendPart(iFade, lo, hi); for (const m of meshes) m.count = 0; continue; }
      const cand = [];
      for (let k = 0; k < trees.length; k++) { const t = trees[k], p = t.pos, dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= reach2) continue;
        if (t.sw === undefined) t.sw = switchHash(p.x, p.z);              // (0..1, fixed by where the tree stands)
        const Dk = D * (1 + S * (t.sw - 0.5)), d = Math.sqrt(d2);
        if (d < Dk + B) cand.push([k, d, Dk]); }
      const cap = meshes[0].instanceMatrix.count;
      if (cand.length > cap) cand.sort((p, q) => (p[1] - p[2]) - (q[1] - q[2]));   // more than fit: the deepest inside their own distance win (past the cap the imposter stays whole)
      const n = Math.min(cap, cand.length);
      for (let i = 0; i < n; i++) {
        const [k, d, Dk] = cand[i], t = trees[k];
        const f = B > 0 ? THREE.MathUtils.clamp((Dk + B - d) / (2 * B), 0, 1) : d < Dk ? 1 : 0;
        aFade[k] = 1 - f; b.near.push(k); if (k < lo) lo = k; if (k > hi) hi = k;
        tmpQ.setFromAxisAngle(Y, t.yaw); tmpS.setScalar(t.scale * sp.unit); tmpP.copy(t.pos); tmpP.y -= sp.baseY * t.scale * sp.unit; tmpM.compose(tmpP, tmpQ, tmpS);
        for (const m of meshes) { m.setMatrixAt(i, tmpM.clone().multiply(m.userData.local)); m.userData.fade.array[i] = f; m.setColorAt(i, t.tint); }
      }
      // sent to the graphics card: the stretch of imposter fades that changed, and only the slots in use of the near draws (the
      // whole arrays were sent each time, up to 750 KB a draw: flying, that was most frames, ~7 MB a frame and a stutter)
      if (full && live) sendPart(iFade, 0, live - 1); else if (hi >= lo) sendPart(iFade, lo, hi);
      for (const m of meshes) { m.count = n; if (n) for (const a of [m.instanceMatrix, m.userData.fade, m.instanceColor]) sendPart(a, 0, n - 1); }
    }
  }
  // the sun moved (the page's time of day): the imposters' own copy of its direction, and how low it is (their low-sun
  // lean, see imposterMaterial). glowScale (0..1): how much of each
  // species' own even light (the low-poly pines' light map) is on, so a tree that glows a little by day doesn't by night
  setSun(dir, glowScale = 1) {
    this.sunDir.copy(dir);
    const e = Math.asin(Math.max(-1, Math.min(1, dir.clone().normalize().y))) * 180 / Math.PI, low = 1 - THREE.MathUtils.smoothstep(e, 8, 30);   // (how low the light is: 0 from 30° up)
    for (const b of this.built) { const u = b.imposter.material.uniforms; u.sunDir.value.copy(dir).normalize(); u.lowSun.value = low;
      const dm = b.imposter.material.userData.depthMaterial; if (dm && dm.uniforms.viewDirOverride) dm.uniforms.viewDirOverride.value.copy(dir).normalize();   // (the cards drawn into the shadow map face the light too)
      if (b.glow0 === undefined) b.glow0 = u.glowLight.value; u.glowLight.value = b.glow0 * glowScale;
      for (const m of b.meshes) for (const q of [].concat(m.material)) if (q.lightMap) { if (q.userData.li0 === undefined) q.userData.li0 = q.lightMapIntensity; q.lightMapIntensity = q.userData.li0 * glowScale; } }
  }
  // the plants of the current tiles, grouped by species, and each one's imposter data written (once per list)
  refill() {
    for (const b of this.built) { b.trees = []; b.near = null; }
    const bySp = new Map(this.built.map(b => [b.sp, b]));
    for (const list of this.tilesLaid.values()) for (const t of list) bySp.get(t.sp).trees.push(t);
    for (const b of this.built) {
      const { sp, imposter, trees } = b, g = imposter.geometry, aPos = g.attributes.iPos.array, aYaw = g.attributes.iYaw.array, aScl = g.attributes.iScale.array, aTint = g.attributes.iTint.array, aFade = g.attributes.iFade.array;
      const n = Math.min(trees.length, aYaw.length);
      for (let k = 0; k < n; k++) { const t = trees[k];
        aPos[k * 3] = t.pos.x; aPos[k * 3 + 1] = t.pos.y - sp.baseY * t.scale * sp.unit; aPos[k * 3 + 2] = t.pos.z;
        aYaw[k] = t.yaw; aScl[k] = t.scale * sp.unit; aTint[k * 3] = t.tint.r; aTint[k * 3 + 1] = t.tint.g; aTint[k * 3 + 2] = t.tint.b; aFade[k] = 1; }
      g.instanceCount = n;
      if (n) for (const a of ['iPos', 'iYaw', 'iScale', 'iTint', 'iFade']) sendPart(g.attributes[a], 0, n - 1);   // (this species' own plants: its arrays have room for the whole list)
    }
    this.assignDirty = true;
  }

}
