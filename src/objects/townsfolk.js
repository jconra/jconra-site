// TOWNSFOLK: people going about the town, from door to door, to the market stalls, the benches, the fountain, the
// gardens and the bridges, along the roads and paths (across the grass where that's much shorter), keeping to the right
// so two passing don't walk through each other, stopping to chat or wave. Children run about the playground; the
// adventurers walk as a pair. Most go indoors at night. Bodies and colours: people.js.
//
// THE WALKING GRID (walkGridSteps, a slice at a time): the town's ground in squares, each with what a step on it costs
// (tenths: 10 a road), 0 where nobody can go: the page says what the ground is (ground(x, z): roads, paths, grass, water,
// slope), and what stands on it (walls: buildings and props as boxes, trees and posts as discs, fences as lines), with the
// bridges' decks open whatever is under them. A step next to a wall costs more, so people keep a little way off walls.
// The places to go are put on it, and only the ones that can all be reached from each other are kept.
// THE ROUTES (Router): A* over the grid, a slice a frame, kept for each pair of places (the way back: the same route run
// backwards); pulled straight where the straight line costs no more a step than the route it replaces (so nobody leaves
// a road to cut across the grass beside it) and its corners rounded.
//
//   walkGridSteps({ x0, z0, cell, W, H, ground, walls, decks, places }) -> generator; its return: the grid
//     walls: [{ rect: { x, z, w, d, rot } } | { disc: { x, z, r } } | { line: [ax, az, bx, bz], w }]   rot: radians, as
//       the village turns its things (a thing's own +z faces (sin rot, cos rot))
//     decks: [{ x, z, w, d, rot }]   places: [{ x, z, face (radians, the way to look there), kind, cap, tags }]
//   new Townsfolk({ scene, lib, shade, shadows, floorAt, count, seed, size })
//     .setGrid(grid)   .setCount(n)   .setSize(s)   .update(dt, camera, night 0..1)   .dispose()
//     size: how big everyone is (1: as made, a grown-up 1.85 m); their speeds grow by its square root (a bigger body takes
//     longer, slower steps) and every spacing with it
//     floorAt(x, z): the height to stand at (the land, a bridge's deck)
import * as THREE from 'three';
import { Person, randomLook, STRIDE } from './people.js';

const SQ2 = Math.SQRT2, DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NEAR_WALL = 8;                                    // (tenths: added to a step beside a wall)

