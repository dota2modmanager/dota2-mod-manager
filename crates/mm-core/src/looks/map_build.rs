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

use std::collections::BTreeSet;

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

/// What the window's light reads of a zone (map-light.ts): the sun and where it stands, the light
/// around and in the shadows, how much of the light around the shadows take, the fog, the lightning and the shine (its colour, where it comes from, how tight),
/// each by day and by night (the game blends the two as its clock turns: map-light.ts).
const LIGHT_KEYS: [&str; 42] = [
    "ambient_shadow_amount",
    "color_day",
    "color_night",
    "light_scale_day",
    "light_scale_night",
    "light_direction_day",
    "light_direction_night",
    "ambient_color_day",
    "ambient_color_night",
    "ambient_scale_day",
    "ambient_scale_night",
    "ambient_direction_day",
    "ambient_direction_night",
    "shadow_color_day",
    "shadow_color_night",
    "shadow_secondary_color_day",
    "shadow_secondary_color_night",
    "shadow_scale_day",
    "shadow_scale_night",
    "shadow_ground_scale_day",
    "shadow_ground_scale_night",
    "fog_color_day",
    "fog_color_night",
    "fog_start_day",
    "fog_start_night",
    "fog_end_day",
    "fog_end_night",
    "fog_height_day",
    "fog_height_night",
    "fog_hight_color_day",
    "fog_hight_color_night",
    "lightning_intensity_max",
    "lightning_period_min",
    "lightning_period_max",
    "specular_color_day",
    "specular_color_night",
    "specular_independence_day",
    "specular_independence_night",
    "specular_direction_day",
    "specular_direction_night",
    "specular_power_day",
    "specular_power_night",
];

/// The first entity of a class in the map's entity lumps, its values as JSON (look_json), or null.
fn entity_of(default_entities: &[Vec<u8>], class: &str) -> serde_json::Value {
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(kv) = kv3::read(data) else { continue };
        for e in kv.root.get("m_entityKeyValues").map(|n| n.items()).unwrap_or(&[]) {
            let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) == Some(class) {
                return look_json(&kv, values);
            }
        }
    }
    serde_json::Value::Null
}

/// A number the entity may keep as text ("120", "0 165 0"), as one number or a list of them.
fn numbers(v: &serde_json::Value) -> Option<serde_json::Value> {
    match v {
        serde_json::Value::String(t) => {
            let n: Vec<f64> = t.split_whitespace().filter_map(|x| x.parse().ok()).collect();
            match n.len() {
                0 => None,
                1 => Some(serde_json::json!(n[0])),
                _ => Some(serde_json::json!(n)),
            }
        }
        serde_json::Value::Number(_) | serde_json::Value::Array(_) => Some(v.clone()),
        _ => None,
    }
}

/// What the whole map shares, from its global light (env_global_light) and fog (env_fog_controller):
/// the clouds whose shadows drift over the ground (their picture's path, how large, which way and
/// how fast each of the two layers goes), the specular power a zone of -1 takes, and the shape of
/// the fog. Keys as the window reads them; what the map does not say is left out.
pub fn global_light(default_entities: &[Vec<u8>]) -> serde_json::Map<String, serde_json::Value> {
    let light = entity_of(default_entities, "env_global_light");
    let fog = entity_of(default_entities, "env_fog_controller");
    let mut out = serde_json::Map::new();
    let pairs = [
        (&light, "texturename", "cloud_texture"),
        (&light, "cloudscale", "cloud_scale"),
        (&light, "cloud1direction", "cloud1_direction"),
        (&light, "cloud1speed", "cloud1_speed"),
        (&light, "cloud2direction", "cloud2_direction"),
        (&light, "cloud2speed", "cloud2_speed"),
        (&light, "specularpower", "global_specular_power"),
        (&fog, "fogexponent", "fog_exponent"),
        (&fog, "fogmaxdensity", "fog_max_density"),
    ];
    for (from, key, name) in pairs {
        let Some(v) = from.get(key) else { continue };
        let v = if key == "texturename" { v.as_str().map(|t| serde_json::json!(t)) } else { numbers(v) };
        if let Some(v) = v {
            out.insert(name.into(), v);
        }
    }
    if light.get("dota_no_clouds").and_then(serde_json::Value::as_bool) == Some(true) {
        out.remove("cloud_texture");
    }
    out
}

