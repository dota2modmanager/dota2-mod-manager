//! Cancel on the item table's bar (src/build-undo.ts, issue #425): the build stops, and the change
//! that started it goes back too. The app keeps a picture of the library as of the last table
//! written (`mark`), and Cancel puts the records the table reads back the way that picture has
//! them: a pick taken off again, a switched mod switched back, a look put back on.
//!
//! The TypeScript runs all of it in one ambient file transaction. Here the library's writes share
//! one transaction; the installer's switches keep their own, as they do everywhere in mm-core.
//! Stopping the build is the caller's: `cancel` takes it as a closure.

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::file_tx::FileTx;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::LibFile;
use crate::settings::Settings;

/// The one setting besides the records that the table is built from.
const EVERYONE: &str = "everyoneWearsMine";

/// Whether the item table reads a record: a pick, a mod with blocks of its own, the arcana window's.
pub fn touches_schema(rec: &Value) -> bool {
    rec.get("categoryId").and_then(Value::as_str) == Some("cosmetic")
        || rec.get("schema").and_then(Value::as_array).is_some_and(|a| !a.is_empty())
        || crate::arcana_base_color::is_window_record(rec)
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

fn on(rec: &Value) -> bool {
    rec.get("enabled") != Some(&Value::Bool(false))
}

/// What Cancel did.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(untagged)]
pub enum Undone {
    Done { ok: bool, undone: usize, left: Vec<String> },
    Not { ok: bool, reason: &'static str },
}

struct Shot {
    records: IndexMap<String, Value>,
    everyone: bool,
    off: bool,
}

/// Cancel for the item table: a picture of what the game has, and the way back to it.
#[derive(Default)]
pub struct BuildUndo {
    shot: Option<Shot>,
}

fn id_of(rec: &Value) -> String {
    rec.get("id").map(crate::js::string).unwrap_or_default()
}

impl BuildUndo {
    /// What the game wears now: called once a table is written, or dropped.
    pub fn mark(&mut self, inst: &Installer, lib: &Library, settings: &Settings) {
        let records = lib.list().iter().filter(|r| touches_schema(r)).map(|r| (id_of(r), r.clone())).collect();
        let everyone = settings.get(EVERYONE).is_some_and(crate::js::truthy);
        // no game folder yet (a first start) says nothing is switched off
        let off = inst.master_is_off().unwrap_or(false);
        self.shot = Some(Shot { records, everyone, off });
    }

    pub fn marked(&self) -> bool {
        self.shot.is_some()
    }

    /// The records the table reads, put back the way the picture has them.
    fn put_back(&self, inst: &Installer, lib: &mut Library, tx: &mut FileTx) -> Result<(usize, Vec<String>), String> {
        let io = |e: std::io::Error| e.to_string();
        let was = &self.shot.as_ref().ok_or("no picture")?.records;
        let (mut undone, mut left) = (0, Vec::new());
        let now: Vec<Value> = lib.list().iter().filter(|r| touches_schema(r)).cloned().collect();
        for rec in now {
            let id = id_of(&rec);
            let old = was.get(&id);
            if old == Some(&rec) {
                continue;
            }
            undone += 1;
            let files = files_of(&rec);
            let Some(old) = old else {
                // new since the table: a pick has no files and goes; a mod is kept, switched off
                if files.is_empty() {
                    lib.remove_record(&rec["id"], Some(tx)).map_err(io)?;
                } else if on(&rec) {
                    inst.set_enabled(&files, false, Some(&id))?;
                    lib.set_enabled(&rec["id"], false, Some(tx)).map_err(io)?;
                }
                continue;
            };
            if on(old) != on(&rec) && !files.is_empty() {
                inst.set_enabled(&files, on(old), Some(&id))?;
            }
            // the record as it was: its effect, style and switch (a mod's files are the same files)
            let gone: Vec<&str> = rec
                .as_object()
                .map(|r| r.keys().filter(|k| old.get(k.as_str()).is_none()).map(String::as_str).collect())
                .unwrap_or_default();
            if !gone.is_empty() {
                lib.drop_fields(&rec["id"], &gone, Some(tx)).map_err(io)?;
            }
            let mut back = old.clone();
            if let (Some(b), Some(f)) = (back.as_object_mut(), rec.get("files")) {
                b.insert("files".into(), f.clone());
            }
            lib.update(&rec["id"], &back, Some(tx)).map_err(io)?;
        }
        // gone since the table: a pick comes back, a mod's files are gone with it
        let ids: std::collections::HashSet<String> = lib.list().iter().map(id_of).collect();
        for (id, old) in was {
            if ids.contains(id) {
                continue;
            }
            undone += 1;
            if !files_of(old).is_empty() {
                left.push(old.get("name").map(crate::js::string).unwrap_or_default());
                continue;
            }
            lib.push_record(old.clone(), Some(tx)).map_err(io)?;
        }
        Ok((undone, left))
    }

    /// Stop the build and put back the change that started it. `cancel`: stops the build, false
    /// when none was running.
    pub fn cancel(
        &self,
        inst: &Installer,
        lib: &mut Library,
        settings: &mut Settings,
        cancel: impl FnOnce() -> bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Undone, String> {
        let Some(shot) = &self.shot else { return Ok(Undone::Not { ok: false, reason: "unknown" }) };
        if !cancel() {
            return Ok(Undone::Not { ok: false, reason: "nothing" });
        }
        if inst.master_is_off().unwrap_or(false) != shot.off {
            inst.set_master_enabled(!shot.off)?;
        }
        if settings.get(EVERYONE).is_some_and(crate::js::truthy) != shot.everyone {
            settings.set(EVERYONE, json!(shot.everyone)).map_err(|e| e.to_string())?;
        }
        let (undone, left) =
            FileTx::run(inst.journal_dir.as_deref(), Box::new(|_| {}), |tx| self.put_back(inst, lib, tx))?;
        // the game and the library agree again, unless a mod's files went for good
        if left.is_empty() {
            settings.set("schemaPending", json!(false)).map_err(|e| e.to_string())?;
        }
        let could = if left.is_empty() { String::new() } else { format!(", {} could not be", left.len()) };
        log(format!("schema: build cancelled, {undone} record(s) put back{could}"));
        Ok(Undone::Done { ok: true, undone, left })
    }
}
