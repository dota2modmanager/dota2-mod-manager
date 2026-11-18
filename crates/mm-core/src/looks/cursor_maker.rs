//! A cursor set of the user's own (the Workshop's "Own cursor"): every cursor of the game drawn by
//! the window, from one picture or one picture per cursor, and written here as Valve's files
//! (formats/cursor_files.rs). The set is a cursor record like a catalog one (cursors.rs): the same
//! loose files over resource\cursor, one set on at a time, packed back to a zip for sharing.
//!
//! The game's own cursors are read from the backup the first write over them kept, or from the
//! folder when nothing was written there: never from a file another set wrote (backups\written.json).

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};

use crate::cursor_files::{ani_from_rgba, ani_hotspot, bmp_from_rgba, parse_res, rgba_from_bmp, write_res, VSZ};
use crate::file_tx::FileTx;
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::{files_of, files_value, LibFile};
use crate::safe_zip::{sha1_hex, Source};

const RES: &str = "cursor.res";

/// Hotspots by the name cursor.res gives them.
type Spots = BTreeMap<String, (u32, u32)>;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn uri(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// The files one cursor of the game is made of.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GameCursor {
    pub name: String,
    pub ani: bool,
    pub single: bool,
    pub vsz: bool,
}

impl GameCursor {
    /// The files this cursor is written as, each with the size of its picture.
    pub fn files(&self) -> Vec<(String, u32)> {
        let mut out = Vec::new();
        if self.ani {
            out.push((format!("{}.ani", self.name), 32));
        }
        if self.single {
            out.push((format!("{}.bmp", self.name), 32));
        }
        if self.vsz {
            out.extend(VSZ.iter().enumerate().map(|(i, s)| (format!("{}_vsz{i}.bmp", self.name), *s)));
        }
        out
    }
}

/// The cursors a folder listing holds, by the names of their files.
pub fn cursors_of(names: &BTreeSet<String>) -> Vec<GameCursor> {
    static VSZ_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let vsz = VSZ_RE.get_or_init(|| regex::Regex::new(r"^(cursor_[a-z0-9_]+)_vsz[0-3]\.bmp$").unwrap());
    let mut by: BTreeMap<String, GameCursor> = BTreeMap::new();
    for n in names {
        let n = n.to_lowercase();
        let entry = |name: &str, by: &mut BTreeMap<String, GameCursor>| {
            let name = name.to_string();
            by.entry(name.clone()).or_insert_with(|| GameCursor { name, ..Default::default() }).clone()
        };
        if let Some(c) = vsz.captures(&n) {
            let mut e = entry(&c[1], &mut by);
            e.vsz = true;
            by.insert(e.name.clone(), e);
        } else if let Some(stem) = n.strip_suffix(".ani").filter(|s| s.starts_with("cursor_")) {
            let mut e = entry(stem, &mut by);
            e.ani = true;
            by.insert(e.name.clone(), e);
        } else if let Some(stem) = n.strip_suffix(".bmp").filter(|s| s.starts_with("cursor_")) {
            let mut e = entry(stem, &mut by);
            e.single = true;
            by.insert(e.name.clone(), e);
        }
    }
    // a cursor of only an .ani never shows on SDL, and Valve's test cursor is no cursor
    by.into_values()
        .filter(|c| (c.single || c.vsz) && c.name != "cursor_test" && !c.name.contains("inivisible"))
        .collect()
}

/// A cursor drawn by the window: its hotspot as a share of the picture, and a PNG per size.
pub struct Drawn {
    pub name: String,
    pub hot: (f64, f64),
    pub pngs: BTreeMap<u32, Vec<u8>>,
}

/// The files of a set: every drawn cursor in the files its game cursor is made of, and cursor.res
/// with the drawn hotspots over the game's.
pub fn set_files(
    game: &[GameCursor],
    game_res: &BTreeMap<String, (u32, u32)>,
    drawn: &[Drawn],
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut res = game_res.clone();
    let mut out = Vec::new();
    for d in drawn {
        let Some(g) = game.iter().find(|g| g.name == d.name) else { continue };
        let spot = |size: u32| {
            let at = |v: f64| ((v.clamp(0.0, 1.0) * size as f64).round() as u32).min(size - 1);
            (at(d.hot.0), at(d.hot.1))
        };
        for (file, size) in g.files() {
            let png = d.pngs.get(&size).ok_or_else(|| format!("{}: no picture of {size}px", d.name))?;
            let (px, w, h) = crate::png_paint::decode_rgba(png)?;
            if (w, h) != (size, size) {
                return Err(format!("{}: the picture is {w}x{h}, not {size}x{size}", d.name));
            }
            let bytes = if file.ends_with(".ani") {
                ani_from_rgba(&px, size, spot(size))
            } else {
                bmp_from_rgba(&px, size, size)
            };
            if let Some(stem) = file.strip_suffix(".bmp").filter(|s| s.contains("_vsz")) {
                res.insert(stem.to_string(), spot(size));
            }
            out.push((file, bytes));
        }
        res.insert(d.name.clone(), spot(32));
    }
    if out.is_empty() {
        return Err(t("Нет ни одного своего курсора", &[]));
    }
    out.push((RES.to_string(), write_res(&res).into_bytes()));
    Ok(out)
}

