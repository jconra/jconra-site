// CHANGES FROM THE DEFAULT: what this browser's town and planting have that the default (the server's copy) doesn't,
// as a short list to read and the data that makes it the new default. Export in the Build bar shows it; the data is
// applied to models/town/layout.json and planting.json by hand-off (paste it to Claude).
//
//   listChanges(def, cur, names) -> { lines: [text], count, data }
//     def, cur: { town: { items, roads } | null, planting: { procedural, strokes, items } }
//     names: { town(item), stroke(stroke), item(item) } -> a plain name for each ('Street lamp', 'Fence line', 'Placed oak')
//     data: { v, town: { add, change, remove, roadsAdd, roadsRemove }, planting: { procedural, addStrokes, removeStrokes,
//       addItems, changeItems, removeItems } }, empty parts left out. Town items, strokes and placed plants go by id; the
//       town's road strokes have none, so they go by what they are (roadsRemove: their places in the default's list).
//       Added things keep the order they were made in and go on the end (a later stroke paints over an earlier one).
//   exportText(result, base, when) -> the text to copy: the list, then the data under a line
//   textHash(text) -> 8 hex digits, the default's fingerprint (of layout.json + '\n' + planting.json as served)

const MARK = '--- data for Claude: paste everything, including below this line ---';
export const EXPORT_MARK = MARK;

export function textHash(s) {                         // FNV-1a, 32 bits
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const num = (v) => +v || 0;
const fmt = (v) => String(+num(v).toFixed(2));
const len = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
const metres = (L) => (L >= 1 ? ` (${Math.round(L)} m)` : '');
const turn = (a, b) => Math.abs(((num(b) - num(a)) % 360 + 540) % 360 - 180);

// what changed on one town thing (a: the default's, b: this browser's): moved (m) and a list of the rest, in words
function townParts(a, b) {
  const rest = [], moved = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z));
  if (turn(a.rot, b.rot) > 0.05) rest.push(`turned ${fmt(a.rot)}° → ${fmt(b.rot)}°`);
  if (Math.abs(num(a.size) - num(b.size)) > 1e-4) rest.push(`size ${fmt(a.size)} → ${fmt(b.size)}`);
  if (Math.abs(num(a.y) - num(b.y)) > 0.005) rest.push(`height ${fmt(a.y)} → ${fmt(b.y)} m`);
  if ((a.level === true) !== (b.level === true)) rest.push(b.level === true ? 'ground under it levelled' : 'ground under it no longer levelled');
  return { moved: moved > 0.005 ? moved : 0, rest };
}
function itemParts(a, b) {                            // a placed plant
  const rest = [], moved = Math.hypot(num(b.x) - num(a.x), num(b.z) - num(a.z));
  if (Math.abs(num(a.y) - num(b.y)) > 0.005) rest.push(`height ${fmt(a.y)} → ${fmt(b.y)} m`);
  if (['rx', 'ry', 'rz'].some((k) => turn(a[k], b[k]) > 0.05)) rest.push('turned');
  if (['sx', 'sy', 'sz'].some((k) => Math.abs(num(a[k]) - num(b[k])) > 1e-4)) {
    const even = (o) => Math.abs(num(o.sx) - num(o.sy)) < 1e-4 && Math.abs(num(o.sy) - num(o.sz)) < 1e-4;
    rest.push(even(a) && even(b) ? `size ${fmt(a.sx)} → ${fmt(b.sx)}` : 'resized');
  }
  if (Math.abs(num(a.clear) - num(b.clear)) > 1e-4) rest.push(`clears ${fmt(a.clear)} → ${fmt(b.clear)} m round it`);
  return { moved: moved > 0.005 ? moved : 0, rest };
}
// changed things with the same name and the same change on one line ('Street lamp ×17: size 1.8 → 2', 'Bench ×3: moved 1-4 m')
function changeLines(changed) {
  const groups = new Map();
  for (const { name, moved, rest } of changed) {
    const key = name + '|' + rest.join('|') + (moved ? '|m' : '');
    if (!groups.has(key)) groups.set(key, { name, rest, d: [] });
    const g = groups.get(key); g.d.push(moved); g.n = (g.n || 0) + 1;
  }
  return [...groups.values()].map((g) => {
    const ds = g.d.filter((d) => d > 0), lo = Math.min(...ds), hi = Math.max(...ds);
    const mv = ds.length ? [`moved ${lo.toFixed(1) === hi.toFixed(1) ? lo.toFixed(1) : `${lo.toFixed(1)}–${hi.toFixed(1)}`} m`] : [];
    return `~ ${g.name}${g.n > 1 ? ` ×${g.n}` : ''}: ${[...mv, ...g.rest].join(', ')}`;
  });
}
// added or removed things counted by name, with how long the strokes are in all ('+ Fence line ×5 (61 m)')
function countLines(sign, list) {
  const groups = new Map();
  for (const { name, L } of list) { const g = groups.get(name) || { n: 0, L: 0 }; g.n++; g.L += L || 0; groups.set(name, g); }
  return [...groups].map(([name, g]) => `${sign} ${name} ×${g.n}${metres(g.L)}`);
}

