//! The rank medal and hero levels of the player's own screen as one record in My mods
//! (src/rank-look-service.ts); what goes into it is `rank_look`. The two styles' CSS is read out
//! of the copy in force (a mod's when one carries them, else the game's), the medal's rules go at
//! its end, and the styles and the levels script are written without Valve's compiler; the
//! layouts get the script's include.
//!
//! After a Dota update the record is built again: `due` names it, `rebuild_now` builds it, out of
//! the way of the start. The medals' pictures need ValveResourceFormat, which `pictures` runs
//! through `Run`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use regex::Regex;
use serde_json::{json, Value};

use crate::generated_pak::{file_in_force, files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::panorama_files::{images_of, read_style, write_script, write_style};
use crate::rank_look::{
    clamp_look, levels_script, look_is_empty, takes_script, with_medal, with_script, RankLook, LAYOUTS,
    SCRIPT_COMPILED, SCRIPT_MARK, STYLES,
};
use crate::vpk::Index;

/// The game's script the levels script takes the shape of; any other does where it is gone.
const SCRIPT_TEMPLATE: &str = "panorama/scripts/popups/popup_settings.vjs_c";

/// The medals the window offers, by the name of their picture.
pub fn medal_pictures() -> Vec<String> {
    (0..9).map(|i| format!("rank{i}")).chain(["rank8a", "rank8b", "rank8c"].map(String::from)).collect()
}

/// How ValveResourceFormat is run: the program and its arguments.
pub type Run<'a> = &'a mut dyn FnMut(&str, &[String]) -> Result<(), String>;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn is_rank(rec: &Value) -> bool {
    // typeof null and typeof [] are 'object' too
    rec.get("generated").and_then(|g| g.get("rank")).is_some_and(|r| r.is_object() || r.is_null() || r.is_array())
}

fn uri(png: &[u8]) -> String {
    crate::vtex::data_url(png)
}

/// The service the rank:* channels call.
pub struct RankLookService {
    pub game: Option<PathBuf>,
    heroes: Option<(PathBuf, Vec<Value>)>,
    pictures: Option<(String, Value)>,
}

impl RankLookService {
    pub fn new(game: Option<PathBuf>) -> Self {
        RankLookService { game, heroes: None, pictures: None }
    }

    fn game(&self) -> Result<PathBuf, String> {
        self.game.clone().filter(|g| !g.as_os_str().is_empty()).ok_or_else(|| t("Не указана папка игры", &[]))
    }

    fn pak01(&self) -> Result<Arc<Index>, String> {
        crate::vpk_shared::shared_index(&self.game()?.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
    }

    fn mine(lib: &Library) -> Option<Value> {
        lib.list().iter().find(|r| is_rank(r)).cloned()
    }

    fn in_force(
        &self,
        inst: &Installer,
        lib: &Library,
        file: &str,
        usable: &dyn Fn(&[u8]) -> bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let own = Self::mine(lib).and_then(|r| r.get("id").map(crate::js::string));
        let mut passed = |rec: &Value| {
            let name = rec.get("name").map(crate::js::string).unwrap_or_default();
            log(format!("rank look: {name} carries {file} in a form the script cannot go into, using the next copy"));
        };
        let got =
            file_in_force(&self.game()?, &inst.lang_folder()?, lib.list(), own.as_deref(), file, usable, &mut passed)?;
        got.map(|(data, _)| data).ok_or_else(|| t("В игре нет файла {0}", &[json!(file)]))
    }

    /// The number the game gives each of these heroes, out of its hero script; a hero it lacks is left out.
    fn hero_ids(&self, heroes: &[String]) -> BTreeMap<u32, String> {
        let re = Regex::new(&format!(r#""HeroID"{}+"([0-9]+)""#, crate::js::SPACE_CLASS)).expect("a fixed pattern");
        let mut ids = BTreeMap::new();
        for hero in heroes {
            let Ok(ix) = self.pak01() else { continue };
            let script = ix.read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt")).ok().flatten();
            let text = script.map(|d| String::from_utf8_lossy(&d).into_owned()).unwrap_or_default();
            if let Some(id) = re.captures(&text).and_then(|c| c[1].parse::<u32>().ok()) {
                ids.insert(id, hero.clone());
            }
        }
        ids
    }

    fn script_template(&self) -> Result<Vec<u8>, String> {
        let ix = self.pak01()?;
        if let Ok(Some(own)) = ix.read(SCRIPT_TEMPLATE) {
            return Ok(own);
        }
        let first = ix.paths().find(|p| p.ends_with(".vjs_c")).map(str::to_string);
        if let Some(p) = first {
            if let Ok(Some(d)) = ix.read(&p) {
                return Ok(d);
            }
        }
        Err(t("В игре нет файла {0}", &[json!(SCRIPT_TEMPLATE)]))
    }

    fn build(
        &self,
        inst: &Installer,
        lib: &Library,
        look: &RankLook,
        log: &mut dyn FnMut(String),
    ) -> Result<Vec<u8>, String> {
        let mut entries = Vec::new();
        let ix = self.pak01()?;
        let read = |p: &str| ix.read(p).ok().flatten();
        if let Some(medal) = &look.medal {
            let readable = |d: &[u8]| read_style(d).is_ok();
            let mut styles = Vec::new();
            for (compiled, _) in STYLES {
                styles.push((compiled, self.in_force(inst, lib, compiled, &readable, log)?));
            }
            // a picture one style lacks is in the other, or in the game's own copy of it
            let own: Vec<Vec<u8>> = STYLES.iter().filter_map(|(c, _)| read(c)).collect();
            let all: Vec<&[u8]> =
                styles.iter().map(|(_, d)| d.as_slice()).chain(own.iter().map(Vec::as_slice)).collect();
            let known = images_of(&all);
            for (compiled, data) in &styles {
                let (_, css) = read_style(data)?;
                let out = write_style(data, &with_medal(&css, medal), &known, &read)?;
                entries.push(crate::vpk::entry_at(compiled, out.into()));
            }
        }
        let heroes: Vec<String> =
            crate::js::keys(&look.levels.iter().map(|(k, v)| (k.clone(), json!(v))).collect::<serde_json::Map<_, _>>())
                .into_iter()
                .cloned()
                .collect();
        let js = levels_script(look, &self.hero_ids(&heroes));
        entries.push(crate::vpk::entry_at(SCRIPT_COMPILED, write_script(&self.script_template()?, &js)?.into()));
        for p in LAYOUTS {
            let layout = self.in_force(inst, lib, p, &takes_script, log)?;
            entries.push(crate::vpk::entry_at(p, with_script(&layout)?.into()));
        }
        Ok(crate::vpk::build(&entries))
    }

    /// The record built from `look`: in the old one's slot, or a new record.
    fn put(
        &self,
        inst: &Installer,
        lib: &mut Library,
        look: &RankLook,
        keep_off: bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let vpk = self.build(inst, lib, look, log)?;
        let generated = json!({ "rank": look, "script": SCRIPT_MARK });
        let name = t("Ранг и уровни героев", &[]);
        if let Some(old) = Self::mine(lib) {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "ranks", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// What the window shows: the look on now, if any, the heroes of this patch, and whether
    /// ValveResourceFormat is there.
    pub fn state(&mut self, lib: &Library, vrf: bool) -> Value {
        let rec = Self::mine(lib);
        let mut heroes = vec![];
        if let (Ok(game), Ok(ix)) = (self.game(), self.pak01()) {
            if self.heroes.as_ref().map(|h| &h.0) != Some(&game) {
                let re = Regex::new(r"^scripts/npc/heroes/npc_dota_hero_([a-z0-9_]+)\.txt$").expect("a fixed pattern");
                let mut list: Vec<(String, String)> = ix
                    .paths()
                    .filter_map(|p| re.captures(p).map(|c| c[1].to_string()))
                    .filter(|id| id != "base")
                    .map(|id| {
                        let name = crate::hero_names::display_name(&id);
                        (id, name)
                    })
                    .collect();
                list.sort_by(|a, b| crate::js::locale_compare(&a.1, &b.1));
                self.heroes =
                    Some((game, list.into_iter().map(|(id, name)| json!({ "id": id, "name": name })).collect()));
            }
            heroes = self.heroes.as_ref().map(|h| h.1.clone()).unwrap_or_default();
        }
        let installed = rec.as_ref().and_then(|r| {
            let g = r.get("generated")?;
            Some(json!({
                "id": r.get("id").cloned().unwrap_or(Value::Null),
                "look": g.get("rank").cloned().unwrap_or(Value::Null),
                "enabled": r.get("enabled") != Some(&Value::Bool(false)),
            }))
        });
        json!({ "installed": installed, "heroes": heroes, "vrf": vrf })
    }

    /// The medals and the six badge tiers as data URIs, out of the game; a medal is missing
    /// without ValveResourceFormat (`vrf`, its program).
    pub fn pictures(
        &mut self,
        vrf: Option<&str>,
        run: Run,
        tmp: &Path,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let game = self.game()?;
        let key = format!("{}|{}", game.display(), vrf.is_some());
        if let Some((k, v)) = &self.pictures {
            if *k == key {
                return Ok(v.clone());
            }
        }
        let ix = self.pak01()?;
        let badges: Vec<Value> = (0..6)
            .map(|i| {
                let data =
                    ix.read(&format!("panorama/images/hero_badges/hero_badge_rank_{i}_png.vtex_c")).ok().flatten();
                json!(data.as_deref().and_then(crate::vtex::png_from_vtex).map(uri).unwrap_or_default())
            })
            .collect();
        let mut medals = serde_json::Map::new();
        if let Some(exe) = vrf {
            let dir = tmp.join(format!("d2mm-rank-{}", std::process::id()));
            let filter: Vec<String> =
                medal_pictures().iter().map(|n| format!("panorama/images/rank_tier_icons/{n}_psd.vtex_c")).collect();
            let pak = game.join("dota").join("pak01_dir.vpk");
            let args: Vec<String> =
                ["-i", &pak.to_string_lossy(), "-o", &dir.to_string_lossy(), "-d", "-f", &filter.join(",")]
                    .map(String::from)
                    .to_vec();
            let made = std::fs::create_dir_all(&dir).map_err(io).and_then(|_| run(exe, &args));
            match made {
                Ok(()) => {
                    for n in medal_pictures() {
                        let file =
                            dir.join("panorama").join("images").join("rank_tier_icons").join(format!("{n}_psd.png"));
                        if let Ok(png) = std::fs::read(&file) {
                            medals.insert(n, json!(uri(&png)));
                        }
                    }
                }
                Err(e) => log(format!("rank look: medal pictures unreadable: {e}")),
            }
            let _ = std::fs::remove_dir_all(&dir);
        }
        let out = json!({ "medals": medals, "badges": badges });
        self.pictures = Some((key, out.clone()));
        Ok(out)
    }

    /// The look the window sent, put in My mods in place of the one before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        raw: &Value,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let look = clamp_look(raw);
        if look_is_empty(&look) {
            return Err(t("Выбери медаль или уровень хотя бы одного героя", &[]));
        }
        let rec = self.put(inst, lib, &look, false, log)?;
        let medal = look.medal.map_or("own".to_string(), |m| format!("{}/{}/{}", m.tier, m.stars, m.top));
        let every = look.every.map_or("-".to_string(), |e| e.to_string());
        log(format!("rank look: on, medal {medal}, {} hero level(s), every {every}", look.levels.len()));
        Ok(rec)
    }

    /// After a Dota update: the record among `ids` to build again, which the app does with
    /// `rebuild_now`, out of the way of the start. Nothing counts as built yet.
    pub fn due(&mut self, lib: &Library, ids: &[String]) -> Vec<String> {
        let Some(rec) = Self::mine(lib) else { return vec![] };
        let id = rec.get("id").map(crate::js::string).unwrap_or_default();
        if rec.get("generated").is_none() || !ids.contains(&id) {
            return vec![];
        }
        self.heroes = None;
        self.pictures = None;
        vec![id]
    }

    /// The record built again from the files in force; whether it was.
    pub fn rebuild_now(&self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> bool {
        let Some(rec) = Self::mine(lib) else { return false };
        let look = clamp_look(rec.get("generated").and_then(|g| g.get("rank")).unwrap_or(&Value::Null));
        match self.put(inst, lib, &look, true, log) {
            Ok(_) => true,
            Err(e) => {
                log(format!("rank look: could not build again: {e}"));
                false
            }
        }
    }

    /// The record to build again when its pak carries another app's script: its id, else None.
    pub fn refresh_script(&mut self, lib: &Library, log: &mut dyn FnMut(String)) -> Option<String> {
        let rec = Self::mine(lib)?;
        let g = rec.get("generated")?;
        let script = g.get("script").and_then(Value::as_str);
        if script == Some(SCRIPT_MARK) {
            return None;
        }
        let shown = match g.get("script") {
            None | Some(Value::Null) => "none".to_string(),
            Some(v) => crate::js::string(v),
        };
        log(format!("rank look: the script changed ({shown} -> {SCRIPT_MARK}), building again"));
        let id = rec.get("id").map(crate::js::string)?;
        self.due(lib, std::slice::from_ref(&id));
        Some(id)
    }
}
