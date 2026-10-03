// PLANTING: plants put down by hand, kept as brush strokes and a few placed plants rather than as the plants
// themselves, so tens of thousands of plants cost a few numbers to keep and to load.
//   A stroke is the path a brush took: how wide it was, what it planted and how thickly. 'paint' plants its kind
//   all along it (and the plants that grow by themselves give way there); 'clear' takes away whatever earlier
//   strokes planted under it, and the plants that grow by themselves. Paint over a clear stroke and it grows again.
//   An item is one plant put down on its own (a 'hero' plant), moved, turned and sized freely; it can clear the
//   ground round itself too, so nothing else grows into it.
// A stroke always grows the very same plants (from its seed), so a saved planting comes back exactly as it was.
//
//   planting: { v: 1, procedural (do the plants that grow by themselves still grow at all), strokes: [stroke], items: [item] }
//   stroke:   { id, mode: 'paint' | 'clear', kind, r (brush radius, m), density (plants a square metre), size (x), seed, pts: [[x, z], ...] }
//   item:     { id, kind, x, y (m above the ground), z, rx, ry, rz (degrees), sx, sy, sz, clear (m: nothing else grows this close) }
//
//   normalisePlanting(o)               any saved or pasted planting (the object or its text) made safe: bad entries dropped, gaps filled
//   loadPlanting() / savePlanting(p)   the copy kept in this browser (load gives null when there is none)
//   new PlantIndex(planting)           where every stroke and item is, for quick tests. Make a new one after ANY change (it is
//                                      cheap). A stroke or item added or taken away, and undo / redo, are noticed even if you
//                                      forget (the index is brought up to date itself); a stroke or item edited in place is not
//   paintedPlants(planting, index, { at, radius, far, sizeOf }) -> [{ x, z, sp, scale, yaw }]   the painted plants round a spot
//                                      (nearest first, roughly: past PLANT_CAP the farthest are left out)
//   keepProcedural(planting, index, x, z) -> may a plant that grows by itself grow here
//   new PlantingHistory(planting)      undo / redo: call snapshot() once per change, just before or just after it; undo() /
//                                      redo() put the planting back in place (the same object) and return it, or null
//   strokeBounds(stroke) / inStroke(stroke, x, z)   a stroke's box (brush width included) / is a spot under it
//
// Brush strokes: add a point when the brush has moved about a quarter of its radius, rounded to the centimetre, so
// the planting stays small and what you see is exactly what comes back after a reload.

export const PLANTING_KEY = 'jconra.planting';
export const PLANT_CAP = 200000;                      // (the most plants paintedPlants hands back at once)
const CELL = 16;                                      // (the index's squares, m)
const EDGE = 0.15;                                    // (the outer share of a brush where its plants thin out to nothing)
const MAX_TRIES = 5e6;                                // (spots looked at in one call before giving up: a planting gone wild)
const LIMIT = 1e4;                                    // (m: nothing is kept further out than this; the land is 1.6 km across)

export const emptyPlanting = () => ({ v: 1, procedural: true, strokes: [], items: [] });

let nextId = 1;
export const newId = () => 'p' + Date.now().toString(36) + (nextId++).toString(36) + Math.floor(Math.random() * 1296).toString(36);
export const newSeed = () => 1 + Math.floor(Math.random() * 2147483646);

// ── random numbers that are always the same for the same spot ──────────────────────────────────────────────────────
function mix(h) {                                     // stirs 32 bits thoroughly (the last step of murmur3)
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35); return (h ^ (h >>> 16)) >>> 0;
}
const cellHash = (seed, i, j) => mix(mix(mix(seed ^ 0x9E3779B9) ^ Math.imul(i, 0x27D4EB2F)) ^ Math.imul(j, 0x165667B1));
const draw = (h, n) => mix(h + Math.imul(n, 0x9E3779B9)) / 4294967296;          // the n-th number (0..1) from one hash
const spotDraw = (x, z) => draw(cellHash(0x51ED27, Math.floor(x * 1024), Math.floor(z * 1024)), 7);

