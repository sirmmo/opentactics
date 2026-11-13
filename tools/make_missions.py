# Builds the bundled missions: python3 tools/make_missions.py site/missions
# A mission is an ordinary map with a "mission" block: a briefing, goals that win
# it, conditions that lose it, which seat the player takes, how the computer plays
# the others, the optional rules it is played with, and tips shown during play.
import json, sys

out = sys.argv[1]


def mission(id, name, desc, rows, *, owned=(), units=(), goals, fail=(), briefing, hints=(),
            ai=None, options=None, funds=None, tutorial=False):
    w = len(rows[0])
    assert all(len(r) == w for r in rows), (id, [len(r) for r in rows])
    m = {
        "name": name, "author": "OpenTactics", "description": desc,
        "width": w, "height": len(rows), "players": 2, "tiles": rows,
        "owned": [{"x": x, "y": y, "player": p} for (x, y, p) in owned],
        "units": [dict(u) for u in units],
        "mission": {
            "briefing": briefing, "player": 0, "goals": list(goals), "fail": list(fail),
            "hints": [{"day": d, "text": t} for (d, t) in hints],
            "ai": {"profile": ai or {"level": "normal", "style": "balanced"}},
        },
    }
    if options is not None:
        m["mission"]["options"] = options
    if funds is not None:
        m["start_funds"] = funds
    for u in m["units"]:
        x, y = u["x"], u["y"]
        assert 0 <= x < w and 0 <= y < len(rows), (id, u)
    return id, m, tutorial


def U(type, x, y, player, **kw):
    return {"type": type, "x": x, "y": y, "player": player, **kw}


M = []

M.append(mission(
    "basic-training", "1 · Basic training", "Move, attack, finish the job.",
    ["..f.........",
     "..f....^^...",
     "............",
     "..=========.",
     "............",
     ".f.....f....",
     "............"],
    units=[U("tank", 2, 2, 0), U("infantry", 1, 4, 0), U("infantry", 3, 4, 0),
           U("infantry", 9, 2, 1, hp=60), U("infantry", 10, 4, 1, hp=50)],
    goals=[{"type": "no_enemy_units"}], fail=[{"type": "day", "day": 8}],
    briefing="Two enemy squads have strayed into our training ground. Destroy them before day 8.",
    hints=[(1, "Tap one of your units to see where it can go (white) and what it could hit (red)."),
           (1, "Tap a white tile to move there, then choose Fire and tap a target, or Wait."),
           (2, "The forecast shows the damage you deal and what comes back. Hurt units hit softer."),
           (3, "Forests and mountains protect whoever stands on them.")],
    ai={"level": "easy", "style": "turtle"}, tutorial=True))

M.append(mission(
    "taking-ground", "2 · Taking ground", "Capture property to earn money and win.",
    ["............",
     "..c.....f...",
     ".....==.....",
     "H...=..=..cH",
     ".....==.....",
     "..c.....^...",
     "............"],
    owned=[(0, 3, 0), (11, 3, 1)],
    units=[U("infantry", 1, 2, 0), U("infantry", 1, 4, 0), U("mech", 2, 3, 0),
           U("infantry", 10, 2, 1, hp=40)],
    goals=[{"type": "capture", "x": 11, "y": 3}], fail=[{"type": "day", "day": 10}],
    briefing="Take the enemy headquarters on the far side. Cities on the way pay 1000 a day each.",
    hints=[(1, "Infantry and mechs capture. Move onto a city and choose Capture."),
           (1, "A capture takes 20 points; a unit adds its health (up to 10) each turn, so two turns at full health."),
           (2, "If the capturing unit moves away or is hurt, progress is lost or slower."),
           (4, "Capturing the enemy headquarters wins at once.")],
    ai={"level": "easy", "style": "turtle"}, tutorial=True))

