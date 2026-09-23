/* Is every grain of sand accounted for?
 *
 * The grid is meant to conserve mass: a grain an ant removes is a grain it is
 * carrying, and a grain it puts down is back in the grid.  Nothing should ever
 * simply cease to exist.  This walks the whole field every few seconds and
 * checks
 *
 *     sand cells + grains in mandibles  ==  the total we started with
 *
 *   node tools/masstest.js [minutes] [seed]
 *
 * Any drift is a leak, and the report says which way it went.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var base = path.join(__dirname, '..', 'js');
['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js']
  .forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
  });

var minutes = parseFloat(process.argv[2] || '5');
var seed = parseInt(process.argv[3] || '12345', 10);
var rng = new global.Rng(seed);
var grid = new global.Grid(200, 150, rng);
var colony = new global.Colony(grid, rng);
var SAND = global.Grid.SAND;

function sandCells() {
  var n = 0;
  for (var i = 0; i < grid.n; i++) if (grid.type[i] === SAND) n++;
  return n;
}
/* Grains in transit: in a living ant's mandibles, or still held by a corpse
 * that has not been carted off yet. */
function carried() {
  var n = 0, i;
  for (i = 0; i < colony.ants.length; i++) n += colony.ants[i].load;
  for (i = 0; i < colony.corpses.length; i++) n += colony.corpses[i].load || 0;
  return n;
}

var start = sandCells() + carried();
console.log('start: ' + start + ' grains  (' + sandCells() + ' in the grid, ' +
            carried() + ' carried)');

var dt = 1 / 60, worst = 0, worstAt = 0;
var steps = Math.round(minutes * 60 * 60);
for (var s = 1; s <= steps; s++) {
  colony.update(dt);
  if (s % (30 * 60) === 0) {
    var total = sandCells() + carried();
    var drift = total - start;
    if (Math.abs(drift) > Math.abs(worst)) { worst = drift; worstAt = s / 60; }
    console.log('t=' + (s / 60) + 's  grains=' + total + '  drift=' +
                (drift > 0 ? '+' : '') + drift +
                '  (moved=' + colony.stats.grainsMoved + ')');
  }
}

var end = sandCells() + carried();
var drift = end - start;
console.log('end: ' + end + ' grains, drift ' + (drift > 0 ? '+' : '') + drift +
            '  worst ' + (worst > 0 ? '+' : '') + worst + ' at t=' + worstAt + 's');

/* Sand cells + grains in transit (in mandibles and on corpses) must equal the
 * total we started with, exactly.  Every grain an ant digs is carried out and
 * tipped onto the hill - nothing is destroyed and nothing is created. */
if (drift !== 0) {
  console.log('FAIL: ' + Math.abs(drift) + ' grains ' +
              (drift < 0 ? 'destroyed' : 'created from nothing'));
  process.exit(1);
}
console.log('OK: mass conserved');
