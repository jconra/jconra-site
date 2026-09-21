// QUARTERS LAB. The Tripo habitat interior, prepared in Blender so the lab can take it apart: the
// window glass is its own piece (hide it and the frames are open), the chair is its own piece (it
// swivels), and every prop can be switched off. Earth turns outside the windows.
//
// The room is about a metre across as it ships, so everything here works in room units and the lab
// scales it to a real cabin: 3.4 m wall to wall by default.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Earth } from '../../src/objects/earth.js';
import { Post } from '../../src/fx/post.js';
import { Hologram } from '../../src/objects/hologram.js';
import { Screen } from '../../src/objects/screens.js';
import { Terminal } from '../../src/objects/terminal.js';
import { loadKit, StationKit, DEFAULT_LAYOUT } from '../../src/objects/stationKit.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
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
const cabin = new THREE.PointLight(0xdfe9f5, 6, 12, 1.6); cabin.position.set(0, 1.75, 0.1); scene.add(cabin);   // below the roof, not pressed against it
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
  new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('../../textures/earth.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; }),
                                transparent: true, depthWrite: false })
);
// The old site laid it flat far below and looked down on it. This window looks out sideways, where a
// flat sheet is edge-on and invisible, so it hangs below and outside, turned square to the window:
// the sheet's face points back along the line from it to the window, so the globe stays round.
// (Turned 76 degrees instead of 14, it was seen nearly edge-on and read as an egg.)
picture.position.set(0, -150, -600);                               // about 14 degrees below the window's line of sight
picture.rotation.x = -Math.atan2(150, 600);
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
const CHAIR = { swivel: true, speed: 12, angle: 0 };

// Two builds of the same cabin, to compare: the full Tripo export, and a lighter one whose props
// share a single texture atlas and one mesh, with the flat panels merged and the rest collapsed.
const BUILDS = {
  Full:  { file: '../../models/quarters.glb', note: '448k triangles · 58 meshes · 18.5 MB' },
  Light: { file: '../../models/quarters_lite.glb', note: '185k triangles · 4 meshes · 8.0 MB' },
  // unit: metres per model unit, and the model is already centred on its own axes; the box is not
  // used for scale, because walls added later would shrink and shift the room
  Smart: { file: '../../models/quarters_smart.glb', note: 'Smart Mesh room · Jacob\'s SpaceDorm · 42k triangles · 5.3 MB', unit: 3.4, ownRoof: true },
};
let build = BUILDS[Q.get('build')] ? Q.get('build') : 'Light';   // ?build=Smart opens straight on a room
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
term.cmd('whoami').out('jacob').wait(0.5)
    .cmd('groups').out('aws-systems-engineer  air-force-security-engineer  threejs-enthusiast  bass-guitarist').wait(0.7)
    .cmd('./station --enter').out('bringing the cabin up ...');
bootBar('cabin'); bootBar('jacob'); bootBar('clips'); bootBar('station');
term.gate().wait(0.4)
    .cmd('./greeting.sh')
    .out('Welcome to jconra.com.').out('Hello! I am Jacob Conrads, a Systems Engineer. This station is a project to play around with and highlight my skills.')
    .out('Thank you for visiting! Scroll or swipe to move through it, or wait for the animation.').wait(0.3)
    .out('> Click here for the basic site');
