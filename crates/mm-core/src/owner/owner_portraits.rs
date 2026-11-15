//! The window for a hero's portrait in the hero picker of the user's own
//! (looks/hero_portrait_service.rs): every hero and what of his is on, one hero's sizes and
//! movies, and a portrait put on or taken off. The Rust core alone answers these.

use serde_json::{json, Map, Value};

use crate::hero_portrait_service::HeroPortraits;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &["portraits:state", "portraits:hero", "portraits:set"];

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

fn service(c: &Core) -> HeroPortraits {
    HeroPortraits::new(&c.user_data, c.game())
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let s = |i: usize| crate::js::string(&arg(args, i));
    match channel {
        "portraits:state" => {
            let c = o.core();
            spread(service(&c).state(&c.library))
        }
        "portraits:hero" => {
            let c = o.core();
            spread(service(&c).hero(&c.library, &s(0)))
        }
        "portraits:set" => {
            if let Some(stop) = o.blocked("install") {
                return stop;
            }
            let movie = match crate::owner::bytes_of(&arg(args, 2)) {
                Ok(b) => b,
                Err(e) => return json!({ "error": e }),
            };
            // [{ path, png }] as the window sends them, by path
            let stills: Map<String, Value> = arg(args, 1)
                .as_array()
                .map(|a| a.iter().map(|x| (crate::js::string(&x["path"]), x["png"].clone())).collect())
                .unwrap_or_default();
            let drop: Vec<String> = arg(args, 3)
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                .unwrap_or_default();
            let source = if crate::js::truthy(&arg(args, 4)) { s(4) } else { String::new() };
            let mut lines = Vec::new();
            let r = {
                let mut c = o.core();
                let svc = service(&c);
                let Core { installer, library, .. } = &mut *c;
                let r = svc
                    .set(installer, library, &s(0), &stills, movie.as_deref(), &drop, &source, &mut |m| lines.push(m));
                if r.is_ok() {
                    crate::owner_packs::after_deploy_master(&c);
                }
                r
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
