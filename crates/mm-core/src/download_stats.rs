//! How many times each catalog mod was downloaded (src/download-stats.ts), counted by the
//! catalog's own counter, a Cloudflare Worker its author runs.
//!
//! The numbers come down as one public file, fetched at most every five minutes and kept on disk,
//! so a window opened offline shows yesterday's numbers instead of none. An install goes up as a
//! hit on the mod's key; hits wait two seconds and leave together, a key counts at most five times
//! per request, and a hit that cannot be sent is dropped, never retried: the counter is somebody
//! else's free-tier Worker. A hit carries the key and nothing else, and only from a build that
//! carries the counter's token, with counting left on in Settings. Nothing here ever fails an
//! install.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::{Map, Value};

use crate::js::{string, truthy};
use crate::net_fetch::Net;

/// The counter's Worker: GET /downloads.json for the numbers, POST /hit to add to them.
pub const STATS_API: &str = "https://d2pfx-counter.hrdqfck.workers.dev";
const COUNTS_TTL_MS: f64 = 5.0 * 60.0 * 1000.0;
const FLUSH_DELAY_MS: u64 = 2000;
const TIMEOUT_MS: u64 = 8000;
const MAX_PER_KEY: f64 = 5.0;
const MAX_KEYS: usize = 500;
const MAX_COUNT_KEYS: usize = 50000;

/// Downloads by key, in the order they arrived.
pub type Counts = IndexMap<String, f64>;

/// A mod's key as the counter and the catalog site write it: categoryId/groupId/modName[/style].
pub fn stat_key(parts: &[Option<&str>]) -> String {
    parts.iter().flatten().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/")
}

/// A look's name as the counter keys it: its label without "Style ", or "Default" when that leaves nothing.
pub fn stat_style_name(label: &Value) -> String {
    let s = if label.is_null() { String::new() } else { string(label) };
    let s = s.replacen("Style ", "", 1);
    let t = crate::js::trim(&s);
    if t.is_empty() {
        "Default".into()
    } else {
        t.to_string()
    }
}

/// The keys one install counts under, read off mods.json: the mod's own key, and for a mod with
/// more than one look the look's key too. Nothing for a mod the catalog does not list.
pub fn stat_keys_for(
    mods_data: Option<&Value>,
    category_id: &str,
    name: &str,
    style_label: Option<&Value>,
) -> Vec<String> {
    let Some(category) = mods_data.and_then(|m| m.get(category_id)).filter(|c| truthy(c)) else { return vec![] };
    let empty = Vec::new();
    let arr = |v: Option<&Value>| v.and_then(Value::as_array).unwrap_or(&empty).clone();
    let lists: Vec<(Option<String>, Vec<Value>)> = match category {
        Value::Array(a) => vec![(None, a.clone())],
        _ => match category.get("groups") {
            Some(Value::Array(groups)) => groups
                .iter()
                .map(|g| (g.get("id").and_then(Value::as_str).map(String::from), arr(g.get("mods"))))
                .collect(),
            _ => vec![(None, arr(category.get("mods")))],
        },
    };
    for (group, mods) in lists {
        let Some(m) = mods.iter().find(|m| truthy(m) && m.get("name").and_then(Value::as_str) == Some(name)) else {
            continue;
        };
        let base = stat_key(&[Some(category_id), group.as_deref(), Some(name)]);
        let looks = m.get("styles").and_then(Value::as_array).map_or(0, Vec::len);
        return match style_label.filter(|l| truthy(l)) {
            Some(l) if looks > 1 => {
                vec![stat_key(&[Some(category_id), group.as_deref(), Some(name), Some(&stat_style_name(l))]), base]
            }
            _ => vec![base],
        };
    }
    vec![]
}

/// Only a map of names to whole, non-negative numbers is taken as counts.
pub fn clean_counts(data: &Value) -> Option<Counts> {
    let Value::Object(o) = data else { return None };
    let mut out = Counts::new();
    for (n, k) in crate::js::keys(o).into_iter().enumerate() {
        if n >= MAX_COUNT_KEYS {
            break;
        }
        if let Some(v) = o[k].as_f64().filter(|v| v.is_finite() && *v >= 0.0) {
            if k.encode_utf16().count() <= 400 {
                out.insert(k.clone(), v.floor());
            }
        }
    }
    Some(out)
}

fn counts_value(c: &Counts) -> Value {
    Value::Object(c.iter().map(|(k, v)| (k.clone(), crate::js::json_number(*v))).collect::<Map<_, _>>())
}

/// The token this build was given, or None: printable ASCII, 16 to 512 characters.
pub fn build_token(file: &Path) -> Option<String> {
    let t = std::fs::read_to_string(file).ok()?;
    let t = crate::js::trim(&t);
    ((16..=512).contains(&t.len()) && t.bytes().all(|b| (0x21..=0x7e).contains(&b))).then(|| t.to_string())
}

type Clock = Box<dyn Fn() -> f64 + Send + Sync>;

#[derive(Default)]
struct State {
    counts: Counts,
    counts_at: Option<f64>,
    /// installs made in this run, shown at once rather than after the next fetch
    session: Counts,
    pending: Counts,
    /// a flush is waiting; bumped to cancel the one that was
    due: Option<u64>,
    generation: u64,
}

/// The counter for this app: `get` the numbers to show, `track` an install, `flush` what waits.
pub struct DownloadStats {
    cache_file: PathBuf,
    enabled: Box<dyn Fn() -> bool + Send + Sync>,
    token: Option<String>,
    api: String,
    net: Arc<Net>,
    now: Clock,
    log: Box<dyn Fn(&str) + Send + Sync>,
    state: Mutex<State>,
}

