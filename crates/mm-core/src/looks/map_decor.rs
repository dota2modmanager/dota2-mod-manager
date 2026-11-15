//! The map without its decor: grass, flowers, ferns and critters, or stones, bones, debris and the
//! stains on the ground, gone from the map, as a record in My mods (src/map-decor.ts).
//!
//! The list is the map's own, read each time it is built: every material the map names, and every
//! material of each model it names, out of the map in force (a whole-map terrain's in the language
//! folder, else the game's) and its models in pak01. Each decor material becomes a copy of the
//! game's dev/transparent, which draws nothing and casts no shadow.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::vpk::Index;

/// The material every decor material becomes: the game's own, which draws nothing.
pub const BLANK: &str = "materials/dev/transparent.vmat_c";
const MAP_REL: &str = "maps/dota.vpk";

/// The pak: each material of the groups asked for, as the blank one.
/// The pak of the groups asked for: each file of theirs with what goes in its place.
/// `ground`: each of the map's grounds and the other map's that goes in its place (map_ground.rs),
/// written first, so the dusk and the dark darken the ground that is there.
/// The ground's look a build puts in: its tint over the map's own grounds (their materials), and
/// files that go in as they are, last (the ground's pictures in polygons, ground_build.rs).
#[derive(Debug, Clone, Default)]
pub struct Look {
    pub tint: Option<[u8; 3]>,
    pub grounds: Vec<String>,
    pub extra: Vec<crate::vpk::Entry>,
    /// files that go in first, everything else over them (a catalog terrain's pak, map_base.rs)
    pub under: Vec<crate::vpk::Entry>,
}

pub fn decor_pak(
    pak: &Index,
    plan: &crate::map_optimize::Plan,
    groups: &[&str],
    ground: &[(String, String)],
    look: &Look,
) -> Result<Vec<u8>, String> {
    use crate::map_optimize::Fill;
    let blank =
        pak.read(BLANK).map_err(|e| e.to_string())?.ok_or_else(|| t("В игре нет файла {0}", &[json!(BLANK)]))?;
    let blank: std::sync::Arc<[u8]> = std::sync::Arc::from(blank);
    let wanted = |f: &Fill| groups.iter().any(|g| plan.get(g).is_some_and(|l| l.iter().any(|(_, x)| x == f)));
    let silent: Option<std::sync::Arc<[u8]>> =
        if wanted(&Fill::Particle) { Some(crate::map_optimize::silent_from(pak, plan)?.into()) } else { None };
    let mut models: std::collections::HashMap<String, std::sync::Arc<[u8]>> = std::collections::HashMap::new();
    // a file two groups take goes as the later one has it: the map's lightest tree over its kind's
    let mut entries: indexmap::IndexMap<String, crate::vpk::Entry> = indexmap::IndexMap::new();
    let mut written: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();
    for e in &look.under {
        written.insert(e.path(), e.data.to_vec());
        entries.insert(e.path(), e.clone());
    }
    for (ours, theirs) in ground {
        let (to, from) = (format!("{ours}_c"), format!("{theirs}_c"));
        let Some(d) = pak.read(&from).map_err(|e| e.to_string())? else { continue };
        written.insert(to.clone(), d.clone());
        entries.insert(to.clone(), crate::vpk::entry_at(&to, d.into()));
    }
    // the ground in a colour: its tints multiplied, over another map's ground where there is one
    if let Some(c) = look.tint {
        let k = crate::ground_facets::tint_factor(c);
        for m in &look.grounds {
            let p = format!("{m}_c");
            let file = match written.get(&p) {
                Some(d) => d.clone(),
                None => match pak.read(&p).map_err(|e| e.to_string())? {
                    Some(d) => d,
                    None => continue,
                },
            };
            let Ok(d) = crate::map_optimize::tint_material(&file, k) else { continue };
            written.insert(p.clone(), d.clone());
            entries.insert(p.clone(), crate::vpk::entry_at(&p, d.into()));
        }
    }
    for g in crate::map_optimize::GROUPS.iter().filter(|g| groups.contains(g)) {
        for (p, fill) in plan.get(g).into_iter().flatten() {
            let data = match fill {
                Fill::Material => blank.clone(),
                Fill::Particle => match &silent {
                    Some(s) => s.clone(),
                    None => continue,
                },
                Fill::Darken(k) => {
                    let file = match written.get(p) {
                        Some(d) => d.clone(),
                        None => match pak.read(p).map_err(|e| e.to_string())? {
                            Some(d) => d,
                            None => continue,
                        },
                    };
                    match crate::map_optimize::darken_material(&file, *k) {
                        Ok(d) => d.into(),
                        Err(_) => continue,
                    }
                }
                Fill::Model(from) => match models.get(from) {
                    Some(d) => d.clone(),
                    None => {
                        let Some(d) = pak.read(from).map_err(|e| e.to_string())? else { continue };
                        let d: std::sync::Arc<[u8]> = d.into();
                        models.insert(from.clone(), d.clone());
                        d
                    }
                },
            };
            entries.insert(p.clone(), crate::vpk::entry_at(p, data));
        }
    }
    for e in &look.extra {
        entries.insert(e.path(), e.clone());
    }
    Ok(crate::vpk::build(&entries.into_values().collect::<Vec<_>>()))
}

