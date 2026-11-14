//! The small studios the app builds mods in (src/ipc-hud.ts, ipc-decor.ts, ipc-background.ts,
//! ipc-pumpkin.ts, ipc-grid.ts, ipc-looks.ts): each a state to draw and an install that puts one
//! generated record in My mods. The building itself lives in the services named below.

use std::cell::Cell;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "hud:state",
    "hud:install",
    "decor:state",
    "decor:install",
    "background:state",
    "background:install",
    "pumpkin:redeem",
    "pumpkin:prizeAgain",
    "pumpkin:hasPrize",
    "grid:state",
    "grid:apply",
    "grid:remove",
    "cosmetics:wearLook",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// `{ ok: true, ...state }`, or `{ error }`.
fn ok_with(r: Result<Value, String>) -> Value {
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

/// An install's answer: the record, after the master switch had its say on the fresh files.
fn installed(o: &Owner, build: impl FnOnce(&mut Core, &mut dyn FnMut(String)) -> Result<Value, String>) -> Value {
    if let Some(stop) = o.blocked("install") {
        return stop;
    }
    let mut lines = Vec::new();
    let r = {
        let mut c = o.core();
        let r = build(&mut c, &mut |m| lines.push(m));
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

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "hud:state" => {
            let c = o.core();
            ok_with(Ok(crate::hud_scale_service::HudScale::new(c.game()).state(&c.installer, &c.library)))
        }
        "hud:install" => installed(o, |c, log| {
            let svc = crate::hud_scale_service::HudScale::new(c.game());
            let Core { installer, library, .. } = c;
            svc.install(installer, library, &a0, log)
        }),
        "decor:state" => {
            let c = o.core();
            ok_with(crate::map_decor::MapDecor::new(c.game()).state(&c.installer, &c.library))
        }
        "decor:install" => installed(o, |c, log| {
            let svc = crate::map_decor::MapDecor::new(c.game());
            let Core { installer, library, .. } = c;
            svc.install(installer, library, &a0, log)
        }),
        "background:state" => ok_with(Ok(crate::menu_background_service::MenuBackground::state(&o.core().library))),
        "background:install" => {
            let webm = match crate::owner::bytes_of(&a0) {
                Ok(b) => b,
                Err(e) => return json!({ "error": e }),
            };
            let none = Value::Null;
            let at = |i: usize| args.get(i).unwrap_or(&none);
            installed(o, |c, log| {
                let svc = crate::menu_background_service::MenuBackground::new(&c.user_data, c.game());
                let Core { installer, library, .. } = c;
                svc.install(installer, library, webm.as_deref(), (at(1), at(2), at(3)), log)
            })
        }
        "pumpkin:redeem" | "pumpkin:prizeAgain" => pumpkin(o, channel, &a0),
        "pumpkin:hasPrize" => json!(crate::pumpkin::Pumpkin::has_prize(&o.core().library)),
        "grid:state" => grids(o).state(),
        "grid:apply" | "grid:remove" => {
            if (o.opts.dota_running)() {
                return json!({ "error": t("Закрой Dota 2: при выходе она перепишет файл сеток", &[]) });
            }
            let g = grids(o);
            ok_with(if channel == "grid:apply" {
                let kinds: Vec<String> = a0
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                    .unwrap_or_default();
                g.apply(&kinds)
            } else {
                g.remove()
            })
        }
        "cosmetics:wearLook" => {
            if let Some(stop) = o.blocked("cosmetics") {
                return stop;
            }
            let hero = a0.as_str().unwrap_or("").to_string();
            let worn = crate::schema_cosmetics::wear_look(&mut o.core().library, &hero, &arg(args, 1));
            match worn {
                Ok((applied, picks)) => {
                    let _ = o.refresh_schema_in_background().recv();
                    json!({ "ok": true, "applied": applied, "picks": picks })
                }
                Err(e) => json!({ "error": e }),
            }
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}

/// The hero grids in Dota's own file, over OpenDota's numbers (src/hero-grids.ts).
fn grids(o: &Owner) -> crate::hero_grid::HeroGrids {
    let c = o.core();
    let game = c.game();
    let now = o.opts.now;
    crate::hero_grid::HeroGrids {
        data_dir: c.user_data.join("hero-grid"),
        account_dir: Box::new(move || crate::gamelang::steam_account_dir(game.as_deref())),
        net: c.net.clone(),
        api: "https://api.opendota.com/api/heroStats".into(),
        now: Box::new(now),
    }
}

const PUMPKIN_HOST: &str = "https://pumpkin.dota2modmanager.com";

/// The pumpkin's code, and its prize taken in as an ordinary import (src/pumpkin.ts).
fn pumpkin(o: &Owner, channel: &str, typed: &Value) -> Value {
    let rebuild = Cell::new(false);
    let mut lines = Vec::new();
    let out = {
        let mut c = o.core();
        let base = c.game().and_then(|g| c.schema.vanilla(&g).ok());
        // English speakers keep their mods in dota_russian too, without Valve's Russian voice in it
        let voice = {
            let game = c.settings.get("dotaGamePath").filter(|v| crate::js::truthy(v)).map(crate::js::string);
            let suffix = c.settings.get("langSuffix").filter(|v| crate::js::truthy(v)).map(crate::js::string);
            match (game, suffix) {
                (Some(g), Some(s)) if crate::gamelang::voice_installed(std::path::Path::new(&g), &s) => Some(s),
                _ => None,
            }
        };
        let net = c.net.clone();
        let p = crate::pumpkin::Pumpkin { net: &net, host: PUMPKIN_HOST.into(), voice };
        let Core { installer, library, settings, .. } = &mut *c;
        let inst = &*installer;
        let mut import = |paths: &[PathBuf], lib: &mut crate::library::Library| -> Value {
            let r = crate::import::import_vpks(inst, paths, &mut |_, _| {}).and_then(|results| {
                crate::adopt::register_import_results(
                    inst,
                    lib,
                    base.as_ref().map(|b| b.0.as_slice()),
                    &results,
                    &mut |_, _| {},
                )
            });
            match r {
                Ok(v) => {
                    if v.get("schema") == Some(&Value::Bool(true)) {
                        rebuild.set(true);
                    }
                    v
                }
                Err(e) => json!({ "error": e }),
            }
        };
        if channel == "pumpkin:redeem" {
            let text = typed.as_str().map(|s| crate::js::slice_utf16(s, 80)).unwrap_or_default();
            p.redeem(&json!(text), settings, library, &mut import, &mut |m| lines.push(m))
        } else {
            p.prize_again(settings, library, &mut import)
        }
    };
    for l in lines {
        o.diag(&l);
    }
    if rebuild.get() {
        let _ = o.refresh_schema_in_background().recv();
    }
    out
}
