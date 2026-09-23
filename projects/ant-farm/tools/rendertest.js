/* Exercise the renderer without a browser.
 *
 * A stub 2D context records nothing but checks everything: every numeric
 * argument must be finite, and every fill/stroke style must be a string the
 * canvas could parse.  A NaN in one leg's IK would otherwise silently blank a
 * whole ant, and there is no way to see that from Node.
 *
 *   node tools/rendertest.js [seconds] [seed]
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var base = path.join(__dirname, '..', 'js');

var problems = [];
function note(msg) {
  if (problems.length < 40) problems.push(msg);
}

var STYLE = /^(#|rgb|rgba|hsl|hsla)/;
function stubCtx(w, h) {
  var ctx = {
    canvas: { width: w, height: h },
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textBaseline: 'alphabetic', imageSmoothingEnabled: true,
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    createImageData: function (cw, ch) {
      return { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
    },
    putImageData: function () {},
    measureText: function (s) { return { width: String(s).length * 6 }; },
    drawImage: function () {}
  };
  var numeric = ['fillRect', 'clearRect', 'strokeRect', 'moveTo', 'lineTo', 'arc',
    'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'rotate', 'scale',
    'transform', 'setTransform', 'arcTo', 'rect'];
  numeric.forEach(function (name) {
    ctx[name] = function () {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (typeof v === 'number' && !isFinite(v)) {
          note(name + ' argument ' + i + ' is ' + v);
          return;
        }
      }
    };
  });
  ['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip',
   'fillText', 'strokeText'].forEach(function (name) {
    ctx[name] = function () {};
  });
  /* Styles are set far more often than they are read, so watch them on write. */
  ['fillStyle', 'strokeStyle'].forEach(function (prop) {
    var v = '#000';
    Object.defineProperty(ctx, prop, {
      get: function () { return v; },
      set: function (nv) {
        // a gradient object is as valid a style as a colour string
        var ok = nv && typeof nv === 'object' && typeof nv.addColorStop === 'function';
        if (!ok && (typeof nv !== 'string' || !STYLE.test(nv) || /NaN|undefined/.test(nv))) {
          note(prop + ' set to ' + nv);
        }
        v = nv;
      }
    });
  });
  return ctx;
}

global.document = {
  readyState: 'complete',
  addEventListener: function () {},
  createElement: function () {
    var c = { width: 300, height: 150 };
    c.getContext = function () { return stubCtx(c.width, c.height); };
    return c;
  }
};

['config.js', 'util.js', 'grid.js', 'pheromone.js', 'ant.js', 'colony.js', 'render.js']
  .forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
  });

/* Long enough that the fed colony has founded, dug chambers and raised a few
 * workers - the founding queen does not finish her first cell until ~250 s and
 * her first daughters do not emerge until ~500 s, so a shorter run has little
 * but a lone digger to draw.  An egg is deliberately slow to hatch and the
 * founding cell holds only a couple at a time, so the second nursery and a
 * proper workforce do not turn up until well into the run. */
var secs = parseFloat(process.argv[2] || '1200');
var seed = parseInt(process.argv[3] || '4242', 10);
var rng = new global.Rng(seed);
var grid = new global.Grid(200, 150, rng);
var colony = new global.Colony(grid, rng);

var canvas = global.document.createElement('canvas');
canvas.width = 800; canvas.height = 600;
var renderer = new global.Renderer(canvas, grid, colony);
renderer.scale = 1;
renderer.showPhero = true;              // exercise the overlay too

var dt = 1 / 60, frames = 0, drawn = 0, drawMs = 0;
var t0 = Date.now();
/* Food is scarce and user-supplied now, so a headless colony has to be fed or
 * it never grows past the founding queen and there is nothing to draw.  Drop a
 * handful near the entrance every few seconds, standing in for a user. */
