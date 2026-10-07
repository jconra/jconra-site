// VALEHEX GLOBE: a model of Jacob's hex-tiled planet (valehex.com) for the town, floating over a stone and brass stand:
// a ball of hexagons (with the twelve pentagons any ball of hexagons needs: a Goldberg globe, the dual of a finely cut
// icosahedron), each tile coloured from a made-up map of the world (noise for the land's height and wetness: deep ocean
// to bright shallows, sand, grass, forest with little trees, tan dry land, grey peaks with snow), the land standing
// proud of the sea and the peaks proud of the land, thin white lines between the tiles, a glowing atmosphere round it.
// It glows a little of itself (it reads at night and in the shade) and turns slowly on a tilted axis.
//
//   makeValehexGlobe({ freq, radius }) -> Group (standing on y = 0, its front +z; the stand 1 m, the globe's centre at
//                                          GLOBE_Y): a town prop. tickGlobes(dt): turns every globe in the scene
import * as THREE from 'three';

export const GLOBE_Y = 2.05, GLOBE_R = 0.75;
const LIVE = new Set();

// ── a little seeded 3D noise (gradient noise on a lattice, smoothly blended) ────────────────────────────────────
function noise3(seed) {
  const P = new Uint8Array(512), G = [];
  let s = seed >>> 0 || 1; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256; i++) P[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) { P[i + 256] = P[i]; const a = r() * Math.PI * 2, z = r() * 2 - 1, q = Math.sqrt(1 - z * z); G.push([q * Math.cos(a), q * Math.sin(a), z]); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z, u = fade(fx), v = fade(fy), w = fade(fz);
    const g = (i, j, k) => { const h = G[P[P[P[(X + i) & 255] + ((Y + j) & 255)] + ((Z + k) & 255)]]; return h[0] * (fx - i) + h[1] * (fy - j) + h[2] * (fz - k); };
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(g(0, 0, 0), g(1, 0, 0), u), l(g(0, 1, 0), g(1, 1, 0), u), v), l(l(g(0, 0, 1), g(1, 0, 1), u), l(g(0, 1, 1), g(1, 1, 1), u), v), w);
  };
}
const fbm = (n, x, y, z, oct = 4) => { let a = 0, f = 1, m = 0.5; for (let i = 0; i < oct; i++) { a += n(x * f, y * f, z * f) * m; f *= 2.03; m *= 0.5; } return a; };

// ── the ball of hexagons ───────────────────────────────────────────────────────────────────────────────────────
// the icosahedron cut into freq² triangles a face, pushed out onto the ball; then each corner of that becomes a tile,
// its own corners the middles of the triangles round it
function goldberg(freq) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => new THREE.Vector3(...v).normalize());
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const pts = [], key = new Map(), tris = [];
  const at = (v) => { const k = `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`; let i = key.get(k); if (i === undefined) { i = pts.length; pts.push(v.clone()); key.set(k, i); } return i; };
  for (const [a, b, c] of F) {
    const A = V[a], B = V[b], C = V[c], row = [];
    for (let i = 0; i <= freq; i++) { row.push([]); for (let j = 0; j <= freq - i; j++) { const p = new THREE.Vector3().addScaledVector(A, (freq - i - j) / freq).addScaledVector(B, i / freq).addScaledVector(C, j / freq).normalize(); row[i].push(at(p)); } }
    for (let i = 0; i < freq; i++) for (let j = 0; j < freq - i; j++) { tris.push([row[i][j], row[i + 1][j], row[i][j + 1]]); if (j < freq - i - 1) tris.push([row[i + 1][j], row[i + 1][j + 1], row[i][j + 1]]); }
  }
  const around = pts.map(() => []), mids = tris.map(([a, b, c]) => new THREE.Vector3().add(pts[a]).add(pts[b]).add(pts[c]).normalize());
  tris.forEach((tr, ti) => { for (const v of tr) around[v].push(ti); });
  // each tile: its centre and its corners in order round it
  return pts.map((c, vi) => {
    const e1 = new THREE.Vector3(0, 1, 0).cross(c); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0); e1.normalize(); const e2 = c.clone().cross(e1);
    const corners = around[vi].map((ti) => mids[ti]).sort((p, q) => Math.atan2(p.dot(e2), p.dot(e1)) - Math.atan2(q.dot(e2), q.dot(e1)));
    return { c, corners };
  });
}

