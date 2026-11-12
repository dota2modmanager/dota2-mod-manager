//! KeyValues navigation for items_game.txt: a block's braces, its direct children, without
//! building a tree. Rewritten from src/schema-kv.ts.
//!
//! The TypeScript reads the table as a latin1 string, one character per byte, so every offset
//! it hands out is a byte offset. Here the table is the bytes themselves and the offsets are the
//! same numbers: a block found by either side splices into the other's copy unchanged.

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum KvError {
    #[error("items_game: unclosed quote")]
    Quote,
    #[error("items_game: no block opens here")]
    NoOpen,
    #[error("items_game: unclosed block")]
    Unclosed,
    #[error("items_game: no items section")]
    NoItems,
}

pub type Result<T> = std::result::Result<T, KvError>;

/// A block's braces: [open, close + 1].
pub type Bounds = (usize, usize);

/// One direct child of a block: a nested block (`body` set) or a key with a value.
#[derive(Clone, Debug)]
pub struct Child<'a> {
    pub key: &'a [u8],
    pub start: usize,
    pub end: usize,
    pub value: Option<&'a [u8]>,
    pub body: Option<Bounds>,
}

impl Child<'_> {
    pub fn is_block(&self) -> bool {
        self.body.is_some()
    }
}

/// What /\s/ matches in a latin1 table: tab to carriage return, space, no-break space.
#[inline]
fn is_gap(c: u8) -> bool {
    c == 32 || (9..=13).contains(&c) || c == 160
}

const QUOTE: u8 = b'"';
const OPEN: u8 = b'{';
const CLOSE: u8 = b'}';

fn find(text: &[u8], byte: u8, from: usize) -> Option<usize> {
    if from >= text.len() {
        return None;
    }
    memchr::memchr(byte, &text[from..]).map(|i| i + from)
}

/// Skip whitespace and // line comments.
pub fn skip_gap(text: &[u8], mut i: usize) -> usize {
    loop {
        while i < text.len() && is_gap(text[i]) {
            i += 1;
        }
        if i + 1 < text.len() && text[i] == b'/' && text[i + 1] == b'/' {
            match find(text, b'\n', i) {
                Some(nl) => {
                    i = nl + 1;
                    continue;
                }
                None => return text.len(),
            }
        }
        return i;
    }
}

/// A token (quoted or bare) at i: (value, start, next), or None at a closing brace or the end.
pub fn read_token(text: &[u8], i: usize) -> Result<Option<(&[u8], usize, usize)>> {
    let i = skip_gap(text, i);
    if i >= text.len() || text[i] == CLOSE {
        return Ok(None);
    }
    if text[i] == QUOTE {
        let end = find(text, QUOTE, i + 1).ok_or(KvError::Quote)?;
        return Ok(Some((&text[i + 1..end], i, end + 1)));
    }
    let mut end = i;
    while end < text.len() {
        let c = text[end];
        if is_gap(c) || c == OPEN || c == CLOSE || c == QUOTE {
            break;
        }
        end += 1;
    }
    Ok(Some((&text[i..end], i, end)))
}

/// The bounds of the { ... } block that starts at or after i. Quoted text is skipped whole.
pub fn block_bounds(text: &[u8], i: usize) -> Result<Bounds> {
    let open = find(text, OPEN, i).ok_or(KvError::NoOpen)?;
    let mut depth: i64 = 0;
    let mut k = open;
    while k < text.len() {
        // jump to the next byte that matters instead of looking at every one
        let Some(rel) = memchr::memchr3(QUOTE, OPEN, CLOSE, &text[k..]) else { break };
        k += rel;
        match text[k] {
            QUOTE => match find(text, QUOTE, k + 1) {
                Some(e) => k = e,
                None => break,
            },
            OPEN => depth += 1,
            _ => {
                depth -= 1;
                if depth == 0 {
                    return Ok((open, k + 1));
                }
            }
        }
        k += 1;
    }
    Err(KvError::Unclosed)
}

/// Every block's braces, found in one pass over the text.
///
/// block_bounds scans a block to find its end, and a walk of nested blocks scans the same bytes
/// once per level: listing the table's items read its 50 MB four times over. With the braces
/// indexed once, finding a block's end is a binary search. The rule for what is a brace is
/// block_bounds' own (a quoted run is skipped whole, comments are not special), so a block found
/// either way has the same bounds.
pub struct Braces {
    /// (open, close + 1), sorted by open; close 0 while unclosed
    pairs: Vec<(u32, u32)>,
}

