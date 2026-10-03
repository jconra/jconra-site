// LOW PINE (stars): a conifer of about a hundred triangles, for weak machines and anywhere else. Each
// tier of branches is one star built in geometry: a fan from the trunk out to a handful of points that
// hang down. Every point is a ridge with two faces (the notches between the points sit lower than the
// ridges and nearer the trunk), so from above a tier is a star of folded branches and from the side its
// lower edge is a saw-tooth: the tips hang lowest, the notches ride high. The light does the rest:
//   - vertex colours: near-black olive at the trunk, dull olive by the notches (darker still in them),
//     yellow-green only out at the tips (the outer sprigs are the ones in the sun); lower tiers darker;
//   - normals of our own: each face's own facing, bent toward the way out from the trunk and up, so a
//     tier lights as one lump (its sunny top and outer side bright, its far side dim) but stays faceted;
//   - both sides drawn: seen from underneath a face turns its normal down, so every tier's underside is
//     dark against the lit top of the tier below (a faint light of its own keeps it off pure black);
//   - one small grey picture made here (128 px, shared by every tree): rows of sprigs like shingles on
//     every face, each bright at its point and dark where the row above shades it, and the outermost row's
//     points cut out of the edge (alpha), so each branch ends in a serrated fringe instead of a straight
//     line. { grain: 0, teeth: 0 } leaves it off: pure flat facets, no picture at all.
// The trunk is an open tapered prism, its top hidden up in the tiers. Built 1 unit = 1 m, the base at y = 0.
//
//   makeLowPine(opts) -> THREE.Group named 'lowPine' with meshes 'trunk' and 'leaves' (userData.tris)
//   lowPineTris(opts) -> the triangles it will have
//   opts: any of PINE_DEFAULTS; the same seed always gives the same tree
// Triangles at the defaults: 8 tiers of 8, 8, 7, 7, 6, 6, 5, 5 points, two each (104), and the trunk's 5
// sides, two each (10): 114 in all. As a Forest species: { name, root: makeLowPine(), height: 22, weight: 1,
// tint: false } keeps its own colours (the forest's usual green tint would darken and green it twice).
import * as THREE from 'three';

export const PINE_DEFAULTS = {
  height: 22,       // m
  tiers: 8,         // stars of branches, bottom to top
  sides: 8,         // points on the lowest star; the stars above have fewer, down to sidesTop at the top
  sidesTop: 5,
  spread: 0.23,     // the lowest star's reach (share of the height); the top star's is topSpread
  topSpread: 0.05,
  bare: 0.14,       // bare trunk under the lowest tips (share of the height)
  droop: 1.1,       // how far the lowest star's points hang, per metre out; droopTop at the top star
  droopTop: 2.0,
  notch: 0.7,       // the notches between the points this share of the way out
  pleat: 0.06,      // each notch this far below the ridges either side (share of the star's reach)
  jitter: 0.16,     // how irregular the points are (length, angle, hang)
  facet: 0.4,       // 0: every tier lit as a smooth lump, 1: every face by its own facing
  out: 1.2,         // how far the tips' normals lean outward (0: straight up)
  inner: 0x182014,  // colours (sRGB): at the trunk, between the points, at the tips, the bark
  mid: 0x334230,
  tip: 0x6c8250,
  bark: 0x6b5443,
  grain: 1,         // how strongly the sprig picture shades (0 with teeth 0: no picture at all)
  teeth: 0.12,      // the branch ends cut into sprig points this deep (alpha, share of the face); 0: straight edges
  sprig: 0.22,      // a sprig this wide along the outer edges (share of the star's reach)
  rows: 4,          // rows of sprigs from the edge in
  crease: 0.5,      // the notches' colour times this (the deep gaps between the branches)
  lift: 0x1a2410,   // a little light of its own (sRGB), so the undersides read as dark olive, not black
  trunkSides: 5,
  trunkWidth: 0.32, // the trunk's radius at the ground (m)
  tilt: 0.05,       // each star tipped a little off level (radians, at most), and its reach varied by `vary`
  vary: 0.1,
  seed: 1,
};

