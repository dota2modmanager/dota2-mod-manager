//! Settings, the beta channel, the support prompt and the Discord account (src/ipc-settings.ts).
//!
//! Both settings handlers answer with the whole view rather than the bare store, because the
//! window caches whatever it is handed (src/settings-view.ts).

use serde_json::{json, Value};

use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "beta:state",
    "beta:set",
    "support:state",
    "support:choose",
    "settings:get",
    "settings:set",
    "settings:moveLangFiles",
    "settings:detectDota",
    "settings:browseDota",
    "presence:view",
    "account:signOut",
];

/// The view Settings draws: the stored values and the facts only the app can answer.
pub fn view(core: &mut Core, consume_migration: bool) -> Value {
    let migration = if consume_migration { core.upkeep.take_lang_migration() } else { None };
    let slots = if consume_migration { core.upkeep.take_slot_migration() } else { None };
    let lang_folder = core.upkeep.lang_folder().to_string();
    crate::settings_view::settings_view(crate::settings_view::ViewInput {
        settings: core.settings.all(),
        records: core.library.list(),
        discord_configured: crate::discord_auth::is_configured(),
        lang_folder: &lang_folder,
        migration: migration.unwrap_or(Value::Null),
        slot_migration: slots.unwrap_or(Value::Null),
        minify_config: crate::minify::read_config(&crate::minify::config_path()),
    })
}

fn beta(core: &Core) -> Value {
    let id =
        core.settings.get("account").and_then(|a| a.get("id")).filter(|v| crate::js::truthy(v)).map(crate::js::string);
    let wanted = core.settings.get("betaChannel") == Some(&Value::Bool(true));
    json!(crate::beta::beta_state(id.as_deref(), &core.remote.beta(), wanted))
}

fn set(core: &mut Core, key: &str, v: Value) -> Result<(), String> {
    core.settings.set(key, v).map_err(|e| e.to_string())
}

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| answer(o, channel, args))
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> R {
    match channel {
        "beta:state" => Ok(beta(&o.core())),
        "beta:set" => {
            let mut c = o.core();
            set(&mut c, "betaChannel", json!(arg(args, 0) == Value::Bool(true)))?;
            Ok(beta(&c))
        }
        "support:state" => {
            let mut c = o.core();
            let mut p = crate::support_prompt::read_prompt(c.settings.get("supportPrompt").unwrap_or(&Value::Null));
            if !c.launch_counted {
                c.launch_counted = true;
                p = crate::support_prompt::counted(&p);
                set(&mut c, "supportPrompt", p.to_json())?;
            }
            Ok(json!({ "due": crate::support_prompt::due(&p, (o.opts.now)()) }))
        }
        "support:choose" => {
            let mut c = o.core();
            let p = crate::support_prompt::read_prompt(c.settings.get("supportPrompt").unwrap_or(&Value::Null));
            let next = crate::support_prompt::choose(&p, &crate::js::string(&arg(args, 0)), (o.opts.now)());
            set(&mut c, "supportPrompt", next.to_json())?;
            Ok(json!({ "ok": true }))
        }
        "settings:get" => Ok(view(&mut o.core(), true)),
        "settings:set" => settings_set(o, args),
        "settings:moveLangFiles" => {
            let c = o.core();
            match c.game() {
                None => Ok(json!({ "error": crate::i18n::t("Путь к Dota 2 не задан", &[]) })),
                Some(game) => {
                    let to = c.upkeep.lang_folder().to_string();
                    let from = crate::js::string(&arg(args, 0));
                    let moved = crate::gamelang::move_lang_folder(Some(&game), Some(&from), Some(&to));
                    Ok(json!({ "moved": moved, "to": to }))
                }
            }
        }
        "settings:detectDota" => {
            let found = (o.opts.find_game)().filter(|f| !f.is_empty());
            if let Some(f) = &found {
                set(&mut o.core(), "dotaGamePath", json!(f))?;
            }
            Ok(json!(found))
        }
        "settings:browseDota" => browse_dota(o),
        "presence:view" => {
            let view = arg(args, 0);
            o.core().presence_view = view.as_str().map_or("catalog".into(), String::from);
            Ok(Value::Null)
        }
        "account:signOut" => {
            set(&mut o.core(), "account", Value::Null)?;
            Ok(json!({ "ok": true }))
        }
        other => Err(format!("no handler for {other}")),
    }
}

fn settings_set(o: &Owner, args: &[Value]) -> R {
    let key = crate::js::string(&arg(args, 0));
    let value = arg(args, 1);
    let mut c = o.core();
    if key == "uiLang" {
        crate::i18n::set_lang(crate::i18n::Lang::parse(value.as_str().unwrap_or("")));
    }
    if key == "downloadProxy" {
        return match crate::net_fetch::validate_download_proxy(&value) {
            Err(e) => Ok(json!({ "error": e })),
            Ok(v) => {
                set(&mut c, "downloadProxy", json!(v.unwrap_or_default()))?;
                Ok(view(&mut c, false))
            }
        };
    }
    set(&mut c, &key, value)?;
    if key == "langFolderLock" {
        let running = &o.opts.dota_running;
        let mut lines: Vec<String> = Vec::new();
        let core = &mut *c;
        core.upkeep.lang_folder_step(&mut core.settings, &mut || running(), &mut |m| lines.push(m));
        let out = view(&mut c, false);
        drop(c);
        for l in lines {
            o.diag(&l);
        }
        return Ok(out);
    }
    Ok(view(&mut c, false))
}

fn browse_dota(o: &Owner) -> R {
    let title = crate::i18n::t("Выбери папку game внутри dota 2 beta", &[]);
    let res = o.shell.request("dialog.open", vec![json!({ "title": title, "properties": ["openDirectory"] })])?;
    let first = res.get("filePaths").and_then(|p| p.get(0)).and_then(Value::as_str).filter(|s| !s.is_empty());
    let (true, Some(first)) = (res.get("canceled") != Some(&Value::Bool(true)), first) else {
        return Ok(Value::Null);
    };
    let valid = |p: &std::path::Path| crate::installer::validate_game_path(p);
    let mut p = std::path::PathBuf::from(first);
    if !valid(&p) && valid(&p.join("game")) {
        p = p.join("game");
    }
    if !valid(&p) {
        return Ok(
            json!({ "error": crate::i18n::t("В этой папке нет файлов Dota 2 — нужна папка game внутри dota 2 beta", &[]) }),
        );
    }
    let text = p.to_string_lossy().into_owned();
    set(&mut o.core(), "dotaGamePath", json!(text))?;
    Ok(json!({ "path": text }))
}
