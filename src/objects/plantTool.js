// PLANT TOOL: hand planting in the Terrain Lab. A bar along the bottom (plantBar.js) picks a plant and a tool:
//   Add        click to stand one plant on the ground, or on whatever the mouse is over (a roof, a wall top); drag a brush
//              to scatter the chosen plant (thickness: plants a square metre), kept as the stroke, not the plants
//   Clear      drag to keep every plant out of the ground brushed (the land's own and painted ones)
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
//     title: the bar's button ('Build'); town (optional): the page's town things (buildings, props, town trees, kept in its
//       own layout), for kinds carrying `town: 'model:kind'`: { pick(cx, cy) -> id, get(id), add(key, x, z), change(id,
//       fields, done), remove(id), snapshot(), undo(), redo() }; the gizmo slides, lifts, turns and sizes them
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
    this.sel = null; this.stroke = null; this.painting = null; this.down = null; this.fingers = new Set(); this.log = []; this.redoLog = [];
    this.ray = new THREE.Raycaster(); this.sinkM = new THREE.Matrix4();
    // the placed plants: one instanced mesh a kind
    this.group = new THREE.Group(); this.scene.add(this.group);
    // (a kind the page draws itself, as trees go into its forest: an unseen post a tree tall, only for picking it)
    this.kindOf = (k) => this.kinds.find((x) => x.id === k) || {};
    this.post = new THREE.CylinderGeometry(0.35, 0.35, 1, 6).translate(0, 0.5, 0); this.unseen = new THREE.MeshBasicMaterial({ visible: false });
    this.meshes = this.kinds.map((kd) => kd.id).map((k) => this.makeMesh(k, 256));
    // the brush: a ring on the ground (green paint, red clear) and the stroke's trail
    const ringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(65 * 3), 3));
    this.ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x35e07d, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 998; this.ring.frustumCulled = false; this.ring.visible = false; this.scene.add(this.ring);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x35e07d, depthTest: false, transparent: true, opacity: 0.5 }));
    this.trail.renderOrder = 997; this.trail.frustumCulled = false; this.scene.add(this.trail);
    // the gizmo moves a stand-in; its changes are copied to the selected plant
    this.proxy = new THREE.Object3D();
    this.gizmo = new Gizmo({ camera: this.camera, dom: this.dom, scene: this.scene, controls: this.controls });
    this.bar = new PlantBar({ kinds: this.kinds, title: o.title || 'Plants', onChange: (s, key) => this.barChanged(s, key), onAction: (a) => this.action(a) });
    this.bar.setState({ open: false, procedural: this.planting.procedural });
    this.makeIcons();
    this.listen();
    this.syncItems(); this.syncUndo();
  }
  makeMesh(k, n) {
    const picker = !this.parts[k], m = new THREE.InstancedMesh(picker ? this.post : this.parts[k], picker ? this.unseen : this.materials[k], n);
    m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = !picker && !!this.shadows; m.userData.kind = k; m.userData.picker = picker; this.group.add(m); return m;
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
    if (key === 'gizmo') { this.gizmo.mode = s.gizmo; this.limits(); }
    if (key === 'procedural') { this.before(); this.planting.procedural = s.procedural; this.commit(); }
    if (key === 'clearRadius' && this.sel) { const it = this.item(this.sel); if (it) { this.before(true); it.clear = s.clearRadius; this.commit(); } }
  }
  action(a) {
    if ((a === 'undo' || a === 'redo') && this.gizmo.dragging) return;   // (not in the middle of a drag)
    if (a === 'undo' || a === 'redo') {                                  // (the chosen thing stays chosen, if it is still there)
      const from = a === 'undo' ? this.log : this.redoLog, to = a === 'undo' ? this.redoLog : this.log, w = from.pop(), keep = this.sel;
      if (!w) return;
      to.push(w);
      if (w === 'T') { if (a === 'undo') this.town.undo(); else this.town.redo(); this.syncUndo(); if (keep && this.townItem(keep)) this.select(keep); else this.select(null); return; }
      const p = a === 'undo' ? this.history.undo() : this.history.redo();
      if (p) { this.replace(p, false); if (keep && (this.item(keep) || this.townItem(keep))) this.select(keep); }
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
    if (go) { this.history.planting = this.planting; this.history.snapshot(); this.log.push('P'); this.redoLog.length = 0; }
  }
  townBefore() { this.town.snapshot(); this.log.push('T'); this.redoLog.length = 0; this.syncUndo(); }   // (the town's own history keeps its copy)
  commit() {                                                             // after a change: saved, laid again, drawn
    this.index = new PlantIndex(this.planting);
    savePlanting(this.planting); this.syncItems(); this.syncUndo();
    if (this.changed) this.changed(this.planting, this.index);
    const n = this.planting.strokes.length, m = this.planting.items.length;
    this.bar.setInfo(`${n} stroke${n === 1 ? '' : 's'}, ${m} placed plant${m === 1 ? '' : 's'} · saved in this browser`);
  }
  syncUndo() { this.bar.setUndo(this.log.length > 0, this.redoLog.length > 0); }
  item(id) { return this.planting.items.find((i) => i.id === id); }
  // where a plant stands is where it meets the ground: its root clump below (sinkOf(kind), a share of its height), so it
  // turns and sizes about that point and the ground line stays put
  matrixOf(it, out = new THREE.Matrix4()) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.rx * DEG, it.ry * DEG, it.rz * DEG, 'YXZ')), g = this.parts[it.kind];
    out.compose(new THREE.Vector3(it.x, this.heightAt(it.x, it.z) + it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
    const sink = g && this.sinkOf ? this.sinkOf(it.kind) : 0;
    if (sink) { if (!g.boundingBox) g.computeBoundingBox(); out.multiply(this.sinkM.makeTranslation(0, -sink * g.boundingBox.max.y, 0)); }
    return out;
  }
  syncItems() {                                                          // the placed plants into their kinds' meshes
    const per = this.meshes.map(() => []), at = new Map(this.meshes.map((m, i) => [m.userData.kind, i]));
    for (const it of this.planting.items) if (at.has(it.kind)) per[at.get(it.kind)].push(it);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    per.forEach((list, i) => {
      let mesh = this.meshes[i]; const k = mesh.userData.kind;
      if (list.length > mesh.instanceMatrix.count) { this.group.remove(mesh); mesh.dispose(); mesh = this.meshes[i] = this.makeMesh(k, Math.ceil(list.length * 1.5)); }
      mesh.userData.ids = list.map((it) => it.id); mesh.visible = list.length > 0;   // (an empty kind is no draw at all)
      const h = this.kindOf(k).height || 10;                             // (a picking post: the tree's height, a third as wide)
      list.forEach((it, j) => mesh.setMatrixAt(j, mesh.userData.picker ? M.compose(new THREE.Vector3(it.x, this.heightAt(it.x, it.z) + it.y, it.z), Q.setFromAxisAngle(Y, 0), new THREE.Vector3(h * it.sx * 0.35, h * it.sy, h * it.sz * 0.35)) : this.matrixOf(it, M)));
      mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    });
  }
  townItem(sel) { return this.town && typeof sel === 'string' && sel.startsWith('T:') ? this.town.get(sel.slice(2)) : null; }
  removeSel() {
    if (!this.sel) return;
    if (this.townItem(this.sel)) { this.townBefore(); this.town.remove(this.sel.slice(2)); this.select(null); return; }
    this.before(); this.planting.items = this.planting.items.filter((i) => i.id !== this.sel); this.select(null); this.commit();
  }

  // ── selecting and the gizmo ──
  select(id) {
    this.sel = id; this.dragFrom = null;
    const t = this.townItem(id);
    if (t) {                                                             // a building, prop or town tree: slides, lifts, turns upright, sizes evenly
      this.proxy.position.set(t.x, this.heightAt(t.x, t.z) + (t.y || 0), t.z); this.proxy.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot * DEG); this.proxy.scale.set(1, 1, 1);
      this.townFrom = { size: t.size }; this.gizmo.mode = this.st.gizmo; this.limits();
      this.gizmo.attach(this.proxy, { onChange: () => this.fromTownProxy(id, false), onCommit: () => this.fromTownProxy(id, true) });
      return;
    }
    const it = id && this.item(id);
    if (!it) { this.sel = null; this.gizmo.detach(); return; }
    this.toProxy(it);
    this.gizmo.mode = this.st.gizmo; this.limits();
    this.gizmo.attach(this.proxy, { onChange: () => this.fromProxy(it, false), onCommit: () => this.fromProxy(it, true) });
    this.bar.setState({ clearRadius: it.clear });
  }
  // the gizmo's arms for the chosen thing: all of them, or for a kind with `upright` (a forest tree: the forest stands
  // them up straight and sizes them evenly) sliding across the ground, turning about the upright, sizing evenly
  limits() {
    const it = this.sel && this.item(this.sel), town = !!this.townItem(this.sel), up = town || (it && this.kindOf(it.kind).upright), m = this.gizmo.mode;
    this.gizmo.axes = !up ? { x: true, y: true, z: true } : m === 'translate' ? { x: true, y: town, z: true } : m === 'rotate' ? { x: false, y: true, z: false } : { x: true, y: true, z: true };
    this.gizmo.uniform = !!up && m === 'scale';
  }
  // the gizmo moved a town thing's stand-in: across the ground it keeps its height above the ground; the green arm lifts
  // or sinks it; it turns about the upright and sizes evenly. Shown as it goes; let go, the town lays its ground again
  fromTownProxy(sel, done) {
    const t = this.townItem(sel); if (!t) return;
    if (done) { this.dragFrom = null; this.town.change(sel.slice(2), {}, true); return; }
    const p = this.proxy.position;
    if (!this.dragFrom) { this.townBefore(); this.dragFrom = { y: t.y || 0, wy: this.heightAt(t.x, t.z) + (t.y || 0) }; }
    const x = +p.x.toFixed(2), z = +p.z.toFixed(2), y = +(this.dragFrom.y + p.y - this.dragFrom.wy).toFixed(2);
    p.y = this.heightAt(x, z) + y;
    const rot = +((new THREE.Euler().setFromQuaternion(this.proxy.quaternion, 'YXZ').y / DEG % 360 + 360) % 360).toFixed(1);
    this.town.change(sel.slice(2), { x, z, y, rot, size: +Math.max(0.05, this.townFrom.size * this.proxy.scale.x).toFixed(3) }, false);
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
    const hit = this.ray.intersectObjects(this.meshes.filter((m) => m.count), false)[0];   // (a picking post counts though unseen: three's picking doesn't look at visibility)
    if (hit && hit.instanceId != null) return hit.object.userData.ids[hit.instanceId];
    const r = this.dom.getBoundingClientRect(), v = new THREE.Vector3(); let best = null, near = finger ? 30 : 14;
    for (const it of this.planting.items) {
      const g = this.parts[it.kind], kh = this.kindOf(it.kind).height; if (!g && !kh) continue;
      if (g && !g.boundingBox) g.computeBoundingBox();
      v.set(it.x, this.heightAt(it.x, it.z) + it.y + (g ? g.boundingBox.max.y : kh) * it.sy * 0.5, it.z).project(this.camera);
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
    const p = this.surfaceAt(cx, cy), k = this.st.kind, kd = this.kindOf(k);
    if (kd.town) { const g = this.groundAt(cx, cy); if (!g) return; this.townBefore(); this.town.add(kd.town, +g.x.toFixed(2), +g.z.toFixed(2)); this.bar.setInfo(`Added: ${kd.name}. Select it to move, lift, turn or size it.`); return; }
    if (k != null && !this.parts[k] && !kd.height) { this.bar.setInfo('That one can only be painted (choose Paint).'); return; }
    if (!p || k == null) return;
    const s = +(this.sizeOf(k) * (this.unitOf ? this.unitOf(k) : 1) * this.st.size * (0.9 + 0.2 * Math.random())).toFixed(3);   // (unitOf: model units to metres, as the brush's plants get; rounded as a reload would)
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
        if (m === 'paint' && this.kindOf(this.st.kind).town) { this.down = { x: e.clientX, y: e.clientY, id: e.pointerId, place: true }; return; }   // (a building or prop: a click puts one down, a drag turns the camera)
        const g = this.groundAt(e.clientX, e.clientY); if (!g) return;
        this.stroke = { id: newId(), mode: m, kind: this.st.kind ?? 0, r: this.st.brush, density: +(this.st.density * (this.kindOf(this.st.kind ?? 0).densityScale || 1)).toPrecision(3), size: this.st.size, seed: newSeed(), pts: [[+g.x.toFixed(2), +g.z.toFixed(2)]] };
        this.painting = { id: e.pointerId, t0: performance.now(), x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, touch: e.pointerType !== 'mouse' };
        this.hold(e); this.showTrail();
      } else if (m === 'place') this.down = { x: e.clientX, y: e.clientY, id: e.pointerId, place: true };
      else if (m === 'select') {
        let id = this.pick(e.clientX, e.clientY, e.pointerType !== 'mouse');
        if (!id && this.town) { const t = this.town.pick(e.clientX, e.clientY); if (t) id = 'T:' + t; }   // (a building, prop or town tree)
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
      if (this.stroke && e.pointerId === this.painting.id) {
        // Add: a click that didn't wander puts one down (a kind that can stand alone: a plant, tree or rock); a drag paints
        const h = this.painting, k = this.stroke.kind, still = this.stroke.pts.length === 1 && Math.hypot(e.clientX - h.sx, e.clientY - h.sy) < (h.touch ? 10 : 5);
        if (still && this.stroke.mode === 'paint' && (this.parts[k] || this.kindOf(k).height)) { this.stroke = this.painting = null; this.release(); this.showTrail(); this.place(h.sx, h.sy); }
        else this.endStroke();
      }
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
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && this.sel && (k === '1' || k === '2' || k === '3')) { const g = ['translate', 'rotate', 'scale'][+k - 1]; this.bar.setState({ gizmo: g }); this.gizmo.mode = g; this.limits(); }   // (setState tells nobody: the gizmo is told here)
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
  // a kind's icon from any object (say a tree as loaded), for the kinds the page draws itself
  iconFrom(k, object) { this.makeIcons([[k, object]]); }
  makeIcons(only = null) {
    const S = 96, rt = new THREE.WebGLRenderTarget(S, S), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 2000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(1, 2, 1.5); scene.add(sun);
    const px = new Uint8Array(S * S * 4), cv = document.createElement('canvas'); cv.width = cv.height = S; const g2 = cv.getContext('2d'), img = g2.createImageData(S, S);
    const oldT = this.renderer.getRenderTarget(), oldC = this.renderer.getClearColor(new THREE.Color()), oldA = this.renderer.getClearAlpha();
    (only || this.parts.map((geo, k) => geo && [k, new THREE.Mesh(geo, this.materials[k])]).filter(Boolean)).forEach(([k, m]) => {
      const parent = m.parent, b = new THREE.Box3().setFromObject(m); scene.add(m);
      const h = b.max.y - b.min.y, w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), d = Math.max(h, w) * 2.3, c = b.getCenter(new THREE.Vector3());
      m.position.x -= c.x; m.position.z -= c.z; m.position.y -= b.min.y; m.updateMatrixWorld(true);
      cam.position.set(d * 0.55, h * 0.5 + d * 0.45, d * 0.7); cam.lookAt(0, h * 0.45, 0);
      this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x000000, 0); this.renderer.clear(); this.renderer.render(scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);   // (the picture comes out upside down)
      g2.putImageData(img, 0, 0); this.bar.setIcon(k, cv.toDataURL());
      scene.remove(m); m.position.set(0, 0, 0); if (parent) parent.add(m);
    });
    this.renderer.setRenderTarget(oldT); this.renderer.setClearColor(oldC, oldA); rt.dispose();
    if (!only) for (const kd of this.kinds) if (!this.parts[kd.id] && kd.icon) this.bar.setIcon(kd.id, kd.icon);
  }

  update() {
    this.gizmo.update();
  }
}
