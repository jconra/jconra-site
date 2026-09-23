/* Ant Farm screensaver - tunable constants.
 * All distances in pixels unless the name says "cells".
 */
(function (root) {
  'use strict';

  var CFG = {
    // ---- world -------------------------------------------------------
    cell: 4,                 // one grain of sand = 4x4 px
    sandFraction: 0.70,      // sand fills bottom 70% of the screen
    surfaceRelief: 4,        // +/- cells of gentle hills on the initial ground
    sandPalette: 26,         // distinct grain colours per depth band

    // ---- sand physics ------------------------------------------------
    physicsBudget: 900,      // active loose grains resolved per frame
    // Loose (ant-placed) grains obey gravity and the 45 degree angle of
    // repose. Packed grains (the original ground) are cohesive so tunnels
    // and chambers keep their shape.

    // ---- ants --------------------------------------------------------
    maxAnts: 68,
    antBirthLen: 15,         // 15 x 5 px at hatching
    antAdultLen: 30,         // grows to 30 x 10 px
    antHeightRatio: 1 / 3,   // height = len/3
    /* Birth size -> adult size.  A callow spends this long visibly filling out
     * and losing its pallor, and it is the only piece of an ant's life you can
     * watch happen, so it wants to be slow enough to notice and not so slow
     * that the nest is full of half-sized workers. */
    growSeconds: 70,
    speedYoung: 42,
    speedAdult: 58,
    queenSpeed: 46,
    soldierSpeedMul: 1.1,
    gravity: 260,
    reachMul: 0.42,          // leg reach as a fraction of body length
    strideMul: 0.30,         // stride length as a fraction of body length
    swingSeconds: 0.11,      // one leg's forward swing

    // ---- work --------------------------------------------------------
    digSeconds: 0.18,        // per grain
    /* Grains per trip.  An ant makes a pellet of several grains and the walk
     * to the hill dominates the work, so a bigger mouthful is both truer to
     * life and the difference between a nest that grows and one that starves. */
    loadCapacity: 12,
    tunnelRadius: 1.4,       // cells; a ~3 cell (12 px) bore.  Deliberately
                             // snug: an ant walks on surfaces, so every cell
                             // of a gallery has to be within reach of a wall
    minTunnelSteps: 12,
    maxTunnelSteps: 30,      // short plans finish; long ones just queue up
    wanderStrength: 0.30,    // tunnel centre-line meander (radians/step)

    /* ---- nest shape --------------------------------------------------
     * How many galleries may be open at once, and how freely they fork.  A
     * nest that is all corridor looks busy but reads as a scribble, so the
     * effort goes into chambers instead: few digs, few branches. */
    maxActiveDigs: 4,        // concurrent dig jobs, whatever the population
    digsPerWorkers: 6,       // one more concurrent dig per this many workers
    branchChance: 0.12,      // chance a gallery throws a real side branch
    workDepthMax: 0.82,      // deepest the nest ever works, as a fraction of
                             // the sand column - a colony cannot staff a
                             // gallery whose haul is the whole shaft
    workDepthPerWorker: 0.018,
    /* What actually limits a nest is the haul, and a haul is a distance, not a
     * depth: every grain is carried from the face, up the galleries and out
     * onto the hill.  So the depth budget is spent by sideways travel too - at
     * this many rows of depth per cell of offset from the entrance - and the
     * workable ground is a broad lens, deepest under the hill and shallow out
     * at the edges, instead of a floor sliced flat across the whole tank.
     * Below 1.0 because galleries run at a slope: one row of depth already
     * costs an ant two or three cells of walking. */
    workLateralCost: 0.40,
    workFloorWobble: 0.13,   // unevenness of the lens edge, as a fraction of
                             // the depth budget, so it is not a clean V
    workFloorMinRows: 6,     // the edges still get shallow galleries
    workCoreCells: 12,       // cells either side of the entrance that pay no
                             // walk at all, so the lens has a broad bottom
                             // rather than coming to a point under the hill

    /* Chamber footprints in cells (radii of the ellipse), all scaled live by
     * `roomScale`.  A chamber has to read as a room and not a wide stretch of
     * tunnel, so it is broad, and the store rooms are kept low because an ant
     * hollows a chamber standing on its floor and reaching up: a ceiling far
     * above the floor is slow to work and the last of it may never come out.
     *
     * The nursery is the exception, and it is worth the extra digging.  The
     * queen sits in it, and at 37 px long with a deep gaster she needs real
     * headroom or she reads as wedged into the ceiling.  Doubling its height
     * roughly doubles the rock to shift, so it is only affordable because a
     * chamber is usable at `chamberReadyFraction` and the founding cell is only
     * as long as `nurseryScales` makes it. */
    roomScale: 1.15,
    nurseryRx: 9.0, nurseryRy: 3.0,
    /* Nurseries are not all the same size.  A colony digs the nursery it can
     * afford: the founding queen scratches out a cell with room for a couple of
     * eggs, her first daughters cut a proper chamber deeper down, and a grown
     * nest excavates a cavern deeper still.  Each entry is a multiplier on the
     * nursery footprint, the depth (as a fraction of the sand column) it has to
     * sit at least that far down, and the number of workers the colony needs
     * before it takes that dig on - so the nest visibly graduates instead of
     * repeating one room. */
    nurseryScales: [0.34, 0.70, 1.15, 1.60],
    nurseryDepths: [0.24, 0.38, 0.54, 0.70],
    nurseryWorkers: [0, 4, 12, 26],
    granaryRx: 6.5, granaryRy: 1.4,
    chamberRx: 7.5, chamberRy: 1.4,
    /* How much of a chamber has to be hollowed out before the colony will use
     * it.  Without this the queen lays in the first six grains' worth of
     * pocket, the chamber never gets finished, and the brood ends up sitting in
     * what is still effectively the tunnel. */
    chamberReadyFraction: 0.55,
    /* The founding queen digs her first chamber alone, so she gets a gentler
     * fraction of a deliberately small room - but a fraction all the same, so
     * she ends up in something shaped like a cell and not in a pocket at the
     * end of her shaft. */
    foundingReadyFraction: 0.30,
    foundingReadyCells: 6,   // ...but never fewer open grains than this, so the
                             // founding cell is a floor she can sit a clutch on
    minSlope: 0.22,          // keep tunnels angled, never flat...
    maxSlope: 0.55,          // ...and never steeper than an ant can walk
    shaftMinSlope: 0.45,     // a descending shaft drops at least this fast...
    shaftMaxSlope: 0.72,     // ...and at most ~46 degrees, so an ant carrying a
                             // load can still climb it without scrabbling
    clearance: 2,            // cells of rock kept between tunnels
    dumpKeepOut: 3,          // cells of clearance between spoil and a gallery
    /* Rows of packed ground left as a lid over every gallery and chamber.  The
     * nest mouth is the one dig allowed through the crust; anything else that
     * broke the surface opened the nest to the spoil heap sitting on top of it,
     * and the whole heap drained down the hole and silted up the chambers. */
    roofCells: 2,
    eggDepthFraction: 0.20,  // nursery must sit >=20% down the sand column

    /* ---- metabolism (units per second) -------------------------------
     * A full crop has to outlast a round trip from the deep nest to the
     * surface and back with a queue at the nest mouth, or the colony spends
     * its whole life commuting and starves anyway.  Food is the colony's only
     * resource: there is nothing else to fetch, so hunger is the whole economy. */
    foodBurn: 0.0048,        // ~210 s from full to empty
    energyBurn: 0.0060,
    queenFoodBurn: 0.0038,
    claustralBurn: 0.12,     // a founding queen lives off her flight muscles
    hungerThreshold: 0.50,
    tiredThreshold: 0.18,

    /* ---- brood -------------------------------------------------------
     * An egg sits in the pile a long while.  That is what makes floor space in
     * the nursery the thing that limits a young colony: the queen can only lay
     * as many eggs as there is room to keep, so until her daughters have dug a
     * bigger chamber she is waiting on the clutch she has, not on food. */
    eggSeconds: 58,
    larvaSeconds: 42,
    pupaSeconds: 32,
    /* One knob over all three stages, so the whole egg-to-callow arc can be
     * stretched without changing the shape of it - the relative length of the
     * stages is what makes brood sorting by stage worth watching. */
    broodTimeScale: 1,
    layInterval: 11,
    /* What a nursery holds is its floor, not a fixed number: the founding cell
     * has room for a couple of eggs and a mature chamber for a heap of them.
     * `eggsPerNursery` is the ceiling for one room however big it is dug. */
    broodPerFloorCell: 0.55,
    eggsPerNursery: 14,
    broodTendBonus: 1.8,     // tended brood develops this much faster
    /* Ants shift brood about constantly - sorting it by stage between chambers,
     * closing the pile back up, and hauling the lot deeper the moment the nest
     * is disturbed.  These control how keen the nurses are to pick a grub up
     * and how long an item is left alone after it has just been moved. */
    broodMoveEagerness: 1.4,
    broodMoveCooldown: 18,   // seconds before the same item is moved again
    broodAlarmUrgency: 2.5,  // extra keenness to carry brood while alarmed

    /* ---- food ---------------------------------------------------------
     * Food is scarce on purpose, and you are the source of it: click the tank
     * to scatter a few scraps and the colony comes alive fetching them.  A
     * windfall still blows in now and then so an unattended screensaver keeps
     * ticking over, but it is rare enough that a colony left alone dozes at a
     * low population instead of booming. */
    foodSpawnInterval: 210,  // seconds between chance windfalls
    itemFallSpeed: 26,
    sipRange: 7,             // px within which an ant helps itself in passing
    foodEnergy: 0.55,
    /* Uncollected scraps wither, so over-feeding does not carpet the surface
     * forever - a scrap gives off scent and draws foragers while it is fresh,
     * then dries out and is gone.  Long enough that food a busy colony means to
     * fetch is not lost out from under it. */
    foodLifetime: 90,
    clickFlakes: 5,          // scraps per click...
    clickSpread: 22,         // ...scattered over this many px
    /* How much a granary holds, per cell of its floor.  A fixed number used to
     * cap every granary at a dozen flakes however big it was dug, and once it
     * was full every forager ate its load where it stood - the surface stayed
     * carpeted while the nest went hungry.  Storage now grows with the room. */
    granaryPerFloorCell: 2,

    /* ---- recruitment --------------------------------------------------
     * A scrap of food smells, and the smell is what starts the stampede.  A
     * landing scrap lays a puff of food scent around itself; an ant that finds
     * it marks the spot hard and trails scent home with the load, so the route
     * gets stronger every trip and nestmates that cross it are pulled into
     * foraging.  That feedback loop - not a global "food exists" flag - is what
     * makes a single click ripple out through the whole nest. */
    foodOdour: 2.2,          // scent a landed scrap gives off
    foodOdourRadius: 5,      // cells the smell carries
    foodFindMark: 4.5,       // scent an ant lays on a scrap it has found
    recruitStrength: 2.4,    // how strongly food scent underfoot says "forage"
    recruitReach: 2,         // cells of scent an ant samples around itself

    /* ---- famine -------------------------------------------------------
     * With the larder empty the colony does not simply die: it throttles down.
     * Ants slow their pace and their metabolism to stretch what is left, the
     * brood develops slowly for want of feeding, and the queen stops laying
     * altogether rather than filling a nursery she cannot provision.  Two
     * thresholds, so she does not stutter on and off at the boundary. */
    storePerAnt: 0.8,        // scraps in the granary a well-fed colony wants each
    torporBurn: 0.35,        // metabolic rate at full famine
    torporSpeed: 0.45,       // walking pace at full famine
    famineBroodSlow: 0.75,   // brood development lost at full famine
    famineLayStop: 0.55,     // she stops laying above this...
    famineLayResume: 0.35,   // ...and only starts again below this

    // ---- pheromones ---------------------------------------------------
    pheroDecay: 0.965,       // per second
    pheroDeposit: 0.85,
    pheroMax: 6,

    // ---- threats -------------------------------------------------------
    intruderInterval: 95,
    soldierFraction: 0.16,

    // ---- presentation --------------------------------------------------
    /* Brood and forage are drawn well over life size on purpose: an egg an ant
     * can actually be seen carrying is worth more here than a correct one. */
    eggSize: 5.4,            // egg semi-major axis in px
    broodScale: 1.25,        // larvae and pupae, relative to their base size
    foodSize: 5.2,           // leaf scrap half-length in px
    /* Simulated seconds per real second.  At 1 the colony runs in real time: the
     * founding queen digs and hauls alone for ~9 minutes before her first
     * daughters emerge, and the nest matures over roughly half an hour.  Turn it
     * down for a screensaver arc that unfolds over hours in the corner of a
     * screen - 0.25 stretches the same run to an afternoon.  Everything is
     * scaled by this one number, so the carefully balanced relative pacing
     * (haul vs. metabolism vs. brood) is untouched; only the wall-clock
     * stretches.  Drag "Speed" to taste. */
    timeScale: 1,
    maxDt: 1 / 20
  };

  CFG.antAdultHeight = CFG.antAdultLen * CFG.antHeightRatio;
  root.CFG = CFG;
})(typeof window !== 'undefined' ? window : global);
