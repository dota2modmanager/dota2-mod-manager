//! A request across the mirror chain (src/net-fetch.ts) and a file brought to disk through it
//! (src/net-download.ts): each mirror of a URL in turn, a failure noted against its host, the
//! first good answer taken; a download resumed from its `.part`, checked against the hash the
//! catalog published, and a mirror whose bytes do not match treated as a mirror that failed.
//!
//! The wait for an answer's headers is bounded; the body is cut only after a stretch of silence,
//! since a 300 MB mod on a slow line is not a stall.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::net_mirrors::{host_of, Chain, Entry};

const ATTEMPTS_PER_MIRROR: usize = 2;

/// How long an answer may take to start, and how long its body may go silent.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub head_ms: u64,
    pub idle_ms: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Timing { head_ms: 10000, idle_ms: 30000 }
    }
}

/// Why a request came to nothing.
#[derive(Debug, Clone, PartialEq, thiserror::Error, serde::Serialize)]
#[error("{message}")]
pub struct NetError {
    pub message: String,
    /// no mirror could even be reached: the player's connection, not a server, is the story
    pub offline: bool,
    /// the answer or the body never came
    pub timeout: bool,
    /// every copy disagreed with the published hash
    pub checksum: bool,
}

impl NetError {
    fn new(message: impl Into<String>) -> NetError {
        NetError { message: message.into(), offline: false, timeout: false, checksum: false }
    }
}

/// An answer: its status and headers, and the body still to read.
pub struct Answer {
    pub status: u16,
    pub from: Entry,
    headers: Vec<(String, String)>,
    body: Box<dyn Read + Send>,
}

impl Answer {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn text(mut self) -> Result<String, NetError> {
        let mut buf = Vec::new();
        self.body.read_to_end(&mut buf).map_err(io_error)?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }
}

/// Options for one walk along the mirrors.
#[derive(Default)]
pub struct FetchOptions<'a> {
    /// allow size-capped mirrors
    pub small: bool,
    /// the URL itself and nothing else
    pub trusted_only: bool,
    pub headers: Vec<(String, String)>,
    /// hosts already tried for this file and found wanting
    pub exclude: Vec<String>,
    pub log: Option<&'a mut dyn FnMut(&str)>,
}

/// The app's network: the chain, how each host is doing, and the user's proxy.
pub struct Net {
    chain: Mutex<Chain>,
    agent: RwLock<(Option<String>, ureq::Agent)>,
    timing: RwLock<Timing>,
    now: fn() -> f64,
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

fn agent(proxy: Option<&str>, timing: Timing) -> ureq::Agent {
    let head = Some(Duration::from_millis(timing.head_ms));
    let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_resolve(head)
        .timeout_connect(head)
        .timeout_send_request(head)
        .timeout_recv_response(head)
        // the body is watched for silence by `Watched`; this only ends a reader nobody waits on
        .timeout_recv_body(Some(Duration::from_secs(3600)))
        .tls_config(tls)
        .proxy(proxy.and_then(|p| ureq::Proxy::new(p).ok()))
        .build()
        .into()
}

fn io_error(e: std::io::Error) -> NetError {
    let timeout = e.kind() == std::io::ErrorKind::TimedOut;
    NetError { timeout, ..NetError::new(e.to_string()) }
}

/// A body read on its own thread, so that a read which never returns can be given up on.
struct Watched {
    rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    idle: Duration,
    left: Vec<u8>,
    done: bool,
}

impl Watched {
    fn new(mut body: impl Read + Send + 'static, idle: Duration) -> Watched {
        let (tx, rx) = mpsc::sync_channel(4);
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let r = body.read(&mut buf).map(|n| buf[..n].to_vec());
                let end = !matches!(&r, Ok(b) if !b.is_empty());
                if tx.send(r).is_err() || end {
                    break;
                }
            }
        });
        Watched { rx, idle, left: Vec::new(), done: false }
    }
}

