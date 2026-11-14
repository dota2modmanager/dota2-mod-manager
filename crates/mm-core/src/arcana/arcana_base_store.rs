//! The arcana bases brought down from their repository and kept on disk (src/arcana-base-store.ts),
//! so a build reads them like it reads pak01.
//!
//! The repository's manifest.json lists every file of every base with git's hash of it, and
//! manifest.json.sig beside it is the bases' key's signature over it. The list is taken only when
//! the signature is good, and each file only when it matches its hash, so a mirror can be trusted
//! with all of it. Where neither can be had, the list from last time, checked again.
//!
//! On disk: blobs/<hash>, one per file whatever base it is in, and ready.json, each base that is
//! all here. A base is only in ready.json once every file of it is.
//!
//! The TypeScript brings a base down in the background; here `want` is synchronous and the shell
//! runs it off the main thread. What it does with the network goes through `Fetch`, so a test (or
//! the app's mirror chain) supplies it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

use crate::vpk::Entry;

/// Where the bases are published, owner/name on GitHub.
pub const BASES_REPO: &str = "dota2modmanager/hero-base-fixes";
const BRANCH: &str = "main";
/// Base64 SPKI of the ed25519 key the bases' manifest is signed with.
pub const BASES_PUBLIC_KEY: &str = "MCowBQYDK2VwAyEAAzqINyzZu0s84UbXXU+9uRuN0Z8IH7TO2oSCMO0tcMU=";
/// How long a base that could not be had waits before it is asked for again.
pub const RETRY_MS: f64 = 5.0 * 60.0 * 1000.0;
/// Files brought down at once.
const PARALLEL: usize = 6;

/// Each base's files: its path inside the base -> git's hash of it.
pub type Listing = IndexMap<String, IndexMap<String, String>>;

/// Files of a base to take from one commit rather than from the manifest's.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Pin {
    pub commit: String,
    pub files: IndexMap<String, String>,
}

/// An answer from the network: its status and its bytes.
pub struct Got {
    pub status: u16,
    pub body: Vec<u8>,
}

/// One request, `small` as the mirror chain means it; an error is the network's.
pub type Fetch<'a> = &'a (dyn Fn(&str, bool) -> Result<Got, String> + Sync);

