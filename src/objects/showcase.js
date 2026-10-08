// SHOWCASE: the town's landmarks presenting Jacob's projects. Over a landmark (a building or prop that stands for a
// project, or for a group of them) the pointer becomes a hand and its name shows; a click (on a touch screen: a tap shows
// the name, a second tap opens it) raises a hologram over it: a force field (the Shield Lab's) the shape of a tennis racket
// standing on the landmark, and in its head a screen: the project's pictures as a slideshow, moving on by themselves every
// few seconds (each with its caption; thin buttons either side and the arrow keys step them, which stops them moving on),
// and under them, on a solid panel, its title, subtitle and one write-up that never changes by itself (it scrolls: wheel,
// drag), so reading is never cut off. The camera glides to face it, and back when it closes (Escape, the ×, a tap off it).
// All of it in the scene: the screen is a picture drawn on a canvas, so it stays put over its landmark.
//
//   new Showcase({ scene, camera, controls, dom, data, targets, enabled, blocked, scale })
//     data: { landmarks: [{ id, label, color, link, title, subtitle, dates, madeWith, text, pictures: [{ img, caption, link }] }] }
//       text: paragraphs (a blank line between); '# ' a project's heading, '## ' a section's, '> ' a line of when and with what,
//       '- ' a list; a heading ending ' [url]' is a link. A picture's link (else the landmark's) is the Visit button's
//     targets(): [{ id (a landmark's), obj (the Object3D to hit), box (its world Box3) }]   enabled(): false while editing
//     blocked(ray, distance): is something else (another building, a hill) in the way of a landmark that far along the ray
//     scale: the screen's canvas resolution (1: 1024 px wide; potato less)
//   .present(id, target?)  .close()  .update(dt)  .isOpen
import * as THREE from 'three';
import { makeShieldMaterial, pushShieldHit, stepShield } from '../../labs/shield/js/ShieldShader.js';

// the screen's layout, in canvas pixels at scale 1
const W = 1024, H = 1152, SIDE = 54, PAD = 66, PIC = { x: PAD, y: 22, w: W - PAD * 2, h: Math.round((W - PAD * 2) * 9 / 16) };
const PANEL = { x: PAD, y: PIC.y + PIC.h + 16, w: W - PAD * 2, h: H - (PIC.y + PIC.h + 16) - 22 };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const AUTO = 4;                                         // (s a picture shows before the next, until someone steps them by hand)

// the racket's outline (in screen widths): an oval head round the screen's middle (RX, RY), a throat narrowing below it
// (THROAT long) into a straight handle (HANDLE long, GRIP half as wide) standing on the landmark
const RACKET = { RX: 0.72, RY: 0.8, THROAT: 0.3, HANDLE: 0.45, GRIP: 0.06, OPEN: 0.62 };   // (OPEN: radians either side of straight down where the throat leaves the head)
const RACKET_DOWN = RACKET.RY + RACKET.THROAT + RACKET.HANDLE;                               // (from the head's middle to the handle's foot)
function racketShape({ RX, RY, THROAT, HANDLE, GRIP, OPEN }) {
  const s = new THREE.Shape(), yT = -RY - THROAT, yF = yT - HANDLE, aL = -Math.PI / 2 - OPEN, aR = -Math.PI / 2 + OPEN;
  s.moveTo(-GRIP, yF); s.lineTo(-GRIP, yT); s.lineTo(RX * Math.cos(aL), RY * Math.sin(aL));
  s.absellipse(0, 0, RX, RY, aL, aR, true);                     // (over the top)
  s.lineTo(GRIP, yT); s.lineTo(GRIP, yF); s.lineTo(-GRIP, yF);
  return s;
}

