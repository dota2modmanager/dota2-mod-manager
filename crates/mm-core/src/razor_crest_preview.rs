//! The regular Crest of the Vengeful Storm drawn on its golden finish's rig
//! (src/razor-crest-preview.ts): the gold model's geometry and bones, the normal one's look.

use std::path::Path;

use serde_json::{json, Value};

use crate::glb_embed::{embed_glb, read_glb, write_glb};

const NORMAL: &str = "6646";
const GOLDEN: &str = "6916";

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

/// The distinct golden model to try for the regular Crest's preview.
/// A table with no items section is refused, as findItem refuses it.
pub fn golden_crest_model(text: &[u8], model: &str, item_id: &str) -> Result<Option<String>, String> {
    if item_id != NORMAL {
        return Ok(None);
    }
    let Some((start, _)) = crate::schema::find_item(text, GOLDEN, None).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let fields = crate::schema::item_fields(text, start).map_err(|e| e.to_string())?;
    let donor = fields.into_iter().find(|(k, _)| k == "model_player").map(|(_, v)| v.to_lowercase());
    Ok(donor.filter(|d| !d.is_empty() && d != model))
}

/// The same authored animation modifiers for both finishes of the same helmet.
pub fn crest_activities(text: &[u8], item_id: &str, visuals: &str) -> Result<Vec<String>, String> {
    let gold =
        if item_id == NORMAL { crate::schema::find_item(text, GOLDEN, None).map_err(|e| e.to_string())? } else { None };
    Ok(match gold {
        Some((s, e)) => crate::model_loadout::item_activities(&latin1(&text[s..e])),
        None => crate::model_loadout::item_activities(visuals),
    })
}

/// The material slots a GLB's primitives use, sorted.
fn slots(gltf: &Value) -> Vec<i64> {
    let mut out: Vec<i64> = gltf
        .get("meshes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|m| m.get("primitives").and_then(Value::as_array).into_iter().flatten())
        .map(|p| p.get("material").and_then(Value::as_i64).unwrap_or(-1))
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

fn len_of(v: Option<&Value>) -> usize {
    v.and_then(Value::as_array).map_or(0, Vec::len)
}

fn crest(normal: &[u8], golden_file: &Path) -> Result<Option<Vec<u8>>, String> {
    let (look, bin) = read_glb(normal)?;
    let (mut geometry, donor_bin) = read_glb(&embed_glb(golden_file)?)?;
    let materials = len_of(look.get("materials"));
    if materials == 0
        || materials != len_of(geometry.get("materials"))
        || len_of(look.get("meshes")) == 0
        || slots(&look) != slots(&geometry)
    {
        return Ok(None);
    }
    if let Some(images) = look.get("images").and_then(Value::as_array) {
        let mut out = Vec::with_capacity(images.len());
        for image in images {
            if image.get("uri").and_then(Value::as_str).is_some_and(|u| u.starts_with("data:")) {
                out.push(image.clone());
                continue;
            }
            let view = image
                .get("bufferView")
                .and_then(Value::as_u64)
                .and_then(|i| look.get("bufferViews")?.get(i as usize))
                .filter(|v| v.get("buffer").and_then(Value::as_f64) == Some(0.0));
            let mime = image.get("mimeType").filter(|m| crate::js::truthy(m)).map(crate::js::string);
            let (Some(view), Some(mime)) = (view, mime) else { return Err("Unresolved Crest texture".into()) };
            let offset = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let length = view.get("byteLength").and_then(Value::as_u64).unwrap_or(0) as usize;
            let slice = bin.get(offset.min(bin.len())..(offset + length).min(bin.len())).unwrap_or(&[]);
            use base64::Engine;
            out.push(json!({ "uri": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(slice)) }));
        }
        geometry["images"] = Value::Array(out);
    } else if let Some(o) = geometry.as_object_mut() {
        // `look.images?.map(...)` is undefined, which JSON leaves out
        o.shift_remove("images");
    }
    for key in ["materials", "samplers", "textures", "extras"] {
        match look.get(key) {
            Some(v) => geometry[key] = v.clone(),
            None => {
                if let Some(o) = geometry.as_object_mut() {
                    o.shift_remove(key);
                }
            }
        }
    }
    let mut used: Vec<Value> = Vec::new();
    for e in [geometry.get("extensionsUsed"), look.get("extensionsUsed")]
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .flatten()
    {
        if !used.contains(e) {
            used.push(e.clone());
        }
    }
    geometry["extensionsUsed"] = Value::Array(used);
    Ok(Some(write_glb(&geometry, &donor_bin)))
}

/// The normal Crest's look on the gold model's geometry and rig, when the two match slot for slot.
pub fn normal_crest_on_golden_rig(normal: &[u8], golden_file: &Path) -> Option<Vec<u8>> {
    crest(normal, golden_file).ok().flatten()
}

/// The donor rig's attachment points, and the ones only the original has.
pub fn merge_crest_attachments(normal: &[Value], donor: &[Value]) -> Vec<Value> {
    let mut merged: indexmap::IndexMap<String, Value> = indexmap::IndexMap::new();
    let name = |p: &Value| p.get("name").map(crate::js::string).unwrap_or_default().to_lowercase();
    for p in normal.iter().chain(donor) {
        merged.insert(name(p), p.clone());
    }
    merged.into_values().collect()
}
