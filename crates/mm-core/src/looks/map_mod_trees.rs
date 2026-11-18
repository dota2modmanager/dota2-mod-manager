//! A catalog Trees mod shown on the Optimization window's map before it goes in. The mod's
//! archive is the catalog's own download (the one an install would use); the models and
//! materials it carries are unpacked into a little game folder of loose files, whose gameinfo.gi
//! sends the toolchain to the real game for anything the mod does not bring, and each tree model
//! of the mod is exported from there to a GLB the map stands in place of the game's tree of the
//! same name. The window swaps trees by model name, so the list names the mod's tree models.

use std::fs;
use std::path::{Path, PathBuf};

use crate::safe_zip::{safe_join, OpenedZip, Source};

/// The list of the mod's tree models, written last: its presence says the unpacking finished. Its
/// name changes when what is unpacked does, so an older unpacking is done again.
pub const LIST: &str = "trees-3.json";

/// Where a mod's loose files go under its folder, the game's archive layout inside.
pub fn source_of(root: &Path) -> PathBuf {
    root.join("source").join("game").join("mm")
}

/// A file of the mod the map may need to draw its models: anything but what a model never names.
/// A mod keeps its materials where its author likes (dota2pornfx/materials/cone_tree.vmat), so a
/// list of the folders to take would miss them: the model's material came out empty, drawn white.
pub fn wanted(path: &str) -> bool {
    let l = path.to_lowercase();
    !["particles/", "sounds/", "soundevents/", "panorama/", "scripts/", "resource/", "maps/"]
        .iter()
        .any(|p| l.starts_with(p))
}

/// The mod's tree models, as the window names them ("models/props_tree/tree_pine_01.vmdl"): a
/// tree's stump and close-up copy are parts the map never shows standing.
pub fn tree_models<'a>(paths: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = paths
        .map(|p| p.replace('\\', "/").to_lowercase())
        .filter(|l| l.starts_with("models/") && l.ends_with(".vmdl_c") && l.contains("tree"))
        .filter(|l| !l.contains("_stump") && !l.contains("_inspector"))
        .map(|l| l.trim_end_matches("_c").to_string())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// A loose file of the archive as a game path: the part from its "models/" or "materials/"
/// folder on, whatever folder the author packed it in.
pub fn loose_path(rel: &str) -> Option<String> {
    let l = rel.replace('\\', "/");
    let low = l.to_lowercase();
    let at = ["models/", "materials/"]
        .iter()
        .filter_map(|k| if low.starts_with(k) { Some(0) } else { low.find(&format!("/{k}")).map(|i| i + 1) })
        .min()?;
    Some(low[at..].to_string())
}

/// A gameinfo.gi that sends the toolchain to the mod's own files first and the game's after: with
/// the game alone, a model of the mod lost every material the mod brings (drawn green or white).
pub fn game_info(mod_dir: &Path, dota: &Path) -> String {
    let p = |d: &Path| d.to_string_lossy().replace('\\', "/");
    let mut out = String::from("\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n");
    for d in [mod_dir, dota] {
        out.push_str(&format!("\t\t\tGame\t\"{}\"\n", p(d)));
    }
    out.push_str("\t\t}\n\t}\n}\n");
    out
}

/// A volume of a split archive (pak01_000.vpk): read through its _dir.vpk, never alone.
fn is_volume(name: &str) -> bool {
    let l = name.to_lowercase();
    let stem = l.strip_suffix(".vpk").unwrap_or(&l);
    stem.rsplit_once('_').is_some_and(|(_, n)| n.len() == 3 && n.bytes().all(|b| b.is_ascii_digit()))
}

