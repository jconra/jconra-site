// TREE LAB. A forest of ez-tree trees (baked to GLB) drawn two ways: the real mesh near the
// camera, an octahedral imposter beyond an adjustable distance, crossfading through a band so
// nothing pops. The atlases are baked here at load, from the same meshes, so the far tree is a
// picture of the near one from the direction you are looking. Sliders for how many trees, how far
// the meshes reach, the atlas grid and the blend; readouts for what it costs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeImposterSteps, imposterMaterial } from '../../src/objects/imposter.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// ?noaa: no multisampling. It costs an integrated GPU a lot of bandwidth on overlapping quads,
// and the soft leaf edges need it; this is how to measure what it costs
const AA = !Q.has('noaa');
const renderer = new THREE.WebGLRenderer({ antialias: AA });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9ec9ec); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 900, 3200);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 8000);
camera.position.set(0, 40, 120);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 12, 0); controls.maxDistance = 3000;
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4); sun.position.set(300, 600, 200); scene.add(sun); scene.add(sun.target);
// the sun's shadow covers a square that follows the camera's target
sun.castShadow = false; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 1.2;
{ const c = sun.shadow.camera; c.left = c.bottom = -400; c.right = c.top = 400; c.near = 10; c.far = 2500; }
const SUN_OFF = new THREE.Vector3(300, 600, 200);
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x466b3a, 1.0); scene.add(hemi);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ── the species: baked from ez-tree presets, scaled to a height in metres ──────────────
// The calibration shape: an upside-down L, a post with an arm out along +x at the top, every face
// its own colour (+x red, -x blue, +z green, -z yellow, top white, bottom black). If the imposter
// and the mesh ever disagree about which way it points, this shows it at a glance.
function buildL() {
  const g = new THREE.Group();
  const faces = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [0xd03030, 0x3050d0, 0xf0f0f0, 0x202020, 0x30c050, 0xe0c020].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })));
  const post = faces(6, 40, 6); post.position.y = 20; g.add(post);
  const arm = faces(24, 6, 6); arm.position.set(12, 37, 0); g.add(arm);
  const tip = faces(6, 12, 6); tip.position.set(21, 28, 0); g.add(tip);
  g.updateMatrixWorld(true); return g;
}
const SPECIES = [
  { name: 'ash',   file: '../../models/trees/ash.glb',   height: 20, weight: 1 },
  { name: 'aspen', file: '../../models/trees/aspen.glb', height: 17, weight: 1 },
  { name: 'oak',   file: '../../models/trees/oak.glb',   height: 18, weight: 1 },
  { name: 'pine',  file: '../../models/trees/pine.glb',  height: 22, weight: 1 },
  { name: 'bush',  file: '../../models/trees/bush.glb',  height: 5,  weight: 0.6 },
  { name: 'L (calibration)', build: buildL, height: 20, weight: 0 },
];
// A light start: a small forest, a small atlas, imposters from close in, no shadows. The heavy
// settings are there to turn up; on a weak GPU (no WebGL2) it starts lighter still. ?light and
// ?heavy in the address force one or the other.
const weak = !renderer.capabilities.isWebGL2 || Q.has('light');
const SET = weak && !Q.has('heavy')
  ? { count: 1500, radius: 900, imposterAt: 60, band: 30, ahead: 0.75, grid: 8, cell: 64, hemi: true, blend: true, nearCap: 600, show: 'both', detail: 'coarse', a2c: true, depth: false, shadows: false, ss: false, blendDist: 200 }
  : { count: 2500, radius: 1200, imposterAt: 120, band: 40, ahead: 0.75, grid: 12, cell: 96, hemi: true, blend: true, nearCap: 1500, show: 'both', detail: 'coarse', a2c: true, depth: true, shadows: false, ss: false, blendDist: 400 };
renderer.shadowMap.enabled = SET.shadows;
let forest = [];                  // { pos, yaw, scale, tint, sp }
const built = [];                 // per species: { bake, imposterMesh, meshes: [InstancedMesh...], fade: attribute }

