//! The search-path patch: the code that edits files the game checks its own hashes against
//! (gameinfo_branchspecific.gi and dota.signatures). Two releases in a row shipped a matchmaking
//! break from here (v1.14.3, v1.15.0), both because writing the patch and taking it back off were
//! not exact inverses, so these tests pin it byte for byte. The first half drives the text
//! transforms (`patcher_gameinfo`, `patcher_signatures`), the second half `patcher::apply`,
//! `state` and `revert` against a throwaway game tree in the temp folder.
//!
//! Replaces test/patcher.test.ts and test/patcher-tree.test.ts.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use mm_core::patcher::{self, FOLDER};
use mm_core::patcher_gameinfo::{
    patch_is_current, patched_branch, restore_branch, search_paths_block, strip_patch, with_mod_folder, MARKER,
};
use mm_core::patcher_signatures::{
    file_hashes, has_signature_patch, matches_vanilla, signature_line, strip_signatures, vanilla_branch_hashes,
};

// ---------------------------------------------------------------------------------------------
// Fixtures for the text transforms
// ---------------------------------------------------------------------------------------------

/// Valve's real gameinfo_branchspecific.gi, byte for byte (615 bytes, CRLF). Note the lone tab
/// before the FileSystem closing brace: that tab is what the round trip kept losing.
const VANILLA_BRANCH: &str = "\"GameInfo\"\r\n{\r\n\t//\r\n\t// Branch-varying info, such as the game/title and app IDs, is in gameinfo_branchspecific.gi.\r\n\t// gameinfo.gi is the non-branch-varying content and can be integrated between branches.\r\n\t//\r\n\r\n\tgame \t\t\"Dota 2\"\r\n\ttitle \t\t\"Dota 2\"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t\tBreakpadAppId\t\t\t373300\t// Report crashes under beta DLC, not the S1 game.  Delete this when all clients are switched to S2\r\n\t\tBreakpadAppId_Tools\t\t375360  // Use a separate bucket of buckets for \"-tools\" crashes so that they don't get drowned out by game crashes. Falls back to BreakpadAppId/SteamAppId if missing\r\n\t}\r\n}\r\n";

/// Valve's SearchPaths block, trimmed to the lines the patcher reasons about.
const VANILLA_GAMEINFO: &str = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_AudioLanguage\tdota_*LANGUAGE*\n\t\t\tGame_LowViolence\tdota_lv\n\n\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore\n\n\t\t\tMod\t\t\t\t\tdota\n\n\t\t\tWrite\t\t\t\tdota\n\n\t\t\tAddonRoot\t\t\tdota_addons\n\t\t}\n\t}\n}\n";

fn patched_block() -> String {
    with_mod_folder(&search_paths_block(VANILLA_GAMEINFO).unwrap(), FOLDER).unwrap()
}

/// The same block as Valve shipped it up to build 6944, before the language key was renamed.
fn gameinfo_6944() -> String {
    VANILLA_GAMEINFO.replacen("Game_AudioLanguage\t", "Game_Language\t\t", 1)
}

/// The signature list Valve ships: one entry per checked file, closed by DIGEST. Their own entry
/// for gameinfo_branchspecific.gi is already in there, which is what made a pristine list look
/// patched in v1.14.3.
fn vanilla_signatures(text: &str) -> String {
    let h = file_hashes(text.as_bytes());
    [
        r"...\..\..\dota\gameinfo.gi~SHA1:1111111111111111111111111111111111111111;CRC:AAAAAAAA".to_string(),
        format!(r"...\..\..\dota\gameinfo_branchspecific.gi~SHA1:{};CRC:{}", h.sha1, h.crc),
        "DIGEST:2222222222222222222222222222222222222222".to_string(),
        String::new(),
    ]
    .join("\r\n")
}

// ---------------------------------------------------------------------------------------------
// The text transforms (test/patcher.test.ts)
// ---------------------------------------------------------------------------------------------

#[test]
fn patching_the_branch_file_then_stripping_it_returns_the_original_byte_for_byte() {
    let patched = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    assert!(patched.contains(MARKER), "the patch should be marked as ours");
    assert!(patched.contains(FOLDER), "our folder should be registered");
    assert_ne!(patched, VANILLA_BRANCH);
    assert_eq!(strip_patch(&patched), VANILLA_BRANCH);
}

