//! The TypeScript main process (src-tauri/host/host.ts), run under Node behind the shell.
//!
//! Every channel Rust does not answer itself (src/native.rs) is written to the host's stdin and
//! its answer read back from stdout. The host also sends events for the window and asks the
//! shell for what only it can do: dialogs, links, the window itself (src/shell.rs). The wire
//! format is described at the top of host.ts.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const MARK: &str = "\u{1}MM ";

type Reply = std::sync::mpsc::Sender<Result<Value, String>>;

pub struct Sidecar {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, Reply>>,
    next: AtomicU64,
    dead: AtomicBool,
    /// the channels the host registered, once it says it is ready
    ready: (Mutex<Option<Vec<String>>>, Condvar),
}

/// Where the host and the tree it runs (src/, node_modules/) are.
pub struct HostPaths {
    pub node: PathBuf,
    pub script: PathBuf,
    pub root: PathBuf,
}

impl Sidecar {
    pub fn start(
        app: AppHandle,
        paths: HostPaths,
        env: Vec<(String, String)>,
        args: Vec<String>,
    ) -> std::io::Result<Arc<Self>> {
        let mut cmd = Command::new(&paths.node);
        cmd.arg("--disable-warning=ExperimentalWarning")
            .arg(&paths.script)
            .args(&args)
            .current_dir(&paths.root)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("piped stdout");
        let me = Arc::new(Sidecar {
            stdin: Mutex::new(stdin),
            child: Mutex::new(Some(child)),
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            dead: AtomicBool::new(false),
            ready: (Mutex::new(None), Condvar::new()),
        });
        let reader = me.clone();
        std::thread::Builder::new().name("mm-host-reader".into()).spawn(move || reader.read_loop(app, stdout))?;
        Ok(me)
    }

    fn write(&self, msg: &Value) {
        let mut guard = self.stdin.lock().unwrap();
        if let Some(stdin) = guard.as_mut() {
            let mut line = msg.to_string();
            line.push('\n');
            if stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).is_err() {
                *guard = None;
            }
        }
    }

    /// Block until the host has registered its channels (or a minute has gone by).
    pub fn wait_ready(&self) -> Option<Vec<String>> {
        let (lock, cv) = &self.ready;
        let guard = lock.lock().unwrap();
        let (guard, _) = cv.wait_timeout_while(guard, Duration::from_secs(60), |r| r.is_none()).unwrap();
        guard.clone()
    }

    /// Call one of the host's channels and wait for its answer. Runs on a blocking thread.
    pub fn invoke(&self, channel: &str, args: Value) -> Result<Value, String> {
        if self.wait_ready().is_none() {
            return Err("the TypeScript host did not start".into());
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if self.dead.load(Ordering::SeqCst) {
                return Err("the TypeScript host exited".into());
            }
            pending.insert(id, tx);
        }
        self.write(&json!({ "t": "invoke", "id": id, "channel": channel, "args": args }));
        rx.recv().unwrap_or_else(|_| Err("the TypeScript host went away".into()))
    }

    pub fn send(&self, channel: &str, args: Value) {
        self.write(&json!({ "t": "send", "channel": channel, "args": args }));
    }

    pub fn notify(&self, msg: Value) {
        self.write(&msg);
    }

    pub fn stop(&self) {
        self.write(&json!({ "t": "quit" }));
        std::thread::sleep(Duration::from_millis(400));
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }

    fn read_loop(self: Arc<Self>, app: AppHandle, stdout: std::process::ChildStdout) {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Some(body) = line.strip_prefix(MARK) else {
                // a library printing to stdout: keep it, but out of the protocol
                eprintln!("[host] {line}");
                continue;
            };
            let Ok(msg) = serde_json::from_str::<Value>(body) else { continue };
            match msg["t"].as_str() {
                Some("result") => {
                    let id = msg["id"].as_u64().unwrap_or(0);
                    if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                        let res = if msg["ok"].as_bool() == Some(true) {
                            Ok(msg["value"].clone())
                        } else {
                            Err(msg["error"].as_str().unwrap_or("error").to_string())
                        };
                        let _ = tx.send(res);
                    }
                }
                Some("event") => {
                    let _ = app.emit("mm", json!({ "channel": msg["channel"], "args": msg["args"] }));
                }
                Some("request") => {
                    let me = self.clone();
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let id = msg["id"].clone();
                        let method = msg["method"].as_str().unwrap_or("").to_string();
                        let args = msg["args"].as_array().cloned().unwrap_or_default();
                        let reply = match crate::shell::request(&app, &method, &args) {
                            Ok(value) => json!({ "t": "reply", "id": id, "ok": true, "value": value }),
                            Err(error) => json!({ "t": "reply", "id": id, "ok": false, "error": error }),
                        };
                        me.write(&reply);
                    });
                }
                Some("ready") => {
                    let channels = msg["channels"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let (lock, cv) = &self.ready;
                    *lock.lock().unwrap() = Some(channels);
                    cv.notify_all();
                }
                _ => {}
            }
        }
        // the host is gone: nothing waiting will ever be answered
        let mut pending = self.pending.lock().unwrap();
        self.dead.store(true, Ordering::SeqCst);
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err("the TypeScript host exited".into()));
        }
        drop(pending);
        let (lock, cv) = &self.ready;
        let mut r = lock.lock().unwrap();
        if r.is_none() {
            *r = Some(Vec::new());
        }
        cv.notify_all();
    }
}
