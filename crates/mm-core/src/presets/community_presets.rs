//! Community presets: the ones people published from the app, with their likes and dislikes.
//!
//! They live on the catalog's account service, the worker that keeps likes and follows
//! (catalog/social.rs): one sign-in, one database, the catalog's moderators. The list is public
//! and comes straight from the worker over HTTPS (`GET /api/presets`, cached at its edge for a
//! minute), so there is no mirror in between to forge it; it is kept here between starts so it is
//! there offline once seen. Writing (publishing, taking down, voting) goes through the same
//! session the likes use, in owner_community.rs.
//!
//! A preset is its link's code and nothing else: catalog identities and looks from the game. The
//! code is decoded here with the link's own reader (preset_link.rs), and a preset taken is
//! resolved against the signed catalog like any received one, so nothing published can put an
//! unsigned byte on anybody's disk.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::js::slice_utf16;
use crate::net_fetch::Net;

/// The service's own limits (its presets routes): a list answer, a name, a description.
pub const MAX_PRESETS: usize = 2000;
pub const MAX_NAME: usize = 80;
pub const MAX_ABOUT: usize = 500;
const TIMEOUT_MS: u64 = 15_000;
/// An answer bigger than this is not the list: 2000 presets of 64 KB codes at most, with room.
const MAX_LIST_BYTES: usize = 160 * 1024 * 1024;

/// A preset id as the service writes it: 12 characters of [0-9a-z].
pub fn is_id(s: &str) -> bool {
    s.len() == 12 && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| slice_utf16(crate::js::trim(s), max)).unwrap_or_default()
}

/// A unix time in seconds; nothing sensible past the year 5000.
fn secs(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0 && *n < 1e11).map_or(0, |n| n as u64)
}

fn count(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).map_or(0, |n| n.min(1e9) as u64)
}

/// The service's list as the window shows it: each preset whose code reads, with what it holds.
/// `{ id, name, about, author, created, updated, likes, dislikes, mods }`, times in unix seconds.
pub fn normalize_list(raw: &Value) -> Vec<Value> {
    let Some(list) = raw.get("presets").and_then(Value::as_array) else { return vec![] };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in list.iter().take(MAX_PRESETS) {
        let id = text(p.get("id"), 12);
        if !is_id(&id) || !seen.insert(id.clone()) {
            continue;
        }
        let code = text(p.get("code"), 64 * 1024);
        let Ok(decoded) = crate::preset_link::decode_preset_link(&json!(code)) else { continue };
        if decoded.mods.is_empty() {
            continue;
        }
        let name = text(p.get("name"), MAX_NAME);
        out.push(json!({
            "id": id,
            "name": if name.is_empty() { slice_utf16(&decoded.name, MAX_NAME) } else { name },
            "about": text(p.get("about"), MAX_ABOUT),
            "author": text(p.get("author"), 80),
            "created": secs(p.get("created")),
            "updated": secs(p.get("updated")),
            "likes": count(p.get("likes")),
            "dislikes": count(p.get("dislikes")),
            "mods": decoded.mods,
        }));
    }
    out
}

/// What the signed-in person has to do with the list (`GET /api/presets/mine`): their presets,
/// their votes, whether the account may publish yet, and whether it moderates.
pub fn normalize_mine(raw: &Value) -> Value {
    let ids: Vec<Value> = raw
        .get("presets")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|s| is_id(s)).map(Value::from).collect())
        .unwrap_or_default();
    let mut votes = serde_json::Map::new();
    if let Some(m) = raw.get("votes").and_then(Value::as_object) {
        for (id, v) in m.iter().take(5000) {
            match v.as_i64() {
                Some(v @ (1 | -1)) if is_id(id) => {
                    votes.insert(id.clone(), json!(v));
                }
                _ => {}
            }
        }
    }
    json!({
        "presets": ids,
        "votes": votes,
        "canPublish": raw.get("canPublish") == Some(&Value::Bool(true)),
        "moderator": raw.get("moderator") == Some(&Value::Bool(true)),
    })
}

/// The list kept between starts, and the signed-in person's part of it while the session lasts.
pub struct CommunityPresets {
    file: PathBuf,
    cache: Mutex<Option<Vec<Value>>>,
    mine: Mutex<Option<Value>>,
}

