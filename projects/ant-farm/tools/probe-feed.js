/* Does feeding drive the colony?  Runs the sim headless and drops a handful of
 * food near the nest entrance every few simulated seconds - standing in for a
 * user clicking - then reports population, famine, stored food and how many
 * ants are foraging, so the recruitment loop and the famine throttle can be
 * checked without a browser.
 *   node tools/probe-feed.js [minutes] [feedGap] [seed]
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var base = path.join(__dirname, '..', 'js');
['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js'].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
});

var minutes = parseFloat(process.argv[2] || '12');
var feedGap = parseFloat(process.argv[3] || '8');       // simulated seconds
var seed = parseInt(process.argv[4] || '12345', 10);

var cell = global.CFG.cell, W = 800, H = 600;
var cols = Math.floor(W / cell), rows = Math.floor(H / cell);
var rng = new global.Rng(seed);
var grid = new global.Grid(cols, rows, rng);
var colony = new global.Colony(grid, rng);

var dt = 1 / 60, steps = Math.round(minutes * 60 * 60), report = 30 * 60;
var feedTimer = 20;                                     // let her found first
for (var s = 1; s <= steps; s++) {
  colony.update(dt);
  feedTimer -= dt;
  if (feedTimer <= 0) {
    feedTimer = feedGap;
    var ex = colony.entrance.x * cell + rng.range(-40, 40);
    colony.dropFood(ex, (grid.surfaceRow - 3) * cell);
  }
  if (s % report === 0) {
    var foraging = 0, loose = 0;
    colony.ants.forEach(function (a) { if (a.task && a.task.kind === 'FORAGE') foraging++; });
    colony.items.forEach(function (it) { if (it.kind === 'food' && !it.dead) loose++; });
    console.log('t=' + (s / 60).toFixed(0) + 's' +
      ' ants=' + colony.ants.length +
      ' famine=' + colony.famine().toFixed(2) +
      ' store=' + colony.totalFood() +
      ' loose=' + loose +
      ' foraging=' + foraging +
      ' laying=' + (colony.layHalted ? 'no' : 'yes') +
      ' clicks=' + colony.stats.clicks);
  }
}
console.log('final ants=' + colony.ants.length + ' eggsLaid=' + colony.stats.eggsLaid +
            ' deaths=' + colony.stats.deaths);
