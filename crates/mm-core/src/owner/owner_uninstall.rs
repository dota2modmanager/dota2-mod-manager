//! The uninstaller's window (src/uninstall-window.ts) as the owner answers it: what there is to
//! remove, the removal, and the answer back to the uninstaller as the exit code. The thinking is
//! in uninstall.rs; the window and its close (which counts as cancelling) are the shell's.

use serde_json::{json, Value};

use crate::owner::{arg, Core, Owner, R};
use crate::uninstall::{UNINSTALL_CANCELLED, UNINSTALL_WIPE_DATA};

pub const CHANNELS: &[&str] = &["uninstall:plan", "uninstall:run", "uninstall:done", "uninstall:cancel"];

/// Only a run the uninstaller started answers these: in the app they would end it.
pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    (o.opts.uninstall && CHANNELS.contains(&channel)).then(|| Ok(answer(o, channel, args)))
}

fn exit(o: &Owner, code: i32) {
    let _ = o.shell.request("app.exit", vec![json!(code)]);
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "uninstall:plan" => {
            let c = o.core();
            json!(crate::uninstall::plan(&c.installer, &c.library, &c.settings, &c.user_data))
        }
        "uninstall:run" => {
            let on = |k: &str| a0.get(k).is_some_and(crate::js::truthy);
            let mut lines = Vec::new();
            let errors = {
                let mut c = o.core();
                let Core { installer, library, settings, schema, .. } = &mut *c;
                let log = std::cell::RefCell::new(&mut lines);
                crate::uninstall::run(installer, library, settings, schema, on("revert"), on("mods"), &|m| {
                    log.borrow_mut().push(m.to_string())
                })
            };
            for l in lines {
                o.diag(&l);
            }
            json!({ "ok": true, "errors": errors })
        }
        // the exit code is the whole answer: whether to stop, and whether the app's folder goes too
        "uninstall:done" => {
            exit(o, if crate::js::truthy(&a0) { UNINSTALL_WIPE_DATA } else { 0 });
            Value::Null
        }
        "uninstall:cancel" => {
            exit(o, UNINSTALL_CANCELLED);
            Value::Null
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}
