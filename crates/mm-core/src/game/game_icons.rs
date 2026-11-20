//! Pictures taken from the installed game: an item's picture by the item table's
//! `image_inventory`, a hero's portrait, an ability's icon. Most are a PNG behind a short header in
//! pak01 and come out by slicing it off; the rest are block-compressed and need the toolchain's
//! decoder, fetched only if the user asked for it. Everything lands in one cache in userData.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use indexmap::IndexMap;
use regex::Regex;
use sha1::{Digest, Sha1};

/// Enough to fill a screen of tiles in one go; the window asks in batches of 24.
const MAX_PER_CALL: usize = 60;
const TOOL_TIMEOUT_MS: u64 = 60_000;

/// The pictures, over the game folder and the decoder when there is one.
pub struct GameIcons {
    pub root: PathBuf,
    /// item name -> image_inventory path, and the build of the game it was read from
    index: Mutex<Option<(String, HashMap<String, String>)>>,
}

/// How the cached pictures are made. 2: a block-compressed icon is cut to the size the game
/// shows (vtex.rs fill_size); before, an item's 256x170 picture was kept as the 256x256 texture
/// it is stored in, with 86 rows of smear under it. 3: a picture wider than a tile is kept at a
/// tile's size (picture_shrink.rs); a loading screen was kept at 1920x1080, megabytes each.
const CACHE_KIND: u32 = 3;

/// The prefix of a name asked for at the game's own size, for the one picture a window shows
/// large: a loading screen cut down for its tile is soft across the whole modal.
pub const FULL_SIZE: &str = "big:";

/// The list of pictures the game does not have, beside the cache.
const ABSENT: &str = "absent.txt";

/// A cached picture written whole or not at all (GameIcons::keep says why): to a name of its own,
/// then renamed in. A rename that loses to a reader holding the file leaves the one there.
pub(crate) fn write_whole(file: &Path, buf: &[u8]) -> bool {
    let tmp = file.with_extension(format!("{}.part", uuid::Uuid::new_v4().simple()));
    if std::fs::write(&tmp, buf).is_err() {
        return false;
    }
    let ok = std::fs::rename(&tmp, file).is_ok() || file.exists();
    let _ = std::fs::remove_file(&tmp);
    ok
}

