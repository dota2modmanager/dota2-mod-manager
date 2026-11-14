//! Finding Steam, and then Dota inside it (src/steam.ts).
//!
//! Only the first step differs by platform: Windows keeps the answer in the registry, Linux in
//! one of four folders depending on how Steam was installed. After that it is Steam's own
//! layout: libraryfolders.vdf lists the other drives and the game sits under steamapps/common.

use std::path::Path;

use regex::Regex;

use crate::installer::validate_game_path;

/// Node's `path.join` for the platform asked about: the parts joined and normalized, `.` and
/// `..` resolved, and on Windows either slash written as a backslash.
pub fn join(windows: bool, parts: &[&str]) -> String {
    let sep = if windows { '\\' } else { '/' };
    let raw: String = parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join(&sep.to_string());
    if raw.is_empty() {
        return ".".into();
    }
    let raw = if windows { raw.replace('/', "\\") } else { raw };
    // what stays in front: a drive, a UNC server and share, or the root
    let (prefix, rest) = if windows {
        let b = raw.as_bytes();
        if raw.starts_with("\\\\") && !raw.starts_with("\\\\\\") {
            let mut it = raw[2..].splitn(3, '\\');
            let (server, share) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
            if !server.is_empty() && !share.is_empty() {
                let rest = it.next().unwrap_or("");
                (format!("\\\\{server}\\{share}\\"), rest.to_string())
            } else {
                ("\\".into(), raw.trim_start_matches('\\').to_string())
            }
        } else if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
            let after = &raw[2..];
            if after.starts_with('\\') {
                (format!("{}\\", &raw[..2]), after.trim_start_matches('\\').to_string())
            } else {
                (raw[..2].to_string(), after.to_string())
            }
        } else if raw.starts_with('\\') {
            ("\\".into(), raw.trim_start_matches('\\').to_string())
        } else {
            (String::new(), raw.clone())
        }
    } else if raw.starts_with('/') {
        ("/".into(), raw.trim_start_matches('/').to_string())
    } else {
        (String::new(), raw.clone())
    };
    let absolute = prefix.ends_with(sep);
    let mut out: Vec<&str> = Vec::new();
    for seg in rest.split(sep) {
        match seg {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|l| *l != "..") {
                    out.pop();
                } else if !absolute {
                    out.push("..");
                }
            }
            s => out.push(s),
        }
    }
    let trailing = rest.ends_with(sep) && !out.is_empty();
    let mut body = out.join(&sep.to_string());
    if trailing {
        body.push(sep);
    }
    if prefix.is_empty() && body.is_empty() {
        return ".".into();
    }
    format!("{prefix}{body}")
}

/// The value `reg query` printed for one entry, or None when it printed none.
pub fn reg_value(stdout: &str) -> Option<String> {
    let re = Regex::new(r"REG_SZ[ \t\n\r\x0b\x0c\u{a0}\u{feff}\u{2028}\u{2029}\p{Zs}]+([^\n\r\u{2028}\u{2029}]+)")
        .expect("a fixed pattern");
    re.captures(stdout).map(|c| crate::js::trim(&c[1]).to_string())
}

