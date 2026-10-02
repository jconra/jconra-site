// FOLIAGE LAB: the forest's trees lit as they are now, and lit by the shape of their foliage
// (src/objects/foliage.js), side by side. Both groves are the real Forest (src/objects/forest.js), so
// what shows here is what the Terrain Lab will show, meshes and imposters alike.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { chooseTier } from '../../src/quality.js';
import { Forest, FOREST_SPECIES } from '../../src/objects/forest.js';
import { SHAPE_DEFAULTS } from '../../src/objects/foliage.js';

const $ = (id) => document.getElementById(id);
const KEY = 'jconra.foliageLab';
// QUALITY: drawn only when something changes (or while the far-off versions bake). The potato gets the
// forest's light mode (imposters only, no shadows), as in the Terrain Lab.
const TIER_SET = { potato: { ratio: 0.75, shadow: 1024 }, normal: { ratio: 1.5, shadow: 2048 }, gaming: { ratio: 2, shadow: 4096 } };

// the tier first, on a throwaway context, so the potato's renderer can go without smoothing (it is short of pixels)
const QUAL = (() => { const probe = new THREE.WebGLRenderer(); const q = chooseTier(probe); probe.dispose(); probe.forceContextLoss(); return q; })(), TS = TIER_SET[QUAL.tier], LIGHT = QUAL.tier === 'potato';
// detail: the leaves the Terrain Lab draws on this machine (sparse, coarse on gaming); the sun: about its height
const DEFAULTS = { species: 'pine', detail: QUAL.tier === 'gaming' ? 'coarse' : 'sparse', far: false, ...SHAPE_DEFAULTS, nowSoften: 0.5, sunUp: 48, sunDir: 200 };
let S = { ...DEFAULTS };
try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o) for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === typeof DEFAULTS[k]) S[k] = o[k]; } catch (e) { /* none */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* none */ } };

// ── the scene ─────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: !LIGHT });
renderer.setPixelRatio(Math.min(devicePixelRatio, TS.ratio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = !LIGHT; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), SKY = new THREE.Color(0xb4cde3); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 120, 400);
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x55603a, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = !LIGHT; sun.shadow.mapSize.set(TS.shadow, TS.shadow); Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });   // (both groves and their long shadows)
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.5, 1, 0.3).normalize();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 800);
const controls = new OrbitControls(camera, renderer.domElement); controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1; controls.maxDistance = 300;
let want = true; const redraw = () => { want = true; };
controls.addEventListener('change', redraw);
{ // the ground: grass, toned down
  const t = new THREE.TextureLoader().load('../../textures/ground/grassMed.jpg', redraw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(120, 120); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, color: 0xb8c4a0, roughness: 1 }));
  g.receiveShadow = true; scene.add(g);
}

