//! What Steam's own manifest says about Dota right now (src/steam-appstate.ts, issue #427).
//! Pressing Play while Steam is still downloading an update queues the update first; and a repair
//! written while Steam checks or updates the files is overwritten by the next file it writes.
//! steamapps/appmanifest_570.acf says both, in one field.

use std::path::Path;

use regex::Regex;

use crate::i18n::t;

const UPDATE_REQUIRED: i32 = 2;
const FULLY_INSTALLED: i32 = 4;
const UPDATE_RUNNING: i32 = 256;
const UPDATE_PAUSED: i32 = 512;
const UPDATE_STARTED: i32 = 1024;
const VALIDATING: i32 = 131072;
const DOWNLOADING: i32 = 1048576;
const STAGING: i32 = 2097152;
const COMMITTING: i32 = 4194304;

/// The game's state as Steam last wrote it: its flags, and the bytes of the download under way.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub flags: f64,
    pub to_download: f64,
    pub downloaded: f64,
}

/// A number as JavaScript's bitwise operators take it (ToInt32).
fn int32(n: f64) -> i32 {
    if !n.is_finite() {
        return 0;
    }
    (n.trunc().rem_euclid(4294967296.0) as u32) as i32
}

/// The fields this reads out of an appmanifest's text; None when it has no StateFlags.
pub fn parse_app_manifest(text: &str) -> Option<AppState> {
    let field = |name: &str| -> Option<f64> {
        let re = Regex::new(&format!(r#"(?i)"{name}"{}+"([0-9]+)""#, crate::js::SPACE_CLASS)).expect("a fixed pattern");
        re.captures(text).and_then(|c| c[1].parse::<f64>().ok())
    };
    let flags = field("StateFlags")?;
    Some(AppState {
        flags,
        to_download: field("BytesToDownload").unwrap_or(0.0),
        downloaded: field("BytesDownloaded").unwrap_or(0.0),
    })
}

/// Whether Steam has an update for the game that it has not finished.
pub fn update_pending(state: &AppState) -> bool {
    let f = int32(state.flags);
    if f & FULLY_INSTALLED == 0 {
        return true;
    }
    f & (UPDATE_REQUIRED | UPDATE_RUNNING | UPDATE_PAUSED | UPDATE_STARTED) != 0
}

/// What Steam is doing to the game's files right now, if anything: its file check or an update.
pub fn steam_work(state: Option<&AppState>) -> Option<&'static str> {
    let f = int32(state?.flags);
    if f & VALIDATING != 0 {
        return Some("validating");
    }
    (f & (UPDATE_RUNNING | UPDATE_STARTED | DOWNLOADING | STAGING | COMMITTING) != 0).then_some("updating")
}

/// The manifest next to a game folder ("<library>/steamapps/common/dota 2 beta/game"), read; None
/// when it is not where Steam keeps it, which a copied or moved game can be.
pub fn read_app_state(game: Option<&Path>) -> Option<AppState> {
    let game = game.filter(|g| !g.as_os_str().is_empty())?;
    // path.resolve(game, '..', '..', '..'): lexical, and stops at the root
    let mut steamapps = std::path::absolute(game).ok()?;
    for _ in 0..3 {
        steamapps.pop();
    }
    let text = std::fs::read(steamapps.join("appmanifest_570.acf")).ok()?;
    parse_app_manifest(&String::from_utf8_lossy(&text))
}

/// What to tell the user before the launch, or None when Steam is done with the game.
pub fn launch_warning(game: Option<&Path>) -> Option<String> {
    let state = read_app_state(game)?;
    update_pending(&state).then(|| {
        t("Steam ещё обновляет Dota 2: игра запустится, когда загрузка закончится. После обновления загляни в «Мои моды»", &[])
    })
}
