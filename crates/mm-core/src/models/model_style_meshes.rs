//! Which of an exported model's style meshes the preview draws (src/model-style-meshes.ts).
//!
//! Source 2 exports bodygroup alternatives as independent glTF nodes, and the exporter does not
//! carry the game's bodygroup visibility into glTF: *_copy, *_alt and the first-style mesh can
//! all be drawn on top of one another. This is deliberately conservative: meshes are hidden only
//! when a model has an explicit pair of a primary and an _alt material on separate primitives.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::glb_embed::{read_glb, write_glb};

fn norm(name: &str) -> String {
    name.replace('\\', "/").rsplit('/').next().unwrap_or("").to_lowercase()
}

fn bare(name: &str) -> String {
    let l = name.to_lowercase();
    // /_alt$/i on the name, then lower case: the same as on its lower case
    l.strip_suffix("_alt").map(String::from).unwrap_or(l)
}

fn material_names(json: &Value, f: impl Fn(&str) -> String) -> Vec<String> {
    json.get("materials")
        .and_then(Value::as_array)
        .map(|m| {
            m.iter()
                .map(|m| f(&m.get("name").filter(|n| !n.is_null()).map(crate::js::string).unwrap_or_default()))
                .collect()
        })
        .unwrap_or_default()
}

/// The names of a mesh's primitives' materials ('' for one without).
fn assigned(mesh: Option<&Value>, materials: &[String]) -> Vec<String> {
    mesh.and_then(|m| m.get("primitives"))
        .and_then(Value::as_array)
        .map(|ps| {
            ps.iter()
                .map(|p| {
                    p.get("material")
                        .and_then(Value::as_f64)
                        .filter(|n| *n >= 0.0 && n.fract() == 0.0)
                        .and_then(|n| materials.get(n as usize))
                        .cloned()
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mesh_of<'a>(json: &'a Value, node: &Value) -> Option<&'a Value> {
    let i = node.get("mesh")?.as_f64().filter(|n| *n >= 0.0 && n.fract() == 0.0)?;
    json.get("meshes")?.get(i as usize)
}

/// Drop `mesh` from each node `hide` picks; the GLB rewritten, or the same bytes when none is.
fn hide_nodes(input: &[u8], mut json: Value, bin: Vec<u8>, hide: impl Fn(&Value, &Value) -> bool) -> Vec<u8> {
    let picks: Vec<usize> = json
        .get("nodes")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.get("mesh").is_some() && hide(&json, n))
                .map(|(i, _)| i)
                .collect()
        })
        .unwrap_or_default();
    if picks.is_empty() {
        return input.to_vec();
    }
    if let Some(nodes) = json.get_mut("nodes").and_then(Value::as_array_mut) {
        for i in picks {
            if let Some(o) = nodes[i].as_object_mut() {
                o.shift_remove("mesh");
            }
        }
    }
    write_glb(&json, &bin)
}

/// Keep only the first or the alternative authored mesh of a model with an alternate bodygroup.
pub fn select_style_meshes(data: &[u8], style: f64) -> Result<Vec<u8>, String> {
    let (json, bin) = read_glb(data)?;
    let materials = material_names(&json, norm);
    let names: HashSet<&String> = materials.iter().collect();
    let paired: HashSet<String> =
        materials.iter().filter(|m| m.ends_with("_alt") && names.contains(&bare(m))).map(|m| bare(m)).collect();
    if paired.is_empty() {
        return Ok(data.to_vec());
    }
    let category = |mesh: &Value| -> Option<&'static str> {
        let all = assigned(Some(mesh), &materials);
        let relevant: Vec<&String> = all.iter().filter(|m| paired.contains(&bare(m))).collect();
        // mixed geometry may carry accents both styles share: it stays
        if relevant.is_empty() || relevant.len() != all.len() {
            return None;
        }
        let alt = relevant.iter().all(|m| m.ends_with("_alt"));
        let base = relevant.iter().all(|m| !m.ends_with("_alt"));
        if !base && !alt {
            return None;
        }
        let name = norm(&mesh.get("name").filter(|n| !n.is_null()).map(crate::js::string).unwrap_or_default());
        if is_copy(&name) {
            return Some("copy");
        }
        Some(if alt { "alt" } else { "base" })
    };
    let selected = if style > 0.0 { "alt" } else { "base" };
    Ok(hide_nodes(data, json.clone(), bin, |json, node| {
        mesh_of(json, node).and_then(category).is_some_and(|g| g != selected)
    }))
}

/// /_copy(?:\d+)?$/i
fn is_copy(name: &str) -> bool {
    let digits = name.trim_end_matches(|c: char| c.is_ascii_digit());
    digits.to_lowercase().ends_with("_copy")
}

/// The authored collection a model belongs to: only multi-piece items of one collection share a
/// chosen style. `exact` keeps the case and the slashes as they are (`syncArcanaStyles`).
fn family(model: &str, exact: bool) -> String {
    let m = if exact { model.to_string() } else { model.replace('\\', "/") };
    let low = m.to_lowercase();
    let Some(rest) = (if exact { m.strip_prefix("models/items/") } else { low.strip_prefix("models/items/") }) else {
        return String::new();
    };
    let mut parts = rest.splitn(3, '/');
    let (Some(a), Some(b), Some(_)) = (parts.next(), parts.next(), parts.next()) else { return String::new() };
    if a.is_empty() || b.is_empty() {
        return String::new();
    }
    let out = format!("models/items/{a}/{b}/");
    if exact {
        out
    } else {
        out.to_lowercase()
    }
}

/// The collection a model is from, for sharing a chosen style.
pub fn style_family(model: &str) -> String {
    family(model, false)
}

/// A style chosen on a set's head also picks the exported alt meshes on its siblings.
pub fn sync_arcana_styles(parts: &mut [Value]) {
    let model = |p: &Value| p.get("model").map(crate::js::string).unwrap_or_default();
    let mut chosen: HashMap<String, Value> = HashMap::new();
    for p in parts.iter() {
        let f = family(&model(p), true);
        if p.get("style").is_some_and(crate::js::truthy) && !f.is_empty() {
            chosen.insert(f, p["style"].clone());
        }
    }
    for p in parts.iter_mut() {
        let f = family(&model(p), true);
        if !p.get("style").is_some_and(crate::js::truthy) && !p.get("explicitBaseStyle").is_some_and(crate::js::truthy)
        {
            if let Some(s) = chosen.get(&f) {
                p["style"] = s.clone();
            }
        }
    }
}

/// (?:^|[\\/_.-])landing_page[\w-]*.*(?:dissolve|blade)|landing_page_blade_dissolve
fn landing_page_only(m: &str) -> bool {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"(?:^|[\\/_.-])landing_page[A-Za-z0-9_-]*[^\n\r\x{2028}\x{2029}]*(?:dissolve|blade)|landing_page_blade_dissolve")
            .expect("a valid pattern")
    })
    .is_match(m)
}

/// Cinematic-only geometry hidden: Spectre's arcana carries five landing-page dissolve blades the
/// exporter writes as ordinary nodes, which show as huge flat white shards in the inventory. The
/// material name opts in; this is not a rule that hides extra meshes.
pub fn hide_preview_only_meshes(data: &[u8]) -> Result<Vec<u8>, String> {
    let (json, bin) = read_glb(data)?;
    let materials = material_names(&json, |n| n.to_lowercase());
    Ok(hide_nodes(data, json.clone(), bin, |json, node| {
        let all = assigned(mesh_of(json, node), &materials);
        !all.is_empty() && all.iter().all(|m| landing_page_only(m))
    }))
}
