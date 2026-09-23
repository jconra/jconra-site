/* Drawing.  The simulation knows nothing about this file.
 *
 * Two layers:
 *   - the terrain, painted once into an offscreen canvas and thereafter only
 *     where grid.dirty says a grain changed.  30,000 cells is far too many to
 *     repaint at 60 fps, and a nest at rest changes a handful of cells a frame.
 *   - everything alive, redrawn every frame straight onto the visible canvas.
 *
 * The ants are the point of the whole thing, so they get real anatomy: three
 * body sections joined by a waist, a jointed leg solved with two-bone IK to the
 * foot the simulation actually planted, compound eyes, sickle mandibles and
 * elbowed antennae.
 */
(function (root) {
  'use strict';

  var CFG = root.CFG, U = root.U;

  // =============================================================== palettes
  /* Sand colour is a function of depth and of the grain's own shade roll, so
   * neighbouring grains differ but a band of sand still reads as one stratum.
   * Precomputed into strings: building 30,000 hsl() strings a frame would cost
   * more than the fills. */
  var BANDS = 24;
  var PAL_SAND = [], PAL_SPOIL = [], PAL_VOID = [];

  function hsl(h, s, l) {
    return 'hsl(' + h.toFixed(0) + ',' + s.toFixed(0) + '%,' + l.toFixed(0) + '%)';
  }

  function buildPalettes() {
    var P = CFG.sandPalette;
    for (var b = 0; b < BANDS; b++) {
      var d = b / (BANDS - 1);
      // pale dry sand at the top, damp red clay at the bottom
      var h = U.lerp(41, 19, d), s = U.lerp(38, 31, d), l = U.lerp(67, 21, d);
      var sand = [], spoil = [];
      for (var k = 0; k < P; k++) {
        /* Skew the jitter so most grains sit near the band colour and a few are
         * conspicuously dark or bright - that is what makes sand look granular
         * rather than dithered. */
        var u = (k + 0.5) / P - 0.5;
        var j = u * Math.abs(u) * 4;                 // -1..1, bunched at zero
        sand.push(hsl(h + j * 5, s + j * 6, U.clamp(l + j * 15, 5, 92)));
        // freshly turned spoil is aerated and catches the light
        spoil.push(hsl(h + 3 + j * 5, s + 4 + j * 6, U.clamp(l + 7 + j * 13, 6, 94)));
      }
      PAL_SAND.push(sand);
      PAL_SPOIL.push(spoil);
      // an excavated void: not black, just very little light gets down there
      PAL_VOID.push(hsl(U.lerp(28, 16, d), U.lerp(30, 24, d), U.lerp(13, 5.5, d)));
    }
  }
  buildPalettes();

  /* Chambers are plastered and used, so they read differently from a gallery -
   * enough tint that an excavated room is legible as a room, not just a wider
   * stretch of tunnel. */
  var ROOM_TINT = {
    nursery: 'rgba(196,152,92,0.30)',
    granary: 'rgba(150,178,88,0.26)',
    midden:  'rgba(40,25,20,0.34)',
    chamber: 'rgba(168,136,104,0.16)'
  };

  /* Ants smooth and plaster the walls of a chamber, and tread its floor flat.
   * Lining the edge of a room gives it a wall and a floor, which is what tells
   * a chamber apart from a wide spot in a tunnel at a glance - by far the
   * biggest single thing this file does for legibility. */
  var ROOM_WALL = {
    nursery: 'rgba(226,190,132,0.55)',
    granary: 'rgba(196,214,138,0.50)',
    midden:  'rgba(96,78,64,0.45)',
    chamber: 'rgba(212,182,146,0.42)'
  };
  var ROOM_FLOOR = {
    nursery: 'rgba(238,206,152,0.75)',
    granary: 'rgba(214,228,158,0.70)',
    midden:  'rgba(110,90,72,0.6)',
    chamber: 'rgba(226,198,162,0.6)'
  };

  // ================================================================ renderer
  function Renderer(canvas, grid, colony) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.grid = grid;
    this.colony = colony;
    this.w = grid.cols * grid.cell;
    this.h = grid.rows * grid.cell;

    this.terrain = document.createElement('canvas');
    this.terrain.width = this.w;
    this.terrain.height = this.h;
    this.tctx = this.terrain.getContext('2d');

    this.sky = document.createElement('canvas');
    this.sky.width = this.w;
    this.sky.height = this.h;
    this.buildSky();

    this.pheroCanvas = document.createElement('canvas');
    this.pheroCanvas.width = grid.cols;
    this.pheroCanvas.height = grid.rows;
    this.pctx = this.pheroCanvas.getContext('2d');
    this.pheroData = this.pctx.createImageData(grid.cols, grid.rows);

    this.showHud = true;
    this.showPhero = false;
    /* Where the mouse is, if it has moved lately: `{x, y, fade}` in world px.
     * The tank hides the system cursor, so this marker *is* the cursor. */
    this.pointer = null;
    this.roomTypes = {};
    this.roomStamp = -1;

    this.repaintTerrain();
  }

  // ------------------------------------------------------------------- sky
  Renderer.prototype.buildSky = function () {
    var c = this.sky.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0a1420');
    g.addColorStop(0.45, '#16283a');
    g.addColorStop(1, '#2c3b46');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
  };

  // --------------------------------------------------------------- terrain
  Renderer.prototype.roomTypeOf = function (id) {
    if (this.roomStamp !== this.colony.rooms.length) {
      this.roomTypes = {};
      for (var i = 0; i < this.colony.rooms.length; i++) {
        var r = this.colony.rooms[i];
        this.roomTypes[r.id] = r.type;
      }
      this.roomStamp = this.colony.rooms.length;
    }
    return this.roomTypes[id];
  };

  Renderer.prototype.bandOf = function (y) {
    var g = this.grid;
    var d = (y - g.surfaceRow) / Math.max(1, g.sandDepth);
    var b = Math.floor(U.clamp(d, 0, 0.9999) * BANDS);
    return b < 0 ? 0 : b > BANDS - 1 ? BANDS - 1 : b;
  };

  Renderer.prototype.paintCell = function (i) {
    var g = this.grid, c = g.cell, t = this.tctx;
    var y = (i / g.cols) | 0, x = i - y * g.cols;
    var px = x * c, py = y * c;
    var band = this.bandOf(y);
    if (g.type[i] === root.Grid.SAND) {
      t.fillStyle = (g.loose[i] ? PAL_SPOIL : PAL_SAND)[band][g.shade[i]];
      t.fillRect(px, py, c, c);
      /* One lit edge per grain.  Without it a wall of 4 px squares is a flat
       * field of colour; with it the sand has tooth and the tunnel mouths read
       * as holes. */
      t.fillStyle = 'rgba(255,240,205,0.055)';
      t.fillRect(px, py, c, 1);
      t.fillStyle = 'rgba(0,0,0,0.055)';
      t.fillRect(px, py + c - 1, c, 1);
      return;
    }
    t.clearRect(px, py, c, c);
    if (g.dug[i] !== 1) return;             // untouched air: let the sky show
    t.fillStyle = PAL_VOID[band];
    t.fillRect(px, py, c, c);
    var room = g.room[i];
    if (room) {
      var type = this.roomTypeOf(room);
      var tint = ROOM_TINT[type];
      if (tint) { t.fillStyle = tint; t.fillRect(px, py, c, c); }
      var wall = ROOM_WALL[type];
      if (wall) {
        /* The ceiling and side walls get a plastered edge; the floor gets a
         * brighter, thicker one, because a swept floor with brood or stores on
         * it is what a chamber is for. */
        t.fillStyle = wall;
        if (g.solid(x, y - 1)) t.fillRect(px, py, c, 1);
        if (g.solid(x - 1, y)) t.fillRect(px, py, 1, c);
        if (g.solid(x + 1, y)) t.fillRect(px + c - 1, py, 1, c);
        if (g.solid(x, y + 1)) {
          t.fillStyle = ROOM_FLOOR[type] || wall;
          t.fillRect(px, py + c - 2, c, 2);
        }
      }
    }
  };

  Renderer.prototype.repaintTerrain = function () {
    this.tctx.clearRect(0, 0, this.w, this.h);
    for (var i = 0; i < this.grid.n; i++) this.paintCell(i);
    this.grid.clearDirty();
  };

  /* Repaint the changed grains, and their neighbours: an excavated cell can
   * uncover the lit edge of the grain above it. */
  Renderer.prototype.flushTerrain = function () {
    var g = this.grid, d = g.dirty;
    for (var k = 0; k < d.length; k++) {
      var i = d[k];
      var y = (i / g.cols) | 0, x = i - y * g.cols;
      this.paintCell(i);
      if (y > 0) this.paintCell(i - g.cols);
      if (y < g.rows - 1) this.paintCell(i + g.cols);
      if (x > 0) this.paintCell(i - 1);
      if (x < g.cols - 1) this.paintCell(i + 1);
    }
    g.clearDirty();
  };

  // ================================================================== frame
  Renderer.prototype.draw = function () {
    var ctx = this.ctx, col = this.colony;
    this.flushTerrain();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.scale || 1, this.scale || 1);
    /* The terrain layer is one pixel per CSS pixel and gets scaled up to device
     * pixels by an exact integer factor.  Nearest-neighbour keeps the grains
     * square; smoothing would turn the sand into mush. */
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sky, 0, 0);
    ctx.drawImage(this.terrain, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (this.showPhero) this.drawPhero();

    this.drawMidden();
    this.drawStores();
    this.drawItems();
    this.drawBrood();

    var i;
    for (i = 0; i < col.corpses.length; i++) this.drawAnt(col.corpses[i]);
    for (i = 0; i < col.ants.length; i++) {
      if (col.ants[i] !== col.queen) this.drawAnt(col.ants[i]);
    }
    if (col.queen && col.queen.alive) this.drawAnt(col.queen);   // never hidden
    for (i = 0; i < col.intruders.length; i++) this.drawIntruder(col.intruders[i]);

    if (this.pointer) this.drawPointer();
    if (this.showHud) this.drawHud();
  };

  /* Where a click would scatter food.  A screensaver has no business showing an
   * arrow pointer, but a tank you feed by clicking has to show you where you are
   * pointing - so the cursor is drawn in the tank instead: a ring the size of the
   * scatter, a crosshair on the spot itself, and a few ghost scraps of exactly
   * what a click drops.  It fades out when the mouse is left alone, so a screen
   * nobody is touching goes back to being a screensaver. */
  Renderer.prototype.drawPointer = function () {
    var ctx = this.ctx, p = this.pointer;
    var a = p.fade === undefined ? 1 : p.fade;
    if (!(a > 0)) return;
    var r = Math.max(6, CFG.clickSpread);
    ctx.save();
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = 'rgba(242,228,194,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.78, 0, 0, 6.2832);
    ctx.stroke();
    // a gap in the middle of the crosshair, so the spot itself stays readable
    ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x - 3, p.y);
    ctx.moveTo(p.x + 3, p.y); ctx.lineTo(p.x + 8, p.y);
    ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y - 3);
    ctx.moveTo(p.x, p.y + 3); ctx.lineTo(p.x, p.y + 8);
    ctx.stroke();
    /* Ghost scraps, placed from the pointer's own coordinates rather than from a
     * random draw, so they sit still while the mouse does. */
    var n = Math.max(1, Math.min(5, CFG.clickFlakes));
    ctx.globalAlpha = a * 0.4;
    for (var i = 0; i < n; i++) {
      var t = i * 2.3999632 + p.x * 0.02;
      var d = r * (0.3 + 0.5 * ((i % 3) / 2));
      this.foodFlake(ctx, p.x + Math.cos(t) * d, p.y + Math.sin(t) * d * 0.7,
                     CFG.foodSize * 0.9, Math.sin(t) * 0.6);
    }
    ctx.restore();
  };

  // ------------------------------------------------------------ pheromones
  Renderer.prototype.drawPhero = function () {
    var g = this.grid, p = this.colony.phero, d = this.pheroData.data;
    var peak = Math.max(0.6, p.peak);
    for (var i = 0; i < g.n; i++) {
      var o = i * 4;
      var home = p.home[i] / peak, food = p.food[i] / peak, alarm = p.alarm[i] / peak;
      d[o] = Math.min(255, alarm * 900 + food * 60);
      d[o + 1] = Math.min(255, food * 700 + home * 90);
      d[o + 2] = Math.min(255, home * 800);
      d[o + 3] = Math.min(190, (home + food + alarm) * 420);
    }
    this.pctx.putImageData(this.pheroData, 0, 0);
    var ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(this.pheroCanvas, 0, 0, this.w, this.h);
    ctx.restore();
  };

  // --------------------------------------------------------------- clutter
  Renderer.prototype.drawMidden = function () {
    var ctx = this.ctx, m = this.colony.middenPile;
    if (!m.length) return;
    ctx.fillStyle = 'rgba(26,18,14,0.85)';
    for (var i = 0; i < m.length; i++) {
      var p = m[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.4, p.r * 0.8, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  };

  Renderer.prototype.drawStores = function () {
    var ctx = this.ctx, rooms = this.colony.rooms;
    for (var i = 0; i < rooms.length; i++) {
      var st = rooms[i].stores;
      for (var k = 0; k < st.length; k++) {
        this.foodFlake(ctx, st[k].x, st[k].y, CFG.foodSize * 0.8 * st[k].s, k * 1.7);
      }
    }
  };

  /* Forage: a bit of leaf.  Flat - much longer than it is deep - with a torn
   * base, a midrib and a couple of side veins, because that is what an ant is
   * actually seen carrying.  `r` is the half-length. */
  Renderer.prototype.foodFlake = function (ctx, x, y, r, rot) {
    var h = r * 0.42;                       // flat: the blade has no thickness
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    /* The blade: drawn tip-first, one smooth margin and one torn one, so no two
     * scraps look like the same stamped shape. */
    ctx.beginPath();
    ctx.moveTo(r, 0);                                        // tip
    ctx.bezierCurveTo(r * 0.45, -h * 0.95, -r * 0.3, -h, -r * 0.86, -h * 0.3);
    ctx.lineTo(-r, -h * 0.05);                               // the torn base...
    ctx.lineTo(-r * 0.82, h * 0.12);
    ctx.lineTo(-r * 0.97, h * 0.34);
    ctx.bezierCurveTo(-r * 0.3, h * 0.98, r * 0.45, h * 0.9, r, 0);
    ctx.closePath();
    ctx.fillStyle = '#6d9b36';               // olive, not poster-paint green
    ctx.fill();
    ctx.strokeStyle = 'rgba(38,58,20,0.55)';
    ctx.lineWidth = 0.4;
    ctx.stroke();

    // the lit half of the blade, along the upper margin
    ctx.beginPath();
    ctx.moveTo(r * 0.92, -h * 0.06);
    ctx.bezierCurveTo(r * 0.45, -h * 0.9, -r * 0.3, -h * 0.94, -r * 0.84, -h * 0.28);
    ctx.bezierCurveTo(-r * 0.3, -h * 0.3, r * 0.4, -h * 0.2, r * 0.92, -h * 0.06);
    ctx.closePath();
    ctx.fillStyle = 'rgba(186,226,132,0.42)';
    ctx.fill();

    // midrib and side veins
    ctx.strokeStyle = 'rgba(224,238,180,0.5)';
    ctx.lineWidth = Math.max(0.3, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.88, h * 0.06);
    ctx.quadraticCurveTo(0, -h * 0.06, r * 0.95, 0);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.25, r * 0.035);
    ctx.strokeStyle = 'rgba(214,232,168,0.32)';
    for (var v = -1; v <= 1; v += 2) {
      for (var k = 0; k < 2; k++) {
        var bx = -r * 0.4 + k * r * 0.55;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.quadraticCurveTo(bx + r * 0.22, v * h * 0.4, bx + r * 0.3, v * h * 0.72);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  Renderer.prototype.drawItems = function () {
    var ctx = this.ctx, it = this.colony.items;
    for (var i = 0; i < it.length; i++) {
      var o = it[i];
      if (o.dead || o.heldBy) continue;
      /* A falling scrap flutters; a landed one lies flat on the sand. */
      var spin = o.resting ? 0.12 * Math.sin(o.x * 0.7) : Math.sin(o.y * 0.06) * 0.9;
      // a scrap left to wither fades out over its last few seconds
      var fade = o.resting ? U.clamp(o.life / 12, 0.3, 1) : 1;
      ctx.globalAlpha = fade;
      this.foodFlake(ctx, o.x, o.y, CFG.foodSize, spin);
      ctx.globalAlpha = 1;
    }
  };

  // ----------------------------------------------------------------- brood
  /* One egg, wherever it happens to be: in the pile, or in a nurse's mandibles.
   * Drawn from the same place either way so a carried egg is recognisably the
   * same object that was lying in the nursery a moment ago. */
  Renderer.prototype.egg = function (ctx, x, y, rot) {
    var rx = CFG.eggSize, ry = rx * 0.62;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(248,243,224,0.96)';
    ctx.fill();
    // the chorion is glossy and slightly translucent
    ctx.strokeStyle = 'rgba(206,196,166,0.55)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.4, ry * 0.3, -0.2, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawBrood = function () {
    var ctx = this.ctx, b = this.colony.brood;
    for (var i = 0; i < b.length; i++) {
      var o = b[i];
      var sway = Math.sin(o.wob) * 0.14;
      ctx.save();
      ctx.translate(o.x, o.y);
      if (o.stage === 'egg') {
        this.egg(ctx, 0, 0, o.wob * 0.1 + sway);
      } else if (o.stage === 'larva') {
        /* A grub, curled into the comma every ant larva makes, growing through
         * the instar and twitching when it is hungry. */
        var L = U.lerp(4.5, 9, o.progress) * CFG.broodScale;
        ctx.rotate(sway);
        /* Longer than it is deep, or the comma closes up into a disc. */
        ctx.beginPath();
        ctx.moveTo(-L * 0.62, L * 0.14);
        ctx.bezierCurveTo(-L * 0.26, -L * 0.32, L * 0.4, -L * 0.26, L * 0.62, L * 0.08);
        ctx.bezierCurveTo(L * 0.36, L * 0.38, -L * 0.3, L * 0.42, -L * 0.62, L * 0.14);
        ctx.closePath();
        ctx.fillStyle = 'rgb(238,228,200)';
        ctx.fill();
        /* Just a hint of the segments: crisp stripes at this size read as a
         * humbug, not as a grub. */
        ctx.strokeStyle = 'rgba(198,180,142,0.4)';
        ctx.lineWidth = 0.4;
        for (var s = -1; s <= 1; s++) {
          ctx.beginPath();
          ctx.moveTo(s * L * 0.22, -L * 0.2);
          ctx.lineTo(s * L * 0.22 + L * 0.05, L * 0.32);
          ctx.stroke();
        }
        // the head end is narrower and darker
        ctx.beginPath();
        ctx.ellipse(L * 0.56, L * 0.07, L * 0.11, L * 0.12, 0, 0, 6.2832);
        ctx.fillStyle = 'rgba(190,168,128,0.9)';
        ctx.fill();
      } else {
        /* A naked pupa: the adult already shaped inside, pale and immobile,
         * darkening as it matures. */
        var p = o.progress;
        ctx.rotate(sway * 0.3);
        ctx.scale(CFG.broodScale, CFG.broodScale);
        var dark = 'rgb(' + (208 - p * 86).toFixed(0) + ',' +
                            (196 - p * 96).toFixed(0) + ',' +
                            (166 - p * 104).toFixed(0) + ')';
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.ellipse(-2.4, 0, 3.2, 2.2, 0, 0, 6.2832);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(1.1, 0, 1.8, 1.6, 0, 0, 6.2832);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(3.6, 0, 1.6, 1.5, 0, 0, 6.2832);
        ctx.fill();
        if (p > 0.45) {
          ctx.fillStyle = 'rgba(30,20,16,' + ((p - 0.45) * 1.6).toFixed(2) + ')';
          ctx.beginPath();
          ctx.ellipse(4.1, -0.5, 0.55, 0.5, 0, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  };

  // =================================================================== ants
  /* Chitin colour.  Cached per ant because it only moves as the ant matures:
   * a callow is pale amber for its first minute out of the pupa. */
  function antPalette(a) {
    var q = (a.maturity * 6) | 0;
    if (a._palQ === q && a._pal) return a._pal;
    var young = 1 - U.clamp(a.maturity * 1.7, 0, 1);
    var h = U.lerp(a.caste === 'queen' ? 15 : 19, 33, young) + a.hue;
    var s = U.lerp(48, 56, young);
    var l = U.lerp(a.caste === 'queen' ? 20 : 24, 55, young);
    a._pal = {
      dark: hsl(h - 3, s, l * 0.72),
      body: hsl(h, s, l),
      lit: hsl(h + 4, s * 0.92, l * 1.55),
      /* The gaster is darker than the front of the ant in most species, and the
       * contrast is most of what makes the three sections read separately. */
      gaster: hsl(h - 5, s * 1.05, l * 0.8),
      leg: hsl(h - 2, s * 0.9, l * 0.86),
      legFar: hsl(h - 4, s * 0.8, l * 0.58),
      /* Dark, but not so dark it vanishes into the head - the eye has to be
       * findable or the ant has no face. */
      eye: hsl(h - 12, 22, Math.max(8, l * 0.5))
    };
    a._palQ = q;
    return a._pal;
  }

  /* The body frame: x along the heading, y into the substrate.  Built from `up`
   * rather than from the heading alone so an ant on a wall or a tunnel roof
   * lies along the surface instead of skewing off it. */
  var _fx = { x: 0, y: 0 }, _fy = { x: 0, y: 0 };
  function bodyFrame(a) {
    _fy.x = -a.up.x; _fy.y = -a.up.y;
    var px = -a.up.y, py = a.up.x;
    if (px * Math.cos(a.angle) + py * Math.sin(a.angle) < 0) { px = -px; py = -py; }
    _fx.x = px; _fx.y = py;
  }

  var _hip = { x: 0, y: 0 }, _ik = { x: 0, y: 0, tipX: 0, tipY: 0 };

  Renderer.prototype.drawLeg = function (a, leg, colour, width) {
    var ctx = this.ctx;
    var hip = a.hipPos(leg, _hip);
    var L = a.len;
    // hind legs are the longest, front the shortest - as in life
    var span = L * (leg.row === 0 ? 0.66 : leg.row === 1 ? 0.74 : 0.84);
    var femur = span * 0.47, tibia = span * 0.53;
    /* Bend the knee away from the substrate.  The fore/aft term only decides it
     * when the foot is directly under the hip, which is exactly when a real
     * ant's knees are splayed forwards at the front and backwards behind. */
    var rowBias = leg.row === 0 ? 0.55 : leg.row === 1 ? 0.1 : -0.55;
    var bx = a.up.x + _fx.x * rowBias, by = a.up.y + _fx.y * rowBias;
    var k = U.ik2(hip.x, hip.y, leg.foot.x, leg.foot.y, femur, tibia, bx, by, _ik);
    // the tarsus: a short kinked segment between the shin and the foot
    var ax = k.x + (k.tipX - k.x) * 0.74 + a.up.x * width * 0.9;
    var ay = k.y + (k.tipY - k.y) * 0.74 + a.up.y * width * 0.9;

    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();                            // femur - the thick segment
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(k.x, k.y);
    ctx.lineWidth = width * 1.25;
    ctx.stroke();
    ctx.beginPath();                            // tibia
    ctx.moveTo(k.x, k.y);
    ctx.lineTo(ax, ay);
    ctx.lineWidth = width * 0.7;
    ctx.stroke();
    ctx.beginPath();                            // tarsus
    ctx.moveTo(ax, ay);
    ctx.lineTo(k.tipX, k.tipY);
    ctx.lineWidth = width * 0.45;
    ctx.stroke();
    /* The coxa, where the leg meets the body.  Without it the legs look pinned
     * on rather than articulated. */
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(hip.x, hip.y, width * 0.8, 0, 6.2832);
    ctx.fill();
    // a planted foot grips: show the claw dug in
    if (leg.grounded !== false && width > 0.9) {
      ctx.beginPath();
      ctx.arc(k.tipX, k.tipY, width * 0.4, 0, 6.2832);
      ctx.fill();
    }
  };

  /* Head, in body-local coordinates: x forward, y into the substrate. */
  Renderer.prototype.drawHead = function (a, pal) {
    var ctx = this.ctx, L = a.len;
    var big = a.caste === 'soldier' ? 1.26 : a.caste === 'queen' ? 1.04 : 1;
    var hx = L * 0.395, hw = L * 0.115 * big, hh = L * 0.112 * big;
    var line = Math.max(0.35, L * 0.011);
    var s, o;

    // antennae: scape out from the socket, then the elbowed funiculus
    var sweep = a.sleeping ? 0 : Math.sin(a.antennaPhase) * 0.26;
    var fold = a.sleeping ? 2.0 : 0;    // asleep, they are laid back over the body
    for (s = -1; s <= 1; s += 2) {
      var a1 = s * (0.42 + sweep + fold) + (a.mandible > 0.4 ? s * 0.1 : 0);
      var sc = L * 0.185, fu = L * 0.2;
      var bx0 = hx + hw * 0.35, by0 = s * hh * 0.45;
      var x1 = bx0 + Math.cos(a1) * sc, y1 = by0 + Math.sin(a1) * sc;
      /* The elbow between scape and funiculus is what makes an antenna read as
       * an ant's rather than a beetle's, so it is always visibly bent. */
      var a2 = a1 + s * (0.7 + Math.sin(a.antennaPhase * 1.3 + s) * 0.3);
      var x2 = x1 + Math.cos(a2) * fu, y2 = y1 + Math.sin(a2) * fu;
      ctx.strokeStyle = pal.leg;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx0, by0);
      ctx.lineTo(x1, y1);
      ctx.lineWidth = Math.max(0.55, L * 0.024);
      ctx.stroke();
      ctx.beginPath();                          // funiculus, bowed and tapering
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) * 0.5 + Math.cos(a2 + 1.5) * fu * 0.22,
                           (y1 + y2) * 0.5 + Math.sin(a2 + 1.5) * fu * 0.22, x2, y2);
      ctx.lineWidth = Math.max(0.45, L * 0.016);
      ctx.stroke();
    }

    /* The head capsule: squared behind the eyes with rounded corners, narrowing
     * to the clypeus at the front - a worker's head, not a ball. */
    ctx.beginPath();
    ctx.moveTo(hx + hw * 0.86, -hh * 0.52);
    ctx.quadraticCurveTo(hx + hw * 1.02, 0, hx + hw * 0.86, hh * 0.52);
    ctx.quadraticCurveTo(hx + hw * 0.5, hh * 0.98, hx - hw * 0.45, hh * 0.92);
    ctx.quadraticCurveTo(hx - hw * 1.06, hh * 0.8, hx - hw * 1.04, 0);
    ctx.quadraticCurveTo(hx - hw * 1.06, -hh * 0.8, hx - hw * 0.45, -hh * 0.92);
    ctx.quadraticCurveTo(hx + hw * 0.5, -hh * 0.98, hx + hw * 0.86, -hh * 0.52);
    ctx.closePath();
    ctx.fillStyle = pal.body;
    ctx.fill();
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = line;
    ctx.stroke();

    /* Mandibles: two separate sickles, drawn over the head so their shape is
     * legible.  Closed they cross in front of the clypeus; wide open they are
     * what the ant digs, fights and feeds a nestmate with. */
    var open = 0.08 + a.mandible * 0.40;
    for (s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(hx + hw * 0.62, s * hh * 0.3);
      ctx.rotate(s * open);
      /* Sickle blades: the outer margin sweeps forward, the tip hooks back in
       * towards the midline.  Straighter or longer than this and a gaping ant
       * reads as horned rather than as an ant about to bite. */
      ctx.beginPath();
      ctx.moveTo(0, -s * hh * 0.13);
      ctx.quadraticCurveTo(hw * 0.46, -s * hh * 0.24, hw * 0.78, s * hh * 0.03);
      ctx.quadraticCurveTo(hw * 0.4, s * hh * 0.03, hw * 0.04, s * hh * 0.17);
      ctx.closePath();
      ctx.fillStyle = pal.body;
      ctx.fill();
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = line * 0.8;
      ctx.stroke();
      ctx.restore();
    }
    // the clypeus: the pale plate between the mandibles
    ctx.fillStyle = pal.lit;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(hx + hw * 0.7, 0, hw * 0.22, hh * 0.34, 0, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* Compound eyes.  Set back on the side of the head, oval, and lit only by a
     * sliver - a round eye with a white dot in it looks like a cartoon. */
    ctx.fillStyle = pal.eye;
    ctx.beginPath();
    ctx.ellipse(hx + hw * 0.02, hh * 0.5, hw * 0.4, hh * 0.24, 0.25, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 0.45;                     // the far eye, over the top
    ctx.beginPath();
    ctx.ellipse(hx + hw * 0.02, -hh * 0.6, hw * 0.34, hh * 0.16, -0.25, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,245,225,0.18)';   // one sliver of shine, no more
    ctx.beginPath();
    ctx.ellipse(hx + hw * 0.06, hh * 0.42, hw * 0.26, hh * 0.07, 0.25, 0, 6.2832);
    ctx.fill();
    if (a.caste === 'queen') {                  // three ocelli between the eyes
      ctx.fillStyle = pal.lit;
      ctx.globalAlpha = 0.7;
      for (o = -1; o <= 1; o++) {
        ctx.beginPath();
        ctx.arc(hx - hw * 0.5, o * hh * 0.26, Math.max(0.28, hh * 0.07), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // a few stiff hairs on the head - ants are hairier than they look
    ctx.strokeStyle = pal.lit;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = line * 0.8;
    for (o = 0; o < 3; o++) {
      var ha = -0.7 - o * 0.5 + (a.id % 5) * 0.1;
      var hx0 = hx + Math.cos(ha) * hw * 0.9, hy0 = Math.sin(ha) * hh * 0.9;
      ctx.beginPath();
      ctx.moveTo(hx0, hy0);
      ctx.lineTo(hx0 + Math.cos(ha) * L * 0.035, hy0 + Math.sin(ha) * L * 0.035);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawCarry = function (a) {
    var ctx = this.ctx, L = a.len;
    var hp = a.headPos({ x: 0, y: 0 });
    if (a.load > 0) {
      /* A pellet of spoil, worked into a ball in the mandibles.  It grows with
       * the load, which is the clearest read on what a digger is doing. */
      var r = L * 0.05 + L * 0.05 * (a.load / CFG.loadCapacity);
      /* A shade or two deeper than the ant is standing: the spoil came from the
       * bottom of the tunnel, so it stays damp-looking on the way up. */
      var band = Math.min(BANDS - 1, this.bandOf(Math.floor(hp.y / this.grid.cell)) + 2);
      /* Three grains clumped, each its own shade: one smooth circle read as a
       * marble, and what an ant carries is a pellet of soil. */
      for (var n = 0; n < 3; n++) {
        ctx.fillStyle = PAL_SPOIL[band][(a.id * 7 + n * 9) % CFG.sandPalette];
        ctx.beginPath();
        ctx.arc(hp.x + Math.cos(n * 2.1 + a.id) * r * 0.44,
                hp.y + Math.sin(n * 2.1 + a.id) * r * 0.44, r * 0.62, 0, 6.2832);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, r, 0, 6.2832);
      ctx.stroke();
    }
    if (!a.carrying) return;
    var k = a.carrying.kind;
    if (k === 'food') this.foodFlake(ctx, hp.x, hp.y, CFG.foodSize, a.angle);
    /* Carried brood is not drawn here: the brood pass already draws the item
     * itself, and the simulation has pinned it to this ant's mandibles - so a
     * nurse carrying a larva is seen carrying a larva, not an egg. */
    // a carried corpse is drawn by the corpse pass; its position follows us
  };

  Renderer.prototype.drawAnt = function (a) {
    var ctx = this.ctx, L = a.len, pal = antPalette(a);
    var alpha = a.alive ? 1 : Math.max(0, 1 - a.deathFade);
    if (alpha <= 0.02) return;
    bodyFrame(a);

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;

    /* A shadow under the body.  It costs one ellipse and does more to seat the
     * ant on the sand than anything else here. */
    if (a.grounded) {
      var p = a.refPoint({ x: 0, y: 0 });
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.transform(_fx.x, _fx.y, _fy.x, _fy.y, 0, 0);
      ctx.beginPath();
      ctx.ellipse(-L * 0.04, L * 0.04, L * 0.3, L * 0.06, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }

    var i, legs = a.legs;
    var lw = Math.max(0.8, L * 0.038);
    for (i = 0; i < legs.length; i++) {          // far side, behind the body
      if (legs[i].side < 0) this.drawLeg(a, legs[i], pal.legFar, lw * 0.85);
    }

    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.transform(_fx.x, _fx.y, _fy.x, _fy.y, 0, 0);
    // the whole body rides a little as the legs work
    var bob = Math.sin(a.bob) * L * 0.012 * (a.sleeping ? 0.15 : 1);
    ctx.translate(0, bob);

    var queen = a.caste === 'queen';
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = Math.max(0.4, L * 0.012);

    /* Gaster.  The queen's is the reason she looks like a queen: physogastric,
     * swollen with eggs, and it visibly pulses as she lays. */
    var gx = queen ? -L * 0.355 : -L * 0.32;
    var grx = (queen ? L * 0.235 : L * 0.175);
    var gry = (queen ? L * 0.185 : L * 0.132) * (1 + a.gasterPulse * 0.1);
    ctx.beginPath();
    ctx.ellipse(gx, 0, grx, gry, 0, 0, 6.2832);
    ctx.fillStyle = pal.gaster;
    ctx.fill();
    ctx.stroke();
    /* Tergite seams.  Two are enough: any more and the gaster reads as a shell
     * rather than as overlapping plates. */
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = Math.max(0.3, L * 0.011);
    for (i = 1; i <= 2; i++) {
      var t = gx + grx * (0.45 - i * 0.55);
      var hh2 = gry * Math.sqrt(Math.max(0, 1 - Math.pow((t - gx) / grx, 2))) * 0.88;
      ctx.beginPath();
      ctx.moveTo(t, -hh2);
      ctx.quadraticCurveTo(t + grx * 0.09, 0, t, hh2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,235,200,0.09)';   // gloss along the upper curve
    ctx.beginPath();
    ctx.ellipse(gx + grx * 0.15, -gry * 0.5, grx * 0.5, gry * 0.16, -0.12, 0, 6.2832);
    ctx.fill();
    // stiff hairs along the gaster
    ctx.strokeStyle = pal.lit;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = Math.max(0.3, L * 0.009);
    for (i = 0; i < 4; i++) {
      var ga = -2.5 + i * 0.42 + (a.id % 3) * 0.12;
      var gxx = gx + Math.cos(ga) * grx * 0.94, gyy = Math.sin(ga) * gry * 0.94;
      ctx.beginPath();
      ctx.moveTo(gxx, gyy);
      ctx.lineTo(gxx + Math.cos(ga) * L * 0.04, gyy + Math.sin(ga) * L * 0.04);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // petiole and postpetiole: the wasp waist that makes an ant an ant
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.ellipse(gx + grx * 1.0, -L * 0.004, L * 0.032, L * 0.026, 0, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(gx + grx * 1.34, -L * 0.012, L * 0.026, L * 0.022, 0, 0, 6.2832);
    ctx.fill();

    /* Mesosoma, in two lobes so the profile has the humped back and the dip
     * behind it that a worker ant has. */
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = Math.max(0.4, L * 0.012);
    ctx.beginPath();
    ctx.ellipse(L * 0.03, L * 0.002, L * 0.1, L * 0.072, 0, 0, 6.2832);
    ctx.fillStyle = pal.body;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(L * 0.175, -L * 0.014, L * 0.105, L * 0.082, -0.08, 0, 6.2832);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.lit;                    // lit ridge over the pronotum
    ctx.globalAlpha = 0.26;
    ctx.beginPath();
    ctx.ellipse(L * 0.16, -L * 0.048, L * 0.078, L * 0.02, -0.1, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (queen) {
      // wing scars: she tore hers off after the mating flight
      ctx.strokeStyle = 'rgba(255,240,215,0.35)';
      ctx.lineWidth = Math.max(0.4, L * 0.016);
      for (i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(L * 0.125, i * L * 0.04);
        ctx.lineTo(L * 0.055, i * L * 0.068);
        ctx.stroke();
      }
    }
    // neck
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.ellipse(L * 0.275, -L * 0.012, L * 0.03, L * 0.04, 0, 0, 6.2832);
    ctx.fill();

    this.drawHead(a, pal);
    ctx.restore();

    for (i = 0; i < legs.length; i++) {          // near side, over the body
      if (legs[i].side > 0) this.drawLeg(a, legs[i], pal.leg, lw);
    }
    this.drawCarry(a);
    ctx.restore();
  };

  // ------------------------------------------------------------- intruders
  Renderer.prototype.drawIntruder = function (f) {
    if (!f.alive) return;
    var ctx = this.ctx, h = f.h;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle || 0);
    var legPhase = f.phase || 0;
    ctx.strokeStyle = 'rgba(15,12,10,0.9)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, h * 0.09);
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < 3; i++) {
        var px = (0.5 - i * 0.5) * h;
        var swing = Math.sin(legPhase + i * 2 + (s > 0 ? 0 : 3)) * h * 0.22;
        ctx.beginPath();
        ctx.moveTo(px, s * h * 0.2);
        ctx.lineTo(px + swing, s * h * 0.62);
        ctx.lineTo(px + swing * 1.4, s * h * 0.95);
        ctx.stroke();
      }
    }
    if (f.kind === 'beetle') {
      ctx.fillStyle = '#241d18';
      ctx.beginPath();
      ctx.ellipse(-h * 0.15, 0, h * 0.62, h * 0.42, 0, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,105,80,0.5)';  // the elytra seam
      ctx.lineWidth = Math.max(0.5, h * 0.05);
      ctx.beginPath();
      ctx.moveTo(-h * 0.72, 0);
      ctx.lineTo(h * 0.4, 0);
      ctx.stroke();
      ctx.fillStyle = '#1a1512';
      ctx.beginPath();
      ctx.ellipse(h * 0.55, 0, h * 0.26, h * 0.26, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,190,160,0.5)';
      ctx.beginPath();
      ctx.ellipse(-h * 0.3, -h * 0.2, h * 0.3, h * 0.1, -0.2, 0, 6.2832);
      ctx.fill();
    } else {
      // a rival ant: same anatomy, hostile black-and-red livery
      ctx.fillStyle = '#3a1512';
      ctx.beginPath();
      ctx.ellipse(-h * 0.42, 0, h * 0.3, h * 0.24, 0, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, h * 0.22, h * 0.19, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#511a14';
      ctx.beginPath();
      ctx.ellipse(h * 0.42, 0, h * 0.24, h * 0.23, 0, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = '#511a14';
      ctx.lineWidth = Math.max(0.6, h * 0.06);
      for (s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.moveTo(h * 0.6, s * h * 0.1);
        ctx.quadraticCurveTo(h * 0.95, s * h * 0.1, h * 1.05, s * h * 0.3);
        ctx.stroke();
      }
    }
    // damage shows as a paler shell
    if (f.hp < 1) {
      ctx.globalAlpha = U.clamp(1 - f.hp, 0, 0.6);
      ctx.fillStyle = 'rgba(180,60,40,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, h * 0.5, h * 0.35, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  };

  // ==================================================================== hud
  function famineLabel(col) {
    var f = col.famine();
    var word = f < 0.25 ? 'plentiful' : f < 0.5 ? 'lean' : f < 0.75 ? 'hungry' : 'famine';
    return word + '  (click to feed)';
  }

  Renderer.prototype.drawHud = function () {
    var ctx = this.ctx, col = this.colony, st = col.stats;
    var eggs = 0, larvae = 0, pupae = 0, i;
    for (i = 0; i < col.brood.length; i++) {
      var s = col.brood[i].stage;
      if (s === 'egg') eggs++; else if (s === 'larva') larvae++; else pupae++;
    }
    var soldiers = 0, callows = 0;
    for (i = 0; i < col.ants.length; i++) {
      if (col.ants[i].caste === 'soldier') soldiers++;
      if (col.ants[i].maturity < 0.5) callows++;
    }
    var mins = Math.floor(col.age / 60), secs = Math.floor(col.age % 60);
    var lines = [
      'ant farm   ' + mins + 'm' + (secs < 10 ? '0' : '') + secs + 's',
      'colony     ' + col.ants.length + '  (' + soldiers + ' soldiers, ' +
        callows + ' callow)' + (col.queen && col.queen.alive ? '' : '  QUEENLESS'),
      'brood      ' + eggs + ' eggs / ' + larvae + ' larvae / ' + pupae + ' pupae',
      'stores     ' + st.foodStored + ' food   ' + col.rooms.length + ' chambers',
      'larder     ' + famineLabel(col) +
        (col.layHalted ? '   queen not laying' : ''),
      'nest       ' + (st.maxDepth * 100).toFixed(0) + '% deep   ' +
        st.grainsMoved + ' grains shifted',
      'lost       ' + st.deaths
    ];
    ctx.save();
    ctx.font = '11px ui-monospace, "DejaVu Sans Mono", Menlo, monospace';
    ctx.textBaseline = 'top';
    var help = 'click feed   h hud   p scent   space pause   . step   r restart';
    var w = ctx.measureText(help).width;
    for (i = 0; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
    ctx.fillStyle = 'rgba(8,12,16,0.55)';
    ctx.fillRect(8, 8, w + 16, (lines.length + 1) * 14 + 14);
    for (i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? 'rgba(240,225,190,0.95)' : 'rgba(205,215,220,0.8)';
      ctx.fillText(lines[i], 16, 14 + i * 14);
    }
    ctx.fillStyle = 'rgba(150,165,175,0.5)';
    ctx.fillText(help, 16, 14 + lines.length * 14 + 4);
    ctx.restore();
  };

  root.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : global);
