//! A link or a folder opened with the person's own program for it.
//!
//! From the AppImage the opener's launchers would inherit the image's environment, and xdg-open
//! then chose a browser from the image's view of the system rather than the person's: on Linux
//! Mint with a Flatpak Brave, "Sign in" and every link went to Chromium (mm_core::host_env says
//! how). There the launchers run with the host's environment; everywhere else the opener plugin
//! does as before.

/// Open `target` (a URL or a path) the way the desktop would.
pub fn open(target: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if mm_core::host_env::inside_appimage() {
        return outside_the_image(target);
    }
    tauri_plugin_opener::open_url(target, None::<&str>).map_err(|e| e.to_string())
}

/// The opener plugin's launchers in its order (xdg-open, gio, ...), each with the host's
/// environment, each given the same quarter second to fail before the next is tried.
#[cfg(target_os = "linux")]
fn outside_the_image(target: &str) -> Result<(), String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let mut last = format!("nothing on this system opens {target}");
    for mut cmd in open::commands(target) {
        mm_core::host_env::apply(&mut cmd);
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let program = cmd.get_program().to_string_lossy().into_owned();
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last = format!("{program}: {e}");
                continue;
            }
        };
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => return Ok(()),
                Ok(Some(s)) => {
                    last = format!("{program}: {s}");
                    break;
                }
                // xdg-open may wait for the browser it started: handed off, reaped when it ends
                Ok(None) if start.elapsed() >= Duration::from_millis(250) => {
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(e) => {
                    last = format!("{program}: {e}");
                    break;
                }
            }
        }
    }
    Err(last)
}