const loader = new GLTFLoader();
async function loadSpecies() {
  for (const sp of SPECIES) {
    // fine: the preset as it comes; coarse: fewer, bigger, single-sided leaves and fewer branch sections (baked that way)
    const root = sp.build ? sp.build() : (await loader.loadAsync(SET.detail === 'fine' ? sp.file : sp.file.replace('.glb', `_${SET.detail}.glb`))).scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    sp.unit = sp.height / size.y;                       // model units -> metres
    sp.baseY = box.min.y;                               // the tree's lowest point is not its origin: lift so it stands on the ground
    sp.root = root;
    root.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) { o.material.side = THREE.DoubleSide; if (o.material.map) o.material.map.anisotropy = 4; if (o.material.alphaTest === 0 && o.material.transparent) { o.material.alphaTest = 0.5; o.material.transparent = false; } } });
    applyEdges(root);
    $('pct').textContent = `${SPECIES.indexOf(sp) + 1} / ${SPECIES.length}`;
  }
}

// the leaves' edges: alpha-to-coverage lets the multisampling soften a cut-out's edge instead of
// it flickering on and off pixel by pixel as the tree moves (the "crawling" on near trees)
function applyEdges(root) {
  root.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && o.material.map) { o.material.alphaToCoverage = SET.a2c; o.material.alphaTest = SET.a2c ? 0.1 : 0.5; o.material.needsUpdate = true; } });
}
// The atlas edge is views x view size; at 24 x 256 that is 6144 px, 151 MB per atlas and two per
// species. Capped at 4096 px: the view size comes down to fit, and the readout says what it costs.
const ATLAS_MAX = 4096;
function capAtlas() {
  while (SET.grid * SET.cell > ATLAS_MAX && SET.cell > 32) SET.cell -= 32;
  $('cell').value = SET.cell; $('cellOut').textContent = SET.cell + ' px';
  const edge = SET.grid * SET.cell, mb = edge * edge * 4 / 1048576;
  $('atlasSize').textContent = `${edge} × ${edge} px · ${mb.toFixed(0)} MB × 2 atlases × ${SPECIES.length} species = ${(mb * 2 * SPECIES.length).toFixed(0)} MB of texture memory`;
}
// Bake every species' atlases, a row of views per frame so the page never freezes, from the
// COARSE tree (at atlas size the fine one's extra leaves are invisible). Bakes are kept by their
// settings, so a grid seen before comes back at once. `then` runs when all are done.
const bakes = new Map();
let baking = null;
function bakeAll(then) {
  const key = (sp) => `${sp.name}|${SET.detail}|${SET.grid}|${SET.cell}|${SET.hemi}`;
  const todo = SPECIES.filter(sp => !bakes.has(key(sp)));
  const finish = () => { for (const sp of SPECIES) sp.bake = bakes.get(key(sp)); baking = null; $('bakeNote').textContent = ''; then && then(); };
  if (!todo.length) { finish(); return; }
  const rows = todo.length * SET.grid * 2; let done = 0;
  // baked from the tree that is shown: the coarse tree is not the fine one with fewer leaves but a
  // differently branched tree (the generator draws its random numbers in sequence), and an
  // imposter baked from it was a picture of the wrong tree
  const steps = (function* () { for (const sp of todo) { const src = sp.root; const it = bakeImposterSteps(renderer, src, { grid: SET.grid, cell: SET.cell, hemi: SET.hemi }); for (;;) { const s = it.next(); if (s.done) { bakes.set(key(sp), s.value); break; } done++; yield; } } })();
  baking = { steps, tick() { const t0 = performance.now(); while (performance.now() - t0 < 12) { if (steps.next().done) { finish(); return; } } $('bakeNote').textContent = `baking atlases… ${Math.round(done / rows * 100)}%`; } };
}

// the forest itself: where each tree stands
function plant() {
  let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  forest = [];
  const total = SPECIES.reduce((a, s) => a + (SET.calibrate ? (s.build ? 1 : 0) : s.weight), 0);
  for (let i = 0; i < SET.count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * SET.radius;
    let pick = r() * total, sp = SPECIES[0]; for (const s of SPECIES) { pick -= SET.calibrate ? (s.build ? 1 : 0) : s.weight; if (pick <= 0) { sp = s; break; } }
    forest.push({ pos: new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d), yaw: SET.calibrate ? (r() < 0.5 ? 0 : r() * Math.PI * 2) : r() * Math.PI * 2, scale: 0.75 + r() * 0.5, tint: SET.calibrate ? new THREE.Color(0xffffff) : new THREE.Color().setHSL(0.28 + r() * 0.06, 0.35 + r() * 0.2, 0.5 + r() * 0.15), sp });
  }
}

