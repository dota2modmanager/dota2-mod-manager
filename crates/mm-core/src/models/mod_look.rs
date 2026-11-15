//! A catalog hero or item mod shown in 3D before it goes in (the mod window's stage).
//!
//! The mod's archive is the catalog's own download, the one an install would use. Its files are
//! unpacked loose into a little game folder (map_mod_trees.rs does the same for a Trees mod),
//! whose gameinfo.gi sends the toolchain to the real game for whatever the mod does not bring.
//! The hero preview (hero_preview.rs) then reads every file through the mod first: a model the
//! mod replaces is exported from its loose copy, a material or a particle it brings is the one
//! read, a texture it brings is decoded out of its folder. So a recolour shows its colours, an
//! item mod its item on the stock slot, and a model mod its model, without touching the game.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::loadout_resources::Exporter;
use crate::map_mod_trees::{game_info, source_of};
use crate::model_glb::{Clips, ModelGlb};
use crate::safe_zip::{safe_join, OpenedZip, Source};

/// What an unpacking leaves last: its presence says it finished. The name changes when what is
/// unpacked does, so an older unpacking is done again.
pub const LIST: &str = "look-2.json";

#[derive(Serialize, Deserialize)]
struct Listed {
    /// the archive it was unpacked from, as size and time: a new version of the mod unpacks again
    stamp: String,
    files: Vec<String>,
}

/// The folders a loose game file of a mod sits under, wherever the author packed it.
const ROOTS: [&str; 4] = ["models/", "materials/", "particles/", "scripts/"];

/// A path inside one of the mod's VPKs the stage may need: any but sounds, the interface and the
/// map, which it never draws and which are the largest part of many mods. A material names its
/// pictures where its author put them ("qizlik/material/image_1_png.vtex"), so a list of the
/// folders to take would drop them, and the model came out black.
pub fn wanted(path: &str) -> bool {
    let l = path.to_lowercase();
    !["sounds/", "soundevents/", "panorama/", "resource/", "maps/", "videos/", "cfg/"].iter().any(|p| l.starts_with(p))
}

/// A path of the archive as the game names it, from its first game folder on, whatever folder the
/// author packed it in ("Pudge/game/dota/models/x.vmdl_c" is "models/x.vmdl_c"); None for the rest.
pub fn game_path(rel: &str) -> Option<String> {
    let low = rel.replace('\\', "/").to_lowercase();
    let at = ROOTS
        .iter()
        .filter_map(|k| if low.starts_with(k) { Some(0) } else { low.find(&format!("/{k}")).map(|i| i + 1) })
        .min()?;
    Some(low[at..].to_string())
}

/// A volume of a split archive (pak01_000.vpk): read through its _dir.vpk, never alone.
fn is_volume(name: &str) -> bool {
    let l = name.to_lowercase();
    let stem = l.strip_suffix(".vpk").unwrap_or(&l);
    stem.rsplit_once('_').is_some_and(|(_, n)| n.len() == 3 && n.bytes().all(|b| b.is_ascii_digit()))
}

/// The archive as size and modification time: what says the catalog sent a new version.
pub fn stamp_of(zip: &Path) -> String {
    let meta = fs::metadata(zip).ok();
    let len = meta.as_ref().map_or(0, |m| m.len());
    let at = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    format!("{len}-{at}")
}

fn write(source: &Path, path: &str, bytes: &[u8]) -> Result<(), String> {
    let to = safe_join(source, path)?;
    if let Some(d) = to.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    fs::write(to, bytes).map_err(|e| e.to_string())
}

