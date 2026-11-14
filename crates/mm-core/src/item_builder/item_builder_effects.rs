//! The particle effects the item builder can put on top of an item, replacing
//! src/item-builder-effects.ts: the effect's id, its name in the picker, and the particle the
//! game creates for it.
//!
//! Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
//! (https://github.com/TheFleece).
//! Copyright (C) 2026 h6rd
//! Copyright (C) 2026 TheFleece
//! SPDX-License-Identifier: GPL-3.0-or-later
//! The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
//! the credits of the program it goes into.

use serde::{Deserialize, Serialize};

use crate::data;
use crate::i18n::t;
use crate::kv::{self, KvError};
use crate::schema_merge::latin1_lower;

/// An effect the builder can add to an item: a particle it creates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemEffect {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub modifier: String,
}

/// The effects the picker offers, "no effect" first: (id, name).
pub fn item_effects() -> Vec<(String, String)> {
    let mut out = vec![(String::new(), t("Без эффекта", &[]))];
    out.extend(data::item_effects().iter().map(|e| (e.id.clone(), e.name.clone())));
    out
}

/// The visuals with an effect's particle created, after the ones they create already.
pub fn append_item_effect(visuals: &[u8], effect: &ItemEffect) -> Result<Vec<u8>, KvError> {
    let needle = latin1_lower(effect.modifier.as_bytes());
    if !needle.is_empty() && memchr::memmem::find(&latin1_lower(visuals), &needle).is_some() {
        return Ok(visuals.to_vec());
    }
    let block = format!(
        "\"asset_modifier\"\r\n{{\r\n\t\"type\"\t\t\"{}\"\r\n\t\"modifier\"\t\t\"{}\"\r\n}}",
        effect.ty, effect.modifier
    );
    let (mut after, mut before) = (None, None);
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        if !c.is_block() || !c.key.eq_ignore_ascii_case(b"asset_modifier") {
            continue;
        }
        let mut ty: &[u8] = b"";
        kv::each_child(visuals, c.body.unwrap(), |f| {
            if !f.is_block() && f.key.eq_ignore_ascii_case(b"type") {
                ty = f.value.unwrap_or(b"");
            }
            true
        })?;
        if ty.eq_ignore_ascii_case(b"particle_create") {
            after = Some(c.end);
        } else if after.is_some() && before.is_none() {
            before = Some(c.start);
        }
    }
    let close = visuals.iter().rposition(|&c| c == b'}');
    let Some(at) = before.or(after).or(close) else { return Ok(visuals.to_vec()) };
    let suffix: &[u8] = if before.is_none() { b"\r\n" } else { b"\r\n\t" };
    Ok([&visuals[..at], b"\r\n\t", block.as_bytes(), suffix, &visuals[at..]].concat())
}
