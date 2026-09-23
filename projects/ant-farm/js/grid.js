/* The sand grid.
 *
 * One entry per 4x4 px grain.  Parallel typed arrays instead of objects so
 * a 200 x 105 field costs almost nothing to sweep every frame:
 *
 *   type   AIR | SAND
 *   shade  index into the per-depth colour palette (re-rolled on placement,
 *          so grain colour deliberately does not follow a moved grain)
 *   dug    1 once a grain has been excavated - marks tunnel/chamber space so
 *          diggers can avoid breaking into existing galleries
 *   loose  1 for ant-placed spoil.  Only loose grains obey gravity and the
 *          45 degree angle of repose; the original packed ground is cohesive,
 *          which is what lets tunnels and chambers hold their shape.
 *   room   room id + 1, for nurseries / granaries / middens
 *   owner  dig-job claim + 1, so two tunnels never plan into each other
 */
(function (root) {
  'use strict';

  var CFG = root.CFG;
  var AIR = 0, SAND = 1;

  function Grid(cols, rows, rng) {
    this.cols = cols;
    this.rows = rows;
    this.cell = CFG.cell;
    this.rng = rng;
    var n = cols * rows;
    this.n = n;
    this.type = new Uint8Array(n);
    this.shade = new Uint8Array(n);
    this.dug = new Uint8Array(n);
    this.loose = new Uint8Array(n);
    this.room = new Int16Array(n);
    this.owner = new Int16Array(n);
    this.dirty = [];
    this.dirtySet = new Uint8Array(n);
    this.active = [];            // loose grains still settling
    this.activeSet = new Uint8Array(n);
    this.surfaceRow = 0;
    this.topSolidCache = new Int16Array(cols);
    this.buildTerrain();
  }

  Grid.AIR = AIR;
  Grid.SAND = SAND;

  Grid.prototype.i = function (x, y) { return y * this.cols + x; };
  Grid.prototype.inb = function (x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  };
  /* Off-grid sides and the bottom count as solid: the tank has walls. */
  Grid.prototype.solid = function (x, y) {
    if (x < 0 || x >= this.cols) return y >= 0;
    if (y >= this.rows) return true;
    if (y < 0) return false;
    return this.type[y * this.cols + x] === SAND;
  };
  Grid.prototype.isAir = function (x, y) {
    return this.inb(x, y) && this.type[y * this.cols + x] === AIR;
  };
  Grid.prototype.isDug = function (x, y) {
    return this.inb(x, y) && this.dug[y * this.cols + x] === 1;
  };

  // ------------------------------------------------------------ terrain
  Grid.prototype.buildTerrain = function () {
    var relief = new root.Noise1(this.rng, 32);
    var base = Math.round(this.rows * (1 - CFG.sandFraction));
    this.surfaceRow = base;
    for (var x = 0; x < this.cols; x++) {
      var h = base + Math.round(relief.at(x / 26) * CFG.surfaceRelief * 0.5
                              + relief.at(x / 9 + 11) * CFG.surfaceRelief * 0.25);
      if (h < 2) h = 2;
      if (h > this.rows - 6) h = this.rows - 6;
      this.topSolidCache[x] = h;
      for (var y = h; y < this.rows; y++) {
        var i = y * this.cols + x;
        this.type[i] = SAND;
        this.shade[i] = this.rollShade();
      }
    }
    this.sandDepth = this.rows - this.surfaceRow;
  };

  Grid.prototype.rollShade = function () {
    return (this.rng.next() * CFG.sandPalette) | 0;
  };

  /* Highest sand grain in a column (rows if the column is empty). */
  Grid.prototype.topSolid = function (x) {
    if (x < 0 || x >= this.cols) return this.rows;
    var c = this.topSolidCache[x];
    // cache may be stale after digging/dumping; walk to the true surface
    if (c < 0) c = 0;
    while (c > 0 && this.type[(c - 1) * this.cols + x] === SAND) c--;
    while (c < this.rows && this.type[c * this.cols + x] !== SAND) c++;
    this.topSolidCache[x] = c;
    return c;
  };

  /* Highest *packed* grain in a column - the ground itself, ignoring whatever
   * spoil the ants have heaped on top of it.  This is the lid the nest has to
   * dig under, because loose sand is not a roof: it is what pours in through a
   * hole.  A gallery that breaks the crust under the hill drains the whole heap
   * down itself.  Returns `rows` for a column with no ground left in it. */
  Grid.prototype.packedTop = function (x) {
    if (x < 0 || x >= this.cols) return this.rows;
    for (var y = this.topSolid(x); y < this.rows; y++) {
      var i = y * this.cols + x;
      if (this.type[i] === SAND && this.loose[i] === 0) return y;
    }
    return this.rows;
  };

  // ------------------------------------------------------- change tracking
  Grid.prototype.markDirty = function (i) {
    if (this.dirtySet[i] === 0) { this.dirtySet[i] = 1; this.dirty.push(i); }
  };
  Grid.prototype.clearDirty = function () {
    for (var k = 0; k < this.dirty.length; k++) this.dirtySet[this.dirty[k]] = 0;
    this.dirty.length = 0;
  };
  Grid.prototype.activate = function (x, y) {
    if (!this.inb(x, y)) return;
    var i = y * this.cols + x;
    if (this.type[i] === SAND && this.loose[i] === 1 && this.activeSet[i] === 0) {
      this.activeSet[i] = 1;
      this.active.push(i);
    }
  };
  Grid.prototype.activateAround = function (x, y) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) this.activate(x + dx, y + dy);
    }
  };

  // ------------------------------------------------------------ mutation
  Grid.prototype.removeSand = function (x, y) {
    if (!this.inb(x, y)) return false;
    var i = y * this.cols + x;
    if (this.type[i] !== SAND) return false;
    this.type[i] = AIR;
    this.loose[i] = 0;
    this.dug[i] = 1;
    if (this.topSolidCache[x] === y) this.topSolidCache[x] = y + 1;
    this.markDirty(i);
    this.activateAround(x, y);
    return true;
  };

  Grid.prototype.placeSand = function (x, y, loose) {
    if (!this.inb(x, y)) return false;
    var i = y * this.cols + x;
    if (this.type[i] === SAND) return false;
    this.type[i] = SAND;
    this.shade[i] = this.rollShade();
    this.loose[i] = loose ? 1 : 0;
    this.dug[i] = 0;
    this.room[i] = 0;
    if (y < this.topSolidCache[x]) this.topSolidCache[x] = y;
    this.markDirty(i);
    if (loose) { this.activeSet[i] = 1; this.active.push(i); }
    this.activateAround(x, y);
    return true;
  };

  Grid.prototype.moveGrain = function (x0, y0, x1, y1) {
    var i0 = y0 * this.cols + x0, i1 = y1 * this.cols + x1;
    this.type[i1] = SAND;
    this.shade[i1] = this.shade[i0];
    this.loose[i1] = 1;
    this.dug[i1] = 0;
    this.type[i0] = AIR;
    this.loose[i0] = 0;
    if (y1 < this.topSolidCache[x1]) this.topSolidCache[x1] = y1;
    if (this.topSolidCache[x0] === y0) this.topSolidCache[x0] = y0 + 1;
    this.markDirty(i0);
    this.markDirty(i1);
    this.activateAround(x0, y0);
    this.activate(x1, y1);
  };

  /* A grain rests here only with sand underneath *and* sand under both
   * shoulders - the 45 degree rule the ants build their hill by. */
  Grid.prototype.supported = function (x, y) {
    return this.solid(x, y + 1) && this.solid(x - 1, y + 1) && this.solid(x + 1, y + 1);
  };

  /* Settle loose spoil.  Straight down when there is a hole below,
   * otherwise slide diagonally off an over-steep shoulder. */
  Grid.prototype.stepPhysics = function (budget) {
    var work = Math.min(budget, this.active.length);
    if (work <= 0) { return; }
    var carry = [];
    for (var k = 0; k < work; k++) {
      var i = this.active[k];
      this.activeSet[i] = 0;
      if (this.type[i] !== SAND || this.loose[i] !== 1) continue;
      var y = (i / this.cols) | 0, x = i - y * this.cols;
      if (y + 1 >= this.rows) continue;
      if (this.isAir(x, y + 1)) { this.moveGrain(x, y, x, y + 1); continue; }
      var bl = this.solid(x - 1, y + 1), br = this.solid(x + 1, y + 1);
      if (bl && br) continue;                         // stable
      var left = !bl && this.isAir(x - 1, y + 1) && this.isAir(x - 1, y);
      var right = !br && this.isAir(x + 1, y + 1) && this.isAir(x + 1, y);
      var d = 0;
      if (left && right) d = this.rng.sign();
      else if (left) d = -1;
      else if (right) d = 1;
      else continue;
      this.moveGrain(x, y, x + d, y + 1);
    }
    // keep whatever we did not get to this frame
    if (work >= this.active.length) this.active.length = 0;
    else {
      carry = this.active.slice(work);
      this.active = carry;
    }
  };

  // ----------------------------------------------------------- traversal
  /* Air touching sand: ants walk floors, climb walls and hang from ceilings. */
  Grid.prototype.walkable = function (x, y) {
    if (!this.inb(x, y)) return false;
    if (this.type[y * this.cols + x] !== AIR) return false;
    for (var d = 0; d < 8; d++) {
      if (this.solid(x + root.DIR8X[d], y + root.DIR8Y[d])) return true;
    }
    return false;
  };

  Grid.prototype.nearestWalkable = function (x, y, r) {
    if (this.walkable(x, y)) return { x: x, y: y };
    for (var rad = 1; rad <= r; rad++) {
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          if (this.walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  };

  /* Air neighbours of a grain an ant could stand in while working it. */
  Grid.prototype.workStations = function (x, y) {
    var out = [];
    for (var d = 0; d < 8; d++) {
      var nx = x + root.DIR8X[d], ny = y + root.DIR8Y[d];
      if (this.walkable(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  };

  /* First sand hit walking a ray in world pixels; returns the contact point
   * on the grain's face.  Feet use this to find real footholds. */
  Grid.prototype.rayHit = function (px, py, dx, dy, maxLen) {
    var c = this.cell;
    var steps = Math.max(2, Math.ceil(maxLen / (c * 0.45)));
    var sx = dx * (maxLen / steps), sy = dy * (maxLen / steps);
    var x = px, y = py;
    for (var s = 1; s <= steps; s++) {
      var nx = x + sx, ny = y + sy;
      var gx = Math.floor(nx / c), gy = Math.floor(ny / c);
      if (gy >= this.rows) return { x: nx, y: this.rows * c, hit: true, d: s * (maxLen / steps) };
      if (this.solid(gx, gy)) {
        return { x: x, y: y, hit: true, d: (s - 1) * (maxLen / steps) };
      }
      x = nx; y = ny;
    }
    return { x: x, y: y, hit: false, d: maxLen };
  };

  /* Average outward direction of nearby sand -> the substrate normal.
   * This is what lets an ant orient to a floor, wall or ceiling. */
  Grid.prototype.surfaceNormal = function (px, py, out) {
    var c = this.cell;
    var cx = Math.floor(px / c), cy = Math.floor(py / c);
    var nx = 0, ny = 0, count = 0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        if (!this.solid(cx + dx, cy + dy)) continue;
        var d2 = dx * dx + dy * dy;
        var w = 1 / d2;
        nx -= dx * w; ny -= dy * w;
        count++;
      }
    }
    if (!count) { out.x = 0; out.y = -1; return out; }
    var len = Math.sqrt(nx * nx + ny * ny);
    if (len < 1e-5) { out.x = 0; out.y = -1; return out; }
    out.x = nx / len; out.y = ny / len;
    return out;
  };

  root.Grid = Grid;
})(typeof window !== 'undefined' ? window : global);
