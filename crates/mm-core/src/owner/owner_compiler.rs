//! Valve's resource compiler as the app finds and runs it (src/ipc-compiler.ts): found in the game
//! or picked in Settings, under Wine off Windows, and the copy of the Workshop Tools kept for when
//! Steam takes them away. The other studios compile through [`compile`].

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::i18n::t;
use crate::owner::{Core, Owner, R};
use crate::resource_compiler::{CompileJob, ResourceCompiler};
use crate::vpk::Entry;
use crate::workshop_tools::ToolsKeeper;

pub const CHANNELS: &[&str] = &[
    "compiler:state",
    "compiler:browse",
    "compiler:forget",
    "compiler:check",
    "compiler:keep",
    "compiler:removeKept",
    "compiler:prepare",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    let _ = args;
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel)))
}

/// The compiler as Settings has it now.
pub fn compiler(c: &Core) -> ResourceCompiler {
    let chosen = c.settings.get("resourceCompilerPath").filter(|v| crate::js::truthy(v)).map(crate::js::string);
    let mut rc = ResourceCompiler::new(&c.user_data, c.game(), chosen.map(PathBuf::from));
    if rc.needs_wine {
        let var = |k: &str| std::env::var(k).ok();
        rc.wine = crate::wine::find_wine(
            &var("PATH").unwrap_or_default(),
            &var("HOME").unwrap_or_default(),
            var("XDG_DATA_HOME").as_deref(),
        );
    }
    rc
}

/// Windows keeps its tools; elsewhere a copy is kept once they have been seen.
pub fn keeper(c: &Core) -> Option<ToolsKeeper> {
    (!cfg!(windows)).then(|| ToolsKeeper::new(&c.user_data.join("workshop-tools"), c.game()))
}

/// One job compiled with the app's compiler.
pub fn compile(c: &Core, job: &CompileJob, log: &mut dyn FnMut(String)) -> Result<Vec<Entry>, String> {
    let k = keeper(c);
    compiler(c).compile(job, k.as_ref(), &mut crate::run_process::run, log)
}

fn state(o: &Owner) -> Value {
    let c = o.core();
    let k = keeper(&c);
    let mut lines = Vec::new();
    let s = compiler(&c).state(k.as_ref(), &mut |m| lines.push(m));
    drop(c);
    for l in lines {
        o.diag(&l);
    }
    s
}

/// The compiler's state for the support report, its paths without the home folder.
pub fn state_for_report(o: &Owner) -> Value {
    crate::owner_support::redact_compiler(state(o))
}

/// The tools copied, with the bar counting it; whether it copied.
fn keep_tools(o: &Owner, force: bool) -> Result<bool, String> {
    let Some(k) = keeper(&o.core()) else { return Ok(false) };
    let label = t("Копия Workshop Tools", &[]);
    let mut lines = Vec::new();
    let r = k.keep(
        force,
        &mut |done, total| o.progress(json!({ "type": "count", "label": label, "done": done, "total": total })),
        &mut |m| lines.push(m),
    );
    for l in lines {
        o.diag(&l);
    }
    match &r {
        Ok(true) => o.progress(json!({ "type": "done", "label": label })),
        Ok(false) => {}
        Err(e) => {
            o.diag(&format!("workshop tools: no copy kept: {e}"));
            o.progress(json!({ "type": "error", "label": label, "message": e }));
        }
    }
    r
}

fn answer(o: &Owner, channel: &str) -> Value {
    match channel {
        "compiler:state" => state(o),
        "compiler:browse" => {
            let res = o.shell.request(
                "dialog.open",
                vec![json!({
                    "title": t("Выбери resourcecompiler.exe в папке game/bin/win64 игры с Workshop Tools", &[]),
                    "properties": ["openFile"],
                    "filters": [{ "name": "resourcecompiler.exe", "extensions": ["exe"] }],
                })],
            );
            let res = match res {
                Ok(r) => r,
                Err(e) => return json!({ "error": e }),
            };
            let first = res.get("filePaths").and_then(Value::as_array).and_then(|a| a.first()).map(crate::js::string);
            let Some(exe) = first.filter(|f| !f.is_empty() && res.get("canceled") != Some(&Value::Bool(true))) else {
                return Value::Null;
            };
            if crate::resource_compiler::install_of(Some(std::path::Path::new(&exe))).is_none() {
                return json!({ "error": t("Это не resourcecompiler.exe из папки game/bin/win64 установленной Dota 2", &[]) });
            }
            if let Err(e) = o.core().settings.set("resourceCompilerPath", json!(exe)) {
                return json!({ "error": e.to_string() });
            }
            o.diag(&format!("compiler: picked {exe}"));
            json!({ "ok": true, "state": state(o) })
        }
        "compiler:forget" => {
            if let Err(e) = o.core().settings.set("resourceCompilerPath", Value::Null) {
                return json!({ "error": e.to_string() });
            }
            json!({ "ok": true, "state": state(o) })
        }
        "compiler:check" => {
            let label = t("Проверка компилятора", &[]);
            let wine = compiler(&o.core()).needs_wine;
            let steps: Vec<&str> = if wine { vec!["wine", "compile"] } else { vec!["compile"] };
            o.progress(json!({ "type": "count", "label": label, "done": 0, "total": steps.len() }));
            let mut lines = Vec::new();
            let result = {
                let c = o.core();
                let k = keeper(&c);
                compiler(&c).check(
                    k.as_ref(),
                    &mut crate::run_process::run,
                    &mut |step| {
                        let what = if step == "wine" { t("подготовка Wine", &[]) } else { t("сборка пустой модели", &[]) };
                        let done = steps.iter().position(|s| *s == step).map_or(-1, |i| i as i64);
                        o.progress(json!({ "type": "count", "label": format!("{label}: {what}"), "done": done, "total": steps.len() }));
                    },
                    &mut |m| lines.push(m),
                )
            };
            for l in lines {
                o.diag(&l);
            }
            let ok = result.get("ok") == Some(&Value::Bool(true));
            let message = result.get("message").filter(|m| crate::js::truthy(m)).cloned().unwrap_or(json!(""));
            o.progress(if ok {
                json!({ "type": "done", "label": label })
            } else {
                json!({ "type": "error", "label": label, "message": message })
            });
            let now = state(o);
            if ok && now.get("source").and_then(Value::as_str) == Some("game") {
                let _ = keep_tools(o, false);
            }
            if ok {
                json!({ "ok": true, "state": now })
            } else {
                json!({ "error": result.get("message").cloned().unwrap_or(Value::Null), "state": now })
            }
        }
        "compiler:keep" => match keep_tools(o, true) {
            Ok(_) => json!({ "ok": true, "state": state(o) }),
            Err(e) => json!({ "error": e, "state": state(o) }),
        },
        "compiler:removeKept" => {
            if let Some(k) = keeper(&o.core()) {
                let _ = k.remove();
            }
            json!({ "ok": true, "state": state(o) })
        }
        "compiler:prepare" => {
            let mut lines = Vec::new();
            let r = {
                let c = o.core();
                let k = keeper(&c);
                compiler(&c).prepare(k.as_ref(), &mut crate::run_process::run, &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            match r {
                Ok(_) => json!({ "ok": true, "state": state(o) }),
                Err(e) => {
                    o.diag(&format!("compiler: not ready: {e}"));
                    json!({ "error": e, "state": state(o) })
                }
            }
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}
