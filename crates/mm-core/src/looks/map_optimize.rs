//! What the Optimization window can take out of the game, group by group (map_decor.rs builds and
//! keeps the record). Each group is a list of the game's compiled files and what goes in place of
//! each:
//!
//! - a material becomes the game's dev/transparent, which draws nothing and casts no shadow;
//! - a particle becomes one silent particle, built here from a particle of the game with every
//!   renderer, emitter, operator and child taken out, so it starts, shows nothing and ends;
//! - a ground material (the map's terrain blends) keeps its pictures with its colour tints made
//!   darker: dusk, or dark, a map that reads as night without being one;
//! - a tree becomes a lighter tree: the lightest of its own kind (treesSimple), or the lightest
//!   tree of the whole map (trees), the one whose compiled model is the smallest.
//!
//! The window sets each kind of thing by a slider of steps, and each step is a group of its own, so
//! grass can stay while the trees go simple: plants are critters (flowers, creatures) and grass,
//! debris is stains and rocks, water is waterfalls and the river, light is rays and fires. The
//! groups the app wrote before the steps (plants, debris, water, lights) still name both of theirs.
//!
//! The map's groups are read off the map in force each time (materials, particles and models it
//! names); the others off pak01 by their folders. Nothing is added: every path is one the game has.

use std::collections::BTreeSet;

use indexmap::IndexMap;
use regex::bytes::Regex as BytesRegex;
use regex::Regex;

use crate::kv3;
use crate::resource;
use crate::vpk::Index;

/// Every group, in the order the window lists them; the trees' two last, the whole map's winning.
pub const GROUPS: [&str; 17] = [
    "critters",
    "grass",
    "stains",
    "rocks",
    "waterfalls",
    "river",
    "mapFx",
    "rays",
    "fires",
    "towerFx",
    "courierFx",
    "eventFx",
    "weather",
    "treesSimple",
    "trees",
    "dusk",
    "dark",
];

/// How much of its colour a ground keeps in the dusk and in the dark.
pub const DUSK: f64 = 0.65;
pub const DARK: f64 = 0.4;

/// The groups before the steps, each the steps it covers.
pub const ALIASES: [(&str, [&str; 2]); 4] = [
    ("plants", ["critters", "grass"]),
    ("debris", ["stains", "rocks"]),
    ("water", ["waterfalls", "river"]),
    ("lights", ["rays", "fires"]),
];

/// Group names as the window or an older record sent them: each known group once, aliases opened
/// out, in GROUPS' order.
pub fn expand<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let mut want: BTreeSet<&'static str> = BTreeSet::new();
    for n in names {
        if let Some(g) = GROUPS.iter().find(|g| **g == n) {
            want.insert(g);
        } else if let Some((_, parts)) = ALIASES.iter().find(|(a, _)| *a == n) {
            want.extend(parts.iter().copied());
        }
    }
    GROUPS.iter().copied().filter(|g| want.contains(g)).collect()
}

/// What goes in place of a file.
#[derive(Debug, Clone, PartialEq)]
pub enum Fill {
    /// the game's dev/transparent
    Material,
    /// the silent particle
    Particle,
    /// another compiled model of the game, by its path
    Model(String),
    /// the material itself with its colour tints times this
    Darken(f64),
}

/// A material with every g_vColorTint (g_vColorTint0..3 of a terrain blend) times `k`, the alpha
/// left; the rest of the file as it was.
pub fn darken_material(file: &[u8], k: f64) -> Result<Vec<u8>, String> {
    tint_material(file, [k, k, k])
}

