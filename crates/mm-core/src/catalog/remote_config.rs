//! The one thing the app can be told after it has shipped (src/remote-config.ts and its format,
//! src/remote-config-format.ts): a small signed file on main that can switch a feature off with a
//! reason, put a dated notice in front of people, name the beta's testers, add hosts to the
//! mirror chain and mark catalog mods that misbehave.
//!
//! Everything is default-safe: no file, no network, malformed JSON, a field of the wrong type, a
//! bad signature all leave the app exactly as it is with everything on and nothing to say. A
//! remote switch that fails open is a feature; one that fails closed is an outage.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::js::{slice_utf16, trim};
use crate::net_fetch::{FetchOptions, Net};

/// The time in milliseconds, handed in so a test can set the day.
pub type Clock = Box<dyn Fn() -> f64 + Send + Sync>;

pub const CONFIG_URL: &str = "https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/config/app.json";
/// Ours, not the catalog author's: tools/sign-catalog.js signs the config and the ready presets.
pub const CONFIG_PUBLIC_KEY: &str = "MCowBQYDK2VwAyEA8M9IOVLfxK6V1n2fHAHlE9zzCsXFoUAJki8RdqLPBdA=";

/// What the app is willing to be told to switch off; any other name is ignored.
pub const SWITCHABLE: [&str; 3] = ["install", "cosmetics", "voice"];
/// The first version that reads `blocks`.
pub const BLOCKS_SINCE: &str = "2.6.13";
const MAX_NOTICES: usize = 20;
pub const MAX_TESTERS: usize = 100;
pub const MAX_MIRRORS: usize = 4;
const RAW_MIRROR_HOST: &str = "raw.githubusercontent.com";
const MAX_TEXT: usize = 500;
const MAX_ISSUES: usize = 100;

/// An object, or an array read as one (JavaScript's `typeof` says object for both, and an
/// array has none of the keys asked for here).
fn obj(v: &Value) -> Option<Map<String, Value>> {
    match v {
        Value::Object(o) => Some(o.clone()),
        Value::Array(_) => Some(Map::new()),
        _ => None,
    }
}

fn str_of(v: Option<&Value>, max: usize) -> String {
    match v {
        Some(Value::String(s)) => slice_utf16(s, max),
        _ => String::new(),
    }
}

fn opt(s: String) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        Value::String(s)
    }
}

/// `parseInt(n, 10) || 0`: leading space, a sign, the digits that start it.
fn parse_int(s: &str) -> f64 {
    let t = trim(s);
    let (neg, rest) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let n: f64 = digits.parse().unwrap_or(0.0);
    if neg {
        -n
    } else {
        n
    }
}

fn parts(v: &str) -> Vec<f64> {
    v.split('.').map(parse_int).collect()
}

/// Two versions compared part by part as numbers, so 10.0.0 comes after 2.0.0.
pub fn cmp_version(a: &str, b: &str) -> i32 {
    let (x, y) = (parts(a), parts(b));
    for i in 0..3 {
        let (p, q) = (x.get(i).copied().unwrap_or(0.0), y.get(i).copied().unwrap_or(0.0));
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    0
}

fn field<'a>(e: &'a Value, k: &str) -> Option<&'a str> {
    e.get(k).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// Does an entry with optional version bounds and a last day hold for this build today?
pub fn applies(entry: &Value, version: &str, today: &str) -> bool {
    field(entry, "minVersion").is_none_or(|m| cmp_version(version, m) >= 0)
        && field(entry, "maxVersion").is_none_or(|m| cmp_version(version, m) <= 0)
        && field(entry, "until").is_none_or(|u| today <= u)
}

/// A real `YYYY-MM-DD`, as Date.parse takes it (any day up to 31 in any month), or null.
fn valid_day(v: Option<&Value>) -> Value {
    static DAY: OnceLock<Regex> = OnceLock::new();
    let re = DAY.get_or_init(|| Regex::new(r"^[0-9]{4}-([0-9]{2})-([0-9]{2})$").unwrap());
    let Some(s) = v.and_then(Value::as_str) else { return Value::Null };
    match re.captures(s) {
        Some(c)
            if (1..=12).contains(&c[1].parse::<u32>().unwrap_or(0))
                && (1..=31).contains(&c[2].parse::<u32>().unwrap_or(0)) =>
        {
            json!(s)
        }
        _ => Value::Null,
    }
}

