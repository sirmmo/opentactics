# OpenTactics

A turn-based tactical skirmish game for the browser, in the style of the classic
handheld war games: square grid, cities that pay income, factories that build
units, capture the enemy headquarters or wipe out their army. Every player has the
same army and the same rules: an army in a rule set is only a name and a colour, and
the engine refuses rule sets that try to give one army anything more. Maps can be any
shape; they set the ground and the starting positions, not the rules.

- **Engine in Rust**, compiled to WebAssembly for the browser and native for the server.
- **Rules are data**: terrain, units, damage tables, money, capture, repair and victory
  conditions all come from one JSON file (`site/rules/*.json`).
- **Play** against the computer, take turns on one screen, or **online, browser to
  browser** (WebRTC). No game server is involved.
- **Map editor** with free (or optionally mirrored) painting, validation, save/download, publish, and test play.
- **Installable app**: on phones and desktops, install it from the menu (or Share →
  Add to Home Screen on iPhone/iPad). It runs full screen and plays offline against
  the computer; `site/sw.js` caches the game and every bundled map.
- **Remote maps**: play on any map hosted at a URL (`?map=https://…/map.json`); maps
  added by URL stay in your map list.

## Running

    ./build.sh                          # tests, WebAssembly client, server
    ./target/release/opentactics-server # http://localhost:8080/

Options: `--bind 0.0.0.0:8080`, `--site site`, `--maps maps-user` (where published
maps are stored), `--no-uploads`.

The `site/` folder (with `opentactics.wasm` copied in by `build.sh`) is a complete static
site. You can put it on any static host (GitHub Pages, a CDN, `python3 -m http.server`).
Everything works there except publishing maps, which needs the Rust server.

**Play online:** https://ingmmo.com/opentactics/. Each push to `main` runs
`.github/workflows/pages.yml`, which tests the engine, builds the wasm and deploys `site/`.

## Why 2D

The art is Kenney's *Tiny Battle* (16x16 pixel tiles), which was drawn for exactly
this kind of game: top-down terrain, buildings and units in four army colours. A
top-down 2D grid is also the clearest way to read ranges and movement in a tactics
game. The renderer lives in `site/js/art.js` and only reads the `view` fields of the
rule set. A 2.5D or 3D view could be added on top of the same engine later, for example
with three.js and the Kenney 3D kits; nothing in the engine would change.

## How it fits together

    crates/core     rules engine: rules.rs (the JSON schema), game.rs (state and actions), ai.rs
    crates/client   WebAssembly bridge: JSON in, JSON out (ot_alloc / ot_call / ot_free)
    crates/server   static files + map library (GET/PUT /api/maps)
    site/           the game: index.html, js/, rules/, maps/, assets/, vendor/peerjs
    tools/          make_maps.py + mapgen.py, which build the bundled maps

The engine is deterministic. `Game::apply(player, action)` either refuses an action
or returns the events it caused. The dice live in the game state, so the same state
and the same action always give the same result. The computer player
(`ai::next_action`) sees only what a human sees and goes through the same `apply`.

### Online play (peer to peer)

PeerJS (its free public broker) only introduces the browsers to each other. Game
messages then travel directly over a WebRTC data channel:

1. The host opens a room and gets a 5-letter code (`?join=CODE` links work too).
2. Guests join. Each fills the next seat marked "Online player".
3. When the match starts, the host sends the rule set and the full game state.
4. A guest sends its action to the host. The host's engine checks it and passes it
   to everyone with a fingerprint of the resulting state.
5. Every browser applies the action with its own engine and compares fingerprints.
   If they differ, it asks the host for a fresh copy.

Guests who drop can rejoin and get their seat back. The host can hand an empty seat
to the computer. Extra visitors watch. The host's browser is the referee, so it needs
to stay open. Browsers behind very strict NATs may need a TURN server; PeerJS accepts
one in its config.

## Rule sets

`site/rules/default.json` is the standard game. `blitz.json` changes only a few
numbers: start money, no luck, a 15-day limit. Fields:

| Section | Field | Meaning |
|---|---|---|
| `economy` | `start_funds`, `unit_cap` | money before turn 1; most units per player (0 = no limit) |
| `combat` | `luck`, `defense_per_star`, `counterattack` | random 0..luck added to damage; % removed per defence star (scaled by defender health); whether defenders shoot back |
| `capture` | `points` | a capturing unit adds its health (1-10) each turn |
| `repair` | `hp`, `costs` | health restored per turn on own property; whether it costs money |
| `victory` | `hq_capture`, `rout`, `day_limit` | win conditions; with a day limit, most properties wins |
| `factions[]` | `name`, `view.row/color/flip`, optional `view.recolor{from,to,light}` | one per seat, up to 8; `row` picks the colour row in the tile sheet (five colours), `recolor` turns the hue `from` into hue `to` in the browser to make more. Nothing else is allowed: no per-army bonuses |
| `terrains[]` | `id`, `glyph`, `defense`, `move_cost{type: cost}`, `capturable`, `hq`, `income`, `builds[]`, `repairs[]`, `view` | a missing movement type cannot enter |
| `units[]` | `id`, `class`, `move_type`, `moves`, `cost`, `range[min,max]`, `can_capture`, `flying`, `damage{unit: %}`, `view.tile` | range over 1 means it cannot move and fire in one turn |

Damage = (base + luck roll) × attacker health/10 × (100 − stars × defense_per_star ×
defender health/10)%.

## Maps

16 maps ship in `site/maps`: seven for two players, three for three, four for four
(including First Contact, River Line and Four Corners), Hexfall for six and Grand
Melee for eight. `python3 tools/make_maps.py site/maps` rebuilds them: the generator
cuts the map into one wedge per player, so everyone gets the same ground (exactly for
2, 4 and 8 players; as near as a square grid allows for 3 and 6, where it searches for
the most even layout). The engine tests play every map in `index.json` to the end.

A map is JSON: `name`, `width`, `height`, `players`, `tiles` (rows of terrain glyphs),
`owned` (`{x, y, player}` for starting property), `units` (`{type, x, y, player}`),
and optionally `start_funds` and `rules` (a URL for its rule set, relative to the map).
To play a specific map, open the game with `?map=<url of the map JSON>` (add `&host` to
host it online), or use **Add map from URL** on the setup screen. The setup screen
shows a shareable link for any map that lives at a URL. The host must allow
cross-origin requests (GitHub raw files and Pages do). Published maps appear in
everyone's map list.

## Licence

OpenTactics is free software under the GNU General Public License, version 3 or
later (see `LICENSE`). The bundled art, fonts and sounds keep their own licences.

## Credits

Art: [Tiny Battle](https://kenney.nl/assets/tiny-battle). Fonts: Kenney Fonts. Sounds:
[Interface Sounds](https://kenney.nl/assets/interface-sounds). All by Kenney, CC0.
Online play uses [PeerJS](https://peerjs.com) (MIT), vendored in `site/vendor`.
