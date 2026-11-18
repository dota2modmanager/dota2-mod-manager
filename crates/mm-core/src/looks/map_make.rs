//! The map of one's own: the window "Своя карта" builds maps/dota.vpk out of a base (the game's
//! default map, one of its terrains or a catalog terrain, map_base.rs) with the weather and the
//! dark look written in (map_build.rs, map_light.rs), and a pak of its own beside it for what goes
//! on the ground: a catalog terrain's materials, the ground darkened with the map, the ground in
//! polygons (ground_build.rs). A record of its own in My mods, apart from Optimization
//! (map_decor.rs), which reads whatever map is on and takes things off it.
//!
//! The record keeps what it was made of as names, `generated.map`: "base:game:winter",
//! "weather:snow", "dusk" or "dark", "facets:small", "tint:rrggbb".

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::map_decor::{decor_pak, Look, MapChoice, WEATHER_KEYS};
use crate::overlays::LibFile;
use crate::vpk::Index;

pub const MAP_REL: &str = "maps/dota.vpk";

/// The names a map is made of that are not the map's base or weather: the dark look.
pub const LOOKS: [&str; 2] = ["dusk", "dark"];

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// The record this window made.
pub fn mine(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| r.get("generated").and_then(|g| g.get("map")).is_some_and(Value::is_array)).cloned()
}

/// A name a map record keeps, as against one of Optimization's groups.
pub fn is_map_name(n: &str) -> bool {
    LOOKS.contains(&n) || ["base:", "weather:", "facets:", "tint:", "ground:"].iter().any(|p| n.starts_with(p))
}

fn names_of(raw: &Value) -> Vec<String> {
    raw.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect()
}

fn is_map_file(f: &LibFile) -> bool {
    f.root == "lang" && f.rel_path.replace('\\', "/").eq_ignore_ascii_case(MAP_REL)
}

pub struct MapMake {
    game: Option<PathBuf>,
    user_data: PathBuf,
}

impl MapMake {
    pub fn new(game: Option<PathBuf>, user_data: &Path) -> Self {
        MapMake { game, user_data: user_data.to_path_buf() }
    }

    fn game(&self) -> Result<&Path, String> {
        self.game.as_deref().ok_or_else(|| t("Не указана папка игры", &[]))
    }

    /// The record on now, its names and whether it is switched on.
    pub fn state(lib: &Library) -> Value {
        match mine(lib) {
            Some(rec) => {
                json!({ "id": rec["id"], "names": rec["generated"]["map"], "enabled": rec.get("enabled") != Some(&Value::Bool(false)) })
            }
            None => Value::Null,
        }
    }

    /// The map the ground of `names` is read from: its base's, else the game's default.
    fn base_index(&self, choice: &MapChoice) -> Result<Index, String> {
        let game = self.game()?;
        let file = crate::map_base::base_file(game, &self.user_data, choice.base.as_ref())
            .unwrap_or_else(|| game.join("dota").join(MAP_REL));
        Index::open(&file).map_err(|e| e.to_string())
    }

    /// The grounds the polygons are cut for: the terrain blends of the map these names build on.
    pub fn grounds(&self, raw: &Value) -> Vec<String> {
        let names = names_of(raw);
        let choice = MapChoice::of(names.iter().map(String::as_str));
        self.base_index(&choice).map(|m| crate::map_ground::blends_of(&m)).unwrap_or_default()
    }