/// The mod's archive unpacked into `root`: the game files of every VPK in it and its loose ones
/// (a loose file wins over the same path in a VPK, as it does in the game), gameinfo.gi beside
/// them, and the list. Returns the paths unpacked, lower case.
pub fn unpack(zip: &Path, root: &Path, dota: &Path) -> Result<Vec<String>, String> {
    let _ = fs::remove_dir_all(root);
    let source = source_of(root);
    let vpks = root.join("vpk");
    fs::create_dir_all(&source).map_err(|e| e.to_string())?;
    fs::create_dir_all(&vpks).map_err(|e| e.to_string())?;
    let mut z = OpenedZip::open(Source::File(zip), None, None)?;
    let mut loose: Vec<(String, Vec<u8>)> = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    for f in z.files.clone() {
        let name = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        if name.to_lowercase().ends_with(".vpk") {
            // side by side under their own names, so a _dir.vpk finds its volumes
            let to = safe_join(&vpks, &name)?;
            fs::write(&to, z.read(&f)?).map_err(|e| e.to_string())?;
            if !is_volume(&name) {
                dirs.push(to);
            }
        } else if let Some(p) = game_path(&f.path) {
            loose.push((p, z.read(&f)?));
        }
    }
    let mut written: Vec<String> = Vec::new();
    for dir in &dirs {
        let index = crate::vpk::Index::open(dir).map_err(|e| e.to_string())?;
        let paths: Vec<String> = index.paths().filter(|p| wanted(p)).map(str::to_lowercase).collect();
        for p in paths {
            let Some(bytes) = index.read(&p).map_err(|e| e.to_string())? else { continue };
            write(&source, &p, &bytes)?;
            written.push(p);
        }
    }
    for (p, bytes) in &loose {
        write(&source, p, bytes)?;
        written.push(p.clone());
    }
    crate::model_glb::remove_soon(&vpks);
    written.sort();
    written.dedup();
    fs::write(source.join("gameinfo.gi"), game_info(&source, dota)).map_err(|e| e.to_string())?;
    let listed = Listed { stamp: stamp_of(zip), files: written.clone() };
    fs::write(root.join(LIST), serde_json::to_vec(&listed).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(written)
}

/// The paths an earlier unpacking of this very archive left, if it finished.
pub fn listed(root: &Path, stamp: &str) -> Option<Vec<String>> {
    let l: Listed = serde_json::from_slice(&fs::read(root.join(LIST)).ok()?).ok()?;
    (l.stamp == stamp).then_some(l.files)
}

/// A mod unpacked: what it brings, read before the game's own.
pub struct Look {
    pub root: PathBuf,
    files: HashSet<String>,
    order: Vec<String>,
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_start_matches('/').to_lowercase()
}

impl Look {
    pub fn new(root: &Path, files: Vec<String>) -> Look {
        Look { root: root.to_path_buf(), files: files.iter().map(|f| norm(f)).collect(), order: files }
    }
    pub fn has(&self, p: &str) -> bool {
        self.files.contains(&norm(p))
    }
    pub fn read(&self, p: &str) -> Option<Vec<u8>> {
        let p = norm(p);
        if !self.files.contains(&p) {
            return None;
        }
        fs::read(p.split('/').fold(source_of(&self.root), |at, part| at.join(part))).ok()
    }
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.order.iter().map(String::as_str)
    }
    /// The item table the mod brings, which outranks the game's in the game too.
    pub fn items_game(&self) -> Option<Vec<u8>> {
        self.read("scripts/items/items_game.txt")
    }
}

fn letters(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

/// The folder a hero's model is in ("models/heroes/shadowshaman/shadowshaman.vmdl": shadowshaman).
fn model_folder(model: &str) -> Option<String> {
    let m = norm(model);
    let rest = m.strip_prefix("models/heroes/")?;
    rest.split('/').next().filter(|f| !f.is_empty()).map(str::to_string)
}

/// The hero folder a file of a mod belongs to, by letters alone: its model's folder, or its
/// particles' "hero_" folder.
fn folder_of(path: &str) -> Option<String> {
    let p = norm(path);
    let rest = p
        .strip_prefix("models/heroes/")
        .or_else(|| p.strip_prefix("materials/models/heroes/"))
        .or_else(|| p.strip_prefix("particles/units/heroes/").map(|r| r.strip_prefix("hero_").unwrap_or(r)))?;
    let (folder, _) = rest.split_once('/')?;
    Some(letters(folder)).filter(|f| !f.is_empty())
}

/// The hero a mod is for (npc_dota_hero_shadow_shaman): the one most of its files belong to, else
/// the one the catalog's name for it means (`hint`, "Shadow Shaman Purple" or its group's
/// "Shadow Shaman"). `game_paths` and `read` are the game's own files.
pub fn hero_of<'a>(
    mod_paths: impl Iterator<Item = &'a str>,
    game_paths: &[String],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    hint: &str,
) -> Option<String> {
    let heroes: Vec<&str> = game_paths
        .iter()
        .filter_map(|p| p.strip_prefix("scripts/npc/heroes/")?.strip_suffix(".txt"))
        .filter(|h| h.starts_with("npc_dota_hero_"))
        .collect();
    // each hero by the letters of its id and of its model's folder
    let mut by_folder: IndexMap<String, &str> = IndexMap::new();
    for h in &heroes {
        let short = h.trim_start_matches("npc_dota_hero_");
        by_folder.entry(letters(short)).or_insert(h);
        let model = crate::item_builder_assets::hero_model_path(read, h).ok();
        if let Some(f) = model.as_deref().and_then(model_folder) {
            by_folder.entry(letters(&f)).or_insert(h);
        }
    }
    let mut counts: IndexMap<&str, usize> = IndexMap::new();
    for p in mod_paths {
        if let Some(h) = folder_of(p).and_then(|f| by_folder.get(&f).copied()) {
            *counts.entry(h).or_default() += 1;
        }
    }
    if let Some((h, _)) = counts.iter().max_by_key(|(_, n)| **n) {
        return Some(h.to_string());
    }
    // the catalog's name: its words from the first on, the longest that names a hero
    let words: Vec<&str> = hint.split_whitespace().collect();
    (1..=words.len()).rev().find_map(|n| {
        let id = crate::hero_names::id_from_name(&words[..n].join(" "))?;
        let full = format!("npc_dota_hero_{id}");
        heroes.contains(&full.as_str()).then_some(full)
    })
}

