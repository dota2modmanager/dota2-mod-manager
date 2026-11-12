//! LZ4 block format, replacing src/lz4.ts: literals and back-references, the compression Valve's
//! KV3 writer uses (kv3.rs). Decoding is the whole format; encoding writes literals only, which any
//! decoder reads and which is all a rewritten block needs.

use crate::kv3::Kv3Error;

/// One LZ4 block of exactly `size` bytes.
pub fn decode(src: &[u8], size: usize) -> Result<Vec<u8>, Kv3Error> {
    let mut out = vec![0u8; size];
    let n = decode_into(src, &mut out, 0, size)?;
    if n != size {
        return Err(Kv3Error(format!("LZ4 gave {n} bytes, expected {size}")));
    }
    Ok(out)
}

/// One LZ4 block decoded into `out` at `start`, at most `max` bytes. A reference may reach back
/// past `start` into what is already there: that is how the frames of a KV3 file's binary blobs
/// are chained. Returns how many bytes it gave.
pub fn decode_into(src: &[u8], out: &mut [u8], start: usize, max: usize) -> Result<usize, Kv3Error> {
    let bad = |m: &str| Kv3Error(m.to_string());
    let mut i = 0usize;
    let mut o = start;
    let end = start + max;
    let byte = |i: usize| src.get(i).copied().ok_or_else(|| bad("LZ4 ran past its input"));
    let len = |i: &mut usize, mut n: usize| -> Result<usize, Kv3Error> {
        loop {
            let b = byte(*i)?;
            *i += 1;
            n += b as usize;
            if b != 255 {
                return Ok(n);
            }
        }
    };
    while i < src.len() {
        let token = src[i];
        i += 1;
        let mut lit = (token >> 4) as usize;
        if lit == 15 {
            lit = len(&mut i, lit)?;
        }
        if o + lit > end || o + lit > out.len() {
            return Err(bad("LZ4 ran past the output"));
        }
        let from = src.get(i..i + lit).ok_or_else(|| bad("LZ4 ran past its input"))?;
        out[o..o + lit].copy_from_slice(from);
        i += lit;
        o += lit;
        if i >= src.len() {
            break;
        }
        let back = byte(i)? as usize | (byte(i + 1)? as usize) << 8;
        i += 2;
        let mut m = (token & 15) as usize;
        if m == 15 {
            m = len(&mut i, m)?;
        }
        m += 4;
        if back == 0 || back > o {
            return Err(bad("LZ4 reference outside the output"));
        }
        if o + m > end || o + m > out.len() {
            return Err(bad("LZ4 ran past the output"));
        }
        for f in (o - back..).take(m) {
            out[o] = out[f];
            o += 1;
        }
    }
    Ok(o - start)
}

/// The same bytes as one LZ4 block of literals only: valid LZ4, a little larger than the input.
pub fn literals(src: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len() + src.len() / 255 + 2);
    if src.len() >= 15 {
        out.push(0xf0);
        let mut rest = src.len() - 15;
        while rest >= 255 {
            out.push(255);
            rest -= 255;
        }
        out.push(rest as u8);
    } else {
        out.push((src.len() as u8) << 4);
    }
    out.extend_from_slice(src);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals_decode_back_and_a_reference_repeats() {
        for n in [0usize, 3, 14, 15, 16, 300, 70000] {
            let src: Vec<u8> = (0..n).map(|i| (i * 7) as u8).collect();
            assert_eq!(decode(&literals(&src), n).unwrap(), src);
        }
        // "ab" then a match of 6 one back... token: 2 literals, match 6-4=2
        let block = [0x22, b'a', b'b', 2, 0];
        assert_eq!(decode(&block, 8).unwrap(), b"abababab");
        assert!(decode(&[0x10, b'a', 5, 0], 5).is_err());
    }
}
