//! Files the app did not install, as My mods lists them (src/ipc-foreign.ts): switching one off and
//! on, removing it with its data volumes, taking it into the library, recognising a cursor set or a
//! font installed by hand, and cutting a file with several heroes into one mod per hero.

use std::path::Path;

use serde_json::{json, Value};

use crate::i18n::t;
use crate::overlays::files_of;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "mods:externalSetEnabled",
    "mods:externalRemove",
    "mods:splitMod",
    "mods:adoptMod",
    "mods:adoptExternal",
    "mods:adoptFont",
    "mods:adoptCursor",
    "mods:splitExternal",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

fn io(e: std::io::Error) -> String {
    e.to_string()
}

fn text(v: &Value) -> String {
    crate::js::string(v)
}

fn not_found() -> Value {
    json!({ "error": t("Мод не найден", &[]) })
}

fn no_match() -> Value {
    json!({ "error": t("Совпадение с каталогом не найдено", &[]) })
}

/// The file's name without the `.off` a switched-off file carries.
fn base_of(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".off") {
        file_name[..file_name.len() - 4].to_string()
    } else {
        file_name.to_string()
    }
}

fn exists(p: &Path) -> bool {
    p.exists()
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    let run = || -> Result<Value, String> {
        match channel {
            "mods:externalSetEnabled" => {
                let c = o.core();
                let lang = c.installer.lang_folder()?;
                let on = lang.join(base_of(&text(&arg(args, 0))));
                let off = crate::installer::with_suffix(&on, ".off");
                let enabled = crate::js::truthy(&arg(args, 1));
                if enabled && exists(&off) {
                    std::fs::rename(&off, &on).map_err(io)?;
                }
                if !enabled && exists(&on) {
                    std::fs::rename(&on, &off).map_err(io)?;
                }
                Ok(json!({ "ok": true }))
            }
            "mods:externalRemove" => {
                let c = o.core();
                let lang = c.installer.lang_folder()?;
                let base = base_of(&text(&arg(args, 0)));
                // the index alone leaves its data volumes behind as orphans listed as more foreign
                // files: the whole set goes, in whatever on/off state each part is in
                let mut all = vec![base.clone()];
                all.extend(c.installer.sibling_parts(&base));
                for rel in all {
                    for suf in ["", ".off"] {
                        let abs = lang.join(format!("{rel}{suf}"));
                        if exists(&abs) {
                            std::fs::remove_file(&abs).map_err(io)?;
                        }
                    }
                }
                Ok(json!({ "ok": true }))
            }
            "mods:splitMod" => split_mod(o, &arg(args, 0)),
            "mods:adoptMod" => adopt_mod(o, &arg(args, 0), &arg(args, 1)),
            "mods:adoptExternal" => adopt_external(o, &text(&arg(args, 0)), &arg(args, 1)),
            "mods:adoptFont" => {
                let mut c = o.core();
                let Some(fh) = c.installer.font_folder_hashes() else { return Ok(no_match()) };
                let name = text(&arg(args, 0));
                let Some(m) = c.fingerprints.match_fonts(&fh).into_iter().find(|m| m.name == name) else {
                    return Ok(no_match());
                };
                let preview = arg(args, 1);
                let files: Vec<Value> = m.files.keys().map(|bn| json!({ "root": "fonts", "relPath": bn })).collect();
                c.library
                    .add(
                        &json!({
                            "name": m.name, "categoryId": m.category_id, "styleLabel": style(m.style_label.as_ref()),
                            "fileRef": m.name, "preview": or_null(&preview), "files": files,
                        }),
                        None,
                    )
                    .map_err(io)?;
                Ok(json!({ "ok": true, "name": m.name }))
            }
            "mods:adoptCursor" => adopt_cursor(o, &arg(args, 0)),
            "mods:splitExternal" => split_external(o, &text(&arg(args, 0))),
            other => Err(format!("no handler for {other}")),
        }
    };
    Ok(run().unwrap_or_else(|e| json!({ "error": e })))
}

/// `x || null`.
fn or_null(v: &Value) -> Value {
    if crate::js::truthy(v) {
        v.clone()
    } else {
        Value::Null
    }
}

fn style(v: Option<&Value>) -> Value {
    v.map_or(Value::Null, or_null)
}

