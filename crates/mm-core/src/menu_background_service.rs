//! The menu background of the user's own as a record in My mods (src/menu-background-service.ts;
//! the pak itself is menu_background.rs). One record: a new background takes the place of the one
//! before, in its slot. The WebM is kept in userData/menu-backgrounds by its sha1, so a Dota update
//! that reached the record builds it again out of the new layouts with nothing asked of the user.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha1::{Digest, Sha1};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::menu_background::{build_background, webm_problem, Look, MAX};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn clamp(n: &Value, lo: f64, hi: f64, fallback: f64) -> f64 {
    let v = crate::js::to_number(n);
    if v.is_finite() {
        v.max(lo).min(hi)
    } else {
        fallback
    }
}

fn mine(lib: &Library) -> Option<Value> {
    lib.list()
        .iter()
        .find(|r| r.get("generated").and_then(|g| g.get("background")).is_some_and(crate::js::truthy))
        .cloned()
}

/// The service the background:* channels call, over the user's folder and the game.
pub struct MenuBackground {
    store: PathBuf,
    game: Option<PathBuf>,
}

impl MenuBackground {
    pub fn new(user_data: &Path, game: Option<PathBuf>) -> Self {
        MenuBackground { store: user_data.join("menu-backgrounds"), game }
    }

    fn movie(&self, sha: &str) -> PathBuf {
        self.store.join(format!("{sha}.webm"))
    }

    fn build(&self, g: &Value) -> Result<Vec<u8>, String> {
        let game = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        let file = self.movie(&g.get("background").map(crate::js::string).unwrap_or_default());
        if !file.exists() {
            return Err(t("Файла фона больше нет: выбери его заново", &[]));
        }
        let webm = std::fs::read(&file).map_err(io)?;
        let ix =
            crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())?;
        let read = |f: &str| ix.read(f).map_err(|e| e.to_string());
        let num = |k: &str| g.get(k).map_or(f64::NAN, crate::js::to_number);
        build_background(&read, &webm, Look { dim: num("dim"), blur: num("blur") })
    }

    fn name_of(g: &Value) -> String {
        t("Свой фон меню: {0}", &[g.get("source").cloned().unwrap_or(Value::Null)])
    }

    /// The record built from `g`: in the old one's slot, or a new record.
    fn put(&self, inst: &Installer, lib: &mut Library, g: &Value, keep_off: bool) -> Result<Value, String> {
        let vpk = self.build(g)?;
        if let Some(old) = mine(lib) {
            let off = keep_off && old.get("enabled") == Some(&Value::Bool(false));
            let files = swap_pak(inst, &old, &vpk, off)?;
            let fields = json!({
                "name": Self::name_of(g), "files": files_json(&files), "generated": g, "enabled": !off,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": Self::name_of(g), "categoryId": "backgrounds", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": g }), None).map_err(io)?.unwrap_or(Value::Null))
    }

    /// Movies no record uses any more.
    fn tidy(&self, keep: &str) {
        let keep = format!("{keep}.webm");
        for e in crate::js::read_dir(&self.store).unwrap_or_default() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".webm") && name != keep {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    /// What the window shows: the background on now, if any.
    pub fn state(lib: &Library) -> Value {
        let installed = mine(lib).map(|rec| {
            let g = &rec["generated"];
            json!({
                "id": rec["id"], "source": g["source"], "dim": g["dim"], "blur": g["blur"],
                "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
            })
        });
        json!({ "installed": installed })
    }

    /// The user's movie behind the menu; with no movie, the one on now with a new look. The look is
    /// (source, dim, blur) as the window sends them.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        webm: Option<&[u8]>,
        (source, dim, blur): (&Value, &Value, &Value),
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        let had = mine(lib).map(|r| r["generated"].clone());
        let mut sha = had.as_ref().and_then(|g| g.get("background")).map(crate::js::string);
        if let Some(bytes) = webm {
            if let Some(why) = webm_problem(bytes, MAX) {
                return Err(why);
            }
            let s = format!("{:x}", Sha1::digest(bytes));
            std::fs::create_dir_all(&self.store).map_err(io)?;
            std::fs::write(self.movie(&s), bytes).map_err(io)?;
            sha = Some(s);
        }
        let Some(sha) = sha.filter(|s| !s.is_empty()) else {
            return Err(t("Выбери картинку, GIF или видео", &[]));
        };
        let or = |a: &Value, b: Value| if crate::js::truthy(a) { a.clone() } else { b };
        let video = json!("video");
        let src = if webm.is_some() {
            or(source, video)
        } else {
            or(had.as_ref().and_then(|g| g.get("source")).unwrap_or(&Value::Null), or(source, video))
        };
        let g = json!({
            "background": sha,
            "source": crate::js::slice_utf16(&crate::js::string(&src), 120),
            "dim": crate::js::json_number(clamp(dim, 0.0, 0.9, 0.2)),
            "blur": crate::js::json_number(clamp(blur, 0.0, 20.0, 0.0)),
        });
        let rec = self.put(inst, lib, &g, false)?;
        self.tidy(&sha);
        log(format!(
            "menu background: {} on, dim {}, blur {}",
            &sha[..8.min(sha.len())],
            crate::js::string(&g["dim"]),
            crate::js::string(&g["blur"])
        ));
        Ok(rec)
    }

    /// After a Dota update: the background record among `ids` built again from the new layouts;
    /// the ids built again.
    pub fn rebuild(
        &self,
        inst: &Installer,
        lib: &mut Library,
        ids: &[String],
        log: &mut dyn FnMut(String),
    ) -> Vec<String> {
        let Some(rec) = mine(lib) else { return vec![] };
        let id = rec.get("id").map(crate::js::string).unwrap_or_default();
        if !ids.contains(&id) {
            return vec![];
        }
        match self.put(inst, lib, &rec["generated"].clone(), true) {
            Ok(_) => vec![id],
            Err(e) => {
                log(format!("menu background: could not build again after the update: {e}"));
                vec![]
            }
        }
    }
}
