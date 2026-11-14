# Builds the campaign: python3 tools/make_campaign.py site/campaign
# "The Long Winter": five missions in a row with a short story. Veteran ranks are
# on in every chapter; after a win, the player's best surviving units join the
# roster and start the next chapter on its "carry" tiles, keeping their ranks.
import json, sys

out = sys.argv[1]


def U(type, x, y, player, **kw):
    return {"type": type, "x": x, "y": y, "player": player, **kw}


def chapter(id, name, desc, rows, *, owned=(), units=(), goals, fail=(), briefing, hints=(), ai, options=None,
            funds=None, carry=(), intro, outro):
    w = len(rows[0])
    assert all(len(r) == w for r in rows), (id, [len(r) for r in rows])
    for (x, y, p) in owned:
        assert rows[y][x] in 'HFAPcT', (id, 'owned', x, y, rows[y][x])
    for u in units:
        assert rows[u["y"]][u["x"]] != '~' or u["type"] in ('lander', 'submarine', 'patrol', 'cruiser', 'battleship', 'airlift', 'copter', 'jet'), (id, u)
    for (x, y) in carry:
        assert rows[y][x] in '.fs=', (id, 'carry', x, y, rows[y][x])
    opts = {"ranks": True, **(options or {})}
    m = {
        "name": name, "author": "OpenTactics", "description": desc, "width": w, "height": len(rows), "players": 2,
        "tiles": rows, "owned": [{"x": x, "y": y, "player": p} for (x, y, p) in owned], "units": [dict(u) for u in units],
        "mission": {"briefing": briefing, "player": 0, "goals": list(goals), "fail": list(fail),
                    "hints": [{"day": d, "text": t} for (d, t) in hints], "ai": {"profile": ai}, "options": opts},
        "campaign": {"carry": [{"x": x, "y": y} for (x, y) in carry]},
    }
    if funds is not None:
        m["start_funds"] = funds
    return id, m, intro, outro


C = []

C.append(chapter(
    "landfall", "I · Landfall", "Take the beach, then the headquarters.",
    ["~~~~~~~~~~~~~~",
     "~~~ss.....f..~",
     "~~~s..c....F.~",
     "~~ss....f..H.~",
     "~~s...=====.c~",
     "~~ss..=.f...~~",
     "~~~s..=..c..~~",
     "~~~ss.....^~~~",
     "~~~~~~~~~~~~~~",
     "~~~~~~~~~~~~~~"],
    owned=[(11, 3, 1), (11, 2, 1), (12, 4, 1)],
    units=[U("infantry", 3, 1, 0), U("infantry", 3, 2, 0), U("mech", 2, 4, 0), U("tank", 3, 5, 0), U("lander", 1, 4, 0),
           U("infantry", 8, 3, 1), U("infantry", 10, 5, 1), U("recon", 10, 1, 1)],
    goals=[{"type": "capture", "x": 11, "y": 3}], fail=[{"type": "day", "day": 12}, {"type": "no_units"}],
    briefing="Winter is coming early, and the enemy holds the coast. Our landing craft are on the beach. Take their headquarters before they dig in.",
    hints=[(1, "Ranks are on: units that fight gain experience and earn up to three chevrons, each worth 5% attack and defence."),
           (2, "Your best surviving units will follow you into the next chapter.")],
    ai={"level": "easy", "style": "turtle"},
    carry=[(4, 1), (3, 3), (2, 5), (4, 7)],
    intro="The coast. The landing went well, but the beach is all we have. Inland, the enemy has a headquarters and a factory, and every day we wait they bring in more men. Take it, and the road north is open.",
    outro="The beachhead holds. Survivors talk about the march north: one pass through the mountains, and snow on the way."))

C.append(chapter(
    "frozen-pass", "II · Frozen Pass", "Hold the comms tower through the snow.",
    ["^^^^^^^^^^^^^^^^",
     "^^.....^^.....^^",
     "^.....f..f.....^",
     "H.F..=====...F.H",
     "...c.=.T.=..c...",
     "..f..=====..f...",
     "^.....f..f.....^",
     "^^.....^^.....^^",
     "^^^^^^^^^^^^^^^^"],
    owned=[(0, 3, 0), (2, 3, 0), (7, 4, 0), (15, 3, 1), (13, 3, 1), (12, 4, 1)],
    units=[U("tank", 6, 4, 0), U("infantry", 8, 4, 0), U("artillery", 4, 3, 0),
           U("tank", 12, 2, 1), U("mech", 11, 4, 1), U("infantry", 12, 5, 1), U("artillery", 14, 4, 1)],
    funds=3000,
    goals=[{"type": "day", "day": 10}], fail=[{"type": "lose_tile", "x": 7, "y": 4}, {"type": "no_units"}],
    briefing="The pass is ours, and so is its comms tower: it makes every one of our units hit harder. Hold it until the thaw, nine days. Snow slows everyone.",
    hints=[(1, "The comms tower gives its owner +10% damage. If the enemy takes it, we lose."),
           (3, "Keep the factory working: snow slows their reinforcements as much as ours.")],
    ai={"level": "normal", "style": "rusher"}, options={"weather": "snow"},
    carry=[(5, 4), (6, 3), (6, 5), (3, 5)],
    intro="The pass. A blizzard has closed the roads behind us. The comms tower at the top of the pass is ours for now, and while we hold it, every gun we have hits harder. The enemy knows it too.",
    outro="Nine days of snow, and the tower still stands. On the far side of the pass, scouts hear a big gun firing at night."))