const roadName = (r) => (r.mat === 'erase' ? 'Stones rubbed out' : r.mat === 'flagstones' ? 'Flagstone paving' : 'Stone road');
const roadKey = (r) => JSON.stringify([r.mat || 'cobbles', +num(r.w).toFixed(2), (r.pts || []).map((p) => [+num(p[0]).toFixed(2), +num(p[1]).toFixed(2)])]);
const byId = (list) => new Map((list || []).map((o) => [String(o.id), o]));

export function listChanges(def, cur, names) {
  const lines = { town: [], planting: [] }, data = { v: 1 };
  // the town: its buildings, props and trees by id, then its road strokes by what they are
  if (def.town && cur.town) {
    const D = byId(def.town.items), C = byId(cur.town.items), T = {};
    const add = cur.town.items.filter((it) => !D.has(String(it.id))), remove = def.town.items.filter((it) => !C.has(String(it.id)));
    const changed = [], change = [];
    for (const it of cur.town.items) { const was = D.get(String(it.id)); if (!was) continue;
      const p = townParts(was, it); if (p.moved || p.rest.length) { changed.push({ name: names.town(it), ...p }); change.push(it); } }
    const left = new Map(); def.town.roads.forEach((r, i) => { const k = roadKey(r); if (!left.has(k)) left.set(k, []); left.get(k).push(i); });
    const roadsAdd = [];
    for (const r of cur.town.roads) { const q = left.get(roadKey(r)); if (q && q.length) q.shift(); else roadsAdd.push(r); }
    const roadsRemove = [...left.values()].flat().sort((a, b) => a - b);
    lines.town.push(...countLines('+', add.map((it) => ({ name: names.town(it) })).concat(roadsAdd.map((r) => ({ name: roadName(r), L: len(r.pts) })))));
    lines.town.push(...changeLines(changed));
    lines.town.push(...countLines('-', remove.map((it) => ({ name: names.town(it) })).concat(roadsRemove.map((i) => ({ name: roadName(def.town.roads[i]), L: len(def.town.roads[i].pts) })))));
    if (add.length) T.add = add; if (change.length) T.change = change; if (remove.length) T.remove = remove.map((it) => it.id);
    if (roadsAdd.length) T.roadsAdd = roadsAdd; if (roadsRemove.length) T.roadsRemove = roadsRemove;
    if (Object.keys(T).length) data.town = T;
  }
  // the planting: its strokes and placed plants by id
  if (def.planting && cur.planting) {
    const P = {}, dp = def.planting, cp = cur.planting;
    if (!!dp.procedural !== !!cp.procedural) { P.procedural = !!cp.procedural; lines.planting.push(`~ Procedural plants: ${cp.procedural ? 'off → on' : 'on → off'}`); }
    const DS = byId(dp.strokes), CS = byId(cp.strokes), DI = byId(dp.items), CI = byId(cp.items);
    // (a stroke is never edited once made; one kept under the same id but different all the same counts as taken away and drawn again)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const addStrokes = cp.strokes.filter((s) => !DS.has(String(s.id)) || !same(DS.get(String(s.id)), s));
    const removeStrokes = dp.strokes.filter((s) => !CS.has(String(s.id)) || !same(CS.get(String(s.id)), s));
    const addItems = cp.items.filter((it) => !DI.has(String(it.id))), removeItems = dp.items.filter((it) => !CI.has(String(it.id)));
    const changed = [], changeItems = [];
    for (const it of cp.items) { const was = DI.get(String(it.id)); if (!was) continue;
      const p = itemParts(was, it); if (p.moved || p.rest.length || was.kind !== it.kind) { changed.push({ name: names.item(it), ...p }); changeItems.push(it); } }
    lines.planting.push(...countLines('+', addStrokes.map((s) => ({ name: names.stroke(s), L: len(s.pts) })).concat(addItems.map((it) => ({ name: names.item(it) })))));
    lines.planting.push(...changeLines(changed));
    lines.planting.push(...countLines('-', removeStrokes.map((s) => ({ name: names.stroke(s), L: len(s.pts) })).concat(removeItems.map((it) => ({ name: names.item(it) })))));
    if (addStrokes.length) P.addStrokes = addStrokes; if (removeStrokes.length) P.removeStrokes = removeStrokes.map((s) => s.id);
    if (addItems.length) P.addItems = addItems; if (changeItems.length) P.changeItems = changeItems; if (removeItems.length) P.removeItems = removeItems.map((it) => it.id);
    if (Object.keys(P).length) data.planting = P;
  }
  const out = [];
  if (lines.town.length) out.push('TOWN', ...lines.town);
  if (lines.planting.length) { if (out.length) out.push(''); out.push('PLANTING', ...lines.planting); }
  return { lines: out, count: lines.town.length + lines.planting.length, data };
}

export function exportText(r, base, when = new Date()) {
  const day = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const head = [`Terrain Lab: changes from the default`, `${day}, ${time} · default ${base}`, ''];
  if (!r.count) return [...head, 'No changes from the default.'].join('\n');
  return [...head, ...r.lines, '', MARK, JSON.stringify({ ...r.data, base })].join('\n');
}
