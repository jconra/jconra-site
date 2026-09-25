// The level: splat-textured terrain, sky, lights, the cave, the exit portal, goal pads,
// the hex grid overlay and the path preview.
import * as THREE from 'three';
import { COLS, ROWS, HEX_R, PADS, START, EXIT, toWorld, hexCorners, GRID_BOUNDS } from './hex.js';
import { groundTextures, noise2, stoneTexture, rockTexture, glowTexture, textSprite } from './textures.js';

const SPLAT_SIZE = 48;   // world units covered by the splat map
const SPLAT_RES = 512;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const PAD_COLORS = [0xffd84a, 0xff8a3a, 0xff4a7a, 0xc05aff, 0x4a9dff, 0x3affc8];

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export class World {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.t = 0;
    const s = toWorld(START.c, START.r), e = toWorld(EXIT.c, EXIT.r);
    this.startW = s; this.exitW = e;
    this.caveMouth = { x: s.x - 2.6, z: s.z };
    this.portalPos = { x: e.x + 2.4, z: e.z };
    this.glowTex = glowTexture();
    this.stoneTex = stoneTexture();
    this.rockTex = rockTexture();

    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildGridLines();
    this.buildPads();
    this.buildCave();
    this.buildPortal();
    this.buildDecor();
    this.buildPathArrows();
  }

  heightAt(x, z) {
    const B = GRID_BOUNDS;
    const dx = Math.max(B.minX - x, 0, x - B.maxX);
    const dz = Math.max(B.minZ - z, 0, z - B.maxZ);
    let d = Math.hypot(dx, dz) - 0.6;
    // flat corridors out to the cave and the portal
    const c1 = segDist(x, z, this.startW.x, this.startW.z, this.caveMouth.x - 1.2, this.caveMouth.z);
    const c2 = segDist(x, z, this.exitW.x, this.exitW.z, this.portalPos.x + 0.6, this.portalPos.z);
    const corridor = Math.min(c1, c2);
    d *= smooth(0.9, 2.4, corridor);
    const n = noise2(x * 0.12 + 50, z * 0.12 + 50, 4, 3);
    const bumps = (noise2(x * 0.6, z * 0.6, 2, 8) - 0.5) * 0.06;
    if (d <= 0) return bumps;
    const ridge = 1 - Math.abs(noise2(x * 0.08, z * 0.08, 3, 5) * 2 - 1);
    return bumps + smooth(0, 6, d) * (1.1 + n * 3.5 + ridge * 2.2) + Math.max(0, d - 6) * 0.3;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: new THREE.Vector3(0.5, 0.55, -0.65).normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 zen = vec3(0.16,0.34,0.66), hor = vec3(0.70,0.82,0.92), gnd = vec3(0.45,0.52,0.5);
          vec3 c = h > 0. ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, min(1., -h*5.));
          float s = max(dot(normalize(vDir), sunDir), 0.);
          c += vec3(1.,0.85,0.6) * (pow(s, 600.)*3. + pow(s, 12.)*0.18);
          gl_FragColor = vec4(c,1.);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.fog = new THREE.Fog(0xa9c3d6, 40, 110);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.3);
    sun.position.set(14, 22, -12);
    sun.castShadow = true;
    const sz = this.opts.low ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    const c = sun.shadow.camera;
    c.left = -18; c.right = 18; c.top = 18; c.bottom = -18; c.near = 1; c.far = 70;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildTerrain() {
    const size = 110, seg = this.opts.low ? 140 : 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const L = groundTextures();
    this.splatCanvas = document.createElement('canvas');
    this.splatCanvas.width = this.splatCanvas.height = SPLAT_RES;
    this.splatTex = new THREE.CanvasTexture(this.splatCanvas);
    this.splatTex.wrapS = this.splatTex.wrapT = THREE.ClampToEdgeWrapping;
    this.splatTex.flipY = false;
    this.buildSplatBase();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const uniforms = {
      tSplat: { value: this.splatTex },
      tGrass: { value: L.grass }, tDirt: { value: L.dirt }, tRock: { value: L.rock }, tMeadow: { value: L.meadow },
      splatSize: { value: SPLAT_SIZE },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix*vec4(transformed,1.)).xyz;\nvWNorm = normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNorm;
          uniform sampler2D tSplat, tGrass, tDirt, tRock, tMeadow; uniform float splatSize;
          vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }`)
        .replace('#include <map_fragment>', `
          vec2 suv = vWPos.xz / splatSize + 0.5;
          vec4 sp = texture2D(tSplat, suv);
          vec2 tuv = vWPos.xz * 0.42;
          vec2 tuv2 = vec2(tuv.y, -tuv.x) * 0.61 + 0.37;
          vec4 cg = mix(texture2D(tGrass, tuv), texture2D(tGrass, tuv2), 0.35);
          vec4 cd = texture2D(tDirt, tuv * 0.9);
          vec4 cr = texture2D(tRock, tuv * 0.8);
          vec4 cm = texture2D(tMeadow, tuv * 0.8);
          float slope = 1. - vWNorm.y;
          float wr = clamp(max(sp.g, smoothstep(0.2, 0.42, slope) + smoothstep(4.5, 9.0, vWPos.y)*0.5), 0., 1.);
          float wd = sp.r * (1. - wr);
          float wm = sp.b * (1. - wr) * (1. - wd);
          float wg = max(0., 1. - wr - wd - wm);
          // height-blend so layers break up along their texture detail
          float hg = wg + cg.a*0.5, hd = wd + cd.a*0.5, hr = wr + cr.a*0.5, hm = wm + cm.a*0.5;
          float ma = max(max(hg, hd), max(hr, hm)) - 0.18;
          float bg = max(hg - ma, 0.), bd = max(hd - ma, 0.), br = max(hr - ma, 0.), bm = max(hm - ma, 0.);
          vec3 col = (cg.rgb*bg + cd.rgb*bd + cr.rgb*br + cm.rgb*bm) / (bg+bd+br+bm+1e-4);
          col *= 0.78 + sp.a * 0.44;
          diffuseColor.rgb *= toLin(col);
        `);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  // Noise layers that never change: meadow patches, rock outcrops, macro brightness, the
  // corridors to the cave and portal. Path wear is stamped on top by setPath.
  buildSplatBase() {
    const N = SPLAT_RES;
    this.splatBase = new Float32Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = (x / N - 0.5) * SPLAT_SIZE, wz = (y / N - 0.5) * SPLAT_SIZE;
      const o = (y * N + x) * 4;
      const n1 = noise2(wx * 0.18, wz * 0.18, 3, 11);
      const n2 = noise2(wx * 0.3 + 9, wz * 0.3, 3, 21);
      const c1 = segDist(wx, wz, this.startW.x, this.startW.z, this.caveMouth.x - 1.5, this.caveMouth.z);
      const c2 = segDist(wx, wz, this.exitW.x, this.exitW.z, this.portalPos.x + 1, this.portalPos.z);
      const corridor = 1 - smooth(0.35, 1.1, Math.min(c1, c2));
      this.splatBase[o] = Math.max(smooth(0.7, 0.85, n1) * 0.45, corridor);
      this.splatBase[o + 1] = smooth(0.7, 0.8, n2) * 0.8;
      this.splatBase[o + 2] = smooth(0.52, 0.66, noise2(wx * 0.22, wz * 0.22 + 40, 3, 31));
      this.splatBase[o + 3] = noise2(wx * 0.07, wz * 0.07, 4, 41);
    }
    this.paintSplat(null);
  }

  paintSplat(mask) {
    const N = SPLAT_RES;
    const ctx = this.splatCanvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    const d = img.data, b = this.splatBase;
    for (let i = 0; i < N * N; i++) {
      const m = mask ? mask[i] / 255 : 0;
      const o = i * 4;
      d[o] = 255 * Math.max(b[o], m);
      d[o + 1] = 255 * b[o + 1] * (1 - m);
      d[o + 2] = 255 * b[o + 2] * (1 - m);
      d[o + 3] = 255 * b[o + 3];
    }
    ctx.putImageData(img, 0, 0);
    this.splatTex.needsUpdate = true;
  }

  // Wear a dirt trail into the grass along the current ground route.
  setPath(cells) {
    const N = SPLAT_RES;
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCanvas.width = this.maskCanvas.height = N;
    }
    const ctx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    const px = (w) => (w / SPLAT_SIZE + 0.5) * N;
    const pts = cells.map(c => toWorld(c.c, c.r));
    ctx.lineCap = ctx.lineJoin = 'round';
    // soft edge by stacking strokes from wide/faint to narrow/solid
    for (const [w, a] of [[1.25, 0.18], [0.95, 0.3], [0.7, 0.55], [0.45, 1]]) {
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = w * N / SPLAT_SIZE;
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z)));
      ctx.stroke();
    }
    const src = ctx.getImageData(0, 0, N, N).data;
    const mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) mask[i] = src[i * 4];
    this.paintSplat(mask);

    // path arrows
    this.pathPts = pts;
    this.layoutArrows();
  }

  buildGridLines() {
    const verts = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const w = toWorld(c, r);
      const cs = hexCorners(w.x, w.z, HEX_R * 0.97);
      for (let i = 0; i < 6; i++) {
        const a = cs[i], b = cs[(i + 1) % 6];
        verts.push(a[0], 0.03, a[1], b[0], 0.03, b[1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    this.grid = new THREE.LineSegments(geo, this.gridMat);
    this.grid.renderOrder = 1;
    this.scene.add(this.grid);
  }

  buildPads() {
    this.pads = [];
    const baseGeo = new THREE.CylinderGeometry(HEX_R * 0.98, HEX_R * 1.02, 0.14, 6);
    const baseMat = new THREE.MeshStandardMaterial({ map: this.stoneTex, roughness: 0.8, color: 0xb8b0a4 });
    const ringGeo = new THREE.RingGeometry(HEX_R * 0.62, HEX_R * 0.78, 6);
    ringGeo.rotateX(-Math.PI / 2);
    const runeTex = this.runeTexture();
    PADS.forEach((p, i) => {
      const w = toWorld(p.c, p.r);
      const g = new THREE.Group();
      g.position.set(w.x, 0, w.z);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.05;
      base.receiveShadow = true; base.castShadow = true;
      g.add(base);
      const col = new THREE.Color(PAD_COLORS[i]);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.y = 0.125;
      g.add(ring);
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95),
        new THREE.MeshBasicMaterial({ map: runeTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      rune.rotation.x = -Math.PI / 2;
      rune.position.y = 0.13;
      g.add(rune);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
      glow.scale.set(1.3, 1.3, 1); glow.position.y = 0.3;
      g.add(glow);
      const num = textSprite(String(i + 1), '#' + col.getHexString(), 72);
      num.scale.multiplyScalar(0.45);
      num.position.y = 0.75;
      g.add(num);
      this.scene.add(g);
      this.pads.push({ g, ring, rune, num, glow });
    });
  }

  runeTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.translate(64, 64);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 13px serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';
    for (let i = 0; i < 12; i++) {
      ctx.save(); ctx.rotate(i / 12 * Math.PI * 2); ctx.fillText(glyphs[i], 0, -41); ctx.restore();
    }
    const t = new THREE.CanvasTexture(cv);
    return t;
  }

  buildCave() {
    const m = this.caveMouth;
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    const rockMat = new THREE.MeshStandardMaterial({ map: this.rockTex, roughness: 0.95, color: 0x9a948c, flatShading: true });
    // the hill the cave is dug into
    const hill = new THREE.Mesh(this.lumpGeo(3.2, 3, 7), rockMat);
    hill.scale.set(1.1, 0.95, 1.4);
    hill.position.set(-3.4, -0.4, 0);
    hill.castShadow = hill.receiveShadow = true;
    g.add(hill);
    // arch of boulders around the mouth
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      const b = new THREE.Mesh(this.lumpGeo(0.42 + (i % 3) * 0.08, 1, 20 + i), rockMat);
      b.position.set(-0.2 + Math.sin(a) * 0.15, Math.sin(a) * 1.55, Math.cos(a) * 1.15);
      b.rotation.set(i, i * 2, i * 3);
      b.castShadow = true;
      g.add(b);
    }
    // darkness inside
    const dark = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x050403, fog: false }));
    dark.rotation.y = -Math.PI / 2;
    dark.rotation.z = Math.PI / 2;
    dark.position.set(-0.55, 0, 0);
    dark.scale.set(1, 1.35, 1);
    g.add(dark);
    // eerie glow
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff6a2a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    glow.scale.set(2.2, 2.2, 1); glow.position.set(-0.3, 0.7, 0);
    g.add(glow);
    this.caveGlow = glow;
    const torchL = this.torch(); torchL.position.set(0.1, 0, 1.55); g.add(torchL);
    const torchR = this.torch(); torchR.position.set(0.1, 0, -1.55); g.add(torchR);
    this.scene.add(g);
    this.cave = g;
  }

  torch() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 1 }));
    pole.position.y = 0.55; pole.castShadow = true;
    g.add(pole);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff9a3a, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.scale.set(0.6, 0.8, 1); fl.position.y = 1.2;
    g.add(fl);
    (this.flames ||= []).push(fl);
    return g;
  }

  lumpGeo(r, detail, seed) {
    const geo = new THREE.IcosahedronGeometry(r, detail);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = noise2(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7, 3, seed);
      v.multiplyScalar(0.75 + n * 0.5);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  buildPortal() {
    const p = this.portalPos;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const stoneMat = new THREE.MeshStandardMaterial({ map: this.stoneTex, roughness: 0.7, color: 0x8e8aa0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.18, 10, 6), stoneMat);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = 0;
    ring.position.y = 1.1;
    ring.castShadow = true;
    g.add(ring);
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), stoneMat);
      pil.position.set(0, 0.25, s * 0.95);
      pil.castShadow = true;
      g.add(pil);
    }
    this.portalMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { t: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float t;
        void main(){
          vec2 p = vUv*2.-1.; float r = length(p); float a = atan(p.y,p.x);
          float sw = sin(a*3. + r*10. - t*4.)*0.5+0.5;
          float edge = smoothstep(1., 0.7, r);
          vec3 c = mix(vec3(0.3,0.1,0.9), vec3(0.2,0.9,1.), sw) * (0.4 + sw*0.8);
          c += vec3(1.) * smoothstep(0.35, 0., r) * 0.6;
          gl_FragColor = vec4(c * edge, edge);
        }`,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), this.portalMat);
    disc.rotation.y = Math.PI / 2;
    disc.position.y = 1.1;
    g.add(disc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x6a8aff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    glow.scale.set(3.4, 3.4, 1); glow.position.y = 1.1;
    g.add(glow);
    this.scene.add(g);
    this.portal = g;
  }

  buildDecor() {
    // pine trees and boulders on the hills around the board
    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 6);
    trunkGeo.translate(0, 0.3, 0);
    const leafGeo = new THREE.ConeGeometry(0.55, 1.1, 7);
    const leaf2 = new THREE.ConeGeometry(0.42, 0.9, 7);
    const leaf3 = new THREE.ConeGeometry(0.28, 0.7, 7);
    leafGeo.translate(0, 0.9, 0); leaf2.translate(0, 1.35, 0); leaf3.translate(0, 1.75, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6a36, roughness: 0.9, flatShading: true });
    const N = this.opts.low ? 160 : 320;
    const meshes = [trunkGeo, leafGeo, leaf2, leaf3].map((geo, i) => {
      const m = new THREE.InstancedMesh(geo, i ? leafMat : trunkMat, N);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    });
    const rockGeo = this.lumpGeo(0.5, 1, 3);
    const rockMat = new THREE.MeshStandardMaterial({ map: this.rockTex, roughness: 0.95, color: 0xa29a90, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 90);
    rocks.castShadow = rocks.receiveShadow = true;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0, nr = 0, tries = 0;
    const B = GRID_BOUNDS;
    while ((n < N || nr < 90) && tries++ < 20000) {
      const x = (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 62;
      const out = Math.max(B.minX - x, 0, x - B.maxX, B.minZ - z, 0, z - B.maxZ);
      if (out < 1.2) continue;
      if (Math.hypot(x - this.caveMouth.x, z - this.caveMouth.z) < 5.5) continue;
      if (Math.hypot(x - this.portalPos.x, z - this.portalPos.z) < 3) continue;
      const y = this.heightAt(x, z);
      if (n < N && noise2(x * 0.15, z * 0.15, 2, 99) > 0.42) {
        const s = 0.7 + Math.random() * 0.9;
        q.setFromAxisAngle(pos.set(0, 1, 0), Math.random() * 6.28);
        M.compose(pos.set(x, y - 0.05, z), q, sc.set(s, s * (0.9 + Math.random() * 0.4), s));
        col.setHSL(0.3 + Math.random() * 0.06, 0.45, 0.25 + Math.random() * 0.12);
        meshes.forEach((m, i) => { m.setMatrixAt(n, M); if (i) m.setColorAt(n, col); });
        n++;
      } else if (nr < 90 && out < 8) {
        const s = 0.4 + Math.random() * 1.1;
        q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
        M.compose(pos.set(x, y, z), q, sc.set(s, s * 0.7, s));
        rocks.setMatrixAt(nr++, M);
      }
    }
    meshes.forEach(m => { m.count = n; this.scene.add(m); });
    rocks.count = nr;
    this.scene.add(rocks);
  }

  buildPathArrows() {
    const shape = new THREE.Shape();
    shape.moveTo(0.16, 0); shape.lineTo(-0.1, 0.13); shape.lineTo(-0.04, 0); shape.lineTo(-0.1, -0.13); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arrows = new THREE.InstancedMesh(geo, this.arrowMat, 900);
    this.arrows.count = 0;
    this.arrows.renderOrder = 2;
    this.arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(900 * 3), 3);
    this.scene.add(this.arrows);
    this.arrowPhase = 0;
    // flying route: a dashed arc line through the pads
    const pts = [START, ...PADS, EXIT].map(p => { const w = toWorld(p.c, p.r); return new THREE.Vector3(w.x, 1.6, w.z); });
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    this.flyLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xd8b0ff, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.5 }));
    this.flyLine.computeLineDistances();
    this.scene.add(this.flyLine);
  }

  layoutArrows() {
    const pts = this.pathPts;
    if (!pts) return;
    // sample along the polyline every 0.5 units
    const samples = [];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
      for (let d = carry; d < len; d += 0.5) {
        samples.push({ x: a.x + (b.x - a.x) * d / len, z: a.z + (b.z - a.z) * d / len, ang });
      }
      carry = (carry - len) % 0.5;
      if (carry < 0) carry += 0.5;
    }
    this.arrowSamples = samples;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const n = Math.min(samples.length, 900);
    for (let i = 0; i < n; i++) {
      q.setFromAxisAngle(up, samples[i].ang);
      M.compose(p.set(samples[i].x, 0.05, samples[i].z), q, sc);
      this.arrows.setMatrixAt(i, M);
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  setBuildMode(on) { this.buildMode = on; }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const target = this.buildMode ? 1 : 0;
    this.gridVis = (this.gridVis ?? 1) + (target - (this.gridVis ?? 1)) * Math.min(1, dt * 4);
    this.gridMat.opacity = 0.05 + 0.13 * this.gridVis;
    this.flyLine.material.opacity = 0.5 * this.gridVis;
    this.flyLine.visible = this.gridVis > 0.02;
    this.pads.forEach((p, i) => {
      p.rune.rotation.z = t * 0.4 * (i % 2 ? 1 : -1);
      p.glow.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.15;
      p.num.position.y = 0.75 + Math.sin(t * 1.5 + i) * 0.06;
    });
    this.portalMat.uniforms.t.value = t;
    if (this.flames) this.flames.forEach((f, i) => { const k = 0.8 + Math.sin(t * 13 + i * 3) * 0.1 + Math.sin(t * 29 + i) * 0.08; f.scale.set(0.6 * k, 0.85 * k, 1); });
    this.caveGlow.material.opacity = 0.28 + Math.sin(t * 1.3) * 0.08;
    // marching arrows along the route
    if (this.arrowSamples) {
      const S = this.arrowSamples;
      const c = new THREE.Color();
      const n = Math.min(S.length, 900);
      const vis = this.gridVis;
      for (let i = 0; i < n; i++) {
        const wave = Math.pow(0.5 + 0.5 * Math.sin(i * 0.35 - t * 5), 3);
        c.setRGB(1, 0.9, 0.5).multiplyScalar((0.15 + wave * 0.85) * vis);
        this.arrows.setColorAt(i, c);
      }
      this.arrows.instanceColor.needsUpdate = true;
      this.arrows.visible = vis > 0.02;
    }
  }
}
