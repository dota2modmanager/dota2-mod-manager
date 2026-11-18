//! A courier look's models under the Default Courier's paths (src/courier-models.ts). The server
//! sets a courier's model from its own item table, where Default Courier is the donkey; under the
//! donkey's paths the courier's own model is what the client loads for it. Also the patch of a
//! look in a slot with no free item of its own.

use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::bytes::Regex;

use crate::item_builder_assets::AssetCopy;
use crate::item_builder_everyone::SchemaPatch;
use crate::kv::{block_bounds, each_child, latin1, KvError};
use crate::schema::{list_items, SchemaItem, OWNERLESS_SLOTS};
use crate::vpk::Entry;

const MODEL_TYPES: [&str; 2] = ["courier", "courier_flying"];

fn slot_of(i: &SchemaItem) -> &str {
    if i.slot.is_empty() {
        &i.prefab
    } else {
        &i.slot
    }
}

fn number(v: &[u8]) -> u64 {
    let n = crate::js::to_number(&serde_json::Value::String(latin1(v)));
    if n.is_finite() && n > 0.0 {
        n as u64
    } else {
        0
    }
}

/// Each courier model swap of an item's first style by "type|asset", and the material set it
/// wears them in: its first style's, else the one its visuals name for every style.
fn courier_models(text: &[u8], id: &str) -> Result<(IndexMap<String, String>, u64), KvError> {
    static ASSET: OnceLock<Regex> = OnceLock::new();
    let asset = ASSET.get_or_init(|| Regex::new(r"(?i-u)^asset_modifier[0-9]*$").unwrap());
    let mut out = IndexMap::new();
    let (mut skin, mut style_skin) = (0u64, None::<u64>);
    let Some((start, _)) = crate::schema::find_item(text, id, None)? else { return Ok((out, skin)) };
    let mut err = None;
    each_child(text, block_bounds(text, start)?, |v| {
        let Some(vb) = v.body.filter(|_| v.key.eq_ignore_ascii_case(b"visuals")) else { return true };
        let r = each_child(text, vb, |c| {
            if !c.is_block() && c.key.eq_ignore_ascii_case(b"skin") {
                skin = number(c.value.unwrap_or_default());
            }
            if let Some(sb) = c.body.filter(|_| c.key.eq_ignore_ascii_case(b"styles")) {
                let _ = each_child(text, sb, |st| {
                    if let Some(b) = st.body.filter(|_| st.key == b"0") {
                        let _ = each_child(text, b, |f| {
                            if !f.is_block() && f.key.eq_ignore_ascii_case(b"skin") {
                                style_skin = Some(number(f.value.unwrap_or_default()));
                            }
                            true
                        });
                    }
                    true
                });
            }
            let Some(cb) = c.body.filter(|_| asset.is_match(c.key)) else { return true };
            let mut f: IndexMap<String, String> = IndexMap::new();
            let _ = each_child(text, cb, |x| {
                if let Some(val) = x.value.filter(|_| !x.is_block()) {
                    f.insert(latin1(x.key).to_lowercase(), latin1(val));
                }
                true
            });
            let ty = f.get("type").map(|t| t.to_lowercase()).unwrap_or_default();
            let style = f.get("style").filter(|s| !s.is_empty());
            let modifier = f.get("modifier").filter(|m| !m.is_empty());
            let (Some(modifier), true, false) =
                (modifier, MODEL_TYPES.contains(&ty.as_str()), style.is_some_and(|s| s != "0"))
            else {
                return true;
            };
            let key = format!("{ty}|{}", f.get("asset").map(|a| a.to_lowercase()).unwrap_or_default());
            out.entry(key).or_insert_with(|| modifier.clone());
            true
        });
        if let Err(e) = r {
            err = Some(e);
            return false;
        }
        true
    })?;
    if let Some(e) = err {
        return Err(e);
    }
    Ok((out, style_skin.unwrap_or(skin)))
}

