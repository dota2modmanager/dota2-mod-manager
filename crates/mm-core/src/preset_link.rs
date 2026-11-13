//! Presets as a link (src/preset-link.ts): "d2mm://preset/<code>", where <code> is the whole
//! preset squeezed into a pasteable string: short keys, mods as bare arrays, raw deflate,
//! base64url. Only catalog mods and free cosmetic picks travel this way; a mod the receiver
//! cannot fetch goes as a .d2mm file (`preset_share.rs`).
//!
//! The deflate is miniz's, not zlib's: a link Rust makes is a different string from the one the
//! TypeScript makes for the same preset, and each side reads the other's.

use std::sync::OnceLock;

use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};

use crate::i18n::t;
use crate::js::{slice_utf16, string, truthy};

/// The URL scheme the app registers with Windows, so d2mm://preset/... opens it.
pub const SCHEME: &str = "d2mm";
/// The clickable wrapper: chat clients only linkify http(s). The code rides in the fragment,
/// which browsers never send to a server.
const WEB_BASE: &str = "https://dota2modmanager.com/p/";
const MAX_CODE: usize = 64 * 1024;
/// inflate bomb guard
const MAX_JSON: usize = 512 * 1024;
const MAX_MODS: usize = 500;
/// The first slot of a cosmetic entry: no real categoryId is ever "$cos".
const COSMETIC_TAG: &str = "$cos";

/// A link: the clickable form, the raw one, and the code itself.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Encoded {
    pub code: String,
    pub web: String,
    pub direct: String,
}

fn b64() -> base64::engine::GeneralPurpose {
    let cfg = base64::engine::GeneralPurposeConfig::new()
        .with_encode_padding(false)
        .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true);
    base64::engine::GeneralPurpose::new(&base64::alphabet::URL_SAFE, cfg)
}

/// A preset into a link. `mods` are records or link entries: a cosmetic pick by `kind`, anything
/// else as a catalog mod by category, name and style.
pub fn encode_preset_link(name: &Value, author: &Value, mods: &[Value]) -> Encoded {
    let get = |m: &Value, k: &str| m.get(k).cloned().unwrap_or(Value::Null);
    let m: Vec<Value> = mods
        .iter()
        .map(|m| {
            if m.get("kind").and_then(Value::as_str) == Some("cosmetic") {
                let effect = m.get("effectId").filter(|e| truthy(e)).cloned().unwrap_or(json!(""));
                json!([COSMETIC_TAG, get(m, "slot"), get(m, "itemId"), get(m, "name"), effect])
            } else if m.get("styleLabel").is_some_and(truthy) {
                json!([get(m, "categoryId"), get(m, "name"), get(m, "styleLabel")])
            } else {
                json!([get(m, "categoryId"), get(m, "name")])
            }
        })
        .collect();
    let n = if truthy(name) { slice_utf16(&string(name), 120) } else { String::new() };
    let mut payload = json!({ "v": 1, "n": n, "m": m });
    if truthy(author) {
        payload["a"] = json!(slice_utf16(&string(author), 80));
    }
    let text = crate::js::stringify(&payload, "");
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    std::io::Write::write_all(&mut enc, text.as_bytes()).expect("deflate into memory");
    let code = b64().encode(enc.finish().expect("deflate into memory"));
    Encoded { web: format!("{WEB_BASE}#{code}"), direct: format!("{SCHEME}://preset/{code}"), code }
}