// ── distances ──────────────────────────────────────────────────────────────────────────────────────────────────────
// one straight run of a path, ready for quick distance tests
function seg(s, a, b, r, paint) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  return { s, ax: a[0], az: a[1], dx, dz, inv: L2 > 0 ? 1 / L2 : 0, r, r2: r * r, paint };
}
function dist2(g, x, z) {                             // the squared distance from a spot to the run
  let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) * g.inv; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = g.ax + g.dx * t - x, ez = g.az + g.dz * t - z; return ex * ex + ez * ez;
}
// how likely a plant d from the middle of a brush r wide is kept: always, until the last 15%, then smoothly less to none
const edgeKeep = (d, r) => { const t = (r - d) / (EDGE * r); return t >= 1 ? 1 : t <= 0 ? 0 : t * t * (3 - 2 * t); };

// the path with the points left out wherever leaving them out moves it by less than tol (a brush with a point every few
// centimetres becomes a few long straight runs; the plants can't tell). For the index only: the saved stroke keeps every point.
function simplify(pts, tol) {
  const n = pts.length; if (n < 3) return pts;
  const keep = new Uint8Array(n), stack = [0, n - 1], t2 = tol * tol; keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    const b = stack.pop(), a = stack.pop(), g = seg(0, pts[a], pts[b], 0, false); let far = -1, worst = t2;
    for (let k = a + 1; k < b; k++) { const d = dist2(g, pts[k][0], pts[k][1]); if (d > worst) { worst = d; far = k; } }
    if (far >= 0) { keep[far] = 1; stack.push(a, far, far, b); }
  }
  return pts.filter((_, k) => keep[k]);
}

