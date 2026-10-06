// LAWN: short grass in tufts, the Grass Lab's curved blades, for ground the bigger plants leave open.
// One instanced mesh: a tuft of a few blades, copied per spot (turned, sized, tinted a little), bent by
// the shared wind. Each blade is a short strip of triangles curving over toward its tip.
//
//   makeLawn({ cap, shade }) -> { mesh, set(spots), colours(root, tip) }
//   spots: [{ x, y, z, turn, size }];  shade (optional): { shadeMap, landSize, hillShade, aoShade, treeShade }
//   uniforms, to darken the blades with the land's baked shade like everything else on it
import * as THREE from 'three';
import { LAMP_GLSL } from './lampLight.js';
import { WIND, WIND_GLSL } from './wind.js';

function tuftGeometry({ blades = 7, height = 0.32, width = 0.022, segs = 3, spread = 0.12 }) {
  const pos = [], aH = [];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread, bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const turn = rnd() * Math.PI * 2, h = height * (0.65 + 0.7 * rnd()), bend = (0.25 + 0.35 * rnd()) * h, c = Math.cos(turn), s = Math.sin(turn);
    const pt = (t, side) => {                                         // up the blade, over toward its tip; tapering
      const u = 1 - t, x = 2 * u * t * 0 + t * t * bend, y = 2 * u * t * h * 0.62 + t * t * h, w = width * (1 - 0.85 * t) * side;
      return [bx + c * w + s * x, y, bz - s * w + c * x];
    };
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs, a0 = pt(t0, -1), b0 = pt(t0, 1), a1 = pt(t1, -1), b1 = pt(t1, 1);
      pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
      aH.push(t0, t0, t1, t0, t1, t1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  return g;
}

export function makeLawn({ cap = 60000, shade = null, lamps = null } = {}) {   // lamps: lampLight.js's uniforms, shared
  const geo = tuftGeometry({});
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3), iTurn = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2), iVary = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  for (const a of [iPos, iTurn, iVary]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos); geo.setAttribute('iTurn', iTurn); geo.setAttribute('iVary', iVary); geo.instanceCount = 0;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    root: { value: new THREE.Color(0.25, 0.36, 0.1) }, tip: { value: new THREE.Color(0.45, 0.55, 0.18) }, sunDir: { value: new THREE.Vector3(-0.5, 0.7, -0.4).normalize() },
    // the light's colour against the noon it was tuned in (white: as tuned): skyTint for the even part, sunTint for the
    // part that faces the sun (the hill's and trees' shadows take that one only), so a time of day can light it
    skyTint: { value: new THREE.Color(1, 1, 1) }, sunTint: { value: new THREE.Color(1, 1, 1) },
    shadeMap: { value: null }, landSize: { value: 1600 }, hillShade: { value: 0 }, aoShade: { value: 0 }, treeShade: { value: 0 } }]);
  Object.assign(uniforms, WIND.uniforms);
  if (shade) Object.assign(uniforms, shade);                          // shared objects: the land's shade, live
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide, fog: true,
    vertexShader: WIND_GLSL + `
      #include <fog_pars_vertex>
      attribute float aH; attribute vec3 iPos; attribute vec2 iTurn; attribute vec2 iVary;
      varying float vH; varying vec2 vVary; varying vec3 vN; varying vec2 vLand;
      void main() {
        float c = cos(iTurn.x), s = sin(iTurn.x);
        vec3 p = position * iTurn.y; p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        vec3 world = iPos + p;
        world.xz += windAt(iPos.xz) * aH * aH * p.y * 2.5;                // the blades are short and soft: they bend further than the plants
        vH = aH; vVary = iVary; vLand = iPos.xz; vN = normalize(vec3(s, 0.6, c));
        vec4 mv = viewMatrix * vec4(world, 1.0); gl_Position = projectionMatrix * mv;
        #ifdef USE_FOG
        vFogDepth = -mv.z;
        #endif
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 root, tip, sunDir, skyTint, sunTint; uniform sampler2D shadeMap; uniform float landSize, hillShade, aoShade, treeShade;
      varying float vH; varying vec2 vVary; varying vec3 vN; varying vec2 vLand;
      void main() {
        vec3 col = mix(root, tip, smoothstep(0.1, 1.0, vH)) * (1.0 + vVary.y);
        col = mix(col, col.yxz * vec3(1.0, 1.0, 0.8), vVary.x);         // some blades a touch yellower
        float sunPart = 0.47 + 0.35 * abs(dot(normalize(vN), sunDir)), ao = 1.0;   // (with the 0.28 even part, the sky's share of noon's light as the ground gets it: 0.75 .. 1.1, as it was)
        if (hillShade + aoShade + treeShade > 0.0) { vec3 sd = texture2D(shadeMap, vLand / landSize + 0.5).rgb;
          sunPart *= mix(1.0, sd.r, hillShade) * (1.0 - treeShade * sd.b * 0.6);
          ao = mix(1.0, 0.3 + 0.7 * sd.g, aoShade) * (1.0 - treeShade * sd.b * 0.35); }
        gl_FragColor = vec4(col * (skyTint * 0.28 + sunTint * sunPart) * ao, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  if (lamps) {                                                         // street lamps lighting the tufts round them (lit evenly all round)
    mat.vertexShader = 'varying vec3 vWorldL;\n' + mat.vertexShader.replace('vH = aH; vVary = iVary;', 'vWorldL = world; vH = aH; vVary = iVary;');
    mat.fragmentShader = 'varying vec3 vWorldL;\n' + LAMP_GLSL + mat.fragmentShader.replace('gl_FragColor = vec4(col * (skyTint * 0.28 + sunTint * sunPart) * ao, 1.0);',
      'gl_FragColor = vec4(col * ((skyTint * 0.28 + sunTint * sunPart) * ao + lampLight(vWorldL, vec3(0.0)) * 0.318), 1.0);');
    Object.assign(mat.uniforms, lamps);
  }
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  function set(spots) {
    const n = Math.min(cap, spots.length);
    for (let k = 0; k < n; k++) { const t = spots[k]; iPos.setXYZ(k, t.x, t.y, t.z); iTurn.setXY(k, t.turn, t.size); iVary.setXY(k, t.yellow, t.light); }
    geo.instanceCount = n; for (const a of [iPos, iTurn, iVary]) a.needsUpdate = true;
    return n;
  }
  const colours = (r, t) => { uniforms.root.value.copy(r); uniforms.tip.value.copy(t); };
  return { mesh, set, colours, uniforms, trisPerTuft: geo.attributes.position.count / 3 };
}
