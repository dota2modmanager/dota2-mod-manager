//! Refits, replacing src/item-builder-refits.ts: an item's model made again to fit a body another
//! item gives the hero (Faceless Void's arcana, Drow's). The build gives a pick the refit any other
//! pick makes of its model, and lets a pick's own model keep its stock path over another pick's
//! swap of the stock model there.

use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashSet;

use crate::item_builder::effect_key;
use crate::item_builder_assets::normalize_asset_path;
use crate::item_builder_styles::{style_of, with_style};
use crate::kv::{self, latin1, KvError};
use crate::schema::item_fields;

/// What a pick wears, and what it makes of other items' models, as normalize_asset_path writes them.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PickModels {
    pub model: String,
    pub swaps: IndexMap<String, String>,
}

fn is_modifier_key(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

/// The model a pick wears in its chosen style, and the model swaps that style makes.
pub fn pick_models(text: &[u8], item_id: &str, effect_ids: &[String]) -> Result<Option<PickModels>, KvError> {
    let Some((start, _)) = crate::schema_merge::items_by_id(text)?.find(text, item_id)? else { return Ok(None) };
    let mut visuals = None;
    kv::each_child(text, kv::block_bounds(text, start)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            visuals = Some(&text[c.start..c.end]);
        }
        true
    })?;
    let styled = match visuals {
        Some(v) => Some(with_style(v, style_of(&effect_key(effect_ids)))?),
        None => None,
    };
    let mut swaps = IndexMap::new();
    if let Some((sv, _, _)) = &styled {
        for c in kv::children(sv, kv::block_bounds(sv, 0)?)? {
            let Some(body) = c.body else { continue };
            if !is_modifier_key(c.key) {
                continue;
            }
            let mut f: IndexMap<String, String> = IndexMap::new();
            for x in kv::children(sv, body)? {
                if let Some(v) = x.value {
                    f.insert(latin1(x.key).to_lowercase(), latin1(v));
                }
            }
            let get = |k: &str| f.get(k).map_or("", String::as_str);
            let style = get("style");
            if get("type").to_lowercase() == "model"
                && !get("asset").is_empty()
                && !get("modifier").is_empty()
                && (style.is_empty() || style == "0")
            {
                swaps.insert(normalize_asset_path(get("asset")), normalize_asset_path(get("modifier")));
            }
        }
    }
    let model = match styled.and_then(|s| s.1).filter(|m| !m.is_empty()) {
        Some(m) => latin1(&m),
        None => {
            item_fields(text, start)?.into_iter().find(|(k, _)| k == "model_player").map(|(_, v)| v).unwrap_or_default()
        }
    };
    Ok(Some(PickModels { model: normalize_asset_path(&model), swaps }))
}

/// Each pick's refit: the model another pick makes of the one it wears. Not its own swaps.
pub fn refits_of<K: Clone + Eq + std::hash::Hash>(picks: &IndexMap<K, PickModels>) -> IndexMap<K, String> {
    let mut out = IndexMap::new();
    for (key, own) in picks {
        if own.model.is_empty() {
            continue;
        }
        for (other, theirs) in picks {
            if other == key {
                continue;
            }
            if let Some(refit) = theirs.swaps.get(&own.model).filter(|r| !r.is_empty()) {
                out.insert(key.clone(), refit.clone());
                break;
            }
        }
    }
    out
}

/// One pick as own_models_win sees it: the files its patch brings, and the stock path its own
/// model goes under, as the entry paths write it.
pub struct OwnedPick {
    pub assets: Option<Vec<(String, Vec<u8>)>>,
    pub own: Option<String>,
}

/// A pick's own model keeps its stock path: another pick's file at that path is taken out of that pick.
pub fn own_models_win(picks: &mut [OwnedPick]) {
    let owned: HashSet<String> = picks.iter().filter_map(|p| p.own.clone().filter(|o| !o.is_empty())).collect();
    if owned.is_empty() {
        return;
    }
    for p in picks.iter_mut() {
        let own = p.own.clone();
        if let Some(assets) = &mut p.assets {
            assets.retain(|(at, _)| {
                let at = at.to_lowercase();
                own.as_deref() == Some(at.as_str()) || !owned.contains(&at)
            });
        }
    }
}
