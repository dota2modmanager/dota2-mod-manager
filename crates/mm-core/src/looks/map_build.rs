//! The map file the Optimization window builds, as Dota Effect Studio builds it: the terrain
//! picked is the base, its map archive copied as maps/dota.vpk into the language folder, and the
//! weather and the dark look are written into that map. The game then loads the default map's
//! name with the terrain in it, with no item in a slot.
//!
//! A terrain's archive (maps/dota_winter.vpk) names its own files maps/dota_winter.vmap,
//! maps/dota_winter/world.vwrld and so on, and the files name one another by those paths: each
//! file moves to the default map's name, and each path it names inside it moves with it, in its
//! list of the files it needs (RERL, whose ids are hashes of the paths) and in its KV3 blocks.
//!
//! The weather is how the game draws its own weather items: every lighting zone of the map
//! (`ent_dota_lightinfo`) that is the map's everyday light (weather_type 0, or -1 for always)
//! gets the weather's particle as its `weather_effect`, and the light, fog and colours of the
//! default map's zone made for that weather (the default map carries a zone per weather and side:
//! RF, RB, DF, DT at the end of its name). The dark look lowers every zone's light (map_light.rs).

use indexmap::IndexMap;

use crate::kv3;
use crate::vpk::{Entry, Index};

/// The terrain's name inside the default map's: "maps/dota_winter/x" as "maps/dota/x".
pub fn moved(path: &str, word: &str) -> String {
    let from = format!("maps/dota_{word}");
    let low = path.to_lowercase();
    if let Some(rest) = low.strip_prefix(&from) {
        if rest.is_empty() || rest.starts_with('/') || rest.starts_with('.') {
            return format!("maps/dota{}", &path[from.len()..]);
        }
    }
    path.to_string()
}

/// Every string of a KV3 tree that names a terrain file, moved; whether any did.
fn move_strings(node: &mut kv3::Node, word: &str) -> bool {
    match &mut node.value {
        kv3::Value::Str(s) => {
            let m = moved(s, word);
            if m != *s {
                *s = m;
                true
            } else {
                false
            }
        }
        kv3::Value::Object(map) => map.values_mut().fold(false, |any, n| move_strings(n, word) | any),
        kv3::Value::Array { items, .. } => items.iter_mut().fold(false, |any, n| move_strings(n, word) | any),
        _ => false,
    }
}

/// A compiled file of the terrain with every path it names moved to the default map's; the file
/// as it was when it names none.
pub fn relocate(file: &[u8], word: &str) -> Vec<u8> {
    let Ok(blocks) = crate::resource::blocks(file) else { return file.to_vec() };
    let mut out = file.to_vec();
    // the files it needs: the paths, and their ids with them
    if let Ok(names) = crate::resource::references(&out) {
        let next: Vec<String> = names.iter().map(|n| moved(n, word)).collect();
        if next != names {
            if let Ok(b) = crate::resource::set_references(&out, &next) {
                out = b;
            }
        }
    }
    // every KV3 block, by its name and place: a block that is not KV3 does not read as one
    let mut seen: IndexMap<String, usize> = IndexMap::new();
    for b in blocks {
        let nth = *seen.entry(b.name.clone()).and_modify(|n| *n += 1).or_insert(0);
        if b.name == "RERL" {
            continue;
        }
        let Ok(data) = crate::resource::data(&out, &b.name, nth) else { continue };
        let Ok(mut kv) = kv3::read(data) else { continue };
        if !move_strings(&mut kv.root, word) {
            continue;
        }
        if let Ok(written) = kv3::write(&kv) {
            if let Ok(next) = crate::resource::replace(&out, &b.name, nth, &written) {
                out = next;
            }
        }
    }
    out
}

/// A lighting zone's side and lane by its name: "..._RF" is RF.
fn zone(values: &kv3::Node) -> String {
    let name = values.get("targetname").and_then(kv3::Node::as_str).unwrap_or("");
    name.rsplit_once('_').map(|(_, z)| z.to_uppercase()).unwrap_or_default()
}