#[test]
fn stripping_is_idempotent_and_survives_a_doubly_applied_patch() {
    let once = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    let twice = patched_branch(&once, &patched_block()).unwrap();
    assert_eq!(strip_patch(&twice), VANILLA_BRANCH);
    assert_eq!(strip_patch(&strip_patch(&once)), VANILLA_BRANCH);
}

#[test]
fn a_patch_built_from_the_gameinfo_on_disk_is_current() {
    let branch = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    assert!(patch_is_current(&branch, VANILLA_GAMEINFO, FOLDER).unwrap());
}

#[test]
fn a_patch_built_before_valve_renamed_the_language_key_is_not_current() {
    // Build 6946 renamed Game_Language to Game_AudioLanguage and left the branch file alone, so a
    // patch from the day before sat on disk naming a key the engine no longer reads.
    let old_info = gameinfo_6944();
    let old =
        patched_branch(VANILLA_BRANCH, &with_mod_folder(&search_paths_block(&old_info).unwrap(), FOLDER).unwrap())
            .unwrap();
    assert!(patch_is_current(&old, &old_info, FOLDER).unwrap(), "it was current against the file it came from");
    assert!(!patch_is_current(&old, VANILLA_GAMEINFO, FOLDER).unwrap());
}

#[test]
fn a_comment_valve_rewords_does_not_make_the_patch_outdated_but_a_moved_line_does() {
    let branch = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    let reworded =
        VANILLA_GAMEINFO.replacen("Game_LowViolence", "// low-violence paths, reworded\n\t\t\tGame_LowViolence", 1);
    assert!(patch_is_current(&branch, &reworded, FOLDER).unwrap());
    let reordered = VANILLA_GAMEINFO.replacen(
        "\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore",
        "\t\t\tGame\t\t\t\tcore\n\t\t\tGame\t\t\t\tdota",
        1,
    );
    assert_ne!(reordered, VANILLA_GAMEINFO, "the fixture really moved the line");
    assert!(!patch_is_current(&branch, &reordered, FOLDER).unwrap());
}

#[test]
fn stripping_a_file_that_was_never_patched_leaves_it_alone() {
    assert_eq!(strip_patch(VANILLA_BRANCH), VANILLA_BRANCH);
}

#[test]
fn the_stripped_file_still_hashes_to_what_valve_signed() {
    let want = vanilla_branch_hashes(&vanilla_signatures(VANILLA_BRANCH));
    assert!(want.is_some(), "the vanilla hashes should be readable from the list");
    let patched = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    assert!(matches_vanilla(&strip_patch(&patched), want.as_ref()));
    assert!(!matches_vanilla(&patched, want.as_ref()), "a patched file must not pass");
}

#[test]
fn restoring_the_branch_reports_a_verified_original_when_the_hash_agrees() {
    let want = vanilla_branch_hashes(&vanilla_signatures(VANILLA_BRANCH));
    let patched = patched_branch(VANILLA_BRANCH, &patched_block()).unwrap();
    let (text, verified) = restore_branch(&patched, want.as_ref());
    assert_eq!(text, VANILLA_BRANCH);
    assert!(verified);
}

#[test]
fn restoring_the_branch_repairs_the_one_tab_short_file_older_versions_produced() {
    // What the old strip left behind: correct content, missing the indent ahead of the FileSystem
    // closing brace. It loads, so only the hash gives it away.
    let short = VANILLA_BRANCH.replacen("\r\n\t}\r\n}\r\n", "\r\n}\r\n}\r\n", 1);
    assert_ne!(short, VANILLA_BRANCH);
    let want = vanilla_branch_hashes(&vanilla_signatures(VANILLA_BRANCH));
    assert!(!matches_vanilla(&short, want.as_ref()), "the short file must not pass as vanilla");
    let (text, verified) = restore_branch(&short, want.as_ref());
    assert_eq!(text, VANILLA_BRANCH);
    assert!(verified);
}

#[test]
fn restoring_the_branch_admits_when_it_cannot_verify() {
    let stranger = VANILLA_BRANCH.replacen("570", "571", 1);
    let want = vanilla_branch_hashes(&vanilla_signatures(VANILLA_BRANCH));
    let (_, verified) = restore_branch(&stranger, want.as_ref());
    assert!(!verified);
}

