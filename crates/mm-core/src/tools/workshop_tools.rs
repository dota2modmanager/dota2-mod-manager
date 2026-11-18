//! A copy of the Workshop Tools kept in userData, for a Linux machine that plays the Linux build
//! (src/workshop-tools.ts).
//!
//! On Linux the tools come only with the Windows build of Dota, which Steam installs while the
//! game is forced through Proton and takes away again with the Linux build. So the first time the
//! app sees them in the game it copies what only the Windows build has (game/bin, and in game/dota
//! and game/core their bin/win64, the DX11 shaders, the .fgd files and the tools' asset list), and
//! links every other entry of game/dota and game/core to the user's game. The compiler finds the
//! game through its own place two folders up from win64, so the copy runs as an install of its own.
//!
//! It is copied into a folder of its own and renamed into place once whole, copied again when the
//! game's tools change, and once deleted from Settings not copied again until they do. A copy is
//! minutes of disk work: the shell runs `keep` off the main thread, one at a time.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::resource_compiler::{compiler_in, install_of};

/// What kept.json says of the copy: the tools it was copied from, its size, and its layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeptInfo {
    pub from: String,
    pub stamp: String,
    pub bytes: f64,
    pub at: f64,
    pub layout: f64,
}

/// How the copy is laid out: a copy of an older layout is not run, and is made again.
const LAYOUT: f64 = 3.0;

/// The game's folders the compiler reads, each part copied and the rest linked.
const MODS: [&str; 2] = ["dota", "core"];

/// Whether a file of game/dota or game/core, by its path inside it, is the Windows build's alone.
pub fn windows_only(rel: &str) -> bool {
    let p = rel.replace(std::path::MAIN_SEPARATOR, "/");
    let lower = p.to_lowercase();
    p.starts_with("bin/win64/")
        || (lower.starts_with("shaders_pc_") && !p.contains('/'))
        || lower.ends_with(".fgd")
        || p == "readonly_tools_asset_info.bin"
}

/// The game's tools as they are now: a copy is of these when the stamp matches.
fn stamp_of(exe: &Path) -> Option<String> {
    let st = std::fs::metadata(exe).ok()?;
    let ms = crate::terrain_age::mtime_ms(exe)?;
    Some(format!("{}|{}", st.len(), crate::js::number(ms)))
}

fn read_json<T: for<'de> Deserialize<'de>>(file: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// Every file under a folder, as paths relative to it (with the system's separator).
fn files_under(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = crate::js::read_dir(dir) else { return };
        for e in rd {
            let p = e.path();
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                walk(&p, base, out);
            } else if let Ok(rel) = p.strip_prefix(base) {
                out.push(rel.to_path_buf());
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out
}

/// What to copy of a game folder of the Windows build, as paths relative to game/.
pub fn windows_files(game: &Path) -> Vec<PathBuf> {
    let bin = game.join("bin");
    let mut out: Vec<PathBuf> = crate::js::read_dir(&bin)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| Path::new("bin").join(e.file_name()))
        .collect();
    out.extend(files_under(&bin.join("win64")).into_iter().map(|f| Path::new("bin").join("win64").join(f)));
    for m in MODS {
        out.extend(
            files_under(&game.join(m))
                .into_iter()
                .filter(|f| windows_only(&f.to_string_lossy()))
                .map(|f| Path::new(m).join(f)),
        );
    }
    out
}

fn symlink(target: &Path, at: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, at)
    }
    #[cfg(windows)]
    {
        if target.is_dir() {
            std::os::windows::fs::symlink_dir(target, at)
        } else {
            std::os::windows::fs::symlink_file(target, at)
        }
    }
}

fn remove_link(at: &Path) -> std::io::Result<()> {
    std::fs::remove_file(at).or_else(|_| std::fs::remove_dir(at))
}

/// The copy's game/dota or game/core: a real folder holding what was copied, and a link for every
/// other entry of the game's, made again on each use. Into a folder the copy has of its own it goes
/// down and does the same; what was copied is never touched.
fn mirror(real: &Path, copy: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(copy)?;
    let names = crate::js::dir_names(real);
    for name in &names {
        let at = copy.join(name);
        let target = real.join(name);
        let st = std::fs::symlink_metadata(&at).ok();
        if let Some(st) = &st {
            if !st.file_type().is_symlink() {
                if st.is_dir() && std::fs::symlink_metadata(&target)?.is_dir() {
                    mirror(&target, &at)?;
                }
                continue;
            }
            if std::fs::read_link(&at).ok().as_deref() == Some(target.as_path()) {
                continue;
            }
            remove_link(&at)?;
        }
        symlink(&target, &at)?;
    }
    // a link to anything but this entry of the game as it is now goes
    for name in crate::js::dir_names(copy) {
        let at = copy.join(&name);
        let link = std::fs::symlink_metadata(&at).is_ok_and(|m| m.file_type().is_symlink());
        if link && (!names.contains(&name) || std::fs::read_link(&at).ok() != Some(real.join(&name))) {
            remove_link(&at)?;
        }
    }
    Ok(())
}

/// The copy, as the compiler and Settings take it.
pub struct ToolsKeeper {
    /// where the copy is kept (userData/workshop-tools)
    pub dir: PathBuf,
    pub game: Option<PathBuf>,
}

impl ToolsKeeper {
    pub fn new(dir: &Path, game: Option<PathBuf>) -> Self {
        ToolsKeeper { dir: dir.to_path_buf(), game }
    }

    fn record(&self) -> PathBuf {
        self.dir.join("kept.json")
    }

