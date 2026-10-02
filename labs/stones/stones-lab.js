// STONE LAB: ways to pave the town's roads with irregular stones, compared side by side. A square with
// four roads leaving it; each road, with its quarter of the square, is paved by its own build:
// painted on the ground only, or real 3D stones in one of several shapes sitting on their painted copies.
// The stone layout, the 3D builds and the shader are src/objects/stones.js, for the Terrain Lab to share.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { chooseTier } from '../../src/quality.js';
import { stoneField, stoneGeometry, stoneTris, STONE_UNIFORMS, STONE_GLSL } from '../../src/objects/stones.js';

const $ = (id) => document.getElementById(id);
const KEY = 'jconra.stoneLab';
// QUALITY: drawn only when something changes. The tier sets the drawing resolution and the shadow detail.
const TIER_SET = { potato: { ratio: 0.75, shadow: 1024 }, normal: { ratio: 1.5, shadow: 2048 }, gaming: { ratio: 2, shadow: 4096 } };
const TOWN_PAVING = 3400;                                             // m² of road and square in the first town

// ── the builds ────────────────────────────────────────────────────────────────────────────
const BUILD_DEFAULTS = {
  A: { name: 'Painted only', painted: true },
  B: { name: 'Slab', top: 4, per: 1, round: 0, bevel: 0.06, height: 0.03, dome: 0, soft: true, uneven: 0.3 },
  C: { name: 'Cut corners', top: 4, per: 2, round: 0.5, bevel: 0.07, height: 0.03, dome: 0, soft: true, uneven: 0.3 },
  D: { name: 'Pillow', top: 5, per: 1, round: 0, bevel: 0.08, height: 0.025, dome: 0.015, soft: true, uneven: 0.3 },
  E: { name: "Stone's own corners", top: 0, per: 1, round: 0, bevel: 0.06, height: 0.03, dome: 0, soft: true, uneven: 0.3 },
};
const BUILD_NOTES = {
  A: 'painted on the ground: no triangles',
  B: 'a four-cornered top, its sides sloping straight down to the ground',
  C: "Jacob's drawing: a four-cornered top on an eight-point footing (a point out from each corner, pulled in a little, and one out from each side's middle), so each stone reads rounder",
  D: 'a five-cornered top round a slightly raised middle: worn, bulging stone',
  E: 'every corner the stone has (about six)',
};
const ROADS = [{ name: 'North', ang: -Math.PI / 2 }, { name: 'East', ang: 0 }, { name: 'South', ang: Math.PI / 2 }, { name: 'West', ang: Math.PI }];
const roadOf = (x, z) => (((Math.round(Math.atan2(z, x) / (Math.PI / 2)) % 4) + 4) % 4 + 1) % 4;   // which road's quarter a spot is in

