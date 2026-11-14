//! Putting a preset on (src/preset-install.ts): an own one whose mods may have gone, or a
//! received one that is still a wish list. The Presets screen and the command line both come
//! through here: the same catalog downloads, the same one-cursor rule, the table built once.
//!
//! What the app around it does is handed in: the download of a catalog mod (`Deps::fetch`, it
//! moves with the catalog), a look put on, a pack built, the progress line. Building the item
//! table and redeploying after the master switch are the caller's: the answer says which.

use std::collections::HashSet;
use std::path::Path;

use serde_json::{json, Value};

use crate::i18n::t;
use crate::installer::Installer;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::preset_plan::CatalogIndex;
use crate::settings::Settings;

/// One look on in its slot: the record it is now.
pub type PickLook = dyn FnMut(&mut Library, &Value) -> Result<Option<Value>, String>;

/// What putting a preset on needs from the app around it.
pub struct Deps<'a> {
    pub inst: &'a Installer,
    pub lib: &'a mut Library,
    pub settings: Option<&'a mut Settings>,
    /// the game's own item table, for lifting the blocks out of a received mod
    pub vanilla: Option<&'a [u8]>,
    /// why looks are off right now (the remote config), or None
    pub cosmetics_blocked: Option<String>,
    /// a catalog hit downloaded and unpacked into the game: the files it became
    pub fetch: &'a mut dyn FnMut(&Value) -> Result<Vec<Value>, String>,
    /// one look on, without writing the table (`schema_cosmetics::pick_cosmetic`)
    pub pick: &'a mut PickLook,
    /// a pack's VPK rebuilt
    pub deploy_pack: &'a mut dyn FnMut(&mut Library, &Value),
    pub progress: &'a mut dyn FnMut(Value),
}

/// How applying went, and what the caller has to do now.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Outcome {
    /// `{ ok, installed, missing?, errors }` or `{ error }`, as the window gets it
    pub answer: Value,
    /// the item table needs a build
    pub schema: bool,
    /// mods arrived: what follows the master switch has to run (`afterDeployMaster`)
    pub after_master: bool,
}

fn name_of(v: &Value) -> String {
    v.get("name").map_or_else(|| "undefined".into(), string)
}

/// One mod out of the catalog, by the name a preset remembers it under, into the library: the
/// record, or None with the reason pushed onto `errors`.
pub fn install_from_catalog(
    d: &mut Deps,
    identity: &Value,
    cat: &CatalogIndex,
    errors: &mut Vec<String>,
) -> Result<Option<Value>, String> {
    let (c, n, s) = (identity.get("categoryId"), identity.get("name"), identity.get("styleLabel"));
    if let Some(have) = d.lib.find_by_key(c.unwrap_or(&Value::Null), n.unwrap_or(&Value::Null), s) {
        return Ok(Some(have.clone()));
    }
    // an entry with no file to fetch is as good as absent
    let Some(hit) = cat.lookup(c, n, s).filter(|h| h.get("fileRef").is_some_and(truthy)).cloned() else {
        errors.push(format!("{}: {}", name_of(identity), t("нет в каталоге", &[])));
        return Ok(None);
    };
    let cursors = hit.get("categoryId").and_then(Value::as_str) == Some("cursors");
    if cursors {
        crate::cursors::disable_other_cursors(d.inst, d.lib, None); // one cursor at a time
    }
    let files = (d.fetch)(&hit)?;
    let get = |k: &str| hit.get(k).cloned().unwrap_or(Value::Null);
    let rec = d
        .lib
        .add(&json!({ "categoryId": get("categoryId"), "name": get("name"), "styleLabel": get("styleLabel"), "fileRef": get("fileRef"), "preview": get("preview"), "files": files }), None)
        .map_err(|e| e.to_string())?;
    if cursors {
        let _ = d.inst.ensure_cursor_store(rec["id"].as_str(), &crate::overlays::files_of(&json!(files)));
    }
    Ok(Some(rec))
}

