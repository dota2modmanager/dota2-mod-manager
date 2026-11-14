//! The particles an item or a hero shows on its loadout, read out of the game for the 3D preview,
//! and the attachment points they hang on, replacing src/particle-spec.ts. Answers are the JSON
//! the window gets.
//!
//! A particle system (.vpcf_c) is a KV3 tree: emitters, initializers, operators, renderers, the
//! control points and what drives them, and child systems; it goes to the window whole, with its
//! children's timing and its snapshots. A model's attachments are in its MDAT blocks.

use std::collections::HashMap;

use regex::bytes::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

use crate::js::{json_number, to_number, truthy};
use crate::kv::{self, latin1};
use crate::kv3::{self, Block, Node};
use crate::particle_snapshot::snapshot_points;
use crate::resource;

/// A KV3 node as plain JSON.
pub fn kv_json(kv: &Block, n: Option<&Node>) -> Value {
    let Some(n) = n else { return Value::Null };
    match &n.value {
        kv3::Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), kv_json(kv, Some(v)))).collect()),
        kv3::Value::Array { items, .. } => Value::Array(items.iter().map(|x| kv_json(kv, Some(x))).collect()),
        kv3::Value::Number { cell, ty, .. } => json_number(match cell {
            Some(c) => kv.read_cell(*c),
            None => (matches!(ty, 16 | 18 | 27) as u8) as f64,
        }),
        kv3::Value::Str(s) => Value::String(s.clone()),
        kv3::Value::Other { ty: 2, value } => Value::Bool(value.is_some_and(|v| v != 0)),
        kv3::Value::Other { ty: 13, .. } => Value::Bool(true),
        kv3::Value::Other { ty: 14, .. } => Value::Bool(false),
        _ => Value::Null,
    }
}

/// The DATA tree of a compiled resource, or None for one the reader cannot take.
pub fn data_tree(file: Option<&[u8]>) -> Option<Map<String, Value>> {
    let file = file?;
    if !resource::blocks(file).ok()?.iter().any(|b| b.name == "DATA") {
        return None;
    }
    let kv = kv3::read(resource::data_block(file).ok()?).ok()?;
    match kv_json(&kv, Some(&kv.root)) {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

fn compiled(p: &str) -> String {
    let p = p.to_lowercase().replace('\\', "/");
    match p.strip_suffix(".vpcf") {
        Some(stem) => format!("{stem}.vpcf_c"),
        None => p,
    }
}

/// An object's keys in JavaScript's order: array indices ascending, then the rest as they came.
fn js_key_order(keys: &[String]) -> Vec<String> {
    let index = |k: &String| k.parse::<u32>().ok().filter(|n| *n != u32::MAX && n.to_string() == *k);
    let mut ints: Vec<(u32, String)> = keys.iter().filter_map(|k| index(k).map(|n| (n, k.clone()))).collect();
    ints.sort_by_key(|(n, _)| *n);
    ints.into_iter().map(|(_, k)| k).chain(keys.iter().filter(|k| index(k).is_none()).cloned()).collect()
}

fn snapshot_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)\.vsnap(?:_c)?$").unwrap())
}

