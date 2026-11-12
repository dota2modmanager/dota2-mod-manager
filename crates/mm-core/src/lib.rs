//! The parts of Dota 2 Mod Manager that read and write the game's files, rewritten from src/*.ts.
//! Every module names the TypeScript file it replaces; docs/rust-migration.md keeps the list.

pub mod calls;
pub mod cosmetic_names;
pub mod data;
pub mod hero_names;
pub mod i18n;
pub mod item_builder_donor;
pub mod item_builder_effects;
pub mod item_builder_styles;
pub mod item_visuals;
pub mod js;
pub mod kv;
pub mod kv3;
pub mod lz4;
pub mod memo;
pub mod resource;
pub mod schema;
pub mod schema_merge;
pub mod unusual_effects;
pub mod vpk;
