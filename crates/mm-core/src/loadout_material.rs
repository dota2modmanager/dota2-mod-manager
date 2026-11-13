//! A material's own inputs, as the game compiled them (`readLoadoutMaterial` in
//! src/loadout-material.ts): its shader, its numbers, vectors and textures, from a KV3 material or
//! an older NTRO one. The textures are what the recolour of an item's model reads (`g_tColor`).
//! Not here yet: the expressions that tint by the gem's colour (`gemParams`, src/material.ts) and
//! the loadout shader's descriptor, which the 3D preview uses.

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;

use crate::resource;

/// A material's inputs, kept apart by kind so a zero flag and a packed mask survive.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct NativeMaterial {
    pub shader: String,
    pub floats: IndexMap<String, f64>,
    pub ints: IndexMap<String, f64>,
    pub vectors: IndexMap<String, Vec<f64>>,
    pub textures: IndexMap<String, String>,
}

type R<T> = Result<T, String>;

fn bytes<const N: usize>(b: &[u8], at: i64) -> R<[u8; N]> {
    let at = usize::try_from(at).map_err(|_| "out of range".to_string())?;
    b.get(at..at + N).and_then(|s| s.try_into().ok()).ok_or_else(|| "out of range".into())
}
fn u32_at(b: &[u8], at: i64) -> R<i64> {
    Ok(u32::from_le_bytes(bytes(b, at)?) as i64)
}
fn u16_at(b: &[u8], at: i64) -> R<i64> {
    Ok(u16::from_le_bytes(bytes(b, at)?) as i64)
}
fn i16_at(b: &[u8], at: i64) -> R<i64> {
    Ok(i16::from_le_bytes(bytes(b, at)?) as i64)
}

/// A NUL-ended string at `at`, as the TypeScript's `cstr`.
fn cstr(b: &[u8], at: i64) -> R<String> {
    if at < 0 || at as usize >= b.len() {
        return Err("NTRO string out of range".into());
    }
    let rest = &b[at as usize..];
    let end = memchr::memchr(0, rest).ok_or("NTRO string unterminated")?;
    Ok(String::from_utf8_lossy(&rest[..end]).into_owned())
}

/// RERL's resources by their 64-bit id: an NTRO texture parameter holds the id, not the path.
fn reference_ids(file: &[u8]) -> R<std::collections::HashMap<u64, String>> {
    let mut out = std::collections::HashMap::new();
    let blocks = resource::blocks(file).map_err(|e| e.0)?;
    if !blocks.iter().any(|b| b.name == "RERL") {
        return Ok(out);
    }
    let data = resource::data(file, "RERL", 0).map_err(|e| e.0)?;
    let first = u32_at(data, 0)?;
    for k in 0..u32_at(data, 4)? {
        let e = first + k * 16;
        let s = e + 8 + u32_at(data, e + 8)?;
        // Buffer.toString to an index of -1 is empty
        let name = data
            .get(s as usize..)
            .and_then(|rest| memchr::memchr(0, rest).map(|z| String::from_utf8_lossy(&rest[..z]).into_owned()))
            .unwrap_or_default();
        out.insert(u64::from_le_bytes(bytes(data, e)?), name);
    }
    Ok(out)
}

struct Struct {
    size: i64,
    id: i64,
    base: i64,
    fields: IndexMap<String, i64>,
}

