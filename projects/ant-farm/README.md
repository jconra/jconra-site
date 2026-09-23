# Ant Farm

A canvas screensaver of an ant colony digging a nest in a tank of sand. It
starts with one queen standing on the surface and ends, half an hour or so later,
with a branching gallery, chambers full of brood and food, a spoil hill at the
nest mouth, and a couple of dozen workers keeping the whole thing running. It
runs in real time by default; turn *Speed* down and the same arc unfolds over
hours in the corner of a screen.

## Running it

Open [index.html](index.html) in any modern browser — straight off the disk is
fine, there is no build step and no server:

    xdg-open index.html      # or: open index.html, or drag it onto a browser

Everything is a classic `<script>`, deliberately unbundled, so `file://` works.
The canvas sizes itself to the window and the whole world is rebuilt (with a new
seed) if you resize it.

### Keys

| Input     | Effect                                              |
|-----------|-----------------------------------------------------|
| **click / drag** | **drop food where you click** — the colony's only resource, and yours to provide. The tank draws its own cursor: a ring of scraps marking where the food will land |
| `space`   | pause / resume                                      |
| `.`       | advance a single simulation step while paused        |
| `h`       | statistics panel                                    |
| `p`       | pheromone overlay (home / food / alarm trails)       |
| `r`       | restart with the next seed                           |
| `+` / `-` | faster / slower (0.125× … 8×)                        |
| `1`       | back to normal speed                                 |

### Settings panel

A collapsible panel folds down from the top-right corner
([js/settings.js](js/settings.js)). Its sliders write straight into the live
config, so most take effect on the next simulated step — drag *chamber size* and
the next room the colony plans is bigger, drag *carry brood about* and the nurses
fuss over the brood more. The knobs are grouped into nest shape, chambers (size,
nursery headroom, how densely brood piles up), brood carrying, food (how much a
click drops, how strongly a find recruits, how hard a famine bites), on-screen
sizes of eggs and food, colony life (how fast brood develops and how long a
callow takes to fill out), and the world
(grain size and how much of the tank is sand — these two rebuild the world, so
they restart the colony). *Reset to defaults* puts everything back and restarts.

## What is being simulated

### Sand

The tank is a 2D grid of 4×4 px grains ([js/grid.js](js/grid.js)) held in
parallel typed arrays — one entry per grain, so the whole field can be swept
every frame. Sand fills the bottom 70% of the tank with a few cells of relief on
top. Each grain carries a `shade` index into a per-depth palette, re-rolled
whenever a grain is placed, so grain colour is a property of the *location*, not
of the grain being carried.

Two kinds of sand behave differently, and the difference is what makes a nest
possible at all:

- **packed** — the original ground. Cohesive: it does not fall, so a tunnel or a
  chamber holds its shape once it is dug.
- **loose** — anything an ant has placed. Obeys gravity and the 45° angle of
  repose, so a grain dropped on an unsupported spot slides until it is held on
  both shoulders.

Ants know the repose rule and only drop spoil where it will stay put, which is
what heaps the excavated sand into a cone around the nest mouth instead of a
column. Every grain an ant digs is carried out to that hill and tipped there —
there is no shortcut. The founding queen does it herself, climbing her own shaft
with each mouthful, which is why the hill starts to grow long before there is a
workforce and why founding is unhurried (she lays around t≈270s). Sand is
conserved exactly: a grain is only ever in the grid, in an ant's mandibles, or
on a corpse — never created, destroyed, or teleported.

Excavated cells keep a `dug` flag and a `room` id so diggers can route around
galleries that already exist, and a dig plan claims cells through `owner` so two
tunnels are never planned into each other. `CFG.clearance` keeps a couple of
cells of untouched ground between neighbouring galleries.

A nest also needs a **roof.** `CFG.roofCells` rows of *packed* ground are left
over every gallery and chamber, measured from `Grid.packedTop(x)` — the highest
cohesive grain in that column, which is the ground itself and ignores whatever
spoil has been heaped on top of it. The nest mouth is the one dig allowed to
break through, and a second entrance may only be sunk in a column that is not
buried under the hill. This is not decoration. Loose sand is not a roof: it is
what pours in through a hole, and a gallery that clipped the crust under the
spoil cone drained the whole heap down itself — a couple of hundred grains
silting the galleries and burying the nursery, with the queen sealed into a
four-cell pocket and every dig job stalled from then on. Nothing in the
simulation digs silt back out, so the fix is to never open the hole:
`Colony.roofRow` clamps the top of every dig plan, per column, and `planRoom`
refuses a chamber that would breach.

### Ants

An ant ([js/ant.js](js/ant.js)) is three things stacked up:

