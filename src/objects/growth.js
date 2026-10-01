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
const r = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

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

// the settings, with their starting values; each page keeps its own copy and changes it from its panel
//   grow: patchSize (m) and patchSharp (0 mixed .. 1 clean edges); clumpShare of the plants in clumps,
//         clumpSize (m across), clumpCount (plants each); lonerShare as loners; fertSize (m) and fert
//         (0..1): a slow noise thinning the plants in places, thick meadows and thin ground
//   kinds: per kind { on, style, size, weight }
//   family (trees): size (m) of the stretch one kind holds, strength (0..1) how strictly, pineFrom (m)
//         the height the pines take over from
export const GROW_DEFAULTS = { patchSize: 30, patchSharp: 0.6, clumpShare: 0.3, clumpSize: 3, clumpCount: 6, lonerShare: 0.04, fertSize: 120, fert: 0.5 };
export const FAMILY_DEFAULTS = { size: 90, strength: 0.7, pineFrom: 25 };
export const defaultKinds = () => KIND_INFO.map(K => ({ on: true, style: K.style, size: 1, weight: 1 }));

// the rules growPlants uses, kept outside it so patchAt (the Growth Lab's picture of the patches) uses the same
const blk = (k, g) => Math.min(1, KIND_INFO[k].hab === 'wet' ? g.hard : g.blocked);   // how far the ground keeps kind k out
const want = (k, g) => g[KIND_INFO[k].hab] * (1 - blk(k, g));                         // how much kind k likes the ground
const patchN = (G, k, x, z) => { const s = G.patchSize; return vnoise(x / s + k * 37.1, z / s - k * 19.7) * 0.7 + vnoise(x / s * 2.3 + k * 11.3, z / s * 2.3 + k * 5.9) * 0.3; };   // kind k's patch map
const patchW = (G, K, k, g, x, z) => want(k, g) * K[k].weight * Math.pow(patchN(G, k, x, z), 1 + G.patchSharp * 8);   // kind k's claim on a spot
const fertileAt = (G, x, z) => 1 - G.fert * (1 - smooth(vnoise(x / G.fertSize + 61, z / G.fertSize - 23), 0.3, 0.7));
// THE PATCHES AT A SPOT, as a picture would show them: the patch kind with the strongest claim, its share of
// all the claims (1: it holds the spot alone, near 1/n: n kinds are close and the pick there is a toss-up),
// and how thick the plants are there (fertility, 0..1). null where no patch kind can grow.
export function patchAt(x, z, ground, kinds, grow) {
  const g = ground(x, z); if (g.hard >= 1) return null;
  let best = -1, bw = 0, total = 0;
  kinds.forEach((K, k) => { if (!K.on || K.style !== 'patch') return; const w = patchW(grow, kinds, k, g, x, z); total += w; if (w > bw) { bw = w; best = k; } });
  return best < 0 || total <= 0 ? null : { kind: best, share: bw / total, thick: fertileAt(grow, x, z) };
}

