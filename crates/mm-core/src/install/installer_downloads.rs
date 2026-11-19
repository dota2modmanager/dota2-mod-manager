//! The download cache: where a catalog mod's archive lives, what it is called on disk, and what
//! each file hashed to when it arrived, replacing the disk half of src/installer-downloads.ts.
//! `download` brings a catalog archive over the mirror chain (`net_fetch.rs`).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::installer::Installer;

/// The catalog's old files tree (src/catalog.ts RAW_BASE): the last place an archive can come
/// from now that the releases carry it.
pub const RAW_BASE: &str = "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main";

/// The release files kept in the Hugging Face dataset, beside the manifest mirror.
pub const HF_FILES_BASE: &str = "https://huggingface.co/datasets/hrdq/Dota2PornFx/resolve/main/assets/files";

/// encodeURIComponent: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) as UTF-8 escapes.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// decodeURIComponent, or None where it would throw (a stray % or bytes that are not UTF-8).
pub fn decode_uri_component(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            if !hex.bytes().all(|c| c.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn is_absolute(file_ref: &str) -> bool {
    let lower = file_ref.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// The name a fileRef stands for: the tail of a URL, or the relative name itself. This is what
/// mods.json's name and the manifest's `name` are compared by, and what the cache file is called.
pub fn file_name_of(file_ref: &str) -> String {
    let bare = if is_absolute(file_ref) {
        let no_query = file_ref.split(['?', '#']).next().unwrap_or("");
        no_query.rsplit('/').next().unwrap_or("").to_string()
    } else {
        let flat = file_ref.replace('\\', "/");
        flat.rsplit('/').next().unwrap_or("").to_string()
    };
    decode_uri_component(&bare).unwrap_or(bare)
}

/// The address the old files tree has kept for this archive all along.
fn old_file_url(category_id: &str, file_ref: &str) -> String {
    format!("{RAW_BASE}/assets/files/{category_id}/{}", encode_uri_component(file_name_of(file_ref).as_str()))
}

/// Every address worth trying for one archive, best first: the release the manifest names, the
/// same file on Hugging Face, then the old files tree. An absolute fileRef is only itself.
pub fn source_urls(category_id: &str, file_ref: &str) -> Vec<String> {
    if is_absolute(file_ref) {
        return vec![file_ref.to_string()];
    }
    let mut out = Vec::new();
    let name = file_name_of(file_ref);
    let mut hf_name = name.clone();
    if let Some(entry) = crate::manifest::entry(category_id, &name) {
        if entry.url.starts_with("https://") {
            out.push(entry.url);
        }
        // the dataset keeps the archives under the manifest's own name, not the release's asset
        if !entry.name.is_empty() {
            hf_name = entry.name;
        }
    }
    // even with no manifest, the dataset is a better first fallback than the old files tree
    let hf = format!("{HF_FILES_BASE}/{}/{}", encode_uri_component(category_id), encode_uri_component(&hf_name));
    if out.last() != Some(&hf) {
        out.push(hf);
    }
    let old = old_file_url(category_id, file_ref);
    if out.last() != Some(&old) {
        out.push(old);
    }
    out
}

/// The old files tree's address for a catalog file, which reads such as the terrain tail still
/// use: a GitHub release asset refuses a range request (501). Downloads go through `source_urls`.
pub fn file_url(category_id: &str, file_ref: &str) -> String {
    if is_absolute(file_ref) {
        file_ref.to_string()
    } else {
        old_file_url(category_id, file_ref)
    }
}

/// A name from the catalog is a name, never a path: the last segment, without what Windows
/// refuses, at most 150 characters; "", "." and ".." fall back.
pub fn safe_file_name(raw: &str, fallback: &str) -> String {
    let flat = raw.replace('\\', "/");
    let last = &flat[flat.rfind('/').map_or(0, |i| i + 1)..];
    // [...last] walks code points; .slice(0, 150) then counts UTF-16 units
    let kept: String = last.chars().filter(|&c| c >= ' ' && !"<>:\"|?*".contains(c)).collect();
    let mut units = 0;
    let mut cleaned = String::new();
    for c in kept.chars() {
        units += c.len_utf16();
        if units > 150 {
            // a surrogate pair cut in half leaves its high half in JavaScript; there is no such char here
            break;
        }
        cleaned.push(c);
    }
    if cleaned.chars().all(|c| c == '.') {
        fallback.to_string()
    } else {
        cleaned
    }
}

/// The lock for one file of the download cache, shared by everyone asking for that file.
fn one_at_a_time(dest: &std::path::Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut all = LOCKS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    // the ones nobody holds any more go, so the map stays as small as the downloads under way
    all.retain(|_, l| Arc::strong_count(l) > 1);
    all.entry(dest.to_path_buf()).or_default().clone()
}

/// One archive in the download cache, as Settings lists it (issue #430).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedDownload {
    pub key: String,
    pub category_id: String,
    pub name: String,
    pub bytes: u64,
    pub at: f64,
}

fn mtime_ms(m: &fs::Metadata) -> f64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

impl Installer {
    fn index_file(&self) -> PathBuf {
        self.downloads_dir().join("index.json")
    }

    /// What each downloaded archive hashed to, in the file's own order.
    pub fn download_index(&self) -> Map<String, Value> {
        fs::read_to_string(self.index_file())
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default()
    }

    fn save_index(&self, index: Map<String, Value>) {
        let _ = fs::write(self.index_file(), crate::js::stringify(&Value::Object(index), "  "));
    }

    pub fn remember_download(&self, key: &str, entry: Value) {
        let mut index = self.download_index();
        index.insert(key.to_string(), entry);
        self.save_index(index);
    }

    /// Where `download` would put a catalog file, its cache key, and the name upstream uses.
    pub fn download_target(&self, category_id: &str, file_ref: &str) -> (PathBuf, String, String) {
        let decoded = file_name_of(file_ref);
        let safe_name = safe_file_name(&decoded, "mod");
        let dest = self.downloads_dir().join(safe_file_name(category_id, "other")).join(&safe_name);
        (dest, format!("{category_id}/{safe_name}"), decoded)
    }

    /// The archive of a catalog mod on disk: from the cache when it is still what arrived,
    /// downloaded otherwise. `published` is the hash the catalog published for a file
    /// (`Catalog::published_hash`); it outranks every proxy, and so does what the file was the
    /// first time it arrived here, but neither outranks the catalog's own host.
    pub fn download(
        &self,
        net: &crate::net_fetch::Net,
        category_id: &str,
        file_ref: &str,
        label: Option<&str>,
        published: &dyn Fn(&str, &str) -> Option<String>,
        progress: &mut dyn FnMut(Value),
    ) -> Result<PathBuf, String> {
        let (dest, key, decoded) = self.download_target(category_id, file_ref);
        // one download of a file at a time: the mod's window asks for its archive from the 3D
        // stage twice and again on every reopening, and each request started the same file over
        // into the same .part (2026-11-17). A second asker waits and takes the cached copy.
        let one = one_at_a_time(&dest);
        let _held = one.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let safe_name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let label = label.filter(|l| !l.is_empty()).unwrap_or(&safe_name).to_string();
        let known = self.download_index().get(&key).filter(|k| crate::js::truthy(k)).cloned();
        let known_sha =
            known.as_ref().and_then(|k| k.get("sha256")).filter(|s| crate::js::truthy(s)).map(crate::js::string);
        // the release manifest's hash belongs to the release file, so it comes before the older list
        let published = crate::manifest::sha256(category_id, &decoded).or_else(|| published(category_id, &decoded));
        if let Some(size) = fs::metadata(&dest).ok().map(|m| m.len()).filter(|n| *n > 0) {
            // a copy cut short, or one the catalog now disagrees with, is not a cached copy
            let disowned = published.as_ref().is_some_and(|p| known_sha.as_ref().is_some_and(|k| k != p));
            let same_size = known.as_ref().is_none_or(|k| k.get("size").and_then(Value::as_f64) == Some(size as f64));
            if !disowned && same_size {
                return Ok(dest);
            }
            progress(
                json!({ "type": "stage", "label": label, "stage": crate::i18n::t("перекачиваю повреждённый файл", &[]) }),
            );
            let _ = fs::remove_file(&dest);
        }
        let sources = source_urls(category_id, file_ref);
        let mut last: Option<crate::net_fetch::NetError> = None;
        let mut any_checksum = false;
        for url in sources {
            let mut on_progress = |loaded: u64, total: u64| {
                progress(json!({ "type": "download", "label": label, "loaded": loaded, "total": total }))
            };
            let opts = crate::net_fetch::DownloadOptions {
                on_progress: Some(&mut on_progress),
                expect_sha256: published.clone().or_else(|| known_sha.clone()),
                from_published_list: true,
                log: None,
            };
            match net.download_file(&url, &dest, opts) {
                Ok(d) => {
                    self.remember_download(&key, json!({ "size": d.bytes, "sha256": d.sha256, "at": crate::js::json_number(crate::net_fetch::now_ms()) }));
                    return Ok(dest);
                }
                Err(e) => {
                    any_checksum |= e.checksum;
                    last = Some(e);
                }
            }
        }
        if any_checksum {
            return Err(crate::i18n::t(
                "{0}: скачанный файл не совпадает с тем, что опубликовал автор мода. Попробуй позже",
                &[json!(safe_name)],
            ));
        }
        let message = last.map(|e| e.message).unwrap_or_else(|| "no source answered".into());
        Err(crate::i18n::t("Не удалось скачать {0}: {1}", &[json!(safe_name), json!(message)]))
    }

    /// The archive this mod was installed from, if it is still in the download cache.
    pub fn cached_archive(&self, category_id: Option<&str>, file_ref: Option<&str>) -> Option<PathBuf> {
        let (cat, file_ref) = (category_id.filter(|c| !c.is_empty())?, file_ref.filter(|f| !f.is_empty())?);
        let name = file_name_of(file_ref);
        let p = name
            .split(['/', '\\'])
            .fold(self.downloads_dir().join(cat), |p, s| if s.is_empty() { p } else { p.join(s) });
        fs::metadata(&p).ok().filter(|m| m.len() > 0).map(|_| p)
    }

    /// Bytes the download cache holds.
    pub fn download_cache_size(&self) -> u64 {
        folder_size(&self.downloads_dir())
    }

    /// Every archive in the download cache, largest first.
    pub fn list_download_cache(&self) -> Vec<CachedDownload> {
        let mut out = Vec::new();
        let Ok(cats) = crate::js::read_dir(&self.downloads_dir()) else { return out };
        for cat in cats {
            if !cat.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let cname = cat.file_name().to_string_lossy().into_owned();
            let Ok(files) = crate::js::read_dir(&cat.path()) else { continue };
            for f in files {
                if !f.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                let Ok(st) = fs::metadata(f.path()) else { continue };
                let name = f.file_name().to_string_lossy().into_owned();
                out.push(CachedDownload {
                    key: format!("{cname}/{name}"),
                    category_id: cname.clone(),
                    name,
                    bytes: st.len(),
                    at: mtime_ms(&st),
                });
            }
        }
        out.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| crate::js::locale_compare(&a.key, &b.key)));
        out
    }

    /// Delete one cached archive and its line in the hash index; only a key the listing gave.
    pub fn remove_cached_download(&self, key: &str) -> bool {
        let Some(entry) = self.list_download_cache().into_iter().find(|d| d.key == key) else { return false };
        let _ = fs::remove_file(self.downloads_dir().join(&entry.category_id).join(&entry.name));
        let mut index = self.download_index();
        if index.shift_remove(key).is_some() {
            self.save_index(index);
        }
        true
    }

    /// Empty the download cache, keeping the folder.
    pub fn clear_download_cache(&self) {
        let _ = fs::remove_dir_all(self.downloads_dir());
        let _ = fs::create_dir_all(self.downloads_dir());
    }

    /// What `download` decides before it fetches: reuse the cached copy, or fetch (and why).
    /// `published` is the catalog's sha256 for the file, when it has one.
    pub fn cache_verdict(&self, category_id: &str, file_ref: &str, published: Option<&str>) -> Value {
        let (dest, key, decoded) = self.download_target(category_id, file_ref);
        let known = self.download_index().get(&key).cloned();
        let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        let published = crate::manifest::sha256(category_id, file_ref).or_else(|| published.map(String::from));
        if size > 0 {
            let known_sha =
                known.as_ref().and_then(|k| k.get("sha256")).and_then(Value::as_str).filter(|s| !s.is_empty());
            let disowned = matches!((published.as_deref(), known_sha), (Some(p), Some(k)) if !p.is_empty() && k != p);
            let size_ok = known.as_ref().is_none_or(|k| k.get("size").and_then(Value::as_f64) == Some(size as f64));
            if !disowned && size_ok {
                return json!({ "use": dest, "key": key, "decoded": decoded });
            }
            return json!({ "refetch": dest, "key": key, "decoded": decoded,
                "expect": published.filter(|p| !p.is_empty()).or_else(|| known_sha.map(String::from)) });
        }
        let expect = published
            .filter(|p| !p.is_empty())
            .or_else(|| known.as_ref().and_then(|k| k.get("sha256")).and_then(Value::as_str).map(String::from));
        json!({ "fetch": dest, "key": key, "decoded": decoded, "expect": expect })
    }
}

