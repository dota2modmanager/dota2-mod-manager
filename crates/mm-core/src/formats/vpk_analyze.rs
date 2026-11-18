//! What a mod changes, read from the paths inside it: which heroes, which equip slots, or which
//! kind of content, and a name for it. Replacing src/vpk-analyze.ts, which says at length why each
//! rule is there.

use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::OnceLock;

use crate::data;
use crate::hero_names::{display_name, key};
use crate::i18n::t;

/// A hero a mod touches: the equip slots it replaces, whether it swaps the base model, how many models it carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeroHit {
    pub id: String,
    pub name: String,
    pub slots: Vec<String>,
    pub base: bool,
    pub models: usize,
}

/// What a mod's paths say it changes; see analyze_vpk_paths.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub heroes: Vec<HeroHit>,
    pub kind: String,
    pub path_count: usize,
}

/// keyword found in a model filename token -> canonical equip slot
const SLOT_KEYWORDS: &[(&str, &str)] = &[
    ("shoulder", "shoulder"),
    ("pauldron", "shoulder"),
    ("helmet", "head"),
    ("helm", "head"),
    ("head", "head"),
    ("hood", "head"),
    ("mask", "head"),
    ("hair", "head"),
    ("face", "head"),
    ("hat", "head"),
    ("crown", "head"),
    ("horn", "head"),
    ("weapon", "weapon"),
    ("sword", "weapon"),
    ("blade", "weapon"),
    ("staff", "weapon"),
    ("bow", "weapon"),
    ("axe", "weapon"),
    ("hammer", "weapon"),
    ("scythe", "weapon"),
    ("offhand", "offhand"),
    ("shield", "shield"),
    ("bracer", "arms"),
    ("glove", "arms"),
    ("hand", "arms"),
    ("arm", "arms"),
    ("shoulders", "shoulder"),
    ("belt", "belt"),
    ("waist", "belt"),
    ("cape", "back"),
    ("cloak", "back"),
    ("back", "back"),
    ("wing", "wings"),
    ("tail", "tail"),
    ("skirt", "legs"),
    ("leg", "legs"),
    ("boot", "legs"),
    ("feet", "legs"),
    ("foot", "legs"),
    ("mount", "mount"),
    ("armor", "armor"),
    ("ambient", "ambient"),
];

fn slot_display(slot: &str) -> Option<&'static str> {
    Some(match slot {
        "head" => "голова",
        "weapon" => "оружие",
        "offhand" => "оружие (2)",
        "shield" => "щит",
        "armor" => "броня",
        "shoulder" => "плечи",
        "belt" => "пояс",
        "arms" => "руки",
        "back" => "спина",
        "wings" => "крылья",
        "tail" => "хвост",
        "legs" => "ноги",
        "mount" => "ездовое",
        "ambient" => "эффекты",
        "misc" => "разное",
        "base" => "модель",
        _ => return None,
    })
}

/// An equip slot as the user reads it, in their language.
pub fn slot_display_name(slot: &str) -> String {
    t(slot_display(slot).unwrap_or(slot), &[])
}

fn re(slot: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    slot.get_or_init(|| Regex::new(pattern).unwrap())
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())
}

fn slot_from_model_stem(hero: &str, stem: &str) -> String {
    if stem == hero || all_digits(stem) {
        return "base".into(); // bare hero name or "1.vmdl" = base body override
    }
    let tok = stem.strip_prefix(&format!("{hero}_")).unwrap_or(stem);
    static TAIL: OnceLock<Regex> = OnceLock::new();
    let tok = re(&TAIL, r"_(lod\d+|c|model|hero|full|default|\d+)$").replace(tok, "").into_owned();
    static BASE: OnceLock<Regex> = OnceLock::new();
    if tok.is_empty() || all_digits(&tok) || re(&BASE, r"(^|_)(base|body|model)$").is_match(&tok) {
        return "base".into();
    }
    // the last token is what the piece IS ("transmuted_armaments_back" is a back item)
    let last = tok.rsplit('_').next().unwrap_or("").to_string();
    for part in [last.as_str(), tok.as_str()] {
        for &(kw, slot) in SLOT_KEYWORDS {
            if part.contains(kw) {
                return slot.into();
            }
        }
    }
    "misc".into()
}

