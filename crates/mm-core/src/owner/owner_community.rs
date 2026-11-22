//! The community presets' channels: the list with your votes on it, publishing a preset of yours,
//! taking one down, voting, and taking somebody else's preset in and putting it on. The presets
//! live on the catalog's account service (presets/community_presets.rs); writing goes through the
//! session likes use (catalog/social.rs), signed in from the title bar. Every call reaches the
//! service off the lock.

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::js::{string, truthy};
use crate::library::Library;
use crate::owner::{arg, Owner, R};
use crate::social::Refused;

pub const CHANNELS: &[&str] =
    &["community:list", "community:publish", "community:unpublish", "community:vote", "community:take"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args).unwrap_or_else(|e| json!({ "error": e }))))
}

/// The service's refusal said for people; the codes are its presets routes' own.
fn said(r: Refused) -> String {
    match r.code.as_deref() {
        Some("account_too_new") => {
            t("Аккаунт Discord слишком новый: оценивать и публиковать можно с аккаунта старше двух недель", &[])
        }
        Some("own_preset") => t("Свой пресет оценить нельзя", &[]),
        Some("not_your_preset") => t("Это не твой пресет", &[]),
        Some("no_such_preset") => t("Пресет уже снят с публикации", &[]),
        Some("too_many_presets") => t("Опубликовано слишком много пресетов — сними старые", &[]),
        Some("too_many_votes") => t("Слишком много оценок с одного аккаунта", &[]),
        Some("bad_code" | "empty_preset") => t("В пресете нет модов, которые донесёт ссылка", &[]),
        Some("too_many_mods") => t("Слишком много модов в пресете", &[]),
        Some("bad_name") => t("Введи название пресета", &[]),
        _ => r.message,
    }
}

/// The account service's address and its client; no address, no community presets.
fn service(o: &Owner) -> Result<(String, std::sync::Arc<crate::social::Social>), String> {
    match crate::owner_social::service(o) {
        (Some(api), social) => Ok((api, social)),
        (None, _) => Err(t("Пресеты сообщества пока выключены", &[])),
    }
}

fn parts(
    o: &Owner,
) -> (std::sync::Arc<crate::community_presets::CommunityPresets>, std::sync::Arc<crate::net_fetch::Net>) {
    let c = o.core();
    (c.community.clone(), c.net.clone())
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Result<Value, String> {
    if channel == "community:list" {
        return Ok(list(o, truthy(&arg(args, 0))));
    }
    if channel == "community:take" {
        return Ok(take(o, &string(&arg(args, 0))));
    }
    let (api, social) = service(o)?;
    let (com, _) = parts(o);
    let id = string(&arg(args, 0));
    match channel {
        "community:publish" => {
            let link = crate::owner_presets::share_link(o, &arg(args, 0));
            if let Some(e) = link.get("error").filter(|e| truthy(e)) {
                return Err(string(e));
            }
            let name = o.core().library.get_preset(&arg(args, 0)).map(|p| string(&p["name"])).unwrap_or_default();
            let about = arg(args, 1);
            let body = json!({
                "name": crate::js::slice_utf16(crate::js::trim(&name), crate::community_presets::MAX_NAME),
                "about": if truthy(&about) { crate::js::slice_utf16(&string(&about), crate::community_presets::MAX_ABOUT) } else { String::new() },
                "code": link["code"],
            });
            let r = social.request(&api, "POST", "api/presets", Some(&body)).map_err(said)?;
            let published = r.get("id").and_then(Value::as_str).filter(|s| crate::community_presets::is_id(s));
            let Some(published) = published.map(str::to_string) else {
                return Err(t("Сервис каталога не ответил", &[]));
            };
            com.published(&published);
            // the preset remembers where it went, so its card and the share window can say so
            let mut c = o.core();
            if let Some(p) = c.library.get_preset(&arg(args, 0)).cloned() {
                let mut source = p.get("source").filter(|s| s.is_object()).cloned().unwrap_or_else(|| json!({}));
                source["published"] = json!(published);
                let _ = c.library.update_preset(&arg(args, 0), &json!({ "source": source }), None);
            }
            Ok(json!({ "ok": true, "id": published, "count": link["count"], "skipped": link["skipped"] }))
        }
        "community:unpublish" => {
            if !crate::community_presets::is_id(&id) {
                return Err(t("Пресет уже снят с публикации", &[]));
            }
            social.request(&api, "DELETE", &format!("api/presets/{id}"), None).map_err(said)?;
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
                if let Some(s) = source.as_object_mut() {
                    s.remove("published");
                }
                let _ = c.library.update_preset(&p["id"], &json!({ "source": source }), None);
            }
            Ok(json!({ "ok": true }))
        }
        "community:vote" => {
            if !crate::community_presets::is_id(&id) {
                return Err(t("Пресет уже снят с публикации", &[]));
            }
            let value = arg(args, 1).as_f64().unwrap_or(0.0).clamp(-1.0, 1.0).round() as i64;
            let r = if value == 0 {
                social.request(&api, "DELETE", &format!("api/presets/{id}/vote"), None)
            } else {
                social.request(&api, "PUT", &format!("api/presets/{id}/vote?value={value}"), None)
            }
            .map_err(said)?;
            let n =
                |k: &str| r.get(k).and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0) as u64;
            let vote = r.get("vote").and_then(Value::as_i64).filter(|v| (-1..=1).contains(v)).unwrap_or(value);
            com.counted(&id, n("likes"), n("dislikes"));
            com.voted(&id, vote);
            Ok(json!({ "ok": true, "vote": vote, "likes": n("likes"), "dislikes": n("dislikes") }))
        }
        _ => Err(format!("no handler for {channel}")),
    }
}

