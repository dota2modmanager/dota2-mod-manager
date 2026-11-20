//! Whether a mod in My mods is the user's own work, enough of it to go to the catalog under their
//! name (crates/mm-core/src/owner/owner_creator.rs refuses the rest, mods_listing.rs tells the
//! window which mods can).

use serde_json::{json, Value};

use crate::i18n::t;
use crate::js::truthy;

fn field<'a>(v: &'a Value, k: &str) -> &'a Value {
    v.get(k).unwrap_or(&Value::Null)
}

/// How much of a mod has to be the user's own before it goes to the catalog under their name
/// (agreed with the catalog's maintainer, 2026-11-20): a recolour made with one button is not an
/// author's work, and the catalog should not get every hero set twice from two "authors"; an
/// hour spent on a hero's parts, sounds or effects is. These are the smallest such pieces.
const PAINT_LAYERS: usize = 3;
const PAINT_COLORS: usize = 2;
const SOUND_EVENTS: usize = 3;
const EFFECT_CHANGES: usize = 3;

/// Whether a mod in My mods can go to the catalog as the user's work: None for one that is not
/// theirs to send (a catalog mod is its author's, a cursor set or a pack is not a mod the catalog
/// takes), Some(Ok) when it can, Some(Err) with what is missing, in words for the user.
pub fn own_work(rec: &Value) -> Option<Result<(), String>> {
    let generated = field(rec, "generated");
    let imported = rec.get("categoryId").and_then(Value::as_str) == Some("imported");
    let pack = rec.get("kind").and_then(Value::as_str) == Some("pack");
    if !(truthy(generated) || imported) || pack || crate::cursors::is_cursor_record(Some(rec)) {
        return None;
    }
    if !truthy(generated) {
        // a file of their own that nothing recognised: made somewhere else, by them
        return Some(Ok(()));
    }
    let count = |k: &str| match field(generated, k) {
        Value::Object(m) => m.len(),
        Value::Array(a) => a.len(),
        _ => 0,
    };
    let thin = |hint: String| Some(Err(t("Для каталога здесь мало своей работы: {0}", &[json!(hint)])));
    if truthy(field(generated, "paint")) {
        let layers = field(generated, "layers").as_object().cloned().unwrap_or_default();
        let colors: std::collections::HashSet<String> = layers.values().map(|v| v.to_string().to_lowercase()).collect();
        return if layers.len() >= PAINT_LAYERS && colors.len() >= PAINT_COLORS {
            Some(Ok(()))
        } else {
            thin(t("перекрась хотя бы {0} части в {1} разных цвета", &[json!(PAINT_LAYERS), json!(PAINT_COLORS)]))
        };
    }
    if truthy(field(generated, "sounds")) {
        return if count("edits") >= SOUND_EVENTS {
            Some(Ok(()))
        } else {
            thin(t("замени звуки хотя бы у {0} событий", &[json!(SOUND_EVENTS)]))
        };
    }
    if truthy(field(generated, "effect")) {
        let changes: usize = field(generated, "edits")
            .as_object()
            .map(|m| m.values().map(|e| e.as_object().map_or(0, |o| o.values().filter(|v| !v.is_null()).count())).sum())
            .unwrap_or(0);
        return if changes >= EFFECT_CHANGES {
            Some(Ok(()))
        } else {
            thin(t("поменяй у эффекта хотя бы {0} настройки", &[json!(EFFECT_CHANGES)]))
        };
    }
    // a colour on a whole set, a HUD's size, a background, icons or towers picked from the game
    thin(t("это выбор из того, что уже есть в игре, а не свой мод", &[]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_work_of_the_users_own_goes_to_the_catalog() {
        let ok = |r: Value| own_work(&r) == Some(Ok(()));
        let thin = |r: Value| matches!(own_work(&r), Some(Err(_)));
        // not theirs to send at all
        assert_eq!(own_work(&json!({ "categoryId": "heroes", "fileRef": "Pudge Red" })), None);
        assert_eq!(own_work(&json!({ "categoryId": "imported", "kind": "pack" })), None);
        let cursor = json!({ "generated": { "cursor": {} }, "files": [{ "root": "cursor", "relPath": "a.cur" }] });
        assert_eq!(own_work(&cursor), None);
        // their own file, made elsewhere
        assert!(ok(json!({ "categoryId": "imported", "fileRef": "glow.vpk" })));
        // one button on a whole set, and picks from the game
        assert!(thin(json!({ "categoryId": "hero-items", "generated": { "set": "pudge", "color": "#ff0000" } })));
        assert!(thin(json!({ "categoryId": "huds", "generated": { "hud": 90 } })));
        assert!(thin(json!({ "generated": { "abilityIcons": "pudge", "picks": [1, 2, 3, 4] } })));
        // a hero painted part by part
        let paint = |layers: Value| json!({ "generated": { "paint": "pudge", "layers": layers } });
        assert!(ok(paint(json!({ "body": "#f00", "hook": "#0f0", "arm": "#f00" }))));
        assert!(thin(paint(json!({ "body": "#f00", "hook": "#f00", "arm": "#F00" }))), "one colour everywhere");
        assert!(thin(paint(json!({ "body": "#f00", "hook": "#0f0" }))));
        // sounds and effects of their own
        assert!(ok(json!({ "generated": { "sounds": "pudge", "edits": [{}, {}, {}] } })));
        assert!(thin(json!({ "generated": { "sounds": "pudge", "edits": [{}] } })));
        let fx =
            |edits: Value| json!({ "categoryId": "imported", "generated": { "effect": "p/x.vpcf", "edits": edits } });
        assert!(ok(fx(json!({ "*": { "size": 150 }, "p/a.vpcf": { "tint": "#fff", "speed": 2 } }))));
        assert!(thin(fx(json!({ "*": { "tint": "#fff" } }))));
    }
}