/// A system and its children, at most `budget` systems in all: a system with dozens of children
/// would cost the window more than its look is worth.
pub fn particle_def(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    path: &str,
    budget: &mut i64,
    depth: u32,
    inherited: &HashMap<String, Vec<Value>>,
) -> Option<Value> {
    if *budget <= 0 || depth > 12 {
        return None;
    }
    let tree = data_tree(read(&compiled(path)).as_deref())?;
    *budget -= 1;
    // a control point's number written as JavaScript writes it, as the key of its points
    let mut snapshots = inherited.clone();
    if let Some(snap) = tree.get("m_hSnapshot").and_then(Value::as_str).filter(|s| snapshot_re().is_match(s)) {
        let lower = snap.to_lowercase();
        let at = match lower.strip_suffix(".vsnap") {
            Some(stem) => format!("{stem}.vsnap_c"),
            None => lower,
        };
        let file = read(&at);
        if let (Some(file), Some(data)) = (file.as_deref(), data_tree(file.as_deref())) {
            if let Ok(points) = snapshot_points(file, &Value::Object(data)) {
                let cp = to_number(tree.get("m_nSnapshotControlPoint").filter(|v| !v.is_null()).unwrap_or(&json!(0)));
                snapshots.insert(crate::js::number(cp), points);
            }
        }
    }
    let mut used: Vec<(String, Vec<Value>)> = Vec::new();
    for key in ["m_Initializers", "m_Emitters", "m_Operators"] {
        for op in tree.get(key).and_then(Value::as_array).into_iter().flatten() {
            let Value::Object(op) = op else { continue };
            let num = |k: &str, or: f64| op.get(k).filter(|v| !v.is_null()).map_or(or, to_number);
            let cp = match op.get("_class").and_then(Value::as_str) {
                Some("C_INIT_InitSkinnedPositionFromCPSnapshot") => num("m_nSnapshotControlPointNumber", 1.0),
                Some("C_INIT_InitFromCPSnapshot") => num("m_nControlPointNumber", 0.0),
                Some("C_OP_InstantaneousEmitter") => num("m_nSnapshotControlPoint", -1.0),
                _ => -1.0,
            };
            let cp = crate::js::number(cp);
            if let Some(points) = snapshots.get(&cp).filter(|p| !p.is_empty()) {
                match used.iter_mut().find(|(k, _)| *k == cp) {
                    Some(u) => u.1 = points.clone(),
                    None => used.push((cp, points.clone())),
                }
            }
        }
    }
    let keys: Vec<String> = used.iter().map(|(k, _)| k.clone()).collect();
    let first = js_key_order(&keys).into_iter().next();
    let snapshot = first.and_then(|k| used.iter().find(|(u, _)| *u == k)).map(|(_, p)| p.clone());
    let mut children = Vec::new();
    for c in tree.get("m_Children").and_then(Value::as_array).into_iter().flatten() {
        let r = c.get("m_ChildRef").and_then(Value::as_str).unwrap_or("");
        if r.is_empty() || c.get("m_bDisableChild") == Some(&Value::Bool(true)) {
            continue;
        }
        let Some(Value::Object(mut child)) = particle_def(read, r, budget, depth + 1, &snapshots) else { continue };
        let group = c.get("m_nChildGroupID").filter(|v| !v.is_null()).map_or(0.0, to_number);
        child.insert("childGroup".into(), json_number(group));
        if let Some(delay) = c.get("m_flDelay").and_then(Value::as_f64) {
            child.insert("delay".into(), json_number(if delay > 0.0 { delay } else { 0.0 }));
        }
        if c.get("m_bEndCap") == Some(&Value::Bool(true)) {
            child.insert("endcap".into(), Value::Bool(true));
        }
        children.push(Value::Object(child));
    }
    let mut out = Map::new();
    out.insert("path".into(), Value::String(path.to_string()));
    out.insert("tree".into(), Value::Object(tree));
    out.insert("children".into(), Value::Array(children));
    if let Some(snapshot) = snapshot.filter(|s| !s.is_empty()) {
        out.insert("snapshot".into(), Value::Array(snapshot));
        out.insert("snapshots".into(), Value::Object(used.into_iter().map(|(k, p)| (k, Value::Array(p))).collect()));
    }
    Some(Value::Object(out))
}

fn texture_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)^materials/[A-Za-z0-9_/.\-]+\.vtex$").unwrap())
}

/// The textures a renderer draws its sprites with, as the game names them.
fn renderer_textures(r: &Map<String, Value>) -> Vec<String> {
    let one = [json!({ "m_hTexture": r.get("m_hTexture").cloned().unwrap_or(Value::Null) })];
    let layers: &[Value] = match r.get("m_vecTexturesInput") {
        Some(Value::Array(a)) => a,
        _ => &one,
    };
    layers
        .iter()
        .filter_map(|layer| {
            let Value::Object(layer) = layer else { return None };
            if layer.get("m_bEnabled") == Some(&Value::Bool(false))
                || layer.get("m_bReplaceTextureWithGradient") == Some(&Value::Bool(true))
            {
                return None;
            }
            layer.get("m_hTexture").and_then(Value::as_str).filter(|t| texture_re().is_match(t)).map(str::to_lowercase)
        })
        .collect()
}

/// Every texture a system and its children draw with, once each.
pub fn particle_textures(def: &Value) -> Vec<String> {
    fn walk(d: &Value, out: &mut indexmap::IndexSet<String>) {
        for r in d.get("tree").and_then(|t| t.get("m_Renderers")).and_then(Value::as_array).into_iter().flatten() {
            if let Value::Object(r) = r {
                out.extend(renderer_textures(r));
            }
        }
        for c in d.get("children").and_then(Value::as_array).into_iter().flatten() {
            walk(c, out);
        }
    }
    let mut out = indexmap::IndexSet::new();
    walk(def, &mut out);
    out.into_iter().collect()
}

