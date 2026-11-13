//! Installing, updating, importing, exporting and listing mods (src/ipc-mods.ts): the channels the
//! Library screen and the catalog's install buttons reach for. What My mods is drawn from is built
//! in crates/mm-core/src/mods_listing.rs.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use crate::build_undo::touches_schema;
use crate::file_tx::FileTx;
use crate::i18n::t;
use crate::installer::Installer;
use crate::library::Library;
use crate::overlays::{files_of, files_value};
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "mods:clearPrePatch",
    "mods:update",
    "mods:install",
    "mods:exportSingle",
    "mods:unpackToFolder",
    "mods:importDialog",
    "mods:importFolderDialog",
    "mods:importPaths",
    "mods:importBuffers",
    "mods:list",
    "mods:switchOffStaleTerrains",
    "catalog:downloadCounts",
    "catalog:terrainAges",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

fn not_found() -> Value {
    json!({ "error": t("Мод не найден", &[]) })
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn text(v: Option<&Value>) -> String {
    v.map(crate::js::string).unwrap_or_default()
}

fn files(rec: &Value) -> Vec<crate::overlays::LibFile> {
    files_of(rec.get("files").unwrap_or(&Value::Null))
}

/// A name for a file the user saves: what Windows refuses in a name becomes `_`.
fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    if s.is_empty() {
        "mod".into()
    } else {
        s
    }
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    Ok(match channel {
        "mods:clearPrePatch" => {
            let id = arg(args, 0);
            let c = o.core();
            if !id.is_string() || c.library.find(&id).is_none() {
                return Ok(not_found());
            }
            impact(&c).clear(&crate::js::string(&id))?;
            json!({ "ok": true })
        }
        "mods:update" => update(o, &arg(args, 0)),
        "mods:install" => install(o, &arg(args, 0)),
        "mods:exportSingle" => export_single(o, &arg(args, 0)),
        "mods:unpackToFolder" => unpack(o, &arg(args, 0)),
        "mods:importDialog" => {
            let res = o.shell.request(
                "dialog.open",
                vec![json!({
                    "title": t("Выбери .vpk файлы модов или .zip с ними", &[]),
                    "properties": ["openFile", "multiSelections"],
                    "filters": [{ "name": t("Моды (.vpk, .zip)", &[]), "extensions": ["vpk", "zip"] }],
                })],
            )?;
            match chosen(&res) {
                None => json!({ "cancelled": true }),
                Some(paths) => import_paths(o, &paths),
            }
        }
        "mods:importFolderDialog" => {
            let res = o.shell.request(
                "dialog.open",
                vec![json!({ "title": t("Выбери папку с модами", &[]), "properties": ["openDirectory"] })],
            )?;
            match chosen(&res) {
                None => json!({ "cancelled": true }),
                Some(paths) => import_paths(o, &paths),
            }
        }
        "mods:importPaths" => {
            let paths: Vec<PathBuf> = arg(args, 0)
                .as_array()
                .map(|a| a.iter().map(|p| PathBuf::from(crate::js::string(p))).collect())
                .unwrap_or_default();
            import_paths(o, &paths)
        }
        "mods:importBuffers" => import_buffers(o, &arg(args, 0)),
        "mods:list" => list(o),
        "mods:switchOffStaleTerrains" => {
            let mut c = o.core();
            let ages = terrain_ages(&c);
            let Core { installer, library, .. } = &mut *c;
            let records = library.list().to_vec();
            let mut errors = Vec::new();
            let names = ages.switch_off_stale(&records, &mut |rec| {
                if let Err(e) = switch_off(installer, library, rec) {
                    errors.push(e);
                }
            });
            match errors.into_iter().next() {
                Some(e) => json!({ "names": [], "error": e }),
                None => json!({ "names": names }),
            }
        }
        "catalog:downloadCounts" => {
            let stats = o.core().download_stats.clone();
            stats.get()
        }
        "catalog:terrainAges" => terrain_ages_for_catalog(o),
        other => return Err(format!("no handler for {other}")),
    })
}

