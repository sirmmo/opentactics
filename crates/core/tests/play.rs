use opentactics_core::game::UNREACHABLE;
use opentactics_core::{ai, Action, Event, Game, MapDef, Rules, Then};

fn rules() -> Rules {
    Rules::from_json(include_str!("../../../site/rules/default.json")).unwrap()
}

fn map(text: &str) -> MapDef {
    MapDef::from_json(text).unwrap()
}

const DUEL: &str = r#"{
  "name": "Duel", "width": 6, "height": 4, "players": 2,
  "tiles": ["H....H", "..^...", "...c..", "~~~~~~"],
  "owned": [{"x":0,"y":0,"player":0},{"x":5,"y":0,"player":1}],
  "units": [
    {"type":"infantry","x":1,"y":2,"player":0},
    {"type":"tank","x":1,"y":0,"player":0},
    {"type":"infantry","x":4,"y":1,"player":1},
    {"type":"artillery","x":4,"y":0,"player":1}
  ]
}"#;

fn duel() -> Game {
    let mut r = rules();
    r.combat.luck = 0;
    Game::new(r, &map(DUEL), 7).unwrap()
}

/// Every map listed in site/maps/index.json, as (id, JSON text).
fn bundled_maps() -> Vec<(String, String)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../site/maps");
    let index: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/index.json")).unwrap()).unwrap();
    index
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            let id = m["id"].as_str().unwrap().to_string();
            let text = std::fs::read_to_string(format!("{dir}/{id}.json")).unwrap();
            (id, text)
        })
        .collect()
}

#[test]
fn bundled_maps_load() {
    let maps = bundled_maps();
    assert!(maps.len() >= 15, "only {} maps in the index", maps.len());
    for (name, text) in maps {
        let m = map(&text);
        let g = Game::new(rules(), &m, 1).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(g.s.players.len(), m.players);
    }
}

#[test]
fn first_turn_pays_income() {
    let g = duel();
    assert_eq!(g.s.players[0].funds, 1000);
    assert_eq!(g.s.players[1].funds, 0);
}

#[test]
fn movement_respects_terrain_and_enemies() {
    let g = duel();
    let tank = g.unit_at(1, 0).unwrap();
    let reach = g.reach(tank);
    assert_eq!(reach.cost(2, 1), UNREACHABLE, "tanks cannot climb mountains");
    assert_eq!(reach.cost(0, 3), UNREACHABLE, "tanks cannot swim");
    assert_eq!(reach.cost(4, 0), UNREACHABLE, "enemy units block");
    assert_eq!(reach.cost(3, 0), 2);
    let inf = g.unit_at(1, 2).unwrap();
    assert_eq!(g.reach(inf).cost(2, 1), 3, "one step, then two for the mountain");
}

#[test]
fn attack_and_counter() {
    let mut g = duel();
    let tank = g.unit_at(1, 0).unwrap().id;
    let foe = g.unit_at(4, 1).unwrap().id;
    let ev = g.apply(0, &Action::Move { unit: tank, x: 3, y: 1, then: Then::Attack(foe) }).unwrap();
    // Tank 75 vs infantry on a plain (1 star, full health): 75 * 0.9 = 67.
    assert!(matches!(ev[1], Event::Attack { damage: 67, hp: 33, counter: false, .. }));
    // Infantry at 4 health hits back: 5 * 0.4 * 0.9 = 1.
    assert!(matches!(ev[2], Event::Attack { damage: 1, hp: 99, counter: true, .. }));
    assert!(g.apply(0, &Action::Move { unit: tank, x: 3, y: 1, then: Then::Wait }).is_err(), "acted already");
}

