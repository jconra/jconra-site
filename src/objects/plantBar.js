// THE PLANT BAR: the hand-planting tool's menu, along the bottom of the screen. It only shows the choices and
// reports them; the lab does the planting. It hides into one round 'Plants' button (bottom left) that brings it back.
//   Bottom row: one square button per plant kind (its picture, a tiny name under it, the full name on hover), grouped
//   under small headings, scrolling sideways when they don't fit (the mouse wheel scrolls it too); the chosen one is lit.
//   Above it, the tools: Select / Place one / Paint / Clear (what a click on the ground does); Move / Turn / Size (which
//   handles the chosen plant shows, for Select and Place one); only the sliders that matter for the mode; Procedural
//   plants (off: start from bare ground); Undo / Redo, Copy / Paste, Delete (Select and Place one), Start over, Hide.
//
//   const bar = new PlantBar({ kinds: [{ id, name, group }], onChange(state, key) {}, onAction(name) {}, container })
//   bar.state                      { open, mode, kind, gizmo, brush, density, size, clearRadius, procedural }: read it, change it with setState
//   bar.setIcon(id, url)           a kind's picture (any image url, data: and blob: too; '' goes back to its letters)
//   bar.setInfo(text)              a short line of news just over the plant row ('' hides it)
//   bar.setState(partial)          changes the controls from outside; onChange is NOT called (so no loops). Sliders are
//                                  kept to their ends; a mode, handle or kind that doesn't exist is left as it was
//   bar.setUndo(canUndo, canRedo)  greys out Undo / Redo (both start greyed out)
//   bar.show(on)                   the whole thing, bar and Plants button (off while the planting tool is off)
//   bar.el                         the bar's own element (the page can test bar.el.contains(document.activeElement))
//   onChange(state, key): a copy of the state and the key that changed; 'open' too, when it hides or comes back.
//     Sliders report while they move, so a brush ring can follow.
//   onAction(name): 'undo', 'redo', 'copy', 'paste', 'delete', 'reset' (Start over wants a second press within 3 s).
// Keys: a control clicked or tapped lets go of the keyboard straight away (even when the press ends off the bar), so
// Space, Shift and WASD go on flying the camera instead of pressing that button again. Used from the keyboard (Tab), the
// bar keeps Space, Enter and the arrow keys to itself, except that a focused slider lets Space and Enter through.
// Leave room on the right for the lab's settings panel with the CSS variable --plantbar-right. On a short phone the
// tools scroll inside the bar, and the edge with more beyond it fades out.

const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  select: SVG('<path d="M6 3.5l12 9.2-5.3.7 3 6.1-2.4 1.1-2.9-6.1L6.4 18z" fill="currentColor" fill-opacity=".25"/>'),
  place: SVG('<path d="M12 19v-7"/><path d="M12 13c-3.8 0-6-2.2-6-6 3.8 0 6 2.2 6 6z"/><path d="M12 11.5c0-3.6 2-5.5 5.5-5.5 0 3.6-2 5.5-5.5 5.5z"/><ellipse cx="12" cy="19.5" rx="5" ry="1.5"/>'),
  paint: SVG('<path d="M20 4l-8 8.2"/><path d="M10.6 11.2l2.2 2.2"/><path d="M10.5 12.5c-2.2-.4-4.3 1-4.6 3.4-.2 1.6-1 2.9-2.4 3.6 3.2 1.1 7.5.4 8.4-2.9.4-1.5-.1-3-1.4-4.1z" fill="currentColor" fill-opacity=".25"/>'),
  clear: SVG('<path d="M3.5 15.5l9-9a1.5 1.5 0 0 1 2.1 0l4.4 4.4a1.5 1.5 0 0 1 0 2.1L13 19H7z"/><path d="M8.5 10.5l6.5 6.5"/><path d="M13 19h7.5"/>'),
  translate: SVG('<path d="M4.5 19.5L15.3 8.7"/><path d="M19.5 4.5L17.2 10.7 13.3 6.8z" fill="currentColor"/>'),
  rotate: SVG('<path d="M4.5 19.5l7.8-7.8"/><circle cx="15.5" cy="8.5" r="4.5" fill="currentColor" fill-opacity=".3"/><path d="M13.4 7.4a2.4 2.4 0 0 1 2.2-1.5"/>'),
  scale: SVG('<path d="M4.5 19.5l8-8"/><rect x="12.5" y="4" width="7.5" height="7.5" rx=".6" fill="currentColor" fill-opacity=".3"/>'),
  plants: SVG('<path d="M12 20v-9"/><path d="M12 14c-4 0-6.5-2.3-6.5-6.5 4.2 0 6.5 2.3 6.5 6.5z"/><path d="M12 12c0-4 2.3-6.5 6.5-6.5 0 4.2-2.3 6.5-6.5 6.5z"/><path d="M8 20h8"/>'),
};
const MODES = [['select', 'Select', 'Pick a placed plant, then move, turn or size it'], ['place', 'Place one', 'Click the ground to put one plant there'],
  ['paint', 'Paint', 'Drag over the ground to paint plants with the brush'], ['clear', 'Clear', 'Drag over the ground to rub plants out']];
