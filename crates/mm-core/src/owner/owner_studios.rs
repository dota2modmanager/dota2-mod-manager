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
            // the slow half first and off the owner's lock: the map's lights and its scan, which a
            // first opening spent seconds on while every other channel queued behind it
            let lights = warm_map(o);
            let mut c = o.core();
            // the game's terrain and weather items, read out of the item table once per table: a
            // reading is the whole fifty megabytes, every opening of the window paid it
            let text = c.game().and_then(|g| c.schema.vanilla(&g).ok());
            let (terrains, weathers, plain) = match &text {
                Some(t) => decor_items(t),
                None => (vec![], vec![], Value::Null),
            };
            let map = crate::map_make::MapMake::state(&c.library);
            ok_with(crate::map_decor::MapDecor::new(c.game()).state(&c.installer, &c.library).map(|mut v| {
                v["map"] = map;
                v["weatherLight"] = lights;
                v["terrains"] = Value::Array(terrains);
                v["weathers"] = Value::Array(weathers);
                v["defaultWeather"] = plain;
                v
            }))
        }
        "decor:install" => {
            // a catalog terrain as the map's base: its archive downloaded as an install would, before
            // the build takes the app (the download reports its bar meanwhile)
            let names: Vec<String> =
                a0.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            let choice = crate::map_decor::MapChoice::of(names.iter().map(String::as_str));
            if let Some(crate::map_base::Base::Catalog(file)) = &choice.base {
                let ud = o.core().user_data.clone();
                let to = crate::map_base::catalog_map(&ud, file);
                if !crate::map_base::catalog_kept(&ud, file) {
                    let got = crate::owner_mods::download(o, "terrains", file, file)
                        .and_then(|zip| crate::map_base::take_catalog_map(&zip, &to));
                    if let Err(e) = got {
                        return json!({ "error": e });
                    }
                }
            }
            decor_install(o, args)
        }
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
            let worn = {
                let mut core = o.core();
                let c = &mut *core;
                let game = c.game();
                let schema = &mut c.schema;
                let text = move || -> Result<Vec<u8>, String> {
                    match game {
                        None => Err(crate::i18n::t("Путь к Dota 2 не задан", &[])),
                        Some(g) => schema.vanilla(&g).map(|b| b.0.clone()),
                    }
                };
                crate::schema_cosmetics::wear_look(&mut c.library, &hero, &arg(args, 1), text)
            };
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
        api: crate::hero_grid::HERO_STATS_API.into(),
        copy: Some(crate::hero_grid::HERO_STATS_COPY.into()),
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

/// The Optimization pak and the map built (map_decor.rs), the ground's pictures in polygons
/// compiled first when they are asked for (ground_build.rs).
/// decor:install: Optimization's groups (map_decor.rs), or with "map" fourth the map of one's own
/// (map_make.rs). A map built anew is a new map under Optimization, which is built again on it.
fn decor_install(o: &Owner, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    let is_map = args.get(3).and_then(Value::as_str) == Some("map");
    installed(o, |c, log| {
        let ud = c.user_data.clone();
        let make = crate::map_make::MapMake::new(c.game(), &ud);
        let decor = crate::map_decor::MapDecor::new(c.game()).with_user_data(&ud);
        {
            let Core { installer, library, .. } = &mut *c;
            make.adopt_legacy(installer, library, log)?;
        }
        if !is_map {
            let Core { installer, library, .. } = c;
            return decor.install(installer, library, &a0, log);
        }
        // the ground's look: its tint ("rrggbb") and polygons, kept in the record beside the rest
        let mut names: Vec<String> =
            a0.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
        for (k, i) in [("tint", 1), ("facets", 2)] {
            let v = args.get(i).and_then(Value::as_str).unwrap_or("");
            if !v.is_empty() {
                names.push(format!("{k}:{v}"));
            }
        }
        let style = crate::ground_facets::Style::of(names.iter().map(String::as_str));
        // the ground in polygons: its pictures cut and compiled before the build (ground_build.rs)
        let extra = match style.facets {
            Some(f) => {
                let pak = c
                    .game()
                    .and_then(|g| crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).ok())
                    .ok_or_else(|| crate::i18n::t("Не указана папка игры", &[]))?;
                let grounds = make.grounds(&a0);
                let glb = c.glb.clone();
                let (rc, k) = (crate::owner_compiler::compiler(c), crate::owner_compiler::keeper(c));
                let mut compile = |job: &crate::resource_compiler::CompileJob| {
                    rc.compile(job, k.as_ref(), &mut crate::run_process::run, &mut |_| {})
                };
                crate::ground_build::faceted(&pak, &grounds, f, &|t| glb.sprites(t), &mut compile, log)?
            }
            None => vec![],
        };
        let Core { installer, library, .. } = c;
        let rec = make.put(installer, library, &names, extra, false)?;
        // Optimization took its files off the map that was on: it is built again on this one
        decor.rebuild_now(installer, library, log);
        Ok(rec)
    })
}

