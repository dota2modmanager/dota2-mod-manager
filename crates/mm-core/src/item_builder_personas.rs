//! The build half of src/item-builder-personas.ts: which picks a persona on leaves out, the
//! records a build takes with a persona's picks written over its stock items, and a persona slot's
//! files over the persona's base. (The slots the builder offers are item_builder_slots.rs.)
//!
//! Records are the library's JSON objects, carried through as they are: a build record is the
//! library's with a "persona" field added.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::arcana_notes::ArcanaBase;
use crate::data;
use crate::item_builder_slots::persona_layouts;
use crate::kv::KvError;
use crate::schema::to_utf8;
use crate::vpk::Entry;

/// The slot a persona is picked in.
pub const SELECTOR: &str = "persona_selector";

/// What a pick left out because of a persona says.
pub const PLAIN: &str = "the hero has a persona on";

/// A base with the files the store had for it, and the paths they fill (src/arcana-bases.ts).
pub struct ReadyBase {
    pub base: ArcanaBase,
    pub entries: Vec<Entry>,
    pub paths: HashSet<String>,
}

impl ReadyBase {
    pub fn new(base: ArcanaBase, entries: Vec<Entry>) -> Self {
        let paths = entries.iter().map(|e| e.path().to_lowercase()).collect();
        ReadyBase { base, entries, paths }
    }
}

/// A record left out of a build, and why.
pub type LeftOut = (Value, String);

/// A persona's own slot: `<slot>_persona_<n>`.
fn is_own(slot: &str) -> bool {
    slot.rfind("_persona_").is_some_and(|i| {
        let n = &slot[i + "_persona_".len()..];
        i > 0 && !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit())
    })
}

fn text_of(rec: &Value, key: &str) -> String {
    match rec.get(key) {
        None | Some(Value::Null) => String::new(),
        Some(v) => crate::js::string(v),
    }
}

/// A builder pick's heroes and slot, out of its slot id (item:<heroes>:<slot>); None for anything else.
fn pick_slot(rec: &Value) -> Option<(Vec<String>, String)> {
    if rec.get("categoryId").and_then(Value::as_str) != Some("cosmetic") {
        return None;
    }
    let slot = text_of(rec, "slot");
    let rest = slot.strip_prefix("item:")?;
    let (heroes, slot) = rest.split_once(':')?;
    (!heroes.is_empty() && !slot.is_empty()).then(|| (heroes.split('+').map(String::from).collect(), slot.to_string()))
}

fn enabled(rec: &Value) -> bool {
    rec.get("enabled") != Some(&Value::Bool(false))
}

/// Whether a slot id is a hero's persona slot, where a persona is picked.
pub fn is_selector_slot(slot: &str) -> bool {
    slot.ends_with(&format!(":{SELECTOR}"))
}

/// The heroes with a persona on, each with the persona's item: an enabled pick of one the builder offers.
pub fn personas_on(records: &[Value]) -> IndexMap<String, String> {
    let mut on = IndexMap::new();
    for rec in records {
        let Some((heroes, slot)) = enabled(rec).then(|| pick_slot(rec)).flatten() else { continue };
        if slot != SELECTOR {
            continue;
        }
        let item = text_of(rec, "itemId");
        if let Some(b) =
            data::arcana_bases().iter().find(|b| b.persona == Some(true) && b.item == item && heroes.contains(&b.hero))
        {
            on.insert(b.hero.clone(), b.item.clone());
        }
    }
    on
}

/// Why a pick stays out of the build while these personas are on; None when it goes in.
pub fn left_out(rec: &Value, on: &IndexMap<String, String>) -> Option<&'static str> {
    let (heroes, slot) = pick_slot(rec)?;
    if slot == SELECTOR {
        return None;
    }
    let mine = heroes.iter().any(|h| on.contains_key(h));
    if is_own(&slot) {
        return (!mine).then_some("its persona is not on");
    }
    mine.then_some(PLAIN)
}

/// The enabled plain picks of the heroes with a persona on: a pick of the persona switches them off.
pub fn displaced(records: &[Value]) -> Vec<Value> {
    let on = personas_on(records);
    if on.is_empty() {
        return vec![];
    }
    records.iter().filter(|r| enabled(r) && left_out(r, &on) == Some(PLAIN)).cloned().collect()
}

fn compiled(model: &str) -> String {
    let p = model.to_lowercase().replace('\\', "/");
    if p.ends_with("_c") {
        p
    } else {
        format!("{p}_c")
    }
}

fn with_persona(rec: &Value, target: &str, host: Option<String>, given: bool) -> Value {
    let mut out = rec.as_object().cloned().unwrap_or_default();
    out.insert("persona".into(), json!({ "target": target, "host": host, "given": given }));
    Value::Object(out)
}

