//! An item's ability effects without its model, as the game's loadout wears them, replacing
//! src/item-builder-ability-fx.ts.
//!
//! Every hero has hidden loadout slots, ability_effects_1 to ability_effects_9. An item that can go
//! in one says so in its static attributes (`"can_equip_as_ability_effects" "2"`) and marks the
//! modifiers that slot takes (`"apply_when_equipped_in_ability_effects_slot" "2"`). The slot's
//! stock item is one for all heroes, with no model and no visuals; a pick writes the marked
//! modifiers into it.

use regex::bytes::Regex;
use std::sync::OnceLock;

use crate::item_builder_donor::with_modifiers;
use crate::kv::{self, KvError};
use crate::schema::{inferred_item_slot, SchemaItem};

const TAG: &str = "apply_when_equipped_in_ability_effects_slot";

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

/// The number of an ability effects slot, from its name or a builder slot's id
/// (item:earthshaker:ability_effects_2); 0 for any other.
pub fn fx_slot_of(slot: &str) -> u64 {
    let lower = slot.to_lowercase();
    let name = lower.rsplit(':').next().unwrap_or("");
    name.strip_prefix("ability_effects_")
        .filter(|d| !d.is_empty() && d.bytes().all(|c| c.is_ascii_digit()))
        .map_or(0, |d| d.parse::<f64>().unwrap_or(0.0) as u64)
}

/// The slots an item block says it can be worn in as ability effects, in either form the table
/// writes the attribute.
pub fn fx_slots_of(block: &[u8]) -> Vec<u64> {
    static CAN: OnceLock<Regex> = OnceLock::new();
    let can = re(
        &CAN,
        r#"(?i-u)"can_equip_as_ability_effects"[\t\n\x0B\x0C\r \xA0]*(?:"(\d+)"|\{[^}]*?"value"[\t\n\x0B\x0C\r \xA0]*"(\d+)")"#,
    );
    let mut out: Vec<f64> = Vec::new();
    for c in can.captures_iter(block) {
        let digits = c.get(1).or(c.get(2)).map_or(&b""[..], |m| m.as_bytes());
        let n = std::str::from_utf8(digits).ok().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
        if !out.contains(&n) {
            out.push(n);
        }
    }
    let mut out: Vec<u64> = out.into_iter().filter(|n| *n > 0.0).map(|n| n as u64).collect();
    out.sort();
    out
}

fn is_modifier_key(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

fn js_number(v: Option<&String>) -> f64 {
    v.map_or(f64::NAN, |s| crate::js::to_number(&serde_json::Value::String(s.clone())))
}

/// The visuals with only the modifiers ability effects slot `n` takes, in the first style, their
/// style mark gone.
pub fn fx_visuals(visuals: &[u8], n: u64) -> Result<Vec<u8>, KvError> {
    static HEAD: OnceLock<Regex> = OnceLock::new();
    static STYLE: OnceLock<Regex> = OnceLock::new();
    let head = re(&HEAD, r#"(?i-u)^"asset_modifier\d*""#);
    let style = re(&STYLE, r#"(?i-u)[\t\n\x0B\x0C\r \xA0]*"style"[\t\n\x0B\x0C\r \xA0]+"[^"]*""#);
    let mut kept = Vec::new();
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        let Some(body) = c.body else { continue };
        if !is_modifier_key(c.key) {
            continue;
        }
        let mut f = std::collections::HashMap::new();
        for x in kv::children(visuals, body)? {
            if let Some(v) = x.value {
                f.insert(kv::latin1(x.key).to_lowercase(), kv::latin1(v));
            }
        }
        let style_n = js_number(f.get("style"));
        if js_number(f.get(TAG)) != n as f64 || (if style_n.is_nan() { 0.0 } else { style_n }) != 0.0 {
            continue;
        }
        let text = &visuals[c.start..c.end];
        let text = head.replace(text, &b"\"asset_modifier\""[..]);
        kept.push(style.replace(&text, &b""[..]).into_owned());
    }
    Ok(with_modifiers(b"\"visuals\"\r\n{\r\n}", &kept))
}

/// Whether a visuals block has a modifier left in it.
pub fn has_modifiers(visuals: &[u8]) -> bool {
    static ANY: OnceLock<Regex> = OnceLock::new();
    re(&ANY, r#"(?i-u)"asset_modifier\d*""#).is_match(visuals)
}

/// The stock item of ability effects slot `n`: the one for all heroes.
pub fn fx_target(items: &[SchemaItem], n: u64) -> Option<&SchemaItem> {
    let want = format!("ability_effects_{n}");
    items.iter().find(|i| i.prefab == "default_item" && inferred_item_slot(i).to_lowercase() == want)
}
