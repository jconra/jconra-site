// PROP VIEWER. The old quarters (models/quarters.glb) taken apart: every loose mesh listed, shown
// one at a time on a turntable at a size that fills the view, with its measurements, or all of
// them together as the room they came from. For deciding which ones move to the new room.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e12);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// a plinth to stand things on, and a faint floor grid for scale (10 cm squares)
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.9 }));
floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(2.4, 24, 0x2a3340, 0x1c232c); grid.position.y = 0.001; scene.add(grid);

// light presets: the same idea as the character lab, flat by default
const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b8b8, 2.2); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 0.3); key.position.set(2, 3, 2); key.castShadow = true; scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb6cc, 0); fill.position.set(-3, 1, -2); scene.add(fill);
const LIGHTS = {
  flat:   { hemi: 2.2, sky: 0xffffff, ground: 0xb8b8b8, key: 0.3, fill: 0, exposure: 1.0 },
  studio: { hemi: 0.6, sky: 0xdfe8f0, ground: 0x30363c, key: 2.6, fill: 0.8, exposure: 1.0 },
  cabin:  { hemi: 0.45, sky: 0x9fb6cc, ground: 0x20262d, key: 1.8, fill: 1.2, exposure: 1.1 },
};
function setLight(name) {
  const L = LIGHTS[name];
  hemi.intensity = L.hemi; hemi.color.setHex(L.sky); hemi.groundColor.setHex(L.ground);
  key.intensity = L.key; fill.intensity = L.fill;
  $('exposure').value = L.exposure; renderer.toneMappingExposure = L.exposure; $('exposureOut').textContent = L.exposure.toFixed(2);
}

const stage = new THREE.Group(); scene.add(stage);      // the turntable
const holder = new THREE.Group(); stage.add(holder);    // the prop, moved so it stands centred on the plinth
let props = [], roomParts = [], current = -1, all = false, wire = false, texOn = true;
const ROOM_METRES = 3.4;
const info = {};                                        // per prop: size, triangles, where it stood

new GLTFLoader().load('../../models/quarters.glb', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = ROOM_METRES / Math.max(size.x, size.z);
  model.scale.setScalar(scale);
  model.position.set(-box.min.x * scale - (size.x * scale) / 2, -box.min.y * scale, -box.min.z * scale - (size.z * scale) / 2);
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.castShadow = o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.userData.map = m.map; } m.side = THREE.DoubleSide; }
    const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    info[o.name] = { size: s, centre: c, min: b.min.clone(), tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
                     matrix: o.matrixWorld.clone() };
    if (/^(Prop_|Chair|FloorTile|Windows)/.test(o.name)) props.push(o); else roomParts.push(o);
  }
  // biggest first: the ones worth carrying over come up first
  props.sort((a, b) => { const A = info[a.name].size, B = info[b.name].size; return B.x * B.y * B.z - A.x * A.y * A.z; });
  // detach everything from the model so each can be shown alone; keep the world transform
  for (const o of [...props, ...roomParts]) { o.matrix.copy(o.matrixWorld); o.matrix.decompose(o.position, o.quaternion, o.scale); o.parent = null; }
  buildList();
  const want = Q.get('prop'); const i = props.findIndex(p => p.name === want);
  show(i >= 0 ? i : 0);
  $('boot').remove();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, props, roomParts, show, showAll, info });
}, (e) => { if (e.total) $('pct').textContent = Math.round(e.loaded / e.total * 100) + '%'; },
   (e) => { console.error(e); $('boot').textContent = 'LOAD FAILED — ' + e.message; });

function buildList() {
  const list = $('list'); list.innerHTML = '';
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'everything'; b.style.gridColumn = '1 / -1';
  b.onclick = showAll; b.id = 'allBtn'; list.appendChild(b);
  props.forEach((p, i) => {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = p.name.replace('Prop_', '');
    el.onclick = () => show(i); el.dataset.i = i; list.appendChild(el);
  });
}

function clearStage() {
  for (const o of [...holder.children]) holder.remove(o);
  for (const o of [...scene.children]) if (o.userData.roomPart) scene.remove(o);
}

