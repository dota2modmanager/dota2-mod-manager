//! Channels whose TypeScript handler has been rewritten in Rust on top of crates/mm-core.
//! Each one keeps the arguments and the answer shape of the handler it replaces, so the window
//! (renderer/) cannot tell which side answered.
//!
//! A channel that reads or writes state the TypeScript host also holds (settings.json, the
//! library manifest) moves together with that state, never alone: two processes writing one
//! file would race. docs/rust-migration.md has the order.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The folder the app keeps its own files in (`--user-data-dir`, or %APPDATA%), as main.rs found it.
pub struct UserData(pub PathBuf);

/// The download cache's installer: nothing but the folders under userData, no game.
fn cache(app: &AppHandle) -> mm_core::installer::Installer {
    let ud = app.state::<UserData>().0.clone();
    mm_core::installer::Installer::new(None, "").with_user_data(&ud)
}

/// Where the build's own files are (the changelogs), as main.rs found them for the host.
pub struct AppRoot(pub PathBuf);

/// What the ported network calls share: one `Net` on the proxy in settings.json (read again when
/// the file changes; the host still owns the file), the catalog's pictures (src/preview-cache.ts)
/// and the star count (src/repo-stars.ts). The pictures live in the folder the host warms into,
/// which is safe, as each side writes a picture to a temporary name first and renames it.
pub struct Shared {
    net: Arc<mm_core::net_fetch::Net>,
    settings_at: Mutex<Option<std::time::SystemTime>>,
    previews: OnceLock<Arc<mm_core::preview_cache::PreviewStore>>,
    stars: OnceLock<mm_core::app_info::RepoStars>,
}

/// settings.json as the host last wrote it, or null; only read here.
fn settings(ud: &Path) -> Value {
    std::fs::read_to_string(ud.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

impl Shared {
    pub fn new() -> Shared {
        Shared {
            net: Arc::new(mm_core::net_fetch::Net::default()),
            settings_at: Mutex::new(None),
            previews: OnceLock::new(),
            stars: OnceLock::new(),
        }
    }

    /// The network, on the proxy the user set.
    fn net(&self, ud: &Path) -> Arc<mm_core::net_fetch::Net> {
        let at = std::fs::metadata(ud.join("settings.json")).and_then(|m| m.modified()).ok();
        let mut seen = self.settings_at.lock().unwrap_or_else(|e| e.into_inner());
        if *seen != at || at.is_none() {
            *seen = at;
            let typed = settings(ud).get("downloadProxy").cloned().unwrap_or(Value::Null);
            let proxy =
                if typed.is_null() { None } else { mm_core::net_fetch::validate_download_proxy(&typed).ok().flatten() };
            self.net.set_proxy(proxy.as_deref());
        }
        self.net.clone()
    }

    /// The answer to one request on the scheme: the picture, or 502 when nobody has it.
    pub fn picture(&self, ud: &Path, path: &str) -> tauri::http::Response<Vec<u8>> {
        let net = self.net(ud);
        let store = self.previews.get_or_init(|| {
            mm_core::preview_cache::PreviewStore::new(&ud.join("preview-cache"), net, None, None, Box::new(|_| {}))
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

    fn stars(&self, ud: &Path) -> Option<f64> {
        let net = self.net(ud);
        self.stars
            .get_or_init(|| {
                let now = || std::time::SystemTime::UNIX_EPOCH.elapsed().map_or(0.0, |d| d.as_millis() as f64);
                mm_core::app_info::RepoStars::new(&ud.join("repo-stars.json"), None, net, Box::new(now))
            })
            .get()
    }
}

pub fn handle(app: &AppHandle, channel: &str, args: &[Value]) -> Option<Result<Value, String>> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let ud = app.state::<UserData>().0.clone();
    let res = match channel {
        // src/ipc-window.ts
        "app:version" => Ok(json!(app.package_info().version.to_string())),
        // the notes read the build's changelogs and, for lastSeenVersion, settings.json (only read)
        "app:notes" => {
            let version = app.package_info().version.to_string();
            let seen = settings(&ud).get("lastSeenVersion").and_then(Value::as_str).map(String::from);
            let lang = mm_core::js::string(&arg(0));
            let notes = mm_core::app_info::release_notes(&version, &lang, &app.state::<AppRoot>().0, seen.as_deref());
            Ok(
                json!({ "version": version, "notes": notes, "unseen": seen.as_ref().is_some_and(|s| !s.is_empty() && *s != version) }),
            )
        }
        // the star count on Home, kept in repo-stars.json, which only this channel writes
        "app:stars" => Ok(app.state::<Shared>().stars(&ud).map_or(Value::Null, mm_core::js::json_number)),
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
