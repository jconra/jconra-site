// THE JCONRA.COM FILM (index.html at the root; jconra.com/?edit opens the Quarters Lab panel). The Tripo habitat interior, prepared in Blender so the lab can take it apart: the
// window glass is its own piece (hide it and the frames are open), the chair is its own piece (it
// swivels), and every prop can be switched off. Earth turns outside the windows.
//
// The room is about a metre across as it ships, so everything here works in room units and the lab
// scales it to a real cabin: 3.4 m wall to wall by default.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Earth } from './objects/earth.js';
import { Post } from './fx/post.js';
import { Hologram } from './objects/hologram.js';
import { Screen } from './objects/screens.js';
import { Terminal } from './objects/terminal.js';
import { loadKit, StationKit, DEFAULT_LAYOUT } from './objects/stationKit.js';
import { buildHangarSet, shutFighter } from './objects/hangarSet.js';
import { addAfterburner } from './objects/afterburner.js';
import { loadUSMap } from './objects/usMap.js';
import { chooseTier } from './quality.js';
import { buildBookshelf, SERIES } from './objects/bookshelf.js';

const Q = new URLSearchParams(location.search);
if (Q.has('edit')) document.body.classList.add('edit');   // the editing panel (the Quarters Lab) is jconra.com/?edit
const $ = (id) => document.getElementById(id);
// ?perf: the performance readout (src/perfHud.js): frame times, downloads, what's loading, the long frames and when each
// thing finished (perfMark), for finding what stutters on a phone
const PERF_MARKS = [], perfMark = (text) => { if (Q.has('perf')) PERF_MARKS.push({ at: performance.now() / 1000, T: typeof SEQ === 'undefined' ? 0 : SEQ.T, text }); };
const FORCE_GL1 = Q.has('gl1');
let renderer;
if (FORCE_GL1) {
  const cv = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas: cv, context: cv.getContext('webgl', { antialias: true }), logarithmicDepthBuffer: true });
} else {
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
if (Q.has('perf')) import('./perfHud.js').then(({ perfHud }) => { window.__perf = perfHud({ renderer, state: perfState, marks: PERF_MARKS }); }).catch((e) => console.error('perf: not loaded', e));   // (__perf.report(): the report as text)
// what the readout shows of the film: its time and scene, the boot, and how far the town has got
function perfState() {
  const V = valley, town_ = !V ? (townFailed ? 'failed' : townBuilding ? 'building the land and the town' : 'not started yet')
    : !V.settled() ? `laying plants (${V.COVER.job ? 'busy' : 'done'}), trees ${V.treeForest && V.treeForest.ready ? 'baked' : 'baking'}, plants ${V.coverForest && V.coverForest.ready ? 'baked' : 'baking'}`
    : townWarm < 3 ? 'ready, warming up' : 'ready';
  return { T: SEQ.T, set: currentSet, phase: BOOT.on ? 'boot: ' + BOOT.phase : SEQ.playing ? 'playing' : 'held', town: town_ };
}

const ROOM_METRES = 3.4;                        // wall to wall
const FAR = 4e7;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, FAR);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 14;
controls.screenSpacePanning = true;          // right-drag (two fingers on a phone) slides the view, not just the orbit centre

// ── light ───────────────────────────────────────────────────────────────────────
// A cabin is lit by its own strip lights and screens, with hard sunlight through the window.
// The window wall is -z, so the sun comes from out there and the desk screens glow against it.
// The cabin lamp hangs under the roof. It is a point light, so what it does falls off with the
// square of the distance: at 1.75 m it was half a metre from his face at the desk and blew it
// out at any setting; each build puts it at its own ceiling (see BUILDS.lampY).
const cabin = new THREE.PointLight(0xdfe9f5, 6, 12, 1.6); cabin.position.set(0, 2.3, 0.1); scene.add(cabin);
const screens = new THREE.PointLight(0x7fb4ff, 3, 6, 2); screens.position.set(0, 1.35, -1.05); scene.add(screens);
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6); sun.position.set(2.5, 2.0, -5); scene.add(sun);
const ambient = new THREE.HemisphereLight(0x9fb6cc, 0x20262d, 0.45); scene.add(ambient);
// outside only: a faint fill from the planet side, so the station's undersides are not pitch black
const spaceFill = new THREE.DirectionalLight(0x6f8fb8, 0); spaceFill.position.set(-0.6, -0.8, -0.3); scene.add(spaceFill);
scene.add(sun.target); scene.add(spaceFill.target);   // a directional light shines at its target, and the station is not at the origin

// ── Earth outside ───────────────────────────────────────────────────────────────
const earth = new Earth({ radius: 6371000 });
scene.add(earth);
const EARTH = { altitude: 420000, spin: 0.35, tilt: 18, glow: 0.3 };   // the air glow low: at full it read as a blue haze
function placeEarth() {
  // The windows face -z, so Earth sits out that way and below, as it would from a station in orbit.
  const d = earth.radius + EARTH.altitude;
  const t = THREE.MathUtils.degToRad(EARTH.tilt);
  earth.position.set(0, -d * Math.cos(t), -d * Math.sin(t));
  earth.spin = EARTH.spin;
  earth.air.material.uniforms.uStrength.value = EARTH.glow;
}
placeEarth();
{
  const n = 4000, pos = new Float32Array(n * 3), R = 2e7;
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos[i * 3] = R * s * Math.cos(t); pos[i * 3 + 1] = R * u; pos[i * 3 + 2] = R * s * Math.sin(t);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8f0, size: 1.5, sizeAttenuation: false })));
}

// EARTH AS A PICTURE: what the old site did. textures/earth.jpg is a photograph of the whole globe,
// hung on one flat rectangle lying below the station (modules/SceneModels.js sized it 833 x 827 and
// put it 500 below). Two triangles against the globe's 55k, and nothing to light, but it is a fixed
// picture: it cannot turn, and it stays the same seen from either window.
const picture = new THREE.Mesh(
  new THREE.PlaneGeometry(833, 827),
  new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('/textures/earth.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; }),
                                transparent: true, depthWrite: false })
);
// The old site laid it flat far below and looked down on it. This window looks out sideways, where a
// flat sheet is edge-on and invisible, so it hangs below and outside, turned square to the window:
// the sheet's face points back along the line from it to the window, so the globe stays round.
// (Turned 76 degrees instead of 14, it was seen nearly edge-on and read as an egg.)
// It hangs a little ABOVE the line of sight from the chair, so the globe fills the windows rather
// than peeping over their sills: the room is not held to where a real cabin on the ring would look.
picture.position.set(-40, 130, -590);                              // about 12 degrees above the window's line of sight
picture.rotation.x = Math.atan2(130, 590);
scene.add(picture);
let earthMode = 'Picture';     // the photograph by default: the globe's map is too soft up close
function setEarthMode(mode) {
  earthMode = mode;
  earth.visible = mode === 'Globe';
  picture.visible = mode === 'Picture';
  document.querySelectorAll('#earthMode button').forEach(b => b.classList.toggle('on', b.textContent === mode));
}

const post = new Post(renderer, scene, camera, { far: FAR, sunDirection: sun.position });
post.setSize(innerWidth, innerHeight);

// ── the room ────────────────────────────────────────────────────────────────────
const room = new THREE.Group();
scene.add(room);
let windows = null, chairPivot = null, props = [];
const CHAIR = { swivel: false, speed: 12, angle: 0, x: 25, y: 0, z: -55, height: 100 };   // x, z: where Jacob slid it (2026-09-20)   // x, y, z: nudges in cm from where the chair stands; height: the seat, % (the chair squashed or stretched on its base)
let chairBase = null;
function placeChair() {
  if (!chairPivot || !chairBase) return;
  chairPivot.position.copy(chairBase).add(new THREE.Vector3(CHAIR.x / 100, CHAIR.y / 100, CHAIR.z / 100));
  // the seat height: the chair scaled up or down its own axis, castors staying on the floor
  const scaler = chairPivot.getObjectByName('ChairScaler');
  if (scaler && Math.abs(scaler.scale.y - CHAIR.height / 100) > 1e-6) { scaler.scale.y = CHAIR.height / 100; chairInfo = null; placeSitter(); }
}
// The chair's base is set down on the floor under it: the model can carry it a little high, and a
// chair on castors that float is the first thing anyone sees.
function dropChair() {
  if (!chairPivot || !chairBase) return;
  const chair = chairMesh(); if (!chair) return;
  const targets = []; room.traverse(o => { if (o.isMesh && o !== chair && o.name !== 'Roof' && o.name !== 'RoofLid') targets.push(o); });
  const ray = new THREE.Raycaster(chairBase.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, -1, 0)); ray.far = 2;
  const hit = ray.intersectObjects(targets, true).find(h => h.face && h.point.y <= chairBase.y + 0.05);
  if (hit) { chairBase.y = hit.point.y; placeChair(); }
}

// Two builds of the same cabin, to compare: the full Tripo export, and a lighter one whose props
// share a single texture atlas and one mesh, with the flat panels merged and the rest collapsed.
const BUILDS = {
  Full:  { file: '/models/quarters.glb', note: '448k triangles · 58 meshes · 18.5 MB' },
  Light: { file: '/models/quarters_lite.glb', note: '185k triangles · 4 meshes · 8.0 MB' },
  // unit: metres per model unit, and the model is already centred on its own axes; the box is not
  // used for scale, because walls added later would shrink and shift the room
  // noGlass: the room's "Windows" piece is the frames, with no glass in them, so there is nothing to take out
  Smart: { file: '/models/quarters_smart.glb', note: 'Smart Mesh room · Jacob\'s SpaceDorm · 42k triangles · 5.3 MB', unit: 3.4, ownRoof: true, noGlass: true, lampY: 2.8 },
};
let build = BUILDS[Q.get('build')] ? Q.get('build') : 'Smart';   // the clean room by default; ?build=Light for the old one
const loader = new GLTFLoader();

// ── the boot ──────────────────────────────────────────────────────────────────────
// The experience starts on the computer: a full-screen terminal types out a greeting and shows
// the files arriving as progress bars, so nothing is ever seen half loaded and the monitor has
// the visitor's attention from the first frame. When everything is in, the terminal turns out to
// be the picture on the desk monitor, and the camera pulls back from it into the room and the
// intro begins. A link at the bottom goes to the plain site for anyone who would rather.
const term = new Terminal();
const BOOT = { on: !Q.has('noboot'), bars: {}, weights: { room: 3, jacob: 3, clips: 1, station: 3 }, ready: false, phase: 'loading' };
function bootBar(name) { if (!BOOT.bars[name]) BOOT.bars[name] = term.bar(name); return BOOT.bars[name]; }
function bootProgress(name, frac) { const b = BOOT.bars[name]; if (b) b.frac = Math.max(b.frac, Math.min(1, frac)); checkBoot(); }
// The session. Commands are typed at a human pace and their output printed, so it reads as a
// terminal and takes a few seconds however fast the files arrive; the greeting script waits for
// the bars, so it is never read over a half-loaded room.
// quick all the way through, then a pause at the end for the message to be read
term.cmd('whoami').out('jacob').wait(0.15)
    .cmd('groups').out('aws-systems-engineer  air-force-security-engineer  threejs-enthusiast  bass-guitarist').wait(0.15)
    .cmd('./station --enter').out('bringing the cabin up ...');
bootBar('cabin'); bootBar('jacob'); bootBar('clips'); bootBar('station');
term.gate().wait(0.15)
    .cmd('./greeting.sh')
    .out('Welcome to jconra.com.').out('Hello! I am Jacob Conrads, a Systems Engineer. This station is a project to play around with and highlight my skills.')
    .out('Thank you for visiting! Scroll or swipe to move through it, or wait for the animation.').wait(0.3);
term.reserve = 2;   // the bottom rows stay clear: the basic-site link sits there the whole time
const termCanvas = $('term'); const termCtx = termCanvas ? termCanvas.getContext('2d') : null;
function drawBootOverlay() {
  if (!termCtx || !BOOT.on) return;
  const W = termCanvas.width = innerWidth * Math.min(devicePixelRatio, 2), H = termCanvas.height = innerHeight * Math.min(devicePixelRatio, 2);
  termCtx.fillStyle = '#020604'; termCtx.fillRect(0, 0, W, H);
  // the column fills the height, centred; on a wide screen there is black either side, as a
  // terminal window would have
  const k = Math.min(W / term.canvas.width, H / term.canvas.height), sw = term.canvas.width * k, sh = term.canvas.height * k;
  const ox = (W - sw) / 2, oy = (H - sh) / 2;
  termCtx.drawImage(term.canvas, ox, oy, sw, sh);
  // the link stays put on the terminal's bottom row, in its own type, so it can be clicked while
  // the commands are still printing (the terminal keeps that row clear)
  const a = $('basic');
  if (a) {
    const dpr = W / innerWidth;
    a.style.left = (ox + term.pad * k) / dpr + 'px'; a.style.top = (oy + (term.canvas.height - term.pad - term.lineH) * k) / dpr + 'px';
    a.style.fontSize = (term.size * k) / dpr + 'px'; a.style.lineHeight = (term.size * k) / dpr + 'px';
  }
}
let bootDone = false;
function checkBoot() {
  if (bootDone || !BOOT.on) return;
  const all = Object.values(BOOT.bars).every(b => b.frac >= 1);
  if (!all || !chairPivot || !sitter || !waveAction || !station) return;
  bootDone = true;
  BOOT.phase = 'typed';                 // the script's own gate holds the greeting until the bars fill
}
// the camera at the monitor, and the pull-back into the intro
function bootCamera() {
  const sc = SCREENS.find(s => s.kind === 'terminal'); if (!sc) return null;
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(sc.quaternion);
  // close enough that the monitor fills the frame: distance from its width and the field of view
  const w = sc.geometry.parameters.width * sc.scale.x, h = sc.geometry.parameters.height * sc.scale.y;
  const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = Math.max(w / (2 * Math.tan(hfov / 2)), h / (2 * Math.tan(vfov / 2))) * 1.02;
  // on a phone the terminal is a column in the middle of the display: close in on the column
  const colW = Math.min(w, h * term.canvas.width / term.canvas.height), portrait = innerWidth < innerHeight;
  const at = sc.position.clone();
  const dd = portrait ? Math.max(colW / (2 * Math.tan(hfov / 2)), h / (2 * Math.tan(vfov / 2))) * 1.02 : d;
  return { pos: at.clone().addScaledVector(n, dd), at };
}
let pull = null;
function startPullBack() {
  const bc = bootCamera(); if (!bc) { finishBoot(); return; }
  if (!SEQ.active) activateIntro();
  SEQ.playing = false; seek(0);
  const endPos = camera.position.clone(), endAt = controls.target.clone();
  pull = { t: 0, len: 1.2, from: bc.pos, at: bc.at, to: endPos, toAt: endAt };   // quick: a slow back-away from the monitor read as a stall
  camera.position.copy(bc.pos); controls.target.copy(bc.at); camera.lookAt(bc.at);
  BOOT.phase = 'pull';
  const ov = $('bootOverlay'); if (ov) { ov.classList.add('gone'); setTimeout(() => ov.remove(), 900); }
}
function stepPull(dt) {
  if (!pull) return;
  pull.t += dt;
  const u = Math.min(1, pull.t / pull.len), e = u * u * (3 - 2 * u);
  camera.position.lerpVectors(pull.from, pull.to, e); controls.target.lerpVectors(pull.at, pull.toAt, e); camera.lookAt(controls.target);
  post.focus = camera.position.distanceTo(controls.target);
  if (u >= 1) { pull = null; finishBoot(); }
}
function finishBoot() { perfMark('boot done: the film starts'); BOOT.phase = 'done'; BOOT.on = false; pull = null; if (!SEQ.active) activateIntro(); SEQ.T = 0; SEQ.playing = true; scrubbed(); }

function loadRoom(name) {
  build = name;
  cabin.position.set(0, BUILDS[name].lampY || 2.3, 0.1);
  document.querySelectorAll('#builds button').forEach(b => b.classList.toggle('on', b.textContent === name));
  $('buildNote').textContent = BUILDS[name].note;
  buildScreens(name);
  buildProps(name);
  if (sitter && sitter.parent) sitter.parent.remove(sitter);   // he is not part of the room
  for (const child of [...room.children]) {
    room.remove(child);
    child.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => { x.map?.dispose(); x.dispose(); }); } });
  }
  windows = null; chairPivot = null; props = []; chairInfo = null;
  loader.load(BUILDS[name].file, (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const fixed = BUILDS[name].unit;
  const scale = fixed || ROOM_METRES / Math.max(size.x, size.z);
  model.scale.setScalar(scale);
  // stand the room on the floor: centred on the box, or on its own axes when the scale is fixed
  if (fixed) model.position.set(0, 0, 0);       // the file's own origin: its floor top is at a known height, whatever hangs below it
  else model.position.set(-box.min.x * scale - (size.x * scale) / 2, -box.min.y * scale, -box.min.z * scale - (size.z * scale) / 2);
  room.add(model);
  // The chair's axis below is read through the meshes' world matrices, which still hold the raw
  // export until this runs: without it the axis lands in raw units and the chair orbits the room.
  room.updateMatrixWorld(true);

  // Collect first, then process: re-parenting the chair below changes the list that traverse walks,
  // which makes it step over the rest of the room.
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    o.castShadow = o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
      m.envMapIntensity = 0.4;
    }
    if (/^Room/.test(o.name) && !BUILDS[name].ownRoof) room.add(roofFrom(o));
    if (/^Windows/.test(o.name)) windows = o;
    else if (/^Chair/.test(o.name)) {
      // Swivel about the post, not the middle of the bounding box: the chair stands at an angle to
      // the desk, so that box is a diagonal and its centre sits well off the post. The wheel base is
      // centred on the post, so the lowest slice of the chair gives the axis.
      const g = o.geometry; g.computeBoundingBox();
      const pos = g.attributes.position, lo = g.boundingBox.min.y, h = g.boundingBox.max.y - lo;
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > lo + 0.12 * h) continue;
        sx += pos.getX(i); sz += pos.getZ(i); n++;
      }
      const axis = new THREE.Vector3(n ? sx / n : 0, lo, n ? sz / n : 0).applyMatrix4(o.matrixWorld);
      // the holder hangs off the room, whose scale is 1, so that world position means what it says:
      // inside the model group it would be read in that group's own scaled frame
      chairPivot = new THREE.Group();
      room.add(chairPivot);
      chairPivot.position.copy(axis);
      chairPivot.updateMatrixWorld(true);
      // the chair hangs in a holder of its own under the pivot, so it can be scaled on its base
      // (the seat height) without scaling him with it
      const scaler = new THREE.Group(); scaler.name = 'ChairScaler'; chairPivot.add(scaler); scaler.updateMatrixWorld(true);
      scaler.attach(o);
      chairBase = axis.clone(); dropChair(); placeChair();
    } else props.push(o);
  }
  buildPropList();
  snapScreens();
  applyWindows();
  if (chairPivot && !CHAIR.swivel) chairPivot.rotation.y = THREE.MathUtils.degToRad(CHAIR.angle);
  placeSitter();
  $('boot')?.remove();
  bootProgress('cabin', 1); loadSitter(); loadStation();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, room, earth, post, chairPivot, windows, frame, loadRoom, build, SITTER, placeSitter, getSitter: () => sitter, SEQ, KEYS, ACTS, PARTS, SCREENS, seek, faceCamera, term, BOOT, startPullBack, getStation: () => station, getHangar: () => ({ hangarAt, bayAt, hangarMouth }), playIntro, activateIntro, setLight, holos, getWave: () => waveAction, RESUME, FLY, HANGAR, SCREEN_FIT, applyScreenFit, CHAIR, HELMET, applyHelmetFit, MAPFIT, applyMapFit, MAP, TOUR, FLYBYS, getProps: () => PROPS, total, getHangarSet: () => hangarSet, getValley: () => valley, getTownCam: () => townCam, getTownWarm: () => townWarm, TOWNTOUR, tourStart, tourStop, MAP_HANDOFF, hangarShipPos, getMap: () => mapSet, getTown: () => town, TOWN_INPUT });
  }, (e) => { const pct = $('pct'); if (pct && e.total) pct.textContent = Math.round(e.loaded / e.total * 100) + '%'; if (e.total) bootProgress('cabin', e.loaded / e.total); },
     (e) => { console.error(e); const boot = $('boot'); if (boot) boot.textContent = 'LOAD FAILED — ' + e.message; });
}
for (const mode of ['Globe', 'Picture']) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = mode; b.onclick = () => setEarthMode(mode); $('earthMode').appendChild(b);
}
setEarthMode(earthMode);
for (const name of Object.keys(BUILDS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => loadRoom(name); $('builds').appendChild(b);
}

// A ROOF. Tripo made the cabin open-topped, so from inside you look up at stars. The outside of
// the walls is a plain panelled hull that is never seen, so the bed wall's outer skin is copied,
// laid flat across the top, and stretched to the room's plan: its panels become the ceiling.
function roofFrom(walls) {
  walls.updateMatrixWorld(true);
  const g = walls.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index, M = walls.matrixWorld;
  const box = new THREE.Box3().setFromObject(walls), top = box.max.y, half = (box.max.x - box.min.x) / 2;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const P = [], U = [], I = [], map = new Map();
  const take = (i) => {
    if (map.has(i)) return map.get(i);
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M);
    // wall height runs across the room, depth of relief goes up out of the ceiling, length stays
    P.push(-half + (v.y / (top - box.min.y)) * half * 2, top + Math.max(0, box.min.x + 0.03 - v.x) * 0.5, v.z);   // relief goes up, thickness sits on the plane
    U.push(uv.getX(i), uv.getY(i));
    const k = P.length / 3 - 1; map.set(i, k); return k;
  };
  const tri = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(M); b.fromBufferAttribute(pos, i1).applyMatrix4(M); c.fromBufferAttribute(pos, i2).applyMatrix4(M);
    if ((a.x + b.x + c.x) / 3 > box.min.x + 0.14) continue;                    // the bed wall's outer skin
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.x > 0) continue;                                                       // facing outward
    I.push(take(i0), take(i1), take(i2));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I); geo.computeVertexNormals();
  // the panels must face down into the room: flip the winding if the copy came out facing up
  const nn = geo.attributes.normal; let sy = 0; for (let i = 0; i < nn.count; i++) sy += nn.getY(i);
  if (sy > 0) { for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } geo.setIndex(I); geo.computeVertexNormals(); }
  const roof = new THREE.Mesh(geo, walls.material);
  roof.name = 'Roof'; roof.receiveShadow = true;
  // and a plain lid just above the copied skin: the skin has gaps wherever the outer wall did,
  // and on the Smart Mesh room those were big enough to see the stars through
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(box.max.x - box.min.x, box.max.z - box.min.z).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8e949a, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
  lid.position.set((box.max.x + box.min.x) / 2, top + 0.012, (box.max.z + box.min.z) / 2);
  lid.name = 'RoofLid'; lid.receiveShadow = true;
  roof.add(lid); lid.position.sub(roof.position);
  console.log('roof from', I.length / 3, 'triangles of the outer wall, with a lid');
  return roof;
}

