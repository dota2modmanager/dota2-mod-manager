//! Towers and trees from the game's own looks, per side, built in the app (src/map-looks-service.ts,
//! issues #446, #421). The window picks a look for Radiant and one for Dire; the pak comes out of
//! the player's pak01 (tower_looks.rs, tree_sets.rs) and goes into My mods as one record per kind,
//! marked `generated` with what it was built from. Choosing again builds it again in its slot, and
//! a Dota update that reached it builds it again from the new files.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use regex::Regex;
use serde_json::{json, Value};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::tower_looks::{build_towers, default_tower, tower_looks};
use crate::tree_sets::{build_trees, default_trees, tree_sets};

const KINDS: [&str; 2] = ["towers", "trees"];

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// The tree sets the window offers: the tinted ones come out washed white on the default map.
pub fn offered_trees() -> Vec<Value> {
    tree_sets()
        .into_iter()
        .filter(|s| !s.tinted)
        .map(|s| {
            json!({ "id": s.id, "name": s.name, "sides": ["radiant", "dire"], "models": { "radiant": s.models[0], "dire": s.models[0] } })
        })
        .collect()
}

struct Table {
    pak: PathBuf,
    mtime: Option<SystemTime>,
    text: Arc<Vec<u8>>,
    towers: Vec<Value>,
}

/// The service the map:* channels call, over the game folder, the installer and the library.
pub struct MapLooks {
    game: Option<PathBuf>,
    /// items_game is 50 MB: read once per pak01, and again after a Dota update rewrites the file
    table: Mutex<Option<Arc<Table>>>,
}

fn mine<'a>(lib: &'a Library, kind: &str) -> Option<&'a Value> {
    lib.list().iter().find(|r| r.get("generated").and_then(|g| g.get("map")).and_then(Value::as_str) == Some(kind))
}

impl MapLooks {
    pub fn new(game: Option<PathBuf>) -> Self {
        MapLooks { game, table: Mutex::new(None) }
    }

    fn pak01(&self) -> Option<PathBuf> {
        self.game.as_ref().map(|g| g.join("dota").join("pak01_dir.vpk"))
    }

    fn read(&self, log: &mut dyn FnMut(String)) -> Option<Arc<Table>> {
        let pak = self.pak01()?;
        let run = || -> Result<Arc<Table>, String> {
            let mtime = std::fs::metadata(&pak).map_err(io)?.modified().ok();
            let mut held = self.table.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(t) = held.as_ref().filter(|t| t.pak == pak && t.mtime == mtime) {
                return Ok(t.clone());
            }
            let ix = crate::vpk_shared::shared_index(&pak).map_err(|e| e.to_string())?;
            let text = ix.read("scripts/items/items_game.txt").map_err(|e| e.to_string())?.unwrap_or_default();
            let towers = tower_looks(&text)?;
            let table = Arc::new(Table { pak: pak.clone(), mtime, text: Arc::new(text), towers });
            *held = Some(table.clone());
            Ok(table)
        };
        match run() {
            Ok(t) => Some(t),
            Err(e) => {
                log(format!("map looks: the game could not be read: {e}"));
                None
            }
        }
    }

    /// The options of a kind, as the window offers them.
    fn options(&self, kind: &str, log: &mut dyn FnMut(String)) -> Vec<Value> {
        if kind == "trees" {
            offered_trees()
        } else {
            self.read(log).map(|t| t.towers.clone()).unwrap_or_default()
        }
    }

    /// The pak for `g` and the name its record goes by.
    fn build(&self, g: &Value, log: &mut dyn FnMut(String)) -> Result<(Vec<u8>, String), String> {
        let pak = self.pak01().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let kind = g["map"].as_str().unwrap_or("");
        let side = |k: &str| g.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
        let (radiant, dire) = (side("radiant"), side("dire"));
        // "Grasp of the Elder Gods - Radiant Towers" as "Grasp of the Elder Gods": the name says the side
        let towers_re = Regex::new(&format!(r"(?i){0}*-?{0}*(Radiant|Dire) Towers$", crate::js::SPACE_CLASS))
            .expect("a fixed pattern");
        let effects_re =
            Regex::new(&format!(r"(?i){}+Building Effects$", crate::js::SPACE_CLASS)).expect("a fixed pattern");
        let options = self.options(kind, log);
        let label = |id: &Option<String>| match id {
            Some(id) => {
                let name = options
                    .iter()
                    .find(|o| o["id"].as_str() == Some(id))
                    .and_then(|o| o["name"].as_str())
                    .unwrap_or(id)
                    .to_string();
                effects_re.replace(&towers_re.replace(&name, ""), "").into_owned()
            }
            None => t("как в игре", &[]),
        };
        let template =
            if kind == "trees" { "Деревья: Radiant {0}, Dire {1}" } else { "Башни: Radiant {0}, Dire {1}" };
        let name = t(template, &[json!(label(&radiant)), json!(label(&dire))]);
        if kind == "trees" {
            let (vpk, _, missing) = build_trees(&pak, radiant.as_deref(), dire.as_deref())?;
            if let Some(first) = missing.first() {
                log(format!("map looks: {} tree models are not in the game, first {first}", missing.len()));
            }
            return Ok((vpk, name));
        }
        let text = self.read(log).map(|t| t.text.clone()).unwrap_or_default();
        let r = build_towers(&pak, &text, radiant.as_deref(), dire.as_deref())?;
        if let Some(first) = r.missing.first() {
            log(format!("map looks: {} tower files are not in the game, first {first}", r.missing.len()));
        }
        Ok((r.vpk, name))
    }

