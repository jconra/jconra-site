// OCTAHEDRAL IMPOSTERS. A tree rendered from a grid of directions into one atlas, then drawn far
// away as a single camera-facing quad that shows the view nearest the camera's own direction -
// blended from the three nearest so it does not snap as you move. The directions are laid out
// on an octahedron unfolded into a square (or half an octahedron, for things nobody looks at from
// underneath), so finding the cell for a direction is a few lines of arithmetic.
//
// Two atlases are baked: colour with the cut-out in alpha, and the normal in the tree's own frame
// (so the imposter is lit by the scene's sun, whichever way its instance is turned) with a depth
// hint in alpha. The instance carries its own spin, so a thousand trees spun differently each
// pick their own view.
import * as THREE from 'three';

// direction (unit, in the tree's frame, y up) -> square [0,1]^2
export function octEncode(d, hemi) {
  const s = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
  let x = d.x / s, z = d.z / s;
  if (hemi) return [(x + z) * 0.5 + 0.5, (z - x) * 0.5 + 0.5];          // the top half, turned 45 degrees to fill the square
  if (d.y < 0) { const nx = (1 - Math.abs(z)) * Math.sign(x || 1), nz = (1 - Math.abs(x)) * Math.sign(z || 1); x = nx; z = nz; }
  return [x * 0.5 + 0.5, z * 0.5 + 0.5];
}
// square -> direction
export function octDecode(u, v, hemi) {
  let x, y, z;
  if (hemi) { const a = u * 2 - 1, b = v * 2 - 1; x = (a - b) * 0.5; z = (a + b) * 0.5; y = 1 - Math.abs(x) - Math.abs(z); }
  else { x = u * 2 - 1; z = v * 2 - 1; y = 1 - Math.abs(x) - Math.abs(z); if (y < 0) { const nx = (1 - Math.abs(z)) * Math.sign(x || 1), nz = (1 - Math.abs(x)) * Math.sign(z || 1); x = nx; z = nz; } }
  return new THREE.Vector3(x, y, z).normalize();
}

// Bake `object` (any Object3D; its meshes are used as they are) into two atlases of `grid` x `grid`
// cells, each `cell` pixels. Returns { colour, normal, radius, centre, grid, hemi }. Done in one go;
// bakeImposterSteps below does the same a row of views at a time, for baking across frames.
export function bakeImposter(renderer, object, opts) { const it = bakeImposterSteps(renderer, object, opts); for (;;) { const s = it.next(); if (s.done) return s.value; } }   // (for..of drops a generator's return value)
export function* bakeImposterSteps(renderer, object, { grid = 12, cell = 128, hemi = true } = {}) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object), centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const size = grid * cell;
  const mk = () => new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
  const colourRT = mk(), normalRT = mk();
  const scene = new THREE.Scene();
  const holder = new THREE.Group(); holder.position.copy(centre).negate();    // the tree centred on the origin
  scene.add(holder);
  const parent = object.parent; holder.add(object);
  const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4);
  // colour pass: the material's own map, unlit; normal pass: the normal in the tree's frame
  const materials = new Map();
  object.traverse(o => { if (o.isMesh) materials.set(o, o.material); });
  const colourMat = (m) => { const c = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : m.color, alphaTest: m.alphaTest || (m.transparent ? 0.5 : 0), side: THREE.DoubleSide }); if (m.map) c.map.colorSpace = m.map.colorSpace; return c; };
  const normalMat = (m) => new THREE.ShaderMaterial({
    uniforms: { map: { value: m.map || null }, useMap: { value: m.map ? 1 : 0 }, alphaTest: { value: m.alphaTest || (m.transparent ? 0.5 : 0) } },
    vertexShader: `varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float useMap; uniform float alphaTest; varying vec3 vN; varying vec2 vUv;
      void main(){ if (useMap > 0.5 && texture2D(map, vUv).a < alphaTest) discard; vec3 n = normalize(gl_FrontFacing ? vN : -vN); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }`,
    side: THREE.DoubleSide });
  const oldTarget = renderer.getRenderTarget(), oldClear = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
  const oldScissor = renderer.getScissorTest();
  for (const [rt, mkMat] of [[colourRT, colourMat], [normalRT, normalMat]]) {
    for (const [o, m] of materials) o.material = mkMat(m);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.setScissorTest(true);
    for (let j = 0; j < grid; j++) {
    // one row of views per step: the caller can yield to the browser between rows
    if (j) { renderer.setScissorTest(oldScissor); renderer.setRenderTarget(oldTarget); yield null; renderer.setRenderTarget(rt); renderer.setScissorTest(true); }
    for (let i = 0; i < grid; i++) {
      const d = octDecode((i + 0.5) / grid, (j + 0.5) / grid, hemi);
      cam.position.copy(d).multiplyScalar(radius * 2);
      cam.up.set(0, 1, 0); if (Math.abs(d.y) > 0.995) cam.up.set(0, 0, -1);
      cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      renderer.setViewport(i * cell, j * cell, cell, cell); renderer.setScissor(i * cell, j * cell, cell, cell);
      renderer.render(scene, cam);
    } }
  }
  for (const [o, m] of materials) o.material = m;
  renderer.setScissorTest(oldScissor); renderer.setRenderTarget(oldTarget); renderer.setClearColor(oldClear, oldAlpha);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  holder.remove(object); if (parent) parent.add(object);
  object.updateMatrixWorld(true);          // the meshes' world matrices carried the holder's offset: refreshed, or anything placed by them stands half a tree low
  return { colour: colourRT.texture, normal: normalRT.texture, radius, centre, grid, hemi, cell };
}