export function strokeBounds(stroke) {
  const pts = stroke && stroke.pts; if (!pts || !pts.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  const r = stroke.r || 0; return { x0: x0 - r, z0: z0 - r, x1: x1 + r, z1: z1 + r };
}
export function inStroke(stroke, x, z) {
  const pts = stroke && stroke.pts; if (!pts || !pts.length) return false;
  const r2 = (stroke.r || 0) ** 2;
  for (let k = 0; k < Math.max(1, pts.length - 1); k++) if (dist2(seg(0, pts[k], pts[Math.min(k + 1, pts.length - 1)], 0, false), x, z) <= r2) return true;
  return false;
}

// ── the index: 16 m squares, each listing the runs of path and the cleared circles that reach into it ──────────────
// A spot that is not a plain number, or is past LIMIT, would make the index endless: such a stroke or item is left out
// (normalisePlanting never lets one through; this is for a planting put together by hand).
const sane = (v, lim) => typeof v === 'number' && v >= -lim && v <= lim;
export class PlantIndex {
  constructor(planting) {
    this.planting = planting; this.cells = new Map(); this.strokeCells = [];
    const strokes = planting && Array.isArray(planting.strokes) ? planting.strokes : [], items = planting && Array.isArray(planting.items) ? planting.items : [], H = CELL * Math.SQRT1_2;
    // what it was made from, so a planting changed in place since (a stroke or item added or taken away, undo / redo)
    // is noticed and the index brought up to date by itself: see fits()
    const S0 = planting && planting.strokes, I0 = planting && planting.items;
    this.mark = { s: S0, i: I0, ns: S0 ? S0.length : 0, ni: I0 ? I0.length : 0, np: lastPts(S0) };
    strokes.forEach((st, s) => {
      const keys = []; this.strokeCells[s] = keys;
      if (!st || !Array.isArray(st.pts) || !st.pts.length || !(st.r > 0) || !sane(st.r, 1000)) return;
      if (!st.pts.every((p) => p && sane(p[0], LIMIT) && sane(p[1], LIMIT))) return;
      const r = st.r, paint = st.mode !== 'clear', pts = simplify(st.pts, r * 0.01), reach2 = (r + H) ** 2;
      for (let k = 0; k < Math.max(1, pts.length - 1); k++) {
        const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)], g = seg(s, a, b, r, paint);
        const x0 = Math.min(a[0], b[0]) - r, x1 = Math.max(a[0], b[0]) + r, z0 = Math.min(a[1], b[1]) - r, z1 = Math.max(a[1], b[1]) + r;
        // row by row of squares, only along the run (a long slanting run's whole box would be most of a map of squares)
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          // the part of the run within r of this row, and so the squares across the row it can reach
          const lo = cz * CELL - r - 0.01, hi = (cz + 1) * CELL + r + 0.01; let t0 = 0, t1 = 1;
          if (g.dz !== 0) { const u0 = (lo - a[1]) / g.dz, u1 = (hi - a[1]) / g.dz; t0 = Math.max(0, Math.min(u0, u1)); t1 = Math.min(1, Math.max(u0, u1)); if (t0 > t1) continue; }
          const xa = a[0] + g.dx * t0, xb = a[0] + g.dx * t1;
          for (let cx = Math.floor((Math.min(xa, xb) - r - 0.01) / CELL); cx <= Math.floor((Math.max(xa, xb) + r + 0.01) / CELL); cx++) {
            if (dist2(g, (cx + 0.5) * CELL, (cz + 0.5) * CELL) > reach2) continue;            // (near the run's row, but not near the run)
            const c = this.cell(cx, cz, true);
            c.all.push(g); if (!paint) c.clears.push(g);
            let e = c.by.get(s);
            if (!e) { e = { segs: [], x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }; c.by.set(s, e); keys.push(c.key); }
            e.segs.push(g); e.x0 = Math.min(e.x0, x0); e.z0 = Math.min(e.z0, z0); e.x1 = Math.max(e.x1, x1); e.z1 = Math.max(e.z1, z1);
          }
        }
      }
    });
    for (const it of items) {
      if (!it || !(it.clear > 0) || !sane(it.clear, 1000) || !sane(it.x, LIMIT) || !sane(it.z, LIMIT)) continue;
      const R = it.clear, rec = { x: it.x, z: it.z, c2: R * R };
      for (let cz = Math.floor((it.z - R) / CELL); cz <= Math.floor((it.z + R) / CELL); cz++)
        for (let cx = Math.floor((it.x - R) / CELL); cx <= Math.floor((it.x + R) / CELL); cx++) this.cell(cx, cz, true).items.push(rec);
    }
  }
  // one square: all (every run in it, in stroke order), clears (the clear strokes' runs), by (each stroke's runs, and their
  // box), items (cleared circles)
  cell(cx, cz, make) {
    const key = (cx + 32768) * 65536 + (cz + 32768); let c = this.cells.get(key);
    if (!c && make) { c = { key, cx, cz, all: [], clears: [], by: new Map(), items: [] }; this.cells.set(key, c); }
    return c;
  }
  at(x, z) { return this.cell(Math.floor(x / CELL), Math.floor(z / CELL), false); }
  // is this still the index of this planting as it is now? (a few quick looks: the same lists, as long, the newest
  // stroke as long; a stroke or item edited in place, say moved, is not noticed: make a new index after that)
  fits(planting) {
    if (this.planting !== planting || !planting) return false;
    const m = this.mark, s = planting.strokes, i = planting.items;
    return m.s === s && m.i === i && m.ns === (s ? s.length : 0) && m.ni === (i ? i.length : 0) && m.np === lastPts(s);
  }
}
const lastPts = (s) => { const t = s && s.length ? s[s.length - 1] : null; return t && t.pts ? t.pts.length : 0; };
// the index to use: the one given while it still fits; one changed in place is brought up to date (the caller's own
// object, so it is done once); for a different planting, or none given, one is made and kept with that planting
const madeFor = new WeakMap();
function indexFor(planting, index) {
  if (index && index.fits(planting)) return index;
  if (index && index.planting === planting && planting) { Object.assign(index, new PlantIndex(planting)); return index; }
  if (!planting || typeof planting !== 'object') return new PlantIndex(planting);
  let ix = madeFor.get(planting); if (!ix || !ix.fits(planting)) madeFor.set(planting, ix = new PlantIndex(planting));
  return ix;
}