/// The paths a dialog answered, or None when it was cancelled.
fn chosen(res: &Value) -> Option<Vec<PathBuf>> {
    let paths: Vec<PathBuf> = res
        .get("filePaths")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|p| PathBuf::from(crate::js::string(p))).collect())
        .unwrap_or_default();
    (res.get("canceled") != Some(&Value::Bool(true)) && !paths.is_empty()).then_some(paths)
}

fn impact(c: &Core) -> crate::update_impact::UpdateImpact {
    crate::update_impact::UpdateImpact { file: c.user_data.join("update-impact.json"), game: c.game() }
}

fn terrain_ages(c: &Core) -> crate::terrain_age::TerrainAges {
    let downloads = c.installer.downloads_dir();
    crate::terrain_age::TerrainAges {
        store_file: downloads.parent().map(|p| p.join("terrain-ages.json")),
        downloads_dir: Some(downloads),
        game: c.game(),
    }
}

fn switch_off(inst: &Installer, lib: &mut Library, rec: &Value) -> Result<(), String> {
    FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| {
        inst.set_enabled(&files(rec), false, rec.get("id").and_then(Value::as_str))?;
        lib.set_enabled(rec.get("id").unwrap_or(&Value::Null), false, Some(tx)).map_err(io).map(|_| ())
    })
}

/// The game's own item table, when there is a game: the harvest compares a mod's against it.
fn vanilla(c: &mut Core) -> Option<Arc<(Vec<u8>, String)>> {
    let game = c.game()?;
    c.schema.vanilla(&game).ok()
}

/// Lift the item blocks a freshly installed mod changed (src/schema-harvest.ts): the counts, or
/// None when there was nothing.
fn harvest(c: &mut Core, id: &Value) -> Option<(usize, usize)> {
    let rec = c.library.find(id).cloned()?;
    let base = vanilla(c)?;
    crate::schema_harvest::harvest(&c.installer, &mut c.library, &rec, &base.0)
}

/// The window's bar, as the installer reports to it.
fn reporter(o: &Owner) -> impl FnMut(Value) + '_ {
    move |evt| o.progress(evt)
}

/// An installer over the same folders for work done without the lock (a download, an import's
/// copying): the installer itself stays behind it.
fn fetcher(c: &Core) -> Installer {
    let lang = c.installer.lang_suffix.clone();
    let mut inst = Installer::new(c.game(), &lang).with_user_data(&c.user_data);
    inst.journal_dir = c.installer.journal_dir.clone();
    inst
}

/// A download from the catalog, with the bar counting it; the lock is not held meanwhile.
fn download(o: &Owner, category_id: &str, file_ref: &str, label: &str) -> Result<PathBuf, String> {
    let (inst, net) = {
        let c = o.core();
        (fetcher(&c), c.net.clone())
    };
    let published = |cat: &str, file: &str| o.core().catalog.published_hash(cat, file);
    inst.download(&net, category_id, file_ref, Some(label), &published, &mut reporter(o))
}

