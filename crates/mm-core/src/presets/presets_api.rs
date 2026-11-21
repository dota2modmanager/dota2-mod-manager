//! The presets worker from the app's side (tools/ops/presets-worker/worker.mjs): signing in with
//! Discord, publishing, taking down, voting. Reading the list is community_presets.rs and needs
//! none of this.
//!
//! The Discord token is handed to the worker once and dropped, as at the app's own sign-in. What
//! is kept is the worker's session, which names a key, not a Discord account, and lasts a month;
//! it is in community-session.json in the user's data and nowhere else.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::i18n::t;
use crate::js::string;
use crate::net_fetch::Net;

const TIMEOUT_MS: u64 = 20_000;

/// The session kept between starts: the token the worker signed and who it says you are.
pub struct Session {
    file: PathBuf,
}

impl Session {
    pub fn new(user_data: &Path) -> Session {
        Session { file: user_data.join("community-session.json") }
    }

    /// `{ session, user: { key, name } }`, or None when signed out.
    pub fn get(&self) -> Option<Value> {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&self.file).ok()?).ok()?;
        let ok = v.get("session").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
            && v.pointer("/user/key").and_then(Value::as_str).is_some_and(|k| k.len() == 16);
        ok.then_some(v)
    }

    pub fn user(&self) -> Option<Value> {
        self.get().and_then(|v| v.get("user").cloned())
    }

    fn token(&self) -> Option<String> {
        self.get().and_then(|v| v.get("session").and_then(Value::as_str).map(str::to_string))
    }

    pub fn set(&self, v: &Value) -> Result<(), String> {
        std::fs::write(&self.file, v.to_string()).map_err(|e| e.to_string())
    }

    /// Your votes as the worker last answered them, so the buttons show them offline too.
    pub fn votes(&self) -> Value {
        self.get().and_then(|v| v.get("votes").cloned()).filter(Value::is_object).unwrap_or_else(|| json!({}))
    }

    pub fn set_votes(&self, votes: &Value) {
        if let Some(mut v) = self.get() {
            v["votes"] = votes.clone();
            let _ = self.set(&v);
        }
    }

    pub fn clear(&self) {
        let _ = std::fs::remove_file(&self.file);
    }
}

/// What the worker's English error means, for the person reading it.
fn explain(status: u16, error: &str) -> String {
    match (status, error) {
        (401, "sign in first") => t("Войди через Discord, чтобы публиковать и оценивать пресеты", &[]),
        (401, _) => t("Discord не подтвердил вход — попробуй ещё раз", &[]),
        (403, "account too new") => {
            t("Аккаунт Discord слишком новый: оценивать и публиковать можно с аккаунта старше двух недель", &[])
        }
        (403, "not your preset") => t("Это не твой пресет", &[]),
        (403, "not on your own preset") => t("Свой пресет оценить нельзя", &[]),
        (404, _) => t("Пресет уже снят с публикации", &[]),
        (429, "too many presets") => t("Опубликовано слишком много пресетов — сними старые", &[]),
        (429, _) => t("Слишком много запросов, попробуй позже", &[]),
        (409, _) => t("Не получилось с первого раза — попробуй ещё раз", &[]),
        (400, "the preset has no mods") => t("В пресете нет модов, которые донесёт ссылка", &[]),
        (400, "too many mods") => t("Слишком много модов в пресете", &[]),
        (400, e) if e.contains("code") => t("Пресет не удалось прочитать", &[]),
        (400, "name is required") => t("Введи название пресета", &[]),
        _ => t("Сервис пресетов ответил ошибкой: HTTP {0}", &[json!(status)]),
    }
}

/// One call to the worker; the answer's JSON, or an error written for the user. A 401 clears the
/// session: it expired or the worker's secret changed, and either way it is no use any more.
pub fn call(
    net: &Net,
    api: &str,
    session: &Session,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    let auth = session.token().map(|s| format!("Bearer {s}"));
    let payload = body.map(|b| b.to_string().into_bytes());
    let mut headers: Vec<(&str, &str)> = vec![("content-type", "application/json")];
    if let Some(a) = auth.as_deref() {
        headers.push(("authorization", a));
    }
    let (status, bytes) = net
        .direct(method, &format!("{}{path}", api.trim_end_matches('/')), &headers, payload.as_deref(), TIMEOUT_MS)
        .map_err(|e| {
            if e.timeout {
                t("Сервис пресетов не ответил — проверь интернет", &[])
            } else {
                t("Нет связи с сервисом пресетов: {0}", &[json!(e.message)])
            }
        })?;
    let data: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if (200..300).contains(&status) {
        return Ok(data);
    }
    let error = data.get("error").map(string).unwrap_or_default();
    if status == 401 && path != "/session" {
        session.clear();
    }
    Err(explain(status, &error))
}

/// Trade a Discord token for the worker's session and keep it.
pub fn sign_in(net: &Net, api: &str, session: &Session, discord_token: &str) -> Result<Value, String> {
    let r = call(net, api, session, "POST", "/session", Some(&json!({ "discordToken": discord_token })))?;
    let user = r.get("user").cloned().unwrap_or(Value::Null);
    let kept = json!({ "session": r.get("session"), "user": user });
    if kept["session"].as_str().is_none_or(str::is_empty) {
        return Err(t("Сервис пресетов не выдал вход", &[]));
    }
    session.set(&kept)?;
    Ok(user)
}

/// Your votes, `{ "<preset id>": 1 | -1 }`.
pub fn my_votes(net: &Net, api: &str, session: &Session) -> Result<Value, String> {
    let r = call(net, api, session, "GET", "/me", None)?;
    Ok(r.get("votes").filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({})))
}

pub fn publish(net: &Net, api: &str, session: &Session, name: &str, about: &str, code: &str) -> Result<String, String> {
    let r = call(net, api, session, "POST", "/presets", Some(&json!({ "name": name, "about": about, "code": code })))?;
    r.get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| t("Сервис пресетов ответил ошибкой: HTTP {0}", &[json!(200)]))
}

pub fn unpublish(net: &Net, api: &str, session: &Session, id: &str) -> Result<(), String> {
    // POST, not DELETE: Net::direct sends anything that is not a POST as a GET
    call(net, api, session, "POST", "/unpublish", Some(&json!({ "id": id }))).map(|_| ())
}

/// The votes after this one: 1, -1, or 0 to take it back.
pub fn vote(net: &Net, api: &str, session: &Session, id: &str, value: i64) -> Result<Value, String> {
    let r = call(net, api, session, "POST", "/votes", Some(&json!({ "id": id, "value": value })))?;
    Ok(r.get("votes").filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_without_a_key_is_no_session() {
        let dir = std::env::temp_dir().join(format!("mm-community-s-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Session::new(&dir);
        assert!(s.get().is_none());
        s.set(&json!({ "session": "x.y", "user": { "key": "short", "name": "A" } })).unwrap();
        assert!(s.get().is_none());
        s.set(&json!({ "session": "x.y", "user": { "key": "0123456789abcdef", "name": "A" } })).unwrap();
        assert_eq!(s.user().unwrap()["name"], "A");
        s.clear();
        assert!(s.get().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_workers_errors_are_said_for_people() {
        assert!(explain(403, "account too new").contains("Discord"));
        assert!(explain(500, "boom").contains("500"));
        assert_ne!(explain(401, "sign in first"), explain(401, "Discord did not accept the sign-in"));
    }
}
