#!/usr/bin/env python3
"""Road textures for the town: cobbles.jpg and flagstones.jpg (1024 px, tileable).

Pure Python + PIL, no numpy. Every stone is written at (x mod size, y mod size), and every blur, shift and
noise layer is made on wrapped copies, so both pictures repeat with no seam.

  python3 roads.py                  # both
  python3 roads.py cobbles          # just one (cobbles | flagstones)
  python3 roads.py --preview DIR    # also write DIR/<name>_tile.png (2x2) and DIR/<name>_seam.png (the corner, 1:1)

Scale: cobbles.jpg holds 10 rows of stones, flagstones.jpg about 30 slabs (5-6 across). For 15 cm cobbles
repeat cobbles.jpg every ~1.6 m; for 30-60 cm slabs repeat flagstones.jpg every ~2.5 m.
"""
import math, os, random, sys, time
from array import array
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

S = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
LIGHT = (-1.0, -1.0, 1.25)          # towards the sun: from the top-left, ~40 degrees up


# ── wrapped helpers ─────────────────────────────────────────────────────────────────────────────

def wrap_pad(im, pad):
    """The picture with a border of `pad` px copied from the opposite edges."""
    w, h = im.size
    out = Image.new(im.mode, (w + 2 * pad, h + 2 * pad))
    for dx in (-w, 0, w):
        for dy in (-h, 0, h):
            out.paste(im, (pad + dx, pad + dy))
    return out


def wrap_blur(im, radius):
    pad = min(im.width - 1, int(radius * 3) + 2)
    return wrap_pad(im, pad).filter(ImageFilter.GaussianBlur(radius)).crop((pad, pad, pad + im.width, pad + im.height))


def smooth_noise(rng, cells):
    """A random cells x cells grid blown up to S px (bicubic, wrapped): one octave of tileable value noise."""
    small = Image.frombytes('L', (cells, cells), rng.randbytes(cells * cells))
    k, pad = S // cells, 2
    up = wrap_pad(small, pad).resize(((cells + 2 * pad) * k,) * 2, Image.BICUBIC)
    return up.crop((pad * k, pad * k, pad * k + S, pad * k + S))


def fbm(rng, octaves, spread=40):
    """Tileable fractal noise as an 'L' image centred on 128 with standard deviation `spread`.
    octaves = [(cells, weight), ...]; cells must divide S."""
    acc, wsum = None, 0.0
    for cells, w in octaves:
        n = smooth_noise(rng, cells)
        wsum += w
        acc = n if acc is None else Image.blend(acc, n, w / wsum)
    st = ImageStat.Stat(acc)
    m, sd = st.mean[0], max(1e-3, st.stddev[0])
    return acc.point(lambda v: max(0, min(255, round(128 + (v - m) * spread / sd))))


def wrapped_spots(draw, x, y, r, fill):
    """An ellipse, drawn again across whichever edges it touches."""
    xs = [x] + ([x + S] if x < r else []) + ([x - S] if x > S - r else [])
    ys = [y] + ([y + S] if y < r else []) + ([y - S] if y > S - r else [])
    for X in xs:
        for Y in ys:
            draw.ellipse((X - r, Y - r, X + r, Y + r), fill=fill)


def flecks(rng, n, rmin, rmax, lo, hi):
    """Tiny light and dark dots on neutral 128: the grain of the stone."""
    im = Image.new('L', (S, S), 128)
    dr = ImageDraw.Draw(im)
    for _ in range(n):
        v = rng.randint(lo, hi) if rng.random() < 0.6 else rng.randint(255 - hi, 255 - lo)
        wrapped_spots(dr, rng.uniform(0, S), rng.uniform(0, S), rng.uniform(rmin, rmax), v)
    return wrap_blur(im, 0.45)


def smoothstep(a, b, x):
    t = (x - a) / (b - a)
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)


def gap_shade(mask, blur_r, shadow_px, deep, cast):
    """Ambient occlusion + a soft cast shadow for the ground between stones, as an 'L' image (255 = fully lit).
    Narrow joints (surrounded by stone) go darker; the stones throw a short shadow to the bottom-right."""
    near = wrap_blur(mask, blur_r)
    shadow = wrap_blur(ImageChops.offset(mask, shadow_px, shadow_px), max(1.0, shadow_px * 0.6))
    a, s = near.tobytes(), shadow.tobytes()
    out = bytes(max(0, min(255, int(255 * (1 - deep * a[i] / 255 - cast * s[i] / 255)))) for i in range(S * S))
    return out