function applyWindows() {
  const row = $('openWindows').closest('label'); if (row) row.style.display = BUILDS[build].noGlass ? 'none' : '';
  if (!windows) return;
  windows.visible = BUILDS[build].noGlass ? true : !$('openWindows').checked;
}

// ── Jacob in the chair ──────────────────────────────────────────────────────────
// Model 5 from the Character Lab at 1.8 m, playing the sitting clip it carries, hung off the
// chair's holder so he turns with it. The clip was measured in Blender: the seat of the trousers
// is 0.232 model units above the feet and 0.045 behind them, and those two numbers put him on
// the seat pan.
const HEIGHT = 1.8;
const SEAT = { up: 0.232 * HEIGHT, back: 0.045 * HEIGHT };
const SITTER = { on: true, height: 0, forward: 0, turn: 0 };     // nudges in cm and degrees
let sitter = null, sitterMixer = null, sitterLoading = false, sitAction = null, waveAction = null, standAction = null, walkAction = null;
let waveParts = null, ladderAction = null, sitDownAction = null, climbAction = null;                       // the wave's arm / body / head actions, weighted by WAVE
const WAVE = { arm: 1, body: 1, head: 1 };     // how much of each part of the standing wave he does
// THE SITTING CLIP (Tripo's, 7.2 s) leans him about 15 cm forward from 2.2 s to 6.5 s and back:
// under the wave and the greeting that read as a hunch. By default only its calm start plays, to
// and fro, so he still breathes and shifts; `full` plays the whole clip as before.
const SIT = { full: false, calm: 1.9 };
function sitTime(T) {
  const d = sitAction.getClip().duration;
  if (SIT.full) return T % d;
  const c = Math.min(SIT.calm, d), k = (T % (2 * c)); return k < c ? k : 2 * c - k;   // back and forth over the calm stretch
}
function loadSitter() {
  if (sitter || sitterLoading) return;
  sitterLoading = true;
  loader.load('/models/jacob4.glb', (gltf) => {                  // model 4: Jacob's own Blender build
    bootProgress('jacob', 1); perfMark('Jacob loaded');
    const model = gltf.scene;
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;                                   // skinned bounds go stale mid-clip
      const m = o.material;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
      m.envMapIntensity = 0.35;
    });
    sitter = new THREE.Group();
    sitter.scale.setScalar(HEIGHT);
    sitter.add(model);
    model.updateMatrixWorld(true);
    const hipBone = model.getObjectByName('Hip');
    sitter.userData.hipRest = hipBone ? model.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3())) : null;
    sitterMixer = new THREE.AnimationMixer(model);
    // the clips do not all key the head, so a head turn would stay put and the next one would
    // add to it: keep the bind pose to start each turn from
    const headBone = model.getObjectByName('Head'); if (headBone) headBone.userData.restQ = headBone.quaternion.clone();
    const clip = gltf.animations.find(c => /sit/i.test(c.name));
    if (clip) { sitAction = sitterMixer.clipAction(clip); sitAction.play(); }
    placeSitter();
    wearHelmet();
    // The wave came from Mixamo standing up, so only its upper body is kept, and it is made
    // additive: the arm's movement is laid over the sitting pose instead of replacing it.
    loader.load('/models/wave_clip.glb', (g) => {
      const src = g.animations[0];
      if (!src) return;
      // in three parts, each with its own strength (WAVE): the arms, the body's lean (waist and
      // spine - the standing wave bends forward, which on a man already sitting forward was too
      // much) and the head
      const PARTS_RE = { arm: /^[LR]_(Clavicle|Upperarm|Forearm|Hand)\.quaternion$/, body: /^(Waist|Spine01|Spine02)\.quaternion$/, head: /^(NeckTwist01|Head)\.quaternion$/ };   // turns only: nothing moves or grows
      waveParts = {};
      for (const [part, re] of Object.entries(PARTS_RE)) {
        const clip = new THREE.AnimationClip('wave_' + part, src.duration, src.tracks.filter(t => re.test(t.name)));
        THREE.AnimationUtils.makeClipAdditive(clip);
        const act = sitterMixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
        act.enabled = true; act.setEffectiveWeight(0); act.play(); waveParts[part] = act;
      }
      waveAction = waveParts.arm;
      SEQ.waveLen = src.duration; bootProgress('clips', 1); perfMark('wave clip loaded');
    });
    // standing up (Mixamo, retargeted) and Tripo's own walk; both start silent and the timeline drives them
    loader.load('/models/stand_up_clip.glb', (g) => {
      const clip = g.animations.find(c => /stand/i.test(c.name)) || g.animations[0];
      if (!clip) return;
      standAction = sitterMixer.clipAction(clip); standAction.setLoop(THREE.LoopOnce, 1); standAction.clampWhenFinished = true;
      standAction.setEffectiveWeight(0); standAction.play(); SEQ.standLen = clip.duration;
    });
    const walk = gltf.animations.find(c => /walk/i.test(c.name));
    if (walk) { walkAction = sitterMixer.clipAction(walk); walkAction.setEffectiveWeight(0); walkAction.play(); }
    // for boarding the fighter: climbing a ladder (a loop) and lowering into a seat (Mixamo, retargeted)
    loader.load('/models/climb_clip.glb', (g) => { const c = g.animations.find(x => /climb/i.test(x.name)) || g.animations[0]; if (c) { climbAction = sitterMixer.clipAction(c); climbAction.setLoop(THREE.LoopOnce, 1); climbAction.clampWhenFinished = true; climbAction.setEffectiveWeight(0); climbAction.play(); } });
    loader.load('/models/ladder_clip.glb', (g) => { const c = g.animations.find(x => /ladder/i.test(x.name)) || g.animations[0]; if (c) { ladderAction = sitterMixer.clipAction(c); ladderAction.setEffectiveWeight(0); ladderAction.play(); } });
    loader.load('/models/sit_down_clip.glb', (g) => { const c = g.animations.find(x => /sit/i.test(x.name)) || g.animations[0]; if (c) { sitDownAction = sitterMixer.clipAction(c); sitDownAction.setLoop(THREE.LoopOnce, 1); sitDownAction.clampWhenFinished = true; sitDownAction.setEffectiveWeight(0); sitDownAction.play(); } });
  }, (e) => { if (e.total) bootProgress('jacob', e.loaded / e.total); }, (e) => console.error(e));
}
// The chair, measured in the holder's own frame so it holds while the chair turns: the seat pan is
// the busiest horizontal slice of the chair's lower half, the backrest is what stands well above
// it, and back-to-seat is the way the chair faces.
let chairInfo = null;
function chairMesh() { let m = null; if (chairPivot) chairPivot.traverse(o => { if (!m && o.isMesh && !o.isSkinnedMesh && !(sitter && sitter.getObjectById(o.id))) m = o; }); return m; }
function measureChair() {
  const chair = chairMesh();
  if (!chair) return null;
  chairPivot.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(chairPivot.matrixWorld).invert().multiply(chair.matrixWorld);
  const pos = chair.geometry.attributes.position, pts = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toLocal);
    pts.push(v); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
  }
  const slice = 0.02, count = new Map();
  for (const q of pts) {
    const t = (q.y - lo) / (hi - lo);
    if (t > 0.2 && t < 0.65) { const k = Math.round(q.y / slice); count.set(k, (count.get(k) || 0) + 1); }   // the pan sits anywhere from a third to two-thirds up, by chair
  }
  let best = null;
  for (const [k, n] of count) if (!best || n > best[1]) best = [k, n];
  const seatY = best[0] * slice + slice / 2;
  const seat = new THREE.Vector3(), back = new THREE.Vector3();
  let ns = 0, nb = 0;
  for (const q of pts) {
    if (Math.abs(q.y - seatY) < 0.04) { seat.add(q); ns++; }
    else if (q.y > seatY + 0.35) { back.add(q); nb++; }
  }
  seat.divideScalar(ns || 1); back.divideScalar(nb || 1);
  return { seat, seatY, facing: Math.atan2(seat.x - back.x, seat.z - back.z) };
}
function placeSitter() {
  if (!sitter || !chairPivot) return;
  if (sitter.parent !== chairPivot) chairPivot.add(sitter);
  if (!chairInfo) chairInfo = measureChair();
  if (!chairInfo) return;
  const { seat, seatY, facing } = chairInfo;
  const yaw = facing + THREE.MathUtils.degToRad(SITTER.turn);
  // he stands on his origin facing +z, so the seat of the trousers is SEAT.up above that and SEAT.back behind
  const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  sitter.position.set(seat.x, seatY - SEAT.up + SITTER.height / 100, seat.z).addScaledVector(f, SEAT.back + SITTER.forward / 100);
  sitter.rotation.set(0, yaw, 0);
  sitter.userData.seatPos = sitter.position.clone(); sitter.userData.seatYaw = yaw;
  sitter.visible = SITTER.on;
}

// ── the intro, as a keyframed timeline ────────────────────────────────────────────
// Everything is a function of one time T, so it plays forward on its own or scrubs either way.
// KEYS hold the camera, where it looks, the chair's angle and how hard he faces the camera, at
// moments along the way; between keys the camera runs on a smooth curve and the chair turns
// briskly at both ends. ACTS are the things he does, each at its own moment. All of it is
// editable from the panel while it plays, and Copy settings writes it out to be baked.
// The camera keeps facing the window side: the cabin has no back wall, and looking the other
// way is looking at stars.
const WINDOW = [0.05, 1.8, -1.62];
const KEYS = [
  // Jacob's keys (2026-09-20): a captured look point is pushed out along the line of sight (2 m in
  // the cabin, 1 km outside) so a wobble of the camera's path can never put it behind the camera
  { t: 0,  cam: [-0.028, 1.602, -0.742], look: [-0.027, 1.592, -1.201], chair: -112, face: 0 },   // square on the terminal (the pull-back lands here)
  { t: 1.4,  cam: [1.74, 1.933, 1.591],    look: [0.031, 1.532, -0.695],  chair: -112, face: 0 },
  { t: 2.5,  cam: [2.045, 2.003, 2.362],   look: [0.837, 1.758, 0.787],   chair: 114,  face: 1 },
  { t: 7.98, cam: [0.103, 2.22, -1.746],   look: [-1.852, 2.057, -1.354], chair: 210.9, face: 0.69 },   // at the window (Jacob, 2026-09-27: out at 8 s)
  // OUTSIDE. Station keys are in the station's own metres.
  { t: 7.99, set: 'station', cam: [748.697, 822.855, -292.606], look: [229.139, 788.329, -1146.344] },
  { t: 10,   set: 'station', cam: [2100, 1250, 1400], look: 'station' },           // wide: most of the station (Jacob, 2026-09-27)
  { t: 12.2,  set: 'station', cam: { at: 'mouth', out: 900, up: 380, side: 500 }, look: 'hangar' },   // off the hangar's mouth, so the path from the wide shot stays outside the arms
  { t: 14,   set: 'station', cam: { at: 'mouth', outU: 0.2, upU: 0.07 }, look: 'bay' },            // in, onto the fighter (in hangar units: the cut inside matches)
  // INSIDE THE HANGAR, at human scale: the same hangar and fighter, the fighter 6 m long. He walks
  // in from the right, in his helmet, to the cockpit; then he is in the seat, the canopy closes,
  // and the fighter rolls out of the mouth. Keys are in the set's metres: the fighter's spot on the
  // deck is the origin, the deck is y = 0, the mouth is toward +x.
  { t: 14.01, set: 'hangar', cam: { at: 'mouth', outU: 0.2, upU: 0.07 }, look: 'ship' }, // the same framing as the last shot outside
  { t: 17.5,  set: 'hangar', cam: [5.5, 1.9, -5.5],   look: 'him' },
  // the camera arcs round the cockpit as he climbs aboard, ending behind the fighter as the canopy
  // closes, so he is never seen popping into the seat
  { t: 18.6,  set: 'hangar', cam: [3.4, 2.4, -5.0],   look: 'him' },
  { t: 19.7,  set: 'hangar', cam: [-0.6, 2.9, -6.2],  look: 'him' },
  { t: 20.7,  set: 'hangar', cam: [-4.9, 3.0, -4.3],  look: 'cockpit' },
  { t: 21.7,  set: 'hangar', cam: [-7.0, 2.9, -1.0],  look: 'cockpit' },
  { t: 23.0,  set: 'hangar', cam: [-8.5, 2.7, 1.8],   look: 'cockpit' },
  // from the roll-out the camera locks onto the fighter: `{ at: 'chase', back, up, side }` is
  // metres behind it, above it and to its right, wherever it has got to
  { t: 24,  set: 'hangar', cam: { at: 'chase', back: 9, up: 2.6, side: -4.5 }, look: 'ship' },
  // behind it to the mouth, then the camera holds there and turns to Earth as the fighter climbs away
  // to the top left; the map scene takes over at the same view (syncMapToHangar)
  { t: 26.2,  set: 'hangar', cam: { at: 'chase', back: 11, up: 3.0, side: -2.0 }, look: 'ship' },
  { t: 27.49, set: 'hangar', cam: { at: 'chase', freeze: 26.2, back: 11, up: 3.0, side: -2.0 }, look: 'earth' },   // held just past the mouth: the deck is out of frame
  // the camera stops where the chase had it at 45.2 s and looks away to the right, so the fighter
  // flies on out of the left of the frame; then the map
  // THE MAP. Earth as the photograph, large, the fighter flying in over it toward the States;
  // the outline of the country glows on the picture, then the states of his story light up one
  // by one with a line each. Keys are in the picture's own units (pixels of the photograph,
  // centred, y up), the picture in the z = 0 plane and the camera out along +z.
  { t: 27.5,  set: 'map', cam: [-40, 60, 980],  look: [33, 83, 0] },
  { t: 31,  set: 'map', cam: [33, 83, 380],   look: [33, 83, 0] },
  { t: 43.5,  set: 'map', cam: [30, 80, 330],   look: [25, 88, 0] },
  { t: 46.5,  set: 'map', cam: [34, 78, 320],   look: [25, 88, 0] },
  // RE-ENTRY. The fighter noses down and dives at the country; the camera falls in behind it. Fire
  // builds around the nose and washes the frame out; as it clears, clouds pop into being all round.
  { t: 48,  set: 'map', cam: { at: 'chase', back: 70, up: 24, side: 10 }, look: 'ship' },
  { t: 51.5,  set: 'map', cam: { at: 'chase', back: 40, up: 12, side: 0 },  look: 'ship' },
  { t: 57.5,  set: 'map', cam: { at: 'chase', back: 42, up: 14, side: -6 }, look: 'ship' },
  // THE TOWN. Out of the white: the valley, the fighter coming down through the clouds into its open west end, the camera
  // high behind it. From the last key the flight is live - tap or click where to go, or WASD - and the landmarks are the
  // projects (hover or tap one for its name, click it for its hologram).
  { t: 57.51, set: 'town', cam: { at: 'follow', back: 120, up: 90 }, look: 'jet' },
  { t: 61,  set: 'town', cam: { at: 'follow', back: 38, up: 20 },  look: 'jet' },
];
const ACTS = { wave: 1.3, stand: 2.7, walk: 4.2, walkSpeed: 1.1, walkDir: 75 };   // Jacob's quicker start (2026-09-27)   // seconds; m/s; degrees from +z toward +x
// in the hangar: when he starts walking in, where from (metres beside the fighter's spot, the
// right of the mouth's view is -z), when he is in the seat, when the canopy starts down and how
// long it takes, and when the fighter rolls, at what acceleration
// once he is flying, the mouse (or a sideways finger drag) banks the fighter: how far, in degrees,
// at the edge of the screen, and how quickly it follows
const FLY = { roll: 0, target: 0, maxRoll: 45, follow: 0.08 };
// a scrub pauses the intro; after three seconds with no scrolling and nothing pressed, it plays on
const RESUME = { after: 3, last: 0, held: false, hold: false };   // hold: set by editing in the panel, cleared by a scrub
function scrubbed() { RESUME.last = performance.now(); RESUME.hold = false; }
// the story on the map: which state lights when, and what is said. Poking a state with the
// pointer lights it and shows its line (or just its name) and holds the timeline.
const TOUR = [
  { id: 'CO', t: 31.3, title: 'Colorado',    text: 'Born and raised.' },
  { id: 'NM', t: 33.7, title: 'New Mexico',  text: '4 years USAF avionics on MQ-1 and MQ-9 aircraft.' },
  { id: 'MD', t: 36.1, title: 'Maryland',    text: '4 years Red Team for USAF Cyber Warfare Operations. Computer Science BA, UMUC.' },
  { id: 'MS', t: 38.5, title: 'Mississippi', text: '2 years at Keesler AFB teaching Cyberspace Warfare Operations: Windows, Linux and Python.' },
  { id: 'WA', t: 40.9, title: 'Washington',  text: '7 years AWS Systems Engineer for filesystems (EFS, FSx). Helicopter pilot, 176 hours.' },
];
// where each state's pin stands: a place's [longitude, latitude], or fx / fy set in the panel
// (the fraction of the way across the state, west to east and north to south)
const PINS = {
  CO: { place: 'Cortez',     lonlat: [-108.585, 37.349] },
  NM: { place: 'Alamogordo', lonlat: [-105.960, 32.900] },
  MD: { place: 'Columbia',   lonlat: [-76.861, 39.204] },
  MS: { place: 'Biloxi',     lonlat: [-88.885, 30.396] },
  WA: { place: 'Seattle',    lonlat: [-122.332, 47.606] },
};
const MAP_CLOSEST = 320;               // metres: how near the tour keys bring the camera to the map (the 65.5 s key); a narrow screen stops further out
const MAP = { glow: 29.1, tourEnd: 43.5, shipIn: 27.5, shipAt: 33.5,
  dive: 46.5, diveEnd: 51.1,             // the fighter noses down and races for the cloud bank
  target: [-201, 113, 4],                // where it goes in: the big swirl of cloud off the West Coast, in the picture's units
  fire: 48.1, flash: 50.9, clear: 53.1,  // the glow builds, peaks white, and clears
  clouds: 51.1, cloudsIn: 2.4 };          // clouds pop in over this many seconds from here
// BOARDING (2026-09-27): he walks up to the side of the cockpit (just forward of the wing, where the
// hull only reaches out 0.7 m), climbs the side with the climb clip (climbLen) onto the rim, turns
// to the nose and lowers into the seat (sitIn); the canopy closes behind him and it rolls out.
const BOARD = { rimX: -0.2, rimY: 1.15, rimZ: -0.6, ladderZ: -1.0, climbLen: 1.5, sitIn: 1.0 };   // the ladder hangs from the sill at ladderZ (Jacob's spot, under the cockpit)
const HANGAR = { walk: 14.0, from: [0.3, 0, -5.8], to: [0.0, 0, -1.5], speed: 1.15, climb: 18.6, sit: 21.1, canopy: 21.2, canopyLen: 1.7, roll: 23.5, accel: 5,
  // the fit in the seat: how far down from the measured seat pan he sits, how far back, and how far
  // he reclines (degrees); and how far the canopy turns to shut
  seatDown: 0.17, seatBack: 0, recline: 24, canopyDeg: -50, canopyDrop: 0.05, canopySlide: 0.02 };   // canopyDrop / canopySlide: metres the shut canopy is let down / slid toward the nose
