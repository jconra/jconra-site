// THE HEX OBELISK, for the town (the Subnetting Calculator's landmark): a tall shaft of glossy black stone on a stepped
// base, every face a honeycomb of hex cells in shifting colours (green to cyan to violet, a band of light sweeping up now
// and then, its tip glowing). Some cells glow and some stay dark: the glowing ones are ones and the dark ones zeros, a
// message in 8-bit ASCII, most significant bit first, read like a book: the front face first (top row to bottom, each row
// left to right), then on round the obelisk to its right. The rows alternate five cells and four. The front face, where the
// reading starts, has a bright frame up its sides.
//
//   makeObelisk() -> Group, standing on y = 0, 0.9 m across at the base and 3.75 m tall at size 1
//   OBELISK_MESSAGE: what the cells say
import * as THREE from 'three';

export const OBELISK_MESSAGE = 'LEARN IT, THEN HELP THE NEXT ONE LEARN. - JACOB & CLAUDE';
const COLS = 5, SHAFT = { y0: 0.4, h: 3.0, w0: 0.64, w1: 0.44 }, CAP = 0.35;
const HEIGHT = SHAFT.h / SHAFT.w0 * COLS;               // (the face's height in cell widths, at the base's width)
const ROWS = Math.floor(HEIGHT / 0.8660254) - 1;         // (rows of cells up a face, every other row set half a cell over; the top one whole)