def light_and_compose(H, M, SA, GA, AOG, amb=0.42):
    """Light the height field H from LIGHT and mix stone (SA, RGB bytes) over ground (GA, lit by AOG) by coverage M."""
    lx, ly, lz = LIGHT
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / ln, ly / ln, lz / ln
    dif = 1 - amb
    xm = [(x - 1) % S for x in range(S)]
    xp = [(x + 1) % S for x in range(S)]
    out = bytearray(3 * S * S)
    sqrt = math.sqrt
    for y in range(S):
        row, up, dn = y * S, ((y - 1) % S) * S, ((y + 1) % S) * S
        for x in range(S):
            i = row + x
            hx = (H[row + xp[x]] - H[row + xm[x]]) * 0.5
            hy = (H[dn + x] - H[up + x]) * 0.5
            sh = (lz - lx * hx - ly * hy) / (sqrt(1 + hx * hx + hy * hy) * lz)   # 1 on flat ground
            if sh < 0:
                sh = 0.0
            li = amb + dif * sh
            m = M[i]
            ks = li * m
            kg = li * (1 - m) * AOG[i] / 255
            j = 3 * i
            r = SA[j] * ks + GA[j] * kg
            g = SA[j + 1] * ks + GA[j + 1] * kg
            b = SA[j + 2] * ks + GA[j + 2] * kg
            out[j] = 255 if r > 255 else int(r)
            out[j + 1] = 255 if g > 255 else int(g)
            out[j + 2] = 255 if b > 255 else int(b)
    return Image.frombytes('RGB', (S, S), bytes(out))


def expose(im, target):
    """Scale so the mean brightness lands on `target` (the terrain shader multiplies its own light on top)."""
    m = ImageStat.Stat(im.convert('L')).mean[0]
    k = target / m
    return im.point(lambda v: max(0, min(255, round(v * k)))), m


# ── cobbles ─────────────────────────────────────────────────────────────────────────────────────

