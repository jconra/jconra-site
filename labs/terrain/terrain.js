// TERRAIN LAB. Techniques games use so a ground texture does not look like it repeats, each one a
// switch, with a split screen: left of the line the plain texture, right of it the techniques.
//   1. Hex-tiling (after Mikkelsen, "Practical Real-Time Hex-Tiling", 2022): the ground is cut
//      into a triangle grid; each grid vertex owns a random shift and turn of the texture, and a
//      pixel blends the three vertices around it by its barycentric weights, sharpened, and
//      optionally tipped toward the brighter sample so the blend follows the picture.
//   2. Large-scale variation: slow noise tints and brightens the ground in big patches.
//   3. A second, larger read of the same texture fading in with distance.
// The ground is MeshStandardMaterial with the map lookup replaced, so it lights like the town.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const GL2 = renderer.capabilities.isWebGL2;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xa9c8e4); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 150, 1400);   // the haze does its share of hiding the repeat far off
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b5a44, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(-300, 400, -200); scene.add(sun);

// ── the land: gentle hills, a flatter middle ──────────────────────────────────
const SIZE = 1600, SEG = 320;
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function heightAt(x, z) {
  let h = 0, amp = 1, f = 1 / 260;
  for (let i = 0; i < 5; i++) { h += (vnoise(x * f, z * f) - 0.5) * amp; amp *= 0.45; f *= 2.1; }
  const r = Math.hypot(x, z);
  return h * 55 * THREE.MathUtils.smoothstep(r, 60, 500) + h * 6;
}
const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
{ const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i))); geo.computeVertexNormals(); }

