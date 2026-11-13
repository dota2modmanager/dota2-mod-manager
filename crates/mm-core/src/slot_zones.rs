//! The load order in two parts: slots 02-29 for the categories that have to load first, 30 and up
//! for the rest. Replacing src/slot-zones.ts, which tells how the ranges came to be.

use serde_json::{json, Value};
use std::collections::HashSet;

use crate::installer::Installer;
use crate::library::Library;
use crate::minify::RESERVED_PAKS;

/// The categories that load before every other mod.
pub const PRIORITY_CATEGORIES: [&str; 7] =
    ["trees", "river", "shaders", "herofx", "ranged-attack", "hero-items", "optimization"];
/// The first and last slot of those categories.
pub const PRIORITY_SLOTS: (u32, u32) = (2, 29);
/// Where every other mod starts.
pub const NORMAL_FIRST: u32 = 30;
/// The app's own pak, not a mod.
pub const APP_PAK: u32 = 64;

/// The two ranges a pak can sit in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    Priority,
    Normal,
}

/// Whether a lowercased file name in the language folder is the app's own pak.
pub fn is_app_pak(base_lower: &str) -> bool {
    base_lower == format!("pak{APP_PAK}_dir.vpk")
}

fn is_priority_category(category_id: &str) -> bool {
    PRIORITY_CATEGORIES.contains(&category_id)
}

/// Which part of the load order a category's mods belong in.
pub fn zone_for(category_id: &str) -> Zone {
    if is_priority_category(category_id) {
        Zone::Priority
    } else {
        Zone::Normal
    }
}

fn slot_zone(n: u32) -> Zone {
    if n >= PRIORITY_SLOTS.0 && n <= PRIORITY_SLOTS.1 {
        Zone::Priority
    } else {
        Zone::Normal
    }
}

/// "pakNN", two digits at least.
pub fn pak_base(n: u32) -> String {
    format!("pak{n:02}")
}

/// The first free slot of a part of the load order, as a file name, or None when it is full.
pub fn free_slot_in(zone: Zone, used: &HashSet<String>) -> Option<String> {
    let (from, to) = match zone {
        Zone::Priority => PRIORITY_SLOTS,
        Zone::Normal => (NORMAL_FIRST, 99),
    };
    (from..=to)
        .filter(|n| !RESERVED_PAKS.contains(n) && *n != APP_PAK)
        .map(|n| format!("{}_dir.vpk", pak_base(n)))
        .find(|name| !used.contains(name))
}

fn category(rec: &Value) -> String {
    rec.get("categoryId").map(crate::js::string).unwrap_or_else(|| "undefined".into())
}

fn strip_dir(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with("_dir.vpk") {
        name[..name.len() - 8].to_string()
    } else {
        name.to_string()
    }
}

/// Move a mod into the part of the load order its category belongs in, when it is not there.
/// Answers the record's new files, or None when it stays where it is.
pub fn move_to_zone(inst: &Installer, rec: &Value) -> Result<Option<Vec<Value>>, String> {
    let Some(n) = inst.slot_number(rec) else { return Ok(None) };
    let want = zone_for(&category(rec));
    if slot_zone(n) == want {
        return Ok(None);
    }
    let Some(free) = free_slot_in(want, &inst.used_pak_names()?) else { return Ok(None) };
    inst.move_to_slot(rec, &strip_dir(&free), None, None).map(Some)
}

/// Lay an existing load order out in its two parts, once. None when there is nothing to lay out
/// or it would not fit; a failure puts back everything already renamed and is an error.
pub fn migrate_slot_zones(inst: &Installer, library: &mut Library) -> Result<Option<usize>, String> {
    let mut recs: Vec<(Value, u32)> =
        library.list().iter().filter_map(|r| inst.slot_number(r).map(|n| (r.clone(), n))).collect();
    recs.sort_by_key(|(_, n)| *n);
    if recs.is_empty() {
        return Ok(None);
    }
    let ours: HashSet<String> =
        recs.iter().map(|(r, _)| format!("{}_dir.vpk", inst.slot_base(r).unwrap_or_default())).collect();
    let pak = regex::Regex::new(r"^pak\d+_dir\.vpk$").unwrap();
    let mut taken: HashSet<String> =
        inst.used_pak_names()?.into_iter().filter(|f| pak.is_match(f) && !ours.contains(f)).collect();
    let mut hand = |zone: Zone| {
        let f = free_slot_in(zone, &taken);
        if let Some(f) = &f {
            taken.insert(f.clone());
        }
        f
    };
    let mut plan: Vec<(Value, u32, Option<String>)> = Vec::new();
    for (r, n) in recs.iter().filter(|(r, _)| is_priority_category(&category(r))) {
        let to = hand(Zone::Priority).or_else(|| hand(Zone::Normal));
        plan.push((r.clone(), *n, to));
    }
    for (r, n) in recs.iter().filter(|(r, _)| !is_priority_category(&category(r))) {
        let to = hand(Zone::Normal);
        plan.push((r.clone(), *n, to));
    }
    if plan.iter().any(|(_, _, to)| to.is_none()) {
        return Ok(None);
    }
    // (record, from, park, to)
    let moving: Vec<(Value, String, String, String)> = plan
        .into_iter()
        .filter_map(|(r, n, to)| {
            let to = to?;
            let from = inst.slot_base(&r)?;
            (format!("{from}_dir.vpk") != to).then(|| (r, from, format!("mmslot{n}"), strip_dir(&to)))
        })
        .collect();
    if moving.is_empty() {
        return Ok(Some(0));
    }
    let done = crate::file_tx::FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| {
        let mut parked = Vec::new();
        for (r, from, park, _) in &moving {
            parked.push(inst.move_to_slot(r, park, Some(from), Some(tx))?);
        }
        let mut files = Vec::new();
        for ((r, _, park, to), p) in moving.iter().zip(parked) {
            let mut with = r.clone();
            with["files"] = Value::Array(p);
            files.push(inst.move_to_slot(&with, to, Some(park), Some(tx))?);
        }
        for ((r, ..), f) in moving.iter().zip(files) {
            library.update(&r["id"], &json!({ "files": f }), Some(tx)).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(())
    });
    if let Err(e) = done {
        library.load();
        return Err(e);
    }
    Ok(Some(moving.len()))
}

/// Move a mod off the app's own slot; whether a mod moved.
pub fn vacate_app_pak(inst: &Installer, library: &mut Library) -> Result<bool, String> {
    let Some(rec) = library.list().iter().find(|r| inst.slot_number(r) == Some(APP_PAK)).cloned() else {
        return Ok(false);
    };
    let used = inst.used_pak_names()?;
    let mut to = (APP_PAK + 1..=99)
        .filter(|n| !RESERVED_PAKS.contains(n))
        .map(|n| format!("pak{n}_dir.vpk"))
        .find(|name| !used.contains(name));
    if to.is_none() {
        to = free_slot_in(zone_for(&category(&rec)), &used).or_else(|| free_slot_in(Zone::Normal, &used));
    }
    let Some(to) = to else { return Ok(false) };
    let from = format!("pak{APP_PAK}");
    let base = strip_dir(&to);
    let done = crate::file_tx::FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| {
        let files = inst.move_to_slot(&rec, &base, Some(&from), Some(tx))?;
        library.update(&rec["id"], &json!({ "files": files }), Some(tx)).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    });
    if let Err(e) = done {
        library.load();
        return Err(e);
    }
    Ok(true)
}
