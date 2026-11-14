//! Mod deltas and the merge: which item blocks a mod changed, those blocks spliced into the game's
//! current table, and the result checked before anything is written. Rewritten from
//! src/schema-merge.ts. Text is bytes (latin1 in the TypeScript), so a block lifted here splices
//! back into either side's copy unchanged.

use std::collections::HashMap;

use indexmap::IndexMap;
use regex::Regex;
use std::sync::LazyLock;

use crate::kv::{self, block_bounds, each_child, read_token, skip_gap, Bounds};
use crate::schema::{count_items, find_item, items_section, list_items};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum MergeError {
    #[error(transparent)]
    Kv(#[from] kv::KvError),
    #[error("items_game: item {0} not found")]
    NoItem(String),
    #[error("items_game: item {0} has no visuals block")]
    NoVisuals(String),
    #[error("items_game: unclosed quote")]
    Quote,
    #[error("items_game: extra closing brace")]
    ExtraClose,
    #[error("items_game: unclosed block")]
    Unclosed,
    #[error("items_game: suspiciously few items ({0})")]
    TooFew(usize),
    #[error("items_game: fewer items than the game has ({0} < {1})")]
    FewerThanGame(usize, usize),
}

pub type Result<T> = std::result::Result<T, MergeError>;

/// An item block a mod changed.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Delta {
    pub id: String,
    pub name: String,
    #[serde(serialize_with = "as_latin1")]
    pub block: Vec<u8>,
}

fn as_latin1<S: serde::Serializer>(b: &[u8], s: S) -> std::result::Result<S::Ok, S::Error> {
    s.serialize_str(&kv::latin1(b))
}

