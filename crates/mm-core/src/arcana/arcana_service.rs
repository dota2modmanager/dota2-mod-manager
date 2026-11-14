//! The arcana window's side (src/arcana-service.ts, issue #118): what the window shows, and the
//! mod it builds out of the player's own game files, installed like any other.
//!
//! Two builds: the whole arcana for a player who has not got it (arcana.rs), and only its colour
//! for one who has (recolor.rs), whose arcana brings its gem. Either is one record in My mods,
//! marked `generated` with what it was built from, so choosing again rebuilds it in its place, and
//! a Dota update that changes the files it was built from rebuilds it with the same colour.
//!
//! A build reads pak01 and recolours hundreds of files, seconds of work: the shell runs every
//! call here off the main thread. A base the build wants and has not got is asked of the
//! `BaseSource`, which brings it down in the background.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::arcana::{arcana_forms, arcana_pictures, arcana_set, arcana_swaps, build_arcana};
use crate::arcana_bases::{entries_attached_as, BaseSource, TERRORBLADE_BASE};
use crate::gem_colors::{gem_colors, prismatic_gem_art, prismatic_gem_pictures, GemArt, GemColor};
use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::recolor::{build_recolor, recolor_set, Rgb};
use crate::vpk::Index;

/// One arcana the window builds: its set, the picture it shows, the file whose presence says the
/// game has it, the base the whole arcana is built from once it is here, and whether only the
/// colour can be built.
pub struct Window {
    pub set: &'static str,
    pub picture: &'static str,
    pub model: &'static str,
    pub base: Option<&'static str>,
    pub color_only: bool,
}

/// The arcanas the window builds, in its order (WINDOWS).
pub const WINDOWS: &[Window] = &[
    Window {
        set: "terrorblade-arcana",
        picture: "panorama/images/econ/heroes/terrorblade/arcana_terrorblade_png.vtex_c",
        model: "models/heroes/terrorblade/terrorblade_arcana.vmdl_c",
        base: Some(TERRORBLADE_BASE),
        color_only: false,
    },
    Window {
        // the item's own icon is block-compressed; the set's picture is a PNG
        set: "techies-arcana",
        picture: "panorama/images/econ/sets/v2/swine_of_the_sunken_galley_set_png.vtex_c",
        model: "models/items/techies/bigshot/bigshot.vmdl_c",
        base: None,
        color_only: false,
    },
    Window {
        set: "terrorblade-span",
        picture: "panorama/images/econ/items/terrorblade/terrorblade_ti8_immortal_back/terrorblade_ti8_immortal_back_png.vtex_c",
        model: "models/items/terrorblade/terrorblade_ti8_immortal_back/terrorblade_ti8_immortal_back.vmdl_c",
        base: None,
        color_only: true,
    },
    Window {
        set: "terrorblade-scythes",
        picture: "panorama/images/econ/items/terrorblade/tb_ti9_immortal_weapon/tb_ti9_immortal_weapon_png.vtex_c",
        model: "models/items/terrorblade/tb_ti9_immortal_weapon/tb_ti9_immortal_weapon.vmdl_c",
        base: None,
        color_only: true,
    },
    Window {
        set: "razor-crest",
        picture: "panorama/images/econ/items/razor/razor_helmet_blade/razor_helmet_blade_png.vtex_c",
        model: "models/items/razor/razor_helmet_blade/razor_helmet_blade.vmdl_c",
        base: None,
        color_only: true,
    },
];

/// Where the record sits in My mods and in the load order.
const CATEGORY: &str = "hero-items";

fn window(set: &str) -> Option<&'static Window> {
    WINDOWS.iter().find(|w| w.set == set)
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// "#ff3c28" for a colour.
pub fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// A colour from the window: three whole numbers 0-255, or nothing.
pub fn valid_color(c: &Value) -> Option<[u8; 3]> {
    let a = c.as_array().filter(|a| a.len() == 3)?;
    let mut out = [0u8; 3];
    for (i, n) in a.iter().enumerate() {
        let f = n.as_f64()?;
        if f.fract() != 0.0 || !(0.0..=255.0).contains(&f) {
            return None;
        }
        out[i] = f as u8;
    }
    Some(out)
}

