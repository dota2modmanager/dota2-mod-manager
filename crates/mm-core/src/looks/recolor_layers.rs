//! A hero in colours of the user's choosing, part by part (src/recolor-layers.ts, issue #422):
//! each ability's effect and its icon, the hero's other effects, his icons and portrait, his body,
//! and the effects and models of the items picked for him. Each part is a layer with its own
//! colour and switch.
//!
//! What belongs to an ability is read off the game's file names: Valve names an ability's
//! particles after it, and its icon is panorama/images/spellicons/<ability>_png.vtex_c. The
//! ability list is the hero's script. Particles no ability claims are the hero's other effects.

use std::collections::HashSet;

use regex::Regex;
use serde::Serialize;

use crate::recolor::{shade, Rgb};

/// One part of a hero that takes a colour of its own.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecolorLayer {
    /// `ability:<name>`, `abilityIcon:<name>`, `effects`, `portrait`, `body`, `item:<id>`, `itemModel:<id>`
    pub id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// the game's files the layer rewrites, in pak01
    pub files: Vec<String>,
}

/// An item the hero wears: the particles its visuals name, and its model's colour textures.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct WornItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub particles: Vec<String>,
    #[serde(default)]
    pub textures: Option<Vec<String>>,
}

fn re(p: &str) -> Regex {
    Regex::new(p).expect("a fixed pattern")
}