impl Read for Watched {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.left.is_empty() && !self.done {
            match self.rx.recv_timeout(self.idle) {
                Ok(Ok(chunk)) if chunk.is_empty() => self.done = true,
                Ok(Ok(chunk)) => self.left = chunk,
                Ok(Err(e)) => return Err(e),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "the download timed out"))
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => self.done = true,
            }
        }
        let n = out.len().min(self.left.len());
        out[..n].copy_from_slice(&self.left[..n]);
        self.left.drain(..n);
        Ok(n)
    }
}

impl Default for Net {
    fn default() -> Self {
        Net::new(now_ms)
    }
}

impl Net {
    pub fn new(now: fn() -> f64) -> Net {
        Net {
            chain: Mutex::new(Chain::default()),
            agent: RwLock::new((None, agent(None, Timing::default()))),
            timing: RwLock::new(Timing::default()),
            now,
        }
    }

    pub fn chain(&self) -> std::sync::MutexGuard<'_, Chain> {
        self.chain.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_timing(&self, t: Option<Timing>) {
        let t = t.unwrap_or_default();
        *self.timing.write().unwrap_or_else(|e| e.into_inner()) = t;
        let proxy = self.agent.read().unwrap_or_else(|e| e.into_inner()).0.clone();
        *self.agent.write().unwrap_or_else(|e| e.into_inner()) = (proxy.clone(), agent(proxy.as_deref(), t));
    }

    /// The user's proxy, already validated; None goes direct.
    pub fn set_proxy(&self, proxy: Option<&str>) {
        let t = *self.timing.read().unwrap_or_else(|e| e.into_inner());
        let mut a = self.agent.write().unwrap_or_else(|e| e.into_inner());
        if a.0.as_deref() != proxy {
            *a = (proxy.map(String::from), agent(proxy, t));
        }
    }

