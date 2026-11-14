//! Who answers the window: the TypeScript main process under Node (src/sidecar.rs), or, with
//! `MM_RUST_OWNS=1`, the Rust owner of the state (mm_core::owner), which answers every channel the
//! TypeScript registers, so no Node process is started at all (docs/rust-migration.md, step 2).

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::{Answer, Sidecar};
use mm_core::owner::Owner;

/// Whether this run puts the state in Rust's hands.
pub fn rust_owns() -> bool {
    std::env::var("MM_RUST_OWNS").is_ok_and(|v| v == "1")
}

pub enum Backend {
    Host(Arc<Sidecar>),
    Owner(Arc<Owned>),
}

/// The owner, once its start is over: it runs off the main thread, so the window opens at once
/// and a call made while the owner is starting waits for it. The link the app was started by
/// waits for the page's first load.
#[derive(Default)]
pub struct Owned(OnceLock<Arc<Owner>>, std::sync::Mutex<Option<String>>);

impl Owned {
    pub fn get(&self) -> &Arc<Owner> {
        self.0.wait()
    }
}

/// What the owner asks of the shell and tells the window.
struct TauriShell(AppHandle);

impl mm_core::owner::Shell for TauriShell {
    fn event(&self, channel: &str, args: Vec<Value>) {
        let _ = self.0.emit("mm", json!({ "channel": channel, "args": args }));
    }

    fn request(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        let window = || self.0.get_webview_window("main").ok_or_else(|| "no main window".to_string());
        match method {
            "win.isMaximized" => Ok(json!(window()?.is_maximized().unwrap_or(false))),
            "win.report" => Ok(report(&self.0)),
            "app.updateInstall" => Err("the updater is not wired yet".into()),
            _ => crate::shell::request(&self.0, method, &args),
        }
    }
}

/// For the support report: the window, the screens, the updater, as src/ipc-diagnostics.ts
/// gathers them from Electron. The graphics card is not known here.
fn report(app: &AppHandle) -> Value {
    let windows: Vec<Value> = app
        .webview_windows()
        .values()
        .map(|w| {
            let k = w.scale_factor().unwrap_or(1.0);
            let size = w.outer_size().map(|s| s.to_logical::<f64>(k)).ok();
            json!({
                "id": w.label(),
                "width": size.map(|s| s.width.round()),
                "height": size.map(|s| s.height.round()),
                "visible": w.is_visible().unwrap_or(false),
                "focused": w.is_focused().unwrap_or(false),
                "maximized": w.is_maximized().unwrap_or(false),
                "minimized": w.is_minimized().unwrap_or(false),
                "url": w.url().map(|u| u.to_string()).unwrap_or_default(),
                "crashed": false,
            })
        })
        .collect();
    let primary = app.primary_monitor().ok().flatten().map(|m| m.name().cloned());
    let displays: Vec<Value> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let k = m.scale_factor();
            let (s, a) = (m.size().to_logical::<f64>(k), m.work_area());
            json!({
                "id": m.name(),
                "primary": primary.as_ref() == Some(&m.name().cloned()),
                "size": { "width": s.width.round(), "height": s.height.round() },
                "workArea": {
                    "x": (a.position.x as f64 / k).round(), "y": (a.position.y as f64 / k).round(),
                    "width": (a.size.width as f64 / k).round(), "height": (a.size.height as f64 / k).round(),
                },
                "scaleFactor": k,
            })
        })
        .collect();
    json!({ "windows": windows, "displays": displays, "gpu": null, "updater": { "available": false, "lastError": null } })
}

/// The system's languages, most wanted first, as Electron's app.getPreferredSystemLanguages gives
/// them; `MM_LOCALE` stands in for them in a test run.
fn system_languages() -> Vec<String> {
    if let Ok(l) = std::env::var("MM_LOCALE") {
        return vec![l];
    }
    let all: Vec<String> = sys_locale::get_locales().collect();
    if all.is_empty() {
        vec!["en-US".into()]
    } else {
        all
    }
}