def cobbles(seed=11):
    rng = random.Random(seed)
    ROWS = 10
    wave_a, wave_p = 6.0, rng.uniform(0, 2 * math.pi)           # the rows bow gently: one whole wave a tile, so it wraps
    hs = [rng.uniform(0.86, 1.14) for _ in range(ROWS)]
    tot = sum(hs)
    hs = [h * S / tot for h in hs]
    stones = []
    y = rng.uniform(0, S)
    for rh in hs:
        n = max(3, round(S / (rh * 1.18)))
        ws = [rng.uniform(0.72, 1.6) for _ in range(n)]
        tot = sum(ws)
        ws = [w * S / tot for w in ws]
        x = rng.uniform(0, S)
        for w in ws:
            gx, gy = rng.uniform(1.6, 3.4), rng.uniform(1.6, 3.4)       # half the joint on each side
            jx, jy = rng.uniform(-1.8, 1.8), rng.uniform(-1.8, 1.8)
            cx = x + w / 2 + jx
            cy = y + rh / 2 + jy + wave_a * math.sin(2 * math.pi * cx / S + wave_p)
            harm = [(k, rng.uniform(0, 0.09) / k ** 0.85, rng.uniform(0, 2 * math.pi)) for k in (2, 3, 4, 5, 6)]
            grow = 1 + 0.3 * sum(h[1] for h in harm)
            a = (w / 2 - gx - abs(jx)) * rng.uniform(0.96, 1.0) / grow
            b = (rh / 2 - gy - abs(jy)) * rng.uniform(0.95, 1.0) / grow
            hue = max(-1.2, min(1.4, rng.gauss(0.1, 0.6)))
            base = (140, 135, 127)
            tint = (13, 5, -8) if hue > 0 else (-6, -1, 4)
            v = rng.uniform(0.82, 1.14) if rng.random() > 0.08 else rng.uniform(0.66, 0.78)
            col = tuple(max(0, (base[c] + abs(hue) * tint[c]) * v) for c in range(3))
            stones.append(dict(cx=cx % S, cy=cy % S, a=a, b=b, th=rng.gauss(0, 0.05), p=rng.uniform(2.4, 3.4),
                               harm=harm, h=rng.uniform(0.2, 0.32) * min(a, b), col=col,
                               ox=rng.randrange(S), oy=rng.randrange(S)))
            x += w
        y += rh

    N = S * S
    D = array('f', [-1e9]) * N            # signed px distance to the nearest stone's edge (+ inside)
    T = array('f', [0.0]) * N             # 1 at a stone's centre, 0 at its edge
    ID = array('i', [-1]) * N
    MARGIN = 10
    atan2, cos, sqrt = math.atan2, math.cos, math.sqrt
    for k, st in enumerate(stones):
        cx, cy, a, b, th, p = st['cx'], st['cy'], st['a'], st['b'], st['th'], st['p']
        c, s = math.cos(th), math.sin(th)
        ex = 1.15 * (abs(a * c) + abs(b * s)) + MARGIN
        ey = 1.15 * (abs(a * s) + abs(b * c)) + MARGIN
        ia, ib, ip = 1 / a, 1 / b, 1 / p
        (k2, A2, P2), (k3, A3, P3), (k4, A4, P4), (k5, A5, P5), (k6, A6, P6) = st['harm']
        for yy in range(int(cy - ey), int(cy + ey) + 1):
            dy = yy + 0.5 - cy
            row = (yy % S) * S
            for xx in range(int(cx - ex), int(cx + ex) + 1):
                dx = xx + 0.5 - cx
                u = (dx * c + dy * s) * ia
                v = (dy * c - dx * s) * ib
                rho = (abs(u) ** p + abs(v) ** p) ** ip
                dist = sqrt(dx * dx + dy * dy)
                if rho < 1e-6:
                    d, t = min(a, b), 1.0
                else:
                    phi = atan2(v, u)
                    m = 1 + A2 * cos(2 * phi + P2) + A3 * cos(3 * phi + P3) + A4 * cos(4 * phi + P4) \
                        + A5 * cos(5 * phi + P5) + A6 * cos(6 * phi + P6)
                    rn = rho / m
                    d = dist / rn - dist                      # px along the ray to the edge
                    t = 1 - rn if rn < 1 else 0.0
                i = row + xx % S
                if d > D[i]:
                    D[i], T[i], ID[i] = d, t, k

    # height, coverage, stone colour
    rough = fbm(rng, [(64, 1), (128, 0.8), (256, 0.6)]).tobytes()
    mott = fbm(rng, [(8, 1), (16, 0.8), (32, 0.6), (64, 0.4)]).tobytes()
    fl = flecks(rng, 26000, 0.5, 1.4, 60, 105).tobytes()
    gapn = fbm(rng, [(32, 1), (128, 0.7), (256, 0.5)]).tobytes()
    H = array('f', [0.0]) * N
    M = array('f', [0.0]) * N
    SA = bytearray(3 * N)
    mask = bytearray(N)
    for i in range(N):
        d, k = D[i], ID[i]
        if d < -MARGIN:
            d = -MARGIN
        m = smoothstep(-0.8, 0.8, d)
        hg = -1.0 + 0.5 * (gapn[i] - 128) / 40
        if m > 0 and k >= 0:
            st = stones[k]
            rn = 1 - T[i]
            dome = (1 - rn ** 2.2) ** 0.72 if rn < 1 else 0.0
            hs = st['h'] * dome + 0.24 * (rough[i] - 128) / 40 + 0.12 * (fl[i] - 128) / 40
            H[i] = m * hs + (1 - m) * hg
            y, x = divmod(i, S)
            mo = mott[((y + st['oy']) % S) * S + (x + st['ox']) % S]
            f = (1 + 0.11 * (mo - 128) / 40) * (1 + 0.10 * (fl[i] - 128) / 70) * (0.74 + 0.26 * smoothstep(0, 9, d))
            col = st['col']
            j = 3 * i
            SA[j] = min(255, int(col[0] * f))
            SA[j + 1] = min(255, int(col[1] * f))
            SA[j + 2] = min(255, int(col[2] * f))
        else:
            H[i] = hg
            m = 0.0
        M[i] = m
        mask[i] = int(m * 255)

    # the ground between: gritty earth, moss in places
    maskim = Image.frombytes('L', (S, S), bytes(mask))
    earth = fbm(rng, [(16, 1), (32, 0.8), (64, 0.6), (256, 0.5)], 34)
    G = ImageChops.multiply(Image.new('RGB', (S, S), (160, 136, 108)), Image.merge('RGB', (earth,) * 3))
    moss = fbm(rng, [(16, 1), (32, 0.8), (64, 0.5)], 40).point(lambda v: max(0, min(200, (v - 146) * 5)))
    mossim = ImageChops.multiply(Image.new('RGB', (S, S), (118, 132, 74)), Image.merge('RGB', (earth,) * 3))
    G = Image.composite(mossim, G, moss)
    dr = ImageDraw.Draw(G)
    grit = [(128, 122, 110), (118, 104, 86), (96, 92, 86), (58, 50, 42), (140, 132, 116)]
    for _ in range(7000):
        c = rng.choice(grit)
        v = rng.uniform(0.8, 1.15)
        wrapped_spots(dr, rng.uniform(0, S), rng.uniform(0, S), rng.uniform(0.7, 2.0), tuple(int(q * v) for q in c))
    AOG = gap_shade(maskim, 5, 3, 0.36, 0.2)
    im = light_and_compose(H, M, SA, G.tobytes(), AOG, amb=0.48)
    return im


