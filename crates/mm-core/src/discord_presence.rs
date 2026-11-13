//! "Playing Dota 2 Mod Manager" in Discord, over Discord's local IPC socket
//! (src/discord-presence.ts). No OAuth and no account: presence needs only the application id.
//! Discord listens on a named pipe (a unix socket elsewhere) and speaks a tiny framed protocol,
//! [opcode i32][length i32][json] (src/presence-status.rs writes and reads the frames).
//!
//! Everything is best-effort: Discord not running, closed mid-session, a rejected payload; none
//! of it may disturb the app. The worst outcome allowed is "no status shown".
//!
//! One thread owns the connection and does both the reading and the writing: a synchronous pipe
//! on Windows lets no write through while a read waits on it, so the thread asks the pipe how
//! much is there (PeekNamedPipe) and reads only that, a few times a second.

use std::io::{Read, Write};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::presence_status::{discord_activity, encode_frame, take_frames};

const OP_HANDSHAKE: i32 = 0;
const OP_FRAME: i32 = 1;
const OP_CLOSE: i32 = 2;
const OP_PING: i32 = 3;
const OP_PONG: i32 = 4;

/// Discord is usually just not running yet.
const RETRY: Duration = Duration::from_secs(30);
/// Discord rate-limits SET_ACTIVITY to about five per twenty seconds.
const MIN_UPDATE_MS: f64 = 4000.0;
/// discord-ipc-0 to discord-ipc-9.
const MAX_PIPE: usize = 10;
/// How often the thread looks for what Discord sent.
const TICK: Duration = Duration::from_millis(40);

