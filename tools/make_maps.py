# Builds the bundled maps: python3 tools/make_maps.py site/maps
# The first three are drawn by hand and mirrored; the rest come from mapgen.py.
# Maps do not have to be symmetric (the rules are what is equal for everyone), but
# mirrored ground is the easy way to make a fair one.
import json, math, sys
import mapgen
out = sys.argv[1]
import os
RULES = json.load(open(os.path.join(os.path.dirname(__file__), "..", "site", "rules", "default.json")))
PI = math.pi
OWN = 'HFAPc'

def rot180(rows):
    return [r[::-1] for r in rows[::-1]]

def finish(name, desc, rows, players, owners, funds=None):
    """owners: {(x,y): player} for the tiles that start owned."""
    h, w = len(rows), len(rows[0])
    assert all(len(r) == w for r in rows), [len(r) for r in rows]
    m = {"name": name, "author": "OpenTactics", "description": desc, "width": w, "height": h,
         "players": players, "tiles": rows,
         "owned": [{"x": x, "y": y, "player": p} for (x, y), p in sorted(owners.items(), key=lambda k: (k[0][1], k[0][0]))],
         "units": []}
    if funds is not None: m["start_funds"] = funds
    return m

def two_player(name, desc, top, owned_top, middle=None):
    """top: upper half rows. owned_top: list of (x,y) owned by player 0 in the top half."""
    rows = top + ([middle] if middle else []) + rot180(top)
    h, w = len(rows), len(rows[0])
    owners = {}
    for (x, y) in owned_top:
        assert rows[y][x] in OWN, (name, x, y, rows[y][x])
        owners[(x, y)] = 0
        owners[(w - 1 - x, h - 1 - y)] = 1
    return finish(name, desc, rows, 2, owners)

maps = {}
maps["first-contact"] = two_player("First Contact", "A small two-player duel over a river.", [
    "^^..f....c...~~~",
    "^H.F..f..=...~~~",
    ".=====...=.c..~~",
    ".=.c.=====..f.~~",
    "f=.....f.=...f..",
    "~#~~~~...===c...",
], [(1, 1), (3, 1)])

maps["river-line"] = two_player("River Line", "Two bridges, one airfield each. Hold the crossings.", [
    "..f..c....^^....f..c..",
    ".H.F...f..^^..c....f..",
    ".===========....f.....",
    ".=.A.c..f..=...^^..c..",
    ".=......^..=====...f..",
    "f=.c.f..^^.....=......",
    ".=====.....f...=..c.f.",
    "~~~~~#~~~~~~~~~#~~~~~~",
], [(1, 1), (3, 1), (3, 3)], middle="~~~~~##~~~~~~~~##~~~~~")

# Four players: draw one quarter, rotate it into the four corners.
q = [
    "~~~~~~~~~~~~",
    "~H.F.f..c.~~",
    "~.===...f.P~",
    "~F=.c=..^..~",
    "~.=..===...~",
    "~f.A.f.=.c.~",
    "~...^^.=f...",
    "~c.f...====.",
    "~~.....=.c=.",
    "~~P~...=..=c",
    "~~~~~f....=.",
    "~~~~~~.c.==c",
]
n = len(q)
def rot90(rows):  # clockwise
    return [''.join(rows[n - 1 - x][y] for x in range(n)) for y in range(n)]
tl = q; tr = rot90(tl); br = rot90(tr); bl = rot90(br)
rows = [tl[y] + tr[y] for y in range(n)] + [bl[y] + br[y] for y in range(n)]
start = [(1, 1), (3, 1), (1, 3)]
owners = {}
def rc(x, y):  # where (x,y) of a quarter lands after one clockwise turn
    return (n - 1 - y, x)
for (x, y) in start:
    p = (x, y)
    for player, (ox, oy) in zip([0, 1, 3, 2], [(0, 0), (n, 0), (n, n), (0, n)]):
        owners[(p[0] + ox, p[1] + oy)] = player
        p = rc(*p)
for (x, y), p in owners.items():
    assert rows[y][x] in OWN, (x, y, rows[y][x])
maps["four-corners"] = finish("Four Corners", "Four armies on an island, with ports and airfields.", rows, 4, owners)