fn safe_name(image_path: &str) -> String {
    let hex: String = Sha1::digest(image_path.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    format!("{}.png", &hex[..16])
}

/// The texture a picture is in: an item's picture under panorama/images, or, for a loading screen
/// whose table names the screen itself rather than a picture, that texture.
fn texture_path(image_path: &str) -> String {
    if image_path.ends_with(".vtex") {
        format!("panorama/images/{image_path}_c")
    } else {
        format!("panorama/images/{image_path}_png.vtex_c")
    }
}

/// Where an item's picture is, when the path the table names is not in the pak: the table has a
/// few with a digit too many ("herald_khorne_head1" for "herald_khorne_head"), and the stock
/// siege creeps have no picture of their own, where the stock creeps of their side do.
fn picture_at(pak: Option<&crate::vpk::Index>, image: &str) -> Option<String> {
    let Some(pak) = pak else { return Some(image.to_string()) };
    let mut tries = vec![image.to_string()];
    if image.ends_with(|c: char| c.is_ascii_digit()) {
        tries.push(image[..image.len() - 1].to_string());
    }
    if let Some((dir, _)) = image.rsplit_once('/') {
        if let Some(folder) = dir.rsplit('/').next() {
            tries.push(format!("{dir}/{folder}"));
        }
    }
    if image.contains("_siege_creeps") {
        tries.push(image.replace("_siege_creeps", "_creeps"));
    }
    tries.into_iter().find(|t| pak.has(&texture_path(t)))
}

/// Item name -> its picture's path, for every item that has one in the game.
///
/// The names are the table's bytes read as latin1, and the window asks by the name it shows,
/// the same bytes read as UTF-8: "Odogaron Cape β" was asked for as one and kept as the other,
/// and two dozen looks came out without a picture. Both spellings are kept.
fn picture_index(
    text: &[u8],
    items: &[crate::schema::SchemaItem],
    pak: Option<&crate::vpk::Index>,
) -> HashMap<String, String> {
    let stand_in = Regex::new(r"(?i)(^|/)testitem_slot_empty$").unwrap();
    let mut map: HashMap<String, String> = HashMap::new();
    for it in items {
        if it.image.is_empty() || it.name.is_empty() || stand_in.is_match(&it.image) {
            continue;
        }
        if let Some(at) = picture_at(pak, &it.image.to_lowercase()) {
            map.insert(it.name.clone(), at);
        }
    }
    // a loading screen with the empty slot's picture: the screen itself, which its visuals name
    let screen = Regex::new(r#"(?i)"asset"\s+"([^"]+\.vtex)""#).unwrap();
    for it in items.iter().filter(|i| i.prefab == "loading_screen") {
        if map.contains_key(&it.name) {
            continue;
        }
        let block = String::from_utf8_lossy(&text[it.start..it.end.min(text.len())]);
        // its picture where the game has one beside the screen ("econ/loading_screens/<name>"), else the screen
        let found = screen
            .captures_iter(&block)
            .map(|c| c[1].to_lowercase())
            .flat_map(|t| {
                let folder = t.strip_prefix("loadingscreens/").and_then(|r| r.split('/').next()).map(str::to_string);
                folder.map(|f| format!("econ/loading_screens/{f}")).into_iter().chain([t])
            })
            .find(|t| pak.is_none_or(|p| p.has(&texture_path(t))));
        if let Some(t) = found {
            map.insert(it.name.clone(), t);
        }
    }
    // a set the game shows with the empty slot's picture shows its first piece's
    for it in items {
        if it.name.is_empty() || map.contains_key(&it.name) || it.bundle_items.is_empty() {
            continue;
        }
        if let Some(piece) = it.bundle_items.iter().find_map(|n| map.get(n).cloned()) {
            map.insert(it.name.clone(), piece);
        }
    }
    // and a piece with the empty slot's picture shows its set's
    for it in items {
        for piece in &it.bundle_items {
            if map.contains_key(piece) {
                continue;
            }
            if let Some(set) = map.get(&it.name).cloned() {
                map.insert(piece.clone(), set);
            }
        }
    }
    // A screen of a series with no picture of its own ("Battle Pass 2022 Versus Screen II") shows
    // the one of its series whose name it shares the most words with.
    for it in items.iter().filter(|i| matches!(i.prefab.as_str(), "versus_screen" | "loading_screen")) {
        if map.contains_key(&it.name) {
            continue;
        }
        let words: Vec<&str> = it.name.split(' ').collect();
        let shared = |other: &str| words.iter().zip(other.split(' ')).take_while(|(a, b)| *a == b).count();
        let best = items
            .iter()
            .filter(|o| o.prefab == it.prefab && o.name != it.name && map.contains_key(&o.name))
            .map(|o| (shared(&o.name), &o.name))
            .filter(|(n, _)| *n >= 3)
            .max_by_key(|(n, _)| *n);
        if let Some(p) = best.and_then(|(_, n)| map.get(n).cloned()) {
            map.insert(it.name.clone(), p);
        }
    }
    // A worn piece the game has neither a picture nor a model of (Pudgette's arms name both and
    // ship neither; an ambient effect is only a particle) shows the hero's stock piece of that
    // slot, else the hero. One with a model is drawn from it and shipped with the window
    // (tools/mods/look-pictures.mjs).
    let hero_of = Regex::new(r#"(?i)"used_by_heroes"\s*\{\s*"(npc_dota_hero_\w+)""#).unwrap();
    let hero = |it: &crate::schema::SchemaItem| {
        hero_of.captures(&String::from_utf8_lossy(&text[it.start..it.end.min(text.len())])).map(|c| c[1].to_lowercase())
    };
    let modelled = |it: &crate::schema::SchemaItem| {
        !it.model.is_empty() && pak.is_none_or(|p| p.has(&format!("{}_c", it.model.to_lowercase())))
    };
    for it in items.iter().filter(|i| i.prefab == "wearable" && !i.slot.is_empty()) {
        if it.name.is_empty() || map.contains_key(&it.name) || modelled(it) {
            continue;
        }
        let Some(h) = hero(it) else { continue };
        let stock = items
            .iter()
            .filter(|o| o.prefab == "default_item" && o.slot == it.slot && hero(o).as_deref() == Some(h.as_str()))
            .find_map(|o| map.get(&o.name).cloned());
        let portrait = format!("heroes/{h}");
        if let Some(p) = stock.or_else(|| pak.is_none_or(|p| p.has(&texture_path(&portrait))).then_some(portrait)) {
            map.insert(it.name.clone(), p);
        }
    }
    let shown: Vec<(String, String)> = map
        .iter()
        .filter_map(|(n, p)| {
            let u = crate::schema::to_utf8(n);
            (u != *n).then(|| (u, p.clone()))
        })
        .collect();
    map.extend(shown);
    map
}

/// The slots of the Items screens, as the table names them (an item's slot, or its prefab).
const ITEMS_SLOTS: &[&str] = &[
    "courier",
    "ward",
    "loading_screen",
    "hud_skin",
    "music",
    "announcer",
    "terrain",
    "weather",
    "mega_kills",
    "versus_screen",
    "streak_effect",
    "multikill_banner",
    "radiantcreeps",
    "direcreeps",
    "radianttowers",
    "diretowers",
    "radiantsiegecreeps",
    "diresiegecreeps",
    "tormentor",
    "cursor_pack",
    "emblem",
];

/// The looks of the Items screens and the item builder the game keeps no picture of, each with
/// the model it is worn as ("" when it has none). tools/mods/look-pictures.mjs draws these from
/// their models, and the window ships the pictures (renderer/ui/shipped-looks.json).
pub fn looks_without_pictures(game: &Path) -> Result<Vec<(String, String)>, String> {
    let (text, _) = crate::schema::read_game_schema(game).map_err(|e| e.to_string())?;
    let items = crate::schema::list_items(&text).map_err(|e| e.to_string())?;
    let pak = crate::vpk_shared::shared_index(&GameIcons::pak(game)).map_err(|e| e.to_string())?;
    let map = picture_index(&text, &items, Some(&pak));
    let mut names: Vec<String> = items
        .iter()
        .filter(|i| ITEMS_SLOTS.contains(&i.slot.as_str()) || ITEMS_SLOTS.contains(&i.prefab.as_str()))
        .map(|i| crate::schema::to_utf8(&i.name))
        .collect();
    for s in crate::item_builder_slots::item_slots(&text).map_err(|e| e.to_string())? {
        names.extend(s.options.iter().map(|o| o.name.clone()));
    }
    names.sort();
    names.dedup();
    let model = Regex::new(r#"(?i)"model_player"\s+"([^"]+\.vmdl)""#).unwrap();
    Ok(names
        .into_iter()
        .filter(|n| !map.contains_key(n))
        .map(|n| {
            let worn = items
                .iter()
                .find(|i| crate::schema::to_utf8(&i.name) == n)
                .and_then(|i| model.captures(&String::from_utf8_lossy(&text[i.start..i.end])).map(|c| c[1].to_string()))
                .unwrap_or_default();
            (n, worn)
        })
        .collect())
}

impl GameIcons {
    pub fn new(user_data: &Path) -> GameIcons {
        GameIcons { root: user_data.join("icons").join("game"), index: Mutex::new(None) }
    }

    fn cache_file(&self, image_path: &str) -> PathBuf {
        self.root.join(safe_name(image_path))
    }

    /// A picture into the cache whole or not at all. Batches are asked for in parallel, and two
    /// item names often share one picture: written in place, one call read the PNG while another
    /// was still writing it, and the window drew the top of the item over a smear of grey rows.
    fn keep(&self, image_path: &str, png: &[u8]) -> bool {
        let small = crate::picture_shrink::shrink(png, crate::picture_shrink::TILE_WIDTH);
        write_whole(&self.cache_file(image_path), small.as_deref().unwrap_or(png))
    }

    /// One picture at the game's own size, read out of the pak and not kept: there is one on
    /// screen at a time. None where the game has it only in a form the decoder alone reads.
    fn full_size(&self, game: &Path, image_path: &str) -> Option<String> {
        let ix = crate::vpk_shared::shared_index(&Self::pak(game)).ok()?;
        let buf = ix.read(&texture_path(image_path)).ok()??;
        crate::vtex::picture_from_vtex(&buf).map(|png| crate::vtex::data_url(&png))
    }

    fn cached_uri(&self, image_path: &str) -> Option<String> {
        std::fs::read(self.cache_file(image_path)).ok().map(|png| crate::vtex::data_url(&png))
    }

    /// The pictures the decoder found nothing for, in this build of the game: the file goes with
    /// the cache when a new build drops it.
    fn absent(&self) -> std::collections::HashSet<String> {
        std::fs::read_to_string(self.root.join(ABSENT))
            .map(|t| t.lines().map(String::from).collect())
            .unwrap_or_default()
    }

    fn mark_absent(&self, image_path: &str) {
        use std::io::Write;
        let file = std::fs::OpenOptions::new().create(true).append(true).open(self.root.join(ABSENT));
        if let Ok(mut f) = file {
            let _ = writeln!(f, "{image_path}");
        }
    }

    fn pak(game: &Path) -> PathBuf {
        game.join("dota").join("pak01_dir.vpk")
    }

    /// The game alone is enough for the pictures it stores as PNG.
    pub fn ready(game: Option<&Path>) -> bool {
        game.is_some_and(|g| Self::pak(g).exists())
    }

    /// The game's own answer to "where is this item's picture", read again when the game changes;
    /// a new build drops the old cache.
    fn name_index(&self, game: &Path, log: &mut dyn FnMut(String)) -> Option<HashMap<String, String>> {
        let stamp = crate::pak_stamp::game_schema_stamp(game).ok();
        let mut held = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if let (Some((s, map)), Some(now)) = (held.as_ref(), stamp.as_ref()) {
            if s == now {
                return Some(map.clone());
            }
        }
        let text = match crate::schema::read_game_schema(game) {
            Ok((t, _)) => t,
            Err(e) => {
                log(format!("game icons: item table unreadable ({e})"));
                return None;
            }
        };
        let items = match crate::schema::list_items(&text) {
            Ok(i) => i,
            Err(e) => {
                log(format!("game icons: item table unreadable ({e})"));
                return None;
            }
        };
        let pak = crate::vpk_shared::shared_index(&Self::pak(game)).ok();
        let map = picture_index(&text, &items, pak.as_deref());
        log(format!("game icons: {} items know where their picture is", map.len()));
        if let Some(now) = &stamp {
            let marker = self.root.join("stamp");
            // the stamp carries how the pictures were made too, so a cache made wrong goes with it
            let mark = format!("{now}|{CACHE_KIND}");
            if std::fs::read_to_string(&marker).ok().as_deref() != Some(mark.as_str()) {
                let _ = std::fs::remove_dir_all(&self.root);
                let _ = std::fs::create_dir_all(&self.root);
                let _ = std::fs::write(&marker, &mark);
            }
            *held = Some((now.clone(), map.clone()));
        }
        Some(map)
    }

    /// Every picture the game stores as one copied out; the ones left.
    fn take_ready_made(&self, game: &Path, paths: &[String], log: &mut dyn FnMut(String)) -> Vec<String> {
        let Ok(ix) = crate::vpk_shared::shared_index(&Self::pak(game)) else { return paths.to_vec() };
        let _ = std::fs::create_dir_all(&self.root);
        // Each picture is decoded from its texture and written as PNG on a core of its own: one
        // after another, a batch nobody had opened before took a few hundred milliseconds, and
        // a slot's first screen waited for all of it.
        use rayon::prelude::*;
        let done: Vec<Result<bool, String>> = paths
            .par_iter()
            .map(|p| match ix.read(&texture_path(p)) {
                Ok(Some(buf)) => Ok(crate::vtex::picture_from_vtex(&buf).is_some_and(|png| self.keep(p, &png))),
                Ok(None) => Ok(false),
                Err(e) => Err(e.to_string()),
            })
            .collect();
        let mut left = Vec::new();
        for (p, r) in paths.iter().zip(done) {
            match r {
                Ok(true) => {}
                Ok(false) => left.push(p.clone()),
                Err(e) => {
                    log(format!("game icons: {p} unreadable ({e})"));
                    left.push(p.clone());
                }
            }
        }
        left
    }

    /// These pictures out of the game and into the cache: by slicing, then the decoder for the rest.
    fn extract(
        &self,
        game: &Path,
        vrf: Option<&Path>,
        paths: &[String],
        log: &mut dyn FnMut(String),
    ) -> Result<(), String> {
        let left = self.take_ready_made(game, paths, log);
        // a picture the decoder found no file for once is not looked for again: 133 of the game's
        // item pictures are not in its pak at all, and each screen showing one started the
        // decoder anew, for seconds, to find nothing
        let absent = self.absent();
        let left: Vec<String> = left.into_iter().filter(|p| !absent.contains(p)).collect();
        let Some(exe) = vrf.filter(|_| !left.is_empty()) else { return Ok(()) };
        let tmp = std::env::temp_dir().join(format!("d2mm-icons-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let filter = left.iter().map(|p| texture_path(p)).collect::<Vec<_>>().join(",");
        let args: Vec<String> = vec![
            "-i".into(),
            Self::pak(game).to_string_lossy().into_owned(),
            "-o".into(),
            tmp.to_string_lossy().into_owned(),
            "-d".into(),
            "-f".into(),
            filter,
        ];
        let ran = crate::run_process::run(&exe.to_string_lossy(), &args, None, &[], TOOL_TIMEOUT_MS);
        let r = match ran {
            Ok((0, _)) => {
                let _ = std::fs::create_dir_all(&self.root);
                for p in &left {
                    let mut from = tmp.join("panorama").join("images");
                    for part in format!("{p}_png.png").split('/') {
                        from.push(part);
                    }
                    match std::fs::read(&from) {
                        Ok(png) => {
                            self.keep(p, &png);
                        }
                        Err(_) => self.mark_absent(p),
                    }
                }
                Ok(())
            }
            Ok((code, out)) => Err(format!("vrf exited {code}: {}", out.trim())),
            Err(e) => Err(e),
        };
        let _ = std::fs::remove_dir_all(&tmp);
        r
    }

    /// Pictures for these item names, as data URIs; one the game does not have is left out.
    pub fn get_many(
        &self,
        game: Option<&Path>,
        vrf: Option<&Path>,
        names: &[String],
        log: &mut dyn FnMut(String),
    ) -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        let Some(game) = game.filter(|g| Self::ready(Some(g))) else { return out };
        let Some(map) = self.name_index(game, log) else { return out };
        let mut wanted: IndexMap<String, Vec<String>> = IndexMap::new();
        for name in names {
            if let Some(n) = name.strip_prefix(FULL_SIZE) {
                if let Some(uri) = map.get(n).and_then(|image| self.full_size(game, image)) {
                    out.insert(name.clone(), uri);
                }
                continue;
            }
            let Some(image) = map.get(name) else { continue };
            if let Some(uri) = self.cached_uri(image) {
                out.insert(name.clone(), uri);
                continue;
            }
            wanted.entry(image.clone()).or_default().push(name.clone());
        }
        let paths: Vec<String> = wanted.keys().cloned().collect();
        for chunk in paths.chunks(MAX_PER_CALL) {
            if let Err(e) = self.extract(game, vrf, chunk, log) {
                log(format!("game icons: extraction failed ({e})"));
                break;
            }
        }
        for (image, asking) in wanted {
            if let Some(uri) = self.cached_uri(&image) {
                for n in asking {
                    out.insert(n, uri.clone());
                }
            }
        }
        out
    }

    /// Each hero's portrait, as data URIs: the landscape one first, or the hero selection one
    /// first when `tall`. `ids` are hero ids without the npc_dota_hero_ prefix.
    pub fn hero_portraits(
        &self,
        game: Option<&Path>,
        vrf: Option<&Path>,
        ids: &[serde_json::Value],
        tall: bool,
        log: &mut dyn FnMut(String),
    ) -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        let Some(game) = game.filter(|g| Self::ready(Some(g))) else { return out };
        let ok = Regex::new(r"^[a-z0-9_]+$").unwrap();
        let mut valid: Vec<String> = Vec::new();
        for id in ids.iter().filter_map(serde_json::Value::as_str) {
            if ok.is_match(id) && !valid.iter().any(|v| v == id) {
                valid.push(id.to_string());
            }
        }
        let wide = |id: &str| format!("heroes/npc_dota_hero_{id}");
        let upright = |id: &str| format!("heroes/selection/npc_dota_hero_{id}");
        let cached = |p: &str| self.cache_file(p).exists();
        if tall {
            let want: Vec<String> = valid.iter().map(|i| upright(i)).filter(|p| !cached(p)).collect();
            self.take_ready_made(game, &want, log);
        }
        let want: Vec<String> =
            valid.iter().filter(|i| !tall || !cached(&upright(i))).map(|i| wide(i)).filter(|p| !cached(p)).collect();
        let _ = self.extract(game, vrf, &want, log);
        if !tall {
            let want: Vec<String> =
                valid.iter().filter(|i| !cached(&wide(i))).map(|i| upright(i)).filter(|p| !cached(p)).collect();
            self.take_ready_made(game, &want, log);
        }
        for id in &valid {
            let order = if tall { [upright(id), wide(id)] } else { [wide(id), upright(id)] };
            if let Some(uri) = order.iter().find(|p| cached(p)).and_then(|p| self.cached_uri(p)) {
                out.insert(id.clone(), uri);
            }
        }
        out
    }

    /// Abilities' icons, as data URIs: "crystal_maiden_crystal_nova", or a cosmetic's icon under
    /// the same folder.
    pub fn ability_icons(
        &self,
        game: Option<&Path>,
        vrf: Option<&Path>,
        names: &[serde_json::Value],
        log: &mut dyn FnMut(String),
    ) -> IndexMap<String, String> {
        let mut out = IndexMap::new();
        let Some(game) = game.filter(|g| Self::ready(Some(g))) else { return out };
        let ok = Regex::new(r"^[a-z0-9_]+(?:/[a-z0-9_]+){0,5}$").unwrap();
        let mut valid: Vec<String> = Vec::new();
        for n in names.iter().filter_map(serde_json::Value::as_str) {
            if ok.is_match(n) && !valid.iter().any(|v| v == n) {
                valid.push(n.to_string());
            }
        }
        let icon = |n: &str| format!("spellicons/{n}");
        let missing: Vec<String> = valid.iter().map(|n| icon(n)).filter(|p| !self.cache_file(p).exists()).collect();
        for chunk in missing.chunks(MAX_PER_CALL) {
            if let Err(e) = self.extract(game, vrf, chunk, log) {
                log(format!("game icons: extraction failed ({e})"));
                break;
            }
        }
        for n in &valid {
            if let Some(uri) = self.cached_uri(&icon(n)) {
                out.insert(n.clone(), uri);
            }
        }
        out
    }

    pub fn size(&self) -> u64 {
        crate::folder_size::folder_size(&self.root)
    }

    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.root);
        *self.index.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(test)]
#[path = "game_icons_index_tests.rs"]
mod index_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_names_are_the_first_16_of_the_sha1() {
        assert_eq!(safe_name("econ/x"), format!("{}.png", &hex::encode(Sha1::digest(b"econ/x"))[..16]));
    }

    #[test]
    fn nothing_without_a_game() {
        let g = GameIcons::new(Path::new("nowhere"));
        assert!(g.ability_icons(None, None, &[serde_json::json!("x")], &mut |_| {}).is_empty());
        assert!(!GameIcons::ready(Some(Path::new("nowhere"))));
    }

    /// A picture the decoder once found nothing for is not looked for again: the decoder here
    /// does not exist, so starting it would be an error.
    #[test]
    fn a_picture_the_game_has_not_got_does_not_start_the_decoder_again() {
        let ud = std::env::temp_dir().join(format!("mm-icons-absent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&ud);
        let g = GameIcons::new(&ud);
        std::fs::create_dir_all(&g.root).unwrap();
        let (game, vrf) = (ud.join("game"), ud.join("no-such-decoder.exe"));
        let gone = vec!["econ/items/x/gone".to_string()];
        assert!(g.extract(&game, Some(&vrf), &gone, &mut |_| {}).is_err(), "not yet known: the decoder is asked");
        g.mark_absent(&gone[0]);
        assert!(g.extract(&game, Some(&vrf), &gone, &mut |_| {}).is_ok());
        let _ = std::fs::remove_dir_all(&ud);
    }

    /// A loading screen is kept at a tile's size, as a JPEG; asked for at full size, it comes
    /// out of nothing kept.
    #[test]
    fn a_picture_wider_than_a_tile_is_kept_small() {
        let ud = std::env::temp_dir().join(format!("mm-icons-small-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&ud);
        let g = GameIcons::new(&ud);
        std::fs::create_dir_all(&g.root).unwrap();
        let rgba: Vec<u8> = (0..1920 * 1080u32).flat_map(|i| [(i % 7) as u8 * 30, 40, 90, 255]).collect();
        assert!(g.keep("loadingscreens/x", &crate::png_strip::encode_png(1920, 1080, &rgba)));
        assert!(g.cached_uri("loadingscreens/x").unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(std::fs::metadata(g.cache_file("loadingscreens/x")).unwrap().len() < 200_000);
        let _ = std::fs::remove_dir_all(&ud);
    }
}

/// MM_GAME: the game's `game` folder (read only). How long a slot's pictures take, cold and warm,
/// and how many the game has not got.
#[cfg(test)]
#[test]
#[ignore]
fn icons_on_the_real_game() {
    let game = PathBuf::from(std::env::var("MM_GAME").unwrap());
    let ud = std::env::temp_dir().join(format!("mm-icons-real-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&ud);
    let g = GameIcons::new(&ud);
    let mut log = |m: String| println!("  {m}");
    let t = std::time::Instant::now();
    let (text, _) = crate::schema::read_game_schema(&game).unwrap();
    println!("schema read {:?}", t.elapsed());
    let items = crate::schema::list_items(&text).unwrap();
    println!("schema listed {:?}", t.elapsed());
    for slot in ["courier", "loading_screen", "ward", "hud_skin", "terrain", "weather", "announcer", "music"] {
        let names: Vec<String> =
            items.iter().filter(|i| i.slot == slot || i.prefab == slot).map(|i| i.name.clone()).collect();
        for pass in ["cold", "warm"] {
            let mut worst = std::time::Duration::ZERO;
            let mut got = 0;
            let t = std::time::Instant::now();
            for chunk in names.chunks(12) {
                let c = std::time::Instant::now();
                got += g.get_many(Some(&game), None, chunk, &mut log).len();
                worst = worst.max(c.elapsed());
            }
            println!("{slot} {pass}: {got}/{} in {:?}, worst batch {worst:?}", names.len(), t.elapsed());
            if pass == "cold" {
                let have = g.get_many(Some(&game), None, &names, &mut |_| {});
                let miss: Vec<&String> = names.iter().filter(|n| !have.contains_key(*n)).take(8).collect();
                println!("  missing: {miss:?}");
            }
        }
    }
    println!("cache {} MB", g.size() >> 20);
    // the window's picture of a loading screen: the game's own size, the tile's cut down
    let screens: Vec<String> = items.iter().filter(|i| i.prefab == "loading_screen").map(|i| i.name.clone()).collect();
    let tiles = g.get_many(Some(&game), None, &screens, &mut |_| {});
    let bytes = |uri: &str| {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(uri.split_once(',').unwrap().1).unwrap()
    };
    let cut = |uri: &str| {
        let b = bytes(uri);
        crate::picture_shrink::media_type(&b) == "image/jpeg" || u32::from_be_bytes([b[16], b[17], b[18], b[19]]) == 640
    };
    let jpeg = tiles.values().filter(|u| u.starts_with("data:image/jpeg")).count();
    let all: Vec<&String> = tiles.iter().filter(|(_, u)| cut(u)).map(|(n, _)| n).collect();
    println!("{} of {} loading screens cut down, {jpeg} as JPEG", all.len(), screens.len());
    let name = all[0].clone();
    let tile = g.get_many(Some(&game), None, std::slice::from_ref(&name), &mut |_| {});
    let full = g.get_many(Some(&game), None, &[format!("{FULL_SIZE}{name}")], &mut |_| {});
    let size = |uri: &str| {
        let b = bytes(uri);
        (crate::picture_shrink::media_type(&b), b.len() >> 10)
    };
    println!("tile {:?}, full {:?}", size(&tile[&name]), size(full.values().next().unwrap()));
    let _ = std::fs::remove_dir_all(&ud);
}

/// MM_GAME: the looks the game has no picture for, with their models.
#[cfg(test)]
#[test]
#[ignore]
fn looks_without_a_picture_in_the_real_game() {
    let game = PathBuf::from(std::env::var("MM_GAME").unwrap());
    let none = looks_without_pictures(&game).unwrap();
    println!("{} without a picture:", none.len());
    for (n, model) in &none {
        println!("  {n}  :: {model}");
    }
}
