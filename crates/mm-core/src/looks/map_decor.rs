//! The map without its decor: grass, flowers, ferns and critters, or stones, bones, debris and the
//! stains on the ground, gone from the map, as a record in My mods (src/map-decor.ts).
//!
//! The list is the map's own, read each time it is built: every material the map names, and every
//! material of each model it names, out of the map in force (a whole-map terrain's in the language
//! folder, else the game's) and its models in pak01. Each decor material becomes a copy of the
//! game's dev/transparent, which draws nothing and casts no shadow.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use regex::bytes::Regex as BytesRegex;
use regex::Regex;
use serde_json::{json, Value};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::vpk::Index;

/// The two kinds of decor, each switched on its own.
pub const DECOR_GROUPS: [&str; 2] = ["plants", "debris"];

/// The material every decor material becomes: the game's own, which draws nothing.
pub const BLANK: &str = "materials/dev/transparent.vmat_c";
const MAP_REL: &str = "maps/dota.vpk";

fn group_of(material: &str) -> Option<&'static str> {
    let plants = Regex::new(r"^materials/(models/(props_nature|props_wildlife)/|nature/card_(grass|flowers))")
        .expect("a fixed pattern");
    let debris = Regex::new(
        r"^materials/(models/(props_debris|props_bones|props_rock|props_magic)/|overlays/(blood|petals|leaves))",
    )
    .expect("a fixed pattern");
    if plants.is_match(material) {
        Some("plants")
    } else if debris.is_match(material) {
        Some("debris")
    } else {
        None
    }
}

/// Each group's materials, plants then debris.
pub type Materials = [Vec<String>; 2];

/// Each group's materials on `map`, in pak01, sorted.
pub fn decor_materials(map: &Index, pak: &Index) -> Result<Materials, String> {
    let material = BytesRegex::new(r"(?-u)materials/[A-Za-z0-9_/.-]+?\.vmat").expect("a fixed pattern");
    let model = BytesRegex::new(r"(?-u)models/[A-Za-z0-9_/.-]+?\.vmdl").expect("a fixed pattern");
    let low = |b: &[u8]| String::from_utf8_lossy(b).to_lowercase();
    let mut mats: BTreeSet<String> = BTreeSet::new();
    let mut models: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for p in map.paths().map(str::to_string).collect::<Vec<_>>() {
        let text = map.read(&p).map_err(|e| e.to_string())?.unwrap_or_default();
        mats.extend(material.find_iter(&text).map(|m| low(m.as_bytes())));
        for m in model.find_iter(&text) {
            let m = low(m.as_bytes());
            if seen.insert(m.clone()) {
                models.push(m);
            }
        }
    }
    for m in &models {
        if let Some(data) = pak.read(&format!("{m}_c")).map_err(|e| e.to_string())? {
            mats.extend(material.find_iter(&data).map(|x| low(x.as_bytes())));
        }
    }
    let mut out: Materials = [vec![], vec![]];
    for m in mats {
        if let Some(g) = group_of(&m) {
            if pak.has(&format!("{m}_c")) {
                out[usize::from(g == "debris")].push(m);
            }
        }
    }
    Ok(out)
}

/// The pak: each material of the groups asked for, as the blank one.
pub fn decor_pak(pak: &Index, mats: &Materials, groups: &[&str]) -> Result<Vec<u8>, String> {
    let blank =
        pak.read(BLANK).map_err(|e| e.to_string())?.ok_or_else(|| t("В игре нет файла {0}", &[json!(BLANK)]))?;
    let blank: std::sync::Arc<[u8]> = std::sync::Arc::from(blank);
    let entries: Vec<_> = groups
        .iter()
        .flat_map(|g| &mats[usize::from(*g == "debris")])
        .map(|m| crate::vpk::entry_at(&format!("{m}_c"), blank.clone()))
        .collect();
    Ok(crate::vpk::build(&entries))
}

/// The groups the window sent that are groups, each once, in their order.
pub fn clamp_groups(raw: &Value) -> Vec<&'static str> {
    match raw.as_array() {
        Some(list) => DECOR_GROUPS.into_iter().filter(|g| list.iter().any(|x| x.as_str() == Some(g))).collect(),
        None => vec![],
    }
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn mine(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| r.get("generated").and_then(|g| g.get("decor")).is_some_and(Value::is_array)).cloned()
}

