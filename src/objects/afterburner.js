// AFTERBURNER. A plume per engine: a tapered tube drawn additively, see-through, with a white-
// orange core inside a violet sheath, shock diamonds as bright rings down the core that spread
// out as thrust rises, a flicker running down the length and a slow throb, and the whole plume
// lengthening with thrust. `thrust` is 0 (idle glow) to 1 (full burn); nudge it every frame with
// update(dt) and set it with setThrust().
import * as THREE from 'three';

const VERT = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float len; uniform float time; uniform float thrust;
  varying float vT; varying vec3 vN; varying vec3 vView;
  void main() {
    // the tube's y runs 0 (nozzle) to 1 (tip); it tapers and it wavers a little down its length
    vT = position.y;
    float radius = (1.0 - vT * 0.85) * (0.8 + 0.4 * thrust);
    vec2 xz = position.xz * radius;
    float waver = 0.06 * vT * sin(time * 9.0 + vT * 14.0) * (1.0 + thrust);
    vec3 p = vec3(xz.x + waver, vT * len * (0.35 + 0.65 * thrust), xz.y + waver * 0.6);
    vN = normalMatrix * vec3(position.x, 0.0, position.z);         // the tube's outward normal
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float time; uniform float thrust; uniform vec3 coreColour; uniform vec3 outerColour;
  varying float vT; varying vec3 vN; varying vec3 vView;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  void main() {
    #include <logdepthbuf_fragment>
    // "how far from the axis" as the eye sees it: the skin facing the eye is the plume's middle,
    // the skin edge-on to the eye is its rim (the geometry's own radius is the rim everywhere)
    float facing = abs(dot(normalize(vN), normalize(-vView)));
    float t = vT, r = 1.0 - facing;
    // the core fades down the length, the sheath sooner at the rim
    float coreW = smoothstep(0.75, 0.15, r);
    float fadeLen = pow(1.0 - t, 1.3);
    // shock diamonds: bright rings down the core, their spacing opening with thrust, fading with distance
    float spacing = 0.09 + 0.09 * thrust;
    float diamonds = pow(0.5 + 0.5 * cos(t / spacing * 6.2831853), 6.0) * (1.0 - t) * coreW;
    // flicker down the plume and a slow throb of the whole
    float flick = 0.85 + 0.3 * noise1(t * 18.0 - time * 26.0) + 0.1 * sin(time * 3.7);
    vec3 core = mix(vec3(1.0, 0.98, 0.9), coreColour, smoothstep(0.0, 0.5, r + t * 0.4));
    vec3 col = mix(outerColour, core, coreW) * (0.55 + 0.45 * thrust);
    col += vec3(1.0, 0.9, 0.7) * diamonds * 1.6;
    float alpha = (1.0 - r * r) * fadeLen * flick * (0.35 + 0.65 * thrust);
    gl_FragColor = vec4(col * alpha, alpha);
  }`;

// the glowing disc in each nozzle, for the view from behind where the tube is edge-on
const CAP_VERT = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const CAP_FRAG = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float time; uniform float thrust; uniform vec3 coreColour; uniform vec3 outerColour;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv * 2.0 - 1.0);
    float pulse = 0.9 + 0.1 * sin(time * 23.0) + 0.05 * sin(time * 41.0);
    vec3 col = mix(vec3(1.0, 0.98, 0.9), coreColour, smoothstep(0.0, 0.55, r)); col = mix(col, outerColour, smoothstep(0.55, 1.0, r));
    float alpha = (1.0 - smoothstep(0.6, 1.0, r)) * (0.25 + 0.75 * thrust) * pulse;
    gl_FragColor = vec4(col * alpha, alpha);
  }`;

// nozzle positions from the fighter's own geometry (the part lies along +x, nose at +x): the
// points at the tail end, split left and right of the centre line
export function findNozzles(F, { tailFrac = 0.08 } = {}) {
  const pos = F.geometry.attributes.position, minX = F.box.min.x, cut = minX + (F.box.max.x - minX) * tailFrac;
  const sides = { l: [], r: [] };
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x > cut) continue; (pos.getZ(i) < 0 ? sides.l : sides.r).push([x, pos.getY(i), pos.getZ(i)]); }
  const mid = (a) => { if (!a.length) return null; const m = [0, 0, 0]; for (const p of a) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; } return new THREE.Vector3(minX, m[1] / a.length, m[2] / a.length); };
  return [mid(sides.l), mid(sides.r)].filter(Boolean);
}

// `group` is the fighter (in the part's units); the plumes are added to it and the group gets
// userData.burner with setThrust(k) and update(dt)
// ship1's two nacelles, measured in Blender (2026-09-20): their exhaust ends in the part's units
export const SHIP1_NOZZLES = [new THREE.Vector3(-0.43, 0.12, -0.115), new THREE.Vector3(-0.43, 0.12, 0.115)];
export function addAfterburner(group, F, { radius = 0.05, length = 0.6, coreColour = 0xff8a2a, outerColour = 0x7a3cff, nozzles = SHIP1_NOZZLES } = {}) {
  nozzles = nozzles || findNozzles(F);
  const geo = new THREE.CylinderGeometry(1, 1, 1, 18, 24, true); geo.translate(0, 0.5, 0);   // y 0..1
  const mat = new THREE.ShaderMaterial({
    uniforms: { len: { value: length / radius }, time: { value: 0 }, thrust: { value: 0.6 }, coreColour: { value: new THREE.Color(coreColour) }, outerColour: { value: new THREE.Color(outerColour) } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const capMat = new THREE.ShaderMaterial({ uniforms: mat.uniforms, vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const capGeo = new THREE.CircleGeometry(1, 24);
  const plumes = nozzles.map(n => {
    const m = new THREE.Mesh(geo, mat); m.position.copy(n); m.rotation.z = Math.PI / 2;      // +y -> -x: the plume streams aft
    m.scale.setScalar(radius); m.frustumCulled = false; m.renderOrder = 5; group.add(m);
    const cap = new THREE.Mesh(capGeo, capMat); cap.position.copy(n).x += 0.004; cap.rotation.y = -Math.PI / 2; cap.scale.setScalar(radius * 1.15); cap.frustumCulled = false; cap.renderOrder = 6; group.add(cap);
    m.userData.cap = cap; return m;
  });
  const burner = { plumes, mat, thrust: 0.6, target: 0.6, setThrust(k) { burner.target = THREE.MathUtils.clamp(k, 0, 1); },
    update(dt) { burner.thrust += (burner.target - burner.thrust) * Math.min(1, dt * 4); mat.uniforms.thrust.value = burner.thrust; mat.uniforms.time.value += dt; } };
  group.userData.burner = burner;
  return burner;
}