/// The fetched JSON cut down to what this build can act on: anything malformed, too long or
/// aimed at a feature that cannot be switched is dropped rather than trusted.
pub fn normalize(raw: &Value) -> Value {
    let mut features = Map::new();
    let (mut notices, mut blocks, mut mirrors, mut issues) = (vec![], vec![], vec![], vec![]);
    let mut beta = Value::Null;
    let Some(raw) = obj(raw) else {
        return json!({ "features": {}, "notices": [], "blocks": [], "beta": null, "mirrors": [], "issues": [] });
    };
    let list = |k: &str, max: usize| -> Vec<Value> {
        raw.get(k).and_then(Value::as_array).map(|a| a.iter().take(max).cloned().collect()).unwrap_or_default()
    };

    let fs = raw.get("features").and_then(obj).unwrap_or_default();
    for name in SWITCHABLE {
        let Some(f) = fs.get(name).and_then(obj) else { continue };
        if f.get("off") != Some(&Value::Bool(true)) {
            continue;
        }
        features.insert(
            name.into(),
            json!({ "off": true, "ru": str_of(f.get("ru"), MAX_TEXT), "en": str_of(f.get("en"), MAX_TEXT) }),
        );
    }

    static HTTPS: OnceLock<Regex> = OnceLock::new();
    let https = HTTPS.get_or_init(|| Regex::new(r"(?i-u)^https://").unwrap());
    for n in list("notices", MAX_NOTICES) {
        let Some(n) = obj(&n) else { continue };
        let id = str_of(n.get("id"), 80);
        if id.is_empty() {
            continue;
        }
        let url = str_of(n.get("url"), 300);
        notices.push(json!({
            "id": id,
            "date": str_of(n.get("date"), 20),
            "level": if n.get("level").and_then(Value::as_str) == Some("warn") { "warn" } else { "info" },
            "ru": str_of(n.get("ru"), MAX_TEXT),
            "en": str_of(n.get("en"), MAX_TEXT),
            "url": if https.is_match(&url) { json!(url) } else { Value::Null },
            "minVersion": opt(str_of(n.get("minVersion"), 20)),
            "maxVersion": opt(str_of(n.get("maxVersion"), 20)),
            "until": valid_day(n.get("until")),
        }));
    }

    for b in list("blocks", MAX_NOTICES) {
        let Some(b) = obj(&b) else { continue };
        let id = str_of(b.get("id"), 80);
        let until = valid_day(b.get("until"));
        let feature = b.get("feature").and_then(Value::as_str).filter(|f| SWITCHABLE.contains(f));
        let Some(feature) = feature.filter(|_| !id.is_empty() && !until.is_null()) else { continue };
        blocks.push(json!({
            "id": id,
            "feature": feature,
            "ru": str_of(b.get("ru"), MAX_TEXT),
            "en": str_of(b.get("en"), MAX_TEXT),
            "minVersion": opt(str_of(b.get("minVersion"), 20)),
            "maxVersion": opt(str_of(b.get("maxVersion"), 20)),
            "until": until,
        }));
    }

    if let Some(b) = raw.get("beta").and_then(obj) {
        static HASH: OnceLock<Regex> = OnceLock::new();
        let hash = HASH.get_or_init(|| Regex::new(r"(?i-u)^[0-9a-f]{64}$").unwrap());
        let ids: Vec<String> = b
            .get("ids")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .filter(|id| hash.is_match(trim(id)))
                    .take(MAX_TESTERS)
                    .map(|id| trim(id).to_lowercase())
                    .collect()
            })
            .unwrap_or_default();
        if !ids.is_empty() {
            beta = json!({ "salt": str_of(b.get("salt"), 80), "ids": ids });
        }
    }

    for m in list("mirrors", MAX_MIRRORS) {
        let Some(m) = obj(&m) else { continue };
        let base = str_of(m.get("base"), 300);
        let Ok(u) = url::Url::parse(&base) else { continue };
        if u.scheme() != "https"
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some_and(|q| !q.is_empty())
            || u.fragment().is_some_and(|f| !f.is_empty())
            || !u.path().ends_with('/')
        {
            continue;
        }
        let host = crate::net_mirrors::host_of(&base);
        if host == RAW_MIRROR_HOST {
            continue;
        }
        let id = Some(str_of(m.get("id"), 40)).filter(|i| !i.is_empty()).unwrap_or_else(|| host.clone());
        if mirrors.iter().any(|x: &Value| x["id"] == json!(id) || x["base"] == json!(base)) {
            continue;
        }
        mirrors.push(json!({ "id": id, "base": base, "host": host }));
    }

    for i in list("issues", MAX_ISSUES) {
        let Some(i) = obj(&i) else { continue };
        let (cat, m, ru, en) = (
            str_of(i.get("cat"), 40),
            str_of(i.get("mod"), 120),
            str_of(i.get("ru"), MAX_TEXT),
            str_of(i.get("en"), MAX_TEXT),
        );
        if cat.is_empty() || m.is_empty() || (ru.is_empty() && en.is_empty()) {
            continue;
        }
        let mut issue = json!({ "cat": cat, "mod": m, "ru": ru, "en": en, "until": valid_day(i.get("until")) });
        if i.get("revoked") == Some(&Value::Bool(true)) {
            issue["revoked"] = json!(true);
        }
        issues.push(issue);
    }

    json!({ "features": features, "notices": notices, "blocks": blocks, "beta": beta, "mirrors": mirrors, "issues": issues })
}