// ── the painted plants ─────────────────────────────────────────────────────────────────────────────────────────────
// Each paint stroke lays a grid over the ground, one plant a grid square (squares 1 / sqrt(density) m across), each
// plant somewhere at random inside its square, kept if it is under the brush's path. So a path that crosses itself
// still has one plant a square, not two. Everything about a plant comes from (the stroke's seed, its grid square).
// A plant is dropped where a LATER clear stroke went over it, or inside a placed item's cleared circle.
// at { x, z }, radius: only the plants within radius (the whole planting when `at` is left out); far (>= 1): past radius
// they carry on out to radius x far, thinning like the plants that grow by themselves (kept with chance (radius / d)^2,
// each one bigger by the square root of that, at most 3x, standing in for the ones left out).
// sizeOf(kind): each kind's own size. Returns [{ x, z, sp (its kind), scale, yaw (radians) }].
//
// FAR OFF ONLY THE KEPT PLANTS ARE LOOKED AT: the grid squares are grouped in blocks of 2 x 2, 4 x 4, ... and each block
// has one square picked at random (a quarter at a time: one of its four quarters, then one of that one's, ...). The
// one-in-four thinning keeps the picked square of each 2 x 2 block, one in sixteen of each 4 x 4, and so on (with a
// smooth draw between), so a far-off patch only visits its blocks' picks: cost follows the plants drawn, not the
// ground painted. The kept plants also come out evenly spread (one a block) rather than in random clumps.
const LEVELS = 10;                                    // (one in 4, 16, ... 4^10 at most)
const quarter = (seed, m, I, J) => cellHash((seed + Math.imul(m, 0x632BE5AB)) | 0, I, J) & 3;
// how many levels up grid square (i, j) is its block's pick (it is at least `l` already)
function pickLevel(seed, i, j, l) {
  while (l < LEVELS && quarter(seed, l + 1, i >> (l + 1), j >> (l + 1)) === (((i >> l) & 1) | (((j >> l) & 1) << 1))) l++;
  return l;
}
export function paintedPlants(planting, index, { at = null, radius = Infinity, far = 1, sizeOf = () => 1 } = {}) {
  const out = [], strokes = planting && Array.isArray(planting.strokes) ? planting.strokes : [];
  index = indexFor(planting, index);
  const R = radius > 0 ? radius : 0, RF = R * Math.max(1, far || 1), R2 = R * R, RF2 = RF * RF;
  const ax = at ? at.x : 0, az = at ? at.z : 0;
  const qx0 = at ? ax - RF : -Infinity, qx1 = at ? ax + RF : Infinity, qz0 = at ? az - RF : -Infinity, qz1 = at ? az + RF : Infinity;
  // the work: each paint stroke's part of each square it reaches. Round a spot the nearest parts go first, so if the cap
  // is reached it is the farthest plants that are left out (not the newest stroke, however near)
  const jobs = [];
  for (let s = 0; s < strokes.length; s++) {
    const st = strokes[s];
    if (!st || st.mode === 'clear' || !(st.density > 0) || !(st.r > 0)) continue;
    for (const key of index.strokeCells[s] || []) {
      const c = index.cells.get(key), e = c.by.get(s), X0 = c.cx * CELL, Z0 = c.cz * CELL;
      // where in this square there can be plants: under the stroke's runs, inside the square, inside the circle
      const bx0 = Math.max(X0, e.x0, qx0), bx1 = Math.min(X0 + CELL, e.x1, qx1), bz0 = Math.max(Z0, e.z0, qz0), bz1 = Math.min(Z0 + CELL, e.z1, qz1);
      if (bx0 >= bx1 || bz0 >= bz1) continue;
      let n2 = 0;
      if (at) { const nx = Math.max(bx0, Math.min(ax, bx1)) - ax, nz = Math.max(bz0, Math.min(az, bz1)) - az; n2 = nx * nx + nz * nz; if (n2 > RF2) continue; }
      jobs.push({ s, c, e, bx0, bx1, bz0, bz1, n2 });
    }
  }
  if (at) jobs.sort((a, b) => a.n2 - b.n2);
  const bases = [];
  let tries = 0;
  for (const { s, c, e, bx0, bx1, bz0, bz1, n2 } of jobs) {
    const st = strokes[s], h = 1 / Math.sqrt(st.density), seed = st.seed | 0, r = st.r, r2 = r * r, rc2 = (r * (1 - EDGE)) ** 2, sp = st.kind | 0;
    if (bases[s] === undefined) bases[s] = (st.size > 0 ? st.size : 1) * sizeOf(sp);
    const base = bases[s];
    // how thinned the nearest plants here are, as a level: only the picks of blocks that big need looking at
    const m = n2 > R2 ? Math.min(LEVELS, Math.floor(Math.log2(n2 / R2) / 2)) : 0;
    const segs = e.segs, clears = c.clears, items = c.items;
    const I0 = Math.floor(bx0 / h) >> m, I1 = Math.floor(bx1 / h) >> m, J0 = Math.floor(bz0 / h) >> m, J1 = Math.floor(bz1 / h) >> m;
    tries += (I1 - I0 + 1) * (J1 - J0 + 1) * (m + 1);
    if (tries > MAX_TRIES) { console.warn('planting: too many plants to look at (' + Math.round(tries) + '); the ' + (at ? 'farthest' : 'rest') + ' left out'); return out; }
    for (let J = J0; J <= J1; J++) for (let I = I0; I <= I1; I++) {
      let i = I, j = J;
      for (let l = m; l > 0; l--) { const q = quarter(seed, l, i, j); i = i * 2 + (q & 1); j = j * 2 + (q >> 1); }
      const hh = cellHash(seed, i, j), x = (i + draw(hh, 1)) * h, z = (j + draw(hh, 2)) * h;
      // each plant belongs to the one square it stands in, so no plant is counted twice
      if (x < bx0 || x >= bx1 || z < bz0 || z >= bz1) continue;
      let grow = 1;
      if (at) {
        const dx = x - ax, dz = z - az, d2 = dx * dx + dz * dz;
        if (d2 > R2) {
          if (d2 > RF2) continue;
          // its thinning draw: a pick l levels up draws between 4^-(l+1) and 4^-l (the top level: below 4^-LEVELS)
          const th = R2 / d2, l = pickLevel(seed, i, j, m), u = l >= LEVELS ? draw(hh, 3) * 4 ** -LEVELS : 4 ** -(l + 1) * (1 + 3 * draw(hh, 3));
          if (u >= th) continue;
          grow = Math.min(3, 1 / Math.sqrt(th));
        }
      }
      let best = Infinity;
      for (let k = 0; k < segs.length; k++) { const d = dist2(segs[k], x, z); if (d < best) { best = d; if (d <= rc2) break; } }
      if (best > r2 || (best > rc2 && draw(hh, 4) >= edgeKeep(Math.sqrt(best), r))) continue;
      let gone = false;
      for (let k = clears.length - 1; k >= 0 && clears[k].s > s; k--) if (dist2(clears[k], x, z) <= clears[k].r2) { gone = true; break; }
      if (!gone) for (let k = 0; k < items.length; k++) { const it = items[k], ix = x - it.x, iz = z - it.z; if (ix * ix + iz * iz <= it.c2) { gone = true; break; } }
      if (gone) continue;
      out.push({ x, z, sp, scale: base * (0.75 + 0.5 * draw(hh, 5)) * grow, yaw: draw(hh, 6) * Math.PI * 2 });
      if (out.length >= PLANT_CAP) { console.warn('planting: over ' + PLANT_CAP + ' painted plants; the ' + (at ? 'farthest' : 'rest') + ' left out'); return out; }
    }
  }
  return out;
}

