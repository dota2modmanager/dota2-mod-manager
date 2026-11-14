//! meshoptimizer's vertex buffer decoder, format versions 0 and 1 (header 0xa0, 0xa1): what the
//! TypeScript reads through the `meshoptimizer` package's MeshoptDecoder.decodeVertexBuffer (MIT,
//! Arseny Kapoulkine), and what Valve compresses a model's vertex buffers with. Decoding has one
//! answer for given bytes, so this gives the bytes that one gives.
//!
//! After the header byte come blocks of up to 256 vertices. In a block each 4-byte channel of a
//! vertex is stored as four byte lanes of deltas from the vertex before, each lane packed in groups
//! of 16 values at a few bits each, an escape value calling for a whole byte after the group.
//! Version 1 adds a control byte per channel (a lane can be literal or zero, and picks its widths
//! from 0-4 or 1-8 bits) and a channel mode in the tail: byte deltas, 2-byte deltas, or a 4-byte xor
//! with a rotate. The tail holds the first block's baseline vertex, then the channel modes.

const BYTE_GROUP: usize = 16;
const GROUP_DECODE_LIMIT: usize = 24;
const BITS_V0: [u8; 4] = [0, 2, 4, 8];
const BITS_V1: [u8; 5] = [0, 1, 2, 4, 8];

fn block_size(vertex_size: usize) -> usize {
    ((8192 / vertex_size) & !(BYTE_GROUP - 1)).min(256)
}

fn malformed<T>() -> Result<T, String> {
    Err("meshopt: malformed vertex buffer data".into())
}

/// One group of 16 values at `bits` bits each; returns where the data after it starts.
fn decode_group(data: &[u8], at: usize, out: &mut [u8], bits: u8) -> Result<usize, String> {
    match bits {
        0 => {
            out.fill(0);
            Ok(at)
        }
        8 => {
            out.copy_from_slice(data.get(at..at + 16).ok_or("meshopt: malformed vertex buffer data")?);
            Ok(at + 16)
        }
        width => {
            let width = width as usize;
            let per = 8 / width;
            let sentinel = ((1u16 << width) - 1) as u8;
            let mut var = at + 16 / per;
            for (i, o) in out.iter_mut().enumerate() {
                let byte = data[at + i / per];
                // one bit goes low to high, wider ones high to low
                let shift = if width == 1 { i % 8 } else { 8 - width * (i % per + 1) };
                let enc = (byte >> shift) & sentinel;
                if enc == sentinel {
                    *o = *data.get(var).ok_or("meshopt: malformed vertex buffer data")?;
                    var += 1;
                } else {
                    *o = enc;
                }
            }
            Ok(var)
        }
    }
}

/// One byte lane of a block: a 2-bit width choice per group in a header, then the groups. `end`
/// is the end of the whole buffer, the tail counting as room for a group's reads.
fn decode_bytes(data: &[u8], mut at: usize, end: usize, out: &mut [u8], bits: &[u8]) -> Result<usize, String> {
    let groups = out.len() / BYTE_GROUP;
    let header_size = groups.div_ceil(4);
    if end - at < header_size {
        return malformed();
    }
    let header = at;
    at += header_size;
    for i in 0..groups {
        if end - at < GROUP_DECODE_LIMIT {
            return malformed();
        }
        let pick = (data[header + i / 4] >> ((i % 4) * 2)) & 3;
        at = decode_group(data, at, &mut out[i * BYTE_GROUP..(i + 1) * BYTE_GROUP], bits[pick as usize])?;
    }
    Ok(at)
}

fn unzigzag8(v: u8) -> u8 {
    (v >> 1) ^ (v & 1).wrapping_neg()
}

fn unzigzag16(v: u16) -> u16 {
    (v >> 1) ^ (v & 1).wrapping_neg()
}

