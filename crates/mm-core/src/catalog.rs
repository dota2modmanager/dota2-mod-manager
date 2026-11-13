//! The catalog (src/catalog.ts): mods.json, constants.json and guides.json from the Dota2PornFx
//! repository, each checked against its author's signature, the last good copy kept on disk, and
//! the archive hashes the catalog publishes beside them.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::catalog_signature as signature;
use crate::net_fetch::{FetchOptions, Net};
use crate::remote_config::Clock;

/// The upstream catalog repository, read raw.
pub const RAW_BASE: &str = "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main";
const DATA_FILES: [&str; 3] = ["mods.json", "constants.json", "guides.json"];
/// The published sha256 of every archive, signed like the data; the app can do without it.
pub const HASH_FILE: &str = "mod-hashes.json";
/// The site's own copy, which goes out in one deploy and so is never half-updated.
pub const SNAPSHOT_BASE: &str = "https://dota2modmanager.com/mirror/";

/// Every mod in a mods.json, whatever shape its category is in: a plain list, or groups of lists
/// for the categories sorted by hero.
fn each_mod(mods_data: Option<&mut Value>, f: &mut dyn FnMut(&mut serde_json::Map<String, Value>)) {
    let Some(Value::Object(cats)) = mods_data else { return };
    for category in cats.values_mut() {
        let lists: Vec<&mut Value> = match category {
            Value::Array(_) => vec![category],
            Value::Object(o) => match o.get("groups") {
                Some(Value::Array(_)) => match o.get_mut("groups") {
                    Some(Value::Array(groups)) => {
                        groups.iter_mut().filter_map(|g| g.as_object_mut().and_then(|g| g.get_mut("mods"))).collect()
                    }
                    _ => vec![],
                },
                _ => o.get_mut("mods").into_iter().collect(),
            },
            _ => vec![],
        };
        for list in lists {
            if let Value::Array(mods) = list {
                for m in mods.iter_mut() {
                    if let Value::Object(m) = m {
                        f(m);
                    }
                }
            }
        }
    }
}

/// The older pair of link fields folded into the `links` array, so the rest of the app only
/// ever sees the array.
pub fn normalize_catalog(mods: &mut Value) {
    let data = mods.as_object_mut().and_then(|m| m.get_mut("modsData"));
    each_mod(data, &mut |m| {
        let truthy = |k: &str| m.get(k).is_some_and(crate::js::truthy);
        if !truthy("linkType") || !truthy("linkUrl") {
            return;
        }
        let mut link = json!({ "type": m["linkType"], "url": m["linkUrl"] });
        if truthy("senderName") {
            link["name"] = m["senderName"].clone();
        }
        match m.get_mut("links") {
            Some(Value::Array(links)) => {
                if !links.iter().any(|l| l.get("type") == Some(&link["type"]) && l.get("url") == Some(&link["url"])) {
                    links.push(link);
                }
            }
            _ => {
                m.insert("links".into(), json!([link]));
            }
        }
    });
}

/// The catalog on disk and on the wire.
pub struct Catalog {
    pub cache_dir: PathBuf,
    /// where a data-and-signature pair from one moment is asked for when GitHub's copies disagree
    pub snapshot_base: String,
    public_key: String,
    /// the published archive hashes: None until read, Some(None) when there are none
    hashes: Mutex<Option<Option<Value>>>,
    now: Clock,
}

impl Catalog {
    pub fn new(user_data: &Path, snapshot_base: Option<&str>, public_key: Option<&str>, now: Clock) -> Catalog {
        let cache_dir = user_data.join("catalog-cache");
        let _ = std::fs::create_dir_all(&cache_dir);
        Catalog {
            cache_dir,
            snapshot_base: snapshot_base.unwrap_or(SNAPSHOT_BASE).into(),
            public_key: public_key.unwrap_or(signature::CATALOG_PUBLIC_KEY).into(),
            hashes: Mutex::new(None),
            now,
        }
    }

    pub fn cache_path(&self, name: &str) -> PathBuf {
        self.cache_dir.join(name)
    }

