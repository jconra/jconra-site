// Visual effects: a pooled particle system, expanding ground waves, beams and lightning,
// projectiles with trails, and floating combat text.
import * as THREE from 'three';
import { textSprite } from './textures.js';

const MAXP = 5000;

export class FX {
  constructor(scene, glowTex, camera) {
    this.scene = scene;
    this.camera = camera;
    this.glowTex = glowTex;
    this.low = false;
    // particles
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAXP * 3);
    this.pCol = new Float32Array(MAXP * 3);
    this.pSize = new Float32Array(MAXP);
    this.pAlpha = new Float32Array(MAXP);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: glowTex }, scale: { value: 400 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*scale/-mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC*t.rgb*vA, t.a*vA); }`,
    });
    this.pMat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < MAXP; i++) this.parts.push({ life: 0 });
    this.pNext = 0;

    // waves / rings
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, 40);
    this.discGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    // beams (unit cylinder along +Y, re-oriented per use)
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.beams = [];
    this.projectiles = [];
    this.texts = [];
    this.tmp = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  setViewportHeight(h) { this.pMat.uniforms.scale.value = h * 0.9; }

  emit(x, y, z, o = {}) {
    const n = this.low ? Math.ceil((o.count || 1) / 2) : (o.count || 1);
    const col = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      const p = this.parts[this.pNext];
      this.pNext = (this.pNext + 1) % MAXP;
      const sp = o.speed ?? 1;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
      p.x = x + (Math.random() - 0.5) * (o.spread ?? 0);
      p.y = y + (Math.random() - 0.5) * (o.spread ?? 0) * 0.5;
      p.z = z + (Math.random() - 0.5) * (o.spread ?? 0);
      p.vx = Math.cos(a) * Math.cos(e) * sp * Math.random() + (o.vx || 0);
      p.vy = Math.abs(Math.sin(e)) * sp * Math.random() * (o.upward ?? 1) + (o.vy || 0);
      p.vz = Math.sin(a) * Math.cos(e) * sp * Math.random() + (o.vz || 0);
      p.g = o.gravity ?? 0;
      p.drag = o.drag ?? 1.5;
      p.life = p.max = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      p.size = (o.size ?? 0.2) * (0.7 + Math.random() * 0.6);
      p.grow = o.grow ?? -0.5;
      p.r = col.r; p.gc = col.g; p.b = col.b;
    }
  }

  // An expanding ring on the ground: the "emanating wave" for auras, novas and splashes.
  wave(x, z, radius, color, o = {}) {
    let r = this.rings.find(r => !r.active);
    if (!r) {
      if (this.rings.length > 160) return;
      const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      r = { mesh };
      this.rings.push(r);
    }
    r.active = true;
    r.mesh.visible = true;
    r.mesh.geometry = o.disc ? this.discGeo : this.ringGeo;
    r.mesh.material.color.set(color);
    r.mesh.position.set(x, o.y ?? 0.08, z);
    r.from = o.from ?? 0.1;
    r.to = radius;
    r.t = 0;
    r.dur = o.dur ?? 0.6;
    r.alpha = o.alpha ?? 0.85;
    r.mesh.scale.setScalar(r.from);
  }

  beam(a, b, color, o = {}) {
    let bm = this.beams.find(x => !x.active);
    if (!bm) {
      if (this.beams.length > 300) return;
      const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      bm = { mesh };
      this.beams.push(bm);
    }
    bm.active = true;
    const m = bm.mesh;
    m.visible = true;
    m.material.color.set(color);
    m.material.opacity = 1;
    const d = this.tmp.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = d.length();
    m.position.set(a.x, a.y, a.z);
    m.quaternion.setFromUnitVectors(this.up, d.normalize());
    bm.w = o.width ?? 0.04;
    m.scale.set(bm.w, len, bm.w);
    bm.t = 0;
    bm.dur = o.dur ?? 0.15;
  }

  lightning(a, b, color, o = {}) {
    const segs = o.segs ?? 6;
    let prev = a;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const j = i === segs ? 0 : (o.jag ?? 0.18);
      const p = { x: a.x + (b.x - a.x) * f + (Math.random() - 0.5) * j, y: a.y + (b.y - a.y) * f + (Math.random() - 0.5) * j, z: a.z + (b.z - a.z) * f + (Math.random() - 0.5) * j };
      this.beam(prev, p, color, { width: o.width ?? 0.025, dur: o.dur ?? 0.12 });
      prev = p;
    }
  }

  // A glowing bolt that flies to a moving target; onHit fires when it arrives.
  projectile(from, getTarget, o) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: o.color, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sz = o.size ?? 0.3;
    s.scale.set(sz, sz, 1);
    s.position.set(from.x, from.y, from.z);
    s.renderOrder = 7;
    this.scene.add(s);
    this.projectiles.push({ s, getTarget, speed: o.speed ?? 12, onHit: o.onHit, color: new THREE.Color(o.color), trail: o.trail ?? 1, arc: o.arc ?? 0, t: 0, from: { ...from }, last: null, kind: o.kind });
  }

  text(x, y, z, str, color = '#fff', size = 0.45) {
    const s = textSprite(str, color, 48);
    s.scale.multiplyScalar(size);
    s.position.set(x, y, z);
    s.renderOrder = 12;
    s.material.depthTest = false;
    this.scene.add(s);
    this.texts.push({ s, t: 0, dur: 0.9 });
  }

  clear() {
    this.projectiles.forEach(p => { this.scene.remove(p.s); p.s.material.dispose(); });
    this.projectiles = [];
  }

  update(dt) {
    // particles
    const P = this.parts;
    let n = 0;
    for (let i = 0; i < MAXP; i++) {
      const p = P[i];
      if (p.life <= 0) { this.pAlpha[i] = 0; this.pSize[i] = 0; continue; }
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = Math.max(0, p.life / p.max);
      this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.y; this.pPos[i * 3 + 2] = p.z;
      this.pCol[i * 3] = p.r; this.pCol[i * 3 + 1] = p.gc; this.pCol[i * 3 + 2] = p.b;
      this.pSize[i] = Math.max(0, p.size * (1 + p.grow * (1 - f)));
      this.pAlpha[i] = Math.min(1, f * 2);
      n++;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const f = r.t / r.dur;
      if (f >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 2);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      r.mesh.material.opacity = r.alpha * (1 - f);
    }
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const f = b.t / b.dur;
      if (f >= 1) { b.active = false; b.mesh.visible = false; continue; }
      b.mesh.material.opacity = 1 - f;
      b.mesh.scale.x = b.mesh.scale.z = b.w * (1 - f * 0.6);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const tgt = p.getTarget();
      if (tgt) p.last = tgt;
      const to = p.last;
      if (!to) { this.scene.remove(p.s); p.s.material.dispose(); this.projectiles.splice(i, 1); continue; }
      const s = p.s.position;
      const dx = to.x - s.x, dy = to.y - s.y, dz = to.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;
      p.t += dt;
      if (d <= step || p.t > 3) {
        this.scene.remove(p.s); p.s.material.dispose();
        this.projectiles.splice(i, 1);
        p.onHit && p.onHit(!!tgt, to);
        continue;
      }
      s.x += dx / d * step; s.y += dy / d * step + (p.arc ? Math.sin(Math.min(1, p.t * 3) * Math.PI) * p.arc * dt : 0); s.z += dz / d * step;
      if (p.trail && Math.random() < p.trail) this.emit(s.x, s.y, s.z, { color: p.color, size: 0.15, life: 0.3, speed: 0.2, count: 1 });
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.s.position.y += dt * 0.8;
      t.s.material.opacity = 1 - Math.pow(t.t / t.dur, 3);
      if (t.t >= t.dur) { this.scene.remove(t.s); t.s.material.map.dispose(); t.s.material.dispose(); this.texts.splice(i, 1); }
    }
  }
}