/// The files a courier look puts under the base courier's models, each where the base has the
/// same kind for the same team, in the courier's material set. Nothing for any other slot.
pub fn courier_copies(text: &[u8], target_id: &str, source_id: &str) -> Result<Vec<AssetCopy>, KvError> {
    let (plain, _) = courier_models(text, target_id)?;
    if plain.is_empty() {
        return Ok(Vec::new());
    }
    let (models, skin) = courier_models(text, source_id)?;
    let mut out = Vec::new();
    for (key, from) in models {
        if let Some(to) = plain.get(&key) {
            if to.to_lowercase() != from.to_lowercase() || skin != 0 {
                out.push(AssetCopy::Unit {
                    from,
                    to: to.clone(),
                    unit: "courier".into(),
                    skin: (skin != 0).then_some(skin),
                });
            }
        }
    }
    Ok(out)
}

fn is_js_space(b: u8) -> bool {
    matches!(b, b'\t' | b'\n' | 0x0b | 0x0c | b'\r' | b' ' | 0xa0)
}

/// In a slot with no free item, the picked item flagged as the free one.
pub fn ownerless_patch(text: &[u8], items: &[SchemaItem], slot: &str, item_id: &str) -> Option<Vec<u8>> {
    static BASE: OnceLock<Regex> = OnceLock::new();
    if !OWNERLESS_SLOTS.contains(&slot) {
        return None;
    }
    let item = items.iter().find(|i| i.id == item_id).filter(|i| slot_of(i) == slot)?;
    let re = BASE.get_or_init(|| Regex::new(r#"(?i-u)[ \t]*"baseitem"[ \t]+"[^"]*"[ \t]*\r?\n"#).unwrap());
    let block = re.replace(&text[item.start..item.end], &b""[..]).into_owned();
    let close = block.iter().rposition(|&b| b == b'}').unwrap_or(block.len());
    let mut head = &block[..close];
    while head.last().is_some_and(|&b| is_js_space(b)) {
        head = &head[..head.len() - 1];
    }
    let mut out = head.to_vec();
    out.extend_from_slice(b"\r\n\t\t\t\"baseitem\"\t\t\"1\"\r\n\t\t");
    out.extend_from_slice(&block[close..]);
    Some(out)
}

/// A pick as a look reads it.
pub struct LookPick<'a> {
    pub name: &'a str,
    pub slot: &'a str,
    pub item_id: &'a str,
}

/// A look's patch: its slot's base item dressed in the picked item's visuals, and for a courier
/// its models under the base's paths; in a slot with no base item, the picked item flagged as the
/// free one. `read` reads a file out of the game's pak01; a model that cannot be read is logged.
pub fn look_patch(
    text: &[u8],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    rec: &LookPick,
    log: &mut dyn FnMut(String),
) -> Result<Option<SchemaPatch>, String> {
    let items = list_items(text).map_err(|e| e.to_string())?;
    let Some(target) = items.iter().find(|i| i.baseitem && slot_of(i) == rec.slot) else {
        return Ok(ownerless_patch(text, &items, rec.slot, rec.item_id).map(|block| SchemaPatch {
            id: rec.item_id.to_string(),
            block,
            assets: Vec::new(),
            source: rec.name.to_string(),
        }));
    };
    let block = crate::schema_merge::base_item_patch(text, &target.id, rec.item_id).map_err(|e| e.to_string())?;
    let copies = courier_copies(text, &target.id, rec.item_id).map_err(|e| e.to_string())?;
    let patch = |assets: Vec<Entry>| SchemaPatch {
        id: target.id.clone(),
        block: block.clone(),
        assets,
        source: rec.name.to_string(),
    };
    if copies.is_empty() {
        return Ok(Some(patch(Vec::new())));
    }
    let assets = match crate::item_builder_assets::game_asset_entries(read, &copies, &|_| false) {
        Ok(a) => a,
        Err(e) => {
            log(format!("schema: {}: its models left out of the build: {e}", rec.name));
            return Ok(Some(patch(Vec::new())));
        }
    };
    if assets.len() < copies.len() {
        log(format!(
            "schema: {}: {} of its {} models left as the plain courier",
            rec.name,
            copies.len() - assets.len(),
            copies.len()
        ));
    }
    let entries = assets.into_iter().map(|(p, d)| crate::vpk::entry_at(&p, d.into())).collect();
    Ok(Some(patch(entries)))
}
