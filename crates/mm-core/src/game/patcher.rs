//! The search-path patch on disk, replacing the file half of src/patcher.ts: registers an extra
//! content folder ahead of the game's own (the only way to override what the engine reads
//! through the MOD path, items_game.txt above all), signs the patched file into
//! dota.signatures, keeps the originals and puts them back. The text work is
//! patcher_gameinfo.rs and patcher_signatures.rs.

use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::Serialize;
use serde_json::json;

use crate::i18n::t;
use crate::kv::{latin1, to_latin1};
use crate::patcher_gameinfo::{
    patch_is_current, patched_branch, restore_branch, search_paths_block, with_mod_folder, MARKER,
};
use crate::patcher_signatures::{
    has_signature_patch, matches_vanilla, signature_line, strip_signatures, vanilla_branch_hashes,
};

/// The content folder registered next to the game's own "dota".
pub const FOLDER: &str = "dota_mods";

/// Folder names other patchers register, so one can be spotted and not fought.
const KNOWN_FOREIGN: [&str; 3] = ["Dota2SkinChanger", "DotaModdingCommunityMods", "dota_tempcontent"];

/// What the install looks like right now.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchState {
    pub patched: bool,
    pub signed: bool,
    pub signable: bool,
    pub folder: Option<String>,
    pub outdated: bool,
    pub foreign: Option<String>,
    pub vanilla_ok: bool,
}

/// The three files the patch touches, for this platform's layout of the game.
pub struct Paths {
    pub gameinfo: PathBuf,
    pub branch: PathBuf,
    pub signatures: PathBuf,
}

pub fn paths(game: &Path) -> Paths {
    let bin = if cfg!(target_os = "linux") { ["bin", "linuxsteamrt64"] } else { ["bin", "win64"] };
    Paths {
        gameinfo: game.join("dota").join("gameinfo.gi"),
        branch: game.join("dota").join("gameinfo_branchspecific.gi"),
        signatures: game.join(bin[0]).join(bin[1]).join("dota.signatures"),
    }
}

fn read_latin1(p: &Path) -> Result<String, String> {
    fs::read(p).map(|b| latin1(&b)).map_err(|e| e.to_string())
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// What the install looks like right now. `signable`: there is a signature list at all
/// (Valve's Linux build ships none, which is not the same as an unsigned patch).
pub fn state(game: &Path, folder: Option<&str>) -> Result<PatchState, String> {
    let p = paths(game);
    let mut out = PatchState {
        patched: false,
        signed: false,
        signable: false,
        folder: None,
        outdated: false,
        foreign: None,
        vanilla_ok: true,
    };
    if !p.branch.exists() {
        return Ok(out);
    }
    out.signable = p.signatures.exists();
    let raw = fs::read(&p.branch).map_err(io)?;
    let branch = latin1(&raw);
    if branch.contains(MARKER) {
        out.patched = true;
        out.folder = folder.map(String::from);
        if let Ok(gi) = read_latin1(&p.gameinfo) {
            if let Ok(current) = patch_is_current(&branch, &gi, folder.filter(|f| !f.is_empty()).unwrap_or(FOLDER)) {
                out.outdated = !current;
            }
        }
    }
    for name in KNOWN_FOREIGN {
        let re = Regex::new(&format!(r"(?m)^\s*(Game|Mod)\s+{name}\s*$")).unwrap();
        if re.is_match(&branch) {
            out.foreign = Some(name.to_string());
        }
    }
    if !out.signable {
        return Ok(out);
    }
    let sig = read_latin1(&p.signatures)?;
    if out.patched {
        let want = signature_line(&raw);
        out.signed = crate::js::lines(&sig).iter().any(|l| crate::js::trim(l) == want);
    } else {
        out.vanilla_ok = matches_vanilla(&branch, vanilla_branch_hashes(&sig).as_ref());
    }
    Ok(out)
}

/// Keep the pristine file: one with no trace of our edit always replaces the backup (a Dota
/// update is the only time the new ground truth is seen); with our edit in, a missing or stale
/// backup is rebuilt by `clean`.
fn backup_once(
    file: &Path,
    backup_dir: &Path,
    clean: &dyn Fn(&str) -> String,
    is_ours: &dyn Fn(&str) -> bool,
    is_good: Option<&dyn Fn(&str) -> bool>,
) -> Result<PathBuf, String> {
    fs::create_dir_all(backup_dir).map_err(io)?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dest = backup_dir.join(format!("{name}.orig"));
    let raw = read_latin1(file)?;
    let stale = match is_good {
        Some(good) if dest.exists() => !good(&read_latin1(&dest)?),
        _ => false,
    };
    if !is_ours(&raw) {
        fs::write(&dest, to_latin1(&raw)).map_err(io)?;
    } else if !dest.exists() || stale {
        fs::write(&dest, to_latin1(&clean(&raw))).map_err(io)?;
    }
    Ok(dest)
}

/// Write through a temp file and a rename (a half-written gameinfo means the game will not
/// start); Windows refuses to rename over a file Steam holds open, so then in place.
pub fn write_atomic(file: &Path, buf: &[u8]) -> Result<(), String> {
    let tmp = crate::installer::with_suffix(file, ".mmtmp");
    fs::write(&tmp, buf).map_err(io)?;
    match fs::rename(&tmp, file) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied || e.kind() == std::io::ErrorKind::AlreadyExists => {
        }
        Err(e) if cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32 | 33 | 183)) => {}
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }
    let _ = fs::remove_file(file);
    if fs::rename(&tmp, file).is_err() {
        fs::write(file, buf).map_err(io)?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
}

