//! Ground from another of the game's maps for the Optimization window (map_optimize.rs builds
//! it): each terrain blend of the map in force (materials/blends/...) becomes the one another map
//! uses in the same role, so the winter map's snow lies where the default map has grass and its
//! frozen paths where the paths are. A map names its blends after itself (mod_dire_winter_path_000
//! for mod_dire_path_000, radiant_desert_000 for mod_radiant_000): the role is the name without
//! "mod_", without the other map's own word and without the number. A role the other map has not
//! got falls back to a broader one (radiant_path_destruction to radiant_path to radiant), and a
//! ground no role of the other map fits stays as it is. Lava stays lava.
//!
//! Every map's blends are in pak01; the maps themselves only name them.

use std::path::Path;

use indexmap::IndexMap;
use regex::bytes::Regex as BytesRegex;

use crate::vpk::Index;

/// The game's maps that are terrains: dota_<word>.vpk beside the default dota.vpk. Whether one
/// has a ground of its own to give is ground_pairs' answer: some (reef, cavern, ti10) draw theirs
/// with the default map's blends.
pub fn terrain_maps(maps_dir: &Path) -> Vec<(String, std::path::PathBuf)> {
    let mut out: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(maps_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            let word = name.strip_prefix("dota_")?.strip_suffix(".vpk")?.to_string();
            // the editor's and the tools' maps are no terrains to play on
            let ok =
                word.bytes().all(|b| b.is_ascii_alphanumeric()) && !["loadout", "sfm", "vr"].contains(&word.as_str());
            ok.then(|| (word, e.path()))
        })
        .collect();
    out.sort();
    out
}

