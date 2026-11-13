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

/// Body group choices as [[group, value]].
fn groups_arg(v: Option<&Value>) -> indexmap::IndexMap<String, f64> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().map(|g| (crate::js::string(&g[0]), g[1].as_f64().unwrap_or(0.0))).collect())
        .unwrap_or_default()
}

/// A store of arcana bases for a test: the files of each, or none yet, and the ones asked for.
struct TestBases {
    held: HashMap<String, Option<Vec<crate::vpk::Entry>>>,
    wanted: Mutex<Vec<String>>,
}

impl crate::arcana_bases::BaseSource for TestBases {
    fn entries(&self, id: &str) -> Option<Vec<crate::vpk::Entry>> {
        self.held.get(id).cloned().flatten()
    }
    fn want(&self, id: &str) {
        self.wanted.lock().unwrap().push(id.to_string());
    }
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

/// What the services' parity script keeps between its steps.
struct Services {
    fp: crate::fingerprints::Fingerprints,
    terrain: crate::terrain_age::TerrainAges,
    impact: crate::update_impact::UpdateImpact,
    notice: crate::notice_text::NoticeText,
}

/// One step of the services behind mods:list (terrain ages, update impact, the notice text, the
/// scream guard and the listing itself); anything else is a step of `write_step`.
fn services_step(
    root: &std::path::Path,
    inst: &crate::installer::Installer,
    lib: &mut crate::library::Library,
    sv: &mut Services,
    op: &Value,
) -> Result<Value, String> {
    use std::path::PathBuf;
    let at = |v: &Value| -> PathBuf {
        let p = crate::js::string(v);
        match p.strip_prefix("@/") {
            Some(rest) => rest.split('/').fold(root.to_path_buf(), |p, s| p.join(s)),
            None => PathBuf::from(p),
        }
    };
    let text = |v: &Value| crate::js::string(v);
    let lang = inst.lang_folder().ok();
    let mods_of = |lib: &crate::library::Library| {
        crate::update_impact::impact_mods(lib.list(), &|r| inst.lang_file_on_disk(r).unwrap_or_default())
    };
    let num = |n: Option<f64>| n.map_or(Value::Null, crate::js::json_number);
    Ok(match op[0].as_str().unwrap_or("") {
        "copy" => {
            std::fs::copy(at(&op[1]), at(&op[2])).map_err(|e| e.to_string())?;
            Value::Null
        }
        "setMtime" => {
            let f = std::fs::File::options().write(true).open(at(&op[1])).map_err(|e| e.to_string())?;
            let ms = op[2].as_u64().unwrap_or(0);
            f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms)).map_err(|e| e.to_string())?;
            Value::Null
        }
        "zipTime" => num(crate::terrain_age::map_time_in_archive(&at(&op[1]))),
        "zipTimeBytes" => {
            num(crate::terrain_age::map_time_in_zip(&std::fs::read(at(&op[1])).map_err(|e| e.to_string())?))
        }
        "stale" => json!(crate::terrain_age::is_stale(op[1].as_f64(), op[2].as_f64())),
        "ages" => {
            let ages = sv.terrain.for_records(lib.list());
            Value::Object(
                ages.into_iter().map(|(id, a)| (id, json!({ "builtAt": num(a.built_at), "stale": a.stale }))).collect(),
            )
        }
        "terrainOff" => {
            let mut off = Vec::new();
            let names = sv.terrain.switch_off_stale(lib.list(), &mut |r| off.push(r["id"].clone()));
            json!({ "names": names, "off": off })
        }
        "terrainCatalog" => {
            let terrains = op[1].as_array().cloned().unwrap_or_default();
            let hashes = op[2].clone();
            let tails = op[3].clone();
            let hash_of = |f: &str| hashes.get(f).and_then(Value::as_str).map(String::from);
            let mut fetch = |_: &str, f: &str| -> Result<Option<Vec<u8>>, String> {
                match tails.get(f) {
                    Some(v) if v.is_string() => std::fs::read(at(v)).map(Some).map_err(|e| e.to_string()),
                    _ => Err("offline".into()),
                }
            };
            sv.terrain.for_catalog(&terrains, &hash_of, &mut fetch)
        }
        "scream" => {
            let key = op[1].clone();
            let mut log = |_: String| {};
            json!(crate::scream_guard::guard(
                lib,
                &key,
                &mut |rec| {
                    let dir = crate::overlays::files_of(rec.get("files").unwrap_or(&Value::Null))
                        .into_iter()
                        .find(|f| f.root == "lang" && f.rel_path.to_lowercase().ends_with("_dir.vpk"));
                    let Some(dir) = dir else { return Some(Vec::new()) };
                    let p = inst.lang_file_on_disk(&dir.rel_path).ok()?;
                    crate::vpk::read_index_file(&p).and_then(|b| crate::vpk::list_paths(&b)).ok()
                },
                &mut |lib, rec| {
                    let files = crate::overlays::files_of(rec.get("files").unwrap_or(&Value::Null));
                    inst.set_enabled(&files, false, rec.get("id").and_then(Value::as_str))?;
                    lib.set_enabled(&rec["id"], false, None).map_err(|e| e.to_string())?;
                    Ok(())
                },
                &mut log,
            )?)
        }
        "impactCheck" => {
            let mods = mods_of(lib);
            sv.impact.check(&mods, op[1].as_str().map(String::from), &mut |_| {})?
        }
        "impactMarked" => Value::Object(sv.impact.marked(&mods_of(lib)).into_iter().collect()),
        "impactClear" => json!(sv.impact.clear(&text(&op[1]))?),
        "uiLang" => json!(crate::notice_text::ui_language(inst.game.as_deref().unwrap_or(std::path::Path::new("")))),
        "declared" => json!(crate::notice_text::declared_language(&text(&op[1]))),
        "withTokens" => {
            let tokens: indexmap::IndexMap<String, String> =
                op[2].as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), text(v))).collect()).unwrap_or_default();
            json!(crate::notice_text::with_tokens(&text(&op[1]), &tokens))
        }
        "noticePlan" => crate::notice_text::plan_value(&crate::notice_text::plan(
            inst.game.as_deref().unwrap_or(std::path::Path::new("")),
            lang.as_deref().unwrap_or(std::path::Path::new("")),
        )),
        "noticeApply" => json!(crate::notice_text::apply_notice(inst.game.as_deref(), lang.as_deref())?),
        "noticeRefresh" => {
            json!(sv.notice.refresh(
                inst.game.as_deref(),
                lang.as_deref().unwrap_or(std::path::Path::new("")),
                &mut |_| {}
            ))
        }
        "noticeOwned" => {
            json!(crate::notice_text::NoticeText::owned_files(lang.as_deref().unwrap_or(std::path::Path::new(""))))
        }
        "fpStore" => {
            sv.fp.store(&text(&op[1]))?;
            Value::Null
        }
        "listMods" => {
            let key = op[1].clone();
            let impact = &sv.impact;
            let marked = |lib: &crate::library::Library| Ok(impact.marked(&mods_of(lib)));
            let mut guard = |lib: &mut crate::library::Library| -> Result<(), String> {
                crate::scream_guard::guard(
                    lib,
                    &key,
                    &mut |rec| {
                        let dir = crate::overlays::files_of(rec.get("files").unwrap_or(&Value::Null))
                            .into_iter()
                            .find(|f| f.root == "lang" && f.rel_path.to_lowercase().ends_with("_dir.vpk"));
                        let Some(dir) = dir else { return Some(Vec::new()) };
                        let p = inst.lang_file_on_disk(&dir.rel_path).ok()?;
                        crate::vpk::read_index_file(&p).and_then(|b| crate::vpk::list_paths(&b)).ok()
                    },
                    &mut |lib, rec| {
                        let files = crate::overlays::files_of(rec.get("files").unwrap_or(&Value::Null));
                        inst.set_enabled(&files, false, rec.get("id").and_then(Value::as_str))?;
                        lib.set_enabled(&rec["id"], false, None).map_err(|e| e.to_string())?;
                        Ok(())
                    },
                    &mut |_| {},
                )
                .map(|_| ())
            };
            let owned =
                crate::notice_text::NoticeText::owned_files(lang.as_deref().unwrap_or(std::path::Path::new("")));
            let (answer, after) = crate::mods_listing::list_mods(
                inst,
                lib,
                crate::mods_listing::ListingDeps {
                    fingerprints: &mut sv.fp,
                    terrain_ages: &sv.terrain,
                    marked: Some(&marked),
                    guard: Some(&mut guard),
                    notice_owned: owned,
                    schema_on: false,
                    verify_stuck: json!(false),
                    diag: &mut |_| {},
                },
            );
            if let (Some(on), Some(game)) = (after.ring_on, inst.game.as_deref()) {
                crate::emblem_ring::keep_ring(game, on)?;
            }
            answer
        }
        _ => write_step(root, inst, lib, op)?,
    })
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

