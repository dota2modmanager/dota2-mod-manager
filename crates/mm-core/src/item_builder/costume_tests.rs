//! A costume with no model of its own that only changes the hero's material set (Magnus's
//! Diretide Shimmer Costume, reported 2026-11-16: worn in the builder, plain in the game).

use super::*;

const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "100"
        {
            "name"  "Magnus Default Head"
            "prefab"  "default_item"
            "item_slot"  "head"
            "model_player"  "models/heroes/magnataur/magnataur_head.vmdl"
            "used_by_heroes" { "npc_dota_hero_magnataur" "1" }
        }
        "110"
        {
            "name"  "Magnus Default Weapon"
            "prefab"  "default_item"
            "item_slot"  "weapon"
            "model_player"  "models/heroes/magnataur/magnataur_weapon.vmdl"
            "used_by_heroes" { "npc_dota_hero_magnataur" "1" }
        }
        "18314"
        {
            "name"  "Magnus's Diretide Shimmer Costume"
            "prefab"  "wearable"
            "item_slot"  "costume"
            "used_by_heroes" { "npc_dota_hero_magnataur" "1" }
            "visuals"
            {
                "asset_modifier"
                {
                    "type"  "model_skin"
                    "skin"  "1"
                }
            }
        }
    }
}
"#;

#[test]
fn a_costume_that_only_changes_the_material_set_puts_the_hero_and_his_stock_items_in_it() {
    let p = item_effect_patch(TABLE, "18314", &[], Some("100"), None, None).unwrap();
    let copies = &p.assets.asset_copies;
    assert!(
        copies.iter().any(|c| matches!(c, AssetCopy::Hero { hero, from, skin: Some(1), .. }
            if hero == "npc_dota_hero_magnataur" && from.is_empty())),
        "the hero's own body in set 1: {copies:?}"
    );
    for stock in ["models/heroes/magnataur/magnataur_head.vmdl", "models/heroes/magnataur/magnataur_weapon.vmdl"] {
        assert!(
            copies.iter().any(|c| matches!(c, AssetCopy::Path { from, to, skin: Some(1), optional: Some(true), .. }
                if from == stock && to == stock)),
            "{stock} in set 1: {copies:?}"
        );
    }
}

#[test]
fn an_item_with_a_model_of_its_own_does_not_reskin_the_stock_items() {
    let table = std::str::from_utf8(TABLE).unwrap().replace(
        "\"item_slot\"  \"costume\"",
        "\"item_slot\"  \"head\"\n            \"model_player\"  \"models/items/magnataur/shimmer/head.vmdl\"",
    );
    let p = item_effect_patch(table.as_bytes(), "18314", &[], Some("100"), None, None).unwrap();
    assert!(!p.assets.asset_copies.iter().any(|c| matches!(c, AssetCopy::Hero { .. })), "{:?}", p.assets.asset_copies);
}
