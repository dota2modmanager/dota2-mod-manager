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

#[test]
fn a_cosmetics_icon_goes_to_the_ability_it_ends_with() {
    let paths = [
        "panorama/images/spellicons/phoenix/phoenix_ti10_immortal_ability_icon/phoenix_ti10_immortal_fire_spirit_png.vtex_c",
        "panorama/images/spellicons/templar_assassin/ta_2022_immortal_ability_icon/ta_2022_immortal_trap_gold_png.vtex_c",
        "panorama/images/spellicons/templar_assassin/ta_2022_immortal_ability_icon/ta_2022_immortal_crimson_self_trap_png.vtex_c",
        "panorama/images/spellicons/sand_king/king_of_egypt/king_of_egypt_burrowstrike_png.vtex_c",
        "panorama/images/spellicons/lion/dungeon_poacher/dungeon_poacher_hex_png.vtex_c",
        "panorama/images/spellicons/tidehunter/arcana_style1/tidehunter_arcana_gush_style1_png.vtex_c",
    ];
    let of = |hero: &str, abilities: &[&str]| -> Vec<(String, String)> {
        let abilities: Vec<String> = abilities.iter().map(|a| a.to_string()).collect();
        ability_icon_files(&paths, hero, &abilities)
            .into_iter()
            .map(|(a, p)| (a, p[p.rfind('/').unwrap() + 1..].to_string()))
            .collect()
    };
    assert_eq!(
        of("phoenix", &["phoenix_fire_spirits", "phoenix_launch_fire_spirit"]),
        [("phoenix_fire_spirits".to_string(), "phoenix_ti10_immortal_fire_spirit_png.vtex_c".to_string())]
    );
    let ta = of(
        "templar_assassin",
        &["templar_assassin_trap", "templar_assassin_self_trap", "templar_assassin_trap_teleport"],
    );
    assert!(ta.contains(&("templar_assassin_trap".into(), "ta_2022_immortal_trap_gold_png.vtex_c".into())), "{ta:?}");
    assert!(
        ta.contains(&("templar_assassin_self_trap".into(), "ta_2022_immortal_crimson_self_trap_png.vtex_c".into())),
        "{ta:?}"
    );
    assert_eq!(of("sand_king", &["sandking_burrowstrike"]).len(), 1);
    assert_eq!(of("lion", &["lion_voodoo", "lion_impale"])[0].0, "lion_voodoo");
    assert_eq!(of("tidehunter", &["tidehunter_gush"]).len(), 1);
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

/// Every hero's icons no ability takes, on the real game: MM_PAK01_LIST as above, MM_HERO_SCRIPTS
/// a folder of scripts/npc/heroes/*.txt out of pak01.
#[test]
#[ignore]
fn icons_no_ability_takes_on_the_real_game() {
    let list: Vec<(String, u64)> =
        serde_json::from_slice(&std::fs::read(std::env::var("MM_PAK01_LIST").unwrap()).unwrap()).unwrap();
    let paths: Vec<&str> = list.iter().map(|(p, _)| p.as_str()).collect();
    let dir = std::path::PathBuf::from(std::env::var("MM_HERO_SCRIPTS").unwrap());
    let mut missed = 0;
    for e in std::fs::read_dir(dir).unwrap() {
        let file = e.unwrap().path();
        let hero = file.file_stem().unwrap().to_str().unwrap().trim_start_matches("npc_dota_hero_").to_string();
        let abilities = hero_abilities(&std::fs::read_to_string(&file).unwrap());
        let pairs = ability_icon_files(&paths, &hero, &abilities);
        if std::env::var("MM_SHOW_TAKEN").is_ok() {
            for (a, p) in &pairs {
                let name = &p[p.rfind('/').unwrap() + 1..];
                if !name.replace('_', "").contains(&a[a.find('_').unwrap() + 1..].replace('_', "")) {
                    println!("  {a} <- {}", &p[27..]);
                }
            }
        }
        let taken: Vec<String> = pairs.into_iter().map(|(_, p)| p).collect();
        let own = format!("panorama/images/spellicons/{hero}/");
        for p in paths.iter().filter(|p| p.starts_with(&own) && p.ends_with("_png.vtex_c")) {
            if !taken.iter().any(|t| t == p) {
                missed += 1;
                println!("{hero}: {}", &p[27..]);
            }
        }
    }
    println!("{missed} icons no ability takes");
}
