// GROUND. One big plane whose surface is three materials - grass, dirt and rock - blended by
// noise in the shader over WORLD position, so it tiles forever without a seam, plus a worn
// clearing (dirt and paving) under the town and the odd rocky patch. The three textures are
// drawn on canvases at load, so nothing is fetched; drop real photographs in as `maps` to
// replace them.
import * as THREE from 'three';

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// a tileable texture: `paint(g, size, rand)` draws it, with the edges wrapped by drawing four times
function tileable(size, seed, paint) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d');
  paint(g, size, rnd(seed));
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const speck = (g, size, r, n, colours, rMin, rMax, alpha) => {
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, rad = rMin + r() * (rMax - rMin), c = colours[Math.floor(r() * colours.length)];
    g.fillStyle = c; g.globalAlpha = alpha * (0.5 + r() * 0.5);
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * (0.5 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2); g.fill(); }
  }
  g.globalAlpha = 1;
};
export function grassTexture(size = 512) {
  return tileable(size, 3, (g, s, r) => {
    g.fillStyle = '#4c7a36'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 1400, ['#5d8f3f', '#3f6b2c', '#6a9a45', '#43702f', '#7aa64f'], 3, 9, 0.6);
    speck(g, s, r, 700, ['#2f5522', '#8db35a', '#587f3a'], 1, 3, 0.7);
  });
}
export function dirtTexture(size = 512) {
  return tileable(size, 5, (g, s, r) => {
    g.fillStyle = '#7a6244'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 1200, ['#8a7050', '#6a5439', '#957b5c', '#5e4a33'], 3, 12, 0.55);
    speck(g, s, r, 400, ['#4e3d2a', '#a58a68'], 1, 4, 0.8);
  });
}
export function rockTexture(size = 512) {
  return tileable(size, 8, (g, s, r) => {
    g.fillStyle = '#6f7378'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 500, ['#7d8186', '#5f6368', '#8a8e93', '#54585d'], 8, 26, 0.7);
    speck(g, s, r, 900, ['#4a4e53', '#9a9ea3'], 1, 3, 0.6);
  });
}

// The layers, and where each goes. Files are looked for in textures/ground/ (leaves.jpg, needles.jpg,
// dirt.jpg, moss.jpg, with an optional _n.png normal map beside each); a missing one falls back to
// a drawn stand-in. `clearing`: { x, z, radius } of the town, where the ground goes to bare dirt.
export const GROUND_FILES = { leaves: 'leaves', needles: 'needles', dirt: 'dirt', moss: 'moss' };
function loadOr(name, fallback, base) {
  const loader = new THREE.TextureLoader();
  const t = fallback();
  loader.load(`${base}${name}.jpg`, (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; t.image = tex.image; t.needsUpdate = true; }, undefined, () => {});
  return t;
}
function leavesTexture(size = 512) {
  return tileable(size, 13, (g, s, r) => {
    g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 900, ['#b8541f', '#c9732a', '#8f3f1c', '#d98b3a', '#7a3a1a', '#a85a22'], 6, 16, 0.85);
    speck(g, s, r, 500, ['#3e2614', '#e0a050'], 1, 4, 0.6);
  });
}
function needlesTexture(size = 512) {
  return tileable(size, 17, (g, s, r) => {
    g.fillStyle = '#5a3320'; g.fillRect(0, 0, s, s);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) { const x = r() * s, y = r() * s, a = r() * Math.PI, L = 6 + r() * 14; g.strokeStyle = ['#8a4a2a', '#a35a30', '#6e3a20', '#b0623a'][Math.floor(r() * 4)]; g.globalAlpha = 0.6 + r() * 0.4; g.lineWidth = 1 + r();
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * L, y + dy + Math.sin(a) * L); g.stroke(); } }
    g.globalAlpha = 1;
  });
}
function mossTexture(size = 512) {
  return tileable(size, 21, (g, s, r) => {
    g.fillStyle = '#4a6a2a'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 1800, ['#5f8a34', '#3f5f24', '#76a040', '#4d7a2c'], 2, 6, 0.7);
  });
}
export function groundMaterial({ base = '../../textures/ground/', metresPerTile = 6, clearing = { x: 0, z: 0, radius: 260 } } = {}) {
  const leaves = loadOr('leaves', leavesTexture, base), needles = loadOr('needles', needlesTexture, base), dirt = loadOr('dirt', dirtTexture, base), moss = loadOr('moss', mossTexture, base);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.leavesMap = { value: leaves }; sh.uniforms.needlesMap = { value: needles }; sh.uniforms.dirtMap = { value: dirt }; sh.uniforms.mossMap = { value: moss };
    sh.uniforms.tileM = { value: metresPerTile }; sh.uniforms.clearingAt = { value: new THREE.Vector3(clearing.x, clearing.z, clearing.radius) };
    sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `
      uniform sampler2D leavesMap; uniform sampler2D needlesMap; uniform sampler2D dirtMap; uniform sampler2D mossMap; uniform float tileM; uniform vec3 clearingAt;
      varying vec3 vWorld;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3) + 0.0625 * vnoise(p * 8.3 + 1.7); }
      // a texture read at two scales and blended, so its repeat is not seen
      vec3 twice(sampler2D t, vec2 uv, float k, vec2 off) { return mix(texture2D(t, uv).rgb, texture2D(t, uv * k + off).rgb, 0.4); }
    ` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 rel = vWorld.xz - clearingAt.xy;
      vec2 uvW = rel / tileM;
      vec3 le = twice(leavesMap, uvW, 0.31, vec2(0.37, 0.11));
      vec3 ne = twice(needlesMap, uvW, 0.27, vec2(0.13, 0.59));
      vec3 di = twice(dirtMap, uvW, 0.23, vec2(0.71, 0.29));
      vec3 mo = twice(mossMap, uvW * 1.3, 0.29, vec2(0.41, 0.83));
      // the floor: needles as the base; leaves in drifts by the low-frequency noise; moss in the damp
      // spots by a higher one; bare dirt on the paths (a thin band of one noise) and in the clearing
      float n = fbm(rel * 0.010), n2 = fbm(rel * 0.045 + 40.0), n3 = fbm(rel * 0.02 + 90.0);
      float leavesW = smoothstep(0.42, 0.62, n);
      float mossW = smoothstep(0.66, 0.82, n2) * (1.0 - leavesW * 0.5);
      float path = 1.0 - smoothstep(0.0, 0.035, abs(n3 - 0.5));
      float toTown = distance(vWorld.xz, clearingAt.xy) / clearingAt.z;
      float clearingW = 1.0 - smoothstep(0.85, 1.15, toTown + (n2 - 0.5) * 0.25);
      float dirtW = max(path * 0.9, clearingW);
      vec3 ground = mix(ne, le, leavesW); ground = mix(ground, mo, clamp(mossW, 0.0, 1.0)); ground = mix(ground, di, clamp(dirtW, 0.0, 1.0));
      diffuseColor.rgb *= ground;
    `);
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => 'splat-ground-4';
  return mat;
}