fn update(o: &Owner, id: &Value) -> Value {
    if let Some(stop) = o.blocked("install") {
        return stop;
    }
    let rec = match id.is_string().then(|| o.core().library.find(id).cloned()).flatten() {
        Some(r) => r,
        None => return not_found(),
    };
    let name = text(rec.get("name"));
    let run = || -> Result<Value, String> {
        if !crate::mod_update::updatable(&rec) {
            return Err(t("Этот мод нельзя обновить из каталога", &[]));
        }
        let local = download(o, &text(rec.get("categoryId")), &text(rec.get("fileRef")), &name)?;
        let mut lines = Vec::new();
        let had_schema = rec.get("schema").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
        let rebuild = {
            let mut c = o.core();
            let Core { installer, library, .. } = &mut *c;
            let updated = crate::mod_update::update_mod(installer, library, &rec, &local, &mut |m| lines.push(m))?;
            // the item pictures the user took out stay out of the new version too
            if rec.get("noItemIcons").is_some_and(crate::js::truthy) {
                let mut list = files(&updated);
                if installer.drop_item_icons(&mut list)? > 0 {
                    library
                        .update(id, &json!({ "files": files_value(&list), "noItemIcons": true }), None)
                        .map_err(io)?;
                }
            }
            let lifted = harvest(&mut c, id);
            if c.installer.master_is_off().unwrap_or(false) {
                let _ = c.installer.set_master_enabled(false);
            }
            had_schema || lifted.is_some_and(|(d, _)| d > 0)
        };
        for l in lines {
            o.diag(&l);
        }
        if rebuild {
            let _ = o.refresh_schema_in_background().recv();
        }
        Ok(o.core().library.find(id).cloned().unwrap_or(Value::Null))
    };
    match run() {
        Ok(record) => {
            o.progress(json!({ "type": "done", "label": name }));
            json!({ "ok": true, "record": record })
        }
        Err(e) => {
            o.progress(json!({ "type": "error", "label": name, "message": e }));
            json!({ "error": e })
        }
    }
}

fn install(o: &Owner, payload: &Value) -> Value {
    if let Some(stop) = o.blocked("install") {
        return stop;
    }
    let cat = text(payload.get("categoryId"));
    let name = text(payload.get("name"));
    let run = || -> Result<Value, String> {
        let replaced = {
            let mut c = o.core();
            let style = payload.get("styleLabel").cloned().unwrap_or(Value::Null);
            let key = (payload.get("categoryId").unwrap_or(&Value::Null), payload.get("name").unwrap_or(&Value::Null));
            if c.library.find_by_key(key.0, key.1, Some(&style)).is_some() {
                return Ok(json!({ "error": t("Уже установлено", &[]), "already": true }));
            }
            // a cursor set is written straight over the one in resource\cursor, so the set that is
            // on steps aside first; otherwise its files are gone with no way back
            if cat == "cursors" {
                let Core { installer, library, .. } = &mut *c;
                crate::cursors::disable_other_cursors(installer, library, None)
            } else {
                Vec::new()
            }
        };
        // before the download: a mod with nowhere to go does not cost a 300 MB download first
        if cat != "tools" {
            o.core().installer.require_game_folder()?;
        }
        let local = download(o, &cat, &text(payload.get("fileRef")), &name)?;
        o.progress(json!({ "type": "stage", "label": name, "stage": t("установка", &[]) }));
        let (rec, rebuild) = {
            let mut c = o.core();
            let Core { installer, library, .. } = &mut *c;
            // the record is written in the install's own transaction: paks without a record, or a
            // record without its paks, is not a state a killed process can leave behind
            let rec = FileTx::run(installer.journal_dir.as_deref(), installer.tx_log(), |tx| {
                let job = crate::installer_write::InstallJob { category_id: &cat, mod_name: &name, local: &local };
                let written = installer.install_into(tx, &job)?;
                let mut new = payload.clone();
                new["files"] = files_value(&written);
                library.add(&new, Some(tx)).map_err(io)
            })?;
            let id = rec.get("id").cloned().unwrap_or(Value::Null);
            // a whole-map terrain keeps the date its map was built, while the archive is at hand
            if let Some(at) = terrain_ages(&c).built_at_of(&rec) {
                c.library.update(&id, &json!({ "mapBuiltAt": crate::js::json_number(at) }), None).map_err(io)?;
            }
            let lifted = harvest(&mut c, &id);
            if cat == "cursors" {
                let _ = c.installer.ensure_cursor_store(id.as_str(), &files(&rec));
            }
            // installed while the master switch is off: the fresh file goes off too
            if c.installer.master_is_off().unwrap_or(false) {
                let _ = c.installer.set_master_enabled(false);
                crate::cursors::apply_master_to_cursors(&c.installer, &c.library, false);
            }
            (c.library.find(&id).cloned().unwrap_or(rec), lifted.is_some_and(|(d, _)| d > 0))
        };
        if rebuild {
            let _ = o.refresh_schema_in_background().recv();
        }
        o.progress(json!({ "type": "done", "label": name }));
        count_install(o, &cat, &name, payload.get("styleLabel"));
        Ok(json!({ "ok": true, "record": rec, "replaced": replaced }))
    };
    match run() {
        Ok(v) => v,
        Err(e) => {
            o.progress(json!({ "type": "error", "label": name, "message": e }));
            json!({ "error": e })
        }
    }
}

