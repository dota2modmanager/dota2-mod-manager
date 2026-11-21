//! Community presets: the ones people published from the app, with their likes and dislikes.
//!
//! There is no server with data behind this. The presets and the votes are JSON files in the
//! `community-presets` branch of this repository, and the whole list is one file there,
//! index.json, rebuilt by a workflow (tools/ops/presets-worker/index.mjs). It is fetched like the
//! ready-made presets, through the mirrors when GitHub is out of reach, and kept between starts so
//! the list is there offline once seen.
//!
//! A mirror is a stranger, so every preset carries the presets worker's ed25519 signature over its
//! record and is dropped when it does not check against COMMUNITY_PUBLIC_KEY. Without a key this
//! build shows no community presets at all: unlike the catalog's check, no key is not a pass. The
//! counts of votes are not signed; a mirror could lie about them, and that costs an order on the
//! screen, not a byte on anybody's disk. What a preset installs is decoded here from its code with
//! the link's own reader (preset_link.rs) and resolved against the signed catalog when taken.
//!
//! Writing goes through the worker (presets_api.rs), never straight to GitHub.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{json, Value};

use crate::js::slice_utf16;
use crate::net_fetch::{FetchOptions, Net};

/// The public half of the worker's SIGNING_KEY, SPKI DER in base64 (tools/ops/presets-worker/README.md).
pub const COMMUNITY_PUBLIC_KEY: &str = "";
/// The worker that writes the branch.
pub const COMMUNITY_API: &str = "https://presets.dota2modmanager.com";
pub const INDEX_URL: &str =
    "https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/community-presets/index.json";

/// More than anybody scrolls through; the list is searched, not read.
pub const MAX_PRESETS: usize = 5000;
const MAX_RECORD: usize = 80 * 1024;
const SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

/// Where the list comes from and whose signature it carries. A debug build can be pointed at a
/// local copy of the worker (tools/ops/presets-worker/dev.mjs) with D2MM_COMMUNITY_API,
/// D2MM_COMMUNITY_INDEX and D2MM_COMMUNITY_KEY; a release build ignores them.
#[derive(Clone, Debug)]
pub struct Endpoints {
    pub api: String,
    pub index: String,
    pub key: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        let env = |name: &str, or: &str| {
            if cfg!(debug_assertions) {
                std::env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| or.to_string())
            } else {
                or.to_string()
            }
        };
        Endpoints {
            api: env("D2MM_COMMUNITY_API", COMMUNITY_API),
            index: env("D2MM_COMMUNITY_INDEX", INDEX_URL),
            key: env("D2MM_COMMUNITY_KEY", COMMUNITY_PUBLIC_KEY),
        }
    }
}

/// Whether `sig` (base64) is `key`'s signature over `payload`; no key, a bad key or a bad signature
/// all fail.
pub fn signed(payload: &[u8], sig: &str, key: &str) -> bool {
    let der = crate::js::base64_decode(crate::js::trim(key));
    let Some(raw) = der.strip_prefix(&SPKI_PREFIX[..]).filter(|r| r.len() == 32) else { return false };
    let Ok(key) = VerifyingKey::from_bytes(raw.try_into().unwrap()) else { return false };
    let Ok(sig) = Signature::from_slice(&crate::js::base64_decode(crate::js::trim(sig))) else { return false };
    key.verify(payload, &sig).is_ok()
}

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| slice_utf16(crate::js::trim(s), max)).unwrap_or_default()
}

fn count(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).map_or(0, |n| n.min(1e9) as u64)
}

