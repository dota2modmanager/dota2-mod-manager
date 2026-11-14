//! Updating a copy that was never installed (src/portable-update.ts).
//!
//! A portable build has no installer to hand a download to, and an exe that rewrites and
//! relaunches itself is the shape antivirus heuristics look for. So the new version is put NEXT
//! TO the current exe and the user is told it is there. The download is checked against
//! portable.yml, which CI publishes beside the release with the binary's size and SHA-256; the
//! manifest and the binary always come from the same source, GitHub first with no mirrors in the
//! way, then this project's own bucket.

use crate::net_fetch::{DownloadOptions, FetchOptions, Net};
use std::path::{Path, PathBuf};

const REPO: &str = "dota2modmanager/dota2-mod-manager";
/// The release asset that names the portable binary, its size and its sha256.
pub const MANIFEST: &str = "portable.yml";
/// The project's own bucket, which holds the current release as well.
pub const MIRROR: &str = "https://cdn.dota2modmanager.com/updates/";

/// The download address of a file attached to a GitHub release of this app.
pub fn release_url(version: &str, file: &str) -> String {
    format!("https://github.com/{REPO}/releases/download/v{version}/{file}")
}

/// The address of a release's file: (version, file name).
pub type AssetUrl = Box<dyn Fn(&str, &str) -> String + Send + Sync>;

/// Where a portable build can come from: its manifest, the binary it names, and whether only
/// that host is trusted.
pub struct Source {
    pub name: String,
    pub manifest: Box<dyn Fn(&str) -> String + Send + Sync>,
    pub asset: AssetUrl,
    pub trusted_only: bool,
}

/// GitHub first and without mirrors, then the project's bucket.
pub fn sources() -> Vec<Source> {
    vec![
        Source {
            name: "github".into(),
            manifest: Box::new(|v| release_url(v, MANIFEST)),
            asset: Box::new(release_url),
            trusted_only: true,
        },
        Source {
            name: "mirror".into(),
            manifest: Box::new(|_| format!("{MIRROR}{MANIFEST}")),
            asset: Box::new(|_, f| format!("{MIRROR}{f}")),
            trusted_only: false,
        },
    ]
}

/// The fields the app needs out of portable.yml.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Manifest {
    pub file: String,
    pub size: f64,
    pub sha256: String,
    /// '' when the manifest does not say
    pub version: String,
}

/// `^name:\s*(.+)$` with the m flag, as the TypeScript reads it: trimmed and unquoted once at
/// either end. The blanks after the colon may run onto the next lines, and a run of blanks alone
/// still matches, as nothing.
fn field(text: &str, name: &str) -> String {
    let term = |c: char| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
    let mut start = 0;
    loop {
        if let Some(rest) = text[start..].strip_prefix(name).and_then(|r| r.strip_prefix(':')) {
            let blanks = rest.len() - rest.trim_start_matches(crate::js::is_space).len();
            let after = &rest[blanks..];
            let value = &after[..after.find(term).unwrap_or(after.len())];
            if !value.is_empty() {
                return unquote(crate::js::trim(value));
            }
            // .+ backs into the blanks: any that is not a line end makes a match of blanks
            if rest[..blanks].chars().any(|c| !term(c)) {
                return String::new();
            }
        }
        match text[start..].find(term) {
            Some(i) => start += i + text[start + i..].chars().next().map_or(1, char::len_utf8),
            None => return String::new(),
        }
    }
}

/// `.replace(/^['"]|['"]$/g, '')`
fn unquote(v: &str) -> String {
    let v = v.strip_prefix(['\'', '"']).unwrap_or(v);
    v.strip_suffix(['\'', '"']).unwrap_or(v).to_string()
}

/// portable.yml's file, size, sha256 and version, without a YAML parser for a file this project
/// writes itself. Anything missing or malformed is a manifest refused.
pub fn parse_manifest(text: &str) -> Result<Manifest, String> {
    let file = field(text, "file");
    let size_text = field(text, "size");
    let size = crate::js::to_number(&serde_json::Value::String(size_text));
    let sha256 = field(text, "sha256").to_lowercase();
    let version = field(text, "version");
    // /^[A-Za-z0-9._-]+\.exe$/: a name in the release, never a path
    let name_ok = file.len() > 4
        && file.ends_with(".exe")
        && file.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    if !name_ok {
        return Err("portable.yml: bad file name".into());
    }
    if !size.is_finite() || size <= 0.0 {
        return Err("portable.yml: bad size".into());
    }
    if !(sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())) {
        return Err("portable.yml: bad sha256".into());
    }
    Ok(Manifest { file, size, sha256, version })
}

/// The folder beside a portable exe that holds its settings, library and cache.
pub const DATA_DIR: &str = "Dota 2 Mod Manager Data";
/// What the Tauri installer leaves beside the exe it installs.
pub const UNINSTALLER: &str = "uninstall.exe";

static PORTABLE: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

/// Whether the exe at `exe` is a portable copy, and if so the folder it lives in.
///
/// The Tauri build ships one exe twice: inside the installer, and bare as the portable build.
/// An installed copy always has the installer's uninstall.exe beside it; a bare one does not.
/// (Electron's portable build unpacked itself into a temp folder and named the real one in
/// PORTABLE_EXECUTABLE_DIR; the Tauri exe runs where it lies.)
pub fn portable_dir_of(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    (!dir.join(UNINSTALLER).exists()).then(|| dir.to_path_buf())
}

