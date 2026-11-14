//! An item's styles in the item builder, replacing src/item-builder-styles.ts: which ones it has,
//! and its visuals with one of them made its only one.
//!
//! A worn item's visuals carry every style at once: an entry marked "style" "1" applies in the
//! second one only, and the style's own block says which material the model takes and sometimes
//! another model. A pick in style N is written as an item whose only style is N's, under the
//! number 0. Text is items_game's latin1 bytes, offsets as the TypeScript's.

use regex::bytes::Regex;
use std::sync::OnceLock;

use crate::kv::{self, Child, KvError};

const OWNER_ONLY: [&str; 5] = ["unlock", "item_def", "price", "auto_style_rule", "auto_style_reason"];

fn is_modifier(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

fn first_block<'a>(text: &'a [u8], bounds: kv::Bounds, name: &str) -> Result<Option<Child<'a>>, KvError> {
    let mut hit = None;
    kv::each_child(text, bounds, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(name.as_bytes()) {
            hit = Some(c);
            return false;
        }
        true
    })?;
    Ok(hit)
}

fn styles_block(visuals: &[u8]) -> Result<Option<Child<'_>>, KvError> {
    first_block(visuals, kv::block_bounds(visuals, 0)?, "styles")
}

/// The name token of each of an item's styles, in their order; none for an item with one look.
pub fn style_tokens(visuals: Option<&[u8]>) -> Result<Vec<Vec<u8>>, KvError> {
    let Some(visuals) = visuals.filter(|v| !v.is_empty()) else { return Ok(vec![]) };
    let Some(block) = styles_block(visuals)? else { return Ok(vec![]) };
    let mut out: Vec<Vec<u8>> = Vec::new();
    for s in kv::children(visuals, block.body.unwrap())? {
        if !s.is_block() || s.key.is_empty() || !s.key.iter().all(u8::is_ascii_digit) {
            continue;
        }
        let mut name: &[u8] = b"";
        kv::each_child(visuals, s.body.unwrap(), |f| {
            if !f.is_block() && f.key.eq_ignore_ascii_case(b"name") {
                name = f.value.unwrap_or(b"");
            }
            true
        })?;
        let n: usize = std::str::from_utf8(s.key).ok().and_then(|k| k.parse().ok()).unwrap_or(usize::MAX);
        if n > 4096 {
            continue;
        }
        if out.len() <= n {
            out.resize(n + 1, Vec::new());
        }
        out[n] = name.to_vec();
    }
    Ok(if out.len() > 1 { out } else { vec![] })
}

/// A pick's style out of its options' key: "style-2" is 2, none is 0.
pub fn style_of(key: &str) -> u64 {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"(?:^|,)style-(\d+)(?:,|$)").unwrap());
    re.captures(key).and_then(|c| c[1].parse::<f64>().ok()).map(|n| n as u64).unwrap_or(0)
}

/// Visuals with one style made the only one, the model it puts on (None: its own), and whether it applied.
pub type Styled = (Vec<u8>, Option<Vec<u8>>, bool);

/// The visuals with style `style` made the item's only one, the model that style puts on instead
/// of its own (None: its own), and whether it applied (style 0 or one the item lacks: no).
pub fn with_style(visuals: &[u8], style: u64) -> Result<Styled, KvError> {
    let block = styles_block(visuals)?;
    let own = match &block {
        Some(b) if style > 0 => style_child(visuals, b, style)?,
        _ => None,
    };
    match (block, own) {
        (Some(b), Some(o)) => {
            let (v, m) = only_style(visuals, Some(&b), Some(&o), style, Some("0"), 1)?;
            Ok((v, m, true))
        }
        _ => Ok((visuals.to_vec(), None, false)),
    }
}

/// A built item's visuals as they look whatever style it is worn in: its first style's entries
/// unmarked, every other style's taken out, the first style's block under each of `count` numbers.
pub fn in_every_style(visuals: &[u8], count: usize) -> Result<Vec<u8>, KvError> {
    let block = styles_block(visuals)?;
    let own = match &block {
        Some(b) => style_child(visuals, b, 0)?,
        None => None,
    };
    let block = if own.is_some() { block } else { None };
    Ok(only_style(visuals, block.as_ref(), own.as_ref(), 0, None, count.max(1))?.0)
}