# ── flagstones ──────────────────────────────────────────────────────────────────────────────────

def clip(poly, nx, ny, c):
    """Keep the part of a convex polygon where nx*x + ny*y <= c."""
    out = []
    n = len(poly)
    for i in range(n):
        P, Q = poly[i], poly[(i + 1) % n]
        fp, fq = c - nx * P[0] - ny * P[1], c - nx * Q[0] - ny * Q[1]
        if fp >= 0:
            out.append(P)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])))
    return out


def flagstones(seed=5):
    rng = random.Random(seed)
    DMIN = 152
    pts, misses = [], 0
    while misses < 5000:                         # dart throwing with wrapped distances
        p = (rng.uniform(0, S), rng.uniform(0, S))
        ok = True
        for q in pts:
            dx, dy = abs(p[0] - q[0]), abs(p[1] - q[1])
            dx, dy = min(dx, S - dx), min(dy, S - dy)
            if dx * dx + dy * dy < DMIN * DMIN:
                ok = False
                break
        if ok:
            pts.append(p)
            misses = 0
        else:
            misses += 1
    W = [rng.uniform(-1, 1) * (0.38 * DMIN) ** 2 for _ in pts]     # power-diagram weights: some slabs bigger

    slabs = []
    for i, a in enumerate(pts):
        R = 2.2 * DMIN
        poly = [(a[0] - R, a[1] - R), (a[0] + R, a[1] - R), (a[0] + R, a[1] + R), (a[0] - R, a[1] + R)]
        for j, q in enumerate(pts):
            for ox in (-S, 0, S):
                for oy in (-S, 0, S):
                    if j == i and ox == 0 and oy == 0:
                        continue
                    b = (q[0] + ox, q[1] + oy)
                    vx, vy = b[0] - a[0], b[1] - a[1]
                    L = math.hypot(vx, vy)
                    if L > 2.8 * DMIN:
                        continue
                    half = random.Random(min(i, j) * 7919 + max(i, j)).uniform(1.5, 3.0)   # half the grout, same both sides
                    c = (b[0] ** 2 + b[1] ** 2 - a[0] ** 2 - a[1] ** 2 + W[i] - W[j]) / (2 * L) - half
                    poly = clip(poly, vx / L, vy / L, c)
                    if not poly:
                        break
                if not poly:
                    break
            if not poly:
                break
        if len(poly) < 3:
            continue
        gx = sum(P[0] for P in poly) / len(poly)
        gy = sum(P[1] for P in poly) / len(poly)
        edges = []
        for k in range(len(poly)):
            P, Q = poly[k], poly[(k + 1) % len(poly)]
            ex, ey = Q[0] - P[0], Q[1] - P[1]
            L = math.hypot(ex, ey)
            if L < 0.5:
                continue
            nx, ny = ey / L, -ex / L
            c = nx * P[0] + ny * P[1]
            if c - nx * gx - ny * gy < 0:
                nx, ny, c = -nx, -ny, -c
            edges.append((nx, ny, c))          # inside: c - n.p >= 0
        pal = [(210, 196, 168), (190, 186, 176), (212, 192, 158), (202, 194, 176), (206, 188, 158), (196, 190, 180)]
        c1, c2 = rng.choice(pal), rng.choice(pal)
        w = rng.random()
        v = rng.uniform(0.88, 1.08)
        col = tuple((c1[q] * (1 - w) + c2[q] * w) * v for q in range(3))
        ang = rng.uniform(0, math.pi)
        slabs.append(dict(poly=poly, edges=edges, cx=gx, cy=gy, col=col,
                          tx=rng.uniform(-0.022, 0.022), ty=rng.uniform(-0.022, 0.022),
                          bx=math.cos(ang) / rng.uniform(28, 60), by=math.sin(ang) / rng.uniform(28, 60),
                          bamp=rng.uniform(0.0, 0.035), ox=rng.randrange(S), oy=rng.randrange(S)))

    N = S * S
    D = array('f', [-1e9]) * N
    ID = array('i', [-1]) * N
    MARGIN, K = 8, 2.6                        # K: how round the corners are (soft-min of the edge distances)
    exp, log = math.exp, math.log
    for k, sl in enumerate(slabs):
        xs = [P[0] for P in sl['poly']]
        ys = [P[1] for P in sl['poly']]
        edges = sl['edges']
        for yy in range(int(min(ys)) - MARGIN, int(max(ys)) + MARGIN + 1):
            py = yy + 0.5
            rowc = [(nx, c - ny * py) for nx, ny, c in edges]
            row = (yy % S) * S
            for xx in range(int(min(xs)) - MARGIN, int(max(xs)) + MARGIN + 1):
                px = xx + 0.5
                ds = [cc - nx * px for nx, cc in rowc]
                dm = min(ds)
                if dm < 4 * K:
                    dm = dm - K * log(sum(exp((dm - q) / K) for q in ds))
                i = row + xx % S
                if dm > D[i]:
                    D[i], ID[i] = dm, k

    chip = fbm(rng, [(32, 1), (64, 0.8), (128, 0.6)]).tobytes()      # nicks the edges and wobbles the grout
    rough = fbm(rng, [(64, 1), (128, 0.8), (256, 0.7)]).tobytes()
    mott = fbm(rng, [(8, 1), (16, 0.8), (32, 0.6), (64, 0.5)]).tobytes()
    stain = fbm(rng, [(4, 1), (8, 0.8), (16, 0.5)]).tobytes()
    warp = fbm(rng, [(16, 1), (32, 0.6)]).tobytes()
    moss = fbm(rng, [(8, 1), (16, 0.9), (32, 0.6), (128, 0.3)], 40).point(lambda v: max(0, min(255, (v - 128) * 5)))
    mossb = moss.tobytes()
    fl = flecks(rng, 34000, 0.5, 1.3, 70, 110).tobytes()
    H = array('f', [0.0]) * N
    M = array('f', [0.0]) * N
    SA = bytearray(3 * N)
    mask = bytearray(N)
    sin, TAU, half = math.sin, 2 * math.pi, S / 2
    BEV, HB = 6.0, 4.0
    for i in range(N):
        k = ID[i]
        d = D[i]
        if d < -MARGIN:
            d = -MARGIN
        d += 1.3 * (chip[i] - 128) / 40
        m = smoothstep(-0.7, 0.7, d)
        hg = -0.8 + 0.35 * (rough[i] - 128) / 40
        if m > 0 and k >= 0:
            sl = slabs[k]
            y, x = divmod(i, S)
            dx = (x + 0.5 - sl['cx'] + half) % S - half       # position in the slab, unwrapped
            dy = (y + 0.5 - sl['cy'] + half) % S - half
            e = 1 - d / BEV
            bev = 1 - e * e if e > 0 else 1.0
            if e > 1:
                bev = 0.0
            hs = bev * (HB + sl['tx'] * dx + sl['ty'] * dy) + 0.22 * (rough[i] - 128) / 40 + 0.07 * (fl[i] - 128) / 40
            H[i] = m * hs + (1 - m) * hg
            mo = mott[((y + sl['oy']) % S) * S + (x + sl['ox']) % S]
            stv = stain[((y + sl['oy']) % S) * S + (x + sl['ox']) % S]
            bed = sin(TAU * (dx * sl['bx'] + dy * sl['by']) + 3.0 * (warp[i] - 128) / 40)
            f = (1 + 0.055 * (mo - 128) / 40) * (1 + sl['bamp'] * bed) * (1 + 0.10 * (fl[i] - 128) / 70)
            f *= 1 - 0.10 * smoothstep(150, 210, stv)
            f *= 0.86 + 0.14 * smoothstep(0, 10, d)
            col = sl['col']
            r, g, b = col[0] * f, col[1] * f, col[2] * f
            mz = mossb[i] / 255 * (1 - smoothstep(0, 5, d)) * 0.7     # moss creeping onto the slab edge
            if mz > 0:
                r, g, b = r + (92 - r) * mz, g + (108 - g) * mz, b + (58 - b) * mz
            j = 3 * i
            SA[j] = min(255, int(r))
            SA[j + 1] = min(255, int(g))
            SA[j + 2] = min(255, int(b))
        else:
            H[i] = hg
            m = 0.0
        M[i] = m
        mask[i] = int(m * 255)

    maskim = Image.frombytes('L', (S, S), bytes(mask))
    grout = fbm(rng, [(32, 1), (64, 0.8), (256, 0.6)], 30)
    G = ImageChops.multiply(Image.new('RGB', (S, S), (196, 180, 156)), Image.merge('RGB', (grout,) * 3))
    mossim = ImageChops.multiply(Image.new('RGB', (S, S), (160, 194, 96)), Image.merge('RGB', (grout,) * 3))
    G = Image.composite(mossim, G, moss)
    AOG = gap_shade(maskim, 3, 2, 0.3, 0.25)
    return light_and_compose(H, M, SA, G.tobytes(), AOG, amb=0.5)


