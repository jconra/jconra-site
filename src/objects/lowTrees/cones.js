// LOW PINE (cones): a conifer in about a hundred triangles, for weak machines and far-off stands.
// A plain tapered trunk hung with eight branch tiers, each a low cone, open underneath. Every cone wears
// the same picture, made here in code: a disc of bold saw-tooth fir sprigs in rows from the middle out,
// each row lighter and yellower than the one under it and edged with a soft dark shadow, the last row's
// tips cut out to make the rim. The disc is laid on each cone as if seen from straight above, turned
// (and every other one mirrored) so no two tiers match, so a tier's rim is ragged and round although
// the cone has only six sides.
//
// The light does the rest. Each tier's normals run from straight up at the trunk to well out at the rim,
// so a tier lights as one rounded lump: bright on top and on the sun's side, falling away round the
// back; seen from below, its underside faces down and stays dark (a little of the picture's own colour
// is added unlit, so dark green rather than black). Vertex colours darken each tier toward the trunk,
// and the lower tiers a little more (the inside of a tree sees less sky). The lower tiers get a ring
// part-way out, flatter inside it and steeper outside, so they droop at the tips.
//
// Far off, the picture's smaller copies (mipmaps) are made here too, each with its cut-out thickened so
// the same share of it stays solid: otherwise the sprigs thin out with distance and the tree goes
// see-through. Under the sprigs, too faint to pass the cut, lies their own colour smeared outward, so a
// sample at a cut edge stays sprig-coloured instead of half black.
//
//   makeLowPine(opts) -> THREE.Group, one mesh (trunk and tiers, one material; the picture shared by all)
//   opts: LOW_PINE_DEFAULTS, any of them; the same seed makes the same tree
//   lowPineTexture(res, look) -> the picture (made once per res and look, then shared)
// Triangles: sides per plain tier, 3 x sides per drooping tier, 2 x trunk sides. With the defaults:
// 4 drooping tiers x 18 + 4 plain x 6 + trunk 10 = 106 (no drooping tiers: 58). The picture: res x res
// (1024: 4 MB, 5.3 MB with mipmaps; 512 a quarter of that).
// As a Forest species: { name, root: makeLowPine(), height: 22, weight: 1, tint: false } (the picture
// carries its own colour; the forest's green tint on top goes greener). No soften, shape or upNormals:
// they light both sides of a card alike, and the dark undersides go.
import * as THREE from 'three';

export const LOW_PINE_DEFAULTS = {
  height: 22,    // m, base at y = 0
  tiers: 8,      // branch tiers, the top one the spire
  sides: 6,      // corners round each tier (6 .. 9: fewer would reach the bark in the picture)
  bent: 4,       // how many of the lowest tiers droop at the tips (a ring part-way out: 3 triangles per side, not 1)
  droop: 36,     // the lowest tier's slope (degrees below level); higher tiers steeper, the spire 1.6 times this
  width: 0.24,   // the lowest tier's reach as a share of the height
  base: 0.26,    // the lowest tier's top as a share of the height
  bulge: 2,      // how far a tier's normals lean out at its rim (0: all straight up, flat lighting)
  inside: 0.36,  // a tier's brightness at the trunk (vertex colour; 1 at its rim)
  glow: 0.15,    // a little of the picture's own colour added unlit, so an underside in shade is dark green, not black
  trunk: 5,      // the trunk's sides
  seed: 1,
  res: 1024,     // the picture's size (px, a power of two); 512 for the weakest machines
  look: 1,       // which picture (its own seed): trees sharing it share one texture
};