const DEFAULTS = {
  roads: ['A', 'E', 'C', 'D'],
  size: 0.45, jitter: 0.8, variety: 0.25, gap: 0.03, seed: 1,
  base: '#8d8a83', shade: 0.18, hue: 0.12, grain: 0.22, grainSize: 0.35, speck: 0.12, pic: 0, picScale: 1.5,
  soil: '#3a3126', moss: 0.35, edgeDark: 0.35, edgeWidth: 0.05,
  pRound: 0.06, pBevel: 0.03, pBevelW: 0.05,
  lod: 40, bevelDark: 0.25,
  roadW: 4.5, square: 9, wobble: 0.25, junction: 4, rag: 0.5,
  sunUp: 28, sunDir: 135, shadows: true,
  builds: BUILD_DEFAULTS,
};
const clone = (o) => JSON.parse(JSON.stringify(o));
function merged(saved) {                                              // the defaults, overlaid with whatever of them a saved copy has
  const S = clone(DEFAULTS);
  if (!saved || typeof saved !== 'object') return S;
  for (const k of Object.keys(S)) if (k !== 'builds' && k in saved && typeof saved[k] === typeof S[k]) S[k] = saved[k];
  if (Array.isArray(saved.roads) && saved.roads.length === 4 && saved.roads.every((b) => b in BUILD_DEFAULTS)) S.roads = saved.roads.slice();
  if (saved.builds) for (const b of Object.keys(S.builds)) if (saved.builds[b]) for (const k of Object.keys(S.builds[b])) if (k !== 'name' && k !== 'painted' && typeof saved.builds[b][k] === typeof S.builds[b][k]) S.builds[b][k] = saved.builds[b][k];
  return S;
}
let S = DEFAULTS;
try { S = merged(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { S = merged(null); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* no storage */ } };

// ── the road shape: a wobbly round square, four S-bending roads, softly joined ──────────────
const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, fu = u * u * (3 - 2 * u), fv = v * v * (3 - 2 * v);
  return (hash2(i, j) * (1 - fu) + hash2(i + 1, j) * fu) * (1 - fv) + (hash2(i, j + 1) * (1 - fu) + hash2(i + 1, j + 1) * fu) * fv;
}
const LEN = 34, WIDTHS = [1, 0.85, 1.1, 0.95];
const LINES = ROADS.map((r, k) => {                                    // each road's middle line, out from the centre
  const pts = [], c = Math.cos(r.ang), s = Math.sin(r.ang);
  for (let d = 0; d <= LEN; d += 1) { const t = Math.min(1, d / 10), off = 4 * Math.sin(d / LEN * Math.PI * 1.5 + k * 1.1) * t * t; pts.push([c * d - s * off, s * d + c * off]); }
  return pts;
});
function lineDist(x, z, pts) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
function roadDist(x, z) {                                              // < 0 inside the paving
  const a = Math.atan2(z, x), r = S.square * (1 + S.wobble * (0.55 * Math.sin(3 * a + 1.3) + 0.3 * Math.sin(5 * a + 0.4) + 0.15 * Math.sin(7 * a + 2.2)));
  let d = Math.hypot(x, z) - r;
  LINES.forEach((pts, k) => { d = smin(d, lineDist(x, z, pts) - S.roadW * WIDTHS[k] / 2, S.junction); });
  return d + (vnoise(x * 0.9 + 3.1, z * 0.9 - 1.7) - 0.5) * S.rag;
}

// ── the scene ─────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
const QUAL = chooseTier(renderer), TS = TIER_SET[QUAL.tier];
renderer.setPixelRatio(Math.min(devicePixelRatio, TS.ratio)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), SKY = new THREE.Color(0xb4cde3); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 70, 240);
scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x55603a, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.shadow.mapSize.set(TS.shadow, TS.shadow); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 90 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.01; scene.add(sun, sun.target);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 500);
const controls = new OrbitControls(camera, renderer.domElement); controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 140;
let want = true; const redraw = () => { want = true; };
controls.addEventListener('change', redraw);

// the shared settings for both shaders: one object, so a slider moves the painted and the 3D stones together
const tex = (url, rep = true) => { const t = new THREE.TextureLoader().load(url, redraw); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
const U = Object.assign(STONE_UNIFORMS(), {
  stoneBase: { value: new THREE.Color() }, stoneShade: { value: 0 }, stoneHue: { value: 0 }, grainAmt: { value: 0 }, grainSize: { value: 1 }, speckAmt: { value: 0 },
  picAmt: { value: 0 }, picScale: { value: 1 }, picAvg: { value: 0.25 }, rockPic: { value: tex('../../textures/ground/concrete.jpg') },
  soilCol: { value: new THREE.Color() }, mossAmt: { value: 0 }, edgeDark: { value: 0 }, edgeWidth: { value: 0.05 }, cornerRound: { value: 0 }, pBevel: { value: 0 }, pBevelW: { value: 0.05 }, gapW: { value: 0 },
  grassPic: { value: tex('../../textures/ground/grassMed.jpg') }, eyePos: { value: new THREE.Vector3() }, lodNear: { value: 40 }, bevelDark: { value: 0 },
  road3D: { value: new THREE.Vector4() },   // (lab only) 1 for each road whose stones are 3D
});
{ // the rock picture's average brightness, so it shifts each stone's grain without changing its colour
  const img = new Image(); img.src = '../../textures/ground/concrete.jpg';
  img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += 0.299 * (d[k] / 255) ** 2.2 + 0.587 * (d[k + 1] / 255) ** 2.2 + 0.114 * (d[k + 2] / 255) ** 2.2;
    U.picAvg.value = s / (d.length / 4); redraw(); };
}