/// One install of a catalog mod, for the download counter; never holds the install up.
fn count_install(o: &Owner, cat: &str, name: &str, style: Option<&Value>) {
    let c = o.core();
    let mods = crate::download_stats::CatalogModsReader::new(&c.catalog.cache_path("mods.json")).read();
    let keys = crate::download_stats::stat_keys_for(mods.as_ref(), cat, name, style);
    c.download_stats.track(&keys);
}

fn export_single(o: &Owner, id: &Value) -> Value {
    let Some(rec) = o.core().library.find(id).cloned() else { return not_found() };
    let run = || -> Result<Value, String> {
        // a cursor set is loose files, not a pak: it travels as the zip the catalog uses
        let cursor = crate::cursors::is_cursor_record(Some(&rec));
        let buf = {
            let c = o.core();
            if cursor {
                c.installer.cursor_zip(&text(rec.get("id")), &text(rec.get("name")), &files(&rec))?
            } else {
                let deltas: Option<Vec<Vec<u8>>> = rec
                    .get("schema")
                    .and_then(Value::as_array)
                    .map(|d| d.iter().map(|b| text(b.get("block")).chars().map(|c| c as u8).collect()).collect());
                c.installer.merge_to_single_vpk(&files(&rec), deltas.as_deref())?
            }
        };
        let safe = safe_name(&text(rec.get("name")));
        let (title, ext, filter) = if cursor {
            (t("Сохранить курсор архивом", &[]), "zip", t("Архив курсора", &[]))
        } else {
            (t("Сохранить мод одним .vpk файлом", &[]), "vpk", t("VPK мод", &[]))
        };
        let res = o.shell.request(
            "dialog.save",
            vec![json!({
                "title": title,
                "defaultPath": format!("{safe}.{ext}"),
                "filters": [{ "name": filter, "extensions": [ext] }],
            })],
        )?;
        let path = res.get("filePath").and_then(Value::as_str).filter(|p| !p.is_empty());
        let (false, Some(path)) = (res.get("canceled") == Some(&Value::Bool(true)), path) else {
            return Ok(json!({ "cancelled": true }));
        };
        std::fs::write(path, &buf).map_err(io)?;
        Ok(json!({ "ok": true, "path": path, "size": buf.len() }))
    };
    run().unwrap_or_else(|e| json!({ "error": e }))
}

fn unpack(o: &Owner, id: &Value) -> Value {
    let Some(rec) = o.core().library.find(id).cloned() else { return not_found() };
    let run = || -> Result<Value, String> {
        let res = o.shell.request(
            "dialog.open",
            vec![
                json!({ "title": t("Куда распаковать мод", &[]), "properties": ["openDirectory", "createDirectory"] }),
            ],
        )?;
        let Some(paths) = chosen(&res) else { return Ok(json!({ "cancelled": true })) };
        let dest =
            PathBuf::from(crate::js::path_join(&[&paths[0].to_string_lossy(), &safe_name(&text(rec.get("name")))]));
        std::fs::create_dir_all(&dest).map_err(io)?;
        let (n, bytes) = o.core().installer.unpack_to_folder(&files(&rec), &dest)?;
        Ok(json!({ "ok": true, "path": dest.to_string_lossy(), "files": n, "bytes": bytes }))
    };
    run().unwrap_or_else(|e| json!({ "error": e }))
}

