//! The parts of Dota 2 Mod Manager that read and write the game's files, rewritten from src/*.ts.
//! Every module names the TypeScript file it replaces; docs/rust-migration.md keeps the list.

pub mod app;
pub mod arcana;
pub mod catalog;
pub mod formats;
pub mod game;
pub mod install;
pub mod item_builder;
pub mod looks;
pub mod models;
pub mod owner;
pub mod presets;
pub mod schema;
pub mod tools;
pub mod util;

// Every module keeps the path it had before the folders: crate::kv, mm_core::vpk.
pub use app::{
    app_info, app_log, cli, diagnostics, discord_auth, discord_presence, disk_space, folder_size, i18n, main_window,
    mod_doctor, notice_text, portable_update, presence_status, settings, settings_view, support_prompt, tray, ui_lang,
    updater, write_jail,
};
pub use arcana::{
    arcana_base_color, arcana_base_store, arcana_bases, arcana_notes, arcana_service, emblem_ring, gem_colors,
    persona_base_effects, rank_look, rank_look_service,
};
pub use catalog::{
    beta, catalog_signature, deep_links, download_stats, feature_gate, fingerprints, icon_match, mod_preview,
    mod_preview_pick, net_fetch, net_mirrors, preview_cache, remote_config, wiki_icons,
};
pub use formats::{
    glb_embed, kv, kv3, lz4, material, meshopt, pak_stamp, panorama_files, png_paint, png_strip, resource, safe_zip,
    vpk, vpk_analyze, vpk_pack, vpk_shared, vtex,
};
pub use game::{
    game_icons, game_repair, game_upkeep, game_watch, gamelang, hero_grid, hero_names, minify, patch_watch, patcher,
    patcher_gameinfo, patcher_signatures, scream_guard, steam, steam_appstate, terrain_age, update_impact,
};
pub use install::{
    adopt, atomic_file, file_tx, generated_pak, import, installer, installer_downloads, installer_files,
    installer_folder, installer_repack, installer_slots, installer_write, library, mod_id, mod_update, mods_listing,
    overlays, remove_everything, slot_zones, uninstall,
};
pub use item_builder::{
    ability_icons, ability_icons_service, ability_sounds, ability_sounds_service, cosmetic_names,
    item_builder_ability_fx, item_builder_assets, item_builder_details, item_builder_donor, item_builder_effects,
    item_builder_everyone, item_builder_everyone_budget, item_builder_fx_patch, item_builder_kinetic,
    item_builder_personas, item_builder_refits, item_builder_sets, item_builder_slots, item_builder_styles,
    item_portraits, item_skin, item_sounds, item_visuals, unusual_effects,
};
pub use looks::{
    cursors, effect_edit, effect_edit_service, effect_finder, ground_build, ground_facets, hero_paint_service,
    hud_scale, hud_scale_service, map_base, map_build, map_decor, map_ground, map_light, map_looks_service, map_make,
    map_mod_trees, map_optimize, map_paint, map_scene, menu_background, menu_background_service, pumpkin, recolor,
    recolor_layers, recolor_modes, tower_looks, tree_sets,
};
pub use models::{
    courier_models, hero_companions, hero_particle_styles, hero_preview, hero_preview_fx, hero_preview_picks,
    hero_showcase, loadout_material, loadout_resources, loadout_sheet, mod_look, model_attachments, model_bodygroups,
    model_cloth, model_glb, model_hitboxes, model_loadout, model_merge, model_particles, model_scale, model_sequences,
    model_skin, model_snapshot_fallback, model_style_meshes, particle_snapshot, particle_spec, particle_surface,
    razor_crest_preview,
};
pub use owner::{
    calls, channel_args, large_answer, owner_app, owner_bases, owner_compiler, owner_creator, owner_foreign,
    owner_game, owner_library, owner_links, owner_mod_look, owner_mods, owner_packs, owner_pictures, owner_presence,
    owner_presets, owner_preview3d, owner_settings, owner_start, owner_studios, owner_support, owner_tools,
    owner_uninstall, owner_update, owner_watch,
};
pub use presets::{
    preset_install, preset_link, preset_plan, preset_share, presets_service, ready_presets, ready_presets_format,
};
pub use schema::{
    background_builds, build_undo, item_files, item_files_service, schema_build, schema_cosmetics, schema_deploy,
    schema_harvest, schema_merge, schema_service,
};
pub use tools::{creator, resource_compiler, run_process, toolchain, wine, workshop_tools};
pub use util::{data, js, memo};