/// One block to splice into the game's table.
#[derive(Clone, Debug)]
pub struct Patch {
    pub id: String,
    pub block: Vec<u8>,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Applied {
    pub id: String,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Conflict {
    pub id: String,
    pub a: String,
    pub b: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Merged {
    pub text: Vec<u8>,
    pub applied: Vec<Applied>,
    pub missing: Vec<String>,
    pub conflicts: Vec<Conflict>,
}

/// What /\s/ matches in a latin1 string.
fn is_ws(c: u8) -> bool {
    c == b' ' || (9..=13).contains(&c) || c == 0xa0
}

/// String.prototype.toLowerCase on a latin1 string: A-Z and À-Þ (but ×) move down by 0x20.
pub fn latin1_lower(s: &[u8]) -> Vec<u8> {
    s.iter()
        .map(|&c| match c {
            b'A'..=b'Z' => c + 32,
            0xc0..=0xde if c != 0xd7 => c + 32,
            _ => c,
        })
        .collect()
}

/// s.replace(/\s+/g, ' ')
fn squeeze(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut gap = false;
    for &c in s {
        if is_ws(c) {
            if !gap {
                out.push(b' ');
                gap = true;
            }
        } else {
            out.push(c);
            gap = false;
        }
    }
    out
}

/// s.replace(/\s+/g, ' ').trim()
fn flat(s: &[u8]) -> Vec<u8> {
    let sq = squeeze(s);
    let start = sq.iter().position(|&c| !is_ws(c)).unwrap_or(sq.len());
    let end = sq.iter().rposition(|&c| !is_ws(c)).map(|e| e + 1).unwrap_or(start);
    sq[start..end].to_vec()
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    needle.is_empty() || memchr::memmem::find(hay, needle).is_some()
}

/// A block written one endless line (Skinchanger's exports), re-indented the way the table is.
pub fn reindent(block: &[u8], indent: &str) -> Result<Vec<u8>> {
    let Some((key, _, next)) = read_token(block, 0)? else { return Ok(Vec::new()) };
    let at = skip_gap(block, next);
    if at >= block.len() || block[at] != b'{' {
        return Ok(trim_js(block).to_vec());
    }
    fn format(text: &[u8], key: &[u8], bounds: Bounds, pad: &[u8], out: &mut Vec<u8>) -> Result<()> {
        let mut rows: Vec<Vec<u8>> = Vec::new();
        let mut err = None;
        each_child(text, bounds, |c| {
            let mut row = Vec::new();
            match (c.body, c.value) {
                (Some(b), _) => {
                    let mut inner = pad.to_vec();
                    inner.push(b'\t');
                    if let Err(e) = format(text, c.key, b, &inner, &mut row) {
                        err = Some(e);
                        return false;
                    }
                }
                (None, Some(v)) => {
                    row.extend_from_slice(pad);
                    row.extend_from_slice(b"\t\"");
                    row.extend_from_slice(c.key);
                    row.extend_from_slice(b"\"\t\t\"");
                    row.extend_from_slice(v);
                    row.push(b'"');
                }
                _ => {}
            }
            rows.push(row);
            true
        })?;
        if let Some(e) = err {
            return Err(e);
        }
        out.extend_from_slice(pad);
        out.push(b'"');
        out.extend_from_slice(key);
        out.extend_from_slice(b"\"\r\n");
        out.extend_from_slice(pad);
        out.push(b'{');
        out.extend_from_slice(b"\r\n");
        if !rows.is_empty() {
            out.extend_from_slice(&rows.join(&b"\r\n"[..]));
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(pad);
        out.push(b'}');
        Ok(())
    }
    let mut out = Vec::with_capacity(block.len() + block.len() / 4);
    format(block, key, block_bounds(block, at)?, indent.as_bytes(), &mut out)?;
    let start = out.iter().position(|&c| !is_js_trim(c)).unwrap_or(out.len());
    Ok(out[start..].to_vec())
}

/// What String.prototype.trim takes off a latin1 string.
fn is_js_trim(c: u8) -> bool {
    is_ws(c)
}

fn trim_js(s: &[u8]) -> &[u8] {
    let start = s.iter().position(|&c| !is_js_trim(c)).unwrap_or(s.len());
    let end = s.iter().rposition(|&c| !is_js_trim(c)).map(|e| e + 1).unwrap_or(start);
    &s[start..end]
}

static STOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(scripts/|resource/|panorama/styles/|materials/default/)").unwrap());
static ITEM_MATERIALS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"materials/models/items/([a-z0-9_]+)/([a-z0-9_]+)/").unwrap());
static NUMERIC_ROOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{3,}$").unwrap());

/// Asset paths a mod ships, in the form items_game names them: lower case, no _c.
pub fn owned_asset_needles(vpk_paths: &[String], roots: bool) -> Vec<String> {
    let mut out: IndexMap<String, ()> = IndexMap::new();
    for p in vpk_paths {
        let lower = p.to_lowercase();
        let trimmed = lower.trim_end_matches('"');
        let clean = trimmed.strip_suffix("_c").unwrap_or(trimmed);
        // JavaScript's length counts UTF-16 units
        if clean.is_empty() || clean.encode_utf16().count() < 8 {
            continue;
        }
        if STOCK.is_match(clean) {
            continue;
        }
        out.insert(clean.to_string(), ());
        if let Some(m) = ITEM_MATERIALS.captures(clean) {
            out.insert(format!("models/items/{}/{}/", &m[1], &m[2]), ());
        }
        let root = clean.split('/').next().unwrap_or("");
        if roots && NUMERIC_ROOT.is_match(root) {
            out.insert(format!("{root}/"), ());
        }
    }
    out.into_keys().collect()
}

/// Does an item block talk about any of these files?
pub fn block_uses_assets(block: &[u8], vpk_paths: &[String]) -> bool {
    let hay = latin1_lower(block);
    owned_asset_needles(vpk_paths, false).iter().any(|n| contains(&hay, &latin1_bytes(n)))
}

/// A JavaScript string of latin1 characters as the bytes it stands for (anything wider is
/// written as its UTF-8, which a latin1 table cannot hold and so never matches).
fn latin1_bytes(s: &str) -> Vec<u8> {
    if s.chars().all(|c| (c as u32) < 256) {
        s.chars().map(|c| c as u32 as u8).collect()
    } else {
        s.as_bytes().to_vec()
    }
}

/// The blocks a mod changed, written back out as a table of their own.
pub fn delta_table(blocks: &[&[u8]]) -> Vec<u8> {
    let mut out = b"\"items_game\"\r\n{\r\n\t\"items\"\r\n\t{\r\n".to_vec();
    for (i, b) in blocks.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(b"\t\t");
        out.extend_from_slice(b);
    }
    out.extend_from_slice(b"\r\n\t}\r\n}\r\n");
    out
}

fn is_digits(key: &[u8]) -> bool {
    !key.is_empty() && key.iter().all(u8::is_ascii_digit)
}

/// The table's items by id, the first of an id winning (src/schema-items.ts itemsById).
pub struct ItemsById(HashMap<String, (usize, usize)>);

impl ItemsById {
    pub fn new(text: &[u8]) -> kv::Result<Self> {
        let mut map = HashMap::with_capacity(32_000);
        for it in list_items(text)? {
            map.entry(it.id).or_insert((it.start, it.end));
        }
        Ok(ItemsById(map))
    }
    /// findItem with no section: the list first, a walk for an id it does not carry.
    pub fn find(&self, text: &[u8], id: &str) -> kv::Result<Option<(usize, usize)>> {
        if let Some(&r) = self.0.get(id) {
            return Ok(Some(r));
        }
        find_item(text, id, None)
    }
}

/// The items by id of a table, kept for the last table asked about.
pub fn items_by_id(text: &[u8]) -> kv::Result<std::sync::Arc<ItemsById>> {
    static SLOT: crate::memo::Slot<ItemsById> = std::sync::Mutex::new(None);
    crate::memo::per_text(&SLOT, text, ItemsById::new)
}

/// Which item blocks a mod changed: those naming a file it ships that differ from the game's.
pub fn extract_deltas(mod_text: &[u8], vpk_paths: &[String], base_text: Option<&[u8]>) -> Result<Vec<Delta>> {
    let needles: Vec<Vec<u8>> = owned_asset_needles(vpk_paths, true).iter().map(|n| latin1_bytes(n)).collect();
    if needles.is_empty() {
        return Ok(Vec::new());
    }
    let section = items_section(mod_text)?;
    let base = match base_text {
        Some(b) => Some((b, ItemsById::new(b)?)),
        None => None,
    };
    let mut deltas = Vec::new();
    let mut err = None;
    each_child(mod_text, section, |c| {
        let Some(body) = c.body else { return true };
        if !is_digits(c.key) {
            return true;
        }
        let raw = &mod_text[c.start..c.end];
        let hay = latin1_lower(raw);
        if !needles.iter().any(|n| contains(&hay, n)) {
            return true;
        }
        let mut name = Vec::new();
        let _ = each_child(mod_text, body, |f| {
            if let Some(v) = f.value.filter(|_| f.key.eq_ignore_ascii_case(b"name")) {
                name = v.to_vec();
            }
            true
        });
        if let Some((bt, by_id)) = &base {
            match by_id.find(bt, &kv::latin1(c.key)) {
                Ok(Some((s, e))) => {
                    if squeeze(&bt[s..e]) == squeeze(raw) {
                        return true;
                    }
                }
                Ok(None) => {}
                Err(x) => {
                    err = Some(x);
                    return false;
                }
            }
        }
        deltas.push(Delta { id: kv::latin1(c.key), name: kv::latin1(&name), block: raw.to_vec() });
        true
    })?;
    if let Some(e) = err {
        return Err(e.into());
    }
    Ok(deltas)
}

/// Every `"<key>" { ... }` sub-block taken out, with the whitespace in front of it.
pub fn strip_key_blocks(text: &[u8], key: &str) -> Vec<u8> {
    let mut out = text.to_vec();
    let needle = format!("\"{key}\"").into_bytes();
    loop {
        let Some(at) = memchr::memmem::find(&out, &needle) else { return out };
        let Some(open) = memchr::memchr(b'{', &out[at..]).map(|i| i + at) else { return out };
        let mut depth = 0i64;
        let mut end = None;
        for (i, &c) in out.iter().enumerate().skip(open) {
            if c == b'{' {
                depth += 1;
            } else if c == b'}' {
                depth -= 1;
                if depth == 0 {
                    end = Some(i + 1);
                    break;
                }
            }
        }
        let Some(end) = end else { return out };
        let mut start = at;
        while start > 0 && matches!(out[start - 1], b' ' | b'\t' | b'\r' | b'\n') {
            start -= 1;
        }
        out.drain(start..end);
    }
}

/// A real item's visuals copied onto a base item everyone owns; style unlocks taken off.
pub fn base_item_patch(base_text: &[u8], target_id: &str, source_id: &str) -> Result<Vec<u8>> {
    let by_id = ItemsById::new(base_text)?;
    let (ts, te) = by_id.find(base_text, target_id)?.ok_or_else(|| MergeError::NoItem(target_id.into()))?;
    let (ss, _) = by_id.find(base_text, source_id)?.ok_or_else(|| MergeError::NoItem(source_id.into()))?;
    let mut visuals: Option<Vec<u8>> = None;
    each_child(base_text, block_bounds(base_text, ss)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            visuals = Some(base_text[c.start..c.end].to_vec());
        }
        true
    })?;
    let visuals = visuals.ok_or_else(|| MergeError::NoVisuals(source_id.into()))?;
    let visuals = strip_key_blocks(&visuals, "unlock");
    let target = &base_text[ts..te];
    // the last visuals block of the base item goes; the donor's comes in its place
    let mut stripped = target.to_vec();
    each_child(base_text, block_bounds(base_text, ts)?, |c| {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            let (a, b) = (c.start - ts, c.end - ts);
            stripped = [&target[..a], &target[b..]].concat();
        }
        true
    })?;
    let close = stripped.iter().rposition(|&c| c == b'}').unwrap_or(stripped.len());
    let mut out = stripped[..close].to_vec();
    out.push(b'\t');
    out.extend_from_slice(trim_js(&visuals));
    out.extend_from_slice(b"\r\n\t\t");
    out.extend_from_slice(&stripped[close..]);
    Ok(out)
}

