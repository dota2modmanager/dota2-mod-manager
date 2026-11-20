//! The release manifest (manifest.json of h6rd/Dota2PornFx): every archive the releases carry,
//! with its category, name, size and sha256. The catalog's mods.json still says what a mod is;
//! this says where its archive is now. It is fetched from GitHub first, then the Hugging Face
//! dataset, then jsDelivr, and kept in the catalog cache so an offline start still knows where
//! the releases put things.
//!
//! The manifest is not signed, unlike mods.json, so it is never the only word: the archive's
//! hash is checked against the catalog's own signed list when that list has one, and the old
//! GitHub files tree stays as the last place a download can come from.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{OnceLock, RwLock};

use serde_json::Value;

use crate::net_fetch::{FetchOptions, Net};

/// The manifest as the releases repository publishes it, best first.
pub const URLS: [&str; 3] = [
    "https://raw.githubusercontent.com/h6rd/Dota2PornFx/main/manifest.json",
    "https://huggingface.co/datasets/hrdq/Dota2PornFx/resolve/main/manifest.json",
    "https://cdn.jsdelivr.net/gh/h6rd/Dota2PornFx@main/manifest.json",
];

/// The file name in the catalog cache.
pub const CACHE_FILE: &str = "manifest.json";

/// One archive in the manifest.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub category: String,
    pub name: String,
    pub asset: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub date: i64,
}

/// Every release archive, looked up by category and the name mods.json uses.
#[derive(Debug, Clone, Default)]
pub struct Manifest {
    by_name: HashMap<(String, String), Entry>,
    by_asset: HashMap<(String, String), Entry>,
}

fn key(category: &str, name: &str) -> (String, String) {
    (category.to_ascii_lowercase(), name.to_string())
}

impl Manifest {
    pub fn parse(text: &str) -> Result<Manifest, String> {
        let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let files = value.get("files").and_then(Value::as_array).ok_or("manifest has no files")?;
        let mut out = Manifest::default();
        for file in files {
            let (Some(category), Some(name), Some(url)) = (
                file.get("category").and_then(Value::as_str),
                file.get("name").and_then(Value::as_str),
                file.get("url").and_then(Value::as_str),
            ) else {
                continue;
            };
            if category.is_empty() || name.is_empty() || !url.starts_with("https://") {
                continue;
            }
            let entry = Entry {
                category: category.to_string(),
                name: name.to_string(),
                asset: file.get("asset").and_then(Value::as_str).unwrap_or(name).to_string(),
                url: url.to_string(),
                sha256: file.get("sha256").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase(),
                size: file.get("size").and_then(Value::as_u64).unwrap_or(0),
                date: file.get("date").and_then(Value::as_i64).unwrap_or(0),
            };
            // a name repeated (a release rebuilt under another tag) is the newest one
            let fresh = |old: &Entry| entry.date >= old.date;
            let name_key = key(category, name);
            if out.by_name.get(&name_key).is_none_or(fresh) {
                out.by_name.insert(name_key, entry.clone());
            }
            if !entry.asset.is_empty() {
                let asset_key = key(category, &entry.asset);
                if out.by_asset.get(&asset_key).is_none_or(fresh) {
                    out.by_asset.insert(asset_key, entry.clone());
                }
            }
        }
        Ok(out)
    }

    pub fn find(&self, category: &str, name: &str) -> Option<&Entry> {
        let k = key(category, name);
        self.by_name.get(&k).or_else(|| self.by_asset.get(&k))
    }
}

fn store() -> &'static RwLock<Option<Manifest>> {
    static STORE: OnceLock<RwLock<Option<Manifest>>> = OnceLock::new();
    STORE.get_or_init(|| RwLock::new(None))
}

/// Put a freshly fetched manifest in place for every later download.
pub fn remember(manifest: Manifest) {
    *store().write().unwrap_or_else(|e| e.into_inner()) = Some(manifest);
}

/// Read the cache once, so a start with no network still knows the release addresses.
pub fn load_cached(path: &Path) {
    if store().read().unwrap_or_else(|e| e.into_inner()).is_some() {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else { return };
    if let Ok(manifest) = Manifest::parse(&text) {
        remember(manifest);
    }
}

/// The manifest text from the first source that answers, for the caller to parse and cache.
pub fn fetch_text(net: &Net) -> Result<String, String> {
    let mut last = String::from("manifest.json is unreachable");
    for url in URLS {
        match net.fetch_text(url, FetchOptions::default()) {
            Ok(text) => match Manifest::parse(&text) {
                Ok(_) => return Ok(text),
                Err(e) => last = format!("{url}: {e}"),
            },
            Err(e) => last = e.message,
        }
    }
    Err(last)
}

/// The release entry for a catalog archive: mods.json's category and fileRef.
pub fn entry(category: &str, file_ref: &str) -> Option<Entry> {
    let name = crate::installer_downloads::file_name_of(file_ref);
    store().read().unwrap_or_else(|e| e.into_inner()).as_ref()?.find(category, &name).cloned()
}

/// The hash the release manifest gives this archive, when it has one.
pub fn sha256(category: &str, file_ref: &str) -> Option<String> {
    entry(category, file_ref).map(|e| e.sha256).filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "files": [
        {"category":"ancient","name":"Ancient Dragon King.zip","asset":"Ancient.Dragon.King.zip",
         "url":"https://github.com/h6rd/Dota2PornFx/releases/download/ancient/Ancient.Dragon.King.zip",
         "sha256":"AA11","size":12,"date":1},
        {"category":"terrains","name":"Dark Terrain Minify.zip","asset":"Dark.Terrain.Minify.zip",
         "url":"https://github.com/h6rd/Dota2PornFx/releases/download/terrains/Dark.Terrain.Minify.zip",
         "sha256":"bb22","size":34,"date":2}
      ]
    }"#;

    #[test]
    fn an_archive_is_found_by_its_name_or_the_asset_the_release_carries() {
        let m = Manifest::parse(SAMPLE).unwrap();
        let by_name = m.find("ancient", "Ancient Dragon King.zip").unwrap();
        assert_eq!(
            by_name.url,
            "https://github.com/h6rd/Dota2PornFx/releases/download/ancient/Ancient.Dragon.King.zip"
        );
        let by_asset = m.find("terrains", "Dark.Terrain.Minify.zip").unwrap();
        assert_eq!(by_asset.name, "Dark Terrain Minify.zip");
        // the categories and names are the ones the rest of the app compares
        assert!(m.find("Ancient", "Ancient Dragon King.zip").is_some());
        assert!(m.find("ancient", "Missing.zip").is_none());
    }

    #[test]
    fn a_rebuilt_release_is_the_newest_entry_and_a_bad_file_is_refused() {
        let text = r#"{"files":[
          {"category":"x","name":"a.zip","url":"https://example.test/old.zip","sha256":"aa","size":1,"date":1},
          {"category":"x","name":"a.zip","url":"https://example.test/new.zip","sha256":"bb","size":2,"date":9},
          {"category":"x","name":"b.zip","url":"http://not-https.test/b.zip","sha256":"cc","size":3}
        ]}"#;
        let m = Manifest::parse(text).unwrap();
        assert_eq!(m.find("x", "a.zip").unwrap().url, "https://example.test/new.zip");
        assert!(m.find("x", "b.zip").is_none());
    }

    #[test]
    fn a_manifest_without_files_is_refused() {
        assert!(Manifest::parse("{}").is_err());
        assert!(Manifest::parse("not json").is_err());
    }
}
