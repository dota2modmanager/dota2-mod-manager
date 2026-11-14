//! The mirror chain (src/net-mirrors.ts): which hosts carry a copy of a GitHub file and how a URL
//! is written for each, which of them a file may come from, and how each host has been doing.
//! A host that keeps failing is stood down for a while.
//!
//! raw.githubusercontent.com is the host that is slow, throttled or unreachable for a good part
//! of the userbase, so each URL has mirrors of the same bytes, tried in order. The TypeScript
//! keeps the chain and the health in module globals; here they are one `Chain`, with the clock
//! handed in so a test can move it.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

pub const RAW_HOST: &str = "https://raw.githubusercontent.com/";
/// After this many failures a host is stood down, and for this long.
pub const FAIL_THRESHOLD: u32 = 3;
pub const COOLDOWN_MS: f64 = 120000.0;

/// The catalog's archives, which the hosts the signed config names copy whole.
const CATALOG_FILES: &str = "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/assets/files/";

/// Our own copy of the files the app cannot start without: the one mirror that does not share
/// GitHub's fate. Nothing else is on it.
const MIRRORED: &[(&str, &str)] = &[
    ("h6rd/Dota2PornFxWeb/main/assets/data/mods.json", "mods.json"),
    ("h6rd/Dota2PornFxWeb/main/assets/data/constants.json", "constants.json"),
    ("h6rd/Dota2PornFxWeb/main/assets/data/guides.json", "guides.json"),
    ("dota2modmanager/dota2-mod-manager/catalog-data/fingerprints.json", "fingerprints.json"),
    // where copies before 2.8.0 still ask for it
    ("dota2modmanager/dota2-mod-manager/main/fingerprints.json", "fingerprints.json"),
    ("dota2modmanager/dota2-mod-manager/main/config/app.json", "app.json"),
    ("dota2modmanager/dota2-mod-manager/main/config/app.json.sig", "app.json.sig"),
    ("dota2modmanager/dota2-mod-manager/main/config/presets.json", "presets.json"),
    ("dota2modmanager/dota2-mod-manager/main/config/presets.json.sig", "presets.json.sig"),
    ("h6rd/Dota2PornFxWeb/main/assets/signatures/mods.json.sig", "mods.json.sig"),
    ("h6rd/Dota2PornFxWeb/main/assets/signatures/constants.json.sig", "constants.json.sig"),
    ("h6rd/Dota2PornFxWeb/main/assets/signatures/guides.json.sig", "guides.json.sig"),
    ("h6rd/Dota2PornFxWeb/main/assets/data/mod-hashes.json", "mod-hashes.json"),
    ("h6rd/Dota2PornFxWeb/main/assets/signatures/mod-hashes.json.sig", "mod-hashes.json.sig"),
];

/// How a mirror writes a GitHub raw URL.
#[derive(Debug, Clone, PartialEq)]
pub enum Map {
    /// the URL as it is: the origin
    Same,
    /// `https://<host>/<url>`: a plain proxy
    Proxy,
    /// jsDelivr's `/gh/owner/repo@branch/path`
    JsDelivr,
    /// our site's copy of the few files in `MIRRORED`
    OurSite,
    /// a host the signed config names: the catalog's archives under its base
    Base(String),
    /// a test's server: the raw host in the URL replaced by `<base>`
    Prefix(String),
}

/// A host that fetches GitHub for us, and how a URL is written for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Mirror {
    pub host: String,
    pub map: Map,
    /// the catalog's own host; exactly one entry carries it
    pub origin: bool,
    /// caps file size, so it serves the small JSON and never an archive
    pub small_only: bool,
    /// the folder of the catalog's preview pictures, on a host that keeps the whole catalog
    pub pictures: Option<String>,
}

impl Mirror {
    fn new(host: &str, map: Map) -> Mirror {
        Mirror { host: host.into(), map, origin: false, small_only: false, pictures: None }
    }