export class Showcase {
  constructor({ scene, camera, controls, dom, data, targets, enabled = () => true, blocked = null, scale = 1 }) {
    Object.assign(this, { scene, camera, controls, dom, targets, enabled, blocked, scale, fz: 1, every: AUTO });   // (every: how long a picture shows, for a tour to wait out)
    this.byId = new Map((data && data.landmarks || []).map((l) => [l.id, l]));
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.v = new THREE.Vector3(); this.time = 0;
    // the hologram's parts
    this.group = new THREE.Group(); this.group.name = 'showcase'; this.group.visible = false; scene.add(this.group);
    this.canvas = document.createElement('canvas'); this.canvas.width = Math.round(W * scale); this.canvas.height = Math.round(H * scale);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.generateMipmaps = false; this.tex.minFilter = THREE.LinearFilter;   // (no mip chain: any size works on WebGL1, and it's seen close)
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, fog: false, opacity: 0 });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1, H / W), this.screenMat); this.screen.renderOrder = 12;
    // the force field: a flat racket, its edges bevelled to catch the glow, a little behind the screen; its hexagons laid
    // straight on its face (the shield's own pick a side of a cube by where a point is, made for a ball): the strings
    const pin = new THREE.ExtrudeGeometry(racketShape(RACKET), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 4, curveSegments: 64 }).translate(0, 0, -0.01);
    const fm = makeShieldMaterial('#59d8ff'), flat = fm.fragmentShader.replace(/vec3 absN = abs\(normalize\(vObjPos\)\);[\s\S]*?: vObjPos\.xy;/, 'float hexFade = 1.0; vec2 faceUV = vObjPos.xy;');
    if (flat === fm.fragmentShader) console.warn('showcase: the shield shader changed; its hexagons stay as made for a ball');
    fm.fragmentShader = flat; fm.side = THREE.FrontSide; fm.fog = false;   // (its front only: the far face, seen through it, reads as all edge and glares)
    this.field = new THREE.Mesh(pin, fm); this.field.renderOrder = 11;
    const fu = this.field.material.uniforms; fu.uFill.value = 0.14; fu.uHexOpacity.value = 0.5; fu.uHexScale.value = 6.5; fu.uFlashIntensity.value = 0.3; fu.uFresnelStrength.value = 1.0; fu.uFlowIntensity.value = 2.2;   // (quieter than a shield: the screen is what's looked at)
    this.holder = new THREE.Group(); this.holder.add(this.field, this.screen); this.group.add(this.holder);
    this.field.raycast = () => {};                                     // (anyone else's clicks go through the light)
    this.imgs = new Map(); this.state = 'closed'; this.isOpen = false; this.dirty = true;
    // the name shown over a landmark
    this.label = document.createElement('div');
    Object.assign(this.label.style, { position: 'fixed', left: '0', top: '0', transform: 'translate(-50%, -120%)', padding: '6px 12px', borderRadius: '999px', pointerEvents: 'none',
      background: 'rgba(10, 24, 34, 0.86)', color: '#dff6ff', border: '1px solid rgba(89, 216, 255, 0.55)', font: `600 14px ${FONT}`, letterSpacing: '0.3px', whiteSpace: 'nowrap',
      boxShadow: '0 0 18px rgba(89, 216, 255, 0.35)', display: 'none', zIndex: 5 });
    document.body.appendChild(this.label);
    this.bind();
  }

  // ── input ────────────────────────────────────────────────────────────────────────────────────────────────────
  bind() {
    const dom = this.dom;
    dom.addEventListener('pointermove', (e) => this.move(e));
    dom.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => { if (this.drag && e.pointerId !== this.drag.id) return; this.press = null; const d = this.drag; this.drag = null; if (d && this.controls && !this.gliding) this.controls.enabled = true; });   // (a press taken away mid-way: nothing done, the camera free)
    dom.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.drag) this.hover(null); });   // (the mouse gone off the page: its name too; a touch leaves after every lift, so not those)
    dom.addEventListener('wheel', (e) => { const r = this.screenAt(e.clientX, e.clientY); if (r && r.inText) { e.preventDefault(); e.stopImmediatePropagation(); this.scrollBy(e.deltaY * (e.deltaMode ? 30 : 1)); } }, { capture: true, passive: false });   // (reading: the pictures go on moving)
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { this.close(); return; }
      const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;   // (a focused slider or list keeps its arrow keys)
      if (e.key === 'ArrowRight') { this.step(1); this.touched(); } else if (e.key === 'ArrowLeft') { this.step(-1); this.touched(); }
    });
    if (this.controls) this.controls.addEventListener('start', () => { if (!this.gliding) this.userMoved = true; });
  }
  // the pointer's look: only ever taken back if this set it (the Build bar's tools set their own)
  setCursor(c) { if (c) { this.dom.style.cursor = c; this.myCursor = c; } else { if (this.myCursor && this.dom.style.cursor === this.myCursor) this.dom.style.cursor = ''; this.myCursor = null; } }
  setNdc(x, y) { const r = this.dom.getBoundingClientRect(); this.ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera); }
  // the screen under the pointer: which part of it (canvas pixels at scale 1)
  screenAt(x, y) {
    if (!this.isOpen || this.screenMat.opacity < 0.5) return null;
    this.setNdc(x, y); const hit = this.ray.intersectObject(this.screen, false)[0]; if (!hit) return null;
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H, inPic = px >= PIC.x && px <= PIC.x + PIC.w && py >= PIC.y && py <= PIC.y + PIC.h;
    let part = null;
    if (px < SIDE + 4) part = 'prev'; else if (px > W - SIDE - 4) part = 'next';
    else if (this.closeBox && inside(this.closeBox, px, py)) part = 'close';
    else if (this.visitBox && inside(this.visitBox, px, py)) part = 'visit';
    else { const ln = (this.textLinks || []).find((b) => inside(b, px, py)); if (ln) part = 'link:' + ln.url; }   // (a heading that is a link)
    return { px, py, part, inText: py > PANEL.y && px > PANEL.x && px < PANEL.x + PANEL.w, inPic };
  }
  // the landmark under the pointer (its box first, then its own mesh)
  landmarkAt(x, y) {
    this.setNdc(x, y); let best = null, near = Infinity;
    for (const t of this.targets()) {
      if (!this.byId.has(t.id) || !t.box || !this.ray.ray.intersectsBox(t.box)) continue;
      const hit = this.ray.intersectObject(t.obj, true)[0]; if (hit && hit.distance < near) { near = hit.distance; best = t; }
    }
    return best && this.blocked && this.blocked(this.ray.ray, near) ? null : best;   // (behind another building or a hill: not this one)
  }
  move(e) {
    if (this.drag && e.pointerId !== this.drag.id) return;
    if (this.drag) { const dy = e.clientY - this.drag.y; if (Math.abs(dy) > 3 || this.drag.moved) { this.drag.moved = true; this.scrollBy(-dy * this.drag.k); this.drag.y = e.clientY; } return; }
    if (e.buttons) return;
    if (!this.enabled()) { if (this.hovered) this.hover(null); return; }
    const s = this.screenAt(e.clientX, e.clientY);
    if (s) { this.hover(null); this.setCursor(s.part ? 'pointer' : ''); this.overScreen = true; if (this.hot !== s.part) { this.hot = s.part; this.dirty = true; } if (this.controls) this.controls.enableZoom = !s.inText; return; }
    if (this.overScreen) { this.overScreen = false; this.setCursor(''); if (this.controls) this.controls.enableZoom = true; if (this.hot) { this.hot = null; this.dirty = true; } }
    if (e.pointerType === 'mouse') this.hover(this.landmarkAt(e.clientX, e.clientY));
  }
  hover(t) {
    this.hovered = t;
    if (!t) { this.label.style.display = 'none'; if (!this.overScreen) this.setCursor(''); return; }
    const l = this.byId.get(t.id); this.label.textContent = l.label + (this.armed && this.armed.id === t.id ? ' · tap again to open' : '');
    this.label.style.display = 'block'; this.setCursor('pointer'); this.placeLabel();
  }
  placeLabel() {
    const t = this.hovered; if (!t) return;
    t.box.getCenter(this.v); this.v.y = t.box.max.y; this.v.project(this.camera);
    if (this.v.z > 1) { this.label.style.display = 'none'; return; }
    const r = this.dom.getBoundingClientRect();
    this.label.style.left = `${r.left + (this.v.x * 0.5 + 0.5) * r.width}px`; this.label.style.top = `${r.top + (-this.v.y * 0.5 + 0.5) * r.height}px`;
  }
  down(e) {
    if (e.button !== 0) return;                                         // (the main button only: right and middle are the camera's)
    const s = this.enabled() ? this.screenAt(e.clientX, e.clientY) : null;
    if (s && this.drag) { e.stopImmediatePropagation(); return; }       // (a second finger on the screen: held, nothing more)
    this.press = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType, id: e.pointerId, um: this.userMoved };
    if (s) {                                                             // (a press on the screen is the screen's: the camera stays still)
      e.stopImmediatePropagation(); if (!s.inText || s.part === 'visit') this.touched();   // (a press on the pictures stops them, and on Visit, so it goes where it said; one in the write-up is reading)
      if (s.part === 'visit') this.press.link = this.slideLink();
      this.drag = s.inText ? { y: e.clientY, k: this.pxPerScreenPx(), moved: false, id: e.pointerId } : { y: e.clientY, k: 0, moved: false, still: true, id: e.pointerId };
      if (this.controls) this.controls.enabled = false;
    }
  }
  up(e) {
    if (e.button !== 0 || (this.press && e.pointerId !== this.press.id)) return;
    const p = this.press; this.press = null;
    const wasDrag = this.drag; this.drag = null; if (wasDrag && this.controls && !this.gliding) this.controls.enabled = true;
    if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > (p.type === 'mouse' ? 6 : 12) || performance.now() - p.t > 700) return;   // (a drag or a long press: the camera's; a finger wobbles more)
    this.userMoved = p.um;                                              // (a tap moved nothing: the 'start' it gave the camera's controls is forgotten)
    if (!this.enabled()) return;
    const s = this.screenAt(e.clientX, e.clientY);
    if (s) { if (s.part === 'prev') this.step(-1); else if (s.part === 'next') this.step(1); else if (s.part === 'close') this.close();
      else if (s.part === 'visit') { const l = p.link || this.slideLink(); if (l) window.open(l, '_blank', 'noopener'); }   // (the link as it was when pressed)
      else if (s.part && s.part.startsWith('link:')) window.open(s.part.slice(5), '_blank', 'noopener'); return; }
    const t = this.landmarkAt(e.clientX, e.clientY);
    if (!t) { this.armed = null; this.hover(null); if (this.isOpen) this.close(); return; }
    // a touch: the first tap names it, a second opens it
    if (p.type !== 'mouse' && !(this.armed && this.armed.id === t.id) && !(this.isOpen && this.cur && this.cur.id === t.id)) {
      this.armed = { id: t.id, at: performance.now() }; this.hover(t); return; }
    this.armed = null; this.hover(null);
    if (!(this.isOpen && this.cur && this.cur.id === t.id)) this.present(t.id, t);
  }
  touched() { this.auto = Infinity; }                                   // (someone's reading: the slides stop moving on by themselves)
  pxPerScreenPx() {                                                     // (how many canvas pixels one screen pixel of drag covers)
    const r = this.dom.getBoundingClientRect(), d = this.camera.position.distanceTo(this.screen.getWorldPosition(this.v));
    const worldPerPx = 2 * d * Math.tan(this.camera.fov * Math.PI / 360) / r.height; return worldPerPx / (this.screen.scale.x / W);
  }

  // ── open, close, slides ──────────────────────────────────────────────────────────────────────────────────────
  present(id, target) {
    const l = this.byId.get(id); if (!l) return;
    target = target || this.targets().find((t) => t.id === id); if (!target) return;
    const box = target.box, size = box.getSize(this.v), wide = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.55, 6, 11);
    this.cur = l; this.slide = 0; this.scroll = 0; this.auto = AUTO; this.dirty = true; this.grow = 0; this.lines = null; this.textLinks = [];
    this.fz = this.camera.aspect < 0.8 ? 1.4 : 1;                       // (a phone held upright: the screen fills its width, so bigger type)
    this.size = wide; const h = wide * H / W;
    this.anchor = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    this.centre = this.anchor.clone().add(new THREE.Vector3(0, RACKET_DOWN * wide + 0.2, 0));   // (the handle's foot just over the landmark)
    const col = new THREE.Color(l.color || '#59d8ff'); this.field.material.uniforms.uColor.value.copy(col);
    this.screen.scale.setScalar(wide); this.field.scale.setScalar(wide); this.field.position.z = -0.5;
    this.state = 'opening'; this.t = 0; this.isOpen = true; this.group.visible = true; this.screenMat.opacity = 0; this.hit = false;
    for (const s of l.pictures || []) this.image(s.img);
    this.glideTo(h);
  }
  close() {
    if (!this.isOpen) return;
    this.from = { show: this.screenMat.opacity, grow: this.grow == null ? 1 : this.grow };   // (closing from wherever the opening had got to)
    this.state = 'closing'; this.t = 0; this.isOpen = false; this.setCursor(''); this.overScreen = false; if (this.controls) this.controls.enableZoom = true;
    if (this.back && !this.userMoved) this.glide(this.back.pos, this.back.target, 1.0);
    this.back = null;
  }
  step(d) { const n = (this.cur.pictures || []).length; if (!n) return; this.slide = (this.slide + d + n) % n; this.dirty = true; this.auto = this.auto === Infinity ? Infinity : AUTO; }   // (the pictures only: the write-up stays where it was read to)
  scrollBy(px) { const max = Math.max(0, (this.textH || 0) - (this.textView || 0)); const s = THREE.MathUtils.clamp((this.scroll || 0) + px, 0, max); if (s !== this.scroll) { this.scroll = s; this.dirty = true; } }
  slideLink() { const s = (this.cur.pictures || [])[this.slide]; return (s && s.link) || this.cur.link || null; }
  image(src) {
    if (!src || this.imgs.has(src)) return this.imgs.get(src);
    const im = new Image(); im.decoding = 'async'; im.onload = () => { this.dirty = true; }; im.src = src; this.imgs.set(src, im); return im;
  }
  // the camera to face the screen, far enough back to take it all in (and back to where it was on closing)
  glideTo(h) {
    const cam = this.camera, fov = cam.fov * Math.PI / 180, aspect = cam.aspect, w = this.size;
    const d = Math.max(h / 2 / Math.tan(fov / 2) / 0.84, w / 2 / (Math.tan(fov / 2) * aspect) / 0.9);
    const flat = new THREE.Vector3(cam.position.x - this.centre.x, 0, cam.position.z - this.centre.z); if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1); flat.normalize();
    const pos = this.centre.clone().addScaledVector(flat, d).add(new THREE.Vector3(0, -h * 0.04, 0));
    if (!this.back) this.back = { pos: cam.position.clone(), target: this.controls ? this.controls.target.clone() : this.centre.clone() };
    this.userMoved = false; this.glide(pos, this.centre.clone(), 1.2);
  }
  glide(pos, target, secs) { this.gl = { p0: this.camera.position.clone(), t0: this.controls ? this.controls.target.clone() : new THREE.Vector3(), p1: pos, t1: target, k: 0, secs }; this.gliding = true; if (this.controls) this.controls.enabled = false; }

  update(dt) {
    this.time += dt;
    if (this.gl) {                                                       // (the camera's glide, eased at both ends)
      const g = this.gl; g.k = this.enabled() ? Math.min(1, g.k + dt / g.secs) : 1; const e = g.k * g.k * (3 - 2 * g.k);   // (the Build bar opened: done at once, the camera free for its tools)
      this.camera.position.lerpVectors(g.p0, g.p1, e); if (this.controls) { this.controls.target.lerpVectors(g.t0, g.t1, e); this.controls.update(); } else this.camera.lookAt(g.t1);
      if (g.k >= 1) { this.gl = null; this.gliding = false; if (this.controls && !this.drag) this.controls.enabled = true; }
    }
    if (this.armed && performance.now() - this.armed.at >= 5000) { this.armed = null; this.hover(null); }   // (the second tap's chance gone)
    if (this.hovered && !this.enabled()) { this.armed = null; this.hover(null); }
    if (this.hovered) this.placeLabel();
    if (this.isOpen && !this.enabled()) this.close();                   // (the Build bar opened: editing, not visiting)
    if (this.state === 'closed') return;
    this.t += dt; const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    let grow = 1, show = 1;
    if (this.state === 'opening') { grow = ease(this.t / 0.55); show = this.t < 0.55 ? 0 : Math.min(1, (this.t - 0.55) / 0.35) * (0.75 + 0.25 * Math.sin(this.t * 60) * (this.t < 0.9 ? 1 : 0));
      if (this.t > 0.55 && !this.hit) { this.hit = true; pushShieldHit(this.field.material, new THREE.Vector3(0, -1, 0), this.time); }   // (a ripple from its point)
      if (this.t > 0.95) this.state = 'open'; }
    else if (this.state === 'closing') { show = this.from.show * Math.max(0, 1 - this.t / 0.2); grow = this.from.grow * (1 - ease(this.t / 0.4)); if (this.t > 0.45) { this.state = 'closed'; this.group.visible = false; return; } }
    this.grow = grow;
    // the screen and its field rise out of the landmark, facing the camera (upright: turned about the up axis only)
    this.holder.position.lerpVectors(this.anchor, this.centre, grow); this.holder.scale.setScalar(Math.max(0.02, grow));
    this.holder.rotation.y = Math.atan2(this.camera.position.x - this.holder.position.x, this.camera.position.z - this.holder.position.z);
    stepShield(this.field.material, this.time, 1);
    this.screenMat.opacity = show;
    if (this.state === 'open' && (this.auto -= dt) <= 0) { this.step(1); this.auto = AUTO; }
    if (this.dirty && show > 0) { this.dirty = false; this.draw(); }
  }

  // ── the screen's picture ─────────────────────────────────────────────────────────────────────────────────────
  draw() {
    const c = this.ctx, l = this.cur, pics = l.pictures || [], n = pics.length, s = pics[this.slide] || {}, k = this.scale, col = l.color || '#59d8ff', z = this.fz;   // (z: the type's size, bigger on a phone)
    c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H);
    // the frame: a faint glass behind everything, a glowing edge
    round(c, 4, 4, W - 8, H - 8, 26); c.fillStyle = 'rgba(8, 26, 38, 0.38)'; c.fill(); c.lineWidth = 3; c.strokeStyle = rgba(col, 0.75); c.shadowColor = col; c.shadowBlur = 14; c.stroke(); c.shadowBlur = 0;
    // the thin buttons either side
    for (const [x, dir, part] of [[8, -1, 'prev'], [W - SIDE + 4 - 8, 1, 'next']]) {
      round(c, x, PIC.y, SIDE - 4, H - PIC.y * 2, 18); c.fillStyle = rgba(col, this.hot === part ? 0.32 : 0.14); c.fill();
      const cx = x + (SIDE - 4) / 2, cy = H / 2; c.beginPath(); c.moveTo(cx - 7 * dir, cy - 18); c.lineTo(cx + 7 * dir, cy); c.lineTo(cx - 7 * dir, cy + 18);
      c.lineWidth = 5; c.lineCap = c.lineJoin = 'round'; c.strokeStyle = this.hot === part ? '#ffffff' : '#bff0ff'; c.stroke(); }
    // the picture (cut to fill its 16:9 box), with a hologram's faint scan lines
    c.save(); round(c, PIC.x, PIC.y, PIC.w, PIC.h, 14); c.clip();
    c.fillStyle = '#071219'; c.fillRect(PIC.x, PIC.y, PIC.w, PIC.h);
    const im = s.img ? this.image(s.img) : null;
    if (im && im.complete && im.naturalWidth) { const r = Math.max(PIC.w / im.naturalWidth, PIC.h / im.naturalHeight), iw = im.naturalWidth * r, ih = im.naturalHeight * r;
      c.drawImage(im, PIC.x + (PIC.w - iw) / 2, PIC.y + (PIC.h - ih) / 2, iw, ih); }
    else { c.fillStyle = rgba(col, 0.7); c.font = `500 28px ${FONT}`; c.textAlign = 'center'; c.fillText(n ? 'loading…' : 'pictures to come', PIC.x + PIC.w / 2, PIC.y + PIC.h / 2); c.textAlign = 'left'; }
    c.fillStyle = 'rgba(160, 230, 255, 0.05)'; for (let y = PIC.y; y < PIC.y + PIC.h; y += 4) c.fillRect(PIC.x, y, PIC.w, 1);
    const g = c.createLinearGradient(0, PIC.y + PIC.h - 90, 0, PIC.y + PIC.h); g.addColorStop(0, 'rgba(4, 12, 18, 0)'); g.addColorStop(1, 'rgba(4, 12, 18, 0.75)'); c.fillStyle = g; c.fillRect(PIC.x, PIC.y + PIC.h - 90, PIC.w, 90);
    c.restore();
    // its caption, the dots (where it is among them), the ×
    const dw = Math.min(22, 300 / Math.max(1, n)), dotsW = n > 1 ? (n - 1) * dw + 40 : 0;
    if (s.caption) { c.font = `600 ${Math.round(26 * z)}px ${FONT}`; c.fillStyle = '#ffffff'; c.fillText(fit(c, s.caption, PIC.w - 36 - dotsW), PIC.x + 18, PIC.y + PIC.h - 18); }
    if (n > 1) for (let i = 0; i < n; i++) { c.beginPath(); c.arc(PIC.x + PIC.w - 24 - (n - 1 - i) * dw, PIC.y + PIC.h - 26, i === this.slide ? 6 : 4, 0, Math.PI * 2); c.fillStyle = i === this.slide ? '#ffffff' : rgba(col, 0.7); c.fill(); }
    this.closeBox = { x: PIC.x + PIC.w - 62, y: PIC.y + 12, w: 50, h: 50 };
    c.beginPath(); c.arc(this.closeBox.x + 25, this.closeBox.y + 25, 23, 0, Math.PI * 2); c.fillStyle = this.hot === 'close' ? 'rgba(255,255,255,0.3)' : 'rgba(4, 12, 18, 0.6)'; c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.beginPath(); c.moveTo(this.closeBox.x + 16, this.closeBox.y + 16); c.lineTo(this.closeBox.x + 34, this.closeBox.y + 34); c.moveTo(this.closeBox.x + 34, this.closeBox.y + 16); c.lineTo(this.closeBox.x + 16, this.closeBox.y + 34); c.stroke();
    // the panel: solid; the project's title (and a Visit button), its subtitle, when and with what, then the write-up, which scrolls
    round(c, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 16); c.fillStyle = '#0d1b26'; c.fill(); c.lineWidth = 2; c.strokeStyle = rgba(col, 0.35); c.stroke();
    const x0 = PANEL.x + 30, x1 = PANEL.x + PANEL.w - 30, link = this.slideLink();
    let y = PANEL.y + 58 * z;
    const bh = Math.round(46 * z); c.font = `700 ${Math.round(24 * z)}px ${FONT}`; const bw = link ? c.measureText('Visit  ↗').width + 36 * z : 0;
    c.font = `700 ${Math.round(42 * z)}px ${FONT}`; const tw = (link ? x1 - bw - 20 : x1) - x0;
    for (const line of wrap(c, l.title || l.label, tw).slice(0, 2)) { c.fillStyle = '#ffffff'; c.fillText(line, x0, y); y += 50 * z; }
    if (l.subtitle) { c.font = `600 ${Math.round(30 * z)}px ${FONT}`; c.fillStyle = '#cfeaf6'; for (const line of wrap(c, l.subtitle, x1 - x0).slice(0, 2)) { c.fillText(line, x0, y - 6); y += 40 * z; } }
    if (link) { c.font = `700 ${Math.round(24 * z)}px ${FONT}`; this.visitBox = { x: x1 - bw, y: PANEL.y + 22, w: bw, h: bh };
      round(c, this.visitBox.x, this.visitBox.y, bw, bh, bh / 2); c.fillStyle = this.hot === 'visit' ? col : rgba(col, 0.22); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      c.fillStyle = this.hot === 'visit' ? '#04121a' : '#e8fbff'; c.fillText('Visit  ↗', this.visitBox.x + 18 * z, this.visitBox.y + bh * 0.67); } else this.visitBox = null;
    const meta = [l.dates, l.madeWith].filter(Boolean).join('   ·   ');
    if (meta) { c.font = `500 ${Math.round(25 * z)}px ${FONT}`; c.fillStyle = rgba(col, 0.95); for (const line of wrap(c, meta, x1 - x0)) { c.fillText(line, x0, y - 8); y += 34 * z; } }
    y += 6; c.fillStyle = rgba(col, 0.3); c.fillRect(x0, y - 18, x1 - x0, 2);
    // the write-up, laid out once a landmark, drawn from where it's scrolled to (its link headings noted where they show, for the pointer)
    const top = y, bottom = PANEL.y + PANEL.h - 18; this.textView = bottom - top;
    const lines = this.lines && this.linesFor === l ? this.lines : (this.lines = layout(c, l.text || '', x1 - x0 - 14, z), this.linesFor = l, this.lines);
    this.textH = lines.length ? lines[lines.length - 1].y + 40 * z : 0; this.textLinks = [];
    c.save(); c.beginPath(); c.rect(PANEL.x, top - 8, PANEL.w, bottom - top + 8); c.clip();
    for (const ln of lines) { const ly = top + 22 * z + ln.y - this.scroll; if (ly < top - 60 || ly > bottom + 60) continue;
      c.font = ln.font; const hot = ln.url && this.hot === 'link:' + ln.url;
      if (ln.dot) { c.beginPath(); c.arc(x0 + 8, ly - 10, 5, 0, Math.PI * 2); c.fillStyle = col; c.fill(); }
      c.fillStyle = ln.kind === 'h1' ? '#ffffff' : ln.kind === 'h2' ? col : ln.kind === 'meta' ? rgba(col, 0.85) : '#d6e6ee'; if (hot) c.fillStyle = '#ffffff';
      c.fillText(ln.t, x0 + ln.x, ly);
      if (ln.url) { const w = c.measureText(ln.t).width; if (hot) c.fillRect(x0 + ln.x, ly + 6, w, 2);
        const y0 = Math.max(ly - ln.size, top - 8), y1 = Math.min(ly + ln.size * 0.35, bottom);   // (only the part that shows can be clicked)
        if (ly > top && ly - ln.size * 0.75 < bottom && y1 > y0) this.textLinks.push({ x: x0 + ln.x - 6, y: y0, w: w + 12, h: y1 - y0, url: ln.url }); } }
    c.restore();
    // more below (or above): a fade and a thin bar
    if (this.textH > this.textView) {
      const bh = Math.max(40, this.textView * this.textView / this.textH), by = top + (this.textView - bh) * (this.scroll / (this.textH - this.textView));
      round(c, PANEL.x + PANEL.w - 12, by, 5, bh, 3); c.fillStyle = rgba(col, 0.6); c.fill();
      if (this.scroll < this.textH - this.textView - 2) { const f = c.createLinearGradient(0, bottom - 46, 0, bottom); f.addColorStop(0, 'rgba(13, 27, 38, 0)'); f.addColorStop(1, 'rgba(13, 27, 38, 1)'); c.fillStyle = f; c.fillRect(PANEL.x + 4, bottom - 46, PANEL.w - 20, 46); }
    }
    this.tex.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.group); this.label.remove(); this.tex.dispose(); this.screenMat.dispose(); this.field.material.dispose(); this.field.geometry.dispose(); }
}