var feedTimer = 20;
for (var s = 1; s <= secs * 60; s++) {
  colony.update(dt);
  feedTimer -= dt;
  if (feedTimer <= 0) {
    feedTimer = 6;
    colony.dropFood(colony.entrance.x * global.CFG.cell + rng.range(-40, 40),
                    (grid.surfaceRow - 3) * global.CFG.cell);
  }
  frames++;
  // draw every frame for the first ten seconds, then sample
  if (s < 600 || s % 7 === 0) {
    var d0 = process.hrtime.bigint();
    renderer.draw();
    drawMs += Number(process.hrtime.bigint() - d0) / 1e6;
    drawn++;
  }
}
var ms = Date.now() - t0;
/* Only the geometry, not the rasterising a real canvas would do - but this is
 * the half of the frame budget the renderer is responsible for. */
console.log('draw geometry ' + (drawMs / drawn).toFixed(2) + ' ms/frame  (scent overlay ' +
            (renderer.showPhero ? 'on' : 'off') + ')');

/* Some things are rare enough that a ten minute run may not contain one, so
 * stage them deliberately: a corpse being carried, a refuse pile, an ant with
 * each kind of load, a sleeper, a queen mid-lay, and both sorts of intruder. */
var staged = 0;
colony.spawnIntruder();
colony.spawnIntruder();
colony.intruders.forEach(function (f, i) {
  f.kind = i === 0 ? 'beetle' : 'rival';
  f.hp = i === 0 ? 1 : 0.4;
  staged++;
});
colony.middenPile.push({ x: 100, y: 200, r: 2, a: 1 });
var kinds = ['sand', 'food', 'egg', 'corpse'];
colony.ants.forEach(function (a, i) {
  if (i >= kinds.length) return;
  staged++;
  if (kinds[i] === 'sand') a.load = global.CFG.loadCapacity;
  else if (kinds[i] === 'corpse') a.carrying = { kind: 'corpse', body: null };
  else if (kinds[i] === 'egg') {
    // a real brood item, so the carrier is a genuine nurse the sim can reason
    // about - not a fabricated load with no grub behind it
    if (colony.brood.length) colony.pickUpBrood(a, colony.brood[0]);
    else a.carrying = { kind: 'food', amount: 0.5 };
  } else a.carrying = { kind: kinds[i], amount: 0.5 };
});
if (colony.ants.length > 5) { colony.ants[5].sleeping = true; staged++; }
if (colony.ants.length > 6) { colony.ants[6].maturity = 0.05; staged++; }
if (colony.queen) { colony.queen.gasterPulse = 1; colony.queen.mandible = 1; staged++; }
// the feeding marker only exists while a real mouse is over a real tank
renderer.pointer = { x: 140, y: 90, idle: 0.4, fade: 0.7 };
staged++;
if (colony.ants.length > 7) colony.killAnt(colony.ants[7], 'test');
for (var f2 = 0; f2 < 30; f2++) { colony.update(dt); renderer.draw(); drawn++; }
console.log('staged ' + staged + ' rare cases, corpses now ' + colony.corpses.length);

/* Did we actually draw anything interesting?  A test that passes because the
 * colony died in the first minute is worthless. */
var eggs = 0, larvae = 0, pupae = 0;
colony.brood.forEach(function (b) {
  if (b.stage === 'egg') eggs++; else if (b.stage === 'larva') larvae++; else pupae++;
});
console.log('sim ' + secs + 's  frames=' + frames + ' drawn=' + drawn +
            '  ants=' + colony.ants.length + ' corpses=' + colony.corpses.length +
            ' brood=' + eggs + '/' + larvae + '/' + pupae +
            ' items=' + colony.items.length + ' rooms=' + colony.rooms.length +
            ' intruders=' + colony.intruders.length +
            ' midden=' + colony.middenPile.length +
            '  ' + ms + 'ms');

var fail = [];
if (colony.ants.length < 4) fail.push('colony too small to have drawn much');
if (!colony.rooms.length) fail.push('no chambers dug');
if (problems.length) fail.push(problems.length + ' canvas problems');
problems.forEach(function (p) { console.log('  ! ' + p); });

if (fail.length) {
  console.log('FAIL: ' + fail.join('; '));
  process.exit(1);
}
console.log('OK');
