//! Which installed mods a Dota update reached (src/update-impact.ts). A note of Valve's CRC for
//! every path an installed mod replaces is taken while the game is unchanged; after an update the
//! note is compared with the new pak01 index. A mod stays marked until its own file changes or it
//! is removed.

use std::fs;
use std::path::{Path, PathBuf};

use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Map, Value};

use crate::overlays::files_of;

/// A mod as this reads it: who it is, and its index on disk.
#[derive(Debug, Clone)]
pub struct ImpactMod {
    pub id: String,
    pub name: String,
    pub dir: PathBuf,
}

/// A file as size:mtime, or None when it is not there.
fn file_sig(file: &Path) -> Option<String> {
    let st = fs::metadata(file).ok()?;
    let ms = crate::terrain_age::mtime_ms(file)?;
    Some(format!("{}:{}", st.len(), (ms + 0.5).floor() as i64))
}

/// Every record with a pak of its own in the language folder.
pub fn impact_mods(records: &[Value], file_on_disk: &dyn Fn(&str) -> PathBuf) -> Vec<ImpactMod> {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = R.get_or_init(|| regex::Regex::new(r"(?i)_dir.vpk$").unwrap());
    records
        .iter()
        .filter_map(|r| {
            let dir = files_of(r.get("files").unwrap_or(&Value::Null))
                .into_iter()
                .find(|f| f.root == "lang" && re.is_match(&f.rel_path))?;
            let text = |k: &str| r.get(k).map(crate::js::string).unwrap_or_default();
            Some(ImpactMod { id: text("id"), name: text("name"), dir: file_on_disk(&dir.rel_path) })
        })
        .collect()
}

pub struct UpdateImpact {
    pub file: PathBuf,
    pub game: Option<PathBuf>,
}

fn pak_of(game: &Path) -> PathBuf {
    game.join("dota").join("pak01_dir.vpk")
}

fn crc_value(valve: &IndexMap<String, u32>, p: &str) -> Value {
    valve.get(p).map_or(Value::Null, |c| json!(c))
}

impl UpdateImpact {
    fn load(&self) -> Map<String, Value> {
        let read = fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let mut out = Map::new();
        for k in ["key", "build"] {
            out.insert(k.into(), Value::Null);
        }
        out.insert("crcs".into(), json!({}));
        out.insert("mods".into(), json!({}));
        if let Some(Value::Object(s)) = read {
            for (k, v) in s {
                out.insert(k, v);
            }
            for k in ["crcs", "mods"] {
                if !out.get(k).is_some_and(crate::js::truthy) {
                    out.insert(k.into(), json!({}));
                }
            }
        }
        out
    }

