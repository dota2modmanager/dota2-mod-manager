//! The hand-off to the catalog's upload API (src/creator-upload.ts, issue #236): the form the
//! site posts, one zip holding one VPK per style, the token a release build carries, and the
//! worker's answer. The draft rules and the files are in creator.rs; this only puts them on the
//! wire.
//!
//! The worker behind h6rd/Dota2PornFxWeb's upload.html takes the form the site posts: the same
//! field names, the same rules and the same shape of files. The desktop app identifies itself
//! with a bearer token, which is what lets the worker skip the browser captcha; the app answers
//! a submission made with its own token as consent, so the terms are recorded here first.

use std::path::Path;

use serde_json::{json, Value};

use crate::i18n::t;
use crate::net_fetch::Net;
use crate::tools::creator::UploadStyle;

/// The worker the catalog's upload page posts to.
pub const UPLOAD_API: &str = "https://uploader.hrdq.workers.dev";
/// The terms version the app records when an author accepts them; must match the worker's.
pub const UPLOAD_CONSENT_VERSION: &str = "1";

const SUBMIT_TIMEOUT_MS: u64 = 120_000;
const HISTORY_TIMEOUT_MS: u64 = 20_000;
const MAGIC: &[u8] = b"D2MMUP01";
const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

/// The one network call this module makes, behind a trait so the tests answer it without a socket.
pub trait UploadTransport {
    fn direct(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, &str)],
        body: Option<&[u8]>,
        timeout_ms: u64,
    ) -> Result<(u16, Vec<u8>), String>;
}

impl UploadTransport for Net {
    fn direct(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, &str)],
        body: Option<&[u8]>,
        timeout_ms: u64,
    ) -> Result<(u16, Vec<u8>), String> {
        Net::direct(self, method, url, headers, body, timeout_ms).map_err(|e| e.message)
    }
}

impl<T: UploadTransport + ?Sized> UploadTransport for std::sync::Arc<T> {
    fn direct(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, &str)],
        body: Option<&[u8]>,
        timeout_ms: u64,
    ) -> Result<(u16, Vec<u8>), String> {
        (**self).direct(method, url, headers, body, timeout_ms)
    }
}

/// A zip holding exactly the one .vpk the upload API unpacks and checks.
pub fn vpk_archive(name: &str, vpk: &[u8]) -> Result<Vec<u8>, String> {
    crate::safe_zip::write_zip(&[(format!("{name}.vpk"), vpk.to_vec())])
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn non_empty(v: &Value, key: &str) -> Option<String> {
    let s = s(v, key);
    (!s.is_empty()).then_some(s)
}

/// A multipart/form-data body, built by hand: `Net::direct` sends bytes and a Content-Type, which
/// is all a FormData becomes on the wire.
struct Form {
    boundary: String,
    body: Vec<u8>,
}

/// A name in a Content-Disposition, with the quotes and line breaks that would end it escaped.
fn quoted(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '"' => vec!['\\', '"'],
            '\\' => vec!['\\', '\\'],
            '\r' => vec![' ', ' '],
            '\n' => vec![' ', ' '],
            c => vec![c],
        })
        .collect()
}

impl Form {
    fn new() -> Form {
        Form { boundary: format!("----d2mm{}", uuid::Uuid::new_v4().simple()), body: Vec::new() }
    }

    fn field(&mut self, name: &str, value: &str) {
        let head = format!("--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n", self.boundary, quoted(name));
        self.body.extend_from_slice(head.as_bytes());
        self.body.extend_from_slice(value.as_bytes());
        self.body.extend_from_slice(b"\r\n");
    }

    fn file(&mut self, name: &str, filename: &str, kind: &str, bytes: &[u8]) {
        let head = format!(
            "--{}\r\nContent-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
            self.boundary,
            quoted(name),
            quoted(filename),
            kind
        );
        self.body.extend_from_slice(head.as_bytes());
        self.body.extend_from_slice(bytes);
        self.body.extend_from_slice(b"\r\n");
    }