const WS: &str = r"[\t\n\x0B\x0C\r \xA0]";

fn modifier_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(&format!(r#"(?i-u)"asset_modifier[0-9]*"{WS}*\{{([^{{}}]*)\}}"#)).unwrap())
}

fn field<'a>(body: &'a [u8], key: &str) -> Option<&'a [u8]> {
    static RES: OnceLock<std::sync::Mutex<HashMap<String, &'static Regex>>> = OnceLock::new();
    let re = *RES.get_or_init(Default::default).lock().unwrap().entry(key.to_string()).or_insert_with(|| {
        Box::leak(Box::new(Regex::new(&format!(r#"(?i-u)"{}"{WS}+"([^"]*)""#, regex::escape(key))).unwrap()))
    });
    re.captures(body).map(|c| c.get(1).unwrap().as_bytes())
}

fn particle_path_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i-u)^particles/[A-Za-z0-9_/.\-]+\.vpcf$").unwrap())
}

/// The particle_create systems an item block brings, for its first style.
pub fn item_particles(block: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    for m in modifier_re().captures_iter(block) {
        let body = m.get(1).unwrap().as_bytes();
        if !field(body, "type").unwrap_or(b"").eq_ignore_ascii_case(b"particle_create") {
            continue;
        }
        if field(body, "style").is_some_and(|s| !s.is_empty() && s != b"0") {
            continue;
        }
        if field(body, "dire_only") == Some(b"1")
            || field(body, "flying_courier_only") == Some(b"1")
            || field(body, "required_arcana_level").is_some_and(|v| !v.is_empty())
        {
            continue;
        }
        if let Some(p) = field(body, "modifier").filter(|p| particle_path_re().is_match(p)) {
            out.push(latin1(p).to_lowercase());
        }
    }
    out
}

fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
}