const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
function rgba(hex, a) { const n = parseInt(String(hex).replace('#', ''), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }   // ('#rrggbb' as written: three's Color would hand back linear values)
function round(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function wrap(c, text, w) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/)) { if (!word) continue; const t = line ? line + ' ' + word : word; if (c.measureText(t).width > w && line) { out.push(line); line = word; } else line = t; }
  if (line) out.push(line); return out;
}
// the write-up in lines: paragraphs (a blank line between); '# ' and '## ' headings (ending ' [url]': a link), '> ' a line of
// when and with what, '- ' or '• ' a list with a dot. Each line keeps its kind, font and size for drawing
const KIND = { h1: [700, 36, 48, 18, 4], h2: [600, 31, 42, 6, 4], meta: [500, 25, 34, 0, 12], body: [400, 30, 42, 0, 20] };   // weight, size, line height, room above, room after its paragraph
function layout(c, text, w, z = 1) {
  const out = []; let y = 0;
  for (const para of String(text).split(/\n\s*\n/)) {
    let kind = 'body';
    for (const raw of para.split('\n')) {
      kind = /^#\s/.test(raw) ? 'h1' : /^##\s/.test(raw) ? 'h2' : /^>\s/.test(raw) ? 'meta' : 'body';
      let body = raw.replace(/^(#{1,2}|>)\s+/, ''), url = null;
      if (kind === 'h1' || kind === 'h2') { const m = body.match(/\s*\[(\S+)\]\s*$/); if (m) { url = m[1]; body = body.slice(0, m.index) + '  ↗'; } }
      const dot = kind === 'body' && /^\s*[-•]\s+/.test(body); if (dot) body = body.replace(/^\s*[-•]\s+/, '');
      const [wt, sz, lh, above] = KIND[kind], size = Math.round(sz * z), font = `${wt} ${size}px ${FONT}`, indent = dot ? 28 : 0;
      if (out.length) y += above * z;
      c.font = font;
      wrap(c, body, w - indent).forEach((t, i) => { out.push({ t, x: indent, y, dot: dot && i === 0, kind, font, size, url }); y += lh * z; });
    }
    y += KIND[kind][4] * z;
  }
  return out;
}
// one line cut to a width, with an ellipsis if it had to be
function fit(c, text, w) { if (c.measureText(text).width <= w) return text; let t = text; while (t.length > 1 && c.measureText(t + '…').width > w) t = t.slice(0, -1); return t.trimEnd() + '…'; }
