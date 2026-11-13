//! A pak the app built itself, written into the mods folder like an installed one
//! (src/generated-pak.ts): a numbered pak in the early part of the load order, and on a rebuild the
//! new one in the slot the old one had.

use serde_json::{json, Value};

use crate::installer::Installer;
use crate::overlays::LibFile;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn files_of(rec: &Value) -> Vec<LibFile> {
    rec.get("files")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|f| {
                    let s = |k: &str| f.get(k).map(crate::js::string).unwrap_or_default();
                    LibFile::new(&s("root"), &s("relPath"))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn as_json(files: &[LibFile]) -> Value {
    json!(files.iter().map(|f| json!({ "root": f.root, "relPath": f.rel_path })).collect::<Vec<_>>())
}

/// The built pak written into a slot in the early part of the load order; the files it took.
pub fn write_pak(inst: &Installer, vpk: &[u8]) -> Result<Vec<LibFile>, String> {
    let lang = inst.ensure_lang_folder()?;
    let mut used = inst.used_pak_names()?;
    let name = inst.allocate_pak(&mut used, true)?;
    crate::file_tx::write_into(vpk, &lang.join(&name), None).map_err(io)?;
    Ok(vec![LibFile::new("lang", &name)])
}

/// `vpk` in place of the record's pak: written beside it, then moved into the slot the old one
/// had, and switched off when `off`. The caller builds first, so a build that fails leaves the old one.
pub fn swap_pak(inst: &Installer, rec: &Value, vpk: &[u8], off: bool) -> Result<Vec<LibFile>, String> {
    let old_base = inst.slot_base(rec);
    let mut files = write_pak(inst, vpk)?;
    let rec_id = rec.get("id").map(crate::js::string);
    inst.remove(&files_of(rec), rec_id.as_deref(), true)?;
    let made = json!({ "files": as_json(&files) });
    let new_base = inst.slot_base(&made);
    if let (Some(old), Some(new)) = (&old_base, &new_base) {
        if old != new {
            let moved = inst.move_to_slot(&made, old, Some(new), None)?;
            files = files_of(&json!({ "files": moved }));
        }
    }
    if off {
        inst.set_enabled(&files, false, rec_id.as_deref())?;
    }
    Ok(files)
}

/// The record's files as the library keeps them.
pub fn files_json(files: &[LibFile]) -> Value {
    as_json(files)
}
