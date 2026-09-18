// HOLOGRAM TEXT. Lines of extruded letters that draw in as a wireframe and then fill in as a
// projected hologram: cyan, see-through, scanlined, a little unsteady. One number, `fill`, runs
// the whole thing from nothing (0) to fully formed (1): the wire comes on over the first third,
// then the solid sweeps up from the bottom while the wire fades out behind it.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const FONT_URL = 'https://unpkg.com/three@0.158.0/examples/fonts/helvetiker_bold.typeface.json';
let fontPromise = null;
function loadFont() {
  if (!fontPromise) fontPromise = new Promise((res, rej) => new FontLoader().load(FONT_URL, res, undefined, rej));
  return fontPromise;
}

// The log-depth chunks matter: the labs render with a logarithmic depth buffer, and a shader that
// writes plain depth into it loses every depth test and never shows.
const VERT = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPos; varying vec3 vN; varying vec3 vV;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
// uSweep: how far up (in local metres) the visible part reaches. uMode 0 is the wire, 1 the solid.
const FRAG = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor; uniform float uSweep; uniform float uAlpha; uniform float uTime; uniform float uMode; uniform float uTop;
  varying vec3 vPos; varying vec3 vN; varying vec3 vV;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    if (vPos.y > uSweep) discard;
    float a = uAlpha;
    // scanlines drift upward, and the whole thing flickers a touch, as a projection would
    a *= 0.78 + 0.22 * sin(vPos.y * 420.0 - uTime * 9.0);
    a *= 0.92 + 0.08 * hash(floor(uTime * 24.0));
    vec3 c = uColor;
    if (uMode > 0.5) {
      // solid: brighter at glancing angles, like light caught in glass
      float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      a *= 0.55 + 0.45 * rim;
      c += rim * 0.25;
    }
    // a bright line where the sweep is, so the fill reads as something being drawn
    float edge = smoothstep(0.02, 0.0, uSweep - vPos.y) * step(uSweep, uTop - 0.001);
    c += edge * 1.2; a += edge * 0.6;
    gl_FragColor = vec4(c, a);
  }`;

export class Hologram extends THREE.Group {
  constructor({ lines = ['HELLO'], size = 0.09, depth = 0.012, gap = 1.35, color = 0x5ee0ff } = {}) {
    super();
    this.fill = 0;
    this.time = 0;
    this.height = 0;
    this.ready = loadFont().then(font => this.build(font, lines, size, depth, gap, color));
  }

  build(font, lines, size, depth, gap, color) {
    const mk = (mode) => new THREE.ShaderMaterial({
      // Normal blending, not additive: under flat light the cabin walls are bright, and an additive
      // glow adds up to white against white and disappears. Blended cyan reads on any wall.
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uSweep: { value: 0 }, uAlpha: { value: 0.6 },
                  uTime: { value: 0 }, uMode: { value: mode }, uTop: { value: 1 } },
    });
    this.wireMat = mk(0); this.solidMat = mk(1);
    // build from the bottom line up, each line centred, so the sweep runs up through the whole block.
    // A line is a string, or { text, size } for a line at its own size (a heading over small print).
    let y = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = typeof lines[i] === 'string' ? { text: lines[i] } : lines[i];
      const sz = line.size || size;
      if (line.text) {
        const geo = new TextGeometry(line.text, { font, size: sz, height: depth * (sz / size), curveSegments: 6, bevelEnabled: false });
        geo.computeBoundingBox();
        const b = geo.boundingBox;
        geo.translate(-(b.max.x + b.min.x) / 2, y - b.min.y, -depth / 2);
        const solid = new THREE.Mesh(geo, this.solidMat);
        const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), this.wireMat);
        this.add(solid, wire);
      }
      y += sz * gap;                                     // an empty line is a gap
    }
    this.height = y;
    this.wireMat.uniforms.uTop.value = this.solidMat.uniforms.uTop.value = y;
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    if (!this.wireMat) return;
    const f = THREE.MathUtils.clamp(this.fill, 0, 1), h = this.height;
    // the wire draws up over the first third; the solid sweeps up over the rest, and the wire goes
    // out as the solid arrives so the letters read as filling in rather than doubling up
    const wireUp = THREE.MathUtils.smoothstep(f, 0, 0.35), solidUp = THREE.MathUtils.smoothstep(f, 0.3, 1);
    this.wireMat.uniforms.uSweep.value = wireUp * h + (wireUp >= 1 ? 1 : 0);
    this.wireMat.uniforms.uAlpha.value = 0.9 * (1 - 0.85 * solidUp);
    this.solidMat.uniforms.uSweep.value = solidUp * h + (solidUp >= 1 ? 1 : 0);
    this.solidMat.uniforms.uAlpha.value = 0.8;
    this.wireMat.uniforms.uTime.value = this.solidMat.uniforms.uTime.value = this.time;
    this.visible = f > 0;
  }
}