const termCanvas = $('term'); const termCtx = termCanvas ? termCanvas.getContext('2d') : null;
function drawBootOverlay() {
  if (!termCtx || !BOOT.on) return;
  const W = termCanvas.width = innerWidth * Math.min(devicePixelRatio, 2), H = termCanvas.height = innerHeight * Math.min(devicePixelRatio, 2);
  termCtx.fillStyle = '#020604'; termCtx.fillRect(0, 0, W, H);
  // the column fills the height, centred; on a wide screen there is black either side, as a
  // terminal window would have
  const sh = H, sw = sh * term.canvas.width / term.canvas.height, sx = Math.min((W - sw) / 2, W * 0.08);
  termCtx.drawImage(term.canvas, Math.max(0, sx), 0, Math.min(sw, W), sh);
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
  // on a phone the terminal column is on the left of the monitor: aim at that column
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sc.quaternion);
  const colW = h * term.canvas.width / term.canvas.height, portrait = innerWidth < innerHeight;
  const at = sc.position.clone().addScaledVector(right, portrait ? -(w - colW) / 2 : 0);
  const dd = portrait ? Math.max(colW / (2 * Math.tan(hfov / 2)), h / (2 * Math.tan(vfov / 2))) * 1.02 : d;
  return { pos: at.clone().addScaledVector(n, dd), at };
}
let pull = null;
function startPullBack() {
  const bc = bootCamera(); if (!bc) { finishBoot(); return; }
  if (!SEQ.active) activateIntro();
  SEQ.playing = false; seek(0);
  const endPos = camera.position.clone(), endAt = controls.target.clone();
  pull = { t: 0, len: 3.2, from: bc.pos, at: bc.at, to: endPos, toAt: endAt };
  camera.position.copy(bc.pos); controls.target.copy(bc.at); camera.lookAt(bc.at);
  BOOT.phase = 'pull';
  const ov = $('bootOverlay'); if (ov) { ov.classList.add('gone'); setTimeout(() => ov.remove(), 900); }
}
function stepPull(dt) {
  if (!pull) return;
  pull.t += dt;
  const u = Math.min(1, pull.t / pull.len), e = u * u * (3 - 2 * u);
  camera.position.lerpVectors(pull.from, pull.to, e); controls.target.lerpVectors(pull.at, pull.toAt, e); camera.lookAt(controls.target);
  if (u >= 1) { pull = null; finishBoot(); }
}
function finishBoot() { BOOT.phase = 'done'; BOOT.on = false; if (!SEQ.active) activateIntro(); SEQ.T = 0; SEQ.playing = true; }

