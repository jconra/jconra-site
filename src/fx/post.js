// CINEMATIC POST-PROCESSING. What a camera does to a picture and a renderer does not:
//   depth of field  - one distance sharp, the rest soft, from a depth pass of our own
//   lens flare      - starburst, streak, halo ring and ghosts from the sun, hidden when the hull covers it
//   bloom           - anything brighter than white spills into a glow (the lamps)
//   finish          - vignette, film grain and a little colour fringing at the edges
//
// The depth of field and flare use their own depth pass rather than BokehPass: the station renders
// with a logarithmic depth buffer (a kilometre-wide model and a camera metres off its hull), which the
// stock depth passes cannot read. This one stores log2 of the true distance in an 8-bit target, so it
// works the same on WebGL1 and WebGL2.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PACK = /* glsl */`
  vec4 packUnit(float v) {
    vec4 enc = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
    return enc - enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  }
  float unpackUnit(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
`;
const QUAD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Distance from the camera, as log2(d + 1) / log2(far + 1). Sky stays at the clear value, 1.
function depthMaterial(far) {
  return new THREE.ShaderMaterial({
    uniforms: { uFar: { value: far } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vDist;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uFar;
      varying float vDist;
      ${PACK}
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = packUnit(clamp(log2(vDist + 1.0) / log2(uFar + 1.0), 0.0, 0.9998));
      }`,
  });
}

