//! An effect of the game changed by hand: its size, how many particles it makes, how long they
//! live, how fast they leave, and its colour; replacing src/effect-edit.ts.
//!
//! Each of these is a handful of numbers in a particle system's KV3 tree. A number in the file is
//! either plain, or a parameter that says how it is made, and a literal or a random range can be
//! scaled while the rest (a value read from a control point, a curve) is left alone. Colour takes
//! the chosen hue and saturation and keeps each colour's brightness, and a drawn sprite's picture
//! comes in as grey (the renderer's desaturation), so the chosen colour is the one that shows.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::js::to_number;
use crate::kv3::{self, Block, Node, Value};
use crate::resource;

/// One system's changes, in percent of what the file says; what is left out stays.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EffectEdit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub life: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<String>,
}

/// A whole effect's changes, by system path. `WHOLE` holds what goes on every system of it.
pub type EffectEdits = IndexMap<String, EffectEdit>;

/// The key of the changes that go on every system.
pub const WHOLE: &str = "*";
pub const MIN_SCALE: f64 = 10.0;
pub const MAX_SCALE: f64 = 300.0;
/// What a burst makes when its file says nothing.
const BURST: f64 = 100.0;

fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

fn path_of(p: &str) -> String {
    let p = p.to_lowercase().replace('\\', "/");
    match p.strip_suffix(".vpcf_c") {
        Some(stem) => format!("{stem}.vpcf"),
        None => p,
    }
}

fn is_system_path(p: &str) -> bool {
    let word = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'/' | b'.' | b'-');
    p.strip_prefix("particles/")
        .and_then(|r| r.strip_suffix(".vpcf"))
        .is_some_and(|mid| !mid.is_empty() && mid.bytes().all(word))
}

/// What the window sent: known fields, values in range, nothing that changes nothing.
pub fn clean_edits(raw: &Json) -> EffectEdits {
    let mut out = EffectEdits::new();
    let Json::Object(raw) = raw else { return out };
    for (key, value) in raw.iter().take(64) {
        let Json::Object(value) = value else { continue };
        if key != WHOLE && !is_system_path(&path_of(key)) {
            continue;
        }
        let mut e = EffectEdit::default();
        for (name, slot) in
            [("size", &mut e.size), ("count", &mut e.count), ("life", &mut e.life), ("speed", &mut e.speed)]
        {
            let given = value.get(name).filter(|v| !v.is_null()).map_or(100.0, to_number);
            // clamp, as Math.max and Math.min, carries NaN through
            let v = (round(given / 5.0) * 5.0).clamp(MIN_SCALE, MAX_SCALE);
            if v.is_finite() && v != 100.0 {
                *slot = Some(v);
            }
        }
        if let Some(t) = value.get("tint").and_then(Json::as_str) {
            if t.len() == 7 && t.starts_with('#') && t[1..].bytes().all(|c| c.is_ascii_hexdigit()) {
                e.tint = Some(t.to_lowercase());
            }
        }
        if e != EffectEdit::default() {
            out.insert(if key == WHOLE { WHOLE.to_string() } else { path_of(key) }, e);
        }
    }
    out
}

fn class_of(n: &Node) -> &str {
    n.get("_class").and_then(Node::as_str).unwrap_or("")
}

fn made(v: f64, whole: bool) -> Result<Node, String> {
    let raw = if whole {
        let r = round(v);
        if !(-2147483648.0..=2147483647.0).contains(&r) {
            return Err(format!("effect: {r} does not fit an int32"));
        }
        (r as i32).to_le_bytes().to_vec()
    } else {
        v.to_le_bytes().to_vec()
    };
    Ok(Node::new(Value::Number { ty: if whole { 11 } else { 5 }, cell: None, type_at: None, raw: Some(raw) }))
}

/// A number set where it lies when it fits there, or made anew.
fn put(kv: &mut Block, node: &mut Node, v: f64, whole: bool) -> Result<(), String> {
    let cell = match &node.value {
        Value::Number { cell, .. } => *cell,
        _ => None,
    };
    match cell {
        Some(c) if c.float || c.width >= 4 => {
            kv.write_cell(c, if whole { round(v) } else { v }).map_err(|e| e.to_string())
        }
        _ => {
            *node = made(v, whole)?;
            Ok(())
        }
    }
}

