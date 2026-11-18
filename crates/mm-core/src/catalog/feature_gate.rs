//! Is this feature switched off right now (src/feature-gate.ts)? `config/app.json` can turn a
//! feature off after a release, and the check sits on the main-process side of every channel it
//! guards. Dota being open closes every gate too: the game holds its files.

use serde_json::{json, Value};

use crate::i18n::t;

/// The answer to send back instead of running the channel, or None to carry on.
/// `feature` is the remote config's (off, note) for the feature in the user's language.
pub fn gate(game_open: bool, feature: impl FnOnce() -> (bool, String)) -> Option<Value> {
    if game_open {
        return Some(json!({
            "error": t("Dota 2 открыта. Закрой игру, и моды можно будет ставить и переключать", &[]),
            "gameOpen": true,
        }));
    }
    let (off, note) = feature();
    if !off {
        return None;
    }
    Some(json!({ "error": if note.is_empty() { t("Эта возможность временно отключена", &[]) } else { note } }))
}

/// The language the remote config's notes are read in: Russian or English.
pub fn note_lang(settings: &Value) -> &'static str {
    if settings.get("uiLang").and_then(Value::as_str) == Some("ru") {
        "ru"
    } else {
        "en"
    }
}
