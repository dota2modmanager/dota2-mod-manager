//! The title bar's buttons, which the shell answers itself: everything else is the owner's
//! (src/backend.rs).

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The title bar's buttons, or None for a channel that is the owner's.
pub fn window(app: &AppHandle, channel: &str) -> Option<Result<Value, String>> {
    let window = || app.get_webview_window("main").ok_or_else(|| "no main window".to_string());
    let res = match channel {
        "win:minimize" => window().and_then(|w| w.minimize().map_err(|e| e.to_string())).map(|_| Value::Null),
        "win:maximize" => window().and_then(|w| {
            let max = w.is_maximized().unwrap_or(false);
            if max { w.unmaximize() } else { w.maximize() }.map_err(|e| e.to_string())?;
            Ok(json!(!max))
        }),
        "win:close" => window().and_then(|w| w.close().map_err(|e| e.to_string())).map(|_| Value::Null),
        "win:isMaximized" => window().map(|w| json!(w.is_maximized().unwrap_or(false))),
        _ => return None,
    };
    Some(res)
}
