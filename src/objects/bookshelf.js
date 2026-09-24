// BOOKSHELF. A row of real-looking books: each is two covers a little larger than the page block
// between them, a cream page block set back from the fore-edge, and a spine - rounded on a
// hardcover, flat on a paperback - painted from one shared canvas (colour, bands, the title up
// it, the series mark at the foot). A series is a run of volumes with matching spines, as they
// stand on a real shelf; heights, thicknesses and the odd lean vary so it never reads as a stack
// of boxes. Everything merges into three meshes (covers, pages, spines), so a shelf of fifty
// books is three draws. Each book also has an invisible box, for pointing at it.
//
// Local frame: books stand on y = 0, run along +x from x = 0, fore-edges at z = 0, spines facing +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The series Jacob likes (2026-09-24), with the volumes on the shelf. `h` and `t` are the
// typical height and thickness in metres, `hard` a hardcover; colours are the spine's own.
export const SERIES = [
  { id: 'drizzt', name: 'The Legend of Drizzt', author: 'R. A. Salvatore', hard: false, h: 0.178, t: 0.024, colours: ['#2b1d3a', '#3b2350', '#1e2a3e'], ink: '#d9c9ff', mark: 'RAS',
    books: ['Homeland', 'Exile', 'Sojourn', 'The Crystal Shard', 'Streams of Silver', "The Halfling's Gem"] },
  { id: 'expanse', name: 'The Expanse', author: 'James S. A. Corey', hard: false, h: 0.2, t: 0.034, colours: ['#0e2238', '#132c46', '#0b1a2b'], ink: '#9fd8ff', mark: 'EXP',
    books: ['Leviathan Wakes', "Caliban's War", "Abaddon's Gate", 'Cibola Burn', 'Nemesis Games'] },
  { id: 'stormlight', name: 'The Stormlight Archive', author: 'Brandon Sanderson', hard: true, h: 0.24, t: 0.058, colours: ['#15314f', '#3a2c52', '#20422f', '#4a2220', '#2f3a4a'], ink: '#f0d27a', mark: 'SA',
    books: ['The Way of Kings', 'Words of Radiance', 'Oathbringer', 'Rhythm of War', 'Wind and Truth'] },
  { id: 'eragon', name: 'The Inheritance Cycle', author: 'Christopher Paolini', hard: true, h: 0.235, t: 0.045, colours: ['#1f4e8c', '#8c1f1f', '#b08a2a', '#2e6b3a'], ink: '#f4ead2', mark: 'IC',
    books: ['Eragon', 'Eldest', 'Brisingr', 'Inheritance'] },
  { id: 'exfor', name: 'Expeditionary Force', author: 'Craig Alanson', hard: false, h: 0.2, t: 0.03, colours: ['#1c2630', '#26323c', '#30261c'], ink: '#e8b04a', mark: 'EF',
    books: ['Columbus Day', 'SpecOps', 'Paradise', 'Black Ops'] },
  { id: 'bobiverse', name: 'Bobiverse', author: 'Dennis E. Taylor', hard: false, h: 0.2, t: 0.024, colours: ['#0f3f63', '#11507a', '#0c2f4a'], ink: '#ffffff', mark: 'BOB',
    books: ['We Are Legion', 'For We Are Many', 'All These Worlds', "Heaven's River"] },
  { id: 'hailmary', name: 'Project Hail Mary', author: 'Andy Weir', hard: true, h: 0.235, t: 0.04, colours: ['#e0a531'], ink: '#1a1208', mark: 'AW',
    books: ['Project Hail Mary'] },
  { id: 'animorphs', name: 'Animorphs', author: 'K. A. Applegate', hard: false, h: 0.175, t: 0.011, colours: ['#d9e6f2', '#e8f0d8', '#f2e2d6', '#dcd6ee'], ink: '#1b2a6b', mark: 'A',
    books: ['The Invasion', 'The Visitor', 'The Encounter', 'The Message', 'The Predator', 'The Capture'] },
  { id: 'crucible', name: "Destiny's Crucible", author: 'Olan Thorensen', hard: false, h: 0.2, t: 0.036, colours: ['#4a2e1a', '#3a3a24', '#2a3a3a'], ink: '#efe0c0', mark: 'DC',
    books: ["Destiny's Crucible 1", "Destiny's Crucible 2", "Destiny's Crucible 3"] },
  { id: 'dcc', name: 'Dungeon Crawler Carl', author: 'Matt Dinniman', hard: false, h: 0.21, t: 0.038, colours: ['#e25a1c', '#f0b21c', '#7a2cc2', '#1c8a4a', '#c21c3a'], ink: '#101010', mark: 'DCC',
    books: ['Dungeon Crawler Carl', "Carl's Doomsday Scenario", "The Dungeon Anarchist's Cookbook", 'The Gate of the Feral Gods', "The Butcher's Masquerade"] },
  { id: 'hwfwm', name: 'He Who Fights with Monsters', author: 'Shirtaloon', hard: false, h: 0.21, t: 0.042, colours: ['#1a1a1a', '#2a1414', '#14202a'], ink: '#e84a3a', mark: 'HWFWM',
    books: ['He Who Fights with Monsters 1', 'He Who Fights with Monsters 2', 'He Who Fights with Monsters 3'] },
  { id: 'mistborn', name: 'Mistborn', author: 'Brandon Sanderson', hard: false, h: 0.2, t: 0.036, colours: ['#1c1c24', '#2a1c1c', '#1c242a'], ink: '#c9b27a', mark: 'MB',
    books: ['The Final Empire', 'The Well of Ascension', 'The Hero of Ages'] },
];