/// Pull the code out of whatever got pasted: the web link, the d2mm:// link or the bare code,
/// with the spaces, brackets and backticks chat clients wrap it in, and the trailing slash
/// Windows hands a clicked link over with.
fn code_from(input: &Value) -> String {
    static WRAP: OnceLock<Regex> = OnceLock::new();
    static DIRECT: OnceLock<Regex> = OnceLock::new();
    let wrap = WRAP.get_or_init(|| Regex::new(r#"^[<`'"]+|[>`'"]+$"#).unwrap());
    let direct = DIRECT.get_or_init(|| Regex::new(&format!("(?i)^{SCHEME}://preset/")).unwrap());
    let raw = if truthy(input) { string(input) } else { String::new() };
    let s = crate::js::trim(&raw);
    let s = wrap.replace_all(s, "");
    let mut s = crate::js::trim(&s).to_string();
    if let Some(at) = s.rfind('#') {
        s = s[at + 1..].to_string();
    } else {
        s = direct.replace(&s, "").into_owned();
    }
    crate::js::trim(s.trim_end_matches('/')).to_string()
}

/// Raw inflate that refuses a stream with no end and one that grows past `max`, as
/// `zlib.inflateRawSync` with `maxOutputLength` does.
fn inflate_raw(data: &[u8], max: usize) -> Option<Vec<u8>> {
    let mut d = flate2::Decompress::new(false);
    let mut out: Vec<u8> = Vec::with_capacity(4096);
    loop {
        if out.len() > max {
            return None;
        }
        if out.len() == out.capacity() {
            out.reserve(out.len().max(4096));
        }
        let (was_in, was_out) = (d.total_in(), d.total_out());
        let status = d.decompress_vec(&data[d.total_in() as usize..], &mut out, flate2::FlushDecompress::None).ok()?;
        if out.len() > max {
            return None;
        }
        if status == flate2::Status::StreamEnd {
            return Some(out);
        }
        // nothing read and nothing made: the stream stops before its end
        if d.total_in() == was_in && d.total_out() == was_out {
            return None;
        }
    }
}

/// A preset as a link carries it: its name, its author and its mods.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Decoded {
    pub name: String,
    pub author: String,
    pub mods: Vec<Value>,
}

/// A pasted link, in either form, back into a preset. The error is written for the user: not a
/// link, damaged, or holding too much.
pub fn decode_preset_link(input: &Value) -> Result<Decoded, String> {
    let code = code_from(input);
    if code.is_empty() || !code.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return Err(t("Это не похоже на ссылку на пресет", &[]));
    }
    if code.len() > MAX_CODE {
        return Err(t("Ссылка слишком длинная", &[]));
    }
    let damaged = || t("Ссылка повреждена", &[]);
    // Node drops a dangling sixth bit group; the decoder here would refuse it
    let usable = &code[..code.len() - usize::from(code.len() % 4 == 1)];
    let packed = b64().decode(usable).map_err(|_| damaged())?;
    let json = inflate_raw(&packed, MAX_JSON).ok_or_else(damaged)?;
    let raw: Value = serde_json::from_str(&String::from_utf8_lossy(&json)).map_err(|_| damaged())?;
    let list = match (&raw, raw.get("v").and_then(Value::as_f64), raw.get("m")) {
        (Value::Object(_), Some(1.0), Some(Value::Array(m))) => m,
        _ => return Err(damaged()),
    };
    if list.len() > MAX_MODS {
        return Err(t("Слишком много модов в пресете", &[]));
    }
    let text_of = |v: Option<&Value>| match v {
        None | Some(Value::Null) => String::new(),
        Some(v) => string(v),
    };
    let mods = list
        .iter()
        .filter_map(|e| {
            let e = e.as_array()?;
            let (first, second) = (e.first()?.as_str()?, e.get(1)?.as_str()?);
            Some(if first == COSMETIC_TAG {
                let slot = slice_utf16(second, 60);
                let item = slice_utf16(&text_of(e.get(2)), 20);
                if slot.is_empty() || item.is_empty() {
                    return None;
                }
                json!({
                    "kind": "cosmetic",
                    "slot": slot,
                    "itemId": item,
                    "name": slice_utf16(&text_of(e.get(3)), 300),
                    "effectId": e.get(4).and_then(Value::as_str).map(|s| slice_utf16(s, 60)).unwrap_or_default(),
                })
            } else {
                json!({
                    "kind": "catalog",
                    "categoryId": slice_utf16(first, 60),
                    "name": slice_utf16(second, 300),
                    "styleLabel": e.get(2).and_then(Value::as_str).map(|s| slice_utf16(s, 300)),
                    "fp": null,
                })
            })
        })
        .collect();
    let text =
        |k: &str, max: usize| raw.get(k).and_then(Value::as_str).map(|s| slice_utf16(s, max)).unwrap_or_default();
    let name = text("n", 120);
    Ok(Decoded { name: if name.is_empty() { t("Пресет", &[]) } else { name }, author: text("a", 80), mods })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_reads_back_in_every_form_it_is_pasted_in() {
        let mods = [
            json!({ "categoryId": "huds", "name": "Hud One", "styleLabel": "gray" }),
            json!({ "kind": "cosmetic", "slot": "item:axe:head", "itemId": 123, "name": "Helm", "effectId": "fx-fire" }),
        ];
        let e = encode_preset_link(&json!("Build"), &json!("me"), &mods);
        for pasted in
            [e.code.clone(), e.web.clone(), format!(" <{}/> ", e.direct), format!("`D2MM://preset/{}`", e.code)]
        {
            let d = decode_preset_link(&json!(pasted)).unwrap();
            assert_eq!(d.name, "Build");
            assert_eq!(d.author, "me");
            assert_eq!(d.mods[0]["styleLabel"], "gray");
            assert_eq!(d.mods[1]["itemId"], "123");
        }
    }

    #[test]
    fn a_damaged_or_truncated_link_is_refused() {
        let e = encode_preset_link(&json!("Build"), &Value::Null, &[json!({ "categoryId": "huds", "name": "A" })]);
        assert!(decode_preset_link(&json!(&e.code[..e.code.len() / 2])).is_err());
        assert!(decode_preset_link(&json!("not a link!")).is_err());
        assert!(decode_preset_link(&json!("")).is_err());
    }
}
