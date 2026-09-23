// TOWN MAP. A paint tool for the town's layout: a 600 x 600 canvas at a metre a pixel, north up.
// Roads, grass and water are painted (a colour each, which the town's ground shader reads);
// buildings are dragged out as rectangles, each given a project from projects/projects.json and
// labelled with its name; the fence is clicked out in runs. The picture is downloaded as layout.png and the
// rectangles and fence copied as JSON: the town reads both (src/objects/townLayout.js).
const $ = (id) => document.getElementById(id);
const cv = $('map'), g = cv.getContext('2d'), SIZE = 600;
export const COLOURS = { floor: '#5a3f2a', road: '#5b6169', grass: '#4c8a34', water: '#2c6fa8', concrete: '#b8b8b0', dry: '#b9a05a', dark: '#2e5a24' };
const BUILDING = '#c9a23a', FENCE = '#26aeff';

let tool = 'road', brush = 14, painting = false, drag = null, lineStart = null, lineMode = false;
const snap = (p) => { const s = (v) => { const g = Math.round(v / 50) * 50; return Math.abs(v - g) <= 3 ? g : v; }; return { x: s(p.x), y: s(p.y) }; };
const state = { buildings: [], fence: [] };     // fence: runs of corners; a gap between runs is a gate
let run = null;                                  // the run being clicked out
const paint = document.createElement('canvas'); paint.width = paint.height = SIZE;   // the painted classes alone
const pg = paint.getContext('2d'); pg.fillStyle = COLOURS.floor; pg.fillRect(0, 0, SIZE, SIZE);
const undo = [];
function snapshot() { undo.push({ img: pg.getImageData(0, 0, SIZE, SIZE), buildings: JSON.parse(JSON.stringify(state.buildings)), fence: JSON.parse(JSON.stringify(state.fence)) }); if (undo.length > 40) undo.shift(); }

// the map's pixel under a pointer (the canvas is scaled to fit)
function at(e) { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) / r.width * SIZE), y: Math.round((e.clientY - r.top) / r.height * SIZE) }; }
function fit() { const s = $('stage'), k = Math.min(s.clientWidth - 24, s.clientHeight - 24); cv.style.width = cv.style.height = k + 'px'; }
addEventListener('resize', fit); fit();

