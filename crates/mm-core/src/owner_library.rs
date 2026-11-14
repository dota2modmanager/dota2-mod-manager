//! Mods already installed: the master switch, one mod's switch, the load order, and removal one at
//! a time and in batches (src/ipc-library.ts).
//!
//! Removing or switching a selection builds the item table once at the end, not once per mod: a
//! build reads the game's 50 MB table and writes a pak, and thirty mods paid for it thirty times.

use serde_json::{json, Value};

use crate::build_undo::touches_schema;
use crate::file_tx::FileTx;
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::{files_of, files_value};
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "mods:masterState",
    "mods:setMaster",
    "mods:dropItemIcons",
    "mods:setEnabled",
    "mods:removeMany",
    "mods:removeEverything",
    "mods:setEnabledMany",
    "mods:mapsOwner",
    "mods:remove",
    "mods:move",
    "mods:reorder",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

fn not_found() -> Value {
    json!({ "error": t("Мод не найден", &[]) })
}

fn no_slot() -> Value {
    json!({ "error": t("У мода нет слота pakNN", &[]) })
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn id_of(rec: &Value) -> Value {
    rec.get("id").cloned().unwrap_or(Value::Null)
}

fn name_of(rec: &Value) -> String {
    rec.get("name").map_or("undefined".into(), crate::js::string)
}

fn files(rec: &Value) -> Vec<crate::overlays::LibFile> {
    files_of(rec.get("files").unwrap_or(&Value::Null))
}

/// A mod's files and its record go together, or neither does.
pub fn remove_one(inst: &Installer, lib: &mut Library, rec: &Value) -> Result<(), String> {
    FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| {
        if rec.get("kind").and_then(Value::as_str) == Some("pack") {
            inst.remove_pack_fully(rec)?;
        } else {
            let id = rec.get("id").and_then(Value::as_str);
            inst.remove(&files(rec), id, rec.get("enabled") != Some(&Value::Bool(false)))?;
        }
        lib.remove_record(&id_of(rec), Some(tx)).map_err(io)
    })
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    let truthy = |i| crate::js::truthy(&arg(args, i));
    Ok(match channel {
        "mods:masterState" => json!({ "off": o.core().installer.master_is_off().unwrap_or(false) }),
        "mods:setMaster" => set_master(o, truthy(0)),
        "mods:dropItemIcons" => drop_item_icons(o, &arg(args, 0)),
        "mods:setEnabled" => set_enabled(o, &arg(args, 0), truthy(1)),
        "mods:removeMany" => remove_many(o, &arg(args, 0)),
        "mods:removeEverything" => remove_everything(o),
        "mods:setEnabledMany" => set_enabled_many(o, &arg(args, 0), truthy(1)),
        "mods:mapsOwner" => maps_owner(&o.core()).unwrap_or_else(|| json!({ "present": false })),
        "mods:remove" => remove(o, &arg(args, 0)),
        "mods:move" => move_by(o, &arg(args, 0), &arg(args, 1)),
        "mods:reorder" => reorder(o, &arg(args, 0), &arg(args, 1)),
        other => return Err(format!("no handler for {other}")),
    })
}

fn set_master(o: &Owner, on: bool) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let r = {
        let c = o.core();
        c.installer
            .set_master_enabled(on)
            .inspect(|_| crate::cursors::apply_master_to_cursors(&c.installer, &c.library, on))
    };
    match r {
        Ok(changed) => {
            // the item table and the cosmetics in it: taken off with the rest, built again when back on
            drop(o.refresh_schema_in_background());
            crate::owner_presence::refresh(o);
            json!({ "ok": true, "changed": changed })
        }
        Err(e) => json!({ "error": e }),
    }
}

fn drop_item_icons(o: &Owner, id: &Value) -> Value {
    let stop = o.blocked("toggle");
    let mut c = o.core();
    let Some(rec) = c.library.find(id).cloned() else { return stop.unwrap_or_else(not_found) };
    if let Some(stop) = stop {
        return stop;
    }
    let mut list = files(&rec);
    let run = (|| -> Result<usize, String> {
        let dropped = c.installer.drop_item_icons(&mut list)?;
        if dropped > 0 {
            c.library.update(id, &json!({ "files": files_value(&list), "noItemIcons": true }), None).map_err(io)?;
        }
        Ok(dropped)
    })();
    match run {
        Ok(dropped) => json!({ "ok": true, "dropped": dropped }),
        Err(e) => json!({ "error": e }),
    }
}

