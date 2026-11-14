//! Game state and the rules that change it.
//!
//! The only way to change a game is `Game::apply(player, action)`. It either
//! refuses the action or returns the events that happened, in order, so a
//! client can animate them. Given the same state and action the result is
//! always the same: the dice are part of the state.
//!
//! Some rules are switched on per game (`Options`): fog of war, fuel and
//! ammunition, weather, powers and teams. They are the same for every player.

use crate::rules::{Effect, Goal, MapDef, Mission, Rules, MAX_MAP_SIDE};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub const NO_OWNER: i8 = -1;
pub const UNREACHABLE: u32 = u32::MAX;
const FULL_HP: u32 = 100;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Unit {
    pub id: u32,
    /// Index into `Rules::units`.
    pub kind: usize,
    pub player: usize,
    pub x: i32,
    pub y: i32,
    /// 1-100. Players see it as 1-10, rounded up.
    pub hp: u32,
    /// Has acted this turn.
    pub moved: bool,
    /// Capture points this unit has built up on the tile it stands on.
    pub capture: u32,
    /// Fuel and ammunition left (only used with supply rules).
    #[serde(default)]
    pub fuel: u32,
    #[serde(default)]
    pub ammo: u32,
    /// Hidden under water.
    #[serde(default, skip_serializing_if = "is_false")]
    pub dived: bool,
    /// Units being carried. They are not on the board.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cargo: Vec<Unit>,
    /// A name missions refer to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Experience (veteran ranks).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub xp: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl Unit {
    /// Health as shown to players, 1-10.
    pub fn health(&self) -> u32 {
        self.hp.div_ceil(10)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Player {
    pub funds: u32,
    pub alive: bool,
    /// Players on the same team are allies. Missing means a team of one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<usize>,
    /// Power charge, and the power in use until the start of the player's next turn.
    #[serde(default)]
    pub charge: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power: Option<usize>,
}

/// Rules switched on for one game. Every player plays with the same ones.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Options {
    /// Only what your side's units and property can see is shown.
    #[serde(default)]
    pub fog: bool,
    /// Fuel and ammunition run out and must be refilled.
    #[serde(default)]
    pub supply: bool,
    /// "" or "off", "random", or the id of one kind of weather for the whole game.
    #[serde(default)]
    pub weather: String,
    /// Players charge up and use powers.
    #[serde(default)]
    pub powers: bool,
    /// Team of each seat; empty means everyone for themselves.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub teams: Vec<usize>,
    /// Players who cannot reach each other this round take their turns at the
    /// same time (and teammates always do).
    #[serde(default)]
    pub simultaneous: bool,
    /// How the game is won (besides the usual ways).
    #[serde(default)]
    pub mode: Mode,
    /// Players may offer each other alliances and truces during the game.
    #[serde(default)]
    pub diplomacy: bool,
    /// Units earn veteran ranks by fighting.
    #[serde(default)]
    pub ranks: bool,
}

fn three() -> u32 {
    3
}
fn five() -> u32 {
    5
}
fn fifteen() -> u32 {
    15
}
fn twenty() -> u32 {
    20
}
fn two_u() -> u32 {
    2
}

/// Ways to play besides "last side standing" (which always applies too).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Standard,
    /// A side holding the hill (the marked middle tile) with a unit at the start
    /// of `days` days in a row wins.
    KingOfTheHill {
        #[serde(default = "three")]
        days: u32,
    },
    /// From day `start`, a storm closes in on the middle; every `every` days it
    /// shrinks, and units outside lose `damage` health (out of 10) each turn.
    BattleRoyale {
        #[serde(default = "five")]
        start: u32,
        #[serde(default = "two_u")]
        every: u32,
        #[serde(default = "two_u")]
        damage: u32,
    },
    /// The `invaders` seats get free waves of units every `every` days; everyone
    /// else is one team that wins by lasting until day `days`.
    Survival {
        #[serde(default = "fifteen")]
        days: u32,
        #[serde(default = "two_u")]
        every: u32,
        #[serde(default)]
        invaders: Vec<usize>,
    },
    /// After `days` days the side with the most property wins.
    ScoreRace {
        #[serde(default = "twenty")]
        days: u32,
    },
}

/// An agreement one player offers another.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Pact {
    /// Join teams: share vision, never fight, win together.
    Alliance,
    /// No attacks or captures between the two for some days.
    Truce { days: u32 },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Offer {
    pub from: usize,
    pub to: usize,
    pub pact: Pact,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Truce {
    pub a: usize,
    pub b: usize,
    /// The truce holds until this day begins.
    pub until: u32,
}

/// Everything that changes during a game. With the rule set, this is the whole game.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub name: String,
    pub width: i32,
    pub height: i32,
    /// Index into `Rules::terrains` for each tile, row by row.
    pub terrain: Vec<u8>,
    /// Owning player of each tile, or -1.
    pub owner: Vec<i8>,
    pub units: Vec<Unit>,
    pub players: Vec<Player>,
    /// Whose turn it is: the first of `active`.
    pub turn: usize,
    /// Everyone taking their turn right now (more than one with simultaneous turns).
    #[serde(default)]
    pub active: Vec<usize>,
    /// Players still to play today, in seat order.
    #[serde(default)]
    pub waiting: Vec<usize>,
    pub day: u32,
    pub over: bool,
    /// Set when the game is over, unless it was a draw: one of the winners.
    pub winner: Option<usize>,
    /// Every player on the winning side.
    #[serde(default)]
    pub winners: Vec<usize>,
    pub rng: u64,
    pub next_id: u32,
    #[serde(default)]
    pub options: Options,
    /// Index into `Rules::weather` (0, clear, when there is none).
    #[serde(default)]
    pub weather: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<Mission>,
    /// King of the hill: the hill tile, and the side holding it with how many days.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hill: Option<[i32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<[u32; 2]>,
    /// Battle royale: the safe circle's radius in tiles (none before the storm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storm: Option<f32>,
    /// Diplomacy: open offers and running truces.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub offers: Vec<Offer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub truces: Vec<Truce>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// Move a unit (possibly nowhere) and then do something.
    Move {
        unit: u32,
        x: i32,
        y: i32,
        #[serde(default)]
        then: Then,
    },
    Build {
        x: i32,
        y: i32,
        unit: String,
    },
    /// Use a power from the rule set's list.
    Power {
        power: String,
    },
    /// Diplomacy, allowed at any time: offer a pact, answer one, or leave an alliance.
    Offer {
        to: usize,
        pact: Pact,
    },
    Accept {
        from: usize,
    },
    Decline {
        from: usize,
    },
    LeaveAlliance,
    EndTurn,
    Resign,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Then {
    #[default]
    Wait,
    Capture,
    /// The id of the unit to attack.
    Attack(u32),
    /// Get into the friendly transport on the destination tile.
    Load,
    /// Merge into the damaged friendly unit of the same kind on the destination tile.
    Join,
    /// Let carried units out onto tiles next to the destination.
    Unload(Vec<Drop>),
    Dive,
    Surface,
    /// Refill the fuel and ammunition of friendly units next to the destination.
    Supply,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Drop {
    pub unit: u32,
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "e", rename_all = "snake_case")]
pub enum Event {
    Move { unit: u32, path: Vec<[i32; 2]> },
    /// A move ran into a hidden enemy at `(x, y)` and stopped short.
    Trapped { unit: u32, x: i32, y: i32 },
    /// `hp` is what the defender has left. `counter` marks the shot fired back.
    Attack { attacker: u32, defender: u32, damage: u32, hp: u32, counter: bool },
    Destroy { unit: u32, x: i32, y: i32 },
    Capture { unit: u32, x: i32, y: i32, progress: u32, needed: u32, done: bool },
    Build { unit: Unit },
    Repair { unit: u32, hp: u32 },
    Load { unit: u32, into: u32 },
    Unload { unit: Unit, from: u32 },
    Join { unit: u32, into: u32, hp: u32, refund: u32 },
    Dive { unit: u32, dived: bool },
    Supply { unit: u32, units: Vec<u32> },
    /// Out of fuel.
    Crash { unit: u32, x: i32, y: i32 },
    Weather { weather: usize },
    /// King of the hill: who holds it and for how many days (none: nobody).
    Hill { team: Option<usize>, days: u32 },
    /// Battle royale: the safe circle shrank.
    Storm { radius: f32 },
    /// A unit caught in the storm.
    Storming { unit: u32, damage: u32, hp: u32 },
    /// Survival: a wave of units appears.
    Spawn { unit: Unit },
    /// Diplomacy: what happened between two players ("offer", "accept", "decline", "leave", "truce_over").
    Pact { what: String, from: usize, to: usize, pact: Option<Pact> },
    Power { player: usize, power: usize },
    Turn { player: usize, day: u32, income: u32 },
    Defeat { player: usize },
    Over { winner: Option<usize>, winners: Vec<usize> },
}

/// One thing a unit could shoot from a given tile.
#[derive(Clone, Debug, Serialize)]
pub struct Target {
    pub unit: u32,
    pub x: i32,
    pub y: i32,
    /// Damage in percent of full health, before and after the best luck.
    pub min: u32,
    pub max: u32,
    /// Damage expected back, in percent.
    pub counter: u32,
}

/// Result of a movement search.
pub struct Reach {
    pub width: i32,
    /// Cost to reach each tile, or `UNREACHABLE`.
    pub dist: Vec<u32>,
    pub prev: Vec<usize>,
}

impl Reach {
    pub fn cost(&self, x: i32, y: i32) -> u32 {
        self.dist[(y * self.width + x) as usize]
    }

    /// Tiles from the start to `(x, y)`, both included.
    pub fn path(&self, x: i32, y: i32) -> Vec<[i32; 2]> {
        let mut at = (y * self.width + x) as usize;
        let mut path = vec![];
        if self.dist[at] == UNREACHABLE {
            return path;
        }
        loop {
            path.push([at as i32 % self.width, at as i32 / self.width]);
            if self.prev[at] == at {
                break;
            }
            at = self.prev[at];
        }
        path.reverse();
        path
    }
}

/// How a game is set up besides the map: switched-on rules and teams.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Setup {
    #[serde(default)]
    pub options: Options,
}

