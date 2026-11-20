//! Zstd in the game's KV3 blocks (kv3.rs): a frame unpacked, and a version 4 block's two frames,
//! the buffer and then the blobs, which about thirty heroes' animations are stored as. A block is
//! written back by kv3::write, packed as it packs every block.

use std::io::Read;

use crate::kv3::Kv3Error;

fn err<T>(m: &str) -> Result<T, Kv3Error> {
    Err(Kv3Error(m.into()))
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

/// Every zstd frame of `src`, one after another, unpacked.
pub(super) fn zstd_frames(mut src: &[u8]) -> Result<Vec<Vec<u8>>, Kv3Error> {
    let mut out = Vec::new();
    while !src.is_empty() {
        let mut d = ruzstd::decoding::StreamingDecoder::new(&mut src).map_err(|e| Kv3Error(format!("zstd: {e}")))?;
        let mut frame = Vec::new();
        d.read_to_end(&mut frame).map_err(|e| Kv3Error(format!("zstd: {e}")))?;
        out.push(frame);
    }
    Ok(out)
}

/// A buffer packed as one zstd frame.
pub fn zstd_pack(src: &[u8]) -> Vec<u8> {
    ruzstd::encoding::compress_to_vec(src, ruzstd::encoding::CompressionLevel::Fastest)
}

/// A version 4 block's zstd part at `p` (`cmp` bytes): the buffer, `unc` bytes, and the blobs.
pub(super) fn before_v5(block: &[u8], p: &mut usize, cmp: i64, unc: i64) -> Result<(Vec<u8>, Vec<u8>), Kv3Error> {
    let n = cmp.max(0) as usize;
    let src = block.get(*p..*p + n).ok_or_else(|| Kv3Error("the buffer ran out".into()))?;
    *p += n;
    let mut frames = zstd_frames(src)?.into_iter();
    let raw = frames.next().unwrap_or_default();
    if raw.len() != unc.max(0) as usize {
        return err("a zstd buffer of another size");
    }
    Ok((raw, frames.flatten().collect()))
}

#[cfg(test)]
mod tests {
    /// On the game's own files (MM_TEST_PAK01): a version 4 block packed with zstd, as Sven's
    /// animations are, reads with its blobs and writes back to the same tree.
    #[test]
    fn reads_and_writes_back() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let m = ix.read("models/heroes/sven/sven.vmdl_c").unwrap().unwrap();
        let kv = crate::kv3::read(crate::resource::data(&m, "ANIM", 0).unwrap()).unwrap();
        assert_eq!(kv.blobs.len(), 307);
        assert_eq!(kv.blobs.iter().map(Vec::len).sum::<usize>(), 1006490);
        let again = crate::kv3::read(&crate::kv3::write(&kv).unwrap()).unwrap();
        // the values the same; a typed array comes back as a plain one, so the types are left out
        fn values(v: &serde_json::Value) -> serde_json::Value {
            match v {
                serde_json::Value::Object(m) => serde_json::Value::Object(
                    m.iter()
                        .filter(|(k, _)| !matches!(k.as_str(), "type" | "element" | "cell" | "typeAt"))
                        .map(|(k, x)| (k.clone(), values(x)))
                        .collect(),
                ),
                serde_json::Value::Array(a) => serde_json::Value::Array(a.iter().map(values).collect()),
                x => x.clone(),
            }
        }
        fn first(a: &serde_json::Value, b: &serde_json::Value, at: String) -> Option<String> {
            match (a, b) {
                (serde_json::Value::Object(p), serde_json::Value::Object(q)) => p
                    .iter()
                    .find_map(|(k, v)| first(v, q.get(k).unwrap_or(&serde_json::Value::Null), format!("{at}.{k}")))
                    .or_else(|| (p.len() != q.len()).then(|| format!("{at}: keys"))),
                (serde_json::Value::Array(p), serde_json::Value::Array(q)) => p
                    .iter()
                    .enumerate()
                    .find_map(|(i, v)| first(v, q.get(i).unwrap_or(&serde_json::Value::Null), format!("{at}[{i}]")))
                    .or_else(|| (p.len() != q.len()).then(|| format!("{at}: len {} vs {}", p.len(), q.len()))),
                _ => (a != b).then(|| format!("{at}: {a} vs {b}")),
            }
        }
        let diff = first(&values(&again.tree()), &values(&kv.tree()), String::new());
        assert!(diff.is_none(), "{diff:?}");
        assert_eq!(again.blobs, kv.blobs);
        let mut kv = kv;
        assert!(kv.encode().is_err());
    }
}
