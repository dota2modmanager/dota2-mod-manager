//! Likes and follows, kept by the catalog's account service: a Cloudflare Worker the catalog's
//! author runs (d2pfx-api), the one the catalog site signs in through as well.
//!
//! Signing in goes through the browser like the plain Discord sign-in (discord_auth.rs), and comes
//! back to the same loopback page: the service answers with a session token of its own, kept in
//! `cloud-session` in userData. That token is all the app holds; the Discord token never reaches
//! it. A session lives 90 days on the service and is renewed while it is used.
//!
//! None of this runs until the signed remote config names the service (`cloud.api`): until then
//! sign-in is the plain one and the window shows no likes. Everyone's numbers are one public file,
//! asked at most once a minute. A like the service refuses is not retried.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::discord_auth::{self, Endpoints};
use crate::i18n::t;
use crate::net_fetch::Net;

/// The time in milliseconds, handed in so a test can set it.
pub type Clock = Box<dyn Fn() -> f64 + Send + Sync>;

const TIMEOUT_MS: u64 = 15_000;
const COUNTS_TTL_MS: f64 = 60_000.0;
/// The service's own limits (d2pfx-api MAX_MOD_KEY, MAX_AUTHOR).
pub const MAX_MOD_KEY: usize = 200;
pub const MAX_AUTHOR: usize = 64;
const TOKEN_FILE: &str = "cloud-session";

/// What can be marked: a mod by its counter key, or an author by name.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Like,
    Follow,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "like" => Some(Kind::Like),
            "follow" => Some(Kind::Follow),
            _ => None,
        }
    }
    fn path(self) -> &'static str {
        match self {
            Kind::Like => "likes?mod=",
            Kind::Follow => "follows?author=",
        }
    }
    fn mine(self) -> &'static str {
        match self {
            Kind::Like => "likes",
            Kind::Follow => "follows",
        }
    }
    fn counts(self) -> &'static str {
        match self {
            Kind::Like => "likes",
            Kind::Follow => "followers",
        }
    }
    fn max(self) -> usize {
        match self {
            Kind::Like => MAX_MOD_KEY,
            Kind::Follow => MAX_AUTHOR,
        }
    }
}

/// The service's reason a sign-in failed (`d2pfx_err`), in words.
pub fn sign_in_error(code: &str) -> String {
    match code {
        "denied" => t("Вход отменён", &[]),
        "not_member" => t("Войти могут только участники сервера D2PFX в Discord", &[]),
        _ => t("Вход не удался ({0})", &[json!(crate::js::slice_utf16(code, 40))]),
    }
}

/// A session token as the service writes it: base64url, 40 to 64 characters.
fn is_token(s: &str) -> bool {
    (40..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A key or a name the service would take: trimmed, within its length, no control characters.
pub fn clean_name(raw: &str, max: usize) -> Option<String> {
    let s = raw.trim();
    (!s.is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)).then(|| s.to_string())
}

/// One number per key out of the service's answer; anything else dropped.
fn clean_counts(v: Option<&Value>) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(m) = v.and_then(Value::as_object) {
        for (k, n) in m.iter().take(50_000) {
            if let Some(n) = n.as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
                out.insert(k.clone(), json!(n));
            }
        }
    }
    Value::Object(out)
}

fn names(v: Option<&Value>, max: usize) -> Vec<Value> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter_map(|s| clean_name(s, max)).map(Value::from).collect())
        .unwrap_or_default()
}

/// A call the service or the network refused: the HTTP status (0 when it never answered), the
/// service's error code when it gave one, and the refusal in general words.
#[derive(Debug, Clone, PartialEq)]
pub struct Refused {
    pub status: u16,
    pub code: Option<String>,
    pub message: String,
}

#[derive(Default)]
struct State {
    counts: Option<Value>,
    counts_at: Option<f64>,
    /// the signed-in person's likes and follows, once asked
    mine: Option<Value>,
}

