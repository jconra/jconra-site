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
// THE SPLAT: where each forest-floor layer goes. Every layer has its own noise - the shape of it,
// how big a patch is, how much ground it covers, how soft its edge is, how strongly it shows - and
// all of them share the fractal settings, a domain warp (which bends straight noise into wandering
// shapes) and a fine "breakup" noise that roughens every edge so patches look torn, not blurred.
// Tuned in the Tree Lab; the town uses the same defaults.
// Noise shapes: 0 value, 1 gradient (Perlin), 2 cellular blobs, 3 ridged, 4 billow, 5 patches
// (a flat random value per cell, for a hard-edged mosaic).
export const NOISE_TYPES = ['value', 'gradient', 'cellular blobs', 'ridged', 'billow', 'patches'];
export const SPLAT_LAYERS = ['needles', 'leaves', 'moss', 'ferns'];
export const SPLAT_DEFAULTS = {
  octaves: 4, lacunarity: 2.1, gain: 0.5, contrast: 1.8,   // contrast spreads the noise back out: averaging octaves bunches it round the middle
  warp: 6, warpSize: 22,                      // metres the noise is pushed around, and the size of the push
  breakup: 0.14, breakupSize: 2.2,            // how much the fine noise roughens edges, and its grain in metres
  tile: 1.6, antiTile: 0.4,                   // metres a texture repeats over; how much of a second, larger read hides the repeat
  needles: { type: 1, size: 26, cover: 0.38, soft: 0.05, strength: 1, tex: 1 },     // tex: the picture's size, 2 = twice as big
  leaves:  { type: 1, size: 14, cover: 0.3,  soft: 0.05, strength: 1, tex: 1.5 },
  moss:    { type: 2, size: 7,  cover: 0.22, soft: 0.06, strength: 0.9, tex: 0.85 },
  ferns:   { type: 0, size: 11, cover: 0.18, soft: 0.05, strength: 1, tex: 1.25 },
  paths:   { type: 1, size: 60, width: 0.012, soft: 0.012, strength: 0.9, tex: 1 },
  debug: 0,                                   // 1 shows the layers as flat colours instead of pictures
};
export function splatUniforms(set = SPLAT_DEFAULTS) {
  const u = {
    sFractal: { value: new THREE.Vector4() }, sWarp: { value: new THREE.Vector2() }, sBreak: { value: new THREE.Vector2() },
    sTile: { value: new THREE.Vector2() }, sDebug: { value: 0 }, sPath: { value: new THREE.Vector4() }, sPathB: { value: new THREE.Vector2() },
  };
  for (const k of SPLAT_LAYERS) { u['s_' + k] = { value: new THREE.Vector4() }; u['s_' + k + 'B'] = { value: new THREE.Vector2() }; }
  applySplat(u, set);
  return u;
}
export function applySplat(u, set) {
  u.sFractal.value.set(set.octaves, set.lacunarity, set.gain, set.contrast); u.sWarp.value.set(set.warp, set.warpSize);
  u.sBreak.value.set(set.breakup, set.breakupSize); u.sTile.value.set(set.tile, set.antiTile); u.sDebug.value = set.debug;
  for (const k of SPLAT_LAYERS) { const l = set[k]; u['s_' + k].value.set(l.type, l.size, l.cover, l.soft); u['s_' + k + 'B'].value.set(l.strength, 1 / Math.max(l.tex, 0.05)); }
  const p = set.paths; u.sPath.value.set(p.type, p.size, p.width, p.soft); u.sPathB.value.set(p.strength, 1 / Math.max(p.tex, 0.05));
}

