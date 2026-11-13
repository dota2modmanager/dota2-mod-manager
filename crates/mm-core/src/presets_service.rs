//! Everything about presets that needs the running app's state (src/presets-service.ts):
//! receiving a .d2mm or a link as a wish list, applying a preset, which preset you are in, and
//! packing a received preset's mods. The plan of what travels is `preset_plan.rs`.
//!
//! Rebuilding the item table after a preset changed it is the caller's: `apply_preset` says
//! whether it has to, where the TypeScript started the build itself.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::build_undo::touches_schema;
use crate::i18n::t;
use crate::installer::Installer;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::overlays::files_of;
use crate::settings::Settings;

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn kind(v: &Value) -> &str {
    v.get("kind").and_then(Value::as_str).unwrap_or("")
}

/// Can this record go into a pack? Packs, fonts and cursors cannot; a lang-folder VPK can.
pub fn packable_record(rec: Option<&Value>) -> bool {
    rec.is_some_and(|r| {
        kind(r) != "pack"
            && !matches!(r.get("categoryId").and_then(Value::as_str), Some("fonts" | "cursors"))
            && crate::preset_plan::has_lang_vpk(r)
    })
}

/// Whether what is on is exactly this preset: its installed mods and no other, and for a preset
/// that kept its looks, those and no other.
pub fn preset_is_on(lib: &Library, preset: &Value) -> Result<bool, String> {
    let wanted: HashSet<String> = lib.preset_mod_ids(Some(preset))?.iter().map(string).collect();
    let on = |r: &Value| r.get("enabled") != Some(&Value::Bool(false));
    if lib.list().iter().any(|r| Library::in_preset(Some(r)) && on(r) != wanted.contains(&string(&r["id"]))) {
        return Ok(false);
    }
    let Some(picks) = preset.get("picks").and_then(Value::as_array) else { return Ok(true) };
    let key = |p: &Value| {
        let effect = p.get("effectId").filter(|e| truthy(e)).map(string).unwrap_or_default();
        format!(
            "{}|{}|{effect}",
            p.get("slot").map_or("undefined".into(), string),
            p.get("itemId").map_or("undefined".into(), string)
        )
    };
    let live: HashSet<String> = lib.picks_on().iter().map(key).collect();
    let named: HashSet<String> = picks.iter().map(key).collect();
    Ok(live.len() == named.len() && live.iter().all(|k| named.contains(k)))
}

/// Where an imported .d2mm waits until the user installs it.
pub fn shared_preset_file(user_data: &Path, preset_id: &str) -> PathBuf {
    user_data.join("shared-presets").join(format!("{preset_id}.d2mm"))
}

pub fn drop_shared_preset_file(preset: Option<&Value>) {
    if let Some(f) = preset.and_then(|p| p.get("source")).and_then(|s| s.get("file")).filter(|f| truthy(f)) {
        let _ = std::fs::remove_file(string(f));
    }
}

/// A fresh pack out of standalone records, for a received preset; it never absorbs packs the
/// user already has. None when there are fewer than two to pack. `deploy` rebuilds the pack's VPK.
pub fn pack_from_records(
    lib: &mut Library,
    inst: &Installer,
    name: &str,
    rec_ids: &[Value],
    deploy: &mut dyn FnMut(&Value),
) -> Result<Option<Value>, String> {
    let recs: Vec<Value> =
        rec_ids.iter().filter_map(|id| lib.find(id).cloned()).filter(|r| packable_record(Some(r))).collect();
    if recs.len() < 2 {
        return Ok(None);
    }
    let target = lib
        .add(&json!({ "name": name, "categoryId": "combined", "styleLabel": null, "fileRef": null, "preview": null, "files": [], "kind": "pack", "members": [] }), None)
        .map_err(io)?;
    let id = target["id"].clone();
    std::fs::create_dir_all(inst.pack_folder(&string(&id))).map_err(io)?;
    let mut members: Vec<Value> = Vec::new();
    for r in &recs {
        members.push(inst.add_pack_member_from_record(&string(&id), r, &uuid::Uuid::new_v4().to_string())?);
        let _ = inst.remove(&files_of(r.get("files").unwrap_or(&Value::Null)), None, true);
        lib.remove_record(&r["id"], None).map_err(io)?;
    }
    lib.update(&id, &json!({ "members": members }), None).map_err(io)?;
    let target = lib.find(&id).cloned().unwrap_or(target);
    deploy(&target);
    Ok(Some(target))
}

/// A received .d2mm checked and parked in the Presets tab as a not-yet-installed preset; nothing
/// goes into the game. A file with embedded mods is kept beside the app until "Install".
pub fn import_preset_file(lib: &mut Library, user_data: &Path, file: &Path) -> Value {
    let r = (|| -> Result<Value, String> {
        let f = crate::preset_share::PresetFile::open(file)?;
        let mods = f.manifest["mods"].as_array().cloned().unwrap_or_default();
        if mods.is_empty() {
            return Err(t("В пресете нет модов", &[]));
        }
        let m = &f.manifest;
        let mut preset = lib
            .add_shared_preset(
                &json!({ "name": m["name"], "note": m["note"], "author": m["author"], "wanted": mods }),
                None,
            )
            .map_err(io)?;
        let embeds = |e: &Value| {
            kind(e) == "embedded"
                || (kind(e) == "pack"
                    && e["members"].as_array().is_some_and(|m| m.iter().any(|m| kind(m) == "embedded")))
        };
        if mods.iter().any(embeds) {
            let dest = shared_preset_file(user_data, &string(&preset["id"]));
            std::fs::create_dir_all(dest.parent().unwrap()).map_err(io)?;
            std::fs::copy(file, &dest).map_err(io)?;
            let mut source = preset["source"].clone();
            source["file"] = json!(dest.to_string_lossy());
            preset =
                lib.update_preset(&preset["id"], &json!({ "source": source }), None).map_err(io)?.unwrap_or(preset);
        }
        Ok(preset)
    })();
    match r {
        Ok(p) => json!({ "ok": true, "preset": p }),
        Err(e) => json!({ "error": e }),
    }
}

