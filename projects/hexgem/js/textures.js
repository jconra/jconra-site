// Procedural textures painted on canvases at load: ground layers, rock, stone, glow.
import * as THREE from 'three';

function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// Tileable value noise with period p.
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s);
  const c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct, p, s) {
  let f = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) {
    f += vnoise(x, y, p, s + i * 17) * amp;
    tot += amp; x *= 2; y *= 2; p *= 2; amp *= 0.5;
  }
  return f / tot;
}
// Non-tiling noise for terrain (large period).
export function noise2(x, y, oct = 4, s = 1) { return fbm(x, y, oct, 1 << 16, s); }

function cellular(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const mx = ((cx % p) + p) % p, my = ((cy % p) + p) % p;
    const px = cx + hash(mx, my, s), py = cy + hash(mx, my, s + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [d1, d2];
}

function makeCanvas(size, paint) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    const [r, g, b, a = 1] = paint(x / size, y / size);
    d[o] = Math.max(0, Math.min(255, r * 255));
    d[o + 1] = Math.max(0, Math.min(255, g * 255));
    d[o + 2] = Math.max(0, Math.min(255, b * 255));
    d[o + 3] = Math.max(0, Math.min(255, a * 255));
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function tex(cv, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Ground layers are stored LINEAR (NoColorSpace); the splat shader converts them itself so
// WebGL1 and WebGL2 match. Alpha carries a height used for height-blended splatting.
export function groundTextures() {
  const S = 256;
  const grass = makeCanvas(S, (u, v) => {
    const n = fbm(u * 8, v * 8, 4, 8, 1);
    const blades = fbm(u * 64, v * 64, 2, 64, 3);
    const clump = fbm(u * 4, v * 4, 3, 4, 9);
    let c = mix3([0.15, 0.33, 0.09], [0.32, 0.50, 0.15], n);
    c = mix3(c, [0.55, 0.60, 0.22], Math.max(0, clump - 0.55) * 1.6);
    const k = 0.75 + blades * 0.45;
    return [c[0] * k, c[1] * k, c[2] * k, 0.35 + blades * 0.4];
  });
  const dirt = makeCanvas(S, (u, v) => {
    const n = fbm(u * 6, v * 6, 5, 6, 21);
    const pebble = cellular(u * 20, v * 20, 20, 5);
    const peb = Math.max(0, 1 - pebble[0] * 3.2);
    let c = mix3([0.36, 0.25, 0.15], [0.55, 0.41, 0.26], n);
    c = mix3(c, [0.56, 0.48, 0.38], peb * 0.45);
    const rut = fbm(u * 2, v * 24, 3, 2, 44);
    const k = 0.85 + rut * 0.25;
    return [c[0] * k, c[1] * k, c[2] * k, 0.3 + peb * 0.6 + n * 0.2];
  });
  const rock = makeCanvas(S, (u, v) => {
    const n = fbm(u * 5, v * 5, 5, 5, 31);
    const cell = cellular(u * 3, v * 3, 3, 11);
    const crack = 0.55 + 0.45 * Math.min(1, (cell[1] - cell[0]) * 4 + fbm(u * 12, v * 12, 3, 12, 8) * 0.5);
    let c = mix3([0.30, 0.30, 0.32], [0.55, 0.53, 0.50], n);
    const moss = Math.max(0, fbm(u * 3, v * 3, 3, 3, 77) - 0.55) * 2.5;
    c = mix3(c, [0.25, 0.38, 0.15], moss);
    const k = 0.45 + 0.55 * crack;
    return [c[0] * k, c[1] * k, c[2] * k, 0.4 + crack * 0.5];
  });
  const sand = makeCanvas(S, (u, v) => {
    const n = fbm(u * 10, v * 10, 4, 10, 51);
    const flowers = hash(Math.floor(u * 128), Math.floor(v * 128), 3) > 0.994;
    let c = mix3([0.22, 0.38, 0.11], [0.30, 0.46, 0.14], n);
    if (flowers) {
      const pick = hash(Math.floor(u * 96), Math.floor(v * 96), 5);
      c = pick < 0.33 ? [0.8, 0.7, 0.25] : pick < 0.66 ? [0.7, 0.7, 0.75] : [0.6, 0.3, 0.6];
    }
    return [c[0], c[1], c[2], flowers ? 0.9 : 0.4 + n * 0.3];
  });
  return { grass: tex(grass), dirt: tex(dirt), rock: tex(rock), meadow: tex(sand) };
}

export function stoneTexture() {
  const cv = makeCanvas(256, (u, v) => {
    const n = fbm(u * 6, v * 6, 5, 6, 61);
    const cell = cellular(u * 4, v * 4, 4, 13);
    const edge = Math.min(1, (cell[1] - cell[0]) * 5);
    const g = lerp(0.42, 0.68, n) * (0.6 + 0.4 * edge);
    return [g * 1.0, g * 0.97, g * 0.92];
  });
  const t = tex(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function rockTexture() {
  const cv = makeCanvas(256, (u, v) => {
    const n = fbm(u * 4, v * 4, 6, 4, 91);
    const strata = Math.sin((v + n * 0.3) * 40) * 0.5 + 0.5;
    const g = lerp(0.35, 0.6, n) * (0.85 + strata * 0.15);
    const moss = Math.max(0, fbm(u * 3, v * 3, 3, 3, 12) - 0.58) * 2.2;
    return mix3([g, g * 0.96, g * 0.9], [0.26, 0.40, 0.16], Math.min(1, moss));
  });
  const t = tex(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return tex(cv, false);
}

export function bandTexture() {
  // malachite bands
  const cv = makeCanvas(128, (u, v) => {
    const n = fbm(u * 3, v * 3, 3, 3, 5);
    const b = Math.sin((v * 10 + n * 4) * Math.PI) * 0.5 + 0.5;
    return mix3([0.02, 0.25, 0.12], [0.2, 0.85, 0.5], b * b);
  });
  const t = tex(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function textSprite(text, color = '#fff', px = 64) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `900 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  cv.width = w; cv.height = px + 16;
  ctx.font = `900 ${px}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = px / 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, w / 2, cv.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, cv.height / 2);
  const t = tex(cv, false);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;           // odd-sized canvas: no mips, so WebGL1 needn't resize it
  t.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(w / cv.height, 1, 1);
  return s;
}