// The greeting comes in parts: each is its own hologram over his head, which forms, holds, and
// dissolves again as the next one forms.
const PARTS = [
  { start: 2.4, end: 6.2, size: 0.07, lines: ['Welcome To', 'Jconra.com'] },
  { start: 5.8, end: 7.98, size: 0.034, lines: ['Hello! I am Jacob Conrads,', 'a Systems Engineer.', 'This is a project to play around', 'with and highlight my skills.', 'Thank you for visiting!'] },
];
// ── the station outside ──────────────────────────────────────────────────────────
// The second set, 100 km from the cabin in the same scene, built from the kit with its default
// layout (the one set in the Station Builder). Shown only while the timeline is outside.
const STATION_AT = new THREE.Vector3(100000, 0, 0);
const HANGAR_AT = new THREE.Vector3(-100000, 0, 0);       // the human-scale hangar, off on its own
const MAP_AT = new THREE.Vector3(0, 0, 120000);            // the map over the photograph, off on its own
const TOWN_AT = new THREE.Vector3(0, 0, 0);                // the projects world: the valley, in a scene of its own (its own origin)
let town = null, valley = null, townCam = null, townControls = null, townFailed = false, townBuilding = false;
const TOWN_INPUT = { dest: null, holding: false, turn: 0, throttle: 0 };
const liveInTown = () => currentSet === 'town' && SEQ.T >= total() - 1e-6;
const SKY = new THREE.Color(0x9ec9ec);
let mapSet = null, poked = null, hangarIndex = -1, hangarMatrix = null, twin = null;
let station = null, stationLoading = false, hangarAt = null, bayAt = null, hangarMouth = null, currentSet = 'cabin', hangarSet = null, helmet = null;
function loadStation() {
  if (station || stationLoading) return;
  stationLoading = true;
  loadKit('/models/kit/', f => bootProgress('station', f)).then(parts => {
    bootProgress('station', 1);
    perfMark('station kit loaded'); station = new StationKit(parts).build(DEFAULT_LAYOUT);
    station.position.copy(STATION_AT); station.visible = false; scene.add(station); checkBoot();
    pickHangar();
    buildTraffic(parts);
    hangarSet = buildHangarSet(parts, { shipLength: 7, bayLength: DEFAULT_LAYOUT.bay.length, along: DEFAULT_LAYOUT.bay.along });
    hangarSet.floor.position.copy(HANGAR_AT); hangarSet.floor.visible = false; scene.add(hangarSet.floor);
    // The rest of the station, seen through the mouth and the openings of the human-scale hangar:
    // a second station, placed so that ITS copy of this hangar lands exactly on the human-scale
    // one (then that copy, and what is parked in it, is shrunk away). So what was behind the
    // camera outside is behind it inside, and the cut is only a change of scale nobody can see.
    if (hangarMatrix) {
      twin = new StationKit(parts).build(DEFAULT_LAYOUT);
      const HS = hangarSet;
      twin.matrixAutoUpdate = false;
      twin.matrix.makeScale(HS.hu, HS.hu, HS.hu).multiply(new THREE.Matrix4().makeTranslation(-HS.fx, -HS.bay.deckY, 0)).multiply(hangarMatrix.clone().invert());
      const gone = new THREE.Matrix4().makeScale(0, 0, 0);
      twin.traverse(o => { if (o.isInstancedMesh && o.count === twin.hangars.length) { o.setMatrixAt(hangarIndex, gone); o.instanceMatrix.needsUpdate = true; } });
      HS.floor.add(twin);
    }
    // Earth out past the mouth, where the fighter is headed: the same photograph, facing back
    // at the hangar, hung below the line of flight
    const earthOut = picture.clone(); earthOut.material = picture.material;
    // far enough out that twenty seconds of flight hardly changes its size, and scaled to match
    earthOut.position.set(hangarSet.mouth.x + 12000, -3400, 0); earthOut.scale.setScalar(14);
    earthOut.rotation.set(0, -Math.PI / 2, 0); earthOut.rotateX(Math.atan2(3400, 12000));
    hangarSet.floor.add(earthOut); hangarSet.earthOut = earthOut;
    buildMapSet(parts);
    syncMapToHangar(); perfMark('station, hangar and map built');
    buildTownSet(parts);
    loader.load('/models/props/helmet.glb', (g) => {
      helmet = g.scene; helmet.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace; } });
      wearHelmet();
    });
  }).catch(e => console.error(e));
}
// THE TOWN SET: the valley village (src/valley.js: the Terrain Lab's world with the shipped town and planting, the land
// from its bake), in a scene of its own with its own sky, haze and light, seen through its own camera (townCam). Until the
// town is shown that camera waits where the fighter arrives, so the plants are laid and the trees' pictures baked there
// beforehand; then the timeline's camera is copied into it through the arrival, and in the live flight it follows the
// fighter itself (or the landmarks' holograms move it). The fighter: src/objects/valleyFlight.js
async function buildTownSet(parts) {
  townBuilding = true; perfMark('town: building');
  try {
    const [{ makeValley }, { valleyFlight }] = await Promise.all([import('./valley.js'), import('./objects/valleyFlight.js')]);
    townCam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.1, 6000);
    townControls = { target: new THREE.Vector3(), enabled: false, enableZoom: false, update() { townCam.lookAt(this.target); }, addEventListener() {} };   // (the holograms' glide moves these)
    valley = await makeValley({ renderer, camera: townCam, controls: townControls, quality: chooseTier(renderer), slice: true, showEnabled: () => liveInTown() });   // (laid a slice a frame: the boot and the cabin play on meanwhile)
    town = valleyFlight({ V: valley, parts });
    const A = town.ARRIVE, f = A.to.clone().sub(A.from).setY(0).normalize();
    townCam.position.copy(A.to).addScaledVector(f, -FOLLOW.back).add(new THREE.Vector3(0, FOLLOW.up, 0)); townControls.target.copy(A.to).addScaledVector(f, FOLLOW.ahead); townCam.lookAt(townControls.target);
    perfMark('town: built (plants and trees next)');
    if (currentSet === 'town') { townRatio(true); seek(SEQ.T); }      // (someone got to the town before it was ready: shown now, from where they are)
  } catch (e) { townFailed = true; tourBar(); console.error('town: not built', e); }
}
// the town drawn at its quality tier's pixel ratio (a phone's 1.5, potato's 0.5: the Terrain Lab's), the film's elsewhere
function townRatio(on) { renderer.setPixelRatio(Math.min(devicePixelRatio, on && valley ? valley.TS.ratio : 2)); post.setSize(innerWidth, innerHeight); }
// the timeline's camera into the town's (through the arrival)
function syncTownCam() { townCam.position.copy(camera.position); townCam.quaternion.copy(camera.quaternion); townControls.target.copy(controls.target); }
// the fighter over the town: by the clock through the last keys, live after them
function stepTown(T, a, b, u, set = 'town') {
  const showTime = () => { const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2); $('seqTimeOut').textContent = T.toFixed(1) + ' s'; };
  if (!town) { tourBar(); showTime(); return; }                      // (not built yet: the bar says it's coming)
  const t0 = KEYS.find(k => setOf(k) === 'town').t, live = T >= total() - 1e-6;
  if (live && town.liveFrom) { showTime(); return; }                 // (the live flight has the cameras: a scrub on past the end changes nothing)
  if (!live) { const sc = valley.SHOW.sc; if (sc && sc.isOpen) { sc.back = null; sc.close(); }   // (back into the timeline: any hologram goes, and nothing glides)
    town.poseAt(T - t0, total() - t0); town.liveFrom = false; tourStop(false); tourBar(); }
  else { town.poseAt(total() - t0, total() - t0); town.liveFrom = true; TOWNTOUR.startAt = performance.now() + 1500; }   // however it got here (a jump to the end, too), the live flight starts where the arrival ends
  town.setCloud(1 - THREE.MathUtils.smoothstep(T, t0, t0 + 3.2));
  camera.position.copy(cameraAt(T)).add(TOWN_AT);
  controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u)); camera.lookAt(controls.target);
  syncTownCam(); town.faceClouds(townCam);
  post.focus = camera.position.distanceTo(controls.target);
  for (const h of holos) h.fill = 0;
  showTime();
}
// the live flight, once the timeline has run out: the fighter goes where it is sent and the
// camera follows it smoothly
const FOLLOW = { back: 38, up: 20, ahead: 30 };
function liveTown(dt) {
  if (!town || currentSet !== 'town') return;
  town.update(dt, TOWN_INPUT);
  const sc = valley.SHOW.sc;
  if (!(sc && (sc.gliding || sc.isOpen))) {                // (a hologram open, or its camera on the way: the camera is its)
    const f = town.forward(), want = town.state.pos.clone().addScaledVector(f, -FOLLOW.back).add(new THREE.Vector3(0, FOLLOW.up, 0));
    want.y = Math.max(want.y, town.groundAt(want.x, want.z) + 6);   // (never into a hillside behind it)
    townCam.position.lerp(want, Math.min(1, dt * 2.5));
    townControls.target.lerp(town.lookAhead(FOLLOW.ahead), Math.min(1, dt * 4)); townCam.lookAt(townControls.target);
  }
  town.faceClouds(townCam);
}
// THE TOUR: a little after the fighter has arrived, it flies to each landmark in turn (in from the side the landmark faces,
// so its hologram faces the camera; the globe with the observatory behind it; Montana's flowers from the south, so the
// state reads the right way up) and opens its hologram for a while, then flies on. Any touch, click, scroll or key hands
// the controls back at once (an open hologram stays, still: a tap off it closes it); the bar at the bottom says where the
// tour is, and offers it again (a scroll still runs the film: back, it leaves the town, and the tour starts over when the
// arrival comes round again). `item`: the layout's own building or prop (else the landmark's first); `d`: how far out
// the fighter stops; `side`: the way from the landmark to the viewer, if not the way it faces
const TOWNTOUR = { on: false, user: false, done: false, i: -1, phase: 'idle', t: 0, leg: 0, A: null, B: null, target: null, startAt: 0, dwell: 10, shown: '', shownCur: false,
  stops: [
    { id: 'rmrf', item: 'imurp4z641c', d: 52 },                         // the hangar, from its open front (the Lurcher in its door)
    { id: 'subnet', item: 'obelisk1', d: 26 },                          // the obelisk, from the face its message starts on
    { id: 'math', item: 'imurp4z6311', d: 50 },                         // the school, from the street it faces
    { id: 'labs', item: 'imurp4z63u', d: 26 },                          // an easel on the plaza
    { id: 'portfolio', item: 'imurp4z632', d: 58 },                     // the town hall, from the plaza
    { id: 'valehex', item: 'valehex1', d: 30, side: [0.71, 0.71] },     // the globe, the observatory behind it
    { id: 'montana', item: 'montana1', d: 52, side: [0, 1] },           // the outline in flowers, from the south
    { id: 'shipwrecked', item: 'raft1', d: 38, side: [0, -1] },         // the raft on the pond, from the town's shore
  ] };
