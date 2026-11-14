//! A GLB with its pictures inside (src/glb-embed.ts, issue #417).
//!
//! The toolchain exports a model as a GLB whose textures are PNG files beside it, named by
//! relative links. The window reads a model from the bytes it is handed, with no folder to follow
//! a link into, so each linked picture goes into the GLB's binary chunk and the image points at
//! its slice of it: one file the three.js loader takes as it is.

use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

const MAGIC: u32 = 0x4654_6c67; // 'glTF'
const JSON_CHUNK: u32 = 0x4e4f_534a;
const BIN_CHUNK: u32 = 0x004e_4942;

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// The GLB's JSON and binary chunks.
pub fn read_glb(buf: &[u8]) -> Result<(Value, Vec<u8>), String> {
    if buf.len() < 20 || u32_at(buf, 0) != MAGIC || u32_at(buf, 4) != 2 {
        return Err("not a GLB 2.0 file".into());
    }
    let mut at = 12;
    let mut json = None;
    let mut bin = Vec::new();
    while at + 8 <= buf.len() {
        let len = u32_at(buf, at) as usize;
        let ty = u32_at(buf, at + 4);
        let body = &buf[(at + 8).min(buf.len())..(at + 8).saturating_add(len).min(buf.len())];
        if ty == JSON_CHUNK {
            json = Some(serde_json::from_str::<Value>(&String::from_utf8_lossy(body)).map_err(|e| e.to_string())?);
        } else if ty == BIN_CHUNK {
            bin = body.to_vec();
        }
        at = at.saturating_add(8 + len);
    }
    json.map(|j| (j, bin)).ok_or_else(|| "a GLB without its JSON".into())
}

/// A GLB out of its two chunks, each padded as the format wants.
pub fn write_glb(json: &Value, bin: &[u8]) -> Vec<u8> {
    let mut text = crate::js::stringify(json, "").into_bytes();
    text.resize(pad4(text.len()), 0x20);
    let mut data = bin.to_vec();
    data.resize(pad4(data.len()), 0);
    let mut out = Vec::with_capacity(28 + text.len() + data.len());
    out.extend_from_slice(&MAGIC.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&JSON_CHUNK.to_le_bytes());
    out.extend_from_slice(&text);
    if !data.is_empty() {
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&BIN_CHUNK.to_le_bytes());
        out.extend_from_slice(&data);
    }
    let n = out.len() as u32;
    out[8..12].copy_from_slice(&n.to_le_bytes());
    out
}

/// A grey PNG of one pixel: what a picture that cannot be had becomes, since an image with no data
/// fails its whole material.
pub fn blank_png() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        .unwrap_or_default()
}

/// decodeURIComponent: %XX escapes as UTF-8, refused when one is broken.
fn decode_uri_component(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit()));
            let Some(hex) = hex else { return Err("URI malformed".into()) };
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "URI malformed".into())
}

/// path.resolve(dir, rel): `rel` taken from `dir` unless it is absolute, with . and .. walked.
fn resolve(dir: &Path, rel: &str) -> PathBuf {
    let joined = dir.join(rel);
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

fn same(a: &Component, b: &Component) -> bool {
    if cfg!(windows) {
        a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Whether `at` is inside `dir`, as path.relative sees it: not above it, not elsewhere, and not
/// a name that starts with "..".
fn inside(dir: &Path, at: &Path) -> bool {
    let d: Vec<Component> = dir.components().filter(|c| !matches!(c, Component::CurDir)).collect();
    let a: Vec<Component> = at.components().collect();
    if a.len() < d.len() || !d.iter().zip(&a).all(|(x, y)| same(x, y)) {
        return false;
    }
    a.get(d.len()).is_none_or(|first| !first.as_os_str().to_string_lossy().starts_with(".."))
}

fn mime_of(p: &Path) -> Option<&'static str> {
    let name = p.file_name()?.to_string_lossy().to_lowercase();
    let dot = name.rfind('.').filter(|&i| i > 0)?;
    match &name[dot..] {
        ".png" => Some("image/png"),
        ".jpg" | ".jpeg" => Some("image/jpeg"),
        ".webp" => Some("image/webp"),
        _ => None,
    }
}

/// The GLB at `file` with every picture it links to put inside it. A link that leaves the GLB's
/// folder, or names a file that is not there, gets the blank pixel: the model shows without it.
pub fn embed_glb(file: &Path) -> Result<Vec<u8>, String> {
    let (mut json, bin) = read_glb(&std::fs::read(file).map_err(|e| e.to_string())?)?;
    let parent = file.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let dir = resolve(&std::path::absolute(parent).map_err(|e| e.to_string())?, "");
    let mut all = bin.clone();
    all.resize(pad4(bin.len()), 0);
    if !json.get("bufferViews").is_some_and(|v| !v.is_null()) {
        json["bufferViews"] = json!([]);
    }
    let images = json.get("images").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut images_out = Vec::with_capacity(images.len());
    for mut img in images {
        let uri = img.get("uri").and_then(Value::as_str).map(String::from);
        let Some(uri) = uri.filter(|u| !u.is_empty() && !u.starts_with("data:")) else {
            images_out.push(img);
            continue;
        };
        let at = resolve(&dir, &decode_uri_component(&uri)?);
        let mime = mime_of(&at);
        if let Some(o) = img.as_object_mut() {
            o.shift_remove("uri");
        }
        let ok = mime.is_some() && inside(&dir, &at) && at.exists();
        let data = if ok { std::fs::read(&at).map_err(|e| e.to_string())? } else { blank_png() };
        let views = json["bufferViews"].as_array_mut().ok_or("json.bufferViews.push is not a function")?;
        views.push(json!({ "buffer": 0, "byteOffset": all.len(), "byteLength": data.len() }));
        let view = views.len() - 1;
        img["bufferView"] = json!(view);
        img["mimeType"] = json!(if ok { mime.unwrap_or("image/png") } else { "image/png" });
        all.extend_from_slice(&data);
        all.resize(pad4(all.len()), 0);
        images_out.push(img);
    }
    if json.get("images").is_some_and(Value::is_array) {
        json["images"] = Value::Array(images_out);
    }
    json["buffers"] = json!([{ "byteLength": all.len() }]);
    Ok(write_glb(&json, &all))
}
