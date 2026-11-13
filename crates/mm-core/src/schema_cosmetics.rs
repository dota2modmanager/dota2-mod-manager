//! The free cosmetics and the item builder's picks (src/schema-cosmetics.ts): the slots the game
//! has a free base item for and what can go on each, the look picked for one, a whole set put on
//! at once, a saved look worn, and the one-time move of picks that used to live in settings.json.
//! A pick is a library record like any other mod.
//!
//! Writing the game after a pick is the caller's: each of these answers, and the caller builds the
//! table once (in the background, `background_builds.rs`) where the TypeScript took `write`.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::{json, Map, Value};

use crate::arcana_notes::has_base;
use crate::cosmetic_names::{game_tokens, style_name};
use crate::i18n::t;
use crate::item_builder::effect_key;
use crate::item_builder_personas::{displaced, is_selector_slot};
use crate::library::Library;
use crate::schema::{cosmetic_options, items_of, OWNERLESS_SLOTS};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn effect_ids(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().map(crate::js::string).collect(),
        Some(v) if crate::js::truthy(v) => crate::js::string(v).split(',').map(String::from).collect(),
        _ => vec![],
    }
}

fn key_of(v: Option<&Value>) -> String {
    effect_key(&effect_ids(v))
}

fn on(r: &Value) -> bool {
    r.get("enabled") != Some(&Value::Bool(false))
}

fn str_of<'a>(r: &'a Value, k: &str) -> Option<&'a str> {
    r.get(k).and_then(Value::as_str)
}

/// `p.styles || 1`
fn styles_or_one(p: &Value) -> u64 {
    p.get("styles").and_then(Value::as_u64).filter(|n| *n != 0).unwrap_or(1)
}

/// The live record for a slot: at most one is ever enabled at a time.
pub fn cosmetic_record_for(lib: &Library, slot: &str) -> Option<Value> {
    lib.list()
        .iter()
        .find(|r| str_of(r, "categoryId") == Some("cosmetic") && str_of(r, "slot") == Some(slot) && on(r))
        .cloned()
}

/// `picked` and `recordId` of a slot, as the TypeScript spreads them (an itemId it has not got is left out).
fn picked_of(rec: Option<&Value>, out: &mut Map<String, Value>) {
    match rec {
        Some(r) => {
            if let Some(i) = r.get("itemId") {
                out.insert("picked".into(), i.clone());
            }
        }
        None => {
            out.insert("picked".into(), Value::Null);
        }
    }
}

/// Every slot with a free base item and something to put on it, the item builder's slots and sets,
/// each hero's main attribute, and in Chinese the items' names. `lang` is the app's.
pub fn cosmetic_slots(lib: &Library, game: Option<&Path>, text: &[u8], lang: &str) -> Value {
    let Some(game) = game else { return json!({ "slots": [], "sets": [] }) };
    match slots_in(lib, game, text, lang) {
        Ok(v) => v,
        Err(e) => json!({ "slots": [], "sets": [], "error": e }),
    }
}

