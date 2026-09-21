// HANGAR SET. The inside of one hangar at human scale, built from the same kit parts as the
// station's hangars so the cut from outside to inside keeps the shape: the hangar part scaled so
// the fighter on its deck comes out `shipLength` metres long at the same proportion the station
// uses, the fighter itself as a separate group that can roll out, and its canopy split off the hull
// so it can close. Everything is laid out in metres in a frame whose origin is the fighter's spot
// on the deck, deck at y = 0, the mouth toward +x.
import * as THREE from 'three';
import { BAYS } from './stationKit.js';

// The open canopy of ship1 is welded to its hull. It is picked out by a box (everything above the
// cockpit sill, between the nose and the fin) in the part's own units after the kit's turn to +x,
// and hinged at its rear edge. Measured in Blender, 2026-09-20.
const SHIP1_CANOPY = { xMin: -0.13, xMax: 0.21, yMin: 0.215, hinge: { x: -0.10, y: 0.215 }, closeDeg: -40 };

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
  const body = new THREE.Group(); body.scale.setScalar(fu); body.position.y = -F.box.min.y * fu;
  body.add(hullMesh); body.add(canopyMesh);
  ship.add(body);
  floor.add(ship);

  // the two ship2 fighters parked at the back, either side, noses to the mouth (the far one's
  // canopy open), for the hangar to read as a working bay and not a garage with one car in it
  const others = [];
  for (const [kind, z, len] of [['ship2a', -5.0, 5.0], ['ship2b', 5.0, 5.0]]) {
    const P = parts[kind]; if (!P) continue;
    const m = new THREE.Mesh(P.geometry, P.material), k = len / P.size.x;
    m.scale.setScalar(k); m.castShadow = m.receiveShadow = true;
    m.position.set((bay.back - fx) * hu + len * 0.5 + 0.6, 0, z);      // tails near the back wall, 5 m either side of the centre line
    floor.add(m); others.push(m);
  }

  return {
    floor, hangar, ship, body, canopy: canopyMesh, others, hu, fu, bay,
    // where things are, in the set's metres
    mouth: new THREE.Vector3((bay.mouth - fx) * hu, 0, 0),
    back: new THREE.Vector3((bay.back - fx) * hu, 0, 0),
    halfWidth: bay.halfWidth * hu,
    // the seat inside the cockpit (ship1's seat piece measured in Blender), in the ship group's metres
    seat: new THREE.Vector3(-0.08 * fu, (0.12 - F.box.min.y) * fu, 0),
    // the canopy from open (0) to shut (1)
    setCanopy(closed, deg = SHIP1_CANOPY.closeDeg) { canopyMesh.rotation.z = THREE.MathUtils.degToRad(deg) * THREE.MathUtils.clamp(closed, 0, 1); },
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
    (cx > box.xMin && cx < box.xMax && cy > box.yMin ? inIdx : outIdx).push(i, i + 1, i + 2);
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