fn key_of(map: &Path) -> Option<String> {
    let st = std::fs::metadata(map).ok()?;
    let ms = st.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64() * 1000.0;
    Some(format!("{}|{}|{ms}", map.display(), st.len()))
}

/// The service the decor:* channels call.
pub struct MapDecor {
    game: Option<PathBuf>,
    /// the counts of the last scan, and which map file they are of
    counted: Mutex<Option<(String, [usize; 2])>>,
}

impl MapDecor {
    pub fn new(game: Option<PathBuf>) -> Self {
        MapDecor { game, counted: Mutex::new(None) }
    }

    /// The map in force: a whole-map terrain's, else the game's.
    fn map_file(&self, inst: &Installer, game: &Path) -> PathBuf {
        let own = inst.lang_folder().ok().map(|l| l.join(MAP_REL));
        own.filter(|p| p.exists()).unwrap_or_else(|| game.join("dota").join(MAP_REL))
    }

    fn scan(&self, inst: &Installer) -> Result<(std::sync::Arc<Index>, Materials), String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let map = self.map_file(inst, game);
        if !map.exists() {
            return Err(t("В игре нет файла {0}", &[json!(MAP_REL)]));
        }
        let pak =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let mats = decor_materials(&Index::open(&map).map_err(|e| e.to_string())?, &pak)?;
        if let Some(key) = key_of(&map) {
            *self.counted.lock().unwrap_or_else(|e| e.into_inner()) = Some((key, [mats[0].len(), mats[1].len()]));
        }
        Ok((pak, mats))
    }

    fn put(&self, inst: &Installer, lib: &mut Library, groups: &[&str], keep_off: bool) -> Result<Value, String> {
        let (pak, mats) = self.scan(inst)?;
        let vpk = decor_pak(&pak, &mats, groups)?;
        let g = json!({ "decor": groups });
        let name = t("Карта без декора", &[]);
        if let Some(old) = mine(lib) {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": g, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "optimization", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// The record on now, and the counts of the last scan of the map that is there now (scanned
    /// again when the map changed).
    pub fn state(&self, inst: &Installer, lib: &Library) -> Result<Value, String> {
        let mut counts = Value::Null;
        if let Some(game) = &self.game {
            let map = self.map_file(inst, game);
            let key = key_of(&map);
            let stale = key.is_some()
                && self.counted.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|c| &c.0) != key.as_ref();
            if stale {
                self.scan(inst)?;
            }
            if let Some((_, c)) = self.counted.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                counts = json!({ "plants": c[0], "debris": c[1] });
            }
        }
        let installed = mine(lib).map(|rec| {
            json!({
                "id": rec["id"], "groups": rec["generated"]["decor"],
                "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
            })
        });
        Ok(json!({ "installed": installed, "counts": counts }))
    }

    /// The groups asked for taken off the map, put in My mods in place of the record before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        raw: &Value,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let groups = clamp_groups(raw);
        if groups.is_empty() {
            return Err(t("Выбери, что убрать с карты", &[]));
        }
        let rec = self.put(inst, lib, &groups, false)?;
        log(format!("map decor: {} off the map", groups.join(", ")));
        Ok(rec)
    }

    /// After a Dota update: the record among `ids` that is to be built again, which the app does
    /// with `rebuild_now` once this has answered. Nothing counts as built yet.
    pub fn due(lib: &Library, ids: &[String]) -> Option<String> {
        let id = mine(lib)?.get("id").map(crate::js::string)?;
        ids.contains(&id).then_some(id)
    }

    /// The record built again from the map there now, kept off when it was off; its id when it was.
    pub fn rebuild_now(&self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> Option<String> {
        let rec = mine(lib)?;
        let id = rec.get("id").map(crate::js::string)?;
        let groups: Vec<String> = rec["generated"]["decor"]
            .as_array()
            .map(|a| a.iter().filter_map(|g| g.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let groups: Vec<&str> = groups.iter().map(String::as_str).collect();
        match self.put(inst, lib, &groups, true) {
            Ok(_) => Some(id),
            Err(e) => {
                log(format!("map decor: could not build again after the update: {e}"));
                None
            }
        }
    }
}
