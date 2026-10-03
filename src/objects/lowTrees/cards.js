// LOW PINE, CARDS: a conifer of about a hundred triangles, for weak machines and far-off stands. The
// shape is a handful of flat cards; the look comes from the picture painted on them and from how they
// are lit, the way stylised game trees do it.
//
//   trunk    a five-sided post narrowing to a twig inside the crown (10 triangles)
//   tiers    rings of fronds hanging off the trunk, fewer and shorter toward the top, each tier hanging
//            far enough to reach past the top of the one below (so no daylight between them). Each frond
//            is one card cut as a diamond (2 triangles: trunk end, two sides, tip) folded down along its
//            midrib like a roof, so its two slopes catch the light differently and it is seldom edge-on
//   leader   a narrow three-sided spire at the top, the upper half of a frond picture on each side (3)
// Triangles: 10 + 2 per frond + 3. The defaults (fronds 7 7 6 6 5 5 4 4 from the bottom up) make 101;
// tiers 10, sides 8 make 133.
//
// The picture (one canvas, painted once, about 0.1 s, and shared by every tree): three frond pictures
// and a strip of bark. A frond is rows of spiky sprigs, each a fan of needles from its twig ending in a
// row of teeth; each row nearer the trunk is laid over the next one out like roof tiles and casts a
// soft shadow on it: dark in the crevices, yellow-green along the teeth, a saw-tooth edge all round.
// The lighting: each tier is lit as one lump. A corner's normal points straight out from the trunk,
// tipped up more toward the tier's top than at its hem, so a tier's top and its outer side toward the
// sun light up together and the far side falls dark; the card's own facing counts only a little
// (`lump`). Seen from below, a card shows its back, whose normal three.js turns round: dark undersides
// for free (normals kept near level, or those would go black), and a faint even light (`glow`, a plain
// white light map, so it is scaled by the leaf's own colour) keeps them dark olive rather than black.
// The vertex colours darken toward the trunk and down the tree (less sky gets in), cooler inside,
// warmer at the tips. The colours are a dull blue-leaning olive with yellow-green only on the teeth.
//
// The picture is stored as it will be lit (linear, no sRGB decode), because three.js gives an sRGB
// picture no mipmaps under WebGL1, and a cut-out picture without mipmaps sparkles at a distance. It is
// stored GAIN times brighter so the darks keep their steps in 8 bits, and the vertex colours take the
// GAIN back off. Its mipmaps are made here, each smaller level's cut-out grown so the same share of it
// passes the cut: a far tree stays as full as a near one instead of thinning to a skeleton.
//
//   makeLowPine(opts) -> THREE.Group, one mesh, one material, one draw; group.userData.tris
//   opts: LOW_PINE_DEFAULTS, any of them; the same seed always gives the same tree
//   lowPineAtlas() -> the shared picture (THREE.CanvasTexture)
// As a forest species (src/objects/forest.js): { name: 'pine', root: makeLowPine(), height: 22, weight: 1,
// tint: false } (it carries its own colour; the forest's green tint darkens it twice), without `soften` /
// `upNormals` / `shape`: those light both sides of a card alike, and the undersides would come out as
// bright as the tops. The imposters are baked without the glow, so the near trees are a shade lighter
// in the shade than the far ones (`glow: 0` leaves that step out).
import * as THREE from 'three';

function rng(seed) {                                                   // a small seeded random (mulberry32)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const LOW_PINE_DEFAULTS = {
  height: 22,      // m, base at y = 0
  tiers: 8,        // rings of fronds
  sides: 7,        // fronds round the bottom tier
  top: 4,          // fronds round the top tier (the ones between step down evenly)
  radius: 5.3,     // the bottom tier's reach (m); the rest follow a cone up to the leader
  crown: 0.22,     // the bottom tier's height on the trunk, a share of the tree's height (its lowest tips then clear the ground by about a metre)
  droop: 0.55,     // the least the fronds hang (radians below level)
  overlap: 1.35,   // each tier hangs this many tier gaps down, so it reaches past the top of the one below
  fold: 0.5,       // how far each frond's sides fall away from its midrib (radians)
  width: 0.42,     // a frond's half-width at its widest, a share of its length
  lump: 0.8,       // the normals: 0 each card lit by its own facing, 1 each tier lit as one lump
  lift: 0.3,       // the lump normals tipped up from level by this much (a slope: 0.3 is about 17 degrees)
  inner: 0.5,      // how light the trunk end of a frond is, against its tip (1)
  glow: 0.2,       // light every leaf gets whichever way it faces (a plain white light map at this strength), so undersides are dark olive, not black
  seed: 1,
};