fn set_enabled(o: &Owner, id: &Value, enabled: bool) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let mut c = o.core();
    let Some(rec) = c.library.find(id).cloned() else { return not_found() };
    // a copy of the pumpkin's mod this install did not earn stays off (src/scream-guard.ts)
    if enabled && rec.get("cheat").is_some_and(crate::js::truthy) {
        return json!({ "error": t("Жульничество наказуемо гадостью", &[]) });
    }
    let Core { installer, library, .. } = &mut *c;
    // one change: the other set switched off, this one on, and both records
    let replaced = FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
        // only one cursor set, and one look per cosmetic slot, can be live at a time
        let others = if enabled && crate::cursors::is_cursor_record(Some(&rec)) {
            crate::cursors::disable_other_cursors(installer, library, Some(id))
        } else if enabled && rec.get("categoryId").and_then(Value::as_str) == Some("cosmetic") {
            crate::cursors::disable_other_cosmetics(library, &rec)
        } else {
            Vec::new()
        };
        installer.set_enabled(&files(&rec), enabled, rec.get("id").and_then(Value::as_str))?;
        library.set_enabled(id, enabled, Some(tx)).map_err(io)?;
        Ok::<_, String>(others)
    });
    drop(c);
    match replaced {
        Ok(replaced) => {
            // not waited for: the switch stood still for the whole build; the bar says how far it is
            if touches_schema(&rec) {
                drop(o.refresh_schema_in_background());
            }
            json!({ "ok": true, "replaced": replaced })
        }
        Err(e) => json!({ "error": e }),
    }
}

fn ids(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

/// Each of a selection's mods through `one`, then one build of the item table when any touched it.
fn batch(
    o: &Owner,
    list: &Value,
    mut one: impl FnMut(&mut Core, &Value) -> Option<Result<(), String>>,
) -> (usize, Vec<String>) {
    let (mut errors, mut done, mut schema) = (Vec::<String>::new(), 0, false);
    {
        let mut c = o.core();
        for id in ids(list) {
            let Some(rec) = c.library.find(&id).cloned() else { continue };
            match one(&mut c, &rec) {
                None => {}
                Some(Ok(())) => {
                    schema |= touches_schema(&rec);
                    done += 1;
                }
                Some(Err(e)) => errors.push(format!("{}: {e}", name_of(&rec))),
            }
        }
    }
    if schema {
        let _ = o.refresh_schema_in_background().recv();
    }
    (done, errors)
}

fn remove_many(o: &Owner, list: &Value) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let (removed, errors) = batch(o, list, |c, rec| Some(remove_one(&c.installer, &mut c.library, rec)));
    json!({ "ok": true, "removed": removed, "errors": errors })
}

fn set_enabled_many(o: &Owner, list: &Value, enabled: bool) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let (changed, errors) = batch(o, list, |c, rec| {
        if rec.get("enabled") == Some(&Value::Bool(enabled))
            || (enabled && rec.get("cheat").is_some_and(crate::js::truthy))
        {
            return None;
        }
        let Core { installer, library, .. } = c;
        Some(FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
            installer.set_enabled(&files(rec), enabled, rec.get("id").and_then(Value::as_str))?;
            library.set_enabled(&id_of(rec), enabled, Some(tx)).map_err(io).map(|_| ())
        }))
    });
    json!({ "ok": true, "changed": changed, "errors": errors })
}

/// Settings, "Remove everything the app put into the game": every mod off the disk and the list,
/// and gameinfo with the signatures back as Steam shipped them.
fn remove_everything(o: &Owner) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let mut c = o.core();
    let Core { installer, library, settings, schema, .. } = &mut *c;
    let mut one = remove_one;
    let (errors, removed) = crate::remove_everything::remove_everything(
        installer,
        library,
        settings,
        schema,
        Some(&mut one),
        crate::remove_everything::What { revert: true, mods: true, notice: false },
    );
    drop(c);
    o.diag(&format!("removeEverything: removed={removed} errors={}", errors.len()));
    json!({ "ok": true, "removed": removed, "errors": errors })
}

fn remove(o: &Owner, id: &Value) -> Value {
    if let Some(stop) = o.blocked("toggle") {
        return stop;
    }
    let r = {
        let mut c = o.core();
        let Some(rec) = c.library.find(id).cloned() else { return not_found() };
        let Core { installer, library, .. } = &mut *c;
        remove_one(installer, library, &rec).map(|()| touches_schema(&rec))
    };
    match r {
        Ok(schema) => {
            if schema {
                let _ = o.refresh_schema_in_background().recv();
            }
            json!({ "ok": true })
        }
        Err(e) => json!({ "error": e }),
    }
}

