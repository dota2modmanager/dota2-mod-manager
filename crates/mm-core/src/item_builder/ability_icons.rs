//! A hero's ability icons picked one by one from the icons his own cosmetics already ship
//! (src/ability-icons.ts). What there is to pick is read off the item table: an asset modifier of
//! type ability_icon, "asset" the ability and "modifier" the picture it shows instead, under
//! panorama/images/spellicons. Only items whose used_by_heroes names the hero count, and the shared
//! sets of the table's asset_modifiers section for an ability in his script.
//!
//! Putting one on needs no compiler: the picked icon's compiled file is copied, byte for byte, to
//! the ability's own path and over every picture a cosmetic would show for it instead.

use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde::Serialize;

use crate::kv::{self, KvError};
use crate::vpk::Entry;

fn re(p: &str) -> Regex {
    Regex::new(p).expect("a fixed pattern")
}

/// An icon's name as items_game writes a modifier: a path under spellicons, without the suffix.
pub fn icon_name_ok(s: &str) -> bool {
    re(r"^[a-z0-9_]+(?:/[a-z0-9_]+){0,5}$").is_match(s)
}

/// The compiled picture of an icon.
pub fn icon_file(icon: &str) -> String {
    format!("panorama/images/spellicons/{icon}_png.vtex_c")
}

/// One ability_icon modifier of the item table.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IconModifier {
    pub asset: String,
    pub modifier: String,
    pub style: Option<f64>,
    pub at: usize,
}

/// One icon the window offers for an ability: the picture, and the cosmetic or set it comes from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconChoice {
    pub icon: String,
    pub item: String,
    pub item_id: String,
    pub style: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_key: Option<String>,
}

/// An ability the hero has a choice of icons for.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AbilityIcons {
    pub ability: String,
    pub choices: Vec<IconChoice>,
}

/// An item of the table, or a set of its asset_modifiers section (`shared`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconSource {
    pub id: String,
    pub name: String,
    pub start: usize,
    pub end: usize,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub shared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_key: Option<String>,
}

fn find_from(text: &[u8], c: u8, from: usize) -> Option<usize> {
    text.get(from..)?.iter().position(|&b| b == c).map(|i| i + from)
}