fn rgb(c: [u8; 3]) -> Rgb {
    c.map(f64::from)
}

/// A record's `generated`, kept as the object it is so its keys stay in the order they came in.
type Generated = Map<String, Value>;

fn generated(rec: &Value) -> Option<&Generated> {
    rec.get("generated").and_then(Value::as_object)
}

fn color_of(g: &Generated) -> [u8; 3] {
    g.get("color").and_then(valid_color).unwrap_or([0, 0, 0])
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default()
}

/// `{...g, [key]: list}` with an empty list as undefined: the key dropped.
fn with_list(g: &mut Generated, key: &str, list: Vec<String>) {
    if list.is_empty() {
        g.remove(key);
    } else {
        g.insert(key.into(), json!(list));
    }
}

/// What the game has for one arcana.
struct Seen {
    available: bool,
    picture: Option<String>,
}

/// What the game has, read once per pak01: its index is 384 000 entries.
struct Probe {
    pak: PathBuf,
    mtime: std::time::SystemTime,
    sets: Vec<Seen>,
    gems: Vec<GemColor>,
    gem_art: Option<GemArt>,
}

/// The arcana window's service over one game folder.
pub struct ArcanaService {
    game: Option<PathBuf>,
    /// the stamp of the app's code (schema_service::builder_stamp): a record built by other code
    /// is built again, so a fix reaches an arcana installed before it
    code: Option<String>,
    probe: Option<Probe>,
}

impl ArcanaService {
    pub fn new(game: Option<PathBuf>, code: Option<String>) -> Self {
        ArcanaService { game, code, probe: None }
    }

    fn pak01(&self) -> Option<PathBuf> {
        self.game.as_ref().map(|g| g.join("dota").join("pak01_dir.vpk"))
    }

    fn index(&self) -> Result<Arc<Index>, String> {
        let pak = self.pak01().ok_or_else(|| t("Не указана папка игры", &[]))?;
        crate::vpk_shared::shared_index(&pak).map_err(|e| e.to_string())
    }

    /// The builder's enabled picks whose form has a particle for the arcana to carry.
    fn forms_picked(lib: &Library, set: &str) -> Vec<String> {
        let items: Vec<&str> =
            arcana_set(set).and_then(|d| d.forms.as_ref()).into_iter().flatten().map(|f| f.item.as_str()).collect();
        let picked: BTreeSet<String> = lib
            .list()
            .iter()
            .filter(|r| r.get("enabled") != Some(&Value::Bool(false)))
            .filter(|r| r.get("categoryId").and_then(Value::as_str) == Some("cosmetic"))
            .map(|r| r.get("itemId").map(crate::js::string).unwrap_or_else(|| "undefined".into()))
            .filter(|id| items.contains(&id.as_str()))
            .collect();
        picked.into_iter().collect()
    }

    fn mine(lib: &Library, set: &str) -> Option<Value> {
        lib.list()
            .iter()
            .find(|r| generated(r).and_then(|g| g.get("set")).and_then(Value::as_str) == Some(set))
            .cloned()
    }