/// The preview's exporter with a mod over the game: what the mod brings is exported or decoded out
/// of its folder, the rest is the game's, from the same cache as the item builder's.
pub struct LookExporter<'a> {
    pub glb: &'a ModelGlb,
    pub look: &'a Look,
}

impl LookExporter<'_> {
    fn ours(&self, model: &str) -> bool {
        crate::model_glb::model_file(model).is_some_and(|f| self.look.has(&f))
    }
}

impl Exporter for LookExporter<'_> {
    fn glbs(&self, models: &[String], clips: &Clips, materials: bool) -> IndexMap<String, Option<PathBuf>> {
        // every clip of a body is the motions list, which the game's body answers
        let mine: Vec<String> = match clips {
            Clips::Some(_) => models.iter().filter(|m| self.ours(m)).cloned().collect(),
            Clips::All => vec![],
        };
        let theirs: Vec<String> = models.iter().filter(|m| !mine.contains(m)).cloned().collect();
        let list = match clips {
            Clips::Some(c) => c.clone(),
            Clips::All => vec![],
        };
        let (game, made) = std::thread::scope(|sc| {
            let game = sc.spawn(|| self.glb.glbs(&theirs, clips, materials));
            let made: Vec<_> = mine
                .iter()
                .map(|m| {
                    let list = &list;
                    sc.spawn(move || (m.clone(), self.glb.loose_with(&self.look.root, m, list)))
                })
                .collect();
            let made: Vec<(String, Option<PathBuf>)> = made.into_iter().filter_map(|h| h.join().ok()).collect();
            (game.join().unwrap_or_default(), made)
        });
        let mut out: IndexMap<String, Option<PathBuf>> = models.iter().map(|m| (m.clone(), None)).collect();
        for (m, f) in game.into_iter().chain(made) {
            out.insert(m, f);
        }
        out
    }

    fn sprites(&self, textures: &[String]) -> Option<IndexMap<String, Option<Vec<u8>>>> {
        let (mine, theirs): (Vec<String>, Vec<String>) =
            textures.iter().cloned().partition(|t| self.look.has(&format!("{t}_c")));
        let (game, made) = std::thread::scope(|sc| {
            let game = sc.spawn(|| self.glb.sprites(&theirs));
            let made = self.glb.loose_sprites(&self.look.root, &mine);
            (game.join().unwrap_or_default(), made)
        });
        let mut out = game;
        out.extend(made);
        Some(out)
    }

    fn own(&self, texture: &str) -> bool {
        self.look.has(&format!("{texture}_c"))
    }
}

