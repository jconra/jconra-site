/* The colony: work planning, brood, stores, threats.
 *
 * Excavation is planned as *jobs* made of grid cells:
 *   - a tunnel job is a meandering centre line with a disc carved along it,
 *     kept angled (never a vertical shaft) so ants can walk it, and steered
 *     away from anything already dug so galleries do not break into each other
 *   - a room job is an ellipse hung off the end of a tunnel; a nursery is only
 *     ever planned at least 20% of the way down the sand column
 * Ants claim one cell at a time from the nearest job, chew it out, and haul
 * the spoil to the surface where it can only be dropped on ground that is
 * supported on both shoulders - which is what piles the ant hill into a cone.
 */
(function (root) {
  'use strict';
  var CFG = root.CFG, U = root.U, Ant = root.Ant;

  var NURSERY = 'nursery', GRANARY = 'granary', CHAMBER = 'chamber', MIDDEN = 'midden';

  function Colony(grid, rng) {
    this.grid = grid;
    this.rng = rng;
    this.phero = new root.Pheromones(grid.cols, grid.rows);
    this.pf = new root.PathFinder(grid);

    this.ants = [];
    this.corpses = [];
    this.brood = [];
    this.items = [];
    this.intruders = [];
    this.middenPile = [];
    this.rooms = [];
    this.jobs = [];
    this.frontier = [];
    this.claims = {};             // cell index -> ant id currently digging it

    this.nextAntId = 1;
    this.nextJobId = 1;
    this.nextRoomId = 1;
    this.nextBroodId = 1;

    this.age = 0;
    this.planTimer = 0;
    this.foodTimer = 2;
    this.intruderTimer = CFG.intruderInterval;
    this.layTimer = 4;
    this.queenFed = 0;
    /* Famine is recomputed once per step and read by every ant, several times
     * each, so it is cached here rather than walked per enquiry. */
    this.famineLevel = 0;
    this.layHalted = false;

    this.stats = {
      grainsMoved: 0, deliveries: 0, eggsLaid: 0, hatched: 0,
      deaths: 0, maxDepth: 0, foodStored: 0, foodGathered: 0, clicks: 0
    };

    this.foundQueen();
  }

  Colony.NURSERY = NURSERY;
  Colony.GRANARY = GRANARY;
  Colony.MIDDEN = MIDDEN;

  // ------------------------------------------------------------ founding
  Colony.prototype.foundQueen = function () {
    var g = this.grid;
    var x = Math.floor(g.cols * this.rng.range(0.35, 0.65));
    var top = g.topSolid(x);
    var q = new Ant(this, (x + 0.5) * g.cell, (top - 6) * g.cell, Ant.QUEEN, true);
    this.queen = q;
    this.ants.push(q);
    this.entrance = { x: x, y: top };
  };

  Colony.prototype.workers = function () {
    var n = 0;
    for (var i = 0; i < this.ants.length; i++) {
      if (this.ants[i].alive && this.ants[i].caste !== Ant.QUEEN && this.ants[i].maturity > 0.35) n++;
    }
    return n;
  };
  Colony.prototype.countTask = function (kind) {
    var n = 0;
    for (var i = 0; i < this.ants.length; i++) {
      if (this.ants[i].task && this.ants[i].task.kind === kind) n++;
    }
    return n;
  };

  // ================================================================ update
  Colony.prototype.update = function (dt) {
    this.age += dt;
    if (this.queenFed > 0) this.queenFed -= dt;
    this.measureFamine();
    this.grid.stepPhysics(CFG.physicsBudget);
    this.phero.update(dt);

    this.planTimer -= dt;
    if (this.planTimer <= 0) { this.planTimer = 1.1; this.ensureWork(); }

    this.updateItems(dt);
    this.updateBrood(dt);
    this.updateIntruders(dt);

    var i;
    for (i = 0; i < this.ants.length; i++) this.ants[i].update(dt);
    for (i = 0; i < this.corpses.length; i++) {
      var c = this.corpses[i];
      c.update(dt);
      if (c.heldBy) { c.x = c.heldBy.x; c.y = c.heldBy.y - c.heldBy.height * 0.4; }
    }
    if (this.layTimer > 0) this.layTimer -= dt;

    // succession / restart so the farm never goes quiet
    if (!this.queen || !this.queen.alive) this.promoteQueen();
    var depth = 0;
    for (i = 0; i < this.ants.length; i++) {
      var d = this.ants[i].depthFraction();
      if (d > depth) depth = d;
    }
    if (depth > this.stats.maxDepth) this.stats.maxDepth = depth;
    this.stats.foodStored = this.totalFood();
  };

  Colony.prototype.promoteQueen = function () {
    var best = null;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.alive && a.caste === Ant.WORKER && a.maturity > 0.8) { best = a; break; }
    }
    if (best) {
      best.caste = Ant.QUEEN;
      best.casteScale = 1.25;
      best.maxLen = CFG.antAdultLen * 1.25;
      best.abandonTask();
      this.queen = best;
    } else if (this.ants.length === 0) {
      this.foundQueen();
    }
  };

  Colony.prototype.killAnt = function (ant, cause) {
    if (!ant.alive) return;
    ant.alive = false;
    ant.sleeping = false;
    ant.task = null;
    ant.path = null;
    ant.cause = cause;
    if (ant.digCell) this.releaseDigCell(ant);
    if (ant.carrying && ant.carrying.kind === 'egg') this.dropBrood(ant);
    var k = this.ants.indexOf(ant);
    if (k >= 0) this.ants.splice(k, 1);
    this.corpses.push(ant);
    this.stats.deaths++;
    if (ant === this.queen) this.queen = null;
  };

  // ============================================================== planning
  function clampSlope(a, lo, hi, descend) {
    var s = Math.sin(a), c = Math.cos(a);
    if (descend && s < lo) s = lo;
    var as = Math.abs(s);
    if (as < lo) s = lo * (s < 0 ? -1 : 1);
    if (as > hi) s = hi * (s < 0 ? -1 : 1);
    var cs = Math.sqrt(Math.max(0.0001, 1 - s * s)) * (c < 0 ? -1 : 1);
    return Math.atan2(s, cs);
  }

  /* Is a disc of rock free of other galleries / other jobs' plans?
   * `exempt` is the junction we are branching from: the open gallery right
   * there is expected, otherwise nothing could ever connect to anything. */
  Colony.prototype.blocked = function (cx, cy, r, jobId, exempt) {
    var g = this.grid, ir = Math.ceil(r);
    var x0 = Math.round(cx), y0 = Math.round(cy);
    var er2 = exempt ? exempt.r * exempt.r : 0;
    for (var dy = -ir; dy <= ir; dy++) {
      for (var dx = -ir; dx <= ir; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        var x = x0 + dx, y = y0 + dy;
        if (!g.inb(x, y)) return true;
        if (exempt) {
          var ex = x - exempt.x, ey = y - exempt.y;
          if (ex * ex + ey * ey <= er2) continue;
        }
        var i = y * g.cols + x;
        if (g.dug[i] === 1) return true;
        if (g.room[i] !== 0) return true;
        if (g.owner[i] !== 0 && g.owner[i] !== jobId) return true;
      }
    }
    return false;
  };

  /* The shallowest row a dig may open in a column: far enough below the packed
   * crust to leave a lid of ground over it.  Measured on the crust and not on
   * `surfaceRow`, because the ground rolls, and against packed sand only,
   * because a heap of spoil is not a roof - it is what comes through the hole. */
  Colony.prototype.roofRow = function (x) {
    return this.grid.packedTop(Math.round(x)) + CFG.roofCells;
  };

  /* `roof` is the shallowest row the bore may open.  Everything but the nest
   * mouth itself digs below it - and below the crust of its own column - which
   * leaves the surface intact: a roofed gallery an ant can walk along instead of
   * an open trench for the hill to pour down. */
  Colony.prototype.carveDisc = function (cx, cy, r, cells, jobId, roof, openTop) {
    var g = this.grid, ir = Math.ceil(r);
    var x0 = Math.round(cx), y0 = Math.round(cy);
    for (var dy = -ir; dy <= ir; dy++) {
      for (var dx = -ir; dx <= ir; dx++) {
        if (dx * dx + dy * dy > r * r + 0.2) continue;
        var x = x0 + dx, y = y0 + dy;
        if (!g.inb(x, y) || (roof !== undefined && y < roof)) continue;
        if (!openTop && y < this.roofRow(x)) continue;
        var i = y * g.cols + x;
        if (g.owner[i] !== 0 || g.dug[i] === 1) continue;
        if (g.type[i] !== root.Grid.SAND) continue;
        g.owner[i] = jobId;
        cells.push({ x: x, y: y });
      }
    }
  };

  Colony.prototype.planTunnel = function (sx, sy, angle, steps, descend, opts) {
    var g = this.grid;
    var jobId = this.nextJobId++;
    var cells = [], nodes = [];
    var noise = new root.Noise1(this.rng, 24);
    var np = this.rng.range(0, 20);
    /* Descending shafts are steep - a real nest drops almost straight down and
     * only the side galleries ramble.  Boring the main shaft at the gentle
     * gallery slope would walk it 70 columns sideways to get 35 rows down, and
     * the resulting commute to the surface starves the colony. */
    var lo = (opts && opts.minSlope !== undefined) ? opts.minSlope
           : (descend ? CFG.shaftMinSlope : CFG.minSlope);
    var hi = (opts && opts.maxSlope !== undefined) ? opts.maxSlope
           : (descend ? CFG.shaftMaxSlope : CFG.maxSlope);
    var x = sx, y = sy, a = clampSlope(angle, lo, hi, descend);
    var r = CFG.tunnelRadius;
    var minY = (opts && opts.minY !== undefined) ? opts.minY : g.surfaceRow + 1;
    var maxY = (opts && opts.maxY !== undefined) ? opts.maxY : undefined;
    var roof = (opts && opts.roof !== undefined) ? opts.roof : g.surfaceRow + 1;
    // branching off an existing gallery: the first stride or two is allowed to
    // overlap it, which is what makes a junction instead of a dead end
    var openTop = !!(opts && opts.openTop);
    var exempt = openTop ? null
      : { x: Math.round(sx), y: Math.round(sy), r: r + CFG.clearance + 1 };
    if (openTop) {
      // a nest entrance: break the crust at the start point so the shaft is
      // reachable from the surface, otherwise the whole plan is sealed in rock.
      // A shaft is the one dig exempt from the crust rule for its whole length,
      // because the first strides of it are *in* the crust; the mouth stays a
      // hole in the ground rather than growing into an open crater because only
      // the discs the shaft itself carves are allowed through.
      this.carveDisc(x, y, r, cells, jobId, Math.round(y) - 1, true);
    }
    for (var s = 0; s < steps; s++) {
      np += 0.4;
      var na = a + noise.at(np) * CFG.wanderStrength;
      na = clampSlope(na, lo, hi, descend);
      var nx = x + Math.cos(na), ny = y + Math.sin(na);
      var ok = this.inDigRange(nx, ny, minY, maxY, openTop) && !this.blocked(nx, ny, r + CFG.clearance, jobId, exempt);
      if (!ok) {
        for (var k = 0; k < 6 && !ok; k++) {
          var alt = clampSlope(a + (k % 2 ? 1 : -1) * (0.4 + 0.35 * (k >> 1)),
                               lo, hi, descend);
          var tx = x + Math.cos(alt), ty = y + Math.sin(alt);
          if (this.inDigRange(tx, ty, minY, maxY, openTop) && !this.blocked(tx, ty, r + CFG.clearance, jobId, exempt)) {
            na = alt; nx = tx; ny = ty; ok = true;
          }
        }
      }
      if (!ok) break;
      a = na; x = nx; y = ny;
      this.carveDisc(x, y, r, cells, jobId, roof, openTop);
      nodes.push({ x: x, y: y, a: a });
    }
    /* A plan whose very first stride was refused has carved its start disc but
     * taken no step, so it has no direction and no end to hang a frontier off.
     * That is not a tunnel - give the cells back. */
    if (cells.length < 6 || !nodes.length) { this.unclaim(cells); return null; }
    var job = {
      id: jobId, type: 'tunnel', cells: cells, next: 0, room: null,
      nodes: nodes, done: false, lastProgress: this.age, startedAt: this.age
    };
    this.jobs.push(job);
    // Junction points every few strides, so side galleries and chambers can be
    // hung off this one as soon as that stretch has actually been dug out.
    for (var k = 5; k < nodes.length; k += 6) {
      this.frontier.push({
        x: Math.round(nodes[k].x), y: Math.round(nodes[k].y),
        a: nodes[k].a, job: jobId, end: false
      });
    }
    var end = nodes[nodes.length - 1];
    this.frontier.push({ x: Math.round(end.x), y: Math.round(end.y), a: end.a, job: jobId, end: true });
    if (this.frontier.length > 120) this.frontier.splice(0, this.frontier.length - 120);
    return job;
  };

  Colony.prototype.inDigRange = function (x, y, minY, maxY, openTop) {
    var g = this.grid;
    if (minY === undefined) minY = g.surfaceRow + 1;
    /* Keep the bore itself, and not just its centre-line, under the lid: a disc
     * opens a radius above where it is planned, and a gallery that surfaced was
     * a gallery the spoil heap drained into. */
    if (!openTop) {
      var lid = this.roofRow(x) + Math.ceil(CFG.tunnelRadius);
      if (minY < lid) minY = lid;
    }
    var floor = maxY === undefined ? g.rows - 4 : Math.min(g.rows - 4, maxY);
    /* Every dig is held inside the lens the colony can afford to haul from, so
     * chambers and side galleries taper away at the edges along with the
     * shafts, rather than the nest ending on a level cut. */
    var lens = this.workFloorAt(x);
    if (lens < floor) floor = lens;
    return x > 3 && x < g.cols - 4 && y > minY && y < floor;
  };

  Colony.prototype.unclaim = function (cells) {
    var g = this.grid;
    for (var i = 0; i < cells.length; i++) {
      g.owner[cells[i].y * g.cols + cells[i].x] = 0;
    }
  };

  Colony.prototype.planRoom = function (cx, cy, type, rx, ry, anchor) {
    var g = this.grid;
    /* A nursery must be buried: its centre, not just the frontier it hangs off,
     * has to sit below the egg-depth line, or a big chamber offset upward from a
     * deep gallery can still break the "brood stays deep" rule. */
    if (type === NURSERY) {
      var minRow = g.surfaceRow + Math.ceil(CFG.eggDepthFraction * g.sandDepth);
      if (Math.round(cy) < minRow) return null;
    }
    /* A chamber needs the same lid of ground over it as a gallery, and it is
     * taller, so it is its ceiling that has to clear the crust and not its
     * centre.  Somewhere else in the nest will do; a room that pokes out of the
     * hillside is a hole for the spoil heap to run into. */
    if (Math.round(cy) - Math.ceil(ry) < this.roofRow(cx)) return null;
    var jobId = this.nextJobId++;
    var exempt = anchor
      ? { x: Math.round(anchor.x), y: Math.round(anchor.y), r: CFG.tunnelRadius + CFG.clearance + 1 }
      : null;
    // shrink until it fits between existing galleries
    var tries = 0;
    while (tries < 4 && this.blocked(cx, cy, Math.max(rx, ry) + CFG.clearance, jobId, exempt)) {
      rx *= 0.75; ry *= 0.75; tries++;
      if (rx < 2 || ry < 1.6) { this.nextJobId--; return null; }
    }
    if (this.blocked(cx, cy, Math.max(rx, ry) + CFG.clearance, jobId, exempt)) { this.nextJobId--; return null; }
    /* An access neck from the junction into the chamber, carved first, so the
     * ants open the chamber from the gallery instead of finding a sealed pocket
     * of rock they can never reach.
     *
     * It arrives at the chamber's floor, on the side the gallery comes from -
     * a doorway, not a hole in the ceiling.  An ant only walks where it has
     * something to stand on, so a neck that met the middle of a tall chamber
     * left the floor cut off from the gallery: brood could not be carried in,
     * and the far half of the room could never be dug. */
    var neck = [];
    var doorX = cx, doorY = cy + Math.max(0, ry - 0.8);
    if (anchor) {
      doorX = cx + (anchor.x < cx ? -1 : 1) * rx * 0.45;
      var neckSteps = Math.max(1, Math.ceil(U.dist(anchor.x, anchor.y, doorX, doorY)));
      for (var s = 1; s <= neckSteps; s++) {
        var t = s / neckSteps;
        this.carveDisc(U.lerp(anchor.x, doorX, t), U.lerp(anchor.y, doorY, t),
                       CFG.tunnelRadius, neck, jobId);
      }
    }
    var body = [];
    var irx = Math.ceil(rx), iry = Math.ceil(ry);
    for (var dy = -iry; dy <= iry; dy++) {
      for (var dx = -irx; dx <= irx; dx++) {
        var e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
        if (e > 1) continue;
        var x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (!g.inb(x, y) || y < this.roofRow(x)) continue;
        var i = y * g.cols + x;
        if (g.owner[i] !== 0 || g.dug[i] === 1 || g.type[i] !== root.Grid.SAND) continue;
        g.owner[i] = jobId;
        body.push({ x: x, y: y, d: Math.abs(x - doorX) });
      }
    }
    /* Hollowed from the floor up, a row at a time, working out from the doorway.
     * Digging from the middle out instead - which is what this used to do - eats
     * a pocket whose own middle has nothing to stand on: the walk graph breaks
     * across the chamber, the diggers cannot reach the far faces, and the room
     * stalls at four cells across for good.  Floor-up leaves the row being
     * worked with rock still over it, so there is always a foothold, and it is
     * how an ant actually enlarges a chamber: it lowers the floor and lifts the
     * ceiling from a face it can stand at. */
    body.sort(function (a, b) { return (b.y - a.y) || (a.d - b.d); });
    var cells = neck.concat(body);
    if (body.length < 5 || cells.length < 6) { this.unclaim(cells); return null; }
    var room = {
      id: this.nextRoomId++, type: type, cx: Math.round(cx), cy: Math.round(cy),
      rx: rx, ry: ry, cells: body, excavated: false, food: 0, stores: []
    };
    for (var c = 0; c < body.length; c++) g.room[body[c].y * g.cols + body[c].x] = room.id;
    this.rooms.push(room);
    var job = {
      id: jobId, type: 'room', cells: cells, next: 0, room: room,
      nodes: [{ x: cx, y: cy, a: 0 }], done: false, lastProgress: this.age, startedAt: this.age
    };
    this.jobs.push(job);
    this.frontier.push({ x: room.cx, y: room.cy, a: this.rng.range(0, 6.28), job: jobId, end: true });
    return job;
  };

  /* Hang a chamber off a gallery junction.  Straight ahead first, then off to
   * either side, so a chamber can open beside a tunnel that is still being
   * dug rather than fighting it for the same rock. */
  /* `minRow`, if given, is a depth the room's middle must not be above - a
   * frontier node deep enough is not enough on its own, because two of the
   * candidate spots sit off to the side of it and one can end up higher. */
  Colony.prototype.planRoomNear = function (node, type, rx, ry, minRow) {
    var reach = rx + CFG.tunnelRadius + CFG.clearance;
    var perp = node.a + Math.PI / 2;
    var cands = [
      { x: node.x + Math.cos(node.a) * (rx + 2), y: node.y + Math.sin(node.a) * (rx + 2) },
      { x: node.x + Math.cos(perp) * reach, y: node.y + Math.sin(perp) * reach },
      { x: node.x - Math.cos(perp) * reach, y: node.y - Math.sin(perp) * reach },
      { x: node.x + Math.cos(node.a + 0.9) * reach, y: node.y + Math.sin(node.a + 0.9) * reach }
    ];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (minRow != null && c.y < minRow) continue;
      if (!this.inDigRange(c.x, c.y, this.grid.surfaceRow + 2)) continue;
      var job = this.planRoom(c.x, c.y, type, rx, ry, node);
      if (job) return job;
    }
    return null;
  };

  Colony.prototype.activeJobs = function () {
    var n = 0;
    for (var i = 0; i < this.jobs.length; i++) if (!this.jobs[i].done) n++;
    return n;
  };
  Colony.prototype.remainingDigCells = function () {
    var n = 0;
    for (var i = 0; i < this.jobs.length; i++) {
      var j = this.jobs[i];
      if (j.done) continue;
      n += j.cells.length - j.next;
    }
    return n;
  };
  Colony.prototype.roomsOfType = function (type) {
    var out = [];
    for (var i = 0; i < this.rooms.length; i++) if (this.rooms[i].type === type) out.push(this.rooms[i]);
    return out;
  };

  /* Room radii in cells, scaled live so the settings panel can make the whole
   * nest roomier without touching anything else.  The two multipliers are
   * separate because a nursery grows lengthways as the colony can afford it but
   * never gets shorter than the queen: she sits in the smallest cell there is,
   * and a chamber she does not fit in reads as a mistake however small the
   * colony that dug it. */
  Colony.prototype.roomSize = function (type, mulX, mulY) {
    var s = CFG.roomScale, mx = s * (mulX || 1), my = s * (mulY || 1);
    if (type === NURSERY) return { rx: CFG.nurseryRx * mx, ry: CFG.nurseryRy * my };
    if (type === GRANARY) return { rx: CFG.granaryRx * mx, ry: CFG.granaryRy * my };
    return { rx: CFG.chamberRx * mx, ry: CFG.chamberRy * my };
  };

  /* ---- the nursery ladder ------------------------------------------------
   * Nursery n is bigger than nursery n-1, sits deeper, and is only attempted
   * once the colony has the workers to shift that much rock.  Past the end of
   * the ladder the last entry repeats, so a very old colony keeps adding
   * caverns rather than stopping. */
  function tierAt(list, n, fallback) {
    if (!list || !list.length) return fallback;
    return list[U.clamp(n, 0, list.length - 1)];
  }
  Colony.prototype.nurseryScale = function (n) { return tierAt(CFG.nurseryScales, n, 1); };
  Colony.prototype.nurseryDepth = function (n) {
    return tierAt(CFG.nurseryDepths, n, CFG.eggDepthFraction);
  };
  /* Which nursery the colony should dig next, or null if it has not earned one.
   * The founding cell is tier 0, so the tier wanted is simply how many
   * nurseries already exist. */
  Colony.prototype.nurseryTier = function () {
    var n = this.roomsOfType(NURSERY).length;
    if (n >= CFG.nurseryScales.length) return null;
    if (this.workers() < tierAt(CFG.nurseryWorkers, n, 0)) return null;
    return n;
  };
  /* How much brood one nursery holds: how far the pile can spread along the
   * widest open row it has been dug to, up to a ceiling.  Measured on the hole
   * as actually excavated, not on the plan, so a chamber half cut out holds
   * half as much - and the room's height does not count, because brood is piled
   * on a floor and not stacked up a wall.  The founding cell has space for a
   * couple of eggs, which is the whole point: nursery space, not food, is what
   * limits a young colony. */
  Colony.prototype.roomWidest = function (room) {
    var g = this.grid, rows = {}, best = 0;
    for (var i = 0; i < room.cells.length; i++) {
      var c = room.cells[i];
      if (g.solid(c.x, c.y)) continue;
      var n = (rows[c.y] || 0) + 1;
      rows[c.y] = n;
      if (n > best) best = n;
    }
    return best;
  };
  Colony.prototype.nurseryHolds = function (room) {
    var n = Math.round(this.roomWidest(room) * CFG.broodPerFloorCell);
    return U.clamp(n, 1, CFG.eggsPerNursery);
  };

  /* A chamber still being hollowed out that the colony should finish before it
   * starts anything else.  A half-dug room is indistinguishable from a wide
   * spot in a gallery, so a nest full of them is exactly the scribble we are
   * trying to avoid.  A plan nobody has touched for a while does not count -
   * it may be unreachable, and the colony must not stall waiting on it. */
  Colony.prototype.unfinishedChamber = function (type) {
    for (var i = 0; i < this.jobs.length; i++) {
      var j = this.jobs[i];
      if (j.done || !j.room) continue;
      if (type && j.room.type !== type) continue;
      if (this.age - j.lastProgress > 25) continue;
      if (!this.roomReady(j.room)) return j;
    }
    return null;
  };

  /* Keep a job queue ahead of the workforce without spreading it thin. */
  Colony.prototype.ensureWork = function () {
    var g = this.grid;
    var workers = this.workers();
    // Fewer galleries open at once: a nest that is all corridor looks busy but
    // reads as a scribble.  Keep a couple of digs going and put the effort into
    // rooms instead.
    var target = U.clamp(1 + Math.floor(workers / CFG.digsPerWorkers), 1, CFG.maxActiveDigs);
    this.pruneJobs();
    if (this.activeJobs() >= target) return;
    /* The founding queen digs one thing at a time: her shaft, then her first
     * nursery, then she lays.  Opening a second gallery for her to fret over is
     * how she ended up with a scribble of half-dug tunnels and no chamber, so
     * while she has an unfinished chamber on the go nothing else is queued. */
    if (this.workers() === 0 && this.unfinishedChamber()) return;
    /* Once there are workers, a chamber still gets priority - keep the queue to
     * it and one other job - but the colony is no longer betting everything on
     * a single digger, so one gallery may run alongside. */
    if (this.activeJobs() >= 2 && this.unfinishedChamber()) return;

    // 1. founding ramp
    if (!this.jobs.length) {
      var ex = this.entrance.x;
      var top = g.topSolid(ex);
      this.entrance.y = top;
      var a = this.rng.sign() > 0 ? 0.85 : Math.PI - 0.85;
      // only as long as it has to be: the shaft stops where the first nursery
      // wants to be, so the queen gets to laying instead of digging for ever.
      // She hauls every grain of it up herself, so a compact, climbable descent
      // keeps the round trip short until her daughters can take over.
      var need = Math.ceil(this.nurseryDepth(0) * g.sandDepth);
      var steps = U.clamp(Math.ceil(need / 0.62) + 2, 12, 46);
      this.planTunnel(ex, top, a, steps, true, { openTop: true, minY: top - 1, roof: top + 1 });
      return;
    }

    /* 2. the founding cell.  Deliberately tiny: room for a couple of eggs and no
     * more, because the queen digs and hauls every grain of it herself and the
     * colony needs her laying, not excavating.  Her daughters cut the real
     * nursery deeper down once there are enough of them - see nurseryTier. */
    var nurseries = this.roomsOfType(NURSERY);
    var sz;
    if (!nurseries.length) {
      var spot = this.deepFrontier(g.surfaceRow + Math.ceil(this.nurseryDepth(0) * g.sandDepth));
      sz = this.roomSize(NURSERY, this.nurseryScale(0), 1);
      if (spot && this.planRoomNear(spot, NURSERY, sz.rx, sz.ry)) return;
      this.extendDeeper();
      return;
    }

    // 3. more chambers as the colony grows
    var pop = this.ants.length;
    /* Each nursery is bigger and deeper than the last, and the colony takes the
     * next one on as soon as it has the workers to shift that much rock - the
     * founding cell, then a proper chamber, then a cavern.  It is the workforce
     * that gates it, not a shortage of space: a colony that waited until the
     * brood pile was full would only ever dig when it was already stuck.  That
     * is also what gets brood carried about - nurses sort it between chambers by
     * stage, so there has to be somewhere better to sort it to.
     *
     * Capacity only counts finished nurseries, so a nursery still being dug
     * reads as "no room for brood" and used to make the colony plan yet another
     * one - three half-dug rooms and nowhere to put an egg.  One nursery goes in
     * at a time. */
    /* One place to put food comes before a second nursery.  A colony with
     * nowhere to store a flake eats every one it fetches where it stands, and a
     * nest that never fills a larder slides into famine with food lying all
     * over the surface - and then has too few workers to dig its way out. */
    if (pop > 3 && !this.openGranary() && !this.unfinishedChamber(GRANARY)) {
      var s0 = this.frontierNear(g.surfaceRow + 4, g.surfaceRow + Math.ceil(0.10 * g.sandDepth));
      sz = this.roomSize(GRANARY);
      if (s0 && this.planRoomNear(s0, GRANARY, sz.rx, sz.ry)) return;
    }
    if (!this.unfinishedChamber(NURSERY) && this.nurseryTier() !== null) {
      var tier = this.nurseryTier();
      /* Never shallower than the nursery before it.  The tier depth is a floor,
       * but the planner puts a room where the rock allows, so without this a
       * later, grander nursery can land above an earlier one and the nest stops
       * reading as having grown downwards. */
      var want = g.surfaceRow + Math.ceil(this.nurseryDepth(tier) * g.sandDepth);
      for (var q = 0; q < nurseries.length; q++) {
        if (nurseries[q].cy + 2 > want) want = nurseries[q].cy + 2;
      }
      var s2 = this.deepFrontier(want);
      sz = this.roomSize(NURSERY, this.nurseryScale(tier), 1);
      if (s2 && this.planRoomNear(s2, NURSERY, sz.rx, sz.ry, want)) return;
    }
    // granaries go high in the nest, a short carry from the entrance
    if (this.roomsOfType(GRANARY).length < Math.min(3, 1 + ((pop / 14) | 0)) && pop > 3) {
      var s3 = this.frontierNear(g.surfaceRow + 4, g.surfaceRow + Math.ceil(0.10 * g.sandDepth));
      sz = this.roomSize(GRANARY);
      if (s3 && this.planRoomNear(s3, GRANARY, sz.rx, sz.ry)) return;
    }
    if (pop > 10 && this.roomsOfType(CHAMBER).length < Math.min(4, (pop / 10) | 0)) {
      var s5 = this.frontierNear(g.surfaceRow + 6, g.surfaceRow + Math.ceil(0.18 * g.sandDepth));
      sz = this.roomSize(CHAMBER);
      if (s5 && this.planRoomNear(s5, CHAMBER, sz.rx, sz.ry)) return;
    }
    // 4. otherwise keep tunnelling
    this.extendDeeper();
  };

  Colony.prototype.pruneJobs = function () {
    for (var i = this.jobs.length - 1; i >= 0; i--) {
      var j = this.jobs[i];
      if (j.done) continue;
      this.advanceJob(j);
      if (j.next >= j.cells.length) {
        j.done = true;
        if (j.room) j.room.excavated = true;
        continue;
      }
      /* A chamber whose remaining rock is all out of reach is as dug out as the
       * colony can manage - the middle of a ceiling no ant can get a foothold
       * under.  It counts as finished once enough of it is open to be a room,
       * so the brood can move in instead of the queen waiting on grains that
       * will never come out. */
      if (j.room && !j.room.excavated && this.age - j.startedAt > 8 &&
          this.roomOpen(j.room) >= this.roomFloorTarget(j.room) &&
          !this.roomWorkable(j.room)) {
        j.done = true;
        j.room.excavated = true;
        this.unclaim(j.cells.slice(j.next));
        continue;
      }
      // A plan nobody can get at (sealed off by a later collapse, or simply
      // unreachable) is abandoned so it stops holding up new work; the rock
      // is released for future plans.
      if (this.age - j.lastProgress > 90 && this.jobDiggers(j) === 0) {
        j.done = true;
        j.abandoned = true;
        this.unclaim(j.cells.slice(j.next));
        if (j.room && !j.room.excavated) this.dropRoom(j.room);
      }
    }
    for (var k = this.frontier.length - 1; k >= 0; k--) {
      if ((this.frontier[k].used || 0) > 3) this.frontier.splice(k, 1);
    }
  };

  Colony.prototype.dropRoom = function (room) {
    var g = this.grid;
    for (var i = 0; i < room.cells.length; i++) {
      var c = room.cells[i];
      if (g.solid(c.x, c.y)) g.room[c.y * g.cols + c.x] = 0;
    }
    var k = this.rooms.indexOf(room);
    if (k >= 0 && this.roomOpen(room) < 4) this.rooms.splice(k, 1);
  };

  Colony.prototype.advanceJob = function (job) {
    var g = this.grid;
    var before = job.next;
    while (job.next < job.cells.length) {
      var c = job.cells[job.next];
      if (g.solid(c.x, c.y)) break;
      job.next++;
    }
    if (job.next !== before) job.lastProgress = this.age;
  };

  /* Ants actually working this job right now.  An ant keeps its `job` while it
   * is off foraging or bringing the queen a drink, so counting bare references
   * made idle plans look fully staffed: other diggers were repelled by the
   * crowding penalty and the stale-job reaper never fired, which is how a
   * granary could sit two grains wide for ten minutes. */
  Colony.prototype.jobDiggers = function (job) {
    var n = 0;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.job !== job || !a.alive || !a.task) continue;
      if (a.task.kind === 'DIG' || a.task.kind === 'HAUL') n++;
    }
    return n;
  };

  /* Junctions only count once that stretch of gallery is actually open -
   * planning off un-dug rock just piles up work nobody can reach. */
  Colony.prototype.deepFrontier = function (minRow) {
    var best = null, bestScore = -1e9;
    for (var i = 0; i < this.frontier.length; i++) {
      var f = this.frontier[i];
      if (f.y < minRow) continue;
      if (!this.grid.isDug(f.x, f.y)) continue;
      var score = f.y - (f.used || 0) * 6 + this.rng.range(0, 4);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (best) best.used = (best.used || 0) + 1;
    return best;
  };

  /* A junction at roughly the depth a given kind of chamber wants.  Hanging
   * everything off the deepest frontier is what buried the granaries at the
   * bottom of the nest, and every flake then cost a two-minute round trip. */
  Colony.prototype.frontierNear = function (minRow, targetRow) {
    var best = null, bestScore = -1e9;
    for (var i = 0; i < this.frontier.length; i++) {
      var f = this.frontier[i];
      if (f.y < minRow) continue;
      if (!this.grid.isDug(f.x, f.y)) continue;
      var score = -Math.abs(f.y - targetRow) - (f.used || 0) * 6 + this.rng.range(0, 3);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (best) best.used = (best.used || 0) + 1;
    return best;
  };

  /* How deep the colony is willing to work.  A handful of ants keeps its nest
   * compact - it cannot afford the walk - and the galleries only reach for the
   * bottom of the sand as the workforce grows into it. */
  Colony.prototype.workDepthRows = function () {
    /* A nest only goes as deep as it has ants to work it.  Letting the frontier
     * run to the bottom of the sand made every haul a round trip of the whole
     * column, so workers gave up and plastered their spoil into the walls
     * instead - and the hill on the surface stopped growing. */
    var frac = U.clamp(0.28 + this.workers() * CFG.workDepthPerWorker,
                       Math.min(0.28, CFG.workDepthMax), CFG.workDepthMax);
    return frac * this.grid.sandDepth;
  };

  /* The deepest row the colony will work in a given column.
   *
   * The budget is a haul, so it is spent by walking sideways as well as by
   * going down: the ground the colony can afford to work is a lens, deepest
   * under the entrance and tapering to shallow galleries out at the edges.  A
   * couple of long, incommensurate waves keep the edge of that lens uneven -
   * deterministic in x, so the floor does not shimmer from frame to frame, and
   * cheap enough to call per cell. */
  Colony.prototype.workFloorAt = function (x) {
    var g = this.grid;
    var budget = this.workDepthRows();
    /* The taper stops at the depth the nest core needs: a nursery has to sit
     * below the brood line with a chamber's worth of headroom under it, and a
     * lens that pinched in above that line left the founding queen with
     * nowhere her first chamber would fit.  So a young colony's floor is level
     * - it is compact anyway - and the lens only opens up as the workforce
     * earns depth the sides cannot pay the walk for. */
    var need = Math.min(budget, Math.max(CFG.workFloorMinRows,
                        CFG.eggDepthFraction * g.sandDepth + 8));
    var out = Math.max(0, Math.abs(x - this.entrance.x) - CFG.workCoreCells);
    var wob = Math.sin(x * 0.045 + 1.7) * 0.6 + Math.sin(x * 0.017 - 0.4) * 0.4;
    var rows = budget - CFG.workLateralCost * out
                      + (budget - need) * CFG.workFloorWobble * wob;
    if (rows < need) rows = need;
    return g.surfaceRow + Math.ceil(rows);
  };

  // the deepest the nest works anywhere, for jobs that need one number
  Colony.prototype.workDepthRow = function () {
    return this.workFloorAt(this.entrance.x);
  };

  Colony.prototype.extendDeeper = function () {
    var g = this.grid;
    var f = null, bestScore = -1e9;
    for (var i = 0; i < this.frontier.length; i++) {
      var n = this.frontier[i];
      // Extend from a tunnel's own end, not from partway along it: reusing a
      // frontier more than once is what sprouts a fan of branches off a single
      // junction, so allow it just once and favour real dead ends.
      if ((n.used || 0) > 1) continue;
      if (!g.isDug(n.x, n.y)) continue;
      var s = n.y * 0.6 - (n.used || 0) * 20 + (n.end ? 12 : 0) + this.rng.range(0, 6);
      /* Judged against the floor for that frontier's own column, not one line
       * across the tank: a face out at the edge has spent its budget on the
       * walk and is passed over, while one under the hill still has depth to
       * give.  That is what sinks the nest in the middle. */
      if (n.y > this.workFloorAt(n.x)) s -= 40;
      if (s > bestScore) { bestScore = s; f = n; }
    }
    if (!f) {
      /* No usable frontier left: sink a fresh shaft and give the nest a second
       * entrance.  It has to break ground where the ground is still ground -
       * start a shaft inside the spoil heap and the heap drains straight down it
       * - so look outward from the hill for the nearest column whose crust is
       * not buried under spoil, jittered a little so it is not always the same
       * side. */
      var ex = null;
      for (var off = 6; off <= 44 && ex === null; off += 2) {
        for (var sgn = this.rng.sign(), s2 = 0; s2 < 2 && ex === null; s2++, sgn = -sgn) {
          var cand = U.clamp(this.entrance.x + off * sgn, 4, g.cols - 5);
          if (g.packedTop(cand) <= g.topSolid(cand) + 1) ex = cand;
        }
      }
      if (ex === null) return;
      var top = g.topSolid(ex);
      this.planTunnel(ex, top, this.rng.sign() > 0 ? 1.0 : Math.PI - 1.0, 24, true,
                      { openTop: true, minY: top - 1, roof: top + 1,
                        maxY: this.workFloorAt(ex) });
      return;
    }
    f.used = (f.used || 0) + 1;
    var floor = this.workFloorAt(f.x);
    // at the working floor the galleries spread sideways instead of sinking
    var deep = f.y >= floor - 2;
    // mostly carry on roughly the way the gallery was already heading; only
    // occasionally throw a real branch, so the nest stays legible
    var a = f.a + this.rng.range(-0.6, 0.6) +
            (this.rng.chance(CFG.branchChance) ? this.rng.sign() * 1.4 : 0);
    /* Out near the rim of the lens there is nothing left to dig outward into, so
     * a gallery that has bottomed out there is turned back under the nest
     * instead of butting into the edge of what the colony can afford. */
    var reach = this.workDepthRows() / Math.max(0.05, CFG.workLateralCost);
    var dx = f.x - this.entrance.x;
    if (deep && Math.abs(dx) > reach * 0.5 && Math.cos(a) * dx > 0) a = Math.PI - a;
    var steps = CFG.minTunnelSteps + this.rng.int(CFG.maxTunnelSteps - CFG.minTunnelSteps);
    this.planTunnel(f.x, f.y, a, steps, !deep, { maxY: floor });
  };

  // ----------------------------------------------------- digging contracts
  Colony.prototype.pickJob = function (ant, exclude) {
    var best = null, bestScore = -1e9;
    var c = this.grid.cell;
    for (var i = 0; i < this.jobs.length; i++) {
      var j = this.jobs[i];
      if (j.done) continue;
      if (exclude && exclude.indexOf(j) >= 0) continue;
      this.advanceJob(j);
      if (j.next >= j.cells.length) continue;
      var cell = j.cells[j.next];
      var d = U.dist(ant.x, ant.y, (cell.x + 0.5) * c, (cell.y + 0.5) * c);
      var score = -d * 0.05 - this.jobDiggers(j) * 14;
      /* Chambers before galleries.  A room is a handful of grains that turns
       * into somewhere the colony can put brood or food, whereas a tunnel is
       * open-ended - if the two compete on distance alone the nest ends up all
       * corridor and no storage.  For the founding queen it is not a preference
       * but the whole job: she finishes her first nursery and lays, so a room
       * outweighs any distance to a stray tunnel she would otherwise potter off
       * into and never come back from. */
      if (j.room) score += j.room.type === NURSERY
        ? (this.workers() === 0 ? 1000 : 12) : 9;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    return best;
  };

  /* Find an open working face in a job: a grain still in place that this ant
   * can actually get to and stand next to right now.
   *
   * The reachability test is the whole point.  Hollowing a chamber leaves
   * interior air cells with no foothold, which sever the walk graph, so a face
   * with a free station beside it is no use if the ant cannot path to that
   * station - it just re-routes forever and the room stalls half-dug.  So the
   * cells are tried in plan order (floor-up, out from the door) and the first
   * one the ant can genuinely walk to is returned, skipping any stranded face
   * until the excavation opens a way to it. */
  Colony.prototype.findFace = function (job, ant) {
    var g = this.grid;
    this.advanceJob(job);
    var sx = ant.cellX(), sy = ant.cellY(), fallback = null;
    var limit = job.room ? job.cells.length : Math.min(job.cells.length, job.next + 50);
    for (var k = job.next; k < limit; k++) {
      var c = job.cells[k];
      var i = c.y * g.cols + c.x;
      if (!g.solid(c.x, c.y)) continue;
      if (this.claims[i] !== undefined && this.claims[i] !== ant.id) continue;
      var st = g.workStations(c.x, c.y);
      if (!st.length) continue;
      // already standing at a station: no need to path, take it
      for (var s = 0; s < st.length; s++) {
        if (st[s].x === sx && st[s].y === sy) return { x: c.x, y: c.y, i: i };
      }
      if (job.room) {
        var p = this.pf.find(sx, sy, st);
        if (!p || p.length < 1) continue;      // stranded behind unsupported air
      }
      return { x: c.x, y: c.y, i: i };
    }
    return null;                               // nothing this ant can get at
  };

  /* Does any solid grain of this room still have a station an ant could stand
   * at?  A chamber whose remaining rock is all out of reach - the middle of a
   * ceiling too high to dig from the floor - is as finished as the colony can
   * make it, and is marked excavated rather than left forever unready. */
  Colony.prototype.roomWorkable = function (room) {
    var g = this.grid;
    for (var k = 0; k < room.cells.length; k++) {
      var c = room.cells[k];
      if (!g.solid(c.x, c.y)) continue;
      if (g.workStations(c.x, c.y).length) return true;
    }
    return false;
  };

  Colony.prototype.requestDigCell = function (ant) {
    if (ant.job && (ant.job.done || ant.job.next >= ant.job.cells.length)) ant.job = null;
    var tried = [];
    for (var attempt = 0; attempt < 3; attempt++) {
      if (!ant.job) ant.job = this.pickJob(ant, tried);
      if (!ant.job) return null;
      var face = this.findFace(ant.job, ant);
      if (face) {
        this.claims[face.i] = ant.id;
        ant.digCell = face;
        return face;
      }
      tried.push(ant.job);      // nothing workable here yet - try another job
      ant.job = null;
    }
    return null;
  };

  Colony.prototype.releaseDigCell = function (ant) {
    if (ant.digCell) {
      if (this.claims[ant.digCell.i] === ant.id) delete this.claims[ant.digCell.i];
      ant.digCell = null;
    }
  };

  Colony.prototype.onGrainRemoved = function (x, y, ant) {
    var g = this.grid;
    var job = ant.job;
    if (job) {
      this.advanceJob(job);
      if (job.next >= job.cells.length) {
        job.done = true;
        if (job.room) job.room.excavated = true;
        ant.job = null;
      }
    }
    this.phero.drop(0, x, y, 0.5);
  };

  Colony.prototype.digPressure = function () {
    var rem = this.remainingDigCells();
    if (rem <= 0) return 0.1;
    var diggers = this.countTask('DIG') + this.countTask('HAUL');
    var want = U.clamp(Math.ceil(rem / 10), 1, Math.max(1, this.workers()));
    return U.clamp((want - diggers) / want * 1.5, 0, 1.5);
  };
  Colony.prototype.needsDigging = function () { return this.remainingDigCells() > 0; };

  /* Where spoil may be dropped: only on ground supported on both shoulders,
   * which grows the classic 45 degree crater/cone around the entrance. */
  /* Is any excavated cell within `r` of here?  Spoil has to be tipped well
   * clear of the nest mouth: drop it on the lip and it rolls straight back
   * down the shaft, which both undoes the digging and blocks the gallery. */
  Colony.prototype.nearDug = function (x, y, r) {
    var g = this.grid;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (g.inb(x + dx, y + dy) && g.isDug(x + dx, y + dy)) return true;
      }
    }
    return false;
  };

  Colony.prototype.dumpTarget = function (ant) {
    var g = this.grid;
    var ex = this.entrance.x;
    // the tip hugs the entrance at first and spreads as the hill grows
    var far = Math.round(U.clamp(9 + this.stats.grainsMoved / 70, 10, 28));
    var keep = CFG.dumpKeepOut;
    var list = [], best = null, bestY = 1e9;
    for (var pass = 0; pass < 2; pass++) {
      var span = pass === 0 ? far : far * 2.4;
      /* First choice is well clear of any gallery; failing that, anywhere that is
       * not literally a gallery mouth will do.  The wide keep-out alone rejected
       * every column on the hill once a chamber had been dug near the surface -
       * ants had nowhere legal to tip, so every load was pressed into a wall
       * instead and the hill stopped growing.  A grain resting on top of the
       * crust cannot fall into a tunnel beneath it: topSolid guarantees the cell
       * below is packed sand. */
      var dugKeep = pass === 0 ? keep : 1;
      for (var off = keep; off <= span; off++) {
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          var x = Math.round(ex + off * sgn);
          if (x < 2 || x > g.cols - 3) continue;
          var top = g.topSolid(x);
          var y = top - 1;
          if (y < 3 || y >= g.rows) continue;
          if (!g.isAir(x, y)) continue;
          if (!g.supported(x, y)) continue;          // 45 degree rule
          if (this.nearDug(x, y, dugKeep)) continue; // never backfill a gallery
          if (!g.workStations(x, y).length) continue;
          list.push({ x: x, y: y });
          if (y < bestY) { bestY = y; best = { x: x, y: y }; }
        }
      }
      if (list.length) break;
    }
    if (!list.length) return null;
    // mostly raise the peak, sometimes broaden the skirt
    return this.rng.chance(0.6) ? best : this.rng.pick(list);
  };

  // ------------------------------------------------------------- rooms API
  Colony.prototype.roomCells = function (room) {
    var g = this.grid, out = [];
    for (var i = 0; i < room.cells.length && out.length < 30; i++) {
      var c = room.cells[i];
      if (g.walkable(c.x, c.y)) out.push({ x: c.x, y: c.y });
    }
    return out;
  };
  /* The floor of a chamber: open cells with sand directly beneath them, ordered
   * outwards from the middle of the room.  Brood piles and food stores belong on
   * the floor - dotted around the walls they read as decoration rather than as
   * a colony's stores. */
  Colony.prototype.roomFloor = function (room) {
    var g = this.grid, out = [], cx = room.cx;
    for (var i = 0; i < room.cells.length; i++) {
      var c = room.cells[i];
      if (g.solid(c.x, c.y) || !g.solid(c.x, c.y + 1)) continue;
      out.push({ x: c.x, y: c.y });
    }
    out.sort(function (a, b) { return Math.abs(a.x - cx) - Math.abs(b.x - cx); });
    return out.length ? out : this.roomCells(room);
  };

  /* Where a nurse sets a grub down.  Ants keep brood in one tight pile in the
   * middle of the chamber floor, and that pile is most of what makes a nursery
   * look like a nursery rather than a hole. */
  Colony.prototype.broodSpot = function (room) {
    var cells = this.roomFloor(room);
    if (!cells.length) return null;
    var c = cells[this.rng.int(Math.min(cells.length, 5))];
    var g = this.grid;
    return {
      x: (c.x + 0.5) * g.cell + this.rng.range(-1.6, 1.6),
      y: (c.y + 0.7) * g.cell
    };
  };

  Colony.prototype.roomOpen = function (room) {
    var g = this.grid, n = 0;
    for (var i = 0; i < room.cells.length; i++) {
      if (!g.solid(room.cells[i].x, room.cells[i].y)) n++;
    }
    return n;
  };
  /* Is this chamber hollowed out enough to be used as one?  The queen used to
   * settle into the first pocket of a room plan that opened up, so she laid in
   * what still looked like the tunnel and the chamber never got finished.
   *
   * The founding queen is the exception: she digs her first nursery alone and
   * slowly, and a claustral queen lays her first brood in a small sealed cell,
   * so once a handful of cells are open she gets on with it.  The strict
   * fraction only applies once there are workers to finish a chamber properly. */
  /* How much of a chamber's plan the colony can realistically open.  An ant
   * hollows a chamber from its floor, so the low rows all come out but the
   * middle of the ceiling, with no foothold under it, never does.  A shallow
   * room loses only a few grains that way, and treating the reachable floor as
   * the target - rather than every planned cell - is what lets a chamber ever
   * count as finished instead of waiting forever on rock no ant can get at. */
  Colony.prototype.roomFloorTarget = function (room) {
    if (this.workers() === 0) {
      // the lone queen lays as soon as she has scratched out a proper floor;
      // her daughters widen the cell into a real nursery once they emerge
      return Math.max(CFG.foundingReadyCells, Math.ceil(room.cells.length * CFG.foundingReadyFraction));
    }
    return Math.max(10, Math.ceil(room.cells.length * CFG.chamberReadyFraction));
  };

  Colony.prototype.roomReady = function (room) {
    if (room.excavated) return true;
    return this.roomOpen(room) >= this.roomFloorTarget(room);
  };
  Colony.prototype.nurseryCapacity = function () {
    var rooms = this.roomsOfType(NURSERY), cap = 0;
    for (var i = 0; i < rooms.length; i++) {
      if (!this.roomReady(rooms[i])) continue;
      cap += this.nurseryHolds(rooms[i]);
    }
    return cap;
  };
  Colony.prototype.broodIn = function (room) {
    var n = 0;
    for (var i = 0; i < this.brood.length; i++) if (this.brood[i].room === room.id) n++;
    return n;
  };
  /* Every nursery that is deep enough and dug out enough to hold brood,
   * deepest first - which is also the order the nurses sort brood into. */
  Colony.prototype.usableNurseries = function () {
    var g = this.grid;
    var minRow = g.surfaceRow + Math.ceil(CFG.eggDepthFraction * g.sandDepth);
    var rooms = this.roomsOfType(NURSERY), out = [];
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.cy < minRow) continue;
      if (!this.roomReady(r)) continue;
      if (!this.roomCells(r).length) continue;
      out.push(r);
    }
    out.sort(function (a, b) { return b.cy - a.cy; });
    return out;
  };
  /* A nursery deep enough to protect brood and with room to spare. */
  Colony.prototype.roomForEggs = function (excludeRoomId) {
    var rooms = this.usableNurseries(), best = null, bestFree = 0;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (excludeRoomId && r.id === excludeRoomId) continue;
      var free = this.nurseryHolds(r) - this.broodIn(r);
      if (free > bestFree) { bestFree = free; best = r; }
    }
    return best;
  };
  /* How many flakes a granary holds: as much as its floor has room for, so a
   * chamber the colony bothered to dig big is worth having dug. */
  Colony.prototype.granaryCapacity = function (room) {
    return Math.max(4, Math.round(this.roomFloor(room).length * CFG.granaryPerFloorCell));
  };
  /* Loads already on their way to this room.  Without counting them a dozen
   * carriers all get told the same half-empty granary has room, and it ends up
   * well over capacity - after which it never reports room again and every
   * forager eats its load on the surface instead. */
  Colony.prototype.foodInbound = function (room) {
    var n = 0;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (!a.alive || !a.carrying || a.carrying.kind !== 'food') continue;
      if (a.task && a.task.kind === 'STORE_FOOD' && a.task.room === room) n++;
    }
    return n;
  };
  Colony.prototype.roomForFood = function () {
    var rooms = this.roomsOfType(GRANARY), best = null, bestFree = 0;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (this.roomOpen(r) < 4 || !this.roomCells(r).length) continue;
      var free = this.granaryCapacity(r) - r.food - this.foodInbound(r);
      if (free > bestFree) { bestFree = free; best = r; }
    }
    return best;
  };
  /* A granary dug out enough to put something in, full or not. */
  Colony.prototype.openGranary = function () {
    var rooms = this.roomsOfType(GRANARY);
    for (var i = 0; i < rooms.length; i++) {
      if (this.roomOpen(rooms[i]) >= 4 && this.roomCells(rooms[i]).length) return rooms[i];
    }
    return null;
  };
  Colony.prototype.roomWithFood = function () {
    var rooms = this.roomsOfType(GRANARY);
    for (var i = 0; i < rooms.length; i++) if (rooms[i].food >= 1 && this.roomCells(rooms[i]).length) return rooms[i];
    return null;
  };
  Colony.prototype.totalFood = function () {
    var rooms = this.roomsOfType(GRANARY), n = 0;
    for (var i = 0; i < rooms.length; i++) n += rooms[i].food;
    return n;
  };
  Colony.prototype.depositFood = function (ant, room) {
    room.food++;
    // stacked on the floor of the granary, heaped out from the middle
    var cells = this.roomFloor(room);
    if (cells.length) {
      var c = cells[this.rng.int(Math.min(cells.length, 8))];
      room.stores.push({
        x: (c.x + 0.5) * this.grid.cell + this.rng.range(-1.2, 1.2),
        y: (c.y + 0.72) * this.grid.cell,
        s: this.rng.range(0.8, 1.3)
      });
    }
    ant.carrying = null;
  };
  Colony.prototype.takeFood = function (room, n) {
    if (room.food < n) return false;
    room.food -= n;
    if (room.stores.length) room.stores.pop();
    return true;
  };
  Colony.prototype.looseFood = function () {
    var n = 0;
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].kind === 'food' && !this.items[i].dead) n++;
    }
    return n;
  };
  /* How keen the colony is to go and fetch.  Nothing lying about means nothing
   * to fetch, however empty the larder - the ants cannot conjure a windfall. */
  Colony.prototype.foodPressure = function () {
    if (!this.looseFood()) return 0;
    var need = this.ants.length * CFG.storePerAnt + 2;
    return U.clamp(1.25 - this.totalFood() / need, 0.15, 1.25);
  };

  /* ---- famine ---------------------------------------------------------
   * One number, 0 (well provisioned) to 1 (nothing in the larder and empty
   * crops all round), that the whole colony throttles itself against: pace,
   * metabolism, brood development and whether the queen lays at all.  It reads
   * both the granary and the ants' own crops, because a colony with a full
   * store and starving workers is not actually hungry - it is just slow to
   * distribute - and one with empty shelves but full bellies has just eaten. */
  Colony.prototype.measureFamine = function () {
    var need = this.ants.length * CFG.storePerAnt + 2;
    var larder = U.clamp(this.totalFood() / need, 0, 1);
    var bellies = 0, n = 0;
    for (var i = 0; i < this.ants.length; i++) {
      if (!this.ants[i].alive) continue;
      bellies += this.ants[i].food; n++;
    }
    bellies = n ? bellies / n : 1;
    this.famineLevel = U.clamp(1 - (larder * 0.6 + bellies * 0.7), 0, 1);
    // hysteresis, so she does not start and stop laying on the boundary
    if (this.layHalted) {
      if (this.famineLevel < CFG.famineLayResume) this.layHalted = false;
    } else if (this.famineLevel > CFG.famineLayStop) this.layHalted = true;
  };
  Colony.prototype.famine = function () { return this.famineLevel; };
  /* The famine the colony actually acts on.  The founding queen and her first
   * clutch live off her reserves, not the larder, so the whole nest ignores
   * famine until there are workers - otherwise an unfed colony could never
   * raise its first generation and the farm would never start. */
  Colony.prototype.effectiveFamine = function () {
    return this.workers() > 0 ? this.famineLevel : 0;
  };
  /* The same for a mouthful of food from the granary.  She is fed by
   * trophallaxis, so this only counts stores she can actually be brought. */
  Colony.prototype.queenFoodNeed = function () {
    var q = this.queen;
    if (!q || !q.alive) return 0;
    if (this.queenFed > 0) return 0;
    if (!this.roomWithFood()) return 0;
    return U.clamp(Math.max(0, 0.8 - q.food) * 2.0, 0, 1.6);
  };

  // -------------------------------------------------------------- brood
  Colony.prototype.canLay = function () {
    var q = this.queen;
    if (!q || !q.alive) return false;
    if (this.layTimer > 0) return false;
    if (q.food < 0.3) return false;
    /* A hungry colony cannot raise brood, so she stops laying entirely rather
     * than filling a nursery with grubs there is nothing to feed.  Egg-laying
     * resumes of its own accord once the larder is stocked again - which is
     * what makes feeding the colony feel like it does something. */
    if (this.layHalted && this.workers() > 0) return false;
    if (this.ants.length >= CFG.maxAnts) return false;
    return this.brood.length < this.nurseryCapacity();
  };

  Colony.prototype.layEgg = function (queen, room) {
    var spot = this.broodSpot(room);
    if (!spot) return;
    this.brood.push({
      id: this.nextBroodId++,
      stage: 'egg', progress: 0, tended: 0,
      x: spot.x, y: spot.y,
      room: room.id, dead: false, hatched: false, heldBy: null,
      moveCd: CFG.broodMoveCooldown * this.rng.range(0.5, 1.2),
      wob: this.rng.range(0, 6.28)
    });
    this.layTimer = CFG.layInterval;
    this.stats.eggsLaid++;
  };

  Colony.prototype.updateBrood = function (dt) {
    var g = this.grid;
    for (var i = this.brood.length - 1; i >= 0; i--) {
      var b = this.brood[i];
      if (b.heldBy) {
        var h = b.heldBy;
        var hp = h.headPos({ x: 0, y: 0 });
        b.x = hp.x; b.y = hp.y;
        continue;
      }
      /* Brood grows on what the nurses feed it, so a famine all but stops
       * development - the clutch waits in the nursery rather than dying. */
      var rate = 1 + (b.tended > 0 ? CFG.broodTendBonus - 1 : 0);
      rate *= 1 - CFG.famineBroodSlow * this.effectiveFamine();
      if (b.tended > 0) b.tended -= dt;
      // leave an item that has just been carried somewhere alone for a while
      if (b.moveCd > 0) b.moveCd -= dt;
      var span = b.stage === 'egg' ? CFG.eggSeconds : b.stage === 'larva' ? CFG.larvaSeconds : CFG.pupaSeconds;
      span *= Math.max(0.05, CFG.broodTimeScale);
      b.progress += dt * rate / span;
      b.wob += dt * 1.7;
      // brood buried by a cave-in or dropped in the open is lost
      if (g.solid(Math.floor(b.x / g.cell), Math.floor(b.y / g.cell))) { this.brood.splice(i, 1); continue; }
      if (b.progress >= 1) {
        b.progress = 0;
        if (b.stage === 'egg') b.stage = 'larva';
        else if (b.stage === 'larva') b.stage = 'pupa';
        else {
          b.hatched = true;
          this.brood.splice(i, 1);
          this.hatch(b);
        }
      }
    }
  };

  Colony.prototype.hatch = function (b) {
    if (this.ants.length >= CFG.maxAnts) return;
    var soldiers = 0, adults = 0;
    for (var i = 0; i < this.ants.length; i++) {
      if (this.ants[i].caste === Ant.SOLDIER) soldiers++;
      if (this.ants[i].caste !== Ant.QUEEN) adults++;
    }
    var wantSoldier = adults > 5 &&
      (soldiers / Math.max(1, adults) < CFG.soldierFraction || this.alarmLevel() > 0.5);
    var caste = wantSoldier ? Ant.SOLDIER : Ant.WORKER;
    var a = new Ant(this, b.x, b.y, caste, false);
    a.food = 0.7;
    this.ants.push(a);
    this.stats.hatched++;
  };

  Colony.prototype.broodPressure = function () {
    if (!this.brood.length) return 0;
    var untended = 0;
    for (var i = 0; i < this.brood.length; i++) if (this.brood[i].tended <= 0) untended++;
    var nurses = this.countTask('TEND');
    return U.clamp(untended / this.brood.length * 1.2 - nurses * 0.18, 0, 1.2);
  };
  Colony.prototype.broodNeedingCare = function (ant) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.brood.length; i++) {
      var b = this.brood[i];
      if (b.dead || b.heldBy || b.tended > 0.4) continue;
      var d = U.dist2(ant.x, ant.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };
  /* Which chamber this item of brood belongs in.  Ants sort brood by stage -
   * eggs and young larvae in the deepest, dampest nursery, pupae nearer the
   * surface where it is warmer and drier - and take the whole pile deeper the
   * moment the nest is disturbed, which is what you see when an ant hill is
   * kicked over: every worker running with a grub in its jaws. */
  Colony.prototype.roomForBrood = function (b) {
    if (!b) return null;
    var rooms = this.usableNurseries();          // deepest first
    if (!rooms.length) return null;
    var want;
    if (this.alarmLevel() > 0.4) want = rooms[0];
    else if (b.stage === 'pupa') want = rooms[rooms.length - 1];
    else if (b.stage === 'larva') want = rooms[Math.min(1, rooms.length - 1)];
    else want = rooms[0];
    if (want.id === b.room || this.broodIn(want) < this.nurseryHolds(want)) return want;
    return this.roomForEggs(b.room) || want;
  };

  /* How keen the nurses are to be carrying something.  Never zero for long:
   * brood that is where it should be still gets picked up and the pile closed
   * back up, and an alarm empties the nurseries. */
  Colony.prototype.broodMovePressure = function () {
    if (!this.broodToRelocate(null)) return 0;
    return CFG.broodMoveEagerness * (1 + CFG.broodAlarmUrgency * this.alarmLevel());
  };

  /* The item most worth carrying somewhere, nearest first for a given ant.
   * Priority: brood loose in a gallery, then brood in the wrong chamber for its
   * stage, then simply tidying the pile. */
  Colony.prototype.broodToRelocate = function (ant) {
    var g = this.grid;
    if (!this.usableNurseries().length) return null;
    var best = null, bestScore = 0, bestD = 0;
    for (var i = 0; i < this.brood.length; i++) {
      var b = this.brood[i];
      if (b.dead || b.heldBy) continue;
      var here = g.room[Math.floor(b.y / g.cell) * g.cols + Math.floor(b.x / g.cell)];
      var score;
      if (here !== b.room) {
        score = 3;                                  // out in the open: fetch it in
      } else {
        if (b.moveCd > 0) continue;                 // just been moved; leave it be
        var want = this.roomForBrood(b);
        score = want && want.id !== b.room ? 2 : 0.7;
      }
      var d = ant ? U.dist2(ant.x, ant.y, b.x, b.y) : 0;
      if (score > bestScore || (score === bestScore && ant && d < bestD)) {
        bestScore = score; bestD = d; best = b;
      }
    }
    return best;
  };
  Colony.prototype.pickUpBrood = function (ant, b) {
    b.heldBy = ant;
    ant.carrying = { kind: 'egg', brood: b };
  };
  Colony.prototype.dropBrood = function (ant, room) {
    if (!ant.carrying || ant.carrying.kind !== 'egg') return;
    var b = ant.carrying.brood;
    b.heldBy = null;
    var spot = room ? this.broodSpot(room) : null;
    if (spot) {
      b.x = spot.x; b.y = spot.y;
      b.room = room.id;
      // settled where it belongs: leave it there for a while
      b.moveCd = CFG.broodMoveCooldown * this.rng.range(0.7, 1.5);
    } else {
      /* Dropped in the gallery - the carrier died, or the chamber it was bound
       * for filled in.  It is not left there: it counts as loose brood and the
       * next nurse past will carry it back in. */
      b.x = ant.x; b.y = ant.y + ant.height * 0.5;
      b.moveCd = 0;
    }
    ant.carrying = null;
  };

  // -------------------------------------------------------------- items
  Colony.prototype.updateItems = function (dt) {
    var g = this.grid;
    this.foodTimer -= dt;
    if (this.foodTimer <= 0) {
      this.foodTimer = CFG.foodSpawnInterval * this.rng.range(0.6, 1.6);
      this.spawnItem('food');                  // the occasional windfall
    }
    for (var i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      if (it.dead) { this.items.splice(i, 1); continue; }
      it.spin += dt * it.spinRate;
      if (!it.resting) {
        it.vy = Math.min(CFG.itemFallSpeed, it.vy + 120 * dt);
        it.x += Math.sin(it.spin) * 6 * dt;
        it.y += it.vy * dt;
        var cy = Math.floor(it.y / g.cell), cx = Math.floor(it.x / g.cell);
        if (g.solid(cx, cy) || cy >= g.rows) {
          it.y = Math.max(0, cy) * g.cell - 1;
          it.resting = true;
          it.vy = 0;
          this.scentFood(it);
        }
      } else {
        /* A settled scrap keeps smelling of itself, so a find the ants have not
         * got to yet does not quietly stop existing as far as their noses are
         * concerned while the trail evaporates around it - and it slowly dries
         * out, so a surplus the colony cannot use clears instead of littering. */
        it.puff -= dt;
        if (it.puff <= 0) { it.puff = 1.5; this.scentFood(it); }
        it.life -= dt;
        if (it.life <= 0) it.dead = true;
      }
      if (it.claims) {
        for (var k = it.claims.length - 1; k >= 0; k--) {
          if (--it.claims[k].t <= 0) it.claims.splice(k, 1);
        }
      }
    }
  };

  Colony.prototype.spawnItem = function (kind, x, y) {
    var g = this.grid;
    this.items.push({
      kind: kind,
      x: x == null ? this.rng.range(g.cell * 2, (g.cols - 2) * g.cell) : x,
      y: y == null ? -4 : y,
      vy: 0, resting: false, dead: false, heldBy: null, claims: null,
      amount: 1,
      life: CFG.foodLifetime * this.rng.range(0.8, 1.2),
      puff: this.rng.range(0, 1.5),
      spin: this.rng.range(0, 6.28), spinRate: this.rng.range(-2, 2),
      shape: this.rng.int(3)
    });
  };

  /* A scrap of food smells, and the smell is what the ants actually detect - it
   * is laid into the food channel so a find advertises itself for a few cells
   * around, fading with distance.  This is the only thing that tells an ant
   * unprompted that there is food about; everything after it is real trail
   * laid by real ants walking back and forth. */
  Colony.prototype.scentFood = function (it) {
    var c = this.itemCell(it), r = CFG.foodOdourRadius;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        this.phero.drop(1, c.x + dx, c.y + dy, CFG.foodOdour * (1 - d / (r + 1)));
      }
    }
  };

  /* Scatter a handful of scraps where the user clicked.  Dropped a little above
   * the point so they flutter down and land properly rather than appearing
   * already settled, and spread out so it reads as crumbs rather than one
   * flake - a click should visibly be worth going to fetch. */
  Colony.prototype.dropFood = function (px, py, n) {
    var g = this.grid;
    n = n || CFG.clickFlakes;
    var maxX = (g.cols - 2) * g.cell;
    for (var i = 0; i < n; i++) {
      var x = U.clamp(px + this.rng.range(-CFG.clickSpread, CFG.clickSpread), g.cell * 2, maxX);
      this.spawnItem('food', x, Math.max(-4, py - this.rng.range(6, 22)));
    }
    this.stats.clicks++;
  };

  Colony.prototype.itemCell = function (it) {
    var g = this.grid;
    var cx = U.clamp(Math.floor(it.x / g.cell), 0, g.cols - 1);
    var cy = U.clamp(Math.floor(it.y / g.cell), 0, g.rows - 1);
    if (g.solid(cx, cy)) cy = Math.max(0, cy - 1);
    return { x: cx, y: cy };
  };

  /* How many ants a settled item can still serve. */
  Colony.prototype.itemSips = function (it) {
    return Math.max(1, Math.round(it.amount / CFG.foodEnergy));
  };
  Colony.prototype.itemHasClaim = function (it, ant) {
    if (!it.claims) return false;
    for (var i = 0; i < it.claims.length; i++) if (it.claims[i].id === ant.id) return true;
    return false;
  };
  Colony.prototype.claimItem = function (ant, kind) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead || it.kind !== kind || !it.resting) continue;
      // room for as many drinkers as there are mouthfuls left in it
      if (!this.itemHasClaim(it, ant) &&
          it.claims && it.claims.length >= this.itemSips(it)) continue;
      var d = U.dist2(ant.x, ant.y, it.x, it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (best && !this.itemHasClaim(best, ant)) {
      best.claims = best.claims || [];
      best.claims.push({ id: ant.id, t: 900 });
    }
    return best;
  };
  Colony.prototype.unclaimItem = function (it, ant) {
    if (!it || !it.claims) return;
    if (!ant) { it.claims = null; return; }
    for (var i = 0; i < it.claims.length; i++) {
      if (it.claims[i].id === ant.id) { it.claims.splice(i, 1); return; }
    }
  };
  /* Take a mouthful.  The item only disappears once it is drained, so a puddle
   * serves several ants and a flake can be nibbled as well as carried off. */
  Colony.prototype.sipItem = function (it, amount) {
    it.amount -= amount;
    if (it.amount <= 1e-3) it.dead = true;
    return amount;
  };
  /* The nearest settled flake an ant could reach without going out of its way,
   * claimed by someone else or not - an ant that walks over food eats it,
   * whatever it was in the middle of. */
  Colony.prototype.itemWithin = function (ant, kind, r) {
    var r2 = r * r, best = null, bestD = r2;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead || !it.resting || it.kind !== kind) continue;
      var d = U.dist2(ant.x, ant.y, it.x, it.y);
      if (d <= bestD) { bestD = d; best = it; }
    }
    return best;
  };
  /* The best-stocked nestmate within reach, or null.  `crop` names the field
   * being compared, so the beggar and the donor are ranked by the same measure. */
  Colony.prototype.donorNear = function (ant, crop, r, margin) {
    var r2 = r * r, best = null, bestHave = ant[crop] + margin;
    for (var i = 0; i < this.ants.length; i++) {
      var o = this.ants[i];
      if (o === ant || !o.alive || o.sleeping) continue;
      if (o[crop] <= bestHave) continue;
      if (U.dist2(ant.x, ant.y, o.x, o.y) > r2) continue;
      bestHave = o[crop]; best = o;
    }
    return best;
  };
  Colony.prototype.consumeItem = function (it) { it.dead = true; };
  Colony.prototype.pickUpItem = function (ant, it, asKind) {
    it.dead = true;
    ant.carrying = { kind: asKind || it.kind, amount: it.amount };
  };

  // ------------------------------------------------------------- corpses
  Colony.prototype.corpsePressure = function () {
    for (var i = 0; i < this.corpses.length; i++) {
      if (!this.corpses[i].heldBy && !this.corpses[i].removed) return 0.6;
    }
    return 0;
  };
  Colony.prototype.corpseToClear = function (ant) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.corpses.length; i++) {
      var c = this.corpses[i];
      if (c.heldBy || c.removed) continue;
      var d = U.dist2(ant.x, ant.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  Colony.prototype.pickUpCorpse = function (ant, body) {
    body.heldBy = ant;
    ant.carrying = { kind: 'corpse', body: body };
  };
  Colony.prototype.dropCorpse = function (ant) {
    if (!ant.carrying || ant.carrying.kind !== 'corpse') return;
    var body = ant.carrying.body;
    body.heldBy = null;
    body.removed = true;
    var k = this.corpses.indexOf(body);
    if (k >= 0) this.corpses.splice(k, 1);
    this.middenPile.push({ x: ant.x, y: ant.y, r: this.rng.range(1.2, 2.4), a: this.rng.range(0, 6.28) });
    if (this.middenPile.length > 220) this.middenPile.shift();
    ant.carrying = null;
  };
  /* Refuse goes to a midden well away from the nest mouth. */
  Colony.prototype.middenSpot = function (ant) {
    var g = this.grid;
    var side = this.entrance.x < g.cols / 2 ? 1 : -1;
    for (var t = 0; t < 24; t++) {
      var x = Math.round(U.clamp(this.entrance.x + side * this.rng.range(16, 34), 2, g.cols - 3));
      var top = g.topSolid(x);
      var y = top - 1;
      if (y < 3) continue;
      if (g.walkable(x, y)) return { x: x, y: y };
    }
    return null;
  };

  // ------------------------------------------------------------ intruders
  Colony.prototype.updateIntruders = function (dt) {
    var g = this.grid;
    this.intruderTimer -= dt;
    if (this.intruderTimer <= 0 && this.ants.length > 6) {
      this.intruderTimer = CFG.intruderInterval * this.rng.range(0.7, 1.5);
      this.spawnIntruder();
    }
    for (var i = this.intruders.length - 1; i >= 0; i--) {
      var f = this.intruders[i];
      if (!f.alive) { this.intruders.splice(i, 1); continue; }
      f.life -= dt;
      f.phase += dt * 7;
      if (f.life <= 0) { f.alive = false; continue; }
      // trundle towards the nest entrance along the surface
      var tx = (this.entrance.x + 0.5) * g.cell;
      var dir = tx > f.x ? 1 : -1;
      if (Math.abs(tx - f.x) > g.cell * 2) f.x += dir * f.speed * dt;
      f.angle = dir > 0 ? 0 : Math.PI;
      var cx = U.clamp(Math.floor(f.x / g.cell), 0, g.cols - 1);
      var top = g.topSolid(cx);
      f.y = U.lerp(f.y, top * g.cell - f.h * 0.5, Math.min(1, dt * 8));
      this.phero.drop(2, cx, U.clamp(top - 1, 0, g.rows - 1), 2.5 * dt);
      // bite back
      for (var k = 0; k < this.ants.length; k++) {
        var a = this.ants[k];
        if (!a.alive) continue;
        if (U.dist2(a.x, a.y, f.x, f.y) < Math.pow(f.h * 0.8, 2)) {
          a.injury = (a.injury || 0) + dt * 0.35;
          if (a.injury > 1) this.killAnt(a, 'killed');
        }
      }
    }
  };

  Colony.prototype.spawnIntruder = function () {
    var g = this.grid;
    var fromLeft = this.rng.chance(0.5);
    var x = fromLeft ? g.cell * 2 : (g.cols - 2) * g.cell;
    var cx = Math.floor(x / g.cell);
    this.intruders.push({
      kind: this.rng.chance(0.5) ? 'beetle' : 'rival',
      x: x, y: (g.topSolid(cx) - 2) * g.cell,
      h: this.rng.range(9, 13), alive: true, hp: 1.6,
      speed: this.rng.range(9, 15), life: 70, angle: 0, phase: 0
    });
  };

  Colony.prototype.killIntruder = function (f) { f.alive = false; };
  Colony.prototype.nearestIntruder = function (ant) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.intruders.length; i++) {
      var f = this.intruders[i];
      if (!f.alive) continue;
      var d = U.dist2(ant.x, ant.y, f.x, f.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  };
  Colony.prototype.alarmLevel = function () {
    var live = 0;
    for (var i = 0; i < this.intruders.length; i++) if (this.intruders[i].alive) live++;
    return U.clamp(live * 0.7 + this.phero.at(2, this.entrance.x, this.entrance.y) * 0.1, 0, 1);
  };

  // ------------------------------------------------------------ locations
  Colony.prototype.randomWalkableIn = function (predicate, tries) {
    var g = this.grid;
    for (var t = 0; t < (tries || 60); t++) {
      var x = this.rng.int(g.cols), y = this.rng.int(g.rows);
      if (!g.walkable(x, y)) continue;
      if (predicate && !predicate(x, y)) continue;
      return { x: x, y: y };
    }
    return null;
  };
  Colony.prototype.restSpot = function (ant, deepOnly) {
    var g = this.grid;
    var minRow = g.surfaceRow + (deepOnly ? Math.ceil(g.sandDepth * 0.2) : 2);
    var spot = this.randomWalkableIn(function (x, y) {
      return y > minRow && g.isDug(x, y) && g.solid(x, y + 1);
    }, 90);
    if (spot) return spot;
    return this.randomWalkableIn(function (x, y) { return g.solid(x, y + 1); }, 40);
  };
  Colony.prototype.patrolSpot = function (ant) {
    var g = this.grid;
    var ex = this.entrance.x;
    for (var t = 0; t < 40; t++) {
      var x = Math.round(U.clamp(ex + this.rng.range(-10, 10), 1, g.cols - 2));
      var y = g.topSolid(x) - 1;
      if (g.walkable(x, y)) return { x: x, y: y };
    }
    return this.restSpot(ant);
  };
  Colony.prototype.wanderSpot = function (ant) {
    var g = this.grid;
    /* An idle queen shuffles about her nursery - she does not go sightseeing.
     * Letting her drift to the surface is fatal to the colony: the nurses
     * follow her to feed her and the whole nest stops working. */
    if (ant.caste === 'queen' && this.workers() > 0) {
      var nest = this.roomForEggs() || this.rooms[0];
      if (nest) {
        var nc = this.roomCells(nest);
        if (nc.length) return this.rng.pick(nc);
      }
      return this.restSpot(ant, true) || this.restSpot(ant);
    }
    var surface = ant.depthFraction() < 0.05 && this.rng.chance(0.6);
    if (surface) {
      for (var t = 0; t < 30; t++) {
        var x = Math.round(U.clamp(ant.cellX() + this.rng.range(-22, 22), 1, g.cols - 2));
        var y = g.topSolid(x) - 1;
        if (g.walkable(x, y)) return { x: x, y: y };
      }
    }
    var cx = ant.cellX(), cy = ant.cellY();
    for (var k = 0; k < 40; k++) {
      var nx = Math.round(cx + this.rng.range(-14, 14)), ny = Math.round(cy + this.rng.range(-10, 10));
      if (g.walkable(nx, ny) && (g.isDug(nx, ny) || ny <= g.surfaceRow)) return { x: nx, y: ny };
    }
    return this.restSpot(ant);
  };

  root.Colony = Colony;
})(typeof window !== 'undefined' ? window : global);
