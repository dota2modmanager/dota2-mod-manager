//! Where the picture of a look the table gives no picture of comes from (picture_index).

use super::*;

const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "1" { "name" "Pudge Persona Arms" "prefab" "default_item" "item_slot" "arms_persona_1"
            "image_inventory" "econ/heroes/pudge_cute/pudge_cute_arms" "used_by_heroes" { "npc_dota_hero_pudge" "1" } }
        "2" { "name" "Pudgette - Arms" "prefab" "wearable" "item_slot" "arms_persona_1"
            "used_by_heroes" { "npc_dota_hero_pudge" "1" } }
        "3" { "name" "Arc Warden Ambient FX" "prefab" "wearable" "item_slot" "ambient_effects"
            "image_inventory" "econ/testitem_slot_empty" "used_by_heroes" { "npc_dota_hero_arc_warden" "1" } }
        "4" { "name" "Some Screen" "prefab" "loading_screen" "image_inventory" "econ/testitem_slot_empty"
            "visuals" { "asset_modifier" { "type" "loading_screen" "asset" "loadingscreens/some_screen/some_screen.vtex" } } }
        "5" { "name" "Battle Pass 2022 Versus Screen I" "prefab" "versus_screen" "image_inventory" "econ/versus/bp22_1" }
        "6" { "name" "Battle Pass 2022 Versus Screen II" "prefab" "versus_screen" }
        "7" { "name" "Other Versus Screen" "prefab" "versus_screen" }
    }
}
"#;

#[test]
fn a_look_without_a_picture_takes_one_the_game_has() {
    let items = crate::schema::list_items(TABLE).unwrap();
    let map = picture_index(TABLE, &items, None);
    let at = |n: &str| map.get(n).map(String::as_str);
    // a piece with no picture and no model: the hero's stock piece of that slot, else the hero
    assert_eq!(at("Pudgette - Arms"), Some("econ/heroes/pudge_cute/pudge_cute_arms"));
    assert_eq!(at("Arc Warden Ambient FX"), Some("heroes/npc_dota_hero_arc_warden"));
    // a loading screen with the empty slot's picture: its own, beside the screen
    assert_eq!(at("Some Screen"), Some("econ/loading_screens/some_screen"));
    // a screen of a series: the one it shares most of its name with
    assert_eq!(at("Battle Pass 2022 Versus Screen II"), Some("econ/versus/bp22_1"));
    assert_eq!(at("Other Versus Screen"), None);
}
