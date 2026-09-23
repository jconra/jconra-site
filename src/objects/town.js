// THE TOWN. The projects world at the end of the intro: a town of blocks on a green plain with
// forest all round, seen from a bird's-eye camera behind the fighter as it skims over it. Every
// roof carries a project's screenshot; hovering one (or tapping it) gives its card, clicking it
// opens the project. The forest is tiles of trees that are re-laid around the fighter as it goes,
// so it never ends. Everything is in metres, the town's centre at the origin, +y up.
import * as THREE from 'three';
import { Forest } from './forest.js';
import { groundMaterial } from './ground.js';
import { Understory } from './understory.js';
import { ForceField } from './forceField.js';
import { classTexture } from './townLayout.js';
import { shutFighter } from './hangarSet.js';
import { makeBuilding, autoStyle } from './buildings.js';

const ROAD = 62;            // pitch of the grid the buildings stand on
const LOT = [36, 27];       // a building's footprint, 4:3 like the screenshots
const TILE = 420;           // forest tile
const TILES = 5;            // tiles across (odd, the fighter's tile in the middle)
const TOWN_R = 250;         // no trees this close to the centre

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// the lots, spiralling out from the centre so the first projects are nearest the landing
function spiral(n) {
  const out = [[0, 0]]; let x = 0, z = 0, dx = 1, dz = 0, len = 1, step = 0, turns = 0;
  while (out.length < n) {
    x += dx; z += dz; out.push([x, z]); step++;
    if (step === len) { step = 0; [dx, dz] = [-dz, dx]; turns++; if (turns % 2 === 0) len++; }
  }
  return out;
}

