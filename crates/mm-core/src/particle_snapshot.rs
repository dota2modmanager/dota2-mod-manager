//! The points of a compiled particle snapshot (.vsnap_c), replacing src/particle-snapshot.ts: what
//! the 3D preview spreads a snapshot's particles from, in the snapshot's own space.

use serde_json::{json, Map, Value};

use crate::js::json_number;
use crate::resource;

fn err<T>(m: &str) -> Result<T, String> {
    Err(format!("snapshot: {m}"))
}

fn u16_at(b: &[u8], at: usize) -> Result<u16, String> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| "snapshot: a read past the block".into())
}

fn u32_at(b: &[u8], at: usize) -> Result<u32, String> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .ok_or_else(|| "snapshot: a read past the block".into())
}

fn f32_at(b: &[u8], at: i64) -> Result<f64, String> {
    usize::try_from(at)
        .ok()
        .and_then(|a| b.get(a..a + 4))
        .map(|s| f32::from_le_bytes(s.try_into().unwrap()) as f64)
        .ok_or_else(|| "snapshot: a read past the block".into())
}

fn i32_at(b: &[u8], at: i64) -> Result<f64, String> {
    usize::try_from(at)
        .ok()
        .and_then(|a| b.get(a..a + 4))
        .map(|s| i32::from_le_bytes(s.try_into().unwrap()) as f64)
        .ok_or_else(|| "snapshot: a read past the block".into())
}

fn i16_at(b: &[u8], at: i64) -> Result<i16, String> {
    usize::try_from(at)
        .ok()
        .and_then(|a| b.get(a..a + 2))
        .map(|s| i16::from_le_bytes([s[0], s[1]]))
        .ok_or_else(|| "snapshot: a read past the block".into())
}

/// SNAP keeps a size header, then raw bytes or groups of 16 LZ tokens.
fn unpack(block: &[u8]) -> Result<Vec<u8>, String> {
    let header = u32_at(block, 0)?;
    let size = (header & 0x7fff_ffff) as usize;
    if size > 8 * 1024 * 1024 {
        return err("SNAP block too large");
    }
    if header as usize != size {
        if block.len() < 4 + size {
            return err("Truncated SNAP block");
        }
        return Ok(block[4..4 + size].to_vec());
    }
    let mut out = vec![0u8; size];
    let (mut input, mut offset) = (4usize, 0usize);
    while offset < size {
        let mask = u16_at(block, input)?;
        input += 2;
        let mut bit = 0;
        while bit < 16 && offset < size {
            if mask & (1 << bit) == 0 {
                out[offset] = *block.get(input).ok_or("snapshot: a read past the block")?;
                offset += 1;
                input += 1;
                bit += 1;
                continue;
            }
            let token = u16_at(block, input)? as usize;
            input += 2;
            let (distance, length) = ((token >> 4) + 1, (token & 15) + 3);
            if distance > offset || length > size - offset {
                return err("Invalid SNAP back reference");
            }
            for _ in 0..length {
                out[offset] = out[offset - distance];
                offset += 1;
            }
            bit += 1;
        }
    }
    Ok(out)
}

/// The field number the preview knows an attribute by.
fn field_id(name: &str) -> Option<u32> {
    Some(match name {
        "life_duration" => 1,
        "rotation" => 4,
        "rotation_speed" => 5,
        "creation_time" => 8,
        "sequence_number" => 9,
        "trail_length" => 10,
        "yaw" => 12,
        "sequence_number1" => 13,
        "hitbox" => 14,
        "hitbox_offset_position" => 15,
        "alpha2" => 16,
        "scratch_vec" => 17,
        "scratch_float" => 18,
        "pitch" => 20,
        "glow_rgb" => 22,
        "glow_alpha" => 23,
        _ => return None,
    })
}

fn clamp01(v: f64) -> f64 {
    // Math.min(1, Math.max(0, v)), which never gives -0
    if v > 1.0 {
        1.0
    } else if v > 0.0 {
        v
    } else {
        0.0
    }
}

