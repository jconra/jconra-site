// REPACK the ground-plant sheet's texture (models/props/groundPlants.glb), after build_sheet.py. Blender's smart unwrap
// cut the 16 plants into ~3,700 tiny pieces, each padded, so only ~6% of the 2048 picture was used. This keeps the
// geometry exactly, finds the UV pieces, packs each plant's pieces together (in two colour groups, so far off, where
// the GPU's smaller copies of the picture blend neighbours, petals sit by petals and leaves by leaves), copies their
// pixels across 1:1 into the smallest power-of-two picture that holds them, moves the UVs to match, and fills the
// gaps outward from the pieces. 2026-10-04: 2048 -> 1024 (21 MB -> 5 MB on the GPU), the same plants to the pixel.
// Needs Playwright (a browser does the JPEG and the pixel copies): run it where playwright is installed.
//   node repack_sheet.cjs IN.glb OUT.glb [pad=1] [gap=2] [quality=0.95]      (KCOL=n env: colour groups, default 2)
const fs = require('fs'); const { chromium } = require('playwright');
const [IN, OUT] = process.argv.slice(2, 4); const PAD = +(process.argv[4] || 1), GAP = +(process.argv[5] || 2), Q = +(process.argv[6] || 0.95), SC = 1, ONLY_FIT = !!process.env.FIT;   // (SC: pieces copied 1:1)
if (!IN || !OUT) { console.log('usage: node repack_sheet.cjs IN.glb OUT.glb [pad] [gap] [quality]'); process.exit(1); }

// ── read the GLB ──
const glb = fs.readFileSync(IN), jsonLen = glb.readUInt32LE(12), J = JSON.parse(glb.slice(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8, BIN = glb.slice(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
const prim = J.meshes[0].primitives[0];
const view = (acc) => { const a = J.accessors[acc], bv = J.bufferViews[a.bufferView], off = (bv.byteOffset || 0) + (a.byteOffset || 0), n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 })[a.type];
  const ab = BIN.buffer.slice(BIN.byteOffset + off, BIN.byteOffset + off + n * (a.componentType === 5123 ? 2 : 4)); return a.componentType === 5123 ? new Uint16Array(ab) : new Float32Array(ab); };
const P = view(prim.attributes.POSITION), UV = view(prim.attributes.TEXCOORD_0), IDX = view(prim.indices);
const img = J.images[0], ibv = J.bufferViews[img.bufferView], OLDJPG = BIN.slice(ibv.byteOffset, ibv.byteOffset + ibv.byteLength);
const S0 = 2048, NV = UV.length / 2, NT = IDX.length / 3;
if (J.nodes[0].matrix || J.nodes[0].translation || J.nodes[0].scale || J.nodes[0].rotation) throw new Error('node has a transform: not handled');

// ── which plant each triangle is (as loadSheet splits the sheet: cells 0.5 wide, rows 1.0 tall, row 0 at the top) ──
const plantOfTri = new Int32Array(NT);
for (let t = 0; t < NT; t++) { let cx = 0, cy = 0; for (let k = 0; k < 3; k++) { const v = IDX[t * 3 + k]; cx += P[v * 3]; cy += P[v * 3 + 1]; } cx /= 3; cy /= 3;
  plantOfTri[t] = Math.min(3, Math.floor((4 - cy) / 1.0)) * 4 + Math.min(3, Math.floor(cx / 0.5)); }

// ── the UV pieces: vertices joined by triangles, and by sharing a UV point within the same plant (seams split for normals) ──
const par = new Int32Array(NV).map((_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }, join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
const plantOfV = new Int32Array(NV).fill(-1);
for (let t = 0; t < NT; t++) { const a = IDX[t * 3], b = IDX[t * 3 + 1], c = IDX[t * 3 + 2]; join(a, b); join(a, c); for (const v of [a, b, c]) plantOfV[v] = plantOfTri[t]; }
const key = new Map();
for (let v = 0; v < NV; v++) { if (plantOfV[v] < 0) continue; const k = plantOfV[v] + ':' + Math.round(UV[v * 2] * 1e6) + ',' + Math.round(UV[v * 2 + 1] * 1e6); if (key.has(k)) join(key.get(k), v); else key.set(k, v); }
const pieces = new Map();   // root -> { plant, x0, y0, x1, y1 } in old pixels
for (let v = 0; v < NV; v++) { if (plantOfV[v] < 0) continue; const r = find(v), x = UV[v * 2] * S0, y = UV[v * 2 + 1] * S0;
  let p = pieces.get(r); if (!p) pieces.set(r, p = { plant: plantOfV[v], x0: x, y0: y, x1: x, y1: y, votes: new Map() });
  p.x0 = Math.min(p.x0, x); p.y0 = Math.min(p.y0, y); p.x1 = Math.max(p.x1, x); p.y1 = Math.max(p.y1, y); p.votes.set(plantOfV[v], (p.votes.get(plantOfV[v]) || 0) + 1); }
for (const p of pieces.values()) { p.plant = [...p.votes].sort((a, b) => b[1] - a[1])[0][0]; delete p.votes;
  p.sx = Math.max(0, Math.floor(p.x0) - PAD); p.sy = Math.max(0, Math.floor(p.y0) - PAD); p.sw = Math.min(S0, Math.ceil(p.x1) + PAD) - p.sx; p.sh = Math.min(S0, Math.ceil(p.y1) + PAD) - p.sy;
  p.w = Math.max(1, Math.ceil(p.sw * SC)); p.h = Math.max(1, Math.ceil(p.sh * SC)); }   // (the room it takes in the new picture)

async function main() {
// ── each piece's average colour (a first look at the old picture), so a plant's pieces can be packed with like beside like:
// far off the GPU's smaller copies of the picture blend each piece with its neighbours, and white petals next to green
// leaves came out greyish-green ──
const KCOL = +(process.env.KCOL || 2);
{ const b0 = await chromium.launch(); const pg0 = await b0.newPage();
  const rects = [...pieces.values()].map(p => [p.sx, p.sy, p.sw, p.sh]);
  const cols = await pg0.evaluate(async ({ jpg, S0, rects }) => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + jpg; await im.decode();
    const c = document.createElement('canvas'); c.width = c.height = S0; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, S0, S0).data;
    return rects.map(([x, y, w, h]) => { let r = 0, gg = 0, b = 0, n = 0; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * S0 + xx) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } return [r / n, gg / n, b / n]; }); }, { jpg: OLDJPG.toString('base64'), S0, rects });
  await b0.close(); [...pieces.values()].forEach((p, i) => { p.col = cols[i]; }); }
