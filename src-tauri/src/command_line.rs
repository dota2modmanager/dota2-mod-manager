//! The command line's side in the shell (issue #436, mm_core::cli): `--apply`, `--list` and
//! `--disable-all` run here to an exit code before Tauri is built, so no window, tray or event
//! loop is ever made.
//!
//! The single-instance plugin cannot be asked whether the app is open: a second copy it catches
//! hands its command line to the first and exits with 0, which a script would read as done. So
//! this takes the plugin's own lock first (the same mutex, D-Bus name or socket it uses) and
//! answers 3 when it is held. While a command runs it holds the lock in turn, so a window started
//! meanwhile gives way instead of writing manifest.json beside it.

use std::path::PathBuf;
use std::sync::Arc;

use mm_core::cli;

/// Where the app's data lives: --user-data-dir, the folder beside a portable exe, %APPDATA%, or
/// the system's data folder under the app's identifier (Tauri's app_data_dir).
pub fn user_data_dir(argv: &[String], portable: Option<&std::path::Path>, identifier: &str) -> PathBuf {
    let ud = crate::flag(argv, "user-data-dir")
        .map(PathBuf::from)
        // a read-only folder (the exe dropped into Program Files) keeps the ordinary place
        .or_else(|| portable.and_then(mm_core::portable_update::data_beside))
        .or_else(|| std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("Dota 2 Mod Manager")))
        .or_else(|| dirs::data_dir().map(|d| kept_from_electron(d.join(identifier), &electron_dirs())))
        .unwrap_or_default();
    std::path::absolute(&ud).unwrap_or(ud)
}

/// Where the Electron app (3.x) kept its data away from Windows: Electron's userData is the
/// product name under the config folder on Linux and under Application Support on macOS.
fn electron_dirs() -> Vec<PathBuf> {
    [dirs::config_dir(), dirs::data_dir()].into_iter().flatten().map(|d| d.join("Dota 2 Mod Manager")).collect()
}

/// The Tauri folder, unless it has no settings yet and an Electron one has: 4.0.0 started Linux
/// players from an empty folder, with no settings, library or presets, though 3.8 had them all in
/// ~/.config/Dota 2 Mod Manager (reported 2026-11-16). Windows shares %APPDATA% and never moved.
fn kept_from_electron(tauri: PathBuf, electron: &[PathBuf]) -> PathBuf {
    if tauri.join("settings.json").exists() {
        return tauri;
    }
    electron.iter().find(|d| d.join("settings.json").exists()).cloned().unwrap_or(tauri)
}

/// The command on this command line run to its exit code, or None for an ordinary start (and for
/// the uninstaller's run, which has a window of its own).
pub fn run(argv: &[String], portable: Option<&std::path::Path>, ctx: &tauri::Context) -> Option<i32> {
    if mm_core::uninstall::is_uninstall_run(argv) {
        return None;
    }
    let parsed = cli::command(argv)?;
    attach_console();
    let io: Arc<dyn cli::Io> = Arc::new(cli::Stdio);
    let identifier = &ctx.config().identifier;
    let Some(_lock) = lock::take(identifier) else {
        io.err(cli::BUSY_LINE);
        return Some(cli::BUSY);
    };
    let user_data = user_data_dir(argv, portable, identifier);
    // a sandbox run is held to its folder here as in a window (src-tauri/src/main.rs setup)
    mm_core::write_jail::install(&mm_core::write_jail::from_argv(argv));
    if let Err(e) = mm_core::write_jail::refuse_outside("user data", &user_data) {
        io.err(&e);
        return Some(cli::USAGE);
    }
    let opts = mm_core::owner::Options {
        system_languages: (!user_data.join("settings.json").exists()).then(crate::backend::system_languages),
        user_data,
        app_version: ctx.package_info().version.to_string(),
        app_root: app_root(ctx),
        downloads: dirs::download_dir().unwrap_or_default(),
        uninstall: false,
        find_game: Box::new(mm_core::steam::find_dota_game_path),
        dota_running: Box::new(mm_core::game_watch::dota_is_running),
        now: mm_core::net_fetch::now_ms,
    };
    Some(cli::main(parsed, opts, io))
}

