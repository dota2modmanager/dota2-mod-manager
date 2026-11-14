//! The pumpkin's side of the key (src/pumpkin.ts; renderer/ui/pumpkin.ts asks, tools/pumpkin-worker
//! answers). Each key the site hands out opens one pumpkin: the worker ties it to the first install
//! name that brings it, a random name made here the first time it is needed and sent nowhere else.
//! The key opens the bloody theme (settings `blood`) and a mod nobody else has yet, downloaded from
//! the worker and taken in the way any dropped .vpk is. The key is kept, so the mod can be fetched
//! again. Case, spaces and dashes do not count, and a key typed on a Russian layout or with
//! Cyrillic look-alikes is read back as the Latin it meant.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::library::Library;
use crate::net_fetch::Net;
use crate::settings::Settings;

/// The worker that keeps the keys and the prize (tools/pumpkin-worker).
pub const PUMPKIN_HOST: &str = "https://pumpkin.dota2modmanager.com";
/// What the mod is called in the library.
pub const PRIZE_NAME: &str = "Necrophos - Scream";
/// Which night this install has been through: a new number makes everybody walk it again.
pub const NIGHT_ROUND: i64 = 1;

// the ЙЦУКЕН keys, in the order of the QWERTY keys they sit on
const RU_KEYS: &str = "йцукенгшщзфывапролдячсмить";
const EN_KEYS: &str = "qwertyuiopasdfghjklzxcvbnm";

fn lookalike(c: char) -> char {
    match c {
        'А' => 'A',
        'В' => 'B',
        'Е' => 'E',
        'К' => 'K',
        'М' => 'M',
        'Н' => 'H',
        'О' => 'O',
        'Р' => 'P',
        'С' => 'C',
        'Т' => 'T',
        'У' => 'Y',
        'Х' => 'X',
        c => c,
    }
}

fn plain(s: &str) -> String {
    s.to_uppercase().chars().filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit()).collect()
}

