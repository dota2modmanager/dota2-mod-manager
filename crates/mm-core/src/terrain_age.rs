//! Terrains that replace the whole map, and whether the game's own map has moved on since
//! (src/terrain-age.ts, issue #122). A whole-map terrain installs as <language>/maps/dota.vpk and
//! is Valve's map as it was the day it was built; the date its file carries in the archive stands
//! in for that build. A terrain built before the game's current map is marked, and switched off
//! once when the game's map changes.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{Duration, LocalResult, NaiveDate, TimeZone};
use serde_json::{json, Value};

use crate::overlays::{files_of, LibFile};

const MAP_REL: &str = "maps/dota.vpk";
/// A zip keeps the packer's local time in no named zone; a day either way covers every zone.
const MARGIN_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
/// The end of a zip holds its table of contents; this much reaches it behind a long comment.
pub const TAIL_BYTES: u64 = 64 * 1024;

fn map_in_archive(name: &str) -> bool {
    let low = name.to_lowercase();
    low == MAP_REL || low.ends_with("/maps/dota.vpk")
}

/// The record's map file, when the record is a whole-map terrain.
fn map_file_of(rec: &Value) -> Option<LibFile> {
    files_of(rec.get("files").unwrap_or(&Value::Null))
        .into_iter()
        .find(|f| f.root == "lang" && f.rel_path.to_lowercase() == MAP_REL)
}

/// The file's modified time in milliseconds, as Node's `mtimeMs` has it.
pub fn mtime_ms(p: &Path) -> Option<f64> {
    let t = fs::metadata(p).ok()?.modified().ok()?;
    // sec * 1e3 + nsec / 1e6, the way Node works mtimeMs out
    let ms = |d: std::time::Duration| d.as_secs() as f64 * 1e3 + f64::from(d.subsec_nanos()) / 1e6;
    Some(match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => ms(d),
        Err(e) => -ms(e.duration()),
    })
}

/// When Steam last wrote the game's own map, or None with no game or no map.
pub fn game_map_time(game: Option<&Path>) -> Option<f64> {
    mtime_ms(&game?.join("dota").join("maps").join("dota.vpk"))
}

/// A DOS date and time, read as local time the way `new Date(y, m, d, h, mi, s)` reads it:
/// out-of-range parts roll over into the next unit.
fn from_dos(date: u16, time: u16) -> Option<f64> {
    let year = i32::from((date >> 9) & 0x7f) + 1980;
    let month0 = (i32::from((date >> 5) & 0x0f) - 1).max(0);
    let day = i64::from((date & 0x1f).max(1));
    let (h, mi, s) = (i64::from((time >> 11) & 0x1f), i64::from((time >> 5) & 0x3f), i64::from(time & 0x1f) * 2);
    let first = NaiveDate::from_ymd_opt(year + month0 / 12, (month0 % 12) as u32 + 1, 1)?;
    let at = first.and_hms_opt(0, 0, 0)?
        + Duration::days(day - 1)
        + Duration::hours(h)
        + Duration::minutes(mi)
        + Duration::seconds(s);
    let local = match chrono::Local.from_local_datetime(&at) {
        LocalResult::Single(t) => t,
        LocalResult::Ambiguous(early, _) => early,
        // a time the clocks skipped: read with the offset from before the change, as V8 does
        LocalResult::None => match chrono::Local.from_local_datetime(&(at - Duration::hours(1))) {
            LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t + Duration::hours(1),
            LocalResult::None => return None,
        },
    };
    Some(local.timestamp_millis() as f64)
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

/// When the map inside a zip was packed, from the table of contents at its end: `buf` may be the
/// whole archive or only its last bytes. None with no map in it or bytes that are not a zip.
pub fn map_time_in_zip(buf: &[u8]) -> Option<f64> {
    if buf.len() < 22 {
        return None;
    }
    let end = (0..=buf.len() - 22).rev().find(|&i| u32_at(buf, i) == 0x0605_4b50)?;
    let size = u32_at(buf, end + 12) as usize;
    let mut at = end.checked_sub(size)?;
    while at + 46 <= end && u32_at(buf, at) == 0x0201_4b50 {
        let (time, date) = (u16_at(buf, at + 12), u16_at(buf, at + 14));
        let name_len = u16_at(buf, at + 28) as usize;
        let extra_len = u16_at(buf, at + 30) as usize;
        let comment_len = u16_at(buf, at + 32) as usize;
        let name_end = (at + 46 + name_len).min(buf.len());
        let name = String::from_utf8_lossy(&buf[at + 46..name_end]).replace('\\', "/");
        if map_in_archive(&name) {
            return from_dos(date, time);
        }
        at += 46 + name_len + extra_len + comment_len;
    }
    None
}

/// The same, for an archive on disk: only its tail is read.
pub fn map_time_in_archive(file: &Path) -> Option<f64> {
    let mut f = fs::File::open(file).ok()?;
    let size = f.metadata().ok()?.len();
    let len = size.min(TAIL_BYTES);
    f.seek(SeekFrom::Start(size - len)).ok()?;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf).ok()?;
    map_time_in_zip(&buf)
}

fn finite(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite())
}

/// Built for a map older than the one the game has. Unknown either way is not old.
pub fn is_stale(built_at: Option<f64>, map_at: Option<f64>) -> bool {
    matches!((built_at, map_at), (Some(b), Some(m)) if b.is_finite() && m.is_finite() && b < m - MARGIN_MS)
}

