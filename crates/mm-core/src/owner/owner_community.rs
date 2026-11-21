//! The community presets' channels: the list with your votes on it, signing in to the presets
//! worker with Discord, publishing a preset of yours, taking it down, voting, and taking somebody
//! else's preset in and putting it on. What a community preset is lives in
//! crates/mm-core/src/presets/community_presets.rs, the worker's side of the wire in presets_api.rs.

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::owner::{arg, Owner, R};
use crate::presets_api::{self, Session};

pub const CHANNELS: &[&str] = &[
    "community:list",
    "community:signIn",
    "community:signOut",
    "community:publish",
    "community:unpublish",
    "community:vote",
    "community:take",
];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args).unwrap_or_else(|e| json!({ "error": e }))))
}

fn session(o: &Owner) -> Session {
    Session::new(&o.opts.user_data)
}

/// The list and the network, taken out from under the lock: a refresh is a fetch.
fn parts(
    o: &Owner,
) -> (std::sync::Arc<crate::community_presets::CommunityPresets>, std::sync::Arc<crate::net_fetch::Net>) {
    let c = o.core();
    (c.community.clone(), c.net.clone())
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Result<Value, String> {
    let (com, net) = parts(o);
    if channel != "community:list" && channel != "community:signOut" && !com.configured() {
        return Err(t("Пресеты сообщества в этой сборке не подключены", &[]));
    }
    let api = com.at.api.clone();
    let s = session(o);
    match channel {
        "community:list" => Ok(list(o, truthy(&arg(args, 0)))),
        "community:signIn" => {
            // the wait for the browser runs without the lock: it can take a minute
            let open = |url: &str| o.shell.request("shell.openExternal", vec![json!(url)]).map(|_| ());
            let at = crate::discord_auth::Endpoints::default();
            let token = crate::discord_auth::access_token(&at, &open)?;
            let user = presets_api::sign_in(&net, &api, &s, &token)?;
            // the app's own account as well, so the name in the title bar is the one presets carry
            if let Ok(account) = crate::discord_auth::account(&net, &at, &token) {
                let _ = o.core().settings.set("account", account);
            }
            if let Ok(votes) = presets_api::my_votes(&net, &api, &s) {
                s.set_votes(&votes);
            }
            let _ = o.shell.request("win.show", vec![]);
            let _ = o.shell.request("win.focus", vec![]);
            Ok(json!({ "ok": true, "user": user }))
        }
        "community:signOut" => {
            s.clear();
            Ok(json!({ "ok": true }))
        }
        "community:publish" => {
            if s.get().is_none() {
                return Err(t("Войди через Discord, чтобы публиковать и оценивать пресеты", &[]));
            }
            let id = arg(args, 0);
            let link = crate::owner_presets::share_link(o, &id);
            if let Some(e) = link.get("error").filter(|e| truthy(e)) {
                return Err(string(e));
            }
            let name = o.core().library.get_preset(&id).map(|p| string(&p["name"])).unwrap_or_default();
            let about = arg(args, 1);
            let about = if truthy(&about) { string(&about) } else { String::new() };
            let published = presets_api::publish(&net, &api, &s, &name, &about, &string(&link["code"]))?;
            // the preset remembers where it went, so its card can say so and offer to take it down
            let mut c = o.core();
            if let Some(p) = c.library.get_preset(&id).cloned() {
                let mut source = p.get("source").filter(|s| s.is_object()).cloned().unwrap_or_else(|| json!({}));
                source["published"] = json!(published);
                let _ = c.library.update_preset(&id, &json!({ "source": source }), None);
            }
            Ok(json!({ "ok": true, "id": published, "count": link["count"], "skipped": link["skipped"] }))
        }
        "community:unpublish" => {
            let id = string(&arg(args, 0));
            presets_api::unpublish(&net, &api, &s, &id)?;
            com.forget(&id);
            let mut c = o.core();
            let mine: Vec<Value> = c
                .library
                .list_presets()
                .iter()
                .filter(|p| p.pointer("/source/published").and_then(Value::as_str) == Some(id.as_str()))
                .cloned()
                .collect();
            for p in mine {
                let mut source = p["source"].clone();
                if let Some(o) = source.as_object_mut() {
                    o.remove("published");
                }
                let _ = c.library.update_preset(&p["id"], &json!({ "source": source }), None);
            }
            Ok(json!({ "ok": true }))
        }
        "community:vote" => {
            let id = string(&arg(args, 0));
            let value = arg(args, 1).as_f64().unwrap_or(0.0).clamp(-1.0, 1.0).round() as i64;
            let votes = presets_api::vote(&net, &api, &s, &id, value)?;
            s.set_votes(&votes);
            Ok(json!({ "ok": true, "votes": votes }))
        }
        "community:take" => Ok(take(o, &string(&arg(args, 0)))),
        _ => Err(format!("no handler for {channel}")),
    }
}

/// The preset a community one was taken as, by its id in the taken preset's source.
fn taken_from(lib: &Library, id: &str) -> Option<Value> {
    lib.list_presets().iter().find(|p| p.pointer("/source/community").and_then(Value::as_str) == Some(id)).cloned()
}

/// The list as the window draws it: each preset with your vote on it, whether it is yours, and
/// the preset it became if you took it. `refresh` fetches the index and your votes first.
fn list(o: &Owner, refresh: bool) -> Value {
    let (com, net) = parts(o);
    if !com.configured() {
        return json!({ "configured": false, "presets": [], "user": Value::Null, "votes": {} });
    }
    let s = session(o);
    let mut error = Value::Null;
    let presets = if refresh {
        com.refresh(&net, &mut |m| o.diag(m)).unwrap_or_else(|e| {
            error = json!(if e.contains("JSON") {
                t("Список пресетов сообщества пришёл повреждённым", &[])
            } else {
                t("Не удалось обновить пресеты сообщества — показан последний список", &[])
            });
            com.list()
        })
    } else {
        com.list()
    };
    if refresh && s.get().is_some() {
        if let Ok(v) = presets_api::my_votes(&net, &com.at.api, &s) {
            s.set_votes(&v);
        }
    }
    let user = s.user();
    let votes = s.votes();
    let me = user.as_ref().and_then(|u| u.get("key")).and_then(Value::as_str).unwrap_or("").to_string();
    let c = o.core();
    let out: Vec<Value> = presets
        .into_iter()
        .map(|mut p| {
            let id = string(&p["id"]);
            let taken = taken_from(&c.library, &id);
            if let Some(m) = p.as_object_mut() {
                m.remove("code");
                m.insert("mine".into(), json!(!me.is_empty() && m["author"]["key"] == json!(me)));
                m.insert("vote".into(), votes.get(&id).cloned().unwrap_or(json!(0)));
                m.insert(
                    "taken".into(),
                    taken.map_or(
                        Value::Null,
                        |t| json!({ "id": t["id"], "wanted": t.get("wanted").is_some_and(truthy) }),
                    ),
                );
            }
            p
        })
        .collect();
    json!({ "configured": true, "presets": out, "user": user, "votes": votes, "error": error })
}

/// Somebody's preset added as a received one and installed, or, taken before, put on again.
fn take(o: &Owner, id: &str) -> Value {
    let (com, _) = parts(o);
    let Some(p) = com.get(id) else {
        return json!({ "error": t("Пресет уже снят с публикации", &[]) });
    };
    let preset = {
        let mut c = o.core();
        match taken_from(&c.library, id) {
            Some(t) => t,
            None => {
                let made = c.library.add_shared_preset(
                    &json!({ "name": p["name"], "note": p["about"], "author": p["author"]["name"], "wanted": p["mods"] }),
                    None,
                );
                let made = match made {
                    Ok(m) => m,
                    Err(e) => return json!({ "error": e.to_string() }),
                };
                let mut source = made.get("source").cloned().unwrap_or_else(|| Value::Object(Map::new()));
                source["community"] = json!(id);
                match c.library.update_preset(&made["id"], &json!({ "source": source }), None) {
                    Ok(Some(p)) => p,
                    Ok(None) => made,
                    Err(e) => return json!({ "error": e.to_string() }),
                }
            }
        }
    };
    let own = !preset.get("wanted").is_some_and(truthy);
    crate::owner_presets::flow(o, &preset, own)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{Options, Shell};
    use std::sync::Arc;

    struct Quiet;
    impl Shell for Quiet {
        fn event(&self, _: &str, _: Vec<Value>) {}
        fn request(&self, _: &str, _: Vec<Value>) -> Result<Value, String> {
            Ok(Value::Null)
        }
    }

    fn owner() -> (Arc<Owner>, std::path::PathBuf) {
        let ud = std::env::temp_dir().join(format!("mm-owner-community-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&ud).unwrap();
        std::fs::write(ud.join("settings.json"), "{}").unwrap();
        let o = Owner::start(
            Options {
                user_data: ud.clone(),
                app_version: "9.9.9".into(),
                app_root: ud.clone(),
                downloads: ud.clone(),
                uninstall: false,
                system_languages: None,
                find_game: Box::new(|| None),
                dota_running: Box::new(|| false),
                now: crate::net_fetch::now_ms,
            },
            Arc::new(Quiet),
        );
        (o, ud)
    }

    #[test]
    fn a_build_without_a_key_says_so_and_lists_nothing() {
        let (o, ud) = owner();
        let r = answer(&o, "community:list", &[json!(false)]).unwrap();
        // a debug run may be pointed at a local worker; the release default has no key yet
        if crate::community_presets::COMMUNITY_PUBLIC_KEY.is_empty() && std::env::var("D2MM_COMMUNITY_KEY").is_err() {
            assert_eq!(r["configured"], false);
            assert!(answer(&o, "community:vote", &[json!("x"), json!(1)]).is_err());
        }
        assert!(r["presets"].as_array().is_some());
        let _ = std::fs::remove_dir_all(&ud);
    }
}
