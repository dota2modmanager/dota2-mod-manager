//! What a pick in an ability effects slot writes, replacing src/item-builder-fx-patch.ts: the
//! stock item of the slot, with the marked modifiers of the item picked, and the files they need
//! under the plain paths. The item's model, and every modifier the slot does not take, stay out.

use serde::Serialize;
use serde_json::json;
use std::collections::HashSet;

use crate::i18n::t;
use crate::item_builder::{effect_key, item_visuals, set_visuals_block, without_file_swaps};
use crate::item_builder_ability_fx::{fx_target, fx_visuals, has_modifiers};
use crate::item_builder_assets::{item_assets, normalize_asset_path, AssetCopy, ItemAssets, SummonModels};
use crate::item_builder_slots::item_heroes;
use crate::item_builder_styles::{style_of, with_style};
use crate::schema::items_of;

/// Shaped as item_builder::Patch, with no model of its own.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FxPatch {
    pub id: String,
    #[serde(serialize_with = "as_latin1")]
    pub block: Vec<u8>,
    pub own: Option<String>,
    pub added: Vec<String>,
    pub unplaced: bool,
    #[serde(flatten)]
    pub assets: ItemAssets,
}

fn as_latin1<S: serde::Serializer>(b: &[u8], s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&crate::kv::latin1(b))
}

/// The heroes and summons whose model the copies put under their path, and the stock models they
/// put another under: what item_builder::without_file_swaps takes out of the visuals.
pub fn copied(copies: &[AssetCopy]) -> (HashSet<String>, HashSet<String>) {
    let mut units = HashSet::new();
    let mut stock = HashSet::new();
    for c in copies {
        match c {
            AssetCopy::Hero { hero, .. } => {
                units.insert(hero.clone());
            }
            AssetCopy::Unit { unit, to, .. } => {
                units.insert(unit.clone());
                stock.insert(normalize_asset_path(to));
            }
            AssetCopy::Path { to, .. } => {
                stock.insert(normalize_asset_path(to));
            }
        }
    }
    (units, stock)
}

/// The block of ability effects slot `n` with what `item_id` gives it, in the style its key names.
/// An error when the item or the slot's stock item is not in the table, or the item gives the slot nothing.
pub fn ability_fx_patch(
    base: &[u8],
    item_id: &str,
    effect_ids: &[String],
    n: u64,
    summon: Option<&mut SummonModels>,
) -> Result<FxPatch, String> {
    let e = |e: crate::kv::KvError| e.to_string();
    let Some((start, _)) = crate::schema_merge::items_by_id(base).map_err(e)?.find(base, item_id).map_err(e)? else {
        return Err(t("items_game: предмет {0} не найден", &[json!(item_id)]));
    };
    let items = items_of(base).map_err(e)?;
    let Some(target) = fx_target(&items, n) else {
        return Err(t("items_game: default_item для предмета {0} не найден", &[json!(item_id)]));
    };
    let own = item_visuals(base, start).map_err(e)?.unwrap_or_else(|| b"\"visuals\"\r\n{\r\n}".to_vec());
    let (styled, _, _) = with_style(&own, style_of(&effect_key(effect_ids))).map_err(e)?;
    let mut visuals = fx_visuals(&styled, n).map_err(e)?;
    if !has_modifiers(&visuals) {
        return Err(t("У предмета {0} нет эффектов для этой способности", &[json!(item_id)]));
    }
    let assets = item_assets(base, &visuals, &item_heroes(base, start).map_err(e)?, summon).map_err(e)?;
    let (units, stock) = copied(&assets.asset_copies);
    visuals = without_file_swaps(&visuals, &units, &stock).map_err(e)?;
    let block = set_visuals_block(&base[target.start..target.end], &visuals).map_err(e)?;
    Ok(FxPatch { id: target.id.clone(), block, own: None, added: vec![], unplaced: false, assets })
}
