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

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    /// Unit classes the owner's units are repaired in here.
    #[serde(default)]
    pub repairs: Vec<String>,
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

impl UnitDef {
    pub fn indirect(&self) -> bool {
        self.range[1] > 1
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
            for target in u.damage.keys() {
                if !unit_ids.contains(target) {
                    return Err(format!(
                        "rules: unit '{}' lists damage against unknown unit '{}'",
                        u.id, target
                    ));
                }
            }
        }
        Ok(())
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
}

pub const MAX_MAP_SIDE: usize = 64;

impl MapDef {
    pub fn from_json(text: &str) -> Result<MapDef, String> {
        serde_json::from_str(text).map_err(|e| format!("map: {e}"))
    }
}
