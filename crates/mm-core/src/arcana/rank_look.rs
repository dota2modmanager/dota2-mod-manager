//! The rank medal and the Dota Plus hero levels the player sees on their own screen
//! (src/rank-look.ts): a medal and stars of their choosing, and a level from 1 to 30 for any hero.
//!
//! The medal is a picture a style puts on a panel by class, so the two styles that carry those
//! rules are read back as CSS and get a copy of each rule with the chosen picture at the end. A
//! level is a number the client asks Steam for, so a script writes it into the label every frame:
//! it goes into the layouts LAYOUTS lists as one include in their LaCo tree.

use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::kv3::{Node, Value as Kv};

/// A medal: the tier (0 not calibrated, 8 Immortal), the stars of tiers 1 to 7, and an Immortal's
/// leaderboard place (0, 5000, 100 or 10).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Medal {
    pub tier: u32,
    pub stars: u32,
    pub top: u32,
}

/// What the player picked: a medal or the game's own, a level per hero, and one for every hero not named.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RankLook {
    pub medal: Option<Medal>,
    pub levels: IndexMap<String, u32>,
    pub every: Option<u32>,
}

/// The two styles that hold the medal's rules, as (compiled in the pak, the compiler's source).
pub const STYLES: [(&str, &str); 2] = [
    ("panorama/styles/dotastyles.vcss_c", "panorama/styles/dotastyles.css"),
    ("panorama/styles/avatar_rank_tier.vcss_c", "panorama/styles/avatar_rank_tier.css"),
];
/// The layouts the levels script goes into.
pub const LAYOUTS: [&str; 8] = [
    "panorama/layout/hero_grid_new.vxml_c",
    "panorama/layout/hud/dota_hud_hero_picking_player.vxml_c",
    "panorama/layout/hud/dota_hud_pregame.vxml_c",
    "panorama/layout/dashboard_page_hero_new_v2.vxml_c",
    "panorama/layout/tooltips/tooltip_hero_card.vxml_c",
    "panorama/layout/hud/hud_reborn.vxml_c",
    "panorama/layout/hud/dota_hud_top_bar_player.vxml_c",
    "panorama/layout/hud/dota_hud_inspect.vxml_c",
];
/// The script, as the compiler's source, compiled, and as the layouts name it.
pub const SCRIPT_SOURCE: &str = "panorama/scripts/d2mm_rank_look.js";
pub const SCRIPT_COMPILED: &str = "panorama/scripts/d2mm_rank_look.vjs_c";
pub const SCRIPT_REF: &str = "panorama/scripts/d2mm_rank_look.vjs";

/// The badge tiers in order, as the game's classes name them.
pub const TIERS: [&str; 6] = ["BronzeTier", "SilverTier", "GoldTier", "PlatinumTier", "MasterTier", "GrandmasterTier"];
/// The first level of each tier: bronze 1-5, silver 6-11, gold 12-17, platinum 18-24, master
/// 25-29, grandmaster 30 alone (#549).
pub const TIER_FROM: [f64; 6] = [1.0, 6.0, 12.0, 18.0, 25.0, 30.0];

/// The tier a level earns, 0 (bronze) to 5 (grandmaster).
pub fn tier_of(level: f64) -> usize {
    TIER_FROM.iter().filter(|&&from| level >= from).count().saturating_sub(1)
}

fn hero_ok(h: &str) -> bool {
    Regex::new(r"^[a-z0-9_]{2,40}$").expect("a fixed pattern").is_match(h)
}

fn whole(v: Option<&Value>, lo: f64, hi: f64) -> Option<u32> {
    let n = v.map_or(f64::NAN, crate::js::to_number);
    (n.fract() == 0.0 && n.is_finite() && n >= lo && n <= hi).then_some(n as u32)
}