const GIZMOS = [['translate', 'Move', 'Move it (drag an arrow)'], ['rotate', 'Turn', 'Turn it round'], ['scale', 'Size', 'Make it bigger or smaller']];
// key, words, what it does, lowest, highest, step (0: a log slider, so the small numbers get as much room as the big), how it reads
const SLIDERS = [
  ['brush', 'Brush size', 'How big the brush is', 1, 40, 0.5, (v) => `${+v.toFixed(1)} m`],
  ['density', 'Thickness', 'How many plants the brush puts on each square metre', 0.05, 20, 0, (v) => `${+(+v).toPrecision(2)} per m²`],
  ['size', 'Plant size', 'How big the plants come out, against their usual size', 0.3, 3, 0.05, (v) => `${v.toFixed(2)}×`],
  ['clearRadius', 'Clear round placed plants', 'A placed plant clears the painted plants this close round it', 0, 5, 0.1, (v) => `${+v.toFixed(1)} m`]];
const SHOWN = { select: [], place: ['size', 'clearRadius'], paint: ['brush', 'density', 'size'], clear: ['brush'] };
const ACTS = [['undo', 'Undo', 'Undo the last change'], ['redo', 'Redo', 'Put back what Undo took away'], ['copy', 'Copy', 'Copy the planting as text'],
  ['paste', 'Paste', 'Paste planting copied before'], ['delete', 'Delete', 'Delete the chosen plant'], ['reset', 'Start over', 'Take away all the hand planting (press twice)']];
const STEPS = 1000;   // (the log slider's positions)
const KEEP_KEYS = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const letters = (name) => { const w = String(name).trim().split(/\s+/); return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };
const nameOf = (k) => (k.name != null && String(k.name).trim()) || String(k.id ?? '');   // (a kind with no name goes by its id)