    /// The body and the Content-Type that names its boundary.
    fn finish(mut self) -> (Vec<u8>, String) {
        self.body.extend_from_slice(format!("--{}--\r\n", self.boundary).as_bytes());
        let kind = format!("multipart/form-data; boundary={}", self.boundary);
        (self.body, kind)
    }
}

/// The worker's own check for a mod name: when a hero's name carries an apostrophe or a hyphen,
/// the mod's name may not, so those become spaces and the runs of whitespace collapse.
fn worker_name(name: &str, hero: &str) -> String {
    if hero.is_empty() || !hero.contains(['\'', '-']) {
        return name.to_string();
    }
    let spaced: String = name.chars().map(|c| if c == '\'' || c == '-' { ' ' } else { c }).collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The form the site posts, built from a draft: its bytes and the Content-Type to send them with.
pub fn upload_form(draft: &Value, styles: &[UploadStyle]) -> Result<(Vec<u8>, String), String> {
    if styles.is_empty() {
        return Err(t("У мода нет файлов для загрузки", &[]));
    }
    let replaces = draft.get("replaces").cloned().unwrap_or(Value::Null);
    let update = crate::js::truthy(&replaces);
    if update && styles.len() > 1 {
        return Err(t("Обновить мод можно только одним стилем", &[]));
    }
    let draft_name = s(draft, "name");
    let existing_name = s(&replaces, "name");
    // an update is the published mod, under the name the catalog already knows
    let base_name = if update { existing_name.clone() } else { draft_name };
    let hero = s(draft, "hero");
    let category = if update { s(&replaces, "category") } else { s(draft, "category") };

    let mut f = Form::new();
    f.field("mode", if update { "update" } else { "new" });
    if update {
        f.field("existingName", &existing_name);
    }
    f.field("name", &worker_name(&base_name, &hero));
    f.field("category", &category);
    f.field("hero", &hero);
    if let Some(sub) = non_empty(draft, "subcategory") {
        f.field("subcategory", &sub);
    }
    // the catalog's tag switches, as the worker stores them
    let tags = draft.get("tags").cloned().unwrap_or_else(|| json!({}));
    f.field("tags", &crate::js::stringify(&tags, ""));

    // the site's three choices: a name the catalog lists, a new one, or nobody (Anonymous)
    if !update {
        let mode = s(draft, "authorMode");
        let author = s(draft, "author");
        if mode == "existing" && !author.is_empty() {
            f.field("authorMode", "existing");
            f.field("authorName", &author);
        } else if mode == "new" && !author.is_empty() {
            f.field("authorMode", "new");
            f.field("authorName", &author);
            if let Some(url) = non_empty(draft, "authorUrl") {
                f.field("authorUrl", &url);
            }
        } else {
            f.field("authorMode", "new");
            f.field("authorName", "Anonymous");
        }
    }

    let extra_mode = s(draft, "extraMode");
    f.field("extraMode", &extra_mode);
    if let Some(extra_name) = non_empty(draft, "extraName").filter(|_| extra_mode != "none") {
        if s(draft, "extraOrigin") == "existing" {
            f.field("extraExistingName", &extra_name);
        } else {
            f.field("extraName", &extra_name);
            if let Some(url) = non_empty(draft, "extraUrl") {
                f.field("extraUrl", &url);
            }
        }
    }
    if let Some(video) = non_empty(draft, "video") {
        f.field("previewVideo", &video);
    }

    if styles.len() > 1 {
        f.field("styled", "1");
        let list: Vec<Value> = styles.iter().map(|st| json!({ "label": st.label, "colors": st.colors })).collect();
        f.field("styles", &crate::js::stringify(&Value::Array(list), ""));
    }
    for (i, style) in styles.iter().enumerate() {
        let suffix = if i == 0 { String::new() } else { format!(" Style {}", i + 1) };
        let base = format!("{base_name}{suffix}");
        let zip = vpk_archive(&base, &style.vpk)?;
        let (zip_field, preview_field) = if i == 0 {
            ("modZip".to_string(), "preview".to_string())
        } else {
            (format!("modZip{}", i + 1), format!("preview{}", i + 1))
        };
        f.file(&zip_field, &format!("{base}.zip"), "application/zip", &zip);
        f.file(&preview_field, &format!("{base}.webp"), "image/webp", &style.preview);
    }
    Ok(f.finish())
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

/// What the worker answers a successful submission with: the catalog id and the pull request it opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadReply {
    pub id: String,
    pub pr_url: String,
}

/// POST /api/submit with the form above; the worker answers with the pull request it opened.
pub fn submit_mod<T: UploadTransport + ?Sized>(
    net: &T,
    draft: &Value,
    styles: &[UploadStyle],
    token: &str,
    api: &str,
) -> Result<UploadReply, String> {
    let (body, kind) = upload_form(draft, styles)?;
    let auth = bearer(token);
    let headers = [("Authorization", auth.as_str()), ("Content-Type", kind.as_str())];
    let (status, bytes) = net.direct("POST", &format!("{api}/api/submit"), &headers, Some(&body), SUBMIT_TIMEOUT_MS)?;
    let data: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let obj = data.as_object();
    let error = obj.and_then(|o| o.get("error")).filter(|v| crate::js::truthy(v));
    let pr = obj.and_then(|o| o.get("prUrl")).and_then(Value::as_str);
    if !(200..300).contains(&status) || error.is_some() || pr.is_none() {
        let message = obj.and_then(|o| o.get("message")).filter(|v| crate::js::truthy(v)).map(crate::js::string);
        let message = message
            .or_else(|| error.map(crate::js::string))
            .unwrap_or_else(|| t("Загрузка не удалась: HTTP {0}", &[json!(status)]));
        return Err(message);
    }
    let id = obj.and_then(|o| o.get("id")).filter(|v| crate::js::truthy(v)).map(crate::js::string).unwrap_or_default();
    Ok(UploadReply { id, pr_url: pr.unwrap_or_default().to_string() })
}

/// GET /api/history, for the key's owner; a failure is an empty history, not an error the window
/// has to show, since the list is only a convenience.
pub fn history<T: UploadTransport + ?Sized>(net: &T, token: &str, api: &str) -> Vec<Value> {
    if token.is_empty() {
        return Vec::new();
    }
    let auth = bearer(token);
    let Ok((status, bytes)) =
        net.direct("GET", &format!("{api}/api/history"), &[("Authorization", &auth)], None, HISTORY_TIMEOUT_MS)
    else {
        return Vec::new();
    };
    if !(200..300).contains(&status) {
        return Vec::new();
    }
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|d| d.get("items").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

/// The key the token file is encrypted with. tools/release/uploader-token.mjs derives the same one.
fn key() -> [u8; 32] {
    use sha2::Digest;
    let material = ["d2pfx-uploader-token", "v1", "dota2-mod-manager"].join("\0");
    sha2::Sha256::digest(material.as_bytes()).into()
}

/// The token in the file's format (magic, IV, authentication tag, ciphertext), or None when the
/// file is missing, truncated or tampered with. This is a speed bump, not a secret: the key
/// travels inside the app too, so anybody who unpacks it can read the token.
pub fn decode_embedded_token(raw: &[u8]) -> Option<String> {
    use aes_gcm::aead::{Aead, Payload};
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    if raw.len() <= MAGIC.len() + IV_BYTES + TAG_BYTES || &raw[..MAGIC.len()] != MAGIC {
        return None;
    }
    let iv = &raw[MAGIC.len()..MAGIC.len() + IV_BYTES];
    let tag = &raw[MAGIC.len() + IV_BYTES..MAGIC.len() + IV_BYTES + TAG_BYTES];
    // aes-gcm takes the tag as the ciphertext's tail, while the file keeps it before the bytes
    let mut sealed = raw[MAGIC.len() + IV_BYTES + TAG_BYTES..].to_vec();
    sealed.extend_from_slice(tag);
    let cipher = Aes256Gcm::new_from_slice(&key()).ok()?;
    let plain = cipher.decrypt(Nonce::from_slice(iv), Payload { msg: &sealed, aad: b"" }).ok()?;
    let token = String::from_utf8(plain).ok()?.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// The token built into this copy of the app: build/stats/uploader-token.bin, written by
/// tools/release/uploader-token.mjs from the repository secret. A source checkout has none, so sending
/// is unavailable there; a fork's build has none either.
pub fn embedded_upload_token(app_root: &Path) -> Option<String> {
    let raw = std::fs::read(app_root.join("build").join("stats").join("uploader-token.bin")).ok()?;
    decode_embedded_token(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(label: &str, vpk: u8, preview: &str) -> UploadStyle {
        UploadStyle {
            label: label.into(),
            colors: vec!["#ddd4ff".into()],
            vpk: vec![vpk; 16],
            preview: preview.as_bytes().to_vec(),
        }
    }

    fn draft(over: Value) -> Value {
        let mut d = json!({
            "name": "Blue Glow", "category": "heroes", "subcategory": "", "hero": "Anti-Mage",
            "authorMode": "new", "author": "me", "authorUrl": "", "extraMode": "none",
            "extraOrigin": "existing", "extraName": "", "extraUrl": "", "video": "",
            "tags": { "base": true }, "replaces": Value::Null,
        });
        if let (Some(base), Some(extra)) = (d.as_object_mut(), over.as_object()) {
            for (k, v) in extra {
                base.insert(k.clone(), v.clone());
            }
        }
        d
    }

    fn body_text(body: &[u8]) -> String {
        String::from_utf8_lossy(body).into_owned()
    }

    #[test]
    fn the_form_has_the_sites_fields_and_flattens_a_heros_hyphen() {
        let (body, kind) = upload_form(&draft(json!({})), &[style("", 1, "RIFF....WEBP")]).unwrap();
        let text = body_text(&body);
        assert!(kind.starts_with("multipart/form-data; boundary=----d2mm"));
        assert!(text.contains("name=\"mode\"\r\n\r\nnew\r\n"), "{text}");
        assert!(text.contains("name=\"name\"\r\n\r\nBlue Glow\r\n"));
        assert!(text.contains("name=\"category\"\r\n\r\nheroes\r\n"));
        assert!(text.contains("name=\"hero\"\r\n\r\nAnti-Mage\r\n"));
        assert!(text.contains("name=\"authorName\"\r\n\r\nme\r\n"));
        assert!(text.contains("name=\"tags\"\r\n\r\n{\"base\":true}\r\n"));
        assert!(!text.contains("name=\"styled\""));
        assert!(text.contains("name=\"modZip\"; filename=\"Blue Glow.zip\""));
        assert!(text.contains("name=\"preview\"; filename=\"Blue Glow.webp\""));
    }

    #[test]
    fn two_styles_are_styled_and_each_carries_its_own_zip() {
        let styles = [style("Day", 1, "a"), style("Night", 2, "b")];
        let (body, _) = upload_form(&draft(json!({})), &styles).unwrap();
        let text = body_text(&body);
        assert!(text.contains("name=\"styled\"\r\n\r\n1\r\n"));
        assert!(text.contains("\"label\":\"Night\""));
        assert!(text.contains("name=\"modZip2\"; filename=\"Blue Glow Style 2.zip\""));
        assert!(text.contains("name=\"preview2\"; filename=\"Blue Glow Style 2.webp\""));
    }

    #[test]
    fn an_update_takes_the_published_name_and_only_one_style() {
        let d = draft(json!({ "name": "Ignored", "replaces": { "category": "heroes", "name": "Blue Glow" } }));
        let (body, _) = upload_form(&d, &[style("", 1, "a")]).unwrap();
        let text = body_text(&body);
        assert!(text.contains("name=\"mode\"\r\n\r\nupdate\r\n"));
        assert!(text.contains("name=\"existingName\"\r\n\r\nBlue Glow\r\n"));
        assert!(!text.contains("name=\"authorMode\""));
        assert!(upload_form(&d, &[style("a", 1, "a"), style("b", 2, "b")]).is_err());
    }

    #[test]
    fn a_hero_with_a_trait_keeps_its_name_free_of_one() {
        assert_eq!(worker_name("Anti - Mage  Glow", "Anti-Mage"), "Anti Mage Glow");
        assert_eq!(worker_name("Keeper's Glow", "Keeper of the Light"), "Keeper's Glow");
        assert_eq!(worker_name("Blue-Glow", "Axe"), "Blue-Glow");
    }

    #[derive(Clone, Debug)]
    struct Call {
        method: String,
        url: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
        timeout_ms: u64,
    }

    struct Fake {
        reply: Result<(u16, Vec<u8>), String>,
        calls: std::sync::Mutex<Vec<Call>>,
    }

    impl Fake {
        fn answer(status: u16, body: &str) -> Fake {
            Fake { reply: Ok((status, body.as_bytes().to_vec())), calls: std::sync::Mutex::new(Vec::new()) }
        }

        fn broken(message: &str) -> Fake {
            Fake { reply: Err(message.into()), calls: std::sync::Mutex::new(Vec::new()) }
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl UploadTransport for Fake {
        fn direct(
            &self,
            method: &str,
            url: &str,
            headers: &[(&str, &str)],
            body: Option<&[u8]>,
            timeout_ms: u64,
        ) -> Result<(u16, Vec<u8>), String> {
            self.calls.lock().unwrap().push(Call {
                method: method.into(),
                url: url.into(),
                headers: headers.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect(),
                body: body.unwrap_or_default().to_vec(),
                timeout_ms,
            });
            self.reply.clone()
        }
    }

    #[test]
    fn a_successful_submission_is_a_post_with_the_bearer_and_the_workers_pull_request() {
        let fake = Fake::answer(200, r#"{"id":"abc","prUrl":"https://github.com/x/y/pull/1"}"#);
        let reply =
            submit_mod(&fake, &draft(json!({})), &[style("", 1, "RIFF....WEBP")], "d2pfx_x", "https://api.test")
                .unwrap();
        assert_eq!(reply.id, "abc");
        assert_eq!(reply.pr_url, "https://github.com/x/y/pull/1");
        let calls = fake.calls();
        assert_eq!(calls.len(), 1);
        let call = &calls[0];
        assert_eq!(call.method, "POST");
        assert_eq!(call.url, "https://api.test/api/submit");
        assert_eq!(call.timeout_ms, SUBMIT_TIMEOUT_MS);
        assert!(call.headers.contains(&("Authorization".into(), "Bearer d2pfx_x".into())));
        assert!(call
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Type" && v.starts_with("multipart/form-data; boundary=")));
        assert!(body_text(&call.body).contains("name=\"mode\"\r\n\r\nnew\r\n"));
    }

    #[test]
    fn a_worker_refusal_reaches_the_author_as_its_own_message() {
        let fake = Fake::answer(429, r#"{"error":"rate_limited","message":"Wait a bit"}"#);
        let err = submit_mod(&fake, &draft(json!({})), &[style("", 1, "RIFF....WEBP")], "d2pfx_x", "https://api.test")
            .unwrap_err();
        assert_eq!(err, "Wait a bit");
    }

    #[test]
    fn a_plain_http_failure_is_named_by_its_status() {
        let fake = Fake::answer(500, "the worker fell over");
        let err = submit_mod(&fake, &draft(json!({})), &[style("", 1, "RIFF....WEBP")], "d2pfx_x", "https://api.test")
            .unwrap_err();
        assert_eq!(err, t("Загрузка не удалась: HTTP {0}", &[json!(500)]));
    }

    #[test]
    fn a_transport_error_is_passed_through_and_nothing_is_parsed() {
        let fake = Fake::broken("connection refused");
        let err = submit_mod(&fake, &draft(json!({})), &[style("", 1, "RIFF....WEBP")], "d2pfx_x", "https://api.test")
            .unwrap_err();
        assert_eq!(err, "connection refused");
    }

    #[test]
    fn upload_history_reads_the_items_with_the_bearer_and_fails_quietly() {
        let fake = Fake::answer(200, r#"{"items":[{"name":"Blue Glow","status":"accepted"}]}"#);
        let items = history(&fake, "d2pfx_x", "https://api.test");
        assert_eq!(items, vec![json!({ "name": "Blue Glow", "status": "accepted" })]);
        let calls = fake.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, "GET");
        assert_eq!(calls[0].url, "https://api.test/api/history");
        assert_eq!(calls[0].timeout_ms, HISTORY_TIMEOUT_MS);
        assert_eq!(calls[0].headers, vec![("Authorization".to_string(), "Bearer d2pfx_x".to_string())]);
        assert!(calls[0].body.is_empty());

        let refused = Fake::answer(403, r#"{"error":"forbidden"}"#);
        assert!(history(&refused, "d2pfx_x", "https://api.test").is_empty());
        let offline = Fake::broken("offline");
        assert!(history(&offline, "d2pfx_x", "https://api.test").is_empty());

        let none = Fake::answer(200, r#"{"items":[{"name":"x"}]}"#);
        assert!(history(&none, "", "https://api.test").is_empty());
        assert!(none.calls().is_empty(), "a build with no token asks nothing");
    }

    /// One HTTP exchange on 127.0.0.1: the request as the worker would read it, and its answer.
    fn worker_once(status: u16, reply: &'static str) -> (String, std::thread::JoinHandle<(String, Vec<u8>)>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 64 * 1024];
            let (head, body) = loop {
                let n = sock.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
                if let Some(at) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..at]).into_owned();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().to_string())
                        })
                        .map_or(0, |v| v.parse::<usize>().unwrap());
                    while raw.len() < at + 4 + length {
                        let n = sock.read(&mut buf).unwrap();
                        raw.extend_from_slice(&buf[..n]);
                    }
                    break (head, raw[at + 4..at + 4 + length].to_vec());
                }
            };
            let answer = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                reply.len()
            );
            sock.write_all(answer.as_bytes()).unwrap();
            (head, body)
        });
        (api, worker)
    }

    /// The part of a multipart body under this field name: its bytes, without the part's headers.
    fn part<'a>(body: &'a [u8], boundary: &str, name: &str) -> &'a [u8] {
        let marker = format!("name=\"{name}\"");
        let start = body.windows(marker.len()).position(|w| w == marker.as_bytes()).expect(name);
        let from = start + body[start..].windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let end_marker = format!("\r\n--{boundary}");
        let len = body[from..].windows(end_marker.len()).position(|w| w == end_marker.as_bytes()).unwrap();
        &body[from..from + len]
    }

    #[test]
    fn a_submission_through_the_real_network_layer_carries_one_vpk_per_zip() {
        let (api, worker) = worker_once(200, r#"{"id":"local1","prUrl":"https://github.com/x/y/pull/9"}"#);
        let net = Net::new(|| 0.0);
        let vpk: Vec<u8> =
            crate::vpk::SIGNATURE.to_le_bytes().iter().copied().chain((0..200_000).map(|i| i as u8)).collect();
        let styles = [
            UploadStyle {
                label: "Day".into(),
                colors: vec!["#ddd4ff".into()],
                vpk: vpk.clone(),
                preview: b"RIFF0000WEBP".to_vec(),
            },
            UploadStyle {
                label: "Night".into(),
                colors: vec!["#ff8f8f".into(), "#8fd3ff".into()],
                vpk: vpk.clone(),
                preview: b"RIFF1111WEBP".to_vec(),
            },
        ];
        let reply = submit_mod(&net, &draft(json!({})), &styles, "d2pfx_local", &api).unwrap();
        assert_eq!(reply, UploadReply { id: "local1".into(), pr_url: "https://github.com/x/y/pull/9".into() });

        let (head, body) = worker.join().unwrap();
        assert!(head.starts_with("POST /api/submit HTTP/1.1"), "{head}");
        assert!(head.lines().any(|l| l.eq_ignore_ascii_case("authorization: Bearer d2pfx_local")), "{head}");
        let boundary = head
            .lines()
            .find_map(|l| l.split_once("boundary=").map(|(_, b)| b.trim().to_string()))
            .expect("a multipart Content-Type");
        assert!(body.ends_with(format!("--{boundary}--\r\n").as_bytes()));
        assert_eq!(part(&body, &boundary, "styled"), b"1");
        let listed: Value = serde_json::from_slice(part(&body, &boundary, "styles")).unwrap();
        assert_eq!(listed[1], json!({ "label": "Night", "colors": ["#ff8f8f", "#8fd3ff"] }));
        assert_eq!(part(&body, &boundary, "preview2"), b"RIFF1111WEBP");
        for (field, inside) in [("modZip", "Blue Glow.vpk"), ("modZip2", "Blue Glow Style 2.vpk")] {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(part(&body, &boundary, field).to_vec())).unwrap();
            assert_eq!(zip.len(), 1, "{field} holds exactly one file");
            let mut entry = zip.by_index(0).unwrap();
            assert_eq!(entry.name().unwrap(), inside);
            let mut got = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut got).unwrap();
            assert_eq!(got, vpk, "{field} carries the VPK byte for byte");
        }
    }

    #[test]
    fn a_refusal_through_the_real_network_layer_keeps_the_workers_words() {
        let (api, worker) = worker_once(401, r#"{"error":"unauthorized","message":"Bad token"}"#);
        let err = submit_mod(&Net::new(|| 0.0), &draft(json!({})), &[style("", 1, "RIFF....WEBP")], "nope", &api)
            .unwrap_err();
        worker.join().unwrap();
        assert_eq!(err, "Bad token");
    }

    #[test]
    fn the_embedded_token_reads_back_and_a_changed_byte_is_refused() {
        let token = "d2pfx_test_0123456789abcdef";
        let sealed = seal(token);
        assert_eq!(decode_embedded_token(&sealed).as_deref(), Some(token));
        assert_eq!(decode_embedded_token(b"not a token"), None);
        let mut tampered = sealed.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert_eq!(decode_embedded_token(&tampered), None);
    }

    #[test]
    fn a_file_the_release_tool_wrote_reads_back_here() {
        // written by tools/release/uploader-token.mjs; test/uploader-token.test.ts reads it with the tool's key
        let raw = include_bytes!("../../../../test/fixtures/uploader-token.bin");
        assert_eq!(decode_embedded_token(raw).as_deref(), Some("d2pfx_test_0123456789abcdef"));

        let root = std::env::temp_dir().join(format!("mm-upload-token-{}", uuid::Uuid::new_v4().simple()));
        assert_eq!(embedded_upload_token(&root), None, "a build without the file has no token");
        std::fs::create_dir_all(root.join("build").join("stats")).unwrap();
        std::fs::write(root.join("build").join("stats").join("uploader-token.bin"), raw).unwrap();
        assert_eq!(embedded_upload_token(&root).as_deref(), Some("d2pfx_test_0123456789abcdef"));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn seal(token: &str) -> Vec<u8> {
        use aes_gcm::aead::{Aead, Payload};
        use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
        let iv = [7u8; IV_BYTES];
        let cipher = Aes256Gcm::new_from_slice(&key()).unwrap();
        let sealed = cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: token.as_bytes(), aad: b"" }).unwrap();
        let (data, tag) = sealed.split_at(sealed.len() - TAG_BYTES);
        let mut out = MAGIC.to_vec();
        out.extend_from_slice(&iv);
        out.extend_from_slice(tag);
        out.extend_from_slice(data);
        out
    }
}
