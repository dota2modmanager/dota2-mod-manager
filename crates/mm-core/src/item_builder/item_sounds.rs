//! An item's sounds and voice, as a mod gives them to a hero who does not own the item, replacing
//! src/item-sounds.ts.
//!
//! Which sound plays is the server's choice, made from what it knows the player owns; the client
//! only gets the name of the event to play, and plays what its own soundevents files say that event
//! is. So the mod rewrites those files: the plain event becomes a copy of the item's.
//! - a sound swap (`sound` in the item's visuals) is one event copied over another;
//! - a voice (`response_criteria`) is every plain line of the hero's response rules made a copy of
//!   an arcana line said in the same situation: the rule asking for the item's criterion whose
//!   other requirements are the plain rule's, or failing that the one of the same concept that asks
//!   for the fewest more. Lines the item has no situation for keep the plain voice.
//!
//! Two picks for one hero rewrite the same file, so every pick's changes go into one copy of it.

use std::collections::{HashMap, HashSet};

use indexmap::{IndexMap, IndexSet};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::kv3::{self, Block, Node, Value};
use crate::resource;
use crate::vpk::Index;

/// An event to play as another: the one the server names, and the one the player hears.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoundSwap {
    pub sound: String,
    #[serde(rename = "as")]
    pub as_: String,
}

/// A response criterion an item sets for a hero ("customresponse" = "eartharc_cosmos"). A
/// persona's is `whole`: its voice is the whole voice, so every plain line takes one of its lines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoiceCue {
    #[serde(default)]
    pub hero: String,
    pub key: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub whole: bool,
}

fn s<'a>(n: &'a Node, key: &str) -> &'a str {
    n.get(key).and_then(Node::as_str).unwrap_or("")
}

fn list<'a>(n: Option<&'a Node>, key: &str) -> &'a [Node] {
    n.and_then(|n| n.get(key)).map(Node::items).unwrap_or(&[])
}

/// A node out of one block, to put into another: a number read from a block points into that
/// block's buffers, so it takes its bytes along.
pub fn detached(kv: &Block, n: &Node) -> Node {
    let value = match &n.value {
        Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), detached(kv, v))).collect()),
        Value::Array { items, element, ty } => {
            Value::Array { items: items.iter().map(|x| detached(kv, x)).collect(), element: *element, ty: *ty }
        }
        Value::Number { ty, cell, raw, .. } => {
            let raw = raw.clone().or_else(|| {
                cell.map(|c| kv.buffers[c.buffer as usize][c.offset..c.offset + c.width as usize].to_vec())
            });
            Value::Number { ty: *ty, cell: None, type_at: None, raw }
        }
        other => other.clone(),
    };
    Node { value, flag: n.flag }
}

/// The rules file of a hero: response_rules_<name>, spelt with or without its underscores (drowranger).
fn rules_of(ix: &Index, hero: &str) -> Option<Node> {
    let lower = hero.to_lowercase();
    let name = lower.strip_prefix("npc_dota_hero_").unwrap_or(&lower);
    for n in [name.to_string(), name.replace('_', "")] {
        if let Ok(Some(file)) = ix.read(&format!("scripts/talker/response_rules_{n}.vrr_c")) {
            return kv3::read(resource::data_block(&file).ok()?).ok().map(|kv| kv.root);
        }
    }
    None
}

struct Group {
    item: bool,
    concept: String,
    rest: HashSet<String>,
    key: String,
    lines: Vec<String>,
}

