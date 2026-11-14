//! Putting mods into the game and keeping the record of them: the installer, the library, imports and removal.

pub mod adopt;
pub mod atomic_file;
pub mod file_tx;
pub mod generated_pak;
pub mod import;
pub mod installer;
pub mod installer_downloads;
pub mod installer_files;
pub mod installer_folder;
pub mod installer_repack;
pub mod installer_slots;
pub mod installer_write;
pub mod library;
pub mod mod_id;
pub mod mod_update;
pub mod mods_listing;
pub mod overlays;
pub mod remove_everything;
pub mod slot_zones;
pub mod uninstall;