function loadRoom(name) {
  build = name;
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
      chairPivot.attach(o);
    } else props.push(o);
  }
  buildPropList();
  snapScreens();
  applyWindows();
  if (chairPivot && !CHAIR.swivel) chairPivot.rotation.y = THREE.MathUtils.degToRad(CHAIR.angle);
  placeSitter();
  $('boot')?.remove();
  bootProgress('cabin', 1); loadSitter(); loadStation();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, room, earth, post, chairPivot, windows, frame, loadRoom, build, SITTER, placeSitter, getSitter: () => sitter, SEQ, KEYS, ACTS, PARTS, SCREENS, seek, faceCamera, term, BOOT, startPullBack, getStation: () => station, getHangar: () => ({ hangarAt, bayAt, hangarMouth }), playIntro, activateIntro, setLight, holos, getWave: () => waveAction });
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
  if (!windows) return;
  windows.visible = !$('openWindows').checked;
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
function loadSitter() {
  if (sitter || sitterLoading) return;
  sitterLoading = true;
  loader.load('../../models/jacob5.glb', (gltf) => {
    bootProgress('jacob', 1);
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
    // The wave came from Mixamo standing up, so only its upper body is kept, and it is made
    // additive: the arm's movement is laid over the sitting pose instead of replacing it.
    loader.load('../../models/wave_clip.glb', (g) => {
      const src = g.animations[0];
      if (!src) return;
      const upper = /^(Waist|Spine01|Spine02|NeckTwist01|Head|[LR]_(Clavicle|Upperarm|Forearm|Hand))\.quaternion$/;   // turns only: nothing moves or grows
      const wave = new THREE.AnimationClip('wave', src.duration, src.tracks.filter(t => upper.test(t.name)));
      THREE.AnimationUtils.makeClipAdditive(wave);
      waveAction = sitterMixer.clipAction(wave);
      waveAction.setLoop(THREE.LoopOnce, 1); waveAction.clampWhenFinished = true;
      waveAction.enabled = true; waveAction.setEffectiveWeight(0); waveAction.play();
      SEQ.waveLen = wave.duration; bootProgress('clips', 1);
    });
    // standing up (Mixamo, retargeted) and Tripo's own walk; both start silent and the timeline drives them
    loader.load('../../models/stand_up_clip.glb', (g) => {
      const clip = g.animations.find(c => /stand/i.test(c.name)) || g.animations[0];
      if (!clip) return;
      standAction = sitterMixer.clipAction(clip); standAction.setLoop(THREE.LoopOnce, 1); standAction.clampWhenFinished = true;
      standAction.setEffectiveWeight(0); standAction.play(); SEQ.standLen = clip.duration;
    });
    const walk = gltf.animations.find(c => /walk/i.test(c.name));
    if (walk) { walkAction = sitterMixer.clipAction(walk); walkAction.setEffectiveWeight(0); walkAction.play(); }
  }, (e) => { if (e.total) bootProgress('jacob', e.loaded / e.total); }, (e) => console.error(e));
}
// The chair, measured in the holder's own frame so it holds while the chair turns: the seat pan is
// the busiest horizontal slice of the chair's lower half, the backrest is what stands well above
// it, and back-to-seat is the way the chair faces.
let chairInfo = null;
function measureChair() {
  const chair = chairPivot && chairPivot.children.find(c => c.isMesh);
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
  sitter.rotation.y = yaw;
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
  { t: 0.0,  cam: [0.85, 1.30, 1.55], look: 'him',    chair: 0,        face: 0 },   // at the door
  { t: 1.2,  cam: [0.90, 1.30, 1.40], look: 'him',    chair: 0,        face: 0 },   // the beat before he turns
  { t: 2.5,  cam: [1.05, 1.30, 1.05], look: 'him',    chair: 'turned', face: 1 },   // turned, on the camera
  { t: 7.0,  cam: [1.35, 1.30, 0.20], look: 'him',    chair: 'turned', face: 1 },
  { t: 9.5,  cam: [1.10, 1.40, -0.40], look: 'him',   chair: 'turned', face: 0.6 }, // he is up
  { t: 12.0, cam: [0.40, 1.55, -1.00], look: 'window', chair: 'turned', face: 0 },  // over the computer
  { t: 14.0, cam: [0.05, 1.80, -1.75], look: 'window', chair: 'turned', face: 0 },  // through the glass
  // OUTSIDE. The cabin is a room on the ring's underside, its window looking down the station's
  // axis, so past the glass the camera is teleported to just under the ring at its rim, still
  // looking down. It pulls out and away, tilting up as it goes, and the ring's underside sweeps
  // through the top of the frame, turning; a quarter turn later the camera is level, looking at
  // the whole station. It pulls out wide, then pans right to the hangar on that side, closes on
  // its mouth and on the fighter on its deck. Station keys are in the station's own metres.
  { t: 14.01, set: 'station', cam: [770, 580, 0],      look: [150, 620, 0] },       // under the rim, along the underside
  { t: 15.4,  set: 'station', cam: [1040, 430, 290],   look: [350, 600, 0] },       // pulling out: the underside overhead
  { t: 17.5,  set: 'station', cam: [1550, 800, 850],   look: 'station' },           // level, clear of the arms
  { t: 22.0,  set: 'station', cam: [2100, 1250, 1400], look: 'station' },           // wide, from a little above the deck
  { t: 26.0,  set: 'station', cam: { at: 'mouth', out: 900, up: 380, side: 500 }, look: 'hangar' },   // panning right
  { t: 30.0,  set: 'station', cam: { at: 'mouth', out: 260, up: 40 },  look: 'hangar' },              // at the mouth
  { t: 33.0,  set: 'station', cam: { at: 'mouth', out: 60, up: 22 },   look: 'bay' },                 // in, onto the fighter
];
const ACTS = { wave: 1.9, stand: 8.2, walk: 10.0, walkSpeed: 1.1, walkDir: 35 };   // seconds; m/s; degrees from +z toward +x
// The greeting comes in parts: each is its own hologram over his head, which forms, holds, and
// dissolves again as the next one forms.
const PARTS = [
  { start: 2.4, end: 6.2, size: 0.07, lines: ['Welcome To', 'Jconra.com'] },
  { start: 5.8, end: 9.6, size: 0.034, lines: ['Hello! I am Jacob Conrads,', 'a Systems Engineer.', 'This is a project to play around', 'with and highlight my skills.', 'Thank you for visiting!'] },
];
// ── the station outside ──────────────────────────────────────────────────────────
// The second set, 100 km from the cabin in the same scene, built from the kit with its default
// layout (the one set in the Station Builder). Shown only while the timeline is outside.
const STATION_AT = new THREE.Vector3(100000, 0, 0);
let station = null, stationLoading = false, hangarAt = null, bayAt = null, hangarMouth = null, currentSet = 'cabin';
function loadStation() {
  if (station || stationLoading) return;
  stationLoading = true;
  loadKit('../../models/kit/', f => bootProgress('station', f)).then(parts => {
    bootProgress('station', 1);
    station = new StationKit(parts).build(DEFAULT_LAYOUT);
    station.position.copy(STATION_AT); station.visible = false; scene.add(station); checkBoot();
    pickHangar();
  }).catch(e => console.error(e));
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
  const along = new THREE.Vector3(1, 0, 0).transformDirection(best);
  hangarAt = new THREE.Vector3().setFromMatrixPosition(best).add(STATION_AT).addScaledVector(along, (bay.back + bay.mouth) / 2 * u).add(new THREE.Vector3(0, bay.deckY * u, 0));
  hangarMouth = { at: new THREE.Vector3().setFromMatrixPosition(best).add(STATION_AT).addScaledVector(along, bay.mouth * u).add(new THREE.Vector3(0, bay.deckY * u, 0)), dir: along };
  bayAt = station.bayLocal ? new THREE.Vector3().setFromMatrixPosition(best.clone().multiply(station.bayLocal)).add(STATION_AT) : hangarAt.clone();
}
const setOf = (k) => k.set || 'cabin';
function showSet(name) {
  if (name === currentSet) return;
  currentSet = name;
  const inCabin = name === 'cabin';
  room.visible = inCabin; for (const sc of SCREENS) sc.visible = inCabin;
  if (sitter) sitter.visible = inCabin && SITTER.on;
  if (station) station.visible = !inCabin;
  // space light: a hard sun and almost nothing else; the cabin gets its preset back
  spaceFill.intensity = inCabin ? 0 : 1.8;      // earthshine: the planet below lights the undersides blue
  if (inCabin) setLight(lightName);
  if (inCabin) { sun.position.set(2.5, 2.0, -5); sun.target.position.set(0, 0, 0); spaceFill.target.position.set(0, 0, 0); }
  else {
    // aimed at the station, not the cabin: from 100 km away a light aimed at the origin arrives sideways
    sun.position.copy(STATION_AT).add(new THREE.Vector3(1, 0.6, 0.45).multiplyScalar(5000)); sun.target.position.copy(STATION_AT);
    spaceFill.position.copy(STATION_AT).add(new THREE.Vector3(-0.6, -0.8, -0.3).multiplyScalar(5000)); spaceFill.target.position.copy(STATION_AT);
    sun.intensity = 3.2; sun.color.setHex(0xfff4e6); cabin.intensity = 0; screens.intensity = 0;
         ambient.intensity = 0.35; ambient.color.setHex(0x8aa0b8); ambient.groundColor.setHex(0x2a3340); renderer.toneMappingExposure = 1.05; }
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
  const p = new THREE.Vector3(...l); return set === 'station' ? p.add(STATION_AT) : p;
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
  const base = c.at === 'bay' && bayAt ? bayAt.clone() : hangarMouth ? hangarMouth.at.clone() : STATION_AT.clone();
  const dir = hangarMouth ? hangarMouth.dir : new THREE.Vector3(1, 0, 0), right = dir.clone().cross(new THREE.Vector3(0, 1, 0));
  return base.sub(STATION_AT).addScaledVector(dir, c.out || 0).add(new THREE.Vector3(0, c.up || 0, 0)).addScaledVector(right, c.side || 0);
}
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
function seek(T) {
  SEQ.T = T = Math.min(total(), Math.max(0, T));
  const { a, b, u, set } = keysAround(T);
  showSet(set);
  if (set === 'station') {
    // outside: the rings turn with time, 1 g at the rim, and the camera runs in the station's frame
    if (station) for (const sp of station.spinners) sp.turntable.rotation.y = sp.sign * (Math.PI * 2 / StationKit.period(sp.radius)) * T;
    camera.position.copy(cameraAt(T)).add(STATION_AT);
    controls.target.copy(lookPoint(a.look, set).lerp(lookPoint(b.look, set), u)); camera.lookAt(controls.target);
    post.focus = camera.position.distanceTo(controls.target);
    for (const h of holos) h.fill = 0;
    const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
    $('seqTimeOut').textContent = T.toFixed(1) + ' s';
    return;
  }
  // the chair turns key to key, briskly
  chairPivot.rotation.y = THREE.MathUtils.degToRad(chairDeg(a.chair) + (chairDeg(b.chair) - chairDeg(a.chair)) * ease(u));
  // him: sitting until he stands, then up on his feet, then walking off out of the frame
  const standing = T >= ACTS.stand, walking = T >= ACTS.walk;
  if (sitterMixer && sitAction) {
    if (standing) {
      // he is on his own feet now, where the chair left him
      if (sitter.parent !== room) room.add(sitter);
      const at = ACTS.stand, { a: ka, b: kb, u: ku } = keysAround(at);
      const chairThen = THREE.MathUtils.degToRad(chairDeg(ka.chair) + (chairDeg(kb.chair) - chairDeg(ka.chair)) * ease(ku));
      const saved = chairPivot.rotation.y; chairPivot.rotation.y = chairThen; chairPivot.updateMatrixWorld(true);
      const feet = chairPivot.localToWorld(sitter.userData.seatPos.clone()), yaw = sitter.userData.seatYaw + chairThen;
      chairPivot.rotation.y = saved;
      let dirYaw = THREE.MathUtils.degToRad(ACTS.walkDir);
      const w = walking ? Math.min(1, (T - ACTS.walk) / 0.5) : 0;                     // turns to go over the first half second
      const y = yaw + (Math.atan2(Math.sin(dirYaw - yaw), Math.cos(dirYaw - yaw))) * w;
      sitter.position.copy(feet);
      if (walking) sitter.position.add(new THREE.Vector3(Math.sin(dirYaw), 0, Math.cos(dirYaw)).multiplyScalar(ACTS.walkSpeed * Math.max(0, T - ACTS.walk - 0.25)));
      sitter.rotation.y = y;
    } else if (sitter.parent !== chairPivot) { chairPivot.add(sitter); placeSitter(); }
    sitAction.setEffectiveWeight(standing ? 0 : 1); sitAction.time = T % sitAction.getClip().duration;
    if (standAction) { standAction.setEffectiveWeight(standing && !walking ? 1 : 0); standAction.time = Math.min(SEQ.standLen, Math.max(0, T - ACTS.stand)); }
    if (walkAction) { walkAction.setEffectiveWeight(walking ? 1 : 0); walkAction.time = Math.max(0, T - ACTS.walk) % walkAction.getClip().duration; }
    if (waveAction) {
      const w = T - ACTS.wave;
      waveAction.setEffectiveWeight(w >= 0 && !standing ? 1 : 0);
      waveAction.time = Math.min(SEQ.waveLen, Math.max(0, w));
    }
    const headBone = sitter.getObjectByName('Head'); if (headBone && headBone.userData.restQ) headBone.quaternion.copy(headBone.userData.restQ);
    sitterMixer.update(0);
    const model = sitter.children[0], rest = sitter.userData.hipRest, hipBone = model.getObjectByName('Hip');
    if (walking && rest && hipBone) {
      model.updateMatrixWorld(true);
      const now = model.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3()));
      model.position.set(rest.x - now.x, 0, rest.z - now.z);    // the clip's own travel cancelled; he moves by the timeline
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
    if (SEQ.playing) { seek(SEQ.T + dt); if (SEQ.T >= total()) SEQ.playing = false; }
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
  SEQ.playing = false;
  seek(SEQ.T + e.deltaY * 0.0025);
}, { passive: false });
// on a phone there is no wheel: one finger dragged up or down scrubs time the same way, and a
// first swipe starts the intro. While the timeline owns the camera the orbit is idle anyway, so
// the drag is not fighting it.
{
  let lastY = null, id = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary) { lastY = e.clientY; id = e.pointerId; } });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id || lastY === null || !SEQ.scrub || !chairPivot) return;
    const dy = lastY - e.clientY; lastY = e.clientY;
    if (!SEQ.active) { if (Math.abs(dy) < 2) return; activateIntro(); }
    SEQ.playing = false;
    seek(SEQ.T + dy * 0.012);
  });
  const end = (e) => { if (e.pointerId === id) { lastY = null; id = null; } };
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
    const b = document.createElement('button'); b.type = 'button'; b.textContent = (setOf(k) === 'station' ? 'out ' : '') + k.t.toFixed(1) + ' s';
    b.classList.toggle('on', i === keyIndex); b.onclick = () => { keyIndex = i; buildKeyList(); showKey(); seek(KEYS[i].t); };
    list.appendChild(b);
  });
}
function showKey() {
  const k = KEYS[keyIndex]; if (!k) return;
  const set = (id, v) => { const el = $(id); if (!el) return; el.value = v; $(id + 'Out').textContent = SLIDERS[id][1](+v); };
  // the camera sliders span the cabin in metres, or the station in hundreds of them
  const out = setOf(k) === 'station';
  for (const [id, lo, hi] of [['camX', -1.7, 1.7], ['camY', 0.3, 2.5], ['camZ', -2.2, 1.7]]) { const el = $(id); el.min = out ? -2500 : lo; el.max = out ? 2500 : hi; el.step = out ? 5 : 0.01; }
  const cam = Array.isArray(k.cam) ? k.cam : camOf(k).toArray();      // a hangar-relative key shows where it resolves to
  set('keyT', k.t); set('camX', cam[0]); set('camY', cam[1]); set('camZ', cam[2]);
  set('keyChair', chairDeg(k.chair).toFixed(0)); set('keyFace', k.face);
  const look = $('keyLook'); if (look) look.value = typeof k.look === 'string' ? k.look : 'point';
}
function editKey(id, v) {
  const k = KEYS[keyIndex], [field, idx] = KEYFIELDS[id];
  if (field === 'cam') { if (!Array.isArray(k.cam)) k.cam = camOf(k).toArray(); k.cam[idx] = v; } else k[field] = v;   // editing bakes a hangar-relative key
  if (field === 't') { KEYS.sort((x, y) => x.t - y.t); keyIndex = KEYS.indexOf(k); buildKeyList(); $('seqTime').max = total().toFixed(2); }
  if (!SEQ.active) activateIntro();
  SEQ.playing = false; seek(k.t);
}
function addKeyHere() {
  if (!SEQ.active) activateIntro();
  const T = SEQ.T, { a, b, u } = keysAround(T);
  const k = { t: +T.toFixed(2), set: setOf(a), cam: cameraAt(T).toArray().map(x => +x.toFixed(3)), look: a.look,
              chair: +(chairDeg(a.chair) + (chairDeg(b.chair) - chairDeg(a.chair)) * ease(u)).toFixed(1), face: +(a.face + (b.face - a.face) * u).toFixed(2) };
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
    { name: 'bass', file: '../../models/props/bass.glb', x: 1.30, y: 0.45, z: -0.86, yaw: 180, lean: 11, height: 1.15 },
  ],
};
let PROPS = [];
function buildProps(name) {
  for (const pr of PROPS) if (pr.obj) { room.remove(pr.obj); pr.obj.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.map?.dispose(); m.dispose(); }); } }); }
  PROPS = (PROP_SETS[name] || []).map(spec => ({ ...spec, obj: null }));
  PROPS.forEach((pr, i) => loader.load(pr.file, (gltf) => {
    const model = gltf.scene; model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    // stood on its own base, centred, scaled to its real height
    // the model is stood on its base, centred, at one metre tall; the holder's scale sets the real height
    const k = 1 / size.y;
    model.scale.setScalar(k); model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; const m = o.material; if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); } m.envMapIntensity = 0.35; } });
    const holder = new THREE.Group(); holder.add(model); holder.name = 'Prop_' + pr.name;
    pr.obj = holder; room.add(holder); placeProp(pr);
    if (i === propIdx) showProp();
  }, undefined, (e) => console.error(e)));
  buildPropPicker();
}
// the lean tilts the model back about its base, after the yaw, so it rests against whatever is behind it
function placeProp(pr) {
  if (!pr.obj) return;
  pr.obj.position.set(pr.x, pr.y, pr.z);
  pr.obj.rotation.set(0, 0, 0);
  pr.obj.rotateY(THREE.MathUtils.degToRad(pr.yaw)); pr.obj.rotateX(THREE.MathUtils.degToRad(-pr.lean));
  pr.obj.scale.setScalar(pr.height);
}
let propIdx = 0;
const PROPFIELDS = { propX: 'x', propZ: 'z', propY: 'y', propYaw: 'yaw', propLean: 'lean', propH: 'height' };
function buildPropPicker() {
  const list = $('propPick'); if (!list) return;
  list.innerHTML = '';
  PROPS.forEach((pr, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = pr.name; b.classList.toggle('on', i === propIdx); b.onclick = () => { propIdx = i; buildPropPicker(); showProp(); }; list.appendChild(b); });
  if (!PROPS.length) list.innerHTML = '<span class="note">no props in this room yet</span>';
}
function showProp() {
  const pr = PROPS[propIdx]; if (!pr) return;
  for (const [id, key] of Object.entries(PROPFIELDS)) { const el = $(id); if (!el) continue; el.value = pr[key]; $(id + 'Out').textContent = SLIDERS[id][1](+el.value); }
}
function editProp(id, v) { const pr = PROPS[propIdx]; if (!pr) return; pr[PROPFIELDS[id]] = v; placeProp(pr); }

