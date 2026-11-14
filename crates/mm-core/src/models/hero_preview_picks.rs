//! What the hero preview dresses the hero in, read off items_game (src/hero-preview-picks.ts):
//! each item's model and the body it swaps in, its material set, second models and body groups,
//! the effects a style swaps, the stock head, and a persona's slots.

use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};

use crate::item_builder_assets::{normalize_asset_path, AssetCopy};
use crate::kv::{block_bounds, each_child};

type R<T> = Result<T, String>;

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn field_of(text: &[u8], start: usize, key: &str) -> R<Option<String>> {
    Ok(crate::schema::item_fields(text, start).map_err(err)?.into_iter().find(|(k, _)| k == key).map(|(_, v)| v))
}

fn model_player(text: &[u8], item_id: &str) -> R<Option<String>> {
    match crate::schema::find_item(text, item_id, None).map_err(err)? {
        Some((start, _)) => Ok(field_of(text, start, "model_player")?.filter(|m| !m.is_empty())),
        None => Ok(None),
    }
}

/// The model an item puts on in the style picked, and the body it swaps the hero for. The build
/// copies the item's model over the stock one (`stock`); its other copies are particles and other
/// units' models, which the hero does not wear.
pub fn item_model(text: &[u8], item_id: &str, key: Option<&str>, hero: &str, stock: Option<&str>) -> R<Value> {
    let ids: Vec<String> = key.unwrap_or("").split(',').map(String::from).collect();
    if let Ok(patch) = crate::item_builder::item_effect_patch(text, item_id, &ids, None, None, None) {
        let copies = &patch.assets.asset_copies;
        let mut replacements: IndexMap<String, String> = IndexMap::new();
        for c in copies {
            if let AssetCopy::Unit { from, to, .. } | AssetCopy::Path { from, to, .. } = c {
                if to.to_lowercase().ends_with(".vpcf") {
                    replacements.insert(to.to_lowercase(), from.to_lowercase());
                }
            }
        }
        let body = copies.iter().find_map(|c| match c {
            AssetCopy::Hero { from, hero: h, .. } if h == hero => Some(from.clone()),
            _ => None,
        });
        let own = stock.filter(|s| !s.is_empty()).and_then(|s| {
            copies.iter().find_map(|c| match c {
                AssetCopy::Unit { from, to, .. } | AssetCopy::Path { from, to, .. }
                    if normalize_asset_path(to) == normalize_asset_path(s) =>
                {
                    Some(from.clone())
                }
                _ => None,
            })
        });
        // an arcana that is the whole hero puts on nothing besides its body
        let model = match own.filter(|o| !o.is_empty()) {
            Some(o) => Some(o),
            None => model_player(text, item_id)?,
        };
        return Ok(
            json!({ "model": model, "body": body, "block": latin1(&patch.block), "replacements": replacements }),
        );
    }
    // an item the table has lost: its block's own model, if any
    Ok(json!({ "model": model_player(text, item_id)?, "body": Value::Null }))
}

/// The modifiers of a visuals block: each asset_modifier's scalar fields, keys in lower case.
fn modifiers(visuals: &[u8]) -> R<Vec<IndexMap<String, String>>> {
    let mut out = Vec::new();
    let mut failed = None;
    each_child(visuals, block_bounds(visuals, 0).map_err(err)?, |m| {
        let key = latin1(m.key).to_lowercase();
        let named = key.strip_prefix("asset_modifier").is_some_and(|r| r.bytes().all(|c| c.is_ascii_digit()));
        let Some(body) = m.body.filter(|_| named) else { return true };
        let mut fields = IndexMap::new();
        if let Err(e) = each_child(visuals, body, |f| {
            if let Some(v) = f.value {
                fields.insert(latin1(f.key).to_lowercase(), latin1(v));
            }
            true
        }) {
            failed = Some(e);
            return false;
        }
        out.push(fields);
        true
    })
    .map_err(err)?;
    match failed {
        Some(e) => Err(err(e)),
        None => Ok(out),
    }
}

