//! The older binary KV3, magic `VKV\x03`, which kv3.rs's versions 1 to 5 replaced. Resources
//! compiled years ago still carry it in their DATA block: a particle snapshot among them, which
//! read as nothing left an effect drawn along it (a weapon's glowing edge) out of the 3D preview.
//!
//! After the magic come two GUIDs, the encoding and the format, then the data: block compressed
//! (a 24-bit size, then 16-bit masks of literal bytes and back references), LZ4, or stored as it
//! is. The data is the strings (a count and each with its zero), then the tree in one stream, a
//! value's type byte (and flag) and its bytes inline, an object member's name before its type, and
//! in the game's files a trailer of four 0xff. Every one of pak01's (338, all particle snapshots)
//! reads, and reads the same written back (the ignored test at the end, on the game's own files).
//! That is a KV3 walk over a single lane (kv3.rs `Walk`, version 0), so every reader of `kv3::read`
//! takes these blocks too, and a number changed in one is written back as a block of version 2.
//! The layout follows ValveResourceFormat's BinaryKV3.cs (MIT).

use super::*;

pub(super) const MAGIC: &[u8; 4] = b"VKV\x03";
const BLOCK: [u8; 16] =
    [0x46, 0x1a, 0x79, 0x95, 0xbc, 0x95, 0x6c, 0x4f, 0xa7, 0x0b, 0x05, 0xbc, 0xa1, 0xb7, 0xdf, 0xd2];
const PLAIN: [u8; 16] =
    [0x00, 0x05, 0x86, 0x1b, 0xd8, 0xf7, 0xc1, 0x40, 0xad, 0x82, 0x75, 0xa4, 0x82, 0x67, 0xe7, 0x14];
const LZ4_BLOCK: [u8; 16] =
    [0x8a, 0x34, 0x47, 0x68, 0xa1, 0x63, 0x5c, 0x4f, 0xa1, 0x97, 0x53, 0x80, 0x6f, 0xd9, 0xb1, 0x19];

/// Read a KV3 block (a resource's DATA block, magic included): a newer one (versions 1 to 5), or
/// an older one into the same tree, as version 0.
pub fn read(block: &[u8]) -> Result<Block, Kv3Error> {
    if block.starts_with(MAGIC) {
        read_older(block)
    } else {
        read_newer(block)
    }
}

impl Block {
    /// The block with its changes, as it came; an older one is written as a newer one (version 2),
    /// which the game reads as well.
    pub fn encode(&mut self) -> Result<Vec<u8>, Kv3Error> {
        if self.version == 0 {
            return write(self);
        }
        self.encode_newer()
    }
}

impl Walk<'_> {
    /// An object's member: its type and the flag after it, and its name; the older stream names a
    /// member before its type.
    pub(super) fn member(&mut self) -> Result<(u8, Cell, u8, String), Kv3Error> {
        if self.version == 0 {
            let name = self.string()?;
            let (ty, at, flag) = self.read_type()?;
            return Ok((ty, at, flag, name));
        }
        let (ty, at, flag) = self.read_type()?;
        Ok((ty, at, flag, self.string()?))
    }
}