// ── textures ────────────────────────────────────────────────────────────────────
const TEXTURES = ['forest', 'leaves', 'needles', 'moss', 'dirt', 'darkDirt', 'ferns', 'shrubs', 'grassMed', 'grassDry', 'grassDark', 'concrete', 'asphalt'];
const loader = new THREE.TextureLoader(), cache = {};
function tex(name) {
  if (!cache[name]) { const t = loader.load(`/textures/ground/${name}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); cache[name] = t; }
  return cache[name];
}
for (const n of TEXTURES) $('tex').add(new Option(n, n));
$('tex').value = 'grassMed';

// ── the ground material ────────────────────────────────────────────────────────
const U = {
  groundMap: { value: tex('grassMed') }, tile: { value: 3 }, split: { value: 0.5 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) },
  hexOn: { value: 1 }, hexSize: { value: 0.8 }, hexRot: { value: Math.PI }, hexSharp: { value: 7 }, hexBright: { value: 0.6 },
  macroOn: { value: 1 }, macroStr: { value: 0.55 }, macroSize: { value: 60 }, macroHue: { value: 0.5 },
  farOn: { value: 0 }, farFrom: { value: 40 }, grid: { value: 0 },
};
const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
if (GL2) mat.defines = { HEX_GRAD: '' };        // WebGL 2 can give each turned read its own true gradients (no seams); WebGL 1 lets the blend hide them
mat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = `
    uniform sampler2D groundMap; uniform float tile, split; uniform vec2 res;
    uniform float hexOn, hexSize, hexRot, hexSharp, hexBright, macroOn, macroStr, macroSize, macroHue, farOn, farFrom, grid;
    varying vec3 vW;
    float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.1 + 3.3) + 0.0625 * vn(p * 8.3 + 1.7); }
    vec3 readAt(vec2 uv, vec2 dx, vec2 dy) {
    #ifdef HEX_GRAD
      return textureGrad(groundMap, uv, dx, dy).rgb;
    #else
      return texture2D(groundMap, uv).rgb;
    #endif
    }
    // one grid vertex's read: its own random turn and shift of the texture
    vec3 vertexRead(vec2 id, vec2 uv, vec2 dx, vec2 dy) {
      vec2 r = h2(id); float a = (r.x - 0.5) * 2.0 * hexRot; float c = cos(a), s = sin(a); mat2 R = mat2(c, -s, s, c);
      return readAt(R * uv + r * 17.0, R * dx, R * dy);
    }
    vec3 hexTile(vec2 uv) {
      vec2 dx = dFdx(uv), dy = dFdy(uv);
      // the triangle grid, skewed so it is equilateral; w: the three barycentric weights
      vec2 st = uv / hexSize * 3.4641016;
      vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
      vec2 base = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
      float sg = step(0.0, -t.z), s2 = 2.0 * sg - 1.0;
      vec3 w = vec3(-t.z * s2, sg - t.y * s2, sg - t.x * s2);
      vec2 v1 = base + vec2(sg, sg), v2 = base + vec2(sg, 1.0 - sg), v3 = base + vec2(1.0 - sg, sg);
      vec3 c1 = vertexRead(v1, uv, dx, dy), c2 = vertexRead(v2, uv, dx, dy), c3 = vertexRead(v3, uv, dx, dy);
      vec3 L = vec3(0.299, 0.587, 0.114), D = mix(vec3(1.0), vec3(dot(c1, L), dot(c2, L), dot(c3, L)), hexBright);
      vec3 W = D * pow(max(w, vec3(0.0)), vec3(hexSharp)); W /= (W.x + W.y + W.z + 1e-5);
      return c1 * W.x + c2 * W.y + c3 * W.z;
    }
  ` + sh.fragmentShader.replace('#include <map_fragment>', `
    vec2 uv = vW.xz / tile;
    bool plain = gl_FragCoord.x < split * res.x;
    vec3 g;
    if (plain || hexOn < 0.5) g = texture2D(groundMap, uv).rgb; else g = hexTile(uv);
    if (!plain) {
      if (farOn > 0.5) {
        float k = smoothstep(farFrom, farFrom * 2.5, length(vW - cameraPosition));
        if (k > 0.001) { vec2 u2 = uv * 0.25 + vec2(0.37, 0.61); vec3 g2 = hexOn > 0.5 ? hexTile(u2) : texture2D(groundMap, u2).rgb; g = mix(g, mix(g, g2, 0.65), k); }
      }
      if (macroOn > 0.5) {
        float n = fbm(vW.xz / macroSize), n2 = fbm(vW.xz / (macroSize * 1.7) + 31.0);
        vec3 tint = mix(vec3(1.12, 1.02, 0.78), vec3(0.82, 1.06, 0.84), smoothstep(0.3, 0.7, n2));   // dry and yellow to green and lush
        g *= mix(vec3(1.0), tint, macroHue * macroStr) * mix(1.0, 0.62 + 0.76 * n, macroStr);
      }
    }
    if (grid > 0.5) { vec2 f = abs(fract(uv + 0.5) - 0.5) / fwidth(uv); g = mix(g, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 1.5, min(f.x, f.y))); }
    diffuseColor.rgb *= g;
  `);
};
mat.customProgramCacheKey = () => 'terrain-lab-1' + (GL2 ? 'g' : '');
if (!GL2) mat.extensions = { derivatives: true };
const ground = new THREE.Mesh(geo, mat); scene.add(ground);

// ── views ─────────────────────────────────────────────────────────────────────
const VIEWS = {
  'Standing': () => { const y = heightAt(0, 40) + 1.7; camera.position.set(0, y, 40); controls.target.set(0, heightAt(0, -60) + 1.2, -60); },
  'Across the field': () => { camera.position.set(-40, heightAt(-40, 120) + 14, 120); controls.target.set(60, heightAt(60, -200), -200); },
  'Hillside': () => { camera.position.set(260, heightAt(260, 260) + 40, 260); controls.target.set(0, 0, 0); },
  'Overhead': () => { camera.position.set(0, 160, 0.1); controls.target.set(0, 0, 0); },
};
for (const [n, f] of Object.entries(VIEWS)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.onclick = () => { f(); controls.update(); }; $('views').appendChild(b); }
VIEWS['Standing'](); controls.update();

// ── the panel ─────────────────────────────────────────────────────────────────
const SL = {
  tile: [v => { U.tile.value = v; }, v => v.toFixed(1) + ' m'],
  hexSize: [v => { U.hexSize.value = v; }, v => v.toFixed(2)],
  hexRot: [v => { U.hexRot.value = THREE.MathUtils.degToRad(v); }, v => Math.round(v) + '°'],
  hexSharp: [v => { U.hexSharp.value = v; }, v => v.toFixed(1)],
  hexBright: [v => { U.hexBright.value = v; }, v => Math.round(v * 100) + '%'],
  macroStr: [v => { U.macroStr.value = v; }, v => Math.round(v * 100) + '%'],
  macroSize: [v => { U.macroSize.value = v; }, v => v + ' m'],
  macroHue: [v => { U.macroHue.value = v; }, v => Math.round(v * 100) + '%'],
  farFrom: [v => { U.farFrom.value = v; }, v => v + ' m'],
};
for (const [id, [apply, fmt]] of Object.entries(SL)) { const el = $(id), go = () => { apply(+el.value); $(id + 'Out').textContent = fmt(+el.value); }; el.addEventListener('input', go); go(); }
for (const [id, key] of [['hexOn', 'hexOn'], ['macroOn', 'macroOn'], ['farOn', 'farOn'], ['grid', 'grid']]) { const el = $(id), go = () => { U[key].value = el.checked ? 1 : 0; }; el.addEventListener('change', go); go(); }
$('tex').addEventListener('change', () => { U.groundMap.value = tex($('tex').value); });
$('min').onclick = () => { $('panel').classList.toggle('min'); $('min').textContent = $('panel').classList.contains('min') ? 'show' : 'hide'; };

// the split line
let splitX = 0.5;
const placeSplit = () => { const on = $('splitOn').checked; $('split').style.display = on ? '' : 'none'; $('split').style.left = (splitX * 100) + '%'; U.split.value = on ? splitX : 0; };
$('splitOn').addEventListener('change', placeSplit); placeSplit();
{ let drag = false; $('split').addEventListener('pointerdown', (e) => { drag = true; $('split').setPointerCapture(e.pointerId); e.stopPropagation(); });
  $('split').addEventListener('pointermove', (e) => { if (!drag) return; splitX = THREE.MathUtils.clamp(e.clientX / innerWidth, 0, 1); placeSplit(); });
  $('split').addEventListener('pointerup', () => { drag = false; }); }

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(U.res.value); });
renderer.getDrawingBufferSize(U.res.value);
const clock = new THREE.Clock(); let fps = 60, shown = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (dt > 0) fps += (1 / dt - fps) * Math.min(1, dt * 2);
  if ((shown += dt) > 0.5) { shown = 0; $('hud').innerHTML = `<b>${Math.round(fps)} fps</b> · ${(1000 / Math.max(1, fps)).toFixed(1)} ms · ${GL2 ? 'WebGL2' : 'WebGL1'}`; }
  controls.update(); renderer.render(scene, camera);
});
if (Q.has('probe')) Object.assign(window, { THREE, scene, camera, controls, U, VIEWS });