#[derive(Clone)]
pub struct Game {
    pub rules: Rules,
    pub s: State,
    /// `cost[unit kind][terrain]`, 0 for "cannot enter".
    cost: Vec<Vec<u32>>,
    /// `dmg[attacker kind][defender kind]`, 0 for "cannot attack".
    dmg: Vec<Vec<u32>>,
}

const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

fn distance(ax: i32, ay: i32, bx: i32, by: i32) -> u32 {
    ((ax - bx).abs() + (ay - by).abs()) as u32
}

impl Game {
    pub fn new(rules: Rules, map: &MapDef, seed: u64) -> Result<Game, String> {
        Game::with_setup(rules, map, seed, Setup::default())
    }

    pub fn with_setup(rules: Rules, map: &MapDef, seed: u64, setup: Setup) -> Result<Game, String> {
        rules.check()?;
        let (w, h) = (map.width, map.height);
        if !(4..=MAX_MAP_SIDE).contains(&w) || !(4..=MAX_MAP_SIDE).contains(&h) {
            return Err(format!("map: each side must be 4 to {MAX_MAP_SIDE} tiles"));
        }
        if map.players < 2 || map.players > rules.factions.len() {
            return Err(format!(
                "map: needs 2 to {} players, has {}",
                rules.factions.len(),
                map.players
            ));
        }
        if map.tiles.len() != h {
            return Err(format!("map: has {} rows, expected {h}", map.tiles.len()));
        }
        let mut terrain = Vec::with_capacity(w * h);
        for (y, row) in map.tiles.iter().enumerate() {
            let before = terrain.len();
            for glyph in row.chars() {
                let t = rules
                    .terrain_by_glyph(glyph)
                    .ok_or_else(|| format!("map: row {y} uses unknown terrain '{glyph}'"))?;
                terrain.push(t as u8);
            }
            if terrain.len() - before != w {
                return Err(format!("map: row {y} is {} wide, expected {w}", terrain.len() - before));
            }
        }
        let mut owner = vec![NO_OWNER; w * h];
        let mut present = vec![false; map.players];
        for o in &map.owned {
            if o.x >= w || o.y >= h || o.player >= map.players {
                return Err(format!("map: owned tile {},{} is off the map or has a bad player", o.x, o.y));
            }
            let i = o.y * w + o.x;
            if !rules.terrains[terrain[i] as usize].capturable {
                return Err(format!("map: tile {},{} cannot be owned", o.x, o.y));
            }
            owner[i] = o.player as i8;
            present[o.player] = true;
        }

        // A mission fixes its own options and teams.
        let mut options = setup.options;
        if let Some(m) = &map.mission {
            if m.player >= map.players {
                return Err("map: the mission's player seat is not on the map".into());
            }
            if let Some(o) = &m.options {
                options = serde_json::from_value(o.clone()).map_err(|e| format!("map: mission options: {e}"))?;
            }
            if !m.teams.is_empty() {
                options.teams = m.teams.clone();
            }
        }
        // Survival is everyone against the invaders.
        if let Mode::Survival { invaders, .. } = &options.mode {
            if invaders.is_empty() || invaders.len() >= map.players || invaders.iter().any(|p| *p >= map.players) {
                return Err("setup: survival needs some invader seats and some defenders".into());
            }
            options.teams = (0..map.players).map(|p| usize::from(invaders.contains(&p))).collect();
        }
        if !options.teams.is_empty() && options.teams.len() != map.players {
            return Err("setup: give a team for every seat, or none".into());
        }
        let weather_fixed = match options.weather.as_str() {
            "" | "off" | "random" => None,
            id => Some(rules.weather_by_id(id).ok_or_else(|| format!("setup: no weather called '{id}'"))?),
        };

        let players = (0..map.players)
            .map(|p| Player {
                funds: map.start_funds.unwrap_or(rules.economy.start_funds),
                alive: true,
                team: options.teams.get(p).copied(),
                charge: 0,
                power: None,
            })
            .collect();
        let mut game = Game {
            cost: vec![],
            dmg: vec![],
            s: State {
                name: map.name.clone(),
                width: w as i32,
                height: h as i32,
                terrain,
                owner,
                units: vec![],
                players,
                turn: 0,
                active: vec![],
                waiting: (0..map.players).collect(),
                day: 1,
                over: false,
                winner: None,
                winners: vec![],
                rng: seed | 1,
                next_id: 1,
                options,
                weather: weather_fixed.unwrap_or(0),
                mission: map.mission.clone(),
                hill: None,
                hold: None,
                storm: None,
                offers: vec![],
                truces: vec![],
            },
            rules,
        };
        game.index();
        if matches!(game.s.options.mode, Mode::KingOfTheHill { .. }) {
            game.s.hill = Some(game.find_hill().ok_or("map: no land in the middle for a hill")?);
        }
        for u in &map.units {
            let kind = game
                .rules
                .unit_by_id(&u.kind)
                .ok_or_else(|| format!("map: unknown unit type '{}'", u.kind))?;
            if u.x >= w || u.y >= h || u.player >= map.players {
                return Err(format!("map: unit at {},{} is off the map or has a bad player", u.x, u.y));
            }
            let (x, y) = (u.x as i32, u.y as i32);
            if game.unit_at(x, y).is_some() {
                return Err(format!("map: two units share tile {x},{y}"));
            }
            if game.cost[kind][game.s.terrain[game.at(x, y)] as usize] == 0 {
                return Err(format!("map: a {} cannot stand on tile {x},{y}", u.kind));
            }
            let mut unit = game.fresh_unit(kind, u.player, x, y);
            unit.hp = u.hp.unwrap_or(FULL_HP).clamp(1, FULL_HP);
            unit.tag = u.tag.clone();
            unit.xp = u.xp.unwrap_or(0);
            unit.fuel = u.fuel.map_or(unit.fuel, |f| f.min(unit.fuel));
            unit.ammo = u.ammo.map_or(unit.ammo, |a| a.min(unit.ammo));
            game.s.units.push(unit);
            present[u.player] = true;
        }
        if let Some(p) = present.iter().position(|p| !p) {
            return Err(format!("map: player {} starts with no property and no unit", p + 1));
        }
        let mut events = vec![];
        if game.s.options.weather == "random" {
            game.roll_weather(&mut events);
        }
        game.next_group(&mut events);
        Ok(game)
    }

    /// Rebuild a game from a saved or received state.
    pub fn from_state(rules: Rules, s: State) -> Result<Game, String> {
        rules.check()?;
        let n = (s.width.max(0) as usize) * (s.height.max(0) as usize);
        if s.width < 1 || s.height < 1 || s.terrain.len() != n || s.owner.len() != n {
            return Err("state: the map size does not match its tiles".into());
        }
        if s.terrain.iter().any(|t| *t as usize >= rules.terrains.len()) {
            return Err("state: unknown terrain".into());
        }
        if s.players.len() < 2 || s.players.len() > rules.factions.len() || s.turn >= s.players.len() {
            return Err("state: bad player list".into());
        }
        if s.owner.iter().any(|o| *o < NO_OWNER || *o >= s.players.len() as i8) {
            return Err("state: bad owner".into());
        }
        if s.weather > 0 && s.weather >= rules.weather.len() {
            return Err("state: unknown weather".into());
        }
        if s.players.iter().any(|p| p.power.is_some_and(|i| i >= rules.powers.len())) {
            return Err("state: unknown power".into());
        }
        fn bad(u: &Unit, s: &State, rules: &Rules, depth: u32) -> bool {
            u.kind >= rules.units.len()
                || u.player >= s.players.len()
                || u.x < 0
                || u.y < 0
                || u.x >= s.width
                || u.y >= s.height
                || u.hp == 0
                || u.hp > FULL_HP
                || (depth > 0 && !u.cargo.is_empty())
                || u.cargo.iter().any(|c| bad(c, s, rules, depth + 1))
        }
        if s.units.iter().any(|u| bad(u, &s, &rules, 0)) {
            return Err("state: bad unit".into());
        }
        let mut game = Game { rules, s, cost: vec![], dmg: vec![] };
        game.index();
        // Saves from before simultaneous turns: one player at a time.
        if game.s.active.is_empty() && !game.s.over {
            let (t, n) = (game.s.turn, game.s.players.len());
            game.s.active = vec![t];
            game.s.waiting = (t + 1..n).filter(|p| game.s.players[*p].alive).collect();
        }
        if game.s.active.iter().chain(game.s.waiting.iter()).any(|p| *p >= game.s.players.len()) {
            return Err("state: bad turn order".into());
        }
        Ok(game)
    }

