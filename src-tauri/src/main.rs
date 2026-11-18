//! Dota 2 Mod Manager under Tauri.
//!
//! The window is the React page in renderer/, built to out/renderer-tauri, with window.api:
//! preload.js runs in the page against src/bridge.js. The title bar's buttons are the shell's
//! (src/native.rs); every other call is the Rust owner's (src/backend.rs, mm_core::owner).

// no console window behind the app in a release build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod command_line;
mod harness;
mod host_open;
mod icons;
mod native;
mod ported;
mod shell;
mod uninstall;
mod update;
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

fn trace_ipc() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("MM_IPC_TRACE").is_some_and(|v| v == "1"))
}

/// ipcRenderer.invoke: the title bar's buttons answered here, everything else by the owner.
#[tauri::command]
async fn mm_invoke(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    owner: tauri::State<'_, Owner>,
    channel: String,
    args: Value,
) -> Result<tauri::ipc::Response, String> {
    if !uninstall::allowed(window.label(), &channel) {
        eprintln!("[mm-shell] ipc: refused {channel} from the removal window");
        return Err("refused: not the removal's".into());
    }
    let owner = owner.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
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
        // item pictures go to the page as mm-icon addresses, not as data URIs (src/icons.rs)
        let res = res.map(|a| match a {
            Answer::Json(s) => Answer::Json(app.state::<icons::Icons>().rewrite(&channel, s)),
            other => other,
        });
        after(&app, &channel, &list, res.is_ok());
        // MM_IPC_TRACE=1: every channel's time on stderr, for measuring the window's waits
        if trace_ipc() {
            eprintln!("[mm-ipc] {channel} {:.1}ms", started.elapsed().as_secs_f64() * 1000.0);
        }
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
fn mm_send(window: tauri::WebviewWindow, owner: tauri::State<'_, Owner>, channel: String, args: Value) {
    if !uninstall::allowed(window.label(), &channel) {
        return;
    }
    let list = args_of(args);
    if let Some(why) = mm_core::channel_args::check_args(&channel, &list) {
        eprintln!("[mm-shell] ipc: refused {channel}: {why}");
        return;
    }
    owner.0.send(&channel, list);
}

/// The page has loaded: Electron's 'did-finish-load' (the game watch, a cold link).
#[tauri::command]
fn mm_loaded(owner: tauri::State<'_, Owner>, window: tauri::WebviewWindow, harness: tauri::State<'_, Harnessed>) {
    owner.0.loaded();
    if let Some(h) = &harness.0 {
        harness::loaded(h, &window);
    }
}

/// MM_SHOT's run, when this is one (src-tauri/src/harness.rs).
struct Harnessed(Option<harness::Harness>);

/// The harness script's answer, written beside MM_SHOT.
#[tauri::command]
fn mm_shot_done(harness: tauri::State<'_, Harnessed>, result: Option<String>, error: Option<String>) {
    if let Some(h) = &harness.0 {
        harness::done(h, result, error);
    }
}

/// A Ctrl key the page passed on: Electron's before-input-event, which scales the content.
#[tauri::command]
fn mm_key(app: tauri::AppHandle, key: String, control: bool, alt: bool) {
    // the removal's window has no scale to keep, and no shell state behind it
    if let Some(shell) = app.try_state::<Arc<window::Shell>>() {
        shell.key(&app, &key, control, alt);
    }
}

/// A press on the title bar (src-tauri/src/bridge.js): the window follows the mouse, or a second
/// press in a row maximizes or restores it. Synchronous, so it runs on the window's own thread
/// while the button is still down.
#[tauri::command]
fn mm_drag(window: tauri::WebviewWindow, toggle: bool) -> Result<(), String> {
    let res = if !toggle {
        window.start_dragging()
    } else if window.is_maximized().unwrap_or(false) {
        window.unmaximize()
    } else {
        window.maximize()
    };
    res.map_err(|e| e.to_string())
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

/// WebView2 takes switches from the environment: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS opens a
/// DevTools port, WEBVIEW2_BROWSER_EXECUTABLE_FOLDER loads another browser, and
/// WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER attaches a debugger. Any of them lets another program on the
/// machine run its own code in the window, and the window can write the game. A release build
/// drops them all; a checkout's build keeps them for tools/dev/tauri-shot.mjs.
fn webview_switch(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|n| n.to_ascii_uppercase().starts_with("WEBVIEW2_"))
}

fn main() {
    if !cfg!(debug_assertions) {
        // before any thread starts, so nothing reads the environment while it changes
        let switches: Vec<_> = std::env::vars_os().map(|(k, _)| k).filter(|k| webview_switch(k)).collect();
        for name in switches {
            std::env::remove_var(name);
        }
    }
    let argv: Vec<String> = std::env::args().collect();
    // The bare exe is the portable build: its data lives beside it and it fetches a new version
    // beside itself rather than installing one (src/portable_update.rs). A checkout's build is not.
    let portable = std::env::current_exe()
        .ok()
        .filter(|_| !cfg!(debug_assertions))
        .and_then(|exe| mm_core::portable_update::portable_dir_of(&exe));
    mm_core::portable_update::set_portable_dir(portable.clone());

    let context = tauri::generate_context!();
    // --apply, --list, --disable-all: run to an exit code before any window or tray exists, and
    // before the single-instance plugin would hand the line to an open copy (src/command_line.rs)
    if let Some(code) = command_line::run(&argv, portable.as_deref(), &context) {
        std::process::exit(code);
    }

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Pending::default())
        .manage(Harnessed(harness::wanted(flag(&argv, "write-jail").is_some(), |k| std::env::var(k).ok())))
        .invoke_handler(tauri::generate_handler![mm_invoke, mm_send, mm_loaded, mm_key, mm_drag, mm_shot_done])
        // the catalog's pictures, which bridge.js points the page's images at
        .register_asynchronous_uri_scheme_protocol(mm_core::preview_cache::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let path = req.uri().path().to_string();
            std::thread::spawn(move || {
                let ud = app.state::<ported::UserData>().0.clone();
                responder.respond(app.state::<ported::Shared>().picture(&ud, &path));
            });
        })
        // the pictures src/icons.rs took out of the picture channels' answers
        .register_asynchronous_uri_scheme_protocol(icons::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let path = req.uri().path().to_string();
            std::thread::spawn(move || responder.respond(app.state::<icons::Icons>().respond(&path)));
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            // the same folder the command line finds (src/command_line.rs)
            let user_data = command_line::user_data_dir(&argv, portable.as_deref(), &app.config().identifier);
            app.manage(ported::UserData(user_data.clone()));
            app.manage(ported::Shared::new());
            app.manage(icons::Icons::default());
            let first_run = !user_data.join("settings.json").exists();
            let area = window::work_area(app);
            // the shell's process writes the game itself, so a sandbox run holds it to the folder
            mm_core::write_jail::install(&mm_core::write_jail::from_argv(&argv));
            // its own settings and library too: outside the jail they are the installed app's
            mm_core::write_jail::refuse_outside("user data", &user_data)?;
            let owner = Arc::new(Backend(backend::start_owner(
                &handle,
                backend::Start {
                    user_data: user_data.clone(),
                    app_version: app.package_info().version.to_string(),
                    app_root: app_root(app),
                    downloads: app.path().download_dir().unwrap_or_default(),
                    argv: argv.clone(),
                    first_run,
                    // a packaged build updates itself; a checkout's build and a sandbox run do not
                    // (src/main.ts: the updater keeps its cache outside any sandbox)
                    updates: !cfg!(debug_assertions) && flag(&argv, "write-jail").is_none(),
                },
            )));
            app.manage(Owner(owner.clone()));
            // Linux: the .desktop entry that tells the desktop this program opens d2mm:// links and
            // presets, pointing at the AppImage the person ran (src/deep-links.ts). A jailed run
            // writes nothing outside its folder.
            if cfg!(target_os = "linux") && flag(&argv, "write-jail").is_none() {
                let exe = std::env::var("APPIMAGE")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .or_else(|| std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()));
                if let (Some(exe), Some(home)) = (exe, std::env::var_os("HOME")) {
                    let icon = app_root(app).join("build").join("icon.png");
                    let o = owner.0.get().clone();
                    mm_core::deep_links::install_desktop_entry(
                        std::env::consts::OS,
                        &exe,
                        &PathBuf::from(home),
                        icon.exists().then_some(icon.as_path()),
                        &|m| o.diag(m),
                        &mm_core::deep_links::refresh_desktop_database,
                    );
                }
            }
            // the uninstaller's run: its one window and nothing else, no tray (src/main.ts)
            if mm_core::uninstall::is_uninstall_run(&argv) {
                uninstall::open(app, std::env::var_os("MM_QUIET").is_some())?;
                return Ok(());
            }
            let jailed = flag(&argv, "write-jail").is_some();
            let user_data_for_webview = user_data.clone();
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
                        portable.is_some(),
                        jailed,
                    ),
                    init_script: init_script(),
                    // WebView2 keeps its cache beside the data too, not in %LOCALAPPDATA%
                    webview_data: portable.as_ref().map(|_| user_data_for_webview.join("webview")),
                },
            )?;
            Ok(())
        })
        .build(context)
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

    #[test]
    fn every_webview_switch_is_dropped_and_nothing_else() {
        for name in [
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "webview2_browser_executable_folder",
            "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER",
        ] {
            assert!(webview_switch(std::ffi::OsStr::new(name)), "{name}");
        }
        for name in ["PATH", "MM_SHOT", "XWEBVIEW2_X", "WEBVIEW2"] {
            assert!(!webview_switch(std::ffi::OsStr::new(name)), "{name}");
        }
    }

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
