// STATION LAB. The real station module with sliders around it: nothing here is copied from src/.
// Shared by two pages: labs/station (three 0.158, WebGL1) and labs/station-next (three 0.186, WebGL2).
// Each page's import map decides which three.js this module and src/ get.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Station, RING_RADIUS_UNITS } from '../../src/objects/station.js';
import { Lamps, LAMP_LAYER } from '../../src/fx/lamps.js';
import { Post } from '../../src/fx/post.js';

const Q = new URLSearchParams(location.search);
// The 0.158 page asks for WebGL1 on purpose (data-gl="1"), so the two pages show the difference.
const FORCE_GL1 = document.body.dataset.gl === '1' && !Q.has('gl2');
let renderer;
if (FORCE_GL1) {
  const cv = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas: cv, context: cv.getContext('webgl', { antialias:true }), logarithmicDepthBuffer:true });
} else {
  renderer = new THREE.WebGLRenderer({ antialias:true, logarithmicDepthBuffer:true });
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const FAR = 5e7;
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.5, FAR);
camera.layers.enable(LAMP_LAYER);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Space light: one hard sun, a faint blue fill from the planet side, almost no ambient.
const sun = new THREE.DirectionalLight(0xfff4e6, 3.2); sun.position.set(1, 0.6, 0.45); scene.add(sun);
const fill = new THREE.DirectionalLight(0x6f8fb8, 0.55); fill.position.set(-0.6, -0.8, -0.3); scene.add(fill);
scene.add(new THREE.HemisphereLight(0x8aa0b8, 0x0b0e12, 0.25));
if (renderer.capabilities.isWebGL2) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color:0x05070a, side:THREE.BackSide })));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color:0x3a5a86 }));
    glow.position.set(0, -6, 0); glow.rotation.x = -Math.PI/2; env.add(glow);
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color:0xfff0d8 }));
    lamp.position.set(6, 4, 3); lamp.lookAt(0, 0, 0); env.add(lamp);
    scene.environment = pmrem.fromScene(env, 0.03).texture; pmrem.dispose();
  } catch (e) { /* lights carry it */ }
}

// Stars on a far sphere.
{
  const n = 6000, pos = new Float32Array(n * 3), R = 2e7;
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos[i*3] = R * s * Math.cos(t); pos[i*3+1] = R * u; pos[i*3+2] = R * s * Math.sin(t);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color:0xdfe8f0, size:1.4, sizeAttenuation:false }));
  stars.layers.set(LAMP_LAYER);          // out of the depth pass, so the sky reads as open sky behind the sun
  scene.add(stars);
}

const station = new Station({ renderer });
scene.add(station);
const lamps = new Lamps();
const post = new Post(renderer, scene, camera, { far: FAR, sunDirection: sun.position });
post.setSize(innerWidth, innerHeight);
const $ = (id) => document.getElementById(id);

