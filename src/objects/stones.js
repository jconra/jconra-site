// STONES: irregular paving, one stone per point. Points are scattered over the ground one per grid
// square, each nudged at random, and each point owns the ground nearer to it than to its neighbours.
// That gives irregular stones that never repeat. A heavier point takes a little more ground from its
// neighbours, so the stones vary in size. A stone exists where its point lies inside the paved shape,
// so a road's edge is a ragged row of whole stones rather than a blur.
//
// One layout, drawn two ways that match:
//   painted: STONE_GLSL finds the stone under any spot of ground (from the 9 nearest points), for a
//            ground shader: the stone's colour, dark gaps, darkened edges, and a bevel faked in the lighting.
//   3D:      stoneGeometry() builds each stone as a low slab (a flat top, its sides sloping down into the
//            ground), for up close; each sits exactly on its painted copy.
//
//   stoneField({ size, jitter, variety, gap, seed, x0, z0, width, inside(x, z) }) -> field
//     field.texture   one pixel per grid square: R a stone here (255; 128 in the road but too small: gap), G B the point's nudge, A its weight
//     field.stones    [{ i, j, x, z, poly: [[x, z], ...] }] each stone's outline, the gap already taken off
//     field.uniforms  for STONE_GLSL (share the object: a new field updates them in place)
//   stoneGeometry(field, shapeFor(stone) -> shape | null) -> { geometry, tris, count }
//     shape: { top, per, round, bevel, height, dome, soft, uneven } (see buildStone)
import * as THREE from 'three';

function rng(seed) {                                                   // a small seeded random (mulberry32)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const STONE_UNIFORMS = () => ({
  stoneCells: { value: null }, stoneGrid: { value: new THREE.Vector3(0, 0, 1) }, stoneShape: { value: new THREE.Vector3(1, 0.8, 0) },
});

export function stoneField({ size = 0.45, jitter = 0.8, variety = 0.25, gap = 0.03, seed = 1, x0 = -40, z0 = -40, width = 80, inside = () => true }, uniforms = STONE_UNIFORMS()) {
  const S = size, N = Math.ceil(width / S), rnd = rng(seed * 7919 + 13);
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) { data[k * 4 + 1] = Math.floor(rnd() * 256); data[k * 4 + 2] = Math.floor(rnd() * 256); data[k * 4 + 3] = Math.floor(rnd() * 256); }
  // each point exactly as the shader reads it back (bytes / 255)
  const px = (i, j) => x0 + (i + 0.5 + (data[(j * N + i) * 4 + 1] / 255 - 0.5) * jitter) * S;
  const pz = (i, j) => z0 + (j + 0.5 + (data[(j * N + i) * 4 + 2] / 255 - 0.5) * jitter) * S;
  const pw = (i, j) => data[(j * N + i) * 4 + 3] / 255 * variety * S * S;
  const stones = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ax = px(i, j), az = pz(i, j);
    if (!inside(ax, az)) continue;
    // the ground this point owns: start from a square round it, cut by each neighbour's dividing line
    // (moved half a gap towards this point, so the gap comes off here)
    const R = 2.2 * S; let poly = [[ax - R, az - R], [ax + R, az - R], [ax + R, az + R], [ax - R, az + R]];
    const wa = pw(i, j);
    for (let dj = -2; dj <= 2 && poly.length; dj++) for (let di = -2; di <= 2 && poly.length; di++) {
      const bi = i + di, bj = j + dj;
      if ((!di && !dj) || bi < 0 || bj < 0 || bi >= N || bj >= N) continue;
      const bx = px(bi, bj), bz = pz(bi, bj), wb = pw(bi, bj), L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      // f(p) = how far p is on this point's side of the line (power distance halved over the spacing)
      const f = (x, z) => (2 * (x * (ax - bx) + z * (az - bz)) + bx * bx + bz * bz - ax * ax - az * az - wb + wa) / (2 * L) - gap / 2;
      poly = clip(poly, f);
    }
    if (poly.length < 3 || area(poly) < 0.04 * S * S) { data[(j * N + i) * 4] = 128; continue; }   // (in the road, too small for a stone: gap)
    data[(j * N + i) * 4] = 255;
    stones.push({ i, j, x: ax, z: az, poly });
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  if (uniforms.stoneCells.value) uniforms.stoneCells.value.dispose();
  uniforms.stoneCells.value = tex; uniforms.stoneGrid.value.set(x0, z0, S); uniforms.stoneShape.value.set(N, jitter, variety);
  return { N, size: S, texture: tex, stones, uniforms, data };
}

