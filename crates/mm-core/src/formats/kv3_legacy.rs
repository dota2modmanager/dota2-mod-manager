//! The older binary KV3, magic `VKV\x03`, read as JSON: what kv3.rs's versions 1 to 5 replaced.
//! Some resources compiled years ago still carry it, a particle snapshot's DATA among them (a
//! weapon's glowing edge drawn along a snapshot): read as no snapshot at all, its effect drew
//! nothing. The layout follows ValveResourceFormat's BinaryKV3.cs (MIT): an encoding (block
//! compressed, LZ4 or none), then the strings, then the tree with its types inline.

use serde_json::{json, Map, Value};

const MAGIC: &[u8; 4] = b"VKV\x03";
const BLOCK: [u8; 16] =
    [0x46, 0x1a, 0x79, 0x95, 0xbc, 0x95, 0x6c, 0x4f, 0xa7, 0x0b, 0x05, 0xbc, 0xa1, 0xb7, 0xdf, 0xd2];
const PLAIN: [u8; 16] =
    [0x00, 0x05, 0x86, 0x1b, 0xd8, 0xf7, 0xc1, 0x40, 0xad, 0x82, 0x75, 0xa4, 0x82, 0x67, 0xe7, 0x14];
const LZ4: [u8; 16] = [0x8a, 0x34, 0x47, 0x68, 0xa1, 0x63, 0x5c, 0x4f, 0xa1, 0x97, 0x53, 0x80, 0x6f, 0xd9, 0xb1, 0x19];

/// Whether a DATA block is the older KV3.
pub fn is_legacy(block: &[u8]) -> bool {
    block.starts_with(MAGIC)
}

/// The block's tree as JSON: objects, arrays, numbers, strings and booleans; a blob is null.
pub fn read_json(block: &[u8]) -> Result<Value, String> {
    if !is_legacy(block) || block.len() < 36 {
        return Err("kv3 legacy: not a VKV3 block".into());
    }
    let encoding: [u8; 16] = block[4..20].try_into().map_err(|_| "kv3 legacy: short header")?;
    let rest = &block[36..];
    let data = match encoding {
        BLOCK => block_decompress(rest)?,
        PLAIN => rest.to_vec(),
        LZ4 => {
            let size = u32::from_le_bytes(rest.get(..4).ok_or("kv3 legacy: short LZ4 header")?.try_into().unwrap());
            crate::lz4::decode(&rest[4..], size as usize).map_err(|e| e.to_string())?
        }
        _ => return Err("kv3 legacy: an unknown encoding".into()),
    };
    let mut r = Reader { b: &data, at: 0, strings: Vec::new() };
    let count = r.u32()?;
    if count > 1 << 20 {
        return Err("kv3 legacy: too many strings".into());
    }
    for _ in 0..count {
        let s = r.cstr()?;
        r.strings.push(s);
    }
    let (_, root) = r.node(true, 0)?;
    Ok(root)
}

