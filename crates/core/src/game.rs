//! Game state and the rules that change it.
//!
//! The only way to change a game is `Game::apply(player, action)`. It either
//! refuses the action or returns the events that happened, in order, so a
//! client can animate them. Given the same state and action the result is
//! always the same: the dice are part of the state.

use crate::rules::{MapDef, Rules, MAX_MAP_SIDE};
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
}

impl Unit {
    /// Health as shown to players, 1-10.
    pub fn health(&self) -> u32 {
        (self.hp + 9) / 10
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Player {
    pub funds: u32,
    pub alive: bool,
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
    /// Whose turn it is.
    pub turn: usize,
    pub day: u32,
    pub over: bool,
    /// Set when the game is over, unless it was a draw.
    pub winner: Option<usize>,
    pub rng: u64,
    pub next_id: u32,
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
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "e", rename_all = "snake_case")]
pub enum Event {
    Move { unit: u32, path: Vec<[i32; 2]> },
    /// `hp` is what the defender has left. `counter` marks the shot fired back.
    Attack { attacker: u32, defender: u32, damage: u32, hp: u32, counter: bool },
    Destroy { unit: u32, x: i32, y: i32 },
    Capture { unit: u32, x: i32, y: i32, progress: u32, needed: u32, done: bool },
    Build { unit: Unit },
    Repair { unit: u32, hp: u32 },
    Turn { player: usize, day: u32, income: u32 },
    Defeat { player: usize },
    Over { winner: Option<usize> },
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

impl Game {
    pub fn new(rules: Rules, map: &MapDef, seed: u64) -> Result<Game, String> {
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
                players: vec![
                    Player { funds: map.start_funds.unwrap_or(rules.economy.start_funds), alive: true };
                    map.players
                ],
                turn: 0,
                day: 1,
                over: false,
                winner: None,
                rng: seed | 1,
                next_id: 1,
            },
            rules,
        };
        game.index();
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
            let id = game.s.next_id;
            game.s.next_id += 1;
            game.s.units.push(Unit { id, kind, player: u.player, x, y, hp: FULL_HP, moved: false, capture: 0 });
            present[u.player] = true;
        }
        if let Some(p) = present.iter().position(|p| !p) {
            return Err(format!("map: player {} starts with no property and no unit", p + 1));
        }
        let mut events = vec![];
        game.start_turn(&mut events);
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
        for u in &s.units {
            if u.kind >= rules.units.len()
                || u.player >= s.players.len()
                || u.x < 0
                || u.y < 0
                || u.x >= s.width
                || u.y >= s.height
                || u.hp == 0
                || u.hp > FULL_HP
            {
                return Err("state: bad unit".into());
            }
        }
        let mut game = Game { rules, s, cost: vec![], dmg: vec![] };
        game.index();
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

    pub fn move_cost(&self, kind: usize, x: i32, y: i32) -> u32 {
        self.cost[kind][self.s.terrain[self.at(x, y)] as usize]
    }

    pub fn unit_count(&self, player: usize) -> usize {
        self.s.units.iter().filter(|u| u.player == player).count()
    }

    pub fn income(&self, player: usize) -> u32 {
        (0..self.s.owner.len())
            .filter(|i| self.s.owner[*i] == player as i8)
            .map(|i| self.rules.terrains[self.s.terrain[i] as usize].income)
            .sum()
    }

    // ---- movement ---------------------------------------------------------

