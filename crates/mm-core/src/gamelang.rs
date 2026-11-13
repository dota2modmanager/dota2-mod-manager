//! Which dota_<lang> folder the game actually mounts, what Steam says about the game's language,
//! and the folders made and moved when it changes. Replacing src/gamelang.ts, src/gamelang-steam.ts
//! and src/gamelang-folders.ts. The rule itself is written down at the top of src/gamelang.ts and
//! in the vault (VPK Format): four voice languages, three of them with a folder that mounts, the
//! folder named by the AUDIO language, a `-language` launch option winning outright.

use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use crate::js;

/// One dota_* folder on disk and what is in it; see lang_folders.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LangFolder {
    pub suffix: String,
    /// one of the three folders Valve ships
    pub official: bool,
    /// holds Valve's own voice paks
    pub valve_content: bool,
    /// pak files that are not Valve's
    pub mod_files: usize,
}

/// The folder the game will mount, and where that answer came from; see detect_lang_suffix.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LangDetection {
    pub suffix: Option<String>,
    pub source: Option<&'static str>,
    pub ui_language: Option<String>,
    pub audio: Option<String>,
}

/// The languages Dota records voice in.
pub const VOICE_LANGUAGES: [&str; 4] = ["english", "koreana", "russian", "schinese"];
/// The three of them with a folder that mounts.
pub const MOD_FOLDERS: [&str; 3] = ["koreana", "russian", "schinese"];
/// Borrowed by English, and by anything unrecognised.
pub const FALLBACK_FOLDER: &str = "russian";
/// Every language Dota will accept for its audio setting.
pub const DOTA_LANGUAGES: [&str; 28] = [
    "brazilian",
    "bulgarian",
    "czech",
    "danish",
    "dutch",
    "english",
    "finnish",
    "french",
    "german",
    "greek",
    "hungarian",
    "italian",
    "japanese",
    "koreana",
    "latam",
    "norwegian",
    "polish",
    "portuguese",
    "romanian",
    "russian",
    "schinese",
    "spanish",
    "swedish",
    "tchinese",
    "thai",
    "turkish",
    "ukrainian",
    "vietnamese",
];

/// The folder mods go to and why: a user's lock, a launch option followed, or the voice language.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModFolder {
    pub suffix: String,
    pub followed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
}

/// The folder the game is going to mount, which is where mods have to go. `launched`: a
/// `-language` value; `audio`: the voice language; `lock`: the folder the user keeps in Settings.
pub fn mod_folder_for(launched: Option<&str>, audio: Option<&str>, lock: Option<&str>) -> ModFolder {
    if let Some(lock) = lock.filter(|l| MOD_FOLDERS.contains(l)) {
        return ModFolder { suffix: lock.to_string(), followed: false, locked: Some(true) };
    }
    let forced = launched.filter(|l| !l.is_empty()).map(str::to_lowercase);
    if let Some(forced) = forced.filter(|f| DOTA_LANGUAGES.contains(&f.as_str())) {
        return ModFolder { suffix: forced, followed: true, locked: None };
    }
    ModFolder { suffix: folder_for(audio).to_string(), followed: false, locked: None }
}

/// Where mods have to live for a given audio language: English borrows the Russian folder.
pub fn folder_for(audio: Option<&str>) -> &str {
    match audio {
        Some(a) if MOD_FOLDERS.contains(&a) => a,
        _ => FALLBACK_FOLDER,
    }
}

/// A file as Node reads it as utf-8: bad bytes become U+FFFD.
fn read_text(file: &Path) -> Option<String> {
    std::fs::read(file).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn ws() -> &'static str {
    js::SPACE_CLASS
}