/// Read an older KV3 block into the same tree a newer one gives (version 0).
fn read_older(block: &[u8]) -> Result<Block, Kv3Error> {
    if block.len() < 36 || !block.starts_with(MAGIC) {
        return err("not an older KV3 block");
    }
    let rest = &block[36..];
    let encoding = &block[4..20];
    let data = if encoding == BLOCK {
        block_decompress(rest)?
    } else if encoding == PLAIN {
        rest.to_vec()
    } else if encoding == LZ4_BLOCK {
        let size = u32_at(rest, 0)? as usize;
        lz4::decode(&rest[4..], size)?
    } else {
        return err("an older KV3 block of an unknown encoding");
    };
    let buffers = vec![data];
    let b0 = &buffers[0];
    let n = i32_at(b0, 0)?;
    if !(0..=1 << 20).contains(&n) {
        return err("a string count out of range");
    }
    let mut at = 4usize;
    let mut strings = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let z =
            memchr::memchr(0, b0.get(at..).unwrap_or(&[])).ok_or_else(|| Kv3Error("a string with no end".into()))? + at;
        strings.push(String::from_utf8_lossy(&b0[at..z]).into_owned());
        at = z + 1;
    }
    let mut w = Walk {
        version: 0,
        buffers: &buffers,
        strings: &strings,
        lanes: vec![Lane { buf: 0, at, end: b0.len() }],
        main: [0; 4],
        aux: [0; 4],
        types: 0,
        object_lengths: None,
        blob_lengths: None,
        blob_data: &[],
        blob_read: 0,
        arrays: Vec::new(),
        blobs: Vec::new(),
        inline: Vec::new(),
    };
    let (rt, rat, rf) = w.read_type()?;
    let root = w.value(rt, Some(rat), [0; 4], "", "", rf)?;
    // the stream ends with the tree, or with a trailer of four 0xff after it, as the game's do
    let left = &b0[w.lanes[0].at..];
    if !(left.is_empty() || left == [0xff; 4]) {
        return err("the walk did not end where the data does");
    }
    let (arrays, blobs, inline) = (w.arrays, w.blobs, w.inline);
    let mut format = [0u8; 16];
    format.copy_from_slice(&block[20..36]);
    Ok(Block {
        version: 0,
        format,
        strings,
        root,
        arrays,
        originals: blobs.clone(),
        blobs,
        inline,
        head: block[..36].to_vec(),
        method: NONE,
        fields: HashMap::new(),
        blob_part: Vec::new(),
        tail: Vec::new(),
        table: None,
        buffers,
    })
}