// one prop: stood on the plinth at its real size, centred, the camera pulled back to fit it
function show(i) {
  all = false; current = i;
  const p = props[i], I = info[p.name];
  clearStage();
  p.position.set(0, 0, 0); p.quaternion.identity(); p.scale.setScalar(1);
  I.matrix.decompose(p.position, p.quaternion, p.scale);
  holder.add(p);
  holder.position.set(-I.centre.x, -I.min.y, -I.centre.z);
  floor.visible = grid.visible = true;
  const r = Math.max(I.size.x, I.size.y, I.size.z);
  // on a phone the panel covers the lower half of the screen, so the prop is framed in the upper half
  const lift = innerWidth <= 700 ? -r * 0.55 : 0;
  camera.position.set(r * 1.6, I.size.y * 0.5 + r * 0.9, r * 1.9);
  controls.target.set(0, I.size.y / 2 + lift, 0); controls.update();
  camera.near = r * 0.01; camera.far = r * 60; camera.updateProjectionMatrix();
  $('pname').textContent = p.name;
  $('psize').textContent = `${(I.size.x * 100).toFixed(0)} × ${(I.size.y * 100).toFixed(0)} × ${(I.size.z * 100).toFixed(0)} cm`;
  $('ptris').textContent = Math.round(I.tris).toLocaleString();
  $('pwhere').textContent = `x ${I.centre.x.toFixed(2)}  y ${I.centre.y.toFixed(2)}  z ${I.centre.z.toFixed(2)} m`;
  $('caption').textContent = p.name.replace('Prop_', 'Prop ');
  document.querySelectorAll('#list button').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
  applyLook();
}

// the whole room as it was, every part in its place
function showAll() {
  all = true; current = -1;
  clearStage();
  for (const o of [...props, ...roomParts]) { info[o.name].matrix.decompose(o.position, o.quaternion, o.scale); o.userData.roomPart = true; scene.add(o); }
  floor.visible = grid.visible = false;
  camera.position.set(2.4, 2.5, 2.7); controls.target.set(0, 1.15, -0.6); controls.update();
  camera.near = 0.02; camera.far = 100; camera.updateProjectionMatrix();
  $('pname').textContent = 'everything'; $('psize').textContent = ''; $('ptris').textContent = ''; $('pwhere').textContent = '';
  $('caption').textContent = 'the old quarters, all ' + props.length + ' props';
  document.querySelectorAll('#list button').forEach(b => b.classList.toggle('on', b.id === 'allBtn'));
  applyLook();
}

function applyLook() {
  for (const o of [...props, ...roomParts]) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { m.wireframe = wire; m.map = texOn ? (m.userData.map || null) : null; m.color.setHex(texOn ? 0xffffff : 0x9aa3ab); m.needsUpdate = true; }
  }
}

$('prev').onclick = () => show((current - 1 + props.length) % props.length);
$('next').onclick = () => show((current + 1) % props.length);
addEventListener('keydown', e => { if (e.key === 'ArrowLeft') $('prev').click(); if (e.key === 'ArrowRight') $('next').click(); });
for (const [name] of Object.entries(LIGHTS)) { /* select handles it */ }
$('light').addEventListener('change', e => setLight(e.target.value));
$('exposure').addEventListener('input', e => { renderer.toneMappingExposure = +e.target.value; $('exposureOut').textContent = (+e.target.value).toFixed(2); });
$('wire').addEventListener('change', e => { wire = e.target.checked; applyLook(); });
$('tex').addEventListener('change', e => { texOn = e.target.checked; applyLook(); });
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };
for (const [name, fn] of [['front', () => aim(0, 0.3, 1)], ['side', () => aim(1, 0.3, 0)], ['top', () => aim(0.01, 1, 0.01)], ['back', () => aim(0, 0.3, -1)]]) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = fn; $('views').appendChild(b);
}
function aim(x, y, z) {
  if (current < 0) return;
  const I = info[props[current].name], r = Math.max(I.size.x, I.size.y, I.size.z) * 2.2;
  const lift = innerWidth <= 700 ? -r * 0.25 : 0;
  camera.position.set(x * r, I.size.y / 2 + y * r, z * r); controls.target.set(0, I.size.y / 2 + lift, 0); controls.update();
}
setLight('flat');
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, shown = 0;
renderer.setAnimationLoop(() => {
  clock.update?.();
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  if (!all && $('spin').checked) stage.rotation.y += dt * 0.35;
  controls.update();
  renderer.render(scene, camera);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if ((shown += raw) > 0.5) { shown = 0; const line = '<b>' + Math.round(fps) + ' fps</b>'; $('hud').innerHTML = line; $('fps').innerHTML = line; }
});
