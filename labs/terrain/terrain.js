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

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const GL2 = renderer.capabilities.isWebGL2;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xa9c8e4); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 150, 1400);   // the haze does its share of hiding the repeat far off
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b5a44, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-300, 400, -200); scene.add(sun);

// ── the land: hills from noise, then terraces, then erosion, on a 512 x 512 grid ──────────
// The grid (3.1 m a cell, the same cells the maps use) is the land: the mesh, the maps, the trees,
// the plants and the camera all read it through heightAt.
const SIZE = 1600, SEG = 511, N = 512, TEX = SIZE / N;
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function baseHeight(x, z) {
  let h = 0, amp = 1, f = 1 / 260;
  for (let i = 0; i < 5; i++) { h += (vnoise(x * f, z * f) - 0.5) * amp; amp *= 0.45; f *= 2.1; }
  const r = Math.hypot(x, z);
  return h * 55 * THREE.MathUtils.smoothstep(r, 60, 500) + h * 6;
}
const SHAPE = { terraceOn: true, step: 8, riser: 0.1, terraceAmount: 0.8, terraceSpread: 0.55, erodeOn: true, drops: 90000, erodeStrength: 0.35 };
const Hg = new Float32Array(N * N), FLOW = new Float32Array(N * N), SETTLE = new Float32Array(N * N);
const cellX = (i) => (i + 0.5) * TEX - SIZE / 2;
// TERRACES: the height is stepped - a flat top, then a short steep riser - where a slow noise says
// so (terraceSpread of the land), each step's level nudged by noise so the ledges wander
function terrace(h, x, z) {
  const where = THREE.MathUtils.smoothstep(vnoise(x / 190 + 70, z / 190 + 30), 1 - SHAPE.terraceSpread, 1.12 - SHAPE.terraceSpread);
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
function buildHeights() {
  FLOW.fill(0); SETTLE.fill(0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = cellX(i), z = cellX(j); let h = baseHeight(x, z); if (SHAPE.terraceOn) h = terrace(h, x, z); Hg[j * N + i] = h; }
  if (SHAPE.erodeOn) erode(Hg, SHAPE.drops);
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
const LAND = { wetDepth: 7, dryHeight: 6.0, forest: 0.55, shadeReach: 4, pathWidth: 2.2 };
let Hb = null;                                        // the ground's height averaged over about 40 m (per buildLand)
const slopeAt = (i, j) => { const a = Hg[j * N + Math.min(N - 1, i + 1)] - Hg[j * N + Math.max(0, i - 1)], b = Hg[Math.min(N - 1, j + 1) * N + i] - Hg[Math.max(0, j - 1) * N + i]; return Math.hypot(a, b) / (2 * TEX); };
let trees = [], maskA = null, pathCanvas = null; const MAPS = {};
function buildLand() {
  Hb = blur(Hg, 12);
  // wet and dry: how far below or above its surroundings each spot is
  const wet = new Float32Array(N * N), dry = new Float32Array(N * N), steep = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) { const d = Hb[k] - Hg[k]; wet[k] = Math.min(1, Math.max(0, d / LAND.wetDepth)); dry[k] = Math.min(1, Math.max(0, -d / LAND.dryHeight)); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) steep[j * N + i] = THREE.MathUtils.smoothstep(slopeAt(i, j), 0.35, 0.7);
  // trees: clumps from slow noise, thinned on wet and steep ground; one candidate every 6 m
  trees = []; const tree = new Float32Array(N * N);
  const clump = (x, z) => { let n = 0, a = 1, f = 1 / 230; for (let o = 0; o < 3; o++) { n += (vnoise(x * f + 40, z * f + 17) - 0.5) * a; a *= 0.5; f *= 2.2; } return n + 0.5; };
  for (let z = -SIZE / 2 + 3; z < SIZE / 2; z += 6) for (let x = -SIZE / 2 + 3; x < SIZE / 2; x += 6) {
    const jx = x + (hash(x, z) - 0.5) * 5, jz = z + (hash(z, x) - 0.5) * 5;
    const i = Math.min(N - 1, Math.max(0, Math.floor((jx + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((jz + SIZE / 2) / TEX))), k = j * N + i;
    const F = THREE.MathUtils.smoothstep(clump(jx, jz), 1 - LAND.forest * 0.6, 1.05 - LAND.forest * 0.6) * (1 - wet[k] * 0.9) * (1 - steep[k]);
    if (hash(jx * 1.3, jz * 0.7) < F * 0.85) { trees.push([jx, heightAt(jx, jz), jz, 0.8 + hash(jx, jz * 2) * 0.5]); tree[k] = 1; }
  }
  const canopy = blur(tree, 1), wide = blur(tree, LAND.shadeReach);
  for (let k = 0; k < N * N; k++) canopy[k] = Math.min(1, canopy[k] * 3.2);
  MAPS.wet = wet; MAPS.dry = dry; MAPS.canopy = canopy; MAPS.wide = wide; MAPS.steep = steep;
  // where the water ran (gullies) and where it laid soil down (fans), from the erosion, softened
  const fl = new Float32Array(N * N), se = new Float32Array(N * N);
  for (let q = 0; q < N * N; q++) { fl[q] = Math.min(1, Math.max(0, (Math.log(1 + FLOW[q]) - 2.2) / 2.5)); se[q] = Math.min(1, SETTLE[q] * 4); }
  const gully = blur(fl, 1), fan = blur(se, 2), dataB = new Uint8Array(N * N * 4);
  for (let q = 0; q < N * N; q++) { dataB[q * 4] = gully[q] * 255; dataB[q * 4 + 1] = Math.min(1, fan[q] * 2) * 255; dataB[q * 4 + 3] = 255; }
  if (!U.maskB.value) { const t = new THREE.DataTexture(dataB, N, N, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; U.maskB.value = t; } else U.maskB.value.image.data.set(dataB);
  U.maskB.value.needsUpdate = true;
  // paths: cheapest routes over the grid, where steep, wet and thick forest cost more
  const cost = new Float32Array(N * N); for (let k = 0; k < N * N; k++) cost[k] = 1 + 60 * steep[k] + 8 * wet[k] + 2 * canopy[k];
  const route = (ax, az, bx, bz) => {
    const S = N / 2, cell = (x, z) => [Math.round((x + SIZE / 2) / TEX), Math.round((z + SIZE / 2) / TEX)];
    const [si, sj] = cell(ax, az), [ti, tj] = cell(bx, bz), g = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), heap = [];
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
  placeTrees(); if (COVER.parts) placeCover();
}

// ── textures ────────────────────────────────────────────────────────────────────
const TEXTURES = ['forest', 'leaves', 'needles', 'moss', 'dirt', 'darkDirt', 'ferns', 'shrubs', 'grassMed', 'grassDry', 'grassDark', 'concrete', 'asphalt'];
const loader = new THREE.TextureLoader(), cache = {};
function tex(name) {
  if (!cache[name]) { const t = loader.load(`/textures/ground/${name}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); cache[name] = t; }
  return cache[name];
}
for (const n of TEXTURES) $('tex').add(new Option(n, n));
$('tex').value = 'grassMed';

// ── the ground material ────────────────────────────────────────────────────────
const U = {
  groundMap: { value: tex('grassMed') }, tile: { value: 3 }, split: { value: 0.5 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) },
  hexOn: { value: 1 }, hexSize: { value: 0.8 }, hexRot: { value: Math.PI }, hexSharp: { value: 7 }, hexBright: { value: 0.6 },
  macroOn: { value: 1 }, macroStr: { value: 0.55 }, macroSize: { value: 60 }, macroHue: { value: 0.5 },
  farOn: { value: 0 }, farFrom: { value: 40 }, grid: { value: 0 },
  // stamps: one object at most in each cell of a world grid, its kind drawn by the weights
  stampOn: { value: 1 }, stampAtlas: { value: null }, stampCell: { value: 0.55 }, stampDensity: { value: 0.55 }, stampSize: { value: 1 },
  stampCum: { value: [0, 0, 0, 0, 0, 0, 0, 0] }, stampBase: { value: [0.13, 0.28, 0.13, 0.16, 0.34, 0.12, 0.26, 0.4] },
  stampHue: { value: 0.35 }, stampShade: { value: 0.45 }, stampFar: { value: 30 },
  // mixing by the land: the masks, the layers' pictures, and how they meet
  mixOn: { value: 1 }, maskA: { value: null }, maskB: { value: null }, gullyStr: { value: 0.8 }, fanStr: { value: 0.45 }, strataStr: { value: 0.8 }, strataSize: { value: 1.6 }, lushTint: { value: new THREE.Color(0.86, 1.0, 0.8) }, dampTint: { value: new THREE.Color(0.78, 0.92, 0.76) }, pathMap: { value: null }, landSize: { value: SIZE }, view: { value: 0 },
  layDry: { value: null }, layLush: { value: null }, layForest: { value: null }, layWet: { value: null }, layPath: { value: null }, laySteep: { value: null },
  mixSharp: { value: 6 }, mixHeight: { value: 1.2 }, mixBreak: { value: 0.35 }, mixBreakSize: { value: 4 }, steepFrom: { value: 0.35 },
};
{ const t = new THREE.TextureLoader().load('/textures/stamps/atlas.png'); t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); U.stampAtlas.value = t; }
const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
if (GL2) mat.defines = { HEX_GRAD: '' };        // WebGL 2 can give each turned read its own true gradients (no seams); WebGL 1 lets the blend hide them
mat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = 'varying vec3 vW; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
  sh.fragmentShader = `
    uniform sampler2D groundMap; uniform float tile, split; uniform vec2 res;
    uniform float hexOn, hexSize, hexRot, hexSharp, hexBright, macroOn, macroStr, macroSize, macroHue, farOn, farFrom, grid;
    uniform float stampOn, stampCell, stampDensity, stampSize, stampHue, stampShade, stampFar; uniform float stampCum[8]; uniform float stampBase[8]; uniform sampler2D stampAtlas;
    uniform float mixOn, landSize, view, mixSharp, mixHeight, mixBreak, mixBreakSize, steepFrom; uniform sampler2D maskA; uniform sampler2D maskB; uniform float gullyStr, fanStr, strataStr, strataSize; uniform vec3 lushTint, dampTint; uniform sampler2D pathMap;
    uniform sampler2D layDry; uniform sampler2D layLush; uniform sampler2D layForest; uniform sampler2D layWet; uniform sampler2D layPath; uniform sampler2D laySteep;
    varying vec3 vWN;
    varying vec3 vW;
    float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.1 + 3.3) + 0.0625 * vn(p * 8.3 + 1.7); }
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
    vec3 lay(sampler2D t, vec2 uv, vec2 off) { return mix(texture2D(t, uv + off).rgb, texture2D(t, uv * 0.31 + off * 1.7).rgb, 0.35); }
    // TRIPLANAR: on a steep face a texture laid from above is smeared down it; this reads it from the
    // side as well (along x and along z) and blends by which way the ground faces
    vec3 lay3(sampler2D t, vec3 p, vec3 n, float scale) {
      vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
      return texture2D(t, p.zy / scale).rgb * w.x + texture2D(t, p.xz / scale).rgb * w.y + texture2D(t, p.xy / scale).rgb * w.z;
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
    if (plain || hexOn < 0.5) g = texture2D(groundMap, uv).rgb; else g = hexTile(uv);
    if (!plain && mixOn > 0.5) {
      // the land's maps here, each edge roughened by a little noise
      vec2 luv = vW.xz / landSize + 0.5;
      vec4 m = texture2D(maskA, luv); vec2 pth = texture2D(pathMap, luv).rg; vec2 er = texture2D(maskB, luv).rg;
      float bn = (fbm(vW.xz / mixBreakSize) - 0.5) * mixBreak, bn2 = (fbm(vW.xz / (mixBreakSize * 3.1) + 13.0) - 0.5) * mixBreak;
      float steep = smoothstep(steepFrom, steepFrom + 0.2, 1.0 - vWN.y);
      float wWet = clamp(m.r * 1.5 + bn, 0.0, 1.0), wMud = clamp(m.r * 2.2 - 1.3 + bn, 0.0, 1.0), wDry = clamp(m.g * 1.3 - 0.15 - m.b - m.a * 0.6 + bn2, 0.0, 1.0);
      float wLush = clamp(m.a * 1.4 + bn, 0.0, 1.0), wForest = clamp(m.b * 1.3 + bn2 * 0.7, 0.0, 1.0);
      float wPath = clamp(pth.r + bn * 0.5, 0.0, 1.0), wShoulder = clamp(pth.g * 1.5 + bn, 0.0, 1.0);
      vec3 dryC = lay(layDry, uv, vec2(0.13, 0.71)), lushC = lay(layLush, uv, vec2(0.61, 0.27)), forC = lay(layForest, uv * 1.3, vec2(0.37, 0.93));
      vec3 wetC = lay(layWet, uv, vec2(0.83, 0.41)), pathC = lay(layPath, uv * 1.6, vec2(0.29, 0.17));
      // the rock of a steep face: read from the side, in horizontal strata (bands of lighter and
      // darker, warmer and greyer layers that wander a little), darker in the overhanging parts
      vec3 steepC = lay3(laySteep, vW, normalize(vWN), tile * 0.8);
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
      g = over(g, steepC, steep);
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
        else v = vec3(er.g);
        g = v;
      }
    }
    if (!plain) {
      if (farOn > 0.5) {
        float k = smoothstep(farFrom, farFrom * 2.5, length(vW - cameraPosition));
        if (k > 0.001) { vec2 u2 = uv * 0.25 + vec2(0.37, 0.61); vec3 g2 = hexOn > 0.5 ? hexTile(u2) : texture2D(groundMap, u2).rgb; g = mix(g, mix(g, g2, 0.65), k); }
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
    }
    if (grid > 0.5) { vec2 f = abs(fract(uv + 0.5) - 0.5) / fwidth(uv); g = mix(g, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 1.5, min(f.x, f.y))); }
    diffuseColor.rgb *= g;
  `);
};
mat.customProgramCacheKey = () => 'terrain-lab-5' + (GL2 ? 'g' : '');
if (!GL2) mat.extensions = { derivatives: true };
const ground = new THREE.Mesh(geo, mat); scene.add(ground);
// THE TREES: the Tree Lab's forest (ez-tree species, meshes near, octahedral imposters beyond, a
// dithered crossfade between), planted where the canopy map grew them instead of on tiles
const SUN_DIR = sun.position.clone().normalize();
const TREE_SPECIES = FOREST_SPECIES.filter(sp => sp.name !== 'bush');
// the Tree Lab's settings, now here (Jacob's defaults, 2026-09-23)
const FOREST = { imposterAt: 150, band: 120, ahead: 0.6, grid: 12, cell: 192, detail: 'sparse', rebake: false };
let treeForest = null;
function placeTrees() {
  if (treeForest) { scene.remove(treeForest.group); for (const b of treeForest.built) { b.imposter.geometry.dispose(); b.meshes.forEach(m => m.dispose()); } }
  const species = treeForest && !FOREST.rebake ? treeForest.species : TREE_SPECIES.map(sp => ({ ...sp }));   // keeps the baked atlases unless the atlas settings changed
  FOREST.rebake = false;
  treeForest = new Forest(renderer, scene, { species, detail: FOREST.detail, grid: FOREST.grid, cell: FOREST.cell, imposterAt: FOREST.imposterAt, band: FOREST.band, ahead: FOREST.ahead, sunDir: SUN_DIR, heightAt, nearCap: 600,
    fixed: trees.map(([x, , z, s]) => ({ x, z, sp: Math.floor(hash(x * 0.37, z * 0.71) * species.length), scale: s })) });
  treeForest.group.visible = $('treesOn').checked;
  $('landInfo').textContent = `${trees.length.toLocaleString()} trees, 4 paths`;
}
// ── GROUND COVER: Jacob's Tripo sheet of 16 plants, split into its plants and scattered by the maps ──
// The model stands the plants in a 4 x 4 wall (x across, y up); each triangle goes to the plant whose
// cell its middle is in, and each plant becomes one instanced mesh (16 draws for all of them).
// Grasses go in the open and in part shade, shrubs along the forest's edge and a few inside it,
// nothing on paths, steep or muddy ground.
const COVER = { on: true, count: 8000, radius: 140, size: 3.2, near: 35, parts: null, meshes: [], longOn: true, longCount: 3000, longSize: 3.0, long: null };   // ~5 M triangles to start: the readout says what more costs
const GRASSES = [0, 1, 4, 8, 10, 12, 14];
// a Tripo sheet: its plants stand in a grid x grid wall (x across, y up); each triangle goes to the plant
// whose cell its middle is in, and each plant is stood on its own base. Lit like the ground: every
// normal points up, and the back of a card keeps it (so no plant is black from behind).
function loadSheet(url, grid, done) {
  new GLTFLoader().load(url, (g) => {
    let src = null; g.scene.traverse(o => { if (o.isMesh && !src) src = o; }); if (!src) return;
    src.updateMatrixWorld(true);
    const geo0 = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone(); geo0.applyMatrix4(src.matrixWorld);
    geo0.computeBoundingBox(); const bb = geo0.boundingBox, pos = geo0.attributes.position, cw = (bb.max.x - bb.min.x) / grid, ch = (bb.max.y - bb.min.y) / grid;
    const buckets = Array.from({ length: grid * grid }, () => []);
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      buckets[Math.min(grid - 1, Math.floor((bb.max.y - cy) / ch)) * grid + Math.min(grid - 1, Math.floor((cx - bb.min.x) / cw))].push(t);
    }
    const attrs = Object.keys(geo0.attributes);
    const parts = buckets.map(tris => {
      const gg = new THREE.BufferGeometry();
      for (const a of attrs) { const A = geo0.attributes[a], n = A.itemSize, arr = new Float32Array(tris.length * 3 * n); tris.forEach((t, q) => { for (let v = 0; v < 3; v++) for (let c = 0; c < n; c++) arr[(q * 3 + v) * n + c] = A.array[(t + v) * n + c]; }); gg.setAttribute(a, new THREE.BufferAttribute(arr, n)); }
      gg.computeBoundingBox(); const b = gg.boundingBox; gg.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      const nr = gg.attributes.normal; if (nr) { for (let q = 0; q < nr.count; q++) nr.setXYZ(q, 0, 1, 0); }
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
const PLANT_HEIGHT = (sheet, k) => sheet === 'long' ? 1.1 : GRASSES.includes(k) ? 0.55 : 0.85;
function plantSpecies(parts, material, sheet) {
  return parts.map((g, k) => { const root = new THREE.Group(); root.add(new THREE.Mesh(g, material)); return { name: sheet + k, root, height: PLANT_HEIGHT(sheet, k), weight: 1, grid: 8, cell: 128, upNormals: true, tint: false }; });
}
loadSheet('/models/props/grassBushes.glb', 4, (parts, m) => { COVER.parts = parts; COVER.material = m; COVER.plantSp = plantSpecies(parts, m, 'plant'); placeCover(); });
loadSheet('/models/props/longGrass.glb', 3, (parts, m) => { COVER.long = { parts, material: m }; COVER.longSp = plantSpecies(parts, m, 'long'); placeCover(); });
let coverForest = null;
function placeCover() {
  for (const im of COVER.meshes) { scene.remove(im); im.dispose(); }
  COVER.meshes = [];
  if (!COVER.parts || !COVER.long || !MAPS.wet) return;
  const fixed = [];
  const r = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
  const spots = Array.from({ length: 16 }, () => []), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let tries = 0, placed = 0;
  while (placed < COVER.count && tries < COVER.count * 12) {
    tries++;
    const ang = r(tries, 1.7) * Math.PI * 2, dist = Math.sqrt(r(tries, 3.1)) * COVER.radius, x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const i = Math.min(N - 1, Math.max(0, Math.floor((x + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((z + SIZE / 2) / TEX))), k = j * N + i;
    const pi = Math.floor((x + SIZE / 2) / SIZE * MAPS.P), pj = Math.floor((z + SIZE / 2) / SIZE * MAPS.P), path = MAPS.path[(pj * MAPS.P + pi) * 4] / 255 + MAPS.path[(pj * MAPS.P + pi) * 4 + 1] / 510;
    const canopy = MAPS.canopy[k], shade = Math.min(1, Math.max(0, MAPS.wide[k] * 2.2 - canopy * 0.8)), open = 1 - Math.min(1, canopy + shade);
    const blocked = path + MAPS.steep[k] + Math.max(0, MAPS.wet[k] - 0.6) * 2;
    const wantGrass = (0.55 * open + 1.0 * shade + 0.15 * canopy) * (1 - MAPS.dry[k] * 0.4), wantShrub = 0.08 * open + 0.9 * shade + 0.35 * canopy;
    const total = wantGrass + wantShrub; if (r(tries, 5.3) > total * 0.9 * (1 - Math.min(1, blocked))) continue;
    const grass = r(tries, 7.7) < wantGrass / total;
    const pool = grass ? GRASSES : [...Array(16).keys()].filter(n => !GRASSES.includes(n)), kind = pool[Math.floor(r(tries, 9.1) * pool.length)];
    const s = COVER.size * (grass ? 0.8 : 1.1) * (0.7 + 0.6 * r(tries, 11.3));
    fixed.push({ x, z, sp: kind, scale: s / (COVER.size * (grass ? 0.8 : 1.1)) * COVER.size / 3.2, yaw: r(tries, 13.7) * 6.283 });
    placed++;
  }

  // the long grasses: out in the open and on dry rises, thinning at the forest and gone in it
  let longPlaced = 0;
  if (COVER.long) {
    const L = COVER.long, ls = Array.from({ length: L.parts.length }, () => []);
    for (let t2 = 1; longPlaced < COVER.longCount && t2 < COVER.longCount * 12; t2++) {
      const ang = r(t2, 21.7) * Math.PI * 2, dist = Math.sqrt(r(t2, 23.1)) * COVER.radius, x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      const i = Math.min(N - 1, Math.max(0, Math.floor((x + SIZE / 2) / TEX))), j = Math.min(N - 1, Math.max(0, Math.floor((z + SIZE / 2) / TEX))), k = j * N + i;
      const pi = Math.floor((x + SIZE / 2) / SIZE * MAPS.P), pj = Math.floor((z + SIZE / 2) / SIZE * MAPS.P), path = MAPS.path[(pj * MAPS.P + pi) * 4] / 255 + MAPS.path[(pj * MAPS.P + pi) * 4 + 1] / 510;
      const want = (0.35 + 0.65 * MAPS.dry[k]) * (1 - Math.min(1, MAPS.canopy[k] * 1.5 + MAPS.wide[k])) * (1 - Math.min(1, path + MAPS.steep[k] + MAPS.wet[k]));
      if (r(t2, 25.3) > want) continue;
      // clumps: a few together
      const kind = Math.floor(r(Math.floor(x / 9), Math.floor(z / 9) + 31.1) * L.parts.length) % L.parts.length, sc = COVER.longSize * (0.75 + 0.5 * r(t2, 27.9));
      fixed.push({ x, z, sp: 16 + kind, scale: sc / 3.0, yaw: r(t2, 29.3) * 6.283 });
      longPlaced++;
    }
  }
  // one Forest for all of them: meshes out to COVER.near, imposters beyond, crossfaded
  if (coverForest) { scene.remove(coverForest.group); for (const b of coverForest.built) { b.imposter.geometry.dispose(); b.meshes.forEach(m => m.dispose()); } }
  const species = coverForest ? coverForest.species : [...COVER.plantSp, ...COVER.longSp];
  const use = fixed.filter(f => (f.sp < 16 ? COVER.on : COVER.longOn));
  coverForest = new Forest(renderer, scene, { species, fixed: use, heightAt, imposterAt: COVER.near, band: COVER.near * 0.5, ahead: 0.5, sunDir: SUN_DIR, nearCap: 3000 });
  $('coverInfo').textContent = `${placed.toLocaleString()} plants and ${longPlaced.toLocaleString()} long grasses: meshes to ${COVER.near} m, imposters beyond (atlases bake over the first seconds)`;
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
};
for (const [id, [apply, fmt]] of Object.entries(SL)) { const el = $(id), go = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['hexOn', 'hexOn'], ['macroOn', 'macroOn'], ['farOn', 'farOn'], ['grid', 'grid'], ['stampOn', 'stampOn'], ['mixOn', 'mixOn']]) { const el = $(id), go = () => { U[key].value = el.checked ? 1 : 0; }; el.addEventListener('change', go); go(); }
$('tex').addEventListener('change', () => { U.groundMap.value = tex($('tex').value); });
// the layers' pictures, and the land's settings (these rebuild the maps)
const LAYERS = { layDry: 'grassDry', layLush: 'grassMed', layForest: 'forest', layWet: 'darkDirt', layPath: 'dirt', laySteep: 'concrete' };
for (const [id, def] of Object.entries(LAYERS)) { const el = $(id); for (const n of TEXTURES) el.add(new Option(n, n)); el.value = def; const go = () => { U[id].value = tex(el.value); }; el.addEventListener('change', go); go(); }
for (const [id, key, fmt] of [['landWet', 'wetDepth', v => v.toFixed(1) + ' m'], ['landDry', 'dryHeight', v => v.toFixed(1) + ' m'], ['landForest', 'forest', v => Math.round(v * 100) + '%'], ['landShade', 'shadeReach', v => Math.round(v * TEX) + ' m'], ['landPath', 'pathWidth', v => v.toFixed(1) + ' m']]) {
  const el = $(id); el.value = LAND[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { LAND[key] = +el.value; buildLand(); });
}
$('mixView').addEventListener('change', e => { U.view.value = +e.target.value; });
$('treesOn').addEventListener('change', e => { if (treeForest) treeForest.group.visible = e.target.checked; });
$('coverOn').addEventListener('change', e => { COVER.on = e.target.checked; placeCover(); });
$('longOn').addEventListener('change', e => { COVER.longOn = e.target.checked; placeCover(); });
for (const [id, key, fmt] of [['coverCount', 'count', v => v.toLocaleString()], ['coverRadius', 'radius', v => v + ' m'], ['coverSize', 'size', v => v.toFixed(1) + '×'], ['longCount', 'longCount', v => v.toLocaleString()], ['longSize', 'longSize', v => v.toFixed(1) + '×'], ['coverNear', 'near', v => v + ' m']]) {
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
function fastMesh() { const p = geo.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, Hg[k]); p.needsUpdate = true; geo.computeVertexNormals(); }
function endRain(msg) { RAIN.gen = null; trailLines.visible = false; fastMesh(); buildLand(); if (treeForest) treeForest.group.visible = $('treesOn').checked; $('shapeInfo').textContent = msg; }
function startRain() {
  FLOW.fill(0); SETTLE.fill(0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = cellX(i), z = cellX(j); let h = baseHeight(x, z); if (SHAPE.terraceOn) h = terrace(h, x, z); Hg[j * N + i] = h; }
  fastMesh();
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
function reshape() { $('shapeInfo').textContent = 'shaping…'; setTimeout(() => { const t0 = performance.now(); buildHeights(); shapeMesh(); buildLand(); $('shapeInfo').textContent = `shaped in ${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 30); }
for (const [id, key] of [['terraceOn', 'terraceOn'], ['erodeOn', 'erodeOn']]) { $(id).checked = SHAPE[key]; $(id).addEventListener('change', e => { SHAPE[key] = e.target.checked; reshape(); }); }
for (const [id, key, fmt] of [['tStep', 'step', v => v.toFixed(1) + ' m'], ['tRiser', 'riser', v => Math.round(v * 100) + '% of a step'], ['tAmount', 'terraceAmount', v => Math.round(v * 100) + '%'], ['tSpread', 'terraceSpread', v => Math.round(v * 100) + '% of the land'], ['eDrops', 'drops', v => v.toLocaleString()], ['eStr', 'erodeStrength', v => v.toFixed(2)]]) {
  const el = $(id); el.value = SHAPE[key]; $(id + 'Out').textContent = fmt(+el.value);
  el.addEventListener('input', () => { $(id + 'Out').textContent = fmt(+el.value); });
  el.addEventListener('change', () => { SHAPE[key] = +el.value; reshape(); });
}
$('rainGo').onclick = () => { camera.position.set(0, 520, 420); controls.target.set(0, 0, 0); controls.update(); startRain(); };
$('rainPause').onclick = () => { if (!RAIN.gen) return; RAIN.paused = !RAIN.paused; $('rainPause').textContent = RAIN.paused ? 'go on' : 'pause'; };
$('rainStop').onclick = () => { if (!RAIN.gen) return; while (!RAIN.gen.next().done); endRain('finished'); };
{ const el = $('rainSpeed'), go = () => { RAIN.perFrame = +el.value; $('rainSpeedOut').textContent = (+el.value).toLocaleString() + ' drops a frame'; }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['gullyStr', 'gullyStr'], ['fanStr', 'fanStr'], ['strataStr', 'strataStr']]) { const el = $(id), go = () => { U[key].value = +el.value; $(id + 'Out').textContent = Math.round(+el.value * 100) + '%'; }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['lushTint', 'lushTint'], ['dampTint', 'dampTint']]) { const el = $(id); el.value = '#' + U[key].value.clone().convertLinearToSRGB().getHexString(); el.addEventListener('input', () => { U[key].value.set(el.value).convertSRGBToLinear(); }); }
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
const clock = new THREE.Clock(); let fps = 60, shown = 0; renderer.info.autoReset = false;   // the readout counts the scene, not the atlas viewer
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (dt > 0) fps += (1 / dt - fps) * Math.min(1, dt * 2);
  if ((shown += dt) > 0.5) { shown = 0; const inf = renderer.info.render; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${(1000 / Math.max(1, fps)).toFixed(1)} ms · ${inf.calls} draws · ${(inf.triangles / 1e6).toFixed(2)} M triangles · ${GL2 ? 'WebGL2' : 'WebGL1'}`; }
  renderer.info.reset(); stepRain(); controls.update();
  for (const f of [treeForest, coverForest]) if (f) f.update(camera, controls.target, camera.position, dt);
  renderer.render(scene, camera); drawAtlas();
});
if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, U, VIEWS, heightAt, LAND, buildLand, getTrees: () => trees, COVER, placeCover, getForests: () => [treeForest, coverForest] });
