//! The in-game HUD laid out by hand (src/hud-scale.ts, issue #420): which panels the window offers,
//! what it sent cleaned into values in range, and the CSS that goes at the end of the HUD's style.

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::js::{round, to_number, SPACE_CLASS};

pub const STYLE: &str = "panorama/styles/hud/hud_reborn.vcss_c";
/// The same stylesheet as the compiler's source in an addon.
pub const SOURCE: &str = "panorama/styles/hud/hud_reborn.css";
pub const MIN_SCALE: f64 = 60.0;
pub const MAX_SCALE: f64 = 130.0;
/// How far a panel can be moved, in the HUD's own pixels (the screen is 1080 high to it).
pub const MAX_SHIFT: f64 = 1920.0;

/// The panels the window offers, by id in the HUD's layout (renderer/catalog/hud/parts.ts draws them).
pub const PARTS: [&str; 11] = [
    "topbar",
    "minimap_container",
    "lower_hud",
    "PortraitGroup",
    "stats_container",
    "abilities",
    "health_mana",
    "inventory",
    "shop_launcher_block",
    "combat_events",
    "HudChat",
];

/// A scale the window sent, as a whole step in range; 100 for anything else.
pub fn clamp_scale(n: &Value) -> f64 {
    let v = to_number(n);
    if !v.is_finite() {
        return 100.0;
    }
    (round(v / 5.0) * 5.0).clamp(MIN_SCALE, MAX_SCALE)
}

fn or_100(v: Option<&Value>) -> Value {
    match v {
        None | Some(Value::Null) => json!(100),
        Some(x) => x.clone(),
    }
}

/// What the window sent, as panels this knows, values in range and defaults dropped; a panel sent
/// twice keeps its first place and its last values.
pub fn clean_parts(raw: &Value) -> Vec<Value> {
    let Some(list) = raw.as_array() else { return vec![] };
    let colour = Regex::new("^#[0-9a-fA-F]{6}$").expect("a fixed pattern");
    let mut out: IndexMap<String, Value> = IndexMap::new();
    for r in list {
        let Some(id) = r.get("id").and_then(Value::as_str).filter(|id| PARTS.contains(id)) else { continue };
        let mut p = Map::new();
        p.insert("id".into(), json!(id));
        let scale = clamp_scale(&or_100(r.get("scale")));
        if scale != 100.0 {
            p.insert("scale".into(), crate::js::json_number(scale));
        }
        for k in ["x", "y"] {
            let n = r.get(k).map_or(f64::NAN, to_number);
            let v = round(if n.is_nan() { 0.0 } else { n });
            if v != 0.0 {
                p.insert(k.into(), crate::js::json_number(v.clamp(-MAX_SHIFT, MAX_SHIFT)));
            }
        }
        let o = round(to_number(&or_100(r.get("opacity"))) / 5.0) * 5.0;
        let opacity = (if o.is_nan() { 0.0 } else { o }).clamp(10.0, 100.0);
        if opacity != 100.0 {
            p.insert("opacity".into(), crate::js::json_number(opacity));
        }
        if let Some(tint) = r.get("tint").and_then(Value::as_str) {
            if colour.is_match(tint) {
                p.insert("tint".into(), json!(tint.to_lowercase()));
            }
        }
        if r.get("hidden") == Some(&Value::Bool(true)) {
            p.insert("hidden".into(), json!(true));
        }
        if p.len() > 1 {
            out.insert(id.to_string(), Value::Object(p));
        }
    }
    out.into_values().collect()
}

/// The layout an older record meant by its one scale: the bottom bar and the minimap.
pub fn parts_of_scale(scale: &Value) -> Vec<Value> {
    clean_parts(&json!([{ "id": "lower_hud", "scale": scale }, { "id": "minimap_container", "scale": scale }]))
}

const MARK: &str = "/* d2mm: HUD scale */";

fn num(p: &Value, k: &str) -> f64 {
    p.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}

/// One panel's rule, and a second where the flipped HUD would take its offset away: the panel's
/// parent is mirrored there, so the same offset lands mirrored on the other side.
fn rule_of(p: &Value) -> String {
    let id = p["id"].as_str().unwrap_or("");
    let (x, y) = (num(p, "x"), num(p, "y"));
    let shift = format!("translateX({}px) translateY({}px)", crate::js::number(x), crate::js::number(y));
    let mut lines: Vec<String> = Vec::new();
    if p.get("hidden") == Some(&Value::Bool(true)) {
        lines.push("visibility: collapse;".into());
    }
    if num(p, "scale") != 0.0 {
        lines.push(format!("ui-scale: {}%;", crate::js::number(num(p, "scale"))));
    }
    if x != 0.0 || y != 0.0 {
        lines.push(format!("transform: {shift};"));
    }
    if num(p, "opacity") != 0.0 {
        lines.push(format!("opacity: {};", crate::js::number(num(p, "opacity") / 100.0)));
    }
    if let Some(tint) = p.get("tint").and_then(Value::as_str).filter(|t| !t.is_empty()) {
        lines.push(format!("wash-color: {tint};"));
    }
    let body: Vec<String> = lines.iter().map(|l| format!("\t{l}")).collect();
    let rule = format!("#{id}\n{{\n{}\n}}\n", body.join("\n"));
    if (x == 0.0 && y == 0.0) || !["lower_hud", "minimap_container"].contains(&id) {
        return rule;
    }
    format!("{rule}\n.HUDFlipped #{id}\n{{\n\ttransform: {shift} scaleX(-1);\n}}\n")
}

/// The CSS read out of the style, with the layout at its end. A viewer's banner comment goes, and
/// rules this added before are replaced rather than stacked.
pub fn with_layout(css: &str, raw: &Value) -> String {
    let banner = Regex::new(&format!(r"^{SPACE_CLASS}*/\*[^\n]*Source 2 Viewer[^\n]*\*/{SPACE_CLASS}*"))
        .expect("a fixed pattern");
    let own = banner.replace(css, "");
    let base = match own.find(MARK) {
        Some(at) => &own[..at],
        None => &own,
    };
    let base = base.trim_end_matches(crate::js::is_space);
    let rules: Vec<String> = clean_parts(raw).iter().map(rule_of).collect();
    format!("{base}\n\n{MARK}\n{}", rules.join("\n"))
}
