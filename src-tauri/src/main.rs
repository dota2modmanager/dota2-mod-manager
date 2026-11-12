//! Dota 2 Mod Manager under Tauri.
//!
//! The window is the same React page Electron loads (renderer/, built to out/renderer-tauri),
//! with the same window.api: preload.js itself runs in the page against src/bridge.js. Each call
//! is answered by Rust when the channel has moved (src/native.rs, src/ported.rs) and by the
//! TypeScript main process otherwise, which runs under Node as a child (src/sidecar.rs).
//! docs/rust-migration.md tracks which is which.

// no console window behind the app in a release build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native;
mod ported;
mod shell;
mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use sidecar::{Answer, HostPaths, Sidecar};

struct Host(Arc<Sidecar>);

fn args_of(v: Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a,
        Value::Null => Vec::new(),
        other => vec![other],
    }
}

/// An answer for the page. One that is only bytes (a 3D preview's slice, a video) goes back raw,
/// as an ArrayBuffer instead of base64 inside JSON. Any other answer goes as the host wrote it,
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

/// ipcRenderer.invoke: Rust's answer when the channel is Rust's, the host's otherwise.
#[tauri::command]
async fn mm_invoke(
    app: tauri::AppHandle,
    host: tauri::State<'_, Host>,
    channel: String,
    args: Value,
) -> Result<tauri::ipc::Response, String> {
    let host = host.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let list = args_of(args);
        let res = match native::handle(&app, &channel, &list) {
            Some(res) => res.map(|v| Answer::Json(v.to_string())),
            None => host.invoke(&channel, Value::Array(list)),
        };
        answer(res?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ipcRenderer.send: no answer.
#[tauri::command]
fn mm_send(host: tauri::State<'_, Host>, channel: String, args: Value) {
    host.0.send(&channel, Value::Array(args_of(args)));
}

/// The page has loaded: the host's 'did-finish-load' listeners run (the game watch, a cold link).
#[tauri::command]
fn mm_loaded(host: tauri::State<'_, Host>) {
    host.0.notify(json!({ "t": "loaded" }));
}

/// A Ctrl key the page passed on: Electron's before-input-event, which scales the content.
#[tauri::command]
fn mm_key(host: tauri::State<'_, Host>, key: String, control: bool, alt: bool) {
    host.0.notify(json!({ "t": "key", "input": { "type": "keyDown", "key": key, "control": control, "alt": alt } }));
}

/// `--name=value` from the command line.
fn flag(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    args.iter().find_map(|a| a.strip_prefix(&prefix).map(String::from))
}

fn host_paths(app: &tauri::App) -> HostPaths {
    // a checkout: the repository this binary was built in; an install: the bundled copy
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    } else {
        app.path().resource_dir().map(|d| d.join("app")).unwrap_or_default()
    };
    let bundled_node =
        app.path().resource_dir().ok().map(|d| d.join("node").join(if cfg!(windows) { "node.exe" } else { "node" }));
    let node = std::env::var_os("MM_NODE")
        .map(PathBuf::from)
        .or(bundled_node.filter(|p| p.exists()))
        .unwrap_or_else(|| PathBuf::from("node"));
    HostPaths { node, script: root.join("src-tauri").join("host").join("host.ts"), root }
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
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![mm_invoke, mm_send, mm_loaded, mm_key])
        .setup(move |app| {
            let handle = app.handle().clone();
            let user_data = flag(&argv, "user-data-dir")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("Dota 2 Mod Manager")))
                .unwrap_or_else(|| app.path().app_data_dir().unwrap_or_default());
            let user_data = std::path::absolute(&user_data).unwrap_or(user_data);
            let env = vec![
                ("MM_USER_DATA".to_string(), user_data.to_string_lossy().into_owned()),
                ("MM_APP_VERSION".to_string(), app.package_info().version.to_string()),
                ("MM_PACKAGED".to_string(), if cfg!(debug_assertions) { "0" } else { "1" }.to_string()),
                ("MM_SHELL".to_string(), "tauri".to_string()),
            ];
            // the switches src/main.ts reads off its own command line (--write-jail, --background...)
            let pass: Vec<String> = argv.iter().skip(1).filter(|a| a.starts_with("--")).cloned().collect();
            let host = Sidecar::start(handle.clone(), host_paths(app), env, pass)?;
            app.manage(Host(host));

            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Dota 2 Mod Manager")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1020.0, 640.0)
                .decorations(false)
                .background_color(tauri::window::Color(5, 5, 6, 255))
                .initialization_script(init_script())
                .center()
                .build()?;
            let events = handle.clone();
            let w = win.clone();
            win.on_window_event(move |e| {
                if let WindowEvent::Resized(_) = e {
                    let max = w.is_maximized().unwrap_or(false);
                    let _ = events.emit("mm", json!({ "channel": "win:maximized", "args": [max] }));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the Tauri shell failed to build")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(host) = app.try_state::<Host>() {
                    host.0.stop();
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