pub struct Social {
    token_file: PathBuf,
    net: Arc<Net>,
    now: Clock,
    log: Box<dyn Fn(&str) + Send + Sync>,
    state: Mutex<State>,
}

impl Social {
    pub fn new(user_data: &Path, net: Arc<Net>, now: Clock, log: Box<dyn Fn(&str) + Send + Sync>) -> Arc<Social> {
        Arc::new(Social { token_file: user_data.join(TOKEN_FILE), net, now, log, state: Mutex::new(State::default()) })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn token(&self) -> Option<String> {
        std::fs::read_to_string(&self.token_file).ok().map(|t| t.trim().to_string()).filter(|t| is_token(t))
    }

    /// Whether a session is kept.
    pub fn signed_in(&self) -> bool {
        self.token().is_some()
    }

    fn forget(&self) {
        let _ = std::fs::remove_file(&self.token_file);
        self.state().mine = None;
    }

    /// One call with the session. A 401 means the service ended it: the session is dropped.
    fn call(&self, api: &str, method: &str, path: &str) -> Result<Value, String> {
        self.request(api, method, path, None).map_err(|r| match r.code {
            Some(code) => t("Сервис каталога ответил {0} {1}", &[json!(r.status), json!(code)]),
            None => r.message,
        })
    }

    /// `call` with a JSON body, and the service's own error code kept apart, for a caller that
    /// says each refusal in its own words (the community presets, owner_community.rs).
    pub fn request(&self, api: &str, method: &str, path: &str, body: Option<&Value>) -> Result<Value, Refused> {
        let plain = |message: String| Refused { status: 0, code: None, message };
        let token = self.token().ok_or_else(|| plain(t("Сначала войди через Discord", &[])))?;
        let auth = format!("Bearer {token}");
        let mut headers = vec![("Authorization", auth.as_str()), ("X-D2PFX-Client", "app")];
        let payload = body.map(|b| b.to_string().into_bytes());
        if payload.is_some() {
            headers.push(("Content-Type", "application/json"));
        }
        let (status, answer) = self
            .net
            .direct(method, &format!("{api}/{path}"), &headers, payload.as_deref(), TIMEOUT_MS)
            .map_err(|e| plain(e.message))?;
        if status == 401 {
            self.forget();
            return Err(Refused {
                status, ..plain(t("Вход истёк: войди через Discord ещё раз", &[]))
            });
        }
        let v: Value = serde_json::from_slice(&answer).unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            let code = v.get("error").and_then(Value::as_str).unwrap_or("").to_string();
            let message = t("Сервис каталога ответил {0} {1}", &[json!(status), json!(code)]);
            return Err(Refused { status, code: Some(code), message });
        }
        Ok(v)
    }

    /// Sign in through the service: the browser, then the loopback, then who signed in. The
    /// session is kept only once the service has said who it belongs to.
    pub fn sign_in(
        &self,
        api: &str,
        at: &Endpoints,
        open: &dyn Fn(&str) -> Result<(), String>,
    ) -> Result<Value, String> {
        let state = uuid::Uuid::new_v4().simple().to_string();
        let listener = discord_auth::listen(at.port)?;
        open(&login_url(api, &state, at.port))?;
        let token = discord_auth::await_token(listener, &state, at.timeout)?;
        if !is_token(&token) {
            return Err(t("Сервис каталога выдал не тот токен", &[]));
        }
        std::fs::write(&self.token_file, &token).map_err(|e| e.to_string())?;
        let me = match self.call(api, "GET", "api/me") {
            Ok(me) => me,
            Err(e) => {
                self.forget();
                return Err(e);
            }
        };
        let picture = me.get("avatar").and_then(Value::as_str).unwrap_or("");
        let avatar = if picture.starts_with("https://cdn.discordapp.com/") {
            discord_auth::picture_data_uri(&self.net, picture)
        } else {
            Value::Null
        };
        let name = me.get("name").and_then(Value::as_str).unwrap_or("");
        let text = |k: &str| me.get(k).and_then(Value::as_str).map(|s| crate::js::slice_utf16(s, 32));
        Ok(json!({
            "id": crate::js::string(me.get("id").unwrap_or(&Value::Null)),
            "username": crate::js::slice_utf16(name, 80),
            "avatar": avatar,
            "frame": text("frame"),
            "label": text("label"),
            "cloud": true,
        }))
    }