    fn write(&self, url: &str) -> Option<String> {
        match &self.map {
            Map::Same => Some(url.to_string()),
            Map::Proxy => Some(format!("https://{}/{url}", self.host)),
            Map::JsDelivr => {
                static RE: OnceLock<Regex> = OnceLock::new();
                let re = RE.get_or_init(|| Regex::new(r"^([^/]+)/([^/]+)/([^/]+)/(.+)$").unwrap());
                let rest = url.get(RAW_HOST.len()..)?;
                let m = re.captures(rest)?;
                Some(format!("https://cdn.jsdelivr.net/gh/{}/{}@{}/{}", &m[1], &m[2], &m[3], &m[4]))
            }
            Map::OurSite => {
                let rest = url.strip_prefix(RAW_HOST)?;
                MIRRORED
                    .iter()
                    .find(|(k, _)| *k == rest)
                    .map(|(_, n)| format!("https://dota2modmanager.com/mirror/{n}"))
            }
            Map::Base(base) => url.strip_prefix(CATALOG_FILES).map(|rest| format!("{base}{rest}")),
            Map::Prefix(base) => Some(url.replacen(RAW_HOST, base, 1)),
        }
    }
}

/// The chain as the app ships it.
pub fn default_mirrors() -> Vec<Mirror> {
    let mut origin = Mirror::new("raw.githubusercontent.com", Map::Same);
    origin.origin = true;
    let mut ours = Mirror::new("dota2modmanager.com", Map::OurSite);
    ours.small_only = true;
    let mut jsd = Mirror::new("cdn.jsdelivr.net", Map::JsDelivr);
    jsd.small_only = true;
    vec![
        origin,
        ours,
        jsd,
        Mirror::new("ghproxy.net", Map::Proxy),
        Mirror::new("gh-proxy.com", Map::Proxy),
        Mirror::new("ghfast.top", Map::Proxy),
    ]
}

/// One URL worth trying for a file, and the mirror it came from.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Entry {
    pub url: String,
    pub host: String,
    pub origin: bool,
}

#[derive(Debug, Clone, Default)]
struct Health {
    fails: u32,
    until: f64,
    why: Option<String>,
}

/// `new URL(url).host`, or the text itself when it is not a URL.
pub fn host_of(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(u) if u.has_host() => match (u.host_str(), u.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_string(),
            _ => url.to_string(),
        },
        Ok(_) => String::new(),
        Err(_) => url.to_string(),
    }
}

/// Whether a host the signed config names is one this app will ask: an https folder address with
/// no login and no query, on exactly the host it claims, and never the origin.
pub fn well_formed_mirror(m: &Value) -> bool {
    let (Some(base), Some(host)) = (m.get("base").and_then(Value::as_str), m.get("host").and_then(Value::as_str))
    else {
        return false;
    };
    static HOST: OnceLock<Regex> = OnceLock::new();
    if !HOST.get_or_init(|| Regex::new(r"^[a-zA-Z0-9.-]+(:[0-9]+)?$").unwrap()).is_match(host)
        || host == "raw.githubusercontent.com"
    {
        return false;
    }
    let Ok(u) = url::Url::parse(base) else { return false };
    u.scheme() == "https"
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none_or(str::is_empty)
        && u.fragment().is_none_or(str::is_empty)
        && host_of(base) == host.to_lowercase()
        && u.path().ends_with('/')
}

/// The chain and how each host has been doing.
pub struct Chain {
    mirrors: Vec<Mirror>,
    health: HashMap<String, Health>,
    /// the order hosts were first noted in, as the TypeScript's Map keeps it
    order: Vec<String>,
}

impl Default for Chain {
    fn default() -> Self {
        Chain { mirrors: default_mirrors(), health: HashMap::new(), order: vec![] }
    }
}

impl Chain {
    pub fn mirrors(&self) -> &[Mirror] {
        &self.mirrors
    }

    pub fn stood_down(&self, host: &str, now: f64) -> bool {
        self.health.get(host).is_some_and(|h| h.until > now)
    }

    fn entry(&mut self, host: &str) -> &mut Health {
        if !self.health.contains_key(host) {
            self.order.push(host.to_string());
        }
        self.health.entry(host.to_string()).or_default()
    }

    pub fn note_failure(&mut self, host: &str, why: &str, now: f64) {
        let h = self.entry(host);
        h.fails += 1;
        if h.fails >= FAIL_THRESHOLD {
            h.until = now + COOLDOWN_MS;
            h.fails = 0;
        }
        h.why = Some(why.to_string());
    }