// the draws: per species, one imposter draw of every tree of that species, and the mesh draw of
// the near ones; fades set per instance
function buildDraws() {
  for (const b of built) { scene.remove(b.imposter); for (const m of b.meshes) scene.remove(m); }
  built.length = 0;
  for (const sp of SPECIES) {
    const mine = forest.filter(t => t.sp === sp); sp.trees = mine;
    if (!mine.length) continue;
    sp.root.updateMatrixWorld(true);
    sp.order = mine.map((t, i) => i);
    // imposters
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1); geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
    const n = mine.length, pos = new Float32Array(n * 3), yaw = new Float32Array(n), scl = new Float32Array(n), tint = new Float32Array(n * 3), fade = new Float32Array(n);
    mine.forEach((t, i) => { pos.set([t.pos.x, t.pos.y - sp.baseY * t.scale * sp.unit, t.pos.z], i * 3); yaw[i] = t.yaw; scl[i] = t.scale * sp.unit; tint.set([t.tint.r, t.tint.g, t.tint.b], i * 3); fade[i] = 1; });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3)); geo.setAttribute('iYaw', new THREE.InstancedBufferAttribute(yaw, 1));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 1)); geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 3));
    const fadeAttr = new THREE.InstancedBufferAttribute(fade, 1); fadeAttr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iFade', fadeAttr);
    for (const a of ['iPos', 'iYaw', 'iScale', 'iTint']) geo.attributes[a].setUsage(THREE.DynamicDrawUsage);
    geo.instanceCount = n;
    const mat = imposterMaterial(sp.bake, { sunDir: SUN_OFF.clone(), blend: SET.blend, depth: SET.depth, shadows: SET.shadows });
    mat.uniforms.blendDist.value = SET.blendDist;
    const imposter = new THREE.Mesh(geo, mat); imposter.frustumCulled = false; scene.add(imposter);
    imposter.castShadow = SET.shadows; imposter.customDepthMaterial = mat.userData.depthMaterial;
    // meshes, instanced, with a dithered fade of their own
    const meshes = [];
    sp.root.traverse(o => {
      if (!o.isMesh) return;
      const m = new THREE.InstancedMesh(o.geometry, Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone(), Math.min(SET.nearCap, n));
      m.count = 0; m.frustumCulled = false; m.castShadow = SET.shadows; m.receiveShadow = true;
      // the same per-tree tint the imposter gets, so a tree keeps its colour across the swap
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const mf = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count), 1); mf.setUsage(THREE.DynamicDrawUsage);
      m.geometry = o.geometry.clone(); m.geometry.setAttribute('iFade', mf);
      for (const mat of [].concat(m.material)) {
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = 'attribute float iFade; varying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = iFade;');
          sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{ float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (vFade < dither) discard; }');
        };
        mat.needsUpdate = true;
      }
      m.userData.local = o.matrixWorld.clone();           // the mesh's own place inside the tree
      m.userData.fade = mf;
      scene.add(m); meshes.push(m);
    });
    built.push({ sp, imposter, fadeAttr, meshes });
  }
}

// each frame: who is near enough for the mesh, and the fades either side of the line
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
let nearCount = 0;
function assign() {
  nearCount = 0;
  const D = SET.imposterAt, B = SET.band / 2;
  // the mesh circle is pushed out ahead of the camera, so the meshes are the trees in front of you,
  // not the ones behind your back: its centre is `ahead` of the way along the line of sight
  const camP = camera.position.clone().addScaledVector(new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize(), D * SET.ahead);
  for (const b of built) {
    const { sp, imposter, fadeAttr, meshes } = b, trees = sp.trees;
    const near = [];
    // the imposters go into their attributes front to back, so the depth test throws away the pixels
    // behind nearer trees before their shader runs (when the shader is not writing depth itself)
    for (const t of trees) t.d = t.pos.distanceTo(camP);
    sp.order.sort((a, c) => trees[a].d - trees[c].d);
    const g = imposter.geometry, aPos = g.attributes.iPos.array, aYaw = g.attributes.iYaw.array, aScl = g.attributes.iScale.array, aTint = g.attributes.iTint.array;
    for (let k = 0; k < sp.order.length; k++) {
      const t = trees[sp.order[k]], d = t.d;
      // mesh solid up to D - B, gone by D + B; the imposter the other way round
      const meshFade = SET.show === 'imposters' ? 0 : THREE.MathUtils.clamp((D + B - d) / (2 * B), 0, 1);
      const impFade = SET.show === 'meshes' ? 0 : 1 - meshFade;
      fadeAttr.array[k] = impFade;
      aPos[k * 3] = t.pos.x; aPos[k * 3 + 1] = t.pos.y - sp.baseY * t.scale * sp.unit; aPos[k * 3 + 2] = t.pos.z;
      aYaw[k] = t.yaw; aScl[k] = t.scale * sp.unit; aTint[k * 3] = t.tint.r; aTint[k * 3 + 1] = t.tint.g; aTint[k * 3 + 2] = t.tint.b;
      if (meshFade > 0 && near.length < meshes[0].instanceMatrix.count) near.push([t, meshFade]);
    }
    fadeAttr.needsUpdate = true; for (const a of ['iPos', 'iYaw', 'iScale', 'iTint']) g.attributes[a].needsUpdate = true;
    imposter.visible = SET.show !== 'meshes';
    near.forEach(([t, f], k) => {
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw); tmpS.setScalar(t.scale * sp.unit); tmpP.copy(t.pos); tmpP.y -= sp.baseY * t.scale * sp.unit;
      tmpM.compose(tmpP, tmpQ, tmpS);
      for (const m of meshes) { m.setMatrixAt(k, tmpM.clone().multiply(m.userData.local)); m.userData.fade.array[k] = f; m.setColorAt(k, t.tint); }
    });
    for (const m of meshes) { m.count = near.length; m.instanceMatrix.needsUpdate = true; m.userData.fade.needsUpdate = true; m.instanceColor.needsUpdate = true; m.visible = SET.show !== 'imposters'; }
    nearCount += near.length;
  }
}

