//! A slot worn empty: the hero without his stock item there, asked for in Discord after 4.5.0
//! ("no hands", as another changer does it).
//!
//! The window offers the slot's own stock item as the "Empty" card, and a stock item picked for
//! its own slot has nothing else to mean: the build then puts the model that draws nothing (the
//! one the pedestal is hidden with, loadout_pedestal::EMPTY_MODEL) under the stock model's path,
//! and the item keeps no visuals, so no particle of it is left hanging in the air.

use serde_json::json;

use crate::i18n::t;
use crate::item_builder::{set_visuals_block, Patch};
use crate::item_builder_assets::{AssetCopy, ItemAssets};
use crate::item_builder_slots::item_heroes;
use crate::loadout_pedestal::EMPTY_MODEL;
use crate::schema::{item_fields, items_of};

/// The patch that empties the slot of stock item `item_id`; None when `item_id` is no stock item.
pub fn empty_slot_patch(base: &[u8], item_id: &str) -> Result<Option<Patch>, String> {
    let err = |e: crate::kv::KvError| e.to_string();
    let items = items_of(base).map_err(err)?;
    let Some(item) = items.iter().find(|i| i.id == item_id && i.prefab == "default_item") else {
        return Ok(None);
    };
    let fields = item_fields(base, item.start).map_err(err)?;
    let model = fields
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("model_player"))
        .map(|(_, v)| v.trim().to_string())
        .filter(|m| !m.is_empty())
        .ok_or_else(|| t("У предмета {0} нет своей модели: в этом слоте нечего снимать", &[json!(item_id)]))?;
    let block = set_visuals_block(&base[item.start..item.end], b"\"visuals\"\r\n{\r\n}").map_err(err)?;
    let copy = AssetCopy::Path { from: EMPTY_MODEL.to_string(), to: model, optional: None, skin: None, form: None };
    Ok(Some(Patch {
        id: item.id.clone(),
        block,
        own: None,
        added: vec![],
        unplaced: false,
        kinetic: vec![],
        heroes: item_heroes(base, item.start).map_err(err)?,
        assets: ItemAssets {
            asset_copies: vec![copy],
            sounds: vec![],
            voices: vec![],
            portraits: vec![],
            sprites: vec![],
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &[u8] = b"\"items_game\"\r\n{\r\n\t\"items\"\r\n\t{\r\n\t\t\"100\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"Axe Belt\"\r\n\t\t\t\"prefab\"\t\t\"default_item\"\r\n\t\t\t\"item_slot\"\t\t\"belt\"\r\n\t\t\t\"model_player\"\t\t\"models/heroes/axe/axe_belt.vmdl\"\r\n\t\t\t\"used_by_heroes\"\r\n\t\t\t{\r\n\t\t\t\t\"npc_dota_hero_axe\"\t\t\"1\"\r\n\t\t\t}\r\n\t\t\t\"visuals\"\r\n\t\t\t{\r\n\t\t\t\t\"asset_modifier\"\r\n\t\t\t\t{\r\n\t\t\t\t\t\"type\"\t\t\"particle_create\"\r\n\t\t\t\t\t\"modifier\"\t\t\"particles/a.vpcf\"\r\n\t\t\t\t}\r\n\t\t\t}\r\n\t\t}\r\n\t\t\"200\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"Paid Belt\"\r\n\t\t\t\"prefab\"\t\t\"wearable\"\r\n\t\t\t\"item_slot\"\t\t\"belt\"\r\n\t\t}\r\n\t}\r\n}\r\n";

    #[test]
    fn a_stock_item_picked_for_its_own_slot_empties_it() {
        let p = empty_slot_patch(TABLE, "100").unwrap().expect("a stock item");
        assert_eq!(p.id, "100");
        assert_eq!(
            p.assets.asset_copies,
            [AssetCopy::Path {
                from: EMPTY_MODEL.into(),
                to: "models/heroes/axe/axe_belt.vmdl".into(),
                optional: None,
                skin: None,
                form: None
            }]
        );
        let block = String::from_utf8_lossy(&p.block);
        assert!(!block.contains("particles/a.vpcf"), "its own particle goes with it: {block}");
        assert!(block.contains("axe_belt.vmdl"), "the table keeps the path the file now stands at");
        assert_eq!(p.heroes, ["npc_dota_hero_axe"]);
    }

    #[test]
    fn a_paid_item_is_no_empty_slot() {
        assert!(empty_slot_patch(TABLE, "200").unwrap().is_none());
    }
}
