//! The picks' pak (src/item-files-service.ts): the item builder's looks in the language folder, for
//! the game to read with nothing of its own changed (item_files.rs says what goes in). One record in
//! My mods, marked `generated`, so its slot, its switch and the master switch work as for any mod;
//! built again in its slot when a pick changes, and taken away with the last pick.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::item_files::{item_files, LeftBehind};
use crate::library::Library;
use crate::schema_build::Built;
use crate::vpk::Entry;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// Whether a record is this pak's.
pub fn is_item_files_record(rec: &Value) -> bool {
    rec.get("generated").and_then(|g| g.get("itemFiles")) == Some(&Value::Bool(true))
}

fn mine(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| is_item_files_record(r)).cloned()
}

/// The pak's one record over the installer and the library, and what the last build made.
#[derive(Default)]
pub struct ItemFilesPak {
    built: Option<(Vec<Entry>, usize, Vec<LeftBehind>)>,
}

impl ItemFilesPak {
    /// What was left behind by the last build written.
    pub fn left(lib: &Library) -> Value {
        mine(lib).and_then(|r| r.get("generated").and_then(|g| g.get("left")).cloned()).unwrap_or(json!([]))
    }

    /// The picks' files, ready for `commit`: the paths they fill, lowercased.
    pub fn build(
        &mut self,
        built: &Built,
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
        picks: usize,
    ) -> Result<HashSet<String>, String> {
        let made = item_files(&built.list, &built.beneath, read, Some(&built.files_shared))?;
        let paths = made.entries.iter().map(|e| e.path().to_lowercase()).collect();
        self.built = Some((made.entries, picks, made.left));
        Ok(paths)
    }

    /// What the last build made, written.
    pub fn commit(&mut self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> Result<(), String> {
        match self.built.take() {
            Some((entries, picks, left)) => Self::write(inst, lib, &entries, picks, &left, log),
            None => Ok(()),
        }
    }

    /// The pak of these files in its slot.
    pub fn write(
        inst: &Installer,
        lib: &mut Library,
        entries: &[Entry],
        picks: usize,
        left: &[LeftBehind],
        log: &mut dyn FnMut(String),
    ) -> Result<(), String> {
        let vpk = crate::vpk::build(entries);
        let generated = json!({ "itemFiles": true, "picks": picks, "left": left });
        let name = t("Предметы героев: {0}", &[json!(picks)]);
        match mine(lib) {
            Some(rec) => {
                let off = rec.get("enabled") == Some(&Value::Bool(false));
                let files = swap_pak(inst, &rec, &vpk, off)?;
                let fields = json!({
                    "name": name, "files": files_json(&files), "generated": generated,
                    "updatedAt": crate::js::json_number(crate::library::now()),
                });
                lib.update(&rec["id"], &fields, None).map_err(io)?;
            }
            None => {
                let files = write_pak(inst, &vpk)?;
                let new = json!({
                    "name": name, "categoryId": "imported", "styleLabel": null, "fileRef": null, "preview": null,
                    "files": files_json(&files),
                });
                let made = lib.add(&new, None).map_err(io)?;
                lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?;
            }
        }
        for l in left {
            log(format!("item files: {} without the table has not got {}", l.source, l.what.join(", ")));
        }
        Ok(())
    }

    /// The pak and its record gone: no pick left, or the table took over.
    pub fn clear(inst: &Installer, lib: &mut Library) -> Result<(), String> {
        let Some(rec) = mine(lib) else { return Ok(()) };
        let files: Vec<crate::overlays::LibFile> = rec
            .get("files")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|f| {
                        let s = |k: &str| f.get(k).map(crate::js::string).unwrap_or_default();
                        crate::overlays::LibFile::new(&s("root"), &s("relPath"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let id = rec.get("id").map(crate::js::string);
        inst.remove(&files, id.as_deref(), true)?;
        lib.remove_record(&rec["id"], None).map_err(io)
    }
}