/// Where Discord's socket is: MM_DISCORD_PIPE pins one path, for a test's stand-in.
fn socket_path(i: usize) -> String {
    if let Ok(p) = std::env::var("MM_DISCORD_PIPE") {
        if !p.is_empty() {
            return p;
        }
    }
    if cfg!(windows) {
        return format!(r"\\?\pipe\discord-ipc-{i}");
    }
    let base = ["XDG_RUNTIME_DIR", "TMPDIR"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned());
    std::path::Path::new(&base).join(format!("discord-ipc-{i}")).to_string_lossy().into_owned()
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

/// The open connection, read without waiting.
struct Conn {
    #[cfg(windows)]
    file: std::fs::File,
    #[cfg(unix)]
    sock: std::os::unix::net::UnixStream,
}

impl Conn {
    fn open(path: &str) -> std::io::Result<Conn> {
        #[cfg(windows)]
        {
            let file = std::fs::OpenOptions::new().read(true).write(true).open(path)?;
            Ok(Conn { file })
        }
        #[cfg(unix)]
        {
            let sock = std::os::unix::net::UnixStream::connect(path)?;
            sock.set_nonblocking(true)?;
            Ok(Conn { sock })
        }
    }

    fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        #[cfg(windows)]
        {
            self.file.write_all(data)
        }
        #[cfg(unix)]
        {
            self.sock.set_nonblocking(false)?;
            let r = self.sock.write_all(data);
            self.sock.set_nonblocking(true)?;
            r
        }
    }

    /// What has arrived, without waiting for more; an error when the other end is gone.
    fn read_available(&mut self) -> std::io::Result<Vec<u8>> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let mut avail: u32 = 0;
            // SAFETY: the handle is this file's own, open for the call; no buffer is passed
            let ok = unsafe {
                windows_sys::Win32::System::Pipes::PeekNamedPipe(
                    self.file.as_raw_handle(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut avail,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            let mut buf = vec![0; avail as usize];
            if avail > 0 {
                self.file.read_exact(&mut buf)?;
            }
            Ok(buf)
        }
        #[cfg(unix)]
        {
            let mut out = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match self.sock.read(&mut chunk) {
                    Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
                    Ok(n) => out.extend_from_slice(&chunk[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(out),
                    Err(e) => return Err(e),
                }
            }
        }
    }
}

enum Cmd {
    Start,
    Stop,
    Set(Value),
    Quit,
}

/// The status, on its own thread. Dropping it ends the thread.
pub struct Presence {
    tx: Sender<Cmd>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct State {
    client_id: String,
    diag: Box<dyn Fn(&str) + Send>,
    conn: Option<Conn>,
    ready: bool,
    enabled: bool,
    buf: Vec<u8>,
    activity: Option<Value>,
    sent_at: f64,
    retry_at: Option<Instant>,
    flush_at: Option<Instant>,
    started_at: f64,
    drop_buttons: bool,
}

impl State {
    fn teardown(&mut self) {
        self.ready = false;
        self.buf.clear();
        self.conn = None;
    }

    fn retry(&mut self) {
        if self.enabled && self.retry_at.is_none() {
            self.retry_at = Some(Instant::now() + RETRY);
        }
    }

    // walk the pipes until one accepts us; if none does, Discord is not running: try later
    fn connect(&mut self) {
        if !self.enabled {
            return;
        }
        self.teardown();
        for i in 0..MAX_PIPE {
            if let Ok(mut c) = Conn::open(&socket_path(i)) {
                if c.write(&encode_frame(OP_HANDSHAKE, &json!({ "v": 1, "client_id": self.client_id }))).is_ok() {
                    self.conn = Some(c);
                    return;
                }
            }
        }
        self.retry();
    }

    fn on_disconnect(&mut self) {
        if !self.enabled {
            return;
        }
        self.teardown();
        self.retry();
    }

    fn write(&mut self, data: &[u8]) {
        let failed = self.conn.as_mut().is_some_and(|c| c.write(data).is_err());
        if failed {
            self.on_disconnect();
        }
    }

    fn on_frame(&mut self, op: i32, msg: Value) {
        if op == OP_PING {
            self.write(&encode_frame(OP_PONG, &msg));
            return;
        }
        if op == OP_CLOSE {
            self.on_disconnect();
            return;
        }
        if op != OP_FRAME || msg.is_null() {
            return;
        }
        match msg.get("evt").and_then(Value::as_str) {
            Some("READY") => {
                self.ready = true;
                (self.diag)("discord presence: connected");
                self.push();
            }
            // a rejected activity is usually the buttons: drop them and try once more
            Some("ERROR") => {
                let data = msg.get("data").filter(|d| crate::js::truthy(d)).cloned().unwrap_or_else(|| json!({}));
                (self.diag)(&format!("discord presence: {}", crate::js::stringify(&data, "")));
                if !self.drop_buttons {
                    self.drop_buttons = true;
                    self.sent_at = 0.0;
                    self.push();
                }
            }
            _ => {}
        }
    }

    fn push(&mut self) {
        let Some(a) = self.activity.clone().filter(|_| self.ready && self.conn.is_some()) else { return };
        let wait = MIN_UPDATE_MS - (now_ms() - self.sent_at);
        if wait > 0.0 {
            if self.flush_at.is_none() {
                self.flush_at = Some(Instant::now() + Duration::from_millis(wait as u64));
            }
            return;
        }
        self.sent_at = now_ms();
        let nonce = format!("{}-{}", self.sent_at, uuid::Uuid::new_v4().simple());
        let frame = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": discord_activity(&a, self.started_at, self.drop_buttons) },
            "nonce": nonce,
        });
        self.write(&encode_frame(OP_FRAME, &frame));
    }

    fn tick(&mut self) {
        if self.retry_at.is_some_and(|t| Instant::now() >= t) {
            self.retry_at = None;
            self.connect();
        }
        if self.flush_at.is_some_and(|t| Instant::now() >= t) {
            self.flush_at = None;
            self.push();
        }
        let Some(c) = self.conn.as_mut() else { return };
        match c.read_available() {
            Ok(bytes) if bytes.is_empty() => {}
            Ok(bytes) => {
                self.buf.extend_from_slice(&bytes);
                for (op, msg) in take_frames(&mut self.buf) {
                    self.on_frame(op, msg.unwrap_or(Value::Null));
                }
            }
            Err(_) => self.on_disconnect(),
        }
    }
}

impl Presence {
    /// The status for this Discord application, off until `start`.
    pub fn new(client_id: &str, diag: Box<dyn Fn(&str) + Send>) -> Presence {
        let (tx, rx) = channel::<Cmd>();
        let mut st = State {
            client_id: client_id.into(),
            diag,
            conn: None,
            ready: false,
            enabled: false,
            buf: Vec::new(),
            activity: None,
            sent_at: 0.0,
            retry_at: None,
            flush_at: None,
            started_at: now_ms(),
            drop_buttons: false,
        };
        let thread = std::thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || loop {
                match rx.recv_timeout(TICK) {
                    Ok(Cmd::Start) => {
                        if !st.client_id.is_empty() && !st.enabled {
                            st.enabled = true;
                            st.connect();
                        }
                    }
                    Ok(Cmd::Stop) => {
                        st.enabled = false;
                        st.retry_at = None;
                        st.flush_at = None;
                        st.teardown();
                    }
                    Ok(Cmd::Set(a)) => {
                        st.activity = Some(a);
                        st.push();
                    }
                    Ok(Cmd::Quit) | Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
                st.tick();
            })
            .ok();
        Presence { tx, thread }
    }

    pub fn start(&self) {
        let _ = self.tx.send(Cmd::Start);
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Cmd::Stop);
    }

    /// What Discord should show; coalesced, so a caller may set it on every view change.
    pub fn set(&self, activity: Value) {
        let _ = self.tx.send(Cmd::Set(activity));
    }
}

impl Drop for Presence {
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Quit);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