    /// A side's pick from the window: an id of that kind for that side, or nothing.
    fn pick(&self, kind: &str, side: &str, id: &Value, log: &mut dyn FnMut(String)) -> Result<Option<String>, String> {
        if id.is_null() || id.as_str() == Some("") {
            return Ok(None);
        }
        let found = self.options(kind, log).into_iter().find(|o| {
            Some(&o["id"]) == Some(id)
                && o["sides"].as_array().is_some_and(|s| s.iter().any(|x| x.as_str() == Some(side)))
        });
        match found {
            Some(o) => Ok(o["id"].as_str().map(str::to_string)),
            None => Err(t("Такого вида нет в игре", &[])),
        }
    }

    /// A record built again from `g`, in the slot it had, off if it was off and `keep_off`.
    fn replace(
        &self,
        inst: &Installer,
        lib: &mut Library,
        rec: &Value,
        g: &Value,
        keep_off: bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let (vpk, name) = self.build(g, log)?;
        let off = keep_off && rec.get("enabled") == Some(&Value::Bool(false));
        let files = swap_pak(inst, rec, &vpk, off)?;
        let fields = json!({
            "name": name, "files": files_json(&files), "generated": g, "enabled": !off,
            "updatedAt": crate::js::json_number(crate::library::now()),
        });
        Ok(lib.update(&rec["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// What the window shows: the looks of each kind, the record built before, and the model each
    /// side stands in as the game ships.
    pub fn state(&self, lib: &Library, log: &mut dyn FnMut(String)) -> Value {
        let mut installed = serde_json::Map::new();
        for kind in KINDS {
            let v = mine(lib, kind).map(|rec| {
                let g = &rec["generated"];
                json!({
                    "id": rec["id"], "radiant": g["radiant"], "dire": g["dire"],
                    "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
                })
            });
            installed.insert(kind.into(), v.unwrap_or(Value::Null));
        }
        let own = json!({
            "towers": { "radiant": default_tower("radiant"), "dire": default_tower("dire") },
            "trees": { "radiant": default_trees("radiant")[0], "dire": default_trees("dire")[0] },
        });
        json!({ "towers": self.options("towers", log), "trees": self.options("trees", log), "installed": installed, "own": own })
    }

    /// Build a kind with a look per side and install it, in place of the one built before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (kind, radiant, dire): (&Value, &Value, &Value),
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let kind = match kind.as_str() {
            Some(k @ ("towers" | "trees")) => k,
            _ => return Err(t("Такого вида нет в игре", &[])),
        };
        let (r, d) = (self.pick(kind, "radiant", radiant, log)?, self.pick(kind, "dire", dire, log)?);
        if r.is_none() && d.is_none() {
            return Err(t("Выбери вид хотя бы для одной стороны", &[]));
        }
        let said = |s: &Option<String>| s.clone().unwrap_or_else(|| "as is".into());
        let g = json!({ "map": kind, "radiant": r, "dire": d });
        if let Some(old) = mine(lib, kind).cloned() {
            let rec = self.replace(inst, lib, &old, &g, false, log)?;
            log(format!("map looks: {kind} built again, Radiant {}, Dire {}", said(&r), said(&d)));
            return Ok(rec);
        }
        let (vpk, name) = self.build(&g, log)?;
        let files = write_pak(inst, &vpk)?;
        let new = json!({ "name": name, "categoryId": kind, "styleLabel": null, "fileRef": null, "preview": null, "files": files_json(&files) });
        let made = lib.add(&new, None).map_err(io)?;
        log(format!("map looks: {kind} built, Radiant {}, Dire {}", said(&r), said(&d)));
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// After a Dota update: the map records among `ids` built again from the new files; the ids built again.
    pub fn rebuild(
        &self,
        inst: &Installer,
        lib: &mut Library,
        ids: &[String],
        log: &mut dyn FnMut(String),
    ) -> Vec<String> {
        let mut done = Vec::new();
        for rec in lib.list().to_vec() {
            let g = rec.get("generated").cloned().unwrap_or(Value::Null);
            let id = rec.get("id").map(crate::js::string).unwrap_or_default();
            if !g.get("map").is_some_and(crate::js::truthy) || !ids.contains(&id) {
                continue;
            }
            match self.replace(inst, lib, &rec, &g, true, log) {
                Ok(_) => done.push(id),
                Err(e) => log(format!("map looks: could not build again after the update: {e}")),
            }
        }
        done
    }
}