/// A material group addressed to the hero's body, even on a wearable.
pub fn body_skin_for(visuals: &[u8], hero: &str, model: &str, implicit_body: bool) -> R<Option<f64>> {
    let mut skin = None;
    for f in modifiers(visuals)? {
        let target = normalize_asset_path(f.get("asset").map_or("", String::as_str));
        let target = target.strip_suffix("_c").unwrap_or(&target);
        let Some(value) = f.get("skin") else { continue };
        let aimed = target == hero
            || target == format!("npc_dota_hero_{hero}")
            || target == model
            || (target.is_empty() && implicit_body);
        if f.get("type").is_some_and(|t| t.to_lowercase() == "model_skin")
            && f.get("style").map_or("0", String::as_str) == "0"
            && aimed
            && !value.is_empty()
            && value.bytes().all(|c| c.is_ascii_digit())
        {
            skin = Some(crate::js::to_number(&json!(value)));
        }
    }
    Ok(skin)
}

fn modifier_blocks(block: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)"asset_modifier[0-9]*"\s*\{([^{}]*)\}"#).expect("a valid pattern"))
        .captures_iter(block)
        .map(|c| c[1].to_string())
        .collect()
}

/// `"k"\s+"([^"]*)"`, the first in the body.
fn field(body: &str, k: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?i)"{}"\s+"([^"]*)""#, regex::escape(k))).ok()?;
    re.captures(body).map(|c| c[1].to_string())
}

/// The body an item's "entity_model" modifier puts the hero in: a persona's, which the item's own
/// copies leave out because a persona goes on through its base.
pub fn entity_model(block: &str, hero: &str) -> Option<String> {
    modifier_blocks(block).into_iter().find_map(|m| {
        let modifier = field(&m, "modifier").unwrap_or_default();
        (field(&m, "type").is_some_and(|t| t.to_lowercase() == "entity_model")
            && field(&m, "style").as_deref().unwrap_or("0") == "0"
            && field(&m, "asset").as_deref() == Some(hero)
            && modifier.to_lowercase().ends_with(".vmdl"))
        .then_some(modifier)
    })
}

/// What an item wears besides its model, in the first style: second models, and the body groups it sets.
pub fn worn_extras(visuals: &str) -> Value {
    let (mut models, mut groups) = (Vec::new(), Vec::new());
    for m in modifier_blocks(visuals) {
        let style = field(&m, "style").filter(|s| !s.is_empty()).map_or(0.0, |s| crate::js::to_number(&json!(s)));
        if style != 0.0 {
            continue;
        }
        let ty = field(&m, "type").map(|t| t.to_lowercase());
        let asset = field(&m, "asset").filter(|a| !a.is_empty());
        if let (Some("additional_wearable"), Some(a)) = (ty.as_deref(), &asset) {
            models.push(normalize_asset_path(a));
        }
        let modifier = field(&m, "modifier").filter(|x| !x.is_empty());
        if let (Some("bodygroup_visibility"), Some(a), Some(md)) = (ty.as_deref(), &asset, modifier) {
            let value = field(&m, "value").map_or(f64::NAN, |v| crate::js::to_number(&json!(v)));
            let value = if value.is_nan() || value == 0.0 { 0.0 } else { value };
            groups.push(json!({ "model": normalize_asset_path(a), "group": md.to_lowercase(), "value": crate::js::json_number(value) }));
        }
    }
    json!({ "models": models, "groups": groups })
}

fn item_text(text: &[u8], id: &str) -> R<Value> {
    Ok(match crate::schema::find_item(text, id, None).map_err(err)? {
        Some((start, end)) => json!({ "id": id, "start": start, "end": end, "text": latin1(&text[start..end]) }),
        None => Value::Null,
    })
}

/// The separately authored crown that goes with Great Sage's Reckoning.
pub fn monkey_king_crown(text: &[u8], hero: &str, equipped: &[Value]) -> R<Value> {
    let id_of = |r: &Value| r.get("itemId").map_or("undefined".to_string(), crate::js::string);
    if hero != "npc_dota_hero_monkey_king" || !equipped.iter().any(|r| id_of(r) == "9050") {
        return Ok(Value::Null);
    }
    item_text(text, "34183")
}

/// The selected style's effect swaps, even when they change another model's ambient.
pub fn preview_particle_replacements(visuals: &[u8], include_snapshots: bool) -> R<IndexMap<String, String>> {
    let mut out = IndexMap::new();
    for f in modifiers(visuals)? {
        let ty = f.get("type").map_or("", String::as_str);
        if f.get("style").map_or("0", String::as_str) != "0" {
            continue;
        }
        let suffix = if ty == "particle_snapshot" && include_snapshots {
            Some(".vsnap")
        } else if ty == "particle" || ty == "particle_combined" {
            Some(".vpcf")
        } else {
            None
        };
        let strip = |k: &str| {
            let n = normalize_asset_path(f.get(k).map_or("", String::as_str));
            n.strip_suffix("_c").map(String::from).unwrap_or(n)
        };
        let (from, to) = (strip("asset"), strip("modifier"));
        if let Some(sfx) = suffix {
            if from.ends_with(sfx) && to.ends_with(sfx) {
                out.insert(from, to);
            }
        }
    }
    Ok(out)
}