fn num(kv: &Block, n: &Node) -> f64 {
    kv.number_of(n).unwrap_or(0.0)
}

/// One field of an object scaled: a plain number, or a parameter that is a literal or a random range.
fn scale(kv: &mut Block, holder: Option<&mut Node>, key: &str, k: f64) -> Result<bool, String> {
    let Some(n) = holder.and_then(|h| h.get_mut(key)) else { return Ok(false) };
    let whole = key.starts_with("m_n");
    if matches!(n.value, Value::Number { .. }) {
        let v = num(kv, n) * k;
        put(kv, n, v, whole)?;
        return Ok(true);
    }
    if !matches!(n.value, Value::Object(_)) {
        return Ok(false);
    }
    // a parameter without a type written is a literal
    let kind = n.get("m_nType").and_then(Node::as_str).unwrap_or("PF_TYPE_LITERAL").to_string();
    match kind.as_str() {
        "PF_TYPE_LITERAL" => scale(kv, Some(n), "m_flLiteralValue", k),
        "PF_TYPE_RANDOM_UNIFORM" => {
            let a = scale(kv, Some(n), "m_flRandomMin", k)?;
            let b = scale(kv, Some(n), "m_flRandomMax", k)?;
            Ok(a || b)
        }
        _ => Ok(false),
    }
}

/// A vector of numbers scaled, the speed a noise or a local velocity rolls.
fn scale_vector(kv: &mut Block, n: Option<&mut Node>, k: f64) -> Result<bool, String> {
    let Some(Node { value: Value::Array { items, .. }, .. }) = n else { return Ok(false) };
    for x in items.iter_mut() {
        if matches!(x.value, Value::Number { .. }) {
            let v = num(kv, x) * k;
            put(kv, x, v, false)?;
        }
    }
    Ok(true)
}

fn hex(h: &str) -> [f64; 3] {
    [1, 3, 5].map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0) as f64)
}

/// A colour array moved to `rgb`, each keeping its own brightness.
fn tint(kv: &mut Block, n: Option<&mut Node>, rgb: [f64; 3]) -> Result<bool, String> {
    let Some(Node { value: Value::Array { items, .. }, .. }) = n else { return Ok(false) };
    if items.len() < 3 || items[..3].iter().any(|c| !matches!(c.value, Value::Number { .. })) {
        return Ok(false);
    }
    let old: Vec<f64> = items[..3].iter().map(|c| num(kv, c)).collect();
    let bright = old.iter().fold(f64::NEG_INFINITY, |a, b| a.max(*b)) / 255.0;
    let top = rgb.iter().fold(1.0f64, |a, b| a.max(*b));
    for (i, c) in items[..3].iter_mut().enumerate() {
        put(kv, c, round(rgb[i] / top * 255.0 * bright).min(255.0), true)?;
    }
    Ok(true)
}

/// A parameter of the file that is this number.
fn literal(v: f64) -> Result<Node, String> {
    let mut m = IndexMap::new();
    m.insert("m_nType".to_string(), Node::new(Value::Str("PF_TYPE_LITERAL".into())));
    m.insert("m_flLiteralValue".to_string(), made(v, false)?);
    Ok(Node::new(Value::Object(m)))
}

fn list_mut<'a>(root: &'a mut Node, key: &str) -> &'a mut [Node] {
    match root.get_mut(key).map(|n| &mut n.value) {
        Some(Value::Array { items, .. }) => items,
        _ => &mut [],
    }
}

fn pct(v: Option<f64>) -> Option<f64> {
    v.filter(|v| *v != 0.0 && !v.is_nan()).map(|v| v / 100.0)
}

/// The changes on one system's tree, made in place; whether any field took one.
pub fn edit_tree(kv: &mut Block, edit: &EffectEdit) -> Result<bool, String> {
    if !matches!(kv.root.value, Value::Object(_)) {
        return Ok(false);
    }
    let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Other { ty: 1, value: None }));
    let result = edit_root(kv, &mut root, edit);
    kv.root = root;
    result
}

