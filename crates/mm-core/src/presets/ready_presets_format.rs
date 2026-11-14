//! The ready-made presets' format (src/ready-presets-format.ts, config/presets.json, issue #391):
//! a short list of builds picked from the catalog, signed with the remote config's key. The
//! fetched JSON is cut down to presets with an id, a name and at least one catalog mod.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::js::{slice_utf16, trim};

/// A short list, read by people: more than this is a sign the file was not edited by one.
pub const MAX_PRESETS: usize = 30;
/// Mods in one ready preset at most.
pub const MAX_MODS: usize = 60;
const MAX_TEXT: usize = 300;

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| slice_utf16(trim(s), max)).unwrap_or_default()
}

/// The list as the window and the site show it: `{ id, ru, en, about: { ru, en }, mods }`.
pub fn normalize_ready(raw: &Value) -> Vec<Value> {
    let (Some(o), Some(list)) = (raw.as_object(), raw.get("presets").and_then(Value::as_array)) else { return vec![] };
    if o.get("version").and_then(Value::as_f64) != Some(1.0) {
        return vec![];
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in list.iter().take(MAX_PRESETS) {
        let Some(p) = p.as_object() else { continue };
        let id = text(p.get("id"), 60);
        if id.is_empty()
            || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || seen.contains(&id)
        {
            continue;
        }
        let ru = text(p.get("ru"), 80);
        let en = text(p.get("en"), 80);
        if ru.is_empty() && en.is_empty() {
            continue;
        }
        let about = p.get("about").filter(|a| a.is_object());
        let mods: Vec<Value> = p
            .get("mods")
            .and_then(Value::as_array)
            .map(|m| m.iter().take(MAX_MODS).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .filter(|m| m.is_object())
            .map(|m| {
                let style = text(m.get("style"), MAX_TEXT);
                (text(m.get("category"), 60), text(m.get("name"), MAX_TEXT), style)
            })
            .filter(|(c, n, _)| !c.is_empty() && !n.is_empty())
            .map(|(c, n, s)| json!({ "categoryId": c, "name": n, "styleLabel": if s.is_empty() { Value::Null } else { json!(s) } }))
            .collect();
        if mods.is_empty() {
            continue;
        }
        seen.insert(id.clone());
        let about_of = |k: &str| text(about.and_then(|a| a.get(k)), MAX_TEXT);
        out.push(json!({
            "id": id,
            "ru": if ru.is_empty() { en.clone() } else { ru.clone() },
            "en": if en.is_empty() { ru } else { en },
            "about": { "ru": about_of("ru"), "en": about_of("en") },
            "mods": mods,
        }));
    }
    out
}
