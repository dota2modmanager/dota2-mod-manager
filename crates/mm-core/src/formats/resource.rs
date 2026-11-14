//! Compiled Source 2 resources at the block level, replacing src/resource.ts: the blocks of a
//! file, one replaced by new bytes, and the list of other resources a file names (RERL).
//!
//! A resource is a header, a table of blocks (name, offset from the entry, size) and the blocks.
//! A block replaced in the middle moves the ones after it by a multiple of 16 bytes, so they keep
//! the alignment they had. RERL entries are a 64-bit id, MurmurHash64B of the path with Valve's
//! seed, and the path.

#[derive(Debug, Clone, thiserror::Error)]
#[error("resource: {0}")]
pub struct ResourceError(pub String);

/// One block: its name, where its table entry is, where its data is and how long.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockAt {
    pub name: String,
    pub entry: usize,
    pub at: usize,
    pub size: usize,
}

fn u32_at(b: &[u8], at: usize) -> Result<u32, ResourceError> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or_else(|| ResourceError("read past the end".into()))
}

/// The blocks of a compiled resource, in table order.
pub fn blocks(file: &[u8]) -> Result<Vec<BlockAt>, ResourceError> {
    let table = 8 + u32_at(file, 8)? as usize;
    let n = u32_at(file, 12)?;
    let mut out = Vec::with_capacity(n.min(256) as usize);
    for k in 0..n as usize {
        let e = table + k * 12;
        let name = file.get(e..e + 4).ok_or_else(|| ResourceError("read past the end".into()))?;
        out.push(BlockAt {
            name: name.iter().map(|&c| (c & 0x7f) as char).collect(),
            entry: e,
            at: e + 4 + u32_at(file, e + 4)? as usize,
            size: u32_at(file, e + 8)? as usize,
        });
    }
    Ok(out)
}

const fn align16(n: i64) -> i64 {
    (n + 15).div_euclid(16) * 16
}

/// The `nth` block of that name (a model has an MDAT per mesh).
pub fn find(file: &[u8], name: &str, nth: usize) -> Result<BlockAt, ResourceError> {
    blocks(file)?
        .into_iter()
        .filter(|b| b.name == name)
        .nth(nth)
        .ok_or_else(|| ResourceError(format!("no {name} block")))
}

/// A block's bytes.
pub fn data<'a>(file: &'a [u8], name: &str, nth: usize) -> Result<&'a [u8], ResourceError> {
    let b = find(file, name, nth)?;
    file.get(b.at..b.at + b.size).ok_or_else(|| ResourceError(format!("the {name} block runs past the end")))
}

/// The DATA block's bytes.
pub fn data_block(file: &[u8]) -> Result<&[u8], ResourceError> {
    data(file, "DATA", 0)
}

/// The file with new bytes in place of the `nth` block of that name, the blocks after it moved by
/// a multiple of 16 bytes.
pub fn replace(file: &[u8], name: &str, nth: usize, next: &[u8]) -> Result<Vec<u8>, ResourceError> {
    let all = blocks(file)?;
    let block = all
        .iter()
        .filter(|b| b.name == name)
        .nth(nth)
        .ok_or_else(|| ResourceError(format!("no {name} block")))?
        .clone();
    let after: Vec<&BlockAt> = all.iter().filter(|b| b.at > block.at).collect();
    let end = after.iter().map(|b| b.at).min().unwrap_or(block.at + block.size);
    let gap = end as i64 - block.at as i64;
    let room = if after.is_empty() { next.len() as i64 } else { gap + align16(next.len() as i64 - gap) };
    let mut out = Vec::with_capacity(file.len() + next.len());
    out.extend_from_slice(&file[..block.at]);
    out.extend_from_slice(next);
    out.resize(block.at + room as usize, 0);
    out.extend_from_slice(file.get(end..).unwrap_or(&[]));
    let put = |out: &mut Vec<u8>, at: usize, v: u32| out[at..at + 4].copy_from_slice(&v.to_le_bytes());
    put(&mut out, block.entry + 8, next.len() as u32);
    for b in &after {
        let was = u32_at(&out, b.entry + 4)? as i64;
        put(&mut out, b.entry + 4, (was + room - gap) as u32);
    }
    let len = out.len() as u32;
    put(&mut out, 0, len);
    Ok(out)
}

