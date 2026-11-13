//! d2mm:// links (src/deep-links.ts): a preset or a single mod clicked anywhere on the system, and
//! on Linux, telling the desktop that this program opens them. Nothing installs from a link: a
//! preset parks in the Presets tab, a mod opens its window in the catalog.

use std::path::Path;

use regex::Regex;
use serde::Serialize;

use crate::installer_downloads::{decode_uri_component, encode_uri_component};
use crate::preset_link::SCHEME;

/// The first d2mm:// link on a command line, if there is one.
pub fn first_link(argv: &[serde_json::Value]) -> Option<String> {
    let prefix = format!("{SCHEME}://");
    argv.iter().filter_map(|a| a.as_str()).find(|a| a.starts_with(&prefix)).map(String::from)
}

/// What follows d2mm://preset/, the part the preset importer reads.
pub fn preset_code(url: &str) -> String {
    url.strip_prefix(&format!("{SCHEME}://preset/")).unwrap_or(url).to_string()
}

/// A mod a link names: its category, its name in the catalog, and the look when it picks one.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct ModLink {
    pub cat: String,
    pub name: String,
    pub style: Option<String>,
}

fn mod_link() -> Regex {
    Regex::new(&format!("(?i)^{SCHEME}://mod(?:/|$)")).expect("a fixed pattern")
}

/// Whether this is a d2mm://mod link at all (one that names nothing still is).
pub fn is_mod_link(url: &str) -> bool {
    mod_link().is_match(url)
}

/// d2mm://mod/<category>/<name>[/<look>], each part URL-encoded: a name may hold a slash.
pub fn mod_link_url(m: &ModLink) -> String {
    let mut parts = vec![format!("{SCHEME}://mod"), encode_uri_component(&m.cat), encode_uri_component(&m.name)];
    if let Some(s) = m.style.as_deref().filter(|s| !s.is_empty()) {
        parts.push(encode_uri_component(s));
    }
    parts.join("/")
}

/// The mod a d2mm://mod/ link names, or None. A slash at the end, a query or a fragment, all of
/// which a link picks up on its way here, say nothing about the mod.
pub fn parse_mod_link(url: &str) -> Option<ModLink> {
    let re = mod_link();
    if !re.is_match(url) {
        return None;
    }
    let rest = re.replace(url, "");
    let tail = Regex::new(r"[?#][^\n\r\u{2028}\u{2029}]*\z").expect("a fixed pattern");
    let rest = tail.replace(&rest, "");
    let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    // a stray % that decodes to nothing makes the whole link name nothing
    let decoded: Vec<String> = parts
        .iter()
        .map(|p| decode_uri_component(p).map(|d| crate::js::trim(&d).to_string()))
        .collect::<Option<_>>()?;
    let (cat, name) = (decoded[0].clone(), decoded[1].clone());
    if cat.is_empty() || name.is_empty() {
        return None;
    }
    Some(ModLink { cat, name, style: decoded.get(2).filter(|s| !s.is_empty()).cloned() })
}

/// Where a link goes in the window: ("mod-link", the mod or null) for a mod link, ("preset-link",
/// what the importer said) for any other d2mm:// link, None for anything else.
pub fn route(
    url: Option<&str>,
    import_preset_link: &mut dyn FnMut(&str) -> serde_json::Value,
) -> Option<(&'static str, serde_json::Value)> {
    let url = url.filter(|u| u.starts_with(&format!("{SCHEME}://")))?;
    Some(if is_mod_link(url) {
        ("mod-link", serde_json::to_value(parse_mod_link(url)).unwrap_or_default())
    } else {
        ("preset-link", import_preset_link(&preset_code(url)))
    })
}

/// The name of the .desktop file, its icon and the running window's class, all one word.
const APP_ID: &str = "dota2-mod-manager";

/// The .desktop file for `exe`: the program, and the scheme and file type it opens.
pub fn desktop_entry(exe: &str) -> String {
    [
        "[Desktop Entry]".to_string(),
        "Type=Application".into(),
        "Name=Dota 2 Mod Manager".into(),
        "Comment=Mods for Dota 2, without the file juggling".into(),
        // %u passes the clicked link through; the quotes are for a path with a space in it
        format!("Exec=\"{exe}\" %u"),
        format!("Icon={APP_ID}"),
        // without the window's class the dock cannot tell the running window belongs to this entry
        format!("StartupWMClass={APP_ID}"),
        "Categories=Game;".into(),
        "Terminal=false".into(),
        format!("MimeType=x-scheme-handler/{SCHEME};application/x-d2mm;"),
        String::new(),
    ]
    .join("\n")
}

fn holds(file: &Path, want: &[u8]) -> bool {
    std::fs::read(file).is_ok_and(|b| b == want)
}

fn write_if_other(dir: &Path, file: &Path, want: &[u8]) -> std::io::Result<bool> {
    if holds(file, want) {
        return Ok(false);
    }
    std::fs::create_dir_all(dir)?;
    std::fs::write(file, want)?;
    Ok(true)
}

/// On Linux, the .desktop file (and the app's icon) written when missing or saying something else,
/// so the desktop knows this program opens d2mm:// links; elsewhere nothing. Best effort: a
/// failure is a line in the log and the app runs on.
pub fn install_desktop_entry(
    platform: &str,
    exe: &str,
    home: &Path,
    icon: Option<&Path>,
    log: &dyn Fn(&str),
    refresh: &dyn Fn(&Path),
) {
    if platform != "linux" {
        return;
    }
    if let Some(src) = icon {
        let dir = home.join(".local").join("share").join("icons").join("hicolor").join("512x512").join("apps");
        let file = dir.join(format!("{APP_ID}.png"));
        match std::fs::read(src).and_then(|want| write_if_other(&dir, &file, &want)) {
            Ok(true) => log(&format!("desktop icon written: {}", file.display())),
            Ok(false) => {}
            Err(e) => log(&format!("desktop icon skipped: {e}")),
        }
    }
    let dir = home.join(".local").join("share").join("applications");
    let file = dir.join(format!("{APP_ID}.desktop"));
    match write_if_other(&dir, &file, desktop_entry(exe).as_bytes()) {
        Ok(true) => {
            refresh(&dir);
            log(&format!("desktop entry written: {}", file.display()));
        }
        Ok(false) => {}
        Err(e) => log(&format!("desktop entry skipped: {e}")),
    }
}

/// update-desktop-database over the folder, ignored when the system has none.
pub fn refresh_desktop_database(dir: &Path) {
    let _ = std::process::Command::new("update-desktop-database").arg(dir).spawn();
}
