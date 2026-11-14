//! The support report and the channels beside it (src/ipc-diagnostics.ts, the rest of
//! src/ipc-settings.ts): the zip a user sends when something does not work, the errors the window
//! reports on its own, the catalog as the window loads it, the Discord sign-in, and the proxy test.
//!
//! The report is gathered under the lock and written without it. What only the window's process
//! knows (its windows, the screens, the graphics card, the updater) is asked of the shell.

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::owner::{arg, Owner, R};

pub const CHANNELS: &[&str] =
    &["diag:rendererError", "diag:export", "catalog:load", "account:signIn", "settings:testProxy"];

/// The window's own errors kept for the report, newest last.
const RENDERER_ERRORS_KEPT: usize = 50;

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "diag:rendererError" => {
            // fire-and-forget: a crash the window cannot recover from still lands in the log
            let text: String =
                crate::js::string(&if crate::js::truthy(&a0) { a0 } else { json!("") }).chars().take(2000).collect();
            o.diag(&format!("renderer: {text}"));
            // kept apart as well: in the log they are twenty lines among two thousand
            let mut c = o.core();
            c.renderer_errors.push(json!({ "at": crate::mods_listing::iso_now(), "text": text }));
            let over = c.renderer_errors.len().saturating_sub(RENDERER_ERRORS_KEPT);
            c.renderer_errors.drain(..over);
            Value::Null
        }
        "diag:export" => export(o).unwrap_or_else(|e| json!({ "error": e })),
        "catalog:load" => {
            let c = o.core();
            match c.catalog.load(&c.net, crate::js::truthy(&a0)) {
                Ok(data) => data,
                // the kind of failure travels with the words: the screen says "you are offline"
                // instead of printing a socket error at somebody who turned their wifi off
                Err(e) => json!({ "error": e, "offline": offline(&e) }),
            }
        }
        "account:signIn" => sign_in(o).unwrap_or_else(|e| json!({ "error": e })),
        "settings:testProxy" => crate::net_fetch::test_download_proxy(&a0),
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}

/// Whether a catalog that could not be had failed for want of a network: not a server's answer,
/// not a signature, not a file that did not parse.
fn offline(e: &str) -> bool {
    !(crate::net_fetch::is_http_error(e) || e.contains("signature") || e.contains("JSON"))
}

fn sign_in(o: &Owner) -> Result<Value, String> {
    let net = o.core().net.clone();
    // the wait for the browser runs without the lock: it can take a minute
    let open = |url: &str| o.shell.request("shell.openExternal", vec![json!(url)]).map(|_| ());
    let account = crate::discord_auth::sign_in(&net, &crate::discord_auth::Endpoints::default(), &open)?;
    o.core().settings.set("account", account.clone()).map_err(|e| e.to_string())?;
    let _ = o.shell.request("win.show", vec![]);
    let _ = o.shell.request("win.focus", vec![]);
    Ok(json!({ "ok": true, "account": account }))
}

/// `os.platform() os.release() os.arch()` as far as Rust knows them.
fn platform() -> String {
    let os = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    format!("{os} {arch}")
}

/// A path with the home folder taken out; nothing stays nothing.
fn redacted(v: &Value) -> Value {
    match v.as_str() {
        Some(p) if !p.is_empty() => json!(crate::diagnostics::redact_home(p, None)),
        _ => v.clone(),
    }
}