    /// Turn the rule set's name-keyed tables into index-keyed ones.
    fn index(&mut self) {
        let r = &self.rules;
        self.cost = r
            .units
            .iter()
            .map(|u| r.terrains.iter().map(|t| t.move_cost.get(&u.move_type).copied().unwrap_or(0)).collect())
            .collect();
        self.dmg = r
            .units
            .iter()
            .map(|a| r.units.iter().map(|d| a.damage.get(&d.id).copied().unwrap_or(0)).collect())
            .collect();
    }

    fn fresh_unit(&mut self, kind: usize, player: usize, x: i32, y: i32) -> Unit {
        let def = &self.rules.units[kind];
        let id = self.s.next_id;
        self.s.next_id += 1;
        Unit {
            id,
            kind,
            player,
            x,
            y,
            hp: FULL_HP,
            moved: false,
            capture: 0,
            fuel: def.fuel,
            ammo: def.ammo,
            dived: false,
            cargo: vec![],
            tag: None,
            xp: 0,
        }
    }

    // ---- looking at the board -------------------------------------------

    pub fn at(&self, x: i32, y: i32) -> usize {
        (y * self.s.width + x) as usize
    }

    pub fn inside(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.s.width && y < self.s.height
    }

    pub fn terrain(&self, x: i32, y: i32) -> &crate::rules::Terrain {
        &self.rules.terrains[self.s.terrain[self.at(x, y)] as usize]
    }

    pub fn owner(&self, x: i32, y: i32) -> Option<usize> {
        let o = self.s.owner[self.at(x, y)];
        (o >= 0).then_some(o as usize)
    }

    /// A unit on the board (not one being carried).
    pub fn unit(&self, id: u32) -> Option<&Unit> {
        self.s.units.iter().find(|u| u.id == id)
    }

    pub fn unit_at(&self, x: i32, y: i32) -> Option<&Unit> {
        self.s.units.iter().find(|u| u.x == x && u.y == y)
    }

    pub fn def(&self, unit: &Unit) -> &crate::rules::UnitDef {
        &self.rules.units[unit.kind]
    }

    /// Base damage of one unit kind against another; 0 means it cannot attack it.
    pub fn base_damage(&self, attacker: usize, defender: usize) -> u32 {
        self.dmg[attacker][defender]
    }

    /// Cost for a unit kind to enter a tile, with today's weather; 0 means it cannot.
    pub fn move_cost(&self, kind: usize, x: i32, y: i32) -> u32 {
        self.step_cost(kind, self.at(x, y))
    }

    fn step_cost(&self, kind: usize, i: usize) -> u32 {
        let base = self.cost[kind][self.s.terrain[i] as usize];
        if base == 0 {
            return 0;
        }
        match self.weather() {
            Some(w) => base + w.move_extra.get(&self.rules.units[kind].move_type).copied().unwrap_or(0),
            None => base,
        }
    }

    /// Today's weather, if it is not clear.
    pub fn weather(&self) -> Option<&crate::rules::WeatherDef> {
        if self.s.weather == 0 {
            None
        } else {
            self.rules.weather.get(self.s.weather)
        }
    }

    /// Every unit a player has, carried ones included.
    pub fn unit_count(&self, player: usize) -> usize {
        self.s.units.iter().filter(|u| u.player == player).map(|u| 1 + u.cargo.len()).sum()
    }

    pub fn income(&self, player: usize) -> u32 {
        (0..self.s.owner.len())
            .filter(|i| self.s.owner[*i] == player as i8)
            .map(|i| self.rules.terrains[self.s.terrain[i] as usize].income)
            .sum()
    }

    pub fn team(&self, player: usize) -> usize {
        // Teams of one get numbers no shared team uses.
        self.s.players[player].team.unwrap_or(1000 + player)
    }

    pub fn allied(&self, a: usize, b: usize) -> bool {
        a == b || self.team(a) == self.team(b)
    }

    // ---- powers -----------------------------------------------------------

    fn effects(&self, player: usize) -> &[Effect] {
        match self.s.players[player].power {
            Some(i) if self.s.options.powers => &self.rules.powers[i].effects,
            _ => &[],
        }
    }

    fn bonus(&self, player: usize, pick: impl Fn(&Effect) -> Option<u32>) -> u32 {
        self.effects(player).iter().filter_map(pick).sum()
    }

    fn attack_bonus(&self, player: usize) -> u32 {
        self.bonus(player, |e| if let Effect::Attack { percent } = e { Some(*percent) } else { None })
    }

    fn defense_bonus(&self, player: usize) -> u32 {
        self.bonus(player, |e| if let Effect::Defense { percent } = e { Some(*percent) } else { None })
    }

    fn move_bonus(&self, player: usize) -> u32 {
        self.bonus(player, |e| if let Effect::Move { tiles } = e { Some(*tiles) } else { None })
    }

    fn vision_bonus(&self, player: usize) -> u32 {
        self.bonus(player, |e| if let Effect::Vision { tiles } = e { Some(*tiles) } else { None })
    }

    /// Extra damage, in percent, from the property a player owns (comms towers).
    pub fn tower_bonus(&self, player: usize) -> u32 {
        self.s
            .owner
            .iter()
            .enumerate()
            .filter(|(_, o)| **o == player as i8)
            .map(|(i, _)| self.rules.terrains[self.s.terrain[i] as usize].attack_bonus)
            .sum()
    }

    /// The most charge anyone can hold: enough for the dearest power.
    fn charge_cap(&self) -> u32 {
        self.rules.powers.iter().map(|p| p.charge).max().unwrap_or(0)
    }

    // ---- what each side can see --------------------------------------------

    /// Tiles `viewer`'s side can see. Without fog of war, all of them.
    pub fn sight(&self, viewer: usize) -> Vec<bool> {
        let n = self.s.terrain.len();
        if !self.s.options.fog {
            return vec![true; n];
        }
        let mut seen = vec![false; n];
        let delta = self.weather().map_or(0, |w| w.vision);
        for u in &self.s.units {
            if !self.allied(u.player, viewer) {
                continue;
            }
            let def = self.def(u);
            let bonus = self.terrain(u.x, u.y).vision_bonus.get(&def.move_type).copied().unwrap_or(0);
            let r = (def.vision as i32 + bonus as i32 + self.vision_bonus(u.player) as i32 + delta).max(1);
            for dy in -r..=r {
                let span = r - dy.abs();
                for dx in -span..=span {
                    if self.inside(u.x + dx, u.y + dy) {
                        seen[self.at(u.x + dx, u.y + dy)] = true;
                    }
                }
            }
        }
        for (i, o) in self.s.owner.iter().enumerate() {
            if *o >= 0 && self.allied(*o as usize, viewer) {
                seen[i] = true;
            }
        }
        seen
    }

    fn next_to_side(&self, viewer: usize, x: i32, y: i32) -> bool {
        self.s.units.iter().any(|o| self.allied(o.player, viewer) && distance(o.x, o.y, x, y) == 1)
    }

    /// Whether `viewer`'s side can see unit `u`, given the tiles it sees.
    pub fn sees(&self, viewer: usize, u: &Unit, sight: &[bool]) -> bool {
        if self.allied(u.player, viewer) {
            return true;
        }
        if u.dived && !self.next_to_side(viewer, u.x, u.y) {
            return false;
        }
        if !self.s.options.fog {
            return true;
        }
        if !sight[self.at(u.x, u.y)] {
            return false;
        }
        !self.terrain(u.x, u.y).hides || self.next_to_side(viewer, u.x, u.y)
    }

    /// The game as `viewer`'s side knows it: hidden enemies (and what enemy
    /// transports carry) are left out. Also returns the tiles that side sees.
    pub fn view(&self, viewer: usize) -> (State, Vec<bool>) {
        let sight = self.sight(viewer);
        let mut s = self.s.clone();
        s.units.retain(|u| self.sees(viewer, u, &sight));
        for u in s.units.iter_mut() {
            if !self.allied(u.player, viewer) {
                u.cargo.clear();
            }
        }
        (s, sight)
    }

    /// The same game with hidden enemies taken off the board, for planning.
    pub fn as_seen_by(&self, viewer: usize) -> Game {
        let mut g = self.clone();
        g.s = self.view(viewer).0;
        g
    }

    // ---- movement ---------------------------------------------------------

    /// Where a unit of `kind` owned by `player` can get to from `(x, y)` with
    /// `budget` movement points. Enemy units the player can see block the way
    /// unless `ghost` is set, which plans a route as if the board were empty.
    pub fn search(&self, kind: usize, player: usize, x: i32, y: i32, budget: u32, ghost: bool) -> Reach {
        let n = self.s.terrain.len();
        let mut blocked = vec![false; n];
        if !ghost {
            let sight = self.sight(player);
            for u in &self.s.units {
                if !self.allied(u.player, player) && self.sees(player, u, &sight) {
                    blocked[self.at(u.x, u.y)] = true;
                }
            }
        }
        let mut dist = vec![UNREACHABLE; n];
        let mut prev: Vec<usize> = (0..n).collect();
        let start = self.at(x, y);
        dist[start] = 0;
        let mut heap = BinaryHeap::new();
        heap.push(Reverse((0u32, start)));
        while let Some(Reverse((d, i))) = heap.pop() {
            if d > dist[i] {
                continue;
            }
            let (cx, cy) = (i as i32 % self.s.width, i as i32 / self.s.width);
            for (dx, dy) in DIRS {
                let (nx, ny) = (cx + dx, cy + dy);
                if !self.inside(nx, ny) {
                    continue;
                }
                let j = self.at(nx, ny);
                let step = self.step_cost(kind, j);
                if step == 0 || blocked[j] {
                    continue;
                }
                let nd = d + step;
                if nd <= budget && nd < dist[j] {
                    dist[j] = nd;
                    prev[j] = i;
                    heap.push(Reverse((nd, j)));
                }
            }
        }
        Reach { width: self.s.width, dist, prev }
    }