    fn save(&self, s: &Map<String, Value>) -> Result<(), String> {
        if let Some(d) = self.file.parent() {
            fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        fs::write(&self.file, serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    /// Bring the note up to date with the game on disk, and say which mods an update reached.
    pub fn check(
        &self,
        mods: &[ImpactMod],
        build: Option<String>,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let Some(game) = &self.game else { return Ok(Value::Null) };
        let mut s = self.load();
        let Some(key) = file_sig(&pak_of(game)) else { return Ok(Value::Null) };
        let now = build.map_or(Value::Null, Value::String);
        let current: Vec<(&ImpactMod, Vec<String>, String)> = mods
            .iter()
            .filter_map(|m| {
                let sig = file_sig(&m.dir)?;
                let paths = crate::vpk::read_index_file(&m.dir).and_then(|b| crate::vpk::list_paths(&b)).ok()?;
                Some((m, paths, sig))
            })
            .collect();
        let alive: IndexMap<&str, &str> = current.iter().map(|(m, _, sig)| (m.id.as_str(), sig.as_str())).collect();
        if let Some(Value::Object(marks)) = s.get_mut("mods") {
            marks.retain(|id, m| alive.get(id.as_str()).copied() == m.get("sig").and_then(Value::as_str));
        }
        let wanted: IndexSet<&str> = current.iter().flat_map(|(_, p, _)| p.iter().map(String::as_str)).collect();

        if s.get("key").and_then(Value::as_str) == Some(key.as_str()) {
            let crcs = s.get("crcs").and_then(Value::as_object).cloned().unwrap_or_default();
            let missing: Vec<&str> = wanted.iter().copied().filter(|p| !crcs.contains_key(*p)).collect();
            if !missing.is_empty() {
                let valve = self.valve(game)?;
                let mut crcs = crcs;
                for p in missing {
                    crcs.insert(p.into(), crc_value(&valve, p));
                }
                s.insert("crcs".into(), Value::Object(crcs));
            }
            self.save(&s)?;
            return Ok(Value::Null);
        }

        let valve = self.valve(game)?;
        let mut reached = Value::Null;
        if s.get("key").is_some_and(crate::js::truthy) {
            let crcs = s.get("crcs").and_then(Value::as_object).cloned().unwrap_or_default();
            let mut marks = s.get("mods").and_then(Value::as_object).cloned().unwrap_or_default();
            let mut ids: Vec<String> = Vec::new();
            for (m, paths, sig) in &current {
                let (mut changed, mut removed) = (Vec::new(), Vec::new());
                for p in paths {
                    let Some(was) = crcs.get(p) else { continue };
                    let is = crc_value(&valve, p);
                    if *was == is {
                        continue;
                    }
                    if is.is_null() {
                        removed.push(p.clone());
                    } else {
                        changed.push(p.clone());
                    }
                }
                if changed.is_empty() && removed.is_empty() {
                    continue;
                }
                ids.push(m.id.clone());
                let prev = marks.get(&m.id).cloned().unwrap_or(Value::Null);
                let merge = |k: &str, b: Vec<String>| {
                    let mut all: IndexSet<String> =
                        prev.get(k).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
                    all.extend(b);
                    let mut v: Vec<String> = all.into_iter().collect();
                    v.sort_by(|a, b| crate::js::cmp_utf16(a, b));
                    v
                };
                let since = match prev.get("since") {
                    Some(v) if !v.is_null() => v.clone(),
                    _ => now.clone(),
                };
                marks.insert(
                    m.id.clone(),
                    json!({ "since": since, "changed": merge("changed", changed), "removed": merge("removed", removed), "sig": sig }),
                );
            }
            s.insert("mods".into(), Value::Object(marks));
            if !ids.is_empty() {
                let from = s.get("build").cloned().unwrap_or(Value::Null);
                let names: Vec<&str> =
                    current.iter().filter(|(m, _, _)| ids.contains(&m.id)).map(|(m, _, _)| m.name.as_str()).collect();
                let show = |v: &Value| if crate::js::truthy(v) { crate::js::string(v) } else { "?".into() };
                log(format!(
                    "update {} -> {} reached {} mod(s): {}",
                    show(&from),
                    show(&now),
                    ids.len(),
                    names.join(", ")
                ));
                reached = json!({ "from": from, "to": now, "ids": ids });
            }
        }
        let crcs: Map<String, Value> = wanted.iter().map(|p| ((*p).to_string(), crc_value(&valve, p))).collect();
        s.insert("crcs".into(), Value::Object(crcs));
        s.insert("key".into(), Value::String(key));
        s.insert("build".into(), now);
        self.save(&s)?;
        Ok(reached)
    }

    fn valve(&self, game: &Path) -> Result<IndexMap<String, u32>, String> {
        crate::vpk::read_index_file(&pak_of(game))
            .and_then(|b| crate::vpk::list_path_crcs(&b))
            .map_err(|e| e.to_string())
    }

    /// The installed mods that are marked, by id, without reading the game.
    pub fn marked(&self, mods: &[ImpactMod]) -> IndexMap<String, Value> {
        let all = self.load().get("mods").and_then(Value::as_object).cloned().unwrap_or_default();
        mods.iter()
            .filter_map(|m| {
                let hit = all.get(&m.id)?;
                (file_sig(&m.dir).as_deref() == hit.get("sig").and_then(Value::as_str))
                    .then(|| (m.id.clone(), hit.clone()))
            })
            .collect()
    }

    /// Take one mod's mark off; whether it was marked.
    pub fn clear(&self, id: &str) -> Result<bool, String> {
        let mut s = self.load();
        let Some(Value::Object(marks)) = s.get_mut("mods") else { return Ok(false) };
        if !marks.get(id).is_some_and(crate::js::truthy) {
            return Ok(false);
        }
        marks.shift_remove(id);
        self.save(&s)?;
        Ok(true)
    }
}