/// Blocks spliced into the game's table. Later patches of an id win; the same block from two
/// sources is no conflict.
pub fn merge(base_text: &[u8], patches: &[Patch]) -> Result<Merged> {
    let mut conflicts = Vec::new();
    let mut seen: IndexMap<&str, &Patch> = IndexMap::new();
    for p in patches {
        if let Some(prev) = seen.get(p.id.as_str()) {
            if flat(&prev.block) != flat(&p.block) {
                conflicts.push(Conflict { id: p.id.clone(), a: prev.source.clone(), b: p.source.clone() });
            }
        }
        seen.insert(p.id.as_str(), p);
    }
    let by_id = ItemsById::new(base_text)?;
    let mut applied = Vec::new();
    let mut missing = Vec::new();
    let mut edits: Vec<(usize, usize, Vec<u8>)> = Vec::new();
    for p in seen.values() {
        match by_id.find(base_text, &p.id)? {
            None => missing.push(p.id.clone()),
            Some((s, e)) => {
                edits.push((s, e, reindent(&p.block, "\t\t")?));
                applied.push(Applied { id: p.id.clone(), source: p.source.clone() });
            }
        }
    }
    edits.sort_by_key(|e| e.0);
    let mut text = Vec::with_capacity(base_text.len() + edits.iter().map(|e| e.2.len()).sum::<usize>());
    let mut at = 0;
    for (s, e, block) in &edits {
        text.extend_from_slice(&base_text[at.min(*s)..*s]);
        text.extend_from_slice(block);
        at = *e;
    }
    text.extend_from_slice(&base_text[at.min(base_text.len())..]);
    Ok(Merged { text, applied, missing, conflicts })
}