/// Terrorblade's blade swaps for the preview: the visuals' own, with `existing` over them.
pub fn preview_blade_replacements(
    existing: Option<&IndexMap<String, String>>,
    visuals: Option<&[u8]>,
) -> R<Option<IndexMap<String, String>>> {
    let Some(v) = visuals.filter(|v| !v.is_empty()) else { return Ok(existing.cloned()) };
    let mut out = preview_particle_replacements(v, true)?;
    for (k, x) in existing.into_iter().flatten() {
        out.insert(k.clone(), x.clone());
    }
    Ok(Some(out))
}

/// A reader of the game's particles through the swaps: an economy swap can aim at a nested child
/// as well as the equipped effect's root; `own` is the part's own, over the rest.
pub fn preview_particle_read(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    replacements: &IndexMap<String, String>,
    own: Option<&IndexMap<String, String>>,
    suppress_stock_blades: bool,
    file: &str,
) -> Option<Vec<u8>> {
    let key = match file.get(file.len().saturating_sub(2)..) {
        Some(end) if end.eq_ignore_ascii_case("_c") => &file[..file.len() - 2],
        _ => file,
    };
    let selected = own.and_then(|o| o.get(key)).or_else(|| replacements.get(key)).map_or(key, String::as_str);
    if suppress_stock_blades && crate::hero_particle_styles::is_stock_terrorblade_blade(selected) {
        return None;
    }
    if selected == key {
        read(file)
    } else {
        read(&format!("{selected}_c"))
    }
}

/// The face out of the hidden body_head slot, apart from a hat or hair.
pub fn preview_stock_head(
    text: &[u8],
    hero: &str,
    body: &str,
    has: &dyn Fn(&str) -> bool,
    hat_equipped: bool,
) -> R<Option<String>> {
    let name = hero.strip_prefix("npc_dota_hero_").unwrap_or(hero);
    let split_head = ["arc_warden", "faceless_void", "invoker", "phantom_lancer", "tinker"].contains(&name);
    if body != format!("models/heroes/{name}/{name}.vmdl") {
        return Ok(None);
    }
    let has_model = |m: &str| has(&format!("{}_c", normalize_asset_path(m)));
    let mut heads = Vec::new();
    for item in crate::schema::list_items(text).map_err(err)?.iter() {
        let low = item.model.to_lowercase();
        if (item.slot == "body_head" || (split_head && item.slot == "head"))
            && (item.baseitem || item.prefab == "default_item")
            && !item.model.is_empty()
            && item.model != body
            && !low.contains("persona")
            && !low.contains("hair")
            && crate::item_builder_slots::item_heroes(text, item.start).map_err(err)?.iter().any(|h| h == hero)
            && has_model(&item.model)
        {
            heads.push(item.clone());
        }
    }
    let head = heads.iter().find(|i| i.slot == "body_head").or(if hat_equipped { None } else { heads.first() });
    if let Some(h) = head {
        return Ok(Some(normalize_asset_path(&h.model)));
    }
    let conventional = format!("models/heroes/{name}/{name}_head.vmdl");
    // a conventional face is safe under hats only for the known independent meshes
    let ok = split_head && (!hat_equipped || name == "invoker" || name == "phantom_lancer") && has_model(&conventional);
    Ok(ok.then_some(conventional))
}

fn slot_text(r: &Value) -> String {
    r.get("slot").map_or("undefined".to_string(), crate::js::string)
}

/// The builder's picks tried on over the installed loadout, without changing either.
pub fn preview_equipment(text: &[u8], installed: &[Value], slots: &[Value]) -> R<Vec<Value>> {
    let mut staged: IndexMap<String, Value> = IndexMap::new();
    for s in slots {
        if let Some(t) = s.get("tryOn").filter(|t| crate::js::truthy(t)) {
            staged.insert(slot_text(s), t.clone());
        }
    }
    let mut out: Vec<Value> = installed.iter().filter(|r| !staged.contains_key(&slot_text(r))).cloned().collect();
    for (slot, pick) in &staged {
        let id = pick.get("itemId").filter(|i| crate::js::truthy(i)).map(crate::js::string);
        let Some(id) = id else { continue };
        let Some((start, _)) = crate::schema::find_item(text, &id, None).map_err(err)? else { continue };
        let mut row = pick.as_object().cloned().unwrap_or_default();
        row.insert("slot".into(), json!(slot));
        row.insert("name".into(), json!(field_of(text, start, "name")?.unwrap_or_default()));
        out.push(Value::Object(row));
    }
    Ok(out)
}