    /// Movement points a unit has this turn (powers and fuel included).
    pub fn moves(&self, unit: &Unit) -> u32 {
        let def = self.def(unit);
        let mut m = def.moves + self.move_bonus(unit.player);
        if self.s.options.supply && def.fuel > 0 {
            m = m.min(unit.fuel);
        }
        m
    }

    /// Where a unit can move this turn.
    pub fn reach(&self, unit: &Unit) -> Reach {
        self.search(unit.kind, unit.player, unit.x, unit.y, self.moves(unit), false)
    }

    /// Whether `unit` may end its move on `(x, y)` and stay there, as far as its
    /// side can tell: an empty tile or its own. (`can_board` covers getting into a
    /// transport or joining a unit.)
    pub fn can_stop(&self, unit: &Unit, x: i32, y: i32) -> bool {
        match self.unit_at(x, y) {
            None => true,
            Some(other) if other.id == unit.id => true,
            Some(other) => {
                // A hidden enemy looks like an empty tile; moving there springs the trap.
                !self.allied(other.player, unit.player) && !self.sees(unit.player, other, &self.sight(unit.player))
            }
        }
    }

    /// Whether `unit` could end its move on `(x, y)` by getting into a transport
    /// or joining a unit there.
    pub fn can_board(&self, unit: &Unit, x: i32, y: i32) -> bool {
        self.unit_at(x, y).is_some_and(|o| self.can_load(unit, o) || self.can_join(unit, o))
    }

    pub fn can_load(&self, unit: &Unit, transport: &Unit) -> bool {
        let t = self.def(transport);
        transport.player == unit.player
            && transport.id != unit.id
            && unit.cargo.is_empty()
            && transport.cargo.len() < t.slots()
            && t.carry.iter().any(|c| *c == self.def(unit).id)
    }

    pub fn can_join(&self, unit: &Unit, other: &Unit) -> bool {
        other.player == unit.player
            && other.id != unit.id
            && other.kind == unit.kind
            && other.hp < FULL_HP
            && unit.cargo.is_empty()
            && other.cargo.is_empty()
    }

    /// Tiles next to `(x, y)` where carried unit `cargo` could be let out by
    /// `transport` standing on `(x, y)`, as far as its side can tell.
    pub fn drop_tiles(&self, transport: &Unit, cargo: &Unit, x: i32, y: i32) -> Vec<[i32; 2]> {
        let sight = self.sight(transport.player);
        DIRS.iter()
            .map(|(dx, dy)| (x + dx, y + dy))
            .filter(|(nx, ny)| self.inside(*nx, *ny) && self.move_cost(cargo.kind, *nx, *ny) > 0)
            .filter(|(nx, ny)| match self.unit_at(*nx, *ny) {
                None => true,
                Some(o) if o.id == transport.id => true,
                Some(o) => !self.sees(transport.player, o, &sight),
            })
            .map(|(nx, ny)| [nx, ny])
            .collect()
    }

    // ---- combat -----------------------------------------------------------

    /// Damage in percent, given the attacker's health, where the defender
    /// stands and the luck roll.
    fn damage(&self, attacker_kind: usize, attacker_player: usize, attacker_hp: u32, attacker_xp: u32, defender: &Unit, luck: u32) -> u32 {
        let base = self.dmg[attacker_kind][defender.kind];
        if base == 0 {
            return 0;
        }
        let stars = if self.def(defender).flying { 0 } else { self.terrain(defender.x, defender.y).defense };
        let health = attacker_hp.div_ceil(10);
        let cover = (stars * self.rules.combat.defense_per_star * defender.health() / 10).min(100);
        let raw = (base + luck) * health * (100 - cover) / 1000;
        let boost = self.attack_bonus(attacker_player) + self.tower_bonus(attacker_player) + self.rank_bonus(attacker_xp).0;
        raw * (100 + boost) / (100 + self.defense_bonus(defender.player) + self.rank_bonus(defender.xp).1)
    }

    fn has_ammo(&self, unit: &Unit) -> bool {
        !self.s.options.supply || self.def(unit).ammo == 0 || unit.ammo > 0
    }

    /// Whether `attacker` could fire at `defender` at all (ignoring range).
    fn can_hit(&self, attacker: &Unit, defender: &Unit) -> bool {
        !self.allied(attacker.player, defender.player)
            && !self.at_peace(attacker.player, defender.player)
            && self.dmg[attacker.kind][defender.kind] > 0
            && self.has_ammo(attacker)
            && (!defender.dived || self.def(attacker).detects_dived)
    }

    /// What `unit` could attack if it stood on `(x, y)`.
    pub fn targets(&self, unit: &Unit, x: i32, y: i32) -> Vec<Target> {
        let def = self.def(unit);
        if def.indirect() && (x != unit.x || y != unit.y) {
            return vec![];
        }
        let sight = self.sight(unit.player);
        let mut me = unit.clone();
        me.x = x;
        me.y = y;
        let mut out = vec![];
        for other in &self.s.units {
            if !self.can_hit(unit, other) {
                continue;
            }
            let d = distance(other.x, other.y, x, y);
            if d < def.range[0] || d > def.range[1] {
                continue;
            }
            // From the new tile the attacker may see what it could not see before.
            let visible = self.sees(unit.player, other, &sight)
                || (d == 1 && (!other.dived || def.detects_dived));
            if !visible {
                continue;
            }
            let min = self.damage(unit.kind, unit.player, unit.hp, unit.xp, other, 0);
            let max = self.damage(unit.kind, unit.player, unit.hp, unit.xp, other, self.rules.combat.luck);
            let mut counter = 0;
            if min < other.hp && self.can_counter(other, &me, d) {
                counter = self.damage(other.kind, other.player, other.hp - min, other.xp, &me, 0);
            }
            out.push(Target { unit: other.id, x: other.x, y: other.y, min, max, counter });
        }
        out
    }

    fn can_counter(&self, defender: &Unit, attacker: &Unit, distance: u32) -> bool {
        self.rules.combat.counterattack
            && distance == 1
            && !self.def(defender).indirect()
            && self.can_hit(defender, attacker)
    }

    /// Whether `unit` could start or continue a capture on `(x, y)`.
    pub fn can_capture(&self, unit: &Unit, x: i32, y: i32) -> bool {
        self.def(unit).can_capture
            && self.terrain(x, y).capturable
            && self.owner(x, y).is_none_or(|o| !self.allied(o, unit.player) && !self.at_peace(o, unit.player))
    }

    /// Unit kinds `player` could build on `(x, y)` right now, with their prices.
    pub fn build_options(&self, player: usize, x: i32, y: i32) -> Vec<(usize, u32)> {
        if !self.inside(x, y) || self.owner(x, y) != Some(player) || self.unit_at(x, y).is_some() {
            return vec![];
        }
        let cap = self.rules.economy.unit_cap;
        if cap > 0 && self.unit_count(player) >= cap as usize {
            return vec![];
        }
        let terrain = self.terrain(x, y);
        self.rules
            .units
            .iter()
            .enumerate()
            .filter(|(k, u)| terrain.builds.contains(&u.class) && self.cost[*k][self.s.terrain[self.at(x, y)] as usize] > 0)
            .map(|(k, u)| (k, u.cost))
            .collect()
    }

    /// Powers `player` could use right now.
    pub fn power_options(&self, player: usize) -> Vec<usize> {
        let p = &self.s.players[player];
        if !self.s.options.powers || p.power.is_some() {
            return vec![];
        }
        (0..self.rules.powers.len()).filter(|i| self.rules.powers[*i].charge <= p.charge).collect()
    }

    fn roll(&mut self, sides: u32) -> u32 {
        // xorshift64*
        let mut x = self.s.rng;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.s.rng = x;
        ((x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 33) % sides as u64) as u32
    }

    // ---- changing the board ----------------------------------------------

    /// Carry out `action` for `player`, or say why not.
    pub fn apply(&mut self, player: usize, action: &Action) -> Result<Vec<Event>, String> {
        if self.s.over {
            return Err("The game is over.".into());
        }
        if player >= self.s.players.len() || !self.s.players[player].alive {
            return Err("You are not in this game.".into());
        }
        let mut events = vec![];
        if *action == Action::Resign {
            self.defeat(player, None, &mut events);
            self.settle(&mut events);
            return Ok(events);
        }
        if matches!(action, Action::Offer { .. } | Action::Accept { .. } | Action::Decline { .. } | Action::LeaveAlliance) {
            self.diplomacy(player, action, &mut events)?;
            self.settle(&mut events);
            return Ok(events);
        }
        if !self.s.active.contains(&player) {
            return Err("It is not your turn.".into());
        }
        match action {
            Action::Move { unit, x, y, then } => self.move_unit(player, *unit, *x, *y, then, &mut events)?,
            Action::Build { x, y, unit } => self.build(player, *x, *y, unit, &mut events)?,
            Action::Power { power } => self.use_power(player, power, &mut events)?,
            Action::EndTurn => self.end_turn(player, &mut events),
            _ => unreachable!(),
        }
        self.settle(&mut events);
        Ok(events)
    }

