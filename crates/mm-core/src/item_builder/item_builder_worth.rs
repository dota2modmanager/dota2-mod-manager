//! The best look of every hero, for "Dress all heroes": what a player would put on if they owned
//! everything. A hero gets the most prized set the builder can put on whole, and over it the
//! hero's arcana and immortals, slot by slot, in their golden version where the game has one and
//! in matching pairs (Anti-Mage's two Golden Bashers of Mage Skulls rather than one of each).
//!
//! What makes a set prized is what the game's table says about where it came from: a set out of a
//! Collector's Cache, or one a treasure drops only as its rare extra, cannot be bought in the
//! store any more. The rarity the table gives a set ranks next, then its date.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::item_builder_sets::{ItemSet, SetPiece};
use crate::item_builder_slots::{ItemSlot, SlotOption};
use crate::kv::{self, latin1, KvError};
use crate::schema::items_of;

/// Where the game's treasures put an item or a set, by its name in the table.
#[derive(Debug, Default)]
pub struct Drops {
    /// out of a Collector's Cache
    pub cache: HashSet<String>,
    /// a treasure's rare extra (its additional_drop), not one of its regular drops
    pub bonus: HashSet<String>,
    /// one of any treasure's regular drops
    pub treasure: HashSet<String>,
}

/// A loot list as the table writes it: the names it lists, and the names its extras give.
#[derive(Default)]
struct List {
    names: Vec<String>,
    extras: Vec<String>,
}

fn block_of(text: &[u8], bounds: kv::Bounds, key: &str) -> Result<Option<kv::Bounds>, KvError> {
    let mut found = None;
    kv::each_child(text, bounds, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(key.as_bytes()) {
            found = c.body;
            return false;
        }
        true
    })?;
    Ok(found)
}

fn loot_lists(text: &[u8]) -> Result<HashMap<String, List>, KvError> {
    let root = kv::block_bounds(text, 0)?;
    let mut out = HashMap::new();
    let Some(section) = block_of(text, root, "loot_lists")? else { return Ok(out) };
    for c in kv::children(text, section)? {
        let Some(body) = c.body else { continue };
        let mut list = List::default();
        for e in kv::children(text, body)? {
            match e.body {
                None => list.names.push(latin1(e.key)),
                // "additional_drop" and "escalating_chance_drop_by_rarity" (rare, very rare, ultra
                // rare): a block with the one item it may give beside the list's regular drop
                Some(b) => {
                    for f in kv::children(text, b)? {
                        if let (true, Some(v)) = (f.key.eq_ignore_ascii_case(b"item"), f.value) {
                            list.extras.push(latin1(v));
                        }
                    }
                }
            }
        }
        out.insert(latin1(c.key), list);
    }
    Ok(out)
}

/// The loot list a treasure opens into, from its "treasure loot list" attribute.
fn treasure_list(text: &[u8], start: usize) -> Result<Option<String>, KvError> {
    let Some(attrs) = block_of(text, kv::block_bounds(text, start)?, "static_attributes")? else { return Ok(None) };
    let Some(list) = block_of(text, attrs, "treasure loot list")? else { return Ok(None) };
    let mut value = None;
    kv::each_child(text, list, |c| {
        if c.key.eq_ignore_ascii_case(b"value") {
            value = c.value.map(latin1);
            return false;
        }
        true
    })?;
    Ok(value)
}

/// Every name a list gives, through the lists it names; `bonus` once past an extra.
fn walk(
    lists: &HashMap<String, List>,
    name: &str,
    bonus: bool,
    seen: &mut HashSet<(String, bool)>,
    out: &mut Vec<(String, bool)>,
) {
    if !seen.insert((name.to_string(), bonus)) {
        return;
    }
    let Some(list) = lists.get(name) else {
        out.push((name.to_string(), bonus));
        return;
    };
    for n in &list.names {
        walk(lists, n, bonus, seen, out);
    }
    for n in &list.extras {
        walk(lists, n, true, seen, out);
    }
}

/// Where every treasure in the table puts its items and sets.
pub fn drops(text: &[u8]) -> Result<Drops, KvError> {
    let lists = loot_lists(text)?;
    let mut d = Drops::default();
    for it in items_of(text)?.iter().filter(|i| i.prefab == "treasure_chest") {
        let Some(list) = treasure_list(text, it.start)? else { continue };
        let cache = it.name.to_lowercase().contains("collector's cache");
        let mut out = Vec::new();
        walk(&lists, &list, false, &mut HashSet::new(), &mut out);
        for (name, bonus) in out {
            if cache {
                d.cache.insert(name.clone());
            }
            if bonus {
                d.bonus.insert(name);
            } else {
                d.treasure.insert(name);
            }
        }
    }
    Ok(d)
}

/// The game's own order of rarities (the table's "rarities"); seasonal Battle Pass items sit with
/// the legendary ones rather than over the arcanas.
fn rank(rarity: &str) -> u32 {
    match rarity {
        "arcana" => 8,
        "immortal" => 7,
        "ancient" => 6,
        "legendary" | "seasonal" => 5,
        "mythical" => 4,
        "rare" => 3,
        "uncommon" => 2,
        "common" => 1,
        _ => 0,
    }
}

fn year(date: &str) -> u32 {
    date.get(..4).and_then(|y| y.parse::<u32>().ok()).unwrap_or(2012).saturating_sub(2012)
}

fn golden(name: &str) -> bool {
    name.starts_with("Golden ")
}

