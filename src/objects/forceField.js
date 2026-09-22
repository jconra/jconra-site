// FORCE FIELD. The RMRF shield (js/ShieldShader.js there: hex grid, rim glow, flashing cells, rings
// where it is hit, blue going red as it drains - Jacob's tuned values from the shield lab) made
// into a FENCE: emitter posts round a perimeter and a flat translucent panel between each pair.
// The bubble shader worked on a sphere; here the hex runs over the panel's own metres, the rim
// glow sits along the top and beside the posts, and a hit is a flat ring spreading from the spot.
import * as THREE from 'three';

export const MAX_HITS = 6;

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vM;            // metres along the panel and up it
  varying vec3 vViewDir; varying vec3 vN;
  uniform float uWidth; uniform float uHeight;
  void main() {
    vM = vec2(uv.x * uWidth, uv.y * uHeight);
    vN = normalize(normalMatrix * normal);
    vec4 vp = modelViewMatrix * vec4(position, 1.0); vViewDir = normalize(-vp.xyz);
    gl_Position = projectionMatrix * vp;
    #include <logdepthbuf_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #define MAX_HITS ${MAX_HITS}
  uniform float uTime; uniform vec3 uColor; uniform float uLife; uniform float uOpacity; uniform float uFill;
  uniform float uHexScale, uEdgeWidth, uHexOpacity, uFresnelPower, uFresnelStrength, uFlashSpeed, uFlashIntensity;
  uniform float uWidth, uHeight, uPulse;
  uniform vec2 uHitPos[MAX_HITS]; uniform float uHitTime[MAX_HITS];
  uniform float uHitRingSpeed, uHitRingWidth, uHitMaxRadius, uHitDuration, uHitIntensity, uHitImpactRadius;
  varying vec2 vM; varying vec3 vViewDir; varying vec3 vN;
  vec3 lifeColor(float life) { return mix(vec3(1.0, 0.08, 0.04), uColor, life); }
  float hexPattern(vec2 p) {
    p *= uHexScale;
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1.)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    vec2 cell = (dot(h.xy, h.xy) < dot(h.zw, h.zw)) ? h.xy : h.zw;
    cell = abs(cell);
    float d = max(dot(cell, s * 0.5), cell.x);
    return smoothstep(0.5 - uEdgeWidth, 0.5, d);
  }
  vec2 hexCellId(vec2 p) {
    p *= uHexScale;
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1.)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return (dot(h.xy, h.xy) < dot(h.zw, h.zw)) ? hC.xy : hC.zw + 0.5;
  }
  float cellFlash(vec2 id) {
    float rnd = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
    return smoothstep(0.6, 1.0, sin(uTime * uFlashSpeed * (0.5 + rnd * 1.5) + rnd * 6.2831)) * uFlashIntensity;
  }
  void main() {
    #include <logdepthbuf_fragment>
    // seen edge-on the panel glows, like the bubble's rim
    float fresnel = pow(1.0 - abs(dot(normalize(vN), normalize(vViewDir))), uFresnelPower) * uFresnelStrength;
    float hex = hexPattern(vM);
    float flash = cellFlash(hexCellId(vM));
    // the rim: bright along the top edge and beside the posts, a slow pulse running along the fence
    float top = smoothstep(1.2, 0.0, uHeight - vM.y);
    float side = smoothstep(0.8, 0.0, min(vM.x, uWidth - vM.x));
    float pulse = 0.5 + 0.5 * sin(uTime * 1.3 - vM.x * 0.08) * uPulse;
    float rim = max(top, side) * (0.6 + 0.4 * pulse);
    // hits: flat rings spreading from the spot, and a brighter hex zone round it
    float ringContrib = 0.0, hexHitBoost = 0.0;
    for (int i = 0; i < MAX_HITS; i++) {
      float ht = uHitTime[i]; float elapsed = uTime - ht;
      float isActive = step(0.0, ht) * step(0.0, elapsed) * step(elapsed, uHitDuration);
      float dist = distance(vM, uHitPos[i]);
      float ringR = min(elapsed * uHitRingSpeed, uHitMaxRadius);
      float ring = smoothstep(uHitRingWidth, 0.0, abs(dist - ringR));
      float fade = 1.0 - smoothstep(uHitDuration * 0.5, uHitDuration, elapsed);
      float radialFade = 1.0 - smoothstep(uHitMaxRadius * 0.75, uHitMaxRadius, ringR);
      ringContrib += ring * fade * radialFade * isActive;
      hexHitBoost += smoothstep(uHitImpactRadius, 0.0, dist) * (1.0 - smoothstep(0.0, uHitDuration * 0.35, elapsed)) * isActive;
    }
    ringContrib = min(ringContrib, 2.0); hexHitBoost = min(hexHitBoost, 1.0);
    vec3 lColor = lifeColor(uLife);
    float effHex = uHexOpacity + hexHitBoost * uHitIntensity;
    float intensity = hex * effHex * (0.3 + fresnel * 0.7) + fresnel * 0.4 + flash + uFill * 0.8 + rim * 0.9;
    vec3 col = lColor * intensity * 2.0 + lColor * ringContrib * uHitIntensity;
    float alpha = clamp(intensity * uOpacity + ringContrib * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }`;

function panelUniforms(colour, width, height) {
  const hits = [], times = []; for (let i = 0; i < MAX_HITS; i++) { hits.push(new THREE.Vector2(0, 0)); times.push(-1e3); }
  return {
    uTime: { value: 0 }, uColor: { value: new THREE.Color(colour) }, uLife: { value: 1 }, uOpacity: { value: 1 }, uFill: { value: 0.045 },
    // Jacob's shield-lab values (2026-07-03); the hex scale is per metre here, so a cell is about a metre across
    uHexScale: { value: 1.6 }, uEdgeWidth: { value: 0.035 }, uHexOpacity: { value: 0.45 }, uFresnelPower: { value: 1.2 }, uFresnelStrength: { value: 0.4 },
    uFlashSpeed: { value: 0.95 }, uFlashIntensity: { value: 0.22 }, uWidth: { value: width }, uHeight: { value: height }, uPulse: { value: 1 },
    uHitPos: { value: hits }, uHitTime: { value: times },
    uHitRingSpeed: { value: 9 }, uHitRingWidth: { value: 0.7 }, uHitMaxRadius: { value: 7 }, uHitDuration: { value: 1.1 }, uHitIntensity: { value: 3.0 }, uHitImpactRadius: { value: 4 },
  };
}

// A fence round a polygon of corner points (Vector3s on the ground, in order): posts at the
// corners and every `postEvery` metres along each side, a panel between neighbouring posts.
export class ForceField {
  constructor({ corners, height = 12, postEvery = 40, colour = '#26aeff' } = {}) {
    this.group = new THREE.Group(); this.panels = []; this.posts = [];
    this.height = height; this.colour = colour; this.time = 0; this.hitCursor = 0;
    // the posts along the perimeter
    const pts = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length], len = a.distanceTo(b), n = Math.max(1, Math.round(len / postEvery));
      for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
    }
    const postGeo = new THREE.CylinderGeometry(0.6, 0.9, height + 2, 10), capGeo = new THREE.SphereGeometry(1.1, 12, 10);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.7, roughness: 0.4 });
    this.capMat = new THREE.MeshBasicMaterial({ color: colour });
    for (const p of pts) {
      const post = new THREE.Mesh(postGeo, postMat); post.position.copy(p); post.position.y += (height + 2) / 2; post.castShadow = true; this.group.add(post); this.posts.push(post);
      const cap = new THREE.Mesh(capGeo, this.capMat); cap.position.copy(p); cap.position.y += height + 2.4; this.group.add(cap);
    }
    // the panels
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], w = a.distanceTo(b);
      const geo = new THREE.PlaneGeometry(w, height, 1, 1);
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: panelUniforms(colour, w, height), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(a).lerp(b, 0.5); m.position.y += height / 2;
      m.lookAt(m.position.clone().add(new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x))));    // square to the side, facing outward
      m.userData = { a, b, w }; m.renderOrder = 4;
      this.group.add(m); this.panels.push(m);
    }
  }
  update(dt, life = 1) {
    this.time += dt;
    for (const p of this.panels) { p.material.uniforms.uTime.value = this.time; p.material.uniforms.uLife.value = life; }
    this.capMat.color.set(this.colour).lerp(new THREE.Color(0xff2020), 1 - life);
  }
  // a hit at a world point (in the group's frame): the nearest panel gets a ring there
  hit(point) {
    let best = null, bestD = Infinity;
    for (const p of this.panels) { const d = p.position.distanceTo(point); if (d < bestD) { bestD = d; best = p; } }
    if (!best) return;
    const { a, b, w } = best.userData, along = point.clone().sub(a).dot(b.clone().sub(a).normalize());
    const u = best.material.uniforms, i = this.hitCursor % MAX_HITS;
    u.uHitPos.value[i].set(THREE.MathUtils.clamp(along, 0, w), THREE.MathUtils.clamp(point.y - a.y, 0, this.height)); u.uHitTime.value[i] = this.time;
    this.hitCursor++;
  }
  // is a point (group frame) inside the fence? (a polygon test on the corner points is the
  // caller's business; this gives the nearest panel's distance for the bugs to push against)
  nearest(point) { let best = null, bestD = Infinity; for (const p of this.panels) { const d = p.position.distanceTo(point); if (d < bestD) { bestD = d; best = p; } } return { panel: best, d: bestD }; }
}