/// One block of `n` vertices: rows of `size` bytes put in `out`, `last` the vertex before it.
#[allow(clippy::too_many_arguments)]
fn decode_block(
    data: &[u8],
    mut at: usize,
    n: usize,
    size: usize,
    last: &mut [u8],
    channels: &[u8],
    version: u8,
    out: &mut [u8],
) -> Result<usize, String> {
    let aligned = n.div_ceil(BYTE_GROUP) * BYTE_GROUP;
    let end = data.len();
    let control_size = if version == 0 { 0 } else { size / 4 };
    if end - at < control_size {
        return malformed();
    }
    let control = at;
    at += control_size;
    let mut lanes = vec![vec![0u8; aligned]; 4];
    for k in (0..size).step_by(4) {
        let ctrl_byte = if version == 0 { 0 } else { data[control + k / 4] };
        for (j, lane) in lanes.iter_mut().enumerate() {
            match (ctrl_byte >> (j * 2)) & 3 {
                3 => {
                    // the values as they are
                    if end - at < n {
                        return malformed();
                    }
                    lane[..n].copy_from_slice(&data[at..at + n]);
                    at += n;
                }
                2 => lane.fill(0),
                ctrl => {
                    let bits: &[u8] = if version == 0 { &BITS_V0 } else { &BITS_V1[ctrl as usize..] };
                    at = decode_bytes(data, at, end, lane, bits)?;
                }
            }
        }
        let channel = if version == 0 { 0 } else { channels[k / 4] };
        let base = &mut last[k..k + 4];
        match channel & 3 {
            0 => {
                for j in 0..4 {
                    let mut p = base[j];
                    for i in 0..n {
                        p = unzigzag8(lanes[j][i]).wrapping_add(p);
                        out[i * size + k + j] = p;
                    }
                    base[j] = p;
                }
            }
            1 => {
                for half in [0usize, 2] {
                    let mut p = u16::from_le_bytes([base[half], base[half + 1]]);
                    for i in 0..n {
                        let v = u16::from_le_bytes([lanes[half][i], lanes[half + 1][i]]);
                        p = unzigzag16(v).wrapping_add(p);
                        out[i * size + k + half..i * size + k + half + 2].copy_from_slice(&p.to_le_bytes());
                    }
                    base[half..half + 2].copy_from_slice(&p.to_le_bytes());
                }
            }
            2 => {
                let rot = (32 - (channel >> 4) as u32) & 31;
                let mut p = u32::from_le_bytes([base[0], base[1], base[2], base[3]]);
                for i in 0..n {
                    let v = u32::from_le_bytes([lanes[0][i], lanes[1][i], lanes[2][i], lanes[3][i]]);
                    p ^= v.rotate_left(rot);
                    out[i * size + k..i * size + k + 4].copy_from_slice(&p.to_le_bytes());
                }
                base.copy_from_slice(&p.to_le_bytes());
            }
            _ => return Err("meshopt: an unknown channel mode".into()),
        }
    }
    Ok(at)
}

/// `count` vertices of `size` bytes each out of `buffer`.
pub fn decode_vertex_buffer(count: usize, size: usize, buffer: &[u8]) -> Result<Vec<u8>, String> {
    if size == 0 || size > 256 || !size.is_multiple_of(4) {
        return Err(format!("meshopt: a vertex of {size} bytes"));
    }
    let Some(&header) = buffer.first() else { return malformed() };
    if header & 0xf0 != 0xa0 || header & 0x0f > 1 {
        return Err(format!("meshopt: not a vertex buffer meshoptimizer reads (header {header:#x})"));
    }
    let version = header & 0x0f;
    let tail = size + if version == 0 { 0 } else { size / 4 };
    let tail_pad = tail.max(if version == 0 { 32 } else { 24 });
    if buffer.len() < 1 + tail_pad {
        return malformed();
    }
    // the tail is padded in front: the baseline vertex and the channel modes end the buffer
    let at_tail = buffer.len() - tail;
    let mut last = buffer[at_tail..at_tail + size].to_vec();
    let channels = &buffer[at_tail + size..];
    let mut out = vec![0u8; count * size];
    let per_block = block_size(size);
    let mut at = 1;
    let mut first = 0;
    while first < count {
        let n = per_block.min(count - first);
        at = decode_block(
            buffer,
            at,
            n,
            size,
            &mut last,
            channels,
            version,
            &mut out[first * size..(first + n) * size],
        )?;
        first += n;
    }
    if buffer.len() - at != tail_pad {
        return malformed();
    }
    Ok(out)
}