/// Every reading of what was typed that could be a key: 16 Latin letters and digits.
pub fn readings(typed: &str) -> Vec<String> {
    let en: Vec<char> = EN_KEYS.chars().collect();
    let as_keys: String =
        typed.to_lowercase().chars().map(|c| RU_KEYS.chars().position(|r| r == c).map_or(c, |i| en[i])).collect();
    let as_looks: String = typed.to_uppercase().chars().map(lookalike).collect();
    let mut out: Vec<String> = Vec::new();
    for r in [plain(&as_looks), plain(typed), plain(&as_keys)] {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out.retain(|r| r.len() == 16);
    out
}

/// The night from the beginning, once per round, for every install: the pumpkin goes back in, the
/// two themes it opened close, and a window wearing one of them goes back to Ursa. The key spent
/// and the mod it brought stay. True when this start was the one that reset it.
pub fn begin_night_again(settings: &mut Settings) -> std::io::Result<bool> {
    if settings.get("nightRound").and_then(Value::as_f64) == Some(NIGHT_ROUND as f64) {
        return Ok(false);
    }
    for k in ["pumpkin", "secret", "pumpkinLit", "blood"] {
        settings.set(k, json!(false))?;
    }
    if matches!(settings.get("theme").and_then(Value::as_str), Some("secret" | "blood")) {
        settings.set("theme", json!("ursa"))?;
    }
    settings.set("nightRound", json!(NIGHT_ROUND))?;
    Ok(true)
}

fn encode(s: &str) -> String {
    // encodeURIComponent
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// What takes a downloaded .vpk in as a mod: the import's answer, `{imported: [{name, relPath}],
/// errors: [{error}]}` or `{error}`, as the window's own import gives it.
pub type Import<'a> = &'a mut dyn FnMut(&[PathBuf], &mut Library) -> Value;

/// The pumpkin's side in the main process, over the network and the worker's address.
pub struct Pumpkin<'a> {
    pub net: &'a Net,
    pub host: String,
    /// the language the game speaks in, when Valve's voice for it is on disk
    pub voice: Option<String>,
}

const TIMEOUT: u64 = 120_000;

impl Pumpkin<'_> {
    /// This install's name for the worker, made the first time it is asked for.
    pub fn install(settings: &mut Settings) -> std::io::Result<String> {
        let id = settings.get("pumpkinInstall").and_then(Value::as_str).map(str::to_string);
        let good = id
            .as_ref()
            .is_some_and(|i| i.len() == 32 && i.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        if let (true, Some(id)) = (good, id) {
            return Ok(id);
        }
        // 16 random bytes in hex, as crypto.randomBytes makes them (a v4 uuid is 122 of them)
        let id = uuid::Uuid::new_v4().simple().to_string();
        settings.set("pumpkinInstall", json!(id))?;
        Ok(id)
    }

    /// Download the prize and take it in as a mod: the name of the record, or why not.
    fn fetch_prize(
        &self,
        key: &str,
        settings: &mut Settings,
        lib: &mut Library,
        import: Import,
    ) -> Result<String, String> {
        let q = format!("key={}&install={}", encode(key), Self::install(settings).map_err(|e| e.to_string())?);
        let dir = crate::import::mkdtemp("mm-pumpkin-")?;
        let voice =
            self.voice.as_ref().filter(|v| !v.is_empty()).map(|v| format!("&voice={}", encode(v))).unwrap_or_default();
        let (status, _, body) = self
            .net
            .direct_typed("GET", &format!("{}/mod?{q}{voice}", self.host), &[], None, TIMEOUT)
            .map_err(|e| e.message)?;
        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status}"));
        }
        let file = dir.0.join(format!("{PRIZE_NAME}.vpk"));
        std::fs::write(&file, body).map_err(|e| e.to_string())?;
        let answer = import(&[file], lib);
        let Some(got) = answer.get("imported").and_then(Value::as_array).and_then(|a| a.first()).cloned() else {
            let why = answer
                .get("error")
                .filter(|e| crate::js::truthy(e))
                .or_else(|| {
                    answer
                        .get("errors")
                        .and_then(|e| e.get(0))
                        .and_then(|e| e.get("error"))
                        .filter(|e| crate::js::truthy(e))
                })
                .map_or("not imported".into(), crate::js::string);
            return Err(why);
        };
        // its picture, so the library shows what it is rather than a blank
        if let Ok((status, kind, data)) =
            self.net.direct_typed("GET", &format!("{}/mod/preview?{q}", self.host), &[], None, TIMEOUT)
        {
            if (200..300).contains(&status) {
                let rel = got.get("relPath").cloned().unwrap_or(Value::Null);
                let id = lib
                    .list()
                    .iter()
                    .find(|r| r.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("relPath")) == Some(&rel))
                    .map(|r| r["id"].clone());
                if let Some(id) = id {
                    use base64::Engine as _;
                    let kind = kind.filter(|k| !k.is_empty()).unwrap_or_else(|| "image/png".into());
                    let url = format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&data));
                    let _ = lib.update(&id, &json!({ "preview": url }), None);
                }
            }
        }
        Ok(got.get("name").map(crate::js::string).unwrap_or_default())
    }

    /// Spend a key on this install: the theme, then the mod. The window's answer.
    pub fn redeem(
        &self,
        typed: &Value,
        settings: &mut Settings,
        lib: &mut Library,
        import: Import,
        log: &mut dyn FnMut(String),
    ) -> Value {
        let text = if typed.is_null() { String::new() } else { crate::js::string(typed) };
        let tries = readings(&text);
        if tries.is_empty() {
            return json!({ "error": if crate::js::trim(&text).is_empty() { "empty" } else { "wrong" } });
        }
        let mut answer = json!({ "error": "wrong" });
        for key in tries {
            let install = match Self::install(settings) {
                Ok(i) => i,
                Err(e) => return json!({ "error": "broken", "detail": e.to_string() }),
            };
            let body = json!({ "key": key, "install": install }).to_string();
            let res = self.net.direct(
                "POST",
                &format!("{}/redeem", self.host),
                &[("Content-Type", "application/json")],
                Some(body.as_bytes()),
                TIMEOUT,
            );
            let status = match res {
                Ok((status, _)) => status,
                Err(e) => {
                    log(format!("pumpkin: {}", e.message));
                    return json!({ "error": "offline", "detail": e.message });
                }
            };
            if (200..300).contains(&status) {
                let _ = settings.set("blood", json!(true));
                let _ = settings.set("bloodKey", json!(key));
                return match self.fetch_prize(&key, settings, lib, import) {
                    Ok(name) => json!({ "ok": true, "installed": name }),
                    Err(e) => {
                        log(format!("pumpkin: the prize did not land: {e}"));
                        json!({ "ok": true, "installed": null, "installError": e })
                    }
                };
            }
            if status == 409 {
                answer = json!({ "error": "used" });
            } else if status != 404 && status != 400 {
                answer = json!({ "error": "broken", "detail": format!("HTTP {status}") });
            }
        }
        answer
    }

    /// The mod again, for an install that has spent its key and removed the mod since.
    pub fn prize_again(&self, settings: &mut Settings, lib: &mut Library, import: Import) -> Value {
        let Some(key) = settings.get("bloodKey").and_then(Value::as_str).filter(|k| !k.is_empty()).map(str::to_string)
        else {
            return json!({ "error": "no key" });
        };
        match self.fetch_prize(&key, settings, lib, import) {
            Ok(name) => json!({ "ok": true, "installed": name }),
            Err(e) => json!({ "error": e }),
        }
    }

    /// Whether the prize is in the library now.
    pub fn has_prize(lib: &Library) -> bool {
        lib.list().iter().any(|r| r.get("name").and_then(Value::as_str) == Some(PRIZE_NAME))
    }
}
