//! Channels whose TypeScript handler has been rewritten in Rust on top of crates/mm-core.
//! Each one keeps the arguments and the answer shape of the handler it replaces, so the window
//! (renderer/) cannot tell which side answered.
//!
//! A channel that reads or writes state the TypeScript host also holds (settings.json, the
//! library manifest) moves together with that state, never alone: two processes writing one
//! file would race. docs/rust-migration.md has the order.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The folder the app keeps its own files in (`--user-data-dir`, or %APPDATA%), as main.rs found it.
pub struct UserData(pub PathBuf);

/// The download cache's installer: nothing but the folders under userData, no game.
fn cache(app: &AppHandle) -> mm_core::installer::Installer {
    let ud = app.state::<UserData>().0.clone();
    mm_core::installer::Installer::new(None, "").with_user_data(&ud)
}

pub fn handle(app: &AppHandle, channel: &str, args: &[Value]) -> Option<Result<Value, String>> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let res = match channel {
        // src/ipc-window.ts
        "app:version" => Ok(json!(app.package_info().version.to_string())),
        // src/ipc-settings.ts: nothing kept, one request through the address typed
        "settings:testProxy" => Ok(mm_core::net_fetch::test_download_proxy(&arg(0))),
        // src/ipc-misc.ts: read off the disk each time, as the TypeScript does, so the host's own
        // downloads show up here and nothing is held twice
        "misc:cacheSize" => Ok(json!(cache(app).download_cache_size())),
        "misc:cacheList" => serde_json::to_value(cache(app).list_download_cache()).map_err(|e| e.to_string()),
        _ => return None,
    };
    Some(res)
}