/// folder names that sit where a hero name would but are not one
const NON_HERO_FOLDER: &[&str] = &[
    "misc",
    "common",
    "shared",
    "econ",
    "items",
    "generic",
    "ui",
    "props",
    "weather",
    "ambient",
    "effects",
    "base",
    "default",
    "error",
    "test",
    "consumables",
    "consumable",
    "courier",
    "couriers",
    "ward",
    "wards",
    "creeps",
    "creep",
    "towers",
    "tower",
    "neutral",
    "neutrals",
    "roshan",
    "pedestal",
    "pedestals",
    "taunts",
    "taunt",
    "emblems",
    "emblem",
    "sprays",
    "loadingscreens",
    "loadingscreen",
    "announcer",
    "music",
    "hud",
    "terrain",
    "chests",
    "chest",
    "bundles",
    "bundle",
    "tools",
    "dev",
    "nomodel",
];

fn is_hero_folder(f: &str) -> bool {
    !NON_HERO_FOLDER.contains(&f)
}

struct Hit {
    slots: IndexSet<String>,
    base: bool,
    models: usize,
}

fn hit<'a>(heroes: &'a mut IndexMap<String, Hit>, id: &str) -> &'a mut Hit {
    heroes.entry(id.to_string()).or_insert_with(|| Hit { slots: IndexSet::new(), base: false, models: 0 })
}

fn stem_of(rest: &str) -> &str {
    let rest = rest.strip_suffix(".vmdl_c").unwrap_or(rest);
    rest.rsplit('/').next().unwrap_or("")
}

/// The first of these patterns that matches, with its first two groups.
fn first_match<'a>(p: &'a str, patterns: &[&Regex]) -> Option<(&'a str, &'a str)> {
    patterns
        .iter()
        .find_map(|r| r.captures(p))
        .map(|c| (c.get(1).map_or("", |m| m.as_str()), c.get(2).map_or("", |m| m.as_str())))
}

/// Classify what a mod's inner path list actually changes. `paths`: lowercased inner VPK paths.
pub fn analyze_vpk_paths(paths: &[String]) -> Analysis {
    static HERO_MODEL: OnceLock<Regex> = OnceLock::new();
    static HERO_PARTICLE: OnceLock<Regex> = OnceLock::new();
    static ITEM_MODEL: OnceLock<Regex> = OnceLock::new();
    static ITEM_MATERIAL: OnceLock<Regex> = OnceLock::new();
    static ECON_PARTICLE: OnceLock<Regex> = OnceLock::new();
    static CART_MODEL: OnceLock<Regex> = OnceLock::new();
    static CART_PARTICLE: OnceLock<Regex> = OnceLock::new();
    let hero_model = re(&HERO_MODEL, r"^models/heroes/([a-z0-9_]+)/(.+)$");
    let hero_particle = re(&HERO_PARTICLE, r"^particles/units/heroes/hero_([a-z0-9_]+)/");
    let item_model = re(&ITEM_MODEL, r"^models/items/([a-z0-9_]+)/(.+)$");
    let item_material = re(&ITEM_MATERIAL, r"^materials/models/(?:heroes|items)/([a-z0-9_]+)/");
    let econ_particle = re(&ECON_PARTICLE, r"^particles/econ/items/([a-z0-9_]+)/");
    let cart_model = re(&CART_MODEL, r"^\d{3,}/heroes/([a-z0-9_]+)/(.+)$");
    let cart_particle = re(&CART_PARTICLE, r"^\d{3,}/particles/([a-z0-9_]+)/");

    let mut heroes: IndexMap<String, Hit> = IndexMap::new();
    for p in paths {
        let p = p.as_str();
        if let Some((id, rest)) = first_match(p, &[hero_model, cart_model]) {
            if is_hero_folder(id) {
                let h = hit(&mut heroes, id);
                if p.ends_with(".vmdl_c") {
                    let slot = slot_from_model_stem(id, stem_of(rest));
                    if slot == "base" {
                        h.base = true;
                    } else {
                        h.slots.insert(slot);
                    }
                    h.models += 1;
                }
                continue;
            }
        }
        // a cosmetic item: never a base override, so it adds a slot and never sets `base`
        if let Some((id, rest)) = first_match(p, &[item_model]) {
            if is_hero_folder(id) {
                let h = hit(&mut heroes, id);
                if p.ends_with(".vmdl_c") {
                    h.slots.insert(slot_from_model_stem(id, stem_of(rest)));
                    h.models += 1;
                }
                continue;
            }
        }
        if let Some((id, _)) = first_match(p, &[hero_particle, cart_particle, econ_particle, item_material]) {
            if is_hero_folder(id) {
                hit(&mut heroes, id);
            }
        }
    }
    // several spellings of one hero merge, keeping the id the app has a proper name for
    let named = |id: &str| {
        let canon = data::hero_alias().get(id).filter(|a| !a.is_empty()).map_or(id, String::as_str);
        data::hero_display().get(canon).is_some_and(|n| !n.is_empty())
    };
    let mut by_key: IndexMap<String, HeroHit> = IndexMap::new();
    for (id, v) in &heroes {
        let cur = by_key.entry(key(id)).or_insert_with(|| HeroHit {
            id: id.clone(),
            name: display_name(id),
            slots: vec![],
            base: false,
            models: 0,
        });
        if named(id) && !named(&cur.id) {
            cur.id = id.clone();
            cur.name = display_name(id);
        }
        for s in &v.slots {
            if !cur.slots.contains(s) {
                cur.slots.push(s.clone());
            }
        }
        cur.base = cur.base || v.base;
        cur.models += v.models;
    }
    let mut list: Vec<HeroHit> = by_key.into_values().collect();
    list.sort_by(|a, b| b.models.cmp(&a.models).then_with(|| crate::js::locale_compare(&a.name, &b.name)));

    static WARD: OnceLock<Regex> = OnceLock::new();
    let ward = re(&WARD, r"(^|/)ward|models/props_gameplay/.*ward");
    let kind = if !list.is_empty() {
        "hero"
    } else if paths.iter().any(|p| ward.is_match(p)) {
        "wards"
    } else if paths.iter().any(|p| p.starts_with("particles/econ/courier") || p.contains("/courier")) {
        "courier"
    } else if paths.iter().any(|p| p.starts_with("panorama/")) {
        "ui"
    } else if paths.iter().any(|p| p.starts_with("sounds/")) {
        "sounds"
    } else if paths.iter().any(|p| p.starts_with("maps/")) {
        "terrain"
    } else {
        "other"
    };
    Analysis { heroes: list, kind: kind.into(), path_count: paths.len() }
}

