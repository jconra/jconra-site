// Game rules and simulation: rounds, placing, keeping, combining, specials, waves, combat.
import * as THREE from 'three';
import {
  GEM_TYPES, TYPE_KEYS, SPECIALS, SPECIAL_KEYS, QUALITIES, QUALITY_COSTS, QUALITY_CHANCES,
  RANGE_PER_HEX, START_LIVES, START_GOLD, FINAL_WAVE, GEMS_PER_ROUND, killGold, roundGold, buildWave, armorFactor,
} from './data.js';
import { key, inGrid, isReserved, findRoute, toWorld, START, EXIT, PADS } from './hex.js';
import { sfx } from './audio.js';

const R = v => v / RANGE_PER_HEX;     // range units -> world units
const rnd = (a, b) => a + Math.random() * (b - a);
const FLY_H = 1.6;

let nextId = 1;

export function gemName(g) {
  if (g.kind === 'rock') return 'Rock';
  if (g.special) return SPECIALS[g.special].levels[g.level].name;
  return QUALITIES[g.quality] + ' ' + GEM_TYPES[g.type].name;
}
export function gemStats(g) {
  if (g.special) return { ...SPECIALS[g.special].levels[g.level] };
  const d = GEM_TYPES[g.type];
  return { ...(d.all || {}), ...d.q[g.quality] };
}
export function gemColor(g) {
  if (g.kind === 'rock') return '#9a948c';
  return g.special ? SPECIALS[g.special].css : GEM_TYPES[g.type].css;
}

export class Game {
  constructor(view) {
    this.view = view;   // { scene, world, gemArt, enemyArt, fx, camera, onChange, onMessage, onEvent }
    this.reset();
  }