// May a plant that grows by itself grow at (x, z)? Not when they are turned off, nor under any stroke (paint puts its
// own plants there instead; clear clears), nor in a placed item's cleared circle. Where a paint brush's edge thins out,
// they come back just as its plants go (a spot is kept with the chance the brush's plants are not), so the two blend.
export function keepProcedural(planting, index, x, z) {
  if (!planting || !planting.procedural) return false;
  index = indexFor(planting, index);
  const c = index.at(x, z); if (!c) return true;
  for (const it of c.items) { const ix = x - it.x, iz = z - it.z; if (ix * ix + iz * iz <= it.c2) return false; }
  let fade = 0;
  for (const g of c.all) {
    const d2 = dist2(g, x, z); if (d2 > g.r2) continue;
    if (!g.paint || d2 <= (g.r * (1 - EDGE)) ** 2) return false;
    fade = Math.max(fade, edgeKeep(Math.sqrt(d2), g.r));
  }
  return fade <= 0 || spotDraw(x, z) >= fade;
}

// ── saving, loading and making safe ────────────────────────────────────────────────────────────────────────────────
const fin = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(+v);
const num = (v, d) => fin(v) ? +v : d;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const round = (v, n) => Math.round(v * n) / n;
const kindOf = (v) => clamp(Math.round(num(v, 0)), 0, 2147483647);                 // (a whole number, 0 up)
const angle = (v) => round(((num(v, 0) + 180) % 360 + 360) % 360 - 180, 100);    // (degrees, -180..180)
const seedFrom = (pts) => { let h = 0x2F6B; for (const p of pts) h = mix(h ^ Math.imul(Math.round(p[0] * 100), 0x27D4EB2F) ^ Math.imul(Math.round(p[1] * 100), 0x165667B1)); return h || 1; };

