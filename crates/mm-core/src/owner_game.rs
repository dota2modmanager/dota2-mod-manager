//! The state of the game and what shapes it (src/ipc-game.ts): what the remote config says, the
//! search-path patch and its repair after a Dota update, the item table, free cosmetics, the
//! Source 2 toolchain, and the arcanas and map looks built out of the game's own files.

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "game:steamDownloads",
    "game:steamProperties",
    "config:state",
    "config:noticeSeen",
    "patch:state",
    "patch:repairState",
    "patch:repairNow",
    "patch:repairApp",
    "patch:repairSeen",
    "patch:setEnabled",
    "schema:refresh",
    "schema:cancel",
    "cosmetics:slots",
    "cosmetics:pick",
    "cosmetics:pickSet",
    "tools:state",
    "tools:install",
    "tools:remove",
    "arcana:state",
    "arcana:install",
    "map:state",
    "map:install",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// `{ ok: true, ...value }`, or `{ error }`.
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

fn ui_lang(c: &Core) -> &'static str {
    if c.settings.get("uiLang").and_then(Value::as_str) == Some("ru") {
        "ru"
    } else {
        "en"
    }
}

/// What Steam is doing to the game that a repair would land under, if anything.
fn steam_busy(game: Option<&Path>) -> Option<&'static str> {
    crate::steam_appstate::steam_work(crate::steam_appstate::read_app_state(game).as_ref())
}

/// Repair after a patch (src/game-repair.ts repairAfterPatch): the window is told what came of it,
/// and while Dota or Steam holds the game the repair looks again in a while.
pub fn repair_after_patch(o: &Owner, reason: Value) {
    let running = (o.opts.dota_running)();
    let now = (o.opts.now)();
    let mut lines: Vec<String> = Vec::new();
    let (after, gen) = {
        let mut core = o.core();
        let c = &mut *core;
        c.repair_gen += 1;
        let gen = c.repair_gen;
        let steam = if running { None } else { steam_busy(c.game().as_deref()) };
        let mut log = |m: String| lines.push(m);
        let mut diag: Vec<String> = Vec::new();
        let mut deployed = |_: std::collections::HashSet<String>| {};
        let after = {
            let mut ctx = crate::schema_service::Ctx {
                inst: &c.installer,
                lib: &mut c.library,
                settings: &mut c.settings,
                bases: None,
                log: &mut log,
                on_deployed: &mut deployed,
            };
            c.upkeep.repair.repair_after_patch(
                &mut c.schema,
                &mut ctx,
                None,
                None,
                Some(reason.clone()),
                (running, steam),
                now,
                &mut |m| diag.push(m),
            )
        };
        lines.extend(diag);
        (after, gen)
    };
    for l in lines {
        o.diag(&l);
    }
    if let Some(sent) = &after.sent {
        o.shell.event("patch-repair", vec![sent.clone()]);
    }
    if after.rebuild {
        drop(o.refresh_schema_in_background());
    }
    if after.retry {
        if let Some(me) = o.me() {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(crate::game_repair::REPAIR_RETRY_MS));
                // a repair asked for since then took this one's place
                if me.core().repair_gen == gen {
                    repair_after_patch(&me, reason);
                }
            });
        }
    }
}

fn set_patch_repair(o: &Owner, next: Value) -> Value {
    let sent = o.core().upkeep.repair.set_patch_repair(next);
    o.shell.event("patch-repair", vec![sent.clone()]);
    sent
}

fn patch_repair(o: &Owner) -> Value {
    o.core().upkeep.repair.patch_repair().clone()
}

fn state_of(v: &Value) -> &str {
    v.get("state").and_then(Value::as_str).unwrap_or("")
}

