//! Everything the Settings screen is told, in one answer (src/settings-view.ts): the stored values
//! plus the facts about this machine only the main process can answer (the game path is valid,
//! the folder the game will really mount, whose mods those are, what Minify is doing, and what is
//! stranded outside the folder). Both settings channels answer with this, never the bare store.

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::gamelang;
use crate::minify::{self, FolderCount, MinifyInput};

/// What the view is built from besides settings.json.
pub struct ViewInput<'a> {
    /// settings.all()
    pub settings: Map<String, Value>,
    /// the library's records
    pub records: &'a [Value],
    pub discord_configured: bool,
    /// the folder the app keeps its mods in now
    pub lang_folder: &'a str,
    /// the one-time news about a folder move, and about the load order being laid out
    pub migration: Value,
    pub slot_migration: Value,
    /// Minify's own config, as minify::read_config found it
    pub minify_config: Option<minify::MinifyConfig>,
}

/// How many paks in dota_<suffix> are Minify's own.
fn minify_mods_in(game: Option<&Path>, suffix: &str) -> usize {
    let (Some(game), false) = (game, suffix.is_empty()) else { return 0 };
    let dir = game.join(format!("dota_{suffix}"));
    let Ok(names) = std::fs::read_dir(&dir) else { return 0 };
    names
        .flatten()
        .filter(|e| {
            let low = e.file_name().to_string_lossy().to_lowercase();
            let pak = ["_dir.vpk", "_dir.vpk.off", "_dir.vpk.moff"].iter().any(|s| low.ends_with(s));
            pak && (minify::is_minify_file(&low) || minify::is_minify_pak(&dir.join(e.file_name())))
        })
        .count()
}

/// The view. The two migrations are only handed over when the screen asks for settings
/// (`settings:get`), so a save does not swallow the news before anybody read it.
pub fn settings_view(v: ViewInput) -> Value {
    let game_s = v.settings.get("dotaGamePath").filter(|g| crate::js::truthy(g)).map(crate::js::string);
    let game = game_s.as_deref().map(Path::new);
    let folders = gamelang::lang_folders(game);
    let lang = match game {
        Some(g) => gamelang::detect_lang_suffix(Some(g)),
        None => gamelang::LangDetection { suffix: None, source: None, ui_language: None, audio: None },
    };
    let counts: Vec<FolderCount> =
        folders.iter().map(|f| FolderCount { suffix: &f.suffix, mod_files: f.mod_files }).collect();
    let our_mods = v
        .records
        .iter()
        .filter(|r| r["files"].as_array().is_some_and(|fs| fs.iter().any(|f| f["root"] == "lang")))
        .count();
    let launch = game.and_then(|g| gamelang::launch_options(Some(g)));
    let count = |s: &str| minify_mods_in(game, s);
    let m = minify::read_minify(MinifyInput {
        folders: &counts,
        audio: lang.audio.as_deref(),
        game_languages: &gamelang::DOTA_LANGUAGES,
        our_folder: v.lang_folder,
        our_mods,
        config: v.minify_config,
        count_mods: Some(&count),
        launch_options: launch.as_deref(),
    });
    let stranded: Vec<Value> = folders
        .iter()
        .filter(|f| f.suffix != v.lang_folder && f.mod_files > 0 && Some(&f.suffix) != m.folder.as_ref())
        .map(|f| json!({ "suffix": f.suffix, "modFiles": f.mod_files }))
        .collect();
    let mut out = v.settings;
    out.insert("dotaPathValid".into(), json!(game.is_some_and(crate::installer::validate_game_path)));
    out.insert("minify".into(), json!(m));
    out.insert("discordConfigured".into(), json!(v.discord_configured));
    out.insert(
        "gameLang".into(),
        json!({
            "mounted": lang.suffix,
            "launchLang": if lang.source == Some("launch") { json!(lang.audio) } else { Value::Null },
            "folder": v.lang_folder,
            "stranded": stranded,
        }),
    );
    out.insert("langMigration".into(), v.migration);
    out.insert("slotMigration".into(), v.slot_migration);
    Value::Object(out)
}
