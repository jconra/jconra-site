// TERRAIN LAB. Techniques games use so a ground texture does not look like it repeats, each one a
// switch, with a split screen: left of the line the plain texture, right of it the techniques.
//   1. Hex-tiling (after Mikkelsen, "Practical Real-Time Hex-Tiling", 2022): the ground is cut
//      into a triangle grid; each grid vertex owns a random shift and turn of the texture, and a
//      pixel blends the three vertices around it by its barycentric weights, sharpened, and
//      optionally tipped toward the brighter sample so the blend follows the picture.
//   2. Large-scale variation: slow noise tints and brightens the ground in big patches.
//   3. A second, larger read of the same texture fading in with distance.
// The ground is MeshStandardMaterial with the map lookup replaced, so it lights like the town.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Forest, FOREST_SPECIES } from '../../src/objects/forest.js';
import { chooseTier, saveTier, watchFrames, TIERS } from '../../src/quality.js';
import { makeCloudSky, SKY_GLSL } from '../../src/objects/cloudSky.js';
import { WIND, tickWind } from '../../src/objects/wind.js';
import { makeLawn } from '../../src/objects/lawn.js';
import { KIND_INFO, LIT_SOFTEN, GROW_DEFAULTS, FAMILY_DEFAULTS, COVER_DEFAULTS, defaultKinds, growPlants, growPlantsSteps, lawnSpots, lawnSpotsSteps, patchAt, pickTree as pickTreeKind, settingsJSON, applySettings } from '../../src/objects/growth.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
// QUALITY: what each tier means here. `forest`, `cover` and `u` seed the defaults before anything is
// built; `controls` are the panel's own controls, set (and fired) when the tier changes while running.
// `lawn`: the short lawn grass on the bare ground, out to `radius` m, `density` tufts a square metre (off on potato)
// `shadow`: real sun shadows (a shadow map) from trees, stones and, on gaming, the plants, over
// `range` m round where you look; past it (and on potato) the baked shade does the job.
// Potato is aimed at a machine with no graphics card (a thin client: every pixel drawn by the
// processor), so it cuts pixels first: half resolution, every tree and plant an imposter, and `lite`,
// fixed at load: no smoothing, a land mesh with a quarter of the points, and the ground painted in
// flat colours (each picture's average) instead of read from the pictures, one noise read where
// there were four.
const TIER_SET = {
  potato: { ratio: 0.5, lite: true, coverFarX: 1.8, lawn: { radius: 0, density: 0 }, stones: 1500, treeShare: 0.45, shadow: null, forest: { imposterAt: 0, band: 0, grid: 8, cell: 192, detail: 'sparse' }, cover: { count: 8000, near: 0, radius: 90 },
            u: { wWaveOn: 0, stampFar: 12 }, checks: { stampOn: false, hexOn: false, farOn: false, wWaveOn: false, cloudsOn: false } },
  normal: { ratio: 1.5, coverFarX: 2.5, lawn: { radius: 40, density: 10 }, stones: 14000, shadow: { range: 80, size: 1024, cover: false }, forest: { imposterAt: 150, band: 120, grid: 12, cell: 192, detail: 'sparse' }, cover: { count: 40000, near: 35, radius: 140 },
            u: { wWaveOn: 1, stampFar: 30 }, checks: { stampOn: true, hexOn: true, farOn: false, wWaveOn: true, cloudsOn: true } },
  gaming: { ratio: 2, coverFarX: 2.5, lawn: { radius: 60, density: 14 }, stones: 26000, shadow: { range: 150, size: 2048, cover: true }, forest: { imposterAt: 260, band: 140, grid: 14, cell: 192, detail: 'coarse' }, cover: { count: 66000, near: 45, radius: 180 },
            u: { wWaveOn: 1, stampFar: 45 }, checks: { stampOn: true, hexOn: true, farOn: true, wWaveOn: true, cloudsOn: true } },
};
// the tier is picked on a throwaway context first, so the real one can be made without smoothing
// (multisampling) on potato; smoothing can't be changed after a context exists, so a tier switch
// while running keeps whatever the page started with
const QUAL = (() => { const probe = new THREE.WebGLRenderer(); const q = chooseTier(probe); probe.dispose(); probe.forceContextLoss(); return q; })(), TS = TIER_SET[QUAL.tier];
const renderer = new THREE.WebGLRenderer({ antialias: !TS.lite });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, TS.ratio));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const GL2 = renderer.capabilities.isWebGL2;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xa9c8e4); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 150, 1400);   // the haze does its share of hiding the repeat far off
// the sky: blue deepening overhead, clouds drifting; the water reflects the same sky (potato: plain colour)
const sky = makeCloudSky({ horizon: SKY }); scene.add(sky.mesh);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b5a44, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-300, 400, -200); scene.add(sun);
const SHADOW = { on: !!TS.shadow, range: TS.shadow ? TS.shadow.range : 0 };
if (TS.shadow) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.castShadow = true; sun.shadow.mapSize.set(TS.shadow.size, TS.shadow.size); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
  scene.add(sun.target);
}
// the shadow map's square follows where you look, stepped a texel at a time so the edges don't crawl
function followShadow() {
  if (!SHADOW.on) return;
  const R = SHADOW.range, c = sun.shadow.camera, t = controls.target, fwd = new THREE.Vector3().subVectors(t, camera.position).setY(0);
  const at = camera.position.clone().addScaledVector(fwd.lengthSq() > 1e-6 ? fwd.normalize() : fwd, R * 0.5);
  const texel = 2 * R / sun.shadow.mapSize.x; at.x = Math.round(at.x / texel) * texel; at.z = Math.round(at.z / texel) * texel; at.y = heightAt(at.x, at.z);
  c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 2000; c.updateProjectionMatrix();
  sun.target.position.copy(at); sun.position.copy(at).addScaledVector(SUN_DIR, 900);
  U.shadowRange.value = R; U.shadowAt.value.copy(at);
}

