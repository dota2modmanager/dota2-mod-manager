//! An ability's effect picked in its ability effects slot goes over the one the hero's worn item
//! gives the same ability. The game lets the worn item win: an immortal that replaces the
//! particle of Blade Fury keeps its own Blade Fury, whatever another immortal's effect the user
//! picked for that ability. So the build takes, out of every other item that replaces one of the
//! particles the picks replace, that replacement, and the pick is what the game shows.
//!
//! The same goes for an ability's icon and its sound: Rollermawster on Tinker's head kept its
//! March of the Machines icon and sound over the Interstellar Astrarium picked in the ability's
//! effects slot (Discord, after 4.5.0). Those are keyed `ability_icon:<ability>` and
//! `sound:<event>`; a particle by its own path, as before.

use std::collections::HashSet;

use crate::kv::{self, latin1, KvError};
use crate::schema::items_of;

fn is_modifier_key(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

/// A swap in a block: its text's span, and what it replaces (a stock particle's path, or
/// `ability_icon:<ability>`, `sound:<event>`).
type Swap = ((usize, usize), String);

/// The visuals of a block, and in them each swap an ability effects pick wins over.
fn particle_swaps(block: &[u8]) -> Result<Vec<Swap>, KvError> {
    let mut visuals = None;
    kv::each_child(block, kv::block_bounds(block, 0)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            visuals = c.body;
            return false;
        }
        true
    })?;
    let Some(visuals) = visuals else { return Ok(vec![]) };
    let mut out = Vec::new();
    for c in kv::children(block, visuals)? {
        let (Some(body), true) = (c.body, is_modifier_key(c.key)) else { continue };
        let (mut ty, mut asset) = (String::new(), String::new());
        for f in kv::children(block, body)? {
            let Some(v) = f.value else { continue };
            if f.key.eq_ignore_ascii_case(b"type") {
                ty = latin1(v).to_lowercase();
            } else if f.key.eq_ignore_ascii_case(b"asset") {
                asset = latin1(v).trim().to_lowercase();
            }
        }
        if ty == "particle" && asset.ends_with(".vpcf") {
            out.push(((c.start, c.end), asset));
        } else if (ty == "ability_icon" || ty == "sound") && !asset.is_empty() {
            out.push(((c.start, c.end), format!("{ty}:{asset}")));
        }
    }
    Ok(out)
}

/// What an ability effects pick replaces: stock particles, abilities' icons and sounds.
pub fn fx_particles(block: &[u8]) -> Result<HashSet<String>, KvError> {
    Ok(particle_swaps(block)?.into_iter().map(|(_, a)| a).collect())
}

/// The block without its swaps of these particles; None when it has none of them.
pub fn without_particles(block: &[u8], taken: &HashSet<String>) -> Result<Option<Vec<u8>>, KvError> {
    let cut: Vec<(usize, usize)> =
        particle_swaps(block)?.into_iter().filter(|(_, a)| taken.contains(a)).map(|(s, _)| s).collect();
    if cut.is_empty() {
        return Ok(None);
    }
    let mut out = Vec::with_capacity(block.len());
    let mut at = 0;
    for (s, e) in cut {
        out.extend_from_slice(&block[at..s]);
        at = e;
    }
    out.extend_from_slice(&block[at..]);
    Ok(Some(out))
}

/// The game's items, other than those in `skip`, that replace one of the particles: each by its id,
/// with its block without those swaps.
pub fn items_over(
    vanilla: &[u8],
    taken: &HashSet<String>,
    skip: &HashSet<String>,
) -> Result<Vec<(String, Vec<u8>)>, KvError> {
    let mut out = Vec::new();
    if taken.is_empty() {
        return Ok(out);
    }
    for it in items_of(vanilla)?.iter() {
        if !it.has_visuals || skip.contains(&it.id) || it.prefab == "default_item" {
            continue;
        }
        let block = &vanilla[it.start..it.end];
        if let Some(b) = without_particles(block, taken)? {
            out.push((it.id.clone(), b));
        }
    }
    Ok(out)
}

#[cfg(test)]
#[path = "item_builder_fx_first_tests.rs"]
mod tests;