/// What the report is built from, read under the lock.
fn inputs(o: &Owner) -> crate::diagnostics::ReportInputs {
    let now = (o.opts.now)();
    let running = (o.opts.dota_running)();
    // what only the window's process knows: its windows, the screens, the graphics card, the updater
    let shell = o.shell.request("win.report", vec![]).unwrap_or(Value::Null);
    let shell_field = |k: &str| shell.get(k).cloned().unwrap_or(Value::Null);
    let compiler = crate::owner_compiler::state_for_report(o);
    let c = o.core();
    let settings = c.settings.all();
    let lang = settings.get("uiLang").and_then(Value::as_str).filter(|l| !l.is_empty()).unwrap_or("en").to_string();
    let records = c.library.list().to_vec();
    let enabled: Vec<crate::installer_slots::CoverageMod> = records
        .iter()
        .filter(|r| r.get("enabled") != Some(&Value::Bool(false)))
        .map(|r| crate::installer_slots::CoverageMod {
            key: r.get("id").cloned().unwrap_or(Value::Null),
            name: r.get("name").cloned().unwrap_or(Value::Null),
            files: r.get("files").and_then(Value::as_array).cloned().unwrap_or_default(),
        })
        .collect();
    let switches: Map<String, Value> = crate::remote_config::SWITCHABLE
        .iter()
        .map(|k| {
            let (off, note) = c.remote.feature(k, &lang);
            (k.to_string(), json!({ "off": off, "note": note }))
        })
        .collect();
    let updater = match shell.get("updater") {
        Some(u) if !u.is_null() => u.clone(),
        // a shell that does not say has its updater: a Tauri build always carries one
        _ => json!({ "available": true, "lastError": null }),
    };
    let update_error = updater.get("lastError").cloned().unwrap_or(Value::Null);
    let mut extra = Map::new();
    extra.insert("dotaRunning".into(), json!(running));
    extra.insert("rendererErrors".into(), json!(c.renderer_errors));
    extra.insert("windows".into(), shell_field("windows"));
    extra.insert("displays".into(), shell_field("displays"));
    extra.insert("gpu".into(), shell_field("gpu"));
    extra.insert("updater".into(), updater);
    extra.insert(
        "remoteConfig".into(),
        json!({
            "url": crate::remote_config::CONFIG_URL,
            "switches": switches,
            "notices": c.remote.notices(&lang).len(),
        }),
    );
    extra.insert("toolchain".into(), crate::toolchain::Toolchain::new(&c.user_data, None).state());
    extra.insert("compiler".into(), compiler);
    let log_file = c.user_data.join("logs").join("app.log");
    let mirrors = json!(c.net.chain().mirror_health(now));
    crate::diagnostics::ReportInputs {
        presets: c.library.list_presets().len(),
        coverage: Some(c.installer.coverage(&enabled).len() as f64),
        slots: records.iter().map(|r| c.installer.slot_number(r).map(f64::from)).collect(),
        records,
        download_cache: json!(c.installer.download_cache_size()),
        icon_size: Some(json!(c.game_icons.size())),
        schema_state: Ok(crate::schema_service::state(&c.installer, &c.library, &c.settings, true)),
        catalog_cache: c.catalog.cache_info(),
        mirrors,
        version: o.opts.app_version.clone(),
        platform: platform(),
        node: String::new(),
        log_file: Some(log_file.to_string_lossy().into_owned()),
        user_data_dir: Some(c.user_data.to_string_lossy().into_owned()),
        update_error,
        extra,
        home: None,
        generated_at: crate::mods_listing::iso_now(),
        settings,
    }
}

/// One button, and inside the archive two reports for two readers: SUMMARY.txt opens with whether
/// anything is wrong at all, REPORT.md leaves nothing out, report.json keeps the raw shape.
fn export(o: &Owner) -> Result<Value, String> {
    let i = inputs(o);
    let (report, files) = crate::diagnostics::build_report(i);
    let stamp: String = crate::mods_listing::iso_now().replace([':', '.'], "-").chars().take(19).collect();
    // MM_DIAG_OUT writes the archive straight there: a report only a click through a save dialog
    // can produce is a report nobody checks after changing it
    let straight = std::env::var("MM_DIAG_OUT").ok().filter(|p| !p.is_empty());
    let to = match &straight {
        Some(p) => p.clone(),
        None => {
            let res = o.shell.request(
                "dialog.save",
                vec![json!({
                    "title": t("Сохранить отчёт для поддержки", &[]),
                    "defaultPath": format!("dota2-mod-manager-diag-{stamp}.zip"),
                    "filters": [{ "name": t("Отчёт диагностики", &[]), "extensions": ["zip"] }],
                })],
            )?;
            let picked = res.get("filePath").filter(|v| crate::js::truthy(v)).map(crate::js::string);
            match picked {
                Some(p) if res.get("canceled") != Some(&Value::Bool(true)) => p,
                _ => return Ok(json!({ "cancelled": true })),
            }
        }
    };
    let mut entries: Vec<(String, Vec<u8>)> = vec![
        ("SUMMARY.txt".into(), crate::diagnostics::render_summary(&report).into_bytes()),
        ("REPORT.md".into(), crate::diagnostics::render_detailed(&report, &files).into_bytes()),
        ("report.json".into(), crate::js::stringify(&report, "  ").into_bytes()),
    ];
    entries.extend(files.iter().map(|(name, text)| (name.clone(), text.clone().into_bytes())));
    if let Ok(manifest) = std::fs::read(o.opts.user_data.join("manifest.json")) {
        entries.push(("manifest.json".into(), manifest));
    }
    let zip = crate::safe_zip::write_zip(&entries)?;
    std::fs::write(&to, zip).map_err(|e| e.to_string())?;
    if straight.is_none() {
        let _ = o.shell.request("shell.showItemInFolder", vec![json!(to)]);
    }
    Ok(json!({ "ok": true, "path": to }))
}

/// The compiler's paths, for the report: with the home folder taken out, as the game's is.
pub fn redact_compiler(st: Value) -> Value {
    let mut st = st;
    if let Some(m) = st.as_object_mut() {
        for k in ["exe", "wine"] {
            if let Some(v) = m.get(k).cloned() {
                m.insert(k.into(), redacted(&v));
            }
        }
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_failure_to_connect_is_offline() {
        assert!(offline("getaddrinfo ENOTFOUND raw.githubusercontent.com"));
        assert!(!offline("HTTP 404 from raw.githubusercontent.com"));
        assert!(!offline("mods.json: signature does not match the catalog's key"));
    }

    #[test]
    fn the_compiler_keeps_nothing_as_nothing() {
        let st = redact_compiler(json!({ "exe": null, "wine": "", "ok": true }));
        assert_eq!(st, json!({ "exe": null, "wine": "", "ok": true }));
    }
}