// THE GROUND PLANTS round a spot. Returns [{ x, z, sp, scale, yaw }].
//   ground(x, z) -> { hard, blocked, grass, shrub, long, shade, wet, dry }: `hard` (0..1+) where nothing
//     grows (paths, steep, in the water), `blocked` that and the mud and stony shore, which wet kinds don't
//     mind; the rest how much each habitat likes the spot (0..1)
//   at { x, z }, radius (m), count (over the circle), size (all plants), kinds, grow
// THE PLANTS FOLLOW THE CAMERA: the ground is cut into TILE m tiles; each tile always grows the same plants
// (its own seeds), so moving the circle brings tiles in and drops others while every plant that stays keeps
// its spot.
export function growPlants({ ground, at, radius, count, size = 1, kinds, grow }) {
  const out = [], G = grow, K = kinds;
  const scaleOf = (k, t) => (0.7 + 0.6 * r(t, 11.3)) * size * K[k].size;
  const fertile = (x, z) => fertileAt(G, x, z);
  const TILE = 30, C = at, R = radius, tiles = [];
  for (let tz = Math.floor((C.z - R) / TILE); tz <= Math.floor((C.z + R) / TILE); tz++) for (let tx = Math.floor((C.x - R) / TILE); tx <= Math.floor((C.x + R) / TILE); tx++)
    if (Math.hypot((tx + 0.5) * TILE - C.x, (tz + 0.5) * TILE - C.z) < R + TILE * 0.72) tiles.push([tx, tz, ((tx + 200) * 1000 + tz + 200) * 37]);
  const inTile = (tile, t, seed) => [(tile[0] + r(tile[2] + t, seed + 1.7)) * TILE, (tile[1] + r(tile[2] + t, seed + 3.1)) * TILE];
  const inRange = (x, z) => Math.hypot(x - C.x, z - C.z) <= R;
  const perTile = (n) => n / (Math.PI * R * R) * TILE * TILE;                       // a count over the circle, as a count per tile
  const plant = (k, x, z, t) => out.push({ x, z, sp: k, scale: scaleOf(k, t), yaw: r(t, 13.7) * 6.283 });
  const seed = 0, on = K.map((_, k) => k).filter(k => K[k].on);
  if (!on.length || !count) return out;
  const pk = on.filter(k => K[k].style === 'patch'), ck = on.filter(k => K[k].style === 'clump'), lk = on.filter(k => K[k].style === 'loner');
  let nL = lk.length ? Math.round(count * G.lonerShare) : 0, nC = ck.length ? Math.round(count * G.clumpShare) : 0;
  if (!pk.length) { if (ck.length) nC = count - nL; else nL = count; }
  const nP = pk.length ? count - nC - nL : 0;
  // patches: every patch kind has its own slow noise; where the ground suits it, the strongest wins
  for (const tile of tiles) for (let t = 1, got = 0, want_ = Math.round(perTile(nP)); got < want_ && t < want_ * 16; t++) {
    const [x, z] = inTile(tile, t, seed), g = ground(x, z); if (g.hard >= 1) continue;   // (a tile runs the same wherever the circle is; only the planting asks if it's in range)
    let total = 0, hab = 0; const w = pk.map(k => { const h = want(k, g) * K[k].weight; hab += h; const v = h * Math.pow(patchN(G, k, x, z), 1 + G.patchSharp * 8); total += v; return v; });
    if (r(tile[2] + t, seed + 5.3) > hab / pk.length * 0.9 * fertile(x, z) || total <= 0) continue;
    let q = r(tile[2] + t, seed + 9.1) * total, k = pk[pk.length - 1]; for (let n = 0; n < pk.length; n++) if ((q -= w[n]) <= 0) { k = pk[n]; break; }
    if (inRange(x, z)) plant(k, x, z, tile[2] + t + seed * 1000); got++;
  }
  // clumps: a centre where the kind likes it (families: nearby clumps lean the same way), then its plants
  // scattered round the centre
  for (const tile of tiles) for (let c = 1, got = 0, want_ = Math.round(perTile(nC)); got < want_ && c < want_ * 4; c++) {
    const [cx, cz] = inTile(tile, c, seed + 40), g = ground(cx, cz); if (g.hard >= 0.6) continue;
    let total = 0, hab = 0; const w = ck.map(k => { const h = want(k, g) * K[k].weight; hab += h; const v = h * Math.pow(patchN(G, k + 50, cx * 0.5, cz * 0.5), 3); total += v; return v; });
    const cs = tile[2] + c;
    if (r(cs, seed + 41.3) > hab / ck.length * 1.2 * fertile(cx, cz) || total <= 0) continue;
    let q = r(cs, seed + 43.9) * total, k = ck[ck.length - 1]; for (let n = 0; n < ck.length; n++) if ((q -= w[n]) <= 0) { k = ck[n]; break; }
    const n = Math.max(2, Math.round(G.clumpCount * (0.6 + 0.8 * r(cs, seed + 47.1))));
    for (let m = 0; m < n && got < want_; m++) {
      const a = r(cs * 31 + m, seed + 51.7) * Math.PI * 2, d = G.clumpSize * Math.sqrt(-2 * Math.log(Math.max(1e-4, r(cs * 31 + m, seed + 53.3)))) * 0.5;   // gathered toward the middle
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (blk(k, ground(x, z)) >= 0.8) continue;
      if (inRange(x, z)) plant(k, x, z, tile[2] + c * 31 + m + seed * 1000); got++;
    }
  }
  // loners: here and there, where the kind likes it
  for (const tile of tiles) for (let t = 1, got = 0, want_ = perTile(nL); got < want_ && t < Math.max(1, want_) * 20; t++) {
    if (want_ < 1 && r(tile[2], seed + 77.7) > want_) break;                      // under one a tile: some tiles get one
    const [x, z] = inTile(tile, t, seed + 70), g = ground(x, z); if (g.hard >= 0.6) continue;
    const k = lk[Math.floor(r(tile[2] + t, seed + 71.9) * lk.length) % lk.length]; if (r(tile[2] + t, seed + 73.1) > want(k, g) + 0.1) continue;
    if (inRange(x, z)) plant(k, x, z, tile[2] + t + seed * 1000 + 500); got++;
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