// ── the two groves ────────────────────────────────────────────────────────────────────────
// each: a tree up front and a close-packed stand behind it, the same places and turns on both sides
const GROVE = [[0, 7, 1.05, 0.3], [-4.5, -1, 0.95, 1.7], [4.2, -1.6, 1.1, 4.1], [0, -5.5, 1.0, 2.6], [-5, -8.5, 1.15, 5.3], [4.6, -9.5, 0.9, 0.9], [-0.4, -12.5, 1.1, 3.4], [-9, -4, 0.9, 2.2], [8.8, -5, 1.0, 5.9]];
const SIDE = 18;                                                       // each grove's middle, this far either side
let now = null, shaped = null, shapeMs = 0;
function speciesFor(shapedOne) {
  const base = FOREST_SPECIES.find((s) => s.name === S.species) || FOREST_SPECIES[3];
  const sp = { ...base, weight: 1, soften: shapedOne ? S.soften : S.nowSoften };
  if (shapedOne) sp.shape = { lump: S.lump, mix: S.mix, dark: S.dark, tip: S.tip, olive: S.olive, branchDark: S.branchDark, under: S.under, glow: S.glow };
  return [sp];
}
function grove(shapedOne) {
  const sx = shapedOne ? SIDE : -SIDE, tint = new THREE.Color().setHSL(0.30, 0.47, 0.71);
  const f = new Forest(renderer, scene, { species: speciesFor(shapedOne), fixed: GROVE.map(([x, z, s, yaw]) => ({ x: x + sx, z, sp: 0, scale: s, yaw, tint })), shadows: !LIGHT, light: LIGHT,
    detail: S.detail, imposterAt: S.far ? 0 : 500, band: 0, sunDir: SUN_DIR, nearCap: 40 });
  return f;
}
const drop = (f) => { if (f) f.dispose(); };                           // a grove gone: off the scene, its draws, atlases and loaded tree freed
let shapeTimer = 0; const pending = new Set();
function rebuild(which) {
  if (which !== 'shaped') { drop(now); now = grove(false); }
  if (which !== 'now') { drop(shaped); shaped = grove(true); shaped.loaded.then(() => { const i = shaped.species[0].shapeInfo; shapeMs = i ? i.ms : 0; showInfo(); }); }
  redraw();
}
function showInfo() {
  $('shapeInfo').textContent = `Worked out in ${shapeMs.toFixed(0)} ms when the tree loads (rays from every leaf corner through the rest of the tree). The far-off versions are baked again after each change.`;
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────
const pct = (v) => Math.round(v * 100) + '%', m = (v) => v.toFixed(1) + ' m';
const compass = (v) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(v / 45) % 8];
const SPEC = {
  secLook: [['species', 'Tree', '', 'select', FOREST_SPECIES.map((s) => [s.name, s.name]), 'both'],
    ['detail', 'Leaf detail', 'the Terrain Lab draws sparse (coarse on gaming)', 'select', [['sparse', 'sparse'], ['coarse', 'coarse'], ['fine', 'fine']], 'both'],
    ['far', 'Show the far-off versions (imposters) instead', '', 'check', null, 'far'],
    ['nowSoften', '"Now": bent toward up', 'as in the Terrain Lab today (50%)', 0, 1, 0.01, pct, 'now']],
  secShape: [['lump', 'Lump size', 'how soft the foliage cloud is: small, each sprig counts on its own; big, branches merge into masses', 0.3, 4, 0.05, m, 'shaped'],
    ['mix', 'Lit from where the sky is', 'how far each card turns from its own facing to the way its light comes from', 0, 1, 0.01, pct, 'shaped'],
    ['dark', 'Dark where it sees no sky', 'under each tier and deep inside', 0, 1, 0.01, pct, 'shaped'],
    ['tip', 'Open sky: lighter and yellower', 'the tops of the tiers', 0, 1, 0.01, pct, 'shaped'],
    ['olive', 'Toward olive', 'all the leaves turned from pure green toward olive', 0, 1, 0.01, pct, 'shaped'],
    ['branchDark', 'Branches darkened too', 'as a share of the leaves\' darkness (bare wood under the foliage goes dark)', 0, 1, 0.01, pct, 'shaped'],
    ['under', 'Darker seen from underneath', 'a sprig you look up at shows its dark side', 0, 1, 0.01, pct, 'shaped'],
    ['glow', 'Sunlight through the leaves', 'the outer leaves glow when you look toward the sun', 0, 1.5, 0.01, pct, 'shaped'],
    ['soften', 'Bent toward up', 'on top; 0: the sky directions alone', 0, 1, 0.01, pct, 'shaped']],
  secLight: [['sunUp', 'Sun height', '', 5, 85, 1, (v) => v + '°', 'light'], ['sunDir', 'Sun from the', '', 0, 359, 1, compass, 'light']],
};
const SHOWS = [];
for (const [sec, rows] of Object.entries(SPEC)) for (const r of rows) {
  const [key, label, help, kind] = r, what = r[r.length - 1], div = document.createElement('div');
  const lab = `<label for="${key}">${label}${help ? `<small>${help}</small>` : ''}</label>`;
  if (kind === 'select') { div.className = 'row'; div.innerHTML = lab + `<select id="${key}">${r[4].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`; }
  else if (kind === 'check') div.innerHTML = `<label class="check" for="${key}"><input id="${key}" type="checkbox"> ${label}</label>`;
  else { div.className = 'row'; div.innerHTML = lab + `<output id="${key}Out"></output><input id="${key}" type="range" min="${r[3]}" max="${r[4]}" step="${r[5]}">`; }
  $(sec).appendChild(div);
  const el = $(key), out = $(key + 'Out'), fmt = r[6];
  SHOWS.push(() => { if (kind === 'check') el.checked = !!S[key]; else { el.value = S[key]; if (out) out.textContent = fmt(+S[key]); } });
  el.addEventListener(kind === 'select' || kind === 'check' ? 'change' : 'input', () => {
    S[key] = kind === 'check' ? el.checked : kind === 'select' ? el.value : +el.value;
    if (out) out.textContent = fmt(+S[key]);
    save(); changed(what);
  });
}
function changed(what) {
  if (what === 'light') applyLight();
  else if (what === 'far') { for (const f of [now, shaped]) if (f) { f.imposterAt = S.far ? 0 : 500; f.assignDirty = true; } redraw(); }
  else {                                                                 // (sliders: once the dragging pauses; whatever is waiting, rebuilt together)
    pending.add(what); clearTimeout(shapeTimer);
    shapeTimer = setTimeout(() => { const w = pending.has('both') || (pending.has('now') && pending.has('shaped')) ? 'both' : [...pending][0]; pending.clear(); rebuild(w); }, what === 'both' ? 0 : 350);
  }
}
const syncPanel = () => SHOWS.forEach((f) => f());
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(S);
  try { await navigator.clipboard.writeText(text); $('copyNote').textContent = 'Copied. Paste it in chat to put these on the Terrain Lab\'s trees.'; }
  catch (e) { $('copyNote').textContent = text; }
});
$('paste').addEventListener('click', async () => {
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the foliage settings here') || ''; }
  let o = null; try { o = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!o || typeof o !== 'object' || !('lump' in o)) { $('copyNote').textContent = "That isn't foliage settings."; return; }
  for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === typeof DEFAULTS[k]) S[k] = o[k];
  syncPanel(); save(); applyLight(); rebuild('both'); $('copyNote').textContent = 'Pasted.';
});
$('reset').addEventListener('click', () => { S = { ...DEFAULTS }; syncPanel(); save(); applyLight(); rebuild('both'); });
$('min').addEventListener('click', () => { const p = $('panel'); p.classList.toggle('min'); $('min').textContent = p.classList.contains('min') ? 'show' : 'hide'; fitView(); });