fn mine(lib: &Library) -> Option<Value> {
    lib.list().iter().find(|r| r.get("generated").and_then(|g| g.get("cursor")).is_some_and(Value::is_object)).cloned()
}

/// The service the cursor:* channels call.
pub struct CursorMaker {
    pictures: PathBuf,
}

impl CursorMaker {
    pub fn new(user_data: &Path) -> Self {
        CursorMaker { pictures: user_data.join("cursor-maker") }
    }

    /// The game's own copy of a file in resource\cursor, if the game has one.
    fn game_file(inst: &Installer, written: &serde_json::Map<String, Value>, rel: &str) -> Option<Vec<u8>> {
        let backup = inst.backups_dir().join("cursor").join(rel);
        if let Ok(b) = fs::read(&backup) {
            return Some(b);
        }
        let live = fs::read(inst.live_dir("cursor").ok()?.join(rel)).ok()?;
        // a file a set wrote where the game had none
        let ours = written.get(&format!("cursor/{}", rel.to_lowercase())).and_then(Value::as_str);
        (ours != Some(sha1_hex(&live).as_str())).then_some(live)
    }

    fn game_cursors(inst: &Installer) -> Result<(Vec<GameCursor>, Spots), String> {
        let written = inst.written();
        let mut names = BTreeSet::new();
        for dir in [inst.live_dir("cursor")?, inst.backups_dir().join("cursor")] {
            for e in fs::read_dir(&dir).into_iter().flatten().flatten() {
                if e.file_type().is_ok_and(|t| t.is_file()) {
                    names.insert(e.file_name().to_string_lossy().to_string());
                }
            }
        }
        let names: BTreeSet<String> =
            names.into_iter().filter(|n| Self::game_file(inst, &written, n).is_some()).collect();
        let res =
            Self::game_file(inst, &written, RES).map(|b| parse_res(&String::from_utf8_lossy(&b))).unwrap_or_default();
        let list = cursors_of(&names);
        if list.is_empty() {
            return Err(t("В папке игры нет курсоров (resource\\cursor)", &[]));
        }
        Ok((list, res))
    }

    /// What the window shows: the game's cursors, each with its largest picture and its hotspot as a
    /// share of the picture, and the set of the user's own, if one was made.
    pub fn state(&self, inst: &Installer, lib: &Library) -> Result<Value, String> {
        let (game, res) = Self::game_cursors(inst)?;
        let written = inst.written();
        let cursors: Vec<Value> = game
            .iter()
            .filter_map(|g| {
                let (file, size) = g.files().into_iter().filter(|f| f.0.ends_with(".bmp")).max_by_key(|f| f.1)?;
                let (px, w, h) = rgba_from_bmp(&Self::game_file(inst, &written, &file)?).ok()?;
                let png = crate::png_paint::encode_rgba(&px, w, h).ok()?;
                let stem = file.trim_end_matches(".bmp");
                let ani = Self::game_file(inst, &written, &format!("{}.ani", g.name)).and_then(|a| ani_hotspot(&a));
                let (hx, hy, of) = match (res.get(stem).copied(), res.get(&g.name).copied(), ani) {
                    (Some(s), _, _) => (s.0, s.1, size),
                    (None, Some(s), _) | (None, None, Some(s)) => (s.0, s.1, 32),
                    _ => (0, 0, 32),
                };
                Some(json!({
                    "name": g.name, "sizes": g.files().iter().map(|f| f.1).collect::<BTreeSet<_>>(),
                    "picture": uri(&png), "width": w, "hot": [hx as f64 / of as f64, hy as f64 / of as f64],
                }))
            })
            .collect();
        let installed = mine(lib).map(|rec| {
            let design = rec["generated"]["cursor"].clone();
            let pictures: serde_json::Map<String, Value> = design
                .get("pictures")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|id| Some((id.to_string(), json!(uri(&fs::read(self.picture_path(id)?).ok()?)))))
                .collect();
            json!({
                "id": rec["id"], "design": design, "pictures": pictures,
                "enabled": rec.get("enabled") != Some(&Value::Bool(false)),
            })
        });
        let packs = inst.live_dir("cursor").map(|d| packs_in(&d)).unwrap_or_default();
        Ok(json!({ "cursors": cursors, "packs": packs, "installed": installed }))
    }
}