    fn get(&self, url: &str, headers: &[(String, String)]) -> Result<Answer, NetError> {
        let agent = self.agent.read().unwrap_or_else(|e| e.into_inner()).1.clone();
        let idle = Duration::from_millis(self.timing.read().unwrap_or_else(|e| e.into_inner()).idle_ms);
        let mut req = agent.get(url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        let res = req.call().map_err(|e| {
            let timeout = matches!(e, ureq::Error::Timeout(_));
            NetError { timeout, ..NetError::new(e.to_string()) }
        })?;
        let status = res.status().as_u16();
        let headers =
            res.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
        let body = res.into_body().into_reader();
        Ok(Answer {
            status,
            from: Entry { url: url.into(), host: host_of(url), origin: false },
            headers,
            body: Box::new(Watched::new(body, idle)),
        })
    }

    /// The first mirror's answer that is not a failure. A 404 from the origin is the answer; from
    /// a mirror it only says that host has no copy yet, and the others are asked.
    pub fn fetch_mirrored(&self, url: &str, mut o: FetchOptions) -> Result<Answer, NetError> {
        let now = self.now;
        let candidates = {
            let chain = self.chain();
            let usable: Vec<Entry> = chain
                .entries_for(url, o.small, o.trusted_only)
                .into_iter()
                .filter(|e| !o.exclude.contains(&e.host))
                .collect();
            chain.live_order(usable, now())
        };
        let mut log = |m: &str| {
            if let Some(l) = o.log.as_mut() {
                l(m)
            }
        };
        let mut last: Option<NetError> = None;
        let mut missing: Option<Answer> = None;
        let mut lacking: Vec<String> = Vec::new();
        for _ in 0..ATTEMPTS_PER_MIRROR {
            for c in &candidates {
                if self.chain().stood_down(&c.host, now()) || lacking.contains(&c.host) {
                    continue;
                }
                let r = self.get(&c.url, &o.headers).and_then(|mut a| {
                    a.from = c.clone();
                    if a.ok() || a.status == 404 {
                        Ok(a)
                    } else {
                        Err(NetError::new(format!("HTTP {}", a.status)))
                    }
                });
                match r {
                    Ok(a) if a.status == 404 => {
                        if c.origin {
                            return Ok(a);
                        }
                        lacking.push(c.host.clone());
                        missing = Some(a);
                        log(&format!("mirror {} has no copy", c.host));
                    }
                    Ok(a) => {
                        self.chain().note_success(&c.host);
                        return Ok(a);
                    }
                    Err(e) => {
                        if e.timeout {
                            self.chain().note_stall(&c.host, &e.message, now());
                        } else {
                            self.chain().note_failure(&c.host, &e.message, now());
                        }
                        log(&format!("mirror {} failed: {}", c.host, e.message));
                        last = Some(e);
                    }
                }
            }
        }
        if let Some(a) = missing {
            return Ok(a);
        }
        let mut err = last.unwrap_or_else(|| NetError::new("no mirror answered"));
        err.offline = !regex_http(&err.message);
        Err(err)
    }

    /// Text from the first mirror that answers (catalog JSON, fingerprint map).
    pub fn fetch_text(&self, url: &str, mut o: FetchOptions) -> Result<String, NetError> {
        o.small = true;
        let a = self.fetch_mirrored(url, o)?;
        if !a.ok() {
            return Err(NetError::new(format!("HTTP {}", a.status)));
        }
        a.text()
    }

    /// Bring a file to disk, resuming where an interrupted attempt stopped. A mirror whose bytes
    /// miss `expect_sha256` loses its turn; when the hash came from a list somebody else keeps
    /// (`from_published_list`) and nothing matches, the origin's copy is the file.
    pub fn download_file(&self, url: &str, dest: &Path, d: DownloadOptions) -> Result<Download, NetError> {
        let DownloadOptions { on_progress, expect_sha256, from_published_list, log } = d;
        let (mut no_progress, mut no_log) = (|_: u64, _: u64| {}, |_: &str| {});
        let on_progress: &mut dyn FnMut(u64, u64) = match on_progress {
            Some(p) => p,
            None => &mut no_progress,
        };
        let log: &mut dyn FnMut(&str) = match log {
            Some(l) => l,
            None => &mut no_log,
        };
        let io = |e: std::io::Error| NetError::new(e.to_string());
        if let Some(dir) = dest.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let part = sibling(dest, ".part");
        let kept = sibling(dest, ".origin");
        let mut refused: Vec<String> = Vec::new();
        let mirror_count = self.chain().mirrors_for(url, false, false).len().max(1);
        let mut have_origin_copy = false;
        let mut attempt = 0;
        loop {
            let mut have = std::fs::metadata(&part).map_or(0, |m| m.len());
            let headers = if have > 0 { vec![("Range".to_string(), format!("bytes={have}-"))] } else { vec![] };
            let a = self.fetch_mirrored(
                url,
                FetchOptions { headers, exclude: refused.clone(), log: Some(&mut *log), ..Default::default() },
            )?;
            if !a.ok() {
                return Err(NetError::new(format!("HTTP {}", a.status)));
            }
            let host = a.from.host.clone();
            let resuming = a.status == 206 && have > 0;
            if !resuming && have > 0 {
                log(&format!("resume refused by {host}, starting over"));
                have = 0;
            }
            let total_header = a.header("content-length").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(0);
            let total = if total_header > 0 { total_header + if resuming { have } else { 0 } } else { 0 };
            let origin = a.from.origin;
            {
                let mut out = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .append(resuming)
                    .truncate(!resuming)
                    .open(&part)
                    .map_err(io)?;
                let mut body = a.body;
                let mut loaded = have;
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let n = body.read(&mut buf).map_err(io_error)?;
                    if n == 0 {
                        break;
                    }
                    loaded += n as u64;
                    on_progress(loaded, total);
                    out.write_all(&buf[..n]).map_err(io)?;
                }
            }
            let digest = sha256_file(&part).map_err(io)?;
            if expect_sha256.as_deref().is_some_and(|e| e != digest) {
                if from_published_list && origin {
                    let _ = std::fs::remove_file(&kept);
                    std::fs::rename(&part, &kept).map_err(io)?;
                    have_origin_copy = true;
                } else {
                    let _ = std::fs::remove_file(&part);
                }
                let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                self.chain().note_failure(&host, "checksum mismatch", (self.now)());
                refused.push(host.clone());
                log(&format!("mirror {host} served {name} with the wrong checksum"));
                attempt += 1;
                if attempt < mirror_count {
                    continue;
                }
                if have_origin_copy {
                    let kind = sha256_file(&kept).map_err(io)?;
                    let _ = std::fs::remove_file(dest);
                    std::fs::rename(&kept, dest).map_err(io)?;
                    log(&format!("{name}: no copy matches the published hash; taking the one from the host the catalog names, which is where the list is built"));
                    let bytes = std::fs::metadata(dest).map_err(io)?.len();
                    return Ok(Download {
                        path: dest.to_path_buf(),
                        bytes,
                        sha256: kind,
                        resumed_from: 0,
                        unverified: true,
                    });
                }
                return Err(NetError { checksum: true, ..NetError::new(format!("checksum mismatch for {name}")) });
            }
            if have_origin_copy {
                let _ = std::fs::remove_file(&kept);
            }
            let _ = std::fs::remove_file(dest);
            std::fs::rename(&part, dest).map_err(io)?;
            let bytes = std::fs::metadata(dest).map_err(io)?.len();
            return Ok(Download {
                path: dest.to_path_buf(),
                bytes,
                sha256: digest,
                resumed_from: if resuming { have } else { 0 },
                unverified: false,
            });
        }
    }
}

