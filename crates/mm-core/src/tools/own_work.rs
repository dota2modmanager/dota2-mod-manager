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
/// A pack with no single piece above the bar is still an author's work when it brings this many
/// of the user's own mods together: a recoloured set, the items picked for it, its effects.
const PACK_PIECES: usize = 4;

/// What a pack member keeps of the record it was made from (installer_repack.rs) and gives back
/// when it is taken out of the pack (owner_packs.rs): the tool that made it, and whether the file
/// came in somebody else's preset.
const ORIGIN: &[&str] = &["generated", "shared"];

/// The [`ORIGIN`] fields a record or a member has.
pub fn origin(v: &Value) -> serde_json::Map<String, Value> {
    ORIGIN.iter().filter_map(|k| v.get(*k).filter(|v| truthy(v)).map(|v| ((*k).to_string(), v.clone()))).collect()
}

/// Why the user's own music stays out of the catalog (own_music_service.rs): its pak carries every
/// music pack's events, and only the app that built it rebuilds them after a Dota update.
fn music_stays() -> String {
    t(
        "Своя музыка не уходит в каталог: она переписывает файлы событий всех музыкальных паков, и после обновления Доты чужая копия сломает игру. У тебя она пересобирается сама",
        &[],
    )
}

/// Whether a mod in My mods can go to the catalog as the user's work: None for one that is not
/// theirs to send (a catalog mod or a shared preset's file is its author's, a cursor set is not a
/// mod the catalog takes), Some(Ok) when it can, Some(Err) with what is missing, in words for the
/// user. `in_catalog` says whether a fingerprint is a catalog mod's: a file dragged in from the
/// catalog's own download is "imported" too, and it is not the user's work.
pub fn own_work(rec: &Value, in_catalog: &mut dyn FnMut(&str) -> bool) -> Option<Result<(), String>> {
    if rec.get("kind").and_then(Value::as_str) == Some("pack") {
        return pack_work(rec, in_catalog);
    }
    let generated = field(rec, "generated");
    let imported = rec.get("categoryId").and_then(Value::as_str) == Some("imported");
    if !(truthy(generated) || imported) || truthy(field(rec, "shared")) || crate::cursors::is_cursor_record(Some(rec)) {
        return None;
    }
    // a pack member keeps its fingerprint as "fp", a listed record as "fpOriginal" or "fp"
    let fp = ["fpOriginal", "fp"].iter().find_map(|k| rec.get(*k).and_then(Value::as_str).filter(|f| !f.is_empty()));
    if !truthy(generated) && fp.is_some_and(&mut *in_catalog) {
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
    if truthy(field(generated, "music")) {
        return Some(Err(music_stays()));
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

/// A pack goes as one mod when everything switched on in it is the user's own, and either one
/// piece is real work by itself or there are PACK_PIECES of them. A member packed before members
/// kept their origin reads as somebody else's: taking it out and back in does not bring it back,
/// so the answer names it.
fn pack_work(rec: &Value, in_catalog: &mut dyn FnMut(&str) -> bool) -> Option<Result<(), String>> {
    let on: Vec<&Value> = field(rec, "members")
        .as_array()
        .map(|m| m.iter().filter(|m| m.get("enabled") != Some(&Value::Bool(false))).collect())
        .unwrap_or_default();
    // the music cannot go in any pack: what keeps it working is this app rebuilding it
    if on.iter().any(|m| truthy(field(field(m, "generated"), "music"))) {
        return Some(Err(music_stays()));
    }
    let verdicts: Vec<Option<Result<(), String>>> = on.iter().map(|m| own_work(m, in_catalog)).collect();
    if verdicts.iter().all(Option::is_none) {
        return None;
    }
    let foreign: Vec<String> = on
        .iter()
        .zip(&verdicts)
        .filter(|(_, v)| v.is_none())
        .map(|(m, _)| crate::js::string(field(m, "name")))
        .collect();
    if !foreign.is_empty() {
        let mut names = foreign.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
        if foreign.len() > 3 {
            names.push_str(", ...");
        }
        return Some(Err(t(
            "В паке есть моды, сделанные не тобой: {0}. Выключи их или убери из пака",
            &[json!(names)],
        )));
    }
    if verdicts.iter().any(|v| matches!(v, Some(Ok(())))) || on.len() >= PACK_PIECES {
        return Some(Ok(()));
    }
    Some(Err(t(
        "Для каталога здесь мало своей работы: добавь в пак перекраску по частям, свои звуки или эффект, или собери его хотя бы из {0} своих модов",
        &[json!(PACK_PIECES)],
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_work_of_the_users_own_goes_to_the_catalog() {
        let own_work = |r: &Value| own_work(r, &mut |f| f == "catalog-fp");
        let ok = |r: Value| own_work(&r) == Some(Ok(()));
        let thin = |r: Value| matches!(own_work(&r), Some(Err(_)));
        // not theirs to send at all
        assert_eq!(own_work(&json!({ "categoryId": "heroes", "fileRef": "Pudge Red" })), None);
        assert_eq!(own_work(&json!({ "categoryId": "imported", "kind": "pack" })), None);
        assert_eq!(own_work(&json!({ "categoryId": "imported", "fileRef": "x.vpk", "shared": true })), None);
        let cursor = json!({ "generated": { "cursor": {} }, "files": [{ "root": "cursor", "relPath": "a.cur" }] });
        assert_eq!(own_work(&cursor), None);
        // their own file, made elsewhere; the catalog's own download dragged in is not
        assert!(ok(json!({ "categoryId": "imported", "fileRef": "glow.vpk", "fp": "mine" })));
        assert_eq!(
            own_work(&json!({ "categoryId": "imported", "fileRef": "pak29_dir.vpk", "fp": "catalog-fp" })),
            None
        );
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

    #[test]
    fn a_pack_goes_when_all_of_it_is_the_users_own() {
        let pack = |members: Value| {
            own_work(&json!({ "kind": "pack", "categoryId": "combined", "members": members }), &mut |f| {
                f == "catalog-fp"
            })
        };
        let set =
            json!({ "name": "Red set", "categoryId": "hero-items", "generated": { "set": "pudge", "color": "#f00" } });
        let hud = json!({ "name": "HUD", "categoryId": "huds", "generated": { "hud": 90 } });
        let bg = json!({ "name": "Bg", "categoryId": "backgrounds", "generated": { "background": "x" } });
        let sounds = json!({ "name": "Sounds", "generated": { "sounds": "pudge", "edits": [{}, {}, {}] } });
        let catalog = json!({ "name": "Pudge Red", "categoryId": "heroes" });
        let shared = json!({ "name": "Glow", "categoryId": "imported", "shared": true });
        let dragged = json!({ "name": "Emblem", "categoryId": "imported", "fp": "catalog-fp" });
        // catalog mods only: not the user's to send, no menu item
        assert_eq!(pack(json!([catalog, catalog])), None);
        // a piece of real work carries picks along with it
        assert_eq!(pack(json!([set, sounds])), Some(Ok(())));
        // picks alone: enough of them is an hour of work, two is not
        assert!(matches!(pack(json!([set, hud])), Some(Err(_))));
        let file = json!({ "name": "Mine", "categoryId": "imported" });
        assert_eq!(pack(json!([set, hud, bg, file])), Some(Ok(())));
        // somebody else's mod inside stops it, by name, unless it is switched off
        let Some(Err(why)) = pack(json!([sounds, catalog, shared, dragged])) else { panic!() };
        assert!(why.contains("Pudge Red") && why.contains("Glow") && why.contains("Emblem"), "{why}");
        let mut off = catalog.clone();
        off["enabled"] = json!(false);
        assert_eq!(pack(json!([sounds, off])), Some(Ok(())));
        // the user's own music stays home, alone or inside a pack, unless it is switched off there
        let music = json!({ "name": "Своя музыка", "generated": { "music": true, "songs": [{}, {}] } });
        assert_eq!(own_work(&music, &mut |_| false), Some(Err(music_stays())));
        assert_eq!(pack(json!([sounds, music])), Some(Err(music_stays())));
        let mut quiet = music.clone();
        quiet["enabled"] = json!(false);
        assert_eq!(pack(json!([sounds, quiet])), Some(Ok(())));
    }
}