export function normalisePlanting(o) {
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  const out = emptyPlanting();
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  out.procedural = !(o.procedural === false || o.procedural === 0 || o.procedural === 'false');
  const ids = new Set();
  const idOf = (v) => { let id = (typeof v === 'string' && v) || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : newId(); while (ids.has(id)) id = newId(); ids.add(id); return id; };
  for (const s of Array.isArray(o.strokes) ? o.strokes : []) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.pts)) continue;
    const pts = [];
    for (const p of s.pts) {
      const x = Array.isArray(p) ? p[0] : p && p.x, z = Array.isArray(p) ? p[1] : p && p.z;
      if (fin(x) && fin(z)) pts.push([round(clamp(+x, -LIMIT, LIMIT), 100), round(clamp(+z, -LIMIT, LIMIT), 100)]);
    }
    if (!pts.length) continue;
    out.strokes.push({ id: idOf(s.id), mode: s.mode === 'clear' ? 'clear' : 'paint', kind: kindOf(s.kind),
      r: round(clamp(num(s.r, 2), 0.05, 200), 1000), density: round(clamp(num(s.density, 4), 0, 400), 1000), size: round(clamp(num(s.size, 1), 0.01, 100), 1000),
      seed: fin(s.seed) ? Math.trunc(+s.seed) >>> 0 : seedFrom(pts), pts });
  }
  for (const it of Array.isArray(o.items) ? o.items : []) {
    if (!it || typeof it !== 'object' || !fin(it.x) || !fin(it.z)) continue;
    out.items.push({ id: idOf(it.id), kind: kindOf(it.kind), x: round(clamp(+it.x, -LIMIT, LIMIT), 1000), y: round(clamp(num(it.y, 0), -LIMIT, LIMIT), 1000), z: round(clamp(+it.z, -LIMIT, LIMIT), 1000),
      rx: angle(it.rx), ry: angle(it.ry), rz: angle(it.rz),
      sx: round(clamp(num(it.sx, 1), 0.01, 1000), 1000), sy: round(clamp(num(it.sy, 1), 0.01, 1000), 1000), sz: round(clamp(num(it.sz, 1), 0.01, 1000), 1000),
      clear: round(clamp(num(it.clear, 0), 0, 200), 100) });
  }
  return out;
}
export function loadPlanting() { try { const t = localStorage.getItem(PLANTING_KEY); return t ? normalisePlanting(t) : null; } catch (e) { return null; } }
export function savePlanting(p) { try { localStorage.setItem(PLANTING_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } }

// ── undo / redo ────────────────────────────────────────────────────────────────────────────────────────────────────
// Keeps the planting it is given and works on that same object: snapshot() once per change (a brush stroke or a drag,
// not each point), just before it or just after it: both work, as it starts with a copy of the planting as it was given.
// undo() / redo() put its contents back in place and return it (null: nothing to go back to). Copies are kept as text
// (smaller), the last 100.
export class PlantingHistory {
  constructor(planting, max = 100) {
    this.planting = planting; this.max = max; this.undos = []; this.redos = [];
    if (planting && typeof planting === 'object') this.undos.push(JSON.stringify(planting));
  }
  snapshot(planting) {                                // (pass the planting if you swapped in a different object)
    if (planting) this.planting = planting;
    const t = JSON.stringify(this.planting);
    if (this.undos[this.undos.length - 1] !== t) { this.undos.push(t); if (this.undos.length > this.max) this.undos.shift(); }
    this.redos.length = 0;
  }
  undo() { return this.step(this.undos, this.redos); }
  redo() { return this.step(this.redos, this.undos); }
  // go back (or forward) a step, past any copies just like now (a snapshot taken before a change that never came)
  step(from, to) {
    if (!this.planting || typeof this.planting !== 'object') return null;
    const now = JSON.stringify(this.planting);
    while (from.length && from[from.length - 1] === now) from.pop();
    if (!from.length) return null;
    to.push(now); if (to.length > this.max) to.shift();
    const p = JSON.parse(from.pop());
    for (const k of Object.keys(this.planting)) delete this.planting[k];
    return Object.assign(this.planting, p);
  }
  // (a copy just like now is no step back: the one taken at the start, or just before a change that never came)
  get canUndo() { const u = this.undos; return u.length > 1 || (u.length === 1 && u[0] !== JSON.stringify(this.planting)); }
  get canRedo() { return this.redos.length > 0; }
}
