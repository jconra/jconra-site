// FLY KEYS: fly the camera with the keyboard, for a page that already uses OrbitControls.
//   W / S   forward / back, along the way the camera faces but kept level (looking down doesn't dive)
//   A / D   left / right
//   Space   up          C       down
// Holding keys keeps moving; two at once (W + D) is no faster than one. The camera and the orbit centre move
// together, so the view keeps pointing the same way and orbiting still turns round the same spot in front.
// Higher up it flies faster, so crossing the map from the sky doesn't crawl; it never goes below the ground.
//
//   const fly = flyKeys({ camera, controls, heightAt, speed: 10 });
//   in the frame loop, before controls.update():  if (fly.update(dt)) redraw();
//   fly.held      the move keys held right now (a Set of key codes, e.g. 'KeyW', 'Space', 'KeyC')
//   fly.dispose() stops listening
//
// heightAt(x, z) -> the ground height there (optional). With it the speed grows with height above the ground,
// speed * (1 + max(0, height - 2) / 15) metres a second, and the camera stays at least 0.6 m above the ground.
//
// The keys stay the page's own while you type (a text box, a dropdown, anything editable has focus) and while
// Ctrl, Alt or Cmd is held, so Ctrl+Z, Ctrl+W and the like still belong to the page and the browser. Sliders,
// tick boxes and buttons don't count as typing: you can fly straight after dragging a slider. Space never
// scrolls the page or presses the button you last clicked.
// (C rather than Shift for down: Shift is half of Shift+drag, which pans, and of Shift+Q, a fine turn.)
// Every key lets go when the window loses focus, the tab is hidden or a right-click menu opens, so nothing sticks.
import * as THREE from 'three';

const MOVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, Space: 1, KeyC: 1 };
const BY_KEY = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', ' ': 'Space', c: 'KeyC' };   // (for keyboards that send no code)
const NOT_TYPING = { range: 1, checkbox: 1, radio: 1, button: 1, submit: 1, reset: 1, color: 1, file: 1, image: 1 };
const CLEARANCE = 0.6;                                                  // (metres the camera stays above the ground)

function focused() {                                                    // the element that really has focus, inside a web component too
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
function typing(el) {                                                   // does this element want the letters typed?
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NOT_TYPING[(el.type || 'text').toLowerCase()];
}
function pressable(el) {                                                // would Space press or toggle this?
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A' || (tag === 'INPUT' && !!NOT_TYPING[(el.type || '').toLowerCase()]) || el.getAttribute('role') === 'button';
}
const codeOf = (e) => e.code ? (MOVE[e.code] ? e.code : null) : (BY_KEY[e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key] || null);

export function flyKeys({ camera, controls, heightAt = null, speed = 10 }) {
  const held = new Set();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), step = new THREE.Vector3(), up = new THREE.Vector3();
  const releaseAll = () => held.clear();
  const ground = (x, z) => { if (!heightAt) return null; const g = heightAt(x, z); return Number.isFinite(g) ? g : null; };

  const press = (e) => {
    if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'OS') { releaseAll(); return; }   // (a shortcut is starting: the keys are the page's now)
    if (e.ctrlKey || e.altKey || e.metaKey || typing(focused())) return;
    const code = codeOf(e);
    if (!code) return;
    if (code === 'Space') { e.preventDefault(); const a = focused(); if (pressable(a)) a.blur(); }   // (every repeat too, or the page scrolls)
    if (e.repeat) return;                                               // (only a fresh press: a key held through Ctrl or a chord stays let go)
    held.add(code);
  };
  const release = (e) => {
    const code = codeOf(e);
    if (code) { if (held.has(code) && code === 'Space') e.preventDefault(); held.delete(code); }
  };
  const letGo = () => releaseAll();
  const menu = (e) => { if (!e.defaultPrevented) releaseAll(); };      // (an open menu swallows the key-ups; OrbitControls' own right-drag cancels the menu, so it's kept)
  addEventListener('keydown', press); addEventListener('keyup', release, true);   // (key-ups heard first, before anything on the page can stop them)
  addEventListener('contextmenu', menu); addEventListener('blur', letGo); document.addEventListener('visibilitychange', letGo);

  function update(dt) {
    const moved = false;
    dt = Math.min(Math.max(+dt || 0, 0), 0.1);
    if (!held.size || !dt) return moved;
    if (typing(focused())) { releaseAll(); return moved; }             // (clicked into a text box mid-flight)
    const ix = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0), iz = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const iy = (held.has('Space') ? 1 : 0) - (held.has('KeyC') ? 1 : 0);
    const n = Math.hypot(ix, iy, iz);
    if (!n) return moved;                                               // (W and S together cancel)
    // forward = where the camera looks, made level; looking straight down it is the top of the screen instead
    camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) { camera.getWorldDirection(step); up.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(step.y > 0 ? -1 : 1); fwd.set(up.x, 0, up.z); }
    if (fwd.lengthSq() < 1e-12) fwd.set(0, 0, -1);
    fwd.normalize(); right.set(-fwd.z, 0, fwd.x);
    const p = camera.position, g0 = ground(p.x, p.z);
    const v = speed * (g0 === null ? 1 : 1 + Math.max(0, p.y - g0 - 2) / 15) * dt / n;   // (/ n: a diagonal is no faster)
    step.set(0, 0, 0).addScaledVector(fwd, iz * v).addScaledVector(right, ix * v); step.y = iy * v;
    const g1 = ground(p.x + step.x, p.z + step.z);
    if (g1 !== null && p.y + step.y < g1 + CLEARANCE) step.y = g1 + CLEARANCE - p.y;   // (rides up over hills rather than through them)
    if (step.lengthSq() < 1e-14) return moved;
    p.add(step); if (controls && controls.target) controls.target.add(step);
    return true;
  }

  function dispose() {
    removeEventListener('keydown', press); removeEventListener('keyup', release, true);
    removeEventListener('contextmenu', menu); removeEventListener('blur', letGo); document.removeEventListener('visibilitychange', letGo);
    releaseAll();
  }

  return { update, dispose, held };
}
