//! The best look: a cache's set over the store's, a rare extra's over a regular drop's, and the
//! hero's immortals over it, golden and as a pair.

use super::*;
use crate::item_builder_sets::item_sets;
use crate::item_builder_slots::{builder_slots, item_slots};

/// Anti-Mage with a stock head, weapon, offhand and belt and two sets: one from the store, one out
/// of a Collector's Cache. His immortals: a plain pair of bashers, a golden pair, and newer golden
/// blades with no offhand to match. Largo has only stock items.
const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "1" { "name" "AM Head" "prefab" "default_item" "item_slot" "head" "model_player" "models/am/head.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "2" { "name" "AM Weapon" "prefab" "default_item" "item_slot" "weapon" "model_player" "models/am/weapon.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "3" { "name" "AM Offhand" "prefab" "default_item" "item_slot" "offhand_weapon" "model_player" "models/am/offhand.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "4" { "name" "AM Belt" "prefab" "default_item" "item_slot" "belt" "model_player" "models/am/belt.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "10" { "name" "Store Head" "prefab" "wearable" "item_slot" "head"
			"item_rarity" "mythical"
            "model_player" "models/am/s_head.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "11" { "name" "Store Blade" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "mythical"
            "model_player" "models/am/s_weapon.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "12" { "name" "Store Belt" "prefab" "wearable" "item_slot" "belt"
			"item_rarity" "mythical"
            "model_player" "models/am/s_belt.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "20" { "name" "Cache Head" "prefab" "wearable" "item_slot" "head"
			"item_rarity" "mythical"
            "model_player" "models/am/c_head.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "21" { "name" "Cache Blade" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "mythical"
            "model_player" "models/am/c_weapon.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "22" { "name" "Cache Belt" "prefab" "wearable" "item_slot" "belt"
			"item_rarity" "mythical"
            "model_player" "models/am/c_belt.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "30" { "name" "Basher of Mage Skulls" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "immortal"
            "model_player" "models/am/b.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "31" { "name" "Offhand Basher of Mage Skulls" "prefab" "wearable" "item_slot" "offhand_weapon"
			"item_rarity" "immortal"
            "model_player" "models/am/b_off.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "32" { "name" "Golden Basher of Mage Skulls" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "immortal"
            "model_player" "models/am/gb.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "33" { "name" "Golden Offhand Basher of Mage Skulls" "prefab" "wearable" "item_slot" "offhand_weapon"
			"item_rarity" "immortal"
            "model_player" "models/am/gb_off.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "34" { "name" "Golden Basher Blades" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "immortal"
           
			"creation_date" "2025-01-01"
            "model_player" "models/am/gblades.vmdl" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
        "100" { "name" "Store Set" "prefab" "bundle"
			"item_rarity" "mythical"
            "used_by_heroes" { "npc_dota_hero_antimage" "1" } "bundle" { "Store Head" "1" "Store Blade" "1" "Store Belt" "1" } }
        "101" { "name" "Cache Set" "prefab" "bundle"
			"item_rarity" "mythical"
            "used_by_heroes" { "npc_dota_hero_antimage" "1" } "bundle" { "Cache Head" "1" "Cache Blade" "1" "Cache Belt" "1" } }
        "200" { "name" "The International Collector's Cache" "prefab" "treasure_chest" "static_attributes" { "treasure loot list" { "attribute_class" "treasure loot list" "value" "cache_list" } } }
        "201" { "name" "Some Treasure" "prefab" "treasure_chest" "static_attributes" { "treasure loot list" { "attribute_class" "treasure loot list" "value" "treasure_list" } } }
        "300" { "name" "Largo's Head" "prefab" "default_item" "item_slot" "head" "model_player" "models/largo/head.vmdl" "used_by_heroes" { "npc_dota_hero_largo" "1" } }
    }
    "loot_lists"
    {
        "cache_list" { "cache_sets" "1" }
        "cache_sets" { "Cache Set" "1" }
        "treasure_list"
        {
            "Store Set" "1"
            "escalating_chance_drop_by_rarity" { "slot" "A" "treasure_rarity_override" "ultra_rare" "item" "Golden Basher of Mage Skulls" }
        }
    }
}
"#;

#[test]
fn the_treasures_say_what_came_out_of_a_cache_and_what_only_as_a_rare_extra() {
    let d = drops(TABLE).unwrap();
    assert!(d.cache.contains("Cache Set"), "the cache's set, through the list its list names");
    assert!(!d.cache.contains("Store Set"));
    assert!(d.treasure.contains("Store Set"));
    assert!(d.bonus.contains("Golden Basher of Mage Skulls"), "the ultra rare extra");
    assert!(!d.bonus.contains("Store Set"));
}

#[test]
fn the_cache_set_goes_on_before_the_store_set_whatever_the_draw() {
    let slots = item_slots(TABLE).unwrap();
    let sets = item_sets(TABLE, &slots).unwrap();
    let d = drops(TABLE).unwrap();
    for seed in 1..20 {
        let looks = best_looks(&slots, &sets, &d, &mut Rng::new(seed));
        assert_eq!(looks["antimage"].set.map(|s| s.name.as_str()), Some("Cache Set"), "seed {seed}");
    }
}

#[test]
fn the_immortals_go_on_over_it_golden_and_as_a_pair() {
    let slots = item_slots(TABLE).unwrap();
    let sets = item_sets(TABLE, &slots).unwrap();
    let looks = best_looks(&slots, &sets, &drops(TABLE).unwrap(), &mut Rng::new(3));
    let over: Vec<(String, String)> = looks["antimage"]
        .over
        .iter()
        .map(|p| (p.slot.rsplit(':').next().unwrap().to_string(), p.name.clone()))
        .collect();
    // the golden pair: not the newer golden blades with no offhand to match, nor the plain pair
    let want = [("weapon", "Golden Basher of Mage Skulls"), ("offhand_weapon", "Golden Offhand Basher of Mage Skulls")];
    assert_eq!(over, want.map(|(s, n)| (s.to_string(), n.to_string())));
}

#[test]
fn a_hero_with_only_stock_items_still_has_his_slots_in_the_builder() {
    let has_largo = |slots: &[ItemSlot]| slots.iter().any(|s| s.hero_ids == ["largo"]);
    assert!(!has_largo(&item_slots(TABLE).unwrap()), "nothing to pick: not in the item builder's offer");
    let shown = builder_slots(TABLE).unwrap();
    let largo: Vec<&ItemSlot> = shown.iter().filter(|s| s.hero_ids == ["largo"]).collect();
    assert_eq!(largo.len(), 1, "his stock head");
    assert!(largo[0].options.is_empty());
    // a hero with paid items is not listed twice
    assert_eq!(shown.iter().filter(|s| s.slot == "item:antimage:head").count(), 1);
}