// ── the panel ───────────────────────────────────────────────────────────────────
const SLIDERS = {
  count:      [v => { SET.count = v; plant(); buildDraws(); }, v => v.toLocaleString()],
  radius:     [v => { SET.radius = v; plant(); buildDraws(); }, v => v + ' m'],
  imposterAt: [v => { SET.imposterAt = v; SET.dirty = true; }, v => v + ' m'],
  ahead:      [v => { SET.ahead = v; SET.dirty = true; }, v => v === 0 ? 'centred on the camera' : Math.round(v * 100) + '% of the way ahead'],
  band:       [v => { SET.band = v; SET.dirty = true; }, v => v + ' m'],
  grid:       [v => { SET.grid = v; capAtlas(); bakeAll(buildDraws); }, v => v + ' × ' + v],
  cell:       [v => { SET.cell = v; capAtlas(); bakeAll(buildDraws); }, v => v + ' px'],
};
for (const [id, [apply, fmt]] of Object.entries(SLIDERS)) {
  const el = $(id); const run = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); };
  el.addEventListener('change', run); el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  $(id + 'Out').textContent = fmt(+el.value);
}
$('hemi').addEventListener('change', e => { SET.hemi = e.target.checked; bakeAll(buildDraws); });
$('calibrate').addEventListener('change', e => { SET.calibrate = e.target.checked; plant(); bakeAll(buildDraws); });
$('a2c').addEventListener('change', e => { SET.a2c = e.target.checked; for (const sp of SPECIES) applyEdges(sp.root); buildDraws(); });
$('detail').addEventListener('change', async e => { SET.detail = e.target.value; $('boot').style.display = 'flex'; document.body.appendChild($('boot')); await loadSpecies(); buildDraws(); $('boot').style.display = 'none'; });   // the atlases come from the coarse tree either way
$('blend').addEventListener('change', e => { SET.blend = e.target.checked; for (const b of built) { b.imposter.material.uniforms.blend.value = SET.blend ? 1 : 0; b.imposter.material.userData.depthMaterial.uniforms.blend.value = SET.blend ? 1 : 0; } });
$('depth').addEventListener('change', e => { SET.depth = e.target.checked; for (const b of built) { b.imposter.material.uniforms.useDepth.value = SET.depth ? 1 : 0; b.imposter.material.userData.depthMaterial.uniforms.useDepth.value = SET.depth ? 1 : 0; } });
$('shadows').addEventListener('change', e => { SET.shadows = e.target.checked; sun.castShadow = SET.shadows; renderer.shadowMap.enabled = SET.shadows; for (const b of built) { b.imposter.castShadow = SET.shadows; b.imposter.material.uniforms.useShadow.value = SET.shadows ? 1 : 0; for (const m of b.meshes) m.castShadow = SET.shadows; } });
$('aa').checked = AA;
$('aa').addEventListener('change', e => { const u = new URL(location.href); if (e.target.checked) u.searchParams.delete('noaa'); else u.searchParams.set('noaa', ''); location.href = u.toString(); });
$('ss').addEventListener('change', e => { SET.ss = e.target.checked; applyScale(); });
// render scale: the picture drawn at a fraction of the screen's pixels and stretched up - the cheap
// opposite of supersampling, and the first thing to try on a weak GPU
SET.scale = 1;
function applyScale() { renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * SET.scale * (SET.ss ? 2 : 1)); }
$('scale').addEventListener('input', e => { SET.scale = +e.target.value; $('scaleOut').textContent = Math.round(SET.scale * 100) + '%'; applyScale(); });
// PROFILE: a second of frames at each of a few settings, so the lab says what costs what on this
// machine instead of leaving it to guesswork
$('profile').addEventListener('click', async () => {
  const keep = { show: SET.show, shadows: SET.shadows, scale: SET.scale, ss: SET.ss, imposterAt: SET.imposterAt };
  const setShadows = (on) => { sun.castShadow = on; renderer.shadowMap.enabled = on; for (const b of built) { b.imposter.castShadow = on; b.imposter.material.uniforms.useShadow.value = on ? 1 : 0; for (const m of b.meshes) m.castShadow = on; } };
  const fwd0 = new THREE.Vector3().subVectors(controls.target, camera.position), cam0 = camera.position.clone(), tgt0 = controls.target.clone();
  const birdsEye = () => { const c = controls.target.clone(); camera.position.set(c.x, 260, c.z + 300); controls.target.set(c.x, 0, c.z); controls.update(); SET.dirty = true; };
  const runs = [
    ['nothing drawn at all (the ceiling)', () => { scene.visible = false; }],
    ['as it is now', () => {}],
    ["bird's-eye, as it is now", () => birdsEye()],
    ["bird's-eye, imposters only", () => { birdsEye(); setShadows(false); SET.show = 'imposters'; SET.dirty = true; }],
    ['shadows off', () => setShadows(false)],
    ['imposters only, no shadows', () => { setShadows(false); SET.show = 'imposters'; SET.dirty = true; }],
    ['meshes only to 250 m, no shadows', () => { setShadows(false); SET.show = 'meshes'; SET.imposterAt = Math.max(SET.imposterAt, 250); SET.dirty = true; }],
    ['as it is now, at 50% scale', () => { SET.scale = 0.5; applyScale(); }],
    ['as it is now, window a quarter the size', () => { renderer.setSize(innerWidth / 2, innerHeight / 2, false); }],
  ];
  const out = [];
  for (const [name, apply] of runs) {
    SET.show = keep.show; setShadows(keep.shadows); SET.scale = keep.scale; SET.imposterAt = keep.imposterAt; applyScale(); renderer.setSize(innerWidth, innerHeight, false); SET.dirty = true; scene.visible = true;
    camera.position.copy(cam0); controls.target.copy(tgt0); controls.update();
    apply(); assign(); cpuMs = 0; cpuN = 0;
    // a few frames to settle (a resize rebuilds the drawing buffer), then a second of counting
    await new Promise(r => { let k = 0; const tick = () => { if (++k < 8) requestAnimationFrame(tick); else r(); }; requestAnimationFrame(tick); });
    const t0 = performance.now(); let n = 0;
    await new Promise(r => { const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else r(); }; requestAnimationFrame(tick); });
    out.push([name, Math.round(n / ((performance.now() - t0) / 1000)), (cpuMs / Math.max(1, cpuN)).toFixed(1)]);
  }
  SET.show = keep.show; setShadows(keep.shadows); SET.scale = keep.scale; SET.imposterAt = keep.imposterAt; applyScale(); renderer.setSize(innerWidth, innerHeight, false); SET.dirty = true; assign();
  camera.position.copy(cam0); controls.target.copy(tgt0); controls.update(); SET.dirty = true; assign(); scene.visible = true;
  const px = renderer.getDrawingBufferSize(new THREE.Vector2());
  $('profileOut').innerHTML = `<div style="grid-column:1/-1;color:#6d7a85">${px.x} × ${px.y} px drawn (${(px.x * px.y / 1e6).toFixed(1)} MP), pixel ratio ${devicePixelRatio}, ${AA ? 'multisampled' : 'no multisampling'}, ${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}</div>` + out.map(([n, f, c]) => `<div><b>${f} fps</b> ${n} <span style="color:#6d7a85">(${(1000 / Math.max(1, f)).toFixed(0)} ms a frame, ${c} ms of it the CPU's render call)</span></div>`).join('');
});
$('show').addEventListener('change', e => { SET.show = e.target.value; SET.dirty = true; });
$('atlasOn').addEventListener('change', e => { $('atlas').style.display = e.target.checked ? 'block' : 'none'; if (e.target.checked) drawAtlas(); });
$('atlasSpecies').addEventListener('change', drawAtlas);
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };
// the atlas, read back into a canvas to look at
function drawAtlas() {
  const sp = SPECIES.find(s => s.name === $('atlasSpecies').value) || SPECIES[0]; if (!sp.bake) return;
  const rt = sp.bake.colour, size = sp.bake.grid * sp.bake.cell;
  const target = new THREE.WebGLRenderTarget(size, size);
  // draw the atlas texture onto a target we can read (the bake's own target is not kept)
  const s2 = new THREE.Scene(), c2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  s2.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: rt, transparent: true })));
  renderer.setRenderTarget(target); renderer.render(s2, c2); renderer.setRenderTarget(null);
  const px = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(target, 0, 0, size, size, px); target.dispose();
  const cv = $('atlas'); cv.width = size; cv.height = size; const g = cv.getContext('2d'), img = g.createImageData(size, size);
  // flipped (GL reads bottom up) and lifted from linear to what a screen expects
  const lut = new Uint8Array(256); for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.pow(i / 255, 1 / 2.2) * 255);
  for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
  for (let y = 0; y < size; y++) img.data.set(px.subarray(y * size * 4, (y + 1) * size * 4), (size - 1 - y) * size * 4);
  g.putImageData(img, 0, 0);
}
// circling one tree, to watch the swap
let circling = false, circleAt = 0;
$('circle').addEventListener('change', e => { circling = e.target.checked; });
// WASD flies the camera and its target together
const keys = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true); addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ── go ─────────────────────────────────────────────────────────────────────────
for (const [id, key] of [['count', 'count'], ['radius', 'radius'], ['imposterAt', 'imposterAt'], ['band', 'band'], ['grid', 'grid'], ['cell', 'cell'], ['ahead', 'ahead']]) { $(id).value = SET[key]; $(id + 'Out').textContent = SLIDERS[id][1](SET[key]); }
$('detail').value = SET.detail; $('shadows').checked = SET.shadows; $('depth').checked = SET.depth;
loadSpecies().then(() => {
  plant(); capAtlas(); bakeAll(buildDraws);
  $('boot').style.display = 'none';
  for (const sp of SPECIES) { const o = document.createElement('option'); o.value = sp.name; o.textContent = sp.name; $('atlasSpecies').appendChild(o); }
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, SET, SPECIES, forest, built, assign, plant, buildDraws, bakeAll, drawAtlas, sun });
}).catch(e => { console.error(e); $('boot').textContent = 'LOAD FAILED — ' + e.message; });