  reset() {
    const v = this.view;
    if (this.gems) for (const g of this.gems.values()) v.scene.remove(g.art.root);
    if (this.enemies) for (const e of this.enemies) { v.scene.remove(e.art.root); e.art.dispose(); }
    v.fx && v.fx.clear();
    this.gems = new Map();
    this.enemies = [];
    this.spawnQueue = [];
    this.newGems = [];
    this.phase = 'build';
    this.wave = 1;
    this.lives = START_LIVES;
    this.gold = START_GOLD;
    this.qLevel = 0;
    this.placesLeft = GEMS_PER_ROUND;
    this.clock = 0;
    this.selected = null;
    this.endless = false;
    this.stats = { kills: 0, leaked: 0 };
    // wave 1 hands out a full Malachite or Silver recipe plus two chipped extras
    const pick = Math.random() < 0.5 ? 'malachite' : 'silver';
    const q = SPECIALS[pick].recipe.map(([t]) => ({ type: t, quality: 0 }));
    for (let i = 0; i < 2; i++) q.push({ type: TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)], quality: 0 });
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    this.firstWaveQueue = q;
    this.firstWaveHint = pick;
    this.recomputeRoute();
    this.changed();
  }

  changed() { this.view.onChange && this.view.onChange(); }
  msg(text, kind) { this.view.onMessage && this.view.onMessage(text, kind); }

  blockedFn(extra) {
    return (c, r) => this.gems.has(key(c, r)) || (extra && extra.c === c && extra.r === r);
  }
  recomputeRoute() {
    this.route = findRoute(this.blockedFn());
    this.view.world.setPath(this.route.cells);
  }

  // ---------- building ----------
  canPlace(c, r) {
    if (this.phase !== 'build' || this.placesLeft <= 0) return { ok: false, reason: '' };
    if (!inGrid(c, r)) return { ok: false, reason: '' };
    if (isReserved(c, r)) return { ok: false, reason: "Can't build on the start, the exit or a goal pad" };
    if (this.gems.has(key(c, r))) return { ok: false, reason: 'That spot is taken' };
    if (!findRoute(this.blockedFn({ c, r }))) return { ok: false, reason: 'That would block the path!' };
    return { ok: true };
  }

  rollGem() {
    if (this.wave === 1 && this.firstWaveQueue.length) return this.firstWaveQueue.shift();
    const type = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
    let roll = Math.random() * 100, quality = 0;
    for (let q = 0; q < 5; q++) {
      roll -= QUALITY_CHANCES[q][this.qLevel];
      if (roll < 0) { quality = q; break; }
    }
    return { type, quality };
  }

  place(c, r) {
    const chk = this.canPlace(c, r);
    if (!chk.ok) { if (chk.reason) { this.msg(chk.reason, 'bad'); sfx('bad'); } return null; }
    const { type, quality } = this.rollGem();
    const g = this.addGem({ c, r, kind: 'gem', type, quality, isNew: true });
    this.newGems.push(g);
    this.placesLeft--;
    this.recomputeRoute();
    sfx('place');
    const w = toWorld(c, r);
    this.view.fx.emit(w.x, 0.6, w.z, { color: GEM_TYPES[type].color, count: 30, speed: 2.5, life: 0.7, size: 0.18, gravity: 3 });
    this.view.fx.wave(w.x, w.z, 0.8, GEM_TYPES[type].color, { dur: 0.5 });
    g.art.root.scale.setScalar(0.01);
    g.popIn = 0;
    if (this.placesLeft === 0) {
      this.phase = 'select';
      this.msg('Pick a gem to keep. The rest turn to rock.', 'info');
    }
    this.select(g);
    this.changed();
    return g;
  }

  addGem(o) {
    const w = toWorld(o.c, o.r);
    const g = { id: nextId++, level: 0, special: null, kills: 0, dmgDone: 0, cd: 0, target: null, pulse: Math.random() * 2, ...o, x: w.x, z: w.z };
    this.buildArt(g);
    this.gems.set(key(o.c, o.r), g);
    this.recomputeAuras();
    return g;
  }

  buildArt(g) {
    const v = this.view;
    if (g.art) v.scene.remove(g.art.root);
    g.art = g.kind === 'rock' ? { root: v.gemArt.rock(), anim() {}, flash() {} } : v.gemArt.build(g);
    g.art.root.position.set(g.x, 0, g.z);
    v.scene.add(g.art.root);
  }

  toRock(g) {
    g.kind = 'rock';
    g.special = null;
    g.isNew = false;
    this.buildArt(g);
    this.view.fx.emit(g.x, 0.5, g.z, { color: 0x9a948c, count: 18, speed: 2, life: 0.6, size: 0.2, gravity: 5 });
  }

  // ---------- choosing ----------
  endSelection(keeper) {
    for (const g of this.newGems) if (g !== keeper && g.kind === 'gem' && g.isNew) this.toRock(g);
    for (const g of this.newGems) g.isNew = false;
    this.newGems = [];
    sfx('rock');
    this.recomputeAuras();
    this.startWave();
  }

  keep(g) {
    if (this.phase !== 'select' || !g.isNew) return;
    g.isNew = false;
    this.celebrate(g, 0.8);
    this.endSelection(g);
    this.changed();
  }

  sameOptions(g) {
    if (this.phase !== 'select' || !g.isNew || g.special || g.kind !== 'gem' || g.quality >= 4) return [];
    const same = this.newGems.filter(o => o.kind === 'gem' && !o.special && o.type === g.type && o.quality === g.quality);
    const out = [];
    if (same.length >= 2) out.push({ n: 2, up: 1 });
    if (same.length >= 4 && g.quality <= 2) out.push({ n: 4, up: 2 });
    return out;
  }

  combineSame(g, n) {
    const opt = this.sameOptions(g).find(o => o.n === n);
    if (!opt) return;
    g.quality += opt.up;
    g.isNew = false;
    this.buildArt(g);
    sfx('combine');
    this.celebrate(g, 1.2);
    this.msg(`Combined into ${gemName(g)}!`, 'good');
    this.endSelection(g);
    this.select(g);
    this.changed();
  }

  downgrade(g) {
    if (this.phase !== 'select' || !g.isNew || g.special || g.quality <= 0) return;
    g.quality--;
    this.buildArt(g);
    sfx('rock');
    this.recomputeAuras();
    this.select(g);
    this.changed();
  }

  // Special recipes this gem could complete right now, with the gems each would use.
  specialOptions(g) {
    if (!g || g.kind !== 'gem' || g.special || this.phase === 'over') return [];
    const out = [];
    for (const k of SPECIAL_KEYS) {
      const rec = SPECIALS[k].recipe;
      const mine = rec.findIndex(([t, q]) => t === g.type && q === g.quality);
      if (mine < 0) continue;
      const used = new Set([g.id]);
      const parts = [g];
      let ok = true;
      rec.forEach(([t, q], i) => {
        if (i === mine || !ok) return;
        const cands = [...this.gems.values()].filter(o => o.kind === 'gem' && !o.special && !used.has(o.id) && o.type === t && o.quality === q);
        if (!cands.length) { ok = false; return; }
        // spend this round's gems first (they'd become rock anyway), then the nearest
        cands.sort((a, b) => (b.isNew - a.isNew) || (Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z)));
        used.add(cands[0].id);
        parts.push(cands[0]);
      });
      if (!ok) continue;
      // while placing, the round's gems aren't ready to be spent yet
      const usesNew = parts.some(p => p.isNew);
      if (this.phase === 'build' && usesNew) continue;
      if (this.phase === 'wave' && usesNew) continue;
      out.push({ key: k, parts });
    }
    return out;
  }

  // Recipes this gem belongs to, with which ingredients are on the board.
  recipeHints(g) {
    if (!g || g.kind !== 'gem' || g.special) return [];
    const out = [];
    for (const k of SPECIAL_KEYS) {
      const rec = SPECIALS[k].recipe;
      const mine = rec.findIndex(([t, q]) => t === g.type && q === g.quality);
      if (mine < 0) continue;
      const used = new Set([g.id]);
      const need = rec.map(([t, q], i) => {
        if (i === mine) return { t, q, have: true, self: true };
        const c = [...this.gems.values()].find(o => o.kind === 'gem' && !o.special && !used.has(o.id) && o.type === t && o.quality === q);
        if (c) used.add(c.id);
        return { t, q, have: !!c };
      });
      out.push({ key: k, need });
    }
    return out;
  }

  makeSpecial(g, k) {
    const opt = this.specialOptions(g).find(o => o.key === k);
    if (!opt) return;
    const usesNew = opt.parts.some(p => p.isNew);
    for (const p of opt.parts) if (p !== g) this.toRock(p);
    g.special = k;
    g.level = 0;
    g.isNew = false;
    this.buildArt(g);
    this.recomputeAuras();
    sfx('special_made');
    this.celebrate(g, 2);
    this.msg(`${SPECIALS[k].name} created!`, 'good');
    if (this.phase === 'select' && usesNew) this.endSelection(g);
    this.select(g);
    this.changed();
  }

  upgradeCost(g) {
    if (!g || !g.special || g.level >= 2) return null;
    return SPECIALS[g.special].cost[g.level];
  }
  upgradeSpecial(g) {
    const c = this.upgradeCost(g);
    if (c == null) return;
    if (this.gold < c) { this.msg(`Need ${c} gold`, 'bad'); sfx('bad'); return; }
    this.gold -= c;
    g.level++;
    this.buildArt(g);
    this.recomputeAuras();
    sfx('upgrade');
    this.celebrate(g, 1.5);
    this.msg(`Upgraded to ${gemName(g)}!`, 'good');
    this.changed();
  }

  canRemoveRock(g) { return g && g.kind === 'rock' && (this.phase === 'build' || this.phase === 'select'); }
  removeRock(g) {
    if (!this.canRemoveRock(g)) return;
    this.view.scene.remove(g.art.root);
    this.gems.delete(key(g.c, g.r));
    this.view.fx.emit(g.x, 0.3, g.z, { color: 0xb0a89c, count: 26, speed: 2.5, life: 0.7, size: 0.22, gravity: 6 });
    sfx('rock');
    if (this.selected === g) this.selected = null;
    this.recomputeRoute();
    this.changed();
  }

  qualityCost() { return this.qLevel < 8 ? QUALITY_COSTS[this.qLevel] : null; }
  buyQuality() {
    const c = this.qualityCost();
    if (c == null) return;
    if (this.gold < c) { this.msg(`Need ${c} gold`, 'bad'); sfx('bad'); return; }
    this.gold -= c;
    this.qLevel++;
    sfx('upgrade');
    this.msg(`Gem Quality is now level ${this.qLevel}`, 'good');
    this.changed();
  }

  select(g) { this.selected = g; this.changed(); }

  celebrate(g, k) {
    const col = g.special ? SPECIALS[g.special].color : GEM_TYPES[g.type].color;
    this.view.fx.emit(g.x, 0.8, g.z, { color: col, count: Math.round(50 * k), speed: 3 * k, life: 1, size: 0.2, gravity: 2 });
    this.view.fx.wave(g.x, g.z, 1.2 * k, col, { dur: 0.8 });
    this.view.fx.wave(g.x, g.z, 0.8 * k, 0xffffff, { dur: 0.5 });
    g.art.root.scale.setScalar(0.3);
    g.popIn = 0;
  }

  // Opal speed and Black Opal damage auras only change when the board does.
  recomputeAuras() {
    const list = [...this.gems.values()].filter(g => g.kind === 'gem');
    for (const g of list) { g.speedMult = 1; g.dmgMult = 1; }
    for (const a of list) {
      const s = gemStats(a);
      if (!s.speedAura && !s.dmgAura) continue;
      const rr = R(s.auraRange);
      for (const g of list) {
        if (Math.hypot(g.x - a.x, g.z - a.z) > rr) continue;
        if (s.speedAura) g.speedMult = Math.max(g.speedMult, 1 + s.speedAura);
        if (s.dmgAura && g !== a) g.dmgMult = Math.max(g.dmgMult, 1 + s.dmgAura);
      }
    }
  }

  // ---------- waves ----------
  startWave() {
    this.phase = 'wave';
    this.selected = this.selected && this.gems.has(key(this.selected.c, this.selected.r)) ? this.selected : null;
    this.recomputeRoute();
    const wv = buildWave(this.wave);
    this.waveInfo = wv;
    this.waveTime = 0;
    this.spawnQueue = wv.list.slice();
    this.waveTotal = wv.list.length;
    // ground route: out of the cave, cell by cell, into the portal
    const cm = this.view.world.caveMouth, pp = this.view.world.portalPos;
    this.groundPts = [{ x: cm.x - 0.8, z: cm.z }, ...this.route.cells.map(c => toWorld(c.c, c.r)), { x: pp.x, z: pp.z }];
    // flyers: straight lines between the route stops
    this.airPts = [{ x: cm.x - 0.5, z: cm.z }, ...[START, ...PADS, EXIT].map(p => toWorld(p.c, p.r)), { x: pp.x, z: pp.z }];
    this.groundLen = cumulative(this.groundPts);
    this.airLen = cumulative(this.airPts);
    sfx('wave');
    this.msg(`Wave ${this.wave}: ${wv.name}`, 'wave');
    this.changed();
  }

  spawn(s) {
    const art = this.view.enemyArt.build(s.kind);
    const pts = s.flying ? this.airPts : this.groundPts;
    const lens = s.flying ? this.airLen : this.groundLen;
    const e = {
      id: nextId++, ...s, maxHp: s.hp, pts, lens, seg: 0, dist: 0, art,
      x: pts[0].x, z: pts[0].z, y: s.flying ? FLY_H : 0,
      off: { x: (Math.random() - 0.5) * 0.22, z: (Math.random() - 0.5) * 0.22 },
      slowAmt: 0, slowUntil: 0, poisonDps: 0, poisonUntil: 0, burnDps: 0, burnUntil: 0, stunUntil: 0,
      aSlow: 0, aBurn: 0, rad: false, shred: 0, animT: Math.random() * 10, heading: 0, fade: 0,
    };
    if (s.flying) e.off.x = e.off.z = 0;
    art.root.position.set(e.x, e.y, e.z);
    art.setHp(1);
    this.view.scene.add(art.root);
    this.enemies.push(e);
    if (s.boss) { this.msg('A boss approaches!', 'bad'); sfx('boom'); }
  }

  hitPoint(e) { return { x: e.x, y: e.y + e.art.height * 0.55, z: e.z }; }

  update(dt) {
    if (this.phase === 'over') return;
    this.clock += dt;
    const now = this.clock;
    const fx = this.view.fx;

    // gem pop-in animation
    for (const g of this.gems.values()) {
      if (g.popIn != null) {
        g.popIn += dt * 3;
        const f = Math.min(1, g.popIn);
        const s = f < 1 ? 1 + Math.sin(f * Math.PI) * 0.35 * (1 - f) + (f - 1) * 0.0 : 1;
        g.art.root.scale.setScalar(Math.max(0.01, f < 1 ? f * s : 1));
        if (f >= 1) { g.popIn = null; g.art.root.scale.setScalar(1); }
      }
    }

    // aura pulses (opal and black opal show their reach even between waves)
    for (const g of this.gems.values()) {
      if (g.kind !== 'gem') continue;
      const s = gemStats(g);
      if (s.speedAura || s.dmgAura) {
        g.pulse -= dt;
        if (g.pulse <= 0) { g.pulse = 2.4; fx.wave(g.x, g.z, R(s.auraRange), g.special ? 0x8a7cff : 0x9fe0cc, { dur: 1.6, alpha: 0.35 }); }
      }
    }

    if (this.phase !== 'wave') return;
    this.waveTime += dt;
    while (this.spawnQueue.length && this.spawnQueue[0].delay <= this.waveTime) this.spawn(this.spawnQueue.shift());

    // enemy-affecting auras
    for (const e of this.enemies) { e.aSlow = 0; e.aBurn = 0; e.rad = false; e.shred = 0; e.inAura = false; }
    for (const g of this.gems.values()) {
      if (g.kind !== 'gem' || !g.special) continue;
      const s = gemStats(g);
      if (!s.burnAura && !s.slowAura && !s.airArmor && !s.groundArmor) continue;
      const rr = R(s.auraRange);
      let touched = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - g.x, e.z - g.z) > rr) continue;
        if (s.airArmor && e.flying) { e.shred = Math.max(e.shred, s.airArmor); touched++; }
        if (s.groundArmor && !e.flying) { e.shred = Math.max(e.shred, s.groundArmor); touched++; }
        if (s.burnAura) { e.aBurn = Math.max(e.aBurn, s.burnAura * g.dmgMult); e.rad = e.rad || g.special === 'uranium'; e.auraGem = g; touched++; }
        if (s.slowAura) { e.aSlow = Math.max(e.aSlow, s.slowAura); touched++; }
      }
      g.auraTimer = (g.auraTimer || 0) - dt;
      if (touched && g.auraTimer <= 0) {
        g.auraTimer = 0.7;
        const col = g.special === 'uranium' ? 0xb8ff2a : g.special === 'starRuby' ? 0xff6a2a : g.special === 'redCrystal' ? 0xff4a6a : 0x3ae8ff;
        fx.wave(g.x, g.z, rr, col, { dur: 0.9, alpha: 0.6 });
        if (s.burnAura) fx.wave(g.x, g.z, rr * 0.6, 0xffffff, { dur: 0.5, alpha: 0.25 });
      }
    }

    // enemies: statuses, damage over time, movement
    for (const e of this.enemies) {
      if (e.dead) continue;
      let dot = 0;
      if (now < e.poisonUntil) dot += e.poisonDps;
      if (now < e.burnUntil) dot += e.burnDps;
      dot += e.aBurn;
      if (dot > 0) {
        this.damage(e, dot * dt, e.dotSource || e.auraGem, true);
        if (e.dead) continue;
        if (Math.random() < dt * 8) {
          const hp = this.hitPoint(e);
          const col = now < e.burnUntil || e.aBurn ? (e.rad ? 0xb8ff2a : 0xff7a1a) : 0x5aff4a;
          fx.emit(hp.x, hp.y, hp.z, { color: col, count: 1, speed: 0.4, vy: 0.9, life: 0.5, size: 0.16 });
        }
      }
      const slow = Math.min(0.75, Math.max(now < e.slowUntil ? e.slowAmt : 0, e.aSlow));
      const stunned = now < e.stunUntil;
      if (slow > 0 && Math.random() < dt * 4) {
        const hp = this.hitPoint(e);
        fx.emit(hp.x, hp.y + 0.1, hp.z, { color: 0xbfefff, count: 1, speed: 0.3, vy: -0.3, life: 0.6, size: 0.1 });
      }
      const sp = stunned ? 0 : e.speed * (1 - slow);
      this.advance(e, sp * dt);
      e.animT += dt * (stunned ? 0 : 0.4 + 0.6 * (1 - slow)) * (e.speed / 1.9);
      e.art.anim(e.animT);
      e.art.tint({ poison: now < e.poisonUntil, slow: slow > 0, burn: now < e.burnUntil || (e.aBurn > 0 && !e.rad), rad: e.rad, stun: stunned, shred: e.shred > 0 }, now);
      if (stunned && Math.random() < dt * 6) {
        const hp = this.hitPoint(e);
        fx.emit(hp.x, hp.y + 0.35, hp.z, { color: 0xfff08a, count: 1, speed: 0.6, life: 0.4, size: 0.12 });
      }
    }

    // gems attack
    for (const g of this.gems.values()) {
      if (g.kind !== 'gem') continue;
      g.cd -= dt * 1000 * (g.speedMult || 1);
      if (g.cd > 0) continue;
      const s = gemStats(g);
      const targets = this.findTargets(g, s);
      if (!targets.length) { g.cd = 0; continue; }
      g.cd += s.cd;
      if (g.cd < 0) g.cd = 0;
      this.fire(g, s, targets);
    }

    // clean up and finish
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        e.fade += dt * 3;
        e.art.root.scale.setScalar(Math.max(0.01, 1 - e.fade));
        e.art.root.position.y = e.y + e.fade * 0.3;
        if (e.fade >= 1) { this.view.scene.remove(e.art.root); e.art.dispose(); this.enemies.splice(i, 1); }
      }
    }
    if (!this.spawnQueue.length && !this.enemies.length) this.endWave();
  }

  advance(e, d) {
    e.dist += d;
    const L = e.lens, P = e.pts;
    while (e.seg < P.length - 2 && e.dist > L[e.seg + 1]) e.seg++;
    if (e.dist >= L[L.length - 1]) { this.leak(e); return; }
    const a = P[e.seg], b = P[e.seg + 1];
    const f = (e.dist - L[e.seg]) / (L[e.seg + 1] - L[e.seg]);
    // ease the corners a little by blending toward the next leg
    e.x = a.x + (b.x - a.x) * f + e.off.x;
    e.z = a.z + (b.z - a.z) * f + e.off.z;
    const want = Math.atan2(-(b.z - a.z), b.x - a.x);
    let dh = want - e.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    e.heading += dh * Math.min(1, 0.2 + d * 6);
    const r = e.art.root;
    r.position.set(e.x, e.y, e.z);
    r.rotation.y = e.heading;
    if (e.flying) e.art.shadow.position.y = -e.y + 0.03;
    // bar faces the camera: undo the body's yaw
    e.art.bar.quaternion.copy(r.quaternion).invert().multiply(this.view.camera.quaternion);
    // fade in out of the cave mouth
    const vis = Math.min(1, e.dist / 1.2);
    r.scale.setScalar(e.dead ? r.scale.x : Math.max(0.05, vis));
  }

  leak(e) {
    if (e.dead) return;
    e.dead = true;
    e.fade = 0.6;
    this.lives -= e.leak;
    this.stats.leaked++;
    sfx('leak');
    this.view.fx.emit(e.x, 1, e.z, { color: 0x8a6aff, count: 30, speed: 2, life: 0.8, size: 0.25 });
    this.msg(`An enemy escaped! -${e.leak} ${e.leak > 1 ? 'lives' : 'life'}`, 'bad');
    if (this.view.onEvent) this.view.onEvent('leak');
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'over';
      this.msg('The gems have fallen.', 'bad');
      if (this.view.onEvent) this.view.onEvent('gameover');
    }
    this.changed();
  }

  endWave() {
    const bonus = roundGold(this.wave);
    this.gold += bonus;
    sfx('coin');
    this.msg(`Wave ${this.wave} cleared! +${bonus} gold`, 'good');
    this.view.fx.clear();
    if (this.wave === FINAL_WAVE && !this.endless) {
      this.wave++;
      this.phase = 'won';
      if (this.view.onEvent) this.view.onEvent('victory');
      this.changed();
      return;
    }
    this.wave++;
    this.phase = 'build';
    this.placesLeft = GEMS_PER_ROUND;
    this.changed();
  }

  continueEndless() {
    this.endless = true;
    this.phase = 'build';
    this.placesLeft = GEMS_PER_ROUND;
    this.changed();
  }

  findTargets(g, s) {
    const rr = R(s.range);
    const want = s.targets || 1;
    const inRange = e => !e.dead && e.dist > 0.8 && !(s.groundOnly && e.flying) && !(s.airOnly && !e.flying) && Math.hypot(e.x - g.x, e.z - g.z) <= rr;
    const out = [];
    if (g.target && inRange(g.target)) out.push(g.target);
    if (out.length < want) {
      const c = this.enemies.filter(e => inRange(e) && e !== g.target).sort((a, b) => b.dist - a.dist);
      for (const e of c) { if (out.length >= want) break; out.push(e); }
    }
    g.target = out[0] || null;
    return out;
  }

  rollDamage(g, s) {
    let d = rnd(s.dmg[0], s.dmg[1]) * (g.dmgMult || 1);
    let crit = false;
    if (s.crit && Math.random() < s.crit) { d *= s.critMult; crit = true; }
    return { d, crit };
  }

  // Apply damage. `pure` skips armor (poison, burn, auras).
  damage(e, amount, g, pure) {
    if (e.dead) return 0;
    if (!pure) amount *= armorFactor(e.armor - e.shred);
    e.hp -= amount;
    if (g) g.dmgDone += amount;
    e.art.setHp(e.hp / e.maxHp);
    if (e.hp <= 0) this.kill(e, g);
    return amount;
  }

  kill(e, g) {
    e.dead = true;
    e.fade = 0;
    this.stats.kills++;
    let gold = killGold(this.wave);
    if (g) {
      g.kills++;
      const s = gemStats(g);
      if (s.bonusGold) gold += s.bonusGold;
    }
    if (e.boss) gold *= 10;
    this.gold += gold;
    const hp = this.hitPoint(e);
    const fx = this.view.fx;
    fx.emit(hp.x, hp.y, hp.z, { color: e.boss ? 0xff7a2a : 0xff4a4a, count: e.boss ? 90 : 22, speed: e.boss ? 4 : 2.2, life: 0.7, size: 0.18, gravity: 4 });
    fx.emit(hp.x, hp.y + 0.2, hp.z, { color: 0xffd84a, count: e.boss ? 30 : 5, speed: 1.2, vy: 1.5, life: 0.8, size: 0.14, gravity: 3 });
    if (e.boss) { fx.wave(e.x, e.z, 3, 0xff7a2a, { dur: 1 }); fx.text(hp.x, hp.y + 0.6, hp.z, `+${Math.round(gold)}`, '#ffd84a', 0.7); sfx('boom'); }
    sfx('death');
    this.changed();
  }

  fire(g, s, targets) {
    const fx = this.view.fx;
    const from = { x: g.x, y: 0.78, z: g.z };
    const type = g.special || g.type;
    g.art.flash();
    const col = g.special ? SPECIALS[g.special].color : GEM_TYPES[g.type].color;
    sfx(g.special ? 'special' : g.type);
    for (const e of targets) {
      const tp = () => (e.dead ? null : this.hitPoint(e));
      const hit = (fn) => (alive, at) => fn(alive, at);
      switch (type) {
        case 'ruby':
        case 'bloodStone':
          fx.projectile(from, tp, {
            color: type === 'ruby' ? 0xff5a2a : 0xff2a1a, size: type === 'ruby' ? 0.35 : 0.5, speed: 9, arc: 2, trail: 1,
            onHit: hit((alive, at) => this.splashHit(g, s, alive ? e : null, at, type === 'ruby' ? 0xff6a2a : 0xff2a1a)),
          });
          break;
        case 'topaz':
          fx.lightning(from, this.hitPoint(e), 0xffe45a, { segs: 6, jag: 0.22, width: 0.03 });
          fx.emit(e.x, e.y + 0.3, e.z, { color: 0xffe45a, count: 5, speed: 2, life: 0.3, size: 0.12 });
          this.strike(g, s, e);
          break;
        case 'aquamarine':
          fx.projectile(from, tp, {
            color: 0x5afff0, size: 0.18, speed: 18, trail: 0.6,
            onHit: hit((alive, at) => { fx.emit(at.x, at.y, at.z, { color: 0x7affff, count: 4, speed: 1.5, life: 0.25, size: 0.1 }); if (alive) this.strike(g, s, e); }),
          });
          break;
        case 'sapphire':
          fx.projectile(from, tp, {
            color: 0x4a8aff, size: 0.3, speed: 12, trail: 1,
            onHit: hit((alive, at) => {
              fx.emit(at.x, at.y, at.z, { color: 0xbfe6ff, count: 10, speed: 1.8, life: 0.5, size: 0.12, gravity: 2 });
              if (alive) { this.strike(g, s, e); this.applySlow(e, s.slow, s.slowDur); }
            }),
          });
          break;
        case 'diamond':
        case 'pinkDiamond':
        case 'redCrystal': {
          const c = type === 'diamond' ? 0xffffff : type === 'pinkDiamond' ? 0xff8ad8 : 0xff2a3a;
          fx.beam(from, this.hitPoint(e), c, { width: type === 'diamond' ? 0.035 : 0.06, dur: 0.18 });
          fx.emit(e.x, e.y + 0.3, e.z, { color: c, count: 6, speed: 1.6, life: 0.3, size: 0.13 });
          this.strike(g, s, e);
          break;
        }
        case 'amethyst':
          fx.projectile(from, tp, {
            color: 0xff6ae0, size: 0.3, speed: 11, arc: 3, trail: 1,
            onHit: hit((alive, at) => { fx.emit(at.x, at.y, at.z, { color: 0xff8ae8, count: 10, speed: 2, life: 0.4, size: 0.14 }); if (alive) this.strike(g, s, e); }),
          });
          break;
        case 'opal':
          fx.projectile(from, tp, {
            color: 0xb0ffe8, size: 0.28, speed: 10, trail: 0.8,
            onHit: hit((alive, at) => { fx.emit(at.x, at.y, at.z, { color: 0xc8fff0, count: 6, speed: 1.2, life: 0.4, size: 0.12 }); if (alive) this.strike(g, s, e); }),
          });
          break;
        case 'emerald':
        case 'jade':
          fx.projectile(from, tp, {
            color: type === 'jade' ? 0x3adf9a : 0x3aff5a, size: 0.3, speed: 10, arc: 1.5, trail: 1,
            onHit: hit((alive, at) => {
              fx.emit(at.x, at.y, at.z, { color: 0x5aff5a, count: 10, speed: 1.4, life: 0.6, size: 0.14, gravity: 1.5 });
              if (!alive) return;
              this.strike(g, s, e);
              this.applyPoison(e, s.poison, type === 'jade' ? 4 : s.slowDur, g);
              this.applySlow(e, s.slow, s.slowDur);
            }),
          });
          break;
        case 'malachite':
          fx.lightning(from, this.hitPoint(e), 0x3aff9a, { segs: 4, jag: 0.12, width: 0.022 });
          this.strike(g, s, e);
          break;
        case 'silver':
        case 'yellowSapphire':
          fx.projectile(from, tp, {
            color: type === 'silver' ? 0xe0e8f0 : 0xffe84a, size: 0.34, speed: 11, trail: 1,
            onHit: hit((alive, at) => this.splashSlowHit(g, s, alive ? e : null, at, type === 'silver' ? 0xdfefff : 0xfff08a)),
          });
          break;
        case 'starRuby':
          fx.beam(from, this.hitPoint(e), 0xff4a2a, { width: 0.05, dur: 0.1 });
          this.strike(g, s, e);
          break;
        case 'blackOpal':
          fx.beam(from, this.hitPoint(e), 0x8a6aff, { width: 0.06, dur: 0.25 });
          fx.beam(from, this.hitPoint(e), 0x5affd8, { width: 0.02, dur: 0.25 });
          this.strike(g, s, e);
          break;
        case 'darkEmerald':
          fx.projectile(from, tp, {
            color: 0x1aff6a, size: 0.42, speed: 13, trail: 1,
            onHit: hit((alive, at) => {
              fx.emit(at.x, at.y, at.z, { color: 0x2aff7a, count: 14, speed: 2.2, life: 0.4, size: 0.15 });
              if (!alive) return;
              this.strike(g, s, e);
              if (Math.random() < s.stun) { e.stunUntil = Math.max(e.stunUntil, this.clock + s.stunDur); fx.text(at.x, at.y + 0.4, at.z, 'STUN', '#fff08a', 0.35); }
            }),
          });
          break;
        case 'gold':
          fx.projectile(from, tp, {
            color: 0xffc83a, size: 0.4, speed: 12, trail: 1,
            onHit: hit((alive, at) => { fx.emit(at.x, at.y, at.z, { color: 0xffd84a, count: 14, speed: 2.4, life: 0.5, size: 0.14, gravity: 3 }); if (alive) this.strike(g, s, e); }),
          });
          break;
        case 'uranium':
          fx.beam(from, this.hitPoint(e), 0xa6ff1a, { width: 0.04, dur: 0.12 });
          this.strike(g, s, e);
          break;
        case 'paraiba':
          fx.projectile(from, tp, {
            color: 0x3ae8ff, size: 0.32, speed: 14, trail: 1,
            onHit: hit((alive, at) => {
              if (alive) this.strike(g, s, e);
              if (Math.random() < s.nova) this.frostNova(g, s, at);
            }),
          });
          break;
        default:
          fx.beam(from, this.hitPoint(e), col, { width: 0.04 });
          this.strike(g, s, e);
      }
    }
  }

  strike(g, s, e) {
    if (e.dead) return;
    const { d, crit } = this.rollDamage(g, s);
    const dealt = this.damage(e, d, g, false);
    if (crit) {
      const hp = this.hitPoint(e);
      this.view.fx.text(hp.x, hp.y + 0.4, hp.z, `${Math.round(dealt)}!`, s.critMult >= 5 ? '#ff8ad8' : '#ffffff', s.critMult >= 5 ? 0.6 : 0.45);
      sfx('crit');
    }
    if (s.burn) { e.burnDps = Math.max(this.clock < e.burnUntil ? e.burnDps : 0, s.burn * (g.dmgMult || 1)); e.burnUntil = this.clock + s.burnDur; e.dotSource = g; }
  }

  splashHit(g, s, e, at, col) {
    const fx = this.view.fx;
    const rad = R(s.splash);
    fx.emit(at.x, at.y, at.z, { color: col, count: 26, speed: 3, life: 0.5, size: 0.22, gravity: 2 });
    fx.emit(at.x, at.y, at.z, { color: 0x3a2a2a, count: 8, speed: 1, vy: 1, life: 0.9, size: 0.3 });
    fx.wave(at.x, at.z, rad, col, { dur: 0.45 });
    sfx('boom');
    if (e) this.strike(g, s, e);
    const { d } = this.rollDamage(g, s);
    for (const o of this.enemies) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.x - at.x, o.z - at.z) > rad) continue;
      if (Math.abs(o.y - at.y) > 1.2 && !e) continue;
      this.damage(o, d * (s.splashPct ?? 0.5), g, false);
      if (s.burn && !o.dead) { o.burnDps = Math.max(o.burnDps, s.burn * 0.5); o.burnUntil = this.clock + s.burnDur; o.dotSource = g; }
    }
  }

  splashSlowHit(g, s, e, at, col) {
    const fx = this.view.fx;
    const rad = R(s.splash);
    fx.emit(at.x, at.y, at.z, { color: col, count: 16, speed: 2, life: 0.6, size: 0.16 });
    fx.wave(at.x, at.z, rad, 0x9adfff, { dur: 0.55 });
    if (e) this.strike(g, s, e);
    for (const o of this.enemies) {
      if (o.dead) continue;
      if (Math.hypot(o.x - at.x, o.z - at.z) > rad) continue;
      this.applySlow(o, s.splashSlow, s.slowDur);
    }
  }

  frostNova(g, s, at) {
    const fx = this.view.fx;
    const rad = R(s.novaRadius);
    fx.wave(at.x, at.z, rad, 0x8af0ff, { dur: 0.7 });
    fx.wave(at.x, at.z, rad * 0.7, 0xffffff, { dur: 0.5, disc: true, alpha: 0.35 });
    fx.emit(at.x, 0.3, at.z, { color: 0xcff8ff, count: 40, speed: 4, life: 0.7, size: 0.16, upward: 0.4 });
    sfx('nova');
    for (const o of this.enemies) {
      if (o.dead) continue;
      if (Math.hypot(o.x - at.x, o.z - at.z) > rad) continue;
      this.damage(o, s.novaDmg * (g.dmgMult || 1), g, true);
      this.applySlow(o, 0.3, 2);
    }
  }

  applySlow(e, amt, dur) {
    if (!amt || e.dead) return;
    const now = this.clock;
    if (now >= e.slowUntil || amt >= e.slowAmt) {
      e.slowAmt = now >= e.slowUntil ? amt : Math.max(amt, e.slowAmt);
      e.slowUntil = Math.max(e.slowUntil, now + dur);
    }
  }
  applyPoison(e, dps, dur, g) {
    if (!dps || e.dead) return;
    const now = this.clock;
    if (now >= e.poisonUntil || dps >= e.poisonDps) {
      e.poisonDps = dps * (g.dmgMult || 1);
      e.poisonUntil = now + dur;
      e.dotSource = g;
    }
  }

  // The gem's damage per second, as a quick yardstick for the info panel.
  dps(g) {
    const s = gemStats(g);
    const avg = (s.dmg[0] + s.dmg[1]) / 2 * (g.dmgMult || 1);
    const critK = s.crit ? 1 + s.crit * (s.critMult - 1) : 1;
    return avg * critK * (s.targets || 1) * 1000 / (s.cd / (g.speedMult || 1));
  }
}

function cumulative(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return out;
}