#[test]
fn valves_own_signature_entry_is_not_mistaken_for_ours() {
    // The v1.14.3 bug: a substring check found gameinfo_branchspecific.gi in the pristine list,
    // decided the file was already patched, and froze the backup at a pre-update build.
    assert!(!has_signature_patch(&vanilla_signatures(VANILLA_BRANCH)));
}

#[test]
fn our_signature_entry_is_recognised_only_after_the_digest_line() {
    let ours = signature_line(b"anything");
    let signed = format!("{}{ours}\r\n", vanilla_signatures(VANILLA_BRANCH));
    assert!(has_signature_patch(&signed));
}

#[test]
fn stripping_signatures_removes_our_line_and_keeps_the_list_the_game_shipped() {
    let ours = signature_line(b"anything");
    let signed = format!("{}{ours}\r\n", vanilla_signatures(VANILLA_BRANCH));
    let stripped = strip_signatures(&signed);
    assert!(!has_signature_patch(&stripped));
    assert!(stripped.contains("DIGEST:"), "the DIGEST line stays");
    assert!(vanilla_branch_hashes(&stripped).is_some(), "Valve's own entry for the branch file stays readable");
    assert!(!stripped.contains(&ours));
    assert_eq!(stripped, vanilla_signatures(VANILLA_BRANCH), "and the list is the one shipped, byte for byte");
}

#[test]
fn the_vanilla_hashes_come_from_before_the_digest_never_from_our_appended_line() {
    let other = VANILLA_BRANCH.replacen("570", "999", 1);
    let decoy = file_hashes(other.as_bytes());
    let signed = format!(
        "{}...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:{};CRC:{}\r\n",
        vanilla_signatures(VANILLA_BRANCH),
        decoy.sha1,
        decoy.crc
    );
    let want = vanilla_branch_hashes(&signed);
    assert!(matches_vanilla(VANILLA_BRANCH, want.as_ref()));
    assert_ne!(want.map(|w| w.sha1), Some(decoy.sha1));
}

#[test]
fn a_signature_line_is_the_path_sha1_and_little_endian_crc_the_game_expects() {
    // The expectation comes from outside this code. "123456789" is the standard check input: its
    // CRC-32 is 0xCBF43926, which the list stores low byte first, as 2639F4CB. Checked against an
    // installed game on 2026-09-16: its list names gameinfo.gi with CRC C42BAA0F, and that file's
    // CRC-32 is 0x0FAA2BC4. A shape-only check passed with the bytes the wrong way round.
    assert_eq!(
        signature_line(b"123456789"),
        r"...\..\..\dota\gameinfo_branchspecific.gi~SHA1:F7C3BC1D808E04732ADF679965CCC34CA7AE3441;CRC:2639F4CB"
    );
}

#[test]
fn the_mod_folder_goes_ahead_of_the_game_as_both_game_and_mod_path() {
    let block = patched_block();
    let lines: Vec<&str> = block.split("\r\n").map(str::trim).filter(|l| !l.is_empty()).collect();
    let words = |l: &str| l.split_whitespace().map(String::from).collect::<Vec<_>>();
    let find = |key: &str, val: &str| {
        lines.iter().position(|l| {
            words(l).first().map(String::as_str) == Some(key) && words(l).get(1).map(String::as_str) == Some(val)
        })
    };
    let game = find("Game", FOLDER).expect("our Game entry is added");
    let game_dota = find("Game", "dota").unwrap();
    let modp = find("Mod", FOLDER).expect("our Mod entry is added");
    let mod_dota = find("Mod", "dota").unwrap();
    assert!(game < game_dota, "our Game path comes first, so it becomes the MOD path");
    assert!(modp < mod_dota, "our Mod path comes first");
}

#[test]
fn adding_the_mod_folder_refuses_a_block_with_no_game_or_mod_dota_lines_to_anchor_to() {
    assert!(with_mod_folder("SearchPaths\r\n{\r\n\tGame\tcore\r\n}", FOLDER).is_err());
}

