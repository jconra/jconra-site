/* Headless soak test for the simulation (no canvas involved).
 *   node tools/simtest.js [minutes] [seed]
 * Runs the colony at a fixed 60 Hz and prints a progress report, so the
 * behaviour and physics can be checked without watching a browser.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var base = path.join(__dirname, '..', 'js');
var files = ['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js'];
files.forEach(function (f) {
  var src = fs.readFileSync(path.join(base, f), 'utf8');
  vm.runInThisContext(src, { filename: f });
});

/* The default run is long enough for the founding queen to raise her first
 * workers.  She hauls every grain of spoil to the surface herself - there is no
 * magic reservoir - so founding is unhurried: she lays around t=270s and the
 * first daughters emerge about a hundred seconds after that.
 *
 * Food is scarce and user-supplied, so the test feeds the colony on a timer
 * (standing in for a user clicking); a `0` third-of-a-flag argument turns that
 * off to soak the unfed famine path, where the colony dwindles to a dozing
 * queen instead of growing. */
var minutes = parseFloat(process.argv[2] || '10');
var seed = parseInt(process.argv[3] || '12345', 10);
var feed = process.argv[4] !== '0';
var feedGap = 7;

var W = 800, H = 600;
var cell = global.CFG.cell;
var cols = Math.floor(W / cell), rows = Math.floor(H / cell);
var rng = new global.Rng(seed);
var grid = new global.Grid(cols, rows, rng);
var colony = new global.Colony(grid, rng);

console.log('grid ' + cols + 'x' + rows + '  surfaceRow=' + grid.surfaceRow +
            '  sandDepth=' + grid.sandDepth);

var dt = 1 / 60;
var steps = Math.round(minutes * 60 * 60);
var report = Math.round(30 * 60);
var t0 = Date.now();
var feedTimer = 20;
for (var s = 1; s <= steps; s++) {
  colony.update(dt);
  if (feed) {
    feedTimer -= dt;
    if (feedTimer <= 0) {
      feedTimer = feedGap;
      colony.dropFood(colony.entrance.x * cell + rng.range(-40, 40),
                      (grid.surfaceRow - 3) * cell);
    }
  }
  if (s % report === 0) {
    var eggs = 0, larvae = 0, pupae = 0;
    colony.brood.forEach(function (b) {
      if (b.stage === 'egg') eggs++; else if (b.stage === 'larva') larvae++; else pupae++;
    });
    var tasks = {};
    colony.ants.forEach(function (a) {
      var k = a.task ? a.task.kind : 'idle';
      tasks[k] = (tasks[k] || 0) + 1;
    });
    var causes = function () {
      var by = {};
      colony.corpses.forEach(function (a) { by[a.cause || '?'] = (by[a.cause || '?'] || 0) + 1; });
      var k = Object.keys(by);
      return k.length ? '(' + k.map(function (c) { return c + ':' + by[c]; }).join(',') + ')' : '';
    };
    var deepest = 0;
    for (var x = 0; x < cols; x++) {
      for (var y = rows - 1; y > grid.surfaceRow; y--) {
        if (grid.isDug(x, y)) { if (y > deepest) deepest = y; break; }
      }
    }
    console.log(
      't=' + (s / 60).toFixed(0) + 's' +
      ' ants=' + colony.ants.length +
      ' brood=' + eggs + '/' + larvae + '/' + pupae +
      ' rooms=' + colony.rooms.map(function (r) { return r.type[0] + r.cy; }).join(',') +
      ' jobs=' + colony.activeJobs() + '(' + colony.remainingDigCells() + ' cells)' +
      ' moved=' + colony.stats.grainsMoved +
      ' deepest=row' + deepest + ' (' + ((deepest - grid.surfaceRow) / grid.sandDepth * 100).toFixed(0) + '% down)' +
      ' food=' + colony.stats.foodStored + ' famine=' + colony.famine().toFixed(2) +
      ' deaths=' + colony.stats.deaths + causes() +
      ' | ' + JSON.stringify(tasks));
  }
}
var wall = (Date.now() - t0) / 1000;
console.log('--- ' + steps + ' ticks in ' + wall.toFixed(1) + 's (' +
            (steps / wall).toFixed(0) + ' ticks/s, ' +
            (steps / wall / 60).toFixed(1) + 'x realtime)');

// sanity checks
var errs = [];
// a fed colony must grow; an unfed one is meant to dwindle to a dozing queen,
// so only require growth when we were actually feeding it
if (feed && colony.ants.length < 2) errs.push('colony did not grow past the queen');
if (colony.stats.eggsLaid < 1) errs.push('no eggs laid');
colony.rooms.forEach(function (r) {
  if (r.type === 'nursery') {
    var frac = (r.cy - grid.surfaceRow) / grid.sandDepth;
    if (frac < global.CFG.eggDepthFraction - 1e-9) {
      errs.push('nursery ' + r.id + ' too shallow: ' + (frac * 100).toFixed(1) + '%');
    }
  }
});
colony.brood.forEach(function (b) {
  var f = (Math.floor(b.y / cell) - grid.surfaceRow) / grid.sandDepth;
  if (f < global.CFG.eggDepthFraction - 0.03 && !b.heldBy) {
    errs.push('brood ' + b.id + ' resting at only ' + (f * 100).toFixed(1) + '% depth');
  }
});
// every loose grain must satisfy the angle of repose
var unstable = 0;
for (var y = 0; y < rows; y++) {
  for (var x = 0; x < cols; x++) {
    var i = y * cols + x;
    if (grid.type[i] === 1 && grid.loose[i] === 1 && !grid.supported(x, y)) unstable++;
  }
}
if (grid.active.length === 0 && unstable > 0) errs.push(unstable + ' loose grains left unsupported');
if (errs.length) { console.log('FAIL:\n  ' + errs.join('\n  ')); process.exitCode = 1; }
else console.log('OK');