/// The groups the window sent that are groups, each once, in their order; the names from before
/// the steps open into theirs (map_optimize.rs expand).
pub fn clamp_groups(raw: &Value) -> Vec<&'static str> {
    match raw.as_array() {
        Some(list) => crate::map_optimize::expand(list.iter().filter_map(Value::as_str)),
        None => vec![],
    }
}

/// A map that has a ground of its own for at least this many of the map's grounds is offered.
const GROUND_AT_LEAST: usize = 3;

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
/// The game's weathers by the names the record keeps, in map_build.rs WEATHERS' order.
pub const WEATHER_KEYS: [&str; 9] =
    ["snow", "rain", "moonbeam", "pestilence", "harvest", "sirocco", "spring", "ash", "aurora"];

/// What the map is built from and with, as the record names it: "base:game:winter", "weather:snow".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MapChoice {
    pub base: Option<crate::map_base::Base>,
    pub weather: Option<usize>,
}

impl MapChoice {
    pub fn of<'a>(names: impl IntoIterator<Item = &'a str>) -> MapChoice {
        let mut c = MapChoice::default();
        for n in names {
            if let Some(b) = n.strip_prefix("base:") {
                c.base = crate::map_base::Base::parse(b);
            } else if let Some(w) = n.strip_prefix("weather:") {
                c.weather = WEATHER_KEYS.iter().position(|k| *k == w);
            }
        }
        c
    }
    pub fn is_plain(&self) -> bool {
        self.base.is_none() && self.weather.is_none()
    }
}

/// The counts and samples of the last scan, and which map file they are of: one for the app, since a
/// MapDecor is made per call and a cache of its own was never there twice (every opening of the
/// window scanned the map again, a second and a half).
static COUNTED: Mutex<Option<Counted>> = Mutex::new(None);

/// Another map's word and, for each of this map's grounds, the one of that map in its place.
pub type Grounds = (String, IndexMap<String, String>);