// The imposter material for an InstancedBufferGeometry of quads with per-instance `iPos` (vec3),
// `iYaw` (radians), `iScale`, `iTint` (vec3) and `iFade` (0 gone .. 1 solid, dithered).
export function imposterMaterial(bake, { sunDir = new THREE.Vector3(0.5, 1, 0.3), blend = true } = {}) {
  const uniforms = {
    atlas: { value: bake.colour }, atlasN: { value: bake.normal }, grid: { value: bake.grid }, hemi: { value: bake.hemi ? 1 : 0 },
    radius: { value: bake.radius }, centre: { value: bake.centre.clone() }, sunDir: { value: sunDir.clone().normalize() },
    blend: { value: blend ? 1 : 0 }, ambient: { value: 0.45 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: false, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 iPos; attribute float iYaw; attribute float iScale; attribute vec3 iTint; attribute float iFade;
      uniform float radius; uniform vec3 centre; uniform float grid; uniform float hemi;
      varying vec2 vQuad; varying vec2 vFrame; varying vec3 vTint; varying float vFade; varying float vYaw;
      // direction (in the tree's frame) -> the square
      vec2 octEncode(vec3 d) {
        float s = abs(d.x) + abs(d.y) + abs(d.z); float x = d.x / s, z = d.z / s;
        if (hemi > 0.5) return vec2((x + z) * 0.5 + 0.5, (z - x) * 0.5 + 0.5);
        if (d.y < 0.0) { float nx = (1.0 - abs(z)) * (x >= 0.0 ? 1.0 : -1.0); float nz = (1.0 - abs(x)) * (z >= 0.0 ? 1.0 : -1.0); x = nx; z = nz; }
        return vec2(x * 0.5 + 0.5, z * 0.5 + 0.5);
      }
      void main() {
        float c = cos(iYaw), s = sin(iYaw);
        vec3 worldCentre = iPos + vec3(0.0, centre.y * iScale, 0.0) + vec3(c * centre.x + s * centre.z, 0.0, -s * centre.x + c * centre.z) * iScale;
        vec3 toCam = normalize(cameraPosition - worldCentre);
        // the quad faces the camera
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam)); vec3 up = cross(toCam, right);
        vec3 world = worldCentre + (right * position.x + up * position.y) * radius * 2.0 * iScale;
        // the view direction in the tree's own frame: the instance's spin undone
        vec3 d = vec3(c * toCam.x - s * toCam.z, toCam.y, s * toCam.x + c * toCam.z);
        vFrame = octEncode(normalize(d));
        vQuad = uv; vTint = iTint; vFade = iFade; vYaw = iYaw;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D atlas; uniform sampler2D atlasN; uniform float grid; uniform float blend; uniform vec3 sunDir; uniform float ambient;
      varying vec2 vQuad; varying vec2 vFrame; varying vec3 vTint; varying float vFade; varying float vYaw;
      vec4 cellSample(sampler2D t, vec2 cell) { vec2 uv = (cell + clamp(vQuad, 0.002, 0.998)) / grid; return texture2D(t, uv); }
      void main() {
        #include <logdepthbuf_fragment>
        // dithered fade
        float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (vFade < dither) discard;
        vec2 g = vFrame * grid - 0.5; vec2 base = floor(g); vec2 f = g - base;
        vec4 col; vec4 nrm;
        if (blend > 0.5) {
          // the three cells of the triangle the point falls in, weighted by where it falls
          vec2 c0, c1, c2; float w0, w1, w2;
          if (f.x + f.y < 1.0) { c0 = base; c1 = base + vec2(1.0, 0.0); c2 = base + vec2(0.0, 1.0); w1 = f.x; w2 = f.y; w0 = 1.0 - w1 - w2; }
          else { c0 = base + vec2(1.0, 1.0); c1 = base + vec2(0.0, 1.0); c2 = base + vec2(1.0, 0.0); w1 = 1.0 - f.x; w2 = 1.0 - f.y; w0 = 1.0 - w1 - w2; }
          c0 = clamp(c0, 0.0, grid - 1.0); c1 = clamp(c1, 0.0, grid - 1.0); c2 = clamp(c2, 0.0, grid - 1.0);
          col = cellSample(atlas, c0) * w0 + cellSample(atlas, c1) * w1 + cellSample(atlas, c2) * w2;
          nrm = cellSample(atlasN, c0) * w0 + cellSample(atlasN, c1) * w1 + cellSample(atlasN, c2) * w2;
        } else {
          vec2 cell = clamp(floor(vFrame * grid), 0.0, grid - 1.0);
          col = cellSample(atlas, cell); nrm = cellSample(atlasN, cell);
        }
        if (col.a < 0.45) discard;
        vec3 n = normalize(nrm.rgb / max(nrm.a, 0.001) * 2.0 - 1.0);
        float c = cos(vYaw), s = sin(vYaw);
        vec3 nw = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);          // the tree's normal, turned as the instance is
        float light = ambient + (1.0 - ambient) * max(0.0, dot(nw, normalize(sunDir)));
        gl_FragColor = vec4(col.rgb / max(col.a, 0.001) * vTint * light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}