/// The older block compression: a 24-bit size (the top byte's high bit: stored as it is), then
/// 16-bit masks, each bit a literal byte or a back reference of 12-bit distance and 4-bit length.
fn block_decompress(src: &[u8]) -> Result<Vec<u8>, Kv3Error> {
    let flags = src.get(..4).ok_or_else(|| Kv3Error("a short block header".into()))?;
    let size = flags[0] as usize | (flags[1] as usize) << 8 | (flags[2] as usize) << 16;
    if flags[3] & 0x80 != 0 {
        return Ok(src[4..].to_vec());
    }
    let mut pos = 4;
    let mut out: Vec<u8> = Vec::with_capacity(size);
    let byte = |pos: &mut usize| -> Result<u8, Kv3Error> {
        let b = *src.get(*pos).ok_or_else(|| Kv3Error("compressed data ends early".into()))?;
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
                let from =
                    out.len().checked_sub(back).ok_or_else(|| Kv3Error("a reference before the start".into()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The data of { num: 23, name: "list", list: [1.5, 1], f: 0.25 } in the older stream.
    fn stream() -> Vec<u8> {
        let mut b = 4u32.to_le_bytes().to_vec();
        for s in ["num", "name", "list", "f"] {
            b.extend(s.as_bytes());
            b.push(0);
        }
        b.push(9); // object
        b.extend(4i32.to_le_bytes());
        b.extend(0i32.to_le_bytes()); // "num": the name before the type
        b.push(11);
        b.extend(23i32.to_le_bytes());
        b.extend(1i32.to_le_bytes()); // "name": a string
        b.push(6);
        b.extend(2i32.to_le_bytes());
        b.extend(2i32.to_le_bytes()); // "list": an array of a double and a flagged one
        b.push(8);
        b.extend(2i32.to_le_bytes());
        b.push(5);
        b.extend(1.5f64.to_le_bytes());
        b.push(0x80 | 18);
        b.push(0);
        b.extend(3i32.to_le_bytes()); // "f": a double
        b.push(5);
        b.extend(0.25f64.to_le_bytes());
        b
    }

    fn block(encoding: [u8; 16], data: &[u8]) -> Vec<u8> {
        let mut b = MAGIC.to_vec();
        b.extend(encoding);
        b.extend([7u8; 16]);
        b.extend(data);
        b
    }

    fn json_of(kv: &Block) -> Json {
        kv.tree()
    }

    #[test]
    fn an_older_block_reads_as_a_kv3_tree() {
        let kv = read_older(&block(PLAIN, &stream())).unwrap();
        assert_eq!(kv.version, 0);
        assert_eq!(kv.format, [7u8; 16]);
        assert_eq!(kv.root.get("name").and_then(Node::as_str), Some("list"));
        let num = kv.root.get("num").unwrap();
        assert_eq!(kv.number_of(num), Some(23.0));
        assert_eq!(kv.root.get("list").unwrap().items().len(), 2);
        assert_eq!(kv.number_of(&kv.root.get("list").unwrap().items()[1]), Some(1.0));
        assert!(kv.arrays.iter().any(|a| a.key == "list"), "an array of numbers is listed for patching");
        // kv3::read takes it as it takes a newer one
        assert_eq!(super::read(&block(PLAIN, &stream())).unwrap().version, 0);
    }

    #[test]
    fn block_compression_and_its_back_references() {
        // size 6, a mask: three literals "abc", then a reference 3 back for 3: "abcabc"
        let src = [6, 0, 0, 0, 0b0000_1000, 0, b'a', b'b', b'c', (2 << 4) as u8, 0];
        assert_eq!(block_decompress(&src).unwrap(), b"abcabc");
        // the whole stream stored by literals alone, sixteen to a mask
        let data = stream();
        let mut packed = (data.len() as u32).to_le_bytes().to_vec();
        for chunk in data.chunks(16) {
            packed.extend([0, 0]);
            packed.extend(chunk);
        }
        let a = read_older(&block(BLOCK, &packed)).unwrap();
        let b = read_older(&block(PLAIN, &data)).unwrap();
        assert_eq!(json_of(&a), json_of(&b));
    }

    #[test]
    fn a_number_changed_in_an_older_block_is_written_as_a_newer_one() {
        let mut kv = read_older(&block(PLAIN, &stream())).unwrap();
        let Value::Number { cell: Some(c), .. } = kv.root.get("f").unwrap().value else { panic!("a cell") };
        kv.write_cell(c, 0.75).unwrap();
        let out = kv.encode().unwrap();
        let back = super::read(&out).unwrap();
        assert!(back.version >= 2, "written as a newer block");
        assert_eq!(back.format, [7u8; 16], "the format kept");
        assert_eq!(back.number_of(back.root.get("f").unwrap()), Some(0.75));
        assert_eq!(back.root.get("name").and_then(Node::as_str), Some("list"));
    }

    #[test]
    fn a_broken_older_block_is_refused() {
        let mut data = stream();
        data.truncate(data.len() - 3);
        assert!(read_older(&block(PLAIN, &data)).is_err());
        assert!(read_older(&block([1u8; 16], &stream())).is_err(), "an unknown encoding");
        let mut trailed = stream();
        trailed.extend([0xff; 4]);
        assert!(read_older(&block(PLAIN, &trailed)).is_ok(), "the game's trailer after the tree");
        trailed.push(0);
        assert!(read_older(&block(PLAIN, &trailed)).is_err(), "anything more is not");
    }

    /// Every older block in the game's pak01 read, and written back the same: D2MM_PAK01 names it.
    #[test]
    #[ignore]
    fn every_older_block_of_the_game_reads() {
        let Ok(path) = std::env::var("D2MM_PAK01") else { return };
        let index = crate::vpk::Index::open(std::path::Path::new(&path)).unwrap();
        let (mut seen, mut failed) = (0, Vec::new());
        let paths: Vec<String> = index.paths().map(str::to_string).collect();
        for p in paths.iter().filter(|p| p.ends_with("_c")) {
            let Some(file) = index.read(p).ok().flatten() else { continue };
            let Ok(data) = crate::resource::data_block(&file) else { continue };
            if !data.starts_with(MAGIC) {
                continue;
            }
            seen += 1;
            match super::read(data) {
                Ok(mut kv) => {
                    let again = kv.encode().and_then(|b| super::read(&b));
                    if again.map(|b| b.tree() != kv.tree()).unwrap_or(true) {
                        failed.push(format!("{p}: not the same written back"));
                    }
                }
                Err(e) => failed.push(format!("{p}: {e}")),
            }
        }
        println!("older KV3 blocks: {seen}, failed: {}", failed.len());
        for f in failed.iter().take(20) {
            println!("  {f}");
        }
        assert!(failed.is_empty());
    }
}
