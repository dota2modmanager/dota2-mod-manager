//! The game's own sounds (match found, pings, runes) go through the same window as a hero's.

use super::*;

#[test]
fn the_games_own_sounds_have_their_files_and_no_hero_takes_their_ids() {
    assert_eq!(events_file("ui"), "soundevents/game_sounds_ui_imported.vsndevts_c");
    assert_eq!(events_file("ui_menu"), "soundevents/soundevents_dota_ui.vsndevts_c");
    assert_eq!(events_file("game"), "soundevents/game_sounds.vsndevts_c");
    assert_eq!(events_file("antimage"), "soundevents/game_sounds_heroes/game_sounds_antimage.vsndevts_c");
    let paths = [
        "soundevents/game_sounds_heroes/game_sounds_antimage.vsndevts_c",
        "soundevents/game_sounds_ui_imported.vsndevts_c",
    ];
    let heroes = heroes_with_sounds(paths.into_iter());
    assert_eq!(heroes, ["antimage"], "a game file is not a hero");
    for (id, _, _) in GAME_SOUNDS {
        assert!(!heroes.contains(&id.to_string()));
        assert_eq!(sound_path(id, "0123456789abcdef0123"), format!("sounds/mods/d2mm/{id}/0123456789abcdef.vsnd"));
    }
    assert_eq!(sounds_label("ui"), crate::i18n::t("Матч, пинги и чат", &[]));
}

/// MM_PAK01: the game's pak01_dir.vpk. Match found plays the user's sound.
#[test]
#[ignore]
fn match_found_on_the_real_game() {
    let ix = crate::vpk::Index::open(std::path::Path::new(&std::env::var("MM_PAK01").unwrap())).unwrap();
    let raw = ix.read(&events_file("ui")).unwrap().unwrap();
    let kv = crate::kv3::read(crate::resource::data_block(&raw).unwrap()).unwrap();
    let events = hero_events(&kv);
    for name in ["FINDMATCH_FOUND", "General.Ping", "Chat.Wheel.Received"] {
        assert!(events.iter().any(|e| e.name == name), "{name}");
    }
    let edit = SoundEdit {
        event: "FINDMATCH_FOUND".into(),
        mode: "replace".into(),
        volume: 1.0,
        sound: "ab".repeat(20),
        name: "x".into(),
    };
    let (text, gone) = edited_events(&kv, "ui", &[edit]).unwrap();
    assert!(gone.is_empty());
    let at = text.find("FINDMATCH_FOUND").unwrap();
    assert!(text[at..at + 400].contains("sounds/mods/d2mm/ui/abababababababab.vsnd"), "{}", &text[at..at + 400]);
}