const DOF = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uFar: { value: 1 }, uFocus: { value: 100 },
              uBlur: { value: 6 }, uMaxPx: { value: 14 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform float uFar, uFocus, uBlur, uMaxPx;
    uniform vec2 uRes;
    varying vec2 vUv;
    ${PACK}
    const int TAPS = 32;
    float dist(vec2 uv) {
      float v = unpackUnit(texture2D(tDepth, uv));
      return v > 0.9997 ? 1e9 : pow(2.0, v * log2(uFar + 1.0)) - 1.0;
    }
    // blur radius in pixels: zero at the focus distance, uBlur for the far background, growing
    // quickly (and capped) for anything nearer than the focus
    float coc(float d) { return clamp(uBlur * abs(1.0 - uFocus / d), 0.0, uMaxPx); }
    void main() {
      float d0 = dist(vUv);
      float c0 = coc(d0);
      // Bright lamps are many times white. Averaged as they are, one lamp behind the focus turns into a
      // spray of separate dots, one per tap; weighting each sample down by its brightness keeps the
      // blur smooth, and bloom puts the glow back afterwards.
      vec3 c0rgb = texture2D(tDiffuse, vUv).rgb;
      float w0 = 1.0 / (1.0 + dot(c0rgb, vec3(0.2126, 0.7152, 0.0722)));
      vec3 acc = c0rgb * w0;
      float wsum = w0;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / float(TAPS));
        float a = fi * 2.39996;
        // taps spread over this pixel's own blur circle, so a small blur gets all 32 of them rather
        // than the three or four that land inside it when they are spread over the largest one
        float rpx = r * max(c0, 1.0);
        vec2 suv = vUv + vec2(cos(a), sin(a)) * rpx / uRes;
        float ds = dist(suv);
        // a tap counts when it lies inside the blur circle: its own if it is in front (a blurred
        // foreground spills over what is behind it), otherwise ours (a sharp subject is not smeared
        // by the background around it)
        float reach = ds < d0 ? coc(ds) : min(coc(ds), c0);
        vec3 cs = texture2D(tDiffuse, suv).rgb;
        float w = smoothstep(rpx - 1.0, rpx + 1.0, reach) / (1.0 + dot(cs, vec3(0.2126, 0.7152, 0.0722)));
        acc += cs * w;
        wsum += w;
      }
      // undo the brightness weighting for the average, so a blurred lamp keeps its energy
      vec3 avg = acc / wsum;
      gl_FragColor = vec4(avg / max(1.0 - dot(avg, vec3(0.2126, 0.7152, 0.0722)), 0.05), 1.0);
    }`,
};

const FLARE = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
              uRes: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 }, uVis: { value: 0 },
              uStrength: { value: 1 }, uGhosts: { value: 1 }, uStreak: { value: 0.5 } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uSun, uRes;
    uniform float uAspect, uVis, uStrength, uGhosts, uStreak;
    varying vec2 vUv;
    ${PACK}
    float sky(vec2 uv) {
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
      return step(0.9997, unpackUnit(texture2D(tDepth, uv)));
    }
    vec3 ghost(vec2 c, float rad, vec3 col, float ring) {
      vec2 d = vUv - c; d.x *= uAspect;
      float l = length(d);
      float disc = smoothstep(rad, rad * 0.8, l);
      float edge = smoothstep(rad * 0.82, rad, l) * smoothstep(rad * 1.1, rad, l);
      return col * mix(disc * 0.35, edge, ring);
    }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // how much of the sun is uncovered: five depth samples around it
      vec2 o = vec2(5.0) / uRes;
      float open = 0.2 * (sky(uSun) + sky(uSun + vec2(o.x, 0.0)) + sky(uSun - vec2(o.x, 0.0)) + sky(uSun + vec2(0.0, o.y)) + sky(uSun - vec2(0.0, o.y)));
      float vis = uVis * open * uStrength;
      if (vis <= 0.001) { gl_FragColor = vec4(col, 1.0); return; }
      vec2 p = vUv - uSun; p.x *= uAspect;
      float r = length(p), ang = atan(p.y, p.x);
      vec3 sunCol = vec3(1.0, 0.95, 0.88);
      float core = exp(-r * r * 9000.0) * 30.0 + exp(-r * 30.0) * 0.6;
      // aperture spikes: four long, four shorter between them, and a fan of faint fine rays
      float spikes = (pow(abs(cos(ang * 2.0)), 600.0) + 0.6 * pow(abs(cos(ang * 2.0 + 0.785)), 600.0)) * exp(-r * 7.0) * 1.2;
      float rays = (0.5 + 0.5 * sin(ang * 41.0)) * (0.5 + 0.5 * sin(ang * 17.0 + 1.3)) * exp(-r * 20.0) * 0.35;
      float streak = exp(-abs(p.y) * 420.0) * exp(-abs(p.x) * 2.2) * uStreak;
      vec3 flare = sunCol * (core + spikes + rays) + vec3(0.55, 0.8, 1.0) * streak;
      // the halo ring, split slightly by colour like a real lens
      float ringR = 0.28;
      flare += vec3(exp(-abs(r - ringR) * 90.0), exp(-abs(r - ringR * 0.985) * 90.0), exp(-abs(r - ringR * 0.97) * 90.0)) * 0.12;
      // ghosts: reflections inside the lens, strung along the line from the sun through the centre
      vec2 axis = vec2(0.5) - uSun;
      vec3 g = ghost(uSun + axis * 0.55, 0.030, vec3(1.0, 0.55, 0.2), 0.0)
             + ghost(uSun + axis * 0.85, 0.018, vec3(0.3, 1.0, 0.6), 0.0)
             + ghost(uSun + axis * 1.25, 0.060, vec3(0.4, 0.6, 1.0), 1.0)
             + ghost(uSun + axis * 1.55, 0.012, vec3(1.0, 0.3, 0.3), 0.0)
             + ghost(uSun + axis * 1.95, 0.095, vec3(0.9, 0.7, 1.0), 1.0);
      flare += g * uGhosts * 0.35;
      gl_FragColor = vec4(col + flare * vis, 1.0);
    }`,
};

