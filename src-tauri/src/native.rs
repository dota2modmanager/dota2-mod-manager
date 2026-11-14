//! The channels Rust answers itself. Everything not matched here goes to the TypeScript host
//! (src/sidecar.rs). Moving a channel to Rust is: answer it here, with the same arguments and the
//! same answer shape the TypeScript handler had, and tick it off in docs/rust-migration.md.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// `Some(answer)` when the channel is Rust's, `None` when it is still the host's.
pub fn handle(app: &AppHandle, channel: &str, args: &[Value]) -> Option<Result<Value, String>> {
    window(app, channel).or_else(|| crate::ported::handle(app, channel, args))
}

/// The title bar's buttons: the shell's own, whoever owns the state.
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
