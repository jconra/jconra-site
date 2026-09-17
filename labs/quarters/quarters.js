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

const post = new Post(renderer, scene, camera, { far: FAR, sunDirection: sun.position });
post.setSize(innerWidth, innerHeight);

// ── the room ────────────────────────────────────────────────────────────────────
const room = new THREE.Group();
scene.add(room);
let windows = null, chairPivot = null, props = [];
const CHAIR = { swivel: true, speed: 12, angle: 0 };

new GLTFLoader().load('../../models/quarters.glb', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = ROOM_METRES / Math.max(size.x, size.z);
  // stand the room on the floor, centred on the room's middle
  model.scale.setScalar(scale);
  model.position.set(-box.min.x * scale - (size.x * scale) / 2, -box.min.y * scale, -box.min.z * scale - (size.z * scale) / 2);
  room.add(model);

  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
      m.envMapIntensity = 0.4;
    }
    if (/^Windows/.test(o.name)) windows = o;
    else if (/^Chair/.test(o.name)) {
      // spin the chair about its own axis: a holder at the seat's centre, on the floor
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
      chairPivot = new THREE.Group();
      chairPivot.position.set(c.x, b.min.y, c.z);
      o.parent.add(chairPivot); chairPivot.attach(o);
    } else props.push(o);
  });
  buildPropList();
  applyWindows();
  frame('Desk');
  $('boot').remove();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, room, earth, post, chairPivot, windows, frame });
}, (e) => { if (e.total) $('pct').textContent = Math.round(e.loaded / e.total * 100) + '%'; },
   (e) => { $('boot').textContent = 'LOAD FAILED — ' + e.message; });

function applyWindows() {
  if (!windows) return;
  windows.visible = !$('openWindows').checked;
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
const CHECKS = {
  openWindows: () => applyWindows(),
  swivel: e => { CHAIR.swivel = e.target.checked; },
  post: e => { post.enabled = e.target.checked; },
  bloomOn: e => { post.bloom.enabled = e.target.checked; },
  dofOn: e => { post.dof.enabled = e.target.checked; },
  flareOn: e => { post.flare.enabled = e.target.checked; },
};
for (const [id, fn] of Object.entries(CHECKS)) { $(id).addEventListener('change', fn); fn({ target: $(id) }); }
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };
$('copy').onclick = () => {
  const out = { roomMetres: ROOM_METRES, chair: { ...CHAIR }, earth: { ...EARTH },
    light: { cabin: cabin.intensity, screens: screens.intensity, sun: sun.intensity, ambient: ambient.intensity, exposure: renderer.toneMappingExposure },
    openWindows: $('openWindows').checked };
  $('out').style.display = 'block'; $('out').value = JSON.stringify(out, null, 2); $('out').select();
  try { navigator.clipboard.writeText($('out').value); } catch (e) {}
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
});

// ── loop ────────────────────────────────────────────────────────────────────────
const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, shown = 0;
renderer.info.autoReset = false;
renderer.setAnimationLoop(() => {
  renderer.info.reset();
  clock.update?.();
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  earth.update(dt);
  if (chairPivot && CHAIR.swivel) chairPivot.rotation.y += THREE.MathUtils.degToRad(CHAIR.speed) * dt;
  controls.update();
  if ($('autoFocus').checked) post.focus = camera.position.distanceTo(controls.target);
  post.render(dt);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if ((shown += raw) > 0.5) {
    shown = 0;
    $('fps').textContent = Math.round(fps) + ' fps · ' + renderer.info.render.calls + ' draws · ' +
      (renderer.info.render.triangles / 1000).toFixed(0) + 'k triangles';
  }
});
