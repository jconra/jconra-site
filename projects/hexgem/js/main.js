// Entry: renderer, camera rig, input (mouse, touch, keyboard), overlays and the main loop.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { GemArt } from './gems.js';
import { EnemyArt } from './enemies.js';
import { FX } from './fx.js';
import { Game, gemStats } from './game.js';
import { UI } from './ui.js';
import { fromWorld, toWorld, inGrid, HEX_R, GRID_BOUNDS, key } from './hex.js';
import { RANGE_PER_HEX, SPECIALS, GEM_TYPES } from './data.js';
import { unlockAudio, isMuted, setMuted } from './audio.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const touchDevice = matchMedia('(pointer: coarse)').matches;

// ---------- renderer ----------
const canvas = document.getElementById('c');
// Pick the context ourselves: three.js console.errors when WebGL2 is missing, which would
// trip the on-screen error overlay on WebGL1-only machines.
const ctxOpts = { antialias: true, preserveDrawingBuffer: TEST, powerPreference: 'high-performance' };
const context = (!params.has('webgl1') && canvas.getContext('webgl2', ctxOpts)) || canvas.getContext('webgl', ctxOpts);
const renderer = new THREE.WebGLRenderer({ canvas, context, ...ctxOpts });
const isWebGL2 = renderer.capabilities.isWebGL2;
let gfxHigh = isWebGL2;
try { const s = localStorage.getItem('hexgem.gfx'); if (s) gfxHigh = s === 'high'; } catch (e) { /* storage blocked */ }
if (params.has('low')) gfxHigh = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);

// ---------- world ----------
const world = new World(scene, { low: !gfxHigh });
const gemArt = new GemArt(world.glowTex, world.stoneTex, world.rockTex);
const enemyArt = new EnemyArt(world.glowTex);
const fx = new FX(scene, world.glowTex, camera);
fx.low = !gfxHigh;

let ui;
const game = new Game({
  scene, world, gemArt, enemyArt, fx, camera,
  onChange: () => { if (ui) ui.dirty = true; },
  onMessage: (t, k) => ui && ui.toast(t, k),
  onEvent: (ev) => {
    if (ev === 'gameover') setTimeout(() => ui.openEnd(false), 900);
    if (ev === 'victory') setTimeout(() => ui.openEnd(true), 900);
    if (ev === 'leak') shake = 0.25;
  },
});

// ---------- post ----------
let composer = null, bloom = null;
function setupPost() {
  composer = null;
  if (!gfxHigh || !isWebGL2) return;
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch (e) { composer = null; }
}
setupPost();

// ---------- markers: hover hex, selection, ranges ----------
function hexLine(color, rad = HEX_R * 0.95, y = 0.04) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 180 * (60 * i - 30); pts.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad)); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false }));
  l.renderOrder = 3;
  return l;
}
const hoverHex = new THREE.Group();
const hoverFill = new THREE.Mesh(new THREE.CircleGeometry(HEX_R * 0.95, 6), new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.25, depthWrite: false }));
hoverFill.rotation.x = -Math.PI / 2; hoverFill.rotation.z = Math.PI / 2; hoverFill.position.y = 0.035;
const hoverLine = hexLine(0x5aff8a);
hoverHex.add(hoverFill, hoverLine);
hoverHex.visible = false;
scene.add(hoverHex);

const selHex = hexLine(0xffffff, HEX_R * 1.0, 0.05);
selHex.visible = false;
scene.add(selHex);

function ringLine(color, dashed) {
  const pts = [];
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0.06, Math.sin(a))); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.05, transparent: true, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false });
  const l = new THREE.Line(geo, mat);
  if (dashed) l.computeLineDistances();
  l.renderOrder = 3;
  l.visible = false;
  scene.add(l);
  return l;
}
const rangeRing = ringLine(0xffffff);
const auraRing = ringLine(0x9fe0cc, true);
const rangeDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
rangeDisc.rotation.x = -Math.PI / 2; rangeDisc.position.y = 0.04; rangeDisc.visible = false;
scene.add(rangeDisc);