const CSS = `
.pb-root [hidden] { display:none !important; }
.pb-bar { position:fixed; left:12px; right:var(--plantbar-right, 12px); bottom:12px; z-index:6; display:flex; flex-direction:column; gap:6px; max-height:46vh;
  padding:8px 10px 6px; background:rgba(10,13,17,.92); border:1px solid #212a34; border-radius:6px; color:#ccd6de; font:13px/1.35 ui-sans-serif, system-ui, sans-serif;
  touch-action:manipulation; -webkit-tap-highlight-color:transparent; text-align:left; }
.pb-bar *, .pb-open * { box-sizing:border-box; margin:0; }
.pb-tools { flex:0 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding:4px; margin:-4px; }   /* (4px: room for the focus ring) */
/* when the tools don't all fit, the edge with more beyond it fades out, so it reads as 'scroll for more' */
.pb-tools.pb-down { -webkit-mask-image:linear-gradient(#000 calc(100% - 22px), transparent); mask-image:linear-gradient(#000 calc(100% - 22px), transparent); }
.pb-tools.pb-up { -webkit-mask-image:linear-gradient(transparent, #000 22px); mask-image:linear-gradient(transparent, #000 22px); }
.pb-tools.pb-up.pb-down { -webkit-mask-image:linear-gradient(transparent, #000 22px, #000 calc(100% - 22px), transparent); mask-image:linear-gradient(transparent, #000 22px, #000 calc(100% - 22px), transparent); }
.pb-line { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; }
.pb-grp { display:flex; flex-wrap:wrap; gap:4px; }
.pb-hide { margin-left:auto; }
.pb-b { font:600 11px/1 ui-monospace, monospace; letter-spacing:.05em; text-transform:uppercase; background:rgba(53,224,125,.12); color:#35e07d; border:1px solid #2f7d55;
  border-radius:4px; padding:6px 8px; min-height:30px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.pb-b svg { width:16px; height:16px; flex:none; }
.pb-b:hover:not(:disabled) { background:rgba(53,224,125,.22); }
.pb-b[aria-pressed=true] { background:rgba(53,224,125,.34); color:#e8f1f5; border-color:#35e07d; }
.pb-b:disabled { opacity:.35; cursor:default; }
.pb-b.pb-sure { background:rgba(224,140,53,.2); color:#f0b070; border-color:#a0702f; }
.pb-bar :focus-visible, .pb-open:focus-visible { outline:2px solid #35e07d; outline-offset:2px; }
.pb-sl { display:grid; grid-template-columns:1fr auto; align-items:center; gap:0 8px; min-width:190px; color:#aeb9c2; font-size:12px; cursor:pointer; }
.pb-sl span { white-space:nowrap; }
.pb-sl output { font:12px ui-monospace, monospace; color:#e8f1f5; font-variant-numeric:tabular-nums; white-space:nowrap; }
.pb-sl input { grid-column:1 / -1; width:100%; height:20px; margin:1px 0 0; accent-color:#35e07d; cursor:pointer; }
.pb-check { display:flex; align-items:center; gap:7px; color:#aeb9c2; font-size:12px; cursor:pointer; white-space:nowrap; }
.pb-check input { accent-color:#35e07d; width:15px; height:15px; margin:0; cursor:pointer; }
.pb-info { font:11.5px/1.3 ui-monospace, monospace; color:#7f8d99; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:none; }
.pb-kinds { flex:none; display:flex; overflow-x:auto; overflow-y:hidden; border-top:1px solid #1a2129; margin:0 -4px; padding:6px 4px 4px; touch-action:pan-x; overscroll-behavior-x:contain;
  scrollbar-width:thin; scrollbar-color:#2f3a45 transparent; }
.pb-kgrp { flex:none; display:flex; flex-direction:column; gap:4px; padding:0 10px; border-left:1px solid #1a2129; }
.pb-kgrp:first-child { border-left:0; padding-left:0; }
.pb-kname { font:600 10px/1 ui-monospace, monospace; letter-spacing:.12em; text-transform:uppercase; color:#8494a0; position:sticky; left:0; white-space:nowrap; }
.pb-krow { display:flex; gap:6px; }
.pb-kind { flex:none; width:56px; background:none; border:0; padding:0; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:3px;
  color:#8494a0; font:9.5px/1.1 ui-monospace, monospace; border-radius:6px; }
.pb-kpic { width:56px; height:56px; border:1px solid #212a34; border-radius:6px; background:#05070a; display:flex; align-items:center; justify-content:center;
  overflow:hidden; color:#59656f; font:600 13px ui-monospace, monospace; }
.pb-kpic img { width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; }
.pb-klabel { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pb-kind:hover .pb-kpic { border-color:#2f7d55; }
.pb-kind[aria-pressed=true] { color:#35e07d; }
.pb-kind[aria-pressed=true] .pb-kpic { border-color:#35e07d; box-shadow:0 0 0 1px #35e07d, 0 0 10px rgba(53,224,125,.35); }
.pb-open { position:fixed; left:12px; bottom:12px; z-index:6; width:58px; height:58px; border-radius:50%; background:rgba(10,13,17,.92); border:1px solid #2f7d55;
  color:#35e07d; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:0; cursor:pointer;
  font:600 9.5px/1 ui-monospace, monospace; letter-spacing:.06em; text-transform:uppercase; box-shadow:0 2px 10px rgba(0,0,0,.5); touch-action:manipulation; }
.pb-open svg { width:22px; height:22px; }
.pb-open:hover { background:rgba(20,40,30,.95); }
@media (max-width:700px) {
  .pb-bar { padding:6px 8px 4px; gap:4px; max-height:40vh; }
  .pb-tools { gap:4px; }
  .pb-line { gap:4px; }
  .pb-top .pb-grp { display:contents; }
  .pb-b { min-height:34px; padding:5px 6px; gap:4px; font-size:10.5px; letter-spacing:.02em; }   /* (just narrow enough for the four modes in one row at 360px) */
  .pb-sets { display:grid; grid-template-columns:1fr; gap:0; }
  .pb-sl { width:auto; grid-template-columns:7.2em 1fr 4.9em; min-height:28px; font-size:11.5px; line-height:1.15; }
  .pb-sl input { grid-column:2; grid-row:1; height:28px; margin:0; }
  .pb-sl output { grid-column:3; grid-row:1; text-align:right; font-size:11.5px; }
  .pb-check { min-height:28px; }
  .pb-kinds { padding-top:4px; }
  .pb-kgrp { padding:0 8px; gap:3px; }
  .pb-kname { font-size:9px; }
  .pb-krow { gap:5px; }
  .pb-kind { width:44px; font-size:9px; gap:2px; }
  .pb-kpic { width:44px; height:44px; }
  .pb-sl span { white-space:normal; }
}
/* a phone on its side: too short for 40%, so a little more of the height, smaller plant buttons, sliders two across */
@media (max-height:500px) {
  .pb-bar { max-height:62vh; padding:5px 8px 3px; gap:4px; }
  .pb-tools { gap:4px; }
  .pb-line { row-gap:4px; }
  .pb-b { min-height:30px; padding:4px 7px; }
  .pb-kgrp { gap:2px; }
  .pb-kind { width:40px; }
  .pb-kpic { width:40px; height:40px; }
  .pb-klabel { display:none; }
}
@media (max-height:500px) and (max-width:700px) {
  .pb-sets { grid-template-columns:1fr 1fr; column-gap:14px; }
  .pb-sl { grid-template-columns:6.4em 1fr 4.6em; min-height:28px; }
  .pb-sl input { height:26px; }
}`;
function addStyle() {
  if (document.getElementById('pb-style')) return;
  const s = document.createElement('style'); s.id = 'pb-style'; s.textContent = CSS; document.head.appendChild(s);
}

