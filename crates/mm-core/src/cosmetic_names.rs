//! Display names out of Valve's installed localization, replacing the pure part of
//! src/cosmetic-names.ts: a localization file's tokens, and the table of a cosmetic's schema name
//! to its name in another language (by its item_name token, never guessed from the English).

use indexmap::IndexMap;
use regex::Regex;
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

use crate::schema::to_utf8;

/// A localization file's text: UTF-16 after a little-endian BOM (older loose copies), else UTF-8.
pub fn localization_text(data: &[u8]) -> String {
    if data.starts_with(&[0xff, 0xfe]) {
        let units: Vec<u16> = data.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(data).into_owned()
    }
}

/// The tokens of a localization file, keys lower case, in the file's order (a later one wins).
pub fn localization_tokens(data: &[u8]) -> IndexMap<String, String> {
    static QUOTED: OnceLock<Regex> = OnceLock::new();
    static ESCAPE: OnceLock<Regex> = OnceLock::new();
    let quoted = QUOTED.get_or_init(|| Regex::new(r#"//[^\r\n]*|"((?:\\[^\n\r\u{2028}\u{2029}]|[^"\\])*)""#).unwrap());
    let escape = ESCAPE.get_or_init(|| Regex::new(r#"\\(["\\nrt])"#).unwrap());
    let text = localization_text(data);
    let decode = |s: &str| {
        escape
            .replace_all(s, |c: &regex::Captures| match &c[1] {
                "n" => "\n".to_string(),
                "r" => "\r".to_string(),
                "t" => "\t".to_string(),
                x => x.to_string(),
            })
            .into_owned()
    };
    let words: Vec<String> = quoted.captures_iter(&text).filter_map(|m| m.get(1).map(|w| decode(w.as_str()))).collect();
    let mut tokens = IndexMap::new();
    let Some(at) = words.iter().position(|s| s.to_lowercase() == "tokens") else { return tokens };
    let mut i = at + 1;
    while i + 1 < words.len() {
        tokens.insert(words[i].to_lowercase(), words[i + 1].clone());
        i += 2;
    }
    tokens
}

/// A cosmetic's schema name (as the person reads it) to its name in the tokens' language, by its
/// item_name token. A name two items share with different translations is left out.
pub fn cosmetic_name_table<'a>(
    items: impl IntoIterator<Item = (&'a str, &'a str)>,
    tokens: &IndexMap<String, String>,
) -> BTreeMap<String, String> {
    let mut names: BTreeMap<String, String> = BTreeMap::new();
    let mut ambiguous: HashSet<String> = HashSet::new();
    for (name, item_name) in items {
        let name = to_utf8(name);
        let token = item_name.strip_prefix('#').unwrap_or(item_name).to_lowercase();
        let Some(translated) = tokens.get(&token) else { continue };
        if name.is_empty() || translated.is_empty() || translated.starts_with('#') || ambiguous.contains(&name) {
            continue;
        }
        match names.get(&name) {
            Some(had) if had != translated => {
                names.remove(&name);
                ambiguous.insert(name);
            }
            _ => {
                names.insert(name, translated.clone());
            }
        }
    }
    names
}