/// The light of each weather in the default map's zones (map_build.rs weather_lights), read once
/// per map file: the window lights its 3D map from them.
static WEATHER_LIGHTS: std::sync::Mutex<Option<(String, Value)>> = std::sync::Mutex::new(None);

/// What the map windows read of the map in force, read now if it was not: the weather zones' light
/// and the scan of the map's decor. Only the paths are taken under the owner's lock; the reading is
/// off it. Called by the window's state, and once after start so the first opening finds it ready
/// (owner_start.rs). The light, or null with no game.
pub fn warm_map(o: &Owner) -> Value {
    let (game, map) = {
        let c = o.core();
        let game = c.game();
        let map = crate::map_decor::MapDecor::new(game.clone()).map_in_force(&c.installer);
        (game, map)
    };
    let Some(game) = game else { return Value::Null };
    let lights = weather_lights(&game);
    if let Some(map) = map {
        if let Err(e) = crate::map_decor::MapDecor::new(Some(game)).warm(&map) {
            o.diag(&format!("map decor: could not read the map ahead: {e}"));
        }
    }
    lights
}

/// Once after start (owner_start.rs): what [`warm_map`] reads, and the 3D view of the map the two
/// map windows draw, exported by the toolchain the first time (a minute or more) and kept, so the
/// windows do not wait on it either. Off the owner's lock throughout; nothing without the toolchain.
pub fn warm_at_start(o: &Owner) {
    warm_map(o);
    let glb = o.core().glb.clone();
    let started = std::time::Instant::now();
    if glb.map_world(None).is_some() {
        o.diag(&format!("map 3D view ready ahead in {} ms", started.elapsed().as_millis()));
    }
}

fn weather_lights(game: &std::path::Path) -> Value {
    let map = game.join("dota").join("maps").join("dota.vpk");
    let key = std::fs::metadata(&map)
        .map(|m| format!("{}|{}|{:?}", map.display(), m.len(), m.modified().ok()))
        .unwrap_or_default();
    let mut kept = WEATHER_LIGHTS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((k, v)) = kept.as_ref() {
        if *k == key {
            return v.clone();
        }
    }
    let Ok(ix) = crate::vpk::Index::open(&map) else { return Value::Null };
    let lumps: Vec<Vec<u8>> =
        ix.paths().filter(|p| p.ends_with(".vents_c")).filter_map(|p| ix.read(p).ok().flatten()).collect();
    let v = crate::map_build::weather_lights(&lumps, &crate::map_decor::WEATHER_KEYS);
    *kept = Some((key, v.clone()));
    v
}

/// The terrain items, the weather items and the default weather, kept for the table they were read from.
type DecorItems = (Vec<Value>, Vec<Value>, Value);
static DECOR_ITEMS: std::sync::Mutex<Option<(usize, usize, DecorItems)>> = std::sync::Mutex::new(None);

fn decor_items(t: &std::sync::Arc<(Vec<u8>, String)>) -> DecorItems {
    let key = (std::sync::Arc::as_ptr(t) as usize, t.0.len());
    let mut kept = DECOR_ITEMS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((p, n, items)) = kept.as_ref() {
        if (*p, *n) == key {
            return items.clone();
        }
    }
    let terrains: Vec<Value> = crate::map_ground::terrain_items(&t.0)
        .into_iter()
        .map(|(id, name, map)| json!({ "id": id, "name": name, "map": map }))
        .collect();
    let (weathers, plain) = crate::map_ground::weather_items(&t.0);
    let weathers: Vec<Value> =
        weathers.into_iter().map(|(id, name, key)| json!({ "id": id, "name": name, "key": key })).collect();
    let plain = plain.map_or(Value::Null, |(id, name)| json!({ "id": id, "name": name }));
    let items = (terrains, weathers, plain);
    *kept = Some((key.0, key.1, items.clone()));
    items
}
