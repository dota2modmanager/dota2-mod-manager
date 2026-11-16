//! A catalog terrain that is a pak of materials, as the Optimization window's 3D map takes it: the
//! default map stays loaded and only its materials change, so picking LowPoly or Mossy Cobblestone
//! is a few pictures rather than a whole map exported again (a minute and fifty megabytes each).
//!
//! The pak's materials sort three ways: those on the fog of war's shader, which the game draws as
//! nothing (how such a terrain takes rocks and flowers away); terrain blends, whose layers go to
//! the ground the way another map's did (map_ground.rs layers_of); and every other one, a picture
//! and a tint. The window matches each by its material's path to the map's own.

use indexmap::IndexMap;

use crate::vpk::Index;

/// What a pak does to the map's materials, by each material's path ("materials/x/y.vmat").
#[derive(Debug, Default)]
pub struct PakLook {
    /// drawn as nothing
    pub hidden: Vec<String>,
    /// a picture (as the material names it) and a tint, linear
    pub plain: IndexMap<String, (Option<String>, [f64; 3])>,
    /// a terrain blend's layers: picture, tint, scale
    pub grounds: IndexMap<String, Vec<(String, [f64; 3], f64)>>,
}

impl PakLook {
    /// Every picture the look needs, each once.
    pub fn textures(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let all = self
            .plain
            .values()
            .filter_map(|(t, _)| t.clone())
            .chain(self.grounds.values().flatten().map(|l| l.0.clone()));
        for t in all {
            if !out.contains(&t) {
                out.push(t);
            }
        }
        out
    }
}

fn linear(x: f64) -> f64 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

/// The pak's materials read.
pub fn pak_look(pak: &Index) -> PakLook {
    let mut out = PakLook::default();
    let paths: Vec<String> = pak.paths().filter(|p| p.ends_with(".vmat_c")).map(str::to_string).collect();
    for p in paths {
        let name = p.trim_end_matches("_c").to_string();
        let file = pak.read(&p).ok().flatten();
        let Some(m) = crate::loadout_material::read_loadout_material(file.as_deref()) else { continue };
        let shader = m.shader.to_lowercase();
        if shader.contains("dota_fow") {
            out.hidden.push(name);
        } else if shader.contains("multiblend") {
            let layers = crate::map_ground::layers_of(&m);
            if !layers.is_empty() {
                out.grounds.insert(name, layers);
            }
        } else {
            let tex = m.textures.get("g_tColor").or_else(|| m.textures.get("g_tColor0")).map(|t| t.to_lowercase());
            let tint = m
                .vectors
                .get("g_vColorTint")
                .filter(|v| v.len() >= 3)
                .map_or([1.0; 3], |v| [linear(v[0]), linear(v[1]), linear(v[2])]);
            out.plain.insert(name, (tex, tint));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A terrain pak of the catalog (MM_TEST_TERRAIN_PAK): its hidden, plain and ground materials.
    #[test]
    fn a_real_terrain_pak() {
        let Ok(p) = std::env::var("MM_TEST_TERRAIN_PAK") else { return };
        let look = pak_look(&Index::open(std::path::Path::new(&p)).unwrap());
        eprintln!(
            "hidden {} plain {} grounds {} textures {}",
            look.hidden.len(),
            look.plain.len(),
            look.grounds.len(),
            look.textures().len()
        );
        assert!(!look.hidden.is_empty() || !look.plain.is_empty() || !look.grounds.is_empty());
    }
}
