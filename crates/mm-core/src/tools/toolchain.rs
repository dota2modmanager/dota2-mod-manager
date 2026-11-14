//! Tools the app can borrow, fetched only when something needs them (src/toolchain.ts,
//! src/toolchain-bucket.ts).
//!
//! Reading a Dota item icon or a mod's own texture means decoding Source 2 formats, and the
//! program that does that weighs fifty megabytes, so it is downloaded on demand into the app's
//! own folder and can be deleted from Settings. Nothing runs that was not pinned: every tool is
//! fetched at a version, from a URL of its own project's releases, with a SHA-256 that has to
//! match. Nothing proprietary: Valve's vpk.exe is not here and must not be added. The pins ship
//! with the release.
//!
//! The download itself is the caller's (`Get`): the shell hands it the network's download over
//! the mirror chain (net_fetch.rs `download_file`), off the main thread.

use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::i18n::t;

/// A tool pinned to a version, a URL, and the digest those bytes have to hash to.
#[derive(Debug, Clone, PartialEq)]
pub struct Pin {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub exe: String,
    pub license: String,
    pub project: String,
}

const VRF_VERSION: &str = "20.1";
const VRF_RELEASE: &str = "https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.1";
const VRF_PROJECT: &str = "https://github.com/ValveResourceFormat/ValveResourceFormat";

/// Every tool the app knows how to fetch.
pub const TOOL_NAMES: &[&str] = &["vrf"];

/// Every tool's pins, by build (`host_build`'s shape): one per build of each tool, and a machine
/// with no build of its own here gets no tool rather than another's.
pub fn built_in_pins() -> IndexMap<String, IndexMap<String, Pin>> {
    let vrf = |file: &str, sha256: &str, bytes: u64, exe: &str| Pin {
        version: VRF_VERSION.into(),
        url: format!("{VRF_RELEASE}/{file}"),
        sha256: sha256.into(),
        bytes,
        exe: exe.into(),
        license: "MIT".into(),
        project: VRF_PROJECT.into(),
    };
    let mut builds = IndexMap::new();
    builds.insert(
        "win32-x64".to_string(),
        vrf(
            "cli-windows-x64.zip",
            "67aaf8a67a85ca60fd09ff343e62103a4cdf3a2d177fc656231d7d734c5b3aa3",
            52773073,
            "Source2Viewer-CLI.exe",
        ),
    );
    builds.insert(
        "linux-x64".to_string(),
        vrf(
            "cli-linux-x64.zip",
            "29d25a6d6b62377fc5386c3e5145b0a2180a401a50041afe9494b3f503deaef5",
            53094205,
            "Source2Viewer-CLI",
        ),
    );
    let mut all = IndexMap::new();
    all.insert("vrf".to_string(), builds);
    all
}

/// The build of a tool this machine runs: platform and processor, as Node names them.
pub fn host_build() -> String {
    let os = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    format!("{os}-{arch}")
}

/// Whose releases a pin may point at: the owner is what makes a pin mean anything. Two, because
/// Source 2 Viewer moved from SteamDatabase to its own organisation.
fn pin_repos(name: &str) -> &'static [&'static str] {
    match name {
        "vrf" => &["ValveResourceFormat/ValveResourceFormat", "SteamDatabase/ValveResourceFormat"],
        _ => &[],
    }
}

/// Whether a pin names a version, an executable, a digest, and a release of an owner listed above.
pub fn valid_pin(pin: &Value, name: Option<&str>) -> bool {
    let repos = name.map(pin_repos).unwrap_or(&[]);
    let Some(p) = pin.as_object().filter(|_| !repos.is_empty()) else { return false };
    let s = |k: &str| p.get(k).and_then(Value::as_str);
    let from = |url: &str| {
        let url = url.to_lowercase();
        repos.iter().any(|r| url.starts_with(&format!("https://github.com/{}/releases/download/", r.to_lowercase())))
    };
    s("version").is_some_and(|v| !v.is_empty())
        && s("exe").is_some_and(|e| !e.is_empty() && !e.contains('/') && !e.contains('\\'))
        && s("sha256").is_some_and(|h| h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit()))
        && s("url").is_some_and(from)
}