// keep the part of a convex polygon where f >= 0 (one cut of Sutherland-Hodgman)
function clip(poly, f) {
  const out = [], n = poly.length;
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n], fa = f(a[0], a[1]), fb = f(b[0], b[1]);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
const area = (p) => { let s = 0; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };

// drop corners until n are left, each time the one whose loss changes the outline least
function reduce(poly, n) {
  const p = poly.slice();
  while (p.length > Math.max(3, n)) {
    let best = 0, bestA = Infinity;
    for (let k = 0; k < p.length; k++) {
      const a = p[(k + p.length - 1) % p.length], b = p[k], c = p[(k + 1) % p.length];
      const A = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
      if (A < bestA) { bestA = A; best = k; }
    }
    p.splice(best, 1);
  }
  return p;
}
// where a ray from c through q leaves a convex polygon
function exitPoint(c, q, poly) {
  const dx = q[0] - c[0], dz = q[1] - c[1]; let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - c[0]) * ez - (a[1] - c[1]) * ex) / den, u = ((a[0] - c[0]) * dz - (a[1] - c[1]) * dx) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best < Infinity ? [c[0] + dx * best, c[1] + dz * best] : q;
}

// One stone in its share of the ground (poly, the gap already off). shape:
//   top      corners of the flat top (0: as many as the stone's outline has); they are its outline's own
//            corners, keeping the ones that matter most, moved in by the bevel
//   per      footing points for each top corner, where the sides meet the ground: 1 straight out from each
//            corner (a plain slab); 2 also one straight out from the middle of each side (a rounder stone);
//            3 two along each side
//   round    pull the footing's corner points in (0 .. 1 of the bevel), so the stone reads rounder
//   bevel    how far in from the edge the flat top starts (m)
//   height   the top's height above the ground (m); dome: a middle point raised this much more (0: flat top)
//   uneven   each stone a little higher or lower and tipped (0 .. 1)
// Triangles: the top (corners - 2, or one per corner round a raised middle) + (per + 1) per corner for the sides.
// -> { pts: [[x, y, z]], edge: [1 top .. 0 ground], faces: [[a, b, c]] }
export function buildStone(poly, shape, r1 = 0.5, r2 = 0.5) {
  const c = centroid(poly), per = Math.max(1, Math.round(shape.per || 1));
  const corners = shape.top > 0 ? reduce(poly, shape.top) : poly.slice(), k = corners.length;
  const inset = (q, d) => { const dx = q[0] - c[0], dz = q[1] - c[1], L = Math.hypot(dx, dz) || 1, f = Math.max(0.3, 1 - d / L); return [c[0] + dx * f, c[1] + dz * f]; };
  const top = corners.map((q) => inset(q, shape.bevel));
  const h = shape.height * (1 + (r1 - 0.5) * shape.uneven), tilt = shape.uneven * 0.06, ta = r2 * 6.283;
  const topY = (x, z) => h + ((x - c[0]) * Math.cos(ta) + (z - c[1]) * Math.sin(ta)) * tilt;
  const pts = [], edge = [], faces = [];
  const T = top.map((q) => { pts.push([q[0], topY(q[0], q[1]), q[1]]); edge.push(1); return pts.length - 1; });
  // the footing: for each top corner, straight out from it to the stone's edge (pulled in by `round`),
  // then straight out from points along the top's side
  const F = [];
  for (let i = 0; i < k; i++) {
    const a = top[i], b = top[(i + 1) % k];
    for (let s = 0; s < per; s++) {
      const t = s / per, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let e = exitPoint(c, q, poly);
      if (s === 0 && shape.round > 0) e = [e[0] + (q[0] - e[0]) * Math.min(1, shape.round), e[1] + (q[1] - e[1]) * Math.min(1, shape.round)];
      pts.push([e[0], -0.012, e[1]]); edge.push(0); F.push(pts.length - 1);
    }
  }
  if (shape.dome > 0) {                                               // a fan round a raised middle
    pts.push([c[0], topY(c[0], c[1]) + shape.dome, c[1]]); edge.push(1); const m = pts.length - 1;
    for (let i = 0; i < k; i++) faces.push([m, T[i], T[(i + 1) % k]]);
  } else for (let i = 1; i < k - 1; i++) faces.push([T[0], T[i], T[i + 1]]);
  // the sides, one top edge at a time: its first footing points fan from the corner it starts at, one
  // triangle spans the edge, the rest fan from the corner it ends at (per 2: Jacob's drawing exactly)
  const half = Math.floor(per / 2);
  for (let i = 0; i < k; i++) {
    const Ta = T[i], Tb = T[(i + 1) % k], Q = (s) => F[(i * per + s) % F.length];
    for (let s = 0; s < half; s++) faces.push([Ta, Q(s), Q(s + 1)]);
    faces.push([Ta, Tb, Q(half)]);
    for (let s = half; s < per; s++) faces.push([Tb, Q(s), Q(s + 1)]);
  }
  return { pts, edge, faces };
}