function rng(seed) {                                                   // a small seeded random (mulberry32)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const canvas = (w) => { const c = document.createElement('canvas'); c.width = c.height = w; return c; };

// the disc's radius and the bark's corner square, both as shares of the picture (u, v)
const DISC = 0.48, BARK = 0.1;

export function makeLowPine(opts = {}) {
  const o = { ...LOW_PINE_DEFAULTS, ...opts }, r = rng(o.seed * 7919 + 101);
  const H = o.height, T = Math.max(2, Math.round(o.tiers)), n = Math.min(9, Math.max(6, Math.round(o.sides))), m = Math.max(3, Math.round(o.trunk));
  const P = [], N = [], C = [], U = [], I = [];
  const vert = (x, y, z, nx, ny, nz, c, u, v) => { P.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l); C.push(c[0], c[1], c[2]); U.push(u, v); return P.length / 3 - 1; };
  // the trunk: a tapered prism, open at both ends, its picture the bark square in the corner
  const rb = 0.013 * H, rt = 0.003 * H, top = 0.96 * H, b0 = 0.012, b1 = BARK - 0.012;
  for (let k = 0; k <= m; k++) {
    const a = k / m * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a), u = b0 + (b1 - b0) * k / m;
    vert(cx * rb, 0, cz * rb, cx, 0.15, cz, [0.85, 0.8, 0.74], u, b0);
    vert(cx * rt, top, cz * rt, cx, 0.15, cz, [0.3, 0.29, 0.27], u, b1);
  }
  for (let k = 0; k < m; k++) { const b = k * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  // the tiers, lowest first
  const a0 = (o.base + (r() - 0.5) * 0.06) * H, Rb = o.width * (1 + (r() - 0.5) * 0.16) * H, Rt = 0.055 * H, rho = DISC / Math.cos(Math.PI / n), gap = (H - a0) / (T - 1);
  for (let i = 0; i < T; i++) {
    const f = i / (T - 1), spire = i === T - 1, bent = i < o.bent && !spire;
    const apex = spire ? H : a0 + (H - a0) * Math.pow(f, 0.9) + (r() - 0.5) * 0.3 * gap;
    const R = (Rt + (Rb - Rt) * Math.pow(1 - f, 0.9)) * (spire ? 1 : 1 + (r() - 0.5) * 0.2);
    const drop = R * Math.tan((o.droop * (1 + 0.6 * f * f) + (spire ? 0 : (r() - 0.5) * 6)) * Math.PI / 180);
    // tipped a little (one side of the tier droops lower), turned, and its picture turned and maybe mirrored
    const tilt = spire ? 0 : r() * 0.1, ta = r() * Math.PI * 2, turn = r() * Math.PI * 2, uvTurn = r() * Math.PI * 2, mir = i % 2 ? -1 : 1;
    const shade = (0.74 + 0.26 * f) * (0.94 + r() * 0.12), cIn = (spire ? 0.8 : o.inside) * shade;
    const colour = (t) => { const s = cIn + (shade - cIn) * Math.pow(t, 0.6), warm = t * t * 0.1; return [s * (1 + warm * 0.3), s, s * (1 - warm)]; };
    const at = (k, t, y, j) => {                                        // corner k at t (0 trunk .. 1 rim) out, `y` below the apex
      const a = turn + k / n * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a), ua = mir * (a + uvTurn);
      const x = cx * R * t * j, z = cz * R * t * j, lean = o.bulge * t;
      return vert(x, apex - y + (x * Math.cos(ta) + z * Math.sin(ta)) * tilt, z, cx * lean, 1, cz * lean, colour(t), 0.5 + Math.cos(ua) * rho * t, 0.5 + Math.sin(ua) * rho * t);
    };
    const A = vert(0, apex, 0, 0, 1, 0, colour(0), 0.5, 0.5);
    const jit = []; for (let k = 0; k < n; k++) jit.push([1 + (r() - 0.5) * 0.16, (r() - 0.5) * 0.06 * drop]);
    const rim = jit.map(([j, dy], k) => at(k, 1, drop + dy, j));
    if (!bent) { for (let k = 0; k < n; k++) I.push(A, rim[(k + 1) % n], rim[k]); continue; }
    // a drooping tier: a ring 45% out, only 25 - 35% of the drop down
    const share = 0.25 + r() * 0.1, ring = jit.map(([j], k) => at(k, 0.45, drop * share, 1 + (j - 1) * 0.5));
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      I.push(A, ring[k1], ring[k], ring[k], ring[k1], rim[k], ring[k1], rim[k1], rim[k]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I); geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ name: 'lowPine', map: lowPineTexture(o.res, o.look), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.95, metalness: 0 });
  if (o.glow > 0) { mat.emissiveMap = mat.map; mat.emissive.setScalar(o.glow); }
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'lowPine'; mesh.castShadow = mesh.receiveShadow = true;
  const g = new THREE.Group(); g.name = 'lowPine'; g.add(mesh); g.userData.tris = I.length / 3;
  return g;
}