// ── camera presets, in metres, derived from the ring radius ─────────────────────
const U = () => station.ringRadius / RING_RADIUS_UNITS;      // metres per model unit
// The close shots find the hull by casting a ray straight down onto it, then stand off the surface by a
// fixed number of METRES - so they are genuinely close whatever size the station is set to, which is
// exactly where a stretched texture shows and where the layered material has to earn its keep.
const ray = new THREE.Raycaster();
function surfaceBelow(xUnits, zUnits) {
  ray.set(new THREE.Vector3(xUnits * U(), U() * 2, zUnits * U()), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(station, true)[0];
  return hit ? hit.point : null;
}
function standOff(point, up, out, side) {
  return [[point.x + side, point.y + up, point.z + out], [point.x, point.y, point.z]];
}
const CAMS = {
  'Whole station': () => [[U()*1.25, U()*0.95, U()*1.35], [0, U()*0.45, 0]],
  'Ring, 30 m':    () => { const p = surfaceBelow(0.0, -0.153) || new THREE.Vector3(0, U()*0.53, -U()*0.153); return standOff(p, 14, -22, 18); },
  'Arm, 30 m':     () => { const p = surfaceBelow(0.30, 0.0) || new THREE.Vector3(U()*0.3, U()*0.5, 0); return standOff(p, 16, 20, 14); },
  'Hub deck, 60 m':() => { const p = surfaceBelow(0.04, 0.05) || new THREE.Vector3(0, U()*0.6, 0); return standOff(p, 35, 45, 20); },
};
function go(name) {
  const [p, t] = CAMS[name]();
  camera.position.set(...p); controls.target.set(...t); controls.update();
}
for (const name of Object.keys(CAMS)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => go(name); $('cams').appendChild(b);
}

// ── controls ────────────────────────────────────────────────────────────────────
const U_ = station.uniforms;
const SLIDERS = {
  tile:      [v => U_.uTileMeters.value = v, v => v + ' m'],
  paint:     [v => U_.uPaint.value = v, v => v.toFixed(2)],
  detail:    [v => U_.uDetail.value = v, v => v.toFixed(2)],
  grime:     [v => U_.uGrime.value = v, v => v.toFixed(2)],
  dirtScale: [v => U_.uDirtScale.value = v, v => v],
  grate:     [v => U_.uGrateAmount.value = 1 - v, v => Math.round(v * 100) + '%'],
  metal:     [v => station.parts.forEach(m => m.material.metalness = v), v => v.toFixed(2)],
  rough:     [v => station.parts.forEach(m => m.material.roughness = v), v => v.toFixed(2)],
  speed:     [v => station.timeScale = v, v => v + '×'],
};
for (const [id, [apply, fmt]] of Object.entries(SLIDERS)) {
  const run = () => { const v = +$(id).value; apply(v); $(id + 'Out').textContent = fmt(v); };
  $(id).addEventListener('input', run); run.bind(null);
  SLIDERS[id].run = run;
}
function radius() {
  const r = +$('radius').value, prev = station.ringRadius;
  station.setRingRadius(r);
  // keep the view where it was, relative to the station's new size
  const k = r / prev; camera.position.multiplyScalar(k); controls.target.multiplyScalar(k); controls.update();
  $('radiusOut').textContent = r.toLocaleString() + ' m';
  $('period').textContent = station.period.toFixed(0) + ' s';
  $('rim').textContent = station.rimSpeed.toFixed(0) + ' m/s';
  $('span').textContent = (0.97 * U() / 1000).toFixed(1) + ' km';
}
$('radius').addEventListener('input', radius);
$('spin').addEventListener('change', () => station.spinning = $('spin').checked);
$('layer').addEventListener('change', () => U_.uLayerOn.value = $('layer').checked ? 1 : 0);
$('hash').addEventListener('change', () => U_.uHash.value = $('hash').checked ? 1 : 0);
const GREEN = new THREE.Color(0x0e4a26), BLACK = new THREE.Color(0);
function tint() { station.parts.forEach((m, n) => m.material.emissive.copy($('tint').checked && station.isSpinning(n) ? GREEN : BLACK)); }
$('tint').addEventListener('change', tint);
$('min').addEventListener('click', () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; });
$('copy').addEventListener('click', () => {
  const settings = {
    ringRadius: station.ringRadius,
    spinning: [...station.parts.keys()].filter(n => station.isSpinning(n)).sort((a, b) => a - b),
    tileMeters: U_.uTileMeters.value, paint: U_.uPaint.value, detail: U_.uDetail.value, grime: U_.uGrime.value,
    dirtScale: U_.uDirtScale.value, grateAmount: +(U_.uGrateAmount.value).toFixed(2),
    metalness: +$('metal').value, roughness: +$('rough').value,
    look: Object.fromEntries(Object.keys(FX).map(id => [id, $(id).type === 'checkbox' ? $(id).checked : +$(id).value])),
  };
  $('out').style.display = 'block'; $('out').value = JSON.stringify(settings, null, 2); $('out').select();
  try { navigator.clipboard.writeText($('out').value); } catch (e) {}
});

addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight); });