/// Two counted passes over one batch on the one bar: the files land, then each one is read.
fn run_import(
    o: &Owner,
    take: impl FnOnce(&Installer, &mut dyn FnMut(usize, usize)) -> Result<Vec<Value>, String>,
) -> Value {
    let copying = t("Копирование модов", &[]);
    let reading = t("Разбор модов", &[]);
    let step = |label: &str, done: usize, total: usize| {
        o.progress(json!({ "type": "count", "label": label, "done": done, "total": total }));
    };
    let run = || -> Result<Value, String> {
        let inst = fetcher(&o.core());
        let results = take(&inst, &mut |d, n| step(&copying, d, n))?;
        let out = {
            let mut c = o.core();
            let base = if results.iter().any(|r| r.get("error").is_none()) { vanilla(&mut c) } else { None };
            let Core { installer, library, .. } = &mut *c;
            crate::adopt::register_import_results(
                installer,
                library,
                base.as_ref().map(|b| b.0.as_slice()),
                &results,
                &mut |d, n| step(&reading, d, n),
            )?
        };
        if out.get("schema") == Some(&Value::Bool(true)) {
            let _ = o.refresh_schema_in_background().recv();
        }
        Ok(out)
    };
    let out = run().unwrap_or_else(|e| json!({ "error": e }));
    o.progress(json!({ "type": "done" }));
    out
}

fn import_paths(o: &Owner, paths: &[PathBuf]) -> Value {
    run_import(o, |inst, step| crate::import::import_vpks(inst, paths, step))
}

/// From raw bytes: the drag-and-drop fallback for when a real path cannot be resolved.
fn import_buffers(o: &Owner, items: &Value) -> Value {
    let list: Vec<(String, Vec<u8>)> = items
        .as_array()
        .map(|a| {
            a.iter()
                .map(|it| {
                    let data = match it.get("data") {
                        Some(Value::Array(b)) => b.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect(),
                        Some(Value::Object(o)) => {
                            // a Uint8Array as JSON: {"0": 1, "1": 2, ...}
                            let mut v: Vec<(usize, u8)> = o
                                .iter()
                                .filter_map(|(k, x)| Some((k.parse().ok()?, x.as_u64().unwrap_or(0) as u8)))
                                .collect();
                            v.sort();
                            v.into_iter().map(|(_, b)| b).collect()
                        }
                        _ => Vec::new(),
                    };
                    (text(it.get("name")), data)
                })
                .collect()
        })
        .unwrap_or_default();
    run_import(o, |inst, step| crate::import::import_vpk_buffers(inst, &list, step))
}