// ---------- encoding, version 0 ----------
//
// What MeshoptEncoder.encodeVertexBufferLevel(data, count, size, level, 0) writes: version 0 has no
// channel modes and no control bytes, so the level does not change the bytes. Each byte lane of a
// block is the zigzagged deltas from the vertex before, padded to a whole group, and each group
// takes the smallest of 0, 2, 4 or 8 bits (on a tie the width the group before took), its escapes
// after it. Written after meshoptimizer's vertexcodec.cpp (MIT, Arseny Kapoulkine).

fn zigzag8(v: u8) -> u8 {
    (((v as i8) >> 7) as u8) ^ (v << 1)
}

/// How many bytes a group takes at `bits` bits; None where it cannot (0 bits for a group not all zero).
fn group_measure(group: &[u8], bits: u8) -> Option<usize> {
    match bits {
        0 => group.iter().all(|&b| b == 0).then_some(0),
        8 => Some(BYTE_GROUP),
        _ => {
            let sentinel = (1u8 << bits) - 1;
            Some(BYTE_GROUP * bits as usize / 8 + group.iter().filter(|&&b| b >= sentinel).count())
        }
    }
}

fn encode_group(out: &mut Vec<u8>, group: &[u8], bits: u8) {
    match bits {
        0 => {}
        8 => out.extend_from_slice(group),
        _ => {
            let per_byte = 8 / bits as usize;
            let sentinel = (1u8 << bits) - 1;
            for chunk in group.chunks(per_byte) {
                let mut byte = 0u8;
                for &v in chunk {
                    byte = (byte << bits) | v.min(sentinel);
                }
                out.push(byte);
            }
            out.extend(group.iter().copied().filter(|&v| v >= sentinel));
        }
    }
}

fn encode_bytes(out: &mut Vec<u8>, buffer: &[u8]) {
    let header_at = out.len();
    out.resize(header_at + (buffer.len() / BYTE_GROUP).div_ceil(4), 0);
    let mut last_bits = None;
    for (g, group) in buffer.chunks(BYTE_GROUP).enumerate() {
        let mut best = 3;
        let mut best_size = group_measure(group, BITS_V0[3]).unwrap_or(usize::MAX);
        for (k, &bits) in BITS_V0.iter().enumerate().take(3) {
            let Some(size) = group_measure(group, bits) else { continue };
            // a tie keeps the width the group before took, but never replaces whole bytes
            if size < best_size || (size == best_size && last_bits == Some(bits) && BITS_V0[best] != 8) {
                best = k;
                best_size = size;
            }
        }
        out[header_at + g / 4] |= (best as u8) << ((g % 4) * 2);
        encode_group(out, group, BITS_V0[best]);
        last_bits = Some(BITS_V0[best]);
    }
}

/// `count` vertices of `size` bytes each, encoded as meshoptimizer's version 0.
pub fn encode_vertex_buffer_v0(data: &[u8], count: usize, size: usize) -> Result<Vec<u8>, String> {
    if size == 0 || size > 256 || !size.is_multiple_of(4) {
        return Err(format!("meshopt: a vertex of {size} bytes"));
    }
    let mut out = vec![0xa0];
    let first = data.get(..size).map(<[u8]>::to_vec).unwrap_or_else(|| vec![0; size]);
    let mut last = first.clone();
    let per_block = block_size(size);
    let mut buffer = [0u8; 256];
    let mut at = 0;
    while at < count {
        let n = per_block.min(count - at);
        let aligned = n.div_ceil(BYTE_GROUP) * BYTE_GROUP;
        let block = &data[at * size..(at + n) * size];
        for (k, lane) in last.iter_mut().enumerate() {
            let mut p = *lane;
            for i in 0..n {
                let v = block[i * size + k];
                buffer[i] = zigzag8(v.wrapping_sub(p));
                p = v;
            }
            // the group is filled out with zeros, as meshoptimizer 1.x does
            buffer[n..aligned].fill(0);
            encode_bytes(&mut out, &buffer[..aligned]);
        }
        last.copy_from_slice(&block[(n - 1) * size..]);
        at += n;
    }
    out.resize(out.len() + 32usize.saturating_sub(size), 0);
    out.extend_from_slice(&first);
    Ok(out)
}
