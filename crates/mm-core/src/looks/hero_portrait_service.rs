//! A hero's portrait in the hero picker of the user's own: the picture the grid shows and the
//! movie it plays while the pointer is on the hero. One record in My mods per hero.
//!
//! Neither needs Valve's compiler. A panorama picture is a small resource header with a PNG
//! appended (vtex.rs), so the user's PNG goes after the header of the game's own file, cut by the
//! window to that file's size. The few portraits the game keeps block-compressed take the header
//! of a PNG portrait of the same size in the same folder. The picker's movie is a plain WebM the
//! game keeps as a loose file under panorama/videos/heroes, and the pak carries it at that path.
//!
//! The files the user gave are kept in userData/hero-portraits by their sha1, so a record can be
//! built again with nothing asked of the user.

use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};

use crate::generated_pak::{files_json, swap_pak, write_pak};
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::vpk::Index;

/// The most a picker movie may weigh; the game's own are 0.5 to 4.5 MB.
pub const MAX_MOVIE: usize = 16 * 1024 * 1024;
/// The most one picture may weigh.
pub const MAX_STILL: usize = 4 * 1024 * 1024;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

/// A hero id as the game names its files after npc_dota_hero_.
pub fn hero_ok(hero: &str) -> bool {
    Regex::new(r"^[a-z0-9_]{2,40}$").expect("a fixed pattern").is_match(hero)
}

/// The pictures of a hero the picker draws: the tall one of the grid first, then the wide one.
pub fn still_paths(hero: &str) -> [String; 2] {
    [
        format!("panorama/images/heroes/selection/npc_dota_hero_{hero}_png.vtex_c"),
        format!("panorama/images/heroes/npc_dota_hero_{hero}_png.vtex_c"),
    ]
}

/// The movie the picker plays for a hero.
pub fn movie_path(hero: &str) -> String {
    format!("panorama/videos/heroes/npc_dota_hero_{hero}.webm")
}

/// A picture a portrait is written over: its path, its size, and the header the PNG goes after.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub path: String,
    pub width: u16,
    pub height: u16,
    pub header: Vec<u8>,
}

/// The header of a PNG panorama picture, and its size; None for one that is not a PNG inside.
fn png_header(file: &[u8]) -> Option<(Vec<u8>, u16, u16)> {
    let png = crate::vtex::png_from_vtex(file)?;
    let (w, h) = crate::panorama_files::texture_size(file).ok()?;
    Some((file[..file.len() - png.len()].to_vec(), w, h))
}

/// Where the hero's portraits go and what each is written with. A block-compressed picture takes
/// the header of a PNG picture of the same folder, of its size when there is one.
pub fn targets(ix: &Index, hero: &str) -> Vec<Target> {
    let mut out = Vec::new();
    for path in still_paths(hero) {
        let Some(file) = ix.read(&path).ok().flatten() else { continue };
        if let Some((header, width, height)) = png_header(&file) {
            out.push(Target { path, width, height, header });
            continue;
        }
        let want = crate::panorama_files::texture_size(&file).ok();
        let dir = &path[..path.rfind('/').map_or(0, |i| i + 1)];
        let mut any: Option<(Vec<u8>, u16, u16)> = None;
        let mut same: Option<(Vec<u8>, u16, u16)> = None;
        for p in
            ix.paths().filter(|p| p.starts_with(dir) && !p[dir.len()..].contains('/') && p.ends_with("_png.vtex_c"))
        {
            let Some(h) = ix.read(p).ok().flatten().and_then(|f| png_header(&f)) else { continue };
            if want == Some((h.1, h.2)) {
                same = Some(h);
                break;
            }
            if any.is_none() {
                any = Some(h);
            }
        }
        if let Some((header, width, height)) = same.or(any) {
            out.push(Target { path, width, height, header });
        }
    }
    out
}