1. **Locomotion.** An ant walks the route the pathfinder gives it, and the
   pathfinder only ever routes through open cells — so a gallery wide enough to
   be walkable is one the ant can always get through, however steep. Movement is
   deliberately reliable rather than a physics simulation: the route decides
   whether a step happens, never the legs. Genuine free-fall is kept only for
   the one case that really is a fall — an ant with nothing underfoot and no
   route to walk, such as the queen dropping onto fresh sand.
2. **Legs.** An alternating tripod gait where each foot is anchored in *world*
   space: a planted foot does not move while the body walks past it, and when a
   leg's turn comes it swings forward, raycasts for a foothold on the sand and
   reaches for it. The legs and the body's lean are cosmetic — they follow the
   walk, they never fight it, so ants no longer scrabble on the spot in a shaft.
   Six legs, three rows, each taking its turn.
3. **A brain.** Every candidate action is scored from personal state (hunger,
   fatigue) and colony state (spoil to shift, brood to tend, chambers wanted,
   food to store, food scent underfoot recruiting foragers, an intruder in the
   tunnels). The highest score plus a little noise wins, so a colony of
   identical ants still spreads itself across the jobs that matter. The chosen
   task then runs as a small state machine: `DIG`, `HAUL`, `FORAGE`,
   `STORE_FOOD`, `EAT`, `FEED_QUEEN`, `LAY`, `TEND`, `MOVE_BROOD`,
   `DUMP_CORPSE`, `SLEEP`, `GROOM`, `GUARD`, `ATTACK`, `HIDE`, `WANDER`.

Castes are queen, worker and soldier. A hatchling is 15×5 px and grows to 30×10
over about 70 seconds; callows are pale for their first minutes. The queen is
larger, with the deep gaster the eggs come out of, and wing scars she tore off
after her mating flight.

### The colony

[js/colony.js](js/colony.js) owns the nest rather than the individuals: it plans
tunnels (meandering, always angled between `minSlope` and `maxSlope` so they
stay walkable and never read as ruled lines), decides where chambers go, and
tracks rooms by kind — `nursery`, `granary`, `midden` and plain `chamber`.

Nurseries are dug to a **ladder of sizes**, not all the same, because a colony
digs the nursery it can afford. The founding queen, working alone, scratches out
a cell barely big enough for a couple of eggs a fifth of the way down. Once she
has four daughters they cut a proper chamber, twice the length and deeper; at a
dozen workers a bigger one deeper still; and a grown nest of two dozen-odd
excavates a cavern near the bottom of its range. Each rung is bigger *and*
strictly deeper than the last, so the nest visibly graduates instead of repeating
one room, and it is the **workforce** that gates the next rung — not a shortage
of space. `nurseryScales`, `nurseryDepths` and `nurseryWorkers` are the three
parallel lists that spell this out.

Nurseries are dug tall, unlike the store rooms: the queen has to lie in one, and
at 37 px long with a deep gaster she needs real headroom or she reads as wedged
into the ceiling. Height is fixed at the queen's size on every rung — a later
nursery grows lengthways, not upwards — so even the founding cell is a room she
fits in.

What a nursery **holds** follows from how much of it has actually been hollowed
out: brood per cell of its widest open row, capped by `eggsPerNursery`. So the
founding cell takes about four items and a mature cavern a heap of them. Coupled
with a deliberately slow egg (58 s, on top of larva and pupa), that makes
**nursery floor space the thing that limits a young colony**: the queen is
waiting on the clutch she has room to keep, not on food, until her daughters have
dug her something bigger. Workers carry eggs, larvae and pupae to newly finished
nurseries as the nest deepens, sorting them by stage as they go.

### Food, and feeding the colony

Food (green flakes) is the colony's one resource, and it is deliberately
scarce: **you are the source of it.** Click the tank to scatter a handful of
scraps, or hold and drag to lay a trail of them; a rare windfall still blows in
on its own so an unattended screensaver keeps ticking over, but not enough to
grow on. Because the tank hides the system cursor — it is a screensaver — the
renderer draws its own marker where the mouse is: a faint ring of scraps showing
where a click would land. It ages in *real* seconds, not simulated ones, so it
fades a couple of seconds after the mouse stops even if the tank is slowed right
down or paused. (Prefer a real pointer? Swap `cursor: none` in
[css/style.css](css/style.css) for `crosshair`.) Scraps are eaten where they are found or hauled to a granary, and any
that no one collects wither and are gone, so over-feeding does not carpet the
surface.

How much a granary holds grows with the room — `granaryPerFloorCell` scraps per
cell of its floor — and a carrier on its way there reserves the space it is about
to fill. Both matter more than they sound: with a fixed cap and no reservation,
ten carriers converging on the same store overshot it, every granary was full for
good, and from then on every forager ate its load where it stood. The surface
stayed carpeted while the nest went hungry, which looked exactly like ants that
could not be bothered to carry food underground. The colony also digs its first
granary before it starts on the second nursery, so there is somewhere to put a
windfall before the big digs soak up the workforce.

