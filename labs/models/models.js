// MODEL LAB. Every model on the site in one viewer: pick one from the sections, orbit it, play the
// animations built into it, take it apart into its parts. It replaced the Bug, Character, Prop,
// Hoodie and ship viewers. The lighting is the Character Lab's (tone mapping, a small environment
// for the materials to pick up, key/rim/bounce lights), since that was tuned against Tripo's viewer.
//
// glTF files load as they are. Shipwrecked and the 2019 site saved theirs in three.js's old JSON
// format, which src/loaders/legacyJSON.js reads, walk cycles and all.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadLegacyJSON } from '../../src/loaders/legacyJSON.js';

const M = '/models/';
const TREE_MB = {ash: 1.6, ash_coarse: 0.9, ash_sparse: 0.8, aspen: 1.3, aspen_coarse: 1.1, aspen_sparse: 1.1, bush: 1.2, bush_coarse: 0.8, bush_sparse: 0.8, oak: 1.5, oak_coarse: 0.9, oak_sparse: 0.9, pine: 1.7, pine_coarse: 1.0, pine_sparse: 1.0};
const SW = { textures: M + 'shipwrecked/textures/' }, OS = { textures: M + 'old-site/textures/' };
// [section, [[id, name, file, MB, note, legacy options]]]
const CATALOGUE = [
  ['Jacob', [
    ['jacob4', 'Jacob (model 4)', 'jacob4.glb', 10.6, 'Jacob\'s own Blender build; the one in the film.'],
    ['jacob5', 'Jacob (model 5)', 'jacob5.glb', 11.9, 'Swapped out of the film for model 4.'],
    ['jacob1', 'Jacob (model 1)', 'jacob1.glb', 4.9, 'The first Tripo generation, rigged by Tripo.'],
    ['jacob2', 'Jacob (model 2)', 'jacob2.glb', 13.0, 'Tripo generation given model 1\'s skeleton in Blender.'],
    ['jacob3', 'Jacob (model 3)', 'jacob3.glb', 6.0, 'Tripo generation given model 1\'s skeleton in Blender.'],
    ['jay', 'Jay', 'jay.glb', 0.2, 'The avatar from the old station landing page.'],
  ]],
  ['People and animals', [
    ['stephen', 'Stephen', 'stephen.glb', 5.4, 'The boxer in the Boxing project.'],
    ['chimpanzee', 'Chimpanzee', 'chimpanzee.glb', 6.0, 'Stephen\'s first opponent in Boxing.'],
  ]],
  ['Creatures', [
    ['insect', 'Insect', 'insect_animated.glb', 1.0, 'The warrior bug from Boxing round two and the old Bug Lab.'],
    ['spider', 'Spider', 'spider_animated.glb', 2.0, 'The other bug from the old Bug Lab.'],
    ['husky', 'Husky', 'props/husky.glb', 2.6, 'The 404 page\'s dog; its head tilts on the neck bone (bone_23).'],
  ]],
  ['Clothes and props', [
    ['hoodie1', 'Skyline hoodie A', 'hoodie1.glb', 5.9, 'Tripo generation of the city skyline hoodie.'],
    ['hoodie2', 'Skyline hoodie B', 'hoodie2.glb', 6.9, 'The second generation of the same hoodie.'],
    ['helmet', 'Flight helmet', 'props/helmet.glb', 1.5, 'Worn in the fighter.'],
    ['bass', 'Bass guitar', 'props/bass.glb', 1.1, 'Hangs on the cabin wall.'],
    ['gladius', 'Gladius', 'props/gladius.glb', 3.9, 'Aegis Gladius, made to decorate the quarters; detailed enough to fly.'],
  ]],
  ['Station kit', [
    ['ring5t', 'Ring 5t', 'kit/ring5t.glb', 7.2, 'The ring the station uses.'],
    ['ring3t', 'Ring 3t', 'kit/ring3t.glb', 2.2], ['ring', 'Ring', 'kit/ring.glb', 7.8], ['ring7', 'Ring 7', 'kit/ring7.glb', 0.9],
    ['ring5', 'Ring 5', 'kit/ring5.glb', 1.0], ['ring1', 'Ring 1', 'kit/ring1.glb', 0.1], ['ring2', 'Ring 2', 'kit/ring2.glb', 0.1],
    ['ring3', 'Ring 3', 'kit/ring3.glb', 0.1], ['ring4', 'Ring 4', 'kit/ring4.glb', 0.1],
    ['tower', 'Tower', 'kit/tower.glb', 1.6], ['arm1', 'Arm 1', 'kit/arm1.glb', 1.7], ['arm2', 'Arm 2', 'kit/arm2.glb', 1.5],
    ['satellite', 'Satellite', 'kit/satellite.glb', 1.6],
    ['hangar2', 'Hangar 2', 'kit/hangar2.glb', 6.8, 'The hangar in the film.'], ['hangar', 'Hangar', 'kit/hangar.glb', 1.5],
    ['ship1', 'Fighter (open canopy)', 'kit/ship1.glb', 5.0, 'Jacob\'s fighter in the film.'],
    ['ship2', 'Fighter pair', 'kit/ship2.glb', 5.5, 'Parked in the hangar.'],
    ['fighter', 'Fighter', 'kit/fighter.glb', 4.1], ['freighter', 'Freighter', 'kit/freighter.glb', 5.8],
  ]],
  ['Old station', [
    ['station_tripo', 'Station (Tripo)', 'station_tripo.glb', 12.6, 'The Station Lab\'s model.'],
    ['station', 'Station', 'station.glb', 0.4], ['station2', 'Station 2', 'station2.glb', 0.6, 'From the old landing page.'],
    ['stationTop', 'Station top', 'stationTop.glb', 0.2, 'From the old landing page.'],
    ['ship', 'Shuttle', 'ship.glb', 0.01, 'From the old landing page.'],
  ]],
  ['Rooms', [
    ['quarters_smart', 'Quarters (clean)', 'quarters_smart.glb', 5.0, 'The cabin in the film.'],
    ['quarters_lite', 'Quarters (light)', 'quarters_lite.glb', 7.7],
    ['quarters', 'Quarters (full)', 'quarters.glb', 17.7, 'Every loose piece of the old cabin; see Parts.'],
  ]],
  ['Trees', ['ash', 'aspen', 'oak', 'pine', 'bush'].flatMap(t => [
    [t, t[0].toUpperCase() + t.slice(1), `trees/${t}.glb`, TREE_MB[t], 'ez-tree preset, fine leaves.'],
    [t + '_coarse', t[0].toUpperCase() + t.slice(1) + ' (coarse)', `trees/${t}_coarse.glb`, TREE_MB[t + '_coarse']],
    [t + '_sparse', t[0].toUpperCase() + t.slice(1) + ' (sparse)', `trees/${t}_sparse.glb`, TREE_MB[t + '_sparse']],
  ])],
  ['Shipwrecked', [
    ['sw_figure', 'Castaway', 'shipwrecked/figure.json', 0.6, 'Run cycle.', SW], ['sw_boar', 'Boar', 'shipwrecked/boar.json', 0.05, 'Walk cycle.', SW],
    ['sw_crab', 'Crab', 'shipwrecked/crab.json', 0.03, 'Walk cycle.', SW], ['sw_shark', 'Shark', 'shipwrecked/shark.json', 0.01, null, SW],
    ['sw_ship', 'Ship', 'shipwrecked/ship.json', 0.02, null, SW], ['sw_boat', 'Boat', 'shipwrecked/boat.json', 0.02, null, SW],
    ['sw_cottage', 'Cottage', 'shipwrecked/cottage.json', 0.02, null, SW], ['sw_twighut', 'Twig hut', 'shipwrecked/twighut.json', 0.03, null, SW],
    ['sw_leanto', 'Lean-to', 'shipwrecked/leanto.json', 0, null, SW], ['sw_campfire', 'Campfire', 'shipwrecked/campfire.json', 0.01, null, SW],
    ['sw_palm', 'Palm', 'shipwrecked/palm.json', 0.02, null, SW], ['sw_pine', 'Pine', 'shipwrecked/pine.json', 0, null, SW],
    ['sw_bush', 'Bush', 'shipwrecked/bush.json', 0.02, null, SW], ['sw_flower', 'Flower', 'shipwrecked/flower.json', 0, null, SW],
    ['sw_grassblade', 'Grass blade', 'shipwrecked/grassblade.json', 0, null, SW],
    ['sw_axe', 'Axe', 'shipwrecked/axe.json', 0, null, SW], ['sw_bow', 'Bow', 'shipwrecked/bow.json', 0, null, SW],
    ['sw_spear', 'Spear', 'shipwrecked/spear.json', 0, null, SW], ['sw_sticks', 'Sticks', 'shipwrecked/sticks.json', 0, null, SW],
    ['sw_shell', 'Shell', 'shipwrecked/shell.json', 0, null, SW], ['sw_starfish', 'Starfish', 'shipwrecked/starfish.json', 0, null, SW],
  ]],
  ['Old site', [
    ['os_miku', 'Miku', 'old-site/miku.min.json', 0.2, 'Idle, run, jump and slide.', OS],
    ['os_figure', 'Figure', 'old-site/figure.json', 0.7, null, OS], ['os_figureAnimated', 'Figure (jump)', 'old-site/figureAnimated.json', 0.2, null, OS],
    ['os_female', 'Female', 'old-site/female.json', 0.04, null, OS], ['os_basemesh', 'Base mesh', 'old-site/BaseMesh_Anim.json', 0.4, null, OS],
    ['os_rigged', 'Rigged runner', 'old-site/rigged.json', 0.2, null, OS], ['os_mine', 'Jumper', 'old-site/mine.json', 0.2, null, OS],
    ['os_legs', 'Legs', 'old-site/legs.json', 0.03, null, OS], ['os_ship', 'Ship', 'old-site/ship.json', 0.02, null, OS],
    ['os_usa', 'United States', 'old-site/usa.json', 1.0, 'The height-mapped USA.', OS],
  ]],
];
// Clips that live in their own files and fit any model on the Tripo biped skeleton (idle from
// Stephen, the rest from Mixamo retargeted onto that skeleton).
const RIG_CLIPS = ['idle_clip.glb', 'climb_clip.glb', 'ladder_clip.glb', 'sit_down_clip.glb', 'stand_up_clip.glb', 'wave_clip.glb'];

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const store = { get(k, d) { try { const v = localStorage.getItem('modelLab.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('modelLab.' + k, JSON.stringify(v)); } catch { /* private window */ } } };

// the model on show, its animation mixer and actions
let current = null, mixer = null, actions = {}, active = null, skeletonHelper = null, loadToken = 0, rigClips = null;

// ── renderer, scene and the Character Lab's lighting ─────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d14);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0x8ea8bd, 0x1c242e, 0.52); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2de, 1.7); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0016;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6f9ac6, 1.5); scene.add(rim);
const bounce = new THREE.DirectionalLight(0xc2cfdc, 0.5); scene.add(bounce);
if (renderer.capabilities.isWebGL2) {
  try {   // a dim box with a skylight and a warm lamp, for the materials to reflect (PMREM needs WebGL 2)
    const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(12, 7, 12), new THREE.MeshBasicMaterial({ color: 0x11161d, side: THREE.BackSide })));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshBasicMaterial({ color: 0x59708c })); glow.position.set(0, 3.4, 0); glow.rotation.x = Math.PI / 2; env.add(glow);
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ color: 0xa8845a })); lamp.position.set(5.5, 1.4, 1); lamp.rotation.y = -Math.PI / 2; env.add(lamp);
    scene.environment = pmrem.fromScene(env, 0.03).texture; pmrem.dispose();
  } catch (e) { /* the lights carry it alone */ }
}
const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.PolarGridHelper(1, 8, 6, 64, 0x2a3440, 0x1f2731); grid.position.y = 0.001; scene.add(grid);