/// Split a merged multi-hero library record into one managed mod per hero; each part takes the item
/// blocks that belong to it.
fn split_mod(o: &Owner, id: &Value) -> Result<Value, String> {
    let parts = {
        let mut c = o.core();
        let Some(rec) = c.library.find(id).cloned() else { return Ok(not_found()) };
        if !files_of(rec.get("files").unwrap_or(&Value::Null))
            .iter()
            .any(|f| f.root == "lang" && f.rel_path.to_lowercase().ends_with("_dir.vpk"))
        {
            return Ok(json!({ "error": t("Нет _dir.vpk для разбора", &[]) }));
        }
        let Core { installer, library, .. } = &mut *c;
        crate::schema_harvest::split(installer, library, &rec)?
    };
    let Some(parts) = parts.filter(|p| !p.is_empty()) else {
        return Ok(json!({ "error": t("В файле меньше двух героев — разбирать нечего", &[]) }));
    };
    if parts.iter().any(|p| p.get("schema").and_then(Value::as_array).is_some_and(|a| !a.is_empty())) {
        let _ = o.refresh_schema_in_background().recv();
    }
    let names: Vec<Value> = parts.iter().map(|p| p.get("name").cloned().unwrap_or(Value::Null)).collect();
    Ok(json!({ "ok": true, "count": parts.len(), "names": names }))
}

/// An import whose content matches a catalog mod takes that identity, without a download.
fn adopt_mod(o: &Owner, id: &Value, preview: &Value) -> Result<Value, String> {
    let mut c = o.core();
    let Some(rec) = c.library.find(id).cloned() else { return Ok(not_found()) };
    let a = c.installer.analyze_record(&files_of(rec.get("files").unwrap_or(&Value::Null)));
    let fp = a.as_ref().and_then(|a| a.get("fp")).and_then(Value::as_str).map(String::from);
    let Some(m) = c.fingerprints.matches(fp.as_deref()).and_then(|m| m.into_iter().next()) else {
        return Ok(no_match());
    };
    let mut fields = json!({
        "name": m.get("name").cloned().unwrap_or(Value::Null),
        "categoryId": m.get("categoryId").cloned().unwrap_or(Value::Null),
        "styleLabel": style(m.get("styleLabel")),
    });
    if crate::js::truthy(preview) {
        fields["preview"] = preview.clone();
    }
    c.library.update(id, &fields, None).map_err(io)?;
    // now that its category is known, into its part of the load order
    let mut merged = rec.clone();
    if let (Some(r), Some(f)) = (merged.as_object_mut(), fields.as_object()) {
        r.extend(f.clone());
    }
    if let Some(moved) = crate::slot_zones::move_to_zone(&c.installer, &merged)? {
        c.library.update(id, &json!({ "files": moved }), None).map_err(io)?;
    }
    Ok(json!({ "ok": true, "name": m.get("name").cloned().unwrap_or(Value::Null) }))
}

/// A file someone dropped into the game folder by hand, into the library: as the catalog mod it
/// is when recognised, and otherwise as an import named after its content.
fn adopt_external(o: &Owner, file_name: &str, preview: &Value) -> Result<Value, String> {
    let rebuild;
    let out = {
        let mut c = o.core();
        let lang = c.installer.lang_folder()?;
        let base = base_of(file_name);
        let Some(on_disk) = ["", ".off"].iter().map(|s| lang.join(format!("{base}{s}"))).find(|p| exists(p)) else {
            return Ok(json!({ "error": t("Файл не найден в папке модов", &[]) }));
        };
        let fp = crate::vpk::read_index_file(&on_disk).ok().and_then(|b| crate::vpk::fingerprint_vpk(&b).ok());
        let matches = fp.and_then(|f| c.fingerprints.matches(Some(&f)));
        // the _dir.vpk plus any sibling data archives: one mod, several files
        let mut files = vec![json!({ "root": "lang", "relPath": base })];
        for part in c.installer.sibling_parts(&base) {
            files.push(json!({ "root": "lang", "relPath": part }));
        }
        let m = matches.and_then(|m| m.into_iter().next());
        let identity = match &m {
            Some(m) => json!({
                "name": m.get("name").cloned().unwrap_or(Value::Null),
                "categoryId": m.get("categoryId").cloned().unwrap_or(Value::Null),
                "styleLabel": style(m.get("styleLabel")),
                "preview": or_null(preview),
            }),
            None => {
                let name = c.installer.display_name_for_file(&base).filter(|n| !n.is_empty()).unwrap_or_else(|| {
                    let lower = base.to_lowercase();
                    if lower.ends_with("_dir.vpk") {
                        base[..base.len() - 8].to_string()
                    } else {
                        base.clone()
                    }
                });
                json!({ "name": name, "categoryId": "imported", "styleLabel": null, "preview": null })
            }
        };
        let mut new = identity.clone();
        new["fileRef"] = json!(file_name);
        new["files"] = Value::Array(files);
        let mut rec = c.library.add(&new, None).map_err(io)?;
        let id = rec.get("id").cloned().unwrap_or(Value::Null);
        // a file dropped in by hand keeps its name until now; its category decides its slot
        if let Some(placed) = crate::slot_zones::move_to_zone(&c.installer, &rec)? {
            rec = c.library.update(&id, &json!({ "files": placed }), None).map_err(io)?.unwrap_or(rec);
        }
        // never through an install, so its item blocks are still inside it: lifted now
        let lifted = {
            let game = c.game();
            let base = game.and_then(|g| c.schema.vanilla(&g).ok());
            let Core { installer, library, .. } = &mut *c;
            base.and_then(|b| crate::schema_harvest::harvest(installer, library, &rec, &b.0))
        };
        rebuild = lifted.is_some_and(|(d, _)| d > 0);
        // a file that arrived switched off keeps that state
        if file_name.to_lowercase().ends_with(".off") {
            c.library.set_enabled(&id, false, None).map_err(io)?;
        }
        json!({ "ok": true, "name": identity.get("name").cloned().unwrap_or(Value::Null), "matched": m.is_some() })
    };
    if rebuild {
        let _ = o.refresh_schema_in_background().recv();
    }
    Ok(out)
}

