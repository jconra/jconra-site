// FOREST. The Tree Lab's system packaged for a scene: species baked to GLB, their imposter atlases
// baked here at load (a row of views per frame), the trees laid out on tiles that are re-laid
// around a moving point so the forest never ends, meshes for the nearest ring and imposters for
// the rest with a dithered crossfade. Settings come from the Tree Lab's findings: 192 px cells,
// the mesh circle ahead of the camera, and a light mode for machines without WebGL2 (imposters
// only, no shadows).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeImposterSteps, imposterMaterial } from './imposter.js';

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export const FOREST_SPECIES = [
  // soften: the foliage's normals bent this far toward up (both the meshes and the imposters)
  { name: 'ash',   file: 'ash',   height: 20, weight: 1, soften: 0.5 },
  { name: 'aspen', file: 'aspen', height: 17, weight: 1, soften: 0.5 },
  { name: 'oak',   file: 'oak',   height: 18, weight: 1.2, soften: 0.5 },
  { name: 'pine',  file: 'pine',  height: 22, weight: 1.4, soften: 0.5 },
  { name: 'bush',  file: 'bush',  height: 5,  weight: 0.5, soften: 0.5 },
];

export class Forest {
  // `clear(x, z)` says whether a spot is kept free of trees (the town); `light` is the weak-GPU mode
  // `species`: a list like FOREST_SPECIES; an entry may bring its own `root` (an Object3D, already
  // loaded) instead of a file, its own `grid` / `cell` for a cheaper atlas, `upNormals` (lit like the
  // ground, both sides of every card) and `tint: false`. `fixed`: a list of { x, z, sp (index), scale,
  // yaw } to plant instead of the endless tiles; `heightAt(x, z)` stands them on uneven ground.
  constructor(renderer, scene, { base = '/models/trees/', tile = 420, tiles = 7, perTile = 90, imposterAt = 140, band = 40, ahead = 0.75,
                                 grid = 12, cell = 192, light = false, detail = 'coarse', clear = null, sunDir = new THREE.Vector3(0.5, 1, 0.3), shadows = false,
                                 species = null, fixed = null, heightAt = null, nearCap = 400 } = {}) {
    Object.assign(this, { renderer, scene, base, tile, tiles, perTile, imposterAt: light ? 0 : imposterAt, band, ahead, grid: light ? 8 : grid, cell, detail, clear, sunDir, shadows: shadows && !light, light, fixed, heightAt, nearCap });
    this.group = new THREE.Group(); scene.add(this.group);
    this.species = (species || FOREST_SPECIES).map(s => ({ ...s }));
    this.tilesLaid = new Map();          // "tx,tz" -> [{ pos, yaw, scale, tint, sp }]
    this.built = [];
    this.ready = false; this.baking = null;
    this.loaded = this.load();
  }

