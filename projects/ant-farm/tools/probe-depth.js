/* Is the nest deeper in the middle than at the sides?
 *
 * Runs a colony headless and prints, per column bucket, the deepest row that
 * has actually been dug alongside the floor the colony would allow there.  The
 * two should track: a lens centred on the entrance, not a level cut across the
 * tank.
 *
 * usage: node tools/probe-depth.js [minutes] [seed] [cols] [rows]
 */
var fs = require('fs'), path = require('path'), vm = require('vm');
var root = path.join(__dirname, '..');
var mins = parseFloat(process.argv[2] || '20');
var seed = parseInt(process.argv[3] || '12345', 10) >>> 0;
var cols = parseInt(process.argv[4] || '200', 10);
var rows = parseInt(process.argv[5] || '150', 10);

global.window = global;
['config', 'util', 'grid', 'pheromone', 'ant', 'colony'].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f });
});

var CFG = global.CFG;
var rng = new global.Rng(seed);
var grid = new global.Grid(cols, rows, rng);
var colony = new global.Colony(grid, rng);

var dt = CFG.maxDt, steps = Math.round(mins * 60 / dt);
for (var i = 0; i < steps; i++) colony.update(dt);

// deepest dug row per column
var deepest = new Int32Array(cols).fill(-1);
for (var x = 0; x < cols; x++) {
  for (var y = rows - 1; y > grid.surfaceRow; y--) {
    if (grid.isDug(x, y)) { deepest[x] = y; break; }
  }
}

var bucket = 10, ex = colony.entrance.x;
console.log('seed=' + seed + '  ' + cols + 'x' + rows + '  surfaceRow=' + grid.surfaceRow +
            '  sandDepth=' + grid.sandDepth + '  entrance.x=' + ex +
            '  ants=' + colony.ants.length);
console.log('budget=' + colony.workDepthRows().toFixed(1) + ' rows' +
            '  lateralCost=' + CFG.workLateralCost + '  core=' + CFG.workCoreCells);
console.log('  x range | dug to | allowed | dug depth below surface');
for (var b = 0; b < cols; b += bucket) {
  var dug = -1, allow = 0, n = 0;
  for (var k = b; k < Math.min(cols, b + bucket); k++) {
    if (deepest[k] > dug) dug = deepest[k];
    allow += colony.workFloorAt(k); n++;
  }
  allow = Math.round(allow / n);
  var depth = dug < 0 ? 0 : dug - grid.surfaceRow;
  console.log(
    String(b).padStart(4) + '-' + String(Math.min(cols, b + bucket) - 1).padStart(3) +
    ' | ' + (dug < 0 ? '   -' : String(dug).padStart(4)) +
    '   | ' + String(allow).padStart(4) + '    | ' +
    (b <= ex && ex < b + bucket ? '^' : ' ') + '#'.repeat(Math.round(depth / 2)));
}

// the shape claim, as one number each side
function meanDepth(lo, hi) {
  var s = 0, n = 0;
  for (var k = lo; k < hi; k++) if (deepest[k] > 0) { s += deepest[k] - grid.surfaceRow; n++; }
  return n ? s / n : 0;
}
var mid = meanDepth(Math.max(0, ex - 25), Math.min(cols, ex + 25));
var edgeL = meanDepth(0, Math.max(1, ex - 60));
var edgeR = meanDepth(Math.min(cols - 1, ex + 60), cols);
console.log('mean dug depth: middle=' + mid.toFixed(1) +
            '  left edge=' + edgeL.toFixed(1) + '  right edge=' + edgeR.toFixed(1));
console.log(mid > Math.max(edgeL, edgeR) + 3 ? 'OK: deeper in the middle'
                                            : 'FLAT: no lens in the dug ground');