fn weather_type(kv: &kv3::Block, values: &kv3::Node) -> i64 {
    values
        .get("weather_type")
        .and_then(|n| match &n.value {
            kv3::Value::Str(s) => s.trim().parse().ok(),
            _ => kv.number_of(n).map(|f| f as i64),
        })
        .unwrap_or(0)
}

/// The fields of a zone that are the zone itself, not its look: kept when a look is copied in.
const OWN: [&str; 15] = [
    "classname",
    "targetname",
    "weather_type",
    "weather_effect",
    "origin",
    "angles",
    "scales",
    "inner_radius",
    "outer_radius",
    "compile_source_id",
    "hammerUniqueId",
    "preview_day_or_night",
    "height_fog_textureOpacity",
    "fog_flow_map_texture",
    "water_flow_map_texture",
];

/// The game's weathers, in the order the default map numbers its zones (weather_type 1..9).
pub const WEATHERS: [&str; 9] = [
    "particles/rain_fx/econ_snow.vpcf",
    "particles/rain_fx/econ_rain.vpcf",
    "particles/rain_fx/econ_moonlight.vpcf",
    "particles/rain_fx/econ_weather_pestilence.vpcf",
    "particles/rain_fx/econ_weather_harvest.vpcf",
    "particles/rain_fx/econ_weather_sirocco.vpcf",
    "particles/rain_fx/econ_weather_spring.vpcf",
    "particles/rain_fx/econ_weather_ash.vpcf",
    "particles/rain_fx/econ_weather_aurora.vpcf",
];

fn lightinfos(kv: &mut kv3::Block) -> Vec<&mut kv3::Node> {
    let mut out = Vec::new();
    if let Some(kv3::Value::Array { items, .. }) = kv.root.get_mut("m_entityKeyValues").map(|n| &mut n.value) {
        for e in items.iter_mut() {
            let Some(values) = e.get_mut("keyValues3Data").and_then(|d| d.get_mut("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) == Some("ent_dota_lightinfo") {
                out.push(values);
            }
        }
    }
    out
}

/// The default map's zone for this weather, by zone: the look the weather has there.
pub fn weather_looks(default_entities: &[Vec<u8>], particle: &str) -> IndexMap<String, (kv3::Block, kv3::Node)> {
    let want = WEATHERS.iter().position(|w| *w == particle).map(|i| i as i64 + 1);
    let mut out = IndexMap::new();
    let Some(want) = want else { return out };
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(mut kv) = kv3::read(data) else { continue };
        let found: Vec<(String, kv3::Node)> = {
            let kv_ref = kv.clone();
            lightinfos(&mut kv)
                .into_iter()
                .filter(|v| weather_type(&kv_ref, v) == want)
                .map(|v| (zone(v), v.clone()))
                .collect()
        };
        for (z, v) in found {
            if ["RF", "RB", "DF", "DT"].contains(&z.as_str()) && !out.contains_key(&z) {
                out.insert(z, (kv.clone(), v));
            }
        }
    }
    out
}

/// The weather types of an entity lump's zones.
pub fn zone_types(file: &[u8]) -> Vec<i64> {
    let Ok(data) = crate::resource::data(file, "DATA", 0) else { return vec![] };
    let Ok(mut kv) = kv3::read(data) else { return vec![] };
    let kv_ref = kv.clone();
    lightinfos(&mut kv).into_iter().map(|v| weather_type(&kv_ref, v)).collect()
}

/// A number node of the same kind with the value 0: its bytes zeroed, or, for a 1 stored as its
/// type alone, the type that is 0 (kv3.rs set_number pairs them: 16 and 15, 18 and 17, 27 and 26).
fn zero_like(kv: &kv3::Block, node: &kv3::Node) -> kv3::Node {
    let mut d = kv.detached(node);
    match &mut d.value {
        kv3::Value::Number { raw: Some(r), .. } => r.iter_mut().for_each(|b| *b = 0),
        kv3::Value::Number { ty, raw: None, .. } => {
            *ty = match *ty {
                16 => 15,
                18 => 17,
                27 => 26,
                t => t,
            }
        }
        // the map's own keys are written as text ("weather_type" "1")
        kv3::Value::Str(t) => *t = "0".into(),
        _ => {}
    }
    d
}

