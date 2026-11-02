// THE WESTERN SIGNPOST: rough-sawn boards with hand-burnt lettering on a rough-hewn post, stones at its foot. A copy of Mathwood
// Valley's world/objects/signpost.js (math-games repo), its look unchanged; here the boards name this town's places, each post's
// boards turned to point at them from wherever that post stands, and the lettering's font is loaded here.
//
//   SIGN_PLACES                       { text, x, z, len (board length, m) }: where the boards point (the town's layout, metres)
//   boardsAt(x, z, rot)               -> the boards for a post standing there, turned rot degrees
//   signTexture(boards)               -> the boards' picture (a canvas texture, 512 x 512: a strip a board, the post's bark);
//                                     drawn again when the font arrives
//   signpostParts(boards, rand)       -> [{ mat: 'sign' | 'matte', geo, colour }]: geometry in the post's own frame, its foot at
//                                     y = 0; 'sign' wears signTexture, 'matte' takes a colour per part
import * as THREE from 'three';

export const SIGN_PLACES = [
  { text: 'TOWN HALL', x: -9, z: -224, len: 0.98 }, { text: 'OBSERVATORY', x: -17, z: -292, len: 1.3 },
  { text: 'HANGAR', x: -88, z: -223, len: 0.84 }, { text: 'THE DOCK', x: 28, z: -91, len: 0.94 },
];
const SIGN_Y = [2.12, 1.9, 1.68, 1.46];   // (each board's height on the post, m)
export const boardsAt = (x, z, rot = 0) => SIGN_PLACES.map((p, i) => ({ text: p.text, len: p.len, y: SIGN_Y[i], ang: Math.atan2(z - p.z, p.x - x) - rot * Math.PI / 180 }));   // (ang: radians about the post; 0 points along +x)
const TAIL = -0.1, POINT = 0.17, POST_CLEAR = 0.1;   // (a board's tail behind the post, its point, and how far out the post stops hiding it)
// where a board's lettering sits along its strip (0..1): past the post and short of the point. Both faces use this same stretch of
// the board, so the post hides no letters from behind
const textSpan = (L) => [(POST_CLEAR - TAIL) / (L - TAIL), (L - POINT - TAIL) / (L - TAIL)];
const ROW = 96, POST_ROW = 4;   // (a board's strip's height in the picture, and where the bark's strip starts)

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// a strip of old grey-brown sawn plank, its grain running along it, saw marks across
function plank(g, x, y, w, h, base, R) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  for (let i = 0; i < 90; i++) {   // the grain: long wavering lines, dark and pale
    const yy = y + R() * h, a = 0.05 + R() * 0.12; g.strokeStyle = R() < 0.65 ? `rgba(30,20,12,${a})` : `rgba(215,195,165,${a * 0.7})`; g.lineWidth = 0.6 + R() * 1.1;
    g.beginPath(); let px = x - 5, py = yy; g.moveTo(px, py); while (px < x + w + 5) { px += 24 + R() * 30; py += (R() - 0.5) * 2.4; g.lineTo(px, py); } g.stroke();
  }
  for (let sx = x; sx < x + w; sx += 7 + R() * 16) { g.fillStyle = `rgba(25,16,10,${0.03 + R() * 0.05})`; g.fillRect(sx, y, 1 + R() * 1.5, h); }   // the saw's marks
  for (let i = 0; i < 3; i++) { const kx = x + R() * w, ky = y + R() * h; g.fillStyle = 'rgba(30,18,10,0.35)'; g.beginPath(); g.ellipse(kx, ky, 4 + R() * 7, 2 + R() * 3, 0, 0, 7); g.fill(); }   // knots
}
// burnt in with an iron, letter by letter: each a little off the line, dark at its middle, a scorch round it
function burnt(g, text, x, y, w, h, R, from, to) {
  const size = h * 0.56; g.font = `400 ${size}px Rye, Georgia, serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
  const gap = size * 0.08, width = [...text].reduce((n, c) => n + g.measureText(c).width + gap, -gap), room = (to - from) * w, k = Math.min(1, room / width);
  let cx = x + from * w + (room - width * k) / 2;
  for (const c of text) {
    const dy = (R() - 0.5) * size * 0.07, a = (R() - 0.5) * 0.05;
    g.save(); g.translate(cx, y + h / 2 + dy); g.rotate(a); g.scale(k, 1);
    g.shadowColor = 'rgba(40,22,10,0.7)'; g.shadowBlur = 5; g.fillStyle = '#1d120b'; g.fillText(c, 0, 0);
    g.restore(); cx += (g.measureText(c).width + gap) * k;
  }
}
// the lettering's font, once a page (fonts/rye.woff2, SIL Open Font License: fonts/OFL-rye.txt)
let RYE = null;
function ryeLoaded() {
  if (!RYE) { RYE = new FontFace('Rye', `url(${new URL('../../fonts/rye.woff2', import.meta.url).href})`).load().then((f) => { document.fonts.add(f); }); }
  return RYE;
}
export function signTexture(boards = boardsAt(0, 0)) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const tones = ['#a8957c', '#9c8a72', '#b09c82', '#a39078'];
  const draw = () => { const R = rnd(23);
    boards.slice(0, POST_ROW).forEach((b, i) => { plank(g, 0, i * ROW, S, ROW, tones[i % 4], R); burnt(g, b.text, 0, i * ROW, S, ROW, R, ...textSpan(b.len || 0.9)); });
    plank(g, 0, POST_ROW * ROW, S, S - POST_ROW * ROW, '#7a6a57', R); };
  draw();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping;
  ryeLoaded().then(() => { draw(); t.needsUpdate = true; }).catch(() => { /* the plain serif stays */ });
  return t;
}
const stripV = (row, f) => 1 - (row * ROW + 2 + f * (ROW - 4)) / 512;

// one board: a plank with a sawn tail and a rough point, as a slab (front, back and edge), its uvs in its strip; lettering reads
// from either side, in the same place on the board
function boardGeo(b, row, R) {
  const L = b.len || 0.9, H = 0.17, D = 0.028, tail = TAIL, [from, to] = textSpan(L), out = [[tail + (R() - 0.5) * 0.02, -H / 2], [L - POINT, -H / 2 + (R() - 0.5) * 0.01], [L, (R() - 0.5) * 0.02], [L - POINT, H / 2 + (R() - 0.5) * 0.01], [tail + (R() - 0.5) * 0.02, H / 2]];
  const P = [], N = [], UV = [], I = [], uOf = (x) => (x - tail) / (L - tail);
  const add = (x, y, z, nx, ny, nz, u, v) => { P.push(x, y, z); N.push(nx, ny, nz); UV.push(u, v); return P.length / 3 - 1; };
  for (const s of [1, -1]) {
    const v0 = out.map(([x, y]) => add(x, y, s * D / 2, 0, 0, s, s > 0 ? uOf(x) : from + to - uOf(x), stripV(row, 0.5 - y / H)));
    for (let i = 1; i < out.length - 1; i++) I.push(...(s > 0 ? [v0[0], v0[i], v0[i + 1]] : [v0[0], v0[i + 1], v0[i]]));
  }
  for (let i = 0; i < out.length; i++) {
    const [ax, ay] = out[i], [bx, by] = out[(i + 1) % out.length], l = Math.hypot(bx - ax, by - ay), nx = (by - ay) / l, ny = -(bx - ax) / l, v0 = 1 - (POST_ROW * ROW + 8) / 512, v1 = v0 - 0.02;
    const a = add(ax, ay, D / 2, nx, ny, 0, 0, v0), c = add(bx, by, D / 2, nx, ny, 0, l, v0), d = add(bx, by, -D / 2, nx, ny, 0, l, v1), e = add(ax, ay, -D / 2, nx, ny, 0, 0, v1);
    I.push(a, e, d, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  return g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, b.y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.02, b.ang, (R() - 0.5) * 0.09, 'YXZ')), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.09)));
}
// the post: hewn with an axe, seven uneven sides, a slanted top, sunk in the ground
function postGeo(R) {
  const n = 7, H = 2.42, g = new THREE.CylinderGeometry(0.072, 0.088, H + 0.2, n, 3), P = g.attributes.position, UV = g.attributes.uv, off = Array.from({ length: n }, () => 0.9 + R() * 0.22);
  const v0 = 1 - (POST_ROW * ROW + 2) / 512, vs = (512 - POST_ROW * ROW - 4) / 512;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), y = P.getY(i), a = (Math.atan2(x, z) + Math.PI * 2) % (Math.PI * 2), k = off[Math.round(a / (Math.PI * 2) * n) % n];
    P.setXYZ(i, x * k, y + (H - 0.2) / 2 + (y > 0 ? -z * 0.45 : 0), z * k);   // (a slant on top: cut with the saw)
    UV.setXY(i, (y + H / 2) / 0.8, v0 - vs * UV.getX(i) * 0.98);
  }
  g.computeVertexNormals(); return g;
}
export function signpostParts(boards = boardsAt(0, 0), rand = Math.random) {
  const R = rnd(11), parts = [{ mat: 'sign', geo: postGeo(R), colour: 0xffffff }];
  boards.slice(0, POST_ROW).forEach((b, i) => parts.push({ mat: 'sign', geo: boardGeo(b, i, R), colour: 0xffffff }));
  // the stones at its foot: field stone, muted
  for (const [x, z, r] of [[0.15, 0.05, 0.11], [-0.13, 0.1, 0.09], [0.03, -0.16, 0.12], [-0.12, -0.11, 0.08], [0.1, 0.17, 0.07]]) {
    const g = new THREE.DodecahedronGeometry(r, 0); g.scale(1.25, 0.62, 1.05); g.rotateY(rand() * 6); g.translate(x, r * 0.28, z);
    const t = 0.82 + rand() * 0.3; parts.push({ mat: 'matte', geo: g, colour: new THREE.Color(0x7d7468).multiplyScalar(t) });
  }
  return parts;
}