/// The same, each channel by its own factor: the ground in a colour of the user's (ground_facets.rs).
pub fn tint_material(file: &[u8], k: [f64; 3]) -> Result<Vec<u8>, String> {
    // an older material is a C struct: its tints are float32s at the offsets its NTRO block gives
    if resource::blocks(file).map_err(|e| e.to_string())?.iter().any(|b| b.name == "NTRO") {
        let mut data = resource::data(file, "DATA", 0).map_err(|e| e.to_string())?.to_vec();
        let mut any = false;
        for (name, at) in crate::loadout_material::ntro_vectors(file)? {
            if !name.starts_with("g_vColorTint") {
                continue;
            }
            for (c, kc) in k.iter().enumerate() {
                let p = at + c * 4;
                let Some(b) = data.get(p..p + 4) else { continue };
                let v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]) * *kc as f32;
                data[p..p + 4].copy_from_slice(&v.to_le_bytes());
                any = true;
            }
        }
        if !any {
            return Err("no colour tint to darken".into());
        }
        return resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string());
    }
    let mut kv = kv3::read(resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut root = std::mem::replace(&mut kv.root, kv3::Node::new(kv3::Value::Other { ty: 1, value: None }));
    let mut any = false;
    if let Some(kv3::Value::Array { items, .. }) = root.get_mut("m_vectorParams").map(|n| &mut n.value) {
        for p in items.iter_mut() {
            let tint = p.get("m_name").and_then(kv3::Node::as_str).is_some_and(|n| n.starts_with("g_vColorTint"));
            if !tint {
                continue;
            }
            if let Some(kv3::Value::Array { items: v, .. }) = p.get_mut("m_value").map(|n| &mut n.value) {
                for (c, x) in v.iter_mut().take(3).enumerate() {
                    if let Some(n) = kv.number_of(x) {
                        any |= kv.set_number(x, n * k[c]).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }
    kv.root = root;
    if !any {
        return Err("no colour tint to darken".into());
    }
    let data = kv3::write(&kv).map_err(|e| e.to_string())?;
    resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())
}

/// Each group's files, in GROUPS' order; a group with nothing on this map is empty.
pub type Plan = IndexMap<&'static str, Vec<(String, Fill)>>;

fn re(p: &str) -> Regex {
    Regex::new(p).expect("a fixed pattern")
}

/// The group a material of the map belongs to, if any.
pub fn material_group(m: &str) -> Option<&'static str> {
    if re(r"^materials/(models/props_wildlife/|nature/card_flowers)").is_match(m) {
        return Some("critters");
    }
    if re(r"^materials/(models/props_nature/|nature/card_grass)").is_match(m) {
        return Some("grass");
    }
    if re(r"^materials/overlays/(blood|petals|leaves)").is_match(m) {
        return Some("stains");
    }
    if re(r"^materials/models/(props_debris|props_bones|props_rock|props_magic)/").is_match(m) {
        return Some("rocks");
    }
    if re(r"^materials/models/effects/(waterfall|fountain_waterfall|liquid_pour)").is_match(m) {
        return Some("waterfalls");
    }
    if re(r"^materials/(models/effects/(riverflow|water_edges)|blends/dire_lava)").is_match(m) {
        return Some("river");
    }
    if re(r"lightrays").is_match(m) {
        return Some("rays");
    }
    None
}

/// The group a particle the map names belongs to: fire, glow and light, or the rest of its ambience.
/// A building's destruction effect (dire_tower002_destruction, radiant_tower002_dest_lvl1): kept
/// whole, since a building falls through it.
pub fn is_destruction(p: &str) -> bool {
    re(r"_dest(ruction)?(_|.|$)").is_match(p)
}

pub fn map_particle_group(p: &str) -> &'static str {
    // fireflies are lights in the air, not fire
    if re(r"(firefl|light|glow|ray)").is_match(p) {
        "rays"
    } else if re(r"(fire|flame|torch|lamp|candle|brazier|ember|lantern)").is_match(p) {
        "fires"
    } else {
        "mapFx"
    }
}

/// A tree's kind: its model's name without the numbers and letters that tell the variants apart
/// (dire_tree004b and dire_tree007 are dire_tree, tree_oak_02 is tree_oak).
pub fn tree_kind(model: &str) -> String {
    let name = model.rsplit('/').next().unwrap_or(model);
    let name = name.strip_suffix("_c").unwrap_or(name);
    let name = name.strip_suffix(".vmdl").unwrap_or(name);
    re(r"_?\d+[a-z]?\b|_?\d+[a-z]?(_|$)").replace_all(name, "$1").trim_end_matches('_').to_string()
}

/// The group of a particle of pak01 by its folder, if it is one the window takes out whole.
pub fn pak_particle_group(p: &str) -> Option<&'static str> {
    if !p.ends_with(".vpcf_c") {
        return None;
    }
    if p.starts_with("particles/base_attacks/ranged_tower_") {
        Some("towerFx")
    } else if p.starts_with("particles/econ/courier/") {
        Some("courierFx")
    } else if p.starts_with("particles/econ/events/") {
        Some("eventFx")
    } else if p.starts_with("particles/rain_fx/") {
        Some("weather")
    } else {
        None
    }
}

