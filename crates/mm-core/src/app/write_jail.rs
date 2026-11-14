//! A run that may write only inside the folders it was given (src/write-jail.ts). This half
//! answers "is this path inside?" on the real path: the nearest part of it that exists is
//! resolved through links, so "..", a symlink or a junction pointing out is outside. Holding
//! every write to it is the shell's part once the Tauri build is the one that writes.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

static ROOTS: RwLock<Vec<String>> = RwLock::new(Vec::new());

fn fold(p: &str) -> String {
    if cfg!(windows) {
        p.to_lowercase()
    } else {
        p.to_string()
    }
}

/// canonicalize, without Windows' \\?\ prefix, so it compares with a path as written.
fn real(p: &Path) -> Option<PathBuf> {
    let c = std::fs::canonicalize(p).ok()?;
    let s = c.to_string_lossy();
    Some(match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => PathBuf::from(format!(r"\\{rest}")),
        None => PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()),
    })
}

/// The real path of `p`: its nearest existing ancestor resolved, plus the rest as written.
pub fn real_of(p: &Path) -> PathBuf {
    let mut cur = crate::safe_zip::resolve(p);
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while std::fs::symlink_metadata(&cur).is_err() {
        match (cur.parent(), cur.file_name()) {
            (Some(up), Some(name)) => {
                rest.insert(0, name.to_os_string());
                cur = up.to_path_buf();
            }
            _ => break,
        }
    }
    let base = real(&cur).unwrap_or(cur);
    rest.iter().fold(base, |p, s| p.join(s))
}

/// Put the jail up: writes held to these folders.
pub fn install(roots: &[PathBuf]) {
    let mut r = ROOTS.write().unwrap_or_else(|e| e.into_inner());
    *r = roots.iter().map(|p| fold(&real_of(p).to_string_lossy())).collect();
}

pub fn roots() -> Vec<String> {
    ROOTS.read().map(|r| r.clone()).unwrap_or_default()
}

/// Whether `p` is inside the jail; always true when no jail is up.
pub fn inside(p: &Path) -> bool {
    let roots = roots();
    if roots.is_empty() {
        return true;
    }
    if p.as_os_str().is_empty() {
        return false;
    }
    let real = fold(&real_of(p).to_string_lossy());
    let sep = std::path::MAIN_SEPARATOR;
    roots.iter().any(|root| {
        real == *root || real.starts_with(&if root.ends_with(sep) { root.clone() } else { format!("{root}{sep}") })
    })
}

/// The folders a --write-jail=<a><delimiter><b> switch names, or none.
pub fn from_argv(argv: &[String]) -> Vec<PathBuf> {
    let delim = if cfg!(windows) { ';' } else { ':' };
    argv.iter()
        .find_map(|a| a.strip_prefix("--write-jail="))
        .map(|s| s.split(delim).map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from).collect())
        .unwrap_or_default()
}