#[test]
fn indirect_fire_needs_a_still_unit_and_is_not_countered() {
    let mut g = duel();
    g.apply(0, &Action::EndTurn).unwrap();
    let art = g.unit_at(4, 0).unwrap().id;
    let tank = g.unit_at(1, 0).unwrap().id;
    assert!(g.apply(1, &Action::Move { unit: art, x: 3, y: 0, then: Then::Attack(tank) }).is_err());
    let ev = g.apply(1, &Action::Move { unit: art, x: 4, y: 0, then: Then::Attack(tank) }).unwrap();
    assert_eq!(ev.len(), 1, "no counterattack against artillery");
}

#[test]
fn capture_takes_two_turns_and_hq_ends_the_game() {
    let mut g = duel();
    let inf = g.unit_at(1, 2).unwrap().id;
    g.apply(0, &Action::Move { unit: inf, x: 3, y: 2, then: Then::Capture }).unwrap();
    assert_eq!(g.owner(3, 2), None);
    g.apply(0, &Action::EndTurn).unwrap();
    g.apply(1, &Action::EndTurn).unwrap();
    g.apply(0, &Action::Move { unit: inf, x: 3, y: 2, then: Then::Capture }).unwrap();
    assert_eq!(g.owner(3, 2), Some(0));
    assert_eq!(g.income(0), 2000);

    // Now walk onto the enemy headquarters.
    let mut g = duel();
    g.s.units.retain(|u| u.player == 0);
    let inf = g.unit_at(1, 2).unwrap().id;
    g.unit_at(1, 2).unwrap();
    for u in g.s.units.iter_mut().filter(|u| u.id == inf) {
        u.x = 5;
        u.y = 0;
    }
    g.apply(0, &Action::Move { unit: inf, x: 5, y: 0, then: Then::Capture }).unwrap();
    g.apply(0, &Action::EndTurn).unwrap();
    g.apply(1, &Action::EndTurn).unwrap();
    let ev = g.apply(0, &Action::Move { unit: inf, x: 5, y: 0, then: Then::Capture }).unwrap();
    assert!(ev.iter().any(|e| matches!(e, Event::Over { winner: Some(0), .. })));
    assert!(g.s.over);
}

#[test]
fn building_costs_money_and_needs_a_factory() {
    let mut g = Game::new(rules(), &map(include_str!("../../../site/maps/first-contact.json")), 3).unwrap();
    assert!(g.apply(0, &Action::Build { x: 3, y: 1, unit: "tank".into() }).is_err(), "too expensive");
    assert!(g.apply(0, &Action::Build { x: 1, y: 1, unit: "infantry".into() }).is_err(), "not a factory");
    assert!(g.apply(0, &Action::Build { x: 3, y: 1, unit: "jet".into() }).is_err(), "wrong class");
    g.apply(0, &Action::Build { x: 3, y: 1, unit: "infantry".into() }).unwrap();
    assert!(g.unit_at(3, 1).unwrap().moved);
    assert!(g.apply(1, &Action::EndTurn).is_err(), "not their turn");
}

#[test]
fn state_round_trips_through_json() {
    let g = duel();
    let text = serde_json::to_string(&g.s).unwrap();
    let back = Game::from_state(rules(), serde_json::from_str(&text).unwrap()).unwrap();
    assert_eq!(g.s, back.s);
}

/// The computer must be able to finish a game against itself on every map,
/// and the same seed must give the same game.
#[test]
fn ai_plays_every_map_to_the_end() {
    ai_plays_all(Options::default());
}

#[test]
fn ai_plays_every_map_with_every_option() {
    let options = Options { fog: true, supply: true, weather: "random".into(), powers: true, teams: vec![], simultaneous: true };
    ai_plays_all(options);
}