/// How heavy a compiled model is to draw, by its bytes: the model's file and every mesh it names
/// (a static tree keeps its geometry in a .vmesh of its own, and its .vmdl alone is the smallest of
/// all). None for a model pak01 does not hold.
pub fn model_weight(pak: &Index, path: &str) -> Option<usize> {
    let file = pak.read(path).ok().flatten()?;
    let meshes: usize = resource::references(&file)
        .unwrap_or_default()
        .iter()
        .filter(|r| r.ends_with(".vmesh") || r.ends_with(".vmesh_c"))
        .filter_map(|r| {
            let r = r.to_lowercase();
            let c = if r.ends_with("_c") { r } else { format!("{r}_c") };
            pak.read(&c).ok().flatten().map(|d| d.len())
        })
        .sum();
    Some(file.len() + meshes)
}

/// A tree the map stands, and not a stump, a sapling or a tree being cut.
fn is_tree(m: &str) -> bool {
    m.starts_with("models/props_tree/") && !re(r"(stump|grow|cut|destr|fall|sapling)").is_match(m)
}

/// What the map names: its materials, the particles it starts, and its models, each lowercased
/// and without the `_c` of the compiled file, the models' own materials among the materials.
/// The map's materials, its models and its particles, as map_names reads them.
pub type MapNames = (BTreeSet<String>, BTreeSet<String>, Vec<String>);

pub fn map_names(map: &Index, pak: &Index) -> Result<MapNames, String> {
    let material = BytesRegex::new(r"(?-u)materials/[A-Za-z0-9_/.-]+?\.vmat").expect("a fixed pattern");
    let particle = BytesRegex::new(r"(?-u)particles/[A-Za-z0-9_/.-]+?\.vpcf").expect("a fixed pattern");
    let model = BytesRegex::new(r"(?-u)models/[A-Za-z0-9_/.-]+?\.vmdl").expect("a fixed pattern");
    let low = |b: &[u8]| String::from_utf8_lossy(b).to_lowercase();
    let mut mats = BTreeSet::new();
    let mut fx = BTreeSet::new();
    let mut models: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for p in map.paths().map(str::to_string).collect::<Vec<_>>() {
        let text = map.read(&p).map_err(|e| e.to_string())?.unwrap_or_default();
        mats.extend(material.find_iter(&text).map(|m| low(m.as_bytes())));
        fx.extend(particle.find_iter(&text).map(|m| low(m.as_bytes())));
        for m in model.find_iter(&text) {
            let m = low(m.as_bytes());
            if seen.insert(m.clone()) {
                models.push(m);
            }
        }
    }
    for m in &models {
        if let Some(data) = pak.read(&format!("{m}_c")).map_err(|e| e.to_string())? {
            mats.extend(material.find_iter(&data).map(|x| low(x.as_bytes())));
        }
    }
    Ok((mats, fx, models))
}

