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
    /// asks the game which of its own items a path list replaces (src/mod-id.ts); none without a game
    pub identify: Option<Identify>,
    /// the app's own folder: downloads, tools, backups, packs and cursors live under it
    pub user_data: PathBuf,
}

/// What the game's own item table says a path list is.
pub type Identify = Box<dyn Fn(&[String]) -> Option<crate::installer_folder::Guess> + Send + Sync>;

impl Installer {
    pub fn new(game: Option<PathBuf>, lang_suffix: &str) -> Installer {
        Installer {
            game,
            lang_suffix: lang_suffix.to_string(),
            journal_dir: None,
            log: Arc::new(|_| {}),
            identify: None,
            user_data: PathBuf::new(),
        }
    }

    /// Point the installer at the app's own folder and make the folders it keeps there.
    pub fn with_user_data(mut self, dir: &Path) -> Installer {
        self.user_data = dir.to_path_buf();
        for d in [self.downloads_dir(), self.tools_dir(), self.backups_dir(), self.packs_dir(), self.cursors_dir()] {
            let _ = std::fs::create_dir_all(d);
        }
        self
    }

    pub fn downloads_dir(&self) -> PathBuf {
        self.user_data.join("downloads")
    }
    pub fn tools_dir(&self) -> PathBuf {
        self.user_data.join("tools")
    }
    pub fn backups_dir(&self) -> PathBuf {
        self.user_data.join("backups")
    }
    pub fn packs_dir(&self) -> PathBuf {
        self.user_data.join("packs")
    }
    pub fn cursors_dir(&self) -> PathBuf {
        self.user_data.join("cursors")
    }

    fn game_set(&self) -> Option<&PathBuf> {
        self.game.as_ref().filter(|g| !g.as_os_str().is_empty())
    }

    /// There is a game to install into, or there is nothing to do: a wrong path must not be
    /// built into a whole tree and filled.
    pub fn require_game_folder(&self) -> Result<PathBuf, String> {
        let game = self.game_set().ok_or_else(|| t("Путь к Dota 2 не задан", &[]))?;
        if !validate_game_path(game) {
            return Err(t("По сохранённому пути нет файлов Dota 2 — укажи папку игры заново в настройках", &[]));
        }
        Ok(game.clone())
    }

    /// Called before writing into the folder (src/gamelang.ts lays down English's layer file).
    pub fn ensure_lang_folder(&self) -> Result<PathBuf, String> {
        crate::gamelang::ensure_lang_folder(&self.require_game_folder()?, &self.lang_suffix).map_err(|e| e.to_string())
    }

    /// The folder a record's files are relative to.
    pub fn root_abs(&self, root: &str) -> Result<PathBuf, String> {
        let game = self.game_set().cloned().unwrap_or_default();
        let under = |sub: &[&str]| sub.iter().fold(game.clone(), |p, s| p.join(s));
        match root {
            "lang" => self.lang_folder(),
            "fonts" => Ok(under(&crate::installer_folder::FONTS_SUBDIR)),
            "cursor" => Ok(under(&crate::installer_folder::CURSOR_SUBDIR)),
            "tools" => Ok(self.tools_dir()),
            other => Err(t("Неизвестный root: {0}", &[serde_json::json!(other)])),
        }
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

/// A folder holds the game: its own pak01, or its executable. A run held to a sandbox knows
/// no game outside it (src/write-jail.ts).
pub fn validate_game_path(p: &Path) -> bool {
    if p.as_os_str().is_empty() || !crate::write_jail::inside(p) {
        return false;
    }
    p.join("dota").join("pak01_dir.vpk").exists()
        || p.join("bin").join("win64").join("dota2.exe").exists()
        || p.join("bin").join("linuxsteamrt64").join("dota2").exists()
}

/// A path with a suffix added to its file name.
pub fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}
