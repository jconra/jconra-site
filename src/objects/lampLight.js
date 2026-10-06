// LAMP LIGHT: street lamps lighting what stands round them (the walls and props, plants, rocks, people), at the cost of
// one picture read a pixel however many lamps there are. Every lamp's light is painted once into a picture of the
// ground round them, seen from above (buildLampMap: a few milliseconds, again whenever a lamp moves); a shader reads
// it where its pixel stands. No lamp shadows: the light reaches through a bench to the ground beneath.
//
//   makeLampUniforms()           { lampMap, lampArea, lampSpan, lampColour, lampOn }: share one object among every material
//   buildLampMap(u, lamps)       lamps: [{ x, z, y (the light's height, world), reach (m), strength (0..1) }]
//   LAMP_GLSL                    the uniforms and lampLight(worldPos, normalView) -> light (as a light's irradiance:
//                                a lit surface adds it times its albedo over pi); a zero normal: lit evenly all round
//   lampStandard(fragmentShader) a MeshStandard / Lambert / Phong shader with the lamps' light added to its diffuse
//
// The picture: R how much light (all the lamps' together), G B the way toward them across the ground (weighted, so
// under a lamp it shrinks to nothing and the light comes from above), A the light's height. Over the light's height it
// fades out within a few metres (the lamps light the lower walls, the props and the people, not the roofs).
import * as THREE from 'three';

const REACH_NOMINAL = 9;                              // (m: the across-the-ground part of the light's way, for its slant)

export function makeLampUniforms() {
  return { lampMap: { value: null }, lampArea: { value: new THREE.Vector4(0, 0, 1, 0) }, lampSpan: { value: 10 }, lampColour: { value: new THREE.Color(3.0, 1.85, 0.95) }, lampOn: { value: 0 } };
}

export function buildLampMap(u, lamps, metresPerPixel = 0.3, maxSize = 1024) {
  if (!lamps.length) { u.lampOn.value = 0; if (u.lampMap.value) { u.lampMap.value.image.data.fill(0); u.lampMap.value.needsUpdate = true; } return null; }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of lamps) { x0 = Math.min(x0, l.x - l.reach); x1 = Math.max(x1, l.x + l.reach); z0 = Math.min(z0, l.z - l.reach); z1 = Math.max(z1, l.z + l.reach); y0 = Math.min(y0, l.y); y1 = Math.max(y1, l.y); }
  const side = Math.max(x1 - x0, z1 - z0) + 4, M = Math.max(16, Math.min(maxSize, Math.ceil(side / metresPerPixel))), px = side / M;
  const ax = x0 - 2, az = z0 - 2, base = y0 - 1, span = Math.max(4, y1 - y0 + 2);   // (the A channel: from a metre under the lowest light to a metre over the highest)
  const sum = new Float32Array(M * M), vx = new Float32Array(M * M), vz = new Float32Array(M * M), hy = new Float32Array(M * M);
  for (const l of lamps) {
    const i0 = Math.max(0, Math.floor((l.x - l.reach - ax) / px)), i1 = Math.min(M - 1, Math.ceil((l.x + l.reach - ax) / px));
    const j0 = Math.max(0, Math.floor((l.z - l.reach - az) / px)), j1 = Math.min(M - 1, Math.ceil((l.z + l.reach - az) / px));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = ax + (i + 0.5) * px, z = az + (j + 0.5) * px, dx = l.x - x, dz = l.z - z, d = Math.hypot(dx, dz), t = d / l.reach;
      if (t >= 1) continue;
      const f = Math.pow(1 - t, 2.2) * (l.strength ?? 1), k = j * M + i;   // (the falloff of the pool painted on the ground under it)
      sum[k] += f; vx[k] += f * dx / REACH_NOMINAL; vz[k] += f * dz / REACH_NOMINAL; hy[k] += f * l.y;
    }
  }
  const data = u.lampMap.value && u.lampMap.value.image.width === M ? u.lampMap.value.image.data : new Uint8Array(M * M * 4);
  for (let k = 0; k < M * M; k++) {
    const s = sum[k], o = k * 4;
    if (s <= 1e-4) { data[o] = 0; data[o + 1] = 128; data[o + 2] = 128; data[o + 3] = 0; continue; }
    data[o] = Math.min(255, Math.round(Math.min(1, s) * 255));
    data[o + 1] = Math.round((Math.max(-1, Math.min(1, vx[k] / s)) * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((Math.max(-1, Math.min(1, vz[k] / s)) * 0.5 + 0.5) * 255);
    data[o + 3] = Math.round(Math.max(0, Math.min(1, (hy[k] / s - base) / span)) * 255);
  }
  if (!u.lampMap.value || u.lampMap.value.image.width !== M) {
    if (u.lampMap.value) u.lampMap.value.dispose();
    const t = new THREE.DataTexture(data, M, M, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
    u.lampMap.value = t;
  }
  u.lampMap.value.needsUpdate = true;
  u.lampArea.value.set(ax, az, side, base); u.lampSpan.value = span;
  return { size: M, metresPerPixel: px };
}

export const LAMP_GLSL = `
  uniform sampler2D lampMap; uniform vec4 lampArea; uniform vec3 lampColour; uniform float lampOn, lampSpan;
  vec3 lampLight(vec3 wpos, vec3 nView) {
    if (lampOn <= 0.0) return vec3(0.0);
    vec2 luv = (wpos.xz - lampArea.xy) / lampArea.z;
    if (luv.x <= 0.0 || luv.y <= 0.0 || luv.x >= 1.0 || luv.y >= 1.0) return vec3(0.0);
    vec4 lt = texture2D(lampMap, luv);
    if (lt.r <= 0.0) return vec3(0.0);
    float below = lampArea.w + lt.a * lampSpan - wpos.y, k = lt.r * clamp(1.0 + below / 2.5, 0.0, 1.0);   // (over the light: gone 2.5 m up)
    vec3 L = normalize(vec3((lt.g * 2.0 - 1.0) * ${REACH_NOMINAL.toFixed(1)}, max(below, 0.3), (lt.b * 2.0 - 1.0) * ${REACH_NOMINAL.toFixed(1)}));
    float face = dot(nView, nView) > 0.0 ? 0.25 + 0.75 * max(dot(nView, normalize((viewMatrix * vec4(L, 0.0)).xyz)), 0.0) : 0.7;
    return lampColour * (k * face * lampOn);
  }
`;

// (after the shader's own lights: the lamps' light on its diffuse colour, as a light would add it)
export function lampStandard(fs) {
  return LAMP_GLSL + fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    { vec3 lampW = cameraPosition + (-vViewPosition) * mat3(viewMatrix); reflectedLight.directDiffuse += lampLight(lampW, normal) * BRDF_Lambert(diffuseColor.rgb); }`);
}
