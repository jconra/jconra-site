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
  const box = new THREE.Box3().setFromObject(object), centre = box.getCenter(new THREE.Vector3()), ext = box.getSize(new THREE.Vector3());
  const radius = ext.length() / 2;
  // the views are framed to the tree's real extent, not its sphere: half its footprint's diagonal
  // across, and the taller of that and half its height up - about half the pixels of the sphere,
  // and every one of them is fill rate saved on each of thousands of quads
  const halfW = Math.hypot(ext.x, ext.z) / 2, halfH = Math.max(ext.y / 2, halfW);
  const size = grid * cell;
  // mipmaps keep far imposters from shimmering (a pre-filtered picture); WebGL1 needs a power-of-two edge for them
  const mips = renderer.capabilities.isWebGL2 || (size & (size - 1)) === 0;
  const mk = () => new THREE.WebGLRenderTarget(size, size, { minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: mips, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
  const colourRT = mk(), normalRT = mk();
  const scene = new THREE.Scene();
  const holder = new THREE.Group(); holder.position.copy(centre).negate();    // the tree centred on the origin
  scene.add(holder);
  const parent = object.parent; holder.add(object);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, radius * 4);
  // colour pass: the material's own map, unlit; normal pass: the normal in the tree's frame
  const materials = new Map();
  object.traverse(o => { if (o.isMesh) materials.set(o, o.material); });
  const colourMat = (m) => { const c = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : m.color, alphaTest: m.alphaTest || (m.transparent ? 0.5 : 0), side: THREE.DoubleSide }); if (m.map) c.map.colorSpace = m.map.colorSpace; return c; };
  // the normal in the tree's frame, and in alpha the depth: 0 at the near face of the tree's sphere,
  // 0.5 at its centre plane (where the quad is drawn), 1 at the far face
  const normalMat = (m) => new THREE.ShaderMaterial({
    uniforms: { map: { value: m.map || null }, useMap: { value: m.map ? 1 : 0 }, alphaTest: { value: m.alphaTest || (m.transparent ? 0.5 : 0) }, radius: { value: radius } },
    vertexShader: `varying vec3 vN; varying vec2 vUv; varying float vZ; void main(){ vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform float useMap; uniform float alphaTest; uniform float radius; varying vec3 vN; varying vec2 vUv; varying float vZ;
      void main(){ if (useMap > 0.5 && texture2D(map, vUv).a < alphaTest) discard; vec3 n = normalize(gl_FrontFacing ? vN : -vN); gl_FragColor = vec4(n * 0.5 + 0.5, clamp((vZ - radius) / (2.0 * radius), 0.0, 1.0)); }`,
    side: THREE.DoubleSide });
  const oldTarget = renderer.getRenderTarget(), oldClear = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
  const oldScissor = renderer.getScissorTest();
  for (const [rt, mkMat] of [[colourRT, colourMat], [normalRT, normalMat]]) {
    for (const [o, m] of materials) o.material = Array.isArray(m) ? m.map(mkMat) : mkMat(m);     // a mesh with a material per face keeps them
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
  return { colour: colourRT.texture, normal: normalRT.texture, radius, halfW, halfH, centre, grid, hemi, cell };
}