function rng(seed) {                                                   // a small seeded random (mulberry32)
  let a = (seed * 2654435761 + 7) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;

// the stars' sizes and heights: the reach shrinks a little faster than straight toward the top; each star's
// middle (where it meets the trunk) is placed so the lowest tips sit at `bare` and the top star's middle is
// the tree's top, the gaps between them in proportion to the stars' reach (small stars packed closer)
function layout(o) {
  const H = o.height, T = Math.max(2, Math.round(o.tiers)), tiers = [];
  for (let k = 0; k < T; k++) {
    const t = k / (T - 1), R = H * lerp(o.topSpread, o.spread, Math.pow(1 - t, 1.15));
    tiers.push({ t, R, drop: R * lerp(o.droop, o.droopTop, t * t), n: Math.max(3, Math.round(lerp(o.sides, o.sidesTop, t))) });
  }
  const y0 = H * o.bare + tiers[0].drop, gaps = [];
  for (let k = 0; k < T - 1; k++) gaps.push(tiers[k].R + tiers[k + 1].R);
  const sum = gaps.reduce((a, b) => a + b, 0);
  let y = y0;
  tiers.forEach((s, k) => { s.y = y; if (k < T - 1) y += (H - y0) * gaps[k] / sum; });
  return tiers;
}

export const lowPineTris = (opts = {}) => { const o = { ...PINE_DEFAULTS, ...opts }; return layout(o).reduce((a, s) => a + 2 * s.n, 0) + 2 * Math.max(3, Math.round(o.trunkSides)); };

// The sprig picture: grey, laid on each face with s along its outer edge (one sprig per unit; a notch falls
// in a gap, a tip on a sprig) and t from the trunk (0) to the edge (1). `rows` rows of sprigs like shingles,
// each row's points lying over the base of the row further out: a sprig bright at its point, dark where the
// row above shades it, a little darker at its sides. Far off it averages out to a plain darkening (the colours
// allow for it). teeth > 0 cuts the outermost row's points out of the edge (alpha, cut at 0.5), each sprig's
// end a main point with a smaller one either side, this deep (share of the face).
const PICS = new Map();
function sprigPicture(grain, teeth, rows) {
  const key = [grain, teeth, rows].join();
  if (PICS.has(key)) return PICS.get(key);
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), r = rng(91), fine = [];
  for (let x = 0; x < S; x++) fine.push(0.93 + r() * 0.07);
  const d = Math.max(teeth, 0.08), h = 0.9 / rows;
  const gap = (x) => Math.abs(2 * (x - Math.floor(x)) - 1);              // 0 mid-sprig, 1 in a gap
  const prof = (x) => 0.62 * gap(x) + 0.38 * gap(3 * x);                 // a sprig's end: one main point, a smaller one either side
  const edgeT = (j, s) => 1 - j * h - d * prof(s + j * 0.5);             // where row j's points reach (the rows staggered)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const s = (x + 0.5) / S, t = 1 - (y + 0.5) / S;
    let j = 0; while (j + 1 < rows && t <= edgeT(j + 1, s)) j++;            // the innermost row reaching here lies on top
    const top = edgeT(j, s), base = j + 1 < rows ? edgeT(j + 1, s) : 0, f = Math.max(0, Math.min(1, (t - base) / Math.max(1e-3, top - base)));
    const v = (0.36 + 0.64 * Math.pow(f, 1.7)) * (1 - 0.25 * Math.pow(gap(s + j * 0.5), 2) * (0.4 + 0.6 * f)) * fine[x];
    const k = (y * S + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round((1 - grain * (1 - Math.min(1, v))) * 255);
    // alpha: the distance in from the cut, in pixels, so the edge stays clean however near
    img.data[k + 3] = teeth > 0 ? Math.round(Math.max(0, Math.min(1, 0.5 + (edgeT(0, s) - t) * S * 0.35)) * 255) : 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.name = 'lowPineSprigs'; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  PICS.set(key, tex);
  return tex;
}

export function makeLowPine(opts = {}) {
  const o = { ...PINE_DEFAULTS, ...opts }, r = rng(o.seed), tiers = layout(o);
  const col = (hex) => new THREE.Color(hex);                             // (sRGB in, the working colours out)
  const C0 = col(o.inner), C1 = col(o.mid), C2 = col(o.tip), c = new THREE.Color();
  // the colour at a share f of the way out from the trunk: dark, olive by the notches, bright only near the tips
  const shade = (f, k) => (f < o.notch ? c.copy(C0).lerp(C1, f / o.notch) : c.copy(C1).lerp(C2, (f - o.notch) / (1 - o.notch))).multiplyScalar(k);
  const P = [], N = [], C = [], U = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), fn = new THREE.Vector3(), n = new THREE.Vector3(), L = new THREE.Vector3();
  // one triangle: its own facing (turned to face up) mixed with each corner's lump normal (out and up)
  const tri = (vs, uv) => {
    a.subVectors(vs[1].p, vs[0].p); b.subVectors(vs[2].p, vs[0].p); fn.crossVectors(a, b).normalize();
    if (fn.y < 0) { vs = [vs[0], vs[2], vs[1]]; uv = [uv[0], uv[2], uv[1]]; fn.negate(); }
    vs.forEach((v, i) => {
      const h = Math.hypot(v.p.x, v.p.z), f = v.f;
      L.set(h > 1e-6 ? v.p.x / h * o.out * f : 0, 1, h > 1e-6 ? v.p.z / h * o.out * f : 0).normalize();
      n.copy(fn).multiplyScalar(o.facet).addScaledVector(L, 1 - o.facet).normalize();
      P.push(v.p.x, v.p.y, v.p.z); N.push(n.x, n.y, n.z); C.push(v.c.r, v.c.g, v.c.b); U.push(uv[i][0], uv[i][1]);
    });
  };
  const lean = new THREE.Quaternion(), ax = new THREE.Vector3();
  for (const s of tiers) {
    const k = s.n, spin = r() * Math.PI * 2, J = o.jitter, { y, t } = s, sz = 1 + (r() - 0.5) * 2 * o.vary, R = s.R * sz, drop = s.drop * sz;
    const ta = r() * Math.PI * 2; lean.setFromAxisAngle(ax.set(Math.cos(ta), 0, Math.sin(ta)), o.tilt * (0.4 + 0.6 * r()));
    const tierK = lerp(0.82, 1.12, t);                                    // the lower tiers darker overall, the top in open sky
    const mid = { p: new THREE.Vector3(0, y, 0), f: 0, c: shade(0, tierK).clone() };
    const tips = [], notches = [];
    for (let i = 0; i < k; i++) {
      const ang = spin + (i + (r() - 0.5) * J * 0.8) / k * Math.PI * 2, len = R * (1 + (r() - 0.5) * 1.5 * J), hang = drop * (len / R) * (1 + (r() - 0.5) * J);
      tips.push({ p: new THREE.Vector3(Math.cos(ang) * len, y - hang, Math.sin(ang) * len), f: 1, c: shade(1, tierK * (1 + (r() - 0.5) * 0.25)).clone(), ang });
    }
    for (let i = 0; i < k; i++) {
      let a0 = tips[i].ang, a1 = tips[(i + 1) % k].ang; if (a1 < a0) a1 += Math.PI * 2;
      const ang = lerp(a0, a1, 0.5 + (r() - 0.5) * J * 0.5), rn = R * o.notch * (1 + (r() - 0.5) * J);
      const f = rn / R, yn = y - drop * f - o.pleat * R * (0.7 + r() * 0.6);
      notches.push({ p: new THREE.Vector3(Math.cos(ang) * rn, yn, Math.sin(ang) * rn), f, c: shade(f, tierK * o.crease).clone() });
    }
    for (const v of [...tips, ...notches]) v.p.setY(v.p.y - y).applyQuaternion(lean).setY(v.p.y + y);
    // each point: the face before its ridge and the face after (notch i sits after tip i); along each outer
    // edge a whole number of sprigs and a half, so a notch falls in a gap and a tip on a sprig
    const sprig = Math.max(0.2, R * o.sprig), count = (p, q) => Math.max(0, Math.round(p.p.distanceTo(q.p) / sprig - 0.5)) + 0.5;
    for (let i = 0; i < k; i++) {
      const nA = notches[(i + k - 1) % k], nB = notches[i], eA = count(nA, tips[i]), eB = count(tips[i], nB);
      tri([mid, nA, tips[i]], [[eA / 2, 0], [0, 1], [eA, 1]]);
      tri([mid, tips[i], nB], [[eA + eB / 2, 0], [eA, 1], [eA + eB, 1]]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const pic = o.grain > 0 || o.teeth > 0 ? sprigPicture(o.grain, o.teeth, Math.max(1, Math.round(o.rows))) : null;
  const leaves = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'leaves', vertexColors: true, roughness: 0.92, metalness: 0, emissive: o.lift, side: THREE.DoubleSide,
    map: pic, alphaTest: o.teeth > 0 ? 0.5 : 0 }));
  leaves.name = 'leaves';
  // the trunk: open at both ends, up to the third star from the top (hidden from there on)
  const ts = Math.max(3, Math.round(o.trunkSides)), top = tiers[Math.max(0, tiers.length - 3)].y, TP = [], TN = [];
  for (let i = 0; i < ts; i++) {
    const a0 = i / ts * Math.PI * 2, a1 = (i + 1) / ts * Math.PI * 2, r0 = o.trunkWidth, r1 = o.trunkWidth * 0.2;
    const q = (ang, rad, yy) => { TP.push(Math.cos(ang) * rad, yy, Math.sin(ang) * rad); TN.push(Math.cos(ang) * 0.99, 0.15, Math.sin(ang) * 0.99); };
    q(a0, r0, 0); q(a1, r1, top); q(a1, r0, 0); q(a0, r0, 0); q(a0, r1, top); q(a1, r1, top);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(TP, 3)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(TN, 3)); tg.computeBoundingSphere();
  const trunk = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ name: 'bark', color: o.bark, roughness: 1, metalness: 0 }));
  trunk.name = 'trunk';
  for (const m of [leaves, trunk]) { m.castShadow = true; m.receiveShadow = true; }
  const root = new THREE.Group(); root.name = 'lowPine'; root.add(trunk, leaves);
  root.userData.tris = P.length / 9 + TP.length / 9;
  return root;
}
