//! How the game stages a hero on its loadout, for the 3D preview, replacing src/hero-showcase.ts:
//! the loadout camera (loadout_camera_fullbody's one keyframe), the hero's LoadoutScale, and its
//! light, ambient, background and pedestal from scripts/npc/portraits_showcase.txt.
//!
//! Positions and directions go to the window in the GLB's space: Source's (x forward, y left, z up,
//! inches) turned into (y, z, x) metres.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::js::{json_number, to_number};
use crate::kv;

/// Inches to the GLB's metres.
const METRE: f64 = 0.0254;
/// The loadout camera, in Source units.
pub const LOADOUT_CAMERA: [f64; 3] = [668.17529, 0.0, 79.86814];

pub type Vec3 = [f64; 3];

/// A point or direction in Source's axes, in the GLB's.
pub fn to_glb([x, y, z]: Vec3, scale: f64) -> Vec3 {
    [y * scale, z * scale, x * scale]
}

/// What JavaScript's \s takes in a latin1 string.
fn is_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ' | '\u{a0}' | '\u{feff}')
}

fn num(s: &str) -> f64 {
    to_number(&Value::String(s.to_string()))
}

fn numbers(s: Option<&str>) -> Vec<f64> {
    let s = s.unwrap_or("").trim_matches(is_space);
    // "".split(/\s+/) is one empty piece, and Number("") is 0
    s.split(is_space).filter(|p| !p.is_empty() || s.is_empty()).map(num).filter(|n| n.is_finite()).collect()
}

fn vec3(s: Option<&str>) -> Option<Vec3> {
    let n = numbers(s);
    (n.len() >= 3).then(|| [n[0], n[1], n[2]])
}

fn unit(v: Vec3) -> Vec3 {
    let l = crate::js::hypot(&v);
    let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
    [v[0] / l, v[1] / l, v[2] / l]
}

/// The way Source angles (pitch down, yaw, roll) look. V8 takes its sines from glibc, so the last
/// bit can differ from the window's on a rare angle: a light direction does not see it.
pub fn forward(angles: Vec3) -> Vec3 {
    let (p, y) = (angles[0] * std::f64::consts::PI / 180.0, angles[1] * std::f64::consts::PI / 180.0);
    [libm::cos(p) * libm::cos(y), libm::cos(p) * libm::sin(y), -libm::sin(p)]
}

fn path_key(k: &str) -> String {
    k.to_lowercase().replace('\\', "/")
}

/// The fields of the first of `keys` that portraits_showcase.txt has an entry for, or None.
pub fn showcase_entry(text: &[u8], keys: &[String]) -> Option<HashMap<String, String>> {
    let mut found: HashMap<String, HashMap<String, String>> = HashMap::new();
    let bounds = kv::block_bounds(text, 0).ok()?;
    let mut failed = false;
    kv::each_child(text, bounds, |c| {
        let Some(body) = c.body else { return true };
        let mut fields = HashMap::new();
        if kv::each_child(text, body, |f| {
            if let Some(v) = f.value {
                fields.insert(kv::latin1(f.key), kv::latin1(v));
            }
            true
        })
        .is_err()
        {
            failed = true;
            return false;
        }
        found.insert(path_key(&kv::latin1(c.key)), fields);
        true
    })
    .ok()?;
    if failed {
        return None;
    }
    keys.iter().find_map(|k| found.remove(&path_key(k)))
}

fn or_one(v: f64) -> f64 {
    if v == 0.0 || v.is_nan() {
        1.0
    } else {
        v
    }
}

fn arr(v: Vec3) -> Value {
    json!(v.iter().map(|x| json_number(*x)).collect::<Vec<_>>())
}

fn loadout_scale(script: &[u8]) -> f64 {
    let s = kv::latin1(script);
    let lower = s.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("\"loadoutscale\"") {
        let rest = &s[from + at + 14..];
        let gap = rest.len() - rest.trim_start_matches(is_space).len();
        if gap > 0 {
            if let Some(body) = rest[gap..].strip_prefix('"') {
                let digits: String = body.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                if !digits.is_empty() && body[digits.len()..].starts_with('"') {
                    return or_one(num(&digits));
                }
            }
        }
        from += at + 1;
    }
    1.0
}

fn is_model_path(m: &str) -> bool {
    let lower = m.to_ascii_lowercase();
    lower.strip_prefix("models/").and_then(|r| r.strip_suffix(".vmdl")).is_some_and(|mid| {
        !mid.is_empty() && mid.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'/' | b'.' | b'-'))
    })
}

/// The stage for a hero: `showcase` is portraits_showcase.txt, `script` the hero's script, `keys`
/// the entries to look for, the most particular first.
pub fn hero_stage(showcase: Option<&[u8]>, script: Option<&[u8]>, keys: &[String]) -> Value {
    let scale = loadout_scale(script.unwrap_or(b""));
    let e = showcase.and_then(|s| showcase_entry(s, keys));
    let get = |k: &str| e.as_ref().and_then(|e| e.get(k)).map(String::as_str);
    let rgb =
        |k: &str, mult: f64| vec3(get(k)).map(|n| [n[0] / 255.0 * mult, n[1] / 255.0 * mult, n[2] / 255.0 * mult]);
    let light_at = vec3(get("PortraitLightPosition"));
    let key_color = rgb("PortraitLightColor", or_one(get("PortraitLightScale").map_or(f64::NAN, num)));
    let ambient_angles = vec3(get("PortraitAmbientDirection"));
    let ambient_color = rgb("PortraitAmbientColor", or_one(get("PortraitAmbientScale").map_or(f64::NAN, num)));
    let bg = vec3(get("PortraitBackgroundColor1"));
    let model = get("PortraitBackgroundModel").unwrap_or("");
    let key = match (light_at, key_color) {
        // the light is aimed at the hero's middle, not its feet
        (Some(at), Some(c)) => json!({ "from": arr(to_glb(unit([at[0], at[1], at[2] - 80.0]), 1.0)), "color": arr(c) }),
        _ => Value::Null,
    };
    let ambient = match (ambient_angles, ambient_color) {
        // the ambient direction is where it shines; it comes from the other way
        (Some(a), Some(c)) => {
            let f = forward(a);
            json!({ "from": arr(to_glb([-f[0], -f[1], -f[2]], 1.0)), "color": arr(c) })
        }
        _ => Value::Null,
    };
    json!({
        "scale": json_number(scale),
        "camera": arr(to_glb(LOADOUT_CAMERA, METRE)),
        "key": key,
        "ambient": ambient,
        "background": bg.map_or(Value::Null, arr),
        "pedestal": if is_model_path(model) { json!(model.to_lowercase()) } else { Value::Null },
    })
}
