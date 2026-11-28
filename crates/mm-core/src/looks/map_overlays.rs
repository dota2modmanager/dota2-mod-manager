//! The map's overlays (F_OVERLAY: the rune's cracks, blood, the paths' edges, the Dire's stones) put
//! back where the map has them before map_scene.rs makes its light copy.

use std::collections::BTreeMap;

use serde_json::Value;

/// How far the toolchain's export lifts an overlay off what it lies on, along each vertex's normal: 1/2.54
/// of a metre, 15.5 inches, and only when it writes the materials too (Source2Viewer 20.1). The game
/// draws an overlay where its vertices are: in a frame of the Dire rune (RenderDoc, 2026-11-28) the
/// cracks' 761 vertices are the export's without materials to the thousandth of an inch, and lie on
/// the rune's pad; lifted, the pad drew over them and the Dire's logo sank under its stones.
const OVERLAY_LIFT: f32 = 1.0 / 2.54;

/// The overlays' positions (F_OVERLAY) put back where the map has them, by POSITION accessor,
/// packed tight.
pub fn overlay_positions(json: &Value, bin: &[u8]) -> BTreeMap<usize, Vec<u8>> {
    let accessors = arr(json, "accessors");
    let views = arr(json, "bufferViews");
    let materials = arr(json, "materials");
    let read = |a: usize| -> Option<Vec<[f32; 3]>> {
        let acc = accessors.get(a)?;
        let floats = acc.get("componentType").and_then(Value::as_u64) == Some(5126);
        if !floats || acc.get("type").and_then(Value::as_str) != Some("VEC3") || acc.get("sparse").is_some() {
            return None;
        }
        let view = views.get(acc.get("bufferView").and_then(idx)?)?;
        let off = view.get("byteOffset").and_then(idx).unwrap_or(0) + acc.get("byteOffset").and_then(idx).unwrap_or(0);
        let stride = view.get("byteStride").and_then(idx).filter(|s| *s > 0).unwrap_or(12);
        let count = acc.get("count").and_then(idx)?;
        (0..count)
            .map(|i| {
                let b = bin.get(off + i * stride..off + i * stride + 12)?;
                Some([0, 4, 8].map(|k| f32::from_le_bytes([b[k], b[k + 1], b[k + 2], b[k + 3]])))
            })
            .collect()
    };
    let mut out = BTreeMap::new();
    for mesh in arr(json, "meshes") {
        for p in mesh.get("primitives").and_then(Value::as_array).into_iter().flatten() {
            let overlay = p
                .get("material")
                .and_then(idx)
                .and_then(|m| materials.get(m))
                .is_some_and(|m| vmat_int(m, "F_OVERLAY") == Some(1));
            let at = |k: &str| p.get("attributes").and_then(|a| a.get(k)).and_then(idx);
            let (Some(pa), Some(na)) = (at("POSITION"), at("NORMAL")) else { continue };
            if !overlay || out.contains_key(&pa) {
                continue;
            }
            let (Some(ps), Some(ns)) = (read(pa), read(na)) else { continue };
            if ps.len() != ns.len() {
                continue;
            }
            let data: Vec<u8> = ps
                .iter()
                .zip(&ns)
                .flat_map(|(p, n)| [0, 1, 2].map(|k| p[k] - n[k] * OVERLAY_LIFT))
                .flat_map(f32::to_le_bytes)
                .collect();
            out.insert(pa, data);
        }
    }
    out
}

/// The smallest and largest x, y and z of positions packed tight (three floats each).
pub fn bounds(data: &[u8]) -> Option<([f32; 3], [f32; 3])> {
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for c in data.as_chunks::<12>().0 {
        for k in 0..3 {
            let v = f32::from_le_bytes([c[k * 4], c[k * 4 + 1], c[k * 4 + 2], c[k * 4 + 3]]);
            lo[k] = lo[k].min(v);
            hi[k] = hi[k].max(v);
        }
    }
    (!data.is_empty()).then_some((lo, hi))
}

fn arr(v: &Value, k: &str) -> Vec<Value> {
    v.get(k).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn idx(v: &Value) -> Option<usize> {
    v.as_u64().map(|n| n as usize)
}

fn vmat_int(material: &Value, key: &str) -> Option<i64> {
    material.pointer(&format!("/extras/vmat/IntParams/{key}")).and_then(Value::as_i64)
}
