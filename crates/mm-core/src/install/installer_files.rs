//! The language folder's own vocabulary, shared by the installer and the modules behind it.
//! Replacing src/installer-files.ts, which says why each one is what it is.

use regex::Regex;
use std::sync::OnceLock;

use crate::slot_zones::is_app_pak;

/// The most a merge of a multi-volume import may hold in memory.
pub const MERGE_SIZE_CAP: u64 = 1200 * 1024 * 1024;

/// What the master "mods off" switch adds to every active mod pak.
pub const MASTER_OFF: &str = ".moff";

/// The master switch off, said on its own.
pub const MASTER_MARK: &str = "dota2modmanager.moff";

/// Which files in the language folder are ours, written where another program can read it.
pub const OWNERSHIP_FILE: &str = "dota2modmanager.json";

/// The game's own files in the language folder, and our notice pak: never a mod to touch.
pub fn is_official_lang_file(base_lower: &str) -> bool {
    base_lower.starts_with("pak01_") || base_lower == "gameinfo.gi" || is_app_pak(base_lower)
}

/// What a FileTx parks next to a file it is about to replace or delete.
pub fn staged_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)\.[a-z0-9]+(?:-[a-z0-9]+)?\.mmtx$").unwrap())
}
