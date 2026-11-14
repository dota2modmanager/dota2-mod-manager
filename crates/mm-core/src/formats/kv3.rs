//! Binary KV3, replacing src/kv3.ts, src/kv3-cells.ts, src/kv3-blobs.ts and src/kv3-write.ts:
//! the format Source 2 compiles particles, materials and models into. Read far enough to find
//! every value, change a number where it lies, give a blob new bytes, and write the block back;
//! or write a whole block anew from its tree.
//!
//! Every lane is read in order and must end exactly where the data does, which is how a file this
//! misreads is refused instead of patched. The layout follows ValveResourceFormat's BinaryKV3.cs
//! (MIT), versions 1 to 5. test/rust-parity.test.ts compares it with the TypeScript on real files.

use indexmap::IndexMap;
use serde_json::{json, Value as Json};
use std::collections::HashMap;
use std::io::Read;

use crate::lz4;

#[derive(Debug, Clone, thiserror::Error)]
#[error("kv3: {0}")]
pub struct Kv3Error(pub String);

fn err<T>(m: impl Into<String>) -> Result<T, Kv3Error> {
    Err(Kv3Error(m.into()))
}

const MAGIC: u32 = 0x4b56_3300;
const NONE: u32 = 0;
const LZ4: u32 = 1;
const ZSTD: u32 = 2;
const TRAILER: u32 = 0xffee_dd00;
const FRAME: usize = 16384;

/// Where one number lives: which decompressed buffer, the byte offset in it, and how wide it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cell {
    pub buffer: u8,
    pub offset: usize,
    pub width: u8,
    pub signed: bool,
    pub float: bool,
}

/// A typed array's element type and the flag byte after it (0: none).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Element {
    pub ty: u8,
    pub flag: u8,
}

/// A value in the tree. A number keeps where it lies (`cell`), or None when its type alone says
/// what it is (0 and 1 as INT64_ZERO, DOUBLE_ONE...), and where its type byte is, the one place
/// such a number can be changed. A number made rather than read has its bytes in `raw`. A blob is
/// an index into the block's `blobs`, in the order they are stored.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Object(IndexMap<String, Node>),
    Array { items: Vec<Node>, element: Option<Element>, ty: u8 },
    Number { ty: u8, cell: Option<Cell>, type_at: Option<Cell>, raw: Option<Vec<u8>> },
    Str(String),
    Blob(usize),
    Other { ty: u8, value: Option<u8> },
}

/// A value and the flag byte that can follow its type (a string naming a resource, for one); 0 is none.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub value: Value,
    pub flag: u8,
}

impl Node {
    pub fn new(value: Value) -> Node {
        Node { value, flag: 0 }
    }
    /// A member of an object by name.
    pub fn get(&self, name: &str) -> Option<&Node> {
        match &self.value {
            Value::Object(m) => m.get(name),
            _ => None,
        }
    }
    pub fn get_mut(&mut self, name: &str) -> Option<&mut Node> {
        match &mut self.value {
            Value::Object(m) => m.get_mut(name),
            _ => None,
        }
    }
    pub fn items(&self) -> &[Node] {
        match &self.value {
            Value::Array { items, .. } => items,
            _ => &[],
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match &self.value {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
}

/// An array of numbers the walk found, with the member name it was under and a cell per element.
#[derive(Debug, Clone, PartialEq)]
pub struct NumArray {
    pub key: String,
    pub path: String,
    pub cells: Vec<Option<Cell>>,
}

#[derive(Debug, Clone)]
struct BlobTable {
    buf: usize,
    lengths_at: usize,
    count: usize,
    frames_at: usize,
    frames: usize,
    frame_size: usize,
    lz4: bool,
}

/// A parsed block: its decompressed buffers, its tree, the arrays of numbers in it, and what
/// `encode` needs to put it back together the way it came.
#[derive(Debug, Clone)]
pub struct Block {
    pub version: u32,
    /// the 16 bytes after the magic that name the format
    pub format: [u8; 16],
    pub buffers: Vec<Vec<u8>>,
    pub strings: Vec<String>,
    pub root: Node,
    pub arrays: Vec<NumArray>,
    /// every blob's bytes, in the order they are stored; give one new bytes and `encode` writes it
    pub blobs: Vec<Vec<u8>>,
    originals: Vec<Vec<u8>>,
    /// before version 2: where each blob's bytes and its length lie in the first buffer
    inline: Vec<(usize, usize)>,
    head: Vec<u8>,
    method: u32,
    fields: HashMap<&'static str, (i64, usize)>,
    blob_part: Vec<u8>,
    tail: Vec<u8>,
    table: Option<BlobTable>,
}

#[derive(Debug, Clone, Copy)]
struct Lane {
    buf: usize,
    at: usize,
    end: usize,
}

fn lane(buf: usize, at: usize, size: i64) -> Result<Lane, Kv3Error> {
    if size < 0 {
        return err("a lane of negative size");
    }
    Ok(Lane { buf, at, end: at + size as usize })
}
const fn align(n: usize, a: usize) -> usize {
    (n + a - 1) & !(a - 1)
}

fn u16_at(b: &[u8], at: usize) -> Result<u16, Kv3Error> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| Kv3Error("read past the end".into()))
}
fn u32_at(b: &[u8], at: usize) -> Result<u32, Kv3Error> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or_else(|| Kv3Error("read past the end".into()))
}
fn i32_at(b: &[u8], at: usize) -> Result<i32, Kv3Error> {
    u32_at(b, at).map(|v| v as i32)
}
fn put_i32(b: &mut [u8], at: usize, v: i64) {
    b[at..at + 4].copy_from_slice(&(v as i32).to_le_bytes());
}

/// A zstd frame unpacked, checked against the size the header gives when there is one.
pub fn zstd(src: &[u8], size: Option<usize>) -> Result<Vec<u8>, Kv3Error> {
    let mut d = ruzstd::decoding::StreamingDecoder::new(src).map_err(|e| Kv3Error(format!("zstd: {e}")))?;
    let mut out = Vec::new();
    d.read_to_end(&mut out).map_err(|e| Kv3Error(format!("zstd: {e}")))?;
    if size.is_some_and(|s| s != out.len()) {
        return err("a zstd buffer of another size");
    }
    Ok(out)
}