// markers on the round's new gems and on recipe parts
const markerPool = [];
function markers(list, color) {
  let i = 0;
  for (const g of list) {
    let m = markerPool[i];
    if (!m) { m = hexLine(0xffffff, HEX_R * 0.88, 0.05); scene.add(m); markerPool.push(m); }
    m.visible = true;
    m.material.color.set(color);
    m.position.set(g.x, 0, g.z);
    i++;
  }
  for (; i < markerPool.length; i++) markerPool[i].visible = false;
}
let highlightParts = null;

// ---------- camera rig ----------
const cam = { tx: 0, tz: 0.6, yaw: 0, pitch: 0.95, dist: 26, want: null };
function fitDist() {
  const a = innerWidth / innerHeight;
  return a >= 1.2 ? 25 : a >= 0.8 ? 30 : 40;
}
cam.dist = fitDist();
function clampCam() {
  const B = GRID_BOUNDS;
  cam.tx = Math.max(B.minX, Math.min(B.maxX, cam.tx));
  cam.tz = Math.max(B.minZ, Math.min(B.maxZ, cam.tz));
  cam.dist = Math.max(8, Math.min(48, cam.dist));
}
let shake = 0;
function placeCamera(dt) {
  clampCam();
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const sx = shake > 0 ? (Math.random() - 0.5) * shake * 0.6 : 0;
  shake = Math.max(0, shake - dt);
  camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist + sx, sp * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(cam.tx + sx, 0, cam.tz);
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitP = new THREE.Vector3();
function cellAt(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // pick gems by their body first (they stand tall), then fall back to the ground
  if (!ray.ray.intersectPlane(plane, hitP)) return null;
  const c = fromWorld(hitP.x, hitP.z);
  // the gem heads are ~0.7 up: also test the plane at that height
  const hi = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
  const hp2 = new THREE.Vector3();
  if (ray.ray.intersectPlane(hi, hp2)) {
    const c2 = fromWorld(hp2.x, hp2.z);
    if (inGrid(c2.c, c2.r) && game.gems.has(key(c2.c, c2.r)) && !game.gems.has(key(c.c, c.r))) return c2;
  }
  return inGrid(c.c, c.r) ? c : null;
}

let hover = null, hoverOk = null, touchPending = null, hoverStamp = '';
function updateHover(cx, cy) {
  const c = cellAt(cx, cy);
  // the path check is a full search, so only redo it when the cell or the board changes
  const stamp = c ? key(c.c, c.r) + '|' + game.gems.size + '|' + game.placesLeft + '|' + game.phase : '';
  if (stamp === hoverStamp) return;
  hoverStamp = stamp;
  hover = c;
  hoverOk = null;
  if (!c) return;
  if (game.phase === 'build' && game.placesLeft > 0 && !game.gems.has(key(c.c, c.r))) hoverOk = game.canPlace(c.c, c.r);
}

function clickCell(c, viaTouch) {
  unlockAudio();
  if (!c) { deselect(); return; }
  const g = game.gems.get(key(c.c, c.r));
  if (g) { touchPending = null; game.select(g); return; }
  if (game.phase === 'build' && game.placesLeft > 0) {
    if (viaTouch && !(touchPending && touchPending.c === c.c && touchPending.r === c.r)) {
      touchPending = c;
      hover = c;
      hoverOk = game.canPlace(c.c, c.r);
      if (!hoverOk.ok && hoverOk.reason) ui.toast(hoverOk.reason, 'bad');
      return;
    }
    touchPending = null;
    game.place(c.c, c.r);
    hover = null;
    return;
  }
  deselect();
}
function deselect() { game.select(null); touchPending = null; }

// ---------- pointer input ----------
const pointers = new Map();
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
  if (pointers.size === 2) drag = { multi: true, ...twoInfo() };
  else drag = { moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) { if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2 && drag && drag.multi) {
    const now = twoInfo();
    cam.dist *= drag.d / now.d;
    cam.yaw -= now.a - drag.a;
    panBy(now.cx - drag.cx, now.cy - drag.cy);
    Object.assign(drag, now);
    drag.moved = true;
    return;
  }
  if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > (p.type === 'mouse' ? 4 : 10)) drag.moved = true;
  if (!drag.moved) return;
  if (p.button === 2) cam.yaw -= dx * 0.006;
  else panBy(dx, dy);
  if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && !drag.multi && pointers.size === 0 && p.button === 0) {
    clickCell(cellAt(e.clientX, e.clientY), e.pointerType !== 'mouse');
  }
  if (pointers.size === 0) drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); if (!pointers.size) drag = null; });
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hover = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });

function twoInfo() {
  const [a, b] = [...pointers.values()];
  return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
function panBy(dx, dy) {
  const k = cam.dist / innerHeight * 0.85;
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  cam.tx -= (dx * c + dy * s) * k;
  cam.tz -= (-dx * s + dy * c) * k;
}

// ---------- keyboard ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  unlockAudio();
  const k = e.key.toLowerCase();
  keys.add(k);
  if (ui.modalOpen()) { if (k === 'escape' || k === 'enter') ui.closeModal(); if (k === 'g') { game.buyQuality(); ui.openQuality(); } return; }
  const sel = game.selected;
  if (k === ' ') { e.preventDefault(); if (sel) game.keep(sel); }
  else if (k === 'c' && sel) { const o = game.sameOptions(sel); if (o.length) game.combineSame(sel, o[o.length - 1].n); }
  else if (k === 'x' && sel) game.downgrade(sel);
  else if (k === 'u' && sel) game.upgradeSpecial(sel);
  else if (k === 'r' && sel) game.removeRock(sel);
  else if (k === 'g') game.buyQuality();
  else if (k === 'b') ui.openRecipes();
  else if (k === 'h' || k === '?') ui.openHelp();
  else if (k === 'p') togglePause();
  else if (k === '1' || k === '2' || k === '3') setSpeed(+k);
  else if (k === 'escape') deselect();
  else if (k === 'tab') {
    // cycle through this round's new gems
    e.preventDefault();
    const list = game.newGems.length ? game.newGems : [...game.gems.values()].filter(x => x.kind === 'gem');
    if (list.length) { const i = list.indexOf(sel); game.select(list[(i + 1) % list.length]); }
  }
  ui.dirty = true;
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function keyboardCamera(dt) {
  const sp = cam.dist * 0.9 * dt * 60;
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx += 1;
  if (keys.has('arrowright') || keys.has('d')) dx -= 1;
  if (keys.has('arrowup') || keys.has('w')) dy += 1;
  if (keys.has('arrowdown') || keys.has('s')) dy -= 1;
  if (dx || dy) panBy(dx * sp * 0.2, dy * sp * 0.2);
  if (keys.has('q')) cam.yaw += dt * 1.5;
  if (keys.has('e')) cam.yaw -= dt * 1.5;
  if (keys.has('=') || keys.has('+')) cam.dist *= Math.exp(-dt * 1.5);
  if (keys.has('-') || keys.has('_')) cam.dist *= Math.exp(dt * 1.5);
}

// ---------- speed / pause / settings ----------
let speed = 1, paused = false;
function setSpeed(s) { speed = s; paused = false; ui.dirty = true; }
function togglePause() { paused = !paused; ui.dirty = true; }
function toggleGfx() {
  gfxHigh = !gfxHigh;
  try { localStorage.setItem('hexgem.gfx', gfxHigh ? 'high' : 'low'); } catch (e) { /* storage blocked */ }
  fx.low = !gfxHigh;
  setupPost();
  resize();
  if (!isWebGL2 && gfxHigh) ui.toast('Bloom needs WebGL2; using the rest of high quality', 'info');
}

ui = new UI(game, {
  toggleSound: () => { unlockAudio(); setMuted(!isMuted()); },
  isMuted, toggleGfx, gfxHigh: () => gfxHigh,
  togglePause, paused: () => paused, setSpeed, speed: () => speed,
  touch: () => touchDevice,
  deselect,
  restart: () => { game.reset(); deselect(); },
  highlightParts: (p) => { highlightParts = p; },
});

// ---------- resize ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  const pr = Math.min(devicePixelRatio || 1, gfxHigh ? 2 : 1.25);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
  fx.setViewportHeight(h * pr);
}
addEventListener('resize', resize);
resize();