fn slots_in(lib: &Library, game: &Path, text: &[u8], lang: &str) -> Result<Value, String> {
    let kv = |e: crate::kv::KvError| e.to_string();
    let items = items_of(text).map_err(kv)?;
    let mut seen = HashSet::new();
    let mut slots: Vec<Value> = Vec::new();
    let options_of = |slot: &str| -> Vec<Value> {
        cosmetic_options(&items, slot).into_iter().map(|(id, name)| json!({ "id": id, "name": name })).collect()
    };
    let push = |slot: &str, base: &str, options: Vec<Value>| {
        let rec = cosmetic_record_for(lib, slot);
        let mut o = Map::new();
        o.insert("slot".into(), json!(slot));
        o.insert("base".into(), json!(base));
        picked_of(rec.as_ref(), &mut o);
        o.insert("recordId".into(), rec.as_ref().map_or(Value::Null, |r| r.get("id").cloned().unwrap_or(Value::Null)));
        o.insert("options".into(), Value::Array(options));
        Value::Object(o)
    };
    for base in items.iter().filter(|i| i.baseitem) {
        let slot = if !base.slot.is_empty() { base.slot.as_str() } else { base.prefab.as_str() };
        if slot.is_empty() || !seen.insert(slot.to_string()) {
            continue;
        }
        let options = options_of(slot);
        if options.is_empty() {
            continue;
        }
        slots.push(push(slot, &base.id, options));
    }
    // the banner and the Tormentor have no free item: the picked one becomes it
    for slot in OWNERLESS_SLOTS {
        if seen.contains(slot) {
            continue;
        }
        let options = options_of(slot);
        if options.is_empty() {
            continue;
        }
        slots.push(push(slot, "", options));
    }
    let pak = game.join("dota").join("pak01_dir.vpk");
    let ix = if pak.exists() { crate::vpk_shared::shared_index(&pak).ok() } else { None };
    let read = |p: &str| ix.as_ref().and_then(|ix| ix.read(p).ok().flatten());
    let listed = crate::item_builder_slots::item_slots(text).map_err(kv)?;
    // an ability effects slot by its ability's name, and none the hero has not got
    let item_slots =
        if ix.is_some() { crate::item_builder_ability_fx::named_fx_slots(listed, &read, lang) } else { listed };
    let sets = crate::item_builder_sets::item_sets(text, &item_slots).map_err(kv)?;
    let mut sets: Vec<Value> = sets.iter().map(|s| json!(s)).collect();
    let mut hero_attrs = json!({});
    let effects = crate::item_builder_effects::item_effects();
    if !item_slots.is_empty() && !effects.is_empty() {
        if ix.is_some() {
            let ids: Vec<String> = item_slots.iter().flat_map(|it| it.hero_ids.iter().cloned()).collect();
            let mut r = |p: &str| read(p);
            hero_attrs = json!(crate::item_builder_details::hero_attributes(&mut r, &ids));
        }
        let mine = game_tokens(game, lang);
        let en = game_tokens(game, "en");
        let style_named = |token: &str, i: usize| style_name(&mine, token, || t("Стиль {0}", &[json!(i + 1)]));
        let game_name = |token: &str| style_name(&mine, token, String::new);
        // effects by their English names in every language: players look them up as "Ethereal Flame"
        let english = |token: &str| style_name(&en, token, String::new);
        let mut offered: Vec<Value> = effects.iter().map(|(id, name)| json!({ "id": id, "name": name })).collect();
        let unusual = crate::unusual_effects::offered_unusual(text, |id| {
            !english(&format!("#Attrib_Particle{}", crate::js::string(&json!(id)))).is_empty()
        })
        .map_err(kv)?;
        offered.extend(unusual.iter().map(|e| json!({ "id": e.id, "name": english(&e.name_token) })));
        let mut named: HashMap<String, Value> = HashMap::new();
        let mut entries = Vec::new();
        for it in &item_slots {
            let rec = cosmetic_record_for(lib, &it.slot);
            let mut o = match json!(it) {
                Value::Object(m) => m,
                _ => Map::new(),
            };
            let options: Vec<Value> = it
                .options
                .iter()
                .map(|opt| {
                    let mut v = json!(opt);
                    if let Some(styles) = &opt.styles {
                        let names: Vec<Value> =
                            styles.iter().enumerate().map(|(i, s)| json!(style_named(s, i))).collect();
                        v["styles"] = Value::Array(names.clone());
                        named.insert(opt.id.clone(), Value::Array(names));
                    }
                    v
                })
                .collect();
            o.insert("options".into(), Value::Array(options));
            picked_of(rec.as_ref(), &mut o);
            let effect = rec.as_ref().and_then(|r| r.get("effectId")).filter(|e| crate::js::truthy(e)).cloned();
            o.insert("pickedEffect".into(), if rec.is_some() { effect.unwrap_or(json!("")) } else { json!("") });
            o.insert(
                "recordId".into(),
                rec.as_ref().map_or(Value::Null, |r| r.get("id").cloned().unwrap_or(Value::Null)),
            );
            // a persona has no model for an effect to sit on, and an ability effects slot no model at all
            let none = it.persona.as_ref().is_some_and(|p| !p.part) || it.ability_fx.is_some_and(|n| n != 0);
            let fx = if none {
                vec![]
            } else {
                let mut all = offered.clone();
                let gems = crate::item_builder_kinetic::offered_kinetic(text, &it.hero_ids).map_err(kv)?;
                all.extend(gems.iter().map(|g| {
                    let n = english(&g.name_token);
                    json!({ "id": g.id, "name": if n.is_empty() { g.fallback.clone() } else { n } })
                }));
                all
            };
            o.insert("effects".into(), Value::Array(fx));
            entries.push(Value::Object(o));
        }
        let events = crate::item_builder_details::event_names(mine.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        sets = set_details(sets, &game_name, &|id| named.get(id).cloned(), &events);
        match slots.iter().position(|s| s["slot"] == "weather") {
            None => {
                entries.extend(slots);
                slots = entries;
            }
            Some(at) => {
                let tail = slots.split_off(at + 1);
                slots.extend(entries);
                slots.extend(tail);
            }
        }
    }
    let mut out = json!({ "slots": slots, "sets": sets, "heroAttrs": hero_attrs });
    if lang == "zh-CN" {
        out["names"] = json!(*crate::cosmetic_names::chinese_cosmetic_names(game, text));
    }
    Ok(out)
}

/// What the window shows of a set: its title, rarity, event and description in the game's words,
/// and the style names of its piece with the most looks.
pub fn set_details(
    sets: Vec<Value>,
    named: &dyn Fn(&str) -> String,
    styles_of: &dyn Fn(&str) -> Option<Value>,
    events: &crate::item_builder_details::EventNames,
) -> Vec<Value> {
    sets.into_iter()
        .map(|s| {
            let styles = s["styles"].as_u64().unwrap_or(0);
            let most =
                s["pieces"].as_array().and_then(|p| p.iter().find(|p| p["fits"] == true && styles_or_one(p) == styles));
            let text = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let name_token = text("nameToken");
            let title = Some(name_token.as_str())
                .filter(|t| !t.is_empty())
                .map(named)
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| text("name"));
            let rarity = text("rarity");
            let rarity_name = if rarity.is_empty() {
                String::new()
            } else {
                let n = named(&format!("#Rarity_{rarity}"));
                if n.is_empty() {
                    let mut c = rarity.chars();
                    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
                } else {
                    n
                }
            };
            let desc_token = text("descToken");
            let desc = if desc_token.is_empty() { String::new() } else { named(&desc_token) };
            let style_names = match (styles > 1, most) {
                (true, Some(m)) => styles_of(&crate::js::string(&m["itemId"])).unwrap_or(json!([])),
                _ => json!([]),
            };
            let mut o = s.as_object().cloned().unwrap_or_default();
            o.insert("title".into(), json!(title));
            o.insert("rarityName".into(), json!(rarity_name));
            o.insert("eventName".into(), json!(crate::item_builder_details::event_name(&text("event"), events)));
            o.insert("description".into(), json!(crate::item_builder_details::plain_text(&desc)));
            o.insert("styleNames".into(), style_names);
            Value::Object(o)
        })
        .collect()
}