// ── lighting sliders ──────────────────────────────────────────────────────────
let envStrength = 0.35, radius = 1, keyAngle = 37;
function placeLights() {
  const a = THREE.MathUtils.degToRad(keyAngle), r = radius * 4;
  key.position.set(Math.sin(a) * r, r * 1.4, Math.cos(a) * r); key.target.position.set(0, 0, 0);
  rim.position.set(-Math.sin(a) * r, r * 0.5, -Math.cos(a) * r);
  bounce.position.set(r * 0.25, -r * 0.45, r * 0.5);
  const c = key.shadow.camera, s = radius * 1.6; c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = r * 0.2; c.far = r * 4; c.updateProjectionMatrix();
}
const slider = (id, fmt, fn) => { const el = $(id); const go = () => { $(id + 'Out').textContent = fmt(+el.value); fn(+el.value); }; el.addEventListener('input', go); go(); };
slider('exposure', v => v.toFixed(2), v => { renderer.toneMappingExposure = v; });
slider('env', v => v.toFixed(2), v => { envStrength = v; eachMaterial(m => { m.envMapIntensity = v; }); });
slider('keyL', v => v.toFixed(2), v => { key.intensity = v; });
slider('keyDir', v => Math.round(v) + '°', v => { keyAngle = v; placeLights(); });
slider('rimL', v => v.toFixed(2), v => { rim.intensity = v; });
slider('ambient', v => v.toFixed(2), v => { hemi.intensity = v; });
slider('bounce', v => v.toFixed(2), v => { bounce.intensity = v; });