/// The mod's archive unpacked into `root`: the models and materials of every VPK in it and of
/// its loose files, gameinfo.gi beside them, and the list of its tree models. Returns that list.
pub fn unpack(zip: &Path, root: &Path, dota: &Path) -> Result<Vec<String>, String> {
    let _ = fs::remove_dir_all(root);
    let source = source_of(root);
    let vpks = root.join("vpk");
    fs::create_dir_all(&source).map_err(|e| e.to_string())?;
    fs::create_dir_all(&vpks).map_err(|e| e.to_string())?;
    let mut z = OpenedZip::open(Source::File(zip), None, None)?;
    let mut written: Vec<String> = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    for f in z.files.clone() {
        let name = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        if name.to_lowercase().ends_with(".vpk") {
            // the archives side by side under their own names, so a _dir.vpk finds its volumes
            let to = safe_join(&vpks, &name)?;
            fs::write(&to, z.read(&f)?).map_err(|e| e.to_string())?;
            if !is_volume(&name) {
                dirs.push(to);
            }
        } else if let Some(p) = loose_path(&f.path).filter(|p| wanted(p)) {
            fs::write(make_parent(&safe_join(&source, &p)?)?, z.read(&f)?).map_err(|e| e.to_string())?;
            written.push(p);
        }
    }
    for dir in &dirs {
        let index = crate::vpk::Index::open(dir).map_err(|e| e.to_string())?;
        let paths: Vec<String> = index.paths().filter(|p| wanted(p)).map(str::to_string).collect();
        for p in paths {
            let Some(bytes) = index.read(&p).map_err(|e| e.to_string())? else { continue };
            fs::write(make_parent(&safe_join(&source, &p)?)?, bytes).map_err(|e| e.to_string())?;
            written.push(p);
        }
    }
    let _ = fs::remove_dir_all(&vpks);
    fs::write(source.join("gameinfo.gi"), game_info(&source, dota)).map_err(|e| e.to_string())?;
    let models = tree_models(written.iter().map(String::as_str));
    fs::write(root.join(LIST), serde_json::to_string(&models).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(models)
}

fn make_parent(p: &Path) -> Result<&Path, String> {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(p)
}

/// The list an earlier unpacking left, if it finished.
pub fn listed(root: &Path) -> Option<Vec<String>> {
    serde_json::from_slice(&fs::read(root.join(LIST)).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_models_are_the_trees_alone() {
        let got = tree_models(
            [
                "models/props_tree/tree_pine_01.vmdl_c",
                "models/props_tree/tree_pine_01_stump.vmdl_c",
                "models/props_tree/dire_tree004_inspector.vmdl_c",
                "models/props_tree/Dire_Tree004.vmdl_c",
                "models/props_rock/rock_01.vmdl_c",
                "materials/models/props_tree/tree_pine.vmat_c",
                "models/props_tree/tree_pine_01.vmdl_c",
            ]
            .into_iter(),
        );
        assert_eq!(got, vec!["models/props_tree/dire_tree004.vmdl", "models/props_tree/tree_pine_01.vmdl"]);
    }

    #[test]
    fn loose_files_from_any_folder() {
        assert_eq!(loose_path("Cone Trees/models/props_tree/a.vmdl_c").as_deref(), Some("models/props_tree/a.vmdl_c"));
        assert_eq!(loose_path("materials/x.vtex_c").as_deref(), Some("materials/x.vtex_c"));
        assert_eq!(loose_path("game/dota/materials/x.vtex_c").as_deref(), Some("materials/x.vtex_c"));
        assert_eq!(loose_path("readme.txt"), None);
        assert_eq!(loose_path("mymodels/a.vmdl_c"), None);
    }

    #[test]
    fn the_mod_is_searched_before_the_game() {
        let gi = game_info(Path::new(r"C:\m\mm"), Path::new(r"C:\g\dota"));
        let (m, g) = (gi.find("C:/m/mm").unwrap(), gi.find("C:/g/dota").unwrap());
        assert!(m < g, "{gi}");
    }

    #[test]
    fn volumes_are_not_read_alone() {
        assert!(is_volume("pak01_000.vpk"));
        assert!(is_volume("pak02_013.vpk"));
        assert!(!is_volume("pak01_dir.vpk"));
        assert!(!is_volume("trees.vpk"));
    }
}
