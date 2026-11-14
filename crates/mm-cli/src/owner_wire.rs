//! `mm-cli owner --user-data-dir=<dir> [--write-jail=<dir>] [--find-game=<path>] [--running]`:
//! mm-core's owner (crates/mm-core/src/owner.rs) on the wire src-tauri/host/host.ts speaks, so
//! test/rust-owner.test.ts can drive the TypeScript main process and the Rust owner with the same
//! lines and compare what each answers, asks and writes.
//!
//! In, one JSON object per line: {t:'invoke', id, channel, args}, {t:'reply', id, ok, value|error}.
//! Out, each line starting with MARK: {t:'ready', channels}, {t:'event', channel, args},
//! {t:'request', id, method, args}, and `R <id> j <json>` / `R <id> e <message>` for an answer.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use mm_core::owner::{Options, Owner, Shell};
use serde_json::{json, Value};

const MARK: &str = "\u{1}MM ";

struct Wire {
    out: Mutex<std::io::Stdout>,
    next: Mutex<u64>,
    waiting: Mutex<HashMap<u64, Sender<Result<Value, String>>>>,
}

impl Wire {
    fn line(&self, text: &str) {
        let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(out, "{MARK}{text}");
        let _ = out.flush();
    }
}

impl Shell for Wire {
    fn event(&self, channel: &str, args: Vec<Value>) {
        self.line(&json!({ "t": "event", "channel": channel, "args": args }).to_string());
    }
    fn request(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        let id = {
            let mut n = self.next.lock().unwrap_or_else(|e| e.into_inner());
            *n += 1;
            *n
        };
        let (tx, rx) = channel();
        self.waiting.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        self.line(&json!({ "t": "request", "id": id, "method": method, "args": args }).to_string());
        rx.recv().map_err(|e| e.to_string())?
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    args.iter().find_map(|a| a.strip_prefix(&prefix).map(String::from))
}

/// The user's home folder, as Node's os.homedir() finds it.
fn home() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from).unwrap_or_default()
}

pub fn run(args: &[String]) -> Result<(), String> {
    let user_data = PathBuf::from(flag(args, "user-data-dir").ok_or("owner: --user-data-dir is required")?);
    mm_core::write_jail::install(&mm_core::write_jail::from_argv(args));
    let find = flag(args, "find-game");
    let running = args.iter().any(|a| a == "--running");
    let wire =
        Arc::new(Wire { out: Mutex::new(std::io::stdout()), next: Mutex::new(0), waiting: Mutex::new(HashMap::new()) });
    let first_run = !user_data.join("settings.json").exists();
    let opts = Options {
        user_data,
        app_version: std::env::var("MM_APP_VERSION").unwrap_or_else(|_| "0.0.0".into()),
        app_root: std::env::current_dir().map_err(|e| e.to_string())?,
        downloads: home().join("Downloads"),
        system_languages: first_run.then(|| vec![std::env::var("MM_LOCALE").unwrap_or_else(|_| "en-US".into())]),
        find_game: Box::new(move || match &find {
            Some(f) if f == "none" => None,
            Some(f) => Some(f.clone()),
            None => mm_core::steam::find_dota_game_path(),
        }),
        dota_running: Box::new(move || running),
        now: mm_core::net_fetch::now_ms,
    };
    let owner = Owner::start(opts, wire.clone());
    wire.line(&json!({ "t": "ready", "channels": Owner::channels() }).to_string());
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        match msg.get("t").and_then(Value::as_str) {
            Some("invoke") => {
                let (owner, wire) = (owner.clone(), wire.clone());
                std::thread::spawn(move || {
                    let id = msg.get("id").cloned().unwrap_or(Value::Null);
                    let channel = msg.get("channel").and_then(Value::as_str).unwrap_or("").to_string();
                    let list = msg.get("args").and_then(Value::as_array).cloned().unwrap_or_default();
                    // what the channel may be handed, before the owner acts on it, as the shell does
                    let checked = match mm_core::channel_args::check_args(&channel, &list) {
                        Some(why) => Some(Err(format!("refused: {why}"))),
                        None => owner.invoke(&channel, &list),
                    };
                    let text = match checked {
                        Some(Ok(v)) => format!("R {id} j {v}"),
                        Some(Err(e)) => format!("R {id} e {}", json!(e)),
                        None => format!("R {id} e {}", json!(format!("no handler for {channel}"))),
                    };
                    wire.line(&text);
                });
            }
            Some("reply") => {
                let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
                if let Some(tx) = wire.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                    let ok = msg.get("ok").is_some_and(|v| v == &Value::Bool(true));
                    let _ = tx.send(if ok {
                        Ok(msg.get("value").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(mm_core::js::string(msg.get("error").unwrap_or(&Value::Null)))
                    });
                }
            }
            Some("log") => wire.line(&json!({ "t": "log", "lines": owner.take_log() }).to_string()),
            _ => {}
        }
    }
    Ok(())
}