/// Pick a look for a slot. A genuinely new item switches off whatever was live there (never
/// deletes it: a preset may still point at it) and makes a fresh record, or wakes a dormant one
/// for that same item. Other effects on the same item change that pick. The now-live record.
pub fn pick_cosmetic(
    lib: &mut Library,
    slot: &str,
    item_id: &str,
    item_name: Option<&str>,
    effect_id: Option<&Value>,
) -> Result<Option<Value>, String> {
    let name = item_name.filter(|n| !n.is_empty()).unwrap_or(item_id);
    let is_item = slot == "items" || slot.starts_with("item:");
    let effect = if is_item { key_of(effect_id) } else { String::new() };
    let live = cosmetic_record_for(lib, slot);
    let same_item = |r: &Value| r.get("itemId").map(crate::js::string).as_deref() == Some(item_id);
    if let Some(l) = &live {
        if same_item(l) && key_of(l.get("effectId")) == effect {
            return Ok(Some(l.clone()));
        }
    }
    // the effect a property of the pick: one row per item
    let set_effect = |lib: &mut Library, id: &Value, mut fields: Map<String, Value>| -> Result<(), String> {
        if effect.is_empty() {
            lib.update(id, &Value::Object(fields), None).map_err(io)?;
            lib.drop_fields(id, &["effectId"], None).map_err(io)?;
        } else {
            fields.insert("effectId".into(), json!(effect));
            lib.update(id, &Value::Object(fields), None).map_err(io)?;
        }
        Ok(())
    };
    if is_item {
        if let Some(l) = live.as_ref().filter(|l| same_item(l)) {
            let mut f = Map::new();
            f.insert("name".into(), json!(name));
            set_effect(lib, &l["id"], f)?;
            return Ok(lib.find(&l["id"]).cloned());
        }
    }
    if let Some(l) = &live {
        lib.set_enabled(&l["id"], false, None).map_err(io)?;
    }
    let dormant = lib
        .list()
        .iter()
        .find(|r| {
            str_of(r, "categoryId") == Some("cosmetic")
                && str_of(r, "slot") == Some(slot)
                && same_item(r)
                && (is_item || key_of(r.get("effectId")) == effect)
        })
        .cloned();
    let id = match dormant {
        Some(d) => {
            let mut f = Map::new();
            f.insert("name".into(), json!(name));
            f.insert("enabled".into(), json!(true));
            set_effect(lib, &d["id"], f)?;
            d["id"].clone()
        }
        None => {
            let new = json!({ "name": name, "categoryId": "cosmetic", "styleLabel": null, "fileRef": null, "preview": null, "files": [] });
            let rec = lib.add(&new, None).map_err(io)?;
            let mut f = json!({ "slot": slot, "itemId": item_id });
            if !effect.is_empty() {
                f["effectId"] = json!(effect);
            }
            lib.update(&rec["id"], &f, None).map_err(io)?;
            rec["id"].clone()
        }
    };
    // a persona is worn with its own items alone: the hero's plain picks go off
    if is_selector_slot(slot) {
        for r in displaced(lib.list()) {
            lib.set_enabled(&r["id"], false, None).map_err(io)?;
        }
    }
    Ok(lib.find(&id).cloned())
}