// The vertex stage shared by the drawing and the shadow-casting materials: the quad turned to
// the viewer (the camera, or the light when `useOverride` is set), and the atlas cell for the
// viewer's direction in the tree's own frame.
const VERTEX = `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      #include <shadowmap_pars_vertex>
      attribute vec3 iPos; attribute float iYaw; attribute float iScale; attribute vec3 iTint; attribute float iFade;
      uniform float radius; uniform float halfW; uniform float halfH; uniform vec3 centre; uniform float grid; uniform float hemi;
      uniform vec3 viewDirOverride; uniform float useOverride; uniform float blendDist; uniform float lockCards;
      varying float vBlend;
      // the square -> a direction (the inverse of octEncode), for the cell centres
      vec3 octDecode(vec2 uv) {
        float x, y, z;
        if (hemi > 0.5) { float a = uv.x * 2.0 - 1.0, b = uv.y * 2.0 - 1.0; x = (a - b) * 0.5; z = (a + b) * 0.5; y = 1.0 - abs(x) - abs(z); }
        else { x = uv.x * 2.0 - 1.0; z = uv.y * 2.0 - 1.0; y = 1.0 - abs(x) - abs(z); if (y < 0.0) { float nx = (1.0 - abs(z)) * (x >= 0.0 ? 1.0 : -1.0); float nz = (1.0 - abs(x)) * (z >= 0.0 ? 1.0 : -1.0); x = nx; z = nz; } }
        return normalize(vec3(x, y, z));
      }
      varying vec2 vQuad; varying vec2 vFrame; varying vec3 vTint; varying float vFade; varying float vYaw; varying vec3 vViewPos; varying vec3 vToCamView; varying float vRadius; varying vec4 vShadowToCam;
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
        vec3 toCam = useOverride > 0.5 ? normalize(viewDirOverride) : normalize(cameraPosition - worldCentre);
        // the view direction in the tree's own frame: the instance's spin undone
        vec3 d = vec3(c * toCam.x - s * toCam.z, toCam.y, s * toCam.x + c * toCam.z);
        vFrame = octEncode(normalize(d));
        // the card faces the viewer - or, locked, the centre of the view cell it is showing, so it
        // only turns when its picture does, and does not swivel to watch the camera go by
        vec3 facing = toCam;
        if (lockCards > 0.5 && useOverride < 0.5) {
          vec2 cell = (floor(vFrame * grid - 0.5) + 1.0) / grid;            // the nearest cell centre
          vec3 dc = octDecode(clamp(cell, 0.5 / grid, 1.0 - 0.5 / grid));
          facing = normalize(vec3(c * dc.x + s * dc.z, dc.y, -s * dc.x + c * dc.z));   // back into the world, spun as the instance is
        }
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), facing)); vec3 up = cross(facing, right);
        vec3 world = worldCentre + (right * position.x * halfW * 2.0 + up * position.y * halfH * 2.0) * iScale;
        vBlend = useOverride > 0.5 ? 0.0 : (distance(cameraPosition, worldCentre) < blendDist ? 1.0 : 0.0);   // the three-view blend only near: far away two reads do
        vQuad = uv; vTint = iTint; vFade = iFade; vYaw = iYaw; vRadius = radius * iScale;
        vec4 mv = viewMatrix * vec4(world, 1.0); vViewPos = mv.xyz; vToCamView = (viewMatrix * vec4(toCam, 0.0)).xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        vec4 worldPosition = vec4(world, 1.0); vec3 transformedNormal = vToCamView;
        #include <shadowmap_vertex>
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        vShadowToCam = directionalShadowMatrix[0] * vec4(toCam, 0.0);      // so the shadow can be looked up at the surface's depth, not the card's
        #endif
      }`;
// the atlas lookup shared by both fragment stages: colour (straight alpha = coverage) and normal + depth
const LOOKUP = `
      uniform sampler2D atlas; uniform sampler2D atlasN; uniform float grid; uniform float blend;
      varying vec2 vQuad; varying vec2 vFrame; varying vec3 vTint; varying float vFade; varying float vYaw; varying vec3 vViewPos; varying vec3 vToCamView; varying float vRadius; varying vec4 vShadowToCam; varying float vBlend;
      uniform mat4 projectionMatrix; uniform float useDepth;
      vec4 cellSample(sampler2D t, vec2 cell) { vec2 uv = (cell + clamp(vQuad, 0.002, 0.998)) / grid; return texture2D(t, uv); }
      void lookup(out vec4 col, out vec4 nrm) {
        vec2 g = vFrame * grid - 0.5; vec2 base = floor(g); vec2 f = g - base;
        if (blend > 0.5 && vBlend > 0.5) {
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
      }
      // the fragment's depth moved to where the tree's surface is (the atlas's depth), so the
      // imposter sorts against the ground and its neighbours, and shadows itself, as a solid would
      float surfaceDepth(vec4 nrm) {
        float off = (0.5 - clamp(nrm.a, 0.0, 1.0)) * 2.0 * vRadius;                                     // toward the viewer
        vec3 p = vViewPos + vToCamView * off;
        vec4 clip = projectionMatrix * vec4(p, 1.0);
        return (clip.z / clip.w) * 0.5 + 0.5;
      }`;

