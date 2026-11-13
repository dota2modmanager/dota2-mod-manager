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