    /// End the session on the service too; it is forgotten here whatever the service says.
    pub fn sign_out(&self, api: Option<&str>) {
        if let (Some(api), true) = (api, self.signed_in()) {
            if let Err(e) = self.call(api, "POST", "auth/logout") {
                (self.log)(&format!("cloud sign-out: {e}"));
            }
        }
        self.forget();
    }

    /// Everyone's numbers, at most once a minute; the last ones when the service cannot be had.
    fn counts(&self, api: &str) -> Value {
        let now = (self.now)();
        let fresh = self.state().counts_at.is_some_and(|at| now - at < COUNTS_TTL_MS);
        if !fresh {
            self.state().counts_at = Some(now);
            match self.net.direct("GET", &format!("{api}/api/counts"), &[], None, TIMEOUT_MS) {
                Ok((200, body)) => {
                    let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                    let counts =
                        json!({ "likes": clean_counts(v.get("likes")), "followers": clean_counts(v.get("followers")) });
                    self.state().counts = Some(counts);
                }
                Ok((status, _)) => (self.log)(&format!("cloud counts: HTTP {status}")),
                Err(e) => (self.log)(&format!("cloud counts: {}", e.message)),
            }
        }
        self.state().counts.clone().unwrap_or_else(|| json!({ "likes": {}, "followers": {} }))
    }

    /// What the window draws: whether the service is on, who is signed in to it, their likes and
    /// follows, and everyone's numbers.
    pub fn snapshot(&self, api: Option<&str>) -> Value {
        let Some(api) = api else {
            return json!({ "enabled": false, "signedIn": false, "likes": [], "follows": [], "counts": { "likes": {}, "followers": {} } });
        };
        let counts = self.counts(api);
        let signed = self.signed_in();
        let mut mine = self.state().mine.clone();
        if signed && mine.is_none() {
            match self.call(api, "GET", "api/social") {
                Ok(v) => {
                    let m = json!({ "likes": names(v.get("likes"), MAX_MOD_KEY), "follows": names(v.get("follows"), MAX_AUTHOR) });
                    self.state().mine = Some(m.clone());
                    mine = Some(m);
                }
                Err(e) => (self.log)(&format!("cloud social: {e}")),
            }
        }
        let mine = mine.unwrap_or_else(|| json!({ "likes": [], "follows": [] }));
        json!({
            "enabled": true,
            "signedIn": self.signed_in(),
            "likes": mine["likes"],
            "follows": mine["follows"],
            "counts": counts,
        })
    }

    /// Like or unlike a mod, follow or unfollow an author. The answer is the count after it.
    pub fn mark(&self, api: &str, kind: Kind, name: &str, on: bool) -> Result<Value, String> {
        let name = clean_name(name, kind.max()).ok_or_else(|| t("Такое имя сервис не примет", &[]))?;
        let q: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
        let v = self.call(api, if on { "PUT" } else { "DELETE" }, &format!("api/{}{q}", kind.path()))?;
        let count = v.get("count").and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0);
        let mut st = self.state();
        if let Some(list) = st.mine.as_mut().and_then(|m| m[kind.mine()].as_array_mut()) {
            list.retain(|x| x.as_str() != Some(name.as_str()));
            if on {
                list.push(json!(name));
            }
        }
        if let Some(c) = st.counts.as_mut().and_then(|c| c[kind.counts()].as_object_mut()) {
            c.insert(name.clone(), json!(count));
        }
        Ok(json!({ "ok": true, "on": on, "count": count }))
    }
}

