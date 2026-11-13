//! OpenTactics rules engine: a turn-based tactical skirmish on a square grid.
//!
//! Everything that makes a game (terrain, units, damage, money, victory) comes
//! from a JSON rule set (`rules::Rules`); a map (`rules::MapDef`) says what the
//! battlefield looks like. `game::Game` holds a match and `ai::next_action`
//! plays one. The same code runs in the browser (as WebAssembly) and on the
//! server, which is how online games are kept honest.

pub mod ai;
pub mod game;
pub mod rules;

pub use game::{Action, Drop, Event, Game, Mode, Offer, Options, Pact, Setup, State, Then, Truce, Unit};
pub use rules::{MapDef, Rules};
