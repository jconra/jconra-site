/* How finished are the chambers, and where does the brood actually sit?
 *
 *   node tools/probe-rooms.js [minutes] [seed]
 *
 * Prints, for every room, how much of its planned footprint is open, and where
 * each brood item is - inside its room, or out in a gallery.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var base = path.join(__dirname, '..', 'js');
['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js']
  .forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
  });

var minutes = parseFloat(process.argv[2] || '6');
var seed = parseInt(process.argv[3] || '12345', 10);
var rng = new global.Rng(seed);
var grid = new global.Grid(200, 150, rng);
var colony = new global.Colony(grid, rng);

var firstEgg = -1, firstEggOpen = '-';
var dt = 1 / 60, steps = Math.round(minutes * 3600);
for (var s = 1; s <= steps; s++) {
  colony.update(dt);
  if (firstEgg < 0 && colony.stats.eggsLaid > 0) {
    firstEgg = s / 60;
    var r0 = colony.rooms[0];
    firstEggOpen = r0 ? colony.roomOpen(r0) + '/' + r0.cells.length : 'none';
  }
}

console.log('seed ' + seed + '  ants=' + colony.ants.length +
            '  eggs laid=' + colony.stats.eggsLaid +
            '  first egg at t=' + firstEgg + 's (room open ' + firstEggOpen + ')');
colony.rooms.forEach(function (r) {
  var open = colony.roomOpen(r);
  console.log('  ' + r.type + '@' + r.cx + ',' + r.cy + '  open ' + open + '/' +
              r.cells.length + ' (' + (100 * open / r.cells.length).toFixed(0) + '%)' +
              '  brood=' + colony.broodIn(r) + '  food=' + r.food);
});
var out = 0;
colony.brood.forEach(function (b) {
  var cx = Math.floor(b.x / grid.cell), cy = Math.floor(b.y / grid.cell);
  var rid = grid.room[cy * grid.cols + cx];
  if (!rid) out++;
});
console.log('  brood in a gallery rather than a chamber: ' + out + '/' + colony.brood.length);