C.append(chapter(
    "night-raid", "III · Night Raid", "Find and destroy Long Tom in the dark.",
    ["................",
     "..ff....ff..ff..",
     "..ff..^.....ff..",
     ".......=====....",
     "H.....=f..f=..F.",
     "......=f..f=...H",
     ".......=====....",
     "..ff........ff..",
     "..ff..^..ff.ff..",
     "................",
     "...ff......ff...",
     "................"],
    owned=[(0, 4, 0), (15, 5, 1), (14, 4, 1)],
    units=[U("recon", 1, 3, 0), U("tank", 1, 5, 0), U("mech", 2, 4, 0), U("infantry", 1, 6, 0),
           U("artillery", 13, 9, 1, tag="Long Tom"), U("infantry", 12, 1, 1), U("mech", 9, 1, 1), U("tank", 13, 7, 1), U("antiair", 12, 8, 1)],
    goals=[{"type": "unit_gone", "tag": "Long Tom"}], fail=[{"type": "day", "day": 10}, {"type": "no_units"}],
    briefing="Fog of war, at night. Somewhere in the woods to the east is Long Tom, the big gun that shelled us in the pass. Find it and destroy it before day 10.",
    hints=[(1, "Your recon sees furthest. Units in forests are only seen from right next to them."),
           (2, "Running into a hidden enemy stops your move short: scout ahead first.")],
    ai={"level": "normal", "style": "turtle"}, options={"fog": True},
    carry=[(2, 2), (3, 5), (2, 7), (4, 4)],
    intro="The woods. Long Tom fires from somewhere east of here, always at night, always gone by morning. The fog is thick. Our recon goes first; everyone else follows its lights.",
    outro="Long Tom is silent. With it gone, the enemy's supply road to the capital lies open, if we can keep our own trucks moving."))

C.append(chapter(
    "supply-lines", "IV · Supply Lines", "Get the convoy to the depot.",
    ["..^^^^^^^^^^^^^^^.",
     "..^.....f......^..",
     "....============..",
     "H===......f.....==",
     "...=..c.....c....c",
     "...============...",
     "..^......f.....^..",
     "..^^^^^^^^^^^^^^^.",
     "..................",
     ".................."],
    owned=[(0, 3, 0), (17, 4, 0)],
    units=[U("apc", 1, 3, 0, tag="convoy"), U("tank", 2, 2, 0), U("antiair", 2, 4, 0), U("copter", 1, 1, 0, fuel=30),
           U("artillery", 9, 1, 1), U("infantry", 10, 4, 1), U("mech", 7, 6, 1), U("recon", 14, 4, 1), U("copter", 15, 8, 1)],
    goals=[{"type": "unit_at", "tag": "convoy", "x": 17, "y": 3}], fail=[{"type": "unit_gone", "tag": "convoy"}, {"type": "day", "day": 12}],
    briefing="Fuel and ammo are on. Our helicopter is low. Escort the convoy (the carrier at our headquarters) to the far end of the eastern road, next to our depot.",
    hints=[(1, "The convoy refills units next to it at the start of your turn, and can Resupply on the spot."),
           (2, "The convoy must stop on the road tile at the far east end, next to the depot.")],
    ai={"level": "normal", "style": "balanced"}, options={"supply": True},
    carry=[(1, 5), (1, 6), (3, 8), (1, 8)],
    intro="The supply road. Everything we need for the last push is in one carrier. Between it and our depot: an enemy ambush, and not much fuel. Keep it alive.",
    outro="The depot is full. Tomorrow, the capital."))

C.append(chapter(
    "the-capital", "V · The Capital", "Take the enemy headquarters.",
    ["....................",
     "..c....f.....f....c.",
     "....=========......F",
     "H.F.=...^...=..c...H",
     "....=..f.f..=......F",
     "..c.=========..c....",
     "........^...........",
     "..ff.........ff.....",
     "....c.........c.....",
     "....................",
     "..f....^^....f......",
     "....................",
     "..c...........c.....",
     "...................."],
    owned=[(0, 3, 0), (2, 3, 0), (2, 1, 0), (2, 5, 0), (19, 3, 1), (19, 2, 1), (19, 4, 1), (18, 1, 1), (15, 3, 1), (15, 5, 1)],
    units=[U("tank", 3, 2, 0), U("artillery", 1, 4, 0), U("infantry", 3, 6, 0), U("mech", 1, 2, 0),
           U("tank", 16, 2, 1), U("tank", 16, 4, 1), U("artillery", 18, 3, 1), U("antiair", 17, 5, 1), U("infantry", 14, 3, 1), U("copter", 17, 1, 1)],
    funds=5000,
    goals=[{"type": "capture", "x": 19, "y": 3}], fail=[{"type": "lose_tile", "x": 0, "y": 3}],
    briefing="The capital. Their headquarters sits behind two factories on the east edge. Take it and the war is over. Lose ours and it is over the other way.",
    hints=[(1, "The enemy here plays at its hardest. Your veterans are worth more than new units: keep them alive."),
           (2, "Mechs and infantry capture; tanks and artillery clear the way.")],
    ai={"level": "hard", "style": "balanced"},
    carry=[(3, 3), (1, 6), (3, 8), (5, 7)],
    intro="The capital. Snow on the roofs, smoke over the factories. Everyone who made it this far is here.",
    outro="The flag over the capital is ours. The long winter is over."))

index = []
for id, m, intro, outro in C:
    json.dump(m, open(f"{out}/{id}.json", "w"), indent=1, ensure_ascii=False)
    index.append({"id": id, "name": m["name"], "description": m["description"], "intro": intro, "outro": outro})
json.dump({"name": "The Long Winter", "chapters": index}, open(f"{out}/index.json", "w"), indent=1, ensure_ascii=False)
print(len(index), "chapters")
