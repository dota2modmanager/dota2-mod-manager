//! A HUD carried to the patched game: the game's new style with the mod's rules, the layouts and
//! scripts left to the game.

use super::*;

const GAME_NEW: &str =
    "/* hud */\n@define bar: 10px;\n.Top { width: 100px; }\n.Mini { height: 2px; }\n.New { color: red; }\n";
const MOD: &str = "@define bar: 10px;\n.Top { width: 140px; background-image: url(\"s2r://panorama/images/x.png\"); }\n.Mini { height: 2px; }\n.Own { opacity: 0.5; }\n";

#[test]
fn the_mods_rules_go_into_the_new_style_and_the_rest_is_the_games() {
    let out = merge_css(GAME_NEW, MOD, None);
    assert!(out.contains(".Top { width: 140px;"), "the mod's edit wins: {out}");
    assert!(out.contains(".New { color: red; }"), "what only the new game has stays: {out}");
    assert!(out.contains(".Own { opacity: 0.5; }"), "what only the mod has is added: {out}");
    assert_eq!(out.matches(".Mini").count(), 1, "a rule both write alike is there once");
    assert!(out.find(".New").unwrap() < out.find(".Own").unwrap(), "the mod's own rules come after");
}

#[test]
fn with_the_old_style_known_only_the_mods_own_edits_carry_over() {
    // the patch moved .Mini; the mod still has the old value, which it never edited
    let base = "@define bar: 10px;\n.Top { width: 100px; }\n.Mini { height: 1px; }\n";
    let new_game = "@define bar: 10px;\n.Top { width: 100px; }\n.Mini { height: 2px; }\n";
    let mods = "@define bar: 10px;\n.Top { width: 140px; }\n.Mini { height: 1px; }\n";
    let out = merge_css(new_game, mods, Some(base));
    assert!(out.contains(".Mini { height: 2px; }"), "the patch's change stays: {out}");
    assert!(out.contains(".Top { width: 140px; }"), "the mod's edit carries: {out}");
}

#[test]
fn a_selector_met_twice_pairs_with_its_own_count() {
    let game = ".A { x: 1; }\n.A { y: 1; }\n";
    let mods = ".A { x: 1; }\n.A { y: 2; }\n";
    let out = merge_css(game, mods, None);
    assert_eq!(out, ".A { x: 1; }\n.A { y: 2; }\n");
}

#[test]
fn layouts_and_scripts_the_patch_changed_go_to_the_game() {
    let e = |p: &str| crate::vpk::entry_at(p, std::sync::Arc::from(&b"x"[..]));
    let entries = vec![
        e("panorama/layout/hud/hud_reborn.vxml_c"),
        e("panorama/scripts/hud/hud.vjs_c"),
        e("panorama/images/hud/bar_png.vtex_c"),
        e("panorama/layout/hud/untouched.vxml_c"),
    ];
    let changed = vec![
        "panorama/layout/hud/hud_reborn.vxml_c".to_string(),
        "panorama/scripts/hud/hud.vjs_c".to_string(),
        "panorama/images/hud/bar_png.vtex_c".to_string(),
    ];
    let (kept, done) = repatch_entries(entries, &changed, &|_| None);
    let kept: Vec<String> = kept.iter().map(|e| e.path()).collect();
    assert_eq!(kept, ["panorama/images/hud/bar_png.vtex_c", "panorama/layout/hud/untouched.vxml_c"]);
    assert_eq!(done.dropped, ["panorama/layout/hud/hud_reborn.vxml_c", "panorama/scripts/hud/hud.vjs_c"]);
}

#[test]
fn a_style_that_cannot_be_read_leaves_the_games() {
    let entries = vec![crate::vpk::entry_at("panorama/styles/hud/hud_reborn.vcss_c", std::sync::Arc::from(&b"x"[..]))];
    let changed = vec!["panorama/styles/hud/hud_reborn.vcss_c".to_string()];
    let (kept, done) = repatch_entries(entries, &changed, &|_| Some(b"not a resource".to_vec()));
    assert!(kept.is_empty());
    assert_eq!(done.dropped, ["panorama/styles/hud/hud_reborn.vcss_c"]);
}

/// D2MM_PAK01: the game's pak01_dir.vpk. The game's own HUD style merged with itself is itself,
/// statement for statement, and its file is written back readable.
#[test]
#[ignore]
fn the_games_hud_style_merges_into_itself() {
    let pak = crate::vpk_shared::shared_index(std::path::Path::new(&std::env::var("D2MM_PAK01").unwrap())).unwrap();
    let path = "panorama/styles/hud/hud_reborn.vcss_c";
    let file = pak.read(path).unwrap().unwrap();
    let (_, css) = read_style(&file).unwrap();
    let merged = merge_css(&css, &css, None);
    assert_eq!(statements(&merged), statements(&css));
    let edited = css.replacen('}', "}\n.D2mmProbe { width: 1px; }", 1);
    let out = write_style(&file, &merge_css(&css, &edited, None), &|_| None, &|_| None).unwrap();
    let (_, back) = read_style(&out).unwrap();
    assert!(back.contains(".D2mmProbe { width: 1px; }"));
    println!("{} statements", statements(&css).len());
}
