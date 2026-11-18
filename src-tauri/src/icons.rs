//! Item and hero pictures on the mm-icon scheme, instead of inside the answer as data URIs.
//!
//! The owner hands these pictures out as `data:image/png;base64,...` (mm_core::vtex and friends).
//! A cosmetic slot holds up to two thousand of them, and each batch of 24 was a few hundred
//! kilobytes of JSON that the window parsed, walked (bridge.js decode) and kept as React props on
//! its one thread, while the tiles were scrolling into view: the hitch somebody felt as the list
//! "catching" on every new row. Here each picture is kept once, by its content, and the answer
//! carries a short address; the webview fetches and decodes it off the page's thread and keeps
//! it in its own image cache.
//!
//! Only the channels whose pictures go straight into an <img> are rewritten (PICTURE_CHANNELS).
//! The arcana tint draws an item picture onto a canvas, so the scheme answers with
//! Access-Control-Allow-Origin and the tint asks for it with crossOrigin (catalog/arcana/tint.ts).

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde_json::Value;

/// The scheme's name; WebView2 serves it as http://mm-icon.localhost/.
pub const SCHEME: &str = "mm-icon";

/// The channels whose answer is pictures for <img> tags and nothing that is read back.
pub const PICTURE_CHANNELS: &[&str] = &["cosmetics:icons", "cosmetics:heroPortraits", "cosmetics:heroPortraitsByName"];

/// Pictures kept at most, in bytes. Two thousand item icons are well under this; past it the
/// oldest go, and the webview's own cache still has them drawn.
const CAP: usize = 192 << 20;

struct Picture {
    kind: String,
    bytes: Arc<Vec<u8>>,
}

#[derive(Default)]
struct Store {
    by_id: HashMap<String, Picture>,
    order: VecDeque<String>,
    size: usize,
}

/// The pictures handed out so far, by the address they were given.
#[derive(Default)]
pub struct Icons(Mutex<Store>);

/// Where the page asks for a picture with this id.
fn address(id: &str) -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{id}")
    } else {
        format!("{SCHEME}://icon/{id}")
    }
}

/// The picture's media type and base64 text, when `s` is a data URI of an image.
fn data_uri(s: &str) -> Option<(&str, &str)> {
    let rest = s.strip_prefix("data:")?;
    let (kind, b64) = rest.split_once(";base64,")?;
    kind.starts_with("image/").then_some((kind, b64))
}

impl Icons {
    /// The address for one picture, kept under the hash of its text: the same picture asked for
    /// twice is one entry and one address, so the webview's cache serves it the second time.
    fn keep(&self, kind: &str, b64: &str) -> Option<String> {
        let mut h = DefaultHasher::new();
        b64.hash(&mut h);
        let id = format!("{:016x}{:x}", h.finish(), b64.len());
        let mut store = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !store.by_id.contains_key(&id) {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            store.size += bytes.len();
            store.by_id.insert(id.clone(), Picture { kind: kind.to_string(), bytes: Arc::new(bytes) });
            store.order.push_back(id.clone());
            while store.size > CAP {
                let Some(old) = store.order.pop_front() else { break };
                if let Some(p) = store.by_id.remove(&old) {
                    store.size -= p.bytes.len();
                }
            }
        }
        Some(address(&id))
    }

    /// Every image data URI inside `v` swapped for its address; anything that does not decode
    /// stays as it was.
    fn swap(&self, v: &mut Value) {
        match v {
            Value::String(s) => {
                if let Some(url) = data_uri(s).and_then(|(kind, b64)| self.keep(kind, b64)) {
                    *s = url;
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| self.swap(x)),
            Value::Object(o) => o.values_mut().for_each(|x| self.swap(x)),
            _ => {}
        }
    }

    /// A picture channel's answer with its pictures moved onto the scheme; any other channel's
    /// answer, and one that does not parse, as it came.
    pub fn rewrite(&self, channel: &str, json: String) -> String {
        if !PICTURE_CHANNELS.contains(&channel) || !json.contains("data:image/") {
            return json;
        }
        let Ok(mut v) = serde_json::from_str::<Value>(&json) else { return json };
        self.swap(&mut v);
        v.to_string()
    }

    /// The answer to one request on the scheme. A picture never changes under its address, so
    /// the webview may keep it for as long as it likes.
    pub fn respond(&self, path: &str) -> tauri::http::Response<Vec<u8>> {
        let id = path.trim_start_matches('/');
        let got = {
            let store = self.0.lock().unwrap_or_else(|e| e.into_inner());
            store.by_id.get(id).map(|p| (p.kind.clone(), p.bytes.clone()))
        };
        let res = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
        match got {
            Some((kind, bytes)) => res
                .header("Content-Type", kind)
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .header("X-Content-Type-Options", "nosniff")
                .body(bytes.as_ref().clone()),
            None => res.status(404).body(Vec::new()),
        }
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOT: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn a_picture_channel_carries_addresses_and_the_scheme_serves_the_bytes() {
        let icons = Icons::default();
        let json = format!(
            r#"{{"pictures":{{"a":"data:image/png;base64,{DOT}","b":null,"c":"data:image/png;base64,{DOT}"}},"decode":[]}}"#
        );
        let out: Value = serde_json::from_str(&icons.rewrite("cosmetics:icons", json)).unwrap();
        let a = out["pictures"]["a"].as_str().unwrap();
        assert!(a.contains(SCHEME) && !a.contains("base64"), "{a}");
        assert_eq!(out["pictures"]["c"], out["pictures"]["a"], "one picture, one address");
        assert!(out["pictures"]["b"].is_null());
        let res = icons.respond(&format!("/{}", a.rsplit('/').next().unwrap()));
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()["Content-Type"], "image/png");
        assert_eq!(res.body()[1..4], *b"PNG");
    }

    #[test]
    fn other_channels_and_unknown_addresses_are_left_alone() {
        let icons = Icons::default();
        let json = format!(r#"{{"art":"data:image/png;base64,{DOT}"}}"#);
        assert_eq!(icons.rewrite("arcana:picture", json.clone()), json);
        assert_eq!(icons.respond("/nothing").status(), 404);
        let broken = r#"{"x":"data:image/png;base64,@@@"}"#.to_string();
        assert!(icons.rewrite("cosmetics:icons", broken).contains("@@@"));
    }
}