fn ai_plays_all(options: Options) {
    for (name, text) in bundled_maps() {
        let (name, text) = (name.as_str(), text.as_str());
        let run = |seed: u64| {
            let mut r = rules();
            r.victory.day_limit = 80;
            let mut g = Game::with_setup(r, &map(text), seed, Setup { options: options.clone() }).unwrap();
            let mut steps = 0;
            while !g.s.over {
                let action = ai::next_action(&g);
                let player = g.s.turn;
                g.apply(player, &action).unwrap_or_else(|e| panic!("{name}: AI tried {action:?}: {e}"));
                steps += 1;
                assert!(steps < 200_000, "{name}: the AI never ends its turn");
            }
            g
        };
        let a = run(11);
        let b = run(11);
        assert_eq!(a.s, b.s, "{name}: not deterministic");
        let props = |p: usize| a.s.owner.iter().filter(|o| **o == p as i8).count();
        println!(
            "{name}: over on day {}, winner {:?}, properties {:?}, units {}",
            a.s.day,
            a.s.winner,
            (0..a.s.players.len()).map(props).collect::<Vec<_>>(),
            a.s.units.len()
        );
        assert!(a.s.units.len() > 2 || a.s.winner.is_some(), "{name}: the AI did not build an army");
    }
}

#[test]
fn armies_cannot_carry_bonuses() {
    let text = include_str!("../../../site/rules/default.json")
        .replacen(r#""name": "Red","#, r#""name": "Red", "damage_bonus": 10,"#, 1);
    assert!(text.contains("damage_bonus"), "test fixture did not patch the rules");
    let err = Rules::from_json(&text).unwrap_err();
    assert!(err.contains("damage_bonus"), "{err}");
}

#[test]
fn maps_need_not_be_mirrored() {
    // DUEL is lopsided on purpose: the rules are what must be equal, not the ground.
    let game = duel();
    assert_eq!(game.s.units.len(), 4);
}

// ---- switchable rules -------------------------------------------------------

use opentactics_core::{Drop, Options, Setup};

fn setup_game(text: &str, options: Options) -> Game {
    let mut r = rules();
    r.combat.luck = 0;
    // Small test maps: pad them to the 4-row minimum with copies of the last row.
    let mut m = map(text);
    while m.height < 4 {
        m.tiles.push(m.tiles.last().unwrap().clone());
        m.height += 1;
    }
    Game::with_setup(r, &m, 3, Setup { options }).unwrap()
}

fn kind(g: &Game, id: &str) -> usize {
    g.rules.unit_by_id(id).unwrap()
}

fn unit_on(g: &Game, x: i32, y: i32) -> u32 {
    g.unit_at(x, y).unwrap_or_else(|| panic!("no unit at {x},{y}")).id
}

const TRIO: &str = r#"{
  "name": "Trio", "width": 8, "height": 3, "players": 3,
  "tiles": ["H......H", "........", "...H...."],
  "owned": [{"x":0,"y":0,"player":0},{"x":7,"y":0,"player":1},{"x":3,"y":2,"player":2}],
  "units": [
    {"type":"tank","x":2,"y":1,"player":0},
    {"type":"tank","x":3,"y":1,"player":1},
    {"type":"infantry","x":6,"y":1,"player":2}
  ]
}"#;

#[test]
fn allies_pass_through_each_other_and_cannot_attack_each_other() {
    let g = setup_game(TRIO, Options { teams: vec![0, 0, 1], ..Default::default() });
    let tank = unit_on(&g, 2, 1);
    let ally = unit_on(&g, 3, 1);
    let reach = g.reach(g.unit(tank).unwrap());
    assert_ne!(reach.cost(4, 1), UNREACHABLE, "an ally does not block the way");
    assert!(!g.can_stop(g.unit(tank).unwrap(), 3, 1), "but you cannot stop on it");
    assert!(g.targets(g.unit(tank).unwrap(), 2, 1).iter().all(|t| t.unit != ally));
}

#[test]
fn a_team_wins_together() {
    let mut g = setup_game(TRIO, Options { teams: vec![0, 0, 1], ..Default::default() });
    g.apply(0, &Action::EndTurn).unwrap();
    g.apply(1, &Action::EndTurn).unwrap();
    let ev = g.apply(2, &Action::Resign).unwrap();
    assert!(g.s.over);
    assert_eq!(g.s.winners, vec![0, 1]);
    assert!(ev.iter().any(|e| matches!(e, Event::Over { .. })));
}

