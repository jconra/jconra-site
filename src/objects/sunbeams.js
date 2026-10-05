// SUNBEAMS. Shafts of light from a low sun through whatever stands against it (crepuscular rays, "god rays"), drawn
// on top of a finished frame so the page's own drawing is left alone. Call it right after renderer.render(scene,
// camera): the frame on screen is copied into a texture; a small picture is made of only what is bright AND near the
// sun's place on screen (the sky round a low sun: trees and hills seen against it are back-lit and dark, and those
// dark gaps are what make the shafts); that picture is smeared toward the sun's place (each pixel averages the line
// from itself toward the sun, nearer samples counting more, after GPU Gems 3, chapter 13); and the smear is
// added onto the screen. All of it works on the frame as shown (already tone-mapped and sRGB), so nothing is
// tone-mapped or encoded twice. The smear is two passes of SAMPLES taps, one fine and one coarse, which together
// give SAMPLES x SAMPLES taps along each shaft for the price of 2 x SAMPLES (each tap the same share nearer the sun
// than the one before, so the fine pass's steps fill the coarse pass's exactly).
// Cost: one full-screen copy, three small passes (a quarter of the screen across by default), one full-screen add;
// nothing at all when the strength is 0 or the sun is off screen or behind the camera. Works on WebGL1 (the copy
// of the screen resolves edge smoothing on both versions).
//   const beams = new Sunbeams(renderer);                     // once
//   renderer.render(scene, camera); beams.render(camera, SUN_DIR, { strength: 0.8, color: sunColour });   // every frame
import * as THREE from 'three';

const SAMPLES = 16;   // taps in each smear pass (16 x 16 = 256 along a shaft; 8 looked the same on cones against a dusk sky and saved ~7 us at 1080p: 16 is headroom for thin detail)
// `strength`: how much is added (0 off); `color`: what the shafts are tinted (a THREE.Color in the working space, or a
// hex / CSS string); `threshold` (0..1, of the shown frame's brightness): only what is brighter makes shafts, eased in
// over `knee` below it; `decay` (0..1): how much of a shaft is left at its far end; `length` (0..0.98): how far toward
// the sun each pixel looks, as a share of its distance to it (0.9: a bright patch throws a shaft 10x as far out as it
// is from the sun); `radius`: how far from the sun bright things still count, in screen heights (keeps a bright cloud
// across the sky from throwing its own shafts); `reach`: how far from the sun the shafts fade out, in screen heights
// (nothing is changed farther away); `edge`: how far inside the screen's edge the sun must be for the full effect, in
// screen heights (it eases out from there to nothing at the edge, see sunOnScreen); `blend`: 'screen' adds to each
// pixel only the share it has left below white, so the shafts show fully where the frame is dark (between trunks, on
// the ground) and the bright sky round the sun keeps its colour, where 'add' adds the lot and bleaches the sky near the
// sun toward white (a glare)
export const SUNBEAM_DEFAULTS = { strength: 1.5, color: 0xffffff, threshold: 0.55, knee: 0.2, decay: 0.6, length: 0.9, radius: 0.45, reach: 1.2, edge: 0.2, blend: 'screen' };