// where to stop for a landmark: A, well out; then B, in front of it (so the fighter arrives facing it)
function tourAim(stop) {
  const T = TOWNTOUR, all = valley.SHOW.sc.targets(), tg = all.find((t) => t.item && t.item.id === stop.item) || all.find((t) => t.id === stop.id);
  if (!tg || !tg.box) return false;
  const c = tg.box.getCenter(new THREE.Vector3()), a = ((tg.item && tg.item.rot) || 0) * Math.PI / 180;
  const s = stop.side ? new THREE.Vector3(stop.side[0], 0, stop.side[1]).normalize() : new THREE.Vector3(Math.sin(a), 0, Math.cos(a));   // (a building's front: its own +z, turned with it)
  T.target = tg; T.A = c.clone().addScaledVector(s, stop.d + 45).setY(0); T.B = c.clone().addScaledVector(s, stop.d).setY(0);
  return true;
}
function tourStart(from = 0) {
  const T = TOWNTOUR, sc = valley && valley.SHOW.sc; if (!town || !sc || !liveInTown()) return;
  if (sc.isOpen) { sc.back = null; sc.close(); }                     // (one left open: the tour's camera follows the fighter from here)
  T.on = true; T.user = false; T.done = false; T.startAt = 0; T.i = from - 1; tourNext();
}
function tourNext() {
  const T = TOWNTOUR; T.i++;
  while (T.i < T.stops.length && !tourAim(T.stops[T.i])) T.i++;     // (a landmark that isn't there: passed over)
  if (T.i >= T.stops.length) { T.on = false; T.done = true; T.i = -1; TOWN_INPUT.dest = null; TOWN_INPUT.cruise = 0; tourBar(); return; }
  T.phase = 'fly'; T.leg = 0; T.t = 0; T.shownCur = false; TOWN_INPUT.dest = T.A.clone(); TOWN_INPUT.cruise = 24; TOWN_INPUT.holding = false; tourBar();
}
function tourStop(byUser = true) {
  const T = TOWNTOUR; if (!T.on) return;
  T.on = false; if (byUser) T.user = true;
  TOWN_INPUT.dest = null; TOWN_INPUT.cruise = 0;
  const sc = valley && valley.SHOW.sc; if (sc && (sc.isOpen || sc.gliding)) { sc.touched(); sc.back = null; }   // (it stays, the slides still; closed later, the camera goes back to the fighter)
  tourBar();
}
function tourStep(dt) {
  const T = TOWNTOUR;
  if (!T.on) { if (T.startAt && performance.now() > T.startAt && !T.user && valley && valley.SHOW.sc) { T.startAt = 0; tourStart(0); } tourBar(); return; }
  if (!liveInTown() || !valley.SHOW.sc) { tourStop(false); return; }
  const sc = valley.SHOW.sc, p = town.state.pos; T.t += dt;
  if (T.phase === 'fly') {   // (30 s a stretch at most: held up somewhere, on with the next)
    if (T.leg === 0 && (Math.hypot(p.x - T.A.x, p.z - T.A.z) < 25 || T.t > 30)) { T.leg = 1; T.t = 0; TOWN_INPUT.dest = T.B.clone(); }   // (on into the last stretch without stopping)
    else if (T.leg === 1 && ((!TOWN_INPUT.dest && town.state.speed < 1.5) || T.t > 30)) { T.phase = 'settle'; T.t = 0; }
  } else if (T.phase === 'settle') { if (T.t > 0.8) { sc.present(T.stops[T.i].id, T.target); T.phase = 'show'; T.t = 0; T.shownCur = true; } }
  else if (T.phase === 'show') { if (T.t > T.dwell) { sc.close(); T.phase = 'back'; T.t = 0; } }
  else if (T.phase === 'back') { if (!sc.gliding && T.t > 1.2) tourNext(); }
  tourBar();
}
// the bar: while touring, where it is; otherwise (in the live town) the button to tour again
function tourBar() {
  const T = TOWNTOUR, el = $('tourBar'); if (!el) return;
  const live = liveInTown() && valley && valley.SHOW.sc, stop = T.on && T.i >= 0 ? T.stops[T.i] : null;
  const lm = stop && valley.SHOW.sc.byId ? valley.SHOW.sc.byId.get(stop.id) : null;
  const waiting = currentSet === 'town' && !town;                    // (the town not built yet, or it failed)
  const state = waiting ? (townFailed ? 'failed' : 'loading') : !live ? 'off' : T.on ? `on:${T.i}` : T.startAt && !T.user ? 'off' : 'button';
  if (state === T.shown) return; T.shown = state;
  el.classList.toggle('on', state !== 'off');
  $('tourText').textContent = stop ? `Touring the town · ${T.i + 1} of ${T.stops.length}${lm ? ': ' + lm.label : ''}` : waiting ? (townFailed ? "The town didn't load" : 'The town is on its way…') : '';
  $('tourHint').textContent = T.on ? 'Tap or press a key to fly yourself' : waiting && townFailed ? 'Reloading the page may bring it' : '';
  $('tourGo').hidden = T.on || waiting; $('tourGo').textContent = T.user && !T.done ? 'Go on with the tour' : 'Tour the town';
}
$('tourGo')?.addEventListener('click', () => { const T = TOWNTOUR; tourStart(T.user && !T.done && T.i >= 0 ? T.i + (T.shownCur ? 1 : 0) : 0); });   // (on from the stop it was at, or the next if that one was shown)
// the visitor's own touch, click or key hands the controls back (heard first, before anything acts on it, and not stopped);
// before the tour has begun, it's theirs from the start. A scroll is the film's (it runs the timeline), unless it's over a
// hologram's screen, reading it
for (const ev of ['pointerdown', 'wheel', 'keydown']) addEventListener(ev, (e) => {
  const T = TOWNTOUR; if (!T.on && !(T.startAt && liveInTown())) return;
  if (e.target && e.target.closest && e.target.closest('#tourGo')) return;
  if (ev === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return;
  if (ev === 'wheel') { const sc = valley && valley.SHOW.sc; if (!(sc && sc.screenAt(e.clientX, e.clientY))) return; }
  if (T.on) tourStop(true); else { T.user = true; T.startAt = 0; tourBar(); }
}, { capture: true, passive: true });
// pointing at the town: the landmarks answer for themselves (hover names one, a click raises its hologram: the valley's
// showcase); a click on the ground sends the fighter there, a press held steers it; WASD steers
{
  const ray = new THREE.Raycaster();
  let down = new THREE.Vector2();
  const cast = (e) => { ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), townCam); return ray; };
  // a landmark, its hologram, or (with one open) a tap that closes it: the showcase's, not the fighter's
  const showcases = (e) => { const sc = valley && valley.SHOW.sc; return !!(sc && (sc.isOpen || sc.screenAt(e.clientX, e.clientY) || sc.landmarkAt(e.clientX, e.clientY))); };
  // a press held for a moment steers: the fighter chases the ground under the finger (or mouse)
  // until it is let go, then finishes the trip and stops; a quick tap is handled on release
  let holdTimer = 0, steering = false, lastE = null;
  const steerTo = (e) => { const g = town.groundPoint(cast(e)); if (g) TOWN_INPUT.dest = g.sub(TOWN_AT); };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down.set(e.clientX, e.clientY); lastE = e;
    if (!town || !liveInTown() || !e.isPrimary || showcases(e)) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { if (TOWN_SCRUBBING()) return; steering = true; TOWN_INPUT.holding = true; steerTo(lastE); }, 160);
  });
  renderer.domElement.addEventListener('pointermove', (e) => { lastE = e; if (steering && liveInTown()) { if (TOWN_SCRUBBING()) { steering = false; TOWN_INPUT.holding = false; TOWN_INPUT.dest = null; return; } steerTo(e); } });
  const release = () => { clearTimeout(holdTimer); const was = steering; steering = false; TOWN_INPUT.holding = false; return was; };
  renderer.domElement.addEventListener('pointercancel', release);
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (release()) return;                                   // it was a hold: the fighter goes on to where the finger was
    if (!liveInTown() || !town || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || showcases(e)) return;
    const g = town.groundPoint(cast(e)); if (g) TOWN_INPUT.dest = g.sub(TOWN_AT);
  });
  const keys = {};
  addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; steer(); });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; steer(); });
  function steer() {
    TOWN_INPUT.turn = (keys.a ? 1 : 0) - (keys.d ? 1 : 0); TOWN_INPUT.throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    if (TOWN_INPUT.turn) TOWN_INPUT.dest = null;
    const sc = valley && valley.SHOW.sc;                               // (flying off with a hologram open: it goes, and the camera goes with the fighter)
    if ((TOWN_INPUT.turn || TOWN_INPUT.throttle) && sc && sc.isOpen && liveInTown()) { sc.back = null; sc.close(); }
  }
}
// THE MAP SET: the photograph as a big flat picture (its own pixels as units), the states laid on
// it, and a copy of the fighter to fly in over it.
function buildMapSet(parts) {
  const floor = new THREE.Group(); floor.position.copy(MAP_AT); floor.visible = false; scene.add(floor);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(833, 827), picture.material); floor.add(pic);
  const ship = new THREE.Group(); ship.add(shutFighter(parts.ship1, { metres: 26 })); floor.add(ship);      // canopy shut for the flight
  // re-entry fire: a soft orange glow on the nose, drawn once on a canvas
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
  { const g = glowCanvas.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,250,230,1)'); r.addColorStop(0.25, 'rgba(255,190,90,0.9)'); r.addColorStop(0.6, 'rgba(255,90,30,0.35)'); r.addColorStop(1, 'rgba(255,60,20,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); }
  // (planes turned to the camera, not sprites: a sprite's depth does not agree with the post-processing's, and it whited out the fighter)
  const plume = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  plume.scale.setScalar(0.01); plume.renderOrder = 2; floor.add(plume);
  // sparks: points streaming back off the nose while the fire is on
  const nSparks = 220, sparkPos = new Float32Array(nSparks * 3), sparkSeed = new Float32Array(nSparks * 4);
  for (let i = 0; i < nSparks; i++) { sparkSeed[i * 4] = Math.random(); sparkSeed[i * 4 + 1] = Math.random() - 0.5; sparkSeed[i * 4 + 2] = Math.random() - 0.5; sparkSeed[i * 4 + 3] = 0.6 + Math.random() * 0.8; }
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  { const g = dot.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,220,160,0.8)'); r.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); }
  const sparks = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sparkPos, 3)),
    new THREE.PointsMaterial({ color: 0xffc27a, map: new THREE.CanvasTexture(dot), size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.userData.seed = sparkSeed; sparks.frustumCulled = false; sparks.renderOrder = 2; floor.add(sparks);
  // clouds: white puffs on sprites, scattered about the fighter's way down, each popping in at its own moment
  const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = cloudCanvas.height = 256;
  { const g = cloudCanvas.getContext('2d'); let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 26; i++) { const x = 60 + rnd() * 136, y = 90 + rnd() * 90, r = 22 + rnd() * 34, k = g.createRadialGradient(x, y, 0, x, y, r);
      k.addColorStop(0, 'rgba(255,255,255,0.95)'); k.addColorStop(0.55, 'rgba(240,244,250,0.55)'); k.addColorStop(1, 'rgba(230,236,245,0)'); g.fillStyle = k; g.fillRect(0, 0, 256, 256); } }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas), clouds = [];
  { let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 46; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.92 }));
      // spread around where the dive ends, all below the chase camera's height so they are in front of it
      c.userData = { at: new THREE.Vector3(MAP.target[0] + (rnd() - 0.5) * 260, MAP.target[1] + (rnd() - 0.5) * 200, 2 + rnd() * 24), size: 24 + rnd() * 44, when: rnd() };
      c.position.copy(c.userData.at); c.visible = false; c.renderOrder = 2; floor.add(c); clouds.push(c);   // over the state outlines (1)
    } }
  mapSet = { floor, pic, ship, plume, sparks, clouds, map: null };
  loadUSMap('/labs/map/us.svg').then(map => {
    mapSet.map = map; pic.add(map.group); map.setResolution(innerWidth, innerHeight);
    for (const s of TOUR) { map.flag(s.id); map.pin(s.id, PINS[s.id] || {}); }
    applyMapFit();
  }).catch(e => console.error(e));
}
// MAP FIT. Nudges on the fitted map, about the middle of the country: turn (degrees, clockwise),
// shift (picture pixels) and size (%). Set from the panel, baked from Copy settings.
const MAPFIT = { turn: 0, x: 0, y: 0, size: 100 };
const MAP_PIVOT = new THREE.Vector3(33, 83, 0);
// the Pins panel: pick a state (the timeline jumps to its moment), then move its pin
function pinState() { return $('pinState') ? $('pinState').value : 'CO'; }
function movePinFromPanel(key, v) {
  const id = pinState(), m = mapSet && mapSet.map; if (!m) return;
  const cur = (m.states.get(id) || {}).pinAt || { fx: 0.5, fy: 0.5 };
  PINS[id] = { fx: cur.fx, fy: cur.fy, [key]: v }; m.movePin(id, PINS[id]);
}
function showPin() {
  const id = pinState(), m = mapSet && mapSet.map; const at = m && m.states.get(id) && m.states.get(id).pinAt; if (!at) return;
  $('pinX').value = Math.round(at.fx * 100); $('pinXOut').textContent = Math.round(at.fx * 100) + '% east';
  $('pinY').value = Math.round(at.fy * 100); $('pinYOut').textContent = Math.round(at.fy * 100) + '% south';
  const s = TOUR.find(x => x.id === id); if (s) { if (!SEQ.active) activateIntro(); SEQ.playing = false; RESUME.hold = true; seek(s.t + 0.8); }
}
function applyMapFit() {
  const m = mapSet && mapSet.map; if (!m) return;
  const g = m.group, k = MAPFIT.size / 100, a = -THREE.MathUtils.degToRad(MAPFIT.turn);
  g.rotation.set(0, 0, a); g.scale.setScalar(k);
  // turned and scaled about the pivot, then shifted
  const p = MAP_PIVOT.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), a).multiplyScalar(k);
  g.position.copy(MAP_PIVOT).sub(p).add(new THREE.Vector3(MAPFIT.x, MAPFIT.y, 0));
}
function stepMap(T, a, b, u, set = 'map') {
  const MS = mapSet; if (!MS) return;
  if (T < MAP.shipIn + MAP_HANDOFF.len) { syncMapToHangar(); ({ a, b, u } = keysAround(T)); }   // keys may have been edited: the hand-over follows them
  // the fighter comes in from the top left and settles high over the country
  // a slow, steady drift across the top of the frame from the cut until the dive
  const w = THREE.MathUtils.clamp((T - MAP.shipIn) / (MAP.dive - MAP.shipIn), 0, 1);
  const from = new THREE.Vector3(-220, 186, 60), to = new THREE.Vector3(150, 172, 60);
  MS.ship.position.lerpVectors(from, to, w).add(new THREE.Vector3(0, Math.sin(T * 0.8) * 2, 0));
  let dir = to.clone().sub(from).normalize();
  // the hand-over: it starts where and as big as the hangar's fighter was, flies out to the top left
  // and turns right into the drift (its size eases up as it gets farther away, so it reads as flying on)
  // Done in the camera's own view, because the map camera is already flying in fast: it starts at
  // the hangar fighter's spot on screen, drifts up and left as it pulls away (smaller), and meets its
  // own path, at its own size, as the hand-over ends
  const H = MAP_HANDOFF, h = H.off ? THREE.MathUtils.clamp((T - MAP.shipIn) / H.len, 0, 1) : 1;
  if (h < 1) {
    const tEnd = MAP.shipIn + H.len, wEnd = THREE.MathUtils.clamp((tEnd - MAP.shipIn) / (MAP.dive - MAP.shipIn), 0, 1);
    const pathEnd = from.clone().lerp(to, wEnd).add(new THREE.Vector3(0, Math.sin(tEnd * 0.8) * 2, 0));
    const offEnd = mapCamFrame(tEnd).toLocal(MS.floor.localToWorld(pathEnd.clone()));
    const e = THREE.MathUtils.smoothstep(h, 0, 1), cam = mapCamFrame(T);
    const off = H.off.clone().lerp(offEnd, e), d = off.length();
    off.addScaledVector(new THREE.Vector3(-0.35, 0.25, 0), d * Math.sin(Math.PI * e) * 0.2);   // bows out to the top left on the way
    // never out of frame: held inside 78% of the view at its distance
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * off.z * 0.78, tx = ty * camera.aspect;
    off.x = THREE.MathUtils.clamp(off.x, -tx, tx); off.y = THREE.MathUtils.clamp(off.y, -ty, ty);
    MS.ship.position.copy(MS.floor.worldToLocal(cam.toWorld(off)));
    const s0 = H.scale / H.off.length(), s1 = 1 / offEnd.length();
    MS.ship.scale.setScalar(s0 * Math.pow(s1 / s0, e) * d);                              // its size on screen eases from one to the other
    dir = H.dir.clone().lerp(dir, THREE.MathUtils.smoothstep(h, 0.2, 0.85)).normalize();
  } else MS.ship.scale.setScalar(1);
  // the dive: it noses down and drops toward the ground, shaking as the air bites
  const d = THREE.MathUtils.smoothstep(T, MAP.dive, MAP.diveEnd);
  if (d > 0) {
    const down = new THREE.Vector3(...MAP.target);
    MS.ship.position.lerp(down, d);
    dir = dir.clone().lerp(down.clone().sub(to).normalize(), d).normalize();
    const shake = THREE.MathUtils.smoothstep(T, MAP.fire, MAP.flash) * (1 - THREE.MathUtils.smoothstep(T, MAP.flash, MAP.clear));
    MS.ship.position.add(new THREE.Vector3(Math.sin(T * 61) , Math.cos(T * 47), Math.sin(T * 53)).multiplyScalar(0.6 * shake));
  }
  MS.ship.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  MS.ship.rotateX(THREE.MathUtils.degToRad(FLY.roll));
  { const bn = MS.ship.children[0] && MS.ship.children[0].userData.burner; if (bn) { bn.setThrust(d > 0 ? 1 : 0.55); bn.update(1 / 60); } }   // full burn for the dive
  // fire on the nose, and the wash-out over the frame
  const fire = THREE.MathUtils.smoothstep(T, MAP.fire, MAP.flash) * (1 - THREE.MathUtils.smoothstep(T, MAP.flash, MAP.clear));
  MS.plume.position.copy(MS.ship.position).addScaledVector(dir, 10);
  MS.plume.scale.setScalar(4 + 70 * fire); MS.plume.material.opacity = fire; MS.plume.quaternion.copy(camera.quaternion);
  $('flash').style.opacity = (0.72 * Math.pow(fire, 1.6)).toFixed(3);      // never quite opaque: the ship and the clouds show through the fire
  // sparks stream back from the nose, each on its own little track, and fade with the fire
  { const P = MS.sparks.geometry.attributes.position, sd = MS.sparks.userData.seed, nose = MS.ship.position.clone().addScaledVector(dir, 10);
    const side = dir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize(), upv = side.clone().cross(dir);
    for (let i = 0; i < P.count; i++) {
      const back = ((T * 9 * sd[i * 4 + 3] + sd[i * 4] * 40) % 40), spread = back * 0.35;
      const q = nose.clone().addScaledVector(dir, -back).addScaledVector(side, sd[i * 4 + 1] * spread * 2).addScaledVector(upv, sd[i * 4 + 2] * spread * 2);
      P.setXYZ(i, q.x, q.y, q.z);
    }
    P.needsUpdate = true; MS.sparks.material.opacity = fire; }
  // clouds pop in as the fire clears, each at its own moment, growing with a little overshoot
  for (const c of MS.clouds) {
    const k = (T - MAP.clouds - c.userData.when * MAP.cloudsIn) / 0.5;
    c.visible = k > 0;
    if (c.visible) { const e = k >= 1 ? 1 : 1 - Math.pow(1 - Math.min(1, k), 3) * Math.cos(Math.min(1, k) * 4); c.scale.setScalar(c.userData.size * Math.max(0.01, e)); c.quaternion.copy(camera.quaternion); }
  }
  if (MS.map) {
    MS.map.glow(THREE.MathUtils.smoothstep(T, MAP.glow, MAP.glow + 1.4));
    // the story: the current state, unless one is being poked at
    let current = null;
    for (const s of TOUR) if (T >= s.t && T < MAP.tourEnd) current = s;
    const show = poked ? (TOUR.find(s => s.id === poked) || { id: poked, title: MS.map.states.get(poked)?.name || poked, text: '' }) : current;
    for (const st of MS.map.states.values()) {
      const want = show && st.id === show.id ? 1 : 0;
      st.amount += (want - st.amount) * 0.25; MS.map.apply(st);
    }
    const cap = $('mapCaption');
    if (show) { cap.querySelector('b').textContent = show.title; cap.querySelector('span').textContent = show.text; cap.classList.add('on'); }
    else cap.classList.remove('on');
  }
  camera.position.copy(cameraAt(T)).add(MAP_AT);
  controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u));
  // A narrow screen sees less across, so the keys (framed on a 16:9 screen) would crop both coasts.
  // The camera's approach stops early instead: never nearer than the distance at which the closest
  // tour key's view (framed for 16:9) still fits across this screen - the map smaller, never
  // cropped, and never pulled back mid-shot. It lets go over the 1.5 s before the dive.
  const closest = MAP_CLOSEST * Math.max(1, (16 / 9) / camera.aspect), hold = 1 - THREE.MathUtils.smoothstep(T, MAP.dive, MAP.dive + 1.5);
  const off = camera.position.clone().sub(controls.target), dist = off.length();
  if (hold > 0 && dist < closest) camera.position.copy(controls.target).addScaledVector(off, THREE.MathUtils.lerp(dist, closest, hold) / dist);
  camera.lookAt(controls.target);
  post.focus = camera.position.distanceTo(controls.target);
  for (const h of holos) h.fill = 0;
  const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
  $('seqTimeOut').textContent = T.toFixed(1) + ' s';
}
// poking at the map: the state under the pointer lights up and the timeline holds while it is
{
  const ray = new THREE.Raycaster();
  const at = (e) => {
    if (currentSet !== 'map' || !mapSet || !mapSet.map) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const id = mapSet.map.pick(ray);
    if (id !== poked) { poked = id; if (!SEQ.playing) seek(SEQ.T); }
    if (id) { SEQ.playing = false; scrubbed(); }
  };
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') at(e); });
  renderer.domElement.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') at(e); });
}
// TRAFFIC. Nothing is parked in space: what flies, flies on the timeline. A freighter crosses far
// behind the station while the camera is wide, and a pair of fighters comes past close in front
// during the pan to the hangar. Paths are straight, in the station's metres, from one point to
// another over a span of seconds; each craft points along its path and is only there while it
// is on it.
const FLYBYS = [
  // the freighter cruises in a STRAIGHT line, right to left across the camera's view as it is at
  // `at` seconds (the wide shot): the line is set out in that view - so much ahead and up, this
  // long, along the view's right - and then it is just a line in the world, so it never backs up
  // or turns however the camera moves
  { part: 'freighter', size: 260, flip: true, line: { at: 10, fwd: 1300, up: 120, span: 1800 }, t0: 7.99, t1: 14 },   // flip: the part's nose is at -x
  // the pair's path is set against the camera's own view at its start and end - metres ahead, to
  // the right and up from where the camera is and looks at that moment - so it crosses the frame
  // the pair's path is given in the camera's view the whole way (`inView`), not just at its ends,
  // so however the camera pans they cross the frame over the four seconds, right to left
  { part: 'ship1', size: 50, inView: true, from: { fwd: 420, across: -1.25, up: -95 }, to: { fwd: 380, across: 1.25, up: -60 }, t0: 10.4, t1: 13.4, wing: [0, 14, 44] },
];
// a point given against the camera's view at time t, in the station's metres
function viewPoint(t, { fwd, right, up }) {
  const { a, b, u, set } = keysAround(t);
  const cam = cameraAt(t), target = lookPoint(a.look, set).lerp(lookPoint(b.look, set), u).sub(STATION_AT);
  const f = target.sub(cam).normalize(), r = f.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), U = r.clone().cross(f);
  return cam.addScaledVector(f, fwd).addScaledVector(r, right).addScaledVector(U, up);
}
let traffic = [], burners = [];
function buildTraffic(parts) {
  traffic = [];
  for (const f of FLYBYS) {
    const P = parts[f.part]; if (!P) continue;
    const group = new THREE.Group();
    const k = f.size / P.size.x, n = f.wing ? 2 : 1;
    for (let i = 0; i < n; i++) {
      // the fighters fly with their canopies shut and their burners lit
      let m;
      if (f.part === 'ship1') { m = shutFighter(P, { metres: f.size }); m.position.y = 0; m.userData.burner.setThrust(1); burners.push(m.userData.burner); }
      else { m = new THREE.Mesh(P.geometry, P.material); m.scale.setScalar(k); m.castShadow = m.receiveShadow = true; }
      if (i) m.position.set(...f.wing);
      group.add(m);
    }
    // pointed along the path: the parts lie along +x
    let from, to;
    if (f.line) {
      const { a, b, u, set } = keysAround(f.line.at);
      const cam = cameraAt(f.line.at), target = lookPoint(a.look, set).lerp(lookPoint(b.look, set), u).sub(STATION_AT);
      const fwd = target.sub(cam).normalize(), right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const centre = viewPoint(f.line.at, { fwd: f.line.fwd, right: 0, up: f.line.up });
      from = centre.clone().addScaledVector(right, f.line.span / 2); to = centre.clone().addScaledVector(right, -f.line.span / 2);
    } else {
      from = Array.isArray(f.from) ? new THREE.Vector3(...f.from) : f.inView ? new THREE.Vector3() : viewPoint(f.t0, f.from);
      to = Array.isArray(f.to) ? new THREE.Vector3(...f.to) : f.inView ? new THREE.Vector3(1, 0, 0) : viewPoint(f.t1, f.to);
    }
    const dir = to.clone().sub(from).normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    if (f.flip) for (const m of group.children) m.rotation.y = Math.PI;      // the part's nose is at -x
    group.visible = false;
    station.add(group);
    traffic.push({ ...f, group, from, to, spec: f });
  }
}
function stepTraffic(T) {
  for (const bn of burners) bn.update(1 / 60);
  for (const f of traffic) {
    const u = (T - f.t0) / (f.t1 - f.t0);
    f.group.visible = u > -0.02 && u < 1.02;
    if (!f.group.visible) continue;
    if (f.inView) {
      // placed in the camera's view now, and pointed the way it is going a moment later
      const A = f.spec.from, B = f.spec.to;
      // `across` is a fraction of the screen's half-width at that distance (-1 the left edge, 1 the
      // right), so a narrow phone sees the whole pass too; `right` is metres
      const halfW = (d) => d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
      const side = (P, d) => P.across !== undefined ? P.across * halfW(d) : P.right;
      const at = (t) => { const w = (t - f.t0) / (f.t1 - f.t0), fwd = A.fwd + (B.fwd - A.fwd) * w; return viewPoint(t, { fwd, right: side(A, fwd) + (side(B, fwd) - side(A, fwd)) * w, up: A.up + (B.up - A.up) * w }); };
      const p0 = at(T), p1 = at(T + 0.05);
      f.group.position.copy(p0);
      f.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), p1.sub(p0).normalize());
    } else f.group.position.lerpVectors(f.from, f.to, u);
  }
}
// The hangar the camera turns to is the one on the RIGHT of the wide shot (the last key that looks
// at the whole station before the first that looks at a hangar), so the pan goes rightward. Its
// mouth and the fighter on its deck come from the kit's measurements.
function pickHangar() {
  if (!station || !station.hangars || !station.hangars.length) return;
  const wide = KEYS.filter(k => k.set === 'station' && k.look === 'station').pop() || KEYS.find(k => k.set === 'station');
  const camAt = new THREE.Vector3(...wide.cam).add(STATION_AT), target = lookPoint('station', 'station');
  const fwd = target.clone().sub(camAt).normalize(), right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  let best = null, bestDot = -Infinity;
  for (const m of station.hangars) {
    const p = new THREE.Vector3().setFromMatrixPosition(m).add(STATION_AT), d = p.clone().sub(camAt).normalize().dot(right);
    if (d > bestDot) { bestDot = d; best = m; }
  }
  const bay = StationKit.BAYS[station.layout.hangarModel] || { deckY: 0, back: -0.4, mouth: 0.4 };
  const u = station.hangarUnit || 1;
  hangarIndex = station.hangars.indexOf(best); hangarMatrix = best;
  const along = new THREE.Vector3(1, 0, 0).transformDirection(best);
  hangarAt = new THREE.Vector3().setFromMatrixPosition(best).add(STATION_AT).addScaledVector(along, (bay.back + bay.mouth) / 2 * u).add(new THREE.Vector3(0, bay.deckY * u, 0));
  hangarMouth = { at: new THREE.Vector3().setFromMatrixPosition(best).add(STATION_AT).addScaledVector(along, bay.mouth * u).add(new THREE.Vector3(0, bay.deckY * u, 0)), dir: along };
  bayAt = station.bayLocal ? new THREE.Vector3().setFromMatrixPosition(best.clone().multiply(station.bayLocal)).add(STATION_AT) : hangarAt.clone();
}
const setOf = (k) => k.set || 'cabin';
function showSet(name) {
  if (name === currentSet) return;
  const was = currentSet; currentSet = name;
  if (name === 'town' || was === 'town') townRatio(name === 'town');
  const inCabin = name === 'cabin', inHangar = name === 'hangar', inMap = name === 'map', inTown = name === 'town';
  if (mapSet) mapSet.floor.visible = inMap;
  if (inTown && valley) valley.DAY.dirty = true;           // (its light, haze and exposure put back: the other sets set their own)
  if (!inTown && valley && valley.SHOW.sc && valley.SHOW.sc.isOpen) valley.SHOW.sc.close();
  scene.background = inTown ? SKY : new THREE.Color(0x000000);
  scene.fog = inTown ? new THREE.Fog(SKY, 600, 2600) : null;
  if (!inTown) { TOWN_INPUT.dest = null; tourStop(false); tourBar(); }
  if (!inMap) { poked = null; $('mapCaption').classList.remove('on'); }
  if (!inCabin) { $('likesCard').classList.remove('on'); $('clipCard').classList.remove('on'); }   // (the room's cards stay in the room)
  room.visible = inCabin; for (const sc of SCREENS) sc.visible = inCabin;
  if (sitter) sitter.visible = (inCabin || inHangar) && SITTER.on;
  if (helmet) helmet.visible = inHangar || (inCabin && HELMET.show);
  if (station) station.visible = name === 'station';
  if (hangarSet) hangarSet.floor.visible = inHangar;
  if (!inHangar && sitter && sitter.parent !== room && sitter.parent !== chairPivot) chairPivot.add(sitter);
  // space light: a hard sun and almost nothing else; the cabin gets its preset back
  spaceFill.intensity = inCabin ? 0 : 1.8;      // earthshine: the planet below lights the undersides blue
  if (inCabin) { spaceFill.color.setHex(0x6f8fb8); setLight(lightName); }
  if (inCabin) { sun.position.set(2.5, 2.0, -5); sun.target.position.set(0, 0, 0); spaceFill.target.position.set(0, 0, 0); }
  else {
    // aimed at the set, not the cabin: from 100 km away a light aimed at the origin arrives sideways.
    // In the hangar the sun comes in through the mouth (+x), low, and the fill lights the inside.
    const AT = inHangar ? HANGAR_AT : inMap ? MAP_AT : inTown ? TOWN_AT : STATION_AT;
    sun.position.copy(AT).add((inHangar ? new THREE.Vector3(1, 0.35, 0.25) : inMap ? new THREE.Vector3(0.4, 0.6, 1) : inTown ? new THREE.Vector3(0.5, 1, 0.3) : new THREE.Vector3(1, 0.6, 0.45)).multiplyScalar(5000)); sun.target.position.copy(AT);
    spaceFill.position.copy(AT).add((inHangar ? new THREE.Vector3(0.3, 0.9, -0.4) : new THREE.Vector3(-0.6, -0.8, -0.3)).multiplyScalar(5000)); spaceFill.target.position.copy(AT);
    sun.intensity = 3.2; sun.color.setHex(0xfff4e6); cabin.intensity = 0; screens.intensity = 0;
         ambient.intensity = inHangar ? 0.45 : inTown ? 1.6 : 0.35; ambient.color.setHex(inTown ? 0xcfe9ff : 0x8aa0b8); ambient.groundColor.setHex(inTown ? 0x5a8a48 : 0x2a3340); renderer.toneMappingExposure = inTown ? 1.15 : 1.05;
         // inside the hangar the fill is the deck lit by the sun through the mouth, a warm neutral that
         // matches the outside at the cut; outside it is the blue earthshine from below
         spaceFill.color.setHex(inHangar ? 0xc9b9a2 : 0x6f8fb8); ambient.color.setHex(inTown ? 0xcfe9ff : inHangar ? 0xa8a49a : 0x8aa0b8);
         spaceFill.intensity = inHangar ? 0.75 : inTown ? 0 : 1.8; if (inTown) { sun.intensity = 2.4; sun.color.setHex(0xfff6e4); } }
}
const holos = [];          // the greeting is on the terminal now, not floating over his head; Hologram stays for later
const SEQ = { hold: 0.9, turn: 1.3, draw: 1.8, waveLen: 1.5, standLen: 2.0, T: 0, playing: false, active: false, scrub: true, turned: 0 };
const total = () => KEYS[KEYS.length - 1].t;