    fn move_unit(&mut self, player: usize, id: u32, x: i32, y: i32, then: &Then, events: &mut Vec<Event>) -> Result<(), String> {
        let unit = self.unit(id).ok_or("That unit is gone.")?.clone();
        if unit.player != player {
            return Err("That is not your unit.".into());
        }
        if unit.moved {
            return Err("That unit has already acted.".into());
        }
        if !self.inside(x, y) {
            return Err("That tile is off the map.".into());
        }
        let reach = self.reach(&unit);
        let boarding = matches!(then, Then::Load | Then::Join);
        if reach.cost(x, y) == UNREACHABLE || !(self.can_stop(&unit, x, y) || (boarding && self.can_board(&unit, x, y))) {
            return Err("The unit cannot move there.".into());
        }
        let def = self.def(&unit).clone();
        let other = self.unit_at(x, y).filter(|o| o.id != id).cloned();
        let mut moved_unit = unit.clone();
        moved_unit.x = x;
        moved_unit.y = y;
        // Check the follow-up before anything changes.
        let target = match then {
            Then::Attack(target) => Some(
                self.targets(&unit, x, y)
                    .into_iter()
                    .find(|t| t.unit == *target)
                    .ok_or("That target is out of reach.")?,
            ),
            Then::Capture if !self.can_capture(&unit, x, y) => return Err("Nothing to capture there.".into()),
            Then::Load if !other.as_ref().is_some_and(|o| self.can_load(&unit, o)) => {
                return Err("There is no room to get in there.".into())
            }
            Then::Join if !other.as_ref().is_some_and(|o| self.can_join(&unit, o)) => {
                return Err("There is nothing to join there.".into())
            }
            Then::Dive if !def.can_dive || unit.dived => return Err("That unit cannot dive now.".into()),
            Then::Surface if !unit.dived => return Err("That unit is not dived.".into()),
            Then::Supply if !def.supplies => return Err("That unit carries no supplies.".into()),
            Then::Unload(drops) => {
                if drops.is_empty() {
                    return Err("Say which units get out.".into());
                }
                let mut used = vec![];
                for d in drops {
                    let cargo = unit.cargo.iter().find(|c| c.id == d.unit).ok_or("That unit is not on board.")?;
                    if !self.drop_tiles(&moved_unit, cargo, x, y).contains(&[d.x, d.y]) || used.contains(&(d.x, d.y)) {
                        return Err("A unit cannot get out there.".into());
                    }
                    used.push((d.x, d.y));
                }
                None
            }
            _ => None,
        };
        if other.as_ref().is_some_and(|o| self.allied(o.player, player)) && !matches!(then, Then::Load | Then::Join) {
            return Err("Something is already there.".into());
        }

        // Walk the path; a hidden enemy in the way stops the unit short.
        let path = reach.path(x, y);
        let mut stop = path.len() - 1;
        let mut trapped = None;
        for (i, p) in path.iter().enumerate().skip(1) {
            if let Some(o) = self.unit_at(p[0], p[1]) {
                if !self.allied(o.player, player) {
                    trapped = Some(*p);
                    stop = i - 1;
                    break;
                }
            }
        }
        if trapped.is_some() {
            // Back up off any friendly unit we were passing through.
            while stop > 0 && self.unit_at(path[stop][0], path[stop][1]).is_some_and(|o| o.id != id) {
                stop -= 1;
            }
        }
        let [sx, sy] = path[stop];
        let spent = reach.cost(sx, sy);
        if stop > 0 {
            events.push(Event::Move { unit: id, path: path[..=stop].to_vec() });
        }
        {
            let supply = self.s.options.supply && def.fuel > 0;
            let u = self.unit_mut(id);
            u.x = sx;
            u.y = sy;
            u.moved = true;
            if stop > 0 {
                u.capture = 0;
            }
            if supply {
                u.fuel = u.fuel.saturating_sub(spent);
            }
        }
        if let Some([tx, ty]) = trapped {
            events.push(Event::Trapped { unit: id, x: tx, y: ty });
            return Ok(());
        }
        match then {
            Then::Wait => {}
            Then::Capture => self.capture(id, events),
            Then::Attack(_) => self.attack(id, target.unwrap().unit, events),
            Then::Load => {
                let into = other.unwrap().id;
                let mut u = self.take(id);
                u.moved = true;
                u.capture = 0;
                u.dived = false;
                self.unit_mut(into).cargo.push(u);
                events.push(Event::Load { unit: id, into });
            }
            Then::Join => self.join(id, other.unwrap().id, events),
            Then::Unload(drops) => {
                for d in drops {
                    // A hidden enemy may still sit there.
                    if self.unit_at(d.x, d.y).is_some() {
                        events.push(Event::Trapped { unit: d.unit, x: d.x, y: d.y });
                        continue;
                    }
                    let t = self.unit_mut(id);
                    let k = t.cargo.iter().position(|c| c.id == d.unit).unwrap();
                    let mut c = t.cargo.remove(k);
                    c.x = d.x;
                    c.y = d.y;
                    c.moved = true;
                    events.push(Event::Unload { unit: c.clone(), from: id });
                    self.s.units.push(c);
                }
            }
            Then::Dive | Then::Surface => {
                let dived = matches!(then, Then::Dive);
                self.unit_mut(id).dived = dived;
                events.push(Event::Dive { unit: id, dived });
            }
            Then::Supply => {
                let mut fed = vec![];
                for i in 0..self.s.units.len() {
                    let o = &self.s.units[i];
                    if o.id != id && self.allied(o.player, player) && distance(o.x, o.y, sx, sy) == 1 {
                        fed.push(o.id);
                        self.refill(i);
                    }
                }
                events.push(Event::Supply { unit: id, units: fed });
            }
        }
        Ok(())
    }

    fn unit_mut(&mut self, id: u32) -> &mut Unit {
        self.s.units.iter_mut().find(|u| u.id == id).expect("unit exists")
    }

    /// Take a unit off the board.
    fn take(&mut self, id: u32) -> Unit {
        let i = self.s.units.iter().position(|u| u.id == id).expect("unit exists");
        self.s.units.remove(i)
    }

    fn refill(&mut self, i: usize) {
        let def = &self.rules.units[self.s.units[i].kind];
        let (fuel, ammo) = (def.fuel, def.ammo);
        let u = &mut self.s.units[i];
        u.fuel = fuel;
        u.ammo = ammo;
    }

    fn join(&mut self, id: u32, into: u32, events: &mut Vec<Event>) {
        let u = self.take(id);
        let cost = self.def(&u).cost;
        let supply = self.s.options.supply;
        let t = self.unit_mut(into);
        let total = t.hp + u.hp;
        let hp = total.min(FULL_HP);
        let refund = (total - hp) * cost / FULL_HP;
        t.hp = hp;
        t.moved = true;
        t.capture = 0;
        if supply {
            t.fuel = t.fuel.max(u.fuel);
            t.ammo = t.ammo.max(u.ammo);
        }
        if t.tag.is_none() {
            t.tag = u.tag;
        }
        t.xp = t.xp.max(u.xp);
        let player = u.player;
        self.s.players[player].funds = self.s.players[player].funds.saturating_add(refund);
        events.push(Event::Join { unit: id, into, hp, refund });
    }

    fn attack(&mut self, attacker: u32, defender: u32, events: &mut Vec<Event>) {
        let a = self.unit(attacker).unwrap().clone();
        let d = self.unit(defender).unwrap().clone();
        let dist = distance(a.x, a.y, d.x, d.y);
        let luck = self.rules.combat.luck;
        let roll = if luck > 0 { self.roll(luck + 1) } else { 0 };
        let damage = self.damage(a.kind, a.player, a.hp, a.xp, &d, roll).min(d.hp);
        self.spend_ammo(attacker);
        self.gain_xp(attacker, damage, damage >= d.hp);
        self.charge(a.player, d.player, damage, d.kind);
        let left = d.hp - damage;
        events.push(Event::Attack { attacker, defender, damage, hp: left, counter: false });
        if left == 0 {
            self.destroy(defender, events);
            return;
        }
        self.unit_mut(defender).hp = left;
        let d = self.unit(defender).unwrap().clone();
        if self.can_counter(&d, &a, dist) {
            let roll = if luck > 0 { self.roll(luck + 1) } else { 0 };
            let back = self.damage(d.kind, d.player, left, d.xp, &a, roll).min(a.hp);
            self.spend_ammo(defender);
            self.gain_xp(defender, back, back >= a.hp);
            self.charge(d.player, a.player, back, a.kind);
            let left = a.hp - back;
            events.push(Event::Attack { attacker: defender, defender: attacker, damage: back, hp: left, counter: true });
            if left == 0 {
                self.destroy(attacker, events);
            } else {
                self.unit_mut(attacker).hp = left;
            }
        }
    }

    /// A unit's rank (0 = none) with veteran ranks on.
    pub fn rank(&self, xp: u32) -> u32 {
        if !self.s.options.ranks {
            return 0;
        }
        self.rules.ranks.thresholds.iter().filter(|t| xp >= **t).count() as u32
    }