// ── the catalogue ───────────────────────────────────────────────────────────
const ENTRIES = {};
const openGroups = store.get('open', ['Jacob']);
for (const [section, list] of CATALOGUE) {
  const d = document.createElement('details'); d.className = 'grp'; d.open = openGroups.includes(section);
  d.innerHTML = `<summary>${section} <i>${list.length}</i></summary>`;
  const box = document.createElement('div'); box.className = 'list';
  for (const [id, name, file, mb, note, legacy] of list) {
    ENTRIES[id] = { id, name, file, mb, note, legacy, section };
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id;
    b.innerHTML = `<span>${name}</span><small>${mb < 0.1 ? '<0.1' : mb.toFixed(1)} MB</small>`;
    b.addEventListener('click', () => show(id));
    box.appendChild(b);
  }
  d.appendChild(box); $('catalogue').appendChild(d);
  d.addEventListener('toggle', () => { const s = new Set(store.get('open', ['Jacob'])); d.open ? s.add(section) : s.delete(section); store.set('open', [...s]); });
}

// ── loading a model ───────────────────────────────────────────────────────────
const gltf = new GLTFLoader();
const pivot = new THREE.Group(); scene.add(pivot);

function eachMaterial(fn, root = current && current.model) {
  if (!root) return;
  root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn); });
}
function dispose(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });
}
function loadRigClips() {
  if (!rigClips) rigClips = Promise.all(RIG_CLIPS.map(f => gltf.loadAsync(M + f).then(g => g.animations.map(c => { c.name = f.replace('_clip.glb', '').replace('_', ' '); return c; })).catch(() => []))).then(a => a.flat());
  return rigClips;
}
const cleanName = (n) => n.replace(/^preset:biped:/, '').replace(/\.\d+$/, '') || 'clip';