// the bits, laid where the shader looks for them: a picture COLS * 4 wide and ROWS tall, row 0 the top row
function bitsTexture(text) {
  const bits = []; for (const ch of text) { const c = ch.charCodeAt(0) & 255; for (let b = 7; b >= 0; b--) bits.push((c >> b) & 1); }
  const W = COLS * 4, data = new Uint8Array(W * ROWS * 4); let n = 0;
  for (let face = 0; face < 4; face++) for (let row = 0; row < ROWS; row++) {
    const full = (ROWS - 1 - row) % 2 === 0, cells = full ? COLS : COLS - 1;   // (as the shader counts them: from the bottom, even rows five cells, odd four)
    for (let col = 0; col < cells; col++) { const on = n < bits.length ? bits[n] : 0; n++; const o = (row * W + face * COLS + col) * 4; data[o] = on * 255; data[o + 3] = 255; }
  }
  const t = new THREE.DataTexture(data, W, ROWS, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return { tex: t, capacity: n, used: bits.length };
}

// the shaft and its tip: four tapering faces (u across each, 0..1 seen from outside; v up it) and four triangles to a point
function shaftGeometry() {
  const pos = [], uv = [], face = [], y0 = SHAFT.y0, y1 = y0 + SHAFT.h, a = SHAFT.w0 / 2, b = SHAFT.w1 / 2;
  // the corners round the obelisk from its front-left, going right (seen from above: +z front, then +x, -z, -x)
  const ring = (h) => [[-h, h], [h, h], [h, -h], [-h, -h]];
  const lo = ring(a), hi = ring(b);
  for (let f = 0; f < 4; f++) {
    const [x0, z0] = lo[f], [x1, z1] = lo[(f + 1) % 4], [X0, Z0] = hi[f], [X1, Z1] = hi[(f + 1) % 4];
    // (u: across the face in base widths, which runs evenly over the whole flat face, so both its triangles agree; the shader
    // divides by the face's width at that height. 0..1 at the top ring would bend the cells along the diagonal)
    const k = SHAFT.w1 / SHAFT.w0, quad = [[x0, y0, z0, 0, 0], [x1, y0, z1, 1, 0], [X1, y1, Z1, 0.5 + k / 2, 1], [x0, y0, z0, 0, 0], [X1, y1, Z1, 0.5 + k / 2, 1], [X0, y1, Z0, 0.5 - k / 2, 1]];
    for (const [x, y, z, u, v] of quad) { pos.push(x, y, z); uv.push(u, v); face.push(f); }
    const tip = [[X0, y1, Z0, 0, 0], [X1, y1, Z1, 1, 0], [0, y1 + CAP, 0, 0.5, 1]];
    for (const [x, y, z, u, v] of tip) { pos.push(x, y, z); uv.push(u, v); face.push(4 + f); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('obFace', new THREE.Float32BufferAttribute(face, 1));
  g.computeVertexNormals();
  return g;
}

// the cells: which hexagon a point on a face is in (its middle, column and row) and how near its edge; then the colours
const OB_GLSL = `
  uniform float obTime; uniform sampler2D obBits;
  varying vec2 vObUv; varying float vObFace;
  vec4 obHex(vec2 p) {                       // xy: from the cell's middle; zw: its column and its row counted up from the bottom
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 a = floor(p / s) + 0.5, b = floor((p - vec2(0.5, 0.8660254)) / s) + 0.5;
    vec2 da = p - a * s, db = p - (b * s + vec2(0.5, 0.8660254));
    if (dot(da, da) < dot(db, db)) return vec4(da, floor(a.x), floor(a.y) * 2.0);
    return vec4(db, floor(b.x), floor(b.y) * 2.0 + 1.0);
  }
  vec3 obGlow(out vec3 body) {
    float t = obTime; vec2 uv = vObUv;
    if (vObFace < 3.5) uv.x = 0.5 + (uv.x - 0.5) / mix(1.0, ${(SHAFT.w1 / SHAFT.w0).toFixed(5)}, uv.y);   // (the true share across the face at this height)
    vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + uv.y * 0.9 + uv.x * 0.25 + t * 0.07 + vObFace * 0.17));
    hue = mix(vec3(0.1, 1.0, 0.45), hue * hue * 1.6, 0.8);          // (rich colours, leaning to the calculator's green)
    body = vec3(0.02, 0.025, 0.03);
    if (vObFace > 3.5) return hue * (0.2 + 1.2 * smoothstep(0.3, 1.0, uv.y));   // (the tip: brightening to its point)
    vec2 p = vec2(uv.x * ${COLS.toFixed(1)}, uv.y * ${HEIGHT.toFixed(3)});
    vec4 h = obHex(p); vec2 o = abs(h.xy);
    float d = max(dot(o, vec2(0.5, 0.8660254)), o.x), edge = smoothstep(0.4, 0.49, d);
    float row = ${(ROWS - 1).toFixed(1)} - h.w, col = h.z, full = mod(h.w, 2.0) < 0.5 ? 1.0 : 0.0;   // (row: from the top, as the bits are kept)
    float inRow = (h.w >= 0.0 && h.w < ${ROWS.toFixed(1)} && col >= 0.0 && col < ${COLS.toFixed(1)} - (1.0 - full)) ? 1.0 : 0.0;
    float bit = inRow * texture2D(obBits, vec2((vObFace * ${COLS.toFixed(1)} + col + 0.5) / ${(COLS * 4).toFixed(1)}, (row + 0.5) / ${ROWS.toFixed(1)})).r;
    float pulse = 0.85 + 0.25 * sin(t * 1.7 + h.z * 1.3 + h.w * 0.7 + vObFace);
    float sweep = 1.0 - smoothstep(0.0, 0.06, abs(fract(uv.y * 0.5 - t * 0.1) - 0.5));   // (a band of light going up)
    float frame = vObFace < 0.5 ? max(smoothstep(0.975, 1.0, uv.x), 1.0 - smoothstep(0.0, 0.025, uv.x)) : 0.0;   // (the face to start reading on: a bright frame up its sides)
    body = mix(body, vec3(0.06, 0.07, 0.08), edge);
    return hue * (bit * pulse * 0.62 + edge * 0.38 + (1.0 - edge) * 0.05 + sweep * 0.28) + vec3(1.0) * frame * 1.1;
  }
`;

let PARTS = null;
function parts() {
  if (PARTS) return PARTS;
  const bits = bitsTexture(OBELISK_MESSAGE);
  if (bits.used > bits.capacity) console.warn(`obelisk: the message needs ${bits.used} cells, it has ${bits.capacity}`);
  const u = { obTime: { value: 0 }, obBits: { value: bits.tex } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.35 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float obFace; varying vec2 vObUv; varying float vObFace;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObUv = uv; vObFace = obFace;');
    sh.fragmentShader = OB_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  vec3 obBody; vec3 obLight = obGlow(obBody); diffuseColor.rgb = obBody;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += obLight;');
  };
  mat.customProgramCacheKey = () => 'hex-obelisk-1';
  const stone = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.1 });
  PARTS = { u, mat, stone, shaft: shaftGeometry(), steps: [new THREE.BoxGeometry(0.9, 0.2, 0.9).translate(0, 0.1, 0), new THREE.BoxGeometry(0.74, 0.2, 0.74).translate(0, 0.3, 0)], capacity: bits.capacity, used: bits.used };
  return PARTS;
}

export function makeObelisk() {
  const P = parts(), g = new THREE.Group(); g.name = 'obelisk'; g.userData.kind = 'obelisk';
  for (const s of P.steps) { const m = new THREE.Mesh(s, P.stone); m.castShadow = m.receiveShadow = true; g.add(m); }
  const shaft = new THREE.Mesh(P.shaft, P.mat); shaft.castShadow = true; shaft.receiveShadow = true;
  shaft.onBeforeRender = () => { P.u.obTime.value = performance.now() / 1000; };   // (its time, whenever it's drawn: nothing else to keep it going)
  g.add(shaft);
  return g;
}
export const obeliskBits = () => { const P = parts(); return { capacity: P.capacity, used: P.used }; };
