//! The game's anti-cheat notice, in words that say what to do (src/notice-text.ts). A localization
//! file in the language folder the game mounts, inside the app's own pak: chat_<lang>.txt is read
//! after dota_<lang>.txt, so the pak carries the chat file the game would have read anyway, with
//! the four strings added at the end. The pak is never listed or counted as a slot.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};

use crate::slot_zones::APP_PAK;
use crate::vpk;

/// The file name of the app's pak in the language folder.
pub fn notice_pak() -> String {
    format!("pak{APP_PAK}_dir.vpk")
}

/// An entry that marks the pak as ours: a pak64 without it belongs to somebody else.
pub const MARKER: &str = "dota2modmanager/notice.json";

fn marker_body() -> Vec<u8> {
    let v = json!({
        "app": "Dota 2 Mod Manager",
        "url": "https://dota2modmanager.com",
        "note": "Clearer text for the game's anti-cheat notice. Not a mod: the app keeps it up to date and its uninstaller removes it.",
    });
    crate::js::stringify(&v, "  ").into_bytes()
}

/// The four strings per language (src/notice-texts.ts NOTICE_TEXTS), in the module's order.
pub fn notice_texts() -> &'static IndexMap<String, IndexMap<String, String>> {
    static T: OnceLock<IndexMap<String, IndexMap<String, String>>> = OnceLock::new();
    T.get_or_init(|| {
        let rows: Vec<(String, IndexMap<String, String>)> =
            serde_json::from_str(include_str!("../data/notice-texts.json")).expect("notice-texts.json");
        rows.into_iter().collect()
    })
}

/// The game's own keys for the four strings (NOTICE_KEYS).
pub fn notice_keys() -> &'static crate::data::Table {
    static T: OnceLock<crate::data::Table> = OnceLock::new();
    T.get_or_init(|| {
        let rows: Vec<(String, String)> =
            serde_json::from_str(include_str!("../data/notice-keys.json")).expect("notice-keys.json");
        rows.into_iter().collect()
    })
}

fn localization(name: &str, lang: &str) -> String {
    format!("resource/localization/{name}_{lang}.txt")
}

/// The language the game shows its text in: a launch option, then its own setting, then Steam's.
pub fn ui_language(game: &Path) -> String {
    let some = |s: Option<String>| s.filter(|s| !s.is_empty());
    some(crate::gamelang::launch_language(Some(game)))
        .or_else(|| some(crate::gamelang::boot_languages(Some(game)).and_then(|(ui, _)| ui)))
        .or_else(|| some(crate::gamelang::steam_language(Some(game))))
        .unwrap_or_else(|| "english".into())
        .to_lowercase()
}

/// The language a localization file says it is, from its header, lowercased.
pub fn declared_language(text: &str) -> Option<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r#"(?i)"Language"\s+"([^"]+)""#).unwrap());
    re.captures(&crate::js::slice_utf16(text, 512)).map(|c| c[1].to_lowercase())
}

fn texts_for(language: &str, ui: &str) -> &'static IndexMap<String, String> {
    let all = notice_texts();
    all.get(language).or_else(|| all.get(ui)).unwrap_or_else(|| &all["english"])
}