/// An entity lump with the weather in every everyday zone; how many zones took it. A map with no
/// everyday zone at all (the winter one: its zones are its snow's) gets a copy of each zone of
/// `fallback`'s weather made everyday, as Dota Effect Studio does, the zones themselves kept.
pub fn put_weather(
    file: &[u8],
    particle: &str,
    looks: &IndexMap<String, (kv3::Block, kv3::Node)>,
    fallback: Option<i64>,
) -> Result<(Vec<u8>, usize), String> {
    let mut kv =
        kv3::read(crate::resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if let Some(fb) = fallback {
        let kv_ref = kv.clone();
        if let Some(kv3::Value::Array { items, .. }) = kv.root.get_mut("m_entityKeyValues").map(|n| &mut n.value) {
            let mut copies = Vec::new();
            for (k, e) in items.iter().enumerate() {
                let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
                if values.get("classname").and_then(kv3::Node::as_str) != Some("ent_dota_lightinfo")
                    || weather_type(&kv_ref, values) != fb
                {
                    continue;
                }
                let mut copy = e.clone();
                let z = zone(values);
                let wt = values.get("weather_type").map(|n| zero_like(&kv_ref, n));
                if let Some(kv3::Value::Object(map)) =
                    copy.get_mut("keyValues3Data").and_then(|d| d.get_mut("values")).map(|n| &mut n.value)
                {
                    if let Some(w) = wt {
                        map.insert("weather_type".into(), w);
                    }
                    map.insert("targetname".into(), kv3::Node::new(kv3::Value::Str(format!("mm_weather_{k}_{z}"))));
                    map.shift_remove("compile_source_id");
                }
                copies.push(copy);
            }
            items.extend(copies);
        }
    }
    let types: Vec<i64> = {
        let kv_ref = kv.clone();
        lightinfos(&mut kv).into_iter().map(|v| weather_type(&kv_ref, v)).collect()
    };
    let mut n = 0;
    for (v, t) in lightinfos(&mut kv).into_iter().zip(types) {
        if !(t == 0 || t == -1) {
            continue;
        }
        let z = zone(v);
        if let (kv3::Value::Object(map), Some((from, look))) = (&mut v.value, looks.get(&z)) {
            if let kv3::Value::Object(src) = &look.value {
                for (k, node) in src {
                    if !OWN.contains(&k.as_str()) {
                        map.insert(k.clone(), from.detached(node));
                    }
                }
            }
        }
        if let kv3::Value::Object(map) = &mut v.value {
            map.insert("weather_effect".into(), kv3::Node { value: kv3::Value::Str(particle.to_string()), flag: 0 });
        }
        n += 1;
    }
    if n == 0 {
        return Ok((file.to_vec(), 0));
    }
    let data = kv3::write(&kv).map_err(|e| e.to_string())?;
    Ok((crate::resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())?, n))
}

/// A zone's look as JSON: numbers, strings and lists of numbers, its own fields (OWN) left out.
fn look_json(kv: &kv3::Block, node: &kv3::Node) -> serde_json::Value {
    let one = |n: &kv3::Node| -> Option<serde_json::Value> {
        match &n.value {
            kv3::Value::Str(t) => Some(serde_json::json!(t)),
            kv3::Value::Number { .. } => kv.number_of(n).map(|f| serde_json::json!(f)),
            kv3::Value::Array { items, .. } => {
                let v: Option<Vec<f64>> = items.iter().map(|i| kv.number_of(i)).collect();
                v.map(|v| serde_json::json!(v))
            }
            _ => None,
        }
    };
    let mut out = serde_json::Map::new();
    if let kv3::Value::Object(map) = &node.value {
        for (k, n) in map {
            if OWN.contains(&k.as_str()) {
                continue;
            }
            if let Some(v) = one(n) {
                out.insert(k.clone(), v);
            }
        }
    }
    serde_json::Value::Object(out)
}