/// The heroes the picker has a portrait for, by id: the ones with a script of their own, so the
/// personas and the event looks stay out.
pub fn heroes(ix: &Index) -> Vec<String> {
    let pic = Regex::new(r"^panorama/images/heroes/selection/npc_dota_hero_([a-z0-9_]+)_png\.vtex_c$")
        .expect("a fixed pattern");
    let mut out: Vec<String> = ix
        .paths()
        .filter_map(|p| pic.captures(p).map(|c| c[1].to_string()))
        .filter(|h| ix.has(&format!("scripts/npc/heroes/npc_dota_hero_{h}.txt")))
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The files of the pak: each picture after its header, and the movie at the picker's path.
pub fn entries(
    targets: &[Target],
    stills: &Map<String, Value>,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    movie: Option<(&str, Vec<u8>)>,
) -> Vec<crate::vpk::Entry> {
    let mut out = Vec::new();
    for tg in targets {
        let Some(png) = stills.get(&tg.path).map(crate::js::string).and_then(|sha| read(&format!("{sha}.png"))) else {
            continue;
        };
        let mut file = tg.header.clone();
        file.extend(png);
        out.push(crate::vpk::entry_at(&tg.path, file.into()));
    }
    if let Some((path, webm)) = movie {
        out.push(crate::vpk::entry_at(path, webm.into()));
    }
    out
}

fn is_png(b: &[u8]) -> bool {
    b.len() > 24 && b[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
}

/// The PNG's width and height from its header.
fn png_size(b: &[u8]) -> (u32, u32) {
    let at = |i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    (at(16), at(20))
}

/// The service the portraits:* channels call, over the user's folder and the game.
pub struct HeroPortraits {
    store: PathBuf,
    game: Option<PathBuf>,
}

fn record_of(lib: &Library, hero: &str) -> Option<Value> {
    lib.list()
        .iter()
        .find(|r| r.get("generated").and_then(|g| g.get("heroPortrait")).and_then(Value::as_str) == Some(hero))
        .cloned()
}

impl HeroPortraits {
    pub fn new(user_data: &Path, game: Option<PathBuf>) -> Self {
        HeroPortraits { store: user_data.join("hero-portraits"), game }
    }

    fn pak01(&self) -> Result<std::sync::Arc<Index>, String> {
        let g = self.game.as_ref().ok_or_else(|| t("Не указана папка игры", &[]))?;
        crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).map_err(|e| e.to_string())
    }

    fn keep(&self, bytes: &[u8], ext: &str) -> Result<String, String> {
        let sha = format!("{:x}", Sha1::digest(bytes));
        std::fs::create_dir_all(&self.store).map_err(io)?;
        let to = self.store.join(format!("{sha}.{ext}"));
        if !to.exists() {
            crate::file_tx::write_into(bytes, &to, None).map_err(io)?;
        }
        Ok(sha)
    }

    fn read_kept(&self, name: &str) -> Option<Vec<u8>> {
        std::fs::read(self.store.join(name)).ok()
    }

    /// Every hero with his name, and what of his is on now.
    pub fn state(&self, lib: &Library) -> Result<Value, String> {
        let ix = self.pak01()?;
        let list: Vec<Value> = heroes(&ix)
            .into_iter()
            .map(|h| json!({ "hero": h, "name": crate::hero_names::display_name(&h) }))
            .collect();
        let mut own = Map::new();
        for r in lib.list() {
            let Some(g) = r.get("generated").filter(|g| g.get("heroPortrait").is_some()) else { continue };
            own.insert(
                crate::js::string(&g["heroPortrait"]),
                json!({
                    "still": g.get("stills").and_then(Value::as_object).is_some_and(|m| !m.is_empty()),
                    "movie": g.get("movie").is_some_and(crate::js::truthy),
                    "enabled": r.get("enabled") != Some(&Value::Bool(false)),
                }),
            );
        }
        Ok(json!({ "heroes": list, "own": own }))
    }

    /// One hero for the window: the sizes his pictures are cut to, the game's movie and the
    /// user's own picture and movie, each as a data URI.
    pub fn hero(&self, lib: &Library, hero: &str) -> Result<Value, String> {
        if !hero_ok(hero) {
            return Err(t("Нет такого героя: {0}", &[json!(hero)]));
        }
        let ix = self.pak01()?;
        let tg: Vec<Value> = targets(&ix, hero)
            .iter()
            .map(|t| json!({ "path": t.path, "width": t.width, "height": t.height }))
            .collect();
        let game_movie = self.game.as_ref().and_then(|g| std::fs::read(g.join("dota").join(movie_path(hero))).ok());
        let uri = |kind: &str, b: &[u8]| {
            use base64::Engine;
            format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(b))
        };
        let g = record_of(lib, hero).map(|r| r["generated"].clone()).unwrap_or(Value::Null);
        let first = still_paths(hero)[0].clone();
        let own_still = g
            .get("stills")
            .and_then(|s| s.get(&first))
            .map(crate::js::string)
            .and_then(|s| self.read_kept(&format!("{s}.png")));
        let own_movie = g
            .get("movie")
            .filter(|m| crate::js::truthy(m))
            .map(crate::js::string)
            .and_then(|s| self.read_kept(&format!("{s}.webm")));
        Ok(json!({
            "hero": hero, "name": crate::hero_names::display_name(hero), "targets": tg,
            "gameMovie": game_movie.map(|b| uri("video/webm", &b)),
            "ownStill": own_still.map(|b| uri("image/png", &b)),
            "ownMovie": own_movie.map(|b| uri("video/webm", &b)),
            "source": g.get("source").cloned().unwrap_or(Value::Null),
        }))
    }

    /// The user's pictures (one PNG per target path, cut to its size) and movie on the hero; a
    /// part left out stays as it is, `drop` takes the named parts ("still", "movie") off.
    #[allow(clippy::too_many_arguments)]
    pub fn set(
        &self,
        inst: &Installer,
        lib: &mut Library,
        hero: &str,
        stills: &Map<String, Value>,
        movie: Option<&[u8]>,
        drop: &[String],
        source: &str,
        log: &mut dyn FnMut(String),
    ) -> Result<Value, String> {
        if !hero_ok(hero) {
            return Err(t("Нет такого героя: {0}", &[json!(hero)]));
        }
        let ix = self.pak01()?;
        let tg = targets(&ix, hero);
        let old = record_of(lib, hero);
        let had = old.as_ref().map(|r| r["generated"].clone()).unwrap_or(Value::Null);
        let mut kept: Map<String, Value> = had.get("stills").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut movie_sha = had.get("movie").filter(|m| crate::js::truthy(m)).map(crate::js::string);
        if drop.iter().any(|d| d == "still") {
            kept.clear();
        }
        if drop.iter().any(|d| d == "movie") {
            movie_sha = None;
        }
        for (path, v) in stills {
            let Some(target) = tg.iter().find(|t| &t.path == path) else { continue };
            let Some(png) = crate::owner::bytes_of(v)? else { continue };
            if !is_png(&png) || png.len() > MAX_STILL {
                return Err(t("Картинка должна быть PNG до 4 МБ", &[]));
            }
            if png_size(&png) != (target.width as u32, target.height as u32) {
                return Err(t("Картинка не того размера: нужно {0}x{1}", &[json!(target.width), json!(target.height)]));
            }
            kept.insert(path.clone(), json!(self.keep(&png, "png")?));
        }
        if let Some(webm) = movie {
            if let Some(why) = crate::menu_background::webm_problem(webm, MAX_MOVIE) {
                return Err(why);
            }
            movie_sha = Some(self.keep(webm, "webm")?);
        }
        let read = |n: &str| self.read_kept(n);
        let movie_file = movie_sha.as_ref().and_then(|s| read(&format!("{s}.webm")));
        let mp = movie_path(hero);
        let list = entries(&tg, &kept, &read, movie_file.map(|b| (mp.as_str(), b)));
        if list.is_empty() {
            if let Some(old) = old {
                let id = old["id"].clone();
                inst.remove(&crate::overlays::files_of(&old["files"]), Some(&crate::js::string(&id)), true)?;
                lib.remove_record(&id, None).map_err(io)?;
            }
            log(format!("hero portrait: {hero} back to the game's"));
            return Ok(Value::Null);
        }
        let vpk = crate::vpk::build(&list);
        let src = if source.is_empty() {
            had.get("source").map(crate::js::string).unwrap_or_default()
        } else {
            source.to_string()
        };
        let name = t("Портрет в выборе героя: {0}", &[json!(crate::hero_names::display_name(hero))]);
        let generated = json!({
            "heroPortrait": hero, "stills": kept, "movie": movie_sha,
            "source": crate::js::slice_utf16(&src, 120),
        });
        log(format!("hero portrait: {hero}, {} file(s)", list.len()));
        if let Some(old) = old {
            let files = swap_pak(inst, &old, &vpk, false)?;
            let fields = json!({
                "name": name, "files": files_json(&files), "generated": generated, "enabled": true,
                "updatedAt": crate::js::json_number(crate::library::now()),
            });
            return Ok(lib.update(&old["id"], &fields, None).map_err(io)?.unwrap_or(Value::Null));
        }
        let files = write_pak(inst, &vpk)?;
        let new = json!({
            "name": name, "categoryId": "hero-items", "styleLabel": null, "fileRef": null, "preview": null,
            "files": files_json(&files),
        });
        let made = lib.add(&new, None).map_err(io)?;
        Ok(lib.update(&made["id"], &json!({ "generated": generated }), None).map_err(io)?.unwrap_or(Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        crate::png_strip::encode_png(w, h, &vec![200u8; (w * h * 4) as usize])
    }

    #[test]
    fn a_picture_goes_after_the_header_of_its_target_and_the_movie_at_the_picker_path() {
        let tg = vec![Target { path: still_paths("axe")[0].clone(), width: 2, height: 3, header: vec![9, 9, 9] }];
        let p = png(2, 3);
        let mut stills = Map::new();
        stills.insert(tg[0].path.clone(), json!("abc"));
        let read = |n: &str| (n == "abc.png").then(|| p.clone());
        let out = entries(&tg, &stills, &read, Some((&movie_path("axe"), b"webm".to_vec())));
        assert_eq!(out.len(), 2);
        let built = crate::vpk::build(&out);
        assert!(built.len() > p.len());
        assert_eq!(movie_path("axe"), "panorama/videos/heroes/npc_dota_hero_axe.webm");
    }

    #[test]
    fn a_png_is_known_with_its_size_and_a_hero_id_is_checked() {
        let p = png(142, 188);
        assert!(is_png(&p));
        assert_eq!(png_size(&p), (142, 188));
        assert!(hero_ok("abyssal_underlord"));
        assert!(!hero_ok("../axe"));
        assert!(!hero_ok("Axe"));
    }

    #[test]
    fn the_game_portraits_have_a_target_each_when_pak01_is_given() {
        let Ok(p) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = Index::open(Path::new(&p)).unwrap();
        let hs = heroes(&ix);
        assert!(hs.contains(&"axe".to_string()) && !hs.iter().any(|h| h.ends_with("_alt")));
        for h in ["axe", "kez", "largo"] {
            let tg = targets(&ix, h);
            assert_eq!(tg.len(), 2, "{h}");
            assert!(tg[0].width > 0 && tg[0].height > 0, "{h}");
        }
    }
}
