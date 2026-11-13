//! A catalog mod brought to the version the catalog has now, in the place it already had
//! (src/mod-update.ts, issue #171). A catalog mod whose installed fingerprint is not among the
//! ones the catalog lists for it today was replaced upstream.

use std::path::Path;

use serde_json::{json, Value};

use crate::file_tx::FileTx;
use crate::installer::Installer;
use crate::installer_write::InstallJob;
use crate::overlays::{files_of, files_value, LibFile};

/// Categories whose files are not a pak the catalog can be asked about.
const NOT_PAKS: [&str; 5] = ["imported", "cosmetic", "fonts", "cursors", "tools"];

/// A pak installed from the catalog: the kind of mod this can update.
pub fn updatable(rec: &Value) -> bool {
    rec.get("fileRef").is_some_and(crate::js::truthy)
        && rec.get("kind").and_then(Value::as_str) != Some("pack")
        && !NOT_PAKS.contains(&rec.get("categoryId").and_then(Value::as_str).unwrap_or(""))
}

/// The catalog's fingerprints for one of its mods (category, name, style), or None.
pub type PrintsOf<'a> = dyn FnMut(&str, &str, &Option<Value>) -> Option<std::collections::HashSet<String>> + 'a;

/// Whether the catalog has another version than the one installed.
pub fn behind_catalog(rec: &Value, installed_fp: Option<&str>, prints_of: &mut PrintsOf) -> bool {
    if !updatable(rec) {
        return false;
    }
    let original = rec.get("fpOriginal").filter(|v| crate::js::truthy(v)).map(crate::js::string);
    let Some(mine) = original.or_else(|| installed_fp.filter(|f| !f.is_empty()).map(String::from)) else {
        return false;
    };
    let text = |k: &str| rec.get(k).map(crate::js::string).unwrap_or_default();
    let style = rec.get("styleLabel").cloned().filter(|v| !v.is_null());
    match prints_of(&text("categoryId"), &text("name"), &style) {
        Some(p) => !p.is_empty() && !p.contains(&mine),
        None => false,
    }
}

fn is_pak(f: &LibFile) -> bool {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    f.root == "lang"
        && R.get_or_init(|| regex::Regex::new(r"(?i)^pak\d+_(dir|\d{3})\.vpk$").unwrap()).is_match(&f.rel_path)
}

/// Replace an installed mod with the catalog's new archive (already downloaded to `local`):
/// same record, same slot, same switch. The updated record comes back.
pub fn update_mod(
    inst: &Installer,
    lib: &mut crate::library::Library,
    rec: &Value,
    local: &Path,
    log: &mut dyn FnMut(String),
) -> Result<Value, String> {
    if !updatable(rec) {
        return Err(crate::i18n::t("Этот мод нельзя обновить из каталога", &[]));
    }
    let old_base = inst.slot_base(rec);
    let was_off = rec.get("enabled") == Some(&Value::Bool(false));
    let old_files = files_of(rec.get("files").unwrap_or(&Value::Null));
    let id = rec.get("id").map(crate::js::string).unwrap_or_default();
    let (category_id, name) = (
        rec.get("categoryId").map(crate::js::string).unwrap_or_default(),
        rec.get("name").map(crate::js::string).unwrap_or_default(),
    );
    let in_place = old_files.iter().all(is_pak);
    if !in_place {
        inst.remove(&old_files, Some(&id), true)?;
    }
    let job = InstallJob { category_id: &category_id, mod_name: &name, local };
    let mut files = FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| inst.install_into(tx, &job))?;
    if in_place {
        inst.remove(&old_files, Some(&id), true)?;
    }
    let new_base = inst.slot_base(&json!({ "files": files_value(&files) }));
    if let (Some(o), Some(n)) = (&old_base, &new_base) {
        if n != o {
            let moved = inst.move_to_slot(&json!({ "files": files_value(&files) }), o, Some(n), None)?;
            files = files_of(&Value::Array(moved));
        }
    }
    if was_off {
        inst.set_enabled(&files, false, Some(&id))?;
    }
    log(format!(
        "updated from the catalog: {name}{}",
        old_base.as_ref().map(|b| format!(" ({b})")).unwrap_or_default()
    ));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let fields = json!({ "files": files_value(&files), "fpOriginal": null, "schemaChecked": false, "updatedAt": now });
    let rid = rec.get("id").cloned().unwrap_or(Value::Null);
    lib.update(&rid, &fields, None).map_err(|e| e.to_string())?;
    // the lifted item blocks belonged to the old file
    let out = lib.drop_fields(&rid, &["schema"], None).map_err(|e| e.to_string())?;
    Ok(out.unwrap_or(fields))
}
