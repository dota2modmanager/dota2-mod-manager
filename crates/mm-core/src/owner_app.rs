//! The app around the mods (src/ipc-misc.ts, ipc-launch.ts, ipc-window.ts): folders and the
//! download cache opened, a tool started, Dota started, the window's buttons, the version and what
//! changed in it, the star count on Home and the interface's scale.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::i18n::t;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "misc:openLangFolder",
    "misc:openToolsFolder",
    "misc:openExternal",
    "misc:cacheSize",
    "misc:clearCache",
    "misc:openCacheFolder",
    "misc:cacheList",
    "misc:cacheRemove",
    "misc:runTool",
    "game:launch",
    "win:minimize",
    "win:maximize",
    "win:close",
    "win:isMaximized",
    "update:fetchPortable",
    "update:revealPortable",
    "update:install",
    "app:version",
    "app:notes",
    "app:stars",
    "app:notesSeen",
    "ui:setZoom",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// A folder made if missing and shown in Explorer.
fn open_folder(o: &Owner, dir: Result<PathBuf, String>) -> Value {
    let run = || -> Result<(), String> {
        let dir = dir?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        o.shell.request("shell.openPath", vec![json!(dir.to_string_lossy())])?;
        Ok(())
    };
    match run() {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "error": e }),
    }
}

/// A tool folder this app installed, by the name its record gives it; None for anything else.
/// shell.openPath runs what it is handed, so a name like "../.." must not reach it.
fn tool_folder(c: &Core, name: &Value) -> Option<PathBuf> {
    let sub = if crate::js::truthy(name) { crate::js::string(name) } else { String::new() };
    let known = c.library.list().iter().any(|rec| {
        rec.get("files").and_then(Value::as_array).is_some_and(|fs| {
            fs.iter().any(|f| {
                f.get("root").and_then(Value::as_str) == Some("tools")
                    && f.get("relPath").and_then(Value::as_str) == Some(sub.as_str())
            })
        })
    });
    let tools = c.installer.tools_dir();
    let dir = PathBuf::from(crate::js::path_join(&[&tools.to_string_lossy(), &sub]));
    let parent_ok = dir.parent().map(|p| crate::js::path_join(&[&p.to_string_lossy()]))
        == Some(crate::js::path_join(&[&tools.to_string_lossy()]));
    (known && parent_ok).then_some(dir)
}