const FERRY: &str = r#"{
  "name": "Ferry", "width": 6, "height": 3, "players": 2,
  "tiles": ["H....H", "......", "......"],
  "owned": [{"x":0,"y":0,"player":0},{"x":5,"y":0,"player":1}],
  "units": [
    {"type":"infantry","x":0,"y":1,"player":0},
    {"type":"apc","x":1,"y":1,"player":0},
    {"type":"infantry","x":0,"y":2,"player":0,"hp":40},
    {"type":"infantry","x":1,"y":2,"player":0,"hp":70},
    {"type":"infantry","x":5,"y":2,"player":1}
  ]
}"#;

#[test]
fn transports_load_and_unload() {
    let mut g = setup_game(FERRY, Options::default());
    let inf = unit_on(&g, 0, 1);
    let apc = unit_on(&g, 1, 1);
    assert!(g.apply(0, &Action::Move { unit: inf, x: 1, y: 1, then: Then::Wait }).is_err());
    g.apply(0, &Action::Move { unit: inf, x: 1, y: 1, then: Then::Load }).unwrap();
    assert!(g.unit(inf).is_none());
    assert_eq!(g.unit(apc).unwrap().cargo.len(), 1);
    assert_eq!(g.unit_count(0), 4, "carried units still count");
    g.apply(0, &Action::Move { unit: apc, x: 3, y: 1, then: Then::Unload(vec![Drop { unit: inf, x: 3, y: 0 }]) }).unwrap();
    let out = g.unit(inf).unwrap();
    assert_eq!((out.x, out.y, out.moved), (3, 0, true));
    assert!(g.unit(apc).unwrap().cargo.is_empty());
}

#[test]
fn damaged_units_join() {
    let mut g = setup_game(FERRY, Options::default());
    let a = unit_on(&g, 0, 2);
    let b = unit_on(&g, 1, 2);
    let funds = g.s.players[0].funds;
    let ev = g.apply(0, &Action::Move { unit: a, x: 1, y: 2, then: Then::Join }).unwrap();
    assert!(g.unit(a).is_none());
    assert_eq!(g.unit(b).unwrap().hp, 100);
    // 40 + 70 = 110: the 10 extra comes back as money.
    assert!(ev.iter().any(|e| matches!(e, Event::Join { refund: 100, .. })));
    assert_eq!(g.s.players[0].funds, funds + 100);
}

const DEEP: &str = r#"{
  "name": "Deep", "width": 6, "height": 3, "players": 2,
  "tiles": ["H~~~~H", "~~~~~~", "~~~~~~"],
  "owned": [{"x":0,"y":0,"player":0},{"x":5,"y":0,"player":1}],
  "units": [
    {"type":"submarine","x":1,"y":1,"player":0},
    {"type":"battleship","x":4,"y":1,"player":1},
    {"type":"cruiser","x":4,"y":2,"player":1}
  ]
}"#;

#[test]
fn dived_submarines_hide_and_only_hunters_find_them() {
    let mut g = setup_game(DEEP, Options::default());
    let sub = unit_on(&g, 1, 1);
    g.apply(0, &Action::Move { unit: sub, x: 2, y: 1, then: Then::Dive }).unwrap();
    g.apply(0, &Action::EndTurn).unwrap();
    let (view, _) = g.view(1);
    assert!(view.units.iter().all(|u| u.id != sub), "a dived submarine is hidden");
    let ship = unit_on(&g, 4, 1);
    let cruiser = unit_on(&g, 4, 2);
    assert!(g.targets(g.unit(ship).unwrap(), 3, 1).iter().all(|t| t.unit != sub), "a battleship cannot hit it");
    assert!(g.targets(g.unit(cruiser).unwrap(), 2, 2).iter().any(|t| t.unit == sub), "a cruiser next to it can");
}

