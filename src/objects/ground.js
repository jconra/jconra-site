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

// `clearing`: { x, z, radius } of the town, where the ground goes to dirt and paving
export function groundMaterial({ maps = null, metresPerTile = 14, clearing = { x: 0, z: 0, radius: 260 } } = {}) {
  const grass = maps?.grass || grassTexture(), dirt = maps?.dirt || dirtTexture(), rock = maps?.rock || rockTexture();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grass }; sh.uniforms.dirtMap = { value: dirt }; sh.uniforms.rockMap = { value: rock };
    sh.uniforms.tileM = { value: metresPerTile }; sh.uniforms.clearingAt = { value: new THREE.Vector3(clearing.x, clearing.z, clearing.radius) };
    sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `
      uniform sampler2D grassMap; uniform sampler2D dirtMap; uniform sampler2D rockMap; uniform float tileM; uniform vec3 clearingAt;
      varying vec3 vWorld;
      // value noise, a few octaves, over world metres
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3) + 0.0625 * vnoise(p * 8.3 + 1.7); }
    ` + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 uvW = (vWorld.xz - clearingAt.xy) / tileM;
      // the same texture read twice at different scales, so the repeat is not seen
      vec3 gr = mix(texture2D(grassMap, uvW).rgb, texture2D(grassMap, uvW * 0.23 + 0.37).rgb, 0.45);
      vec3 di = mix(texture2D(dirtMap, uvW).rgb, texture2D(dirtMap, uvW * 0.19 + 0.11).rgb, 0.45);
      vec3 ro = mix(texture2D(rockMap, uvW * 0.7).rgb, texture2D(rockMap, uvW * 0.17 + 0.5).rgb, 0.4);
      // where each goes: dirt in the low noise, rock in the high, grass between; the clearing is dirt
      vec2 rel = vWorld.xz - clearingAt.xy;                       // metres from the town, so the noise keeps its precision far from the origin
      float n = fbm(rel * 0.012), n2 = fbm(rel * 0.05 + 40.0);
      float dirtW = smoothstep(0.55, 0.72, n) * 0.9 + smoothstep(0.75, 0.9, n2) * 0.5;
      float rockW = smoothstep(0.62, 0.8, n2) * smoothstep(0.35, 0.55, n) * 0.9;
      float toTown = distance(vWorld.xz, clearingAt.xy) / clearingAt.z;
      float clearingW = 1.0 - smoothstep(0.85, 1.15, toTown + (n2 - 0.5) * 0.25);
      dirtW = max(dirtW, clearingW);
      vec3 ground = mix(gr, di, clamp(dirtW, 0.0, 1.0)); ground = mix(ground, ro, clamp(rockW * (1.0 - clearingW), 0.0, 1.0));
      diffuseColor.rgb *= ground;
    `);
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => 'splat-ground';
  return mat;
}
