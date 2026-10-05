// CLOUD SKY: a dome that follows the camera, blue from the horizon up, with clouds on a flat layer
// high overhead (so they sit in perspective and drift). SKY_GLSL is the same sky as a shader
// function, skyAt(from, dir), for anything that reflects it (water): include it in that shader and
// share the uniforms, and the reflection matches the dome exactly.
//
// The horizon colour should be the scene's fog colour: the dome goes through the same tone mapping
// as the land, so far-off land fades into it without a seam.
//
// The sun (all optional; left alone, the sky is as it always was): sunDirSky the way to the sun; skyToward the
// horizon's colour looking toward it (skyHorizon is the one looking away; between them by how much a direction faces
// the sun, broadly: skyTowardSun below); glowCol the haze round the sun and the gold on clouds near it; sunDisc the
// disc's colour (bright, past 1: the tone mapping rolls it off); cloudLit the clouds' colour as lit toward the sun,
// cloudLitAway away from it; starAmt 0..1 stars
// (above the clouds' gaps only); moonDir / moonAmt a pale moon. A shader including SKY_GLSL may set skyDiscK (0..1) before
// calling skyAt to leave the sun's disc and glare out (water the sun can't reach mirrors the sky without it). With LITE defined
// (the Terrain Lab's potato ground) the haze, stars, moon and disc are left out: there the dome isn't drawn, only mirrored.
import * as THREE from 'three';

export const SKY_GLSL = `
  uniform vec3 skyHorizon, skyZenith; uniform float cloudOn, cloudCover, cloudSoft, cloudScale, cloudHeight, cloudSpeed, skyTime;
  uniform vec3 sunDirSky, skyToward, glowCol, sunDisc, cloudLit, cloudLitAway, moonDir; uniform float starAmt, moonAmt;
  float skyDiscK = 1.0;
  // how much a direction looks toward the sun (0 away .. 1 toward): broad, so a sunset warms half the sky. The Terrain
  // Lab's haze leans by the same amount, so the haze and the sky behind it always agree
  float skyTowardSun(vec3 dir) { vec3 f = vec3(sunDirSky.x, 0.0, sunDirSky.z); float l = length(f); if (l < 1e-4) return 0.0; return pow(clamp(dot(dir, f / l) * 0.5 + 0.5, 0.0, 1.0), 3.0); }
  float skyH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float skyN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(skyH(i), skyH(i + vec2(1.0, 0.0)), f.x), mix(skyH(i + vec2(0.0, 1.0)), skyH(i + vec2(1.0, 1.0)), f.x), f.y); }
  float skyF(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * skyN(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
  // x: how much cloud looking along dir from a point, y: its shade (lit edges, greyer middles)
  vec2 skyCloud(vec3 from, vec3 dir) {
    if (cloudOn < 0.5 || dir.y < 0.01) return vec2(0.0, 1.0);
    vec2 p = (from.xz + dir.xz * (cloudHeight - from.y) / dir.y) / cloudScale + vec2(1.0, 0.4) * skyTime * cloudSpeed;
    vec2 w = vec2(skyF(p * 0.5 + 3.1), skyF(p * 0.5 + 7.7));          // warped, so the shapes billow instead of blotch
    float d = skyF(p + w * 0.8), lit = skyF(p + w * 0.8 + vec2(0.06, 0.04));
    float c = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + cloudSoft, d);
    return vec2(c * smoothstep(0.02, 0.18, dir.y), clamp(0.8 + (lit - d) * 4.0 + (1.0 - c) * 0.2, 0.62, 1.05));
  }
  vec3 skyAt(vec3 from, vec3 dir) {
    float up = pow(clamp(dir.y, 0.0, 1.0), 0.55), sd = max(dot(dir, sunDirSky), 0.0);
    vec3 col = mix(mix(skyHorizon, skyToward, skyTowardSun(dir) * (1.0 - up * 0.7)), skyZenith, up);
    #ifndef LITE
    col += glowCol * (pow(sd, 5.0) * 0.45 + pow(sd, 48.0) * 0.9);                // the haze round the sun, wide and bright near it
    if (starAmt > 0.0 && dir.y > 0.0) { vec3 q = dir * 260.0; vec3 cell = floor(q); float h = skyH(cell.xz + cell.y * 17.13);
      float star = step(0.9965, h) * smoothstep(0.55, 0.0, length(fract(q) - 0.5)) * (0.5 + 0.5 * skyH(cell.zy + 3.7));
      col += vec3(0.9, 0.94, 1.0) * star * starAmt * smoothstep(0.0, 0.15, dir.y); }
    if (moonAmt > 0.0) { float md = dot(dir, moonDir); col += vec3(0.82, 0.86, 0.95) * moonAmt * (smoothstep(0.99985, 0.99992, md) * 3.0 + pow(max(md, 0.0), 64.0) * 0.12); }
    #endif
    vec2 c = skyCloud(from, dir);
    vec3 cl = mix(cloudLitAway, cloudLit, skyTowardSun(dir)) * c.y * 1.15 + glowCol * pow(sd, 4.0) * 0.55;   // clouds: lit by the sun's colour (cloudLit toward it, cloudLitAway away), gold near it
    col = mix(col, cl, c.x);
    #ifndef LITE
    col += sunDisc * (smoothstep(0.99993, 0.99997, sd) + pow(sd, 900.0) * 0.05 + pow(sd, 120.0) * 0.012) * (1.0 - c.x * 0.85) * skyDiscK;
    #endif   // the disc and its glare (a few degrees round it, brighter than any sky: what sunbeams come from), dimmed by cloud
    return col;
  }
`;

export function makeCloudSky({ horizon = 0xa9c8e4, zenith = 0x4f86c6, radius = 4500 } = {}) {
  const uniforms = {
    skyHorizon: { value: new THREE.Color(horizon) }, skyZenith: { value: new THREE.Color(zenith) },
    cloudOn: { value: 1 }, cloudCover: { value: 0.42 }, cloudSoft: { value: 0.18 }, cloudScale: { value: 900 },
    cloudHeight: { value: 1500 }, cloudSpeed: { value: 0.015 }, skyTime: { value: 0 },
    sunDirSky: { value: new THREE.Vector3(0, 1, 0) }, skyToward: { value: new THREE.Color(horizon) }, glowCol: { value: new THREE.Color(0, 0, 0) },
    sunDisc: { value: new THREE.Color(0, 0, 0) }, cloudLit: { value: new THREE.Color(1.0, 0.99, 0.97) }, cloudLitAway: { value: new THREE.Color(1.0, 0.99, 0.97) }, starAmt: { value: 0 },
    moonDir: { value: new THREE.Vector3(0, -1, 0) }, moonAmt: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_GLSL + `
      varying vec3 vDir;
      void main() { gl_FragColor = vec4(skyAt(cameraPosition, normalize(vDir)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.renderOrder = -1; mesh.frustumCulled = false;
  // call each frame: keeps the dome round the camera and the clouds drifting
  const update = (camera, dt) => { mesh.position.copy(camera.position); uniforms.skyTime.value += dt; };
  return { mesh, uniforms, update };
}
