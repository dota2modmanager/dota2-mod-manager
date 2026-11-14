//! The catalog's pictures on the mm-preview scheme (src/preview-cache.ts servePreviews), which
//! bridge.js points the page's images at: from disk, else from the mirror before GitHub.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::Value;

/// The folder the app keeps its own files in (`--user-data-dir`, or %APPDATA%), as main.rs found it.
pub struct UserData(pub PathBuf);

/// The pictures' own `Net`, on the proxy in settings.json (read again when the file changes), and
/// the store. The owner warms the same folder, which is safe: each writes a picture to a
/// temporary name first and renames it.
pub struct Shared {
    net: Arc<mm_core::net_fetch::Net>,
    settings_at: Mutex<Option<std::time::SystemTime>>,
    previews: OnceLock<Arc<mm_core::preview_cache::PreviewStore>>,
}

/// settings.json as the owner last wrote it, or null; only read here.
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
}