const MIST: &str = r#"{
  "name": "Mist", "width": 10, "height": 3, "players": 2,
  "tiles": ["H........H", "..........", "=====f===="],
  "owned": [{"x":0,"y":0,"player":0},{"x":9,"y":0,"player":1}],
  "units": [
    {"type":"recon","x":0,"y":2,"player":0},
    {"type":"infantry","x":5,"y":2,"player":1},
    {"type":"infantry","x":9,"y":2,"player":1}
  ]
}"#;

#[test]
fn fog_hides_units_and_springs_traps() {
    let mut g = setup_game(MIST, Options { fog: true, ..Default::default() });
    let recon = unit_on(&g, 0, 2);
    let hidden = unit_on(&g, 5, 2);
    let (view, sight) = g.view(0);
    assert!(view.units.iter().all(|u| u.id != hidden), "a unit in a forest out of reach is hidden");
    assert!(!sight[g.at(9, 2)]);
    // The recon drives through the forest without knowing: it is stopped next to it.
    let ev = g.apply(0, &Action::Move { unit: recon, x: 6, y: 2, then: Then::Wait }).unwrap();
    assert!(ev.iter().any(|e| matches!(e, Event::Trapped { x: 5, y: 2, .. })));
    let r = g.unit(recon).unwrap();
    assert_eq!((r.x, r.y, r.moved), (4, 2, true));
}

const SKY: &str = r#"{
  "name": "Sky", "width": 6, "height": 3, "players": 2,
  "tiles": ["H....H", "......", "......"],
  "owned": [{"x":0,"y":0,"player":0},{"x":5,"y":0,"player":1}],
  "units": [
    {"type":"jet","x":2,"y":1,"player":0},
    {"type":"tank","x":0,"y":2,"player":0},
    {"type":"infantry","x":5,"y":2,"player":1}
  ]
}"#;

#[test]
fn supply_rules_spend_fuel_and_ammo() {
    let mut g = setup_game(SKY, Options { supply: true, ..Default::default() });
    let jet = unit_on(&g, 2, 1);
    let tank = unit_on(&g, 0, 2);
    g.apply(0, &Action::Move { unit: tank, x: 4, y: 2, then: Then::Attack(unit_on(&g, 5, 2)) }).unwrap();
    assert_eq!(g.unit(tank).unwrap().fuel, 66);
    assert_eq!(g.unit(tank).unwrap().ammo, 8);
    // A jet out of fuel falls out of the sky at the start of its turn.
    g.s.units.iter_mut().find(|u| u.id == jet).unwrap().fuel = 3;
    g.apply(0, &Action::EndTurn).unwrap();
    let ev = g.apply(1, &Action::EndTurn).unwrap();
    assert!(ev.iter().any(|e| matches!(e, Event::Crash { unit, .. } if *unit == jet)));
    assert!(g.unit(jet).is_none());
}

#[test]
fn snow_slows_everyone() {
    let clear = setup_game(SKY, Options::default());
    let snow = setup_game(SKY, Options { weather: "snow".into(), ..Default::default() });
    let k = kind(&clear, "tank");
    assert_eq!(clear.move_cost(k, 1, 1), 1);
    assert_eq!(snow.move_cost(k, 1, 1), 2);
}

#[test]
fn powers_charge_with_damage_and_boost_attacks() {
    let mut g = setup_game(SKY, Options { powers: true, ..Default::default() });
    assert!(g.power_options(0).is_empty());
    g.s.players[0].charge = 30000;
    let tank = unit_on(&g, 0, 2);
    let inf = unit_on(&g, 5, 2);
    let plain = g.targets(g.unit(tank).unwrap(), 4, 2).into_iter().find(|t| t.unit == inf).unwrap().min;
    g.apply(0, &Action::Power { power: "blitz".into() }).unwrap();
    assert_eq!(g.s.players[0].charge, 0);
    let boosted = g.targets(g.unit(tank).unwrap(), 4, 2).into_iter().find(|t| t.unit == inf).unwrap().min;
    assert!(boosted > plain, "{boosted} > {plain}");
    assert!(g.apply(0, &Action::Power { power: "fortify".into() }).is_err(), "one power at a time");
    g.apply(0, &Action::Move { unit: tank, x: 4, y: 2, then: Then::Attack(inf) }).unwrap();
    assert!(g.s.players[1].charge > 0, "taking damage charges too");
}

