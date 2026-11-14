//! The author's drafts (src/ipc-creator.ts): the drafts, one saved, a style's VPK or picture
//! picked, one deleted, and one written out as an archive for the catalog's maintainer. The
//! thinking is in creator.rs; this asks the user for the files and where to save.

use serde_json::{json, Map, Value};

use crate::creator::Creator;
use crate::i18n::t;
use crate::owner::{arg, Owner, R};

pub const CHANNELS: &[&str] = &["creator:list", "creator:save", "creator:attach", "creator:remove", "creator:export"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// `{ ok: true, ...fields }`, or `{ error }`.
fn spread(r: Result<Value, String>) -> Value {
    match r {
        Ok(v) => {
            let mut out = Map::new();
            out.insert("ok".into(), Value::Bool(true));
            if let Some(o) = v.as_object() {
                out.extend(o.clone());
            }
            Value::Object(out)
        }
        Err(e) => json!({ "error": e }),
    }
}

/// The path a dialog answered with, or None when it was cancelled.
fn picked(res: &Value, many: bool) -> Option<String> {
    if res.get("canceled") == Some(&Value::Bool(true)) {
        return None;
    }
    let p = if many {
        res.get("filePaths").and_then(Value::as_array).and_then(|a| a.first()).map(crate::js::string)
    } else {
        res.get("filePath").filter(|v| crate::js::truthy(v)).map(crate::js::string)
    };
    p.filter(|p| !p.is_empty())
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    let store = Creator::new(&o.opts.user_data);
    let id = crate::js::string(&a0);
    spread(match channel {
        "creator:list" => Ok(json!({ "drafts": store.list().iter().map(|d| store.shown(d)).collect::<Vec<_>>() })),
        "creator:save" => {
            let fields = arg(args, 1);
            let fields = if crate::js::truthy(&fields) { fields } else { json!({}) };
            let id = crate::js::truthy(&a0).then_some(id);
            store.save(id.as_deref(), &fields).map(|d| json!({ "draft": store.shown(&d) }))
        }
        "creator:attach" => (|| {
            let vpk = arg(args, 2).as_str() == Some("vpk");
            let filters = if vpk {
                json!([{ "name": "VPK", "extensions": ["vpk"] }])
            } else {
                json!([{ "name": t("Картинки и видео", &[]), "extensions": ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"] }])
            };
            let res = o.shell.request(
                "dialog.open",
                vec![json!({
                    "title": if vpk { t("VPK мода", &[]) } else { t("Картинка мода", &[]) },
                    "properties": ["openFile"],
                    "filters": filters,
                })],
            )?;
            let Some(from) = picked(&res, true) else { return Ok(json!({ "cancelled": true })) };
            let d =
                store.attach(&id, &arg(args, 1), if vpk { "vpk" } else { "picture" }, std::path::Path::new(&from))?;
            Ok(json!({ "draft": store.shown(&d) }))
        })(),
        "creator:remove" => store.remove(&id).map(|_| json!({})),
        "creator:export" => (|| {
            let previews: Vec<Option<Vec<u8>>> = arg(args, 1)
                .as_array()
                .map(|a| a.iter().map(|p| crate::owner::bytes_of(p).ok().flatten()).collect())
                .unwrap_or_default();
            let (name, zip) = store.bundle(&id, &previews)?;
            let res = o.shell.request(
                "dialog.save",
                vec![json!({
                    "title": t("Сохранить мод для каталога", &[]),
                    "defaultPath": o.opts.downloads.join(&name).to_string_lossy(),
                    "filters": [{ "name": "ZIP", "extensions": ["zip"] }],
                })],
            )?;
            let Some(to) = picked(&res, false) else { return Ok(json!({ "cancelled": true })) };
            std::fs::write(&to, &zip).map_err(|e| e.to_string())?;
            Ok(json!({ "path": to, "size": zip.len() }))
        })(),
        _ => Err(format!("no handler for {channel}")),
    })
}