/// Each group's files on `map`, with what goes in place of each.
pub fn plan(map: &Index, pak: &Index) -> Result<Plan, String> {
    let (mats, fx, models) = map_names(map, pak)?;
    let mut out: Plan = GROUPS.iter().map(|g| (*g, Vec::new())).collect();
    for m in mats {
        if let Some(g) = material_group(&m) {
            let p = format!("{m}_c");
            if pak.has(&p) {
                out[g].push((p, Fill::Material));
            }
        }
    }
    for f in fx {
        let p = format!("{f}_c");
        // a building's fall is what its destruction effect shows: silent, a tower just vanished
        if is_destruction(&f) {
            continue;
        }
        if pak.has(&p) && pak_particle_group(&p).is_none() {
            out[map_particle_group(&f)].push((p, Fill::Particle));
        }
    }
    for p in pak.paths() {
        if let Some(g) = pak_particle_group(p) {
            out[g].push((p.to_string(), Fill::Particle));
        }
    }
    // every tree of the map as the lightest of its kind, or as the lightest of them all
    let trees: Vec<(String, usize)> = models
        .iter()
        .filter(|m| is_tree(m))
        .filter_map(|m| {
            let p = format!("{m}_c");
            model_weight(pak, &p).map(|n| (p, n))
        })
        .collect();
    if let Some((light, _)) = trees.iter().min_by_key(|(p, n)| (*n, p.clone())) {
        for (p, _) in &trees {
            if p != light {
                out["trees"].push((p.clone(), Fill::Model(light.clone())));
            }
        }
    }
    let mut kinds: IndexMap<String, Vec<&(String, usize)>> = IndexMap::new();
    for t in &trees {
        kinds.entry(tree_kind(&t.0)).or_default().push(t);
    }
    for list in kinds.values() {
        let Some((light, _)) = list.iter().min_by_key(|(p, n)| (*n, p.clone())) else { continue };
        for (p, _) in list.iter().map(|t| (&t.0, t.1)) {
            if p != light {
                out["treesSimple"].push((p.clone(), Fill::Model(light.clone())));
            }
        }
    }
    // the ground: the map's terrain blends, lava left as it burns
    let (mats_again, _, _) = map_names(map, pak)?;
    for m in mats_again.iter().filter(|m| m.starts_with("materials/blends/") && !m.contains("lava")) {
        let p = format!("{m}_c");
        if pak.has(&p) {
            out["dusk"].push((p.clone(), Fill::Darken(DUSK)));
            out["dark"].push((p, Fill::Darken(DARK)));
        }
    }
    for list in out.values_mut() {
        list.sort_by(|a, b| a.0.cmp(&b.0));
        list.dedup_by(|a, b| a.0 == b.0);
    }
    Ok(out)
}

/// What the window's 3D scene shows for a group: the map's own models it takes away (or, for the
/// trees, the heavy ones and the one they become), and a few of its effects.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct Sample {
    pub models: Vec<String>,
    pub particles: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// the materials the group turns transparent, as the game names them (no _c): the whole map's
    /// 3D view hides the parts that wear them
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub materials: Vec<String>,
    /// the trees' groups: each tree model the map stands (no _c) and the one it becomes
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub swaps: Vec<[String; 2]>,
}