/// The cursor sets the game ships for its cosmetics (resource\cursor\valve\* and workshop\*): a
/// BMP per cursor and a cursor.res of their own. Each as `{ id, cursors: { name: { picture, hot } } }`,
/// the hotspot a share of the picture.
pub fn packs_in(cursor_dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    for group in ["valve", "workshop"] {
        let mut dirs: Vec<PathBuf> = fs::read_dir(cursor_dir.join(group))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        for dir in dirs {
            let names: BTreeSet<String> = fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            let res = fs::read(dir.join(RES)).map(|b| parse_res(&String::from_utf8_lossy(&b))).unwrap_or_default();
            let mut cursors = serde_json::Map::new();
            for c in cursors_of(&names).into_iter().filter(|c| c.single) {
                let Ok(bytes) = fs::read(dir.join(format!("{}.bmp", c.name))) else { continue };
                let Ok((px, w, h)) = rgba_from_bmp(&bytes) else { continue };
                let Ok(png) = crate::png_paint::encode_rgba(&px, w, h) else { continue };
                let (hx, hy) = res.get(&c.name).copied().unwrap_or((0, 0));
                let share = |v: u32, of: u32| (v as f64 / of.max(1) as f64).min(1.0);
                cursors.insert(c.name, json!({ "picture": uri(&png), "hot": [share(hx, w), share(hy, h)] }));
            }
            if cursors.is_empty() {
                continue;
            }
            let leaf = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(json!({ "id": format!("{group}/{leaf}"), "cursors": cursors }));
        }
    }
    out
}

impl CursorMaker {
    fn picture_path(&self, id: &str) -> Option<PathBuf> {
        (id.len() == 40 && id.bytes().all(|b| b.is_ascii_hexdigit())).then(|| self.pictures.join(format!("{id}.png")))
    }

    /// The user's pictures kept by their sha1, so the window opens on them again.
    fn keep_pictures(&self, pictures: &[(String, Vec<u8>)]) -> Result<(), String> {
        for (id, png) in pictures {
            let path = self.picture_path(id).ok_or_else(|| t("Не та картинка", &[]))?;
            if sha1_hex(png) != *id {
                return Err(t("Не та картинка", &[]));
            }
            crate::png_paint::decode_rgba(png)?;
            fs::create_dir_all(&self.pictures).map_err(io)?;
            if !path.exists() {
                fs::write(&path, png).map_err(io)?;
            }
        }
        Ok(())
    }

