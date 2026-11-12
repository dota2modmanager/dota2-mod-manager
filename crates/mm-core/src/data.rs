//! The tables the TypeScript modules hold, as tools/rust-data.mjs writes them to
//! crates/mm-core/data/: lists of [key, value] pairs in the module's order, read once.

use indexmap::IndexMap;
use std::sync::OnceLock;

/// A table of strings, in the order its module lists them.
pub type Table = IndexMap<String, String>;

fn parse(text: &str) -> Table {
    let pairs: Vec<(String, String)> =
        serde_json::from_str(text).expect("a data table that is not a list of string pairs");
    let mut t = IndexMap::with_capacity(pairs.len());
    for (k, v) in pairs {
        // a key listed twice keeps its first place and its last value, as an object literal does
        t.insert(k, v);
    }
    t
}

macro_rules! table {
    ($name:ident, $file:literal) => {
        pub fn $name() -> &'static Table {
            static T: OnceLock<Table> = OnceLock::new();
            T.get_or_init(|| parse(include_str!(concat!("../data/", $file))))
        }
    };
}

table!(i18n_en, "i18n-en.json");
table!(i18n_zh_cn, "i18n-zh-CN.json");
table!(hero_display, "hero-display.json");
table!(hero_alias, "hero-alias.json");

/// A list table read into the type its rows are.
fn list<T: serde::de::DeserializeOwned>(text: &str) -> Vec<T> {
    serde_json::from_str(text).expect("a data table that is not a list of its rows")
}

/// The item builder's own effects (src/item-builder-effects.ts ITEM_EFFECTS), in the picker's order.
pub fn item_effects() -> &'static [crate::item_builder_effects::ItemEffect] {
    static T: OnceLock<Vec<crate::item_builder_effects::ItemEffect>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/item-effects.json")))
}
