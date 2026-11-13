//! Reading items_game.txt: the items section, one item's fields, the list the pickers show, the
//! free item of a slot, the game's own table out of its pak01. Rewritten from src/schema-items.ts.
//! The table is bytes (latin1 in the TypeScript), so a block found here splices back unchanged.

use std::path::Path;

use rayon::prelude::*;

use crate::kv::{self, block_bounds, each_child, each_child_with, latin1, Bounds, Braces, Child, Ends, KvError};
use crate::vpk;

/// Where the item table sits inside a VPK.
pub const SCHEMA_REL: &str = "scripts/items/items_game.txt";

/// The slots with no free item of their own (src/schema-items.ts OWNERLESS_SLOTS).
pub const OWNERLESS_SLOTS: [&str; 2] = ["multikill_banner", "tormentor"];

/// An item as the pickers read it; field for field the TypeScript SchemaItem.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaItem {
    pub id: String,
    pub name: String,
    pub slot: String,
    pub prefab: String,
    pub item_name: String,
    pub item_description: String,
    pub image: String,
    pub model: String,
    pub type_name: String,
    pub baseitem: bool,
    pub has_visuals: bool,
    pub bundle_items: Vec<String>,
    pub start: usize,
    pub end: usize,
}

fn is_digits(key: &[u8]) -> bool {
    !key.is_empty() && key.iter().all(u8::is_ascii_digit)
}

fn eq_lower(key: &[u8], word: &str) -> bool {
    key.eq_ignore_ascii_case(word.as_bytes())
}

/// The "items" section: every item definition sits directly under it.
pub fn items_section(text: &[u8]) -> kv::Result<Bounds> {
    items_section_with(text, Ends::Scan)
}

fn items_section_with(text: &[u8], ends: Ends<'_>) -> kv::Result<Bounds> {
    let root = ends.bounds(text, 0)?;
    let mut found = None;
    each_child_with(text, root, ends, |c| {
        if c.is_block() && eq_lower(c.key, "items") {
            found = c.body;
            return false;
        }
        true
    })?;
    found.ok_or(KvError::NoItems)
}

/// Direct scalar fields of an item block, keys lower-cased; a repeated key keeps the last value.
pub fn item_fields(text: &[u8], start: usize) -> kv::Result<Vec<(String, String)>> {
    let mut out: Vec<(String, String)> = Vec::new();
    each_child(text, block_bounds(text, start)?, |c| {
        if let Some(v) = c.value {
            let k = latin1(c.key).to_lowercase();
            let v = latin1(v);
            match out.iter_mut().find(|(key, _)| *key == k) {
                Some(slot) => slot.1 = v,
                None => out.push((k, v)),
            }
        }
        true
    })?;
    Ok(out)
}

/// How many numbered items the table lists.
pub fn count_items(text: &[u8]) -> kv::Result<usize> {
    let braces = Braces::new(text);
    let ends = Ends::Index(&braces);
    let section = items_section_with(text, ends)?;
    let mut n = 0;
    each_child_with(text, section, ends, |c| {
        if c.is_block() && is_digits(c.key) {
            n += 1;
        }
        true
    })?;
    Ok(n)
}

/// The scalar fields list_items reads, by position in `fields` below.
const LIST_FIELDS: [&str; 9] = [
    "name",
    "item_slot",
    "prefab",
    "item_name",
    "item_description",
    "image_inventory",
    "model_player",
    "item_type_name",
    "baseitem",
];

/// Every numbered item, as light records, in table order.
///
/// The braces are indexed once (kv::Braces) and the items read on every core: each item's block
/// is its own text, and the list comes back in table order whichever finished first.
pub fn list_items(text: &[u8]) -> kv::Result<Vec<SchemaItem>> {
    let braces = Braces::new(text);
    let ends = Ends::Index(&braces);
    let section = items_section_with(text, ends)?;
    let mut items: Vec<Child<'_>> = Vec::with_capacity(32_000);
    each_child_with(text, section, ends, |c| {
        if c.is_block() && is_digits(c.key) {
            items.push(c);
        }
        true
    })?;
    items.par_iter().map(|c| read_item(text, c, ends)).collect()
}

fn read_item(text: &[u8], c: &Child<'_>, ends: Ends<'_>) -> kv::Result<SchemaItem> {
    let body = c.body.expect("a block");
    // the last value of a repeated key wins, as Map.set does in the TypeScript
    let mut fields: [Option<&[u8]>; 9] = [None; 9];
    let mut has_visuals = false;
    let mut bundle_items = Vec::new();
    each_child_with(text, body, ends, |f| {
        match (f.value, f.body) {
            (Some(v), _) => {
                if let Some(i) = LIST_FIELDS.iter().position(|k| eq_lower(f.key, k)) {
                    fields[i] = Some(v);
                }
            }
            (None, Some(b)) => {
                if eq_lower(f.key, "visuals") {
                    has_visuals = true;
                } else if eq_lower(f.key, "bundle") {
                    let _ = each_child_with(text, b, ends, |bi| {
                        if bi.value == Some(b"1") {
                            bundle_items.push(latin1(bi.key));
                        }
                        true
                    });
                }
            }
            _ => {}
        }
        true
    })?;
    let get = |i: usize| fields[i].map(latin1).unwrap_or_default();
    Ok(SchemaItem {
        id: latin1(c.key),
        name: get(0),
        slot: get(1),
        prefab: get(2),
        item_name: get(3),
        item_description: get(4),
        image: get(5),
        model: get(6),
        type_name: get(7),
        baseitem: fields[8] == Some(b"1"),
        has_visuals,
        bundle_items,
        start: c.start,
        end: c.end,
    })
}