/// index.json as the window shows it: each preset whose signature checks, with what it holds read
/// out of its code. `{ id, name, about, author: { key, name }, created, up, down, code, mods }`.
pub fn normalize_index(raw: &Value, key: &str) -> Vec<Value> {
    if raw.get("version").and_then(Value::as_f64) != Some(1.0) {
        return vec![];
    }
    let Some(list) = raw.get("presets").and_then(Value::as_array) else { return vec![] };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in list.iter().take(MAX_PRESETS) {
        let (Some(record), Some(sig)) = (p.get("record").and_then(Value::as_str), p.get("sig").and_then(Value::as_str))
        else {
            continue;
        };
        if record.len() > MAX_RECORD || !signed(record.as_bytes(), sig, key) {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<Value>(record) else { continue };
        let id = text(rec.get("id"), 40);
        // the index's own id must be the signed one: a vote count cannot be moved onto another preset
        if id.is_empty() || p.get("id").and_then(Value::as_str) != Some(id.as_str()) || !seen.insert(id.clone()) {
            continue;
        }
        let code = text(rec.get("code"), 64 * 1024);
        let Ok(decoded) = crate::preset_link::decode_preset_link(&json!(code)) else { continue };
        if decoded.mods.is_empty() {
            continue;
        }
        let name = text(rec.get("name"), 80);
        out.push(json!({
            "id": id,
            "name": if name.is_empty() { slice_utf16(&decoded.name, 80) } else { name },
            "about": text(rec.get("about"), 500),
            "author": {
                "key": text(rec.get("author").and_then(|a| a.get("key")), 16),
                "name": text(rec.get("author").and_then(|a| a.get("name")), 80),
            },
            "created": text(rec.get("created"), 40),
            "up": count(p.get("up")),
            "down": count(p.get("down")),
            "code": code,
            "mods": decoded.mods,
        }));
    }
    out
}

/// The list, kept on disk between starts.
pub struct CommunityPresets {
    file: PathBuf,
    pub at: Endpoints,
    cache: Mutex<Option<Vec<Value>>>,
}

impl CommunityPresets {
    pub fn new(user_data: &Path, at: Endpoints) -> CommunityPresets {
        CommunityPresets { file: user_data.join("community-presets.json"), at, cache: Mutex::new(None) }
    }

    /// Whether this build can check what it would show: a key, and a worker to write through.
    pub fn configured(&self) -> bool {
        !crate::js::trim(&self.at.key).is_empty() && !self.at.api.is_empty()
    }

    pub fn list(&self) -> Vec<Value> {
        if !self.configured() {
            return vec![];
        }
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if c.is_none() {
            let raw = std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            *c = Some(raw.map(|r| normalize_index(&r, &self.at.key)).unwrap_or_default());
        }
        c.clone().unwrap_or_default()
    }

    /// Fetch and keep; offline or a broken file leave the last good list.
    pub fn refresh(&self, net: &Net, log: &mut dyn FnMut(&str)) -> Result<Vec<Value>, String> {
        if !self.configured() {
            return Ok(vec![]);
        }
        let r = (|| -> Result<Vec<Value>, String> {
            let text = net.fetch_text(&self.at.index, FetchOptions::default()).map_err(|e| e.message)?;
            let raw: Value = serde_json::from_str(&text).map_err(|e| format!("JSON: {e}"))?;
            if raw.get("version").and_then(Value::as_f64) != Some(1.0) {
                return Err("JSON: not a version 1 index".into());
            }
            let list = normalize_index(&raw, &self.at.key);
            *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(list.clone());
            std::fs::write(&self.file, text).map_err(|e| e.to_string())?;
            log(&format!("community presets: {}", list.len()));
            Ok(list)
        })();
        r.map_err(|e| {
            log(&format!("community presets not fetched: {e}"));
            e
        })
    }

    pub fn get(&self, id: &str) -> Option<Value> {
        self.list().into_iter().find(|p| p.get("id").and_then(Value::as_str) == Some(id))
    }

    /// A preset just taken down by its author leaves the list on this machine before the index catches up.
    pub fn forget(&self, id: &str) {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(list) = c.as_mut() {
            list.retain(|p| p.get("id").and_then(Value::as_str) != Some(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    pub(crate) fn key_pair() -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let mut der = SPKI_PREFIX.to_vec();
        der.extend_from_slice(sk.verifying_key().as_bytes());
        use base64::Engine;
        (sk, base64::engine::general_purpose::STANDARD.encode(der))
    }

    pub(crate) fn entry(sk: &SigningKey, id: &str, name: &str, up: u64) -> Value {
        let link = crate::preset_link::encode_preset_link(
            &json!(name),
            &json!(""),
            &[
                json!({ "categoryId": "heroes", "name": "Some Mod" }),
                json!({ "categoryId": "terrains", "name": "Flat" }),
            ],
        );
        let record = json!({ "v": 1, "id": id, "name": name, "about": "two mods", "code": link.code,
            "author": { "key": "aaaaaaaaaaaaaaaa", "name": "Alice" }, "created": "2026-11-21T10:00:00.000Z" })
        .to_string();
        use base64::Engine;
        let sig = base64::engine::general_purpose::STANDARD.encode(sk.sign(record.as_bytes()).to_bytes());
        json!({ "id": id, "record": record, "sig": sig, "up": up, "down": 1 })
    }

    #[test]
    fn a_signed_preset_is_read_out_of_its_code_and_anything_else_is_dropped() {
        let (sk, key) = key_pair();
        let good = entry(&sk, "aaaaaaaaaaaaaaaa-000001", "Build", 3);
        let mut forged = entry(&sk, "aaaaaaaaaaaaaaaa-000002", "Build", 3);
        forged["record"] = json!(forged["record"].as_str().unwrap().replace("Build", "Other"));
        let mut moved = entry(&sk, "aaaaaaaaaaaaaaaa-000003", "Build", 3);
        moved["id"] = json!("aaaaaaaaaaaaaaaa-000001");
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let stranger = entry(&other, "aaaaaaaaaaaaaaaa-000004", "Build", 3);
        let raw = json!({ "version": 1, "presets": [good, forged, moved, stranger, { "record": 5 }] });
        let list = normalize_index(&raw, &key);
        assert_eq!(list.len(), 1, "{list:?}");
        let p = &list[0];
        assert_eq!(p["id"], "aaaaaaaaaaaaaaaa-000001");
        assert_eq!(p["name"], "Build");
        assert_eq!(p["author"]["name"], "Alice");
        assert_eq!((p["up"].as_u64(), p["down"].as_u64()), (Some(3), Some(1)));
        let mods = p["mods"].as_array().unwrap();
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0]["categoryId"], "heroes");
        assert_eq!(mods[0]["name"], "Some Mod");
    }

    #[test]
    fn no_key_shows_nothing_rather_than_everything() {
        let (sk, _) = key_pair();
        let raw = json!({ "version": 1, "presets": [entry(&sk, "aaaaaaaaaaaaaaaa-000001", "Build", 0)] });
        assert!(normalize_index(&raw, "").is_empty());
        assert!(normalize_index(&json!({ "version": 2, "presets": [] }), "x").is_empty());
        let dir = std::env::temp_dir().join(format!("mm-community-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let off = CommunityPresets::new(
            &dir,
            Endpoints { api: COMMUNITY_API.into(), index: INDEX_URL.into(), key: String::new() },
        );
        assert!(!off.configured());
        assert!(off.list().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_list_kept_on_disk_is_read_back_and_a_taken_down_preset_leaves_it() {
        let (sk, key) = key_pair();
        let dir = std::env::temp_dir().join(format!("mm-community-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw = json!({ "version": 1, "presets": [
            entry(&sk, "aaaaaaaaaaaaaaaa-000001", "One", 0), entry(&sk, "aaaaaaaaaaaaaaaa-000002", "Two", 0)] });
        std::fs::write(dir.join("community-presets.json"), raw.to_string()).unwrap();
        let c = CommunityPresets::new(
            &dir,
            Endpoints { api: "http://127.0.0.1:1".into(), index: "http://127.0.0.1:1/i".into(), key },
        );
        assert_eq!(c.list().len(), 2);
        assert_eq!(c.get("aaaaaaaaaaaaaaaa-000002").unwrap()["name"], "Two");
        c.forget("aaaaaaaaaaaaaaaa-000001");
        assert_eq!(c.list().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