/// What the window sent, kept to what the game has: tiers 0 to 8, stars 1 to 5, levels 1 to 30.
pub fn clamp_look(raw: &Value) -> RankLook {
    let r = raw.as_object();
    let field = |k: &str| r.and_then(|o| o.get(k));
    // typeof [] is 'object' too: an array's fields are all undefined
    let m = field("medal").filter(|m| m.is_object() || m.is_array());
    let mf = |k: &str| m.and_then(|m| m.get(k));
    let tier = m.and_then(|_| whole(mf("tier"), 0.0, 8.0));
    let top = m.map(|_| mf("top").map_or(f64::NAN, crate::js::to_number)).filter(|t| [5000.0, 100.0, 10.0].contains(t));
    let medal = tier.map(|tier| Medal {
        tier,
        stars: whole(mf("stars"), 1.0, 5.0).unwrap_or(1),
        top: if tier == 8 { top.map_or(0, |t| t as u32) } else { 0 },
    });
    let mut levels = IndexMap::new();
    // an array is an object too, its indexes its keys
    let given: Vec<(String, &Value)> = match field("levels") {
        Some(Value::Object(o)) => crate::js::keys(o).into_iter().map(|k| (k.clone(), &o[k])).collect(),
        Some(Value::Array(a)) => a.iter().enumerate().map(|(i, v)| (i.to_string(), v)).collect(),
        _ => vec![],
    };
    for (hero, v) in given {
        if let Some(n) = whole(Some(v), 1.0, 30.0).filter(|_| hero_ok(&hero)) {
            levels.insert(hero, n);
        }
    }
    RankLook { medal, levels, every: whole(field("every"), 1.0, 30.0) }
}

/// Whether there is anything to build.
pub fn look_is_empty(look: &RankLook) -> bool {
    look.medal.is_none() && look.every.is_none() && look.levels.is_empty()
}

/// The medal's picture, as the rules name one; `mini` for a rule that draws it small.
pub fn medal_image(m: &Medal, mini: bool) -> String {
    let small = if mini { "_mini" } else { "" };
    let name = match (m.tier, m.top) {
        (8, 5000) => format!("rank8a{small}_psd"),
        (8, 100) => format!("rank8b{small}_psd"),
        (8, 10) => format!("rank8c{small}_psd"),
        (8, t) if t != 0 => format!("rank8undefined{small}_psd"),
        _ => format!("{}rank{}_psd", if mini { "mini/" } else { "" }, m.tier),
    };
    format!("s2r://panorama/images/rank_tier_icons/{name}.vtex")
}

const MARK: &str = "/* d2mm: rank medal */";

/// The CSS read out of a style, with the medal's rules at its end: every rule that puts a medal
/// on, copied with the chosen one, and every rule that puts stars on, copied with the chosen
/// stars (none for tiers 0 and 8). The tool's banner goes, and rules this added before are
/// replaced rather than stacked.
pub fn with_medal(css: &str, medal: &Medal) -> String {
    let sp = crate::js::SPACE_CLASS;
    let banner = Regex::new(&format!(r"^{sp}*/\*[^\n]*Source 2 Viewer[^\n]*\*/{sp}*")).expect("a fixed pattern");
    let own = banner.replace(css, "");
    let base = match own.find(MARK) {
        Some(at) => &own[..at],
        None => &own[..],
    };
    let base = base.trim_end_matches(crate::js::is_space);
    let medal_url = Regex::new(r"rank_tier_icons/(?:mini/)?rank[0-9]").expect("a fixed pattern");
    let pip_url = Regex::new(r"rank_tier_icons/pip[0-9]").expect("a fixed pattern");
    let small = Regex::new(r"rank_tier_icons/mini/|_mini_psd|\.Minimal").expect("a fixed pattern");
    let pip_class = Regex::new(r"\.RankPipImage(?-u:\b)").expect("a fixed pattern");
    let rule = Regex::new(r"([^{}]+)\{([^{}]*)\}").expect("a fixed pattern");
    let stars = (1..=7).contains(&medal.tier);
    let mut out: Vec<String> = Vec::new();
    for m in rule.captures_iter(base) {
        let sel = crate::js::trim(&m[1]);
        let body = &m[2];
        if sel.starts_with('@') || sel.contains("/*") {
            continue;
        }
        if medal_url.is_match(body) {
            let mini = small.is_match(sel) || small.is_match(body);
            out.push(format!("{sel}\n{{\n\tbackground-image: url(\"{}\");\n}}", medal_image(medal, mini)));
        } else if pip_url.is_match(body) || pip_class.is_match(sel) {
            // every rule on the stars, the one that hides them for an uncalibrated rank too
            let what = if stars {
                format!(
                    "background-image: url(\"s2r://panorama/images/rank_tier_icons/pip{}_psd.vtex\");\n\tvisibility: visible;",
                    medal.stars
                )
            } else {
                "visibility: collapse;".to_string()
            };
            out.push(format!("{sel}\n{{\n\t{what}\n}}"));
        }
    }
    format!("{base}\n\n{MARK}\n{}\n", out.join("\n\n"))
}

