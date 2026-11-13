//! The computer player.
//!
//! `next_action` looks at the game and returns one action for the player whose
//! turn it is. Call it, apply the result, and repeat until it returns
//! `EndTurn`. It keeps no memory between calls and never looks at the dice.
//! With fog of war it only uses what its side can see, so it plays by exactly
//! the same rules as a person.
//!
//! A `Profile` sets how well it plays (`Level`) and what it likes doing (`Style`).

use crate::game::{Action, Drop, Game, Mode, Offer, Pact, Reach, Then, Unit, UNREACHABLE};
use crate::rules::Effect;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// Makes mistakes, builds slowly, ignores danger.
    Easy,
    #[default]
    Normal,
    /// Weighs the danger of every tile and plans its army.
    Hard,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Style {
    #[default]
    Balanced,
    /// Attacks first and asks later.
    Rusher,
    /// Holds its ground near its own property.
    Turtle,
    /// Grabs property and money.
    Economist,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    #[serde(default)]
    pub level: Level,
    #[serde(default)]
    pub style: Style,
}

impl Profile {
    fn attack_weight(&self) -> i64 {
        match self.style {
            Style::Rusher => 13,
            Style::Turtle => 10,
            Style::Economist => 9,
            Style::Balanced => 10,
        }
    }
    fn capture_weight(&self) -> i64 {
        match self.style {
            Style::Economist => 15,
            Style::Rusher => 8,
            _ => 10,
        }
    }
}

pub fn next_action(g: &Game) -> Action {
    next_action_with(g, &Profile::default())
}

pub fn next_action_with(real: &Game, p: &Profile) -> Action {
    next_action_for(real, real.s.turn, p)
}

/// The next action for `me`, who must be one of the players whose turn it is.
pub fn next_action_for(real: &Game, me: usize, p: &Profile) -> Action {
    // Plan with what this side can see.
    let seen;
    let g = if real.s.options.fog || real.s.units.iter().any(|u| u.dived) {
        seen = real.as_seen_by(me);
        &seen
    } else {
        real
    };
    // Answer diplomatic offers first.
    if let Some(o) = real.s.offers.iter().find(|o| o.to == me) {
        return answer(real, me, o);
    }
    if let Some(a) = power_action(g, me, p) {
        return a;
    }
    let danger = if p.level == Level::Hard { Some(Danger::new(g, me)) } else { None };
    let mut waiting: Vec<&Unit> = g.s.units.iter().filter(|u| u.player == me && !u.moved).collect();
    // Units in the middle of a capture go first, then artillery (before its
    // targets move away), then the most valuable units; transports last so
    // passengers can get in first.
    waiting.sort_by_key(|u| {
        let def = g.def(u);
        (def.slots() > 0, u.capture == 0, !def.indirect(), std::cmp::Reverse(def.cost), u.id)
    });
    // The hard level looks at every unit and plays the best move anyone has.
    if p.level == Level::Hard && waiting.len() > 1 {
        let mut top: Option<(i64, Action)> = None;
        for u in &waiting {
            if let Some((score, a)) = scored_action(g, u, p, danger.as_ref()) {
                if top.as_ref().is_none_or(|t| score > t.0) {
                    top = Some((score, a));
                }
            }
        }
        if let Some((_, a)) = top {
            return a;
        }
    }
    if let Some(unit) = waiting.first() {
        return unit_action(g, unit, p, danger.as_ref());
    }
    build_action(g, me, p).unwrap_or(Action::EndTurn)
}

/// Accept a truce or alliance when there are more than two sides and neither
/// of us is running away with the game.
fn answer(g: &Game, me: usize, o: &Offer) -> Action {
    let alive: Vec<usize> = (0..g.s.players.len()).filter(|p| g.s.players[*p].alive).collect();
    let mut teams: Vec<usize> = alive.iter().map(|p| g.team(*p)).collect();
    teams.sort_unstable();
    teams.dedup();
    let leader = alive.iter().copied().max_by_key(|p| g.score(*p));
    let crowded = teams.len() > 2;
    let ok = match o.pact {
        Pact::Truce { .. } => crowded,
        Pact::Alliance => crowded && leader != Some(o.from) && leader != Some(me),
    };
    if ok {
        Action::Accept { from: o.from }
    } else {
        Action::Decline { from: o.from }
    }
}