/// A localization file with these tokens set at the end of its Tokens block, in the file's own
/// line ending, any earlier definition of the same keys taken out; None with no Tokens block.
pub fn with_tokens(text: &str, tokens: &IndexMap<String, String>) -> Option<String> {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = text.to_string();
    for key in tokens.keys() {
        // JS's `.` stops at every line terminator, not only \n
        let re = Regex::new(&format!(
            r#"(?im)^[ \t]*"{key}"[ \t]+"(?:[^"\\\r\n]|\\[^\n\r\u{{2028}}\u{{2029}}])*"[^\r\n]*\r?\n"#
        ))
        .ok()?;
        out = re.replace_all(&out, "").into_owned();
    }
    let b = out.as_bytes();
    let (mut depth, mut tokens_depth) = (0i64, -1i64);
    let mut last: Option<&[u8]> = None;
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'"' => {
                let mut j = i + 1;
                while j < b.len() && b[j] != b'"' {
                    j += if b[j] == b'\\' { 2 } else { 1 };
                }
                last = Some(&b[i + 1..j.min(b.len())]);
                i = j;
            }
            b'/' if b.get(i + 1) == Some(&b'/') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'{' => {
                depth += 1;
                if tokens_depth < 0 && last.is_some_and(|l| l.eq_ignore_ascii_case(b"tokens")) {
                    tokens_depth = depth;
                }
                last = None;
            }
            b'}' => {
                if depth == tokens_depth {
                    let before = &out[..i];
                    let lines: String = tokens.iter().map(|(k, v)| format!("\"{k}\"\t\"{v}\"{eol}")).collect();
                    let sep = if before.ends_with('\n') { "" } else { eol };
                    return Some(format!("{before}{sep}{lines}{}", &out[i..]));
                }
                depth -= 1;
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// The live paks of a language folder other than ours, in the order the game reads them.
fn live_paks(lang_dir: &Path) -> Vec<(PathBuf, f64)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"(?i)^pak(\d+)_dir\.vpk$").unwrap());
    let Ok(names) = crate::js::read_dir(lang_dir) else { return Vec::new() };
    let mut out: Vec<(PathBuf, f64)> = names
        .iter()
        .filter_map(|e| {
            let f = e.file_name().to_string_lossy().into_owned();
            let n: f64 = re.captures(&f)?[1].parse().ok()?;
            (n != f64::from(APP_PAK)).then(|| (lang_dir.join(&f), n))
        })
        .collect();
    out.sort_by(|a, b| a.1.total_cmp(&b.1));
    out
}

fn is_ours(file: &Path) -> bool {
    vpk::Index::open(file).is_ok_and(|i| i.has(MARKER))
}

/// What refresh decided about the notice pak.
#[derive(Debug)]
pub enum Plan {
    Skip(String),
    Remove(String),
    Write { bytes: Vec<u8>, language: String },
}

fn base(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// What the notice pak should be for this game and folder, worked out without writing anything.
pub fn plan(game: &Path, lang_dir: &Path) -> Plan {
    let pak = notice_pak();
    let target = lang_dir.join(&pak);
    if target.exists() && !is_ours(&target) {
        return Plan::Skip(format!("{pak} is somebody else's"));
    }
    let ui = ui_language(game);
    let chat_rel = localization("chat", &ui);
    let dota_rel = localization("dota", &ui);
    let paks: Vec<(PathBuf, f64, vpk::Index)> =
        live_paks(lang_dir).into_iter().filter_map(|(f, n)| vpk::Index::open(&f).ok().map(|i| (f, n, i))).collect();
    // a pak read before ours that carries the same file wins over it: nothing to add then
    if let Some((f, _, _)) = paks.iter().find(|(_, n, i)| *n < f64::from(APP_PAK) && i.has(&chat_rel)) {
        return Plan::Remove(format!("{} carries {chat_rel}", base(f)));
    }
    let read = |i: &vpk::Index, p: &str| i.read(p).ok().flatten();
    let mut chat = paks.iter().find(|(_, _, i)| i.has(&chat_rel)).and_then(|(_, _, i)| read(i, &chat_rel));
    if chat.is_none() {
        chat = vpk::Index::open(&game.join("dota").join("pak01_dir.vpk")).ok().and_then(|i| read(&i, &chat_rel));
    }
    let Some(chat) = chat else { return Plan::Remove(format!("the game has no {chat_rel}")) };
    let language = paks
        .iter()
        .find(|(_, _, i)| i.has(&dota_rel))
        .and_then(|(_, _, i)| {
            let t = i.read(&dota_rel).ok().flatten().unwrap_or_default();
            declared_language(&String::from_utf8_lossy(&t))
        })
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| ui.clone());
    let texts = texts_for(&language, &ui);
    let tokens: IndexMap<String, String> =
        notice_keys().iter().map(|(what, key)| (key.clone(), texts.get(what).cloned().unwrap_or_default())).collect();
    let Some(text) = with_tokens(&String::from_utf8_lossy(&chat), &tokens) else {
        return Plan::Remove(format!("{chat_rel} has no Tokens block"));
    };
    let bytes =
        vpk::build(&[vpk::entry_at(&chat_rel, text.into_bytes().into()), vpk::entry_at(MARKER, marker_body().into())]);
    Plan::Write { bytes, language }
}

/// Take our pak out of the folder, and only ours.
pub fn remove_notice(lang_dir: &Path) -> bool {
    let target = lang_dir.join(notice_pak());
    if !target.exists() || !is_ours(&target) {
        return false;
    }
    let _ = fs::remove_file(&target);
    true
}