/// The picture of the way the map's water runs: the first light zone's `water_flow_map_texture`
/// (every zone of the default map names the same one), a field of the zone itself that a look
/// leaves alone (OWN).
pub fn water_flow_map(default_entities: &[Vec<u8>]) -> Option<String> {
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(kv) = kv3::read(data) else { continue };
        for e in kv.root.get("m_entityKeyValues").map(|n| n.items()).unwrap_or(&[]) {
            let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) != Some("ent_dota_lightinfo") {
                continue;
            }
            if let Some(t) = values.get("water_flow_map_texture").and_then(kv3::Node::as_str).filter(|t| !t.is_empty())
            {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// The world layers the map starts with switched off: each `info_world_layer` without the
/// "visible at spawn" flag (spawnflags 1). On the default map these are the two bases' destruction
/// layers (`world_layer_dire_destruction`, `world_layer_radiant_destruction`): cracked paths and the
/// Dire's lava, which the game shows only once a base falls.
pub fn hidden_layers(default_entities: &[Vec<u8>]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(kv) = kv3::read(data) else { continue };
        for e in kv.root.get("m_entityKeyValues").map(|n| n.items()).unwrap_or(&[]) {
            let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) != Some("info_world_layer") {
                continue;
            }
            let Some(name) = values.get("layerName").and_then(kv3::Node::as_str) else { continue };
            let flags = values.get("spawnflags").and_then(|n| match &n.value {
                kv3::Value::Str(s) => s.trim().parse::<f64>().ok(),
                _ => kv.number_of(n),
            });
            if (flags.unwrap_or(0.0) as i64) & 1 == 0 {
                out.insert(name.to_string());
            }
        }
    }
    out
}

/// The map's small lights (env_deferred_light_client_only: lamps, braziers, the shrines' glow), each
/// as [x, y, z, r, g, b, intensity, radius]: where it stands in inches, its colour 0-255 sRGB, how
/// strong, how far it reaches in inches. The game adds each over what it reaches, after the sun
/// (deferred_local_light.vfx); the window draws the ones near the camera.
pub fn local_lights(default_entities: &[Vec<u8>]) -> Vec<[f64; 8]> {
    let mut out = Vec::new();
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(kv) = kv3::read(data) else { continue };
        for e in kv.root.get("m_entityKeyValues").map(|n| n.items()).unwrap_or(&[]) {
            let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) != Some("env_deferred_light_client_only") {
                continue;
            }
            let v = look_json(&kv, values);
            let list = |k: &str| -> Vec<f64> {
                match v.get(k).and_then(numbers) {
                    Some(serde_json::Value::Array(a)) => a.iter().filter_map(serde_json::Value::as_f64).collect(),
                    Some(n) => n.as_f64().into_iter().collect(),
                    None => Vec::new(),
                }
            };
            // look_json leaves the place out (OWN): read off the node
            let at: Vec<f64> = match values.get("origin").map(|n| &n.value) {
                Some(kv3::Value::Array { items, .. }) => items.iter().filter_map(|i| kv.number_of(i)).collect(),
                Some(kv3::Value::Str(t)) => t.split_whitespace().filter_map(|x| x.parse().ok()).collect(),
                _ => Vec::new(),
            };
            let (colour, strength, reach) = (list("lightcolor"), list("intensity"), list("radius"));
            if at.len() < 3 || colour.len() < 3 || reach.first().is_none_or(|r| *r <= 0.0) {
                continue;
            }
            out.push([
                at[0],
                at[1],
                at[2],
                colour[0],
                colour[1],
                colour[2],
                strength.first().copied().unwrap_or(1.0),
                reach[0],
            ]);
        }
    }
    out
}

