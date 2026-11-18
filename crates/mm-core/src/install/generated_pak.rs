//! A pak the app built itself, written into the mods folder like an installed one
//! (src/generated-pak.ts): a numbered pak in the early part of the load order, and on a rebuild the
//! new one in the slot the old one had.

use serde_json::{json, Value};

use crate::installer::Installer;
use crate::overlays::LibFile;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// A record's files, as the installer takes them.
pub fn files_of(rec: &Value) -> Vec<LibFile> {
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

fn pak_number(rel: &str) -> f64 {
    let re = regex::Regex::new(r"(?i)pak(\d+)_").expect("a fixed pattern");
    re.captures(rel).and_then(|c| c[1].parse::<f64>().ok()).unwrap_or(f64::INFINITY)
}

/// A file's bytes and the record whose pak they came from, None for the game's own.
pub type InForce = (Vec<u8>, Option<Value>);

/// The copy of a game file in force before a generated pak of ours: the first switched-on mod's,
/// in load order (the first copy wins, as in the game), else the game's own in pak01; None when
/// neither has it. `own` is the generated record itself, which never counts. A mod's copy that
/// `usable` refuses is passed over and named to `passed_over`.
pub fn file_in_force(
    game: &std::path::Path,
    lang_folder: &std::path::Path,
    records: &[Value],
    own: Option<&str>,
    file: &str,
    usable: &dyn Fn(&[u8]) -> bool,
    passed_over: &mut dyn FnMut(&Value),
) -> Result<Option<InForce>, String> {
    let dir_vpk = regex::Regex::new(r"(?i)_dir\.vpk$").expect("a fixed pattern");
    let mut paks: Vec<(&Value, String)> = records
        .iter()
        .filter(|r| {
            r.get("id").map(crate::js::string).as_deref() != own && r.get("enabled") != Some(&Value::Bool(false))
        })
        .flat_map(|r| {
            files_of(r)
                .into_iter()
                .filter(|f| f.root == "lang" && dir_vpk.is_match(&f.rel_path))
                .map(move |f| (r, f.rel_path))
        })
        .collect();
    paks.sort_by(|a, b| pak_number(&a.1).partial_cmp(&pak_number(&b.1)).unwrap_or(std::cmp::Ordering::Equal));
    for (r, rel) in paks {
        // a pak that cannot be read is not the one in force either
        let Ok(ix) = crate::vpk_shared::shared_index(&lang_folder.join(&rel)) else { continue };
        if let Ok(Some(data)) = ix.read(file) {
            if usable(&data) {
                return Ok(Some((data, Some(r.clone()))));
            }
            passed_over(r);
        }
    }
    let ix = crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
    Ok(ix.read(file).map_err(|e| e.to_string())?.map(|d| (d, None)))
}
