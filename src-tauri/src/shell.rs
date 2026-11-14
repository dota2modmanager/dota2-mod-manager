//! What only the shell can do, asked for by the owner in place of Electron's dialog, shell and
//! BrowserWindow (mm_core::owner::Shell): a file dialog, a link in the browser, the window
//! minimised. Each answer has the shape the Electron call it stands for returns.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

fn str_arg(args: &[Value], i: usize) -> String {
    args.get(i).and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn to_path(p: FilePath) -> String {
    match p {
        FilePath::Path(p) => p.to_string_lossy().into_owned(),
        FilePath::Url(u) => u.to_string(),
    }
}

/// Electron's dialog options, applied to Tauri's file dialog builder.
fn file_dialog(app: &AppHandle, opts: &Value) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file();
    if let Some(w) = app.get_webview_window("main") {
        d = d.set_parent(&w);
    }
    if let Some(t) = opts["title"].as_str() {
        d = d.set_title(t);
    }
    if let Some(p) = opts["defaultPath"].as_str() {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            d = d.set_directory(&pb);
        } else {
            if let Some(dir) = pb.parent().filter(|d| d.is_dir()) {
                d = d.set_directory(dir);
            }
            if let Some(name) = pb.file_name() {
                d = d.set_file_name(name.to_string_lossy());
            }
        }
    }
    if let Some(filters) = opts["filters"].as_array() {
        for f in filters {
            let name = f["name"].as_str().unwrap_or("");
            let exts: Vec<&str> = f["extensions"]
                .as_array()
                .map(|a| a.iter().filter_map(|e| e.as_str()).filter(|e| *e != "*").collect())
                .unwrap_or_default();
            if !exts.is_empty() {
                d = d.add_filter(name, &exts);
            }
        }
    }
    d
}

fn has_prop(opts: &Value, prop: &str) -> bool {
    opts["properties"].as_array().is_some_and(|a| a.iter().any(|p| p.as_str() == Some(prop)))
}

pub fn request(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, String> {
    let window = || app.get_webview_window("main").ok_or_else(|| "no main window".to_string());
    match method {
        "dialog.open" => {
            let opts = args.first().cloned().unwrap_or(Value::Null);
            let dir = has_prop(&opts, "openDirectory");
            let many = has_prop(&opts, "multiSelections");
            let d = file_dialog(app, &opts);
            let picked: Vec<String> = match (dir, many) {
                (true, true) => d.blocking_pick_folders().unwrap_or_default().into_iter().map(to_path).collect(),
                (true, false) => d.blocking_pick_folder().map(to_path).into_iter().collect(),
                (false, true) => d.blocking_pick_files().unwrap_or_default().into_iter().map(to_path).collect(),
                (false, false) => d.blocking_pick_file().map(to_path).into_iter().collect(),
            };
            Ok(json!({ "canceled": picked.is_empty(), "filePaths": picked }))
        }
        "dialog.save" => {
            let opts = args.first().cloned().unwrap_or(Value::Null);
            let picked = file_dialog(app, &opts).blocking_save_file().map(to_path);
            Ok(json!({ "canceled": picked.is_none(), "filePath": picked }))
        }
        "dialog.message" => {
            let opts = args.first().cloned().unwrap_or(Value::Null);
            let buttons: Vec<String> = opts["buttons"]
                .as_array()
                .map(|a| a.iter().filter_map(|b| b.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let mut text = opts["message"].as_str().unwrap_or("").to_string();
            if let Some(detail) = opts["detail"].as_str() {
                text = format!("{text}\n\n{detail}");
            }
            let kind = match opts["type"].as_str() {
                Some("error") => MessageDialogKind::Error,
                Some("warning") | Some("question") => MessageDialogKind::Warning,
                _ => MessageDialogKind::Info,
            };
            let mut d = app.dialog().message(text).kind(kind);
            if let Some(t) = opts["title"].as_str() {
                d = d.title(t);
            }
            let response = if buttons.len() >= 2 {
                d = d.buttons(MessageDialogButtons::OkCancelCustom(buttons[0].clone(), buttons[1].clone()));
                if d.blocking_show() {
                    0
                } else {
                    1
                }
            } else {
                if let Some(b) = buttons.first() {
                    d = d.buttons(MessageDialogButtons::OkCustom(b.clone()));
                }
                d.blocking_show();
                0
            };
            Ok(json!({ "response": response, "checkboxChecked": false }))
        }
        "dialog.error" => {
            app.dialog()
                .message(str_arg(args, 1))
                .title(str_arg(args, 0))
                .kind(MessageDialogKind::Error)
                .blocking_show();
            Ok(Value::Null)
        }
        "shell.openExternal" => {
            let url = str_arg(args, 0);
            if !(url.starts_with("https://")
                || url.starts_with("http://")
                || url.starts_with("steam://")
                || url.starts_with("mailto:"))
            {
                return Err(format!("not a link the app opens: {url}"));
            }
            app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "shell.openPath" => {
            app.opener().open_path(str_arg(args, 0), None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "shell.showItemInFolder" => {
            app.opener().reveal_item_in_dir(str_arg(args, 0)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "win.minimize" => window()?.minimize().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.maximize" => window()?.maximize().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.unmaximize" => window()?.unmaximize().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.show" => {
            let w = window()?;
            let _ = w.unminimize();
            w.show().map(|_| Value::Null).map_err(|e| e.to_string())
        }
        "win.hide" => window()?.hide().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.focus" => window()?.set_focus().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.close" => window()?.close().map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.reload" => window()?.eval("location.reload()").map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.eval" => window()?.eval(str_arg(args, 0)).map(|_| Value::Null).map_err(|e| e.to_string()),
        "win.devtools" => Ok(Value::Null),
        "win.progress" => Ok(Value::Null),
        "app.quit" | "app.exit" => {
            if let Some(s) = app.try_state::<std::sync::Arc<crate::window::Shell>>() {
                s.quitting();
            }
            app.exit(args.first().and_then(|v| v.as_i64()).unwrap_or(0) as i32);
            Ok(Value::Null)
        }
        "app.relaunch" => {
            app.restart();
        }
        _ => Err(format!("the shell has no {method}")),
    }
}
