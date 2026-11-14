//! Which hero a name means, replacing src/hero-names.ts: the game's folder id (queenofpain), what
//! an author typed (queen_of_pain, qop) and what people read ("Queen of Pain").

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::data;
use crate::js;

fn alias(id: &str) -> Option<&'static str> {
    data::hero_alias().get(id).map(String::as_str).filter(|a| !a.is_empty())
}

/// Each word's first letter upper case, as `/\b\w/g` with toUpperCase does.
fn title_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_word = false;
    for c in s.chars() {
        let word = js::is_word(c);
        out.push(if word && !prev_word { c.to_ascii_uppercase() } else { c });
        prev_word = word;
    }
    out
}

/// What people call a hero the game or an author files as `id` (skeleton_king -> Wraith King).
pub fn display_name(id: &str) -> String {
    let canon = alias(id).unwrap_or(id);
    if let Some(name) = data::hero_display().get(canon).filter(|n| !n.is_empty()) {
        return name.clone();
    }
    title_case(&canon.replace('_', " "))
}

fn letters(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

fn id_by_name() -> &'static HashMap<String, String> {
    static M: OnceLock<HashMap<String, String>> = OnceLock::new();
    M.get_or_init(|| {
        let mut m = HashMap::new();
        for (id, name) in data::hero_display() {
            // first listed wins: antimage, the game's own folder, before anti_mage
            m.entry(letters(&name.to_lowercase())).or_insert_with(|| id.clone());
        }
        m
    })
}

/// The game's id for a hero the catalog names ("Queen of Pain" -> queenofpain), or None.
pub fn id_from_name(name: &str) -> Option<String> {
    let text = name.to_lowercase();
    if let Some(id) = id_by_name().get(&letters(&text)) {
        return Some(id.clone());
    }
    // runs of anything but a-z0-9 become one underscore, and none at either end
    let mut slug = String::with_capacity(text.len());
    let mut gap = false;
    for c in text.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && !slug.is_empty() {
                slug.push('_');
            }
            gap = false;
            slug.push(c);
        } else {
            gap = true;
        }
    }
    if let Some(a) = alias(&slug) {
        return Some(a.to_string());
    }
    (!slug.is_empty()).then_some(slug)
}

/// A hero's identity however the folder was spelled (crystal_maiden, CrystalMaiden).
pub fn key(id: &str) -> String {
    letters(&display_name(id).to_lowercase())
}
