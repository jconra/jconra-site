/* An ant.
 *
 * Three parts to this file:
 *   1. locomotion  - gravity, clinging, ride height over the substrate
 *   2. the legs     - alternating tripod gait.  Each foot is anchored in
 *                     WORLD space: a planted foot does not move while the
 *                     body walks past it, and when a leg's turn comes it
 *                     swings forward and raycasts for a real foothold on the
 *                     sand (floor, wall or tunnel ceiling).
 *   3. the brain    - weighted needs -> one task at a time, plus the task
 *                     state machines (dig, haul, forage, tend, lay, ...)
 */
(function (root) {
  'use strict';
  var CFG = root.CFG, U = root.U;

  var QUEEN = 'queen', WORKER = 'worker', SOLDIER = 'soldier';

  function Ant(colony, x, y, caste, mature) {
    this.colony = colony;
    this.grid = colony.grid;
    this.rng = colony.rng;
    this.id = colony.nextAntId++;
    this.caste = caste || WORKER;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = this.rng.chance(0.5) ? 0 : Math.PI;
    this.up = { x: 0, y: -1 };
    this.alive = true;
    this.age = 0;
    this.maturity = mature ? 1 : 0;

    this.casteScale = this.caste === QUEEN ? 1.25 : (this.caste === SOLDIER ? 1.12 : 1);
    this.len = CFG.antBirthLen * this.casteScale;
    this.maxLen = CFG.antAdultLen * this.casteScale;
    if (mature) this.len = this.maxLen;
    this.height = this.len * CFG.antHeightRatio;

    this.food = 0.85;
    this.energy = 1;

    this.carrying = null;       // {kind:'sand'|'food'|'egg'|'corpse', ...}
    this.load = 0;              // grains of spoil in the mandibles

    this.task = null;
    this.taskTimer = 0;
    this.cooldown = 0;
    this.digCell = null;
    this.job = null;

    this.path = null;
    this.pi = 1;
    this.pathAge = 0;
    this.pathFails = 0;
    this.stuck = 0;
    this.baffled = 0;          // seconds of shoving without progress
    this.wantX = 0; this.wantY = 0;
    this.lastX = x; this.lastY = y;

    this.grounded = false;
    this.airTime = 0;           // seconds of unbroken free fall
    this.mandible = 0;          // 0 closed .. 1 wide
    this.mandibleTarget = 0;
    this.antennaPhase = this.rng.range(0, 6.28);
    this.bob = this.rng.range(0, 6.28);
    this.gasterPulse = 0;
    this.strideAccum = 0;
    this.swingGroup = 0;
    this.swingT = 1;
    this.sleeping = false;
    this.digBan = 0;
    this.foodBan = 0;           // nothing to fetch; get on with something else
    this.deathFade = 0;
    this.hue = this.rng.range(-8, 8);   // slight individual colour variation

    this.legs = [];
    this.initLegs();
  }

  Ant.QUEEN = QUEEN; Ant.WORKER = WORKER; Ant.SOLDIER = SOLDIER;

  // ------------------------------------------------------------ geometry
  Ant.prototype.speed = function () {
    var base = this.caste === QUEEN ? CFG.queenSpeed
      : U.lerp(CFG.speedYoung, CFG.speedAdult, this.maturity);
    if (this.caste === SOLDIER) base *= CFG.soldierSpeedMul;
    base *= 0.6 + 0.4 * this.energy;
    if (this.carrying) base *= this.carrying.kind === 'corpse' ? 0.6 : 0.82;
    /* A starving colony slows right down.  There is nothing to be gained by
     * running about on an empty crop, so ants drop to a conserving plod until
     * the larder is stocked again - which is also the clearest visual signal
     * that the nest is going hungry.  The founding queen is exempt: she runs on
     * her flight muscles, not the larder, so she digs at full pace until she
     * has daughters to forage for her. */
    base *= U.lerp(1, CFG.torporSpeed, this.colony.effectiveFamine());
    return base;
  };
  Ant.prototype.reach = function () { return this.len * CFG.reachMul; };
  Ant.prototype.stride = function () { return this.len * CFG.strideMul; };
  /* How far the body rides above the substrate, stood up on its legs. */
  Ant.prototype.rideHeight = function () { return this.height * 0.55; };

  Ant.prototype.headingVec = function (out) {
    out.x = Math.cos(this.angle); out.y = Math.sin(this.angle);
    return out;
  };
  /* Mouth position - where carried items and mandibles live. */
  Ant.prototype.headPos = function (out) {
    var c = Math.cos(this.angle), s = Math.sin(this.angle);
    var f = this.len * 0.46;
    out.x = this.x + c * f;
    out.y = this.y + s * f;
    return out;
  };

  /* Navigation happens at the ant's feet, not at the middle of its body:
   * the thorax rides a couple of grains clear of the sand, so using the body
   * centre would put the ant in an unwalkable cell whenever it stood on flat
   * ground.  Everything path-related therefore uses this reference point,
   * just above whatever the ant is standing on. */
  Ant.prototype.refPoint = function (out) {
    var r = this.rideHeight() - this.grid.cell * 0.6;
    if (r < 0) r = 0;
    out.x = this.x - this.up.x * r;
    out.y = this.y - this.up.y * r;
    return out;
  };
  /* Inverse of refPoint: put the feet somewhere and let the body follow at
   * walking height above them, leaning with whatever `up` currently is.  All
   * locomotion goes through here, so the body can never be shoved into the sand
   * by a spring pulling one way while the path pulls another. */
  Ant.prototype.setFeet = function (fx, fy) {
    var r = this.rideHeight() - this.grid.cell * 0.6;
    if (r < 0) r = 0;
    this.x = fx + this.up.x * r;
    this.y = fy + this.up.y * r;
  };
  var _ref = { x: 0, y: 0 };
  Ant.prototype.cellX = function () {
    return Math.floor(this.refPoint(_ref).x / this.grid.cell);
  };
  Ant.prototype.cellY = function () {
    return Math.floor(this.refPoint(_ref).y / this.grid.cell);
  };
  Ant.prototype.atCell = function (cx, cy, slack) {
    var c = this.grid.cell;
    var p = this.refPoint({ x: 0, y: 0 });
    var d = U.dist(p.x, p.y, (cx + 0.5) * c, (cy + 0.5) * c);
    return d < c * (slack || 1.7);
  };
  Ant.prototype.depthFraction = function () {
    var g = this.grid;
    return (this.cellY() - g.surfaceRow) / Math.max(1, g.sandDepth);
  };

  // ---------------------------------------------------------------- legs
  Ant.prototype.initLegs = function () {
    this.legs.length = 0;
    // side -1 is the far side of the body (drawn behind), +1 the near side.
    // Tripod A = front-left, mid-right, hind-left; tripod B is the other three.
    for (var row = 0; row < 3; row++) {
      for (var s = 0; s < 2; s++) {
        var side = s === 0 ? -1 : 1;
        this.legs.push({
          row: row,
          side: side,
          group: (row + (side > 0 ? 0 : 1)) % 2,
          foot: { x: this.x, y: this.y },
          from: { x: this.x, y: this.y },
          target: { x: this.x, y: this.y },
          t: 1,
          planted: false,
          grounded: false
        });
      }
    }
  };

  var _v = { x: 0, y: 0 };
  var _fp = { x: 0, y: 0 };
  var _up = { x: 0, y: -1 };
  Ant.prototype.hipPos = function (leg, out) {
    var c = Math.cos(this.angle), s = Math.sin(this.angle);
    var fore = (leg.row === 0 ? 0.20 : leg.row === 1 ? 0.06 : -0.07) * this.len;
    var para = leg.side * 0.035 * this.len;         // fake perspective offset
    var down = -0.04 * this.len;
    out.x = this.x + c * fore - s * para + (-this.up.x) * down;
    out.y = this.y + s * fore + c * para + (-this.up.y) * down;
    return out;
  };

  /* Pick the next foothold for a leg: look ahead of the hip in the walking
   * direction, then feel outwards for sand. */
  Ant.prototype.footTarget = function (leg, out) {
    var c = Math.cos(this.angle), s = Math.sin(this.angle);
    var reach = this.reach() * (leg.side > 0 ? 1.0 : 0.88);
    var hip = this.hipPos(leg, { x: 0, y: 0 });
    var fore = leg.row === 0 ? 0.85 : leg.row === 1 ? 0.08 : -0.62;
    var ahead = this.stride() * 0.6 * (this.movingForward ? 1 : 0);
    var ox = hip.x + c * ahead, oy = hip.y + s * ahead;
    // ray direction: mostly towards the substrate, splayed fore/aft
    var dx = -this.up.x + c * fore * 0.9;
    var dy = -this.up.y + s * fore * 0.9;
    var dl = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dl; dy /= dl;
    var hit = this.grid.rayHit(ox, oy, dx, dy, reach * 1.45);
    if (hit.hit) {
      out.x = hit.x; out.y = hit.y; out.grounded = true;
    } else {
      out.x = ox + dx * reach * 0.8;
      out.y = oy + dy * reach * 0.8;
      out.grounded = false;
    }
    return out;
  };

  /* Which way is "up" for this ant?
   *
   * Averaging the surrounding sand works out in the open but is useless in a
   * tunnel, where the ant is walled in on every side: the average points
   * nowhere in particular and flips about from frame to frame, which leaves
   * the ant grinding against a wall instead of walking.  So instead we feel
   * for a substrate in twelve directions and pick one, preferring (a) a
   * foothold at the right distance for the legs, (b) the floor over the
   * ceiling, and (c) whatever we were already standing on.  The last of those
   * is the important one - it is the hysteresis that keeps an ant committed to
   * the tunnel floor rather than dithering between floor and roof.
   */
  var _CAND = [];
  (function () {
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2;
      _CAND.push({ x: Math.cos(a), y: Math.sin(a) });
    }
  })();

  Ant.prototype.substrateUp = function (out) {
    var g = this.grid, c = g.cell;
    var ride = this.rideHeight();
    var maxD = Math.max(ride * 3, c * 4);
    /* When the floor stops getting the ant anywhere - a step it cannot walk
     * up, the wall of its own shaft - it rears onto whichever surface leads
     * where it wants to go, exactly as a real ant does.  `baffled` is how long
     * it has been shoving without progress. */
    var climb = U.clamp(this.baffled / 0.5, 0, 1);
    var wantX = this.wantX || 0, wantY = this.wantY || 0;
    var bestScore = -1e9, bx = 0, by = -1, any = false;
    for (var i = 0; i < 12; i++) {
      var u = _CAND[i];
      var hit = g.rayHit(this.x, this.y, -u.x, -u.y, maxD);
      if (!hit.hit) continue;
      var s = -Math.abs(hit.d - ride) / c;                    // legs' preferred stance
      s += -u.y * 1.6 * (1 - climb);                          // gravity: floors first
      s += (u.x * this.up.x + u.y * this.up.y) * 1.5 * (1 - 0.7 * climb);
      if (climb > 0) {
        // a surface is useful for climbing if we can travel along it
        s += 3.2 * climb * Math.abs(-u.y * wantX + u.x * wantY);
      }
      if (s > bestScore) { bestScore = s; bx = u.x; by = u.y; any = true; }
    }
    if (!any) { out.x = 0; out.y = -1; return out; }
    // refine with the local sand gradient, but only if it agrees about which
    // side we are on, so gentle slopes read smoothly
    g.surfaceNormal(this.x, this.y, _v);
    if (_v.x * bx + _v.y * by > 0.55) { bx += _v.x * 0.8; by += _v.y * 0.8; }
    var l = Math.sqrt(bx * bx + by * by) || 1;
    out.x = bx / l; out.y = by / l;
    return out;
  };

  Ant.prototype.updateLegs = function (dt, moved) {
    var i, leg;
    if (!this.alive) return;

    if (this.sleeping || !this.grounded) {
      // tuck the legs in against the body
      for (i = 0; i < 6; i++) {
        leg = this.legs[i];
        var hip = this.hipPos(leg, { x: 0, y: 0 });
        var tx = hip.x + (-this.up.x) * this.reach() * 0.35 + Math.cos(this.angle) * (leg.row - 1) * 2;
        var ty = hip.y + (-this.up.y) * this.reach() * 0.35 + Math.sin(this.angle) * (leg.row - 1) * 2;
        leg.foot.x = U.lerp(leg.foot.x, tx, Math.min(1, dt * 6));
        leg.foot.y = U.lerp(leg.foot.y, ty, Math.min(1, dt * 6));
        leg.t = 1; leg.planted = false;
      }
      return;
    }

    var stride = this.stride();
    this.strideAccum += moved;

    // over-stretched feet force their leg to step early
    var stretched = false;
    for (i = 0; i < 6; i++) {
      leg = this.legs[i];
      if (leg.group !== this.swingGroup && leg.planted) {
        var h = this.hipPos(leg, { x: 0, y: 0 });
        if (U.dist2(h.x, h.y, leg.foot.x, leg.foot.y) > Math.pow(this.reach() * 1.45, 2)) stretched = true;
      }
    }

    if ((this.strideAccum >= stride && this.swingT >= 1) || (stretched && this.swingT >= 1)) {
      this.strideAccum = 0;
      this.swingGroup = 1 - this.swingGroup;
      this.swingT = 0;
      for (i = 0; i < 6; i++) {
        leg = this.legs[i];
        if (leg.group !== this.swingGroup) continue;
        leg.from.x = leg.foot.x; leg.from.y = leg.foot.y;
        var t = this.footTarget(leg, { x: 0, y: 0, grounded: false });
        leg.target.x = t.x; leg.target.y = t.y;
        leg.grounded = t.grounded;
        leg.planted = false;
        leg.t = 0;
      }
    }

    if (this.swingT < 1) {
      var dur = Math.max(0.05, CFG.swingSeconds * (1 + 0.5 * (1 - this.maturity)));
      this.swingT = Math.min(1, this.swingT + dt / dur);
      var e = U.smooth(this.swingT);
      var lift = this.height * 0.5;
      for (i = 0; i < 6; i++) {
        leg = this.legs[i];
        if (leg.group !== this.swingGroup) continue;
        var arc = Math.sin(Math.PI * this.swingT) * lift;
        leg.foot.x = U.lerp(leg.from.x, leg.target.x, e) + this.up.x * arc;
        leg.foot.y = U.lerp(leg.from.y, leg.target.y, e) + this.up.y * arc;
        leg.t = this.swingT;
        if (this.swingT >= 1) leg.planted = true;
      }
    }
    // planted feet are simply left where they are: the body walks past them.
  };

  // --------------------------------------------------------- locomotion
  /* Can any leg reach sand from where the feet are?  Testing the feet's own
   * cell and its eight neighbours is not enough: mid-stride the feet sit on a
   * cell corner, and in a three-grain-wide gallery the cell they round into can
   * be one the legs never touch - which had ants free-falling down their own
   * tunnels.  A radius in pixels is both cheaper to reason about and closer to
   * what an ant really does, which is brace against whatever is within reach. */
  Ant.prototype.legReach = function () {
    return Math.max(this.grid.cell * 1.7, this.height * 0.8);
  };

  /* Nearest grain to a point, searched out to leg reach.  `d` is Infinity when
   * there is nothing to hold on to.  Both the support test and the grip below
   * read this, so they can never disagree about what the ant is standing on. */
  var _grain = { x: 0, y: 0, d: Infinity };
  Ant.prototype.nearestGrain = function (px, py) {
    var g = this.grid, c = g.cell;
    var R = this.legReach(), best = R * R + 1e-6, out = _grain;
    out.d = Infinity;
    var x0 = Math.floor((px - R) / c), x1 = Math.floor((px + R) / c);
    var y0 = Math.floor((py - R) / c), y1 = Math.floor((py + R) / c);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (!g.solid(x, y)) continue;
        var gx = (x + 0.5) * c, gy = (y + 0.5) * c;
        var dx = gx - px, dy = gy - py, d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; out.x = gx; out.y = gy; out.d = Math.sqrt(d2); }
      }
    }
    return out;
  };

  Ant.prototype.footing = function () {
    var p = this.refPoint(_fp);
    return this.nearestGrain(p.x, p.y).d <= this.legReach();
  };

  Ant.prototype.updateBody = function (dt) {
    var g = this.grid, c = g.cell;
    var onPath = !!(this.path && this.pi < this.path.length);
    var support = this.footing();
    var wasX = this.x, wasY = this.y;

    /* Locomotion is deliberately simple: an ant walks the route A* gave it, and
     * A* only ever routes through open cells, so a tunnel that is wide enough to
     * be walkable is one the ant can always get through - however steep.  The
     * legs and the body lean are for the look of the thing; they never decide
     * whether a step happens.  The old spring-and-footing model let the lean
     * fight the stride and the ant scrabbled on the spot, which is the glitching
     * that plagued the shafts, so it is gone.
     *
     * Real free-fall is kept for the one case that is actually a fall: an ant
     * with nothing underfoot and no route to walk - the founding queen dropped
     * onto fresh sand, or a grain giving way under an idler. */
    var moved = 0;
    if (!support && !onPath) {
      this.grounded = false;
      this.airTime += dt;
      this.vy += CFG.gravity * dt;
      this.vx *= 0.98;
      var nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
      moved = U.dist(this.x, this.y, nx, ny);
      this.x = U.clamp(nx, c, g.cols * c - c);
      this.y = ny;
      if (this.y > g.rows * c - c) { this.y = g.rows * c - c; this.vy = 0; }
    } else {
      if (!this.grounded) { this.vy = 0; this.vx = 0; }
      this.grounded = true;
      this.airTime = 0;
      moved = this.followPath(dt);
    }

    // Lean toward the substrate normal - purely cosmetic, it does not move the
    // feet, so it can never cancel a stride.
    var sub = this.substrateUp(_up);
    var lerpN = Math.min(1, dt * 7);
    this.up.x = U.lerp(this.up.x, sub.x, lerpN);
    this.up.y = U.lerp(this.up.y, sub.y, lerpN);
    var ul = Math.sqrt(this.up.x * this.up.x + this.up.y * this.up.y) || 1;
    this.up.x /= ul; this.up.y /= ul;

    this.x = U.clamp(this.x, 2, g.cols * c - 2);
    this.y = U.clamp(this.y, 2, g.rows * c - 2);

    // `baffled` now only drives the rear-up climbing pose in the renderer; it no
    // longer gates movement, but a low readout on a moving ant still reads as
    // "leaning into a climb", so keep it honest against real displacement.
    var net = U.dist(wasX, wasY, this.x, this.y);
    if (this.grounded && this.movingForward && net < this.speed() * dt * 0.55) {
      this.baffled = Math.min(1.2, this.baffled + dt);
    } else {
      this.baffled = Math.max(0, this.baffled - dt * 0.5);
    }
    return moved;
  };

  /* Is the ant deliberately working its way up the substrate?  While it is, the
   * ground-hug is switched off - otherwise the settle and the stride cancel and
   * the ant hangs at the foot of its own shaft for ever. */
  Ant.prototype.climbing = function () {
    if (!this.movingForward) return false;
    return (this.wantX * this.up.x + this.wantY * this.up.y) > 0.25;
  };

  /* Keep the waypoint index honest.  The body is a point riding above the
   * sand, so it can drift a cell or two off the route it was given - and once
   * `pi` has run ahead of where the feet actually are, the ant is left steering
   * at a cell with rock in between and pushes at it until the path expires.
   * The invariant restored here is: the current waypoint touches our own cell.
   * Returns false when we are too far adrift to repair, so the caller re-paths.
   */
  Ant.prototype.syncPath = function () {
    var p = this.path, cx = this.cellX(), cy = this.cellY();
    var lo = Math.max(0, this.pi - 5), hi = Math.min(p.length - 1, this.pi + 5), i;
    for (i = hi; i >= lo; i--) {                 // standing on a waypoint
      if (p[i].x === cx && p[i].y === cy) { this.pi = i + 1; return this.pi < p.length; }
    }
    var wp = p[this.pi];
    if (Math.abs(wp.x - cx) <= 1 && Math.abs(wp.y - cy) <= 1) return true;
    for (i = lo; i <= hi; i++) {                 // fall back to a reachable one
      if (Math.abs(p[i].x - cx) <= 1 && Math.abs(p[i].y - cy) <= 1) { this.pi = i; return true; }
    }
    return false;
  };

  Ant.prototype.followPath = function (dt) {
    this.movingForward = false;
    if (!this.path || this.pi >= this.path.length) return 0;
    if (!this.syncPath()) { this.path = null; return 0; }
    var c = this.grid.cell;
    var p = this.refPoint(_fp);
    var wp = this.path[this.pi], dx = 0, dy = 0, dl = 0;

    /* Walking is kinematic: the feet travel along the route A* gave us, which
     * is a chain of walkable cells with no corners cut, so every stride is one
     * an ant could really take.  The ride height is not a force - it is just
     * where the body sits relative to the feet (see setFeet) - which is what
     * keeps the gait from fighting the terrain. */
    for (var guard = 0; guard < 2; guard++) {
      dx = (wp.x + 0.5) * c - p.x; dy = (wp.y + 0.5) * c - p.y;
      dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > c * 0.55) break;                  // still on the way
      this.pi++;
      if (this.pi >= this.path.length) { this.path = null; return 0; }
      wp = this.path[this.pi];
    }

    // remember where we are trying to get to; substrateUp uses it to decide
    // whether to rear up onto a wall
    if (dl < 1e-4) return 0;
    this.wantX = dx / dl; this.wantY = dy / dl;

    var step = Math.min(this.speed() * dt, dl);
    var ux = dx / dl, uy = dy / dl;
    var nfx = p.x + ux * step, nfy = p.y + uy * step;
    /* If a step would land the feet in a grain - only possible when the ant has
     * drifted off a corner-safe route - snap straight to the waypoint's own
     * cell centre instead of refusing the move.  Refusing it was what pinned an
     * ant against a step it could not get over; the waypoint is walkable by
     * construction, so going there is always safe and always makes progress. */
    if (this.grid.solid(Math.floor(nfx / c), Math.floor(nfy / c))) {
      nfx = (wp.x + 0.5) * c; nfy = (wp.y + 0.5) * c;
    }
    this.setFeet(nfx, nfy);
    this.movingForward = true;
    this.angle = U.angLerp(this.angle, Math.atan2(uy, ux), Math.min(1, dt * 9));
    return step;
  };

  /* Head for any of `targets` (grid cells).  'arrived' | 'moving' | 'blocked' */
  Ant.prototype.goto = function (targets) {
    if (!targets || !targets.length) return 'blocked';
    for (var i = 0; i < targets.length; i++) {
      if (this.atCell(targets[i].x, targets[i].y)) { return 'arrived'; }
    }
    this.pathAge += 1 / 60;
    if (!this.path || this.pi >= this.path.length || this.pathAge > 2.5) {
      var p = this.colony.pf.find(this.cellX(), this.cellY(), targets);
      this.pathAge = 0;
      if (!p || p.length < 2) {
        this.path = null;
        this.pathFails++;
        return p && p.length === 1 ? 'arrived' : 'blocked';
      }
      this.path = p;
      this.pi = 1;
      this.pathFails = 0;
    }
    return 'moving';
  };

  // ------------------------------------------------------------- update
  Ant.prototype.update = function (dt) {
    this.age += dt;
    if (!this.alive) { this.deathFade = Math.min(1, this.deathFade + dt * 0.3); return; }

    // growth
    if (this.maturity < 1) {
      this.maturity = Math.min(1, this.maturity + dt / CFG.growSeconds);
      this.len = U.lerp(CFG.antBirthLen * this.casteScale, this.maxLen, this.maturity);
      this.height = this.len * CFG.antHeightRatio;
    }

    // metabolism
    var fb = this.caste === QUEEN ? CFG.queenFoodBurn : CFG.foodBurn;
    var effort = this.sleeping ? 0.35 : (this.carrying ? 1.25 : 1);
    /* A founding queen is claustral: she shuts herself in and lives off her
     * flight muscles and fat body until her first daughters emerge, so until
     * there are workers to fetch for her she barely draws on her reserves. */
    if (this.caste === QUEEN && this.colony.ants.length < 2) effort *= CFG.claustralBurn;
    /* Torpor.  A hungry colony burns slower - the same reserve stretches much
     * further at a plod than at a trot - so famine throttles the nest down
     * instead of simply killing it, and a click of food revives it. */
    effort *= U.lerp(1, CFG.torporBurn, this.colony.effectiveFamine());
    this.food = U.clamp(this.food - fb * dt * effort, 0, 1);
    if (this.sleeping) this.energy = U.clamp(this.energy + dt * 0.05, 0, 1);
    else this.energy = U.clamp(this.energy - CFG.energyBurn * dt * effort, 0, 1);

    if (this.food <= 0) {
      this.starve = (this.starve || 0) + dt;
      if (this.starve > 22) { this.colony.killAnt(this, 'starved'); return; }
    } else this.starve = 0;

    /* Help yourself in passing.  An ant that walks over a scrap eats it - it
     * does not note it down and come back later.  Without this the only way to
     * feed is a dedicated errand, and a worker whose errand goes wrong starves
     * standing on a leaf. */
    if (!this.sleeping && this.grounded) {
      if (this.food < 0.35 && !this.carrying) {
        var bite = this.colony.itemWithin(this, 'food', CFG.sipRange);
        if (bite) {
          this.food = U.clamp(this.food + Math.min(CFG.foodEnergy, bite.amount), 0, 1);
          this.mandibleTarget = 0.8;
          this.colony.sipItem(bite, CFG.foodEnergy);
        }
      }
    }

    /* Trophallaxis.  A colony shares one social stomach: ants beg mouth to mouth
     * from any nestmate carrying more than they are, which is how a mouthful
     * reaches the deep nest at all and the only way a callow gets fed - it has
     * no business on the surface and cannot survive the walk.  Before this,
     * newly emerged workers died on the dot of 122 s, the time it takes to burn
     * off the crop they hatched with, while the colony average sat at 0.45. */
    if (!this.sleeping && this.grounded && this.rng.chance(dt * 4)) {
      var reach = this.len * 1.1;
      var fed = this.colony.donorNear(this, 'food', reach, 0.22);
      if (fed) {
        var bit = Math.min(0.2, (fed.food - this.food) * 0.5);
        this.food += bit; fed.food -= bit;
        this.mandibleTarget = 0.6; fed.mandibleTarget = 0.6;
      }
    }

    this.antennaPhase += dt * (this.sleeping ? 0.8 : 6);
    this.bob += dt * 9;
    this.mandible += (this.mandibleTarget - this.mandible) * Math.min(1, dt * 12);
    this.mandibleTarget *= 0.9;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.digBan > 0) this.digBan -= dt;
    if (this.foodBan > 0) this.foodBan -= dt;

    // think, then act
    if (!this.task && this.cooldown <= 0) this.think();
    if (this.task) this.act(dt);

    var moved = this.updateBody(dt);
    this.updateLegs(dt, moved);

    // trail marking: workers lay a home trail underground
    if (this.grounded && !this.sleeping && this.rng.chance(dt * 6)) {
      var cx = this.cellX(), cy = this.cellY();
      if (cy > this.grid.surfaceRow) this.colony.phero.drop(0, cx, cy, CFG.pheroDeposit * dt * 6);
      if (this.carrying && this.carrying.kind === 'food') {
        this.colony.phero.drop(1, cx, cy, CFG.pheroDeposit * dt * 9);
      }
    }

    this.checkProgress(dt);
  };

  /* Give-up detector.
   *
   * A frame-to-frame "did it move?" test is useless here, because an ant that
   * is butting against a step it cannot climb still jitters a pixel or two
   * every frame.  What matters is net displacement over a window: if an ant
   * has been walking somewhere for a couple of seconds and has not actually
   * got anywhere, whatever it is attempting is not going to work, so it drops
   * the task and the brain picks something else.
   */
  Ant.prototype.checkProgress = function (dt) {
    if (!this.task || this.sleeping) { this.stuck = 0; this.window = 0; return; }
    this.window = (this.window || 0) + dt;
    if (this.window < 0.7) return;
    this.window = 0;
    // only judge ants that are actually trying to travel
    var travelling = !!(this.path && this.pi < this.path.length);
    if (travelling && U.dist2(this.x, this.y, this.lastX, this.lastY) < 9) {
      this.stuck += 0.7;
      if (this.stuck > 2.8) { this.abandonTask(); this.stuck = 0; }
    } else {
      this.stuck = 0;
    }
    this.lastX = this.x; this.lastY = this.y;
  };

  // -------------------------------------------------------------- brain
  Ant.prototype.setTask = function (kind, extra) {
    this.task = { kind: kind, phase: 0, timer: 0 };
    if (extra) for (var k in extra) this.task[k] = extra[k];
    this.path = null; this.pathFails = 0;
    this.taskTimer = 0;
  };

  Ant.prototype.abandonTask = function () {
    if (this.digCell) this.colony.releaseDigCell(this);
    if (this.carrying && this.carrying.kind === 'egg') this.colony.dropBrood(this);
    this.task = null;
    this.path = null;
    this.cooldown = this.rng.range(0.2, 0.8);
    this.sleeping = false;
  };

  Ant.prototype.finishTask = function () {
    if (this.digCell) this.colony.releaseDigCell(this);
    this.task = null;
    this.path = null;
    this.sleeping = false;
    this.cooldown = this.rng.range(0.05, 0.4);
  };

  /* How strongly this ant can smell food from where it stands.  Sampled over a
   * small patch rather than one cell, because a trail laid a grain to the left
   * is still a trail an ant would notice with its antennae out. */
  Ant.prototype.foodScent = function () {
    var ph = this.colony.phero, cx = this.cellX(), cy = this.cellY();
    var r = CFG.recruitReach, best = 0;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var v = ph.at(1, cx + dx, cy + dy);
        if (v > best) best = v;
      }
    }
    return U.clamp(best / CFG.pheroMax, 0, 1);
  };

  /* Weighted needs.  Every candidate action gets a score from personal
   * state (hunger, fatigue) and colony state (spoil to shift,
   * brood to tend, chambers to dig, food to store, danger).  Highest
   * score with a little noise wins, so a colony of identical ants still
   * spreads itself across the jobs that matter.
   */
  Ant.prototype.think = function () {
    var col = this.colony, best = null, bestScore = 0.05, self = this;
    function consider(score, kind, extra) {
      if (score <= 0) return;
      score *= 0.82 + 0.36 * self.rng.next();
      if (score > bestScore) { bestScore = score; best = { kind: kind, extra: extra }; }
    }

    var hungry = U.clamp((CFG.hungerThreshold - this.food) / CFG.hungerThreshold, 0, 1);
    var tired = U.clamp((CFG.tiredThreshold - this.energy) / CFG.tiredThreshold, 0, 1);

    if (this.caste === QUEEN) {
      /* The founding queen digs her own shaft and nursery, then settles in.
       * Once she has daughters she never goes out again: workers bring her
       * food, and if they are slow about it she goes hungry rather than abandon
       * the brood.  A queen wandering the surface looking for a meal is how a
       * colony dies - the nurses all trail after her. */
      var nursery = col.roomForEggs();
      var alone = col.workers() === 0;
      if (hungry > 0.15 && (alone || col.roomWithFood())) consider(2.8 * hungry, 'EAT');
      if (nursery && col.canLay()) consider(2.6, 'LAY', { room: nursery });
      if (this.load > 0) consider(3.2, 'HAUL');
      // she only ever swings her own mandibles while founding the nest alone
      if (alone && (!nursery || col.needsDigging()) && !(this.digBan > 0)) consider(1.5, 'DIG');
      if (tired > 0.6) consider(1.1 * tired, 'SLEEP');
      if (nursery) consider(0.8 * col.broodPressure() + 0.5, 'TEND');
      consider(0.35, 'GROOM');
      if (!best) best = { kind: 'WANDER' };
      this.setTask(best.kind, best.extra);
      return;
    }

    if (this.load > 0) { this.setTask('HAUL'); return; }
    if (this.carrying) {
      if (this.carrying.kind === 'food') {
        // a hungry queen is fed before the granary is topped up
        /* A queen that dips below a third of a crop stops laying altogether, so
         * she is topped up well before she gets there rather than after. */
        if (col.queen && col.queen.alive && col.queen.food < 0.8 && !(col.queenFed > 0)) {
          this.setTask('FEED_QUEEN', { phase: 1 });
          return;
        }
        this.setTask('STORE_FOOD');
        return;
      }
      if (this.carrying.kind === 'egg') { this.setTask('MOVE_BROOD'); return; }
      if (this.carrying.kind === 'corpse') { this.setTask('DUMP_CORPSE'); return; }
    }

    var alarm = col.alarmLevel();
    if (this.caste === SOLDIER) {
      var foe = col.nearestIntruder(this);
      if (foe) consider(6, 'ATTACK', { foe: foe });
      consider(1.0 + 2.5 * alarm, 'GUARD');
    } else if (alarm > 0.4) {
      consider(1.6 * alarm, 'HIDE');
    }

    consider(2.6 * hungry, 'EAT');
    consider(1.5 * tired, 'SLEEP');

    if (this.maturity > 0.35) {
      if (!(this.digBan > 0)) consider(1.05 * col.digPressure(), 'DIG');
      if (!(this.foodBan > 0)) {
        consider(0.95 * col.foodPressure(), 'FORAGE');
        /* Recruitment.  Scent underfoot is a nestmate's word that there is food
         * that way, and it outweighs whatever housekeeping this ant had in mind
         * - which is what turns one lucky finder into a column of foragers. */
        consider(CFG.recruitStrength * this.foodScent(), 'FORAGE');
      }
      consider(0.8 * col.queenFoodNeed(), 'FEED_QUEEN');
      consider(0.9 * col.broodPressure(), 'TEND');
      consider(0.8 * col.broodMovePressure(), 'MOVE_BROOD');
      consider(0.7 * col.corpsePressure(), 'DUMP_CORPSE');
    } else {
      // callows stay in the nest and nurse
      consider(1.4 * col.broodPressure(), 'TEND');
      consider(0.5, 'WANDER');
    }
    consider(0.3, 'WANDER');

    if (!best) best = { kind: 'WANDER' };
    this.setTask(best.kind, best.extra);
  };

  // --------------------------------------------------------------- tasks
  /* Nothing may run forever: a task that has overstayed its welcome is a task
   * whose assumptions have gone stale (the spoil heap moved, the food went,
   * the gallery it was heading for got filled in). */
  var TASK_LIMIT = {
    DIG: 40, HAUL: 75, FORAGE: 55, STORE_FOOD: 50, EAT: 30,
    FEED_QUEEN: 45, LAY: 30, TEND: 25, MOVE_BROOD: 40, DUMP_CORPSE: 45,
    SLEEP: 40, GROOM: 8, GUARD: 30, ATTACK: 35, HIDE: 20, WANDER: 20
  };

  Ant.prototype.act = function (dt) {
    var t = this.task;
    t.timer += dt;
    if (t.timer > (TASK_LIMIT[t.kind] || 40)) { this.abandonTask(); return; }
    if (this.pathFails > 6) { this.abandonTask(); return; }
    var fn = TASKS[t.kind];
    if (!fn) { this.abandonTask(); return; }
    fn.call(this, dt, t);
  };

  var TASKS = {};

  // ---- excavation -----------------------------------------------------
  TASKS.DIG = function (dt, t) {
    var col = this.colony, g = this.grid;
    if (this.load >= CFG.loadCapacity) { this.setTask('HAUL'); return; }
    if (!this.digCell) {
      var cell = col.requestDigCell(this);
      if (!cell) { this.digBan = 5 + this.rng.range(0, 4); this.finishTask(); return; }
      this.digCell = cell;
      this.path = null;
    }
    var dc = this.digCell;
    if (!g.solid(dc.x, dc.y)) { col.releaseDigCell(this); return; }
    var stations = g.workStations(dc.x, dc.y);
    if (!stations.length) { col.releaseDigCell(this); this.pathFails++; return; }
    var r = this.goto(stations);
    if (r === 'blocked') { col.releaseDigCell(this); this.pathFails++; return; }
    if (r !== 'arrived') {
      /* A face can look reachable to the router yet not be walkable in practice
       * - the way into a half-hollowed chamber often runs along cells with no
       * foothold.  An ant that has been trying to reach its grain for a few
       * seconds without arriving lets go of it, so the job hands it a face it
       * can actually get to instead of pinning it here for good. */
      t.reach = (t.reach || 0) + dt;
      if (t.reach > 4) { col.releaseDigCell(this); this.digBan = 1 + this.rng.range(0, 1); this.finishTask(); }
      return;
    }
    t.reach = 0;

    // face the working face and chew
    var c = g.cell;
    var want = Math.atan2((dc.y + 0.5) * c - this.y, (dc.x + 0.5) * c - this.x);
    this.angle = U.angLerp(this.angle, want, Math.min(1, dt * 8));
    this.mandibleTarget = 0.9 + 0.1 * Math.sin(t.timer * 22);
    t.dig = (t.dig || 0) + dt;
    if (t.dig >= CFG.digSeconds) {
      t.dig = 0;
      if (g.removeSand(dc.x, dc.y)) {
        this.load++;
        col.onGrainRemoved(dc.x, dc.y, this);
      }
      col.releaseDigCell(this);
      if (this.load >= CFG.loadCapacity) this.setTask('HAUL');
    }
  };

  TASKS.HAUL = function (dt, t) {
    var col = this.colony, g = this.grid;
    if (this.load <= 0) { this.finishTask(); return; }
    /* Every grain is carried out to the surface and tipped onto the hill - there
     * is no shortcut.  A founding queen with no daughters yet does it herself,
     * climbing her own shaft with each mouthful, which is how the hill starts to
     * grow long before there is a workforce. */
    if (!t.spot || !g.inb(t.spot.x, t.spot.y) || g.solid(t.spot.x, t.spot.y) || !g.supported(t.spot.x, t.spot.y)) {
      t.spot = col.dumpTarget(this);
      this.path = null;
      if (!t.spot) {
        // The hill has no legal spot within reach this frame - wait and try
        // again rather than dropping the grain somewhere it does not belong.
        t.noSpot = (t.noSpot || 0) + dt;
        if (t.noSpot > 6) { this.abandonTask(); return; }
        this.cooldown = 0.3;
        return;
      }
      t.noSpot = 0;
    }
    var stations = g.workStations(t.spot.x, t.spot.y);
    if (!stations.length) { t.spot = null; this.pathFails++; return; }
    var r = this.goto(stations);
    if (r === 'blocked') { t.spot = null; this.pathFails++; return; }
    if (r !== 'arrived') return;
    this.mandibleTarget = 1;
    t.drop = (t.drop || 0) + dt;
    if (t.drop > 0.18) {
      t.drop = 0;
      if (g.supported(t.spot.x, t.spot.y) && g.placeSand(t.spot.x, t.spot.y, true)) {
        this.load--;
        col.stats.grainsMoved++;
      }
      if (this.load <= 0) { this.finishTask(); return; }
      // Still carrying: rather than walking back down the tunnel and out again
      // for every single grain, look for another supported spot within a step
      // of this one and tip the next grain straight onto it.
      t.spot = this.spotBeside(t.spot);
      if (!t.spot) this.path = null;
    }
  };

  /* A supported, un-dug air cell next to `from` - where the next grain of a
   * mouthful goes, so a load of spoil builds the hill up in one visit. */
  Ant.prototype.spotBeside = function (from) {
    var g = this.grid, col = this.colony, best = null, bestY = -1;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        var x = from.x + dx, y = from.y + dy;
        if (!g.inb(x, y) || !g.isAir(x, y)) continue;
        if (!g.supported(x, y) || y <= g.surfaceRow - 24) continue;
        if (col.nearDug(x, y, CFG.dumpKeepOut)) continue;
        if (!g.workStations(x, y).length) continue;
        if (!this.atCell(x, y, 4.5)) continue;
        if (y > bestY) { bestY = y; best = { x: x, y: y }; }
      }
    }
    if (best) col.stats.hillSpots = (col.stats.hillSpots || 0) + 1;
    return best;
  };

  // ---- foraging -------------------------------------------------------
  TASKS.FORAGE = function (dt, t) {
    var col = this.colony;
    if (this.carrying) { this.setTask('STORE_FOOD'); return; }
    if (!t.item || t.item.dead || t.item.heldBy) {
      t.item = col.claimItem(this, 'food');
      this.path = null;
      /* Nothing out there to fetch.  Note it and go and be useful rather than
       * picking FORAGE again the instant the cooldown lapses - with food this
       * scarce that loop would otherwise burn most of the colony's day. */
      if (!t.item) { this.foodBan = 5 + this.rng.range(0, 5); this.finishTask(); return; }
    }
    var cell = col.itemCell(t.item);
    var stations = this.grid.workStations(cell.x, cell.y);
    stations.push(cell);
    var r = this.goto(stations);
    if (r === 'blocked') { col.unclaimItem(t.item, this); t.item = null; this.pathFails++; return; }
    if (r !== 'arrived') return;
    this.mandibleTarget = 1;
    /* Mark the find hard.  This is the seed of the recruitment trail: nestmates
     * that cross it smell food and come to look, and each one that carries a
     * load home strengthens the route behind it. */
    col.phero.drop(1, cell.x, cell.y, CFG.foodFindMark);
    /* Only a genuinely famished forager eats where she stands.  With a looser
     * threshold every flake gets eaten at the pick-up point and the granary
     * never fills, which leaves the queen with nothing to be fed. */
    if (this.food < 0.3) {
      this.food = U.clamp(this.food + Math.min(CFG.foodEnergy, t.item.amount), 0, 1);
      col.sipItem(t.item, CFG.foodEnergy);
      this.finishTask();
      return;
    }
    col.pickUpItem(this, t.item);
    this.setTask('STORE_FOOD');
  };

  TASKS.STORE_FOOD = function (dt, t) {
    var col = this.colony;
    if (!this.carrying || this.carrying.kind !== 'food') { this.finishTask(); return; }
    if (!t.room) {
      t.room = col.roomForFood();
      this.path = null;
      if (!t.room) {                            // no granary yet - eat it
        this.food = U.clamp(this.food + CFG.foodEnergy * 0.6, 0, 1);
        this.carrying = null;
        this.finishTask();
        return;
      }
    }
    var r = this.goto(pileOf(col, t.room));
    if (r === 'blocked') { t.room = null; this.pathFails++; return; }
    if (r !== 'arrived') return;
    col.depositFood(this, t.room);
    this.finishTask();
  };

  TASKS.EAT = function (dt, t) {
    var col = this.colony;
    /* A queen with daughters waits to be fed rather than going out to look:
     * an empty granary means she goes hungry for a while, not that she walks
     * up to the surface and takes the nurses with her. */
    var housebound = this.caste === QUEEN && col.workers() > 0;
    var giveUp = function (self) {
      if (housebound) self.finishTask(); else self.setTask('FORAGE');
    };
    if (t.phase === 0) {
      var room = col.roomWithFood();
      if (room) { t.room = room; t.phase = 1; }
      else { giveUp(this); return; }
    }
    var r = this.goto(col.roomCells(t.room));
    if (r === 'blocked') { giveUp(this); return; }
    if (r !== 'arrived') return;
    this.mandibleTarget = 0.7 + 0.3 * Math.sin(t.timer * 14);
    t.eat = (t.eat || 0) + dt;
    if (t.eat > 1.4) {
      if (col.takeFood(t.room, 1)) this.food = U.clamp(this.food + CFG.foodEnergy, 0, 1);
      else { giveUp(this); return; }
      this.finishTask();
    }
  };

  /* Food goes to the queen the same way: a nurse fills her crop at the granary
   * - or simply diverts the flake she is already carrying in from the surface -
   * and walks it down, so the queen never has to leave the brood. */
  TASKS.FEED_QUEEN = function (dt, t) {
    var col = this.colony;
    var q = col.queen;
    if (!q || !q.alive) { this.finishTask(); return; }
    if (t.phase === 1 && !this.carrying && !t.crop) t.crop = 1;
    if (t.phase === 0) {                       // fill up at the granary
      if (!t.room) {
        t.room = col.roomWithFood();
        this.path = null;
        if (!t.room) { this.finishTask(); return; }
      }
      var rr = this.goto(col.roomCells(t.room));
      if (rr === 'blocked') { t.room = null; this.pathFails++; return; }
      if (rr !== 'arrived') return;
      this.mandibleTarget = 0.6;
      t.fill = (t.fill || 0) + dt;
      if (t.fill > 1.0) {
        if (!col.takeFood(t.room, 1)) { t.room = null; t.fill = 0; return; }
        t.phase = 1;
        t.crop = 1;
        this.path = null;
      }
      return;
    }
    if (!this.carrying && !t.crop) { this.finishTask(); return; }
    var qc = { x: q.cellX(), y: q.cellY() };
    var stations = this.grid.workStations(qc.x, qc.y);
    stations.push(qc);
    var r = this.goto(stations);
    if (r === 'blocked') { this.pathFails++; return; }
    if (r !== 'arrived') return;
    this.mandibleTarget = 0.8;
    t.give = (t.give || 0) + dt;
    if (t.give > 1.0) {
      q.food = U.clamp(q.food + CFG.foodEnergy, 0, 1);
      col.queenFed = 3;
      this.carrying = null;
      t.crop = 0;
      col.stats.deliveries++;
      this.finishTask();
    }
  };

  // ---- brood ----------------------------------------------------------
  /* Where in a chamber the brood lives: the middle of the floor, where the pile
   * is.  Walking to the nearest cell of the room instead would have the queen
   * laying in the doorway and the nurses stacking grubs against the wall. */
  function pileOf(col, room) {
    var floor = col.roomFloor(room);
    return floor.length ? floor.slice(0, 4) : col.roomCells(room);
  }

  TASKS.LAY = function (dt, t) {
    var col = this.colony;
    if (!t.room) { t.room = col.roomForEggs(); if (!t.room) { this.finishTask(); return; } }
    var r = this.goto(pileOf(col, t.room));
    if (r === 'blocked') { this.pathFails++; return; }
    if (r !== 'arrived') return;
    t.lay = (t.lay || 0) + dt;
    this.gasterPulse = Math.sin(t.lay * 6) * 0.5 + 0.5;
    if (t.lay > 2.2) {
      this.gasterPulse = 0;
      col.layEgg(this, t.room);
      this.finishTask();
    }
  };

  TASKS.TEND = function (dt, t) {
    var col = this.colony;
    if (!t.brood || t.brood.dead || t.brood.hatched) {
      t.brood = col.broodNeedingCare(this);
      this.path = null;
      if (!t.brood) { this.finishTask(); return; }
    }
    var b = t.brood;
    var cell = { x: Math.floor(b.x / this.grid.cell), y: Math.floor(b.y / this.grid.cell) };
    var stations = this.grid.workStations(cell.x, cell.y);
    stations.push(cell);
    var r = this.goto(stations);
    if (r === 'blocked') { t.brood = null; this.pathFails++; return; }
    if (r !== 'arrived') return;
    this.mandibleTarget = 0.35 + 0.35 * Math.sin(t.timer * 9);
    b.tended = 1.2;                            // licked clean; develops faster
    if (t.timer > 4.5) this.finishTask();
  };

  TASKS.MOVE_BROOD = function (dt, t) {
    var col = this.colony;
    if (!this.carrying) {
      if (!t.brood || t.brood.dead || t.brood.heldBy) {
        t.brood = col.broodToRelocate(this);
        this.path = null;
        if (!t.brood) { this.finishTask(); return; }
      }
      var b = t.brood;
      var cell = { x: Math.floor(b.x / this.grid.cell), y: Math.floor(b.y / this.grid.cell) };
      var st = this.grid.workStations(cell.x, cell.y);
      st.push(cell);
      var r1 = this.goto(st);
      if (r1 === 'blocked') { t.brood = null; this.pathFails++; return; }
      if (r1 !== 'arrived') return;
      this.mandibleTarget = 1;
      col.pickUpBrood(this, b);
      t.room = col.roomForBrood(b) || col.roomForEggs();
      if (!t.room) { col.dropBrood(this); this.finishTask(); return; }
      this.path = null;
      return;
    }
    if (!t.room) {
      t.room = col.roomForBrood(this.carrying.brood) || col.roomForEggs();
      if (!t.room) { col.dropBrood(this); this.finishTask(); return; }
    }
    var r2 = this.goto(pileOf(col, t.room));
    if (r2 === 'blocked') { this.pathFails++; return; }
    if (r2 !== 'arrived') return;
    col.dropBrood(this, t.room);
    this.finishTask();
  };

  // ---- housekeeping ---------------------------------------------------
  TASKS.DUMP_CORPSE = function (dt, t) {
    var col = this.colony;
    if (!this.carrying) {
      if (!t.body || t.body.removed || t.body.heldBy) {
        t.body = col.corpseToClear(this);
        this.path = null;
        if (!t.body) { this.finishTask(); return; }
      }
      var cell = { x: t.body.cellX(), y: t.body.cellY() };
      var st = this.grid.workStations(cell.x, cell.y);
      st.push(cell);
      var r = this.goto(st);
      if (r === 'blocked') { t.body = null; this.pathFails++; return; }
      if (r !== 'arrived') return;
      col.pickUpCorpse(this, t.body);
      t.spot = col.middenSpot(this);
      this.path = null;
      return;
    }
    if (!t.spot) { t.spot = col.middenSpot(this); if (!t.spot) { col.dropCorpse(this); this.finishTask(); return; } }
    var r2 = this.goto([t.spot]);
    if (r2 === 'blocked') { col.dropCorpse(this); this.finishTask(); return; }
    if (r2 !== 'arrived') return;
    col.dropCorpse(this);
    this.finishTask();
  };

  TASKS.SLEEP = function (dt, t) {
    var col = this.colony;
    if (t.phase === 0) {
      t.spot = col.restSpot(this);
      t.phase = 1;
      this.path = null;
    }
    if (t.spot && !this.atCell(t.spot.x, t.spot.y)) {
      var r = this.goto([t.spot]);
      if (r === 'blocked') { t.spot = null; }
      if (r === 'moving') return;
    }
    this.sleeping = true;
    this.path = null;
    if (this.energy > 0.92 || t.timer > 30) { this.sleeping = false; this.finishTask(); }
  };

  TASKS.GROOM = function (dt, t) {
    this.sleeping = false;
    this.path = null;
    this.mandibleTarget = 0.4 + 0.4 * Math.sin(t.timer * 10);
    if (t.timer > 2.5) this.finishTask();
  };

  TASKS.GUARD = function (dt, t) {
    var col = this.colony;
    var foe = col.nearestIntruder(this);
    if (foe) { this.setTask('ATTACK', { foe: foe }); return; }
    if (!t.spot || t.timer > 6) {
      t.spot = col.patrolSpot(this);
      t.timer = 0;
      this.path = null;
      if (!t.spot) { this.finishTask(); return; }
    }
    var r = this.goto([t.spot]);
    if (r !== 'moving') { t.spot = null; }
    if (t.total === undefined) t.total = 0;
    t.total += dt;
    if (t.total > 18) this.finishTask();
  };

  TASKS.ATTACK = function (dt, t) {
    var col = this.colony;
    var foe = t.foe;
    if (!foe || !foe.alive) { this.finishTask(); return; }
    var cell = { x: Math.floor(foe.x / this.grid.cell), y: Math.floor(foe.y / this.grid.cell) };
    var st = this.grid.workStations(cell.x, cell.y);
    st.push(cell);
    var d = U.dist(this.x, this.y, foe.x, foe.y);
    if (d > this.len * 0.9) {
      var r = this.goto(st);
      if (r === 'blocked') { this.pathFails++; return; }
      this.colony.phero.drop(2, this.cellX(), this.cellY(), 1.5 * dt * 6);
      return;
    }
    this.path = null;
    this.mandibleTarget = 1;
    var want = Math.atan2(foe.y - this.y, foe.x - this.x);
    this.angle = U.angLerp(this.angle, want, Math.min(1, dt * 10));
    foe.hp -= dt * (this.caste === SOLDIER ? 0.9 : 0.4);
    this.colony.phero.drop(2, this.cellX(), this.cellY(), 2 * dt * 6);
    if (foe.hp <= 0) { col.killIntruder(foe); this.finishTask(); }
  };

  TASKS.HIDE = function (dt, t) {
    var col = this.colony;
    if (t.phase === 0) { t.spot = col.restSpot(this, true); t.phase = 1; this.path = null; }
    if (t.spot) {
      var r = this.goto([t.spot]);
      if (r === 'blocked') t.spot = null;
    }
    if (t.timer > 8 || col.alarmLevel() < 0.15) this.finishTask();
  };

  TASKS.WANDER = function (dt, t) {
    if (!t.spot || t.timer > 5) {
      t.spot = this.colony.wanderSpot(this);
      t.timer = 0;
      this.path = null;
      if (!t.spot) { this.cooldown = 0.6; this.finishTask(); return; }
    }
    var r = this.goto([t.spot]);
    if (r !== 'moving') { t.spot = null; if (this.rng.chance(0.3)) this.finishTask(); }
  };

  Ant.TASKS = TASKS;
  root.Ant = Ant;
})(typeof window !== 'undefined' ? window : global);