/// The bucket's folder of pinned archives: a copy that does not go down with GitHub.
pub const FALLBACK_BASE: &str = "https://cdn.dota2modmanager.com/tools/";

/// Where to ask for a pinned archive, in order: the bucket first while GitHub is known to be down.
pub fn download_order(release: &str, spare: &str, github_down: bool) -> (String, String) {
    if github_down {
        (spare.into(), release.into())
    } else {
        (release.into(), spare.into())
    }
}

/// The name of a pinned archive in the bucket. The version goes in, and the build off Windows.
pub fn fallback_name(name: &str, version: &str, build: &str) -> String {
    if build == "win32-x64" {
        format!("{name}-{version}.zip")
    } else {
        format!("{name}-{version}-{build}.zip")
    }
}

/// A file brought down: (url, dest, expected sha256, bytes so far and total) to (bytes, sha256).
/// An error is the download's message, a wrong digest among them.
pub type Get<'a> = &'a mut dyn FnMut(&str, &Path, &str, &mut dyn FnMut(u64, u64)) -> Result<(u64, String), String>;

/// How a download is going, for the bar at the bottom of the window ({type, label, ...}).
pub type Progress<'a> = &'a mut dyn FnMut(Value);

/// The tools in userData: what is there, fetching one at its pin, and deleting it again.
pub struct Toolchain {
    pub root: PathBuf,
    /// the build to fetch and to accept on disk; tests name one, the app runs its own
    pub build: String,
    pub pins: IndexMap<String, IndexMap<String, Pin>>,
    pub journal_dir: Option<PathBuf>,
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

impl Toolchain {
    pub fn new(user_data_dir: &Path, build: Option<&str>) -> Self {
        Toolchain {
            root: user_data_dir.join("toolchain"),
            build: build.map(str::to_string).unwrap_or_else(host_build),
            pins: built_in_pins(),
            journal_dir: None,
        }
    }

    /// A tool's pin for this build, or None when the build has none.
    pub fn pin_for(&self, name: &str) -> Option<&Pin> {
        self.pins.get(name)?.get(&self.build)
    }

    fn dir_for(&self, name: &str, version: &str) -> PathBuf {
        self.root.join(name).join(version)
    }

    fn state_file(&self) -> PathBuf {
        self.root.join("installed.json")
    }

    /// What installed.json records. `build` is missing from every record written before there
    /// was more than one build, and those are all the Windows one.
    fn installed(&self) -> Map<String, Value> {
        std::fs::read_to_string(self.state_file())
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    }

    fn remember(&self, name: &str, entry: Option<Value>) -> Result<(), String> {
        let mut all = self.installed();
        match entry {
            Some(e) => {
                all.insert(name.into(), e);
            }
            None => {
                all.shift_remove(name);
            }
        }
        std::fs::create_dir_all(&self.root).map_err(io)?;
        std::fs::write(self.state_file(), crate::js::stringify(&Value::Object(all), "  ")).map_err(io)
    }

    fn entry_str(entry: &Value, key: &str) -> Option<String> {
        entry.get(key).filter(|v| !v.is_null()).map(crate::js::string)
    }

    fn entry_build(entry: &Value) -> String {
        entry.get("build").and_then(Value::as_str).filter(|b| !b.is_empty()).unwrap_or("win32-x64").to_string()
    }

    /// Where this tool's executable sits now, or None if it is not downloaded. A build for another
    /// machine counts as not downloaded: it is on disk, and it cannot run here.
    pub fn path_of(&self, name: &str) -> Option<PathBuf> {
        let all = self.installed();
        let entry = all.get(name).filter(|e| e.is_object())?;
        if Self::entry_build(entry) != self.build {
            return None;
        }
        let exe = self.dir_for(name, &Self::entry_str(entry, "version")?).join(Self::entry_str(entry, "exe")?);
        exe.exists().then_some(exe)
    }