/// Bring the notice pak in line with the game, and say in a few words what was done.
pub fn apply_notice(game: Option<&Path>, lang_dir: Option<&Path>) -> Result<String, String> {
    let (Some(game), Some(lang_dir)) = (game, lang_dir) else { return Ok("no language folder".into()) };
    if !lang_dir.exists() {
        return Ok("no language folder".into());
    }
    match plan(game, lang_dir) {
        Plan::Skip(why) => Ok(format!("skipped: {why}")),
        Plan::Remove(why) => {
            Ok(if remove_notice(lang_dir) { format!("removed: {why}") } else { format!("not needed: {why}") })
        }
        Plan::Write { bytes, language } => {
            let target = lang_dir.join(notice_pak());
            if fs::read(&target).is_ok_and(|c| c == bytes) {
                return Ok(format!("up to date ({language})"));
            }
            let mut tmp = target.clone().into_os_string();
            tmp.push(".tmp");
            let tmp = PathBuf::from(tmp);
            fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            if let Err(e) = fs::rename(&tmp, &target) {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
            Ok(format!("written ({language})"))
        }
    }
}

fn stamp(file: &Path) -> String {
    match (fs::metadata(file), crate::terrain_age::mtime_ms(file)) {
        (Ok(m), Some(ms)) => format!("{}:{}", m.len(), crate::js::number(ms)),
        _ => "-".into(),
    }
}

/// The notice kept current from a place that runs often: rebuilt only when the game's settings,
/// its main pak or a pak in the language folder changed. A failed write is retried once a minute.
pub struct NoticeText {
    last_key: Option<String>,
    failed_at: Option<std::time::Instant>,
    pub retry: std::time::Duration,
}

impl Default for NoticeText {
    fn default() -> Self {
        NoticeText { last_key: None, failed_at: None, retry: std::time::Duration::from_secs(60) }
    }
}

impl NoticeText {
    pub fn key_of(game: &Path, dir: &Path) -> String {
        static R: OnceLock<Regex> = OnceLock::new();
        let re = R.get_or_init(|| Regex::new(r"(?i)^pak\d+_dir\.vpk$").unwrap());
        let mut names: Vec<String> = crate::js::dir_names(dir).into_iter().filter(|f| re.is_match(f)).collect();
        names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let mut parts = vec![
            game.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            ui_language(game),
            stamp(&game.join("dota").join("pak01_dir.vpk")),
        ];
        parts.extend(names.iter().map(|f| format!("{f}={}", stamp(&dir.join(f)))));
        parts.join("|")
    }

    /// Check, and rebuild when something changed. Never fails; None when nothing needed doing.
    pub fn refresh(&mut self, game: Option<&Path>, dir: &Path, diag: &mut dyn FnMut(String)) -> Option<String> {
        let game = game?;
        let key = Self::key_of(game, dir);
        let retry_due = self.failed_at.is_some_and(|t| t.elapsed() >= self.retry);
        if self.last_key.as_deref() == Some(key.as_str()) && !retry_due {
            return None;
        }
        self.last_key = Some(key);
        match apply_notice(Some(game), Some(dir)) {
            Ok(result) => {
                // what was just written changes the key; take it from after the write
                self.last_key = Some(Self::key_of(game, dir));
                self.failed_at = None;
                diag(format!("notice text: {result}"));
                Some(result)
            }
            Err(e) => {
                self.failed_at = Some(std::time::Instant::now());
                diag(format!("notice text skipped: {e}"));
                Some(format!("failed: {e}"))
            }
        }
    }

    /// The pak's relPath when the folder holds ours.
    pub fn owned_files(dir: &Path) -> Vec<String> {
        if is_ours(&dir.join(notice_pak())) {
            vec![notice_pak()]
        } else {
            Vec::new()
        }
    }
}

/// For the parity test: a plan as JSON.
pub fn plan_value(p: &Plan) -> Value {
    match p {
        Plan::Skip(why) => json!({ "action": "skip", "why": why }),
        Plan::Remove(why) => json!({ "action": "remove", "why": why }),
        Plan::Write { bytes, language } => {
            json!({ "action": "write", "sha1": crate::safe_zip::sha1_hex(bytes), "language": language })
        }
    }
}