export class PlantBar {
  constructor({ kinds = [], onChange, onAction, container = document.body } = {}) {
    this.kinds = kinds; this.onChange = onChange; this.onAction = onAction; this.shown = true; this.sure = null;
    this.state = { open: true, mode: 'select', kind: kinds.length ? kinds[0].id : null, gizmo: 'translate', brush: 6, density: 2, size: 1, clearRadius: 1.5, procedural: true };
    addStyle(); this.build(container); this.render();
  }

  // ── building it ────────────────────────────────────────────────────────────────────────────────────────────────
  build(container) {
    const groups = [];
    this.kinds.forEach((k, i) => { const name = k.group || ''; let g = groups.find((x) => x.name === name); if (!g) groups.push(g = { name, items: [] }); g.items.push([k, i]); });
    const btn = (attr, icon, word, tip, cls = '') => `<button type="button" class="pb-b${cls}" ${attr} title="${esc(tip)}">${icon || ''}<span>${esc(word)}</span></button>`;
    const root = document.createElement('div'); root.className = 'pb-root'; this.el = root;
    root.innerHTML = `
      <div class="pb-bar" role="region" aria-label="Planting tools">
        <div class="pb-tools">
          <div class="pb-line pb-top">
            <div class="pb-grp" role="group" aria-label="What a click on the ground does">${MODES.map(([m, w, t]) => btn(`data-mode="${m}"`, ICON[m], w, t)).join('')}</div>
            <div class="pb-grp pb-gizmo" role="group" aria-label="Handles on the chosen plant">${GIZMOS.map(([g, w, t]) => btn(`data-gizmo="${g}"`, ICON[g], w, t)).join('')}</div>
            <div class="pb-grp">${ACTS.map(([a, w, t]) => btn(`data-act="${a}"`, '', w, t)).join('')}</div>
            ${btn('data-act="hide"', '', 'Hide', 'Hide the planting tools (the Plants button brings them back)', ' pb-hide')}
          </div>
          <div class="pb-line pb-sets">
            ${SLIDERS.map(([key, w, t, lo, hi, step]) => `<label class="pb-sl" data-key="${key}" title="${esc(t)}"><span>${esc(w)}</span><output></output><input type="range" min="${step ? lo : 0}" max="${step ? hi : STEPS}" step="${step || 1}"></label>`).join('')}
            <label class="pb-check" title="Off: start from bare ground and plant everything by hand"><input type="checkbox"> Procedural plants</label>
          </div>
        </div>
        <div class="pb-info" aria-live="polite" hidden></div>
        <div class="pb-kinds" role="group" aria-label="Plant kinds"${groups.length ? '' : ' hidden'}>${groups.map((g) => `<div class="pb-kgrp">${g.name ? `<div class="pb-kname">${esc(g.name)}</div>` : ''}<div class="pb-krow">${g.items.map(([k, i]) =>
          `<button type="button" class="pb-kind" data-i="${i}" title="${esc(nameOf(k))}" aria-label="${esc(nameOf(k))}"><span class="pb-kpic">${esc(letters(nameOf(k)))}</span><span class="pb-klabel">${esc(nameOf(k))}</span></button>`).join('')}</div></div>`).join('')}</div>
      </div>
      <button type="button" class="pb-open" title="Show the planting tools">${ICON.plants}<span>Plants</span></button>`;
    container.appendChild(root);
    const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
    this.b = { bar: q('.pb-bar'), open: q('.pb-open'), info: q('.pb-info'), kinds: q('.pb-kinds'), tools: q('.pb-tools'), gizmo: q('.pb-gizmo'), proc: q('.pb-check input'),
      modes: qa('[data-mode]'), gizmos: qa('[data-gizmo]'), kindBtns: qa('[data-i]'), acts: Object.fromEntries(qa('[data-act]').map((b) => [b.dataset.act, b])),
      sliders: Object.fromEntries(qa('.pb-sl').map((l) => [l.dataset.key, { row: l, inp: l.querySelector('input'), out: l.querySelector('output') }])) };
    this.setUndo(false, false);

    root.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || !root.contains(t) || t.disabled) return;
      if (t.dataset.mode) this.set('mode', t.dataset.mode);
      else if (t.dataset.gizmo) this.set('gizmo', t.dataset.gizmo);
      else if (t.dataset.i !== undefined) this.set('kind', this.kinds[+t.dataset.i].id);
      else if (t.dataset.act === 'hide') { this.set('open', false); if (!this.byPointer) this.b.open.focus(); }   // (from the keyboard the focus goes with it)
      else if (t.dataset.act) this.act(t.dataset.act);
      else if (t === this.b.open) { this.set('open', true); this.reveal(); if (!this.byPointer) this.b.acts.hide.focus(); }
    });
    for (const [key, sl] of Object.entries(this.b.sliders)) {
      sl.inp.addEventListener('input', () => {
        const v = this.fromSlider(key, +sl.inp.value); sl.out.textContent = this.fmt(key, v);
        if (v !== this.state[key]) { this.state[key] = v; this.fire(key); }
      });
      // the log slider's 1000 positions are too fine for the arrow keys (a press would often change nothing you can
      // see), so an arrow goes on to the next number it shows instead
      if (!this.slider(key)[5]) sl.inp.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return;
        e.preventDefault(); let s = +sl.inp.value; const was = this.fromSlider(key, s);
        do s += d; while (s > 0 && s < STEPS && this.fromSlider(key, s) === was);
        sl.inp.value = s; sl.inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    this.b.proc.addEventListener('change', () => this.set('procedural', this.b.proc.checked));
    this.b.tools.addEventListener('scroll', () => this.edges(), { passive: true });
    if (window.ResizeObserver) new ResizeObserver(() => this.edges()).observe(this.b.tools);
    // the wheel scrolls the plant row sideways (it would do nothing there otherwise); some mice count in lines, not pixels
    this.b.kinds.addEventListener('wheel', (e) => { const k = this.b.kinds;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && k.scrollWidth > k.clientWidth) { k.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? k.clientWidth : 1); e.preventDefault(); } }, { passive: false });
    // a click or tap lets go of the keyboard at once, so Space (fly up) can't press the same button again. The press
    // may end anywhere (pressed on a button, slid off it, let go over the scene), so the whole window listens for it
    // ending; the click and change catch a label's checkbox, which takes the focus after the pointer is already up
    const letGo = () => { const a = document.activeElement; if (a && a !== document.body && root.contains(a)) a.blur(); };
    const up = () => { if (this.pressing) { this.pressing = false; letGo(); } };
    root.addEventListener('pointerdown', () => { this.byPointer = this.pressing = true; }, true);
    window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    root.addEventListener('click', () => { if (this.byPointer) letGo(); });
    root.addEventListener('change', () => { if (this.byPointer) letGo(); });
    // working the bar from the keyboard: these keys belong to the focused control, not the camera (but not while a
    // pointer is still pressed on it: keys then are for flying, Space held while clicking goes on flying up). A slider
    // has no use for Space or Enter, so with one focused those still reach the page and Space still flies up.
    root.addEventListener('keydown', (e) => {
      if (this.pressing) return;
      this.byPointer = false;
      if (KEEP_KEYS.includes(e.key) && !(e.target.type === 'range' && (e.key === ' ' || e.key === 'Enter'))) e.stopPropagation();
    });
  }

  // ── the numbers on the sliders ─────────────────────────────────────────────────────────────────────────────────
  slider(key) { return SLIDERS.find((s) => s[0] === key); }
  fmt(key, v) { return this.slider(key)[6](v); }
  toSlider(key, v) { const [, , , lo, hi, step] = this.slider(key); return step ? v : Math.round(Math.log(v / lo) / Math.log(hi / lo) * STEPS); }
  fromSlider(key, s) { const [, , , lo, hi, step] = this.slider(key); return step ? s : +(lo * Math.pow(hi / lo, s / STEPS)).toPrecision(2); }   // (two figures: 0.05, 1.5, 20)

  // ── changes ────────────────────────────────────────────────────────────────────────────────────────────────────
  set(key, v) { if (this.state[key] === v) return; this.state[key] = v; this.render(); this.fire(key); }
  fire(key) { if (this.onChange) this.onChange({ ...this.state }, key); }
  act(a) {
    if (a === 'reset' && !this.sure) { const b = this.b.acts.reset; b.style.minWidth = b.offsetWidth + 'px'; b.classList.add('pb-sure'); b.title = 'Press again to start over';
      b.querySelector('span').textContent = 'Sure?'; this.sure = setTimeout(() => this.unsure(), 3000); return; }
    if (a === 'reset') this.unsure();
    if (this.onAction) this.onAction(a);
  }
  unsure() { clearTimeout(this.sure); this.sure = null; const b = this.b.acts.reset; b.classList.remove('pb-sure'); b.querySelector('span').textContent = 'Start over'; b.title = ACTS[5][2]; b.style.minWidth = ''; }
  render() {
    const s = this.state, b = this.b, shown = SHOWN[s.mode] || [], handles = s.mode === 'select' || s.mode === 'place';
    b.bar.hidden = !this.shown || !s.open; b.open.hidden = !this.shown || s.open;
    b.modes.forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === s.mode));
    b.gizmos.forEach((x) => x.setAttribute('aria-pressed', x.dataset.gizmo === s.gizmo));
    b.kindBtns.forEach((x) => x.setAttribute('aria-pressed', this.kinds[+x.dataset.i].id === s.kind));
    b.gizmo.hidden = !handles; b.acts.delete.hidden = !handles;
    for (const [key, sl] of Object.entries(b.sliders)) { sl.row.hidden = !shown.includes(key); sl.inp.value = this.toSlider(key, s[key]); sl.out.textContent = this.fmt(key, s[key]); }
    b.proc.checked = !!s.procedural; this.edges();
  }
  // on a small screen the tools may not all fit: fade the edge that has more beyond it (see .pb-up / .pb-down)
  edges() { const t = this.b.tools; t.classList.toggle('pb-up', t.scrollTop > 1); t.classList.toggle('pb-down', t.scrollTop + t.clientHeight < t.scrollHeight - 1); }
  // scroll the plant row so the chosen kind is in sight
  reveal() {
    const i = this.kinds.findIndex((k) => k.id === this.state.kind), btn = this.b.kindBtns[i], row = this.b.kinds; if (!btn) return;
    const r = btn.getBoundingClientRect(), R = row.getBoundingClientRect(); if (!R.width) return;   // (hidden)
    if (r.left < R.left) row.scrollLeft -= R.left - r.left + 12; else if (r.right > R.right) row.scrollLeft += r.right - R.right + 12;
  }

  // ── for the lab ────────────────────────────────────────────────────────────────────────────────────────────────
  // a value that isn't one of the choices (a mode or kind that doesn't exist, a slider set to null or words) is left out
  setState(p = {}) {
    const s = this.state;
    for (const [k, v] of Object.entries(p)) {
      const sl = this.slider(k);
      if (sl) { if (v !== null && v !== '' && Number.isFinite(+v)) s[k] = Math.min(sl[4], Math.max(sl[3], +v)); }
      else if (k === 'mode') { if (MODES.some((m) => m[0] === v)) s.mode = v; }
      else if (k === 'gizmo') { if (GIZMOS.some((g) => g[0] === v)) s.gizmo = v; }
      else if (k === 'kind') { const hit = this.kinds.find((x) => x.id === v) || this.kinds.find((x) => String(x.id) === String(v)); if (hit) s.kind = hit.id; }
      else if (k === 'open' || k === 'procedural') s[k] = !!v;
    }
    this.render(); if ('kind' in p || p.open) this.reveal();
  }
  setIcon(id, url) {
    const i = this.kinds.findIndex((k) => String(k.id) === String(id)), btn = this.b.kindBtns[i]; if (!btn) return;
    const pic = btn.querySelector('.pb-kpic'), back = () => { pic.textContent = letters(nameOf(this.kinds[i])); }; pic.textContent = '';
    if (!url) { back(); return; }
    const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.decoding = 'async';
    img.onerror = () => { if (img.parentNode === pic) back(); };   // (a picture that won't load: its letters again)
    img.src = url; pic.appendChild(img);
  }
  setInfo(text) { const t = text == null ? '' : String(text), el = this.b.info; if (el.textContent !== t) { el.textContent = t; el.title = t; } el.hidden = !t; this.edges(); }
  setUndo(canUndo, canRedo) { this.b.acts.undo.disabled = !canUndo; this.b.acts.redo.disabled = !canRedo; }
  show(on) { this.shown = !!on; this.render(); if (this.shown) this.reveal(); }
}