/// Where the browser is sent: the service's login, asked to come back to the loopback page with
/// this sign-in's state in the query.
pub fn login_url(api: &str, state: &str, port: u16) -> String {
    let ret = format!("http://127.0.0.1:{port}/callback?state={state}");
    let q: String = url::form_urlencoded::byte_serialize(ret.as_bytes()).collect();
    format!("{api}/auth/login?return={q}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_browser_goes_to_the_service_and_comes_back_to_the_loopback_with_the_state() {
        assert_eq!(
            login_url("https://api.example.dev", "ab12", 53174),
            "https://api.example.dev/auth/login?return=http%3A%2F%2F127.0.0.1%3A53174%2Fcallback%3Fstate%3Dab12"
        );
    }

    #[test]
    fn a_token_names_and_counts_are_what_the_service_writes() {
        assert!(is_token(&"a".repeat(43)));
        assert!(!is_token("short"));
        assert!(!is_token(&format!("{}/", "a".repeat(42))));
        assert_eq!(clean_name("  heroes/Juggernaut/Bare  ", MAX_MOD_KEY).as_deref(), Some("heroes/Juggernaut/Bare"));
        assert_eq!(clean_name("a\nb", MAX_AUTHOR), None);
        assert_eq!(clean_name(&"й".repeat(65), MAX_AUTHOR), None);
        assert_eq!(clean_name(&"й".repeat(64), MAX_AUTHOR).map(|s| s.chars().count()), Some(64));
        assert_eq!(clean_counts(Some(&json!({ "a": 2, "b": -1, "c": "x" }))), json!({ "a": 2.0 }));
    }

    #[test]
    fn without_the_service_nothing_is_asked_and_nothing_is_on() {
        let dir = std::env::temp_dir().join(format!("mm-social-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Social::new(&dir, Arc::new(Net::new(|| 0.0)), Box::new(|| 0.0), Box::new(|_| {}));
        assert_eq!(s.snapshot(None)["enabled"], json!(false));
        assert!(!s.signed_in());
        std::fs::write(dir.join(TOKEN_FILE), "not a token").unwrap();
        assert!(!s.signed_in(), "a file that is not a token is no session");
        std::fs::write(dir.join(TOKEN_FILE), "b".repeat(43)).unwrap();
        assert!(s.signed_in());
        s.sign_out(None);
        assert!(!dir.join(TOKEN_FILE).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A worker on a local port: answers like d2pfx-api for one session token, and says what it was asked.
    fn fake_service(token: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}", server.local_addr().unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        std::thread::spawn(move || {
            let mut likes = 0;
            for sock in server.incoming() {
                let Ok(mut sock) = sock else { continue };
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = req.lines().next().unwrap_or("").to_string();
                let authed =
                    req.contains(&format!("Bearer {token}")) && req.to_lowercase().contains("x-d2pfx-client: app");
                seen.lock().unwrap().push(line.clone());
                let (status, body) = match line.split(' ').take(2).collect::<Vec<_>>()[..] {
                    ["GET", "/api/counts"] => (200, format!(r#"{{"likes":{{"heroes/Jugg/Bare":{likes}}},"followers":{{"hrdq":3}}}}"#)),
                    [_, _] if !authed => (401, r#"{"error":"unauthorized"}"#.to_string()),
                    ["GET", "/api/me"] => (200, r#"{"id":"123456789012345678","name":"Bob","avatar":"https://evil.example/x.png","frame":"modmanager","label":"Developer"}"#.into()),
                    ["GET", "/api/social"] => (200, r#"{"likes":[],"follows":["hrdq"]}"#.into()),
                    ["PUT", p] if p.starts_with("/api/likes?mod=heroes%2FJugg%2FBare") => {
                        likes += 1;
                        (200, format!(r#"{{"ok":true,"on":true,"count":{likes}}}"#))
                    }
                    ["POST", "/auth/logout"] => (200, r#"{"ok":true}"#.into()),
                    _ => (404, r#"{"error":"not_found"}"#.into()),
                };
                let _ = write!(sock, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        (api, asked)
    }

    /// The browser: follows the login address back to the loopback page and posts what the page would.
    fn browser(answer: &'static str) -> impl Fn(&str) -> Result<(), String> {
        move |url: &str| {
            let ret = url::Url::parse(url).unwrap().query_pairs().find(|(k, _)| k == "return").unwrap().1.to_string();
            let ret = url::Url::parse(&ret).unwrap();
            let state = ret.query_pairs().find(|(k, _)| k == "state").unwrap().1.to_string();
            let port = ret.port().unwrap();
            let body = format!("state={state}&{answer}");
            std::thread::spawn(move || {
                use std::io::Write;
                for _ in 0..100 {
                    if let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port)) {
                        let _ = write!(
                            s,
                            "POST /token HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        );
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            });
            Ok(())
        }
    }

    fn endpoints() -> Endpoints {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        Endpoints { port, timeout: std::time::Duration::from_secs(10), ..Endpoints::default() }
    }

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mm-social-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const TOKEN: &str = "tok_0123456789abcdefghijklmnopqrstuvwxyzABCD";

    #[test]
    fn signing_in_keeps_the_service_session_and_a_like_counts() {
        let (api, asked) = fake_service(TOKEN);
        let dir = temp();
        let s = Social::new(&dir, Arc::new(Net::new(|| 0.0)), Box::new(|| 0.0), Box::new(|_| {}));
        let account = s.sign_in(&api, &endpoints(), &browser(format!("d2pfx_token={TOKEN}").leak())).unwrap();
        assert_eq!(account["id"], "123456789012345678");
        assert_eq!(account["username"], "Bob");
        assert_eq!(account["label"], "Developer");
        assert_eq!(account["avatar"], Value::Null, "a picture off Discord's CDN only");
        assert!(s.signed_in());

        let snap = s.snapshot(Some(&api));
        assert_eq!(snap["follows"], json!(["hrdq"]));
        assert_eq!(snap["counts"]["followers"]["hrdq"], json!(3.0));

        let r = s.mark(&api, Kind::Like, "heroes/Jugg/Bare", true).unwrap();
        assert_eq!(r["count"], json!(1.0));
        let snap = s.snapshot(Some(&api));
        assert_eq!(snap["likes"], json!(["heroes/Jugg/Bare"]));
        assert_eq!(
            snap["counts"]["likes"]["heroes/Jugg/Bare"],
            json!(1.0),
            "the count after the like, not a minute later"
        );

        s.sign_out(Some(&api));
        assert!(!s.signed_in());
        assert!(asked.lock().unwrap().iter().any(|l| l.starts_with("POST /auth/logout")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_refused_sign_in_says_why_and_keeps_nothing() {
        let (api, _) = fake_service(TOKEN);
        let dir = temp();
        let s = Social::new(&dir, Arc::new(Net::new(|| 0.0)), Box::new(|| 0.0), Box::new(|_| {}));
        let e = s.sign_in(&api, &endpoints(), &browser("d2pfx_auth=error&d2pfx_err=not_member")).unwrap_err();
        assert_eq!(e, sign_in_error("not_member"));
        assert!(!s.signed_in());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_the_service_ended_is_dropped() {
        let (api, _) = fake_service(TOKEN);
        let dir = temp();
        std::fs::write(dir.join(TOKEN_FILE), "x".repeat(43)).unwrap();
        let s = Social::new(&dir, Arc::new(Net::new(|| 0.0)), Box::new(|| 0.0), Box::new(|_| {}));
        assert!(s.mark(&api, Kind::Follow, "hrdq", true).is_err());
        assert!(!s.signed_in());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