/// Every item of a table, listed once per table (src/schema-items.ts keeps its list per text).
pub fn items_of(text: &[u8]) -> kv::Result<std::sync::Arc<Vec<SchemaItem>>> {
    static SLOT: crate::memo::Slot<Vec<SchemaItem>> = std::sync::Mutex::new(None);
    crate::memo::per_text(&SLOT, text, list_items)
}

/// One item definition by id, with its exact byte range.
pub fn find_item(text: &[u8], id: &str, section: Option<Bounds>) -> kv::Result<Option<(usize, usize)>> {
    let bounds = match section {
        Some(b) => b,
        None => items_section(text)?,
    };
    let mut hit = None;
    each_child(text, bounds, |c| {
        if c.is_block() && c.key == id.as_bytes() {
            hit = Some((c.start, c.end));
            return false;
        }
        true
    })?;
    Ok(hit)
}

/// A latin1 name as the person should read it: raw UTF-8 bytes decoded, if there are any.
pub fn to_utf8(s: &str) -> String {
    if s.chars().any(|c| ('\u{80}'..='\u{ff}').contains(&c)) {
        let bytes: Vec<u8> = s.chars().map(|c| c as u32 as u8).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        s.to_string()
    }
}

fn slot_of(item: &SchemaItem) -> &str {
    if item.slot.is_empty() {
        &item.prefab
    } else {
        &item.slot
    }
}

/// A hero item's slot as the game reads it: no item_slot on a wearable means a weapon.
pub fn inferred_item_slot(item: &SchemaItem) -> String {
    if !item.slot.is_empty() {
        return item.slot.clone();
    }
    if item.prefab == "wearable" || item.prefab == "default_item" {
        "weapon".into()
    } else {
        String::new()
    }
}

/// The free base item of a slot.
pub fn base_item_for<'a>(items: &'a [SchemaItem], slot: &str) -> Option<&'a SchemaItem> {
    items.iter().find(|i| i.baseitem && slot_of(i) == slot)
}

/// What can be put on a slot's base item, by the schema's English name, A-Z.
pub fn cosmetic_options(items: &[SchemaItem], slot: &str) -> Vec<(String, String)> {
    let ownerless = OWNERLESS_SLOTS.contains(&slot);
    let mut out: Vec<(String, String)> = items
        .iter()
        .filter(|i| slot_of(i) == slot && !i.baseitem && (i.has_visuals || ownerless) && !i.name.is_empty())
        .map(|i| (i.id.clone(), to_utf8(&i.name)))
        .collect();
    // localeCompare, which is what the pickers sort by: an apostrophe comes before the letters
    out.sort_by(|a, b| crate::js::locale_compare(&a.1, &b.1));
    out
}

/// The game's own table out of its pak01, and the stamp that changes when an update replaces it.
pub fn read_game_schema(game_path: &Path) -> Result<(Vec<u8>, String), String> {
    let pak = game_path.join("dota").join("pak01_dir.vpk");
    if !pak.exists() {
        return Err(crate::i18n::t("Не найден {0}", &[serde_json::json!(pak.to_string_lossy())]));
    }
    let (data, crc) = vpk::read_entry_file(&pak, SCHEMA_REL)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| crate::i18n::t("items_game.txt не найден в pak01 игры", &[]))?;
    let stamp = format!("{}:{}", data.len(), crc);
    Ok((data, stamp))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &[u8] = br#""items_game"
{
	"game_info" { "x" "1" }
	"items"
	{
		"default" { "name" "skip me" }
		"555"
		{
			"name"		"Default Weather"
			"prefab"		"weather"
			"baseitem"		"1"
		}
		"7000"
		{
			"name"		"Ash"
			"prefab"		"weather"
			"visuals" { }
			"bundle" { "7001" "1" "7002" "0" }
		}
	}
}"#;

    #[test]
    fn lists_numbered_items_with_their_ranges() {
        let items = list_items(TABLE).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "Default Weather");
        assert!(items[0].baseitem);
        assert!(items[1].has_visuals);
        assert_eq!(items[1].bundle_items, ["7001"]);
        let block = &TABLE[items[1].start..items[1].end];
        assert!(block.starts_with(b"\"7000\"") && block.ends_with(b"}"));
        assert_eq!(count_items(TABLE).unwrap(), 2);
        assert_eq!(base_item_for(&items, "weather").unwrap().id, "555");
        assert_eq!(cosmetic_options(&items, "weather"), [("7000".to_string(), "Ash".to_string())]);
        assert_eq!(find_item(TABLE, "7000", None).unwrap(), Some((items[1].start, items[1].end)));
    }
}