export const stoneTris = (shape, corners) => {                         // triangles one stone takes
  const top = shape.top > 0 ? Math.min(shape.top, corners) : corners, per = Math.max(1, Math.round(shape.per || 1));
  return (shape.dome > 0 ? top : top - 2) + top * (per + 1);
};

export function stoneGeometry(field, shapeFor) {
  const P = [], Nn = [], C = [], E = [];
  let tris = 0, count = 0;
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const s of field.stones) {
    const shape = shapeFor(s);
    if (!shape) continue;
    const d = field.data, o = (s.j * field.N + s.i) * 4, r1 = ((d[o + 1] * 17 + d[o + 2] * 5) % 256) / 255, r2 = ((d[o + 2] * 13 + d[o + 3] * 7) % 256) / 255;
    const st = buildStone(s.poly, shape, r1, r2);
    // each face upward, its own normal; soft: each corner the average of the faces that meet there
    const fn = st.faces.map((f) => {
      const [p0, p1, p2] = f.map((k) => st.pts[k]);
      a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]); v.crossVectors(a, b);
      if (v.y < 0) { f.reverse(); v.negate(); }
      return v.clone();
    });
    let vn = null;
    if (shape.soft) { vn = st.pts.map(() => new THREE.Vector3()); st.faces.forEach((f, k) => f.forEach((i) => vn[i].add(fn[k]))); vn.forEach((n) => n.normalize()); }
    st.faces.forEach((f, k) => {
      const n = fn[k].clone().normalize();
      for (const i of f) { const p = st.pts[i], m = vn ? vn[i] : n; P.push(p[0], p[1], p[2]); Nn.push(m.x, m.y, m.z); C.push(s.i, s.j); E.push(st.edge[i]); }
    });
    tris += st.faces.length; count++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(C, 2)); g.setAttribute('aEdge', new THREE.Float32BufferAttribute(E, 1));
  g.computeBoundingSphere();
  return { geometry: g, tris, count };
}

