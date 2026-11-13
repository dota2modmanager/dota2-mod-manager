//! Everybody playing a hero wears the user's look for it, not only the user; replacing
//! src/item-builder-everyone.ts, which says why at length.
//!
//! A hero the build dresses (a pick, or a base's part, at one of his stock paths) is worn by
//! everybody exactly as the user's is, slot by slot: every other wearable of his goes under the
//! file the user's hero wears in its slot (the build's, else the game's stock item, else the pick's
//! own model where the stock item has none, else Valve's invisible box), at each model path its
//! block names and the refits the user's arcana swaps them for; an arcana's body goes under the
//! user's hero's. Its block becomes the pick's, else the stock item's, under its own name and
//! picture, the same in every style its owner can wear it in.

use indexmap::IndexSet;
use regex::bytes::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::item_builder::as_item;
use crate::item_builder_assets::{hero_model_path, normalize_asset_path};
use crate::item_builder_slots::{canonical_item_slot, is_persona_item, item_heroes};
use crate::item_builder_styles::block_in_every_style;
use crate::kv::{latin1, KvError};
use crate::schema::{inferred_item_slot, items_of, SchemaItem};
use crate::vpk::{entry_at, Bytes, Entry};

/// A block for the table and the files that go with it, as the build merges them.
#[derive(Clone, Debug)]
pub struct SchemaPatch {
    pub id: String,
    pub block: Vec<u8>,
    pub assets: Vec<Entry>,
    pub source: String,
}

const WS: &str = r"[\t\n\x0B\x0C\r \xA0]";

fn re(slot: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    slot.get_or_init(|| Regex::new(&pattern.replace(r"\s", WS)).unwrap())
}

/// Visuals that change the hero, not only what he wears.
fn changes_hero(raw: &[u8]) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"type"\s+"(entity_model|hero_model_change|persona)""#).is_match(raw)
}

/// Visuals that change something the user's hero has no file for: another form, a persona.
fn changes_other(raw: &[u8]) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"type"\s+"(hero_model_change|persona)""#).is_match(raw)
}

/// Every model a block names: its own, and each of its styles'.
fn models_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"model_player[0-9]*"\s+"([^"]+)""#)
}

/// A block's own model, which comes before its visuals and their styles'.
fn model_of(raw: &[u8]) -> Option<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"model_player"\s+"([^"]+)""#).captures(raw).map(|c| latin1(&c[1]))
}

/// Each asset_modifier's fields: none of them holds a block.
fn modifiers(raw: &[u8]) -> impl Iterator<Item = &[u8]> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"asset_modifier[0-9]*"\s*\{([^{}]*)\}"#).captures_iter(raw).map(|c| c.get(1).unwrap().as_bytes())
}