/// The preset a community one was taken as, by its id in the taken preset's source.
fn taken_from(lib: &Library, id: &str) -> Option<Value> {
    lib.list_presets().iter().find(|p| p.pointer("/source/community").and_then(Value::as_str) == Some(id)).cloned()
}

/// The list as the window draws it: each preset with your vote, whether it is yours, and the
/// preset it became if you took it. `refresh` asks the service for the list and for your part of it.
fn list(o: &Owner, refresh: bool) -> Value {
    let (api, social) = match service(o) {
        Ok(s) => s,
        Err(_) => return json!({ "enabled": false, "signedIn": false, "presets": [] }),
    };
    let (com, net) = parts(o);
    let mut error = Value::Null;
    let presets = if refresh {
        com.refresh(&net, &api, &mut |m| o.diag(m)).unwrap_or_else(|e| {
            error = json!(if e.starts_with("JSON") {
                t("Список пресетов сообщества пришёл повреждённым", &[])
            } else {
                t("Не удалось обновить пресеты сообщества — показан последний список", &[])
            });
            com.list()
        })
    } else {
        com.list()
    };
    let signed = social.signed_in();
    if !signed {
        com.set_mine(None);
    } else if refresh || com.mine().is_none() {
        match social.request(&api, "GET", "api/presets/mine", None) {
            Ok(v) => com.set_mine(Some(crate::community_presets::normalize_mine(&v))),
            Err(e) => o.diag(&format!("community presets, mine: {}", e.message)),
        }
    }
    let mine = com.mine().filter(|_| social.signed_in()).unwrap_or_else(|| json!({ "presets": [], "votes": {} }));
    let own: Vec<&str> =
        mine["presets"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let c = o.core();
    let out: Vec<Value> = presets
        .into_iter()
        .map(|mut p| {
            let id = string(&p["id"]);
            let taken = taken_from(&c.library, &id);
            if let Some(m) = p.as_object_mut() {
                m.insert("mine".into(), json!(own.contains(&id.as_str())));
                m.insert("vote".into(), mine["votes"].get(&id).cloned().unwrap_or(json!(0)));
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
    json!({
        "enabled": true,
        "signedIn": social.signed_in(),
        "canPublish": mine.get("canPublish").cloned().unwrap_or(Value::Bool(false)),
        "moderator": mine.get("moderator").cloned().unwrap_or(Value::Bool(false)),
        "presets": out,
        "error": error,
    })
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
                    &json!({ "name": p["name"], "note": p["about"], "author": p["author"], "wanted": p["mods"] }),
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

    #[test]
    fn the_services_refusals_are_said_for_people() {
        let r = |code: &str| Refused { status: 403, code: Some(code.into()), message: "general".into() };
        assert!(said(r("account_too_new")).contains("Discord"));
        assert_ne!(said(r("own_preset")), said(r("not_your_preset")));
        assert_eq!(said(r("something_new")), "general");
        assert_eq!(said(Refused { status: 0, code: None, message: "offline".into() }), "offline");
    }
}