/// Settings' "Repair the app" (src/app-repair.ts): the patch, the mod files, the pictures, a line each.
fn repair_app(o: &Owner) -> Value {
    let mut steps = Vec::new();
    repair_after_patch(o, json!("manual"));
    let r = patch_repair(o);
    let game = match state_of(&r) {
        "waiting" => json!({ "ok": false, "text": t("Dota 2 запущена: закрой игру и нажми ещё раз", &[]) }),
        "failed" => {
            let err = r.get("error").filter(|e| crate::js::truthy(e)).map(crate::js::string);
            json!({ "ok": false, "text": err.unwrap_or_else(|| t("Не удалось вернуть патч игры", &[])) })
        }
        _ => {
            let healed = r.get("healed").and_then(Value::as_array).is_some_and(|h| !h.is_empty());
            json!({ "ok": true, "text": if healed { t("Патч игры возвращён", &[]) } else { t("Патч игры на месте", &[]) } })
        }
    };
    steps.push(with_id("game", game));

    let missing: Vec<Value> = {
        let c = o.core();
        c.library
            .list()
            .iter()
            .filter(|r| r.get("enabled") != Some(&Value::Bool(false)))
            .filter(|r| {
                r.get("files").and_then(Value::as_array).is_some_and(|fs| {
                    fs.iter().any(|f| {
                        f.get("root").and_then(Value::as_str) == Some("lang")
                            && f.get("relPath").and_then(Value::as_str).is_some_and(|rel| {
                                !c.installer.lang_file_on_disk(rel).map(|p| p.exists()).unwrap_or(false)
                            })
                    })
                })
            })
            .map(|r| r.get("name").cloned().unwrap_or(Value::Null))
            .collect()
    };
    steps.push(with_id(
        "files",
        if missing.is_empty() {
            json!({ "ok": true, "text": t("Файлы всех модов на месте", &[]) })
        } else {
            json!({
                "ok": false,
                "text": t("Файлов нет в папке модов: {0}. Удали и поставь их заново", &[json!(missing.len())]),
                "mods": missing,
            })
        },
    ));

    {
        let c = o.core();
        // the catalog's pictures, the game's and the mods' previews all live under icons/
        let dir = c.user_data.join("icons");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        c.game_icons.clear();
        c.wiki.clear();
    }
    steps.push(with_id(
        "caches",
        json!({ "ok": true, "text": t("Картинки и превью очищены, приложение соберёт их заново", &[]) }),
    ));

    // its lines are the news: a banner in My mods saying it again would be about a patch that did not happen
    if state_of(&patch_repair(o)) == "done" {
        set_patch_repair(o, json!({ "state": "idle" }));
    }
    json!(steps)
}

fn with_id(id: &str, step: Value) -> Value {
    let mut out = Map::new();
    out.insert("id".into(), json!(id));
    if let Some(s) = step.as_object() {
        out.extend(s.clone());
    }
    Value::Object(out)
}

fn set_enabled(o: &Owner, on: bool) -> Value {
    // turning it OFF is always allowed: a switch that traps people in the state it broke is
    // worse than the problem it was flipped for
    if on {
        if let Some(stop) = o.blocked("cosmetics") {
            return stop;
        }
    }
    if o.core().game().is_none() {
        return json!({ "error": t("Путь к Dota 2 не задан", &[]) });
    }
    // the game holds gameinfo open while it runs, so writing it would fail half-way
    if (o.opts.dota_running)() {
        return json!({ "error": t("Закрой Dota 2 перед изменением файлов игры", &[]) });
    }
    let mut lines: Vec<String> = Vec::new();
    let out = {
        let mut core = o.core();
        let c = &mut *core;
        let mut log = |m: String| lines.push(m);
        let mut deployed = |_: std::collections::HashSet<String>| {};
        let mut ctx = crate::schema_service::Ctx {
            inst: &c.installer,
            lib: &mut c.library,
            settings: &mut c.settings,
            bases: None,
            log: &mut log,
            on_deployed: &mut deployed,
        };
        c.schema.set_enabled(&mut ctx, on)
    };
    for l in lines {
        o.diag(&l);
    }
    out
}

