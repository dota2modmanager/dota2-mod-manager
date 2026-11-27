//! A start that fails says so. The packaged exe has no console (windows_subsystem), so a panic
//! on the main thread before the window is up (the shell failing to build, WebView2 refusing
//! to start) used to look like a white flash and nothing: people in Discord could only say
//! "it does not open". Now the reason goes to a file and, on Windows, into a plain message box
//! (user32's MessageBoxW, which every Windows has; comctl32 is delay-loaded, see build.rs).

use std::path::PathBuf;

/// The file a failed start writes, beside the system's temporary files: the data folder may be
/// the thing that failed, and a portable copy's folder may be read-only.
pub fn report_path() -> PathBuf {
    std::env::temp_dir().join("Dota 2 Mod Manager - start failed.txt")
}

/// What the person reads: both languages, since the UI language comes from settings that may
/// not have loaded.
pub fn text(reason: &str, file: &std::path::Path) -> String {
    // the window is a WebView2 page: without the runtime nothing else can help
    let webview = if needs_webview(reason) {
        format!(
            "Нужен Microsoft Edge WebView2, установи его отсюда:\n\
             Install Microsoft Edge WebView2 from here:\n{WEBVIEW2}\n\n"
        )
    } else {
        String::new()
    };
    format!(
        "Dota 2 Mod Manager не запустился.\nDota 2 Mod Manager could not start.\n\n{reason}\n\n{webview}\
         Если переустановка не помогает, пришли этот текст или файл в наш Discord.\n\
         If reinstalling does not help, send this text or the file to our Discord.\n\n{}{}",
        file.display(),
        if needs_webview(reason) {
            "\n\nОткрыть страницу загрузки? / Open the download page now?"
        } else {
            ""
        }
    )
}

/// Whether the start failed for want of the WebView2 runtime (wry's "Could not find the webview
/// runtime", or WebView2 refusing to start). The portable exe has no installer to put it in, so
/// the box then offers Microsoft's download page.
fn needs_webview(reason: &str) -> bool {
    reason.to_lowercase().contains("webview")
}

/// Microsoft's Evergreen bootstrapper for the WebView2 runtime.
const WEBVIEW2: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// The panic's message, whichever way it was raised.
fn reason(info: &std::panic::PanicHookInfo) -> String {
    let msg = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic".into());
    match info.location() {
        Some(l) => format!("{msg}\n({}:{})", l.file(), l.line()),
        None => msg,
    }
}

/// Installed first thing in main. Only the main thread's panics: a worker's panic does not end
/// the app, and a box for it would be noise.
pub fn install() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        if std::thread::current().name() != Some("main") {
            return;
        }
        let file = report_path();
        let body = text(&reason(info), &file);
        let _ = std::fs::write(&file, &body);
        show(&body, needs_webview(&reason(info)));
    }));
}

/// The box; with `offer_webview` it asks Yes/No, and Yes opens the WebView2 download page in the
/// default browser (the shell's own open, since no Tauri app exists to ask).
#[cfg(windows)]
fn show(body: &str, offer_webview: bool) {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO, SW_SHOWNORMAL,
    };
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (text, title) = (wide(body), wide("Dota 2 Mod Manager"));
    let buttons = if offer_webview { MB_YESNO } else { MB_OK };
    let answer = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            buttons | MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST,
        )
    };
    if offer_webview && answer == IDYES {
        let (verb, url) = (wide("open"), wide(WEBVIEW2));
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

#[cfg(not(windows))]
fn show(_body: &str, _offer_webview: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_start_names_the_reason_and_the_file_in_both_languages() {
        let file = report_path();
        let t = text("the Tauri shell failed to build: WebView2 not found", &file);
        assert!(t.contains("не запустился") && t.contains("could not start"));
        assert!(t.contains("WebView2 not found"));
        assert!(t.contains(&file.display().to_string()));
        assert!(t.contains(WEBVIEW2), "a missing WebView2 says where to get it");
        assert!(!text("index out of bounds", &file).contains(WEBVIEW2));
        assert!(t.contains("Open the download page now?"), "and offers to open it");
        assert!(!text("index out of bounds", &file).contains("download page"));
    }
}
