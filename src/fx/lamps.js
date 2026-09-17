// HULL LAMPS. Hundreds of small lights scattered over a model's surface, drawn as camera-facing
// billboards that are far brighter than white. Nothing here lights the hull: they are the visible
// bulbs, and bloom (or the built-in halo, where bloom is too expensive) turns them into glows.
//
// One instanced draw per part, parented to that part, so lamps on the ring turn with the ring.
// Works on WebGL1 (instancing is ANGLE_instanced_arrays there) and with a logarithmic depth buffer.
import * as THREE from 'three';

// Teal and amber carry the look; a little white, and a few red markers that blink.
const PALETTE = [
  { color: 0x2ee6d6, share: 0.52, blink: 0 },
  { color: 0xffa040, share: 0.34, blink: 0 },
  { color: 0xf4f7ff, share: 0.10, blink: 0 },
  { color: 0xff3030, share: 0.04, blink: 1 },
];

// The lamps sit on their own layer so a depth pass can leave them out: a bulb should blur with the
// hull it is mounted on, not stamp its own sharp depth into the depth of field.
export const LAMP_LAYER = 1;

const vertexShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iCenter;
  attribute vec3 iColor;
  attribute float iPhase;
  attribute float iBlink;
  uniform float uSize, uMinPx, uViewportH, uHalo, uTime, uIntensity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vGain;
  varying float vSpread;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
    vec4 clip = projectionMatrix * mv;
    // world size of one pixel at this depth
    float worldPerPx = clip.w * 2.0 / (projectionMatrix[1][1] * uViewportH);
    float px = uSize / worldPerPx;
    // never smaller than uMinPx on screen, or a kilometre-wide station shows no lamps at all
    float size = max(uSize, uMinPx * worldPerPx);
    float spread = 1.0 + 3.0 * uHalo;
    vUv = position.xy * spread;
    vSpread = spread;
    vColor = iColor;
    float blink = iBlink > 0.5 ? step(0.55, fract(uTime * 0.7 + iPhase)) : 1.0;
    // lamps held at the minimum size are far away: dim them so the distant hull does not fizz
    vGain = uIntensity * blink * clamp(px / uMinPx, 0.35, 1.0);
    clip.xy += position.xy * size * spread * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
    gl_Position = clip;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uHalo;
  varying vec2 vUv;
  varying float vSpread;
  varying vec3 vColor;
  varying float vGain;
  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vUv, vUv);
    float core = exp(-r2 * 4.0);
    float halo = uHalo * 0.22 * exp(-sqrt(r2) * 1.1);
    // fade to nothing before the edge of the quad, or bloom turns every lamp into a lit square
    float a = (core + halo) * smoothstep(vSpread, vSpread * 0.55, sqrt(r2));
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a * vGain, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Lamps {
  constructor() {
    this.uniforms = {
      uSize: { value: 1.2 },          // metres
      uMinPx: { value: 1.6 },
      uViewportH: { value: 1000 },
      uHalo: { value: 0 },
      uTime: { value: 0 },
      uIntensity: { value: 8 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.meshes = [];
  }

  // Scatter `count` lamps over the given meshes, in proportion to their surface area.
  build(meshes, count, seed = 11) {
    this.clear();
    let s = seed >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const colors = PALETTE.map(p => new THREE.Color(p.color));
    const pick = () => { let r = rand(); for (let i = 0; i < PALETTE.length; i++) { if ((r -= PALETTE[i].share) <= 0) return i; } return 0; };

    const surfaces = meshes.map(mesh => {
      const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
      const tris = idx ? idx.count / 3 : pos.count / 3;
      const cum = new Float64Array(tris); let total = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        total += b.sub(a).cross(c.sub(a)).length() / 2; cum[t] = total;
      }
      return { mesh, cum, total, idx, pos };
    });
    const grand = surfaces.reduce((n, x) => n + x.total, 0) || 1;
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);

    for (const sf of surfaces) {
      const n = Math.round(count * sf.total / grand);
      if (!n) continue;
      const center = new Float32Array(n * 3), color = new Float32Array(n * 3), phase = new Float32Array(n), blink = new Float32Array(n);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
      const size = new THREE.Vector3(); new THREE.Box3().setFromBufferAttribute(sf.pos).getSize(size);
      const lift = size.length() * 0.0015;                      // just proud of the surface
      for (let k = 0; k < n; k++) {
        const target = rand() * sf.total;
        let lo = 0, hi = sf.cum.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (sf.cum[mid] < target) lo = mid + 1; else hi = mid; }
        const t = lo, idx = sf.idx;
        a.fromBufferAttribute(sf.pos, idx ? idx.getX(t * 3) : t * 3);
        b.fromBufferAttribute(sf.pos, idx ? idx.getX(t * 3 + 1) : t * 3 + 1);
        c.fromBufferAttribute(sf.pos, idx ? idx.getX(t * 3 + 2) : t * 3 + 2);
        let u = rand(), v = rand(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
        nrm.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
        const p = a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v).addScaledVector(nrm, lift);
        p.toArray(center, k * 3);
        const pi = pick(); colors[pi].toArray(color, k * 3);
        blink[k] = PALETTE[pi].blink; phase[k] = rand();
      }
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
      geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
      geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phase, 1));
      geo.setAttribute('iBlink', new THREE.InstancedBufferAttribute(blink, 1));
      geo.instanceCount = n;
      const lamps = new THREE.Mesh(geo, this.material);
      lamps.frustumCulled = false;
      lamps.raycast = () => {};                                  // never in the way of picking the hull
      lamps.layers.set(LAMP_LAYER);
      lamps.renderOrder = 5;
      sf.mesh.add(lamps);
      this.meshes.push(lamps);
    }
    return this;
  }

  clear() {
    for (const m of this.meshes) { m.parent?.remove(m); m.geometry.dispose(); }
    this.meshes = [];
  }

  set visible(on) { for (const m of this.meshes) m.visible = on; }

  update(dt, viewportHeight) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uViewportH.value = viewportHeight;
  }
}