// ── the colours of the made-up world (sRGB, as the screenshot's) ────────────────────────────────────────────────
const COL = { deep: '#0b2f86', sea: '#1557c4', shelf: '#1f97d6', shallow: '#47d2e2', sand: '#e7c47c', grass: '#8fc43c', grassLush: '#6fb33a', forest: '#2e7a2f', forestDeep: '#215f28', dry: '#d6a960', rock: '#a59d92', snow: '#f4f6f8' };
const C3 = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, new THREE.Color(v)]));

function tileLook(n1, n2, p) {
  const e = fbm(n1, p.x * 1.3, p.y * 1.3, p.z * 1.3, 5) - 0.03;            // (the land's height: more sea than land, as Valehex)
  const wet = fbm(n2, p.x * 2.1 + 7, p.y * 2.1, p.z * 2.1, 3), lat = Math.abs(p.y);
  if (e < 0) { const d = -e; return { col: d > 0.2 ? 'deep' : d > 0.12 ? 'sea' : d > 0.055 ? 'shelf' : 'shallow', h: 0, water: 1 }; }
  if (e < 0.035) return { col: 'sand', h: 0.012, water: 0 };
  if (e > 0.2 || (lat > 0.88 && e > 0.12)) return { col: e > 0.25 || lat > 0.88 ? 'snow' : 'rock', h: 0.03 + Math.min(0.05, Math.max(0, e - 0.2) * 0.5), water: 0, peak: 1 };   // (the land tops out near 0.28)
  if (wet > 0.08) return { col: wet > 0.2 ? 'forestDeep' : 'forest', h: 0.016, water: 0, trees: 1 };
  if (wet < -0.16) return { col: 'dry', h: 0.014, water: 0 };
  return { col: wet > -0.02 ? 'grassLush' : 'grass', h: 0.015, water: 0 };
}

// the tiles' shader: a thin white line round each tile (edge: 1 on a tile's rim, 0 at its middle), the sea glossy, the
// whole a little lit of itself
function globeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float edge; attribute float water; varying float vEdge; varying float vWater;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEdge = edge; vWater = water;');
    sh.fragmentShader = 'varying float vEdge; varying float vWater;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float line = smoothstep(0.88, 0.96, vEdge); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * mix(0.32, 0.5, vWater));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.18, vWater);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.32;');
  };
  m.customProgramCacheKey = () => 'valehex-globe-1';
  return m;
}
// the atmosphere: a glow round the globe's edge, brightest where it's seen edge-on
// (with a logarithmic depth buffer, as the jconra.com film has: depth as everything else writes it, three's chunk for a perspective camera)
const AIR_VS = `varying vec3 vN; varying vec3 vV;
#include <logdepthbuf_pars_vertex>
void main() { vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position, 1.0); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p;
#ifdef USE_LOGDEPTHBUF
#ifdef USE_LOGDEPTHBUF_EXT
vFragDepth = 1.0 + gl_Position.w; vIsPerspective = 1.0;
#else
gl_Position.z = log2(max(1e-6, gl_Position.w + 1.0)) * logDepthBufFC - 1.0; gl_Position.z *= gl_Position.w;
#endif
#endif
}`;
const AIR_FS = `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
float f = pow(1.0 - abs(dot(vN, vV)), 2.6); gl_FragColor = vec4(uColor * f * 2.2, f); }`;

