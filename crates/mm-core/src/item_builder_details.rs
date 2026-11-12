//! What the item builder's window shows beside the items, out of the game's own files, replacing
//! src/item-builder-details.ts: each hero's main attribute, an item's rarity and date, the game's
//! names of its events, and a description as plain text.

use indexmap::IndexMap;
use regex::bytes::{Captures, Regex};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// A hero's main attribute as the game's hero grid groups them: str, agi, int or all.
pub fn attribute_of(primary: &str) -> Option<&'static str> {
    match primary {
        "DOTA_ATTRIBUTE_STRENGTH" => Some("str"),
        "DOTA_ATTRIBUTE_AGILITY" => Some("agi"),
        "DOTA_ATTRIBUTE_INTELLECT" => Some("int"),
        "DOTA_ATTRIBUTE_ALL" => Some("all"),
        _ => None,
    }
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

/// Each hero's main attribute, out of its script (scripts/npc/heroes/npc_dota_hero_<id>.txt,
/// "AttributePrimary"). A hero whose script is missing is left out.
pub fn hero_attributes(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    ids: &[String],
) -> IndexMap<String, &'static str> {
    static PRIMARY: OnceLock<Regex> = OnceLock::new();
    let primary = re(&PRIMARY, r#"(?-u)"AttributePrimary"[\t\n\x0B\x0C\r ]+"(\w+)""#);
    let mut out = IndexMap::new();
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.as_str()) {
            continue;
        }
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_') {
            continue;
        }
        let script = read(&format!("scripts/npc/heroes/npc_dota_hero_{id}.txt")).unwrap_or_default();
        let found = primary.captures(&script).map(|c| String::from_utf8_lossy(&c[1]).into_owned());
        if let Some(attr) = found.as_deref().and_then(attribute_of) {
            out.insert(id.clone(), attr);
        }
    }
    out
}

/// An item's rarity key ("mythical") and the day it came out ("2021-09-01"), each left out when
/// the block does not say.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ItemFacts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rarity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

pub fn item_facts(block: &[u8]) -> ItemFacts {
    static RARITY: OnceLock<Regex> = OnceLock::new();
    static DATE: OnceLock<Regex> = OnceLock::new();
    let rarity = re(&RARITY, r#"(?-u)\n\t*"item_rarity"[\t\n\x0B\x0C\r \xA0]+"(\w+)""#);
    let date = re(&DATE, r#"(?-u)\n\t*"creation_date"[\t\n\x0B\x0C\r \xA0]+"(\d{4}-\d{2}-\d{2})"#);
    let text = |c: Captures| String::from_utf8_lossy(&c[1]).into_owned();
    ItemFacts {
        rarity: rarity.captures(block).map(text).map(|r| r.to_lowercase()),
        date: date.captures(block).map(text),
    }
}

/// The game's names for its events, by the words of the id run together in lower case.
pub type EventNames = HashMap<String, String>;

/// The names the game gives its events in the language of its text: DOTA_EventNameShort_* where
/// there is one, DOTA_EventName_* otherwise; keyed without underscores.
pub fn event_names<'a>(tokens: impl Iterator<Item = (&'a str, &'a str)>) -> EventNames {
    let mut out = EventNames::new();
    let mut short = HashSet::new();
    for (key, value) in tokens {
        let (is_short, rest) = if let Some(r) = key.strip_prefix("dota_eventnameshort_") {
            (true, r)
        } else if let Some(r) = key.strip_prefix("dota_eventname_") {
            (false, r)
        } else {
            continue;
        };
        // /^dota_eventname(short)?_(.+)$/: a name after it, on one line
        if rest.is_empty()
            || rest.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
            || value.is_empty()
            || value.starts_with('#')
        {
            continue;
        }
        let id = rest.replace('_', "");
        if is_short {
            out.insert(id.clone(), value.to_string());
            short.insert(id);
        } else if !short.contains(&id) {
            out.insert(id, value.to_string());
        }
    }
    out
}

/// An event id as a person reads it: the game's own name where its text has one, with the id's
/// year when the name has no number; else the id spelled out. EVENT_ID_NONE is no event.
pub fn event_name(id: &str, names: &EventNames) -> String {
    let Some(rest) = id.strip_prefix("EVENT_ID_") else { return String::new() };
    if rest.is_empty() || rest == "NONE" || rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return String::new();
    }
    let year = (0..rest.len().saturating_sub(3)).find_map(|i| {
        let w = rest.as_bytes().get(i..i + 4)?;
        (w[0] == b'2' && w[1] == b'0' && w[2].is_ascii_digit() && w[3].is_ascii_digit()).then(|| &rest[i..i + 4])
    });
    if let Some(name) = names.get(&rest.replace('_', "").to_lowercase()) {
        return match year {
            Some(y) if !name.chars().any(|c| c.is_ascii_digit()) => format!("{name} {y}"),
            _ => name.clone(),
        };
    }
    rest.split('_')
        .map(|w| match w {
            "INTERNATIONAL" => "The International".to_string(),
            "PLUS" => "Dota Plus".to_string(),
            "TEAM" => "Team".to_string(),
            _ => {
                let mut c = w.chars();
                c.next().map_or(String::new(), |f| f.to_string() + &c.as_str().to_lowercase())
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{a0}",
        _ => return None,
    })
}

/// What String.prototype.trim takes off.
fn js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// A description as plain text: <br> a new line, tags out, entities read, blank lines folded.
pub fn plain_text(text: &str) -> String {
    static BR: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static ENT: OnceLock<Regex> = OnceLock::new();
    static TRAIL: OnceLock<Regex> = OnceLock::new();
    static GAP: OnceLock<Regex> = OnceLock::new();
    let br = re(&BR, r"(?i-u)<br(?:[\t\n\x0B\x0C\r ]|\xC2\xA0)*/?>");
    let tag = re(&TAG, r"(?i-u)</?[a-z][^>]*>");
    let ent = re(&ENT, r"(?i-u)&(#x[0-9a-f]+|#\d+|[a-z]+);");
    let trail = re(&TRAIL, r"(?-u)[ \t]+\n");
    let gap = re(&GAP, r"(?-u)\n{3,}");
    let mut out = br.replace_all(text.as_bytes(), &b"\n"[..]).into_owned();
    // tags out until none is left: taking an inner tag out joins the outer one's halves
    loop {
        let next = tag.replace_all(&out, &b""[..]).into_owned();
        if next == out {
            break;
        }
        out = next;
    }
    let out = ent.replace_all(&out, |c: &Captures| {
        let e = String::from_utf8_lossy(&c[1]).into_owned();
        if !e.starts_with('#') {
            return entity(&e.to_lowercase()).map_or_else(|| c[0].to_vec(), |s| s.as_bytes().to_vec());
        }
        let code = if matches!(e.as_bytes()[1], b'x' | b'X') {
            u64::from_str_radix(&e[2..], 16).map_or(f64::INFINITY, |n| n as f64)
        } else {
            e[1..].parse::<f64>().unwrap_or(f64::INFINITY)
        };
        if code > 0.0 && code < 1_114_112.0 {
            char::from_u32(code as u32).unwrap_or('\u{fffd}').to_string().into_bytes()
        } else {
            Vec::new()
        }
    });
    let out = String::from_utf8_lossy(&out).replace("\r\n", "\n").replace('\r', "\n");
    let out = trail.replace_all(out.as_bytes(), &b"\n"[..]).into_owned();
    let out = gap.replace_all(&out, &b"\n\n"[..]).into_owned();
    String::from_utf8_lossy(&out).trim_matches(js_space).to_string()
}
