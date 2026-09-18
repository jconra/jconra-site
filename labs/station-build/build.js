// STATION BUILDER. The kit of Tripo parts (src/objects/stationKit.js) with the layout controls
// around it: ring size and count, the collar they turn on, the tower, arms, hangars and satellites,
// plus the hull lamps and camera effects from src/fx. Copy layout writes out the numbers the site
// will build from.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadKit, StationKit, DEFAULT_LAYOUT } from '../../src/objects/stationKit.js';
import { Lamps, LAMP_LAYER } from '../../src/fx/lamps.js';
import { Post } from '../../src/fx/post.js';

const Q = new URLSearchParams(location.search);
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
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const $ = (id) => document.getElementById(id);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const FAR = 5e7;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, FAR);
camera.layers.enable(LAMP_LAYER);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 2e5;

// Space light: one hard sun, a faint fill from the planet side, almost no ambient.
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2); sun.position.set(1, 0.6, 0.45); scene.add(sun);
const fill = new THREE.DirectionalLight(0x6f8fb8, 0.55); fill.position.set(-0.6, -0.8, -0.3); scene.add(fill);
const hemi = new THREE.HemisphereLight(0x8aa0b8, 0x0b0e12, 0.25); scene.add(hemi);
if (renderer.capabilities.isWebGL2) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide })));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x3a5a86 }));
    glow.position.set(0, -6, 0); glow.rotation.x = -Math.PI / 2; env.add(glow);
    scene.environment = pmrem.fromScene(env, 0.03).texture; pmrem.dispose();
  } catch (e) { /* the lights carry it */ }
}
{
  const n = 6000, pos = new Float32Array(n * 3), R = 2e7;
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos[i * 3] = R * s * Math.cos(t); pos[i * 3 + 1] = R * u; pos[i * 3 + 2] = R * s * Math.sin(t);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8f0, size: 1.4, sizeAttenuation: false }));
  stars.layers.set(LAMP_LAYER);
  scene.add(stars);
}

const lamps = new Lamps();
const post = new Post(renderer, scene, camera, { far: FAR, sunDirection: sun.position });
post.setSize(innerWidth, innerHeight);
let station = null;

// ── the layout, and the controls that write into it ─────────────────────────────
const layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
const CONTROLS = {
  ringRadius:   [v => layout.ringRadius = v, v => v.toLocaleString() + ' m'],
  rings:        [v => layout.rings = v, v => v],
  ringGap:      [v => layout.ringGap = v, v => v + ' m'],
  ringY:        [v => layout.ringY = v, v => v + ' m'],
  hubCut:       [v => layout.hubCut = v, v => Math.round(v * 100) + '%'],
  collarRadius: [v => layout.collarRadius = v, v => v + ' m'],
  collarLength: [v => layout.collarLength = v, v => v.toLocaleString() + ' m'],
  towerHeight:  [v => layout.towerHeight = v, v => v.toLocaleString() + ' m'],
  ringArmCount: [v => layout.ringArms.count = v, v => v],
  ringArmScale: [v => layout.ringArms.scale = v, v => v + ' m'],
  ringArmInset: [v => layout.ringArms.inset = v, v => v + ' m'],
  ringArmY:     [v => layout.ringArms.y = v, v => v + ' m'],
  ringArmTilt:  [v => layout.ringArms.tilt = v, v => v + '°'],
  armCount:     [v => layout.towerArms.count = v, v => v],
  armRadius:    [v => layout.towerArms.radius = v, v => v + ' m'],
  armY:         [v => layout.towerArms.y = v, v => v + ' m'],
  armScale:     [v => layout.towerArms.scale = v, v => v + ' m'],
  armTilt:      [v => layout.towerArms.tilt = v, v => v + '°'],
  hangarEvery:  [v => layout.hangars.every = v, v => v === 0 ? 'none' : 'every ' + v],
  hangarScale:  [v => layout.hangars.scale = v, v => v + ' m'],
  panelCount:   [v => layout.panels.count = v, v => v],
  panelY:       [v => layout.panels.y = v, v => v + ' m'],
  panelScale:   [v => layout.panels.scale = v, v => v + ' m'],
  panelRadius:  [v => layout.panels.radius = v, v => v === 0 ? 'on the tower' : v + ' m'],
  panelTilt:    [v => layout.panels.tilt = v, v => v + '°'],
  fighterCount:   [v => layout.fighters.count = v, v => v],
  fighterRadius:  [v => layout.fighters.radius = v, v => v + ' m'],
  fighterY:       [v => layout.fighters.y = v, v => v + ' m'],
  fighterScale:   [v => layout.fighters.scale = v, v => v + ' m'],
  freighterCount: [v => layout.freighters.count = v, v => v],
  freighterRadius:[v => layout.freighters.radius = v, v => v + ' m'],
  freighterY:     [v => layout.freighters.y = v, v => v + ' m'],
  freighterScale: [v => layout.freighters.scale = v, v => v + ' m'],
  satCount:     [v => layout.satellites.count = v, v => v],
  satRadius:    [v => layout.satellites.radius = v, v => v.toLocaleString() + ' m'],
  satScale:     [v => layout.satellites.scale = v, v => v + ' m'],
  satSeed:      [v => layout.satellites.seed = v, v => v],
};
let rebuildSoon = null;
function rebuild() {
  if (!station) return;
  station.build(layout);
  lamps.build(station.lampMeshes, +$('lampCount').value);
  lamps.visible = $('lampsOn').checked;
  readout();
}
function queueRebuild() { clearTimeout(rebuildSoon); rebuildSoon = setTimeout(rebuild, 60); }
function readout() {
  const R = layout.ringRadius;
  $('period').textContent = StationKit.period(R).toFixed(0) + ' s';
  $('rim').textContent = StationKit.rimSpeed(R).toFixed(0) + ' m/s';
  $('across').textContent = (R * 2 / 1000).toFixed(2) + ' km';
}
for (const [id, [apply, fmt]] of Object.entries(CONTROLS)) {
  const el = $(id);
  const run = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); queueRebuild(); };
  el.addEventListener('input', run);
  CONTROLS[id].run = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); };
}
$('ringStyle').addEventListener('change', e => { layout.ringStyle = e.target.value; queueRebuild(); });
$('armKind').addEventListener('change', e => { layout.towerArms.kind = e.target.value; queueRebuild(); });
$('ringArmKind').addEventListener('change', e => { layout.ringArms.kind = e.target.value; queueRebuild(); });
$('collar').addEventListener('change', e => { layout.collar = e.target.checked; queueRebuild(); });
$('collarAuto').addEventListener('change', e => {
  layout.collarAuto = e.target.checked;
  $('collarRadius').disabled = $('collarLength').disabled = e.target.checked;
  queueRebuild();
});
layout.collarAuto = true;
$('collarRadius').disabled = $('collarLength').disabled = true;
$('spin').addEventListener('change', e => { layout.spin = e.target.checked; });
$('speed').addEventListener('input', e => { layout.timeScale = +e.target.value; $('speedOut').textContent = e.target.value + '×'; });

