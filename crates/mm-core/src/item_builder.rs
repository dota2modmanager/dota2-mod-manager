//! The item builder: a hero's stock item built from one of its wearables, with an effect on top.
//! Replacing src/item-builder.ts, the part that writes a pick: the wearable's block under the stock
//! item's id, name and prefab=default_item, without the styles and unlocks a free base item cannot
//! use, with the chosen effects in its visuals, and the files to copy out of pak01 under the stock
//! paths (item_builder_assets.rs).
//!
//! Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
//! (https://github.com/TheFleece).
//! Copyright (C) 2026 h6rd
//! Copyright (C) 2026 TheFleece
//! SPDX-License-Identifier: GPL-3.0-or-later
//! The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
//! the credits of the program it goes into.

use regex::bytes::Regex;
use serde::Serialize;
use serde_json::json;
use std::collections::HashSet;
use std::sync::OnceLock;

use crate::data;
use crate::i18n::t;
use crate::item_builder_assets::{item_assets, normalize_asset_path, AssetCopy, ItemAssets, SummonModels};
use crate::item_builder_donor::{donor_additions, donor_of, with_modifiers};
use crate::item_builder_effects::{append_item_effect, ItemEffect};
use crate::item_builder_kinetic::{kinetic_name, picks_gems, with_kinetics};
use crate::item_builder_slots::{canonical_item_slot, is_persona_item, item_heroes, match_item_slot};
use crate::item_builder_styles::{style_of, with_style};
use crate::item_skin::worn_skin;
use crate::kv::{self, latin1, to_latin1, KvError};
use crate::schema::{inferred_item_slot, item_fields, items_of, SchemaItem};
use crate::schema_merge::strip_key_blocks;
use crate::unusual_effects::unusual_item_effect;

fn err(e: KvError) -> String {
    e.to_string()
}

fn field<'a>(fields: &'a [(String, String)], key: &str) -> Option<&'a str> {
    fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// JS String.prototype.trim over latin1 text.