impl Braces {
    pub fn new(text: &[u8]) -> Self {
        let mut pairs: Vec<(u32, u32)> = Vec::with_capacity(text.len() / 64);
        let mut stack: Vec<usize> = Vec::with_capacity(64);
        let mut k = 0;
        while k < text.len() {
            let Some(rel) = memchr::memchr3(QUOTE, OPEN, CLOSE, &text[k..]) else { break };
            k += rel;
            match text[k] {
                QUOTE => match find(text, QUOTE, k + 1) {
                    Some(e) => k = e,
                    None => break,
                },
                OPEN => {
                    stack.push(pairs.len());
                    pairs.push((k as u32, 0));
                }
                _ => {
                    if let Some(at) = stack.pop() {
                        pairs[at].1 = (k + 1) as u32;
                    }
                }
            }
            k += 1;
        }
        Braces { pairs }
    }

    /// block_bounds, answered from the index.
    pub fn bounds(&self, text: &[u8], i: usize) -> Result<Bounds> {
        let open = find(text, OPEN, i).ok_or(KvError::NoOpen)?;
        match self.pairs.binary_search_by_key(&(open as u32), |p| p.0) {
            Ok(at) if self.pairs[at].1 != 0 => Ok((open, self.pairs[at].1 as usize)),
            _ => Err(KvError::Unclosed),
        }
    }
}

/// How a walk finds a block's end: by scanning, or from a Braces index.
#[derive(Clone, Copy)]
pub enum Ends<'b> {
    Scan,
    Index(&'b Braces),
}

impl Ends<'_> {
    pub fn bounds(self, text: &[u8], i: usize) -> Result<Bounds> {
        match self {
            Ends::Scan => block_bounds(text, i),
            Ends::Index(b) => b.bounds(text, i),
        }
    }
}

/// The child whose key starts at i (or after the gap there), or None at the block's close.
fn child_at<'a>(text: &'a [u8], i: usize, ends: Ends<'_>) -> Result<Option<Child<'a>>> {
    let Some((key, start, next)) = read_token(text, i)? else { return Ok(None) };
    let at = skip_gap(text, next);
    if at < text.len() && text[at] == OPEN {
        let b = ends.bounds(text, at)?;
        return Ok(Some(Child { key, start, end: b.1, value: None, body: Some(b) }));
    }
    let Some((value, _, vnext)) = read_token(text, at)? else { return Ok(None) };
    Ok(Some(Child { key, start, end: vnext, value: Some(value), body: None }))
}

/// Walk the direct children of a block; `visit` returning false stops the walk.
pub fn each_child<'a>(text: &'a [u8], bounds: Bounds, visit: impl FnMut(Child<'a>) -> bool) -> Result<()> {
    each_child_with(text, bounds, Ends::Scan, visit)
}

/// each_child, finding the ends of nested blocks the way `ends` says.
pub fn each_child_with<'a>(
    text: &'a [u8],
    bounds: Bounds,
    ends: Ends<'_>,
    mut visit: impl FnMut(Child<'a>) -> bool,
) -> Result<()> {
    let end = bounds.1.saturating_sub(1);
    let mut i = bounds.0 + 1;
    while i < end {
        let Some(c) = child_at(text, i, ends)? else { break };
        i = c.end;
        if !visit(c) {
            break;
        }
    }
    Ok(())
}

/// The direct children of a block, as a list.
pub fn children(text: &[u8], bounds: Bounds) -> Result<Vec<Child<'_>>> {
    let mut out = Vec::new();
    each_child(text, bounds, |c| {
        out.push(c);
        true
    })?;
    Ok(out)
}

/// A latin1 byte run as the TypeScript string it was: one char per byte.
pub fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_children_quoted_bare_and_nested() {
        let t = br#""root" { "a" "1" b 2 // comment { }
  "blk" { "x" "{not a brace}" } }"#;
        let root = block_bounds(t, 0).unwrap();
        let kids = children(t, root).unwrap();
        let keys: Vec<_> = kids.iter().map(|c| latin1(c.key)).collect();
        assert_eq!(keys, ["a", "b", "blk"]);
        assert_eq!(kids[1].value, Some(&b"2"[..]));
        let inner = children(t, kids[2].body.unwrap()).unwrap();
        assert_eq!(inner[0].value, Some(&b"{not a brace}"[..]));
    }

    #[test]
    fn the_index_finds_the_same_ends_as_a_scan() {
        let t = br#""a" { "b" { "c" "}" } "d" { } "e" "{" } "f" { }"#;
        let braces = Braces::new(t);
        for i in 0..t.len() {
            assert_eq!(braces.bounds(t, i), block_bounds(t, i), "at {i}");
        }
    }

    #[test]
    fn refuses_broken_text() {
        assert_eq!(block_bounds(b"\"a\" { \"b\" { ", 0), Err(KvError::Unclosed));
        assert_eq!(read_token(b"\"open", 0), Err(KvError::Quote));
        assert_eq!(block_bounds(b"no braces", 0), Err(KvError::NoOpen));
    }
}
