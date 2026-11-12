//! The parts of Dota 2 Mod Manager that read and write the game's files, rewritten from src/*.ts.
//! Every module names the TypeScript file it replaces; docs/rust-migration.md keeps the list.

pub mod kv;
pub mod schema;
pub mod vpk;
