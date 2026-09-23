/* Three scent fields laid over the same grid the sand uses.
 *   home  - trail back to the nest entrance / galleries
 *   food  - recruitment trail to a food find
 *   alarm - danger; recruits soldiers and repels workers
 * Trails evaporate, which is what stops the colony following stale routes.
 */
(function (root) {
  'use strict';
  var CFG = root.CFG;

  function Pheromones(cols, rows) {
    this.cols = cols; this.rows = rows;
    var n = cols * rows;
    this.home = new Float32Array(n);
    this.food = new Float32Array(n);
    this.alarm = new Float32Array(n);
    this.channels = [this.home, this.food, this.alarm];
    this.decay = [CFG.pheroDecay, CFG.pheroDecay * 0.995, 0.90];
    this.peak = 0;
  }

  Pheromones.prototype.drop = function (ch, x, y, amount) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    var f = this.channels[ch];
    var i = y * this.cols + x;
    f[i] = Math.min(CFG.pheroMax, f[i] + amount);
    if (f[i] > this.peak) this.peak = f[i];
  };

  Pheromones.prototype.at = function (ch, x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 0;
    return this.channels[ch][y * this.cols + x];
  };

  /* Evaporation only touches a quarter of the field each frame (with a
   * correspondingly larger step) - identical to the eye, a quarter of the cost
   * on a 30,000 cell grid. */
  Pheromones.prototype.update = function (dt) {
    this.slice = ((this.slice || 0) + 1) & 3;
    var n = this.home.length;
    var lo = Math.floor(n * this.slice / 4), hi = Math.floor(n * (this.slice + 1) / 4);
    for (var c = 0; c < 3; c++) {
      var f = this.channels[c];
      var k = Math.pow(this.decay[c], dt * 4);
      for (var i = lo; i < hi; i++) {
        if (f[i] > 0.001) f[i] *= k; else if (f[i] !== 0) f[i] = 0;
      }
    }
    this.peak *= 0.999;
  };

  /* Strongest neighbouring cell for a channel - the "follow the trail" step. */
  Pheromones.prototype.bestNeighbour = function (ch, x, y, grid) {
    var best = 0, bx = -1, by = -1;
    for (var d = 0; d < 8; d++) {
      var nx = x + root.DIR8X[d], ny = y + root.DIR8Y[d];
      if (!grid.walkable(nx, ny)) continue;
      var v = this.at(ch, nx, ny);
      if (v > best) { best = v; bx = nx; by = ny; }
    }
    return bx < 0 ? null : { x: bx, y: by, v: best };
  };

  root.Pheromones = Pheromones;
})(typeof window !== 'undefined' ? window : global);
