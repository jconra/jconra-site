// PLANT TOOL: hand planting in the Terrain Lab. A bar along the bottom (plantBar.js) picks a plant and a tool:
//   Paint      drag a brush to scatter the chosen plant (thickness: plants a square metre); kept as the stroke, not the plants
//   Clear      drag to keep every plant out of the ground brushed (the land's own and painted ones)
//   Place one  click to stand one plant on the ground, or on whatever the mouse is over (a roof, a wall top)
//   Select     click a placed plant; the gizmo (gizmo.js) moves, turns and sizes it along each axis
// The planting (planting.js) is kept in this browser and copied out as text. The page grows the painted plants with
// its own (paintedPlants, keepProcedural), so they get its imposters, wind and shade; the placed ones are drawn here,
// one instanced mesh a kind.
//
//   new PlantTool({ renderer, scene, camera, controls, dom, heightAt, groundAt, surfaces, parts, materials, kinds, sizeOf, changed, opened })
//     groundAt(clientX, clientY) -> Vector3 | null: the land under the mouse; surfaces(): extra things to place onto (meshes)
//     parts[k]: kind k's geometry (base at y 0); materials[k]: its material; kinds: [{ id, name, group }] (ids 0..n-1,
//     an id past the parts is drawn by the page alone, e.g. the lawn); sizeOf(k): its usual size
//     changed(planting, index): the planting changed (the page lays its plants again); opened(on): the bar opened or hid
//   tool.update() each frame; tool.planting, tool.index; tool.active (the bar open)
import * as THREE from 'three';
import { Gizmo } from './gizmo.js';
import { PlantBar } from './plantBar.js';
import { emptyPlanting, normalisePlanting, loadPlanting, savePlanting, PlantIndex, PlantingHistory, newId, newSeed } from './planting.js';

const DEG = Math.PI / 180;