/// Called once by the shell at start: this run's answer to [`portable_dir`].
pub fn set_portable_dir(dir: Option<PathBuf>) {
    let _ = PORTABLE.set(dir);
}

/// Where the running portable exe lives, or None when this is not a portable copy.
pub fn portable_dir() -> Option<PathBuf> {
    PORTABLE.get().cloned().flatten()
}

/// The data folder beside a portable exe, made and writable; None when the folder is read-only
/// (the exe dropped into Program Files), so the ordinary location is used instead (src/main.ts).
pub fn data_beside(dir: &Path) -> Option<PathBuf> {
    let beside = dir.join(DATA_DIR);
    std::fs::create_dir_all(&beside).ok()?;
    let probe = beside.join(".write-probe");
    std::fs::write(&probe, b"").ok()?;
    let _ = std::fs::remove_file(&probe);
    Some(beside)
}

/// Where the new build landed.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Fetched {
    pub path: PathBuf,
    pub name: String,
    pub bytes: f64,
    /// the same build was fetched before
    #[serde(skip_serializing_if = "Option::is_none")]
    pub already: Option<bool>,
}

fn semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Fetch `version` (no leading v) and leave it beside the current one in `dir`.
pub fn fetch_beside(
    net: &Net,
    version: &str,
    dir: Option<&Path>,
    sources: &[Source],
    on_progress: &mut dyn FnMut(u64, u64),
    log: &mut dyn FnMut(&str),
) -> Result<Fetched, String> {
    let dir = dir.ok_or("not a portable copy")?;
    if !semver(version) {
        return Err(format!("bad version {version}"));
    }
    let mut last: Option<String> = None;
    for source in sources {
        let text = net.fetch_text(
            &(source.manifest)(version),
            FetchOptions { trusted_only: source.trusted_only, ..Default::default() },
        );
        let manifest = match text.map_err(|e| e.message).and_then(|t| parse_manifest(&t)) {
            Ok(m) => m,
            Err(e) => {
                log(&format!("portable update: no manifest from {} ({e})", source.name));
                last = Some(e);
                continue;
            }
        };
        // the mirror holds one release, so it can be a version behind what the check found
        if !manifest.version.is_empty() && manifest.version != version {
            let e = format!("{} has {}, not {version}", source.name, manifest.version);
            log(&format!("portable update: {e}"));
            last = Some(e);
            continue;
        }
        // named with its version, so a folder holds the old and the new side by side
        let stem = &manifest.file[..manifest.file.len() - 4];
        let name = format!("{stem}-{version}.exe");
        let dest = dir.join(&name);
        if std::fs::metadata(&dest).is_ok_and(|m| m.is_file() && m.len() as f64 == manifest.size) {
            return Ok(Fetched { path: dest, name, bytes: manifest.size, already: Some(true) });
        }
        let got = net.download_file(
            &(source.asset)(version, &manifest.file),
            &dest,
            DownloadOptions {
                on_progress: Some(&mut *on_progress),
                expect_sha256: Some(manifest.sha256.clone()),
                log: Some(&mut *log),
                ..Default::default()
            },
        );
        match got {
            Ok(g) => return Ok(Fetched { path: g.path, name, bytes: g.bytes as f64, already: None }),
            Err(e) => {
                log(&format!("portable update: {} could not hand over the build ({})", source.name, e.message));
                last = Some(e.message);
            }
        }
    }
    Err(last.unwrap_or_else(|| "no source had this version".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_exe_is_portable_and_an_installed_one_is_not() {
        let dir = std::env::temp_dir().join(format!("mm-portable-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Dota 2 Mod Manager.exe");
        assert_eq!(portable_dir_of(&exe), Some(dir.clone()));
        let data = data_beside(&dir).unwrap();
        assert_eq!(data, dir.join(DATA_DIR));
        assert!(data.is_dir());
        std::fs::write(dir.join(UNINSTALLER), b"").unwrap();
        assert_eq!(portable_dir_of(&exe), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_manifest_is_read_and_a_bad_one_refused() {
        let sha = "a".repeat(64);
        let m = parse_manifest(&format!(
            "version: 2.7.0\nfile: 'D2MM-Portable.exe'\nsize: 12\nsha256: {}\n",
            sha.to_uppercase()
        ))
        .unwrap();
        assert_eq!(
            (m.file.as_str(), m.size, m.sha256.as_str(), m.version.as_str()),
            ("D2MM-Portable.exe", 12.0, sha.as_str(), "2.7.0")
        );
        assert!(parse_manifest(&format!("file: ../x.exe\nsize: 1\nsha256: {sha}")).is_err());
        assert!(parse_manifest(&format!("file: x.exe\nsize: 0\nsha256: {sha}")).is_err());
        assert!(parse_manifest("file: x.exe\nsize: 1\nsha256: abc").is_err());
        assert_eq!(
            release_url("2.7.0", "a.exe"),
            "https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v2.7.0/a.exe"
        );
    }
}
