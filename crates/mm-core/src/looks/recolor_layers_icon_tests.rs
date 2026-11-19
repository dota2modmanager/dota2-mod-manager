//! An ability's icon layer paints every icon the game has for it, the arcana's and the
//! immortals' too, and an icon goes to one ability only.

use super::*;

const PATHS: &[&str] = &[
    "panorama/images/spellicons/pudge_meat_hook_png.vtex_c",
    "panorama/images/spellicons/pudge/arcana/pudge_meat_hook_arcana_png.vtex_c",
    "panorama/images/spellicons/pudge/immortal_gold/pudge_meat_hook_png.vtex_c",
    "panorama/images/spellicons/pudge_rot_png.vtex_c",
    "panorama/images/spellicons/pudge/arcana/pudge_rot_arcana_png.vtex_c",
    "panorama/images/spellicons/marci_unleash_png.vtex_c",
    "panorama/images/spellicons/marci_unleash_flurry_png.vtex_c",
    "panorama/images/spellicons/marci_grapple_png.vtex_c",
    "panorama/images/spellicons/marci/boltheart_brawler/marci_boltheart_grapple_png.vtex_c",
    "panorama/images/spellicons/juggernaut_blade_fury_arcana_png.vtex_c",
    "panorama/images/spellicons/juggernaut_blade_fury_png.vtex_c",
];

fn icons(hero: &str, abilities: &[&str]) -> Vec<(String, Vec<String>)> {
    let abilities: Vec<String> = abilities.iter().map(|a| a.to_string()).collect();
    hero_layers(PATHS, hero, &abilities, &[], None)
        .into_iter()
        .filter(|l| l.kind == "abilityIcon")
        .map(|l| (l.name.unwrap(), l.files.iter().map(|f| f[27..].to_string()).collect()))
        .collect()
}

#[test]
fn the_icon_layer_paints_the_arcanas_and_the_immortals_icons_too() {
    let got = icons("pudge", &["pudge_meat_hook", "pudge_rot"]);
    assert_eq!(got[0].0, "pudge_meat_hook");
    assert_eq!(
        got[0].1,
        [
            "pudge_meat_hook_png.vtex_c",
            "pudge/arcana/pudge_meat_hook_arcana_png.vtex_c",
            "pudge/immortal_gold/pudge_meat_hook_png.vtex_c"
        ]
    );
    assert_eq!(got[1].1, ["pudge_rot_png.vtex_c", "pudge/arcana/pudge_rot_arcana_png.vtex_c"]);
    let jugg = icons("juggernaut", &["juggernaut_blade_fury"]);
    assert_eq!(jugg[0].1, ["juggernaut_blade_fury_png.vtex_c", "juggernaut_blade_fury_arcana_png.vtex_c"]);
}

#[test]
fn an_icon_goes_to_the_ability_it_is_named_for_and_to_no_other() {
    let got = icons("marci", &["marci_unleash", "marci_unleash_flurry", "marci_grapple"]);
    let of = |a: &str| got.iter().find(|(n, _)| n == a).unwrap().1.clone();
    assert_eq!(of("marci_unleash"), ["marci_unleash_png.vtex_c"]);
    assert_eq!(of("marci_unleash_flurry"), ["marci_unleash_flurry_png.vtex_c"]);
    // a set's own name for the ability, under the hero's folder
    assert_eq!(
        of("marci_grapple"),
        ["marci_grapple_png.vtex_c", "marci/boltheart_brawler/marci_boltheart_grapple_png.vtex_c"]
    );
}

/// What the real game gives: MM_PAK01_LIST is `mm-cli vpk-entries` of pak01.
#[test]
#[ignore]
fn icons_on_the_real_game() {
    let list: Vec<(String, u64)> =
        serde_json::from_slice(&std::fs::read(std::env::var("MM_PAK01_LIST").unwrap()).unwrap()).unwrap();
    let paths: Vec<&str> = list.iter().map(|(p, _)| p.as_str()).collect();
    for (hero, abilities) in [
        ("pudge", vec!["pudge_meat_hook", "pudge_rot", "pudge_flesh_heap", "pudge_dismember"]),
        (
            "juggernaut",
            vec!["juggernaut_blade_fury", "juggernaut_healing_ward", "juggernaut_blade_dance", "juggernaut_omni_slash"],
        ),
        ("antimage", vec!["antimage_mana_break", "antimage_blink", "antimage_counterspell", "antimage_mana_void"]),
    ] {
        let abilities: Vec<String> = abilities.into_iter().map(String::from).collect();
        for l in hero_layers(&paths, hero, &abilities, &[], None).into_iter().filter(|l| l.kind == "abilityIcon") {
            println!("{}: {:?}", l.name.unwrap(), l.files.iter().map(|f| &f[27..]).collect::<Vec<_>>());
        }
    }
}