// ── the monitors ────────────────────────────────────────────────────────────────
// Each monitor's face was measured off its mesh: centre, the way it faces, width and height, in
// world metres at 3.4 m across. Every build has its own monitors, so each has its own set; the
// middle one is the site's front page and opens it when tapped.
const SCREEN_SETS = {
  Full: [
    { centre: [-0.026, 1.284, -1.233], normal: [-0.03, 0.077, 0.997], width: 0.562, height: 0.444, kind: 'terminal', href: 'https://jacobconrads.com/about.html' },
    { centre: [-0.655, 1.301, -1.143], normal: [0.308, 0.216, 0.926], width: 0.615, height: 0.463, kind: 'telemetry' },
    { centre: [0.46, 1.279, -1.174], normal: [-0.229, 0.113, 0.967], width: 0.363, height: 0.416, kind: 'orbit' },
  ],
  // the Smart Mesh room: three monitors in a row on the desk under the big window, measured off
  // the monitor bodies (about 0.75 m wide each, screens 0.72 x 0.45 m)
  Smart: [
    { centre: [-0.050, 1.619, -1.360], normal: [-0.001, 0.009, 1.0], width: 0.70, height: 0.44, kind: 'terminal', href: 'https://jacobconrads.com/about.html' },
    { centre: [-0.710, 1.657, -1.360], normal: [0.108, 0.018, 0.994], width: 0.70, height: 0.44, kind: 'telemetry' },
    { centre: [0.684, 1.631, -1.375], normal: [0.032, 0.009, 0.999], width: 0.70, height: 0.44, kind: 'orbit' },
  ],
};
SCREEN_SETS.Light = SCREEN_SETS.Full;
let SCREENS = [];
function buildScreens(name) {
  for (const sc of SCREENS) { scene.remove(sc); sc.geometry.dispose(); sc.material.map.dispose(); sc.material.dispose(); }
  SCREENS = (SCREEN_SETS[name] || SCREEN_SETS.Full).map(spec => new Screen(spec));
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
}
buildScreens(build);
{
  // a tap on a screen that has a link opens it; a drag is the camera, not a tap
  const ray = new THREE.Raycaster(), down = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', e => down.set(e.clientX, e.clientY));
  renderer.domElement.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects(SCREENS, false)[0];
    if (hit && hit.object.href) location.href = hit.object.href;
  });
}

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
  sitHeight:  [v => { SITTER.height = v; placeSitter(); }, v => v + ' cm'],
  sitForward: [v => { SITTER.forward = v; placeSitter(); }, v => v + ' cm'],
  sitTurn:    [v => { SITTER.turn = v; placeSitter(); }, v => v + '°'],
  propX:      [v => editProp('propX', v), v => v.toFixed(2) + ' m'],
  propZ:      [v => editProp('propZ', v), v => v.toFixed(2) + ' m'],
  propY:      [v => editProp('propY', v), v => v.toFixed(2) + ' m'],
  propYaw:    [v => editProp('propYaw', v), v => v.toFixed(0) + '°'],
  propLean:   [v => editProp('propLean', v), v => v.toFixed(0) + '°'],
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
  if (id in KEYFIELDS || id in PROPFIELDS) $(id + 'Out').textContent = fmt(+el.value); else run();   // key and prop sliders read from their object, they do not write it at start
}
$('keyLook').addEventListener('change', e => { const v = e.target.value; KEYS[keyIndex].look = v === 'point' ? controls.target.toArray() : v; seek(KEYS[keyIndex].t); });
$('addKey').onclick = addKeyHere; $('delKey').onclick = deleteKey;
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
const CHECKS = {
  openWindows: () => applyWindows(),
  swivel: e => { CHAIR.swivel = e.target.checked; },
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
  const out = { roomMetres: ROOM_METRES, chair: { ...CHAIR }, sitter: { ...SITTER }, props: PROPS.map(({ obj, ...p }) => p), intro: { keys: KEYS, acts: ACTS, parts: PARTS.map(p => ({ start: p.start, end: p.end })) }, earth: { ...EARTH },
    light: { cabin: cabin.intensity, screens: screens.intensity, sun: sun.intensity, ambient: ambient.intensity, exposure: renderer.toneMappingExposure },
    openWindows: $('openWindows').checked };
  $('out').style.display = 'block'; $('out').value = JSON.stringify(out, null, 2); $('out').select();
  try { navigator.clipboard.writeText($('out').value); } catch (e) {}
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
});

frame('Desk');
loadRoom(build);

// ── loop ────────────────────────────────────────────────────────────────────────
const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, shown = 0;
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
    if (BOOT.phase === 'typed' && term.done) { BOOT.phase = 'hold'; setTimeout(startPullBack, 900); }
    stepPull(dt);
  }
  stepSequence(dt);
  if (!SEQ.active) controls.update();     // while the timeline owns the camera, orbit must not touch it: its 14 m limit would drag it into the station
  if ($('autoFocus').checked) post.focus = camera.position.distanceTo(controls.target);
  post.render(dt);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if ((shown += raw) > 0.5) {
    shown = 0;
    const line = '<b>' + Math.round(fps) + ' fps</b> · ' + renderer.info.render.calls + ' draws · ' +
      (renderer.info.render.triangles / 1000).toFixed(0) + 'k triangles';
    $('hud').innerHTML = line;
    $('fps').innerHTML = line;
  }
});
