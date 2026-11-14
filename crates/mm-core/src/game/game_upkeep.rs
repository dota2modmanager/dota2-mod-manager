//! Keeping the game folder the way the user left it, while other programs change it underneath
//! (src/game-upkeep.ts). The game's audio language decides which folder the engine mounts, so
//! mods follow it; Steam's file check and a Dota patch are src/game-repair.ts's. Once at start,
//! before the window opens, and nothing written while Dota runs: it holds gameinfo and its paks
//! open, and rewrites boot.vcfg when it exits.
//!
//! The TypeScript asks the system whether Dota runs and looks for the game itself; here both are
//! handed in. A start is three calls: `check_game_path`, which can change the game folder, and
//! `lang_folder_step`, which can change the folder mods live in (the caller makes its Installer
//! after both, over `lang_folder()`), then `start_steps`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::game_repair::{GameRepair, Impact, Rebuild};
use crate::gamelang;
use crate::schema_service::{Ctx, SchemaService};
use crate::settings::Settings;

/// How long a file a killed transaction parked is kept before it is dropped.
pub const STAGED_MAX_AGE_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// Auto-detect on first run, and again whenever the saved path stopped being a Dota install: a
/// library moved to another drive leaves the old tree behind. Nothing valid anywhere forgets the
/// dead path: every write after this refuses without one, which is the honest answer.
pub fn check_game_path(
    settings: &mut Settings,
    valid: &dyn Fn(&Path) -> bool,
    find: &mut dyn FnMut() -> Option<String>,
    diag: &mut dyn FnMut(String),
) -> Result<(), String> {
    let stale = settings.get("dotaGamePath").cloned().unwrap_or(Value::Null);
    let stale_text = stale.as_str().filter(|s| !s.is_empty()).map(str::to_string);
    if stale_text.as_deref().is_some_and(|s| valid(Path::new(s))) {
        return Ok(());
    }
    let io = |e: std::io::Error| e.to_string();
    match find().filter(|f| !f.is_empty()) {
        Some(found) => {
            if crate::js::truthy(&stale) && stale != json!(found) {
                diag(format!("game path {} is no longer an install, moved to {found}", crate::js::string(&stale)));
            }
            settings.set("dotaGamePath", json!(found)).map_err(io)
        }
        None if crate::js::truthy(&stale) => {
            diag(format!(
                "game path {} is not an install and Dota was not found; clearing it",
                crate::js::string(&stale)
            ));
            settings.set("dotaGamePath", Value::Null).map_err(io)
        }
        None => Ok(()),
    }
}

/// The upkeep's own state: the folder mods live in, and the moves Settings tells about once.
pub struct GameUpkeep {
    lang_folder: String,
    lang_migration: Option<Value>,
    slot_migration: Option<Value>,
    pub repair: GameRepair,
}

impl Default for GameUpkeep {
    fn default() -> Self {
        GameUpkeep {
            lang_folder: gamelang::FALLBACK_FOLDER.to_string(),
            lang_migration: None,
            slot_migration: None,
            repair: GameRepair::default(),
        }
    }
}

fn game_of(settings: &Settings) -> Option<PathBuf> {
    settings.get("dotaGamePath").filter(|v| crate::js::truthy(v)).map(|v| PathBuf::from(crate::js::string(v)))
}

impl GameUpkeep {
    pub fn lang_folder(&self) -> &str {
        &self.lang_folder
    }

    /// The move of mods into the folder the game mounts, handed over once.
    pub fn take_lang_migration(&mut self) -> Option<Value> {
        self.lang_migration.take()
    }

    pub fn take_slot_migration(&mut self) -> Option<Value> {
        self.slot_migration.take()
    }

    /// Mods follow the game's audio language. Korean and Chinese voices have folders of their own
    /// and keep them; English has none, so it gets dota_russian written into the audio setting
    /// and hears no difference. A `-language` launch option is followed, not overruled, and a
    /// folder the user keeps in Settings stays where it is.
    pub fn keep_mod_folder(
        &mut self,
        settings: &mut Settings,
        running: &mut dyn FnMut() -> bool,
        diag: &mut dyn FnMut(String),
    ) -> Result<(), String> {
        let Some(game) = game_of(settings) else { return Ok(()) };
        let lang = gamelang::detect_lang_suffix(Some(&game));
        let launched = gamelang::launch_language(Some(&game)).filter(|l| !l.is_empty());
        let lock = settings.get("langFolderLock").and_then(Value::as_str).map(str::to_string);
        let chosen = gamelang::mod_folder_for(launched.as_deref(), lang.suffix.as_deref(), lock.as_deref());
        self.lang_folder = chosen.suffix.clone();
        let folder = self.lang_folder.clone();
        let locked = chosen.locked == Some(true);
        if chosen.followed {
            diag(format!("launch option -language {folder}: following it instead of setting the voice language"));
        } else if let (true, Some(l)) = (locked, &launched) {
            diag(format!("mods kept in dota_{folder}; launch option -language {l} mounts dota_{l} while it is set"));
        } else if lang.suffix.as_deref() != Some(folder.as_str()) {
            if running() {
                diag(format!(
                    "audio language is {}, Dota is running - leaving boot.vcfg alone",
                    lang.suffix.as_deref().unwrap_or("null")
                ));
                return Ok(());
            }
            gamelang::write_boot_languages(&game, None, Some(&folder)).map_err(|e| e.to_string())?;
            diag(format!("audio language {} -> {folder}", lang.suffix.as_deref().unwrap_or("null")));
        }
        gamelang::ensure_lang_folder(&game, &folder).map_err(|e| e.to_string())?;
        // whatever the mods were following before: our own last setting, and the folder the game
        // was mounting until a moment ago; a folder the user keeps takes back only our own
        let ours = settings.get("langSuffix").and_then(Value::as_str).map(str::to_string);
        let mounted = if locked && launched.is_some() { None } else { lang.suffix.clone() };
        let mut from: Vec<String> = Vec::new();
        for s in [ours, mounted].into_iter().flatten() {
            if !s.is_empty() && s != folder && !from.contains(&s) {
                from.push(s);
            }
        }
        let mut moved = 0;
        for old in &from {
            moved += gamelang::move_lang_folder(Some(&game), Some(old), Some(&folder));
        }
        if moved > 0 {
            self.lang_migration = Some(json!({ "from": from[0], "to": folder, "moved": moved }));
            diag(format!("mods moved into dota_{folder}: {moved} files from {}", from.join(", ")));
        }
        settings.set("langSuffix", json!(folder)).map_err(|e| e.to_string())
    }

