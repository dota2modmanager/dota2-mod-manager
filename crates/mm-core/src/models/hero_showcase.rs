//! How the game stages a hero on its loadout, for the 3D preview:
//! the loadout camera (loadout_camera_fullbody's one keyframe), the hero's LoadoutScale, and its
//! light, ambient, background and pedestal from the hero's portrait entry: the loadout page's own
//! file (scripts/npc/portraits_full_body_loadout.txt) where it has the hero, else
//! portraits_showcase.txt. `lighting` carries that entry's numbers as the game writes them, in the
//! shape the viewer's applyLighting takes (vendor/dota-loadout/src/viewer.js).
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

/// A block's values, those of blocks inside it under "block/key" ("cameras/default/PortraitFOV").
fn fields_of(text: &[u8], body: kv::Bounds, prefix: &str, out: &mut HashMap<String, String>) -> bool {
    let mut ok = true;
    let walked = kv::each_child(text, body, |f| {
        let key = format!("{prefix}{}", kv::latin1(f.key));
        if let Some(v) = f.value {
            out.insert(key, kv::latin1(v));
        } else if let Some(inner) = f.body {
            ok = fields_of(text, inner, &format!("{key}/"), out);
        }
        ok
    });
    ok && walked.is_ok()
}

/// The fields of the first of `keys` that a portraits file has an entry for, or None.
pub fn showcase_entry(text: &[u8], keys: &[String]) -> Option<HashMap<String, String>> {
    let mut found: HashMap<String, HashMap<String, String>> = HashMap::new();
    let bounds = kv::block_bounds(text, 0).ok()?;
    let mut failed = false;
    kv::each_child(text, bounds, |c| {
        let Some(body) = c.body else { return true };
        let mut fields = HashMap::new();
        if !fields_of(text, body, "", &mut fields) {
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

/// The portraits file to stage a hero by: the loadout page's own, or the showcase one for a hero it lacks.
pub fn portraits(read: &dyn Fn(&str) -> Option<Vec<u8>>, keys: &[String]) -> Option<Vec<u8>> {
    ["scripts/npc/portraits_full_body_loadout.txt", "scripts/npc/portraits_showcase.txt"]
        .iter()
        .filter_map(|f| read(f))
        .find(|t| showcase_entry(t, keys).is_some())
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

/// The hero's size on its loadout: its LoadoutScale, else its ModelScale (Viper has only that).
fn loadout_scale(script: &[u8]) -> f64 {
    let s = kv::latin1(script);
    ["loadoutscale", "modelscale"].iter().find_map(|k| key_number(&s, k)).unwrap_or(1.0)
}

/// The first `"Key" "number"` of a script, its key given in lower case.
fn key_number(s: &str, key: &str) -> Option<f64> {
    let lower = s.to_ascii_lowercase();
    let quoted = format!("\"{key}\"");
    let mut from = 0;
    while let Some(at) = lower[from..].find(&quoted) {
        let rest = &s[from + at + quoted.len()..];
        let gap = rest.len() - rest.trim_start_matches(is_space).len();
        if gap > 0 {
            if let Some(body) = rest[gap..].strip_prefix('"') {
                let digits: String = body.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                if !digits.is_empty() && body[digits.len()..].starts_with('"') {
                    return Some(or_one(num(&digits)));
                }
            }
        }
        from += at + 1;
    }
    None
}

fn is_model_path(m: &str) -> bool {
    let lower = m.to_ascii_lowercase();
    lower.strip_prefix("models/").and_then(|r| r.strip_suffix(".vmdl")).is_some_and(|mid| {
        !mid.is_empty() && mid.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'/' | b'.' | b'-'))
    })
}

/// The stage for a hero: `showcase` is the portraits file, `script` the hero's script, `keys`
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
    // the game's own numbers for the viewer: the loadout page's camera first (its hero window is
    // DOTAUIEconSetPreview), then the portrait's default one
    let cam = |k: &str| get(&format!("cameras/econ_set_preview/{k}")).or_else(|| get(&format!("cameras/default/{k}")));
    let lighting = match (vec3(get("PortraitLightAngles")), vec3(get("PortraitLightColor"))) {
        (Some(angles), Some(color)) => json!({
            "light": { "angles": arr(angles), "color": arr(color), "scale": json_number(or_one(get("PortraitLightScale").map_or(f64::NAN, num))) },
            "ambient": {
                "angles": arr(ambient_angles.unwrap_or([-27.0, -114.0, 24.0])),
                "color": arr(vec3(get("PortraitAmbientColor")).unwrap_or([79.0, 93.0, 93.0])),
                "scale": json_number(or_one(get("PortraitAmbientScale").map_or(f64::NAN, num))),
            },
            "shadow": {
                "color": arr(vec3(get("PortraitShadowColor")).unwrap_or([56.0, 56.0, 56.0])),
                "scale": json_number(or_one(get("PortraitShadowScale").map_or(f64::NAN, num))),
            },
            "camera": {
                "position": vec3(cam("PortraitPosition")).map_or(Value::Null, arr),
                "angles": vec3(cam("PortraitAngles")).map_or(Value::Null, arr),
                "fov": cam("PortraitFOV").map(num).filter(|f| f.is_finite() && *f > 0.0).map_or(Value::Null, |f| json!(json_number(f))),
            },
        }),
        _ => Value::Null,
    };
    json!({
        "lighting": lighting,
        "scale": json_number(scale),
        "camera": arr(to_glb(LOADOUT_CAMERA, METRE)),
        "key": key,
        "ambient": ambient,
        "background": bg.map_or(Value::Null, arr),
        "pedestal": if is_model_path(model) { json!(model.to_lowercase()) } else { Value::Null },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENTRY: &str = r#""Portraits"
{
	"npc_dota_hero_tidehunter"
	{
		"PortraitLightAngles"		"55.38 143.89 0"
		"PortraitLightColor"		"234 243 254"
		"PortraitLightScale"		"1.45"
		"PortraitAmbientDirection"		"-27.23 -113.79 24.22"
		"PortraitShadowColor"		"56 56 56"
		"PortraitShadowScale"		"5"
		"cameras"
		{
			"default" { "PortraitFOV"		"22.5" }
			"econ_set_preview"
			{
				"PortraitPosition"		"955.45 -294.56 57"
				"PortraitFOV"		"15"
			}
		}
	}
}"#;

    #[test]
    fn a_hero_without_a_loadout_scale_stands_at_its_model_scale() {
        assert_eq!(
            loadout_scale(
                b"\"ModelScale\"		\"0.740000\"
\"SpectatorLoadoutScale\" \"0.65\""
            ),
            0.74
        );
        assert_eq!(
            loadout_scale(
                b"\"ModelScale\" \"0.81\"
\"LoadoutScale\" \"0.9\""
            ),
            0.9
        );
        assert_eq!(loadout_scale(b""), 1.0);
    }

    #[test]
    fn the_loadout_camera_and_light_reach_the_stage() {
        let keys = ["npc_dota_hero_tidehunter".to_string()];
        let e = showcase_entry(ENTRY.as_bytes(), &keys).unwrap();
        assert_eq!(e.get("cameras/econ_set_preview/PortraitFOV").map(String::as_str), Some("15"));
        let stage = hero_stage(Some(ENTRY.as_bytes()), None, &keys);
        let l = &stage["lighting"];
        assert_eq!(l["camera"]["fov"], json!(15));
        assert_eq!(l["camera"]["position"], json!([955.45, -294.56, 57]));
        assert_eq!(l["light"]["scale"], json!(1.45));
        assert_eq!(l["shadow"]["scale"], json!(5));
        // no light in the entry: the viewer keeps its own
        assert!(hero_stage(Some(b"\"P\" { \"x\" { \"a\" \"1\" } }"), None, &["x".into()])["lighting"].is_null());
    }
}
