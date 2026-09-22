// TOWN LAYOUT. What the Town Map lab saves: textures/town/layout.png (a metre a pixel, 600 m
// across, north up: roads, grass, water and forest floor by colour) and layout.json (building
// rectangles in order, the fence's corners), in metres from the town's centre, x east, z south.
// The ground shader reads the picture as a class map; the town places the buildings and the
// fence from the JSON. Without the files the town uses its old spiral of lots and an octagon.
import * as THREE from 'three';

export const LAYOUT_COLOURS = { floor: [0x5a, 0x3f, 0x2a], road: [0x5b, 0x61, 0x69], grass: [0x4c, 0x8a, 0x34], water: [0x2c, 0x6f, 0xa8] };

export async function loadTownLayout(base = '../../textures/town/') {
  try {
    const j = await fetch(`${base}layout.json`).then(r => r.ok ? r.json() : null);
    if (!j) return null;
    const map = await new Promise((res) => new THREE.TextureLoader().load(`${base}layout.png`, (t) => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; res(t); }, undefined, () => res(null)));
    return { metres: j.metres || 600, buildings: j.buildings || [], fence: j.fence || [], map };
  } catch (e) { return null; }
}

// The class map turned into a texture the ground shader can read as weights: R = road, G = grass,
// B = water, so a pixel's class is whichever channel is lit (forest floor is none).
export function classTexture(mapTex) {
  const img = mapTex.image, w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), px = d.data;
  const near = (r, gg, b, c) => Math.abs(r - c[0]) + Math.abs(gg - c[1]) + Math.abs(b - c[2]) < 60;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const road = near(r, gg, b, LAYOUT_COLOURS.road), grass = near(r, gg, b, LAYOUT_COLOURS.grass), water = near(r, gg, b, LAYOUT_COLOURS.water);
    px[i] = road ? 255 : 0; px[i + 1] = grass ? 255 : 0; px[i + 2] = water ? 255 : 0; px[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
  return t;
}