/// A few of each group's things to stand in the scene, read off the map and the plan.
pub fn samples(map: &Index, pak: &Index, plan: &Plan) -> Result<IndexMap<&'static str, Sample>, String> {
    let (_, _, models) = map_names(map, pak)?;
    let material = BytesRegex::new(r"(?-u)materials/[A-Za-z0-9_/.-]+?.vmat").expect("a fixed pattern");
    let mut out: IndexMap<&'static str, Sample> = GROUPS.iter().map(|g| (*g, Sample::default())).collect();
    let lamp = re(r"(lamp|torch|lantern|brazier|candle)");
    let plain = |p: &str| p.strip_suffix("_c").unwrap_or(p).to_string();
    for m in &models {
        let p = format!("{m}_c");
        if m.starts_with("models/props_tree/") {
            continue;
        }
        let group = if lamp.is_match(m) {
            Some("fires")
        } else {
            // a model all of whose materials one group takes is that group's
            let Some(data) = pak.read(&p).ok().flatten() else { continue };
            let groups: BTreeSet<Option<&str>> = material
                .find_iter(&data)
                .map(|x| material_group(&String::from_utf8_lossy(x.as_bytes()).to_lowercase()))
                .collect();
            match groups.into_iter().collect::<Vec<_>>().as_slice() {
                [Some(g)] => Some(*g),
                _ => None,
            }
        };
        if let Some(g) = group {
            out[g].models.push(m.clone());
        }
    }
    // what reads as the group at a glance first: bushes before cliffs, bones before crystals
    let typical = [
        "bush", "grass", "flower", "fern", "plant", "bones", "debris", "rock", "stone", "water", "lamp", "torch",
        "lantern",
    ];
    let rank = |m: &String| typical.iter().position(|w| m.contains(w)).unwrap_or(typical.len());
    for s in out.values_mut() {
        s.models.sort_by_key(rank);
        s.models.truncate(4);
    }
    for (g, list) in plan {
        out[*g].materials = list
            .iter()
            .filter(|(p, f)| *f == Fill::Material && p.ends_with(".vmat_c"))
            .map(|(p, _)| p.strip_suffix("_c").unwrap_or(p).to_string())
            .collect();
    }
    for g in ["trees", "treesSimple"] {
        out[g].swaps = plan[g]
            .iter()
            .filter_map(|(p, f)| match f {
                Fill::Model(to) => Some([plain(p), plain(to)]),
                _ => None,
            })
            .collect();
    }
    if let Some((_, Fill::Model(light))) = plan["trees"].first() {
        out["trees"].after = Some(plain(light));
    }
    for g in ["mapFx", "rays", "fires", "towerFx", "courierFx", "eventFx", "weather"] {
        // the parents rather than their children: a name with a few parts, ambient ones first
        let mut fx: Vec<&String> = plan[g].iter().filter(|(_, f)| *f == Fill::Particle).map(|(p, _)| p).collect();
        fx.sort_by_key(|p| (!p.contains("ambient"), p.matches('_').count(), p.len()));
        out[g].particles = fx.into_iter().take(3).map(|p| p.strip_suffix("_c").unwrap_or(p).to_string()).collect();
    }
    Ok(out)
}

/// A particle that starts, shows nothing and ends: `file` with every renderer, emitter, operator,
/// initializer and child taken out. What it names stays named: those are the game's own files.
pub fn silent_particle(file: &[u8]) -> Result<Vec<u8>, String> {
    let mut kv = kv3::read(resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    for key in [
        "m_Renderers",
        "m_Emitters",
        "m_Operators",
        "m_Initializers",
        "m_Children",
        "m_ForceGenerators",
        "m_Constraints",
        "m_PreEmissionOperators",
    ] {
        if let Some(kv3::Value::Array { items, .. }) = kv.root.get_mut(key).map(|n| &mut n.value) {
            items.clear();
        }
    }
    let data = kv3::write(&kv).map_err(|e| e.to_string())?;
    resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())
}