// ── the land: hills from noise, then terraces, then erosion, on a 512 x 512 grid ──────────
// The grid (3.1 m a cell, the same cells the maps use) is the land: the mesh, the maps, the trees,
// the plants and the camera all read it through heightAt.
const SIZE = 1600, N = 512, SEG = TS.lite ? 255 : N - 1, TEX = SIZE / N;   // the mesh: a vertex on each cell, or on every other one
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
// THE VALLEY: mountains rise on either side of a winding valley floor. The distance from the valley's
// line (which meanders by noise) sets how far up the mountainside a point is; the mountains carry
// ridged noise for peaks and spurs. The old rolling hills stay on top as small detail.
const VALLEY = { on: true, height: 260, width: 360, slope: 380, steep: 1.6, angle: 20, meander: 235, ridges: 0.55, fine: 0.35 };
// the mountains' ridged noise in five layers, the big peaks first; `VALLEY.fine` turns down the last
// three (bumps ~25-100 m across), which otherwise wobble every slope; it also turns down the rolling
// hills' fine layers below
function ridged(x, z) { let h = 0, a = 1, f = 1 / 420, n = 0; for (let o = 0; o < 5; o++) { const w = a * (o >= 2 ? VALLEY.fine : 1); h += (1 - Math.abs(vnoise(x * f + 9, z * f + 3) * 2 - 1)) * w; n += w; a *= 0.5; f *= 2.05; } return h / n; }
function baseHeight(x, z) {
  let h = 0, amp = 1, f = 1 / 260;
  for (let i = 0; i < 5; i++) { h += (vnoise(x * f, z * f) - 0.5) * amp * (i >= 2 ? VALLEY.fine : 1); amp *= 0.45; f *= 2.1; }   // the fine layers (under ~60 m) on the same slider
  const r = Math.hypot(x, z);
  let out = h * 55 * THREE.MathUtils.smoothstep(r, 60, 500) + h * 6;
  if (VALLEY.on) {
    out = h * 22 + h * 10 * THREE.MathUtils.smoothstep(r, 60, 500);                    // gentler rolls on the floor
    const a = THREE.MathUtils.degToRad(VALLEY.angle), along = x * Math.cos(a) + z * Math.sin(a), across = -x * Math.sin(a) + z * Math.cos(a);
    const d = Math.abs(across - (vnoise(along / 380 + 50, 7) - 0.5) * 2 * VALLEY.meander);
    const up = THREE.MathUtils.clamp((d - VALLEY.width / 2) / VALLEY.slope, 0, 1.6);
    const peaks = 1 - VALLEY.ridges + VALLEY.ridges * 1.6 * ridged(x, z);
    out += VALLEY.height * Math.pow(up, VALLEY.steep) * peaks + along * 0.03;       // and the whole floor falls gently along the valley
  }
  return out;
}
// (the land's shape as Jacob set it, 2026-10-01)
const SHAPE = { terraceOn: true, step: 30, riser: 0.03, terraceAmount: 0.22, terraceFrom: 1, terraceSpread: 0.35, erodeOn: true, erodeSmooth: 3, drops: 90000, erodeStrength: 0.35, ravines: 40, ravineStrength: 4, ravineScale: 4, ravineRound: 0.8, crags: 40, cragSize: 60, cragSharp: 0.5 };
const LAND = { wetDepth: 7, dryHeight: 6.0, forest: 0.55, shadeReach: 4, pathWidth: 2.2, treeline: 280, hillForest: 0.3, shore: 2 };   // (the land maps' settings; up here because the crags read the treeline)
const Hg = new Float32Array(N * N), FLOW = new Float32Array(N * N), SETTLE = new Float32Array(N * N);
const cellX = (i) => (i + 0.5) * TEX - SIZE / 2;
// TERRACES: the height is stepped - a flat top, then a short steep riser - the way rock bands break a
// steep face into ledges: only where the land is steep (`sl`, the slope's rise over run, against
// `terraceFrom`), and where a slow noise says so (terraceSpread of it); each step's level nudged by
// noise so the ledges wander. Gentle ground is never stepped (that's rice paddies, not mountains).
function terrace(h, x, z, sl) {
  const where = THREE.MathUtils.smoothstep(vnoise(x / 190 + 70, z / 190 + 30), 1 - SHAPE.terraceSpread, 1.12 - SHAPE.terraceSpread)
    * THREE.MathUtils.smoothstep(sl, SHAPE.terraceFrom, SHAPE.terraceFrom + 0.35);
  if (where <= 0) return h;
  const S = SHAPE.step, o = (vnoise(x / 45 + 11, z / 45 + 5) - 0.5) * S * 0.9, t = (h + o) / S, k = Math.floor(t), f = t - k;
  const stepped = (k + THREE.MathUtils.smoothstep(f, 1 - SHAPE.riser, 1)) * S - o;
  return h + (stepped - h) * where * SHAPE.terraceAmount;
}
// HYDRAULIC EROSION (after Hans Beyer's particle method): raindrops run downhill with a little
// inertia; each picks up soil while it speeds up and can carry more, and drops it where it slows or
// fills a pit. Carves gullies down the slopes and leaves fans of soil at their feet. FLOW records
// where water ran, SETTLE where soil was laid down.
function erode(H, drops) { const it = erodeSteps(H, drops, drops + 1); while (!it.next().done); }
// the same, a chunk of drops at a time (`chunk` a number, or a function read at each pause);
// `trail` (when given) gets each drop's path as line segments in grid units [x0, y0, h0, x1, y1, h1, ...]
function* erodeSteps(H, drops, chunk, trail = null) {
  const inertia = 0.05, capacityK = 4, minSlope = 0.01, depositK = 0.3, erodeK = SHAPE.erodeStrength, evap = 0.02, gravity = 4, maxSteps = 64, R = 2;
  const brush = []; let bw = 0; for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const d = Math.hypot(di, dj); if (d <= R) { const w = 1 - d / (R + 0.001); brush.push([di, dj, w]); bw += w; } }
  for (const b of brush) b[2] /= bw;
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grad = (x, y) => { const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * N + i;
    const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
    return [(b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u, a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v]; };
  let since = 0;
  for (let n = 0; n < drops; n++) {
    if (++since > (typeof chunk === 'function' ? chunk() : chunk)) { since = 1; yield n; if (trail) trail.length = 0; }
    let x = rnd() * (N - 2), y = rnd() * (N - 2), dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let step = 0; step < maxSteps; step++) {
      const i = x | 0, j = y | 0, u = x - i, v = y - j, k = j * N + i;
      const [gx, gy, h0] = grad(x, y);
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy); if (len < 1e-6) break; dx /= len; dy /= len;
      const px = x, py = y;
      x += dx; y += dy;
      if (x < 1 || y < 1 || x >= N - 2 || y >= N - 2) break;
      if (trail) trail.push(px, py, h0, x, y, h0);
      FLOW[k] += water;
      const h1 = grad(x, y)[2], dh = h1 - h0;
      const cap = Math.max(-dh * speed * water * capacityK, minSlope);
      if (sed > cap || dh > 0) {                                        // lay soil down (uphill: fill the pit)
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositK; sed -= amt;
        H[k] += amt * (1 - u) * (1 - v); H[k + 1] += amt * u * (1 - v); H[k + N] += amt * (1 - u) * v; H[k + N + 1] += amt * u * v;
        SETTLE[k] += amt;
      } else {                                                          // pick soil up, spread over the brush
        const amt = Math.min((cap - sed) * erodeK, -dh);
        for (const [di, dj, w] of brush) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const q = jj * N + ii, take = Math.min(H[q], amt * w); H[q] -= amt * w; sed += amt * w; }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity)); water *= 1 - evap;
    }
  }
}
// WATER, found from the land: the hollows are filled to the level they would spill at (a priority
// flood), which gives every pond and its surface; then each cell's water runs to its lowest
// neighbour on that filled surface and adds up downstream, so rivers are where enough gathers, and
// they run into the ponds and out over the spill. Pond ground is flattened to its surface and river
// channels are carved a little; the shader paints the water on (no see-through mesh).
let trees = [], maskA = null, pathCanvas = null; const MAPS = {};
const WATER = { on: true, river: 1200, width: 0.6, carve: 0.8, channel: 2, pondDepth: 0.35, pondMin: 30, outlet: 5 };
const POND = new Uint8Array(N * N), WDEPTH = new Float32Array(N * N), ACC = new Float32Array(N * N), DOWN = new Int32Array(N * N);
let waterCanvas = null, waterTex = null;          // (the shader's uniforms are made later; they pick waterTex up)
// the priority flood: F is the land with every hollow filled to its spill level, DOWN the cell each
// cell drains to, `order` the cells from lowest to highest on that filled surface
function flood(H) {
  DOWN.fill(-1);
  const F = Float32Array.from(H), done = new Uint8Array(N * N), heap = [];
  const push = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (F[heap[p]] <= F[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && F[heap[l]] < F[heap[m]]) m = l; if (r < heap.length && F[heap[r]] < F[heap[m]]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (!done[k]) { done[k] = 1; push(k); }
  const order = [];
  while (heap.length) {
    const c = pop(); order.push(c); const i = c % N, j = (c / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni; if (done[n]) continue; done[n] = 1; F[n] = Math.max(H[n], F[c] + 1e-4); DOWN[n] = c; push(n); }
  }
  return { F, order };
}
// the pools: filled more than pondDepth, in pools of at least pondMin cells
function findPools(H, F) {
  const pools = [], seen = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) if (F[k] - H[k] > WATER.pondDepth && !seen[k]) {
    const pool = [k], st = [k]; seen[k] = 1;
    while (st.length) { const c = st.pop(), i = c % N, j = (c / N) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const n = nj * N + ni; if (!seen[n] && F[n] - H[n] > WATER.pondDepth * 0.3) { seen[n] = 1; st.push(n); pool.push(n); } } }
    if (pool.length >= WATER.pondMin) pools.push(pool);
  }
  return pools;
}
// THE OUTLET WORN DOWN: a lake spills over the lowest point of its rim, and over time the overflow
// wears that notch into a gorge and the lake drops with it. For each pool the spill point is found,
// and a canyon is cut through it: its floor at the spill level less `outlet` (never more than 70% of
// the pool's depth, so ponds shrink but stay), walls rising steeply either side. Inward it follows the
// real ground down into the lake; outward it follows the overflow downhill, its floor falling gently,
// and ends where the land falls away below it by itself.
const OUTLETS = [];
function carveOutlets(H, F, pools) {
  OUTLETS.length = 0;
  const R = 6, wall = 1.2, fall = 0.03, bed = 2.2;          // bed: the flat floor's half-width in cells (~14 m across), wide enough for the river
  const cut = (c, floor, r) => { const i = c % N, j = (c / N) | 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const q = jj * N + ii, h = floor + Math.max(0, Math.hypot(di, dj) - bed) * TEX * wall; if (H[q] > h) H[q] = h; } };
  const step = (a, b) => ((a % N) !== (b % N) && ((a / N) | 0) !== ((b / N) | 0) ? 1.414 : 1) * TEX;
  for (const pool of pools) {
    let S = -Infinity, low = pool[0];
    for (const c of pool) { if (F[c] > S) S = F[c]; if (H[c] < H[low]) low = c; }
    const level = S - Math.min(WATER.outlet, (S - H[low]) * 0.7);
    let rim = low; while (rim >= 0 && F[rim] - H[rim] >= 0.01) rim = DOWN[rim];   // the spill point on the rim
    if (rim < 0) continue;
    { let d = rim; for (let n = 0; n < 12 && DOWN[d] >= 0; n++) d = DOWN[d]; OUTLETS.push([rim, d, pool.length]); }   // (for the test rigs: where each outlet is)
    // the gorge's head: from the rim into the lake, the path that needs the least digging to reach
    // below the new water line (a cheapest-path search over the lake bed), so it bends with the land
    // and always gets through; cut to the new level
    const cost = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), heap = [];
    const hpush = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (cost[heap[p]] <= cost[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l; if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    cost[rim] = 0; hpush(rim); let end = -1;
    while (heap.length) {
      const c = hpop(); if (c !== rim && H[c] <= level) { end = c; break; }
      const i = c % N, j = (c / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if ((!di && !dj) || ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const q = jj * N + ii; if (F[q] - H[q] < 0.01) continue;                // stay in the lake
        const w = cost[c] + (Math.max(0, H[q] - level) + 0.5) * (di && dj ? 1.414 : 1);
        if (w < cost[q]) { cost[q] = w; from[q] = c; hpush(q); } }
    }
    for (let c = end; c >= 0; c = from[c]) cut(c, level, 3);
    // the gorge: from the rim along the overflow's path downhill, until the land falls away below it
    for (let c = rim, s = 0, past = 0; c >= 0 && past < 12; ) {
      const floor = level - s * fall; past = H[c] <= floor ? past + 1 : 0;
      cut(c, floor, R); const d = DOWN[c]; if (d >= 0) s += step(c, d); c = d;
    }
  }
}
// RAVINES: where water gathers it cuts down, more where more of it gathers and the slope is steeper
// (the stream-power rule of landscape models). It runs on a coarser grid than the land
// (`ravineScale` cells to one), so the water gathers into a few big drainages instead of a ravine in
// every dip: big hills with wide gullies between. Each pass cuts, spreads the cut to the cells beside
// it (V-shaped, not slots), then eases the slopes a little (`ravineRound`: soil creeping downhill,
// which rounds the hilltops and softens the valley sides). The change is scaled back up and added to
// the fine land, so its small detail stays. `ravines` passes, `ravineStrength` how hard they cut.
function floodGrid(H, M) {                                   // the priority flood on an M x M grid
  const F = Float32Array.from(H), done = new Uint8Array(M * M), down = new Int32Array(M * M).fill(-1), heap = [], order = [];
  const push = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (F[heap[p]] <= F[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && F[heap[l]] < F[heap[m]]) m = l; if (r < heap.length && F[heap[r]] < F[heap[m]]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (let i = 0; i < M; i++) for (const k of [i, (M - 1) * M + i, i * M, i * M + M - 1]) if (!done[k]) { done[k] = 1; push(k); }
  while (heap.length) {
    const c = pop(); order.push(c); const i = c % M, j = (c / M) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= M || nj >= M) continue;
      const n = nj * M + ni; if (done[n]) continue; done[n] = 1; F[n] = Math.max(H[n], F[c] + 1e-4); down[n] = c; push(n); }
  }
  return { order, down };
}
function blurGrid(src, M, r) {                              // a box blur each way, on an M x M grid
  const tmp = new Float32Array(M * M), out = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < M) { s += src[j * M + ii]; n++; } } tmp[j * M + i] = s / n; }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < M) { s += tmp[jj * M + i]; n++; } } out[j * M + i] = s / n; }
  return out;
}
function cutRavines(H) {
  if (!SHAPE.ravines) return;
  const C = SHAPE.ravineScale, M = N / C, cell = TEX * C, Hc = new Float32Array(M * M);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Hc[((j / C) | 0) * M + ((i / C) | 0)] += H[j * N + i] / (C * C);
  const H0 = Float32Array.from(Hc), full = 240000 / (cell * cell);              // a stream cuts at full force once it drains ~24 hectares (in cells)
  for (let pass = 0; pass < SHAPE.ravines; pass++) {
    const { order, down } = floodGrid(Hc, M), acc = new Float32Array(M * M).fill(1), cut = new Float32Array(M * M);
    for (let q = order.length - 1; q >= 0; q--) { const c = order[q]; if (down[c] >= 0) acc[down[c]] += acc[c]; }
    for (let k = 0; k < M * M; k++) {
      const d = down[k]; if (d < 0 || acc[k] < 3) continue;
      const drop = Hc[k] - Hc[d]; if (drop <= 0) continue;
      const run = ((d % M) !== (k % M) && ((d / M) | 0) !== ((k / M) | 0) ? 1.414 : 1) * cell;
      cut[k] = Math.min(drop * 0.9, SHAPE.ravineStrength * 1.5 * Math.min(2, Math.sqrt(acc[k] / full)) * Math.min(1.2, drop / run));
    }
    const side = blurGrid(cut, M, 1);
    for (let k = 0; k < M * M; k++) Hc[k] -= Math.max(cut[k], side[k] * 1.4);
    if (SHAPE.ravineRound > 0) { const avg = blurGrid(Hc, M, 1); for (let k = 0; k < M * M; k++) Hc[k] += (avg[k] - Hc[k]) * SHAPE.ravineRound * 0.5; }
  }
  // back up to the fine grid: the change, spread smoothly between the coarse cells' middles
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = Math.min(M - 1.001, Math.max(0, (i + 0.5) / C - 0.5)), v = Math.min(M - 1.001, Math.max(0, (j + 0.5) / C - 0.5)), a = u | 0, b = v | 0, fu = u - a, fv = v - b, q = b * M + a;
    const d = ((Hc[q] - H0[q]) * (1 - fu) + (Hc[q + 1] - H0[q + 1]) * fu) * (1 - fv) + ((Hc[q + M] - H0[q + M]) * (1 - fu) + (Hc[q + M + 1] - H0[q + M + 1]) * fu) * fv;
    H[j * N + i] += d;
  }
}
function findWater(H) {
  WDEPTH.fill(0); ACC.fill(0);
  let { F, order } = flood(H);
  if (WATER.outlet > 0) { carveOutlets(H, F, findPools(H, F)); ({ F, order } = flood(H)); }
  // flow: from the highest cell down, each gives what it has gathered to the cell it drains to
  for (let q = 0; q < N * N; q++) ACC[q] = 1;
  for (let q = order.length - 1; q >= 0; q--) { const c = order[q]; if (DOWN[c] >= 0) ACC[DOWN[c]] += ACC[c]; }
  // ponds: the pools, as a mask
  const pond = new Uint8Array(N * N);
  for (const pool of findPools(H, F)) for (const c of pool) pond[c] = 1;
  POND.set(pond);
  for (let k = 0; k < N * N; k++) if (pond[k]) { WDEPTH[k] = F[k] - H[k]; H[k] = F[k]; }       // the pond's ground is its surface
  // rivers: channels carved where enough water gathers (not in the ponds). The river's cells are
  // blurred into a rounded trough `channel` cells to each side, deepest in the middle, and that is
  // carved: one smooth channel, not a 3 m staircase of notches that the water would lie in jaggedly
  const chan = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) if (!pond[k] && ACC[k] > WATER.river) { const t = Math.min(1, Math.log(ACC[k] / WATER.river) / 3); chan[k] = 0.5 + t; WDEPTH[k] = 0.3 + 0.5 * t; }
  const r = WATER.channel, trough = r > 0 ? blur(chan, r) : chan, gain = (2 * r + 1) * 0.8;   // the blur spreads a line 2r+1 cells wide; gain brings its middle back to full depth
  for (let k = 0; k < N * N; k++) if (!pond[k] && trough[k] > 0) H[k] -= WATER.carve * Math.min(1.5, trough[k] * gain);
  paintWater(pond);
}
// the water picture, 0.8 m a pixel: ponds as their cells, rivers as lines from each cell to the one it
// drains to, wider as more water gathers; R = water, G = depth, B = froth (where a river falls steeply)
function paintWater(pond) {
  const P = 2048, k = P / SIZE; waterCanvas = waterCanvas || document.createElement('canvas'); waterCanvas.width = waterCanvas.height = P;
  const g = waterCanvas.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, P, P);
  if (WATER.on) {
    const px = (i) => (i + 0.5) * TEX * k;
    for (let q = 0; q < N * N; q++) if (pond[q]) { const d = Math.min(1, WDEPTH[q] / 4); g.fillStyle = `rgb(255,${Math.round(80 + 175 * d)},0)`; g.fillRect(px(q % N) - TEX * k * 0.65, px((q / N) | 0) - TEX * k * 0.65, TEX * k * 1.3, TEX * k * 1.3); }
    g.lineCap = 'round';
    for (let q = 0; q < N * N; q++) {
      if (pond[q] || ACC[q] <= WATER.river || DOWN[q] < 0) continue;
      const t = Math.min(1, Math.log(ACC[q] / WATER.river) / 3), d = DOWN[q];
      const drop = (Hg[q] - Hg[d]) / (((d % N) !== (q % N) && ((d / N) | 0) !== ((q / N) | 0) ? 1.414 : 1) * TEX);   // how steeply this stretch falls
      const froth = Math.min(1, Math.max(0, (drop - 0.25) / 0.5));                                          // white water from about 14°, all froth by 37°
      g.strokeStyle = `rgb(255,${Math.round(60 + 60 * t)},${Math.round(255 * froth)})`; g.lineWidth = (1.2 + 4.5 * t) * WATER.width * k;
      g.beginPath(); g.moveTo(px(q % N), px((q / N) | 0)); g.lineTo(px(d % N), px((d / N) | 0)); g.stroke();
    }
    // softened once, the whole picture (a blur per shape was far too slow)
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = P; const t2 = tmp.getContext('2d'); t2.filter = 'blur(1.5px)'; t2.drawImage(waterCanvas, 0, 0); g.clearRect(0, 0, P, P); g.drawImage(tmp, 0, 0);
  }
  if (!waterTex) { waterTex = new THREE.CanvasTexture(waterCanvas); waterTex.flipY = false; waterTex.minFilter = THREE.LinearMipmapLinearFilter; }
  waterTex.needsUpdate = true;
  MAPS.water = g.getImageData(0, 0, P, P).data; MAPS.WP = P;
}
const waterAt = (x, z) => { if (!MAPS.water) return 0; const P = MAPS.WP, i = Math.min(P - 1, Math.max(0, Math.floor((x + SIZE / 2) / SIZE * P))), j = Math.min(P - 1, Math.max(0, Math.floor((z + SIZE / 2) / SIZE * P))); return MAPS.water[(j * P + i) * 4] / 255; };
// the land before erosion: the noise, then the terraces (the slope read over ~12 m, so the noise's
// small wobbles don't count as steep)
function baseGrid() {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Hg[j * N + i] = baseHeight(cellX(i), cellX(j));
  if (!SHAPE.terraceOn) return;
  const B = Float32Array.from(Hg), at = (i, j) => B[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const sl = Math.hypot(at(i + 2, j) - at(i - 2, j), at(i, j + 2) - at(i, j - 2)) / (4 * TEX); Hg[j * N + i] = terrace(B[j * N + i], cellX(i), cellX(j), sl); }
}
// the raindrops dig a small round pit wherever they speed up, which on a steep face reads as a rash;
// what they did is softened (over `erodeSmooth` cells) so the grooves they wore stay and the pits go
function smoothErosion(before) {
  if (!SHAPE.erodeSmooth) return;
  const d = new Float32Array(N * N); for (let k = 0; k < N * N; k++) d[k] = Hg[k] - before[k];
  const soft = blur(d, SHAPE.erodeSmooth); for (let k = 0; k < N * N; k++) Hg[k] = before[k] + soft[k];
}
// CRAGS: jagged rock up high. Only above the treeline and on steep ground: knife-edge ribs with narrow
// chutes between, running down the fall line the way they do on real rock faces. `crags` how tall (m),
// `cragSize` how far apart the ribs are (m). Added after the ravines, so the rounding doesn't soften it.
// How: a loose lattice of points over the land; each takes the downhill direction where it stands and
// draws a patch of ribs lined up with it, measured FROM ITSELF (its own offset, its own random phase), and
// neighbouring patches blend smoothly. (Measuring along the downhill direction from the map's origin, as
// this first did, is really measuring distance from each summit, which drew rings round every peak.)
function addCrags(H) {
  if (!SHAPE.crags) return;
  const B = blur(H, 4), S = THREE.MathUtils.smoothstep, at = (i, j) => B[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const L = SHAPE.cragSize * 0.9, f = 2 * Math.PI / SHAPE.cragSize;              // lattice spacing (m); ribs a cragSize apart
  // SHARPNESS (cragSharp 0..1): the ribs' profile goes from rounded to knife-edged, and finer broken crests ride on them;
  // `mean` is the pattern's average height, taken off so sharpening doesn't raise or sink the rock as a whole
  const pw = 0.9 + SHAPE.cragSharp * 3.5, jagK = SHAPE.cragSharp * 0.45;
  let mean = 0; for (let q = 0; q < 256; q++) { const t = (q + 0.5) / 256 * Math.PI; mean += Math.pow(1 - Math.abs(Math.cos(t)), pw) * 0.75; } mean = mean / 256 + jagK * 0.045;
  const latDir = new Map();                                                      // a lattice point's downhill direction, worked out once
  const dirAt = (a, b) => { const key = a * 100003 + b; let d = latDir.get(key);
    if (!d) { const x = a * L, z = b * L, i = Math.round((x + SIZE / 2) / TEX - 0.5), j = Math.round((z + SIZE / 2) / TEX - 0.5);
      const gx = at(i + 3, j) - at(i - 3, j), gz = at(i, j + 3) - at(i, j - 3), l = Math.hypot(gx, gz) || 1; d = [gx / l, gz / l, hash(a * 1.37, b * 2.11) * 6.283, 0.75 + 0.5 * hash(b * 3.1, a * 0.7)]; latDir.set(key, d); }
    return d; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, gx = (at(i + 2, j) - at(i - 2, j)) / (4 * TEX), gz = (at(i, j + 2) - at(i, j - 2)) / (4 * TEX), sl = Math.hypot(gx, gz);
    const where = S(H[k], LAND.treeline - 40, LAND.treeline + 60) * S(sl, 0.45, 0.9);
    if (where <= 0) continue;
    const x = cellX(i), z = cellX(j), la = Math.floor(x / L), lb = Math.floor(z / L);
    let sum = 0, wsum = 0;
    for (let b = lb - 1; b <= lb + 2; b++) for (let a = la - 1; a <= la + 2; a++) {
      const cx = a * L, cz = b * L, dd = Math.hypot(x - cx, z - cz) / (L * 1.5); if (dd >= 1) continue;
      const w = (1 - dd * dd) ** 2, [dx, dz, ph, len] = dirAt(a, b);
      const across = (x - cx) * -dz + (z - cz) * dx, down = (x - cx) * dx + (z - cz) * dz;   // from this point: across the slope, and down it
      const rib = 1 - Math.abs(Math.cos(across * f + ph + Math.sin(down * f * 0.25) * 0.6));   // crests, the odd kink down the fall line
      // jag: finer, broken crests riding on the ribs (their own, slanting a little across the fall line)
      const jag = Math.pow(1 - Math.abs(Math.cos(across * f * 2.7 + down * f * 0.9 + ph * 1.7)), 3) * (0.5 + 0.5 * Math.sin(down * f * 1.3 + ph * 2.3));
      sum += (Math.pow(rib, pw) * (0.75 + 0.25 * Math.sin(down * f * 0.35 * len + ph)) + jagK * jag) * w; wsum += w;
    }
    if (wsum > 0) H[k] += SHAPE.crags * where * (sum / wsum - mean);
  }
}
function buildHeights() {
  FLOW.fill(0); SETTLE.fill(0);
  baseGrid();
  if (SHAPE.erodeOn) { const before = Float32Array.from(Hg); erode(Hg, SHAPE.drops); smoothErosion(before); }
  cutRavines(Hg); addCrags(Hg);
  findWater(Hg);
}
function heightAt(x, z) {
  const fx = Math.min(N - 1.001, Math.max(0, (x + SIZE / 2) / TEX - 0.5)), fz = Math.min(N - 1.001, Math.max(0, (z + SIZE / 2) / TEX - 0.5));
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * N + i;
  return (Hg[k] * (1 - u) + Hg[k + 1] * u) * (1 - v) + (Hg[k + N] * (1 - u) + Hg[k + N + 1] * u) * v;
}
buildHeights();
const geo = new THREE.PlaneGeometry(SIZE - TEX, SIZE - TEX, SEG, SEG); geo.rotateX(-Math.PI / 2);   // a vertex on each cell's middle
function shapeMesh() { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i))); p.needsUpdate = true; geo.computeVertexNormals(); }
shapeMesh();

