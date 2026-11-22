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

fn edit(event: &str, mode: &str, volume: f64, sound: &str) -> SoundEdit {
    SoundEdit { event: event.into(), mode: mode.into(), volume, sound: sound.into(), name: String::new() }
}

fn events(list: &[(&str, &[&str])]) -> IndexMap<String, Vec<String>> {
    list.iter().map(|(k, f)| (k.to_string(), f.iter().map(|s| s.to_string()).collect())).collect()
}

/// A sound in place of the game's goes in at the game's own files, every one of the event's, and
/// leaves the events file alone: a pak that carried it would crash the game once Valve changed it.
#[test]
fn a_replaced_sound_takes_the_games_files_and_writes_no_events_file() {
    let ev = events(&[(
        "Hero_Pudge.AttackHookExtend",
        &["sounds/weapons/hero/pudge/hook_throw.vsnd", "sounds/weapons/hero/pudge/Hook_Throw_02.vsnd"],
    )]);
    let plan = sound_plan(&ev, &[edit("Hero_Pudge.AttackHookExtend", "replace", 0.5, "aa")]);
    assert_eq!(
        plan.files,
        vec![
            ("sounds/weapons/hero/pudge/hook_throw".to_string(), "aa".to_string(), 0.5),
            ("sounds/weapons/hero/pudge/hook_throw_02".to_string(), "aa".to_string(), 0.5),
        ]
    );
    assert!(plan.events.is_empty(), "no events file for a replaced sound");
    assert!(plan.gone.is_empty() && plan.shared.is_empty());
}

/// Only what has nothing of the game's to take needs the events file: a sound on top of the
/// game's, and an event whose files are not plain paths. A gone event is told, not written.
#[test]
fn only_a_layered_sound_or_an_odd_path_needs_the_events_file() {
    let ev = events(&[("A", &["sounds/a.vsnd"]), ("B", &["sounds/b.vsnd"]), ("C", &["../escape.vsnd"])]);
    let plan = sound_plan(
        &ev,
        &[
            edit("A", "replace", 1.0, "s1"),
            edit("B", "layer", 1.0, "s2"),
            edit("C", "replace", 1.0, "s3"),
            edit("Gone", "replace", 1.0, "s4"),
        ],
    );
    assert_eq!(plan.files, vec![("sounds/a".to_string(), "s1".to_string(), 1.0)]);
    assert_eq!(plan.events.iter().map(|e| e.event.as_str()).collect::<Vec<_>>(), ["B", "C"]);
    assert_eq!(plan.gone, ["Gone"]);
}

/// Two events on one file of the game's: the file can hold one sound, the later edit's.
#[test]
fn a_game_file_two_sounds_want_keeps_the_later_one() {
    let ev = events(&[("A", &["sounds/shared.vsnd"]), ("B", &["sounds/shared.vsnd"])]);
    let plan = sound_plan(&ev, &[edit("A", "replace", 1.0, "first"), edit("B", "replace", 1.0, "second")]);
    assert_eq!(plan.files, vec![("sounds/shared".to_string(), "second".to_string(), 1.0)]);
    assert_eq!(plan.shared, ["sounds/shared"]);
}

#[test]
fn a_game_file_is_named_without_its_extension_and_only_under_sounds() {
    assert_eq!(game_sound_stem("sounds/vo/pudge/pud_attack_01.vsnd").as_deref(), Some("sounds/vo/pudge/pud_attack_01"));
    assert_eq!(game_sound_stem(r"sounds\UI\Ping.wav").as_deref(), Some("sounds/ui/ping"));
    for bad in ["models/x.vsnd", "sounds/../cfg/autoexec", "sounds/", "sounds/a b.vsnd", "/sounds/x.vsnd"] {
        assert_eq!(game_sound_stem(bad), None, "{bad}");
    }
}

/// The volume an event of ours used to carry goes into the samples; at full volume the file is as given.
#[test]
fn the_volume_goes_into_the_samples() {
    let mut wav =
        b"RIFF\0\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x44\xac\0\0\x88\x58\x01\0\x02\0\x10\0data\x06\0\0\0".to_vec();
    for s in [1000i16, -2000, 32767] {
        wav.extend(s.to_le_bytes());
    }
    assert_eq!(wav_problem(&wav), None);
    let half = wav_at_volume(&wav, 0.5);
    let samples: Vec<i16> = half[44..].as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect();
    assert_eq!(samples, [500, -1000, 16384]);
    assert_eq!(half[..44], wav[..44], "the header is left as it is");
    assert_eq!(wav_at_volume(&wav, 1.0), wav);
}

/// MM_PAK01: the game's pak01_dir.vpk. Every hero's replaced sound has a plain file of the game's
/// to take, so no hero's pak needs an events file for one; and how many of the game's files more
/// than one event plays, the case where a replaced sound is heard on another event too.
#[test]
#[ignore]
fn every_hero_event_has_a_game_file_to_take() {
    let ix = crate::vpk::Index::open(std::path::Path::new(&std::env::var("MM_PAK01").unwrap())).unwrap();
    let (mut events_n, mut odd, mut shared_n) = (0, Vec::new(), 0);
    for hero in heroes_with_sounds(ix.paths()) {
        let raw = ix.read(&events_file(&hero)).unwrap().unwrap();
        let kv = crate::kv3::read(crate::resource::data_block(&raw).unwrap()).unwrap();
        let ev = event_files(&kv);
        let mut uses: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for (name, files) in &ev {
            events_n += 1;
            for f in files {
                match game_sound_stem(f) {
                    Some(s) => *uses.entry(s).or_default() += 1,
                    None => odd.push(format!("{hero}: {name}: {f}")),
                }
            }
        }
        shared_n += uses.values().filter(|n| **n > 1).count();
    }
    eprintln!("{events_n} events, {shared_n} files played by more than one event, odd: {odd:?}");
    assert!(events_n > 1000);
    assert!(odd.len() * 100 < events_n, "odd paths are rare: {odd:?}");
}
