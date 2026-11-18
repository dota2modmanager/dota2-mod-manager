//! The search-path patch against a real directory: a throwaway game tree, patched, signed and
//! reverted, with and without a signature list (Valve's Linux build ships none). These carry
//! over what test/patcher-tree.test.ts and test/patcher.test.ts held the TypeScript to.

use std::fs;
use std::path::{Path, PathBuf};

use super::{apply, paths, revert, state, FOLDER};
use crate::kv::{latin1, to_latin1};
use crate::patcher_gameinfo::MARKER;
use crate::patcher_signatures::{file_hashes, signature_line};

const GAMEINFO: &str = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_AudioLanguage\tdota_*LANGUAGE*\n\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore\n\t\t\tMod\t\t\t\t\tdota\n\t\t\tWrite\t\t\t\tdota\n\t\t}\n\t}\n}\n";

const BRANCH: &str = "\"GameInfo\"\r\n{\r\n\tgame \t\t\"Dota 2\"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t}\r\n}\r\n";

struct Tree {
    root: PathBuf,
    game: PathBuf,
    backups: PathBuf,
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A game tree in a fresh temporary folder; `list` gives it a dota.signatures.
fn tree(name: &str, list: Option<&str>) -> Tree {
    let root = std::env::temp_dir().join(format!("mm-patcher-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let game = root.join("game");
    fs::create_dir_all(game.join("dota")).unwrap();
    fs::write(game.join("dota").join("gameinfo.gi"), GAMEINFO).unwrap();
    fs::write(game.join("dota").join("gameinfo_branchspecific.gi"), to_latin1(BRANCH)).unwrap();
    if let Some(text) = list {
        let sig = paths(&game).signatures;
        fs::create_dir_all(sig.parent().unwrap()).unwrap();
        fs::write(&sig, to_latin1(text)).unwrap();
    }
    Tree { backups: root.join("backups"), root, game }
}

fn read(p: &Path) -> String {
    latin1(&fs::read(p).unwrap())
}

/// A list for one build of the game: Valve's entry for the branch file, two DLLs and a DIGEST,
/// each seeded with the build's letter.
fn list_for(build: char, branch: &[u8]) -> String {
    let h = file_hashes(branch);
    let rep = |n: usize| build.to_string().repeat(n);
    format!(
        "...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:{};CRC:{}\r\n...\\client.dll~SHA1:{};CRC:{}\r\n...\\dota2.exe~SHA1:{};CRC:{}\r\nDIGEST:{}\r\n",
        h.sha1, h.crc, rep(40), rep(8), rep(40), rep(8), rep(64)
    )
}

fn exe_hash(text: &str) -> Option<String> {
    let at = text.find("dota2.exe~SHA1:")? + "dota2.exe~SHA1:".len();
    Some(text[at..at + 40].to_string())
}

#[test]
fn a_signature_line_is_the_path_sha1_and_little_endian_crc_the_game_expects() {
    // "123456789" is the standard check input: its CRC-32 is 0xCBF43926, which the list stores
    // low byte first. The expectation comes from outside this code, so a CRC written the wrong
    // way round (a list the client rejects) cannot pass by agreeing with itself.
    assert_eq!(
        signature_line(b"123456789"),
        r"...\..\..\dota\gameinfo_branchspecific.gi~SHA1:F7C3BC1D808E04732ADF679965CCC34CA7AE3441;CRC:2639F4CB"
    );
}

#[test]
fn an_install_with_no_signature_list_is_still_patched_and_says_it_cannot_be_signed() {
    let t = tree("nolist", None);
    let st = apply(&t.game, FOLDER, &t.backups).unwrap();
    let branch = read(&paths(&t.game).branch);
    assert!(branch.contains(MARKER) && branch.contains(FOLDER), "the branch file carries the patch");
    assert!(st.patched);
    assert!(!st.signable && !st.signed, "nothing to sign into, which is not an unsigned patch");
    assert!(t.game.join(FOLDER).is_dir(), "the folder the patch registers exists");
    assert!(!paths(&t.game).signatures.exists(), "and no list was invented for it");
}

#[test]
fn an_install_with_a_list_gets_the_patch_signed_into_it() {
    let t = tree("signed", Some(&list_for('A', BRANCH.as_bytes())));
    let st = apply(&t.game, FOLDER, &t.backups).unwrap();
    let line = signature_line(&fs::read(paths(&t.game).branch).unwrap());
    assert!(read(&paths(&t.game).signatures).contains(&line));
    assert!(st.patched && st.signed && st.signable);
}

#[test]
fn reverting_puts_both_files_back_exactly_as_they_were() {
    for list in [None, Some(list_for('A', BRANCH.as_bytes()))] {
        let t = tree(if list.is_some() { "revert-list" } else { "revert-nolist" }, list.as_deref());
        apply(&t.game, FOLDER, &t.backups).unwrap();
        let st = revert(&t.game, Some(FOLDER), &t.backups).unwrap();
        assert_eq!(read(&paths(&t.game).branch), BRANCH);
        if let Some(l) = &list {
            assert_eq!(read(&paths(&t.game).signatures), *l);
        }
        assert!(!st.patched);
        assert!(!t.game.join(FOLDER).exists(), "the empty folder went with the patch");
    }
}

#[test]
fn applying_three_times_does_not_stack_the_patch_or_pile_up_our_line() {
    let t = tree("twice", Some(&list_for('A', BRANCH.as_bytes())));
    apply(&t.game, FOLDER, &t.backups).unwrap();
    let once = read(&paths(&t.game).branch);
    for _ in 0..2 {
        apply(&t.game, FOLDER, &t.backups).unwrap();
    }
    assert_eq!(read(&paths(&t.game).branch), once, "patching again changed nothing");
    // twice by design: the folder goes on a Game line and on a Mod line, each with the marker
    assert_eq!(once.matches(MARKER).count(), 2);
    let sig = read(&paths(&t.game).signatures);
    assert_eq!(sig.matches("gameinfo_branchspecific").count(), 2, "Valve's entry and ours, no more");
    assert_eq!(exe_hash(&sig).as_deref(), Some("A".repeat(40).as_str()), "Valve's own lines are untouched");
}

#[test]
fn the_patch_is_signed_into_the_list_the_installed_build_shipped_not_an_older_one() {
    // 2026-09-11: the list was rebuilt from a July copy, the client compared its DLLs with an
    // old build's hashes and refused matchmaking.
    let t = tree("stale", Some(&list_for('A', BRANCH.as_bytes())));
    apply(&t.game, FOLDER, &t.backups).unwrap();
    let sig = paths(&t.game).signatures;
    // Dota updates to build B while our line is still in the file
    let patched = fs::read(paths(&t.game).branch).unwrap();
    let b = format!("{}\r\n{}\r\n", list_for('B', BRANCH.as_bytes()).trim_end(), signature_line(&patched));
    fs::write(&sig, to_latin1(&b)).unwrap();

    apply(&t.game, FOLDER, &t.backups).unwrap();
    let after = read(&sig);
    assert_eq!(
        exe_hash(&after).as_deref(),
        Some("B".repeat(40).as_str()),
        "the list belongs to the build installed now"
    );
    assert_eq!(after.matches("gameinfo_branchspecific").count(), 2, "Valve's entry and ours, once");
}

#[test]
fn a_backup_from_an_older_build_is_replaced_or_reverting_would_put_the_old_build_back() {
    let h = file_hashes(BRANCH.as_bytes());
    let listed = format!(
        "...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:{};CRC:{}\r\nDIGEST:{}\r\n",
        h.sha1,
        h.crc,
        "C".repeat(40)
    );
    let t = tree("old-backup", Some(&listed));
    apply(&t.game, FOLDER, &t.backups).unwrap();
    // the copy taken before an update: the same file with a line Valve has since changed
    fs::write(t.backups.join("gameinfo_branchspecific.gi.orig"), to_latin1(&BRANCH.replace("570", "569"))).unwrap();

    apply(&t.game, FOLDER, &t.backups).unwrap();
    assert!(read(&paths(&t.game).branch).contains("570"), "the patch was rebuilt on the build installed now");
    revert(&t.game, Some(FOLDER), &t.backups).unwrap();
    assert_eq!(read(&paths(&t.game).branch), BRANCH);
    assert!(state(&t.game, Some(FOLDER)).unwrap().vanilla_ok);
}

#[test]
fn a_tree_with_no_gameinfo_is_refused() {
    let t = tree("missing", None);
    fs::remove_file(paths(&t.game).gameinfo).unwrap();
    assert!(apply(&t.game, FOLDER, &t.backups).is_err());
}