fn zstd_pack(src: &[u8]) -> Vec<u8> {
    ruzstd::encoding::compress_to_vec(src, ruzstd::encoding::CompressionLevel::Fastest)
}

/// The blob table after the types, or None when there are no blobs; either way the trailer that
/// follows the types (and the lengths) is checked.
fn blob_table(
    buffers: &[Vec<u8>],
    buf: usize,
    types_end: usize,
    count: usize,
    lz4: bool,
    frame_size: i64,
) -> Result<Option<BlobTable>, Kv3Error> {
    let b = &buffers[buf];
    let trailer_at = types_end + count * 4;
    if u32_at(b, trailer_at).ok() != Some(TRAILER) {
        return err("no trailer after the types");
    }
    if count == 0 {
        return Ok(None);
    }
    let frames_at = trailer_at + 4;
    let rest = b.len().saturating_sub(frames_at);
    if lz4 && !rest.is_multiple_of(2) {
        return err("blob frames left over");
    }
    Ok(Some(BlobTable {
        buf,
        lengths_at: types_end,
        count,
        frames_at,
        frames: if lz4 { rest / 2 } else { 0 },
        frame_size: if frame_size > 0 { frame_size as usize } else { FRAME },
        lz4,
    }))
}

/// Every blob's bytes, one after another, read from `block` at `at`; and where they end.
fn read_blobs(block: &[u8], at: usize, t: &BlobTable, tb: &[u8], total: i64) -> Result<(Vec<u8>, usize), Kv3Error> {
    let lengths = (0..t.count).map(|k| i32_at(tb, t.lengths_at + k * 4)).collect::<Result<Vec<_>, _>>()?;
    let sum: i64 = lengths.iter().map(|&n| n as i64).sum();
    if sum != total || sum < 0 {
        return err("the blob lengths do not add up");
    }
    let mut data = vec![0u8; sum as usize];
    let mut p = at;
    if !t.lz4 {
        let src = block.get(p..p + data.len()).ok_or_else(|| Kv3Error("the blobs ran out".into()))?;
        data.copy_from_slice(src);
        p += data.len();
    } else {
        let (mut f, mut o) = (0usize, 0usize);
        for &n in &lengths {
            let mut left = n.max(0) as usize;
            while left > 0 {
                if f >= t.frames {
                    return err("the blob frames ran out");
                }
                let size = u16_at(tb, t.frames_at + f * 2)? as usize;
                let src = block.get(p..(p + size).min(block.len())).unwrap_or(&[]);
                let got = lz4::decode_into(src, &mut data, o, t.frame_size.min(left))?;
                if got == 0 {
                    return err("an empty blob frame");
                }
                p += size;
                o += got;
                left -= got;
                f += 1;
            }
        }
        if f != t.frames {
            return err("blob frames left over");
        }
    }
    if u32_at(block, p).ok() != Some(TRAILER) {
        return err("no trailer after the blobs");
    }
    Ok((data, p + 4))
}

/// The blobs written as frames of literals, their lengths and frame sizes put in the table where
/// they were. A blob that would take another number of frames is refused: the table keeps its length.
fn rewrite_blobs(t: &BlobTable, tb: &mut [u8], blobs: &[Vec<u8>]) -> Result<Vec<u8>, Kv3Error> {
    let chunks: Vec<&[u8]> = blobs.iter().flat_map(|b| b.chunks(t.frame_size)).collect();
    if t.lz4 && chunks.len() != t.frames {
        return err("a new blob would take another number of frames");
    }
    let packed: Vec<Vec<u8>> = chunks.iter().map(|c| if t.lz4 { lz4::literals(c) } else { c.to_vec() }).collect();
    for (i, b) in blobs.iter().enumerate() {
        put_i32(tb, t.lengths_at + i * 4, b.len() as i64);
    }
    if t.lz4 {
        for (i, c) in packed.iter().enumerate() {
            if c.len() > 0xffff {
                return err("a blob frame too long");
            }
            tb[t.frames_at + i * 2..t.frames_at + i * 2 + 2].copy_from_slice(&(c.len() as u16).to_le_bytes());
        }
    }
    let mut out = packed.concat();
    out.extend_from_slice(&TRAILER.to_le_bytes());
    Ok(out)
}

/// Before version 2: the first buffer laid out again with every blob's new bytes in the 1-byte
/// lane, the lanes after it realigned.
fn relaid_inline(
    old: &[u8],
    c1: usize,
    c4: usize,
    inline: &[(usize, usize)],
    originals: &[Vec<u8>],
    blobs: &[Vec<u8>],
) -> Vec<u8> {
    let mut l1 = Vec::new();
    let mut from = 0;
    for (i, b) in blobs.iter().enumerate() {
        l1.extend_from_slice(&old[from..inline[i].0]);
        l1.extend_from_slice(b);
        from = inline[i].0 + originals[i].len();
    }
    l1.extend_from_slice(&old[from..c1]);
    let l4_at = align(c1, 4);
    let l8_at = align(l4_at + c4 * 4, 8);
    let mut l4 = old[l4_at..l4_at + c4 * 4].to_vec();
    for (i, b) in blobs.iter().enumerate() {
        put_i32(&mut l4, inline[i].1 - l4_at, b.len() as i64);
    }
    let at4 = align(l1.len(), 4);
    let at8 = align(at4 + l4.len(), 8);
    let mut out = l1;
    out.resize(at4, 0);
    out.extend_from_slice(&l4);
    out.resize(at8, 0);
    out.extend_from_slice(&old[l8_at..]);
    out
}

struct Walk<'a> {
    version: u32,
    buffers: &'a [Vec<u8>],
    strings: &'a [String],
    lanes: Vec<Lane>,
    main: [usize; 4],
    aux: [usize; 4],
    types: usize,
    object_lengths: Option<usize>,
    blob_lengths: Option<usize>,
    blob_data: &'a [u8],
    blob_read: usize,
    arrays: Vec<NumArray>,
    blobs: Vec<Vec<u8>>,
    inline: Vec<(usize, usize)>,
}

