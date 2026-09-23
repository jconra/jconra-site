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
// the states' longitude and latitude bounds [west, east, south, north], for placing pins on places
export const STATE_BOUNDS = { CO: [-109.06, -102.04, 36.99, 41.0], NM: [-109.05, -103.0, 31.33, 37.0], MD: [-79.49, -75.05, 37.89, 39.72], MS: [-91.66, -88.1, 30.17, 35.0], WA: [-124.85, -116.92, 45.54, 49.0] };

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
    const st = { id, name, group: new THREE.Group(), fills: [], amount: 0, box: new THREE.Box2(), svgBox: new THREE.Box2() };
    const fillMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const dark = new LineMaterial({ color: 0x06100a, linewidth: 3.2, transparent: true, opacity: 0, depthWrite: false, resolution });
    const light = new LineMaterial({ color: line, linewidth: 1.1, transparent: true, opacity: 0, depthWrite: false, resolution });
    lineMats.push(dark, light);
    for (const shape of SVGLoader.createShapes(path)) {
      const remap = (pts) => pts.map(p => new THREE.Vector2(...toPlane(p.x, p.y)));
      const s2 = new THREE.Shape(remap(shape.getPoints()));
      s2.holes = shape.holes.map(h => new THREE.Path(remap(h.getPoints())));
      for (const p of s2.getPoints()) st.box.expandByPoint(p);
      for (const p of shape.getPoints()) st.svgBox.expandByPoint(p);
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
    // A map pin standing on a spot in the state, shown as the state lights: a tapered point down to
    // the map, a round head, a dark outline (the same shapes a little bigger, drawn inside out) and
    // a soft shadow on the map. `at` is { lonlat: [lon, lat] } for a real place, or { fx, fy }, the
    // fraction of the way across the state west to east and north to south.
    pin(id, at = {}, colourHex = 0xe0302a) {
      const st = states.get(id); if (!st) return;
      if (!st.pin) {
        const pin = new THREE.Group();
        const point = new THREE.CylinderGeometry(2.3, 0.05, 10, 20).rotateX(Math.PI / 2).translate(0, 0, 5);   // tip at the map, widening upward
        const head = new THREE.SphereGeometry(3.8, 24, 16).translate(0, 0, 11.5);
        const redM = new THREE.MeshStandardMaterial({ color: colourHex, roughness: 0.3, metalness: 0.05, emissive: 0x3a0806 });
        const lineM = new THREE.MeshBasicMaterial({ color: 0x1a0606, side: THREE.BackSide });
        for (const geo of [point, head]) {
          pin.add(new THREE.Mesh(geo, redM));
          const edge = new THREE.Mesh(geo.clone(), lineM); edge.scale.setScalar(1.14); edge.position.z = geo === head ? -11.5 * 0.14 : -0.2; pin.add(edge);
        }
        const shine = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd9d0 }));
        shine.position.set(-1.4, 1.6, 13.6); pin.add(shine);
        // the shadow: a soft dark oval on the map, cast away from the light
        const sc = document.createElement('canvas'); sc.width = sc.height = 64; const g = sc.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
        shadow.position.set(5, -2.5, 0.1); shadow.rotation.z = -0.4; pin.add(shadow);
        // the pin itself a little smaller than it was drawn and leaning back from the viewer, so the
        // point is seen going into the map; the shadow stays flat on the map
        const inner = new THREE.Group(); for (const c of [...pin.children]) if (c !== shadow) inner.add(c);
        inner.scale.setScalar(0.65); inner.rotation.x = 0.3; pin.add(inner); shadow.scale.setScalar(0.65); shadow.position.multiplyScalar(0.65);
        pin.scale.setScalar(0.001); st.pin = pin; group.add(pin);
      }
      api.movePin(id, at);
    },
    // where a pin stands: a place's longitude and latitude, or a fraction of the way across the state
    movePin(id, at = {}) {
      const st = states.get(id); if (!st || !st.pin) return;
      let fx = at.fx ?? 0.5, fy = at.fy ?? 0.5;
      const B = STATE_BOUNDS[id];
      if (at.lonlat && B && at.fx === undefined) { fx = (at.lonlat[0] - B[0]) / (B[1] - B[0]); fy = (B[3] - at.lonlat[1]) / (B[3] - B[2]); }
      st.pinAt = { fx, fy };
      const sb = st.svgBox, x = sb.min.x + fx * (sb.max.x - sb.min.x), y = sb.min.y + fy * (sb.max.y - sb.min.y);
      const [px, py] = toPlane(x, y); st.pin.position.set(px, py, lift);
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
    // Colorado's flag by its law (1911/1929): three equal stripes, blue white blue; the gold disc
    // exactly as tall as the white stripe; the red C twice that across, its inside filled by the
    // disc; the C's ends cut off square along a vertical line on the fly side
    g.fillStyle = '#002868'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffffff'; g.fillRect(0, H / 3, W, H / 3);
    // the C's opening is a wedge from its centre, 30 degrees either side of the fly, so its outer
    // corners land on the edges of the white stripe and the white runs in to the gold
    const r = H / 6, R = H / 3, cx = W * 0.38, cy = H / 2, a = Math.PI / 6;
    g.fillStyle = '#bf0a30'; g.beginPath(); g.arc(cx, cy, R, a, Math.PI * 2 - a); g.arc(cx, cy, r, Math.PI * 2 - a, a, true); g.closePath(); g.fill();
    g.fillStyle = '#ffd700'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
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
