//! Packing a folder of loose game files into a mod, replacing src/vpk-pack.ts: where the content
//! starts under the folder an author points at, and one self-contained VPK of everything under it.

use std::fs;
use std::path::{Path, PathBuf};

use crate::i18n::t;
use crate::vpk::{build, entry_at, Entry};

/// The folders the game itself mounts: the directory holding one of them is the archive's root.
const GAME_ROOTS: [&str; 12] = [
    "models",
    "materials",
    "particles",
    "panorama",
    "sounds",
    "soundevents",
    "scripts",
    "resource",
    "maps",
    "vscripts",
    "shaders",
    "expressions",
];

/// Not content, and not something an author means to ship.
fn junk(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "thumbs.db" | "desktop.ini" | ".ds_store" | ".git" | ".gitignore" | ".svn" | "__macosx"
    )
}

/// One buffer holds the whole archive while it is built: a folder past this is refused.
const MAX_FOLDER_BYTES: usize = 1024 * 1024 * 1024;

/// Where the mod's content starts under `dir`: the directory that holds the game's own folders,
/// followed down through wrappers. None when nothing game-shaped is under there.
pub fn find_content_root(dir: &Path, depth: usize) -> Option<PathBuf> {
    if depth > 6 {
        return None;
    }
    let dirs: Vec<String> = fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !junk(n))
        .collect();
    if dirs.iter().any(|n| GAME_ROOTS.contains(&n.to_lowercase().as_str())) {
        return Some(dir.to_path_buf());
    }
    dirs.iter().find_map(|n| find_content_root(&dir.join(n), depth + 1))
}

/// A folder of loose game files packed into a single self-contained VPK.
pub fn pack_folder(root: &Path) -> Result<Vec<u8>, String> {
    fn walk(dir: &Path, prefix: &str, entries: &mut Vec<Entry>, total: &mut usize) -> Result<(), String> {
        let Ok(names) = fs::read_dir(dir) else { return Ok(()) };
        for e in names.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(kind) = e.file_type() else { continue };
            // a symlink is somebody else's file, and following one can walk in a circle
            if junk(&name) || kind.is_symlink() {
                continue;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if kind.is_dir() {
                walk(&e.path(), &rel, entries, total)?;
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let Ok(data) = fs::read(e.path()) else { continue };
            *total += data.len();
            if *total > MAX_FOLDER_BYTES {
                return Err(t("Папка слишком большая, чтобы собрать её в один VPK", &[]));
            }
            entries.push(entry_at(&rel, data.into()));
        }
        Ok(())
    }
    let mut entries = Vec::new();
    walk(root, "", &mut entries, &mut 0)?;
    if entries.is_empty() {
        return Err(t("В папке нет файлов", &[]));
    }
    Ok(build(&entries))
}