function activateIntro() {
  if (!chairPivot) return;
  if (!chairInfo) chairInfo = measureChair();
  $('swivel').checked = false; CHAIR.swivel = false;
  SEQ.active = true; loadStation();
  controls.enabled = false;                       // the timeline owns the camera until a camera button is pressed
  // the holder's turn that brings the chair's own facing round to the door camera, the short way
  const cw = chairPivot.getWorldPosition(new THREE.Vector3()), door = KEYS[0].cam;
  let want = Math.atan2(door[0] - cw.x, door[2] - cw.z) - (chairInfo ? chairInfo.facing : 0);
  SEQ.turned = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(want), Math.cos(want)));
  $('seqTime').max = total().toFixed(2);
  buildKeyList();
}
function playIntro() { activateIntro(); SEQ.T = 0; SEQ.playing = true; seek(0); }
// where the camera looks when a key says 'him': his head, a touch above, so he sits low in the frame
function lookAtHim() {
  const head = sitter && sitter.getObjectByName('Head');
  const p = head ? head.getWorldPosition(new THREE.Vector3()) : chairPivot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.3, 0));
  p.y += 0.14; return p;
}
const lookPoint = (l, set) => {
  if (l === 'him') return lookAtHim();
  if (l === 'window') return new THREE.Vector3(...WINDOW);
  if (l === 'station') return STATION_AT.clone().add(new THREE.Vector3(0, 300, 0));
  if (l === 'hangar') return hangarAt ? hangarAt.clone() : STATION_AT.clone().add(new THREE.Vector3(0, 240, 740));
  if (l === 'bay') return bayAt ? bayAt.clone() : lookPoint('hangar', set);          // the fighter on the hangar's deck
  if (l && typeof l === 'object' && !Array.isArray(l) && l.at === 'ship' && set === 'hangar')     // relative to the fighter (now, or as it was at `freeze`): ahead along its way, to its right, up
    return shipAt(l.freeze).add(new THREE.Vector3(l.ahead || 0, l.up || 0, -(l.side || 0))).add(HANGAR_AT);
  if (l === 'ship') return set === 'map' ? (mapSet ? mapSet.ship.getWorldPosition(new THREE.Vector3()) : MAP_AT.clone())
                           : hangarSet ? hangarSet.ship.getWorldPosition(new THREE.Vector3()) : HANGAR_AT.clone();
  if (l === 'jet') return town ? town.lookAhead(26).add(TOWN_AT) : TOWN_AT.clone();
  if (l === 'earth' && set === 'hangar' && hangarSet && hangarSet.earthOut) return hangarSet.earthOut.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2600, 0));   // a little above the photo's middle, so the fighter climbing away stays in frame
  if (l === 'cockpit') return hangarSet ? hangarSet.ship.localToWorld(hangarSet.seat.clone().add(new THREE.Vector3(0, 0.7, 0))) : HANGAR_AT.clone();
  const p = new THREE.Vector3(...l); return set === 'station' ? p.add(STATION_AT) : set === 'hangar' ? p.add(HANGAR_AT) : set === 'map' ? p.add(MAP_AT) : set === 'town' ? p.add(TOWN_AT) : p;
};
const chairDeg = (c) => c === 'turned' ? SEQ.turned : (c || 0);
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * u * (u * (u * 6 - 15) + 10); };   // brisk both ends

// The camera between keys: a cubic through the key positions, with tangents from the neighbours
// (a Catmull-Rom in time), so it never stops and never kinks. Everything else eases key to key.
function activeKey(T) { let k = 0; while (k < KEYS.length - 1 && KEYS[k + 1].t <= T) k++; return KEYS[k]; }
function keysAround(T) {
  const set = setOf(activeKey(T)), ks = KEYS.filter(x => setOf(x) === set);
  let k = 0; while (k < ks.length - 2 && ks[k + 1].t <= T) k++;
  const a = ks[k], b = ks[k + 1] || ks[k];
  return { a, b, u: b === a ? 0 : Math.min(1, Math.max(0, (T - a.t) / Math.max(1e-6, b.t - a.t))), k, ks, set };
}
// A key's camera is a point, or a place relative to the hangar the intro turns to: `{ at: 'mouth',
// out, up, side }` in metres out from the mouth along its opening, up, and to its right - so the
// hangar keys follow the station's layout instead of being re-typed after every change to it.
function camOf(key) {
  const c = key.cam;
  if (Array.isArray(c)) return new THREE.Vector3(...c);
  if (setOf(key) === 'town' && c.at === 'follow') {   // behind the fighter over the town, along its way
    if (!town) return new THREE.Vector3();
    return town.state.pos.clone().addScaledVector(town.forward(), -(c.back || 0)).add(new THREE.Vector3(0, c.up || 0, 0));
  }
  if (setOf(key) === 'map' && c.at === 'chase') {   // behind the fighter over the map, along the way it is going
    if (!mapSet) return new THREE.Vector3();
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(mapSet.ship.quaternion), right = dir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    return mapSet.ship.position.clone().addScaledVector(dir, -(c.back || 0)).add(new THREE.Vector3(0, 0, c.up || 0)).addScaledVector(right, c.side || 0);
  }
  if (setOf(key) === 'hangar') {          // relative to the human-scale hangar's mouth, or chasing the fighter, in the set's own metres
    if (c.at === 'chase') return shipAt(c.freeze).add(new THREE.Vector3(-(c.back || 0), c.up || 0, -(c.side || 0)));
    const mouth = hangarSet ? hangarSet.mouth.clone() : new THREE.Vector3(), hu = hangarSet ? hangarSet.hu : 1;
    return mouth.add(new THREE.Vector3((c.out || 0) + (c.outU || 0) * hu, (c.up || 0) + (c.upU || 0) * hu, -((c.side || 0) + (c.sideU || 0) * hu)));
  }
  const base = c.at === 'bay' && bayAt ? bayAt.clone() : hangarMouth ? hangarMouth.at.clone() : STATION_AT.clone();
  const dir = hangarMouth ? hangarMouth.dir : new THREE.Vector3(1, 0, 0), right = dir.clone().cross(new THREE.Vector3(0, 1, 0)), hu = station ? station.hangarUnit || 1 : 1;
  return base.sub(STATION_AT).addScaledVector(dir, (c.out || 0) + (c.outU || 0) * hu).add(new THREE.Vector3(0, (c.up || 0) + (c.upU || 0) * hu, 0)).addScaledVector(right, (c.side || 0) + (c.sideU || 0) * hu);
}
// the fighter's spot in the hangar set, now or as it was at `freeze` seconds
function shipAt(freeze) {
  if (!hangarSet) return new THREE.Vector3();
  if (freeze === undefined) return hangarSet.ship.position.clone();
  return hangarShipPos(freeze);
}
// OUT OF THE HANGAR: it accelerates out of the mouth, then climbs and veers left (the top left of
// the frame, where the map's fighter picks up), still in front of the camera the whole way
const OUT = { climb: 0.22, veer: 0.32 };      // metres up and to the left per metre past the mouth
function hangarShipPos(T) {
  const r = Math.max(0, T - HANGAR.roll), x = 0.5 * HANGAR.accel * r * r, e = Math.max(0, x - (hangarSet ? hangarSet.mouth.x : 0));
  return new THREE.Vector3(x, OUT.climb * e * e / (e + 20), -OUT.veer * e * e / (e + 20));   // (eased in: level in the bay)
}
// The hangar's Earth is the map's photograph, 14 times as big: carrying the hangar's last camera
// and the fighter through that ratio puts the map scene's first frame exactly where the hangar's
// last one was, so the change of scene cannot be seen.
function syncMapToHangar() {
  if (!hangarSet || !hangarSet.earthOut || !mapSet) return;
  const cut = KEYS.find(k => setOf(k) === 'map'), last = [...KEYS].reverse().find(k => setOf(k) === 'hangar');
  scene.updateMatrixWorld(true);
  const X = mapSet.pic.matrixWorld.clone().multiply(hangarSet.earthOut.matrixWorld.clone().invert());
  const T = last.t, { a, b, u } = keysAround(T - 1e-4);
  const cam = cameraAt(T - 1e-4).add(HANGAR_AT), look = lookPoint(a.look, 'hangar').lerp(lookPoint(b.look, 'hangar'), u);
  cut.cam = cam.applyMatrix4(X).sub(MAP_AT).toArray().map(v => +v.toFixed(3));
  cut.look = look.applyMatrix4(X).sub(MAP_AT).toArray().map(v => +v.toFixed(3));
  const shipW = hangarSet.floor.localToWorld(hangarShipPos(T)), aheadW = hangarSet.floor.localToWorld(hangarShipPos(T + 0.1));
  MAP_HANDOFF.pos = mapSet.floor.worldToLocal(shipW.applyMatrix4(X)); MAP_HANDOFF.dir = mapSet.floor.worldToLocal(aheadW.applyMatrix4(X)).sub(MAP_HANDOFF.pos).normalize();
  MAP_HANDOFF.scale = (6 / 14) / 26;                                  // the hangar's 6 m fighter at the photo's scale, against the map's 26
  MAP_HANDOFF.off = mapCamFrame(cut.t + 1e-4).toLocal(mapSet.floor.localToWorld(MAP_HANDOFF.pos.clone()));   // where it sits in the camera's view
}
const MAP_HANDOFF = { pos: null, dir: null, scale: 1, len: 4.0, off: null };
// the map camera's frame at T (world position, and its right / up / forward), from the keys
function mapCamFrame(T) {
  const { a, b, u } = keysAround(T), p = cameraAt(T).add(MAP_AT), t = lookPoint(a.look, 'map').lerp(lookPoint(b.look, 'map'), u);
  const f = t.sub(p).normalize(), r = f.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), up = r.clone().cross(f);
  return { p, r, up, f, toLocal: (w) => { const d = w.clone().sub(p); return new THREE.Vector3(d.dot(r), d.dot(up), d.dot(f)); }, toWorld: (o) => p.clone().addScaledVector(r, o.x).addScaledVector(up, o.y).addScaledVector(f, o.z) };
}   // len: seconds to reach the map's own path and size
function hangarShipYaw(T) { const a = hangarShipPos(T), b = hangarShipPos(T + 0.05); return Math.atan2(-(b.z - a.z), b.x - a.x); }
function cameraAt(T) {
  const { a, b, u, k, ks } = keysAround(T);
  const P = (i) => camOf(ks[Math.min(ks.length - 1, Math.max(0, i))]);
  const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
  const d = Math.max(1e-6, b.t - a.t);
  const m1 = p2.clone().sub(p0).multiplyScalar(d / Math.max(1e-6, ks[Math.min(ks.length - 1, k + 1)].t - ks[Math.max(0, k - 1)].t));
  const m2 = p3.clone().sub(p1).multiplyScalar(d / Math.max(1e-6, ks[Math.min(ks.length - 1, k + 2)].t - ks[k].t));
  const u2 = u * u, u3 = u2 * u;
  return p1.clone().multiplyScalar(2 * u3 - 3 * u2 + 1).add(m1.multiplyScalar(u3 - 2 * u2 + u)).add(p2.clone().multiplyScalar(-2 * u3 + 3 * u2)).add(m2.multiplyScalar(u3 - u2));
}
// the chair turns from one key's angle to the next the SHORT way round (never more than a half
// turn): -112 to 119 is a 129-degree turn clockwise seen from above, not 231 the other way. A
// turn the long way wants a key in between.
function chairBetween(from, to, u) {
  const a = chairDeg(from), b = chairDeg(to);
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return a + d * u;
}
function seek(T) {
  SEQ.T = T = Math.min(total(), Math.max(0, T));
  const { a, b, u, set } = keysAround(T);
  showSet(set);
  if (set === 'hangar') { stepHangar(T, a, b, u); return; }
  if (set === 'map') { stepMap(T, a, b, u); return; }
  if (set === 'town') { stepTown(T, a, b, u); return; }
  if (set === 'station') {
    // outside: the rings turn with time, 1 g at the rim, and the camera runs in the station's frame
    if (station) for (const sp of station.spinners) sp.turntable.rotation.y = sp.sign * (Math.PI * 2 / StationKit.period(sp.radius)) * T;
    stepTraffic(T);
    camera.position.copy(cameraAt(T)).add(STATION_AT);
    controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u)); camera.lookAt(controls.target);
    post.focus = camera.position.distanceTo(controls.target);
    for (const h of holos) h.fill = 0;
    const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
    $('seqTimeOut').textContent = T.toFixed(1) + ' s';
    return;
  }
  // the chair turns key to key, briskly
  chairPivot.rotation.y = THREE.MathUtils.degToRad(chairBetween(a.chair, b.chair, ease(u)));
  // him: sitting until he stands, then up on his feet, then walking off out of the frame
  const standing = T >= ACTS.stand, walking = T >= ACTS.walk;
  if (sitterMixer && sitAction) {
    if (standing) {
      // he is on his own feet now, where the chair left him
      if (sitter.parent !== room) room.add(sitter);
      const at = ACTS.stand, { a: ka, b: kb, u: ku } = keysAround(at);
      const chairThen = THREE.MathUtils.degToRad(chairBetween(ka.chair, kb.chair, ease(ku)));
      const saved = chairPivot.rotation.y; chairPivot.rotation.y = chairThen; chairPivot.updateMatrixWorld(true);
      const feet = chairPivot.localToWorld(sitter.userData.seatPos.clone()), yaw = sitter.userData.seatYaw + chairThen;
      chairPivot.rotation.y = saved;
      let dirYaw = THREE.MathUtils.degToRad(ACTS.walkDir);
      const w = walking ? Math.min(1, (T - ACTS.walk) / 0.5) : 0;                     // turns to go over the first half second
      const y = yaw + (Math.atan2(Math.sin(dirYaw - yaw), Math.cos(dirYaw - yaw))) * w;
      sitter.position.copy(feet);
      if (walking) sitter.position.add(new THREE.Vector3(Math.sin(dirYaw), 0, Math.cos(dirYaw)).multiplyScalar(ACTS.walkSpeed * Math.max(0, T - ACTS.walk - 0.25)));
      sitter.rotation.set(0, y, 0);
    } else if (sitter.parent !== chairPivot) { chairPivot.add(sitter); placeSitter(); }
    sitAction.setEffectiveWeight(standing ? 0 : 1); sitAction.time = sitTime(T);
    // the stand-up plays fast enough to finish before the walk (it is 2.3 s long, the gap may be
    // shorter), then fades into the walk over a third of a second instead of cutting mid-rise
    const standRate = Math.max(1, SEQ.standLen / Math.max(0.6, ACTS.walk - ACTS.stand)), walkIn = walking ? THREE.MathUtils.smoothstep(T, ACTS.walk, ACTS.walk + 0.35) : 0;
    if (standAction) { standAction.setEffectiveWeight(standing ? 1 - walkIn : 0); standAction.time = Math.min(SEQ.standLen, Math.max(0, T - ACTS.stand) * standRate); }
    if (walkAction) { walkAction.setEffectiveWeight(walkIn); walkAction.time = Math.max(0, T - ACTS.walk) % walkAction.getClip().duration; }
    for (const x of [ladderAction, sitDownAction, climbAction]) if (x) x.setEffectiveWeight(0);   // those are for boarding the fighter
    if (waveParts) {
      const w = T - ACTS.wave, on = w >= 0 && !standing ? 1 : 0;
      for (const [part, act] of Object.entries(waveParts)) { act.setEffectiveWeight(part === 'arm' ? 0 : on * WAVE[part]); act.time = Math.min(SEQ.waveLen, Math.max(0, w)); }   // the arm is waved in code (handWave)
    }
    const headBone = sitter.getObjectByName('Head'); if (headBone && headBone.userData.restQ) headBone.quaternion.copy(headBone.userData.restQ);
    sitterMixer.update(0);
    if (!standing) handWave(T);
    const model = sitter.children[0], rest = sitter.userData.hipRest, hipBone = model.getObjectByName('Hip');
    if (walking && rest && hipBone) {
      // the walk's own travel is cancelled (he moves by the timeline), and its hips are held where
      // the stand-up left them, so the hand-over from one clip to the other does not jump
      const from = standEndHip(model, hipBone) || rest;
      model.updateMatrixWorld(true);
      const now = model.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3()));
      model.position.set(from.x - now.x, 0, from.z - now.z);
      // (then the pose is already the right one this frame: standEndHip re-evaluated the mixer)
    } else model.position.set(0, 0, 0);
  }
  // the camera
  camera.position.copy(cameraAt(T));
  controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u)); camera.lookAt(controls.target);
  post.focus = camera.position.distanceTo(controls.target);
  // he keeps his eyes on the camera: the head turns toward it after the clips have posed it, by
  // as much as the keys ask for, and never further than a neck goes
  const face = (a.face || 0) + ((b.face || 0) - (a.face || 0)) * u;
  if (face > 0 && sitter) faceCamera(face);
  // the parts of the greeting: over his head, turned to the camera, each one forming then dissolving
  const over = lookAtHim(); over.y += 0.14;
  const toCam = new THREE.Vector3().subVectors(camera.position, over); toCam.y = 0; toCam.normalize();
  holos.forEach((h, n) => {
    const part = PARTS[n];
    h.fill = Math.min(1, Math.max(0, (T - part.start) / SEQ.draw, 0), Math.max(0, (part.end - T) / 0.7));
    h.position.copy(over).addScaledVector(toCam, 0.15);
    h.rotation.y = Math.atan2(toCam.x, toCam.z);
  });
  const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
  $('seqTimeOut').textContent = T.toFixed(1) + ' s';
  if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key === undefined) showKey();
}
// The hangar beat: he walks in from the side to the cockpit, then is in the seat, the canopy
// closes over him, and the fighter rolls out through the mouth. Everything from T, so it scrubs.
function stepHangar(T, a, b, u, set = 'hangar') {
  const HS = hangarSet; if (!HS) return;
  let board = null;
  if (!HS.ladder) HS.ladder = buildLadder(HS);
  const seated = T >= HANGAR.sit;
  HS.setCanopy((T - HANGAR.canopy) / HANGAR.canopyLen, HANGAR.canopyDeg, HANGAR.canopyDrop, HANGAR.canopySlide);
  const roll = Math.max(0, T - HANGAR.roll);
  HS.ship.position.copy(hangarShipPos(T)); HS.ship.rotation.y = hangarShipYaw(T);
  // the burner lights as he rolls: a flicker first, full burn as it clears the mouth
  if (HS.burner) { HS.burner.setThrust(roll <= 0 ? 0 : THREE.MathUtils.clamp(0.2 + roll * 0.35, 0, 1)); if (roll <= 0) HS.burner.thrust = 0; HS.burner.update(1 / 60); }   // cold (not easing down) until the roll-out, however the timeline got here
  if (twin) for (const sp of twin.spinners) sp.turntable.rotation.y = sp.sign * (Math.PI * 2 / StationKit.period(sp.radius)) * T;   // the station outside keeps turning
  // banking to the mouse once he is out of the mouth; level while he is still in the bay
  if (HS.ship.position.x > HS.mouth.x) FLY.roll += (FLY.target - FLY.roll) * FLY.follow; else FLY.roll = 0;
  HS.ship.rotation.x = THREE.MathUtils.degToRad(FLY.roll);
  if (sitter && sitterMixer) {
    if (seated) {
      if (sitter.parent !== HS.ship) HS.ship.add(sitter);
      sitter.position.copy(HS.seat).add(new THREE.Vector3(0, -SEAT.up - HANGAR.seatDown, 0)).addScaledVector(new THREE.Vector3(1, 0, 0), SEAT.back - HANGAR.seatBack);
      sitter.rotation.set(0, Math.PI / 2, 0);                                 // facing the nose, +x
      sitter.rotateX(-THREE.MathUtils.degToRad(HANGAR.recline));             // leaning back into the seat
    } else {
      if (sitter.parent !== HS.floor) HS.floor.add(sitter);
      board = boardingPose(T);
      sitter.position.copy(board.pos);
      sitter.rotation.set(0, board.yaw, 0); sitter.rotateX(-board.recline);   // upright (scrubbed back out of the seat, the recline must not stay)
    }
    const walking = !seated && board && board.clip === 'walk';
    const clipW = (name) => (!seated && board && board.clip === name) ? 1 : 0;
    if (sitAction) { sitAction.setEffectiveWeight(seated ? 1 : 0); sitAction.time = sitTime(T); }
    if (standAction) { standAction.setEffectiveWeight(clipW('stand')); standAction.time = SEQ.standLen; }   // the end of standing up: upright, still
    if (walkAction) { walkAction.setEffectiveWeight(clipW('walk')); walkAction.time = Math.max(0, T - HANGAR.walk) % walkAction.getClip().duration; }
    if (climbAction) { climbAction.setEffectiveWeight(clipW('climb')); climbAction.time = board ? board.k * climbAction.getClip().duration : 0; }
    if (ladderAction) { ladderAction.setEffectiveWeight(clipW('ladder')); ladderAction.time = Math.max(0, T - HANGAR.climb) % ladderAction.getClip().duration; }
    if (HS.ladder) { const up = 1 - THREE.MathUtils.smoothstep(T, HANGAR.canopy, HANGAR.canopy + 0.6); HS.ladder.visible = up > 0.01; HS.ladder.scale.y = Math.max(0.01, up); }   // it folds away as the canopy comes down
    if (sitDownAction) { sitDownAction.setEffectiveWeight(clipW('sitDown')); sitDownAction.time = board ? board.k * sitDownAction.getClip().duration : 0; }
    if (waveParts) for (const act of Object.values(waveParts)) act.setEffectiveWeight(0);
    const headBone = sitter.getObjectByName('Head'); if (headBone && headBone.userData.restQ) headBone.quaternion.copy(headBone.userData.restQ);
    sitterMixer.update(0);
    const model = sitter.children[0], rest = sitter.userData.hipRest, hipBone = model.getObjectByName('Hip');
    if (board && ['walk', 'stand', 'climb', 'ladder'].includes(board.clip) && rest && hipBone) {
      model.updateMatrixWorld(true);
      const now = model.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3()));
      // the ladder and climb clips carry their own rise (0.26 a rung loop, 0.6 over the ledge) and set the
      // hips off to one side: all of it is cancelled there, and the timeline alone moves him
      model.position.set(rest.x - now.x, board.clip === 'walk' || board.clip === 'stand' ? 0 : rest.y - now.y, rest.z - now.z);   // (the stand-up's last frame has the hips well forward, too)
    } else model.position.set(0, 0, 0);
  }
  camera.position.copy(cameraAt(T)).add(HANGAR_AT);
  controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u)); camera.lookAt(controls.target);
  post.focus = camera.position.distanceTo(controls.target);
  for (const h of holos) h.fill = 0;
  const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
  $('seqTimeOut').textContent = T.toFixed(1) + ' s';
}
// THE WAVE, in code: the Mixamo wave starts with its arm already up and only wags the forearm, so
// over the sitting pose there was almost nothing to see. His right arm comes up and out, the
// forearm points up and the hand swings side to side, quickly - up in a quarter of a second, a
// couple of waves, down again. Bones are aimed by direction in the room, so the skeleton's own
// axes do not matter; WAVE.arm scales how high the arm goes.
const HAND_WAVE = { len: 1.4, up: 0.25, down: 0.3, rate: 2.3 };   // seconds; waves a second
const _wv = { a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), bq: new THREE.Quaternion(), I: new THREE.Quaternion() };
function aimBone(bone, child, dir, amount) {
  bone.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(_wv.b).sub(bone.getWorldPosition(_wv.a)).normalize();
  const turn = _wv.q.setFromUnitVectors(from, dir); _wv.I.identity().slerp(turn, amount);
  const pq = bone.parent.getWorldQuaternion(_wv.pq), bq = bone.getWorldQuaternion(_wv.bq);
  bone.quaternion.copy(pq.clone().invert().multiply(_wv.I.clone().multiply(bq)));
}
function handWave(T) {
  const w = T - ACTS.wave, H = HAND_WAVE;
  if (w < 0 || w > H.len || !sitter) return;
  const e = THREE.MathUtils.smoothstep(w, 0, H.up) * (1 - THREE.MathUtils.smoothstep(w, H.len - H.down, H.len)) * Math.min(1, WAVE.arm);
  if (e <= 0) return;
  const up = sitter.getObjectByName('R_Upperarm'), fore = sitter.getObjectByName('R_Forearm'), hand = sitter.getObjectByName('R_Hand'), spine = sitter.getObjectByName('Spine02');
  if (!up || !fore || !hand || !spine) return;
  sitter.updateWorldMatrix(true, true);
  // his right, his forward and the room's up, from where his shoulder is
  const side = up.getWorldPosition(new THREE.Vector3()).sub(spine.getWorldPosition(new THREE.Vector3())); side.y = 0; side.normalize();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(sitter.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
  const upW = new THREE.Vector3(0, 1, 0);
  // the upper arm out to the side and a little up and forward; the forearm up, swinging across
  aimBone(up, fore, side.clone().multiplyScalar(0.85).addScaledVector(upW, 0.35 + 0.25 * WAVE.arm).addScaledVector(fwd, 0.25).normalize(), e);
  const swing = Math.sin(w * Math.PI * 2 * H.rate) * 0.5 * Math.min(1, w / H.up);
  aimBone(fore, hand, upW.clone().addScaledVector(side, swing).addScaledVector(fwd, 0.2).normalize(), e);
}
// where the stand-up leaves his hips (in his model's frame), found once by posing the clip's last
// frame on its own, then the mixer is put back as it was
function standEndHip(model, hipBone) {
  if (sitter.userData.standEnd) return sitter.userData.standEnd;
  if (!standAction) return null;
  const acts = sitterMixer._actions, saved = acts.map(x => [x, x.getEffectiveWeight(), x.time]);
  for (const x of acts) x.setEffectiveWeight(0);
  standAction.setEffectiveWeight(1); standAction.time = SEQ.standLen; sitterMixer.update(0);
  model.updateMatrixWorld(true);
  sitter.userData.standEnd = model.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3()));
  for (const [x, w, t] of saved) { x.setEffectiveWeight(w); x.time = t; }
  sitterMixer.update(0);
  return sitter.userData.standEnd;
}
function reseatWave() { if (SEQ.active) seek(SEQ.T); }   // show a wave change at once
// where he is and what he is doing at time T before he is seated: the walk to the ladder, the
// climb, the step across the wing and the lowering into the seat. Positions in the set's metres.
function boardingPose(T) {
  const H = HANGAR, B = BOARD, from = new THREE.Vector3(...H.from), foot = new THREE.Vector3(...H.to);
  const seatAt = hangarSet.seat.clone().add(new THREE.Vector3(0, -SEAT.up - H.seatDown, 0)).addScaledVector(new THREE.Vector3(1, 0, 0), SEAT.back - H.seatBack);
  const rim = new THREE.Vector3(B.rimX, B.rimY, B.rimZ);
  const walkYaw = Math.atan2(foot.x - from.x, foot.z - from.z), faceHull = 0, faceNose = Math.PI / 2;
  const tSit = H.climb + B.climbLen, sm = THREE.MathUtils.smoothstep;
  if (T < H.climb) {
    const dist = from.distanceTo(foot), gone = Math.min(dist, H.speed * Math.max(0, T - H.walk - 0.2)), there = gone >= dist - 0.01;
    const turn = there ? sm(T, H.climb - 0.4, H.climb) : 0;    // at the cockpit he turns to face the hull
    return { pos: from.clone().addScaledVector(foot.clone().sub(from).normalize(), gone), yaw: walkYaw + Math.atan2(Math.sin(faceHull - walkYaw), Math.cos(faceHull - walkYaw)) * turn, recline: 0, clip: T > H.walk + 0.2 && !there ? 'walk' : 'stand' };
  }
  // up the ladder under the sill (the ladder loop), then over the rim (the end of the climb clip)
  if (T < tSit) {
    // on the room side of the ladder, which leans from its foot (about ladderZ - 0.08) to the sill:
    // his body keeps 0.3 m behind the rungs as he goes up
    const k = (T - H.climb) / B.climbLen, onLadder = k < 0.65;
    const bottom = new THREE.Vector3(foot.x, 0, B.ladderZ - 0.4), ladderTop = new THREE.Vector3(foot.x, B.rimY - 0.6, B.ladderZ - 0.22);
    const pos = onLadder ? (k < 0.08 ? foot.clone().lerp(bottom, k / 0.08) : bottom.clone().lerp(ladderTop, (k - 0.08) / 0.57)) : ladderTop.clone().lerp(rim, sm((k - 0.65) / 0.35, 0, 1));
    return { pos, yaw: faceHull + (onLadder ? Math.PI : 0), recline: 0, clip: onLadder ? 'ladder' : 'climb', k: onLadder ? k : 0.7 + 0.3 * (k - 0.65) / 0.35 };   // the Mixamo ladder clip faces the other way from the rest
  }
  const k = sm(T, tSit, H.sit);
  return { pos: rim.clone().lerp(seatAt, k), yaw: faceHull + (faceNose - faceHull) * sm(T, tSit, tSit + B.sitIn * 0.6), recline: THREE.MathUtils.degToRad(H.recline) * k, clip: 'sitDown', k: Math.min(1, (T - tSit) / B.sitIn) };
}
// the boarding ladder: hooked on the cockpit sill, its foot on the deck a little out from the hull,
// folding away as the canopy closes (it scales down from its top, which is where it hangs)
function buildLadder(HS) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: 0.7, roughness: 0.45 });
  const top = BOARD.rimY + 0.02, lean = Math.atan2(0.18, top), inner = new THREE.Group();
  for (const dx of [-0.2, 0.2]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.035, top, 0.035), m); r.position.set(dx, -top / 2, 0); inner.add(r); }
  for (let y = 0.25; y < top - 0.1; y += 0.25) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.025, 0.045), m); r.position.set(0, -y, 0); inner.add(r); }
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.12), m); hook.position.set(0, 0, 0.05); inner.add(hook);
  inner.rotation.x = -lean;                                       // foot out from the hull (-z), top against the sill
  g.add(inner); g.position.set(HANGAR.to[0], top, BOARD.ladderZ + 0.1);
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  HS.floor.add(g); return g;
}
function reseat() { if (SEQ.active && currentSet === 'hangar') seek(SEQ.T); }
// The helmet hangs on his head bone, sized to his head and turned the way he faces, so it goes
// where the head goes. Its place is the middle of the head's skin: the vertices the head bone owns,
// taken in the bone's own bind-pose frame, so the fit does not depend on how he is posed now.
function wearHelmet() {
  if (!helmet || !sitter) return;
  const head = sitter.getObjectByName('Head'); if (!head) return;
  sitter.updateMatrixWorld(true);
  const box = new THREE.Box3(), v = new THREE.Vector3();
  let bindWorld = null;
  sitter.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const hi = o.skeleton.bones.indexOf(head); if (hi < 0) return;
    const toBone = o.skeleton.boneInverses[hi].clone().multiply(o.bindMatrix);      // mesh vertex -> the head bone's frame
    if (!bindWorld) bindWorld = o.matrixWorld.clone().multiply(o.bindMatrixInverse).multiply(o.skeleton.boneInverses[hi].clone().invert());   // the bone's bind pose in the world
    const idx = o.geometry.attributes.skinIndex, w = o.geometry.attributes.skinWeight, pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let own = 0; for (let j = 0; j < 4; j++) if (idx.getComponent(i, j) === hi) own += w.getComponent(i, j);
      if (own > 0.6) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(toBone));
    }
  });
  if (box.isEmpty() || !bindWorld) return;
  const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());   // in the bone's frame
  const hbox = new THREE.Box3().setFromObject(helmet), hsize = hbox.getSize(new THREE.Vector3()), hcentre = hbox.getCenter(new THREE.Vector3());
  // the head's width across is whichever of the bone frame's axes is not the bone's own length
  const bindQ = new THREE.Quaternion().setFromRotationMatrix(bindWorld);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bindQ.clone().invert());                     // the world's up in the bone's frame
  const across = Math.abs(up.x) > 0.7 ? Math.min(size.y, size.z) : Math.abs(up.y) > 0.7 ? Math.min(size.x, size.z) : Math.min(size.x, size.y);
  const k = (across * 1.3) / hsize.x;                                        // a helmet a third wider than the head
  head.add(helmet);
  helmet.scale.setScalar(k);
  // turned to face the way he faces, in the bone's frame
  helmet.quaternion.copy(bindQ.clone().invert().multiply(sitter.getWorldQuaternion(new THREE.Quaternion())));
  // placed from the crown down: the helmet's top a little above the top of the head (the neck's
  // vertices belong to the head bone too and pull the middle low, so the middle is no guide)
  let top = -Infinity;
  for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) top = Math.max(top, up.dot(new THREE.Vector3(cx, cy, cz)));
  const want = centre.clone().addScaledVector(up, (top - up.dot(centre)) + across * 0.1 - hsize.y * k * 0.5);
  helmet.position.copy(want).sub(hcentre.clone().multiplyScalar(k).applyQuaternion(helmet.quaternion));
  // the measured fit is the base; the HELMET nudges are laid on top of it (applyHelmetFit)
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(helmet.quaternion), right = up.clone().cross(fwd).normalize();
  helmet.userData.base = { position: helmet.position.clone(), quaternion: helmet.quaternion.clone(), scale: k, up: up.clone(), fwd, right, headWidth: across };
  applyHelmetFit();
}
// HELMET FIT. Nudges on top of the measured fit: size (%), up/down and forward/back (cm, in his
// frame), and tilt (degrees, positive nods the visor down). Set in the panel, baked from Copy settings.
const HELMET = { show: false, size: 100, up: 0, forward: 0, tilt: 0, turn: 45, roll: 0 };   // turn: about the vertical, counter-clockwise seen from above; roll: about his facing, clockwise seen from the front
function applyHelmetFit() {
  if (!helmet || !helmet.userData.base) return;
  const B = helmet.userData.base, k = B.scale * HELMET.size / 100;
  const headScale = sitter ? sitter.getWorldScale(new THREE.Vector3()).x : 1;     // cm in the world -> the bone's frame
  helmet.scale.setScalar(k);
  helmet.quaternion.copy(B.quaternion)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(B.right, -THREE.MathUtils.degToRad(HELMET.tilt)))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(B.up, THREE.MathUtils.degToRad(HELMET.turn)))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(B.fwd, -THREE.MathUtils.degToRad(HELMET.roll)));
  helmet.position.copy(B.position).addScaledVector(B.up, HELMET.up / 100 / headScale).addScaledVector(B.fwd, HELMET.forward / 100 / headScale);
  helmet.visible = currentSet === 'hangar' || (currentSet === 'cabin' && HELMET.show);
}
function faceCamera(amount) {
  const head = sitter.getObjectByName('Head'); if (!head) return;
  head.updateWorldMatrix(true, false);
  const hp = head.getWorldPosition(new THREE.Vector3());
  // his body's forward in the world, and the way to the camera; the head turns from one toward the other
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(sitter.getWorldQuaternion(new THREE.Quaternion()));
  const to = camera.position.clone().sub(hp).normalize();
  const yaw = Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);      // signed, about +y
  const pitch = Math.asin(Math.max(-1, Math.min(1, to.y))) - Math.asin(Math.max(-1, Math.min(1, fwd.y)));
  // yaw about the world's up, then the nod about the axis across the new line of sight, so the
  // nod stays a nod whichever way the chair has him facing
  const across = new THREE.Vector3(to.z, 0, -to.x).normalize();
  const turn = new THREE.Quaternion().setFromAxisAngle(across, -THREE.MathUtils.clamp(pitch, -0.35, 0.35) * amount)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.clamp(yaw, -1.0, 1.0) * amount));
  const parentQ = head.parent.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = head.getWorldQuaternion(new THREE.Quaternion());
  head.quaternion.copy(parentQ.clone().invert().multiply(turn.multiply(worldQ)));
}
function stepSequence(dt) {
  if (SEQ.active) {
    // left alone for a few seconds after a scrub, it plays on (not while a panel control has the
    // focus - someone editing a key wants the frame to hold - nor while a card from the room is open:
    // the click that opened it also let go of the pointer, which clears the hold)
    const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#panel');
    if (!SEQ.playing && !RESUME.held && !RESUME.hold && !editing && !BOOT.on && !pull && SEQ.T < total() && performance.now() - RESUME.last > RESUME.after * 1000 && !cardOpen()) SEQ.playing = true;   // (not during the boot: it played under the pull-back and the camera snapped back to the monitor)
    if (SEQ.playing) { seek(SEQ.T + dt); if (SEQ.T >= total()) SEQ.playing = false; }
    else if (currentSet === 'town' && SEQ.T >= total() - 1e-6) { tourStep(dt); liveTown(dt); }   // the timeline is done: the flight is live (and the tour)
    else if (SEQ.T >= HANGAR.roll && Math.abs(FLY.roll - FLY.target) > 0.05) seek(SEQ.T);     // paused in flight, the fighter still banks to the pointer
  } else {
    if (chairPivot && CHAIR.swivel) chairPivot.rotation.y += THREE.MathUtils.degToRad(CHAIR.speed) * dt;
    if (sitterMixer) sitterMixer.update(dt);
  }
  for (const h of holos) h.update(dt);
  for (const sc of SCREENS) sc.update(dt);
}
// the wheel scrubs time instead of zooming, when that is switched on; a first scroll starts the intro
renderer.domElement.addEventListener('wheel', (e) => {
  if (!SEQ.scrub || !chairPivot) return;
  e.preventDefault();
  if (!SEQ.active) activateIntro();
  SEQ.playing = false; scrubbed();
  seek(SEQ.T + e.deltaY * 0.0025);
}, { passive: false });
renderer.domElement.addEventListener('pointerdown', () => { RESUME.held = true; scrubbed(); });
addEventListener('pointerup', () => { RESUME.held = false; scrubbed(); });
addEventListener('pointercancel', () => { RESUME.held = false; scrubbed(); });
// the mouse across the screen banks the fighter while he is flying (nothing else listens to it then)
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  FLY.target = -((e.clientX / innerWidth) * 2 - 1) * FLY.maxRoll;
});
// on a phone there is no wheel: one finger dragged up or down scrubs time the same way, and a
// first swipe starts the intro. While the timeline owns the camera the orbit is idle anyway, so
// the drag is not fighting it.
// sideways drag, while he is flying, banks the fighter instead: the drag's first few pixels decide
// which it is, so a swipe never does both.
// A SCRUB IS DELIBERATE: a mostly vertical swipe of about 180 px inside half a second. Anything
// gentler is not the timeline's: in the town it steers the fighter (and must never send it back
// to where it came in), while he flies a sideways drag banks him.
let touchScrubbing = false;
const TOWN_SCRUBBING = () => touchScrubbing;
{
  let lastY = null, id = null, startX = 0, startY = 0, startT = 0, mode = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary) { lastY = e.clientY; startX = e.clientX; startY = e.clientY; startT = performance.now(); id = e.pointerId; mode = null; } });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id || lastY === null || !SEQ.scrub || !chairPivot) return;
    if (!mode) {
      const dx = e.clientX - startX, dyy = e.clientY - startY, quick = performance.now() - startT < 500;
      const flying = SEQ.active && SEQ.T >= HANGAR.roll && !liveInTown();
      if (quick && Math.abs(dyy) > 180 && Math.abs(dyy) > 2 * Math.abs(dx)) { mode = 'scrub'; touchScrubbing = true; lastY = e.clientY; return; }
      if (flying && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dyy)) mode = 'bank';
      else if (!quick) mode = 'none';                        // too slow for a scrub: it is someone steering or looking
      if (!mode) return;
    }
    if (mode === 'none') return;
    if (mode === 'bank') { FLY.target = THREE.MathUtils.clamp(-((e.clientX - startX) / (innerWidth / 2)) * FLY.maxRoll, -FLY.maxRoll, FLY.maxRoll); return; }
    const dy = lastY - e.clientY; lastY = e.clientY;
    if (!SEQ.active) activateIntro();
    SEQ.playing = false; scrubbed();
    seek(SEQ.T + dy * 0.012);
  });
  const end = (e) => { if (e.pointerId === id) { lastY = null; id = null; if (mode === 'bank') FLY.target = 0; mode = null; touchScrubbing = false; } };
  renderer.domElement.addEventListener('pointerup', end); renderer.domElement.addEventListener('pointercancel', end);
}