/// A pair's shared name: "Golden Offhand Basher of Mage Skulls" and "Golden Basher of Mage Skulls"
/// are one family, the plain pair another.
fn family(name: &str) -> String {
    let lower = name.to_lowercase().replace("off-hand", "offhand").replace("off hand", "offhand");
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty() && !matches!(*w, "offhand" | "mainhand" | "left" | "right" | "main"))
        .collect();
    words.join(" ")
}

/// How much a set is worth putting on first.
pub fn set_worth(set: &ItemSet, drops: &Drops) -> u32 {
    let source = if drops.cache.contains(&set.name) {
        40
    } else if drops.bonus.contains(&set.name) {
        36
    } else if drops.treasure.contains(&set.name) {
        10
    } else {
        0
    };
    let pieces = set.pieces.iter().filter(|p| matches!(p, SetPiece::Fits { .. })).count() as u32;
    source + rank(&set.rarity) * 5 + if golden(&set.name) { 10 } else { 0 } + pieces + year(&set.date)
}

/// One item put on over the set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Piece {
    pub slot: String,
    pub item_id: String,
    pub name: String,
    pub arcana: bool,
}

/// A hero's best look: the set, then the pieces that go over it.
#[derive(Debug, Clone, Default)]
pub struct Look<'a> {
    pub set: Option<&'a ItemSet>,
    pub over: Vec<Piece>,
}

/// A simple seeded generator: the same seed dresses the same way, another one draws again.
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed | 1)
    }
    pub fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % n.max(1) as u64) as usize
    }
}

/// The best look of each hero by its first hero id: the slots the builder offers (without
/// personas and ability effects slots), its sets, and where the treasures put things. Among sets
/// within a few points of the best, the draw picks one, so dressing again can give another look.
pub fn best_looks<'a>(
    slots: &[ItemSlot],
    sets: &'a [ItemSet],
    drops: &Drops,
    rng: &mut Rng,
) -> BTreeMap<String, Look<'a>> {
    let mut by_hero: BTreeMap<String, Vec<&ItemSlot>> = BTreeMap::new();
    for s in slots.iter().filter(|s| s.persona.is_none() && s.ability_fx.is_none() && s.hero_ids.len() == 1) {
        by_hero.entry(s.hero_ids[0].clone()).or_default().push(s);
    }
    let mut hero_sets: HashMap<&str, Vec<&ItemSet>> = HashMap::new();
    for set in sets {
        if set.hero_ids.len() == 1 && set.pieces.iter().all(|p| matches!(p, SetPiece::Fits { .. })) {
            hero_sets.entry(set.hero_ids[0].as_str()).or_default().push(set);
        }
    }
    let mut out = BTreeMap::new();
    for (hero, slots) in by_hero {
        let mut look = Look::default();
        if let Some(all) = hero_sets.get(hero.as_str()) {
            // a set of a piece or two is an immortal's wrapper, not a look: a real set where the hero has one
            let whole: Vec<&ItemSet> = all.iter().copied().filter(|s| s.pieces.len() >= 3).collect();
            let list = if whole.is_empty() { all } else { &whole };
            let best = list.iter().map(|s| set_worth(s, drops)).max().unwrap_or(0);
            let top: Vec<&&ItemSet> = list.iter().filter(|s| set_worth(s, drops) + 3 >= best).collect();
            look.set = Some(top[rng.below(top.len())]);
        }
        look.over = top_pieces(&slots, drops);
        out.insert(hero, look);
    }
    out
}

/// The arcana or immortal each slot gets, if it has one: the arcana first, then a pair over a
/// single piece, golden over plain, a treasure's rare extra or a cache's over the rest, newest last.
fn top_pieces(slots: &[&ItemSlot], drops: &Drops) -> Vec<Piece> {
    let prized = |o: &SlotOption| rank(o.rarity.as_deref().unwrap_or("")) >= 7;
    // in how many of the hero's slots each family has a prized piece
    let mut families: HashMap<(bool, String), HashSet<&str>> = HashMap::new();
    for s in slots {
        for o in s.options.iter().filter(|o| prized(o)) {
            families.entry((golden(&o.name), family(&o.name))).or_default().insert(&s.slot);
        }
    }
    let worth = |o: &SlotOption| -> u64 {
        let r = rank(o.rarity.as_deref().unwrap_or("")) as u64;
        let pair = families.get(&(golden(&o.name), family(&o.name))).map_or(1, HashSet::len) as u64;
        let source = if drops.bonus.contains(&o.name) {
            2
        } else if drops.cache.contains(&o.name) {
            1
        } else {
            0
        };
        r * 100_000
            + pair.min(9) * 10_000
            + u64::from(golden(&o.name)) * 1_000
            + source * 100
            + u64::from(year(o.date.as_deref().unwrap_or("")))
    };
    let mut out = Vec::new();
    for s in slots {
        // the same worth: the first by name, as the slot lists them
        let Some(best) = s.options.iter().filter(|o| prized(o)).fold(None::<&SlotOption>, |a, o| match a {
            Some(a) if worth(a) >= worth(o) => Some(a),
            _ => Some(o),
        }) else {
            continue;
        };
        out.push(Piece {
            slot: s.slot.clone(),
            item_id: best.id.clone(),
            name: best.name.clone(),
            arcana: best.rarity.as_deref() == Some("arcana"),
        });
    }
    out
}

#[cfg(test)]
#[path = "item_builder_worth_tests.rs"]
mod tests;