fn js_trim(s: &[u8]) -> &[u8] {
    let ws = |c: &u8| matches!(c, b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ' | 0xA0);
    let start = s.iter().position(|c| !ws(c)).unwrap_or(s.len());
    let end = s.iter().rposition(|c| !ws(c)).map_or(start, |i| i + 1);
    &s[start..end.max(start)]
}

/// `line` in place of the block's first direct child `hit` picks, or added at its end.
fn put_child(block: &[u8], hit: Option<(usize, usize)>, line: &[u8]) -> Vec<u8> {
    if let Some((start, end)) = hit {
        return [&block[..start], line, &block[end..]].concat();
    }
    match block.iter().rposition(|&c| c == b'}') {
        None => block.to_vec(),
        Some(close) => [&block[..close], b"\r\n\t", line, b"\r\n", &block[close..]].concat(),
    }
}

fn first_child(block: &[u8], want: impl Fn(&kv::Child) -> bool) -> Result<Option<(usize, usize)>, KvError> {
    let mut hit = None;
    kv::each_child(block, kv::block_bounds(block, 0)?, |c| {
        if hit.is_none() && want(&c) {
            hit = Some((c.start, c.end));
        }
        true
    })?;
    Ok(hit)
}

/// The block with the scalar `key` set to `value`.
pub fn set_scalar_field(block: &[u8], key: &str, value: &str) -> Result<Vec<u8>, KvError> {
    let lower = key.to_lowercase();
    let hit = first_child(block, |c| !c.is_block() && latin1(c.key).to_lowercase() == lower)?;
    Ok(put_child(block, hit, &to_latin1(&format!("\"{key}\"\t\t\"{value}\""))))
}

/// An item block with these visuals in place of its own, or added at its end where it has none.
pub fn set_visuals_block(block: &[u8], visuals: &[u8]) -> Result<Vec<u8>, KvError> {
    let hit = first_child(block, |c| c.is_block() && c.key.eq_ignore_ascii_case(b"visuals"))?;
    Ok(put_child(block, hit, js_trim(visuals)))
}

fn item_effect_by_id(id: &str) -> Option<ItemEffect> {
    let want = id.trim().to_lowercase();
    data::item_effects().iter().find(|e| e.id == want).cloned()
}

/// The number of a game effect's token, `unusual-<digits>`, as JS Number() reads the digits.
fn unusual_number(token: &str) -> Option<f64> {
    let digits = token.strip_prefix("unusual-")?;
    (!digits.is_empty() && digits.bytes().all(|c| c.is_ascii_digit())).then(|| digits.parse().unwrap_or(f64::NAN))
}

fn is_style_token(id: &str) -> bool {
    id.strip_prefix("style-").is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
}

fn is_donor_token(id: &str) -> bool {
    id.strip_prefix("from-").is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
}

/// The effects of one pick as one string: the builder's own in the order the picker lists them,
/// the game's by number, unknown ones sorted, then the donor and the style; each once.
pub fn effect_key(effect_ids: &[String]) -> String {
    let ids: Vec<String> = effect_ids.iter().map(|id| id.trim().to_lowercase()).filter(|id| !id.is_empty()).collect();
    let mut want: Vec<&String> = Vec::new();
    for id in &ids {
        if !is_style_token(id) && !is_donor_token(id) && unusual_number(id).is_none() && !want.contains(&id) {
            want.push(id);
        }
    }
    let known: Vec<String> =
        data::item_effects().iter().map(|e| e.id.clone()).filter(|id| want.contains(&id)).collect();
    let mut unusual: Vec<String> = Vec::new();
    for id in &ids {
        if unusual_number(id).is_some() && !unusual.contains(id) {
            unusual.push(id.clone());
        }
    }
    unusual.sort_by(|a, b| {
        let (x, y) = (unusual_number(a).unwrap(), unusual_number(b).unwrap());
        x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut unknown: Vec<String> = want.iter().filter(|id| !known.contains(id)).map(|s| s.to_string()).collect();
    unknown.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let donor = ids.iter().find(|id| is_donor_token(id)).cloned();
    let style = style_of(&ids.join(","));
    let mut out = known;
    out.extend(unusual);
    out.extend(unknown);
    out.extend(donor);
    if style > 0 {
        out.push(format!("style-{style}"));
    }
    out.join(",")
}

/// The block under another id: its leading "<digits>" replaced.
fn set_block_id(block: &[u8], id: &str) -> Vec<u8> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?-u)^[\t\n\x0B\x0C\r \xA0]*"[0-9]+""#).unwrap());
    match re.find(block) {
        Some(m) => [format!("\"{id}\"").as_bytes(), &block[m.end()..]].concat(),
        None => block.to_vec(),
    }
}

/// What an item keeps of its own when it wears another's block: what the game shows of it by name.
const OWN_FIELDS: [&str; 6] = ["name", "prefab", "item_name", "item_description", "image_inventory", "item_rarity"];

/// A built block worn as another item of the same hero and slot: the built visuals, under that
/// item's id, its own name and picture, and the model path its block names.
pub fn as_item(block: &[u8], text: &[u8], id: &str, start: usize, model: Option<&str>) -> Result<Vec<u8>, KvError> {
    let own = item_fields(text, start)?;
    let mut out = set_block_id(block, id);
    for key in OWN_FIELDS {
        if let Some(v) = field(&own, key).filter(|v| !v.is_empty()) {
            out = set_scalar_field(&out, key, v)?;
        }
    }
    match model.filter(|m| !m.is_empty()) {
        Some(m) => set_scalar_field(&out, "model_player", m),
        None => Ok(out),
    }
}

/// The text of an item's "visuals" block (its last one), or None for an item without one.
pub fn item_visuals(text: &[u8], start: usize) -> Result<Option<Vec<u8>>, KvError> {
    let mut visuals = None;
    kv::each_child(text, kv::block_bounds(text, start)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            visuals = Some(text[c.start..c.end].to_vec());
        }
        true
    })?;
    Ok(visuals)
}

/// The response criteria an item sets: a persona's voice item.
pub fn item_voices(text: &[u8], start: usize) -> Result<Vec<crate::item_sounds::VoiceCue>, KvError> {
    let Some(visuals) = item_visuals(text, start)? else { return Ok(vec![]) };
    Ok(item_assets(text, &visuals, &item_heroes(text, start)?, None)?.voices)
}