// The imposter material for an InstancedBufferGeometry of quads with per-instance `iPos` (vec3),
// `iYaw` (radians), `iScale`, `iTint` (vec3) and `iFade` (0 gone .. 1 solid, dithered).
export function imposterMaterial(bake, { sunDir = new THREE.Vector3(0.5, 1, 0.3), blend = true, depth = true, shadows = true } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    atlas: { value: null }, atlasN: { value: null }, grid: { value: bake.grid }, hemi: { value: bake.hemi ? 1 : 0 },
    radius: { value: bake.radius }, halfW: { value: bake.halfW }, halfH: { value: bake.halfH }, centre: { value: bake.centre.clone() }, sunDir: { value: sunDir.clone().normalize() },
    blend: { value: blend ? 1 : 0 }, blendDist: { value: 400 }, lockCards: { value: 0 }, ambient: { value: 0.45 }, useDepth: { value: depth ? 1 : 0 }, useShadow: { value: shadows ? 1 : 0 },
    viewDirOverride: { value: new THREE.Vector3(0, 1, 0) }, useOverride: { value: 0 },
  }]);
  uniforms.atlas.value = bake.colour; uniforms.atlasN.value = bake.normal;
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: false, side: THREE.DoubleSide, lights: true, extensions: { fragDepth: true },
    vertexShader: VERTEX,
    fragmentShader: `
      #include <common>
      #include <packing>
      #include <logdepthbuf_pars_fragment>
      #include <shadowmap_pars_fragment>
      #include <lights_pars_begin>
      uniform vec3 sunDir; uniform float ambient; uniform float useShadow;
      ` + LOOKUP + `
      void main() {
        #include <logdepthbuf_fragment>
        // dithered fade, the COMPLEMENT of the mesh's: the mesh keeps the pixels where its fade beats the dither, the imposter the others, so in the crossfade every pixel is drawn by exactly one of them
        float dither = 1.0 - fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (vFade < dither) discard;
        vec4 col; vec4 nrm; lookup(col, nrm);
        if (col.a < 0.45) discard;
        #ifdef GL_EXT_frag_depth
        if (useDepth > 0.5) gl_FragDepthEXT = surfaceDepth(nrm / max(col.a, 0.001));
        #endif
        nrm /= max(col.a, 0.001); vec3 n = normalize(nrm.rgb * 2.0 - 1.0);   // read through the colour's coverage: filtered against the empty background otherwise
        float c = cos(vYaw), s = sin(vYaw);
        vec3 nw = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);          // the tree's normal, turned as the instance is
        vec3 nv = normalize((viewMatrix * vec4(nw, 0.0)).xyz);              // in view space, where three keeps its lights
        float off = (0.5 - nrm.a) * 2.0 * vRadius;
        // lit the way MeshStandardMaterial's diffuse is: the sun (shadowed) and the sky/ground light,
        // over pi, so a mesh and its imposter come out the same colour
        vec3 irradiance = vec3(0.0);
        #if NUM_DIR_LIGHTS > 0
        {
          float shadow = 1.0;
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          if (useShadow > 0.5) shadow = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0] + vShadowToCam * (useDepth > 0.5 ? off : 0.0));
          #endif
          irradiance += directionalLights[0].color * max(0.0, dot(nv, directionalLights[0].direction)) * shadow;
        }
        #endif
        #if NUM_HEMI_LIGHTS > 0
        irradiance += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, dot(nv, hemisphereLights[0].direction) * 0.5 + 0.5);
        #endif
        vec3 albedo = col.rgb / max(col.a, 0.001) * vTint;
        gl_FragColor = vec4(albedo * irradiance * RECIPROCAL_PI, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // the shadow pass: the same quad, turned to the light, its depth from the atlas, packed the way
  // three's shadow maps expect
  mat.userData.depthMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([{ atlas: { value: null }, atlasN: { value: null }, grid: { value: bake.grid }, hemi: { value: bake.hemi ? 1 : 0 }, radius: { value: bake.radius }, halfW: { value: bake.halfW }, halfH: { value: bake.halfH }, centre: { value: bake.centre.clone() },
      blend: { value: blend ? 1 : 0 }, blendDist: { value: 0 }, lockCards: { value: 0 }, useDepth: { value: depth ? 1 : 0 }, viewDirOverride: { value: sunDir.clone().normalize() }, useOverride: { value: 1 } }]),
    side: THREE.DoubleSide, extensions: { fragDepth: true },
    vertexShader: VERTEX,
    fragmentShader: `
      #include <common>
      #include <packing>
      ` + LOOKUP + `
      void main() {
        float dither = 1.0 - fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (vFade < dither) discard;
        vec4 col; vec4 nrm; lookup(col, nrm);
        if (col.a < 0.45) discard;
        float z = gl_FragCoord.z;
        #ifdef GL_EXT_frag_depth
        if (useDepth > 0.5) { z = surfaceDepth(nrm / max(col.a, 0.001)); gl_FragDepthEXT = z; }
        #endif
        gl_FragColor = packDepthToRGBA(z);
      }`,
  });
  mat.userData.depthMaterial.uniforms.atlas.value = bake.colour; mat.userData.depthMaterial.uniforms.atlasN.value = bake.normal;
  return mat;
}