    /// Where a unit of `kind` owned by `player` can get to from `(x, y)` with
    /// `budget` movement points. Enemy units block the way unless `ghost` is set,
    /// which plans a route as if the board were empty.
    pub fn search(&self, kind: usize, player: usize, x: i32, y: i32, budget: u32, ghost: bool) -> Reach {
        let n = self.s.terrain.len();
        let mut blocked = vec![false; n];
        if !ghost {
            for u in &self.s.units {
                if u.player != player {
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
                let step = self.cost[kind][self.s.terrain[j] as usize];
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

    /// Where a unit can move this turn.
    pub fn reach(&self, unit: &Unit) -> Reach {
        self.search(unit.kind, unit.player, unit.x, unit.y, self.def(unit).moves, false)
    }

    /// Whether `unit` may end its move on `(x, y)`.
    pub fn can_stop(&self, unit: &Unit, x: i32, y: i32) -> bool {
        match self.unit_at(x, y) {
            Some(other) => other.id == unit.id,
            None => true,
        }
    }

    // ---- combat -----------------------------------------------------------

    /// Damage in percent, given the attacker's health, where the defender
    /// stands and the luck roll.
    fn damage(&self, attacker_kind: usize, attacker_hp: u32, defender: &Unit, luck: u32) -> u32 {
        let base = self.dmg[attacker_kind][defender.kind];
        if base == 0 {
            return 0;
        }
        let stars = if self.def(defender).flying { 0 } else { self.terrain(defender.x, defender.y).defense };
        let health = (attacker_hp + 9) / 10;
        let cover = (stars * self.rules.combat.defense_per_star * defender.health() / 10).min(100);
        (base + luck) * health * (100 - cover) / 1000
    }

    /// What `unit` could attack if it stood on `(x, y)`.
    pub fn targets(&self, unit: &Unit, x: i32, y: i32) -> Vec<Target> {
        let def = self.def(unit);
        if def.indirect() && (x != unit.x || y != unit.y) {
            return vec![];
        }
        let mut out = vec![];
        for other in &self.s.units {
            if other.player == unit.player || self.dmg[unit.kind][other.kind] == 0 {
                continue;
            }
            let d = ((other.x - x).abs() + (other.y - y).abs()) as u32;
            if d < def.range[0] || d > def.range[1] {
                continue;
            }
            let min = self.damage(unit.kind, unit.hp, other, 0);
            let max = self.damage(unit.kind, unit.hp, other, self.rules.combat.luck);
            let mut counter = 0;
            if min < other.hp && self.can_counter(other, unit.kind, d) {
                let mut me = unit.clone();
                me.x = x;
                me.y = y;
                counter = self.damage(other.kind, other.hp - min, &me, 0);
            }
            out.push(Target { unit: other.id, x: other.x, y: other.y, min, max, counter });
        }
        out
    }

    fn can_counter(&self, defender: &Unit, attacker_kind: usize, distance: u32) -> bool {
        self.rules.combat.counterattack
            && distance == 1
            && !self.def(defender).indirect()
            && self.dmg[defender.kind][attacker_kind] > 0
    }

    /// Whether `unit` could start or continue a capture on `(x, y)`.
    pub fn can_capture(&self, unit: &Unit, x: i32, y: i32) -> bool {
        self.def(unit).can_capture && self.terrain(x, y).capturable && self.owner(x, y) != Some(unit.player)
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
            self.after_defeat(&mut events);
            return Ok(events);
        }
        if player != self.s.turn {
            return Err("It is not your turn.".into());
        }
        match action {
            Action::Move { unit, x, y, then } => self.move_unit(player, *unit, *x, *y, then, &mut events)?,
            Action::Build { x, y, unit } => self.build(player, *x, *y, unit, &mut events)?,
            Action::EndTurn => self.next_turn(&mut events),
            Action::Resign => unreachable!(),
        }
        self.after_defeat(&mut events);
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
        if reach.cost(x, y) == UNREACHABLE || !self.can_stop(&unit, x, y) {
            return Err("The unit cannot move there.".into());
        }
        // Check the follow-up before anything changes.
        let target = match then {
            Then::Attack(target) => Some(
                self.targets(&unit, x, y)
                    .into_iter()
                    .find(|t| t.unit == *target)
                    .ok_or("That target is out of reach.")?,
            ),
            Then::Capture if !self.can_capture(&unit, x, y) => return Err("Nothing to capture there.".into()),
            _ => None,
        };

        let moving = x != unit.x || y != unit.y;
        if moving {
            events.push(Event::Move { unit: id, path: reach.path(x, y) });
        }
        {
            let u = self.unit_mut(id);
            u.x = x;
            u.y = y;
            u.moved = true;
            if moving {
                u.capture = 0;
            }
        }
        match then {
            Then::Wait => {}
            Then::Capture => self.capture(id, events),
            Then::Attack(_) => self.attack(id, target.unwrap().unit, events),
        }
        Ok(())
    }

    fn unit_mut(&mut self, id: u32) -> &mut Unit {
        self.s.units.iter_mut().find(|u| u.id == id).expect("unit exists")
    }

    fn attack(&mut self, attacker: u32, defender: u32, events: &mut Vec<Event>) {
        let a = self.unit(attacker).unwrap().clone();
        let d = self.unit(defender).unwrap().clone();
        let distance = ((a.x - d.x).abs() + (a.y - d.y).abs()) as u32;
        let luck = self.rules.combat.luck;
        let roll = if luck > 0 { self.roll(luck + 1) } else { 0 };
        let damage = self.damage(a.kind, a.hp, &d, roll).min(d.hp);
        let left = d.hp - damage;
        events.push(Event::Attack { attacker, defender, damage, hp: left, counter: false });
        if left == 0 {
            self.destroy(defender, events);
            return;
        }
        self.unit_mut(defender).hp = left;
        if self.can_counter(&d, a.kind, distance) {
            let roll = if luck > 0 { self.roll(luck + 1) } else { 0 };
            let back = self.damage(d.kind, left, &a, roll).min(a.hp);
            let left = a.hp - back;
            events.push(Event::Attack { attacker: defender, defender: attacker, damage: back, hp: left, counter: true });
            if left == 0 {
                self.destroy(attacker, events);
            } else {
                self.unit_mut(attacker).hp = left;
            }
        }
    }

    fn destroy(&mut self, id: u32, events: &mut Vec<Event>) {
        let unit = self.unit(id).unwrap().clone();
        self.s.units.retain(|u| u.id != id);
        events.push(Event::Destroy { unit: id, x: unit.x, y: unit.y });
        if self.rules.victory.rout && self.unit_count(unit.player) == 0 {
            self.defeat(unit.player, None, events);
        }
    }

    fn capture(&mut self, id: u32, events: &mut Vec<Event>) {
        let needed = self.rules.capture.points;
        let (x, y, player, progress) = {
            let u = self.unit_mut(id);
            u.capture += (u.hp + 9) / 10;
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
        let unit = Unit { id: self.s.next_id, kind: k, player, x, y, hp: FULL_HP, moved: true, capture: 0 };
        self.s.next_id += 1;
        self.s.units.push(unit.clone());
        events.push(Event::Build { unit });
        Ok(())
    }

    /// Remove a player. Their properties go to `heir`, or become neutral.
    fn defeat(&mut self, player: usize, heir: Option<usize>, events: &mut Vec<Event>) {
        if !self.s.players[player].alive {
            return;
        }
        self.s.players[player].alive = false;
        self.s.units.retain(|u| u.player != player);
        let to = heir.map(|h| h as i8).unwrap_or(NO_OWNER);
        for o in self.s.owner.iter_mut() {
            if *o == player as i8 {
                *o = to;
            }
        }
        events.push(Event::Defeat { player });
    }

    /// Finish the game if one player is left, or pass the turn if the player
    /// whose turn it was has just gone.
    fn after_defeat(&mut self, events: &mut Vec<Event>) {
        if self.s.over {
            return;
        }
        let alive: Vec<usize> = (0..self.s.players.len()).filter(|p| self.s.players[*p].alive).collect();
        if alive.len() <= 1 {
            self.s.over = true;
            self.s.winner = alive.first().copied();
            events.push(Event::Over { winner: self.s.winner });
        } else if !self.s.players[self.s.turn].alive {
            self.next_turn(events);
        }
    }

    fn next_turn(&mut self, events: &mut Vec<Event>) {
        let n = self.s.players.len();
        let mut next = self.s.turn;
        loop {
            next = (next + 1) % n;
            if next == 0 {
                self.s.day += 1;
            }
            if self.s.players[next].alive {
                break;
            }
        }
        let limit = self.rules.victory.day_limit;
        if limit > 0 && self.s.day > limit {
            self.s.over = true;
            self.s.winner = self.leader();
            events.push(Event::Over { winner: self.s.winner });
            return;
        }
        self.s.turn = next;
        self.start_turn(events);
    }

    /// A player's standing: properties first, then the value of their army.
    pub fn score(&self, player: usize) -> u64 {
        let properties = self.s.owner.iter().filter(|o| **o == player as i8).count() as u64;
        let army: u64 = self
            .s
            .units
            .iter()
            .filter(|u| u.player == player)
            .map(|u| (self.def(u).cost * u.health() / 10) as u64)
            .sum();
        properties * 1_000_000 + army
    }

    /// The living player with the best score, or nobody on a tie.
    fn leader(&self) -> Option<usize> {
        let mut scores: Vec<(u64, usize)> =
            (0..self.s.players.len()).filter(|p| self.s.players[*p].alive).map(|p| (self.score(p), p)).collect();
        scores.sort_by(|a, b| b.cmp(a));
        match scores.as_slice() {
            [best, second, ..] if best.0 == second.0 => None,
            [best, ..] => Some(best.1),
            [] => None,
        }
    }

    fn start_turn(&mut self, events: &mut Vec<Event>) {
        let player = self.s.turn;
        for u in self.s.units.iter_mut() {
            u.moved = false;
        }
        let income = self.income(player);
        self.s.players[player].funds = self.s.players[player].funds.saturating_add(income);
        events.push(Event::Turn { player, day: self.s.day, income });

        let step = self.rules.repair.hp * 10;
        for i in 0..self.s.units.len() {
            let u = self.s.units[i].clone();
            if u.player != player || u.hp >= FULL_HP || self.owner(u.x, u.y) != Some(player) {
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
}