/// Human one-liner for a single detected hero, e.g. "Nyx Assassin (model, weapon)".
pub fn describe_hero(h: &HeroHit) -> String {
    let mut parts: Vec<String> = Vec::new();
    if h.base {
        parts.push(t("модель", &[]));
    }
    parts.extend(h.slots.iter().map(|s| slot_display_name(s)));
    if parts.is_empty() && h.models == 0 {
        parts.push(t("перекраска", &[]));
    }
    if parts.is_empty() {
        h.name.clone()
    } else {
        format!("{} ({})", h.name, parts.join(", "))
    }
}

/// The heroes a mod is actually about, as opposed to the ones it merely touches: a hero it
/// carries no model for is not the subject, nor is one it carries a quarter of the leader's
/// models for (a prop borrowed from another hero).
pub fn subject_heroes(a: &Analysis) -> Vec<HeroHit> {
    let carried: Vec<&HeroHit> = a.heroes.iter().filter(|h| h.models > 0 || h.base).collect();
    if carried.len() < 2 {
        return if carried.is_empty() { a.heroes.clone() } else { carried.into_iter().cloned().collect() };
    }
    let top = carried.iter().map(|h| h.models).max().unwrap_or(0);
    let main: Vec<&HeroHit> = carried.iter().copied().filter(|h| h.base || h.models * 4 >= top).collect();
    if main.is_empty() { carried } else { main }.into_iter().cloned().collect()
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "wards" => "варды",
        "courier" => "курьер",
        "ui" => "интерфейс",
        "sounds" => "звуки",
        "terrain" => "террейн",
        _ => "",
    }
}

/// Human summary of a whole analysis: hero skins, or a coarse content kind.
pub fn describe_analysis(a: &Analysis) -> String {
    let heroes = subject_heroes(a);
    if !heroes.is_empty() {
        return heroes.iter().map(describe_hero).collect::<Vec<_>>().join("; ");
    }
    t(kind_label(&a.kind), &[])
}

fn kind_name(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "wards" => "Варды",
        "courier" => "Курьер",
        "ui" => "Интерфейс меню",
        "sounds" => "Звуки",
        "terrain" => "Ландшафт",
        _ => return None,
    })
}

/// A short display name for a mod from its analysis: a hero, a few, a pack, or a content kind;
/// None if the content is not recognisable enough to name.
pub fn name_from_analysis(a: &Analysis) -> Option<String> {
    let heroes = subject_heroes(a);
    match heroes.len() {
        1 => Some(heroes[0].name.clone()),
        2 | 3 => Some(heroes.iter().map(|h| h.name.as_str()).collect::<Vec<_>>().join(", ")),
        0 => kind_name(&a.kind).map(|k| t(k, &[])),
        n => Some(t("Сборка · {0} героев", &[json!(n)])),
    }
}
