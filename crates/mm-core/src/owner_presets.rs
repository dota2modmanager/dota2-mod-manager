//! The preset channels (src/ipc-presets.ts): saving the on/off state under a name, putting a preset
//! back on (its gone catalog mods fetched again first), sending it as a .d2mm or a link, taking one
//! in, and the ready-made presets. What a preset is lives in crates/mm-core/src/presets_service.rs
//! and the flows that put one on in crates/mm-core/src/preset_install.rs.

use serde_json::{json, Map, Value};

use crate::file_tx::FileTx;
use crate::i18n::t;
use crate::installer::Installer;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::overlays::files_value;
use crate::owner::{arg, Core, Owner, R};
use crate::preset_plan::{CatalogIndex, ShareEntry};
use crate::preset_share::EntryToWrite;

pub const CHANNELS: &[&str] = &[
    "presets:list",
    "presets:save",
    "presets:update",
    "presets:rename",
    "presets:delete",
    "presets:apply",
    "presets:exportPlan",
    "presets:export",
    "presets:shareLink",
    "presets:importDialog",
    "presets:importFile",
    "presets:resolve",
    "presets:ready",
    "presets:takeReady",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn no_preset() -> Value {
    json!({ "error": t("Пресет не найден", &[]) })
}

fn text(v: Option<&Value>) -> String {
    v.map(string).unwrap_or_default()
}

/// `String(x || '').slice(0, n)`
fn clip(v: Option<&Value>, n: usize) -> String {
    v.filter(|v| truthy(v)).map(string).unwrap_or_default().chars().take(n).collect()
}

/// The catalog by the names presets remember mods under; empty when it cannot be loaded.
fn catalog_index(c: &Core) -> CatalogIndex {
    let data = c.catalog.load(&c.net, false).ok();
    CatalogIndex::new(data.as_ref())
}

fn ru() -> bool {
    crate::i18n::lang() == crate::i18n::Lang::Ru
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let id = arg(args, 0);
    match channel {
        "presets:list" => list(o),
        "presets:save" => {
            let mut c = o.core();
            if let Err(e) = c.library.save_preset(&id, None) {
                return json!({ "error": e.to_string() });
            }
            json!(c.library.list_presets())
        }
        "presets:update" => match o.core().library.update_preset_mods(&id, None) {
            Ok(Some(p)) => json!({ "ok": true, "count": p.get("mods").and_then(Value::as_array).map_or(0, Vec::len) }),
            Ok(None) => no_preset(),
            Err(e) => json!({ "error": e.to_string() }),
        },
        "presets:rename" => {
            let clean: String = crate::js::trim(&args.get(1).filter(|v| truthy(v)).map(string).unwrap_or_default())
                .chars()
                .take(120)
                .collect();
            if clean.is_empty() {
                return json!({ "error": t("Введи название пресета", &[]) });
            }
            match o.core().library.update_preset(&id, &json!({ "name": clean }), None) {
                Ok(Some(_)) => json!({ "ok": true, "name": clean }),
                Ok(None) => no_preset(),
                Err(e) => json!({ "error": e.to_string() }),
            }
        }
        "presets:delete" => {
            let mut c = o.core();
            crate::presets_service::drop_shared_preset_file(c.library.get_preset(&id));
            if let Err(e) = c.library.delete_preset(&id, None) {
                return json!({ "error": e.to_string() });
            }
            json!(c.library.list_presets())
        }
        "presets:apply" => {
            let Some(p) = o.core().library.get_preset(&id).cloned() else { return no_preset() };
            flow(o, &p, true)
        }
        "presets:exportPlan" => {
            let c = o.core();
            let Some(p) = c.library.get_preset(&id).cloned() else { return no_preset() };
            let cat = catalog_index(&c);
            match crate::preset_plan::preset_share_entries(&c.library, &c.installer, &p, &cat) {
                Ok(entries) => json!({ "name": p.get("name"), "entries": crate::preset_plan::plan_shape(&entries) }),
                Err(e) => json!({ "error": e }),
            }
        }
        "presets:export" => export(o, &id, &arg(args, 1)),
        "presets:shareLink" => share_link(o, &id),
        "presets:importDialog" => {
            let res = o.shell.request(
                "dialog.open",
                vec![json!({
                    "title": t("Выбери файл пресета (.d2mm)", &[]),
                    "properties": ["openFile"],
                    "filters": [{ "name": t("Пресет Mod Manager", &[]), "extensions": ["d2mm"] }],
                })],
            );
            let res = match res {
                Ok(r) => r,
                Err(e) => return json!({ "error": e }),
            };
            let first = res.get("filePaths").and_then(Value::as_array).and_then(|a| a.first()).map(string);
            match first.filter(|f| !f.is_empty() && res.get("canceled") != Some(&Value::Bool(true))) {
                Some(f) => import_file(o, &f),
                None => json!({ "cancelled": true }),
            }
        }
        "presets:importFile" => import_file(o, &string(&id)),
        "presets:resolve" => {
            let Some(p) = o.core().library.get_preset(&id).cloned().filter(|p| p.get("wanted").is_some_and(truthy))
            else {
                return no_preset();
            };
            flow(o, &p, false)
        }
        "presets:ready" => ready(o),
        "presets:takeReady" => take_ready(o, &string(&id)),
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}

fn import_file(o: &Owner, file: &str) -> Value {
    let mut c = o.core();
    let ud = c.user_data.clone();
    crate::presets_service::import_preset_file(&mut c.library, &ud, std::path::Path::new(file))
}

fn list(o: &Owner) -> Value {
    let c = o.core();
    let cat = catalog_index(&c);
    let out: Vec<Value> = c
        .library
        .list_presets()
        .iter()
        .map(|p| {
            let mut v = p.as_object().cloned().unwrap_or_default();
            // a received preset shows what installing it would cost before anything downloads
            if p.get("wanted").is_some_and(truthy) {
                v.insert("status".into(), crate::preset_plan::shared_preset_status(&c.library, &c.installer, p, &cat));
                return Value::Object(v);
            }
            let (mods, skipped) = crate::preset_plan::preset_link_mods(&c.library, p, &cat).unwrap_or_default();
            let members = c.library.preset_members(Some(p)).unwrap_or_default();
            let on = crate::presets_service::preset_state(&c.library, Some(&c.settings), p).unwrap_or(Value::Null);
            v.insert("on".into(), on);
            v.insert(
                "modIds".into(),
                json!(members.iter().filter_map(|m| m.rec.as_ref().map(|r| r["id"].clone())).collect::<Vec<_>>()),
            );
            v.insert(
                "absent".into(),
                json!(members.iter().filter(|m| m.rec.is_none()).map(|m| m.identity.clone()).collect::<Vec<_>>()),
            );
            v.insert("link".into(), json!({ "count": mods.len(), "skipped": skipped }));
            Value::Object(v)
        })
        .collect();
    Value::Array(out)
}

/// A share entry with its bytes pulled, for what the user kept ticked; a skipped one goes as
/// missing.
fn prep(inst: &Installer, entry: &ShareEntry, key: &str, skip: &[String]) -> Result<EntryToWrite, String> {
    match entry.kind() {
        "pack" => Ok(EntryToWrite {
            line: entry.line.clone(),
            data: None,
            members: entry
                .members
                .iter()
                .enumerate()
                .map(|(j, m)| prep(inst, m, &format!("{key}.{j}"), skip))
                .collect::<Result<_, _>>()?,
        }),
        "embedded" if skip.iter().any(|s| s == key) => {
            let mut line = Map::new();
            line.insert("kind".into(), json!("missing"));
            line.insert("name".into(), entry.line.get("name").cloned().unwrap_or(Value::Null));
            line.insert("reason".into(), json!(t("отправитель не вложил файл", &[])));
            Ok(EntryToWrite { line, data: None, members: vec![] })
        }
        "embedded" => Ok(EntryToWrite { line: entry.line.clone(), data: entry.data(inst)?, members: vec![] }),
        _ => Ok(EntryToWrite { line: entry.line.clone(), data: None, members: vec![] }),
    }
}

fn export(o: &Owner, id: &Value, opts: &Value) -> Value {
    let Some(preset) = o.core().library.get_preset(id).cloned() else { return no_preset() };
    let name = text(preset.get("name"));
    let safe: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let safe = if safe.is_empty() { "preset".to_string() } else { safe };
    let res = o.shell.request(
        "dialog.save",
        vec![json!({
            "title": t("Сохранить пресет для друга", &[]),
            "defaultPath": format!("{safe}.d2mm"),
            "filters": [{ "name": t("Пресет Mod Manager", &[]), "extensions": ["d2mm"] }],
        })],
    );
    let res = match res {
        Ok(r) => r,
        Err(e) => return json!({ "error": e }),
    };
    let path = res.get("filePath").and_then(Value::as_str).filter(|p| !p.is_empty()).map(String::from);
    let (false, Some(path)) = (res.get("canceled") == Some(&Value::Bool(true)), path) else {
        return json!({ "cancelled": true });
    };
    let run = || -> Result<Value, String> {
        let skip: Vec<String> =
            opts.get("skip").and_then(Value::as_array).map(|a| a.iter().map(string).collect()).unwrap_or_default();
        o.progress(json!({ "type": "stage", "label": name, "stage": t("сборка пресета", &[]) }));
        let c = o.core();
        let cat = catalog_index(&c);
        let entries = crate::preset_plan::preset_share_entries(&c.library, &c.installer, &preset, &cat)?
            .iter()
            .enumerate()
            .map(|(i, e)| prep(&c.installer, e, &i.to_string(), &skip))
            .collect::<Result<Vec<_>, _>>()?;
        let mut manifest = Map::new();
        manifest.insert("name".into(), preset.get("name").cloned().unwrap_or(Value::Null));
        manifest.insert("note".into(), json!(clip(opts.get("note"), 600)));
        manifest.insert("author".into(), json!({ "name": clip(opts.get("author"), 80) }));
        manifest.insert("app".into(), json!(o.opts.app_version));
        manifest
            .insert("catalogFetchedAt".into(), c.catalog.cache_info().get("fetchedAt").cloned().unwrap_or(Value::Null));
        let (size, _) =
            crate::preset_share::write_preset_file(std::path::Path::new(&path), &manifest, entries, (o.opts.now)())?;
        Ok(json!({ "ok": true, "path": path, "size": size }))
    };
    match run() {
        Ok(v) => {
            o.progress(json!({ "type": "done", "label": name }));
            v
        }
        Err(e) => {
            o.progress(json!({ "type": "error", "label": name, "message": e }));
            json!({ "error": e })
        }
    }
}

fn share_link(o: &Owner, id: &Value) -> Value {
    let c = o.core();
    let Some(preset) = c.library.get_preset(id).cloned() else { return no_preset() };
    let cat = catalog_index(&c);
    let (mods, skipped) = match crate::preset_plan::preset_link_mods(&c.library, &preset, &cat) {
        Ok(r) => r,
        Err(e) => return json!({ "error": e }),
    };
    if mods.is_empty() {
        return json!({ "error": t("В пресете только свои моды — ссылка их не донесёт, отправь файлом", &[]) });
    }
    let author = c.settings.get("account").and_then(|a| a.get("username")).cloned().unwrap_or(Value::Null);
    let link = crate::preset_link::encode_preset_link(&preset["name"], &author, &mods);
    json!({ "ok": true, "code": link.code, "web": link.web, "direct": link.direct, "count": mods.len(), "skipped": skipped })
}

/// The preset a ready-made one was taken as, by its id in the taken preset's source.
fn taken_from(lib: &Library, id: &str) -> Option<Value> {
    lib.list_presets()
        .iter()
        .find(|p| p.get("source").and_then(|s| s.get("ready")).and_then(Value::as_str) == Some(id))
        .cloned()
}

fn ready(o: &Owner) -> Value {
    let c = o.core();
    let ru = ru();
    let or = |a: &Value, b: &Value| if truthy(a) { a.clone() } else { b.clone() };
    let list: Vec<Value> = c
        .ready
        .list()
        .iter()
        .map(|p| {
            let about = p.get("about").cloned().unwrap_or(Value::Null);
            let (r, e) =
                (about.get("ru").cloned().unwrap_or(Value::Null), about.get("en").cloned().unwrap_or(Value::Null));
            let pid = text(p.get("id"));
            json!({
                "id": p.get("id"), "name": p.get(if ru { "ru" } else { "en" }),
                "about": if ru { or(&r, &e) } else { or(&e, &r) },
                "mods": p.get("mods"), "taken": taken_from(&c.library, &pid).map(|t| t["id"].clone()),
            })
        })
        .collect();
    Value::Array(list)
}

fn take_ready(o: &Owner, id: &str) -> Value {
    let preset = {
        let mut c = o.core();
        let Some(p) = c.ready.get(id) else { return no_preset() };
        let ru = ru();
        let pid = text(p.get("id"));
        let made = match taken_from(&c.library, &pid) {
            Some(t) => Ok(t),
            None => {
                let about = p.get("about").cloned().unwrap_or(Value::Null);
                let wanted: Vec<Value> = p
                    .get("mods")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .map(|m| {
                                let mut e = Map::new();
                                e.insert("kind".into(), json!("catalog"));
                                if let Some(o) = m.as_object() {
                                    e.extend(o.clone());
                                }
                                e.insert("fp".into(), Value::Null);
                                Value::Object(e)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                c.library.add_shared_preset(
                    &json!({
                        "name": p.get(if ru { "ru" } else { "en" }),
                        "note": about.get(if ru { "ru" } else { "en" }),
                        "author": "Dota 2 Mod Manager", "wanted": wanted,
                    }),
                    None,
                )
            }
        };
        let made = match made {
            Ok(m) => m,
            Err(e) => return json!({ "error": e.to_string() }),
        };
        let made = match made.get("source").filter(|s| s.is_object()).cloned() {
            Some(mut source) => {
                source["ready"] = json!(pid);
                match c.library.update_preset(&made["id"], &json!({ "source": source }), None) {
                    Ok(Some(p)) => p,
                    Ok(None) => made,
                    Err(e) => return json!({ "error": e.to_string() }),
                }
            }
            None => {
                let _ = c.library.save(None);
                made
            }
        };
        made
    };
    let own = !preset.get("wanted").is_some_and(truthy);
    flow(o, &preset, own)
}

/// A preset put on: an own one (`own`) or a received one resolved, over the catalog's downloads.
/// The core is held for the whole of it, downloads included.
fn flow(o: &Owner, preset: &Value, own: bool) -> Value {
    let cosmetics_blocked = o.blocked("cosmetics").map(|b| text(b.get("error")));
    let (outcome, rebuild) = {
        let mut c = o.core();
        let base = if own { None } else { c.game().and_then(|g| c.schema.vanilla(&g).ok()) };
        let cat = catalog_index(&c);
        let net = c.net.clone();
        let Core { installer, library, settings, catalog, .. } = &mut *c;
        let inst: &Installer = installer;
        let catalog = &*catalog;
        let mut fetch = |hit: &Value| -> Result<Vec<Value>, String> {
            let (cat_id, name) = (text(hit.get("categoryId")), text(hit.get("name")));
            let published = |a: &str, b: &str| catalog.published_hash(a, b);
            let local = inst
                .download(&net, &cat_id, &text(hit.get("fileRef")), Some(&name), &published, &mut |e| o.progress(e))?;
            let job = crate::installer_write::InstallJob { category_id: &cat_id, mod_name: &name, local: &local };
            let written = FileTx::run(inst.journal_dir.as_deref(), inst.tx_log(), |tx| inst.install_into(tx, &job))?;
            Ok(files_value(&written).as_array().cloned().unwrap_or_default())
        };
        let mut pick = |lib: &mut Library, p: &Value| {
            let effect = p.get("effectId").cloned().unwrap_or(Value::Null);
            crate::schema_cosmetics::pick_cosmetic(
                lib,
                &string(&p["slot"]),
                &string(&p["itemId"]),
                p["name"].as_str(),
                Some(&effect),
            )
        };
        let mut deploy = |lib: &mut Library, p: &Value| {
            let _ = crate::owner_packs::deploy_into(inst, lib, p);
        };
        let mut progress = |v: Value| o.progress(v);
        let mut d = crate::preset_install::Deps {
            inst,
            lib: library,
            settings: Some(settings),
            vanilla: base.as_ref().map(|b| b.0.as_slice()),
            cosmetics_blocked,
            fetch: &mut fetch,
            pick: &mut pick,
            deploy_pack: &mut deploy,
            progress: &mut progress,
        };
        let out = if own {
            crate::preset_install::apply_own(&mut d, preset, &cat)
        } else {
            crate::preset_install::resolve(&mut d, preset, &cat)
        };
        match out {
            Ok(out) => {
                if out.after_master {
                    crate::owner_packs::after_deploy_master(&c);
                }
                (out.answer, out.schema)
            }
            Err(e) => (json!({ "error": e }), false),
        }
    };
    if rebuild {
        let _ = o.refresh_schema_in_background().recv();
    }
    outcome
}