/// The terrain blends a map names, without the `.vmat_c` of the compiled file.
pub fn blends_of(map: &Index) -> Vec<String> {
    let re = BytesRegex::new(r"(?-u)materials/blends/[A-Za-z0-9_/]+?\.vmat").expect("a fixed pattern");
    let mut out: Vec<String> = Vec::new();
    for p in map.paths().map(str::to_string).collect::<Vec<_>>() {
        let Some(data) = map.read(&p).ok().flatten() else { continue };
        for m in re.find_iter(&data) {
            let s = String::from_utf8_lossy(m.as_bytes()).to_lowercase();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out.sort();
    out
}

/// A blend's role: its name without "mod_", the map's own word and the trailing number
/// ("materials/blends/mod_dire_winter_path_000.vmat" in winter is "dire_path").
pub fn role_of(material: &str, word: &str) -> String {
    let name = material.rsplit('/').next().unwrap_or(material);
    let name = name.strip_suffix(".vmat").unwrap_or(name);
    let name = name.strip_prefix("mod_").unwrap_or(name);
    let parts: Vec<&str> =
        name.split('_').filter(|t| !t.is_empty() && *t != word && !t.bytes().all(|b| b.is_ascii_digit())).collect();
    parts.join("_")
}

/// Each of `ours` (the map in force's blends) that `theirs` (another map's, its word `word`) has
/// a ground for, and that ground. Lava and blends with no role in common are left out.
pub fn ground_pairs(ours: &[String], theirs: &[String], word: &str) -> IndexMap<String, String> {
    // a map that keeps some of the default map's grounds beside its own: its own win their role
    let mut by_role: IndexMap<String, &String> = IndexMap::new();
    for m in theirs.iter().filter(|m| !m.contains("lava")) {
        let role = role_of(m, word);
        let own = |x: &str| !word.is_empty() && x.contains(word);
        if by_role.get(&role).is_none_or(|was| !own(was) && own(m)) {
            by_role.insert(role, m);
        }
    }
    let mut out = IndexMap::new();
    for m in ours.iter().filter(|m| !m.contains("lava")) {
        let mut role = role_of(m, "");
        loop {
            if let Some(t) = by_role.get(&role) {
                // a ground the map in force has itself is none of the other map's to give
                if *t != m && !ours.contains(*t) {
                    out.insert(m.clone(), (*t).clone());
                }
                break;
            }
            match role.rfind('_') {
                Some(i) => role.truncate(i),
                None => break,
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| format!("materials/blends/{x}.vmat")).collect()
    }

    #[test]
    fn a_role_is_the_name_without_the_map_and_the_number() {
        assert_eq!(role_of("materials/blends/mod_dire_winter_path_000.vmat", "winter"), "dire_path");
        assert_eq!(role_of("materials/blends/radiant_desert_000.vmat", "desert"), "radiant");
        assert_eq!(role_of("materials/blends/mod_radiant_dire_000.vmat", ""), "radiant_dire");
    }

    #[test]
    fn our_grounds_pair_with_the_other_map_s_by_role_and_fall_back_to_a_broader_one() {
        let ours = s(&[
            "mod_radiant_000",
            "mod_radiant_path_destruction_000",
            "mod_dire_path_000",
            "dire_lava",
            "stone_path009",
        ]);
        let theirs =
            s(&["mod_radiant_winter_000", "mod_radiant_winter_path_000", "mod_dire_winter_path_000", "dire_lava"]);
        let p = ground_pairs(&ours, &theirs, "winter");
        assert_eq!(
            p.get("materials/blends/mod_radiant_000.vmat").unwrap(),
            "materials/blends/mod_radiant_winter_000.vmat"
        );
        assert_eq!(
            p.get("materials/blends/mod_radiant_path_destruction_000.vmat").unwrap(),
            "materials/blends/mod_radiant_winter_path_000.vmat",
            "no destruction path in winter: its path"
        );
        assert_eq!(
            p.get("materials/blends/mod_dire_path_000.vmat").unwrap(),
            "materials/blends/mod_dire_winter_path_000.vmat"
        );
        assert!(!p.contains_key("materials/blends/dire_lava.vmat"), "lava stays lava");
        assert!(!p.contains_key("materials/blends/stone_path009.vmat"), "no role in common: as it is");
    }

    /// How much of the default map's ground each of the game's terrains has a role for.
    #[test]
    fn the_game_s_terrains_pair_with_the_default_map() {
        let Ok(dir) = std::env::var("MM_TEST_PAK01") else { return };
        let maps = Path::new(&dir).parent().unwrap().join("maps");
        let ours = blends_of(&Index::open(&maps.join("dota.vpk")).unwrap());
        for (word, path) in terrain_maps(&maps) {
            let theirs = blends_of(&Index::open(&path).unwrap());
            let p = ground_pairs(&ours, &theirs, &word);
            eprintln!("{word}: {} of {}", p.len(), ours.len());
        }
    }
}

/// A terrain blend's colour layers out of its compiled material (loadout_material.rs reads it):
/// each layer's texture as the material names it, its tint as a linear factor and its UV scale,
/// as the light copy of the map writes them for its own grounds (map_scene.rs blend_layers).
pub fn layers_of(m: &crate::loadout_material::NativeMaterial) -> Vec<(String, [f64; 3], f64)> {
    let lin = |x: f64| if x <= 0.04045 { x / 12.92 } else { ((x + 0.055) / 1.055).powf(2.4) };
    let mut out = Vec::new();
    for k in 0..4 {
        let Some(tex) = m.textures.get(&format!("g_tColor{k}")) else { break };
        let tint = m
            .vectors
            .get(&format!("g_vColorTint{k}"))
            .filter(|v| v.len() >= 3)
            .map_or([1.0; 3], |v| [lin(v[0]), lin(v[1]), lin(v[2])]);
        let scale = m.floats.get(&format!("g_flTexCoordScale{k}")).copied().unwrap_or(1.0);
        out.push((tex.to_lowercase(), tint, scale));
    }
    out
}

#[cfg(test)]
mod real {
    use super::*;

    /// The winter map's ground in place of the default one's, made dark on top, in one pak.
    #[test]
    fn winter_ground_goes_in_and_the_dark_darkens_it() {
        let Ok(dir) = std::env::var("MM_TEST_PAK01") else { return };
        let pak = Index::open(Path::new(&dir)).unwrap();
        let maps = Path::new(&dir).parent().unwrap().join("maps");
        let map = Index::open(&maps.join("dota.vpk")).unwrap();
        let winter = Index::open(&maps.join("dota_winter.vpk")).unwrap();
        let pairs: Vec<(String, String)> =
            ground_pairs(&blends_of(&map), &blends_of(&winter), "winter").into_iter().collect();
        let plan = crate::map_optimize::plan(&map, &pak).unwrap();
        let vpk = crate::map_decor::decor_pak(&pak, &plan, &["dark"], &pairs, &Default::default()).unwrap();
        let tmp = std::env::temp_dir().join(format!("mm-ground-{}_dir.vpk", std::process::id()));
        std::fs::write(&tmp, &vpk).unwrap();
        let built = Index::open(&tmp).unwrap();
        let tints = |f: &[u8]| -> Vec<f64> {
            let m = crate::loadout_material::read_loadout_material(Some(f)).unwrap();
            m.vectors
                .iter()
                .filter(|(k, _)| k.starts_with("g_vColorTint"))
                .flat_map(|(_, v)| v.iter().take(3).copied())
                .collect()
        };
        let (ours, theirs) = &pairs[0];
        let got = built.read(&format!("{ours}_c")).unwrap().expect("our ground in the pak");
        let want = pak.read(&format!("{theirs}_c")).unwrap().unwrap();
        let (a, b) = (tints(&want), tints(&got));
        assert!(!a.is_empty());
        for (x, y) in a.iter().zip(&b) {
            assert!((x * crate::map_optimize::DARK - y).abs() < 1e-6, "{ours}: {x} -> {y}");
        }
        let _ = std::fs::remove_file(&tmp);
    }
}

/// The game's terrain items (prefab "terrain": Winter Terrain, Immortal Gardens...), each with the
/// map it puts in place of the default one (its map_override names maps/dota_<word>.vmap): what
/// the Optimization window offers as the map, as Dota Effect Studio does. The default terrain has
/// no map of its own and is left out.
pub fn terrain_items(text: &[u8]) -> Vec<(String, String, String)> {
    let Ok(items) = crate::schema::items_of(text) else { return vec![] };
    let map = BytesRegex::new(r"(?-u)maps/dota_([a-z0-9]+)\.vmap").expect("a fixed pattern");
    items
        .iter()
        .filter(|i| i.prefab == "terrain")
        .filter_map(|i| {
            let block = text.get(i.start..i.end)?;
            let word = map.captures(block).map(|c| String::from_utf8_lossy(&c[1]).into_owned())?;
            Some((i.id.clone(), i.name.clone(), word))
        })
        .collect()
}

/// The weather items of the game by id, and which weather each is (map_decor.rs WEATHER_KEYS).
const WEATHER_IDS: [(&str, &str); 9] = [
    ("10704", "snow"),
    ("10706", "rain"),
    ("10707", "moonbeam"),
    ("11083", "pestilence"),
    ("11414", "sirocco"),
    ("11454", "harvest"),
    ("11549", "ash"),
    ("11550", "aurora"),
    ("11551", "spring"),
];

/// The game's weather items (Rain, Snow, Ash, Moonbeam...) as Dota Effect Studio offers them: id,
/// name and the weather's key (map_decor.rs WEATHER_KEYS), by the particle the item draws; the one
/// whose name says "Default" is the game as it is, said apart.
/// The weather items (id, name, key) and the default one (id, name).
pub type WeatherItems = (Vec<(String, String, String)>, Option<(String, String)>);

pub fn weather_items(text: &[u8]) -> WeatherItems {
    let Ok(items) = crate::schema::items_of(text) else { return (vec![], None) };
    let particle = BytesRegex::new(r"(?-u)particles/rain_fx/[a-z_]+.vpcf").expect("a fixed pattern");
    let mut out = Vec::new();
    let mut default = None;
    // the default one is prefab "weather", the rest wear the slot alone
    for i in items.iter().filter(|i| i.prefab == "weather" || i.slot == "weather") {
        if i.name.to_lowercase().contains("default") {
            default.get_or_insert((i.id.clone(), i.name.clone()));
        } else {
            // the items name no particle: the weather is the item's, by its id (as Dota Effect Studio knows them)
            let block = text.get(i.start..i.end).unwrap_or_default();
            let key = WEATHER_IDS.iter().find(|(id, _)| *id == i.id).map(|(_, k)| (*k).to_string()).or_else(|| {
                particle
                    .find_iter(block)
                    .filter_map(|m| crate::map_build::WEATHERS.iter().position(|w| w.as_bytes() == m.as_bytes()))
                    .next()
                    .map(|k| crate::map_decor::WEATHER_KEYS[k].to_string())
            });
            if let Some(key) = key {
                out.push((i.id.clone(), i.name.clone(), key));
            }
        }
    }
    (out, default)
}
