//! What a VPK has to go through before it counts as a mod (src/adopt.ts): a name that says what
//! is in it, the item blocks lifted out of it, a split when it turns out to be several heroes in
//! one file. Every route into the library comes through here: the import button, drag and drop,
//! and the mods that arrive inside a shared preset.
//!
//! Building the item table afterwards is the caller's: each answer says whether it has to.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

use crate::i18n::t;
use crate::installer::Installer;
use crate::js::{string, truthy};
use crate::library::Library;

/// What an adopted file became: its records, whether any carry item blocks, and whether it split.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Adopted {
    pub records: Vec<Value>,
    pub schema: bool,
    pub split: bool,
}

/// A VPK that just landed in the game folder, made a mod. `identity` is what a mod is called and
/// filed as when the caller knows (a catalog mod, a name the sender meant). `vanilla` is the
/// game's own item table, for lifting the blocks out; None leaves them in.
pub fn adopt_imported_files(
    inst: &Installer,
    lib: &mut Library,
    vanilla: Option<&[u8]>,
    files: &[Value],
    name: Option<&str>,
    file_ref: Option<&Value>,
    identity: Option<&Value>,
) -> Result<Adopted, String> {
    static SLOT_NAME: OnceLock<Regex> = OnceLock::new();
    let slot_name = SLOT_NAME.get_or_init(|| Regex::new(r"(?i)^!?pak\d+(_dir)?$").unwrap());
    let rel = |f: &Value| f.get("relPath").map(string).unwrap_or_default();
    let dir_rel = files.iter().find(|f| rel(f).to_lowercase().ends_with("_dir.vpk")).or(files.first()).map(rel);
    // a name from the file's own content beats "pak42" and a sender's slot name; a real identity is kept
    let content_name =
        dir_rel.filter(|r| !r.is_empty()).and_then(|r| inst.display_name_for_file(&r)).filter(|n| !n.is_empty());
    let name = name.filter(|n| !n.is_empty());
    let use_content = name.is_none_or(|n| slot_name.is_match(n));
    let mut new = match identity {
        Some(id) => id.clone(),
        None => {
            let chosen = (if use_content { content_name.clone() } else { None })
                .or_else(|| name.map(String::from))
                .or(content_name)
                .unwrap_or_else(|| t("Мод", &[]));
            json!({ "name": chosen, "categoryId": "imported", "styleLabel": null, "preview": null })
        }
    };
    new["fileRef"] = file_ref.filter(|f| truthy(f)).cloned().unwrap_or(Value::Null);
    new["files"] = json!(files);
    let rec = lib.add(&new, None).map_err(|e| e.to_string())?;
    // skinchanger-style packs carry the whole item table: keep the blocks they changed, drop the tables
    let mut schema = match vanilla {
        Some(v) => crate::schema_harvest::harvest(inst, lib, &rec, v).is_some_and(|(deltas, _)| deltas > 0),
        None => false,
    };
    // and they can hold several heroes: one mod per hero, but only the small exports by themselves
    let fresh = lib.find(&rec["id"]).cloned().unwrap_or(rec.clone());
    let subjects = inst
        .analyze_record(&crate::overlays::files_of(fresh.get("files").unwrap_or(&Value::Null)))
        .and_then(|a| a.get("subjects").and_then(Value::as_u64))
        .unwrap_or(0);
    let parts =
        if (2..=4).contains(&subjects) { crate::schema_harvest::split(inst, lib, &fresh).ok().flatten() } else { None };
    if let Some(parts) = parts.filter(|p| !p.is_empty()) {
        schema |= parts.iter().any(|p| p.get("schema").and_then(Value::as_array).is_some_and(|s| !s.is_empty()));
        return Ok(Adopted { records: parts, schema, split: true });
    }
    Ok(Adopted { records: vec![lib.find(&rec["id"]).cloned().unwrap_or(rec)], schema, split: false })
}

/// The importer's results registered one by one: what came in, what failed, and whether the
/// item table needs a build. A master switch that is off stays off for the newcomers too.
pub fn register_import_results(
    inst: &Installer,
    lib: &mut Library,
    vanilla: Option<&[u8]>,
    results: &[Value],
    on_step: &mut dyn FnMut(usize, usize),
) -> Result<Value, String> {
    // a result with an error key is skipped, one with an error that says something is reported
    let ok = |r: &Value| r.get("error").is_none();
    // counted as the TypeScript counts it: an empty error is one to read, though it is skipped
    let to_read = results.iter().filter(|r| !r.get("error").is_some_and(truthy)).count();
    let mut imported = Vec::new();
    let mut need_schema = false;
    let mut read = 0;
    for r in results.iter().filter(|r| ok(r)) {
        let files = r.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
        let name = r.get("name").and_then(Value::as_str);
        let a = adopt_imported_files(inst, lib, vanilla, &files, name, r.get("source"), None)?;
        need_schema |= a.schema;
        for rec in &a.records {
            let mut row = json!({
                "name": rec.get("name").cloned().unwrap_or(Value::Null),
                "relPath": rec.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("relPath")).cloned().unwrap_or(Value::Null),
                "merged": if a.split { json!(0) } else { r.get("merged").filter(|m| truthy(m)).cloned().unwrap_or(json!(0)) },
            });
            if a.split {
                row["fromSplit"] = r.get("name").cloned().unwrap_or(Value::Null);
            }
            imported.push(row);
        }
        read += 1;
        on_step(read, to_read);
    }
    if !imported.is_empty() && inst.master_is_off().unwrap_or(false) {
        let _ = inst.set_master_enabled(false);
    }
    let errors: Vec<Value> = results.iter().filter(|r| r.get("error").is_some_and(truthy)).cloned().collect();
    Ok(json!({ "imported": imported, "errors": errors, "schema": need_schema }))
}
