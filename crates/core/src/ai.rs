//! The computer player.
//!
//! `next_action` looks at the game and returns one action for the player whose
//! turn it is. Call it, apply the result, and repeat until it returns
//! `EndTurn`. It keeps no memory between calls and never looks at the dice, so
//! it plays by exactly the same rules as a person.

use crate::game::{Action, Game, Then, Unit, UNREACHABLE};

pub fn next_action(g: &Game) -> Action {
    let me = g.s.turn;
    let mut waiting: Vec<&Unit> = g.s.units.iter().filter(|u| u.player == me && !u.moved).collect();
    // Units in the middle of a capture go first, then artillery (before its
    // targets move away), then the most valuable units.
    waiting.sort_by_key(|u| {
        let def = g.def(u);
        (u.capture == 0, !def.indirect(), std::cmp::Reverse(def.cost), u.id)
    });
    if let Some(unit) = waiting.first() {
        return unit_action(g, unit);
    }
    build_action(g).unwrap_or(Action::EndTurn)
}

fn unit_action(g: &Game, unit: &Unit) -> Action {
    let def = g.def(unit);
    let reach = g.reach(unit);
    let mut best: Option<(i64, i32, i32, Then)> = None;
    let mut consider = |score: i64, x: i32, y: i32, then: Then| {
        if best.as_ref().map_or(true, |b| score > b.0) {
            best = Some((score, x, y, then));
        }
    };

    for y in 0..g.s.height {
        for x in 0..g.s.width {
            if reach.cost(x, y) == UNREACHABLE || !g.can_stop(unit, x, y) {
                continue;
            }
            let terrain = g.terrain(x, y);
            let cover = if def.flying { 0 } else { terrain.defense as i64 * 20 };

            if g.can_capture(unit, x, y) {
                let mut score = 4000 + unit.health() as i64 * 100 + terrain.income as i64 / 10;
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
                consider(score, x, y, Then::Capture);
            }

            for t in g.targets(unit, x, y) {
                let target = g.unit(t.unit).unwrap();
                let value = g.def(target).cost as i64;
                let dealt = t.min.min(target.hp) as i64;
                let taken = t.counter.min(unit.hp) as i64;
                let mut score = dealt * value / 100 - taken * def.cost as i64 * 8 / 1000 + cover;
                if dealt >= target.hp as i64 {
                    score += value / 5 + 500;
                }
                if target.capture > 0 {
                    score += 3000;
                }
                if score > 0 {
                    consider(score, x, y, Then::Attack(t.unit));
                }
            }
        }
    }

    if let Some((_, x, y, then)) = best {
        return Action::Move { unit: unit.id, x, y, then };
    }
    let (x, y) = advance(g, unit);
    Action::Move { unit: unit.id, x, y, then: Then::Wait }
}

/// With nothing to shoot or capture this turn, pick the tile that gets the
/// unit closest to something worth reaching.
fn advance(g: &Game, unit: &Unit) -> (i32, i32) {
    let def = g.def(unit);
    let reach = g.reach(unit);
    // Plan the whole route as if no units were in the way.
    let plan = g.search(unit.kind, unit.player, unit.x, unit.y, UNREACHABLE - 1, true);

    let mut goal: Option<(u32, i32, i32)> = None;
    if def.can_capture {
        for y in 0..g.s.height {
            for x in 0..g.s.width {
                if !g.can_capture(unit, x, y) {
                    continue;
                }
                // Leave a property alone if a friend is already standing on it.
                if g.unit_at(x, y).map_or(false, |u| u.player == unit.player && u.id != unit.id) {
                    continue;
                }
                let bonus = if g.terrain(x, y).hq { 3 } else { 0 };
                offer(&mut goal, plan.cost(x, y).saturating_sub(bonus), x, y);
            }
        }
    }
    if goal.is_none() {
        for other in &g.s.units {
            if other.player != unit.player && g.base_damage(unit.kind, other.kind) > 0 {
                offer(&mut goal, nearest_approach(g, &plan, other.x, other.y), other.x, other.y);
            }
        }
    }
    if goal.is_none() {
        // Nothing to fight: head for enemy property to get in the way.
        for y in 0..g.s.height {
            for x in 0..g.s.width {
                if g.terrain(x, y).capturable && g.owner(x, y).map_or(false, |o| o != unit.player) {
                    offer(&mut goal, nearest_approach(g, &plan, x, y), x, y);
                }
            }
        }
    }
    let Some((_, gx, gy)) = goal else {
        return (unit.x, unit.y);
    };

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
    let keep_away = def.range[0] as i32;
    let route = plan.path(tx, ty);
    for step in route.iter().rev() {
        let (x, y) = (step[0], step[1]);
        let apart = (x - gx).abs() + (y - gy).abs();
        let enemy_goal = g.unit_at(gx, gy).map_or(false, |u| u.player != unit.player);
        if enemy_goal && apart < keep_away {
            continue;
        }
        if reach.cost(x, y) == UNREACHABLE || !g.can_stop(unit, x, y) {
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
    if cost != UNREACHABLE && goal.map_or(true, |g| cost < g.0) {
        *goal = Some((cost, x, y));
    }
}

/// Cost to reach `(x, y)` or, if the unit cannot stand there, a tile beside it.
fn nearest_approach(g: &Game, plan: &crate::game::Reach, x: i32, y: i32) -> u32 {
    let mut best = plan.cost(x, y);
    for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
        let (nx, ny) = (x + dx, y + dy);
        if g.inside(nx, ny) {
            best = best.min(plan.cost(nx, ny));
        }
    }
    best
}

fn build_action(g: &Game) -> Option<Action> {
    let me = g.s.turn;
    let funds = g.s.players[me].funds;
    let mine: Vec<&Unit> = g.s.units.iter().filter(|u| u.player == me).collect();
    let enemies: Vec<&Unit> = g.s.units.iter().filter(|u| u.player != me).collect();
    let capturers = mine.iter().filter(|u| g.def(u).can_capture).count();
    let open_property = (0..g.s.terrain.len())
        .filter(|i| g.rules.terrains[g.s.terrain[*i] as usize].capturable && g.s.owner[*i] != me as i8)
        .count();
    let want_capturers = (2 + open_property / 3).min(6);

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
                }
                score -= (x + y) as i64 % 3; // steady tie-break
                if best.map_or(true, |b| score > b.0) {
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