export function* walkGridSteps({ x0, z0, cell, W, H, ground, walls = [], decks = [], places = [] }) {
  const N = W * H, cost = new Uint8Array(N), wall = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < W; i++) cost[j * W + i] = Math.max(0, Math.min(250, Math.round(ground(x0 + (i + 0.5) * cell, z) || 0)));
    if ((j & 15) === 15) yield;
  }
  // every cell whose centre is in a turned box / a disc / within w/2 of a line
  const box = (r, f) => {
    const c = Math.cos(r.rot), s = Math.sin(r.rot), R = Math.hypot(r.w, r.d) / 2;
    const i0 = Math.max(0, Math.floor((r.x - R - x0) / cell)), i1 = Math.min(W - 1, Math.ceil((r.x + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((r.z - R - z0) / cell)), j1 = Math.min(H - 1, Math.ceil((r.z + R - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + (i + 0.5) * cell - r.x, dz = z0 + (j + 0.5) * cell - r.z;
      if (Math.abs(c * dx - s * dz) <= r.w / 2 && Math.abs(s * dx + c * dz) <= r.d / 2) f(j * W + i);
    }
  };
  const disc = (d, f) => {
    const R = d.r + cell * 0.5, i0 = Math.max(0, Math.floor((d.x - R - x0) / cell)), i1 = Math.min(W - 1, Math.ceil((d.x + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((d.z - R - z0) / cell)), j1 = Math.min(H - 1, Math.ceil((d.z + R - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(x0 + (i + 0.5) * cell - d.x, z0 + (j + 0.5) * cell - d.z) <= R) f(j * W + i);
  };
  const line = ([ax, az, bx, bz], w, f) => {
    const R = w / 2 + cell * 0.5, L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / cell)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - z0) / cell)), j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + R - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell, pz = z0 + (j + 0.5) * cell, t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2));
      if (Math.hypot(px - ax - t * (bx - ax), pz - az - t * (bz - az)) <= R) f(j * W + i);
    }
  };
  for (const d of decks) box(d, (k) => { cost[k] = 10; });
  let n = 0;
  for (const w of walls) {
    const shut = (k) => { cost[k] = 0; wall[k] = 1; };
    if (w.rect) box(w.rect, shut); else if (w.disc) disc(w.disc, shut); else if (w.line) line(w.line, w.w || 0.4, shut);
    if (++n % 200 === 0) yield;
  }
  // a little way off walls
  for (let j = 0; j < H; j++) { for (let i = 0; i < W; i++) { const k = j * W + i; if (!wall[k]) continue;
    for (let d = 0; d < 8; d++) { const ni = i + DI[d], nj = j + DJ[d]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const q = nj * W + ni; if (cost[q] && !wall[q] && cost[q] < 200) wall[q] = 2; } }
    if ((j & 63) === 63) yield; }
  for (let k = 0; k < N; k++) if (wall[k] === 2) cost[k] = Math.min(250, cost[k] + NEAR_WALL);
  // which cells can reach which: each connected stretch numbered
  const comp = new Int32Array(N).fill(-1), stack = new Int32Array(N); let groups = 0, popped = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (!cost[k0] || comp[k0] >= 0) continue;
    let top = 0; stack[top++] = k0; comp[k0] = groups;
    while (top) { if ((++popped & 32767) === 0) yield;                  // (within a stretch too: one can be most of the grid)
      const k = stack[--top], i = k % W, j = (k / W) | 0;
      for (let d = 0; d < 8; d++) { const ni = i + DI[d], nj = j + DJ[d]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const q = nj * W + ni;
        if (!cost[q] || comp[q] >= 0 || (d >= 4 && (!cost[j * W + ni] || !cost[nj * W + i]))) continue; comp[q] = groups; stack[top++] = q; } }
    groups++;
    if (groups % 256 === 0) yield;
  }
  const G = { x0, z0, cell, W, H, cost, comp, wall, places: [], dropped: 0 };
  // the places, each on a cell it can be reached by: its own spot when that's open ground, else the nearest open cell not
  // beside a wall. A spot along a road gets that even when its own is open (one had landed against a bench)
  const kept = [];
  for (const p of places) {
    const own = cellAt(G, p.x, p.z), ok = own >= 0 && cost[own] > 0 && cost[own] <= 60 && (p.kind !== 'spot' || !wall[own]);
    const k = ok ? own : nearestOpen(G, p.x, p.z, 6, true); if (k < 0) continue;
    kept.push({ ...p, k, x: ok ? p.x : x0 + (k % W + 0.5) * cell, z: ok ? p.z : z0 + (((k / W) | 0) + 0.5) * cell, used: 0 });
  }
  const count = new Map(); for (const p of kept) count.set(comp[p.k], (count.get(comp[p.k]) || 0) + 1);
  let main = -1, best = 0; for (const [c, m] of count) if (m > best) { best = m; main = c; }
  G.main = main; G.places = kept.filter((p) => comp[p.k] === main); G.places.forEach((p, i) => { p.i = i; });
  G.dropped = places.length - G.places.length;
  return G;
}
const cellAt = (G, x, z) => { const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell); return i < 0 || j < 0 || i >= G.W || j >= G.H ? -1 : j * G.W + i; };
// the nearest cell anyone can stand on, within r cells (in the main stretch, once there is one); -1 if none. clear: one
// not beside a wall if there is one
function nearestOpen(G, x, z, r, clear = false) {
  const ci = Math.floor((x - G.x0) / G.cell), cj = Math.floor((z - G.z0) / G.cell); let best = -1, bd = Infinity;
  for (let j = Math.max(0, cj - r); j <= Math.min(G.H - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(G.W - 1, ci + r); i++) {
    const k = j * G.W + i; if (!G.cost[k] || G.cost[k] > 60 || (clear && G.wall[k]) || (G.main !== undefined && G.comp[k] !== G.main)) continue;
    const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = k; } }
  return best < 0 && clear ? nearestOpen(G, x, z, r) : best;
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────────────
// a route: points along the ground (x, z pairs) and how far along each one is
function makeRoute(xz) {
  const n = xz.length / 2, cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xz[i * 2] - xz[i * 2 - 2], xz[i * 2 + 1] - xz[i * 2 - 1]);
  return { xz, cum, total: cum[n - 1] };
}
function reversed(r) { const n = r.xz.length / 2, xz = new Float32Array(r.xz.length); for (let i = 0; i < n; i++) { xz[i * 2] = r.xz[(n - 1 - i) * 2]; xz[i * 2 + 1] = r.xz[(n - 1 - i) * 2 + 1]; } return makeRoute(xz); }
// where along a route s metres in is (and which way it runs there); seg: a hint, the segment last found (it only grows)
function along(r, s, out, seg = 0) {
  const n = r.cum.length; s = Math.max(0, Math.min(r.total, s));
  let i = Math.min(seg, n - 2); while (i > 0 && r.cum[i] > s) i--; while (i < n - 2 && r.cum[i + 1] < s) i++;
  const L = r.cum[i + 1] - r.cum[i] || 1e-6, t = (s - r.cum[i]) / L, ax = r.xz[i * 2], az = r.xz[i * 2 + 1], bx = r.xz[i * 2 + 2], bz = r.xz[i * 2 + 3];
  out.x = ax + (bx - ax) * t; out.z = az + (bz - az) * t; out.dx = (bx - ax) / L; out.dz = (bz - az) / L; out.seg = i;
  return out;
}

class Heap {                                            // smallest first: cells by their estimated route cost
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) { const K = this.k, V = this.v; let c = K.length; K.push(k); V.push(v);
    while (c > 0) { const p = (c - 1) >> 1; if (V[p] <= v) break; K[c] = K[p]; V[c] = V[p]; c = p; } K[c] = k; V[c] = v; }
  pop() { const K = this.k, V = this.v, top = K[0], lk = K.pop(), lv = V.pop(), n = K.length;
    if (n) { let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c, mv = lv; if (l < n && V[l] < mv) { m = l; mv = V[l]; } if (r < n && V[r] < mv) m = r; if (m === c) break; K[c] = K[m]; V[c] = V[m]; c = m; } K[c] = lk; V[c] = lv; }
    return top; }
}

