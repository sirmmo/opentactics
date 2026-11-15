# Holdings: cities and factories run in other games

With the **Linked holdings** option, an OpenTactics player can hand any city or
factory they own to a friend, who runs it in another game: a city in
[citysim](https://ingmmo.com/citysim/play/), a factory, airport or port in
[OpenFactor](https://ingmmo.com/openfactor/play/). How well the friend does sets
what that property pays (and, for factories, how cheap its units are).

Nothing goes through a server. Two links carry everything:

    OpenTactics ──#holding=…──▶ citysim / OpenFactor     (what to run)
    OpenTactics ◀──#report=…─── citysim / OpenFactor     (how it went)

Both links pack JSON the same way as OpenTactics' other links (`site/js/share.js`):
UTF-8 JSON, compressed with `deflate-raw`, base64url without padding, after
`#holding=` or `#report=`. A browser without `CompressionStream` writes
`#holdingjson=` / `#reportjson=` with the JSON uncompressed (still base64url).
Readers must accept both.

This document is the contract. Version 1.

## 1. The holding link (OpenTactics → the other game)

Made when the owner double-clicks one of their properties and picks **Develop**.
The URL is `<terrain.holding.url>#holding=<packed>`.

```json
{
  "v": 1,
  "kind": "city",                  // "city" (citysim) or "factory" (OpenFactor)
  "terrain": "city",               // OpenTactics terrain id: city, factory, airport, port
  "builds": [],                    // unit classes built there: [], ["ground"], ["air"], ["naval"]
  "game": "3f9a01c2",              // id of the OpenTactics game (stable for its whole life)
  "map": "Twin Rivers",
  "tile": [5, 3],
  "name": "Twin Rivers 5,3",       // a default name; the other game may let the player rename
  "owner": 0,                      // seat
  "army": "Red Star",              // faction name and colour, for flavour
  "color": "#d04040",
  "day": 7,                        // OpenTactics day when the link was made
  "pace": 3,                       // sim allowance per OpenTactics day (see 3)
  "around": ["..f~~", ".=c~~", "..=..", "f^...", "....."],
  "return": "https://ingmmo.com/opentactics/"
}
```

- `around` is the 5×5 neighbourhood centred on the tile, one string per row,
  using these letters (not the rule set's glyphs, so rule sets can't change them):
  `.` plain/beach, `f` forest, `^` mountain, `~` sea/reef, `=` road/bridge,
  `c` city, `F` factory/airport/port, `H` HQ, `#` off the map. The other game
  may use it to shape its starting land (water on the east, hills to the south…).
- The holding is identified by **`game` + `tile`**. The other game keeps its own
  save under that key and, when a newer link for the same key arrives, carries on
  from the save with the new `day` (and so a bigger allowance).

## 2. The report link (the other game → OpenTactics)

The friend presses **Report to OpenTactics**; the URL is
`<holding.return>#report=<packed>`.

```json
{
  "v": 1,
  "kind": "city",
  "game": "3f9a01c2",
  "tile": [5, 3],
  "owner": 0,
  "day": 7,                        // the `day` of the holding link this report answers
  "income_pct": 140,               // percent of the property's base income
  "discount_pct": 0,               // factories only: percent off units built there
  "name": "New Bologna",           // optional
  "summary": "Population 4,210, tax $380/month",   // one line, shown to the commander
  "stats": { "population": 4210 } // optional, free-form, shown in a tooltip
}
```

`income_pct` and `discount_pct` are whole numbers ≥ 0. Each game decides how its
results map to them (sections 4 and 5); **OpenTactics clamps them** (section 6),
so a game never needs to know the rule set's limits.

## 3. Pace: no fast-forwarding past the war

The other game may let the holding run for at most `day × pace` units of its own
time, counted from the start of that holding (not from the link):

| Game | Unit of `pace` | Default |
|---|---|---|
| citysim | months of city time | 3 |
| OpenFactor | minutes of factory time at normal speed (60 ticks/second → 3600 ticks/minute) | 10 |

At the limit the simulation pauses and says "Waiting for day N+1 in OpenTactics";
the player can still look, plan, build and report, but time does not move. This is
an honour system, like fog of war online.

## 4. citysim: income from the city

- Start a new city (or load the save for `game`+`tile`) named after `name`, shaped
  by `around` where the generator allows it.
- `income_pct = 50 + 100 × monthly tax revenue / 400`, rounded down: an empty
  town reports 50, a town making $400 a month reports 150. (Tuned in citysim.)
- `summary`: population and tax per month.

## 5. OpenFactor: a contract per factory

- Start (or load) a factory with a **contract**: a fresh puzzle on the `base`
  pack whose deliveries depend on `builds`: `ground` → gears and motors, `air` →
  circuits and controllers, `naval` → steel and plates, none → plates.
- `income_pct = 50 + 150 × (contract value delivered) / (contract value)`, capped
  by the contract at 200.
- `discount_pct = 25 × delivered / contract`, rounded down (a fulfilled contract
  is 25% off units built there).
- `summary`: what was delivered of what.
- Contract value weighs each item: iron plate 1, gear 2, steel 3, circuit 3,
  motor 10, controller 15 (in OpenFactor's `site/play/holding.js`). Contracts are
  ordinary untimed puzzles in `packs/base.gbx` (chapter "Contracts"); `around` is
  not used, since their maps come from the pack.

## 6. What OpenTactics does with a report

Opening a report link keeps the report in the browser; as soon as its game is on
screen (straight away if it already is) it goes in as the engine action

```json
{ "type": "report", "x": 5, "y": 3, "day": 7, "income_pct": 140, "discount_pct": 0, "name": "New Bologna", "summary": "…" }
```

for the seat in `owner`. It is refused unless: the option is on, the tile has a
`holding` definition, the seat still owns the tile, `day` ≤ today, and `day` is not
older than the last report for the tile. Otherwise the tile's holding becomes

    income   = clamp(terrain.income × income_pct / 100, holding.min, holding.max)
    discount = min(discount_pct, holding.discount)

The income is paid from the owner's next turn, in place of the terrain's income;
the discount takes that percentage off every unit built on that tile. When the tile
is captured the holding is cleared: the new owner gets the plain terrain income
until they report their own.

In the game, the owner double-clicks (double-taps) one of their properties to open
its panel: **Open in citysim / OpenFactor**, **Copy link for a friend**, and a box
to paste a report link that arrived some other way. The tile's info card shows the
holding's name, what it pays and the friend's summary.

The rule set says which terrains can be holdings, in `terrains[].holding`:

```json
"holding": { "kind": "city", "url": "https://ingmmo.com/citysim/play/", "pace": 3, "min": 500, "max": 2500 }
"holding": { "kind": "factory", "url": "https://ingmmo.com/openfactor/play/", "pace": 10, "min": 500, "max": 2000, "discount": 25 }
```

Reports are not signed: like fog of war online, it is an honour system among friends.
