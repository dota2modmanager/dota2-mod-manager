//! The installer: everything that writes a mod into the game folder or takes it out again.
//! Replacing src/installer.ts piece by piece; the work behind it lives in files of its own, as
//! there (installer_slots.rs is the load order).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::i18n::t;
use crate::installer_files::MASTER_OFF;

/// Told what a failed change could not put back.
pub type Log = Arc<dyn Fn(String) + Send + Sync>;

pub struct Installer {
    /// e.g. ...\dota 2 beta\game
    pub game: Option<PathBuf>,
    /// e.g. "russian"
    pub lang_suffix: String,
    /// where a change's journal goes (src/file-tx.ts FileTx.journalDir)
    pub journal_dir: Option<PathBuf>,
    pub log: Log,
}

impl Installer {
    pub fn new(game: Option<PathBuf>, lang_suffix: &str) -> Installer {
        Installer { game, lang_suffix: lang_suffix.to_string(), journal_dir: None, log: Arc::new(|_| {}) }
    }

    /// The log, as a change takes it.
    pub fn tx_log(&self) -> Box<dyn FnMut(String)> {
        let log = self.log.clone();
        Box::new(move |m| log(m))
    }

    /// The language folder mods are installed into.
    pub fn lang_folder(&self) -> Result<PathBuf, String> {
        let game =
            self.game.as_ref().filter(|g| !g.as_os_str().is_empty()).ok_or_else(|| t("Путь к Dota 2 не задан", &[]))?;
        Ok(game.join(format!("dota_{}", self.lang_suffix)))
    }

    /// Where a mod's file actually is right now: switched off it carries .off, under the master
    /// switch .moff. Falls back to the plain path so callers still get a sensible error.
    pub fn lang_file_on_disk(&self, rel_path: &str) -> Result<PathBuf, String> {
        let base = self.lang_folder()?.join(rel_path);
        let with = |s: &str| {
            let mut p = base.clone().into_os_string();
            p.push(s);
            PathBuf::from(p)
        };
        Ok(["", ".off", MASTER_OFF].iter().map(|s| with(s)).find(|p| p.exists()).unwrap_or(base))
    }
}

/// A path with a suffix added to its file name.
pub fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}