impl Walk<'_> {
    fn take(&mut self, l: usize, width: usize) -> Result<usize, Kv3Error> {
        let lane = &mut self.lanes[l];
        let at = lane.at;
        lane.at += width;
        if lane.at > lane.end {
            return err("a lane ran out");
        }
        Ok(at)
    }
    fn byte(&mut self, l: usize) -> Result<u8, Kv3Error> {
        let at = self.take(l, 1)?;
        self.buffers[self.lanes[l].buf].get(at).copied().ok_or_else(|| Kv3Error("a lane ran out".into()))
    }
    fn int4(&mut self, l: usize) -> Result<i32, Kv3Error> {
        let at = self.take(l, 4)?;
        i32_at(&self.buffers[self.lanes[l].buf], at)
    }
    fn cell(&mut self, l: usize, width: u8, signed: bool, float: bool) -> Result<Cell, Kv3Error> {
        let offset = self.take(l, width as usize)?;
        if offset + width as usize > self.buffers[self.lanes[l].buf].len() {
            return err("a lane ran out");
        }
        Ok(Cell { buffer: self.lanes[l].buf as u8, offset, width, signed, float })
    }
    fn string(&mut self) -> Result<String, Kv3Error> {
        let i = self.int4(self.main[2])?;
        Ok(usize::try_from(i).ok().and_then(|i| self.strings.get(i)).cloned().unwrap_or_default())
    }
    /// the next type, where its byte is, and the flag after it (0: none)
    fn read_type(&mut self) -> Result<(u8, Cell, u8), Kv3Error> {
        let t_lane = self.types;
        let at = Cell {
            buffer: self.lanes[t_lane].buf as u8,
            offset: self.lanes[t_lane].at,
            width: 1,
            signed: false,
            float: false,
        };
        let mut t = self.byte(t_lane)?;
        let flag = if t & 0x80 != 0 { self.byte(t_lane)? } else { 0 };
        if self.version >= 3 {
            if t & 0x40 != 0 {
                self.take(t_lane, 1)?; // no known writer sets this; readers skip the byte after it
            }
            t &= 0x3f;
        } else {
            t &= 0x7f;
        }
        Ok((t, at, flag))
    }
    fn value(
        &mut self,
        t: u8,
        type_at: Option<Cell>,
        lanes: [usize; 4],
        key: &str,
        path: &str,
        flag: u8,
    ) -> Result<Node, Kv3Error> {
        let value = self.read(t, type_at, lanes, key, path)?;
        Ok(Node { value, flag })
    }
    fn read(
        &mut self,
        t: u8,
        type_at: Option<Cell>,
        lanes: [usize; 4],
        key: &str,
        path: &str,
    ) -> Result<Value, Kv3Error> {
        let num = |cell: Option<Cell>| Value::Number { ty: t, cell, type_at, raw: None };
        Ok(match t {
            // 0 or 1, stored in the type alone: int64 (15, 16), double (17, 18) and uint32 (26, 27)
            15..=18 | 26 | 27 => num(None),
            1 | 13 | 14 => Value::Other { ty: t, value: None },
            2 => Value::Other { ty: t, value: Some(self.byte(lanes[0])?) },
            22 | 23 => num(Some(self.cell(lanes[0], 1, t == 22, false)?)),
            20 | 21 => num(Some(self.cell(lanes[1], 2, t == 20, false)?)),
            11 | 12 => num(Some(self.cell(lanes[2], 4, t == 11, false)?)),
            19 => num(Some(self.cell(lanes[2], 4, true, true)?)),
            3 | 4 => num(Some(self.cell(lanes[3], 8, t == 3, false)?)),
            5 => num(Some(self.cell(lanes[3], 8, true, true)?)),
            6 => Value::Str(self.string()?),
            7 => {
                let data = if self.version < 2 {
                    let n = self.int4(self.main[2])?;
                    let n = usize::try_from(n).map_err(|_| Kv3Error("a blob of negative length".into()))?;
                    let at = self.take(self.main[0], n)?;
                    let b = &self.buffers[self.lanes[self.main[0]].buf];
                    let data = b.get(at..at + n).ok_or_else(|| Kv3Error("a lane ran out".into()))?.to_vec();
                    self.inline.push((at, self.lanes[self.main[2]].at - 4));
                    data
                } else {
                    let Some(bl) = self.blob_lengths else { return err("a blob with no blob table") };
                    let n = self.int4(bl)?.max(0) as usize;
                    let d = self
                        .blob_data
                        .get(self.blob_read..self.blob_read + n)
                        .ok_or_else(|| Kv3Error("blob bytes ran out".into()))?;
                    self.blob_read += n;
                    d.to_vec()
                };
                self.blobs.push(data);
                Value::Blob(self.blobs.len() - 1)
            }
            8 | 10 | 24 | 25 => {
                let n = if t == 8 || t == 10 {
                    self.int4(self.main[2])?.max(0) as usize
                } else {
                    self.byte(self.main[0])? as usize
                };
                let mut items = Vec::with_capacity(n.min(1 << 16));
                let mut element = None;
                if t == 8 {
                    for k in 0..n {
                        let (et, eat, ef) = self.read_type()?;
                        items.push(self.value(et, Some(eat), self.main, key, &format!("{path}[{k}]"), ef)?);
                    }
                } else {
                    let (sub, _, sf) = self.read_type()?;
                    element = Some(Element { ty: sub, flag: sf });
                    let el = if t == 25 { self.aux } else { self.main };
                    for k in 0..n {
                        items.push(self.value(sub, None, el, key, &format!("{path}[{k}]"), 0)?);
                    }
                }
                if items.iter().all(|x| matches!(x.value, Value::Number { .. })) {
                    let cells = items
                        .iter()
                        .map(|x| if let Value::Number { cell, .. } = x.value { cell } else { None })
                        .collect();
                    self.arrays.push(NumArray { key: key.to_string(), path: path.to_string(), cells });
                }
                Value::Array { items, element, ty: t }
            }
            9 => {
                let n = match self.object_lengths {
                    Some(l) => self.int4(l)?,
                    None => self.int4(self.main[2])?,
                }
                .max(0) as usize;
                let mut members = IndexMap::with_capacity(n.min(1 << 16));
                for _ in 0..n {
                    let (ty, tat, tf) = self.read_type()?;
                    let name = self.string()?;
                    let v = self.value(ty, Some(tat), self.main, &name, &format!("{path}.{name}"), tf)?;
                    members.insert(name, v);
                }
                Value::Object(members)
            }
            _ => return err(format!("value type {t} at {}", if path.is_empty() { "the root" } else { path })),
        })
    }
}

