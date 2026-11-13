# Generates fair multi-player maps from a few parameters.
#
# The map is cut into one wedge per player around its centre. Terrain comes from a
# noise function evaluated in "wedge coordinates", so every wedge gets the same
# ground. Bases, cities, ports and roads are laid out once for player 0 and turned
# into every other wedge. When the grid allows an exact symmetry (two players on any
# rectangle, four on a rectangle or square, eight on a square) the result is made
# exactly symmetric; three and six players are as close as a square grid allows.
import math

PROPS = set('HFAPcT')
GLYPHS = set('.f^=#~cFAPH')


# ---- noise ------------------------------------------------------------------

def _hash(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF


def _smooth(t):
    return t * t * (3 - 2 * t)


def vnoise(x, y, seed):
    xi, yi = math.floor(x), math.floor(y)
    tx, ty = _smooth(x - xi), _smooth(y - yi)
    a, b = _hash(xi, yi, seed), _hash(xi + 1, yi, seed)
    c, d = _hash(xi, yi + 1, seed), _hash(xi + 1, yi + 1, seed)
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty


def fbm(x, y, seed, scale):
    x, y = x / scale, y / scale
    return (vnoise(x, y, seed) * 2 + vnoise(x * 2.1, y * 2.1, seed + 7)) / 3


# ---- grid symmetries --------------------------------------------------------

def exact_group(w, h, k):
    """Grid maps that permute the wedges, or None when the grid has no exact k-fold symmetry."""
    r180 = lambda p: (w - 1 - p[0], h - 1 - p[1])
    fx = lambda p: (w - 1 - p[0], p[1])
    fy = lambda p: (p[0], h - 1 - p[1])
    ident = lambda p: p
    if k == 2:
        return [ident, r180]
    if k == 4 and w == h:
        r90 = lambda p: (w - 1 - p[1], p[0])
        return [ident, r90, r180, lambda p: r90(r180(p))]
    if k == 4:
        return [ident, fx, r180, fy]
    if k == 8 and w == h:
        r90 = lambda p: (w - 1 - p[1], p[0])
        rots = [ident, r90, r180, lambda p: r90(r180(p))]
        return rots + [(lambda r: lambda p: r(fx(p)))(r) for r in rots]
    return None


class Layout:
    def __init__(self, w, h, k, base_angle, base_r):
        self.w, self.h, self.k = w, h, k
        self.cx, self.cy = (w - 1) / 2, (h - 1) / 2
        self.hw, self.hh = w / 2, h / 2
        self.wedge = 2 * math.pi / k
        self.theta0 = base_angle - self.wedge / 2   # wedge 0 is centred on player 0's base
        self.group = exact_group(w, h, k)
        self.base0 = self.to_tile(base_r, 0)
        # Turn wedge 0 into wedge j: an exact grid map when we have one, else a rotation.
        if self.group:
            by_wedge = {}
            for g in self.group:
                j = self.wedge_of(*g(self.base0))
                by_wedge.setdefault(j, g)
            assert sorted(by_wedge) == list(range(k)), (w, h, k, sorted(by_wedge))
            self.turn = [by_wedge[j] for j in range(k)]
        else:
            self.turn = [self._rotation(j) for j in range(k)]

    def _rotation(self, j):
        a = self.wedge * j
        ca, sa = math.cos(a), math.sin(a)
        def f(p):
            u, v = (p[0] - self.cx) / self.hw, (p[1] - self.cy) / self.hh
            return (round(self.cx + (u * ca - v * sa) * self.hw), round(self.cy + (u * sa + v * ca) * self.hh))
        return f

    def polar(self, x, y):
        u, v = (x - self.cx) / self.hw, (y - self.cy) / self.hh
        return math.hypot(u, v), math.atan2(v, u)

    def wedge_of(self, x, y):
        _, t = self.polar(x, y)
        return int(((t - self.theta0) % (2 * math.pi)) // self.wedge) % self.k

    def canon(self, x, y):
        """Radius, and angular distance from the nearest wedge edge (0 .. wedge/2)."""
        r, t = self.polar(x, y)
        phi = (t - self.theta0) % self.wedge
        return r, min(phi, self.wedge - phi)

    def to_tile(self, r, frac):
        """A point of wedge 0: radius r, and frac in -1..1 across the wedge (0 = centre line)."""
        a = self.theta0 + self.wedge / 2 + frac * self.wedge / 2
        return (round(self.cx + r * math.cos(a) * self.hw), round(self.cy + r * math.sin(a) * self.hh))

    def inside(self, p):
        return 0 <= p[0] < self.w and 0 <= p[1] < self.h


def line4(a, b):
    """Tiles from a to b, each step orthogonal, so roads stay connected."""
    (x0, y0), (x1, y1) = a, b
    n = max(abs(x1 - x0), abs(y1 - y0))
    out = [(x0, y0)]
    for i in range(1, n + 1):
        p = (round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n))
        last = out[-1]
        if p[0] != last[0] and p[1] != last[1]:
            out.append((p[0], last[1]))   # step across, then along
        out.append(p)
    return out


# ---- the generator ----------------------------------------------------------

def generate(name, desc, w, h, players, seed, *, base_angle=math.pi, base_r=0.78,
             water=(), coast=0.9, lake=0.0, river_w=0.0, river_from=0.2,
             mountains=0.68, forests=0.6, ring=None, spokes=True, hub=None,
             cities=(), factories=(), airports=(), ports=(), center=(), port_own=False,
             air_own=False, funds=None, towers=(), beaches=False, reefs=False):
    """
    water: any of 'island', 'lake', 'rivers'.
    cities/factories/airports: wedge points (r, frac) for neutral property; a nonzero frac
      also places its mirror image so the wedge stays balanced.
    ports: wedge points; the port goes on the nearest land tile next to water.
    ring: radius of a ring road; hub: radius where spokes from each HQ end (default ring or 0).
    center: tiles (x, y) of neutral property in the middle, with all their symmetric copies.
    """
    L = Layout(w, h, players, base_angle, base_r)
    grid = [['.'] * w for _ in range(h)]
    owner = {}

    # Ground.
    for y in range(h):
        for x in range(w):
            r, phi = L.canon(x, y)
            px, py = r * math.cos(phi) * L.hw, r * math.sin(phi) * L.hw
            g = '.'
            if fbm(px, py, seed + 1, 3.2) > forests:
                g = 'f'
            if fbm(px, py, seed + 2, 2.7) > mountains:
                g = '^'
            wet = False
            if 'island' in water and r > coast + 0.16 * (fbm(px, py, seed + 3, 2.5) - 0.5):
                wet = True
            if 'lake' in water and r < lake + 0.1 * (fbm(px, py, seed + 4, 2.0) - 0.5):
                wet = True
            if 'rivers' in water and r > river_from and r * L.hw * math.sin(phi) < river_w / 2:
                wet = True
            grid[y][x] = '~' if wet else g

    # Beaches along some shores, reefs off some coasts (from the same wedge noise).
    def near(x, y, glyphs):
        return any(0 <= x + dx < w and 0 <= y + dy < h and grid[y + dy][x + dx] in glyphs
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    if beaches or reefs:
        marks = []
        for y in range(h):
            for x in range(w):
                r, phi = L.canon(x, y)
                px, py = r * math.cos(phi) * L.hw, r * math.sin(phi) * L.hw
                n = fbm(px, py, seed + 5, 2.2)
                if beaches and grid[y][x] in '.f' and near(x, y, '~') and n > 0.5:
                    marks.append((x, y, 's'))
                if reefs and grid[y][x] == '~' and not near(x, y, '.f^s') and n > 0.62:
                    marks.append((x, y, 'r'))
        for x, y, g in marks:
            grid[y][x] = g

    # Everything placed per wedge: compute it for player 0 and turn it into every wedge.
    def everywhere(p):
        return [L.turn[j](p) for j in range(players)]

    def put(p, glyph, player=None):
        if not L.inside(p):
            raise ValueError(f"{name}: {glyph} at {p} is off the map")
        grid[p[1]][p[0]] = glyph
        if player is not None:
            owner[p] = player
        else:
            owner.pop(p, None)

    def frame():
        """Unit vectors toward the centre and across, at player 0's base."""
        bx, by = L.base0
        ix, iy = L.cx - bx, L.cy - by
        n = math.hypot(ix, iy) or 1
        return (ix / n, iy / n), (-iy / n, ix / n)

    (ix, iy), (sx, sy) = frame()
    def local(a, b):
        return (round(L.base0[0] + a * ix + b * sx), round(L.base0[1] + a * iy + b * sy))

    hq = L.base0
    kit_own = [(hq, 'H'), (local(2, -1), 'F'), (local(1, 2), 'c')]
    kit_free = [(local(3, -3), 'c'), (local(4, 1), 'c')]

    # Clear the ground around the base.
    for (p, _) in kit_own + kit_free:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                q = (p[0] + dx, p[1] + dy)
                if L.inside(q):
                    for qq in everywhere(q):
                        if L.inside(qq):
                            grid[qq[1]][qq[0]] = '.'

    # Roads (bridges over water), before property so property wins.
    paths = []
    hub_r = hub if hub is not None else (ring if ring is not None else 0.0)
    if spokes:
        front = local(1, 0)
        end = L.to_tile(hub_r, 0) if hub_r > 0 else (round(L.cx), round(L.cy))
        paths.append([hq, front, end])
    if ring is not None:
        n = 10
        paths.append([L.to_tile(ring, -1 + 2 * i / n) for i in range(n + 1)])
    for path in paths:
        for a, b in zip(path, path[1:]):
            for p in line4(a, b):
                for q in everywhere(p):
                    if L.inside(q):
                        grid[q[1]][q[0]] = '#' if grid[q[1]][q[0]] == '~' else '='

    def mirrored(points):
        for (r, f) in points:
            yield (r, f)
            if f:
                yield (r, -f)

    for j, turn in enumerate(L.turn):
        for (p, g) in kit_own:
            put(turn(p), g, j)
        for (p, g) in kit_free:
            put(turn(p), g)
    for glyph, pts in (('c', cities), ('F', factories), ('A', airports), ('T', towers)):
        for (r, f) in mirrored(pts):
            p0 = L.to_tile(r, f)
            for j, q in enumerate(everywhere(p0)):
                put(q, glyph, j if glyph == 'A' and air_own else None)
    for (r, f) in ports:
        target = L.to_tile(r, f)
        spot = nearest_shore(grid, L, target)
        for j, q in enumerate(everywhere(spot)):
            put(q, 'P', j if port_own else None)
    for p in center:
        for q in everywhere(p):
            put(q, 'c')

    if L.group:
        symmetrize(grid, owner, L)

    rows = [''.join(r) for r in grid]
    m = {"name": name, "author": "OpenTactics", "description": desc, "width": w, "height": h,
         "players": players, "tiles": rows,
         "owned": [{"x": x, "y": y, "player": p} for (x, y), p in sorted(owner.items(), key=lambda k: (k[0][1], k[0][0]))],
         "units": []}
    if funds is not None:
        m["start_funds"] = funds
    return m


def nearest_shore(grid, L, target):
    best = None
    for y in range(L.h):
        for x in range(L.w):
            if grid[y][x] in '~#' or grid[y][x] in PROPS or L.wedge_of(x, y) != 0:
                continue
            if not any(L.inside((x + dx, y + dy)) and grid[y + dy][x + dx] == '~'
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            d = (x - target[0]) ** 2 + (y - target[1]) ** 2
            if best is None or d < best[0]:
                best = (d, (x, y))
    assert best, "no shore for a port"
    return best[1]


def symmetrize(grid, owner, L):
    """Make the map exactly symmetric: each orbit of tiles copies its first tile."""
    bases = [g(L.base0) for g in L.turn]
    perms = []
    for g in L.group:
        perms.append([bases.index(g(b)) for b in bases])
    done = set()
    for y in range(L.h):
        for x in range(L.w):
            if (x, y) in done:
                continue
            rep = (x, y)
            g0 = grid[y][x]
            o0 = owner.get(rep)
            for g, perm in zip(L.group, perms):
                q = g(rep)
                done.add(q)
                grid[q[1]][q[0]] = g0
                if o0 is None:
                    owner.pop(q, None)
                else:
                    owner[q] = perm[o0]
    # Owned tiles must still be property.
    for p in list(owner):
        if grid[p[1]][p[0]] not in PROPS:
            del owner[p]


# ---- checks -----------------------------------------------------------------

def check(m, rules):
    """Every factory can reach every enemy HQ over land; returns a fairness summary."""
    w, h, rows = m["width"], m["height"], m["tiles"]
    cost = {t["glyph"]: t["move_cost"] for t in rules["terrains"]}
    players = m["players"]
    hqs = {}
    for o in m["owned"]:
        if rows[o["y"]][o["x"]] == 'H':
            hqs[o["player"]] = (o["x"], o["y"])
    assert sorted(hqs) == list(range(players)), (m["name"], "HQs", hqs)

    def dist(src, mt):
        import heapq
        d = {src: 0}
        q = [(0, src)]
        while q:
            c, (x, y) = heapq.heappop(q)
            if c > d[(x, y)]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    step = cost[rows[ny][nx]].get(mt)
                    if step and c + step < d.get((nx, ny), 1 << 30):
                        d[(nx, ny)] = c + step
                        heapq.heappush(q, (c + step, (nx, ny)))
        return d

    for p, hq in hqs.items():
        d = dist(hq, "treads")
        for e, ehq in hqs.items():
            assert ehq in d, (m["name"], f"tanks from player {p} cannot reach player {e}")
    owned = {(o["x"], o["y"]) for o in m["owned"]}
    neutral = [(x, y) for y in range(h) for x in range(w) if rows[y][x] in PROPS and (x, y) not in owned]
    near = [0] * players
    dists = [dist(hqs[p], "foot") for p in range(players)]
    for t in neutral:
        ds = [dists[p].get(t, 1 << 30) for p in range(players)]
        best = min(ds)
        winners = [p for p in range(players) if ds[p] == best]
        for p in winners:
            near[p] += 1 / len(winners)
    counts = [sum(1 for o in m["owned"] if o["player"] == p) for p in range(players)]
    return {"owned": counts, "nearest_neutral": [round(n, 1) for n in near], "neutral": len(neutral)}


def balance(m, rules):
    """Even out a map that could not be made exactly symmetric: give each player
    who is nearest to fewer neutral properties than the best-off player extra
    neutral cities in their own area, at a typical distance from their HQ."""
    import heapq
    w, h, players = m["width"], m["height"], m["players"]
    rows = [list(r) for r in m["tiles"]]
    cost = {t["glyph"]: t["move_cost"] for t in rules["terrains"]}
    hqs = {o["player"]: (o["x"], o["y"]) for o in m["owned"] if m["tiles"][o["y"]][o["x"]] == 'H'}

    def dist(src):
        d = {src: 0}
        q = [(0, src)]
        while q:
            c, (x, y) = heapq.heappop(q)
            if c > d[(x, y)]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    step = cost[rows[ny][nx]].get("foot")
                    if step and c + step < d.get((nx, ny), 1 << 30):
                        d[(nx, ny)] = c + step
                        heapq.heappush(q, (c + step, (nx, ny)))
        return d

    ds = [dist(hqs[p]) for p in range(players)]
    owned = {(o["x"], o["y"]) for o in m["owned"]}

    def shares():
        near = [0.0] * players
        typical = [[] for _ in range(players)]
        for y in range(h):
            for x in range(w):
                if rows[y][x] in PROPS and (x, y) not in owned:
                    dd = [ds[p].get((x, y), 1 << 30) for p in range(players)]
                    best = min(dd)
                    win = [p for p in range(players) if dd[p] == best]
                    for p in win:
                        near[p] += 1 / len(win)
                        typical[p].append(best)
        return near, typical

    near, typical = shares()
    target = max(near)
    for p in range(players):
        need = int(round(target - near[p] + 0.49))
        typ = sorted(typical[p])[len(typical[p]) // 2] if typical[p] else 8
        for _ in range(need):
            best = None
            for (x, y), d in ds[p].items():
                if rows[y][x] not in '.f' or d < 3:
                    continue
                if any(ds[q].get((x, y), 1 << 30) <= d for q in range(players) if q != p):
                    continue  # must be this player's own ground
                if any(0 <= x + dx < w and 0 <= y + dy < h and rows[y + dy][x + dx] in PROPS
                       for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                    continue  # keep property spread out
                score = (abs(d - typ), y, x)
                if best is None or score < best[0]:
                    best = (score, x, y)
            if best is None:
                break
            _, x, y = best
            rows[y][x] = 'c'
    m["tiles"] = [''.join(r) for r in rows]
    return m
