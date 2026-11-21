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
    assert_eq!(d, Dressed { heroes: 2, kept: 0, arcanas: 0, immortals: 0 });
    let on = worn(&lib);
    let items: Vec<&str> = on.iter().map(|(_, i)| i.as_str()).collect();
    // Axe in its set; Lina in the crown set, the only one of hers that goes on whole
    assert_eq!(items, ["200", "300", "400"], "worn: {on:?}");
    assert!(
        on.iter().all(|(slot, item)| (item == "400") == slot.contains("lina")),
        "a piece on the wrong hero: {on:?}"
    );
}

#[test]
fn a_hero_already_wearing_a_pick_keeps_it_unless_told_otherwise() {
    let (_dir, mut lib) = library("keep");
    let helm = slot_of("axe", "head");
    pick_cosmetic(&mut lib, &helm, "200", Some("Horned Helm"), None, "").unwrap();
    let d = dress_all(&mut lib, TABLE, true, 7).unwrap();
    assert_eq!(d, Dressed { heroes: 1, kept: 1, arcanas: 0, immortals: 0 });
    assert!(!worn(&lib).iter().any(|(_, i)| i == "300"), "Axe got his set over the pick he chose");

    let d = dress_all(&mut lib, TABLE, false, 7).unwrap();
    assert_eq!(d, Dressed { heroes: 2, kept: 0, arcanas: 0, immortals: 0 });
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

#[test]
fn undressing_takes_off_what_the_button_put_on_and_nothing_the_player_chose() {
    let (_dir, mut lib) = library("undress");
    let helm = slot_of("axe", "head");
    pick_cosmetic(&mut lib, &helm, "200", Some("Horned Helm"), None, "").unwrap();
    let d = dress_all(&mut lib, TABLE, true, 3).unwrap();
    assert_eq!((d.heroes, d.kept), (1, 1));
    // the player changes one of Lina's pieces by hand afterwards: that one is theirs now
    let crown = slot_of("lina", "head");
    assert!(worn(&lib).contains(&(crown.clone(), "400".into())));
    pick_cosmetic(&mut lib, &crown, "120", Some("Lina Default Head"), None, "").unwrap();

    assert_eq!(undress_all(&mut lib).unwrap(), 0, "Lina's only piece from the button was replaced by hand");
    assert_eq!(worn(&lib), [(helm.clone(), "200".into()), (crown.clone(), "120".into())]);

    let d = dress_all(&mut lib, TABLE, false, 3).unwrap();
    assert_eq!(d.heroes, 2);
    assert_eq!(undress_all(&mut lib).unwrap(), 2);
    // the helm was the player's before either press: it stays
    assert_eq!(worn(&lib), [(helm, "200".into())]);
    assert!(lib.list().iter().all(|r| r.get(DRESSED_ALL).is_none()), "a mark stayed behind");
    // the rows the button made are gone; Lina's crown (made by the first press, the player's
    // since they picked over it and back) is not, nor the head they picked by hand
    let items: HashSet<String> = lib.list().iter().map(|r| crate::js::string(&r["itemId"])).collect();
    assert!(!items.contains("300"), "the set's blade the button made is still in My mods");
    assert!(items.contains("120") && items.contains("200"), "a pick of the player's was removed: {items:?}");
    assert_eq!(undress_all(&mut lib).unwrap(), 0, "a second undo found something");
}

/// The looks on the real table, printed: `MM_ITEMS_GAME=<items_game.txt> cargo test -p mm-core looks_on_the_real_table -- --ignored --nocapture`
#[test]
#[ignore]
fn looks_on_the_real_table() {
    use crate::item_builder_worth as worth;
    let Ok(path) = std::env::var("MM_ITEMS_GAME") else { return };
    let text = std::fs::read(path).unwrap();
    let slots = crate::item_builder_slots::item_slots(&text).unwrap();
    let sets = crate::item_builder_sets::item_sets(&text, &slots).unwrap();
    let drops = worth::drops(&text).unwrap();
    eprintln!("cache {} bonus {} treasure {}", drops.cache.len(), drops.bonus.len(), drops.treasure.len());
    let looks = worth::best_looks(&slots, &sets, &drops, &mut worth::Rng::new(7));
    let only = std::env::var("MM_HEROES").unwrap_or_default();
    for (hero, look) in &looks {
        if !only.is_empty() && !only.split(',').any(|h| hero.contains(h)) {
            continue;
        }
        let set = look
            .set
            .map(|s| format!("{} [{} {}]", s.name, s.rarity, worth::set_worth(s, &drops)))
            .unwrap_or("-".into());
        let over: Vec<String> =
            look.over.iter().map(|p| format!("{}: {}", p.slot.rsplit(':').next().unwrap_or(""), p.name)).collect();
        eprintln!("{hero}: {set}\n    {}", over.join(" | "));
    }
}

/// Axe's set, and an immortal weapon that goes on over the set's blade.
const OVER: &[u8] = br#""items_game"
{
    "items"
    {
        "100" { "name" "Axe Default Head" "prefab" "default_item" "item_slot" "head" "model_player" "models/heroes/axe/axe_helm.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "110" { "name" "Axe Default Weapon" "prefab" "default_item" "item_slot" "weapon" "model_player" "models/heroes/axe/axe_weapon.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "200" { "name" "Horned Helm" "prefab" "wearable" "item_slot" "head" "model_player" "models/items/axe/horned/horned.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "300" { "name" "Red Blade" "prefab" "wearable" "item_slot" "weapon" "model_player" "models/items/axe/red/red.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "310" { "name" "Blade of the Immortal" "prefab" "wearable" "item_slot" "weapon"
			"item_rarity" "immortal"
            "model_player" "models/items/axe/imm/imm.vmdl" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
        "900" { "name" "Axe Red Set" "prefab" "bundle" "used_by_heroes" { "npc_dota_hero_axe" "1" } "bundle" { "Horned Helm" "1" "Red Blade" "1" } }
    }
}
"#;

#[test]
fn a_set_piece_an_immortal_covers_is_not_left_in_my_mods() {
    let (_dir, mut lib) = library("over");
    let d = dress_all(&mut lib, OVER, true, 5).unwrap();
    assert_eq!(d.immortals, 1);
    let rows: Vec<String> = lib
        .list()
        .iter()
        .filter(|r| str_of(r, "categoryId") == Some("cosmetic"))
        .map(|r| crate::js::string(&r["itemId"]))
        .collect();
    // one row a slot: the set's blade under the immortal read as a second weapon
    let mut sorted = rows.clone();
    sorted.sort();
    assert_eq!(sorted, ["200", "310"], "rows: {rows:?}");
    assert_eq!(undress_all(&mut lib).unwrap(), 1);
    assert!(lib.list().is_empty(), "the undo leaves nothing behind");
}
