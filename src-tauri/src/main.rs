//! Dota 2 Mod Manager under Tauri.
//!
//! The window is the same React page Electron loads (renderer/, built to out/renderer-tauri),
//! with the same window.api: preload.js itself runs in the page against src/bridge.js. The title
//! bar's buttons are the shell's (src/native.rs); every other call is the Rust owner's
//! (src/backend.rs, mm_core::owner). docs/rust-migration.md has how it got here.

// no console window behind the app in a release build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod native;
mod ported;
mod shell;
mod window;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::Manager;

use backend::{Answer, Backend};

/// The owner, as the commands reach it.
struct Owner(Arc<Backend>);

fn args_of(v: Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a,
        Value::Null => Vec::new(),
        other => vec![other],
    }
}

/// An answer for the page. One that is only bytes (a 3D preview's slice, a video) goes back raw,
/// as an ArrayBuffer instead of base64 inside JSON. Any other answer goes as the owner wrote it,
/// unparsed; one with bytes deeper inside is wrapped as {"$mmb": ...} so the bridge knows to
/// decode it, and the rest is not walked again at all.
fn answer(a: Answer) -> Result<tauri::ipc::Response, String> {
    match a {
        Answer::Json(s) => Ok(tauri::ipc::Response::new(s)),
        Answer::Bytes(s) => {
            // JSON.stringify writes base64 without escapes, so the whole answer {"$b64":"..."} is plain
            if let Some(b64) = s.strip_prefix("{\"$b64\":\"").and_then(|r| r.strip_suffix("\"}")) {
                if !b64.contains('"') {
                    use base64::Engine;
                    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
                    return Ok(tauri::ipc::Response::new(bytes));
                }
            }
            Ok(tauri::ipc::Response::new(format!("{{\"$mmb\":{s}}}")))
        }
    }
}

/// ipcRenderer.invoke: the title bar's buttons answered here, everything else by the owner.
#[tauri::command]
async fn mm_invoke(
    app: tauri::AppHandle,
    owner: tauri::State<'_, Owner>,
    channel: String,
    args: Value,
) -> Result<tauri::ipc::Response, String> {
    let owner = owner.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let list = args_of(args);
        // what the channel may be handed, before anything acts on it (src/window-guard.ts)
        if let Some(why) = mm_core::channel_args::check_args(&channel, &list) {
            eprintln!("[mm-shell] ipc: refused {channel}: {why}");
            return Err(format!("refused: {why}"));
        }
        let res = match native::window(&app, &channel) {
            Some(res) => res.map(|v| Answer::Json(v.to_string())),
            None => owner.invoke(&channel, list.clone()),
        };
        after(&app, &channel, &list, res.is_ok());
        answer(res?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the shell does after the owner answered a channel it also cares about: the scale the page
/// set, and the tray after its switch or the language changed.
fn after(app: &tauri::AppHandle, channel: &str, args: &[Value], ok: bool) {
    let Some(shell) = app.try_state::<Arc<window::Shell>>() else { return };
    match channel {
        "ui:setZoom" if ok => shell.set_zoom(mm_core::main_window::clamp_zoom(args.first().unwrap_or(&Value::Null))),
        "settings:set" if ok && matches!(args.first().and_then(Value::as_str), Some("runInBackground" | "uiLang")) => {
            shell.sync(app)
        }
        _ => {}
    }
}

/// ipcRenderer.send: no answer.
#[tauri::command]
fn mm_send(owner: tauri::State<'_, Owner>, channel: String, args: Value) {
    let list = args_of(args);
    if let Some(why) = mm_core::channel_args::check_args(&channel, &list) {
        eprintln!("[mm-shell] ipc: refused {channel}: {why}");
        return;
    }
    owner.0.send(&channel, list);
}

/// The page has loaded: Electron's 'did-finish-load' (the game watch, a cold link).
#[tauri::command]
fn mm_loaded(owner: tauri::State<'_, Owner>) {
    owner.0.loaded();
}

/// A Ctrl key the page passed on: Electron's before-input-event, which scales the content.
#[tauri::command]
fn mm_key(app: tauri::AppHandle, shell: tauri::State<'_, Arc<window::Shell>>, key: String, control: bool, alt: bool) {
    shell.key(&app, &key, control, alt);
}

/// `--name=value` from the command line.
fn flag(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    args.iter().find_map(|a| a.strip_prefix(&prefix).map(String::from))
}

/// Where the build's own files are (the changelogs, the counter's token): a checkout's repository
/// in a debug build, the bundled copy in an install.
fn app_root(app: &tauri::App) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    } else {
        app.path().resource_dir().map(|d| d.join("app")).unwrap_or_default()
    }
}