async function show(id) {
  const e = ENTRIES[id] || ENTRIES.jacob4;
  const token = ++loadToken;
  document.querySelectorAll('#catalogue .list button').forEach(b => b.classList.toggle('on', b.dataset.id === e.id));
  const grp = [...document.querySelectorAll('#catalogue details.grp')].find(d => d.querySelector(`[data-id="${e.id}"]`)); if (grp) grp.open = true;
  $('loading').textContent = 'LOADING ' + e.name.toUpperCase();
  history.replaceState(null, '', '?m=' + e.id);
  store.set('last', e.id);
  let loaded;
  try {
    loaded = e.legacy
      ? await loadLegacyJSON(M + e.file, e.legacy)
      : await gltf.loadAsync(M + e.file, (p) => { if (token === loadToken && p.total) $('loading').textContent = `LOADING ${e.name.toUpperCase()} ${Math.round(p.loaded / p.total * 100)}%`; });
  } catch (err) { if (token === loadToken) $('loading').textContent = 'Could not load ' + e.file; return; }
  if (token !== loadToken) return;                                   // another model was picked meanwhile
  $('loading').textContent = '';

  if (current) { pivot.remove(current.model); dispose(current.model); }
  if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
  if (mixer) mixer.stopAllAction();
  const model = loaded.scene;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let tris = 0, meshes = 0, skinned = false;
  model.traverse(o => {
    if (!o.isMesh) return;
    meshes++; o.castShadow = o.receiveShadow = true;
    if (o.isSkinnedMesh) { skinned = true; o.frustumCulled = false; }   // skinned bounds go stale mid-clip
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.envMapIntensity = envStrength;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) { m[k].anisotropy = maxAniso; if (m[k].image) m[k].needsUpdate = true; }
      m.wireframe = $('wire').checked;
    }
  });
  pivot.rotation.set(0, 0, 0); pivot.add(model);
  current = { entry: e, model };

  // stand it on the floor, centred, and frame it
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  model.position.x -= centre.x; model.position.z -= centre.z; model.position.y -= box.min.y;
  current.size = size;
  radius = Math.max(size.length() / 2, 0.01);
  floor.scale.setScalar(radius * 1.6); grid.scale.setScalar(radius * 1.6);
  placeLights(); frame();

  // animations: the model's own, plus the shared biped clips when its skeleton has those bones
  mixer = new THREE.AnimationMixer(model); actions = {}; active = null;
  for (const c of loaded.animations || []) actions[cleanName(c.name)] = mixer.clipAction(c);
  const addRigClips = (clips) => {
    for (const c of clips) {
      const bones = c.tracks.map(t => t.name.split('.')[0]);
      const found = bones.filter(b => model.getObjectByName(b)).length;
      if (bones.length && found / bones.length > 0.8 && !actions[c.name]) actions[c.name] = mixer.clipAction(c);
    }
  };
  if (skinned && !e.legacy && model.getObjectByName('Hip')) addRigClips(await loadRigClips());
  if (token !== loadToken) return;
  if (skinned && $('bones').checked) addSkeleton();
  buildClips(); buildParts();
  const first = Object.keys(actions).find(n => /idle/i.test(n)) || Object.keys(actions)[0];
  if (first) playClip(first);
  titleFor();
}

