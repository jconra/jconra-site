// THE GIZMO: handles for moving, turning and sizing one thing by hand, like Blender's.
//   Three arms stick out of the thing along the world's X (red), Y (green) and Z (blue), with a white ball in the
//   middle. What a drag does depends on the mode:
//     translate  cone tips: drag an arm to slide the thing along it; drag the ball to slide it over the ground at its own height
//     rotate     ball tips: drag across an arm to turn the thing about it (when the arm points at you, drag sideways);
//                the near side of the thing follows the pointer. The middle ball does nothing here.
//     scale      cube tips: drag an arm out to stretch along it, in to squash; drag the ball right or up to size it
//                every way at once. Here the arms follow the thing's own turn, since that is the way it stretches.
//   The arms always look about 90 px long, however far off the thing is, and draw over everything else.
//   A press on a handle belongs to the gizmo alone (the camera and the other tools never see it); a press anywhere
//   else is left alone. Touch works the same, with fatter handles under a finger; a second finger (a pinch) is always
//   left to the camera. No keys are used.
//
//   const g = new Gizmo({ camera, dom, scene, controls })   controls: OrbitControls, held still while a handle is dragged
//   g.mode = 'rotate'  (or g.setMode('rotate'))
//   g.axes = { y: true }   the arms that show and work (any left out are off); a building might be { x: true, z: true }
//   g.uniform = true       scale: every handle sizes all three ways together
//   g.attach(thing, { onChange, onCommit })   thing: anything with position, quaternion and scale, in world terms (an
//     Object3D straight in the scene, or a stand-in that isn't in it). onChange(thing) on every move of a drag;
//     onCommit(thing) once when it's let go, if it changed.
//   g.update() each frame before drawing;  g.detach();  g.dispose()
//   g.dragging: true while a handle is held;  g.hovered: the handle under the pointer ('x', 'y', 'z', 'free' (the ball) or null)
//
// It listens on the window in the capture phase (for presses on dom, or inside it), so make it before any tool that listens
// on the window too: then it goes first, and a press on a handle never reaches the tools made after it.
import * as THREE from 'three';

const ARM_PX = 90;                                                       // an arm's length on screen
const COLOUR = { x: 0xe8433d, y: 0x6fc53b, z: 0x3d7ee8, free: 0xffffff }, HOVER = 0xffd84a;
const TURN = 0.01;                                                       // radians of turn for each pixel of drag
const SMALLEST = 0.05;                                                   // a drag never sizes below this share of the start
const STILL = 3;                                                         // pixels a press may wander before it counts as a drag
const FAT = 1.6;                                                         // the handles grow this much under a finger
const MODES = ['translate', 'rotate', 'scale'];
const AXES = ['x', 'y', 'z'], DIR = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
// the shapes, in arm lengths: an arm is 1 long, and the whole gizmo is sized to look ARM_PX long
const SHAFT = [0.12, 0.86], TIP = 0.92, GRAB = [0.2, 0.86];
const meshRay = THREE.Mesh.prototype.raycast, noRay = () => {};       // (other tools' rays pass straight through the gizmo)

export class Gizmo {
  constructor({ camera, dom, scene, controls }) {
    Object.assign(this, { camera, dom, scene, controls });
    this._mode = 'translate'; this.axes = { x: true, y: true, z: true }; this.uniform = false;
    this.localScale = true;                                              // scale mode: arms along the thing's own axes (false: the world's)
    this.target = null; this.onChange = this.onCommit = null; this.drag = null; this.hover = null; this.eatUntil = 0;
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(); this.ndc = new THREE.Vector2(); this.hits = [];
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.build(); this.listen();
  }

  get mode() { return this._mode; }
  set mode(m) { if (m === this._mode || !MODES.includes(m)) return; if (this.drag) this.end(); this._mode = m; this.update(); }   // (an unknown mode is ignored)
  setMode(m) { this.mode = m; }
  get dragging() { return !!this.drag; }
  get hovered() { return this.drag ? this.drag.handle : this.hover; }

  attach(target, { onChange, onCommit } = {}) {
    if (this.drag) this.end();
    this.target = target; this.onChange = onChange || null; this.onCommit = onCommit || null; this.update();
  }
  detach() { if (this.drag) this.end(); this.target = null; this.setHover(null); this.update(); }