/// The light and fog of one zone of the default map for the 3D preview: the everyday zone, and
/// the same zone with `particle`'s weather, as the build copies it in (put_weather). The window
/// lights its map from these: a weather's own darkness, fog and colour of the fog of war, as the
/// game's own zone has them, not a look made up for the window. `zone` is RF, RB, DF or DT.
pub fn weather_light(default_entities: &[Vec<u8>], particle: Option<&str>, zone_name: &str) -> serde_json::Value {
    let want = particle.and_then(|p| WEATHERS.iter().position(|w| *w == p)).map(|i| i as i64 + 1);
    let (mut plain, mut weather) = (serde_json::Value::Null, serde_json::Value::Null);
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(mut kv) = kv3::read(data) else { continue };
        let kv_ref = kv.clone();
        for v in lightinfos(&mut kv) {
            if zone(v) != zone_name {
                continue;
            }
            let t = weather_type(&kv_ref, v);
            if (t == 0 || t == -1) && plain.is_null() {
                plain = look_json(&kv_ref, v);
            } else if Some(t) == want && weather.is_null() {
                weather = look_json(&kv_ref, v);
            }
        }
    }
    serde_json::json!({ "plain": plain, "weather": weather })
}

/// What the window's light reads of a zone (map-light.ts): the sun, the light around, the fog and the lightning.
const LIGHT_KEYS: [&str; 12] = [
    "color_day",
    "light_scale_day",
    "ambient_color_day",
    "ambient_scale_day",
    "fog_color_day",
    "fog_start_day",
    "fog_end_day",
    "fog_height_day",
    "fog_hight_color_day",
    "lightning_intensity_max",
    "lightning_period_min",
    "lightning_period_max",
];

/// For the window: the everyday look of the Radiant's forest zone and each weather's look there,
/// by the weather's key (map_decor.rs WEATHER_KEYS), each cut to what the window's light reads.
pub fn weather_lights(default_entities: &[Vec<u8>], keys: &[&str]) -> serde_json::Value {
    let cut = |v: &serde_json::Value| -> serde_json::Value {
        serde_json::Value::Object(
            LIGHT_KEYS.iter().filter_map(|k| v.get(*k).map(|x| ((*k).to_string(), x.clone()))).collect(),
        )
    };
    let mut out = serde_json::Map::new();
    for (i, key) in keys.iter().enumerate() {
        let v = weather_light(default_entities, WEATHERS.get(i).copied(), "RF");
        if i == 0 {
            out.insert("plain".into(), cut(&v["plain"]));
        }
        if v["weather"].is_object() {
            out.insert((*key).to_string(), cut(&v["weather"]));
        }
    }
    serde_json::Value::Object(out)
}

/// What a map is built with.
#[derive(Debug, Clone, Default)]
pub struct MapLook {
    /// the terrain's word ("winter"), or None for the default map
    pub terrain: Option<String>,
    /// a weather's particle (WEATHERS)
    pub weather: Option<String>,
    /// how much of its light the map keeps (1: all of it)
    pub light: Option<f64>,
}

impl MapLook {
    pub fn is_plain(&self) -> bool {
        self.terrain.is_none() && self.weather.is_none() && self.light.is_none_or(|k| (k - 1.0).abs() < 1e-9)
    }
}