// the ground: grass, and the painted stones
const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
groundMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = 'varying vec3 vStW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vStW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = `varying vec3 vStW;
    uniform sampler2D grassPic; uniform vec3 soilCol, eyePos; uniform vec4 road3D; uniform float mossAmt, edgeDark, edgeWidth, cornerRound, pBevel, pBevelW, gapW, lodNear;
    ` + STONE_GLSL + sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec3 stoneN = vec3(0.0, 1.0, 0.0);
      {
        vec2 p = vStW.xz; float dist = length(vStW - eyePos), far = smoothstep(6.0, 30.0, dist);
        vec3 col = pow(texture2D(grassPic, p / 2.5).rgb, vec3(2.2)); col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 0.7) * vec3(0.9, 0.95, 0.8);
        vec2 lo = stoneGrid.xy, hi = stoneGrid.xy + stoneGrid.z * stoneShape.x;
        if (p.x > lo.x && p.y > lo.y && p.x < hi.x && p.y < hi.y) {
          vec4 d; vec2 c; vec4 st = stoneAt(p, d, c);
          if (d.r > 0.25) {
            vec3 gapc = mix(soilCol, vec3(0.05, 0.08, 0.025), mossAmt * (0.4 + 0.6 * stNoise(p * 2.5)));
            col = gapc;
            if (d.r > 0.75) {
              // in from the stone's edge (its gap taken off), its corners rounded
              vec2 q = vec2(cornerRound) - (st.xy - gapW * 0.5);
              float e = cornerRound - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
              float on = smoothstep(-1.0, 1.0, e / (0.002 + dist * 0.0012));
              // a 3D stone stands here (near enough not to have sunk): leave the ground under it as gap
              vec2 sp = stPoint(c, d); float road = mod(mod(floor(atan(sp.y, sp.x) / 1.5708 + 0.5), 4.0) + 1.0, 4.0);
              float sunk = smoothstep(lodNear * 0.8, lodNear, length(sp - eyePos.xz));
              on *= 1.0 - dot(road3D, vec4(equal(vec4(road), vec4(0.0, 1.0, 2.0, 3.0)))) * (1.0 - smoothstep(0.15, 0.45, sunk));
              vec3 sc = stoneColour(p, d, c, far) * (1.0 - edgeDark * (1.0 - smoothstep(0.0, edgeWidth, e)));
              col = mix(gapc, sc, on);
              if (pBevel > 0.0) { float t = clamp(e / pBevelW, 0.0, 1.0), k = pBevel / pBevelW * 2.0 * (1.0 - t);
                stoneN = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(st.z * k, 1.0, st.w * k), on)); }
            }
          }
        }
        diffuseColor.rgb = col;
      }`)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(stoneN, 0.0)).xyz);');
};
groundMat.customProgramCacheKey = () => 'stone-ground-1';
const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true; scene.add(ground);

// the 3D stones: coloured exactly like their painted copies; past `lodNear` they sink into the ground
// (a stone's top reaches the ground about halfway through: by then its painted copy has faded in)
const LOD_GLSL = `
  float sunk = smoothstep(lodNear * 0.8, lodNear, length(transformed.xz - eyePos.xz));
  transformed.y = mix(transformed.y, -0.04, sunk);`;