let CACHE = null;
function build(freq) {
  const n1 = noise3(11), n2 = noise3(29), tiles = goldberg(freq);
  const pos = [], nor = [], col = [], edge = [], water = [], treeAt = [];
  const push = (p, nrm, c, e, w) => { pos.push(p.x, p.y, p.z); nor.push(nrm.x, nrm.y, nrm.z); col.push(c.r, c.g, c.b); edge.push(e); water.push(w); };
  const jit = new THREE.Color(), base = 0.985;
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const t of tiles) {
    const look = tileLook(n1, n2, t.c), k = 1 + look.h, c = jit.copy(C3[look.col]).multiplyScalar(0.94 + r() * 0.12);
    const top = t.corners.map((q) => q.clone().multiplyScalar(k)), mid = t.c.clone().multiplyScalar(k);
    for (let i = 0; i < top.length; i++) { const a = top[i], b = top[(i + 1) % top.length]; push(mid, t.c, c, 0, look.water); push(a, t.c, c, 1, look.water); push(b, t.c, c, 1, look.water); }
    if (look.h > 0) for (let i = 0; i < top.length; i++) {            // (its sides, down to the sea, darker: the land stands proud)
      const a = top[i], b = top[(i + 1) % top.length], a0 = t.corners[i].clone().multiplyScalar(base), b0 = t.corners[(i + 1) % top.length].clone().multiplyScalar(base);
      const side = a.clone().add(b).multiplyScalar(0.5).sub(mid).normalize(), dark = c.clone().multiplyScalar(0.62);
      push(a, side, dark, 0, 0); push(a0, side, dark, 0, 0); push(b, side, dark, 0, 0); push(b, side, dark, 0, 0); push(a0, side, dark, 0, 0); push(b0, side, dark, 0, 0);   // (edge 0: the white line is the top's)
    }
    if (look.trees) for (let q = 0; q < 3; q++) { const u = r(), v = r() * (1 - u), w = 1 - u - v, i = Math.floor(r() * t.corners.length);
      treeAt.push(t.c.clone().multiplyScalar(0.55 + 0.45 * u).addScaledVector(t.corners[i], 0.45 * v).addScaledVector(t.corners[(i + 1) % t.corners.length], 0.45 * w).normalize().multiplyScalar(k)); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1)); geo.setAttribute('water', new THREE.Float32BufferAttribute(water, 1));
  // the forest's little trees, pointing out from the ball
  const cone = new THREE.ConeGeometry(0.012, 0.045, 5).translate(0, 0.0225, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3();
  const trees = treeAt.map((p) => { const s = 0.8 + r() * 0.6; return M.compose(p, Q.setFromUnitVectors(up, p.clone().normalize()), S.set(s, s, s)).clone(); });
  // the stand: a stone foot, a brass stem, a ring the globe floats over, its inner edge glowing
  const stone = new THREE.MeshStandardMaterial({ color: 0xe3d8bf, roughness: 0.85 }), brass = new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.35, metalness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x0a2230, emissive: 0x59d8ff, emissiveIntensity: 2.2, roughness: 0.4 });
  const parts = [
    [new THREE.CylinderGeometry(0.5, 0.58, 0.22, 8), stone, 0.11], [new THREE.CylinderGeometry(0.4, 0.46, 0.12, 8), stone, 0.28],
    [new THREE.CylinderGeometry(0.09, 0.13, 0.62, 8), brass, 0.65], [new THREE.CylinderGeometry(0.2, 0.1, 0.12, 8), brass, 1.0],
  ];
  const ring = [new THREE.TorusGeometry(0.42, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, 1.1, 0), new THREE.TorusGeometry(0.36, 0.018, 6, 32).rotateX(Math.PI / 2).translate(0, 1.11, 0)];
  return { geo, cone, trees, parts, ring, stone, brass, glow, mat: globeMaterial(), treeMat: new THREE.MeshStandardMaterial({ color: 0x1d5a24, roughness: 0.8, emissive: 0x1d5a24, emissiveIntensity: 0.3 }) };
}

export function makeValehexGlobe({ freq = 15 } = {}) {
  const B = CACHE || (CACHE = build(freq));
  const g = new THREE.Group(); g.name = 'valehexGlobe'; g.userData.kind = 'valehexGlobe';
  for (const [geo, mat, y] of B.parts) { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); }
  g.add(new THREE.Mesh(B.ring[0], B.brass), new THREE.Mesh(B.ring[1], B.glow));
  // the globe: tilted, turning about its own axis, floating over the ring
  const tilt = new THREE.Group(); tilt.position.y = GLOBE_Y; tilt.rotation.z = 0.41; g.add(tilt);
  const spin = new THREE.Group(); spin.scale.setScalar(GLOBE_R); tilt.add(spin);
  const ball = new THREE.Mesh(B.geo, B.mat); ball.castShadow = true; spin.add(ball);
  const trees = new THREE.InstancedMesh(B.cone, B.treeMat, B.trees.length); B.trees.forEach((m, i) => trees.setMatrixAt(i, m)); spin.add(trees);
  const air = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), new THREE.ShaderMaterial({ vertexShader: AIR_VS, fragmentShader: AIR_FS, uniforms: { uColor: { value: new THREE.Color('#5ec8ff') } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
  air.scale.setScalar(GLOBE_R); air.position.y = GLOBE_Y; air.raycast = () => {}; g.add(air);
  g.userData.spin = spin; LIVE.add(g);
  return g;
}
// every globe still in a scene turns; the gone ones are let go
export function tickGlobes(dt) {
  for (const g of LIVE) { let o = g; while (o.parent) o = o.parent; if (!o.isScene) { LIVE.delete(g); continue; } g.userData.spin.rotation.y += dt * 0.12; }   // (out of the scene: let go; a town's globe is in it from the frame it's made)
}
