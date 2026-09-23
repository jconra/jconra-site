/* Screensaver shell: size the tank to the window, step the simulation on a
 * fixed clock, draw once per frame.
 *
 * The simulation is stepped in slices of at most CFG.maxDt.  Sand and legs are
 * both resolved per step, so one huge dt after the browser has been busy
 * elsewhere would teleport ants through walls; several small steps will not.
 */
(function (root) {
  'use strict';

  var CFG = root.CFG;

  // seconds the feeding marker is held after the mouse stops, and then fades over
  var POINTER_HOLD = 2.0, POINTER_FADE = 0.9;

  function Farm(canvas) {
    this.canvas = canvas;
    this.paused = false;
    this.stepOnce = false;
    this.speed = 1;
    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.resize();
  }

  Farm.prototype.resize = function () {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(320, window.innerWidth);
    var h = Math.max(240, window.innerHeight);
    /* The grid is sized in whole grains, and the canvas to match, so a grain is
     * always exactly CFG.cell CSS pixels - no half-grain seams. */
    var cols = Math.floor(w / CFG.cell);
    var rows = Math.floor(h / CFG.cell);
    this.canvas.style.width = (cols * CFG.cell) + 'px';
    this.canvas.style.height = (rows * CFG.cell) + 'px';
    this.canvas.width = Math.round(cols * CFG.cell * dpr);
    this.canvas.height = Math.round(rows * CFG.cell * dpr);
    this.build(cols, rows, dpr);
  };

  Farm.prototype.build = function (cols, rows, dpr) {
    this.rng = new root.Rng(this.seed);
    this.grid = new root.Grid(cols, rows, this.rng);
    this.colony = new root.Colony(this.grid, this.rng);
    this.renderer = new root.Renderer(this.canvas, this.grid, this.colony);
    this.renderer.scale = dpr;
    if (this.hud !== undefined) this.renderer.showHud = this.hud;
    if (this.phero !== undefined) this.renderer.showPhero = this.phero;
    this.last = 0;
  };

  Farm.prototype.restart = function () {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.hud = this.renderer.showHud;
    this.phero = this.renderer.showPhero;
    this.resize();
  };

  Farm.prototype.frame = function (now) {
    var raw = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    // a tab that was in the background must not dump a minute of sand at once
    if (raw > 0.25) raw = 0.25;
    var dt = raw * CFG.timeScale * this.speed;
    if (this.stepOnce) { dt = CFG.maxDt; this.stepOnce = false; }
    else if (this.paused) dt = 0;
    while (dt > 1e-4) {
      var step = Math.min(dt, CFG.maxDt);
      this.colony.update(step);
      dt -= step;
    }
    /* The feeding marker ages in real seconds, not simulated ones - it belongs to
     * the mouse and not to the colony, so it fades on its own while the tank is
     * paused or crawling along at a fraction of real time. */
    var ptr = this.pointer;
    if (ptr) {
      ptr.idle += raw;
      ptr.fade = Math.min(1, Math.max(0, 1 - (ptr.idle - POINTER_HOLD) / POINTER_FADE));
      if (ptr.fade <= 0) this.pointer = null;
    }
    this.renderer.pointer = this.pointer;
    this.renderer.draw();
  };

  // ------------------------------------------------------------------ boot
  function boot() {
    var canvas = document.getElementById('farm');
    var farm = new Farm(canvas);
    root.farm = farm;

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      // rebuilding the world is expensive; wait for the drag to finish
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { farm.restart(); }, 250);
    });

    /* Feed the colony by clicking the tank.  Food is the colony's only resource
     * and deliberately scarce, so the user is the source of it: a click scatters
     * a handful of scraps in world coordinates, and holding and dragging keeps
     * scattering along the trail - handy for feeding a spread-out surface. */
    function tankToWorld(e) {
      var rect = canvas.getBoundingClientRect();
      // the CSS box is cols*cell by rows*cell, so client px map straight to
      // world px once the rect offset is removed - no dpr in world space
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    /* The tank hides the system cursor - it is a screensaver - so the renderer
     * draws the pointer instead, as a marker showing where a click would scatter
     * food.  Without it the mouse simply vanishes over the tank and feeding is a
     * guess.  It is remembered in world px and fades once the mouse stops. */
    function markPointer(e) {
      var p = tankToWorld(e);
      farm.pointer = { x: p.x, y: p.y, idle: 0, fade: 1 };
    }
    var feeding = false, dragAccum = 0;
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      feeding = true; dragAccum = 0;
      var p = tankToWorld(e);
      markPointer(e);
      farm.colony.dropFood(p.x, p.y);
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      // the settings panel sits over the tank and has its own real cursor
      if (e.target !== canvas) { if (!feeding) farm.pointer = null; return; }
      markPointer(e);
      if (!feeding) return;
      // throttle the drag so a slow drag does not carpet the tank
      dragAccum += 1;
      if (dragAccum < 3) return;
      dragAccum = 0;
      var p = tankToWorld(e);
      farm.colony.dropFood(p.x, p.y, Math.max(2, Math.round(CFG.clickFlakes / 2)));
    });
    window.addEventListener('mouseup', function () { feeding = false; });
    canvas.addEventListener('mouseleave', function () { farm.pointer = null; });
    // a tap on a touch screen feeds too
    canvas.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      if (!t) return;
      var p = tankToWorld(t);
      farm.colony.dropFood(p.x, p.y);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      // let the settings sliders have their arrow keys and space to themselves
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON')) return;
      var k = e.key;
      if (k === ' ') { farm.paused = !farm.paused; e.preventDefault(); }
      else if (k === '.') { farm.stepOnce = true; }
      else if (k === 'h' || k === 'H') farm.renderer.showHud = !farm.renderer.showHud;
      else if (k === 'p' || k === 'P') farm.renderer.showPhero = !farm.renderer.showPhero;
      else if (k === 'r' || k === 'R') farm.restart();
      else if (k === '+' || k === '=') farm.speed = Math.min(8, farm.speed * 1.5);
      else if (k === '-' || k === '_') farm.speed = Math.max(0.125, farm.speed / 1.5);
      else if (k === '1') farm.speed = 1;
    });

    (function loop(t) {
      farm.frame(t);
      requestAnimationFrame(loop);
    })(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  root.Farm = Farm;
})(window);