// ── the shader side ─────────────────────────────────────────────────────────────────────────
// stoneAt(p, d, c): the stone under ground spot p (metres, x z). d: its grid square's pixel (d.r > 0.5:
// a stone is there), c: the square. Returns x: the distance in to its nearest edge (m), y: to its second
// nearest (for rounding corners), zw: the way out across the nearest edge.
// stoneColour(p, d, c, far): its colour there: the stone's own shade and tint, grain from noise (fixed
// to the spot, so it never changes from frame to frame), an optional rock picture; far 0..1 fades the
// finest grain away with distance, where it would only sparkle. #define STONE_PIC first for the rock-picture
// option (one more picture in the shader: the Stone Lab has it, the Terrain Lab's ground has no room).
export const STONE_GLSL = `
  uniform sampler2D stoneCells; uniform vec3 stoneGrid, stoneShape;
  uniform vec3 stoneBase; uniform float stoneShade, stoneHue, grainAmt, grainSize, speckAmt;
  #ifdef STONE_PIC
  uniform float picAmt, picScale, picAvg; uniform sampler2D rockPic;
  #endif
  vec4 stCell(vec2 c) { return texture2D(stoneCells, (c + 0.5) / stoneShape.x); }
  vec2 stPoint(vec2 c, vec4 d) { return stoneGrid.xy + (c + 0.5 + (d.gb - 0.5) * stoneShape.y) * stoneGrid.z; }
  float stWeight(vec4 d) { return d.a * stoneShape.z * stoneGrid.z * stoneGrid.z; }
  bool stOut(vec2 q) { return q.x < 0.0 || q.y < 0.0 || q.x >= stoneShape.x || q.y >= stoneShape.x; }
  vec4 stoneAt(vec2 p, out vec4 d, out vec2 c) {
    vec2 g = floor((p - stoneGrid.xy) / stoneGrid.z);
    float best = 1e9; vec2 a = vec2(0.0); d = vec4(0.0); c = vec2(-9.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 q = g + vec2(float(i), float(j)); if (stOut(q)) continue;
      vec4 e = stCell(q); vec2 b = stPoint(q, e); float pw = dot(p - b, p - b) - stWeight(e);
      if (pw < best) { best = pw; a = b; d = e; c = q; }
    }
    float e1 = 1e9, e2 = 1e9; vec2 dir = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 q = g + vec2(float(i), float(j)); if (stOut(q) || (q.x == c.x && q.y == c.y)) continue;
      vec4 e = stCell(q); vec2 b = stPoint(q, e); vec2 ab = b - a; float L = length(ab); if (L < 1e-5) continue;
      float f = (dot(p - b, p - b) - stWeight(e) - best) / (2.0 * L);
      if (f < e1) { e2 = e1; e1 = f; dir = ab / L; } else if (f < e2) e2 = f;
    }
    return vec4(e1, e2, dir);
  }
  float stHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float stNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(stHash(i), stHash(i + vec2(1.0, 0.0)), f.x), mix(stHash(i + vec2(0.0, 1.0)), stHash(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec3 stoneColour(vec2 p, vec4 d, vec2 c, float far) {
    float r1 = fract(d.g * 17.31 + d.b * 5.77 + d.a * 3.13 + c.x * 0.6180 + c.y * 0.3819), r2 = fract(r1 * 37.7 + d.b * 9.13 + d.a * 1.7);
    vec3 col = stoneBase * (1.0 + (r1 - 0.5) * 2.0 * stoneShade);                 // stone to stone: lighter, darker
    col *= 1.0 + (r2 - 0.5) * 2.0 * stoneHue * vec3(0.5, 0.05, -0.45);           // stone to stone: warmer, cooler
    vec2 q = p / grainSize + vec2(r1, r2) * 97.0;                                // each stone its own stretch of grain
    float n = stNoise(q) * 0.5 + stNoise(q * 2.13 + 7.1) * 0.3 + stNoise(q * 4.7 + 3.3) * 0.2;
    col *= 1.0 + (n - 0.5) * 2.0 * grainAmt;
    float s = stNoise(p / (grainSize * 0.09) + 13.0);                             // fine speckle, gone by the time it would sparkle
    col *= 1.0 + (s - 0.5) * 2.0 * speckAmt * (1.0 - far);
    #ifdef STONE_PIC
    if (picAmt > 0.0) {                                                          // the rock picture, turned and shifted per stone
      float an = r1 * 6.2832, cs = cos(an), sn = sin(an);
      vec2 u = mat2(cs, sn, -sn, cs) * (p / picScale) + vec2(r2, r1) * 7.0;
      vec3 t = pow(texture2D(rockPic, u).rgb, vec3(2.2));
      col *= mix(1.0, dot(t, vec3(0.299, 0.587, 0.114)) / picAvg, picAmt);
    }
    #endif
    return col;
  }
`;