    /// Percent more damage dealt and less taken for a unit with this experience.
    fn rank_bonus(&self, xp: u32) -> (u32, u32) {
        let r = self.rank(xp);
        (r * self.rules.ranks.attack, r * self.rules.ranks.defense)
    }

    fn gain_xp(&mut self, id: u32, damage: u32, kill: bool) {
        if !self.s.options.ranks {
            return;
        }
        let bonus = if kill { self.rules.ranks.kill_bonus } else { 0 };
        if let Some(u) = self.s.units.iter_mut().find(|u| u.id == id) {
            u.xp = u.xp.saturating_add(damage + bonus);
        }
    }

    fn spend_ammo(&mut self, id: u32) {
        if self.s.options.supply {
            let u = self.unit_mut(id);
            u.ammo = u.ammo.saturating_sub(1);
        }
    }

    /// Power charge for damage: its value to whoever dealt it, half that to whoever took it.
    fn charge(&mut self, dealer: usize, taker: usize, damage: u32, kind: usize) {
        if !self.s.options.powers || self.rules.powers.is_empty() {
            return;
        }
        let value = damage * self.rules.units[kind].cost / FULL_HP;
        let cap = self.charge_cap();
        let p = &mut self.s.players[dealer];
        p.charge = (p.charge + value).min(cap);
        let p = &mut self.s.players[taker];
        p.charge = (p.charge + value / 2).min(cap);
    }

    fn destroy(&mut self, id: u32, events: &mut Vec<Event>) {
        let unit = self.take(id);
        events.push(Event::Destroy { unit: id, x: unit.x, y: unit.y });
        self.after_loss(unit.player, events);
    }

    fn after_loss(&mut self, player: usize, events: &mut Vec<Event>) {
        if self.rules.victory.rout && self.unit_count(player) == 0 {
            self.defeat(player, None, events);
        }
    }

    fn capture(&mut self, id: u32, events: &mut Vec<Event>) {
        let needed = self.rules.capture.points;
        let (x, y, player, progress) = {
            let u = self.unit_mut(id);
            u.capture += u.hp.div_ceil(10);
            (u.x, u.y, u.player, u.capture)
        };
        let done = progress >= needed;
        events.push(Event::Capture { unit: id, x, y, progress: progress.min(needed), needed, done });
        if !done {
            return;
        }
        self.unit_mut(id).capture = 0;
        let i = self.at(x, y);
        let previous = self.owner(x, y);
        self.s.owner[i] = player as i8;
        if let Some(loser) = previous {
            if self.terrain(x, y).hq && self.rules.victory.hq_capture {
                self.defeat(loser, Some(player), events);
            }
        }
    }

    fn build(&mut self, player: usize, x: i32, y: i32, kind: &str, events: &mut Vec<Event>) -> Result<(), String> {
        let k = self.rules.unit_by_id(kind).ok_or("There is no such unit.")?;
        let options = self.build_options(player, x, y);
        let (_, cost) = options.iter().find(|(o, _)| *o == k).ok_or("That cannot be built there.")?;
        if self.s.players[player].funds < *cost {
            return Err("Not enough funds.".into());
        }
        self.s.players[player].funds -= cost;
        let mut unit = self.fresh_unit(k, player, x, y);
        unit.moved = true;
        self.s.units.push(unit.clone());
        events.push(Event::Build { unit });
        Ok(())
    }