// ── the picture ──────────────────────────────────────────────────────────────────────────────
const PICS = new Map();
export function lowPineTexture(res = 1024, look = 1) {
  const key = res + ':' + look;
  if (PICS.has(key)) return PICS.get(key);
  const hsl = (h, s, l) => `hsl(${h * 360},${s * 100}%,${l * 100}%)`;
  const S = res, art = canvas(S), g = art.getContext('2d'), r = rng(look * 104729 + 7), Cx = S / 2, Rd = DISC * S;
  // one tooth (on g): a narrow triangle from (x, y) along angle a, its outer part lighter, one side lighter still (the lit edge)
  const tooth = (g, x, y, a, len, w, body, tip, edge) => {
    const cx = Math.cos(a), cy = Math.sin(a), px = -cy * w, py = cx * w, tx = x + cx * len, ty = y + cy * len, mx = x + cx * len * 0.35, my = y + cy * len * 0.35;
    g.fillStyle = body; g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(tx, ty); g.lineTo(x - px, y - py); g.fill();
    g.fillStyle = tip; g.beginPath(); g.moveTo(mx + px * 0.65, my + py * 0.65); g.lineTo(tx, ty); g.lineTo(mx - px * 0.65, my - py * 0.65); g.fill();
    if (edge) { g.fillStyle = edge; g.beginPath(); g.moveTo(mx + px * 0.65, my + py * 0.65); g.lineTo(tx, ty); g.lineTo(mx + px * 0.1, my + py * 0.1); g.fill(); }
  };
  // one sprig (on g): a short stem from radius r0 at angle `at`, pointing along a (about straight out),
  // broad teeth both sides, longest at its foot and angled forward: its outline a saw-tooth tapering to a point
  const sprig = (g, at, r0, a, L, w, body, tip, edge) => {
    const cx = Math.cos(a), cy = Math.sin(a), x0 = Cx + Math.cos(at) * r0, y0 = Cx + Math.sin(at) * r0, pairs = 4 + Math.round(r() * 2);
    g.strokeStyle = body; g.lineWidth = w * 0.22; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + cx * L, y0 + cy * L); g.stroke();
    for (let j = 0; j < pairs; j++) {
      const s = (j + 0.2 + r() * 0.3) / pairs, x = x0 + cx * L * s, y = y0 + cy * L * s, len = w * (1.1 - 0.65 * s) * (0.8 + 0.4 * r()), fan = 0.75 + 0.3 * r();
      tooth(g, x, y, a + fan, len, len * 0.34, body, tip, edge); tooth(g, x, y, a - fan, len * (0.85 + 0.3 * r()), len * 0.34, body, tip, null);
    }
    tooth(g, x0 + cx * L * 0.85, y0 + cy * L * 0.85, a, w * 0.75, w * 0.22, body, tip, edge);
  };
  // the very middle filled (small, so the spire's tip is sprigs too)
  g.fillStyle = hsl(0.25, 0.26, 0.16); g.beginPath(); g.arc(Cx, Cx, Rd * 0.1, 0, Math.PI * 2); g.fill();
  // rows of bold sprigs from the middle out, each row lighter and laid over the last with a soft dark
  // halo (its shadow on the sprigs below), the last row's tips the rim: so every sprig stands out light
  // against dark gaps, as the sprigs of a real branch do
  const L = Rd * 0.24, w = Rd * 0.085, rows = 8, last = Rd - L * 0.85 - w * 0.75, lay = canvas(S), lg = lay.getContext('2d'), sh = canvas(S >> 3), hg = sh.getContext('2d');
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1), r0 = Rd * 0.02 + (last - Rd * 0.06 - Rd * 0.02) * t, count = Math.max(6, Math.round(1.3 * Math.PI * 2 * (r0 + L / 2) / (1.4 * w)));
    lg.clearRect(0, 0, S, S);
    for (let k = 0; k < count; k++) {
      const a = (k + r() * 0.7) / count * Math.PI * 2, l = 0.15 + 0.09 * Math.pow(t, 1.2) + (r() - 0.5) * 0.04;
      sprig(lg, a, r0 + r() * Rd * 0.06, a + (r() - 0.5) * 0.5, L * (0.8 + 0.3 * r()), w * (0.85 + 0.3 * r()), hsl(0.25, 0.24, l), hsl(0.21, 0.27, l + 0.06 + 0.08 * t), t > 0.4 && r() < 0.6 ? hsl(0.19, 0.32, l + 0.2) : null);
    }
    // the halo: the row's outline shrunk to an eighth, blacked, and stretched back (cheaper than a blur)
    hg.globalCompositeOperation = 'copy'; hg.drawImage(lay, 0, 0, sh.width, sh.width); hg.globalCompositeOperation = 'source-in'; hg.fillStyle = '#000'; hg.fillRect(0, 0, sh.width, sh.width);
    g.globalAlpha = 0.45; g.drawImage(sh, 0, 0, S, S); g.globalAlpha = 1; g.drawImage(lay, 0, 0);
  }
  // the bark, in the bottom-left corner (u, v 0 .. BARK): grey-brown, streaked along the trunk
  const B = Math.round(BARK * S), by = S - B;
  g.fillStyle = '#5a4d40'; g.fillRect(0, by, B, B);
  for (let x = 0; x < B;) { const sw = 1 + r() * 4 * S / 1024; g.fillStyle = r() < 0.6 ? 'rgba(40,32,26,0.6)' : 'rgba(130,116,96,0.45)'; g.fillRect(x, by, sw, B); x += sw + r() * 3 * S / 1024; }
  // the colour smear under it all: the sprigs' own colour averaged over 1/16 of the picture, filled in
  // where there were none, almost transparent
  const sm = canvas(S >> 4), sg = sm.getContext('2d', { willReadFrequently: true }); sg.drawImage(art, 0, 0, sm.width, sm.width);
  { const d = sg.getImageData(0, 0, sm.width, sm.width), a = d.data;
    for (let q = 0; q < a.length; q += 4) if (a[q + 3] < 8) { a[q] = 34; a[q + 1] = 44; a[q + 2] = 20; a[q + 3] = 255; } else a[q + 3] = 255;
    sg.putImageData(d, 0, 0); }
  const base = canvas(S), bg = base.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingEnabled = true; bg.drawImage(sm, 0, 0, S, S);
  { const d = bg.getImageData(0, 0, S, S), a = d.data; for (let q = 3; q < a.length; q += 4) a[q] = 18; bg.putImageData(d, 0, 0); }
  bg.drawImage(art, 0, 0);
  // the mipmaps, each halving the last, its cut-out thickened (alpha scaled up, at most 3 times) to keep level 0's share of solid
  const levels = [base], hist = (a) => { const h = new Uint32Array(256); for (let q = 3; q < a.length; q += 4) h[a[q]]++; return h; };
  const solid = (h, k, total) => { let c = 0; for (let v = 0; v < 256; v++) if (v * k >= 127.5) c += h[v]; return c / total; };
  const want = solid(hist(bg.getImageData(0, 0, S, S).data), 1, S * S);
  for (let e = S >> 1; e >= 1; e >>= 1) {
    const c = canvas(e), cg = c.getContext('2d', { willReadFrequently: true }); cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = 'high'; cg.drawImage(levels[levels.length - 1], 0, 0, e, e);
    const d = cg.getImageData(0, 0, e, e), a = d.data, h = hist(a);
    let lo = 1, hi = 3; if (solid(h, 1, e * e) < want) { for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (solid(h, mid, e * e) < want) lo = mid; else hi = mid; } } else hi = 1;
    if (hi > 1) { for (let q = 3; q < a.length; q += 4) a[q] = Math.min(255, Math.round(a[q] * hi)); cg.putImageData(d, 0, 0); }
    levels.push(c);
  }
  const tex = new THREE.CanvasTexture(base);
  tex.mipmaps = levels; tex.generateMipmaps = false; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
  PICS.set(key, tex);
  return tex;
}
