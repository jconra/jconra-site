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
export function roadTexture(size = 512) {
  return tileable(size, 29, (g, s, r) => {
    g.fillStyle = '#4a4d52'; g.fillRect(0, 0, s, s);
    speck(g, s, r, 2600, ['#3f4247', '#565a60', '#43474c', '#5d6167'], 1, 3, 0.7);
    speck(g, s, r, 120, ['#2f3236', '#6a6e74'], 2, 6, 0.5);
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
// `layout`: { map: class texture (R road, G grass, B water), metres } from townLayout.js, laid over
// the town's square; where it says road or grass the noise floor gives way to asphalt or lawn
export function groundMaterial({ base = '../../textures/ground/', metresPerTile = 1.6, clearing = { x: 0, z: 0, radius: 260 }, light = false, layout = null } = {}) {
  // Jacob's set (2026-09-22): forest litter as the base, needle duff and leaf drifts by noise, fern
  // and moss patches, dirt on the paths, dark dirt in the clearing. Seven pictures; a machine
  // without WebGL2 has too few texture units for them all, so it drops the ferns and the dark dirt.
  const L = (name, fb) => loadOr(name, fb, base);
  const forest = L('forest', needlesTexture), needles = L('needles', needlesTexture), leaves = L('leaves', leavesTexture), moss = L('moss', mossTexture), dirt = L('dirt', dirtTexture);
  const ferns = light ? null : L('ferns', mossTexture), darkDirt = light ? null : L('darkDirt', dirtTexture);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { forestMap: { value: forest }, needlesMap: { value: needles }, leavesMap: { value: leaves }, mossMap: { value: moss }, dirtMap: { value: dirt },
      fernsMap: { value: ferns || moss }, darkDirtMap: { value: darkDirt || dirt }, tileM: { value: metresPerTile }, clearingAt: { value: new THREE.Vector3(clearing.x, clearing.z, clearing.radius) },
      layoutMap: { value: layout ? layout.map : dirt }, layoutMetres: { value: layout ? layout.metres : 0 }, roadMap: { value: roadTexture() }, grassMap: { value: grassTexture() } });
    sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `
      uniform sampler2D forestMap; uniform sampler2D needlesMap; uniform sampler2D leavesMap; uniform sampler2D mossMap; uniform sampler2D dirtMap;
      ${light ? '' : 'uniform sampler2D fernsMap; uniform sampler2D darkDirtMap;'}
      uniform float tileM; uniform vec3 clearingAt;
      uniform sampler2D layoutMap; uniform float layoutMetres; uniform sampler2D roadMap; uniform sampler2D grassMap;
      varying vec3 vWorld;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3) + 0.0625 * vnoise(p * 8.3 + 1.7); }
      // a picture read at two scales and blended, so its repeat is not seen
      vec3 twice(sampler2D t, vec2 uv, float k, vec2 off) { return mix(texture2D(t, uv).rgb, texture2D(t, uv * k + off).rgb, 0.4); }
    ` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 rel = vWorld.xz - clearingAt.xy;
      vec2 uvW = rel / tileM;
      float n = fbm(rel * 0.010), n2 = fbm(rel * 0.045 + 40.0), n3 = fbm(rel * 0.02 + 90.0), n4 = fbm(rel * 0.03 + 150.0);
      vec3 ground = twice(forestMap, uvW, 0.29, vec2(0.37, 0.11));
      // needle duff in the higher ground of the slow noise, leaf drifts in the low
      ground = mix(ground, twice(needlesMap, uvW, 0.27, vec2(0.13, 0.59)), smoothstep(0.52, 0.66, n));
      ground = mix(ground, twice(leavesMap, uvW, 0.31, vec2(0.71, 0.29)), smoothstep(0.46, 0.34, n));
      // moss in the damp spots, fern patches by their own noise
      ground = mix(ground, twice(mossMap, uvW * 1.2, 0.29, vec2(0.41, 0.83)), smoothstep(0.64, 0.8, n2));
      ${light ? '' : 'ground = mix(ground, twice(fernsMap, uvW * 0.8, 0.27, vec2(0.23, 0.67)), smoothstep(0.62, 0.76, n4));'}
      // bare dirt on the winding paths; the clearing is dark, trodden earth
      float path = 1.0 - smoothstep(0.0, 0.035, abs(n3 - 0.5));
      float toTown = distance(vWorld.xz, clearingAt.xy) / clearingAt.z;
      float clearingW = 1.0 - smoothstep(0.85, 1.15, toTown + (n2 - 0.5) * 0.25);
      ground = mix(ground, twice(dirtMap, uvW, 0.23, vec2(0.71, 0.29)), path * 0.9);
      ${light ? 'ground = mix(ground, twice(dirtMap, uvW, 0.23, vec2(0.71, 0.29)) * 0.6, clearingW);' : 'ground = mix(ground, twice(darkDirtMap, uvW, 0.23, vec2(0.51, 0.19)), clearingW);'}
      // the drawn layout: roads, lawns and water where the map says, inside its square
      if (layoutMetres > 0.0) {
        vec2 luv = rel / layoutMetres + 0.5;
        if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
          vec3 cls = texture2D(layoutMap, luv).rgb;
          vec3 road = twice(roadMap, uvW * 0.4, 0.31, vec2(0.2, 0.6)), lawn = twice(grassMap, uvW * 0.9, 0.27, vec2(0.8, 0.3));
          ground = mix(ground, lawn, cls.g); ground = mix(ground, road, cls.r); ground = mix(ground, vec3(0.16, 0.34, 0.5), cls.b);
        }
      }
      diffuseColor.rgb *= ground;
    `);
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => 'splat-ground-7' + (light ? 'L' : '');
  return mat;
}