const VERT = `varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// BRIGHT: a 4x4 box of the screen (four filtered taps), kept by how far it is over the threshold (soft knee), times a
// falloff from the sun; the outer ring of texels kept black so taps past the edge (clamped to it) read nothing
const BRIGHT = `uniform sampler2D frame; uniform vec2 texel, ring, sun; uniform float aspect, threshold, knee, radius;
varying vec2 vUv;
void main() {
  vec3 c = 0.25 * (texture2D(frame, vUv - texel).rgb + texture2D(frame, vUv + texel).rgb
                 + texture2D(frame, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(frame, vUv + vec2(-texel.x, texel.y)).rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
  float keep = max(soft, l - threshold) / max(l, 1e-4);
  float near = 1.0 - smoothstep(0.0, radius, length((vUv - sun) * vec2(aspect, 1.0)));
  vec2 inside = step(ring, vUv) * step(vUv, 1.0 - ring);
  gl_FragColor = vec4(c * (keep * near * inside.x * inside.y), 1.0);
}`;
// SMEAR: SAMPLES taps on the line from this pixel to the sun, each at `shrink` times the last one's distance from the
// sun and `fall` times as heavy, normalised by the weights' sum (so the sample count never changes the brightness)
const SMEAR = `uniform sampler2D src; uniform vec2 sun; uniform float shrink, fall, norm;
varying vec2 vUv;
void main() {
  vec2 d = vUv - sun; vec3 sum = vec3(0.0); float s = 1.0, w = 1.0;
  for (int i = 0; i < SAMPLES; i++) { sum += texture2D(src, sun + d * s).rgb * w; s *= shrink; w *= fall; }
  gl_FragColor = vec4(sum * norm, 1.0);
}`;
// ADD: the shafts, tinted, onto the screen as it is (written straight: no tone mapping, no sRGB encoding), fading to
// nothing `reach` screen heights from the sun (the haze round a low sun is brightest next to it and falls away, as light
// scattered by haze mostly carries on forward); a dither of half a level where there is any shaft at all, so a faint
// smooth shaft doesn't band, and nothing where there is none
const ADD = `uniform sampler2D rays; uniform vec3 tint; uniform vec2 sun; uniform float aspect, reach;
varying vec2 vUv;
void main() {
  float t = 1.0 - min(1.0, length((vUv - sun) * vec2(aspect, 1.0)) / reach);
  vec3 r = texture2D(rays, vUv).rgb * tint * (t * t);
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  r += n / 255.0 * clamp(max(r.r, max(r.g, r.b)) * 255.0, 0.0, 1.0);
  gl_FragColor = vec4(max(r, 0.0), 1.0);
}`;

function pass(fragmentShader, uniforms, blend = false) {
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, defines: { SAMPLES } });
  m.depthTest = false; m.depthWrite = false; m.toneMapped = false;
  if (blend) {                                       // onto the colour, leaving the screen's alpha as it was
    m.transparent = true; m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
    m.blendSrc = blend === 'screen' ? THREE.OneMinusDstColorFactor : THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  }
  return m;
}
const ZERO = new THREE.Vector2();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Sunbeams {
  // `scale`: the small passes' size as a share of the drawing buffer across (0.25: a sixteenth of the pixels);
  // `defaults`: any of SUNBEAM_DEFAULTS, used where a render() call leaves one out
  constructor(renderer, { scale = 0.25, ...defaults } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.defaults = { ...SUNBEAM_DEFAULTS, ...defaults };
    this.fade = 0;                                   // how far in the effect was last frame (0 off .. 1 the sun well on screen), for a readout
    this.size = new THREE.Vector2();                 // the drawing buffer the textures were made for
    this.frame = null;                               // the copy of the screen (made at the first render, remade on a resize)
    const rt = () => { const t = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false }); t.texture.generateMipmaps = false; return t; };
    this.rtA = rt(); this.rtB = rt();
    this.uBright = { frame: { value: null }, texel: { value: new THREE.Vector2() }, ring: { value: new THREE.Vector2() }, sun: { value: new THREE.Vector2() },
                     aspect: { value: 1 }, threshold: { value: 0 }, knee: { value: 0 }, radius: { value: 1 } };
    this.uFine = { src: { value: this.rtA.texture }, sun: this.uBright.sun, shrink: { value: 1 }, fall: { value: 1 }, norm: { value: 1 } };
    this.uCoarse = { src: { value: this.rtB.texture }, sun: this.uBright.sun, shrink: { value: 1 }, fall: { value: 1 }, norm: { value: 1 } };
    this.uAdd = { rays: { value: this.rtA.texture }, tint: { value: new THREE.Vector3() }, sun: this.uBright.sun, aspect: this.uBright.aspect, reach: { value: 1 } };
    this.mBright = pass(BRIGHT, this.uBright); this.mFine = pass(SMEAR, this.uFine); this.mCoarse = pass(SMEAR, this.uCoarse);
    this.mAdd = pass(ADD, this.uAdd, 'add'); this.mScreen = pass(ADD, this.uAdd, 'screen');
    // one triangle over the whole screen (cheaper than two: no seam down the diagonal shaded twice)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g, this.mAdd); this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._v = new THREE.Vector3(); this._p = new THREE.Vector4(); this._vp = new THREE.Vector4(); this._css = new THREE.Vector2();
    this._c = new THREE.Color(); this._rgb = { r: 0, g: 0, b: 0 }; this._at = new THREE.Vector2();
  }

  setScale(scale) { this.scale = scale; this.size.set(0, 0); }   // (the textures are remade at the next render)

  // where the sun is on screen (uv, 0..1 across) and how far in the effect is: the screen holds only what is on it, so
  // as the sun's disc and its brightest glow slide past the edge, the shafts they throw would vanish within a frame or
  // two. So it eases out before then: 1 with the sun at least `edge` screen heights inside the nearest edge, down to 0
  // at the edge itself (and 0 off screen or behind the camera, where it costs nothing).
  sunOnScreen(camera, sunDir, edge, aspect) {
    const v = this._v.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    if (!camera.isPerspectiveCamera || v.z > -1e-4) return 0;
    const p = this._p.set(v.x, v.y, v.z, 0).applyMatrix4(camera.projectionMatrix);
    if (p.w <= 1e-6) return 0;
    const sx = p.x / p.w * 0.5 + 0.5, sy = p.y / p.w * 0.5 + 0.5;
    const inside = Math.min(Math.min(sx, 1 - sx) * aspect, Math.min(sy, 1 - sy));   // to the nearest edge, in screen heights
    if (inside <= 0) return 0;
    this.uBright.sun.value.set(sx, sy);
    return smooth(0, Math.max(1e-3, edge), inside);
  }

  // the textures sized to the drawing buffer (the copy of the screen can't be resized, so it's made again)
  fit(w, h) {
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    if (this.frame) this.frame.dispose();
    this.frame = new THREE.FramebufferTexture(w, h);
    this.frame.minFilter = THREE.LinearFilter; this.frame.magFilter = THREE.LinearFilter;   // (filtered: four taps make the 4x4 box)
    this.uBright.frame.value = this.frame;
    this.uBright.texel.value.set(1 / w, 1 / h);
    const sw = Math.max(1, Math.round(w * this.scale)), sh = Math.max(1, Math.round(h * this.scale));
    this.rtA.setSize(sw, sh); this.rtB.setSize(sw, sh);
    this.uBright.ring.value.set(1 / sw, 1 / sh);
  }

  // every frame, right after the scene is drawn to the screen. `sunDir`: toward the sun, in the world. Returns whether
  // it drew anything. Leaves the renderer as it found it (target with its cube face and mip level, viewport, scissor,
  // auto clear, clear colour, tone mapping).
  render(camera, sunDir, opts = {}) {
    const o = this.defaults, at = (k) => (opts[k] !== undefined ? opts[k] : o[k]);
    const strength = at('strength'), radius = at('radius');
    const r = this.renderer, size = r.getDrawingBufferSize(this._at), w = size.x, h = size.y;
    this.fade = strength > 0 && w > 0 && h > 0 ? this.sunOnScreen(camera, sunDir, at('edge'), w / h) : 0;
    if (this.fade <= 0) return false;
    this.fit(w, h);
    const B = this.uBright, length = Math.min(0.98, Math.max(0, at('length'))), decay = Math.min(1, Math.max(1e-3, at('decay')));
    B.aspect.value = w / h; B.threshold.value = at('threshold'); B.knee.value = Math.max(1e-3, at('knee')); B.radius.value = Math.max(1e-3, radius); this.uAdd.reach.value = Math.max(1e-3, at('reach'));   // (radius kept above 0: smoothstep with both edges at 0 is undefined in GLSL)
    // the taps: tap j of the SAMPLES x SAMPLES reach sits shrink^j of the way from the sun and weighs fall^j, the last
    // one (1 - length) and `decay`; the fine pass takes j = 0..SAMPLES-1, the coarse one every SAMPLES-th
    const last = SAMPLES * SAMPLES - 1, shrink = Math.pow(Math.max(1e-3, 1 - length), 1 / last), fall = Math.pow(decay, 1 / last);
    const sum = (f) => (Math.abs(1 - f) < 1e-6 ? SAMPLES : (1 - Math.pow(f, SAMPLES)) / (1 - f));
    this.uFine.shrink.value = shrink; this.uFine.fall.value = fall; this.uFine.norm.value = 1 / sum(fall);
    const shrinkN = Math.pow(shrink, SAMPLES), fallN = Math.pow(fall, SAMPLES);
    this.uCoarse.shrink.value = shrinkN; this.uCoarse.fall.value = fallN; this.uCoarse.norm.value = 1 / sum(fallN);
    // the tint: the shafts are added to sRGB values, so the colour goes in as sRGB too
    this._c.set(at('color')).getRGB(this._rgb, THREE.SRGBColorSpace);
    const k = strength * this.fade; this.uAdd.tint.value.set(this._rgb.r * k, this._rgb.g * k, this._rgb.b * k);

    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel(), autoClear = r.autoClear, scissor = r.getScissorTest(), autoReset = r.info.autoReset;
    r.getViewport(this._vp);
    r.autoClear = false; r.info.autoReset = false;    // (every pass writes every pixel, so nothing is cleared; and the page's draw counts aren't wiped)
    r.setRenderTarget(null);                         // the screen is what's read
    r.copyFramebufferToTexture(ZERO, this.frame);
    this.draw(this.mBright, this.rtA); this.draw(this.mFine, this.rtB); this.draw(this.mCoarse, this.rtA);
    r.setRenderTarget(null);
    r.setScissorTest(false); r.getSize(this._css); r.setViewport(0, 0, this._css.x, this._css.y);
    this.draw(at('blend') === 'screen' ? this.mScreen : this.mAdd, null);
    r.setViewport(this._vp); r.setScissorTest(scissor); r.setRenderTarget(target, face, mip);
    r.autoClear = autoClear; r.info.autoReset = autoReset;
    return true;
  }

  draw(material, target) {
    this.quad.material = material;
    if (target) this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    if (this.frame) this.frame.dispose();
    this.frame = null; this.size.set(0, 0);
    this.rtA.dispose(); this.rtB.dispose();
    for (const m of [this.mBright, this.mFine, this.mCoarse, this.mAdd, this.mScreen]) m.dispose();
    this.quad.geometry.dispose();
  }
}
