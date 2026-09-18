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

// ── light ───────────────────────────────────────────────────────────────────────
// A cabin is lit by its own strip lights and screens, with hard sunlight through the window.
// The window wall is -z, so the sun comes from out there and the desk screens glow against it.
const cabin = new THREE.PointLight(0xdfe9f5, 6, 12, 1.6); cabin.position.set(0, 2.2, 0.1); scene.add(cabin);
const screens = new THREE.PointLight(0x7fb4ff, 3, 6, 2); screens.position.set(0, 1.35, -1.05); scene.add(screens);
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6); sun.position.set(2.5, 2.0, -5); scene.add(sun);
const ambient = new THREE.HemisphereLight(0x9fb6cc, 0x20262d, 0.45); scene.add(ambient);

// ── Earth outside ───────────────────────────────────────────────────────────────
const earth = new Earth({ radius: 6371000 });
scene.add(earth);
const EARTH = { altitude: 420000, spin: 0.35, tilt: 18, glow: 1 };
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
// flat sheet is edge-on and invisible, so it hangs below and outside, tilted to face the window.
picture.position.set(0, -150, -600);                               // about 14 degrees below the window's line of sight
picture.rotation.x = -(Math.PI / 2 - Math.atan2(150, 600));
scene.add(picture);
let earthMode = 'Picture';
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
};
let build = 'Light';
const loader = new GLTFLoader();
function loadRoom(name) {
  build = name;
  document.querySelectorAll('#builds button').forEach(b => b.classList.toggle('on', b.textContent === name));
  $('buildNote').textContent = BUILDS[name].note;
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
  const scale = ROOM_METRES / Math.max(size.x, size.z);
  // stand the room on the floor, centred on the room's middle
  model.scale.setScalar(scale);
  model.position.set(-box.min.x * scale - (size.x * scale) / 2, -box.min.y * scale, -box.min.z * scale - (size.z * scale) / 2);
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
  applyWindows();
  if (chairPivot && !CHAIR.swivel) chairPivot.rotation.y = THREE.MathUtils.degToRad(CHAIR.angle);
  placeSitter();
  $('boot')?.remove();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, room, earth, post, chairPivot, windows, frame, loadRoom, build, SITTER, placeSitter, getSitter: () => sitter, SEQ, seek, playIntro, activateIntro, setLight, holo, placeHolo, getWave: () => waveAction });
  }, (e) => { const pct = $('pct'); if (pct && e.total) pct.textContent = Math.round(e.loaded / e.total * 100) + '%'; },
     (e) => { console.error(e); const boot = $('boot'); if (boot) boot.textContent = 'LOAD FAILED — ' + e.message; });
}
for (const mode of ['Globe', 'Picture']) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = mode; b.onclick = () => setEarthMode(mode); $('earthMode').appendChild(b);
}
setEarthMode(earthMode);
for (const name of Object.keys(BUILDS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => loadRoom(name); $('builds').appendChild(b);
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
let sitter = null, sitterMixer = null, sitterLoading = false, sitAction = null, waveAction = null;
function loadSitter() {
  if (sitter || sitterLoading) return;
  sitterLoading = true;
  loader.load('../../models/jacob5.glb', (gltf) => {
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
    sitterMixer = new THREE.AnimationMixer(model);
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
      SEQ.waveLen = wave.duration;
    });
  }, undefined, (e) => console.error(e));
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
    if (t > 0.2 && t < 0.5) { const k = Math.round(q.y / slice); count.set(k, (count.get(k) || 0) + 1); }
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
  sitter.visible = SITTER.on;
}

// ── the intro, as a timeline ──────────────────────────────────────────────────────
// The site's first shot: he is at the desk with his back to the door, someone comes in, and he
// turns the chair round to see who, waves, and a greeting forms beside him. Everything is a
// function of one time T, so it plays forward on its own or scrubs either way with the wheel.
const SEQ = { hold: 0.9, turn: 1.1, draw: 1.8, waveLead: 0.3, waveLen: 1.5,
              T: 0, playing: false, active: false, scrub: true, from: 0, to: 0,
              camera: [[0.85, 1.55, 1.5], [-0.15, 1.05, -0.35]] };      // just inside the door
