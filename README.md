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
- **Up to 16 players**, and 36 maps from 12x10 duels to 64x64 wars for 16.
- **Optional rules, chosen at game start and the same for everyone**: fog of war, fuel
  and ammunition, weather, powers, teams, and **simultaneous turns**: players who cannot
  reach each other this round move at the same time (on by default above 8 players).
- **Sixteen units** including transports (carrier, airlift, lander) and a submarine
  that dives; damaged units of the same kind can join.
- **Computer opponents** at three skill levels (Easy, Normal, Hard) and four styles
  (Balanced, Rusher, Turtle, Economist).
- **Missions**: four tutorial missions and four challenges with their own goals.
- **Campaign**: "The Long Winter", five chapters with a story; veteran ranks (an option
  in any game) let your best survivors carry on, stronger, into the next chapter.
- **Play by link**: no need to be online together. Seats can be a "Friend, by link":
  when it is their turn you get a link (or a file) with the whole game; they open it,
  play, and send a link on. Replays can be shared as links too. Nothing goes to a server.
- **Linked holdings** (an option): double-click a city or factory you own and hand it
  to a friend who would rather build than fight. They run the city in
  [citysim](https://ingmmo.com/citysim/play/) or the factory in
  [OpenFactor](https://ingmmo.com/openfactor/play/) and send back a report link; how
  well they do sets what that property pays (and, for factories, how cheap its units
  are), within limits the rule set sets. See [HOLDINGS.md](HOLDINGS.md).
- **Single player comforts**: autosave and Continue, Undo (your actions this turn) and
  Hint (the hard computer suggests a move).
- **Replays and stats**: every game can be watched again, saved as a file or opened
  from a link (`?replay=URL`); the end screen charts army, property and income by day.
- **Pings and plans**: mark tiles ("Attack here", "Help!", "Going here", "Watch out") and
  draw arrows that only your allies see (online, the host passes them to allies only).
- **Online extras**: watchers, chat and emotes (also private), a turn timer, rejoining
  after a dropout, and resuming a hosted game after the host's page reloads.
- **Game modes**: King of the hill, Battle royale (a closing storm), Survival (co-op
  against waves), Score race; and **diplomacy**: alliances and truces mid-game.
- **Terrain to fight over**: comms towers (+10% damage each), beaches, reefs.
- **Big maps**: minimap, drag and pinch to pan and zoom, "next unit", a warning
  before ending a turn with idle units; computer players think in a Web Worker.
- **Atmosphere**: battle sounds and chiptune music made with Web Audio; rain, snow and
  water animation.
- **Accessibility**: army symbols (16 shapes), a choice of font (pixel, standard, or
  dyslexia-friendly OpenDyslexic), text size, reduce motion, keyboard and gamepad play,
  hold-to-inspect on touch screens.
- **Editors**: a random map generator and a mission editor in the map editor; a rules
  editor whose rule sets can be shared as links (`#rules=…`).
- **Languages**: English and Italian (automatic, or chosen in Settings).
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

**Play online:** https://ingmmo.com/opentactics/ and https://sirmmo.itch.io/opentactics.
Each push to `main` runs `.github/workflows/pages.yml`, which tests the engine, builds the
wasm, deploys `site/` to GitHub Pages, and uploads the same files to itch.io with butler
(channel `html5`; needs the `BUTLER_API_KEY` repository secret).

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

Guests who drop keep retrying for about ten minutes and get their seat back, with the
whole move record. The host can hand an empty seat to the computer. Visitors can join
just to watch, and everyone can chat. The host can set a turn timer and ends turns that
run out. The host's browser is the referee and keeps the game in local storage: if it
reloads, **Resume hosting** on the main menu reopens the same room. With fog of war,
each browser only shows its own side, but every browser holds the whole game, so fog is
an honour system online. Browsers behind very strict NATs may need a TURN server; PeerJS accepts
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
| `factions[]` | `name`, `view.row/color/flip`, optional `view.recolor{from,to,light}` | one per seat, up to 16; `row` picks the colour row in the tile sheet (five colours), `recolor` turns the hue `from` into hue `to` in the browser to make more. Nothing else is allowed: no per-army bonuses |
| `terrains[]` | `id`, `glyph`, `defense`, `move_cost{type: cost}`, `capturable`, `hq`, `income`, `builds[]`, `repairs[]`, `view` | a missing movement type cannot enter |
| `units[]` | `id`, `class`, `move_type`, `moves`, `cost`, `range[min,max]`, `can_capture`, `flying`, `damage{unit: %}`, `view.tile`, `view.mark` | range over 1 means it cannot move and fire in one turn; `mark` is a letter for units that share a picture |
| | `vision` | tiles seen with fog of war (default 2) |
| | `carry[]`, `capacity`, `supplies` | unit ids it can carry and how many; refills neighbours |
| | `fuel`, `fuel_per_day`, `ammo` | with supply rules: fuel per movement point, burnt daily (lost at 0), rounds |
| | `can_dive`, `dive_fuel`, `detects_dived` | diving hides a unit from enemies not next to it; only detectors hit it |
| `terrains[]` | `hides`, `vision_bonus{type: n}` | with fog: units here seen only from next door; extra sight |
| `weather[]` | `id`, `name`, `chance`, `move_extra{type: n}`, `vision` | the first is clear skies |
| `terrains[]` | `holding{kind, url, pace, min, max, discount}` | with linked holdings: run this property in another game (`kind` "city" or "factory"); reports set its income between `min` and `max` and take up to `discount`% off units built here ([HOLDINGS.md](HOLDINGS.md)) |
| `powers[]` | `id`, `name`, `charge`, `effects[]` | effects: `attack`/`defense` (percent), `move`/`vision` (tiles), `heal` (hp), `funds`, `resupply`; charge is the value of damage dealt, plus half of damage taken |

Damage = (base + luck roll) × attacker health/10 × (100 − stars × defense_per_star ×
defender health/10)%.

## Maps

36 maps ship in `site/maps`, for 2, 3, 4, 5, 6, 8, 9, 10, 12 and 16 players, from
12x10 to 64x64. `python3 tools/make_maps.py site/maps` rebuilds them: the generator
cuts the map into one wedge per player, so everyone gets the same ground. That is exact
for 2, 4 and 8 players; for other counts it searches for the most even layout, and on
big maps tops up any player short of nearby property with extra neutral cities. The
engine tests play every map in `index.json` to the end, with and without every option.

### Simultaneous turns

With "Far players move at once", each round the engine works out every waiting
player's zone: their property, everywhere their units (and passengers) could move this
round, widened by how far they could shoot, plus a tile. The next waiting player
starts, together with every other waiting player whose zone touches none of the
group's (teammates always join). Nobody in a group can affect anybody else in it
before their turns end, so the order of their actions does not matter to them. Online,
the host still puts every action in one order, which keeps all browsers in step and
replays exact. Each player still plays exactly once a day.

A map is JSON: `name`, `width`, `height`, `players`, `tiles` (rows of terrain glyphs),
`owned` (`{x, y, player}` for starting property), `units` (`{type, x, y, player}`),
and optionally `start_funds` and `rules` (a URL for its rule set, relative to the map).
To play a specific map, open the game with `?map=<url of the map JSON>` (add `&host` to
host it online), or use **Add map from URL** on the setup screen. The setup screen
shows a shareable link for any map that lives at a URL. The host must allow
cross-origin requests (GitHub raw files and Pages do). Published maps appear in
everyone's map list.

## Missions

`site/missions` (built by `tools/make_missions.py`) holds maps with a `mission` block:
`briefing`, `player` (the seat you play), `goals` (any one wins) and `fail` (any one
loses) from `capture{x,y}`, `lose_tile{x,y}`, `day{day}`, `no_enemy_units`, `no_units`,
`unit_gone{tag}`, `unit_at{tag,x,y}`; optional `options` (fog, supply…), `teams`,
`hints[{day,text}]` and `ai.profile{level,style}`. Map units may carry a `tag`, `hp`,
`fuel` and `ammo`.

## Online service (optional)

`worker/` is a small Cloudflare Worker: a list of public rooms (hosts refresh theirs;
entries expire after two minutes), a community map gallery, and short-lived TURN relay
credentials for players on strict networks. Games still run browser to browser; the
service only helps people find each other and share maps. Point the game at it with
`site/cloud.json` (`{ "api": "https://…workers.dev" }`); with no address, the Join
screen's open rooms, "List this room publicly", community maps and the editor's Share
button stay hidden.

    cd worker
    npx wrangler kv namespace create OT      # put the id in wrangler.toml
    npx wrangler deploy
    npx wrangler secret put TURN_KEY_ID      # optional: a TURN key from Realtime
    npx wrangler secret put TURN_KEY_TOKEN

## Translations

`site/js/i18n.js` translates the page as it appears: an exact dictionary, plus
patterns for sentences with names and numbers (names inside them are translated
too), dialogs and the engine's messages. To add a language, add a table like `IT`.

## Licence

OpenTactics is free software under the GNU General Public License, version 3 or
later (see `LICENSE`). The bundled art, fonts and sounds keep their own licences.

## Credits

Art: [Tiny Battle](https://kenney.nl/assets/tiny-battle). Fonts: Kenney Fonts. Sounds:
[Interface Sounds](https://kenney.nl/assets/interface-sounds). All by Kenney, CC0.
Online play uses [PeerJS](https://peerjs.com) (MIT), vendored in `site/vendor`. The
dyslexia-friendly font is [OpenDyslexic](https://opendyslexic.org) by Abbie Gonzalez
(SIL Open Font License, `site/assets/opendyslexic-LICENSE.txt`).