/// A built item block worn as `worn` (an item block of the game's), in every style `worn` has.
pub fn block_in_every_style(block: &[u8], worn: &[u8]) -> Result<Vec<u8>, KvError> {
    let Some(at) = first_block(block, kv::block_bounds(block, 0)?, "visuals")? else { return Ok(block.to_vec()) };
    let count = match first_block(worn, kv::block_bounds(worn, 0)?, "visuals")? {
        Some(own) => style_tokens(Some(&worn[own.start..own.end]))?.len(),
        None => 0,
    };
    let visuals = in_every_style(&block[at.start..at.end], count)?;
    Ok([&block[..at.start], &visuals[..], &block[at.end..]].concat())
}

fn style_child<'a>(visuals: &'a [u8], block: &Child, style: u64) -> Result<Option<Child<'a>>, KvError> {
    let want = style.to_string();
    let mut own = None;
    kv::each_child(visuals, block.body.unwrap(), |s| {
        if s.is_block() && s.key == want.as_bytes() {
            own = Some(s);
            return false;
        }
        true
    })?;
    Ok(own)
}

/// Where a cut that takes a whole entry or line starts: the whitespace before `at` back over one
/// line break (`/[ \t]*\r?\n[ \t]*$/`).
fn line_start(text: &[u8], at: usize) -> usize {
    let mut j = at;
    while j > 0 && matches!(text[j - 1], b' ' | b'\t') {
        j -= 1;
    }
    if j == 0 || text[j - 1] != b'\n' {
        return at;
    }
    j -= 1;
    if j > 0 && text[j - 1] == b'\r' {
        j -= 1;
    }
    while j > 0 && matches!(text[j - 1], b' ' | b'\t') {
        j -= 1;
    }
    j
}

fn style_mark() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i-u)("style"[\t\n\x0B\x0C\r \xA0]+")[0-9]+(")"#).unwrap())
}

/// The visuals with `style`'s entries kept, marked `mark` (None: unmarked, so in any style), every
/// other style's taken out, and the chosen style's block written under the numbers 0 to `copies` - 1.
fn only_style(
    visuals: &[u8],
    block: Option<&Child>,
    chosen: Option<&Child>,
    style: u64,
    mark: Option<&str>,
    copies: usize,
) -> Result<(Vec<u8>, Option<Vec<u8>>), KvError> {
    let mut fields: Vec<&[u8]> = Vec::new();
    let mut model = None;
    if let Some(ch) = chosen {
        for f in kv::children(visuals, ch.body.unwrap())? {
            if OWNER_ONLY.iter().any(|o| f.key.eq_ignore_ascii_case(o.as_bytes())) {
                continue;
            }
            if !f.is_block() && f.key.eq_ignore_ascii_case(b"model_player") {
                model = f.value.map(<[u8]>::to_vec);
            }
            fields.push(&visuals[f.start..f.end]);
        }
    }
    let joined = fields.join(&b"\r\n"[..]);
    let styles: Vec<Vec<u8>> =
        (0..copies).map(|i| [format!("\"{i}\"\r\n{{\r\n").as_bytes(), &joined, b"\r\n}"].concat()).collect();
    let mut cuts: Vec<(usize, usize, Vec<u8>)> = Vec::new();
    if let Some(b) = block {
        cuts.push((b.start, b.end, [&b"\"styles\"\r\n{\r\n"[..], &styles.join(&b"\r\n"[..]), b"\r\n}"].concat()));
    }
    let style_s = style.to_string();
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        if !c.is_block() || !is_modifier(c.key) {
            continue;
        }
        let mut at = None;
        kv::each_child(visuals, c.body.unwrap(), |f| {
            if !f.is_block() && f.key.eq_ignore_ascii_case(b"style") {
                at = Some(f);
            }
            true
        })?;
        let Some(mine) = at else { continue };
        if mine.value != Some(style_s.as_bytes()) {
            cuts.push((line_start(visuals, c.start), c.end, vec![]));
            continue;
        }
        match mark {
            None => cuts.push((line_start(visuals, mine.start), mine.end, vec![])),
            Some(m) if m != style_s => {
                let text = &visuals[mine.start..mine.end];
                let replaced = style_mark()
                    .replacen(text, 1, |caps: &regex::bytes::Captures| [&caps[1], m.as_bytes(), &caps[2]].concat());
                cuts.push((mine.start, mine.end, replaced.into_owned()));
            }
            _ => {}
        }
    }
    // later cuts first, as a stable sort on start descending does
    cuts.sort_by_key(|c| std::cmp::Reverse(c.0));
    let mut out = visuals.to_vec();
    for (start, end, text) in cuts {
        out.splice(start..end, text);
    }
    Ok((out, model))
}
