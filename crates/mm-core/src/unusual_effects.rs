//! The game's unusual and ethereal effects read out of items_game.txt (issue #393), replacing
//! src/unusual-effects.ts and src/item-builder-unusual.ts: what each effect number draws (its
//! "attribute_controlled_attached_particles" entry), and the effects the item builder offers.

use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::data;
use crate::item_builder_effects::ItemEffect;
use crate::kv::{self, latin1, KvError};
use crate::memo;

/// One control point of an effect, put on a named attachment of the model. The index is a float
/// because the TypeScript's Number() makes a key that is not a number NaN (null in JSON).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectPoint {
    pub index: f64,
    #[serde(rename = "attachType")]
    pub attach_type: String,
    pub attachment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
}

/// One effect the table knows, with the name players know it by when it has one.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UnusualEffect {
    pub id: f64,
    pub name: Option<String>,
    pub system: String,
    #[serde(rename = "attachType")]
    pub attach_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    pub points: Vec<EffectPoint>,
}

fn is_gap(c: u8) -> bool {
    c == 32 || (9..=13).contains(&c) || c == 160
}

/// The section's bounds, found by its line at the table's first level
/// (`/\n\t"attribute_controlled_attached_particles"\s*\n/`), or None.
fn section(text: &[u8]) -> Result<Option<kv::Bounds>, KvError> {
    let needle = b"\n\t\"attribute_controlled_attached_particles\"";
    let mut from = 0;
    while let Some(at) = memchr::memmem::find(&text[from..], needle).map(|i| i + from) {
        let mut end = at + needle.len();
        let mut last_nl = None;
        while end < text.len() && is_gap(text[end]) {
            if text[end] == b'\n' {
                last_nl = Some(end);
            }
            end += 1;
        }
        if let Some(nl) = last_nl {
            return kv::block_bounds(text, nl).map(Some);
        }
        from = at + 1;
    }
    Ok(None)
}

/// A key or value as JavaScript's Number() reads it: digits (and a sign, a point) or NaN.
fn number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    t.parse::<f64>()
        .ok()
        .filter(|_| t.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'.' | b'-' | b'+' | b'e' | b'E')))
        .unwrap_or(f64::NAN)
}

/// Attrib_Particle<id> names out of dota_english.txt's text, by id.
pub fn effect_names(english: &str) -> HashMap<u64, String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#""Attrib_Particle(\d+)"[\t\n\x0B\x0C\r \u{a0}\u{feff}\p{Zs}\u{2028}\u{2029}]+"([^"\n]*)""#)
            .unwrap()
    });
    re.captures_iter(english).filter_map(|m| Some((m[1].parse().ok()?, m[2].to_string()))).collect()
}

/// Every effect in the table, in its order; named ones carry the English name.
pub fn unusual_effects(text: &[u8], english: &str) -> Result<Vec<UnusualEffect>, KvError> {
    let Some(bounds) = section(text)? else { return Ok(vec![]) };
    let names = effect_names(english);
    let mut out = Vec::new();
    for c in kv::children(text, bounds)? {
        if !c.is_block() || c.key.is_empty() || !c.key.iter().all(u8::is_ascii_digit) {
            continue;
        }
        let id: f64 = latin1(c.key).parse().unwrap_or(f64::NAN);
        let mut e = UnusualEffect {
            id,
            name: names.get(&(id as u64)).cloned().filter(|_| id.fract() == 0.0 && id < 9.007_199_254_740_992e15),
            system: String::new(),
            attach_type: String::new(),
            attachment: None,
            entity: None,
            points: vec![],
        };
        for f in kv::children(text, c.body.unwrap())? {
            let val = || latin1(f.value.unwrap_or(b""));
            match (f.key, f.is_block()) {
                (b"system", false) => e.system = val(),
                (b"attach_type", false) => e.attach_type = val(),
                (b"attach_entity", false) => e.entity = Some(val()),
                (b"attachment", false) => e.attachment = Some(val()),
                (b"control_points", true) => {
                    for p in kv::children(text, f.body.unwrap())? {
                        if !p.is_block() {
                            continue;
                        }
                        let mut point = EffectPoint {
                            index: number(&latin1(p.key)),
                            attach_type: String::new(),
                            attachment: None,
                            entity: None,
                        };
                        for v in kv::children(text, p.body.unwrap())? {
                            if v.is_block() {
                                continue;
                            }
                            let value = latin1(v.value.unwrap_or(b""));
                            match v.key {
                                b"control_point_index" => point.index = number(&value),
                                b"attach_type" => point.attach_type = value,
                                b"attachment" => point.attachment = Some(value),
                                b"attach_entity" => point.entity = Some(value),
                                _ => {}
                            }
                        }
                        e.points.push(point);
                    }
                }
                _ => {}
            }
        }
        if !e.system.is_empty() {
            out.push(e);
        }
    }
    Ok(out)
}

/// Every effect in the table, read once per table: the 3D preview asks on each slot it shows.
pub fn effects_of(text: &[u8]) -> Result<std::sync::Arc<Vec<UnusualEffect>>, KvError> {
    static SLOT: memo::Slot<Vec<UnusualEffect>> = std::sync::Mutex::new(None);
    memo::per_text(&SLOT, text, |t| unusual_effects(t, ""))
}

/// One game effect the picker offers: its token, and the game's own name for it to look up.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OfferedEffect {
    pub id: String,
    #[serde(rename = "nameToken")]
    pub name_token: String,
}

/// The effects the picker offers, by number: those the game names, that start at the model rather
/// than on its eyes, and that the builder does not offer already.
pub fn offered_unusual(text: &[u8], named: impl Fn(f64) -> bool) -> Result<Vec<OfferedEffect>, KvError> {
    let own: HashSet<String> = data::item_effects().iter().map(|e| e.modifier.to_lowercase()).collect();
    let effects = effects_of(text)?;
    let mut list: Vec<&UnusualEffect> = effects
        .iter()
        .filter(|e| {
            !e.system.is_empty()
                && e.attach_type != "customorigin"
                && named(e.id)
                && !own.contains(&e.system.to_lowercase())
        })
        .collect();
    list.sort_by(|a, b| a.id.partial_cmp(&b.id).unwrap_or(std::cmp::Ordering::Equal));
    Ok(list
        .iter()
        .map(|e| OfferedEffect {
            id: format!("unusual-{}", crate::js::number(e.id)),
            name_token: format!("#Attrib_Particle{}", crate::js::number(e.id)),
        })
        .collect())
}

/// The effect a token names (`unusual-<n>`), as the builder appends one; None when the table has no such number.
pub fn unusual_item_effect(text: &[u8], token: &str) -> Result<Option<ItemEffect>, KvError> {
    let Some(digits) =
        token.strip_prefix("unusual-").filter(|d| !d.is_empty() && d.bytes().all(|c| c.is_ascii_digit()))
    else {
        return Ok(None);
    };
    let n: f64 = digits.parse().unwrap_or(f64::NAN);
    if !n.is_finite() {
        return Ok(None);
    }
    Ok(effects_of(text)?.iter().find(|e| e.id == n && !e.system.is_empty()).map(|e| ItemEffect {
        id: token.to_string(),
        name: token.to_string(),
        ty: "particle_create".into(),
        modifier: e.system.clone(),
    }))
}