// ── the picture ─────────────────────────────────────────────────────────────────────────────
const AW = 1024, AH = 512, FW = 320, BARK0 = 976, GAIN = 2.2, WIDE = 0.5;  // frond k fills x k*FW .. (k+1)*FW; bark from BARK0 to the edge
const PAINT_W = 0.42;                                                  // the half-width the fronds are painted at (the cards stretch to theirs)
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
// an sRGB colour (0..255 each) as the picture stores it: linear, times GAIN
const lc = (r, g, b, a = 1) => `rgba(${[r, g, b].map((c) => Math.min(255, Math.round(toLin(c) * GAIN * 255))).join(',')},${a})`;
const mixc = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);

// the colours of the leaves themselves (sRGB; lighting makes them darker): the deep crevices, a sprig's shaded back, its body, its tips, the needle highlights
const DEEP = [20, 30, 26], BACK = [46, 62, 46], BODY = [66, 90, 58], TIP = [96, 124, 66], GLINT = [134, 162, 88];
const STYLES = [{ sz: 0.13, teeth: 6, seed: 31 }, { sz: 0.11, teeth: 5, seed: 47 }, { sz: 0.15, teeth: 7, seed: 83 }];   // the three frond pictures: sprig size (of the frond's length), teeth

// the diamond a frond card is cut as, in the frond's own measure (length 1, base at y 0, tip at y 1)
const halfAt = (y) => (y < WIDE ? PAINT_W * y / WIDE : PAINT_W * (1 - y) / (1 - WIDE));
const insideDiamond = (x, y, m) => y > m && y < 1 - m && Math.abs(x) < halfAt(y) - m;