function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// one spine painted into a cell of the atlas: w x h pixels, title running up it (bottom to top)
function paintSpine(g, x, y, w, h, bk) {
  g.save(); g.translate(x, y);
  g.fillStyle = bk.colour; g.fillRect(0, 0, w, h);
  // a little wear: darker at the head and foot
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(0.08, 'rgba(0,0,0,0)'); grad.addColorStop(0.92, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = bk.ink; g.strokeStyle = bk.ink;
  // bands at the head and foot (gold rules on a hardcover)
  g.globalAlpha = 0.85; g.lineWidth = Math.max(1, w * 0.04);
  for (const by of bk.hard ? [0.06, 0.075, 0.925, 0.94] : [0.05, 0.95]) { g.beginPath(); g.moveTo(w * 0.08, h * by); g.lineTo(w * 0.92, h * by); g.stroke(); }
  g.globalAlpha = 1;
  // the series mark at the foot, the title up the middle
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(Math.min(w * 0.42, h * 0.035))}px Georgia, 'Times New Roman', serif`;
  g.fillText(bk.mark, w / 2, h * 0.875);
  g.save(); g.translate(w / 2, h * 0.45); g.rotate(-Math.PI / 2);
  let size = Math.round(w * 0.5); g.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
  while (g.measureText(bk.title).width > h * 0.66 && size > 6) { size--; g.font = `bold ${size}px Georgia, 'Times New Roman', serif`; }
  g.fillText(bk.title, 0, 0);
  g.restore();
  g.restore();
}

// Lay the series out along `length` metres; returns { group, picks } where picks are the
// invisible boxes, each with userData.book = { title, series }.
export function buildBookshelf({ length = 1.3, maxHeight = 0.26, depthMax = 0.125, seed = 7, series = SERIES } = {}) {
  const r = rnd(seed);
  // every volume, series kept together, in the list's order
  const books = [];
  for (const s of series) s.books.forEach((title, i) => {
    const hard = s.hard;
    books.push({ title, series: s, hard, colour: s.colours[i % s.colours.length], ink: s.ink, mark: s.mark,
      h: Math.min(maxHeight, s.h * (0.97 + r() * 0.06)), t: s.t * (0.85 + r() * 0.3), d: Math.min(depthMax, s.h * 0.66 * (0.96 + r() * 0.06)) });
  });
  // fit the row to the shelf: take the last volume off whichever series has the most, so every
  // series keeps at least one book on the shelf
  const gap = 0.002;
  while (books.reduce((a, b) => a + b.t + gap, 0) > length) {
    const counts = new Map(); for (const bk of books) counts.set(bk.series, (counts.get(bk.series) || 0) + 1);
    const [most, n] = [...counts].sort((x, y) => y[1] - x[1])[0]; if (n <= 1) break;
    books.splice(books.map(bk => bk.series).lastIndexOf(most), 1);
  }

  // the spine atlas: one column of cells per book, sized to the book's spine
  const PX = 1400;                                                  // pixels a metre
  const cells = books.map(b => ({ w: Math.max(8, Math.round(b.t * PX)), h: Math.round(b.h * PX) }));
  const atlasW = 2048, rows = []; let rowW = 0, row = [];
  cells.forEach((c, i) => { if (rowW + c.w > atlasW) { rows.push(row); row = []; rowW = 0; } row.push(i); rowW += c.w; });
  if (row.length) rows.push(row);
  const rowH = Math.max(...cells.map(c => c.h)), atlasH = THREE.MathUtils.ceilPowerOfTwo(rowH * rows.length);
  const cv = document.createElement('canvas'); cv.width = atlasW; cv.height = atlasH; const g = cv.getContext('2d');
  rows.forEach((ids, ri) => { let x = 0; for (const i of ids) { cells[i].x = x; cells[i].y = ri * rowH; paintSpine(g, x, ri * rowH, cells[i].w, cells[i].h, books[i]); x += cells[i].w; } });
  const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;

  const coverGeos = [], pageGeos = [], spineGeos = [], group = new THREE.Group(), picks = [];
  const tint = (geo, colour) => { const c = new THREE.Color(colour), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const place = (geo, m) => { geo.applyMatrix4(m); return geo.index ? geo.toNonIndexed() : geo; };
  let x = 0;
  books.forEach((b, i) => {
    const board = b.hard ? 0.003 : 0.0012, over = b.hard ? 0.003 : 0.0005;   // cover thickness; how far it overhangs the pages
    const lean = (i === books.length - 1 || (b.series !== (books[i + 1] || {}).series && r() < 0.35)) ? (0.05 + r() * 0.08) : 0;
    // the book's own frame: base at its left foot, then leaned over to the right about that corner
    const m = new THREE.Matrix4().makeTranslation(x, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-lean));
    const W = b.t, H = b.h, D = b.d;
    // the covers, full height and depth, at either side
    for (const cx of [board / 2, W - board / 2]) {
      const cg = new THREE.BoxGeometry(board, H, D); cg.translate(cx, H / 2, -D / 2);
      coverGeos.push(tint(place(cg, m), b.colour));
    }
    // the page block, inset top, bottom and at the fore-edge
    const pg = new THREE.BoxGeometry(W - board * 2, H - over * 2, D - over - 0.002); pg.translate(W / 2, H / 2, -(D - over - 0.002) / 2 - over);
    pageGeos.push(place(pg, m));
    // the spine: a shallow half-round across the back on a hardcover, flat on a paperback;
    // its UVs are the book's cell in the atlas (u across, v up)
    const c = cells[i], u0 = c.x / atlasW, u1 = (c.x + c.w) / atlasW, v1 = 1 - c.y / atlasH, v0 = 1 - (c.y + c.h) / atlasH;
    let sg;
    if (b.hard) {
      sg = new THREE.CylinderGeometry(1, 1, H, 10, 1, true, -Math.PI / 2, Math.PI);   // the half facing +z
      sg.scale(W / 2, 1, 0.006); sg.translate(W / 2, H / 2, 0);
    } else {
      sg = new THREE.PlaneGeometry(W, H); sg.translate(W / 2, H / 2, 0.0004);
    }
    const uv = sg.attributes.uv, pos = sg.attributes.position;
    for (let k = 0; k < uv.count; k++) { const fx = THREE.MathUtils.clamp(pos.getX(k) / W, 0, 1), fy = pos.getY(k) / H; uv.setXY(k, u0 + (u1 - u0) * fx, v0 + (v1 - v0) * fy); }
    spineGeos.push(place(sg, m));
    // for pointing at it
    const pick = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshBasicMaterial({ visible: false }));
    pick.geometry.translate(W / 2, H / 2, -D / 2); pick.applyMatrix4(m); pick.userData.book = { title: b.title, series: b.series };
    group.add(pick); picks.push(pick);
    x += W + gap + (lean ? H * Math.sin(lean) : 0);
  });
  const covers = new THREE.Mesh(mergeGeometries(coverGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }));
  const pages = new THREE.Mesh(mergeGeometries(pageGeos), new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.95, metalness: 0 }));
  const spines = new THREE.Mesh(mergeGeometries(spineGeos), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, metalness: 0 }));
  for (const mesh of [covers, pages, spines]) { mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
  group.userData.width = x;
  return { group, picks, books };
}
