//! mm-core's functions by name, with JSON in and out: what test/rust-calls.test.ts compares with
//! the TypeScript function of the same name, and what the Tauri host can ask of Rust while the
//! module that calls it is still TypeScript. Each name is the TypeScript module and export.

use serde_json::{json, Value};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::kv::latin1;
use crate::{
    ability_sounds, cosmetic_names, effect_edit, hero_names, i18n, item_builder_donor as donor,
    item_builder_effects as effects, item_builder_styles as styles, item_skin, item_sounds, item_visuals, material,
    model_attachments, model_cloth, model_hitboxes, model_sequences, model_skin, particle_snapshot, particle_spec,
    particle_surface, recolor, unusual_effects,
};

/// A text argument as items_game's latin1 bytes: a string one byte per char, or {"$file": path}
/// for a file read once (the whole table, which would be slow to send as JSON every call).
fn b(args: &[Value], i: usize) -> Result<Arc<Vec<u8>>, String> {
    static FILES: OnceLock<Mutex<HashMap<String, Arc<Vec<u8>>>>> = OnceLock::new();
    match args.get(i) {
        Some(Value::Object(o)) if o.contains_key("$file") => {
            let path = o["$file"].as_str().unwrap_or("").to_string();
            let mut files = FILES.get_or_init(Default::default).lock().unwrap();
            if let Some(f) = files.get(&path) {
                return Ok(f.clone());
            }
            let f = Arc::new(std::fs::read(&path).map_err(|e| e.to_string())?);
            files.insert(path, f.clone());
            Ok(f)
        }
        _ => Ok(Arc::new(s(args, i).chars().map(|c| c as u32 as u8).collect())),
    }
}

fn opt_b(args: &[Value], i: usize) -> Result<Option<Arc<Vec<u8>>>, String> {
    match args.get(i) {
        None | Some(Value::Null) => Ok(None),
        _ => b(args, i).map(Some),
    }
}

fn n(args: &[Value], i: usize) -> f64 {
    args.get(i).and_then(Value::as_f64).unwrap_or(0.0)
}

/// A file made by a call, as its sha1 in hex (null for none): what the test compares.
fn sha(file: Option<Vec<u8>>) -> Value {
    use sha1::{Digest, Sha1};
    file.map_or(Value::Null, |f| json!(Sha1::digest(&f).iter().map(|b| format!("{b:02x}")).collect::<String>()))
}

/// Files as [[path, bytes]]: the bytes latin1 text or {"$file": path}.
fn entries_arg(v: Option<&Value>) -> Result<Vec<crate::vpk::Entry>, String> {
    let mut out = Vec::new();
    for e in v.and_then(Value::as_array).cloned().unwrap_or_default() {
        let data = b(std::slice::from_ref(&e[1]), 0)?;
        out.push(crate::vpk::entry_at(&crate::js::string(&e[0]), data.as_slice().into()));
    }
    Ok(out)
}

/// Arcana bases with their files, as [{base, entries}].
fn ready_bases(v: Option<&Value>) -> Result<Vec<crate::item_builder_personas::ReadyBase>, String> {
    let mut ready = Vec::new();
    for r in v.and_then(Value::as_array).cloned().unwrap_or_default() {
        let base: crate::arcana_notes::ArcanaBase =
            serde_json::from_value(r["base"].clone()).map_err(|e| e.to_string())?;
        ready.push(crate::item_builder_personas::ReadyBase::new(base, entries_arg(r.get("entries"))?));
    }
    Ok(ready)
}

/// A test script of FileTx steps under `root`: write, copy, move, remove, fail, and a savepoint
/// that either lets its failure through or catches it.
fn tx_ops(tx: &mut crate::file_tx::FileTx, root: &std::path::Path, ops: &Value) -> Result<(), String> {
    let at = |v: &Value| root.join(crate::js::string(v));
    for op in ops.as_array().cloned().unwrap_or_default() {
        let e = |e: std::io::Error| e.to_string();
        match op[0].as_str().unwrap_or("") {
            "write" => drop(tx.write(&at(&op[1]), crate::js::string(&op[2]).as_bytes()).map_err(e)?),
            "copy" => drop(tx.copy(&at(&op[1]), &at(&op[2])).map_err(e)?),
            "move" => drop(tx.rename(&at(&op[1]), &at(&op[2])).map_err(e)?),
            "remove" => drop(tx.remove(&at(&op[1])).map_err(e)?),
            "fail" => return Err("fail".into()),
            "savepoint" => {
                let inner = op[1].clone();
                let out = tx.savepoint(|tx| tx_ops(tx, root, &inner));
                if op[2] != "catch" {
                    out?;
                }
            }
            other => return Err(format!("no step {other}")),
        }
    }
    Ok(())
}

