//! The download cache: where a catalog mod's archive lives, what it is called on disk, and what
//! each file hashed to when it arrived, replacing the disk half of src/installer-downloads.ts.
//! `download` brings a catalog archive over the mirror chain (`net_fetch.rs`).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::installer::Installer;

/// The catalog's raw files (src/catalog.ts RAW_BASE).
pub const RAW_BASE: &str = "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main";

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

/// Where a catalog file is fetched from: its own URL, or the catalog's files folder.
pub fn file_url(category_id: &str, file_ref: &str) -> String {
    let lower = file_ref.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return file_ref.to_string();
    }
    format!("{RAW_BASE}/assets/files/{category_id}/{}", encode_uri_component(file_ref))
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
        let url = file_url(category_id, file_ref);
        let bare = url.split(['?', '#']).next().unwrap_or("");
        let tail = bare.rsplit('/').next().unwrap_or("");
        let decoded = decode_uri_component(tail).unwrap_or_else(|| tail.to_string());
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
        let url = file_url(category_id, file_ref);
        let (dest, key, decoded) = self.download_target(category_id, file_ref);
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let safe_name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let label = label.filter(|l| !l.is_empty()).unwrap_or(&safe_name).to_string();
        let known = self.download_index().get(&key).filter(|k| crate::js::truthy(k)).cloned();
        let known_sha =
            known.as_ref().and_then(|k| k.get("sha256")).filter(|s| crate::js::truthy(s)).map(crate::js::string);
        let published = published(category_id, &decoded);
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
        let mut on_progress = |loaded: u64, total: u64| {
            progress(json!({ "type": "download", "label": label, "loaded": loaded, "total": total }))
        };
        let opts = crate::net_fetch::DownloadOptions {
            on_progress: Some(&mut on_progress),
            expect_sha256: published.or(known_sha),
            from_published_list: true,
            log: None,
        };
        match net.download_file(&url, &dest, opts) {
            Ok(d) => {
                self.remember_download(&key, json!({ "size": d.bytes, "sha256": d.sha256, "at": crate::js::json_number(crate::net_fetch::now_ms()) }));
                Ok(dest)
            }
            Err(e) if e.checksum => Err(crate::i18n::t(
                "{0}: скачанный файл не совпадает с тем, что опубликовал автор мода. Попробуй позже",
                &[json!(safe_name)],
            )),
            Err(e) => Err(crate::i18n::t("Не удалось скачать {0}: {1}", &[json!(safe_name), json!(e.message)])),
        }
    }

    /// The archive this mod was installed from, if it is still in the download cache.
    pub fn cached_archive(&self, category_id: Option<&str>, file_ref: Option<&str>) -> Option<PathBuf> {
        let (cat, file_ref) = (category_id.filter(|c| !c.is_empty())?, file_ref.filter(|f| !f.is_empty())?);
        let url = file_url(cat, file_ref);
        let name = decode_uri_component(url.rsplit('/').next().unwrap_or(""))?;
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
        if size > 0 {
            let known_sha =
                known.as_ref().and_then(|k| k.get("sha256")).and_then(Value::as_str).filter(|s| !s.is_empty());
            let disowned = matches!((published, known_sha), (Some(p), Some(k)) if !p.is_empty() && k != p);
            let size_ok = known.as_ref().is_none_or(|k| k.get("size").and_then(Value::as_f64) == Some(size as f64));
            if !disowned && size_ok {
                return json!({ "use": dest, "key": key, "decoded": decoded });
            }
            return json!({ "refetch": dest, "key": key, "decoded": decoded,
                "expect": published.filter(|p| !p.is_empty()).map(String::from).or_else(|| known_sha.map(String::from)) });
        }
        let expect = published
            .filter(|p| !p.is_empty())
            .map(String::from)
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
