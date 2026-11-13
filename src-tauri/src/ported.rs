//! Channels whose TypeScript handler has been rewritten in Rust on top of crates/mm-core.
//! Each one keeps the arguments and the answer shape of the handler it replaces, so the window
//! (renderer/) cannot tell which side answered.
//!
//! A channel that reads or writes state the TypeScript host also holds (settings.json, the
//! library manifest) moves together with that state, never alone: two processes writing one
//! file would race. docs/rust-migration.md has the order.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The folder the app keeps its own files in (`--user-data-dir`, or %APPDATA%), as main.rs found it.
pub struct UserData(pub PathBuf);

/// The download cache's installer: nothing but the folders under userData, no game.
fn cache(app: &AppHandle) -> mm_core::installer::Installer {
    let ud = app.state::<UserData>().0.clone();
    mm_core::installer::Installer::new(None, "").with_user_data(&ud)
}

/// The catalog's pictures (src/preview-cache.ts): the store over the folder the host warms into.
/// Sharing that folder is safe, as each side writes a picture to a temporary name first and
/// renames it into place. The proxy is the one in settings.json, read again when the file changes.
pub struct Previews {
    store: std::sync::OnceLock<Arc<mm_core::preview_cache::PreviewStore>>,
    net: Arc<mm_core::net_fetch::Net>,
    settings_at: Mutex<Option<std::time::SystemTime>>,
}

impl Previews {
    pub fn new() -> Previews {
        Previews {
            store: Default::default(),
            net: Arc::new(mm_core::net_fetch::Net::default()),
            settings_at: Mutex::new(None),
        }
    }

    fn proxy_now(&self, ud: &Path) {
        let file = ud.join("settings.json");
        let at = std::fs::metadata(&file).and_then(|m| m.modified()).ok();
        let mut seen = self.settings_at.lock().unwrap_or_else(|e| e.into_inner());
        if *seen == at && at.is_some() {
            return;
        }
        *seen = at;
        let set = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let typed = set.as_ref().and_then(|s| s.get("downloadProxy")).cloned().unwrap_or(Value::Null);
        let proxy =
            if typed.is_null() { None } else { mm_core::net_fetch::validate_download_proxy(&typed).ok().flatten() };
        self.net.set_proxy(proxy.as_deref());
    }

    /// The answer to one request on the scheme: the picture, or 502 when nobody has it.
    pub fn answer(&self, ud: &Path, path: &str) -> tauri::http::Response<Vec<u8>> {
        self.proxy_now(ud);
        let store = self.store.get_or_init(|| {
            mm_core::preview_cache::PreviewStore::new(
                &ud.join("preview-cache"),
                self.net.clone(),
                None,
                None,
                Box::new(|_| {}),
            )
        });
        let got =
            mm_core::preview_cache::picture_of(&format!("mm-preview://catalog{path}")).and_then(|rel| store.get(&rel));
        let res = tauri::http::Response::builder();
        match got {
            Some(p) => res.header("Content-Type", p.kind).header("X-Content-Type-Options", "nosniff").body(p.bytes),
            None => res.status(502).body(Vec::new()),
        }
        .unwrap_or_default()
    }
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
