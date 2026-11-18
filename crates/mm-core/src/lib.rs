//! The parts of Dota 2 Mod Manager that read and write the game's files, rewritten from the
//! TypeScript core the repository held until tag v3.8.0. A comment naming src/*.ts or test/*.ts,
//! or "the TypeScript", means that core as the tag has it, where the reasons are written out at
//! length: `git show v3.8.0:src/patcher.ts`.

// The crate's public API is what the shell (src-tauri), mm-cli and the tests in tests/ call, and
// nothing more: everything else is crate-private, so rustc reports code nobody calls. A module the
// shell needs moves from `pub(crate) use` to `pub use` below.
pub(crate) mod app;
pub(crate) mod arcana;
pub(crate) mod catalog;
pub(crate) mod formats;
pub(crate) mod game;
pub(crate) mod install;
pub(crate) mod item_builder;
pub(crate) mod looks;
pub(crate) mod models;
pub mod owner;
pub(crate) mod presets;
pub mod schema;
pub(crate) mod tools;
pub(crate) mod util;

// Every module keeps the path it had before the folders: crate::kv, mm_core::vpk.
pub(crate) use app::{
    app_info, app_log, diagnostics, discord_auth, discord_presence, disk_space, folder_size, mod_doctor, notice_text,
    presence_status, settings, settings_view, support_prompt, ui_lang,
};
pub use app::{cli, host_env, i18n, main_window, portable_update, tray, updater, write_jail};
pub use arcana::arcana_base_store;
pub use arcana::build_arcana;
pub(crate) use arcana::{
    arcana_base_color, arcana_bases, arcana_notes, arcana_service, emblem_ring, gem_colors, persona_base_effects,
    rank_look, rank_look_service,
};
pub use catalog::{beta, catalog_signature, deep_links, net_fetch, preview_cache, remote_config};
pub(crate) use catalog::{
    download_stats, feature_gate, fingerprints, icon_match, mod_preview, mod_preview_pick, net_mirrors, wiki_icons,
};
pub use catalog::{Catalog, RAW_BASE};
pub(crate) use formats::{cursor_files, glb_embed, lz4, material, meshopt, panorama_files, png_paint, png_strip};
pub use formats::{kv, kv3, pak_stamp, resource, safe_zip, vpk, vpk_analyze, vpk_pack, vpk_shared, vtex};
pub(crate) use game::{
    game_icons, game_repair, game_upkeep, hero_grid, minify, patch_watch, scream_guard, steam_appstate, terrain_age,
    update_impact,
};
pub use game::{game_watch, gamelang, hero_names, patcher, patcher_gameinfo, patcher_signatures, steam};
pub(crate) use install::{
    adopt, atomic_file, generated_pak, import, installer_downloads, installer_files, installer_folder, installer_slots,
    installer_write, library, mod_id, mod_update, mods_listing, overlays, remove_everything, slot_zones,
};
pub use install::{file_tx, installer, installer_repack, uninstall};
pub use item_builder::item_effect_patch;
pub(crate) use item_builder::{
    ability_icons, ability_icons_service, ability_sounds, ability_sounds_service, cosmetic_names,
    item_builder_ability_fx, item_builder_assets, item_builder_donor, item_builder_effects, item_builder_everyone,
    item_builder_everyone_budget, item_builder_fx_patch, item_builder_kinetic, item_builder_personas,
    item_builder_refits, item_builder_sets, item_builder_styles, item_portraits, item_skin, item_sounds, item_visuals,
};
pub use item_builder::{item_builder_details, item_builder_slots, unusual_effects};
pub(crate) use looks::{
    cursor_maker, cursors, effect_edit, effect_edit_service, effect_finder, fx_in_use, ground_build, ground_facets,
    hero_paint_service, hero_portrait_service, hud_scale, hud_scale_service, map_base, map_build, map_decor,
    map_ground, map_light, map_looks_service, map_make, map_mod_trees, map_optimize, map_paint, map_scene,
    menu_background, menu_background_service, own_music, own_music_service, pumpkin, recolor_layers, recolor_modes,
};
pub use looks::{recolor, tower_looks, tree_sets};
pub(crate) use models::{
    courier_models, hero_companions, hero_particle_styles, hero_preview, hero_preview_fx, hero_preview_picks,
    hero_showcase, loadout_material, loadout_resources, loadout_sheet, mod_look, mod_props, model_attachments,
    model_bodygroups, model_cloth, model_glb, model_loadout, model_merge, model_scale, model_sequences, model_skin,
    model_snapshot_fallback, model_style_meshes, particle_snapshot, particle_spec, particle_surface,
    razor_crest_preview,
};
pub use models::{model_hitboxes, model_particles};
pub use owner::{
    calls, channel_args, owner_links, owner_presence, owner_start, owner_uninstall, owner_update, owner_watch,
};
pub(crate) use owner::{
    large_answer, owner_app, owner_bases, owner_compiler, owner_creator, owner_foreign, owner_game, owner_library,
    owner_mod_look, owner_mods, owner_packs, owner_pictures, owner_presets, owner_preview3d, owner_settings,
    owner_studios, owner_support, owner_tools,
};
pub(crate) use presets::{
    preset_install, preset_link, preset_plan, preset_share, presets_service, ready_presets, ready_presets_format,
};
pub(crate) use schema::{
    build_undo, item_files, item_files_service, item_in_body, item_replacement, schema_build, schema_cosmetics,
    schema_harvest,
};
pub use schema::{schema_deploy, schema_merge, schema_service};
pub(crate) use tools::{creator, resource_compiler, run_process, toolchain, wine, workshop_tools};
pub(crate) use util::memo;
pub use util::{data, js};
