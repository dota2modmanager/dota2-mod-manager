//! Whether the game's pak01 changed: a listing of its files' stats, which the app asks for before it
//! trusts anything it keeps of the game (the item table, the pictures, the 3D models). Replacing
//! src/pak-stamp.ts.
//!
//! The game has 679 pak01 files, and a stat of each is 20 to 80 ms when the disk is busy. An update
//! rewrites pak01_dir.vpk, which indexes every other pak, so while it stands as it was the others do
//! too, and the listing made with it is kept.

use std::collections::HashMap;
use std::fs::Metadata;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

fn is_pak01(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let Some(mid) = n.strip_prefix("pak01_").and_then(|r| r.strip_suffix(".vpk")) else { return false };
    mid == "dir" || (mid.len() == 3 && mid.bytes().all(|c| c.is_ascii_digit()))
}

/// Each of the game's pak01 files, as `describe` puts its stat, in name order. `kind`: which
/// listing; each `describe` keeps its own. Fails when pak01_dir.vpk or the folder cannot be read.
pub fn pak_files(game_path: &Path, kind: &str, describe: &dyn Fn(&Metadata) -> String) -> std::io::Result<String> {
    static LISTINGS: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();
    let dir = game_path.join("dota");
    let head = describe(&std::fs::metadata(dir.join("pak01_dir.vpk"))?);
    let key = format!("{kind}|{}", dir.display());
    let listings = LISTINGS.get_or_init(Default::default);
    if let Some((h, value)) = listings.lock().unwrap().get(&key) {
        if *h == head {
            return Ok(value.clone());
        }
    }
    let mut parts = Vec::new();
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if !is_pak01(&name) {
            continue;
        }
        parts.push(format!("{name}:{}", describe(&std::fs::metadata(dir.join(&name))?)));
    }
    // JavaScript's sort: by UTF-16 code units
    parts.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let value = parts.join("|");
    listings.lock().unwrap().insert(key, (head, value.clone()));
    Ok(value)
}

/// A file's size and its modification time in whole milliseconds, as `${size}:${floor(mtimeMs)}`.
pub fn size_and_time(st: &Metadata) -> String {
    let ms = st.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis());
    format!("{}:{ms}", st.len())
}

/// Cheap "did the game update?" probe: size and mtime of the paks that carry the schema.
pub fn game_schema_stamp(game_path: &Path) -> std::io::Result<String> {
    pak_files(game_path, "stamp", &size_and_time)
}
