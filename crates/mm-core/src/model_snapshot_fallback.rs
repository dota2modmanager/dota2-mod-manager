//! A last-resort particle snapshot for a model whose .vsnap is not in the installed archive
//! (src/model-snapshot-fallback.ts; PA's arcana weapon surfaces): points sampled off the actual
//! skinned GLB, which beats dropping every particle that samples that snapshot. Never a stand-in
//! for a real .vsnap, and never a point floating free in space.

use serde_json::{json, Value};

use crate::js::json_number;

fn idx(v: Option<&Value>) -> Option<usize> {
    v.and_then(Value::as_f64).filter(|n| *n >= 0.0 && n.fract() == 0.0).map(|n| n as usize)
}

fn num(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(0.0)
}

fn component(ty: f64) -> usize {
    match ty as i64 {
        5120 | 5121 => 1,
        5122 | 5123 => 2,
        5125 | 5126 => 4,
        _ => 0,
    }
}

/// One row of an accessor, as numbers; empty when there is no such row or it is out of the buffer.
fn read(json: &Value, bin: &[u8], index: Option<usize>, row: usize) -> Vec<f64> {
    let Some(a) = index.and_then(|i| json.get("accessors")?.get(i)) else { return vec![] };
    let Some(view) = idx(a.get("bufferView")).and_then(|i| json.get("bufferViews")?.get(i)) else { return vec![] };
    let ty = a.get("type").and_then(Value::as_str).unwrap_or("");
    let ct = num(a.get("componentType"));
    if ty.is_empty() || ct == 0.0 || row as f64 >= num(a.get("count")) {
        return vec![];
    }
    let width = match ty {
        "SCALAR" => 1,
        "VEC2" => 2,
        "VEC3" => 3,
        "VEC4" => 4,
        _ => 0,
    };
    let size = component(ct);
    if size == 0 || width == 0 {
        return vec![];
    }
    let stride = Some(num(view.get("byteStride"))).filter(|s| *s != 0.0).unwrap_or((width * size) as f64);
    let base = num(view.get("byteOffset")) + num(a.get("byteOffset")) + row as f64 * stride;
    if base < 0.0 || base + (width * size) as f64 > bin.len() as f64 || base.fract() != 0.0 {
        return vec![];
    }
    let base = base as usize;
    let normalized = a.get("normalized").is_some_and(crate::js::truthy);
    (0..width)
        .map(|i| {
            let p = base + i * size;
            let b = &bin[p..p + size];
            let ct = ct as i64;
            let mut n = match ct {
                5126 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
                5125 => u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
                5123 => u16::from_le_bytes([b[0], b[1]]) as f64,
                5122 => i16::from_le_bytes([b[0], b[1]]) as f64,
                5121 => b[0] as f64,
                _ => b[0] as i8 as f64,
            };
            if normalized {
                n /= match ct {
                    5123 => 65535.0,
                    5122 => 32767.0,
                    5121 => 255.0,
                    _ => 127.0,
                };
            }
            n
        })
        .collect()
}

struct Point {
    position: [f64; 3],
    skinning: Vec<(String, f64)>,
}

fn on_side(name: &str, side: Option<&str>) -> bool {
    let l = name.to_lowercase();
    match side {
        Some("left") => l.ends_with("_l") || l.contains("left") || l.contains("weapon_l"),
        Some("right") => l.ends_with("_r") || l.contains("right") || l.contains("weapon0_0"),
        _ => true,
    }
}

/// Points sampled off skinned geometry, for a model whose archive has no authored snapshot: the
/// positions in Source's inches and Z-up, and each point's bones and weights. None for no geometry.
pub fn snapshot_from_model(bytes: &[u8], side: Option<&str>, max: f64) -> Result<Value, String> {
    let (json, bin) = crate::glb_embed::read_glb(bytes)?;
    let nodes = json.get("nodes").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut points: Vec<Point> = Vec::new();
    for node in &nodes {
        let Some(mesh_at) = node.get("mesh") else { continue };
        let mesh = idx(Some(mesh_at)).and_then(|i| json.get("meshes")?.get(i));
        let skin = idx(node.get("skin")).and_then(|i| json.get("skins")?.get(i));
        let joints: Vec<String> = skin
            .and_then(|s| s.get("joints"))
            .and_then(Value::as_array)
            .map(|j| {
                j.iter()
                    .map(|x| {
                        idx(Some(x))
                            .and_then(|i| nodes.get(i))
                            .and_then(|n| n.get("name"))
                            .filter(|n| crate::js::truthy(n))
                            .map(crate::js::string)
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();
        for primitive in mesh.and_then(|m| m.get("primitives")).and_then(Value::as_array).cloned().unwrap_or_default() {
            let at = primitive.get("attributes").cloned().unwrap_or_else(|| json!({}));
            let position_at = idx(at.get("POSITION"));
            let count = position_at.and_then(|i| json.get("accessors")?.get(i)).map_or(0.0, |p| num(p.get("count")));
            if count == 0.0 || count.is_nan() {
                continue;
            }
            let step = (count / 4000.0).floor().max(1.0) as usize;
            let mut v = 0usize;
            while (v as f64) < count {
                let xyz = read(&json, &bin, position_at, v);
                if xyz.len() == 3 && xyz.iter().all(|x| x.is_finite()) {
                    let indices = read(&json, &bin, idx(at.get("JOINTS_0")), v);
                    let weights = read(&json, &bin, idx(at.get("WEIGHTS_0")), v);
                    let skinning = indices
                        .iter()
                        .enumerate()
                        .map(|(i, index)| {
                            let name = if index.fract() == 0.0 && *index >= 0.0 {
                                joints.get(*index as usize).cloned().unwrap_or_default()
                            } else {
                                String::new()
                            };
                            let w = weights.get(i).copied().filter(|w| !w.is_nan()).unwrap_or(0.0);
                            (name, w)
                        })
                        .filter(|(name, w)| !name.is_empty() && *w > 0.0)
                        .collect();
                    // GLB stores metres and Y-up; native particle snapshots use Source inches and Z-up
                    points.push(Point { position: [xyz[2] / 0.0254, xyz[0] / 0.0254, xyz[1] / 0.0254], skinning });
                }
                v += step;
            }
        }
    }
    let preferred: Vec<&Point> = if side.is_some_and(|s| s == "left" || s == "right") {
        points.iter().filter(|p| p.skinning.iter().any(|(n, w)| *w > 0.15 && on_side(n, side))).collect()
    } else {
        points.iter().collect()
    };
    let sample: Vec<&Point> = if preferred.len() >= 12 { preferred } else { points.iter().collect() };
    if sample.is_empty() {
        return Ok(Value::Null);
    }
    let count = (max.max(1.0).min(sample.len() as f64)) as usize;
    let spacing = sample.len() as f64 / count as f64;
    let selected: Vec<&Point> = (0..count).map(|i| sample[((i as f64 + 0.5) * spacing).floor() as usize]).collect();
    Ok(json!({
        "position": selected.iter().map(|p| p.position.iter().map(|x| json_number(*x)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "skinning": selected.iter().map(|p| p.skinning.iter().map(|(n, w)| json!([n, json_number(*w)])).collect::<Vec<_>>()).collect::<Vec<_>>(),
    }))
}