/// One step of the writing half of the installer, for its parity script.
fn write_step(
    root: &std::path::Path,
    inst: &crate::installer::Installer,
    lib: &mut crate::library::Library,
    op: &Value,
) -> Result<Value, String> {
    use crate::overlays::{files_of, files_value};
    use crate::safe_zip::{OpenedZip, Source};
    use std::path::{Path, PathBuf};
    let at = |v: &Value| -> PathBuf {
        let p = crate::js::string(v);
        match p.strip_prefix("@/") {
            Some(rest) => rest.split('/').fold(root.to_path_buf(), |p, s| p.join(s)),
            None => PathBuf::from(p),
        }
    };
    let rel = |p: &Path| -> Value {
        match p.strip_prefix(root) {
            Ok(r) => json!(format!("@/{}", r.to_string_lossy().replace('\\', "/"))),
            Err(_) => json!(p.to_string_lossy()),
        }
    };
    let text = |v: &Value| crate::js::string(v);
    Ok(match op[0].as_str().unwrap_or("") {
        "unsafe" => json!(crate::safe_zip::is_unsafe_name(&text(&op[1]))),
        "safeJoin" => rel(&crate::safe_zip::safe_join(&at(&op[1]), &text(&op[2]))?),
        "zip" => {
            let lim = op.get(2).filter(|v| v.is_object()).map(|l| {
                let d = crate::safe_zip::LIMITS;
                let n = |k: &str, dv: u64| l.get(k).and_then(Value::as_u64).unwrap_or(dv);
                crate::safe_zip::Limits {
                    archive_bytes: n("archiveBytes", d.archive_bytes),
                    entries: n("entries", d.entries as u64) as usize,
                    entry_bytes: n("entryBytes", d.entry_bytes),
                    total_bytes: n("totalBytes", d.total_bytes),
                    ratio: l.get("ratio").and_then(Value::as_f64).unwrap_or(d.ratio),
                    ratio_floor: n("ratioFloor", d.ratio_floor),
                }
            });
            OpenedZip::open(Source::File(&at(&op[1])), None, lim)?.describe()?
        }
        "space" => {
            crate::disk_space::ensure_space(&at(&op[1]), op[2].as_u64().unwrap_or(0), Some(op[3].as_u64()))?;
            Value::Null
        }
        "fileUrl" => json!(crate::installer_downloads::file_url(&text(&op[1]), &text(&op[2]))),
        "cachedArchive" => inst.cached_archive(op[1].as_str(), op[2].as_str()).map_or(Value::Null, |p| rel(&p)),
        "remember" => {
            inst.remember_download(&text(&op[1]), op[2].clone());
            Value::Null
        }
        "index" => Value::Object(inst.download_index()),
        "listCache" => json!(inst
            .list_download_cache()
            .iter()
            .map(|d| json!({ "key": d.key, "categoryId": d.category_id, "name": d.name, "bytes": d.bytes }))
            .collect::<Vec<_>>()),
        "removeCached" => json!(inst.remove_cached_download(&text(&op[1]))),
        "cacheSize" => json!(inst.download_cache_size()),
        "clearCache" => {
            inst.clear_download_cache();
            Value::Null
        }
        "installFonts" => files_value(&inst.install_fonts(Source::File(&at(&op[1])), &text(&op[2]), None)?),
        "installCursor" => files_value(&inst.install_cursor(Source::File(&at(&op[1])), &text(&op[2]), None)?),
        "written" => Value::Object(inst.written()),
        "fontHashes" => json!(inst.font_folder_hashes()),
        "lost" => json!(inst.lost_to_verify(op[1].as_array().map(Vec::as_slice).unwrap_or(&[]))),
        "ensureStore" => json!(inst.ensure_cursor_store(op[1].as_str(), &files_of(&op[2]))?),
        "deployCursor" => json!(inst.deploy_cursor(&text(&op[1]), &files_of(&op[2]))?),
        "undeployCursor" => {
            inst.undeploy_cursor(&text(&op[1]), &files_of(&op[2]))?;
            Value::Null
        }
        "cursorZip" => {
            let buf = inst.cursor_zip(&text(&op[1]), &text(&op[2]), &files_of(&op[3]))?;
            OpenedZip::open(Source::Bytes(buf), Some("x"), None)?.describe()?["files"].clone()
        }
        "dropStore" => {
            inst.drop_cursor_store(op[1].as_str());
            Value::Null
        }
        "restore" => json!(inst.restore_deployed(&op[1])?),
        "install" => {
            let local = at(&op[3]);
            let (category_id, mod_name) = (text(&op[1]), text(&op[2]));
            let job =
                crate::installer_write::InstallJob { category_id: &category_id, mod_name: &mod_name, local: &local };
            let files = crate::file_tx::FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| {
                inst.install_into(tx, &job)
            })?;
            files_value(&files)
        }
        "installTool" => files_value(&inst.install_tool(&at(&op[1]), &text(&op[2]), None)?),
        "setEnabled" => {
            inst.set_enabled(&files_of(&op[1]), op[2].as_bool().unwrap_or(false), op[3].as_str())?;
            Value::Null
        }
        "remove" => {
            inst.remove(&files_of(&op[1]), op[2].as_str(), op[3].as_bool().unwrap_or(true))?;
            Value::Null
        }
        "merge" => {
            let deltas: Option<Vec<Vec<u8>>> = op[2]
                .as_array()
                .map(|d| d.iter().map(|b| text(&b["block"]).chars().map(|c| c as u8).collect()).collect());
            json!(crate::safe_zip::sha1_hex(&inst.merge_to_single_vpk(&files_of(&op[1]), deltas.as_deref())?))
        }
        "unpack" => {
            let (n, bytes) = inst.unpack_to_folder(&files_of(&op[1]), &at(&op[2]))?;
            json!({ "files": n, "bytes": bytes })
        }
        "displayName" => json!(inst.display_name_for_file(&text(&op[1]))),
        "harvest" => {
            let mut records = files_of(&op[1]);
            let vanilla = match op[2].as_str() {
                Some(_) => Some(std::fs::read(at(&op[2])).map_err(|e| e.to_string())?),
                None => None,
            };
            let (deltas, stripped) = inst.harvest_schema(&mut records, vanilla.as_deref())?;
            json!({ "deltas": deltas, "stripped": stripped, "records": files_value(&records) })
        }
        "installedSize" => json!(inst.installed_size(&files_of(&op[1]))?),
        "dropIcons" => {
            let mut records = files_of(&op[1]);
            let n = inst.drop_item_icons(&mut records)?;
            json!({ "n": n, "records": files_value(&records) })
        }
        "analyze" => inst.analyze_record(&files_of(&op[1])).unwrap_or(Value::Null),
        "split" => json!(inst.split_vpk_file(&text(&op[1]))?),
        "mergeMulti" => {
            inst.merge_multi_part_records(lib)?;
            json!(lib.list())
        }
        "addMember" => {
            let rec = op[2].as_u64().and_then(|i| lib.list().get(i as usize)).cloned().unwrap_or(json!({}));
            inst.add_pack_member_from_record(&text(&op[1]), &rec, &text(&op[3]))?
        }
        "deployPack" => inst.deploy_pack(&op[1])?,
        "removePackFully" => {
            inst.remove_pack_fully(&op[1])?;
            Value::Null
        }
        "deployMember" => files_value(&inst.deploy_member_as_mod(&text(&op[1]), &text(&op[2]))?),
        "importPaths" => {
            let paths: Vec<PathBuf> = op[1].as_array().map(|a| a.iter().map(at).collect()).unwrap_or_default();
            let mut steps = Vec::new();
            let out = crate::import::import_vpks(inst, &paths, &mut |d, t| steps.push(json!([d, t])))?;
            json!({ "results": out, "steps": steps })
        }
        "importBuffers" => {
            let mut items = Vec::new();
            for it in op[1].as_array().cloned().unwrap_or_default() {
                items.push((text(&it[0]), std::fs::read(at(&it[1])).map_err(|e| e.to_string())?));
            }
            json!(crate::import::import_vpk_buffers(inst, &items, &mut |_, _| {})?)
        }
        "installBuffer" => {
            json!(crate::import::install_vpk_buffer(inst, &std::fs::read(at(&op[1])).map_err(|e| e.to_string())?)?)
        }
        "libList" => json!(lib.list()),
        "fpStore" => {
            crate::fingerprints::Fingerprints::new(&inst.user_data).store(&text(&op[1]))?;
            Value::Null
        }
        "fpMatch" => json!(crate::fingerprints::Fingerprints::new(&inst.user_data).matches(op[1].as_str())),
        "fpHas" => json!(crate::fingerprints::Fingerprints::new(&inst.user_data).has_data()),
        "fpPrints" => {
            let style = op.get(3).cloned().filter(|v| !v.is_null());
            let mut fp = crate::fingerprints::Fingerprints::new(&inst.user_data);
            json!(fp.prints_of(&text(&op[1]), &text(&op[2]), &style).map(|p| {
                let mut v: Vec<&String> = p.iter().collect();
                v.sort();
                v.into_iter().cloned().collect::<Vec<_>>()
            }))
        }
        "fpFonts" => {
            let mut fp = crate::fingerprints::Fingerprints::new(&inst.user_data);
            let hashes = inst.font_folder_hashes().unwrap_or_default();
            json!(fp.match_fonts(&hashes).iter().map(|m| m.name.clone()).collect::<Vec<_>>())
        }
        "updatable" => json!(crate::mod_update::updatable(&op[1])),
        "behind" => {
            let mut fp = crate::fingerprints::Fingerprints::new(&inst.user_data);
            json!(crate::mod_update::behind_catalog(&op[1], op[2].as_str(), &mut |c, n, st| fp
                .prints_of(c, n, st)
                .cloned()))
        }
        "updateMod" => {
            let rec = op[1].as_u64().and_then(|i| lib.list().get(i as usize)).cloned().unwrap_or(json!({}));
            let out = crate::mod_update::update_mod(inst, lib, &rec, &at(&op[2]), &mut |_| {})?;
            // the clock differs between the two runs
            lib.drop_fields(&rec["id"], &["updatedAt"], None).map_err(|e| e.to_string())?;
            json!(out.get("files"))
        }
        "ring" => json!(crate::emblem_ring::with_ring(&text(&op[1]), op[2].as_bool().unwrap_or(false))),
        "keepRing" => json!(crate::emblem_ring::keep_ring(
            inst.game.as_deref().unwrap_or(Path::new("")),
            op[1].as_bool().unwrap_or(false)
        )?),
        other => return Err(format!("no step {other}")),
    })
}

/// One step of a load order script; records are named by their place in the library.
fn slots_step(
    inst: &crate::installer::Installer,
    lib: &mut crate::library::Library,
    op: &Value,
) -> Result<Value, String> {
    use std::collections::HashSet;
    let sorted = |u: &HashSet<String>| {
        let mut v: Vec<&String> = u.iter().collect();
        v.sort();
        json!(v)
    };
    let list = |v: &Value| -> Vec<String> { v.as_array().into_iter().flatten().map(crate::js::string).collect() };
    let used_of = |v: &Value| -> HashSet<String> { list(v).into_iter().collect() };
    let rec = |lib: &crate::library::Library, i: &Value| {
        i.as_u64().and_then(|i| lib.list().get(i as usize)).cloned().unwrap_or(json!({}))
    };
    let store = |lib: &mut crate::library::Library, id: &Value, files: &[Value]| {
        lib.update(id, &json!({ "files": files }), None).map(|_| ()).map_err(|e| e.to_string())
    };
    Ok(match op[0].as_str().unwrap_or("") {
        "usedPakNames" => sorted(&inst.used_pak_names()?),
        "allocate" => {
            let mut used = used_of(&op[1]);
            let name = inst.allocate_pak(&mut used, op[2].as_bool().unwrap_or(false))?;
            json!([name, sorted(&used)])
        }
        "plan" => {
            let mut used = used_of(&op[2]);
            let plan = inst.plan_pak_names(&list(&op[1]), &mut used, op[3].as_bool().unwrap_or(false))?;
            json!([plan.into_iter().collect::<Vec<_>>(), sorted(&used)])
        }
        "slotBase" => json!(inst.slot_base(&op[1])),
        "slotNumber" => json!(inst.slot_number(&op[1])),
        "coverage" => {
            let mods: Vec<crate::installer_slots::CoverageMod> = op[1]
                .as_array()
                .into_iter()
                .flatten()
                .map(|m| crate::installer_slots::CoverageMod {
                    key: m["key"].clone(),
                    name: m["name"].clone(),
                    files: m["files"].as_array().cloned().unwrap_or_default(),
                })
                .collect();
            json!(inst.coverage(&mods).into_iter().collect::<Vec<_>>())
        }
        "freeBelow" => json!(inst.free_slot_below(op[1].as_u64().unwrap_or(0) as u32, &used_of(&op[2]))),
        "moveToSlot" => {
            let r = rec(lib, &op[1]);
            let files = inst.move_to_slot(&r, &crate::js::string(&op[2]), op.get(3).and_then(Value::as_str), None)?;
            store(lib, &r["id"], &files)?;
            json!(files)
        }
        "swap" => {
            let out = inst.swap_slots(&rec(lib, &op[1]), &rec(lib, &op[2]))?;
            for (id, files) in &out {
                store(lib, id, files)?;
            }
            json!(out.into_iter().map(|(id, files)| json!({ "id": id, "files": files })).collect::<Vec<_>>())
        }
        "usedModSlots" => json!(inst.used_mod_slots()?),
        "legacy" => {
            inst.migrate_legacy_priority_paks(lib)?;
            Value::Null
        }
        "moveToZone" => {
            let r = rec(lib, &op[1]);
            let files = crate::slot_zones::move_to_zone(inst, &r)?;
            if let Some(f) = &files {
                store(lib, &r["id"], f)?;
            }
            json!(files)
        }
        "migrateZones" => {
            json!(crate::slot_zones::migrate_slot_zones(inst, lib)?.map(|moved| json!({ "moved": moved })))
        }
        "vacate" => json!(crate::slot_zones::vacate_app_pak(inst, lib)?),
        "list" => json!(lib.list()),
        "togglable" => json!(inst.is_togglable_mod_file(&crate::js::string(&op[1]))),
        "masterIsOff" => json!(inst.master_is_off()?),
        "setMaster" => json!({ "changed": inst.set_master_enabled(op[1].as_bool().unwrap_or(false))? }),
        "writeOwnership" => {
            inst.write_ownership(&list(&op[1]), &crate::js::string(&op[2]));
            Value::Null
        }
        "ownsFile" => json!(inst.owns_file(&crate::js::string(&op[1]))),
        "sweep" => {
            let (restored, dropped) =
                inst.sweep_staged(std::path::Path::new(&crate::js::string(&op[1])), op[2].as_f64().unwrap_or(0.0));
            json!({ "restored": restored, "dropped": dropped })
        }
        "primaryPresent" => json!(inst.lang_primary_present(&op[1])),
        "siblingParts" => json!(inst.sibling_parts(&crate::js::string(&op[1]))),
        "external" => {
            let known = op[1].as_array().cloned().unwrap_or_default();
            json!(inst.external_files(&known, op[2].as_bool().unwrap_or(true))?)
        }
        other => return Err(format!("no step {other}")),
    })
}