impl DownloadStats {
    pub fn new(
        cache_file: &Path,
        enabled: Box<dyn Fn() -> bool + Send + Sync>,
        token: Option<String>,
        api: Option<&str>,
        net: Arc<Net>,
        now: Clock,
        log: Box<dyn Fn(&str) + Send + Sync>,
    ) -> Arc<DownloadStats> {
        let mut state = State::default();
        if let Some(saved) = std::fs::read_to_string(cache_file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| clean_counts(&v))
        {
            state.counts = saved;
        }
        Arc::new(DownloadStats {
            cache_file: cache_file.into(),
            enabled,
            token,
            api: api.unwrap_or(STATS_API).into(),
            net,
            now,
            log,
            state: Mutex::new(state),
        })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn active(&self) -> bool {
        self.token.is_some()
    }

    fn load(&self) {
        let r = self.net.direct("GET", &format!("{}/downloads.json", self.api), &[], None, TIMEOUT_MS);
        let (status, body) = match r {
            Ok(a) => a,
            Err(e) => return (self.log)(&format!("download counts: {}", e.message)),
        };
        if !(200..300).contains(&status) {
            return (self.log)(&format!("download counts: HTTP {status}"));
        }
        let Some(fresh) = serde_json::from_slice::<Value>(&body).ok().as_ref().and_then(clean_counts) else {
            if serde_json::from_slice::<Value>(&body).is_err() {
                (self.log)("download counts: the answer is not JSON");
            }
            return;
        };
        let mut st = self.state();
        st.counts = fresh;
        // once every hit has gone out, this run's installs are in the server's numbers
        if st.due.is_none() && st.pending.is_empty() {
            st.session.clear();
        }
        let _ = std::fs::write(&self.cache_file, crate::js::stringify(&counts_value(&st.counts), ""));
    }

    /// The counts to show: the last ones fetched, plus this run's installs. A failure waits its
    /// turn like a success does, so a dead Worker is not asked on every call.
    pub fn get(&self) -> Value {
        let now = (self.now)();
        let stale = self.state().counts_at.is_none_or(|at| now - at >= COUNTS_TTL_MS);
        if stale {
            self.state().counts_at = Some(now);
            self.load();
        }
        let st = self.state();
        let mut out = st.counts.clone();
        for (k, v) in &st.session {
            *out.entry(k.clone()).or_insert(0.0) += v;
        }
        counts_value(&out)
    }

    /// Send what waits, now.
    pub fn flush(&self) {
        let hits = {
            let mut st = self.state();
            st.due = None;
            st.generation += 1;
            std::mem::take(&mut st.pending)
        };
        let Some(token) = self.token.as_deref() else { return };
        if hits.is_empty() {
            return;
        }
        let body = crate::js::stringify(&serde_json::json!({ "hits": counts_value(&hits) }), "");
        let headers = [("Content-Type", "text/plain;charset=UTF-8"), ("X-Source", "app"), ("X-App-Token", token)];
        match self.net.direct("POST", &format!("{}/hit", self.api), &headers, Some(body.as_bytes()), TIMEOUT_MS) {
            Ok((status, _)) if !(200..300).contains(&status) => (self.log)(&format!("download hit: HTTP {status}")),
            Ok(_) => {}
            Err(e) => (self.log)(&format!("download hit: {}", e.message)),
        }
    }

    /// Count one install under these keys (`stat_keys_for`); nothing without a token or with
    /// counting off. The hits leave two seconds after the last install.
    pub fn track(self: &Arc<Self>, keys: &[String]) {
        if self.token.is_none() || !(self.enabled)() {
            return;
        }
        let generation = {
            let mut st = self.state();
            for k in keys.iter().filter(|k| !k.is_empty()) {
                if !st.pending.contains_key(k) && st.pending.len() >= MAX_KEYS {
                    continue;
                }
                let p = st.pending.entry(k.clone()).or_insert(0.0);
                *p = (*p + 1.0).min(MAX_PER_KEY);
                *st.session.entry(k.clone()).or_insert(0.0) += 1.0;
            }
            st.generation += 1;
            st.due = Some(st.generation);
            st.generation
        };
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(FLUSH_DELAY_MS));
            if me.state().due == Some(generation) {
                me.flush();
            }
        });
    }
}

/// mods.json's modsData off the catalog's cache file, parsed again only when the file changes.
pub struct CatalogModsReader {
    file: PathBuf,
    seen: Mutex<(Option<std::time::SystemTime>, Option<Value>)>,
}

impl CatalogModsReader {
    pub fn new(file: &Path) -> CatalogModsReader {
        CatalogModsReader { file: file.into(), seen: Mutex::new((None, None)) }
    }

    pub fn read(&self) -> Option<Value> {
        let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
        let r = (|| -> Option<(std::time::SystemTime, Option<Value>)> {
            let mut f = std::fs::File::open(&self.file).ok()?;
            let at = f.metadata().ok()?.modified().ok()?;
            if seen.0 == Some(at) {
                return Some((at, seen.1.clone()));
            }
            let mut text = String::new();
            std::io::Read::read_to_string(&mut f, &mut text).ok()?;
            let v: Value = serde_json::from_str(&text).ok()?;
            Some((at, v.get("modsData").filter(|m| !m.is_null()).cloned()))
        })();
        *seen = match r {
            Some((at, data)) => (Some(at), data),
            None => (None, None),
        };
        seen.1.clone()
    }
}
