//! Channels whose TypeScript handler has been rewritten in Rust on top of crates/mm-core.
//! Each one keeps the arguments and the answer shape of the handler it replaces, so the window
//! (renderer/) cannot tell which side answered.
//!
//! A channel that reads or writes state the TypeScript host also holds (settings.json, the
//! library manifest) moves together with that state, never alone: two processes writing one
//! file would race. docs/rust-migration.md has the order.

use serde_json::{json, Value};
use tauri::AppHandle;

pub fn handle(app: &AppHandle, channel: &str, _args: &[Value]) -> Option<Result<Value, String>> {
    let res = match channel {
        // src/ipc-window.ts
        "app:version" => Ok(json!(app.package_info().version.to_string())),
        _ => return None,
    };
    Some(res)
}