    /// `keep_mod_folder` as the first step at start: a failure is logged and the start goes on.
    pub fn lang_folder_step(
        &mut self,
        settings: &mut Settings,
        running: &mut dyn FnMut() -> bool,
        diag: &mut dyn FnMut(String),
    ) {
        if let Err(e) = self.keep_mod_folder(settings, running, diag) {
            diag(format!("lang folder sync skipped: {e}"));
        }
    }

    /// The load order in two parts, once (src/slot-zones.ts). It renames files the game holds open,
    /// so it waits for a start with Dota closed; a failure puts everything back and tries again.
    pub fn layout_slots_once(&mut self, ctx: &mut Ctx, running: &mut dyn FnMut() -> bool) -> Result<(), String> {
        if ctx.settings.get("slotZones").and_then(Value::as_f64) == Some(1.0) {
            return Ok(());
        }
        if running() {
            (ctx.log)("load order layout: Dota is running, trying on the next start".into());
            return Ok(());
        }
        let moved = crate::slot_zones::migrate_slot_zones(ctx.inst, ctx.lib)?;
        ctx.settings.set("slotZones", json!(1)).map_err(|e| e.to_string())?;
        if let Some(n) = moved.filter(|n| *n > 0) {
            self.slot_migration = Some(json!({ "moved": n }));
            (ctx.log)(format!("load order layout: {n} mod(s) moved into their part of the order"));
        }
        Ok(())
    }

    /// Everything else put right before the window opens, each step on its own: a step that fails
    /// is logged and the next one runs. `ctx.log` is the app's log. The steps the app holds the
    /// services for (`cursor reconcile`, `schema migrate`, `cosmetic migrate`, `arcana bases`) go
    /// to `other` by name. Answers whether the item table wants a build in the background.
    #[allow(clippy::too_many_arguments)]
    pub fn start_steps(
        &mut self,
        schema: &mut SchemaService,
        ctx: &mut Ctx,
        running: &mut dyn FnMut() -> bool,
        impact: Option<&Impact>,
        rebuild: Option<Rebuild>,
        other: &mut dyn FnMut(&str, &mut Ctx) -> Result<(), String>,
        now: f64,
    ) -> bool {
        let mut wants = false;
        let mut rebuild = rebuild;
        let names = [
            "legacy pak migration",
            "load order layout",
            "multi-part merge",
            "cursor reconcile",
            "staged sweep",
            "schema migrate",
            "cosmetic migrate",
            "repair at start",
            "arcana bases",
        ];
        for name in names {
            let r: Result<(), String> = match name {
                "legacy pak migration" => ctx.inst.migrate_legacy_priority_paks(ctx.lib),
                "load order layout" => self.layout_slots_once(ctx, running),
                "multi-part merge" => ctx.inst.merge_multi_part_records(ctx.lib),
                "staged sweep" => {
                    let (restored, dropped) = ctx.inst.sweep_staged(&ctx.inst.tools_dir(), STAGED_MAX_AGE_MS);
                    if restored > 0 || dropped > 0 {
                        (ctx.log)(format!("staged files: {restored} restored, {dropped} dropped"));
                    }
                    Ok(())
                }
                "repair at start" => {
                    // the repair's lines go to the same log, after the step's own
                    let mut lines: Vec<String> = Vec::new();
                    wants =
                        self.repair.repair_at_start(schema, ctx, impact, rebuild.take(), now, &mut |m| lines.push(m));
                    for l in lines {
                        (ctx.log)(l);
                    }
                    Ok(())
                }
                n => other(n, ctx),
            };
            if let Err(e) = r {
                (ctx.log)(format!("{name} skipped: {e}"));
            }
        }
        wants
    }
}
