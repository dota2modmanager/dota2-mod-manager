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

/// A language's tokens, shared.
pub type Tokens = std::sync::Arc<IndexMap<String, String>>;

/// Cosmetic names by schema name, shared.
pub type Names = std::sync::Arc<BTreeMap<String, String>>;

fn lang_file(lang: &str) -> &'static str {
    match lang {
        "ru" => "russian",
        "zh-CN" => "schinese",
        _ => "english",
    }
}

fn game_index(game: &std::path::Path) -> Option<crate::vpk::Index> {
    crate::vpk::Index::open(&game.join("dota").join("pak01_dir.vpk")).ok()
}

/// Every text token of the game in the app's language, dota_*.txt before items_*.txt, read once per
/// game build and language; empty with no game to read. Style, rarity and event names are in
/// dota_*.txt, and items_*.txt has a few more.
pub fn game_tokens(game: &std::path::Path, lang: &str) -> std::sync::Arc<IndexMap<String, String>> {
    use std::sync::{Arc, Mutex};
    static CACHE: OnceLock<Mutex<IndexMap<String, Tokens>>> = OnceLock::new();
    let Ok(stamp) = crate::pak_stamp::game_schema_stamp(game) else { return Arc::default() };
    let build = format!("{}|{stamp}|", game.display());
    let key = format!("{build}{lang}");
    let cache = CACHE.get_or_init(Default::default);
    if let Some(found) = cache.lock().unwrap().get(&key) {
        return found.clone();
    }
    let Some(index) = game_index(game) else { return Arc::default() };
    let mut found = IndexMap::new();
    for file in ["dota", "items"] {
        let Ok(data) = index.read(&format!("resource/localization/{file}_{}.txt", lang_file(lang))) else {
            return Arc::default();
        };
        for (k, v) in data.map(|d| localization_tokens(&d)).unwrap_or_default() {
            found.entry(k).or_insert(v);
        }
    }
    let found = Arc::new(found);
    let mut cache = cache.lock().unwrap();
    cache.retain(|k, _| k.starts_with(&build));
    cache.insert(key, found.clone());
    found
}

/// An item style's name in the app's language, from the game's own localization by the style's
/// token (#DOTA_Style_Bladeform_Legacy_1); `fallback` for a token the game has no text for.
pub fn style_name(tokens: &IndexMap<String, String>, token: &str, fallback: impl FnOnce() -> String) -> String {
    let key = token.strip_prefix('#').unwrap_or(token).to_lowercase();
    match tokens.get(&key) {
        Some(text) if !text.is_empty() && !text.starts_with('#') => text.clone(),
        _ => fallback(),
    }
}

/// The cosmetics' names in Chinese, by schema name: read-only, offline and refreshed after a game
/// update; a missing language file keeps English (the name is left out).
pub fn chinese_cosmetic_names(game: &std::path::Path, schema_text: &[u8]) -> std::sync::Arc<BTreeMap<String, String>> {
    use std::sync::{Arc, Mutex};
    static CACHE: OnceLock<Mutex<Option<(String, String, Names)>>> = OnceLock::new();
    let Ok(stamp) = crate::pak_stamp::game_schema_stamp(game) else { return Arc::default() };
    let at = game.display().to_string();
    let cache = CACHE.get_or_init(Default::default);
    if let Some((g, s, names)) = cache.lock().unwrap().as_ref() {
        if *g == at && *s == stamp {
            return names.clone();
        }
    }
    let Some(index) = game_index(game) else { return Arc::default() };
    let mut tokens = IndexMap::new();
    for file in ["dota", "items"] {
        let Ok(data) = index.read(&format!("resource/localization/{file}_schinese.txt")) else { return Arc::default() };
        tokens.extend(data.map(|d| localization_tokens(&d)).unwrap_or_default());
    }
    let Ok(items) = crate::schema::items_of(schema_text) else { return Arc::default() };
    let names = Arc::new(cosmetic_name_table(items.iter().map(|i| (i.name.as_str(), i.item_name.as_str())), &tokens));
    *cache.lock().unwrap() = Some((at, stamp, names.clone()));
    names
}
