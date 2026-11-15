//! Whether Steam's file check took a font or cursor back, against a throwaway game tree. On
//! 2026-09-17 a font that ships some of Valve's own files unchanged read as "put back" on every
//! start: what the app wrote itself has to count as the app's file.

use std::fs;
use std::path::PathBuf;

use serde_json::json;

use super::{LibFile, WRITTEN};
use crate::installer::Installer;
use crate::installer_folder::FONTS_SUBDIR;
use crate::safe_zip::sha1_hex;

struct Tree {
    root: PathBuf,
    inst: Installer,
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A game whose fonts folder holds `live`, and a backup of Valve's file holding `orig`.
fn tree(name: &str, live: &[u8], orig: &[u8]) -> Tree {
    let root = std::env::temp_dir().join(format!("mm-overlays-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let game = root.join("game");
    let fonts = FONTS_SUBDIR.iter().fold(game.clone(), |p, s| p.join(s));
    fs::create_dir_all(&fonts).unwrap();
    fs::write(fonts.join("a.ttf"), live).unwrap();
    let ud = root.join("ud");
    fs::create_dir_all(ud.join("backups").join("fonts")).unwrap();
    fs::write(ud.join("backups").join("fonts").join("a.ttf"), orig).unwrap();
    let mut inst = Installer::new(Some(game), "russian");
    inst.user_data = ud;
    Tree { root, inst }
}

fn font() -> LibFile {
    LibFile::new("fonts", "a.ttf")
}

#[test]
fn a_file_holding_valves_bytes_again_is_taken_back_by_a_verify() {
    let t = tree("verify", b"valve", b"valve");
    assert!(t.inst.vanilla_is_back(&font(), &t.inst.written()));
}

#[test]
fn a_file_the_app_wrote_itself_is_not_taken_for_one_a_verify_put_back() {
    // the mod ships Valve's bytes for this file unchanged: live and backup match, yet the app
    // wrote it, so nothing was taken back
    let t = tree("ours", b"valve", b"valve");
    t.inst.note_written("fonts", &[("a.ttf".into(), Some(sha1_hex(b"valve")))]);
    assert!(!t.inst.vanilla_is_back(&font(), &t.inst.written()));
    assert!(t.inst.backups_dir().join(WRITTEN).exists(), "the record is kept on disk");
}

#[test]
fn a_mod_file_still_in_place_is_not_taken_back() {
    let t = tree("modded", b"modded", b"valve");
    assert!(!t.inst.vanilla_is_back(&font(), &t.inst.written()));
}

#[test]
fn only_enabled_records_whose_files_went_back_are_reported() {
    let t = tree("records", b"valve", b"valve");
    let files = json!([{ "root": "fonts", "relPath": "a.ttf" }]);
    let records = [json!({ "enabled": true, "files": files }), json!({ "enabled": false, "files": files })];
    assert_eq!(t.inst.lost_to_verify(&records), vec![0]);
}