fn edit_root(kv: &mut Block, root: &mut Node, edit: &EffectEdit) -> Result<bool, String> {
    let mut did = false;
    let fields = |kv: &mut Block,
                  root: &mut Node,
                  list: &str,
                  class: &dyn Fn(&str) -> bool,
                  keys: &[&str],
                  k: f64|
     -> Result<bool, String> {
        let mut any = false;
        for n in list_mut(root, list) {
            if class(class_of(n)) {
                for key in keys {
                    any |= scale(kv, Some(n), key, k)?;
                }
            }
        }
        Ok(any)
    };
    if let Some(k) = pct(edit.size) {
        did |= scale(kv, Some(root), "m_flConstantRadius", k)?;
        did |= fields(
            kv,
            root,
            "m_Initializers",
            &|c| c == "C_INIT_RandomRadius",
            &["m_flRadiusMin", "m_flRadiusMax"],
            k,
        )?;
    }
    if let Some(k) = pct(edit.count) {
        did |= scale(kv, Some(root), "m_nMaxParticles", k)?;
        did |= scale(kv, Some(root), "m_nInitialParticles", k)?;
        did |= fields(kv, root, "m_Emitters", &|c| c == "C_OP_ContinuousEmitter", &["m_flEmitRate"], k)?;
        did |= fields(kv, root, "m_Emitters", &|c| c == "C_OP_InstantaneousEmitter", &["m_nParticlesToEmit"], k)?;
        // a burst with no number written is the engine's default of a hundred, and only a number
        // written can change it
        for n in list_mut(root, "m_Emitters") {
            if class_of(n) != "C_OP_InstantaneousEmitter" {
                continue;
            }
            if let Value::Object(m) = &mut n.value {
                if !m.contains_key("m_nParticlesToEmit") {
                    m.insert("m_nParticlesToEmit".into(), literal(BURST * k)?);
                    did = true;
                }
            }
        }
    }
    if let Some(k) = pct(edit.life) {
        did |= scale(kv, Some(root), "m_flConstantLifespan", k)?;
        did |= fields(
            kv,
            root,
            "m_Initializers",
            &|c| c == "C_INIT_RandomLifeTime",
            &["m_fLifetimeMin", "m_fLifetimeMax"],
            k,
        )?;
    }
    if let Some(k) = pct(edit.speed) {
        let spheres = |c: &str| {
            c.starts_with("C_INIT_CreateWithinSphere") || c == "C_INIT_CreateOnModel" || c == "C_INIT_RingWave"
        };
        did |= fields(
            kv,
            root,
            "m_Initializers",
            &spheres,
            &["m_fSpeedMin", "m_fSpeedMax", "m_flInitialSpeedMin", "m_flInitialSpeedMax"],
            k,
        )?;
        for n in list_mut(root, "m_Initializers") {
            let c = class_of(n);
            if !["C_INIT_InitialVelocityNoise", "C_INIT_VelocityRandom", "C_INIT_CreateWithinSphere"]
                .iter()
                .any(|p| c.starts_with(p))
            {
                continue;
            }
            for key in [
                "m_vecOutputMin",
                "m_vecOutputMax",
                "m_LocalCoordinateSystemSpeedMin",
                "m_LocalCoordinateSystemSpeedMax",
            ] {
                did |= scale_vector(kv, n.get_mut(key), k)?;
            }
        }
    }
    if let Some(t) = edit.tint.as_deref().filter(|t| !t.is_empty()) {
        let rgb = hex(t);
        did |= tint(kv, root.get_mut("m_ConstantColor"), rgb)?;
        for list in ["m_Initializers", "m_Operators"] {
            for n in list_mut(root, list) {
                match class_of(n) {
                    "C_INIT_RandomColor" => {
                        did |= tint(kv, n.get_mut("m_ColorMin"), rgb)?;
                        did |= tint(kv, n.get_mut("m_ColorMax"), rgb)?;
                    }
                    "C_OP_ColorInterpolate" => did |= tint(kv, n.get_mut("m_ColorFade"), rgb)?,
                    _ => {}
                }
            }
        }
        // a system with no colour of its own is white, and white takes no hue
        if let Value::Object(m) = &mut root.value {
            if !m.contains_key("m_ConstantColor") {
                let items =
                    [rgb[0], rgb[1], rgb[2], 255.0].iter().map(|v| made(*v, true)).collect::<Result<Vec<_>, _>>()?;
                m.insert("m_ConstantColor".into(), Node::new(Value::Array { items, element: None, ty: 0 }));
                did = true;
            }
        }
        for r in list_mut(root, "m_Renderers") {
            if !matches!(
                class_of(r),
                "C_OP_RenderSprites" | "C_OP_RenderTrails" | "C_OP_RenderRopes" | "C_OP_RenderSpriteTrail"
            ) {
                continue;
            }
            if let Value::Object(m) = &mut r.value {
                m.insert("m_flDesaturation".into(), literal(1.0)?);
                did = true;
            }
        }
    }
    Ok(did)
}

