//! The item builder's sets, replacing src/item-builder-sets.ts: what a set of the game's puts on,
//! and what the game says about it (rarity, release date, event).
//!
//! Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
//! (https://github.com/TheFleece).
//! Copyright (C) 2026 h6rd
//! Copyright (C) 2026 TheFleece
//! SPDX-License-Identifier: GPL-3.0-or-later
//! The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
//! the credits of the program it goes into.

use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::hero_names::display_name;
use crate::i18n::t;
use crate::item_builder_details::item_facts;
use crate::item_builder_slots::{canonical_hero_id, is_persona_item, item_heroes, ItemSlot};
use crate::kv::{self, latin1, KvError};
use crate::schema::{items_of, to_utf8};

/// One piece of a set: where it goes, or why it does not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SetPiece {
    #[serde(rename_all = "camelCase")]
    Fits {
        name: String,
        item_id: String,
        fits: bool,
        slot: String,
        slot_label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        styles: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rarity: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Left { name: String, item_id: String, fits: bool, reason: String },
}

/// A set as the builder puts it on, with what the game says about it as the table has it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSet {
    pub id: String,
    pub name: String,
    pub hero_ids: Vec<String>,
    pub fit: usize,
    pub hero_label: String,
    pub pieces: Vec<SetPiece>,
    pub rarity: String,
    pub date: String,
    pub event: String,
    pub name_token: String,
    pub desc_token: String,
    pub styles: usize,
}

fn top_values(text: &[u8], start: usize) -> Result<HashMap<String, String>, KvError> {
    let mut out = HashMap::new();
    kv::each_child(text, kv::block_bounds(text, start)?, |c| {
        if let Some(v) = c.value {
            out.insert(latin1(c.key).to_lowercase(), latin1(v));
        }
        true
    })?;
    Ok(out)
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10 && b[4] == b'-' && b[7] == b'-' && [0, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit())
}

/// A hero's sets as the builder puts them on: every wearable of the set that has a slot in the
/// builder, in one write. Sets with nothing to put on, store bundles of several sets, and
/// Valve's "DO NOT USE" are left out. `slots`: item_slots(text).
pub fn item_sets(text: &[u8], slots: &[ItemSlot]) -> Result<Vec<ItemSet>, KvError> {
    let items = items_of(text)?;
    let by_name: HashMap<&str, &crate::schema::SchemaItem> = items.iter().map(|i| (i.name.as_str(), i)).collect();
    let mut home: HashMap<&str, &ItemSlot> = HashMap::new();
    let mut looks: HashMap<&str, usize> = HashMap::new();
    for s in slots {
        if s.persona.is_some() || s.ability_fx.is_some() {
            continue;
        }
        for o in &s.options {
            home.insert(&o.id, s);
            if let Some(st) = o.styles.as_ref().filter(|st| st.len() > 1) {
                looks.insert(&o.id, st.len());
            }
        }
    }
    let mut out = Vec::new();
    for set in items.iter() {
        if set.prefab != "bundle" || set.bundle_items.is_empty() || set.name.to_lowercase().contains("do not use") {
            continue;
        }
        let heroes = item_heroes(text, set.start)?;
        if heroes.is_empty() {
            continue;
        }
        let mut pieces = Vec::new();
        let mut taken: HashSet<&str> = HashSet::new();
        let mut collide = 0;
        for name in &set.bundle_items {
            let Some(it) = by_name.get(name.as_str()).filter(|it| it.prefab == "wearable") else { continue };
            let at = home.get(it.id.as_str());
            if let Some(at) = at.filter(|at| !taken.contains(at.slot.as_str())) {
                taken.insert(&at.slot);
                pieces.push(SetPiece::Fits {
                    name: to_utf8(&it.name),
                    item_id: it.id.clone(),
                    fits: true,
                    slot: at.slot.clone(),
                    slot_label: at.slot_label.clone(),
                    styles: looks.get(it.id.as_str()).copied(),
                    rarity: item_facts(&text[it.start..it.end]).rarity,
                });
                continue;
            }
            if at.is_some() {
                collide += 1;
            }
            let reason = if at.is_some() {
                t("второй предмет на тот же слот", &[])
            } else if is_persona_item(it) {
                t("персона: конструктор их не меняет", &[])
            } else {
                t("для него нет слота в конструкторе", &[])
            };
            pieces.push(SetPiece::Left { name: to_utf8(&it.name), item_id: it.id.clone(), fits: false, reason });
        }
        let fit = pieces.iter().filter(|p| matches!(p, SetPiece::Fits { .. })).count();
        if fit == 0 || collide > fit {
            continue;
        }
        let hero_ids: Vec<String> = heroes.iter().map(|h| canonical_hero_id(h)).collect();
        let v = top_values(text, set.start)?;
        let get = |k: &str| v.get(k).cloned().unwrap_or_default();
        let created = get("creation_date");
        let styles = pieces
            .iter()
            .map(|p| match p {
                SetPiece::Fits { styles: Some(s), .. } if *s > 0 => *s,
                _ => 1,
            })
            .max()
            .unwrap_or(1)
            .max(1);
        out.push(ItemSet {
            id: set.id.clone(),
            name: to_utf8(&set.name),
            hero_label: hero_ids.iter().map(|id| display_name(id)).collect::<Vec<_>>().join(" / "),
            hero_ids,
            fit,
            pieces,
            rarity: get("item_rarity").to_lowercase(),
            date: if is_date(&created) { created.chars().take(10).collect() } else { String::new() },
            event: get("event_id"),
            name_token: set.item_name.clone(),
            desc_token: set.item_description.clone(),
            styles,
        });
    }
    out.sort_by(|a, b| crate::js::locale_compare(&a.name, &b.name));
    Ok(out)
}
