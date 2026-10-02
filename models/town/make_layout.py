# The first town: written as code so it can be read and changed; makes models/town/layout.json.
# rot: the way a thing's front faces, degrees (0 = +z, toward the lake; 90 = +x, east; 180 = north; 270 = west).
# Sited on the valley floor at about (-15, -200): flat (3 deg), dry, a creek at x ~42 running down to the lake (~100 m south).
import json, math
items, roads = [], []
def put(type_, kind, x, z, rot=0, size=None, **kw):
    it = {'type': type_, 'kind': kind, 'x': round(x, 1), 'z': round(z, 1), 'rot': rot % 360}
    if size is not None: it['size'] = size
    it.update(kw); items.append(it)
M = lambda kind, x, z, rot=0, size=None, **kw: put('model', kind, x, z, rot, size, **kw)
P = lambda kind, x, z, rot=0, size=None: put('prop', kind, x, z, rot, size)
T = lambda kind, x, z, size=0.55, rot=0: put('tree', kind, x, z, rot, size)
def road(mat, w, *pts): roads.append({'mat': mat, 'w': w, 'pts': [list(p) for p in pts]})
def facing(x, z, tx, tz): return round(math.degrees(math.atan2(tx - x, tz - z)))   # rot that faces (tx, tz)

PX, PZ = -15, -200                                           # the plaza's middle
# ── roads first (buildings sit on them) ──
road('flagstones', 34, (PX, PZ))                             # the plaza: a 34 m round of flagstones
road('cobbles', 6, (PX + 15, PZ), (20, -201), (43, -201), (62, -203), (90, -205), (125, -207))   # main street east, over the creek
road('cobbles', 6, (PX - 15, PZ), (-45, -201), (-75, -204), (-90, -205))                          # main street west, to the hangar
road('flagstones', 20, (-92, -205), (-80, -205))             # the hangar's apron
road('cobbles', 5, (PX - 8, PZ - 15), (-32, -238), (-34, -262), (-22, -282))                      # up the hill to the observatory
road('cobbles', 5, (PX, PZ + 16), (PX - 2, -160), (-8, -140), (-14, -126))                         # down to the lake and the hot tub house
road('cobbles', 3, (-8, -165), (-28, -160))                 # into the park and the workshop
# ── the plaza ──
M('fountain', PX, PZ, 0, 5)
M('townHall', PX, PZ - 32, 0)                                # at the head of the plaza, steps toward it
M('tavern', 12, -196, 270)                                   # east side, terrace onto the plaza
M('brewery', 13, -221, 270)
P('stall', -31, -186, 45); P('stall', -33, -197, 90); P('stall', -31, -208, 135)   # a little market, west side
P('signpost', 3, -208, 270)
for k in range(8):                                            # lamps round the plaza's edge
    a = k / 8 * 2 * math.pi + 0.2; P('lamp', PX + math.sin(a) * 18.5, PZ + math.cos(a) * 18.5, 0)
for a in (40, 140, 220, 320):                                  # benches facing the fountain
    r = math.radians(a); x, z = PX + math.sin(r) * 7.5, PZ + math.cos(r) * 7.5; P('bench', x, z, facing(x, z, PX, PZ))
P('planter', -24, -217, 0); P('planter', -6, -217, 0)        # either side of the town hall steps
P('planter', 4, -189, 270); P('planter', 4, -204, 270)       # in front of the tavern
# ── the park, south of the plaza ──
P('flowerBed', -6, -168, 0)
for a in (0, 90, 180, 270):
    r = math.radians(a); x, z = -6 + math.sin(r) * 5, -168 + math.cos(r) * 5; P('bench', x, z, facing(x, z, -6, -168))
P('easel', -20, -170, 160); P('easel', -23, -166, 175); P('easel', -18, -163, 190)   # painters, looking up at the town hall
P('picnicTable', 8, -160, 20); P('picnicTable', 14, -170, 70)
M('workshop', -36, -157, 90)                                 # open end toward the park and the easels
M('playground', -40, -180, facing(-40, -180, PX, PZ))
M('school', -60, -182, 180)                                  # facing north onto the main street
# ── east bank: the bridge, homes along the street ──
M('bridge', 43, -201, 90, level=False)                       # spans east-west over the creek
M('Lcottage', 64, -216, 0); M('Tcottage', 87, -217, 0); M('solarpunkCottage', 110, -219, 0)
M('solarpunkHouse', 69, -189, 180); M('Lcottage', 93, -190, 180, 10); M('Tcottage', 116, -192, 180)
for x in (64, 87, 110): P('planter', x - 4, -209, 0)
# ── the edges ──
M('hanger', -104, -205, 90)                                  # its mouth onto the apron
M('observatory', -15, -292, 0)                               # up on the rising ground, facing back over the town
M('hottubHouse', -26, -122, 90)                              # by the lake: door east to the lane, the tub toward the water
P('bench', -20, -112, 0); P('bench', -10, -114, 0)           # lakeside benches
# ── trees along the main street (alternating sides), round the plaza and the park ──
for x in range(-82, 126, 16):
    if -40 < x < 10 or 34 < x < 52: continue                  # not in the plaza, not on the bridge
    side = 1 if (x // 16) % 2 else -1
    T('oak' if (x // 16) % 3 else 'ash', x, -203 + side * 10, 0.5 + (x % 7) * 0.02)
for a in (20, 110, 250, 340):
    r = math.radians(a); T('aspen', PX + math.sin(r) * 23, PZ + math.cos(r) * 23, 0.45)
for x, z in ((-14, -152), (4, -150), (-26, -176), (14, -178)): T('oak', x, z, 0.5)
for x, z in ((-40, -130), (-5, -110), (16, -120)): T('pine', x, z, 0.5)
for x in range(-70, 125, 25):                                   # street lamps, every 25 m on the north side
    if -40 < x < 10 or 34 < x < 52: continue
    P('lamp', x, -207.5, 0)
json.dump({'v': 1, 'items': items, 'roads': roads}, open('/home/bitwizard/jconra-site/models/town/layout.json', 'w'), indent=0)
print(len(items), 'things,', len(roads), 'roads')