/// Which map file was scanned, each group's count on it, and what the scene stands for each.
type Counted = (String, Vec<(&'static str, usize)>, Value);

pub struct MapDecor {
    game: Option<PathBuf>,
    /// where a catalog terrain's map is kept (map_base.rs)
    user_data: Option<PathBuf>,
}

impl MapDecor {
    pub fn new(game: Option<PathBuf>) -> Self {
        MapDecor { game, user_data: None }
    }

    pub fn with_user_data(mut self, user_data: &Path) -> Self {
        self.user_data = Some(user_data.to_path_buf());
        self
    }

    /// The map in force: a whole-map terrain's, else the game's.
    fn map_file(&self, inst: &Installer, game: &Path) -> PathBuf {
        let own = inst.lang_folder().ok().map(|l| l.join(MAP_REL));
        own.filter(|p| p.exists()).unwrap_or_else(|| game.join("dota").join(MAP_REL))
    }

    fn scan(&self, inst: &Installer) -> Result<(std::sync::Arc<Index>, crate::map_optimize::Plan), String> {
        self.scan_at(inst, None)
    }

    /// The plan of a map: `base`'s (the one a build makes the map from), else the one in force.
    fn scan_at(
        &self,
        inst: &Installer,
        base: Option<&Path>,
    ) -> Result<(std::sync::Arc<Index>, crate::map_optimize::Plan), String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let map = base.map(Path::to_path_buf).unwrap_or_else(|| self.map_file(inst, game));
        if !map.exists() {
            return Err(t("В игре нет файла {0}", &[json!(MAP_REL)]));
        }
        let pak =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let index = Index::open(&map).map_err(|e| e.to_string())?;
        let plan = crate::map_optimize::plan(&index, &pak)?;
        if let Some(key) = key_of(&map) {
            let counts = plan.iter().map(|(g, l)| (*g, l.len())).collect();
            // what the window's scene stands for each group; none is no reason to fail the scan
            let samples = crate::map_optimize::samples(&index, &pak, &plan)
                .map(|s| serde_json::to_value(s).unwrap_or(Value::Null))
                .unwrap_or(Value::Null);
            *COUNTED.lock().unwrap_or_else(|e| e.into_inner()) = Some((key, counts, samples));
        }
        Ok((pak, plan))
    }

    /// Each other map of the game with a ground of its own, and which of the map in force's grounds
    /// it gives one for. Reading every map's names takes about a second.
    pub fn grounds(&self, inst: &Installer) -> Result<Vec<Grounds>, String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let ours = crate::map_ground::blends_of(&Index::open(&self.map_file(inst, game)).map_err(|e| e.to_string())?);
        let mut out = Vec::new();
        for (word, path) in crate::map_ground::terrain_maps(&game.join("dota").join("maps")) {
            let Ok(map) = Index::open(&path) else { continue };
            let pairs = crate::map_ground::ground_pairs(&ours, &crate::map_ground::blends_of(&map), &word);
            if pairs.len() >= GROUND_AT_LEAST {
                out.push((word, pairs));
            }
        }
        Ok(out)
    }

    /// This map's own grounds: its terrain blends' materials.
    pub fn own_grounds(&self, inst: &Installer) -> Result<Vec<String>, String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        Ok(crate::map_ground::blends_of(&Index::open(&self.map_file(inst, game)).map_err(|e| e.to_string())?))
    }

    /// The pairs of one other map's ground, or none for a map that has none to give.
    pub fn ground_pairs_of(&self, inst: &Installer, word: &str) -> Result<IndexMap<String, String>, String> {
        Ok(self.grounds(inst)?.into_iter().find(|(w, _)| w == word).map(|(_, p)| p).unwrap_or_default())
    }

    /// Optimization's groups taken off the map in force, put in My mods in place of the record
    /// before. The map itself, and what goes on its ground, is the map record's (map_make.rs).
    fn put(&self, inst: &Installer, lib: &mut Library, groups: &[&str], keep_off: bool) -> Result<Value, String> {
        // a record from before the steps names plants or debris: it is built and kept as the steps;
        // the dark look is the map's now
        let groups: Vec<&str> = crate::map_optimize::expand(groups.iter().copied())
            .into_iter()
            .filter(|g| !crate::map_make::LOOKS.contains(g))
            .collect();
        if groups.is_empty() {
            return Err(t("Выбери, что убрать с карты", &[]));
        }
        let (pak, plan) = self.scan(inst)?;
        let vpk = decor_pak(&pak, &plan, &groups, &[], &Look::default())?;
        let g = json!({ "decor": groups });
        // the decor alone keeps the name it always had; anything more is Optimization
        let name = if groups.iter().all(|g| ["critters", "grass", "stains", "rocks"].contains(g)) {
            t("Карта без декора", &[])
        } else {
            t("Оптимизация", &[])
        };
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
        let mut samples = Value::Null;
        if let Some(game) = &self.game {
            let map = self.map_file(inst, game);
            let key = key_of(&map);
            let stale = key.is_some()
                && COUNTED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|c| &c.0) != key.as_ref();
            if stale {
                self.scan(inst)?;
            }
            if let Some((_, c, s)) = COUNTED.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                counts = Value::Object(c.iter().map(|(g, n)| (g.to_string(), json!(n))).collect());
                samples = s.clone();
            }
        }
        let installed = mine(lib).map(|rec| {
            json!({
                "id": rec["id"], "groups": rec["generated"]["decor"],
                "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
            })
        });
        // another map's ground is no longer offered: the map's base is a terrain of the catalog
        Ok(json!({ "installed": installed, "counts": counts, "samples": samples, "grounds": [] }))
    }

    /// The groups asked for taken off the map in force, put in My mods in place of the record before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        raw: &Value,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let groups = clamp_groups(raw);
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
