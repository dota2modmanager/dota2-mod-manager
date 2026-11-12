//! Which material set an item's visuals wear its model in, replacing src/item-skin.ts
//! (src/model-skin.ts, here model_skin.rs, makes a model wear it). Text is items_game's latin1 bytes.

use regex::bytes::Regex;
use std::sync::OnceLock;

use crate::kv::{self, latin1, KvError};

/// A path as the item builder compares it: lower case, forward slashes, no leading slash
/// (normalizeAssetPath in src/item-builder-assets.ts).
pub fn normalize_asset_path(p: &str) -> String {
    p.to_lowercase().replace('\\', "/").trim_start_matches('/').to_string()
}

fn digits(v: &[u8]) -> Option<u64> {
    (!v.is_empty() && v.iter().all(u8::is_ascii_digit)).then(|| std::str::from_utf8(v).ok()?.parse().ok()).flatten()
}

/// The material set the first style's block names ("skin"), or None for none.
pub fn first_style_skin(visuals: &[u8]) -> Result<Option<Vec<u8>>, KvError> {
    let mut skin: Option<Vec<u8>> = None;
    let mut styles = Vec::new();
    kv::each_child(visuals, kv::block_bounds(visuals, 0)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"styles") {
            styles.push(c.body.unwrap());
        }
        true
    })?;
    for body in styles {
        for st in kv::children(visuals, body)? {
            if !st.is_block() || st.key != b"0" {
                continue;
            }
            kv::each_child(visuals, st.body.unwrap(), |f| {
                if !f.is_block() && f.key.eq_ignore_ascii_case(b"skin") && skin.is_none() {
                    skin = Some(f.value.unwrap_or(b"").to_vec());
                }
                true
            })?;
        }
    }
    Ok(skin)
}

fn modifier_re() -> &'static [Regex; 4] {
    static RE: OnceLock<[Regex; 4]> = OnceLock::new();
    const WS: &str = r"[\t\n\x0B\x0C\r \xA0]";
    RE.get_or_init(|| {
        [
            Regex::new(&format!(r#"(?i-u)"asset_modifier[0-9]*"{WS}*\{{([^{{}}]*)\}}"#)).unwrap(),
            Regex::new(&format!(r#"(?i-u)"type"{WS}+"model_skin""#)).unwrap(),
            Regex::new(&format!(r#"(?i-u)"asset"{WS}+"([^"]+)""#)).unwrap(),
            Regex::new(&format!(r#"(?i-u)"skin"{WS}+"([0-9]+)""#)).unwrap(),
        ]
    })
}

fn style_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i-u)"style"[\t\n\x0B\x0C\r \xA0]+"([0-9]+)""#).unwrap())
}

/// The material set an item wears its model in, 0 for the first: what its style says, or a
/// "model_skin" modifier for the style picked. `visuals` has the picked style made its first
/// (with_style); `model`, where given, is the model it is asked for.
pub fn worn_skin(visuals: &[u8], fallback: u64, model: Option<&str>) -> Result<u64, KvError> {
    if visuals.is_empty() {
        return Ok(fallback);
    }
    if let Some(n) = first_style_skin(visuals)?.as_deref().and_then(digits) {
        return Ok(n);
    }
    let [modifier, model_skin, asset, skin] = modifier_re();
    for m in modifier.captures_iter(visuals) {
        let body = m.get(1).unwrap().as_bytes();
        if !model_skin.is_match(body) {
            continue;
        }
        let named = asset.captures(body).map(|c| latin1(c.get(1).unwrap().as_bytes())).unwrap_or_default();
        let target = normalize_asset_path(&named);
        let target = target.strip_suffix("_c").unwrap_or(&target);
        if let Some(model) = model {
            if (target.starts_with("npc_dota_hero_") || target.starts_with("models/")) && target != model {
                continue;
            }
        }
        let style = style_re().captures(body).and_then(|c| digits(c.get(1).unwrap().as_bytes())).unwrap_or(0);
        if let Some(n) = skin.captures(body).and_then(|c| digits(c.get(1).unwrap().as_bytes())) {
            if style == 0 {
                return Ok(n);
            }
        }
    }
    let mut out = fallback;
    kv::each_child(visuals, kv::block_bounds(visuals, 0)?, |f| {
        if !f.is_block() && f.key.eq_ignore_ascii_case(b"skin") {
            if let Some(n) = f.value.and_then(digits) {
                out = n;
            }
        }
        true
    })?;
    Ok(out)
}