/// `YYYY-MM-DD` of a time in milliseconds, in UTC.
pub fn day_of(ms: f64) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default()
}

fn say(e: &Value, lang: &str) -> String {
    let (ru, en) =
        (e.get("ru").and_then(Value::as_str).unwrap_or(""), e.get("en").and_then(Value::as_str).unwrap_or(""));
    let first = if lang == "ru" { ru } else { en };
    [first, en, ru].into_iter().find(|s| !s.is_empty()).unwrap_or("").to_string()
}

/// The signed config: the last good copy kept between starts, and what it says to this build.
pub struct RemoteConfig {
    file: PathBuf,
    public_key: String,
    app_version: String,
    now: Clock,
    cache: Mutex<Option<Value>>,
}

impl RemoteConfig {
    pub fn new(user_data: &Path, app_version: &str, public_key: Option<&str>, now: Clock) -> RemoteConfig {
        RemoteConfig {
            file: user_data.join("remote-config.json"),
            public_key: public_key.unwrap_or(CONFIG_PUBLIC_KEY).to_string(),
            app_version: app_version.to_string(),
            now,
            cache: Mutex::new(None),
        }
    }

    fn read(&self) -> Value {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if c.is_none() {
            let raw = std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            *c = Some(normalize(raw.as_ref().unwrap_or(&Value::Null)));
        }
        c.clone().unwrap_or(Value::Null)
    }

    /// Fetch, check and keep; never fails, being offline is the normal case.
    pub fn refresh(&self, net: &Net, log: &mut dyn FnMut(&str)) -> Value {
        let r = (|| -> Result<Value, String> {
            let text = net.fetch_text(CONFIG_URL, FetchOptions::default()).map_err(|e| e.message)?;
            let sig = net.fetch_text(&format!("{CONFIG_URL}.sig"), FetchOptions::default()).map_err(|e| e.message)?;
            if !crate::catalog_signature::verify(text.as_bytes(), &sig, &self.public_key) {
                return Err("signature does not match".into());
            }
            let raw: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let parsed = normalize(&raw);
            std::fs::write(&self.file, crate::js::stringify(&parsed, "  ")).map_err(|e| e.to_string())?;
            Ok(parsed)
        })();
        match r {
            Ok(parsed) => {
                let off = parsed["features"].as_object().map_or(0, Map::len);
                let n = parsed["notices"].as_array().map_or(0, Vec::len);
                log(&format!("remote config: {off} switch(es) off, {n} notice(s)"));
                *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(parsed.clone());
                parsed
            }
            Err(e) => {
                log(&format!("remote config not fetched: {e}"));
                self.read()
            }
        }
    }

    fn today(&self) -> String {
        day_of((self.now)())
    }

    /// Is this feature off right now, and what should the user be told?
    pub fn feature(&self, name: &str, lang: &str) -> (bool, String) {
        let cfg = self.read();
        if let Some(off) = cfg["features"].get(name) {
            return (true, say(off, lang));
        }
        let today = self.today();
        match cfg["blocks"]
            .as_array()
            .and_then(|b| b.iter().find(|b| b["feature"] == json!(name) && applies(b, &self.app_version, &today)))
        {
            Some(b) => (true, say(b, lang)),
            None => (false, String::new()),
        }
    }

    /// Notices meant for this build, newest first, the text in one language.
    pub fn notices(&self, lang: &str) -> Vec<Value> {
        let today = self.today();
        let mut out: Vec<Value> = self.read()["notices"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|n| applies(n, &self.app_version, &today))
            .map(|n| json!({ "id": n["id"], "date": n["date"], "level": n["level"], "url": n["url"], "text": say(&n, lang) }))
            .filter(|n| n["text"] != json!(""))
            .collect();
        out.sort_by(|a, b| crate::js::locale_compare(&crate::js::string(&b["date"]), &crate::js::string(&a["date"])));
        out
    }

    pub fn beta(&self) -> Value {
        self.read()["beta"].clone()
    }

    pub fn mirrors(&self) -> Value {
        self.read()["mirrors"].clone()
    }

    /// Catalog mods marked as misbehaving, still in date, the text in one language.
    pub fn issues(&self, lang: &str) -> Vec<Value> {
        let today = self.today();
        self.read()["issues"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| i["until"].as_str().is_none_or(|u| u >= today.as_str()))
            .map(|i| {
                let mut o = json!({ "cat": i["cat"], "mod": i["mod"], "text": say(&i, lang) });
                if i.get("revoked").is_some() {
                    o["revoked"] = json!(true);
                }
                o
            })
            .collect()
    }
}
