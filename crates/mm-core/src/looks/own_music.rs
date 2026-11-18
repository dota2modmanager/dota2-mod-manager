//! Songs of the user's own as the game's background music (own_music_service.rs builds the pak).
//!
//! Every music pack has its events in soundevents/music/<pack>/soundevents_music.vsndevts_c, the
//! same set in each: the menu's (types dota_update_ui_startup and dota_update_ui_main, a list of
//! files the game picks one from) and the calm music of a match, three tracks of three layers each
//! (type dota_update_music_3layer; "track" explore1 is the layer always heard, explore2 and 3 come
//! in as the fight draws near). The songs go in as the menu's list and as the first layer of every
//! calm track, the other two layers play the game's silence, so a song is never mixed with another.
//! The game tells a fight itself: when heroes clash near the player it plays an event of type
//! dota_update_battle_music, and dota_update_battle_end when the fight is over. Songs the user
//! marked for fights go there (from their start: the game's loop points are cut for its own track)
//! and the closing stinger is silent. Roshan's fight is told apart the same way
//! (dota_update_roshan, then dota_update_roshan_end), and songs marked for him go there. The rest
//! are the menu's and the calm music's. Smoke, ganks and the win and loss stingers stay the game's. Every pack is rewritten, so the songs
//! play whichever music pack the player has on.

use indexmap::IndexMap;
use regex::Regex;

use crate::ability_sounds::{text, HEADER, T};
use crate::kv3::{Block, Value};

/// The game's silent sound, what the layers a song does not use play.
pub const SILENCE: &str = "sounds/music/null.vsnd";

/// Where the user's music goes: the calm songs and the fights' (compiled sound paths, .vsnd).
#[derive(Debug, Clone, PartialEq)]
pub struct Plan<'a> {
    pub calm: &'a [String],
    pub fights: &'a [String],
    pub roshan: &'a [String],
    pub menu: bool,
    pub game: bool,
}

/// The events file of every music pack in `paths` (pak01's), by pack name.
pub fn pack_events<'a>(paths: impl Iterator<Item = &'a str>) -> Vec<String> {
    let re = Regex::new(r"^soundevents/music/[a-z0-9_]+/soundevents_music\.vsndevts_c$").expect("a fixed pattern");
    let mut out: Vec<String> = paths.filter(|p| re.is_match(p)).map(str::to_string).collect();
    out.sort();
    out
}

/// The path a song is compiled to, by the id it is kept under.
pub fn song_path(id: &str) -> String {
    format!("sounds/d2mm/music/{id}.vsnd")
}

fn files(list: &[String]) -> T {
    T::Arr(list.iter().map(|s| T::Str(s.clone())).collect())
}

/// One event with the user's files in place of its own; what the compiler fills (the duration),
/// what picks among the game's files (weights) and the loop points cut for the game's track go.
fn with_files(members: &IndexMap<String, T>, f: T) -> T {
    let mut m = members.clone();
    m.insert("vsnd_files".into(), f);
    m.retain(|k, _| {
        !matches!(k.as_str(), "vsnd_duration" | "weights" | "restart_time" | "start_point" | "end_point" | "syncpoints")
    });
    T::Obj(m)
}

/// A pack's events with the user's songs where `plan` puts them, as the KV3 text the compiler
/// reads, and how many events changed.
pub fn music_events(kv: &Block, plan: &Plan) -> Result<(String, usize), String> {
    let Value::Object(root) = &kv.root.value else { return Err("the music events file has no events".into()) };
    let mut changed = 0;
    let mut events: IndexMap<String, T> = IndexMap::new();
    for (name, node) in root {
        let ev = T::Node(node.clone());
        let field = |k: &str| ev.get(k).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
        let made = match (field("type").as_str(), ev.members()) {
            ("dota_update_ui_main" | "dota_update_ui_startup", Some(m)) if plan.menu && !plan.calm.is_empty() => {
                Some(with_files(&m, files(plan.calm)))
            }
            ("dota_update_music_3layer", Some(m)) if plan.game && !plan.calm.is_empty() => {
                Some(if field("track") == "explore1" {
                    with_files(&m, files(plan.calm))
                } else {
                    with_files(&m, T::Str(SILENCE.into()))
                })
            }
            ("dota_update_battle_music", Some(m)) if !plan.fights.is_empty() => {
                Some(with_files(&m, files(plan.fights)))
            }
            ("dota_update_battle_end", Some(m)) if !plan.fights.is_empty() => {
                Some(with_files(&m, T::Str(SILENCE.into())))
            }
            ("dota_update_roshan", Some(m)) if !plan.roshan.is_empty() => Some(with_files(&m, files(plan.roshan))),
            ("dota_update_roshan_end", Some(m)) if !plan.roshan.is_empty() => {
                Some(with_files(&m, T::Str(SILENCE.into())))
            }
            _ => None,
        };
        if made.is_some() {
            changed += 1;
        }
        events.insert(name.clone(), made.unwrap_or(ev));
    }
    Ok((format!("{HEADER}\n{}\n", text(kv, &T::Obj(events), 0)?), changed))
}

