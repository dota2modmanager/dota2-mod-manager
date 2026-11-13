//! The ready-made presets (src/ready-presets.ts): config/presets.json on main, fetched and checked
//! the way the remote config is and kept between starts, so the list is there offline once seen.
//! No file, no network, a bad signature or malformed JSON leave the last good list, or none.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use crate::net_fetch::{FetchOptions, Net};
use crate::ready_presets_format::normalize_ready;

pub const READY_URL: &str =
    "https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/presets.json";

pub struct ReadyPresets {
    file: PathBuf,
    public_key: String,
    cache: Mutex<Option<Vec<Value>>>,
}

impl ReadyPresets {
    /// `public_key`: whose signature to accept, the remote config's unless a test signs its own.
    pub fn new(user_data: &Path, public_key: Option<&str>) -> ReadyPresets {
        ReadyPresets {
            file: user_data.join("ready-presets.json"),
            public_key: public_key.unwrap_or(crate::remote_config::CONFIG_PUBLIC_KEY).into(),
            cache: Mutex::new(None),
        }
    }

    pub fn list(&self) -> Vec<Value> {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if c.is_none() {
            let raw = std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            *c = Some(raw.map(|r| normalize_ready(&r)).unwrap_or_default());
        }
        c.clone().unwrap_or_default()
    }

    /// Fetch, check and keep; never fails, offline is the normal case.
    pub fn refresh(&self, net: &Net, log: &mut dyn FnMut(&str)) -> Vec<Value> {
        let r = (|| -> Result<Vec<Value>, String> {
            let text = net.fetch_text(READY_URL, FetchOptions::default()).map_err(|e| e.message)?;
            let sig = net.fetch_text(&format!("{READY_URL}.sig"), FetchOptions::default()).map_err(|e| e.message)?;
            if !crate::catalog_signature::verify(text.as_bytes(), &sig, &self.public_key) {
                return Err("signature does not match".into());
            }
            let raw: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let list = normalize_ready(&raw);
            *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(list.clone());
            std::fs::write(&self.file, crate::js::stringify(&raw, "")).map_err(|e| e.to_string())?;
            log(&format!("ready presets: {}", list.len()));
            Ok(list)
        })();
        r.unwrap_or_else(|e| {
            log(&format!("ready presets not fetched: {e}"));
            self.list()
        })
    }

    pub fn get(&self, id: &str) -> Option<Value> {
        self.list().into_iter().find(|p| p.get("id").and_then(Value::as_str) == Some(id))
    }
}