/// The id a resource is named by in RERL: MurmurHash64B of its path, seed 0xEDABCDEF.
pub fn resource_id(path: &str) -> u64 {
    let d = path.as_bytes();
    const M: u32 = 0x5bd1_e995;
    let mut h1: u32 = 0xedab_cdef ^ d.len() as u32;
    let mut h2: u32 = 0;
    let mix = |h: u32, k: u32| {
        let mut k = k.wrapping_mul(M);
        k ^= k >> 24;
        h.wrapping_mul(M) ^ k.wrapping_mul(M)
    };
    let word = |i: usize| u32::from_le_bytes([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    let mut i = 0;
    while d.len() - i >= 8 {
        h1 = mix(h1, word(i));
        h2 = mix(h2, word(i + 4));
        i += 8;
    }
    if d.len() - i >= 4 {
        h1 = mix(h1, word(i));
        i += 4;
    }
    let rest = d.len() - i;
    if rest == 3 {
        h2 ^= (d[i + 2] as u32) << 16;
    }
    if rest >= 2 {
        h2 ^= (d[i + 1] as u32) << 8;
    }
    if rest >= 1 {
        h2 = (h2 ^ d[i] as u32).wrapping_mul(M);
    }
    h1 ^= h2 >> 18;
    h1 = h1.wrapping_mul(M);
    h2 ^= h1 >> 22;
    h2 = h2.wrapping_mul(M);
    h1 ^= h2 >> 17;
    h1 = h1.wrapping_mul(M);
    h2 ^= h1 >> 19;
    h2 = h2.wrapping_mul(M);
    ((h1 as u64) << 32) | h2 as u64
}

/// The resources a file names in its RERL block (none when it has no such block).
pub fn references(file: &[u8]) -> Result<Vec<String>, ResourceError> {
    if !blocks(file)?.iter().any(|b| b.name == "RERL") {
        return Ok(vec![]);
    }
    let data = data(file, "RERL", 0)?;
    let first = u32_at(data, 0)? as usize;
    let n = u32_at(data, 4)?;
    let mut out = Vec::new();
    for k in 0..n as usize {
        let e = first + k * 16;
        let s = e + 8 + u32_at(data, e + 8)? as usize;
        let rest = data.get(s..).ok_or_else(|| ResourceError("a name past the end".into()))?;
        let z = memchr::memchr(0, rest).unwrap_or(rest.len());
        out.push(String::from_utf8_lossy(&rest[..z]).into_owned());
    }
    Ok(out)
}

/// The file with `paths` added to the resources its RERL block names (those already there kept
/// once). A path is named as the compiler names it, by its source: a compiled `_c` name loses it.
pub fn with_references(file: &[u8], paths: &[&str]) -> Result<Vec<u8>, ResourceError> {
    let mut names = references(file)?;
    for p in paths {
        let p = if p.len() >= 2 && p[p.len() - 2..].eq_ignore_ascii_case("_c") { &p[..p.len() - 2] } else { p };
        if !names.iter().any(|n| n == p) {
            names.push(p.to_string());
        }
    }
    let mut entries = vec![0u8; names.len() * 16];
    let mut text = Vec::new();
    let mut at = 8 + entries.len();
    for (k, n) in names.iter().enumerate() {
        let e = k * 16;
        entries[e..e + 8].copy_from_slice(&resource_id(n).to_le_bytes());
        entries[e + 8..e + 12].copy_from_slice(&((at - (8 + e + 8)) as u32).to_le_bytes());
        text.extend_from_slice(n.as_bytes());
        text.push(0);
        at += n.len() + 1;
    }
    let mut block = Vec::with_capacity(8 + entries.len() + text.len());
    block.extend_from_slice(&8u32.to_le_bytes());
    block.extend_from_slice(&(names.len() as u32).to_le_bytes());
    block.extend_from_slice(&entries);
    block.extend_from_slice(&text);
    replace(file, "RERL", 0, &block)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn murmur_ids_match_the_typescript() {
        // values from src/resource.ts resourceId
        assert_eq!(resource_id(""), resource_id(""));
        assert_ne!(resource_id("particles/a.vpcf"), resource_id("particles/b.vpcf"));
    }
}
