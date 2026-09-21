// US MAP. The states of labs/map/us.svg as flat shapes with outlines, laid onto the Earth
// photograph where the country sits in it. The SVG's own coordinates are turned into the
// photograph's pixels by a similarity transform (scale, turn and shift) fitted to five landmarks
// (Seattle, the tip of Florida, the tip of Maine, San Diego, Chicago; within 20 px on the
// 833 px globe), and the pixels become the picture plane's own units, so the map can be a child
// of any copy of the picture. Each state can be lit up on its own, and the whole outline can glow.
//
// Outlines are fat lines (Line2): a black line with a thin light one on top, so they read on cloud
// and on land alike, and survive the depth-of-field blur that ate the one-pixel lines. A lit state
// fills with its flag where one is drawn (Colorado, New Mexico; others are a plain tint until an
// image lands in textures/flags/XX.png), and can carry a pin.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

// SVG units -> photo pixels: px = a*x - b*y + tx, py = b*x + a*y + ty (fitted 2026-09-20)
export const FIT = { a: 0.40125, b: -0.05498, tx: 201.78, ty: 269.94 };
const PHOTO = { w: 833, h: 827 };

export async function loadUSMap(url = '../map/us.svg', { colour = 0x35e07d, line = 0xf2fff6, lift = 0.6, flagDir = '../../textures/flags/' } = {}) {
  const data = await new SVGLoader().loadAsync(url);
  const group = new THREE.Group();
  const states = new Map(), pickable = [];
  const toPlane = (x, y) => {                                       // SVG -> picture plane local (x right, y up, centred)
    const px = FIT.a * x - FIT.b * y + FIT.tx, py = FIT.b * x + FIT.a * y + FIT.ty;
    return [px - PHOTO.w / 2, PHOTO.h / 2 - py];
  };
  const resolution = new THREE.Vector2(innerWidth, innerHeight);
  const lineMats = [];
  for (const path of data.paths) {
    const id = path.userData.node.id, name = path.userData.node.dataset.name || id;
    if (!id || id.length !== 2) continue;
    const st = { id, name, group: new THREE.Group(), fills: [], amount: 0, box: new THREE.Box2() };
    const fillMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const dark = new LineMaterial({ color: 0x06100a, linewidth: 3.2, transparent: true, opacity: 0, depthWrite: false, resolution });
    const light = new LineMaterial({ color: line, linewidth: 1.1, transparent: true, opacity: 0, depthWrite: false, resolution });
    lineMats.push(dark, light);
    for (const shape of SVGLoader.createShapes(path)) {
      const remap = (pts) => pts.map(p => new THREE.Vector2(...toPlane(p.x, p.y)));
      const s2 = new THREE.Shape(remap(shape.getPoints()));
      s2.holes = shape.holes.map(h => new THREE.Path(remap(h.getPoints())));
      for (const p of s2.getPoints()) st.box.expandByPoint(p);
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(s2), fillMat);
      fill.position.z = lift; fill.userData.state = id;
      st.group.add(fill); st.fills.push(fill); pickable.push(fill);
      const pts = s2.getPoints(), flat = [];
      for (const p of pts) flat.push(p.x, p.y, 0);
      flat.push(pts[0].x, pts[0].y, 0);
      for (const [mat, z] of [[dark, lift + 0.3], [light, lift + 0.5]]) {
        const geo = new LineGeometry(); geo.setPositions(flat);
        const l = new Line2(geo, mat); l.computeLineDistances(); l.position.z = z; l.frustumCulled = false;
        st.group.add(l);
      }
    }
    st.fillMat = fillMat; st.dark = dark; st.light = light;
    group.add(st.group); states.set(id, st);
  }
  let glow = 0;
  const api = {
    group, states, pickable,
    // the fat lines need the drawing size to keep their width in pixels
    setResolution(w, h) { resolution.set(w, h); for (const m of lineMats) m.resolution.set(w, h); },
    // the whole outline, 0..1
    glow(k) { glow = THREE.MathUtils.clamp(k, 0, 1); for (const st of states.values()) api.apply(st); },
    // one state lit, 0..1 (others untouched)
    highlight(id, k) { const st = states.get(id); if (!st) return; st.amount = THREE.MathUtils.clamp(k, 0, 1); api.apply(st); },
    clear() { for (const st of states.values()) { st.amount = 0; api.apply(st); } },
    apply(st) {
      const flag = st.fillMat.map;
      st.fillMat.opacity = flag ? 0.95 * st.amount : 0.08 * glow + 0.6 * st.amount;
      if (!flag) st.fillMat.color.setHex(colour).lerp(new THREE.Color(0xffffff), st.amount * 0.35);
      st.dark.opacity = 0.9 * glow + 0.1 * st.amount;
      st.light.opacity = 0.7 * glow + 0.3 * st.amount;
      st.dark.linewidth = 3.2 + 2.5 * st.amount; st.light.linewidth = 1.1 + 0.6 * st.amount;
      if (st.pin) st.pin.scale.setScalar(Math.max(0.001, st.amount));
    },
    // the state's flag as its fill: drawn here for the ones that can be, else an image from the
    // flags folder if there is one; mapped over the state's box
    flag(id) {
      const st = states.get(id); if (!st) return;
      const set = (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const w = st.box.max.x - st.box.min.x, h = st.box.max.y - st.box.min.y;
        tex.repeat.set(1 / w, 1 / h); tex.offset.set(-st.box.min.x / w, -st.box.min.y / h);
        st.fillMat.map = tex; st.fillMat.color.setHex(0xffffff); st.fillMat.needsUpdate = true; api.apply(st);
      };
      const drawn = drawFlag(id);
      if (drawn) { set(new THREE.CanvasTexture(drawn)); return; }
      new THREE.TextureLoader().load(`${flagDir}${id}.png`, set, undefined, () => {});
    },
    // a pin standing on the state, shown as the state lights
    pin(id, colourHex = 0xff4a3d) {
      const st = states.get(id); if (!st || st.pin) return;
      const c = st.box.getCenter(new THREE.Vector2());
      const pin = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stem.rotation.x = Math.PI / 2; stem.position.z = 7;
      const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: colourHex }));
      head.position.z = 14;
      pin.add(stem, head); pin.position.set(c.x, c.y, lift); pin.scale.setScalar(0.001);
      st.pin = pin; group.add(pin);
    },
    // where a state is, in plane units
    centre(id) { const st = states.get(id); if (!st) return null; const c = st.box.getCenter(new THREE.Vector2()); return new THREE.Vector3(c.x, c.y, 0); },
    // the state under a ray, if any
    pick(raycaster) { const hit = raycaster.intersectObjects(pickable, false)[0]; return hit ? hit.object.userData.state : null; },
  };
  return api;
}

