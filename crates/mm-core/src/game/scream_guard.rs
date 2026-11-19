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
    let io = |e: std::io::Error| e.to_string();
    // one write of the manifest for the lot: a set put on every hero is some 470 new records,
    // and their "scream" written one by one held the first mods:list after it for 23 seconds
    lib.batch(|lib| -> Result<(), String> {
        let records: Vec<Value> = lib.list().to_vec();
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
        Ok(())
    })
    .map_err(io)??;
    Ok(caught)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_record_is_looked_into_with_one_write_and_a_copy_nobody_earned_goes_off() {
        let dir = std::env::temp_dir().join(format!("mm-scream-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut lib = Library::new(&dir);
        let pick = lib.add(&json!({ "name": "pick", "categoryId": "cosmetic" }), None).unwrap();
        let pumpkin = lib.add(&json!({ "name": "pumpkin", "categoryId": "imported" }), None).unwrap();
        let file = lib.file.clone();
        let written = || std::fs::read_to_string(&file).unwrap();
        let before = written();
        let caught = guard(
            &mut lib,
            &Value::Null,
            &mut |rec| {
                Some(if rec["name"] == "pumpkin" { vec!["materials/scream_fx/a.vmat_c".into()] } else { vec![] })
            },
            &mut |lib, rec| {
                // the batch has not written the flags yet
                assert_eq!(std::fs::read_to_string(&lib.file).unwrap(), before);
                lib.set_enabled(&rec["id"], false, None).map(|_| ()).map_err(|e| e.to_string())
            },
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(caught, ["pumpkin"]);
        let back = Library::new(&dir);
        let find = |id: &Value| back.list().iter().find(|r| &r["id"] == id).cloned().unwrap();
        assert_eq!(find(&pick["id"])["scream"], false);
        assert_eq!(find(&pumpkin["id"])["scream"], true);
        assert_eq!(find(&pumpkin["id"])["cheat"], true);
        assert_eq!(find(&pumpkin["id"])["enabled"], false);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
