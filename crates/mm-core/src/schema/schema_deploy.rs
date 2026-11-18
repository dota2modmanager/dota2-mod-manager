//! The built item table written into the game (src/schema.ts `deploySteps`, `undeploy`,
//! `sweepUnfinished`, `isDeployed`): the game's own table with the patches spliced in, checked,
//! packed with the files the patches bring, and swapped into the mods folder in one rename.
//! Always built from the installed game, so a Dota update is repaired by building again.
//!
//! The TypeScript yields between the stages so the window can draw; here the whole of it runs on
//! the shell's worker thread, and `stop` is asked before the write, where a newer build that took
//! over would make this one's pak a waste.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::schema_merge::{self, Applied, Conflict, Patch};
use crate::vpk::{self, Entry};

/// Our folder is registered ahead of "dota", so the first pak in it wins the MOD path.
pub const SCHEMA_VPK: &str = "pak01_dir.vpk";

/// What deploy wrote.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Deployed {
    pub applied: Vec<Applied>,
    pub missing: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub stamp: String,
    pub bytes: usize,
    pub items: usize,
}

/// The merged table as a one-file VPK, with the files its patches bring.
pub fn build_schema_vpk(text: &[u8], extra: &[Entry]) -> Vec<u8> {
    let mut entries = Vec::with_capacity(extra.len() + 1);
    entries.push(vpk::entry_at(crate::schema::SCHEMA_REL, text.to_vec().into()));
    entries.extend_from_slice(extra);
    vpk::build(&entries)
}

/// The files of every patch and then the bases', each path once (the first one wins).
pub fn extras(assets: &[&[Entry]]) -> Vec<Entry> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for list in assets {
        for en in *list {
            if seen.insert(en.path().to_lowercase()) {
                out.push(en.clone());
            }
        }
    }
    out
}

/// temporary files of the pak, one name each: a write in the background and one in place can overlap
static WRITES: AtomicUsize = AtomicUsize::new(0);

/// Merge, check, pack and write. `base`: the game's table and its stamp; `assets`: each patch's
/// files and then the bases'. None when `stop` said a newer build took over before the write.
pub fn deploy(
    game: &Path,
    folder: &str,
    patches: &[Patch],
    assets: &[&[Entry]],
    base: (&[u8], &str),
    stop: &dyn Fn() -> bool,
) -> Result<Option<Deployed>, String> {
    let merged = schema_merge::merge(base.0, patches).map_err(|e| e.to_string())?;
    let (items, bytes) = schema_merge::validate(&merged.text, Some(base.0)).map_err(|e| e.to_string())?;
    let buf = build_schema_vpk(&merged.text, &extras(assets));
    if stop() {
        return Ok(None);
    }
    let dir = game.join(folder);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(SCHEMA_VPK);
    let n = WRITES.fetch_add(1, Ordering::Relaxed) + 1;
    let tmp = dir.join(format!("{SCHEMA_VPK}.{}-{n}.mmtmp", std::process::id()));
    let res = (|| {
        std::fs::write(&tmp, &buf)?;
        if dest.exists() {
            std::fs::remove_file(&dest)?;
        }
        std::fs::rename(&tmp, &dest)
    })();
    // gone after the rename; left by a failed write
    let _ = std::fs::remove_file(&tmp);
    res.map_err(|e| e.to_string())?;
    Ok(Some(Deployed {
        applied: merged.applied,
        missing: merged.missing,
        conflicts: merged.conflicts,
        stamp: base.1.to_string(),
        bytes,
        items,
    }))
}

// Any real file left in a tree: the engine drops empty rpt/ and save/ folders into every mounted
// content path, and those must not keep the folder alive.
fn has_files(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    rd.flatten().any(|e| if e.path().is_dir() { has_files(&e.path()) } else { true })
}

/// Drop the built table, and the folder with it once nothing of ours is left there.
pub fn undeploy(game: &Path, folder: &str) -> std::io::Result<()> {
    let dir = game.join(folder);
    let dest = dir.join(SCHEMA_VPK);
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    if dir.exists() && !has_files(&dir) {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// Take away the half-done writes of the pak another run left. This run's own are its builds'
/// to finish, so only another process's go. How many went.
pub fn sweep_unfinished(game: &Path, folder: &str, pid: u32) -> usize {
    let dir = game.join(folder);
    let Ok(rd) = std::fs::read_dir(&dir) else { return 0 };
    let mine = format!("{SCHEMA_VPK}.{pid}-");
    let mut n = 0;
    for e in rd.flatten() {
        let f = e.file_name().to_string_lossy().into_owned();
        if f.starts_with(&format!("{SCHEMA_VPK}.")) && f.ends_with(".mmtmp") && !f.starts_with(&mine) {
            let _ = std::fs::remove_file(e.path());
            n += 1;
        }
    }
    n
}

/// Whether a built table is in the mod folder.
pub fn is_deployed(game: &Path, folder: &str) -> bool {
    game.join(folder).join(SCHEMA_VPK).exists()
}
