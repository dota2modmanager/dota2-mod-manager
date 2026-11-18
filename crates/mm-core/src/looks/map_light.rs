//! Dota's own light on the map, lowered for the dark look of the Optimization window.
//!
//! The game lights the map from its `ent_dota_lightinfo` entities (about forty on the default
//! map, one per area, blended by distance): the sun's colour and `light_scale_*`, the light around
//! (`ambient_scale_*`), shadows, fog, each for day and night. They live in the map file's entity
//! lump, maps/<map>/entities/default_ents.vents_c, a resource whose DATA is KV3: one entry per
//! entity, its keys under `keyValues3Data.values`. Lowering the two scales of every lightinfo, day
//! and night, is the light dimmed everywhere, and nothing else of the map changes.

use crate::kv3;

/// How much of its light the map keeps in the dusk and in the dark look: the window's 3D map
/// lowers its sun by the same (map-view.ts).
pub const DUSK: f64 = 0.75;
pub const DARK: f64 = 0.5;

/// The keys of a lightinfo that are how much light there is.
const SCALES: [&str; 4] = ["light_scale_day", "light_scale_night", "ambient_scale_day", "ambient_scale_night"];

/// The entity lump with the light of every lightinfo times `k`, and how many lightinfos it touched.
pub fn dim_lights(file: &[u8], k: f64) -> Result<(Vec<u8>, usize), String> {
    let mut kv =
        kv3::read(crate::resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut root = std::mem::replace(&mut kv.root, kv3::Node::new(kv3::Value::Other { ty: 1, value: None }));
    let mut touched = 0;
    if let Some(kv3::Value::Array { items, .. }) = root.get_mut("m_entityKeyValues").map(|n| &mut n.value) {
        for e in items.iter_mut() {
            let Some(values) = e.get_mut("keyValues3Data").and_then(|d| d.get_mut("values")) else { continue };
            if values.get("classname").and_then(kv3::Node::as_str) != Some("ent_dota_lightinfo") {
                continue;
            }
            let mut any = false;
            for key in SCALES {
                if let Some(x) = values.get_mut(key) {
                    if let Some(n) = kv.number_of(x) {
                        any |= kv.set_number(x, n * k).map_err(|e| e.to_string())?;
                    }
                }
            }
            touched += usize::from(any);
        }
    }
    kv.root = root;
    if touched == 0 {
        return Err("no light on the map to dim".into());
    }
    let data = kv3::write(&kv).map_err(|e| e.to_string())?;
    Ok((crate::resource::replace(file, "DATA", 0, &data).map_err(|e| e.to_string())?, touched))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The entity lump of the default map, inside its map file.
    const ENTITIES: &str = "maps/dota/entities/default_ents.vents_c";

    /// The scales of every lightinfo, in order.
    fn light_scales(file: &[u8]) -> Result<Vec<f64>, String> {
        let kv =
            kv3::read(crate::resource::data(file, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        if let Some(kv3::Value::Array { items, .. }) = kv.root.get("m_entityKeyValues").map(|n| &n.value) {
            for e in items {
                let Some(values) = e.get("keyValues3Data").and_then(|d| d.get("values")) else { continue };
                if values.get("classname").and_then(kv3::Node::as_str) != Some("ent_dota_lightinfo") {
                    continue;
                }
                out.extend(SCALES.iter().filter_map(|k| values.get(k).and_then(|x| kv.number_of(x))));
            }
        }
        Ok(out)
    }

    /// The real map (MM_TEST_MAP, a maps/dota.vpk): every lightinfo's light halved, read back.
    #[test]
    fn the_real_map_dims() {
        let Ok(map) = std::env::var("MM_TEST_MAP") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&map)).unwrap();
        let file = ix.read(ENTITIES).unwrap().unwrap();
        let before = light_scales(&file).unwrap();
        let (dim, n) = dim_lights(&file, 0.5).unwrap();
        assert!(n >= 10, "{n} lightinfos");
        let after = light_scales(&dim).unwrap();
        assert_eq!(before.len(), after.len());
        for (a, b) in before.iter().zip(&after) {
            assert!((a * 0.5 - b).abs() < 1e-4, "{a} -> {b}");
        }
    }
}
