// Hex grid: pointy-top hexes in odd-r offset coordinates, one world unit between centres.

export const COLS = 22;
export const ROWS = 22;
export const ROW_H = Math.sqrt(3) / 2;
export const HEX_R = 1 / Math.sqrt(3); // centre-to-corner

const OX = (COLS - 0.5) / 2;
const OZ = ((ROWS - 1) * ROW_H) / 2;

export const START = { c: 0, r: 1 };
export const EXIT = { c: 21, r: 1 };
export const PADS = [
  { c: 6, r: 16 }, { c: 6, r: 11 }, { c: 16, r: 11 },
  { c: 16, r: 16 }, { c: 11, r: 16 }, { c: 11, r: 6 },
];
// The route every ground enemy walks: in from the start, pad 1..6, out the exit.
export const ROUTE = [START, ...PADS, EXIT];

export const key = (c, r) => c + ',' + r;
export const inGrid = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

export function toWorld(c, r) {
  return { x: c + 0.5 * (r & 1) - OX, z: r * ROW_H - OZ };
}

export function fromWorld(x, z) {
  // world -> axial (fractional) -> cube round -> offset
  const px = x + OX, pz = z + OZ;
  const q = (Math.sqrt(3) / 3 * px - pz / 3) / HEX_R;
  const r = (2 / 3 * pz) / HEX_R;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  const row = rz;
  const col = rx + (row - (row & 1)) / 2;
  return { c: col, r: row };
}

const EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function neighbors(c, r) {
  const d = (r & 1) ? ODD : EVEN;
  const out = [];
  for (const [dc, dr] of d) {
    const nc = c + dc, nr = r + dr;
    if (inGrid(nc, nr)) out.push({ c: nc, r: nr });
  }
  return out;
}

export function isReserved(c, r) {
  if (c === START.c && r === START.r) return true;
  if (c === EXIT.c && r === EXIT.r) return true;
  return PADS.some(p => p.c === c && p.r === r);
}
export function padIndex(c, r) {
  return PADS.findIndex(p => p.c === c && p.r === r);
}

// Breadth-first search from a to b; `blocked(c,r)` says which cells are walls.
// Among equally short routes it prefers the one that keeps heading straight at b.
function bfs(a, b, blocked) {
  const prev = new Map();
  const ak = key(a.c, a.r), bk = key(b.c, b.r);
  prev.set(ak, null);
  let frontier = [a];
  const tb = toWorld(b.c, b.r);
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      if (key(cur.c, cur.r) === bk) {
        const path = [];
        let k = bk;
        while (k) { const [c, r] = k.split(',').map(Number); path.push({ c, r }); k = prev.get(k); }
        return path.reverse();
      }
      const ns = neighbors(cur.c, cur.r);
      const cw = toWorld(cur.c, cur.r);
      const dir = Math.atan2(tb.z - cw.z, tb.x - cw.x);
      ns.sort((m, n) => angDiff(m, cw, dir) - angDiff(n, cw, dir));
      for (const n of ns) {
        const nk = key(n.c, n.r);
        if (prev.has(nk) || blocked(n.c, n.r)) continue;
        prev.set(nk, key(cur.c, cur.r));
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
function angDiff(n, cw, dir) {
  const w = toWorld(n.c, n.r);
  let d = Math.atan2(w.z - cw.z, w.x - cw.x) - dir;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// The full ground route through all pads, or null if any leg is cut off.
export function findRoute(blocked) {
  const cells = [];
  const legs = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const leg = bfs(ROUTE[i], ROUTE[i + 1], blocked);
    if (!leg) return null;
    legs.push(leg);
    if (i > 0) leg.shift();
    cells.push(...leg);
  }
  return { cells, legs };
}

export function hexCorners(cx, cz, rad = HEX_R) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + rad * Math.cos(a), cz + rad * Math.sin(a)]);
  }
  return pts;
}

export const GRID_BOUNDS = (() => {
  const a = toWorld(0, 0), b = toWorld(COLS - 1, ROWS - 1);
  return { minX: a.x - 0.6, maxX: b.x + 1.1, minZ: a.z - 0.6, maxZ: b.z + 0.6 };
})();