/// A cursor set somebody put in resource\cursor by hand, recognised as a catalog mod.
fn adopt_cursor(o: &Owner, preview: &Value) -> Result<Value, String> {
    let mut c = o.core();
    let Some(game) = c.game() else { return Ok(json!({ "error": t("Путь к Dota 2 не задан", &[]) })) };
    let dir = game.join("dota").join("resource").join("cursor");
    if !exists(&dir) {
        return Ok(json!({ "error": t("Папка курсора не найдена", &[]) }));
    }
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut rels: Vec<String> = Vec::new();
    fn walk(d: &Path, pre: &str, files: &mut Vec<(String, Vec<u8>)>, rels: &mut Vec<String>) -> Result<(), String> {
        for e in crate::js::read_dir(d).map_err(io)? {
            let name = e.file_name().to_string_lossy().into_owned();
            let full = d.join(&name);
            let rel = if pre.is_empty() { name.clone() } else { format!("{pre}/{name}") };
            let kind = e.file_type().map_err(io)?;
            if kind.is_dir() {
                walk(&full, &rel, files, rels)?;
            } else if kind.is_file() {
                files.push((name.to_lowercase(), std::fs::read(&full).map_err(io)?));
                rels.push(rel);
            }
        }
        Ok(())
    }
    walk(&dir, "", &mut files, &mut rels)?;
    let list: Vec<(String, &[u8])> = files.iter().map(|(p, d)| (p.clone(), d.as_slice())).collect();
    let fp = crate::vpk::fingerprint_files(&list);
    let Some(m) = c.fingerprints.matches(Some(&fp)).and_then(|m| m.into_iter().next()) else { return Ok(no_match()) };
    let name = m.get("name").cloned().unwrap_or(Value::Null);
    let rec = c
        .library
        .add(
            &json!({
                "name": name, "categoryId": m.get("categoryId").cloned().unwrap_or(Value::Null),
                "styleLabel": style(m.get("styleLabel")), "fileRef": name, "preview": or_null(preview),
                "files": rels.iter().map(|r| json!({ "root": "cursor", "relPath": r })).collect::<Vec<_>>(),
            }),
            None,
        )
        .map_err(io)?;
    // the set is on disk but not ours yet: a copy is kept so it can be switched off and on
    let _ = c.installer.ensure_cursor_store(rec.get("id").and_then(Value::as_str), &files_of(&rec["files"]));
    Ok(json!({ "ok": true, "name": name }))
}

/// A merged multi-hero file another tool put in the folder, cut into one import per hero; the
/// source and its data volumes go.
fn split_external(o: &Owner, file_name: &str) -> Result<Value, String> {
    let mut c = o.core();
    let lang = c.installer.lang_folder()?;
    let base = base_of(file_name);
    let parts = c.installer.split_vpk_file(&base)?;
    if parts.is_empty() {
        return Ok(json!({ "error": t("В файле меньше двух героев — разбирать нечего", &[]) }));
    }
    for p in &parts {
        c.library
            .add(
                &json!({
                    "name": p.get("name").cloned().unwrap_or(Value::Null), "categoryId": "imported", "styleLabel": null,
                    "fileRef": file_name, "preview": null, "files": p.get("files").cloned().unwrap_or(json!([])),
                }),
                None,
            )
            .map_err(io)?;
    }
    let orig = {
        let lower = base.to_lowercase();
        if lower.ends_with("_dir.vpk") {
            base[..base.len() - 8].to_lowercase()
        } else {
            lower.clone()
        }
    };
    let volume = regex::Regex::new(&format!(r"^{}_\d{{3}}\.vpk$", regex::escape(&orig))).map_err(|e| e.to_string())?;
    for f in crate::js::dir_names(&lang) {
        let lower = f.to_lowercase();
        let n = lower.strip_suffix(".off").unwrap_or(&lower);
        if n == base.to_lowercase() || volume.is_match(n) {
            let _ = std::fs::remove_file(lang.join(&f));
        }
    }
    let names: Vec<Value> = parts.iter().map(|p| p.get("name").cloned().unwrap_or(Value::Null)).collect();
    Ok(json!({ "ok": true, "count": parts.len(), "names": names }))
}