// ---------- loop ----------
const clock = new THREE.Clock();
let uiTick = 0, t = 0;
function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  t += dt;
  keyboardCamera(dt);
  if (!paused) {
    let sim = dt * speed;
    while (sim > 1e-6) {
      const step = Math.min(sim, 1 / 30);
      game.update(step);
      fx.update(step);
      sim -= step;
    }
  }
  world.setBuildMode(game.phase === 'build' || game.phase === 'select');
  world.update(dt);
  for (const g of game.gems.values()) g.art.anim(t, dt);
  updateMarkers();
  placeCamera(dt);
  if (ui.dirty) { ui.dirty = false; ui.render(); }
  uiTick -= dt;
  if (uiTick <= 0) { uiTick = 0.25; ui.tick(); }
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function updateMarkers() {
  // hover ghost while placing
  const h = touchPending || hover;
  if (h && hoverOk && game.phase === 'build') {
    const w = toWorld(h.c, h.r);
    hoverHex.position.set(w.x, 0, w.z);
    const col = hoverOk.ok ? 0x5aff8a : 0xff4a4a;
    hoverFill.material.color.set(col);
    hoverLine.material.color.set(col);
    hoverFill.material.opacity = touchPending ? 0.4 + Math.sin(t * 8) * 0.15 : 0.25;
    hoverHex.visible = true;
  } else hoverHex.visible = false;

  const sel = game.selected && game.gems.has(key(game.selected.c, game.selected.r)) ? game.selected : null;
  selHex.visible = !!sel;
  rangeRing.visible = auraRing.visible = rangeDisc.visible = false;
  if (sel) {
    selHex.position.set(sel.x, 0, sel.z);
    selHex.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
    if (sel.kind === 'gem') {
      const s = gemStats(sel);
      const r = s.range / RANGE_PER_HEX;
      const col = sel.special ? SPECIALS[sel.special].color : GEM_TYPES[sel.type].color;
      rangeRing.visible = rangeDisc.visible = true;
      rangeRing.position.set(sel.x, 0, sel.z); rangeRing.scale.setScalar(r);
      rangeRing.material.color.set(col);
      rangeDisc.position.set(sel.x, 0.04, sel.z); rangeDisc.scale.setScalar(r);
      rangeDisc.material.color.set(col);
      if (s.auraRange) {
        auraRing.visible = true;
        auraRing.position.set(sel.x, 0.01, sel.z);
        auraRing.scale.setScalar(s.auraRange / RANGE_PER_HEX);
        auraRing.material.color.set(col).multiplyScalar(1.3);
      }
    }
  }
  if (highlightParts) markers(highlightParts, 0xff66ff);
  else if (game.phase === 'select' || (game.phase === 'build' && game.newGems.length)) markers(game.newGems.filter(g => g.kind === 'gem'), 0xffe45a);
  else markers([], 0);
  const pulse = 0.7 + Math.sin(t * 6) * 0.3;
  markerPool.forEach(m => { m.material.opacity = pulse; });
}

// First-visit help, then go.
let seen = false;
try { seen = localStorage.getItem('hexgem.seenHelp') === '1'; localStorage.setItem('hexgem.seenHelp', '1'); } catch (e) { /* storage blocked */ }
if (!seen && !TEST) ui.openHelp();
ui.render();
requestAnimationFrame(frame);
document.getElementById('loading')?.remove();

// test / debug hook
window.HG = { game, THREE, cam, scene, renderer, fx, world, setSpeed, step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { game.update(dt); fx.update(dt); } } };