/// Read a KV3 block (a resource's DATA block, magic included).
pub fn read(block: &[u8]) -> Result<Block, Kv3Error> {
    let magic = u32_at(block, 0).map_err(|_| Kv3Error("not a binary KV3 block".into()))?;
    let version = magic & 0xff;
    if magic & 0xffff_ff00 != MAGIC || !(1..=5).contains(&version) {
        return err("not a binary KV3 block");
    }
    let mut p = 20usize;
    let method = u32_at(block, p)?;
    p += 4;
    if method != LZ4 && method != NONE && !(method == ZSTD && version >= 5) {
        return err(format!("compression {method} is not handled"));
    }
    let mut fields: HashMap<&'static str, (i64, usize)> = HashMap::new();
    let mut field = |name: &'static str, w: usize, p: &mut usize| -> Result<(), Kv3Error> {
        let v = if w == 2 { u16_at(block, *p)? as i64 } else { i32_at(block, *p)? as i64 };
        fields.insert(name, (v, *p));
        *p += w;
        Ok(())
    };
    if version == 1 {
        for f in ["c1", "c4", "c8", "unc"] {
            field(f, 4, &mut p)?;
        }
    } else {
        field("dict", 2, &mut p)?;
        field("frame", 2, &mut p)?;
        for f in ["c1", "c4", "c8", "types"] {
            field(f, 4, &mut p)?;
        }
        field("objects", 2, &mut p)?;
        field("arraysN", 2, &mut p)?;
        for f in ["unc", "cmp", "blocks", "blobs"] {
            field(f, 4, &mut p)?;
        }
    }
    if version >= 4 {
        field("c2", 4, &mut p)?;
        field("blockSizes", 4, &mut p)?;
    }
    if version >= 5 {
        for f in [
            "unc1",
            "cmp1",
            "unc2",
            "cmp2",
            "b2c1",
            "b2c2",
            "b2c4",
            "b2c8",
            "nodes",
            "b2objects",
            "b2arrays",
            "elements",
        ] {
            field(f, 4, &mut p)?;
        }
    }
    let h = |n: &str| fields.get(n).map(|f| f.0).unwrap_or(0);
    if h("dict") != 0 {
        return err("a compression dictionary is not handled");
    }
    let header_end = p;

    let unpack = |size: i64, csize: i64, p: &mut usize| -> Result<Vec<u8>, Kv3Error> {
        if size < 0 || csize < 0 {
            return err("a buffer of negative size");
        }
        let n = if method == NONE { size } else { csize } as usize;
        let src = &block[(*p).min(block.len())..(*p + n).min(block.len())];
        *p += src.len();
        match method {
            NONE => Ok(src.to_vec()),
            ZSTD => zstd(src, Some(size as usize)),
            _ => lz4::decode(src, size as usize),
        }
    };
    let buffers = if version >= 5 {
        vec![unpack(h("unc1"), h("cmp1"), &mut p)?, unpack(h("unc2"), h("cmp2"), &mut p)?]
    } else {
        let csize = if version == 1 { (block.len() - header_end) as i64 } else { h("cmp") };
        vec![unpack(h("unc"), csize, &mut p)?]
    };
    let blobs_at = p;

    // the lanes of the first buffer: 1-byte, 2-byte, 4-byte (string count first), 8-byte
    let b0 = &buffers[0];
    let mut lanes: Vec<Lane> = Vec::new();
    let mut off = 0usize;
    let l1 = lane(0, off, h("c1"))?;
    off = l1.end;
    let mut l2 = lane(0, off, 0)?;
    if h("c2") != 0 {
        off = align(off, 2);
        l2 = lane(0, off, h("c2") * 2)?;
        off = l2.end;
    }
    off = align(off, 4);
    let mut l4 = lane(0, off, h("c4") * 4)?;
    off = l4.end;
    off = align(off, 8);
    let l8 = lane(0, off, h("c8") * 8)?;
    off = l8.end;
    let n_strings = i32_at(b0, l4.at)?;
    l4.at += 4;
    lanes.extend([l1, l2, l4, l8]);
    let aux = [0, 1, 2, 3];
    let mut strings = Vec::with_capacity(n_strings.max(0) as usize);
    let mut text_at = if version >= 5 { lanes[0].at } else { off };
    for _ in 0..n_strings.max(0) {
        let z = memchr::memchr(0, b0.get(text_at..).unwrap_or(&[]))
            .ok_or_else(|| Kv3Error("a string with no end".into()))?
            + text_at;
        strings.push(String::from_utf8_lossy(&b0[text_at..z]).into_owned());
        text_at = z + 1;
    }
    if version >= 5 {
        lanes[0].at = text_at;
    }

    // the main lanes and the types: in the same buffer before v5, in the second from v5
    let mut main = aux;
    let types;
    let mut object_lengths = None;
    if version >= 5 {
        let ol = lane(1, 0, h("b2objects") * 4)?;
        let mut q = ol.end;
        let m1 = lane(1, q, h("b2c1"))?;
        q = m1.end;
        let mut m2 = lane(1, q, 0)?;
        if h("b2c2") != 0 {
            q = align(q, 2);
            m2 = lane(1, q, h("b2c2") * 2)?;
            q = m2.end;
        }
        if h("b2c4") != 0 {
            q = align(q, 4);
        }
        let m4 = lane(1, q, h("b2c4") * 4)?;
        q = m4.end;
        if h("b2c8") != 0 {
            q = align(q, 8);
        }
        let m8 = lane(1, q, h("b2c8") * 8)?;
        q = m8.end;
        object_lengths = Some(lanes.len());
        lanes.push(ol);
        main = [lanes.len(), lanes.len() + 1, lanes.len() + 2, lanes.len() + 3];
        lanes.extend([m1, m2, m4, m8]);
        types = lanes.len();
        lanes.push(lane(1, q, h("types"))?);
    } else {
        let len = if version == 1 {
            b0.len() as i64 - text_at as i64 - 4
        } else {
            h("types") - (text_at as i64 - off as i64)
        };
        types = lanes.len();
        lanes.push(lane(0, text_at, len)?);
    }

    // binary blobs from version 2: described after the types, their frames after the buffers
    let tbuf = lanes[types].buf;
    let count = if version >= 2 { h("blocks").max(0) as usize } else { 0 };
    let table = blob_table(&buffers, tbuf, lanes[types].end, count, method == LZ4, h("frame"))?;
    let mut blob_lengths = None;
    if let Some(t) = &table {
        blob_lengths = Some(lanes.len());
        lanes.push(Lane { buf: tbuf, at: t.lengths_at, end: t.lengths_at + t.count * 4 });
    }
    let mut blob_data = Vec::new();
    p = blobs_at;
    if let Some(t) = &table {
        let (data, end) = if method == ZSTD {
            let size = (h("cmp") - h("cmp1") - h("cmp2")).max(0) as usize;
            let mut raw = zstd(block.get(p..p + size).ok_or_else(|| Kv3Error("the blobs ran out".into()))?, None)?;
            raw.extend_from_slice(block.get(p + size..p + size + 4).unwrap_or(&[]));
            (read_blobs(&raw, 0, t, &buffers[tbuf], h("blobs"))?.0, p + size + 4)
        } else {
            read_blobs(block, p, t, &buffers[tbuf], h("blobs"))?
        };
        blob_data = data;
        p = end;
    }
    let blobs_end = p;

    let mut w = Walk {
        version,
        buffers: &buffers,
        strings: &strings,
        lanes,
        main,
        aux,
        types,
        object_lengths,
        blob_lengths,
        blob_data: &blob_data,
        blob_read: 0,
        arrays: Vec::new(),
        blobs: Vec::new(),
        inline: Vec::new(),
    };
    let (rt, rat, rf) = w.read_type()?;
    let root = w.value(rt, Some(rat), main, "", "", rf)?;
    let mut check: Vec<usize> = if version >= 5 {
        main.iter().chain([&types]).chain(aux.iter()).copied().collect()
    } else {
        main.iter().chain([&types]).copied().collect()
    };
    check.extend(blob_lengths);
    if check.iter().any(|&l| w.lanes[l].at != w.lanes[l].end) {
        return err("the walk did not end where the data does");
    }
    if w.blob_read != blob_data.len() {
        return err("blob bytes left over");
    }
    let (arrays, blobs, inline) = (w.arrays, w.blobs, w.inline);
    let mut format = [0u8; 16];
    format.copy_from_slice(&block[4..20]);
    Ok(Block {
        version,
        format,
        strings,
        root,
        arrays,
        originals: blobs.clone(),
        blobs,
        inline,
        head: block[..header_end].to_vec(),
        method,
        fields,
        blob_part: block[blobs_at..blobs_end].to_vec(),
        tail: block[blobs_end..].to_vec(),
        table,
        buffers,
    })
}

