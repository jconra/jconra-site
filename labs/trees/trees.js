// TREE LAB. A forest of ez-tree trees (baked to GLB) drawn two ways: the real mesh near the
// camera, an octahedral imposter beyond an adjustable distance, crossfading through a band so
// nothing pops. The atlases are baked here at load, from the same meshes, so the far tree is a
// picture of the near one from the direction you are looking. Sliders for how many trees, how far
// the meshes reach, the atlas grid and the blend; readouts for what it costs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeImposter, imposterMaterial } from '../../src/objects/imposter.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9ec9ec); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 900, 3200);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 8000);
camera.position.set(0, 40, 120);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 12, 0); controls.maxDistance = 3000;
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4); sun.position.set(300, 600, 200); scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x466b3a, 1.0); scene.add(hemi);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

// ── the species: baked from ez-tree presets, scaled to a height in metres ──────────────
const SPECIES = [
  { name: 'ash',   file: '../../models/trees/ash.glb',   height: 20, weight: 1 },
  { name: 'aspen', file: '../../models/trees/aspen.glb', height: 17, weight: 1 },
  { name: 'oak',   file: '../../models/trees/oak.glb',   height: 18, weight: 1 },
  { name: 'pine',  file: '../../models/trees/pine.glb',  height: 22, weight: 1 },
  { name: 'bush',  file: '../../models/trees/bush.glb',  height: 5,  weight: 0.6 },
];
const SET = { count: 4000, radius: 1400, imposterAt: 220, band: 60, grid: 12, cell: 128, hemi: true, blend: true, nearCap: 3000, show: 'both' };
let forest = [];                  // { pos, yaw, scale, tint, sp }
const built = [];                 // per species: { bake, imposterMesh, meshes: [InstancedMesh...], fade: attribute }

const loader = new GLTFLoader();
async function loadSpecies() {
  for (const sp of SPECIES) {
    const gltf = await loader.loadAsync(sp.file);
    const root = gltf.scene; root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    sp.unit = sp.height / size.y;                       // model units -> metres
    sp.root = root;
    root.traverse(o => { if (o.isMesh) { o.material.side = THREE.DoubleSide; if (o.material.map) o.material.map.anisotropy = 4; if (o.material.alphaTest === 0 && o.material.transparent) { o.material.alphaTest = 0.5; o.material.transparent = false; } } });
    $('pct').textContent = `${SPECIES.indexOf(sp) + 1} / ${SPECIES.length}`;
  }
}

// bake every species' atlases (again, when the grid changes)
function bakeAll() {
  for (const sp of SPECIES) {
    if (sp.bake) { sp.bake.colour.dispose(); sp.bake.normal.dispose(); }
    sp.bake = bakeImposter(renderer, sp.root, { grid: SET.grid, cell: SET.cell, hemi: SET.hemi });
  }
}

// the forest itself: where each tree stands
function plant() {
  let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  forest = [];
  const total = SPECIES.reduce((a, s) => a + s.weight, 0);
  for (let i = 0; i < SET.count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * SET.radius;
    let pick = r() * total, sp = SPECIES[0]; for (const s of SPECIES) { pick -= s.weight; if (pick <= 0) { sp = s; break; } }
    forest.push({ pos: new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d), yaw: r() * Math.PI * 2, scale: 0.75 + r() * 0.5, tint: new THREE.Color().setHSL(0.28 + r() * 0.06, 0.35 + r() * 0.2, 0.5 + r() * 0.15), sp });
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
    // imposters
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1); geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
    const n = mine.length, pos = new Float32Array(n * 3), yaw = new Float32Array(n), scl = new Float32Array(n), tint = new Float32Array(n * 3), fade = new Float32Array(n);
    mine.forEach((t, i) => { pos.set(t.pos.toArray(), i * 3); yaw[i] = t.yaw; scl[i] = t.scale * sp.unit; tint.set([t.tint.r, t.tint.g, t.tint.b], i * 3); fade[i] = 1; });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3)); geo.setAttribute('iYaw', new THREE.InstancedBufferAttribute(yaw, 1));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 1)); geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 3));
    const fadeAttr = new THREE.InstancedBufferAttribute(fade, 1); fadeAttr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iFade', fadeAttr);
    geo.instanceCount = n;
    const mat = imposterMaterial(sp.bake, { sunDir: sun.position.clone(), blend: SET.blend });
    const imposter = new THREE.Mesh(geo, mat); imposter.frustumCulled = false; scene.add(imposter);
    // meshes, instanced, with a dithered fade of their own
    const meshes = [];
    sp.root.traverse(o => {
      if (!o.isMesh) return;
      const m = new THREE.InstancedMesh(o.geometry, o.material.clone(), Math.min(SET.nearCap, n));
      m.count = 0; m.frustumCulled = false;
      const mf = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count), 1); mf.setUsage(THREE.DynamicDrawUsage);
      m.geometry = o.geometry.clone(); m.geometry.setAttribute('iFade', mf);
      m.material.onBeforeCompile = (sh) => {
        sh.vertexShader = 'attribute float iFade; varying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = iFade;');
        sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{ float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (vFade < dither) discard; }');
      };
      m.material.needsUpdate = true;
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
  const D = SET.imposterAt, B = SET.band / 2, camP = camera.position;
  for (const b of built) {
    const { sp, imposter, fadeAttr, meshes } = b, trees = sp.trees;
    const near = [];
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i], d = t.pos.distanceTo(camP);
      // mesh solid up to D - B, gone by D + B; the imposter the other way round
      const meshFade = SET.show === 'imposters' ? 0 : THREE.MathUtils.clamp((D + B - d) / (2 * B), 0, 1);
      const impFade = SET.show === 'meshes' ? 0 : 1 - meshFade;
      fadeAttr.array[i] = impFade;
      if (meshFade > 0 && near.length < meshes[0].instanceMatrix.count) near.push([t, meshFade]);
    }
    fadeAttr.needsUpdate = true;
    imposter.visible = SET.show !== 'meshes';
    near.forEach(([t, f], k) => {
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw); tmpS.setScalar(t.scale * sp.unit); tmpP.copy(t.pos);
      tmpM.compose(tmpP, tmpQ, tmpS);
      for (const m of meshes) { m.setMatrixAt(k, tmpM.clone().multiply(m.userData.local)); m.userData.fade.array[k] = f; }
    });
    for (const m of meshes) { m.count = near.length; m.instanceMatrix.needsUpdate = true; m.userData.fade.needsUpdate = true; m.visible = SET.show !== 'imposters'; }
    nearCount += near.length;
  }
}

