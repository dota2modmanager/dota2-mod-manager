//! What the map the Optimization window builds is made from: the game's default map, one of the
//! game's terrains (maps/dota_winter.vpk, moved to the default map's names by map_build.rs), or a
//! terrain of the catalog. A catalog terrain is one of two things: a whole maps/dota.vpk ready to go
//! (Dota Effect Studio's: Dota+ Winter, the TI terrains), which is the base, or a pak of the
//! game's ground materials redrawn (LowPoly, DarkPoly, Dark Terrain), which goes into the
//! Optimization pak over the default map. Either is downloaded as an install would and kept in
//! the user's data, so a build after a Dota update finds it without the network.

use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};

/// A base as the record names it: "game:winter", "catalog:LowPoly.zip"; none is the default map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Base {
    Game(String),
    Catalog(String),
}

impl Base {
    pub fn parse(s: &str) -> Option<Base> {
        if let Some(w) = s.strip_prefix("game:") {
            let ok = !w.is_empty() && w.len() <= 16 && w.bytes().all(|b| b.is_ascii_alphanumeric());
            return ok.then(|| Base::Game(w.to_string()));
        }
        let f = s.strip_prefix("catalog:")?;
        let ok = !f.is_empty() && f.len() <= 200 && !f.contains(['/', '\\', '\0']) && !f.contains("..");
        ok.then(|| Base::Catalog(f.to_string()))
    }
    pub fn name(&self) -> String {
        match self {
            Base::Game(w) => format!("game:{w}"),
            Base::Catalog(f) => format!("catalog:{f}"),
        }
    }
    /// The word of a game terrain, whose files move to the default map's names.
    pub fn word(&self) -> Option<&str> {
        match self {
            Base::Game(w) => Some(w),
            Base::Catalog(_) => None,
        }
    }
}

/// Where a catalog terrain's map is kept: one folder per archive name.
pub fn catalog_map(user_data: &Path, file: &str) -> PathBuf {
    let hash = format!("{:x}", Sha1::digest(file.as_bytes()));
    user_data.join("map-bases").join(&hash[..12]).join("dota.vpk")
}

/// Where a catalog terrain that is a pak of materials is kept, beside where a map would be.
pub fn catalog_pak(user_data: &Path, file: &str) -> PathBuf {
    catalog_map(user_data, file).with_file_name("pak.vpk")
}

/// A gameinfo.gi beside a kept terrain, sending the toolchain to the game for every material the
/// map names and does not bring. Without it a map out of the user's data exported with no
/// materials at all, and the window drew it grey and white.
pub fn point_at_game(game: &Path, user_data: &Path, file: &str) {
    let gi = catalog_map(user_data, file).with_file_name("gameinfo.gi");
    if !gi.is_file() {
        let _ = std::fs::write(gi, crate::model_glb::game_info(&game.join("dota").to_string_lossy()));
    }
}

/// Whether a catalog terrain has been taken out of its archive, as a map or as a pak.
pub fn catalog_kept(user_data: &Path, file: &str) -> bool {
    catalog_map(user_data, file).is_file() || catalog_pak(user_data, file).is_file()
}

/// The archive a base's map is read from: None when it is not there (a catalog terrain not yet
/// downloaded, a terrain this game has not got).
pub fn base_file(game: &Path, user_data: &Path, base: Option<&Base>) -> Option<PathBuf> {
    let p = match base {
        None => game.join("dota").join("maps").join("dota.vpk"),
        Some(Base::Game(w)) => game.join("dota").join("maps").join(format!("dota_{w}.vpk")),
        // a pak of materials goes over the default map
        Some(Base::Catalog(f)) if catalog_pak(user_data, f).is_file() => {
            game.join("dota").join("maps").join("dota.vpk")
        }
        Some(Base::Catalog(f)) => catalog_map(user_data, f),
    };
    p.is_file().then_some(p)
}

/// What the window's 3D map draws a catalog terrain that is a pak from: the default map with the
/// pak's files in the same archive, made once beside the pak. The toolchain takes a material from
/// the archive it exports before the game's, so the map comes out in the terrain's materials.
pub fn catalog_preview(game: &Path, user_data: &Path, file: &str) -> Option<PathBuf> {
    let pak = catalog_pak(user_data, file);
    let out = pak.with_file_name("preview.vpk");
    if out.is_file() {
        return Some(out);
    }
    let default = crate::vpk::Index::open(&game.join("dota").join("maps").join("dota.vpk")).ok()?;
    let mut entries: indexmap::IndexMap<String, crate::vpk::Entry> = indexmap::IndexMap::new();
    for p in default.paths().map(str::to_string).collect::<Vec<_>>() {
        let d = default.read(&p).ok()??;
        entries.insert(p.clone(), crate::vpk::entry_at(&p, d.into()));
    }
    for e in catalog_entries(user_data, Some(&Base::Catalog(file.to_string()))) {
        entries.insert(e.path(), e);
    }
    let part = out.with_extension("vpk.part");
    std::fs::write(&part, crate::vpk::build(&entries.into_values().collect::<Vec<_>>())).ok()?;
    std::fs::rename(&part, &out).ok()?;
    Some(out)
}

/// A catalog terrain's pak of materials, as entries for the Optimization pak; none for a map.
pub fn catalog_entries(user_data: &Path, base: Option<&Base>) -> Vec<crate::vpk::Entry> {
    let Some(Base::Catalog(f)) = base else { return vec![] };
    let Ok(ix) = crate::vpk::Index::open(&catalog_pak(user_data, f)) else { return vec![] };
    let paths: Vec<String> = ix.paths().map(str::to_string).collect();
    paths.into_iter().filter_map(|p| Some(crate::vpk::entry_at(&p, ix.read(&p).ok()??.into()))).collect()
}

/// The maps/dota.vpk out of a catalog terrain's archive, written where the base is kept; an
/// archive with a pak of materials instead has the pak kept beside it (catalog_pak).
pub fn take_catalog_map(zip: &Path, to: &Path) -> Result<(), String> {
    let mut z = crate::safe_zip::OpenedZip::open(crate::safe_zip::Source::File(zip), None, None)?;
    let map = z
        .files
        .iter()
        .find(|f| {
            let l = f.path.replace('\\', "/").to_lowercase();
            l == "maps/dota.vpk" || l.ends_with("/maps/dota.vpk")
        })
        .cloned();
    let (file, to) = match map {
        Some(f) => (f, to.to_path_buf()),
        None => {
            let pak = z
                .files
                .iter()
                .find(|f| f.path.to_lowercase().ends_with(".vpk"))
                .cloned()
                .ok_or_else(|| crate::i18n::t("в архиве нет .vpk файлов", &[]))?;
            (pak, to.with_file_name("pak.vpk"))
        }
    };
    let to = to.as_path();
    let bytes = z.read(&file)?;
    if let Some(d) = to.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let part = to.with_extension("vpk.part");
    std::fs::write(&part, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&part, to).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_base_by_its_name() {
        assert_eq!(Base::parse("game:winter"), Some(Base::Game("winter".into())));
        assert_eq!(Base::parse("catalog:LowPoly & Trees.zip"), Some(Base::Catalog("LowPoly & Trees.zip".into())));
        assert_eq!(Base::parse("game:../x"), None);
        assert_eq!(Base::parse("catalog:../x.zip"), None);
        assert_eq!(Base::parse("winter"), None);
        assert_eq!(Base::parse("catalog:LowPoly.zip").unwrap().name(), "catalog:LowPoly.zip");
    }
}