/// The tool fetched, the bar counting it (src/toolchain.ts ensure). The lock is not held: the
/// toolchain lives in its own folder.
fn install_tool(o: &Owner, name: &str) -> Value {
    let (ud, net) = {
        let c = o.core();
        (c.user_data.clone(), c.net.clone())
    };
    let tc = crate::toolchain::Toolchain::new(&ud, None);
    let now = (o.opts.now)();
    let github_down = net.chain().stood_down("raw.githubusercontent.com", now);
    let mut get = |url: &str, dest: &Path, sha: &str, on: &mut dyn FnMut(u64, u64)| -> Result<(u64, String), String> {
        let d = net
            .download_file(
                url,
                dest,
                crate::net_fetch::DownloadOptions {
                    on_progress: Some(on),
                    expect_sha256: (!sha.is_empty()).then(|| sha.to_string()),
                    from_published_list: false,
                    log: None,
                },
            )
            .map_err(|e| e.message)?;
        Ok((d.bytes, d.sha256))
    };
    let mut lines = Vec::new();
    let r = tc.ensure(name, &mut get, github_down, &mut |evt| o.progress(evt), &mut |m| lines.push(m));
    for l in lines {
        o.diag(&l);
    }
    match r {
        Ok(_) => json!({ "ok": true, "tools": tc.state() }),
        Err(e) => json!({ "error": e }),
    }
}