/// A small, steady pseudo-random number for the easy level's mistakes.
fn noise(g: &Game, a: u32, b: i32, c: i32) -> i64 {
    let mut h = (g.s.day as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (a as u64) << 20 ^ (b as u64) << 40 ^ c as u64;
    h ^= h >> 31;
    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h ^= h >> 29;
    (h % 1000) as i64
}

// ---- powers ---------------------------------------------------------------

fn power_action(g: &Game, me: usize, p: &Profile) -> Option<Action> {
    let options = g.power_options(me);
    if options.is_empty() || p.level == Level::Easy && g.s.day.is_multiple_of(2) {
        return None;
    }
    let mine: Vec<&Unit> = g.s.units.iter().filter(|u| u.player == me).collect();
    let enemies: Vec<&Unit> = g.s.units.iter().filter(|u| !g.allied(u.player, me)).collect();
    let near = mine
        .iter()
        .filter(|u| enemies.iter().any(|e| ((e.x - u.x).abs() + (e.y - u.y).abs()) <= 6))
        .count() as i64;
    let hurt: i64 = mine.iter().map(|u| (100 - u.hp) as i64).sum();
    let mut best: Option<(i64, usize)> = None;
    for i in options {
        let mut score = 0i64;
        for e in &g.rules.powers[i].effects {
            score += match e {
                Effect::Attack { percent } => *percent as i64 * near * if p.style == Style::Rusher { 3 } else { 2 },
                Effect::Defense { percent } => *percent as i64 * near * if p.style == Style::Turtle { 3 } else { 1 },
                Effect::Move { tiles } => *tiles as i64 * near * 10,
                Effect::Vision { tiles } => if g.s.options.fog { *tiles as i64 * 15 } else { 0 },
                Effect::Heal { hp } => *hp as i64 * hurt / 10,
                Effect::Funds { amount } => *amount as i64 / if p.style == Style::Economist { 40 } else { 100 },
                Effect::Resupply => if g.s.options.supply { mine.len() as i64 * 10 } else { 0 },
            };
        }
        // Spend charge on the dearest power that is worth it.
        score += g.rules.powers[i].charge as i64 / 1000;
        if best.is_none_or(|b| score > b.0) {
            best = Some((score, i));
        }
    }
    let (score, i) = best?;
    (score > 100).then(|| Action::Power { power: g.rules.powers[i].id.clone() })
}

// ---- danger map (hard level) ------------------------------------------------

/// For each tile, the damage enemies could deal there next turn, per unit kind.
struct Danger {
    width: i32,
    /// `threat[i]` lists (enemy kind, enemy health) able to hit tile `i`.
    threat: Vec<Vec<(usize, u32)>>,
}

impl Danger {
    fn new(g: &Game, me: usize) -> Danger {
        let n = g.s.terrain.len();
        let mut threat = vec![vec![]; n];
        for e in g.s.units.iter().filter(|u| !g.allied(u.player, me)) {
            let def = g.def(e);
            if def.damage.is_empty() {
                continue;
            }
            let reach = g.search(e.kind, e.player, e.x, e.y, def.moves, true);
            let mut hit = vec![false; n];
            for y in 0..g.s.height {
                for x in 0..g.s.width {
                    let from_here = if def.indirect() { x == e.x && y == e.y } else { reach.cost(x, y) != UNREACHABLE };
                    if !from_here {
                        continue;
                    }
                    let far = def.range[1] as i32;
                    for dy in -far..=far {
                        for dx in -far..=far {
                            let d = (dx.abs() + dy.abs()) as u32;
                            if d >= def.range[0] && d <= def.range[1] && g.inside(x + dx, y + dy) {
                                hit[g.at(x + dx, y + dy)] = true;
                            }
                        }
                    }
                }
            }
            for (i, h) in hit.iter().enumerate() {
                if *h {
                    threat[i].push((e.kind, e.health()));
                }
            }
        }
        Danger { width: g.s.width, threat }
    }

    /// Expected loss, in funds, for `unit` standing on `(x, y)`.
    fn cost(&self, g: &Game, unit: &Unit, x: i32, y: i32) -> i64 {
        let i = (y * self.width + x) as usize;
        let def = g.def(unit);
        let stars = if def.flying { 0 } else { g.terrain(x, y).defense };
        let mut dmg = 0i64;
        for (kind, health) in &self.threat[i] {
            let base = g.base_damage(*kind, unit.kind) as i64;
            dmg += base * *health as i64 / 10 * (100 - (stars * 10) as i64) / 100;
        }
        dmg.min(unit.hp as i64) * def.cost as i64 / 100
    }
}

// ---- moving units -----------------------------------------------------------

fn unit_action(g: &Game, unit: &Unit, p: &Profile, danger: Option<&Danger>) -> Action {
    if let Some((_, a)) = scored_action(g, unit, p, danger) {
        return a;
    }
    let def = g.def(unit);
    let supply_on = g.s.options.supply;
    let reach = g.reach(unit);
    // Get into a transport when the walk is long.
    if def.can_capture {
        if let Some(a) = board(g, unit, &reach) {
            return a;
        }
    }
    // Transports: let passengers out near their goal.
    if !unit.cargo.is_empty() {
        if let Some(a) = ferry(g, unit, &reach) {
            return a;
        }
    }
    let (x, y) = advance(g, unit, p, danger);
    // Submarines dive when enemies are about, and come up when fuel runs low.
    let then = if def.can_dive && !unit.dived && enemy_near(g, unit, 8) && !(supply_on && low_supply(g, unit)) {
        Then::Dive
    } else if unit.dived && supply_on && low_supply(g, unit) {
        Then::Surface
    } else {
        Then::Wait
    };
    Action::Move { unit: unit.id, x, y, then }
}

/// The unit's best attack, capture, join or resupply this turn, with its score.
fn scored_action(g: &Game, unit: &Unit, p: &Profile, danger: Option<&Danger>) -> Option<(i64, Action)> {
    let def = g.def(unit);
    let reach = g.reach(unit);
    let me = unit.player;
    let mut best: Option<(i64, i32, i32, Then)> = None;
    let mut consider = |score: i64, x: i32, y: i32, then: Then| {
        if best.as_ref().is_none_or(|b| score > b.0) {
            best = Some((score, x, y, then));
        }
    };
    let easy = p.level == Level::Easy;
    let wobble = |x: i32, y: i32| if easy { noise(g, unit.id, x, y) * 3 - 1500 } else { 0 };
    let supply_on = g.s.options.supply;

    for y in 0..g.s.height {
        for x in 0..g.s.width {
            if reach.cost(x, y) == UNREACHABLE {
                continue;
            }
            let stop = g.can_stop(unit, x, y);
            let other = g.unit_at(x, y).filter(|o| o.id != unit.id);
            // Merge badly hurt units into another of the same kind.
            if let Some(o) = other {
                if g.can_join(unit, o) && unit.hp + o.hp <= 110 && (unit.hp <= 50 || o.hp <= 50) {
                    consider(2500 + wobble(x, y), x, y, Then::Join);
                }
            }
            if !stop {
                continue;
            }
            let terrain = g.terrain(x, y);
            let cover = if def.flying { 0 } else { terrain.defense as i64 * 20 };
            // The storm hurts: stay out of it.
            let storm = if g.in_storm(x, y) { 3000 } else { 0 };
            let risk = danger.map_or(0, |d| d.cost(g, unit, x, y) / 60) + storm;

            // King of the hill: stand on it, or knock an enemy off it.
            if g.s.hill == Some([x, y]) && !def.flying {
                let mut score = 6000;
                if let Some([t, n]) = g.s.hold {
                    if t as usize != g.team(me) {
                        score += 3000 * n as i64;
                    }
                }
                consider(score - risk + wobble(x, y), x, y, Then::Wait);
            }

            if g.can_capture(unit, x, y) {
                let mut score = 4000 + unit.health() as i64 * 100 + terrain.income as i64 / 10 + terrain.attack_bonus as i64 * 150;
                if terrain.hq {
                    score += 20000;
                }
                if !terrain.builds.is_empty() {
                    score += 1500;
                }
                if x == unit.x && y == unit.y && unit.capture > 0 {
                    score += 6000;
                }
                // Closer is better: the capture starts sooner.
                score -= reach.cost(x, y) as i64 * 10;
                score = score * p.capture_weight() / 10 - risk / 2;
                consider(score + wobble(x, y), x, y, Then::Capture);
            }

            for t in g.targets(unit, x, y) {
                let target = g.unit(t.unit).unwrap();
                let value = g.def(target).cost as i64;
                // The hard level counts on average luck, the others on the worst.
                let expect = if p.level == Level::Hard { (t.min + t.max) / 2 } else { t.min };
                let dealt = expect.min(target.hp) as i64;
                let taken = t.counter.min(unit.hp) as i64;
                let mut score = dealt * value / 100 - taken * def.cost as i64 * 8 / 1000 + cover;
                if dealt >= target.hp as i64 {
                    score += value / 5 + 500;
                }
                if target.capture > 0 {
                    score += 3000;
                }
                if g.def(target).slots() > 0 && !target.cargo.is_empty() {
                    score += 1500;
                }
                score = score * p.attack_weight() / 10 - risk;
                if score > 0 {
                    consider(score + wobble(x, y), x, y, Then::Attack(t.unit));
                }
            }

            // A carrier next to thirsty friends refills them.
            if def.supplies && supply_on {
                let thirsty = g
                    .s
                    .units
                    .iter()
                    .filter(|o| o.id != unit.id && g.allied(o.player, me) && (o.x - x).abs() + (o.y - y).abs() == 1)
                    .filter(|o| low_supply(g, o))
                    .count() as i64;
                if thirsty > 0 {
                    consider(1500 * thirsty - risk, x, y, Then::Supply);
                }
            }
        }
    }

    best.map(|(score, x, y, then)| (score, Action::Move { unit: unit.id, x, y, then }))
}

fn enemy_near(g: &Game, unit: &Unit, range: i32) -> bool {
    g.s.units.iter().any(|e| !g.allied(e.player, unit.player) && (e.x - unit.x).abs() + (e.y - unit.y).abs() <= range)
}

/// Low on fuel (aircraft and ships would be lost) or out of ammunition.
fn low_supply(g: &Game, u: &Unit) -> bool {
    if !g.s.options.supply {
        return false;
    }
    let d = g.def(u);
    (d.fuel > 0 && d.fuel_per_day > 0 && u.fuel <= d.fuel_per_day * 4 + d.moves)
        || (d.fuel > 0 && u.fuel * 5 < d.fuel)
        || (d.ammo > 0 && u.ammo == 0)
}

/// Board a friendly transport in reach that has not moved yet, if the unit's
/// nearest capture is far away on foot.
fn board(g: &Game, unit: &Unit, reach: &Reach) -> Option<Action> {
    let plan = g.search(unit.kind, unit.player, unit.x, unit.y, UNREACHABLE - 1, true);
    let def = g.def(unit);
    let far = (0..g.s.height)
        .flat_map(|y| (0..g.s.width).map(move |x| (x, y)))
        .filter(|(x, y)| g.can_capture(unit, *x, *y))
        .map(|(x, y)| plan.cost(x, y))
        .min()
        .unwrap_or(UNREACHABLE);
    if far != UNREACHABLE && far <= def.moves * 2 {
        return None;
    }
    let t = g
        .s
        .units
        .iter()
        .filter(|t| !t.moved && g.can_load(unit, t) && reach.cost(t.x, t.y) != UNREACHABLE)
        .min_by_key(|t| reach.cost(t.x, t.y))?;
    Some(Action::Move { unit: unit.id, x: t.x, y: t.y, then: Then::Load })
}

/// Move a loaded transport toward the property its passengers should take,
/// and let them out next to it when close.
fn ferry(g: &Game, t: &Unit, reach: &Reach) -> Option<Action> {
    let cargo = &t.cargo[0];
    let mut probe = cargo.clone();
    probe.player = t.player;
    // Where the passenger wants to go: the nearest property it could capture,
    // or any enemy for combat units.
    let plan = g.search(t.kind, t.player, t.x, t.y, UNREACHABLE - 1, true);
    let mut goal: Option<(u32, i32, i32)> = None;
    for y in 0..g.s.height {
        for x in 0..g.s.width {
            let wanted = if g.def(cargo).can_capture {
                g.can_capture(&probe, x, y) && g.unit_at(x, y).is_none()
            } else {
                g.unit_at(x, y).is_some_and(|e| !g.allied(e.player, t.player))
            };
            if wanted {
                offer(&mut goal, nearest_approach(g, &plan, x, y), x, y);
            }
        }
    }
    let (_, gx, gy) = goal?;
    // Best tile in reach: one from which a passenger can step out next to the goal.
    let mut best: Option<(u32, i32, i32, Vec<Drop>)> = None;
    for y in 0..g.s.height {
        for x in 0..g.s.width {
            if reach.cost(x, y) == UNREACHABLE || !g.can_stop(t, x, y) {
                continue;
            }
            let mut moved = t.clone();
            moved.x = x;
            moved.y = y;
            let mut drops = vec![];
            let mut used = vec![];
            for c in &t.cargo {
                let tiles = g.drop_tiles(&moved, c, x, y);
                if let Some(tile) = tiles
                    .iter()
                    .filter(|p| !used.contains(*p))
                    .min_by_key(|p| (p[0] - gx).abs() + (p[1] - gy).abs())
                {
                    if (tile[0] - gx).abs() + (tile[1] - gy).abs() <= g.def(c).moves as i32 {
                        drops.push(Drop { unit: c.id, x: tile[0], y: tile[1] });
                        used.push(*tile);
                    }
                }
            }
            if !drops.is_empty() {
                let d = ((x - gx).abs() + (y - gy).abs()) as u32;
                if best.as_ref().is_none_or(|b| d < b.0) {
                    best = Some((d, x, y, drops));
                }
            }
        }
    }
    if let Some((_, x, y, drops)) = best {
        return Some(Action::Move { unit: t.id, x, y, then: Then::Unload(drops) });
    }
    // Not there yet: head for the goal.
    let (x, y) = toward(g, t, &plan, reach, gx, gy, 0);
    Some(Action::Move { unit: t.id, x, y, then: Then::Wait })
}

/// With nothing to shoot or capture this turn, pick the tile that gets the
/// unit closest to something worth reaching.
fn advance(g: &Game, unit: &Unit, p: &Profile, danger: Option<&Danger>) -> (i32, i32) {
    let def = g.def(unit);
    let me = unit.player;
    let reach = g.reach(unit);
    // Plan the whole route as if no units were in the way.
    let plan = g.search(unit.kind, unit.player, unit.x, unit.y, UNREACHABLE - 1, true);

    let mut goal: Option<(u32, i32, i32)> = None;
    // Caught in the storm: head for the middle.
    if g.in_storm(unit.x, unit.y) {
        let (cx, cy) = (g.s.width / 2, g.s.height / 2);
        offer(&mut goal, nearest_approach(g, &plan, cx, cy).min(UNREACHABLE - 1), cx, cy);
    }
    // King of the hill: half the army heads for the hill.
    if let (Mode::KingOfTheHill { .. }, Some([hx, hy])) = (&g.s.options.mode, g.s.hill) {
        if goal.is_none() && !def.flying && unit.id.is_multiple_of(2) {
            offer(&mut goal, nearest_approach(g, &plan, hx, hy), hx, hy);
        }
    }
    // Out of fuel or ammunition: go home (or to a carrier) first.
    if low_supply(g, unit) {
        for y in 0..g.s.height {
            for x in 0..g.s.width {
                let home = g.owner(x, y) == Some(me) && g.terrain(x, y).repairs.contains(&def.class);
                let carrier = g.unit_at(x, y).is_some_and(|o| o.player == me && g.def(o).supplies);
                if home && g.unit_at(x, y).is_none_or(|o| o.id == unit.id) {
                    offer(&mut goal, plan.cost(x, y), x, y);
                } else if carrier {
                    offer(&mut goal, nearest_approach(g, &plan, x, y), x, y);
                }
            }
        }
    }
    // Transports with nothing aboard go to friends who could use a ride.
    if goal.is_none() && def.slots() > 0 {
        for o in g.s.units.iter().filter(|o| o.player == me && g.can_load(o, unit)) {
            offer(&mut goal, nearest_approach(g, &plan, o.x, o.y), o.x, o.y);
        }
    }
    if goal.is_none() && def.can_capture {
        for y in 0..g.s.height {
            for x in 0..g.s.width {
                if !g.can_capture(unit, x, y) {
                    continue;
                }
                // Leave a property alone if a friend is already standing on it.
                if g.unit_at(x, y).is_some_and(|u| g.allied(u.player, me) && u.id != unit.id) {
                    continue;
                }
                let bonus = if g.terrain(x, y).hq { 3 } else { 0 };
                offer(&mut goal, plan.cost(x, y).saturating_sub(bonus), x, y);
            }
        }
    }
    let turtle_home = if p.style == Style::Turtle { home_tile(g, me) } else { None };
    if goal.is_none() {
        for other in &g.s.units {
            if g.allied(other.player, me) || g.base_damage(unit.kind, other.kind) == 0 || (other.dived && !def.detects_dived) {
                continue;
            }
            // A turtle only goes out for enemies close to home.
            if let Some((hx, hy)) = turtle_home {
                if (other.x - hx).abs() + (other.y - hy).abs() > 10 {
                    continue;
                }
            }
            offer(&mut goal, nearest_approach(g, &plan, other.x, other.y), other.x, other.y);
        }
    }
    if let (None, Some((hx, hy))) = (goal, turtle_home) {
        // Stay near home, on good ground.
        return toward(g, unit, &plan, &reach, hx, hy, 3);
    }
    if goal.is_none() {
        // Nothing to fight: head for enemy property to get in the way.
        for y in 0..g.s.height {
            for x in 0..g.s.width {
                if g.terrain(x, y).capturable && g.owner(x, y).is_some_and(|o| !g.allied(o, me)) {
                    offer(&mut goal, nearest_approach(g, &plan, x, y), x, y);
                }
            }
        }
    }
    let Some((_, gx, gy)) = goal else {
        return (unit.x, unit.y);
    };
    let keep_away = if g.unit_at(gx, gy).is_some_and(|u| !g.allied(u.player, me)) { def.range[0] as i32 } else { 0 };
    let pick = toward(g, unit, &plan, &reach, gx, gy, keep_away);
    // The hard level will not walk into a slaughter just to get closer.
    if let Some(d) = danger {
        let here = d.cost(g, unit, pick.0, pick.1);
        if here >= def.cost as i64 * 9 / 10 {
            let stay = d.cost(g, unit, unit.x, unit.y);
            if stay < here / 3 {
                return (unit.x, unit.y);
            }
        }
    }
    pick
}

/// The player's headquarters, or any property they own.
fn home_tile(g: &Game, me: usize) -> Option<(i32, i32)> {
    let mut any = None;
    for y in 0..g.s.height {
        for x in 0..g.s.width {
            if g.owner(x, y) == Some(me) {
                if g.terrain(x, y).hq {
                    return Some((x, y));
                }
                any.get_or_insert((x, y));
            }
        }
    }
    any
}

/// The tile in reach that is furthest along the planned route to `(gx, gy)`,
/// staying at least `keep_away` tiles from it.
fn toward(g: &Game, unit: &Unit, plan: &Reach, reach: &Reach, gx: i32, gy: i32, keep_away: i32) -> (i32, i32) {
    // Aim for the goal itself if the unit can stand there, else for the best
    // tile next to it, then walk back along the route to a tile reachable now.
    let (mut tx, mut ty) = (gx, gy);
    if plan.cost(gx, gy) == UNREACHABLE {
        let mut near = UNREACHABLE;
        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
            let (nx, ny) = (gx + dx, gy + dy);
            if g.inside(nx, ny) && plan.cost(nx, ny) < near {
                near = plan.cost(nx, ny);
                tx = nx;
                ty = ny;
            }
        }
        if near == UNREACHABLE {
            return (unit.x, unit.y);
        }
    }
    let route = plan.path(tx, ty);
    for step in route.iter().rev() {
        let (x, y) = (step[0], step[1]);
        let apart = (x - gx).abs() + (y - gy).abs();
        if apart < keep_away {
            continue;
        }
        if reach.cost(x, y) == UNREACHABLE || !g.can_stop(unit, x, y) {
            continue;
        }
        if g.in_storm(x, y) && !g.in_storm(unit.x, unit.y) {
            continue;
        }
        // Do not park on a friendly factory: it could not build.
        if g.owner(x, y) == Some(unit.player) && !g.terrain(x, y).builds.is_empty() && (x, y) != (unit.x, unit.y) {
            continue;
        }
        return (x, y);
    }
    (unit.x, unit.y)
}