impl CommunityPresets {
    pub fn new(user_data: &Path) -> CommunityPresets {
        CommunityPresets {
            file: user_data.join("community-presets.json"),
            cache: Mutex::new(None),
            mine: Mutex::new(None),
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, Option<Vec<Value>>> {
        self.cache.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<Value> {
        let mut c = self.cache();
        if c.is_none() {
            let raw = std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            *c = Some(raw.map(|r| normalize_list(&r)).unwrap_or_default());
        }
        c.clone().unwrap_or_default()
    }

    /// The service's list now; the last one kept when it cannot be had.
    pub fn refresh(&self, net: &Net, api: &str, log: &mut dyn FnMut(&str)) -> Result<Vec<Value>, String> {
        let r = (|| -> Result<Vec<Value>, String> {
            let (status, body) =
                net.direct("GET", &format!("{api}/api/presets"), &[], None, TIMEOUT_MS).map_err(|e| e.message)?;
            if status != 200 {
                return Err(format!("HTTP {status}"));
            }
            if body.len() > MAX_LIST_BYTES {
                return Err("JSON: too big".into());
            }
            let raw: Value = serde_json::from_slice(&body).map_err(|e| format!("JSON: {e}"))?;
            if !raw.get("presets").is_some_and(Value::is_array) {
                return Err("JSON: no presets".into());
            }
            let list = normalize_list(&raw);
            *self.cache() = Some(list.clone());
            std::fs::write(&self.file, &body).map_err(|e| e.to_string())?;
            log(&format!("community presets: {}", list.len()));
            Ok(list)
        })();
        r.inspect_err(|e| log(&format!("community presets not fetched: {e}")))
    }

    pub fn get(&self, id: &str) -> Option<Value> {
        self.list().into_iter().find(|p| p.get("id").and_then(Value::as_str) == Some(id))
    }

    /// A preset taken down leaves the list here before the service's next answer.
    pub fn forget(&self, id: &str) {
        if let Some(list) = self.cache().as_mut() {
            list.retain(|p| p.get("id").and_then(Value::as_str) != Some(id));
        }
        if let Some(m) = self.mine.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            if let Some(a) = m["presets"].as_array_mut() {
                a.retain(|x| x.as_str() != Some(id));
            }
        }
    }

    /// The counts a vote came back with, put on the kept list so the next draw shows them.
    pub fn counted(&self, id: &str, likes: u64, dislikes: u64) {
        if let Some(p) =
            self.cache().as_mut().and_then(|l| l.iter_mut().find(|p| p.get("id").and_then(Value::as_str) == Some(id)))
        {
            p["likes"] = json!(likes);
            p["dislikes"] = json!(dislikes);
        }
    }

    pub fn mine(&self) -> Option<Value> {
        self.mine.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_mine(&self, mine: Option<Value>) {
        *self.mine.lock().unwrap_or_else(|e| e.into_inner()) = mine;
    }

    /// One vote changed in what is kept of the signed-in person.
    pub fn voted(&self, id: &str, vote: i64) {
        if let Some(m) = self.mine.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            if let Some(v) = m["votes"].as_object_mut() {
                if vote == 0 {
                    v.remove(id);
                } else {
                    v.insert(id.to_string(), json!(vote));
                }
            }
        }
    }

    /// A preset just published is theirs before `/mine` is asked again.
    pub fn published(&self, id: &str) {
        if let Some(a) =
            self.mine.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|m| m["presets"].as_array_mut())
        {
            if !a.iter().any(|x| x.as_str() == Some(id)) {
                a.push(json!(id));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str) -> Value {
        let link = crate::preset_link::encode_preset_link(
            &json!(name),
            &json!(""),
            &[
                json!({ "categoryId": "heroes", "name": "Some Mod" }),
                json!({ "categoryId": "terrains", "name": "Flat" }),
            ],
        );
        json!({ "id": id, "name": name, "about": "two mods", "code": link.code, "author": "Alice",
            "created": 1_795_000_000, "updated": 1_795_000_100, "likes": 3, "dislikes": 1 })
    }

    #[test]
    fn a_preset_is_read_out_of_its_code_and_a_broken_one_is_dropped() {
        let mut broken = entry("bbbbbbbbbbbb", "Broken");
        broken["code"] = json!("not-a-code!");
        let raw = json!({ "presets": [
            entry("aaaaaaaaaaaa", "Build"), broken, entry("aaaaaaaaaaaa", "Twice"), entry("short", "Bad id"),
            { "id": "cccccccccccc" }
        ], "at": 1 });
        let list = normalize_list(&raw);
        assert_eq!(list.len(), 1, "{list:?}");
        let p = &list[0];
        assert_eq!(
            (p["id"].as_str(), p["name"].as_str(), p["author"].as_str()),
            (Some("aaaaaaaaaaaa"), Some("Build"), Some("Alice"))
        );
        assert_eq!(
            (p["likes"].as_u64(), p["dislikes"].as_u64(), p["created"].as_u64()),
            (Some(3), Some(1), Some(1_795_000_000))
        );
        assert_eq!(p["mods"].as_array().map(Vec::len), Some(2));
        assert_eq!(p["mods"][0]["categoryId"], "heroes");
        assert!(normalize_list(&json!({ "error": "x" })).is_empty());
    }

    #[test]
    fn mine_keeps_only_ids_and_real_votes() {
        let m = normalize_mine(&json!({
            "presets": ["aaaaaaaaaaaa", "nope", 5],
            "votes": { "bbbbbbbbbbbb": 1, "cccccccccccc": -1, "dddddddddddd": 7, "x": 1 },
            "canPublish": true, "moderator": "yes",
        }));
        assert_eq!(m["presets"], json!(["aaaaaaaaaaaa"]));
        assert_eq!(m["votes"], json!({ "bbbbbbbbbbbb": 1, "cccccccccccc": -1 }));
        assert_eq!((m["canPublish"].as_bool(), m["moderator"].as_bool()), (Some(true), Some(false)));
    }

    #[test]
    fn the_list_kept_on_disk_is_read_back_and_follows_votes_and_take_downs() {
        let dir = std::env::temp_dir().join(format!("mm-community-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw = json!({ "presets": [entry("aaaaaaaaaaaa", "One"), entry("bbbbbbbbbbbb", "Two")] });
        std::fs::write(dir.join("community-presets.json"), raw.to_string()).unwrap();
        let c = CommunityPresets::new(&dir);
        assert_eq!(c.list().len(), 2);
        c.set_mine(Some(normalize_mine(&json!({ "presets": ["aaaaaaaaaaaa"], "votes": {} }))));
        c.counted("bbbbbbbbbbbb", 9, 2);
        c.voted("bbbbbbbbbbbb", 1);
        assert_eq!(c.get("bbbbbbbbbbbb").unwrap()["likes"], 9);
        assert_eq!(c.mine().unwrap()["votes"]["bbbbbbbbbbbb"], 1);
        c.forget("aaaaaaaaaaaa");
        assert_eq!(c.list().len(), 1);
        assert_eq!(c.mine().unwrap()["presets"], json!([]));
        c.published("cccccccccccc");
        assert_eq!(c.mine().unwrap()["presets"], json!(["cccccccccccc"]));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