fn tool_name(v: &Value) -> String {
    if crate::js::truthy(v) {
        crate::js::string(v)
    } else {
        "vrf".into()
    }
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "game:steamDownloads" | "game:steamProperties" => {
            let to =
                if channel == "game:steamDownloads" { "steam://open/downloads" } else { "steam://gameproperties/570" };
            let _ = o.shell.request("shell.openExternal", vec![json!(to)]);
            json!({ "ok": true })
        }
        "config:state" => {
            let c = o.core();
            let lang = ui_lang(&c);
            let mut features = Map::new();
            for n in crate::remote_config::SWITCHABLE {
                let (off, note) = c.remote.feature(n, lang);
                features.insert((*n).into(), json!({ "off": off, "note": note }));
            }
            json!({
                "features": features,
                "notices": c.remote.notices(lang),
                "issues": c.remote.issues(lang),
                "seen": c.settings.get("seenNotices").filter(|v| crate::js::truthy(v)).cloned().unwrap_or(json!([])),
            })
        }
        "config:noticeSeen" => {
            let mut c = o.core();
            let mut seen: Vec<String> = Vec::new();
            for v in c.settings.get("seenNotices").and_then(Value::as_array).cloned().unwrap_or_default() {
                let s = crate::js::string(&v);
                if !seen.contains(&s) {
                    seen.push(s);
                }
            }
            let id = crate::js::string(&a0);
            if !seen.contains(&id) {
                seen.push(id);
            }
            // an id list that only grows is a settings file that only grows
            let kept: Vec<String> = seen[seen.len().saturating_sub(50)..].to_vec();
            let _ = c.settings.set("seenNotices", json!(kept));
            json!(seen)
        }
        "patch:state" => {
            let c = o.core();
            crate::schema_service::state(&c.installer, &c.library, &c.settings, true)
        }
        "patch:repairState" => patch_repair(o),
        "patch:repairNow" => {
            repair_after_patch(o, json!("manual"));
            patch_repair(o)
        }
        "patch:repairApp" => repair_app(o),
        "patch:repairSeen" => {
            let now = patch_repair(o);
            if matches!(state_of(&now), "done" | "failed") {
                set_patch_repair(o, json!({ "state": "idle" }));
            }
            patch_repair(o)
        }
        "patch:setEnabled" => set_enabled(o, crate::js::truthy(&a0)),
        "schema:refresh" => o.refresh_schema_in_background().recv().unwrap_or(Value::Null),
        "schema:cancel" => {
            // the build stops first: it holds the state until it does
            let stopped = o.cancel_builds();
            let mut lines = Vec::new();
            let r = {
                let mut core = o.core();
                let c = &mut *core;
                c.undo.cancel(&c.installer, &mut c.library, &mut c.settings, || stopped, &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            match r {
                Ok(u) => serde_json::to_value(u).unwrap_or(Value::Null),
                Err(e) => json!({ "ok": false, "reason": "failed", "error": e }),
            }
        }
        "cosmetics:slots" => {
            let mut core = o.core();
            let c = &mut *core;
            let game = c.game();
            let text = match game.as_deref().map(|g| c.schema.vanilla(g)) {
                None => return json!({ "slots": [], "sets": [] }),
                Some(Err(e)) => return json!({ "slots": [], "sets": [], "error": e }),
                Some(Ok(b)) => b,
            };
            crate::schema_cosmetics::cosmetic_slots(&c.library, game.as_deref(), &text.0, crate::i18n::lang().code())
        }
        "cosmetics:pick" => {
            if let Some(stop) = o.blocked("cosmetics") {
                return stop;
            }
            let effect = arg(args, 3);
            let picked = crate::schema_cosmetics::pick_cosmetic(
                &mut o.core().library,
                &crate::js::string(&a0),
                &crate::js::string(&arg(args, 1)),
                arg(args, 2).as_str(),
                Some(&effect),
            );
            match picked {
                Ok(rec) => {
                    let _ = o.refresh_schema_in_background().recv();
                    json!({ "ok": true, "record": rec })
                }
                Err(e) => json!({ "error": e }),
            }
        }
        "cosmetics:pickSet" => {
            if let Some(stop) = o.blocked("cosmetics") {
                return stop;
            }
            let style = crate::js::to_number(&arg(args, 1));
            let picked = {
                let mut core = o.core();
                let c = &mut *core;
                match c.game() {
                    None => Err(t("Путь к Dota 2 не задан", &[])),
                    Some(g) => c.schema.vanilla(&g).and_then(|b| {
                        crate::schema_cosmetics::pick_set(
                            &mut c.library,
                            &b.0,
                            &crate::js::string(&a0),
                            if style.is_finite() { style } else { 0.0 },
                        )
                    }),
                }
            };
            match picked {
                Ok((applied, pieces)) => {
                    let _ = o.refresh_schema_in_background().recv();
                    json!({ "ok": true, "applied": applied, "pieces": pieces })
                }
                Err(e) => json!({ "error": e }),
            }
        }
        "tools:state" => {
            let c = o.core();
            let tc = crate::toolchain::Toolchain::new(&c.user_data, None);
            let previews = crate::folder_size::folder_size(&c.user_data.join("icons").join("mods"));
            json!({ "tools": tc.state(), "iconCacheBytes": c.game_icons.size() + previews })
        }
        "tools:install" => install_tool(o, &tool_name(&a0)),
        "tools:remove" => {
            let c = o.core();
            let tc = crate::toolchain::Toolchain::new(&c.user_data, None);
            let _ = tc.remove(&tool_name(&a0));
            // the pictures it produced are only reachable through it
            c.game_icons.clear();
            let _ = std::fs::remove_dir_all(c.user_data.join("icons").join("mods"));
            json!({ "ok": true, "tools": tc.state() })
        }
        "arcana:state" => {
            let mut lines = Vec::new();
            let s = {
                let mut core = o.core();
                let c = &mut *core;
                let game = c.game();
                c.kept.arcana(&game).state(&c.library, &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            spread(Ok(s))
        }
        "arcana:install" => {
            if let Some(stop) = o.blocked("install") {
                return stop;
            }
            let mut lines = Vec::new();
            let r = {
                let mut core = o.core();
                let c = &mut *core;
                let game = c.game();
                let svc = c.kept.arcana(&game);
                let r =
                    svc.install(&c.installer, &mut c.library, (&a0, &arg(args, 1), &arg(args, 2)), None, &mut |m| {
                        lines.push(m)
                    });
                if r.is_ok() {
                    crate::owner_packs::after_deploy_master(c);
                }
                r
            };
            for l in lines {
                o.diag(&l);
            }
            match r {
                Ok(record) => {
                    // the window does not wait on the table, the bar at the bottom counts it
                    drop(o.refresh_schema_in_background());
                    json!({ "ok": true, "record": record })
                }
                Err(e) => json!({ "error": e }),
            }
        }
        "map:state" => {
            let mut lines = Vec::new();
            let s = {
                let c = o.core();
                crate::map_looks_service::MapLooks::new(c.game()).state(&c.library, &mut |m| lines.push(m))
            };
            for l in lines {
                o.diag(&l);
            }
            spread(Ok(s))
        }
        "map:install" => {
            if let Some(stop) = o.blocked("install") {
                return stop;
            }
            let mut lines = Vec::new();
            let r = {
                let mut core = o.core();
                let c = &mut *core;
                let svc = crate::map_looks_service::MapLooks::new(c.game());
                let r = svc
                    .install(&c.installer, &mut c.library, (&a0, &arg(args, 1), &arg(args, 2)), &mut |m| lines.push(m));
                if r.is_ok() {
                    crate::owner_packs::after_deploy_master(c);
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
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}
