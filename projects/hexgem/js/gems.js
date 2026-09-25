// Gem, special-gem and rock models. Every quality has its own cut; every special has its
// own sculpture and idle animation.
import * as THREE from 'three';
import { GEM_TYPES, SPECIALS } from './data.js';
import { HEX_R } from './hex.js';
import { noise2, bandTexture } from './textures.js';

const TAU = Math.PI * 2;

const flat = (g) => (g.index ? g.toNonIndexed() : g);

function jitter(geo, amt, seed) {
  geo = flat(geo);
  const p = geo.attributes.position;
  // move shared corners together so the chunk stays closed
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3);
    if (!moved.has(k)) moved.set(k, [(Math.sin(i * 12.9 + seed) * 43758.5 % 1) * amt, (Math.sin(i * 78.2 + seed) * 12345.6 % 1) * amt, (Math.sin(i * 39.4 + seed) * 5432.1 % 1) * amt]);
    const d = moved.get(k);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function lathe(points, segs) {
  const g = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
  return flat(g);
}

// One geometry per quality: chipped chunk, octahedron, brilliant, prism crystal, cluster.
function qualityGeos() {
  const out = [];
  out[0] = [jitter(new THREE.IcosahedronGeometry(0.17, 0), 0.05, 1)];
  const oct = new THREE.OctahedronGeometry(0.2, 0); oct.scale(1, 1.35, 1);
  out[1] = [flat(oct)];
  out[2] = [lathe([[0, -0.24], [0.25, 0.02], [0.2, 0.1], [0.12, 0.13], [0, 0.13]], 8)];
  const prism = lathe([[0, -0.36], [0.13, -0.2], [0.13, 0.18], [0, 0.38]], 6);
  const side = lathe([[0, -0.18], [0.07, -0.1], [0.07, 0.09], [0, 0.2]], 6);
  out[3] = [prism, side];
  const tall = lathe([[0, -0.3], [0.13, -0.2], [0.13, 0.26], [0, 0.48]], 6);
  const small = lathe([[0, -0.2], [0.08, -0.12], [0.08, 0.14], [0, 0.28]], 6);
  out[4] = [tall, small];
  out.forEach(a => a.forEach(g => g.computeVertexNormals()));
  return out;
}