/// Bytes under a folder, however deep; what cannot be read is skipped (src/folder-size.ts).
pub fn folder_size(dir: &std::path::Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    let mut bytes = 0;
    for e in entries.flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            bytes += folder_size(&p);
        } else if let Ok(m) = fs::metadata(&p) {
            bytes += m.len();
        }
    }
    bytes
}

#[cfg(test)]
mod tests {
    /// The release link first, then Hugging Face, then the old files tree; no manifest still means
    /// Hugging Face before the old tree.
    #[test]
    fn archives_try_the_release_then_hugging_face_then_the_old_tree() {
        let text = r#"{"files":[{"category":"test-sources","name":"A B.zip","asset":"A.B.zip",
            "url":"https://github.com/h6rd/Dota2PornFx/releases/download/test-sources/A.B.zip",
            "sha256":"aa","size":1,"date":1}]}"#;
        crate::manifest::remember(crate::manifest::Manifest::parse(text).unwrap());
        let urls = super::source_urls("test-sources", "A B.zip");
        assert_eq!(
            urls,
            vec![
                "https://github.com/h6rd/Dota2PornFx/releases/download/test-sources/A.B.zip".to_string(),
                "https://huggingface.co/datasets/hrdq/Dota2PornFx/resolve/main/assets/files/test-sources/A%20B.zip"
                    .to_string(),
                "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/assets/files/test-sources/A%20B.zip"
                    .to_string(),
            ]
        );
        let unmatched = super::source_urls("test-other", "C D.zip");
        assert_eq!(unmatched.len(), 2);
        assert!(unmatched[0].starts_with("https://huggingface.co/"));
        assert!(unmatched[1].starts_with("https://raw.githubusercontent.com/"));
    }

    /// Two askers of one file share its lock while either holds it; another file is not held up.
    #[test]
    fn askers_of_one_file_wait_for_each_other() {
        let a = std::path::Path::new("downloads/heroes/a.zip");
        let first = super::one_at_a_time(a);
        let held = first.lock().unwrap();
        assert!(super::one_at_a_time(a).try_lock().is_err());
        assert!(super::one_at_a_time(std::path::Path::new("downloads/heroes/b.zip")).try_lock().is_ok());
        drop(held);
        assert!(super::one_at_a_time(a).try_lock().is_ok());
    }
}