// ── the panel ───────────────────────────────────────────────────────────────────
const SLIDERS = {
  count:      [v => { SET.count = v; plant(); buildDraws(); }, v => v.toLocaleString()],
  radius:     [v => { SET.radius = v; plant(); buildDraws(); }, v => v + ' m'],
  imposterAt: [v => SET.imposterAt = v, v => v + ' m'],
  band:       [v => SET.band = v, v => v + ' m'],
  grid:       [v => { SET.grid = v; bakeAll(); buildDraws(); }, v => v + ' × ' + v],
  cell:       [v => { SET.cell = v; bakeAll(); buildDraws(); }, v => v + ' px'],
};
for (const [id, [apply, fmt]] of Object.entries(SLIDERS)) {
  const el = $(id); const run = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); };
  el.addEventListener('change', run); el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  $(id + 'Out').textContent = fmt(+el.value);
}
$('hemi').addEventListener('change', e => { SET.hemi = e.target.checked; bakeAll(); buildDraws(); });
$('blend').addEventListener('change', e => { SET.blend = e.target.checked; for (const b of built) b.imposter.material.uniforms.blend.value = SET.blend ? 1 : 0; });
$('show').addEventListener('change', e => { SET.show = e.target.value; });
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
loadSpecies().then(() => {
  bakeAll(); plant(); buildDraws();
  $('boot').remove();
  for (const sp of SPECIES) { const o = document.createElement('option'); o.value = sp.name; o.textContent = sp.name; $('atlasSpecies').appendChild(o); }
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, SET, SPECIES, forest, built, assign, plant, buildDraws, bakeAll, drawAtlas, sun });
}).catch(e => { console.error(e); $('boot').textContent = 'LOAD FAILED — ' + e.message; });

const clock = new THREE.Clock(); let fps = 60, shown = 0, assignAt = 0;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  const speed = (keys.shift ? 3 : 1) * 60 * dt, fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.w) move.add(fwd); if (keys.s) move.sub(fwd); if (keys.d) move.add(right); if (keys.a) move.sub(right); if (keys.q) move.y -= 1; if (keys.e) move.y += 1;
  if (move.lengthSq()) { move.normalize().multiplyScalar(speed); camera.position.add(move); controls.target.add(move); }
  if (circling) { circleAt += dt * 0.25; const r = SET.imposterAt; controls.target.set(0, 10, 0); camera.position.set(Math.sin(circleAt) * r, 14, Math.cos(circleAt) * r); }
  controls.update();
  if ((assignAt += raw) > 0.08 && built.length) { assignAt = 0; assign(); }
  renderer.render(scene, camera);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if ((shown += raw) > 0.5) { shown = 0; const i = renderer.info.render; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k triangles · ${nearCount.toLocaleString()} meshes / ${(forest.length - nearCount).toLocaleString()} imposters`; }
});