const total = () => Math.max(SEQ.hold + SEQ.turn + SEQ.draw, SEQ.hold + SEQ.turn - SEQ.waveLead + SEQ.waveLen);
function activateIntro() {
  if (!chairPivot) return;
  if (!chairInfo) chairInfo = measureChair();
  $('swivel').checked = false; CHAIR.swivel = false;
  SEQ.active = true;
  const [p, t] = SEQ.camera;
  camera.position.set(...p); controls.target.set(...t); controls.update();
  post.focus = camera.position.distanceTo(controls.target);
  // the holder's turn that brings the chair's own facing round to the camera, the short way
  const cw = chairPivot.getWorldPosition(new THREE.Vector3());
  let want = Math.atan2(camera.position.x - cw.x, camera.position.z - cw.z) - (chairInfo ? chairInfo.facing : 0);
  SEQ.from = 0; SEQ.to = Math.atan2(Math.sin(want), Math.cos(want));
  placeHolo();
  $('seqTime').max = total().toFixed(2);
}
function playIntro() { activateIntro(); SEQ.T = 0; SEQ.playing = true; seek(0); }
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * u * (u * (u * 6 - 15) + 10); };   // brisk both ends
function seek(T) {
  SEQ.T = T = Math.min(total(), Math.max(0, T));
  chairPivot.rotation.y = SEQ.from + (SEQ.to - SEQ.from) * ease((T - SEQ.hold) / SEQ.turn);
  holo.fill = Math.min(1, Math.max(0, (T - SEQ.hold - SEQ.turn) / SEQ.draw));
  if (sitterMixer && sitAction) {
    sitAction.time = T % sitAction.getClip().duration;
    if (waveAction) {
      const w = T - (SEQ.hold + SEQ.turn - SEQ.waveLead);
      waveAction.setEffectiveWeight(w >= 0 ? 1 : 0);
      waveAction.time = Math.min(SEQ.waveLen, Math.max(0, w));
    }
    sitterMixer.update(0);
  }
  const el = $('seqTime'); if (el && document.activeElement !== el) el.value = T.toFixed(2);
  $('seqTimeOut').textContent = T.toFixed(1) + ' s';
}
function stepSequence(dt) {
  if (SEQ.active) {
    if (SEQ.playing) { seek(SEQ.T + dt); if (SEQ.T >= total()) SEQ.playing = false; }
  } else {
    if (chairPivot && CHAIR.swivel) chairPivot.rotation.y += THREE.MathUtils.degToRad(CHAIR.speed) * dt;
    if (sitterMixer) sitterMixer.update(dt);
  }
  holo.update(dt);
}
// the wheel scrubs time instead of zooming, when that is switched on; a first scroll starts the intro
renderer.domElement.addEventListener('wheel', (e) => {
  if (!SEQ.scrub || !chairPivot) return;
  e.preventDefault();
  if (!SEQ.active) activateIntro();
  SEQ.playing = false;
  seek(SEQ.T + e.deltaY * 0.0025);
}, { passive: false });

// The greeting is a hologram over his head: lines of letters that draw in as a wireframe and then
// fill in, stood a little toward the door and turned to face whoever came in. Over his head rather
// than beside him because it has to fit a phone held upright, and beside him it either runs off
// the edge or ends up behind his head.
const holo = new Hologram({ lines: ['HEY, YOU FOUND', 'MY STATION'], size: 0.055 });
scene.add(holo);
function placeHolo() {
  if (!chairPivot) return;
  const cw = chairPivot.getWorldPosition(new THREE.Vector3());
  const toCam = new THREE.Vector3(camera.position.x - cw.x, 0, camera.position.z - cw.z).normalize();
  holo.position.copy(cw).addScaledVector(toCam, 0.25);
  holo.position.y = 1.64;
  holo.rotation.y = Math.atan2(toCam.x, toCam.z);
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

// ── camera views, in metres inside the cabin ────────────────────────────────────
const VIEWS = {
  'Desk':       [[0.20, 1.55, 0.75], [0.10, 1.55, -1.55]],
  'Window':     [[0.10, 1.75, -0.15], [0.05, 1.80, -1.62]],
  'Chair':      [[-1.05, 1.45, 0.55], [0.25, 1.05, -0.45]],
  'Whole room': [[2.4, 2.5, 2.7], [0, 1.15, -0.6]],
};
function frame(name) {
  const [p, t] = VIEWS[name];
  camera.position.set(...p); controls.target.set(...t); controls.update();
  post.focus = camera.position.distanceTo(controls.target);
}
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
  introHold:  [v => SEQ.hold = v, v => v.toFixed(1) + ' s'],
  introTurn:  [v => SEQ.turn = v, v => v.toFixed(1) + ' s'],
  holoTime:   [v => SEQ.draw = v, v => v.toFixed(1) + ' s'],
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
  el.addEventListener('input', run); run();
}
// Flat is the default. The face's colour map already carries light and shade, painted in by Tripo,
// and a strong key lays a second set of shadows over it that disagree with the first. Soft light
// from everywhere leaves the painted light to do the work; the cabin's own look is kept as Cabin.
const LIGHT_PRESETS = {
  Flat:  { cabinLight: 2.0, screenLight: 1.0, sunLight: 0.5, ambient: 2.2, exposure: 1.0, sky: 0xffffff, ground: 0xb8b8b8 },
  Cabin: { cabinLight: 6,   screenLight: 3,   sunLight: 2.6, ambient: 0.45, exposure: 1.1, sky: 0x9fb6cc, ground: 0x20262d },
};
function setLight(name) {
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
  const out = { roomMetres: ROOM_METRES, chair: { ...CHAIR }, sitter: { ...SITTER }, intro: { hold: SEQ.hold, turn: SEQ.turn, hologram: SEQ.draw, waveLead: SEQ.waveLead }, earth: { ...EARTH },
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
  stepSequence(dt);
  controls.update();
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