/// The map's standing effects (dota_world_particle_system, info_particle_system: the river's flow
/// and foam, fireflies, lamp flames, the lava), those that start on: each its system's path, where it
/// stands in inches, how it is turned (pitch, yaw, roll in degrees) and the Optimization group that
/// takes it away (map_optimize.rs map_particle_group).
pub fn world_effects(default_entities: &[Vec<u8>]) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(kv) = kv3::read(data) else { continue };
        for e in kv.root.get("m_entityKeyValues").map(|n| n.items()).unwrap_or(&[]) {
            let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
            let class = values.get("classname").and_then(kv3::Node::as_str);
            if !matches!(class, Some("dota_world_particle_system" | "info_particle_system")) {
                continue;
            }
            let on = values.get("start_active").and_then(|n| match &n.value {
                kv3::Value::Other { value: Some(v), .. } => Some(*v != 0),
                kv3::Value::Number { .. } => kv.number_of(n).map(|f| f != 0.0),
                kv3::Value::Str(t) => Some(!matches!(t.as_str(), "0" | "false")),
                _ => None,
            });
            if on == Some(false) {
                continue;
            }
            let Some(fx) = values.get("effect_name").and_then(kv3::Node::as_str) else { continue };
            let fx = fx.trim_start_matches("resource_name:").trim();
            if fx.is_empty() {
                continue;
            }
            let three = |k: &str| -> Vec<f64> {
                match values.get(k).map(|n| &n.value) {
                    Some(kv3::Value::Array { items, .. }) => items.iter().filter_map(|i| kv.number_of(i)).collect(),
                    Some(kv3::Value::Str(t)) => t.split_whitespace().filter_map(|x| x.parse().ok()).collect(),
                    _ => Vec::new(),
                }
            };
            let (at, turn) = (three("origin"), three("angles"));
            if at.len() < 3 {
                continue;
            }
            let turn = if turn.len() >= 3 { turn } else { vec![0.0; 3] };
            let group = crate::map_optimize::map_particle_group(fx);
            out.push(serde_json::json!({ "fx": fx, "at": &at[..3], "turn": &turn[..3], "group": group }));
        }
    }
    out
}

/// For the window: the everyday look of the Radiant's forest zone and each weather's look there,
/// by the weather's key (map_decor.rs WEATHER_KEYS), each cut to what the window's light reads,
/// with what the whole map shares (global_light) in each; the everyday one also carries the map's
/// small lights (local_lights), which no weather changes.
pub fn weather_lights(default_entities: &[Vec<u8>], keys: &[&str]) -> serde_json::Value {
    let global = global_light(default_entities);
    let cut = |v: &serde_json::Value| -> serde_json::Value {
        let mut m: serde_json::Map<String, serde_json::Value> =
            LIGHT_KEYS.iter().filter_map(|k| v.get(*k).map(|x| ((*k).to_string(), x.clone()))).collect();
        for (k, x) in &global {
            m.entry(k.clone()).or_insert_with(|| x.clone());
        }
        serde_json::Value::Object(m)
    };
    let mut out = serde_json::Map::new();
    for (i, key) in keys.iter().enumerate() {
        let v = weather_light(default_entities, WEATHERS.get(i).copied(), "RF");
        if i == 0 {
            let mut plain = cut(&v["plain"]);
            plain["local_lights"] = serde_json::json!(local_lights(default_entities));
            plain["world_effects"] = serde_json::json!(world_effects(default_entities));
            plain["zones"] = serde_json::json!(zone_places(default_entities, None));
            out.insert("plain".into(), plain);
        }
        if v["weather"].is_object() {
            let mut weather = cut(&v["weather"]);
            weather["zones"] = serde_json::json!(zone_places(default_entities, Some(i as i64 + 1)));
            out.insert((*key).to_string(), weather);
        }
    }
    serde_json::Value::Object(out)
}