/// The plain lines of a hero, each as the item's line for the same situation (see the top of the
/// file). A plain line already given one keeps it: a line can be in several rules.
pub fn voice_swaps(rules: &Node, key: &str, value: &str, whole: bool) -> Vec<SoundSwap> {
    let criteria = list(Some(rules), "m_Requirements");
    let key = key.to_lowercase();
    let named = |expr: &str| -> HashSet<&str> {
        criteria
            .iter()
            .filter(|c| s(c, "m_matchKey").to_lowercase() == key && s(c, "m_matchExpr") == expr)
            .map(|c| s(c, "m_name"))
            .collect()
    };
    let is = named(value);
    let is_not = named(&format!("!={value}"));
    if is.is_empty() {
        return vec![];
    }
    // for a persona, every other criterion on the item's key is another item's (Invoker's plain
    // lines ask that he is not the "happy" Acolyte as well), and says nothing of the situation
    let keyed: HashSet<&str> = if whole {
        criteria.iter().filter(|c| s(c, "m_matchKey").to_lowercase() == key).map(|c| s(c, "m_name")).collect()
    } else {
        HashSet::new()
    };
    let groups: Vec<Group> = list(Some(rules), "m_ResponseGroups")
        .iter()
        .map(|g| {
            let req: Vec<&str> =
                list(g.get("m_pEmbeddedRule"), "m_Requirements").iter().map(|r| r.as_str().unwrap_or("")).collect();
            let mut rest: Vec<&str> =
                req.iter().copied().filter(|r| !is.contains(r) && !is_not.contains(r) && !keyed.contains(r)).collect();
            let set = rest.iter().map(|r| r.to_string()).collect();
            rest.sort_unstable();
            Group {
                item: req.iter().any(|r| is.contains(r)),
                concept: req.first().copied().unwrap_or("").to_string(),
                rest: set,
                key: rest.join("|"),
                lines: list(Some(g), "m_responses")
                    .iter()
                    .filter(|r| s(r, "m_type") == "SPEAK")
                    .map(|r| s(r, "m_value").to_string())
                    .filter(|l| !l.is_empty())
                    .collect(),
            }
        })
        .filter(|g| !g.lines.is_empty())
        .collect();
    let own: Vec<&Group> = groups.iter().filter(|g| g.item).collect();
    let mut out: IndexMap<String, String> = IndexMap::new();
    for plain in groups.iter().filter(|g| !g.item) {
        let twin = own
            .iter()
            .find(|g| g.key == plain.key)
            .or_else(|| {
                own.iter()
                    .filter(|g| g.concept == plain.concept && plain.rest.is_subset(&g.rest))
                    .min_by_key(|g| g.rest.len())
            })
            // or, for a persona, one that asks less than the plain rule: the Acolyte's lines have no 5% chance on them
            .or_else(|| {
                let fewer = own.iter().filter(|g| whole && g.concept == plain.concept && g.rest.is_subset(&plain.rest));
                // the first of the most, as a stable sort by size, largest first, would pick
                fewer.fold(
                    None,
                    |best: Option<&&Group>, g| {
                        if best.is_some_and(|b| b.rest.len() >= g.rest.len()) {
                            best
                        } else {
                            Some(g)
                        }
                    },
                )
            });
        let Some(twin) = twin else { continue };
        for (i, line) in plain.lines.iter().enumerate() {
            if !out.contains_key(line) {
                out.insert(line.clone(), twin.lines[i % twin.lines.len()].clone());
            }
        }
    }
    out.into_iter().map(|(sound, as_)| SoundSwap { sound, as_ }).collect()
}

/// The soundevents files that make these swaps and voices, each rewritten once with all of them,
/// as (path, bytes). An event the game no longer has is passed over: items_game names a few dozen.
pub fn sound_entries(ix: &Index, swaps: &[SoundSwap], cues: &[VoiceCue]) -> Vec<(String, Vec<u8>)> {
    if swaps.is_empty() && cues.is_empty() {
        return vec![];
    }
    let mut all = swaps.to_vec();
    for cue in cues {
        if let Some(rules) = rules_of(ix, &cue.hero) {
            all.extend(voice_swaps(&rules, &cue.key, &cue.value, cue.whole));
        }
    }
    // every event, by the files that have it. An event can be in more than one (Earthshaker's spawn
    // lines are in his voice file and in the hero picker's), and the one that plays is not ours to
    // guess, so each copy is rewritten.
    let events: Vec<&str> =
        ix.paths().filter(|p| p.starts_with("soundevents/") && p.ends_with(".vsndevts_c")).collect();
    let read: Vec<Option<(String, Vec<u8>, Block)>> = events
        .par_iter()
        .map(|p| {
            let file = ix.read(p).ok()??;
            let kv = kv3::read(resource::data_block(&file).ok()?).ok()?;
            Some((p.to_string(), file, kv))
        })
        .collect();
    let mut files: HashMap<String, (Vec<u8>, Block)> = HashMap::new();
    let mut homes: HashMap<String, Vec<String>> = HashMap::new();
    for (p, file, kv) in read.into_iter().flatten() {
        if let Value::Object(m) = &kv.root.value {
            for k in m.keys() {
                homes.entry(k.clone()).or_default().push(p.clone());
            }
        }
        files.insert(p, (file, kv));
    }
    // the item's events as the game has them, before any swap here writes over one of them
    let mut original: HashMap<String, Node> = HashMap::new();
    for SoundSwap { as_, .. } in &all {
        if original.contains_key(as_) {
            continue;
        }
        if let Some(from) = homes.get(as_).and_then(|h| h.first()) {
            let (_, kv) = &files[from];
            if let Some(n) = kv.root.get(as_) {
                original.insert(as_.clone(), detached(kv, n));
            }
        }
    }
    let mut changed: IndexSet<String> = IndexSet::new();
    for SoundSwap { sound, as_ } in &all {
        let Some(event) = original.get(as_) else { continue };
        if sound == as_ {
            continue;
        }
        for at in homes.get(sound).into_iter().flatten() {
            if let Some((_, kv)) = files.get_mut(at) {
                if let Value::Object(m) = &mut kv.root.value {
                    m.insert(sound.clone(), event.clone());
                }
                changed.insert(at.clone());
            }
        }
    }
    changed
        .into_iter()
        .filter_map(|p| {
            let (file, kv) = &files[&p];
            let bytes = resource::replace(file, "DATA", 0, &kv3::write(kv).ok()?).ok()?;
            Some((p, bytes))
        })
        .collect()
}