fn init_script() -> String {
    // preload.js is CommonJS for Electron's sandboxed preload: `require` is the bridge's
    format!(
        "{}\n;(function (require) {{\n{}\n}})(window.__mmRequire);\n",
        include_str!("bridge.js"),
        include_str!("../../preload.js")
    )
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // the uninstaller's run: a copy in the tray gives way to it (src/tray.ts lockOnceFreed)
            if argv.iter().any(|a| a == "--uninstall") {
                if let Some(shell) = app.try_state::<Arc<window::Shell>>() {
                    shell.quitting();
                }
                app.exit(0);
                return;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            // a preset or mod link clicked while the app runs (src/deep-links.ts)
            if let Some(owner) = app.try_state::<Owner>() {
                owner.0.second(argv);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![mm_core::tray::BACKGROUND_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![mm_invoke, mm_send, mm_loaded, mm_key])
        // the catalog's pictures, which bridge.js points the page's images at
        .register_asynchronous_uri_scheme_protocol(mm_core::preview_cache::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let path = req.uri().path().to_string();
            std::thread::spawn(move || {
                let ud = app.state::<ported::UserData>().0.clone();
                responder.respond(app.state::<ported::Shared>().picture(&ud, &path));
            });
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let user_data = flag(&argv, "user-data-dir")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("Dota 2 Mod Manager")))
                .unwrap_or_else(|| app.path().app_data_dir().unwrap_or_default());
            let user_data = std::path::absolute(&user_data).unwrap_or(user_data);
            app.manage(ported::UserData(user_data.clone()));
            app.manage(ported::Shared::new());
            let first_run = !user_data.join("settings.json").exists();
            let area = window::work_area(app);
            // the shell's process writes the game itself, so a sandbox run holds it to the folder
            mm_core::write_jail::install(&mm_core::write_jail::from_argv(&argv));
            let owner = Arc::new(Backend(backend::start_owner(
                &handle,
                backend::Start {
                    user_data: user_data.clone(),
                    app_version: app.package_info().version.to_string(),
                    app_root: app_root(app),
                    downloads: app.path().download_dir().unwrap_or_default(),
                    argv: argv.clone(),
                    first_run,
                },
            )));
            app.manage(Owner(owner.clone()));
            let jailed = flag(&argv, "write-jail").is_some();
            window::open(
                app,
                owner,
                window::Open {
                    user_data,
                    area,
                    first_run,
                    quiet: std::env::var_os("MM_QUIET").is_some() || mm_core::tray::started_hidden(&argv),
                    login_allowed: mm_core::tray::login_item_allowed(
                        cfg!(windows),
                        !cfg!(debug_assertions),
                        false,
                        jailed,
                    ),
                    init_script: init_script(),
                },
            )?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Tauri shell failed to build")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(owner) = app.try_state::<Owner>() {
                    owner.0.stop();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    fn body(a: Answer) -> InvokeResponseBody {
        answer(a).unwrap().body().unwrap()
    }

    #[test]
    fn bytes_alone_go_back_raw_and_the_rest_as_written() {
        assert!(
            matches!(body(Answer::Bytes(r#"{"$b64":"AQID"}"#.into())), InvokeResponseBody::Raw(ref b) if b == &[1, 2, 3])
        );
        let nested = body(Answer::Bytes(r#"{"ok":true,"data":{"$b64":"AQID"}}"#.into()));
        assert!(
            matches!(nested, InvokeResponseBody::Json(ref s) if s == r#"{"$mmb":{"ok":true,"data":{"$b64":"AQID"}}}"#)
        );
        assert!(matches!(body(Answer::Json("[1,2]".into())), InvokeResponseBody::Json(ref s) if s == "[1,2]"));
        assert!(answer(Answer::Bytes(r#"{"$b64":"not base64!"}"#.into())).is_err());
    }
}