/// Every zone of one weather (None: the everyday ones, weather_type 0 or -1) with where it stands
/// and how far it reaches, its light cut to what the window reads: the game lights the view by the
/// zones around the camera's point, each in full within its inner radius and gone past its outer
/// one, so the Dire's woods take their bluer sun and purple shadows (map-light.ts blends them).
pub fn zone_places(default_entities: &[Vec<u8>], want: Option<i64>) -> Vec<serde_json::Value> {
    let mut out: Vec<serde_json::Value> = Vec::new();
    for file in default_entities {
        let Ok(data) = crate::resource::data(file, "DATA", 0) else { continue };
        let Ok(mut kv) = kv3::read(data) else { continue };
        let kv_ref = kv.clone();
        for v in lightinfos(&mut kv) {
            let t = weather_type(&kv_ref, v);
            let fits = match want {
                None => t == 0 || t == -1,
                Some(w) => t == w,
            };
            let name = zone(v);
            if !fits || out.iter().any(|z| z["zone"] == name.as_str()) {
                continue;
            }
            let num = |k: &str| v.get(k).and_then(|n| kv_ref.number_of(n));
            let at: Vec<f64> = v
                .get("origin")
                .map(|n| n.items().iter().filter_map(|i| kv_ref.number_of(i)).collect())
                .unwrap_or_default();
            let (Some(inner), Some(outer)) = (num("inner_radius"), num("outer_radius")) else { continue };
            if at.len() < 2 {
                continue;
            }
            let look = look_json(&kv_ref, v);
            let light: serde_json::Map<String, serde_json::Value> =
                LIGHT_KEYS.iter().filter_map(|k| look.get(*k).map(|x| ((*k).to_string(), x.clone()))).collect();
            out.push(serde_json::json!({ "zone": name, "at": [at[0], at[1]], "inner": inner, "outer": outer, "light": light }));
        }
    }
    out
}

