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

fn lang_file(lang: &str) -> &'static str {
    match lang {
        "ru" => "russian",
        "zh-CN" => "schinese",
        _ => "english",
    }
}

/// An ability effects slot's name: "Эффекты: Enchant Totem".
pub fn fx_ability_label(ability: &str) -> String {
    crate::i18n::t("Эффекты: {0}", &[serde_json::json!(ability)])
}

/// The ability effects slots named by their ability, as the hero's script and the game's text say,
/// and without those of a hero whose script has no such slot. Without the game's files they keep
/// their numbers. `read`: a file of pak01; `lang`: the app's language.
pub fn named_fx_slots(
    slots: Vec<crate::item_builder_slots::ItemSlot>,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    lang: &str,
) -> Vec<crate::item_builder_slots::ItemSlot> {
    use std::collections::HashMap;
    if !slots.iter().any(|s| s.ability_fx.is_some_and(|n| n != 0)) {
        return slots;
    }
    static SLOT_TEXT: OnceLock<regex::Regex> = OnceLock::new();
    let slot_text = SLOT_TEXT.get_or_init(|| {
        regex::Regex::new(r#"(?i)"SlotName"\s+"(ability_effects_[0-9]+)"\s*"SlotText"\s+"([^"]+)""#).unwrap()
    });
    let mut ability_of: HashMap<String, Option<HashMap<String, String>>> = HashMap::new();
    let mut words: Option<HashMap<String, String>> = None;
    let mut out = Vec::new();
    for s in slots {
        let hero = s.hero_ids.first().filter(|h| !h.is_empty() && s.ability_fx.is_some_and(|n| n != 0));
        let Some(hero) = hero else {
            out.push(s);
            continue;
        };
        let own = ability_of
            .entry(hero.clone())
            .or_insert_with(|| {
                read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt")).map(|data| {
                    let script = String::from_utf8_lossy(&data).into_owned();
                    slot_text.captures_iter(&script).map(|m| (m[1].to_lowercase(), m[2].to_string())).collect()
                })
            })
            .clone();
        let Some(own) = own else {
            out.push(s);
            continue;
        };
        let Some(ability) = own.get(&s.equip_slot) else { continue };
        let words = words.get_or_insert_with(|| {
            let mut w = HashMap::new();
            let mut langs = vec![lang_file(lang)];
            if langs[0] != "english" {
                langs.push("english");
            }
            for language in langs {
                if let Some(data) = read(&format!("resource/localization/abilities_{language}.txt")) {
                    for (k, v) in crate::cosmetic_names::localization_tokens(&data) {
                        w.entry(k).or_insert(v);
                    }
                }
            }
            w
        });
        let Some(name) =
            words.get(&format!("dota_tooltip_ability_{}", ability.to_lowercase())).filter(|n| !n.is_empty())
        else {
            out.push(s);
            continue;
        };
        let slot_label = fx_ability_label(name);
        let label = format!("{} · {slot_label}", s.hero_label);
        out.push(crate::item_builder_slots::ItemSlot { slot_label, label, ..s });
    }
    out
}

fn visuals_of(block: &[u8]) -> Result<Option<(usize, usize)>, KvError> {
    let mut out = None;
    kv::each_child(block, kv::block_bounds(block, 0)?, |c| {
        if out.is_none() && c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            out = Some((c.start, c.end));
        }
        true
    })?;
    Ok(out)
}

/// The modifiers of a block's visuals, each as its text.
fn modifiers_of(block: &[u8]) -> Result<Vec<Vec<u8>>, KvError> {
    let Some((s, e)) = visuals_of(block)? else { return Ok(vec![]) };
    let visuals = &block[s..e];
    let mut out = Vec::new();
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        let numbered = c.key.len() >= 14
            && c.key[..14].eq_ignore_ascii_case(b"asset_modifier")
            && c.key[14..].iter().all(u8::is_ascii_digit);
        if c.is_block() && numbered {
            out.push(visuals[c.start..c.end].to_vec());
        }
    }
    Ok(out)
}

/// A patch the ability effects slots' picks are joined in (merge_fx_patches).
pub trait FxJoin {
    fn id(&self) -> &str;
    fn block_mut(&mut self) -> &mut Vec<u8>;
    fn take_assets(&mut self) -> Vec<crate::vpk::Entry>;
    fn add_assets(&mut self, more: Vec<crate::vpk::Entry>);
    fn source_mut(&mut self) -> &mut String;
}

impl FxJoin for crate::item_builder_everyone::SchemaPatch {
    fn id(&self) -> &str {
        &self.id
    }
    fn block_mut(&mut self) -> &mut Vec<u8> {
        &mut self.block
    }
    fn take_assets(&mut self) -> Vec<crate::vpk::Entry> {
        std::mem::take(&mut self.assets)
    }
    fn add_assets(&mut self, more: Vec<crate::vpk::Entry>) {
        self.assets.extend(more);
    }
    fn source_mut(&mut self) -> &mut String {
        &mut self.source
    }
}

/// The patches with each ability effects slot's picks joined into one: the first pick's block with
/// every other one's modifiers added, and all their files, the first pick's ahead.
pub fn merge_fx_patches<T: FxJoin>(list: Vec<T>, is_fx: impl Fn(&T) -> bool) -> Result<Vec<T>, KvError> {
    let mut out: Vec<T> = Vec::new();
    let mut joined: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for mut p in list {
        if !is_fx(&p) {
            out.push(p);
            continue;
        }
        let Some(&at) = joined.get(p.id()) else {
            joined.insert(p.id().to_string(), out.len());
            out.push(p);
            continue;
        };
        let had = &mut out[at];
        let block = had.block_mut();
        if let Some((s, e)) = visuals_of(block)? {
            let visuals = block[s..e].to_vec();
            let start = memchr::memmem::find(block, &visuals).unwrap_or(s);
            let merged = with_modifiers(&visuals, &modifiers_of(p.block_mut())?);
            *block = [&block[..start], &merged[..], &block[start + visuals.len()..]].concat();
        }
        had.add_assets(p.take_assets());
        let src = format!("{}, {}", had.source_mut(), p.source_mut());
        *had.source_mut() = src;
    }
    Ok(out)
}