    /// A set the window builds, or an error the window shows.
    fn known(set: &Value) -> Result<&'static Window, String> {
        set.as_str().and_then(window).ok_or_else(|| t("Нет такой арканы", &[]))
    }

    /// What the game has for each arcana, and its gems; read again once pak01 changes.
    fn seen(&mut self, log: &mut dyn FnMut(String)) -> Option<&Probe> {
        let pak = self.pak01()?;
        let read = || -> Result<Probe, String> {
            let mtime = std::fs::metadata(&pak).and_then(|m| m.modified()).map_err(io)?;
            let index = crate::vpk_shared::shared_index(&pak).map_err(|e| e.to_string())?;
            let mut sets = Vec::new();
            for w in WINDOWS {
                let available = index.read(w.model).map_err(|e| e.to_string())?.is_some();
                let picture = if available {
                    let data = index.read(w.picture).map_err(|e| e.to_string())?;
                    data.as_deref().and_then(crate::vtex::png_from_vtex).map(crate::vtex::data_url)
                } else {
                    None
                };
                sets.push(Seen { available, picture });
            }
            let table = index.read("scripts/items/items_game.txt").map_err(|e| e.to_string())?;
            let gems = match table {
                Some(t) => prismatic_gem_pictures(&gem_colors(&t).map_err(|e| e.to_string())?, &index),
                None => Vec::new(),
            };
            Ok(Probe { pak: pak.clone(), mtime, sets, gem_art: prismatic_gem_art(&index), gems })
        };
        let fresh = match (&self.probe, std::fs::metadata(&pak).and_then(|m| m.modified())) {
            (Some(p), Ok(m)) => p.pak == pak && p.mtime == m,
            _ => false,
        };
        if !fresh {
            match read() {
                Ok(p) => self.probe = Some(p),
                Err(e) => {
                    log(format!("arcana: the game could not be read: {e}"));
                    return None;
                }
            }
        }
        self.probe.as_ref()
    }

    fn build(
        &self,
        params: &Generated,
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let index = self.index()?;
        let under: BTreeSet<String> = strings(params.get("under")).into_iter().collect();
        let set = params.get("set").and_then(Value::as_str).unwrap_or("");
        let color = rgb(color_of(params));
        let skip = |p: &str| under.contains(p);
        if params.get("mode").and_then(Value::as_str) != Some("mod") {
            return build_recolor(&index, set, color, skip).map(|(vpk, _)| vpk);
        }
        let forms = strings(params.get("forms"));
        let base_id = window(set).and_then(|w| w.base);
        let stored = base_id.and_then(|id| bases.and_then(|b| b.entries(id)));
        // with its models numbered as the game's (model_attachments.rs)
        let base = stored.map(|s| entries_attached_as(s, &|p| index.read(p).ok().flatten()));
        if let (Some(id), Some(b)) = (base_id, bases) {
            b.want(id);
        }
        let Some(base) = base else {
            return build_arcana(&index, set, color, &skip, &forms).map(|b| b.vpk);
        };
        // the base under the plain paths in the chosen colour, the arcana's pictures and swaps from the game
        let gem = recolor_set(set).ok_or_else(|| format!("recolor: no set {set}"))?.gem;
        let (colored, _, failed) = crate::arcana_base_color::base_in_color(&base, color, gem);
        if let Some(first) = failed.first() {
            log(format!("arcana: {} files of the base kept their own colour, first {first}", failed.len()));
        }
        let mut files: IndexMap<String, Vec<u8>> = colored.iter().map(|e| (e.path(), e.data.to_vec())).collect();
        for (p, data) in arcana_pictures(&index, set)?.into_iter().chain(arcana_swaps(&index, set, color)?) {
            files.entry(p).or_insert(data);
        }
        arcana_forms(&index, set, color, &forms, &mut files, log)?;
        let entries: Vec<crate::vpk::Entry> = files
            .into_iter()
            .filter(|(p, _)| !under.contains(&p.to_lowercase()))
            .map(|(p, data)| crate::vpk::entry_at(&p, data.into()))
            .collect();
        Ok(crate::vpk::build(&entries))
    }

    /// What a record was built from, with the code that built it.
    fn stamped(&self, mut params: Generated) -> Value {
        if let Some(c) = &self.code {
            params.insert("code".into(), json!(c));
        }
        Value::Object(params)
    }

    /// A record built again from `params`, in the slot it had: the new pak goes in beside, then
    /// takes the old one's place. Switched on, unless `keep_off` and it was off.
    fn replace(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (rec, params, keep_off): (&Value, Generated, bool),
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let vpk = self.build(&params, bases, log)?; // before anything on disk is touched
        let off = keep_off && rec.get("enabled") == Some(&Value::Bool(false));
        let files = swap_pak(inst, rec, &vpk, off)?;
        let fields = json!({
            "files": files_json(&files), "styleLabel": hex(color_of(&params)), "generated": self.stamped(params),
            "enabled": !off, "updatedAt": crate::js::json_number(crate::library::now()),
        });
        Ok(lib.update(&rec["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// One record's part of give_way.
    fn give_way_one(
        &self,
        inst: &Installer,
        lib: &mut Library,
        rec: &Value,
        filled: &BTreeSet<String>,
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> bool {
        let Some(g) = generated(rec).cloned() else { return false };
        let pak_file = rec.get("files").and_then(Value::as_array).into_iter().flatten().find(|f| {
            f.get("root").and_then(Value::as_str) == Some("lang")
                && f.get("relPath").and_then(Value::as_str).is_some_and(|p| p.to_lowercase().ends_with("_dir.vpk"))
        });
        let Some(rel) = pak_file.and_then(|f| f.get("relPath")).and_then(Value::as_str) else { return false };
        let Ok(own) = inst
            .lang_file_on_disk(rel)
            .and_then(|p| std::fs::read(p).map_err(io))
            .and_then(|buf| crate::vpk::list_paths(&buf).map_err(|e| e.to_string()))
        else {
            return false;
        };
        let was = strings(g.get("under"));
        let under: Vec<String> = own
            .iter()
            .map(|p| p.to_lowercase())
            .chain(was.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|p| filled.contains(p))
            .collect();
        let set = g.get("set").and_then(Value::as_str).unwrap_or("").to_string();
        let forms = Self::forms_picked(lib, &set);
        let same_code = self.code.as_ref().is_none_or(|c| g.get("code").and_then(Value::as_str) == Some(c.as_str()));
        if under == was && forms == strings(g.get("forms")) && same_code {
            return false;
        }
        let started = std::time::Instant::now();
        let (n_under, n_forms) = (under.len(), forms.len());
        let mut params = g;
        with_list(&mut params, "under", under);
        with_list(&mut params, "forms", forms);
        match self.replace(inst, lib, (rec, params, true), bases, log) {
            Ok(_) => {
                log(format!(
                    "arcana: built again around the item builder's picks, {n_under} paths left to them, {n_forms} forms carried, in {} ms",
                    started.elapsed().as_millis()
                ));
                true
            }
            Err(e) => {
                log(format!("arcana: could not give way to the item builder: {e}"));
                false
            }
        }
    }

    /// What the window shows: each arcana, and the game's prismatic gems to offer as colours.
    pub fn state(&mut self, lib: &Library, log: &mut dyn FnMut(String)) -> Value {
        let game = self.seen(log).map(|p| {
            (
                p.sets.iter().map(|s| (s.available, s.picture.clone())).collect::<Vec<_>>(),
                json!(p.gems),
                json!(p.gem_art),
            )
        });
        let arcanas: Vec<Value> = WINDOWS
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let rec = Self::mine(lib, w.set);
                let has = game.as_ref().map(|g| g.0[i].clone());
                let def = recolor_set(w.set);
                let available = has.as_ref().is_some_and(|h| h.0);
                let installed = rec.as_ref().and_then(|r| {
                    let g = generated(r)?;
                    Some(json!({
                        "id": r.get("id").cloned().unwrap_or(Value::Null),
                        "color": g.get("color").cloned().unwrap_or(Value::Null),
                        "mode": g.get("mode").cloned().unwrap_or(Value::Null),
                        "enabled": r.get("enabled") != Some(&Value::Bool(false)),
                    }))
                });
                json!({
                    "set": w.set,
                    "name": def.map(|d| d.name.clone()),
                    "available": available,
                    "picture": if available { has.and_then(|h| h.1) } else { None },
                    "installed": installed,
                    "colorOnly": w.color_only,
                    "preview": {
                        "own": def.map(|d| d.own.clone()).unwrap_or_default(),
                        "shared": def.map(|d| d.shared.clone()).unwrap_or_default(),
                        "materials": def.map(|d| d.materials.clone()).unwrap_or_default(),
                        "bake": def.is_some_and(|d| d.bake),
                    },
                })
            })
            .collect();
        let (gems, gem_art) = game.map(|g| (g.1, g.2)).unwrap_or((json!([]), Value::Null));
        json!({ "arcanas": arcanas, "gems": gems, "gemArt": gem_art })
    }

    /// Build one of the arcanas (or its colour) and install it, in place of the one built before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        (set, color, mode): (&Value, &Value, &Value),
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let w = Self::known(set)?;
        let c = valid_color(color).ok_or_else(|| t("Не тот цвет", &[]))?;
        let old = Self::mine(lib, w.set);
        // what it left to the builder's picks stays left to them: the picks are the same
        let under = old.as_ref().and_then(generated).and_then(|g| g.get("under")).cloned();
        let forms = Self::forms_picked(lib, w.set);
        let mode = if mode.as_str() == Some("recolor") || w.color_only { "recolor" } else { "mod" };
        let mut params = Generated::new();
        params.insert("set".into(), json!(w.set));
        params.insert("color".into(), json!(c));
        params.insert("mode".into(), json!(mode));
        if let Some(u) = under.filter(|u| !u.is_null()) {
            params.insert("under".into(), u);
        }
        with_list(&mut params, "forms", forms);
        if let Some(old) = old {
            let rec = self.replace(inst, lib, (&old, params, false), bases, log)?;
            log(format!("arcana: built again in {} ({mode})", hex(c)));
            return Ok(rec);
        }
        let files = write_pak(inst, &self.build(&params, bases, log)?)?;
        let name = recolor_set(w.set).map(|d| d.name.clone());
        let new = json!({
            "name": name, "categoryId": CATEGORY, "styleLabel": hex(c), "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        log(format!("arcana: built in {} ({mode})", hex(c)));
        Ok(lib
            .update(&made["id"], &json!({ "generated": self.stamped(params) }), None)
            .map_err(io)?
            .unwrap_or(Value::Null))
    }

    /// The arcana in step with the item builder, after each build of its table: built again
    /// without the paths `filled` (lowercased) shares with it, and when the picks whose form it
    /// dresses change, or the app's code that built it did. Whether any was built again.
    pub fn give_way(
        &self,
        inst: &Installer,
        lib: &mut Library,
        filled: &BTreeSet<String>,
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> bool {
        let mut built = false;
        for w in WINDOWS {
            if let Some(rec) = Self::mine(lib, w.set) {
                if self.give_way_one(inst, lib, &rec, filled, bases, log) {
                    built = true;
                }
            }
        }
        built
    }

    /// After a Dota update: the generated records among `ids` built again from the new files,
    /// with the colour each had. The ids built again.
    pub fn rebuild(
        &self,
        inst: &Installer,
        lib: &mut Library,
        ids: &[String],
        bases: Option<&dyn BaseSource>,
        log: &mut dyn FnMut(String),
    ) -> Vec<String> {
        let mut done = Vec::new();
        let todo: Vec<Value> = lib
            .list()
            .iter()
            .filter(|r| {
                let set = generated(r).and_then(|g| g.get("set")).and_then(Value::as_str);
                set.is_some_and(|s| window(s).is_some())
                    && ids.contains(&r.get("id").map(crate::js::string).unwrap_or_default())
            })
            .cloned()
            .collect();
        for rec in todo {
            let Some(g) = generated(&rec).cloned() else { continue };
            let color = color_of(&g);
            match self.replace(inst, lib, (&rec, g, true), bases, log) {
                Ok(_) => {
                    done.push(crate::js::string(&rec["id"]));
                    let name = rec.get("name").map(crate::js::string).unwrap_or_default();
                    log(format!("arcana: built again after the update: {name} {}", hex(color)));
                }
                Err(e) => log(format!("arcana: could not build again after the update: {e}")),
            }
        }
        done
    }
}
