//! The rule set: everything about terrain, units, money and victory is data.
//!
//! A rule set is one JSON document (see `site/rules/default.json`). The engine
//! knows nothing about "tanks" or "forests"; it only knows the fields below.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Rules {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub economy: Economy,
    pub combat: Combat,
    pub capture: Capture,
    pub repair: Repair,
    pub victory: Victory,
    /// One entry per possible player, in seat order. All seats play by the same rules.
    pub factions: Vec<Faction>,
    pub terrains: Vec<Terrain>,
    pub units: Vec<UnitDef>,
    /// Kinds of weather; the first is clear skies. Used when a game turns weather on.
    #[serde(default)]
    pub weather: Vec<WeatherDef>,
    /// Powers any player may charge up and use, when a game turns powers on.
    /// Every player chooses from the same list.
    #[serde(default)]
    pub powers: Vec<PowerDef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WeatherDef {
    pub id: String,
    pub name: String,
    /// Relative chance of this weather on a new day when weather is random.
    #[serde(default)]
    pub chance: u32,
    /// Extra movement cost per tile, by movement type.
    #[serde(default)]
    pub move_extra: BTreeMap<String, u32>,
    /// Change to how far every unit sees (fog of war).
    #[serde(default)]
    pub vision: i32,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub view: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PowerDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Charge needed. Charge is the value (in funds) of damage dealt, plus half of damage taken.
    pub charge: u32,
    /// What it does. Lasts until the start of the player's next turn.
    pub effects: Vec<Effect>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Effect {
    /// Units deal this much more damage, in percent.
    Attack { percent: u32 },
    /// Units take this much less damage: damage is divided by (100 + percent)%.
    Defense { percent: u32 },
    /// Units move this many more tiles.
    Move { tiles: u32 },
    /// Units see this many more tiles.
    Vision { tiles: u32 },
    /// Every unit heals this much health (out of 10), free.
    Heal { hp: u32 },
    /// Money now.
    Funds { amount: u32 },
    /// Every unit gets full fuel and ammunition.
    Resupply,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Economy {
    /// Money every player holds before the first turn.
    pub start_funds: u32,
    /// Most units one player may have; 0 means no limit.
    #[serde(default)]
    pub unit_cap: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Combat {
    /// A random 0..=luck is added to the base damage of every attack.
    #[serde(default)]
    pub luck: u32,
    /// Percent of damage removed per terrain defence star, scaled by the defender's health.
    pub defense_per_star: u32,
    /// Whether an adjacent defender shoots back.
    #[serde(default = "yes")]
    pub counterattack: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Capture {
    /// Points needed to take a property. A unit adds its health (1-10) each turn.
    pub points: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Repair {
    /// Health (out of 10) restored at the start of a turn on a friendly property.
    pub hp: u32,
    /// Whether repairs cost a matching share of the unit's price.
    #[serde(default = "yes")]
    pub costs: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Victory {
    /// Taking a player's headquarters defeats them.
    #[serde(default = "yes")]
    pub hq_capture: bool,
    /// Losing the last unit defeats a player.
    #[serde(default = "yes")]
    pub rout: bool,
    /// The game ends after this many days and the best score wins; 0 means no limit.
    #[serde(default)]
    pub day_limit: u32,
}

/// An army is only a name and a look. Every player gets the same units, costs and
/// rules, so anything else here (a "faction bonus") is rejected when loading.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Faction {
    pub name: String,
    #[serde(default)]
    pub view: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Terrain {
    pub id: String,
    pub name: String,
    /// The character that stands for this terrain in a map's `tiles` rows.
    pub glyph: char,
    /// Defence stars, 0-4.
    #[serde(default)]
    pub defense: u32,
    /// Cost to enter, per movement type. A missing type cannot enter.
    pub move_cost: BTreeMap<String, u32>,
    #[serde(default)]
    pub capturable: bool,
    #[serde(default)]
    pub hq: bool,
    /// Money paid to the owner at the start of each of their turns.
    #[serde(default)]
    pub income: u32,
    /// Unit classes the owner can build here.
    #[serde(default)]
    pub builds: Vec<String>,
    /// Unit classes the owner's units are repaired (and resupplied) in here.
    #[serde(default)]
    pub repairs: Vec<String>,
    /// With fog of war, units here are only seen by enemies right next to them.
    #[serde(default)]
    pub hides: bool,
    /// With fog of war, extra tiles seen by units standing here, by movement type.
    #[serde(default)]
    pub vision_bonus: BTreeMap<String, u32>,
    /// How the client draws it. The engine ignores this.
    #[serde(default)]
    pub view: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnitDef {
    pub id: String,
    pub name: String,
    /// Grouping used by `builds` and `repairs`, e.g. "ground", "air", "naval".
    pub class: String,
    pub move_type: String,
    pub moves: u32,
    pub cost: u32,
    /// Closest and farthest tile it can hit. Anything reaching past 1 is
    /// indirect: it cannot move and fire in one turn and never counterattacks.
    #[serde(default = "melee")]
    pub range: [u32; 2],
    #[serde(default)]
    pub can_capture: bool,
    /// Flying units get no terrain defence.
    #[serde(default)]
    pub flying: bool,
    /// Base damage in percent against each unit id. A missing id cannot be attacked.
    #[serde(default)]
    pub damage: BTreeMap<String, u32>,
    /// How many tiles it sees with fog of war.
    #[serde(default = "two")]
    pub vision: u32,
    /// Unit ids it can carry, and how many at once.
    #[serde(default)]
    pub carry: Vec<String>,
    #[serde(default)]
    pub capacity: u32,
    /// Refills the fuel and ammunition of friendly units next to it.
    #[serde(default)]
    pub supplies: bool,
    /// With supply rules: fuel (0 = unlimited, spent per movement point), fuel burnt
    /// at the start of each turn (a unit that burns fuel daily is lost at 0), and
    /// rounds of ammunition (0 = unlimited).
    #[serde(default)]
    pub fuel: u32,
    #[serde(default)]
    pub fuel_per_day: u32,
    #[serde(default)]
    pub ammo: u32,
    /// Can dive: hidden from enemies not right next to it.
    #[serde(default)]
    pub can_dive: bool,
    /// Extra fuel burnt per day while dived.
    #[serde(default)]
    pub dive_fuel: u32,
    /// Can find and attack dived units.
    #[serde(default)]
    pub detects_dived: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub view: Value,
}

fn yes() -> bool {
    true
}
fn melee() -> [u32; 2] {
    [1, 1]
}
fn two() -> u32 {
    2
}

impl UnitDef {
    pub fn indirect(&self) -> bool {
        self.range[1] > 1
    }

    /// How many units it can carry.
    pub fn slots(&self) -> usize {
        if self.carry.is_empty() {
            0
        } else {
            self.capacity.max(1) as usize
        }
    }
}

impl Rules {
    pub fn from_json(text: &str) -> Result<Rules, String> {
        let rules: Rules = serde_json::from_str(text).map_err(|e| format!("rules: {e}"))?;
        rules.check()?;
        Ok(rules)
    }

    pub fn from_value(value: Value) -> Result<Rules, String> {
        let rules: Rules = serde_json::from_value(value).map_err(|e| format!("rules: {e}"))?;
        rules.check()?;
        Ok(rules)
    }

    /// Reject rule sets the engine could not run.
    pub fn check(&self) -> Result<(), String> {
        if self.factions.len() < 2 {
            return Err("rules: at least two factions are needed".into());
        }
        if self.factions.len() > 8 {
            return Err("rules: at most eight factions are supported".into());
        }
        if self.terrains.is_empty() || self.terrains.len() > 250 {
            return Err("rules: between 1 and 250 terrains are needed".into());
        }
        if self.units.is_empty() || self.units.len() > 250 {
            return Err("rules: between 1 and 250 units are needed".into());
        }
        if self.capture.points == 0 {
            return Err("rules: capture.points must be at least 1".into());
        }
        let mut ids = BTreeSet::new();
        let mut glyphs = BTreeSet::new();
        for t in &self.terrains {
            if !ids.insert(&t.id) {
                return Err(format!("rules: terrain id '{}' is used twice", t.id));
            }
            if !glyphs.insert(t.glyph) {
                return Err(format!("rules: glyph '{}' is used twice", t.glyph));
            }
            if t.move_cost.values().any(|c| *c == 0) {
                return Err(format!("rules: terrain '{}' has a move cost of 0", t.id));
            }
        }
        let unit_ids: BTreeSet<&String> = self.units.iter().map(|u| &u.id).collect();
        if unit_ids.len() != self.units.len() {
            return Err("rules: a unit id is used twice".into());
        }
        for u in &self.units {
            if u.range[0] == 0 || u.range[0] > u.range[1] {
                return Err(format!("rules: unit '{}' has a bad range", u.id));
            }
            if u.moves > 40 {
                return Err(format!("rules: unit '{}' moves too far", u.id));
            }
            if u.vision > 20 {
                return Err(format!("rules: unit '{}' sees too far", u.id));
            }
            if u.carry.iter().any(|c| !unit_ids.contains(c)) {
                return Err(format!("rules: unit '{}' carries an unknown unit", u.id));
            }
            if u.capacity > 8 {
                return Err(format!("rules: unit '{}' carries too many units", u.id));
            }
            for target in u.damage.keys() {
                if !unit_ids.contains(target) {
                    return Err(format!(
                        "rules: unit '{}' lists damage against unknown unit '{}'",
                        u.id, target
                    ));
                }
            }
        }
        let mut seen = BTreeSet::new();
        for w in &self.weather {
            if !seen.insert(&w.id) {
                return Err(format!("rules: weather '{}' is listed twice", w.id));
            }
        }
        let mut seen = BTreeSet::new();
        for p in &self.powers {
            if !seen.insert(&p.id) {
                return Err(format!("rules: power '{}' is listed twice", p.id));
            }
            if p.charge == 0 {
                return Err(format!("rules: power '{}' needs a charge above 0", p.id));
            }
        }
        Ok(())
    }

    pub fn weather_by_id(&self, id: &str) -> Option<usize> {
        self.weather.iter().position(|w| w.id == id)
    }

    pub fn terrain_by_glyph(&self, glyph: char) -> Option<usize> {
        self.terrains.iter().position(|t| t.glyph == glyph)
    }

    pub fn unit_by_id(&self, id: &str) -> Option<usize> {
        self.units.iter().position(|u| u.id == id)
    }
}

/// A map: the battlefield and what starts on it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MapDef {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    pub width: usize,
    pub height: usize,
    pub players: usize,
    /// `height` strings of `width` terrain glyphs.
    pub tiles: Vec<String>,
    /// Properties that start with an owner.
    #[serde(default)]
    pub owned: Vec<Owned>,
    #[serde(default)]
    pub units: Vec<MapUnit>,
    /// Overrides the rule set's starting funds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_funds: Option<u32>,
    /// Where to fetch the rule set this map was made for. The engine ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    /// Makes the map a mission: goals, a briefing, and which seat the player takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<Mission>,
}

/// A scenario with its own way to win or lose, played from one seat.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mission {
    #[serde(default)]
    pub briefing: String,
    /// The seat the player takes; the computer plays the others.
    #[serde(default)]
    pub player: usize,
    /// Meeting any of these wins the mission (besides the usual ways to win).
    #[serde(default)]
    pub goals: Vec<Goal>,
    /// Meeting any of these loses it.
    #[serde(default)]
    pub fail: Vec<Goal>,
    /// Teams per seat, if not everyone for themselves.
    #[serde(default)]
    pub teams: Vec<usize>,
    /// Game options the mission is played with.
    #[serde(default)]
    pub options: Option<Value>,
    /// For the client: tips to show, and how the computer plays. The engine ignores them.
    #[serde(default)]
    pub hints: Value,
    #[serde(default)]
    pub ai: Value,
}

/// Something that can be true about a game, from the mission player's side.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Goal {
    /// The mission player's side owns this tile.
    Capture { x: i32, y: i32 },
    /// Another side owns this tile.
    LoseTile { x: i32, y: i32 },
    /// This day has begun.
    Day { day: u32 },
    /// No enemy units are left.
    NoEnemyUnits,
    /// The mission player's side has no units left.
    NoUnits,
    /// The unit with this tag is gone.
    UnitGone { tag: String },
    /// The unit with this tag stands on this tile.
    UnitAt { tag: String, x: i32, y: i32 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Owned {
    pub x: usize,
    pub y: usize,
    pub player: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MapUnit {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: usize,
    pub y: usize,
    pub player: usize,
    /// Health out of 100, if not full.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hp: Option<u32>,
    /// A name missions can refer to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

pub const MAX_MAP_SIDE: usize = 64;

impl MapDef {
    pub fn from_json(text: &str) -> Result<MapDef, String> {
        serde_json::from_str(text).map_err(|e| format!("map: {e}"))
    }
}