/// The map built: the terrain's archive (or the default map's) with its files at the default map's
/// names, the weather and the light written in; the archive's bytes, and what was done, for the log.
pub fn build_map(base: &Index, default_map: &Index, look: &MapLook) -> Result<(Vec<u8>, String), String> {
    let word = look.terrain.as_deref();
    let looks = match &look.weather {
        Some(p) => {
            let lumps: Vec<Vec<u8>> = default_map
                .paths()
                .filter(|p| p.ends_with(".vents_c"))
                .filter_map(|p| default_map.read(p).ok().flatten())
                .collect();
            weather_looks(&lumps, p)
        }
        None => IndexMap::new(),
    };
    let mut entries: Vec<Entry> = Vec::new();
    let (mut zones, mut lit) = (0, 0);
    let paths: Vec<String> = base.paths().map(str::to_string).collect();
    // a map with no everyday zone anywhere takes the weather in copies of its own first weather's
    let fallback = if look.weather.is_some() {
        let types: Vec<i64> = paths
            .iter()
            .filter(|p| p.ends_with(".vents_c"))
            .filter_map(|p| base.read(p).ok().flatten())
            .flat_map(|f| zone_types(&f))
            .collect();
        if types.iter().any(|t| *t == 0 || *t == -1) {
            None
        } else {
            types.iter().copied().filter(|t| *t > 0).min()
        }
    } else {
        None
    };
    for p in paths {
        let Some(mut data) = base.read(&p).map_err(|e| e.to_string())? else { continue };
        let name = match word {
            Some(w) => {
                let name = moved(&p, w);
                if p.ends_with("_c") {
                    data = relocate(&data, w);
                }
                name
            }
            None => p.clone(),
        };
        if name.ends_with(".vents_c") {
            if let Some(particle) = &look.weather {
                let (d, n) = put_weather(&data, particle, &looks, fallback)?;
                data = d;
                zones += n;
            }
            if let Some(k) = look.light.filter(|k| (k - 1.0).abs() > 1e-9) {
                if let Ok((d, n)) = crate::map_light::dim_lights(&data, k) {
                    data = d;
                    lit += n;
                }
            }
        }
        entries.push(crate::vpk::entry_at(&name, data.into()));
    }
    if look.weather.is_some() && zones == 0 {
        return Err("no lighting zone of this map takes a weather".into());
    }
    let said = format!("map: terrain {}, weather in {zones} zones, light in {lit} zones", word.unwrap_or("default"));
    Ok((crate::vpk::build(&entries), said))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_terrain_path_moves_to_the_default_map() {
        assert_eq!(moved("maps/dota_winter/world.vwrld_c", "winter"), "maps/dota/world.vwrld_c");
        assert_eq!(moved("maps/dota_winter.vmap_c", "winter"), "maps/dota.vmap_c");
        assert_eq!(moved("maps/dota_winter", "winter"), "maps/dota");
        assert_eq!(moved("maps/dota_wintery/x", "winter"), "maps/dota_wintery/x");
        assert_eq!(moved("materials/maps/dota_winter/x.vmat", "winter"), "materials/maps/dota_winter/x.vmat");
    }

    /// The look of the rain's zone beside the everyday one, printed (MM_TEST_MAP is maps/dota.vpk).
    #[test]
    fn the_rain_zone_look() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let default_map = Index::open(std::path::Path::new(&map)).unwrap();
        let lumps: Vec<Vec<u8>> = default_map
            .paths()
            .filter(|p| p.ends_with(".vents_c"))
            .filter_map(|p| default_map.read(p).ok().flatten())
            .collect();
        let v = weather_light(&lumps, Some(WEATHERS[1]), "RF");
        eprintln!("{}", serde_json::to_string_pretty(&v).unwrap());
        assert!(v["plain"].is_object() && v["weather"].is_object());
    }

    /// The winter map built on the real game (MM_TEST_MAP is maps/dota.vpk): every file at the
    /// default map's name, no path of the winter map left in the world, snow in its zones.
    #[test]
    fn the_winter_map_with_snow() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let maps = std::path::Path::new(&map).parent().unwrap();
        let default_map = Index::open(std::path::Path::new(&map)).unwrap();
        let winter = Index::open(&maps.join("dota_winter.vpk")).unwrap();
        let look = MapLook { terrain: Some("winter".into()), weather: Some(WEATHERS[0].into()), light: Some(0.5) };
        let (bytes, said) = build_map(&winter, &default_map, &look).unwrap();
        eprintln!("{said}");
        let tmp = std::env::temp_dir().join("mm-map-build-test.vpk");
        std::fs::write(&tmp, &bytes).unwrap();
        let built = Index::open(&tmp).unwrap();
        assert!(built.has("maps/dota.vmap_c"));
        assert!(built.paths().all(|p| !p.starts_with("maps/dota_winter")));
        let world = built.read("maps/dota/world.vwrld_c").unwrap().unwrap();
        assert!(crate::resource::references(&world).unwrap().iter().all(|r| !r.contains("dota_winter")));
        assert!(!String::from_utf8_lossy(&world).contains("maps/dota_winter/"));
        assert!(said.contains("weather in 4 zones"), "{said}");
        let _ = std::fs::remove_file(&tmp);
    }
}