function titleFor(part = null) {
  const e = current.entry, s = part ? new THREE.Box3().setFromObject(part).getSize(new THREE.Vector3()) : current.size;
  let tris = 0, meshes = 0, bones = 0;
  (part || current.model).traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } if (o.isBone) bones++; });
  $('title').querySelector('b').textContent = part ? `${e.name} · ${part.name || 'part'}` : e.name;
  $('title').querySelector('span').innerHTML = [
    `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} (w × h × d)`,
    `${Math.round(tris).toLocaleString()} triangles · ${meshes} mesh${meshes === 1 ? '' : 'es'}${bones ? ` · ${bones} bones` : ''}`,
    part ? '' : (e.note || ''),
  ].filter(Boolean).join('<br>');
}

function frame() {
  const r = radius, fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = r / Math.sin(fov / 2) * 1.05;
  camera.near = r / 200; camera.far = r * 60; camera.updateProjectionMatrix();
  const cy = current ? current.size.y / 2 : r;
  controls.target.set(0, cy, 0);
  camera.position.set(dist * 0.55, cy + dist * 0.25, dist * 0.8);
  controls.minDistance = r * 0.05; controls.maxDistance = r * 20;
  controls.update();
}

// ── animation controls ───────────────────────────────────────────────────────
let paused = false;
function buildClips() {
  const box = $('clips'); box.innerHTML = '';
  const names = Object.keys(actions);
  $('clipNote').style.display = names.length ? 'none' : '';
  for (const n of names) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.dataset.clip = n;
    b.addEventListener('click', () => playClip(n)); box.appendChild(b);
  }
}
function playClip(n) {
  if (active) active.fadeOut(0.25);
  active = actions[n]; active.reset().setEffectiveWeight(1).fadeIn(0.25).play();
  paused = false; $('play').textContent = 'Pause'; active.paused = false;
  document.querySelectorAll('#clips button').forEach(b => b.classList.toggle('on', b.dataset.clip === n));
}
$('play').addEventListener('click', () => {
  if (!active) return;
  paused = !paused; active.paused = paused; $('play').textContent = paused ? 'Play' : 'Pause';
});
$('rest').addEventListener('click', () => {
  if (!mixer) return;
  mixer.stopAllAction(); active = null;
  current.model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); });
  document.querySelectorAll('#clips button').forEach(b => b.classList.remove('on'));
});
slider('speed', v => v.toFixed(2) + '×', v => { if (mixer) mixer.timeScale = v; });
$('time').addEventListener('input', () => {
  if (!active) return;
  paused = true; active.paused = true; $('play').textContent = 'Play';
  active.time = +$('time').value * active.getClip().duration; mixer.update(0);
});