/// An own preset: whatever the catalog still has of its gone mods installed first, a mod of the
/// user's own named as missing, then the preset applied. A mod that could not be switched fails
/// the preset; one that could not be fetched is a warning.
pub fn apply_own(d: &mut Deps, preset: &Value, cat: &CatalogIndex) -> Result<Outcome, String> {
    let absent: Vec<Value> =
        d.lib.preset_members(Some(preset))?.into_iter().filter(|m| m.rec.is_none()).map(|m| m.identity).collect();
    let mut missing = Vec::new();
    let mut errors = Vec::new();
    let mut installed = 0;
    for identity in &absent {
        if identity.get("categoryId").and_then(Value::as_str) == Some("imported") {
            missing.push(name_of(identity));
            continue;
        }
        (d.progress)(json!({ "type": "stage", "label": identity.get("name"), "stage": t("установка", &[]) }));
        match install_from_catalog(d, identity, cat, &mut errors) {
            Ok(Some(_)) => installed += 1,
            Ok(None) => {}
            Err(e) => errors.push(format!("{}: {e}", name_of(identity))),
        }
    }
    // looks switched off remotely: the mods alone, and why
    let has_picks = preset.get("picks").and_then(Value::as_array).is_some_and(|p| !p.is_empty());
    let off = if has_picks { d.cosmetics_blocked.clone() } else { None };
    if let Some(why) = &off {
        errors.push(why.clone());
    }
    let applied = apply(d, preset, off.is_none())?;
    if installed > 0 {
        (d.progress)(json!({ "type": "done", "label": preset.get("name") }));
    }
    let answer = if applied.errors.is_empty() {
        json!({ "ok": true, "installed": installed, "missing": missing, "errors": errors })
    } else {
        errors.extend(applied.errors);
        json!({ "error": errors.join("\n") })
    };
    Ok(Outcome { answer, schema: applied.schema_touched, after_master: installed > 0 })
}

fn apply(d: &mut Deps, preset: &Value, picks: bool) -> Result<crate::presets_service::Applied, String> {
    let pick = &mut *d.pick;
    let mut on = |lib: &mut Library, p: &Value| pick(lib, p).map(|_| ());
    crate::presets_service::apply_preset(d.lib, d.inst, d.settings.as_deref_mut(), preset, picks, &mut on)
}