# ---- generated ----
def G(*args, **kw):
    """Only 2, 4 and 8 players can be exactly symmetric on a grid. For other counts,
    try some seeds and turns and keep the layout that shares neutral property out
    most evenly (fewer tries on big maps, which take longer to make)."""
    w, h, k = args[2], args[3], args[4]
    if mapgen.exact_group(w, h, k):
        return mapgen.generate(*args, **kw)
    best = None
    area = w * h
    seeds, turns = (60, range(-2, 3)) if area <= 1100 else (10, range(-1, 2)) if area <= 2600 else (4, range(-1, 2))
    for turn in turns:
        for s in range(args[5], args[5] + seeds):
            opts = dict(kw, base_angle=kw["base_angle"] + turn * PI / 48)
            try:
                m = mapgen.generate(*args[:5], s, **opts)
                near = mapgen.check(m, RULES)["nearest_neutral"]
            except (AssertionError, ValueError):
                continue
            spread = max(near) - min(near)
            if best is None or spread < best[0]:
                best = (spread, m)
    m = best[1]
    # Big maps get few tries: top up whoever is short of nearby property.
    if area > 1100:
        m = mapgen.balance(m, RULES)
    return m
LEFT, RIGHT, TOP, TOPLEFT = PI, 0.0, -PI / 2, -3 * PI / 4

maps["twin-valleys"] = G("Twin Valleys", "Two valleys split by a ridge, joined by a single road.", 20, 14, 2, 11,
    base_angle=LEFT, base_r=0.8, mountains=0.6, forests=0.62, ring=0.35,
    cities=[(0.45, 0.5), (0.25, 0.9)], factories=[(0.55, 0.0)])
maps["crossfire"] = G("Crossfire", "A quick, cramped duel. Fight for the middle.", 16, 16, 2, 5,
    base_angle=TOP, base_r=0.8, mountains=0.72, forests=0.58,
    cities=[(0.45, 0.6), (0.2, 0.8)], center=[(7, 7)])
maps["long-road"] = G("Long Road", "Forests on either side of one long highway.", 32, 10, 2, 23,
    base_angle=LEFT, base_r=0.82, mountains=0.74, forests=0.5,
    cities=[(0.5, 0.6), (0.3, 0.5), (0.12, 0.9)], factories=[(0.42, 0.0)])
maps["salt-flats"] = G("Salt Flats", "Open ground and a salt lake. Little cover anywhere.", 24, 18, 2, 31,
    base_angle=TOPLEFT, base_r=0.85, water=("lake",), lake=0.32, mountains=0.8, forests=0.7, ring=0.55,
    cities=[(0.6, 0.6), (0.45, 0.0), (0.7, 0.25)], factories=[(0.62, -0.55)], airports=[(0.55, 0.0)])
maps["archipelago"] = G("Archipelago", "Two islands and a strait. Ships and aircraft decide it.", 26, 18, 2, 47,
    base_angle=LEFT, base_r=0.7, water=("island", "rivers"), coast=0.92, river_w=3.2, river_from=0.0,
    mountains=0.72, forests=0.6, cities=[(0.45, 0.6), (0.3, 0.75)], airports=[(0.5, 0.0)],
    ports=[(0.3, 0.0)], ring=0.3)

maps["triad"] = G("Triad", "Three armies on one round island.", 24, 24, 3, 7,
    base_angle=TOP, base_r=0.68, water=("island",), coast=0.92, mountains=0.7, forests=0.6, ring=0.32,
    cities=[(0.5, 0.6), (0.3, 0.0)], factories=[(0.2, 0.0)], ports=[(0.85, 0.5)])
maps["three-rivers"] = G("Three Rivers", "Rivers run between the bases into a central lake.", 26, 26, 3, 13,
    base_angle=TOP, base_r=0.74, water=("rivers", "lake"), river_w=2.2, river_from=0.2, lake=0.18,
    mountains=0.72, forests=0.58, ring=0.4, cities=[(0.55, 0.6), (0.3, 0.5)], airports=[(0.45, 0.0)])
maps["woodland-forts"] = G("Woodland Forts", "Three forts in a forest, no water at all.", 22, 22, 3, 21,
    base_angle=TOP, base_r=0.72, mountains=0.66, forests=0.48, hub=0.0,
    cities=[(0.45, 0.55), (0.25, 0.4)], factories=[(0.3, 0.0)])

maps["crossroads"] = G("Crossroads", "Four armies, four roads, one square in the middle.", 22, 22, 4, 3,
    base_angle=TOPLEFT, base_r=0.8, mountains=0.7, forests=0.56, ring=0.4,
    cities=[(0.55, 0.6), (0.3, 0.0)], factories=[(0.45, 0.0)])
maps["four-lakes"] = G("Four Lakes", "Four corners, a lake between each pair of neighbours.", 28, 20, 4, 17,
    base_angle=TOPLEFT, base_r=0.85, water=("rivers",), river_w=3.0, river_from=0.45,
    mountains=0.72, forests=0.6, ring=0.35, cities=[(0.6, 0.6), (0.4, 0.4)], airports=[(0.25, 0.0)])
