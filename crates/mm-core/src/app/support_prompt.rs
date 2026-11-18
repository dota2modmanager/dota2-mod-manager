//! When the window asking people to support the project comes up on its own
//! (src/support-prompt.ts): not before the third launch, "later" puts it away for a week, three
//! times at most; after that, or after "I did it", it only opens from Settings.

use serde::Serialize;
use serde_json::Value;

/// The launch it first opens on.
pub const FIRST_LAUNCH: f64 = 3.0;
/// How long "later" puts it away for: a week.
pub const SNOOZE_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;
/// How many times it comes back after the first.
pub const MAX_REMINDERS: f64 = 3.0;

/// What settings.json keeps about the window, under supportPrompt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SupportPrompt {
    pub launches: f64,
    pub state: &'static str,
    pub until: f64,
    pub later: f64,
}

impl SupportPrompt {
    /// As settings.json writes it.
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "launches": crate::js::json_number(self.launches), "state": self.state,
            "until": crate::js::json_number(self.until), "later": crate::js::json_number(self.later),
        })
    }
}

/// Whatever settings.json holds, as a prompt state: a missing or hand-edited value starts fresh.
pub fn read_prompt(raw: &Value) -> SupportPrompt {
    let n = |v: Option<&Value>| match v.and_then(Value::as_f64) {
        Some(x) if x.is_finite() && x >= 0.0 => x,
        _ => 0.0,
    };
    // anything truthy that is not an object (an array is one to JavaScript) reads as an object
    // without the fields
    let o = match raw {
        Value::Object(_) | Value::Array(_) => Some(raw),
        _ => None,
    };
    let Some(o) = o else { return SupportPrompt { launches: 0.0, state: "new", until: 0.0, later: 0.0 } };
    let state = match o.get("state").and_then(Value::as_str) {
        Some("later") => "later",
        Some("done") => "done",
        _ => "new",
    };
    SupportPrompt { launches: n(o.get("launches")), state, until: n(o.get("until")), later: n(o.get("later")) }
}

/// One more launch.
pub fn counted(p: &SupportPrompt) -> SupportPrompt {
    SupportPrompt { launches: p.launches + 1.0, ..p.clone() }
}

/// Whether the window opens on its own now.
pub fn due(p: &SupportPrompt, now: f64) -> bool {
    p.state != "done" && p.launches >= FIRST_LAUNCH && now >= p.until
}

/// What the user's answer leaves behind.
pub fn choose(p: &SupportPrompt, choice: &str, now: f64) -> SupportPrompt {
    if choice == "done" {
        return SupportPrompt { state: "done", ..p.clone() };
    }
    let later = p.later + 1.0;
    if later > MAX_REMINDERS {
        return SupportPrompt { later, state: "done", ..p.clone() };
    }
    SupportPrompt { later, state: "later", until: now + SNOOZE_MS, ..p.clone() }
}
