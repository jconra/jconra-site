// THE TOWN. The projects world at the end of the intro: a town of blocks on a green plain with
// forest all round, seen from a bird's-eye camera behind the fighter as it skims over it. Every
// roof carries a project's screenshot; hovering one (or tapping it) gives its card, clicking it
// opens the project. The forest is tiles of trees that are re-laid around the fighter as it goes,
// so it never ends. Everything is in metres, the town's centre at the origin, +y up.
import * as THREE from 'three';
import { Forest } from './forest.js';
import { groundMaterial } from './ground.js';
import { Understory } from './understory.js';
import { shutFighter } from './hangarSet.js';

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
    const t = loader.load(`../../textures/projects/${project.img}.jpg`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
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

function wallTexture(seed) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d'), r = rnd(seed);
  const tone = 150 + Math.floor(r() * 60);
  g.fillStyle = `rgb(${tone},${tone + 4},${tone + 10})`; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(30,40,60,0.85)';
  for (let y = 18; y < 256; y += 32) for (let x = 12; x < 256; x += 30) if (r() < 0.85) g.fillRect(x, y, 18, 20);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function buildTown(parts, projects, { shipLength = 7, renderer, origin = new THREE.Vector3(), light = false } = {}) {
  const floor = new THREE.Group();
  const loader = new THREE.TextureLoader();

  // GROUND: the plain, and pavement under the town
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMaterial({ clearing: { x: origin.x, z: origin.z, radius: TOWN_R } }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; floor.add(ground);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(ROAD * 7, ROAD * 7), new THREE.MeshStandardMaterial({ color: 0x5b6169, roughness: 0.95 }));
  pave.rotation.x = -Math.PI / 2; pave.position.y = 0.05; floor.add(pave);
  // road lines between the lots
  { const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xd8d8c8, roughness: 0.9 });
    for (let i = -3; i <= 3; i++) { const a = new THREE.Mesh(new THREE.PlaneGeometry(ROAD * 7, 0.8), m); a.rotation.x = -Math.PI / 2; a.position.set(0, 0.08, i * ROAD + ROAD / 2); g.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.8, ROAD * 7), m); b.rotation.x = -Math.PI / 2; b.position.set(i * ROAD + ROAD / 2, 0.08, 0); g.add(b); }
    floor.add(g); }

  // BUILDINGS: one per project, spiralling out from the centre, roof = the screenshot
  const buildings = [], lots = spiral(projects.length), r = rnd(31);
  projects.forEach((pr, i) => {
    const [lx, lz] = lots[i], h = 14 + r() * 26;
    const walls = new THREE.MeshStandardMaterial({ map: wallTexture(i * 7 + 3), roughness: 0.8 });
    walls.map.repeat.set(2, Math.max(1, Math.round(h / 12)));
    const roof = new THREE.MeshStandardMaterial({ map: roofTexture(pr, loader), roughness: 0.6 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(LOT[0], h, LOT[1]), [walls, walls, roof, floorMat, walls, walls]);
    b.position.set(lx * ROAD, h / 2, lz * ROAD); b.castShadow = b.receiveShadow = true;
    b.userData.project = pr; floor.add(b); buildings.push(b);
    // a rim round the roof, so the picture reads as something laid on the building: its top a
    // hand's width below the roof, so the two never share a plane
    const rim = new THREE.Mesh(new THREE.BoxGeometry(LOT[0] + 1.6, 1.2, LOT[1] + 1.6), new THREE.MeshStandardMaterial({ color: 0x2a2f36 }));
    rim.position.set(lx * ROAD, h - 0.75, lz * ROAD); floor.add(rim);
  });

  // FOREST: the imposter forest, laid out on tiles around the fighter; the town's circle kept clear
  const forest = new Forest(renderer, floor, { base: '../../models/trees/', light, tile: 420, tiles: 7, perTile: light ? 120 : 220, imposterAt: light ? 0 : 140, band: 40, grid: light ? 8 : 12, cell: 192, detail: 'coarse', shadows: false,
    clear: (x, z) => Math.hypot(x, z) < TOWN_R, sunDir: new THREE.Vector3(0.5, 1, 0.3) });
  const relay = () => {};
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
    floor, jet, buildings, state, clouds, forest,
    // every frame, whatever set is showing: the forest bakes, re-lays its tiles round the fighter and sorts near from far
    frame(camera, target) { const cp = floor.worldToLocal(camera.position.clone()); forest.update({ position: cp }, floor.worldToLocal(target.clone()), state.pos); understory.update(state.pos, cp); },
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
