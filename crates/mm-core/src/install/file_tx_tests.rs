//! A change to the game folder that a crash cut short is put back on the next start, and one that
//! got as far as committing is finished instead. A process killed mid-change is a transaction
//! abandoned without commit or rollback (`std::mem::forget`): only its journal on the disk is left.

use super::*;
use std::collections::BTreeMap;

struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new(name: &str) -> Scratch {
        let root = std::env::temp_dir().join(format!("mm-filetx-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("game/dota_russian")).unwrap();
        fs::create_dir_all(root.join("journal")).unwrap();
        Scratch { root }
    }
    fn game(&self) -> PathBuf {
        self.root.join("game")
    }
    fn journal(&self) -> PathBuf {
        self.root.join("journal")
    }
    /// Every file under the game folder and its bytes.
    fn snapshot(&self) -> BTreeMap<String, Vec<u8>> {
        fn walk(dir: &Path, base: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                if p.is_dir() {
                    out.insert(format!("{rel}/"), Vec::new());
                    walk(&p, base, out);
                } else {
                    out.insert(rel, fs::read(&p).unwrap());
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(&self.game(), &self.game(), &mut out);
        out
    }
    fn journals(&self) -> usize {
        fs::read_dir(self.journal()).unwrap().flatten().count()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn quiet() -> Box<dyn FnMut(String)> {
    Box::new(|_| {})
}

/// A folder as a player has it: Valve's gameinfo, one of our paks, a file another mod put there.
fn seeded(name: &str) -> Scratch {
    let s = Scratch::new(name);
    let lang = s.game().join("dota_russian");
    fs::write(lang.join("gameinfo_branchspecific.gi"), b"valve's own").unwrap();
    fs::write(lang.join("pak02_dir.vpk"), b"an installed mod").unwrap();
    fs::write(lang.join("pak05_dir.vpk"), b"somebody else's").unwrap();
    s
}

/// Every kind of step one change can take: a new file, a file written over, one moved, one removed,
/// and a folder made for a file.
fn every_kind_of_step(tx: &mut FileTx, game: &Path) {
    let lang = game.join("dota_russian");
    tx.write(&lang.join("pak03_dir.vpk"), b"a new mod").unwrap();
    tx.write(&lang.join("gameinfo_branchspecific.gi"), b"patched").unwrap();
    tx.rename(&lang.join("pak02_dir.vpk"), &lang.join("pak04_dir.vpk")).unwrap();
    tx.remove(&lang.join("pak05_dir.vpk")).unwrap();
    tx.write(&lang.join("cfg/new/autoexec.cfg"), b"r_draw_selected_ring 1").unwrap();
}

#[test]
fn a_change_killed_halfway_is_undone_on_the_next_start_byte_for_byte() {
    let s = seeded("killed");
    let before = s.snapshot();
    let mut tx = FileTx::new(Some(&s.journal()), quiet());
    every_kind_of_step(&mut tx, &s.game());
    assert_ne!(s.snapshot(), before, "the steps changed nothing, so the test proves nothing");
    std::mem::forget(tx);

    let got = recover_journals(Some(&s.journal()), &mut |_| {});
    assert_eq!(got, Recovered { undone: 1, finished: 0 });
    assert_eq!(s.snapshot(), before, "the folder is not what it was before the change");
    assert_eq!(s.journals(), 0, "the journal stays and would be replayed on every start");
}

#[test]
fn a_change_that_committed_is_kept_and_only_its_parked_copies_go() {
    let s = seeded("committed");
    let mut tx = FileTx::new(Some(&s.journal()), quiet());
    every_kind_of_step(&mut tx, &s.game());
    tx.commit();
    let after = s.snapshot();
    assert!(after.keys().all(|k| !k.contains(".mmtx")), "commit left parked copies: {:?}", after.keys());

    assert_eq!(recover_journals(Some(&s.journal()), &mut |_| {}), Recovered::default());
    assert_eq!(s.snapshot(), after);
}

#[test]
fn a_crash_between_the_commit_line_and_the_clean_up_finishes_the_change() {
    // the journal says committed, and a parked copy of the file written over is still there
    let s = seeded("after-commit");
    let lang = s.game().join("dota_russian");
    let dest = lang.join("gameinfo_branchspecific.gi");
    let parked = lang.join("gameinfo_branchspecific.gi.parked");
    fs::write(&parked, b"valve's own").unwrap();
    fs::write(&dest, b"patched").unwrap();
    let step =
        serde_json::to_string(&Undo::Unwrite { dest: path_str(&dest), parked: Some(path_str(&parked)) }).unwrap();
    fs::write(s.journal().join(format!("1{JOURNAL_EXT}")), format!("{step}\n{{\"commit\":true}}\n")).unwrap();

    assert_eq!(recover_journals(Some(&s.journal()), &mut |_| {}), Recovered { undone: 0, finished: 1 });
    assert_eq!(fs::read(&dest).unwrap(), b"patched", "a committed change was taken back");
    assert!(!parked.exists(), "the parked copy is left in the game folder");
    assert_eq!(s.journals(), 0);
}

#[test]
fn a_journal_torn_mid_line_is_undone_up_to_the_last_whole_step() {
    let s = seeded("torn");
    let before = s.snapshot();
    let mut tx = FileTx::new(Some(&s.journal()), quiet());
    every_kind_of_step(&mut tx, &s.game());
    std::mem::forget(tx);
    // the power went while the next step was being written
    let file = fs::read_dir(s.journal()).unwrap().flatten().next().unwrap().path();
    let mut f = fs::OpenOptions::new().append(true).open(&file).unwrap();
    f.write_all(b"{\"what\":\"unwrite\",\"dest\":\"C:/half").unwrap();
    drop(f);

    assert_eq!(recover_journals(Some(&s.journal()), &mut |_| {}).undone, 1);
    assert_eq!(s.snapshot(), before);
}

#[test]
fn a_change_that_fails_in_the_app_is_rolled_back_at_once() {
    let s = seeded("fails");
    let before = s.snapshot();
    let out: Result<(), String> = FileTx::run(Some(&s.journal()), quiet(), |tx| {
        every_kind_of_step(tx, &s.game());
        Err("the disk is full".into())
    });
    assert!(out.is_err());
    assert_eq!(s.snapshot(), before);
    assert_eq!(recover_journals(Some(&s.journal()), &mut |_| {}), Recovered::default(), "nothing is left to recover");
}

#[test]
fn two_changes_killed_one_after_the_other_are_undone_newest_first() {
    // the second change moved what the first one wrote; undone oldest first, the first would
    // find nothing to take back and the second would put its file back in the wrong place
    let s = seeded("two");
    let before = s.snapshot();
    let lang = s.game().join("dota_russian");
    let mut first = FileTx::new(Some(&s.journal()), quiet());
    first.write(&lang.join("pak03_dir.vpk"), b"first").unwrap();
    std::mem::forget(first);
    let mut second = FileTx::new(Some(&s.journal()), quiet());
    second.rename(&lang.join("pak03_dir.vpk"), &lang.join("pak06_dir.vpk")).unwrap();
    std::mem::forget(second);

    assert_eq!(recover_journals(Some(&s.journal()), &mut |_| {}).undone, 2);
    assert_eq!(s.snapshot(), before);
}

#[test]
fn a_change_that_took_no_step_leaves_no_journal() {
    let s = seeded("empty");
    FileTx::run::<(), String>(Some(&s.journal()), quiet(), |_| Ok(())).unwrap();
    assert_eq!(s.journals(), 0);
}