/// The hero's abilities, in his script's order, once each; an Ability Draft copy (invoker_emp_ad)
/// goes with its ability. A talent or a placeholder slot is no ability.
pub fn hero_abilities(script: &str) -> Vec<String> {
    let ability = re(&format!(r#""Ability[0-9]+"{}+"([a-z0-9_]+)""#, crate::js::SPACE_CLASS));
    let not = re(r"^(special_bonus_|generic_hidden|.*_empty[0-9]*$|dota_empty_ability)");
    let mut out: Vec<String> = Vec::new();
    for c in ability.captures_iter(script) {
        let a = c[1].to_string();
        if !not.is_match(&a) && !out.contains(&a) {
            out.push(a);
        }
    }
    let all = out.clone();
    out.retain(|a| !(a.ends_with("_ad") && all.iter().any(|b| b == &a[..a.len() - 3])));
    out
}

/// The folder of the hero's model in his script (`juggernaut` for models/heroes/juggernaut/...).
pub fn hero_model_folder(script: &str) -> Option<String> {
    let model = re(&format!(r#"(?i)"Model"{}+"models/heroes/([a-z0-9_]+)/"#, crate::js::SPACE_CLASS));
    model.captures(script).map(|c| c[1].to_lowercase())
}

fn flat(s: &str) -> String {
    s.replace('_', "")
}

fn base(p: &str) -> &str {
    let name = &p[p.rfind('/').map_or(0, |i| i + 1)..];
    name.strip_suffix(".vpcf_c").unwrap_or(name)
}

/// The folder a hero's own particles are in: hero_<npc name>, or the few that are not.
pub fn hero_particle_folder<'a>(paths: impl IntoIterator<Item = &'a str>, hero: &str) -> String {
    let named = match hero {
        "drow_ranger" => Some("drow"),
        "naga_siren" => Some("siren"),
        "vengefulspirit" => Some("vengeful"),
        _ => None,
    };
    if let Some(n) = named {
        return format!("particles/units/heroes/hero_{n}/");
    }
    let want = [format!("particles/units/heroes/hero_{hero}/"), format!("particles/units/heroes/hero_{}/", flat(hero))];
    for p in paths {
        for w in &want {
            if p.starts_with(w.as_str()) {
                return w.clone();
            }
        }
    }
    want[0].clone()
}

/// Whether a particle's name says it belongs to an ability: by the whole name, or by what follows
/// the hero's, when that part is long enough not to turn up in others' names.
fn claims(ability: &str, hero: &str, particle: &str) -> bool {
    let name = flat(base(particle));
    if name.starts_with(&flat(ability)) {
        return true;
    }
    let short = ability.strip_prefix(&format!("{hero}_")).map(flat).unwrap_or_default();
    let fh = flat(hero);
    let rest = name.strip_prefix(&fh).unwrap_or(&name);
    short.chars().count() >= 6 && rest.contains(&short)
}

/// The layers a hero has, from the paths in pak01. A layer with no files is left out.
pub fn hero_layers(
    paths: &[&str],
    hero: &str,
    abilities: &[String],
    items: &[WornItem],
    model: Option<&str>,
) -> Vec<RecolorLayer> {
    let folder = hero_particle_folder(paths.iter().copied(), hero);
    let own: Vec<&str> = paths.iter().copied().filter(|p| p.starts_with(&folder) && p.ends_with(".vpcf_c")).collect();
    let mut claimed: HashSet<&str> = HashSet::new();
    let mut layers: Vec<RecolorLayer> = Vec::new();
    // the longest name first, so juggernaut_omni_slash_scepter would not go to an omni_slash
    let mut longest: Vec<&String> = abilities.iter().collect();
    longest.sort_by_key(|a| std::cmp::Reverse(a.encode_utf16().count()));
    for ability in longest {
        let files: Vec<&str> =
            own.iter().copied().filter(|p| !claimed.contains(p) && claims(ability, hero, p)).collect();
        claimed.extend(files.iter().copied());
        if !files.is_empty() {
            layers.push(RecolorLayer {
                id: format!("ability:{ability}"),
                kind: "ability",
                name: Some(ability.clone()),
                files: files.into_iter().map(String::from).collect(),
            });
        }
    }
    let at = |n: &Option<String>| abilities.iter().position(|a| Some(a) == n.as_ref()).map_or(-1, |i| i as i64);
    layers.sort_by_key(|l| at(&l.name));
    let rest: Vec<String> = own.iter().filter(|p| !claimed.contains(*p)).map(|p| p.to_string()).collect();
    if !rest.is_empty() {
        layers.push(RecolorLayer { id: "effects".into(), kind: "effects", name: None, files: rest });
    }
    let present: HashSet<&str> = paths.iter().copied().collect();
    for ability in abilities {
        let icon = format!("panorama/images/spellicons/{ability}_png.vtex_c");
        if present.contains(icon.as_str()) {
            layers.push(RecolorLayer {
                id: format!("abilityIcon:{ability}"),
                kind: "abilityIcon",
                name: Some(ability.clone()),
                files: vec![icon],
            });
        }
    }
    let pictures: Vec<String> = ["heroes", "heroes/icons", "heroes/selection"]
        .iter()
        .map(|d| format!("panorama/images/{d}/npc_dota_hero_{hero}_png.vtex_c"))
        .filter(|p| present.contains(p.as_str()))
        .collect();
    if !pictures.is_empty() {
        layers.push(RecolorLayer { id: "portrait".into(), kind: "portrait", name: None, files: pictures });
    }
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        let dir = format!("materials/models/heroes/{model}/");
        let color = re(r"_color_(psd|tga|png)_[0-9a-f]+\.vtex_c$");
        let body: Vec<String> = paths
            .iter()
            .filter(|p| p.starts_with(&dir) && !p[dir.len()..].contains('/') && color.is_match(p))
            .map(|p| p.to_string())
            .collect();
        if !body.is_empty() {
            layers.push(RecolorLayer { id: "body".into(), kind: "body", name: None, files: body });
        }
    }
    let unique = |v: Vec<String>| {
        let mut out: Vec<String> = Vec::new();
        for x in v {
            if !out.contains(&x) {
                out.push(x);
            }
        }
        out
    };
    for item in items {
        let files: Vec<String> = item
            .particles
            .iter()
            .map(|p| {
                let p = p.to_lowercase();
                match p.strip_suffix(".vpcf") {
                    Some(s) => format!("{s}.vpcf_c"),
                    None => p,
                }
            })
            .filter(|p| present.contains(p.as_str()))
            .collect();
        if !files.is_empty() {
            layers.push(RecolorLayer {
                id: format!("item:{}", item.id),
                kind: "item",
                name: Some(item.name.clone()),
                files: unique(files),
            });
        }
        // after the body's: an item's own colour wins over the body's on a texture they share
        let textures: Vec<String> =
            item.textures.iter().flatten().filter(|p| present.contains(p.as_str())).cloned().collect();
        if !textures.is_empty() {
            layers.push(RecolorLayer {
                id: format!("itemModel:{}", item.id),
                kind: "itemModel",
                name: Some(item.name.clone()),
                files: unique(textures),
            });
        }
    }
    layers
}

/// A particle and the particles it creates, followed down the tree once each, in the order met.
pub fn with_children(roots: &[String], refs: &mut dyn FnMut(&str) -> Vec<String>) -> Vec<String> {
    fn walk(p: &str, seen: &mut indexmap::IndexSet<String>, refs: &mut dyn FnMut(&str) -> Vec<String>) {
        if !seen.insert(p.to_string()) {
            return;
        }
        for r in refs(p) {
            if r.ends_with(".vpcf_c") {
                walk(&r, seen, refs);
            }
        }
    }
    let mut seen = indexmap::IndexSet::new();
    for r in roots {
        walk(r, &mut seen, refs);
    }
    seen.into_iter().collect()
}

/// Pixels moved to the chosen colour in place, as `shade` moves a particle's colours; `bgra` says
/// red and blue are swapped. How many pixels changed.
pub fn shade_pixels(pixels: &mut [u8], target: Rgb, bgra: bool) -> usize {
    let (r, b) = if bgra { (2, 0) } else { (0, 2) };
    let mut changed = 0;
    let mut i = 0;
    while i + 3 < pixels.len() {
        if pixels[i + 3] != 0 {
            let from: Rgb = [pixels[i + r] as f64, pixels[i + 1] as f64, pixels[i + b] as f64];
            let to = shade(from, target, None);
            if to != from {
                // a Uint8 store: wrapped and truncated, as a Buffer takes a number
                let byte = |n: f64| if n.is_finite() { (n.trunc() as i64).rem_euclid(256) as u8 } else { 0 };
                pixels[i + r] = byte(to[0]);
                pixels[i + 1] = byte(to[1]);
                pixels[i + b] = byte(to[2]);
                changed += 1;
            }
        }
        i += 4;
    }
    changed
}

/// The colour textures a model's materials name, as compiled paths: a model names its meshes and
/// materials, a material its textures, and the colour is g_tColor. An item's own colour.
pub fn model_color_textures(models: &[String], read: &mut dyn FnMut(&str) -> Option<Vec<u8>>) -> Vec<String> {
    let strip = |p: &str| {
        let p = p.to_lowercase();
        p.strip_suffix("_c").map(str::to_string).unwrap_or(p)
    };
    let mut out = indexmap::IndexSet::new();
    let mut seen = HashSet::new();
    let mut queue: Vec<String> = models.iter().map(|m| strip(m)).collect();
    let mut i = 0;
    while i < queue.len() && seen.len() < 256 {
        let p = queue[i].clone();
        i += 1;
        if !seen.insert(p.clone()) {
            continue;
        }
        let Some(file) = read(&format!("{p}_c")) else { continue };
        if p.ends_with(".vmat") {
            let color = crate::loadout_material::read_loadout_material(Some(&file))
                .and_then(|m| m.textures.get("g_tColor").cloned())
                .filter(|c| !c.is_empty());
            if let Some(c) = color {
                out.insert(format!("{}_c", strip(&c)));
            }
            continue;
        }
        if let Ok(refs) = crate::resource::references(&file) {
            queue.extend(refs.iter().map(|r| strip(r)).filter(|r| r.ends_with(".vmat") || r.ends_with(".vmesh")));
        }
    }
    out.into_iter().collect()
}

/// A layer, and the other items' colour layers it shares a texture with: the game gives a shared
/// texture one colour, so the window moves those layers together.
#[derive(Debug, Clone, Serialize)]
pub struct Shared {
    pub layer: RecolorLayer,
    pub shares: Vec<String>,
}

pub fn with_shares(layers: &[RecolorLayer]) -> Vec<Shared> {
    let mut owners: indexmap::IndexMap<&str, Vec<&str>> = indexmap::IndexMap::new();
    for l in layers.iter().filter(|l| l.kind == "itemModel") {
        for f in &l.files {
            owners.entry(f.as_str()).or_default().push(&l.id);
        }
    }
    layers
        .iter()
        .map(|layer| {
            let shares = if layer.kind == "itemModel" {
                let mut all: indexmap::IndexSet<&str> = indexmap::IndexSet::new();
                for f in &layer.files {
                    all.extend(owners.get(f.as_str()).into_iter().flatten().copied());
                }
                all.into_iter().filter(|id| *id != layer.id).map(String::from).collect()
            } else {
                vec![]
            };
            Shared { layer: layer.clone(), shares }
        })
        .collect()
}

/// Every model an item's block puts in the game, in its order, once each: its own
/// (model_player, model_player1...), and those its visuals bring by asset_modifier.
pub fn item_model_paths(block: &str) -> Vec<String> {
    let sp = crate::js::SPACE_CLASS;
    let model = re(r"^models/[^\n\r\u{2028}\u{2029}]+\.vmdl$");
    let mut out: Vec<String> = Vec::new();
    let mut add = |p: Option<&str>| {
        if let Some(m) = p.map(|p| crate::js::trim(p).to_lowercase()) {
            if !m.is_empty() && model.is_match(&m) && !out.contains(&m) {
                out.push(m);
            }
        }
    };
    let player = re(&format!(r#"(?i)"model_player[0-9]*"{sp}+"([^"]+)""#));
    for c in player.captures_iter(block) {
        add(Some(&c[1]));
    }
    // each asset_modifier block whole, by its braces, its own fields only
    let head = re(&format!(r#"(?i)"asset_modifier[0-9]*"{sp}*\{{"#));
    for h in head.find_iter(block) {
        let mut depth = 0;
        let mut own = String::new();
        for c in block[h.end() - 1..].chars() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    if depth == 1 {
                        own.push(c);
                    }
                }
                c if depth == 1 => own.push(c),
                _ => {}
            }
        }
        let field = |k: &str| re(&format!(r#"(?i)"{k}"{sp}+"([^"]*)""#)).captures(&own).map(|c| c[1].to_string());
        let ty = field("type").unwrap_or_default().to_lowercase();
        let take = match ty.as_str() {
            "entity_model" | "hex_model" => "both",
            "model" | "hero_model_change" => "modifier",
            "additional_wearable" => "asset",
            _ => continue,
        };
        if take != "modifier" {
            add(field("asset").as_deref());
        }
        if take != "asset" {
            add(field("modifier").as_deref());
        }
    }
    out
}