    /// A host that took a whole timeout to say nothing is blocked rather than unlucky.
    pub fn note_stall(&mut self, host: &str, why: &str, now: f64) {
        *self.entry(host) = Health { fails: 0, until: now + COOLDOWN_MS, why: Some(why.to_string()) };
    }

    pub fn note_success(&mut self, host: &str) {
        self.health.remove(host);
        self.order.retain(|h| h != host);
    }

    /// Every URL worth trying for this one, best first. A URL off GitHub raw (and not a release
    /// asset) is only itself; `trusted_only` is the URL alone, never a mirror and never the origin.
    pub fn entries_for(&self, url: &str, small: bool, trusted_only: bool) -> Vec<Entry> {
        static RELEASE: OnceLock<Regex> = OnceLock::new();
        let release = RELEASE
            .get_or_init(|| Regex::new(r"^https://github\.com/[\w.-]+/[\w.-]+/releases/download/").unwrap())
            .is_match(url);
        let raw = url.starts_with(RAW_HOST);
        if trusted_only || (!raw && !release) {
            return vec![Entry { url: url.into(), host: host_of(url), origin: false }];
        }
        let mut out = Vec::new();
        for m in &self.mirrors {
            if m.small_only && (!small || release) {
                continue;
            }
            let mapped =
                if release && m.host == "raw.githubusercontent.com" { Some(url.to_string()) } else { m.write(url) };
            if let Some(u) = mapped {
                out.push(Entry { url: u, host: m.host.clone(), origin: m.origin });
            }
        }
        out
    }

    pub fn mirrors_for(&self, url: &str, small: bool, trusted_only: bool) -> Vec<String> {
        self.entries_for(url, small, trusted_only).into_iter().map(|e| e.url).collect()
    }

    /// The order to try them in right now: rested hosts first, or all of them when none is.
    pub fn live_order(&self, entries: Vec<Entry>, now: f64) -> Vec<Entry> {
        let ready: Vec<Entry> = entries.iter().filter(|e| !self.stood_down(&e.host, now)).cloned().collect();
        if ready.is_empty() {
            entries
        } else {
            ready
        }
    }

    /// For the diagnostics report: which hosts are standing down, and why.
    pub fn mirror_health(&self, now: f64) -> Vec<Value> {
        self.order
            .iter()
            .filter_map(|host| self.health.get(host).map(|h| (host, h)))
            .map(|(host, h)| {
                let mut o = json!({ "host": host, "fails": h.fails, "standingDownFor": crate::js::json_number((h.until - now).max(0.0)) });
                if let Some(w) = &h.why {
                    o["why"] = json!(w);
                }
                o
            })
            .collect()
    }

    pub fn reset_health(&mut self) {
        self.health.clear();
        self.order.clear();
    }

    /// Point the chain at another list (a test's servers); None puts the shipped one back.
    pub fn set_mirrors(&mut self, list: Option<Vec<Mirror>>) {
        self.mirrors = list.unwrap_or_else(default_mirrors);
        self.reset_health();
    }

    /// The picture folders on hosts the signed config names.
    pub fn picture_bases(&self) -> Vec<String> {
        self.mirrors.iter().filter_map(|m| m.pictures.clone()).collect()
    }

    /// The hosts the signed config names, put after our own site and before the proxies; none of
    /// them is ever the origin. The length of the chain now.
    pub fn apply_mirrors(&mut self, list: &Value) -> usize {
        let extra: Vec<Mirror> = list
            .as_array()
            .map(|a| a.iter().filter(|m| well_formed_mirror(m)).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .map(|m| {
                let base = m["base"].as_str().unwrap_or("").to_string();
                let host = m["host"].as_str().unwrap_or("").to_string();
                let mut mirror = Mirror::new(&host, Map::Base(base.clone()));
                // these hosts copy the catalog's folders whole, so the pictures sit beside the archives
                if base.ends_with("/assets/files/") {
                    mirror.pictures = Some(format!("{}previews/", &base[..base.len() - "files/".len()]));
                }
                mirror
            })
            .collect();
        if extra.is_empty() {
            self.set_mirrors(None);
            return self.mirrors.len();
        }
        let mut next = default_mirrors();
        let at = next.iter().position(|m| m.host == "dota2modmanager.com").map_or(0, |i| i + 1);
        next.splice(at..at, extra);
        self.set_mirrors(Some(next));
        self.mirrors.len()
    }
}