const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
stoneMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = 'attribute vec2 aCell; attribute float aEdge; varying vec2 vCell; varying float vEdge; varying vec3 vStW; uniform vec3 eyePos; uniform float lodNear;\n' + sh.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCell = aCell; vEdge = aEdge;' + LOD_GLSL)
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vStW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = 'varying vec2 vCell; varying float vEdge; varying vec3 vStW; uniform vec3 eyePos; uniform float bevelDark;\n' + STONE_GLSL + sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
      { float far = smoothstep(6.0, 30.0, length(vStW - eyePos));
        diffuseColor.rgb = stoneColour(vStW.xz, stCell(vCell), vCell, far) * (1.0 - bevelDark * (1.0 - vEdge)); }`);
};
stoneMat.customProgramCacheKey = () => 'stone-3d-1';
const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });   // their shadows sink with them
depthMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, { eyePos: U.eyePos, lodNear: U.lodNear });
  sh.vertexShader = 'uniform vec3 eyePos; uniform float lodNear;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + LOD_GLSL);
};
depthMat.customProgramCacheKey = () => 'stone-depth-1';

// ── building ──────────────────────────────────────────────────────────────────────────────
let FIELD = null, MESHES = [], STATS = [], fieldMs = 0, geoMs = 0;
function buildField() {
  const t0 = performance.now();
  FIELD = stoneField({ size: S.size, jitter: S.jitter, variety: S.variety, gap: S.gap, seed: S.seed, x0: -42, z0: -42, width: 84, inside: (x, z) => roadDist(x, z) < 0 }, U);
  U.gapW.value = S.gap; fieldMs = performance.now() - t0;
}
function buildStones() {
  const t0 = performance.now();
  for (const m of MESHES) { scene.remove(m); m.geometry.dispose(); }
  MESHES = []; STATS = [];
  ROADS.forEach((r, k) => {                                           // one mesh a road, so each counts its own
    const b = S.roads[k], shape = S.builds[b];
    const st = { road: r.name, build: b, count: 0, tris: 0 };
    if (!shape.painted) {
      const g = stoneGeometry(FIELD, (s) => roadOf(s.x, s.z) === k ? shape : null);
      const m = new THREE.Mesh(g.geometry, stoneMat); m.castShadow = m.receiveShadow = true; m.customDepthMaterial = depthMat; m.frustumCulled = false;
      scene.add(m); MESHES.push(m); st.count = g.count; st.tris = g.tris;
    } else st.count = FIELD.stones.filter((s) => roadOf(s.x, s.z) === k).length;
    STATS.push(st);
  });
  U.road3D.value.set(...S.roads.map((b) => S.builds[b].painted ? 0 : 1));
  geoMs = performance.now() - t0;
  showStats(); redraw();
}
function applyLook() {
  U.stoneBase.value.set(S.base); U.stoneShade.value = S.shade; U.stoneHue.value = S.hue; U.grainAmt.value = S.grain; U.grainSize.value = S.grainSize; U.speckAmt.value = S.speck;
  U.picAmt.value = S.pic; U.picScale.value = S.picScale; U.soilCol.value.set(S.soil); U.mossAmt.value = S.moss; U.edgeDark.value = S.edgeDark; U.edgeWidth.value = S.edgeWidth;
  U.cornerRound.value = S.pRound; U.pBevel.value = S.pBevel; U.pBevelW.value = S.pBevelW; U.lodNear.value = S.lod; U.bevelDark.value = S.bevelDark;
  redraw();
}
function applyLight() {
  const el = S.sunUp * Math.PI / 180, az = S.sunDir * Math.PI / 180;
  sun.userData.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.castShadow = !!S.shadows; redraw();
}

// ── the numbers ───────────────────────────────────────────────────────────────────────────
const fmtK = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
function perStone(b) {                                                // triangles a stone, as built here (or estimated for a six-cornered one)
  const s = STATS.find((t) => t.build === b && t.tris > 0);
  return S.builds[b].painted ? 0 : s ? s.tris / s.count : stoneTris(S.builds[b], 6);
}
function showStats() {
  const townStones = TOWN_PAVING / (S.size * S.size), tris3D = STATS.reduce((a, s) => a + s.tris, 0);
  let h = `<b>${fmtK(FIELD.stones.length)}</b> stones here · <b>${fmtK(tris3D)}</b> 3D triangles<br>`;
  h += `The whole town at ${Math.round(S.size * 100)} cm: about <b>${fmtK(townStones)}</b> stones<br>`;
  for (const b of [...new Set(S.roads)].sort()) {
    const ps = perStone(b);
    h += `<b>${b}</b> ${S.builds[b].name}: ${ps ? ps.toFixed(1) + ' a stone · town ' + fmtK(ps * townStones) : 'none'}<br>`;
  }
  h += `<span style="color:#59656f">laid out in ${fieldMs.toFixed(0)} ms, built in ${geoMs.toFixed(0)} ms</span>`;
  $('stats').innerHTML = h;
  const t = S.builds[$('tuneBuild').value];
  if (t) $('buildTris').textContent = `${$('tuneBuild').value} · ${BUILD_NOTES[$('tuneBuild').value]}. A six-cornered stone takes ${stoneTris(t, 6)} triangles${perStone($('tuneBuild').value) && STATS.some((s) => s.build === $('tuneBuild').value) ? `; here they average ${perStone($('tuneBuild').value).toFixed(1)}` : ''}.`;
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────
const pct = (v) => Math.round(v * 100) + '%', cm = (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + ' cm', m = (v) => v.toFixed(1) + ' m';
const compass = (v) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(v / 45) % 8];
// [key, label, help, min, max, step, format, what it changes]; 'color' and 'check' rows have no range
const SPEC = {
  secShow: [['lod', '3D stones out to', 'beyond this they sink into the ground and the painted copy takes over', 4, 80, 1, (v) => v + ' m', 'look'],
    ['bevelDark', '3D: darken the sloping sides', 'a cheap shadow round each stone', 0, 0.8, 0.01, pct, 'look']],
  secField: [['size', 'Stone size', 'about how wide each stone is; bigger means fewer stones and fewer triangles', 0.2, 1.5, 0.01, cm, 'field'],
    ['jitter', 'How irregular', '0: a neat grid of near-squares; more: random shapes', 0, 0.9, 0.01, pct, 'field'],
    ['variety', 'Size variety', 'some stones take ground from their neighbours', 0, 0.45, 0.01, pct, 'field'],
    ['gap', 'Gap between stones', '', 0, 0.12, 0.002, cm, 'field']],
  secLook: [['base', 'Stone colour', '', 'color', 'look'],
    ['shade', 'Stone to stone: lighter and darker', '', 0, 0.5, 0.01, pct, 'look'],
    ['hue', 'Stone to stone: warmer and cooler', '', 0, 0.6, 0.01, pct, 'look'],
    ['grain', 'Grain across each stone (noise)', 'soft blotches, different on every stone', 0, 0.6, 0.01, pct, 'look'],
    ['grainSize', 'Grain size', '', 0.05, 1.5, 0.01, cm, 'look'],
    ['speck', 'Fine speckle (noise)', 'tiny flecks, faded out with distance', 0, 0.5, 0.01, pct, 'look'],
    ['pic', 'Rock picture, to compare', 'a plain stone photo, turned and shifted per stone (0: noise only)', 0, 1, 0.01, pct, 'look'],
    ['picScale', 'Rock picture size', '', 0.3, 4, 0.05, m, 'look'],
    ['soil', 'Gap colour', '', 'color', 'look'],
    ['moss', 'Moss in the gaps', '', 0, 1, 0.01, pct, 'look'],
    ['edgeDark', 'Darkened edges', 'each stone darker toward its edge', 0, 1, 0.01, pct, 'look'],
    ['edgeWidth', 'Darkened edge width', '', 0.005, 0.2, 0.005, cm, 'look']],
  secPaint: [['pRound', 'Corner rounding', '', 0, 0.2, 0.005, cm, 'look'],
    ['pBevel', 'Bevel, faked in the light', 'how far the edge seems to slope down (0: flat)', 0, 0.08, 0.002, cm, 'look'],
    ['pBevelW', 'Bevel width', '', 0.01, 0.2, 0.005, cm, 'look']],
  secRoad: [['roadW', 'Road width', '', 3, 8, 0.1, m, 'field'],
    ['square', 'Square size (across its middle)', '', 5, 14, 0.1, (v) => (v * 2).toFixed(0) + ' m', 'field'],
    ['wobble', 'Square: how far from round', '', 0, 0.5, 0.01, pct, 'field'],
    ['junction', 'Rounded corners where roads meet the square', '0: sharp corners', 0, 10, 0.1, m, 'field'],
    ['rag', 'Ragged edges', 'how far the edge wanders in and out', 0, 2, 0.01, m, 'field']],
  secLight: [['sunUp', 'Sun height', 'low sun shows the stones best', 3, 85, 1, (v) => v + '°', 'light'],
    ['sunDir', 'Sun from the', '', 0, 359, 1, compass, 'light'],
    ['shadows', 'Shadows', '', 'check', 'light']],
};
const BUILD_SPEC = [['top', 'Top corners', '0: as many as the stone has (about six)', 0, 8, 1, (v) => v ? String(v) : 'its own'],
  ['per', 'Footing points per corner', '1: straight out from each corner (a plain slab); 2: also out from each side\'s middle (rounder); 3: two along each side', 1, 3, 1, (v) => String(v)],
  ['round', 'Round the footing', 'pulls the footing\'s corner points in, so the stone reads rounder', 0, 1, 0.01, pct],
  ['bevel', 'Bevel width', 'how far in the flat top starts', 0, 0.2, 0.005, cm],
  ['height', 'Height above the ground', '', 0.005, 0.12, 0.001, cm],
  ['dome', 'Raised middle', '0: a flat top; more: the middle lifts and the top bulges (2 more triangles)', 0, 0.05, 0.001, cm],
  ['uneven', 'Unevenly laid', 'each stone a little higher or lower, a little tipped', 0, 1, 0.01, pct],
  ['soft', 'Soft shading (edges shade as curves, no extra triangles)', '', 'check']];

let fieldTimer = 0, geoTimer = 0;
const later = (fn, ms, which) => { if (which === 'field') { clearTimeout(fieldTimer); fieldTimer = setTimeout(fn, ms); } else { clearTimeout(geoTimer); geoTimer = setTimeout(fn, ms); } };
function changed(what) {
  save();
  if (what === 'look') applyLook();
  else if (what === 'light') applyLight();
  else if (what === 'field') later(() => { buildField(); buildStones(); }, 150, 'field');
  else if (what === 'geo') later(buildStones, 80, 'geo');
}
function row(host, id, label, help, min, max, step, fmt, get, set, what) {
  const div = document.createElement('div');
  const lab = `<label for="${id}">${label}${help ? `<small>${help}</small>` : ''}</label>`;
  if (min === 'color') { div.className = 'row'; div.innerHTML = lab + `<input id="${id}" type="color">`; }
  else if (min === 'check') { div.innerHTML = `<label class="check" for="${id}"><input id="${id}" type="checkbox"> ${label}</label>`; }
  else { div.className = 'row'; div.innerHTML = lab + `<output id="${id}Out"></output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}">`; }
  host.appendChild(div);
  const el = $(id), out = $(id + 'Out');
  const show = () => { const v = get(); if (min === 'check') el.checked = !!v; else { el.value = v; if (out) out.textContent = fmt(+v); } };
  el.addEventListener(min === 'check' ? 'change' : 'input', () => {
    const v = min === 'check' ? el.checked : min === 'color' ? el.value : +el.value;
    set(v); if (out) out.textContent = fmt(+v); changed(what);
  });
  return show;
}
const SHOWS = [];
for (const [sec, rows] of Object.entries(SPEC)) for (const [key, label, help, min, max, step, fmt, what] of rows)
  SHOWS.push(min === 'color' || min === 'check' ? row($(sec), key, label, help, min, null, null, null, () => S[key], (v) => { S[key] = v; }, max)
    : row($(sec), key, label, help, min, max, step, fmt, () => S[key], (v) => { S[key] = v; }, what));