fn offer(goal: &mut Option<(u32, i32, i32)>, cost: u32, x: i32, y: i32) {
    if cost != UNREACHABLE && goal.is_none_or(|g| cost < g.0) {
        *goal = Some((cost, x, y));
    }
}

/// Cost to reach `(x, y)` or, if the unit cannot stand there, a tile beside it.
fn nearest_approach(g: &Game, plan: &Reach, x: i32, y: i32) -> u32 {
    let mut best = plan.cost(x, y);
    for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
        let (nx, ny) = (x + dx, y + dy);
        if g.inside(nx, ny) {
            best = best.min(plan.cost(nx, ny));
        }
    }
    best
}

// ---- building ---------------------------------------------------------------

fn build_action(g: &Game, me: usize, p: &Profile) -> Option<Action> {
    let funds = g.s.players[me].funds;
    let mine: Vec<&Unit> = g.s.units.iter().filter(|u| u.player == me).collect();
    // The easy level builds one unit a turn.
    if p.level == Level::Easy && g.s.units.iter().any(|u| u.player == me && u.moved && u.hp == 100 && built_this_turn(g, u)) {
        return None;
    }
    let enemies: Vec<&Unit> = g.s.units.iter().filter(|u| !g.allied(u.player, me)).collect();
    let capturers = mine.iter().filter(|u| g.def(u).can_capture).count()
        + mine.iter().map(|u| u.cargo.iter().filter(|c| g.def(c).can_capture).count()).sum::<usize>();
    let open_property = (0..g.s.terrain.len())
        .filter(|i| {
            g.rules.terrains[g.s.terrain[*i] as usize].capturable
                && (g.s.owner[*i] < 0 || !g.allied(g.s.owner[*i] as usize, me))
        })
        .count();
    let extra = if p.style == Style::Economist { 2 } else { 0 };
    let want_capturers = (2 + open_property / 3 + extra).min(6 + extra);
    let transports = mine.iter().filter(|u| g.def(u).slots() > 0).count();
    let want_transport = p.level != Level::Easy && transports == 0 && property_needs_ferry(g, me);
    let carriers = mine.iter().filter(|u| g.def(u).supplies).count();
    let want_carrier = g.s.options.supply && carriers * 8 < mine.len();

    for y in 0..g.s.height {
        for x in 0..g.s.width {
            let options = g.build_options(me, x, y);
            if options.is_empty() {
                continue;
            }
            let mut best: Option<(i64, usize)> = None;
            for (kind, cost) in options {
                if cost > funds {
                    continue;
                }
                let def = &g.rules.units[kind];
                let owned = mine.iter().filter(|u| u.kind == kind).count() as i64;
                let mut score: i64;
                if def.can_capture && capturers < want_capturers {
                    // Cheapest capturer first.
                    score = 100_000 - cost as i64;
                } else if def.slots() > 0 && def.damage.is_empty() {
                    // Unarmed transports and carriers only when needed.
                    let ferry = want_transport && def.carry.iter().any(|c| c == "infantry");
                    if !(ferry || want_carrier && def.supplies) {
                        continue;
                    }
                    score = 90_000 - cost as i64;
                } else {
                    // How well it trades against what the enemy has in the field,
                    // or against everything if the field is empty.
                    let against: Vec<usize> = if enemies.is_empty() {
                        (0..g.rules.units.len()).collect()
                    } else {
                        enemies.iter().map(|u| u.kind).collect()
                    };
                    let mut trade = 0i64;
                    let mut useful = false;
                    for e in &against {
                        let out = g.base_damage(kind, *e) as i64;
                        let back = g.base_damage(*e, kind) as i64;
                        useful |= out > 0;
                        trade += out - back / 2;
                    }
                    if !useful {
                        continue;
                    }
                    score = trade * 10 / against.len() as i64;
                    // Spend the money: a stronger unit beats savings.
                    score += (cost as i64 / 200).min(120);
                    score -= owned * 150;
                    if def.can_capture {
                        score -= 300;
                    }
                    match p.style {
                        Style::Turtle if def.indirect() => score += 200,
                        Style::Rusher if def.moves >= 6 => score += 150,
                        Style::Economist => score -= cost as i64 / 400,
                        _ => {}
                    }
                    if p.level == Level::Easy {
                        score += noise(g, kind as u32, x, y) / 2;
                    }
                }
                score -= (x + y) as i64 % 3; // steady tie-break
                if best.is_none_or(|b| score > b.0) {
                    best = Some((score, kind));
                }
            }
            if let Some((_, kind)) = best {
                return Some(Action::Build { x, y, unit: g.rules.units[kind].id.clone() });
            }
        }
    }
    None
}

fn built_this_turn(g: &Game, u: &Unit) -> bool {
    // A freshly built unit stands on a factory of ours and has acted.
    g.owner(u.x, u.y) == Some(u.player) && !g.terrain(u.x, u.y).builds.is_empty() && u.capture == 0
}

/// True when some property we do not own cannot be walked to from any of our
/// factories: then a transport pays off.
fn property_needs_ferry(g: &Game, me: usize) -> bool {
    let Some(foot) = g.rules.units.iter().position(|u| u.can_capture) else {
        return false;
    };
    let mut reachable = vec![false; g.s.terrain.len()];
    for y in 0..g.s.height {
        for x in 0..g.s.width {
            if g.owner(x, y) == Some(me) && !g.terrain(x, y).builds.is_empty() {
                let r = g.search(foot, me, x, y, UNREACHABLE - 1, true);
                for (i, d) in r.dist.iter().enumerate() {
                    reachable[i] |= *d != UNREACHABLE;
                }
            }
        }
    }
    (0..g.s.terrain.len()).any(|i| {
        g.rules.terrains[g.s.terrain[i] as usize].capturable
            && (g.s.owner[i] < 0 || !g.allied(g.s.owner[i] as usize, me))
            && !reachable[i]
    })
}
