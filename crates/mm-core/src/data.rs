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

/// The arcana bases (src/arcana-bases.ts ARCANA_BASES), in their order.
pub fn arcana_bases() -> &'static [crate::arcana_notes::ArcanaBase] {
    static T: OnceLock<Vec<crate::arcana_notes::ArcanaBase>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/arcana-bases.json")))
}

/// Arcanas played and found wanting, by hero (src/arcana-notes.ts ARCANA_NOTES).
pub fn arcana_notes() -> &'static [(String, crate::arcana_notes::Noted)] {
    static T: OnceLock<Vec<(String, crate::arcana_notes::Noted)>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/arcana-notes.json")))
}

/// Arcanas played and found to work, by hero.
pub fn arcanas_that_work() -> &'static [String] {
    static T: OnceLock<Vec<String>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/arcanas-that-work.json")))
}

/// Heroes none of whose items have been played through the builder yet.
pub fn heroes_not_checked() -> &'static [String] {
    static T: OnceLock<Vec<String>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/heroes-not-checked.json")))
}

/// The arcanas the app can build (src/arcana-sets.ts ARCANA_SETS), by name, in its order.
pub fn arcana_sets() -> &'static [(String, crate::arcana::ArcanaSet)] {
    static T: OnceLock<Vec<(String, crate::arcana::ArcanaSet)>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/arcana-sets.json")))
}

/// What src/recolor.ts can recolour (src/recolor-sets.ts RECOLOR_SETS), by name, in its order.
pub fn recolor_sets() -> &'static [(String, crate::recolor::RecolorSet)] {
    static T: OnceLock<Vec<(String, crate::recolor::RecolorSet)>> = OnceLock::new();
    T.get_or_init(|| list(include_str!("../data/recolor-sets.json")))
}