const BUILD_KEYS = Object.keys(BUILD_DEFAULTS);
for (const b of BUILD_KEYS) if (b !== 'A') $('tuneBuild').insertAdjacentHTML('beforeend', `<option value="${b}">${b} · ${BUILD_DEFAULTS[b].name}</option>`);
$('tuneBuild').value = 'C';
const tuned = () => S.builds[$('tuneBuild').value];
// which build the sliders tune: picked here, by a road's label, by the road you stand on, or by giving a road a build
function tune(b) { if (!b || S.builds[b].painted) return; $('tuneBuild').value = b; syncPanel(); showStats(); placeTags(); }
for (const [key, label, help, min, max, step, fmt] of BUILD_SPEC)
  SHOWS.push(min === 'check' ? row($('secBuild'), 'b_' + key, label, help, 'check', null, null, null, () => tuned()[key], (v) => { tuned()[key] = v; }, 'geo')
    : row($('secBuild'), 'b_' + key, label, help, min, max, step, fmt, () => tuned()[key], (v) => { tuned()[key] = v; }, 'geo'));
$('tuneBuild').addEventListener('change', () => { syncPanel(); showStats(); placeTags(); });
$('buildReset').addEventListener('click', () => { const b = $('tuneBuild').value; S.builds[b] = clone(BUILD_DEFAULTS[b]); syncPanel(); changed('geo'); });
ROADS.forEach((r, k) => {
  $('roadPick').insertAdjacentHTML('beforeend', `<label for="road${k}">${r.name} road</label><select id="road${k}">${BUILD_KEYS.map((b) => `<option value="${b}">${b} · ${BUILD_DEFAULTS[b].name}</option>`).join('')}</select>`);
  $('road' + k).addEventListener('change', (e) => { S.roads[k] = e.target.value; changed('geo'); tune(S.roads[k]); });
});
function syncPanel() { SHOWS.forEach((f) => f()); ROADS.forEach((r, k) => { $('road' + k).value = S.roads[k]; }); }
$('reseed').addEventListener('click', () => { S.seed = (S.seed % 9973) + 1; changed('field'); });
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(S);
  try { await navigator.clipboard.writeText(text); $('copyNote').textContent = 'Copied. Paste it in chat to make these the town\'s stones.'; }
  catch (e) { $('copyNote').textContent = text; }
});
$('paste').addEventListener('click', async () => {
  let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) { text = prompt('Paste the stone settings here') || ''; }
  let o = null; try { o = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!o || typeof o !== 'object' || !('size' in o)) { $('copyNote').textContent = "That isn't stone settings."; return; }
  S = merged(o); syncPanel(); save(); applyLook(); applyLight(); buildField(); buildStones(); $('copyNote').textContent = 'Pasted.';
});
$('reset').addEventListener('click', () => { S = merged(null); syncPanel(); save(); applyLook(); applyLight(); buildField(); buildStones(); });
$('min').addEventListener('click', () => { const p = $('panel'); p.classList.toggle('min'); $('min').textContent = p.classList.contains('min') ? 'show' : 'hide'; fitView(); });

