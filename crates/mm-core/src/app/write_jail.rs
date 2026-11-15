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

/// The jail's folders as `inside_of` compares them: real, and case-folded on Windows.
fn jail_of(roots: &[PathBuf]) -> Vec<String> {
    roots.iter().map(|p| fold(&real_of(p).to_string_lossy())).collect()
}

/// Put the jail up: writes held to these folders.
pub fn install(roots: &[PathBuf]) {
    let mut r = ROOTS.write().unwrap_or_else(|e| e.into_inner());
    *r = jail_of(roots);
}

pub fn roots() -> Vec<String> {
    ROOTS.read().map(|r| r.clone()).unwrap_or_default()
}

/// Whether `p` is inside the jail; always true when no jail is up.
pub fn inside(p: &Path) -> bool {
    inside_of(&roots(), p)
}

/// Whether `p` is inside one of `roots` (as [`jail_of`] makes them); true when there are none.
fn inside_of(roots: &[String], p: &Path) -> bool {
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

/// A jailed run's own folder (its user data) checked before anything is written there: a run
/// held to the sandbox with its user data outside it would write the real app's settings and
/// library, which the installed app shares with a checkout's.
pub fn refuse_outside(what: &str, p: &Path) -> Result<(), String> {
    if inside(p) {
        return Ok(());
    }
    Err(format!("write jail: the {what} {} is outside {}", p.display(), roots().join(" | ")))
}

/// The folders a --write-jail=<a><delimiter><b> switch names, or none.
pub fn from_argv(argv: &[String]) -> Vec<PathBuf> {
    let delim = if cfg!(windows) { ';' } else { ':' };
    argv.iter()
        .find_map(|a| a.strip_prefix("--write-jail="))
        .map(|s| s.split(delim).map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway folder with a jail in it and a sibling whose name starts the same.
    struct Tree(PathBuf);
    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tree() -> (Tree, PathBuf, Vec<String>) {
        let root = std::env::temp_dir().join(format!("mm-jail-{}", uuid::Uuid::new_v4().simple()));
        let jail = root.join("sandbox");
        std::fs::create_dir_all(jail.join("game")).unwrap();
        std::fs::create_dir_all(root.join("sandbox-real")).unwrap();
        let roots = jail_of(std::slice::from_ref(&jail));
        (Tree(root), jail, roots)
    }

    #[test]
    fn no_jail_holds_nothing_back() {
        assert!(inside_of(&[], Path::new("C:/anywhere/at/all")));
    }

    #[test]
    fn the_jail_and_what_is_under_it_are_inside_even_before_it_exists() {
        let (_t, jail, roots) = tree();
        assert!(inside_of(&roots, &jail));
        assert!(inside_of(&roots, &jail.join("game")));
        assert!(inside_of(&roots, &jail.join("userdata").join("settings.json")));
    }

    #[test]
    fn a_sibling_named_like_the_jail_and_a_climb_out_are_outside() {
        let (t, jail, roots) = tree();
        assert!(!inside_of(&roots, &t.0.join("sandbox-real").join("x")));
        assert!(!inside_of(&roots, &jail.join("..").join("sandbox-real")));
        assert!(!inside_of(&roots, &jail.join("game").join("..").join("..").join("elsewhere")));
        assert!(!inside_of(&roots, Path::new("")));
    }

    #[cfg(windows)]
    #[test]
    fn the_case_of_a_windows_path_does_not_matter() {
        let (_t, jail, roots) = tree();
        let upper = PathBuf::from(jail.to_string_lossy().to_uppercase());
        assert!(inside_of(&roots, &upper.join("game")));
    }

    /// A link inside the jail that points out of it is followed, so a write through it is outside.
    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_jail_is_outside() {
        let (t, jail, roots) = tree();
        std::os::unix::fs::symlink(t.0.join("sandbox-real"), jail.join("out")).unwrap();
        assert!(!inside_of(&roots, &jail.join("out").join("settings.json")));
    }

    /// The same with a junction, which Windows makes without an administrator.
    #[cfg(windows)]
    #[test]
    fn a_junction_out_of_the_jail_is_outside() {
        let (t, jail, roots) = tree();
        let link = jail.join("out");
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(t.0.join("sandbox-real"))
            .output()
            .unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        assert!(!inside_of(&roots, &link.join("settings.json")));
    }

    #[test]
    fn the_switch_names_each_folder() {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let argv = vec!["app".to_string(), format!("--write-jail=a{sep} b {sep}")];
        assert_eq!(from_argv(&argv), vec![PathBuf::from("a"), PathBuf::from("b")]);
        assert!(from_argv(&["app".to_string()]).is_empty());
    }
}