#[test]
fn missions_are_won_and_lost_by_their_goals() {
    let text = r#"{
      "name": "Hold", "width": 6, "height": 3, "players": 2,
      "tiles": ["H....H", "......", "...c.."],
      "owned": [{"x":0,"y":0,"player":0},{"x":5,"y":0,"player":1}],
      "units": [{"type":"infantry","x":3,"y":1,"player":0,"tag":"hero"},{"type":"tank","x":5,"y":2,"player":1}],
      "mission": {"player": 0, "goals": [{"type":"capture","x":3,"y":2}], "fail": [{"type":"day","day":4}]}
    }"#;
    let mut g = setup_game(text, Options::default());
    let hero = unit_on(&g, 3, 1);
    g.apply(0, &Action::Move { unit: hero, x: 3, y: 2, then: Then::Capture }).unwrap();
    g.apply(0, &Action::EndTurn).unwrap();
    g.apply(1, &Action::EndTurn).unwrap();
    g.apply(0, &Action::Move { unit: hero, x: 3, y: 2, then: Then::Capture }).unwrap();
    assert!(g.s.over);
    assert_eq!(g.s.winner, Some(0));

    let mut lost = setup_game(text, Options::default());
    for _ in 0..3 {
        lost.apply(0, &Action::EndTurn).unwrap();
        lost.apply(1, &Action::EndTurn).unwrap();
    }
    assert!(lost.s.over);
    assert_eq!(lost.s.winner, Some(1));
}

use opentactics_core::ai::{next_action_with, Level, Profile, Style};

/// Play a whole game with a profile per seat; returns the winner.
fn duel_profiles(text: &str, profiles: &[Profile], options: Options, seed: u64) -> Option<usize> {
    let mut r = rules();
    r.victory.day_limit = 60;
    let mut g = Game::with_setup(r, &map(text), seed, Setup { options }).unwrap();
    let mut steps = 0;
    while !g.s.over {
        let p = g.s.turn;
        let action = next_action_with(&g, &profiles[p % profiles.len()]);
        g.apply(p, &action).unwrap_or_else(|e| panic!("AI ({:?}) tried {action:?}: {e}", profiles[p % profiles.len()]));
        steps += 1;
        assert!(steps < 200_000, "the AI never ends its turn");
    }
    g.s.winner
}

#[test]
fn hard_beats_easy_and_every_style_plays() {
    let maps = bundled_maps();
    let two: Vec<&(String, String)> = maps.iter().filter(|(_, t)| map(t).players == 2).collect();
    let hard = Profile { level: Level::Hard, style: Style::Balanced };
    let easy = Profile { level: Level::Easy, style: Style::Balanced };
    let mut hard_wins = 0;
    let mut games = 0;
    for (name, text) in &two {
        for (seed, seats) in [(1, [hard, easy]), (2, [easy, hard])] {
            let w = duel_profiles(text, &seats, Options::default(), seed);
            games += 1;
            if w.is_some_and(|w| seats[w] == hard) {
                hard_wins += 1;
            }
            println!("{name}: {:?} wins", w.map(|w| seats[w].level));
        }
    }
    assert!(hard_wins * 3 >= games * 2, "hard won only {hard_wins} of {games}");
    // Every style finishes games, with every option on.
    let all = Options { fog: true, supply: true, weather: "random".into(), powers: true, teams: vec![], simultaneous: true };
    for style in [Style::Rusher, Style::Turtle, Style::Economist] {
        let p = Profile { level: Level::Normal, style };
        for (_, text) in two.iter().take(3) {
            duel_profiles(text, &[p, hard], all.clone(), 5);
        }
    }
}