function applyLight() {
  const el = S.sunUp * Math.PI / 180, az = S.sunDir * Math.PI / 180;
  SUN_DIR.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  for (const f of [now, shaped]) if (f) for (const b of f.built) { const u = b.imposter.material.uniforms; u.sunDir.value.copy(SUN_DIR); const d = b.imposter.customDepthMaterial; if (d && d.uniforms && d.uniforms.viewDirOverride) d.uniforms.viewDirOverride.value.copy(SUN_DIR); }
  redraw();
}

// ── the camera ────────────────────────────────────────────────────────────────────────────
// span: how wide the view must be (m) to hold what it shows; the camera backs off until it fits the screen
const VIEWS = { front: [[0, 9, 46], [0, 9, -2], 62], above: [[0, 52, 30], [0, 0, -3], 62], close: [[SIDE - 4, 10, 20], [SIDE, 10, 6], 0], under: [[0, 1.7, 12], [0, 7, -6], 0] };
function view(k) {
  const [p, t, span] = VIEWS[k], pos = new THREE.Vector3(...p), tgt = new THREE.Vector3(...t);
  if (span) { const d = pos.distanceTo(tgt), hfov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * freeAspect()), need = span / 2 / Math.tan(hfov / 2);
    if (need > d) pos.sub(tgt).multiplyScalar(need / d).add(tgt); }
  camera.position.copy(pos); controls.target.copy(tgt); controls.update(); redraw();
}
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => view(b.dataset.cam)));
// the picture shifted clear of the panel: up above it on a phone, left of it on a wide screen
const panelOpen = () => !$('panel').classList.contains('min'), PANEL = 354;
const freeAspect = () => innerWidth <= 700 ? innerWidth / (innerHeight * (panelOpen() ? 1.5 : 1)) : (innerWidth - (panelOpen() ? PANEL : 0)) / innerHeight;
function fitView() {
  camera.fov = innerWidth < innerHeight ? 64 : 50; camera.aspect = innerWidth / innerHeight;
  if (innerWidth <= 700 && panelOpen()) camera.setViewOffset(innerWidth, innerHeight * 1.5, 0, innerHeight * 0.5, innerWidth, innerHeight);
  else if (innerWidth > 700 && panelOpen()) camera.setViewOffset(innerWidth + PANEL, innerHeight, PANEL, 0, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix(); redraw();
}
const tv = new THREE.Vector3();
function placeTags() {
  for (const [id, x] of [['tagNow', -SIDE], ['tagShaped', SIDE]]) {
    const t = $(id); tv.set(x, 25, 7).project(camera);
    if (tv.z > 1 || Math.abs(tv.x) > 1.1 || Math.abs(tv.y) > 1.1) { t.style.display = 'none'; continue; }
    t.style.display = ''; t.style.left = ((tv.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - tv.y) / 2 * innerHeight) + 'px';
  }
}

// ── go ────────────────────────────────────────────────────────────────────────────────────
syncPanel(); applyLight(); rebuild('both'); fitView(); view('front'); showInfo();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); fitView(); });
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta(), T = controls.target;
  let busy = false;
  for (const f of [now, shaped]) if (f) { const was = f.ready; f.update(camera, T, T, dt); if (!f.ready || f.baking || was !== f.ready) busy = true; if (f.ready && (f.assignDirty || f.lastAtChanged)) busy = true; }
  if (!want && !busy) return;
  want = false;
  sun.target.position.set(T.x, 0, T.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 80);
  renderer.render(scene, camera); placeTags();
  const ready = [now, shaped].every((f) => f && f.ready);
  $('info').textContent = `${QUAL.tier} · ${ready ? `${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k triangles` : 'baking the far-off versions…'}`;
  if (!ready) want = true;
}
frame();
window.__foliage = { apply: (o) => { Object.assign(S, o); syncPanel(); save(); applyLight(); rebuild('both'); }, get S() { return S; }, get now() { return now; }, get shaped() { return shaped; }, view, redraw, renderer, camera, controls };