fn regex_http(message: &str) -> bool {
    let b = message.as_bytes();
    b.windows(6).any(|w| &w[..5] == b"HTTP " && w[5].is_ascii_digit())
}

fn sibling(dest: &Path, suffix: &str) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h)?;
    Ok(format!("{:x}", h.finalize()))
}

/// How a download is watched and checked.
#[derive(Default)]
pub struct DownloadOptions<'a> {
    pub on_progress: Option<&'a mut dyn FnMut(u64, u64)>,
    pub expect_sha256: Option<String>,
    pub from_published_list: bool,
    pub log: Option<&'a mut dyn FnMut(&str)>,
}

/// A file on disk, and how it got there.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
    pub resumed_from: u64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unverified: bool,
}

/// The proxy setting as the user typed it, checked without putting the address into an error:
/// `Ok(None)` is no proxy, `Ok(Some)` the address to use, `Err` the reason in Russian for `t`.
pub fn validate_download_proxy(value: &serde_json::Value) -> Result<Option<String>, String> {
    let Some(text) = value.as_str() else { return Err("Прокси должен быть адресом".into()) };
    let text = crate::js::trim(text);
    if text.is_empty() {
        return Ok(None);
    }
    let lower = text.to_ascii_lowercase();
    let rest = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://"));
    if rest.is_none_or(|r| r.starts_with('/')) {
        return Err("Неверный адрес прокси".into());
    }
    let Ok(url) = url::Url::parse(text) else { return Err("Неверный адрес прокси".into()) };
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Прокси должен использовать HTTP или HTTPS".into());
    }
    if url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some_and(|q| !q.is_empty())
        || url.fragment().is_some_and(|f| !f.is_empty())
        || url.path() != "/"
    {
        return Err("Укажи прокси в формате http://host:port".into());
    }
    if url.port() == Some(0) {
        return Err("Порт прокси должен быть от 1 до 65535".into());
    }
    Ok(Some(text.to_string()))
}

/// Settings' "test" button: one HEAD request through the proxy the user typed, ten seconds at
/// most. `{ ok: true }` or `{ error }`, the reason in Russian for the window's `t`.
pub fn test_download_proxy(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let proxy = match validate_download_proxy(value) {
        Err(e) => return json!({ "error": e }),
        Ok(None) => return json!({ "ok": true }),
        Ok(Some(p)) => p,
    };
    let Ok(p) = ureq::Proxy::new(&proxy) else {
        return json!({ "error": "Не удалось подключиться через прокси" });
    };
    let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(10)))
        .tls_config(tls)
        .proxy(Some(p))
        .build()
        .into();
    match agent.head("https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/README.md").call() {
        Ok(r) if r.status().is_success() => json!({ "ok": true }),
        Ok(_) => json!({ "error": "Прокси не ответил успешно" }),
        Err(_) => json!({ "error": "Не удалось подключиться через прокси" }),
    }
}
