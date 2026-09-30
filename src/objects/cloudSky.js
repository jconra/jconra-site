// CLOUD SKY: a dome that follows the camera, blue from the horizon up, with clouds on a flat layer
// high overhead (so they sit in perspective and drift). SKY_GLSL is the same sky as a shader
// function, skyAt(from, dir), for anything that reflects it (water): include it in that shader and
// share the uniforms, and the reflection matches the dome exactly.
//
// The horizon colour should be the scene's fog colour: the dome goes through the same tone mapping
// as the land, so far-off land fades into it without a seam.
import * as THREE from 'three';

export const SKY_GLSL = `
  uniform vec3 skyHorizon, skyZenith; uniform float cloudOn, cloudCover, cloudSoft, cloudScale, cloudHeight, cloudSpeed, skyTime;
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
    vec3 col = mix(skyHorizon, skyZenith, pow(clamp(dir.y, 0.0, 1.0), 0.55));
    vec2 c = skyCloud(from, dir);
    return mix(col, vec3(1.0, 0.99, 0.97) * c.y * 1.15, c.x);
  }
`;

export function makeCloudSky({ horizon = 0xa9c8e4, zenith = 0x4f86c6, radius = 4500 } = {}) {
  const uniforms = {
    skyHorizon: { value: new THREE.Color(horizon) }, skyZenith: { value: new THREE.Color(zenith) },
    cloudOn: { value: 1 }, cloudCover: { value: 0.42 }, cloudSoft: { value: 0.18 }, cloudScale: { value: 900 },
    cloudHeight: { value: 1500 }, cloudSpeed: { value: 0.015 }, skyTime: { value: 0 },
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