/// Who owns the map archive already in the language folder: ours by the library, Minify's by the
/// marker it packs into what it builds, and anything else unknown (a terrain put in by hand).
fn maps_owner(c: &Core) -> Option<Value> {
    let dir = c.installer.lang_folder().ok()?.join("maps");
    if !dir.exists() {
        return Some(json!({ "present": false }));
    }
    let known: std::collections::HashSet<String> = c
        .library
        .known_lang_rel_paths()
        .ok()?
        .iter()
        .map(|r| crate::js::string(r).replace('\\', "/").to_lowercase())
        .collect();
    let names = crate::js::dir_names(&dir);
    let mut unknown: Option<String> = None;
    for f in names {
        if !f.to_lowercase().ends_with(".vpk") || known.contains(&format!("maps/{f}").to_lowercase()) {
            continue;
        }
        if crate::minify::is_minify_pak(&dir.join(&f)) {
            return Some(json!({ "present": true, "owner": "minify", "file": f }));
        }
        unknown = unknown.or(Some(f));
    }
    Some(match unknown {
        Some(f) => json!({ "present": true, "owner": "unknown", "file": f }),
        None => json!({ "present": false }),
    })
}

/// Mods that hold a pakNN slot, by that number; a mod without one is not in the order at all.
fn numbered(inst: &Installer, list: &[Value]) -> Vec<Value> {
    let mut out: Vec<(Value, u32)> = list.iter().filter_map(|r| inst.slot_number(r).map(|n| (r.clone(), n))).collect();
    out.sort_by_key(|(_, n)| *n);
    out.into_iter().map(|(r, _)| r).collect()
}

fn zone(rec: &Value) -> crate::slot_zones::Zone {
    crate::slot_zones::zone_for(rec.get("categoryId").and_then(Value::as_str).unwrap_or(""))
}

/// The load order of the mod's own part: the categories that load first, or everything else.
fn order_of(inst: &Installer, lib: &Library, rec: &Value) -> Vec<Value> {
    let part: Vec<Value> = lib.list().iter().filter(|r| zone(r) == zone(rec)).cloned().collect();
    numbered(inst, &part)
}

fn position(order: &[Value], id: &Value) -> Option<usize> {
    order.iter().position(|r| r.get("id") == Some(id))
}

fn swap(inst: &Installer, lib: &mut Library, a: &Value, b: &Value, tx: &mut FileTx) -> Result<(), String> {
    for (id, files) in inst.swap_slots(a, b)? {
        lib.update(&id, &json!({ "files": files }), Some(tx)).map_err(io)?;
    }
    Ok(())
}

fn move_by(o: &Owner, id: &Value, dir: &Value) -> Value {
    let mut c = o.core();
    let Some(rec) = c.library.find(id).cloned() else { return not_found() };
    let Core { installer, library, .. } = &mut *c;
    let ordered = order_of(installer, library, &rec);
    let Some(at) = position(&ordered, id) else { return no_slot() };
    let to = if crate::js::to_number(dir) < 0.0 { at.checked_sub(1) } else { Some(at + 1) };
    let Some(other) = to.and_then(|i| ordered.get(i)).cloned() else { return json!({ "ok": true, "moved": 0 }) };
    match FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
        swap(installer, library, &rec, &other, tx)
    }) {
        Ok(()) => json!({ "ok": true, "moved": 1, "with": other.get("name").cloned().unwrap_or(Value::Null) }),
        Err(e) => json!({ "error": e }),
    }
}

/// Put a mod at a given place in the load order, walking it there with the swap the arrows use.
fn reorder(o: &Owner, id: &Value, to_index: &Value) -> Value {
    let mut c = o.core();
    let Some(rec) = c.library.find(id).cloned() else { return not_found() };
    let Core { installer, library, .. } = &mut *c;
    let mut ordered = order_of(installer, library, &rec);
    let Some(mut at) = position(&ordered, id) else { return no_slot() };
    // toIndex counts the whole list, as the screen shows it; the walk stays inside the mod's part
    let all = numbered(installer, library.list());
    let want = crate::js::to_number(to_index).trunc();
    let target =
        if all.is_empty() || want.is_nan() { None } else { all.get(want.clamp(0.0, (all.len() - 1) as f64) as usize) };
    let in_part = target.and_then(|t| position(&ordered, t.get("id").unwrap_or(&Value::Null)));
    // a place in the other part means as far as this part goes in that direction
    let me = position(&all, id).map_or(-1.0, |i| i as f64);
    let to = in_part.unwrap_or(if want < me { 0 } else { ordered.len() - 1 });
    // the whole walk is one change: a refusal on the tenth swap does not leave the mod halfway
    let steps = FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
        let mut n = 0;
        while at != to && n <= ordered.len() {
            let next = if to > at { at + 1 } else { at - 1 };
            let (a, b) = (ordered[at].clone(), ordered[next].clone());
            swap(installer, library, &a, &b, tx)?;
            ordered = order_of(installer, library, &rec);
            let Some(i) = position(&ordered, id) else { break };
            at = i;
            n += 1;
        }
        Ok::<_, String>(n)
    });
    match steps {
        Ok(n) => json!({ "ok": true, "moved": n }),
        Err(e) => json!({ "error": e }),
    }
}