/// Put a whole set on: each piece the builder has a slot for takes that slot, and the hero's other
/// picks stay on, but for a persona and an arcana with a base (worn in the set's place). `style`
/// is the look chosen in the set's window. (applied, pieces).
pub fn pick_set(lib: &mut Library, text: &[u8], set_id: &str, style: f64) -> Result<(usize, usize), String> {
    let kv = |e: crate::kv::KvError| e.to_string();
    let slots = crate::item_builder_slots::item_slots(text).map_err(kv)?;
    let sets = crate::item_builder_sets::item_sets(text, &slots).map_err(kv)?;
    let set = sets.iter().find(|s| s.id == set_id).ok_or_else(|| t("Набор не найден", &[]))?;
    let set = json!(set);
    let pieces = set["pieces"].as_array().cloned().unwrap_or_default();
    let fits: Vec<&Value> =
        pieces.iter().filter(|p| p["fits"] == true && p.get("slot").is_some_and(crate::js::truthy)).collect();
    let heroes: Vec<String> =
        set["heroIds"].as_array().map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
    let hero = format!("item:{}:", heroes.join("+"));
    let persona_piece = regex::Regex::new(r"_persona_\d+$").unwrap();
    let style_re = regex::Regex::new(r"^style-\d+$").unwrap();
    let off: Vec<Value> = lib
        .list()
        .iter()
        .filter(|r| {
            str_of(r, "categoryId") == Some("cosmetic")
                && on(r)
                && str_of(r, "slot").is_some_and(|s| s.starts_with(&hero))
        })
        .filter(|r| {
            let slot = str_of(r, "slot").unwrap_or("");
            let item = r.get("itemId").filter(|i| crate::js::truthy(i)).map(crate::js::string);
            is_selector_slot(slot) || persona_piece.is_match(slot) || item.is_some_and(|i| has_base(&i))
        })
        .map(|r| r["id"].clone())
        .collect();
    for id in off {
        lib.set_enabled(&id, false, None).map_err(io)?;
    }
    let n = if style.is_finite() && style > 0.0 { style.floor() as u64 } else { 0 };
    for p in &fits {
        let slot = crate::js::string(&p["slot"]);
        let item = crate::js::string(&p["itemId"]);
        let live = cosmetic_record_for(lib, &slot);
        let mut ids: Vec<String> = match &live {
            Some(l) if l.get("itemId").map(crate::js::string) == Some(item.clone()) => {
                let e = l.get("effectId").filter(|e| crate::js::truthy(e)).map(crate::js::string).unwrap_or_default();
                e.split(',').filter(|id| !id.is_empty() && !style_re.is_match(id)).map(String::from).collect()
            }
            _ => vec![],
        };
        let most = styles_or_one(p);
        if n > 0 && n < most {
            ids.push(format!("style-{n}"));
        }
        let name = p.get("name").map(crate::js::string);
        pick_cosmetic(lib, &slot, &item, name.as_deref(), Some(&json!(ids)))?;
    }
    Ok((fits.len(), pieces.len()))
}