/// A received preset, from a .d2mm or a link: each entry fetched, unpacked or picked, then put on
/// as an ordinary preset.
pub fn resolve(d: &mut Deps, preset: &Value, cat: &CatalogIndex) -> Result<Outcome, String> {
    let stash = preset.get("source").and_then(|s| s.get("file")).filter(|f| truthy(f)).map(string);
    let mut bundle = match stash.as_deref().filter(|s| Path::new(s).exists()) {
        Some(s) => match crate::preset_share::PresetFile::open(Path::new(s)) {
            Ok(b) => Some(b),
            Err(e) => return Ok(Outcome { answer: json!({ "error": e }), schema: false, after_master: false }),
        },
        None => None,
    };
    let mut fps = crate::preset_plan::installed_fp_index(d.lib, d.inst);
    let mut errors: Vec<String> = Vec::new();
    let mut schema = false;
    // the ids of the library records that now provide this mod (a multi-hero bundle splits into
    // several), or none when it could not be resolved at all
    let mut resolve_entry = |d: &mut Deps, entry: &Value, errors: &mut Vec<String>| -> Vec<Value> {
        let r = (|| -> Result<Vec<Value>, String> {
            match entry.get("kind").and_then(Value::as_str) {
                Some("catalog") => {
                    Ok(install_from_catalog(d, entry, cat, errors)?.map(|r| vec![r["id"].clone()]).unwrap_or_default())
                }
                Some("embedded") => {
                    let fp = entry.get("fp").filter(|f| truthy(f)).map(string);
                    if let Some(on_disk) = fp.as_ref().and_then(|f| fps.get(f)) {
                        return Ok(vec![on_disk.clone()]);
                    }
                    let Some(b) = bundle.as_mut() else {
                        errors.push(format!("{}: {}", name_of(entry), t("файл пресета недоступен", &[])));
                        return Ok(vec![]);
                    };
                    (d.progress)(json!({ "type": "stage", "label": entry.get("name"), "stage": t("установка", &[]) }));
                    let files = crate::import::install_vpk_buffer(
                        d.inst,
                        &b.read_mod(&entry.get("file").map(string).unwrap_or_default())?,
                    )?;
                    // exactly the treatment a dragged-in file gets
                    let a = crate::adopt::adopt_imported_files(
                        d.inst,
                        d.lib,
                        d.vanilla,
                        &files,
                        entry.get("name").and_then(Value::as_str),
                        None,
                        None,
                    )?;
                    schema |= a.schema;
                    if let (Some(fp), [one]) = (fp, a.records.as_slice()) {
                        fps.insert(fp, one["id"].clone());
                    }
                    Ok(a.records.iter().map(|r| r["id"].clone()).collect())
                }
                Some("cosmetic") => {
                    if d.cosmetics_blocked.is_some() {
                        return Ok(vec![]);
                    }
                    // the table is built once for the whole preset, at the end
                    let rec = (d.pick)(d.lib, entry)?;
                    schema = true;
                    Ok(rec.map(|r| vec![r["id"].clone()]).unwrap_or_default())
                }
                kind => {
                    let why = if kind == Some("missing") {
                        entry.get("reason").filter(|r| truthy(r)).map(string)
                    } else {
                        None
                    };
                    errors.push(format!("{}: {}", name_of(entry), why.unwrap_or_else(|| t("нет в файле", &[]))));
                    Ok(vec![])
                }
            }
        })();
        r.unwrap_or_else(|e| {
            errors.push(format!("{}: {e}", name_of(entry)));
            vec![]
        })
    };
    let mut ids: Vec<Value> = Vec::new();
    for entry in preset.get("wanted").and_then(Value::as_array).cloned().unwrap_or_default() {
        if entry.get("kind").and_then(Value::as_str) == Some("pack") {
            let mut member_ids = Vec::new();
            for m in entry.get("members").and_then(Value::as_array).cloned().unwrap_or_default() {
                member_ids.extend(resolve_entry(d, &m, &mut errors));
            }
            match crate::presets_service::pack_from_records(
                d.lib,
                d.inst,
                &name_of(&entry),
                &member_ids,
                d.deploy_pack,
            )? {
                Some(built) => ids.push(built["id"].clone()),
                None => ids.extend(member_ids),
            }
        } else {
            ids.extend(resolve_entry(d, &entry, &mut errors));
        }
    }
    // from here this is an ordinary preset: its mods, and the looks the sender's file asked for
    let mut seen = HashSet::new();
    let made: Vec<Value> =
        ids.into_iter().filter(|id| seen.insert(string(id))).filter_map(|id| d.lib.find(&id).cloned()).collect();
    let mods: Vec<Value> = made.iter().filter(|r| Library::in_preset(Some(r))).map(Library::identity_of).collect();
    let picks: Vec<Value> = made.iter().filter(|r| Library::is_pick(Some(r))).map(Library::pick_of).collect();
    let installed = mods.len();
    let mut fields = json!({ "mods": mods, "picks": picks });
    if let Some(mut source) = preset.get("source").cloned().filter(Value::is_object) {
        source["file"] = Value::Null;
        fields["source"] = source;
    }
    let id = preset.get("id").cloned().unwrap_or(Value::Null);
    d.lib.update_preset(&id, &fields, None).map_err(|e| e.to_string())?;
    d.lib.drop_preset_fields(&id, &["modIds", "wanted"], None).map_err(|e| e.to_string())?;
    drop(bundle);
    if let Some(s) = &stash {
        let _ = std::fs::remove_file(s);
    }
    let now = d.lib.get_preset(&id).cloned().unwrap_or(Value::Null);
    let blocked = d.cosmetics_blocked.is_some();
    let applied = apply(d, &now, !blocked)?;
    errors.extend(applied.errors);
    (d.progress)(json!({ "type": "done", "label": now.get("name") }));
    Ok(Outcome {
        answer: json!({ "ok": true, "installed": installed, "errors": errors }),
        // a mod that arrived already enabled never passes through the switch, so its lifted blocks need the build too
        schema: schema || applied.schema_touched,
        after_master: true,
    })
}