/// An entity lump with every tree at its model's own size (scales 1) and straight (angles 0): the
/// map draws some of its trees smaller (one in five, down to 0.57) and turns each its own way, so
/// a tree mod of one model, the catalog's Logs Trees or blocks say, comes out of
/// one size, square on the grid, and the forest reads as the cells the trees block. Only how
/// the trees look here: where they stand and what they block is the server's. The lump, and how
/// many trees it changed.
pub fn one_size_trees(file: &[u8]) -> Result<(Vec<u8>, usize), String> {
    let mut kv =
        kv3::read(crate::resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut root = std::mem::replace(&mut kv.root, kv3::Node::new(kv3::Value::Other { ty: 1, value: None }));
    let mut n = 0;
    if let Some(kv3::Value::Array { items, .. }) = root.get_mut("m_entityKeyValues").map(|n| &mut n.value) {
        for e in items.iter_mut() {
            let Some(values) = e.get_mut("keyValues3Data").and_then(|d| d.get_mut("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) != Some("ent_dota_tree") {
                continue;
            }
            let mut any = false;
            // at its own size, and straight: no turn, no lean, so it sits square on the grid
            for (key, to) in [("scales", 1.0), ("angles", 0.0)] {
                if let Some(kv3::Value::Array { items, .. }) = values.get_mut(key).map(|n| &mut n.value) {
                    for x in items.iter_mut() {
                        if kv.number_of(x).is_some_and(|v| (v - to).abs() > 1e-6) {
                            any |= kv.set_number(x, to).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            n += usize::from(any);
        }
    }
    kv.root = root;
    if n == 0 {
        return Ok((file.to_vec(), 0));
    }
    let data = kv3::write(&kv).map_err(|e| e.to_string())?;
    Ok((crate::resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())?, n))
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
    /// every tree at its model's own size: the map scales some of them down (one_size_trees)
    pub one_size: bool,
}

impl MapLook {
    pub fn is_plain(&self) -> bool {
        self.terrain.is_none()
            && self.weather.is_none()
            && self.light.is_none_or(|k| (k - 1.0).abs() < 1e-9)
            && !self.one_size
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
    let (mut zones, mut lit, mut sized) = (0, 0, 0);
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
            if look.one_size {
                let (d, n) = one_size_trees(&data)?;
                data = d;
                sized += n;
            }
        }
        entries.push(crate::vpk::entry_at(&name, data.into()));
    }
    if look.weather.is_some() && zones == 0 {
        return Err("no lighting zone of this map takes a weather".into());
    }
    let said = format!(
        "map: terrain {}, weather in {zones} zones, light in {lit} zones, {sized} trees to their own size",
        word.unwrap_or("default")
    );
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

    /// The real map's small lights and standing effects (MM_TEST_MAP is maps/dota.vpk): the 327 lamps and braziers, each
    /// somewhere on the map with a colour and a reach.
    #[test]
    fn the_map_has_its_small_lights_and_effects() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let default_map = Index::open(std::path::Path::new(&map)).unwrap();
        let lumps: Vec<Vec<u8>> = default_map
            .paths()
            .filter(|p| p.ends_with(".vents_c"))
            .filter_map(|p| default_map.read(p).ok().flatten())
            .collect();
        let lights = local_lights(&lumps);
        assert!(lights.len() > 300, "{}", lights.len());
        assert!(lights.iter().all(|l| l[7] > 0.0 && l[0].abs() < 10000.0 && l[3].max(l[4]).max(l[5]) > 0.0));
        let v = weather_lights(&lumps, &["snow"]);
        assert_eq!(v["plain"]["local_lights"].as_array().map(Vec::len), Some(lights.len()));
        // the night's light too, which the window turns to as the game's clock does
        eprintln!(
            "night: {} {} {}",
            v["plain"]["color_night"], v["plain"]["light_scale_night"], v["plain"]["ambient_color_night"]
        );
        assert!(v["plain"]["color_night"].as_array().is_some_and(|a| a.len() == 3));
        // the four everyday zones, each with its place and reach: the Dire's sun is bluer than the Radiant's
        let zones = v["plain"]["zones"].as_array().unwrap();
        let names: Vec<&str> = zones.iter().filter_map(|z| z["zone"].as_str()).collect();
        assert_eq!(names.len(), 4, "{names:?}");
        assert!(["RF", "RB", "DF", "DT"].iter().all(|n| names.contains(n)), "{names:?}");
        let of = |n: &str| zones.iter().find(|z| z["zone"] == n).unwrap();
        assert_eq!(of("RF")["inner"], 7000.0);
        assert_eq!(of("DT")["outer"], 4500.0);
        assert!(of("DF")["at"][1].as_f64().unwrap() > 5000.0);
        assert_ne!(of("DF")["light"]["color_day"], of("RF")["light"]["color_day"]);
        assert_eq!(v["snow"]["zones"].as_array().map(Vec::len), Some(4));
        // and its standing effects: the river's flow among them, each with a place
        // the picture the water runs by, a field of the zones a look leaves alone
        assert_eq!(
            water_flow_map(&lumps).map(|t| t.replace('\\', "/")).as_deref(),
            Some("maps/dota/water_flow_map.vtex")
        );
        let fx = world_effects(&lumps);
        assert!(fx.len() > 800, "{}", fx.len());
        assert!(fx.iter().any(|f| f["fx"] == "particles/world_environmental_fx/map_riverflow_edges.vpcf"));
        assert!(fx.iter().all(|f| f["at"].as_array().is_some_and(|a| a.len() == 3)));
    }

    /// The real map's trees at one size and straight (MM_TEST_MAP is maps/dota.vpk): nearly every
    /// tree changes (each is turned its own way), and none is left to change after.
    #[test]
    fn the_maps_trees_come_to_one_size() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let ix = Index::open(std::path::Path::new(&map)).unwrap();
        let lump = ix.read("maps/dota/entities/default_ents.vents_c").unwrap().unwrap();
        let (out, n) = one_size_trees(&lump).unwrap();
        assert!(n > 2000, "{n}");
        assert_eq!(one_size_trees(&out).unwrap().1, 0);
    }

    /// The winter map built on the real game (MM_TEST_MAP is maps/dota.vpk): every file at the
    /// default map's name, no path of the winter map left in the world, snow in its zones.
    #[test]
    fn the_winter_map_with_snow() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let maps = std::path::Path::new(&map).parent().unwrap();
        let default_map = Index::open(std::path::Path::new(&map)).unwrap();
        let winter = Index::open(&maps.join("dota_winter.vpk")).unwrap();
        let look = MapLook {
            terrain: Some("winter".into()),
            weather: Some(WEATHERS[0].into()),
            light: Some(0.5),
            one_size: false,
        };
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
