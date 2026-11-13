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
    assert!(ev.contains(&Event::Over { winner: Some(0) }));
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
    for (name, text) in bundled_maps() {
        let (name, text) = (name.as_str(), text.as_str());
        let run = |seed: u64| {
            let mut r = rules();
            r.victory.day_limit = 80;
            let mut g = Game::new(r, &map(text), seed).unwrap();
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