/// What a song file is, by its first bytes: "mp3", "wav" (16-bit PCM the compiler takes), or None.
pub fn song_kind(b: &[u8]) -> Option<&'static str> {
    if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WAVE" {
        return crate::ability_sounds::wav_problem(b).is_none().then_some("wav");
    }
    // an ID3 tag, or an MPEG audio frame sync
    let mp3 = b.len() > 4 && (&b[0..3] == b"ID3" || (b[0] == 0xff && b[1] & 0xe0 == 0xe0));
    mp3.then_some("mp3")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_song_file_is_known_by_its_bytes() {
        assert_eq!(song_kind(b"ID3\x04\x00\x00\x00\x00\x00\x00"), Some("mp3"));
        assert_eq!(song_kind(&[0xff, 0xfb, 0x90, 0x64, 0]), Some("mp3"));
        assert_eq!(song_kind(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00"), None);
        assert_eq!(song_path("ab12"), "sounds/d2mm/music/ab12.vsnd");
        let paths = [
            "soundevents/music/valve_dota_001/soundevents_music.vsndevts_c",
            "soundevents/music/valve_dota_001/soundevents_stingers.vsndevts_c",
            "soundevents/music/game_sounds_music_test.vsndevts_c",
        ];
        assert_eq!(pack_events(paths.into_iter()), vec![paths[0].to_string()]);
    }

    #[test]
    fn the_songs_go_on_the_menu_and_the_calm_layer_of_every_pack_and_nothing_else() {
        let Ok(p) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&p)).unwrap();
        let packs = pack_events(ix.paths());
        assert!(packs.len() > 10 && packs.iter().any(|p| p.contains("valve_dota_001")));
        let songs = vec![song_path("a"), song_path("b")];
        let fights = vec![song_path("f")];
        let boss = vec![song_path("r")];
        let none_: Vec<String> = vec![];
        for f in &packs {
            let raw = ix.read(f).unwrap().unwrap();
            let kv = crate::kv3::read(crate::resource::data_block(&raw).unwrap()).unwrap();
            // a pack of an item (an arcana's) has no menu or calm music of its own
            let (_, calm) =
                music_events(&kv, &Plan { calm: &songs, fights: &none_, roshan: &none_, menu: false, game: true })
                    .unwrap();
            if f.contains("terrorblade_arcana") {
                continue;
            }
            let (all, n) =
                music_events(&kv, &Plan { calm: &songs, fights: &fights, roshan: &boss, menu: true, game: true })
                    .unwrap();
            assert!(n >= 15 && calm == 9, "{f}: {n} {calm}");
            assert!(
                all.contains("sounds/d2mm/music/a.vsnd")
                    && all.contains("sounds/d2mm/music/f.vsnd")
                    && all.contains(SILENCE),
                "{f}"
            );
            let (menu, m) =
                music_events(&kv, &Plan { calm: &songs, fights: &none_, roshan: &none_, menu: true, game: false })
                    .unwrap();
            assert!(m >= 1 && m < n && !menu.contains(SILENCE), "{f}");
            let (none, z) =
                music_events(&kv, &Plan { calm: &songs, fights: &none_, roshan: &none_, menu: false, game: false })
                    .unwrap();
            assert_eq!(z, 0);
            assert!(!none.contains("d2mm"));
            // the fights lose the loop points cut for the game's tracks
            assert!(all.matches("syncpoints").count() < none.matches("syncpoints").count(), "{f}");
        }
    }
}