/// An older material: the field offsets recorded in the resource itself.
fn ntro(file: &[u8]) -> R<serde_json::Map<String, Value>> {
    let block = resource::data(file, "NTRO", 0).map_err(|e| e.0)?;
    let data = resource::data(file, "DATA", 0).map_err(|e| e.0)?;
    let mut structs: IndexMap<String, Struct> = IndexMap::new();
    let start = 4 + u32_at(block, 4)?;
    let count = u32_at(block, 8)?;
    if count > 256 {
        return Err("NTRO struct limit".into());
    }
    for i in 0..count {
        let at = start + i * 40;
        let first = at + 28 + u32_at(block, at + 28)?;
        let n = u32_at(block, at + 32)?;
        if n > 256 {
            return Err("NTRO field limit".into());
        }
        let mut fields = IndexMap::new();
        for j in 0..n {
            let p = first + j * 24;
            fields.insert(cstr(block, p + u32_at(block, p)?)?, i16_at(block, p + 6)?);
        }
        let name = cstr(block, at + 8 + u32_at(block, at + 8)?)?;
        let s =
            Struct { size: u16_at(block, at + 20)?, id: u32_at(block, at + 4)?, base: u32_at(block, at + 24)?, fields };
        structs.insert(name, s);
    }
    let mut by_id: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();
    for (k, s) in structs.values().enumerate() {
        by_id.insert(s.id, k);
    }
    for k in 0..structs.len() {
        let mut visited = std::collections::HashSet::new();
        let mut b = by_id.get(&structs[k].base).copied();
        while let Some(bi) = b {
            let id = structs[bi].id;
            if !visited.insert(id) {
                break;
            }
            let inherited: Vec<(String, i64)> = structs[bi].fields.iter().map(|(n, o)| (n.clone(), *o)).collect();
            for (name, offset) in inherited {
                structs[k].fields.entry(name).or_insert(offset);
            }
            b = by_id.get(&structs[bi].base).copied();
        }
    }
    let root = structs.get("MaterialResourceData_t").ok_or("No material struct")?;
    let ids = reference_ids(file)?;
    let mut out = serde_json::Map::new();
    if let Some(&shader) = root.fields.get("m_shaderName") {
        out.insert("m_shaderName".into(), Value::String(cstr(data, shader + u32_at(data, shader)?)?));
    }
    for (field, ty) in [
        ("m_intParams", "Int"),
        ("m_floatParams", "Float"),
        ("m_vectorParams", "Vector"),
        ("m_textureParams", "Texture"),
    ] {
        let (Some(&at), Some(row)) = (root.fields.get(field), structs.get(&format!("MaterialParam{ty}_t"))) else {
            continue;
        };
        let name = row.fields.get("m_name").copied();
        let value = ["m_nValue", "m_flValue", "m_value", "m_pValue"].iter().find_map(|k| row.fields.get(*k).copied());
        let (Some(name), Some(value)) = (name, value) else { continue };
        let first = at + u32_at(data, at)?;
        let n = u32_at(data, at + 4)?;
        if n > 4096 {
            return Err("NTRO parameter limit".into());
        }
        let mut rows = Vec::new();
        for i in 0..n {
            let p = first + i * row.size;
            let v = p + value;
            let m_name = cstr(data, p + name + u32_at(data, p + name)?)?;
            let m_value = match ty {
                "Texture" => Value::String(ids.get(&u64::from_le_bytes(bytes(data, v)?)).cloned().unwrap_or_default()),
                "Vector" => Value::Array(
                    (0..4)
                        .map(|k| Ok(crate::js::json_number(f32::from_le_bytes(bytes(data, v + k * 4)?) as f64)))
                        .collect::<R<Vec<_>>>()?,
                ),
                "Int" => serde_json::json!(i32::from_le_bytes(bytes(data, v)?)),
                _ => crate::js::json_number(f32::from_le_bytes(bytes(data, v)?) as f64),
            };
            rows.push(serde_json::json!({ "m_name": m_name, "m_value": m_value }));
        }
        out.insert(field.into(), Value::Array(rows));
    }
    Ok(out)
}

fn tree_of(file: &[u8]) -> R<Value> {
    let blocks = resource::blocks(file).map_err(|e| e.0)?;
    if blocks.iter().any(|b| b.name == "NTRO") {
        return ntro(file).map(Value::Object);
    }
    let kv = crate::kv3::read(resource::data(file, "DATA", 0).map_err(|e| e.0)?).map_err(|e| e.0)?;
    Ok(crate::particle_spec::kv_json(&kv, Some(&kv.root)))
}

/// A KV3 or NTRO material's inputs; None for a file the reader cannot take.
pub fn read_loadout_material(file: Option<&[u8]>) -> Option<NativeMaterial> {
    let tree = tree_of(file?).ok()?;
    let tree = tree.as_object()?;
    let mut out = NativeMaterial {
        shader: tree.get("m_shaderName").filter(|v| !v.is_null()).map(crate::js::string).unwrap_or_default(),
        ..Default::default()
    };
    for (field, kind) in [("m_floatParams", 0), ("m_intParams", 1), ("m_vectorParams", 2), ("m_textureParams", 3)] {
        let Some(rows) = tree.get(field).and_then(Value::as_array) else { continue };
        for row in rows {
            let Some(row) = row.as_object() else { continue };
            let Some(name) = row.get("m_name").and_then(Value::as_str) else { continue };
            let value = ["m_value", "m_nValue", "m_flValue", "m_pValue"]
                .iter()
                .find_map(|k| row.get(*k).filter(|v| !v.is_null()))
                .unwrap_or(&Value::Null);
            match (kind, value) {
                (0, Value::Number(n)) => {
                    out.floats.insert(name.into(), n.as_f64().unwrap_or(0.0));
                }
                (1, Value::Number(n)) => {
                    out.ints.insert(name.into(), n.as_f64().unwrap_or(0.0));
                }
                (2, Value::Array(a)) => {
                    out.vectors.insert(name.into(), a.iter().map(crate::js::to_number).collect());
                }
                (2, Value::Object(o)) => {
                    let n = ["x", "y", "z", "w"]
                        .iter()
                        .map(|k| o.get(*k).filter(|v| !v.is_null()).map_or(1.0, crate::js::to_number))
                        .collect();
                    out.vectors.insert(name.into(), n);
                }
                (3, Value::String(s)) => {
                    out.textures.insert(name.into(), s.strip_suffix("_c").unwrap_or(s).to_string());
                }
                _ => {}
            }
        }
    }
    // the Workshop calls the separate cutout map transparency; some materials name it so
    if let Some(t) = out.textures.get("g_tTransparency").filter(|t| !t.is_empty()).cloned() {
        out.textures.entry("g_tOpacity".into()).or_insert(t);
    }
    // a cube map the shader samples only where the switch is on
    if out.ints.get("F_SPECULAR_CUBE_MAP").is_none_or(|v| *v == 0.0 || v.is_nan()) {
        out.textures.shift_remove("g_tCubeMap");
    }
    Some(out)
}