    fn use_power(&mut self, player: usize, id: &str, events: &mut Vec<Event>) -> Result<(), String> {
        if !self.s.options.powers {
            return Err("Powers are off in this game.".into());
        }
        let i = self.rules.powers.iter().position(|p| p.id == id).ok_or("There is no such power.")?;
        if !self.power_options(player).contains(&i) {
            return Err("That power is not charged, or one is already in use.".into());
        }
        let power = self.rules.powers[i].clone();
        let p = &mut self.s.players[player];
        p.charge -= power.charge;
        p.power = Some(i);
        events.push(Event::Power { player, power: i });
        for e in &power.effects {
            match e {
                Effect::Heal { hp } => {
                    for k in 0..self.s.units.len() {
                        if self.s.units[k].player == player {
                            let u = &mut self.s.units[k];
                            u.hp = (u.hp + hp * 10).min(FULL_HP);
                            events.push(Event::Repair { unit: u.id, hp: u.hp });
                        }
                    }
                }
                Effect::Funds { amount } => {
                    let p = &mut self.s.players[player];
                    p.funds = p.funds.saturating_add(*amount);
                }
                Effect::Resupply => {
                    for k in 0..self.s.units.len() {
                        if self.s.units[k].player == player {
                            self.refill(k);
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Remove a player. Their properties go to `heir`, or become neutral.
    fn defeat(&mut self, player: usize, heir: Option<usize>, events: &mut Vec<Event>) {
        if !self.s.players[player].alive {
            return;
        }
        self.s.players[player].alive = false;
        self.s.units.retain(|u| u.player != player);
        // Their offers and truces go with them.
        self.s.offers.retain(|o| o.from != player && o.to != player);
        self.s.truces.retain(|t| t.a != player && t.b != player);
        let to = heir.map(|h| h as i8).unwrap_or(NO_OWNER);
        for o in self.s.owner.iter_mut() {
            if *o == player as i8 {
                *o = to;
            }
        }
        events.push(Event::Defeat { player });
    }

    fn finish(&mut self, team_of_winner: Option<usize>, events: &mut Vec<Event>) {
        self.s.over = true;
        self.s.winners = match team_of_winner {
            Some(t) => (0..self.s.players.len()).filter(|p| self.team(*p) == t).collect(),
            None => vec![],
        };
        self.s.winner = self
            .s
            .winners
            .iter()
            .copied()
            .find(|p| self.s.players[*p].alive)
            .or(self.s.winners.first().copied());
        events.push(Event::Over { winner: self.s.winner, winners: self.s.winners.clone() });
    }

    /// End the game if one side is left or a mission is decided, or pass the
    /// turn if the player whose turn it was has just gone.
    fn settle(&mut self, events: &mut Vec<Event>) {
        if self.s.over {
            return;
        }
        if let Some(result) = self.mission_result() {
            let me = self.s.mission.as_ref().unwrap().player;
            let side = if result {
                Some(self.team(me))
            } else {
                (0..self.s.players.len()).find(|p| self.s.players[*p].alive && !self.allied(*p, me)).map(|p| self.team(p))
            };
            self.finish(side, events);
            return;
        }
        let mut teams: Vec<usize> =
            (0..self.s.players.len()).filter(|p| self.s.players[*p].alive).map(|p| self.team(p)).collect();
        teams.sort_unstable();
        teams.dedup();
        if teams.len() <= 1 {
            self.finish(teams.first().copied(), events);
            return;
        }
        let players = &self.s.players;
        self.s.active.retain(|p| players[*p].alive);
        self.s.waiting.retain(|p| players[*p].alive);
        if self.s.active.is_empty() {
            self.next_group(events);
        } else {
            self.s.turn = self.s.active[0];
        }
    }

    /// Some(true) when the mission is won, Some(false) when it is lost.
    fn mission_result(&self) -> Option<bool> {
        let m = self.s.mission.as_ref()?;
        if m.fail.iter().any(|g| self.goal_met(m.player, g)) {
            return Some(false);
        }
        if m.goals.iter().any(|g| self.goal_met(m.player, g)) {
            return Some(true);
        }
        None
    }

    pub fn goal_met(&self, me: usize, goal: &Goal) -> bool {
        let tagged = |tag: &str| {
            self.s.units.iter().flat_map(|u| std::iter::once(u).chain(u.cargo.iter())).find(|u| u.tag.as_deref() == Some(tag))
        };
        match goal {
            Goal::Capture { x, y } => self.inside(*x, *y) && self.owner(*x, *y).is_some_and(|o| self.allied(o, me)),
            Goal::LoseTile { x, y } => self.inside(*x, *y) && self.owner(*x, *y).is_some_and(|o| !self.allied(o, me)),
            Goal::Day { day } => self.s.day >= *day,
            Goal::NoEnemyUnits => (0..self.s.players.len()).filter(|p| !self.allied(*p, me)).all(|p| self.unit_count(p) == 0),
            Goal::NoUnits => (0..self.s.players.len()).filter(|p| self.allied(*p, me)).all(|p| self.unit_count(p) == 0),
            Goal::UnitGone { tag } => tagged(tag).is_none(),
            Goal::UnitAt { tag, x, y } => tagged(tag).is_some_and(|u| u.x == *x && u.y == *y && self.unit(u.id).is_some()),
        }
    }

    /// The day after which the game ends, if any.
    pub fn day_limit(&self) -> u32 {
        match &self.s.options.mode {
            Mode::ScoreRace { days } | Mode::Survival { days, .. } => *days,
            _ => self.rules.victory.day_limit,
        }
    }

    /// Things that happen once a day, before anyone moves: the hill is scored,
    /// the storm closes in, invaders arrive, truces run out.
    fn new_day(&mut self, events: &mut Vec<Event>) {
        let day = self.s.day;
        let ended: Vec<Truce> = self.s.truces.iter().filter(|t| t.until <= day).cloned().collect();
        self.s.truces.retain(|t| t.until > day);
        for t in ended {
            events.push(Event::Pact { what: "truce_over".into(), from: t.a, to: t.b, pact: None });
        }
        match self.s.options.mode.clone() {
            Mode::KingOfTheHill { days } => {
                let Some([hx, hy]) = self.s.hill else { return };
                let holder = self.unit_at(hx, hy).map(|u| self.team(u.player));
                self.s.hold = match (holder, self.s.hold) {
                    (Some(t), Some([h, n])) if h as usize == t => Some([t as u32, n + 1]),
                    (Some(t), _) => Some([t as u32, 1]),
                    (None, _) => None,
                };
                let held = self.s.hold.map_or(0, |h| h[1]);
                events.push(Event::Hill { team: holder, days: held });
                if held >= days {
                    self.finish(holder, events);
                }
            }
            Mode::BattleRoyale { start, every, .. } => {
                if day < start {
                    return;
                }
                let full = ((self.s.width * self.s.width + self.s.height * self.s.height) as f32).sqrt() / 2.0;
                let steps = ((day - start) / every.max(1) + 1) as f32;
                let radius = (full * (1.0 - steps * 0.12)).max(1.5);
                if self.s.storm != Some(radius) {
                    self.s.storm = Some(radius);
                    events.push(Event::Storm { radius });
                }
            }
            Mode::Survival { every, invaders, .. }
                if day.is_multiple_of(every.max(1)) => {
                    self.spawn_wave(&invaders, day / every.max(1), events);
                }
            _ => {}
        }
    }

    /// Whether `(x, y)` is outside the battle royale's safe circle.
    pub fn in_storm(&self, x: i32, y: i32) -> bool {
        match self.s.storm {
            Some(r) => {
                let (cx, cy) = ((self.s.width - 1) as f32 / 2.0, (self.s.height - 1) as f32 / 2.0);
                let (dx, dy) = (x as f32 - cx, y as f32 - cy);
                (dx * dx + dy * dy).sqrt() > r
            }
            None => false,
        }
    }

    /// Survival: free units for the invaders at their property, more and
    /// stronger with every wave.
    fn spawn_wave(&mut self, invaders: &[usize], wave: u32, events: &mut Vec<Event>) {
        let ladder: Vec<usize> = ["infantry", "mech", "recon", "tank", "artillery", "antiair", "rockets"]
            .iter()
            .filter_map(|id| self.rules.unit_by_id(id))
            .collect();
        let ladder = if ladder.is_empty() { (0..self.rules.units.len()).collect() } else { ladder };
        for &p in invaders {
            if !self.s.players[p].alive {
                continue;
            }
            let mut spots: Vec<(i32, i32)> = vec![];
            for y in 0..self.s.height {
                for x in 0..self.s.width {
                    if self.owner(x, y) == Some(p) && self.unit_at(x, y).is_none() {
                        spots.push((x, y));
                    }
                }
            }
            // Factories first: they are where armies come from.
            spots.sort_by_key(|(x, y)| (self.terrain(*x, *y).builds.is_empty(), *y, *x));
            let count = (1 + wave / 2) as usize;
            for (i, (x, y)) in spots.into_iter().take(count).enumerate() {
                let top = (wave as usize).min(ladder.len());
                let kind = ladder[(i + wave as usize) % top.max(1)];
                if self.cost[kind][self.s.terrain[self.at(x, y)] as usize] == 0 {
                    continue;
                }
                let unit = self.fresh_unit(kind, p, x, y);
                self.s.units.push(unit.clone());
                events.push(Event::Spawn { unit });
            }
        }
    }

    /// King of the hill: the land tile nearest the middle that every foot unit can stand on.
    fn find_hill(&self) -> Option<[i32; 2]> {
        let foot = self.rules.units.iter().position(|u| u.can_capture)?;
        let (cx, cy) = ((self.s.width - 1) as f32 / 2.0, (self.s.height - 1) as f32 / 2.0);
        let mut best: Option<(f32, [i32; 2])> = None;
        for y in 0..self.s.height {
            for x in 0..self.s.width {
                if self.move_cost(foot, x, y) == 0 || self.terrain(x, y).capturable {
                    continue;
                }
                let d = (x as f32 - cx).abs() + (y as f32 - cy).abs() + (x + y * 3) as f32 * 1e-4;
                if best.is_none_or(|b| d < b.0) {
                    best = Some((d, [x, y]));
                }
            }
        }
        best.map(|b| b.1)
    }

    /// Whether a truce stops these two players fighting.
    pub fn at_peace(&self, a: usize, b: usize) -> bool {
        self.s.truces.iter().any(|t| (t.a == a && t.b == b) || (t.a == b && t.b == a))
    }

    fn diplomacy(&mut self, player: usize, action: &Action, events: &mut Vec<Event>) -> Result<(), String> {
        if !self.s.options.diplomacy {
            return Err("Diplomacy is off in this game.".into());
        }
        let n = self.s.players.len();
        match action {
            Action::Offer { to, pact } => {
                let to = *to;
                if to >= n || to == player || !self.s.players[to].alive {
                    return Err("There is nobody to make that offer to.".into());
                }
                if let Pact::Truce { days } = pact {
                    if *days == 0 || *days > 20 {
                        return Err("A truce lasts 1 to 20 days.".into());
                    }
                }
                if *pact == Pact::Alliance && self.allied(player, to) {
                    return Err("You are already allies.".into());
                }
                self.s.offers.retain(|o| !(o.from == player && o.to == to));
                self.s.offers.push(Offer { from: player, to, pact: pact.clone() });
                events.push(Event::Pact { what: "offer".into(), from: player, to, pact: Some(pact.clone()) });
            }
            Action::Accept { from } | Action::Decline { from } => {
                let from = *from;
                let i = self
                    .s
                    .offers
                    .iter()
                    .position(|o| o.from == from && o.to == player)
                    .ok_or("There is no such offer.")?;
                if !self.s.players[from].alive && matches!(action, Action::Accept { .. }) {
                    return Err("That player is gone.".into());
                }
                let offer = self.s.offers.remove(i);
                if matches!(action, Action::Decline { .. }) {
                    events.push(Event::Pact { what: "decline".into(), from, to: player, pact: Some(offer.pact) });
                    return Ok(());
                }
                match offer.pact {
                    Pact::Alliance => {
                        // The two teams become one.
                        let (keep, merge) = (self.team(from), self.team(player));
                        for p in 0..n {
                            let t = self.team(p);
                            if t == keep || t == merge {
                                self.s.players[p].team = Some(keep);
                            }
                        }
                        let truces = std::mem::take(&mut self.s.truces);
                        self.s.truces = truces.into_iter().filter(|t| !self.allied(t.a, t.b)).collect();
                    }
                    Pact::Truce { days } => {
                        self.s.truces.retain(|t| !((t.a == from && t.b == player) || (t.a == player && t.b == from)));
                        self.s.truces.push(Truce { a: from, b: player, until: self.s.day + days });
                    }
                }
                events.push(Event::Pact { what: "accept".into(), from, to: player, pact: Some(offer.pact) });
            }
            Action::LeaveAlliance => {
                if matches!(self.s.options.mode, Mode::Survival { .. }) {
                    return Err("Nobody leaves in survival.".into());
                }
                let mine = self.team(player);
                let others: Vec<usize> = (0..n).filter(|p| *p != player && self.team(*p) == mine).collect();
                if others.is_empty() {
                    return Err("You have no allies to leave.".into());
                }
                // A fresh team number nobody uses.
                let fresh = (0..).map(|k| 2000 + k).find(|t| (0..n).all(|p| self.team(p) != *t)).unwrap();
                self.s.players[player].team = Some(fresh);
                events.push(Event::Pact { what: "leave".into(), from: player, to: others[0], pact: None });
            }
            _ => unreachable!(),
        }
        Ok(())
    }

    /// `player` is done for today.
    fn end_turn(&mut self, player: usize, events: &mut Vec<Event>) {
        self.s.active.retain(|p| *p != player);
        if self.s.active.is_empty() {
            self.next_group(events);
        } else {
            self.s.turn = self.s.active[0];
        }
    }

    /// Start the next player's turn, or several at once with simultaneous turns.
    /// A new day begins when everyone has played.
    fn next_group(&mut self, events: &mut Vec<Event>) {
        loop {
            let players = &self.s.players;
            self.s.waiting.retain(|p| players[*p].alive);
            if self.s.waiting.is_empty() {
                self.s.day += 1;
                let limit = self.day_limit();
                if limit > 0 && self.s.day > limit && self.s.mission.is_none() {
                    // Survival: the defenders lasted.
                    let winner = if let Mode::Survival { invaders, .. } = &self.s.options.mode {
                        (0..self.s.players.len()).find(|p| !invaders.contains(p)).map(|p| self.team(p))
                    } else {
                        self.leader()
                    };
                    self.finish(winner, events);
                    return;
                }
                if self.s.options.weather == "random" {
                    self.roll_weather(events);
                }
                self.new_day(events);
                if self.s.over {
                    return;
                }
                self.s.waiting = (0..self.s.players.len()).filter(|p| self.s.players[*p].alive).collect();
                if self.s.waiting.is_empty() {
                    // Everyone is gone at once: a draw.
                    self.finish(None, events);
                    return;
                }
            }
            let group = self.form_group();
            self.s.waiting.retain(|p| !group.contains(p));
            self.s.active = group.clone();
            self.s.turn = group[0];
            for p in group {
                if self.s.players[p].alive {
                    self.start_turn(p, events);
                }
            }
            if self.s.over {
                return;
            }
            // Starting turns can knock players out (crashes, the storm): stop if one side is left.
            let mut teams: Vec<usize> =
                (0..self.s.players.len()).filter(|p| self.s.players[*p].alive).map(|p| self.team(p)).collect();
            teams.sort_unstable();
            teams.dedup();
            if teams.len() <= 1 {
                self.finish(teams.first().copied(), events);
                return;
            }
            let players = &self.s.players;
            self.s.active.retain(|p| players[*p].alive);
            if !self.s.active.is_empty() {
                self.s.turn = self.s.active[0];
                break;
            }
        }
        self.settle(events);
    }

    /// The next player waiting, plus (with simultaneous turns) every other
    /// waiting player who cannot reach any of them this round, and teammates.
    fn form_group(&self) -> Vec<usize> {
        let first = self.s.waiting[0];
        let mut group = vec![first];
        if !self.s.options.simultaneous || self.s.waiting.len() == 1 {
            return group;
        }
        let mut zones: Vec<Option<Vec<bool>>> = vec![None; self.s.players.len()];
        let mut zone = |g: &Game, p: usize| -> Vec<bool> { zones[p].get_or_insert_with(|| g.zone(p)).clone() };
        let first_zone = zone(self, first);
        let mut taken = vec![first_zone];
        for &p in &self.s.waiting[1..] {
            let z = zone(self, p);
            let far = group
                .iter()
                .zip(taken.iter())
                .all(|(q, tz)| self.allied(p, *q) || !z.iter().zip(tz.iter()).any(|(a, b)| *a && *b));
            if far {
                group.push(p);
                taken.push(z);
            }
        }
        group
    }

    /// Every tile `player` could touch this round: their property, where their
    /// units (and passengers) could go, and how far they could shoot from there,
    /// with a tile to spare. Two players whose zones do not meet cannot affect
    /// each other before their turns end.
    pub fn zone(&self, player: usize) -> Vec<bool> {
        let n = self.s.terrain.len();
        let mut z = vec![false; n];
        for (i, o) in self.s.owner.iter().enumerate() {
            if *o == player as i8 {
                z[i] = true;
            }
        }
        let mut reach = 1u32;
        for u in self.s.units.iter().filter(|u| u.player == player) {
            let def = self.def(u);
            let r = self.search(u.kind, player, u.x, u.y, def.moves + 1, true);
            for (i, d) in r.dist.iter().enumerate() {
                if *d != UNREACHABLE {
                    z[i] = true;
                }
            }
            let passengers = u.cargo.iter().map(|c| self.def(c).moves + self.def(c).range[1]).max().unwrap_or(0);
            reach = reach.max(def.range[1] + 1).max(passengers + 1);
        }
        // Widen by `reach` tiles (any terrain): distance from the nearest marked tile.
        let (w, h) = (self.s.width, self.s.height);
        let mut dist = vec![u32::MAX; n];
        let mut queue = std::collections::VecDeque::new();
        for (i, on) in z.iter().enumerate() {
            if *on {
                dist[i] = 0;
                queue.push_back(i);
            }
        }
        while let Some(i) = queue.pop_front() {
            if dist[i] >= reach {
                continue;
            }
            let (x, y) = (i as i32 % w, i as i32 / w);
            for (dx, dy) in DIRS {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && nx < w && ny < h {
                    let j = (ny * w + nx) as usize;
                    if dist[j] == u32::MAX {
                        dist[j] = dist[i] + 1;
                        queue.push_back(j);
                    }
                }
            }
        }
        dist.iter().map(|d| *d != u32::MAX).collect()
    }

    fn roll_weather(&mut self, events: &mut Vec<Event>) {
        let total: u32 = self.rules.weather.iter().map(|w| w.chance).sum();
        if total == 0 {
            return;
        }
        let mut r = self.roll(total);
        let mut pick = 0;
        for (i, w) in self.rules.weather.iter().enumerate() {
            if r < w.chance {
                pick = i;
                break;
            }
            r -= w.chance;
        }
        if pick != self.s.weather {
            self.s.weather = pick;
            events.push(Event::Weather { weather: pick });
        }
    }

    /// A player's standing: properties first, then the value of their army.
    pub fn score(&self, player: usize) -> u64 {
        let properties = self.s.owner.iter().filter(|o| **o == player as i8).count() as u64;
        let army: u64 = self
            .s
            .units
            .iter()
            .filter(|u| u.player == player)
            .flat_map(|u| std::iter::once(u).chain(u.cargo.iter()))
            .map(|u| (self.def(u).cost * u.health() / 10) as u64)
            .sum();
        properties * 1_000_000 + army
    }

    /// The team with the best score among living players, or nobody on a tie.
    fn leader(&self) -> Option<usize> {
        let mut by_team: Vec<(usize, u64)> = vec![];
        for p in (0..self.s.players.len()).filter(|p| self.s.players[*p].alive) {
            let t = self.team(p);
            match by_team.iter_mut().find(|(k, _)| *k == t) {
                Some(e) => e.1 += self.score(p),
                None => by_team.push((t, self.score(p))),
            }
        }
        by_team.sort_by_key(|e| Reverse(e.1));
        match by_team.as_slice() {
            [best, second, ..] if best.1 == second.1 => None,
            [best, ..] => Some(best.0),
            [] => None,
        }
    }

    fn start_turn(&mut self, player: usize, events: &mut Vec<Event>) {
        self.s.players[player].power = None;
        for u in self.s.units.iter_mut().filter(|u| u.player == player) {
            u.moved = false;
        }
        let income = self.income(player);
        self.s.players[player].funds = self.s.players[player].funds.saturating_add(income);
        events.push(Event::Turn { player, day: self.s.day, income });

        if self.s.options.supply {
            self.supply_phase(player, events);
        }
        if let (Mode::BattleRoyale { damage, start, every }, Some(radius)) = (self.s.options.mode.clone(), self.s.storm) {
            // Once the circle is as small as it gets, the storm grows fiercer every day.
            let full = ((self.s.width * self.s.width + self.s.height * self.s.height) as f32).sqrt() / 2.0;
            let shrinking_days = ((full - 1.5) / (full * 0.12)).ceil() as u32 * every.max(1);
            let late = if radius <= 1.5 { self.s.day.saturating_sub(start + shrinking_days) } else { 0 };
            let damage = damage + late;
            let caught: Vec<u32> =
                self.s.units.iter().filter(|u| u.player == player && self.in_storm(u.x, u.y)).map(|u| u.id).collect();
            for id in caught {
                let u = self.unit_mut(id);
                let hit = (damage * 10).min(u.hp);
                u.hp -= hit;
                let (hp, x, y) = (u.hp, u.x, u.y);
                events.push(Event::Storming { unit: id, damage: hit, hp });
                if hp == 0 {
                    self.take(id);
                    events.push(Event::Destroy { unit: id, x, y });
                    self.after_loss(player, events);
                }
            }
        }

        let step = self.rules.repair.hp * 10;
        for i in 0..self.s.units.len() {
            let u = self.s.units[i].clone();
            if u.player != player || u.hp >= FULL_HP || self.owner(u.x, u.y) != Some(player) || self.in_storm(u.x, u.y) {
                continue;
            }
            if !self.terrain(u.x, u.y).repairs.contains(&self.def(&u).class) {
                continue;
            }
            let heal = step.min(FULL_HP - u.hp);
            let cost = if self.rules.repair.costs { self.def(&u).cost * heal / 100 } else { 0 };
            if heal == 0 || self.s.players[player].funds < cost {
                continue;
            }
            self.s.players[player].funds -= cost;
            self.s.units[i].hp += heal;
            events.push(Event::Repair { unit: u.id, hp: u.hp + heal });
        }
    }

    /// Refill units on friendly property or next to a supply unit; others burn
    /// their daily fuel, and those that need it to stay up are lost at zero.
    fn supply_phase(&mut self, player: usize, events: &mut Vec<Event>) {
        let suppliers: Vec<(i32, i32)> = self
            .s
            .units
            .iter()
            .filter(|u| u.player == player && self.def(u).supplies)
            .map(|u| (u.x, u.y))
            .collect();
        let mut lost = vec![];
        for i in 0..self.s.units.len() {
            let u = self.s.units[i].clone();
            if u.player != player {
                continue;
            }
            let def = self.def(&u).clone();
            let at_base = self.owner(u.x, u.y) == Some(player) && self.terrain(u.x, u.y).repairs.contains(&def.class);
            let near_supply = suppliers.iter().any(|(x, y)| distance(*x, *y, u.x, u.y) == 1);
            if at_base || near_supply {
                self.refill(i);
                continue;
            }
            let burn = def.fuel_per_day + if u.dived { def.dive_fuel } else { 0 };
            if def.fuel == 0 || burn == 0 {
                continue;
            }
            let fuel = u.fuel.saturating_sub(burn);
            self.s.units[i].fuel = fuel;
            if fuel == 0 && def.fuel_per_day > 0 {
                lost.push(u.id);
            }
        }
        for id in lost {
            let u = self.take(id);
            events.push(Event::Crash { unit: id, x: u.x, y: u.y });
            self.after_loss(player, events);
        }
    }
}
