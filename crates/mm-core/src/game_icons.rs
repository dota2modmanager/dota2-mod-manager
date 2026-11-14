//! Pictures taken from the installed game (src/game-icons.ts): an item's picture by the item table's
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

fn safe_name(image_path: &str) -> String {
    let hex: String = Sha1::digest(image_path.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    format!("{}.png", &hex[..16])
}

fn texture_path(image_path: &str) -> String {
    format!("panorama/images/{image_path}_png.vtex_c")
}

impl GameIcons {
    pub fn new(user_data: &Path) -> GameIcons {
        GameIcons { root: user_data.join("icons").join("game"), index: Mutex::new(None) }
    }

    fn cache_file(&self, image_path: &str) -> PathBuf {
        self.root.join(safe_name(image_path))
    }

    fn cached_uri(&self, image_path: &str) -> Option<String> {
        std::fs::read(self.cache_file(image_path)).ok().map(|png| crate::vtex::data_url(&png))
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
        let stand_in = Regex::new(r"(?i)(^|/)testitem_slot_empty$").unwrap();
        let mut map = HashMap::new();
        for it in &items {
            if !it.image.is_empty() && !it.name.is_empty() && !stand_in.is_match(&it.image) {
                map.insert(it.name.clone(), it.image.clone());
            }
        }
        // a set the game shows with the empty slot's picture shows its first piece's
        for it in &items {
            if it.name.is_empty() || map.contains_key(&it.name) || it.bundle_items.is_empty() {
                continue;
            }
            if let Some(piece) = it.bundle_items.iter().find_map(|n| map.get(n).cloned()) {
                map.insert(it.name.clone(), piece);
            }
        }
        log(format!("game icons: {} items know where their picture is", map.len()));
        if let Some(now) = &stamp {
            let marker = self.root.join("stamp");
            if std::fs::read_to_string(&marker).ok().as_deref() != Some(now.as_str()) {
                let _ = std::fs::remove_dir_all(&self.root);
                let _ = std::fs::create_dir_all(&self.root);
                let _ = std::fs::write(&marker, now);
            }
            *held = Some((now.clone(), map.clone()));
        }
        Some(map)
    }

    /// Every picture the game stores as one copied out; the ones left.
    fn take_ready_made(&self, game: &Path, paths: &[String], log: &mut dyn FnMut(String)) -> Vec<String> {
        let Ok(ix) = crate::vpk_shared::shared_index(&Self::pak(game)) else { return paths.to_vec() };
        let _ = std::fs::create_dir_all(&self.root);
        let mut left = Vec::new();
        for p in paths {
            match ix.read(&texture_path(p)) {
                Ok(Some(buf)) => match crate::vtex::png_from_vtex(&buf) {
                    Some(png) => {
                        let _ = std::fs::write(self.cache_file(p), png);
                    }
                    None => left.push(p.clone()),
                },
                Ok(None) => left.push(p.clone()),
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
                    if from.exists() {
                        let _ = std::fs::copy(&from, self.cache_file(p));
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
mod tests {
    use super::*;

    #[test]
    fn cache_names_are_the_first_16_of_the_sha1() {
        assert_eq!(safe_name("econ/x"), format!("{}.png", &format!("{:x}", Sha1::digest(b"econ/x"))[..16]));
    }

    #[test]
    fn nothing_without_a_game() {
        let g = GameIcons::new(Path::new("nowhere"));
        assert!(g.ability_icons(None, None, &[serde_json::json!("x")], &mut |_| {}).is_empty());
        assert!(!GameIcons::ready(Some(Path::new("nowhere"))));
    }
}