/// The libraries libraryfolders.vdf lists: its "path" entries, with doubled backslashes undone.
pub fn parse_library_folders(vdf: &str) -> Vec<String> {
    let re = Regex::new(r#""path"[ \t\n\r\x0b\x0c\u{a0}\u{feff}\u{2028}\u{2029}\p{Zs}]+"([^"]+)""#)
        .expect("a fixed pattern");
    re.captures_iter(vdf).map(|c| c[1].replace("\\\\", "\\")).collect()
}

/// Where Steam lives on Linux, in the order worth trying: the symlink Steam keeps for this, the
/// files themselves (moved by XDG_DATA_HOME), and the flatpak's own home.
pub fn linux_steam_roots(home: &str, xdg_data_home: Option<&str>) -> Vec<String> {
    let xdg = xdg_data_home
        .filter(|x| !x.is_empty())
        .map_or_else(|| join(cfg!(windows), &[home, ".local", "share"]), String::from);
    vec![
        join(cfg!(windows), &[home, ".steam", "steam"]),
        join(cfg!(windows), &[home, ".steam", "root"]),
        join(cfg!(windows), &[&xdg, "Steam"]),
        join(cfg!(windows), &[home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"]),
    ]
}

/// steamapps, or SteamApps where the disk spells it so (Linux cares, Windows does not).
pub fn steamapps_dir(windows: bool, lib: &str) -> String {
    for name in ["steamapps", "SteamApps"] {
        let dir = join(windows, &[lib, name]);
        if Path::new(&dir).exists() {
            return dir;
        }
    }
    join(windows, &[lib, "steamapps"])
}

/// The first of the places Steam may live that is there. The registry answers with either
/// slash; a POSIX path is left exactly as it is.
pub fn pick_steam_root(candidates: &[Option<String>], windows: bool) -> Option<String> {
    candidates.iter().flatten().filter(|c| !c.is_empty()).find_map(|c| {
        let c = if windows { c.replace('/', "\\") } else { c.clone() };
        Path::new(&c).exists().then_some(c)
    })
}

/// Libraries to look through when Steam did not say: on Windows the usual folders on every drive
/// letter, on Linux the roots above and the one folder a second library usually ends up in.
pub fn fallback_libraries(windows: bool, home: &str, xdg_data_home: Option<&str>) -> Vec<String> {
    if !windows {
        let mut v = linux_steam_roots(home, xdg_data_home);
        v.push(join(cfg!(windows), &[home, "Games", "SteamLibrary"]));
        return v;
    }
    "CDEFGH"
        .chars()
        .flat_map(|d| {
            [
                format!("{d}:\\Program Files (x86)\\Steam"),
                format!("{d}:\\Program Files\\Steam"),
                format!("{d}:\\Steam"),
                format!("{d}:\\Games\\Steam"),
                format!("{d}:\\SteamLibrary"),
            ]
        })
        .collect()
}

/// The game folder of the first library that holds a real install: Steam's own root, the
/// libraries its libraryfolders.vdf lists, then the fallbacks, each looked at once.
pub fn find_dota_in(windows: bool, steam_root: Option<&str>, fallbacks: &[String]) -> Option<String> {
    let mut libs: Vec<String> = Vec::new();
    if let Some(root) = steam_root.filter(|r| !r.is_empty()) {
        libs.push(root.to_string());
        let vdf = join(windows, &[&steamapps_dir(windows, root), "libraryfolders.vdf"]);
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            libs.extend(parse_library_folders(&text));
        }
    }
    libs.extend(fallbacks.iter().cloned());
    let mut seen = std::collections::HashSet::new();
    for lib in libs {
        if lib.is_empty() || !seen.insert(lib.to_lowercase()) {
            continue;
        }
        let game = join(windows, &[&steamapps_dir(windows, &lib), "common", "dota 2 beta", "game"]);
        // the leftovers of a moved library are not a hit
        if validate_game_path(Path::new(&game)) {
            return Some(game);
        }
    }
    None
}

#[cfg(windows)]
fn reg_query(hive: &str, key: &str, value: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args(["query", &format!("{hive}\\{key}"), "/v", value])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.is_empty() {
        return None;
    }
    reg_value(&String::from_utf8_lossy(&out.stdout))
}

fn home_dir() -> String {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default()
}

/// Where Dota is on this computer: the libraries Steam names first, then the usual places.
pub fn find_dota_game_path() -> Option<String> {
    let home = home_dir();
    let xdg = std::env::var("XDG_DATA_HOME").ok();
    #[cfg(windows)]
    let root = pick_steam_root(
        &[
            reg_query("HKCU", "SOFTWARE\\Valve\\Steam", "SteamPath"),
            reg_query("HKLM", "SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
            reg_query("HKLM", "SOFTWARE\\Valve\\Steam", "InstallPath"),
        ],
        true,
    );
    #[cfg(not(windows))]
    let root =
        pick_steam_root(&linux_steam_roots(&home, xdg.as_deref()).into_iter().map(Some).collect::<Vec<_>>(), false);
    find_dota_in(cfg!(windows), root.as_deref(), &fallback_libraries(cfg!(windows), &home, xdg.as_deref()))
}