/// What My mods is drawn from, and the notes kept current from here: the ownership note, the
/// notice text and the emblem ring line.
fn list(o: &Owner) -> Value {
    let lines = std::cell::RefCell::new(Vec::<String>::new());
    let mut c = o.core();
    let ages = terrain_ages(&c);
    let marks = impact(&c);
    let key = c.settings.get("bloodKey").cloned().unwrap_or(Value::Null);
    let schema_on = c.settings.get("schemaPatch").is_some_and(crate::js::truthy);
    let stuck = serde_json::to_value(c.upkeep.repair.verify_stuck()).unwrap_or(Value::Null);
    let lang = c.installer.lang_folder().ok();
    let owned = crate::notice_text::NoticeText::owned_files(lang.as_deref().unwrap_or(Path::new("")));
    let Core { installer, library, fingerprints, .. } = &mut *c;
    let inst: &Installer = installer;
    let mods_of = |lib: &Library| {
        crate::update_impact::impact_mods(lib.list(), &|r| inst.lang_file_on_disk(r).unwrap_or_default())
    };
    let marked = |lib: &Library| Ok(marks.marked(&mods_of(lib)));
    let mut off_schema = false;
    let (answer, after) = {
        let mut guard = |lib: &mut Library| -> Result<(), String> {
            let mut log = |m: String| lines.borrow_mut().push(m);
            crate::scream_guard::guard(
                lib,
                &key,
                &mut |rec| {
                    let dir = files(rec)
                        .into_iter()
                        .find(|f| f.root == "lang" && f.rel_path.to_lowercase().ends_with("_dir.vpk"));
                    let Some(dir) = dir else { return Some(Vec::new()) };
                    let p = inst.lang_file_on_disk(&dir.rel_path).ok()?;
                    crate::vpk::read_index_file(&p).and_then(|b| crate::vpk::list_paths(&b)).ok()
                },
                &mut |lib, rec| {
                    switch_off(inst, lib, rec)?;
                    off_schema |= touches_schema(rec);
                    Ok(())
                },
                &mut log,
            )
            .map(|_| ())
        };
        let mut diag = |m: String| lines.borrow_mut().push(m);
        crate::mods_listing::list_mods(
            inst,
            library,
            crate::mods_listing::ListingDeps {
                fingerprints,
                terrain_ages: &ages,
                marked: Some(&marked),
                guard: Some(&mut guard),
                notice_owned: owned,
                schema_on,
                verify_stuck: stuck,
                diag: &mut diag,
            },
        )
    };
    // the anti-cheat notice in plain words, kept current from here; a rebuild that wrote or
    // removed its pak writes the ownership note again
    let game = c.game();
    let core = &mut *c;
    if let Some(dir) = &lang {
        if core.notice.refresh(game.as_deref(), dir, &mut |m| lines.borrow_mut().push(m)).is_some() {
            let mut owned = core
                .library
                .known_lang_rel_paths()
                .unwrap_or_default()
                .iter()
                .map(crate::js::string)
                .collect::<Vec<_>>();
            owned.extend(crate::notice_text::NoticeText::owned_files(dir));
            core.installer.write_ownership(&owned, &crate::mods_listing::iso_now());
        }
    }
    // an emblem shows only on the selection ring: the line that turns it on stays in autoexec
    if let (Some(on), Some(game)) = (after.ring_on, game.as_deref()) {
        match crate::emblem_ring::keep_ring(game, on) {
            Ok(Some(did)) => lines.borrow_mut().push(format!("autoexec: selection ring line {did}")),
            Ok(None) => {}
            Err(e) => lines.borrow_mut().push(format!("autoexec not written: {e}")),
        }
    }
    drop(c);
    for l in lines.into_inner() {
        o.diag(&l);
    }
    if off_schema {
        drop(o.refresh_schema_in_background());
    }
    answer
}

fn terrain_ages_for_catalog(o: &Owner) -> Value {
    let run = || -> Result<Value, String> {
        let (net, ages) = {
            let c = o.core();
            (c.net.clone(), terrain_ages(&c))
        };
        let cat = o.core().catalog.load(&net, false)?;
        let data = cat.get("mods").map(|m| m.get("modsData").unwrap_or(m)).cloned().unwrap_or(Value::Null);
        let terrains = data.get("terrains").and_then(Value::as_array).cloned().unwrap_or_default();
        let hash_of = |f: &str| o.core().catalog.published_hash("terrains", f);
        let mut fetch = |cat: &str, file: &str| -> Result<Option<Vec<u8>>, String> {
            let url = crate::installer_downloads::file_url(cat, file);
            let range = format!("bytes=-{}", crate::terrain_age::TAIL_BYTES);
            let o = crate::net_fetch::FetchOptions { headers: vec![("Range".into(), range)], ..Default::default() };
            let res = net.fetch_mirrored(&url, o).map_err(|e| e.message)?;
            if res.ok() {
                res.bytes().map(Some).map_err(|e| e.message)
            } else {
                Ok(None)
            }
        };
        Ok(ages.for_catalog(&terrains, &hash_of, &mut fetch))
    };
    run().unwrap_or_else(|e| json!({ "mapAt": null, "ages": {}, "stale": {}, "error": e }))
}