impl crate::hero_preview::PreviewExporter for LookExporter<'_> {
    fn skinned(&self, model: &str, skin: usize, bytes: Option<&[u8]>, clips: &[String]) -> Option<PathBuf> {
        // the skins' cache is keyed by the game's model: the mod's would be taken for it
        if self.ours(model) {
            return None;
        }
        self.glb.skinned(model, skin, bytes, clips)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_paths_from_any_folder() {
        assert_eq!(
            game_path("Pudge/game/dota/models/heroes/pudge/a.vmdl_c").as_deref(),
            Some("models/heroes/pudge/a.vmdl_c")
        );
        assert_eq!(
            game_path("particles/units/heroes/hero_pudge/x.vpcf_c").as_deref(),
            Some("particles/units/heroes/hero_pudge/x.vpcf_c")
        );
        assert_eq!(game_path("Scripts/Items/items_game.txt").as_deref(), Some("scripts/items/items_game.txt"));
        assert_eq!(game_path("sounds/x.vsnd_c"), None);
        assert_eq!(game_path("readme.txt"), None);
    }

    #[test]
    fn a_vpk_keeps_pictures_wherever_the_author_put_them() {
        assert!(wanted("qizlik/material/image_1_png_1f284df0_png_9a7d4f31.vtex_c"));
        assert!(wanted("models/heroes/pudge/pudge.vmdl_c"));
        assert!(!wanted("panorama/images/spellicons/x.vtex_c"));
        assert!(!wanted("soundevents/game_sounds_heroes/x.vsndevts_c"));
    }

    #[test]
    fn a_file_names_its_hero_folder() {
        assert_eq!(folder_of("models/heroes/shadowshaman/head.vmdl_c").as_deref(), Some("shadowshaman"));
        assert_eq!(folder_of("materials/models/heroes/pudge/x.vtex_c").as_deref(), Some("pudge"));
        assert_eq!(folder_of("particles/units/heroes/hero_shadow_shaman/x.vpcf_c").as_deref(), Some("shadowshaman"));
        assert_eq!(folder_of("models/items/pudge/hook.vmdl_c"), None);
    }

    fn script(model: &str) -> Vec<u8> {
        format!("\"DOTAHeroes\"\n{{\n\t\"npc_dota_hero_x\"\n\t{{\n\t\t\"Model\"\t\"{model}\"\n\t}}\n}}\n").into_bytes()
    }

    #[test]
    fn the_hero_is_the_one_most_files_belong_to() {
        let game: Vec<String> =
            ["scripts/npc/heroes/npc_dota_hero_shadow_shaman.txt", "scripts/npc/heroes/npc_dota_hero_pudge.txt"]
                .iter()
                .map(|s| s.to_string())
                .collect();
        let read = |p: &str| match p {
            "scripts/npc/heroes/npc_dota_hero_shadow_shaman.txt" => {
                Some(script("models/heroes/shadowshaman/shadowshaman.vmdl"))
            }
            "scripts/npc/heroes/npc_dota_hero_pudge.txt" => Some(script("models/heroes/pudge/pudge.vmdl")),
            _ => None,
        };
        let files = [
            "models/heroes/shadowshaman/head.vmdl_c",
            "materials/models/heroes/shadowshaman/a.vtex_c",
            "models/heroes/pudge/x.vmdl_c",
        ];
        assert_eq!(hero_of(files.into_iter(), &game, &read, "").as_deref(), Some("npc_dota_hero_shadow_shaman"));
        // a mod of nothing but an item table goes by its name
        assert_eq!(
            hero_of(std::iter::empty(), &game, &read, "Pudge Butcher Set").as_deref(),
            Some("npc_dota_hero_pudge")
        );
        assert_eq!(
            hero_of(std::iter::empty(), &game, &read, "Shadow Shaman Purple").as_deref(),
            Some("npc_dota_hero_shadow_shaman")
        );
        assert_eq!(hero_of(std::iter::empty(), &game, &read, "Nothing Here"), None);
    }

    #[test]
    fn a_new_version_of_the_archive_unpacks_again() {
        let dir = std::env::temp_dir().join(format!("mm-look-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let l = Listed { stamp: "1-2".into(), files: vec!["models/a.vmdl_c".into()] };
        fs::write(dir.join(LIST), serde_json::to_vec(&l).unwrap()).unwrap();
        assert_eq!(listed(&dir, "1-2"), Some(vec!["models/a.vmdl_c".to_string()]));
        assert_eq!(listed(&dir, "1-3"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_mod_is_read_first_by_any_spelling() {
        let dir = std::env::temp_dir().join(format!("mm-look-read-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        write(&source_of(&dir), "materials/a.vmat_c", b"mine").unwrap();
        let look = Look::new(&dir, vec!["materials/a.vmat_c".into()]);
        assert!(look.has("Materials\\A.vmat_c"));
        assert_eq!(look.read("materials/a.vmat_c").as_deref(), Some(&b"mine"[..]));
        assert_eq!(look.read("materials/b.vmat_c"), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
