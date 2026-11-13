//! The catalog's pictures, kept on this disk and served from it (src/preview-cache.ts).
//!
//! Where GitHub is blocked a picture request hangs rather than fails, so the window's requests
//! for catalog pictures are answered here: from disk when the picture is there, otherwise from the
//! mirror first and the other hosts after a moment each instead of after a timeout. `warm` fetches
//! the rest of the catalog in the background. Hosts that fetch GitHub for anybody stay out: a
//! picture has no digest and goes straight to an image decoder.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::installer_downloads::{decode_uri_component, encode_uri_component};
use crate::net_fetch::Net;

pub const SCHEME: &str = "mm-preview";
const ORIGIN: &str = "mm-preview://catalog/";
const RAW: &str = "https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main/";
pub const MIRROR: &str = "https://cdn.dota2modmanager.com/";
const JSDELIVR: &str = "https://cdn.jsdelivr.net/gh/h6rd/Dota2PornFxWeb@main/";
const PREVIEWS: &str = "assets/previews/";
const STAGGER_MS: u64 = 1500;
const TIMEOUT_MS: u64 = 15000;
const MAX_BYTES: usize = 8 * 1024 * 1024;
/// A picture older than this is asked about again, in case its author replaced it.
pub const FRESH_MS: u64 = 7 * 24 * 3600 * 1000;
const WARM_WORKERS: usize = 3;
const WARM_GIVE_UP: usize = 8;

fn picture_ext(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    [".webp", ".png", ".gif", ".jpg", ".jpeg", ".ico"].iter().any(|e| l.ends_with(e))
}

/// The catalog path of a picture address, encoded as it arrived, or None for anything else.
pub fn picture_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix(RAW).or_else(|| url.strip_prefix(ORIGIN))?;
    let rel = rest.split(['?', '#']).next().unwrap_or("");
    if !rel.starts_with(PREVIEWS) || !picture_ext(rel) {
        return None;
    }
    let plain = decode_uri_component(rel)?;
    if plain.split(['\\', '/']).any(|p| p == "..") {
        return None;
    }
    Some(rel.to_string())
}

/// Where the window's request goes instead; None leaves it alone.
pub fn redirect_for(url: &str) -> Option<String> {
    if !url.starts_with(RAW) {
        return None;
    }
    picture_of(url).map(|rel| format!("{ORIGIN}{rel}"))
}

