//! The window the uninstaller opens on its way out (src/uninstall-window.ts), under Tauri: the
//! same page Electron shows (renderer/uninstall.html, copied beside the app's page by
//! tools/ui-build.mjs --tauri), with only the removal's four calls. The owner answers them and
//! ends the run with the exit code the uninstaller reads; a close without an answer is the safe
//! one, cancelling.

use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "uninstall";

/// Whether a window may make this call: the removal's window only its own four, which no other
/// window gets an answer to either (owner_uninstall answers them only in the uninstaller's run).
pub fn allowed(label: &str, channel: &str) -> bool {
    label != LABEL || mm_core::owner_uninstall::CHANNELS.contains(&channel)
}

/// preload-uninstall.js run in the page against the bridge, as preload.js is for the main window.
fn init_script() -> String {
    format!(
        "{}\n;(function (require) {{\n{}\n}})(window.__mmRequire);\n",
        include_str!("bridge.js"),
        include_str!("../../preload-uninstall.js")
    )
}

pub fn open(app: &tauri::App, quiet: bool) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("uninstall.html".into()))
        .title("Dota 2 Mod Manager")
        .inner_size(560.0, 520.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .visible(!quiet)
        .background_color(tauri::window::Color(5, 5, 6, 255))
        .initialization_script(init_script())
        // one page and never another, as the main window (window.rs)
        .on_navigation(crate::window::is_own_page)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .center()
        .build()?;
    let app = app.handle().clone();
    win.on_window_event(move |e| {
        // closing the window is not an answer, so it counts as the safe one
        if let WindowEvent::CloseRequested { .. } = e {
            app.exit(mm_core::uninstall::UNINSTALL_CANCELLED);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_removal_window_reaches_only_the_removal() {
        assert!(allowed(LABEL, "uninstall:run"));
        assert!(!allowed(LABEL, "mods:remove"));
        assert!(!allowed(LABEL, "settings:set"));
        assert!(allowed("main", "mods:remove"));
    }
}
