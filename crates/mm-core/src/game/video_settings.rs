//! The player's video settings, for the 3D previews to draw what their Dota draws.
//!
//! Dota keeps them per Steam account in userdata/<account>/570/local/cfg/video.txt, a KeyValues
//! block of `"setting.<convar>" "<value>"` pairs: shadows (cl_globallight_shadow_mode), shine
//! (r_deferred_specular), wind on trees (r_dota_allow_wind_on_trees), grass (r_grass_quality),
//! cheap water (dota_cheap_water) and the rest of the options screen. Read only, never written.

use std::path::Path;

use serde_json::{Map, Value};

/// The settings of the account signed in to Steam, convar name to value ("true" and "false" as
/// booleans, numbers as numbers); None when there is no account or no file.
pub fn video_settings(game: Option<&Path>) -> Option<Map<String, Value>> {
    let account = crate::gamelang::steam_account_dir(game)?;
    let bytes = std::fs::read(account.join("570").join("local").join("cfg").join("video.txt")).ok()?;
    let parsed = parse(&String::from_utf8_lossy(&bytes));
    (!parsed.is_empty()).then_some(parsed)
}

/// The `"setting.<name>" "<value>"` pairs of a video.txt, by name.
pub fn parse(text: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for line in text.lines() {
        let quoted: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
        let [key, value] = quoted[..] else { continue };
        let Some(name) = key.strip_prefix("setting.") else { continue };
        let v = match value {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => value
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map_or_else(|| Value::String(value.into()), Value::Number),
        };
        out.insert(name.to_string(), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_video_txt_reads_as_its_convars() {
        let text = "\"video.cfg\"\n{\n\t\"setting.r_deferred_specular\"\t\t\"false\"\n\t\"setting.cl_globallight_shadow_mode\"\t\t\"2\"\n\t\"setting.mat_viewportscale\"\t\t\"0.994231\"\n\t\"Version\"\t\t\"0\"\n\t\"setting.odd\"\t\t\"low\"\n}\n";
        let v = parse(text);
        assert_eq!(v["r_deferred_specular"], Value::Bool(false));
        assert_eq!(v["cl_globallight_shadow_mode"], serde_json::json!(2.0));
        assert_eq!(v["mat_viewportscale"], serde_json::json!(0.994231));
        assert_eq!(v["odd"], Value::String("low".into()));
        assert!(!v.contains_key("Version"));
    }
}
