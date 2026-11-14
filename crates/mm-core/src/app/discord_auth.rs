//! Sign in with Discord, without a server of our own (src/discord-auth.ts).
//!
//! Discord's implicit grant hands the access token straight to the redirect, so a desktop app can
//! identify a user with nothing but a public client id. The token arrives in the URL fragment,
//! which browsers do not send to the server, so the loopback page hands it back with a fetch. It
//! is used once, to read the account's name and picture, and dropped: nothing long-lived is kept.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::i18n::t;
use crate::net_fetch::Net;

/// Public by design in OAuth2: it names the app and ships in every request. There is no secret.
pub const CLIENT_ID: &str = "1529830456697163867";
/// Discord matches redirect URIs exactly, so the port cannot be random.
pub const PORT: u16 = 53174;
const HOST: &str = "127.0.0.1";
const TIMEOUT: Duration = Duration::from_secs(3 * 60);
const AVATAR_MAX: usize = 256 * 1024;
const BODY_MAX: usize = 4096;

/// Whether this build carries an application id to sign in with.
pub fn is_configured() -> bool {
    !CLIENT_ID.is_empty()
}

// served on the loopback: pulls the token out of the fragment and posts it back to us
const CALLBACK_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Dota 2 Mod Manager</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#0e0e14;color:#e8e6f0;display:grid;place-items:center;height:100vh;margin:0}
.b{text-align:center;max-width:420px;padding:28px}.m{color:#a99ee0}</style>
<div class="b"><h2 id="h">Готово</h2><p class="m" id="p">Можно закрыть эту вкладку и вернуться в Mod Manager.</p></div>
<script>
  var f = location.hash.slice(1);
  if (!f) { document.getElementById('h').textContent = 'Не получилось';
            document.getElementById('p').textContent = 'Ответ Discord пришёл без токена.'; }
  else { fetch('/token', { method: 'POST', body: f }).catch(function () {}); }
</script>"#;

/// Where sign-in goes: the loopback port and Discord's two hosts. Tests point them elsewhere.
pub struct Endpoints {
    pub port: u16,
    pub authorize: String,
    pub api: String,
    pub cdn: String,
    pub timeout: Duration,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            port: PORT,
            authorize: "https://discord.com/oauth2/authorize".into(),
            api: "https://discord.com/api/v10".into(),
            cdn: "https://cdn.discordapp.com".into(),
            timeout: TIMEOUT,
        }
    }
}

fn respond(sock: &mut TcpStream, code: u16, body: &str) {
    let status = match code {
        200 => "OK",
        204 => "No Content",
        _ => "Not Found",
    };
    let head = if code == 204 {
        format!("HTTP/1.1 204 {status}\r\nconnection: close\r\n\r\n")
    } else {
        format!(
            "HTTP/1.1 {code} {status}\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
    };
    let _ = sock.write_all(head.as_bytes());
    if code != 204 {
        let _ = sock.write_all(body.as_bytes());
    }
}

/// One request: its method, its path and its body, or None for one too big or broken.
fn read_request(sock: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    sock.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    let head_end = loop {
        if let Some(i) = memchr::memmem::find(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > 16 * 1024 {
            return None;
        }
        let n = sock.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let (method, target) = (first.next()?.to_string(), first.next()?.to_string());
    let length: usize = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
        .unwrap_or(0);
    if length > BODY_MAX {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let n = sock.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    let path = target.split(['?', '#']).next().unwrap_or("").to_string();
    Some((method, path, body))
}

/// The loopback listener, open before the browser is sent off, so the redirect finds it.
pub fn listen(port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((HOST, port)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            t("Порт {0} занят — закрой другой вход и попробуй снова", &[json!(port)])
        } else {
            e.to_string()
        }
    })
}

/// Wait on the loopback for Discord to come back: the access token, or why there is none.
pub fn await_token(listener: TcpListener, state: &str, timeout: Duration) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + timeout;
    loop {
        if Instant::now() >= until {
            return Err(t("Вход занял слишком много времени", &[]));
        }
        let mut sock = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(30));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = sock.set_nonblocking(false);
        let Some((method, path, body)) = read_request(&mut sock) else { continue };
        match (method.as_str(), path.as_str()) {
            ("GET", "/callback") => respond(&mut sock, 200, CALLBACK_PAGE),
            ("POST", "/token") => {
                respond(&mut sock, 204, "");
                let q: Vec<(String, String)> = url::form_urlencoded::parse(&body).into_owned().collect();
                let get = |k: &str| q.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
                if get("state").as_deref() != Some(state) {
                    return Err(t("Ответ Discord не совпал с запросом", &[]));
                }
                return match get("access_token").filter(|x| !x.is_empty()) {
                    Some(token) => Ok(token),
                    None => Err(get("error_description")
                        .filter(|x| !x.is_empty())
                        .unwrap_or_else(|| t("Discord не выдал токен", &[]))),
                };
            }
            _ => respond(&mut sock, 404, "Not found"),
        }
    }
}

