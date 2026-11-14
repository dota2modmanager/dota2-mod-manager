//! The one window and the tray icon beside it (src/main-window.ts, src/tray.ts, src/background.ts).
//! The logic is mm-core's (`main_window`, `tray`); this is Tauri doing what it answers.
//!
//! The owner holds settings.json, so the two settings the window writes go through it: `uiScale`
//! by its `ui:setZoom` channel, and `trayHintSeen` when the shell tells it of a close it turned into
//! a hide. Everything else here only reads the file.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use mm_core::main_window::{clamp_zoom, start_scale, window_fit, work_area_from, zoom_for_input, Area};
use mm_core::tray::{Close, Icon, TrayKeeper};
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::backend::Backend;

/// settings.json as the owner last wrote it, or `{}`.
pub fn settings(ud: &Path) -> Value {
    std::fs::read_to_string(ud.join("settings.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

/// The language the main process speaks: the setting, English when there is none.
fn use_lang(s: &Value) {
    mm_core::i18n::set_lang(mm_core::i18n::Lang::parse(s.get("uiLang").and_then(Value::as_str).unwrap_or("en")));
}

/// The screen's work area in CSS pixels: MM_WORKAREA when given (tools/sim profiles), else the
/// primary monitor's.
pub fn work_area(app: &tauri::App) -> Option<Area> {
    if let Some(a) = work_area_from(std::env::var("MM_WORKAREA").ok().as_deref()) {
        return Some(a);
    }
    let m = app.primary_monitor().ok().flatten()?;
    let k = m.scale_factor();
    let r = m.work_area();
    Some(Area { width: (r.size.width as f64 / k).round(), height: (r.size.height as f64 / k).round() })
}

/// What the window and the tray share.
pub struct Shell {
    user_data: PathBuf,
    owner: Arc<Backend>,
    keeper: Mutex<TrayKeeper>,
    icon: Mutex<Option<TrayIcon>>,
    zoom: Mutex<f64>,
    login_allowed: bool,
}

/// Is `url` the app's own page (a reload of it)? On Windows the page is served from
/// http://tauri.localhost, elsewhere from tauri://localhost.
pub fn is_own_page(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

impl Shell {
    /// Ask the owner something and forget the answer, off the calling thread.
    fn tell_owner(&self, channel: &'static str, args: Value) {
        let owner = self.owner.clone();
        std::thread::spawn(move || {
            let list = match args {
                Value::Array(a) => a,
                other => vec![other],
            };
            let _ = owner.invoke(channel, list);
        });
    }

    fn show(app: &AppHandle) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }

    /// The icon there while the setting is on and gone when it is off, the menu in the current
    /// language, and the sign-in entry as the setting says.
    pub fn sync(&self, app: &AppHandle) {
        let s = settings(&self.user_data);
        use_lang(&s);
        let change = self.keeper.lock().unwrap_or_else(|e| e.into_inner()).sync(&s);
        let mut icon = self.icon.lock().unwrap_or_else(|e| e.into_inner());
        match change {
            Icon::Make => match make_icon(app) {
                Ok(i) => *icon = Some(i),
                Err(e) => eprintln!("[mm-shell] no tray icon: {e}"),
            },
            Icon::Destroy => {
                if let Some(i) = icon.take() {
                    let _ = i.set_visible(false);
                    let _ = app.remove_tray_by_id(i.id());
                }
            }
            Icon::Keep => {}
        }
        if let Some(i) = icon.as_ref() {
            if let Ok(m) = build_menu(app) {
                let _ = i.set_menu(Some(m));
            }
        }
        drop(icon);
        if self.login_allowed {
            use tauri_plugin_autostart::ManagerExt;
            let auto = app.autolaunch();
            let r = if mm_core::tray::in_background(&s) { auto.enable() } else { auto.disable() };
            if let Err(e) = r {
                eprintln!("[mm-shell] login item not set: {e}");
            }
        }
    }

    /// The window asked to close: hidden in the tray while the setting is on.
    fn close(&self, app: &AppHandle, w: &WebviewWindow, api: &tauri::CloseRequestApi) {
        let s = settings(&self.user_data);
        let Close::Hide { hint } = self.keeper.lock().unwrap_or_else(|e| e.into_inner()).close(&s) else { return };
        api.prevent_close();
        let _ = w.hide();
        if hint {
            // said once, the first time: a window that vanished without a word reads as a crash
            if self.icon.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
                use tauri_plugin_notification::NotificationExt;
                use_lang(&s);
                let _ = app.notification().builder().title(mm_core::tray::TITLE).body(mm_core::tray::hint()).show();
            }
        }
        // the owner marks the hint seen in settings.json, which it holds
        self.owner.hidden();
        eprintln!("[mm-shell] window hidden in the tray");
    }

    /// The app is quitting for real: the window's close is no longer turned into a hide.
    pub fn quitting(&self) {
        self.keeper.lock().unwrap_or_else(|e| e.into_inner()).quitting = true;
    }

    /// The scale the page shows, as the window last set it.
    pub fn set_zoom(&self, z: f64) {
        *self.zoom.lock().unwrap_or_else(|e| e.into_inner()) = z;
    }

    /// Ctrl +/-/0 in the page: a new scale for the page to apply and the owner to remember.
    pub fn key(&self, app: &AppHandle, key: &str, control: bool, alt: bool) {
        let mut cur = self.zoom.lock().unwrap_or_else(|e| e.into_inner());
        let Some(z) = zoom_for_input("keyDown", key, control, alt, *cur) else { return };
        *cur = z;
        drop(cur);
        let _ = app.emit("mm", json!({ "channel": "ui:zoom", "args": [z] }));
        self.tell_owner("ui:setZoom", json!([z]));
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for (id, label) in mm_core::tray::menu() {
        match label {
            Some(l) => menu.append(&MenuItem::with_id(app, id, l, true, None::<&str>)?)?,
            None => menu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(menu)
}

fn make_icon(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip(mm_core::tray::TITLE)
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => Shell::show(app),
            "play" => app.state::<Arc<Shell>>().tell_owner("game:launch", json!([])),
            "quit" => {
                app.state::<Arc<Shell>>().quitting();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|icon, e| {
            let left_up =
                matches!(e, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. });
            if left_up || matches!(e, TrayIconEvent::DoubleClick { .. }) {
                Shell::show(icon.app_handle());
            }
        });
    if let Some(i) = app.default_window_icon() {
        b = b.icon(i.clone());
    }
    b.build(app)
}

/// How the window opens.
pub struct Open {
    pub user_data: PathBuf,
    pub area: Option<Area>,
    /// no settings.json before this start: the scale is picked for the screen
    pub first_run: bool,
    /// created hidden: Windows started it at sign-in (--background), or a measuring run (MM_QUIET)
    pub quiet: bool,
    pub login_allowed: bool,
    pub init_script: String,
}

/// Open the window on the app's page, locked to it, with the tray beside it.
pub fn open(app: &tauri::App, owner: Arc<Backend>, o: Open) -> tauri::Result<WebviewWindow> {
    let s = settings(&o.user_data);
    let scale = if o.first_run && start_scale(o.area) != 1.0 { start_scale(o.area) } else { clamp_zoom(&s["uiScale"]) };
    let fit = window_fit(o.area, scale);
    let shell = Arc::new(Shell {
        user_data: o.user_data,
        owner,
        keeper: Mutex::new(TrayKeeper::default()),
        icon: Mutex::new(None),
        zoom: Mutex::new(scale),
        login_allowed: o.login_allowed,
    });
    app.manage(shell.clone());
    let opener = app.handle().clone();
    let popups = app.handle().clone();
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Dota 2 Mod Manager")
        .inner_size(fit.width, fit.height)
        .min_inner_size(fit.min_width, fit.min_height)
        .decorations(false)
        .visible(!o.quiet)
        .background_color(tauri::window::Color(5, 5, 6, 255))
        .initialization_script(&o.init_script)
        // The window shows one page and never another: a page it navigated to would inherit
        // window.api (src/main-window.ts has the whole reason). A link that wants a browser gets one.
        .on_navigation(move |url| {
            if is_own_page(url) {
                return true;
            }
            eprintln!("[mm-shell] blocked navigation to {}", url.as_str().chars().take(200).collect::<String>());
            leave_for_browser(&opener, url);
            false
        })
        .on_new_window(move |url, _| {
            eprintln!("[mm-shell] blocked window.open to {}", url.as_str().chars().take(200).collect::<String>());
            leave_for_browser(&popups, &url);
            tauri::webview::NewWindowResponse::Deny
        })
        .center()
        .build()?;
    let events = app.handle().clone();
    let w = win.clone();
    win.on_window_event(move |e| match e {
        WindowEvent::Resized(_) => {
            let max = w.is_maximized().unwrap_or(false);
            let _ = events.emit("mm", json!({ "channel": "win:maximized", "args": [max] }));
        }
        WindowEvent::CloseRequested { api, .. } => {
            events.state::<Arc<Shell>>().close(&events, &w, api);
        }
        _ => {}
    });
    shell.sync(app.handle());
    Ok(win)
}

fn leave_for_browser(app: &AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https") {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_apps_own_page_may_load() {
        let own = |u: &str| is_own_page(&tauri::Url::parse(u).unwrap());
        assert!(own("http://tauri.localhost/index.html"));
        assert!(own("tauri://localhost/"));
        assert!(!own("https://tauri.localhost.example.com/"));
        assert!(!own("https://github.com/"));
        assert!(!own("file:///C:/Windows/"));
    }
}