/// The hero's own effects; Razor's stock weapon is an effect, so it is there without a wearable.
pub fn preview_hero_particles(
    script: Option<&[u8]>,
    hero: &str,
    stock_weapon: bool,
    has: &dyn Fn(&str) -> bool,
) -> R<Vec<String>> {
    let particles = match script {
        Some(s) => crate::particle_spec::hero_loadout_particles(s).map_err(err)?,
        None => vec![],
    };
    if hero != "npc_dota_hero_razor" || !stock_weapon {
        return Ok(particles);
    }
    let folder = "particles/units/heroes/hero_razor/";
    let weapon = ["razor_whip_ambient", "razor_weapon_ambient", "razor_whip", "razor_weapon", "razor_loadout"]
        .iter()
        .map(|n| format!("{folder}{n}.vpcf"))
        .find(|p| has(&format!("{p}_c")));
    let Some(w) = weapon else { return Ok(particles) };
    // a Set keeps the first of each
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = particles.into_iter().chain([w]).collect();
    out.retain(|p| seen.insert(p.clone()));
    Ok(out)
}

/// The Crest's glow, which some builds ship apart from the wearable's effect list.
pub fn preview_crest_particles<'a>(
    roots: &[String],
    model: &str,
    item_id: &str,
    paths: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    if item_id != "6646" || !model.to_lowercase().contains("razor_helmet_blade") {
        return roots.to_vec();
    }
    let folder = "particles/econ/items/razor/razor_punctured_crest/";
    if roots.iter().any(|r| r.starts_with(folder) && r.to_lowercase().contains("ambient")) {
        return roots.to_vec();
    }
    for p in paths {
        let l = p.to_lowercase();
        let name = l.rsplit('/').next().unwrap_or("");
        if p.starts_with(folder)
            && l.ends_with("_ambient.vpcf_c")
            && name.len() > "_ambient.vpcf_c".len()
            && !l.contains("gold")
        {
            let mut out = roots.to_vec();
            out.push(p[..p.len() - 2].to_string());
            return out;
        }
    }
    roots.to_vec()
}

/// The slots the preview dresses, with a persona's counted: a persona on is worn with its own
/// items alone, so the plain slots go and each of its own is there; one off takes its own slots
/// with it.
pub fn persona_preview_slots(text: &[u8], hero: &str, slots: &[Value], equipped: &[Value]) -> R<Vec<Value>> {
    let layouts = crate::item_builder_slots::persona_layouts(text).map_err(err)?;
    let layout = layouts.get(hero.strip_prefix("npc_dota_hero_").unwrap_or(hero));
    let slot_of = |s: &Value| s.get("slot").map(crate::js::string).unwrap_or_default();
    let selector = slots.iter().position(|s| crate::item_builder_personas::is_selector_slot(&slot_of(s)));
    let (Some(layout), Some(sel)) = (layout, selector) else { return Ok(slots.to_vec()) };
    let sel_slot = slot_of(&slots[sel]);
    let at = sel_slot.rfind(':').map_or("", |i| &sel_slot[..=i]).to_string();
    let part = |slot: &str| layout.parts.iter().any(|p| slot == format!("{at}{}", p.slot));
    let id_of = |r: &Value| r.get("itemId").map_or("undefined".to_string(), crate::js::string);
    let on = equipped.iter().any(|r| slot_text(r) == sel_slot && layout.personas.iter().any(|p| p.id == id_of(r)));
    if !on {
        return Ok(slots.iter().filter(|s| !part(&slot_of(s))).cloned().collect());
    }
    let mut kept: Vec<Value> =
        slots.iter().enumerate().filter(|(i, s)| *i == sel || part(&slot_of(s))).map(|(_, s)| s.clone()).collect();
    for p in &layout.parts {
        let want = format!("{at}{}", p.slot);
        if !kept.iter().any(|s| slot_of(s) == want) {
            kept.push(json!({ "slot": want, "stock": p.host.id }));
        }
    }
    Ok(kept)
}
