//! The window for background music of the user's own (looks/own_music_service.rs): the songs on
//! now, a song kept for the build, and the build with Valve's compiler.

use serde_json::{json, Value};

use crate::own_music_service::OwnMusic;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &["music:state", "music:keep", "music:install"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    match channel {
        "music:state" => {
            let mut v = OwnMusic::state(&o.core().library);
            v["ok"] = Value::Bool(true);
            v
        }
        "music:keep" => {
            let bytes = match crate::owner::bytes_of(&arg(args, 0)) {
                Ok(Some(b)) => b,
                Ok(None) => return json!({ "error": crate::i18n::t("Нужен MP3 или WAV", &[]) }),
                Err(e) => return json!({ "error": e }),
            };
            let c = o.core();
            match OwnMusic::new(&c.user_data, c.game()).keep(&bytes) {
                Ok(id) => json!({ "ok": true, "id": id }),
                Err(e) => json!({ "error": e }),
            }
        }
        "music:install" => {
            if let Some(stop) = o.blocked("install") {
                return stop;
            }
            let songs = arg(args, 0).as_array().cloned().unwrap_or_default();
            let on = |i: usize| arg(args, i) == Value::Bool(true);
            let places = crate::own_music_service::Places { menu: on(1), game: on(2) };
            let mut lines = Vec::new();
            let r = {
                let mut c = o.core();
                let svc = OwnMusic::new(&c.user_data, c.game());
                let (rc, k) = (crate::owner_compiler::compiler(&c), crate::owner_compiler::keeper(&c));
                let mut compile = |job: &crate::resource_compiler::CompileJob| {
                    rc.compile_together(job, k.as_ref(), &mut crate::run_process::run_low, &mut |_| {})
                };
                let Core { installer, library, .. } = &mut *c;
                let r = svc.install(installer, library, &songs, places, &mut compile, &mut |m| lines.push(m));
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
