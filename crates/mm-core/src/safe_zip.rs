//! The one door every foreign archive comes through, replacing src/safe-zip.ts.
//!
//! A zip describes itself in its own headers, so a hostile one can claim whatever it likes:
//! a bomb that honestly unpacks to gigabytes, or an entry named "../../../Windows/x.dll".
//! Both are stopped here. Callers get a flat list of files with forward-slash paths, already
//! stripped of anything that could escape a folder, and write through `safe_join` so a name
//! can never resolve outside the folder it was meant for.

use std::fs;
use std::io::{Read, Seek};
use std::path::{Component, Path, PathBuf};

use regex::Regex;
use serde_json::{json, Value};

use crate::file_tx::FileTx;
use crate::i18n::t;

const MB: u64 = 1024 * 1024;

/// The budgets an archive is held to (the same numbers as src/safe-zip.ts, measured on real archives).
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub archive_bytes: u64,
    pub entries: usize,
    pub entry_bytes: u64,
    pub total_bytes: u64,
    pub ratio: f64,
    pub ratio_floor: u64,
}

pub const LIMITS: Limits = Limits {
    archive_bytes: 2040 * MB,
    entries: 20000,
    entry_bytes: 2040 * MB,
    total_bytes: 4096 * MB,
    ratio: 200.0,
    ratio_floor: MB,
};

fn reserved() -> &'static Regex {
    static R: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$").unwrap())
}

fn windows_refuses(part: &str) -> bool {
    part != "." && (part.ends_with('.') || part.ends_with(' ') || reserved().is_match(part))
}

/// Absolute names, drive letters, any ".." segment and any segment Windows refuses.
pub fn is_unsafe_name(rel: &str) -> bool {
    if rel.is_empty() || rel.starts_with('/') {
        return true;
    }
    let b = rel.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return true;
    }
    rel.split('/').any(|part| part == ".." || windows_refuses(part))
}

/// path.resolve: absolute against the working folder, with "." and ".." folded away.
pub fn resolve(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(p) };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Join a path out of an archive to its folder, refusing anything that resolves outside.
pub fn safe_join(root_abs: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = resolve(root_abs);
    let dest = resolve(&root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)));
    if dest != root && !dest.starts_with(&root) {
        return Err(t("Недопустимый путь в архиве: {0}", &[json!(rel)]));
    }
    Ok(dest)
}

/// A file inside an archive that passed every check.
#[derive(Debug, Clone)]
pub struct ZipFile {
    pub path: String,
    pub size: u64,
    index: usize,
}

trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}

/// A foreign archive, opened: what is safe to hand out of it, and a way to unpack it.
pub struct OpenedZip {
    pub label: String,
    pub files: Vec<ZipFile>,
    archive: zip::ZipArchive<Box<dyn ReadSeek>>,
}

/// Where an archive comes from: a file on disk or the bytes themselves.
pub enum Source<'a> {
    File(&'a Path),
    Bytes(Vec<u8>),
}

impl OpenedZip {
    /// Open a foreign archive with every claim in it checked first.
    pub fn open(source: Source, label: Option<&str>, limits: Option<Limits>) -> Result<OpenedZip, String> {
        let lim = limits.unwrap_or(LIMITS);
        let name = match (label, &source) {
            (Some(l), _) if !l.is_empty() => l.to_string(),
            (_, Source::File(p)) => p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            _ => t("архив", &[]),
        };
        let too_big = || t("{0}: архив слишком большой", &[json!(name)]);
        let damaged = || t("{0}: архив повреждён или не докачан", &[json!(name)]);
        let reader: Box<dyn ReadSeek> = match source {
            Source::File(p) => {
                let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
                if size > lim.archive_bytes {
                    return Err(too_big());
                }
                Box::new(std::io::BufReader::new(fs::File::open(p).map_err(|e| e.to_string())?))
            }
            Source::Bytes(b) => {
                if b.len() as u64 > lim.archive_bytes {
                    return Err(too_big());
                }
                Box::new(std::io::Cursor::new(b))
            }
        };
        let mut archive = zip::ZipArchive::new(reader).map_err(|_| damaged())?;
        if archive.len() > lim.entries {
            return Err(t("{0}: в архиве слишком много файлов", &[json!(name)]));
        }
        let mut total = 0u64;
        let mut files = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index).map_err(|_| damaged())?;
            let raw = String::from_utf8_lossy(entry.name_raw()).into_owned();
            if raw.ends_with('/') || raw.ends_with('\\') {
                continue;
            }
            let size = entry.size();
            let packed = entry.compressed_size();
            if size > lim.entry_bytes {
                return Err(t("{0}: файл в архиве слишком большой", &[json!(name)]));
            }
            total += size;
            if total > lim.total_bytes {
                return Err(t("{0}: архив распакуется в слишком большой объём", &[json!(name)]));
            }
            if size >= lim.ratio_floor && packed > 0 && size as f64 / packed as f64 > lim.ratio {
                return Err(t("{0}: архив сжат подозрительно плотно", &[json!(name)]));
            }
            let rel = entry.name().replace('\\', "/");
            if is_unsafe_name(&rel) {
                continue;
            }
            files.push(ZipFile { path: rel, size, index });
        }
        Ok(OpenedZip { label: name, files, archive })
    }

    /// One file's bytes: the inflate and the checksum both happen here.
    pub fn read(&mut self, file: &ZipFile) -> Result<Vec<u8>, String> {
        let damaged = || t("{0}: файл {1} в архиве повреждён", &[json!(self.label), json!(file.path)]);
        let mut entry = self.archive.by_index(file.index).map_err(|_| damaged())?;
        let mut out = Vec::with_capacity(file.size.min(64 * MB) as usize);
        entry.read_to_end(&mut out).map_err(|_| damaged())?;
        if out.len() as u64 != file.size {
            return Err(damaged());
        }
        Ok(out)
    }

    pub fn get(&self, rel: &str) -> Option<ZipFile> {
        let wanted = rel.replace('\\', "/");
        self.files.iter().find(|f| f.path == wanted).cloned()
    }

    /// Unpack everything under `dest_root`; with a change, the whole unpack is one change.
    pub fn extract_to(&mut self, dest_root: &Path, mut tx: Option<&mut FileTx>) -> Result<usize, String> {
        let files = self.files.clone();
        for file in &files {
            let dest = safe_join(dest_root, &file.path)?;
            let data = self.read(file)?;
            match tx.as_deref_mut() {
                Some(tx) => {
                    tx.write(&dest, &data).map_err(|e| e.to_string())?;
                }
                None => {
                    if let Some(d) = dest.parent() {
                        fs::create_dir_all(d).map_err(|e| e.to_string())?;
                    }
                    fs::write(&dest, &data).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(files.len())
    }

    /// What the test compares: each file's path, size and bytes.
    pub fn describe(&mut self) -> Result<Value, String> {
        let files = self.files.clone();
        let mut out = Vec::new();
        for f in &files {
            let data = self.read(f)?;
            out.push(json!({ "path": f.path, "size": f.size, "sha1": sha1_hex(&data) }));
        }
        Ok(json!({ "label": self.label, "files": out }))
    }
}

/// sha1 as lowercase hex, the hash src/overlays.ts records every write by.
pub fn sha1_hex(data: &[u8]) -> String {
    use sha1::Digest;
    sha1::Sha1::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// A zip of (name, bytes), stored with deflate: a cursor set handed back out of the app.
pub fn write_zip(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in entries {
        w.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut w, data).map_err(|e| e.to_string())?;
    }
    Ok(w.finish().map_err(|e| e.to_string())?.into_inner())
}
