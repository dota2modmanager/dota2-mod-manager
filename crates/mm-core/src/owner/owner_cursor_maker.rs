//! The window for a cursor set of the user's own (looks/cursor_maker.rs): the game's cursors to
//! draw over, and the set built from what the window drew. The Rust core alone answers these.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::cursor_maker::{CursorMaker, Drawn};
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &["cursor:state", "cursor:install"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn spread(r: Result<Value, String>) -> Value {
    match r {
        Ok(Value::Object(m)) => {
            let mut out = Map::new();
            out.insert("ok".into(), Value::Bool(true));
            out.extend(m);
            Value::Object(out)
        }
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "error": e }),
    }
}

/// [{ name, hot: [x, y], pngs: { "32": bytes, ... } }] as the window sends them.
fn drawn_of(v: &Value) -> Result<Vec<Drawn>, String> {
    let mut out = Vec::new();
    for d in v.as_array().into_iter().flatten() {
        let hot = |i: usize| d["hot"].get(i).and_then(Value::as_f64).unwrap_or(0.0);
        let mut pngs = BTreeMap::new();
        for (size, b) in d["pngs"].as_object().into_iter().flatten() {
            let Ok(size) = size.parse::<u32>() else { continue };
            if let Some(b) = crate::owner::bytes_of(b)? {
                pngs.insert(size, b);
            }
        }
        out.push(Drawn { name: crate::js::string(&d["name"]), hot: (hot(0), hot(1)), pngs });
    }
    Ok(out)
}

fn pictures_of(v: &Value) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    for p in v.as_array().into_iter().flatten() {
        if let Some(b) = crate::owner::bytes_of(&p["png"])? {
            out.push((crate::js::string(&p["id"]), b));
        }
    }
    Ok(out)
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    match channel {
        "cursor:state" => {
            let c = o.core();
            spread(CursorMaker::new(&c.user_data).state(&c.installer, &c.library))
        }
        "cursor:install" => {
            if let Some(stop) = o.blocked("install") {
                return stop;
            }
            let (drawn, pictures) = match (drawn_of(&arg(args, 1)), pictures_of(&arg(args, 2))) {
                (Ok(d), Ok(p)) => (d, p),
                (Err(e), _) | (_, Err(e)) => return json!({ "error": e }),
            };
            let mut lines = Vec::new();
            let r = {
                let mut c = o.core();
                let svc = CursorMaker::new(&c.user_data);
                let Core { installer, library, .. } = &mut *c;
                svc.install(installer, library, &arg(args, 0), &drawn, &pictures, &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            match r {
                Ok(record) => json!({ "ok": true, "record": record }),
                Err(e) => json!({ "error": e }),
            }
        }
        _ => json!({ "error": "unknown channel" }),
    }
}
