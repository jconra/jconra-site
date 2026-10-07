// THE FIGHTER OVER THE VALLEY (the jconra.com film's last set, src/valley.js's village): the jet comes down through the
// clouds into the open west end of the valley and flies on, skimming the land: its height follows the ground and the
// treetops ahead of it (never below CRUISE over the flat), so it climbs over a ridge and drops back over a meadow. Sent
// somewhere (a tap on the ground, or the tour), it turns, flies there, eases in and stops; held, it chases the point
// under the finger; W thrusts, S brakes, A/D turn. Near the land's edge it is turned back toward the middle.
//
//   valleyFlight({ V, parts }) -> { jet, state, poseAt(t, dur), update(dt, input), forward(), lookAhead(d), setCloud(k),
//     faceClouds(camera), groundPoint(raycaster), groundAt(x, z), forest, liveFrom }
//     V: makeValley's valley (the jet and its clouds go into V.scene); parts: the station kit's parts (parts.ship1)
//     input: { dest: Vector3 | null, holding, turn: -1..1, throttle: -1..1 } (dest is cleared on arrival, unless holding)
import * as THREE from 'three';
import { shutFighter } from './hangarSet.js';

const CRUISE = 30;                   // the lowest it flies over the flat, in the valley's metres (the town hall's roof is 15)
const CLEAR = { ground: 18, trees: 9, ahead: [0, 25, 55, 90] };   // how far over the ground and over the treetops, looked for this far ahead
const EDGE = 640;                    // past this (of the land's 800 either way) it is turned back toward the middle
// the way in: down the open west end, heading east (+x), easing to a stop short of the town (the RMRF hangar's west)
const ARRIVE = { from: new THREE.Vector3(-620, 100, -205), to: new THREE.Vector3(-235, 46, -212) };

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function valleyFlight({ V, parts, shipLength = 7 }) {
  const group = new THREE.Group(); group.name = 'valleyFlight'; V.scene.add(group);
  const jet = new THREE.Group(), body = shutFighter(parts.ship1, { metres: shipLength }); body.position.y -= 1.5;   // canopy shut for the flight
  // its own copies of the fighter's materials: the kit's are shared with the fighters in space, and the valley patches every
  // plain lit material in its scene (the hill's shadow, the lamps), which would leak out to them and rebuild their shaders
  { const mine = new Map(); body.traverse((o) => { if (o.isMesh && o.material && !o.material.isShaderMaterial) { if (!mine.has(o.material)) mine.set(o.material, o.material.clone()); o.material = mine.get(o.material); } }); }
  jet.add(body); group.add(jet);
  const heading0 = Math.atan2(ARRIVE.to.x - ARRIVE.from.x, ARRIVE.to.z - ARRIVE.from.z);
  const state = { pos: ARRIVE.from.clone(), heading: heading0, speed: 0, bank: 0, turn: 0, alt: ARRIVE.to.y };
  const fwd = () => new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const place = () => {
    jet.position.copy(state.pos);
    jet.rotation.set(0, state.heading, 0); jet.rotateY(-Math.PI / 2);         // the part's nose is +x; heading 0 is +z
    jet.rotateX(state.bank);
  };

  // THE TREETOPS, on a 10 m grid (the highest top in each cell), from the forest's own trees once it has laid them (each its
  // species' height times its size), and the land's tree spots until then (a generous 24 m a tree)
  const TG = { cell: 10, n: Math.ceil(V.SIZE / 10), tops: null, from: null };
  const treeTops = () => {
    const f = V.treeForest, src = f && f.ready && f.fixed ? f : null;
    if (TG.tops && TG.from === (src || V.trees)) return TG.tops;
    const n = TG.n, tops = new Float32Array(n * n).fill(-1e9), cellOf = (x, z) => Math.min(n - 1, Math.max(0, Math.floor((z + V.SIZE / 2) / TG.cell))) * n + Math.min(n - 1, Math.max(0, Math.floor((x + V.SIZE / 2) / TG.cell)));
    if (src) for (const t of src.fixed) { const sp = src.species[t.sp], k = cellOf(t.x, t.z), y = V.heightAt(t.x, t.z) + (sp ? sp.height : 22) * (t.scale || 1); if (y > tops[k]) tops[k] = y; }
    else for (const t of V.trees) { const k = cellOf(t[0], t[2]), y = t[1] + 24 * t[3]; if (y > tops[k]) tops[k] = y; }
    TG.tops = tops; TG.from = src || V.trees; return tops;
  };
  const topAt = (x, z) => { const n = TG.n, t = treeTops(); return t[Math.min(n - 1, Math.max(0, Math.floor((z + V.SIZE / 2) / TG.cell))) * n + Math.min(n - 1, Math.max(0, Math.floor((x + V.SIZE / 2) / TG.cell)))]; };
  // how high to be here: over the ground and the treetops along the way ahead, never under CRUISE
  const wantAlt = (pos, dir) => {
    let y = CRUISE;
    for (const d of CLEAR.ahead) { const x = pos.x + dir.x * d, z = pos.z + dir.z * d; y = Math.max(y, V.heightAt(x, z) + CLEAR.ground, topAt(x, z) + CLEAR.trees); }
    return y;
  };

  // CLOUDS to come down through at the start: planes round the way in, faded out over the first seconds
  const cloudTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'), rr = rnd(9);
    for (let i = 0; i < 24; i++) { const x = 60 + rr() * 136, y = 90 + rr() * 90, ra = 24 + rr() * 34, k = g.createRadialGradient(x, y, 0, x, y, ra); k.addColorStop(0, 'rgba(255,255,255,0.95)'); k.addColorStop(0.55, 'rgba(240,244,250,0.55)'); k.addColorStop(1, 'rgba(230,236,245,0)'); g.fillStyle = k; g.fillRect(0, 0, 256, 256); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 1, fog: false });
  const clouds = [];
  { const rr = rnd(5), along = ARRIVE.to.clone().sub(ARRIVE.from).setY(0).normalize(), side = new THREE.Vector3(-along.z, 0, along.x);
    for (let i = 0; i < 50; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloudMat);
      c.position.copy(ARRIVE.from).addScaledVector(along, -160 + rr() * 420).addScaledVector(side, (rr() - 0.5) * 420); c.position.y = ARRIVE.from.y - 20 + rr() * 110;
      c.scale.setScalar(70 + rr() * 90); c.renderOrder = 3; group.add(c); clouds.push(c);
    } }

  const flight = {
    jet, state, clouds, liveFrom: false,
    get forest() { return V.treeForest; },
    forward: fwd,
    lookAhead(d = 26) { return state.pos.clone().addScaledVector(fwd(), d); },
    groundAt: (x, z) => V.heightAt(x, z),
    // one step of the live flight (see the top)
    update(dt, input = {}) {
      let want = state.heading, wantSpeed = 0, dist = 0;
      if (input.dest) {
        input.dest.x = THREE.MathUtils.clamp(input.dest.x, -EDGE, EDGE); input.dest.z = THREE.MathUtils.clamp(input.dest.z, -EDGE, EDGE);   // (nowhere off the land)
        const d = input.dest.clone().sub(state.pos); d.y = 0; dist = d.length();
        if (dist > 6) want = Math.atan2(d.x, d.z);
        else if (!input.holding) input.dest = null;
      }
      let turn = input.turn || 0, facing = 1;
      if (!turn && input.dest && dist > 6) {
        let e = want - state.heading; e = Math.atan2(Math.sin(e), Math.cos(e));
        turn = THREE.MathUtils.clamp(e * 2.2, -1, 1);
        facing = Math.max(0, Math.cos(e));                     // no speed until it points roughly the right way
        wantSpeed = Math.min(input.cruise || 70, dist * 0.9) * facing;   // eases in as it arrives (cruise: the tour flies slower)
      }
      if (input.throttle > 0) wantSpeed = 70;
      if (input.throttle < 0) wantSpeed = 0;
      // the land's edge: heading out past EDGE, it is turned back toward the middle
      const out = Math.max(Math.abs(state.pos.x), Math.abs(state.pos.z)) - EDGE;
      if (out > 0) { const f = fwd(); if (f.x * state.pos.x + f.z * state.pos.z > 0) { let e = Math.atan2(-state.pos.x, -state.pos.z) - state.heading; e = Math.atan2(Math.sin(e), Math.cos(e)); turn = THREE.MathUtils.clamp(e * 2, -1, 1); } }
      state.turn += (turn - state.turn) * Math.min(1, dt * 6);
      state.heading += state.turn * 1.5 * dt;
      state.speed += (wantSpeed - state.speed) * Math.min(1, dt * (wantSpeed > state.speed ? 1.2 : 1.8));
      state.bank += (-state.turn * 0.75 * Math.min(1, 0.3 + state.speed / 40) - state.bank) * Math.min(1, dt * 4);
      const f = fwd();
      state.pos.addScaledVector(f, state.speed * dt);
      // its height: toward what the land ahead asks for, climbing quicker than it sinks
      const target = wantAlt(state.pos, f);
      state.alt += (target - state.alt) * Math.min(1, dt * (target > state.alt ? 2.2 : 0.8));
      state.alt = Math.max(state.alt, V.heightAt(state.pos.x, state.pos.z) + 6);   // (never into the ground, whatever the easing)
      const bn = body.userData.burner; if (bn) { bn.setThrust(input.throttle > 0 ? 1 : 0.12 + 0.75 * state.speed / 70); bn.update(dt); }
      state.pos.y = state.alt + Math.sin(performance.now() * 0.0012) * 0.6;
      place();
    },
    // the flight as a function of time for the scrubbable arrival: in fast from the west end, easing to a stop by `dur` s,
    // so the live flight starts there, at rest
    poseAt(t, dur = 3.5) {
      const u = THREE.MathUtils.clamp(t / dur, 0, 1), k = 1 - (1 - u) * (1 - u);
      const bn = body.userData.burner; if (bn) { bn.setThrust(0.9 * (1 - u) + 0.15); bn.update(1 / 60); }
      state.pos.lerpVectors(ARRIVE.from, ARRIVE.to, k); state.heading = heading0; state.bank = 0; state.turn = 0; state.speed = 0; state.alt = state.pos.y; place();
    },
    // the clouds: 1 = solid, 0 = gone
    setCloud(k) { cloudMat.opacity = THREE.MathUtils.clamp(k, 0, 1); for (const c of clouds) c.visible = k > 0.01; },
    faceClouds(camera) { for (const c of clouds) c.quaternion.copy(camera.quaternion); },
    // the land under a ray: marched over the heights (the ground mesh has half a million triangles)
    groundPoint(raycaster) {
      const o = raycaster.ray.origin, d = raycaster.ray.direction, H = V.SIZE / 2; let prev = 0;
      for (let t = 1; t < 4000; t += Math.max(1, t * 0.01)) {
        const x = o.x + d.x * t, z = o.z + d.z * t; if (Math.abs(x) > H || Math.abs(z) > H) { prev = t; continue; }
        if (o.y + d.y * t < V.heightAt(x, z)) { let a = prev, b = t; for (let q = 0; q < 20; q++) { const m = (a + b) / 2; if (o.y + d.y * m < V.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } return new THREE.Vector3(o.x + d.x * b, V.heightAt(o.x + d.x * b, o.z + d.z * b), o.z + d.z * b); }
        prev = t;
      }
      return null;
    },
    ARRIVE,
  };
  flight.poseAt(0);
  return flight;
}