    /// The set built and put in My mods, in the place of the one made before; the other sets go off.
    pub fn install(
        &self,
        inst: &Installer,
        lib: &mut Library,
        design: &Value,
        drawn: &[Drawn],
        pictures: &[(String, Vec<u8>)],
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        inst.require_game_folder()?;
        let (game, res) = Self::game_cursors(inst)?;
        let files = set_files(&game, &res, drawn)?;
        self.keep_pictures(pictures)?;
        let name = t("Свой курсор", &[]);
        let folder = "own_cursor";
        let entries: Vec<(String, Vec<u8>)> =
            files.into_iter().map(|(f, b)| (format!("{folder}/cursor/{f}"), b)).collect();
        let zip = crate::safe_zip::write_zip(&entries)?;
        let old = mine(lib);
        let own_id = old.as_ref().map(|r| r["id"].clone());
        crate::cursors::disable_other_cursors(inst, lib, own_id.as_ref());
        if let Some(old) = &old {
            let deployed = old.get("enabled") != Some(&Value::Bool(false));
            inst.remove(&files_of(&old["files"]), old["id"].as_str(), deployed)?;
        }
        let mut design = design.clone();
        design["pictures"] = json!(pictures.iter().map(|p| p.0.clone()).collect::<Vec<_>>());
        let generated = json!({ "cursor": design });
        let rec = FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| -> Result<Value, String> {
            let written: Vec<LibFile> = inst.install_cursor(Source::Bytes(zip.clone()), &name, Some(tx))?;
            match &old {
                Some(old) => {
                    let fields = json!({
                        "name": name, "files": files_value(&written), "generated": generated, "enabled": true,
                        "updatedAt": crate::js::json_number(crate::library::now()),
                    });
                    Ok(lib.update(&old["id"], &fields, Some(tx)).map_err(io)?.unwrap_or(Value::Null))
                }
                None => {
                    let new = json!({
                        "name": name, "categoryId": "cursors", "styleLabel": null, "fileRef": null, "preview": null,
                        "files": files_value(&written),
                    });
                    // add() keeps only a catalog record's own fields: what the app built goes on after
                    let made = lib.add(&new, Some(&mut *tx)).map_err(io)?;
                    let fields = json!({ "generated": generated });
                    Ok(lib.update(&made["id"], &fields, Some(tx)).map_err(io)?.unwrap_or(Value::Null))
                }
            }
        })?;
        let id = crate::js::string(&rec["id"]);
        let _ = inst.ensure_cursor_store(Some(&id), &files_of(&rec["files"]));
        if inst.master_is_off().unwrap_or(false) {
            crate::cursors::apply_master_to_cursors(inst, lib, false);
        }
        log(format!("own cursor: {} cursors, {} files", drawn.len(), entries.len()));
        Ok(rec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_folder_listing_groups_into_cursors() {
        let list = cursors_of(&names(&[
            "cursor.res",
            "cursor_default.ani",
            "cursor_default_vsz0.bmp",
            "cursor_default_vsz1.bmp",
            "cursor_default_vsz2.bmp",
            "cursor_default_vsz3.bmp",
            "cursor_buy.ani",
            "cursor_buy.bmp",
            "cursor_db_ibeam.bmp",
            "cursor_test.ani",
            "cursor_test.bmp",
            "cursor_inivisible.bmp",
        ]));
        let by: BTreeMap<_, _> = list.iter().map(|c| (c.name.as_str(), c)).collect();
        assert_eq!(by.len(), 3);
        assert!(by["cursor_default"].ani && by["cursor_default"].vsz && !by["cursor_default"].single);
        assert_eq!(
            by["cursor_buy"].files(),
            vec![("cursor_buy.ani".to_string(), 32), ("cursor_buy.bmp".to_string(), 32)]
        );
        assert_eq!(by["cursor_db_ibeam"].files().len(), 1);
        assert_eq!(by["cursor_default"].files().len(), 5);
    }

    fn png(size: u32) -> Vec<u8> {
        crate::png_paint::encode_rgba(&vec![255; (size * size * 4) as usize], size, size).unwrap()
    }

    #[test]
    fn a_drawn_cursor_is_written_as_the_game_files_it_and_its_hotspots() {
        let game = vec![
            GameCursor { name: "cursor_spell_default".into(), ani: true, vsz: true, single: false },
            GameCursor { name: "cursor_buy".into(), ani: true, single: true, vsz: false },
        ];
        let mut res = BTreeMap::new();
        res.insert("cursor_buy".to_string(), (14, 14));
        let drawn = vec![Drawn {
            name: "cursor_spell_default".into(),
            hot: (0.5, 0.5),
            pngs: VSZ.iter().map(|s| (*s, png(*s))).collect(),
        }];
        let files = set_files(&game, &res, &drawn).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(
            names,
            [
                "cursor_spell_default.ani",
                "cursor_spell_default_vsz0.bmp",
                "cursor_spell_default_vsz1.bmp",
                "cursor_spell_default_vsz2.bmp",
                "cursor_spell_default_vsz3.bmp",
                "cursor.res",
            ]
        );
        assert_eq!(ani_hotspot(&files[0].1), Some((16, 16)));
        let res = parse_res(&String::from_utf8_lossy(&files[5].1));
        assert_eq!(res["cursor_spell_default_vsz3"], (48, 48));
        assert_eq!(res["cursor_spell_default_vsz2"], (36, 36));
        // the game's own hotspots stay for the cursors not drawn
        assert_eq!(res["cursor_buy"], (14, 14));
    }

    #[test]
    fn a_picture_of_the_wrong_size_is_refused() {
        let game = vec![GameCursor { name: "cursor_buy".into(), ani: false, single: true, vsz: false }];
        let drawn = vec![Drawn { name: "cursor_buy".into(), hot: (0.0, 0.0), pngs: [(32, png(48))].into() }];
        assert!(set_files(&game, &BTreeMap::new(), &drawn).is_err());
    }

    /// A throwaway game with one cursor of Valve's, and the app's folder beside it.
    fn game_tree(name: &str) -> (PathBuf, Installer, Library) {
        let root = std::env::temp_dir().join(format!("mm-cursor-maker-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let game = root.join("game");
        let cursor = crate::installer_folder::CURSOR_SUBDIR.iter().fold(game.clone(), |p, s| p.join(s));
        fs::create_dir_all(&cursor).unwrap();
        fs::write(game.join("dota").join("pak01_dir.vpk"), b"").unwrap();
        let px = vec![9u8; 32 * 32 * 4];
        fs::write(cursor.join("cursor_default.ani"), ani_from_rgba(&px, 32, (0, 0))).unwrap();
        for (i, s) in VSZ.iter().enumerate() {
            let px = vec![9u8; (s * s * 4) as usize];
            fs::write(cursor.join(format!("cursor_default_vsz{i}.bmp")), bmp_from_rgba(&px, *s, *s)).unwrap();
        }
        fs::write(cursor.join(RES), write_res(&[("cursor_default".to_string(), (0, 0))].into())).unwrap();
        let ud = root.join("ud");
        fs::create_dir_all(&ud).unwrap();
        let mut inst = Installer::new(Some(game), "russian");
        inst.user_data = ud.clone();
        (root, inst, Library::new(&ud))
    }

    #[test]
    fn the_set_is_one_record_built_again_in_its_place_and_off_puts_the_game_back() {
        let (root, inst, mut lib) = game_tree("cycle");
        let live = inst.live_dir("cursor").unwrap();
        let valve = fs::read(live.join("cursor_default_vsz3.bmp")).unwrap();
        let drawn = || {
            vec![Drawn {
                name: "cursor_default".into(),
                hot: (0.1, 0.2),
                pngs: VSZ.iter().map(|s| (*s, png(*s))).collect(),
            }]
        };
        let design = json!({ "color": "#ffffff" });
        let first =
            CursorMaker::new(&inst.user_data).install(&inst, &mut lib, &design, &drawn(), &[], &mut |_| {}).unwrap();
        assert_eq!(first["generated"]["cursor"]["color"], "#ffffff", "{first}");
        assert_ne!(fs::read(live.join("cursor_default_vsz3.bmp")).unwrap(), valve);
        assert_eq!(parse_res(&fs::read_to_string(live.join(RES)).unwrap())["cursor_default_vsz3"], (10, 19));
        // the state reads the game's own cursor from the backup, not the set written over it
        let state = CursorMaker::new(&inst.user_data).state(&inst, &lib).unwrap();
        assert_eq!(state["installed"]["id"], first["id"]);
        assert_eq!(state["cursors"][0]["hot"], json!([0.0, 0.0]));

        let again = json!({ "color": "#000000" });
        let second =
            CursorMaker::new(&inst.user_data).install(&inst, &mut lib, &again, &drawn(), &[], &mut |_| {}).unwrap();
        assert_eq!(second["id"], first["id"]);
        assert_eq!(lib.list().len(), 1);
        assert_eq!(second["generated"]["cursor"]["color"], "#000000");

        inst.set_enabled(&files_of(&second["files"]), false, second["id"].as_str()).unwrap();
        assert_eq!(fs::read(live.join("cursor_default_vsz3.bmp")).unwrap(), valve);
        let _ = fs::remove_dir_all(root);
    }

    /// The game's own cursors, read and written again, keep their layout (MM_TEST_CURSORS: the
    /// game's resource\cursor folder).
    #[test]
    fn the_game_cursors_read_back() {
        let Ok(dir) = std::env::var("MM_TEST_CURSORS") else { return };
        let dir = PathBuf::from(dir);
        let names: BTreeSet<String> =
            fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        let list = cursors_of(&names);
        assert!(list.len() >= 15, "{list:?}");
        // the cosmetic sets: each has its default cursor, hotspots within the picture
        let packs = packs_in(&dir);
        assert!(packs.len() >= 20, "{}", packs.len());
        for p in &packs {
            assert!(p["cursors"].get("cursor_default").is_some(), "{}", p["id"]);
            for c in p["cursors"].as_object().unwrap().values() {
                assert!(c["hot"][0].as_f64().unwrap() <= 1.0);
            }
        }
        for c in &list {
            for (file, size) in c.files() {
                let data = fs::read(dir.join(&file)).unwrap();
                if file.ends_with(".bmp") {
                    let (px, w, h) = rgba_from_bmp(&data).unwrap();
                    assert_eq!(w, h, "{file}");
                    let _ = size;
                    assert_eq!(rgba_from_bmp(&bmp_from_rgba(&px, w, h)).unwrap().0, px, "{file}");
                } else {
                    assert!(ani_hotspot(&data).is_some(), "{file}");
                }
            }
        }
    }
}
