//! What an item does to the game, read from its block in items_game ("visuals"), and what a mod
//! built from the game's own files has to do to show it on a hero who does not own the item.
//! Replaces src/item-visuals.ts.

use serde::Serialize;
use std::collections::HashMap;

use crate::kv::{self, latin1, Bounds, Child, KvError};
use crate::schema::{self, to_utf8};
use crate::schema_merge::items_by_id;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetModifier {
    #[serde(rename = "type")]
    pub ty: String,
    pub asset: String,
    pub modifier: String,
    pub style: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ItemVisuals {
    pub id: String,
    pub name: String,
    pub slot: String,
    pub heroes: Vec<String>,
    /// the item's own model, worn in its slot
    pub model: String,
    pub styles: Vec<String>,
    pub modifiers: Vec<AssetModifier>,
}

/// One thing a build from the game's files has to do, and whether this code does it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlanStep {
    pub what: String,
    pub how: String,
    pub done: &'static str,
}

fn block_of<'a>(text: &'a [u8], body: Bounds, key: &str) -> Result<Option<Child<'a>>, KvError> {
    let mut hit = None;
    kv::each_child(text, body, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(key.as_bytes()) {
            hit = Some(c);
            return false;
        }
        true
    })?;
    Ok(hit)
}

fn is_modifier(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

/// An item's visuals, by its id; None when the table has no such item.
pub fn item_visuals(text: &[u8], id: &str) -> Result<Option<ItemVisuals>, KvError> {
    let Some((start, _)) = items_by_id(text)?.find(text, id)? else { return Ok(None) };
    let fields: HashMap<String, String> = schema::item_fields(text, start)?.into_iter().collect();
    let body = kv::block_bounds(text, start)?;
    let mut heroes = Vec::new();
    if let Some(used) = block_of(text, body, "used_by_heroes")? {
        kv::each_child(text, used.body.unwrap(), |c| {
            if c.value == Some(b"1") {
                heroes.push(latin1(c.key));
            }
            true
        })?;
    }
    let (mut modifiers, mut styles) = (Vec::new(), Vec::new());
    if let Some(visuals) = block_of(text, body, "visuals")? {
        for c in kv::children(text, visuals.body.unwrap())? {
            if !c.is_block() {
                continue;
            }
            if is_modifier(c.key) {
                let mut f: HashMap<String, String> = HashMap::new();
                kv::each_child(text, c.body.unwrap(), |x| {
                    if let Some(v) = x.value {
                        f.insert(latin1(x.key).to_lowercase(), latin1(v));
                    }
                    true
                })?;
                let get = |k: &str| f.get(k).cloned().unwrap_or_default();
                modifiers.push(AssetModifier {
                    ty: get("type"),
                    asset: get("asset"),
                    modifier: get("modifier"),
                    style: f.get("style").cloned(),
                });
            } else if c.key.eq_ignore_ascii_case(b"styles") {
                for s in kv::children(text, c.body.unwrap())? {
                    if !s.is_block() {
                        continue;
                    }
                    let mut name = String::new();
                    kv::each_child(text, s.body.unwrap(), |x| {
                        if !x.is_block() && x.key.eq_ignore_ascii_case(b"name") {
                            name = latin1(x.value.unwrap_or(b""));
                        }
                        true
                    })?;
                    styles.push(if name.is_empty() { latin1(s.key) } else { name });
                }
            }
        }
    }
    let get = |k: &str| fields.get(k).cloned().unwrap_or_default();
    Ok(Some(ItemVisuals {
        id: id.to_string(),
        name: to_utf8(&get("name")),
        slot: get("item_slot"),
        heroes,
        model: get("model_player"),
        styles,
        modifiers,
    }))
}

/// Items whose name has `query` in it (any case), or the one with that id.
pub fn find_items(text: &[u8], query: &str) -> Result<Vec<(String, String)>, KvError> {
    if !query.is_empty() && query.bytes().all(|c| c.is_ascii_digit()) {
        return Ok(match items_by_id(text)?.find(text, query)? {
            Some(_) => vec![(query.to_string(), item_visuals(text, query)?.map(|v| v.name).unwrap_or_default())],
            None => vec![],
        });
    }
    let q = query.to_lowercase();
    Ok(schema::items_of(text)?
        .iter()
        .map(|i| (i.id.clone(), to_utf8(&i.name)))
        .filter(|(_, n)| n.to_lowercase().contains(&q))
        .collect())
}

/// The free item of a hero's slot, whose model the item's own model takes the place of: (id, model).
pub fn default_item(text: &[u8], hero: &str, slot: &str) -> Result<Option<(String, String)>, KvError> {
    for i in schema::items_of(text)?.iter() {
        if !i.baseitem || i.slot != slot {
            continue;
        }
        if let Some(v) = item_visuals(text, &i.id)? {
            if v.heroes.iter().any(|h| h == hero) {
                return Ok(Some((i.id.clone(), v.model)));
            }
        }
    }
    Ok(None)
}

const ONLY_THE_ITEM: [&str; 7] =
    ["custom_kill_effect", "response_criteria", "chatwheel", "arcana_level", "persona", "loading_screen", "announcer"];

/// What a build from the game's files has to do for each of the item's changes.
pub fn build_plan(text: &[u8], v: &ItemVisuals) -> Result<Vec<PlanStep>, KvError> {
    let mut out = Vec::new();
    let step = |what: String, how: String, done: &'static str| PlanStep { what, how, done };
    for hero in &v.heroes {
        if let Some((_, plain)) = default_item(text, hero, &v.slot)? {
            if !v.model.is_empty() && !plain.is_empty() {
                out.push(step(
                    format!("the item's own model, worn in its slot ({})", v.slot),
                    format!("{} under {plain}", v.model),
                    "built",
                ));
            }
        }
    }
    for m in &v.modifiers {
        let at = m.style.as_deref().filter(|s| !s.is_empty()).map(|s| format!(" (style {s})")).unwrap_or_default();
        let (asset, modifier, ty) = (&m.asset, &m.modifier, &m.ty);
        out.push(match ty.as_str() {
            "entity_model" if !(asset.len() >= 14 && asset.as_bytes()[..14].eq_ignore_ascii_case(b"npc_dota_hero_")) => step(
                format!("a summon's model ({asset}){at}"),
                format!("{modifier} under the unit's plain model from scripts/npc/npc_units.txt, when that sits in the hero's model folder (summonModels); another hero's summon stays a swap in the table, which only hero demo reads"),
                "built",
            ),
            "entity_model" => step(
                format!("the hero's own model{at}"),
                format!("{modifier} under the hero's model path; its animations that need the item's activity modifier made the plain ones (asModel); its portrait camera under the plain path (item-portraits.ts)"),
                "built",
            ),
            "activity" => step(
                format!("activity modifier \"{modifier}\"{at}"),
                "only the item switches it on: take it off the swapped model's animation clips (ANIM) and sequences (ASEQ), asModel; the game picks by the clips".into(),
                "built",
            ),
            "model" => step(format!("a model swap{at}"), format!("{modifier} under {asset}"), "by hand"),
            "particle" => step(format!("a particle swap{at}"), format!("{modifier} under {asset}; its children keep their own paths"), "by hand"),
            "particle_create" => step(
                format!("a particle the item creates{at}"),
                format!("{modifier}: no item creates it, so hang it as a child of a particle the hero always has, with a control point of its own on the attachment it is made for (withChildren)"),
                "by hand",
            ),
            "sound" => step(
                format!("a sound{at}"),
                format!("{asset} plays {modifier} instead: the item switches the event; a mod would put the new event's sound files under the old one's, not tried yet"),
                "by hand",
            ),
            "ability_icon" | "icon_replacement_hero" | "icon_replacement_hero_minimap" => step(
                format!("a picture ({ty}){at}"),
                format!("{modifier} under {asset}, in panorama/images; the minimap's in its sprite sheet too (item-portraits.ts)"),
                "built",
            ),
            t if ONLY_THE_ITEM.contains(&t) => step(format!("{t}{at}"), "comes with the item itself, outside the files: a mod cannot give it".into(), "cannot"),
            t => step(format!("{t}{at}"), format!("{asset} -> {modifier}: not met before, look at it"), "by hand"),
        });
    }
    Ok(out)
}
