//! The removal: the uninstaller runs the app once with `--uninstall`, the app asks what to take
//! along and answers with its exit code (src/uninstall-args.ts, src/uninstall-window.ts).
//!
//! An update runs the old uninstaller too, so the same flag arrives on a run where nothing may be
//! removed; [`is_update_run`] is the app's half of the pair of locks against that, the other half
//! is build/installer.nsh. The window itself is drawn by the shell; this is what it shows and
//! what its answer does.

use crate::installer::Installer;
use crate::library::Library;
use crate::remove_everything::{remove_everything, What};
use crate::schema_service::SchemaService;
use crate::settings::Settings;
use serde::Serialize;
use std::path::Path;

/// The window closed without an answer: the uninstaller stops.
pub const UNINSTALL_CANCELLED: i32 = 3;
/// The person asked for the app's own folder to go as well.
pub const UNINSTALL_WIPE_DATA: i32 = 4;

/// Flags that mean "this is not a person removing the program". `--updated` says it outright,
/// `/KEEP_APP_DATA` comes with it, `/S` means no interface and a window is one.
pub const UPDATE_FLAGS: [&str; 3] = ["--updated", "/KEEP_APP_DATA", "/S"];

/// electron-builder replacing a version, wearing the uninstaller's clothes. A flag matches whole
/// and regardless of case; a path that merely contains the text does not.
pub fn is_update_run<S: AsRef<str>>(argv: &[S]) -> bool {
    argv.iter().any(|a| UPDATE_FLAGS.iter().any(|f| f.eq_ignore_ascii_case(a.as_ref())))
}

/// A person removing the program, the only case the window may open in.
pub fn is_uninstall_run<S: AsRef<str>>(argv: &[S]) -> bool {
    argv.iter().any(|a| a.as_ref() == "--uninstall") && !is_update_run(argv)
}

/// What there is to remove, so the window can say it rather than ask in the abstract.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub mods: usize,
    pub mod_bytes: u64,
    pub patched: bool,
    pub game_path: Option<serde_json::Value>,
    pub data_bytes: u64,
    pub lang: &'static str,
}

/// The plan: the mods (cosmetic records are not mods), the bytes they hold in the game (a record
/// whose size cannot be read, removed by hand or with no game, counts nothing), the patch, and the
/// app's own folder.
pub fn plan(inst: &Installer, lib: &Library, settings: &Settings, user_data: &Path) -> Plan {
    let mods: Vec<_> = lib
        .list()
        .iter()
        .filter(|r| r.get("categoryId").and_then(serde_json::Value::as_str) != Some("cosmetic"))
        .collect();
    let mod_bytes = mods.iter().filter_map(|r| inst.installed_size(&crate::generated_pak::files_of(r)).ok()).sum();
    let truthy = |k: &str| settings.get(k).is_some_and(crate::js::truthy);
    Plan {
        mods: mods.len(),
        mod_bytes,
        patched: truthy("schemaPatch"),
        game_path: truthy("dotaGamePath").then(|| settings.get("dotaGamePath").cloned()).flatten(),
        data_bytes: crate::folder_size::folder_size(user_data),
        lang: match settings.get("uiLang").and_then(serde_json::Value::as_str) {
            Some("ru") => "ru",
            Some("zh-CN") => "zh-CN",
            _ => "en",
        },
    }
}

/// The answer: what the person ticked comes out, and the log says how it went. The app's folder
/// is not touched here: this process runs out of it, so the exit code carries that part back.
pub fn run(
    inst: &Installer,
    lib: &mut Library,
    settings: &mut Settings,
    schema: &mut SchemaService,
    revert: bool,
    mods: bool,
    diag: &dyn Fn(&str),
) -> Vec<String> {
    let (errors, _) = remove_everything(inst, lib, settings, schema, None, What { revert, mods, notice: true });
    diag(&format!("uninstall: revert={revert} mods={mods} errors={}", errors.len()));
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_update_is_not_a_removal() {
        assert!(is_uninstall_run(&["app.exe", "--uninstall"]));
        assert!(!is_uninstall_run(&["app.exe", "--uninstall", "--updated"]));
        assert!(!is_uninstall_run(&["app.exe", "--uninstall", "/s"]));
        assert!(!is_uninstall_run(&["app.exe", "--uninstall", "/keep_app_data"]));
        assert!(is_uninstall_run(&["app.exe", "--uninstall", "C:/--updated/x"]));
        assert!(!is_uninstall_run(&["app.exe"]));
        assert!(!is_uninstall_run(&["app.exe", "--UNINSTALL"]));
    }
}