// Flags that can be drawn from their geometry. Others return null.
function drawFlag(id) {
  const W = 512, H = 341, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  if (id === 'CO') {
    // three stripes, blue white blue; a red C, its opening to the right, round a gold disc
    g.fillStyle = '#002868'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff'; g.fillRect(0, H / 3, W, H / 3);
    const cx = W * 0.36, cy = H / 2, R = H * 0.34, r = R * 0.62;
    g.fillStyle = '#bf0a30'; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.2, Math.PI * 1.8); g.arc(cx, cy, r, Math.PI * 1.8, Math.PI * 0.2, true); g.closePath(); g.fill();
    g.fillStyle = '#ffd700'; g.beginPath(); g.arc(cx, cy, r * 0.62, 0, Math.PI * 2); g.fill();
    return cv;
  }
  if (id === 'NM') {
    // the Zia sun on yellow: a ring and four sets of four rays
    g.fillStyle = '#ffd700'; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = H * 0.12;
    g.strokeStyle = '#bf0a30'; g.lineWidth = R * 0.42; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineCap = 'butt';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lens = [1.6, 2.1, 2.1, 1.6], gap = R * 0.55;
      lens.forEach((L, i) => { const off = (i - 1.5) * gap; const sx = cx + dx * R * 1.35 + dy * off, sy = cy + dy * R * 1.35 + dx * off;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + dx * R * L, sy + dy * R * L); g.stroke(); });
    }
    return cv;
  }
  return null;
}