function draw() {
  g.drawImage(paint, 0, 0);
  // a faint grid every 50 m, the centre marked
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let i = 0; i <= SIZE; i += 50) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, SIZE); g.stroke(); g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(SIZE, i + 0.5); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(SIZE / 2, SIZE / 2 - 8); g.lineTo(SIZE / 2, SIZE / 2 + 8); g.moveTo(SIZE / 2 - 8, SIZE / 2); g.lineTo(SIZE / 2 + 8, SIZE / 2); g.stroke();
  // buildings, numbered
  const STYLE_COL = { office: '#8fb3d9', apartments: '#d9b36a', house: '#e08a6a' }, LETTER = { office: 'O', apartments: 'A', house: 'H' };
  state.buildings.forEach((b, i) => {
    const st = styleOf(b); g.fillStyle = STYLE_COL[st]; g.globalAlpha = 0.85; g.fillRect(b.x, b.y, b.w, b.h); g.globalAlpha = 1;
    g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
    g.fillStyle = '#1a1408'; g.font = 'bold 10px ui-monospace, monospace'; g.fillText(`${i + 1} ${LETTER[st]}${b.style && b.style !== 'auto' ? '' : '·'}`, b.x + 3, b.y + 11);
    g.restore();
  });
  // the project names, as page text over the map so they stay sharp and can run past a small house
  $('labels').innerHTML = state.buildings.map(b => { const pr = BY_ID[b.project]; return pr ? `<span style="left:${(b.x + b.w / 2) / SIZE * 100}%;top:${(b.y + b.h / 2) / SIZE * 100}%">${esc(pr.name)}</span>` : ''; }).join('');
  if (drag) { g.strokeStyle = BUILDING; g.setLineDash([4, 3]); g.strokeRect(drag.x, drag.y, drag.w, drag.h); g.setLineDash([]); }
  // the fence: each run its own line of posts; the run being laid shows to the pointer
  for (const r of state.fence) {
    g.strokeStyle = FENCE; g.lineWidth = 2; g.beginPath(); r.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
    g.fillStyle = FENCE; for (const p of r) { g.beginPath(); g.arc(p.x, p.y, 3.5, 0, Math.PI * 2); g.fill(); }
  }
  if (run && run.length) { g.strokeStyle = FENCE; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); run.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); if (hover) g.lineTo(hover.x, hover.y); g.stroke(); g.setLineDash([]); g.fillStyle = FENCE; for (const p of run) { g.beginPath(); g.arc(p.x, p.y, 3.5, 0, Math.PI * 2); g.fill(); } }
  g.lineWidth = 1;
  // the line being laid
  if (lineStart) { g.strokeStyle = COLOURS[tool] || '#fff'; g.lineWidth = brush; g.lineCap = 'round'; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(lineStart.x, lineStart.y); if (hover) g.lineTo(hover.x, hover.y); else g.lineTo(lineStart.x + 0.1, lineStart.y); g.stroke(); g.globalAlpha = 1; g.lineWidth = 1; }
  // an arrow for where the fighter comes from
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '11px ui-monospace, monospace'; g.fillText('N', SIZE / 2 - 3, 12); g.fillText('fighter arrives from here ↓ (fronts face this way)', SIZE / 2 - 150, 24);
  list(); json();
}
function dab(p) { pg.fillStyle = COLOURS[tool]; pg.beginPath(); pg.arc(p.x, p.y, brush / 2, 0, Math.PI * 2); pg.fill(); }
function line(a, b) { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (brush / 4)) + 1; for (let i = 0; i <= n; i++) dab({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }); }
let last = null, hover = null;
$('lineMode').addEventListener('change', e => { lineMode = e.target.checked; lineStart = null; draw(); });
function endRun() { if (run && run.length < 2) state.fence.pop(); run = null; hover = null; draw(); }
addEventListener('keydown', e => { if (e.key === 'Escape') { lineStart = null; endRun(); } });
$('endRun').addEventListener('click', endRun);
document.querySelectorAll('.tools button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tool !== 'fence') endRun(); }));
cv.addEventListener('pointerdown', (e) => {
  const p = at(e); cv.setPointerCapture(e.pointerId);
  if (tool === 'fence') { const q = snap(p); if (!run) { snapshot(); run = [q]; state.fence.push(run); } else run.push(q); draw(); return; }
  if (tool === 'building') { snapshot(); drag = { x: p.x, y: p.y, w: 0, h: 0 }; return; }
  if (lineMode && !e.shiftKey) {
    // straight lines: the first click sets the start, the second draws the line and starts the next from its end
    const q = snap(p);
    if (!lineStart) { lineStart = q; draw(); return; }
    snapshot(); line(lineStart, q); lineStart = q; draw(); return;
  }
  snapshot(); painting = true; last = p; dab(p); draw();
});
cv.addEventListener('pointermove', (e) => {
  const p = at(e);
  if (drag) { drag.w = p.x - drag.x; drag.h = p.y - drag.y; draw(); return; }
  if (lineStart || run) { hover = snap(p); draw(); return; }
  if (!painting) return; line(last, p); last = p; draw();
});
const up = () => {
  if (drag) { const b = { x: Math.min(drag.x, drag.x + drag.w), y: Math.min(drag.y, drag.y + drag.h), w: Math.abs(drag.w), h: Math.abs(drag.h), style: $('bStyle').value, project: nextProject() }; if (b.w >= 6 && b.h >= 6) state.buildings.push(b); drag = null; draw(); }
  painting = false;
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
document.querySelectorAll('.tools button').forEach(b => b.addEventListener('click', () => { tool = b.dataset.tool; document.querySelectorAll('.tools button').forEach(x => x.classList.toggle('on', x === b)); }));
$('brush').addEventListener('input', e => { brush = +e.target.value; $('brushOut').textContent = brush + ' m'; });
$('undo').addEventListener('click', () => { const u = undo.pop(); if (!u) return; pg.putImageData(u.img, 0, 0); state.buildings = u.buildings; state.fence = u.fence; draw(); });
$('clearFence').addEventListener('click', () => { snapshot(); state.fence = []; run = null; draw(); });
$('clearAll').addEventListener('click', () => { if (!confirm('Clear the whole map?')) return; snapshot(); pg.fillStyle = COLOURS.floor; pg.fillRect(0, 0, SIZE, SIZE); state.buildings = []; state.fence = []; draw(); });
// the style a building will get: its own, else by size as the town decides it
function styleOf(b) { if (b.style && b.style !== 'auto') return b.style.split('/')[0]; const a = b.w * b.h; return Math.min(b.w, b.h) < 28 || a < 800 ? 'house' : a > 2600 ? 'office' : 'apartments'; }
function list() {
  const CHOICES = ['auto', 'office', 'office/glass', 'office/banded', 'office/stone', 'apartments', 'apartments/stucco', 'apartments/modern', 'house', 'house/clapboard', 'house/modern', 'house/brick'];
  const opts = (v) => CHOICES.map(o => `<option value="${o}"${o === (v || 'auto') ? ' selected' : ''}>${o === 'auto' ? 'auto (by size)' : o.includes('/') ? '  ' + o : o + ' (any)'}</option>`).join('');
  $('list').innerHTML = state.buildings.map((b, i) => `<div data-i="${i}"><b>${i + 1}</b><select data-p="${i}">${projectOpts(b.project)}</select><button data-x="${i}" type="button" style="background:none;border:1px solid #3a2020;color:#e07a6a;border-radius:3px;cursor:pointer">×</button><span>${b.w} × ${b.h} m</span><select data-s="${i}">${opts(b.style)}</select></div>`).join('') || '<div>none yet</div>';
  $('list').querySelectorAll('select[data-p]').forEach(el => el.addEventListener('change', () => { snapshot(); state.buildings[+el.dataset.p].project = el.value || undefined; draw(); }));
  unplaced();
  $('list').querySelectorAll('select[data-s]').forEach(el => el.addEventListener('change', () => { snapshot(); state.buildings[+el.dataset.s].style = el.value; draw(); }));
  $('list').querySelectorAll('button[data-x]').forEach(el => el.addEventListener('click', () => { snapshot(); state.buildings.splice(+el.dataset.x, 1); draw(); }));
}
// the JSON: metres from the centre, x east and z south (the fighter comes from +z), so the town uses them as they are
const toWorld = (p) => ({ x: p.x - SIZE / 2, z: p.y - SIZE / 2 });
function json() {
  const out = { metres: SIZE, buildings: state.buildings.map(b => { const [style, variant] = (b.style || 'auto').split('/'); return { ...toWorld({ x: b.x + b.w / 2, y: b.y + b.h / 2 }), w: b.w, d: b.h, style, ...(variant ? { variant } : {}), ...(b.project ? { project: b.project } : {}) }; }), fence: state.fence.filter(r => r.length > 1).map(r => r.map(toWorld)) };
  $('json').value = JSON.stringify(out);
  return out;
}
$('copy').addEventListener('click', () => { navigator.clipboard.writeText($('json').value).then(() => { $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy JSON', 1200); }); });
$('download').addEventListener('click', () => { const a = document.createElement('a'); a.download = 'layout.png'; a.href = paint.toDataURL('image/png'); a.click(); });
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const img = new Image(); img.onload = () => { snapshot(); pg.drawImage(img, 0, 0, SIZE, SIZE); draw(); }; img.src = URL.createObjectURL(f); });
// the current layout from the site, if there is one, to start from
fetch('../../textures/town/layout.json').then(r => r.ok ? r.json() : null).then(j => {
  if (!j) return;
  state.buildings = (j.buildings || []).map(b => ({ x: Math.round(b.x - b.w / 2 + SIZE / 2), y: Math.round(b.z - b.d / 2 + SIZE / 2), w: b.w, h: b.d, style: (b.style || 'auto') + (b.variant ? '/' + b.variant : ''), project: b.project }));
  const runs = (j.fence || []); state.fence = (runs.length && !Array.isArray(runs[0]) ? [runs] : runs).map(r => r.map(p => ({ x: p.x + SIZE / 2, y: p.z + SIZE / 2 })));   // an old single loop reads as one run
  const img = new Image(); img.onload = () => { pg.drawImage(img, 0, 0, SIZE, SIZE); draw(); }; img.onerror = draw; img.src = '../../textures/town/layout.png';
}).catch(() => {});
// THE PROJECTS, from the one list the site uses. A new building takes the first one not placed yet.
let PROJECTS = [], GROUPS = {}, BY_ID = {};
const placed = () => new Set(state.buildings.map(b => b.project).filter(Boolean));
function nextProject() { const p = placed(); const n = PROJECTS.find(x => !p.has(x.id)); return n ? n.id : undefined; }
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function projectOpts(v) {
  const where = {}; state.buildings.forEach((b, i) => { if (b.project) where[b.project] = i + 1; });
  return '<option value="">(no project)</option>' + Object.entries(GROUPS).map(([g, title]) => `<optgroup label="${esc(title)}">` +
    PROJECTS.filter(p => p.group === g).map(p => `<option value="${p.id}"${p.id === v ? ' selected' : ''}>${esc(p.name)}${where[p.id] && p.id !== v ? ` (on #${where[p.id]})` : ''}</option>`).join('') + '</optgroup>').join('');
}
function unplaced() {
  const p = placed();
  $('projects').innerHTML = Object.entries(GROUPS).map(([g, title]) => {
    const left = PROJECTS.filter(x => x.group === g && !p.has(x.id));
    return left.length ? `<b>${esc(title)}</b><br>${left.map(x => esc(x.name)).join('<br>')}` : '';
  }).filter(Boolean).join('<br><br>') || 'Every project has a building.';
}
fetch('../../projects/projects.json').then(r => r.json()).then(j => {
  GROUPS = j.groups; PROJECTS = j.projects; BY_ID = Object.fromEntries(PROJECTS.map(p => [p.id, p])); draw();
}).catch(() => {});
draw();