#[test]
fn reading_the_search_paths_rejects_a_gameinfo_with_none() {
    assert!(search_paths_block("\"GameInfo\"\r\n{\r\n}\r\n").is_err());
}

#[test]
fn patching_rejects_a_branch_file_with_no_filesystem_section() {
    assert!(patched_branch("\"GameInfo\"\r\n{\r\n}\r\n", &patched_block()).is_err());
}

// ---------------------------------------------------------------------------------------------
// Against a real directory (test/patcher-tree.test.ts)
//
// apply() once demanded dota.signatures before it would do anything, and Valve's Linux build
// ships bin/linuxsteamrt64/ without one: a Linux user pressing "safe mode off" got "not found" and
// no way forward (2026-09-11). So both shapes of install are built, patched and reverted here.
// `paths()` decides where the list belongs, so this reads the same on either platform.
// ---------------------------------------------------------------------------------------------

const GAMEINFO: &str = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_AudioLanguage\tdota_*LANGUAGE*\n\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore\n\t\t\tMod\t\t\t\t\tdota\n\t\t\tWrite\t\t\t\tdota\n\t\t}\n\t}\n}\n";

const BRANCH: &str =
    "\"GameInfo\"\r\n{\r\n\tgame \t\t\"Dota 2\"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t}\r\n}\r\n";

/// A list with no entry for the branch file: `vanilla_branch_hashes` finds nothing to compare
/// against. The point is whether our own line goes in and comes out, not hash arithmetic.
fn signatures() -> String {
    format!("somefile.dll~SHA1:{};CRC:{}\r\nDIGEST:{}\r\n", "A".repeat(40), "B".repeat(8), "C".repeat(40))
}

/// A throwaway game tree in the temp folder, removed on drop.
struct Tree {
    root: PathBuf,
    game: PathBuf,
    backups: PathBuf,
    sig: PathBuf,
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

impl Tree {
    /// `with_list`: give it a dota.signatures, the way Windows ships one.
    fn new(with_list: bool) -> Tree {
        static N: AtomicUsize = AtomicUsize::new(0);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "mm-core-patcher-{}-{}-{nanos}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let game = root.join("game");
        let backups = root.join("backups");
        fs::create_dir_all(game.join("dota")).unwrap();
        fs::create_dir_all(&backups).unwrap();
        fs::write(game.join("dota").join("gameinfo.gi"), GAMEINFO).unwrap();
        fs::write(game.join("dota").join("gameinfo_branchspecific.gi"), BRANCH).unwrap();
        let sig = patcher::paths(&game).signatures;
        if with_list {
            fs::create_dir_all(sig.parent().unwrap()).unwrap();
            fs::write(&sig, signatures()).unwrap();
        }
        Tree { root, game, backups, sig }
    }

    fn branch_path(&self) -> PathBuf {
        patcher::paths(&self.game).branch
    }

    fn branch(&self) -> String {
        latin1_file(&self.branch_path())
    }

    fn apply(&self) -> Result<patcher::PatchState, String> {
        patcher::apply(&self.game, FOLDER, &self.backups)
    }

    fn state(&self) -> patcher::PatchState {
        patcher::state(&self.game, Some(FOLDER)).unwrap()
    }

