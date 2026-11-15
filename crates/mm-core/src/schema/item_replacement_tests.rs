//! A pick written over another wearable of its slot (#679): which targets are taken, and that the
//! target stays with the pick through a change of effects, a saved preset and a shared link.

use super::*;
use crate::library::Library;
use serde_json::json;

/// Axe with a stock helm, two paid helms and a paid blade.
const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "100"
        {
            "name"  "Axe Default Head"
            "prefab"  "default_item"
            "item_slot"  "head"
            "model_player"  "models/heroes/axe/axe_helm.vmdl"
            "used_by_heroes" { "npc_dota_hero_axe" "1" }
        }
        "110"
        {
            "name"  "Axe Default Weapon"
            "prefab"  "default_item"
            "item_slot"  "weapon"
            "model_player"  "models/heroes/axe/axe_weapon.vmdl"
            "used_by_heroes" { "npc_dota_hero_axe" "1" }
        }
        "200"
        {
            "name"  "Horned Helm"
            "prefab"  "wearable"
            "item_slot"  "head"
            "model_player"  "models/items/axe/horned/horned.vmdl"
            "used_by_heroes" { "npc_dota_hero_axe" "1" }
        }
        "201"
        {
            "name"  "Iron Helm"
            "prefab"  "wearable"
            "item_slot"  "head"
            "model_player"  "models/items/axe/iron/iron.vmdl"
            "used_by_heroes" { "npc_dota_hero_axe" "1" }
        }
        "300"
        {
            "name"  "Red Blade"
            "prefab"  "wearable"
            "item_slot"  "weapon"
            "model_player"  "models/items/axe/red/red.vmdl"
            "used_by_heroes" { "npc_dota_hero_axe" "1" }
        }
    }
}
"#;

fn head() -> String {
    let slots = crate::item_builder_slots::item_slots(TABLE).unwrap();
    let s = slots.iter().find(|s| s.equip_slot == "head").expect("the fixture has a head slot");
    let ids: Vec<&str> = s.options.iter().map(|o| o.id.as_str()).collect();
    assert!(ids.contains(&"200") && ids.contains(&"201"), "the fixture's helms are not offered: {ids:?}");
    s.slot.clone()
}

#[test]
fn no_target_is_the_default_and_reads_nothing() {
    // an empty table would fail to parse: none of these may get as far as reading it
    let mut r = Replacements::new(b"");
    for none in [None, Some(&Value::Null), Some(&json!(""))] {
        assert_eq!(r.check("item:axe:head", "200", none).unwrap(), "");
    }
    assert_eq!(checked_target(|| panic!("read the table for no target"), "item:axe:head", "200", None).unwrap(), "");
}

#[test]
fn an_item_replaces_another_wearable_of_its_own_slot() {
    let slot = head();
    assert_eq!(Replacements::new(TABLE).check(&slot, "200", Some(&json!("201"))).unwrap(), "201");
    assert_eq!(checked_target(|| Ok(TABLE.to_vec()), &slot, "201", Some(&json!("200"))).unwrap(), "200");
}

#[test]
fn a_target_outside_the_slot_or_the_item_itself_is_refused() {
    let slot = head();
    let mut r = Replacements::new(TABLE);
    // the blade is a wearable, but of the weapon slot
    assert!(r.check(&slot, "200", Some(&json!("300"))).is_err());
    assert!(r.check(&slot, "200", Some(&json!("200"))).is_err(), "an item replacing itself");
    assert!(r.check(&slot, "300", Some(&json!("201"))).is_err(), "an item from another slot");
    assert!(r.check(&slot, "200", Some(&json!("999"))).is_err(), "an item the game does not have");
    assert!(r.check(&slot, "200", Some(&json!(201))).is_err(), "a number where an id string goes");
    assert!(r.check("weather", "200", Some(&json!("201"))).is_err(), "a slot that is not a hero's");
    assert!(r.check("item:axe:nowhere", "200", Some(&json!("201"))).is_err());
}

struct Scratch(std::path::PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn library(name: &str) -> (Scratch, Library) {
    let dir = std::env::temp_dir().join(format!("mm-replace-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let lib = Library::new(&dir);
    (Scratch(dir), lib)
}

#[test]
fn the_target_is_part_of_the_pick_and_changes_on_the_same_row() {
    use crate::schema_cosmetics::pick_cosmetic;
    let (_dir, mut lib) = library("row");
    let slot = "item:axe:head";
    let first = pick_cosmetic(&mut lib, slot, "200", Some("Horned Helm"), None, "201").unwrap().unwrap();
    assert_eq!(first["targetItemId"], "201");
    // the same item over the default now: the same row, the target gone
    let back = pick_cosmetic(&mut lib, slot, "200", Some("Horned Helm"), None, "").unwrap().unwrap();
    assert_eq!(back["id"], first["id"]);
    assert!(back.get("targetItemId").is_none(), "the old target is still on the record: {back}");
    let again = pick_cosmetic(&mut lib, slot, "200", Some("Horned Helm"), None, "201").unwrap().unwrap();
    assert_eq!(again["id"], first["id"]);
    assert_eq!(lib.list().len(), 1, "a change of target made another row");

    // a preset keeps it, and a record from before the field still reads as the default
    let picks = lib.picks_on();
    assert_eq!(picks[0]["targetItemId"], "201");
    assert!(Library::pick_of(&json!({ "slot": slot, "itemId": "200", "name": "Horned Helm" }))
        .get("targetItemId")
        .is_none());
}

#[test]
fn a_shared_link_carries_the_target_and_an_old_link_has_none() {
    use crate::preset_link::{decode_preset_link, encode_preset_link};
    let pick = json!({ "kind": "cosmetic", "slot": "item:axe:head", "itemId": "200", "name": "Horned Helm", "effectId": "", "targetItemId": "201" });
    let plain =
        json!({ "kind": "cosmetic", "slot": "item:axe:weapon", "itemId": "300", "name": "Red Blade", "effectId": "" });
    let link = encode_preset_link(&json!("Axe"), &Value::Null, &[pick, plain]);
    let got = decode_preset_link(&json!(link.code)).unwrap();
    let mods = serde_json::to_value(&got).unwrap()["mods"].clone();
    assert_eq!(mods[0]["targetItemId"], "201");
    assert!(mods[1].get("targetItemId").is_none(), "a pick over the default grew a target: {}", mods[1]);
}