// ── editing the keys ────────────────────────────────────────────────────────────
// Pick a key, and its sliders show; move one and the scene jumps to that key so the change is seen.
let keyIndex = 2;
const KEYFIELDS = { keyT: ['t'], camX: ['cam', 0], camY: ['cam', 1], camZ: ['cam', 2], keyChair: ['chair'], keyFace: ['face'] };
function buildKeyList() {
  const list = $('keys'); if (!list) return;
  list.innerHTML = '';
  KEYS.forEach((k, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = ({ station: 'out ', hangar: 'in ', map: 'map ', town: 'town ' }[setOf(k)] || '') + k.t.toFixed(1) + ' s';
    b.classList.toggle('on', i === keyIndex); b.onclick = () => { keyIndex = i; buildKeyList(); showKey(); SEQ.playing = false; RESUME.hold = true; seek(KEYS[i].t); };   // picking a key holds the frame there
    list.appendChild(b);
  });
}
function showKey() {
  const k = KEYS[keyIndex]; if (!k) return;
  const set = (id, v) => { const el = $(id); if (!el) return; el.value = v; $(id + 'Out').textContent = SLIDERS[id][1](+v); };
  // the camera sliders span the cabin in metres, or the station in hundreds of them
  const out = setOf(k) === 'station' || setOf(k) === 'map' || setOf(k) === 'town', inH = setOf(k) === 'hangar';
  for (const [id, lo, hi] of [['camX', -1.7, 1.7], ['camY', 0.3, 2.5], ['camZ', -2.2, 1.7]]) { const el = $(id); el.min = out ? -2500 : inH ? -20 : lo; el.max = out ? 2500 : inH ? 20 : hi; el.step = out ? 5 : inH ? 0.05 : 0.01; }
  const cam = Array.isArray(k.cam) ? k.cam : camOf(k).toArray();      // a hangar-relative key shows where it resolves to
  set('keyT', k.t); set('camX', cam[0]); set('camY', cam[1]); set('camZ', cam[2]);
  set('keyChair', chairDeg(k.chair).toFixed(0)); set('keyFace', k.face);
  const look = $('keyLook'); if (look) look.value = typeof k.look === 'string' ? k.look : 'point';
}
// the camera as it is now, written into a key in that key's own frame (its set's metres)
function captureView(k) {
  const off = setOf(k) === 'station' ? STATION_AT : setOf(k) === 'hangar' ? HANGAR_AT : setOf(k) === 'map' ? MAP_AT : new THREE.Vector3();
  k.cam = camera.position.clone().sub(off).toArray().map(v => +v.toFixed(3));
  // the look point pushed out along the line of sight (2 m in the cabin, 1 km outside): a wobble
  // of the camera's path between keys can then never put it behind the camera and flip the view
  const dir = controls.target.clone().sub(camera.position).normalize(), reach = setOf(k) === 'cabin' ? 2 : 1000;
  k.look = camera.position.clone().addScaledVector(dir, reach).sub(off).toArray().map(v => +v.toFixed(3));
}
function editKey(id, v) {
  const k = KEYS[keyIndex], [field, idx] = KEYFIELDS[id];
  if (controls.enabled && !SEQ.active) captureView(k);      // edited from free look: the key takes the view first, so the camera does not jump away
  if (field === 'cam') { if (!Array.isArray(k.cam)) k.cam = camOf(k).toArray(); k.cam[idx] = v; } else k[field] = v;   // editing bakes a hangar-relative key
  if (field === 't') { KEYS.sort((x, y) => x.t - y.t); keyIndex = KEYS.indexOf(k); buildKeyList(); $('seqTime').max = total().toFixed(2); }
  if (!SEQ.active) activateIntro();
  SEQ.playing = false; seek(k.t);
}
function addKeyHere() {
  if (!SEQ.active) activateIntro();
  const T = SEQ.T, { a, b, u } = keysAround(T);
  const k = { t: +T.toFixed(2), set: setOf(a), cam: cameraAt(T).toArray().map(x => +x.toFixed(3)), look: a.look,
              chair: +chairBetween(a.chair, b.chair, ease(u)).toFixed(1), face: +(a.face + (b.face - a.face) * u).toFixed(2) };
  KEYS.push(k); KEYS.sort((x, y) => x.t - y.t); keyIndex = KEYS.indexOf(k);
  buildKeyList(); showKey();
}
function deleteKey() {
  if (KEYS.length <= 2) return;
  KEYS.splice(keyIndex, 1); keyIndex = Math.max(0, keyIndex - 1);
  buildKeyList(); showKey(); $('seqTime').max = total().toFixed(2); seek(Math.min(SEQ.T, total()));
}