let cpuMs = 0, cpuN = 0;
const clock = new THREE.Clock(); let fps = 60, shown = 0, assignAt = 0; const lastAssignAt = new THREE.Vector3(1e9, 0, 0), lastTargetAt = new THREE.Vector3(1e9, 0, 0);
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  const speed = (keys.shift ? 3 : 1) * 60 * dt, fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.w) move.add(fwd); if (keys.s) move.sub(fwd); if (keys.d) move.add(right); if (keys.a) move.sub(right); if (keys.q) move.y -= 1; if (keys.e) move.y += 1;
  if (move.lengthSq()) { move.normalize().multiplyScalar(speed); camera.position.add(move); controls.target.add(move); }
  if (circling) { circleAt += dt * 0.25; const r = SET.imposterAt; controls.target.set(0, 10, 0); camera.position.set(Math.sin(circleAt) * r, 14, Math.cos(circleAt) * r); }
  controls.update();
  sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(SUN_OFF);   // the shadow square follows the view
  if (baking) baking.tick();
  if ((assignAt += raw) > 0.08 && built.length && (camera.position.distanceToSquared(lastAssignAt) > 1 || controls.target.distanceToSquared(lastTargetAt) > 1 || SET.dirty)) { assignAt = 0; SET.dirty = false; lastAssignAt.copy(camera.position); lastTargetAt.copy(controls.target); assign(); }
  { const t = performance.now(); renderer.render(scene, camera); cpuMs += performance.now() - t; cpuN++; }
  if (raw > 0) fps += (1 / raw - fps) * Math.min(1, raw * 2);   // weighted by the frame's own length: a two-second frame counts in full, not five percent
  if ((shown += raw) > 0.5) { shown = 0; const i = renderer.info.render; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k triangles · ${nearCount.toLocaleString()} meshes / ${(forest.length - nearCount).toLocaleString()} imposters`; }
});