/// Register the folder, rebuilt from the current vanilla files each time, so patches never stack.
pub fn apply(game: &Path, folder: &str, backup_dir: &Path) -> Result<PatchState, String> {
    let p = paths(game);
    for f in [&p.gameinfo, &p.branch] {
        if !f.exists() {
            return Err(t("Не найден {0}", &[json!(f.to_string_lossy())]));
        }
    }
    let has_list = p.signatures.exists();
    let want = if has_list { vanilla_branch_hashes(&read_latin1(&p.signatures)?) } else { None };
    let restore = |text: &str| restore_branch(text, want.as_ref()).0;
    let good = |text: &str| matches_vanilla(&restore_branch(text, want.as_ref()).0, want.as_ref());
    backup_once(&p.branch, backup_dir, &restore, &|text: &str| text.contains(MARKER), Some(&good))?;
    if has_list {
        backup_once(&p.signatures, backup_dir, &strip_signatures, &has_signature_patch, None)?;
    }
    let branch_name = p.branch.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let branch_orig = restore(&read_latin1(&backup_dir.join(format!("{branch_name}.orig")))?);
    let block = with_mod_folder(&search_paths_block(&read_latin1(&p.gameinfo)?)?, folder)?;
    let branch_buf = to_latin1(&patched_branch(&branch_orig, &block)?);
    write_atomic(&p.branch, &branch_buf)?;
    if has_list {
        // from the list the game has right now, never from the backup: an older build's hashes
        // put back once left a real install refusing matchmaking
        let sig_orig = strip_signatures(&read_latin1(&p.signatures)?);
        let line = signature_line(&branch_buf);
        let text = format!("{}\r\n{line}\r\n", sig_orig.trim_end_matches(crate::js::is_space));
        write_atomic(&p.signatures, &to_latin1(&text))?;
    }
    fs::create_dir_all(game.join(folder)).map_err(io)?;
    state(game, Some(folder))
}

/// Put the originals back (the signature list first) and drop the folder if it is empty.
pub fn revert(game: &Path, folder: Option<&str>, backup_dir: &Path) -> Result<PatchState, String> {
    let p = paths(game);
    let name = |f: &Path| f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let sig_src = backup_dir.join(format!("{}.orig", name(&p.signatures)));
    let sig_now = if p.signatures.exists() {
        Some(p.signatures.clone())
    } else if sig_src.exists() {
        Some(sig_src)
    } else {
        None
    };
    if let Some(src) = sig_now {
        write_atomic(&p.signatures, &to_latin1(&strip_signatures(&read_latin1(&src)?)))?;
    }
    let branch_src = backup_dir.join(format!("{}.orig", name(&p.branch)));
    if branch_src.exists() {
        let want = if p.signatures.exists() { vanilla_branch_hashes(&read_latin1(&p.signatures)?) } else { None };
        let (text, _) = restore_branch(&read_latin1(&branch_src)?, want.as_ref());
        write_atomic(&p.branch, &to_latin1(&text))?;
    }
    if let Some(f) = folder.filter(|f| !f.is_empty()) {
        let dir = game.join(f);
        if dir.exists() && fs::read_dir(&dir).is_ok_and(|mut d| d.next().is_none()) {
            fs::remove_dir(&dir).map_err(io)?;
        }
    }
    state(game, folder.filter(|f| !f.is_empty()))
}