/// Economy control points laid over the root system's preview configuration: the effect's points
/// (an unusual's, as unusual_effects reads them) and its configuration `config_name`.
pub fn bind_item_particle(def: &Value, effect: Option<&Value>, config_name: &str) -> Value {
    let effect = effect.filter(|e| !e.is_null());
    if effect.is_none() && config_name.is_empty() {
        return def.clone();
    }
    let configs: Vec<&Map<String, Value>> = def
        .get("tree")
        .and_then(|t| t.get("m_controlPointConfigurations"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect();
    let want = if config_name.is_empty() { "preview" } else { config_name };
    let named = |n: &str| configs.iter().find(|c| str_of(c.get("m_name")) == Some(n)).copied();
    let config = named(want).or_else(|| named("preview")).or_else(|| configs.first().copied());
    if effect.is_none() && config.is_none() {
        return def.clone();
    }
    let mut drivers: Vec<Value> =
        config.and_then(|c| c.get("m_drivers")).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut points: Vec<(i64, Value)> = Vec::new();
    for p in effect.and_then(|e| e.get("points")).and_then(Value::as_array).into_iter().flatten() {
        let Some(i) = p.get("index").and_then(Value::as_f64).filter(|i| i.fract() == 0.0 && *i >= 0.0) else {
            continue;
        };
        match points.iter_mut().find(|(k, _)| *k == i as i64) {
            Some(x) => x.1 = p.clone(),
            None => points.push((i as i64, p.clone())),
        }
    }
    if let Some(e) = effect {
        let attach_type = str_of(e.get("attachType")).unwrap_or("");
        let on_point = attach_type.to_lowercase().contains("point");
        if !points.iter().any(|(k, _)| *k == 0)
            && (e.get("attachment").is_some_and(truthy) || (!attach_type.is_empty() && !on_point))
        {
            points.push((0, json!({ "index": 0, "attachType": e.get("attachType").cloned().unwrap_or(Value::Null), "attachment": e.get("attachment").filter(|a| !a.is_null()).cloned().unwrap_or(Value::Null) })));
        }
    }
    for (index, point) in points {
        if drivers.iter().any(|d| {
            d.as_object().is_some_and(|d| {
                d.get("m_iControlPoint").filter(|v| !v.is_null()).map_or(0.0, to_number) == index as f64
            })
        }) {
            continue;
        }
        let entity = point.get("entity").filter(|v| !v.is_null()).or_else(|| effect.and_then(|e| e.get("entity")));
        let attach = [point.get("attachType"), effect.and_then(|e| e.get("attachType"))]
            .into_iter()
            .flatten()
            .find(|v| truthy(v));
        let attach = attach.map(crate::js::string).unwrap_or_default().to_uppercase();
        let entity = str_of(entity).filter(|e| matches!(*e, "parent" | "self_with_wearables")).unwrap_or("self");
        drivers.push(json!({
            "m_iControlPoint": index,
            "m_iAttachType": attach,
            "m_attachmentName": point.get("attachment").filter(|v| !v.is_null()).cloned().unwrap_or(json!("")),
            "m_entityName": entity,
        }));
    }
    let mut out = def.clone();
    if let Some(Value::Object(tree)) = out.get_mut("tree") {
        tree.insert("m_controlPointConfigurations".into(), json!([{ "m_name": "preview", "m_drivers": drivers }]));
    }
    out
}

fn portrait_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(&format!(r#"(?i-u)"RenderablePortrait"{WS}*\{{"#)).unwrap())
}

/// The hero's own loadout particles, out of its script's RenderablePortrait block.
pub fn hero_loadout_particles(script: &[u8]) -> Result<Vec<String>, kv::KvError> {
    let Some(m) = portrait_re().find(script) else { return Ok(vec![]) };
    let mut bodies = Vec::new();
    kv::each_child(script, kv::block_bounds(script, m.end() - 1)?, |f| {
        if f.is_block() && f.key.eq_ignore_ascii_case(b"particles") {
            bodies.push(f.body.unwrap());
        }
        true
    })?;
    let mut out = Vec::new();
    for body in bodies {
        kv::each_child(script, body, |p| {
            if particle_path_re().is_match(p.key)
                && (p.is_block() || p.value.unwrap_or(b"").eq_ignore_ascii_case(b"loadout"))
            {
                out.push(latin1(p.key).to_lowercase());
            }
            true
        })?;
    }
    Ok(out)
}

/// Array.prototype.slice(0, end) on a list.
fn slice_to(a: &[Value], end: f64) -> Vec<Value> {
    let len = a.len() as f64;
    let end = if end.is_nan() { 0.0 } else { end.trunc() };
    let end = if end < 0.0 { (len + end).max(0.0) } else { end.min(len) };
    a[..end as usize].to_vec()
}

/// A model's attachment points: the bone each follows, and where it sits from it.
pub fn model_attachments(model: Option<&[u8]>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let Some(model) = model else { return out };
    let Ok(blocks) = resource::blocks(model) else { return out };
    let mdat = blocks.iter().filter(|b| b.name == "MDAT").count();
    for i in 0..mdat {
        let Some(tree) = resource::data(model, "MDAT", i)
            .ok()
            .and_then(|d| kv3::read(d).ok())
            .map(|kv| kv_json(&kv, Some(&kv.root)))
        else {
            continue;
        };
        for a in tree.get("m_attachments").and_then(Value::as_array).into_iter().flatten() {
            let Some(v) = a.get("value").filter(|v| truthy(v)) else { continue };
            let influences = v.get("m_influenceNames").and_then(Value::as_array);
            let bone = influences.and_then(|n| n.first()).filter(|b| truthy(b));
            let name = a.get("key").filter(|k| truthy(k)).or_else(|| v.get("m_name"));
            let (Some(Value::String(name)), Some(bone)) = (name, bone) else { continue };
            if out.iter().any(|x| x.get("name").and_then(Value::as_str) == Some(name)) {
                continue;
            }
            let first = |k: &str, or: Value| {
                v.get(k).and_then(Value::as_array).and_then(|l| l.first()).filter(|x| truthy(x)).cloned().unwrap_or(or)
            };
            let mut point = Map::new();
            point.insert("name".into(), json!(name));
            point.insert("bone".into(), bone.clone());
            point.insert("offset".into(), first("m_vInfluenceOffsets", json!([0, 0, 0])));
            point.insert("rotation".into(), first("m_vInfluenceRotations", json!([0, 0, 0, 1])));
            let count = v.get("m_nInfluences").filter(|n| !n.is_null()).map_or(1.0, to_number);
            point.insert("bones".into(), Value::Array(slice_to(influences.map(Vec::as_slice).unwrap_or(&[]), count)));
            for (to, from) in [
                ("offsets", "m_vInfluenceOffsets"),
                ("rotations", "m_vInfluenceRotations"),
                ("weights", "m_influenceWeights"),
            ] {
                if let Some(x) = v.get(from) {
                    point.insert(to.into(), x.clone());
                }
            }
            point.insert("ignoreRotation".into(), Value::Bool(v.get("m_bIgnoreRotation").is_some_and(truthy)));
            out.push(Value::Object(point));
        }
    }
    out
}