// ── the cinematic look ──────────────────────────────────────────────────────────
// Every control here drives src/fx; the numbers they land on are what the site will use.
const FX = {
  post:      [v => post.enabled = v],
  lampsOn:   [v => lamps.visible = v],
  lampCount: [v => { if (station.parts.size) lamps.build([...station.parts.values()], v); lamps.visible = $('lampsOn').checked; }, v => v],
  lampSize:  [v => lamps.uniforms.uSize.value = v, v => v.toFixed(1) + ' m'],
  lampGlow:  [v => lamps.uniforms.uIntensity.value = v, v => v.toFixed(1) + '×'],
  lampHalo:  [v => lamps.uniforms.uHalo.value = v, v => v.toFixed(2)],
  bloomOn:   [v => post.bloom.enabled = v],
  bloomStr:  [v => post.bloom.strength = v, v => v.toFixed(2)],
  bloomRad:  [v => post.bloom.radius = v, v => v.toFixed(2)],
  bloomCut:  [v => post.bloom.threshold = v, v => v.toFixed(2)],
  dofOn:     [v => post.dof.enabled = v],
  dofBlur:   [v => post.dof.uniforms.uBlur.value = v, v => v.toFixed(1) + ' px'],
  dofMax:    [v => post.dof.uniforms.uMaxPx.value = v, v => v + ' px'],
  autoFocus: [v => {}],
  flareOn:   [v => post.flare.enabled = v],
  flareStr:  [v => post.flare.uniforms.uStrength.value = v, v => v.toFixed(2)],
  ghosts:    [v => post.flare.uniforms.uGhosts.value = v, v => v.toFixed(2)],
  streak:    [v => post.flare.uniforms.uStreak.value = v, v => v.toFixed(2)],
  vignette:  [v => post.finish.uniforms.uVignette.value = v, v => v.toFixed(2)],
  grain:     [v => post.finish.uniforms.uGrain.value = v, v => v.toFixed(2)],
  fringe:    [v => post.finish.uniforms.uFringe.value = v, v => v.toFixed(2)],
  exposure:  [v => renderer.toneMappingExposure = v, v => v.toFixed(2)],
};
for (const [id, [apply, fmt]] of Object.entries(FX)) {
  const el = $(id), isBox = el.type === 'checkbox';
  const run = () => { const v = isBox ? el.checked : +el.value; apply(v); if (fmt && $(id + 'Out')) $(id + 'Out').textContent = fmt(v); };
  el.addEventListener(isBox ? 'change' : (id === 'lampCount' ? 'change' : 'input'), run);
  FX[id].run = run;
}
$('fxInfo').textContent = post.info;

// FOCUS. Clicking the station focuses there (and turns off follow-the-orbit-centre); a drag to orbit
// does not count as a click.
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const ndc = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(station, true)[0];
  if (!hit) return;
  post.focus = hit.distance; $('autoFocus').checked = false;
});

// ── load ────────────────────────────────────────────────────────────────────────
station.load('../../models/station_tripo.glb', (e) => { if (e.total) $('pct').textContent = Math.round(e.loaded / e.total * 100) + '%'; })
.then(() => {
  const list = $('parts');
  [...station.parts.keys()].sort((a, b) => a - b).forEach((n) => {
    const l = document.createElement('label'); l.htmlFor = 'part' + n;
    l.innerHTML = `<input type="checkbox" id="part${n}"${station.isSpinning(n) ? ' checked' : ''}> P${n}`;
    l.querySelector('input').addEventListener('change', (e) => { station.setSpinning(n, e.target.checked); tint(); });
    list.appendChild(l);
  });
  for (const s of Object.values(SLIDERS)) s.run();
  for (const f of Object.values(FX)) f.run();
  radius(); go('Whole station');
  $('boot').remove();
  if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, renderer, station, go, post, lamps });
})
.catch((e) => { $('boot').textContent = 'LOAD FAILED — ' + e.message; });

// THREE.Clock is deprecated in 0.186 in favour of THREE.Timer, which 0.158 does not have.
const clock = THREE.Timer ? new THREE.Timer() : new THREE.Clock();
let fps = 60, fpsShown = 0;
renderer.info.autoReset = false;                  // count every pass in the frame, not just the last
renderer.setAnimationLoop(() => {
  renderer.info.reset();
  clock.update?.();
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1);
  station.update(dt);
  controls.update();
  lamps.update(dt, innerHeight * renderer.getPixelRatio());
  if ($('autoFocus').checked) post.focus = camera.position.distanceTo(controls.target);
  post.render(dt);
  if (raw > 0) fps += (1 / raw - fps) * 0.05;
  if ((fpsShown += raw) > 0.5) { fpsShown = 0; $('fps').textContent = Math.round(fps) + ' fps · ' + renderer.info.render.calls + ' draws · focus ' + Math.round(post.focus) + ' m'; }
});