    /// The tool here, downloaded if it is not: the path to run.
    pub fn ensure(
        &self,
        name: &str,
        get: Get,
        github_down: bool,
        progress: Progress,
        log: &mut dyn FnMut(String),
    ) -> Result<PathBuf, String> {
        if !TOOL_NAMES.contains(&name) {
            return Err(format!("unknown tool {name}"));
        }
        let pin = self
            .pin_for(name)
            .cloned()
            .ok_or_else(|| t("Для этой системы ({0}) нет сборки {1}", &[json!(self.build), json!(name)]))?;
        let all = self.installed();
        if let Some(have) = all.get(name).filter(|e| e.is_object()) {
            let version = Self::entry_str(have, "version").unwrap_or_default();
            if version == pin.version {
                if let Some(exe) = self.path_of(name) {
                    return Ok(exe);
                }
                log(format!(
                    "toolchain: {name} {version} ({}) was recorded but cannot run here as {}, fetching again",
                    Self::entry_build(have),
                    self.build
                ));
            }
        }
        // whatever happens next, the bar hears how it ended: it hides only on done or error
        match self.fetch_and_unpack(name, &pin, get, github_down, progress, log) {
            Ok(exe) => {
                progress(json!({ "type": "done", "label": name }));
                Ok(exe)
            }
            Err(e) => {
                progress(json!({ "type": "error", "label": name, "message": e }));
                Err(e)
            }
        }
    }

    /// A tool on disk brought up to its pin: path_of takes whatever is there, so nothing else would.
    pub fn catch_up(
        &self,
        get: Get,
        github_down: bool,
        progress: Progress,
        log: &mut dyn FnMut(String),
    ) -> Result<(), String> {
        for name in TOOL_NAMES {
            let all = self.installed();
            let have = all.get(*name).filter(|e| e.is_object());
            let (Some(have), Some(pin)) = (have, self.pin_for(name)) else { continue };
            if Self::entry_str(have, "version").as_deref() != Some(pin.version.as_str()) {
                self.ensure(name, get, github_down, progress, log)?;
            }
        }
        Ok(())
    }

