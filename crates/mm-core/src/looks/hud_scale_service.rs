//! The in-game HUD laid out by hand, as a record in My mods (src/hud-scale-service.ts; the CSS is
//! hud_scale.rs). One record. The style it starts from is the one in force: a HUD mod's copy when
//! one is switched on (first in the load order wins), else the game's own. The layout goes at the
//! end of its CSS and the style is written again (panorama_files.rs); the pak goes early in the
//! load order, so it wins over the HUD mod it was made from.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::generated_pak::{file_in_force, files_json, swap_pak, write_pak};
use crate::hud_scale::{clean_parts, parts_of_scale, with_layout, STYLE};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::panorama_files::{read_style, write_style};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn mine(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| r.get("generated").and_then(|g| g.get("hud")).is_some_and(Value::is_number)).cloned()
}

/// The layout a record holds: its parts, or for one from before the editor, its one scale.
fn parts_of(g: &Value) -> Vec<Value> {
    match g.get("parts") {
        Some(Value::Null) | None => parts_of_scale(&g["hud"]),
        Some(p) => p.as_array().cloned().unwrap_or_default(),
    }
}

/// The service the hud:* channels call.
pub struct HudScale {
    game: Option<PathBuf>,
}

impl HudScale {
    pub fn new(game: Option<PathBuf>) -> Self {
        HudScale { game }
    }

    fn game(&self) -> Result<&PathBuf, String> {
        self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))
    }

    fn own_id(lib: &Library) -> Option<String> {
        mine(lib).and_then(|r| r.get("id").map(crate::js::string))
    }

    /// The name of the HUD mod whose style the layout would go on, None for the game's own.
    fn hud_mod(&self, inst: &Installer, lib: &Library) -> Result<Option<String>, String> {
        let game = self.game()?;
        let own = Self::own_id(lib);
        let got = file_in_force(game, &inst.lang_folder()?, lib.list(), own.as_deref(), STYLE, &|_| true, &mut |_| {})?
            .ok_or_else(|| t("В игре нет файла {0}", &[json!(STYLE)]))?;
        Ok(got.1.map(|r| r.get("name").map(crate::js::string).unwrap_or_default()))
    }

    fn build(
        &self,
        inst: &Installer,
        lib: &Library,
        parts: &[Value],
        log: &mut dyn FnMut(String),
    ) -> Result<(Vec<u8>, String), String> {
        let game = self.game()?;
        let readable = |d: &[u8]| read_style(d).is_ok();
        let own = Self::own_id(lib);
        let mut passed = |rec: &Value| {
            let name = rec.get("name").map_or("undefined".into(), crate::js::string);
            log(format!("hud layout: {name} carries {STYLE} in a form the app cannot read, using the next copy"));
        };
        let (data, from) =
            file_in_force(game, &inst.lang_folder()?, lib.list(), own.as_deref(), STYLE, &readable, &mut passed)?
                .ok_or_else(|| t("В игре нет файла {0}", &[json!(STYLE)]))?;
        let pak01 =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let (_, css) = read_style(&data).map_err(|_| t("Не удалось прочитать стиль {0}", &[json!(STYLE)]))?;
        let style =
            write_style(&data, &with_layout(&css, &json!(parts)), &|_| None, &|p| pak01.read(p).ok().flatten())?;
        let vpk = crate::vpk::build(&[crate::vpk::entry_at(STYLE, std::sync::Arc::from(style))]);
        let base = from.and_then(|r| r.get("name").filter(|n| crate::js::truthy(n)).map(crate::js::string));
        Ok((vpk, base.unwrap_or_else(|| "game".into())))
    }

    fn name_of(parts: &[Value]) -> String {
        t("Интерфейс в игре: панелей изменено {0}", &[json!(parts.len())])
    }

    /// The record built with `parts`: in the old one's slot, or a new record.
    fn put(
        &self,
        inst: &Installer,
        lib: &mut Library,
        parts: &[Value],
        keep_off: bool,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let (vpk, base) = self.build(inst, lib, parts, log)?;
        let hud =
            parts.iter().find(|p| p["id"] == "lower_hud").and_then(|p| p.get("scale")).cloned().unwrap_or(json!(100));
        let g = json!({ "hud": hud, "base": base, "parts": parts });
        if let Some(old) = mine(lib) {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": Self::name_of(parts), "files": files_json(&files), "generated": g, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": Self::name_of(parts), "categoryId": "huds", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// What the window shows: the layout on now, if any, and the HUD mod it would go on.
    pub fn state(&self, inst: &Installer, lib: &Library) -> Value {
        let installed = mine(lib).map(|rec| {
            let g = &rec["generated"];
            json!({
                "id": rec["id"], "parts": parts_of(g), "base": g["base"],
                "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
            })
        });
        // no game yet: nothing to say
        let hud_mod = self.hud_mod(inst, lib).ok().flatten();
        json!({ "installed": installed, "hudMod": hud_mod })
    }

    /// The HUD with this layout, put in My mods in place of the one before.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        raw: &Value,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let parts = clean_parts(raw);
        let rec = self.put(inst, lib, &parts, false, log)?;
        let base = rec.get("generated").and_then(|g| g.get("base")).map(crate::js::string).unwrap_or_default();
        log(format!("hud layout: {} panels changed, from {base}", parts.len()));
        Ok(rec)
    }

    /// After a Dota update: the record among `ids` that is to be built again, which the app does
    /// once the update's repair has answered (`rebuild_now`). Nothing counts as built yet.
    pub fn due(lib: &Library, ids: &[String]) -> Option<String> {
        let rec = mine(lib)?;
        let id = rec.get("id").map(crate::js::string)?;
        ids.contains(&id).then_some(id)
    }

    /// The record built again from the style in force now, kept off when it was off; its id when it was.
    pub fn rebuild_now(&self, inst: &Installer, lib: &mut Library, log: &mut dyn FnMut(String)) -> Option<String> {
        let rec = mine(lib)?;
        let id = rec.get("id").map(crate::js::string)?;
        match self.put(inst, lib, &parts_of(&rec["generated"]), true, log) {
            Ok(_) => Some(id),
            Err(e) => {
                log(format!("hud layout: could not build again after the update: {e}"));
                None
            }
        }
    }
}