/// Refuse a table that could crash the game on load: braces that do not close, a quote that
/// does not end, or far fewer items than the game's own.
pub fn validate(text: &[u8], base_text: Option<&[u8]>) -> Result<(usize, usize)> {
    let mut depth: i64 = 0;
    let mut i = 0;
    while i < text.len() {
        let Some(rel) = memchr::memchr3(b'"', b'{', b'}', &text[i..]) else { break };
        i += rel;
        match text[i] {
            b'"' => match memchr::memchr(b'"', &text[i + 1..]) {
                Some(e) => i += e + 1,
                None => return Err(MergeError::Quote),
            },
            b'{' => depth += 1,
            _ => {
                depth -= 1;
                if depth < 0 {
                    return Err(MergeError::ExtraClose);
                }
            }
        }
        i += 1;
    }
    if depth != 0 {
        return Err(MergeError::Unclosed);
    }
    let items = count_items(text)?;
    if items < 1000 {
        return Err(MergeError::TooFew(items));
    }
    if let Some(base) = base_text {
        let base_items = list_items(base)?.len();
        if items < base_items {
            return Err(MergeError::FewerThanGame(items, base_items));
        }
    }
    Ok((items, text.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reindents_one_line_blocks() {
        let got = reindent(br#""7000" { "name" "Ash" "visuals" { "a" "b" } }"#, "\t\t").unwrap();
        let want = "\"7000\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"Ash\"\r\n\t\t\t\"visuals\"\r\n\t\t\t{\r\n\t\t\t\t\"a\"\t\t\"b\"\r\n\t\t\t}\r\n\t\t}";
        assert_eq!(String::from_utf8(got).unwrap(), want);
    }

    #[test]
    fn strips_unlock_blocks_with_their_indent() {
        let got = strip_key_blocks(b"{\r\n\t\"unlock\" { \"price\" \"1\" }\r\n\t\"x\" \"1\" }", "unlock");
        assert_eq!(got, b"{\r\n\t\"x\" \"1\" }");
    }

    #[test]
    fn needles_skip_stock_files_and_add_item_folders() {
        let n = owned_asset_needles(
            &[
                "scripts/items/items_game.txt".into(),
                "materials/models/items/tinker/cape/cape.vmat_c".into(),
                "8213/particles/x.vpcf_c".into(),
            ],
            true,
        );
        assert_eq!(
            n,
            [
                "materials/models/items/tinker/cape/cape.vmat",
                "models/items/tinker/cape/",
                "8213/particles/x.vpcf",
                "8213/"
            ]
        );
    }

    #[test]
    fn validate_catches_broken_braces() {
        assert_eq!(validate(b"{ { }", None), Err(MergeError::Unclosed));
        assert_eq!(validate(b"{ } }", None), Err(MergeError::ExtraClose));
        assert_eq!(validate(b"{ \"a }", None), Err(MergeError::Quote));
    }
}
