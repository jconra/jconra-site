// THE VILLAGE EDITOR: arranging the town by hand, on the land itself.
//   Select / move: click a thing to select it, drag it to move it (the camera holds still while you drag)
//   Add: pick a building, prop or tree from the list, then click the ground to put one there (keeps going until Esc)
//   Road / Erase road: drag on the ground to paint cobbles or flagstones, or to rub them out; width slider
//   With something selected: turn it (slider, or Q / E: 15 degrees, with Shift 5), size it (slider, or [ and ]),
//   level the ground under it or not, duplicate (Ctrl+D), delete (Delete). Undo / redo (Ctrl+Z / Ctrl+Y).
// Every change is saved in this browser at once; Copy layout gives it as text (for Claude, or another browser).
import * as THREE from 'three';
import { TOWN_ASSETS, TOWN_TREES, footprintOf, drawStroke, newId, levels } from './village.js';
import { PROP_KINDS } from './townProps.js';

const KEY = 'jconra.town';
export function savedLayout() { try { const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
export function forgetLayout() { try { localStorage.removeItem(KEY); } catch (e) { /* no storage */ } }   // (the default is used until the next change)

export class VillageEditor {
  // village: a Village; groundAt(clientX, clientY) -> THREE.Vector3 | null (the land under the pointer);
  // roadCanvas + roadChanged(): the road picture, redrawn live while painting; changed(kind): after any change ('move',
  // 'roads', ...) so the lab can level and clear the ground (it waits for a pause itself); defaultLayout: for Reset
  constructor({ village, camera, controls, dom, container, groundAt, roadCanvas, roadChanged, changed, defaultLayout, scene }) {
    Object.assign(this, { village, camera, controls, dom, groundAt, roadCanvas, roadChanged, changed, defaultLayout, scene });
    this.on = false; this.mode = 'select'; this.sel = null; this.addKind = 'model:townHall'; this.roadMat = 'cobbles'; this.roadW = 5;
    this.undoStack = []; this.redoStack = [];
    this.buildPanel(container); this.buildMarkers(); this.bindPointer(); this.bindKeys();
  }

  // ── the panel ──────────────────────────────────────────────────────────────────────────────────────────────────
  buildPanel(box) {
    const opts = [['Buildings', Object.entries(TOWN_ASSETS).map(([k, a]) => ['model:' + k, a.name])], ['Props', PROP_KINDS.map(p => ['prop:' + p.kind, p.name])],
      ['Trees', Object.entries(TOWN_TREES).map(([k, n]) => ['tree:' + k, n])]];
    box.innerHTML = `
      <label class="check" for="tEdit"><input id="tEdit" type="checkbox"> Edit the town</label>
      <div id="tTools" style="display:none">
        <div class="btns" id="tModes" style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">
          <button type="button" data-mode="select">Select / move</button><button type="button" data-mode="add">Add</button>
          <button type="button" data-mode="road">Road</button><button type="button" data-mode="erase">Erase road</button></div>
        <div id="tAddBox"><div class="row"><label for="tAddKind">Add</label><select id="tAddKind" style="grid-column:2">${opts.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</optgroup>`).join('')}</select></div>
          <p class="note">Click the ground to put one there; again for another. Esc to stop.</p></div>
        <div id="tRoadBox"><div class="row"><label for="tRoadMat">Stone</label><select id="tRoadMat" style="grid-column:2"><option value="cobbles">cobbles</option><option value="flagstones">flagstones</option></select></div>
          <div class="row"><label for="tRoadW">Width</label><output id="tRoadWOut"></output><input id="tRoadW" type="range" min="1" max="20" step="0.5"></div>
          <p class="note">Drag on the ground to paint.</p></div>
        <div id="tSelBox" style="display:none;border-top:1px solid #1a2129;margin-top:6px;padding-top:4px">
          <p class="note"><b id="tSelName"></b> <span id="tSelPos"></span></p>
          <div class="row"><label for="tRot">Turn (Q / E)</label><output id="tRotOut"></output><input id="tRot" type="range" min="0" max="359" step="1"></div>
          <div class="row"><label for="tSize">Size ([ / ])</label><output id="tSizeOut"></output><input id="tSize" type="range" min="0.2" max="60" step="0.1"></div>
          <label class="check" for="tLevel"><input id="tLevel" type="checkbox"> Level the ground under it</label>
          <div class="btns" style="display:flex;gap:4px;flex-wrap:wrap"><button type="button" id="tDup">Duplicate (Ctrl+D)</button><button type="button" id="tDel">Delete</button></div>
        </div>
        <div class="btns" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px"><button type="button" id="tUndo">Undo</button><button type="button" id="tRedo">Redo</button>
          <button type="button" id="tCopy">Copy layout</button><button type="button" id="tPaste">Paste layout</button><button type="button" id="tReset">Back to the first town</button></div>
        <p class="note" id="tNote">Changes save in this browser by themselves.</p>
      </div>`;
    const $ = (id) => box.querySelector('#' + id); this.$ = $;
    $('tEdit').addEventListener('change', e => this.setOn(e.target.checked));
    box.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    $('tAddKind').value = this.addKind; $('tAddKind').addEventListener('change', e => { this.addKind = e.target.value; this.setMode('add'); });
    $('tRoadMat').addEventListener('change', e => { this.roadMat = e.target.value; });
    $('tRoadW').value = this.roadW; $('tRoadWOut').textContent = this.roadW + ' m'; $('tRoadW').addEventListener('input', e => { this.roadW = +e.target.value; $('tRoadWOut').textContent = this.roadW + ' m'; });
    $('tRot').addEventListener('input', e => this.edit(it => { it.rot = +e.target.value; }, 'turn', true));
    $('tSize').addEventListener('input', e => this.edit(it => { it.size = +e.target.value; }, 'size', true));
    for (const id of ['tRot', 'tSize']) $(id).addEventListener('change', () => this.commit('edit'));
    $('tLevel').addEventListener('change', e => this.edit(it => { if (e.target.checked) it.level = true; else delete it.level; }, 'level'));
    $('tDup').addEventListener('click', () => this.duplicate()); $('tDel').addEventListener('click', () => this.remove());
    $('tUndo').addEventListener('click', () => this.undo()); $('tRedo').addEventListener('click', () => this.redo());
    $('tCopy').addEventListener('click', async () => { const t = JSON.stringify(this.village.layout); try { await navigator.clipboard.writeText(t); $('tNote').textContent = `Copied (${this.village.layout.items.length} things, ${this.village.layout.roads.length} road strokes).`; } catch (e) { $('tNote').textContent = t; } });
    $('tPaste').addEventListener('click', async () => { let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { t = prompt('Paste the town layout here') || ''; }
      try { const L = JSON.parse(t); if (!L.items) throw 0; this.snapshot(); this.village.setLayout(L); this.afterLayout(); $('tNote').textContent = 'Pasted.'; } catch (e) { $('tNote').textContent = "That isn't a town layout."; } });
    $('tReset').addEventListener('click', () => { if (!confirm('Put the town back to the first layout? (Undo can bring yours back.)')) return; this.snapshot(); this.village.setLayout(this.defaultLayout); this.afterLayout(); });
    this.showMode();
  }
  setOn(on) { this.on = on; this.$('tTools').style.display = on ? '' : 'none'; if (!on) this.select(null); this.village.showTreePicks = on; this.village.sync(); this.hover(null); }
  setMode(m) { this.mode = m; this.showMode(); }
  showMode() {
    this.$('tAddBox').style.display = this.mode === 'add' ? '' : 'none'; this.$('tRoadBox').style.display = this.mode === 'road' || this.mode === 'erase' ? '' : 'none';
    this.$('tModes').querySelectorAll('button').forEach(b => { b.style.outline = b.dataset.mode === this.mode ? '2px solid #35e07d' : ''; });
    this.dom.style.cursor = this.on && this.mode !== 'select' ? 'crosshair' : '';
  }
  showSel() {
    const it = this.sel && this.village.item(this.sel), $ = this.$;
    $('tSelBox').style.display = it ? '' : 'none'; if (!it) return;
    $('tSelName').textContent = it.type === 'model' ? TOWN_ASSETS[it.kind].name : it.type === 'prop' ? (PROP_KINDS.find(p => p.kind === it.kind) || {}).name || it.kind : TOWN_TREES[it.kind] + ' tree';
    $('tSelPos').textContent = `at ${it.x.toFixed(0)}, ${it.z.toFixed(0)}`;
    $('tRot').value = it.rot; $('tRotOut').textContent = Math.round(it.rot) + '°';
    const big = it.type === 'model'; $('tSize').min = big ? 2 : 0.2; $('tSize').max = big ? 80 : 4; $('tSize').step = big ? 0.5 : 0.05;
    $('tSize').value = it.size; $('tSizeOut').textContent = big ? it.size.toFixed(1) + ' m long' : it.size.toFixed(2) + '×';
    $('tLevel').checked = levels(it); $('tLevel').parentElement.style.display = big && TOWN_ASSETS[it.kind].level !== false ? '' : 'none';   // (the bridge never levels)
  }

  // ── changes: every one undoable, saved, and reported to the lab ────────────────────────────────────────────────
  snapshot() { this.undoStack.push(JSON.stringify(this.village.layout)); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.village.layout)); } catch (e) { /* full or blocked */ } }
  // live: the slider is still moving (snapshot taken on its first move, saved/committed on its 'change')
  edit(fn, what, live = false) {
    const it = this.sel && this.village.item(this.sel); if (!it) return;
    if (!live || !this.liveEditing) this.snapshot(); this.liveEditing = live;
    fn(it); this.village.sync(); this.showSel(); this.markSel();
    if (!live) this.commit(what);
  }
  commit(what) { this.liveEditing = false; this.save(); this.changed(what); }
  afterLayout() { this.select(null); this.save(); this.redrawRoads(); this.changed('layout'); }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.village.layout)); this.village.setLayout(JSON.parse(this.undoStack.pop())); this.afterLayout(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.village.layout)); this.village.setLayout(JSON.parse(this.redoStack.pop())); this.afterLayout(); }
  // the road picture's pixels a stroke segment touched (for redoing only that part)
  dirty(pts, w) { const P = this.roadCanvas.width, k = P / this.village.size, r = (w / 2 + 2) * k; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, z] of pts) { const px = (x + this.village.size / 2) * k, py = (z + this.village.size / 2) * k; x0 = Math.min(x0, px - r); y0 = Math.min(y0, py - r); x1 = Math.max(x1, px + r); y1 = Math.max(y1, py + r); }
    return [x0, y0, x1, y1]; }
  redrawRoads() { const g = this.roadCanvas.getContext('2d'), P = this.roadCanvas.width; g.clearRect(0, 0, P, P); g.lineCap = g.lineJoin = 'round'; for (const r of this.village.layout.roads) drawStroke(g, r, this.village.size, P); this.roadChanged(); }
  add(at) {
    const [type, kind] = this.addKind.split(':'); this.snapshot();
    const it = { id: newId(), type, kind, x: at.x, z: at.z, rot: Math.round(this.camYaw() / 15) * 15, size: type === 'model' ? TOWN_ASSETS[kind].size : type === 'tree' ? 0.6 : 1 };
    this.village.layout.items.push(it); this.village.sync(); this.select(it.id); this.commit('add');
  }
  duplicate() { const it = this.sel && this.village.item(this.sel); if (!it) return; this.snapshot();
    const { w } = footprintOf(it), a = it.rot * Math.PI / 180, c = { ...it, id: newId(), x: it.x + Math.cos(a) * (w + 2), z: it.z - Math.sin(a) * (w + 2) };
    this.village.layout.items.push(c); this.village.sync(); this.select(c.id); this.commit('add'); }
  remove() { const it = this.sel && this.village.item(this.sel); if (!it) return; this.snapshot();
    this.village.layout.items = this.village.layout.items.filter(i => i.id !== it.id); this.village.sync(); this.select(null); this.commit('remove'); }
  camYaw() { const d = new THREE.Vector3(); this.camera.getWorldDirection(d); return (Math.atan2(-d.x, -d.z) * 180 / Math.PI + 360) % 360; }   // things added face the camera

  // ── markers: the selected thing's outline and front arrow (green), the one under the pointer (yellow) ──────────
  buildMarkers() {
    const outline = (col) => { const g = new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.05, 0.5], [0, 0.62], [-0.05, 0.5], [-0.5, 0.5], [-0.5, -0.5]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true })); l.renderOrder = 10; l.visible = false; this.scene.add(l); return l; };
    this.selLine = outline(0x35e07d); this.hovLine = outline(0xffd84a);
  }
  fit(line, it) {
    if (!it) { line.visible = false; return; }
    const { w, d } = footprintOf(it); line.visible = true; line.scale.set(w + 0.6, 1, d + 0.6); line.rotation.y = it.rot * Math.PI / 180;
    line.position.set(it.x, this.village.heightAt(it.x, it.z) + 0.25, it.z);
  }
  markSel() { this.fit(this.selLine, this.sel && this.village.item(this.sel)); }
  hover(id) { this.fit(this.hovLine, id && id !== this.sel ? this.village.item(id) : null); }
  select(id) { this.sel = id; this.markSel(); this.showSel(); }

  // ── the pointer ────────────────────────────────────────────────────────────────────────────────────────────────
  pickAt(cx, cy) {
    const r = this.dom.getBoundingClientRect(), ray = new THREE.Raycaster(), p = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, this.camera); const hit = ray.intersectObjects(this.village.pickables(), false)[0]; return hit ? hit.object.userData.id : null;
  }
  bindPointer() {
    // capturing, so it runs before the camera's own controls and can hold them still while dragging
    // one pointer at a time: a second finger (a pinch) never takes over a drag or a road stroke
    this.dom.addEventListener('pointerdown', (e) => {
      if (!this.on || e.button !== 0) return;
      if (this.pid != null) return;                                // already dragging or painting with another pointer
      const ground = this.groundAt(e.clientX, e.clientY);
      this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (this.mode === 'select') {
        const id = this.pickAt(e.clientX, e.clientY);
        if (id) { this.select(id); if (ground) { const it = this.village.item(id); this.drag = { id, dx: it.x - ground.x, dz: it.z - ground.z, moved: false }; this.hold(e); } }
      } else if (this.mode === 'add' && ground) { this.add(ground); this.hold(e); this.drag = { none: true }; }
      else if ((this.mode === 'road' || this.mode === 'erase') && ground) {
        this.snapshot(); this.stroke = { mat: this.mode === 'erase' ? 'erase' : this.roadMat, w: this.roadW, pts: [[+ground.x.toFixed(2), +ground.z.toFixed(2)]] };
        this.village.layout.roads.push(this.stroke); drawStroke(this.roadCanvas.getContext('2d'), this.stroke, this.village.size, this.roadCanvas.width); this.roadChanged(this.dirty(this.stroke.pts.slice(-1), this.stroke.w)); this.hold(e);
      }
    }, { capture: true });
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.on) return;
      if (this.pid != null && e.pointerId !== this.pid) return;
      if (this.drag && this.drag.id) {
        // a click selects; only a real drag (past a few pixels) moves it
        if (!this.drag.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) return;
        const g = this.groundAt(e.clientX, e.clientY); if (!g) return; const it = this.village.item(this.drag.id);
        if (!this.drag.moved) { this.snapshot(); this.drag.moved = true; }
        it.x = +(g.x + this.drag.dx).toFixed(2); it.z = +(g.z + this.drag.dz).toFixed(2); this.village.place(this.village.objs.get(it.id)); this.markSel(); this.showSel(); return; }
      if (this.stroke) { const g = this.groundAt(e.clientX, e.clientY); if (!g) return; const last = this.stroke.pts[this.stroke.pts.length - 1];
        if (Math.hypot(g.x - last[0], g.z - last[1]) < Math.max(0.5, this.stroke.w / 4)) return;
        this.stroke.pts.push([+g.x.toFixed(2), +g.z.toFixed(2)]); drawStroke(this.roadCanvas.getContext('2d'), this.stroke, this.village.size, this.roadCanvas.width, this.stroke.pts.length - 2); this.roadChanged(this.dirty(this.stroke.pts.slice(-2), this.stroke.w)); return; }
      if (this.mode === 'select' && e.buttons === 0) this.hover(this.pickAt(e.clientX, e.clientY));
    });
    const up = (e) => {
      if (this.pid != null && e.pointerId !== this.pid) return;
      if (this.drag) { const moved = this.drag.moved; this.drag = null; this.release(); if (moved) this.commit('move'); }
      else if (this.stroke) { this.stroke = null; this.release(); this.commit('roads'); }
      // a click (not a drag to turn the camera) on empty ground lets go of the selection
      else if (this.on && this.mode === 'select' && this.down && e.pointerId === this.down.id && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5 && !this.pickAt(e.clientX, e.clientY)) this.select(null);
      this.down = null;
    };
    this.dom.addEventListener('pointerup', up); this.dom.addEventListener('pointercancel', up);
  }
  hold(e) { this.pid = e.pointerId; this.controls.enabled = false; try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } }
  release() { this.pid = null; this.controls.enabled = true; }
  bindKeys() {
    addEventListener('keydown', (e) => {
      if (!this.on || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
      const it = this.sel && this.village.item(this.sel), k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (k === 'escape') { if (this.mode !== 'select') this.setMode('select'); else this.select(null); return; }
      if (!it) return;
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); this.duplicate(); return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.remove(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;           // (Ctrl+E, Alt+[ and the like are the browser's)
      const step = e.shiftKey ? 5 : 15;
      if (k === 'q' || k === 'e') this.edit(i => { i.rot = ((i.rot + (k === 'e' ? -step : step)) % 360 + 360) % 360; }, 'turn');
      if (k === '[' || k === ']') this.edit(i => { i.size = +(i.size * (k === ']' ? 1.08 : 1 / 1.08)).toFixed(2); }, 'size');
    });
  }
}