/// The older block compression: a 24-bit size (the top byte's high bit: stored as it is), then
/// 16-bit masks, each bit a literal byte or a back reference of 12-bit distance and 4-bit length.
fn block_decompress(src: &[u8]) -> Result<Vec<u8>, String> {
    let flags = src.get(..4).ok_or("kv3 legacy: short block header")?;
    let size = flags[0] as usize | (flags[1] as usize) << 8 | (flags[2] as usize) << 16;
    let mut pos = 4;
    if flags[3] & 0x80 != 0 {
        return Ok(src[pos..].to_vec());
    }
    let mut out: Vec<u8> = Vec::with_capacity(size);
    let byte = |pos: &mut usize| -> Result<u8, String> {
        let b = *src.get(*pos).ok_or("kv3 legacy: compressed data ends early")?;
        *pos += 1;
        Ok(b)
    };
    while out.len() < size {
        let mask = byte(&mut pos)? as u16 | (byte(&mut pos)? as u16) << 8;
        for bit in 0..16 {
            if out.len() >= size {
                break;
            }
            if mask & (1 << bit) != 0 {
                let word = byte(&mut pos)? as usize | (byte(&mut pos)? as usize) << 8;
                let back = ((word & 0xfff0) >> 4) + 1;
                let len = (word & 0xf) + 3;
                let from = out.len().checked_sub(back).ok_or("kv3 legacy: a reference before the start")?;
                for k in 0..len {
                    let b = out[from + k];
                    out.push(b);
                }
            } else {
                out.push(byte(&mut pos)?);
            }
        }
    }
    out.truncate(size);
    Ok(out)
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
    strings: Vec<String>,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let s = self.b.get(self.at..self.at + n).ok_or("kv3 legacy: data ends early")?;
        self.at += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn cstr(&mut self) -> Result<String, String> {
        let rest = &self.b[self.at..];
        let end = memchr::memchr(0, rest).ok_or("kv3 legacy: a string with no end")?;
        let s = String::from_utf8_lossy(&rest[..end]).into_owned();
        self.at += end + 1;
        Ok(s)
    }
    fn string(&mut self, id: i32) -> Result<String, String> {
        if id < 0 {
            return Ok(String::new());
        }
        self.strings.get(id as usize).cloned().ok_or_else(|| "kv3 legacy: a string out of range".into())
    }
    /// A type byte, and its flag byte when it has one.
    fn ty(&mut self) -> Result<u8, String> {
        let t = self.u8()?;
        if t & 0x80 != 0 {
            self.u8()?;
            return Ok(t & 0x3f);
        }
        Ok(t)
    }
    /// One entry: its name (in an object), its type and its value.
    fn node(&mut self, in_array: bool, depth: usize) -> Result<(String, Value), String> {
        if depth > 64 {
            return Err("kv3 legacy: nested too deep".into());
        }
        let name = if in_array {
            String::new()
        } else {
            let id = self.i32()?;
            self.string(id)?
        };
        let t = self.ty()?;
        Ok((name, self.value(t, depth)?))
    }
    fn value(&mut self, t: u8, depth: usize) -> Result<Value, String> {
        Ok(match t {
            1 => Value::Null,
            2 => Value::Bool(self.u8()? != 0),
            3 => json!(i64::from_le_bytes(self.take(8)?.try_into().unwrap())),
            4 => json!(u64::from_le_bytes(self.take(8)?.try_into().unwrap())),
            5 => crate::js::json_number(f64::from_le_bytes(self.take(8)?.try_into().unwrap())),
            6 => {
                let id = self.i32()?;
                Value::String(self.string(id)?)
            }
            7 => {
                let n = self.i32()?.max(0) as usize;
                self.take(n)?;
                Value::Null
            }
            8 => {
                let n = self.count()?;
                let mut items = Vec::with_capacity(n);
                for _ in 0..n {
                    items.push(self.node(true, depth + 1)?.1);
                }
                Value::Array(items)
            }
            9 => {
                let n = self.count()?;
                let mut m = Map::new();
                for _ in 0..n {
                    let (k, v) = self.node(false, depth + 1)?;
                    m.insert(k, v);
                }
                Value::Object(m)
            }
            10 => {
                let n = self.count()?;
                let sub = self.ty()?;
                let mut items = Vec::with_capacity(n);
                for _ in 0..n {
                    items.push(self.value(sub, depth + 1)?);
                }
                Value::Array(items)
            }
            11 => json!(self.i32()?),
            12 => json!(self.u32()?),
            13 => Value::Bool(true),
            14 => Value::Bool(false),
            15 => json!(0),
            16 => json!(1),
            17 => json!(0),
            18 => json!(1),
            _ => return Err(format!("kv3 legacy: an unknown type {t}")),
        })
    }
    fn count(&mut self) -> Result<usize, String> {
        let n = self.i32()?;
        if !(0..=1 << 20).contains(&n) {
            return Err("kv3 legacy: a count out of range".into());
        }
        Ok(n as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A block of the older KV3, stored uncompressed: { num: 23, name: "position", list: [1.5, 2] }.
    fn sample() -> Vec<u8> {
        let mut b = MAGIC.to_vec();
        b.extend(PLAIN);
        b.extend([0u8; 16]);
        b.extend(3u32.to_le_bytes());
        for s in ["num", "name", "list"] {
            b.extend(s.as_bytes());
            b.push(0);
        }
        b.push(9);
        b.extend(3i32.to_le_bytes());
        b.extend(0i32.to_le_bytes());
        b.push(11);
        b.extend(23i32.to_le_bytes());
        b.extend(1i32.to_le_bytes());
        b.push(6);
        b.extend(1i32.to_le_bytes());
        b.extend(2i32.to_le_bytes());
        b.push(8);
        b.extend(2i32.to_le_bytes());
        b.push(5);
        b.extend(1.5f64.to_le_bytes());
        b.push(0x80 | 16);
        b.push(0);
        b
    }

    #[test]
    fn the_older_kv3_reads_as_json() {
        let v = read_json(&sample()).unwrap();
        assert_eq!(v, json!({ "num": 23, "name": "name", "list": [1.5, 1] }));
        assert!(read_json(b"KV3\x01").is_err());
    }

    #[test]
    fn block_compression_copies_back() {
        // size 6, then a mask: three literals "abc", then a reference 3 back for 3: "abcabc"
        let src = [6, 0, 0, 0, 0b0000_1000, 0, b'a', b'b', b'c', (2 << 4) as u8, 0];
        assert_eq!(block_decompress(&src).unwrap(), b"abcabc");
    }
}