/// The stock default_item that matches a wearable by slot and by the hero(es) that can equip it.
pub fn default_item_for_wearable(text: &[u8], source_id: &str) -> Result<Option<SchemaItem>, String> {
    let Some((start, _)) = crate::schema_merge::items_by_id(text).map_err(err)?.find(text, source_id).map_err(err)?
    else {
        return Err(t("items_game: предмет {0} не найден", &[json!(source_id)]));
    };
    let fields = item_fields(text, start).map_err(err)?;
    let items = items_of(text).map_err(err)?;
    let lite = items.iter().find(|i| i.id == source_id);
    if lite.is_some_and(is_persona_item) {
        return Ok(None);
    }
    let slot = canonical_item_slot(&match field(&fields, "item_slot").filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => lite.map(inferred_item_slot).unwrap_or_default(),
    });
    if slot.is_empty() {
        return Ok(None);
    }
    let match_slot = match_item_slot(&slot);
    let heroes = item_heroes(text, start).map_err(err)?;
    let pick = |fits: &dyn Fn(&SchemaItem) -> bool| -> Result<Option<SchemaItem>, String> {
        let mut found: Vec<&SchemaItem> = Vec::new();
        for i in items.iter() {
            if i.id != source_id
                && fits(i)
                && i.prefab == "default_item"
                && !is_persona_item(i)
                && item_heroes(text, i.start).map_err(err)? == heroes
            {
                found.push(i);
            }
        }
        let num = |i: &SchemaItem| i.id.parse::<f64>().unwrap_or(f64::NAN);
        found.sort_by(|a, b| (num(a) - num(b)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(found.first().map(|i| (*i).clone()))
    };
    if let Some(i) = pick(&|i| canonical_item_slot(&inferred_item_slot(i)) == slot)? {
        return Ok(Some(i));
    }
    pick(&|i| match_item_slot(&inferred_item_slot(i)) == match_slot)
}

fn is_modifier_key(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

/// The visuals without the model swaps the built files already make (the hero's own model, a
/// stock item's, a hero's other form, a summon's), and a persona's switch and its size.
/// `units`: the heroes and summons whose model the pick puts under their path; `stock`: the stock
/// models it puts another under, as normalize_asset_path writes them.
pub fn without_file_swaps(
    visuals: &[u8],
    units: &HashSet<String>,
    stock: &HashSet<String>,
) -> Result<Vec<u8>, KvError> {
    let mut cut: Vec<(usize, usize)> = Vec::new();
    let mut sizes: Vec<(usize, usize)> = Vec::new();
    let mut persona = false;
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        let Some(body) = c.body else { continue };
        if !is_modifier_key(c.key) {
            continue;
        }
        let mut ty = String::new();
        let mut asset = String::new();
        for f in kv::children(visuals, body)? {
            let Some(v) = f.value else { continue };
            match latin1(f.key).to_lowercase().as_str() {
                "type" => ty = latin1(v).to_lowercase(),
                "asset" => asset = latin1(v),
                _ => {}
            }
        }
        if ty == "hero_scale" {
            sizes.push((c.start, c.end));
        }
        if ty == "persona" {
            persona = true;
        }
        if ty == "persona"
            || (ty == "entity_model" && units.contains(&asset.to_lowercase()))
            || ((ty == "model" || ty == "hero_model_change") && stock.contains(&normalize_asset_path(&asset)))
        {
            cut.push((c.start, c.end));
        }
    }
    if persona {
        cut.extend(sizes);
    }
    cut.sort_by_key(|a| std::cmp::Reverse(a.0));
    let mut out = visuals.to_vec();
    for (start, end) in cut {
        let mut s = start;
        while s > 0 && matches!(out[s - 1], b' ' | b'\t' | b'\r' | b'\n') {
            s -= 1;
        }
        out.drain(s..end);
    }
    Ok(out)
}

/// What a pick writes: the block, where its model goes, and the files, sounds and voice it takes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Patch {
    pub id: String,
    #[serde(serialize_with = "as_latin1")]
    pub block: Vec<u8>,
    pub own: Option<String>,
    pub added: Vec<String>,
    pub unplaced: bool,
    pub kinetic: Vec<String>,
    pub heroes: Vec<String>,
    #[serde(flatten)]
    pub assets: ItemAssets,
}

fn as_latin1<S: serde::Serializer>(b: &[u8], s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&latin1(b))
}

