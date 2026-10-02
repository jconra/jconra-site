// WIND: one breeze for everything that sways (the lawn's blades, the ground plants up close, and their
// imposters far off), so a gust crosses all of them together. It is the Grass Lab's: two waves of
// different size and direction rolling across the ground, a spot's lean the sum of the two.
//
// WIND_GLSL gives windAt(xz): the lean (metres per metre of height, sideways in x and z) at a spot on the
// ground right now. A vertex then moves by windAt(base) x its height above its base, scaled by how far up
// the plant it is (squared: the base stays put, the tip moves most) and by the plant's own sway (big,
// stiff plants less). Share WIND.uniforms with the material and advance WIND.uniforms.windTime each frame.
import * as THREE from 'three';

export const WIND_GLSL = `
  uniform float windTime, windAmp, windFreq, windSpeed;
  vec2 windAt(vec2 p) {
    float ph  = p.x * windFreq + p.y * windFreq * 0.85 + windTime * windSpeed;
    float ph2 = p.x * windFreq * 0.42 - p.y * windFreq * 0.55 + windTime * windSpeed * 0.6;
    return windAmp * vec2(sin(ph) + 0.5 * sin(ph2), 0.8 * (cos(ph * 0.9) + 0.5 * sin(ph2)));
  }
`;
// amp: lean per metre of height at the strongest; freq: how close the waves are (per metre); speed: how fast they roll
export const WIND = { on: true, uniforms: { windTime: { value: 0 }, windAmp: { value: 0.12 }, windFreq: { value: 0.16 }, windSpeed: { value: 1.6 } } };
export const tickWind = (dt) => { WIND.uniforms.windTime.value += dt; };

// for a three material made by the engine (MeshStandard/Lambert, instanced): bend its vertices in the wind.
// heightLocal: the plant's height in the geometry's own units (its base at y = 0); sway: 0 still .. 1 full.
export function swayMaterial(mat, heightLocal, sway = 1, key = '') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, WIND.uniforms, { windH: { value: heightLocal }, windSway: { value: sway } });
    sh.vertexShader = WIND_GLSL + 'uniform float windH, windSway;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      mat4 toWorld = modelMatrix;
      #ifdef USE_INSTANCING
      toWorld = modelMatrix * instanceMatrix;
      #endif
      vec4 wpos = toWorld * mvPosition;
      vec3 wbase = (toWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float up = clamp(transformed.y / windH, 0.0, 1.0), tall = length(toWorld[1].xyz) * windH;
      wpos.xz += windAt(wbase.xz) * up * up * tall * windSway;
      mvPosition = viewMatrix * wpos;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '-wind' + key;
  mat.needsUpdate = true;
  return mat;
}