/// One step of a library script; records and presets are named by their place in the lists.
fn library_step(lib: &mut crate::library::Library, op: &Value) -> Result<Value, String> {
    let e = |e: std::io::Error| e.to_string();
    let rec = |lib: &crate::library::Library, i: &Value| {
        i.as_u64().and_then(|i| lib.list().get(i as usize)).and_then(|r| r.get("id")).cloned().unwrap_or(json!("nope"))
    };
    let pre = |lib: &crate::library::Library, i: &Value| {
        i.as_u64()
            .and_then(|i| lib.list_presets().get(i as usize))
            .and_then(|r| r.get("id"))
            .cloned()
            .unwrap_or(json!("nope"))
    };
    let members = |m: Vec<crate::library::Member>| {
        Value::Array(m.into_iter().map(|m| json!({ "identity": m.identity, "rec": m.rec })).collect())
    };
    Ok(match op[0].as_str().unwrap_or("") {
        "add" => lib.add(&op[1], None).map_err(e)?,
        "update" => json!(lib.update(&rec(lib, &op[1]), &op[2], None).map_err(e)?),
        "setEnabled" => json!(lib.set_enabled(&rec(lib, &op[1]), op[2].as_bool().unwrap_or(false), None).map_err(e)?),
        "remove" => {
            lib.remove_record(&rec(lib, &op[1]), None).map_err(e)?;
            Value::Null
        }
        "savePreset" => {
            lib.save_preset(&op[1], None).map_err(e)?;
            Value::Null
        }
        "updatePresetMods" => json!(lib.update_preset_mods(&pre(lib, &op[1]), None).map_err(e)?),
        "addShared" => lib.add_shared_preset(&op[1], None).map_err(e)?,
        "updatePreset" => json!(lib.update_preset(&pre(lib, &op[1]), &op[2], None).map_err(e)?),
        "deletePreset" => {
            lib.delete_preset(&pre(lib, &op[1]), None).map_err(e)?;
            Value::Null
        }
        "find" => json!(lib.find(&rec(lib, &op[1]))),
        "findByKey" => json!(lib.find_by_key(&op[1], &op[2], op.get(3))),
        "list" => json!(lib.list()),
        "knownLang" => json!(lib.known_lang_rel_paths()?),
        "knownFiles" => json!(lib.known_files()?),
        "picksOn" => json!(lib.picks_on()),
        "members" => members(lib.preset_members(lib.get_preset(&pre(lib, &op[1])))?),
        "membersOf" => members(lib.preset_members(op.get(1))?),
        "modIds" => json!(lib.preset_mod_ids(lib.get_preset(&pre(lib, &op[1])))?),
        "file" => json!(std::fs::read_to_string(&lib.file).ok()),
        other => return Err(format!("no step {other}")),
    })
}

/// A string argument that may be null.
fn opt_s(args: &[Value], i: usize) -> Option<String> {
    args.get(i).and_then(Value::as_str).map(String::from)
}

/// A path argument that may be null or empty (a falsy game path).
fn opt_path(args: &[Value], i: usize) -> Option<std::path::PathBuf> {
    opt_s(args, i).filter(|p| !p.is_empty()).map(std::path::PathBuf::from)
}

/// An argument read into the type it is.
fn from_arg<T: serde::de::DeserializeOwned>(args: &[Value], i: usize) -> Result<T, String> {
    serde_json::from_value(args.get(i).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())
}

/// An argument that is a list of strings.
fn strings(args: &[Value], i: usize) -> Result<Vec<String>, String> {
    from_arg(args, i)
}

/// Files made by a call, as [path, sha1] pairs in their order.
fn shas(files: indexmap::IndexMap<String, Vec<u8>>) -> Value {
    json!(files.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(v: &str) -> Vec<u8> {
    (0..v.len() / 2).filter_map(|i| u8::from_str_radix(&v[2 * i..2 * i + 2], 16).ok()).collect()
}

fn floats(args: &[Value], i: usize) -> Vec<f64> {
    args.get(i)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect())
        .unwrap_or_default()
}

fn rgb(args: &[Value], i: usize) -> recolor::Rgb {
    let f = floats(args, i);
    [0, 1, 2].map(|c| f.get(c).copied().unwrap_or(f64::NAN))
}

/// The game's pak01 index at this path, opened once.
fn pak(path: &str) -> Result<Arc<crate::vpk::Index>, String> {
    static OPEN: OnceLock<Mutex<HashMap<String, Arc<crate::vpk::Index>>>> = OnceLock::new();
    let mut open = OPEN.get_or_init(Default::default).lock().unwrap();
    if let Some(ix) = open.get(path) {
        return Ok(ix.clone());
    }
    let ix = Arc::new(crate::vpk::Index::open(std::path::Path::new(path)).map_err(|e| e.to_string())?);
    open.insert(path.to_string(), ix.clone());
    Ok(ix)
}

/// The summons' plain models out of the pak at this path, one resolver per pak as the TypeScript keeps.
fn summons_of(path: &str) -> Result<Arc<Mutex<crate::item_builder_assets::Summons>>, String> {
    static OPEN: OnceLock<Mutex<HashMap<String, Arc<Mutex<crate::item_builder_assets::Summons>>>>> = OnceLock::new();
    let ix = pak(path)?;
    let mut open = OPEN.get_or_init(Default::default).lock().unwrap();
    let held = open.entry(path.to_string()).or_insert_with(|| {
        Arc::new(Mutex::new(crate::item_builder_assets::Summons::new(move |p: &str| ix.read(p).ok().flatten())))
    });
    Ok(held.clone())
}

fn particle_def_in(pak_path: &str, system: &str) -> Result<Value, String> {
    let ix = pak(pak_path)?;
    let mut read = |p: &str| ix.read(p).ok().flatten();
    let mut budget = 128;
    Ok(particle_spec::particle_def(&mut read, system, &mut budget, 0, &HashMap::new()).unwrap_or(Value::Null))
}

fn kv_err(e: crate::kv::KvError) -> String {
    e.to_string()
}

fn s(args: &[Value], i: usize) -> String {
    match args.get(i) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) => crate::js::string(v),
    }
}