function paintFrond(g, k, st) {
  const r = rng(st.seed), inset = 5, rw = FW - 2 * inset, v0 = 0.012, v1 = 0.988;
  g.save();
  g.setTransform(rw / (2 * PAINT_W), 0, 0, -AH * (v1 - v0), k * FW + inset + rw / 2, AH * (1 - v0));
  const path = (pts, dx = 0, dy = 0, s = 1, cx = 0, cy = 0) => { g.beginPath();
    pts.forEach(([x, y], i) => { const px = cx + (x - cx) * s + dx, py = cy + (y - cy) * s + dy; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); };
  const fill = (pts, style, ...rest) => { g.fillStyle = style; path(pts, ...rest); g.closePath(); g.fill(); };
  g.lineCap = g.lineJoin = 'round';
  // the twig along the midrib, mostly hidden
  g.strokeStyle = lc(46, 36, 27); g.lineWidth = 0.012; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 0.9); g.stroke();
  // rows of sprigs, the tip's first, each next row (nearer the trunk) laid over the last like roof tiles
  for (let y0 = 0.9; y0 > 0.04;) {
    const szRow = st.sz * (0.72 + 0.28 * Math.min(1, y0 / 0.35)) * (1 - 0.3 * Math.max(0, (y0 - 0.7) / 0.3));
    const cw = Math.max(0, halfAt(y0) * (0.74 + 0.14 * r()) - 0.3 * szRow), m = Math.max(1, Math.round(2 * cw / (szRow * 0.8)) + (cw > 0.02 ? 1 : 0)), row = [];
    for (let j = 0; j < m; j++) row.push(m === 1 ? 0 : -cw + 2 * cw * j / (m - 1));
    row.sort(() => r() - 0.5);
    for (const x0 of row) {
      let x = x0 + (r() - 0.5) * szRow * 0.45, y = y0 + (r() - 0.5) * szRow * 0.75;
      const sz = szRow * (0.8 + 0.4 * r()), a = (cw > 1e-3 ? x0 / cw : 0) * 0.75 + (r() - 0.5) * 0.2, dx = Math.sin(a), dy = Math.cos(a), px = dy, py = -dx;
      const L = (fa, sb) => [x + (dx * fa + px * sb) * sz, y + (dy * fa + py * sb) * sz];
      // a sprig poking out of the card moved in toward the midrib (cut down, it would read as a round blob)
      for (let n = 0; n < 8 && [[0.74, 0], [0.55, -0.55], [0.55, 0.55], [0.1, -0.45], [0.1, 0.45]].some(([fa, sb]) => !insideDiamond(...L(fa, sb), 0.006)); n++) { x *= 0.8; y += (WIDE - y) * 0.15; }
      const fit = (fa, sb) => { let q = L(fa, sb); for (let n = 0; n < 8 && !insideDiamond(q[0], q[1], 0.006); n++) { fa *= 0.85; sb *= 0.85; q = L(fa, sb); } return q; };
      // the outline: a fan from the sprig's root, a side, a row of teeth across the front (the middle ones longest), the other side
      const pts = [], edge = [], tips = [];
      for (const [fa, sb] of [[-0.14, 0.24], [-0.33, 0.05], [-0.33, -0.05], [-0.14, -0.24]]) pts.push(fit(fa, sb));
      const J = st.teeth, sideL = fit(0.04, -0.43); pts.push(sideL); edge.push(sideL);
      let last = null;
      for (let j = 0; j < J; j++) {
        const sb = -0.44 + 0.88 * j / (J - 1), fa = 0.3 + 0.44 * (1 - (sb / 0.5) ** 2) + (r() - 0.5) * 0.14;
        if (last !== null) { const v = fit(Math.min(last, fa) - 0.27 - 0.1 * r(), sb - 0.44 / (J - 1)); pts.push(v); edge.push(v); }
        const t = fit(fa, sb * 1.25); pts.push(t); edge.push(t); tips.push(t); last = fa;
      }
      const sideR = fit(0.04, 0.43); pts.push(sideR); edge.push(sideR);
      const lit = (0.84 + 0.3 * r()) * (0.88 + 0.18 * y), warm = (r() - 0.5) * 0.3 + 0.2 * y;
      const shade = (c) => mixc(c, [c[0] * 1.12, c[1] * 1.04, c[2] * 0.86], warm).map((v) => v * lit);
      // its shadow on the row it overlaps (only where there is paint already), a dark rim, the sprig
      g.globalCompositeOperation = 'source-atop';
      fill(pts, lc(...DEEP, 0.6), dx * sz * 0.3, dy * sz * 0.3, 1.05, x, y);
      fill(pts, lc(...DEEP, 0.3), dx * sz * 0.14, dy * sz * 0.14, 1.12, x, y);
      g.globalCompositeOperation = 'source-over';
      fill(pts, lc(...DEEP), 0, 0, 1.06, x, y);
      const [gx0, gy0] = L(-0.38, 0), [gx1, gy1] = L(0.62, 0), grad = g.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, lc(...shade(BACK))); grad.addColorStop(0.45, lc(...shade(BODY))); grad.addColorStop(0.85, lc(...shade(TIP))); grad.addColorStop(1, lc(...shade(mixc(TIP, GLINT, 0.5))));
      fill(pts, grad);
      // needles: fine strokes fanning from the sprig's root out to its teeth, then a lit rim along the teeth
      const root = L(-0.12, 0);
      g.strokeStyle = lc(...shade(mixc(BODY, TIP, 0.6)), 0.45); g.lineWidth = 0.0024;
      for (const t of tips) for (const f of [0.6, 0.95]) { g.beginPath(); g.moveTo(root[0] + (t[0] - root[0]) * (f - 0.4), root[1] + (t[1] - root[1]) * (f - 0.4)); g.lineTo(root[0] + (t[0] - root[0]) * f, root[1] + (t[1] - root[1]) * f); g.stroke(); }
      g.strokeStyle = lc(...shade(GLINT), 0.6); g.lineWidth = 0.0042; path(edge); g.stroke();
    }
    y0 -= st.sz * 0.6 * (0.75 + 0.5 * r());
  }
  g.restore();
}

function paintBark(g) {
  const r = rng(5);
  g.fillStyle = lc(60, 49, 39); g.fillRect(BARK0, 0, AW - BARK0, AH);
  for (let i = 0; i < 70; i++) {
    const x = BARK0 + r() * (AW - BARK0), w = 0.6 + r() * 2.2, dark = r() < 0.6;
    g.strokeStyle = dark ? lc(30, 24, 19, 0.7) : lc(96, 82, 64, 0.5); g.lineWidth = w;
    g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= AH; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 1.5, y); g.stroke();
  }
}

