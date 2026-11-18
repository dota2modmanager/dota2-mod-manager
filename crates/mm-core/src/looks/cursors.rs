//! Which cursor set is live, and which look a slot is wearing (src/cursors.ts).
//!
//! A cursor set is loose files written straight over Valve's own in game\dota\resource\cursor,
//! and every set writes the same names: it cannot be switched off by renaming and two sets cannot
//! be on at once. So one set gives way when another comes on, the master switch takes them off by
//! hand, and a folder that drifted from the manifest is put back at start.

use serde_json::Value;

use crate::installer::Installer;
use crate::js::string;
use crate::library::Library;
use crate::overlays::files_of;

/// A record that owns cursor files, whatever else it holds.
pub fn is_cursor_record(rec: Option<&Value>) -> bool {
    rec.and_then(|r| r.get("files"))
        .and_then(Value::as_array)
        .is_some_and(|f| f.iter().any(|f| f.get("root").and_then(Value::as_str) == Some("cursor")))
}

fn on(r: &Value) -> bool {
    r.get("enabled") != Some(&Value::Bool(false))
}

fn files(r: &Value) -> Vec<crate::overlays::LibFile> {
    files_of(r.get("files").unwrap_or(&Value::Null))
}

/// Switch off every cursor set but one; the names of those that gave way.
pub fn disable_other_cursors(inst: &Installer, lib: &mut Library, except_id: Option<&Value>) -> Vec<Value> {
    let others: Vec<Value> =
        lib.list().iter().filter(|r| r.get("id") != except_id && on(r) && is_cursor_record(Some(r))).cloned().collect();
    let mut off = Vec::new();
    for rec in others {
        let id = string(&rec["id"]);
        if inst.set_enabled(&files(&rec), false, Some(&id)).is_ok() && lib.set_enabled(&rec["id"], false, None).is_ok()
        {
            off.push(rec.get("name").cloned().unwrap_or(Value::Null));
        }
    }
    off
}

/// A slot (weather, courier...) wears one look at a time: the others' flags go off.
pub fn disable_other_cosmetics(lib: &mut Library, rec: &Value) -> Vec<Value> {
    let others: Vec<Value> = lib
        .list()
        .iter()
        .filter(|o| {
            o.get("id") != rec.get("id")
                && on(o)
                && o.get("categoryId").and_then(Value::as_str) == Some("cosmetic")
                && o.get("slot") == rec.get("slot")
        })
        .cloned()
        .collect();
    let mut off = Vec::new();
    for o in others {
        if lib.set_enabled(&o["id"], false, None).is_ok() {
            off.push(o.get("name").cloned().unwrap_or(Value::Null));
        }
    }
    off
}

/// The master switch renames paks, which leaves cursors where they are: they go off (and back
/// on) with it, so "mods off" really is the game's own.
pub fn apply_master_to_cursors(inst: &Installer, lib: &Library, enabled: bool) {
    for rec in lib.list().iter().filter(|r| on(r) && is_cursor_record(Some(r))) {
        let id = string(&rec["id"]);
        let _ = if enabled {
            inst.deploy_cursor(&id, &files(rec)).map(|_| ())
        } else {
            inst.undeploy_cursor(&id, &files(rec))
        };
    }
}

/// Startup repair: the cursor folder drifts from the manifest (a game update, a Steam verify,
/// another tool), and records from before cursors could be switched off have no stored copy.
/// Of several sets marked on at once, only the newest was ever really on disk.
pub fn reconcile_cursors(inst: &Installer, lib: &mut Library, game_set: bool) {
    if !game_set {
        return;
    }
    let mut cursors: Vec<Value> = lib.list().iter().filter(|r| is_cursor_record(Some(r))).cloned().collect();
    if cursors.is_empty() {
        return;
    }
    let installed = |r: &Value| r.get("installedAt").and_then(Value::as_f64).unwrap_or(0.0);
    cursors.sort_by(|a, b| installed(b).partial_cmp(&installed(a)).unwrap_or(std::cmp::Ordering::Equal));
    let master_off = inst.master_is_off().unwrap_or(false);
    let mut live_claimed = false;
    for rec in cursors {
        let id = string(&rec["id"]);
        if !inst.cursor_store_dir(&id).exists() {
            let adopted =
                on(&rec) && !live_claimed && inst.ensure_cursor_store(Some(&id), &files(&rec)).unwrap_or(false);
            if adopted {
                live_claimed = true;
            } else {
                // nothing of this set is kept anywhere: it can only come back by reinstalling
                if on(&rec) {
                    let _ = lib.set_enabled(&rec["id"], false, None);
                }
                continue;
            }
        }
        let _ = if !on(&rec) || master_off {
            inst.undeploy_cursor(&id, &files(&rec))
        } else {
            inst.deploy_cursor(&id, &files(&rec)).map(|_| ())
        };
    }
}
