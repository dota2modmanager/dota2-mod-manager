//! The items an added effect may go on (the item builder's effects tab): one the game ever let roll
//! an unusual (`"can roll unusual"` in its static attributes), and one with no effect of its own:
//! the table creates no particle for it, and its model lists none (`particle_cfg_list`; a built pick
//! puts the table's there too, item_files.rs). An item with effects of its own that never
//! came out unusual keeps them alone: an unusual on top of them was never a look the game had.

use std::collections::HashSet;
use std::sync::Arc;

use rayon::prelude::*;

use crate::kv::KvError;
use crate::memo;
use crate::schema::{items_of, SchemaItem};
use crate::vpk::Index;

const KEY: &[u8] = b"\"can roll unusual\"";

/// Whether an item's block says it can roll an unusual: the key with a value that is not 0, or the
/// key's block (`attribute_class`, `value`) with one.
pub fn can_roll_unusual(block: &[u8]) -> bool {
    let lower = crate::schema_merge::latin1_lower(block);
    let mut from = 0;
    while let Some(at) = memchr::memmem::find(&lower[from..], KEY).map(|i| i + from) {
        let rest = &lower[at + KEY.len()..];
        let rest = &rest[rest.iter().take_while(|c| c.is_ascii_whitespace()).count()..];
        let value: &[u8] = match rest.first() {
            Some(b'"') => rest[1..].split(|&c| c == b'"').next().unwrap_or(b""),
            Some(b'{') => {
                let body = rest.split(|&c| c == b'}').next().unwrap_or(b"");
                match memchr::memmem::find(body, b"\"value\"") {
                    Some(v) => body[v + 7..].split(|&c| c == b'"').nth(1).unwrap_or(b""),
                    None => b"",
                }
            }
            _ => b"",
        };
        if !value.is_empty() && value != b"0" {
            return true;
        }
        from = at + 1;
    }
    false
}

/// An item block's visuals block, if it has one.
fn visuals_in(block: &[u8]) -> Option<&[u8]> {
    let mut out = None;
    let bounds = crate::kv::block_bounds(block, 0).ok()?;
    crate::kv::each_child(block, bounds, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            out = Some(&block[c.start..c.end]);
            return false;
        }
        true
    })
    .ok()?;
    out
}

fn compiled(p: &str) -> String {
    let p = p.replace('\\', "/").to_lowercase();
    format!("{}_c", p.strip_suffix("_c").unwrap_or(&p))
}

/// Whether an added effect may go on this item. A model that cannot be read counts as one with
/// effects: nothing says it has none.
fn fits(text: &[u8], item: &SchemaItem, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> bool {
    if can_roll_unusual(&text[item.start..item.end]) {
        return true;
    }
    if item.model.is_empty() {
        return false;
    }
    // an effect the table creates goes into the model's list once the pick is built (item_files.rs)
    let block = &text[item.start..item.end];
    let visuals = visuals_in(block);
    if crate::item_builder_donor::has_own_effect(block, visuals).unwrap_or(true) {
        return false;
    }
    match read(&compiled(&item.model)) {
        Some(model) => crate::model_particles::model_particle_entries(Some(&model)).is_empty(),
        None => false,
    }
}

/// The ids of the items an added effect may go on, read once per table: every model of the table
/// is opened, so the slots ask here and not item by item.
pub fn unusual_fits(text: &[u8], ix: &Index) -> Result<Arc<HashSet<String>>, KvError> {
    static SLOT: memo::Slot<HashSet<String>> = std::sync::Mutex::new(None);
    let items = items_of(text)?;
    memo::per_text(&SLOT, text, |t| {
        let read = |p: &str| ix.read(p).ok().flatten();
        Ok::<_, KvError>(items.par_iter().filter(|i| fits(t, i, &read)).map(|i| i.id.clone()).collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// On the game's own files (MM_TEST_PAK01 = a pak01_dir.vpk): items that rolled an unusual are
    /// in, an item whose model has its own particles and never rolled one is out, and the whole
    /// table is read in a time a window can wait for.
    #[test]
    fn on_the_games_own_table() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = Index::open(std::path::Path::new(&pak)).unwrap();
        let text = ix.read(crate::schema::SCHEMA_REL).unwrap().unwrap();
        let started = std::time::Instant::now();
        let fits = unusual_fits(&text, &ix).unwrap();
        let took = started.elapsed();
        let items = items_of(&text).unwrap();
        let rolled = items.iter().filter(|i| can_roll_unusual(&text[i.start..i.end])).count();
        let modelled = items.iter().filter(|i| !i.model.is_empty()).count();
        eprintln!(
            "unusual fits: {} of {} items ({modelled} with a model, {rolled} rolled one) in {took:?}",
            fits.len(),
            items.len()
        );
        assert!(rolled > 50, "{rolled}");
        assert!(items.iter().filter(|i| can_roll_unusual(&text[i.start..i.end])).all(|i| fits.contains(&i.id)));
        assert!(fits.len() < modelled, "some model has an effect of its own");
    }

    #[test]
    fn an_item_that_could_roll_an_unusual_says_so_either_way_the_table_writes_it() {
        let plain = b"\"9500\"\n{\n\t\"static_attributes\"\n\t{\n\t\t\"can roll unusual\"\t\t\"1\"\n\t}\n}";
        let block = b"\"9500\"\n{\n\t\"static_attributes\"\n\t{\n\t\t\"can roll unusual\"\n\t\t{\n\t\t\t\"attribute_class\"\t\t\"can roll unusual\"\n\t\t\t\"value\"\t\t\"1\"\n\t\t}\n\t}\n}";
        assert!(can_roll_unusual(plain));
        assert!(can_roll_unusual(block));
        assert!(!can_roll_unusual(b"\"9500\"\n{\n\t\"can roll unusual\"\t\"0\"\n}"));
        assert!(!can_roll_unusual(b"\"9500\"\n{\n\t\"name\"\t\"x\"\n}"));
    }

    #[test]
    fn a_model_with_its_own_particles_takes_none_unless_the_item_rolled_one() {
        let item = |model: &str| SchemaItem {
            id: "1".into(),
            name: String::new(),
            slot: String::new(),
            prefab: String::new(),
            item_name: String::new(),
            item_description: String::new(),
            image: String::new(),
            model: model.into(),
            type_name: String::new(),
            baseitem: false,
            has_visuals: false,
            bundle_items: vec![],
            start: 0,
            end: 4,
        };
        let nothing = |_: &str| None;
        // a model that cannot be read is not taken for one without effects
        assert!(!fits(b"\"1\"{}", &item("models/items/x/x.vmdl"), &nothing));
        assert!(!fits(b"\"1\"{}", &item(""), &nothing));
        let rolls = b"\"1\"{\"can roll unusual\" \"1\"}";
        let mut i = item("models/items/x/x.vmdl");
        i.end = rolls.len();
        assert!(fits(rolls, &i, &nothing));
    }
}