/// The build's own files, as crate::app_root finds them once an app exists.
fn app_root(ctx: &tauri::Context) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    } else {
        tauri::utils::platform::resource_dir(ctx.package_info(), &tauri::Env::default())
            .map(|d| d.join("app"))
            .unwrap_or_default()
    }
}

/// A release build on Windows is a GUI program and starts with no console: the one it was started
/// from is taken, so its lines reach the terminal. Output already redirected to a file or a pipe
/// keeps its handles.
fn attach_console() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(windows)]
mod lock {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    /// The plugin's named mutex, held until the process exits.
    pub struct Lock(#[allow(dead_code)] HANDLE);

    /// The lock, or None when the app already holds it.
    pub fn take(identifier: &str) -> Option<Lock> {
        // tauri-plugin-single-instance's own name for it (src/platform_impl/windows.rs)
        let name: Vec<u16> = format!("{identifier}-sim").encode_utf16().chain([0]).collect();
        unsafe {
            let h = CreateMutexW(std::ptr::null(), 1, name.as_ptr());
            if GetLastError() == ERROR_ALREADY_EXISTS {
                if !h.is_null() {
                    CloseHandle(h);
                }
                return None;
            }
            Some(Lock(h))
        }
    }
}

#[cfg(target_os = "linux")]
mod lock {
    use zbus::fdo::{RequestNameFlags, RequestNameReply};
    use zbus::Connection;

    /// The plugin's D-Bus name, held while the connection lives.
    pub struct Lock(#[allow(dead_code)] Option<Connection>);

    /// The lock, or None when the app already holds it. With no session bus there is no lock to
    /// take, and the plugin starts a window normally then too.
    pub fn take(identifier: &str) -> Option<Lock> {
        zbus::block_on(async {
            let Ok(conn) = Connection::session().await else { return Some(Lock(None)) };
            // tauri-plugin-single-instance's own name for it (src/platform_impl/linux.rs)
            let name = format!("{identifier}.SingleInstance");
            match conn.request_name_with_flags(name.as_str(), RequestNameFlags::DO_NOT_QUEUE).await {
                Err(zbus::Error::NameTaken) | Ok(RequestNameReply::InQueue) => None,
                _ => Some(Lock(Some(conn))),
            }
        })
    }
}

#[cfg(target_os = "macos")]
mod lock {
    /// Nothing held: the plugin's socket cannot be shared without becoming the instance.
    pub struct Lock;

    /// None when the app's socket answers.
    pub fn take(identifier: &str) -> Option<Lock> {
        // tauri-plugin-single-instance's own path for it (src/platform_impl/macos.rs)
        let socket = format!("/tmp/{}_si.sock", identifier.replace(['.', '-'], "_"));
        match std::os::unix::net::UnixStream::connect(socket) {
            Ok(_) => None,
            Err(_) => Some(Lock),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_electron_folder_is_kept_until_the_tauri_one_has_settings() {
        let root = std::env::temp_dir().join(format!("mm-ud-{}", std::process::id()));
        let (tauri, electron) = (root.join("com.dota2modmanager.app"), root.join("Dota 2 Mod Manager"));
        std::fs::create_dir_all(&electron).unwrap();
        assert_eq!(
            kept_from_electron(tauri.clone(), std::slice::from_ref(&electron)),
            tauri,
            "nothing anywhere: Tauri's"
        );
        std::fs::write(electron.join("settings.json"), "{}").unwrap();
        assert_eq!(
            kept_from_electron(tauri.clone(), std::slice::from_ref(&electron)),
            electron,
            "3.8's settings: kept"
        );
        std::fs::create_dir_all(&tauri).unwrap();
        std::fs::write(tauri.join("settings.json"), "{}").unwrap();
        assert_eq!(
            kept_from_electron(tauri.clone(), std::slice::from_ref(&electron)),
            tauri,
            "4.0's own once it has them"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