/// The silent particle, made from the smallest particle of the groups that reads and writes back.
pub fn silent_from(pak: &Index, plan: &Plan) -> Result<Vec<u8>, String> {
    let mut tried: Vec<(usize, String)> = plan
        .values()
        .flatten()
        .filter(|(_, f)| *f == Fill::Particle)
        .take(400)
        .filter_map(|(p, _)| pak.read(p).ok().flatten().map(|d| (d.len(), p.clone())))
        .collect();
    tried.sort();
    for (_, p) in tried.iter().take(20) {
        if let Some(file) = pak.read(p).ok().flatten() {
            if let Ok(out) = silent_particle(&file) {
                return Ok(out);
            }
        }
    }
    Err("no particle of the game could be made silent".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materials_go_to_their_groups() {
        assert_eq!(material_group("materials/nature/card_grass_01.vmat"), Some("grass"));
        assert_eq!(material_group("materials/nature/card_flowers_01.vmat"), Some("critters"));
        assert_eq!(material_group("materials/models/props_wildlife/frog.vmat"), Some("critters"));
        assert_eq!(material_group("materials/models/props_rock/rock_01.vmat"), Some("rocks"));
        assert_eq!(material_group("materials/overlays/blood001.vmat"), Some("stains"));
        assert_eq!(material_group("materials/models/effects/riverflow.vmat"), Some("river"));
        assert_eq!(material_group("materials/models/effects/waterfall_00.vmat"), Some("waterfalls"));
        assert_eq!(material_group("materials/blends/dire_lava.vmat"), Some("river"));
        assert_eq!(material_group("materials/models/effects/radiant_lightrays.vmat"), Some("rays"));
        assert_eq!(material_group("materials/models/props_tree/tree_oak_leaves_00.vmat"), None);
    }

    #[test]
    fn particles_go_to_their_groups() {
        assert_eq!(map_particle_group("particles/addons_gameplay/lamp_flame_new.vpcf"), "fires");
        assert!(is_destruction("particles/dire_fx/dire_tower002_destruction.vpcf"));
        assert!(is_destruction("particles/radiant_fx2/radiant_tower002_dest_lvl1.vpcf"));
        assert!(!is_destruction("particles/dire_fx/bad_ancient_ambient.vpcf"));
        assert_eq!(map_particle_group("particles/world_creature_fx/fireflies.vpcf"), "rays");
        assert_eq!(map_particle_group("particles/dire_fx/dire_lfr_glow_13sec.vpcf"), "rays");
        assert_eq!(map_particle_group("particles/world_environmental_fx/radiant_ambient_dust.vpcf"), "mapFx");
        assert_eq!(pak_particle_group("particles/base_attacks/ranged_tower_bad.vpcf_c"), Some("towerFx"));
        assert_eq!(pak_particle_group("particles/econ/courier/x/y.vpcf_c"), Some("courierFx"));
        assert_eq!(pak_particle_group("particles/econ/events/ti10/a.vpcf_c"), Some("eventFx"));
        assert_eq!(pak_particle_group("particles/econ/events/ti10/a.vmat_c"), None);
        assert_eq!(pak_particle_group("particles/rain_fx/snow.vpcf_c"), Some("weather"));
        assert_eq!(pak_particle_group("particles/units/heroes/hero_axe/axe_beserkers_call.vpcf_c"), None);
    }

    #[test]
    fn old_group_names_open_into_their_steps() {
        assert_eq!(expand(["plants", "trees"]), vec!["critters", "grass", "trees"]);
        assert_eq!(
            expand(["debris", "water", "lights"]),
            vec!["stains", "rocks", "waterfalls", "river", "rays", "fires"]
        );
        assert_eq!(expand(["grass", "grass", "nope"]), vec!["grass"]);
    }

    #[test]
    fn a_tree_s_kind_leaves_out_its_variant() {
        assert_eq!(tree_kind("models/props_tree/dire_tree004b.vmdl_c"), "dire_tree");
        assert_eq!(tree_kind("models/props_tree/dire_tree007.vmdl"), "dire_tree");
        assert_eq!(tree_kind("models/props_tree/tree_oak_02.vmdl"), "tree_oak");
        assert_eq!(tree_kind("models/props_tree/tree_cine_02_low.vmdl"), "tree_cine_low");
        assert_eq!(tree_kind("models/props_tree/tree_gnarly001.vmdl"), "tree_gnarly");
    }

    #[test]
    fn a_tree_is_a_standing_tree() {
        assert!(is_tree("models/props_tree/dire_tree001.vmdl"));
        assert!(!is_tree("models/props_tree/tree_stump_01.vmdl"));
        assert!(!is_tree("models/props_tree/dire_tree002_grow.vmdl"));
        assert!(!is_tree("models/props_structures/tower.vmdl"));
    }

    /// The game's own particles made silent, when the game is on this computer.
    #[test]
    fn a_game_particle_made_silent_reads_back_empty() {
        let Ok(dir) = std::env::var("MM_TEST_PAK01") else { return };
        let pak = Index::open(std::path::Path::new(&dir)).expect("pak01");
        for p in ["particles/rain_fx/autumn_terrain.vpcf_c", "particles/base_attacks/ranged_tower_bad.vpcf_c"] {
            let file = pak.read(p).unwrap().unwrap();
            let out = silent_particle(&file).expect(p);
            let kv = kv3::read(resource::data(&out, "DATA", 0).unwrap()).unwrap();
            for key in ["m_Renderers", "m_Emitters", "m_Children"] {
                assert!(kv.root.get(key).is_none_or(|n| n.items().is_empty()), "{p} {key}");
            }
        }
    }

    /// Every group of the real map built into one pak, when the game is on this computer.
    #[test]
    fn the_real_map_plans_every_group_and_builds() {
        let Ok(dir) = std::env::var("MM_TEST_PAK01") else { return };
        let pak = Index::open(std::path::Path::new(&dir)).expect("pak01");
        let map = std::path::Path::new(&dir).parent().unwrap().join("maps").join("dota.vpk");
        let plan = plan(&Index::open(&map).expect("map"), &pak).expect("plan");
        for (g, l) in &plan {
            eprintln!("{g}: {} {:?}", l.len(), l.iter().take(3).map(|x| &x.0).collect::<Vec<_>>());
        }
        assert!(GROUPS.iter().all(|g| plan.contains_key(g)));
        assert!(!plan["grass"].is_empty() && !plan["towerFx"].is_empty() && !plan["trees"].is_empty());
        assert!(!plan["treesSimple"].is_empty() && plan["treesSimple"].len() < plan["trees"].len() + 1);
        let groups: Vec<&str> = GROUPS.to_vec();
        let vpk = crate::map_decor::decor_pak(&pak, &plan, &groups, &[], &Default::default()).expect("pak");
        let map = Index::open(&map).expect("map");
        for (g, s) in samples(&map, &pak, &plan).expect("samples") {
            eprintln!("sample {g}: {:?}", s);
        }
        eprintln!("pak: {} bytes", vpk.len());
    }
}

#[cfg(test)]
mod dark_tests {
    /// The game's own terrain blend made darker reads back with its tints times the factor.
    #[test]
    fn a_ground_material_comes_out_darker() {
        let Ok(dir) = std::env::var("MM_TEST_PAK01") else { return };
        let pak = crate::vpk::Index::open(std::path::Path::new(&dir)).unwrap();
        let file = pak.read("materials/blends/mod_radiant_000.vmat_c").unwrap().unwrap();
        let tints = |f: &[u8]| -> Vec<f64> {
            let kv = crate::kv3::read(crate::resource::data(f, "DATA", 0).unwrap()).unwrap();
            let mut out = vec![];
            for p in kv.root.get("m_vectorParams").unwrap().items() {
                if p.get("m_name").and_then(crate::kv3::Node::as_str).is_some_and(|n| n.starts_with("g_vColorTint")) {
                    for x in p.get("m_value").unwrap().items().iter().take(3) {
                        out.push(kv.number_of(x).unwrap());
                    }
                }
            }
            out
        };
        let before = tints(&file);
        let after = tints(&super::darken_material(&file, 0.5).unwrap());
        assert!(!before.is_empty());
        for (a, b) in before.iter().zip(&after) {
            assert!((a * 0.5 - b).abs() < 1e-6, "{a} -> {b}");
        }
    }
}