    fn declined_file(&self) -> PathBuf {
        self.dir.join("declined.json")
    }

    fn tree(&self) -> PathBuf {
        self.dir.join("tree")
    }

    fn exe_in(root: &Path) -> PathBuf {
        compiler_in(&root.join("game"))
    }

    /// The game's own compiler and its stamp, when the game has the tools.
    fn game_tools(&self) -> Option<(PathBuf, String)> {
        let exe = compiler_in(self.game.as_ref()?);
        install_of(Some(&exe))?;
        let stamp = stamp_of(&exe)?;
        Some((exe, stamp))
    }

    fn link(root: &Path, game: &Path) -> std::io::Result<()> {
        for m in MODS {
            mirror(&game.join(m), &root.join("game").join(m))?;
        }
        Ok(())
    }

    /// The copy's record, when it is of this layout and its compiler is there.
    pub fn info(&self) -> Option<KeptInfo> {
        let kept: KeptInfo = read_json(&self.record())?;
        (kept.layout == LAYOUT && Self::exe_in(&self.tree()).exists()).then_some(kept)
    }

    /// The copy's compiler and its install, linked to the game in Settings; None when there is none.
    pub fn usable(&self, log: &mut dyn FnMut(String)) -> Option<(PathBuf, PathBuf)> {
        let game = self.game.as_ref()?;
        self.info()?;
        if let Err(e) = Self::link(&self.tree(), game) {
            log(format!("workshop tools: the copy could not be linked to {}: {e}", game.display()));
            return None;
        }
        let exe = Self::exe_in(&self.tree());
        let install = install_of(Some(&exe))?;
        Some((exe, install))
    }

    /// Whether the game has tools the copy is not of: a copy can be made, or made again.
    pub fn keepable(&self) -> bool {
        self.game_tools().is_some_and(|(_, stamp)| Some(stamp) != self.info().map(|k| k.stamp))
    }

    /// keepable, and the user has not said no to these tools.
    pub fn wanted(&self) -> bool {
        let declined = read_json::<serde_json::Value>(&self.declined_file())
            .and_then(|v| v.get("stamp").and_then(|s| s.as_str()).map(str::to_string));
        self.keepable() && declined != self.game_tools().map(|t| t.1)
    }

    /// Copy the game's tools here when they are new to the copy; whether it copied.
    pub fn keep(
        &self,
        force: bool,
        on_step: &mut dyn FnMut(usize, usize),
        log: &mut dyn FnMut(String),
    ) -> Result<bool, String> {
        if !force && !self.wanted() {
            return Ok(false);
        }
        let (Some((exe, stamp)), Some(game)) = (self.game_tools(), self.game.as_ref()) else { return Ok(false) };
        let files = windows_files(game);
        let part = PathBuf::from(format!("{}.part", self.tree().display()));
        let _ = std::fs::remove_dir_all(&part);
        let mut bytes = 0u64;
        let copied = (|| -> Result<(), String> {
            let io = |e: std::io::Error| e.to_string();
            for (i, f) in files.iter().enumerate() {
                let to = part.join("game").join(f);
                std::fs::create_dir_all(to.parent().unwrap_or(&part)).map_err(io)?;
                bytes += std::fs::copy(game.join(f), &to).map_err(io)?;
                on_step(i + 1, files.len());
            }
            for d in ["content/dota_addons", "game/dota_addons"] {
                std::fs::create_dir_all(part.join(d)).map_err(io)?;
            }
            Self::link(&part, game).map_err(io)?;
            // the game's tools may have changed under the copy: copied again next time
            if stamp_of(&exe).as_deref() != Some(stamp.as_str()) {
                return Err("the game's tools changed while they were copied".into());
            }
            let _ = std::fs::remove_dir_all(self.tree());
            std::fs::rename(&part, self.tree()).map_err(io)
        })();
        if let Err(e) = copied {
            let _ = std::fs::remove_dir_all(&part);
            return Err(e);
        }
        let kept = KeptInfo {
            from: exe.to_string_lossy().into_owned(),
            stamp,
            bytes: bytes as f64,
            at: crate::library::now(),
            layout: LAYOUT,
        };
        let text = json!({
            "from": kept.from, "stamp": kept.stamp, "bytes": crate::js::json_number(kept.bytes),
            "at": crate::js::json_number(kept.at), "layout": crate::js::json_number(LAYOUT),
        });
        std::fs::write(self.record(), text.to_string()).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(self.declined_file());
        log(format!(
            "workshop tools: kept a copy of {} files, {} MB, from {}",
            files.len(),
            crate::js::to_fixed(bytes as f64 / 1048576.0, 0),
            game.display()
        ));
        Ok(true)
    }

    /// Deleted on the user's word, and remembered: the same tools are not copied back. Removing the
    /// tree takes the links away, not what they point at.
    pub fn remove(&self) -> Result<(), String> {
        let kept = self.info();
        let _ = std::fs::remove_dir_all(self.tree());
        let _ = std::fs::remove_file(self.record());
        if let Some(stamp) = self.game_tools().map(|t| t.1).or(kept.map(|k| k.stamp)).filter(|s| !s.is_empty()) {
            std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            std::fs::write(self.declined_file(), json!({ "stamp": stamp }).to_string()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Whether a copy is here that is not run: made in an older layout, to be made again.
    pub fn outdated(&self) -> bool {
        read_json::<serde_json::Value>(&self.record()).is_some_and(|k| {
            crate::js::truthy(&k) && k.get("layout").and_then(serde_json::Value::as_f64) != Some(LAYOUT)
        })
    }
}