// the levels below the full picture, down to 1 x 1 (WebGL1 wants them all): each one the average of four
// texels of the one above (weighted by how solid they are, so the cut-out's edges never go dark), then
// its cut-out grown until the same share of it passes alphaTest 0.5 as at full size. Worked out in
// plain arrays from one read of the painting.
function mipChain(cv) {
  const base = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, levels = [cv];
  const share = (hist, n, s) => { let c = 0; for (let a = 0; a < 256; a++) if (a * s >= 127.5) c += hist[a]; return c / n; };
  let w = cv.width, h = cv.height, P = new Float32Array(w * h * 4);
  const hist0 = new Float64Array(256);
  for (let i = 0; i < P.length; i += 4) { const a = base[i + 3] / 255; P[i] = base[i] * a; P[i + 1] = base[i + 1] * a; P[i + 2] = base[i + 2] * a; P[i + 3] = a; hist0[base[i + 3]]++; }
  const want = share(hist0, w * h, 1);
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), sx = w > 1 ? 2 : 1, sy = h > 1 ? 2 : 1, Q = new Float32Array(nw * nh * 4), hist = new Float64Array(256);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const o = (y * nw + x) * 4;
      for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) { const i = ((y * sy + dy) * w + x * sx + dx) * 4; Q[o] += P[i]; Q[o + 1] += P[i + 1]; Q[o + 2] += P[i + 2]; Q[o + 3] += P[i + 3]; }
      for (let c = 0; c < 4; c++) Q[o + c] /= sx * sy;
      hist[Math.round(Q[o + 3] * 255)]++;
    }
    let lo = 1, hi = 16;
    for (let n = 0; n < 18; n++) { const s = (lo + hi) / 2; if (share(hist, nw * nh, s) < want) lo = s; else hi = s; }
    const img = new ImageData(nw, nh), d = img.data;
    for (let i = 0; i < Q.length; i += 4) { const a = Q[i + 3]; if (a <= 0) continue; d[i] = Q[i] / a; d[i + 1] = Q[i + 1] / a; d[i + 2] = Q[i + 2] / a; d[i + 3] = Math.min(255, Math.round(a * 255 * hi)); }
    levels.push(img); P = Q; w = nw; h = nh;
  }
  return levels;
}

let ATLAS = null, WHITE = null;
const whiteMap = () => { if (!WHITE) { WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true; } return WHITE; };
export function lowPineAtlas() {
  if (ATLAS) return ATLAS;
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d', { willReadFrequently: true });          // (painted on the CPU: it is read back for the mipmaps, which a GPU canvas took 0.4 - 1.3 s to do in testing)
  STYLES.forEach((st, k) => paintFrond(g, k, st));
  paintBark(g);
  const t = new THREE.CanvasTexture(cv);
  t.mipmaps = mipChain(cv); t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  t.needsUpdate = true;
  return (ATLAS = t);
}