#[test]
#[ignore]
fn measure_hard_vs_normal() {
    let maps = bundled_maps();
    let hard = Profile { level: Level::Hard, style: Style::Balanced };
    let normal = Profile::default();
    let (mut h, mut n, mut d) = (0, 0, 0);
    for (_, text) in maps.iter().filter(|(_, t)| map(t).players == 2) {
        for (seed, seats) in [(1, [hard, normal]), (2, [normal, hard]), (3, [hard, normal]), (4, [normal, hard])] {
            match duel_profiles(text, &seats, Options::default(), seed) {
                Some(w) if seats[w] == hard => h += 1,
                Some(_) => n += 1,
                None => d += 1,
            }
        }
    }
    println!("hard {h} normal {n} draw {d}");
}

#[test]
fn missions_load_and_finish() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../site/missions");
    let index: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/index.json")).unwrap()).unwrap();
    for m in index.as_array().unwrap() {
        let id = m["id"].as_str().unwrap();
        let text = std::fs::read_to_string(format!("{dir}/{id}.json")).unwrap();
        let mut g = Game::new(rules(), &map(&text), 7).unwrap_or_else(|e| panic!("{id}: {e}"));
        let mut steps = 0;
        while !g.s.over {
            let p = g.s.turn;
            let action = ai::next_action(&g);
            g.apply(p, &action).unwrap_or_else(|e| panic!("{id}: AI tried {action:?}: {e}"));
            steps += 1;
            assert!(steps < 100_000, "{id}: never ends");
        }
        println!("{id}: over on day {}, mission {}", g.s.day, if g.s.winners.contains(&0) { "won" } else { "lost" });
    }
}

#[test]
fn far_players_take_their_turns_together() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../site/maps/grand-melee.json")).unwrap();
    let mut g = Game::with_setup(rules(), &map(&text), 1, Setup { options: Options { simultaneous: true, ..Default::default() } }).unwrap();
    assert_eq!(g.s.active.len(), 8, "with no units yet, nobody can reach anybody");
    // Let the computer build up armies, stopping when a new round starts on day 5.
    while g.s.day < 5 || g.s.active.len() + g.s.waiting.len() < 8 {
        let p = g.s.turn;
        let a = ai::next_action(&g);
        g.apply(p, &a).unwrap();
    }
    assert!(g.s.active.len() < 8, "armies now reach each other: {:?}", g.s.active);
    // Nobody in a group can reach anybody else in it.
    let zones: Vec<Vec<bool>> = g.s.active.iter().map(|p| g.zone(*p)).collect();
    for i in 0..zones.len() {
        for j in i + 1..zones.len() {
            assert!(!zones[i].iter().zip(&zones[j]).any(|(a, b)| *a && *b), "{:?} overlap", (g.s.active[i], g.s.active[j]));
        }
    }
    let idle = (0..8).find(|p| !g.s.active.contains(p)).unwrap();
    assert!(g.apply(idle, &Action::EndTurn).is_err(), "only active players act");
    // Over a day, everyone plays exactly once.
    let alive: Vec<usize> = (0..8).filter(|p| g.s.players[*p].alive).collect();
    let mut played = [0; 8];
    let mut rounds = 0;
    let day = g.s.day;
    while g.s.day == day && !g.s.over {
        rounds += 1;
        for p in g.s.active.clone() {
            played[p] += 1;
            g.apply(p, &Action::EndTurn).unwrap();
        }
    }
    for (p, n) in played.iter().enumerate() {
        assert_eq!(*n, if alive.contains(&p) { 1 } else { 0 }, "player {p}");
    }
    println!("{} players in {rounds} rounds", alive.len());
    // Without the option, one at a time.
    let one = Game::new(rules(), &map(&text), 1).unwrap();
    assert_eq!(one.s.active, vec![0]);
}