A scrap **smells**, and the smell is what starts the stampede. A landing scrap
lays a puff of food scent around itself; the first ant to reach it marks the
spot hard and trails scent home with its load, so the route strengthens with
every trip and nestmates that cross it are pulled into foraging. That feedback
loop — not a global "there is food" flag — is what makes one click ripple out
into a column of foragers. Pheromones ([js/pheromone.js](js/pheromone.js)) hold
three decaying fields — home, food and alarm — laid and followed by the ants and
visible with `p`.

When the larder runs dry the colony does not simply die: it goes into **torpor.**
Ants slow their pace and their metabolism to stretch what little is left, brood
all but stops developing, and the queen stops laying rather than fill a nursery
she cannot provision — all of it easing off again the moment food is plentiful,
so feeding a hungry nest visibly brings it back to life. The one exception is
the founding queen: she raises her first brood on her own flight muscles, not
the larder, so a new colony always establishes itself before the food economy
takes over. Left alone, a colony dwindles to a dozing queen and a worker or two
and waits; fed, it booms.

Corpses go to a midden. Beetles and rival ants turn up occasionally; soldiers
answer the alarm and workers hide.

### Drawing

[js/render.js](js/render.js) keeps the sand on an offscreen canvas and repaints
only the cells the simulation marked dirty, so the terrain costs almost nothing
per frame. Depth-banded palettes give the sand its gradient; each grain gets a
lit top edge and a dark bottom edge for tooth. Untouched air is left
transparent so a cached sky gradient shows through, and excavated air is filled
with a void colour tinted by room type.

Ants are drawn in a body frame built from the surface normal rather than from
the heading, so an ant on a wall lies along it. Each leg is two-bone IK from hip
to planted foot, with a kinked tarsus and a bend direction biased by leg row, so
front knees splay forward and hind knees back. On top of that: gaster with
tergite seams and pilosity, petiole and postpetiole, a two-lobe mesosoma with a
pronotal ridge, neck, squared head capsule, clypeus, sickle mandibles, oval
compound eyes, and elbowed antennae.

## Layout

    index.html          the page; script tags in dependency order
    css/style.css       full-bleed canvas; the cursor is drawn, not the OS one
    js/config.js        every tunable constant, commented
    js/util.js          maths, seeded RNG, two-bone IK
    js/grid.js          the sand grid and its physics
    js/pheromone.js     three decaying scent fields
    js/ant.js           locomotion, legs, brain, task state machines
    js/colony.js        nest planning, rooms, brood, food, threats
    js/render.js        everything on screen
    js/main.js          canvas sizing, fixed-timestep driver, keys
    js/settings.js      the collapsible live-tuning panel

Load order matters: each file hangs one global off `window` and the next one
reads it. [index.html](index.html) lists them in the right order and so do the
tools.

The simulation never touches the renderer, which is why the tools below can run
it headlessly.

## Tools

All run under plain Node (no canvas library, no browser):

    node tools/simtest.js [minutes] [seed]     # soak the simulation, print a report
    node tools/rendertest.js [seconds] [seed]  # draw into a checking stub context
    node tools/snapshot.js [seconds] [seed] [outdir]
    node tools/masstest.js [minutes] [seed]    # check no grain of sand is lost

- **simtest** runs the colony at a fixed 60 Hz and reports, every 30 simulated
  seconds, the population, brood by stage, rooms, open dig jobs, grains moved,
  how far down the nest has reached, stored food, the famine level, deaths, and a
  histogram of what every ant is doing. Food is user-supplied now, so the test
  feeds the colony on a timer (standing in for a user clicking); pass a third
  argument of `0` (e.g. `node tools/simtest.js 10 12345 0`) to turn feeding off
  and soak the famine path instead, where the colony dwindles to a dozing queen
  rather than growing. The default run is 10 minutes: it fails a shorter fed run
  on purpose, because a colony that has not yet raised its first workers has not
  proved anything, and a queen who hauls every grain herself takes a while to
  get there.
- **rendertest** draws every frame into a stub 2D context that records nothing
  but checks everything: every numeric argument must be finite and every
  fill/stroke style must be parseable. A `NaN` in one leg's IK would otherwise
  silently blank a whole ant with nothing to see from Node. It feeds the colony
  (as everything must now) so there is a real nest to draw, stages the rare
  cases (both intruder kinds, a corpse, every load kind, a sleeper, a callow, a
  laying queen, the feeding cursor) and reports the per-frame geometry cost. It and **snapshot**
  default to 20 simulated minutes, because a slow egg and a founding cell that
  holds a couple of them mean a shorter run has little but a lone digger to draw.