class Router {
  constructor(G) {
    const N = G.W * G.H; this.G = G;
    this.g = new Float32Array(N); this.par = new Int32Array(N); this.seen = new Uint32Array(N); this.shut = new Uint32Array(N); this.stamp = 0;
    this.queue = []; this.job = null; this.cache = new Map();
  }
  // a route from one place to another (or from a cell); done(route | null) when found. key: kept under it
  ask(from, to, done) {
    const key = from.p && to.p ? from.p.i + '>' + to.p.i : null;
    if (key && this.cache.has(key)) return done(this.cache.get(key));
    const back = from.p && to.p ? to.p.i + '>' + from.p.i : null;
    if (back && this.cache.has(back)) { const r = reversed(this.cache.get(back)); this.cache.set(key, r); return done(r); }
    this.queue.push({ from, to, key, done });
  }
  step(ms) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (!this.job) { const q = this.queue.shift(); if (!q) return; this.job = { q, it: this.search(q.from, q.to) }; }
      const r = this.job.it.next();
      if (r.done) { const { q } = this.job; this.job = null; if (q.key && r.value) this.cache.set(q.key, r.value); q.done(r.value); }
    }
  }
  *search(from, to) {
    const G = this.G, W = G.W, H = G.H, cost = G.cost, st = ++this.stamp, g = this.g, par = this.par, seen = this.seen, shut = this.shut;
    const s = from.k, t = to.k, ti = t % W, tj = (t / W) | 0;
    if (s < 0 || t < 0 || !cost[s] || !cost[t]) return null;
    const h = (k) => { const di = Math.abs(k % W - ti), dj = Math.abs(((k / W) | 0) - tj); return (Math.max(di, dj) + (SQ2 - 1) * Math.min(di, dj)) * 11.5; };   // (a little over the cheapest step: quicker, a route a shade longer)
    const heap = new Heap(); g[s] = 0; seen[s] = st; par[s] = -1; heap.push(s, h(s));
    let n = 0, found = false;
    while (heap.size) {
      const k = heap.pop(); if (shut[k] === st) continue; shut[k] = st;
      if (k === t) { found = true; break; }
      const i = k % W, j = (k / W) | 0, ck = cost[k], gk = g[k];
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const q = nj * W + ni, cq = cost[q]; if (!cq || shut[q] === st) continue;
        if (d >= 4 && (!cost[j * W + ni] || !cost[nj * W + i])) continue;   // (no cutting a wall's corner)
        const ng = gk + (ck + cq) * (d >= 4 ? SQ2 * 0.5 : 0.5);
        if (seen[q] !== st || ng < g[q]) { seen[q] = st; g[q] = ng; par[q] = k; heap.push(q, ng + h(q)); }
      }
      if (++n % 4000 === 0) yield;
    }
    if (!found) return null;
    const cells = []; for (let k = t; k !== -1; k = par[k]) cells.push(k); cells.reverse();
    const pulled = yield* this.pull(cells);
    // its points: from the place's own spot, through the pulled cells' centres, to the other's; corners rounded
    const pts = [[from.x, from.z]];
    for (let q = 1; q < pulled.length - 1; q++) pts.push([G.x0 + (pulled[q] % W + 0.5) * G.cell, G.z0 + (((pulled[q] / W) | 0) + 0.5) * G.cell]);
    pts.push([to.x, to.z]);
    return makeRoute(round(pts));
  }
  // straightened: from each point, on to the furthest one further along that a straight line reaches over ground costing
  // no more a step than the route's own between them (found by doubling the reach, then halving back)
  *pull(cells) {
    const n = cells.length; if (n < 3) return cells;
    const out = [cells[0]]; let a = 0, tests = 0;
    while (a < n - 1) {
      let good = a + 1, step = 2, bad = -1;
      while (a + step < n) { if (this.clear(cells, a, a + step)) { good = a + step; step *= 2; } else { bad = a + step; break; } }
      if (bad < 0 && good < n - 1) { if (this.clear(cells, a, n - 1)) good = n - 1; else bad = n - 1; }
      if (bad > 0) { let lo = good, hi = bad; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.clear(cells, a, m)) lo = m; else hi = m; } good = lo; }
      out.push(cells[good]); a = good;
      if (++tests % 40 === 0) yield;
    }
    return out;
  }
  clear(cells, a, b) {
    const G = this.G, W = G.W, cost = G.cost; let most = 0;
    for (let q = a; q <= b; q++) most = Math.max(most, cost[cells[q]]);
    const ai = cells[a] % W + 0.5, aj = ((cells[a] / W) | 0) + 0.5, bi = cells[b] % W + 0.5, bj = ((cells[b] / W) | 0) + 0.5;
    const L = Math.hypot(bi - ai, bj - aj), steps = Math.ceil(L * 4), ux = (bj - aj) / (L || 1) * 0.3, uz = -(bi - ai) / (L || 1) * 0.3;
    for (let q = 0; q <= steps; q++) { const t = q / steps, x = ai + (bi - ai) * t, z = aj + (bj - aj) * t;
      for (const o of [0, 1, -1]) { const i = Math.floor(x + ux * o), j = Math.floor(z + uz * o); if (i < 0 || j < 0 || i >= W || j >= G.H) return false; const c = cost[j * W + i]; if (!c || c > most) return false; } }
    return true;
  }
}
// corners rounded: each turn a curve through it, up to 1.6 m out from the corner
function round(pts) {
  if (pts.length < 3) return Float32Array.from(pts.flat());
  const out = [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [px, pz] = pts[i], [bx, bz] = pts[i + 1], la = Math.hypot(px - ax, pz - az), lb = Math.hypot(bx - px, bz - pz);
    const r = Math.min(1.6, la * 0.45, lb * 0.45);
    if (r < 0.05) { out.push(px, pz); continue; }
    const sx = px + (ax - px) / la * r, sz = pz + (az - pz) / la * r, ex = px + (bx - px) / lb * r, ez = pz + (bz - pz) / lb * r;
    for (let q = 0; q <= 4; q++) { const t = q / 4, u = 1 - t; out.push(u * u * sx + 2 * u * t * px + t * t * ex, u * u * sz + 2 * u * t * pz + t * t * ez); }
  }
  out.push(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  return Float32Array.from(out);
}

// ── what they do ─────────────────────────────────────────────────────────────────────────────────────────────
// at each kind of place: the clip, and how long (s, from..to). A door: they go in
const STAY = { visit: ['Idle', 8, 20], spot: ['Idle', 8, 25], vendor: ['Idle_Neutral', 40, 120], stall: ['Interact', 10, 30], easel: ['Interact', 25, 60], garden: ['Interact', 10, 30], bench: ['Idle', 20, 60], picnic: ['Idle', 20, 60],
  fountain: ['Idle', 12, 40], play: ['Idle', 2, 6], bridge: ['Idle_Neutral', 10, 30], sign: ['Idle_Neutral', 5, 12] };
// how far each kind of person happily goes (m): a place this much further off is a third as likely
const ROAM = { adult: 50, kid: 35, hiker: 250 };
const VISIT = 0.35;                                     // (how often someone sets off to see a person standing about nearby, rather than to a place)
const COMPANY = 4;                                      // (a place with someone already standing there: this much likelier, so people gather and talk)
// how much each kind of person likes each kind of place
const LIKES = {
  adult: { spot: 2.5, vendor: 0.5, door: 3, stall: 2, easel: 0.7, garden: 1, bench: 1.5, picnic: 1, fountain: 2, play: 0.3, bridge: 0.8, sign: 0.4 },
  kid: { spot: 1, door: 1, stall: 0.6, easel: 0.2, garden: 0.3, bench: 0.3, picnic: 0.6, fountain: 2, play: 7, bridge: 0.6, sign: 0.1 },
  hiker: { spot: 2, door: 1, stall: 1, easel: 0.3, garden: 0.3, bench: 1, picnic: 1.5, fountain: 1, play: 0.1, bridge: 4, sign: 2.5 },
};
const KID_KINDS = ['casual_f', 'casual_m', 'hoodie_m', 'beach_m', 'adventurer_f'];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const turnTo = (a, b, max) => { let d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + Math.max(-max, Math.min(max, d)); };

export class Townsfolk {
  constructor({ scene, lib, shade = null, shadows = false, floorAt, count = 12, seed = 7, size = 1 }) {
    Object.assign(this, { scene, lib, shade, shadows, floorAt, want: count, size, vk: Math.sqrt(size) });
    this.rand = mulberry(seed); this.folk = []; this.grid = null; this.router = null; this.frame = 0;
    this.group = new THREE.Group(); this.group.name = 'townsfolk'; scene.add(this.group);
    this.frustum = new THREE.Frustum(); this.M = new THREE.Matrix4(); this.S = new THREE.Sphere(); this.P = { x: 0, z: 0, dx: 0, dz: 1, seg: 0 }; this.Q = { x: 0, z: 0, dx: 0, dz: 1, seg: 0 };
    this.stats = { routes: 0, failed: 0, visits: 0, talks: 0, chats: 0, waves: 0, indoors: 0, ms: 0 };   // (ms: the last update's time)
  }
  // a new grid: the old one's places are gone, so everyone on their way somewhere stops and finds their way again from where
  // they stand (nobody walks an old route through something just built, or starts from a place no longer there)
  setGrid(G) {
    this.grid = G; this.router = new Router(G);
    for (const f of this.folk) {
      f.goal = f.to && (f.state === 'walk' || f.state === 'chat' || f.state === 'turn') ? { x: f.to.x, z: f.to.z, kind: f.to.kind } : null;   // (where they were going: kept to, if it's still there)
      f.place = null; f.at = null; f.to = null; f.chat = null; f.slot = -1;
      if (!f.lead && (f.state === 'think' || f.state === 'walk' || f.state === 'chat' || f.state === 'turn')) { f.state = 'stay'; f.until = 0; f.act = 'Idle'; f.p.play('Idle', { fade: 0.3 }); }
    }
    this.setCount(this.want);
  }
  // done with a place: its count, and the spot they had at it, given back
  release(f) { const p = f.at; if (!p) return; p.used--; if (p.taken && f.slot >= 0) p.taken[f.slot] = 0; f.at = null; f.slot = -1; }
  setSize(s) { this.size = s; this.vk = Math.sqrt(s); for (const f of this.folk) { f.p.root.scale.setScalar((f.kid ? 0.6 : 1) * s); if (f.state === 'walk' || f.lead) f.p.play(f.gait || 'Walk', { speed: this.pace(f, f.gait || 'Walk') }); } }
  setCount(n) {
    this.want = n; if (!this.grid || !this.grid.places.length) return;
    while (this.folk.length > n) {                                       // (from the end: a pair's second goes before the first)
      const f = this.folk.pop(); this.group.remove(f.p.root); f.p.dispose();
      if (f.at) this.release(f); else if (!f.lead && f.to && (f.state === 'walk' || f.state === 'chat')) { f.to.used--; if (f.to.taken && f.slot >= 0) f.to.taken[f.slot] = 0; }
      f.state = 'gone';                                                  // (a route still coming: its answer sees that and gives its place back)
    }
    const kinds = this.lib.kinds, common = kinds.filter((k) => !k.rare), rare = kinds.filter((k) => k.rare);
    while (this.folk.length < n) {
      const i = this.folk.length, R = this.rand, used = new Set(this.folk.map((f) => f.p.kind.file));
      let kind, kid = i % 5 === 4, lead = null;
      // the adventurers come as a pair (the first two, when there are four or more), the second following the first
      if (i === 0 && n >= 4) kind = kinds.find((k) => k.file === 'adventurer_m');
      else if (i === 1 && n >= 4 && this.folk[0].p.kind.file === 'adventurer_m') { kind = kinds.find((k) => k.file === 'adventurer_f'); lead = this.folk[0]; }
      else if (kid) { const file = KID_KINDS[Math.floor(R() * KID_KINDS.length)]; kind = kinds.find((k) => k.file === file); }
      else if (R() < 1 / 15 && rare.some((k) => !used.has(k.file))) { const left = rare.filter((k) => !used.has(k.file)); kind = left[Math.floor(R() * left.length)]; }
      else { const fresh = common.filter((k) => !used.has(k.file)); const from = fresh.length ? fresh : common; kind = from[Math.floor(R() * from.length)]; }
      if (!kind) { kind = common[Math.floor(R() * common.length)]; lead = null; }   // (a character missing from people.json)
      const p = new Person(this.lib, kind, { look: randomLook(R, kind), shade: this.shade, shadows: this.shadows, kid });
      p.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);   // (set, not worked out: working it out skins every vertex on the processor)
      p.mesh.raycast = () => {};                                         // (clicks go through people)
      p.root.scale.setScalar((kid ? 0.6 : 1) * this.size);
      const f = { p, kid, lead, kind: kid ? 'kid' : /^adventurer/.test(kind.file) ? 'hiker' : 'adult', state: 'stay', until: R() * 12, x: 0, z: 0, y: 0, face: R() * 6.28,
        speed: kid ? 1.0 + R() * 0.3 : 1.15 + R() * 0.3, lane: 0, push: 0, route: null, s: 0, seg: 0, place: null, at: null, slot: -1, late: false, met: new Map(), act: 'Idle', chat: null, inside: false, anim: 0, wave: 0 };
      const start = this.grid.places[Math.floor(R() * this.grid.places.length)];
      f.place = start; f.x = start.x + (R() - 0.5) * 1.5 * this.size; f.z = start.z + (R() - 0.5) * 1.5 * this.size; f.y = this.floorAt(f.x, f.z);
      if (lead) { f.x = lead.x + 0.8 * this.size; f.z = lead.z; }
      p.root.position.set(f.x, f.y, f.z); p.root.rotation.y = f.face; p.play('Idle', { fade: 0 }); p.mixer.update(R() * 2);
      this.group.add(p.root); this.folk.push(f);
    }
  }
  // where to go next: by what they like, nearer more likely, never where they are, nowhere full
  choose(f, night) {
    const G = this.grid, likes = LIKES[f.kind]; let sum = 0; const w = [];
    const there = this.folk.filter((o) => o !== f && o.state === 'stay' && !o.inside && o.act !== 'Interact' && !o.lead);
    for (const p of G.places) {
      let v = likes[p.kind] || 0; if (!v || p.used >= p.cap || p === f.place) { w.push(0); continue; }
      if (p.kind === 'door' && night > 0) v *= 1 + 6 * night;               // (at night: home)
      v *= Math.exp(-Math.hypot(p.x - f.x, p.z - f.z) / ROAM[f.kind]);
      if (p.kind !== 'door' && there.some((o) => Math.abs(o.x - p.x) < 4.5 * this.size && Math.abs(o.z - p.z) < 4.5 * this.size && !o.kid === !f.kid)) v *= COMPANY;
      w.push(v); sum += v;
    }
    let r = this.rand() * sum; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0 && w[i] > 0) return G.places[i]; }
    return null;
  }
  update(dt, camera, night = 0) {
    if (!this.grid) return;
    const t0 = performance.now(); dt = Math.min(dt, 0.1); this.frame++;
    this.router.step(1.5);
    camera.updateMatrixWorld(); this.frustum.setFromProjectionMatrix(this.M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const R = this.rand, folk = this.folk, P = this.P, cam = camera.position;
    for (const f of folk) {
      if (f.lead) { this.follow(f, dt); continue; }
      f.until -= dt;
      if (f.state === 'stay' && f.until <= 0) this.leave(f, night);
      else if (f.state === 'inside') {
        if (night < 0.2 && f.late) { f.late = false; f.until = Math.min(f.until, 5 + R() * 55); }   // (morning: out they come, from a night in)
        if (f.until <= 0) { f.inside = false; f.state = 'stay'; f.until = 0; this.leave(f, night); }
      } else if (f.state === 'walk') this.walk(f, dt);
      else if (f.state === 'chat' && f.until <= 0) { f.state = 'walk'; f.chat = null; f.p.play(f.gait, { speed: this.pace(f, f.gait) }); }
      else if (f.state === 'turn' && !f.at) { f.state = 'stay'; f.until = 0; }
      else if (f.state === 'turn') { f.want = null; f.face = turnTo(f.face, f.at.face, dt * 3); if (Math.abs(turnTo(f.face, f.at.face, 9) - f.face) < 0.05 || f.until <= 0) this.arrive(f, night); }
      if (f.want != null && (f.state === 'stay' || f.state === 'chat' || f.state === 'think')) f.face = turnTo(f.face, f.want, dt * 3);   // (turning to someone, smoothly)
      if (f.wave > 0 && (f.wave -= dt) <= 0 && f.p.curName === 'Wave') f.p.play(f.state === 'chat' ? 'Idle' : f.state === 'walk' ? f.gait : f.act, f.state === 'walk' ? { speed: this.pace(f, f.gait) } : undefined);
    }
    this.meet(night);
    // placed, turned, drawn and animated: animations far off or out of sight less often (none while out of sight)
    for (const f of folk) {
      const p = f.p, root = p.root, gy = this.floorAt(f.x, f.z);
      f.y += (gy - f.y) * Math.min(1, dt * 10);
      root.position.set(f.x, f.y, f.z); root.rotation.y = f.face;
      const d = Math.hypot(f.x - cam.x, f.z - cam.z, f.y - cam.y);
      root.visible = !f.inside && d < 450;
      f.anim += dt;
      if (!root.visible) continue;
      this.S.center.set(f.x, f.y + 0.9 * this.size, f.z); this.S.radius = 1.4 * this.size;
      if (!this.frustum.intersectsSphere(this.S)) {
        if (this.shadows && d < 100 && (this.frame + f.p.mesh.id) % 4 === 0) { p.update(Math.min(f.anim, 2)); f.anim = 0; } else f.anim = Math.min(f.anim, 2);   // (out of sight but near: their shadow can be in sight)
        continue;
      }
      const every = d < 40 ? 1 : d < 100 ? 2 : d < 200 ? 3 : 5;
      if ((this.frame + (f.p.mesh.id % every)) % every === 0) { p.update(f.anim); f.anim = 0; }
    }
    this.stats.ms = performance.now() - t0;
  }
  // how fast a clip plays for its person's speed: the speed over the clip's own at this size (f.speed is as made: times vk)
  pace(f, clip) { return (clip === 'Run' ? f.speed * 1.9 : f.speed) * this.vk / (STRIDE[f.p.kind.body][clip] * (f.kid ? 0.6 : 1) * this.size); }
  // a visit: to see someone standing about not too far off (not busy at a stall or an easel), to a spot a step from them
  // on the side they're coming from; made up as a place of its own (no route kept for it)
  visit(f) {
    const G = this.grid, near = this.folk.filter((o) => o !== f && !o.lead && o.state === 'stay' && !o.inside && o.act !== 'Interact' && !o.kid === !f.kid && Math.hypot(o.x - f.x, o.z - f.z) < ROAM[f.kind] * 1.6);
    if (!near.length) return null;
    const o = near[Math.floor(this.rand() * near.length)], d = Math.hypot(f.x - o.x, f.z - o.z) || 1, x = o.x + (f.x - o.x) / d * 1.3 * this.size, z = o.z + (f.z - o.z) / d * 1.3 * this.size;
    const k = nearestOpen(G, x, z, 3); if (k < 0) return null;
    const own = cellAt(G, x, z), open = own >= 0 && G.cost[own] > 0 && G.comp[own] === G.main;
    const tx = open ? x : G.x0 + (k % G.W + 0.5) * G.cell, tz = open ? z : G.z0 + (((k / G.W) | 0) + 0.5) * G.cell;
    return { kind: 'visit', x: tx, z: tz, face: Math.atan2(o.x - tx, o.z - tz), cap: 1, used: 0, k };
  }
  // off to somewhere new: a route asked for (they keep doing what they were until it comes)
  leave(f, night) {
    const g = f.goal; f.goal = null;
    const to = (g && this.grid.places.find((p) => p.kind === g.kind && p.used < p.cap && Math.hypot(p.x - g.x, p.z - g.z) < 1.5 * this.size))   // (on the way somewhere before the grid was made again)
      || (this.rand() < VISIT * (1 - night) && this.visit(f)) || this.choose(f, night);
    if (!to) { f.until = 3 + this.rand() * 5; return; }
    const G = this.grid, real = (p) => (p && p.i != null && G.places[p.i] === p ? p : null);   // (only this grid's own places have their routes kept)
    const at = f.place && Math.hypot(f.place.x - f.x, f.place.z - f.z) < 3.5 * this.size && real(f.place);   // (a kept route starts at the place's own spot)
    const from = at ? { p: at, k: at.k, x: at.x, z: at.z } : { k: nearestOpen(G, f.x, f.z, 12), x: f.x, z: f.z };
    if (from.k < 0) { const p = G.places[Math.floor(this.rand() * G.places.length)]; f.x = p.x; f.z = p.z; f.place = p; f.until = 2; return; }   // (stranded: put back somewhere)
    this.release(f);
    // the spot: the place's own if it's free, else a step to its right, the next to its left, and so on, the first free one
    // on open ground (the route to a spot of one's own isn't kept); at a door, the door
    const taken = to.taken || (to.taken = []); let target = null, slot = -1;
    if (to.kind === 'door') target = { p: real(to), k: to.k, x: to.x, z: to.z };
    else for (let q = 0; q < to.cap + 4 && !target; q++) {
      if (taken[q]) continue;
      if (q === 0) { target = { p: real(to), k: to.k, x: to.x, z: to.z }; slot = 0; break; }
      const side = q % 2 ? 1 : -1, r = 1.1 * this.size * Math.ceil(q / 2), x = to.x - Math.cos(to.face) * side * r, z = to.z + Math.sin(to.face) * side * r, k = cellAt(G, x, z);
      if (k >= 0 && G.cost[k] > 0 && !G.wall[k] && G.comp[k] === G.main) { target = { p: null, k, x, z }; slot = q; }
    }
    if (!target) target = { p: real(to), k: to.k, x: to.x, z: to.z };    // (no spot free beside it: its own, shared)
    to.used++; if (slot >= 0) taken[slot] = 1; f.state = 'think'; const grid = G;
    const free = () => { to.used--; if (slot >= 0) taken[slot] = 0; };
    this.router.ask(from, target, (route) => {
      if (this.grid !== grid || f.state !== 'think') { free(); return; }
      if (!route) { this.stats.failed++; free(); f.state = 'stay'; f.until = 4 + this.rand() * 6; return; }
      this.stats.routes++; if (to.kind === 'visit') this.stats.visits++;
      // the route starts at the place's spot; from where they actually stand (a step to its side, say), a step onto it
      if (Math.hypot(route.xz[0] - f.x, route.xz[1] - f.z) > 0.05) { const xz = new Float32Array(route.xz.length + 2); xz[0] = f.x; xz[1] = f.z; xz.set(route.xz, 2); route = makeRoute(xz); }
      f.route = route; f.s = 0; f.seg = 0; f.to = to; f.slot = slot; f.state = 'walk'; f.lane = 0; f.want = null;
      const run = f.kid && this.rand() < 0.6; f.gait = run ? 'Run' : 'Walk';
      f.p.play(f.gait, { speed: this.pace(f, f.gait) });
      // anyone standing about where they're going waits for them (if it's not too long a wait), so the two meet and talk
      const eta = route.total / (f.speed * this.vk * (run ? 1.9 : 1));
      if (eta < 60) for (const o of this.folk) if (o !== f && !o.lead && o.state === 'stay' && !o.inside && o.act !== 'Interact' && Math.hypot(o.x - to.x, o.z - to.z) < 4.5 * this.size) o.until = Math.max(o.until, eta + 3);
    });
  }
  walk(f, dt) {
    const r = f.route, P = this.P, S = this.size, speed = f.speed * this.vk * (f.gait === 'Run' ? 1.9 : 1) * (f.slow == null ? 1 : f.slow);
    f.s += speed * dt;
    if (f.s >= r.total) { f.at = f.to; f.place = f.to; f.state = 'turn'; f.until = 1.2; f.x = r.xz[r.xz.length - 2]; f.z = r.xz[r.xz.length - 1];
      f.p.play(f.to.kind === 'door' ? 'Idle_Neutral' : 'Idle', { fade: 0.35 }); return; }
    along(r, f.s, P, f.seg); f.seg = P.seg;
    // keep to the right, easing out near either end; less where the right is walled or water; pushed aside by others
    const ends = Math.min(1, f.s / (3 * S), (r.total - f.s) / (3 * S)), want = (0.45 + f.push) * S * Math.max(0, ends);
    const rx = -P.dz, rz = P.dx, G = this.grid, k = cellAt(G, P.x + rx * (want + 0.3 * S), P.z + rz * (want + 0.3 * S)), ok = k >= 0 && G.cost[k] > 0;
    f.lane += ((ok ? want : 0) - f.lane) * Math.min(1, dt * 2);
    f.x = P.x + rx * f.lane; f.z = P.z + rz * f.lane;
    // facing: toward a point a little ahead, turned to smoothly
    const Q = along(r, f.s + 1.2 * S, this.Q, f.seg), ax = Q.x + rx * f.lane - f.x, az = Q.z + rz * f.lane - f.z;
    if (ax * ax + az * az > 1e-4) f.face = turnTo(f.face, Math.atan2(ax, az), dt * 5);
  }
  arrive(f, night) {
    const at = f.at, R = this.rand;
    if (at.kind === 'door') { f.state = 'inside'; f.inside = true; this.stats.indoors++; f.late = night >= 0.2; f.until = (20 + R() * 100) * (1 + 10 * night); return; }
    const [clip, lo, hi] = STAY[at.kind] || ['Idle', 5, 15];
    f.act = clip === 'Idle' && R() < 0.4 ? 'Idle_Neutral' : clip;
    f.state = 'stay'; f.until = lo + R() * (hi - lo); f.p.play(f.act, { fade: 0.4 });
    // someone already there (standing about, not busy at a stall or an easel): the two talk a while, facing each other;
    // the one arriving waves first
    const O = this.folk.find((o) => o !== f && !o.lead && o.state === 'stay' && !o.inside && o.act !== 'Interact' && Math.hypot(o.x - f.x, o.z - f.z) < 4.5 * this.size);
    if (O && R() < 0.85) {
      const t = 8 + R() * 14;
      for (const [X, Y] of [[f, O], [O, f]]) { X.want = Math.atan2(Y.x - X.x, Y.z - X.z); X.act = 'Idle'; X.until = Math.max(X.until, t); X.p.play('Idle', { fade: 0.4 }); }
      f.p.play('Wave', { fade: 0.3, once: true }); f.wave = 2.1;
      f.met.set(O, this.frame); O.met.set(f, this.frame); this.stats.talks++;
    }
  }
  // the second of a pair: beside the first, a step to their left, doing what they do
  follow(f, dt) {
    const L = f.lead, S = this.size; f.inside = L.inside; f.state = L.state;
    let tx, tz, face = L.face;
    const lx = -Math.cos(L.face), lz = Math.sin(L.face);                // (their left, facing L.face: the right is (-dz, dx))
    tx = L.x + lx * 0.75 * S; tz = L.z + lz * 0.75 * S;
    const G = this.grid, k = cellAt(G, tx, tz); if (k < 0 || !G.cost[k]) { tx = L.x - Math.sin(L.face) * 0.9 * S; tz = L.z - Math.cos(L.face) * 0.9 * S; }   // (no room beside: behind)
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
    if (d > 6 * S) { f.x = tx; f.z = tz; }                              // (fallen far behind, as on a regrid: caught up at once)
    else { const v = Math.min(d, dt * (L.state === 'walk' ? (L.speed * this.vk * (L.gait === 'Run' ? 1.9 : 1)) * 1.25 + d : 1.5 * S)); if (d > 1e-3) { f.x += dx / d * v; f.z += dz / d * v; } }
    if (d > 0.25 * S && L.state === 'walk') face = Math.atan2(dx, dz);
    f.face = turnTo(f.face, face, dt * 5);
    const moving = L.state === 'walk' || d > 0.6 * S, clip = moving ? (L.gait || 'Walk') : L.state === 'chat' ? 'Idle' : (L.act || 'Idle');
    f.gait = L.gait; f.speed = L.speed;
    if (f.p.curName !== clip || moving) f.p.play(clip, { speed: moving ? this.pace(f, clip) : 1 });
  }
  // two walking toward each other stop to chat now and then; someone standing waves at one going by
  meet(night) {
    const folk = this.folk, R = this.rand, now = this.frame, S = this.size;
    for (const f of folk) { f.push = Math.max(0, f.push - 0.02); f.slow = 1; }
    for (let a = 0; a < folk.length; a++) for (let b = a + 1; b < folk.length; b++) {
      const A = folk[a], B = folk[b]; if (A.inside || B.inside || A.lead || B.lead) continue;   // (the second of a pair goes where the first does)
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) / S; if (d > 7) continue;   // (d: in their own sizes)
      const fa = [Math.sin(A.face), Math.cos(A.face)], fb = [Math.sin(B.face), Math.cos(B.face)];
      // walking into someone: aside a little more, and slower if they're right ahead
      if (d < 1.6) for (const [X, Y, fx, sgn] of [[A, B, fa, 1], [B, A, fb, -1]]) if (X.state === 'walk') {
        const ahead = (fx[0] * dx + fx[1] * dz) * sgn / (d * S || 1); if (ahead > 0.3) { X.push = Math.min(0.9, X.push + 0.06); if (d < 0.9 && Y.state !== 'walk') X.slow = 0.4; } }
      const last = A.met.get(B) || -1e9; if (now - last < 60 * 60) continue;   // (about a minute before the same two meet again)
      if (A.state === 'walk' && B.state === 'walk' && d < 2.6 && fa[0] * fb[0] + fa[1] * fb[1] < -0.3 && !A.kid === !B.kid) {
        A.met.set(B, now); B.met.set(A, now);
        if (R() < 0.5 * (1 - night * 0.5)) {
          const t = 5 + R() * 8;
          for (const [X, Y] of [[A, B], [B, A]]) { X.state = 'chat'; X.until = t; X.chat = Y; X.want = Math.atan2(Y.x - X.x, Y.z - X.z); X.p.play('Idle', { fade: 0.4 }); }
          const w = R() < 0.5 ? A : B; w.p.play('Wave', { fade: 0.3, once: true }); w.wave = 2.1; this.stats.chats++;
        }
      } else if (d < 6 && ((A.state === 'stay' && B.state === 'walk') || (B.state === 'stay' && A.state === 'walk'))) {
        A.met.set(B, now); B.met.set(A, now);
        const S = A.state === 'stay' ? A : B, Wk = S === A ? B : A;
        if (R() < 0.18 && S.act !== 'Interact' && S.wave <= 0) { S.want = turnTo(S.face, Math.atan2(Wk.x - S.x, Wk.z - S.z), 1.2); S.p.play('Wave', { fade: 0.3, once: true }); S.wave = 2.1; this.stats.waves++; }
      }
    }
  }
  dispose() { for (const f of this.folk) { this.group.remove(f.p.root); f.p.dispose(); } this.folk = []; this.scene.remove(this.group); }
}
