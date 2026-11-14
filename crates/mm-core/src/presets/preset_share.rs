//! Shareable preset files (src/preset-share.ts): a .d2mm is a zip holding preset.json plus the
//! VPK of every mod the receiver cannot fetch for itself. A catalog mod travels as its identity
//! (category, name, style) with a fingerprint, a free cosmetic pick as its slot and item, and
//! only a user's own import as bytes.
//!
//! The file arrives from a stranger over Discord: nothing is read out of the zip that the
//! manifest did not ask for by an exact, pattern-checked name, and the caller installs only after
//! showing the user the contents.

use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::js::slice_utf16;
use crate::safe_zip::{OpenedZip, Source};

/// What preset.json says it is, so a stray zip is not taken for a preset.
pub const FORMAT: &str = "dota2-mod-manager/preset";
/// The newest format this build writes and can read.
pub const VERSION: u32 = 1;
const MANIFEST_NAME: &str = "preset.json";
/// a manifest is KBs; a megabyte is already absurd
const MAX_MANIFEST_BYTES: u64 = 1 << 20;
/// More mods than anybody has; a list longer than this is refused before it is read.
pub const MAX_MODS: usize = 500;

fn mod_file_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^mods/[A-Za-z0-9_-]{1,64}\.vpk$").unwrap())
}

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| slice_utf16(s, max)).unwrap_or_default()
}

fn or_null(s: String) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        Value::String(s)
    }
}

/// `Number.isFinite`: a number, and not one JSON could not have held anyway.
fn finite(v: Option<&Value>) -> Option<Value> {
    v.filter(|v| v.as_f64().is_some_and(f64::is_finite)).cloned()
}

/// One mod line of the manifest. Unknown kinds and lines missing what their kind needs are
/// dropped rather than half-trusted.
fn normalize_entry(raw: &Value, allow_pack: bool) -> Option<Value> {
    if !(raw.is_object() || raw.is_array()) {
        return None;
    }
    let name = text(raw.get("name"), 300);
    if name.is_empty() {
        return None;
    }
    let kind = raw.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "catalog" => {
            let category = text(raw.get("categoryId"), 60);
            if category.is_empty() {
                return None;
            }
            Some(json!({ "kind": "catalog", "categoryId": category, "name": name,
                "styleLabel": or_null(text(raw.get("styleLabel"), 300)), "fp": or_null(text(raw.get("fp"), 64)) }))
        }
        "embedded" => {
            let file = text(raw.get("file"), 128);
            if !mod_file_re().is_match(&file) {
                return None;
            }
            let category = text(raw.get("categoryId"), 60);
            Some(json!({ "kind": "embedded", "name": name, "file": file,
                "categoryId": if category.is_empty() { "imported".to_string() } else { category },
                "size": finite(raw.get("size")).unwrap_or(json!(0)), "fp": or_null(text(raw.get("fp"), 64)),
                "info": text(raw.get("info"), 300) }))
        }
        // a free cosmetic pick: slot and item id from the sender's game table, no bytes at all
        "cosmetic" => {
            let slot = text(raw.get("slot"), 60);
            let item = text(raw.get("itemId"), 20);
            if slot.is_empty() || item.is_empty() {
                return None;
            }
            Some(
                json!({ "kind": "cosmetic", "name": name, "slot": slot, "itemId": item, "effectId": text(raw.get("effectId"), 60) }),
            )
        }
        "pack" if allow_pack => {
            let members: Vec<Value> = raw
                .get("members")
                .and_then(Value::as_array)
                .map(|m| m.iter().filter_map(|m| normalize_entry(m, false)).collect())
                .unwrap_or_default();
            Some(json!({ "kind": "pack", "name": name, "members": members }))
        }
        // the sender knowingly left this one out: carried so the receiver sees what is absent
        "missing" => Some(json!({ "kind": "missing", "name": name, "reason": text(raw.get("reason"), 300) })),
        _ => None,
    }
}

/// preset.json checked field by field: what fails is refused, what is unknown is dropped.
pub fn validate_manifest(raw: &Value) -> Result<Value, String> {
    if !(raw.is_object() || raw.is_array()) {
        return Err(t("preset.json повреждён", &[]));
    }
    if raw.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(t("Это не файл пресета Mod Manager", &[]));
    }
    let version = raw.get("version").cloned();
    // `version <= VERSION` as JavaScript compares it: a missing one is NaN and is refused
    let le = version.as_ref().is_some_and(|v| crate::js::to_number(v) <= VERSION as f64);
    if !le {
        return Err(t("Файл собран более новой версией приложения", &[]));
    }
    let Some(mods) = raw.get("mods").and_then(Value::as_array) else {
        return Err(t("preset.json повреждён", &[]));
    };
    if mods.len() > MAX_MODS {
        return Err(t("Слишком много модов в пресете", &[]));
    }
    let mods: Vec<Value> = mods.iter().filter_map(|m| normalize_entry(m, true)).collect();
    let name = text(raw.get("name"), 120);
    let author = raw.get("author").filter(|a| a.is_object() || a.is_array()).and_then(|a| a.get("name"));
    Ok(json!({
        "format": FORMAT,
        "version": version,
        "name": if name.is_empty() { t("Пресет", &[]) } else { name },
        "note": text(raw.get("note"), 600),
        "author": text(author, 80),
        "createdAt": finite(raw.get("createdAt")),
        "app": text(raw.get("app"), 20),
        "catalogFetchedAt": finite(raw.get("catalogFetchedAt")),
        "mods": mods,
    }))
}

