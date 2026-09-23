/* Small maths helpers: seeded RNG, value noise, vector bits, A* on the grid. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- RNG
  function Rng(seed) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  Rng.prototype.next = function () {           // [0,1)
    var t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  Rng.prototype.int = function (n) { return (this.next() * n) | 0; };
  Rng.prototype.pick = function (arr) { return arr[(this.next() * arr.length) | 0]; };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };

  // Smooth 1D value noise, used for ground relief and tunnel meander.
  function Noise1(rng, n) {
    this.v = new Float32Array(n);
    for (var i = 0; i < n; i++) this.v[i] = rng.next() * 2 - 1;
  }
  Noise1.prototype.at = function (t) {
    var n = this.v.length;
    var i = Math.floor(t), f = t - i;
    var a = this.v[((i % n) + n) % n];
    var b = this.v[(((i + 1) % n) + n) % n];
    var s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };

  // ------------------------------------------------------------- scalars
  var U = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    // shortest-arc angle interpolation
    angLerp: function (a, b, t) {
      var d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return a + d * t;
    },
    dist: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    smooth: function (t) { return t * t * (3 - 2 * t); }
  };

  /* Two-bone inverse kinematics.
   * Returns the joint (knee) position for a limb rooted at (hx,hy) whose tip
   * is at (fx,fy), bending towards (bx,by).  Used for every ant leg.
   */
  U.ik2 = function (hx, hy, fx, fy, l1, l2, bx, by, out) {
    var dx = fx - hx, dy = fy - hy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    var maxD = (l1 + l2) * 0.999;
    var minD = Math.abs(l1 - l2) * 1.001 + 1e-4;
    var dc = U.clamp(d, minD, maxD);
    var ux = dx / d, uy = dy / d;
    var a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // perpendicular, flipped so the knee bends the way we asked
    var px = -uy, py = ux;
    if (px * bx + py * by < 0) { px = -px; py = -py; }
    out.x = hx + ux * a + px * h;
    out.y = hy + uy * a + py * h;
    // the tip may have been clamped in (limb over-extended); report where it lands
    out.tipX = hx + ux * dc;
    out.tipY = hy + uy * dc;
    return out;
  };

  // ------------------------------------------------------------------ A*
  /* Grid path finder over walkable air cells.  Ants cling to walls and
   * ceilings, so "walkable" means an air cell touching any grain of sand;
   * cells with sand directly underfoot are cheaper, which keeps ants on
   * tunnel floors unless the ceiling is a real short-cut.
   */
  function PathFinder(grid) {
    var n = grid.cols * grid.rows;
    this.grid = grid;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.epoch = 0;
    this.heap = new Int32Array(n + 1);
    this.heapLen = 0;
    this.maxExpand = 4500;
    this.lastCost = 0;
  }

  PathFinder.prototype._push = function (idx) {
    var h = this.heap, f = this.f;
    var i = ++this.heapLen;
    h[i] = idx;
    while (i > 1) {
      var p = i >> 1;
      if (f[h[p]] <= f[h[i]]) break;
      var t = h[p]; h[p] = h[i]; h[i] = t;
      i = p;
    }
  };
  PathFinder.prototype._pop = function () {
    var h = this.heap, f = this.f;
    var top = h[1];
    h[1] = h[this.heapLen--];
    var i = 1;
    for (;;) {
      var l = i << 1, r = l + 1, m = i;
      if (l <= this.heapLen && f[h[l]] < f[h[m]]) m = l;
      if (r <= this.heapLen && f[h[r]] < f[h[m]]) m = r;
      if (m === i) break;
      var t = h[m]; h[m] = h[i]; h[i] = t;
      i = m;
    }
    return top;
  };

  // Straight-line-ish octile heuristic.
  function heur(ax, ay, bx, by) {
    var dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return (dx > dy) ? dx + 0.4142 * dy : dy + 0.4142 * dx;
  }

  /* find(sx,sy, targets) -> array of {x,y} cells, or null.
   * `targets` is a list of goal cells; the cheapest reachable one wins.
   */
  PathFinder.prototype.find = function (sx, sy, targets) {
    var grid = this.grid, cols = grid.cols;
    if (!targets || !targets.length) return null;
    if (!grid.walkable(sx, sy)) {
      // Ant is inside sand or floating; step it to the nearest walkable cell.
      var near = grid.nearestWalkable(sx, sy, 3);
      if (!near) return null;
      sx = near.x; sy = near.y;
    }
    var goal = new Uint8Array(0);
    var gset = {};
    var i, t, gx = 0, gy = 0, count = 0;
    for (i = 0; i < targets.length; i++) {
      t = targets[i];
      if (!grid.inb(t.x, t.y) || !grid.walkable(t.x, t.y)) continue;
      gset[t.y * cols + t.x] = 1;
      gx += t.x; gy += t.y; count++;
    }
    if (!count) return null;
    gx /= count; gy /= count;

    var ep = ++this.epoch;
    var start = sy * cols + sx;
    this.heapLen = 0;
    this.stamp[start] = ep;
    this.g[start] = 0;
    this.f[start] = heur(sx, sy, gx, gy);
    this.came[start] = -1;
    this.closed[start] = 0;
    this._push(start);

    var expanded = 0, found = -1;
    while (this.heapLen > 0) {
      var cur = this._pop();
      if (this.closed[cur] === 1 && this.stamp[cur] === ep) continue;
      this.closed[cur] = 1;
      this.stamp[cur] = ep;
      if (gset[cur] === 1) { found = cur; break; }
      if (++expanded > this.maxExpand) break;

      var cy = (cur / cols) | 0, cx = cur - cy * cols;
      for (var d = 0; d < 8; d++) {
        var dx = DX[d], dy = DY[d];
        var nx = cx + dx, ny = cy + dy;
        if (!grid.walkable(nx, ny)) continue;
        /* No cutting the corner of a grain: a diagonal stride is only on if
         * both cells it passes between are open.  Allowing it when just one is
         * open produces routes that go through solid sand, and the ant then
         * spends the rest of its life pushing against that grain. */
        if (dx && dy) {
          if (grid.solid(cx + dx, cy) || grid.solid(cx, cy + dy)) continue;
        }
        var ni = ny * cols + nx;
        if (this.stamp[ni] === ep && this.closed[ni] === 1) continue;
        var step = (dx && dy) ? 1.4142 : 1;
        if (!grid.solid(nx, ny + 1)) step *= 1.7;   // clinging is slow going
        var ng = this.g[cur] + step;
        if (this.stamp[ni] !== ep) {
          this.stamp[ni] = ep; this.closed[ni] = 0;
          this.g[ni] = ng; this.came[ni] = cur;
          this.f[ni] = ng + heur(nx, ny, gx, gy);
          this._push(ni);
        } else if (ng < this.g[ni]) {
          this.g[ni] = ng; this.came[ni] = cur;
          this.f[ni] = ng + heur(nx, ny, gx, gy);
          this._push(ni);
        }
      }
    }
    if (found < 0) return null;
    this.lastCost = this.g[found];
    var out = [];
    var c = found;
    while (c >= 0) {
      var yy = (c / cols) | 0;
      out.push({ x: c - yy * cols, y: yy });
      c = this.came[c];
    }
    out.reverse();
    return out;
  };

  var DX = [1, -1, 0, 0, 1, 1, -1, -1];
  var DY = [0, 0, 1, -1, 1, -1, 1, -1];

  root.Rng = Rng;
  root.Noise1 = Noise1;
  root.U = U;
  root.PathFinder = PathFinder;
  root.DIR8X = DX;
  root.DIR8Y = DY;
})(typeof window !== 'undefined' ? window : global);
