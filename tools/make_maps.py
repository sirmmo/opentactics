# Builds the bundled maps. Each is drawn as one half (or quarter) and mirrored,
# so every player gets the same ground.
import json, sys
out = sys.argv[1]
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
maps["four-corners"] = finish("Four Corners", "Four armies on an island, with ports and airfields. Two to four players.", rows, 4, owners)

index = []
for id, m in maps.items():
    json.dump(m, open(f"{out}/{id}.json", "w"), indent=1)
    index.append({"id": id, "name": m["name"], "description": m["description"], "width": m["width"], "height": m["height"], "players": m["players"]})
    print(id, m["width"], "x", m["height"])
    print("\n".join(m["tiles"]))
json.dump(index, open(f"{out}/index.json", "w"), indent=1)
