//! The pumpkin's mod belongs to whoever opened the pumpkin (src/scream-guard.ts). It is known by
//! folders only it has; an install that never spent a key of its own and has it anyway was handed
//! a copy, so the mod is switched off, marked, and stays off. Every mod is looked into once
//! (`scream` on its record).

use serde_json::{json, Value};

use crate::library::Library;

/// Folders only the pumpkin's mod has.
pub const SCREAM_MARKS: [&str; 2] = ["materials/scream_fx/", "materials/models/heroes/necrolyte/scream/"];

/// Whether a pak's paths are the pumpkin's mod.
pub fn is_scream(paths: &[String]) -> bool {
    paths.iter().any(|p| {
        let low = p.to_lowercase().replace('\\', "/");
        SCREAM_MARKS.iter().any(|m| low.starts_with(m))
    })
}

/// Look into the mods not looked into yet, and switch off a copy this install did not earn.
/// `paths_of` gives a record's pak paths ([] with no pak, None when it cannot be read just now);
/// `switch_off` switches a record off, files and record together. The names caught.
pub fn guard(
    lib: &mut Library,
    blood_key: &Value,
    paths_of: &mut dyn FnMut(&Value) -> Option<Vec<String>>,
    switch_off: &mut dyn FnMut(&mut Library, &Value) -> Result<(), String>,
    log: &mut dyn FnMut(String),
) -> Result<Vec<String>, String> {
    let earned = blood_key.as_str().is_some_and(|k| !k.is_empty());
    let mut caught = Vec::new();
    let records: Vec<Value> = lib.list().to_vec();
    let io = |e: std::io::Error| e.to_string();
    for mut rec in records {
        if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            continue;
        }
        let id = rec.get("id").cloned().unwrap_or(Value::Null);
        if !rec.get("scream").is_some_and(Value::is_boolean) {
            let Some(paths) = paths_of(&rec) else { continue };
            let s = is_scream(&paths);
            lib.update(&id, &json!({ "scream": s }), None).map_err(io)?;
            rec["scream"] = json!(s);
        }
        if !crate::js::truthy(&rec["scream"]) {
            continue;
        }
        let cheat = rec.get("cheat").is_some_and(crate::js::truthy);
        if earned {
            if cheat {
                lib.update(&id, &json!({ "cheat": false }), None).map_err(io)?;
            }
            continue;
        }
        if !cheat {
            lib.update(&id, &json!({ "cheat": true }), None).map_err(io)?;
            rec["cheat"] = json!(true);
        }
        if rec.get("enabled") != Some(&Value::Bool(false)) {
            let name = rec.get("name").map(crate::js::string).unwrap_or_default();
            match switch_off(lib, &rec) {
                Ok(()) => {
                    log(format!("scream: a copy nobody earned here, switched off: {name}"));
                    caught.push(name);
                }
                Err(e) => log(format!("scream: not switched off: Error: {e}")),
            }
        }
    }
    Ok(caught)
}