function buildPropList() {
  const list = $('props');
  list.innerHTML = '';
  props.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const p of props) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" checked> ${p.name.replace('Prop_', '')}`;
    l.querySelector('input').addEventListener('change', e => { p.visible = e.target.checked; });
    list.appendChild(l);
  }
}

// ── props ───────────────────────────────────────────────────────────────────────
// Extra models placed in a room: a file, where it stands (metres, in the lab's frame), which way it
// faces, how far it leans back against the wall, and its height. Each build has its own list.
// The panel picks a prop and nudges it; Copy settings writes the numbers out to be baked here.
const PROP_SETS = {
  Smart: [
    // Jacob's bass, leaning against the side of the desk's drawer unit, headstock up, facing the room
    { name: 'bass', file: '/models/props/bass.glb', x: -1.22, y: 1.79, z: -0.41, yaw: 74, lean: -2, height: 1.12 },   // where Jacob hung it (2026-09-20)
    // Jacob's Gladius as a desk model on a display stand; the model turns on the rod's tip, the stand stays flat
    // a poster over the bed, under the book ledge: music Jacob likes (16 x 24 in)
    { name: 'ska poster', image: '/textures/posters/ska.jpg', x: -1.63, y: 1.38, z: 0.1, yaw: 90, lean: 0, height: 0.61, frame: true },
    // the books Jacob likes, along the ledge over the bed (spines to the room); a click lists them
    { name: 'books', books: true, x: -1.525, y: 2.132, z: 1.2, yaw: 90, lean: 0, height: 1, length: 1.42 },
    // a framed newspaper clipping beside the poster: Jacob's 'Academic ace' item from the base paper; a click shows it large
    { name: 'clipping', image: '/textures/posters/academic-ace.jpg', x: -1.63, y: 1.58, z: 0.85, yaw: 90, lean: 0, height: 0.3, frame: true, clip: 'ace' },
    { name: 'gladius', file: '/models/props/gladius.glb', x: -1.29, y: 2.21, z: -1.06, yaw: -47, lean: 0, height: 0.33, stand: true, pitch: -15, roll: -72, spin: 111, rise: 0.51, belly: -1 },   // on the shelf by the bass (Jacob, 2026-09-23)
  ],
};
let PROPS = [];
function buildProps(name) {
  for (const pr of PROPS) if (pr.obj) { room.remove(pr.obj); pr.obj.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.map?.dispose(); m.dispose(); }); } }); }
  PROPS = (PROP_SETS[name] || []).map(spec => ({ ...spec, obj: null }));
  PROPS.forEach((pr, i) => pr.books ? buildBooks(pr, i) : pr.image ? buildPoster(pr, i) : loader.load(pr.file, (gltf) => {
    const model = gltf.scene; model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    // stood on its own base, centred, scaled to its real height
    // the model is stood on its base, centred, at one metre tall; the holder's scale sets the real height
    const k = 1 / size.y;
    model.scale.setScalar(k); model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; const m = o.material; if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); } m.envMapIntensity = 0.35; } });
    const holder = new THREE.Group(); holder.add(model); holder.name = 'Prop_' + pr.name;
    // a display stand: a dark disc and a short rod, the model raised onto the rod's tip (all in the
    // model's one-metre units, so the prop's height scales the stand with it)
    if (pr.stand) {
      const standMat = new THREE.MeshStandardMaterial({ color: 0x1b1f24, metalness: 0.6, roughness: 0.35 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.035, 40), standMat); base.position.y = 0.0175;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 12), standMat); rod.position.y = 0.035 + 0.08;
      for (const m of [base, rod]) { m.castShadow = m.receiveShadow = true; holder.add(m); }
      // the model hangs from a pivot at the rod's tip, touching it with its lowest point, so pitch,
      // roll and turn move the aircraft alone and the stand stays flat on the shelf
      const pivot = new THREE.Group(); pivot.name = 'standPivot'; holder.remove(model); pivot.add(model); holder.add(pivot);
      // `belly` (+1 or -1): the rod meets the middle of that broad face instead of the lowest point
      if (pr.belly) { model.position.y -= size.y * k / 2; model.position.z -= pr.belly * size.z * k / 2; }
      pr.rod = rod; pr.pivot = pivot;
    }
    pr.obj = holder; room.add(holder); placeProp(pr);
    if (i === propIdx) showProp();
  }, undefined, (e) => console.error(e)));
  buildPropPicker();
}
// A POSTER: the picture on a plane at its own proportions, one metre tall (the prop's height scales
// it), standing on its bottom edge like the models so the same sliders place it; matte, a hair off
// the wall so it never fights it, and a slim black frame if `frame`.
function buildBooks(pr, i) {
  // built on the next tick: loadRoom clears the room's old children right after buildProps, and
  // the books (unlike the models, which load) would otherwise be cleared with them
  setTimeout(() => buildBooksNow(pr, i), 0);
}
function buildBooksNow(pr, i) {
  if (!PROPS.includes(pr)) return;                                   // the room changed again meanwhile
  const { group, picks } = buildBookshelf({ length: pr.length || 1.3 });
  const holder = new THREE.Group(); holder.name = 'Prop_' + pr.name; holder.add(group);
  pr.obj = holder; pr.picks = picks; room.add(holder); placeProp(pr);
  if (i === propIdx) showProp();
}
function buildPoster(pr, i) {
  new THREE.TextureLoader().load(pr.image, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const w = tex.image.width / tex.image.height, holder = new THREE.Group(); holder.name = 'Prop_' + pr.name;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }));
    face.position.set(0, 0.5, 0.006); face.receiveShadow = true; holder.add(face);
    if (pr.clip) { face.userData.clip = pr.clip; pr.picks = [face]; }
    if (pr.frame) {
      const t = 0.018, d = 0.012, fm = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.3 });
      for (const [fw, fh, fx, fy] of [[w + 2 * t, t, 0, -t / 2], [w + 2 * t, t, 0, 1 + t / 2], [t, 1, -w / 2 - t / 2, 0.5], [t, 1, w / 2 + t / 2, 0.5]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, d), fm); bar.position.set(fx, fy, d / 2); bar.castShadow = true; holder.add(bar);
      }
    }
    pr.obj = holder; room.add(holder); placeProp(pr);
    if (i === propIdx) showProp();
  }, undefined, (e) => console.error(e));
}
// the lean tilts the model back about its base, after the yaw, so it rests against whatever is behind it
function placeProp(pr) {
  if (!pr.obj) return;
  pr.obj.position.set(pr.x, pr.y, pr.z);
  pr.obj.rotation.set(0, 0, 0);
  pr.obj.rotateY(THREE.MathUtils.degToRad(pr.yaw)); pr.obj.rotateX(THREE.MathUtils.degToRad(-pr.lean));
  pr.obj.scale.setScalar(pr.height);
  if (pr.pivot) {
    const rise = pr.rise ?? 0.18;
    pr.rod.scale.y = (rise - 0.035) / 0.16; pr.rod.position.y = 0.035 + (rise - 0.035) / 2;
    pr.pivot.position.set(0, rise, 0);
    pr.pivot.rotation.set(0, 0, 0);
    pr.pivot.rotateY(THREE.MathUtils.degToRad(pr.spin || 0)); pr.pivot.rotateX(THREE.MathUtils.degToRad(pr.pitch || 0)); pr.pivot.rotateZ(THREE.MathUtils.degToRad(pr.roll || 0));
  }
}
let propIdx = 0;
const PROPFIELDS = { propX: 'x', propZ: 'z', propY: 'y', propYaw: 'yaw', propLean: 'lean', propH: 'height', propPitch: 'pitch', propRoll: 'roll', propSpin: 'spin', propRise: 'rise' };
function buildPropPicker() {
  const list = $('propPick'); if (!list) return;
  list.innerHTML = '';
  PROPS.forEach((pr, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = pr.name; b.classList.toggle('on', i === propIdx); b.onclick = () => { propIdx = i; buildPropPicker(); showProp(); }; list.appendChild(b); });
  if (!PROPS.length) list.innerHTML = '<span class="note">no props in this room yet</span>';
}
function showProp() {
  const pr = PROPS[propIdx]; if (!pr) return;
  for (const [id, key] of Object.entries(PROPFIELDS)) { const el = $(id); if (!el || pr[key] === undefined) continue; el.value = pr[key]; $(id + 'Out').textContent = SLIDERS[id][1](+el.value); }
  // a model on a stand turns on the stand instead of leaning (leaning would tip the stand too)
  $('propLeanRow').style.display = pr.stand ? 'none' : ''; $('propOnStand').style.display = pr.stand ? '' : 'none';
}
function editProp(id, v) { const pr = PROPS[propIdx]; if (!pr) return; pr[PROPFIELDS[id]] = v; placeProp(pr); }

// ── the monitors ────────────────────────────────────────────────────────────────
// Each monitor's face was measured off its mesh: centre, the way it faces, width and height, in
// world metres at 3.4 m across. Every build has its own monitors, so each has its own set; the
// middle one is the site's front page and opens it when tapped.
const SCREEN_SETS = {
  Full: [
    { centre: [-0.026, 1.284, -1.233], normal: [-0.03, 0.077, 0.997], width: 0.562, height: 0.444, kind: 'terminal', href: '/projects/old-site/about.html' },
    { centre: [-0.655, 1.301, -1.143], normal: [0.308, 0.216, 0.926], width: 0.615, height: 0.463, kind: 'telemetry' },
    { centre: [0.46, 1.279, -1.174], normal: [-0.229, 0.113, 0.967], width: 0.363, height: 0.416, kind: 'orbit' },
  ],
  // the Smart Mesh room: three monitors in a row on the desk under the big window, measured off
  // the monitor bodies (about 0.75 m wide each, screens 0.72 x 0.45 m)
  Smart: [
    { centre: [-0.050, 1.619, -1.360], normal: [-0.001, 0.009, 1.0], width: 0.70, height: 0.44, kind: 'terminal', href: '/projects/old-site/about.html' },
    { centre: [-0.710, 1.657, -1.360], normal: [0.108, 0.018, 0.994], width: 0.70, height: 0.44, kind: 'telemetry' },
    { centre: [0.684, 1.631, -1.375], normal: [0.032, 0.009, 0.999], width: 0.70, height: 0.44, kind: 'orbit' },
  ],
};
SCREEN_SETS.Light = SCREEN_SETS.Full;
let SCREENS = [];
function buildScreens(name) {
  for (const sc of SCREENS) { scene.remove(sc); sc.geometry.dispose(); sc.material.map.dispose(); sc.material.dispose(); }
  SCREENS = (SCREEN_SETS[name] || SCREEN_SETS.Full).map(spec => new Screen(spec));
  setTimeout(buildScreenPick, 0);
  for (const sc of SCREENS) if (sc.kind === 'terminal') sc.source = term.canvas;
  for (const sc of SCREENS) scene.add(sc);
}
// Each screen finds the monitor face for itself once the room is in: a ray from a little in front
// of where it was measured, back toward the wall, and the first face it meets is the glass. The
// screen then sits just proud of that face, turned to match it, so a few centimetres of measuring
// error cannot leave it floating or buried.
function snapScreens() {
  const ray = new THREE.Raycaster(); const targets = [];
  room.traverse(o => { if (o.isMesh && o.name !== 'Roof' && o.name !== 'RoofLid') targets.push(o); });
  for (const sc of SCREENS) {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(sc.quaternion);
    ray.set(sc.position.clone().addScaledVector(n, 0.45), n.clone().negate()); ray.far = 0.9;
    const hit = ray.intersectObjects(targets, true).find(h => h.face);
    if (!hit) continue;
    const fn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (fn.dot(n) < 0) fn.negate();
    sc.position.copy(hit.point).addScaledVector(fn, 0.004);
    sc.lookAt(hit.point.clone().add(fn));
    // the painted screen's own extent, found by walking out from the hit along the face's plane
    // until the surface turns (the bezel): the live screen is sized to sit inside that
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sc.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(sc.quaternion);
    const reach = (dir) => { let d = 0.02; for (; d < 0.6; d += 0.02) { ray.set(hit.point.clone().addScaledVector(dir, d).addScaledVector(fn, 0.05), fn.clone().negate()); ray.far = 0.1;
      const h = ray.intersectObjects(targets, true).find(x => x.face); if (!h) break; const hn = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (Math.abs(hn.dot(fn)) < 0.9 || Math.abs(h.distance - 0.05) > 0.012) break; } return d - 0.02; };
    const w = reach(right) + reach(right.clone().negate()), h = reach(up) + reach(up.clone().negate());
    if (w > 0.2 && h > 0.15) {
      sc.position.addScaledVector(right, (reach(right) - reach(right.clone().negate())) / 2).addScaledVector(up, (reach(up) - reach(up.clone().negate())) / 2);
      sc.scale.set((w * 0.94) / sc.geometry.parameters.width, (h * 0.92) / sc.geometry.parameters.height, 1);
    }
  }
  for (const sc of SCREENS) sc.userData.snap = { position: sc.position.clone(), scale: sc.scale.clone() };   // where the snap put it, for the fit to build on
  applyScreenFit();
}
// SCREEN FIT. The snap sizes each live screen from the bezel it finds; where that comes out short of
// the painted display, these set the plane's real size (cm) and nudge it (cm) along its own right
// and up. Per build, per screen; baked in from Copy settings.
const SCREEN_FIT = {
  Smart: [{ w: 55, h: 37, x: -0.5, y: -0.5 }, { w: 54, h: 39, x: 0.5, y: -0.5 }, { w: 46, h: 35, x: 0, y: 0 }],   // Jacob's fit, 2026-09-20
};
let screenPick = 0;
function fitOf(i) { const arr = SCREEN_FIT[build] || (SCREEN_FIT[build] = []); return arr[i] || (arr[i] = {}); }
function applyScreenFit() {
  SCREENS.forEach((sc, i) => {
    const s = sc.userData.snap; if (!s) return;
    const f = (SCREEN_FIT[build] || [])[i] || {};
    const gw = sc.geometry.parameters.width, gh = sc.geometry.parameters.height;
    sc.scale.set(f.w ? (f.w / 100) / gw : s.scale.x, f.h ? (f.h / 100) / gh : s.scale.y, 1);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sc.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(sc.quaternion);
    sc.position.copy(s.position).addScaledVector(right, (f.x || 0) / 100).addScaledVector(up, (f.y || 0) / 100);
  });
}
function showScreenFit() {
  const sc = SCREENS[screenPick]; if (!sc) return;
  const f = fitOf(screenPick), s = sc.userData.snap;
  const w = f.w || (s ? Math.round(s.scale.x * sc.geometry.parameters.width * 100) : 0), h = f.h || (s ? Math.round(s.scale.y * sc.geometry.parameters.height * 100) : 0);
  for (const [id, v] of [['screenW', w], ['screenH', h], ['screenX', f.x || 0], ['screenY', f.y || 0]]) { const el = $(id); if (el) { el.value = v; $(id + 'Out').textContent = SLIDERS[id][1](v); } }
}
function buildScreenPick() {
  const sel = $('screenPick'); if (!sel) return;
  sel.innerHTML = SCREENS.map((sc, i) => `<option value="${i}">${i + 1} · ${sc.kind}</option>`).join('');
  sel.value = Math.min(screenPick, SCREENS.length - 1); screenPick = +sel.value; showScreenFit();
}
buildScreens(build);
{
  // a tap on a screen that has a link opens it; a drag is the camera, not a tap. On the click, not
  // the pointerup: a touch's click comes after its pointerup and would land on the card just opened
  const ray = new THREE.Raycaster(), down = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', e => down.set(e.clientX, e.clientY));
  // what the pointer is over: a screen with a link, or a book (the nearest of either)
  const pointAt = (e) => {
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const picks = PROPS.flatMap(pr => pr.picks || []);
    const hit = ray.intersectObjects([...SCREENS, ...picks], false)[0];
    if (!hit) return null;
    if (hit.object.userData.book) return { book: hit.object.userData.book };
    if (hit.object.userData.clip) return { clip: hit.object.userData.clip };
    return hit.object.href ? { href: hit.object.href } : null;
  };
  renderer.domElement.addEventListener('click', e => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || currentSet !== 'cabin') return;
    const at = pointAt(e);
    if (at && at.href) location.href = at.href;
    else if (at && at.book) openLikes(at.book);
    else if (at && at.clip) openClipping(at.clip);
  });
  // the pointing hand over anything that does something, and a tag saying what a book is
  const tag = $('hoverTag');
  renderer.domElement.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons || currentSet !== 'cabin') { renderer.domElement.style.cursor = ''; tag.classList.remove('on'); return; }
    const at = pointAt(e);
    renderer.domElement.style.cursor = at ? 'pointer' : '';
    const html = at && at.book ? `<b>${at.book.title}</b><br>${at.book.series.name} · ${at.book.series.author}` : at && at.clip ? CLIPPINGS[at.clip].tag : '';
    if (html) {
      tag.innerHTML = html;
      tag.style.left = Math.min(e.clientX + 16, innerWidth - 280) + 'px'; tag.style.top = (e.clientY + 18) + 'px'; tag.classList.add('on');
    } else tag.classList.remove('on');
  });
  renderer.domElement.addEventListener('pointerleave', () => tag.classList.remove('on'));
}
// THE LIKES CARD: a click on a book lists every series on the shelf, the one clicked lit. The film
// holds while it is open, so the idle auto-play does not carry on underneath it.
function openLikes(book) {
  $('likesTitle').textContent = 'Books I like';
  $('likesList').innerHTML = SERIES.map(s => `<li class="${s === book.series ? 'hit' : ''}">${s.name}<span>${s.author}</span></li>`).join('');
  $('likesCard').classList.add('on'); $('clipCard').classList.remove('on'); $('hoverTag').classList.remove('on');
  SEQ.playing = false; RESUME.hold = true;
}
function closeLikes() { $('likesCard').classList.remove('on'); scrubbed(); }
$('likesClose').onclick = closeLikes;
// THE CLIPPING CARD: a click on something framed on the wall shows it large, with where it came
// from. The film holds while it is open, as it does for the books.
const CLIPPINGS = {
  ace: {
    title: 'Academic ace', tag: '<b>Academic ace</b><br>Keesler News · Oct. 16, 2008', img: '/textures/posters/academic-ace.jpg',
    alt: "Keesler News clipping, Oct. 16, 2008: 'Academic ace', a photo of Airman 1st Class Jacob Conrads with its caption",
    note: 'From the <i>Keesler News</i>, the paper of Keesler Air Force Base in Biloxi, Mississippi: Thursday, October 16, 2008, page 6. '
      + '<a href="https://web.archive.org/web/20101230013643/http://www.keesler.af.mil/shared/media/document/AFD-081015-024.pdf" target="_blank" rel="noopener">The whole issue</a>, saved by the Wayback Machine.',
  },
};
function openClipping(id) {
  const c = CLIPPINGS[id]; if (!c) return;
  $('clipTitle').textContent = c.title; $('clipImg').src = c.img; $('clipImg').alt = c.alt; $('clipNote').innerHTML = c.note;
  $('clipCard').classList.add('on'); $('likesCard').classList.remove('on'); $('hoverTag').classList.remove('on');
  SEQ.playing = false; RESUME.hold = true;
}
function closeClipping() { $('clipCard').classList.remove('on'); scrubbed(); }
function cardOpen() { return $('likesCard').classList.contains('on') || $('clipCard').classList.contains('on'); }
$('clipClose').onclick = closeClipping;
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('likesCard').classList.contains('on')) closeLikes();
  if ($('clipCard').classList.contains('on')) closeClipping();
});

// ── camera views, in metres inside the cabin ────────────────────────────────────
const VIEWS = {
  'Desk':       [[0.20, 1.55, 0.75], [0.10, 1.55, -1.55]],
  'Window':     [[0.10, 1.75, -0.15], [0.05, 1.80, -1.62]],
  'Chair':      [[-1.05, 1.45, 0.55], [0.25, 1.05, -0.45]],
  'Whole room': [[2.4, 2.5, 2.7], [0, 1.15, -0.6]],
};
// FREE LOOK: for inspecting a room. The timeline lets go of the camera, the wheel zooms instead of
// scrubbing, and the orbit can go anywhere - through walls, up close - with the greeting hidden.
function freeLook() {
  BOOT.on = false; pull = null; $('bootOverlay')?.remove();
  SEQ.active = false; SEQ.playing = false; showSet('cabin');
  for (const h of holos) h.fill = 0;
  controls.enabled = true; controls.minDistance = 0.05; controls.maxDistance = 40;
  $('scrubOn').checked = false; SEQ.scrub = false; controls.enableZoom = true;
  $('swivel').checked = false; CHAIR.swivel = false;
  if (!controls.target.lengthSq()) { camera.position.set(1.6, 1.6, 1.8); controls.target.set(-0.3, 1.0, -0.6); }
  controls.update();
  post.enabled = $('post').checked;
}
function frame(name) {
  SEQ.active = false; SEQ.playing = false; controls.enabled = true; showSet('cabin');
  for (const h of holos) h.fill = 0;
  const [p, t] = VIEWS[name];
  camera.position.set(...p); controls.target.set(...t); controls.update();
  post.focus = camera.position.distanceTo(controls.target);
}
$('freeLook').onclick = freeLook;
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => frame(name); $('cams').appendChild(b);
}