// ── the camera ────────────────────────────────────────────────────────────────────────────
let camRoad = -1;
const along = (k, d) => { const pts = LINES[k], i = Math.max(0, Math.min(pts.length - 1, Math.round(d))); return pts[i]; };
function view(kind) {
  if (kind === 'all') { camera.position.set(22, 30, 36); controls.target.set(0, 0, 2); $('camNote').textContent = 'Standing and kneeling turn to the next road each time you press them.'; }
  else {
    camRoad = (camRoad + 1) % 4; const r = ROADS[camRoad]; tune(S.roads[camRoad]);
    if (kind === 'stand') { const [x, z] = along(camRoad, 1), [tx, tz] = along(camRoad, 14); camera.position.set(x - Math.cos(r.ang) * 3, 1.7, z - Math.sin(r.ang) * 3); controls.target.set(tx, 0.2, tz); }
    else { const [x, z] = along(camRoad, 9), [tx, tz] = along(camRoad, 15); camera.position.set(x, 0.55, z); controls.target.set(tx, 0, tz); }
    $('camNote').textContent = `Looking down the ${r.name.toLowerCase()} road: ${S.roads[camRoad]} · ${S.builds[S.roads[camRoad]].name}. Press again for the next road.`;
  }
  controls.update(); redraw();
}
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => view(b.dataset.cam)));