export class GemArt {
  constructor(glowTex, stoneTex, rockTex) {
    this.glowTex = glowTex;
    this.qGeo = qualityGeos();
    this.mats = {};
    this.pedGeo = new THREE.CylinderGeometry(HEX_R * 0.78, HEX_R * 0.9, 0.16, 6);
    this.pedGeo.translate(0, 0.08, 0);
    this.pedTop = new THREE.CylinderGeometry(HEX_R * 0.5, HEX_R * 0.66, 0.07, 6);
    this.pedTop.translate(0, 0.195, 0);
    this.pedMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x8c857c, roughness: 0.8 });
    this.pedTrim = new THREE.MeshStandardMaterial({ color: 0x9c8455, roughness: 0.35, metalness: 0.8 });
    this.rockMat = new THREE.MeshStandardMaterial({ map: rockTex, color: 0xb0a89c, roughness: 0.95, flatShading: true });
    this.rockGeos = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(0.42, 1);
      const p = g.attributes.position, v = new THREE.Vector3();
      for (let j = 0; j < p.count; j++) {
        v.fromBufferAttribute(p, j);
        v.multiplyScalar(0.7 + noise2(v.x * 3 + i * 7, v.y * 3 + v.z * 2, 2, i) * 0.6);
        p.setXYZ(j, v.x, Math.max(v.y, -0.05), v.z);
      }
      g.computeVertexNormals();
      this.rockGeos.push(g);
    }
    this.bandTex = bandTexture();
  }

  gemMat(hex, opts = {}) {
    const k = hex + JSON.stringify({ ...opts, map: opts.map ? opts.map.uuid : null });
    if (this.mats[k]) return this.mats[k];
    const c = new THREE.Color(hex);
    const m = new THREE.MeshStandardMaterial({
      // higher metalness tints the reflections with the gem's own colour instead of white
      color: c, emissive: c.clone().multiplyScalar(opts.glow ?? 0.18), roughness: opts.rough ?? 0.14,
      metalness: opts.metal ?? 0.6, flatShading: opts.flat ?? true, transparent: opts.metal == null, opacity: opts.opacity ?? 0.95,
      envMapIntensity: opts.env ?? 1.1, map: opts.map || null,
    });
    this.mats[k] = m;
    return m;
  }

  pedestal(color) {
    const g = new THREE.Group();
    const a = new THREE.Mesh(this.pedGeo, this.pedMat);
    const b = new THREE.Mesh(this.pedTop, this.pedTrim);
    a.castShadow = a.receiveShadow = true; b.castShadow = true;
    g.add(a, b);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.235;
    g.add(ring);
    return g;
  }

  // Builds the full model for a gem record. Returns { root, holder, anim(t), flash(), color }
  build(gem) {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    holder.position.y = 0.72;
    holder.userData.base = gem.special ? 1.25 : 1.35;
    root.add(holder);
    let anim, color;
    if (gem.special) {
      const sp = SPECIALS[gem.special];
      color = sp.color;
      root.add(this.pedestal(new THREE.Color(sp.color)));
      anim = this.buildSpecial(gem.special, holder, gem.level || 0);
    } else {
      const def = GEM_TYPES[gem.type];
      color = def.color;
      root.add(this.pedestal(new THREE.Color(def.color)));
      anim = this.buildQuality(gem.quality, def.color, holder);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    const gs = gem.special ? 1.2 : 0.6 + gem.quality * 0.15;
    glow.scale.set(gs, gs, 1);
    glow.position.y = 0.72;
    root.add(glow);
    const seed = Math.random() * 10;
    let flashT = 0;
    const self = {
      root, holder, glow, color,
      anim(t, dt) {
        holder.position.y = 0.72 + Math.sin(t * 1.8 + seed) * 0.05;
        anim(t + seed, dt);
        flashT = Math.max(0, flashT - dt * 5);
        glow.material.opacity = 0.16 + flashT * 0.6 + Math.sin(t * 3 + seed) * 0.04;
        const k = holder.userData.base * (1 + flashT * 0.12);
        holder.scale.setScalar(k);
      },
      flash() { flashT = 1; },
    };
    return self;
  }

  buildQuality(q, hex, holder) {
    const mat = this.gemMat(hex);
    const geos = this.qGeo[q];
    const main = new THREE.Mesh(geos[0], mat);
    main.castShadow = true;
    holder.add(main);
    if (q === 3) {
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Mesh(geos[1], mat);
        s.position.set(i ? 0.14 : -0.14, -0.1, 0);
        s.rotation.z = i ? -0.5 : 0.5;
        holder.add(s);
      }
      return (t) => { holder.rotation.y = t * 0.6; };
    }
    if (q === 4) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.015, 6, 48), this.gemMat(hex, { glow: 1.2, metal: 0.8, flat: false }));
      ring.rotation.x = Math.PI / 2;
      holder.add(ring);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(geos[1], mat);
        const a = i / 5 * TAU;
        s.position.set(Math.cos(a) * 0.14, -0.12, Math.sin(a) * 0.14);
        s.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        s.castShadow = true;
        holder.add(s);
      }
      return (t) => {
        main.rotation.y = t * 0.8;
        ring.rotation.z = t * 1.5;
        ring.rotation.x = Math.PI / 2 + Math.sin(t) * 0.3;
      };
    }
    if (q === 0) return (t) => { main.rotation.set(t * 0.7, t * 0.9, 0); };
    if (q === 1) return (t) => { main.rotation.y = t * 1.1; };
    return (t) => { main.rotation.y = t * 0.9; main.rotation.x = Math.sin(t * 0.7) * 0.25; };
  }

  buildSpecial(key, holder, level) {
    const sp = SPECIALS[key];
    const hex = sp.color;
    const g = holder;
    g.userData.base = 1.25 * (1 + level * 0.12);
    const add = (geo, mat, cb) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); cb && cb(m); return m; };
    switch (key) {
      case 'malachite': {
        const m = this.gemMat(0x33dd88, { map: this.bandTex, flat: false, rough: 0.25, glow: 0.15, opacity: 1 });
        const core = add(new THREE.SphereGeometry(0.17, 20, 14), m);
        const rings = [0.24, 0.31, 0.38].map((r, i) => add(new THREE.TorusGeometry(r, 0.035, 8, 32), m, x => { x.rotation.x = Math.PI / 2; }));
        return (t) => {
          core.rotation.y = t;
          rings.forEach((r, i) => { r.rotation.x = Math.PI / 2 + Math.sin(t * (1 + i * 0.4)) * 0.6; r.rotation.y = t * (i % 2 ? 1 : -1) * 0.9; });
        };
      }
      case 'silver': {
        const m = this.gemMat(0xdfe6ee, { metal: 1, rough: 0.12, flat: false, glow: 0.05, env: 2.5 });
        const core = add(new THREE.IcosahedronGeometry(0.16, 1), this.gemMat(0xc8d4e8, { metal: 0.9, rough: 0.05 }));
        const rings = [0.26, 0.32, 0.38].map(r => add(new THREE.TorusGeometry(r, 0.018, 8, 40), m));
        return (t) => {
          core.rotation.y = t * 2;
          rings[0].rotation.set(t * 1.3, 0, 0);
          rings[1].rotation.set(0, t * 1.1, Math.PI / 2);
          rings[2].rotation.set(Math.PI / 4, 0, t * 0.9);
        };
      }
      case 'starRuby': {
        const sh = new THREE.Shape();
        for (let i = 0; i < 12; i++) {
          const r = i % 2 ? 0.13 : 0.32, a = i / 12 * TAU;
          i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 1 });
        geo.center();
        const star = add(geo, this.gemMat(hex, { glow: 0.6 }));
        const halo = add(new THREE.RingGeometry(0.34, 0.4, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }), h => { h.rotation.x = -Math.PI / 2; h.position.y = -0.3; });
        return (t) => {
          star.rotation.y = t * 1.5;
          star.rotation.z = t * 0.5;
          halo.rotation.z = -t;
          halo.material.opacity = 0.4 + Math.sin(t * 6) * 0.25;
        };
      }
      case 'jade': {
        const sh = new THREE.Shape();
        sh.absarc(0, 0, 0.32, 0, TAU, false);
        const hole = new THREE.Path(); hole.absarc(0, 0, 0.11, 0, TAU, true);
        sh.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 36 });
        geo.center();
        const m = this.gemMat(hex, { flat: false, rough: 0.35, glow: 0.2, opacity: 0.96 });
        const disc = add(geo, m);
        const bead = add(new THREE.SphereGeometry(0.07, 16, 12), this.gemMat(0xffe39a, { flat: false, metal: 0.9, rough: 0.2 }));
        const coins = [];
        if (level >= 2) for (let i = 0; i < 3; i++) coins.push(add(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16), this.gemMat(0xffd24a, { metal: 1, rough: 0.2, flat: false })));
        return (t) => {
          disc.rotation.y = Math.sin(t * 0.7) * 0.9;
          disc.rotation.x = Math.sin(t * 0.5) * 0.2;
          bead.position.y = Math.sin(t * 2) * 0.05;
          coins.forEach((c, i) => { const a = t * 1.5 + i * TAU / 3; c.position.set(Math.cos(a) * 0.42, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.42); c.rotation.x = t * 3; });
        };
      }
      case 'blackOpal': {
        const m = new THREE.MeshStandardMaterial({ color: 0x14121e, roughness: 0.1, metalness: 0.4, envMapIntensity: 2.5 });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.t = { value: 0 };
          m.userData.sh = sh;
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float t;')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              float fres = pow(1. - abs(dot(normalize(vViewPosition), normal)), 2.);
              vec3 ir = 0.5 + 0.5*cos(6.2831*(vec3(0.,0.33,0.67) + fres*1.5 + t*0.15 + vViewPosition.y*2.));
              totalEmissiveRadiance += ir * (0.25 + fres*1.2);`);
        };
        const core = add(new THREE.SphereGeometry(0.22, 32, 20), m);
        const shards = [];
        const sg = new THREE.OctahedronGeometry(0.06, 0); sg.scale(0.6, 1.8, 0.6);
        for (let i = 0; i < 6; i++) shards.push(add(sg, this.gemMat(0x2a2440, { glow: 0.5, metal: 0.6 })));
        return (t) => {
          if (m.userData.sh) m.userData.sh.uniforms.t.value = t;
          core.rotation.y = t * 0.5;
          shards.forEach((s, i) => { const a = t * 0.9 + i * TAU / 6; s.position.set(Math.cos(a) * 0.38, Math.sin(t * 2 + i) * 0.08, Math.sin(a) * 0.38); s.rotation.y = -a; });
        };
      }
      case 'bloodStone': {
        const m = this.gemMat(hex, { glow: 0.55, rough: 0.2 });
        const core = add(new THREE.DodecahedronGeometry(0.2, 0), m);
        const spikes = [];
        const cg = new THREE.ConeGeometry(0.05, 0.22, 5); cg.translate(0, 0.25, 0);
        const dirs = new THREE.DodecahedronGeometry(1, 0).attributes.position;
        const seen = new Set();
        for (let i = 0; i < dirs.count && spikes.length < 12; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
          const k = v.toArray().map(x => x.toFixed(1)).join();
          if (seen.has(k)) continue; seen.add(k);
          spikes.push(add(cg, this.gemMat(0x5a0008, { glow: 0.4 }), s => s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)));
        }
        return (t) => {
          const beat = Math.pow(Math.max(0, Math.sin(t * 4)), 8);
          core.scale.setScalar(1 + beat * 0.2);
          g.rotation.y = t * 0.4;
          m.emissiveIntensity = 1 + beat * 2;
        };
      }
      case 'darkEmerald': {
        const geo = lathe([[0, -0.38], [0.16, -0.15], [0.16, 0.15], [0, 0.4]], 5);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i), a = y * 3.5, x = p.getX(i), z = p.getZ(i);
          p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
        }
        geo.computeVertexNormals();
        const main = add(geo, this.gemMat(hex, { glow: 0.35 }));
        const leaves = [];
        const lg = new THREE.OctahedronGeometry(0.07, 0); lg.scale(1, 0.3, 2);
        for (let i = 0; i < 3; i++) leaves.push(add(lg, this.gemMat(0x2aff7a, { glow: 0.8 })));
        return (t) => {
          main.rotation.y = t * 0.8;
          leaves.forEach((l, i) => { const a = -t * 1.4 + i * TAU / 3; l.position.set(Math.cos(a) * 0.3, Math.sin(a * 2) * 0.12, Math.sin(a) * 0.3); l.rotation.y = -a; });
        };
      }
      case 'gold': {
        const m = this.gemMat(0xffc83a, { metal: 1, rough: 0.18, flat: true, glow: 0.12, env: 2.5 });
        const crownPts = [[0, -0.2], [0.26, -0.2], [0.28, -0.12], [0.24, 0.05], [0, 0.05]];
        const base = add(lathe(crownPts, 16), m);
        const spikes = [];
        const cg = new THREE.ConeGeometry(0.05, 0.2, 4);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU;
          spikes.push(add(cg, m, s => s.position.set(Math.cos(a) * 0.22, 0.14, Math.sin(a) * 0.22)));
        }
        const jewel = add(new THREE.OctahedronGeometry(0.09, 0), this.gemMat(0xff3355, { glow: 0.7 }), j => j.position.y = 0.3);
        return (t) => { g.rotation.y = t * 0.6; jewel.rotation.y = -t * 2; jewel.position.y = 0.3 + Math.sin(t * 3) * 0.03; };
      }
      case 'pinkDiamond': {
        const geo = lathe([[0, -0.32], [0.33, 0.02], [0.27, 0.12], [0.16, 0.16], [0, 0.16]], 12);
        geo.computeVertexNormals();
        const d = add(geo, this.gemMat(hex, { glow: 0.3, rough: 0.02, env: 3 }));
        return (t) => { d.rotation.y = t * 0.9; d.rotation.z = Math.sin(t * 0.8) * 0.2; };
      }
      case 'redCrystal': {
        const sg = lathe([[0, -0.1], [0.07, 0], [0.07, 0.3], [0, 0.42]], 6);
        sg.computeVertexNormals();
        const m = this.gemMat(hex, { glow: 0.5 });
        const shards = [];
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU, tilt = i ? 0.55 : 0;
          shards.push(add(sg, m, s => { s.position.set(i ? Math.cos(a) * 0.08 : 0, -0.25, i ? Math.sin(a) * 0.08 : 0); s.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt); s.scale.setScalar(i ? 0.75 : 1.25); }));
        }
        return (t) => { g.rotation.y = t * 0.5; m.emissiveIntensity = 1 + Math.sin(t * 3) * 0.5; };
      }
      case 'uranium': {
        const core = add(new THREE.IcosahedronGeometry(0.15, 1), new THREE.MeshStandardMaterial({ color: 0x9dff1a, emissive: 0x5acc00, emissiveIntensity: 0.9, roughness: 0.3, flatShading: true }));
        const orbits = [], electrons = [];
        const em = new THREE.MeshBasicMaterial({ color: 0xeaffb0 });
        for (let i = 0; i < 3; i++) {
          const o = new THREE.Group();
          o.rotation.set(i * 1.05, i * 0.7, 0);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.008, 6, 48), new THREE.MeshBasicMaterial({ color: 0xb8ff3a, transparent: true, opacity: 0.6 }));
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), em);
          o.add(ring, e);
          g.add(o);
          orbits.push(o); electrons.push(e);
        }
        return (t) => {
          core.rotation.y = t; core.scale.setScalar(1 + Math.sin(t * 8) * 0.06);
          electrons.forEach((e, i) => { const a = t * (3 + i) + i; e.position.set(Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0); });
          orbits.forEach((o, i) => { o.rotation.y += 0.01 * (i + 1); });
        };
      }
      case 'yellowSapphire': {
        const m = this.gemMat(hex, { glow: 0.35 });
        const a = add(new THREE.TetrahedronGeometry(0.28, 0), m);
        const b = add(new THREE.TetrahedronGeometry(0.28, 0), this.gemMat(0xfff4a0, { glow: 0.3 }), x => x.rotation.set(Math.PI, 0, 0));
        return (t) => { a.rotation.y = t; b.rotation.y = -t * 1.2; b.rotation.x = Math.PI + Math.sin(t) * 0.3; };
      }
      case 'paraiba': {
        const core = add(new THREE.DodecahedronGeometry(0.2, 0), this.gemMat(hex, { glow: 0.6 }));
        const shards = [];
        const sg = new THREE.OctahedronGeometry(0.05, 0); sg.scale(0.7, 2, 0.7);
        for (let i = 0; i < 8; i++) shards.push(add(sg, this.gemMat(0xdaf8ff, { glow: 0.5 })));
        return (t) => {
          core.rotation.set(t * 0.4, t * 0.7, 0);
          shards.forEach((s, i) => { const a = t * 1.2 + i * TAU / 8; const r = 0.34 + Math.sin(t * 2 + i) * 0.04; s.position.set(Math.cos(a) * r, Math.sin(a * 3) * 0.08, Math.sin(a) * r); s.rotation.z = a; });
        };
      }
    }
    add(new THREE.SphereGeometry(0.2), this.gemMat(hex));
    return () => {};
  }

  rock() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.rockGeos[Math.floor(Math.random() * this.rockGeos.length)], this.rockMat);
    m.rotation.y = Math.random() * TAU;
    m.scale.set(0.9 + Math.random() * 0.2, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.2);
    m.position.y = 0.12;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(this.rockGeos[(i + 3) % 6], this.rockMat);
      const a = Math.random() * TAU;
      s.position.set(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
      s.scale.setScalar(0.25 + Math.random() * 0.15);
      s.castShadow = true;
      g.add(s);
    }
    return g;
  }
}