// ── THE LAND'S OWN MAPS ─────────────────────────────────────────────────────────
// Worked out once from the terrain, the way terrain tools do it, instead of from random noise:
//   wet     - hollows lower than the ground round them (where water would sit)
//   dry     - rises and ridges (drained, out in the wind and sun)
//   canopy  - under the trees, which grow in clumps away from the wet and the steep
//   shade   - the band of part shade round each clump
//   paths   - routes found across the land that prefer gentle, dry ground, drawn as worn strips
// Stored in two textures the shader reads; noise only roughens their edges.
function blur(src, r) {                             // two passes of a box blur, each way: close to a Gaussian
  let a = src.slice(), b = new Float32Array(N * N);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < N; j++) { let acc = 0; for (let i = -r; i <= r; i++) acc += a[j * N + Math.min(N - 1, Math.max(0, i))];
      for (let i = 0; i < N; i++) { b[j * N + i] = acc / (2 * r + 1); acc += a[j * N + Math.min(N - 1, i + r + 1)] - a[j * N + Math.max(0, i - r)]; } }
    for (let i = 0; i < N; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += b[Math.min(N - 1, Math.max(0, j)) * N + i];
      for (let j = 0; j < N; j++) { a[j * N + i] = acc / (2 * r + 1); acc += b[Math.min(N - 1, j + r + 1) * N + i] - b[Math.max(0, j - r) * N + i]; } }
  }
  return a;
}
let Hb = null;                                        // the ground's height averaged over about 40 m (per buildLand)
const slopeAt = (i, j) => { const a = Hg[j * N + Math.min(N - 1, i + 1)] - Hg[j * N + Math.max(0, i - 1)], b = Hg[Math.min(N - 1, j + 1) * N + i] - Hg[Math.max(0, j - 1) * N + i]; return Math.hypot(a, b) / (2 * TEX); };
// LIGHT AND SHADE, worked out once from the height grid (so it costs one texture read a frame, on
// every tier): R, where the sun reaches (a ray from each cell toward the sun, over the land, soft at
// the edge); G, how open each spot is to the sky (the horizon looked for in 8 directions: gullies,
// ravines and hollows come out low); B, the shade the trees throw (the canopy, moved away from the sun)
let shadeTex = null;
function bakeShade(canopy, wide) {
  const S = SUN_DIR, flat = Math.hypot(S.x, S.z), dx = S.x / flat, dz = S.z / flat, rise = S.y / flat * TEX;   // per cell toward the sun
  const out = new Uint8Array(N * N * 4), H = Hg;
  const hAt = (x, z) => { const i = Math.min(N - 1, Math.max(0, x | 0)), j = Math.min(N - 1, Math.max(0, z | 0)); return H[j * N + i]; };
  const dirs = Array.from({ length: 8 }, (_, a) => [Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]), reach = [1, 2, 4, 7, 12, 20, 32];
  const tree = Math.max(2, Math.round(20 / S.y * flat / TEX));      // a ~20 m tree's shadow reaches this many cells away from the sun; was a ~9 m tree's shadow falls this many cells away from the sun
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h0 = H[k] + 0.5;
    let vis = 1;
    for (let t = 1, step = 1; t < 260; t += step, step = Math.min(8, step + (t > 16 ? 1 : 0))) {
      const x = i + dx * t, z = j + dz * t; if (x < 0 || z < 0 || x >= N || z >= N) break;
      const above = h0 + rise * t - hAt(x, z), pen = 1 + t * TEX * 0.04;            // soft edge, wider further off
      vis = Math.min(vis, Math.max(0, Math.min(1, above / pen * 0.5 + 0.5))); if (vis <= 0) break;
    }
    let open = 0;
    for (const [ax, az] of dirs) { let m = 0; for (const r of reach) { const e = (hAt(i + ax * r, j + az * r) - h0) / (r * TEX); if (e > m) m = e; } open += m / Math.sqrt(1 + m * m); }   // sin of the horizon's angle
    // the trees' shade: the canopy looked for toward the sun, all along a shadow's length (so it is a
    // long shadow like the real ones, not a blob beside the tree), a little weaker toward its tip
    let ts = canopy[k] * 0.6;
    for (let t = 1; t <= tree; t++) { const ti = Math.min(N - 1, Math.max(0, Math.round(i + dx * t))), tj = Math.min(N - 1, Math.max(0, Math.round(j + dz * t))); ts = Math.max(ts, canopy[tj * N + ti] * (1 - 0.35 * t / tree)); }
    out[k * 4] = vis * 255; out[k * 4 + 1] = Math.max(0, 1 - open / 8 * 1.6) * 255;
    out[k * 4 + 2] = Math.min(1, ts) * 255; out[k * 4 + 3] = 255;
  }
  if (!shadeTex) { shadeTex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat); shadeTex.magFilter = shadeTex.minFilter = THREE.LinearFilter; shadeTex.generateMipmaps = false; U.shadeMap.value = shadeTex; }
  else shadeTex.image.data.set(out);
  shadeTex.needsUpdate = true;
}
function buildLand() {
  Hb = blur(Hg, 12);
  // wet and dry: how far below or above its surroundings each spot is
  const wet = new Float32Array(N * N), dry = new Float32Array(N * N), steep = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) { const d = Hb[k] - Hg[k]; wet[k] = Math.min(1, Math.max(0, d / LAND.wetDepth)); dry[k] = Math.min(1, Math.max(0, -d / LAND.dryHeight)); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) steep[j * N + i] = THREE.MathUtils.smoothstep(slopeAt(i, j), 0.36, 0.7);   // bare from about 20 deg, fully by 35
  // trees: clumps from slow noise, thinned on wet and steep ground; one candidate every 6 m
  trees = []; const tree = new Float32Array(N * N);
  const clump = (x, z) => { let n = 0, a = 1, f = 1 / 230; for (let o = 0; o < 3; o++) { n += (vnoise(x * f + 40, z * f + 17) - 0.5) * a; a *= 0.5; f *= 2.2; } return n + 0.5; };
  for (let z = -SIZE / 2 + 3; z < SIZE / 2; z += 6) for (let x = -SIZE / 2 + 3; x < SIZE / 2; x += 6) {
    const jx = x + (hash(x, z) - 0.5) * 5, jz = z + (hash(z, x) - 0.5) * 5;
    const i = Math.min(N - 1, Math.max(0, Math.floor((jx + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((jz + SIZE / 2) / TEX))), k = j * N + i;
    // on the hills: groves up the slopes (more of them on a slope than on the flat), none past ~40 deg,
    // thinning out over the last 40 m below the treeline
    const sl = slopeAt(i, j), hill = THREE.MathUtils.smoothstep(sl, 0.15, 0.55) * LAND.hillForest;
    const F = THREE.MathUtils.smoothstep(clump(jx, jz) + hill, 1 - LAND.forest * 0.6, 1.05 - LAND.forest * 0.6) * (1 - wet[k] * 0.9)
      * (1 - THREE.MathUtils.smoothstep(sl, 0.75, 1.0)) * (1 - THREE.MathUtils.smoothstep(Hg[k], LAND.treeline - 40, LAND.treeline));
    // (potato keeps under half of them: treeShare)
    if (waterAt(jx, jz) < 0.05 && hash(jx * 1.3, jz * 0.7) < F * 0.85 * (TS.treeShare || 1)) { trees.push([jx, heightAt(jx, jz), jz, 0.8 + hash(jx, jz * 2) * 0.5]); tree[k] = 1; }
  }
  const canopy = blur(tree, 1), wide = blur(tree, LAND.shadeReach);
  for (let k = 0; k < N * N; k++) canopy[k] = Math.min(1, canopy[k] * 3.2);
  MAPS.wet = wet; MAPS.dry = dry; MAPS.canopy = canopy; MAPS.wide = wide; MAPS.steep = steep;
  // where the water ran (gullies) and where it laid soil down (fans), from the erosion, softened
  const fl = new Float32Array(N * N), se = new Float32Array(N * N);
  for (let q = 0; q < N * N; q++) { fl[q] = Math.min(1, Math.max(0, (Math.log(1 + FLOW[q]) - 2.2) / 2.5)); se[q] = Math.min(1, SETTLE[q] * 4); }
  const gully = blur(fl, 1), fan = blur(se, 2), dataB = new Uint8Array(N * N * 4);
  // the shore: a band of stones round every pond and stream (and under the shallows), `shore` cells wide
  const wetCells = new Float32Array(N * N); for (let q = 0; q < N * N; q++) wetCells[q] = WDEPTH[q] > 0 ? 1 : 0;
  const shore = LAND.shore > 0 ? blur(wetCells, LAND.shore) : wetCells.fill(0); MAPS.shore = shore;
  for (let q = 0; q < N * N; q++) {
    const sh = Math.min(1, Math.max(0, wide[q] * 2.2 - canopy[q] * 0.8)), open = 1 - Math.min(1, canopy[q] + sh);
    const cover = WDEPTH[q] > 0 ? 0 : Math.min(1, (0.55 * open + 1.0 * sh + 0.3 * canopy[q]) * (1 - steep[q]) * (1 - Math.max(0, wet[q] - 0.6) * 2));   // where plants would grow
    dataB[q * 4] = gully[q] * 255; dataB[q * 4 + 1] = Math.min(1, fan[q] * 2) * 255; dataB[q * 4 + 2] = cover * 255; dataB[q * 4 + 3] = Math.min(1, shore[q] * 2.5) * 255;
  }
  if (!U.maskB.value) { const t = new THREE.DataTexture(dataB, N, N, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; U.maskB.value = t; } else U.maskB.value.image.data.set(dataB);
  U.maskB.value.needsUpdate = true;
  bakeShade(canopy, wide);
  // paths: cheapest routes over the grid, where steep, wet and thick forest cost more
  const cost = new Float32Array(N * N); for (let k = 0; k < N * N; k++) cost[k] = 1 + 60 * steep[k] + 8 * wet[k] + 2 * canopy[k] + (POND[k] ? 5000 : WDEPTH[k] > 0 ? 40 : 0);   // round the lakes; over a river only where it must
  const route = (ax, az, bx, bz) => {
    const S = N / 2, cell = (x, z) => [Math.round((x + SIZE / 2) / TEX), Math.round((z + SIZE / 2) / TEX)];
    // each end moved to the nearest dry cell
    const dry = ([i, j]) => { for (let r = 0; r < 80; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const ii = Math.min(N - 1, Math.max(0, i + di)), jj = Math.min(N - 1, Math.max(0, j + dj)); if (!WDEPTH[jj * N + ii]) return [ii, jj]; } return [i, j]; };
    const [si, sj] = dry(cell(ax, az)), [ti, tj] = dry(cell(bx, bz)), g = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), heap = [];
    const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const start = sj * N + si, goal = tj * N + ti; g[start] = 0; push(start, 0);
    while (heap.length) { const [, k] = pop(); if (k === goal) break; const i = k % N, j = (k / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni, step = (di && dj ? 1.414 : 1) * (cost[k] + cost[n]) / 2 + Math.abs(Hg[n] - Hg[k]) * 3, ng = g[k] + step;
        if (ng < g[n]) { g[n] = ng; from[n] = k; push(n, ng + Math.hypot(ni - ti, nj - tj) * 0.9); } } }
    const pts = []; for (let k = goal; k >= 0; k = from[k]) pts.push([(k % N) * TEX - SIZE / 2, ((k / N) | 0) * TEX - SIZE / 2]);
    // smoothed, so it wanders instead of stepping along the grid
    for (let it = 0; it < 6; it++) for (let q = 1; q < pts.length - 1; q++) pts[q] = [(pts[q - 1][0] + 2 * pts[q][0] + pts[q + 1][0]) / 4, (pts[q - 1][1] + 2 * pts[q][1] + pts[q + 1][1]) / 4];
    return pts;
  };
  const paths = [route(-760, -520, 740, 380), route(-560, 760, 520, -760), route(40, -790, -60, 790), route(-790, 120, 30, 20)];
  // the path texture: a worn core and a trampled shoulder, drawn at 0.8 m a pixel
  const P = 2048, k = P / SIZE; pathCanvas = pathCanvas || document.createElement('canvas'); pathCanvas.width = pathCanvas.height = P;
  const g2 = pathCanvas.getContext('2d'); g2.fillStyle = '#000'; g2.fillRect(0, 0, P, P); g2.lineCap = g2.lineJoin = 'round';
  const stroke = (w, colour, blurPx) => { g2.filter = `blur(${blurPx}px)`; g2.strokeStyle = colour; g2.lineWidth = w * k;
    for (const pts of paths) { g2.beginPath(); pts.forEach(([x, z], q) => q ? g2.lineTo((x + SIZE / 2) * k, (z + SIZE / 2) * k) : g2.moveTo((x + SIZE / 2) * k, (z + SIZE / 2) * k)); g2.stroke(); } };
  g2.globalCompositeOperation = 'lighter'; stroke(LAND.pathWidth * 3.2, 'rgb(0,90,0)', 3); stroke(LAND.pathWidth, 'rgb(255,0,0)', 1.2); g2.filter = 'none'; g2.globalCompositeOperation = 'source-over';
  // pack: R wet, G dry, B canopy, A part shade (and steep into the part-shade texture's spare... kept in the shader from the normal)
  const data = new Uint8Array(N * N * 4);
  for (let q = 0; q < N * N; q++) { data[q * 4] = wet[q] * 255; data[q * 4 + 1] = dry[q] * 255; data[q * 4 + 2] = canopy[q] * 255; data[q * 4 + 3] = Math.min(1, Math.max(0, wide[q] * 2.2 - canopy[q] * 0.8)) * 255; }
  if (!maskA) { maskA = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); maskA.magFilter = maskA.minFilter = THREE.LinearFilter; maskA.generateMipmaps = false; }
  else maskA.image.data.set(data);
  maskA.needsUpdate = true;
  if (!U.pathMap.value) { const t = new THREE.CanvasTexture(pathCanvas); t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; U.pathMap.value = t; }
  U.pathMap.value.needsUpdate = true; U.maskA.value = maskA;
  MAPS.path = pathCanvas.getContext('2d').getImageData(0, 0, P, P).data; MAPS.P = P;
  COVER.cache = {};                                   // the land changed: the remembered tiles are stale
  placeTrees(); placeStones(); if (COVER.parts) placeCover();
}

// ── textures ────────────────────────────────────────────────────────────────────
const TEXTURES = ['forest', 'leaves', 'needles', 'moss', 'dirt', 'darkDirt', 'ferns', 'shrubs', 'grassMed', 'grassDry', 'grassDark', 'concrete', 'asphalt', 'pebbles', 'rocks'];
const loader = new THREE.TextureLoader(), cache = {};
// a picture's average colour (potato paints each ground layer in this instead of reading the picture)
function avgColour(img) {
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0; for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; }
  const n = 255 * d.length / 4; return new THREE.Color().setRGB(r / n, gg / n, b / n, THREE.SRGBColorSpace);
}
function setAverages() {
  if (typeof calmCover === 'function') calmCover();
  if (!TS.lite) return;
  for (const [id, a] of [['groundMap', 'avgGround'], ['layDry', 'avgDry'], ['layLush', 'avgLush'], ['layForest', 'avgForest'], ['layWet', 'avgWet'], ['layPath', 'avgPath'], ['laySteep', 'avgSteep'], ['layShore', 'avgShore']]) {
    const t = U[id].value; if (t && t.userData.avg) U[a].value.copy(t.userData.avg); }
}
function tex(name) {
  if (!cache[name]) { const t = loader.load(`/textures/ground/${name}.jpg`, () => { t.userData.avg = avgColour(t.image); setAverages(); }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); cache[name] = t; }
  return cache[name];
}
for (const n of TEXTURES) $('tex').add(new Option(n, n));
$('tex').value = 'grassMed';