export class PlantTool {
  constructor(o) {
    Object.assign(this, o);
    this.planting = normalisePlanting(loadPlanting() || o.initial || emptyPlanting());
    this.index = new PlantIndex(this.planting);
    this.history = new PlantingHistory(this.planting);
    this.sel = null; this.stroke = null; this.painting = null; this.down = null; this.fingers = new Set();
    this.ray = new THREE.Raycaster();
    // the placed plants: one instanced mesh a kind
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.meshes = this.parts.map((g, k) => { const m = new THREE.InstancedMesh(g, this.materials[k], 256); m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = !!o.shadows; m.userData.kind = k; this.group.add(m); return m; });
    // the brush: a ring on the ground (green paint, red clear) and the stroke's trail
    const ringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(65 * 3), 3));
    this.ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x35e07d, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 998; this.ring.frustumCulled = false; this.ring.visible = false; this.scene.add(this.ring);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x35e07d, depthTest: false, transparent: true, opacity: 0.5 }));
    this.trail.renderOrder = 997; this.trail.frustumCulled = false; this.scene.add(this.trail);
    // the gizmo moves a stand-in; its changes are copied to the selected plant
    this.proxy = new THREE.Object3D();
    this.gizmo = new Gizmo({ camera: this.camera, dom: this.dom, scene: this.scene, controls: this.controls });
    this.bar = new PlantBar({ kinds: this.kinds, onChange: (s, key) => this.barChanged(s, key), onAction: (a) => this.action(a) });
    this.bar.setState({ open: false, procedural: this.planting.procedural });
    this.makeIcons();
    this.listen();
    this.syncItems(); this.syncUndo();
  }
  get active() { return !!this.bar.state.open; }
  // open or hide the bar from outside (the town editor taking over): as if its own button was pressed, so the
  // chosen plant is let go and the page hears of it
  setOpen(on) { if (this.active === !!on) return; this.bar.setState({ open: !!on }); this.barChanged({ ...this.bar.state }, 'open'); }
  get st() { return this.bar.state; }

  // ── the bar ──
  barChanged(s, key) {
    if (key === 'open') { if (!s.open) { this.select(null); this.ring.visible = false; this.dom.style.cursor = ''; } if (this.opened) this.opened(s.open); }
    if (key === 'mode') { if (s.mode !== 'select' && s.mode !== 'place') this.select(null); this.dom.style.cursor = s.mode === 'paint' || s.mode === 'clear' || s.mode === 'place' ? 'crosshair' : ''; this.ring.visible = false; }
    if (key === 'gizmo') this.gizmo.mode = s.gizmo;
    if (key === 'procedural') { this.before(); this.planting.procedural = s.procedural; this.commit(); }
    if (key === 'clearRadius' && this.sel) { const it = this.item(this.sel); if (it) { this.before(true); it.clear = s.clearRadius; this.commit(); } }
  }
  action(a) {
    if ((a === 'undo' || a === 'redo') && this.gizmo.dragging) return;   // (not in the middle of a drag)
    if (a === 'undo' || a === 'redo') {                                  // (the chosen plant stays chosen, if it is still there)
      const keep = this.sel, p = a === 'undo' ? this.history.undo() : this.history.redo();
      if (p) { this.replace(p, false); if (keep && this.item(keep)) this.select(keep); }
    }
    else if (a === 'delete') this.removeSel();
    else if (a === 'copy') this.copy();
    else if (a === 'paste') this.paste();
    else if (a === 'reset') this.replace({ ...emptyPlanting(), procedural: this.planting.procedural }, true);   // (the bar asks for a second press first; the land's own plants stay as they were)
  }
  async copy() {
    const text = JSON.stringify(this.planting);
    try { await navigator.clipboard.writeText(text); this.bar.setInfo('Copied. Paste it in chat to make it the planting everyone sees.'); }
    catch (e) { prompt('Copy the planting:', text); }
  }
  async paste() {
    let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the planting here') || ''; }
    let o = null; try { o = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!o || !Array.isArray(o.strokes)) { this.bar.setInfo("That isn't a planting."); return; }
    this.replace(normalisePlanting(o), true); this.bar.setInfo('Pasted.');
  }
  replace(p, snapshot) {                                                 // snapshot: a change of its own (Start over, Paste), not undo / redo
    if (snapshot) this.before();
    this.select(null); this.planting = p; this.history.planting = p;
    this.bar.setState({ procedural: p.procedural }); this.commit();
  }

  // ── changes ──
  // before(): the planting as it is, kept for undo, JUST BEFORE each change. (Taken after a change instead, an undo
  // followed by a new change loses the step between: PlantingHistory drops the copy it goes back to.) A slider's run
  // of changes (sliding = true) is one step: kept once, at its start
  before(sliding = false) {
    const go = !sliding || !this.sliding;
    if (sliding) { clearTimeout(this.sliding); this.sliding = setTimeout(() => { this.sliding = 0; }, 800); }
    if (go) { this.history.planting = this.planting; this.history.snapshot(); }
  }
  commit() {                                                             // after a change: saved, laid again, drawn
    this.index = new PlantIndex(this.planting);
    savePlanting(this.planting); this.syncItems(); this.syncUndo();
    if (this.changed) this.changed(this.planting, this.index);
    const n = this.planting.strokes.length, m = this.planting.items.length;
    this.bar.setInfo(`${n} stroke${n === 1 ? '' : 's'}, ${m} placed plant${m === 1 ? '' : 's'} · saved in this browser`);
  }
  syncUndo() { this.bar.setUndo(this.history.canUndo, this.history.canRedo); }
  item(id) { return this.planting.items.find((i) => i.id === id); }
  matrixOf(it, out = new THREE.Matrix4()) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.rx * DEG, it.ry * DEG, it.rz * DEG, 'YXZ'));
    return out.compose(new THREE.Vector3(it.x, this.heightAt(it.x, it.z) + it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
  }
  syncItems() {                                                          // the placed plants into their kinds' meshes
    const per = this.meshes.map(() => []);
    for (const it of this.planting.items) if (per[it.kind]) per[it.kind].push(it);
    const M = new THREE.Matrix4();
    per.forEach((list, k) => {
      let mesh = this.meshes[k];
      if (list.length > mesh.instanceMatrix.count) { this.group.remove(mesh); mesh.dispose(); mesh = this.meshes[k] = new THREE.InstancedMesh(this.parts[k], this.materials[k], Math.ceil(list.length * 1.5)); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = !!this.shadows; mesh.userData.kind = k; this.group.add(mesh); }
      mesh.userData.ids = list.map((it) => it.id); mesh.visible = list.length > 0;   // (an empty kind is no draw at all)
      list.forEach((it, i) => mesh.setMatrixAt(i, this.matrixOf(it, M)));
      mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    });
  }
  removeSel() {
    if (!this.sel) return;
    this.before(); this.planting.items = this.planting.items.filter((i) => i.id !== this.sel); this.select(null); this.commit();
  }

  // ── selecting and the gizmo ──
  select(id) {
    this.sel = id; this.dragFrom = null; const it = id && this.item(id);
    if (!it) { this.sel = null; this.gizmo.detach(); return; }
    this.toProxy(it);
    this.gizmo.mode = this.st.gizmo;
    this.gizmo.attach(this.proxy, { onChange: () => this.fromProxy(it, false), onCommit: () => this.fromProxy(it, true) });
    this.bar.setState({ clearRadius: it.clear });
  }
  toProxy(it) {
    this.proxy.position.set(it.x, this.heightAt(it.x, it.z) + it.y, it.z);
    this.proxy.quaternion.setFromEuler(new THREE.Euler(it.rx * DEG, it.ry * DEG, it.rz * DEG, 'YXZ'));
    this.proxy.scale.set(it.sx, it.sy, it.sz); this.proxy.updateMatrix();
  }
  // the gizmo moved the stand-in: the plant follows. The gizmo slides it at one height, but the land rises and falls,
  // so across the ground the plant keeps its height ABOVE THE GROUND (on a slope it stays on the slope, not floating
  // off it or sunk in); only the up arm (green) lifts or lowers it, by however far that arm was dragged
  fromProxy(it, done) {
    if (done) { this.dragFrom = null; this.commit(); return; }           // (let go: the last move already set the plant)
    const p = this.proxy.position, e = new THREE.Euler().setFromQuaternion(this.proxy.quaternion, 'YXZ');
    if (!this.dragFrom) { this.before(); this.dragFrom = { y: it.y, wy: this.heightAt(it.x, it.z) + it.y }; }   // (the first move of a drag: the plant is still where it started)
    it.x = +p.x.toFixed(2); it.z = +p.z.toFixed(2); it.y = +(this.dragFrom.y + p.y - this.dragFrom.wy).toFixed(2);
    p.y = this.heightAt(it.x, it.z) + it.y;                              // (the gizmo stays on the plant; it starts each move afresh from where the drag began)
    it.rx = +(e.x / DEG).toFixed(1); it.ry = +(e.y / DEG).toFixed(1); it.rz = +(e.z / DEG).toFixed(1);
    it.sx = +Math.max(0.05, this.proxy.scale.x).toFixed(3); it.sy = +Math.max(0.05, this.proxy.scale.y).toFixed(3); it.sz = +Math.max(0.05, this.proxy.scale.z).toFixed(3);
    this.syncItems();
  }
  // the placed plant under the pointer. A small plant far off is a few pixels of thin leaves, so when nothing is hit
  // square on, the one whose middle is nearest on screen is taken if it is close enough (further for a finger)
  pick(cx, cy, finger = false) {
    this.setRay(cx, cy);
    const hit = this.ray.intersectObjects(this.meshes.filter((m) => m.count), false)[0];
    if (hit && hit.instanceId != null) return hit.object.userData.ids[hit.instanceId];
    const r = this.dom.getBoundingClientRect(), v = new THREE.Vector3(); let best = null, near = finger ? 30 : 14;
    for (const it of this.planting.items) {
      const g = this.parts[it.kind]; if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      v.set(it.x, this.heightAt(it.x, it.z) + it.y + g.boundingBox.max.y * it.sy * 0.5, it.z).project(this.camera);
      if (v.z < -1 || v.z > 1) continue;                                 // (behind the camera)
      const d = Math.hypot(r.left + (v.x + 1) / 2 * r.width - cx, r.top + (1 - v.y) / 2 * r.height - cy);
      if (d < near) { near = d; best = it.id; }
    }
    return best;
  }
  setRay(cx, cy) { const r = this.dom.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera); }
  // where a new plant stands: on a building or prop the mouse is over if it's nearer than the land, else on the land.
  // A roof or wall top takes it as it is; a wall (a face that doesn't look up) stands it on whatever is just below the
  // spot clicked, a little out from the wall: a ledge, a porch, or the land at the wall's foot.
  surfaceAt(cx, cy) {
    const g = this.groundAt(cx, cy); this.setRay(cx, cy);
    const extra = this.surfaces ? this.surfaces() : [];
    const shown = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return !o.material || [].concat(o.material).every((m) => m.visible !== false); };
    const ok = (h) => shown(h.object) && h.face && h.face.normal && h.object.isMesh;
    const hit = extra.length ? this.ray.intersectObjects(extra, true).find(ok) : null;
    // (groundAt gives only the land's x and z: its height is read here, or a low roof seems further off than the land)
    const gd = g ? this.ray.ray.origin.distanceTo(new THREE.Vector3(g.x, this.heightAt(g.x, g.z), g.z)) : Infinity;
    if (!hit || hit.distance >= gd - 0.05) return g ? { x: g.x, z: g.z, y: 0 } : null;
    const n = this.normalOf(hit), above = (x, z, y) => ({ x, z, y: Math.max(0, y - this.heightAt(x, z)) });
    if (n.y >= 0.5) return above(hit.point.x, hit.point.z, hit.point.y);
    if (n.dot(this.ray.ray.direction) > 0) n.negate();                   // (the side facing the camera, whichever way the model's faces wind)
    const h = Math.hypot(n.x, n.z) || 1, x = hit.point.x + n.x / h * 0.3, z = hit.point.z + n.z / h * 0.3;
    this.ray.set(new THREE.Vector3(x, hit.point.y + 0.05, z), new THREE.Vector3(0, -1, 0));
    const below = this.ray.intersectObjects(extra, true).find((b) => ok(b) && this.normalOf(b).y >= 0.5);
    return above(x, z, below ? below.point.y : -Infinity);
  }
  normalOf(hit) {                                                        // a hit face's normal in the world (an instanced mesh's own copy turned too)
    const m = hit.object.matrixWorld.clone();
    if (hit.object.isInstancedMesh && hit.instanceId != null) { const im = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, im); m.multiply(im); }
    return hit.face.normal.clone().transformDirection(m);
  }
  place(cx, cy) {
    const p = this.surfaceAt(cx, cy), k = this.st.kind;
    if (k != null && !this.parts[k]) { this.bar.setInfo('That one can only be painted (choose Paint).'); return; }
    if (!p || k == null) return;
    const s = +(this.sizeOf(k) * this.st.size * (0.9 + 0.2 * Math.random())).toFixed(3);   // (rounded as a reload would: what's saved is what's shown)
    const it = { id: newId(), kind: k, x: +p.x.toFixed(2), y: +Math.max(0, p.y).toFixed(2), z: +p.z.toFixed(2), rx: 0, ry: +(Math.random() * 360 - 180).toFixed(1), rz: 0, sx: s, sy: s, sz: s, clear: this.st.clearRadius };
    this.before(); this.planting.items.push(it); this.commit();      // (not chosen: in Place mode its gizmo would sit where the next ones go; Select picks it up)
  }

  // ── the brush ──
  showRing(p, r, clear) {
    const a = this.ring.geometry.attributes.position;
    for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2, x = p.x + Math.cos(t) * r, z = p.z + Math.sin(t) * r; a.setXYZ(i, x, this.heightAt(x, z) + 0.15, z); }
    a.needsUpdate = true; this.ring.material.color.set(clear ? 0xff5a4a : 0x35e07d); this.ring.visible = true;
  }
  showTrail() {
    const s = this.stroke; if (!s) { this.trail.visible = false; return; }
    this.trail.geometry.dispose(); this.trail.geometry = new THREE.BufferGeometry().setFromPoints(s.pts.map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z) + 0.2, z)));
    this.trail.material.color.set(s.mode === 'clear' ? 0xff5a4a : 0x35e07d); this.trail.visible = true;
  }

  // ── input: the window's capture phase, so the tool goes before the camera and the town editor ──
  // One finger (or the mouse) paints, clears or picks. A second finger is always the camera's (a pinch or a two-finger
  // pan): if the first was painting, the stroke so far is kept if it was really under way, or dropped if it was only
  // the start of the pinch, and the camera is handed the first finger too. Place one places on a tap or click (a
  // press that doesn't wander), so a drag still turns the camera and a pinch places nothing.
  listen() {
    const onCanvas = (e) => e.target === this.dom;
    this.onDown = (e) => {
      if (this.relaying) return;                                           // (the first finger, handed to the camera: see handOver)
      if (!this.active || !onCanvas(e)) return;
      const first = !this.fingers.size; this.fingers.add(e.pointerId);
      if (first) { if (this.stroke) this.endStroke(); this.down = null; }   // (a press with nothing else down starts afresh, if a lift went missing)
      if (this.stroke && e.pointerId !== this.painting.id) { this.handOver(); return; }
      if (this.down && e.pointerId !== this.down.id) { this.down.multi = true; return; }
      if (!e.isPrimary || e.button !== 0 || this.gizmo.hovered || this.gizmo.dragging) return;   // (the gizmo's handles are its own)
      const m = this.st.mode;
      if (m === 'paint' || m === 'clear') {
        const g = this.groundAt(e.clientX, e.clientY); if (!g) return;
        this.stroke = { id: newId(), mode: m, kind: this.st.kind ?? 0, r: this.st.brush, density: this.st.density, size: this.st.size, seed: newSeed(), pts: [[+g.x.toFixed(2), +g.z.toFixed(2)]] };
        this.painting = { id: e.pointerId, t0: performance.now(), x: e.clientX, y: e.clientY };
        this.hold(e); this.showTrail();
      } else if (m === 'place') this.down = { x: e.clientX, y: e.clientY, id: e.pointerId, place: true };
      else if (m === 'select') {
        const id = this.pick(e.clientX, e.clientY, e.pointerType !== 'mouse');
        if (id) { this.select(id); e.stopPropagation(); e.preventDefault(); }
        else this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };    // a click on nothing (not a drag) lets go of the selection
      }
    };
    this.onMove = (e) => {
      if (!this.active || this.gizmo.dragging || this.relaying) return;
      const m = this.st.mode;
      if (m === 'paint' || m === 'clear') {
        if (this.stroke && e.pointerId !== this.painting.id) return;     // (only the finger that is painting)
        const g = this.groundAt(e.clientX, e.clientY);
        if (g && onCanvas(e) && e.isPrimary) this.showRing(g, this.st.brush, m === 'clear'); else if (!this.stroke) this.ring.visible = false;
        if (this.stroke) { this.painting.x = e.clientX; this.painting.y = e.clientY; }
        if (this.stroke && g) { const last = this.stroke.pts[this.stroke.pts.length - 1]; if (Math.hypot(g.x - last[0], g.z - last[1]) > Math.max(0.3, this.stroke.r * 0.25)) { this.stroke.pts.push([+g.x.toFixed(2), +g.z.toFixed(2)]); this.showTrail(); } }
      }
    };
    this.onUp = (e) => {
      this.fingers.delete(e.pointerId);
      if (this.stroke && e.pointerId === this.painting.id) this.endStroke();
      else if (this.down && e.pointerId === this.down.id) {
        const d = this.down, still = Math.hypot(e.clientX - d.x, e.clientY - d.y) < (e.pointerType === 'mouse' ? 5 : 10);
        this.down = null;
        if (d.place) { if (still && !d.multi && e.type === 'pointerup' && this.active) this.place(d.x, d.y); }
        else if (still && !d.multi && !this.gizmo.dragging) this.select(null);
      }
      if (e.pointerType !== 'mouse' && !this.stroke) this.ring.visible = false;   // (a finger lifted: there's no brush under it now)
    };
    this.onKey = (e) => {
      if (!this.active) return;
      const t = document.activeElement, typing = t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) && t.type !== 'range' && t.type !== 'checkbox' || t.isContentEditable);
      if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.action(e.shiftKey ? 'redo' : 'undo'); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.action('redo'); }
      else if ((k === 'delete' || k === 'backspace') && this.sel) { e.preventDefault(); this.removeSel(); }
      else if (k === 'escape') this.select(null);
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && this.sel && (k === '1' || k === '2' || k === '3')) { const g = ['translate', 'rotate', 'scale'][+k - 1]; this.bar.setState({ gizmo: g }); this.gizmo.mode = g; }   // (setState tells nobody: the gizmo is told here)
    };
    addEventListener('pointerdown', this.onDown, { capture: true });
    addEventListener('pointermove', this.onMove, { capture: true });
    addEventListener('pointerup', this.onUp, { capture: true });
    addEventListener('pointercancel', this.onUp, { capture: true });
    addEventListener('keydown', this.onKey);
  }
  hold(e) { this.controls.enabled = false; try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } e.stopPropagation(); e.preventDefault(); }
  release() { this.controls.enabled = true; }
  endStroke() { this.before(); this.planting.strokes.push(this.stroke); this.stroke = this.painting = null; this.release(); this.showTrail(); this.commit(); }
  // a second finger came down while the first was painting: the camera takes both (see listen)
  handOver() {
    const s = this.stroke, h = this.painting; this.stroke = this.painting = null;
    if (s.pts.length > 1 && performance.now() - h.t0 > 300) { this.before(); this.planting.strokes.push(s); this.commit(); }
    this.showTrail(); this.ring.visible = false; this.release();
    // the camera never heard of the first finger (the brush kept it): it is told now, at the finger's last spot; the
    // second finger's own press then goes on to it as usual
    this.relaying = true;
    try { this.dom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: h.id, pointerType: 'touch', isPrimary: true, clientX: h.x, clientY: h.y, button: 0, buttons: 1, bubbles: true, cancelable: true })); }
    catch (err) { /* an old browser: the pinch starts with the second finger alone */ }
    finally { this.relaying = false; }
  }

  // the bar's plant icons: each kind drawn small, from a little above, on a transparent ground
  makeIcons() {
    const S = 96, rt = new THREE.WebGLRenderTarget(S, S), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(1, 2, 1.5); scene.add(sun);
    const px = new Uint8Array(S * S * 4), cv = document.createElement('canvas'); cv.width = cv.height = S; const g2 = cv.getContext('2d'), img = g2.createImageData(S, S);
    const oldT = this.renderer.getRenderTarget(), oldC = this.renderer.getClearColor(new THREE.Color()), oldA = this.renderer.getClearAlpha();
    this.parts.forEach((geo, k) => {
      const m = new THREE.Mesh(geo, this.materials[k]); scene.add(m);
      geo.computeBoundingBox(); const b = geo.boundingBox, h = b.max.y - b.min.y, w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), d = Math.max(h, w) * 2.3;
      cam.position.set(d * 0.55, h * 0.5 + d * 0.45, d * 0.7); cam.lookAt(0, h * 0.45, 0);
      this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x000000, 0); this.renderer.clear(); this.renderer.render(scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);   // (the picture comes out upside down)
      g2.putImageData(img, 0, 0); this.bar.setIcon(k, cv.toDataURL());
      scene.remove(m);
    });
    this.renderer.setRenderTarget(oldT); this.renderer.setClearColor(oldC, oldA); rt.dispose();
    for (const kd of this.kinds) if (!this.parts[kd.id] && kd.icon) this.bar.setIcon(kd.id, kd.icon);
  }

  update() {
    this.gizmo.update();
  }
}