impl Block {
    fn field_at(&self, name: &str) -> Option<usize> {
        self.fields.get(name).map(|f| f.1)
    }
    fn field(&self, name: &str) -> i64 {
        self.fields.get(name).map(|f| f.0).unwrap_or(0)
    }

    /// A number's value.
    pub fn read_cell(&self, c: Cell) -> f64 {
        let b = &self.buffers[c.buffer as usize][c.offset..c.offset + c.width as usize];
        match (c.width, c.float, c.signed) {
            (4, true, _) => f32::from_le_bytes(b.try_into().unwrap()) as f64,
            (_, true, _) => f64::from_le_bytes(b.try_into().unwrap()),
            (1, _, true) => b[0] as i8 as f64,
            (1, _, false) => b[0] as f64,
            (2, _, true) => i16::from_le_bytes(b.try_into().unwrap()) as f64,
            (2, _, false) => u16::from_le_bytes(b.try_into().unwrap()) as f64,
            (4, _, true) => i32::from_le_bytes(b.try_into().unwrap()) as f64,
            (4, _, false) => u32::from_le_bytes(b.try_into().unwrap()) as f64,
            (_, _, true) => i64::from_le_bytes(b.try_into().unwrap()) as f64,
            _ => u64::from_le_bytes(b.try_into().unwrap()) as f64,
        }
    }

    /// Change a number where it lies; a value its width cannot hold is refused.
    pub fn write_cell(&mut self, c: Cell, v: f64) -> Result<(), Kv3Error> {
        let b = &mut self.buffers[c.buffer as usize][c.offset..c.offset + c.width as usize];
        let range = |lo: f64, hi: f64| {
            if v.is_finite() && v >= lo && v <= hi {
                Ok(v.trunc())
            } else {
                err(format!("{v} does not fit"))
            }
        };
        match (c.width, c.float, c.signed) {
            (4, true, _) => b.copy_from_slice(&(v as f32).to_le_bytes()),
            (_, true, _) => b.copy_from_slice(&v.to_le_bytes()),
            (1, _, true) => b[0] = range(-128.0, 127.0)? as i8 as u8,
            (1, _, false) => b[0] = range(0.0, 255.0)? as u8,
            (2, _, true) => b.copy_from_slice(&(range(-32768.0, 32767.0)? as i16).to_le_bytes()),
            (2, _, false) => b.copy_from_slice(&(range(0.0, 65535.0)? as u16).to_le_bytes()),
            (4, _, true) => b.copy_from_slice(&(range(-2147483648.0, 2147483647.0)? as i32).to_le_bytes()),
            (4, _, false) => b.copy_from_slice(&(range(0.0, 4294967295.0)? as u32).to_le_bytes()),
            (_, _, true) => {
                b.copy_from_slice(&(range(-9.223372036854776e18, 9.223372036854776e18)? as i64).to_le_bytes())
            }
            _ => b.copy_from_slice(&(range(0.0, 1.8446744073709552e19)? as u64).to_le_bytes()),
        }
        Ok(())
    }