/// One "key" "value" pair out of a Valve KeyValues text, the first one that matches, trimmed and lowercased.
pub fn read_key(text: &str, key: &str) -> Option<String> {
    let r = RegexBuilder::new(&format!(r#""{key}"{}*"([^"]+)""#, ws())).case_insensitive(true).build().ok()?;
    r.captures(text).map(|m| js::trim(&m[1]).to_lowercase())
}

/// UI and audio language the game wrote at its last boot, or None if it never ran.
pub fn boot_languages(game: Option<&Path>) -> Option<(Option<String>, Option<String>)> {
    let text = read_text(&game?.join("dota").join("cfg").join("boot.vcfg"))?;
    let audio = read_key(&text, "AudioLanguage");
    let ui = read_key(&text, "UILanguage");
    let given = |v: &Option<String>| v.as_deref().is_some_and(|v| !v.is_empty());
    if !given(&audio) && !given(&ui) {
        return None;
    }
    // audio || ui: a blank audio language gives the text one, blank or not
    let audio = if given(&audio) { audio } else { ui.clone() };
    Some((ui, audio))
}

/// Every dota_* folder on disk, with what is inside each.
pub fn lang_folders(game: Option<&Path>) -> Vec<LangFolder> {
    let Some(game) = game else { return vec![] };
    let Ok(dir) = crate::js::read_dir(game) else { return vec![] };
    static PAK: OnceLock<Regex> = OnceLock::new();
    let pak = PAK.get_or_init(|| {
        RegexBuilder::new(r"^pak[0-9]+_dir\.vpk(\.off|\.moff)?$").case_insensitive(true).build().unwrap()
    });
    let mut out = Vec::new();
    for e in dir {
        if !e.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.get(..5).filter(|h| h.eq_ignore_ascii_case("dota_")).map(|_| &name[5..]) else {
            continue;
        };
        if rest.is_empty() || rest.contains('\n') {
            continue;
        }
        let suffix = rest.to_lowercase();
        if ["addons", "lv", "core", "mods"].contains(&suffix.as_str()) {
            continue; // not language layers; dota_mods is ours
        }
        let files: Vec<String> = crate::js::dir_names(&game.join(&name));
        let valve = |f: &String| f.get(..6).is_some_and(|h| h.eq_ignore_ascii_case("pak01_"));
        out.push(LangFolder {
            official: MOD_FOLDERS.contains(&suffix.as_str()),
            valve_content: files.iter().any(valve),
            mod_files: files.iter().filter(|f| pak.is_match(f) && !valve(f)).count(),
            suffix,
        });
    }
    out
}

/// The folder suffix the game will mount, and where that answer came from: a launch option, then
/// the game's own setting, then what Steam has the depot set to.
pub fn detect_lang_suffix(game: Option<&Path>) -> LangDetection {
    let boot = boot_languages(game);
    let steam = steam_language(game);
    let launched = launch_language(game).filter(|l| !l.is_empty());
    let boot_ui = boot.as_ref().and_then(|b| b.0.clone()).filter(|u| !u.is_empty());
    let boot_audio = boot.as_ref().and_then(|b| b.1.clone()).filter(|a| !a.is_empty());
    let audio = launched.clone().or_else(|| boot_audio.clone()).or_else(|| steam.clone().filter(|s| !s.is_empty()));
    let voice = |l: &str| VOICE_LANGUAGES.contains(&l);
    if let Some(l) = &launched {
        return LangDetection {
            suffix: voice(l).then(|| l.clone()),
            source: Some("launch"),
            ui_language: boot_ui,
            audio,
        };
    }
    if let Some(a) = boot_audio.as_deref().filter(|a| voice(a)) {
        return LangDetection { suffix: Some(a.to_string()), source: Some("boot"), ui_language: boot_ui, audio };
    }
    if let Some(s) = steam.as_deref().filter(|s| voice(s)) {
        return LangDetection { suffix: Some(s.to_string()), source: Some("steam"), ui_language: boot_ui, audio };
    }
    LangDetection { suffix: None, source: None, ui_language: boot_ui, audio }
}

/// Set the game's language settings in boot.vcfg: existing keys patched in place, anything else
/// left alone, a missing file given Valve's own shape. A setting left out is left as it is.
pub fn write_boot_languages(game: &Path, ui: Option<&str>, audio: Option<&str>) -> std::io::Result<()> {
    let file = game.join("dota").join("cfg").join("boot.vcfg");
    let text = read_text(&file);
    let pairs: Vec<(&str, &str)> = [("UILanguage", ui), ("AudioLanguage", audio)]
        .into_iter()
        .filter_map(|(k, v)| v.filter(|v| !v.is_empty()).map(|v| (k, v)))
        .collect();
    let has_boot = text.as_deref().is_some_and(|t| t.to_lowercase().contains("\"boot\""));
    let text = match text.filter(|t| !t.is_empty() && has_boot) {
        None => {
            let body: String = pairs.iter().map(|(k, v)| format!("\t\"{k}\"\t\t\"{v}\"\n")).collect();
            format!("\"boot\"\n{{\n{body}}}\n")
        }
        Some(mut text) => {
            for (key, value) in &pairs {
                let re = RegexBuilder::new(&format!(r#"("{key}"{}*")[^"]*(")"#, ws()))
                    .case_insensitive(true)
                    .build()
                    .unwrap();
                if re.is_match(&text) {
                    // a replacement string's $ patterns: the value is a language, which has none
                    text = re.replace(&text, |c: &regex::Captures| format!("{}{value}{}", &c[1], &c[2])).into_owned();
                } else {
                    static END: OnceLock<Regex> = OnceLock::new();
                    let end = END.get_or_init(|| Regex::new(&format!(r"\}}{}*$", js::SPACE_CLASS)).unwrap());
                    text = end
                        .replace(&text, |_: &regex::Captures| format!("\t\"{key}\"\t\t\"{value}\"\n}}\n"))
                        .into_owned();
                }
            }
            text
        }
    };
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&file, text)
}

// ---------- what Steam says ----------

/// path.resolve: a path made whole, its "." and ".." taken out by name.
fn resolve(p: &Path) -> PathBuf {
    let whole = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let mut out = PathBuf::new();
    for c in whole.components() {
        match c {
            Component::ParentDir => {
                // never above the root, as path.resolve
                if out.parent().is_some() {
                    out.pop();
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn up(p: &Path, n: usize) -> PathBuf {
    let mut q = p.to_path_buf();
    for _ in 0..n {
        q.push("..");
    }
    resolve(&q)
}

/// The 32-bit account id of whoever Steam has signed in: MostRecent where loginusers.vdf has it,
/// the newest Timestamp where it does not.
fn current_steam_user(root: &Path) -> Option<String> {
    let text = read_text(&root.join("config").join("loginusers.vdf"))?;
    static USER: OnceLock<Regex> = OnceLock::new();
    static RECENT: OnceLock<Regex> = OnceLock::new();
    static STAMP: OnceLock<Regex> = OnceLock::new();
    let user = USER.get_or_init(|| Regex::new(&format!(r#""([0-9]{{17}})"{}*\{{((?s:.)*?)\n\t\}}"#, ws())).unwrap());
    let recent = RECENT.get_or_init(|| Regex::new(&format!(r#""MostRecent"{}*"([0-9])""#, ws())).unwrap());
    let stamp = STAMP.get_or_init(|| Regex::new(&format!(r#""Timestamp"{}*"([0-9]+)""#, ws())).unwrap());
    let mut best: Option<(String, f64)> = None;
    for m in user.captures_iter(&text) {
        let body = &m[2];
        let most_recent = recent.captures(body).map(|c| c[1].to_string());
        let ts = stamp.captures(body).map_or(0.0, |c| c[1].parse::<f64>().unwrap_or(f64::INFINITY));
        let rank = if most_recent.as_deref() == Some("1") { f64::INFINITY } else { ts };
        if best.as_ref().is_none_or(|b| rank > b.1) {
            best = Some((m[1].to_string(), rank));
        }
    }
    // userdata folders are the 32-bit account id
    let (id, _) = best?;
    Some((id.parse::<i128>().ok()? - 76561197960265728).to_string())
}

/// Dota's launch options as Steam stores them, with the escapes of the format undone.
fn read_launch_options(file: &Path) -> Option<String> {
    let text = read_text(file)?;
    static APP: OnceLock<Regex> = OnceLock::new();
    let app = APP.get_or_init(|| {
        RegexBuilder::new(&format!(r#""570"{}*\{{(?s:.){{0,4000}}?"LaunchOptions"{}*"((?:\\.|[^"\\])*)""#, ws(), ws()))
            .size_limit(1 << 28)
            .build()
            .unwrap()
    });
    let raw = app.captures(&text)?.get(1)?.as_str().to_string();
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        // a backslash before a line break is no escape: /\\(.)/ does not take the break
        if c == '\\' && chars.peek().is_some_and(|n| !matches!(n, '\n' | '\r' | '\u{2028}' | '\u{2029}')) {
            let n = chars.next().unwrap();
            out.push(match n {
                'n' => '\n',
                't' => '\t',
                'v' => '\u{b}',
                'b' => '\u{8}',
                'r' => '\r',
                'f' => '\u{c}',
                other => other,
            });
        } else {
            out.push(c);
        }
    }
    Some(out)
}

/// The Steam roots to look in: the library the game sits in, then where Steam installs by default.
fn steam_roots(game: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(g) = game {
        // <lib>/steamapps/common/dota 2 beta/game -> <lib>
        roots.push(up(g, 4));
    }
    if cfg!(windows) {
        for base in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(b) = std::env::var_os(base).filter(|b| !b.is_empty()) {
                roots.push(PathBuf::from(b).join("Steam"));
            }
        }
    }
    roots
}

fn account_ids(userdata: &Path, skip_zero: bool) -> Option<Vec<String>> {
    let ids: Vec<String> = crate::js::read_dir(userdata)
        .ok()?
        .into_iter()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|d| !d.is_empty() && d.bytes().all(|c| c.is_ascii_digit()) && !(skip_zero && d == "0"))
        .collect();
    Some(ids)
}

/// Ask the launch options one question on behalf of whoever is signed in; where nobody can be
/// identified, an answer every account with one agrees on.
fn from_launch_options(game: Option<&Path>, pick: &dyn Fn(Option<String>) -> Option<String>) -> Option<String> {
    for root in steam_roots(game) {
        let userdata = root.join("userdata");
        let Some(ids) = account_ids(&userdata, false) else { continue };
        if ids.is_empty() {
            continue;
        }
        let value_of = |id: &str| pick(read_launch_options(&userdata.join(id).join("config").join("localconfig.vdf")));
        if let Some(current) = current_steam_user(&root).filter(|c| ids.contains(c)) {
            // '' means launch options exist and say nothing about this question
            return value_of(&current).filter(|v| !v.is_empty());
        }
        let mut values: Vec<String> = Vec::new();
        for id in &ids {
            if let Some(v) = value_of(id).filter(|v| !v.is_empty()) {
                if !values.contains(&v) {
                    values.push(v);
                }
            }
        }
        return if values.len() == 1 { values.pop() } else { None };
    }
    None
}

/// The userdata/<account> folder of whoever is signed in to Steam; without one, the one account
/// that has played Dota on this machine; with several and none current, None rather than a guess.
pub fn steam_account_dir(game: Option<&Path>) -> Option<PathBuf> {
    for root in steam_roots(game) {
        let userdata = root.join("userdata");
        let Some(ids) = account_ids(&userdata, true) else { continue };
        if ids.is_empty() {
            continue;
        }
        if let Some(current) = current_steam_user(&root).filter(|c| ids.contains(c)) {
            return Some(userdata.join(current));
        }
        let played: Vec<&String> = ids.iter().filter(|id| userdata.join(id).join("570").exists()).collect();
        return (played.len() == 1).then(|| userdata.join(played[0]));
    }
    None
}

/// The `-language X` Steam will start the game with, lowercased, or None.
pub fn launch_language(game: Option<&Path>) -> Option<String> {
    static LANG: OnceLock<Regex> = OnceLock::new();
    let lang = LANG.get_or_init(|| Regex::new(&format!(r"-language{}+([A-Za-z]+)", ws())).unwrap());
    from_launch_options(game, &|raw| {
        let raw = raw?;
        Some(lang.captures(&raw).map_or(String::new(), |m| m[1].to_lowercase()))
    })
}

/// Everything Steam will start the game with, verbatim, or None.
pub fn launch_options(game: Option<&Path>) -> Option<String> {
    from_launch_options(game, &|raw| raw)
}

/// Language Steam has the game mounted as: the fallback before Dota has ever booted.
pub fn steam_language(game: Option<&Path>) -> Option<String> {
    let acf = up(game?, 3).join("appmanifest_570.acf");
    let text = read_text(&acf)?;
    for block in ["MountedConfig", "UserConfig"] {
        let r =
            RegexBuilder::new(&format!(r#""{block}"{}*\{{([^}}]*)\}}"#, ws())).case_insensitive(true).build().unwrap();
        if let Some(lang) = r.captures(&text).and_then(|m| read_key(&m[1], "language")).filter(|l| !l.is_empty()) {
            return Some(lang);
        }
    }
    None
}

// ---------- the folders ----------

fn gameinfo_stub(suffix: &str) -> String {
    format!(
        "\"GameInfo\"\n{{\n\tLayeredOnMod\tdota\n\n\tFileSystem\n\t{{\n\t\tSearchPaths\n\t\t{{\n\t\t\tGame\t\t\t\tdota_{suffix}\n\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore\n\n\t\t\tMod\t\t\t\t\tdota_{suffix}\n\t\t\tMod\t\t\t\t\tdota\n\n\t\t\tAddonRoot\t\t\tdota_addons\n\n\t\t\t// Note: addon content is included in publiccontent by default.\n\t\t\tPublicContent\t\tcore\n\t\t}}\n\t}}\n}}\n"
    )
}

fn is_valve_pak(name: &str) -> bool {
    name.get(..6).is_some_and(|h| h.eq_ignore_ascii_case("pak01_"))
}

/// Is Valve's voice pack for this language actually on disk? If not, voices stay English.
pub fn voice_installed(game: &Path, suffix: &str) -> bool {
    std::fs::read_dir(game.join(format!("dota_{suffix}")))
        .is_ok_and(|d| d.flatten().any(|f| is_valve_pak(&f.file_name().to_string_lossy())))
}

/// Make sure the mod folder exists; a folder this app creates gets a gameinfo.gi shaped like
/// Valve's own, and one already there is never written into.
pub fn ensure_lang_folder(game: &Path, suffix: &str) -> std::io::Result<PathBuf> {
    let dir = game.join(format!("dota_{suffix}"));
    let existed = dir.exists();
    std::fs::create_dir_all(&dir)?;
    if !existed {
        // created or refused in one call: no gap in which another program's file is replaced
        match std::fs::OpenOptions::new().write(true).create_new(true).open(dir.join("gameinfo.gi")) {
            Ok(mut f) => std::io::Write::write_all(&mut f, gameinfo_stub(suffix).as_bytes())?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
    }
    Ok(dir)
}

/// Move installed mod files from one language folder to another when the audio language changes:
/// Valve's own files, Minify's and names already taken in the destination stay. Returns how many moved.
pub fn move_lang_folder(game: Option<&Path>, from: Option<&str>, to: Option<&str>) -> usize {
    let (Some(game), Some(from), Some(to)) = (game, from.filter(|f| !f.is_empty()), to.filter(|t| !t.is_empty()))
    else {
        return 0;
    };
    if from == to {
        return 0;
    }
    let old = game.join(format!("dota_{from}"));
    let mut moved = 0;
    let run = |moved: &mut usize| -> std::io::Result<()> {
        if !old.exists() {
            return Ok(());
        }
        let new = ensure_lang_folder(game, to)?;
        for e in crate::js::read_dir(&old)? {
            let f = e.file_name().to_string_lossy().into_owned();
            if is_valve_pak(&f) || f.to_lowercase() == "gameinfo.gi" {
                continue;
            }
            if crate::minify::is_minify_file(&f.to_lowercase()) || crate::minify::is_minify_pak(&old.join(&f)) {
                continue;
            }
            let dst = new.join(&f);
            if dst.exists() {
                continue;
            }
            std::fs::rename(old.join(&f), dst)?;
            *moved += 1;
        }
        // a folder we no longer use and that holds nothing else goes away
        if std::fs::read_dir(&old)?.next().is_none() {
            std::fs::remove_dir(&old)?;
        }
        Ok(())
    };
    if let Err(err) = run(&mut moved) {
        eprintln!("lang folder migration failed: {err}");
    }
    moved
}