/// When a terrain was built and whether that is too old.
#[derive(Debug, Clone, PartialEq)]
pub struct Age {
    pub built_at: Option<f64>,
    pub stale: bool,
}

/// The last bytes of a catalog archive (category, file), for a terrain nobody downloaded yet.
pub type FetchTail<'a> = dyn FnMut(&str, &str) -> Result<Option<Vec<u8>>, String> + 'a;

pub struct TerrainAges {
    pub downloads_dir: Option<PathBuf>,
    pub game: Option<PathBuf>,
    pub store_file: Option<PathBuf>,
}

impl TerrainAges {
    fn load(&self) -> serde_json::Map<String, Value> {
        self.store_file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    }

    fn save(&self, s: &serde_json::Map<String, Value>) {
        if let Some(f) = &self.store_file {
            // next time, if it does not go now
            let _ = fs::write(f, crate::js::stringify(&Value::Object(s.clone()), " "));
        }
    }

    fn map_at(&self) -> Option<f64> {
        game_map_time(self.game.as_deref())
    }

    /// When a record's map was built: what the record says, or its archive in the download cache.
    pub fn built_at_of(&self, rec: &Value) -> Option<f64> {
        map_file_of(rec)?;
        if let Some(n) = rec.get("mapBuiltAt").and_then(finite) {
            return Some(n);
        }
        let dir = self.downloads_dir.as_ref()?;
        let file_ref = rec.get("fileRef").filter(|v| crate::js::truthy(v)).map(crate::js::string)?;
        if file_ref.contains(['/', '\\']) {
            return None;
        }
        let cat = rec.get("categoryId").filter(|v| crate::js::truthy(v)).map(crate::js::string).unwrap_or_default();
        map_time_in_archive(&dir.join(cat).join(file_ref))
    }

    /// For each whole-map terrain in the list, by record id.
    pub fn for_records(&self, records: &[Value]) -> indexmap::IndexMap<String, Age> {
        let map_at = self.map_at();
        let mut out = indexmap::IndexMap::new();
        for rec in records {
            if map_file_of(rec).is_none() {
                continue;
            }
            let built_at = self.built_at_of(rec);
            let id = rec.get("id").map(crate::js::string).unwrap_or_default();
            out.insert(id, Age { built_at, stale: is_stale(built_at, map_at) });
        }
        out
    }

    /// Switch off the whole-map terrains older than the game's map, once per map. The names.
    pub fn switch_off_stale(&self, records: &[Value], switch_off: &mut dyn FnMut(&Value)) -> Vec<String> {
        let Some(map_at) = self.map_at().filter(|m| m.is_finite()) else { return Vec::new() };
        let mut store = self.load();
        if store.get("mapSeen").and_then(Value::as_f64) == Some(map_at) {
            return Vec::new();
        }
        let mut names = Vec::new();
        for rec in records {
            if rec.get("enabled") == Some(&Value::Bool(false))
                || map_file_of(rec).is_none()
                || !is_stale(self.built_at_of(rec), Some(map_at))
            {
                continue;
            }
            switch_off(rec);
            names.push(rec.get("name").map(crate::js::string).unwrap_or_default());
        }
        store.insert("mapSeen".into(), json!(map_at));
        self.save(&store);
        names
    }

    /// When each whole-map terrain in the catalog was built, by file name, and which are older
    /// than the game's map; kept by the archive's published hash, so a terrain is asked about
    /// again only when its author replaces it. `fetch_tail` reads an archive's last bytes.
    pub fn for_catalog(
        &self,
        terrains: &[Value],
        hash_of: &dyn Fn(&str) -> Option<String>,
        fetch_tail: &mut FetchTail,
    ) -> Value {
        let store = self.load();
        let mut known = store.get("catalog").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut ages: indexmap::IndexMap<String, Option<f64>> = indexmap::IndexMap::new();
        let mut changed = false;
        for m in terrains {
            let file = m.get("file").filter(|v| crate::js::truthy(v)).map(crate::js::string).unwrap_or_default();
            if !file.to_lowercase().ends_with(".zip") {
                continue;
            }
            let hash = hash_of(&file).filter(|h| !h.is_empty()).unwrap_or_else(|| format!("name:{file}"));
            if let Some(k) = known.get(&file).filter(|k| k.get("hash").and_then(Value::as_str) == Some(hash.as_str())) {
                ages.insert(file, k.get("builtAt").and_then(Value::as_f64));
                continue;
            }
            let built_at = match fetch_tail("terrains", &file) {
                Ok(Some(b)) => map_time_in_zip(&b),
                _ => None,
            };
            known.insert(file.clone(), json!({ "hash": hash, "builtAt": built_at }));
            ages.insert(file, built_at);
            changed = true;
        }
        if changed {
            let mut now = self.load();
            now.insert("catalog".into(), Value::Object(known));
            self.save(&now);
        }
        let map_at = self.map_at();
        let stale: serde_json::Map<String, Value> =
            ages.iter().filter(|(_, b)| is_stale(**b, map_at)).map(|(f, _)| (f.clone(), Value::Bool(true))).collect();
        json!({ "mapAt": map_at, "ages": ages, "stale": stale })
    }
}