/// What these bytes really are, or None when they are no picture at all.
pub fn picture_type(b: &[u8]) -> Option<&'static str> {
    let is = |at: usize, sig: &[u8]| b.get(at..at + sig.len()) == Some(sig);
    if is(0, b"RIFF") && is(8, b"WEBP") {
        Some("image/webp")
    } else if is(0, &[0x89, 0x50, 0x4e, 0x47]) {
        Some("image/png")
    } else if is(0, b"GIF8") {
        Some("image/gif")
    } else if is(0, &[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if is(0, &[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        None
    }
}

/// Hosts that carry this picture, best first; `bases` are the picture folders of the hosts the
/// signed config names (`Chain::picture_bases`).
pub fn hosts_for(rel: &str, bases: &[String]) -> Vec<String> {
    let below = rel.get(PREVIEWS.len()..).unwrap_or("");
    let mut out = vec![format!("{MIRROR}{rel}"), format!("{RAW}{rel}"), format!("{JSDELIVR}{rel}")];
    out.extend(bases.iter().map(|b| format!("{b}{below}")));
    out
}

/// Every picture the catalog names, categories first, encoded the way the window asks for them.
pub fn pictures_in(mods: &Value, constants: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |cat: &str, name: &str| {
        let l = name.to_ascii_lowercase();
        if l.starts_with("http:") || l.starts_with("https:") {
            return;
        }
        let rel = if name.starts_with(PREVIEWS) { name.to_string() } else { format!("{PREVIEWS}{cat}/{name}") };
        let safe = rel.split('/').map(encode_uri_component).collect::<Vec<_>>().join("/");
        if picture_of(&format!("{RAW}{safe}")).is_some() && seen.insert(safe.clone()) {
            out.push(safe);
        }
    };
    fn walk(node: &Value, cat: &str, add: &mut dyn FnMut(&str, &str)) {
        match node {
            Value::Array(a) => a.iter().for_each(|x| walk(x, cat, add)),
            Value::Object(o) => {
                for k in crate::js::keys(o) {
                    let v = &o[k];
                    match v {
                        Value::String(s) if k == "preview" && !s.is_empty() => add(cat, s),
                        Value::Array(_) | Value::Object(_) | Value::Null => walk(v, cat, add),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(cats) = constants.get("categories").and_then(Value::as_array) {
        for c in cats {
            if let Some(p) = c.get("preview").filter(|p| crate::js::truthy(p)) {
                add("categories", &crate::js::string(p));
            }
        }
    }
    if let Some(Value::Object(by_cat)) = mods.get("modsData") {
        for cat in crate::js::keys(by_cat) {
            walk(&by_cat[cat], cat, &mut add);
        }
    }
    out
}

/// A picture ready to hand over.
#[derive(Debug, Clone)]
pub struct Picture {
    pub bytes: Vec<u8>,
    pub kind: &'static str,
}

enum Tried {
    Got(Picture),
    Same,
    Nothing,
}

/// A request in flight for one picture, which a second asker waits on instead of asking again.
type Waiting = Arc<(Mutex<Option<Option<Picture>>>, Condvar)>;

/// Turns an address into the one really asked; a test points the hosts at its own server.
pub type Rewrite = Box<dyn Fn(&str) -> String + Send + Sync>;

/// The folder of pictures, and the one way in and out of it.
pub struct PreviewStore {
    dir: PathBuf,
    net: Arc<Net>,
    stagger: Duration,
    /// a URL as it is really asked for; a test points the hosts at its own server
    rewrite: Rewrite,
    log: Box<dyn Fn(&str) + Send + Sync>,
    pending: Mutex<HashMap<String, Waiting>>,
    rechecking: Mutex<HashSet<String>>,
    warming: Mutex<bool>,
}

fn http_date(t: SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(t).format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

impl PreviewStore {
    pub fn new(
        dir: &Path,
        net: Arc<Net>,
        stagger_ms: Option<u64>,
        rewrite: Option<Rewrite>,
        log: Box<dyn Fn(&str) + Send + Sync>,
    ) -> Arc<PreviewStore> {
        Arc::new(PreviewStore {
            dir: dir.into(),
            net,
            stagger: Duration::from_millis(stagger_ms.unwrap_or(STAGGER_MS)),
            rewrite: rewrite.unwrap_or_else(|| Box::new(|s: &str| s.to_string())),
            log,
            pending: Mutex::new(HashMap::new()),
            rechecking: Mutex::new(HashSet::new()),
            warming: Mutex::new(false),
        })
    }

    pub fn file_of(&self, rel: &str) -> PathBuf {
        use sha1::Digest;
        self.dir.join(format!("{:x}", sha1::Sha1::digest(rel.as_bytes())))
    }

    fn attempt(&self, url: &str, headers: &[(&str, &str)]) -> Tried {
        let Ok((status, bytes)) = self.net.direct("GET", &(self.rewrite)(url), headers, None, TIMEOUT_MS) else {
            return Tried::Nothing;
        };
        if status == 304 {
            return Tried::Same;
        }
        if !(200..300).contains(&status) || bytes.len() > MAX_BYTES {
            return Tried::Nothing;
        }
        match picture_type(&bytes) {
            Some(kind) => Tried::Got(Picture { bytes, kind }),
            None => Tried::Nothing,
        }
    }

    /// The first host with the picture. A slow host loses its turn without losing its chance.
    fn first_answer(self: &Arc<Self>, rel: &str) -> Option<Picture> {
        let urls = hosts_for(rel, &self.net.chain().picture_bases());
        let (tx, rx) = mpsc::channel::<Option<Picture>>();
        let mut next = 0;
        let mut left = urls.len();
        let launch = |next: &mut usize| {
            if *next >= urls.len() {
                return;
            }
            let (me, url, tx) = (Arc::clone(self), urls[*next].clone(), tx.clone());
            *next += 1;
            std::thread::spawn(move || {
                let got = match me.attempt(&url, &[]) {
                    Tried::Got(p) => Some(p),
                    _ => None,
                };
                let _ = tx.send(got);
            });
        };
        launch(&mut next);
        while left > 0 {
            match rx.recv_timeout(self.stagger) {
                Ok(Some(p)) => return Some(p),
                Ok(None) => {
                    left -= 1;
                    launch(&mut next);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => launch(&mut next),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        None
    }

    fn keep(&self, file: &Path, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let mut part = file.as_os_str().to_owned();
        part.push(format!(".{}.part", std::process::id()));
        std::fs::write(&part, bytes)?;
        std::fs::rename(&part, file)
    }

    /// Asks the mirror whether a picture on disk has changed; the next look shows the new one.
    fn recheck(&self, rel: &str, file: &Path, since: SystemTime) {
        let since = http_date(since);
        match self.attempt(&format!("{MIRROR}{rel}"), &[("If-Modified-Since", &since)]) {
            Tried::Same => {
                let _ = std::fs::File::options().write(true).open(file).and_then(|f| f.set_modified(SystemTime::now()));
            }
            Tried::Got(p) => {
                let _ = self.keep(file, &p.bytes);
            }
            Tried::Nothing => {}
        }
    }

    fn from_disk(self: &Arc<Self>, rel: &str, file: &Path) -> Option<Picture> {
        let bytes = std::fs::read(file).ok()?;
        let kind = picture_type(&bytes)?;
        let mtime = std::fs::metadata(file).ok()?.modified().ok()?;
        let old = SystemTime::now().duration_since(mtime).is_ok_and(|age| age.as_millis() > u128::from(FRESH_MS));
        if old && self.rechecking.lock().unwrap_or_else(|e| e.into_inner()).insert(rel.to_string()) {
            let (me, rel, file) = (Arc::clone(self), rel.to_string(), file.to_path_buf());
            std::thread::spawn(move || {
                me.recheck(&rel, &file, mtime);
                me.rechecking.lock().unwrap_or_else(|e| e.into_inner()).remove(&rel);
            });
        }
        Some(Picture { bytes, kind })
    }

    /// Whether a recheck of an old picture is still running (a test waits on this).
    pub fn rechecking(&self) -> usize {
        self.rechecking.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// The picture, from disk if it is there and from the network if not; None when nobody has it.
    /// Two asks for one picture share one fetch.
    pub fn get(self: &Arc<Self>, rel: &str) -> Option<Picture> {
        let (waiting, mine) = {
            let mut p = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            match p.get(rel) {
                Some(w) => (w.clone(), false),
                None => {
                    let w: Waiting = Arc::new((Mutex::new(None), Condvar::new()));
                    p.insert(rel.to_string(), w.clone());
                    (w, true)
                }
            }
        };
        if !mine {
            let (lock, cv) = &*waiting;
            let mut g = lock.lock().unwrap_or_else(|e| e.into_inner());
            while g.is_none() {
                g = cv.wait(g).unwrap_or_else(|e| e.into_inner());
            }
            return g.clone().flatten();
        }
        let file = self.file_of(rel);
        let got = self.from_disk(rel, &file).or_else(|| {
            let got = self.first_answer(rel)?;
            if let Err(e) = self.keep(&file, &got.bytes) {
                (self.log)(&format!("picture not kept: {e}"));
            }
            Some(got)
        });
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(rel);
        let (lock, cv) = &*waiting;
        *lock.lock().unwrap_or_else(|e| e.into_inner()) = Some(got.clone());
        cv.notify_all();
        got
    }

    /// Fetches whatever of this list is not on disk, a few at a time, and stops after a run of
    /// misses (the network is down); how many it fetched.
    pub fn warm(self: &Arc<Self>, rels: &[String]) -> usize {
        {
            let mut w = self.warming.lock().unwrap_or_else(|e| e.into_inner());
            if *w {
                return 0;
            }
            *w = true;
        }
        let have: HashSet<String> = crate::js::dir_names(&self.dir).into_iter().collect();
        let todo: Vec<String> = rels
            .iter()
            .filter(|r| !have.contains(&self.file_of(r).file_name().unwrap_or_default().to_string_lossy().into_owned()))
            .cloned()
            .collect();
        let queue = Arc::new(Mutex::new((todo.into_iter().collect::<std::collections::VecDeque<_>>(), 0usize, 0usize)));
        let workers: Vec<_> = (0..WARM_WORKERS)
            .map(|_| {
                let (me, q) = (Arc::clone(self), Arc::clone(&queue));
                std::thread::spawn(move || loop {
                    let next = {
                        let mut q = q.lock().unwrap_or_else(|e| e.into_inner());
                        if q.1 >= WARM_GIVE_UP {
                            None
                        } else {
                            q.0.pop_front()
                        }
                    };
                    let Some(rel) = next else { break };
                    let ok = me.get(&rel).is_some();
                    let mut q = q.lock().unwrap_or_else(|e| e.into_inner());
                    if ok {
                        q.1 = 0;
                        q.2 += 1;
                    } else {
                        q.1 += 1;
                    }
                })
            })
            .collect();
        for w in workers {
            let _ = w.join();
        }
        let (left, _, fetched) = {
            let q = queue.lock().unwrap_or_else(|e| e.into_inner());
            (q.0.len(), q.1, q.2)
        };
        if fetched > 0 {
            (self.log)(&format!("pictures: {fetched} fetched ahead, {left} left"));
        }
        *self.warming.lock().unwrap_or_else(|e| e.into_inner()) = false;
        fetched
    }
}
