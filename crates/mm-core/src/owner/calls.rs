//! mm-core's functions by name, with JSON in and out, behind `mm-cli call`: what the Node tools
//! under tools/ (item-plan, mod-doctor, dota-bench, the release scripts) and a few tests ask of
//! Rust. Each name is "module.function", kept from when those modules were TypeScript so the
//! tools did not have to change. A name nothing calls any more goes, rather than staying here.

use serde_json::{json, Value};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::{hero_names, item_visuals};

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

/// An argument read into the type it is.
fn from_arg<T: serde::de::DeserializeOwned>(args: &[Value], i: usize) -> Result<T, String> {
    serde_json::from_value(args.get(i).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())
}

/// An argument that is a list of strings.
fn strings(args: &[Value], i: usize) -> Result<Vec<String>, String> {
    from_arg(args, i)
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
        "hero-names.heroIdFromName" => json!(hero_names::id_from_name(&s(args, 0))),
        // tools/mods/dota-diff.mjs groups a Dota update's files by hero with these two
        "hero-names.heroKey" => json!(hero_names::key(&s(args, 0))),
        "hero-names.heroDisplayName" => json!(hero_names::display_name(&s(args, 0))),
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
        "item-visuals.itemVisuals" => json!(item_visuals::item_visuals(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?),
        "item-visuals.findItems" => json!(item_visuals::find_items(&b(args, 0)?, &s(args, 1))
            .map_err(kv_err)?
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()),
        "item-visuals.buildPlan" => {
            let text = b(args, 0)?;
            match item_visuals::item_visuals(&text, &s(args, 1)).map_err(kv_err)? {
                Some(v) => json!(item_visuals::build_plan(&text, &v).map_err(kv_err)?),
                None => Value::Null,
            }
        }
        "release-notes.changelogSection" => json!(crate::app_info::changelog_section(&s(args, 0), &s(args, 1))),
        "tower-looks.looks" => json!(crate::tower_looks::tower_looks(&b(args, 0)?)?),
        "gem-colors.colors" => json!(crate::gem_colors::gem_colors(&b(args, 0)?).map_err(|e| e.to_string())?),
        "gem-colors.find" => {
            let gems = crate::gem_colors::gem_colors(&b(args, 0)?).map_err(|e| e.to_string())?;
            json!(crate::gem_colors::find_gem(&gems, &s(args, 1)))
        }
        "toolchain.fallbackName" => json!(crate::toolchain::fallback_name(&s(args, 0), &s(args, 1), &s(args, 2))),
        "toolchain.pins" => {
            let pins = crate::toolchain::built_in_pins();
            json!(pins
                .iter()
                .map(|(n, builds)| (
                    n.clone(),
                    builds
                        .iter()
                        .map(|(b2, p)| (
                            b2.clone(),
                            json!({
                                "version": p.version, "license": p.license, "project": p.project, "url": p.url,
                                "sha256": p.sha256, "bytes": p.bytes, "exe": p.exe,
                            })
                        ))
                        .collect::<serde_json::Map<_, _>>()
                        .into()
                ))
                .collect::<serde_json::Map<_, _>>())
        }
        "mod-doctor.examine" => {
            json!(crate::mod_doctor::examine(std::path::Path::new(&s(args, 0)), std::path::Path::new(&s(args, 1)))?)
        }
        // (texts): each portable.yml read as the portable update reads it, {error} when refused
        "portable-update.parseManifest" => json!(strings(args, 0)?
            .iter()
            .map(|t| match crate::portable_update::parse_manifest(t) {
                Ok(m) => json!({ "ok": m }),
                Err(e) => json!({ "error": e }),
            })
            .collect::<Vec<_>>()),
        // (versions and files): the release addresses
        "portable-update.urls" => json!(strings(args, 0)?
            .chunks(2)
            .map(|p| crate::portable_update::release_url(&p[0], p.get(1).map_or("", |s| s.as_str())))
            .collect::<Vec<_>>()),
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