// ── the ground material ────────────────────────────────────────────────────────
const U = {
  groundMap: { value: tex('grassMed') }, tile: { value: 24 }, split: { value: 0.5 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) },
  hexOn: { value: 1 }, hexSize: { value: 0.8 }, hexRot: { value: Math.PI }, hexSharp: { value: 7 }, hexBright: { value: 0.6 },
  macroOn: { value: 1 }, macroStr: { value: 0.55 }, macroSize: { value: 60 }, macroHue: { value: 0.5 },
  farOn: { value: 0 }, farFrom: { value: 40 }, grid: { value: 0 },
  // stamps: one object at most in each cell of a world grid, its kind drawn by the weights
  stampOn: { value: 1 }, stampAtlas: { value: null }, stampCell: { value: 0.55 }, stampDensity: { value: 0.55 }, stampSize: { value: 1 },
  stampCum: { value: [0, 0, 0, 0, 0, 0, 0, 0] }, stampBase: { value: [0.13, 0.28, 0.13, 0.16, 0.34, 0.12, 0.26, 0.4] },
  stampHue: { value: 0.35 }, stampShade: { value: 0.45 }, stampFar: { value: 30 },
  // mixing by the land: the masks, the layers' pictures, and how they meet
  mixOn: { value: 1 }, maskA: { value: null }, maskB: { value: null },
  waterMap: { value: waterTex }, waterOn: { value: 1 }, time: { value: 0 }, sunDirW: { value: new THREE.Vector3() }, skyCol: { value: SKY.clone() },
  wDeep: { value: new THREE.Color('#123a4a') }, wShallow: { value: new THREE.Color('#3f7f86') }, wWave: { value: 2.2 }, wSpeed: { value: 0.6 }, wSpec: { value: 0.8 }, wReflect: { value: 0.55 }, wFroth: { value: 1 }, wWaveOn: { value: 1 },
  coverR: { value: 140 }, coverAt: { value: new THREE.Vector3() }, coverMap: { value: null }, coverFar: { value: 1 }, rockFrom: { value: 0.25 },
  gullyStr: { value: 0.65 }, fanStr: { value: 0.35 }, strataStr: { value: 1.5 }, strataSize: { value: 6 }, lushTint: { value: new THREE.Color(0.86, 1.0, 0.8) }, dampTint: { value: new THREE.Color(0.78, 0.92, 0.76) }, pathMap: { value: null }, landSize: { value: SIZE }, view: { value: 0 },
  slopeTint: { value: new THREE.Color(0.5, 0.66, 0.4) },
  shadeMap: { value: null }, shadowRange: { value: 0 }, shadowAt: { value: new THREE.Vector3() }, hillShade: { value: 1 }, aoShade: { value: 0.9 }, treeShade: { value: 0.5 },
  avgGround: { value: new THREE.Color(0x6b8a3a) }, avgDry: { value: new THREE.Color(0x8a8a4a) }, avgLush: { value: new THREE.Color(0x5b7a2a) }, avgForest: { value: new THREE.Color(0x4a4a2a) }, avgWet: { value: new THREE.Color(0x4a3a2a) }, avgPath: { value: new THREE.Color(0x6a5238) }, avgSteep: { value: new THREE.Color(0x7a7a7a) }, avgShore: { value: new THREE.Color(0x77706a) }, shoreStr: { value: 1 }, layShore: { value: null },
  layDry: { value: null }, layLush: { value: null }, layForest: { value: null }, layWet: { value: null }, layPath: { value: null }, laySteep: { value: null },
  mixSharp: { value: 6 }, mixHeight: { value: 1.2 }, mixBreak: { value: 0.35 }, mixBreakSize: { value: 4 }, steepFrom: { value: 0.06 },
};
for (const [k, v] of Object.entries(TS.u)) if (U[k]) U[k].value = v;
{ const t = new THREE.TextureLoader().load('/textures/stamps/atlas.png'); t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); U.stampAtlas.value = t; }
const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
mat.defines = {}; if (GL2) mat.defines.HEX_GRAD = ''; if (TS.lite) mat.defines.LITE = '';        // WebGL 2 can give each turned read its own true gradients (no seams); WebGL 1 lets the blend hide them
mat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, U, sky.uniforms); setTimeout(() => { mat.userData.fs = sh.fragmentShader; });   // (kept for the test rigs)
  sh.vertexShader = 'varying vec3 vW; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
  sh.fragmentShader = SKY_GLSL + `
    uniform sampler2D groundMap; uniform float tile, split; uniform vec2 res;
    uniform float hexOn, hexSize, hexRot, hexSharp, hexBright, macroOn, macroStr, macroSize, macroHue, farOn, farFrom, grid;
    uniform float stampOn, stampCell, stampDensity, stampSize, stampHue, stampShade, stampFar; uniform float stampCum[8]; uniform float stampBase[8]; uniform sampler2D stampAtlas;
    uniform float mixOn, landSize, view, mixSharp, mixHeight, mixBreak, mixBreakSize, steepFrom; uniform sampler2D maskA; uniform sampler2D maskB; uniform float gullyStr, fanStr, strataStr, strataSize, coverR, coverFar, rockFrom; uniform vec3 coverAt; uniform sampler2D coverMap; uniform vec3 lushTint, dampTint, slopeTint;
    uniform sampler2D waterMap; uniform float waterOn, wFroth, time, wWave, wSpeed, wSpec, wReflect, wWaveOn; uniform vec3 sunDirW, skyCol, wDeep, wShallow;
    float gWater = 0.0, gFoam = 0.0, gLit = 1.0, gShadowFade = 0.0; vec3 gWaterN = vec3(0.0, 1.0, 0.0); uniform sampler2D pathMap; uniform sampler2D shadeMap; uniform float hillShade, aoShade, treeShade, shadowRange; uniform vec3 shadowAt;
    uniform vec3 avgGround, avgDry, avgLush, avgForest, avgWet, avgPath, avgSteep, avgShore; uniform float shoreStr; uniform sampler2D layShore; uniform sampler2D layDry; uniform sampler2D layLush; uniform sampler2D layForest; uniform sampler2D layWet; uniform sampler2D layPath; uniform sampler2D laySteep;
    varying vec3 vWN;
    varying vec3 vW;
    float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
    #ifdef LITE
    float fbm(vec2 p) { return 0.06 + 0.88 * vn(p); }   // one read, about the same spread
    #else
    float fbm(vec2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.1 + 3.3) + 0.0625 * vn(p * 8.3 + 1.7); }
    #endif
    vec3 readAt(vec2 uv, vec2 dx, vec2 dy) {
    #ifdef HEX_GRAD
      return textureGrad(groundMap, uv, dx, dy).rgb;
    #else
      return texture2D(groundMap, uv).rgb;
    #endif
    }
    // one grid vertex's read: its own random turn and shift of the texture
    vec3 vertexRead(vec2 id, vec2 uv, vec2 dx, vec2 dy) {
      vec2 r = h2(id); float a = (r.x - 0.5) * 2.0 * hexRot; float c = cos(a), s = sin(a); mat2 R = mat2(c, -s, s, c);
      return readAt(R * uv + r * 17.0, R * dx, R * dy);
    }
    // a colour turned round the grey axis (YIQ), for leaves that come out redder, yellower or greener
    vec3 hueTurn(vec3 c, float a) {
      float Y = dot(c, vec3(0.299, 0.587, 0.114)), I = dot(c, vec3(0.596, -0.274, -0.322)), Qc = dot(c, vec3(0.211, -0.523, 0.312));
      float cs = cos(a), sn = sin(a); float I2 = I * cs - Qc * sn, Q2 = I * sn + Qc * cs;
      return vec3(Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2);
    }
    vec4 stampRead(vec2 uv, vec2 dx, vec2 dy) {
    #ifdef HEX_GRAD
      return textureGrad(stampAtlas, uv, dx, dy);
    #else
      return texture2D(stampAtlas, uv);
    #endif
    }
    // THE STAMPS: the four cells round this point each may hold one object; it is placed, turned,
    // sized and tinted from the cell's own random numbers, and laid over the ground with a soft
    // shadow a little down-light of it. The atlas is 8 x 8: a row is a kind.
    vec3 stamps(vec3 g, vec2 w) {
      vec2 dW = dFdx(w), dWy = dFdy(w);
      vec2 c0 = floor(w / stampCell - 0.5);
      vec3 col = g; float shade = 0.0;
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec2 id = c0 + vec2(float(i), float(j));
        vec2 r = h2(id * 1.37 + 5.1), r2 = h2(id * 2.71 + 9.3);
        if (r.x > stampDensity) continue;
        float pick = r.y, kind = 7.0;
        for (int k = 7; k >= 0; k--) if (pick < stampCum[k]) kind = float(k);
        float size = 0.0; for (int k = 0; k < 8; k++) if (float(k) == kind) size = stampBase[k];
        size *= stampSize * (0.7 + 0.6 * r2.x);
        size = min(size, stampCell * 1.9);
        vec2 centre = (id + 0.5 + (h2(id + 3.3) - 0.5) * 0.9) * stampCell;
        float a = r2.y * 6.2831853, cs = cos(a), sn = sin(a); mat2 R = mat2(cs, -sn, sn, cs);
        vec2 p = R * (w - centre) / size;                                     // -0.5..0.5 inside the object's square
        float sprite = floor(h1(id * 4.13 + 1.7) * 8.0);
        vec2 cell = vec2(sprite, 7.0 - kind);
        vec2 uv = (cell + vec2(p.x + 0.5, 0.5 - p.y)) / 8.0;
        vec2 inside = step(abs(p), vec2(0.5));
        vec2 ddx = R * dW / size / 8.0 * vec2(1.0, -1.0), ddy = R * dWy / size / 8.0 * vec2(1.0, -1.0);
        vec4 s = stampRead(uv, ddx, ddy) * inside.x * inside.y;
        // the shadow: the same shape a little way down-light, darkening the ground under it
        vec2 ps = R * (w - centre + vec2(0.035, 0.03) * size / 0.2) / size, us = (cell + vec2(ps.x + 0.5, 0.5 - ps.y)) / 8.0;
        vec2 ins = step(abs(ps), vec2(0.5));
        shade = max(shade, stampRead(us, ddx, ddy).a * ins.x * ins.y);
        // premultiplied: tint and turn only what is there
        vec3 rgb = s.rgb;
        if (kind < 0.5 || kind > 3.5) rgb = max(hueTurn(rgb, (h1(id * 7.7) - 0.5) * 2.0 * stampHue), 0.0);   // leaves, moss, plants: vary the hue
        rgb *= 0.8 + 0.4 * h1(id * 3.9);
        col = col * (1.0 - s.a) + rgb;
      }
      return mix(col, col * (1.0 - stampShade), shade * (1.0 - 0.0));
    }
    // a layer's picture, read twice at two scales so its own repeat is softened
    #ifdef LITE
    vec3 lay(sampler2D t, vec2 uv, vec2 off) { return texture2D(t, uv + off).rgb; }
    #else
    vec3 lay(sampler2D t, vec2 uv, vec2 off) { return mix(texture2D(t, uv + off).rgb, texture2D(t, uv * 0.31 + off * 1.7).rgb, 0.35); }
    #endif
    // TRIPLANAR: on a steep face a texture laid from above is smeared down it; this reads it from the
    // side as well (along x and along z) and blends by which way the ground faces
    vec3 lay3(sampler2D t, vec3 p, vec3 n, float scale) {
      vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
    #ifdef LITE
      return texture2D(t, (w.y > 0.5 ? p.xz : w.x > w.z ? p.zy : p.xy) / scale).rgb;   // the one side the face mostly looks along
    #else
      return texture2D(t, p.zy / scale).rgb * w.x + texture2D(t, p.xz / scale).rgb * w.y + texture2D(t, p.xy / scale).rgb * w.z;
    #endif
    }
    // HEIGHT BLENDING: b comes in where its weight says, but its brighter (taller) parts arrive first
    // and a's brighter parts hold out longest, so the edge follows the pictures instead of fading
    vec3 over(vec3 a, vec3 b, float w) {
      float lift = (dot(b, vec3(0.333)) - dot(a, vec3(0.333))) * mixHeight;
      return mix(a, b, clamp((w - 0.5) * mixSharp + 0.5 + lift * mixSharp * 0.5, 0.0, 1.0) * step(0.001, w));
    }
    vec3 hexTile(vec2 uv) {
      vec2 dx = dFdx(uv), dy = dFdy(uv);
      // the triangle grid, skewed so it is equilateral; w: the three barycentric weights
      vec2 st = uv / hexSize * 3.4641016;
      vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
      vec2 base = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
      float sg = step(0.0, -t.z), s2 = 2.0 * sg - 1.0;
      vec3 w = vec3(-t.z * s2, sg - t.y * s2, sg - t.x * s2);
      vec2 v1 = base + vec2(sg, sg), v2 = base + vec2(sg, 1.0 - sg), v3 = base + vec2(1.0 - sg, sg);
      vec3 c1 = vertexRead(v1, uv, dx, dy), c2 = vertexRead(v2, uv, dx, dy), c3 = vertexRead(v3, uv, dx, dy);
      vec3 L = vec3(0.299, 0.587, 0.114), D = mix(vec3(1.0), vec3(dot(c1, L), dot(c2, L), dot(c3, L)), hexBright);
      vec3 W = D * pow(max(w, vec3(0.0)), vec3(hexSharp)); W /= (W.x + W.y + W.z + 1e-5);
      return c1 * W.x + c2 * W.y + c3 * W.z;
    }
  ` + sh.fragmentShader.replace('#include <map_fragment>', `
    vec2 uv = vW.xz / tile;
    bool plain = gl_FragCoord.x < split * res.x;
    vec3 g;
    #ifdef LITE
    g = avgGround * (0.9 + 0.2 * vn(vW.xz / 5.0));                       // flat colour, a little mottled
    #else
    if (plain || hexOn < 0.5) g = texture2D(groundMap, uv).rgb; else g = hexTile(uv);
    #endif
    if (!plain && mixOn > 0.5) {
      // the land's maps here, each edge roughened by a little noise
      vec2 luv = vW.xz / landSize + 0.5;
      vec4 m = texture2D(maskA, luv); vec2 pth = texture2D(pathMap, luv).rg; vec4 er = texture2D(maskB, luv); float wAt = texture2D(waterMap, luv).r;
      float bn = (fbm(vW.xz / mixBreakSize) - 0.5) * mixBreak, bn2 = (fbm(vW.xz / (mixBreakSize * 3.1) + 13.0) - 0.5) * mixBreak;
      float steep = smoothstep(steepFrom, steepFrom + 0.12, 1.0 - vWN.y + (fbm(vW.xz / 6.0) - 0.5) * 0.08);   // patchy toward its edge
      float wWet = clamp(m.r * 1.5 + bn, 0.0, 1.0), wMud = clamp(m.r * 2.2 - 1.3 + bn, 0.0, 1.0), wDry = clamp(m.g * 1.3 - 0.15 - m.b - m.a * 0.6 + bn2, 0.0, 1.0);
      float wLush = clamp(m.a * 1.4 + bn, 0.0, 1.0), wForest = clamp(m.b * 1.3 + bn2 * 0.7, 0.0, 1.0);
      float dryLand = 1.0 - smoothstep(0.25, 0.45, wAt);                      // never paint path over water
      float wPath = clamp(pth.r + bn * 0.5, 0.0, 1.0) * dryLand, wShoulder = clamp(pth.g * 1.5 + bn, 0.0, 1.0) * dryLand;
      #ifdef LITE
      vec3 dryC = avgDry, lushC = avgLush, forC = avgForest, wetC = avgWet, pathC = avgPath, shoreC = avgShore;
      #else
      vec3 dryC = lay(layDry, uv, vec2(0.13, 0.71)), lushC = lay(layLush, uv, vec2(0.61, 0.27)), forC = lay(layForest, uv * 1.3, vec2(0.37, 0.93));
      vec3 wetC = lay(layWet, uv, vec2(0.83, 0.41)), pathC = lay(layPath, uv * 1.6, vec2(0.29, 0.17)), shoreC = lay(layShore, uv * 3.0, vec2(0.53, 0.07));
      #endif
      // the rock of a steep face: read from the side, in horizontal strata (bands of lighter and
      // darker, warmer and greyer layers that wander a little), darker in the overhanging parts
      #ifdef LITE
      vec3 steepC = avgSteep;
      #else
      vec3 steepC = lay3(laySteep, vW, normalize(vWN), tile * 0.8);
      #endif
      float band = vW.y / strataSize + (fbm(vW.xz / 30.0) - 0.5) * 2.5;
      float layer = fbm(vec2(band * 1.7, 3.1)), fine = vn(vec2(band * 9.0, 1.3));
      steepC *= mix(vec3(1.0), mix(vec3(0.78, 0.74, 0.7), vec3(1.12, 1.05, 0.95), layer) * (0.85 + 0.3 * fine), strataStr);
      g = over(g, dryC, wDry);
      g = over(g, lushC * lushTint, wLush);                                  // the ordinary grass, tinted deeper: one multiply, no extra texture
      g = over(g, lushC * dampTint, wWet);                                   // damp: heavier grass round a hollow
      g = over(g, wetC, wMud * 0.85);                                        // mud only in the deepest middle
      g = over(g, lushC * lushTint, clamp(er.g * fanStr - 0.2 + bn, 0.0, 1.0) * (1.0 - m.b));   // fans of settled soil: heavier grass
      g = over(g, forC, wForest);
      g = over(g, pathC, clamp(er.r * gullyStr + bn * 0.6, 0.0, 1.0) * (1.0 - wForest * 0.6));       // gullies: worn dirt where the water ran
      g = over(g, mix(g, pathC, 0.5), wShoulder * (1.0 - wForest * 0.5));     // trampled edge: half-worn
      g = over(g, pathC, wPath);
      g = over(g, shoreC, clamp(er.a * shoreStr + bn * 0.8, 0.0, 1.0) * (1.0 - smoothstep(0.3, 0.6, 1.0 - vWN.y)));   // stones round the water's edge
      vec3 scrubC = mix(lushC * slopeTint, pathC * vec3(0.95, 0.9, 0.85), smoothstep(0.62, 0.8, vn(vW.xz / 7.0)) * 0.8);   // slopes: dark green scrub, bare dirt showing in patches
      g = over(g, scrubC, steep);
      float rock = smoothstep(rockFrom, rockFrom + 0.1, 1.0 - vWN.y + (fbm(vW.xz / 9.0) - 0.5) * 0.1);
      g = over(g, steepC, rock);                                                 // cliffs: rock in strata
      // FAR COVER: past where the real plants stop, the ground carries clumps and specks where they
      // would grow (from the same map), so the plants thin into it instead of ending at a line
      float far = smoothstep(coverR * 0.7, coverR * 1.05, length(vW.xz - coverAt.xz));
      if (far > 0.001 && coverFar > 0.5) {
        float clump = fbm(vW.xz / 7.0), speck = vn(vW.xz / 0.9) * 0.6 + vn(vW.xz / 0.35 + 7.0) * 0.4;
        // what grows there (the cover map: the winning patch kind's colour, the lawn's on bare ground, alpha how
        // thick), in clumps and specks, so the far ground carries on the near plants' patches
        vec4 cv = texture2D(coverMap, luv);
        // seen from afar a thick meadow is its plants' colour with dark gaps between: so the ground there takes
        // the cover's colour, mottled light (tops) and dark (shadow between), thicker where the plants are
        float k = cv.a * far * (1.0 - steep), m = speck + (clump - 0.5) * 0.9;
        vec3 tops = cv.rgb * (0.85 + 0.45 * speck), gaps = mix(g, cv.rgb, 0.4) * 0.55;
        g = mix(g, mix(gaps, tops, smoothstep(0.35, 0.7, m)), k * 0.85);
      }
      // the maps themselves, in false colour
      if (view > 0.5) {
        vec3 v = vec3(0.12);
        if (view < 1.5) v = vec3(0.1, 0.25, 0.9) * m.r + vec3(0.9, 0.7, 0.2) * m.g + vec3(0.1, 0.55, 0.15) * m.b + vec3(0.5, 0.9, 0.4) * m.a * (1.0 - m.b);
        else if (view < 2.5) v = vec3(m.r);
        else if (view < 3.5) v = vec3(m.g);
        else if (view < 4.5) v = vec3(m.b);
        else if (view < 5.5) v = vec3(m.a);
        else if (view < 6.5) v = vec3(pth.r, pth.g, 0.0);
        else if (view < 7.5) v = vec3(steep);
        else if (view < 8.5) v = vec3(er.r);
        else if (view < 9.5) v = vec3(er.g);
        else if (view > 10.5) v = vec3(er.b);
        else v = texture2D(waterMap, luv).rgb;
        g = v;
      }
    }
    if (!plain) {
      if (farOn > 0.5) {
        float k = smoothstep(farFrom, farFrom * 2.5, length(vW - cameraPosition));
        // far off, a second, larger read of the picture varies the BRIGHTNESS of whatever is there (grass,
        // path, rock...) to break up the repeat; it used to blend the base grass over it, so paths and
        // dirt vanished into grass with distance
        if (k > 0.001) { vec2 u2 = uv * 0.25 + vec2(0.37, 0.61); vec3 g2 = hexOn > 0.5 ? hexTile(u2) : texture2D(groundMap, u2).rgb;
          vec3 L = vec3(0.299, 0.587, 0.114); float v = dot(g2, L) / max(0.02, dot(texture2D(groundMap, vec2(0.5), 16.0).rgb, L));   // against the picture's average
          g *= mix(1.0, clamp(v, 0.6, 1.5), k * 0.65); }
      }
      if (stampOn > 0.5) {
        float fade = 1.0 - smoothstep(stampFar * 0.7, stampFar, length(vW - cameraPosition));
        if (fade > 0.001) g = mix(g, stamps(g, vW.xz), fade);
      }
      if (macroOn > 0.5) {
        float n = fbm(vW.xz / macroSize), n2 = fbm(vW.xz / (macroSize * 1.7) + 31.0);
        vec3 tint = mix(vec3(1.12, 1.02, 0.78), vec3(0.82, 1.06, 0.84), smoothstep(0.3, 0.7, n2));   // dry and yellow to green and lush
        g *= mix(vec3(1.0), tint, macroHue * macroStr) * mix(1.0, 0.62 + 0.76 * n, macroStr);
      }
      // LIGHT AND SHADE (baked): out of the sun behind a ridge, down in a ravine, under the trees
      vec3 sd = texture2D(shadeMap, vW.xz / landSize + 0.5).rgb;
      vec2 inSq = abs(vW.xz - shadowAt.xz) / max(shadowRange, 1.0);                  // inside the real shadows' square, they throw the trees' shade
      float baked = shadowRange > 0.0 ? smoothstep(0.55, 0.92, max(inSq.x, inSq.y)) : 1.0; gShadowFade = baked;
      gLit = mix(1.0, 0.4 + 0.6 * sd.r, hillShade) * mix(1.0, 0.3 + 0.7 * sd.g, aoShade) * (1.0 - treeShade * sd.b * mix(0.35, 1.0, baked));
      g *= gLit;
    }
    // WATER, painted on: its colour by depth over the bed, and the surface's wave normal kept for the
    // glints and sky reflection laid on after the lighting
    if (!plain && waterOn > 0.5 && view < 0.5) {
      vec2 wuv = vW.xz / landSize + 0.5; vec3 wd = texture2D(waterMap, wuv).rgb;
      float edge = (fbm(vW.xz / 1.5) - 0.5) * 0.35;
      gWater = smoothstep(0.35, 0.6, wd.r + edge);
      // water lies flat: on ground that tilts (a channel's walls) it goes, except where the froth says
      // the stream itself is falling steeply (falls and cascades)
      gWater *= mix(1.0 - smoothstep(0.05, 0.14, 1.0 - normalize(vWN).y), 1.0, smoothstep(0.1, 0.45, wd.b));
      if (gWater > 0.0) {
        vec3 wc = mix(wShallow, wDeep, smoothstep(0.2, 0.9, wd.g)) * mix(1.0, gLit, 0.8);   // in the shade too
        g = mix(g, mix(g * wc * 2.2, wc, mix(0.35, 0.75, smoothstep(0.2, 0.55, wd.g))), gWater);   // shallow streams let their bed show
        // WHITE WATER: where a river falls steeply, froth in streaks that run downhill
        gFoam = smoothstep(0.1, 0.6, wd.b) * wFroth * gWater;
        if (gFoam > 0.0) {
          float st = vn(vec2((vW.x + vW.z) * 0.9, vW.y * 0.8 + time * 3.0)) * 0.6 + vn(vec2((vW.x - vW.z) * 2.1, vW.y * 2.0 + time * 5.0)) * 0.4;
          g = mix(g, vec3(0.86, 0.92, 0.95) * (0.78 + 0.32 * st) * gLit, clamp(gFoam * (0.6 + 0.5 * st), 0.0, 1.0));
        }
        vec2 p = vW.xz / wWave, t = vec2(time * wSpeed, time * wSpeed * 0.7) * wWaveOn;
        float e = 0.15, hA = vn(p + t) + 0.5 * vn(p * 2.3 - t * 1.3);
        float hX = vn(p + t + vec2(e, 0.0)) + 0.5 * vn((p + vec2(e, 0.0)) * 2.3 - t * 1.3), hZ = vn(p + t + vec2(0.0, e)) + 0.5 * vn((p + vec2(0.0, e)) * 2.3 - t * 1.3);
        gWaterN = normalize(vec3(-(hX - hA) / e * 0.12 * wWaveOn, 1.0, -(hZ - hA) / e * 0.12 * wWaveOn));
      }
    }
    if (grid > 0.5) { vec2 f = abs(fract(uv + 0.5) - 0.5) / fwidth(uv); g = mix(g, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 1.5, min(f.x, f.y))); }
    diffuseColor.rgb *= g;
  `).replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
    // the real sun shadow fades out over the outer part of its square (the baked tree shade fades in there)
    'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
    'directLight.color *= ( directLight.visible && receiveShadow ) ? mix( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), 1.0, gShadowFade ) : 1.0;'
  )).replace('#include <dithering_fragment>', `
    if (gWater > 0.0) {
      vec3 V = normalize(cameraPosition - vW), R = reflect(-V, gWaterN);
      float fres0 = 0.04 + 0.96 * pow(1.0 - max(dot(V, gWaterN), 0.0), 5.0);
      float fres = fres0 * (1.0 - gFoam);                                                 // froth doesn't mirror the sky
      vec3 refl = skyAt(vW, vec3(R.x, max(R.y, 0.02), R.z)) * fres * wReflect;          // the sky and its clouds, mirrored
      float glint = pow(max(dot(R, normalize(sunDirW)), 0.0), 600.0) * wSpec * 3.0 * (1.0 - gFoam) * smoothstep(400.0, 30.0, length(cameraPosition - vW));   // fine sparkle, fading with distance
      gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (1.0 - fres * wReflect) + refl + vec3(glint), gWater);
    }
    #include <dithering_fragment>
  `);
};
mat.customProgramCacheKey = () => 'terrain-lab-23' + (GL2 ? 'g' : '');
if (!GL2) mat.extensions = { derivatives: true };
const ground = new THREE.Mesh(geo, mat); scene.add(ground); ground.receiveShadow = SHADOW.on;
// THE TREES: the Tree Lab's forest (ez-tree species, meshes near, octahedral imposters beyond, a
// dithered crossfade between), planted where the canopy map grew them instead of on tiles
const SUN_DIR = sun.position.clone().normalize();
const TREE_SPECIES = FOREST_SPECIES.filter(sp => sp.name !== 'bush');
// the Tree Lab's settings, now here (Jacob's defaults, 2026-09-23)
const FOREST = { imposterAt: 150, band: 120, ahead: 0.6, grid: 12, cell: 192, detail: 'sparse', rebake: false };
Object.assign(FOREST, TS.forest);
let treeForest = null;
// WHICH TREE WHERE: src/objects/growth.js (shared with the Growth Lab); here it is handed the land's
// height, slope, wet and dry at each tree
const FAMILY = { ...FAMILY_DEFAULTS };
function pickTree(x, z, species) {
  const i = Math.min(N - 1, Math.max(0, Math.floor((x + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((z + SIZE / 2) / TEX))), k = j * N + i;
  const { sp, hsl } = pickTreeKind(x, z, species.map(s => s.name), { height: Hg[k], slope: slopeAt(i, j), wet: MAPS.wet[k], dry: MAPS.dry[k] }, FAMILY);
  return [sp, new THREE.Color().setHSL(...hsl)];
}
function placeTrees() {
  if (treeForest) { scene.remove(treeForest.group); for (const b of treeForest.built) { b.imposter.geometry.dispose(); b.meshes.forEach(m => m.dispose()); } }
  const species = treeForest && !FOREST.rebake ? treeForest.species : TREE_SPECIES.map(sp => ({ ...sp }));   // keeps the baked atlases unless the atlas settings changed
  FOREST.rebake = false;
  treeForest = new Forest(renderer, scene, { species, shadows: SHADOW.on, detail: FOREST.detail, grid: FOREST.grid, cell: FOREST.cell, imposterAt: FOREST.imposterAt, band: FOREST.band, ahead: FOREST.ahead, sunDir: SUN_DIR, heightAt, nearCap: 600,
    fixed: trees.map(([x, , z, s]) => { const [sp, tint] = pickTree(x, z, species); return { x, z, sp, scale: s, tint }; }) });
  treeForest.group.visible = $('treesOn').checked;
  $('landInfo').textContent = `${trees.length.toLocaleString()} trees, 4 paths`;
}
// ── GROUND COVER: Jacob's Tripo sheet of 16 plants, split into its plants and scattered by the maps ──
// The model stands the plants in a 4 x 4 wall (x across, y up); each triangle goes to the plant whose
// cell its middle is in, and each plant becomes one instanced mesh (16 draws for all of them).
// Grasses go in the open and in part shade, shrubs along the forest's edge and a few inside it,
// nothing on paths, steep or muddy ground.
// counts by tier: Jacob's thickness from the Growth Lab (40,000 in a 140 m circle) over each tier's circle; potato
// at half that, gaming over a 180 m circle rather than 220 (that thickness out to 220 m would be ~99,000)
const COVER = { cache: {}, at: new THREE.Vector3(), ahead: 0.6, farX: TS.coverFarX, on: true, count: 40000, radius: 140, size: COVER_DEFAULTS.size, near: 35, parts: null, meshes: [] };   // ~5 M triangles to start: the readout says what more costs
Object.assign(COVER, TS.cover);
// THE 16 GROUND PLANTS and how they grow: src/objects/growth.js (KIND_INFO), shared with the Growth Lab
// `cell` (optional): [width, height] of a cell in the model's units, counted from 0, instead of the model's box / grid
// `lit(k)` (optional): part k keeps its own normals (bent toward up) instead of every one pointing up
function loadSheet(url, grid, done, cell = null, lit = () => false) {
  new GLTFLoader().load(url, (g) => {
    let src = null; g.scene.traverse(o => { if (o.isMesh && !src) src = o; }); if (!src) return;
    src.updateMatrixWorld(true);
    const geo0 = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone(); geo0.applyMatrix4(src.matrixWorld);
    geo0.computeBoundingBox(); const bb = geo0.boundingBox, pos = geo0.attributes.position, cw = cell ? cell[0] : (bb.max.x - bb.min.x) / grid, ch = cell ? cell[1] : (bb.max.y - bb.min.y) / grid;
    if (cell) { bb.min.x = 0; bb.max.y = grid * ch; }
    const buckets = Array.from({ length: grid * grid }, () => []);
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      buckets[Math.min(grid - 1, Math.floor((bb.max.y - cy) / ch)) * grid + Math.min(grid - 1, Math.floor((cx - bb.min.x) / cw))].push(t);
    }
    const attrs = Object.keys(geo0.attributes); let parts_k = 0;
    const parts = buckets.map(tris => {
      const gg = new THREE.BufferGeometry();
      for (const a of attrs) { const A = geo0.attributes[a], n = A.itemSize, arr = new Float32Array(tris.length * 3 * n); tris.forEach((t, q) => { for (let v = 0; v < 3; v++) for (let c = 0; c < n; c++) arr[(q * 3 + v) * n + c] = A.array[(t + v) * n + c]; }); gg.setAttribute(a, new THREE.BufferAttribute(arr, n)); }
      gg.computeBoundingBox(); const b = gg.boundingBox; gg.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      const nr = gg.attributes.normal, k = parts_k++;
      if (nr) for (let q = 0; q < nr.count; q++) { if (lit(k)) { const x = nr.getX(q) * (1 - LIT_SOFTEN), y = nr.getY(q) * (1 - LIT_SOFTEN) + LIT_SOFTEN, z = nr.getZ(q) * (1 - LIT_SOFTEN), l = Math.hypot(x, y, z) || 1; nr.setXYZ(q, x / l, y / l, z / l); } else nr.setXYZ(q, 0, 1, 0); }
      return gg;
    });
    const m = new THREE.MeshStandardMaterial({ map: src.material.map, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, alphaTest: src.material.alphaTest || 0 });
    if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')); };
    m.customProgramCacheKey = () => 'cover-up-2';
    done(parts, m);
  });
}
// the plants as Forest species: each its own root, lit like the ground, a cheap atlas (8 x 8 views
// of 128 px over the top half: 1024 px, 4 MB colour + 4 MB normal and depth) and no green tint
// what the ground at a spot is like, for the plants and the lawn (see growPlants in src/objects/growth.js): how much
// each habitat likes it (grass: open, part shade; shrub: the forest's edge; long: open, dry rises; shade; wet: along
// water; dry), `hard` where nothing grows (paths, steep, in the water), `blocked` that and mud and the stony shore
function coverGround(x, z) {
  const i = Math.min(N - 1, Math.max(0, Math.floor((x + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((z + SIZE / 2) / TEX))), k = j * N + i;
  const pi = Math.min(MAPS.P - 1, Math.max(0, Math.floor((x + SIZE / 2) / SIZE * MAPS.P))), pj = Math.min(MAPS.P - 1, Math.max(0, Math.floor((z + SIZE / 2) / SIZE * MAPS.P))), path = MAPS.path[(pj * MAPS.P + pi) * 4] / 255 + MAPS.path[(pj * MAPS.P + pi) * 4 + 1] / 510;
  const canopy = MAPS.canopy[k], shade = Math.min(1, Math.max(0, MAPS.wide[k] * 2.2 - canopy * 0.8)), open = 1 - Math.min(1, canopy + shade);
  const hard = path + MAPS.steep[k] * 1.5 + waterAt(x, z) * 4, shore = MAPS.shore ? Math.min(1, MAPS.shore[k] * 2.5) : 0;
  const blocked = hard + Math.max(0, MAPS.wet[k] - 0.6) * 2 + shore * 1.2;
  return { hard, blocked, shade: Math.min(1, shade + 0.6 * canopy), wet: Math.max(shore, MAPS.wet[k]) * (1 - MAPS.steep[k]),
    dry: MAPS.steep[k] > 0.4 ? 0 : MAPS.dry[k] * open, grass: (0.55 * open + 1.0 * shade + 0.15 * canopy) * (1 - MAPS.dry[k] * 0.4), shrub: 0.08 * open + 0.9 * shade + 0.35 * canopy,
    long: MAPS.steep[k] > 0.4 ? 0 : (0.35 + 0.65 * MAPS.dry[k]) * (1 - Math.min(1, canopy * 1.5 + MAPS.wide[k])) * (1 - Math.min(1, path + MAPS.steep[k] + MAPS.wet[k])) };
}
// THE LAWN: short grass tufts on the bare ground near you (src/objects/lawn.js, placed by lawnSpots), the
// grass's own colour, darkened by the land's shade; laid with the plants
const LAWN = { ...TS.lawn, count: 0 };
const lawn = makeLawn({ cap: 90000, shade: { shadeMap: U.shadeMap, landSize: U.landSize, hillShade: U.hillShade, aoShade: U.aoShade, treeShade: U.treeShade } });
scene.add(lawn.mesh);
// THE COVER MAP (512 x 512 over the land, a pixel 3 m): what grows at each spot as one colour and a thickness,
// for the ground shader to paint past where the plants end: the winning patch kind's colour (each kind's
// average, read from the sheet's picture), the lawn's colour on bare ground, alpha how thick. Baked when the
// growth settings change (~0.2 s), only if they did.
let coverTex = null, coverKey = '';
function kindColours() {
  if (COVER.kindCol) return COVER.kindCol;
  const img = COVER.material && COVER.material.map && COVER.material.map.image; if (!img || !COVER.parts) return null;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, S, S); const d = g.getImageData(0, 0, S, S).data;
  COVER.kindCol = COVER.parts.map(geo => { const uv = geo.attributes.uv; let r = 0, gg = 0, b = 0, n = 0;
    for (let q = 0; q < uv.count; q += 3) { const i = Math.min(S - 1, Math.max(0, Math.floor(uv.getX(q) * S))), j = Math.min(S - 1, Math.max(0, Math.floor(uv.getY(q) * S))), o = (j * S + i) * 4; r += d[o]; gg += d[o + 1]; b += d[o + 2]; n++; }
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace); });
  return COVER.kindCol;
}
function bakeCoverMap() {
  const kc = kindColours(); if (!kc || !MAPS.wet) return;
  const key = JSON.stringify([GROW, PLANT_KINDS.map(K => [K.on, K.style])]); if (key === coverKey && coverTex) return; coverKey = key;
  const M = 512, data = new Uint8Array(M * M * 4), lawnC = lawn.uniforms.tip.value.clone().lerp(lawn.uniforms.root.value, 0.5), col = new THREE.Color();
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = (i + 0.5) / M * SIZE - SIZE / 2, z = (j + 0.5) / M * SIZE - SIZE / 2, a = patchAt(x, z, coverGround, PLANT_KINDS, GROW), o = (j * M + i) * 4;
    if (!a) { data[o + 3] = 0; continue; }
    col.copy(kc[a.kind]).lerp(lawnC, a.bare * (GROW.lawn ?? 1)); const thick = a.thick * (1 - a.bare * (1 - (GROW.lawn ?? 1) * 0.7));
    const c = col.clone().convertLinearToSRGB(); data[o] = c.r * 255; data[o + 1] = c.g * 255; data[o + 2] = c.b * 255; data[o + 3] = Math.min(1, thick) * 255;
  }
  if (!coverTex) { coverTex = new THREE.DataTexture(data, M, M, THREE.RGBAFormat); coverTex.colorSpace = THREE.SRGBColorSpace; coverTex.magFilter = coverTex.minFilter = THREE.LinearFilter; U.coverMap.value = coverTex; }
  else coverTex.image.data.set(data);
  coverTex.needsUpdate = true;
}
function placeLawn() {
  const spots = LAWN.radius > 0 ? lawnSpots({ ground: coverGround, at: COVER.at, radius: LAWN.radius, density: LAWN.density, grow: GROW }) : [];
  for (const t of spots) t.y = heightAt(t.x, t.z);
  LAWN.count = lawn.set(spots);
  const a = U.layLush.value && U.layLush.value.userData.avg, base = (a ? a.clone() : new THREE.Color(0.25, 0.33, 0.1)).multiply(U.lushTint.value);
  lawn.colours(base.clone().multiplyScalar(0.8), base.clone().multiply(new THREE.Color(1.15, 1.12, 0.85)));   // darker at the root, lighter and yellower at the tips
}
function plantSpecies(parts, material) {
  return parts.map((g, k) => { const root = new THREE.Group(); root.add(new THREE.Mesh(g, material)); return { name: 'ground ' + KIND_INFO[k].name, root, height: KIND_INFO[k].height, weight: 1, grid: 8, cell: 128, upNormals: !KIND_INFO[k].lit, soften: KIND_INFO[k].lit ? LIT_SOFTEN : 0, sway: KIND_INFO[k].lit ? 0.45 : 1, tint: false }; });   // big plants sway less
}
loadSheet('/models/props/groundPlants.glb', 4, (parts, m) => { COVER.parts = parts; COVER.material = m; COVER.plantSp = plantSpecies(parts, m); placeCover(); }, [0.5, 1.0], (k) => !!KIND_INFO[k].lit);
let coverForest = null;
// far plants blend toward the grass's own colour (its picture's average, tinted as the ground is),
// darkened a little: bushes are darker than the grass they stand in
function calmCover() {
  if (!coverForest) return;
  const a = U.layLush.value && U.layLush.value.userData.avg, col = (a ? a.clone() : new THREE.Color(0.25, 0.33, 0.1)).multiply(U.lushTint.value).multiplyScalar(0.9);
  coverForest.setCalm({ calmCol: col, calmFrom: CALM.from, calmTo: CALM.to, calmAmt: CALM.amount });
}
const CALM = { from: 60, to: 260, amount: 0.35 };   // gentle: far plants keep most of their own colour and shading
// STONES: simple rocks (a lumpy, flattened ball in four shapes, drawn faceted) scattered by the land:
// thick on steep and rocky ground and in the scree at the foot of the cliffs, a few out in the
// meadows, many along the streams and shores (in the creeks too), none out in the lakes or on the paths. Mostly small, the odd boulder. 20 faces each (80 on gaming).
const STONES = { on: true, count: TS.stones, size: 1, meshes: [], shapes: null };
function stoneShapes() {
  const out = [];
  for (let v = 0; v < 4; v++) {
    const g = new THREE.IcosahedronGeometry(1, QUAL.tier === 'gaming' ? 1 : 0), p = g.attributes.position, seen = new Map();
    for (let k = 0; k < p.count; k++) {
      const key = p.getX(k).toFixed(3) + ',' + p.getY(k).toFixed(3) + ',' + p.getZ(k).toFixed(3);   // shared corners move together, so the rock stays closed
      if (!seen.has(key)) seen.set(key, 0.72 + 0.5 * hash(k * 1.7 + v * 13.1, seen.size * 0.37 + v));
      const f = seen.get(key); p.setXYZ(k, p.getX(k) * f * (1 + 0.25 * v / 3), p.getY(k) * f * (0.5 + 0.08 * v), p.getZ(k) * f);
    }
    g.computeVertexNormals(); out.push(g);
  }
  return out;
}
// a material darkened by the land's baked shade where each instance stands, like the ground under it
// `rock` (optional): a rock picture laid on from three sides in the stone's own space (triplanar), so it
// wraps a lumpy stone without stretching and stays put on it
function landShaded(m, rock = null) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { shadeMap: U.shadeMap, landSize: U.landSize, hillShade: U.hillShade, aoShade: U.aoShade, treeShade: U.treeShade });
    if (rock) {
      sh.uniforms.rockMap = { value: rock };
      sh.vertexShader = 'varying vec3 vRockP; varying vec3 vRockN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockP = position; vRockN = normal;');
      sh.fragmentShader = 'uniform sampler2D rockMap; varying vec3 vRockP; varying vec3 vRockN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 w = pow(abs(normalize(vRockN)), vec3(4.0)); w /= w.x + w.y + w.z; vec3 p = vRockP * 0.8;
          diffuseColor.rgb *= texture2D(rockMap, p.zy).rgb * w.x + texture2D(rockMap, p.xz).rgb * w.y + texture2D(rockMap, p.xy).rgb * w.z; }`);
    }
    sh.vertexShader = 'varying vec2 vLand;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 lw = vec4(0.0, 0.0, 0.0, 1.0);\n#ifdef USE_INSTANCING\nlw = instanceMatrix * lw;\n#endif\nvLand = (modelMatrix * lw).xz; }');
    sh.fragmentShader = 'uniform sampler2D shadeMap; uniform float landSize, hillShade, aoShade, treeShade; varying vec2 vLand;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec3 sd = texture2D(shadeMap, vLand / landSize + 0.5).rgb; diffuseColor.rgb *= mix(1.0, 0.4 + 0.6 * sd.r, hillShade) * mix(1.0, 0.3 + 0.7 * sd.g, aoShade) * (1.0 - treeShade * sd.b * 0.6); }`);
  };
  m.customProgramCacheKey = () => 'land-shaded' + (rock ? '-rock' : '');
  return m;
}
// the stones' pictures: granite and diorite, alternating by shape (none on potato: plain grey there)
const ROCK_TEX = TS.lite ? null : ['diorite', 'granite'].map(n => { const t = new THREE.TextureLoader().load(`/textures/rock/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
function placeStones() {
  for (const m of STONES.meshes) { scene.remove(m); m.dispose(); }
  STONES.meshes = [];
  if (!STONES.on || !MAPS.steep) return;
  STONES.shapes = STONES.shapes || stoneShapes();
  const r = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
  const scree = blur(MAPS.steep, 3), per = [[], [], [], []];
  let placed = 0;
  for (let t = 1; placed < STONES.count && t < STONES.count * 30; t++) {
    const x = (r(t, 41.3) - 0.5) * SIZE * 0.98, z = (r(t, 43.7) - 0.5) * SIZE * 0.98;
    const i = Math.min(N - 1, Math.max(0, Math.floor((x + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((z + SIZE / 2) / TEX))), k = j * N + i;
    if (POND[k]) continue;                                                    // none out in the lakes; streams are fine (stones in a creek)
    const pi = Math.floor((x + SIZE / 2) / SIZE * MAPS.P), pj = Math.floor((z + SIZE / 2) / SIZE * MAPS.P); if (MAPS.path[(pj * MAPS.P + pi) * 4] > 60) continue;
    const creek = MAPS.shore ? Math.min(1, MAPS.shore[k] * 2.5) : 0;             // along streams and shores the soil is washed off the stones
    const sl = slopeAt(i, j), want = 0.14 + 1.6 * creek + 0.8 * THREE.MathUtils.smoothstep(sl, 0.45, 0.9) + 0.9 * Math.max(0, scree[k] - MAPS.steep[k]) * 2;
    if (r(t, 47.1) > want) continue;
    const u = r(t, 49.9), size = STONES.size * (0.22 + 1.7 * u * u * u) * (1 + 0.6 * Math.max(0, scree[k] - MAPS.steep[k]));
    per[Math.floor(r(t, 51.7) * 4) % 4].push([x, heightAt(x, z) - size * 0.22, z, size, r(t, 53.3) * 6.283, r(t, 57.1)]);
    placed++;
  }
  const base = new THREE.Color(0x8d8a84), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  per.forEach((list, v) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(STONES.shapes[v], landShaded(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }), ROCK_TEX ? ROCK_TEX[v % 2] : null), list.length);
    list.forEach(([x, y, z, sc, yaw, tone], n) => {
      e.set((tone - 0.5) * 0.3, yaw, (tone - 0.5) * 0.2); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc, sc)); mesh.setMatrixAt(n, m4);
      if (ROCK_TEX) mesh.setColorAt(n, c.setScalar(0.8 + 0.35 * tone));   // the picture carries the colour; just lighter and darker stones
      else mesh.setColorAt(n, c.copy(base).multiplyScalar(0.72 + 0.4 * tone).lerp(new THREE.Color(0x9a8f78), (tone * 7.3) % 1 * 0.35));   // greys, some warmer
    });
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = SHADOW.on; scene.add(mesh); STONES.meshes.push(mesh);
  });
  if ($('stoneInfo')) $('stoneInfo').textContent = `${placed.toLocaleString()} stones`;
}
const GROW = { ...GROW_DEFAULTS }, PLANT_KINDS = defaultKinds();
// the plants' circle follows where you look: once its centre (a little ahead of the camera, on the
// ground) has moved a quarter of the circle, they are laid again round the new spot (the tiles that
// stay keep their plants, so nothing near you shuffles)
function followCover() {
  if (!coverForest || RAIN.gen) return;
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
  // like the trees' circle: pushed ahead of the camera by `ahead` of its radius, so it covers what's in view
  // rather than the ground under and behind you
  const at = camera.position.clone().addScaledVector(fwd.lengthSq() > 1e-6 ? fwd.normalize() : fwd, COVER.radius * COVER.ahead); at.y = 0;
  // moving: the new plants are worked out a few milliseconds a frame (the old ones stay up meanwhile), then
  // swapped in; doing it all at once stalled a phone for a quarter of a second every 35 m
  if (COVER.job) { COVER.job.next(); return; }
  if (at.distanceTo(COVER.at) > COVER.radius * 0.25 && coverForest.ready) { COVER.at.copy(at); COVER.job = moveCover(COVER.at.clone()); }
}
// moving the plants, a few milliseconds a frame: where they go, then their drawing data, then the lawn's tufts;
// then two quick frames to hand them over (plants, then lawn)
function* moveCover(at) {
  const B = 6;
  const list = yield* growPlantsSteps({ ground: coverGround, cache: COVER.cache, at, radius: COVER.radius, far: COVER.farX, count: COVER.on ? COVER.count : 0, size: COVER.size, kinds: PLANT_KINDS, grow: GROW, budget: B });
  const laid = yield* coverForest.layFixedSteps(list, B);
  const spots = LAWN.radius > 0 ? yield* lawnSpotsSteps({ ground: coverGround, at, radius: LAWN.radius, density: LAWN.density, grow: GROW, budget: B }) : [];
  for (let i = 0; i < spots.length; i++) { spots[i].y = heightAt(spots[i].x, spots[i].z); if ((i & 2047) === 0) yield; }
  yield;
  coverForest.setFixed(list, laid); U.coverR.value = COVER.radius * COVER.farX; U.coverAt.value.copy(at);
  yield;
  LAWN.count = lawn.set(spots);
  COVER.job = null;
}
// `ready` (optional): the plants, already worked out (by the spread-over-frames job in followCover)
function placeCover(ready = null) {
  U.coverR.value = COVER.radius * COVER.farX; U.coverAt.value.copy(COVER.at);   // (the far paint takes over where the sparse far plants end)
  for (const im of COVER.meshes) { scene.remove(im); im.dispose(); }
  COVER.meshes = [];
  if (!COVER.parts || !MAPS.wet) return;
  const ground = coverGround;

  // where they go: src/objects/growth.js (shared with the Growth Lab)
  if (!ready) COVER.job = null;                       // laid now: any job in flight is stale
  const fixed = ready || growPlants({ ground, cache: COVER.cache, at: COVER.at, radius: COVER.radius, far: COVER.farX, count: COVER.on ? COVER.count : 0, size: COVER.size, kinds: PLANT_KINDS, grow: GROW }), placed = fixed.length;
  // one Forest for all of them: meshes out to COVER.near, imposters beyond, crossfaded
  // the drawer is kept and handed the new list (a rebuild cost ~0.1 s a move); only rebuilt when its range changed
  if (coverForest && coverForest.ready && coverForest.imposterAt === COVER.near) {
    coverForest.setFixed(fixed); calmCover(); placeLawn(); bakeCoverMap();
    $('coverInfo').textContent = `${placed.toLocaleString()} plants of 16 kinds: meshes to ${COVER.near} m, imposters beyond` + (LAWN.count ? ` · ${LAWN.count.toLocaleString()} lawn tufts (${(LAWN.count * lawn.trisPerTuft / 1e6).toFixed(2)} M triangles) out to ${LAWN.radius} m` : '');
    return;
  }
  if (coverForest) { scene.remove(coverForest.group); for (const b of coverForest.built) { b.imposter.geometry.dispose(); b.meshes.forEach(m => m.dispose()); } }
  const species = coverForest ? coverForest.species : COVER.plantSp;
  coverForest = new Forest(renderer, scene, { species, shadows: SHADOW.on && TS.shadow.cover, fixed, heightAt, imposterAt: COVER.near, band: COVER.near * 0.5, ahead: 0.5, sunDir: SUN_DIR, nearCap: 12000, wind: true });   // (Jacob's thickness puts ~7,000 within 60 m)
  calmCover(); placeLawn(); bakeCoverMap();
  $('coverInfo').textContent = `${placed.toLocaleString()} plants of 16 kinds: meshes to ${COVER.near} m, imposters beyond (atlases bake over the first seconds)` + (LAWN.count ? ` · ${LAWN.count.toLocaleString()} lawn tufts (${(LAWN.count * lawn.trisPerTuft / 1e6).toFixed(2)} M triangles) out to ${LAWN.radius} m` : '');
}
buildLand();

// ── views ─────────────────────────────────────────────────────────────────────
const VIEWS = {
  'Standing': () => { const y = heightAt(0, 40) + 1.7; camera.position.set(0, y, 40); controls.target.set(0, heightAt(0, -60) + 1.2, -60); },
  'Across the field': () => { camera.position.set(-40, heightAt(-40, 120) + 14, 120); controls.target.set(60, heightAt(60, -200), -200); },
  'Hillside': () => { camera.position.set(260, heightAt(260, 260) + 40, 260); controls.target.set(0, 0, 0); },
  'Overhead': () => { camera.position.set(0, 160, 0.1); controls.target.set(0, 0, 0); },
};
for (const [n, f] of Object.entries(VIEWS)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.onclick = () => { f(); controls.update(); }; $('views').appendChild(b); }
VIEWS['Standing'](); controls.update();

// ── the panel ─────────────────────────────────────────────────────────────────
const SL = {
  tile: [v => { U.tile.value = v; }, v => v.toFixed(1) + ' m'],
  hexSize: [v => { U.hexSize.value = v; }, v => v.toFixed(2)],
  hexRot: [v => { U.hexRot.value = THREE.MathUtils.degToRad(v); }, v => Math.round(v) + '°'],
  hexSharp: [v => { U.hexSharp.value = v; }, v => v.toFixed(1)],
  hexBright: [v => { U.hexBright.value = v; }, v => Math.round(v * 100) + '%'],
  macroStr: [v => { U.macroStr.value = v; }, v => Math.round(v * 100) + '%'],
  macroSize: [v => { U.macroSize.value = v; }, v => v + ' m'],
  macroHue: [v => { U.macroHue.value = v; }, v => Math.round(v * 100) + '%'],
  farFrom: [v => { U.farFrom.value = v; }, v => v + ' m'],
  stampDensity: [v => { U.stampDensity.value = v; }, v => Math.round(v * 100) + '% of cells'],
  stampCell: [v => { U.stampCell.value = v; }, v => v.toFixed(2) + ' m'],
  stampSize: [v => { U.stampSize.value = v; }, v => v.toFixed(2) + '×'],
  stampHue: [v => { U.stampHue.value = v; }, v => Math.round(v * 57.3) + '°'],
  stampShade: [v => { U.stampShade.value = v; }, v => Math.round(v * 100) + '%'],
  stampFar: [v => { U.stampFar.value = v; }, v => v + ' m'],
  mixSharp: [v => { U.mixSharp.value = v; }, v => v.toFixed(1)],
  mixHeight: [v => { U.mixHeight.value = v; }, v => v.toFixed(2)],
  mixBreak: [v => { U.mixBreak.value = v; }, v => Math.round(v * 100) + '%'],
  mixBreakSize: [v => { U.mixBreakSize.value = v; }, v => v.toFixed(1) + ' m'],
  steepFrom: [v => { U.steepFrom.value = v; }, v => Math.round(Math.acos(1 - v) * 57.3) + '°'],
  rockFrom: [v => { U.rockFrom.value = v; }, v => Math.round(Math.acos(1 - v) * 57.3) + '°'],
};
for (const [id, [apply, fmt]] of Object.entries(SL)) { const el = $(id), go = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); }; el.addEventListener('input', go); go(); }
for (const [id, on] of Object.entries(TS.checks)) if ($(id)) $(id).checked = on;
for (const [id, key] of [['hexOn', 'hexOn'], ['macroOn', 'macroOn'], ['farOn', 'farOn'], ['grid', 'grid'], ['stampOn', 'stampOn'], ['mixOn', 'mixOn'], ['wWaveOn', 'wWaveOn'], ['coverFar', 'coverFar']]) { const el = $(id), go = () => { U[key].value = el.checked ? 1 : 0; }; el.addEventListener('change', go); go(); }
$('tex').addEventListener('change', () => { U.groundMap.value = tex($('tex').value); setAverages(); });
// the layers' pictures, and the land's settings (these rebuild the maps)
const LAYERS = { layDry: 'grassDry', layLush: 'grassMed', layForest: 'forest', layWet: 'darkDirt', layPath: 'dirt', laySteep: 'concrete', layShore: 'rocks' };
for (const [id, def] of Object.entries(LAYERS)) { const el = $(id); for (const n of TEXTURES) el.add(new Option(n, n)); el.value = def; const go = () => { U[id].value = tex(el.value); setAverages(); }; el.addEventListener('change', go); go(); }
for (const [id, key, fmt] of [['landWet', 'wetDepth', v => v.toFixed(1) + ' m'], ['landDry', 'dryHeight', v => v.toFixed(1) + ' m'], ['landForest', 'forest', v => Math.round(v * 100) + '%'], ['landShade', 'shadeReach', v => Math.round(v * TEX) + ' m'], ['landPath', 'pathWidth', v => v.toFixed(1) + ' m'], ['landTreeline', 'treeline', v => v + ' m'], ['landShore', 'shore', v => Math.round(v * TEX) + ' m'], ['landHill', 'hillForest', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = LAND[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { LAND[key] = +el.value; buildLand(); });
}
// COPY SETTINGS: every control in the panel (sliders, boxes, colours, lists) as { id: value }, so a set
// someone tuned by hand can be pasted back and made the defaults; the quality tier comes along to say
// which tier's numbers they were
$('copySettings').addEventListener('click', async () => {
  const out = { tier: QUAL.tier };
  for (const el of document.querySelectorAll('#panel input[id], #panel select[id], aside input[id], aside select[id]')) {
    if (el.id === 'qTier') continue;
    out[el.id] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
  }
  const text = JSON.stringify(out);
  let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* no clipboard: show it instead */ }
  if (ok) $('copyNote').textContent = `Copied ${Object.keys(out).length - 1} settings. Paste them in chat.`;
  else { $('copyNote').textContent = 'Copy this:'; const ta = document.createElement('textarea'); ta.value = text; ta.rows = 4; ta.style.width = '100%'; $('copyNote').after(ta); ta.select(); }
});
// light and shade
for (const [id, key] of [['hillShade', 'hillShade'], ['aoShade', 'aoShade'], ['treeShade', 'treeShade'], ['shoreStr', 'shoreStr']]) {
  const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = Math.round(+el.value * 100) + '%'; }; el.value = U[key].value; el.addEventListener('input', go); go();
}
// the sky's controls
{ const on = () => { sky.uniforms.cloudOn.value = $('cloudsOn').checked ? 1 : 0; sky.mesh.visible = $('cloudsOn').checked; }; $('cloudsOn').addEventListener('change', on); on();
  for (const [id, key, fmt] of [['cloudCover', 'cloudCover', v => Math.round(v * 100) + '%'], ['cloudSoft', 'cloudSoft', v => v.toFixed(2)], ['cloudScale', 'cloudScale', v => v + ' m'], ['cloudSpeed', 'cloudSpeed', v => v.toFixed(3)]]) {
    const el = $(id), go = () => { sky.uniforms[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = sky.uniforms[key].value; el.addEventListener('input', go); go(); } }
$('mixView').addEventListener('change', e => { U.view.value = +e.target.value; });
$('treesOn').addEventListener('change', e => { if (treeForest) treeForest.group.visible = e.target.checked; });
$('coverOn').addEventListener('change', e => { COVER.on = e.target.checked; placeCover(); });
// how the plants grow, and each kind's settings
$('gWinner').checked = !!GROW.winner; $('gWinner').addEventListener('change', e => { GROW.winner = e.target.checked; placeCover(); });
for (const [id, key, fmt] of [['gBare', 'bare', v => Math.round(v * 100) + '%'], ['gBareSize', 'bareSize', v => v + ' m'], ['gWetSize', 'wetSize', v => v > 0 ? `${(1 - 0.25 * v).toFixed(2)}× dry … ${(1 + 0.3 * v).toFixed(2)}× wet` : 'off'],
  ['gClumpEdge', 'clumpEdge', v => Math.round(v * 100) + '%'], ['gLonerBare', 'lonerBare', v => Math.round(v * 100) + '%'], ['gLongClear', 'longClear', v => Math.round(v * 100) + '%'], ['gPatchSize', 'patchSize', v => v + ' m'], ['gPatchSharp', 'patchSharp', v => Math.round(v * 100) + '%'], ['gClumpShare', 'clumpShare', v => Math.round(v * 100) + '%'], ['gClumpSize', 'clumpSize', v => v + ' m'],
  ['gClumpCount', 'clumpCount', v => v + ' plants'], ['gLonerShare', 'lonerShare', v => Math.round(v * 100) + '%'], ['gFertSize', 'fertSize', v => v + ' m'], ['gFert', 'fert', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = GROW[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { GROW[key] = +el.value; placeCover(); });
}
{
  const list = $('kindList'), kindName = (k) => `${KIND_INFO[k].name} <small style="color:#6d7a85">${KIND_INFO[k].hab}</small>`;
  PLANT_KINDS.forEach((K, k) => {
    const row = document.createElement('div'); row.className = 'row'; row.style.gridTemplateColumns = 'auto 1fr auto auto';
    row.innerHTML = `<label class="check" for="kOn${k}" style="margin:0"><input id="kOn${k}" type="checkbox"> ${kindName(k)}</label>`
      + `<select id="kStyle${k}"><option value="patch">patch</option><option value="clump">clump</option><option value="loner">loner</option></select>`
      + `<input id="kSize${k}" type="range" min="0.3" max="2.5" step="0.05" style="width:70px" title="size"><output id="kSize${k}Out"></output>`
      + `<button type="button" id="kOnly${k}" style="grid-column:1/-1;justify-self:start;padding:1px 6px">Only</button>`;
    list.appendChild(row);
    const on = $('kOn' + k), st = $('kStyle' + k), sz = $('kSize' + k);
    on.checked = K.on; st.value = K.style; sz.value = K.size; $('kSize' + k + 'Out').textContent = K.size.toFixed(2) + '×';
    on.addEventListener('change', () => { K.on = on.checked; placeCover(); });
    st.addEventListener('change', () => { K.style = st.value; placeCover(); });
    sz.addEventListener('input', () => { $('kSize' + k + 'Out').textContent = (+sz.value).toFixed(2) + '×'; }); sz.addEventListener('change', () => { K.size = +sz.value; placeCover(); });
    $('kOnly' + k).addEventListener('click', () => { PLANT_KINDS.forEach((O, n) => { O.on = n === k; $('kOn' + n).checked = O.on; }); placeCover(); });
  });
  $('kindsAll').addEventListener('click', () => { PLANT_KINDS.forEach((O, n) => { O.on = true; $('kOn' + n).checked = true; }); placeCover(); });
}
// GROWTH SETTINGS in and out (the same text as the Growth Lab's): pasted ones set the panel's controls
// as if moved by hand, but the plants and trees are laid once at the end, not once a control
function syncGrowthPanel() {
  const put = (id, v) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input')); };
  put('gWinner', !!GROW.winner);
  for (const [id, key] of [['gBare', 'bare'], ['gBareSize', 'bareSize'], ['gWetSize', 'wetSize'], ['gClumpEdge', 'clumpEdge'], ['gLonerBare', 'lonerBare'], ['gLongClear', 'longClear'], ['gPatchSize', 'patchSize'], ['gPatchSharp', 'patchSharp'], ['gClumpShare', 'clumpShare'], ['gClumpSize', 'clumpSize'], ['gClumpCount', 'clumpCount'], ['gLonerShare', 'lonerShare'], ['gFertSize', 'fertSize'], ['gFert', 'fert']]) put(id, GROW[key]);
  for (const [id, key] of [['famSize', 'size'], ['famStrict', 'strength'], ['famPine', 'pineFrom']]) put(id, FAMILY[key]);
  PLANT_KINDS.forEach((K, k) => { put('kOn' + k, K.on); put('kStyle' + k, K.style); put('kSize' + k, K.size); });
  put('coverCount', COVER.count); put('coverSize', COVER.size);
}
$('growCopy').addEventListener('click', async () => {
  const text = settingsJSON(GROW, FAMILY, PLANT_KINDS, COVER);
  try { await navigator.clipboard.writeText(text); $('growNote').textContent = 'Copied.'; } catch (e) { $('growNote').textContent = text; }
});
$('growPaste').addEventListener('click', async () => {
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the growth settings here') || ''; }
  if (!applySettings(text, GROW, FAMILY, PLANT_KINDS, COVER)) { $('growNote').textContent = "That isn't growth settings (copy them from the Growth Lab first)."; return; }
  syncGrowthPanel(); placeTrees(); placeCover(); $('growNote').textContent = 'Pasted and applied.';
});
// tree families
for (const [id, key, fmt] of [['famSize', 'size', v => v + ' m'], ['famStrict', 'strength', v => Math.round(v * 100) + '%'], ['famPine', 'pineFrom', v => v + ' m up']]) {
  const el = $(id); el.value = FAMILY[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { FAMILY[key] = +el.value; placeTrees(); });
}
// the breeze and the lawn
$('windOn').checked = WIND.on; $('windOn').addEventListener('change', e => { WIND.on = e.target.checked; if (!WIND.on) WIND.uniforms.windAmp.value = 0; else WIND.uniforms.windAmp.value = +$('windAmp').value; });
for (const [id, key, fmt] of [['windAmp', 'windAmp', v => Math.round(v * 100) + '% lean'], ['windSpeed', 'windSpeed', v => v.toFixed(1)], ['windFreq', 'windFreq', v => Math.round(1 / v) + ' m waves']]) {
  const el = $(id), go = () => { if (key !== 'windAmp' || WIND.on) WIND.uniforms[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = WIND.uniforms[key].value; el.addEventListener('input', go); go(); }
for (const [id, obj, key, fmt] of [['lawnAmount', GROW, 'lawn', v => Math.round(v * 100) + '%'], ['lawnDensity', LAWN, 'density', v => v + ' tufts / m²'], ['lawnRadius', LAWN, 'radius', v => v ? v + ' m' : 'off']]) {
  const el = $(id); el.value = obj[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { obj[key] = +el.value; placeLawn(); placeCover(); });
}
$('stonesOn').checked = STONES.on; $('stonesOn').addEventListener('change', e => { STONES.on = e.target.checked; placeStones(); });
for (const [id, key, fmt] of [['stoneCount', 'count', v => v.toLocaleString()], ['stoneSize', 'size', v => v.toFixed(1) + '×']]) {
  const el = $(id); el.value = STONES[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { STONES[key] = +el.value; placeStones(); });
}
for (const [id, key, fmt] of [['calmAmount', 'amount', v => Math.round(v * 100) + '%'], ['calmFrom', 'from', v => v + ' m'], ['calmTo', 'to', v => v + ' m']]) {
  const el = $(id); el.value = CALM[key]; const go = () => { CALM[key] = +el.value; $(id + 'Out').textContent = fmt(+el.value); calmCover(); }; el.addEventListener('input', go); go();
}
for (const [id, key, fmt] of [['coverCount', 'count', v => v.toLocaleString()], ['coverRadius', 'radius', v => v + ' m'], ['coverSize', 'size', v => v.toFixed(2) + '×'], ['coverNear', 'near', v => v + ' m'], ['coverAhead', 'ahead', v => Math.round(v * 100) + '% ahead'], ['coverFarX', 'farX', v => v.toFixed(1) + '× (sparser, bigger)']]) {
  const el = $(id); el.value = COVER[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { COVER[key] = +el.value; placeCover(); });
}
// ── the land's shape: terraces and erosion (these rebuild the land, the maps, trees and plants) ──
// WATCH IT RAIN: the land without erosion, then drops a chunk a frame with their trails drawn and the
// mesh reshaped as they go; when the rain stops the maps, trees and plants are rebuilt on the result
const RAIN = { gen: null, paused: false, perFrame: 1500, done: 0, trail: [], frame: 0 };
const trailGeo = new THREE.BufferGeometry(), trailLines = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({ color: 0x5fb4ff, transparent: true, opacity: 0.55 }));
trailLines.frustumCulled = false; trailLines.visible = false; scene.add(trailLines);
function fastMesh() { if (SEG !== N - 1) { shapeMesh(); return; } const p = geo.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, Hg[k]); p.needsUpdate = true; geo.computeVertexNormals(); }
function endRain(msg) { RAIN.gen = null; trailLines.visible = false; if (RAIN.before) smoothErosion(RAIN.before); cutRavines(Hg); addCrags(Hg); findWater(Hg); fastMesh(); buildLand(); if (treeForest) treeForest.group.visible = $('treesOn').checked; $('shapeInfo').textContent = msg; }
function startRain() {
  FLOW.fill(0); SETTLE.fill(0);
  baseGrid(); RAIN.before = Float32Array.from(Hg);
  WDEPTH.fill(0); ACC.fill(0); paintWater(new Uint8Array(N * N)); fastMesh();   // no water drawn while it rains: the old rivers belong to the finished land, not this bare one
  for (const f of [treeForest, coverForest]) if (f) f.group.visible = false;
  RAIN.trail = []; RAIN.done = 0; RAIN.paused = false; RAIN.gen = erodeSteps(Hg, SHAPE.drops, () => RAIN.perFrame, RAIN.trail); trailLines.visible = true;
  $('rainPause').textContent = 'pause';
}
function stepRain() {
  if (!RAIN.gen || RAIN.paused) return;
  const r = RAIN.gen.next();
  if (r.done) { endRain(`rained ${SHAPE.drops.toLocaleString()} drops`); return; }
  RAIN.done = r.value;
  const T = RAIN.trail, n = T.length / 3, pos = new Float32Array(n * 3);          // this chunk's trails, just above the ground
  for (let q = 0; q < n; q++) { pos[q * 3] = T[q * 3] * TEX - SIZE / 2 + TEX / 2; pos[q * 3 + 1] = T[q * 3 + 2] + 0.6; pos[q * 3 + 2] = T[q * 3 + 1] * TEX - SIZE / 2 + TEX / 2; }
  trailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); trailGeo.computeBoundingSphere();
  if (++RAIN.frame % 6 === 0) fastMesh();
  $('shapeInfo').textContent = `raining: ${RAIN.done.toLocaleString()} of ${SHAPE.drops.toLocaleString()} drops`;
}
// the valley's and water's controls: the shape ones rebuild everything, the look ones are live
for (const [id, key, fmt] of [['vHeight', 'height', v => v + ' m'], ['vWidth', 'width', v => v + ' m'], ['vSlope', 'slope', v => v + ' m'], ['vSteep', 'steep', v => v.toFixed(2)], ['vAngle', 'angle', v => v + '°'], ['vMeander', 'meander', v => v + ' m'], ['vFine', 'fine', v => Math.round(v * 100) + '%'], ['vRidges', 'ridges', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = VALLEY[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { VALLEY[key] = +el.value; reshape(); });
}
$('vOn').checked = VALLEY.on; $('vOn').addEventListener('change', e => { VALLEY.on = e.target.checked; reshape(); });
for (const [id, key, fmt] of [['wRiver', 'river', v => Math.round(v * TEX * TEX / 1000).toLocaleString() + ',000 m² gathered'], ['wWidth', 'width', v => v.toFixed(1) + '×'], ['wCarve', 'carve', v => v.toFixed(1) + ' m'], ['wChannel', 'channel', v => Math.round((2 * v + 1) * TEX) + ' m across'], ['wPondDepth', 'pondDepth', v => v.toFixed(2) + ' m'], ['wPondMin', 'pondMin', v => Math.round(v * TEX * TEX) + ' m²'], ['wOutlet', 'outlet', v => v.toFixed(0) + ' m']]) {
  const el = $(id); el.value = WATER[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); }); el.addEventListener('change', () => { WATER[key] = +el.value; reshape(); });
}
$('wOn').checked = WATER.on; $('wOn').addEventListener('change', e => { WATER.on = e.target.checked; U.waterOn.value = WATER.on ? 1 : 0; reshape(); });
for (const [id, key, fmt] of [['wWave', 'wWave', v => v.toFixed(1) + ' m'], ['wSpeed', 'wSpeed', v => v.toFixed(2)], ['wSpec', 'wSpec', v => v.toFixed(2)], ['wReflect', 'wReflect', v => Math.round(v * 100) + '%'], ['wFroth', 'wFroth', v => Math.round(v * 100) + '%']]) {
  const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = fmt(+el.value); }; el.value = U[key].value; el.addEventListener('input', go); go();
}
for (const [id, key] of [['wDeepC', 'wDeep'], ['wShallowC', 'wShallow']]) { const el = $(id); el.value = '#' + U[key].value.clone().convertLinearToSRGB().getHexString(); el.addEventListener('input', () => { U[key].value.set(el.value).convertSRGBToLinear(); }); }
function reshape() { $('shapeInfo').textContent = 'shaping…'; setTimeout(() => { const t0 = performance.now(); buildHeights(); shapeMesh(); buildLand(); $('shapeInfo').textContent = `shaped in ${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 30); }
for (const [id, key] of [['terraceOn', 'terraceOn'], ['erodeOn', 'erodeOn']]) { $(id).checked = SHAPE[key]; $(id).addEventListener('change', e => { SHAPE[key] = e.target.checked; reshape(); }); }
for (const [id, key, fmt] of [['tStep', 'step', v => v.toFixed(1) + ' m'], ['tRiser', 'riser', v => Math.round(v * 100) + '% of a step'], ['tAmount', 'terraceAmount', v => Math.round(v * 100) + '%'], ['tSpread', 'terraceSpread', v => Math.round(v * 100) + '% of the land'], ['tFrom', 'terraceFrom', v => 'steeper than ' + Math.round(Math.atan(v) * 180 / Math.PI) + '°'], ['eDrops', 'drops', v => v.toLocaleString()], ['eStr', 'erodeStrength', v => v.toFixed(2)], ['rPasses', 'ravines', v => v + (v === 1 ? ' pass' : ' passes')], ['rStr', 'ravineStrength', v => v.toFixed(1) + '×'], ['rScale', 'ravineScale', v => 'water gathers on ' + (v * TEX).toFixed(1) + ' m cells'], ['rRound', 'ravineRound', v => Math.round(v * 100) + '%'], ['cCrags', 'crags', v => v + ' m'], ['cCragSize', 'cragSize', v => v + ' m'], ['cCragSharp', 'cragSharp', v => Math.round(v * 100) + '%']]) {
  const el = $(id); el.value = SHAPE[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { SHAPE[key] = +el.value; reshape(); });
}
$('rainGo').onclick = () => { camera.position.set(0, 520, 420); controls.target.set(0, 0, 0); controls.update(); startRain(); };
$('rainPause').onclick = () => { if (!RAIN.gen) return; RAIN.paused = !RAIN.paused; $('rainPause').textContent = RAIN.paused ? 'go on' : 'pause'; };
$('rainStop').onclick = () => { if (!RAIN.gen) return; while (!RAIN.gen.next().done); endRain('finished'); };
{ const el = $('rainSpeed'), go = () => { RAIN.perFrame = +el.value; $('rainSpeedOut').textContent = (+el.value).toLocaleString() + ' drops a frame'; }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['gullyStr', 'gullyStr'], ['fanStr', 'fanStr'], ['strataStr', 'strataStr']]) { const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = Math.round(+el.value * 100) + '%'; }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['lushTint', 'lushTint'], ['dampTint', 'dampTint'], ['slopeTint', 'slopeTint']]) { const el = $(id); el.value = '#' + U[key].value.clone().convertLinearToSRGB().getHexString(); el.addEventListener('input', () => { U[key].value.set(el.value).convertSRGBToLinear(); calmCover(); }); }
{ const el = $('strataSize'), go = () => { U.strataSize.value = +el.value; $('strataSizeOut').textContent = (+el.value).toFixed(1) + ' m'; }; el.addEventListener('input', go); go(); }
// ── the forest's settings: distances apply at once, the atlas and leaf detail re-bake ──
for (const [id, key, fmt, live] of [['fImp', 'imposterAt', v => v + ' m', true], ['fBand', 'band', v => v + ' m', true], ['fAhead', 'ahead', v => Math.round(v * 100) + '% ahead', true], ['fGrid', 'grid', v => v + ' × ' + v, false], ['fCell', 'cell', v => v + ' px', false]]) {
  const el = $(id); el.value = FOREST[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); if (live) { FOREST[key] = +el.value; if (treeForest) { treeForest[key] = FOREST[key]; treeForest.assignDirty = true; } } });
  if (!live) el.addEventListener('change', () => { FOREST[key] = +el.value; FOREST.rebake = true; placeTrees(); atlasInfo(); });
}
$('fDetail').value = FOREST.detail; $('fDetail').addEventListener('change', e => { FOREST.detail = e.target.value; FOREST.rebake = true; placeTrees(); });
function atlasInfo() { const e = FOREST.grid * FOREST.cell, mb = e * e * 4 / 1048576; $('fAtlasInfo').textContent = `each species: a ${e} × ${e} atlas, ${mb.toFixed(0)} MB colour + ${mb.toFixed(0)} MB normal and depth; ${TREE_SPECIES.length} species = ${(mb * 2 * TREE_SPECIES.length).toFixed(0)} MB. Plants: 8 × 8 of 128 px, 8 MB each.`; }
atlasInfo();
// the atlas viewer: one species' colour atlas in the corner
const atlasCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1), atlasScene = new THREE.Scene(), atlasQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
atlasQuad.position.z = -0.5; atlasScene.add(atlasQuad);
function atlasChoices() { const el = $('fAtlasOf'), v = el.value; el.innerHTML = ''; for (const f of [treeForest, coverForest]) if (f) for (const sp of f.species) el.add(new Option(sp.name, sp.name)); if (v) el.value = v; }
$('fAtlasOf').addEventListener('focus', atlasChoices);
function drawAtlas() {
  if (!$('fAtlasOn').checked) return;
  const name = $('fAtlasOf').value; let sp = null; for (const f of [treeForest, coverForest]) if (f) for (const x of f.species) if (x.name === name) sp = x;
  if (!sp || !sp.bake) return;
  atlasQuad.material.map = sp.bake.colour; atlasQuad.material.needsUpdate = true;
  const S = Math.min(innerWidth, innerHeight) * 0.42, px = renderer.getPixelRatio();
  renderer.setScissorTest(true); const y = innerHeight - S - 64; renderer.setViewport(12, y, S, S); renderer.setScissor(12, y, S, S);   // top left, under the readout renderer.autoClear = false; renderer.clearDepth();
  renderer.render(atlasScene, atlasCam); renderer.autoClear = true; renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
}
$('fAtlasOn').addEventListener('change', atlasChoices);
// WHAT COSTS WHAT: a second of frames with each part switched off in turn, from where you are looking
$('profile').onclick = async () => {
  const out = $('profileOut'); out.innerHTML = 'measuring…';
  const second = () => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(() => requestAnimationFrame(f)); });
  const toggles = [['everything on', () => {}, () => {}],
    ['no trees', () => treeForest && (treeForest.group.visible = false), () => treeForest && (treeForest.group.visible = $('treesOn').checked)],
    ['no plants', () => coverForest && (coverForest.group.visible = false), () => coverForest && (coverForest.group.visible = true)],
    ['no stamps', () => { U.stampOn.value = 0; }, () => { U.stampOn.value = $('stampOn').checked ? 1 : 0; }],
    ['no mixing', () => { U.mixOn.value = 0; }, () => { U.mixOn.value = $('mixOn').checked ? 1 : 0; }],
    ['no hex-tiling', () => { U.hexOn.value = 0; }, () => { U.hexOn.value = $('hexOn').checked ? 1 : 0; }],
    ['bare ground', () => { for (const k of ['stampOn', 'mixOn', 'hexOn', 'macroOn', 'farOn']) U[k].value = 0; if (treeForest) treeForest.group.visible = false; if (coverForest) coverForest.group.visible = false; },
                    () => { for (const k of ['stampOn', 'mixOn', 'hexOn', 'macroOn', 'farOn']) U[k].value = $(k).checked ? 1 : 0; if (treeForest) treeForest.group.visible = $('treesOn').checked; if (coverForest) coverForest.group.visible = true; }]];
  const rows = [];
  for (const [name, off, on] of toggles) { off(); const f = await second(); on(); rows.push(`<div><b>${f.toFixed(0)} fps</b> ${name} <span style="color:#6d7a85">(${(1000 / Math.max(1, f)).toFixed(1)} ms)</span></div>`); }
  out.innerHTML = rows.join('');
};
// the kinds' weights, as a running total for the shader to pick by
const KINDS = ['Leaves', 'Twigs and bark', 'Cones and needles', 'Stones', 'Moss and lichen', 'Mushrooms', 'Small plants', 'Grass tufts'];
const MIXES = {
  'Forest floor': [5, 2, 3, 1, 2, 0.4, 1, 0.5], 'Pine forest': [0.5, 2, 5, 1, 2, 0.3, 0.5, 0.5],
  'Meadow': [0.2, 0.2, 0, 1, 0.5, 0.1, 3, 6], 'Rocky': [0.3, 1, 0.3, 6, 3, 0, 0.3, 1],
};
const weights = [...MIXES['Forest floor']];
function applyWeights() { const t = weights.reduce((a, b) => a + b, 0) || 1; let run = 0; for (let k = 0; k < 8; k++) { run += weights[k] / t; U.stampCum.value[k] = run; } U.stampCum.value[7] = 1.0001; }
for (let k = 0; k < 8; k++) {
  const d = document.createElement('div'); d.className = 'row';
  d.innerHTML = `<label for="kind${k}">${KINDS[k]}</label><output id="kind${k}Out"></output><input id="kind${k}" type="range" min="0" max="6" step="0.1">`;
  $('kinds').appendChild(d);
  const el = d.querySelector('input'); el.addEventListener('input', () => { weights[k] = +el.value; $(`kind${k}Out`).textContent = weights[k].toFixed(1); applyWeights(); });
}
const showWeights = () => { for (let k = 0; k < 8; k++) { $(`kind${k}`).value = weights[k]; $(`kind${k}Out`).textContent = weights[k].toFixed(1); } applyWeights(); };
for (const [n, w] of Object.entries(MIXES)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.onclick = () => { weights.splice(0, 8, ...w); showWeights(); }; $('mixes').appendChild(b); }
showWeights();
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };

// the split line
let splitX = 0.5;
const placeSplit = () => { const on = $('splitOn').checked; $('split').style.display = on ? '' : 'none'; $('split').style.left = (splitX * 100) + '%'; U.split.value = on ? splitX : 0; };
$('splitOn').addEventListener('change', placeSplit); placeSplit();
{ let drag = false; $('split').addEventListener('pointerdown', (e) => { drag = true; $('split').setPointerCapture(e.pointerId); e.stopPropagation(); });
  $('split').addEventListener('pointermove', (e) => { if (!drag) return; splitX = THREE.MathUtils.clamp(e.clientX / innerWidth, 0, 1); placeSplit(); });
  $('split').addEventListener('pointerup', () => { drag = false; }); }

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(U.res.value); });
renderer.getDrawingBufferSize(U.res.value);
// switching tier while running: the panel's controls are set and fired, as if moved by hand
function applyTier(tier) {
  const T = TIER_SET[tier]; renderer.setPixelRatio(Math.min(devicePixelRatio, T.ratio)); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(U.res.value);
  const set = (id, v) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') { if (el.checked !== v) { el.checked = v; el.dispatchEvent(new Event('change')); } } else if (String(el.value) !== String(v)) { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); } };
  for (const [id, v] of Object.entries(T.checks)) set(id, v);
  for (const [id, k] of [['fImp', 'imposterAt'], ['fBand', 'band'], ['fGrid', 'grid'], ['fCell', 'cell'], ['fDetail', 'detail']]) set(id, T.forest[k]);
  for (const [id, k] of [['coverNear', 'near'], ['coverRadius', 'radius'], ['coverCount', 'count']]) set(id, T.cover[k]);
  set('stampFar', T.u.stampFar);
}
function showTier() { $('qTier').value = QUAL.source === 'detected' ? 'auto' : QUAL.tier; $('qWhy').textContent = `${QUAL.tier} (${QUAL.source === 'detected' ? 'picked automatically: ' + QUAL.why : QUAL.why})`; }
$('qTier').addEventListener('change', e => { const v = e.target.value; if (v === 'auto') { saveTier(null); location.reload(); return; } saveTier(v); QUAL.tier = v; QUAL.source = 'saved'; QUAL.why = 'your choice'; applyTier(v); showTier(); });
const watch = watchFrames(QUAL, (c) => { applyTier(c.tier); showTier(); });
showTier();
const clock = new THREE.Clock(); let fps = 60, shown = 0; renderer.info.autoReset = false;   // the readout counts the scene, not the atlas viewer
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (dt > 0) fps += (1 / dt - fps) * Math.min(1, dt * 2);
  watch();
  if ((shown += dt) > 0.5) { shown = 0; const inf = renderer.info.render; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${(1000 / Math.max(1, fps)).toFixed(1)} ms · ${inf.calls} draws · ${(inf.triangles / 1e6).toFixed(2)} M triangles · ${GL2 ? 'WebGL2' : 'WebGL1'}`; }
  renderer.info.reset(); stepRain(); controls.update(); followCover(); U.time.value += dt; sky.update(camera, dt); if (WIND.on) tickWind(dt); U.sunDirW.value.copy(SUN_DIR); followShadow();
  for (const f of [treeForest, coverForest]) if (f) {
    f.landU.landShade.value = U.shadeMap.value; f.landU.landShadeK.value.set(U.hillShade.value, U.aoShade.value, U.treeShade.value * 0.6, U.shadeMap.value ? 1 : 0);   // the land's baked shade, on the plants too
    f.update(camera, controls.target, camera.position, dt);
  }
  renderer.render(scene, camera); drawAtlas();
});
if (Q.has('probe')) Object.assign(window, { __placeLawn: placeLawn, __followCover: followCover, __cg: coverGround, __K: PLANT_KINDS, __G: GROW, groundShader: () => mat.userData.fs, WATER, POND, OUTLETS, reshape, THREE, scene, camera, controls, U, VIEWS, heightAt, LAND, buildLand, getTrees: () => trees, COVER, placeCover, getForests: () => [treeForest, coverForest] });