  // ── the look ───────────────────────────────────────────────────────────────────────────────────────────────────
  build() {
    const g = this.group = new THREE.Group(); g.name = 'gizmo'; g.visible = false;
    const geo = this.geo = { shaft: new THREE.CylinderGeometry(0.018, 0.018, 1, 8), cone: new THREE.ConeGeometry(0.062, 0.2, 14),
      ball: new THREE.SphereGeometry(0.066, 14, 10), cube: new THREE.BoxGeometry(0.115, 0.115, 0.115), centre: new THREE.SphereGeometry(0.08, 16, 12),
      grabShaft: new THREE.CylinderGeometry(0.09, 0.09, 1, 6), grabTip: new THREE.SphereGeometry(0.18, 8, 6), grabCentre: new THREE.SphereGeometry(0.16, 8, 6) };
    this.grabMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });   // the bigger, unseen shapes the pointer catches on
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    const mesh = (gm, m, y, parent) => { const o = new THREE.Mesh(gm, m); o.position.y = y; o.renderOrder = 999; o.frustumCulled = false; o.raycast = noRay; parent.add(o); return o; };
    this.mats = {}; this.arms = {}; this.grabs = [];
    for (const a of AXES) {
      const m = this.mats[a] = mat(COLOUR[a]), arm = new THREE.Group();
      if (a === 'x') arm.rotation.z = -Math.PI / 2;
      if (a === 'z') arm.rotation.x = Math.PI / 2;                       // (each arm is built along +Y, then laid along its axis)
      const tips = { translate: mesh(geo.cone, m, TIP - 0.02, arm), rotate: mesh(geo.ball, m, TIP, arm), scale: mesh(geo.cube, m, TIP, arm) };
      for (const k in tips) tips[k].userData.y0 = tips[k].position.y;
      const gs = mesh(geo.grabShaft, this.grabMat, (GRAB[0] + GRAB[1]) / 2, arm); gs.scale.y = GRAB[1] - GRAB[0];
      this.grabs.push({ name: a, mesh: mesh(geo.grabTip, this.grabMat, TIP, arm) }, { name: a, mesh: gs, long: true });
      this.arms[a] = { arm, shaft: mesh(geo.shaft, m, 0, arm), tips, on: true }; g.add(arm); this.stretch(a, 1);
    }
    this.mats.free = mat(COLOUR.free); this.centre = mesh(geo.centre, this.mats.free, 0, g);
    this.grabs.push({ name: 'free', mesh: mesh(geo.grabCentre, this.grabMat, 0, g) });
    for (const h of this.grabs) h.base = h.mesh.scale.clone();
    this.scene.add(g);
  }
  stretch(a, k) {                                                        // an arm drawn k times as long (while it's sizing)
    const { shaft, tips } = this.arms[a], more = (k - 1) * TIP, len = Math.max(0.01, SHAFT[1] + more - SHAFT[0]);
    shaft.scale.y = len; shaft.position.y = SHAFT[0] + len / 2;
    for (const t in tips) tips[t].position.y = tips[t].userData.y0 + more;
  }

  // update(): follow the thing, keep the size on screen, show the arms and tips for the mode, light the one in hand
  update() {
    const t = this.target, g = this.group;
    if (!t) { g.visible = false; return; }
    this.camera.updateMatrixWorld();
    g.visible = true; g.position.copy(t.position);
    if (this._mode === 'scale' && this.localScale) g.quaternion.copy(t.quaternion).normalize(); else g.quaternion.identity();
    g.scale.setScalar(ARM_PX * this.pixel(t.position));
    const d = this.drag, lit = this.hovered;
    for (const a of AXES) {
      const A = this.arms[a], held = d && d.handle === a; let on = !!this.axes[a];
      // an arm pointing (nearly) at the camera can't be slid or stretched along: hidden, unless it's the one in hand
      if (on && this._mode !== 'rotate' && !held) on = this.screenLen(a) > 0.2 * ARM_PX;
      A.arm.visible = A.on = on;
      for (const k in A.tips) A.tips[k].visible = k === this._mode;
      this.mats[a].color.setHex(lit === a ? HOVER : COLOUR[a]);
      this.stretch(a, held && this._mode === 'scale' ? d.k : 1);
    }
    this.centreOn = this._mode === 'scale' ? AXES.some(a => this.axes[a]) : this._mode === 'translate' && !!(this.axes.x || this.axes.z);
    this.mats.free.color.setHex(lit === 'free' ? HOVER : COLOUR.free); this.mats.free.opacity = this.centreOn ? 1 : 0.45;
    g.updateMatrixWorld(true);
  }
  pixel(p) {                                                             // how big one screen pixel is (in metres) at p
    const c = this.camera, h = this.dom.clientHeight || innerHeight;
    if (c.isOrthographicCamera) return (c.top - c.bottom) / c.zoom / h;
    const depth = this._a.copy(p).sub(this._b.setFromMatrixPosition(c.matrixWorld)).dot(c.getWorldDirection(this._c));
    return 2 * Math.max(depth, c.near) * Math.tan(c.fov * Math.PI / 360) / c.zoom / h;
  }
  dirOf(a, q) {                                                          // the way arm a points, in the world
    const v = this._c.copy(DIR[a]);
    return this._mode === 'scale' && this.localScale ? v.applyQuaternion(q || this.target.quaternion).normalize() : v;
  }
  screen(p, out = {}) {                                                  // a world point to pixels across and down the dom
    const v = this._a.copy(p).project(this.camera);
    out.x = (v.x + 1) / 2 * this.dom.clientWidth; out.y = (1 - v.y) / 2 * this.dom.clientHeight; return out;
  }
  screenLen(a) {                                                         // how long arm a looks, in pixels
    const p = this.target.position, s0 = this.screen(p), s1 = this.screen(this._b.copy(this.dirOf(a)).multiplyScalar(this.group.scale.x).add(p));
    return Math.hypot(s1.x - s0.x, s1.y - s0.y);
  }

  // ── picking ────────────────────────────────────────────────────────────────────────────────────────────────────
  aim(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
  }
  pick(cx, cy, fat) {                                                    // the handle at the pointer, or null
    if (!this.target) return null;
    this.update(); this.aim(cx, cy);
    const k = fat ? FAT : 1, out = this.hits, r = this.dom.getBoundingClientRect(); let best = null;
    for (const h of this.grabs) {
      if (h.name === 'free' ? !this.centreOn : !this.arms[h.name].on) continue;
      if (k !== 1) { h.mesh.scale.set(h.base.x * k, h.long ? h.base.y : h.base.y * k, h.base.z * k); h.mesh.updateMatrixWorld(); }
      out.length = 0; meshRay.call(h.mesh, this.ray, out);
      if (k !== 1) { h.mesh.scale.copy(h.base); h.mesh.updateMatrixWorld(); }
      if (!out.length) continue;
      // where shapes overlap, the tip or middle ball whose centre is nearest the pointer wins (a short arm's tip can
      // cover the ball); an arm's length counts only when no tip or ball is under the pointer
      const v = h.long ? null : h.mesh.getWorldPosition(this._b).project(this.camera);
      const off = v ? Math.hypot((v.x - this.ndc.x) * r.width, (v.y - this.ndc.y) * r.height) : 1e9 + Math.min(...out.map(o => o.distance));
      if (!best || off < best.off) best = { name: h.name, off };
    }
    return best && best.name;
  }
  setHover(h) {
    if (h === this.hover) return;
    if (h && !this.hover) { this.cursor = this.dom.style.cursor; this.dom.style.cursor = 'pointer'; } else if (!h) this.dom.style.cursor = this.cursor || '';
    this.hover = h; this.update();
  }

  // ── the pointer: the window's capture phase, so the gizmo goes before the camera and the tools made after it ──
  listen() {
    const mine = (e) => e.target instanceof Node && this.dom.contains(e.target);   // (the dom, or anything inside it)
    this.on = {
      pointerdown: (e) => {
        if (!mine(e)) return;
        if (this.drag) { if (e.pointerId !== this.drag.id) { e.stopImmediatePropagation(); e.preventDefault(); } return; }   // (a second finger mid-drag goes nowhere)
        // a second finger while another is already down (a pinch) is the camera's, even if it lands on a handle
        if (!this.target || e.button !== 0 || !e.isPrimary) return;
        const h = this.pick(e.clientX, e.clientY, e.pointerType !== 'mouse'); this.setHover(h);
        if (!h) return;                                                  // not on a handle: left for the camera and the tools
        e.stopImmediatePropagation(); e.preventDefault(); this.begin(e, h);
      },
      pointermove: (e) => {
        // a mouse moving with no button held means its release was lost (let go outside the window, say): end there
        if (this.drag) { if (e.pointerId === this.drag.id) { e.stopImmediatePropagation(); if (e.buttons || e.pointerType !== 'mouse') this.move(e); else this.end(); } return; }
        if (e.pointerType === 'touch') return;
        this.setHover(mine(e) && !e.buttons && this.target ? this.pick(e.clientX, e.clientY, false) : null);
      },
      pointerup: (e) => {
        if (this.drag && e.pointerId === this.drag.id) { e.stopImmediatePropagation(); e.preventDefault(); this.end(); }
        if (e.pointerType === 'touch' && !this.drag) this.setHover(null);
      },
      // a finger's first touch arrives just before its press: so `hovered` is already right for any tool that looks
      pointerover: (e) => { if (!this.drag && mine(e) && e.pointerType !== 'mouse' && e.isPrimary && this.target) this.setHover(this.pick(e.clientX, e.clientY, true)); },
      pointerout: (e) => { if (!this.drag && mine(e)) this.setHover(null); },
      // the click that follows letting go of a handle isn't a click on the ground
      click: (e) => { if (mine(e) && performance.now() < this.eatUntil) { e.stopImmediatePropagation(); e.preventDefault(); } this.eatUntil = 0; },
    };
    this.on.pointercancel = this.on.pointerup;
    for (const k in this.on) addEventListener(k, this.on[k], { capture: true });
  }

  // ── dragging ───────────────────────────────────────────────────────────────────────────────────────────────────
  begin(e, handle) {
    const t = this.target, axis = handle !== 'free', len = this.group.scale.x;
    const d = this.drag = { handle, id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false, changed: false, k: 1, len,
      p0: t.position.clone(), q0: t.quaternion.clone(), s0: t.scale.clone(), dir: axis ? this.dirOf(handle).clone() : null };
    this.aim(e.clientX, e.clientY);
    if (this._mode === 'translate' && !axis) { this.plane.set(DIR.y, -d.p0.y); d.g0 = this.ground(); }
    else if (axis && this._mode !== 'rotate') d.a0 = this.along(d.p0, d.dir);
    else if (axis) {
      // turning: which way across the screen counts as forward, worked out once from how the arm lies on screen
      const s0 = this.screen(d.p0, {}), s1 = this.screen(this._b.copy(d.dir).multiplyScalar(len).add(d.p0), {});
      const sx = s1.x - s0.x, sy = s0.y - s1.y, L = Math.hypot(sx, sy);                            // (sy: up the screen)
      if (L > 0.3 * ARM_PX) d.across = { x: sy / L, y: -sx / L };        // (the arm's direction turned a quarter clockwise)
      else d.side = d.dir.dot(this._b.setFromMatrixPosition(this.camera.matrixWorld).sub(d.p0)) > 0 ? -1 : 1;   // (pointing at the camera, or away)
    }
    this.held = this.controls ? this.controls.enabled : null; if (this.controls) this.controls.enabled = false;
    try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    this.update();
  }
  move(e) {
    const d = this.drag, t = this.target, dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.live && Math.hypot(dx, dy) < STILL) return;                    // a press that hasn't really moved yet
    d.live = true; this.aim(e.clientX, e.clientY);
    const m = this._mode, h = d.handle;
    if (m === 'translate' && h === 'free') {
      const g = this.ground(); if (!g || !d.g0) return;
      t.position.set(this.axes.x ? d.p0.x + g.x - d.g0.x : d.p0.x, d.p0.y, this.axes.z ? d.p0.z + g.z - d.g0.z : d.p0.z);
    } else if (m === 'translate') {
      const a = this.along(d.p0, d.dir); if (a == null || d.a0 == null) return;
      t.position.copy(d.p0).addScaledVector(d.dir, a - d.a0);
    } else if (m === 'rotate') {
      const ang = TURN * (d.across ? dx * d.across.x - dy * d.across.y : dx * d.side);
      t.quaternion.copy(d.q0).premultiply(this._q.setFromAxisAngle(DIR[h], ang));   // (about the world axis, through the thing)
    } else if (h === 'free') {
      d.k = Math.max(SMALLEST, 1 + (dx - dy) / ARM_PX); t.scale.copy(d.s0).multiplyScalar(d.k);
    } else {
      const a = this.along(d.p0, d.dir); if (a == null || d.a0 == null) return;
      d.k = Math.max(SMALLEST, 1 + (a - d.a0) / d.len);
      if (this.uniform) t.scale.copy(d.s0).multiplyScalar(d.k); else t.scale[h] = d.s0[h] * d.k;
    }
    d.changed = true; if (t.updateMatrix) t.updateMatrix();
    this.update(); if (this.onChange) this.onChange(t);
  }
  end() {
    const d = this.drag; if (!d) return;
    this.drag = null; this.eatUntil = performance.now() + 400;
    if (this.controls && this.held != null) this.controls.enabled = this.held;
    try { this.dom.releasePointerCapture(d.id); } catch (err) { /* fine */ }
    this.update(); if (d.changed && this.onCommit && this.target) this.onCommit(this.target);
  }
  along(p0, dir) {                                                       // where the pointer's ray passes closest to the line p0 + s dir: s, or null
    const o = this.ray.ray.origin, v = this.ray.ray.direction, w = this._a.copy(p0).sub(o);
    const b = dir.dot(v), dd = dir.dot(w), e = v.dot(w), den = 1 - b * b;
    if (den < 1e-4 || (e - b * dd) / den <= 0) return null;               // (the line runs along the ray, or the closest point is behind the camera)
    return (b * e - dd) / den;
  }
  ground() {                                                             // the pointer's ray on the flat at the thing's height, or null
    const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    return p && p.distanceTo(this.ray.ray.origin) < (this.camera.far || 1e4) ? p : null;
  }

  dispose() {
    if (this.drag) this.end();
    for (const k in this.on) removeEventListener(k, this.on[k], { capture: true });
    if (this.hover) this.dom.style.cursor = this.cursor || '';
    this.scene.remove(this.group);
    for (const k in this.geo) this.geo[k].dispose();
    for (const k in this.mats) this.mats[k].dispose();
    this.grabMat.dispose(); this.target = null;
  }
}