// within each plant, k-means on the colours: KCOL groups, each packed as its own run
for (let k = 0; k < 16; k++) { const ps = [...pieces.values()].filter(p => p.plant === k); if (!ps.length) continue;
  const sorted = [...ps].sort((a, b) => (a.col[0] + a.col[1] + a.col[2]) - (b.col[0] + b.col[1] + b.col[2]));
  let cen = Array.from({ length: Math.min(KCOL, ps.length) }, (_, i) => sorted[Math.floor((i + 0.5) / KCOL * sorted.length)].col.slice());
  for (let it = 0; it < 12; it++) { const sum = cen.map(() => [0, 0, 0, 0]);
    for (const p of ps) { let bi = 0, bd = 1e9; cen.forEach((c, i) => { const d = (c[0] - p.col[0]) ** 2 + (c[1] - p.col[1]) ** 2 + (c[2] - p.col[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); p.grp = bi; const sm = sum[bi]; sm[0] += p.col[0]; sm[1] += p.col[1]; sm[2] += p.col[2]; sm[3]++; }
    cen = cen.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c); }
  const order = cen.map((c, i) => [i, c[0] + c[1] + c[2]]).sort((a, b) => a[1] - b[1]).map(([i]) => i); for (const p of ps) p.grp = order.indexOf(p.grp); }

// ── skyline packer: rects {w, h} into width W, lowest then leftmost; returns the height used ──
function pack(rects, W) {
  let sky = [{ x: 0, y: 0, w: W }], top = 0;
  for (const r of [...rects].sort((a, b) => b.h - a.h || b.w - a.w)) {
    let best = null;
    for (let i = 0; i < sky.length; i++) { const x = sky[i].x; if (x + r.w > W) break; let y = 0, rem = r.w, j = i;
      while (rem > 0) { y = Math.max(y, sky[j].y); rem -= sky[j].w; j++; if (rem > 0 && j >= sky.length) { y = Infinity; break; } }
      if (y < Infinity && (!best || y < best.y || (y === best.y && x < best.x))) best = { x, y }; }
    if (!best) throw new Error(`a ${r.w}x${r.h} piece doesn't fit in width ${W}`);
    r.x = best.x; r.y = best.y; top = Math.max(top, r.y + r.h);
    const seg = { x: r.x, y: r.y + r.h, w: r.w }, out = [];   // the new skyline: the piece's top, the rest cut round it
    for (const s of sky) { const e = s.x + s.w, ne = seg.x + seg.w;
      if (e <= seg.x || s.x >= ne) { out.push(s); continue; }
      if (s.x < seg.x) out.push({ x: s.x, y: s.y, w: seg.x - s.x });
      if (e > ne) out.push({ x: ne, y: s.y, w: e - ne }); }
    out.push(seg); out.sort((a, b) => a.x - b.x);
    sky = []; for (const s of out) { const l = sky[sky.length - 1]; if (l && l.y === s.y && l.x + l.w === s.x) l.w += s.w; else sky.push({ ...s }); }
  }
  return top;
}

// ── each plant's pieces into its own block, one column wide; the blocks stacked in equal columns, each into the
// shortest; the smallest square (and column count) that holds them all ──
let blocks = null, S = 0, NC = 0;
for (const size of [512, 1024, 2048, 4096]) {
  for (const nc of [2, 3, 4, 5, 6, 8]) {
    const colW = Math.floor(size / nc), bl = [];
    try {
      for (let k = 0; k < 16; k++) { const ps = [...pieces.values()].filter(p => p.plant === k).map(p => ({ ...p })); if (!ps.length) continue;
        let H = 0; for (let gi = 0; gi < KCOL; gi++) { const grp = ps.filter(p => p.grp === gi); if (!grp.length) continue; const h = pack(grp, colW - GAP); for (const q of grp) q.y += H; H += h + 1; }
        bl.push({ plant: k, ps, w: colW, h: H + GAP, area: ps.reduce((s, p) => s + p.w * p.h, 0) }); }
    } catch (e) { continue; }
    const cols = new Array(nc).fill(0);
    for (const b of [...bl].sort((a, c) => c.h - a.h)) { let ci = 0; for (let i = 1; i < nc; i++) if (cols[i] < cols[ci]) ci = i; b.x = ci * colW; b.y = cols[ci]; cols[ci] += b.h; }
    if (Math.max(...cols) <= size) { blocks = bl; S = size; NC = nc; break; }
  }
  if (blocks) break;
}
if (!blocks) throw new Error('no fit');
for (const b of blocks) for (const q of b.ps) pieces.set([...pieces.entries()].find(([, p]) => p.sx === q.sx && p.sy === q.sy && p.plant === q.plant)[0], q);
const used = blocks.reduce((s, b) => s + b.area, 0);
console.log(`columns ${NC} | scale ${SC} | pieces ${pieces.size} | plants ${blocks.length} | piece pixels ${used} (${(used / S0 / S0 * 100).toFixed(1)}% of the old 2048, ${(used / S / S * 100).toFixed(1)}% of the new ${S})`); if (ONLY_FIT) process.exit(0);

// ── new UVs: each vertex moves with its piece ──
const UV2 = new Float32Array(UV.length), copies = [];
for (const b of blocks) for (const p of b.ps) { p.dx = b.x + GAP / 2 + p.x; p.dy = b.y + GAP / 2 + p.y; copies.push([p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.w, p.h]); }
{ const cover = new Uint8Array(S * S); let over = 0, outside = 0;   // (check: no two pieces share a pixel, and all lie inside the picture)
  for (const [, , , , dx, dy, w, h] of copies) { if (dx < 0 || dy < 0 || dx + w > S || dy + h > S) { outside++; continue; } for (let y = dy; y < dy + h; y++) for (let x = dx; x < dx + w; x++) { if (cover[y * S + x]) over++; cover[y * S + x] = 1; } }
  console.log(`overlapping pixels ${over} | pieces outside ${outside}`); if (over || outside) throw new Error('pieces overlap'); }
for (let v = 0; v < NV; v++) { if (plantOfV[v] < 0) { UV2[v * 2] = UV[v * 2]; UV2[v * 2 + 1] = UV[v * 2 + 1]; continue; } const p = pieces.get(find(v));
  UV2[v * 2] = ((UV[v * 2] * S0 - p.sx) * (p.w / p.sw) + p.dx) / S; UV2[v * 2 + 1] = ((UV[v * 2 + 1] * S0 - p.sy) * (p.h / p.sh) + p.dy) / S; }

{
  // ── pixels, in a browser: 1:1 copies, then the gaps filled outward from the pieces ──
  const b = await chromium.launch(); const pg = await b.newPage();
  const res = await pg.evaluate(async ({ jpg, S, S0, copies, Q }) => {
    const im = new Image(); im.src = 'data:image/jpeg;base64,' + jpg; await im.decode();
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true });
    for (const [sx, sy, sw, sh, dx, dy, w, h] of copies) { g.imageSmoothingEnabled = !(w === sw && h === sh); g.imageSmoothingQuality = 'high'; g.drawImage(im, sx, sy, sw, sh, dx, dy, w, h); }
    const d = g.getImageData(0, 0, S, S), px = d.data, filled = new Uint8Array(S * S);
    for (const [, , , , dx, dy, w, h] of copies) for (let y = dy; y < dy + h; y++) filled.fill(1, y * S + dx, y * S + dx + w);
    let front = []; for (let q = 0; q < S * S; q++) if (filled[q]) front.push(q);
    for (let pass = 0; pass < S && front.length; pass++) {   // grow the coloured area one pixel a pass (each new pixel takes the average of its filled neighbours)
      const next = [], add = new Set();
      for (const q of front) { const x = q % S, y = (q / S) | 0; for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue; const n = ny * S + nx; if (!filled[n]) add.add(n); } }
      for (const n of add) { const x = n % S, y = (n / S) | 0; let r = 0, gg = 0, bb = 0, k = 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue; const m = ny * S + nx; if (filled[m] === 1) { r += px[m * 4]; gg += px[m * 4 + 1]; bb += px[m * 4 + 2]; k++; } }
        px[n * 4] = r / k; px[n * 4 + 1] = gg / k; px[n * 4 + 2] = bb / k; px[n * 4 + 3] = 255; next.push(n); }
      for (const n of next) filled[n] = 1; front = next; }
    g.putImageData(d, 0, 0);
    // check: the old and new pictures at a sample of piece pixels (the copies should match exactly before the JPEG step)
    const o = document.createElement('canvas'); o.width = o.height = S0; const og = o.getContext('2d', { willReadFrequently: true }); og.drawImage(im, 0, 0);
    let maxd = 0; for (const [sx, sy, w, h, dx, dy, w2, h2] of copies.filter((c, i) => i % 97 === 0 && c[2] === c[6] && c[3] === c[7])) { const a = og.getImageData(sx, sy, w, h).data, bq = g.getImageData(dx, dy, w, h).data; for (let i = 0; i < a.length; i++) maxd = Math.max(maxd, Math.abs(a[i] - bq[i])); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', Q)), buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { jpg: btoa(s), maxd, png: c.toDataURL('image/png') };
  }, { jpg: OLDJPG.toString('base64'), S, S0, copies, Q });
  await b.close();
  console.log('copied pixels identical before JPEG (max channel difference on a sample):', res.maxd);
  const NEWJPG = Buffer.from(res.jpg, 'base64');
  fs.writeFileSync(OUT.replace(/\.glb$/, '_atlas.png'), Buffer.from(res.png.split(',')[1], 'base64'));

  // ── write the GLB: the same, with the new UVs and the new picture ──
  const bin2 = Buffer.from(BIN); const uvbv = J.bufferViews[J.accessors[prim.attributes.TEXCOORD_0].bufferView];
  Buffer.from(UV2.buffer).copy(bin2, uvbv.byteOffset + (J.accessors[prim.attributes.TEXCOORD_0].byteOffset || 0));
  const head = bin2.slice(0, ibv.byteOffset), tail = bin2.slice(ibv.byteOffset + ibv.byteLength);
  if (tail.length && tail.some(x => x !== 0)) throw new Error('data after the picture: not handled');
  let body = Buffer.concat([head, NEWJPG]); const padN = (4 - body.length % 4) % 4; body = Buffer.concat([body, Buffer.alloc(padN)]);
  const J2 = JSON.parse(JSON.stringify(J)); J2.bufferViews[img.bufferView].byteLength = NEWJPG.length; J2.buffers[0].byteLength = body.length;
  let js = Buffer.from(JSON.stringify(J2)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546C67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
  fs.writeFileSync(OUT, Buffer.concat([hdr, ch(js.length, 0x4E4F534A), js, ch(body.length, 0x004E4942), body]));
  const gpu = (s) => (s * s * 4 * 4 / 3 / 1048576).toFixed(1);
  console.log(`texture ${S0} -> ${S} (GPU with mips ${gpu(S0)} MB -> ${gpu(S)} MB) | picture ${(OLDJPG.length / 1024).toFixed(0)} KB -> ${(NEWJPG.length / 1024).toFixed(0)} KB | file ${(glb.length / 1024).toFixed(0)} KB -> ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}
}
main();
