// US MAP. The states of labs/map/us.svg as flat shapes with outlines, laid onto the Earth
// photograph where the country sits in it. The SVG's own coordinates are turned into the
// photograph's pixels by a similarity transform (scale, turn and shift) fitted to five landmarks
// (Seattle, the tip of Florida, the tip of Maine, San Diego, Chicago; within 20 px on the
// 833 px globe), and the pixels become the picture plane's own units, so the map can be a child
// of any copy of the picture. Each state can be lit up on its own, and the whole outline can glow.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

// SVG units -> photo pixels: px = a*x - b*y + tx, py = b*x + a*y + ty (fitted 2026-09-20)
export const FIT = { a: 0.40125, b: -0.05498, tx: 201.78, ty: 269.94 };
const PHOTO = { w: 833, h: 827 };

export async function loadUSMap(url = '../map/us.svg', { colour = 0x35e07d, line = 0xbfffd8, lift = 0.6 } = {}) {
  const data = await new SVGLoader().loadAsync(url);
  const group = new THREE.Group();
  const states = new Map(), pickable = [];
  const toPlane = (x, y) => {                                       // SVG -> picture plane local (x right, y up, centred)
    const px = FIT.a * x - FIT.b * y + FIT.tx, py = FIT.b * x + FIT.a * y + FIT.ty;
    return [px - PHOTO.w / 2, PHOTO.h / 2 - py];
  };
  for (const path of data.paths) {
    const id = path.userData.node.id, name = path.userData.node.dataset.name || id;
    if (!id || id.length !== 2) continue;
    const st = { id, name, group: new THREE.Group(), fills: [], lines: [], amount: 0 };
    const fillMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const lineMat = new THREE.LineBasicMaterial({ color: line, transparent: true, opacity: 0, depthWrite: false });
    for (const shape of SVGLoader.createShapes(path)) {
      // the shape itself, re-drawn in plane units (holes too)
      const remap = (pts) => pts.map(p => new THREE.Vector2(...toPlane(p.x, p.y)));
      const s2 = new THREE.Shape(remap(shape.getPoints()));
      s2.holes = shape.holes.map(h => new THREE.Path(remap(h.getPoints())));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(s2), fillMat);
      fill.position.z = lift; fill.userData.state = id;
      st.group.add(fill); st.fills.push(fill); pickable.push(fill);
      const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(s2.getPoints().map(p => new THREE.Vector3(p.x, p.y, lift + 0.3))), lineMat);
      st.group.add(outline); st.lines.push(outline);
    }
    st.fillMat = fillMat; st.lineMat = lineMat;
    group.add(st.group); states.set(id, st);
  }
  let glow = 0;
  const api = {
    group, states, pickable,
    // the whole outline, 0..1
    glow(k) { glow = THREE.MathUtils.clamp(k, 0, 1); for (const st of states.values()) api.apply(st); },
    // one state lit, 0..1 (others untouched)
    highlight(id, k) { const st = states.get(id); if (!st) return; st.amount = THREE.MathUtils.clamp(k, 0, 1); api.apply(st); },
    clear() { for (const st of states.values()) { st.amount = 0; api.apply(st); } },
    apply(st) {
      st.fillMat.opacity = 0.08 * glow + 0.7 * st.amount;
      st.lineMat.opacity = 0.75 * glow + 0.25 * st.amount;
      st.fillMat.color.setHex(colour).lerp(new THREE.Color(0xffffff), st.amount * 0.35);
    },
    // where a state is, in plane units
    centre(id) { const st = states.get(id); if (!st) return null; const b = new THREE.Box3().setFromObject(st.group); return b.getCenter(new THREE.Vector3()); },
    // the state under a ray, if any
    pick(raycaster) { const hit = raycaster.intersectObjects(pickable, false)[0]; return hit ? hit.object.userData.state : null; },
  };
  return api;
}