// ── controls ────────────────────────────────────────────────────────────────────
const SLIDERS = {
  cabinLight: [v => cabin.intensity = v, v => v.toFixed(1)],
  screenLight:[v => screens.intensity = v, v => v.toFixed(1)],
  sunLight:   [v => sun.intensity = v, v => v.toFixed(1)],
  ambient:    [v => ambient.intensity = v, v => v.toFixed(2)],
  exposure:   [v => renderer.toneMappingExposure = v, v => v.toFixed(2)],
  chairSpeed: [v => CHAIR.speed = v, v => v + '°/s'],
  chairAngle: [v => { CHAIR.angle = v; if (chairPivot && !CHAIR.swivel) chairPivot.rotation.y = THREE.MathUtils.degToRad(v); }, v => v + '°'],
  chairX:     [v => { CHAIR.x = v; placeChair(); }, v => v + ' cm'],
  chairY:     [v => { CHAIR.y = v; placeChair(); }, v => v + ' cm'],
  chairHeight:[v => { CHAIR.height = v; placeChair(); }, v => v + '%'],
  mapTurn:    [v => { MAPFIT.turn = v; applyMapFit(); }, v => v + '°'],
  mapX:       [v => { MAPFIT.x = v; applyMapFit(); }, v => v + ' px'],
  mapY:       [v => { MAPFIT.y = v; applyMapFit(); }, v => v + ' px'],
  mapSize:    [v => { MAPFIT.size = v; applyMapFit(); }, v => v + '%'],
  pinX:       [v => movePinFromPanel('fx', v / 100), v => v + '% east'],
  pinY:       [v => movePinFromPanel('fy', v / 100), v => v + '% south'],
  helmetSize: [v => { HELMET.size = v; applyHelmetFit(); }, v => v + '%'],
  helmetUp:   [v => { HELMET.up = v; applyHelmetFit(); }, v => v + ' cm'],
  helmetFwd:  [v => { HELMET.forward = v; applyHelmetFit(); }, v => v + ' cm'],
  helmetTilt: [v => { HELMET.tilt = v; applyHelmetFit(); }, v => v + '°'],
  helmetTurn: [v => { HELMET.turn = v; applyHelmetFit(); }, v => v + '°'],
  helmetRoll: [v => { HELMET.roll = v; applyHelmetFit(); }, v => v + '°'],
  // in the fighter: the seat is re-placed on the current frame when a slider moves
  seatFwd:    [v => { HANGAR.seatBack = -v / 100; reseat(); }, v => v + ' cm'],
  seatDown:   [v => { HANGAR.seatDown = v / 100; reseat(); }, v => v + ' cm'],
  seatRecline:[v => { HANGAR.recline = v; reseat(); }, v => v + '°'],
  canopyDeg:  [v => { HANGAR.canopyDeg = v; reseat(); }, v => v + '°'],
  canopyDrop: [v => { HANGAR.canopyDrop = v / 100; reseat(); }, v => v + ' cm'],
  canopySlide:[v => { HANGAR.canopySlide = v / 100; reseat(); }, v => v + ' cm'],
  screenW:    [v => { fitOf(screenPick).w = v; applyScreenFit(); }, v => v + ' cm'],
  screenH:    [v => { fitOf(screenPick).h = v; applyScreenFit(); }, v => v + ' cm'],
  screenX:    [v => { fitOf(screenPick).x = v; applyScreenFit(); }, v => v + ' cm'],
  screenY:    [v => { fitOf(screenPick).y = v; applyScreenFit(); }, v => v + ' cm'],
  chairZ:     [v => { CHAIR.z = v; placeChair(); }, v => v + ' cm'],
  sitHeight:  [v => { SITTER.height = v; placeSitter(); }, v => v + ' cm'],
  sitForward: [v => { SITTER.forward = v; placeSitter(); }, v => v + ' cm'],
  sitTurn:    [v => { SITTER.turn = v; placeSitter(); }, v => v + '°'],
  propX:      [v => editProp('propX', v), v => v.toFixed(2) + ' m'],
  propZ:      [v => editProp('propZ', v), v => v.toFixed(2) + ' m'],
  propY:      [v => editProp('propY', v), v => v.toFixed(2) + ' m'],
  propYaw:    [v => editProp('propYaw', v), v => v.toFixed(0) + '°'],
  propLean:   [v => editProp('propLean', v), v => v.toFixed(0) + '°'],
  sitCalm:    [v => { SIT.calm = v; reseatWave(); }, v => v.toFixed(1) + ' s'],
  waveArm:    [v => { WAVE.arm = v; reseatWave(); }, v => Math.round(v * 100) + '%'],
  waveBody:   [v => { WAVE.body = v; reseatWave(); }, v => Math.round(v * 100) + '%'],
  waveHead:   [v => { WAVE.head = v; reseatWave(); }, v => Math.round(v * 100) + '%'],
  propPitch:  [v => editProp('propPitch', v), v => v.toFixed(0) + '°'],
  propRoll:   [v => editProp('propRoll', v), v => v.toFixed(0) + '°'],
  propSpin:   [v => editProp('propSpin', v), v => v.toFixed(0) + '°'],
  propRise:   [v => editProp('propRise', v), v => (v * 100).toFixed(0) + '% of its height'],
  propH:      [v => editProp('propH', v), v => v.toFixed(2) + ' m'],
  keyT:       [v => editKey('keyT', v), v => v.toFixed(2) + ' s'],
  camX:       [v => editKey('camX', v), v => v.toFixed(2) + ' m'],
  camY:       [v => editKey('camY', v), v => v.toFixed(2) + ' m'],
  camZ:       [v => editKey('camZ', v), v => v.toFixed(2) + ' m'],
  keyChair:   [v => editKey('keyChair', v), v => v.toFixed(0) + '°'],
  keyFace:    [v => editKey('keyFace', v), v => Math.round(v * 100) + '%'],
  actWave:    [v => ACTS.wave = v, v => v.toFixed(1) + ' s'],
  actStand:   [v => ACTS.stand = v, v => v.toFixed(1) + ' s'],
  actWalk:    [v => ACTS.walk = v, v => v.toFixed(1) + ' s'],
  walkDir:    [v => ACTS.walkDir = v, v => v.toFixed(0) + '°'],
  seqTime:    [v => { if (chairPivot) { if (!SEQ.active) activateIntro(); SEQ.playing = false; seek(v); } }, v => v.toFixed(1) + ' s'],
  earthSpin:  [v => { EARTH.spin = v; earth.spin = v; }, v => v.toFixed(2) + '°/s'],
  earthAlt:   [v => { EARTH.altitude = v * 1000; placeEarth(); }, v => v + ' km'],
  earthTilt:  [v => { EARTH.tilt = v; placeEarth(); }, v => v + '°'],
  earthGlow:  [v => { EARTH.glow = v; placeEarth(); }, v => v.toFixed(2)],
  bloomStr:   [v => post.bloom.strength = v, v => v.toFixed(2)],
  dofBlur:    [v => post.dof.uniforms.uBlur.value = v, v => v.toFixed(1) + ' px'],
  vignette:   [v => post.finish.uniforms.uVignette.value = v, v => v.toFixed(2)],
  grain:      [v => post.finish.uniforms.uGrain.value = v, v => v.toFixed(2)],
};
for (const [id, [apply, fmt]] of Object.entries(SLIDERS)) {
  const el = $(id);
  const run = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); };
  el.addEventListener('input', run);
  if (id in KEYFIELDS || id in PROPFIELDS || /^screen[WHXY]$/.test(id) || /^pin[XY]$/.test(id)) $(id + 'Out').textContent = fmt(+el.value); else run();   // key, prop and screen sliders read from their object, they do not write it at start
}
$('keyLook').addEventListener('change', e => { const v = e.target.value; const k = KEYS[keyIndex]; if (v === 'point') captureView(k); else k.look = v; seek(k.t); });
$('screenPick').addEventListener('change', e => { screenPick = +e.target.value; showScreenFit(); });
$('pinState').addEventListener('change', showPin);
$('useView').addEventListener('click', () => { const k = KEYS[keyIndex]; if (!k) return; captureView(k); showKey(); });
// working in the panel holds the timeline: no playing on by itself until the scene is scrolled again
$('panel').addEventListener('input', () => { RESUME.hold = true; });
$('panel').addEventListener('change', () => { RESUME.hold = true; });
$('panel').addEventListener('click', (e) => { if (!e.target.closest('#playIntro')) RESUME.hold = true; });   // any button in the panel holds too; Play intro is the way out
$('addKey').onclick = addKeyHere; $('delKey').onclick = deleteKey;
// CUT OR INSERT TIME. Everything on the timeline is in absolute seconds, so taking time out (or
// making room) from `at` moves every later key and every timed event by the same amount. A cut
// removes the keys inside it and pulls the events inside it back to its start.
function shiftTime(at, delta) {
  const end = delta < 0 ? at - delta : at;
  const move = (t) => t >= end ? t + delta : t > at ? at : t;           // after the cut: moved; inside it: to its start
  const fields = (obj, keys) => { for (const k of keys) if (typeof obj[k] === 'number') obj[k] = +move(obj[k]).toFixed(3); };
  if (delta < 0) for (let i = KEYS.length - 1; i >= 0; i--) if (KEYS[i].t > at && KEYS[i].t < end) KEYS.splice(i, 1);
  for (const k of KEYS) {
    k.t = +move(k.t).toFixed(3);
    for (const part of [k.cam, k.look]) if (part && typeof part === 'object' && !Array.isArray(part) && typeof part.freeze === 'number') part.freeze = +move(part.freeze).toFixed(3);
  }
  fields(ACTS, ['wave', 'stand', 'walk']);
  for (const p of PARTS) fields(p, ['start', 'end']);
  for (const s of TOUR) fields(s, ['t']);
  fields(MAP, ['glow', 'tourEnd', 'shipIn', 'shipAt', 'dive', 'diveEnd', 'fire', 'flash', 'clear', 'clouds']);
  fields(HANGAR, ['walk', 'sit', 'canopy', 'roll']);
  for (const f of FLYBYS) { fields(f, ['t0', 't1']); if (f.line) fields(f.line, ['at']); }
  for (const tr of traffic) fields(tr, ['t0', 't1']);                  // the built copies (their line is shared with FLYBYS)
  keyIndex = Math.min(keyIndex, KEYS.length - 1);
  buildKeyList(); showKey(); $('seqTime').max = total().toFixed(2);
  RESUME.hold = true; SEQ.playing = false;
  seek(Math.min(delta < 0 && SEQ.T > at ? Math.max(at, SEQ.T + delta) : SEQ.T >= at ? SEQ.T + delta : SEQ.T, total()));
  $('cutNote').textContent = `${delta < 0 ? 'Cut' : 'Inserted'} ${Math.abs(delta).toFixed(1)} s at ${at.toFixed(1)} s. The film is now ${total().toFixed(1)} s to the live flight.`;
}
for (const id of ['cutAt', 'cutLen']) $(id).addEventListener('input', () => { $(id + 'Out').textContent = (+$(id).value).toFixed(1) + ' s'; });
$('cutHere').onclick = () => { $('cutAt').value = SEQ.T.toFixed(1); $('cutAtOut').textContent = SEQ.T.toFixed(1) + ' s'; };
$('cutTime').onclick = () => shiftTime(+$('cutAt').value, -$('cutLen').value);
$('insertTime').onclick = () => shiftTime(+$('cutAt').value, +$('cutLen').value);
// Flat is the default. The face's colour map already carries light and shade, painted in by Tripo,
// and a strong key lays a second set of shadows over it that disagree with the first. Soft light
// from everywhere leaves the painted light to do the work; the cabin's own look is kept as Cabin.
const LIGHT_PRESETS = {
  Flat:  { cabinLight: 2.0, screenLight: 1.0, sunLight: 0.5, ambient: 2.2, exposure: 1.0, sky: 0xffffff, ground: 0xb8b8b8 },
  Cabin: { cabinLight: 6,   screenLight: 3,   sunLight: 2.6, ambient: 0.45, exposure: 1.1, sky: 0x9fb6cc, ground: 0x20262d },
};
let lightName = 'Flat';
function setLight(name) {
  lightName = name;
  const P = LIGHT_PRESETS[name];
  ambient.color.setHex(P.sky); ambient.groundColor.setHex(P.ground);
  for (const id of ['cabinLight', 'screenLight', 'sunLight', 'ambient', 'exposure']) {
    const el = $(id); el.value = P[id]; el.dispatchEvent(new Event('input'));
  }
  document.querySelectorAll('#lights button').forEach(b => b.classList.toggle('on', b.textContent === name));
}
for (const name of Object.keys(LIGHT_PRESETS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => setLight(name); $('lights').appendChild(b);
}
setLight('Flat');
$('playIntro').onclick = playIntro;
// the pinned bar: step to the previous / next key (and hold there), play or pause from here
function stepKey(dir) {
  if (!SEQ.active) activateIntro();
  const ts = [...new Set(KEYS.map(k => k.t))].sort((x, y) => x - y), T = SEQ.T;
  const t = dir > 0 ? ts.find(x => x > T + 0.02) : [...ts].reverse().find(x => x < T - 0.02);
  if (t === undefined) return;
  SEQ.playing = false; RESUME.hold = true; seek(t);
  const i = KEYS.findIndex(k => k.t === t); if (i >= 0) { keyIndex = i; buildKeyList(); showKey(); }
}
$('prevKey').onclick = () => stepKey(-1);
$('nextKey').onclick = () => stepKey(1);
$('playPause').onclick = () => {
  if (!SEQ.active) activateIntro();
  SEQ.playing = !SEQ.playing;
  if (SEQ.playing) { if (SEQ.T >= total() - 0.01) seek(0); scrubbed(); } else RESUME.hold = true;
};
setInterval(() => { const b = $('playPause'); if (b) b.textContent = SEQ.playing ? 'pause' : 'play'; }, 250);
// the collapsible sections remember which are open
for (const d of document.querySelectorAll('#panel details[data-sec]')) {
  try { d.open = JSON.parse(localStorage.getItem('quartersLab.open') || '[]').includes(d.dataset.sec); } catch (e) { /* no storage */ }
  d.addEventListener('toggle', () => { try { localStorage.setItem('quartersLab.open', JSON.stringify([...document.querySelectorAll('#panel details[data-sec]')].filter(x => x.open).map(x => x.dataset.sec))); } catch (e) { /* no storage */ } });
}
const CHECKS = {
  openWindows: () => applyWindows(),
  swivel: e => { CHAIR.swivel = e.target.checked; },
  sitFull: e => { SIT.full = e.target.checked; reseatWave(); },
  helmetShow: e => { HELMET.show = e.target.checked; applyHelmetFit(); },
  scrubOn: e => { SEQ.scrub = e.target.checked; controls.enableZoom = !SEQ.scrub; },
  sitterOn: e => { SITTER.on = e.target.checked; if (SITTER.on) loadSitter(); if (sitter) sitter.visible = SITTER.on; },
  post: e => { post.enabled = e.target.checked; },
  bloomOn: e => { post.bloom.enabled = e.target.checked; },
  dofOn: e => { post.dof.enabled = e.target.checked; },
  flareOn: e => { post.flare.enabled = e.target.checked; },
};
for (const [id, fn] of Object.entries(CHECKS)) { $(id).addEventListener('change', fn); fn({ target: $(id) }); }
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };
$('copy').onclick = () => {
  const out = { roomMetres: ROOM_METRES, chair: { ...CHAIR }, sitter: { ...SITTER }, helmet: (({ show, ...h }) => h)(HELMET),
    map: { ...MAPFIT },
    pins: Object.fromEntries(Object.entries(PINS).map(([k, p]) => [k, p.fx !== undefined ? { fx: +p.fx.toFixed(3), fy: +p.fy.toFixed(3) } : p])),
    fighter: { seatForwardCm: Math.round(-HANGAR.seatBack * 100), seatDownCm: Math.round(HANGAR.seatDown * 100), recline: HANGAR.recline, canopyDeg: HANGAR.canopyDeg, canopyDropCm: Math.round(HANGAR.canopyDrop * 100), canopySlideCm: Math.round(HANGAR.canopySlide * 100) }, props: PROPS.map(({ obj, rod, pivot, picks, ...p }) => p), wave: { ...WAVE }, sit: { ...SIT }, screens: SCREEN_FIT[build] || [], intro: { keys: KEYS, acts: ACTS, parts: PARTS.map(p => ({ start: p.start, end: p.end })) },
    timing: { tour: TOUR.map(s => s.t), map: (({ glow, tourEnd, shipIn, shipAt, dive, diveEnd, fire, flash, clear, clouds }) => ({ glow, tourEnd, shipIn, shipAt, dive, diveEnd, fire, flash, clear, clouds }))(MAP), hangar: { walk: HANGAR.walk, sit: HANGAR.sit, canopy: HANGAR.canopy, roll: HANGAR.roll }, flybys: FLYBYS.map(f => ({ t0: f.t0, t1: f.t1, ...(f.line ? { at: f.line.at } : {}) })) }, earth: { ...EARTH },
    light: { cabin: cabin.intensity, screens: screens.intensity, sun: sun.intensity, ambient: ambient.intensity, exposure: renderer.toneMappingExposure },
    openWindows: $('openWindows').checked };
  $('out').style.display = 'block'; $('out').value = JSON.stringify(out, null, 2); $('out').select();
  try { navigator.clipboard.writeText($('out').value); } catch (e) {}
};
addEventListener('resize', () => {
  if (mapSet && mapSet.map) mapSet.map.setResolution(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (townCam) { townCam.aspect = camera.aspect; townCam.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
});

frame('Desk');
loadRoom(build);

// ── loop ────────────────────────────────────────────────────────────────────────
const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, shown = 0, offStage = 0, townWarm = 0;
// THE TOWN, OFF STAGE: its plants laid and its trees' pictures baked where the fighter arrives (quietly, every other frame);
// once that's done, its shaders built (in the background where the browser can), then the town drawn once to the screen
// itself through a one-pixel window, from where the town waits and from where the arrival opens, just before the frame
// paints over it: every picture sent to the graphics card and every way of drawing it set up for the screen as it is, so
// the cut to the town doesn't stall (drawn into a target of its own instead, the first real frame still took ~0.3 s)
function offStageTown(dt) {
  if (!valley.settled()) { if ((offStage = (offStage + 1) % 2) === 0) valley.update(dt * 2, null, true); return; }
  if (townWarm === 0) { townWarm = 1; perfMark('town: plants laid, trees baked; warming'); const go = () => { townWarm = 2; }; if (renderer.compileAsync) renderer.compileAsync(valley.scene, townCam).then(go, go); else go(); return; }
  if (townWarm !== 2) return; townWarm = 3;
  const cam = townCam.clone(), A = town.ARRIVE, scissor = renderer.getScissorTest();
  renderer.setScissorTest(true); renderer.setScissor(0, 0, 1 / renderer.getPixelRatio(), 1 / renderer.getPixelRatio());
  renderer.render(valley.scene, cam);
  cam.position.copy(A.from).add(new THREE.Vector3(-120, 90, 0)); cam.lookAt(A.from.clone().add(new THREE.Vector3(26, 0, 0))); cam.updateMatrixWorld();   // (the arrival's first view: in from the west)
  renderer.render(valley.scene, cam);
  renderer.setScissorTest(scissor); perfMark('town: warmed');
}
renderer.info.autoReset = false;
renderer.setAnimationLoop(() => {
  renderer.info.reset();
  clock.update?.();
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  if (earthMode === 'Globe') earth.update(dt);
  // drifting past, as if in orbit, wrapping around without jumping to one end on the first frame
  else picture.position.x = ((picture.position.x + dt * EARTH.spin * 12 + 1200) % 2400) - 1200;
  term.update(dt);
  if (BOOT.on) {
    drawBootOverlay();
    if (BOOT.phase === 'typed' && term.done) { BOOT.phase = 'hold'; setTimeout(startPullBack, 2500); }   // a couple of seconds to read the greeting
    stepPull(dt);
  }
  stepSequence(dt);
  if (!SEQ.active) controls.update();     // while the timeline owns the camera, orbit must not touch it: its 14 m limit would drag it into the station
  if ($('autoFocus').checked) post.focus = camera.position.distanceTo(controls.target);
  // the town is drawn by the valley, from its own scene and camera; elsewhere the film's own (the valley, off stage, lays its
  // plants and bakes its trees round the way in, every other frame once the greeting is done)
  if (currentSet === 'town' && valley) { valley.update(dt); valley.render(); }
  else { if (valley && !BOOT.on) offStageTown(dt); post.render(dt); }   // (off stage first: its unseen draw is painted over)
  if (raw > 0) fps += (1 / raw - fps) * Math.min(1, raw * 2);   // weighted by the frame's own length: a two-second frame counts in full, not five percent
  if ((shown += raw) > 0.5) {
    shown = 0;
    const line = '<b>' + Math.round(fps) + ' fps</b> · ' + renderer.info.render.calls + ' draws · ' +
      (renderer.info.render.triangles / 1000).toFixed(0) + 'k triangles';
    $('hud').innerHTML = line;
    $('fps').innerHTML = line;
  }
});