// ── lamps and camera effects ────────────────────────────────────────────────────
const FX = {
  post:      [v => post.enabled = v],
  lampsOn:   [v => lamps.visible = v],
  lampCount: [v => { if (station) lamps.build(station.lampMeshes, v); lamps.visible = $('lampsOn').checked; }, v => v],
  lampSize:  [v => lamps.uniforms.uSize.value = v, v => v.toFixed(1) + ' m'],
  lampGlow:  [v => lamps.uniforms.uIntensity.value = v, v => v.toFixed(1) + '×'],
  bloomOn:   [v => post.bloom.enabled = v],
  bloomStr:  [v => post.bloom.strength = v, v => v.toFixed(2)],
  dofOn:     [v => post.dof.enabled = v],
  dofBlur:   [v => post.dof.uniforms.uBlur.value = v, v => v.toFixed(1) + ' px'],
  flareOn:   [v => post.flare.enabled = v],
  flareStr:  [v => post.flare.uniforms.uStrength.value = v, v => v.toFixed(2)],
  vignette:  [v => post.finish.uniforms.uVignette.value = v, v => v.toFixed(2)],
  grain:     [v => post.finish.uniforms.uGrain.value = v, v => v.toFixed(2)],
  exposure:  [v => renderer.toneMappingExposure = v, v => v.toFixed(2)],
};
for (const [id, [apply, fmt]] of Object.entries(FX)) {
  const el = $(id), isBox = el.type === 'checkbox';
  const run = () => { const v = isBox ? el.checked : +el.value; apply(v); if (fmt && $(id + 'Out')) $(id + 'Out').textContent = fmt(v); };
  el.addEventListener(isBox ? 'change' : (id === 'lampCount' ? 'change' : 'input'), run);
  FX[id].run = run;
}
$('fxInfo').textContent = post.info;

// ── camera ──────────────────────────────────────────────────────────────────────
const CAMS = {
  'Whole station': () => [[layout.ringRadius * 2.2, layout.ringRadius * 1.1, layout.ringRadius * 2.2], [0, 0, 0]],
  'Along the axis': () => [[0, layout.towerHeight * 0.9, layout.ringRadius * 0.05], [0, 0, 0]],
  'Ring, close':    () => [[layout.ringRadius * 1.02, layout.ringY + 70, 90], [layout.ringRadius * 0.9, layout.ringY, 0]],
  'Hangar':         () => { const r = layout.towerArms.radius + layout.towerArms.scale / 2 + layout.hangars.scale * 0.45;
                            return [[r + 300, layout.towerArms.y + 110, 220], [r, layout.towerArms.y, 0]]; },
  'Tower base':     () => [[420, -layout.towerHeight * 0.42, 420], [0, -layout.towerHeight * 0.42, 0]],
};
function go(name) {
  const [p, t] = CAMS[name]();
  camera.position.set(...p); controls.target.set(...t); controls.update();
  post.focus = camera.position.distanceTo(controls.target);
}
for (const name of Object.keys(CAMS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => go(name); $('cams').appendChild(b);
}
// click the station to focus the depth of field there
const ray = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || !station || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObject(station, true)[0];
  if (hit) { post.focus = hit.distance; $('autoFocus').checked = false; }
});

$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };
$('copy').onclick = () => {
  $('out').style.display = 'block';
  $('out').value = JSON.stringify(layout, null, 2);
  $('out').select();
  try { navigator.clipboard.writeText($('out').value); } catch (e) {}
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight);
});

// ── go ──────────────────────────────────────────────────────────────────────────
loadKit('../../models/kit/', (f) => { $('pct').textContent = Math.round(f * 100) + '%'; })
  .then(parts => {
    station = new StationKit(parts);
    scene.add(station);
    for (const c of Object.values(CONTROLS)) c.run();
    for (const f of Object.values(FX)) f.run();
    rebuild();
    go('Whole station');
    $('boot').remove();
    if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, station, lamps, post, layout, go, rebuild });
  })
  .catch(e => { $('boot').textContent = 'LOAD FAILED — ' + e.message; });

const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, shown = 0;
renderer.info.autoReset = false;
renderer.setAnimationLoop(() => {
  renderer.info.reset();
  clock.update?.();
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  station?.update(dt);
  controls.update();
  lamps.update(dt, innerHeight * renderer.getPixelRatio());
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