/// A work area as {width, height}, or none.
fn area_arg(args: &[Value], i: usize) -> Option<crate::main_window::Area> {
    let a = args.get(i)?.as_object()?;
    Some(crate::main_window::Area {
        width: crate::js::to_number(a.get("width").unwrap_or(&Value::Null)),
        height: crate::js::to_number(a.get("height").unwrap_or(&Value::Null)),
    })
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
        "model-hitboxes.fit" => {
            // ([[bone, [x, y, z]], ...])
            let points: Vec<(String, [f64; 3])> = args
                .first()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|p| {
                    let at = floats(p.as_array().map_or(&[][..], Vec::as_slice), 1);
                    (p.get(0).map(crate::js::string).unwrap_or_default(), [0, 1, 2].map(|c| at.get(c).copied().unwrap_or(f64::NAN)))
                })
                .collect();
            json!(model_hitboxes::fit_boxes(&points))
        }
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
        // (n): String(n)
        "js.number" => json!(crate::js::number(n(args, 0))),
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
        "model-particles.keyValuesWithParticles" => {
            let paths = strings(args, 1)?;
            let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
            json!(crate::model_particles::key_values_with_particles(&s(args, 0), &refs))
        }
        "model-particles.keyValueParticles" => json!(crate::model_particles::key_value_particles(&s(args, 0))),
        "model-particles.modelParticleEntries" => {
            let f = if args.first().is_none_or(Value::is_null) { None } else { Some(b(args, 0)?) };
            json!(crate::model_particles::model_particle_entries(f.as_deref().map(Vec::as_slice)))
        }
        "model-particles.withParticles" => {
            let paths = strings(args, 1)?;
            let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
            sha(crate::model_particles::with_particles(&b(args, 0)?, &refs))
        }
        "model-bodygroups.withBodygroups" => {
            sha(crate::model_bodygroups::with_bodygroups(&b(args, 0)?, &groups_arg(args.get(1)))?)
        }
        "model-bodygroups.withoutMeshes" => sha(crate::model_bodygroups::without_meshes(&b(args, 0)?)?),
        "model-bodygroups.hiddenMeshes" => {
            json!(crate::model_bodygroups::hidden_meshes(&b(args, 0)?, &groups_arg(args.get(1)))?)
        }
        "model-merge.mergedModel" => sha(crate::model_merge::merged_model(&b(args, 0)?, &b(args, 1)?)?),
        "item-files.pickParts" => {
            let own = args.get(1).and_then(Value::as_str);
            let unplaced = args.get(2).is_some_and(crate::js::truthy);
            json!(crate::item_files::pick_parts(&crate::kv::to_latin1(&s(args, 0)), own, unplaced).map_err(kv_err)?)
        }
        "item-files.extraPlaces" => {
            let (under, merged) = crate::item_files::extra_places(&strings(args, 0)?, &strings(args, 1)?);
            json!({ "under": under, "merged": merged })
        }
        "item-files.wornModel" => {
            let systems = strings(args, 2)?;
            let refs: Vec<&str> = systems.iter().map(String::as_str).collect();
            let skin = args.get(1).map_or(0.0, crate::js::to_number);
            sha(crate::item_files::worn_model(&b(args, 0)?, skin, &refs))
        }
        "schema-build.script" => {
            // (game, items_game, steps): builds of one table, each {records, bases, forget}
            let game = std::path::PathBuf::from(s(args, 0));
            let vanilla = b(args, 1)?;
            let mut tb = crate::schema_build::TableBuild::new();
            let steps = args.get(2).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for step in steps {
                if step.get("forget").is_some_and(crate::js::truthy) {
                    tb.forget();
                }
                let records = step.get("records").and_then(Value::as_array).cloned().unwrap_or_default();
                let store = match step.get("bases").and_then(Value::as_object) {
                    Some(m) => {
                        let mut held = HashMap::new();
                        for (id, e) in m {
                            held.insert(id.clone(), if e.is_null() { None } else { Some(entries_arg(Some(e))?) });
                        }
                        Some(TestBases { held, wanted: Mutex::new(Vec::new()) })
                    }
                    None => None,
                };
                let (mut progress, mut log) = (Vec::new(), Vec::new());
                let r = tb.build(
                    &vanilla,
                    &game,
                    &records,
                    store.as_ref().map(|s| s as &dyn crate::arcana_bases::BaseSource),
                    &mut |d, t| progress.push(json!([d, t])),
                    &mut |m| log.push(m),
                );
                let files = |e: &[crate::vpk::Entry]| {
                    json!(e.iter().map(|e| json!([e.path(), sha(Some(e.data.to_vec()))])).collect::<Vec<_>>())
                };
                let wanted = store.map(|s| s.wanted.into_inner().unwrap()).unwrap_or_default();
                let item_files = match (&r, step.get("files").is_some_and(crate::js::truthy)) {
                    (Ok(built), true) => {
                        let ix = pak(&game.join("dota").join("pak01_dir.vpk").to_string_lossy())?;
                        let read = |p: &str| ix.read(p).ok().flatten();
                        match crate::item_files::item_files(&built.list, &built.beneath, &read, Some(&built.files_shared)) {
                            Ok(f) => json!({
                                "entries": f.entries.iter().map(|e| json!([e.path(), sha(Some(e.data.to_vec()))])).collect::<Vec<_>>(),
                                "left": f.left,
                            }),
                            Err(e) => json!({ "error": e }),
                        }
                    }
                    _ => Value::Null,
                };
                out.push(match r {
                    Ok(built) => json!({
                        "itemFiles": item_files,
                        "list": built.list.iter().map(|p| json!({
                            "id": p.id, "block": latin1(&p.block), "source": p.source, "own": p.own, "added": p.added,
                            "unplaced": p.unplaced, "item": p.item, "assets": p.assets.as_deref().map(files),
                        })).collect::<Vec<_>>(),
                        "beneath": files(&built.beneath),
                        "shared": { "paths": built.files_shared.paths, "entries": files(&built.files_shared.entries) },
                        "progress": progress, "log": log, "wanted": wanted,
                    }),
                    Err(e) => json!({ "error": e, "progress": progress, "log": log, "wanted": wanted }),
                });
            }
            Value::Array(out)
        }
        "services.script" => {
            // (root, game, suffix, journalDir, userData, libraryDir, ops), as installer.script
            let root = std::path::PathBuf::from(s(args, 0));
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 1), &s(args, 2)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 3);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 5)));
            let mut sv = Services {
                fp: crate::fingerprints::Fingerprints::new(&ud),
                terrain: crate::terrain_age::TerrainAges {
                    downloads_dir: Some(inst.downloads_dir()),
                    game: inst.game.clone(),
                    store_file: Some(ud.join("terrain-ages.json")),
                },
                impact: crate::update_impact::UpdateImpact { file: ud.join("update-impact.json"), game: inst.game.clone() },
                notice: crate::notice_text::NoticeText::default(),
            };
            let ops = args.get(6).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(
                ops.iter()
                    .map(|op| match services_step(&root, &inst, &mut lib, &mut sv, op) {
                        Ok(v) => json!({ "ok": v }),
                        Err(e) => json!({ "error": e }),
                    })
                    .collect(),
            )
        }
        "build-undo.script" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): Cancel on the item table's bar
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1));
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(std::path::Path::new(&s(args, 4)));
            let mut undo = crate::build_undo::BuildUndo::default();
            let ops = args.get(5).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let r: Result<Value, String> = (|| {
                    let io = |e: std::io::Error| e.to_string();
                    Ok(match op[0].as_str().unwrap_or("") {
                        "mark" => {
                            undo.mark(&inst, &lib, &st);
                            Value::Null
                        }
                        "marked" => json!(undo.marked()),
                        "cancel" => {
                            let running = crate::js::truthy(&op[1]);
                            let mut logged = Vec::new();
                            let r = undo.cancel(&inst, &mut lib, &mut st, || running, &mut |m| logged.push(m))?;
                            json!({ "r": r, "log": logged })
                        }
                        "add" => {
                            lib.push_record(op[1].clone(), None).map_err(io)?;
                            Value::Null
                        }
                        "remove" => {
                            lib.remove_record(&op[1], None).map_err(io)?;
                            Value::Null
                        }
                        "update" => {
                            lib.update(&op[1], &op[2], None).map_err(io)?;
                            Value::Null
                        }
                        "enable" => {
                            let on = crate::js::truthy(&op[2]);
                            let rec = lib.find(&op[1]).cloned().unwrap_or(Value::Null);
                            let files: Vec<crate::overlays::LibFile> = rec
                                .get("files")
                                .and_then(Value::as_array)
                                .map(|a| a.iter().map(|f| crate::overlays::LibFile::new(&crate::js::string(&f["root"]), &crate::js::string(&f["relPath"]))).collect())
                                .unwrap_or_default();
                            if !files.is_empty() {
                                inst.set_enabled(&files, on, Some(&crate::js::string(&op[1])))?;
                            }
                            lib.set_enabled(&op[1], on, None).map_err(io)?;
                            Value::Null
                        }
                        "setting" => {
                            st.set(&crate::js::string(&op[1]), op[2].clone()).map_err(io)?;
                            Value::Null
                        }
                        "master" => json!({ "changed": inst.set_master_enabled(crate::js::truthy(&op[1]))? }),
                        "state" => json!({
                            "list": lib.list(),
                            "everyone": st.get("everyoneWearsMine"),
                            "pending": st.get("schemaPending"),
                            "off": inst.master_is_off().ok(),
                        }),
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "schema-harvest.script" => {
            // (game, suffix, journalDir, libraryDir, userData, {$file vanilla}, ops): records named by name
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(std::path::Path::new(&s(args, 4)));
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let vanilla = b(args, 5)?;
            let ops = args.get(6).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let r: Result<Value, String> = (|| {
                    let io = |e: std::io::Error| e.to_string();
                    let named = |lib: &crate::library::Library| lib.list().iter().find(|r| r.get("name") == op.get(1)).cloned();
                    Ok(match op[0].as_str().unwrap_or("") {
                        "harvest" => match named(&lib) {
                            Some(rec) => json!(crate::schema_harvest::harvest(&inst, &mut lib, &rec, &vanilla)
                                .map(|(d, st)| json!({ "deltas": d, "stripped": st }))),
                            None => Value::Null,
                        },
                        "split" => match named(&lib) {
                            Some(rec) => json!(crate::schema_harvest::split(&inst, &mut lib, &rec)?),
                            None => Value::Null,
                        },
                        "migrate" => json!(crate::schema_harvest::migrate(&inst, &mut lib, &vanilla)),
                        "list" => json!(lib.list()),
                        "pakLeft" => crate::item_files_service::ItemFilesPak::left(&lib),
                        "pakClear" => {
                            crate::item_files_service::ItemFilesPak::clear(&inst, &mut lib)?;
                            Value::Null
                        }
                        "pakWrite" => {
                            let entries: Vec<crate::vpk::Entry> = op[1]
                                .as_array()
                                .map(|a| {
                                    a.iter()
                                        .map(|e| crate::vpk::entry_at(&crate::js::string(&e[0]), crate::js::string(&e[1]).into_bytes().into()))
                                        .collect()
                                })
                                .unwrap_or_default();
                            let left: Vec<crate::item_files::LeftBehind> =
                                serde_json::from_value(op[3].clone()).map_err(|e| e.to_string())?;
                            let mut logged = Vec::new();
                            crate::item_files_service::ItemFilesPak::write(
                                &inst,
                                &mut lib,
                                &entries,
                                op[2].as_u64().unwrap_or(0) as usize,
                                &left,
                                &mut |m| logged.push(m),
                            )?;
                            json!(logged)
                        }
                        "enable" => {
                            let rec = named(&lib).ok_or("no record")?;
                            let on = crate::js::truthy(&op[2]);
                            let files: Vec<crate::overlays::LibFile> = rec["files"]
                                .as_array()
                                .map(|a| {
                                    a.iter()
                                        .map(|f| crate::overlays::LibFile::new(&crate::js::string(&f["root"]), &crate::js::string(&f["relPath"])))
                                        .collect()
                                })
                                .unwrap_or_default();
                            inst.set_enabled(&files, on, Some(&crate::js::string(&rec["id"])))?;
                            lib.set_enabled(&rec["id"], on, None).map_err(io)?;
                            Value::Null
                        }
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "schema-deploy.script" => {
            // (game, folder, ops): the table written, checked for, swept and taken away
            let game = std::path::PathBuf::from(s(args, 0));
            let folder = s(args, 1);
            let base = crate::schema::read_game_schema(&game)?;
            let entries = |v: &Value| -> Vec<crate::vpk::Entry> {
                v.as_array()
                    .map(|a| {
                        a.iter()
                            .map(|e| {
                                crate::vpk::entry_at(&crate::js::string(&e[0]), crate::kv::to_latin1(&crate::js::string(&e[1])).into())
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let ops = args.get(2).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let r: Result<Value, String> = (|| {
                    Ok(match op[0].as_str().unwrap_or("") {
                        "isDeployed" => json!(crate::schema_deploy::is_deployed(&game, &folder)),
                        "sweep" => json!(crate::schema_deploy::sweep_unfinished(&game, &folder, op[1].as_u64().unwrap_or(0) as u32)),
                        "sha" => {
                            let f = game.join(&folder).join(crate::schema_deploy::SCHEMA_VPK);
                            sha(std::fs::read(f).ok())
                        }
                        "undeploy" => {
                            crate::schema_deploy::undeploy(&game, &folder).map_err(|e| e.to_string())?;
                            Value::Null
                        }
                        "deploy" => {
                            let list = op[1].as_array().cloned().unwrap_or_default();
                            let patches: Vec<crate::schema_merge::Patch> = list
                                .iter()
                                .map(|p| crate::schema_merge::Patch {
                                    id: crate::js::string(&p["id"]),
                                    block: crate::kv::to_latin1(&crate::js::string(&p["block"])),
                                    source: crate::js::string(&p["source"]),
                                })
                                .collect();
                            let own: Vec<Vec<crate::vpk::Entry>> = list.iter().map(|p| entries(&p["assets"])).collect();
                            let beneath = entries(&op[2]);
                            let mut assets: Vec<&[crate::vpk::Entry]> = own.iter().map(Vec::as_slice).collect();
                            assets.push(&beneath);
                            let stop = crate::js::truthy(&op[3]);
                            json!(crate::schema_deploy::deploy(&game, &folder, &patches, &assets, (&base.0, &base.1), &|| stop)?)
                        }
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "schema-service.script" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each answer, with the paths a written table fills
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(&ud);
            let mut svc = crate::schema_service::SchemaService::new(&ud, true);
            let ops = args.get(5).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let mut filled: Vec<String> = Vec::new();
                let r: Result<Value, String> = (|| {
                    let io = |e: std::io::Error| e.to_string();
                    let mut log = |_: String| {};
                    let mut deployed = |s: std::collections::HashSet<String>| {
                        filled = s.into_iter().collect();
                        filled.sort();
                    };
                    let mut ctx = crate::schema_service::Ctx {
                        inst: &inst,
                        lib: &mut lib,
                        settings: &mut st,
                        bases: None,
                        log: &mut log,
                        on_deployed: &mut deployed,
                    };
                    Ok(match op[0].as_str().unwrap_or("") {
                        "state" => crate::schema_service::state(&inst, ctx.lib, ctx.settings, true),
                        "refresh" => json!(svc.refresh(&mut ctx, &|| false, &mut |_, _| {})),
                        "heal" => json!(svc.heal(&mut ctx, crate::js::truthy(&op[1]))),
                        "setEnabled" => svc.set_enabled(&mut ctx, crate::js::truthy(&op[1])),
                        "settings" => {
                            let all: Value = std::fs::read_to_string(ud.join("settings.json"))
                                .ok()
                                .and_then(|t| serde_json::from_str(&t).ok())
                                .unwrap_or(Value::Null);
                            let g = |k: &str| all.get(k).cloned().unwrap_or(Value::Null);
                            json!({ "patch": g("schemaPatch"), "stamp": g("schemaStamp"), "pending": g("schemaPending"), "everyone": g("everyoneWearsMine") })
                        }
                        "list" => json!(ctx.lib.list()),
                        "set" => {
                            ctx.settings.set(&crate::js::string(&op[1]), op[2].clone()).map_err(io)?;
                            Value::Null
                        }
                        "master" => json!({ "changed": inst.set_master_enabled(crate::js::truthy(&op[1]))? }),
                        "remove" => {
                            ctx.lib.remove_record(&op[1], None).map_err(io)?;
                            Value::Null
                        }
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v, "filled": filled }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "schema-cosmetics.script" => {
            // (lang, game, libraryDir, userData, itemsGameFile, ops): each answer, the library after it
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let lang = crate::i18n::lang().code();
            let game = opt_path(args, 1);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 2)));
            let mut st = crate::settings::Settings::new(std::path::Path::new(&s(args, 3)));
            let file = std::path::PathBuf::from(s(args, 4));
            let text = std::fs::read(&file).unwrap_or_default();
            let ops = args.get(5).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let n = |v: &Value| v.as_f64().unwrap_or(0.0);
                let r: Result<Value, String> = (|| {
                    Ok(match op[0].as_str().unwrap_or("") {
                        "slots" => crate::schema_cosmetics::cosmetic_slots(&lib, game.as_deref(), &text, lang),
                        "pick" => json!(crate::schema_cosmetics::pick_cosmetic(
                            &mut lib,
                            &crate::js::string(&op[1]),
                            &crate::js::string(&op[2]),
                            op[3].as_str(),
                            Some(&op[4])
                        )?),
                        "set" => {
                            let (applied, pieces) =
                                crate::schema_cosmetics::pick_set(&mut lib, &text, &crate::js::string(&op[1]), n(&op[2]))?;
                            json!({ "applied": applied, "pieces": pieces })
                        }
                        "look" => {
                            let (applied, picks) =
                                crate::schema_cosmetics::wear_look(&mut lib, &crate::js::string(&op[1]), &op[2])?;
                            json!({ "applied": applied, "picks": picks })
                        }
                        "settings" => {
                            st.set(&crate::js::string(&op[1]), op[2].clone()).map_err(|e| e.to_string())?;
                            Value::Null
                        }
                        "migrate" => {
                            let read = || std::fs::read(&file).map_err(|e| e.to_string());
                            let read: &dyn Fn() -> Result<Vec<u8>, String> = &read;
                            json!(crate::schema_cosmetics::migrate_cosmetic_settings(&mut lib, &mut st, game.as_ref().map(|_| read)))
                        }
                        "list" => json!(lib.list()),
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "presets.script" => {
            // (lang, ops): the link, the ready list, the .d2mm file; each answer or its error
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let ops = args.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
            let entry = |v: &Value| -> Result<crate::preset_share::EntryToWrite, String> {
                fn one(v: &Value) -> Result<crate::preset_share::EntryToWrite, String> {
                    let line = v.as_object().cloned().unwrap_or_default();
                    let data = match line.get("data") {
                        Some(d) => Some(b(std::slice::from_ref(d), 0)?.to_vec()),
                        None => None,
                    };
                    let members = line
                        .get("members")
                        .and_then(Value::as_array)
                        .map(|m| m.iter().map(one).collect::<Result<Vec<_>, _>>())
                        .transpose()?
                        .unwrap_or_default();
                    Ok(crate::preset_share::EntryToWrite { line, data, members })
                }
                one(v)
            };
            let mut out = Vec::new();
            for op in &ops {
                let r: Result<Value, String> = (|| {
                    Ok(match op[0].as_str().unwrap_or("") {
                        "encode" => {
                            let mods = op[3].as_array().cloned().unwrap_or_default();
                            json!(crate::preset_link::encode_preset_link(&op[1], &op[2], &mods))
                        }
                        "decode" => json!(crate::preset_link::decode_preset_link(&op[1])?),
                        "ready" => json!(crate::ready_presets_format::normalize_ready(&op[1])),
                        "validate" => crate::preset_share::validate_manifest(&op[1])?,
                        "write" => {
                            let entries = op[3].as_array().map(|a| a.iter().map(entry).collect::<Result<Vec<_>, _>>()).transpose()?.unwrap_or_default();
                            let manifest = op[2].as_object().cloned().unwrap_or_default();
                            let (size, mods) = crate::preset_share::write_preset_file(std::path::Path::new(&crate::js::string(&op[1])), &manifest, entries, n(op.as_array().map(Vec::as_slice).unwrap_or(&[]), 4))?;
                            json!({ "path": op[1], "size": size, "mods": mods })
                        }
                        "read" => {
                            let mut f = crate::preset_share::PresetFile::open(std::path::Path::new(&crate::js::string(&op[1])))?;
                            let files: Vec<Value> = op[2]
                                .as_array()
                                .cloned()
                                .unwrap_or_default()
                                .iter()
                                .map(|name| match f.read_mod(&crate::js::string(name)) {
                                    Ok(d) => json!({ "sha1": crate::safe_zip::sha1_hex(&d) }),
                                    Err(e) => json!({ "error": e }),
                                })
                                .collect();
                            json!({ "manifest": f.manifest, "files": files })
                        }
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "presets-service.script" => {
            // (lang, game, suffix, libraryDir, userData, catalog, ops): each answer, the library after it
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let ud = std::path::PathBuf::from(s(args, 4));
            let inst = crate::installer::Installer::new(opt_path(args, 1), &s(args, 2)).with_user_data(&ud);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(&ud);
            let catalog = args.get(5).filter(|c| !c.is_null());
            let cat = crate::preset_plan::CatalogIndex::new(catalog);
            let ops = args.get(6).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let r: Result<Value, String> = (|| {
                    let preset = || lib.get_preset(&op[1]).cloned().ok_or_else(|| "no preset".to_string());
                    Ok(match op[0].as_str().unwrap_or("") {
                        "entries" => {
                            let entries = crate::preset_plan::preset_share_entries(&lib, &inst, &preset()?, &cat)?;
                            let mut sums = Vec::new();
                            let mut sum = |e: &crate::preset_plan::ShareEntry| match e.data(&inst) {
                                Ok(d) => sums.push(json!(d.map(|d| crate::safe_zip::sha1_hex(&d)))),
                                Err(e) => sums.push(json!({ "error": e })),
                            };
                            for e in &entries {
                                sum(e);
                                e.members.iter().for_each(&mut sum);
                            }
                            json!({ "plan": crate::preset_plan::plan_shape(&entries), "lines": entries.iter().map(|e| e.to_value()).collect::<Vec<_>>(), "data": sums })
                        }
                        "link" => {
                            let (mods, skipped) = crate::preset_plan::preset_link_mods(&lib, &preset()?, &cat)?;
                            json!({ "mods": mods, "skipped": skipped })
                        }
                        "status" => crate::preset_plan::shared_preset_status(&lib, &inst, &preset()?, &cat),
                        "fps" => {
                            let mut v: Vec<(String, Value)> = crate::preset_plan::installed_fp_index(&lib, &inst).into_iter().collect();
                            v.sort_by(|a, b| a.0.cmp(&b.0));
                            json!(v.into_iter().map(|(k, id)| json!([k, id])).collect::<Vec<_>>())
                        }
                        "catalogSize" => json!(cat.len()),
                        "isOn" => json!(crate::presets_service::preset_is_on(&lib, &preset()?)?),
                        "state" => crate::presets_service::preset_state(&lib, Some(&st), &preset()?)?,
                        "apply" => {
                            let p = preset()?;
                            let mut pick = |lib: &mut crate::library::Library, p: &Value| -> Result<(), String> {
                                let effect = p.get("effectId").cloned().unwrap_or(Value::Null);
                                crate::schema_cosmetics::pick_cosmetic(lib, &crate::js::string(&p["slot"]), &crate::js::string(&p["itemId"]), p["name"].as_str(), Some(&effect))?;
                                Ok(())
                            };
                            let a = crate::presets_service::apply_preset(&mut lib, &inst, Some(&mut st), &p, crate::js::truthy(&op[2]), &mut pick)?;
                            json!({ "errors": a.errors, "schemaTouched": a.schema_touched })
                        }
                        "importFile" => crate::presets_service::import_preset_file(&mut lib, &ud, std::path::Path::new(&crate::js::string(&op[1]))),
                        "importLink" => crate::presets_service::import_preset_link(&mut lib, &op[1]),
                        "pack" => {
                            let ids = op[2].as_array().cloned().unwrap_or_default();
                            let mut deployed = Vec::new();
                            let r = crate::presets_service::pack_from_records(&mut lib, &inst, &crate::js::string(&op[1]), &ids, &mut |p| deployed.push(p["id"].clone()))?;
                            json!({ "pack": r, "deployed": deployed })
                        }
                        "drop" => {
                            crate::presets_service::drop_shared_preset_file(lib.get_preset(&op[1]));
                            Value::Null
                        }
                        "list" => json!(lib.list()),
                        "presets" => json!(lib.list_presets()),
                        "packable" => json!(lib.list().iter().map(|r| crate::presets_service::packable_record(Some(r))).collect::<Vec<_>>()),
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "preset-install.script" => {
            // (lang, game, suffix, libraryDir, userData, catalog, downloads {fileRef: vpk}, vanillaFile, blocked, ops)
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let ud = std::path::PathBuf::from(s(args, 4));
            let inst = crate::installer::Installer::new(opt_path(args, 1), &s(args, 2)).with_user_data(&ud);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(&ud);
            let cat = crate::preset_plan::CatalogIndex::new(args.get(5).filter(|c| !c.is_null()));
            let downloads = args.get(6).cloned().unwrap_or(Value::Null);
            let vanilla = opt_path(args, 7).and_then(|p| std::fs::read(p).ok());
            let blocked = opt_s(args, 8).filter(|b| !b.is_empty());
            let ops = args.get(9).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut out = Vec::new();
            for op in &ops {
                let mut progress: Vec<Value> = Vec::new();
                let mut deployed: Vec<Value> = Vec::new();
                let r: Result<Value, String> = (|| {
                    let mut fetch = |hit: &Value| -> Result<Vec<Value>, String> {
                        let file = downloads.get(crate::js::string(&hit["fileRef"])).map(crate::js::string).ok_or("no such download")?;
                        crate::import::install_vpk_buffer(&inst, &std::fs::read(file).map_err(|e| e.to_string())?)
                    };
                    let mut pick = |lib: &mut crate::library::Library, p: &Value| {
                        let effect = p.get("effectId").cloned().unwrap_or(Value::Null);
                        crate::schema_cosmetics::pick_cosmetic(lib, &crate::js::string(&p["slot"]), &crate::js::string(&p["itemId"]), p["name"].as_str(), Some(&effect))
                    };
                    let mut deploy = |p: &Value| deployed.push(p["id"].clone());
                    let mut prog = |v: Value| progress.push(v);
                    let mut d = crate::preset_install::Deps {
                        inst: &inst,
                        lib: &mut lib,
                        settings: Some(&mut st),
                        vanilla: vanilla.as_deref(),
                        cosmetics_blocked: blocked.clone(),
                        fetch: &mut fetch,
                        pick: &mut pick,
                        deploy_pack: &mut deploy,
                        progress: &mut prog,
                    };
                    let outcome = |o: crate::preset_install::Outcome| json!({ "answer": o.answer, "schema": o.schema, "afterMaster": o.after_master });
                    Ok(match op[0].as_str().unwrap_or("") {
                        "own" => {
                            let p = d.lib.get_preset(&op[1]).cloned().ok_or("no preset")?;
                            outcome(crate::preset_install::apply_own(&mut d, &p, &cat)?)
                        }
                        "resolve" => {
                            let p = d.lib.get_preset(&op[1]).cloned().ok_or("no preset")?;
                            outcome(crate::preset_install::resolve(&mut d, &p, &cat)?)
                        }
                        "fromCatalog" => {
                            let mut errors = Vec::new();
                            let r = crate::preset_install::install_from_catalog(&mut d, &op[1], &cat, &mut errors)?;
                            json!({ "rec": r, "errors": errors })
                        }
                        "adopt" => {
                            let files = op[1].as_array().cloned().unwrap_or_default();
                            json!(crate::adopt::adopt_imported_files(&inst, d.lib, d.vanilla, &files, op[2].as_str(), op.get(3), None)?)
                        }
                        "register" => {
                            let results = op[1].as_array().cloned().unwrap_or_default();
                            let mut steps = Vec::new();
                            let mut r = crate::adopt::register_import_results(&inst, d.lib, d.vanilla, &results, &mut |a, b| steps.push(json!([a, b])))?;
                            r["steps"] = json!(steps);
                            r
                        }
                        "cursorsOff" => json!(crate::cursors::disable_other_cursors(&inst, d.lib, op.get(1).filter(|v| !v.is_null()))),
                        "cosmeticsOff" => {
                            let rec = d.lib.find(&op[1]).cloned().unwrap_or(Value::Null);
                            json!(crate::cursors::disable_other_cosmetics(d.lib, &rec))
                        }
                        "masterCursors" => {
                            crate::cursors::apply_master_to_cursors(&inst, d.lib, crate::js::truthy(&op[1]));
                            Value::Null
                        }
                        "reconcile" => {
                            crate::cursors::reconcile_cursors(&inst, d.lib, true);
                            Value::Null
                        }
                        "list" => json!(d.lib.list()),
                        "presets" => json!(d.lib.list_presets()),
                        other => return Err(format!("no step {other}")),
                    })
                })();
                out.push(match r {
                    Ok(v) => json!({ "ok": v, "progress": progress, "deployed": deployed }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
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
        "net.script" => {
            // (ops): one network, each answer in turn; a request's failure is an answer too
            use crate::net_fetch::{DownloadOptions, FetchOptions, Net, NetError, Timing};
            use crate::net_mirrors::{Map, Mirror};
            let net = Net::default();
            let fail = |e: NetError| json!({ "error": e.message, "offline": e.offline, "timeout": e.timeout, "checksum": e.checksum });
            let mirror = |m: &Value| Mirror {
                host: crate::js::string(&m["host"]),
                map: Map::Prefix(crate::js::string(&m["prefix"])),
                origin: m.get("origin").is_some_and(crate::js::truthy),
                small_only: m.get("smallOnly").is_some_and(crate::js::truthy),
                pictures: None,
            };
            let mut out = Vec::new();
            for op in args.first().and_then(Value::as_array).cloned().unwrap_or_default() {
                let st = |i: usize| crate::js::string(&op[i]);
                let flag = |i: usize| op.get(i).is_some_and(crate::js::truthy);
                let now = crate::net_fetch::now_ms();
                out.push(match op[0].as_str().unwrap_or("") {
                    "setMirrors" => {
                        net.chain().set_mirrors(op[1].as_array().map(|l| l.iter().map(mirror).collect()));
                        Value::Null
                    }
                    "apply" => json!(net.chain().apply_mirrors(&op[1])),
                    "mirrorsFor" => json!(net.chain().mirrors_for(&st(1), flag(2), flag(3))),
                    "entriesFor" => json!(net.chain().entries_for(&st(1), flag(2), flag(3))),
                    "live" => {
                        let c = net.chain();
                        json!(c.live_order(c.entries_for(&st(1), flag(2), false), now))
                    }
                    "wellFormed" => json!(crate::net_mirrors::well_formed_mirror(&op[1])),
                    "pictures" => json!(net.chain().picture_bases()),
                    "fail" => {
                        net.chain().note_failure(&st(1), &st(2), now);
                        Value::Null
                    }
                    "stall" => {
                        net.chain().note_stall(&st(1), &st(2), now);
                        Value::Null
                    }
                    "success" => {
                        net.chain().note_success(&st(1));
                        Value::Null
                    }
                    "stoodDown" => json!(net.chain().stood_down(&st(1), now)),
                    "health" => json!(net.chain().mirror_health(now)),
                    "reset" => {
                        net.chain().reset_health();
                        Value::Null
                    }
                    "timing" => {
                        net.set_timing(Some(Timing { head_ms: op[1].as_u64().unwrap_or(10000), idle_ms: op[2].as_u64().unwrap_or(30000) }));
                        Value::Null
                    }
                    "text" => {
                        let o = &op[2];
                        let exclude = o.get("exclude").and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
                        let opts = FetchOptions { trusted_only: o.get("trustedOnly").is_some_and(crate::js::truthy), exclude, ..Default::default() };
                        net.fetch_text(&st(1), opts).map_or_else(fail, |t| json!({ "text": t }))
                    }
                    "download" => {
                        let o = &op[3];
                        let mut steps = 0u64;
                        let mut progress = |_: u64, _: u64| steps += 1;
                        let opts = DownloadOptions {
                            on_progress: Some(&mut progress),
                            expect_sha256: o.get("expect").and_then(Value::as_str).map(String::from),
                            from_published_list: o.get("published").is_some_and(crate::js::truthy),
                            log: None,
                        };
                        net.download_file(&st(1), std::path::Path::new(&st(2)), opts)
                            .map_or_else(fail, |d| json!({ "bytes": d.bytes, "sha256": d.sha256, "resumedFrom": d.resumed_from, "unverified": d.unverified }))
                    }
                    "proxy" => crate::net_fetch::validate_download_proxy(&op[1]).map_or_else(|e| json!({ "ok": false, "error": e }), |v| json!({ "ok": true, "value": v })),
                    "cut" => {
                        let f = std::fs::OpenOptions::new().write(true).open(st(1)).map_err(|e| e.to_string())?;
                        f.set_len(5000).map_err(|e| e.to_string())?;
                        Value::Null
                    }
                    "lang" => {
                        crate::i18n::set_lang(crate::i18n::Lang::parse(&st(1)));
                        Value::Null
                    }
                    "fetchMod" => {
                        // (userData, categoryId, fileRef, label, published hashes by "cat/file"): the path, or why not, and the stages
                        let inst = crate::installer::Installer::new(None, "").with_user_data(std::path::Path::new(&st(1)));
                        let hashes = op[5].clone();
                        let published = |c: &str, f: &str| hashes.get(format!("{c}/{f}")).and_then(Value::as_str).map(String::from);
                        let mut events: Vec<Value> = Vec::new();
                        let r = inst.download(&net, &st(2), &st(3), op[4].as_str(), &published, &mut |e: Value| events.push(e));
                        let last = events.iter().rev().find(|e| e["type"] == json!("download")).cloned();
                        let stages: Vec<Value> = events.into_iter().filter(|e| e["type"] != json!("download")).collect();
                        let mut a = r.map_or_else(|e| json!({ "error": e }), |p| json!({ "path": p }));
                        a["stages"] = json!(stages);
                        a["last"] = last.unwrap_or(Value::Null);
                        a["index"] = Value::Object(inst.download_index());
                        a
                    }
                    "sig" => {
                        let payload = b(op.as_array().map_or(&[][..], Vec::as_slice), 1)?;
                        json!(crate::catalog_signature::verify(&payload, &st(2), &op.get(3).map_or_else(|| crate::catalog_signature::CATALOG_PUBLIC_KEY.to_string(), crate::js::string)))
                    }
                    other => return Err(format!("no step {other}")),
                });
            }
            Value::Array(out)
        }
        "remote.script" => {
            // (serverBase, catalogKey, configKey, userDataRoot, ops): the catalog, the remote config and the
            // ready presets on one network, each answer in turn; `state` points the chain at a folder of the server
            use crate::net_mirrors::{Map, Mirror};
            let net = crate::net_fetch::Net::default();
            let (base, cat_key, cfg_key, root) = (s(args, 0), s(args, 1), s(args, 2), std::path::PathBuf::from(s(args, 3)));
            let clock = Arc::new(Mutex::new(0.0f64));
            let mut gen = 0;
            let mut catalog: Option<crate::catalog::Catalog> = None;
            let mut cfg: Option<crate::remote_config::RemoteConfig> = None;
            let mut ready: Option<crate::ready_presets::ReadyPresets> = None;
            let mut out = Vec::new();
            for op in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let st = |i: usize| crate::js::string(&op[i]);
                let mut logs: Vec<String> = Vec::new();
                let mut log = |m: &str| logs.push(m.to_string());
                let none = || "no catalog yet".to_string();
                out.push(match op[0].as_str().unwrap_or("") {
                    "cmp" => json!(crate::remote_config::cmp_version(&st(1), &st(2))),
                    "normalize" => crate::remote_config::normalize(&op[1]),
                    "normalizeCatalog" => {
                        let mut m = op[1].clone();
                        crate::catalog::normalize_catalog(&mut m);
                        m
                    }
                    "new" => {
                        let dir = root.join(gen.to_string());
                        gen += 1;
                        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                        *clock.lock().unwrap() = op[2].as_f64().unwrap_or(0.0);
                        let c = clock.clone();
                        catalog = Some(crate::catalog::Catalog::new(&dir, Some(""), Some(&cat_key), Box::new(crate::net_fetch::now_ms)));
                        cfg = Some(crate::remote_config::RemoteConfig::new(&dir, &st(1), Some(&cfg_key), Box::new(move || *c.lock().unwrap())));
                        ready = Some(crate::ready_presets::ReadyPresets::new(&dir, Some(&cfg_key)));
                        Value::Null
                    }
                    "state" => {
                        let prefix = format!("{base}{}/", st(1));
                        net.chain().set_mirrors(Some(vec![Mirror { host: format!("state-{}", st(1)), map: Map::Prefix(prefix.clone()), origin: true, small_only: false, pictures: None }]));
                        catalog.as_mut().ok_or_else(none)?.snapshot_base = format!("{prefix}snap/");
                        Value::Null
                    }
                    "catalog.load" => catalog.as_ref().ok_or_else(none)?.load(&net, op[1].as_bool().unwrap_or(false)).unwrap_or_else(|e| json!({ "error": e })),
                    "catalog.hash" => json!(catalog.as_ref().ok_or_else(none)?.published_hash(&st(1), &st(2))),
                    "config.refresh" => {
                        let v = cfg.as_ref().ok_or_else(none)?.refresh(&net, &mut log);
                        json!({ "v": v, "logs": logs })
                    }
                    "ready.refresh" => {
                        let v = ready.as_ref().ok_or_else(none)?.refresh(&net, &mut log);
                        json!({ "v": v, "logs": logs })
                    }
                    "ready.list" => json!(ready.as_ref().ok_or_else(none)?.list()),
                    "ready.get" => json!(ready.as_ref().ok_or_else(none)?.get(&st(1))),
                    "feature" => {
                        let (off, note) = cfg.as_ref().ok_or_else(none)?.feature(&st(1), &st(2));
                        json!({ "off": off, "note": note })
                    }
                    "notices" => json!(cfg.as_ref().ok_or_else(none)?.notices(&st(1))),
                    "issues" => json!(cfg.as_ref().ok_or_else(none)?.issues(&st(1))),
                    "beta" => cfg.as_ref().ok_or_else(none)?.beta(),
                    "mirrors" => cfg.as_ref().ok_or_else(none)?.mirrors(),
                    other => return Err(format!("no step {other}")),
                });
            }
            Value::Array(out)
        }
        "download-stats.statKeysFor" => json!(crate::download_stats::stat_keys_for(args.first(), &s(args, 1), &s(args, 2), args.get(3))),
        "download-stats.statStyleName" => json!(crate::download_stats::stat_style_name(args.first().unwrap_or(&Value::Null))),
        "download-stats.buildToken" => json!(crate::download_stats::build_token(std::path::Path::new(&s(args, 0)))),
        "download-stats.script" => {
            // (api, cacheFile, token, ops): the counter on its own clock, each answer and the log after it
            let clock = Arc::new(Mutex::new(0.0f64));
            let on = Arc::new(Mutex::new(true));
            let logs = Arc::new(Mutex::new(Vec::<String>::new()));
            let (c, e, l) = (clock.clone(), on.clone(), logs.clone());
            let stats = crate::download_stats::DownloadStats::new(
                std::path::Path::new(&s(args, 1)),
                Box::new(move || *e.lock().unwrap()),
                opt_s(args, 2),
                Some(&s(args, 0)),
                Arc::new(crate::net_fetch::Net::default()),
                Box::new(move || *c.lock().unwrap()),
                Box::new(move |m: &str| l.lock().unwrap().push(m.to_string())),
            );
            let mut out = Vec::new();
            for op in args.get(3).and_then(Value::as_array).cloned().unwrap_or_default() {
                let v = match op[0].as_str().unwrap_or("") {
                    "now" => {
                        *clock.lock().unwrap() = op[1].as_f64().unwrap_or(0.0);
                        Value::Null
                    }
                    "enabled" => {
                        *on.lock().unwrap() = op[1].as_bool().unwrap_or(false);
                        Value::Null
                    }
                    "get" => stats.get(),
                    "track" => {
                        let keys: Vec<String> = op[1].as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                        stats.track(&keys);
                        Value::Null
                    }
                    "flush" => {
                        stats.flush();
                        Value::Null
                    }
                    "active" => json!(stats.active()),
                    other => return Err(format!("no step {other}")),
                };
                out.push(json!({ "v": v, "logs": std::mem::take(&mut *logs.lock().unwrap()) }));
            }
            Value::Array(out)
        }
        "preview-cache.pictureOf" => json!(crate::preview_cache::picture_of(&s(args, 0))),
        "preview-cache.redirectFor" => json!(crate::preview_cache::redirect_for(&s(args, 0))),
        "preview-cache.pictureType" => {
            let b: Vec<u8> = args.first().and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect()).unwrap_or_default();
            json!(crate::preview_cache::picture_type(&b))
        }
        "preview-cache.hostsFor" => json!(crate::preview_cache::hosts_for(&s(args, 0), &[])),
        "preview-cache.picturesIn" => json!(crate::preview_cache::pictures_in(args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null))),
        "preview-cache.script" => {
            // (dir, {from: to}, stagger, ops): the store against hosts the map points elsewhere
            let dir = std::path::PathBuf::from(s(args, 0));
            let map: Vec<(String, String)> = args.get(1).and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect()).unwrap_or_default();
            let logs = Arc::new(Mutex::new(Vec::<String>::new()));
            let l = logs.clone();
            let store = crate::preview_cache::PreviewStore::new(
                &dir,
                Arc::new(crate::net_fetch::Net::default()),
                args.get(2).and_then(Value::as_u64),
                Some(Box::new(move |u: &str| map.iter().find_map(|(f, t)| u.strip_prefix(f.as_str()).map(|r| format!("{t}{r}"))).unwrap_or_else(|| u.to_string()))),
                Box::new(move |m: &str| l.lock().unwrap().push(m.to_string())),
            );
            let pic = |p: Option<crate::preview_cache::Picture>| match p {
                Some(p) => {
                    use sha2::Digest;
                    json!({ "type": p.kind, "sha": format!("{:x}", sha2::Sha256::digest(&p.bytes)) })
                }
                None => Value::Null,
            };
            let mut out = Vec::new();
            for op in args.get(3).and_then(Value::as_array).cloned().unwrap_or_default() {
                let v = match op[0].as_str().unwrap_or("") {
                    "get" => pic(store.get(&crate::js::string(&op[1]))),
                    "both" => {
                        // two asks at once share one fetch
                        let (a, b) = (store.clone(), store.clone());
                        let (r1, r2) = (crate::js::string(&op[1]), crate::js::string(&op[1]));
                        let t = std::thread::spawn(move || a.get(&r1));
                        let second = b.get(&r2);
                        json!([pic(t.join().unwrap()), pic(second)])
                    }
                    "warm" => {
                        let rels: Vec<String> = op[1].as_array().map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
                        json!(store.warm(&rels))
                    }
                    "age" => {
                        let f = store.file_of(&crate::js::string(&op[1]));
                        let at = std::time::SystemTime::now() - std::time::Duration::from_secs(op[2].as_u64().unwrap_or(0) * 86400);
                        std::fs::File::options().write(true).open(&f).and_then(|h| h.set_modified(at)).map_err(|e| e.to_string())?;
                        Value::Null
                    }
                    "settle" => {
                        while store.rechecking() > 0 {
                            std::thread::sleep(std::time::Duration::from_millis(20));
                        }
                        Value::Null
                    }
                    "files" => {
                        let mut names = crate::js::dir_names(&dir);
                        names.sort();
                        json!(names)
                    }
                    other => return Err(format!("no step {other}")),
                };
                out.push(json!({ "v": v, "logs": std::mem::take(&mut *logs.lock().unwrap()) }));
            }
            Value::Array(out)
        }
        "release-notes.changelogSection" => json!(crate::app_info::changelog_section(&s(args, 0), &s(args, 1))),
        "release-notes.changelogVersions" => json!(crate::app_info::changelog_versions(&s(args, 0))),
        "release-notes.notesRange" => {
            let versions: Vec<String> = args.first().and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            json!(crate::app_info::notes_range(&versions, &s(args, 1), opt_s(args, 2).as_deref()))
        }
        "release-notes.releaseNotes" => json!(crate::app_info::release_notes(&s(args, 0), &s(args, 1), std::path::Path::new(&s(args, 2)), opt_s(args, 3).as_deref())),
        "repo-stars.script" => {
            // (api, cacheFile, ops): the count on its own clock, each answer in turn
            let clock = Arc::new(Mutex::new(0.0f64));
            let c = clock.clone();
            let stars = crate::app_info::RepoStars::new(
                std::path::Path::new(&s(args, 1)),
                Some(&s(args, 0)),
                Arc::new(crate::net_fetch::Net::default()),
                Box::new(move || *c.lock().unwrap()),
            );
            let mut out = Vec::new();
            for op in args.get(2).and_then(Value::as_array).cloned().unwrap_or_default() {
                out.push(match op[0].as_str().unwrap_or("") {
                    "now" => {
                        *clock.lock().unwrap() = op[1].as_f64().unwrap_or(0.0);
                        Value::Null
                    }
                    "get" => stars.get().map_or(Value::Null, crate::js::json_number),
                    other => return Err(format!("no step {other}")),
                });
            }
            Value::Array(out)
        }
        "steam.join" => {
            let parts: Vec<String> = args.get(1).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            json!(crate::steam::join(args.first().and_then(Value::as_bool).unwrap_or(false), &parts.iter().map(String::as_str).collect::<Vec<_>>()))
        }
        "steam.regValue" => json!(crate::steam::reg_value(&s(args, 0))),
        "steam.parseLibraryFolders" => json!(crate::steam::parse_library_folders(&s(args, 0))),
        "steam.linuxSteamRoots" => json!(crate::steam::linux_steam_roots(&s(args, 0), opt_s(args, 1).as_deref())),
        "steam.steamappsDir" => json!(crate::steam::steamapps_dir(cfg!(windows), &s(args, 0))),
        "steam.pickSteamRoot" => {
            let c: Vec<Option<String>> = args.first().and_then(Value::as_array).map(|a| a.iter().map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
            json!(crate::steam::pick_steam_root(&c, args.get(1).and_then(Value::as_bool).unwrap_or(false)))
        }
        "steam.fallbackLibraries" => json!(crate::steam::fallback_libraries(args.first().and_then(Value::as_bool).unwrap_or(false), &s(args, 1), opt_s(args, 2).as_deref())),
        "steam.findDotaIn" => {
            let f: Vec<String> = args.get(1).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            json!(crate::steam::find_dota_in(cfg!(windows), opt_s(args, 0).as_deref(), &f))
        }
        "patch-watch.clientVersion" => json!(crate::patch_watch::client_version(std::path::Path::new(&s(args, 0)))),
        "patch-watch.gameStamp" => json!(crate::patch_watch::game_stamp(opt_s(args, 0).as_deref().map(std::path::Path::new))),
        "patch-watch.script" => {
            // (game, debounceMs, ops): the watcher over a game folder the script itself changes
            let game = Arc::new(Mutex::new(opt_s(args, 0)));
            let expects = Arc::new(Mutex::new(false));
            let fail = Arc::new(Mutex::new(false));
            let logs = Arc::new(Mutex::new(Vec::<Value>::new()));
            let (g, e, f, l, l2) = (game.clone(), expects.clone(), fail.clone(), logs.clone(), logs.clone());
            let w = crate::patch_watch::PatchWatcher::new(
                Box::new(move || g.lock().unwrap().clone().map(std::path::PathBuf::from)),
                Box::new(move |ev| {
                    l.lock().unwrap().push(json!({ "patch": ev }));
                    if *f.lock().unwrap() { Err("no".into()) } else { Ok(()) }
                }),
                Box::new(move || *e.lock().unwrap()),
                Box::new(move |m: &str| l2.lock().unwrap().push(json!(m))),
                args.get(1).and_then(Value::as_u64),
            );
            let base = || std::path::PathBuf::from(game.lock().unwrap().clone().unwrap_or_default());
            let mut out = Vec::new();
            for op in args.get(2).and_then(Value::as_array).cloned().unwrap_or_default() {
                let v = match op[0].as_str().unwrap_or("") {
                    "start" => { w.start(op.get(1).and_then(Value::as_str).map(String::from)); Value::Null }
                    "check" => { w.check(); Value::Null }
                    "current" => json!(w.current()),
                    "rearm" => { w.rearm(); Value::Null }
                    "stop" => { w.stop(); Value::Null }
                    "expects" => { *expects.lock().unwrap() = op[1].as_bool().unwrap_or(false); Value::Null }
                    "fail" => { *fail.lock().unwrap() = op[1].as_bool().unwrap_or(false); Value::Null }
                    "game" => { *game.lock().unwrap() = op[1].as_str().map(String::from); Value::Null }
                    "write" => {
                        let f = base().join(crate::js::string(&op[1]));
                        std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
                        std::fs::write(&f, crate::js::string(&op[2])).map_err(|e| e.to_string())?;
                        Value::Null
                    }
                    "copy" => {
                        std::fs::copy(base().join(crate::js::string(&op[1])), base().join(crate::js::string(&op[2]))).map_err(|e| e.to_string())?;
                        Value::Null
                    }
                    "wait" => { std::thread::sleep(std::time::Duration::from_millis(op[1].as_u64().unwrap_or(0))); Value::Null }
                    other => return Err(format!("no step {other}")),
                };
                out.push(json!({ "v": v, "logs": std::mem::take(&mut *logs.lock().unwrap()) }));
            }
            w.stop();
            Value::Array(out)
        }
        "deep-links.firstLink" => json!(crate::deep_links::first_link(args.first().and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))),
        "deep-links.parseModLink" => json!(crate::deep_links::parse_mod_link(&s(args, 0))),
        "deep-links.modLinkUrl" => {
            let m: crate::deep_links::ModLink = serde_json::from_value(args.first().cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            json!(crate::deep_links::mod_link_url(&m))
        }
        "deep-links.route" => {
            let got = crate::deep_links::route(opt_s(args, 0).as_deref(), &mut |code| json!({ "parked": code }));
            got.map_or(json!("nothing"), |(channel, payload)| json!([channel, payload]))
        }
        "deep-links.desktopEntry" => json!(crate::deep_links::desktop_entry(&s(args, 0))),
        "deep-links.installScript" => {
            // (home, [[platform, exe, icon]]): each install's log lines and the folders it refreshed
            let home = std::path::PathBuf::from(s(args, 0));
            let mut out = Vec::new();
            for step in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                let logs = std::cell::RefCell::new(Vec::<String>::new());
                let refreshed = std::cell::RefCell::new(Vec::<String>::new());
                let icon = step[2].as_str().map(std::path::PathBuf::from);
                crate::deep_links::install_desktop_entry(
                    &crate::js::string(&step[0]),
                    &crate::js::string(&step[1]),
                    &home,
                    icon.as_deref(),
                    &|m| logs.borrow_mut().push(m.to_string()),
                    &|d| refreshed.borrow_mut().push(d.to_string_lossy().into_owned()),
                );
                out.push(json!({ "logs": logs.into_inner(), "refreshed": refreshed.into_inner() }));
            }
            Value::Array(out)
        }
        "icon-match.plain" => json!(crate::icon_match::plain(&crate::js::string(args.first().unwrap_or(&Value::Null)))),
        "icon-match.numbering" => json!(crate::icon_match::numbering(&crate::js::string(args.first().unwrap_or(&Value::Null)))),
        "icon-match.editDistance" => json!(crate::icon_match::edit_distance(&s(args, 0), &s(args, 1))),
        "icon-match.stripScreenSuffix" => json!(crate::icon_match::strip_screen_suffix(&s(args, 0))),
        "icon-match.titlePicker" => {
            let titles: Vec<String> = args.get(1).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
            json!(crate::icon_match::pick_title(&s(args, 0), &titles))
        }
        "icon-match.sniff" => {
            let b: Vec<u8> = args.first().and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect()).unwrap_or_default();
            json!(crate::icon_match::sniff(&b))
        }
        "icon-match.cosmeticFileNames" => json!(crate::icon_match::cosmetic_file_names(&s(args, 0))),
        "icon-match.prefixOf" => json!(crate::icon_match::prefix_of(&s(args, 0))),
        "icon-match.heroFileNames" => json!(crate::icon_match::hero_file_names(&s(args, 0))),
        "remove-everything.run" => {
            // (game, suffix, journalDir, libraryDir, userData, {revert, mods, notice}): what could not come out, and how many did
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(&ud);
            let mut svc = crate::schema_service::SchemaService::new(&ud, true);
            let w = args.get(5).cloned().unwrap_or_default();
            let flag = |k: &str, d: bool| w.get(k).and_then(Value::as_bool).unwrap_or(d);
            let what = crate::remove_everything::What { revert: flag("revert", false), mods: flag("mods", false), notice: flag("notice", true) };
            let (errors, removed) = crate::remove_everything::remove_everything(&inst, &mut lib, &mut st, &mut svc, None, what);
            json!({ "errors": errors, "removed": removed })
        }
        "menu-background.veil" => json!(crate::menu_background::veil(n(args, 0))),
        "menu-background.webmProblem" => {
            let max = args.get(1).and_then(Value::as_f64).map_or(crate::menu_background::MAX, |m| m as usize);
            json!(crate::menu_background::webm_problem(&b(args, 0)?, max))
        }
        "menu-background.layouts" => {
            // (pak01_dir.vpk, {dim, blur}): each layout's path and the sha1 of its bytes
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |f: &str| ix.read(f).map_err(|e| e.to_string());
            let num = |k: &str| args.get(1).and_then(|o| o.get(k)).and_then(Value::as_f64).unwrap_or(0.0);
            let look = crate::menu_background::Look { dim: num("dim"), blur: num("blur") };
            let out = crate::menu_background::background_layouts(&read, look)?;
            json!(out.iter().map(|(p, d)| json!({ "path": p, "sha1": hex(&<sha1::Sha1 as sha1::Digest>::digest(d)) })).collect::<Vec<_>>())
        }
        "menu-background.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each op's answer, {error} for one that failed
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let svc = crate::menu_background_service::MenuBackground::new(&ud, opt_path(args, 0));
            let mut log = |_: String| {};
            let mut out = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let answer = match a.first().and_then(Value::as_str).unwrap_or("") {
                    "state" => Ok(crate::menu_background_service::MenuBackground::state(&lib)),
                    "install" => {
                        let webm = opt_b(&a, 1)?;
                        let none = Value::Null;
                        let at = |i: usize| a.get(i).unwrap_or(&none);
                        svc.install(&inst, &mut lib, webm.as_deref().map(Vec::as_slice), (at(2), at(3), at(4)), &mut log)
                    }
                    "rebuild" => {
                        let ids: Vec<String> = a.get(1).and_then(Value::as_array).map(|v| v.iter().map(crate::js::string).collect()).unwrap_or_default();
                        Ok(json!(svc.rebuild(&inst, &mut lib, &ids, &mut log)))
                    }
                    other => Err(format!("no op {other}")),
                };
                out.push(answer.unwrap_or_else(|e| json!({ "error": e })));
            }
            json!(out)
        }
        "panorama.readStyle" => {
            let (images, css) = crate::panorama_files::read_style(&b(args, 0)?)?;
            json!({ "images": images, "css": css })
        }
        "panorama.cssImages" => json!(crate::panorama_files::css_images(&s(args, 0))),
        "panorama.writeStyle" => {
            // (style, css, [styles whose pictures are known], {texture path: bytes}): the style as latin1
            let others: Vec<Arc<Vec<u8>>> = match args.get(2).and_then(Value::as_array) {
                Some(list) => list.iter().map(|v| b(std::slice::from_ref(v), 0)).collect::<Result<_, _>>()?,
                None => vec![],
            };
            let refs: Vec<&[u8]> = others.iter().map(|o| o.as_slice()).collect();
            let known = crate::panorama_files::images_of(&refs);
            let textures = args.get(3).and_then(Value::as_object).cloned().unwrap_or_default();
            let texture = |p: &str| textures.get(p).and_then(|v| b(std::slice::from_ref(v), 0).ok()).map(|x| x.to_vec());
            let out = crate::panorama_files::write_style(&b(args, 0)?, &s(args, 1), &known, &texture)?;
            json!(out.iter().map(|&c| c as char).collect::<String>())
        }
        "panorama.writeScript" => {
            let out = crate::panorama_files::write_script(&b(args, 0)?, &s(args, 1))?;
            json!(out.iter().map(|&c| c as char).collect::<String>())
        }
        "hud.clampScale" => crate::js::json_number(crate::hud_scale::clamp_scale(args.first().unwrap_or(&Value::Null))),
        "hud.cleanParts" => json!(crate::hud_scale::clean_parts(args.first().unwrap_or(&Value::Null))),
        "hud.withLayout" => json!(crate::hud_scale::with_layout(&s(args, 0), args.get(1).unwrap_or(&Value::Null))),
        "hud.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each op's answer, {error} for one that failed;
            // a rebuild answers what the channel returns and the id the later build reported
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let svc = crate::hud_scale_service::HudScale::new(opt_path(args, 0));
            let mut logged = Vec::new();
            let mut out = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let mut log = |m: String| logged.push(m);
                let answer = match a.first().and_then(Value::as_str).unwrap_or("") {
                    "state" => Ok(svc.state(&inst, &lib)),
                    "install" => svc.install(&inst, &mut lib, a.get(1).unwrap_or(&Value::Null), &mut log),
                    "rebuild" => {
                        let ids: Vec<String> =
                            a.get(1).and_then(Value::as_array).map(|v| v.iter().map(crate::js::string).collect()).unwrap_or_default();
                        let rebuilt = crate::hud_scale_service::HudScale::due(&lib, &ids)
                            .and_then(|_| svc.rebuild_now(&inst, &mut lib, &mut log));
                        Ok(json!({ "returned": [], "rebuilt": rebuilt }))
                    }
                    other => Err(format!("no op {other}")),
                };
                out.push(answer.unwrap_or_else(|e| json!({ "error": e })));
            }
            json!({ "answers": out, "log": logged })
        }
        "tower-looks.ids" => json!(crate::tower_looks::tower_look_ids(&b(args, 0)?)),
        "tower-looks.looks" => json!(crate::tower_looks::tower_looks(&b(args, 0)?)?),
        "tower-looks.plan" => {
            // (items_game, item id, side): the plan of that item's visuals
            let v = crate::item_visuals::item_visuals(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?;
            let (files, skipped) = crate::tower_looks::tower_plan(v.as_ref().map_or(&[][..], |v| &v.modifiers), &s(args, 2));
            json!({ "files": files, "skipped": skipped })
        }
        "tower-looks.build" => {
            // (pak01, items_game, radiant, dire): the pak's sha1 and what the build says
            let r = crate::tower_looks::build_towers(std::path::Path::new(&s(args, 0)), &b(args, 1)?, opt_s(args, 2).as_deref(), opt_s(args, 3).as_deref())?;
            json!({ "vpk": hex(&<sha1::Sha1 as sha1::Digest>::digest(&r.vpk)), "names": r.names, "files": r.files, "missing": r.missing, "skipped": r.skipped })
        }
        "tower-looks.asTower" => {
            let out = crate::tower_looks::as_tower(&b(args, 0)?, &b(args, 1)?);
            json!(hex(&<sha1::Sha1 as sha1::Digest>::digest(&out)))
        }
        "tree-sets.plan" => {
            let sets = crate::tree_sets::tree_sets();
            let set = sets.iter().find(|x| x.id == s(args, 1)).ok_or("no set")?;
            json!(crate::tree_sets::tree_plan(&s(args, 0), set))
        }
        "tree-sets.build" => {
            let (vpk, files, missing) = crate::tree_sets::build_trees(std::path::Path::new(&s(args, 0)), opt_s(args, 1).as_deref(), opt_s(args, 2).as_deref())?;
            json!({ "vpk": hex(&<sha1::Sha1 as sha1::Digest>::digest(&vpk)), "files": files, "missing": missing })
        }
        "map-looks.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each op's answer ({error} for one that
            // failed) and what was logged
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let svc = crate::map_looks_service::MapLooks::new(opt_path(args, 0));
            let mut logged = Vec::new();
            let mut out = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let mut log = |m: String| logged.push(m);
                let none = Value::Null;
                let at = |i: usize| a.get(i).unwrap_or(&none);
                let answer = match a.first().and_then(Value::as_str).unwrap_or("") {
                    "state" => Ok(svc.state(&lib, &mut log)),
                    "install" => svc.install(&inst, &mut lib, (at(1), at(2), at(3)), &mut log),
                    "rebuild" => {
                        let ids: Vec<String> = at(1).as_array().map(|v| v.iter().map(crate::js::string).collect()).unwrap_or_default();
                        Ok(json!(svc.rebuild(&inst, &mut lib, &ids, &mut log)))
                    }
                    other => Err(format!("no op {other}")),
                };
                out.push(answer.unwrap_or_else(|e| json!({ "error": e })));
            }
            json!({ "answers": out, "log": logged })
        }
        "map-decor.clampGroups" => json!(crate::map_decor::clamp_groups(args.first().unwrap_or(&Value::Null))),
        "map-decor.materials" => {
            // (map vpk, pak01): each group's materials
            let map = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let pak = crate::vpk::Index::open(std::path::Path::new(&s(args, 1))).map_err(|e| e.to_string())?;
            let [plants, debris] = crate::map_decor::decor_materials(&map, &pak)?;
            json!({ "plants": plants, "debris": debris })
        }
        "map-decor.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each op's answer ({error} for one that
            // failed) and what was logged; a rebuild answers what the channel returns and the id built later
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let svc = crate::map_decor::MapDecor::new(opt_path(args, 0));
            let mut logged = Vec::new();
            let mut out = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let mut log = |m: String| logged.push(m);
                let answer = match a.first().and_then(Value::as_str).unwrap_or("") {
                    "state" => svc.state(&inst, &lib),
                    "install" => svc.install(&inst, &mut lib, a.get(1).unwrap_or(&Value::Null), &mut log),
                    "rebuild" => {
                        let ids: Vec<String> =
                            a.get(1).and_then(Value::as_array).map(|v| v.iter().map(crate::js::string).collect()).unwrap_or_default();
                        let rebuilt = crate::map_decor::MapDecor::due(&lib, &ids).and_then(|_| svc.rebuild_now(&inst, &mut lib, &mut log));
                        Ok(json!({ "returned": [], "rebuilt": rebuilt }))
                    }
                    other => Err(format!("no op {other}")),
                };
                out.push(answer.unwrap_or_else(|e| json!({ "error": e })));
            }
            json!({ "answers": out, "log": logged })
        }
        "pumpkin.readings" => json!(crate::pumpkin::readings(&s(args, 0))),
        "pumpkin.beginNightAgain" => {
            let mut st = crate::settings::Settings::new(std::path::Path::new(&s(args, 0)));
            json!(crate::pumpkin::begin_night_again(&mut st).map_err(|e| e.to_string())?)
        }
        "pumpkin.script" => {
            // (host, userData, libraryDir, voice, ops): each answer and the log; the import is a stand-in
            // that takes a file starting "VPK" in as the prize, refuses "boom" outright and anything else
            // as one error
            let ud = std::path::PathBuf::from(s(args, 1));
            let mut st = crate::settings::Settings::new(&ud);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 2)));
            let net = crate::net_fetch::Net::default();
            let p = crate::pumpkin::Pumpkin { net: &net, host: s(args, 0), voice: opt_s(args, 3) };
            let mut n = 90;
            let mut import = |paths: &[std::path::PathBuf], lib: &mut crate::library::Library| -> Value {
                let data = std::fs::read(&paths[0]).unwrap_or_default();
                if data.starts_with(b"boom") {
                    return json!({ "error": "boom" });
                }
                if !data.starts_with(b"VPK") {
                    return json!({ "imported": [], "errors": [{ "error": "not a vpk" }] });
                }
                n += 1;
                let rel = format!("pak{n}_dir.vpk");
                let name = paths[0].file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
                let _ = lib.add(&json!({ "name": name, "categoryId": "imported", "styleLabel": null, "fileRef": null, "files": [{ "root": "lang", "relPath": rel }] }), None);
                json!({ "imported": [{ "name": name, "relPath": rel }], "errors": [] })
            };
            let mut logged = Vec::new();
            let mut out = Vec::new();
            for op in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let mut log = |m: String| logged.push(m);
                out.push(match op[0].as_str().unwrap_or("") {
                    "redeem" => p.redeem(op.get(1).unwrap_or(&Value::Null), &mut st, &mut lib, &mut import, &mut log),
                    "again" => p.prize_again(&mut st, &mut lib, &mut import),
                    "has" => json!(crate::pumpkin::Pumpkin::has_prize(&lib)),
                    "install" => json!(crate::pumpkin::Pumpkin::install(&mut st).map_err(|e| e.to_string())?),
                    other => json!({ "error": format!("no op {other}") }),
                });
            }
            json!({ "answers": out, "log": logged })
        }
        "steam-appstate.parse" => json!(crate::steam_appstate::parse_app_manifest(&s(args, 0))),
        "steam-appstate.pending" | "steam-appstate.work" => {
            let st = args.first().filter(|v| !v.is_null()).map(|v| crate::steam_appstate::AppState {
                flags: crate::js::to_number(&v["flags"]),
                to_download: crate::js::to_number(&v["toDownload"]),
                downloaded: crate::js::to_number(&v["downloaded"]),
            });
            if name == "steam-appstate.work" {
                json!(crate::steam_appstate::steam_work(st.as_ref()))
            } else {
                json!(st.is_some_and(|st| crate::steam_appstate::update_pending(&st)))
            }
        }
        "steam-appstate.read" => json!(crate::steam_appstate::read_app_state(opt_path(args, 0).as_deref())),
        "steam-appstate.warning" => json!(crate::steam_appstate::launch_warning(opt_path(args, 0).as_deref())),
        "game-repair.script" => {
            // (game, suffix, journalDir, libraryDir, userData, build, ops): each answer, and the log.
            // A mod whose name starts with "Generated" counts as built again by the app.
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut st = crate::settings::Settings::new(&ud);
            let mut svc = crate::schema_service::SchemaService::new(&ud, true);
            let note = crate::update_impact::UpdateImpact { file: ud.join("update-impact.json"), game: inst.game.clone() };
            let impact = crate::game_repair::Impact { note: &note, build: args.get(5).and_then(Value::as_str).map(String::from) };
            let mut repair = crate::game_repair::GameRepair::default();
            let ops = args.get(6).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut answers = Vec::new();
            let mut diag: Vec<String> = Vec::new();
            for op in &ops {
                let mut log = |_: String| {};
                let mut deployed = |_: std::collections::HashSet<String>| {};
                let mut ctx = crate::schema_service::Ctx {
                    inst: &inst,
                    lib: &mut lib,
                    settings: &mut st,
                    bases: None,
                    log: &mut log,
                    on_deployed: &mut deployed,
                };
                let mut gen = |_: &crate::installer::Installer, lib: &mut crate::library::Library, ids: &[String]| -> Vec<String> {
                    ids.iter()
                        .filter(|id| {
                            lib.list().iter().any(|r| {
                                r.get("id").map(crate::js::string).as_deref() == Some(id.as_str())
                                    && r.get("name").and_then(Value::as_str).is_some_and(|n| n.starts_with("Generated"))
                            })
                        })
                        .cloned()
                        .collect()
                };
                let mut d = |m: String| diag.push(m);
                answers.push(match op[0].as_str().unwrap_or("") {
                    "start" => {
                        let wants = repair.repair_at_start(&mut svc, &mut ctx, Some(&impact), Some(&mut gen), 0.0, &mut d);
                        json!({ "rebuild": wants, "patch": repair.patch_repair() })
                    }
                    "after" => {
                        let steam = op.get(3).and_then(Value::as_str);
                        let a = repair.repair_after_patch(
                            &mut svc,
                            &mut ctx,
                            Some(&impact),
                            Some(&mut gen),
                            op.get(1).cloned().filter(|v| !v.is_null()),
                            (crate::js::truthy(&op[2]), steam),
                            0.0,
                            &mut d,
                        );
                        json!({ "sent": a.sent, "retry": a.retry, "rebuild": a.rebuild })
                    }
                    "restore" => json!(repair.restore_after_verify(&inst, ctx.lib, &mut d)),
                    "stuck" => json!(repair.verify_stuck()),
                    "patch" => repair.patch_repair().clone(),
                    "settings" => json!({ "gameStamp": ctx.settings.get("gameStamp") }),
                    other => json!({ "error": format!("no step {other}") }),
                });
            }
            json!({ "answers": answers, "log": diag })
        }
        "game-watch.script" => {
            // (lastGood, mods, ops): what the window is told, the log, the last good game, the waits
            let mods = args.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut good = args.first().and_then(Value::as_f64);
            let mut watch = crate::game_watch::GameWatch::default();
            let mut crash = crate::game_watch::CrashWatch::default();
            let (mut told, mut log, mut waited) = (Vec::new(), Vec::new(), Vec::new());
            let (mut answer, mut clock) = (false, 0.0);
            for op in args.get(2).and_then(Value::as_array).cloned().unwrap_or_default() {
                let mut tell = |watch: &mut crate::game_watch::GameWatch, answer: bool, clock: f64| {
                    let mut d = |m: String| log.push(m);
                    for (c, v) in crate::game_watch::tell(watch, &mut crash, answer, clock, &mut good, &mods, &mut d) {
                        told.push(json!([c, v]));
                    }
                };
                match op[0].as_str().unwrap_or("") {
                    "play" => {
                        clock = crate::js::to_number(&op[1]);
                        crash.launched(clock);
                    }
                    "answer" => {
                        answer = crate::js::truthy(&op[1]);
                        clock = crate::js::to_number(&op[2]);
                        tell(&mut watch, answer, clock);
                    }
                    "start" => {
                        watch.start();
                        tell(&mut watch, answer, clock);
                    }
                    _ => waited.push(watch.wait_ms()),
                }
            }
            json!({ "told": told, "log": log, "lastGood": good, "waited": waited })
        }
        "game-upkeep.script" => {
            // (journalDir, libraryDir, userData, found, running): the start, as the app makes it
            let ud = std::path::PathBuf::from(s(args, 2));
            let mut st = crate::settings::Settings::new(&ud);
            let found = args.get(3).and_then(Value::as_str).map(String::from);
            let running = crate::js::truthy(args.get(4).unwrap_or(&Value::Null));
            let mut diag: Vec<String> = Vec::new();
            let mut up = crate::game_upkeep::GameUpkeep::default();
            crate::game_upkeep::check_game_path(
                &mut st,
                &|p| crate::installer::validate_game_path(p),
                &mut || found.clone(),
                &mut |m| diag.push(m),
            )?;
            up.lang_folder_step(&mut st, &mut || running, &mut |m| diag.push(m));
            let game = st.get("dotaGamePath").filter(|v| crate::js::truthy(v)).map(|v| std::path::PathBuf::from(crate::js::string(v)));
            let mut inst = crate::installer::Installer::new(game, up.lang_folder()).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 0);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 1)));
            let mut svc = crate::schema_service::SchemaService::new(&ud, true);
            let mut log = |m: String| diag.push(m);
            let mut deployed = |_: std::collections::HashSet<String>| {};
            let mut ctx = crate::schema_service::Ctx {
                inst: &inst,
                lib: &mut lib,
                settings: &mut st,
                bases: None,
                log: &mut log,
                on_deployed: &mut deployed,
            };
            up.start_steps(&mut svc, &mut ctx, &mut || running, None, None, &mut |_, _| Ok(()), 0.0);
            let answers = json!({
                "folder": up.lang_folder(), "lang": up.take_lang_migration(), "again": up.take_lang_migration(),
                "slots": up.take_slot_migration(), "patch": up.repair.patch_repair(),
            });
            json!({ "answers": answers, "log": diag })
        }
        // (material as readLoadoutMaterial gives it)
        "loadout-material.loadoutDescriptor" => {
            let m: crate::loadout_material::NativeMaterial = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            crate::loadout_material::loadout_descriptor(&m)
        }
        "loadout.material" => json!(crate::loadout_material::read_loadout_material(Some(&b(args, 0)?))),
        "recolor-layers.abilities" => json!(crate::recolor_layers::hero_abilities(&s(args, 0))),
        "recolor-layers.modelFolder" => json!(crate::recolor_layers::hero_model_folder(&s(args, 0))),
        "recolor-layers.particleFolder" => {
            let paths: Vec<String> = serde_json::from_value(args[0].clone()).map_err(|e| e.to_string())?;
            json!(crate::recolor_layers::hero_particle_folder(paths.iter().map(String::as_str), &s(args, 1)))
        }
        "recolor-layers.layers" => {
            // (paths, hero, abilities, items, model)
            let paths: Vec<String> = serde_json::from_value(args[0].clone()).map_err(|e| e.to_string())?;
            let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
            let abilities: Vec<String> = serde_json::from_value(args[2].clone()).map_err(|e| e.to_string())?;
            let items: Vec<crate::recolor_layers::WornItem> =
                serde_json::from_value(args.get(3).cloned().filter(|v| !v.is_null()).unwrap_or(json!([]))).map_err(|e| e.to_string())?;
            let model = args.get(4).and_then(Value::as_str);
            json!(crate::recolor_layers::hero_layers(&paths, &s(args, 1), &abilities, &items, model))
        }
        "recolor-layers.withChildren" => {
            // (roots, {path: [refs]})
            let roots: Vec<String> = serde_json::from_value(args[0].clone()).map_err(|e| e.to_string())?;
            let refs = args.get(1).cloned().unwrap_or(json!({}));
            json!(crate::recolor_layers::with_children(&roots, &mut |p| {
                refs.get(p).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect()
            }))
        }
        "recolor-layers.shadePixels" => {
            let mut px = b(args, 0)?.as_ref().clone();
            let bgra = args.get(2).and_then(|o| o.get("bgra")).is_some_and(crate::js::truthy);
            let n = crate::recolor_layers::shade_pixels(&mut px, rgb(args, 1), bgra);
            json!([px.iter().map(|&c| c as char).collect::<String>(), n])
        }
        "recolor-layers.modelColorTextures" => {
            // (models, pak)
            let models: Vec<String> = serde_json::from_value(args[0].clone()).map_err(|e| e.to_string())?;
            let ix = crate::vpk_shared::shared_index(std::path::Path::new(&s(args, 1))).map_err(|e| e.to_string())?;
            json!(crate::recolor_layers::model_color_textures(&models, &mut |p| ix.read(p).ok().flatten()))
        }
        "recolor-layers.withShares" => {
            let layers: Vec<Value> = serde_json::from_value(args[0].clone()).map_err(|e| e.to_string())?;
            let layers: Vec<crate::recolor_layers::RecolorLayer> = layers
                .iter()
                .map(|l| crate::recolor_layers::RecolorLayer {
                    id: crate::js::string(&l["id"]),
                    kind: match l["kind"].as_str().unwrap_or("") {
                        "ability" => "ability",
                        "abilityIcon" => "abilityIcon",
                        "effects" => "effects",
                        "portrait" => "portrait",
                        "body" => "body",
                        "item" => "item",
                        _ => "itemModel",
                    },
                    name: l.get("name").and_then(Value::as_str).map(String::from),
                    files: l["files"].as_array().into_iter().flatten().map(crate::js::string).collect(),
                })
                .collect();
            json!(crate::recolor_layers::with_shares(&layers))
        }
        "recolor-layers.itemModelPaths" => json!(crate::recolor_layers::item_model_paths(&crate::kv::latin1(&b(args, 0)?))),
        "effect-finder.script" => {
            // (pak, ops): ['ability', lang, hero, ability], ['variants', table, files], ['hero', lang, hero],
            // ['abilities', lang, heroes, query]
            let ix = crate::vpk_shared::shared_index(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let mut f = crate::effect_finder::EffectFinder::default();
            let mut out = Vec::new();
            for op in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let t = |i: usize| a.get(i).map(crate::js::string).unwrap_or_default();
                let list = |i: usize| -> Vec<String> { a.get(i).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect() };
                out.push(match t(0).as_str() {
                    "ability" => json!(f.ability(&ix, &t(1), &t(2), &t(3))),
                    "variants" => {
                        let table = match a.get(1) {
                            Some(Value::Null) | None => None,
                            _ => Some(crate::kv::latin1(&b(&a, 1)?)),
                        };
                        json!(f.variants(&ix, table.as_deref(), &list(2)))
                    }
                    "hero" => json!(f.hero(&ix, &t(1), &t(2))),
                    "abilities" => json!(f.abilities(&ix, &t(1), &list(2), &t(3))),
                    other => json!({ "error": format!("no step {other}") }),
                });
            }
            Value::Array(out)
        }
        "effect-edit.service" => {
            // (game, suffix, journalDir, libraryDir, userData, table, ops): each answer, and the log.
            // The finder speaks English; `rebuild` is `due` and then `rebuild_now` for each.
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let table = opt_b(args, 5)?.map(|b| crate::kv::latin1(&b));
            let svc = crate::effect_edit_service::EffectEdit::new(inst.game.clone());
            let mut svc = svc;
            let mut finder = crate::effect_finder::EffectFinder::default();
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(6).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let arg = |i: usize| a.get(i).cloned().unwrap_or(Value::Null);
                let f = Some(crate::effect_edit_service::Finder { finder: &mut finder, lang: "en", table: table.as_deref() });
                let mut d = |m: String| log.push(m);
                let r: Result<Value, String> = match arg(0).as_str().unwrap_or("") {
                    "search" => svc.search(&crate::js::string(&arg(1))).map(|v| json!(v)),
                    "saved" => Ok(json!(crate::effect_edit_service::EffectEdit::saved(&lib))),
                    "load" => svc.load(&lib, &arg(1), f),
                    "preview" => svc.preview(&arg(1), &arg(2), f).map(|v| json!(v)),
                    "install" => svc.install(&inst, &mut lib, (&arg(1), &arg(2), crate::js::truthy(&arg(3))), f, &mut d),
                    "rebuild" => {
                        let ids: Vec<String> = arg(1).as_array().into_iter().flatten().map(crate::js::string).collect();
                        let mut done = Vec::new();
                        let mut f = f;
                        for id in crate::effect_edit_service::EffectEdit::due(&lib, &ids) {
                            let again = f.as_mut().map(|x| crate::effect_edit_service::Finder { finder: &mut *x.finder, lang: x.lang, table: x.table });
                            if svc.rebuild_now(&inst, &mut lib, &id, again, &mut d) {
                                done.push(id);
                            }
                        }
                        Ok(json!(done))
                    }
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log })
        }
        "ability-icons.modifiers" => json!(crate::ability_icons::icon_modifiers(&b(args, 0)?)),
        "ability-icons.setLabel" => json!(crate::ability_icons::set_label(&s(args, 0))),
        "ability-icons.sets" => json!(crate::ability_icons::modifier_sets(&b(args, 0)?).map_err(|e| e.to_string())?),
        "ability-icons.forced" => {
            let text = b(args, 2)?;
            json!(crate::ability_icons::forced_files(&s(args, 0), &s(args, 1), &crate::ability_icons::icon_modifiers(&text)))
        }
        "ability-icons.choices" => {
            // (table, hero, order, files the game has)
            let text = b(args, 0)?;
            let mut sources: Vec<crate::ability_icons::IconSource> = crate::schema::list_items(&text)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|i| crate::ability_icons::IconSource { id: i.id, name: i.name, start: i.start, end: i.end, shared: false, loc_key: None })
                .collect();
            sources.extend(crate::ability_icons::modifier_sets(&text).map_err(|e| e.to_string())?);
            let order: Vec<String> = args.get(2).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
            let files: std::collections::HashSet<String> =
                args.get(3).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
            let has = |f: &str| files.contains(f);
            let mods = crate::ability_icons::icon_modifiers(&text);
            json!(crate::ability_icons::hero_icon_choices(&text, &sources, &s(args, 1), &order, &has, &mods).map_err(|e| e.to_string())?)
        }
        "ability-icons.entries" => {
            // (pak01 path, picks, table): each file with its data's sha1, and the picks gone
            let ix = crate::vpk_shared::shared_index(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let picks: indexmap::IndexMap<String, String> = args
                .get(1)
                .and_then(Value::as_object)
                .map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect())
                .unwrap_or_default();
            let mods = crate::ability_icons::icon_modifiers(&b(args, 2)?);
            let mut read = |f: &str| ix.read(f).ok().flatten();
            let has = |f: &str| ix.has(f);
            let (entries, gone) = crate::ability_icons::icon_entries(&mut read, &picks, &mods, &has);
            let files: Vec<Value> = entries
                .iter()
                .map(|(p, e)| json!([p, hex(&<sha1::Sha1 as sha1::Digest>::digest(&e.data[..]))]))
                .collect();
            json!({ "entries": files, "gone": gone })
        }
        "ability-icons.service" => {
            // (game, suffix, journalDir, libraryDir, userData, table, lang, vrf, ops): each answer, and the log
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let table = opt_b(args, 5)?.map(|t| t.to_vec()).unwrap_or_default();
            let vrf = args.get(7).is_some_and(crate::js::truthy);
            let mut svc = crate::ability_icons_service::AbilityIconsService::new(inst.game.clone(), table, &s(args, 6), vrf)?;
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(8).and_then(Value::as_array).cloned().unwrap_or_default() {
                let a = op.as_array().cloned().unwrap_or_default();
                let arg = |i: usize| a.get(i).map(crate::js::string).unwrap_or_default();
                let mut d = |m: String| log.push(m);
                let r: Result<Value, String> = match arg(0).as_str() {
                    "heroes" => svc.heroes().map(|v| json!(v)),
                    "hero" => svc.hero(&lib, &arg(1)),
                    "set" => {
                        let icon = a.get(3).and_then(Value::as_str).map(str::to_string);
                        svc.set(&inst, &mut lib, (&arg(1), &arg(2), icon.as_deref()), &mut d)
                    }
                    "clear" => svc.clear(&inst, &mut lib, &arg(1), &mut d),
                    "rebuild" => {
                        let ids: Vec<String> = a.get(1).and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
                        Ok(json!(svc.rebuild(&inst, &mut lib, &ids, &mut d)))
                    }
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log })
        }
        "vtex.png" => json!(crate::vtex::png_from_vtex(&b(args, 0)?).map(crate::vtex::data_url)),
        "gem-colors.name" => json!(crate::gem_colors::gem_name(&s(args, 0))),
        "gem-colors.rgb" => json!(crate::gem_colors::rgb_of(&s(args, 0))),
        "gem-colors.colors" => json!(crate::gem_colors::gem_colors(&b(args, 0)?).map_err(|e| e.to_string())?),
        "gem-colors.find" => {
            let gems = crate::gem_colors::gem_colors(&b(args, 0)?).map_err(|e| e.to_string())?;
            json!(crate::gem_colors::find_gem(&gems, &s(args, 1)))
        }
        "gem-colors.art" => {
            // (pak01 path, table): the shared art and each gem's own picture
            let ix = crate::vpk_shared::shared_index(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let gems = crate::gem_colors::gem_colors(&b(args, 1)?).map_err(|e| e.to_string())?;
            json!({
                "art": crate::gem_colors::prismatic_gem_art(&ix),
                "gems": crate::gem_colors::prismatic_gem_pictures(&gems, &ix),
            })
        }
        "recolor-modes.parse" => {
            json!(crate::recolor_modes::parse_paint(args.first().unwrap_or(&Value::Null)).map(|(hex, mode)| json!({ "hex": hex, "mode": mode })))
        }
        "recolor-modes.value" => {
            let mode = args.get(1).and_then(Value::as_str).unwrap_or("tint");
            json!(crate::recolor_modes::paint_value(&s(args, 0), mode))
        }
        "recolor-modes.rgbOfHex" => json!(crate::recolor_modes::rgb_of_hex(&s(args, 0))),
        "recolor-modes.hsv" => json!(crate::recolor_modes::hsv(rgb(args, 0))),
        "recolor-modes.fromHsv" => json!(crate::recolor_modes::from_hsv(rgb(args, 0))),
        "recolor-modes.pixel" => {
            let (u, v) = (args.get(3).and_then(Value::as_f64).unwrap_or(0.0), args.get(4).and_then(Value::as_f64).unwrap_or(0.0));
            json!(crate::recolor_modes::paint_pixel(rgb(args, 0), rgb(args, 1), &s(args, 2), u, v))
        }
        "recolor-modes.pixels" => {
            // (pixels as a file, width, colour, mode, bgra): the pixels after, and how many changed
            let mut px = b(args, 0)?.to_vec();
            let width = args.get(1).and_then(Value::as_u64).unwrap_or(0) as usize;
            let bgra = args.get(4).is_some_and(crate::js::truthy);
            let n = crate::recolor_modes::paint_pixels(&mut px, width, rgb(args, 2), &s(args, 3), bgra);
            json!({ "changed": n, "sha1": hex(&<sha1::Sha1 as sha1::Digest>::digest(&px)) })
        }
        "arcana-bases.safe" => json!(crate::arcana_base_store::safe_listing(args.first().unwrap_or(&Value::Null))),
        "arcana-bases.signed" => json!(crate::arcana_base_store::signed_listing(&s(args, 0), &s(args, 1), &s(args, 2))),
        "arcana-bases.blobSha" => json!(crate::arcana_base_store::blob_sha(&b(args, 0)?)),
        "arcana-bases.store" => {
            // (dir, key, pins, served {url: {status, body (base64)} | {error}}, ops): each answer, and the log
            let mut store = crate::arcana_base_store::BaseStore::new(std::path::Path::new(&s(args, 0)));
            store.key = s(args, 1);
            store.pins = from_arg(args, 2)?;
            let served = args.get(3).cloned().unwrap_or(Value::Null);
            let fetch = move |url: &str, _small: bool| -> Result<crate::arcana_base_store::Got, String> {
                let Some(a) = served.get(url) else { return Err(format!("not served: {url}")) };
                if let Some(e) = a.get("error").and_then(Value::as_str) {
                    return Err(e.to_string());
                }
                let status = a.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;
                let body = crate::js::base64_decode(a.get("body").and_then(Value::as_str).unwrap_or(""));
                Ok(crate::arcana_base_store::Got { status, body })
            };
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let id = op.get(1).map(crate::js::string).unwrap_or_default();
                let mut d = |m: String| log.push(m);
                answers.push(match op.get(0).and_then(Value::as_str).unwrap_or("") {
                    "want" => json!(store.want(&id, &fetch, 0.0, &mut d)),
                    "entries" => json!(store.entries(&id).map(|list| list
                        .iter()
                        .map(|e| json!([crate::vpk::join_path(&e.folder, &e.name, &e.ext), hex(&<sha1::Sha1 as sha1::Digest>::digest(&e.data[..]))]))
                        .collect::<Vec<_>>())),
                    "ready" => json!(store.ready()),
                    _ => Value::Null,
                });
            }
            json!({ "answers": answers, "log": log })
        }
        "rank-look.clamp" => json!(crate::rank_look::clamp_look(args.first().unwrap_or(&Value::Null))),
        "rank-look.tierOf" => json!(crate::rank_look::tier_of(n(args, 0))),
        "rank-look.medalImage" => {
            let m = crate::rank_look::clamp_look(&json!({ "medal": args.first().cloned().unwrap_or(Value::Null) })).medal;
            json!(m.map(|m| crate::rank_look::medal_image(&m, args.get(1).is_some_and(crate::js::truthy))))
        }
        "rank-look.withMedal" => {
            let m = crate::rank_look::clamp_look(&json!({ "medal": args.get(1).cloned().unwrap_or(Value::Null) })).medal;
            json!(m.map(|m| crate::rank_look::with_medal(&s(args, 0), &m)))
        }
        "rank-look.takesScript" => json!(crate::rank_look::takes_script(&b(args, 0)?)),
        "rank-look.withScript" => json!(hex(&<sha1::Sha1 as sha1::Digest>::digest(crate::rank_look::with_script(&b(args, 0)?)?))),
        "rank-look.levelsScript" => {
            // (raw look, {id: hero})
            let look = crate::rank_look::clamp_look(args.first().unwrap_or(&Value::Null));
            let ids: std::collections::BTreeMap<u32, String> = args
                .get(1)
                .and_then(Value::as_object)
                .map(|o| o.iter().filter_map(|(k, v)| Some((k.parse().ok()?, crate::js::string(v)))).collect())
                .unwrap_or_default();
            json!(crate::rank_look::levels_script(&look, &ids))
        }
        "rank-look.mark" => json!(crate::rank_look::SCRIPT_MARK),
        "rank-look.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each answer, and the log. A
            // `pictures` step names the program and what the stand-in for it writes: {name: png
            // base64} into the folder it is handed, or {error} for a run that fails.
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let mut svc = crate::rank_look_service::RankLookService::new(inst.game.clone());
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let arg = |i: usize| op.get(i).cloned().unwrap_or(Value::Null);
                let mut d = |m: String| log.push(m);
                let r: Result<Value, String> = match arg(0).as_str().unwrap_or("") {
                    "state" => Ok(svc.state(&lib, crate::js::truthy(&arg(1)))),
                    "pictures" => {
                        let exe = arg(1).as_str().map(str::to_string);
                        let made = arg(2);
                        let mut run = |_: &str, a: &[String]| -> Result<(), String> {
                            if let Some(e) = made.get("error").and_then(Value::as_str) {
                                return Err(e.to_string());
                            }
                            let dir = std::path::Path::new(&a[3]).join("panorama").join("images").join("rank_tier_icons");
                            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                            for (n, png) in made.as_object().into_iter().flatten() {
                                let data = crate::js::base64_decode(png.as_str().unwrap_or(""));
                                std::fs::write(dir.join(format!("{n}_psd.png")), data).map_err(|e| e.to_string())?;
                            }
                            Ok(())
                        };
                        svc.pictures(exe.as_deref(), &mut run, &ud, &mut d)
                    }
                    "install" => svc.install(&inst, &mut lib, &arg(1), &mut d),
                    "rebuild" => {
                        let ids: Vec<String> = arg(1).as_array().into_iter().flatten().map(crate::js::string).collect();
                        let mut built = Vec::new();
                        for id in svc.due(&lib, &ids) {
                            if svc.rebuild_now(&inst, &mut lib, &mut d) {
                                built.push(id);
                            }
                        }
                        Ok(json!(built))
                    }
                    "refresh" => {
                        let id = svc.refresh_script(&lib, &mut d);
                        if id.is_some() {
                            svc.rebuild_now(&inst, &mut lib, &mut d);
                        }
                        Ok(json!(id))
                    }
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log })
        }
        "arcana-service.hex" => json!(crate::arcana_service::valid_color(args.first().unwrap_or(&Value::Null)).map(crate::arcana_service::hex)),
        "arcana-service.service" => {
            // (game, suffix, journalDir, libraryDir, userData, code, bases {id: entries | null} or
            // null, ops): each answer, the log, and the bases asked for. `$set:<set>` in a rebuild
            // stands for the id of that set's record; a `pick` step adds an item builder's pick.
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let code = args.get(5).and_then(Value::as_str).map(str::to_string);
            let mut svc = crate::arcana_service::ArcanaService::new(inst.game.clone(), code);
            let store = match args.get(6).and_then(Value::as_object) {
                Some(m) => {
                    let mut held = HashMap::new();
                    for (id, e) in m {
                        held.insert(id.clone(), if e.is_null() { None } else { Some(entries_arg(Some(e))?) });
                    }
                    Some(TestBases { held, wanted: Mutex::new(Vec::new()) })
                }
                None => None,
            };
            let bases = store.as_ref().map(|s| s as &dyn crate::arcana_bases::BaseSource);
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(7).and_then(Value::as_array).cloned().unwrap_or_default() {
                let arg = |i: usize| op.get(i).cloned().unwrap_or(Value::Null);
                let mut d = |m: String| log.push(m);
                let r: Result<Value, String> = match arg(0).as_str().unwrap_or("") {
                    "state" => Ok(svc.state(&lib, &mut d)),
                    "install" => svc.install(&inst, &mut lib, (&arg(1), &arg(2), &arg(3)), bases, &mut d),
                    "giveWay" => {
                        let filled = arg(1).as_array().into_iter().flatten().map(crate::js::string).collect();
                        Ok(json!(svc.give_way(&inst, &mut lib, &filled, bases, &mut d)))
                    }
                    "rebuild" => {
                        let ids: Vec<String> = arg(1)
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|i| {
                                let i = crate::js::string(i);
                                match i.strip_prefix("$set:") {
                                    Some(set) => lib
                                        .list()
                                        .iter()
                                        .find(|r| r["generated"]["set"].as_str() == Some(set))
                                        .map(|r| crate::js::string(&r["id"]))
                                        .unwrap_or_default(),
                                    None => i,
                                }
                            })
                            .collect();
                        Ok(json!(svc.rebuild(&inst, &mut lib, &ids, bases, &mut d)))
                    }
                    "pick" => (|| {
                        let new = json!({ "name": "pick", "categoryId": "cosmetic", "styleLabel": null, "fileRef": null, "preview": null, "files": [] });
                        let made = lib.add(&new, None)?;
                        lib.update(&made["id"], &json!({ "itemId": arg(1) }), None)
                    })()
                    .map(|r| r.unwrap_or(Value::Null))
                    .map_err(|e| e.to_string()),
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            let wanted = store.map(|s| s.wanted.into_inner().unwrap_or_default()).unwrap_or_default();
            json!({ "answers": answers, "log": log, "wanted": wanted })
        }
        "toolchain.validPin" => json!(crate::toolchain::valid_pin(args.first().unwrap_or(&Value::Null), args.get(1).and_then(Value::as_str))),
        "toolchain.fallbackName" => json!(crate::toolchain::fallback_name(&s(args, 0), &s(args, 1), &s(args, 2))),
        "toolchain.downloadOrder" => {
            let (a, b2) = crate::toolchain::download_order(&s(args, 0), &s(args, 1), args.get(2).is_some_and(crate::js::truthy));
            json!([a, b2])
        }
        "toolchain.pins" => {
            let pins = crate::toolchain::built_in_pins();
            json!(pins
                .iter()
                .map(|(n, builds)| (n.clone(), builds.iter().map(|(b2, p)| (b2.clone(), json!({
                    "version": p.version, "license": p.license, "project": p.project, "url": p.url,
                    "sha256": p.sha256, "bytes": p.bytes, "exe": p.exe,
                }))).collect::<serde_json::Map<_, _>>().into()))
                .collect::<serde_json::Map<_, _>>())
        }
        "toolchain.service" => {
            // (userData, build, {build: sha256} over the pins, the archive every download hands
            // over or null, ops): each answer with paths under userData, the log, the progress.
            // A download hands the archive over if it hashes to the pin, else fails as a wrong
            // checksum does; with no archive it is a 404.
            let ud = std::path::PathBuf::from(s(args, 0));
            let mut tc = crate::toolchain::Toolchain::new(&ud, args.get(1).and_then(Value::as_str));
            for (b2, sha) in args.get(2).and_then(Value::as_object).into_iter().flatten() {
                if let Some(p) = tc.pins.get_mut("vrf").and_then(|m| m.get_mut(b2)) {
                    p.sha256 = crate::js::string(sha);
                }
            }
            let archive = match args.get(3) {
                Some(v) if !v.is_null() => Some(b(std::slice::from_ref(v), 0)?.to_vec()),
                _ => None,
            };
            let mut asked: Vec<String> = Vec::new();
            let mut get = |url: &str, dest: &std::path::Path, want: &str, on: &mut dyn FnMut(u64, u64)| {
                asked.push(url.to_string());
                let data = archive.clone().ok_or_else(|| "HTTP 404".to_string())?;
                let sha = hex(&<sha2::Sha256 as sha2::Digest>::digest(&data));
                if sha != want.to_lowercase() {
                    return Err(format!(
                        "checksum mismatch for {}",
                        dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                    ));
                }
                std::fs::create_dir_all(dest.parent().unwrap_or(&ud)).map_err(|e| e.to_string())?;
                std::fs::write(dest, &data).map_err(|e| e.to_string())?;
                on(data.len() as u64, data.len() as u64);
                Ok((data.len() as u64, sha))
            };
            let rel = |p: std::path::PathBuf| {
                p.strip_prefix(&ud).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| p.display().to_string())
            };
            let (mut log, mut events) = (Vec::<String>::new(), Vec::<Value>::new());
            let mut answers = Vec::new();
            for op in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let name = op.get(1).map(crate::js::string).unwrap_or_default();
                let mut d = |m: String| log.push(m);
                let mut e = |v: Value| events.push(v);
                let r: Result<Value, String> = match op[0].as_str().unwrap_or("") {
                    "state" => Ok(tc.state()),
                    "pathOf" => Ok(json!(tc.path_of(&name).map(rel))),
                    "ensure" => tc.ensure(&name, &mut get, false, &mut e, &mut d).map(|p| json!(rel(p))),
                    "catchUp" => tc.catch_up(&mut get, false, &mut e, &mut d).map(|_| Value::Null),
                    "remove" => tc.remove(&name).map(|_| Value::Null),
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log, "events": events, "asked": asked })
        }
        "resource-compiler.installOf" => json!(crate::resource_compiler::install_of(
            args.first().and_then(Value::as_str).map(std::path::Path::new)
        )
        .map(|p| p.to_string_lossy().into_owned())),
        "resource-compiler.safeRel" => json!(crate::resource_compiler::safe_rel(&s(args, 0))),
        "resource-compiler.compiledOf" => json!(crate::resource_compiler::compiled_of(&s(args, 0))),
        "workshop-tools.windowsOnly" => json!(crate::workshop_tools::windows_only(&s(args, 0))),
        "resource-compiler.service" => {
            // (userData, game, chosen, jobs [{id, files: [{path, data latin1}], compile}], steps
            // [state] | [compile, k] | [check]): each answer, the log, and the runs. The stand-in for
            // the compiler is named by the source, as the test's TypeScript one is.
            let ud = std::path::PathBuf::from(s(args, 0));
            let c = crate::resource_compiler::ResourceCompiler {
                needs_wine: false,
                ..crate::resource_compiler::ResourceCompiler::new(&ud, opt_path(args, 1), opt_path(args, 2))
            };
            let latin1 = |v: &Value| crate::js::string(v).chars().map(|ch| ch as u32 as u8).collect::<Vec<u8>>();
            let jobs: Vec<crate::resource_compiler::CompileJob> = args
                .get(3)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|j| crate::resource_compiler::CompileJob {
                    id: crate::js::string(&j["id"]),
                    files: j["files"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|f| crate::resource_compiler::SourceFile { path: crate::js::string(&f["path"]), data: latin1(&f["data"]) })
                        .collect(),
                    compile: j["compile"].as_array().into_iter().flatten().map(crate::js::string).collect(),
                })
                .collect();
            let tmp_root = |p: &str| p.to_string();
            let mut ran: Vec<Value> = Vec::new();
            let mut run = |x: &str, a: &[String], cwd: Option<&std::path::Path>, _: &[(String, String)], _: u64| {
                let base = std::path::Path::new(x).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                ran.push(json!([base, a[..3.min(a.len())], cwd.map(|c| c.display().to_string()).unwrap_or_default()]));
                let source = a.get(3).cloned().unwrap_or_default();
                let sep = std::path::MAIN_SEPARATOR;
                let marker = format!("{sep}content{sep}dota_addons{sep}");
                let rel = source
                    .find(&marker)
                    .map(|i| &source[i + marker.len()..])
                    .and_then(|r| r.split_once(sep).map(|(_, rest)| rest.replace(sep, "/")))
                    .unwrap_or_default();
                if rel.contains("fail") {
                    return Ok((3, "starting\r\n\r\nline two\nERROR: it broke\n".to_string()));
                }
                if rel.contains("schema") {
                    return Ok((1, "x\nSchema mismatches reported for 450 classes\n".to_string()));
                }
                if rel.contains("silent") {
                    return Ok((0, String::new()));
                }
                let out = source.replacen(&marker, &format!("{sep}game{sep}dota_addons{sep}"), 1);
                let root = std::path::PathBuf::from(tmp_root(&out[..out.len() - rel.len()]));
                let to = root.join(crate::resource_compiler::compiled_of(&rel));
                std::fs::create_dir_all(to.parent().unwrap_or(&root)).map_err(|e| e.to_string())?;
                std::fs::write(&to, format!("compiled {rel}")).map_err(|e| e.to_string())?;
                std::fs::write(root.join("tools_thumbnail_c"), "a note").map_err(|e| e.to_string())?;
                Ok((0, "ok".to_string()))
            };
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for step in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let mut d = |m: String| log.push(m);
                let r: Result<Value, String> = match step[0].as_str().unwrap_or("") {
                    "state" => Ok(c.state(None, &mut d)),
                    "check" => Ok(c.check(None, &mut run, &mut |_| {}, &mut d)),
                    "compile" => {
                        let k = step[1].as_u64().unwrap_or(0) as usize;
                        c.compile(&jobs[k], None, &mut run, &mut d).map(|es| {
                            json!(es
                                .iter()
                                .map(|e| json!([e.path(), e.data.iter().map(|&b| b as char).collect::<String>()]))
                                .collect::<Vec<_>>())
                        })
                    }
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log, "ran": ran })
        }
        "ability-sounds.service" => {
            // (game, suffix, journalDir, libraryDir, userData, ops): each answer, the log, and the
            // jobs compiled. The compiler's stand-in hands back each source as `compiled <sha1>` at
            // its compiled path; after a `drop` step, the next compile leaves the sounds out.
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let svc = crate::ability_sounds_service::AbilitySoundsService::new(inst.game.clone(), &ud);
            let mut drop_next = false;
            let mut jobs: Vec<Value> = Vec::new();
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(5).and_then(Value::as_array).cloned().unwrap_or_default() {
                let arg = |i: usize| op.get(i).cloned().unwrap_or(Value::Null);
                let st = |i: usize| crate::js::string(&arg(i));
                let mut d = |m: String| log.push(m);
                let dropping = drop_next;
                let mut compile = |job: &crate::resource_compiler::CompileJob| {
                    jobs.push(json!([job.id, job.compile]));
                    Ok(job
                        .files
                        .iter()
                        .filter(|f| !(dropping && f.path.ends_with(".wav")))
                        .map(|f| {
                            let sha1 = hex(&<sha1::Sha1 as sha1::Digest>::digest(&f.data));
                            let at = crate::resource_compiler::compiled_of(&f.path);
                            crate::vpk::entry_at(&at, format!("compiled {sha1}").into_bytes().into())
                        })
                        .collect())
                };
                let r: Result<Value, String> = match arg(0).as_str().unwrap_or("") {
                    "heroes" => svc.heroes(),
                    "hero" => svc.hero(&lib, &st(1)),
                    "drop" => {
                        drop_next = true;
                        Ok(Value::Null)
                    }
                    "add" => {
                        let wav = b(std::slice::from_ref(&arg(5)), 0)?;
                        let volume = arg(4).as_f64().unwrap_or(0.0);
                        svc.add(&inst, &mut lib, (&st(1), &st(2), &st(3), volume, &wav, &st(6)), &mut compile, &mut d)
                    }
                    "remove" => svc.remove(&inst, &mut lib, &st(1), &st(2), &mut compile, &mut d),
                    "rebuild" => svc.rebuild(&inst, &mut lib, &st(1), &mut compile, &mut d),
                    other => Err(format!("no step {other}")),
                };
                if arg(0).as_str() != Some("drop") {
                    drop_next = false;
                }
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log, "jobs": jobs })
        }
        "hero-paint.wornOf" => json!(crate::hero_paint_service::worn_of(args.first().unwrap_or(&Value::Null))),
        "hero-paint.service" => {
            // (game, suffix, journalDir, libraryDir, userData, vanilla {$file}, lang, ops): each
            // answer, the log, and the jobs compiled. The tools are stand-ins, as in the test's
            // TypeScript: a repaint that appends the colour and mode, a decode that names the
            // texture's sha1, and a compiler named per step (ok, none, failOnce, fail).
            let ud = std::path::PathBuf::from(s(args, 4));
            let mut inst = crate::installer::Installer::new(opt_path(args, 0), &s(args, 1)).with_user_data(&ud);
            inst.journal_dir = opt_path(args, 2);
            let mut lib = crate::library::Library::new(std::path::Path::new(&s(args, 3)));
            let vanilla = b(args, 5)?;
            let svc = crate::hero_paint_service::HeroPaintService::new(inst.game.clone(), &s(args, 6));
            let sha1hex = |d: &[u8]| hex(&<sha1::Sha1 as sha1::Digest>::digest(d));
            let repaint = |png: &[u8], c: crate::recolor::Rgb, mode: &str| -> Result<Vec<u8>, String> {
                if png.starts_with(b"BAD") {
                    return Err("a picture the codec cannot read".into());
                }
                let mut out = png.to_vec();
                out.extend(format!("|{},{},{}|{mode}", c[0], c[1], c[2]).into_bytes());
                Ok(out)
            };
            let mut decode = |_: &str, v: &[u8]| -> Result<Vec<u8>, String> { Ok(format!("PNG:{}", sha1hex(v)).into_bytes()) };
            let mut jobs: Vec<Value> = Vec::new();
            let mut log: Vec<String> = Vec::new();
            let mut answers = Vec::new();
            for op in args.get(7).and_then(Value::as_array).cloned().unwrap_or_default() {
                let arg = |i: usize| op.get(i).cloned().unwrap_or(Value::Null);
                let how = arg(5);
                let kind = how["compile"].as_str().unwrap_or("none").to_string();
                let mut tries = 0;
                let mut compile = |job: &crate::resource_compiler::CompileJob| -> Result<Vec<crate::vpk::Entry>, String> {
                    tries += 1;
                    jobs.push(json!([job.id, job.compile, job.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()]));
                    if kind == "fail" || (kind == "failOnce" && tries == 1) {
                        return Err(format!("access violation {}", "x".repeat(300)));
                    }
                    Ok(job
                        .files
                        .iter()
                        .map(|f| {
                            let p = &f.path;
                            let at = if let Some(n) = p.strip_prefix("materials/d2mm_paint/").and_then(|r| r.strip_suffix(".png")) {
                                format!("materials/d2mm_paint/{n}_png_0123abcd.vtex_c")
                            } else if p.starts_with("panorama/images/") && p.ends_with(".png") {
                                format!("{}_png.vtex_c", &p[..p.len() - 4])
                            } else {
                                crate::resource_compiler::compiled_of(p)
                            };
                            crate::vpk::entry_at(&at, format!("compiled {}", sha1hex(&f.data)).into_bytes().into())
                        })
                        .collect())
                };
                let mut d = |m: String| log.push(m);
                let vrf = how["vrf"].as_str().map(str::to_string);
                let mut tools = crate::hero_paint_service::Tools {
                    vrf: vrf.clone(),
                    repaint: &repaint,
                    decode: &mut decode,
                    compile: if kind == "none" { None } else { Some(&mut compile) },
                };
                let r: Result<Value, String> = match arg(0).as_str().unwrap_or("") {
                    "state" => svc.state(&lib, &vanilla, &crate::js::string(&arg(1)), &arg(2), vrf.is_some()),
                    "install" => {
                        svc.install(&inst, &mut lib, &vanilla, (&arg(1), &arg(2), &arg(3), &arg(4)), &mut tools, &mut d)
                    }
                    "rebuild" => {
                        let ids: Vec<String> = arg(1)
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|i| {
                                let i = crate::js::string(i);
                                match i.strip_prefix("$paint:") {
                                    Some(h) => lib
                                        .list()
                                        .iter()
                                        .find(|r| r["generated"]["paint"].as_str() == Some(h))
                                        .map(|r| crate::js::string(&r["id"]))
                                        .unwrap_or_default(),
                                    None => i,
                                }
                            })
                            .collect();
                        let mut built = Vec::new();
                        for id in svc.due(&lib, &ids) {
                            if svc.rebuild_now(&inst, &mut lib, &vanilla, &id, &mut tools, &mut d) {
                                built.push(id);
                            }
                        }
                        Ok(json!(built))
                    }
                    other => Err(format!("no step {other}")),
                };
                answers.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!({ "answers": answers, "log": log, "jobs": jobs })
        }
        "main-window.clampZoom" => json!(crate::main_window::clamp_zoom(args.first().unwrap_or(&Value::Null))),
        "main-window.windowFit" => {
            json!(crate::main_window::window_fit(area_arg(args, 0), crate::js::to_number(args.get(1).unwrap_or(&Value::Null))))
        }
        "main-window.startScale" => json!(crate::main_window::start_scale(area_arg(args, 0))),
        "main-window.workAreaFrom" => {
            json!(crate::main_window::work_area_from(args.first().and_then(Value::as_str))
                .map(|a| json!({ "width": a.width, "height": a.height })))
        }
        "main-window.zoomFor" => json!(crate::main_window::zoom_for_input(
            &s(args, 0),
            &s(args, 1),
            args.get(2).is_some_and(crate::js::truthy),
            args.get(3).is_some_and(crate::js::truthy),
            n(args, 4)
        )),
        "tray.startedHidden" => {
            let argv: Vec<String> = args.first().and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
            json!(crate::tray::started_hidden(&argv))
        }
        "tray.loginItemAllowed" => json!(crate::tray::login_item_allowed(
            args.first().is_some_and(crate::js::truthy),
            args.get(1).is_some_and(crate::js::truthy),
            args.get(2).is_some_and(crate::js::truthy),
            args.get(3).is_some_and(crate::js::truthy)
        )),
        "tray.script" => {
            // (lang, ops): each step's doings, as the test's fakes record them in the TypeScript.
            // ['sync', settings] | ['close', settings] | ['quit'] | ['lang', l]
            let mut keeper = crate::tray::TrayKeeper::default();
            let mut out: Vec<Value> = Vec::new();
            let fill = |out: &mut Vec<Value>, icon: bool| {
                if icon {
                    let items: Vec<Value> = crate::tray::menu().into_iter().map(|(_, l)| json!(l)).collect();
                    out.push(json!(["menu", items]));
                }
            };
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            for op in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                let st = op.get(1).cloned().unwrap_or(Value::Null);
                match op.get(0).and_then(Value::as_str).unwrap_or("") {
                    "sync" => {
                        match keeper.sync(&st) {
                            crate::tray::Icon::Make => out.push(json!(["make", crate::tray::TITLE])),
                            crate::tray::Icon::Destroy => out.push(json!(["destroy"])),
                            crate::tray::Icon::Keep => {}
                        }
                        fill(&mut out, keeper.icon);
                    }
                    "close" => match keeper.close(&st) {
                        crate::tray::Close::Close => out.push(json!(["close"])),
                        crate::tray::Close::Hide { hint } => {
                            out.push(json!(["hide"]));
                            if hint {
                                if keeper.icon {
                                    out.push(json!(["balloon", crate::tray::TITLE, crate::tray::hint()]));
                                }
                                out.push(json!(["set", "trayHintSeen", true]));
                            }
                        }
                    },
                    "quit" => keeper.quitting = true,
                    "lang" => crate::i18n::set_lang(crate::i18n::Lang::parse(&crate::js::string(&st))),
                    other => out.push(json!(["no step", other])),
                }
            }
            json!(out)
        }
        "support-prompt.readPrompt" => json!(crate::support_prompt::read_prompt(args.first().unwrap_or(&Value::Null)).to_json()),
        "support-prompt.counted" => {
            json!(crate::support_prompt::counted(&crate::support_prompt::read_prompt(args.first().unwrap_or(&Value::Null))).to_json())
        }
        "support-prompt.due" => {
            json!(crate::support_prompt::due(&crate::support_prompt::read_prompt(args.first().unwrap_or(&Value::Null)), n(args, 1)))
        }
        "support-prompt.choose" => json!(crate::support_prompt::choose(
            &crate::support_prompt::read_prompt(args.first().unwrap_or(&Value::Null)),
            &s(args, 1),
            n(args, 2)
        )
        .to_json()),
        "beta.idHash" => json!(crate::beta::id_hash(&s(args, 0), &s(args, 1))),
        "beta.betaState" => json!(crate::beta::beta_state(
            args.first().and_then(Value::as_str),
            args.get(1).unwrap_or(&Value::Null),
            args.get(2) == Some(&Value::Bool(true))
        )),
        "settings-view.view" => {
            // (settings, records, discordConfigured, langFolder, migration, slotMigration)
            let records = args.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
            let lang_folder = s(args, 3);
            crate::settings_view::settings_view(crate::settings_view::ViewInput {
                settings: args.first().and_then(Value::as_object).cloned().unwrap_or_default(),
                records: &records,
                discord_configured: args.get(2).is_some_and(crate::js::truthy),
                lang_folder: &lang_folder,
                migration: args.get(4).cloned().unwrap_or(Value::Null),
                slot_migration: args.get(5).cloned().unwrap_or(Value::Null),
                minify_config: crate::minify::read_config(&crate::minify::config_path()),
            })
        }
        "channel-args.check" => json!(crate::channel_args::check_args(
            &s(args, 0),
            args.get(1).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
        )),
        "channel-args.channels" => {
            let mut c: Vec<&str> = crate::channel_args::channel_args().keys().copied().collect();
            c.sort();
            json!(c)
        }
        "channel-args.windowSettings" => {
            let mut c: Vec<&str> = crate::channel_args::window_settings().keys().copied().collect();
            c.sort();
            json!(c)
        }
        "mod-id.identify" => {
            // (game|null, [paths...]...): each list's answer, then the log
            let id = crate::mod_id::ModIdentity::new(opt_path(args, 0));
            let mut log: Vec<String> = Vec::new();
            let answers: Vec<Value> = args
                .iter()
                .skip(1)
                .map(|list| {
                    let paths: Vec<String> = list.as_array().into_iter().flatten().map(crate::js::string).collect();
                    json!(id.identify(paths.iter().map(String::as_str), &mut |m| log.push(m)))
                })
                .collect();
            json!({ "answers": answers, "log": log, "ready": id.ready() })
        }
        "ui-lang.uiLangFor" => {
            let l: Vec<String> = args.first().and_then(Value::as_array).into_iter().flatten().map(crate::js::string).collect();
            json!(crate::ui_lang::ui_lang_for(&l))
        }
        "folder-size.folderSize" => json!(crate::folder_size::folder_size(std::path::Path::new(&s(args, 0)))),
        "feature-gate.gate" => {
            // (lang, gameOpen, off, note)
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let r = crate::feature_gate::gate(args.get(1).is_some_and(crate::js::truthy), || {
                (args.get(2).is_some_and(crate::js::truthy), s(args, 3))
            });
            crate::i18n::set_lang(crate::i18n::Lang::parse("en"));
            json!(r)
        }
        "hero-grid.gridName" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::hero_grid::grid_name(&s(args, 1)))
        }
        "hero-grid.buildGrid" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let stats = args.get(1).and_then(Value::as_array).cloned().ok_or("stats.filter is not a function")?;
            crate::hero_grid::build_grid(&stats, &s(args, 2))
        }
        "hero-grid.mergeGrids" => {
            let ours = args.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
            json!(crate::hero_grid::merge_grids(args.first().and_then(Value::as_str), ours)?)
        }
        "hero-grid.gridsIn" => json!(crate::hero_grid::grids_in(args.first().and_then(Value::as_str))),
        "hero-grid.keepNumbers" => json!(crate::hero_grid::keep_numbers(args.first().unwrap_or(&Value::Null))),
        "hero-grid.gridFile" => json!(crate::hero_grid::grid_file(std::path::Path::new(&s(args, 0))).to_string_lossy()),
        "hero-grid.script" => {
            // (lang, api, dataDir, accountDir, ops): the grids on their own clock, each answer or error
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let clock = Arc::new(Mutex::new(0.0f64));
            let c = clock.clone();
            let account = opt_s(args, 3).map(std::path::PathBuf::from);
            let grids = crate::hero_grid::HeroGrids {
                data_dir: std::path::PathBuf::from(s(args, 2)),
                account_dir: Box::new(move || account.clone()),
                net: Arc::new(crate::net_fetch::Net::default()),
                api: s(args, 1),
                now: Box::new(move || *c.lock().unwrap()),
            };
            let mut out = Vec::new();
            for op in args.get(4).and_then(Value::as_array).cloned().unwrap_or_default() {
                let r = match op[0].as_str().unwrap_or("") {
                    "now" => {
                        *clock.lock().unwrap() = op[1].as_f64().unwrap_or(0.0);
                        Ok(Value::Null)
                    }
                    "state" => Ok(grids.state()),
                    "apply" => {
                        let kinds: Vec<String> = op[1].as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                        grids.apply(&kinds)
                    }
                    "remove" => grids.remove(),
                    other => return Err(format!("no step {other}")),
                };
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "creator-premod.catalogProblems" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::creator::catalog_problems(args.get(1).unwrap_or(&Value::Null)))
        }
        "creator.missing" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::creator::Creator::missing(args.get(1).unwrap_or(&Value::Null)))
        }
        "creator.script" => {
            // (lang, userData, ops): drafts by the order they were made ($k: the k-th new one), each answer or error
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD;
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let c = crate::creator::Creator::new(std::path::Path::new(&s(args, 1)));
            let mut made: Vec<String> = Vec::new();
            let mut out = Vec::new();
            for op in args.get(2).and_then(Value::as_array).cloned().unwrap_or_default() {
                let id = |v: &Value| match v {
                    Value::Number(k) => made.get(k.as_u64().unwrap_or(0) as usize).cloned().unwrap_or_default(),
                    other => crate::js::string(other),
                };
                let r: Result<Value, String> = match op[0].as_str().unwrap_or("") {
                    "save" => {
                        let r = c.save(if op[1].is_null() { None } else { Some(id(&op[1])) }.as_deref(), &op[2]);
                        if let (Ok(d), true) = (&r, op[1].is_null()) {
                            made.push(crate::js::string(&d["id"]));
                        }
                        r.map(|d| c.shown(&d))
                    }
                    "attach" => c.attach(&id(&op[1]), &op[2], op[3].as_str().unwrap_or(""), std::path::Path::new(op[4].as_str().unwrap_or(""))).map(|d| c.shown(&d)),
                    "remove" => c.remove(&id(&op[1])).map(|_| json!({})),
                    "list" => Ok(Value::Array(c.list().iter().map(|d| c.shown(d)).collect())),
                    "bundle" => {
                        let previews: Vec<Option<Vec<u8>>> = op[2].as_array().cloned().unwrap_or_default().iter().map(|p| p.as_str().map(|x| b64.decode(x).unwrap_or_default())).collect();
                        c.bundle(&id(&op[1]), &previews).map(|(name, zip)| json!({ "name": name, "zip": b64.encode(zip) }))
                    }
                    other => return Err(format!("no step {other}")),
                };
                out.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            Value::Array(out)
        }
        "mod-doctor.examine" => {
            json!(crate::mod_doctor::examine(std::path::Path::new(&s(args, 0)), std::path::Path::new(&s(args, 1)))?)
        }
        "diagnostics.redactHome" => {
            let dir = s(args, 0);
            // a null home is no home (only a missing one falls back to the user's)
            if dir.is_empty() || args.get(1) == Some(&Value::Null) {
                args.first().cloned().unwrap_or(Value::Null)
            } else {
                json!(crate::diagnostics::redact_home(&dir, opt_s(args, 1).as_deref()))
            }
        }
        "diagnostics.folderListingText" => {
            let pak = |f: &crate::diagnostics::Listed| crate::diagnostics::pak_listed(f);
            let filter: Option<&dyn Fn(&crate::diagnostics::Listed) -> bool> =
                if s(args, 1) == "pak" { Some(&pak) } else { None };
            json!(crate::diagnostics::folder_listing_text(std::path::Path::new(&s(args, 0)), filter, opt_s(args, 2).as_deref()))
        }
        "diagnostics.tailLog" => json!(crate::diagnostics::tail_log(std::path::Path::new(&s(args, 0)), n(args, 1) as u64)),
        "diagnostics.findProblems" => {
            json!(crate::diagnostics::find_problems(args.first().unwrap_or(&Value::Null), args.get(1).unwrap_or(&Value::Null)))
        }
        "diagnostics.renderSummary" => json!(crate::diagnostics::render_summary(args.first().unwrap_or(&Value::Null))),
        "diagnostics.renderDetailed" => {
            let files: indexmap::IndexMap<String, String> =
                serde_json::from_value(args.get(1).cloned().unwrap_or(json!({}))).map_err(|e| e.to_string())?;
            json!(crate::diagnostics::render_detailed(args.first().unwrap_or(&Value::Null), &files))
        }
        "diagnostics.buildReport" => {
            let i = args.first().cloned().unwrap_or(Value::Null);
            let get = |k: &str| i.get(k).cloned().unwrap_or(Value::Null);
            let text = |k: &str| i.get(k).and_then(Value::as_str).map(String::from);
            let schema = get("schemaState");
            let (report, files) = crate::diagnostics::build_report(crate::diagnostics::ReportInputs {
                settings: get("settings").as_object().cloned().unwrap_or_default(),
                records: get("records").as_array().cloned().unwrap_or_default(),
                presets: get("presets").as_u64().unwrap_or(0) as usize,
                coverage: get("coverage").as_f64(),
                slots: get("slots").as_array().cloned().unwrap_or_default().iter().map(Value::as_f64).collect(),
                download_cache: get("downloadCache"),
                icon_size: i.get("iconSize").cloned(),
                schema_state: match schema.get("error") {
                    Some(e) => Err(crate::js::string(e)),
                    None => Ok(schema.get("ok").cloned().unwrap_or(Value::Null)),
                },
                catalog_cache: get("catalogCache"),
                mirrors: get("mirrors"),
                version: text("version").unwrap_or_default(),
                platform: text("platform").unwrap_or_default(),
                node: text("node").unwrap_or_default(),
                log_file: text("logFile"),
                user_data_dir: text("userDataDir"),
                update_error: get("updateError"),
                extra: get("extra").as_object().cloned().unwrap_or_default(),
                home: text("home"),
                generated_at: text("generatedAt").unwrap_or_default(),
            });
            json!({ "report": report, "files": files })
        }
        "presence-status.presenceActivity" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            crate::presence_status::presence_activity(&s(args, 1), n(args, 2), args.get(3).is_some_and(crate::js::truthy))
        }
        "presence-status.discordActivity" => {
            crate::presence_status::discord_activity(args.first().unwrap_or(&Value::Null), n(args, 1), args.get(2).is_some_and(crate::js::truthy))
        }
        "presence-status.frames" => {
            // (op, data)... encoded, joined, cut into chunks of n bytes, and read back frame by frame
            let mut all = Vec::new();
            for f in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                all.extend(crate::presence_status::encode_frame(f[0].as_i64().unwrap_or(0) as i32, &f[1]));
            }
            let mut buf = Vec::new();
            let mut out = Vec::new();
            for chunk in all.chunks((n(args, 0) as usize).max(1)) {
                buf.extend_from_slice(chunk);
                for (op, v) in crate::presence_status::take_frames(&mut buf) {
                    out.push(json!([op, v.unwrap_or(Value::Null)]));
                }
            }
            json!({ "bytes": all.len(), "frames": out })
        }
        "discord-presence.script" => {
            // (clientId, ops): the status driven by start/stop/set/wait, and what it logged
            let logs = Arc::new(Mutex::new(Vec::<String>::new()));
            let l = logs.clone();
            let p = crate::discord_presence::Presence::new(&s(args, 0), Box::new(move |m: &str| l.lock().unwrap().push(m.to_string())));
            for op in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                match op[0].as_str().unwrap_or("") {
                    "start" => p.start(),
                    "stop" => p.stop(),
                    "set" => p.set(op[1].clone()),
                    "wait" => std::thread::sleep(std::time::Duration::from_millis(op[1].as_u64().unwrap_or(0))),
                    other => return Err(format!("no step {other}")),
                }
            }
            drop(p);
            let out = logs.lock().unwrap().clone();
            json!(out)
        }
        "discord-auth.authorizeUrl" => json!(crate::discord_auth::authorize_url(&s(args, 0), &s(args, 1), n(args, 2) as u16)),
        "discord-auth.script" => {
            // (lang, port, api, cdn, timeoutMs, browser): sign-in with a stand-in browser that
            // opens the callback page and posts back what `browser` says: ok, state, denied, none
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            let port = n(args, 1) as u16;
            let at = crate::discord_auth::Endpoints {
                port,
                authorize: "https://discord.com/oauth2/authorize".into(),
                api: s(args, 2),
                cdn: s(args, 3),
                timeout: std::time::Duration::from_millis(n(args, 4) as u64),
            };
            let browser = s(args, 5);
            let opened = Arc::new(Mutex::new(String::new()));
            let seen = opened.clone();
            let open = move |url: &str| -> Result<(), String> {
                *seen.lock().unwrap() = url.to_string();
                let state = url::Url::parse(url).ok().and_then(|u| u.query_pairs().find(|(k, _)| k == "state").map(|(_, v)| v.into_owned())).unwrap_or_default();
                let browser = browser.clone();
                std::thread::spawn(move || {
                    use std::io::{Read, Write};
                    let call = |req: String| {
                        let mut c = std::net::TcpStream::connect(("127.0.0.1", port)).ok()?;
                        c.write_all(req.as_bytes()).ok()?;
                        let mut out = String::new();
                        c.read_to_string(&mut out).ok()?;
                        Some(out)
                    };
                    let _ = call("GET /nothing HTTP/1.1\r\nhost: x\r\n\r\n".into());
                    let page = call("GET /callback HTTP/1.1\r\nhost: x\r\n\r\n".into()).unwrap_or_default();
                    let body = match browser.as_str() {
                        "ok" => format!("access_token=TOKEN&token_type=Bearer&state={state}"),
                        "state" => "access_token=TOKEN&state=other".into(),
                        "denied" => format!("error=access_denied&error_description=The+user+said+no&state={state}"),
                        "notoken" => format!("state={state}"),
                        _ => return,
                    };
                    if page.contains("location.hash") {
                        let _ = call(format!("POST /token HTTP/1.1\r\nhost: x\r\ncontent-length: {}\r\n\r\n{body}", body.len()));
                    }
                });
                Ok(())
            };
            let r = crate::discord_auth::sign_in(&crate::net_fetch::Net::default(), &at, &open);
            let url = opened.lock().unwrap().clone();
            match r {
                Ok(v) => json!({ "ok": v, "url": url }),
                Err(e) => json!({ "error": e, "url": url }),
            }
        }
        // (file): the GLB's JSON, and its binary chunk's length and sha256
        "glb-embed.readGlb" => {
            let bytes = std::fs::read(s(args, 0)).map_err(|e| e.to_string())?;
            let (json, bin) = crate::glb_embed::read_glb(&bytes)?;
            use sha2::Digest;
            json!({ "json": json, "bin": bin.len(), "sha": format!("{:x}", sha2::Sha256::digest(&bin)) })
        }
        // (json, bin base64): the GLB, base64
        "glb-embed.writeGlb" => {
            use base64::Engine;
            let bin = crate::js::base64_decode(&s(args, 1));
            json!(base64::engine::general_purpose::STANDARD.encode(crate::glb_embed::write_glb(args.first().unwrap_or(&Value::Null), &bin)))
        }
        // (file): the sha256 of the GLB with its pictures inside
        "glb-embed.embedGlb" => {
            use sha2::Digest;
            json!(format!("{:x}", sha2::Sha256::digest(crate::glb_embed::embed_glb(std::path::Path::new(&s(args, 0)))?)))
        }
        // (file, side | null, max)
        "model-snapshot-fallback.snapshotFromModel" => {
            let bytes = std::fs::read(s(args, 0)).map_err(|e| e.to_string())?;
            let side = args.get(1).and_then(Value::as_str).map(String::from);
            crate::model_snapshot_fallback::snapshot_from_model(&bytes, side.as_deref(), crate::js::to_number(args.get(2).unwrap_or(&Value::Null)))?
        }
        // (file, style): the sha256 of the GLB the preview draws
        "model-style-meshes.selectStyleMeshes" => {
            use sha2::Digest;
            let bytes = std::fs::read(s(args, 0)).map_err(|e| e.to_string())?;
            let out = crate::model_style_meshes::select_style_meshes(&bytes, crate::js::to_number(args.get(1).unwrap_or(&Value::Null)))?;
            json!(format!("{:x}", sha2::Sha256::digest(out)))
        }
        "model-style-meshes.hidePreviewOnlyMeshes" => {
            use sha2::Digest;
            let bytes = std::fs::read(s(args, 0)).map_err(|e| e.to_string())?;
            json!(format!("{:x}", sha2::Sha256::digest(crate::model_style_meshes::hide_preview_only_meshes(&bytes)?)))
        }
        "model-style-meshes.styleFamily" => json!(crate::model_style_meshes::style_family(&s(args, 0))),
        // (parts): the parts with their styles shared
        "model-style-meshes.syncArcanaStyles" => {
            let mut parts = args.first().and_then(Value::as_array).cloned().unwrap_or_default();
            crate::model_style_meshes::sync_arcana_styles(&mut parts);
            json!(parts)
        }
        // (model [{path, config}], selected, style): the roots as [path, config] pairs
        "hero-particle-styles.styleParticleRoots" => {
            let model: Vec<(String, String)> = args
                .first()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|m| (s(&[m.get("path").cloned().unwrap_or(Value::Null)], 0), s(&[m.get("config").cloned().unwrap_or(Value::Null)], 0)))
                .collect();
            let roots = crate::hero_particle_styles::style_particle_roots(&model, &strings(args, 1)?, crate::js::to_number(args.get(2).unwrap_or(&Value::Null)));
            json!(roots.into_iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>())
        }
        "hero-particle-styles.isStockTerrorbladeBlade" => json!(crate::hero_particle_styles::is_stock_terrorblade_blade(&s(args, 0))),
        "hero-particle-styles.replaceTerrorbladeBladeFx" => {
            json!(crate::hero_particle_styles::replace_terrorblade_blade_fx(&s(args, 0), &s(args, 1), &strings(args, 2)?))
        }
        // (def, [[from, to]...])
        "hero-particle-styles.bladeSnapshots" => {
            let map: indexmap::IndexMap<String, String> = args
                .get(1)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.as_str()?.to_string())))
                .collect();
            crate::hero_particle_styles::blade_snapshots(args.first().unwrap_or(&Value::Null), &map)?
        }
        // (file | null)
        "loadout-sheet.loadoutSheet" => {
            let bytes = match args.first() {
                Some(Value::String(f)) => Some(std::fs::read(f).map_err(|e| e.to_string())?),
                _ => None,
            };
            crate::loadout_sheet::loadout_sheet(bytes.as_deref())
        }
        // (file | null)
        "model-loadout.modelSequences" => {
            let bytes = match args.first() {
                Some(Value::String(f)) => Some(std::fs::read(f).map_err(|e| e.to_string())?),
                _ => None,
            };
            json!(crate::model_loadout::model_sequences(bytes.as_deref()))
        }
        // (text): sorted, since a Set has no order to compare
        "model-loadout.itemModifiers" => {
            let mut v: Vec<String> = crate::model_loadout::item_modifiers(&b(args, 0)?.iter().map(|&c| c as char).collect::<String>()).into_iter().collect();
            v.sort();
            json!(v)
        }
        // (seqs, modifiers, ofItems)
        "model-loadout.motionList" => {
            let seqs: Vec<crate::model_loadout::Sequence> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let of: std::collections::HashSet<String> = strings(args, 2)?.into_iter().collect();
            json!(crate::model_loadout::motion_list(&seqs, &strings(args, 1)?, &of))
        }
        "model-loadout.idleSequence" => {
            let seqs: Vec<crate::model_loadout::Sequence> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::model_loadout::idle_sequence(&seqs))
        }
        "model-loadout.loadoutSequence" => {
            let seqs: Vec<crate::model_loadout::Sequence> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::model_loadout::loadout_sequence(&seqs, &strings(args, 1)?))
        }
        "model-loadout.wearableClip" => {
            let seqs: Vec<crate::model_loadout::Sequence> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::model_loadout::wearable_clip(&seqs))
        }
        "model-loadout.itemActivities" => json!(crate::model_loadout::item_activities(&b(args, 0)?.iter().map(|&c| c as char).collect::<String>())),
        // (items_game, model, itemId)
        "razor-crest-preview.goldenCrestModel" => {
            let text = b(args, 0)?;
            json!(crate::razor_crest_preview::golden_crest_model(&text, &s(args, 1), &s(args, 2))?)
        }
        "razor-crest-preview.crestActivities" => {
            let text = b(args, 0)?;
            json!(crate::razor_crest_preview::crest_activities(&text, &s(args, 1), &s(args, 2))?)
        }
        // (normal file, golden file): the sha256 of the joined GLB, or null
        "razor-crest-preview.normalCrestOnGoldenRig" => {
            use sha2::Digest;
            let normal = std::fs::read(s(args, 0)).map_err(|e| e.to_string())?;
            json!(crate::razor_crest_preview::normal_crest_on_golden_rig(&normal, std::path::Path::new(&s(args, 1))).map(|b| format!("{:x}", sha2::Sha256::digest(b))))
        }
        "razor-crest-preview.mergeCrestAttachments" => {
            let list = |i: usize| args.get(i).and_then(Value::as_array).cloned().unwrap_or_default();
            json!(crate::razor_crest_preview::merge_crest_attachments(&list(0), &list(1)))
        }
        "model-glb.modelFile" => json!(crate::model_glb::model_file(&s(args, 0))),
        "model-glb.gameInfo" => json!(crate::model_glb::game_info(&s(args, 0))),
        // (pak, out, files, clips 'all' | [..], materials)
        "model-glb.exportArgs" => {
            let clips = match args.get(3) {
                Some(Value::String(x)) if x == "all" => crate::model_glb::Clips::All,
                _ => crate::model_glb::Clips::Some(strings(args, 3).unwrap_or_default()),
            };
            json!(crate::model_glb::export_args(&s(args, 0), &s(args, 1), &strings(args, 2)?, &clips, crate::js::truthy(args.get(4).unwrap_or(&Value::Null))))
        }
        // (png base64): its size and the sha256 of its RGBA, or null
        "png-strip.decodePng" => {
            use sha2::Digest;
            let png = crate::js::base64_decode(&s(args, 0));
            json!(crate::png_strip::decode_png(&png).map(|i| json!([i.width, i.height, format!("{:x}", sha2::Sha256::digest(&i.rgba))])))
        }
        // (userData, game | null, vrf | null, face png base64, ops): a stand-in toolchain that
        // writes what each export would (model-glb.script in test/rust-calls.test.ts says how)
        "model-glb.script" => {
            use sha2::Digest;
            let ud = std::path::PathBuf::from(s(args, 0));
            let game = args.get(1).and_then(Value::as_str).map(std::path::PathBuf::from);
            let vrf = args.get(2).and_then(Value::as_str).map(std::path::PathBuf::from);
            let face = crate::js::base64_decode(&s(args, 3));
            let ops = args.get(4).and_then(Value::as_array).cloned().unwrap_or_default();
            let rel = {
                let ud = ud.to_string_lossy().replace('\\', "/");
                let game = game.as_ref().map(|g| g.to_string_lossy().replace('\\', "/"));
                move |p: &str| {
                    let p = p.replace('\\', "/").replace(&ud, "<ud>");
                    match &game {
                        Some(g) => p.replace(g.as_str(), "<game>"),
                        None => p,
                    }
                }
            };
            let runs = std::sync::Arc::new(Mutex::new(Vec::<Value>::new()));
            let logs = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
            let (r1, rel1) = (runs.clone(), rel.clone());
            let run: crate::model_glb::Run = Box::new(move |exe, a| {
                r1.lock().unwrap().push(json!([rel1(&exe.to_string_lossy()), a.iter().map(|x| rel1(x)).collect::<Vec<_>>()]));
                let at = |k: &str| a.iter().position(|x| x == k).and_then(|i| a.get(i + 1)).cloned();
                let out = at("-o").unwrap_or_default();
                let list: Vec<String> = at("-f").map(|f| f.split(',').map(String::from).collect()).unwrap_or_default();
                if list.iter().any(|f| f.contains("fail")) || (list.is_empty() && out.contains("fail")) {
                    return Err("fake failure".into());
                }
                let write = |p: &std::path::Path, b: &[u8]| {
                    if let Some(d) = p.parent() {
                        let _ = std::fs::create_dir_all(d);
                    }
                    let _ = std::fs::write(p, b);
                };
                let out_p = std::path::PathBuf::from(&out);
                if a.iter().any(|x| x == "--gltf_export_format") {
                    if list.len() <= 1 && out.ends_with(".glb") {
                        let name = list.first().cloned().unwrap_or_default();
                        if name.contains("physics") {
                            write(&crate::model_glb::glb_at(&out_p, &name), format!("glb {name}").as_bytes());
                        } else if !name.contains("absent") {
                            write(&out_p, format!("glb {name}").as_bytes());
                        }
                    } else {
                        for f in list.iter().filter(|f| !f.contains("absent")) {
                            write(&crate::model_glb::glb_at(&out_p, f), format!("glb {f}").as_bytes());
                        }
                    }
                } else {
                    for t in &list {
                        let tt = t.strip_suffix("_c").unwrap_or(t);
                        let base = format!("{}/{}", out, tt.strip_suffix(".vtex").unwrap_or(tt));
                        if tt.contains("absent") {
                            continue;
                        }
                        let p = |suffix: &str| std::path::PathBuf::from(format!("{base}{suffix}"));
                        if tt.contains("sheet") {
                            write(&p("_seq0_0.png"), b"a");
                            write(&p("_seq0_1.png"), b"bbb");
                            write(&p("_seq3.png"), b"cc");
                            write(&p("_SEQ10_2.png"), b"dddd");
                        } else if tt.contains("badcube") {
                            for f in crate::png_strip::CUBE_FACES {
                                write(&p(&format!("_{f}.png")), b"not a png");
                            }
                        } else if tt.contains("cube") {
                            for f in crate::png_strip::CUBE_FACES {
                                write(&p(&format!("_{f}.png")), &face);
                            }
                        } else {
                            write(&p(".png"), format!("png {tt}").as_bytes());
                        }
                    }
                }
                Ok(())
            });
            let l1 = logs.clone();
            let (g1, v1) = (game.clone(), vrf.clone());
            let mg = crate::model_glb::ModelGlb::new(
                &ud,
                Box::new(move || v1.clone()),
                Box::new(move || g1.clone()),
                run,
                Box::new(move |m| l1.lock().unwrap().push(m.to_string())),
            );
            let clips_of = |v: Option<&Value>| match v {
                Some(Value::String(x)) if x == "all" => crate::model_glb::Clips::All,
                Some(Value::Array(a)) => crate::model_glb::Clips::Some(a.iter().map(crate::js::string).collect()),
                _ => crate::model_glb::Clips::Some(vec![]),
            };
            let path_of = |p: Option<std::path::PathBuf>| p.map(|p| rel(&p.to_string_lossy()));
            let digest = |b: &[u8]| match crate::png_strip::decode_png(b) {
                Some(i) => format!("png {} {} {:x}", i.width, i.height, sha2::Sha256::digest(&i.rgba)),
                None => format!("{:x}", sha2::Sha256::digest(b)),
            };
            let mut results = Vec::new();
            for op in &ops {
                let o = op.as_array().cloned().unwrap_or_default();
                let list = |i: usize| o.get(i).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect::<Vec<_>>()).unwrap_or_default();
                results.push(match o.first().and_then(Value::as_str).unwrap_or("") {
                    "glbs" => {
                        let r = mg.glbs(&list(1), &clips_of(o.get(2)), o.get(3).is_some_and(crate::js::truthy));
                        json!(r.into_iter().map(|(k, v)| (k, json!(path_of(v)))).collect::<serde_json::Map<_, _>>())
                    }
                    "skinned" => {
                        let bytes = o.get(3).and_then(Value::as_str).map(|f| std::fs::read(f).unwrap_or_default());
                        let skin = crate::js::to_number(o.get(2).unwrap_or(&Value::Null)) as usize;
                        json!(path_of(mg.skinned(&crate::js::string(o.get(1).unwrap_or(&Value::Null)), skin, bytes.as_deref(), &list(4))))
                    }
                    "sprites" => {
                        let r = mg.sprites(&list(1));
                        json!(r.into_iter().map(|(k, v)| (k, json!(v.map(|b| digest(&b))))).collect::<serde_json::Map<_, _>>())
                    }
                    "clear" => {
                        mg.clear();
                        Value::Null
                    }
                    "list" => {
                        let mut files = Vec::new();
                        let mut stack = vec![ud.join("models3d")];
                        while let Some(d) = stack.pop() {
                            for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                                let p = e.path();
                                if p.is_dir() {
                                    stack.push(p);
                                } else {
                                    files.push(rel(&p.to_string_lossy()));
                                }
                            }
                        }
                        files.sort();
                        json!(files)
                    }
                    other => json!({ "error": format!("no op {other}") }),
                });
            }
            let runs = runs.lock().unwrap().clone();
            let logs = logs.lock().unwrap().clone();
            json!({ "results": results, "runs": runs, "log": logs })
        }
        // (pak, {model: glb file}, sprites?, ops): a stand-in exporter that hands out these GLBs and
        // `png <texture>` for each picture but those named "absent"; GLBs come back as sha256
        "loadout-resources.script" => {
            use sha2::Digest;
            struct Fake {
                glbs: indexmap::IndexMap<String, String>,
                sprites: bool,
                asked: Mutex<Vec<Value>>,
            }
            impl crate::loadout_resources::Exporter for Fake {
                fn glbs(&self, models: &[String], clips: &crate::model_glb::Clips, materials: bool) -> indexmap::IndexMap<String, Option<std::path::PathBuf>> {
                    let all = matches!(clips, crate::model_glb::Clips::All);
                    self.asked.lock().unwrap().push(json!(["glbs", models, all, materials]));
                    models.iter().map(|m| (m.clone(), self.glbs.get(m).map(std::path::PathBuf::from))).collect()
                }
                fn sprites(&self, textures: &[String]) -> Option<indexmap::IndexMap<String, Option<Vec<u8>>>> {
                    if !self.sprites {
                        return None;
                    }
                    self.asked.lock().unwrap().push(json!(["sprites", textures]));
                    Some(textures.iter().map(|t| (t.clone(), (!t.contains("absent")).then(|| format!("png {t}").into_bytes()))).collect())
                }
            }
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let fake = Fake {
                glbs: args.get(1).and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect()).unwrap_or_default(),
                sprites: args.get(2).is_some_and(crate::js::truthy),
                asked: Mutex::new(Vec::new()),
            };
            let sha = |b: &[u8]| format!("{:x}", sha2::Sha256::digest(b));
            let defs = |v: Option<&Value>| v.and_then(Value::as_array).cloned().unwrap_or_default();
            let mut results = Vec::new();
            for op in args.get(3).and_then(Value::as_array).cloned().unwrap_or_default() {
                let o = op.as_array().cloned().unwrap_or_default();
                let r: Result<Value, String> = match o.first().and_then(Value::as_str).unwrap_or("") {
                    "resourcePaths" => Ok(json!(crate::loadout_resources::resource_paths(o.get(1).unwrap_or(&Value::Null)))),
                    "drawnModels" => Ok(json!(crate::loadout_resources::drawn_models(&defs(o.get(1))).into_iter().collect::<Vec<_>>())),
                    "resources" => {
                        let mut r = crate::loadout_resources::loadout_resources(&defs(o.get(1)), &read, &fake);
                        if let Some(models) = r.get_mut("models").and_then(Value::as_object_mut) {
                            for v in models.values_mut() {
                                let b = crate::js::base64_decode(v["data"].as_str().unwrap_or(""));
                                *v = json!(sha(&b));
                            }
                        }
                        Ok(r)
                    }
                    "model" => crate::loadout_resources::loadout_model(std::path::Path::new(&crate::js::string(&o[1])), &crate::js::string(&o[2]), &read, &fake).map(|b| json!(sha(&b))),
                    "models" => {
                        let wanted: Vec<crate::loadout_resources::Wanted> = defs(o.get(1))
                            .iter()
                            .map(|w| crate::loadout_resources::Wanted {
                                file: std::path::PathBuf::from(crate::js::string(&w["file"])),
                                model: crate::js::string(&w["model"]),
                                skin: crate::js::to_number(w.get("skin").unwrap_or(&Value::Null)).max(0.0) as usize,
                            })
                            .collect();
                        let mut lost = Vec::new();
                        let out = crate::loadout_resources::loadout_models(&wanted, &read, &fake, Some(&mut |m: &str| lost.push(m.to_string())))?;
                        Ok(json!({ "out": out.iter().map(|b| b.as_ref().map(|b| sha(b))).collect::<Vec<_>>(), "lost": lost }))
                    }
                    "texturePaths" => {
                        let models: Vec<String> = defs(o.get(1)).iter().map(crate::js::string).collect();
                        Ok(json!(crate::loadout_resources::loadout_texture_paths(&models, &read)))
                    }
                    other => Err(format!("no op {other}")),
                };
                results.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            let asked = fake.asked.lock().unwrap().clone();
            json!({ "results": results, "asked": asked })
        }
        // (paths, kind)
        "mod-preview-pick.pickCandidate" => {
            let kind = crate::mod_preview_pick::Kind::parse(&s(args, 1)).ok_or("no such kind")?;
            let paths = strings(args, 0)?;
            json!(crate::mod_preview_pick::pick_candidate(paths.iter().map(String::as_str), kind))
        }
        // (width, height, pixels base64)
        "mod-preview-pick.worthShowing" => {
            let px = crate::js::base64_decode(&s(args, 2));
            json!(crate::mod_preview_pick::worth_showing(n(args, 0).max(0.0) as usize, n(args, 1).max(0.0) as usize, &px))
        }
        // (pak, items_game, ops): the hero preview's picks, against that pak's files; maps come and go
        // as [key, value] entries and a particle read as the sha256 of what it gave
        "hero-preview-picks.script" => {
            use crate::hero_preview_picks as h;
            use sha2::Digest;
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let text = b(args, 1)?;
            let has = |p: &str| ix.has(p);
            let map = |v: Option<&Value>| -> Option<indexmap::IndexMap<String, String>> {
                v.and_then(Value::as_array).map(|a| {
                    a.iter().filter_map(Value::as_array).map(|e| (crate::js::string(&e[0]), crate::js::string(&e[1]))).collect()
                })
            };
            let entries = |m: &indexmap::IndexMap<String, String>| json!(m.iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>());
            let opt = |v: Option<&Value>| v.filter(|x| !x.is_null()).map(crate::js::string);
            let list = |v: Option<&Value>| v.and_then(Value::as_array).cloned().unwrap_or_default();
            let mut results = Vec::new();
            for op in list(args.get(2)) {
                let o = op.as_array().cloned().unwrap_or_default();
                let st = |i: usize| o.get(i).map(crate::js::string).unwrap_or_default();
                let r: Result<Value, String> = match o.first().and_then(Value::as_str).unwrap_or("") {
                    "itemModel" => h::item_model(&text, &st(1), opt(o.get(2)).as_deref(), &st(3), opt(o.get(4)).as_deref()),
                    "bodySkinFor" => h::body_skin_for(st(1).as_bytes(), &st(2), &st(3), o.get(4).is_some_and(crate::js::truthy))
                        .map(|x| x.map_or(Value::Null, crate::js::json_number)),
                    "entityModel" => Ok(json!(h::entity_model(&st(1), &st(2)))),
                    "wornExtras" => Ok(h::worn_extras(&st(1))),
                    "monkeyKingCrown" => h::monkey_king_crown(&text, &st(1), &list(o.get(2))),
                    "particleReplacements" => h::preview_particle_replacements(st(1).as_bytes(), o.get(2).is_some_and(crate::js::truthy)).map(|m| entries(&m)),
                    "bladeReplacements" => {
                        let v = opt(o.get(2));
                        h::preview_blade_replacements(map(o.get(1)).as_ref(), v.as_deref().map(str::as_bytes)).map(|m| m.map_or(Value::Null, |m| entries(&m)))
                    }
                    "particleRead" => {
                        let read = |p: &str| ix.read(p).ok().flatten();
                        let reps = map(o.get(1)).unwrap_or_default();
                        let got = h::preview_particle_read(&read, &reps, map(o.get(2)).as_ref(), o.get(3).is_some_and(crate::js::truthy), &st(4));
                        Ok(json!(got.map(|b| format!("{:x}", sha2::Sha256::digest(&b)))))
                    }
                    "stockHead" => h::preview_stock_head(&text, &st(1), &st(2), &has, o.get(3).is_some_and(crate::js::truthy)).map(|x| json!(x)),
                    "equipment" => h::preview_equipment(&text, &list(o.get(1)), &list(o.get(2))).map(|x| json!(x)),
                    "heroParticles" => {
                        let script = opt(o.get(1)).and_then(|p| ix.read(&p).ok().flatten());
                        h::preview_hero_particles(script.as_deref(), &st(2), o.get(3).is_some_and(crate::js::truthy), &has).map(|x| json!(x))
                    }
                    "crestParticles" => {
                        let roots: Vec<String> = list(o.get(1)).iter().map(crate::js::string).collect();
                        Ok(json!(h::preview_crest_particles(&roots, &st(2), &st(3), ix.paths())))
                    }
                    "personaSlots" => h::persona_preview_slots(&text, &st(1), &list(o.get(2)), &list(o.get(3))).map(|x| json!(x)),
                    other => Err(format!("no op {other}")),
                };
                results.push(match r {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                });
            }
            json!(results)
        }
        // (pak, plans, placed): each plan's preview particles from that pak's files, and forParts of
        // the first with `placed`; maps come as [key, value] entries, bindings as {path: effect}
        "hero-preview-fx.script" => {
            use crate::hero_preview_fx as f;
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let map = |v: Option<&Value>| -> Option<indexmap::IndexMap<String, String>> {
                v.and_then(Value::as_array).map(|a| {
                    a.iter().filter_map(Value::as_array).map(|e| (crate::js::string(&e[0]), crate::js::string(&e[1]))).collect()
                })
            };
            let strs = |v: Option<&Value>| -> Vec<String> { v.and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default() };
            let mut out = Vec::new();
            for plan in args.get(1).and_then(Value::as_array).cloned().unwrap_or_default() {
                let p = f::FxPlan {
                    body: crate::js::string(&plan["body"]),
                    body_fx: strs(plan.get("bodyFx")),
                    hero_fx: strs(plan.get("heroFx")),
                    replacements: map(plan.get("replacements")).unwrap_or_default(),
                    bindings: plan.get("bindings").and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default(),
                    read: &read,
                    parts: plan
                        .get("parts")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .map(|x| f::FxPart {
                                    slot: crate::js::string(&x["slot"]),
                                    model: crate::js::string(&x["model"]),
                                    style: x.get("style").filter(|v| !v.is_null()).map_or(0.0, crate::js::to_number),
                                    fx: strs(x.get("fx")),
                                    replacements: map(x.get("replacements")),
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                };
                out.push(f::preview_particles(&p, None)?);
            }
            let placed: Vec<i64> = args.get(2).and_then(Value::as_array).map(|a| a.iter().map(|v| crate::js::to_number(v) as i64).collect()).unwrap_or_default();
            let moved = out.first().cloned().map(|x| f::for_parts(x, &placed)).unwrap_or_default();
            json!({ "plans": out, "moved": moved })
        }
        // (pak, items_game, library list, hero, slots): the preview's plan from that pak, its unusual
        // effects as the count of systems bound
        "hero-preview.plan" => {
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let has = |p: &str| ix.has(p);
            let paths = || ix.paths().map(String::from).collect::<Vec<_>>();
            let game = crate::hero_preview::Game { read: &read, has: &has, paths: &paths };
            let list = |i: usize| args.get(i).and_then(Value::as_array).cloned().unwrap_or_default();
            let p = crate::hero_preview::plan(&b(args, 1)?, &game, &list(2), &s(args, 3), &list(4), &|_| {})?;
            let mut v = serde_json::to_value(&p).map_err(|e| e.to_string())?;
            v["bindings"] = json!(p.bindings.len());
            v
        }
        // (pak, items_game, library, {model: glb}, sprites?, cases [hero, slots, hasTool]): the preview's
        // models through a stand-in exporter that hands out these GLBs whatever the clips, a model
        // in an odd material group as its own GLB and none in an even one, and `png <texture>` for
        // each picture; bytes come back as sha256, each case run twice to go through the cache
        "hero-preview.models" => {
            use sha2::Digest;
            struct Fake {
                glbs: indexmap::IndexMap<String, String>,
                sprites: bool,
            }
            impl crate::loadout_resources::Exporter for Fake {
                fn glbs(&self, models: &[String], _: &crate::model_glb::Clips, _: bool) -> indexmap::IndexMap<String, Option<std::path::PathBuf>> {
                    models.iter().map(|m| (m.clone(), self.glbs.get(m).map(std::path::PathBuf::from))).collect()
                }
                fn sprites(&self, textures: &[String]) -> Option<indexmap::IndexMap<String, Option<Vec<u8>>>> {
                    self.sprites.then(|| textures.iter().map(|t| (t.clone(), (!t.contains("absent")).then(|| format!("png {t}").into_bytes()))).collect())
                }
            }
            impl crate::hero_preview::PreviewExporter for Fake {
                fn skinned(&self, model: &str, skin: usize, _: Option<&[u8]>, _: &[String]) -> Option<std::path::PathBuf> {
                    (skin % 2 == 1).then(|| self.glbs.get(model).map(std::path::PathBuf::from)).flatten()
                }
            }
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let has = |p: &str| ix.has(p);
            let paths = || ix.paths().map(String::from).collect::<Vec<_>>();
            let game = crate::hero_preview::Game { read: &read, has: &has, paths: &paths };
            let text = b(args, 1)?;
            let list = |v: Option<&Value>| v.and_then(Value::as_array).cloned().unwrap_or_default();
            let fake = Fake {
                glbs: args.get(3).and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect()).unwrap_or_default(),
                sprites: args.get(4).is_some_and(crate::js::truthy),
            };
            let sha = |b: &[u8]| format!("{:x}", sha2::Sha256::digest(b));
            let preview = crate::hero_preview::HeroPreview::new();
            let mut out = Vec::new();
            for c in list(args.get(5)) {
                let hero = c.get(0).map(crate::js::string).unwrap_or_default();
                for _ in 0..2 {
                    let got = preview.models(&text, Some(&game), &list(args.get(2)), &fake, &hero, &list(c.get(1)), c.get(2).is_some_and(crate::js::truthy), &|_| {});
                    out.push(match got {
                        Err(_) => json!({ "error": true }),
                        Ok(crate::hero_preview::HeroModels::Not(r)) => json!({ "ok": false, "reason": r }),
                        Ok(crate::hero_preview::HeroModels::Shown(m)) => {
                            let mut res = m.resources.clone();
                            if let Some(models) = res.get_mut("models").and_then(Value::as_object_mut) {
                                for v in models.values_mut() {
                                    *v = json!(sha(&crate::js::base64_decode(v["data"].as_str().unwrap_or(""))));
                                }
                            }
                            json!({
                                "ok": true, "body": sha(&m.body), "clip": m.clip, "stage": m.stage, "pedestal": m.pedestal.as_deref().map(sha),
                                "model": m.model, "motions": m.motions, "missing": m.missing, "hidden": m.hidden, "attachments": m.attachments,
                                "parts": m.parts.iter().map(|x| json!({ "slot": x.slot, "name": x.name, "glb": sha(&x.glb), "attachments": x.attachments, "hidden": x.hidden })).collect::<Vec<_>>(),
                                "particles": m.particles, "sprites": m.sprites.iter().map(|(k, v)| (k.clone(), json!(sha(v)))).collect::<serde_json::Map<_, _>>(), "resources": res,
                            })
                        }
                    });
                }
            }
            json!(out)
        }
        // (pak, items_game, {model: glb}, effect ids, model files): the builder's effects as their
        // pictures and single models as GLB bytes, through the stand-in exporter of
        // hero-preview.models; bytes as sha256
        "hero-preview.pictures" => {
            use sha2::Digest;
            struct Fake(indexmap::IndexMap<String, String>);
            impl crate::loadout_resources::Exporter for Fake {
                fn glbs(&self, models: &[String], _: &crate::model_glb::Clips, _: bool) -> indexmap::IndexMap<String, Option<std::path::PathBuf>> {
                    models.iter().map(|m| (m.clone(), self.0.get(m).map(std::path::PathBuf::from))).collect()
                }
                fn sprites(&self, textures: &[String]) -> Option<indexmap::IndexMap<String, Option<Vec<u8>>>> {
                    Some(textures.iter().map(|t| (t.clone(), Some(format!("png {t}").into_bytes()))).collect())
                }
            }
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let read = |p: &str| ix.read(p).ok().flatten();
            let text = b(args, 1)?;
            let fake = Fake(args.get(2).and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect()).unwrap_or_default());
            let sha = |b: &[u8]| format!("{:x}", sha2::Sha256::digest(b));
            let effects: Vec<Value> = strings(args, 3)?
                .iter()
                .map(|id| match crate::hero_preview::effect(&text, Some(&read), &fake, id) {
                    Ok(Some(e)) => json!({ "ok": { "def": e.def, "sprites": e.sprites.iter().map(|(k, v)| (k.clone(), json!(sha(v)))).collect::<serde_json::Map<_, _>>(), "resources": e.resources } }),
                    Ok(None) => json!({ "ok": null }),
                    Err(_) => json!({ "error": true }),
                })
                .collect();
            let models: Vec<Value> = strings(args, 4)?
                .iter()
                .map(|f| match crate::hero_preview::model(&fake, f) {
                    Ok(m) => json!({ "ok": m.as_deref().map(sha) }),
                    Err(_) => json!({ "error": true }),
                })
                .collect();
            json!({ "effects": effects, "models": models })
        }
        // (userData, mods folder, ops): a mod's own picture with a stand-in tool and decoder. The
        // tool turns each staged texture into a "png" of its own bytes unless the first byte is a
        // multiple of 5; the decoder reads a file of 8 bytes or more as a picture of
        // (32 + b[1] % 64) x (32 + b[2] % 64) pixels sampled off its bytes, see-through where
        // b[3] % 4 is 0, and a small png is "small WxH <sha1 of the pixels>". Ops: ["tool", on],
        // ["getMany", keys], ["hasVideo", key], ["videoBytes", key] (as sha256), ["saveFrame", key,
        // base64 | null], ["size"], ["clear"], ["ready"]
        "mod-preview.script" => {
            use sha2::Digest;
            use std::sync::atomic::{AtomicBool, Ordering};
            use std::sync::Arc;
            struct Fake;
            impl crate::mod_preview::Images for Fake {
                fn read(&self, file: &std::path::Path) -> Option<crate::mod_preview::Bitmap> {
                    let b = std::fs::read(file).ok()?;
                    if b.len() < 8 {
                        return None;
                    }
                    let (w, h) = (32 + b[1] as usize % 64, 32 + b[2] as usize % 64);
                    let a = if b[3] % 4 == 0 { 0 } else { 255 };
                    let n = b.len();
                    let data = (0..w * h).flat_map(|i| [b[(i * 3) % n], b[(i * 5 + 1) % n], b[(i * 7 + 2) % n], a]).collect();
                    Some(crate::mod_preview::Bitmap { width: w, height: h, data })
                }
                fn to_small_png(&self, bmp: &crate::mod_preview::Bitmap) -> Vec<u8> {
                    use sha1::Digest as _;
                    format!("small {}x{} {:x}", bmp.width, bmp.height, sha1::Sha1::digest(&bmp.data)).into_bytes()
                }
            }
            let tool = Arc::new(AtomicBool::new(true));
            let mods = std::path::PathBuf::from(s(args, 1));
            let on = tool.clone();
            let previews = crate::mod_preview::ModPreviews::new(
                std::path::Path::new(&s(args, 0)),
                Box::new(move || on.load(Ordering::SeqCst).then(|| std::path::PathBuf::from("C:/fake/vrf.exe"))),
                Box::new(move |rel| Some(mods.join(rel))),
                Box::new(Fake),
                Box::new(|_, args| {
                    let dir = std::path::PathBuf::from(&args[1]);
                    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
                        let name = e.file_name().to_string_lossy().to_string();
                        let Some(stem) = name.strip_suffix(".vtex_c") else { continue };
                        let data = std::fs::read(e.path()).map_err(|e| e.to_string())?;
                        if data.first().is_some_and(|b| b % 5 != 0) {
                            std::fs::write(dir.join(format!("{stem}.png")), data).map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(())
                }),
                Box::new(|_| {}),
            );
            let sha = |b: &[u8]| format!("{:x}", sha2::Sha256::digest(b));
            let mut out = Vec::new();
            for op in args.get(2).and_then(Value::as_array).cloned().unwrap_or_default() {
                let o = op.as_array().cloned().unwrap_or_default();
                let st = |i: usize| o.get(i).map(crate::js::string).unwrap_or_default();
                out.push(match o.first().and_then(Value::as_str).unwrap_or("") {
                    "tool" => {
                        tool.store(o.get(1).is_some_and(crate::js::truthy), Ordering::SeqCst);
                        Value::Null
                    }
                    "getMany" => {
                        let keys: Vec<String> = o.get(1).and_then(Value::as_array).map(|a| a.iter().map(crate::js::string).collect()).unwrap_or_default();
                        json!(previews.get_many(&keys))
                    }
                    "hasVideo" => json!(previews.has_video(&st(1))),
                    "videoBytes" => json!(previews.video_bytes(&st(1)).map(|b| sha(&b))),
                    "saveFrame" => {
                        let png = o.get(2).and_then(Value::as_str).map(crate::js::base64_decode);
                        json!(previews.save_frame(&st(1), png.as_deref()))
                    }
                    "size" => json!(previews.size()),
                    "clear" => {
                        previews.clear();
                        Value::Null
                    }
                    "ready" => json!(previews.ready()),
                    other => json!({ "no op": other }),
                });
            }
            json!(out)
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