- **snapshot** feeds and runs the colony, then replays the same draw calls into
  an SVG recorder, embeds the offscreen sand layer as a PNG it encodes itself,
  and writes a whole-tank frame plus 10× close-ups of the queen and a few
  workers, and a 4× close-up of every nursery framed on the chamber itself and
  named with what it holds. It rasterises them with ImageMagick if `convert` is
  on the path. This is how the anatomy was checked, and how the nursery ladder is
  checked for headroom — a chamber the queen has to lie in has to *look* like a
  room she fits in and not a wide bit of tunnel.
- **masstest** walks the whole grid every 30 s and checks that sand cells +
  grains in transit (in mandibles and on corpses) exactly equals the starting
  total — nothing created, nothing destroyed. Every dug grain is physically
  carried to the hill, so this is an exact invariant, not an approximate one.

`tools/probe-depth.js` reports, per column, how deep the nest has actually been
dug against the depth the colony can afford there — the nest works a lens,
deepest under the hill and shallow at the edges, because the depth budget is
spent by the sideways haul as well as by going down. `tools/probe-rooms.js`
reports how finished each chamber is and whether any brood is stranded in a
gallery. `tools/probe-feed.js` feeds the colony on a timer and traces
population, famine, stored food and foraging, so the food economy and the
recruitment loop can be checked headlessly. The other `tools/probe*.js`,
`tools/debug*.js` and `tools/dump.js` are
one-off scratch scripts kept from development; nothing depends on them.

## Tuning

Everything worth changing is in [js/config.js](js/config.js) with a comment
explaining why it is the value it is — grain size, sand fraction, dig and haul
rates, tunnel slopes and clearance, metabolism, brood timings, food scarcity and
recruitment, the famine response, pheromone decay, and `timeScale`. The
interesting ones:

| Constant            | Meaning                                            |
|---------------------|----------------------------------------------------|
| `cell`              | grain size in px (4)                               |
| `sandFraction`      | how much of the tank is sand (0.70)                |
| `loadCapacity`      | grains in one pellet — the whole dig economy        |
| `tunnelRadius`      | bore in cells; snug on purpose, ants need walls     |
| `minSlope`/`maxSlope` | keeps galleries angled and climbable              |
| `clearance`         | cells of ground kept between galleries              |
| `roofCells`         | rows of packed ground left over every gallery — the crust the spoil heap sits on |
| `eggDepthFraction`  | how far down a nursery has to be (0.20)             |
| `workDepthMax` / `workLateralCost` | deepest under the hill, and how fast the workable floor tapers to the sides |
| `roomScale`         | scales every chamber footprint at once              |
| `nurseryRy`         | how tall a nursery is dug — the queen has to fit in one |
| `nurseryScales` / `nurseryDepths` / `nurseryWorkers` | the nursery ladder: how big each successive nursery is, how far down it must sit, and how many workers the colony needs before it takes that dig on |
| `broodPerFloorCell` / `eggsPerNursery` | how densely brood piles up in a nursery, and the ceiling for one room however big it is dug |
| `eggSeconds` / `larvaSeconds` / `pupaSeconds` | the three brood stages; the slow egg is what makes nursery space the limit |
| `broodTimeScale`    | stretches all three stages together without changing their proportions |
| `growSeconds`       | how long a callow takes to fill out to an adult (70) |
| `granaryPerFloorCell` | scraps a granary holds per cell of its floor       |
| `chamberReadyFraction` | how dug-out a chamber must be before brood goes in |
| `maxActiveDigs` / `branchChance` | how many galleries are open at once, how freely they fork |
| `broodMoveEagerness` / `broodAlarmUrgency` | how much the nurses carry and sort brood, and how they empty the nurseries under attack |
| `clickFlakes`       | scraps dropped per click — how generous a feed is    |
| `foodSpawnInterval` | seconds between chance windfalls; high = you feed them yourself |
| `foodLifetime`      | how long an uncollected scrap lasts before it withers |
| `recruitStrength` / `foodOdour` | how strongly a food find pulls nestmates into foraging |
| `torporSpeed` / `torporBurn` | how far a starving colony slows its pace and metabolism |
| `famineLayStop` / `famineLayResume` | when the queen stops and restarts laying as food runs out and returns |
| `eggSize` / `broodScale` / `foodSize` | how large brood and forage are drawn |
| `timeScale`         | simulated seconds per real second (1 — turn it down for an hours-long arc) |

All of these are exposed on the in-page settings panel, so the easiest way to
find a value you like is to drag the slider and watch. Individual chamber radii
per room type (`nurseryRx`, `granaryRx`, …) and the depth the nest works to
(`workDepthMax`) are in `config.js` too; the plan/dig logic that reads them lives
in `colony.js` (`ensureWork`, `roomSize`, `extendDeeper`).
