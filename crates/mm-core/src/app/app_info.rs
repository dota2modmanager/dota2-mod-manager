//! What Home shows about the app itself: the release notes out of the changelogs the build
//! carries (src/release-notes.ts) and the project's star count on GitHub (src/repo-stars.ts).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use regex::Regex;
use serde_json::Value;

use crate::net_fetch::Net;
use crate::remote_config::cmp_version;

/// The section's text for `version` out of one changelog, or None when it has none. A heading is
/// "## <version>" and then anything that cannot continue a version, so 2.8.0 does not find
/// 2.8.0-beta.1 (release.yml and tools/release-state.js look sections up the same way).
pub fn changelog_section(text: &str, version: &str) -> Option<String> {
    // R: a line ends at \r as well as \n, and `.` crosses neither, as in JavaScript
    let head = Regex::new(&format!(r"(?mR)^## {}(?:[^-0-9A-Za-z.].*)?$", regex::escape(version))).ok()?;
    let m = head.find(text)?;
    let rest = &text[m.end()..];
    let next = Regex::new(r"(?mR)^## ").ok()?.find(rest).map_or(rest.len(), |n| n.start());
    let body = crate::js::trim(&rest[..next]);
    (!body.is_empty()).then(|| body.to_string())
}

/// The release versions a changelog has a heading for, betas left out.
pub fn changelog_versions(text: &str) -> Vec<String> {
    let re = Regex::new(r"(?mR)^## ([0-9]+\.[0-9]+\.[0-9]+)(?:[^-0-9A-Za-z.].*)?$").expect("a fixed pattern");
    re.captures_iter(text).map(|c| c[1].to_string()).collect()
}

/// The versions whose notes go with `version`: its line from x.y.0, and anything newer than
/// `seen`; the running version even when it is a beta; newest first.
pub fn notes_range(versions: &[String], version: &str, seen: Option<&str>) -> Vec<String> {
    let mut p = version.split('.');
    let (major, minor) = (p.next().unwrap_or(""), p.next().unwrap_or("undefined"));
    let line_start = format!("{major}.{minor}.0");
    let wanted = versions.iter().filter(|v| {
        cmp_version(v, version) <= 0
            && (cmp_version(v, &line_start) >= 0 || seen.is_some_and(|s| cmp_version(v, s) > 0))
    });
    let mut all: Vec<String> = Vec::new();
    let lead = (!versions.iter().any(|v| v == version)).then(|| version.to_string());
    for v in lead.into_iter().chain(wanted.cloned()) {
        if !all.contains(&v) {
            all.push(v);
        }
    }
    all.sort_by(|a, b| cmp_version(b, a).cmp(&0));
    all
}

/// The notes for `version` in the interface's language where there is a translation, with the
/// versions before it that go with it, each under "## <version>" when there are several; None
/// when this version has no section anywhere. `app_path` is where the build's files are.
pub fn release_notes(version: &str, lang: &str, app_path: &Path, seen: Option<&str>) -> Option<String> {
    let names: &[&str] = if lang == "ru" { &["CHANGELOG.ru.md", "CHANGELOG.md"] } else { &["CHANGELOG.md"] };
    let files: Vec<String> =
        names.iter().map(|n| std::fs::read_to_string(app_path.join(n)).unwrap_or_default()).collect();
    let section = |v: &str| files.iter().find_map(|t| changelog_section(t, v));
    section(version)?;
    let parts: Vec<(String, String)> =
        notes_range(&changelog_versions(files.last().map_or("", String::as_str)), version, seen)
            .into_iter()
            .filter_map(|v| section(&v).map(|b| (v, b)))
            .collect();
    Some(if parts.len() == 1 {
        parts[0].1.clone()
    } else {
        parts.iter().map(|(v, b)| format!("## {v}\n\n{b}")).collect::<Vec<_>>().join("\n\n")
    })
}

/// Where the star count is read: the repository's own record, which carries stargazers_count.
pub const STARS_API: &str = "https://api.github.com/repos/dota2modmanager/dota2-mod-manager";
const STARS_FRESH_MS: f64 = 6.0 * 60.0 * 60.0 * 1000.0;
const STARS_TIMEOUT_MS: u64 = 8000;

type Clock = Box<dyn Fn() -> f64 + Send + Sync>;

fn whole(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && n.fract() == 0.0)
}

/// The star count for Home, kept in a small file and asked of GitHub again after six hours.
/// It never fails and never waits long: a count that cannot be had is the last one, or None.
pub struct RepoStars {
    cache_file: PathBuf,
    api: String,
    net: Arc<Net>,
    now: Clock,
    /// (stars, at); the lock is also what makes two asks at once into one
    cached: Mutex<Option<(f64, f64)>>,
}

impl RepoStars {
    pub fn new(cache_file: &Path, api: Option<&str>, net: Arc<Net>, now: Clock) -> RepoStars {
        let cached = std::fs::read_to_string(cache_file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|c| {
                let stars = whole(c.get("stars"))?;
                let at = c.get("at").and_then(Value::as_f64).filter(|a| a.is_finite())?;
                Some((stars, at))
            });
        RepoStars {
            cache_file: cache_file.into(),
            api: api.unwrap_or(STARS_API).into(),
            net,
            now,
            cached: Mutex::new(cached),
        }
    }

    /// The count: the kept one while it is fresh, otherwise asked for.
    pub fn get(&self) -> Option<f64> {
        let mut cached = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((stars, at)) = *cached {
            if (self.now)() - at < STARS_FRESH_MS {
                return Some(stars);
            }
        }
        let last = cached.map(|c| c.0);
        let headers = [("accept", "application/vnd.github+json")];
        let Ok((status, body)) = self.net.direct("GET", &self.api, &headers, None, STARS_TIMEOUT_MS) else {
            return last;
        };
        if !(200..300).contains(&status) {
            return last;
        }
        let Some(n) = serde_json::from_slice::<Value>(&body).ok().and_then(|v| whole(v.get("stargazers_count"))) else {
            return last;
        };
        let at = (self.now)();
        *cached = Some((n, at));
        let kept = serde_json::json!({ "stars": crate::js::json_number(n), "at": crate::js::json_number(at) });
        let _ = std::fs::write(&self.cache_file, crate::js::stringify(&kept, ""));
        Some(n)
    }
}