    fn temp_copies(&self) -> Vec<String> {
        fs::read_dir(self.game.join("dota"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".mmtmp"))
            .collect()
    }
}

fn latin1_file(p: &Path) -> String {
    fs::read(p).unwrap().into_iter().map(char::from).collect()
}

#[test]
fn an_install_that_ships_no_signature_list_is_still_patched() {
    let t = Tree::new(false);
    assert!(!t.sig.exists(), "the tree really has no list");
    let st = t.apply().unwrap();
    assert!(t.branch().contains(MARKER), "the branch file carries the patch");
    assert!(t.branch().contains(FOLDER), "and names the mod folder");
    assert!(st.patched);
    assert!(t.game.join(FOLDER).is_dir(), "the folder the patch registers exists");
    assert!(!t.sig.exists(), "and no list was invented for it");
}

#[test]
fn an_install_with_no_list_reports_that_rather_than_an_unsigned_patch() {
    // The status dot and the schema heal both treat "patched but not signed" as something wrong.
    // On Linux that would be permanent, and re-patching on every check the app fighting itself.
    let t = Tree::new(false);
    t.apply().unwrap();
    let st = t.state();
    assert!(!st.signable, "there is nothing here to sign into");
    assert!(!st.signed, "so nothing was signed");
    assert!(st.patched, "and the patch is on, which is the finished state here");
}

#[test]
fn an_install_with_a_list_gets_the_patch_signed_into_it() {
    let t = Tree::new(true);
    let st = t.apply().unwrap();
    assert!(st.signable);
    assert!(st.signed, "the patched branch file is accounted for in the list");
    let text = latin1_file(&t.sig);
    assert!(text.contains("gameinfo_branchspecific.gi~SHA1:"), "our line is in the list");
    assert!(text.contains("DIGEST:"), "and Valve's own lines are still there");
}

#[test]
fn a_patch_from_before_a_gameinfo_change_reads_as_outdated_and_applying_again_brings_it_up_to_date() {
    let t = Tree::new(true);
    let gameinfo = patcher::paths(&t.game).gameinfo;
    // build 6944: the language key was still Game_Language
    fs::write(&gameinfo, GAMEINFO.replacen("Game_AudioLanguage\t", "Game_Language\t\t", 1)).unwrap();
    t.apply().unwrap();
    assert!(!t.state().outdated, "current against the file it was built from");

    // build 6946 rewrites gameinfo.gi and leaves the branch file and our signed line alone
    fs::write(&gameinfo, GAMEINFO).unwrap();
    let st = t.state();
    assert!(st.patched);
    assert!(st.signed, "nothing about the signature gives it away");
    assert!(st.outdated);

    t.apply().unwrap();
    assert!(!t.state().outdated);
    assert!(t.branch().contains("Game_AudioLanguage"));
    assert!(!t.branch().contains("Game_Language"));
    assert!(t.state().signed, "and the rebuilt file is signed in turn");
}

#[test]
fn an_unreadable_gameinfo_does_not_make_a_patch_look_outdated() {
    let t = Tree::new(true);
    t.apply().unwrap();
    fs::write(patcher::paths(&t.game).gameinfo, "\"GameInfo\"\n{\n}\n").unwrap();
    assert!(!t.state().outdated);
}

#[test]
fn reverting_puts_both_files_back_exactly_as_they_were() {
    for with_list in [true, false] {
        let t = Tree::new(with_list);
        let branch_before = fs::read(t.branch_path()).unwrap();
        let sig_before = with_list.then(|| fs::read(&t.sig).unwrap());

        t.apply().unwrap();
        let st = patcher::revert(&t.game, Some(FOLDER), &t.backups).unwrap();

        assert_eq!(fs::read(t.branch_path()).unwrap(), branch_before, "the branch file came back (list: {with_list})");
        if let Some(sig_before) = sig_before {
            assert_eq!(fs::read(&t.sig).unwrap(), sig_before, "and so did the list");
        }
        assert!(!st.patched);
        assert!(!t.game.join(FOLDER).exists(), "and the empty mod folder is gone (list: {with_list})");
    }
}

#[test]
fn reverting_keeps_a_mod_folder_that_still_holds_files() {
    let t = Tree::new(true);
    t.apply().unwrap();
    fs::write(t.game.join(FOLDER).join("pak01_dir.vpk"), b"x").unwrap();
    patcher::revert(&t.game, Some(FOLDER), &t.backups).unwrap();
    assert!(t.game.join(FOLDER).join("pak01_dir.vpk").exists());
}

#[test]
fn applying_twice_does_not_stack_with_a_list_or_without_one() {
    for with_list in [true, false] {
        let t = Tree::new(with_list);
        t.apply().unwrap();
        let once = t.branch();
        t.apply().unwrap();
        assert_eq!(t.branch(), once, "the second patch changed nothing (list: {with_list})");
        // twice by design: the folder is registered on a Game line and on a Mod line, each marked.
        // The count is pinned so a third registration is a deliberate change.
        assert_eq!(once.matches(MARKER).count(), 2);
    }
}

#[test]
fn a_tree_with_no_gameinfo_at_all_is_refused_and_the_error_names_the_file() {
    let t = Tree::new(true);
    fs::remove_file(t.game.join("dota").join("gameinfo.gi")).unwrap();
    let err = t.apply().unwrap_err();
    assert!(err.contains("gameinfo.gi"), "the file it cannot do without is named in the error: {err}");
}

// The signature list belongs to the build of Dota installed right now. Valve ships a new one with
// every build (every DLL's hash and a DIGEST over the lot); rebuilding it from a copy taken weeks
// earlier put an old build's hashes back and the client refused matchmaking, while the app said
// patched, signed and vanilla. Measured on a real install on 2026-09-11.

fn list_for(build: &str, branch: &[u8]) -> String {
    let h = file_hashes(branch);
    let dll = |name: &str| format!(r"...\{name}~SHA1:{};CRC:{}", build.repeat(40), build.repeat(8));
    [
        format!(r"...\..\..\dota\gameinfo_branchspecific.gi~SHA1:{};CRC:{}", h.sha1, h.crc),
        dll("client.dll"),
        dll("dota2.exe"),
        format!("DIGEST:{}", build.repeat(64)),
    ]
    .join("\r\n")
        + "\r\n"
}

fn exe_hash(text: &str) -> Option<String> {
    let at = text.find("dota2.exe~SHA1:")? + "dota2.exe~SHA1:".len();
    text.get(at..at + 40).map(String::from)
}

#[test]
fn the_patch_is_signed_into_the_list_the_installed_build_shipped_not_an_older_one() {
    let t = Tree::new(true);
    let vanilla = fs::read(t.branch_path()).unwrap();
    fs::write(&t.sig, list_for("A", &vanilla)).unwrap();

    t.apply().unwrap();
    assert_eq!(exe_hash(&latin1_file(&t.sig)), Some("A".repeat(40)), "build A to start with");

    // Dota updates to build B while our line is still in the file. The app's copy of the list
    // stays at A, because a file that still carries our line is not taken as new ground truth.
    let patched = fs::read(t.branch_path()).unwrap();
    let b = format!("{}\r\n{}\r\n", list_for("B", &vanilla).trim_end(), signature_line(&patched));
    fs::write(&t.sig, b).unwrap();

    t.apply().unwrap();

    let after = latin1_file(&t.sig);
    assert_eq!(exe_hash(&after), Some("B".repeat(40)), "the list belongs to the build installed, not the one that was");
    assert!(after.contains(&signature_line(&fs::read(t.branch_path()).unwrap())), "and our own line is in it");
    assert_eq!(after.matches("gameinfo_branchspecific").count(), 2, "Valve's entry and ours, no more");
}

#[test]
fn signing_twice_does_not_pile_our_line_up_in_the_list() {
    let t = Tree::new(true);
    let vanilla = fs::read(t.branch_path()).unwrap();
    fs::write(&t.sig, list_for("A", &vanilla)).unwrap();

    t.apply().unwrap();
    t.apply().unwrap();
    t.apply().unwrap();

    let after = latin1_file(&t.sig);
    assert_eq!(after.matches("gameinfo_branchspecific").count(), 2, "one Valve entry, one of ours");
    assert_eq!(exe_hash(&after), Some("A".repeat(40)), "and Valve's own lines are untouched");
}

#[test]
fn a_backup_from_an_older_build_is_replaced_or_reverting_would_put_the_old_build_back() {
    // revert() restores from the copy taken before patching. A copy that no longer matches the
    // list the game ships is worse than none: it loads, so nothing looks wrong until matchmaking
    // stops. A mutation run on 2026-09-16 took the check out and nothing noticed.
    let t = Tree::new(true);
    let h = file_hashes(BRANCH.as_bytes());
    let listed = format!(r"...\..\..\dota\gameinfo_branchspecific.gi~SHA1:{};CRC:{}", h.sha1, h.crc)
        + &format!("\r\nDIGEST:{}\r\n", "C".repeat(40));
    fs::write(&t.sig, listed).unwrap();

    t.apply().unwrap();
    // the copy taken before an update: the same file, with a line Valve has since changed
    fs::write(t.backups.join("gameinfo_branchspecific.gi.orig"), BRANCH.replacen("570", "569", 1)).unwrap();

    t.apply().unwrap();
    assert!(t.branch().contains("570"), "the patch was rebuilt on top of the current build");
    patcher::revert(&t.game, Some(FOLDER), &t.backups).unwrap();

    assert_eq!(t.branch(), BRANCH, "reverting put the current build back");
    assert!(t.state().vanilla_ok);
}

/// Windows refuses to rename over a file another process holds open without delete sharing, as
/// Steam holds gameinfo while it runs. The write falls back to replacing the file in place. The TS
/// test faked this by mocking fs.renameSync; here a real handle holds the branch file open.
#[cfg(windows)]
#[test]
fn a_file_steam_holds_open_is_still_written_and_the_temporary_copy_does_not_stay_behind() {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    const FILE_SHARE_WRITE: u32 = 2;

    let t = Tree::new(true);
    let held = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(t.branch_path())
        .unwrap();
    // the handle really blocks a rename over the file
    let probe = t.game.join("dota").join("probe");
    fs::write(&probe, b"x").unwrap();
    assert!(fs::rename(&probe, t.branch_path()).is_err(), "the held file cannot be renamed over");
    fs::remove_file(&probe).unwrap();

    t.apply().unwrap();
    assert!(t.branch().contains(MARKER), "the file was replaced in place");
    assert_eq!(t.temp_copies(), Vec::<String>::new());
    drop(held);
    assert!(t.state().signed, "and the list written the same way names it");
}

/// A file another program holds with no sharing at all can be neither replaced nor written. The
/// write fails, the file keeps its bytes, and no temporary copy is left beside it.
#[cfg(windows)]
#[test]
fn a_file_nobody_may_touch_is_left_as_it_was_and_the_temporary_copy_goes() {
    use std::os::windows::fs::OpenOptionsExt;
    let t = Tree::new(false);
    let before = fs::read(t.branch_path()).unwrap();
    let held = fs::OpenOptions::new().read(true).share_mode(0).open(t.branch_path()).unwrap();
    assert!(patcher::write_atomic(&t.branch_path(), b"new bytes").is_err());
    drop(held);
    assert_eq!(fs::read(t.branch_path()).unwrap(), before, "the file keeps its bytes");
    assert_eq!(t.temp_copies(), Vec::<String>::new(), "and nothing is left beside it");
}

/// The TS test made renameSync throw ENOSPC. Rust's rename cannot be faked without a new crate, so
/// the write is made to fail one step earlier: a folder sits where the temporary copy would go.
#[test]
fn a_write_that_fails_stops_the_patch_and_leaves_the_game_files_as_they_were() {
    let t = Tree::new(true);
    let before = t.branch();
    let sig_before = latin1_file(&t.sig);
    let tmp = t.game.join("dota").join("gameinfo_branchspecific.gi.mmtmp");
    fs::create_dir(&tmp).unwrap();

    assert!(t.apply().is_err());
    assert_eq!(t.branch(), before, "the game file is as it was");
    assert_eq!(latin1_file(&t.sig), sig_before, "and the list was never reached");
    assert!(tmp.is_dir(), "nothing was written where the temporary copy goes");
    assert_eq!(t.temp_copies(), vec!["gameinfo_branchspecific.gi.mmtmp".to_string()]);
}

#[test]
fn an_atomic_write_replaces_the_file_and_leaves_no_temporary_copy() {
    let t = Tree::new(false);
    patcher::write_atomic(&t.branch_path(), b"new bytes").unwrap();
    assert_eq!(fs::read(t.branch_path()).unwrap(), b"new bytes");
    assert_eq!(t.temp_copies(), Vec::<String>::new());
}

#[test]
fn the_state_of_a_folder_without_a_branch_file_is_unpatched_and_unsignable() {
    let t = Tree::new(true);
    fs::remove_file(t.branch_path()).unwrap();
    let st = t.state();
    assert!(!st.patched && !st.signable && !st.signed && st.vanilla_ok);
}

#[test]
fn another_patchers_folder_is_spotted_by_name() {
    let t = Tree::new(true);
    let foreign = BRANCH.replacen("\t\tSteamAppId", "\t\tGame\tdota_tempcontent\r\n\t\tSteamAppId", 1);
    fs::write(t.branch_path(), foreign).unwrap();
    assert_eq!(t.state().foreign.as_deref(), Some("dota_tempcontent"));
}
