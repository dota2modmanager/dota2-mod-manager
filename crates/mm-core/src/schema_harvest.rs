//! A mod's own item tables (src/schema-harvest.ts): the blocks it changed, lifted out on install
//! and kept on its record; the whole-game tables it shipped, dropped; a pack of several heroes,
//! split into one mod per hero with the blocks about its own files; and the one-time sweep of mods
//! installed before any of this existed.

use serde_json::{json, Map, Value};

use crate::generated_pak::files_json;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::LibFile;

fn files_of(rec: &Value) -> Option<Vec<LibFile>> {
    rec.get("files").and_then(Value::as_array).map(|a| {
        a.iter()
            .map(|f| {
                let s = |k: &str| f.get(k).map(crate::js::string).unwrap_or_default();
                LibFile::new(&s("root"), &s("relPath"))
            })
            .collect()
    })
}

fn is_dir_vpk(rel: &str) -> bool {
    rel.to_lowercase().ends_with("_dir.vpk")
}

/// Lift the item blocks a freshly installed mod changed, drop the whole-game tables it shipped,
/// and remember the blocks on its record. The counts of each, or None when there was nothing.
pub fn harvest(inst: &Installer, lib: &mut Library, rec: &Value, vanilla: &[u8]) -> Option<(usize, usize)> {
    inst.game.as_ref()?;
    let mut files = files_of(rec)?;
    // repacking changes the file, and with it the fingerprint the catalog is matched by: keep the original
    let fp_before = inst.analyze_record(&files).and_then(|a| a.get("fp").filter(|f| crate::js::truthy(f)).cloned());
    let (deltas, stripped) = inst.harvest_schema(&mut files, Some(vanilla)).ok()?;
    if deltas.is_empty() && stripped.is_empty() {
        return None;
    }
    let mut fields = Map::new();
    fields.insert("files".into(), files_json(&files));
    if !deltas.is_empty() {
        fields.insert("schema".into(), json!(deltas));
    }
    if !stripped.is_empty() {
        if let Some(fp) = fp_before {
            fields.insert("fpOriginal".into(), fp);
        }
    }
    lib.update(&rec["id"], &Value::Object(fields), None).ok()?;
    Some((deltas.len(), stripped.len()))
}

/// A pack of several heroes split into one mod per hero, each with the blocks that talk about its
/// own files. The new records, or None when there was nothing to split.
pub fn split(inst: &Installer, lib: &mut Library, rec: &Value) -> Result<Option<Vec<Value>>, String> {
    let io = |e: std::io::Error| e.to_string();
    let files = files_of(rec).unwrap_or_default();
    let Some(dir) = files.iter().find(|f| f.root == "lang" && is_dir_vpk(&f.rel_path)) else { return Ok(None) };
    let Ok(parts) = inst.split_vpk_file(&dir.rel_path) else { return Ok(None) };
    if parts.is_empty() {
        return Ok(None);
    }
    let blocks: Vec<Value> = rec.get("schema").and_then(Value::as_array).cloned().unwrap_or_default();
    let file_ref = rec.get("fileRef").filter(|f| crate::js::truthy(f)).or_else(|| rec.get("name")).cloned();
    let mut added = Vec::new();
    for part in parts {
        let paths: Vec<String> = part
            .get("paths")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(crate::js::string).collect())
            .unwrap_or_default();
        let mine: Vec<Value> = blocks
            .iter()
            .filter(|b| {
                let block = crate::kv::to_latin1(&b.get("block").map(crate::js::string).unwrap_or_default());
                crate::schema_merge::block_uses_assets(&block, &paths)
            })
            .cloned()
            .collect();
        let new = json!({
            "name": part.get("name"), "categoryId": "imported", "styleLabel": null,
            "fileRef": file_ref, "preview": null, "files": part.get("files"),
        });
        let created = lib.add(&new, None).map_err(io)?;
        let mut fields = Map::new();
        fields.insert("schemaChecked".into(), Value::Bool(true));
        if !mine.is_empty() {
            fields.insert("schema".into(), Value::Array(mine));
        }
        if let Some(fp) = rec.get("fpOriginal").filter(|f| crate::js::truthy(f)) {
            fields.insert("fpOriginal".into(), fp.clone());
        }
        lib.update(&created["id"], &Value::Object(fields.clone()), None).map_err(io)?;
        let mut out = created.as_object().cloned().unwrap_or_default();
        out.extend(fields);
        added.push(Value::Object(out));
    }
    inst.remove(&files, None, true)?;
    lib.remove_record(&rec["id"], None).map_err(io)?;
    Ok(Some(added))
}

/// What the sweep did.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migrated {
    pub scanned: usize,
    pub changed: usize,
    pub deltas: usize,
    #[serde(rename = "freedMB")]
    pub freed_mb: f64,
}

/// Mods installed before the lifting existed still carry the whole-game tables inside their VPK:
/// a stale item table and a stale localization copy. Swept once, each record marked as looked at.
pub fn migrate(inst: &Installer, lib: &mut Library, vanilla: &[u8]) -> Migrated {
    let mut out = Migrated::default();
    if inst.game.is_none() {
        return out;
    }
    let records: Vec<Value> = lib.list().to_vec();
    for rec in records {
        if rec.get("kind").and_then(Value::as_str) == Some("pack")
            || rec.get("schema").is_some_and(Value::is_array)
            || rec.get("schemaChecked").is_some_and(crate::js::truthy)
        {
            continue;
        }
        let Some(files) = files_of(&rec) else { continue };
        if !files.iter().any(|f| f.root == "lang" && is_dir_vpk(&f.rel_path)) {
            continue;
        }
        out.scanned += 1;
        let before = inst.installed_size(&files).unwrap_or(0) as f64;
        let res = harvest(inst, lib, &rec, vanilla);
        let checked = json!({ "schemaChecked": true });
        let Some((deltas, _)) = res else {
            let _ = lib.update(&rec["id"], &checked, None);
            continue;
        };
        out.changed += 1;
        out.deltas += deltas;
        let now = lib.list().iter().find(|r| r.get("id") == rec.get("id")).and_then(files_of).unwrap_or_default();
        if let Ok(after) = inst.installed_size(&now) {
            out.freed_mb += (before - after as f64).max(0.0) / 1_048_576.0;
        }
        let _ = lib.update(&rec["id"], &checked, None);
    }
    out.freed_mb = (out.freed_mb + 0.5).floor();
    out
}
