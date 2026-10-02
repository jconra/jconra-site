// GROWTH: where the ground plants and the trees go. Shared by the Terrain Lab (on its real land) and the
// Growth Lab (a flat, cheap top-down view for trying settings), so a setting means the same in both and
// the settings JSON from one pastes straight into the other.
//
// It knows nothing about any particular land: the caller hands it `ground(x, z)`, which says what the
// ground at a spot is like (see growPlants), and for trees the height and slope there (see pickTree).

export function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// a random number 0..1 for (a, b): a a whole number (which spot), b a seed (which draw for it). Mixed with
// integer hashing: the old sin-based one tied draws together when two seeds turned the sine by about 0 or pi
// (a loner's kind mirrored its position, and whether it was kept used the same number as its depth: lines).
const r = (a, b) => {
  let h = Math.imul((a | 0) ^ Math.imul(Math.round(b * 1000), 0x9E3779B1), 0x85EBCA6B) ^ Math.imul(Math.floor(a / 4294967296), 0x27D4EB2F);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16; h = Math.imul(h, 0x165667B1); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

// THE 16 GROUND PLANTS (Jacob's picks in the Plant Lab, baked into one sheet, models/props/groundPlants.glb,
// by labs/plants/build_sheet.py), in sheet order: each with its height (m), the ground it likes, and how it
// grows to start with
//   hab: long (open, dry rises)  grass (open and part shade)  shade (under and beside trees)
//        shrub (the forest's edge)  wet (along water, on the stony shore too)  dry (open, dry, sunny)
export const KIND_INFO = [
  ['tall seed grass', 1.0, 'long', 'patch'], ['feather grass', 0.9, 'long', 'patch'], ['broad-blade grass', 0.8, 'long', 'patch'], ['bunchgrass', 0.55, 'grass', 'patch'],
  ['broad-leaf hosta', 0.55, 'shade', 'clump'], ['wild strawberry', 0.25, 'grass', 'patch'], ['dandelion', 0.35, 'grass', 'loner'], ['yucca', 0.8, 'dry', 'loner'],
  ['paintbrush', 0.5, 'long', 'clump'], ['snowdrops', 0.3, 'shade', 'clump'], ['columbine', 0.55, 'shade', 'loner'], ['violets', 0.2, 'shade', 'patch'],
  ['cattails', 1.4, 'wet', 'clump'], ['sprig shrub', 0.8, 'shrub', 'clump'], ['spruce sapling', 1.1, 'shrub', 'loner'], ['marsh marigold', 0.4, 'wet', 'clump'],
].map(([name, height, hab, style]) => ({ name, height, hab, style }));
// the bigger plants are lit by the sun as the shapes they are (their own normals, bent 35% toward up so a
// leaf seen from behind isn't black); the grasses and flowers are lit like the ground (every face as if up)
for (const n of ['cattails', 'yucca', 'sprig shrub', 'spruce sapling']) KIND_INFO.find(K => K.name === n).lit = true;
export const LIT_SOFTEN = 0.35;

// the settings, with their starting values; each page keeps its own copy and changes it from its panel
//   grow: patchSize (m) and patchSharp (0 mixed .. 1 clean edges); clumpShare of the plants in clumps,
//         clumpSize (m across), clumpCount (plants each); lonerShare as loners; fertSize (m) and fert
//         (0..1): a slow noise thinning the plants in places, thick meadows and thin ground
//   kinds: per kind { on, style, size, weight }
//   family (trees): size (m) of the stretch one kind holds, strength (0..1) how strictly, pineFrom (m)
//         the height the pines take over from
//   winner: each patch spot always goes to the strongest claim (pure patches) instead of a weighted draw
//   bare (0..1): how much of the ground is open, no plants (bareSize m across)
//   wetSize (0..1): plants bigger in damp ground, smaller on dry (at 1: 0.75x on the driest, 1.3x in the wettest)
//   clumpEdge (0..1): clumps kept to where patches meet (and round the bare ground) instead of anywhere
//   lonerBare (0..1): loners kept to the bare ground (1: only there), so the open areas hold the flowers
//   longClear (0..1): long grasses kept out from under and beside the trees (1: none in the trees' shade)
//   lawn (0..1): how much of the bare ground the short lawn grass covers (see lawnSpots)
// (the defaults are Jacob's: the Growth Lab on 2026-10-01, then the Terrain Lab's on 2026-10-02)
export const GROW_DEFAULTS = { patchSize: 90, patchSharp: 1, clumpShare: 0.23, clumpSize: 2.5, clumpCount: 10, lonerShare: 0.11, fertSize: 110, fert: 0.33,
  winner: true, bare: 0.59, bareSize: 43, wetSize: 0.88, clumpEdge: 1, lonerBare: 0.16, longClear: 1, lawn: 1 };
export const COVER_DEFAULTS = { size: 2.6, density: 40000 };   // density: how many in a circle 140 m round (the Growth Lab's "how many")
export const FAMILY_DEFAULTS = { size: 90, strength: 0.7, pineFrom: 25 };
const KIND_SIZES = [1.8, 1.95, 1.85, 1.55, 0.65, 1.6, 1.9, 1.45, 1.15, 1.1, 1.6, 1.4, 1, 1.65, 1.05, 1.55];   // Jacob's, 2026-10-01
export const defaultKinds = () => KIND_INFO.map((K, k) => ({ on: true, style: K.style, size: KIND_SIZES[k], weight: 1 }));

// the rules growPlants uses, kept outside it so patchAt (the Growth Lab's picture of the patches) uses the same
const blk = (k, g) => Math.min(1, KIND_INFO[k].hab === 'wet' ? g.hard : g.blocked);   // how far the ground keeps kind k out
let longClear = 1;                                                                       // (set from grow.longClear by each call)
const want = (k, g) => g[KIND_INFO[k].hab] * (1 - blk(k, g)) * (KIND_INFO[k].hab === 'long' ? Math.max(0, 1 - g.shade * 3 * longClear) : 1);   // how much kind k likes the ground; long grass stays out of the trees' shade
const patchN = (G, k, x, z) => { const s = G.patchSize; return vnoise(x / s + k * 37.1, z / s - k * 19.7) * 0.7 + vnoise(x / s * 2.3 + k * 11.3, z / s * 2.3 + k * 5.9) * 0.3; };   // kind k's patch map
const patchW = (G, K, k, g, x, z) => want(k, g) * K[k].weight * Math.pow(patchN(G, k, x, z), 1 + G.patchSharp * 8);   // kind k's claim on a spot
const fertileAt = (G, x, z) => 1 - G.fert * (1 - smooth(vnoise(x / G.fertSize + 61, z / G.fertSize - 23), 0.3, 0.7));
// BARE GROUND: its own slow map; where it's above the line the ground stays open. 0 none .. 1 open.
const bareAt = (G, x, z) => { if (!(G.bare > 0)) return 0; const n = vnoise(x / G.bareSize + 211, z / G.bareSize - 97) * 0.75 + vnoise(x / G.bareSize * 2.7 + 5, z / G.bareSize * 2.7 + 9) * 0.25;
  const line = 1 - G.bare * 0.85, soft = 0.03 + 0.12 * (1 - G.patchSharp); return smooth(n, line - soft, line + soft); };
// how clearly one patch kind holds a spot (1 alone .. 0 a toss-up), from all the patch kinds' claims
function clarity(G, K, g, x, z) {
  let bw = 0, total = 0, n = 0;
  K.forEach((k_, k) => { if (!k_.on || k_.style !== 'patch') return; const w = patchW(G, K, k, g, x, z); total += w; n++; if (w > bw) bw = w; });
  return n > 1 && total > 0 ? Math.max(0, (bw / total - 1 / n) / (1 - 1 / n)) : 1;
}
// a plant's size from the moisture where it stands: wetter bigger, drier smaller
const wetScale = (G, g) => { if (!(G.wetSize > 0)) return 1; const m = Math.max(-1, Math.min(1, g.wet - g.dry)); return 1 + G.wetSize * (m > 0 ? 0.3 * m : 0.25 * m); };

// THE PATCHES AT A SPOT, as a picture would show them: the patch kind with the strongest claim, its share of
// all the claims (1: it holds the spot alone, near 1/n: n kinds are close and the pick there is a toss-up),
// and how thick the plants are there (fertility, 0..1). null where no patch kind can grow.
export function patchAt(x, z, ground, kinds, grow) {
  longClear = grow.longClear ?? 0;
  const g = ground(x, z); if (g.hard >= 1) return null;
  let best = -1, bw = 0, total = 0;
  kinds.forEach((K, k) => { if (!K.on || K.style !== 'patch') return; const w = patchW(grow, kinds, k, g, x, z); total += w; if (w > bw) { bw = w; best = k; } });
  return best < 0 || total <= 0 ? null : { kind: best, share: bw / total, thick: fertileAt(grow, x, z), bare: bareAt(grow, x, z) };
}

// THE GROUND PLANTS round a spot. Returns [{ x, z, sp, scale, yaw }].
//   ground(x, z) -> { hard, blocked, grass, shrub, long, shade, wet, dry }: `hard` (0..1+) where nothing
//     grows (paths, steep, in the water), `blocked` that and the mud and stony shore, which wet kinds don't
//     mind; the rest how much each habitat likes the spot (0..1)
//   at { x, z }, radius (m), count (over the circle), size (all plants), kinds, grow
// THE PLANTS FOLLOW THE CAMERA: the ground is cut into TILE m tiles; each tile always grows the same plants
// (its own seeds), so moving the circle brings tiles in and drops others while every plant that stays keeps
// its spot.
// far (>= 1): past `radius` the plants carry on out to radius x far, ever sparser but bigger (each standing in for
// the several it replaces, up to 3x), fading out over the last fifth: cheap, they are all imposters out there
export function growPlants(opts) { const it = growPlantsSteps(opts); let n; while (!(n = it.next()).done); return n.value; }
// the same, a little at a time: yields whenever `budget` ms have gone (so a page can spread it over frames),
// and returns the list at the end
export function* growPlantsSteps({ ground, at, radius, count, size = 1, kinds, grow, far = 1, cache = null, budget = Infinity }) {
  let t0 = performance.now();
  const out = [], G = grow, K = kinds; longClear = G.longClear ?? 0;
  const TILE = 30, C = at, R = radius, RF = R * Math.max(1, far);
  // how thin the plants are at a distance (1 inside the inner 80%, then falling with the square of the distance)
  const thinAt = (d) => d <= R * 0.8 ? 1 : Math.pow(R * 0.8 / d, 2);
  // THE TILES' PLANTS ARE REMEMBERED (in `cache`, when given): a tile always grows the same plants for the same
  // settings and thinning, so as the circle moves only the tiles new to it are worked out. A tile is grown at a
  // thinning rounded UP to a power of two (from its nearest edge), so it keeps that level while the circle moves
  // a little; each plant is then thinned the rest of the way to its own distance, which is quick.
  const sig = JSON.stringify([G, K, count, size, R]);
  if (cache && cache.sig !== sig) { cache.tiles = new Map(); cache.sig = sig; }
  const on = K.map((_, k) => k).filter(k => K[k].on);
  if (!on.length || !count) return out;
  const pk = on.filter(k => K[k].style === 'patch'), ck = on.filter(k => K[k].style === 'clump'), lk = on.filter(k => K[k].style === 'loner');
  let nL = lk.length ? Math.round(count * G.lonerShare) : 0, nC = ck.length ? Math.round(count * G.clumpShare) : 0;
  if (!pk.length) { if (ck.length) nC = count - nL; else nL = count; }
  const nP = pk.length ? count - nC - nL : 0;
  const perTile = (n, level) => n / (Math.PI * R * R) * TILE * TILE * level;          // a count over the circle, as a count per tile (thinned far off)
  // one tile's plants at a thinning level: [{ k, x, z, t, s (size before the distance), kr, fr (its two draws for thinning and fading) }]
  function growTile(tx, tz, level) {
    const list = [], seed = 0, ts = ((tx + 200) * 1000 + tz + 200) * 37;
    const inTile = (t, sd) => [(tx + r(ts + t, sd + 1.7)) * TILE, (tz + r(ts + t, sd + 3.1)) * TILE];
    const add = (k, x, z, t, g) => list.push({ k, x, z, t, s: (0.7 + 0.6 * r(t, 11.3)) * size * K[k].size * wetScale(G, g), kr: r(t, 401.9), fr: r(t, 403.1) });
    // patches: every patch kind has its own slow noise; where the ground suits it, the strongest wins
    for (let t = 1, got = 0, want_ = Math.round(perTile(nP, level)); got < want_ && t < want_ * 16; t++) {
      const [x, z] = inTile(t, seed), g = ground(x, z); if (g.hard >= 1) continue;
      if (G.bare > 0 && r(ts + t, seed + 17.9) < bareAt(G, x, z)) { got++; continue; }       // open ground: the spot stays empty
      let total = 0, hab = 0; const w = pk.map(k => { const h = want(k, g) * K[k].weight; hab += h; const v = h * Math.pow(patchN(G, k, x, z), 1 + G.patchSharp * 8); total += v; return v; });
      if (r(ts + t, seed + 5.3) > hab / pk.length * 0.9 * fertileAt(G, x, z) || total <= 0) continue;
      let k = pk[pk.length - 1];
      if (G.winner) { let b = -1; w.forEach((v, n) => { if (v > b) { b = v; k = pk[n]; } }); }
      else { let q = r(ts + t, seed + 9.1) * total; for (let n = 0; n < pk.length; n++) if ((q -= w[n]) <= 0) { k = pk[n]; break; } }
      add(k, x, z, ts + t + seed * 1000, g); got++;
    }
    // clumps: a centre where the kind likes it (families: nearby clumps lean the same way), then its plants
    // scattered round the centre
    for (let c = 1, got = 0, want_ = Math.round(perTile(nC, level)); got < want_ && c < want_ * (G.clumpEdge > 0 ? 14 : 4); c++) {
      const [cx, cz] = inTile(c, seed + 40), g = ground(cx, cz); if (g.hard >= 0.6) continue;
      const b = G.bare > 0 ? bareAt(G, cx, cz) : 0; if (b > 0.85) continue;                  // not out in the open ground
      if (G.clumpEdge > 0) {                                                                  // kept to where patches meet, or the bare ground's rim
        const edge = Math.max(1 - clarity(G, K, g, cx, cz), G.bare > 0 ? 1 - Math.abs(2 * b - 1) : 0);
        if (r(ts + c, seed + 39.7) > 1 - G.clumpEdge * (1 - Math.pow(edge, 0.7))) continue;
      }
      let total = 0, hab = 0; const w = ck.map(k => { const h = want(k, g) * K[k].weight; hab += h; const v = h * Math.pow(patchN(G, k + 50, cx * 0.5, cz * 0.5), 3); total += v; return v; });
      const cs = ts + c;
      if (r(cs, seed + 41.3) > hab / ck.length * 1.2 * fertileAt(G, cx, cz) || total <= 0) continue;
      let q = r(cs, seed + 43.9) * total, k = ck[ck.length - 1]; for (let n = 0; n < ck.length; n++) if ((q -= w[n]) <= 0) { k = ck[n]; break; }
      const n = Math.max(2, Math.round(G.clumpCount * (0.6 + 0.8 * r(cs, seed + 47.1))));
      for (let m = 0; m < n && got < want_; m++) {
        const a = r(cs * 31 + m, seed + 51.7) * Math.PI * 2, d = G.clumpSize * Math.sqrt(-2 * Math.log(Math.max(1e-4, r(cs * 31 + m, seed + 53.3)))) * 0.5;   // gathered toward the middle
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, gm = ground(x, z); if (blk(k, gm) >= 0.8) continue;
        add(k, x, z, ts + c * 31 + m + seed * 1000, gm); got++;
      }
    }
    // loners: here and there, where the kind likes it
    for (let t = 1, got = 0, want_ = perTile(nL, level); got < want_ && t < Math.max(1, want_) * 20; t++) {
      if (want_ < 1 && r(ts, seed + 77.7) > want_) break;                                    // under one a tile: some tiles get one
      const [x, z] = inTile(t, seed + 70), g = ground(x, z); if (g.hard >= 0.6) continue;
      if (G.bare > 0) { const b = bareAt(G, x, z), lb = G.lonerBare || 0;                     // kept out of the bare ground, or (lonerBare) kept to it
        if (lb > 0 ? r(ts + t, seed + 79.3) > lb * b + (1 - lb) * (1 - b) : r(ts + t, seed + 79.3) < b) continue; }
      const k = lk[Math.floor(r(ts + t, seed + 71.9) * lk.length) % lk.length]; if (r(ts + t, seed + 75.7) > want(k, g) + 0.1) continue;   // (its own draw: 73.1 is the spot's depth in the tile)
      add(k, x, z, ts + t + seed * 1000 + 500, g); got++;
    }
    return list;
  }
  // the tiles round the circle, each at its level, from the cache or grown; then every plant thinned to its own
  // distance (far off a plant stands in for the ones thinned away: bigger by the square root of the thinning, at
  // most 3x) and faded over the last fifth
  for (let tz = Math.floor((C.z - RF) / TILE); tz <= Math.floor((C.z + RF) / TILE); tz++) for (let tx = Math.floor((C.x - RF) / TILE); tx <= Math.floor((C.x + RF) / TILE); tx++) {
    const dt = Math.hypot((tx + 0.5) * TILE - C.x, (tz + 0.5) * TILE - C.z); if (dt >= RF + TILE * 0.72) continue;
    const level = Math.min(1, Math.pow(2, Math.ceil(Math.log2(thinAt(Math.max(0, dt - TILE * 0.72))))));
    // a tile grown denser than it now needs is reused (its plants thinned further below); grown again only when
    // it needs to be denser, i.e. as you come toward it
    let list, lv = level; const key = tx * 100003 + tz;
    if (cache) { const e = cache.tiles.get(key); if (e && e.level >= level) { list = e.list; lv = e.level; cache.hits = (cache.hits || 0) + 1; } else { list = growTile(tx, tz, level); cache.tiles.set(key, { level, list }); cache.misses = (cache.misses || 0) + 1; } }
    else list = growTile(tx, tz, level);
    if (performance.now() - t0 > budget) { yield; t0 = performance.now(); }
    for (const p of list) {
      const d = Math.hypot(p.x - C.x, p.z - C.z); if (d > RF) continue;
      const th = thinAt(d); if (p.kr > th / lv || (d > RF * 0.8 && p.fr > smooth(d, RF, RF * 0.8))) continue;
      out.push({ x: p.x, z: p.z, sp: p.k, scale: p.s * Math.min(3, 1 / Math.sqrt(th)), yaw: r(p.t, 13.7) * 6.283 });
    }
  }
  // tiles far behind the circle are forgotten, so the cache doesn't grow without end
  if (cache && cache.tiles.size > 6000) for (const k of [...cache.tiles.keys()].slice(0, 2000)) cache.tiles.delete(k);
  return out;
}

// THE LAWN: short grass tufts (src/objects/lawn.js) on the bare ground, `density` tufts a square metre, within
// `radius` m of `at`; tiled like the plants, so tufts that stay in range keep their spots as `at` moves.
// grow.lawn (0..1): how much of the bare ground they cover. Returns [{ x, z, turn, size, yellow, light }].
export function lawnSpots(opts) { const it = lawnSpotsSteps(opts); let n; while (!(n = it.next()).done); return n.value; }
export function* lawnSpotsSteps({ ground, at, radius, density, grow, budget = Infinity }) {
  const out = [], G = grow; let t0 = performance.now(); if (!(G.bare > 0) || !(G.lawn > 0) || !(density > 0)) return out;
  const TILE = 10, C = at, R = radius, per = Math.round(density * TILE * TILE);
  for (let tz = Math.floor((C.z - R) / TILE); tz <= Math.floor((C.z + R) / TILE); tz++) for (let tx = Math.floor((C.x - R) / TILE); tx <= Math.floor((C.x + R) / TILE); tx++) {
    if (Math.hypot((tx + 0.5) * TILE - C.x, (tz + 0.5) * TILE - C.z) > R + TILE) continue;
    const ts = ((tx + 5000) * 10007 + tz + 5000) * 13;
    for (let t = 0; t < per; t++) {
      const x = (tx + r(ts + t, 301.1)) * TILE, z = (tz + r(ts + t, 302.3)) * TILE;
      if (Math.hypot(x - C.x, z - C.z) > R) continue;
      if (r(ts + t, 303.7) > bareAt(G, x, z) * G.lawn) continue;
      const g = ground(x, z); if (g.hard >= 0.5) continue;
      out.push({ x, z, turn: r(ts + t, 304.9) * 6.283, size: 0.7 + 0.7 * r(ts + t, 305.3), yellow: r(ts + t, 306.1) < 0.2 ? 0.35 : 0, light: (r(ts + t, 307.9) - 0.5) * 0.25 });
    }
    if (performance.now() - t0 > budget) { yield; t0 = performance.now(); }
  }
  return out;
}

// WHICH TREE WHERE: each kind has the ground it likes, and each grows in families: a slow noise per kind,
// so one kind holds a stretch of ground and gives way to the next at the edges.
//   pine:  the slopes and the heights, darker; the hills' forest
//   aspen: groves of one clone (one colour for the whole grove), on the lower slopes and damp ground
//   ash:   the valley, the damper parts;  oak: the valley, the drier rises
// names: the species' names in order; spot { height (m), slope (rise over run), wet, dry (0..1) }.
// Returns { sp (index into names), hsl: [h, s, l] } (the tree's tint).
export function pickTree(x, z, names, spot, family) {
  const up = Math.max(smooth(spot.height, family.pineFrom, family.pineFrom + 90), smooth(spot.slope, 0.2, 0.6));
  const fam = (seed, size) => { let n = 0, a = 1, f = 1 / size; for (let o = 0; o < 2; o++) { n += (vnoise(x * f + seed, z * f - seed) - 0.5) * a; a *= 0.5; f *= 2.3; } return Math.min(1, Math.max(0, n * 1.6 + 0.5)); };
  const want = { pine: 0.15 + 2.2 * up, aspen: 0.2 + 0.8 * smooth(spot.slope, 0.1, 0.4) * (1 - smooth(spot.height, family.pineFrom + 60, family.pineFrom + 160)) + 0.8 * spot.wet, ash: (1 - up) * (0.4 + 1.2 * spot.wet), oak: (1 - up) * (0.4 + 1.2 * spot.dry) };
  const seeds = { pine: 11, aspen: 37, ash: 73, oak: 101 }, sizes = { pine: 1.6, aspen: 0.45, ash: 1, oak: 1 };   // aspen groves are small, pine stands big
  let total = 0; const w = names.map(nm => { const f = fam(seeds[nm] || 7, family.size * (sizes[nm] || 1)); const v = Math.pow(want[nm] ?? 0.2, 1.5) * Math.pow(f + 0.05, 1 + family.strength * 5); total += v; return v; });
  let q = hash(x * 0.37, z * 0.71) * total, sp = names.length - 1; for (let n = 0; n < w.length; n++) { if ((q -= w[n]) <= 0) { sp = n; break; } }
  const name = names[sp], h = hash(z * 1.3, x * 0.9);
  let hsl;
  if (name === 'aspen') { const g = vnoise(x / (family.size * 0.45) + 37, z / (family.size * 0.45) - 37); hsl = [0.2 + g * 0.1, 0.45 + g * 0.2, 0.62 + 0.04 * h]; }
  else if (name === 'pine') hsl = [0.3 + h * 0.04, 0.3 + h * 0.15, 0.36 + h * 0.08];
  else hsl = [0.26 + h * 0.08, 0.35 + h * 0.2, 0.55 + h * 0.15];
  return { sp, hsl };
}

// SETTINGS AS TEXT: what both labs copy out and paste in. { growth: 1, grow, family, kinds, cover: { count, size } }
export function settingsJSON(grow, family, kinds, cover) {
  return JSON.stringify({ growth: 1, grow, family, kinds: kinds.map((k, i) => ({ name: KIND_INFO[i].name, ...k })), cover: { count: cover.count, size: cover.size } });
}
// reads them into the objects given (in place); kinds matched by name, so a reordered sheet still lines up.
// Returns false for text that isn't growth settings.
export function applySettings(text, grow, family, kinds, cover) {
  let s; try { s = JSON.parse(text); } catch (e) { return false; }
  if (!s || s.growth !== 1) return false;
  Object.assign(grow, s.grow || {}); Object.assign(family, s.family || {});
  for (const k of s.kinds || []) { const i = KIND_INFO.findIndex(K => K.name === k.name); if (i >= 0) for (const f of ['on', 'style', 'size', 'weight']) if (f in k) kinds[i][f] = k[f]; }
  if (s.cover) { if ('count' in s.cover) cover.count = s.cover.count; if ('size' in s.cover) cover.size = s.cover.size; }
  return true;
}