maps["atoll"] = G("Atoll", "A ring of land around a lagoon. Four ports, four airfields.", 28, 28, 4, 29,
    base_angle=TOPLEFT, base_r=0.72, water=("island", "lake"), coast=0.95, lake=0.3,
    mountains=0.74, forests=0.6, ring=0.55, spokes=True, hub=0.55,
    cities=[(0.65, 0.6), (0.5, 0.0)], airports=[(0.75, 0.6)], ports=[(0.4, 0.0)])

maps["hexfall"] = G("Hexfall", "Six armies on a big island. Alliances will not last.", 32, 32, 6, 37,
    base_angle=TOP, base_r=0.74, water=("island",), coast=0.93, mountains=0.72, forests=0.6, ring=0.36,
    cities=[(0.5, 0.0), (0.25, 0.0)], factories=[(0.18, 0.0)])
maps["grand-melee"] = G("Grand Melee", "Eight armies around a lake. Chaos guaranteed.", 40, 40, 8, 41,
    base_angle=-PI / 2 + PI / 8, base_r=0.8, water=("lake",), lake=0.16, mountains=0.74, forests=0.6,
    ring=0.42, cities=[(0.55, 0.0), (0.32, 0.0)], factories=[(0.25, 0.0)])

# ---- more maps, 2 to 16 players ----
OCT = -PI / 2 + PI / 8   # eight players: bases between the axes

maps["pocket-duel"] = G("Pocket Duel", "A tiny, fast duel.", 12, 10, 2, 51,
    base_angle=LEFT, base_r=0.82, mountains=0.76, forests=0.6, cities=[(0.3, 0.8)])
maps["wide-front"] = G("Wide Front", "A long front cut by a river, with bridges to fight over.", 40, 16, 2, 57,
    base_angle=LEFT, base_r=0.86, water=("rivers",), river_w=2.0, river_from=0.0, ring=0.35,
    mountains=0.74, forests=0.58, cities=[(0.6, 0.6), (0.4, 0.0), (0.25, 0.7)], factories=[(0.5, 0.0)])
maps["island-hop"] = G("Island Hop", "Two islands around a lagoon. Ports and airfields decide it.", 30, 22, 2, 61,
    base_angle=LEFT, base_r=0.72, water=("island", "lake"), coast=0.9, lake=0.22, ring=0.4,
    mountains=0.74, forests=0.6, cities=[(0.6, 0.6), (0.35, 0.8)], ports=[(0.4, 0.6)], airports=[(0.5, 0.0)])
maps["highlands"] = G("Highlands", "Mountain country: infantry and artillery rule here.", 24, 24, 2, 67,
    base_angle=TOPLEFT, base_r=0.8, mountains=0.58, forests=0.55, ring=0.3,
    cities=[(0.5, 0.5), (0.3, 0.0)], factories=[(0.45, 0.0)])
maps["small-triangle"] = G("Small Triangle", "Three armies, close quarters.", 18, 18, 3, 71,
    base_angle=TOP, base_r=0.74, mountains=0.74, forests=0.6, cities=[(0.4, 0.6)])
maps["tri-lakes"] = G("Tri-Lakes", "Three shores of one lake, with rivers between.", 30, 30, 3, 73,
    base_angle=TOP, base_r=0.74, water=("lake", "rivers"), lake=0.2, river_w=2.0, river_from=0.45, ring=0.38,
    mountains=0.72, forests=0.58, cities=[(0.55, 0.6), (0.3, 0.5)], airports=[(0.45, 0.0)])
maps["plains-of-four"] = G("Plains of Four", "Four armies on open ground. Quick and bloody.", 18, 18, 4, 79,
    base_angle=TOPLEFT, base_r=0.8, mountains=0.78, forests=0.62, ring=0.3, cities=[(0.4, 0.5)])
maps["quad-islands"] = G("Quad Islands", "Four islands split by straits.", 32, 32, 4, 83,
    base_angle=TOPLEFT, base_r=0.7, water=("island", "rivers"), coast=0.93, river_w=2.5, river_from=0.0, ring=0.3,
    mountains=0.72, forests=0.6, cities=[(0.6, 0.5), (0.35, 0.0)], ports=[(0.45, 0.5)], airports=[(0.5, 0.0)])
maps["big-cross"] = G("Big Cross", "A large four-way war with a ring road.", 40, 40, 4, 89,
    base_angle=TOPLEFT, base_r=0.82, ring=0.45, mountains=0.7, forests=0.58,
    cities=[(0.6, 0.6), (0.45, 0.0), (0.3, 0.5)], factories=[(0.35, 0.0)])