/// Run `name` on `args`.
pub fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    Ok(match name {
        // [lang, ru, ...values]
        "i18n.t" => json!(i18n::t_in(i18n::Lang::parse(&s(args, 0)), &s(args, 1), args.get(2..).unwrap_or(&[]))),
        "hero-names.heroDisplayName" => json!(hero_names::display_name(&s(args, 0))),
        "hero-names.heroIdFromName" => json!(hero_names::id_from_name(&s(args, 0))),
        "hero-names.heroKey" => json!(hero_names::key(&s(args, 0))),
        "item-builder-styles.styleTokens" => {
            let v = opt_b(args, 0)?;
            json!(styles::style_tokens(v.as_deref().map(Vec::as_slice))
                .map_err(kv_err)?
                .iter()
                .map(|t| latin1(t))
                .collect::<Vec<_>>())
        }
        "item-builder-styles.styleOf" => json!(styles::style_of(&s(args, 0))),
        "item-builder-styles.withStyle" => {
            let (visuals, model, applied) = styles::with_style(&b(args, 0)?, n(args, 1) as u64).map_err(kv_err)?;
            json!({ "visuals": latin1(&visuals), "model": model.map(|m| latin1(&m)), "applied": applied })
        }
        "item-builder-styles.inEveryStyle" => {
            json!(latin1(&styles::in_every_style(&b(args, 0)?, n(args, 1) as usize).map_err(kv_err)?))
        }
        "item-builder-styles.blockInEveryStyle" => {
            json!(latin1(&styles::block_in_every_style(&b(args, 0)?, &b(args, 1)?).map_err(kv_err)?))
        }
        "item-builder-donor.donorOf" => json!(donor::donor_of(&s(args, 0))),
        "item-builder-donor.hasOwnEffect" => {
            let v = opt_b(args, 1)?;
            json!(donor::has_own_effect(&b(args, 0)?, v.as_deref().map(Vec::as_slice)).map_err(kv_err)?)
        }
        "item-builder-donor.donorAdditions" => {
            json!(donor::donor_additions(&b(args, 0)?, &b(args, 1)?, &s(args, 2))?
                .iter()
                .map(|t| latin1(t))
                .collect::<Vec<_>>())
        }
        "item-builder-donor.withModifiers" => {
            let add: Vec<Vec<u8>> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| a.iter().map(|x| x.as_str().unwrap_or("").chars().map(|c| c as u32 as u8).collect()).collect())
                .unwrap_or_default();
            json!(latin1(&donor::with_modifiers(&b(args, 0)?, &add)))
        }
        "item-builder-donor.withDonorEffects" => {
            json!(latin1(&donor::with_donor_effects(&b(args, 0)?, &b(args, 1)?, &s(args, 2))?))
        }
        "item-builder-effects.itemEffects" => json!(effects::item_effects()
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()),
        "item-builder-effects.appendItemEffect" => {
            let effect: effects::ItemEffect =
                serde_json::from_value(args.get(1).cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            json!(latin1(&effects::append_item_effect(&b(args, 0)?, &effect).map_err(kv_err)?))
        }
        "unusual-effects.effectNames" => {
            let mut names: Vec<(u64, String)> = unusual_effects::effect_names(&s(args, 0)).into_iter().collect();
            names.sort();
            json!(names)
        }
        "unusual-effects.unusualEffects" => {
            json!(unusual_effects::unusual_effects(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?)
        }
        "item-builder-unusual.offeredUnusual" => {
            let named: Vec<f64> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default();
            json!(unusual_effects::offered_unusual(&b(args, 0)?, |id| named.contains(&id)).map_err(kv_err)?)
        }
        "item-builder-unusual.unusualItemEffect" => {
            json!(unusual_effects::unusual_item_effect(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?)
        }
        "cosmetic-names.gameTokens" => {
            let tokens = cosmetic_names::game_tokens(std::path::Path::new(&s(args, 0)), &s(args, 1));
            json!(tokens.iter().collect::<Vec<_>>())
        }
        "cosmetic-names.styleNamer" => {
            let tokens = cosmetic_names::game_tokens(std::path::Path::new(&s(args, 0)), &s(args, 1));
            let asked: Vec<(String, usize)> = from_arg(args, 2)?;
            json!(asked
                .iter()
                .map(|(token, i)| cosmetic_names::style_name(&tokens, token, || format!("style {i}")))
                .collect::<Vec<_>>())
        }
        "cosmetic-names.chineseCosmeticNames" => {
            json!(*cosmetic_names::chinese_cosmetic_names(std::path::Path::new(&s(args, 0)), &b(args, 1)?))
        }
        "cosmetic-names.localizationTokens" => {
            json!(cosmetic_names::localization_tokens(&b(args, 0)?).into_iter().collect::<Vec<_>>())
        }
        "cosmetic-names.cosmeticNameTable" => {
            let items: Vec<(String, String)> = args
                .first()
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            (
                                i["name"].as_str().unwrap_or("").to_string(),
                                i["itemName"].as_str().unwrap_or("").to_string(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            let tokens: indexmap::IndexMap<String, String> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|p| (p[0].as_str().unwrap_or("").to_string(), p[1].as_str().unwrap_or("").to_string()))
                        .collect()
                })
                .unwrap_or_default();
            json!(cosmetic_names::cosmetic_name_table(items.iter().map(|(a, b)| (a.as_str(), b.as_str())), &tokens))
        }
        "model-skin.modelSkinMaterials" => {
            let m =
                model_skin::model_skin_materials(opt_b(args, 0)?.as_deref().map(Vec::as_slice), n(args, 1) as usize);
            json!(m.into_iter().collect::<Vec<_>>())
        }
        "model-skin.withSkin" => sha(model_skin::with_skin(&b(args, 0)?, n(args, 1) as usize)),
        "model-cloth.withoutCloth" => sha(Some(model_cloth::without_cloth(&b(args, 0)?))),
        "model-cloth.hasCloth" => json!(model_cloth::has_cloth(&b(args, 0)?)),
        "model-cloth.dragsCloth" => json!(model_cloth::drags_cloth(opt_b(args, 0)?.as_deref().map(Vec::as_slice))),
        "model-attachments.attachmentNames" => json!(model_attachments::attachment_names(&b(args, 0)?)),
        "model-attachments.attachedAs" => sha(Some(model_attachments::attached_as(&b(args, 0)?, &b(args, 1)?))),
        "model-sequences.numberedAs" => sha(model_sequences::numbered_as(&b(args, 0)?, &b(args, 1)?)),
        "item-skin.firstStyleSkin" => {
            json!(item_skin::first_style_skin(&b(args, 0)?).map_err(kv_err)?.map(|v| latin1(&v)))
        }
        "item-skin.wornSkin" => {
            let fallback = if args.get(1).is_some_and(|v| !v.is_null()) { n(args, 1) as u64 } else { 0 };
            let model = args.get(2).and_then(Value::as_str);
            json!(item_skin::worn_skin(&b(args, 0)?, fallback, model).map_err(kv_err)?)
        }
        "item-sounds.voiceSwaps" => {
            let rules = crate::kv3::read(crate::resource::data_block(&b(args, 0)?).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let cue: item_sounds::VoiceCue =
                serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(item_sounds::voice_swaps(&rules.root, &cue.key, &cue.value, cue.whole))
        }
        "item-sounds.soundEntries" => {
            let ix =
                crate::vpk::Index::open(std::path::Path::new(&s(args, 0)).join("dota").join("pak01_dir.vpk").as_path())
                    .map_err(|e| e.to_string())?;
            let swaps: Vec<item_sounds::SoundSwap> =
                serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let cues: Vec<item_sounds::VoiceCue> =
                serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(item_sounds::sound_entries(&ix, &swaps, &cues)
                .into_iter()
                .map(|(p, f)| json!([p, sha(Some(f))]))
                .collect::<Vec<_>>())
        }
        "material.attributeToken" => json!(material::attribute_token(&s(args, 0))),
        "material.constantExpression" => json!(hex(&material::constant_expression(&floats(args, 0)))),
        "material.constantOf" => json!(material::constant_of(&unhex(&s(args, 0)))),
        "material.withConstant" => {
            json!(material::with_constant(&unhex(&s(args, 0)), n(args, 1) as u32, &floats(args, 2))?.map(|c| hex(&c)))
        }
        "material.materialExpressions" => {
            json!(material::material_expressions(&b(args, 0)?)?
                .iter()
                .map(|e| json!({ "name": e.name, "code": hex(&e.code) }))
                .collect::<Vec<_>>())
        }
        "material.rewriteWithConstant" => {
            let (token, value) = (material::attribute_token(&s(args, 1)), floats(args, 2));
            let (file, changed) =
                material::rewrite_expressions(&b(args, 0)?, |e| material::with_constant(&e.code, token, &value))?;
            json!([sha(Some(file)), changed])
        }
        "recolor.shade" => {
            let from = args.get(2).filter(|v| v.is_array()).map(|_| rgb(args, 2));
            json!(recolor::shade(rgb(args, 0), rgb(args, 1), from))
        }
        "recolor.recolorResource" => {
            let o: recolor::Options =
                serde_json::from_value(args.get(2).cloned().unwrap_or(json!({}))).map_err(|e| e.to_string())?;
            let (file, n) = recolor::recolor_resource(&b(args, 0)?, rgb(args, 1), &o)?;
            json!([sha(Some(file)), n.changed, n.skipped])
        }
        "recolor.recolorMaterial" => {
            let bake = args.get(2).and_then(|o| o.get("bake")).and_then(Value::as_bool).unwrap_or(false);
            let (file, changed) = recolor::recolor_material(&b(args, 0)?, rgb(args, 1), bake)?;
            json!([sha(Some(file)), changed])
        }
        "recolor.liftForMod2x" => {
            let share = args.get(1).and_then(Value::as_f64).unwrap_or(0.3);
            let (file, changed) = recolor::lift_for_mod2x(&b(args, 0)?, share)?;
            json!([sha(Some(file)), changed])
        }
        "recolor.buildRecolor" => {
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let (vpk, r) = recolor::build_recolor(&ix, &s(args, 1), rgb(args, 2), |_| false)?;
            let failed: Vec<&str> = r.failed.iter().map(|f| f.path.as_str()).collect();
            json!([sha(Some(vpk)), r.files.len(), r.changed, r.skipped, failed])
        }
        "particle-spec.dataTree" => json!(particle_spec::data_tree(opt_b(args, 0)?.as_deref().map(Vec::as_slice))),
        "particle-spec.particleDef" => particle_def_in(&s(args, 0), &s(args, 1))?,
        "particle-spec.particleTextures" => {
            let def = particle_def_in(&s(args, 0), &s(args, 1))?;
            if def.is_null() {
                Value::Null
            } else {
                json!(particle_spec::particle_textures(&def))
            }
        }
        "particle-spec.bindItemParticle" => {
            let def = particle_def_in(&s(args, 0), &s(args, 1))?;
            if def.is_null() {
                Value::Null
            } else {
                particle_spec::bind_item_particle(&def, args.get(2), &s(args, 3))
            }
        }
        "particle-spec.itemParticles" => json!(particle_spec::item_particles(&b(args, 0)?)),
        "particle-spec.heroLoadoutParticles" => {
            json!(particle_spec::hero_loadout_particles(&b(args, 0)?).map_err(kv_err)?)
        }
        "particle-spec.modelAttachments" => {
            json!(particle_spec::model_attachments(opt_b(args, 0)?.as_deref().map(Vec::as_slice)))
        }
        "particle-snapshot.snapshotPoints" => {
            let file = b(args, 0)?;
            let data = particle_spec::data_tree(Some(&file)).ok_or("snapshot: no DATA tree")?;
            json!(particle_snapshot::snapshot_points(&file, &Value::Object(data))?)
        }
        "model-hitboxes.nameHash" => json!(model_hitboxes::name_hash(&s(args, 0))),
        "model-hitboxes.surfaceBoxes" => json!(model_hitboxes::surface_boxes(&b(args, 0)?)?
            .iter()
            .map(|b| json!({ "bone": b.bone, "min": b.min.map(crate::js::json_number), "max": b.max.map(crate::js::json_number) }))
            .collect::<Vec<_>>()),
        "model-hitboxes.withSurfaceHitboxes" => {
            let names: Vec<String> = match args.get(1).and_then(Value::as_array) {
                Some(a) => a.iter().map(crate::js::string).collect(),
                None => vec![model_hitboxes::SURFACE_SET.to_string()],
            };
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            sha(model_hitboxes::with_surface_hitboxes(&b(args, 0)?, &names))
        }
        "particle-surface.surfaceSystem" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            match particle_surface::surface_system(&mut read, &s(args, 1))? {
                None => Value::Null,
                Some((root, entries)) => json!([root, entries.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>()]),
            }
        }
        "ability-sounds.eventsFile" => json!(ability_sounds::events_file(&s(args, 0))),
        "ability-sounds.soundPath" => json!(ability_sounds::sound_path(&s(args, 0), &s(args, 1))),
        "ability-sounds.soundHero" => json!(ability_sounds::sound_hero(&s(args, 0))),
        "ability-sounds.heroesWithSounds" => json!(ability_sounds::heroes_with_sounds(pak(&s(args, 0))?.paths())),
        "ability-sounds.heroEvents" => {
            let kv = crate::kv3::read(crate::resource::data(&b(args, 0)?, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            json!(ability_sounds::hero_events(&kv))
        }
        "ability-sounds.editedEvents" => {
            let kv = crate::kv3::read(crate::resource::data(&b(args, 0)?, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let edits: Vec<ability_sounds::SoundEdit> = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let (text, gone) = ability_sounds::edited_events(&kv, &s(args, 1), &edits)?;
            json!({ "text": text, "gone": gone })
        }
        "ability-sounds.wavProblem" => json!(ability_sounds::wav_problem(&b(args, 0)?)),
        "js.toFixed" => json!(crate::js::to_fixed(n(args, 0), n(args, 1) as usize)),
        "hero-showcase.heroStage" => {
            let keys: Vec<String> = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let (sc, sp) = (opt_b(args, 0)?, opt_b(args, 1)?);
            crate::hero_showcase::hero_stage(sc.as_ref().map(|v| v.as_slice()), sp.as_ref().map(|v| v.as_slice()), &keys)
        }
        "hero-showcase.showcaseEntry" => {
            let keys: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::hero_showcase::showcase_entry(&b(args, 0)?, &keys).map(|m| m.into_iter().collect::<std::collections::BTreeMap<_, _>>()))
        }
        "hero-showcase.forward" => {
            let f = crate::hero_showcase::forward([n(args, 0), n(args, 1), n(args, 2)]);
            json!(f.iter().map(|x| crate::js::json_number(*x)).collect::<Vec<_>>())
        }
        "vpk-pack.findContentRoot" => json!(crate::vpk_pack::find_content_root(std::path::Path::new(&s(args, 0)), 0).map(|p| p.to_string_lossy().into_owned())),
        "vpk-pack.packFolder" => json!(sha(Some(crate::vpk_pack::pack_folder(std::path::Path::new(&s(args, 0)))?))),
        "arcana-notes.itemNote" => {
            let heroes: Vec<String> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let id = args.get(2).and_then(Value::as_str);
            json!(crate::arcana_notes::item_note(&heroes, &b(args, 1)?, id))
        }
        "arcana-notes.isArcanaBlock" => json!(crate::arcana_notes::is_arcana_block(&b(args, 0)?)),
        "arcana-bases.hasBase" => json!(crate::arcana_notes::has_base(&s(args, 0))),
        "item-builder-details.itemFacts" => json!(crate::item_builder_details::item_facts(&b(args, 0)?)),
        "item-builder-details.heroAttributes" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            let ids: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::item_builder_details::hero_attributes(&mut read, &ids))
        }
        "item-builder-details.eventNames" => {
            let tokens: Vec<(String, String)> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let names = crate::item_builder_details::event_names(tokens.iter().map(|(k, v)| (k.as_str(), v.as_str())));
            json!(names.into_iter().collect::<std::collections::BTreeMap<_, _>>())
        }
        "item-builder-details.eventName" => {
            let tokens: Vec<(String, String)> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let names = crate::item_builder_details::event_names(tokens.iter().map(|(k, v)| (k.as_str(), v.as_str())));
            json!(crate::item_builder_details::event_name(&s(args, 0), &names))
        }
        "item-builder-details.plainText" => json!(crate::item_builder_details::plain_text(&s(args, 0))),
        "item-builder-ability-fx.fxSlotOf" => json!(crate::item_builder_ability_fx::fx_slot_of(&s(args, 0))),
        "item-builder-ability-fx.fxSlotsOf" => json!(crate::item_builder_ability_fx::fx_slots_of(&b(args, 0)?)),
        "item-builder-ability-fx.fxVisuals" => {
            json!(latin1(&crate::item_builder_ability_fx::fx_visuals(&b(args, 0)?, n(args, 1) as u64).map_err(kv_err)?))
        }
        "item-builder-ability-fx.hasModifiers" => json!(crate::item_builder_ability_fx::has_modifiers(&b(args, 0)?)),
        "item-builder-ability-fx.fxTarget" => {
            let items = crate::schema::items_of(&b(args, 0)?).map_err(kv_err)?;
            json!(crate::item_builder_ability_fx::fx_target(&items, n(args, 1) as u64).map(|i| i.id.clone()))
        }
        "js.localeCompare" => json!(crate::js::locale_compare(&s(args, 0), &s(args, 1)) as i8),
        "item-builder-slots.itemSlots" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::item_builder_slots::item_slots(&b(args, 1)?).map_err(kv_err)?)
        }
        "item-builder-slots.stockModels" => {
            let heroes: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::item_builder_slots::stock_models(&b(args, 0)?, &heroes).map_err(kv_err)?)
        }
        "item-builder-slots.canonicalHeroId" => json!(crate::item_builder_slots::canonical_hero_id(&s(args, 0))),
        "item-builder-slots.matchItemSlot" => json!(crate::item_builder_slots::match_item_slot(&s(args, 0))),
        "item-builder-slots.slotDisplayLabel" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::item_builder_slots::slot_display_label(&s(args, 1)))
        }
        "item-builder-slots.itemSlotIcon" => json!(crate::item_builder_slots::item_slot_icon(&s(args, 0))),
        "item-builder-assets.itemAssets" => {
            // (pak, items_game, visuals, heroes): the summons resolved out of that pak
            let heroes: Vec<String> = serde_json::from_value(args.get(3).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let held = summons_of(&s(args, 0))?;
            let mut summons = held.lock().unwrap();
            let mut resolve = |u: &str, h: &[String], m: &str| summons.resolve(u, h, m);
            json!(crate::item_builder_assets::item_assets(&b(args, 1)?, &b(args, 2)?, &heroes, Some(&mut resolve)).map_err(kv_err)?)
        }
        "item-builder-assets.heroModelPath" => {
            let ix = pak(&s(args, 0))?;
            json!(crate::item_builder_assets::hero_model_path(&|p: &str| ix.read(p).ok().flatten(), &s(args, 1))?)
        }
        "item-builder-assets.gameAssetEntries" => {
            let ix = pak(&s(args, 0))?;
            let copies: Vec<crate::item_builder_assets::AssetCopy> =
                serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let entries = crate::item_builder_assets::game_asset_entries(&|p: &str| ix.read(p).ok().flatten(), &copies, &|_| false)?;
            json!(entries.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>())
        }
        "item-builder.setVisualsBlock" => json!(latin1(&crate::item_builder::set_visuals_block(&b(args, 0)?, &b(args, 1)?).map_err(kv_err)?)),
        "item-builder.effectKey" => {
            let ids: Vec<String> = match args.first() {
                Some(Value::Array(a)) => a.iter().map(crate::js::string).collect(),
                Some(Value::Null) | None => vec![],
                Some(v) => crate::js::string(v).split(',').map(String::from).collect(),
            };
            json!(crate::item_builder::effect_key(&ids))
        }
        "item-builder.asItem" => {
            let item = args.get(2).cloned().unwrap_or(Value::Null);
            let (id, start) = (item["id"].as_str().unwrap_or("").to_string(), item["start"].as_u64().unwrap_or(0) as usize);
            let model = args.get(3).and_then(Value::as_str);
            json!(latin1(&crate::item_builder::as_item(&b(args, 0)?, &b(args, 1)?, &id, start, model).map_err(kv_err)?))
        }
        "item-builder.itemVisuals" => {
            let start = args.get(1).and_then(|i| i["start"].as_u64()).unwrap_or(0) as usize;
            json!(crate::item_builder::item_visuals(&b(args, 0)?, start).map_err(kv_err)?.map(|v| latin1(&v)))
        }
        "item-builder.itemVoices" => {
            let start = args.get(1).and_then(|i| i["start"].as_u64()).unwrap_or(0) as usize;
            json!(crate::item_builder::item_voices(&b(args, 0)?, start).map_err(kv_err)?)
        }
        "item-builder.defaultItemForWearable" => json!(crate::item_builder::default_item_for_wearable(&b(args, 0)?, &s(args, 1))?.map(|i| i.id)),
        "item-builder.withoutFileSwaps" => {
            let set = |i: usize| -> std::collections::HashSet<String> {
                args.get(i).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default()
            };
            json!(latin1(&crate::item_builder::without_file_swaps(&b(args, 0)?, &set(1), &set(2)).map_err(kv_err)?))
        }
        "item-builder.itemEffectPatch" => {
            // (pak, items_game, item, effect ids, target, refit): the summons resolved out of that pak
            let ids: Vec<String> = match args.get(3) {
                Some(Value::Array(a)) => a.iter().map(crate::js::string).collect(),
                Some(Value::Null) | None => vec![],
                Some(v) => crate::js::string(v).split(',').map(String::from).collect(),
            };
            let (target, refit) = (args.get(4).and_then(Value::as_str), args.get(5).and_then(Value::as_str));
            let held = summons_of(&s(args, 0))?;
            let mut summons = held.lock().unwrap();
            let mut resolve = |u: &str, h: &[String], m: &str| summons.resolve(u, h, m);
            json!(crate::item_builder::item_effect_patch(&b(args, 1)?, &s(args, 2), &ids, target, Some(&mut resolve), refit)?)
        }
        "item-builder-kinetic.kineticGems" => {
            json!(crate::item_builder_kinetic::kinetic_gems(&b(args, 0)?).map_err(kv_err)?.iter().map(|(k, g)| json!([k, g])).collect::<Vec<_>>())
        }
        "item-builder-kinetic.offeredKinetic" => {
            let heroes: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::item_builder_kinetic::offered_kinetic(&b(args, 0)?, &heroes).map_err(kv_err)?)
        }
        "item-builder-kinetic.picksGems" => json!(crate::item_builder_kinetic::picks_gems(&b(args, 0)?, &s(args, 1))?),
        "item-builder-kinetic.withKinetics" => {
            let gems = crate::item_builder_kinetic::picks_gems(&b(args, 1)?, &s(args, 2))?;
            json!(latin1(&crate::item_builder_kinetic::with_kinetics(&b(args, 0)?, &gems)))
        }
        "item-builder-fx-patch.abilityFxPatch" => {
            // (pak, items_game, item, effect ids, slot): the summons resolved out of that pak
            let ids: Vec<String> = args.get(3).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            let held = summons_of(&s(args, 0))?;
            let mut summons = held.lock().unwrap();
            let mut resolve = |u: &str, h: &[String], m: &str| summons.resolve(u, h, m);
            json!(crate::item_builder_fx_patch::ability_fx_patch(&b(args, 1)?, &s(args, 2), &ids, n(args, 4) as u64, Some(&mut resolve))?)
        }
        "item-builder-refits.pickModels" => {
            let ids: Vec<String> = args.get(2).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            json!(crate::item_builder_refits::pick_models(&b(args, 0)?, &s(args, 1), &ids)
                .map_err(kv_err)?
                .map(|p| json!([p.model, p.swaps.into_iter().collect::<Vec<_>>()])))
        }
        "item-builder-refits.refitsOf" => {
            // [[key, model, [[from, to]]]]
            let mut picks = indexmap::IndexMap::new();
            for p in args.first().and_then(Value::as_array).cloned().unwrap_or_default() {
                let swaps = p[2].as_array().cloned().unwrap_or_default().iter().map(|x| (crate::js::string(&x[0]), crate::js::string(&x[1]))).collect();
                picks.insert(crate::js::string(&p[0]), crate::item_builder_refits::PickModels { model: crate::js::string(&p[1]), swaps });
            }
            json!(crate::item_builder_refits::refits_of(&picks).into_iter().collect::<Vec<_>>())
        }
        "item-builder-refits.ownModelsWin" => {
            // [[paths or null, own or null]]: the paths each keeps
            let mut picks: Vec<crate::item_builder_refits::OwnedPick> = args
                .first()
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| crate::item_builder_refits::OwnedPick {
                    assets: p[0].as_array().map(|a| a.iter().map(|x| (crate::js::string(x), vec![])).collect()),
                    own: p[1].as_str().map(String::from),
                })
                .collect();
            crate::item_builder_refits::own_models_win(&mut picks);
            json!(picks.iter().map(|p| p.assets.as_ref().map(|a| a.iter().map(|(x, _)| x.clone()).collect::<Vec<_>>())).collect::<Vec<_>>())
        }
        "file-tx.script" => {
            // (root, journalDir|null, ops, "run"|"crash"): whether the change went through
            let root = std::path::PathBuf::from(s(args, 0));
            let journal = opt_path(args, 1);
            let ops = args.get(2).cloned().unwrap_or(Value::Null);
            if s(args, 3) == "crash" {
                let mut tx = crate::file_tx::FileTx::new(journal.as_deref(), Box::new(|_| {}));
                json!(tx_ops(&mut tx, &root, &ops).is_ok())
            } else {
                json!(crate::file_tx::FileTx::run(journal.as_deref(), Box::new(|_| {}), |tx| tx_ops(tx, &root, &ops)).is_ok())
            }
        }
        "file-tx.readJournal" => {
            let (steps, committed) = crate::file_tx::read_journal(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            json!({ "steps": steps, "committed": committed })
        }
        "file-tx.recoverJournals" => json!(crate::file_tx::recover_journals(opt_path(args, 0).as_deref(), &mut |_| {})),
        "library.script" => {
            // (dir, ops): each step's answer, a thrown step as {error}
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 0)));
            let ops = args.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(ops.iter().map(|op| match library_step(&mut lib, op) {
                Ok(v) => json!({ "ok": v }),
                Err(e) => json!({ "error": e }),
            }).collect())
        }
        "library.identityOf" => crate::library::Library::identity_of(&args[0]),
        "library.sameMod" => json!(crate::library::Library::same_mod(args.first(), args.get(1))),
        "library.inPreset" => json!(crate::library::Library::in_preset(args.first())),
        "library.isPick" => json!(crate::library::Library::is_pick(args.first())),
        "library.pickOf" => crate::library::Library::pick_of(&args[0]),
        "installer.script" => {
            // (root, game, suffix, journalDir, userData, libraryDir, ops): "@/x" in an op is root/x
            let root = std::path::PathBuf::from(s(args, 0));
            let mut inst = crate::installer::Installer::new(opt_path(args, 1), &s(args, 2))
                .with_user_data(std::path::Path::new(&s(args, 4)));
            inst.journal_dir = opt_path(args, 3);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 5)));
            let ops = args.get(6).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(
                ops.iter()
                    .map(|op| match write_step(&root, &inst, &mut lib, op) {
                        Ok(v) => json!({ "ok": v }),
                        Err(e) => json!({ "error": e }),
                    })
                    .collect(),
            )
        }
        "installer-slots.script" => {
            // (game, suffix, journalDir, libraryDir, ops): each step's answer, a thrown step as {error}
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1));
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let ops = args.get(4).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(
                ops.iter()
                    .map(|op| match slots_step(&inst, &mut lib, op) {
                        Ok(v) => json!({ "ok": v }),
                        Err(e) => json!({ "error": e }),
                    })
                    .collect(),
            )
        }
        "settings.load" => Value::Object(crate::settings::Settings::new(std::path::Path::new(&s(args, 0))).all()),
        "settings.set" => {
            // (dir, [[key, value]...]): each set in turn, then the file as it is left
            let mut st = crate::settings::Settings::new(std::path::Path::new(&s(args, 0)));
            for kv in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                st.set(&crate::js::string(&kv[0]), kv[1].clone()).map_err(|e| e.to_string())?;
            }
            json!(std::fs::read_to_string(&st.file).ok())
        }
        "gamelang.modFolderFor" => json!(crate::gamelang::mod_folder_for(
            opt_s(args, 0).as_deref(),
            opt_s(args, 1).as_deref(),
            opt_s(args, 2).as_deref()
        )),
        "gamelang.folderFor" => json!(crate::gamelang::folder_for(opt_s(args, 0).as_deref())),
        "gamelang.readKey" => json!(crate::gamelang::read_key(&s(args, 0), &s(args, 1))),
        "gamelang.bootLanguages" => {
            json!(crate::gamelang::boot_languages(opt_path(args, 0).as_deref()).map(|(ui, audio)| json!({ "ui": ui, "audio": audio })))
        }
        "gamelang.langFolders" => json!(crate::gamelang::lang_folders(opt_path(args, 0).as_deref())),
        "gamelang.detectLangSuffix" => json!(crate::gamelang::detect_lang_suffix(opt_path(args, 0).as_deref())),
        "gamelang.launchLanguage" => json!(crate::gamelang::launch_language(opt_path(args, 0).as_deref())),
        "gamelang.launchOptions" => json!(crate::gamelang::launch_options(opt_path(args, 0).as_deref())),
        "gamelang.steamLanguage" => json!(crate::gamelang::steam_language(opt_path(args, 0).as_deref())),
        "gamelang.steamAccountDir" => {
            json!(crate::gamelang::steam_account_dir(opt_path(args, 0).as_deref()).map(|p| p.to_string_lossy().into_owned()))
        }
        "gamelang.voiceInstalled" => json!(crate::gamelang::voice_installed(std::path::Path::new(&s(args, 0)), &s(args, 1))),
        "gamelang.writeBootLanguages" => {
            crate::gamelang::write_boot_languages(
                std::path::Path::new(&s(args, 0)),
                opt_s(args, 1).as_deref(),
                opt_s(args, 2).as_deref(),
            )
            .map_err(|e| e.to_string())?;
            Value::Null
        }
        "gamelang.ensureLangFolder" => json!(crate::gamelang::ensure_lang_folder(std::path::Path::new(&s(args, 0)), &s(args, 1))
            .map_err(|e| e.to_string())?
            .to_string_lossy()),
        "gamelang.moveLangFolder" => json!(crate::gamelang::move_lang_folder(
            opt_path(args, 0).as_deref(),
            opt_s(args, 1).as_deref(),
            opt_s(args, 2).as_deref()
        )),
        "minify.isMinifyFile" => json!(crate::minify::is_minify_file(&s(args, 0))),
        "minify.isMinifyPak" => json!(crate::minify::is_minify_pak(std::path::Path::new(&s(args, 0)))),
        "minify.readConfig" => json!(crate::minify::read_config(std::path::Path::new(&s(args, 0)))),
        "minify.prelaunchHook" => json!(crate::minify::prelaunch_hook(opt_s(args, 0).as_deref())),
        "minify.readMinify" => {
            // ({folders, audio, gameLanguages, ourFolder, ourMods, config, launchOptions}); a count per folder in `counts`
            let o = args.first().cloned().unwrap_or(Value::Null);
            let folders: Vec<(String, usize)> = o["folders"]
                .as_array()
                .map(|a| a.iter().map(|f| (crate::js::string(&f["suffix"]), f["modFiles"].as_u64().unwrap_or(0) as usize)).collect())
                .unwrap_or_default();
            let folders: Vec<crate::minify::FolderCount> =
                folders.iter().map(|(s, n)| crate::minify::FolderCount { suffix: s, mod_files: *n }).collect();
            let langs: Vec<String> = serde_json::from_value(o["gameLanguages"].clone()).unwrap_or_default();
            let langs: Vec<&str> = langs.iter().map(String::as_str).collect();
            let config = o.get("config").filter(|c| c.is_object()).map(|c| crate::minify::MinifyConfig {
                output_path: c["outputPath"].as_str().map(String::from),
                locale: c["locale"].as_str().map(String::from),
                folder: c["folder"].as_str().map(String::from),
            });
            let counts: Option<std::collections::HashMap<String, usize>> = o.get("counts").filter(|c| c.is_object()).map(|c| {
                c.as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_u64().unwrap_or(0) as usize)).collect()
            });
            let count = counts.as_ref().map(|c| move |f: &str| c.get(f).copied().unwrap_or(0));
            json!(crate::minify::read_minify(crate::minify::MinifyInput {
                folders: &folders,
                audio: o["audio"].as_str(),
                game_languages: &langs,
                our_folder: o["ourFolder"].as_str().unwrap_or(""),
                our_mods: o["ourMods"].as_u64().unwrap_or(0) as usize,
                config,
                count_mods: count.as_ref().map(|c| c as &dyn Fn(&str) -> usize),
                launch_options: o["launchOptions"].as_str(),
            }))
        }
        "patcher.script" => {
            // (game, backupDir, ops): ["state", folder] ["apply", folder] ["revert", folder]
            let game = std::path::PathBuf::from(s(args, 0));
            let backups = std::path::PathBuf::from(s(args, 1));
            let ops = args.get(2).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(
                ops.iter()
                    .map(|op| {
                        let folder = op[1].as_str();
                        let r = match op[0].as_str().unwrap_or("") {
                            "state" => crate::patcher::state(&game, folder),
                            "apply" => crate::patcher::apply(&game, folder.unwrap_or(""), &backups),
                            "revert" => crate::patcher::revert(&game, folder, &backups),
                            other => Err(format!("no step {other}")),
                        };
                        match r {
                            Ok(v) => json!({ "ok": v }),
                            Err(e) => json!({ "error": e }),
                        }
                    })
                    .collect(),
            )
        }
        "patcher-gameinfo.searchPathsBlock" => json!(crate::patcher_gameinfo::search_paths_block(&s(args, 0))?),
        "patcher-gameinfo.withModFolder" => json!(crate::patcher_gameinfo::with_mod_folder(&s(args, 0), &s(args, 1))?),
        "patcher-gameinfo.searchPathLines" => json!(crate::patcher_gameinfo::search_path_lines(&s(args, 0))),
        "patcher-gameinfo.patchIsCurrent" => {
            json!(crate::patcher_gameinfo::patch_is_current(&s(args, 0), &s(args, 1), &s(args, 2))?)
        }
        "patcher-gameinfo.patchedBranch" => json!(crate::patcher_gameinfo::patched_branch(&s(args, 0), &s(args, 1))?),
        "patcher-gameinfo.stripPatch" => json!(crate::patcher_gameinfo::strip_patch(&s(args, 0))),
        "patcher-gameinfo.restoreBranch" => {
            let want: Option<crate::patcher_signatures::Hashes> = from_arg(args, 1)?;
            let (text, verified) = crate::patcher_gameinfo::restore_branch(&s(args, 0), want.as_ref());
            json!({ "text": text, "verified": verified })
        }
        "patcher-signatures.crc32" => json!(crate::patcher_signatures::crc32(&b(args, 0)?)),
        "patcher-signatures.fileHashes" => json!(crate::patcher_signatures::file_hashes(&b(args, 0)?)),
        "patcher-signatures.signatureLine" => json!(crate::patcher_signatures::signature_line(&b(args, 0)?)),
        "patcher-signatures.vanillaBranchHashes" => json!(crate::patcher_signatures::vanilla_branch_hashes(&s(args, 0))),
        "patcher-signatures.matchesVanilla" => {
            let want: Option<crate::patcher_signatures::Hashes> = from_arg(args, 1)?;
            json!(crate::patcher_signatures::matches_vanilla(&s(args, 0), want.as_ref()))
        }
        "patcher-signatures.hasSignaturePatch" => json!(crate::patcher_signatures::has_signature_patch(&s(args, 0))),
        "patcher-signatures.stripSignatures" => json!(crate::patcher_signatures::strip_signatures(&s(args, 0))),
        "vpk-analyze.analyzeVpkPaths" => json!(crate::vpk_analyze::analyze_vpk_paths(&strings(args, 0)?)),
        "vpk-analyze.slotDisplayName" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::vpk_analyze::slot_display_name(&s(args, 1)))
        }
        "vpk-analyze.describeHero" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let h: crate::vpk_analyze::HeroHit = from_arg(args, 1)?;
            json!(crate::vpk_analyze::describe_hero(&h))
        }
        "vpk-analyze.subjectHeroes" | "vpk-analyze.describeAnalysis" | "vpk-analyze.nameFromAnalysis" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let a = crate::vpk_analyze::analyze_vpk_paths(&strings(args, 1)?);
            match name {
                "vpk-analyze.subjectHeroes" => json!(crate::vpk_analyze::subject_heroes(&a)),
                "vpk-analyze.describeAnalysis" => json!(crate::vpk_analyze::describe_analysis(&a)),
                _ => json!(crate::vpk_analyze::name_from_analysis(&a)),
            }
        }
        "pak-stamp.gameSchemaStamp" => {
            json!(crate::pak_stamp::game_schema_stamp(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?)
        }
        "item-builder-sets.itemSets" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let text = b(args, 1)?;
            let slots = crate::item_builder_slots::item_slots(&text).map_err(kv_err)?;
            json!(crate::item_builder_sets::item_sets(&text, &slots).map_err(kv_err)?)
        }
        "item-builder-everyone.everyoneWears" => {
            // (pak, items_game, [{id, block, assets: [[path, latin1 bytes]]}], [[path, bytes]], heroes | null)
            let ix = pak(&s(args, 0))?;
            let entries = |v: &Value| -> Vec<crate::vpk::Entry> {
                v.as_array()
                    .map(|a| a.iter().map(|e| crate::vpk::entry_at(&crate::js::string(&e[0]), crate::kv::to_latin1(&crate::js::string(&e[1])).into())).collect())
                    .unwrap_or_default()
            };
            let list: Vec<crate::item_builder_everyone::SchemaPatch> = args
                .get(2)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| crate::item_builder_everyone::SchemaPatch {
                    id: crate::js::string(&p["id"]),
                    block: crate::kv::to_latin1(&crate::js::string(&p["block"])),
                    assets: entries(&p["assets"]),
                    source: String::new(),
                })
                .collect();
            let beneath = entries(args.get(3).unwrap_or(&Value::Null));
            let heroes: Option<Vec<String>> = args.get(4).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect());
            let out = crate::item_builder_everyone::everyone_wears(&b(args, 1)?, &list, &beneath, &|p: &str| ix.read(p).ok().flatten(), heroes.as_deref())
                .map_err(kv_err)?;
            json!(out
                .into_iter()
                .map(|p| json!([p.id, latin1(&p.block), p.assets.iter().map(|e| json!([e.path(), sha(Some(e.data.to_vec()))])).collect::<Vec<_>>(), p.source]))
                .collect::<Vec<_>>())
        }
        "item-builder-personas.personasOn" => {
            let records = args.first().and_then(Value::as_array).cloned().unwrap_or_default();
            json!(crate::item_builder_personas::personas_on(&records).into_iter().collect::<Vec<_>>())
        }
        "item-builder-personas.leftOut" => {
            // (record, [[hero, item]])
            let on: indexmap::IndexMap<String, String> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| a.iter().map(|x| (crate::js::string(&x[0]), crate::js::string(&x[1]))).collect())
                .unwrap_or_default();
            json!(crate::item_builder_personas::left_out(args.first().unwrap_or(&Value::Null), &on))
        }
        "item-builder-personas.displaced" => {
            let records = args.first().and_then(Value::as_array).cloned().unwrap_or_default();
            json!(crate::item_builder_personas::displaced(&records))
        }
        "item-builder-personas.isSelectorSlot" => json!(crate::item_builder_personas::is_selector_slot(&s(args, 0))),
        "item-builder-personas.personaRecords" => {
            let records = args.first().and_then(Value::as_array).cloned().unwrap_or_default();
            let (records, left) = crate::item_builder_personas::persona_records(&records, &b(args, 1)?).map_err(kv_err)?;
            json!({ "records": records, "left": left.into_iter().map(|(rec, why)| json!({ "rec": rec, "why": why })).collect::<Vec<_>>() })
        }
        "item-builder-personas.personaScales" => {
            // (pak, records, [{base, entries}]): the scales of the personas the records put on
            let ix = pak(&s(args, 0))?;
            let records: Vec<Value> = from_arg(args, 1)?;
            let on = crate::item_builder_personas::personas_on(&records);
            let scales = crate::item_builder_personas::persona_scales(&on, &ready_bases(args.get(2))?, &|p: &str| ix.read(p).ok().flatten());
            json!(scales.into_iter().collect::<Vec<_>>())
        }
        "item-builder-personas.personaScaleOf" => {
            let scales: Vec<(String, f64)> = from_arg(args, 1)?;
            json!(crate::item_builder_personas::persona_scale_of(args.first().unwrap_or(&Value::Null), &scales.into_iter().collect()))
        }
        "meshopt.encodeVertexBuffer" => {
            // (raw hex, count, size): version 0, as hex
            json!(hex(&crate::meshopt::encode_vertex_buffer_v0(&unhex(&s(args, 0)), n(args, 1) as usize, n(args, 2) as usize)?))
        }
        "model-scale.scaleModel" => json!(sha(Some(crate::model_scale::scale_model(&b(args, 0)?, n(args, 1))?))),
        "model-scale.modelScaleAgainst" => json!(crate::model_scale::model_scale_against(&b(args, 0)?, &b(args, 1)?)?),
        "model-scale.scaledModels" => {
            let scale = args.get(1).and_then(Value::as_f64);
            let mut skipped = Vec::new();
            let out = crate::model_scale::scaled_models(entries_arg(args.first())?, scale, &mut |p, _| skipped.push(json!(p)));
            json!([out.iter().map(|e| json!([e.path(), sha(Some(e.data.to_vec()))])).collect::<Vec<_>>(), skipped])
        }
        "item-builder-personas.personaAssets" => {
            // (record, [[path, latin1 bytes]], [{base, entries: [[path, bytes]]}]): the paths kept
            let ready = ready_bases(args.get(2))?;
            let kept = crate::item_builder_personas::persona_assets(args.first().unwrap_or(&Value::Null), entries_arg(args.get(1))?, &ready);
            json!(kept.iter().map(crate::vpk::Entry::path).collect::<Vec<_>>())
        }
        "item-builder-ability-fx.namedFxSlots" => {
            // (lang, pak, items_game): the whole offer's slots named
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let ix = pak(&s(args, 1))?;
            let slots = crate::item_builder_slots::item_slots(&b(args, 2)?).map_err(kv_err)?;
            json!(crate::item_builder_ability_fx::named_fx_slots(slots, &|p: &str| ix.read(p).ok().flatten(), &s(args, 0)))
        }
        "item-builder-ability-fx.mergeFxPatches" => {
            // ([{id, block, assets: [[path, latin1 bytes]], source}]), a source starting "fx " an
            // ability effects pick: [[id, block, [path], source]]
            let list: Vec<crate::item_builder_everyone::SchemaPatch> = args
                .first()
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| crate::item_builder_everyone::SchemaPatch {
                    id: crate::js::string(&p["id"]),
                    block: crate::kv::to_latin1(&crate::js::string(&p["block"])),
                    assets: p["assets"]
                        .as_array()
                        .map(|a| a.iter().map(|e| crate::vpk::entry_at(&crate::js::string(&e[0]), crate::kv::to_latin1(&crate::js::string(&e[1])).into())).collect())
                        .unwrap_or_default(),
                    source: crate::js::string(&p["source"]),
                })
                .collect();
            let out = crate::item_builder_ability_fx::merge_fx_patches(list, |p| p.source.starts_with("fx ")).map_err(kv_err)?;
            json!(out
                .iter()
                .map(|p| json!([p.id, latin1(&p.block), p.assets.iter().map(crate::vpk::Entry::path).collect::<Vec<_>>(), p.source]))
                .collect::<Vec<_>>())
        }
        "arcana.asModel" => {
            let m = s(args, 1);
            json!(sha(Some(crate::arcana::as_model(&b(args, 0)?, Some(&m))?)))
        }
        "arcana.withChildren" => {
            let children: Vec<crate::arcana::Child> =
                serde_json::from_value(args.get(1).cloned().unwrap_or(json!([]))).map_err(|e| e.to_string())?;
            json!(sha(Some(crate::arcana::with_children(&b(args, 0)?, &children)?)))
        }
        "arcana.withChildAt" => json!(sha(Some(crate::arcana::with_child_at(&b(args, 0)?, &s(args, 1), &s(args, 2))?))),
        "arcana.arcanaPictures" => shas(crate::arcana::arcana_pictures(&*pak(&s(args, 0))?, &s(args, 1))?),
        "arcana.arcanaSwaps" => shas(crate::arcana::arcana_swaps(&*pak(&s(args, 0))?, &s(args, 1), rgb(args, 2))?),
        "arcana.arcanaForms" => {
            let items: Vec<String> = serde_json::from_value(args.get(3).cloned().unwrap_or(json!([]))).map_err(|e| e.to_string())?;
            let mut files = indexmap::IndexMap::new();
            let mut log = Vec::new();
            crate::arcana::arcana_forms(&*pak(&s(args, 0))?, &s(args, 1), rgb(args, 2), &items, &mut files, &mut |m| log.push(m))?;
            json!([shas(files), log])
        }
        "arcana.buildArcana" => {
            let forms: Vec<String> = serde_json::from_value(args.get(3).cloned().unwrap_or(json!([]))).map_err(|e| e.to_string())?;
            let x = crate::arcana::build_arcana(&*pak(&s(args, 0))?, &s(args, 1), rgb(args, 2), &|_| false, &forms)?;
            let failed: Vec<&str> = x.failed.iter().map(|f| f.path.as_str()).collect();
            json!([sha(Some(x.vpk)), x.files, x.changed, failed])
        }
        "effect-edit.cleanEdits" => json!(effect_edit::clean_edits(args.first().unwrap_or(&Value::Null))),
        "effect-edit.systemsOf" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            json!(effect_edit::systems_of(&mut read, &s(args, 1)).into_iter().map(|(path, depth)| json!({ "path": path, "depth": depth })).collect::<Vec<_>>())
        }
        "effect-edit.editedEntries" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            let edits: effect_edit::EffectEdits = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(effect_edit::edited_entries(&mut read, &s(args, 1), &edits)?.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>())
        }
        "item-visuals.itemVisuals" => json!(item_visuals::item_visuals(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?),
        "item-visuals.findItems" => json!(item_visuals::find_items(&b(args, 0)?, &s(args, 1))
            .map_err(kv_err)?
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()),
        "item-visuals.defaultItem" => json!(item_visuals::default_item(&b(args, 0)?, &s(args, 1), &s(args, 2))
            .map_err(kv_err)?
            .map(|(id, model)| json!({ "id": id, "model": model }))),
        "item-visuals.buildPlan" => {
            let text = b(args, 0)?;
            match item_visuals::item_visuals(&text, &s(args, 1)).map_err(kv_err)? {
                Some(v) => json!(item_visuals::build_plan(&text, &v).map_err(kv_err)?),
                None => Value::Null,
            }
        }
        _ => return Err(format!("no function {name}")),
    })
}

/// Every call in a list of [name, ...args], each answered {ok} or {error}.
pub fn call_all(list: &[Value]) -> Vec<Value> {
    list.iter()
        .map(|c| {
            let parts = c.as_array().map(Vec::as_slice).unwrap_or(&[]);
            let name = parts.first().and_then(Value::as_str).unwrap_or("");
            match call(name, parts.get(1..).unwrap_or(&[])) {
                Ok(v) => json!({ "ok": no_negative_zero(v) }),
                Err(e) => json!({ "error": e }),
            }
        })
        .collect()
}

/// -0 as JSON.stringify writes it, 0: the TypeScript side of a comparison has been through it.
fn no_negative_zero(v: Value) -> Value {
    match v {
        Value::Number(n) if n.as_f64() == Some(0.0) && n.as_f64().is_some_and(f64::is_sign_negative) => json!(0),
        Value::Array(a) => Value::Array(a.into_iter().map(no_negative_zero).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, no_negative_zero(v))).collect()),
        other => other,
    }
}