// a roof with the picture on it, or the name set in type when there is no picture
// (the box's top face has its picture upside down to a camera coming in over the forest, so it is turned round)
const upright = (t) => { t.center.set(0.5, 0.5); t.rotation = Math.PI; return t; };
function roofTexture(project, loader) {
  if (project.img) {
    const t = loader.load(`/textures/projects/${project.img}.jpg`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return upright(t);
  }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 384; const g = cv.getContext('2d');
  g.fillStyle = project.colour || '#1c2733'; g.fillRect(0, 0, 512, 384);
  g.fillStyle = '#35e07d'; g.font = 'bold 54px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'center';
  const words = project.name.split(' '); let line = '', lines = [];
  for (const w of words) { if ((line + ' ' + w).trim().length > 14) { lines.push(line); line = w; } else line = (line ? line + ' ' : '') + w; }
  lines.push(line);
  lines.forEach((l, i) => g.fillText(l, 256, 192 + (i - (lines.length - 1) / 2) * 64 + 18));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return upright(t);
}

export function buildTown(parts, projects, { shipLength = 7, renderer, origin = new THREE.Vector3(), light = false, layout = null } = {}) {
  const floor = new THREE.Group();
  const loader = new THREE.TextureLoader();

  // GROUND: the plain, and pavement under the town
  // the drawn layout: the JSON places the buildings and the fence; the picture, when there is one, paints the ground
  const drawn = layout ? { map: layout.map ? classTexture(layout.map, 'A') : null, map2: layout.map ? classTexture(layout.map, 'B') : null, metres: layout.metres } : null;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMaterial({ clearing: { x: origin.x, z: origin.z, radius: drawn && drawn.map ? 0.01 : TOWN_R }, light, layout: drawn && drawn.map ? drawn : null }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; floor.add(ground);
  // without a drawn layout: the old paved square with road lines between the lots
  if (!drawn || !drawn.map) {
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(ROAD * 7, ROAD * 7), new THREE.MeshStandardMaterial({ color: 0x5b6169, roughness: 0.95 }));
    pave.rotation.x = -Math.PI / 2; pave.position.y = 0.05; floor.add(pave);
    const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xd8d8c8, roughness: 0.9 });
    for (let i = -3; i <= 3; i++) { const a = new THREE.Mesh(new THREE.PlaneGeometry(ROAD * 7, 0.8), m); a.rotation.x = -Math.PI / 2; a.position.set(0, 0.08, i * ROAD + ROAD / 2); g.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.8, ROAD * 7), m); b.rotation.x = -Math.PI / 2; b.position.set(i * ROAD + ROAD / 2, 0.08, 0); g.add(b); }
    floor.add(g);
  }

  // BUILDINGS: one per project, spiralling out from the centre, roof = the screenshot
  // the lots: the drawn rectangles in order (a project each; extra projects go unbuilt), else the spiral
  const buildings = [], lots = spiral(projects.length), r = rnd(31);
  const drawnLots = drawn ? layout.buildings : null;
  projects.forEach((pr, i) => {
    if (drawnLots && i >= drawnLots.length) return;
    const lot = drawnLots ? drawnLots[i] : null;
    const [lx, lz] = lots[i];
    const W = lot ? lot.w : LOT[0], Dp = lot ? lot.d : LOT[1], cx = lot ? lot.x : lx * ROAD, cz = lot ? lot.z : lz * ROAD;
    // the style: set on the map, else by the lot's size (the spiral's lots take turns)
    const style = (lot && lot.style && lot.style !== 'auto') ? lot.style : lot ? autoStyle(W, Dp) : ['office', 'apartments', 'house'][i % 3];
    const roof = new THREE.MeshStandardMaterial({ map: roofTexture(pr, loader), roughness: 0.6 });
    const { group, body } = makeBuilding({ style, variant: lot && lot.variant, w: W, d: Dp, roofMat: roof, seed: i + 1 });
    // turned round so doors, porches and yards face north, where the fighter comes from; the roof
    // picture's own half turn is taken back so it still reads the right way up from there
    group.position.set(cx, 0, cz); group.rotation.y = Math.PI; roof.map.rotation = 0;
    body.userData.project = pr; floor.add(group); buildings.push(body);
  });

  // FOREST: the imposter forest, laid out on tiles around the fighter; the town's circle kept clear
  const forest = new Forest(renderer, floor, { base: '/models/trees/', light, tile: 420, tiles: 7, perTile: light ? 120 : 220, imposterAt: light ? 0 : 140, band: 40, grid: light ? 8 : 12, cell: 192, detail: 'coarse', shadows: false,
    clear: (x, z) => Math.hypot(x, z) < TOWN_R, sunDir: new THREE.Vector3(0.5, 1, 0.3) });
  const relay = () => {};
  // THE FENCE: the force field round the town, an octagon of emitter posts just inside the tree line
  const fence = (() => {
    const f = drawn ? layout.fence : [];
    const runs = f.length && Array.isArray(f[0]) ? f : (f.length > 1 ? [f] : []);     // an old single loop reads as one run
    if (runs.length) return new ForceField({ runs: runs.map(r => r.map(p => new THREE.Vector3(p.x, 0, p.z))), height: 12, postEvery: 36 });
    const c = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; c.push(new THREE.Vector3(Math.sin(a) * (TOWN_R - 22), 0, Math.cos(a) * (TOWN_R - 22))); }
    return new ForceField({ corners: c, height: 12, postEvery: 36 }); })();
  floor.add(fence.group);
  const understory = new Understory(floor, { clear: (x, z) => Math.hypot(x, z) < TOWN_R, reach: light ? 160 : 260, perTile: light ? 120 : 260 });

  // THE FIGHTER
  const F = parts.ship1, jet = new THREE.Group();
  const body = shutFighter(F, { metres: shipLength }); body.position.y -= 1.5;      // canopy shut for the flight
  jet.add(body); floor.add(jet);
  const state = { pos: new THREE.Vector3(0, 56, -900), heading: 0, speed: 46, bank: 0, turn: 0, alt: 56 };   // above the tallest roof
  const fwd = () => new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const place = () => {
    jet.position.copy(state.pos);
    jet.rotation.set(0, state.heading, 0); jet.rotateY(-Math.PI / 2);         // the part's nose is +x; heading 0 is +z (turning +x onto +z is a -90 about y)
    jet.rotateX(state.bank);
  };

  // CLOUDS to come down through at the start: planes round the way in, faded out over the first seconds
  const cloudTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); let seed = 9; const rr = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 24; i++) { const x = 60 + rr() * 136, y = 90 + rr() * 90, ra = 24 + rr() * 34, k = g.createRadialGradient(x, y, 0, x, y, ra); k.addColorStop(0, 'rgba(255,255,255,0.95)'); k.addColorStop(0.55, 'rgba(240,244,250,0.55)'); k.addColorStop(1, 'rgba(230,236,245,0)'); g.fillStyle = k; g.fillRect(0, 0, 256, 256); }
    const t = new THREE.CanvasTexture(cv); return t; })();
  const clouds = [];
  { const rr = rnd(5);
    for (let i = 0; i < 50; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 1 }));
      c.position.set((rr() - 0.5) * 500, 40 + rr() * 90, -900 + (rr() - 0.5) * 700); c.scale.setScalar(70 + rr() * 90);
      floor.add(c); clouds.push(c);
    } }

  return {
    floor, jet, buildings, state, clouds, forest, fence,
    // every frame, whatever set is showing: the forest bakes, re-lays its tiles round the fighter and sorts near from far
    frame(camera, target, dt = 1 / 60) { const cp = floor.worldToLocal(camera.position.clone()); forest.update({ position: cp }, floor.worldToLocal(target.clone()), state.pos); understory.update(state.pos, cp); fence.update(dt); },
    // the fighter's way, and a point ahead of it to look at
    forward: fwd,
    lookAhead(d = 26) { return state.pos.clone().addScaledVector(fwd(), d); },
    // one step of the flight: `input` is { dest: Vector3 | null, turn: -1..1, throttle: -1..1 }
    update(dt, input = {}) {
      let want = state.heading;
      if (input.dest) {
        const d = input.dest.clone().sub(state.pos); d.y = 0;
        if (d.length() > 12) want = Math.atan2(d.x, d.z); else input.dest = null;
      }
      let turn = input.turn || 0;
      if (!turn && input.dest) { let e = want - state.heading; e = Math.atan2(Math.sin(e), Math.cos(e)); turn = THREE.MathUtils.clamp(e * 2.2, -1, 1); }
      state.turn += (turn - state.turn) * Math.min(1, dt * 6);
      state.heading += state.turn * 1.4 * dt;
      state.speed = THREE.MathUtils.clamp(state.speed + (input.throttle || 0) * 30 * dt, 25, 90);
      state.bank += (-state.turn * 0.75 - state.bank) * Math.min(1, dt * 4);
      state.pos.addScaledVector(fwd(), state.speed * dt);
      // the burner answers the throttle: idling at cruise, full when pushed, a glow when eased off
      const bn = body.userData.burner; if (bn) { bn.setThrust(input.throttle > 0 ? 1 : input.throttle < 0 ? 0.15 : 0.45 + 0.4 * (state.speed - 25) / 65); bn.update(dt); }
      state.pos.y = state.alt + Math.sin(performance.now() * 0.0012) * 0.6;
      place(); relay(state.pos.x, state.pos.z);
    },
    // the flight as a function of time for the scrubbable part: straight in over the town
    poseAt(t) { const bn = body.userData.burner; if (bn) { bn.setThrust(0.7); bn.update(1 / 60); } state.pos.set(0, state.alt, -900 + 46 * t); state.heading = 0; state.bank = 0; state.turn = 0; place(); relay(state.pos.x, state.pos.z); },
    // the clouds: 1 = solid, 0 = gone
    setCloud(k) { for (const c of clouds) { c.material.opacity = THREE.MathUtils.clamp(k, 0, 1); c.visible = k > 0.01; } },
    faceClouds(camera) { for (const c of clouds) c.quaternion.copy(camera.quaternion); },
    // the building under a ray, if any
    pick(raycaster) { const hit = raycaster.intersectObjects(buildings, false)[0]; return hit ? hit.object : null; },
    groundPoint(raycaster) { const hit = raycaster.intersectObject(ground, false)[0]; return hit ? hit.point : null; },
  };
}