maps["pentagon"] = G("Pentagon", "Five armies on an island.", 32, 32, 5, 97,
    base_angle=TOP, base_r=0.76, water=("island",), coast=0.93, ring=0.38, mountains=0.72, forests=0.6,
    cities=[(0.5, 0.5), (0.28, 0.0)], factories=[(0.2, 0.0)])
maps["six-rivers"] = G("Six Rivers", "Six armies, six rivers, one lake.", 40, 40, 6, 101,
    base_angle=TOP, base_r=0.78, water=("rivers", "lake"), river_w=2.0, river_from=0.2, lake=0.12, ring=0.42,
    mountains=0.72, forests=0.6, cities=[(0.55, 0.5), (0.32, 0.0)], airports=[(0.45, 0.0)])
maps["hex-isles"] = G("Hex Isles", "Six islands around a shared middle.", 36, 36, 6, 103,
    base_angle=TOP, base_r=0.72, water=("island", "rivers"), coast=0.94, river_w=2.0, river_from=0.35, ring=0.3,
    mountains=0.72, forests=0.6, cities=[(0.5, 0.4), (0.3, 0.0)], ports=[(0.55, 0.6)])
maps["octagon-lake"] = G("Octagon Lake", "Eight armies around a big lake.", 48, 48, 8, 107,
    base_angle=OCT, base_r=0.82, water=("lake",), lake=0.22, ring=0.45, mountains=0.72, forests=0.6,
    cities=[(0.6, 0.0), (0.35, 0.0)], factories=[(0.3, 0.0)])
maps["eight-isles"] = G("Eight Isles", "Eight islands joined by bridges.", 44, 44, 8, 109,
    base_angle=OCT, base_r=0.78, water=("island", "rivers"), coast=0.94, river_w=2.0, river_from=0.4, ring=0.5,
    mountains=0.72, forests=0.6, cities=[(0.55, 0.0), (0.35, 0.0)], ports=[(0.6, 0.6)], airports=[(0.3, 0.0)])
maps["nine-lands"] = G("Nine Lands", "Nine armies. Watch your neighbours.", 48, 48, 9, 113,
    base_angle=TOP, base_r=0.8, ring=0.45, mountains=0.72, forests=0.6, cities=[(0.6, 0.0), (0.35, 0.0)])
maps["decagon"] = G("Decagon", "Ten armies on one island.", 52, 52, 10, 127,
    base_angle=TOP, base_r=0.82, water=("island",), coast=0.95, ring=0.5, mountains=0.72, forests=0.6,
    cities=[(0.6, 0.0), (0.38, 0.0)], factories=[(0.25, 0.0)])
maps["twelve-kingdoms"] = G("Twelve Kingdoms", "Twelve armies around a small lake.", 56, 56, 12, 131,
    base_angle=TOP, base_r=0.84, water=("lake",), lake=0.1, ring=0.5, mountains=0.72, forests=0.6,
    cities=[(0.62, 0.0), (0.4, 0.0)])
maps["clockwork"] = G("Clockwork", "Twelve armies, each behind its own river.", 52, 52, 12, 137,
    base_angle=TOP, base_r=0.82, water=("rivers",), river_w=2.0, river_from=0.5, ring=0.4, mountains=0.74, forests=0.6,
    cities=[(0.6, 0.0), (0.35, 0.0)])
maps["sixteen-banners"] = G("Sixteen Banners", "Sixteen armies. The biggest war there is.", 64, 64, 16, 139,
    base_angle=TOP, base_r=0.86, ring=0.55, mountains=0.74, forests=0.6, cities=[(0.66, 0.0), (0.42, 0.0)])
maps["grand-ring"] = G("Grand Ring", "Sixteen armies on a ring of land around an inland sea.", 64, 64, 16, 149,
    base_angle=TOP, base_r=0.84, water=("island", "lake"), coast=0.97, lake=0.3, ring=0.6, mountains=0.74, forests=0.6,
    cities=[(0.7, 0.0), (0.5, 0.0)], ports=[(0.4, 0.0)])

for id, m in maps.items():
    if m["author"] == "OpenTactics":
        print(id, mapgen.check(m, RULES))

index = []
for id, m in maps.items():
    json.dump(m, open(f"{out}/{id}.json", "w"), indent=1)
    index.append({"id": id, "name": m["name"], "description": m["description"], "width": m["width"], "height": m["height"], "players": m["players"]})
    print(id, m["width"], "x", m["height"])
    print("\n".join(m["tiles"]))
json.dump(index, open(f"{out}/index.json", "w"), indent=1)