// ── the tree ────────────────────────────────────────────────────────────────────────────────
export function makeLowPine(opts = {}) {
  const o = { ...LOW_PINE_DEFAULTS, ...opts }, r = rng(o.seed * 7919 + 101), H = o.height, k = H / 22;
  const P = [], N = [], C = [], U = [], I = [];
  const vert = (p, n, c, u, v) => { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); C.push(c[0] / GAIN, c[1] / GAIN, c[2] / GAIN); U.push(u, v); return P.length / 3 - 1; };
  const Y = new THREE.Vector3(0, 1, 0), V = (x, y, z) => new THREE.Vector3(x, y, z);
  // a triangle the right way round: its front facing `up` (the side the light should come from)
  const tri = (a, b, c, pa, pb, pc, up) => { const f = V().subVectors(pb, pa).cross(V().subVectors(pc, pa)); if (f.dot(up) < 0) I.push(a, c, b); else I.push(a, b, c); };

  // the tiers: heights spaced wider at the bottom, reach from a cone narrowing to the leader, each tier
  // hanging far enough to reach down past the top of the one below (`overlap` tier gaps)
  const T = Math.max(1, Math.round(o.tiers)), y0 = o.crown * H, leaderBase = H - 2.8 * k, crownTop = leaderBase + 0.2 * k;
  const ys = [];
  for (let i = 0; i < T; i++) { const t = T === 1 ? 0 : i / (T - 1); ys.push(y0 + (crownTop - y0) * t * (1.3 - 0.3 * t)); }
  const tiers = ys.map((y, i) => {
    const t = T === 1 ? 0 : i / (T - 1), gap = T === 1 ? 2 * k : i ? y - ys[i - 1] : ys[1] - y;
    const R = Math.max(0.75 * k, o.radius * k * Math.pow((H - y) / (H - y0), 0.92));
    const droop = Math.min(1.25, Math.max(o.droop, Math.atan(o.overlap * gap / R))), h = R * Math.tan(droop);
    return { t, y, R, droop, len: R / Math.cos(droop), n: Math.max(2, Math.round(o.sides + (o.top - o.sides) * t)),
      yc: y - 0.5 * h, a: R * 0.75, b: Math.max(h, 0.35 * R) * 0.9, shade: 0.72 + 0.28 * t };
  });
  // a tier's lump normal: straight out from the trunk, tipped up by `lift` and more toward the tier's top,
  // less toward its hem, and never far from level (a card's back takes the normal turned round, so a
  // steep one would leave the undersides black)
  const lumpN = (p, tr, out) => { const hz = Math.hypot(p.x, p.z), h = hz > 0.3 * tr.R ? V(p.x / hz, 0, p.z / hz) : out.clone();
    return h.setY(Math.min(1.1, Math.max(-0.3, o.lift + 0.6 * (p.y - tr.yc) / tr.b))).normalize(); };
  const shadeOf = (v, tone, tr, j) => {                                // v: light 0..1; tone: -1 cool (inside) .. 1 warm (tips)
    const c = [1 + 0.03 * tone, 1 + 0.02 * tone, 1 - 0.05 * tone]; return c.map((x) => x * v * tr.shade * j); };

  // the fronds
  let fronds = 0;
  tiers.forEach((tr, ti) => {
    const turn = ti * 2.39996 + r() * 0.5;                            // each tier turned by the golden angle, so they never line up
    for (let f = 0; f < tr.n; f++) {
      const yaw = turn + (f + (r() - 0.5) * 0.5) / tr.n * Math.PI * 2, len = tr.len * (0.85 + 0.27 * r());
      const d = tr.droop + (r() - 0.5) * 0.2, hw = o.width * len * (0.9 + 0.2 * r()), foldL = o.fold * (0.7 + 0.6 * r()), foldR = o.fold * (0.7 + 0.6 * r());
      const out = V(Math.cos(yaw), 0, Math.sin(yaw)), side = V(-Math.sin(yaw), 0, Math.cos(yaw));
      const spine = out.clone().multiplyScalar(Math.cos(d)).addScaledVector(Y, -Math.sin(d)), up = out.clone().multiplyScalar(Math.sin(d)).addScaledVector(Y, Math.cos(d));
      const B = out.clone().multiplyScalar(0.12 * k).setY(tr.y), Tp = B.clone().addScaledVector(spine, len), S = B.clone().addScaledVector(spine, len * WIDE);
      const L = S.clone().addScaledVector(side, hw * Math.cos(foldL)).addScaledVector(up, -hw * Math.sin(foldL));
      const R = S.clone().addScaledVector(side, -hw * Math.cos(foldR)).addScaledVector(up, -hw * Math.sin(foldR));
      // the slopes' own facings, for the share of the normal that is the card's
      const fl = V().subVectors(L, B).cross(V().subVectors(Tp, B)).normalize(), fr = V().subVectors(Tp, B).cross(V().subVectors(R, B)).normalize();
      if (fl.dot(up) < 0) fl.negate(); if (fr.dot(up) < 0) fr.negate();
      const nOf = (p, own) => own.clone().lerp(lumpN(p, tr, out), o.lump).normalize();
      const pic = Math.floor(r() * STYLES.length), flip = r() < 0.5, u0 = (pic * FW + 5) / AW, u1 = ((pic + 1) * FW - 5) / AW, um = (u0 + u1) / 2;
      const v0 = 0.012, v1 = 0.988, vs = v0 + (v1 - v0) * WIDE, j = 0.9 + 0.2 * r();
      const iB = vert(B, nOf(B, up), shadeOf(o.inner, -1, tr, j), um, v0);
      const iL = vert(L, nOf(L, fl), shadeOf(0.72, 0.2, tr, j), flip ? u1 : u0, vs);
      const iT = vert(Tp, nOf(Tp, up), shadeOf(1, 1, tr, j), um, v1);
      const iR = vert(R, nOf(R, fr), shadeOf(0.72, 0.2, tr, j), flip ? u0 : u1, vs);
      tri(iB, iL, iT, B, L, Tp, fl); tri(iB, iT, iR, B, Tp, R, fr);
      fronds++;
    }
  });

  // the trunk: five sides, from the ground to inside the crown; bark from the strip at the picture's edge
  const sidesT = 5, rb = 0.32 * k, rt = 0.05 * k, top = crownTop - 0.3 * k, ub0 = (BARK0 + 3) / AW, ub1 = (AW - 3) / AW;
  const ring = (y, rad, light) => { const ids = []; for (let s = 0; s <= sidesT; s++) { const a = s / sidesT * Math.PI * 2 + 0.3, n = V(Math.cos(a), 0.15, Math.sin(a)).normalize();
    ids.push(vert(V(Math.cos(a) * rad, y, Math.sin(a) * rad), n, [light, light * 0.97, light * 0.92], ub0 + (ub1 - ub0) * s / sidesT, 0.01 + 0.98 * y / top)); } return ids; };
  const lo = ring(0, rb, 0.85), hi = ring(top, rt, 0.3);
  for (let s = 0; s < sidesT; s++) { I.push(lo[s], hi[s + 1], hi[s], lo[s], lo[s + 1], hi[s + 1]); }
  // which way round the trunk faces is fixed by the ring order: check it faces out
  { const a = V(P[lo[0] * 3], P[lo[0] * 3 + 1], P[lo[0] * 3 + 2]), b = V(P[hi[1] * 3], P[hi[1] * 3 + 1], P[hi[1] * 3 + 2]), c = V(P[hi[0] * 3], P[hi[0] * 3 + 1], P[hi[0] * 3 + 2]);
    const f = V().subVectors(b, a).cross(V().subVectors(c, a)), mid = a.clone().add(b).add(c).setY(0);
    if (f.dot(mid) < 0) for (let q = I.length - sidesT * 6; q < I.length; q += 3) { const tmp = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = tmp; } }

  // the leader: three sides rising to the top, each the upper half of a frond picture
  { const yb = leaderBase, rr = 0.55 * k, turn = r() * 6.283, apex = V(0, H, 0), u0 = 5 / AW, u1 = (FW - 5) / AW, um = (u0 + u1) / 2;
    const cnt = 3, base = [];
    for (let s = 0; s < cnt; s++) { const a = turn + s / cnt * Math.PI * 2; base.push(V(Math.cos(a) * rr, yb, Math.sin(a) * rr)); }
    for (let s = 0; s < cnt; s++) {
      const p = base[s], q = base[(s + 1) % cnt], mid = p.clone().add(q).multiplyScalar(0.5).setY(0).normalize(), n = mid.clone().addScaledVector(Y, 0.9).normalize();
      const np = p.clone().setY(0).normalize().addScaledVector(Y, 0.9).normalize(), nq = q.clone().setY(0).normalize().addScaledVector(Y, 0.9).normalize();
      const ia = vert(p, np, [0.85, 0.86, 0.8], u0, 0.012 + 0.976 * WIDE), ib = vert(q, nq, [0.85, 0.86, 0.8], u1, 0.012 + 0.976 * WIDE), ic = vert(apex, Y, [1.05, 1.04, 0.9], um, 0.988);
      tri(ia, ib, ic, p, q, apex, n);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I); geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ name: 'lowPineCards', map: lowPineAtlas(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  if (o.glow > 0) { mat.lightMap = whiteMap(); mat.lightMapIntensity = o.glow; }
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'lowPine'; mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group(); group.name = 'lowPineCards'; group.add(mesh);
  group.userData.tris = I.length / 3; group.userData.fronds = fronds;
  return group;
}
