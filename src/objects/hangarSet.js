// HANGAR SET. The inside of one hangar at human scale, built from the same kit parts as the
// station's hangars so the cut from outside to inside keeps the shape: the hangar part scaled so
// the fighter on its deck comes out `shipLength` metres long at the same proportion the station
// uses, the fighter itself as a separate group that can roll out, and its canopy split off the hull
// so it can close. Everything is laid out in metres in a frame whose origin is the fighter's spot
// on the deck, deck at y = 0, the mouth toward +x.
import * as THREE from 'three';
import { BAYS, PARKED } from './stationKit.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { addAfterburner } from './afterburner.js';

// The open canopy of ship1 is welded to its hull. It is picked out by a WEDGE in the part's own
// units after the kit's turn to +x: everything above a line rising from the hinge toward the nose
// at `slopeDeg` (the open canopy tilts up at about 42 degrees, the hull's sill and roll bar under
// it do not), between the hinge and the nose end of the canopy. A plain box took some of the hull
// with it, which tore when the canopy swung. Measured in Blender, 2026-09-20.
const SHIP1_CANOPY = { xMin: -0.115, xMax: 0.21, hinge: { x: -0.10, y: 0.215 }, slopeDeg: 30, closeDeg: -50 };

// The fighter with its canopy SHUT, for the flights: the hull and the split-off canopy turned down
// onto the sill (the same numbers the hangar uses), in the part's own units under a group.
export function shutFighter(F, { deg = -50, drop = 0.05, slide = 0.02, metres = 7 } = {}) {
  const fu = metres / F.size.x, g = new THREE.Group();
  const { hull, canopy } = splitCanopy(F.geometry, SHIP1_CANOPY);
  const hullMesh = new THREE.Mesh(hull, F.material); hullMesh.castShadow = true;
  const canopyMesh = new THREE.Mesh(canopy, F.material); canopyMesh.castShadow = true;
  canopyMesh.position.set(SHIP1_CANOPY.hinge.x + slide / fu, SHIP1_CANOPY.hinge.y - drop / fu, 0);
  canopyMesh.rotation.z = THREE.MathUtils.degToRad(deg);
  { const pos = canopy.attributes.position, pts = []; for (let i = 0; i < pos.count; i += 2) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    const glass = new THREE.Mesh(new ConvexGeometry(pts), new THREE.MeshPhysicalMaterial({ color: 0x223a52, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    glass.renderOrder = 2; canopyMesh.add(glass); }
  g.add(hullMesh, canopyMesh); g.scale.setScalar(fu); g.position.y = -F.box.min.y * fu;
  addAfterburner(g, F);
  return g;
}

export function buildHangarSet(parts, { shipLength = 6, bayLength = 0.2, along = 0.45, hangarKind = 'hangar2', fighterKind = 'ship1' } = {}) {
  const H = parts[hangarKind], F = parts[fighterKind], bay = BAYS[hangarKind];
  const hu = shipLength / (bayLength * H.size.x);                 // metres per hangar unit, keeping the station's proportion
  const fu = shipLength / F.size.x;                               // metres per fighter unit
  const floor = new THREE.Group();                                // the set's frame: metres, deck at y = 0
  const fx = bay.back + (bay.mouth - bay.back) * along;          // the fighter's spot along the hangar, hangar units

  const hangar = new THREE.Mesh(H.geometry, H.material);
  hangar.scale.setScalar(hu);
  hangar.position.set(-fx * hu, -bay.deckY * hu, 0);
  hangar.receiveShadow = hangar.castShadow = true;
  floor.add(hangar);

  // the fighter: hull and canopy, both in fighter units under a group in metres
  const ship = new THREE.Group();
  const { hull, canopy } = splitCanopy(F.geometry, SHIP1_CANOPY);
  const hullMesh = new THREE.Mesh(hull, F.material); hullMesh.castShadow = hullMesh.receiveShadow = true;
  const canopyMesh = new THREE.Mesh(canopy, F.material); canopyMesh.castShadow = true;
  canopyMesh.position.set(SHIP1_CANOPY.hinge.x, SHIP1_CANOPY.hinge.y, 0);
  // The part came with the canopy's frame only - its glass did not survive the export - so a
  // shut canopy read as open. The glass is the frame's convex shell: a dark tinted blister
  // stretched over the rails, in the canopy's own frame so it swings with it.
  {
    const pos = canopy.attributes.position, pts = [];
    for (let i = 0; i < pos.count; i += 2) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    const glass = new THREE.Mesh(new ConvexGeometry(pts), new THREE.MeshPhysicalMaterial({
      color: 0x223a52, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.2 }));
    glass.name = 'CanopyGlass'; glass.renderOrder = 2;
    canopyMesh.add(glass);
  }
  const body = new THREE.Group(); body.scale.setScalar(fu); body.position.y = -F.box.min.y * fu;
  body.add(hullMesh); body.add(canopyMesh);
  const burner = addAfterburner(body, F); burner.setThrust(0);      // cold on the deck
  ship.add(body);
  floor.add(ship);

  // the parked ships, placed by the same table the station's hangars use, so the cut inside
  // changes nothing on the deck
  const others = [];
  for (const pk of PARKED) {
    const P = parts[pk.kind]; if (!P) continue;
    const len = pk.length * shipLength, m = new THREE.Mesh(P.geometry, P.material), k = len / P.size.x;
    m.scale.setScalar(k); m.castShadow = m.receiveShadow = true;
    m.position.set((bay.back + (bay.mouth - bay.back) * pk.along - fx) * hu, -P.box.min.y * k, -pk.side * bay.halfWidth * hu);
    m.rotation.y = THREE.MathUtils.degToRad(pk.turn || 0);
    floor.add(m); others.push(m);
  }

  return {
    floor, hangar, ship, body, canopy: canopyMesh, others, hu, fu, bay, fx, burner,
    // where things are, in the set's metres
    mouth: new THREE.Vector3((bay.mouth - fx) * hu, 0, 0),
    back: new THREE.Vector3((bay.back - fx) * hu, 0, 0),
    halfWidth: bay.halfWidth * hu,
    // the seat inside the cockpit (ship1's seat piece measured in Blender), in the ship group's metres
    seat: new THREE.Vector3(-0.08 * fu, (0.12 - F.box.min.y) * fu, 0),
    // the canopy from open (0) to shut (1)
    // shut = 1: turned down by `deg`, and let down by `drop` metres and slid by `slide` metres (nose
    // is +) on top of the turn, so the rim can be seated on the sill and not just swung near it
    setCanopy(closed, deg = SHIP1_CANOPY.closeDeg, drop = 0, slide = 0) {
      const k = THREE.MathUtils.clamp(closed, 0, 1);
      canopyMesh.rotation.z = THREE.MathUtils.degToRad(deg) * k;
      canopyMesh.position.set(SHIP1_CANOPY.hinge.x + (slide / fu) * k, SHIP1_CANOPY.hinge.y - (drop / fu) * k, 0);
    },
  };
}

// Split a geometry's triangles into the ones whose centroid lies in the canopy box and the rest.
// The canopy's vertices are moved so its hinge is at its origin, and both come out non-indexed.
function splitCanopy(geometry, box) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  const inIdx = [], outIdx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    const floor = box.hinge.y + Math.max(0, cx - box.hinge.x) * Math.tan(THREE.MathUtils.degToRad(box.slopeDeg));
    (cx > box.xMin && cx < box.xMax && cy > floor ? inIdx : outIdx).push(i, i + 1, i + 2);
  }
  const pick = (idx, dx, dy) => {
    const out = new THREE.BufferGeometry();
    const p = new Float32Array(idx.length * 3), n = nrm ? new Float32Array(idx.length * 3) : null, t = uv ? new Float32Array(idx.length * 2) : null;
    idx.forEach((k, j) => {
      p[j * 3] = pos.getX(k) - dx; p[j * 3 + 1] = pos.getY(k) - dy; p[j * 3 + 2] = pos.getZ(k);
      if (n) { n[j * 3] = nrm.getX(k); n[j * 3 + 1] = nrm.getY(k); n[j * 3 + 2] = nrm.getZ(k); }
      if (t) { t[j * 2] = uv.getX(k); t[j * 2 + 1] = uv.getY(k); }
    });
    out.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (n) out.setAttribute('normal', new THREE.BufferAttribute(n, 3)); else out.computeVertexNormals();
    if (t) out.setAttribute('uv', new THREE.BufferAttribute(t, 2));
    return out;
  };
  return { hull: pick(outIdx, 0, 0), canopy: pick(inIdx, box.hinge.x, box.hinge.y) };
}