// `layout`: { map: class texture (R road, G grass, B water), metres } from townLayout.js, laid over
// the town's square; where it says road or grass the noise floor gives way to asphalt or lawn
export function groundMaterial({ base = '/textures/ground/', clearing = { x: 0, z: 0, radius: 260 }, light = false, layout = null, splat = SPLAT_DEFAULTS } = {}) {
  // Jacob's set (2026-09-22): forest litter as the base, needle duff and leaf drifts by noise, fern
  // and moss patches, dirt on the paths, dark dirt in the clearing. Seven pictures; a machine
  // without WebGL2 has too few texture units for them all, so it drops the ferns and the dark dirt.
  const L = (name, fb) => loadOr(name, fb, base);
  const forest = L('forest', needlesTexture), needles = L('needles', needlesTexture), leaves = L('leaves', leavesTexture), moss = L('moss', mossTexture), dirt = L('dirt', dirtTexture);
  const ferns = light ? null : L('ferns', mossTexture), darkDirt = light ? null : L('darkDirt', dirtTexture);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const su = splatUniforms(splat);
  mat.userData.splat = su;                      // applySplat(mat.userData.splat, settings) retunes it live
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, su, { forestMap: { value: forest }, needlesMap: { value: needles }, leavesMap: { value: leaves }, mossMap: { value: moss }, dirtMap: { value: dirt },
      fernsMap: { value: ferns || moss }, darkDirtMap: { value: darkDirt || dirt }, clearingAt: { value: new THREE.Vector3(clearing.x, clearing.z, clearing.radius) },
      layoutMap: { value: layout ? layout.map : dirt }, layoutMap2: { value: layout ? layout.map2 : dirt }, layoutMetres: { value: layout ? layout.metres : 0 },
      roadMap: { value: L('asphalt', roadTexture) }, grassMap: { value: L('grassMed', grassTexture) }, concreteMap: { value: L('concrete', rockTexture) }, dryMap: { value: L('grassDry', grassTexture) }, darkGrassMap: { value: L('grassDark', grassTexture) } });
    sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `
      uniform sampler2D forestMap; uniform sampler2D needlesMap; uniform sampler2D leavesMap; uniform sampler2D mossMap; uniform sampler2D dirtMap;
      ${light ? '' : 'uniform sampler2D fernsMap; uniform sampler2D darkDirtMap;'}
      uniform vec3 clearingAt;
      uniform vec4 sFractal; uniform vec2 sWarp; uniform vec2 sBreak; uniform vec2 sTile; uniform float sDebug;
      uniform vec4 s_needles; uniform vec2 s_needlesB; uniform vec4 s_leaves; uniform vec2 s_leavesB;
      uniform vec4 s_moss; uniform vec2 s_mossB; uniform vec4 s_ferns; uniform vec2 s_fernsB; uniform vec4 sPath; uniform vec2 sPathB;
      uniform sampler2D layoutMap; uniform sampler2D layoutMap2; uniform float layoutMetres; uniform sampler2D roadMap; uniform sampler2D grassMap; uniform sampler2D concreteMap; uniform sampler2D dryMap; uniform sampler2D darkGrassMap;
      varying vec3 vWorld;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 hash22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        float a = dot(hash22(i) * 2.0 - 1.0, f), b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
        float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0)), d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
        return clamp(0.5 + 0.9 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0); }
      // distance to the nearest cell point, and that cell's own random value
      vec2 cells(vec2 p) { vec2 i = floor(p), f = fract(p); float best = 8.0, v = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), r = g + hash22(i + g) - f; float d = dot(r, r); if (d < best) { best = d; v = hash2(i + g + 17.3); } }
        return vec2(sqrt(best), v); }
      float noiseOf(vec2 p, float type) {
        if (type < 0.5) return vnoise(p);
        if (type < 1.5) return gnoise(p);
        if (type < 2.5) return 1.0 - min(cells(p).x, 1.0);
        if (type < 3.5) return 1.0 - abs(gnoise(p) * 2.0 - 1.0);
        if (type < 4.5) return abs(gnoise(p) * 2.0 - 1.0);
        return cells(p).y;
      }
      float field(vec2 p, float type, float seed) {
        p += seed * vec2(37.1, 91.7);
        float sum = 0.0, amp = 1.0, norm = 0.0;
        for (int i = 0; i < 6; i++) { if (float(i) >= sFractal.x) break; sum += amp * noiseOf(p, type); norm += amp; p = p * sFractal.y + vec2(7.1, 3.3); amp *= sFractal.z; }
        return clamp(0.5 + (sum / max(norm, 1e-4) - 0.5) * sFractal.w, 0.0, 1.0);
      }
      // a layer's share of the ground: its noise over its patch size, cut at its coverage, edges roughened
      float layer(vec2 m, vec4 a, vec2 b, float seed, float grain) {
        float f = field(m / max(a.y, 0.1), a.x, seed) + grain;
        float cut = 1.0 - a.z;
        return smoothstep(cut - a.w, cut + a.w, f) * b.x;
      }
      vec3 twice(sampler2D t, vec2 uv, float k, vec2 off) { return mix(texture2D(t, uv).rgb, texture2D(t, uv * k + off).rgb, sTile.y); }
    ` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 rel = vWorld.xz - clearingAt.xy;
      vec2 uvW = rel / sTile.x;
      // the warp bends every layer's noise the same way, so the patches wander together
      vec2 m = rel + sWarp.x * (vec2(vnoise(rel / max(sWarp.y, 0.1)), vnoise(rel / max(sWarp.y, 0.1) + 19.7)) * 2.0 - 1.0);
      float grain = (vnoise(rel / max(sBreak.y, 0.05)) - 0.5) * sBreak.x;
      float wNeedles = layer(m, s_needles, s_needlesB, 1.0, grain);
      float wLeaves = layer(m, s_leaves, s_leavesB, 2.0, grain);
      float wMoss = layer(m, s_moss, s_mossB, 3.0, grain);
      float wFerns = ${light ? '0.0' : 'layer(m, s_ferns, s_fernsB, 4.0, grain)'};
      float pf = field(m / max(sPath.y, 0.1), sPath.x, 5.0) + grain * 0.3;
      float wPath = (1.0 - smoothstep(sPath.z, sPath.z + sPath.w, abs(pf - 0.5))) * sPathB.x;
      float toTown = distance(vWorld.xz, clearingAt.xy) / clearingAt.z;
      float clearingW = 1.0 - smoothstep(0.85, 1.15, toTown + grain);
      vec3 ground = twice(forestMap, uvW, 0.29, vec2(0.37, 0.11));
      ground = mix(ground, twice(needlesMap, uvW * s_needlesB.y, 0.27, vec2(0.13, 0.59)), wNeedles);
      ground = mix(ground, twice(leavesMap, uvW * s_leavesB.y, 0.31, vec2(0.71, 0.29)), wLeaves);
      ground = mix(ground, twice(mossMap, uvW * s_mossB.y, 0.29, vec2(0.41, 0.83)), wMoss);
      ${light ? '' : 'ground = mix(ground, twice(fernsMap, uvW * s_fernsB.y, 0.27, vec2(0.23, 0.67)), wFerns);'}
      ground = mix(ground, twice(dirtMap, uvW * sPathB.y, 0.23, vec2(0.71, 0.29)), wPath);
      ${light ? 'ground = mix(ground, twice(dirtMap, uvW, 0.23, vec2(0.71, 0.29)) * 0.6, clearingW);' : 'ground = mix(ground, twice(darkDirtMap, uvW, 0.23, vec2(0.51, 0.19)), clearingW);'}
      // the mask view: forest floor grey, needles red, leaves orange, moss green, ferns cyan, paths white, clearing dark
      if (sDebug > 0.5) {
        vec3 d = vec3(0.35);
        d = mix(d, vec3(0.8, 0.15, 0.1), wNeedles); d = mix(d, vec3(1.0, 0.6, 0.1), wLeaves); d = mix(d, vec3(0.2, 0.75, 0.2), wMoss);
        d = mix(d, vec3(0.1, 0.8, 0.85), wFerns); d = mix(d, vec3(1.0), wPath); d = mix(d, vec3(0.1), clearingW);
        ground = d;
      }
      // the drawn layout: roads, lawns and water where the map says, inside its square
      if (layoutMetres > 0.0) {
        vec2 luv = rel / layoutMetres + 0.5;
        if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
          vec3 cls = texture2D(layoutMap, luv).rgb, cls2 = texture2D(layoutMap2, luv).rgb;
          vec3 road = twice(roadMap, uvW * 0.4, 0.31, vec2(0.2, 0.6)), lawn = twice(grassMap, uvW * 0.9, 0.27, vec2(0.8, 0.3));
          ground = mix(ground, twice(darkGrassMap, uvW * 0.9, 0.27, vec2(0.6, 0.1)), cls2.b);
          ground = mix(ground, twice(dryMap, uvW * 0.9, 0.27, vec2(0.3, 0.7)), cls2.g);
          ground = mix(ground, lawn, cls.g); ground = mix(ground, twice(concreteMap, uvW * 0.5, 0.31, vec2(0.4, 0.2)), cls2.r); ground = mix(ground, road, cls.r); ground = mix(ground, vec3(0.16, 0.34, 0.5), cls.b);
        }
      }
      diffuseColor.rgb *= ground;
    `);
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => 'splat-ground-10' + (light ? 'L' : '');
  return mat;
}
