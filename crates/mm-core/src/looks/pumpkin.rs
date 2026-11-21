//! The pumpkin's side of the key (renderer/ui/pumpkin.ts asks, tools/ops/pumpkin-worker
//! answers). Each key the site hands out opens one pumpkin: the worker ties it to the first install
//! name that brings it, a random name made here the first time it is needed and sent nowhere else.
//! The key opens the bloody theme (settings `blood`). Until Halloween 2026 was over it also brought
//! a mod nobody else had, Necrophos Scream; that mod is in the catalog now, and the window sends
//! whoever opens the pumpkin there. Case, spaces and dashes do not count, and a key typed on a
//! Russian layout or with Cyrillic look-alikes is read back as the Latin it meant.

use serde_json::{json, Value};

use crate::net_fetch::Net;
use crate::settings::Settings;

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

/// The pumpkin's side in the core, over the network and the worker's address.
pub struct Pumpkin<'a> {
    pub net: &'a Net,
    pub host: String,
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

    /// Spend a key on this install: the theme. The window's answer.
    pub fn redeem(&self, typed: &Value, settings: &mut Settings, log: &mut dyn FnMut(String)) -> Value {
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
                return json!({ "ok": true });
            }
            if status == 409 {
                answer = json!({ "error": "used" });
            } else if status != 404 && status != 400 {
                answer = json!({ "error": "broken", "detail": format!("HTTP {status}") });
            }
        }
        answer
    }
}
