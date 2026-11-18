//! A hero's HUD portrait and minimap icon as the item builder's picks make them, written once for
//! the whole build (src/item-portraits.ts): the portrait settings of an arcana's model written under
//! the plain model's path, and the plain icon's sprite cut where the item's is. Both files are
//! the game's with those entries changed, and only when something changed.

use regex::bytes::{Captures, Regex};

use crate::item_builder_assets::{hero_model_path, normalize_asset_path, PortraitSwap, SpriteSwap};
use crate::vpk::Entry;

const PORTRAITS: &str = "scripts/npc/portraits.txt";
const SPRITES: &str = "scripts/mod_textures.txt";
/// JavaScript's \s over latin1 text.
const WS: &str = r"[\t\n\x0B\x0C\r \xA0]";

/// Where a model's top-level block starts (at its name), where the name ends, and where the
/// block ends (after its brace).
fn portrait_block(text: &[u8], model: &str) -> Option<(usize, usize, usize)> {
    let re = Regex::new(&format!(r#"(?i-u)\t"{}"[ \t]*"#, regex::escape(model))).ok()?;
    // `^` and `(?=\r?$)` of a JavaScript multiline pattern: at a line's start, before its end
    let name = re.find_iter(text).find(|m| {
        (m.start() == 0 || matches!(text[m.start() - 1], b'\n' | b'\r'))
            && text.get(m.end()).is_none_or(|c| matches!(c, b'\r' | b'\n'))
    })?;
    let (mut depth, mut quoted) = (0i64, false);
    let from = name.start() + text[name.start()..].iter().position(|&c| c == b'{')?;
    for (i, &c) in text.iter().enumerate().skip(from) {
        if c == b'"' {
            quoted = !quoted;
        } else if !quoted && c == b'{' {
            depth += 1;
        } else if !quoted && c == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some((name.start(), name.end(), i + 1));
            }
        }
    }
    None
}

fn scaled(v: &[u8], scale: f64) -> String {
    let n = crate::js::to_number(&serde_json::Value::String(crate::kv::latin1(v)));
    crate::js::number((n * scale * 1e4 + 0.5).floor() / 1e4)
}

/// A portrait block framed for a body `scale` times bigger: the camera and the light stand as
/// much further from the origin, at the same angles and field of view.
pub fn scaled_portrait(block: &[u8], scale: f64) -> Vec<u8> {
    let pos =
        Regex::new(&format!(r#"(?-u)("Portrait(?:Light)?Position"{WS}+")([-0-9.]+) ([-0-9.]+) ([-0-9.]+)""#)).unwrap();
    let dist = Regex::new(&format!(r#"(?-u)("PortraitLightDistance"{WS}+")([-0-9.]+)""#)).unwrap();
    let out = pos.replace_all(block, |c: &Captures| {
        let mut v = c[1].to_vec();
        v.extend_from_slice(
            format!("{} {} {}\"", scaled(&c[2], scale), scaled(&c[3], scale), scaled(&c[4], scale)).as_bytes(),
        );
        v
    });
    dist.replace_all(&out, |c: &Captures| {
        let mut v = c[1].to_vec();
        v.extend_from_slice(format!("{}\"", scaled(&c[2], scale)).as_bytes());
        v
    })
    .into_owned()
}

/// A portrait swap as resolved: from the item's model to the hero's own.
pub struct Swap {
    pub from: String,
    pub to: String,
    pub scale: Option<f64>,
}

/// The portrait settings with each arcana's block written under the model it stands in for.
pub fn with_portraits(text: &[u8], swaps: &[Swap]) -> Vec<u8> {
    let mut out = text.to_vec();
    for s in swaps {
        // no settings of its own: the plain model's are the best there are
        let Some((_, name_end, end)) = portrait_block(text, &s.from) else { continue };
        let settings = &text[name_end..end];
        let mut block = format!("\t\"{}\"", s.to).into_bytes();
        match s.scale.filter(|&k| k != 0.0 && k != 1.0) {
            Some(k) => block.extend(scaled_portrait(settings, k)),
            None => block.extend_from_slice(settings),
        }
        if let Some((start, _, end)) = portrait_block(&out, &s.to) {
            out.splice(start..end, block);
        } else {
            let close = out.iter().rposition(|&c| c == b'}').unwrap_or(0);
            block.extend_from_slice(b"\r\n");
            out.splice(close..close, block);
        }
    }
    out
}

/// The sprite definitions with each swapped sprite cut out where its replacement is.
pub fn with_sprites(text: &[u8], swaps: &[SpriteSwap]) -> Vec<u8> {
    let find = |s: &[u8], name: &str| -> Option<(usize, usize)> {
        let re = Regex::new(&format!(r#"(?i-u)"{}"{WS}*(\{{[^{{}}]*\}})"#, regex::escape(name))).ok()?;
        re.captures(s).and_then(|c| c.get(1)).map(|m| (m.start(), m.end()))
    };
    let mut out = text.to_vec();
    for sw in swaps {
        let (Some((ss, se)), Some((ts, te))) = (find(text, &sw.as_), find(&out, &sw.sprite)) else { continue };
        let source = text[ss..se].to_vec();
        out.splice(ts..te, source);
    }
    out
}

/// The portrait settings and sprite sheet of every pick, to go into the build ahead of the
/// picks' own files. A hero whose own model the game does not name is left out and logged.
pub fn portrait_entries(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    portraits: &[PortraitSwap],
    sprites: &[SpriteSwap],
    log: &mut dyn FnMut(String),
) -> Vec<Entry> {
    if portraits.is_empty() && sprites.is_empty() {
        return Vec::new();
    }
    let mut swaps = Vec::new();
    for p in portraits {
        match hero_model_path(read, &p.hero) {
            Ok(to) => swaps.push(Swap {
                from: normalize_asset_path(&p.model),
                to: normalize_asset_path(&to),
                scale: p.scale.filter(|&s| s != 0.0),
            }),
            Err(e) => log(format!("schema: the portrait of {} left out of the build: {e}", p.hero)),
        }
    }
    let mut out = Vec::new();
    // written only when changed: a game file put back as it was would still cover the game's own
    let mut rewrite = |file: &str, change: &dyn Fn(&[u8]) -> Vec<u8>| {
        if let Some(was) = read(file) {
            let now = change(&was);
            if now != was {
                out.push(crate::vpk::entry_at(file, now.into()));
            }
        }
    };
    if !swaps.is_empty() {
        rewrite(PORTRAITS, &|t| with_portraits(t, &swaps));
    }
    if !sprites.is_empty() {
        rewrite(SPRITES, &|t| with_sprites(t, sprites));
    }
    out
}