fn str_node(s: &str) -> Node {
    Node::new(Kv::Str(s.to_string()))
}

fn obj(members: Vec<(&str, Node)>) -> Node {
    Node::new(Kv::Object(members.into_iter().map(|(k, v)| (k.to_string(), v)).collect()))
}

/// Whether any node under this one names `r`.
fn names(n: &Node, r: &str) -> bool {
    match &n.value {
        Kv::Str(s) => s == r,
        Kv::Object(m) => m.values().any(|v| names(v, r)),
        Kv::Array { items, .. } => items.iter().any(|v| names(v, r)),
        _ => false,
    }
}

/// Whether the script's include can be put into this layout: an older compile keeps no tree in a LaCo block.
pub fn takes_script(layout: &[u8]) -> bool {
    crate::resource::blocks(layout).is_ok_and(|b| b.iter().any(|b| b.name == "LaCo"))
}

/// A compiled layout that also includes the script: one SCRIPTS node in front of its panel. A
/// layout that has it already is left as it is.
pub fn with_script(layout: &[u8]) -> Result<Vec<u8>, String> {
    let laco = crate::resource::data(layout, "LaCo", 0).map_err(|e| e.0)?;
    let mut kv = crate::kv3::read(laco).map_err(|e| e.0)?;
    let root = kv.root.get_mut("m_AST").and_then(|a| a.get_mut("m_pRoot"));
    let Some(root) = root.filter(|r| matches!(r.value, Kv::Object(_))) else {
        return Err("layout without a tree".into());
    };
    if names(root, SCRIPT_REF) {
        return Ok(layout.to_vec());
    }
    let node = obj(vec![
        ("eType", str_node("SCRIPTS")),
        (
            "child",
            obj(vec![
                ("eType", str_node("INCLUDE")),
                ("child", obj(vec![("eType", str_node("REFERENCE_COMPILED")), ("name", str_node(SCRIPT_REF))])),
            ]),
        ),
    ]);
    let list = crate::menu_background::children(root);
    let panel = list.iter().position(|c| c.get("eType").and_then(Node::as_str) == Some("PANEL"));
    let at = panel.unwrap_or(list.len());
    list.insert(at, node);
    let next = crate::kv3::write(&kv).map_err(|e| e.0)?;
    crate::resource::replace(layout, "LaCo", 0, &next).map_err(|e| e.0)
}

/// The levels script after its first lines (src/rank-look-script.ts). Checked out with Windows
/// line ends on Windows, and the script is written with Unix ones.
const SCRIPT_BODY: &str = include_str!("rank_look_script.js");

/// The script and the layouts it goes into, as a short mark: a record whose mark differs is built
/// again at start. The TypeScript's (a hash of its function's source); the parity test holds the
/// two together, and a change to the script changes it.
pub const SCRIPT_MARK: &str = "6ce930a463bd";

/// The script the layouts include, with the player's levels and medal in it. `ids` names the
/// chosen heroes by the number the game gives them.
pub fn levels_script(look: &RankLook, ids: &std::collections::BTreeMap<u32, String>) -> String {
    let rank = match &look.medal {
        Some(m) => {
            let stars = if (1..=7).contains(&m.tier) {
                format!(" + $.Localize(\"#DOTARankPipsName{}\")", m.stars)
            } else {
                String::new()
            };
            format!("$.Localize(\"#DOTARankTierName{}\"){stars}", m.tier)
        }
        None => "null".into(),
    };
    let levels: serde_json::Map<String, Value> =
        look.levels.iter().map(|(k, v)| (k.clone(), Value::from(*v))).collect();
    let ids: serde_json::Map<String, Value> =
        ids.iter().map(|(k, v)| (k.to_string(), Value::from(v.clone()))).collect();
    let every = look.every.map_or("null".to_string(), |e| e.to_string());
    format!(
        "\"use strict\";\nvar D2MM_LEVELS = {};\nvar D2MM_EVERY = {every};\nvar D2MM_IDS = {};\nvar D2MM_RANK = {rank};\nvar D2MM_TIERS = {};\nvar D2MM_TIER_FROM = {};\n{}",
        crate::js::stringify(&Value::Object(levels), ""),
        crate::js::stringify(&Value::Object(ids), ""),
        crate::js::stringify(&serde_json::json!(TIERS), ""),
        crate::js::stringify(&serde_json::json!(TIER_FROM), ""),
        SCRIPT_BODY.replace("\r\n", "\n"),
    )
}
