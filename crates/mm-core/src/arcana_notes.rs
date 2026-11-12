//! What an arcana does in the game once the item builder puts it on, as somebody played it, and
//! which arcanas have a base rebuilt by hand; replacing src/arcana-notes.ts and the table of
//! src/arcana-bases.ts. The tables are in data/arcana-*.json, written from the TypeScript.
//!
//! The notes are in Russian, the app's source language, and translated where they are shown.

use regex::bytes::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::data;

/// One base: a folder of the repository, and the picks it is for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArcanaBase {
    pub id: String,
    pub hero: String,
    pub item: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub styles: Option<Vec<u64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Vec<String>>,
    pub parts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<bool>,
}

/// A note as the table keeps it, untranslated: issues, broken or untested.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Noted {
    pub status: String,
    pub note: String,
}

/// A note as an option carries it, in the user's language.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ItemNote {
    pub status: String,
    pub text: String,
}

const UNTESTED: &str = "Не проверено в игре";

/// Said of a pick whose model has no stock path to go under: the game draws ERROR in its place
/// from the first reconnect on.
pub const UNTIL_RECONNECT: &str = "Видно только до переподключения к матчу: у стандартного предмета этого слота нет своей модели, и после переподключения игра рисует на её месте ERROR";

/// Whether an arcana has a base for any of its styles: the builder's note on it is then out of date.
pub fn has_base(item_id: &str) -> bool {
    data::arcana_bases().iter().any(|b| b.item == item_id)
}

/// An option's note with UNTIL_RECONNECT added: on its own as one with issues, after an arcana's own.
pub fn until_reconnect(noted: Option<&Noted>, text: impl Fn(&str) -> String) -> ItemNote {
    match noted {
        None => ItemNote { status: "issues".into(), text: text(UNTIL_RECONNECT) },
        Some(n) => ItemNote { status: n.status.clone(), text: format!("{} {}", text(&n.note), text(UNTIL_RECONNECT)) },
    }
}

/// Whether an item's block in items_game says it is an arcana.
pub fn is_arcana_block(block: &[u8]) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i-u)"item_rarity"[\t\n\x0B\x0C\r \xA0]+"arcana""#).unwrap()).is_match(block)
}

/// The note an item builder option carries, untranslated, or None.
pub fn item_note(hero_ids: &[String], block: &[u8], item_id: Option<&str>) -> Option<Noted> {
    if hero_ids.iter().any(|h| data::heroes_not_checked().contains(h)) {
        return Some(Noted { status: "untested".into(), note: UNTESTED.into() });
    }
    if !is_arcana_block(block) {
        return None;
    }
    if item_id.is_some_and(|i| !i.is_empty() && has_base(i)) {
        return None;
    }
    for h in hero_ids {
        if let Some((_, n)) = data::arcana_notes().iter().find(|(k, _)| k == h) {
            return Some(n.clone());
        }
    }
    if hero_ids.iter().any(|h| data::arcanas_that_work().contains(h)) {
        return None;
    }
    Some(Noted { status: "untested".into(), note: UNTESTED.into() })
}