fn raw_url(rel: &str, r#ref: &str) -> String {
    format!("https://raw.githubusercontent.com/{BASES_REPO}/{ref}/{rel}", ref = r#ref)
}

/// git's hash of a file: what the repository's tree names it by.
pub fn blob_sha(data: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", data.len()).as_bytes());
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn sha_ok(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Only what a base can be out of a list: a file under models/, materials/ or particles/, named
/// by a git hash, with no step out of the base.
pub fn safe_listing(raw: &Value) -> Listing {
    let id_ok = Regex::new(r"(?i)^[a-z0-9_]+$").expect("a fixed pattern");
    let file_ok = Regex::new(r"(?i)^(models|materials|particles)/[^\\:]+$").expect("a fixed pattern");
    let mut out = Listing::new();
    let Some(bases) = raw.as_object() else { return out };
    for (id, files) in bases {
        let Some(files) = files.as_object().filter(|_| id_ok.is_match(id)) else { continue };
        for (rel, sha) in files {
            let Some(sha) = sha.as_str().filter(|s| sha_ok(s)) else { continue };
            if !file_ok.is_match(rel) || rel.split('/').any(|s| s == ".." || s == "." || s.is_empty()) {
                continue;
            }
            out.entry(id.clone()).or_default().insert(rel.clone(), sha.to_string());
        }
    }
    out
}

/// The bases in a manifest, or None when its signature is not the key's over exactly these bytes.
pub fn signed_listing(manifest: &str, sig: &str, key: &str) -> Option<Listing> {
    if !crate::catalog_signature::verify(manifest.as_bytes(), sig, key) {
        return None;
    }
    let v: Value = serde_json::from_str(manifest).ok()?;
    Some(safe_listing(v.get("bases").unwrap_or(&Value::Null)))
}

fn same_files(a: Option<&IndexMap<String, String>>, b: &IndexMap<String, String>) -> bool {
    a.is_some_and(|a| a.len() == b.len() && b.iter().all(|(k, v)| a.get(k) == Some(v)))
}

fn write_json(file: &Path, value: &Value) -> std::io::Result<()> {
    let tmp = PathBuf::from(format!("{}.tmp", file.display()));
    std::fs::write(&tmp, serde_json::to_string(value).unwrap_or_default())?;
    std::fs::rename(&tmp, file)
}

/// The bases on disk, and bringing one down when a build needs it.
pub struct BaseStore {
    pub dir: PathBuf,
    pub key: String,
    pub pins: IndexMap<String, Pin>,
    listing: Option<Listing>,
    /// bases asked for this run and how it went, so a build that runs ten times asks once
    asked: HashMap<String, bool>,
    failed_at: HashMap<String, f64>,
}

impl BaseStore {
    pub fn new(dir: &Path) -> BaseStore {
        BaseStore {
            dir: dir.to_path_buf(),
            key: BASES_PUBLIC_KEY.to_string(),
            pins: IndexMap::new(),
            listing: None,
            asked: HashMap::new(),
            failed_at: HashMap::new(),
        }
    }

    fn blobs(&self) -> PathBuf {
        self.dir.join("blobs")
    }

    // a hash is the file's name, so only ever a hash: never a path somebody wrote into a list
    fn blob_path(&self, sha: &str) -> Result<PathBuf, String> {
        if !sha_ok(sha) {
            return Err(format!("not a file hash: {sha}"));
        }
        Ok(self.blobs().join(sha))
    }

    /// The bases that are all here.
    pub fn ready(&self) -> Listing {
        std::fs::read_to_string(self.dir.join("ready.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Listing>(&s).ok())
            .unwrap_or_default()
    }

    fn fetch_listing(&self, fetch: Fetch, log: &mut dyn FnMut(String)) -> Result<Listing, String> {
        let file = self.dir.join("listing.json");
        let cached: Value =
            std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let fresh = (|| -> Result<Listing, String> {
            let get = |rel: &str| -> Result<String, String> {
                let res = fetch(&raw_url(rel, BRANCH), true)?;
                if !(200..300).contains(&res.status) {
                    return Err(format!("{rel}: HTTP {}", res.status));
                }
                Ok(String::from_utf8_lossy(&res.body).into_owned())
            };
            let manifest = get("manifest.json")?;
            let sig = get("manifest.json.sig")?;
            let bases =
                signed_listing(&manifest, &sig, &self.key).ok_or("manifest.json is not signed by the bases' key")?;
            if bases.is_empty() {
                return Err("no bases in it".into());
            }
            std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            write_json(&file, &json!({ "manifest": manifest, "sig": sig })).map_err(|e| e.to_string())?;
            Ok(bases)
        })();
        match fresh {
            Ok(b) => return Ok(b),
            Err(e) => log(format!("arcana bases: the list could not be had: {e}")),
        }
        let text = |k: &str| cached.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
        if let (Some(m), Some(s)) = (text("manifest"), text("sig")) {
            if let Some(b) = signed_listing(m, s, &self.key) {
                return Ok(b);
            }
        }
        Err("the list of bases could not be had".into())
    }

    fn bring(&self, id: &str, rel: &str, sha: &str, fetch: Fetch) -> Result<(), String> {
        let dest = self.blob_path(sha)?;
        if dest.exists() {
            return Ok(());
        }
        let path: Vec<String> = rel.split('/').map(crate::installer_downloads::encode_uri_component).collect();
        let pin = self.pins.get(id).filter(|p| p.files.get(rel).is_some_and(|s| !s.is_empty()));
        let url = raw_url(&format!("src/{id}/{}", path.join("/")), pin.map_or(BRANCH, |p| p.commit.as_str()));
        let res = fetch(&url, true)?;
        if !(200..300).contains(&res.status) {
            return Err(format!("{rel}: HTTP {}", res.status));
        }
        if blob_sha(&res.body) != sha {
            return Err(format!("{rel}: not the file the repository names"));
        }
        // the bytes are git's hash of themselves, and the file is named by that hash and nothing else
        std::fs::create_dir_all(self.blobs()).map_err(|e| e.to_string())?;
        let tmp = PathBuf::from(format!("{}.part", dest.display()));
        std::fs::write(&tmp, &res.body).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())
    }

    /// Files no base here uses any more, those of a base still coming down kept.
    fn sweep(&self, have: &Listing, coming: Option<&IndexMap<String, String>>) {
        let used: HashSet<&String> = have.values().chain(coming).flat_map(|f| f.values()).collect();
        let Ok(names) = std::fs::read_dir(self.blobs()) else { return };
        for n in names.flatten() {
            let name = n.file_name().to_string_lossy().into_owned();
            if !used.contains(&name.strip_suffix(".part").unwrap_or(&name).to_string()) {
                let _ = std::fs::remove_file(n.path());
            }
        }
    }

    /// Whether the base on disk changed.
    fn fetch_base(&mut self, id: &str, fetch: Fetch, log: &mut dyn FnMut(String)) -> Result<bool, String> {
        if self.listing.is_none() {
            // asked again next time when it fails, the network may be back
            self.listing = Some(self.fetch_listing(fetch, log)?);
        }
        let mut files = self.listing.as_ref().and_then(|l| l.get(id)).cloned();
        if let (Some(f), Some(pin)) = (files.as_mut(), self.pins.get(id)) {
            for (k, v) in &pin.files {
                f.insert(k.clone(), v.clone());
            }
        }
        let files = files.filter(|f| !f.is_empty()).ok_or_else(|| format!("the repository has no base {id}"))?;
        let ready = self.ready();
        let all_here = files.values().all(|sha| self.blob_path(sha).is_ok_and(|p| p.exists()));
        if same_files(ready.get(id), &files) && all_here {
            return Ok(false);
        }
        let queue: std::sync::Mutex<std::collections::VecDeque<(usize, (&String, &String))>> =
            std::sync::Mutex::new(files.iter().enumerate().collect());
        // the failure of the file first in the list, whichever worker met it first
        let failed: std::sync::Mutex<Option<(usize, String)>> = std::sync::Mutex::new(None);
        let this = &*self;
        std::thread::scope(|s| {
            for _ in 0..PARALLEL {
                // a worker stops at its own failure and the others go on, as the TypeScript's do
                s.spawn(|| loop {
                    let next = queue.lock().ok().and_then(|mut q| q.pop_front());
                    let Some((at, (rel, sha))) = next else { return };
                    if let Err(e) = this.bring(id, rel, sha, fetch) {
                        if let Ok(mut f) = failed.lock() {
                            if f.as_ref().is_none_or(|(k, _)| at < *k) {
                                *f = Some((at, e));
                            }
                        }
                        return;
                    }
                });
            }
        });
        if let Some((_, e)) = failed.into_inner().ok().flatten() {
            return Err(e);
        }
        let mut have = self.ready();
        have.insert(id.to_string(), files);
        let v = serde_json::to_value(&have).map_err(|e| e.to_string())?;
        write_json(&self.dir.join("ready.json"), &v).map_err(|e| e.to_string())?;
        self.sweep(&have, None);
        Ok(true)
    }

    /// A base's files to build with, or None when it is not all here.
    pub fn entries(&mut self, id: &str) -> Option<Vec<Entry>> {
        let files = self.ready().get(id).cloned()?;
        let mut out = Vec::new();
        for (rel, sha) in &files {
            match self.blob_path(sha).and_then(|p| std::fs::read(p).map_err(|e| e.to_string())) {
                Ok(data) => out.push(crate::vpk::entry_at(rel, data.into())),
                Err(_) => {
                    // a file gone from the disk: brought down again by the next want
                    self.asked.remove(id);
                    return None;
                }
            }
        }
        Some(out)
    }

    /// Bring a base down, or its newer version, once a run; whether the disk changed, for the
    /// caller to build again.
    pub fn want(&mut self, id: &str, fetch: Fetch, now: f64, log: &mut dyn FnMut(String)) -> bool {
        if let Some(&known) = self.asked.get(id) {
            return known;
        }
        if self.failed_at.get(id).is_some_and(|&t| now - t < RETRY_MS) {
            return false;
        }
        match self.fetch_base(id, fetch, log) {
            Ok(changed) => {
                if changed {
                    log(format!("arcana bases: {id} is here"));
                }
                self.asked.insert(id.to_string(), changed);
                changed
            }
            Err(e) => {
                self.asked.remove(id);
                self.failed_at.insert(id.to_string(), now);
                log(format!("arcana bases: {id} could not be brought down: {e}"));
                false
            }
        }
    }
}
