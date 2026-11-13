//! Running a Windows program on Linux, for the one that has no Linux build: resourcecompiler.exe,
//! Valve's compiler from the Workshop Tools (src/wine.ts, resource_compiler.rs).
//!
//! The app keeps a Wine prefix of its own in userData/wine rather than borrowing ~/.wine: a prefix
//! only ours can be deleted and made again without asking anybody. It is made once, by the first
//! compile or ahead of it from Settings, with Wine told not to offer Mono and Gecko.
//!
//! Which Wine: the system's, on PATH, and when there is none the one inside a Proton Steam
//! installed (files/bin/wine; older Protons kept it under dist/). A path goes to a Windows program
//! as Windows spells it, through the Z: drive every new prefix maps to the root.

use std::path::{Path, PathBuf};

use serde_json::json;

/// The variables a Windows program runs with under our prefix: quiet, 64-bit, no Mono or Gecko.
pub fn wine_env(prefix: &Path) -> Vec<(String, String)> {
    [
        ("WINEPREFIX", prefix.to_string_lossy().into_owned()),
        ("WINEARCH", "win64".into()),
        ("WINEDEBUG", "-all".into()),
        ("WINEDLLOVERRIDES", "mscoree,mshtml=".into()),
    ]
    .map(|(k, v)| (k.to_string(), v))
    .to_vec()
}

/// A Linux path as a program under Wine reads it, through the Z: drive.
pub fn wine_path(p: &Path) -> String {
    format!("Z:{}", crate::safe_zip::resolve(p).to_string_lossy().replace('/', "\\"))
}

/// The Wine inside each Proton Steam installed, in every library it knows of: the newest first.
pub fn proton_wines(steam_roots: &[String]) -> Vec<PathBuf> {
    let windows = cfg!(windows);
    let mut libs = Vec::new();
    for root in steam_roots {
        if !Path::new(root).exists() {
            continue;
        }
        libs.push(root.clone());
        let vdf = Path::new(&crate::steam::steamapps_dir(windows, root)).join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(vdf) {
            libs.extend(crate::steam::parse_library_folders(&text));
        }
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for lib in libs {
        let common = Path::new(&crate::steam::steamapps_dir(windows, &lib)).join("common");
        let Ok(rd) = std::fs::read_dir(&common) else { continue };
        let mut names: Vec<String> = rd
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.to_lowercase().starts_with("proton"))
            .collect();
        // by name: "Proton 9.0" is after "Proton 8.0", and Experimental is on its own
        names.sort();
        names.reverse();
        for name in names {
            for sub in ["files", "dist"] {
                let wine = common.join(&name).join(sub).join("bin").join("wine");
                if !out.contains(&wine) && wine.exists() {
                    out.push(wine);
                }
            }
        }
    }
    out
}

/// Every Wine on PATH, by the names it goes by.
pub fn path_wines(path_var: &str) -> Vec<PathBuf> {
    let sep = if cfg!(windows) { ';' } else { ':' };
    path_var
        .split(sep)
        .filter(|d| !d.is_empty())
        .flat_map(|d| ["wine", "wine64"].map(|n| Path::new(d).join(n)))
        .filter(|p| p.exists())
        .collect()
}

/// The Wine to run with: the system's first, then a Proton's; None when there is neither.
pub fn find_wine(path_var: &str, home: &str, xdg_data_home: Option<&str>) -> Option<PathBuf> {
    path_wines(path_var)
        .into_iter()
        .next()
        .or_else(|| proton_wines(&crate::steam::linux_steam_roots(home, xdg_data_home)).into_iter().next())
}

/// What a prefix leaves on disk once wineboot has made it; the marker is ours, written after.
const READY: &str = ".d2mm-ready";

/// Whether a prefix is made and was made whole.
pub fn prefix_ready(prefix: &Path) -> bool {
    prefix.join(READY).exists() && prefix.join("system.reg").exists()
}

/// How a program is run: (program, arguments, its folder, variables over the app's own, a time
/// limit in ms) to its exit code and everything it printed. An exit code is an answer; Err is that
/// it never ran or was killed.
pub type RunProcess<'a> =
    &'a mut dyn FnMut(&str, &[String], Option<&Path>, &[(String, String)], u64) -> Result<(i32, String), String>;

/// Make the prefix, once. A prefix wineboot left half made has no marker, so it is thrown away and
/// made again rather than trusted.
pub fn ensure_prefix(prefix: &Path, wine: &str, run: RunProcess, log: &mut dyn FnMut(String)) -> Result<(), String> {
    if prefix_ready(prefix) {
        return Ok(());
    }
    let _ = std::fs::remove_dir_all(prefix);
    std::fs::create_dir_all(prefix).map_err(|e| e.to_string())?;
    log(format!("wine: making the prefix in {} with {wine}", prefix.display()));
    let (code, out) = run(wine, &["wineboot".into(), "--init".into()], None, &wine_env(prefix), 5 * 60 * 1000)?;
    if code != 0 || !prefix.join("system.reg").exists() {
        let lines: Vec<&str> = crate::js::trim(&out).split('\n').collect();
        let tail = lines[lines.len().saturating_sub(5)..].join(" | ");
        return Err(format!("wineboot exited with {code}: {tail}"));
    }
    let marker = json!({ "wine": wine, "at": crate::js::json_number(crate::library::now()) });
    std::fs::write(prefix.join(READY), serde_json::to_string(&marker).unwrap_or_default()).map_err(|e| e.to_string())
}
