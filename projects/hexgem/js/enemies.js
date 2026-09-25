// Enemy models, built from primitives with their own walk / flap / squash animations,
// plus a health bar and status tinting (poison, freeze, burn, radiation, stun, armor break).
import * as THREE from 'three';

const TAU = Math.PI * 2;

const STATUS_COLORS = {
  poison: new THREE.Color(0x3cff4a),
  slow: new THREE.Color(0x3aa8ff),
  burn: new THREE.Color(0xff6a1a),
  rad: new THREE.Color(0xc8ff1a),
  stun: new THREE.Color(0xfff4a0),
  shred: new THREE.Color(0xc060ff),
};

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.05, flatShading: o.flat ?? false, emissive: 0x000000 });
}

const shared = {};
function G(name, make) { return shared[name] ||= make(); }

export class EnemyArt {
  constructor(glowTex) {
    this.glowTex = glowTex;
    this.barGeo = new THREE.PlaneGeometry(1, 0.09);
    this.barBgMat = new THREE.MeshBasicMaterial({ color: 0x1a0a0a, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
    this.shadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
  }

  // Returns { root, body, mats[], anim(t, speed), bar, setHp(f), tint(status) }
  build(kind, opts = {}) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mats = [];
    const M = (c, o) => { const m = std(c, o); mats.push(m); return m; };
    const mesh = (geo, mat, parent = body) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
    let anim = () => {}, height = 0.6, scale = 1;
    const eyeMat = new THREE.MeshBasicMaterial({ color: kind === 'golem' ? 0xff5a1a : 0xffee55 });
    const eyes = (x, y, z, r) => { for (const s of [-1, 1]) { const e = new THREE.Mesh(G('eye', () => new THREE.SphereGeometry(1, 8, 6)), eyeMat); e.scale.setScalar(r); e.position.set(x, y, z * s); body.add(e); } };

    switch (kind) {
      case 'crawler': {
        // six-legged beetle
        const shell = M(0x7a3a2a, { rough: 0.35, metal: 0.2 });
        const b = mesh(G('crawlerBody', () => { const g = new THREE.SphereGeometry(0.22, 14, 10); g.scale(1.25, 0.7, 1); return g; }), shell);
        b.position.y = 0.2;
        const h = mesh(G('crawlerHead', () => new THREE.SphereGeometry(0.11, 10, 8)), M(0x3a1a12));
        h.position.set(0.27, 0.18, 0);
        eyes(0.35, 0.21, 0.05, 0.028);
        const legMat = M(0x2a1410);
        const legs = [];
        for (let i = 0; i < 6; i++) {
          const pivot = new THREE.Group();
          const side = i < 3 ? 1 : -1;
          pivot.position.set(-0.12 + (i % 3) * 0.12, 0.16, side * 0.15);
          const leg = mesh(G('leg', () => { const g = new THREE.CylinderGeometry(0.032, 0.02, 0.3, 5); g.translate(0, -0.15, 0); return g; }), legMat, pivot);
          leg.rotation.x = side * 0.9;
          body.add(pivot);
          legs.push({ pivot, phase: (i % 2) * Math.PI + (i < 3 ? 0 : Math.PI) });
        }
        anim = (t) => { legs.forEach(l => { l.pivot.rotation.z = Math.sin(t * 14 + l.phase) * 0.5; }); b.position.y = 0.2 + Math.abs(Math.sin(t * 14)) * 0.015; };
        height = 0.5;
        break;
      }
      case 'runner': {
        // lean two-legged lizard
        const skin = M(0x3aa8a0, { rough: 0.5 });
        const torso = mesh(G('runTorso', () => { const g = new THREE.CapsuleGeometry(0.09, 0.28, 4, 10); g.rotateZ(Math.PI / 2 - 0.35); return g; }), skin);
        torso.position.y = 0.38;
        const head = mesh(G('runHead', () => { const g = new THREE.ConeGeometry(0.08, 0.22, 8); g.rotateZ(-Math.PI / 2); return g; }), skin);
        head.position.set(0.25, 0.5, 0);
        eyes(0.22, 0.54, 0.05, 0.022);
        const tail = mesh(G('runTail', () => { const g = new THREE.ConeGeometry(0.05, 0.4, 6); g.rotateZ(Math.PI / 2); g.translate(-0.2, 0, 0); return g; }), M(0x2a7a74));
        tail.position.set(-0.15, 0.32, 0);
        const legs = [];
        for (const s of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(0, 0.3, s * 0.07);
          mesh(G('runLeg', () => { const g = new THREE.CylinderGeometry(0.025, 0.02, 0.3, 5); g.translate(0, -0.15, 0); return g; }), skin, pivot);
          body.add(pivot);
          legs.push(pivot);
        }
        anim = (t) => {
          legs[0].rotation.z = Math.sin(t * 16) * 0.9;
          legs[1].rotation.z = -Math.sin(t * 16) * 0.9;
          torso.position.y = 0.38 + Math.abs(Math.cos(t * 16)) * 0.04;
          tail.rotation.y = Math.sin(t * 8) * 0.4;
        };
        height = 0.7;
        break;
      }
      case 'shell': {
        // armoured armadillo with plates
        const plate = M(0x6c6f78, { rough: 0.3, metal: 0.7, flat: true });
        const b = mesh(G('shellBody', () => { const g = new THREE.SphereGeometry(0.28, 10, 8, 0, TAU, 0, Math.PI / 2); g.scale(1.3, 1, 1); return g; }), plate);
        b.position.y = 0.08;
        for (let i = 0; i < 3; i++) {
          const band = mesh(G('band', () => { const g = new THREE.TorusGeometry(0.27, 0.025, 6, 16, Math.PI); return g; }), M(0x9a8a5a, { metal: 0.8, rough: 0.3 }));
          band.position.set(-0.15 + i * 0.15, 0.08, 0);
          band.rotation.y = Math.PI / 2;
          band.scale.set(1, 1 - Math.abs(i - 1) * 0.12, 1);
        }
        const h = mesh(G('shellHead', () => { const g = new THREE.SphereGeometry(0.1, 10, 8); g.scale(1.4, 1, 1); return g; }), M(0x4a3a30));
        h.position.set(0.36, 0.12, 0);
        eyes(0.45, 0.15, 0.05, 0.022);
        const feet = [];
        for (let i = 0; i < 4; i++) {
          const f = mesh(G('foot', () => new THREE.SphereGeometry(0.06, 8, 6)), M(0x3a2a20));
          f.position.set(i < 2 ? 0.18 : -0.18, 0.04, (i % 2 ? 1 : -1) * 0.2);
          feet.push(f);
        }
        anim = (t) => { feet.forEach((f, i) => { f.position.y = 0.04 + Math.max(0, Math.sin(t * 9 + i * Math.PI / 2)) * 0.05; }); b.rotation.x = Math.sin(t * 9) * 0.04; };
        height = 0.55;
        break;
      }
      case 'bat': {
        const fur = M(0x5a2a6a, { rough: 0.8 });
        const b = mesh(G('batBody', () => { const g = new THREE.SphereGeometry(0.14, 12, 10); g.scale(1.3, 1, 1); return g; }), fur);
        const h = mesh(G('batHead', () => new THREE.SphereGeometry(0.09, 10, 8)), fur);
        h.position.set(0.16, 0.04, 0);
        for (const s of [-1, 1]) { const ear = mesh(G('ear', () => new THREE.ConeGeometry(0.035, 0.1, 4)), fur); ear.position.set(0.16, 0.13, s * 0.05); }
        eyes(0.23, 0.06, 0.04, 0.02);
        const wingMat = M(0x3a1a4a, { rough: 0.7 });
        wingMat.side = THREE.DoubleSide;
        const wings = [];
        for (const s of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(0, 0.03, s * 0.1);
          const wg = G('wing' + s, () => {
            const sh = new THREE.Shape();
            sh.moveTo(0.12, 0); sh.lineTo(0.05, 0.42); sh.lineTo(-0.02, 0.3); sh.lineTo(-0.08, 0.38); sh.lineTo(-0.12, 0.22); sh.lineTo(-0.15, 0);
            const g = new THREE.ShapeGeometry(sh);
            g.rotateX(s * Math.PI / 2);
            return g;
          });
          mesh(wg, wingMat, pivot);
          body.add(pivot);
          wings.push({ pivot, s });
        }
        anim = (t) => {
          const f = Math.sin(t * 18);
          wings.forEach(w => { w.pivot.rotation.x = w.s * f * 0.8; });
          body.position.y = Math.sin(t * 18 + 1) * 0.04;
        };
        height = 0.4;
        break;
      }
      case 'slime': {
        const goo = new THREE.MeshStandardMaterial({ color: 0x8aff5a, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x000000 });
        mats.push(goo);
        const b = mesh(G('slime', () => { const g = new THREE.SphereGeometry(0.16, 16, 12, 0, TAU, 0, Math.PI * 0.6); g.translate(0, -0.03, 0); return g; }), goo);
        b.position.y = 0.05;
        const core = mesh(G('slimeCore', () => new THREE.SphereGeometry(0.05, 8, 6)), M(0x2a6a1a));
        core.position.y = 0.08;
        eyes(0.1, 0.12, 0.05, 0.022);
        const seed = Math.random() * 10;
        anim = (t) => {
          const s = Math.sin(t * 10 + seed);
          b.scale.set(1 + s * 0.12, 1 - s * 0.18, 1 + s * 0.12);
          body.position.y = Math.max(0, Math.sin(t * 10 + seed + 1)) * 0.08;
        };
        height = 0.35;
        break;
      }
      case 'golem': {
        const stone = M(0x5a5048, { rough: 0.9, flat: true });
        const lava = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff4a0a, emissiveIntensity: 1.5 });
        const torso = mesh(G('golemTorso', () => new THREE.DodecahedronGeometry(0.34, 0)), stone);
        torso.position.y = 0.72; torso.scale.set(1, 1.15, 1.2);
        const core = mesh(G('golemCore', () => new THREE.IcosahedronGeometry(0.12, 0)), lava);
        core.position.set(0.28, 0.75, 0);
        const head = mesh(G('golemHead', () => new THREE.DodecahedronGeometry(0.16, 0)), stone);
        head.position.set(0.12, 1.12, 0);
        eyes(0.26, 1.14, 0.06, 0.03);
        for (let i = 0; i < 5; i++) {
          const sp = mesh(G('crown', () => new THREE.ConeGeometry(0.035, 0.16, 4)), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.3 }));
          sp.position.set(0.12 + Math.cos(i / 5 * TAU) * 0.1, 1.27, Math.sin(i / 5 * TAU) * 0.1);
        }
        const arms = [], legs = [];
        for (const s of [-1, 1]) {
          const ap = new THREE.Group(); ap.position.set(0, 0.9, s * 0.42);
          const arm = mesh(G('golemArm', () => { const g = new THREE.BoxGeometry(0.16, 0.5, 0.16); g.translate(0, -0.22, 0); return g; }), stone, ap);
          const fist = mesh(G('golemFist', () => new THREE.DodecahedronGeometry(0.13, 0)), stone, ap);
          fist.position.y = -0.5;
          body.add(ap); arms.push(ap);
          const lp = new THREE.Group(); lp.position.set(0, 0.42, s * 0.18);
          mesh(G('golemLeg', () => { const g = new THREE.BoxGeometry(0.18, 0.42, 0.18); g.translate(0, -0.21, 0); return g; }), stone, lp);
          body.add(lp); legs.push(lp);
        }
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff5a1a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
        glow.position.set(0.3, 0.75, 0); glow.scale.set(0.7, 0.7, 1);
        body.add(glow);
        anim = (t) => {
          const w = Math.sin(t * 5);
          legs[0].rotation.z = w * 0.5; legs[1].rotation.z = -w * 0.5;
          arms[0].rotation.z = -w * 0.4; arms[1].rotation.z = w * 0.4;
          body.rotation.x = Math.sin(t * 10) * 0.03;
          lava.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.5;
        };
        height = 1.45;
        scale = 1.35;
        break;
      }
    }
    scale *= 1.5;
    body.scale.setScalar(scale);

    // ground shadow blob (flyers get it too, far below)
    const sh = new THREE.Mesh(G('shadowGeo', () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; }), this.shadowMat);
    sh.scale.setScalar((kind === 'golem' ? 1.3 : 0.6) * 1.4);
    root.add(sh);

    // health bar, faces the camera every frame
    const bar = new THREE.Group();
    bar.position.y = height * scale + 0.25;
    const bg = new THREE.Mesh(this.barGeo, this.barBgMat);
    bg.scale.set(kind === 'golem' ? 0.9 : 0.5, 1.2, 1);
    const fgMat = new THREE.MeshBasicMaterial({ color: 0x4aff4a, depthTest: false, depthWrite: false, transparent: true });
    const fg = new THREE.Mesh(this.barGeo, fgMat);
    fg.renderOrder = 11; bg.renderOrder = 10;
    const bw = kind === 'golem' ? 0.86 : 0.47;
    bar.add(bg, fg);
    root.add(bar);

    const baseColors = mats.map(m => m.color.clone());
    const tintC = new THREE.Color();
    return {
      root, body, bar, shadow: sh, height: height * scale,
      anim,
      setHp(f) {
        f = Math.max(0, Math.min(1, f));
        fg.scale.set(bw * f, 0.8, 1);
        fg.position.x = -bw * (1 - f) / 2;
        fgMat.color.setHSL(0.33 * f, 1, 0.5);
      },
      // statuses: {poison, slow, burn, rad, stun, shred} truthy flags
      tint(st, t) {
        const list = [];
        for (const k in STATUS_COLORS) if (st[k]) list.push(k);
        if (!list.length) {
          mats.forEach((m, i) => { m.color.copy(baseColors[i]); m.emissive.setRGB(0, 0, 0); });
          return;
        }
        // cycle through active statuses so each one reads
        const k = list[Math.floor(t * 2.5) % list.length];
        const c = STATUS_COLORS[k];
        const pulse = 0.55 + Math.sin(t * 9) * 0.2;
        mats.forEach((m, i) => {
          tintC.copy(baseColors[i]).lerp(c, 0.5);
          m.color.copy(tintC);
          m.emissive.copy(c).multiplyScalar(pulse * (k === 'stun' ? 0.6 : 0.4));
        });
      },
      dispose() { mats.forEach(m => m.dispose()); fgMat.dispose(); },
    };
  }
}
