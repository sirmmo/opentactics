//! WebAssembly bindings for the OpenTactics rules engine.
//!
//! The page talks to the engine with JSON: it writes a request into memory
//! from `ot_alloc`, calls `ot_call`, and reads the reply. There is one game per
//! page. No JavaScript glue is generated; see `site/js/engine.js`.

use opentactics_core::game::UNREACHABLE;
use opentactics_core::{ai, Action, Game, MapDef, Rules, State};
use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::RefCell;

thread_local! {
    static GAME: RefCell<Option<Game>> = const { RefCell::new(None) };
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    /// Start a game from a rule set and a map.
    New { rules: Value, map: Value, seed: u64 },
    /// Replace the game with a state received from a server or a save.
    Load { rules: Option<Value>, state: State },
    /// Check a map against a rule set without starting anything.
    Check { rules: Value, map: Value },
    State,
    /// Where a unit can move.
    Reach { unit: u32 },
    /// The way to a tile and what the unit could do there.
    Options { unit: u32, x: i32, y: i32 },
    /// What the current player can build on a tile.
    Builds { x: i32, y: i32 },
    Act { player: usize, action: Action },
    /// Ask the computer for the current player's next action.
    Ai,
}

fn with_game<T>(f: impl FnOnce(&mut Game) -> Result<T, String>) -> Result<T, String> {
    GAME.with(|g| f(g.borrow_mut().as_mut().ok_or("No game is running.")?))
}

fn view(g: &Game) -> Value {
    let income: Vec<u32> = (0..g.s.players.len()).map(|p| g.income(p)).collect();
    json!({ "state": g.s, "income": income })
}

fn handle(text: &str) -> Result<Value, String> {
    let request: Request = serde_json::from_str(text).map_err(|e| format!("bad request: {e}"))?;
    match request {
        Request::New { rules, map, seed } => {
            let rules = Rules::from_value(rules)?;
            let map: MapDef = serde_json::from_value(map).map_err(|e| format!("map: {e}"))?;
            let game = Game::new(rules, &map, seed)?;
            let out = view(&game);
            GAME.with(|g| *g.borrow_mut() = Some(game));
            Ok(out)
        }
        Request::Load { rules, state } => {
            let rules = match rules {
                Some(r) => Rules::from_value(r)?,
                None => with_game(|g| Ok(g.rules.clone()))?,
            };
            let game = Game::from_state(rules, state)?;
            let out = view(&game);
            GAME.with(|g| *g.borrow_mut() = Some(game));
            Ok(out)
        }
        Request::Check { rules, map } => {
            let rules = Rules::from_value(rules)?;
            let map: MapDef = serde_json::from_value(map).map_err(|e| format!("map: {e}"))?;
            Game::new(rules, &map, 1)?;
            Ok(json!({}))
        }
        Request::State => with_game(|g| Ok(view(g))),
        Request::Reach { unit } => with_game(|g| {
            let u = g.unit(unit).ok_or("That unit is gone.")?.clone();
            let reach = g.reach(&u);
            let def = g.def(&u);
            let mut tiles = vec![];
            let mut threat = vec![false; g.s.terrain.len()];
            for y in 0..g.s.height {
                for x in 0..g.s.width {
                    let stop = reach.cost(x, y) != UNREACHABLE && g.can_stop(&u, x, y);
                    if reach.cost(x, y) != UNREACHABLE {
                        tiles.push(json!([x, y, stop]));
                    }
                    // Every tile the unit could hit this turn.
                    if stop && (!def.indirect() || (x == u.x && y == u.y)) && !def.damage.is_empty() {
                        let far = def.range[1] as i32;
                        for dy in -far..=far {
                            for dx in -far..=far {
                                let d = (dx.abs() + dy.abs()) as u32;
                                if d >= def.range[0] && d <= def.range[1] && g.inside(x + dx, y + dy) {
                                    threat[g.at(x + dx, y + dy)] = true;
                                }
                            }
                        }
                    }
                }
            }
            let threat: Vec<[i32; 2]> = (0..threat.len())
                .filter(|i| threat[*i])
                .map(|i| [i as i32 % g.s.width, i as i32 / g.s.width])
                .collect();
            Ok(json!({ "tiles": tiles, "threat": threat }))
        }),
        Request::Options { unit, x, y } => with_game(|g| {
            let u = g.unit(unit).ok_or("That unit is gone.")?.clone();
            if !g.inside(x, y) {
                return Err("That tile is off the map.".into());
            }
            let reach = g.reach(&u);
            if reach.cost(x, y) == UNREACHABLE || !g.can_stop(&u, x, y) {
                return Ok(json!({ "ok": false }));
            }
            Ok(json!({
                "ok": true,
                "path": reach.path(x, y),
                "targets": g.targets(&u, x, y),
                "capture": g.can_capture(&u, x, y),
            }))
        }),
        Request::Builds { x, y } => with_game(|g| {
            let player = g.s.turn;
            let funds = g.s.players[player].funds;
            let list: Vec<Value> = g
                .build_options(player, x, y)
                .into_iter()
                .map(|(kind, cost)| json!({ "kind": kind, "cost": cost, "ok": cost <= funds }))
                .collect();
            Ok(json!({ "builds": list }))
        }),
        Request::Act { player, action } => with_game(|g| {
            let events = g.apply(player, &action)?;
            let mut out = view(g);
            out["events"] = json!(events);
            Ok(out)
        }),
        Request::Ai => with_game(|g| {
            if g.s.over {
                return Err("The game is over.".into());
            }
            Ok(json!({ "action": ai::next_action(g) }))
        }),
    }
}

#[no_mangle]
pub extern "C" fn ot_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from `ot_alloc` or `ot_call`.
#[no_mangle]
pub unsafe extern "C" fn ot_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// Run one JSON request. The reply starts with its length as four
/// little-endian bytes; free it with `ot_free(ptr, length + 4)`.
///
/// # Safety
/// `ptr` must point at `len` bytes of UTF-8.
#[no_mangle]
pub unsafe extern "C" fn ot_call(ptr: *const u8, len: usize) -> *mut u8 {
    let input = std::slice::from_raw_parts(ptr, len);
    let reply = match std::str::from_utf8(input).map_err(|e| e.to_string()).and_then(handle) {
        Ok(value) => value,
        Err(error) => json!({ "error": error }),
    };
    let text = reply.to_string().into_bytes();
    let mut out = Vec::with_capacity(text.len() + 4);
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&text);
    out.shrink_to_fit();
    debug_assert_eq!(out.capacity(), out.len());
    let ptr = out.as_mut_ptr();
    std::mem::forget(out);
    ptr
}