    pub fn cache_info(&self) -> Value {
        std::fs::read_to_string(self.cache_path("meta.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| json!({ "fetchedAt": null }))
    }

    pub fn has_cache(&self) -> bool {
        DATA_FILES.iter().all(|f| self.cache_path(f).exists())
    }

    fn text(net: &Net, url: &str) -> Result<String, String> {
        net.fetch_text(url, FetchOptions::default()).map_err(|e| e.message)
    }

    fn parses(text: &str) -> Result<(), String> {
        serde_json::from_str::<Value>(text).map(|_| ()).map_err(|e| e.to_string())
    }

    /// One published file, refused when a key is pinned and it did not sign these bytes. A pair
    /// that does not verify is usually the two files from different moments on GitHub's cache,
    /// so the site's own copy, which is never half-updated, is asked before calling it forged.
    pub fn fetch_signed(&self, net: &Net, name: &str) -> Result<String, String> {
        let text = Self::text(net, &format!("{RAW_BASE}/assets/data/{name}"))?;
        if !signature::configured(&self.public_key) {
            Self::parses(&text)?;
            return Ok(text);
        }
        let sig = Self::text(net, &format!("{RAW_BASE}/{}/{name}{}", signature::SIG_DIR, signature::SIG_SUFFIX))?;
        if signature::verify(text.as_bytes(), &sig, &self.public_key) {
            Self::parses(&text)?;
            return Ok(text);
        }
        let snapshot = format!("{}{name}", self.snapshot_base);
        let consistent = Self::text(net, &snapshot)?;
        let consistent_sig = Self::text(net, &format!("{snapshot}{}", signature::SIG_SUFFIX))?;
        if !signature::verify(consistent.as_bytes(), &consistent_sig, &self.public_key) {
            return Err(format!("{name}: signature does not match the catalog's key"));
        }
        Self::parses(&consistent)?;
        Ok(consistent)
    }

    pub fn refresh(&self, net: &Net) -> Result<(), String> {
        for name in DATA_FILES {
            let text = self.fetch_signed(net, name)?;
            std::fs::write(self.cache_path(name), text).map_err(|e| e.to_string())?;
        }
        // the hashes, which the app is allowed to do without
        match self
            .fetch_signed(net, HASH_FILE)
            .and_then(|t| std::fs::write(self.cache_path(HASH_FILE), t).map_err(|e| e.to_string()))
        {
            Ok(()) => {}
            Err(_) => *self.hashes.lock().unwrap_or_else(|e| e.into_inner()) = None,
        }
        std::fs::write(
            self.cache_path("meta.json"),
            crate::js::stringify(&json!({ "fetchedAt": crate::js::json_number((self.now)()) }), ""),
        )
        .map_err(|e| e.to_string())
    }

    /// The three files as the window is handed them; a catalog that could not be fetched is not
    /// no catalog, so a failed refresh over a cache says why it is old instead of failing.
    pub fn load(&self, net: &Net, force_refresh: bool) -> Result<Value, String> {
        let mut stale = None;
        if force_refresh || !self.has_cache() {
            if let Err(e) = self.refresh(net) {
                if !self.has_cache() {
                    return Err(e);
                }
                stale = Some(e);
            }
        }
        let read = |name: &str| -> Result<Value, String> {
            let t = std::fs::read_to_string(self.cache_path(name)).map_err(|e| e.to_string())?;
            serde_json::from_str(&t).map_err(|e| e.to_string())
        };
        let mut out = json!({ "fetchedAt": self.cache_info().get("fetchedAt").cloned().unwrap_or(Value::Null), "mods": read("mods.json")?, "constants": read("constants.json")?, "guides": read("guides.json")? });
        if let Some(s) = stale {
            out["stale"] = json!(s);
        }
        normalize_catalog(&mut out["mods"]);
        Ok(out)
    }

    /// What the catalog says this archive should hash to, lower-case hex, or None when it does not say.
    pub fn published_hash(&self, category_id: &str, file: &str) -> Option<String> {
        let mut h = self.hashes.lock().unwrap_or_else(|e| e.into_inner());
        if h.is_none() {
            let read = std::fs::read_to_string(self.cache_path(HASH_FILE))
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok());
            *h = Some(read.filter(crate::js::truthy));
        }
        let hashes = h.as_ref().and_then(Option::as_ref)?;
        if category_id.is_empty() || file.is_empty() {
            return None;
        }
        let v = hashes.get(format!("{category_id}/{file}"))?.as_str()?;
        (v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())).then(|| v.to_lowercase())
    }
}
