//! Living beside Dota2-Minify, another mod manager: the pak slots it writes, how its own VPKs are
//! marked, what its config says, and whose mods the game mounts. Replacing src/minify.ts, which
//! says why each rule is the way it is.

use regex::Regex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Its own locale, which is not a language Dota knows.
pub const MINIFY_FOLDER: &str = "minify";
/// The real language it moved to, whose folder Dota does mount.
pub const MINIFY_BORROWED: &str = "dutch";

/// The pak slots that are its work when a file sits there (recognition).
const MINIFY_PAKS: [u32; 4] = [65, 66, 67, 99];
/// The slots this app never hands out, whether or not Minify is on the machine.
pub const RESERVED_PAKS: [u32; 3] = [65, 66, 67];

/// The reserved range as the interface says it out loud, built from the list.
pub fn reserved_label() -> String {
    let all: &[u32] = &RESERVED_PAKS;
    match all {
        [first, .., last] => format!("pak{first}-{last}"),
        [one] => format!("pak{one}"),
        [] => String::new(),
    }
}

/// The marker files Minify packs into every VPK it builds.
const MINIFY_MARKERS: [&str; 3] = ["minify_mods.json", "minify_vpk_mods.txt", "minify_version.txt"];

/// Is this file in the language folder one of Minify's paks? `base_lower`: a file name, lowercased.
pub fn is_minify_file(base_lower: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = R.get_or_init(|| Regex::new(r"^pak([0-9]{2})_(?:dir|[0-9]{3})\.vpk(?:\.off|\.moff)?$").unwrap());
    r.captures(base_lower).and_then(|m| m[1].parse::<u32>().ok()).is_some_and(|n| MINIFY_PAKS.contains(&n))
}

/// Was this VPK built by Minify? Reads the archive index only, never the content.
pub fn is_minify_pak(file: &Path) -> bool {
    let Ok(index) = crate::vpk::read_index_file(file) else { return false };
    let Ok(names) = crate::vpk::list_paths(&index) else { return false };
    names.iter().any(|n| MINIFY_MARKERS.contains(&n.to_lowercase().as_str()))
}

/// What Minify's own config says about where it writes.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MinifyConfig {
    pub output_path: Option<String>,
    pub locale: Option<String>,
    pub folder: Option<String>,
}

/// The user's home folder, as os.homedir() finds it.
fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

/// Where Minify keeps the settings it publishes about itself.
pub fn config_path() -> PathBuf {
    let local =
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData").join("Local"));
    local.join("Dota2-Minify").join("config").join("minify_config.json")
}

/// What Minify says about itself, or None: not installed, or keeping its settings elsewhere.
pub fn read_config(file: &Path) -> Option<MinifyConfig> {
    let raw: serde_json::Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    let output_path = raw.get("output_path").and_then(|v| v.as_str()).map(String::from);
    let locale = raw.get("output_locale").and_then(|v| v.as_str()).map(str::to_lowercase);
    // an empty string says nothing, as a falsy value does in the TypeScript
    if output_path.as_deref().unwrap_or("").is_empty() && locale.as_deref().unwrap_or("").is_empty() {
        return None;
    }
    let folder = folder_of_path(output_path.as_deref());
    Some(MinifyConfig { output_path, locale, folder })
}

/// The suffix of the folder a path ends in: ...\game\dota_dutch -> "dutch".
pub fn folder_of_path(output_path: Option<&str>) -> Option<String> {
    let p = output_path.filter(|p| !p.is_empty())?;
    let p = p.trim_end_matches(['\\', '/']);
    let last = p.rsplit(['\\', '/']).next().unwrap_or("");
    let rest = last.get(..5).filter(|h| h.eq_ignore_ascii_case("dota_")).map(|_| &last[5..])?;
    (!rest.is_empty()).then(|| rest.to_lowercase())
}

/// Has Minify put itself in front of the game's own launch (its "prelaunch" wrapper)?
pub fn prelaunch_hook(options: Option<&str>) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = R.get_or_init(|| {
        Regex::new(&format!(
            r#"(?i)(?:^|[{ws}"])prelaunch(?:[{ws}"]|$)"#,
            ws = &crate::js::SPACE_CLASS[1..crate::js::SPACE_CLASS.len() - 1]
        ))
        .unwrap()
    });
    let s = options.unwrap_or("");
    r.is_match(s) && s.to_lowercase().contains("minify") && s.contains("&&")
}

/// One dota_* folder as readMinify needs it.
pub struct FolderCount<'a> {
    pub suffix: &'a str,
    pub mod_files: usize,
}

/// Minify as this app sees it; see read_minify.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinifyState {
    pub present: bool,
    pub folder: Option<String>,
    pub mods: usize,
    pub mounts: bool,
    pub mounted: Option<String>,
    pub our_folder: String,
    pub sharing: bool,
    pub live: &'static str,
    pub declared: bool,
    pub reserved_label: String,
    pub prelaunch: bool,
}

/// What read_minify is told.
pub struct MinifyInput<'a> {
    pub folders: &'a [FolderCount<'a>],
    pub audio: Option<&'a str>,
    pub game_languages: &'a [&'a str],
    pub our_folder: &'a str,
    pub our_mods: usize,
    pub config: Option<MinifyConfig>,
    pub count_mods: Option<&'a dyn Fn(&str) -> usize>,
    pub launch_options: Option<&'a str>,
}

/// Where Minify is, whether its folder is the one the game mounts, and whose mods are live.
pub fn read_minify(p: MinifyInput) -> MinifyState {
    let at = |suffix: &str| p.folders.iter().find(|f| f.suffix == suffix);
    // where it writes, which is the question, not the language the player asked it for
    let declared = p
        .config
        .as_ref()
        .and_then(|c| c.folder.clone().filter(|f| !f.is_empty()).or_else(|| folder_of_path(c.output_path.as_deref())));
    let borrowed = at(MINIFY_BORROWED);
    let folder = declared.clone().or_else(|| {
        if at(MINIFY_FOLDER).is_some() {
            Some(MINIFY_FOLDER.to_string())
        } else if borrowed.is_some_and(|b| b.mod_files > 0) {
            Some(MINIFY_BORROWED.to_string())
        } else {
            None
        }
    });
    let present = folder.is_some();
    let mods = match &folder {
        Some(f) => match p.count_mods {
            Some(count) => count(f),
            None => at(f).map_or(0, |x| x.mod_files),
        },
        None => 0,
    };
    let mounts = folder.as_deref().is_some_and(|f| p.game_languages.contains(&f));
    let mounted = p.audio.filter(|a| !a.is_empty()).map(str::to_lowercase);
    let sharing = folder.as_deref() == Some(p.our_folder);
    let live = match &mounted {
        None => "unknown",
        Some(m) => {
            let ours_live = m == p.our_folder && p.our_mods > 0;
            let minify_live = mounts && Some(m.as_str()) == folder.as_deref() && mods > 0;
            if (sharing && (ours_live || minify_live)) || (ours_live && minify_live) {
                "both"
            } else if ours_live {
                "ours"
            } else if minify_live {
                "minify"
            } else {
                "neither"
            }
        }
    };
    MinifyState {
        present,
        folder,
        mods,
        mounts,
        mounted,
        our_folder: p.our_folder.to_string(),
        sharing,
        live,
        declared: declared.is_some(),
        reserved_label: reserved_label(),
        prelaunch: prelaunch_hook(p.launch_options),
    }
}