/// A line to write: an embedded mod carries its bytes, and they go into the zip in its place.
pub struct EntryToWrite {
    pub line: Map<String, Value>,
    pub data: Option<Vec<u8>>,
    pub members: Vec<EntryToWrite>,
}

/// Write a .d2mm: the manifest (everything but `mods`) and the bytes of every embedded mod.
/// The path, the size on disk and the lines as written.
pub fn write_preset_file(
    out_path: &Path,
    manifest: &Map<String, Value>,
    entries: Vec<EntryToWrite>,
    now_ms: f64,
) -> Result<(u64, Vec<Value>), String> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut place = |e: EntryToWrite| -> Value {
        let mut line = e.line;
        if line.get("kind").and_then(Value::as_str) == Some("embedded") {
            let file = format!("mods/{:03}.vpk", files.len());
            let data = e.data.unwrap_or_default();
            line.shift_remove("data");
            line.insert("file".into(), json!(file));
            line.insert("size".into(), json!(data.len()));
            files.push((file, data));
        }
        Value::Object(line)
    };
    let mut mods = Vec::new();
    for e in entries {
        if e.line.get("kind").and_then(Value::as_str) == Some("pack") {
            let mut line = e.line;
            let members: Vec<Value> = e.members.into_iter().map(&mut place).collect();
            line.insert("members".into(), Value::Array(members));
            mods.push(Value::Object(line));
        } else {
            mods.push(place(e));
        }
    }
    let mut full = Map::new();
    full.insert("format".into(), json!(FORMAT));
    full.insert("version".into(), json!(VERSION));
    full.insert("createdAt".into(), crate::js::json_number(now_ms));
    for (k, v) in manifest {
        full.insert(k.clone(), v.clone());
    }
    full.insert("mods".into(), Value::Array(mods.clone()));
    files.push((MANIFEST_NAME.into(), crate::js::stringify(&Value::Object(full), "  ").into_bytes()));
    let zip = crate::safe_zip::write_zip(&files)?;
    std::fs::write(out_path, &zip).map_err(|e| e.to_string())?;
    Ok((zip.len() as u64, mods))
}

/// A .d2mm opened and checked: its manifest, and its embedded mods read on demand by name.
pub struct PresetFile {
    pub manifest: Value,
    archive: OpenedZip,
}

impl PresetFile {
    /// Parse and validate a .d2mm. An embedded line whose bytes are not in the zip becomes a
    /// "missing" line, so one broken entry costs its own mod and not the whole preset.
    pub fn open(file_path: &Path) -> Result<PresetFile, String> {
        let mut archive = OpenedZip::open(Source::File(file_path), None, None).map_err(|e| {
            if std::fs::metadata(file_path).is_err() {
                t("Файл не открывается как пресет", &[])
            } else {
                e
            }
        })?;
        let head = archive.get(MANIFEST_NAME).ok_or_else(|| t("Это не файл пресета Mod Manager", &[]))?;
        let broken = || t("preset.json повреждён", &[]);
        if head.size > MAX_MANIFEST_BYTES {
            return Err(broken());
        }
        let bytes = archive.read(&head).map_err(|_| broken())?;
        let raw: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|_| broken())?;
        let mut manifest = validate_manifest(&raw)?;
        let present: std::collections::HashSet<String> = archive.files.iter().map(|f| f.path.clone()).collect();
        let check = |e: &Value| -> Value {
            let gone = e["kind"] == "embedded" && !e["file"].as_str().is_some_and(|f| present.contains(f));
            if gone {
                json!({ "kind": "missing", "name": e["name"], "reason": t("файла нет в архиве", &[]) })
            } else {
                e.clone()
            }
        };
        let mods: Vec<Value> = manifest["mods"]
            .as_array()
            .map(|m| {
                m.iter()
                    .map(|e| {
                        if e["kind"] == "pack" {
                            let mut p = e.clone();
                            p["members"] = Value::Array(
                                e["members"].as_array().map(|m| m.iter().map(check).collect()).unwrap_or_default(),
                            );
                            p
                        } else {
                            check(e)
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        manifest["mods"] = Value::Array(mods);
        Ok(PresetFile { manifest, archive })
    }

    /// One embedded mod's bytes, by the exact name the manifest gave it.
    pub fn read_mod(&mut self, file: &str) -> Result<Vec<u8>, String> {
        if !mod_file_re().is_match(file) {
            return Err(t("Недопустимое имя файла в архиве", &[]));
        }
        let entry = self.archive.get(file).ok_or_else(|| t("файла нет в архиве", &[]))?;
        self.archive.read(&entry)
    }
}