fn field(body: &[u8], key: &str) -> String {
    static R: OnceLock<HashMap<&'static str, Regex>> = OnceLock::new();
    let all = R.get_or_init(|| {
        ["type", "asset", "modifier", "style"]
            .into_iter()
            .map(|k| (k, Regex::new(&format!(r#"(?i-u)"{k}"{WS}+"([^"]*)""#)).unwrap()))
            .collect()
    });
    all[key].captures(body).map(|c| latin1(&c[1])).unwrap_or_default()
}

/// The first hero an item's used_by_heroes names, lower-cased.
fn first_hero(raw: &[u8]) -> Option<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"(?i-u)"(npc_dota_hero_[A-Za-z0-9_]+)"\s+"1""#).captures(raw).map(|c| latin1(&c[1]).to_lowercase())
}

fn compiled(p: &str) -> String {
    format!("{}_c", normalize_asset_path(p))
}

/// The bodies an item swaps the hero's for, or None where it swaps a unit that is not him.
fn bodies_of(raw: &[u8], hero: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for m in modifiers(raw) {
        if field(m, "type").to_lowercase() != "entity_model" {
            continue;
        }
        if field(m, "asset").to_lowercase() != hero || field(m, "modifier").is_empty() {
            return None;
        }
        out.push(compiled(&field(m, "modifier")).to_lowercase());
    }
    Some(out)
}

/// The model swaps the build's blocks make, as compiled paths: a paid item's model for its refit
/// to an arcana's body. Only the first style's.
fn model_swaps(list: &[SchemaPatch]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for p in list {
        for m in modifiers(&p.block) {
            let style = field(m, "style");
            if field(m, "type").to_lowercase() != "model" || (!style.is_empty() && style != "0") {
                continue;
            }
            let (from, to) = (field(m, "asset"), field(m, "modifier"));
            if !from.is_empty() && !to.is_empty() {
                out.insert(compiled(&from).to_lowercase(), compiled(&to).to_lowercase());
            }
        }
    }
    out
}

/// What a slot whose stock item has no model is worn as: Valve's invisible box, the first the game has.
const NOTHING: [&str; 2] =
    ["models/heroes/monkey_king/transform_invisiblebox.vmdl_c", "models/development/invisiblebox.vmdl_c"];

/// The same bytes under another path: the pak writes them once.
fn under(path: &str, en: &Entry) -> Entry {
    Entry { data: en.data.clone(), crc: en.crc, preload: en.preload.clone(), ..entry_at(path, crate::vpk::empty()) }
}

fn game_file(read: &dyn Fn(&str) -> Option<Vec<u8>>, at: &str) -> Option<Entry> {
    read(at).map(|d| entry_at(at, Bytes::from(d)))
}

/// The patches that dress every other wearable of each hero the build dresses as the user's hero
/// is dressed. Merged after the build's own, whose files and blocks win where both name one.
/// `list`: the build's patches; `beneath`: the arcana bases' files, under every pick's; `read`: a
/// file of the game's pak01; `heroes`: only these (without npc_dota_hero_), None for all.
pub fn everyone_wears(
    text: &[u8],
    list: &[SchemaPatch],
    beneath: &[Entry],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    heroes: Option<&[String]>,
) -> Result<Vec<SchemaPatch>, KvError> {
    let mut files: HashMap<String, &Entry> = HashMap::new();
    for en in list.iter().flat_map(|p| p.assets.iter()).chain(beneath) {
        files.entry(en.path().to_lowercase()).or_insert(en);
    }
    // the last block of an id is the one the merge keeps
    let blocks: HashMap<&str, &[u8]> = list.iter().map(|p| (p.id.as_str(), p.block.as_slice())).collect();
    let swaps = model_swaps(list);
    let only: Option<HashSet<String>> = heroes.map(|h| h.iter().map(|h| format!("npc_dota_hero_{h}")).collect());
    let items = items_of(text)?;
    let hero_of = |i: &SchemaItem| -> Result<Option<String>, KvError> {
        let h = item_heroes(text, i.start)?;
        Ok((h.len() == 1 && only.as_ref().is_none_or(|o| o.contains(&h[0])) && !is_persona_item(i))
            .then(|| h[0].clone()))
    };
    let slot_key = |hero: &str, i: &SchemaItem| format!("{hero}|{}", canonical_item_slot(&inferred_item_slot(i)));

    // the heroes the build dresses, found by path first
    let stocks: Vec<&SchemaItem> = items.iter().filter(|i| i.prefab == "default_item").collect();
    let mut wanted: HashSet<String> = HashSet::new();
    for i in &stocks {
        if !i.model.is_empty() && files.contains_key(&compiled(&i.model).to_lowercase()) {
            if let Some(h) = hero_of(i)? {
                wanted.insert(h);
            }
        }
    }
    if wanted.is_empty() {
        return Ok(vec![]);
    }
    let mut stock_of: HashMap<String, &SchemaItem> = HashMap::new();
    for i in &stocks {
        let named = first_hero(&text[i.start..i.end]);
        if named.is_some_and(|n| wanted.contains(&n)) {
            if let Some(hero) = hero_of(i)? {
                stock_of.insert(slot_key(&hero, i), i);
            }
        }
    }
    // what the user's hero wears in a slot, the same entry for every item of it
    let mut worn: HashMap<String, Option<Entry>> = HashMap::new();
    let mut worn_in = |stock: &SchemaItem| -> Option<Entry> {
        worn.entry(stock.id.clone())
            .or_insert_with(|| {
                let model = if stock.model.is_empty() {
                    blocks.get(stock.id.as_str()).and_then(|b| model_of(b))
                } else {
                    Some(stock.model.clone())
                };
                let named = model.filter(|m| !m.is_empty()).map(|m| compiled(&m).to_lowercase());
                let at = named.map(|n| swaps.get(&n).cloned().unwrap_or(n));
                let own = at.as_ref().and_then(|a| files.get(a).map(|e| (*e).clone()).or_else(|| game_file(read, a)));
                if own.is_some() || at.is_some() {
                    return own;
                }
                NOTHING.iter().find(|p| read(p).is_some()).and_then(|p| game_file(read, p))
            })
            .clone()
    };
    // the body the user's hero has: a base's at his path, else the game's own
    let mut bodies_cache: HashMap<String, Option<Entry>> = HashMap::new();
    let mut body_of = |hero: &str| -> Option<Entry> {
        bodies_cache
            .entry(hero.to_string())
            .or_insert_with(|| {
                let at = hero_model_path(read, hero).ok().map(|m| compiled(&m).to_lowercase())?;
                files.get(&at).map(|e| (*e).clone()).or_else(|| game_file(read, &at))
            })
            .clone()
    };

    let mut out = Vec::new();
    for item in items.iter() {
        if item.prefab == "default_item" || blocks.contains_key(item.id.as_str()) {
            continue;
        }
        let raw = &text[item.start..item.end];
        let Some(named) = first_hero(raw) else { continue };
        if !wanted.contains(&named) || (item.model.is_empty() && !changes_hero(raw)) || changes_other(raw) {
            continue;
        }
        let Some(hero) = hero_of(item)? else { continue };
        let Some(bodies) = bodies_of(raw, &hero) else { continue };
        let Some(stock) = stock_of.get(&slot_key(&hero, item)).copied() else { continue };
        let ours = worn_in(stock);
        let body = if bodies.is_empty() { None } else { body_of(&hero) };
        let mut paths: IndexSet<String> = IndexSet::new();
        for m in models_re().captures_iter(raw) {
            let p = compiled(&latin1(&m[1])).to_lowercase();
            if let Some(s) = swaps.get(&p) {
                paths.insert(p);
                paths.insert(s.clone());
            } else {
                paths.insert(p);
            }
        }
        let mut assets: Vec<Entry> = Vec::new();
        if let Some(o) = &ours {
            assets.extend(paths.iter().map(|p| under(p, o)));
        }
        if let Some(b) = &body {
            let unique: IndexSet<&String> = bodies.iter().collect();
            assets.extend(unique.into_iter().map(|p| under(p, b)));
        }
        let ours_path = ours.as_ref().map(Entry::path);
        assets.retain(|en| {
            !files.contains_key(&en.path().to_lowercase()) && ours_path.as_deref() != Some(en.path().as_str())
        });
        if assets.is_empty() {
            continue;
        }
        let base = blocks.get(stock.id.as_str()).copied().unwrap_or(&text[stock.start..stock.end]);
        let model = Some(item.model.as_str()).filter(|m| !m.is_empty());
        let block = block_in_every_style(&as_item(base, text, &item.id, item.start, model)?, raw)?;
        out.push(SchemaPatch { id: item.id.clone(), block, assets, source: format!("{}: everybody's", stock.name) });
    }
    Ok(out)
}