/// A pasted d2mm://preset/... link: the same landing as a file, with no payload to keep.
pub fn import_preset_link(lib: &mut Library, text: &Value) -> Value {
    let r = (|| -> Result<Value, String> {
        let d = crate::preset_link::decode_preset_link(text)?;
        if d.mods.is_empty() {
            return Err(t("В пресете нет модов", &[]));
        }
        lib.add_shared_preset(&json!({ "name": d.name, "note": "", "author": d.author, "wanted": d.mods }), None)
            .map_err(io)
    })();
    match r {
        Ok(p) => json!({ "ok": true, "preset": p }),
        Err(e) => json!({ "error": e }),
    }
}

/// What applying a preset left: each failure as "<name>: <reason>", and whether the item table
/// needs a build now.
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize)]
pub struct Applied {
    pub errors: Vec<String>,
    pub schema_touched: bool,
}

/// Exactly the preset's mods on and every other off, and the same for its looks: each on in its
/// slot, every other look off, kept in My mods. A preset saved before it kept looks leaves them
/// be; `picks` false leaves them be as well (the remote config switched looks off). `pick` puts
/// one look on without writing (`schema_cosmetics::pick_cosmetic`).
pub fn apply_preset(
    lib: &mut Library,
    inst: &Installer,
    settings: Option<&mut Settings>,
    preset: &Value,
    picks: bool,
    pick: &mut dyn FnMut(&mut Library, &Value) -> Result<(), String>,
) -> Result<Applied, String> {
    let wanted: HashSet<String> = lib.preset_mod_ids(Some(preset))?.iter().map(string).collect();
    let mut out = Applied::default();
    let recs: Vec<Value> = lib.list().iter().filter(|r| Library::in_preset(Some(r))).cloned().collect();
    // off first, then on: two cursor sets cannot be live at once, so the outgoing one puts the
    // vanilla files back before the incoming one writes over them
    for pass in [false, true] {
        for rec in &recs {
            let id = string(&rec["id"]);
            let enable = wanted.contains(&id);
            let now = lib.find(&rec["id"]).map(|r| r.get("enabled").cloned().unwrap_or(Value::Null));
            if enable != pass || now == Some(Value::Bool(enable)) {
                continue;
            }
            let r = inst
                .set_enabled(&files_of(rec.get("files").unwrap_or(&Value::Null)), enable, Some(&id))
                .and_then(|_| lib.set_enabled(&rec["id"], enable, None).map(|_| ()).map_err(io));
            match r {
                Ok(()) => out.schema_touched |= touches_schema(rec),
                Err(e) => out.errors.push(format!("{}: {e}", rec.get("name").map_or("undefined".into(), string))),
            }
        }
    }
    if let (true, Some(list)) = (picks, preset.get("picks").and_then(Value::as_array)) {
        let pair = |p: &Value| {
            format!(
                "{}|{}",
                p.get("slot").map_or("undefined".into(), string),
                p.get("itemId").map_or("undefined".into(), string)
            )
        };
        let named: HashSet<String> = list.iter().map(pair).collect();
        let off: Vec<Value> = lib
            .list()
            .iter()
            .filter(|r| {
                r.get("enabled") != Some(&Value::Bool(false)) && Library::is_pick(Some(r)) && !named.contains(&pair(r))
            })
            .map(|r| r["id"].clone())
            .collect();
        for id in off {
            lib.set_enabled(&id, false, None).map_err(io)?;
            out.schema_touched = true;
        }
        for p in list {
            match pick(lib, p) {
                Ok(()) => out.schema_touched = true,
                Err(e) => out.errors.push(format!("{}: {e}", p.get("name").map_or("undefined".into(), string))),
            }
        }
    }
    if let Some(st) = settings {
        st.set("lastPreset", preset.get("id").cloned().unwrap_or(Value::Null)).map_err(io)?;
    }
    Ok(out)
}

/// Which preset you are in, for its card: this one exactly ("active"), or the one applied last
/// and changed since ("changed"). One with members not installed is yours only if you applied it.
pub fn preset_state(lib: &Library, settings: Option<&Settings>, preset: &Value) -> Result<Value, String> {
    let last = settings.and_then(|s| s.get("lastPreset")).is_some_and(|l| Some(l) == preset.get("id"));
    let whole = lib.preset_members(Some(preset))?.iter().all(|m| m.rec.is_some());
    if (whole || last) && preset_is_on(lib, preset)? {
        return Ok(json!("active"));
    }
    Ok(if last { json!("changed") } else { Value::Null })
}