# ── main ────────────────────────────────────────────────────────────────────────────────────────

TARGETS = {'cobbles': (cobbles, 118), 'flagstones': (flagstones, 148)}


def seam_report(im):
    """How the step across the wrap (last row -> first, last column -> first) ranks among all the steps
    between neighbouring rows / columns inside the picture: a seam would sit at the very top (1.00)."""
    g = im.convert('L').tobytes()
    rows = [sum(abs(g[y * S + x] - g[((y + 1) % S) * S + x]) for x in range(S)) / S for y in range(S)]
    cols = [sum(abs(g[y * S + x] - g[y * S + (x + 1) % S]) for y in range(S)) / S for x in range(S)]
    rank = lambda a: sum(v < a[-1] for v in a) / len(a)
    return rows[-1], sorted(rows)[S // 2], rank(rows), cols[-1], sorted(cols)[S // 2], rank(cols)


def main():
    args = sys.argv[1:]
    preview = None
    if '--preview' in args:
        k = args.index('--preview')
        preview = args[k + 1]
        del args[k:k + 2]
    names = args or list(TARGETS)
    for name in names:
        fn, target = TARGETS[name]
        t0 = time.time()
        im = fn()
        im, before = expose(im, target)
        path = os.path.join(HERE, name + '.jpg')
        im.save(path, quality=88, optimize=True)
        saved = Image.open(path).convert('RGB')
        rw, rmed, rr, cw, cmed, cr = seam_report(saved)
        print(f'{name}: {path}  {time.time() - t0:.1f}s  mean {before:.0f} -> {ImageStat.Stat(saved.convert("L")).mean[0]:.0f}  '
              f'wrap step: rows {rw:.2f} (median {rmed:.2f}, percentile {rr:.2f})  cols {cw:.2f} (median {cmed:.2f}, percentile {cr:.2f})')
        if preview:
            os.makedirs(preview, exist_ok=True)
            tile = Image.new('RGB', (2 * S, 2 * S))
            for ox in (0, S):
                for oy in (0, S):
                    tile.paste(saved, (ox, oy))
            tile.save(os.path.join(preview, name + '_tile.png'))
            tile.crop((S - 256, S - 256, S + 256, S + 256)).save(os.path.join(preview, name + '_seam.png'))


if __name__ == '__main__':
    main()