/// Put a saved look on: each of its picks as the player left it, the hero's other picks off (kept
/// in My mods). A pick that is not one of this hero's is skipped and counted. (applied, picks).
pub fn wear_look(lib: &mut Library, hero: &str, picks: &Value) -> Result<(usize, usize), String> {
    let hero_re = regex::Regex::new(r"^item:[a-z0-9_+]+:$").unwrap();
    let Some(list) = picks.as_array().filter(|_| hero_re.is_match(hero)) else {
        return Err(t("Образ не найден", &[]));
    };
    let rest = regex::Regex::new(r"^[a-z0-9_]+$").unwrap();
    let digits = regex::Regex::new(r"^\d+$").unwrap();
    let wear: Vec<&Value> = list
        .iter()
        .filter(|p| {
            p.get("slot")
                .and_then(Value::as_str)
                .is_some_and(|s| s.starts_with(hero) && rest.is_match(&s[hero.len()..]))
                && p.get("itemId").is_some_and(|i| digits.is_match(&crate::js::string(i)))
        })
        .collect();
    let keep: HashSet<&str> = wear.iter().filter_map(|p| p["slot"].as_str()).collect();
    let off: Vec<Value> = lib
        .list()
        .iter()
        .filter(|r| {
            str_of(r, "categoryId") == Some("cosmetic")
                && on(r)
                && str_of(r, "slot").is_some_and(|s| s.starts_with(hero) && !keep.contains(s))
        })
        .map(|r| r["id"].clone())
        .collect();
    for id in off {
        lib.set_enabled(&id, false, None).map_err(io)?;
    }
    for p in &wear {
        let item = crate::js::string(&p["itemId"]);
        let name =
            p.get("name").filter(|n| crate::js::truthy(n)).map(crate::js::string).unwrap_or_else(|| item.clone());
        let effect = p.get("effectId").filter(|e| crate::js::truthy(e)).cloned().unwrap_or(json!(""));
        pick_cosmetic(lib, p["slot"].as_str().unwrap_or(""), &item, Some(&name), Some(&effect))?;
    }
    Ok((wear.len(), list.len()))
}

/// The one-time move of picks that used to live in settings.json into library records. Whether
/// anything was picked (the caller builds then). `text` is None with no game: the picks wait for one.
pub fn migrate_cosmetic_settings(
    lib: &mut Library,
    settings: &mut crate::settings::Settings,
    text: Option<&dyn Fn() -> Result<Vec<u8>, String>>,
) -> bool {
    let picks = settings.get("cosmetics").and_then(Value::as_object).cloned().unwrap_or_default();
    if picks.is_empty() {
        return false;
    }
    let Some(text) = text else { return false };
    let mut picked = false;
    // the game path may not be ready yet: nothing lost, just retried next start
    let _ = (|| -> Result<(), String> {
        let text = text()?;
        let items = items_of(&text).map_err(|e| e.to_string())?;
        for (slot, item) in &picks {
            if !crate::js::truthy(item) || cosmetic_record_for(lib, slot).is_some() {
                continue;
            }
            let id = crate::js::string(item);
            let name = cosmetic_options(&items, slot)
                .into_iter()
                .find(|(o, _)| *o == id)
                .map(|(_, n)| n)
                .unwrap_or_else(|| slot.clone());
            pick_cosmetic(lib, slot, &id, Some(&name), None)?;
            picked = true;
        }
        Ok(())
    })();
    let _ = settings.set("cosmetics", json!({}));
    picked
}