/// Every ability_icon modifier in the table, wherever it sits; the fields read by key.
pub fn icon_modifiers(text: &[u8]) -> Vec<IconModifier> {
    let sp = crate::js::SPACE_CLASS;
    let block = regex::bytes::Regex::new(r#"(?-u)"type"[\t-\r \xA0]+"ability_icon""#).expect("a fixed pattern");
    let mut out = Vec::new();
    for m in block.find_iter(text) {
        let at = m.start();
        let Some(open) = text[..=at].iter().rposition(|&b| b == b'{') else { continue };
        let Some(close) = find_from(text, b'}', at) else { continue };
        let body = kv::latin1(&text[open + 1..close]);
        let field = |k: &str| re(&format!(r#"(?i)"{k}"{sp}+"([^"]*)""#)).captures(&body).map(|c| c[1].to_string());
        let asset = field("asset").map(|a| a.to_lowercase());
        let modifier = field("modifier").map(|m| m.to_lowercase().replace('\\', "/"));
        let style = field("style");
        let (Some(asset), Some(modifier)) = (asset, modifier) else { continue };
        if asset.is_empty()
            || modifier.is_empty()
            || !icon_name_ok(&asset)
            || !icon_name_ok(&modifier)
            || asset == modifier
        {
            continue;
        }
        let style = style
            .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|s| s.parse::<f64>().ok());
        out.push(IconModifier { asset, modifier, style, at });
    }
    out
}

/// "tine_of_the_behemoth_icons" as "Tine of the Behemoth": a shared set's name has no text of its own.
pub fn set_label(name: &str) -> String {
    let stripped = re(r"(?i)_?ability_icons?$|_icons?$").replace(name, "").into_owned();
    let small = ["of", "the", "and", "a", "in", "on"];
    let words: Vec<String> = stripped
        .split('_')
        .filter(|w| !w.is_empty())
        .enumerate()
        .map(|(i, w)| {
            if i > 0 && small.contains(&w) {
                w.to_string()
            } else {
                let mut c = w.chars();
                c.next().map_or(String::new(), |f| f.to_uppercase().collect::<String>() + c.as_str())
            }
        })
        .collect();
    let out = words.join(" ");
    if out.is_empty() {
        name.to_string()
    } else {
        out
    }
}

/// The entries of the table's asset_modifiers section, each a named set of modifiers that is not
/// an item and names no hero; an id of `set:<n>` keeps them apart from items.
pub fn modifier_sets(text: &[u8]) -> Result<Vec<IconSource>, KvError> {
    let head = regex::bytes::Regex::new(r#"(?-u)\n\t"asset_modifiers"[\t-\r \xA0]*\{"#).expect("a fixed pattern");
    let Some(h) = head.find(text) else { return Ok(vec![]) };
    let section_end = kv::block_bounds(text, h.end() - 1)?.1;
    let open = find_from(text, b'{', h.start()).unwrap_or(h.end() - 1);
    let sp = crate::js::SPACE_CLASS;
    let name_re = re(&format!(r#""name"{sp}+"([^"]+)""#));
    let loc_re = re(&format!(r##""loc_key"{sp}+"#?([^"]+)""##));
    let mut out = Vec::new();
    kv::each_child(text, (open, section_end), |c| {
        let Some(body) = c.body else { return true };
        let top = kv::latin1(&text[body.0..body.1.min(body.0 + 400)]);
        let key = kv::latin1(c.key);
        let name = name_re.captures(&top).map(|m| m[1].to_string()).unwrap_or_else(|| key.clone());
        let loc_key = loc_re.captures(&top).map(|m| m[1].to_string());
        out.push(IconSource {
            id: format!("set:{key}"),
            name: set_label(&name),
            start: c.start,
            end: body.1,
            shared: true,
            loc_key,
        });
        true
    })?;
    Ok(out)
}

fn item_at(items: &[&IconSource], at: usize) -> Option<usize> {
    let (mut lo, mut hi, mut hit) = (0i64, items.len() as i64 - 1, None);
    while lo <= hi {
        let mid = (lo + hi) / 2;
        if items[mid as usize].start <= at {
            hit = Some(mid as usize);
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    hit.filter(|&h| at < items[h].end)
}

/// The icons a hero can pick for each ability, once each by picture, those whose picture the game
/// has and whose ability has an icon of its own to replace. Abilities in `order` (his script's)
/// come first, in that order; any other his items name follow by name.
pub fn hero_icon_choices(
    text: &[u8],
    sources: &[IconSource],
    hero: &str,
    order: &[String],
    has: &dyn Fn(&str) -> bool,
    modifiers: &[IconModifier],
) -> Result<Vec<AbilityIcons>, KvError> {
    let mut sorted: Vec<&IconSource> = sources.iter().collect();
    sorted.sort_by_key(|s| s.start);
    let npc = format!("npc_dota_hero_{hero}");
    let mut heroes_of: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    let mut by_ability: IndexMap<String, Vec<IconChoice>> = IndexMap::new();
    for m in modifiers {
        let Some(i) = item_at(&sorted, m.at) else { continue };
        let item = sorted[i];
        let his = if item.shared {
            order.contains(&m.asset)
        } else if let Some(&h) = heroes_of.get(&item.id) {
            h
        } else {
            let h = crate::item_builder_slots::item_heroes(text, item.start)?.contains(&npc);
            heroes_of.insert(item.id.clone(), h);
            h
        };
        if !his {
            continue;
        }
        let list = by_ability.entry(m.asset.clone()).or_default();
        if list.iter().any(|c| c.icon == m.modifier) {
            continue;
        }
        list.push(IconChoice {
            icon: m.modifier.clone(),
            item: if item.name.is_empty() { item.id.clone() } else { item.name.clone() },
            item_id: item.id.clone(),
            style: m.style,
            loc_key: item.loc_key.clone().filter(|l| !l.is_empty()),
        });
    }
    let rank = |a: &str| order.iter().position(|o| o == a).unwrap_or(order.len());
    let mut out: Vec<AbilityIcons> = by_ability
        .into_iter()
        .filter(|(a, _)| has(&icon_file(a)))
        .map(|(ability, choices)| AbilityIcons {
            ability,
            choices: choices.into_iter().filter(|c| has(&icon_file(&c.icon))).collect(),
        })
        .filter(|a| !a.choices.is_empty())
        .collect();
    out.sort_by(|a, b| {
        rank(&a.ability).cmp(&rank(&b.ability)).then_with(|| crate::js::locale_compare(&a.ability, &b.ability))
    });
    Ok(out)
}

/// Every file a pick of `ability` has to cover: its own icon, and each picture a cosmetic swaps it
/// to. The picked picture is left as it is.
pub fn forced_files(ability: &str, icon: &str, modifiers: &[IconModifier]) -> Vec<String> {
    let mut out: IndexSet<String> = IndexSet::new();
    out.insert(icon_file(ability));
    for m in modifiers {
        if m.asset == ability && m.modifier != icon {
            out.insert(icon_file(&m.modifier));
        }
    }
    out.into_iter().collect()
}

/// The pak's files, each with its path: each picked icon's compiled picture under every path its ability can be drawn
/// from, those the game has. A picture two abilities share goes to the pick first in `picks`. A pick
/// the game has no file for any more is left out and named in `gone`.
pub fn icon_entries(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    picks: &IndexMap<String, String>,
    modifiers: &[IconModifier],
    has: &dyn Fn(&str) -> bool,
) -> (Vec<(String, Entry)>, Vec<String>) {
    let mut taken: IndexMap<String, Entry> = IndexMap::new();
    let mut gone = Vec::new();
    for (ability, icon) in picks {
        let data = if icon_name_ok(ability) && icon_name_ok(icon) { read(&icon_file(icon)) } else { None };
        let Some(data) = data else {
            gone.push(ability.clone());
            continue;
        };
        let data: std::sync::Arc<[u8]> = data.into();
        for file in forced_files(ability, icon, modifiers) {
            if !taken.contains_key(&file) && (file == icon_file(ability) || has(&file)) {
                let e = crate::vpk::entry_at(&file, data.clone());
                taken.insert(file, e);
            }
        }
    }
    (taken.into_iter().collect(), gone)
}