    /// Before the window had two records Optimization made the map too: such a record gives its map
    /// file and names to a map record of their own, which is built at once so that what the old pak
    /// did for the ground (darker, in polygons) goes on in the map's own pak; the old pak is
    /// Optimization's again from its next build.
    pub fn adopt_legacy(&self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> Result<(), String> {
        if mine(lib).is_some() {
            return Ok(());
        }
        let Some(old) = lib
            .list()
            .iter()
            .find(|r| r.get("generated").and_then(|g| g.get("decor")).is_some_and(Value::is_array))
            .cloned()
        else {
            return Ok(());
        };
        let names = names_of(&old["generated"]["decor"]);
        let (map_names, rest): (Vec<String>, Vec<String>) = names.into_iter().partition(|n| is_map_name(n));
        let files = crate::overlays::files_of(&old);
        let (map_files, pak_files): (Vec<LibFile>, Vec<LibFile>) = files.into_iter().partition(is_map_file);
        if map_names.is_empty() && map_files.is_empty() {
            return Ok(());
        }
        let pictures = Self::kept_pictures(inst, &old);
        let off = old.get("enabled") == Some(&Value::Bool(false));
        lib.update(&old["id"], &json!({ "files": files_json(&pak_files), "generated": { "decor": rest } }), None)
            .map_err(io)?;
        let new = json!({
            "name": t("Своя карта", &[]), "categoryId": "terrains", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&map_files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        let mut fields = json!({ "generated": { "map": map_names.clone() } });
        if off {
            fields["enabled"] = Value::Bool(false);
        }
        lib.update(&made["id"], &fields, None).map_err(io)?;
        log(format!(
            "map make: the map of the Optimization record moved to a record of its own ({})",
            map_names.join(", ")
        ));
        self.put(inst, lib, &map_names, pictures, true).map(|_| ())
    }

    /// The pictures in polygons a record's paks hold (ground_build.rs), for a build that compiled none.
    pub fn kept_pictures(inst: &Installer, rec: &Value) -> Vec<crate::vpk::Entry> {
        let Ok(lang) = inst.lang_folder() else { return vec![] };
        let mut out = Vec::new();
        for f in crate::overlays::files_of(rec).iter().filter(|f| !is_map_file(f)) {
            let Ok(ix) = Index::open(&lang.join(&f.rel_path)) else { continue };
            let paths: Vec<String> = ix.paths().filter(|p| p.ends_with(".vtex_c")).map(str::to_string).collect();
            for p in paths {
                if let Ok(Some(d)) = ix.read(&p) {
                    out.push(crate::vpk::entry_at(&p, d.into()));
                }
            }
        }
        out
    }

    /// The map built written into the language folder: the game reads one maps/dota.vpk, so a
    /// terrain another record put there is switched off first, as the catalog does with a second.
    fn put_map(
        &self,
        inst: &Installer,
        lib: &mut Library,
        bytes: &[u8],
        own: &str,
        off: bool,
    ) -> Result<LibFile, String> {
        let file = LibFile::new("lang", MAP_REL);
        let others: Vec<Value> = lib
            .list()
            .iter()
            .filter(|r| crate::js::string(&r["id"]) != own && r.get("enabled") != Some(&Value::Bool(false)))
            .filter(|r| crate::overlays::files_of(r).iter().any(is_map_file))
            .cloned()
            .collect();
        for r in others {
            let id = crate::js::string(&r["id"]);
            inst.set_enabled(&crate::overlays::files_of(&r), false, Some(&id))?;
            lib.set_enabled(&r["id"], false, None).map_err(io)?;
        }
        let to = inst.ensure_lang_folder()?.join(MAP_REL);
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d).map_err(io)?;
        }
        crate::file_tx::write_into(bytes, &to, None).map_err(io)?;
        if off {
            inst.set_enabled(std::slice::from_ref(&file), false, Some(own))?;
        }
        Ok(file)
    }

    /// The map file the record put in the language folder, when it has one.
    fn kept_map(inst: &Installer, rec: &Value) -> Option<Vec<u8>> {
        crate::overlays::files_of(rec).iter().find(|f| is_map_file(f))?;
        std::fs::read(inst.lang_folder().ok()?.join(MAP_REL)).ok()
    }

    /// The map and its pak built from `names`, put in My mods in place of the record before.
    pub fn put(
        &self,
        inst: &Installer,
        lib: &mut Library,
        names: &[String],
        extra: Vec<crate::vpk::Entry>,
        keep_off: bool,
    ) -> Result<Value, String> {
        let game = self.game()?.to_path_buf();
        let choice = MapChoice::of(names.iter().map(String::as_str));
        let style = crate::ground_facets::Style::of(names.iter().map(String::as_str));
        let dark = names.iter().any(|n| n == "dark");
        let dusk = !dark && names.iter().any(|n| n == "dusk");
        let light = if dark {
            Some(crate::map_light::DARK)
        } else if dusk {
            Some(crate::map_light::DUSK)
        } else {
            None
        };
        if choice.is_plain() && style.is_plain() && light.is_none() {
            return Err(t("Выбери ландшафт, погоду или вид карты", &[]));
        }
        let old = mine(lib);
        let map_look = crate::map_build::MapLook {
            terrain: choice.base.as_ref().and_then(|b| b.word().map(str::to_string)),
            weather: choice.weather.map(|w| crate::map_build::WEATHERS[w].to_string()),
            light,
        };
        // a catalog terrain that is a pak of materials needs no map of its own: it goes into the pak
        let under = crate::map_base::catalog_entries(&self.user_data, choice.base.as_ref());
        let builds_map = (choice.base.is_some() && under.is_empty()) || !map_look.is_plain();
        let base_file = crate::map_base::base_file(&game, &self.user_data, choice.base.as_ref());
        let map_bytes: Option<Vec<u8>> = if builds_map {
            match &base_file {
                Some(b) => {
                    let base = Index::open(b).map_err(|e| e.to_string())?;
                    let default = Index::open(&game.join("dota").join(MAP_REL)).map_err(|e| e.to_string())?;
                    Some(crate::map_build::build_map(&base, &default, &map_look)?.0)
                }
                // a catalog terrain this computer has not kept: the map built before stays
                None => old.as_ref().and_then(|r| Self::kept_map(inst, r)),
            }
        } else {
            None
        };
        // the pak: the terrain's materials, the ground darkened with the map, the ground in polygons
        let pak =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let base = self.base_index(&choice)?;
        let plan = crate::map_optimize::plan(&base, &pak)?;
        let groups: Vec<&str> = if dark {
            vec!["dark"]
        } else if dusk {
            vec!["dusk"]
        } else {
            vec![]
        };
        // a build with nothing compiled (the one after a Dota update) keeps the pictures it had
        let extra = match (&old, extra.is_empty() && style.facets.is_some()) {
            (Some(r), true) => Self::kept_pictures(inst, r),
            _ => extra,
        };
        let look = Look {
            tint: style.tint,
            grounds: if style.tint.is_some() { crate::map_ground::blends_of(&base) } else { vec![] },
            extra,
            under,
        };
        let has_pak = !groups.is_empty() || style.tint.is_some() || !look.extra.is_empty() || !look.under.is_empty();
        let vpk = if has_pak { Some(decor_pak(&pak, &plan, &groups, &[], &look)?) } else { None };
        let mut kept: Vec<String> = groups.iter().map(|g| g.to_string()).collect();
        if let Some([r, g, b]) = style.tint {
            kept.push(format!("tint:{r:02x}{g:02x}{b:02x}"));
        }
        if let Some(f) = style.facets {
            kept.push(format!("facets:{}", f.name()));
        }
        if let Some(b) = &choice.base {
            kept.push(format!("base:{}", b.name()));
        }
        if let Some(w) = choice.weather {
            kept.push(format!("weather:{}", WEATHER_KEYS[w]));
        }
        let g = json!({ "map": kept });
        let name = t("Своя карта", &[]);
        if let Some(old) = old {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let id = crate::js::string(&old["id"]);
            let had_pak = crate::overlays::files_of(&old).iter().any(|f| !is_map_file(f));
            let mut files = match &vpk {
                Some(v) if had_pak => swap_pak(inst, &old, v, off)?,
                Some(v) => {
                    inst.remove(&crate::overlays::files_of(&old), Some(&id), true)?;
                    let f = write_pak(inst, v)?;
                    if off {
                        inst.set_enabled(&f, false, Some(&id))?;
                    }
                    f
                }
                None => {
                    inst.remove(&crate::overlays::files_of(&old), Some(&id), true)?;
                    vec![]
                }
            };
            if let Some(bytes) = &map_bytes {
                files.push(self.put_map(inst, lib, bytes, &id, off)?);
            }
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": g, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let mut files = match &vpk {
            Some(v) => write_pak(inst, v)?,
            None => vec![],
        };
        if let Some(bytes) = &map_bytes {
            files.push(self.put_map(inst, lib, bytes, "", false)?);
        }
        let new = json!({
            "name": name, "categoryId": "terrains", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// The record's id when a Dota update reached it (`ids`): its map is built again.
    pub fn due(lib: &Library, ids: &[String]) -> Option<String> {
        let id = mine(lib)?.get("id").map(crate::js::string)?;
        ids.contains(&id).then_some(id)
    }

    /// The record built again from the game there now (after a Dota update), kept off when it was off.
    pub fn rebuild_now(&self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> Option<String> {
        let rec = mine(lib)?;
        let id = rec.get("id").map(crate::js::string)?;
        let names = names_of(&rec["generated"]["map"]);
        match self.put(inst, lib, &names, vec![], true) {
            Ok(_) => Some(id),
            Err(e) => {
                log(format!("map make: could not build again after the update: {e}"));
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    /// After a Dota update the map of one's own and a hero's own sounds are built again when the
    /// update reached them, and only then.
    #[test]
    fn a_patch_owes_the_own_map_and_the_own_sounds_it_reached() {
        use crate::ability_sounds_service::AbilitySoundsService;
        use serde_json::json;
        let ud = std::env::temp_dir().join(format!("mm-own-due-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        let mut lib = crate::library::Library::new(&ud);
        let mut add = |generated: serde_json::Value| {
            let made = lib.add(&json!({ "name": "x", "files": [] }), None).unwrap();
            lib.update(&made["id"], &json!({ "generated": generated }), None).unwrap();
            crate::js::string(&made["id"])
        };
        let map = add(json!({ "map": ["dusk"] }));
        let axe = add(json!({ "sounds": "axe", "edits": [] }));
        add(json!({ "sounds": "lina", "edits": [] }));
        assert_eq!(super::MapMake::due(&lib, &[map.clone(), axe.clone()]), Some(map.clone()));
        assert_eq!(super::MapMake::due(&lib, std::slice::from_ref(&axe)), None);
        assert_eq!(AbilitySoundsService::due(&lib, &[map, axe.clone()]), vec![(axe, "axe".to_string())]);
        assert!(AbilitySoundsService::due(&lib, &[]).is_empty());
        let _ = std::fs::remove_dir_all(ud);
    }

    #[test]
    fn the_map_names_are_told_from_the_groups() {
        for n in ["dusk", "dark", "base:game:winter", "weather:snow", "facets:small", "tint:ff0000"] {
            assert!(super::is_map_name(n), "{n}");
        }
        for n in ["grass", "rocks", "weather", "mapFx"] {
            assert!(!super::is_map_name(n), "{n}");
        }
    }
}