/// One paid wearable turned into the hero's stock item for that slot.
/// `target_id`: the stock item to write it over where its slot does not say (a persona's);
/// `summon`: the plain models of the hero's summons; `refit`: the model another pick makes of this
/// one's, to wear in its place where the game has it.
pub fn item_effect_patch(
    base: &[u8],
    item_id: &str,
    effect_ids: &[String],
    target_id: Option<&str>,
    summon: Option<&mut SummonModels>,
    refit: Option<&str>,
) -> Result<Patch, String> {
    let Some((source_start, source_end)) =
        crate::schema_merge::items_by_id(base).map_err(err)?.find(base, item_id).map_err(err)?
    else {
        return Err(t("items_game: предмет {0} не найден", &[json!(item_id)]));
    };
    let target = match target_id.filter(|i| !i.is_empty()) {
        Some(id) => items_of(base).map_err(err)?.iter().find(|i| i.id == id).cloned(),
        None => default_item_for_wearable(base, item_id)?,
    };
    let Some(target) = target else {
        return Err(t("items_game: default_item для предмета {0} не найден", &[json!(item_id)]));
    };
    let key = effect_key(effect_ids);
    let mut effects = Vec::new();
    for id in key.split(',') {
        if id.is_empty() || is_style_token(id) || is_donor_token(id) || kinetic_name(id).is_some() {
            continue;
        }
        let effect = if unusual_number(id).is_some() {
            unusual_item_effect(base, id).map_err(err)?
        } else {
            item_effect_by_id(id)
        };
        effects.push(effect.ok_or_else(|| t("items_game: эффект {0} не найден", &[json!(id)]))?);
    }

    let source_fields = item_fields(base, source_start).map_err(err)?;
    let target_fields = item_fields(base, target.start).map_err(err)?;
    let own_visuals =
        item_visuals(base, source_start).map_err(err)?.unwrap_or_else(|| b"\"visuals\"\r\n{\r\n}".to_vec());
    let (styled, styled_model, applied) = with_style(&own_visuals, style_of(&key)).map_err(err)?;
    let styled_model = styled_model.map(|m| latin1(&m)).filter(|m| !m.is_empty());
    let mut visuals = styled;
    let heroes = item_heroes(base, source_start).map_err(err)?;

    let mut summon = summon;
    let mut assets = item_assets(base, &visuals, &heroes, summon.as_deref_mut()).map_err(err)?;
    let source_model =
        styled_model.clone().or_else(|| field(&source_fields, "model_player").map(String::from)).unwrap_or_default();
    let target_model = field(&target_fields, "model_player").unwrap_or("").to_string();
    let under_stock = !source_model.is_empty()
        && !target_model.is_empty()
        && normalize_asset_path(&source_model) != normalize_asset_path(&target_model);
    let skin = Some(worn_skin(&visuals, 0, None).map_err(err)?).filter(|&s| s != 0);
    if under_stock {
        let mut first = Vec::new();
        if let Some(r) = refit.filter(|r| !r.is_empty()) {
            first.push(AssetCopy::Path {
                from: r.to_string(),
                to: target_model.clone(),
                optional: Some(true),
                skin,
                form: None,
            });
        }
        first.push(AssetCopy::Path {
            from: source_model.clone(),
            to: target_model.clone(),
            optional: None,
            skin,
            form: None,
        });
        assets.asset_copies.splice(0..0, first);
    }

    let mut copied_units = HashSet::new();
    let mut copied_stock = HashSet::new();
    for c in &assets.asset_copies {
        match c {
            AssetCopy::Hero { hero, .. } => {
                copied_units.insert(hero.clone());
            }
            AssetCopy::Unit { unit, to, .. } => {
                copied_units.insert(unit.clone());
                copied_stock.insert(normalize_asset_path(to));
            }
            AssetCopy::Path { to, .. } => {
                copied_stock.insert(normalize_asset_path(to));
            }
        }
    }
    visuals = without_file_swaps(&visuals, &copied_units, &copied_stock).map_err(err)?;
    visuals = strip_key_blocks(&visuals, "unlock");
    if !applied {
        visuals = strip_key_blocks(&visuals, "styles");
    }
    for effect in &effects {
        visuals = append_item_effect(&visuals, effect).map_err(err)?;
    }
    if let Some(donor) = donor_of(&key) {
        let added = donor_additions(base, &visuals, &donor)?;
        visuals = with_modifiers(&visuals, &added);
        let extra_visuals = [&b"\"visuals\"\r\n{\r\n"[..], &added.join(&b"\r\n"[..]), b"\r\n}"].concat();
        let extra = item_assets(base, &extra_visuals, &heroes, summon).map_err(err)?;
        assets.asset_copies.extend(extra.asset_copies);
        assets.sounds.extend(extra.sounds);
    }

    let gems = picks_gems(base, &key)?;
    visuals = with_kinetics(&visuals, &gems);

    let mut patched = set_block_id(&base[source_start..source_end], &target.id);
    let name = field(&target_fields, "name").filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| {
        if target.name.is_empty() {
            target.id.clone()
        } else {
            target.name.clone()
        }
    });
    patched = set_scalar_field(&patched, "name", &name).map_err(err)?;
    patched = set_scalar_field(&patched, "prefab", "default_item").map_err(err)?;
    if target_id.is_some_and(|i| !i.is_empty()) {
        patched = set_scalar_field(&patched, "item_slot", &inferred_item_slot(&target)).map_err(err)?;
    }
    if under_stock {
        patched = set_scalar_field(&patched, "model_player", &target_model).map_err(err)?;
    } else if let Some(m) = &styled_model {
        patched = set_scalar_field(&patched, "model_player", m).map_err(err)?;
    }
    patched = set_visuals_block(&patched, &visuals).map_err(err)?;
    Ok(Patch {
        id: target.id.clone(),
        block: patched,
        own: under_stock.then(|| format!("{}_c", normalize_asset_path(&target_model))),
        added: effects.iter().map(|e| e.modifier.clone()).collect(),
        unplaced: !source_model.is_empty() && target_model.is_empty(),
        kinetic: gems.iter().flat_map(|g| g.activities.iter().map(|a| a.1.clone())).collect(),
        heroes,
        assets,
    })
}