    fn fetch_and_unpack(
        &self,
        name: &str,
        pin: &Pin,
        get: Get,
        github_down: bool,
        progress: Progress,
        log: &mut dyn FnMut(String),
    ) -> Result<PathBuf, String> {
        let dest = self.root.join(format!("{name}-{}.zip", pin.version));
        progress(json!({ "type": "stage", "label": name, "stage": "download" }));
        let spare = format!("{FALLBACK_BASE}{}", fallback_name(name, &pin.version, &self.build));
        let (first, second) = download_order(&pin.url, &spare, github_down);
        let mut on_bytes = |loaded: u64, total: u64| {
            progress(json!({ "type": "download", "label": name, "loaded": loaded, "total": total }))
        };
        let got = match get(&first, &dest, &pin.sha256, &mut on_bytes) {
            Ok(g) => g,
            Err(err) => {
                // every mirror is GitHub wearing another hostname: the bucket is the one copy
                // that does not share its fate
                log(format!("toolchain: {name} not available from {first} ({err}), trying {second}"));
                match get(&second, &dest, &pin.sha256, &mut on_bytes) {
                    Ok(g) => g,
                    Err(spare_err) => {
                        // the first error is the one worth having: a wrong digest from the release
                        // says more than a 404 from the copy asked afterwards
                        log(format!("toolchain: {name} not available from the copy either ({spare_err})"));
                        return Err(err);
                    }
                }
            }
        };
        log(format!(
            "toolchain: {name} {} downloaded, {} MB",
            pin.version,
            crate::js::to_fixed(got.0 as f64 / 1048576.0, 1)
        ));
        // unpacked as one change, by safe_zip, so a hostile archive cannot write outside the folder
        let into = self.dir_for(name, &pin.version);
        let _ = std::fs::remove_dir_all(&into);
        let mut archive = crate::safe_zip::OpenedZip::open(crate::safe_zip::Source::File(&dest), Some(name), None)?;
        crate::file_tx::FileTx::run(self.journal_dir.as_deref(), Box::new(|_| {}), |tx| {
            archive.extract_to(&into, Some(tx))
        })?;
        let _ = std::fs::remove_file(&dest);
        let exe = into.join(&pin.exe);
        if !exe.exists() {
            let _ = std::fs::remove_dir_all(&into);
            return Err(format!("{} is not in the {name} archive", pin.exe));
        }
        // the archive marks it executable, and the unzip keeps contents, not modes
        #[cfg(unix)]
        if !self.build.starts_with("win32") {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).map_err(io)?;
        }
        self.remember(
            name,
            Some(json!({
                "version": pin.version, "exe": pin.exe, "sha256": got.1,
                "at": crate::js::json_number(crate::library::now()), "build": self.build,
            })),
        )?;
        // an older version of the same tool is dead weight once this one works
        if let Ok(rd) = std::fs::read_dir(self.root.join(name)) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy() != pin.version {
                    let p = e.path();
                    let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
                }
            }
        }
        Ok(exe)
    }

    /// What is on disk, for Settings and for the diagnostics report.
    pub fn state(&self) -> Value {
        let have = self.installed();
        json!(TOOL_NAMES
            .iter()
            .map(|name| {
                let entry = have.get(*name).filter(|e| e.is_object());
                let version = entry.and_then(|e| Self::entry_str(e, "version"));
                let mut bytes = 0u64;
                if let Some(v) = &version {
                    if let Ok(rd) = std::fs::read_dir(self.dir_for(name, v)) {
                        for e in rd.flatten() {
                            bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
                        }
                    }
                }
                let pin = self.pin_for(name);
                json!({
                    "name": name,
                    "version": version,
                    "latest": pin.map(|p| p.version.clone()),
                    "installedBytes": bytes,
                    "downloadBytes": pin.map_or(0, |p| p.bytes),
                    "license": pin.map(|p| p.license.clone()),
                    "project": pin.map(|p| p.project.clone()),
                    "available": pin.is_some(),
                    "ready": self.path_of(name).is_some(),
                })
            })
            .collect::<Vec<_>>())
    }

    /// The tool deleted, with its record.
    pub fn remove(&self, name: &str) -> Result<(), String> {
        let _ = std::fs::remove_dir_all(self.root.join(name));
        self.remember(name, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(exe: &str) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file(exe, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"MZ").unwrap();
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn the_bucket_is_asked_when_the_release_fails_and_the_first_error_is_kept() {
        let dir = std::env::temp_dir().join(format!("mm-tc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut tc = Toolchain::new(&dir, Some("win32-x64"));
        let data = zip_of("Source2Viewer-CLI.exe");
        let sha: String = <sha2::Sha256 as sha2::Digest>::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
        tc.pins.get_mut("vrf").unwrap().get_mut("win32-x64").unwrap().sha256 = sha.clone();
        let (mut asked, mut log) = (Vec::new(), Vec::new());
        // the release is down, the bucket answers
        let mut get = |url: &str, dest: &Path, _: &str, _: &mut dyn FnMut(u64, u64)| {
            asked.push(url.to_string());
            if url.starts_with(FALLBACK_BASE) {
                std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
                std::fs::write(dest, &data).unwrap();
                Ok((data.len() as u64, sha.clone()))
            } else {
                Err("checksum mismatch for vrf-20.1.zip".to_string())
            }
        };
        let exe = tc.ensure("vrf", &mut get, false, &mut |_| {}, &mut |m| log.push(m)).unwrap();
        assert!(exe.ends_with("toolchain/vrf/20.1/Source2Viewer-CLI.exe"));
        assert_eq!(asked, [tc.pins["vrf"]["win32-x64"].url.clone(), format!("{FALLBACK_BASE}vrf-20.1.zip")]);
        assert!(log[0].contains("trying https://cdn."), "{log:?}");
        // GitHub known to be down: the bucket first; both failing, the first error is the answer
        tc.remove("vrf").unwrap();
        let mut asked = Vec::new();
        let mut fail = |url: &str, _: &Path, _: &str, _: &mut dyn FnMut(u64, u64)| {
            asked.push(url.to_string());
            Err(format!("no {}", asked.len()))
        };
        let e = tc.ensure("vrf", &mut fail, true, &mut |_| {}, &mut |_| {}).unwrap_err();
        assert_eq!(e, "no 1");
        assert!(asked[0].starts_with(FALLBACK_BASE));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