    /// A number node's value: from its bytes, or from its type for the 0s and 1s stored as a type alone.
    pub fn number_of(&self, node: &Node) -> Option<f64> {
        match &node.value {
            Value::Number { cell: Some(c), .. } => Some(self.read_cell(*c)),
            Value::Number { raw: Some(r), ty, .. } => Some(raw_number(*ty, r)),
            Value::Number { ty, .. } => Some(if matches!(ty, 16 | 18 | 27) { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    /// Set a number node where it lies. A number with bytes takes any value its width holds; one
    /// stored as a type alone can only turn into the other of 0 and 1, by rewriting that type byte,
    /// which keeps every lane the length it was. Returns whether the value could be set.
    pub fn set_number(&mut self, node: &mut Node, v: f64) -> Result<bool, Kv3Error> {
        let Value::Number { ty, cell, type_at, .. } = &mut node.value else { return Ok(false) };
        if let Some(c) = *cell {
            self.write_cell(c, v)?;
            return Ok(true);
        }
        let Some(at) = *type_at else { return Ok(false) };
        if v != 0.0 && v != 1.0 {
            return Ok(false);
        }
        let one = v == 1.0;
        let want = if *ty >= 26 {
            if one {
                27
            } else {
                26
            }
        } else if *ty <= 16 {
            if one {
                16
            } else {
                15
            }
        } else if one {
            18
        } else {
            17
        };
        let mask = if self.version >= 3 { 0x3f } else { 0x7f };
        let b = &mut self.buffers[at.buffer as usize][at.offset];
        *b = (*b & !mask) | want;
        *ty = want;
        Ok(true)
    }

    /// The block with the buffers and blobs as they are now, compressed the way it came.
    pub fn encode(&mut self) -> Result<Vec<u8>, Kv3Error> {
        let mut head = self.head.clone();
        let mut out = self.buffers.clone();
        let mut blob_part = self.blob_part.clone();
        if self.blobs != self.originals {
            if self.method == ZSTD {
                return err("blobs of a zstd block are not written back");
            }
            if self.version < 2 {
                let (c1, c4) = (self.field("c1").max(0) as usize, self.field("c4").max(0) as usize);
                out = vec![relaid_inline(&self.buffers[0], c1, c4, &self.inline, &self.originals, &self.blobs)];
                let grown: i64 =
                    self.blobs.iter().zip(&self.originals).map(|(b, o)| b.len() as i64 - o.len() as i64).sum();
                put_i32(&mut head, self.field_at("c1").unwrap(), c1 as i64 + grown);
                put_i32(&mut head, self.field_at("unc").unwrap(), out[0].len() as i64);
            } else {
                let t = self.table.clone().ok_or_else(|| Kv3Error("blobs with no blob table".into()))?;
                blob_part = rewrite_blobs(&t, &mut self.buffers[t.buf], &self.blobs)?;
                out = self.buffers.clone();
                put_i32(&mut head, self.field_at("blobs").unwrap(), self.blobs.iter().map(|b| b.len() as i64).sum());
            }
        }
        let packed: Vec<Vec<u8>> = out
            .iter()
            .map(|b| match self.method {
                LZ4 => lz4::literals(b),
                ZSTD => zstd_pack(b),
                _ => b.clone(),
            })
            .collect();
        if self.method != NONE {
            if self.version >= 5 {
                put_i32(&mut head, self.field_at("cmp1").unwrap(), packed[0].len() as i64);
                put_i32(&mut head, self.field_at("cmp2").unwrap(), packed[1].len() as i64);
                // with zstd the blobs' frame counts too, the trailer after it does not
                let frame = if self.method == ZSTD && self.table.is_some() { blob_part.len() as i64 - 4 } else { 0 };
                put_i32(&mut head, self.field_at("cmp").unwrap(), (packed[0].len() + packed[1].len()) as i64 + frame);
            } else if self.version > 1 {
                put_i32(&mut head, self.field_at("cmp").unwrap(), packed[0].len() as i64);
            }
        }
        let mut res = head;
        for p in &packed {
            res.extend_from_slice(p);
        }
        res.extend_from_slice(&blob_part);
        res.extend_from_slice(&self.tail);
        Ok(res)
    }

    /// The tree as JSON, the shape test/rust-parity.test.ts gives the TypeScript tree.
    pub fn dump(&self) -> Json {
        json!({
            "version": self.version,
            "strings": self.strings,
            "root": self.dump_node(&self.root),
            "arrays": self.arrays.iter().map(|a| json!({ "key": a.key, "path": a.path,
                "cells": a.cells.iter().map(|c| c.map(cell_json)).collect::<Vec<_>>() })).collect::<Vec<_>>(),
        })
    }

    fn dump_node(&self, n: &Node) -> Json {
        let mut o = match &n.value {
            Value::Object(m) => {
                json!({ "kind": "object", "members": m.iter().map(|(k, v)| json!([k, self.dump_node(v)])).collect::<Vec<_>>() })
            }
            Value::Array { items, element, ty } => {
                let mut a = json!({ "kind": "array", "type": ty, "items": items.iter().map(|x| self.dump_node(x)).collect::<Vec<_>>() });
                if let Some(e) = element {
                    a["element"] =
                        if e.flag != 0 { json!({ "type": e.ty, "flag": e.flag }) } else { json!({ "type": e.ty }) };
                }
                a
            }
            Value::Number { ty, cell, type_at, .. } => {
                let v = self.number_of(n).unwrap_or(0.0);
                json!({ "kind": "number", "type": ty, "cell": cell.map(cell_json), "typeAt": type_at.map(cell_json),
                    "value": if v == 0.0 { json!(0) } else { json!(v) } })
            }
            Value::Str(s) => json!({ "kind": "string", "value": s }),
            Value::Blob(i) => json!({ "kind": "blob", "data": hex(&self.blobs[*i]) }),
            Value::Other { ty, value } => match value {
                Some(v) => json!({ "kind": "other", "type": ty, "value": v }),
                None => json!({ "kind": "other", "type": ty }),
            },
        };
        if n.flag != 0 {
            o["flag"] = json!(n.flag);
        }
        o
    }
}

fn cell_json(c: Cell) -> Json {
    let mut o = json!({ "buffer": c.buffer, "offset": c.offset, "width": c.width, "signed": c.signed });
    if c.float {
        o["float"] = json!(true);
    }
    o
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn raw_number(ty: u8, r: &[u8]) -> f64 {
    let c = Cell {
        buffer: 0,
        offset: 0,
        width: r.len() as u8,
        signed: matches!(ty, 22 | 20 | 11 | 19 | 3 | 5),
        float: matches!(ty, 19 | 5),
    };
    let b = Block {
        version: 0,
        format: [0; 16],
        buffers: vec![r.to_vec()],
        strings: vec![],
        root: Node::new(Value::Other { ty: 1, value: None }),
        arrays: vec![],
        blobs: vec![],
        originals: vec![],
        inline: vec![],
        head: vec![],
        method: 0,
        fields: HashMap::new(),
        blob_part: vec![],
        tail: vec![],
        table: None,
    };
    b.read_cell(c)
}

// --- writing a block anew from its tree (src/kv3-write.ts) ---

const ARRAYS: [u8; 4] = [8, 10, 24, 25];

/// A uint32 0 or 1 stored as its type alone (26, 27) is version 5's: a block written here is version
/// 4 at most, so such a value goes as a plain uint32 (12) with its four bytes.
fn uint32_by_type(t: u8) -> Option<i32> {
    match t {
        26 => Some(0),
        27 => Some(1),
        _ => None,
    }
}

/// A typed array's element type as written: arrays with a one-byte length (24, 25) go as ARRAY_TYPED
/// (10) with a four-byte one, every version reads that; each element in the shape of the type declared.
fn element_type(t: u8) -> u8 {
    if t == 24 || t == 25 {
        10
    } else if uint32_by_type(t).is_some() {
        12
    } else {
        t
    }
}

/// The type a node is written under in its slot. A typed array stays typed, unless it is empty or
/// holds an empty array (Valve never writes an empty typed array), then it goes as a plain one.
fn slot_type(n: &Node) -> u8 {
    match &n.value {
        Value::Object(_) => 9,
        Value::Array { items, element, .. } => match element {
            Some(e) if !items.is_empty() => {
                let holds_empty = ARRAYS.contains(&e.ty)
                    && items.iter().any(|x| matches!(&x.value, Value::Array { items, .. } if items.is_empty()));
                if holds_empty {
                    8
                } else {
                    10
                }
            }
            _ => 8,
        },
        Value::Str(_) => 6,
        Value::Blob(_) => 7,
        Value::Number { ty, .. } | Value::Other { ty, .. } => {
            if uint32_by_type(*ty).is_some() {
                12
            } else {
                *ty
            }
        }
    }
}

struct Writer<'a> {
    kv: &'a Block,
    strings: Vec<String>,
    ids: HashMap<String, i32>,
    l1: Vec<u8>,
    l2: Vec<u8>,
    l4: Vec<u8>,
    l8: Vec<u8>,
    types: Vec<u8>,
    blobs: Vec<&'a [u8]>,
    objects: usize,
    arrays: usize,
}

impl<'a> Writer<'a> {
    fn sid(&mut self, s: &str) -> i32 {
        if s.is_empty() {
            return -1;
        }
        if let Some(&i) = self.ids.get(s) {
            return i;
        }
        let i = self.strings.len() as i32;
        self.strings.push(s.to_string());
        self.ids.insert(s.to_string(), i);
        i
    }
    fn ty(&mut self, t: u8, flag: u8) {
        if flag != 0 {
            self.types.extend([t | 0x80, flag]);
        } else {
            self.types.push(t);
        }
    }
    fn int(&mut self, n: i32) {
        self.l4.extend_from_slice(&n.to_le_bytes());
    }
    fn write(&mut self, n: &'a Node, slot: u8) -> Result<(), Kv3Error> {
        match &n.value {
            Value::Number { ty, cell, raw, .. } => {
                let bytes: Option<&[u8]> = match (raw, cell) {
                    (Some(r), _) => Some(r),
                    (None, Some(c)) => Some(&self.kv.buffers[c.buffer as usize][c.offset..c.offset + c.width as usize]),
                    _ => None,
                };
                match bytes {
                    Some(b) => match b.len() {
                        1 => self.l1.extend_from_slice(b),
                        2 => self.l2.extend_from_slice(b),
                        4 => self.l4.extend_from_slice(b),
                        8 => self.l8.extend_from_slice(b),
                        w => return err(format!("a number {w} bytes wide")),
                    },
                    None => {
                        if let Some(v) = uint32_by_type(*ty) {
                            self.int(v);
                        }
                    }
                }
            }
            Value::Other { ty, value } => {
                if *ty == 2 {
                    self.l1.push(value.unwrap_or(0));
                }
            }
            Value::Str(s) => {
                let i = self.sid(s);
                self.int(i);
            }
            Value::Blob(i) => {
                self.blobs.push(self.kv.blobs.get(*i).ok_or_else(|| Kv3Error("a blob that is not there".into()))?)
            }
            Value::Array { items, element, .. } => {
                self.arrays += 1;
                self.int(items.len() as i32);
                if slot == 10 {
                    let e = element.ok_or_else(|| Kv3Error("a typed array with no element type".into()))?;
                    let t = element_type(e.ty);
                    self.ty(t, e.flag);
                    for x in items {
                        self.write(x, t)?;
                    }
                } else {
                    for x in items {
                        self.ty(slot_type(x), x.flag);
                        self.write(x, slot_type(x))?;
                    }
                }
            }
            Value::Object(m) => {
                self.objects += 1;
                self.int(m.len() as i32);
                for (name, x) in m {
                    self.ty(slot_type(x), x.flag);
                    let i = self.sid(name);
                    self.int(i);
                    self.write(x, slot_type(x))?;
                }
            }
        }
        Ok(())
    }
}

/// The block written anew from `kv.root`, with the source's format GUID: one buffer, LZ4, the
/// layout of versions 2 to 4 (1 and 2 as 2, 3 as 3, 4 and 5 as 4, so a flag byte means what it meant).
pub fn write(kv: &Block) -> Result<Vec<u8>, Kv3Error> {
    let version: u32 = match kv.version {
        0..=2 => 2,
        3 => 3,
        _ => 4,
    };
    let mut w = Writer {
        kv,
        strings: vec![],
        ids: HashMap::new(),
        l1: vec![],
        l2: vec![],
        l4: vec![],
        l8: vec![],
        types: vec![],
        blobs: vec![],
        objects: 0,
        arrays: 0,
    };
    w.ty(slot_type(&kv.root), kv.root.flag);
    w.write(&kv.root, slot_type(&kv.root))?;
    if w.objects > 0xffff || w.arrays > 0xffff {
        return err("too many objects or arrays for the header");
    }

    let mut text = Vec::new();
    for s in &w.strings {
        text.extend_from_slice(s.as_bytes());
        text.push(0);
    }
    let chunks: Vec<Vec<u8>> = w.blobs.iter().flat_map(|b| b.chunks(FRAME)).map(lz4::literals).collect();
    let mut tail = Vec::new();
    for b in &w.blobs {
        tail.extend_from_slice(&(b.len() as i32).to_le_bytes());
    }
    tail.extend_from_slice(&TRAILER.to_le_bytes());
    if !w.blobs.is_empty() {
        for c in &chunks {
            if c.len() > 0xffff {
                return err("a blob frame too long");
            }
            tail.extend_from_slice(&(c.len() as u16).to_le_bytes());
        }
    }
    let mut raw = w.l1.clone();
    let place = |raw: &mut Vec<u8>, b: &[u8], a: usize| {
        raw.resize(align(raw.len(), a), 0);
        raw.extend_from_slice(b);
    };
    if version >= 4 {
        place(&mut raw, &w.l2, 2);
    }
    let mut l4 = (w.strings.len() as i32).to_le_bytes().to_vec();
    l4.extend_from_slice(&w.l4);
    place(&mut raw, &l4, 4);
    place(&mut raw, &w.l8, 8);
    raw.extend_from_slice(&text);
    raw.extend_from_slice(&w.types);
    raw.extend_from_slice(&tail);
    let packed = lz4::literals(&raw);

    let mut head = vec![0u8; if version >= 4 { 72 } else { 64 }];
    head[0..4].copy_from_slice(&(MAGIC + version).to_le_bytes());
    head[4..20].copy_from_slice(&kv.format);
    head[20..24].copy_from_slice(&LZ4.to_le_bytes());
    head[26..28].copy_from_slice(&(FRAME as u16).to_le_bytes());
    put_i32(&mut head, 28, w.l1.len() as i64);
    put_i32(&mut head, 32, 1 + w.l4.len() as i64 / 4);
    put_i32(&mut head, 36, w.l8.len() as i64 / 8);
    put_i32(&mut head, 40, (text.len() + w.types.len()) as i64);
    head[44..46].copy_from_slice(&(w.objects as u16).to_le_bytes());
    head[46..48].copy_from_slice(&(w.arrays as u16).to_le_bytes());
    put_i32(&mut head, 48, raw.len() as i64);
    put_i32(&mut head, 52, packed.len() as i64);
    put_i32(&mut head, 56, w.blobs.len() as i64);
    put_i32(&mut head, 60, w.blobs.iter().map(|b| b.len() as i64).sum());
    if version >= 4 {
        put_i32(&mut head, 64, w.l2.len() as i64 / 2); // and 0 for the frame table's size, as Valve's version 4 files have
    }
    let mut out = head;
    out.extend_from_slice(&packed);
    if !w.blobs.is_empty() {
        for c in &chunks {
            out.extend_from_slice(c);
        }
        out.extend_from_slice(&TRAILER.to_le_bytes());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A version 2 block by hand: { a = 5, b = "x", c = [1.5f32] typed }, LZ4 literals.
    fn tiny() -> Vec<u8> {
        // lanes: l1 empty; l4: nstrings=3, obj len=3, (type, name) a: name 0, int 5; b: name 1, str 2; c: name 2, arr len 1, f32
        let mut l4: Vec<i32> = vec![3, 3, 0, 5, 1, 2, 2, 1];
        let f = 1.5f32.to_bits() as i32;
        l4.push(f);
        let mut raw: Vec<u8> = l4.iter().flat_map(|v| v.to_le_bytes()).collect();
        raw.resize(align(raw.len(), 8), 0);
        raw.extend_from_slice(b"a\0b\0c\0");
        let types = [9u8, 11, 6, 10, 19];
        raw.extend_from_slice(&types);
        raw.extend_from_slice(&TRAILER.to_le_bytes());
        let packed = lz4::literals(&raw);
        let mut head = vec![0u8; 64];
        head[0..4].copy_from_slice(&(MAGIC + 2).to_le_bytes());
        head[20..24].copy_from_slice(&1u32.to_le_bytes());
        put_i32(&mut head, 28, 0);
        put_i32(&mut head, 32, l4.len() as i64);
        put_i32(&mut head, 36, 0);
        put_i32(&mut head, 40, 6 + types.len() as i64);
        put_i32(&mut head, 48, raw.len() as i64);
        put_i32(&mut head, 52, packed.len() as i64);
        head.extend_from_slice(&packed);
        head
    }

    #[test]
    fn a_block_reads_changes_and_writes_back() {
        let mut kv = read(&tiny()).unwrap();
        assert_eq!(kv.strings, ["a", "b", "c"]);
        let a = kv.root.get("a").unwrap().clone();
        assert_eq!(kv.number_of(&a), Some(5.0));
        assert_eq!(kv.root.get("b").unwrap().as_str(), Some("c"));
        assert_eq!(kv.arrays.len(), 1);
        let mut a2 = a.clone();
        kv.set_number(&mut a2, 7.0).unwrap();
        let back = read(&kv.encode().unwrap()).unwrap();
        assert_eq!(back.number_of(back.root.get("a").unwrap()), Some(7.0));
        let again = read(&write(&kv).unwrap()).unwrap();
        assert_eq!(again.dump()["root"], kv.dump()["root"]);
        let c = again.root.get("c").unwrap().items()[0].clone();
        assert_eq!(again.number_of(&c), Some(1.5));
    }

    #[test]
    fn a_short_block_is_refused() {
        let mut b = tiny();
        let n = b.len();
        b.truncate(n - 3);
        assert!(read(&b).is_err());
        assert!(read(b"nope").is_err());
    }
}