/// The first .exe under a folder, depth first in the order the disk lists them.
fn find_exe(dir: &Path) -> std::io::Result<Option<PathBuf>> {
    for entry in std::fs::read_dir(dir)? {
        let full = entry?.path();
        if full.is_dir() {
            if let Some(r) = find_exe(&full)? {
                return Ok(Some(r));
            }
        } else if full.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().ends_with(".exe")) {
            return Ok(Some(full));
        }
    }
    Ok(None)
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "misc:openLangFolder" => {
            let dir = o.core().installer.lang_folder();
            open_folder(o, dir)
        }
        "misc:openToolsFolder" => {
            let dir = {
                let c = o.core();
                if crate::js::truthy(&a0) {
                    tool_folder(&c, &a0)
                } else {
                    Some(c.installer.tools_dir())
                }
            };
            let Some(dir) = dir else { return json!({ "error": t("Инструмент не найден", &[]) }) };
            let _ = o.shell.request("shell.openPath", vec![json!(dir.to_string_lossy())]);
            json!({ "ok": true })
        }
        "misc:openExternal" => {
            // the address is parsed, not matched: the browser gets http and https and nothing else
            let text = crate::js::string(&a0);
            if url::Url::parse(&text).is_ok_and(|u| matches!(u.scheme(), "http" | "https")) {
                let _ = o.shell.request("shell.openExternal", vec![json!(text)]);
            }
            json!({ "ok": true })
        }
        "misc:cacheSize" => json!(o.core().installer.download_cache_size()),
        "misc:clearCache" => {
            o.core().installer.clear_download_cache();
            json!({ "ok": true })
        }
        "misc:openCacheFolder" => {
            let dir = o.core().installer.downloads_dir();
            open_folder(o, Ok(dir))
        }
        "misc:cacheList" => json!(o.core().installer.list_download_cache()),
        "misc:cacheRemove" => json!({ "ok": o.core().installer.remove_cached_download(&crate::js::string(&a0)) }),
        "misc:runTool" => {
            let Some(dir) = tool_folder(&o.core(), &a0) else {
                return json!({ "error": t("Инструмент не найден", &[]) });
            };
            match find_exe(&dir) {
                Ok(Some(exe)) => {
                    let _ = o.shell.request("shell.openPath", vec![json!(exe.to_string_lossy())]);
                    json!({ "ok": true })
                }
                Ok(None) => json!({ "error": t("exe не найден в папке инструмента", &[]) }),
                Err(e) => json!({ "error": e.to_string() }),
            }
        }
        "game:launch" => launch(o),
        "win:minimize" | "win:close" => {
            let _ = o.shell.request(if channel == "win:close" { "win.close" } else { "win.minimize" }, vec![]);
            Value::Null
        }
        "win:maximize" => {
            let now = is_maximized(o);
            let _ = o.shell.request(if now { "win.unmaximize" } else { "win.maximize" }, vec![]);
            json!(is_maximized(o))
        }
        "win:isMaximized" => json!(is_maximized(o)),
        // a Tauri build updates through its own updater; there is no portable copy to fetch beside it
        "update:fetchPortable" => json!({ "error": t("Это не портативная сборка", &[]) }),
        "update:revealPortable" => json!({ "error": t("Файл не найден", &[]) }),
        "update:install" => {
            let _ = o.shell.request("app.updateInstall", vec![]);
            Value::Null
        }
        "app:version" => json!(o.opts.app_version),
        "app:notes" => {
            let version = o.opts.app_version.clone();
            let seen = o.core().settings.get("lastSeenVersion").filter(|v| crate::js::truthy(v)).map(crate::js::string);
            let lang = crate::js::string(&a0);
            let notes = crate::app_info::release_notes(&version, &lang, &o.opts.app_root, seen.as_deref());
            json!({ "version": version, "notes": notes, "unseen": seen.as_ref().is_some_and(|s| *s != version) })
        }
        "app:stars" => stars(o),
        "app:notesSeen" => {
            let _ = o.core().settings.set("lastSeenVersion", json!(o.opts.app_version));
            json!({ "ok": true })
        }
        "ui:setZoom" => {
            let z = crate::main_window::clamp_zoom(&a0);
            let _ = o.core().settings.set("uiScale", crate::js::json_number(z));
            json!({ "ok": true, "uiScale": crate::js::json_number(z) })
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}

/// Whether the window fills the screen, as the shell knows it; false from one that cannot say.
fn is_maximized(o: &Owner) -> bool {
    o.shell.request("win.isMaximized", vec![]).ok().and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Dota started through Steam: the item table that is still building goes in first, and what a
/// Dota update broke is put right before the game reads it (src/ipc-launch.ts startDota).
fn launch(o: &Owner) -> Value {
    o.settled();
    o.heal();
    // a close seconds from now is a crash worth naming
    crate::owner_watch::launched(o);
    let _ = o.shell.request("shell.openExternal", vec![json!("steam://rungameid/570")]);
    let game = o.core().game();
    json!({ "ok": true, "warning": crate::steam_appstate::launch_warning(game.as_deref()) })
}

const STARS_API: &str = "https://api.github.com/repos/dota2modmanager/dota2-mod-manager";
const STARS_FRESH_MS: f64 = 6.0 * 60.0 * 60.0 * 1000.0;

/// The repository's star count for Home (src/repo-stars.ts): the cached one while it is six hours
/// fresh, otherwise asked for, the old one when GitHub does not answer.
fn stars(o: &Owner) -> Value {
    let (file, net) = {
        let c = o.core();
        (c.user_data.join("repo-stars.json"), c.net.clone())
    };
    let cached = std::fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|c| Some((c.get("stars")?.as_i64()?, c.get("at")?.as_f64()?)));
    let now = (o.opts.now)();
    if let Some((n, at)) = cached {
        if now - at < STARS_FRESH_MS {
            return json!(n);
        }
    }
    let old = cached.map(|c| json!(c.0)).unwrap_or(Value::Null);
    let Ok((status, body)) = net.direct("GET", STARS_API, &[("accept", "application/vnd.github+json")], None, 8000)
    else {
        return old;
    };
    if !(200..300).contains(&status) {
        return old;
    }
    let n = serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("stargazers_count")?.as_i64());
    let Some(n) = n else { return old };
    let _ = std::fs::write(&file, json!({ "stars": n, "at": crate::js::json_number(now) }).to_string());
    json!(n)
}
