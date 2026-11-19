//! Every hero in a set at once (`dress_all`): each hero gets one of its own sets whole, a hero who
//! already wears a pick keeps it, and one reading of the table does all of them.

use super::*;
use crate::library::Library;

/// Axe and Lina, each with a stock head and weapon, paid pieces, and one set that goes on whole.
/// Lina has a second set with a piece that has no slot here: it cannot go on whole and is never drawn.
const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "100" { "name" "Axe Default Head" "prefab" "default_item" "item_slot" "head" "model_player" "models/heroes/axe/axe_helm.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "110" { "name" "Axe Default Weapon" "prefab" "default_item" "item_slot" "weapon" "model_player" "models/heroes/axe/axe_weapon.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "200" { "name" "Horned Helm" "prefab" "wearable" "item_slot" "head" "model_player" "models/items/axe/horned/horned.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "300" { "name" "Red Blade" "prefab" "wearable" "item_slot" "weapon" "model_player" "models/items/axe/red/red.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "120" { "name" "Lina Default Head" "prefab" "default_item" "item_slot" "head" "model_player" "models/heroes/lina/lina_head.vmdl" "used_by_heroes" { "npc_dota_hero_lina" "1" } }
        "400" { "name" "Flame Crown" "prefab" "wearable" "item_slot" "head" "model_player" "models/items/lina/crown/crown.vmdl" "used_by_heroes" { "npc_dota_hero_lina" "1" } }
        "410" { "name" "Ember Cape" "prefab" "wearable" "item_slot" "back" "model_player" "models/items/lina/cape/cape.vmdl" "used_by_heroes" { "npc_dota_hero_lina" "1" } }
        "900" { "name" "Axe Red Set" "prefab" "bundle" "used_by_heroes" { "npc_dota_hero_axe" "1" } "bundle" { "Horned Helm" "1" "Red Blade" "1" } }
        "910" { "name" "Lina Crown Set" "prefab" "bundle" "used_by_heroes" { "npc_dota_hero_lina" "1" } "bundle" { "Flame Crown" "1" } }
        "920" { "name" "Lina Cape Set" "prefab" "bundle" "used_by_heroes" { "npc_dota_hero_lina" "1" } "bundle" { "Flame Crown" "1" "Ember Cape" "1" } }
    }
}
"#;

struct Scratch(std::path::PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn library(name: &str) -> (Scratch, Library) {
    let dir = std::env::temp_dir().join(format!("mm-dress-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let lib = Library::new(&dir);
    (Scratch(dir), lib)
}

fn worn(lib: &Library) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = lib
        .list()
        .iter()
        .filter(|r| str_of(r, "categoryId") == Some("cosmetic") && on(r))
        .map(|r| (str_of(r, "slot").unwrap_or("").to_string(), crate::js::string(&r["itemId"])))
        .collect();
    out.sort();
    out
}

fn slot_of(hero: &str, equip: &str) -> String {
    let slots = crate::item_builder_slots::item_slots(TABLE).unwrap();
    let s = slots.iter().find(|s| s.slot.contains(hero) && s.equip_slot == equip);
    s.unwrap_or_else(|| panic!("the fixture has no {equip} slot for {hero}")).slot.clone()
}

#[test]
fn every_hero_gets_one_of_its_own_sets_whole() {
    let (_dir, mut lib) = library("all");
    let d = dress_all(&mut lib, TABLE, true, 42).unwrap();
    assert_eq!(d, Dressed { heroes: 2, kept: 0 });
    let on = worn(&lib);
    let items: Vec<&str> = on.iter().map(|(_, i)| i.as_str()).collect();
    // Axe in its set; Lina in the crown set, the only one of hers that goes on whole
    assert_eq!(items, ["200", "300", "400"], "worn: {on:?}");
    assert!(on.iter().all(|(slot, item)| (item == "400") == slot.contains("lina")), "a piece on the wrong hero: {on:?}");
}

#[test]
fn a_hero_already_wearing_a_pick_keeps_it_unless_told_otherwise() {
    let (_dir, mut lib) = library("keep");
    let helm = slot_of("axe", "head");
    pick_cosmetic(&mut lib, &helm, "200", Some("Horned Helm"), None, "").unwrap();
    let d = dress_all(&mut lib, TABLE, true, 7).unwrap();
    assert_eq!(d, Dressed { heroes: 1, kept: 1 });
    assert!(!worn(&lib).iter().any(|(_, i)| i == "300"), "Axe got his set over the pick he chose");

    let d = dress_all(&mut lib, TABLE, false, 7).unwrap();
    assert_eq!(d, Dressed { heroes: 2, kept: 0 });
    assert!(worn(&lib).iter().any(|(_, i)| i == "300"), "Axe was not dressed with keep_worn off");
}

#[test]
fn a_batch_writes_the_manifest_once_at_its_end() {
    let (_dir, mut lib) = library("batch");
    let file = lib.file.clone();
    let d = lib
        .batch(|lib| {
            let d = dress_all(lib, TABLE, true, 1).unwrap();
            assert!(!file.exists(), "the manifest was written inside the batch");
            d
        })
        .unwrap();
    assert_eq!(d.heroes, 2);
    let back = Library::new(file.parent().unwrap());
    assert_eq!(worn(&back), worn(&lib), "the manifest on disk is not what the batch left in memory");
}