M.append(mission(
    "factory-floor", "3 · Factory floor", "Build an army and stop the raid.",
    ["..............",
     ".c...f....^...",
     "....====......",
     "HF..=..=....c.",
     "....====......",
     ".c........f...",
     "..............",
     "...........^..",
     ".........H...."],
    owned=[(0, 3, 0), (1, 3, 0), (1, 1, 0), (1, 5, 0), (9, 8, 1)],
    units=[U("infantry", 3, 3, 0),
           U("infantry", 11, 2, 1), U("infantry", 12, 4, 1), U("recon", 11, 3, 1), U("mech", 12, 6, 1)],
    funds=6000,
    goals=[{"type": "no_enemy_units"}], fail=[{"type": "lose_tile", "x": 0, "y": 3}, {"type": "day", "day": 12}],
    briefing="A raiding party is coming for our headquarters. Use the factory to build units and wipe the raiders out.",
    hints=[(1, "Tap your factory (next to the headquarters) to build. Units cannot move on the day they are built."),
           (1, "Tanks are strong against vehicles, mechs are cheap tank-killers, infantry are cheap and capture."),
           (2, "Every property you own pays you at the start of your turn."),
           (3, "Units on your cities and headquarters are repaired a little each turn, for a share of their price.")],
    ai={"level": "normal", "style": "rusher"}, tutorial=True))

M.append(mission(
    "over-the-water", "4 · Over the water", "Transports: board, sail, unload.",
    ["~~~~~~~~~~~~~~",
     "~...~~~~~~...~",
     "~H..~~~~~~.c.~",
     "~...P~~~~~...~",
     "~.c.~~~~~~..H~",
     "~...~~~~~~...~",
     "~~~~~~~~~~~~~~"],
    owned=[(1, 2, 0), (4, 3, 0), (12, 4, 1)],
    units=[U("infantry", 2, 3, 0), U("mech", 3, 2, 0), U("lander", 5, 3, 0), U("airlift", 2, 1, 0),
           U("infantry", 11, 4, 1, hp=50)],
    goals=[{"type": "capture", "x": 12, "y": 4}], fail=[{"type": "day", "day": 10}],
    briefing="The enemy headquarters is on the eastern island. Ferry your troops across and take it.",
    hints=[(1, "Move a foot unit onto the lander or the airlift and choose Board."),
           (1, "A loaded transport shows how many it carries. Move it, then choose Unload and tap where each passenger gets out."),
           (2, "Passengers cannot act on the turn they get out; plan to land next to your target."),
           (3, "The lander carries two units; the airlift one, but it flies.")],
    ai={"level": "easy", "style": "turtle"}, tutorial=True))

M.append(mission(
    "into-the-fog", "5 · Into the fog", "Find hidden enemies before they find you.",
    ["..............",
     "...ff....ff...",
     ".......^......",
     "..f.......f...",
     "......==......",
     "H.....==.....f",
     "..f.......f...",
     ".......^......",
     "...ff....ff...",
     ".............."],
    owned=[(0, 5, 0)],
    units=[U("recon", 1, 4, 0), U("tank", 1, 6, 0), U("tank", 2, 5, 0), U("mech", 0, 4, 0),
           U("infantry", 9, 1, 1), U("mech", 10, 8, 1), U("artillery", 12, 5, 1), U("tank", 10, 3, 1)],
    options={"fog": True},
    goals=[{"type": "no_enemy_units"}], fail=[{"type": "no_units"}, {"type": "day", "day": 14}],
    briefing="Fog of war: you only see what your units see. Enemies hide in the woods. Scout, then strike.",
    hints=[(1, "Darkened tiles are out of sight. The recon sees furthest; mountains let foot units see further."),
           (1, "Units in forests are only seen from right next to them."),
           (2, "Moving into a hidden enemy stops your unit short: an ambush.")],
    ai={"level": "normal", "style": "turtle"}))