// the road labels, floating over each road
const TAGS = ROADS.map((r, k) => { const t = document.createElement('button'); t.type = 'button'; t.className = 'tag'; t.title = 'Tune this build'; t.addEventListener('click', () => tune(S.roads[k])); $('tags').appendChild(t); return t; });
const tv = new THREE.Vector3();
function placeTags() {
  ROADS.forEach((r, k) => {
    const [x, z] = along(k, 24); tv.set(x, 1.4, z).project(camera);
    const t = TAGS[k], b = S.roads[k];
    if (tv.z > 1 || Math.abs(tv.x) > 1.1 || Math.abs(tv.y) > 1.1) { t.style.display = 'none'; return; }
    t.style.display = ''; t.style.left = ((tv.x + 1) / 2 * innerWidth) + 'px'; t.style.top = ((1 - tv.y) / 2 * innerHeight) + 'px';
    const ps = perStone(b);
    t.innerHTML = `${b} · ${S.builds[b].name} <small>${ps ? ps.toFixed(1) + ' a stone' : 'painted'}</small>`;
    t.classList.toggle('on', b === $('tuneBuild').value);
  });
}

// ── go ────────────────────────────────────────────────────────────────────────────────────
syncPanel(); applyLook(); applyLight(); buildField(); buildStones(); view('all');
$('info').textContent = `${QUAL.tier} (${QUAL.why})`;
// on a phone the panel covers the bottom half: shift the picture up so what you look at sits in the top half
function fitView() {
  camera.fov = innerWidth < innerHeight ? 68 : 55; camera.aspect = innerWidth / innerHeight;
  if (innerWidth <= 700 && !$('panel').classList.contains('min')) camera.setViewOffset(innerWidth, innerHeight * 1.5, 0, innerHeight * 0.5, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix(); redraw();
}
fitView();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); fitView(); });
function frame() {
  requestAnimationFrame(frame);
  if (!want) return;
  want = false;
  U.eyePos.value.copy(camera.position);
  const T = controls.target; sun.target.position.copy(T); sun.position.copy(T).addScaledVector(sun.userData.dir, 40);
  renderer.render(scene, camera);
  placeTags();
  $('info').textContent = `${QUAL.tier} · ${renderer.info.render.calls} draws · ${fmtK(renderer.info.render.triangles)} triangles`;
}
frame();
window.__stones = { get S() { return S; }, U, get FIELD() { return FIELD; }, get STATS() { return STATS; }, view, renderer, camera, controls, redraw };
