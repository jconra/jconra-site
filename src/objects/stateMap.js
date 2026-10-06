// A STATE ON THE GROUND, for the town: a state's outline from the site's US map (labs/map/us.svg). Its border is planted
// in red flowers by the Build bar's strokes (made from stateOutline); this prop is the shape itself, flat on the ground and
// unseen, so a pointer over the garden finds it (the showcase's Montana landmark).
//
//   stateOutline(state) -> Promise<[[x, z], ...]>   the border in metres at size 1 (4 m across), its middle at 0, north -z
//   makeStateMap({ state }) -> Group: an unseen flat shape (filled in when the map has loaded), standing on y = 0
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

export const STATE_ACROSS = 4;                          // (m across at size 1)
let SVG = null;
const svgText = () => SVG || (SVG = fetch('/labs/map/us.svg').then((r) => r.text()));
const SHAPES = {};
// the state's shapes, in metres at size 1, its middle at 0 (x east, y south: as the map draws it)
function stateShapes(state) {
  return SHAPES[state] || (SHAPES[state] = svgText().then((svg) => {
    const m = svg.match(new RegExp(`<path[^>]*?id="${state}"[^>]*?>`, 's')), d = m && m[0].match(/\sd="([^"]+)"/);
    if (!d) return null;
    const shapes = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d[1]}"/></svg>`).paths.flatMap((p) => SVGLoader.createShapes(p));
    const box = new THREE.Box2(); for (const s of shapes) for (const p of s.getPoints(4)) box.expandByPoint(p);
    const k = STATE_ACROSS / (box.max.x - box.min.x), c = box.getCenter(new THREE.Vector2());
    return { shapes, k, c };
  }));
}
export async function stateOutline(state) {
  const S = await stateShapes(state); if (!S) return null;
  const pts = S.shapes[0].getPoints(6).map((p) => [(p.x - S.c.x) * S.k, (p.y - S.c.y) * S.k]);
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0].slice());   // (closed)
  return pts;
}
export function makeStateMap({ state = 'MT' } = {}) {
  const g = new THREE.Group(); g.name = 'stateMap'; g.userData.kind = 'stateMap';
  const unseen = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });   // (both sides: found from above whichever way its faces wind)
  const keep = new THREE.Mesh(new THREE.BoxGeometry(STATE_ACROSS, 0.3, STATE_ACROSS * 0.6).translate(0, 0.15, 0), unseen);   // (its size until the shape has loaded: what it's measured and picked by)
  g.add(keep);
  stateShapes(state).then((S) => {
    if (!S) return;
    const geo = new THREE.ShapeGeometry(S.shapes, 2);
    geo.translate(-S.c.x, -S.c.y, 0).scale(S.k, S.k, 1).rotateX(Math.PI / 2);   // (flat: south +z as the map's down; the page lays it onto the ground)
    g.add(new THREE.Mesh(geo, unseen)); g.remove(keep); keep.geometry.dispose();
  });
  return g;
}