M.append(mission(
    "running-on-empty", "6 · Running on empty", "Fuel and ammo: refuel or fall from the sky.",
    ["..............",
     ".A.....^......",
     "..............",
     "H....f....f...",
     "..............",
     ".c.....^....H.",
     ".............."],
    owned=[(0, 3, 0), (1, 1, 0), (1, 5, 0), (12, 5, 1)],
    units=[U("copter", 4, 1, 0, fuel=14), U("copter", 5, 4, 0, fuel=12, ammo=2), U("apc", 2, 4, 0),
           U("infantry", 10, 2, 1), U("infantry", 11, 4, 1), U("mech", 9, 5, 1), U("recon", 12, 3, 1)],
    options={"supply": True},
    goals=[{"type": "no_enemy_units"}], fail=[{"type": "no_units"}, {"type": "day", "day": 12}],
    briefing="Your helicopters are nearly dry. Aircraft burn fuel every day and crash at zero. Refuel at the airport or next to the carrier, then clear the field.",
    hints=[(1, "The unit card shows fuel and ammo. A can or crate icon on a unit means it is running low."),
           (1, "Units on your airport (aircraft), cities (ground) or next to your carrier are refilled at the start of your turn."),
           (2, "A carrier can also refill its neighbours at once with Resupply.")],
    ai={"level": "easy", "style": "balanced"}))

M.append(mission(
    "convoy", "7 · Convoy", "Get the carrier through the pass alive.",
    ["..^^^^^^^^^^^...",
     "..^..........^..",
     "....=========...",
     "H===....f....===",
     "....=========...",
     "..^......f...^..",
     "..^^^^^^^^^^^..."],
    owned=[(0, 3, 0)],
    units=[U("apc", 1, 3, 0, tag="convoy"), U("tank", 2, 2, 0), U("antiair", 2, 4, 0), U("mech", 1, 2, 0),
           U("artillery", 9, 1, 1), U("copter", 12, 5, 1), U("infantry", 8, 3, 1), U("tank", 13, 2, 1)],
    goals=[{"type": "unit_at", "tag": "convoy", "x": 15, "y": 3}],
    fail=[{"type": "unit_gone", "tag": "convoy"}, {"type": "day", "day": 12}],
    briefing="Escort the supply carrier (the one in front of your headquarters) to the east end of the pass. If it is destroyed, the mission fails.",
    hints=[(1, "The carrier is unarmed: keep your tank and anti-air between it and the enemy."),
           (2, "Artillery fires from 2 to 3 tiles away and cannot be hit back by most units."),
           (3, "The convoy must stop on the road tile at the far east edge.")],
    ai={"level": "normal", "style": "turtle"}))

M.append(mission(
    "last-stand", "8 · Last stand", "Hold the headquarters for ten days.",
    ["................",
     "..c....^....F...",
     "........f.......",
     "H.F...=====...F.",
     "........f.....cH",
     "..c....^....F...",
     "................"],
    owned=[(0, 3, 0), (2, 3, 0), (2, 1, 0), (2, 5, 0), (15, 4, 1), (14, 3, 1), (12, 1, 1), (12, 5, 1), (14, 4, 1)],
    units=[U("tank", 3, 3, 0), U("artillery", 1, 2, 0), U("infantry", 1, 4, 0), U("antiair", 3, 4, 0),
           U("tank", 11, 3, 1), U("tank", 12, 2, 1), U("mech", 11, 4, 1), U("artillery", 13, 3, 1), U("copter", 13, 5, 1)],
    funds=4000,
    goals=[{"type": "day", "day": 11}], fail=[{"type": "lose_tile", "x": 0, "y": 3}, {"type": "no_units"}],
    briefing="Three enemy factories are pouring units toward us. Hold the headquarters until day 11.",
    hints=[(1, "You do not have to win, only last. Defensive ground and repairs on your cities count."),
           (3, "Keep the factory free so you can keep building.")],
    ai={"level": "hard", "style": "rusher"}))

index = []
for id, m, tutorial in M:
    json.dump(m, open(f"{out}/{id}.json", "w"), indent=1, ensure_ascii=False)
    index.append({"id": id, "name": m["name"], "description": m["description"], "tutorial": tutorial,
                  "width": m["width"], "height": m["height"]})
json.dump(index, open(f"{out}/index.json", "w"), indent=1, ensure_ascii=False)
print(len(index), "missions")