/// How the owner starts under the shell.
pub struct Start {
    pub user_data: PathBuf,
    pub app_version: String,
    pub app_root: PathBuf,
    pub downloads: PathBuf,
    pub argv: Vec<String>,
    pub first_run: bool,
}

/// The owner started on a thread of its own; the watches and the start's fetches follow once it is up.
pub fn start_owner(app: &AppHandle, s: Start) -> Arc<Owned> {
    let owned = Arc::new(Owned::default());
    *owned.1.lock().unwrap_or_else(|e| e.into_inner()) = mm_core::owner_links::first(&s.argv);
    let (cell, app) = (owned.clone(), app.clone());
    std::thread::spawn(move || {
        let opts = mm_core::owner::Options {
            user_data: s.user_data,
            app_version: s.app_version,
            app_root: s.app_root,
            downloads: s.downloads,
            uninstall: mm_core::uninstall::is_uninstall_run(&s.argv),
            system_languages: s.first_run.then(system_languages),
            find_game: Box::new(mm_core::steam::find_dota_game_path),
            dota_running: Box::new(mm_core::game_watch::dota_is_running),
            now: mm_core::net_fetch::now_ms,
        };
        let owner = Owner::start(opts, Arc::new(TauriShell(app)));
        mm_core::owner_watch::start(&owner);
        mm_core::owner_watch::start_patch(&owner);
        mm_core::owner_start::refresh(&owner);
        mm_core::owner_presence::start(&owner);
        let _ = cell.0.set(owner);
    });
    owned
}

/// An owner's answer as the page takes it: bytes inside go as {$b64}, which the bridge decodes.
fn answer_of(v: Value) -> Answer {
    let s = v.to_string();
    if s.contains("\"$b64\"") {
        Answer::Bytes(s)
    } else {
        Answer::Json(s)
    }
}

impl Backend {
    /// ipcRenderer.invoke, its arguments already checked.
    pub fn invoke(&self, channel: &str, args: Vec<Value>) -> Result<Answer, String> {
        match self {
            Backend::Host(h) => h.invoke(channel, Value::Array(args)),
            Backend::Owner(o) => match o.get().invoke(channel, &args) {
                Some(r) => r.map(answer_of),
                None => Err(format!("No handler registered for '{channel}'")),
            },
        }
    }

    /// ipcRenderer.send: no answer.
    pub fn send(&self, channel: &str, args: Vec<Value>) {
        match self {
            Backend::Host(h) => h.send(channel, Value::Array(args)),
            Backend::Owner(o) => {
                let _ = o.get().invoke(channel, &args);
            }
        }
    }

    /// The page finished loading: the game watch tells it afresh.
    pub fn loaded(&self) {
        match self {
            Backend::Host(h) => h.notify(json!({ "t": "loaded" })),
            Backend::Owner(o) => {
                mm_core::owner_watch::page_loaded(o.get());
                // launched BY a link: the page has to exist before it can be told
                if let Some(cold) = o.1.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    mm_core::owner_links::take(o.get(), Some(&cold));
                }
            }
        }
    }

    /// The shell hid the window in the tray: the hint is not shown again.
    pub fn hidden(&self) {
        match self {
            Backend::Host(h) => h.notify(json!({ "t": "hidden" })),
            Backend::Owner(o) => {
                let o = o.get();
                let mut c = o.core();
                if !c.settings.get("trayHintSeen").is_some_and(mm_core::js::truthy) {
                    let _ = c.settings.set("trayHintSeen", json!(true));
                }
                drop(c);
                o.diag("window hidden in the tray");
            }
        }
    }

    /// A second start handed its command line over (a d2mm:// link).
    pub fn second(&self, argv: Vec<String>) {
        match self {
            Backend::Host(h) => h.notify(json!({ "t": "second", "argv": argv })),
            Backend::Owner(o) => mm_core::owner_links::take(o.get(), mm_core::owner_links::first(&argv).as_deref()),
        }
    }

    pub fn stop(&self) {
        match self {
            Backend::Host(h) => h.stop(),
            Backend::Owner(o) => {
                if let Some(w) = o.0.get().and_then(|o| o.patch_watcher.get()) {
                    w.stop();
                }
            }
        }
    }
}