// Caps how far past white anything reaches before bloom. Without it, a lamp one pixel wide at 10x white
// (normal on WebGL1, which has no multisampling to spread it) shows the square edge of the blur kernel.
const CLAMP = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 3 } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float peak = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(peak > uMax ? c * (uMax / peak) : c, 1.0);
    }`,
};

const FINISH = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.5 }, uGrain: { value: 0.3 }, uFringe: { value: 0.3 },
              uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uGrain, uFringe, uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * uFringe * 0.012;                     // red and blue split apart toward the edges
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85))), uVignette);
      float n = fract(sin(dot(floor(vUv * uRes) + fract(uTime * 7.13) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain * 0.08;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { far, depthLayer = 0, sunDirection }) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.far = far; this.depthLayer = depthLayer; this.sunDirection = sunDirection;
    this.enabled = true;
    this.isWebGL2 = renderer.capabilities.isWebGL2;
    this.halfFloat = this.isWebGL2 || renderer.extensions.has('OES_texture_half_float');
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // HDR target, so the lamps can be many times brighter than white until bloom and tone mapping.
    // WebGL2 also gets 4x MSAA here; WebGL1 render targets cannot multisample at all.
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: this.isWebGL2 ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, this.target);
    this.depthTarget = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.depthMat = depthMaterial(far);

    this.renderPass = new RenderPass(scene, camera);
    this.dof = new ShaderPass(DOF);
    this.flare = new ShaderPass(FLARE);
    this.clamp = new ShaderPass(CLAMP);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.9, 0.55, 1.0);
    this.output = new OutputPass();
    this.finish = new ShaderPass(FINISH);
    for (const p of [this.renderPass, this.dof, this.flare, this.clamp, this.bloom, this.output, this.finish]) this.composer.addPass(p);
    this.dof.uniforms.uFar.value = far;
    this.focus = 100;
    this._sun = new THREE.Vector3(); this._fwd = new THREE.Vector3();
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.depthTarget.setSize(Math.round(w * pr), Math.round(h * pr));
    const res = new THREE.Vector2(w * pr, h * pr);
    for (const p of [this.dof, this.flare, this.finish]) p.uniforms.uRes.value.copy(res);
  }

  get info() {
    return `${this.isWebGL2 ? 'WebGL2' : 'WebGL1'} · ${this.halfFloat ? 'half-float HDR' : '8-bit (no HDR)'} · ${this.isWebGL2 ? '4× MSAA' : 'no MSAA in passes'}`;
  }

  captureDepth() {
    const { renderer, scene, camera } = this;
    const bg = scene.background, mask = camera.layers.mask, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    scene.background = null; scene.overrideMaterial = this.depthMat;
    camera.layers.set(this.depthLayer);
    renderer.setRenderTarget(this.depthTarget);
    renderer.setClearColor(0xffffff, 1); renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    camera.layers.mask = mask; scene.overrideMaterial = null; scene.background = bg;
  }

  render(dt) {
    if (!this.enabled) { this.renderer.render(this.scene, this.camera); return; }
    const needDepth = this.dof.enabled || this.flare.enabled;
    if (needDepth) {
      this.captureDepth();
      this.dof.uniforms.tDepth.value = this.depthTarget.texture;
      this.flare.uniforms.tDepth.value = this.depthTarget.texture;
    }
    this.dof.uniforms.uFocus.value = this.focus;
    if (this.flare.enabled) {
      // where the sun is on screen, and a fade as it leaves the frame or goes behind the camera
      const cam = this.camera;
      this._sun.copy(this.sunDirection).normalize();
      cam.getWorldDirection(this._fwd);
      const facing = this._sun.dot(this._fwd);
      this._sun.multiplyScalar(this.far * 0.5).add(cam.position).project(cam);
      const u = this._sun.x * 0.5 + 0.5, v = this._sun.y * 0.5 + 0.5;
      const outside = Math.max(0, Math.abs(this._sun.x) - 1, Math.abs(this._sun.y) - 1);
      this.flare.uniforms.uSun.value.set(u, v);
      this.flare.uniforms.uVis.value = facing > 0 ? Math.max(0, 1 - outside / 0.4) : 0;
      this.flare.uniforms.uAspect.value = cam.aspect;
    }
    this.finish.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