/// The address the browser is sent to.
pub fn authorize_url(base: &str, state: &str, port: u16) -> String {
    let redirect = format!("http://{HOST}:{port}/callback");
    let q = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("response_type", "token")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect)
        // name and avatar, nothing else: no email, no servers
        .append_pair("scope", "identify")
        .append_pair("state", state)
        .append_pair("prompt", "consent")
        .finish();
    format!("{base}?{q}")
}

/// Discord's avatar CDN is not in the window's CSP, and should not be: the picture once, as a data URI.
fn avatar_data_uri(net: &Net, cdn: &str, user: &Value) -> Value {
    let id = crate::js::string(user.get("id").unwrap_or(&Value::Null));
    let Some(avatar) = user.get("avatar").filter(|a| crate::js::truthy(a)).map(crate::js::string) else {
        return Value::Null;
    };
    match net.direct("GET", &format!("{cdn}/avatars/{id}/{avatar}.png?size=64"), &[], None, 15000) {
        Ok((status, body)) if (200..300).contains(&status) && body.len() <= AVATAR_MAX => {
            use base64::Engine;
            json!(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(body)))
        }
        _ => Value::Null,
    }
}

/// Opens the browser (`open`), waits for the redirect, and answers who signed in: id, name, avatar.
pub fn sign_in(net: &Net, at: &Endpoints, open: &dyn Fn(&str) -> Result<(), String>) -> Result<Value, String> {
    if !is_configured() {
        return Err(t("Вход через Discord пока не настроен в этой сборке", &[]));
    }
    let state = uuid::Uuid::new_v4().simple().to_string();
    let listener = listen(at.port)?;
    open(&authorize_url(&at.authorize, &state, at.port))?;
    let token = await_token(listener, &state, at.timeout)?;
    let auth = format!("Bearer {token}");
    let (status, body) = net
        .direct("GET", &format!("{}/users/@me", at.api), &[("authorization", &auth)], None, 15000)
        .map_err(|e| e.message)?;
    if !(200..300).contains(&status) {
        return Err(t("Discord не отдал профиль (HTTP {0})", &[json!(status)]));
    }
    let user: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    // the token has done its one job; it is never written to disk
    let name = ["global_name", "username"]
        .iter()
        .find_map(|k| user.get(*k).filter(|v| crate::js::truthy(v)))
        .map(crate::js::string)
        .unwrap_or_default();
    Ok(json!({
        "id": crate::js::string(user.get("id").unwrap_or(&Value::Null)),
        "username": crate::js::slice_utf16(&name, 80),
        "avatar": avatar_data_uri(net, &at.cdn, &user),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_browser_is_sent_with_the_state_and_the_loopback_redirect() {
        let u = authorize_url("https://discord.com/oauth2/authorize", "ab12", 53174);
        assert_eq!(
            u,
            "https://discord.com/oauth2/authorize?response_type=token&client_id=1529830456697163867&redirect_uri=http%3A%2F%2F127.0.0.1%3A53174%2Fcallback&scope=identify&state=ab12&prompt=consent"
        );
    }
}