/// The enabled records a build takes, personas sorted out: a pick that cannot be worn with the
/// personas on is left out, with why; a persona's pick names the stock item it goes over; and
/// each slot of a persona on with nothing picked wears the game's own item for it.
pub fn persona_records(records: &[Value], text: &[u8]) -> Result<(Vec<Value>, Vec<LeftOut>), KvError> {
    let on = personas_on(records);
    let layouts = if on.is_empty() { None } else { Some(persona_layouts(text)?) };
    let mut out = Vec::new();
    let mut left = Vec::new();
    let mut picked = HashSet::new();
    for rec in records {
        if let Some(why) = left_out(rec, &on) {
            left.push((rec.clone(), why.to_string()));
            continue;
        }
        let at = pick_slot(rec);
        let layout = match (&at, &layouts) {
            (Some((heroes, _)), Some(l)) => heroes.iter().find_map(|h| l.get(h)),
            _ => None,
        };
        let (Some((_, slot)), Some(layout)) = (&at, layout) else {
            out.push(rec.clone());
            continue;
        };
        if slot != SELECTOR && !is_own(slot) {
            out.push(rec.clone());
            continue;
        }
        if slot == SELECTOR {
            out.push(with_persona(rec, &layout.selector.id, None, false));
            continue;
        }
        let Some(part) = layout.parts.iter().find(|p| &p.slot == slot) else {
            left.push((rec.clone(), "its persona has no such slot".into()));
            continue;
        };
        picked.insert(format!("{}:{}", layout.hero, part.slot));
        let host = (!part.host.model.is_empty()).then(|| compiled(&part.host.model));
        out.push(with_persona(rec, &part.host.id, host, false));
    }
    if let Some(layouts) = &layouts {
        for hero in on.keys() {
            let Some(layout) = layouts.get(hero) else { continue };
            for part in &layout.parts {
                let Some(given) = &part.given else { continue };
                if picked.contains(&format!("{hero}:{}", part.slot)) {
                    continue;
                }
                let host = (!part.host.model.is_empty()).then(|| compiled(&part.host.model));
                out.push(json!({
                    "id": format!("persona:{hero}:{}", part.slot), "name": to_utf8(&given.name), "categoryId": "cosmetic", "files": [],
                    "enabled": true, "slot": format!("item:{hero}:{}", part.slot), "itemId": given.id,
                    "persona": { "target": part.host.id, "host": host, "given": true },
                }));
            }
        }
    }
    Ok((out, left))
}

/// A base's file at a path is an empty model: what a persona's base puts at the plain hero's slots.
fn empty_at(base: &ReadyBase, path: &str) -> bool {
    base.entries
        .iter()
        .find(|x| x.path().to_lowercase() == path)
        .is_some_and(|e| path.ends_with(".vmdl_c") && e.data.len() < 8192)
}

/// A persona slot's files over the persona's base. The base wins wherever it has a file, except at
/// the slot's own model: there a pick wins, and the game's own item wins over an empty model but
/// not over one rebuilt by hand.
pub fn persona_assets(rec: &Value, assets: Vec<Entry>, ready: &[ReadyBase]) -> Vec<Entry> {
    let Some((heroes, _)) = pick_slot(rec) else { return assets };
    let Some(base) = ready.iter().find(|r| r.base.persona == Some(true) && heroes.contains(&r.base.hero)) else {
        return assets;
    };
    let Some(persona) = rec.get("persona").filter(|p| p.is_object() && crate::js::truthy(p)) else { return assets };
    let host = persona.get("host").and_then(Value::as_str).map(String::from);
    let given = persona.get("given").is_some_and(crate::js::truthy);
    assets
        .into_iter()
        .filter(|e| {
            let p = e.path().to_lowercase();
            !base.paths.contains(&p) || (host.as_deref() == Some(p.as_str()) && (!given || empty_at(base, &p)))
        })
        .collect()
}

/// A hero script's persona model: the "Model" of its Persona block, which the game keeps for its tools.
fn persona_model(script: &[u8]) -> Option<String> {
    static R: std::sync::OnceLock<regex::bytes::Regex> = std::sync::OnceLock::new();
    let r = R.get_or_init(|| {
        regex::bytes::Regex::new(r#"(?s-u)"Persona".*?"Model"[\t\n\x0B\x0C\r \xA0]+"([^"]+)""#).unwrap()
    });
    r.captures(script).map(|c| crate::kv::latin1(&c[1]))
}

/// How much bigger each persona's base body is than Valve's persona model, for each hero with a
/// persona on whose base is here: what its items are made bigger by (model_scale.rs). A body
/// compiled as Valve's measures 1, and nothing is scaled. `read`: a file of the game's pak01.
pub fn persona_scales(
    on: &IndexMap<String, String>,
    ready: &[ReadyBase],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> IndexMap<String, f64> {
    let mut out = IndexMap::new();
    for hero in on.keys() {
        let base = ready.iter().find(|r| r.base.persona == Some(true) && &r.base.hero == hero);
        let script = read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt"));
        let valve = script.as_deref().and_then(persona_model).filter(|v| !v.is_empty());
        let (Some(base), Some(valve)) = (base, valve) else { continue };
        let Ok(model) = crate::item_builder_assets::hero_model_path(read, &format!("npc_dota_hero_{hero}")) else {
            continue;
        };
        let at = compiled(&model);
        let body = base.entries.iter().find(|e| e.path().to_lowercase() == at);
        let reference = read(&compiled(&valve));
        let (Some(body), Some(reference)) = (body, reference) else { continue };
        // a body or a model that does not read: its items as they are
        let Ok(Some(scale)) = crate::model_scale::model_scale_against(&body.data, &reference) else { continue };
        // a body compiled as Valve's measures 1 to within a thousandth
        if scale != 0.0 && (scale - 1.0).abs() > 0.01 {
            out.insert(hero.clone(), (scale * 1000.0 + 0.5).floor() / 1000.0);
        }
    }
    out
}

/// What a pick's models are made bigger by: a persona's own slot's, while its body is bigger (persona_scales).
pub fn persona_scale_of(rec: &Value, scales: &IndexMap<String, f64>) -> Option<f64> {
    let (heroes, slot) = pick_slot(rec)?;
    if !rec.get("persona").is_some_and(crate::js::truthy) || slot == SELECTOR {
        return None;
    }
    heroes.iter().filter_map(|h| scales.get(h).copied()).find(|&s| s != 0.0 && !s.is_nan())
}