// ── parts ────────────────────────────────────────────────────────────────────
let isolated = null;
function buildParts() {
  const box = $('parts'); box.innerHTML = ''; isolated = null;
  const parts = [];
  current.model.traverse(o => { if (o.isMesh) parts.push(o); });
  for (const p of parts.slice(0, 400)) {
    const g = p.geometry, t = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span>${p.name || '(unnamed)'}</span><small>${t.toLocaleString()} tris</small>`;
    b.addEventListener('click', () => isolate(isolated === p ? null : p, b));
    box.appendChild(b);
  }
  if (parts.length > 400) box.insertAdjacentHTML('beforeend', `<p class="note">and ${parts.length - 400} more</p>`);
}
function isolate(part, button) {
  isolated = part;
  current.model.traverse(o => { if (o.isMesh) o.visible = !part || o === part; });
  if (part) { let p = part.parent; while (p) { p.visible = true; p = p.parent; } }
  document.querySelectorAll('#parts button').forEach(b => b.classList.toggle('on', part && b === button));
  titleFor(part);
}

// ── view toggles ─────────────────────────────────────────────────────────────
function addSkeleton() { skeletonHelper = new THREE.SkeletonHelper(current.model); scene.add(skeletonHelper); }
$('bones').addEventListener('change', () => {
  if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
  if ($('bones').checked && current) addSkeleton();
});
$('wire').addEventListener('change', () => eachMaterial(m => { m.wireframe = $('wire').checked; }));
$('floor').addEventListener('change', () => { floor.visible = grid.visible = $('floor').checked; key.castShadow = $('floor').checked; });
$('frame').addEventListener('click', frame);
$('min').addEventListener('click', () => { const p = $('panel'); p.classList.toggle('min'); $('min').textContent = p.classList.contains('min') ? 'show' : 'hide'; });

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mixer) mixer.update(dt);
  if (active && !paused) { const d = active.getClip().duration; $('time').value = d ? (active.time % d) / d : 0; $('timeOut').textContent = active.time.toFixed(2) + ' s'; }
  if ($('spin').checked) pivot.rotation.y += dt * 0.4;
  controls.update();
  renderer.render(scene, camera);
});

if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, show, ENTRIES, getCurrent: () => current, getActions: () => actions });
show(Q.get('m') || store.get('last', 'jacob4'));