/// The changes that fall on one system: those on the whole effect, then on each system above it,
/// then its own.
fn falling(edits: &EffectEdits, chain: &[String]) -> Option<EffectEdit> {
    let layers: Vec<&EffectEdit> = std::iter::once(WHOLE.to_string())
        .chain(chain.iter().map(|c| path_of(c)))
        .filter_map(|k| edits.get(&k))
        .collect();
    let mut v = [100.0f64; 4];
    for e in &layers {
        for (n, x) in v.iter_mut().zip([e.size, e.count, e.life, e.speed]) {
            *n *= x.unwrap_or(100.0) / 100.0;
        }
    }
    let pick = |n: f64| (round(n) != 100.0).then(|| round(n));
    let mut out = EffectEdit { size: pick(v[0]), count: pick(v[1]), life: pick(v[2]), speed: pick(v[3]), tint: None };
    out.tint = layers.iter().rev().find_map(|e| e.tint.clone().filter(|t| !t.is_empty()));
    (out != EffectEdit::default()).then_some(out)
}

/// The paths of a system and all under it, each once, root first, with how deep each is.
pub fn systems_of(read: &mut dyn FnMut(&str) -> Option<Vec<u8>>, root: &str) -> Vec<(String, usize)> {
    fn walk(
        read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
        path: &str,
        depth: usize,
        seen: &mut HashSet<String>,
        out: &mut Vec<(String, usize)>,
    ) {
        let p = path_of(path);
        if seen.contains(&p) || seen.len() >= 60 || depth > 5 {
            return;
        }
        seen.insert(p.clone());
        let Some(bytes) = read(&format!("{p}_c")) else { return };
        out.push((p, depth));
        let Some(kv) = resource::data(&bytes, "DATA", 0).ok().and_then(|d| kv3::read(d).ok()) else { return };
        for c in kv.root.get("m_Children").map(Node::items).unwrap_or(&[]) {
            if let Some(r) = c.get("m_ChildRef").and_then(Node::as_str).filter(|r| !r.is_empty()) {
                walk(read, r, depth + 1, seen, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(read, root, 0, &mut HashSet::new(), &mut out);
    out
}

/// The changed files of an effect, under the paths they have in the game, as (path, bytes).
pub fn edited_entries(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    root: &str,
    edits: &EffectEdits,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    let mut chain: Vec<String> = Vec::new();
    for (path, depth) in systems_of(read, root) {
        chain.truncate(depth);
        chain.push(path.clone());
        let Some(edit) = falling(edits, &chain) else { continue };
        let Some(bytes) = read(&format!("{path}_c")) else { continue };
        let mut kv =
            kv3::read(resource::data(&bytes, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if edit_tree(&mut kv, &edit)? {
            let next = kv3::write(&kv).map_err(|e| e.to_string())?;
            out.push((format!("{path}_c"), resource::replace(&bytes, "DATA", 0, &next).map_err(|e| e.to_string())?));
        }
    }
    Ok(out)
}