/// Decode the attributes of a compiled snapshot, without treating its local points as world
/// coordinates. `data` is the snapshot's DATA tree as JSON.
pub fn snapshot_points(file: &[u8], data: &Value) -> Result<Vec<Value>, String> {
    let count = match data.get("num_particles") {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        _ => return Ok(vec![]),
    };
    let Some(attributes) = data.get("attributes").and_then(Value::as_array) else { return Ok(vec![]) };
    if count.fract() != 0.0 || !(1.0..=32768.0).contains(&count) {
        return Ok(vec![]);
    }
    let count = count as i64;
    let bytes = unpack(resource::data(file, "SNAP", 0).map_err(|e| e.to_string())?)?;
    let (mut offset, mut position, mut skin, mut color, mut normal, mut alpha, mut radius) =
        (0i64, -1i64, -1i64, -1i64, -1i64, -1i64, -1i64);
    let mut fields: Vec<(u32, i64, i64, bool)> = Vec::new();
    for attribute in attributes {
        let ty = attribute.get("type").and_then(Value::as_str).unwrap_or("");
        if !["skinning", "float3", "vector", "float", "int", "string", "bone"].contains(&ty) {
            return Ok(vec![]);
        }
        let width = match ty {
            "skinning" => 24,
            "float3" | "vector" => 12,
            _ => 4,
        };
        let name = attribute.get("name").and_then(Value::as_str);
        match (name, width) {
            (Some("position"), 12) => position = offset,
            (Some("color"), 12) => color = offset,
            (Some("normal"), 12) => normal = offset,
            (Some("alpha"), 4) => alpha = offset,
            (Some("radius"), 4) => radius = offset,
            _ => {}
        }
        if ty == "skinning" {
            skin = offset;
        }
        if let Some(id) = name.and_then(field_id) {
            fields.push((id, offset, width, ty == "int"));
        }
        offset += count * width;
    }
    if position < 0 || offset > bytes.len() as i64 {
        return Ok(vec![]);
    }
    let names: &[Value] = data.get("string_list").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let mut out = Vec::new();
    for i in 0..count {
        let (p, joint) = (position + i * 12, skin + i * 24);
        let mut weights = Vec::new();
        for k in 0..4 {
            if skin < 0 {
                break;
            }
            let at = i16_at(&bytes, joint + k * 2)?;
            let weight = f32_at(&bytes, joint + 8 + k * 4)?;
            let name =
                usize::try_from(at).ok().and_then(|a| names.get(a)).and_then(Value::as_str).filter(|n| !n.is_empty());
            if let Some(name) = name {
                if weight.is_finite() && weight > 0.0 {
                    weights.push(json!([name, json_number(weight)]));
                }
            }
        }
        let mut point = Map::new();
        if color >= 0 {
            let tint = [
                f32_at(&bytes, color + i * 12)?,
                f32_at(&bytes, color + i * 12 + 4)?,
                f32_at(&bytes, color + i * 12 + 8)?,
            ];
            let max = if tint.iter().any(|v| v.is_nan()) {
                f64::NAN
            } else {
                tint.iter().fold(f64::NEG_INFINITY, |a, b| a.max(*b))
            };
            let divisor = if max > 1.0 { 255.0 } else { 1.0 };
            if tint.iter().all(|v| v.is_finite()) {
                point.insert(
                    "color".into(),
                    Value::Array(tint.iter().map(|v| json_number(clamp01(v / divisor))).collect()),
                );
            }
        }
        let mut extra = Map::new();
        for &(id, at, width, integer) in &fields {
            let read = |axis: i64| {
                if integer {
                    i32_at(&bytes, at + i * width + axis)
                } else {
                    f32_at(&bytes, at + i * width + axis)
                }
            };
            let values = if width == 12 { vec![read(0)?, read(4)?, read(8)?] } else { vec![read(0)?] };
            if values.iter().all(|v| v.is_finite()) {
                let v = if width == 12 {
                    Value::Array(values.into_iter().map(json_number).collect())
                } else {
                    json_number(values[0])
                };
                extra.insert(id.to_string(), v);
            }
        }
        if !extra.is_empty() {
            point.insert("attributes".into(), Value::Object(extra));
        }
        if normal >= 0 {
            let axis = [
                f32_at(&bytes, normal + i * 12)?,
                f32_at(&bytes, normal + i * 12 + 4)?,
                f32_at(&bytes, normal + i * 12 + 8)?,
            ];
            if axis.iter().all(|v| v.is_finite()) {
                point.insert("normal".into(), Value::Array(axis.into_iter().map(json_number).collect()));
            }
        }
        let a = if alpha < 0 { f64::NAN } else { f32_at(&bytes, alpha + i * 4)? };
        let r = if radius < 0 { f64::NAN } else { f32_at(&bytes, radius + i * 4)? };
        if a.is_finite() {
            point.insert("alpha".into(), json_number(clamp01(a)));
        }
        if r.is_finite() {
            point.insert("radius".into(), json_number(if r > 0.0 { r } else { 0.0 }));
        }
        let pos = [f32_at(&bytes, p)?, f32_at(&bytes, p + 4)?, f32_at(&bytes, p + 8)?];
        if !pos.iter().all(|v| v.is_finite()) {
            continue;
        }
        point.insert("position".into(), Value::Array(pos.into_iter().map(json_number).collect()));
        point.insert("weights".into(), Value::Array(weights));
        out.push(Value::Object(point));
    }
    Ok(out)
}