  async load() {
    const loader = new GLTFLoader();
    for (const sp of this.species) {
      const root = sp.root || (await loader.loadAsync(`${this.base}${sp.file}${this.detail === 'fine' ? '' : '_' + this.detail}.glb`)).scene; root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
      sp.unit = sp.height / size.y; sp.baseY = box.min.y; sp.root = root;
      root.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) { o.material.side = THREE.DoubleSide; if (o.material.map) o.material.map.anisotropy = 4; if (o.material.transparent) { o.material.alphaTest = 0.5; o.material.transparent = false; } } });
    }
    // the atlases, a row of views per frame
    const todo = this.species.slice();
    const self = this;
    const steps = (function* () { for (const sp of todo) { if (sp.bake) continue;   // brought already baked
 const it = bakeImposterSteps(self.renderer, sp.root, { grid: self.light ? Math.min(8, sp.grid || self.grid) : (sp.grid || self.grid), cell: sp.cell || self.cell, hemi: true, upNormals: !!(sp.upNormals || sp.soften) }); for (;;) { const s = it.next(); if (s.done) { sp.bake = s.value; break; } yield; } } })();
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
      this.tilesLaid.set('fixed', this.fixed.map((f, i) => { const r = rnd(i * 2654435761 + 7), sp = this.species[f.sp];
        return { pos: new THREE.Vector3(f.x, this.heightAt ? this.heightAt(f.x, f.z) : 0, f.z), yaw: f.yaw ?? r() * Math.PI * 2, scale: f.scale ?? 0.7 + r() * 0.6,
          tint: sp.tint === false ? new THREE.Color(1, 1, 1).multiplyScalar(0.85 + r() * 0.3) : new THREE.Color().setHSL(0.26 + r() * 0.08, 0.35 + r() * 0.25, 0.62 + r() * 0.18), sp }; }));
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

  // the draws: per species, an imposter draw with room for every tree of that species, and mesh draws for the near ring
  buildDraws() {
    const cap = this.fixed ? Math.max(1, this.fixed.length) : this.tiles * this.tiles * this.perTile;
    for (const sp of this.species) {
      const geo = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1); geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
      const n = cap;
      for (const [name, size] of [['iPos', 3], ['iYaw', 1], ['iScale', 1], ['iTint', 3], ['iFade', 1]]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
      geo.instanceCount = 0;
      const mat = imposterMaterial(sp.bake, { sunDir: this.sunDir, blend: true, depth: !this.light, shadows: this.shadows, soften: sp.soften || 0 });
      if (this.calm) for (const [k, v] of Object.entries(this.calm)) mat.uniforms[k].value = v;
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
        for (const mat of [].concat(m.material)) {
          mat.onBeforeCompile = (sh) => {
            sh.vertexShader = 'attribute float iFade; varying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = iFade;');
            if (sp.upNormals || sp.soften) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')
              + (sp.soften ? `\nnormal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), ${sp.soften.toFixed(2)}));` : ''));
            sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{ float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (vFade < dither) discard; }');
          };
          mat.customProgramCacheKey = () => 'forest-mesh' + (sp.upNormals ? '-up' : '') + (sp.soften ? '-s' + sp.soften : ''); mat.needsUpdate = true;
        }
        m.userData.local = o.matrixWorld.clone(); m.userData.fade = mf;
        this.group.add(m); meshes.push(m);
      });
      this.built.push({ sp, imposter, meshes, trees: [] });
    }
    this.refill();
  }
  // the trees of the current tiles, grouped by species
  refill() {
    for (const b of this.built) b.trees = [];
    for (const list of this.tilesLaid.values()) for (const t of list) this.built.find(b => b.sp === t.sp).trees.push(t);
    this.assignDirty = true;
  }

  // far plants calmed toward one colour: { calmCol (THREE.Color), calmFrom, calmTo (m), calmAmt (0..1) };
  // kept for species not built yet
  setCalm(c) {
    this.calm = { ...(this.calm || {}), ...c };
    for (const b of this.built) { const u = b.imposter.material.uniforms; for (const [k, v] of Object.entries(this.calm)) if (u[k]) u[k].value = v; }
  }

  assign(camera, target) {
    const D = this.imposterAt, B = this.band / 2;
    const fwd = new THREE.Vector3().subVectors(target, camera.position).setY(0).normalize();
    const camP = camera.position.clone().addScaledVector(fwd, D * this.ahead);
    if (!this.assignDirty && this.lastAt && this.lastAt.distanceToSquared(camP) < 4) return;
    this.assignDirty = false; this.lastAt = camP.clone();
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
    for (const b of this.built) {
      const { sp, imposter, meshes, trees } = b;
      for (const t of trees) t.d = t.pos.distanceTo(camP);
      trees.sort((a, c) => a.d - c.d);
      const g = imposter.geometry, aPos = g.attributes.iPos.array, aYaw = g.attributes.iYaw.array, aScl = g.attributes.iScale.array, aTint = g.attributes.iTint.array, aFade = g.attributes.iFade.array;
      const near = [];
      for (let k = 0; k < trees.length; k++) {
        const t = trees[k];
        const meshFade = meshes.length && D > 0 ? (B > 0 ? THREE.MathUtils.clamp((D + B - t.d) / (2 * B), 0, 1) : t.d < D ? 1 : 0) : 0;   // imposterAt 0: all imposters
        aFade[k] = 1 - meshFade;
        aPos[k * 3] = t.pos.x; aPos[k * 3 + 1] = t.pos.y - sp.baseY * t.scale * sp.unit; aPos[k * 3 + 2] = t.pos.z;
        aYaw[k] = t.yaw; aScl[k] = t.scale * sp.unit; aTint[k * 3] = t.tint.r; aTint[k * 3 + 1] = t.tint.g; aTint[k * 3 + 2] = t.tint.b;
        if (meshFade > 0 && meshes.length && near.length < meshes[0].instanceMatrix.count) near.push([t, meshFade]);
      }
      g.instanceCount = trees.length;
      for (const a of ['iPos', 'iYaw', 'iScale', 'iTint', 'iFade']) g.attributes[a].needsUpdate = true;
      near.forEach(([t, f], k) => {
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw); tmpS.setScalar(t.scale * sp.unit); tmpP.copy(t.pos); tmpP.y -= sp.baseY * t.scale * sp.unit;
        tmpM.compose(tmpP, tmpQ, tmpS);
        for (const m of meshes) { m.setMatrixAt(k, tmpM.clone().multiply(m.userData.local)); m.userData.fade.array[k] = f; m.setColorAt(k, t.tint); }
      });
      for (const m of meshes) { m.count = near.length; m.instanceMatrix.needsUpdate = true; m.userData.fade.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    }
  }
}
