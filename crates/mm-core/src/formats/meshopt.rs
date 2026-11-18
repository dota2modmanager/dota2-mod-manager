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

/// meshoptimizer's index buffer encoder, version 1 (header 0xe1), as `encodeIndexBuffer` of the
/// `meshoptimizer` package writes it: the map's triangles for the window go out in
/// EXT_meshopt_compression's TRIANGLES mode (map_scene.rs), which three.js's MeshoptDecoder reads.
///
/// Each triangle is a code byte: an edge it shares with one of the last sixteen triangles and a
/// vertex from the last sixteen seen, or the next vertex never seen, or an index written apart as
/// a zigzag varint delta from the last one written. The aux table at the end both decodes the
/// codes that name two vertices and pads the stream for the decoder.
pub fn encode_index_buffer(indices: &[u32]) -> Result<Vec<u8>, String> {
    const AUX: [u8; 16] = [0x00, 0x76, 0x87, 0x56, 0x67, 0x78, 0xa9, 0x86, 0x65, 0x89, 0x68, 0x98, 0x01, 0x69, 0, 0];
    const ORDER: [[usize; 3]; 3] = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
    const FEC_MAX: i32 = 13;
    if !indices.len().is_multiple_of(3) {
        return Err(format!("meshopt: {} indices are no whole triangles", indices.len()));
    }
    let mut edges = [[u32::MAX; 2]; 16];
    let mut verts = [u32::MAX; 16];
    let (mut edge_at, mut vert_at) = (0usize, 0usize);
    let (mut next, mut last) = (0u32, 0u32);
    let mut code: Vec<u8> = Vec::with_capacity(indices.len() / 3);
    let mut data: Vec<u8> = Vec::new();

    let get_edge = |e: &[[u32; 2]; 16], at: usize, a: u32, b: u32, c: u32| -> i32 {
        for i in 0..16 {
            let x = e[(at.wrapping_sub(1 + i)) & 15];
            if x == [a, b] {
                return (i << 2) as i32;
            }
            if x == [b, c] {
                return ((i << 2) | 1) as i32;
            }
            if x == [c, a] {
                return ((i << 2) | 2) as i32;
            }
        }
        -1
    };
    let get_vert = |v: &[u32; 16], at: usize, x: u32| -> i32 {
        (0..16).find(|i| v[(at.wrapping_sub(1 + i)) & 15] == x).map_or(-1, |i| i as i32)
    };
    let write_index = |data: &mut Vec<u8>, index: u32, last: u32| {
        let d = index.wrapping_sub(last) as i32;
        let mut v = ((d << 1) ^ (d >> 31)) as u32;
        loop {
            if v < 128 {
                data.push(v as u8);
                break;
            }
            data.push((v & 127) as u8 | 128);
            v >>= 7;
        }
    };

    for t in indices.as_chunks::<3>().0 {
        let fer = get_edge(&edges, edge_at, t[0], t[1], t[2]);
        if fer >= 0 && (fer >> 2) < 15 {
            let o = ORDER[(fer & 3) as usize];
            let (a, b, c) = (t[o[0]], t[o[1]], t[o[2]]);
            let fe = fer >> 2;
            let fc = get_vert(&verts, vert_at, c);
            let mut fec = if (1..FEC_MAX).contains(&fc) {
                fc
            } else if c == next {
                next += 1;
                0
            } else {
                15
            };
            if fec == 15 {
                // strip-like runs: the one before or after the last index written apart
                if c.wrapping_add(1) == last {
                    fec = 13;
                    last = c;
                }
                if c == last.wrapping_add(1) {
                    fec = 14;
                    last = c;
                }
            }
            code.push(((fe << 4) | fec) as u8);
            if fec == 15 {
                write_index(&mut data, c, last);
                last = c;
            }
            if fec == 0 || fec >= FEC_MAX {
                verts[vert_at] = c;
                vert_at = (vert_at + 1) & 15;
            }
            edges[edge_at] = [c, b];
            edge_at = (edge_at + 1) & 15;
            edges[edge_at] = [a, c];
            edge_at = (edge_at + 1) & 15;
        } else {
            let rotation = if t[1] == next {
                1
            } else if t[2] == next {
                2
            } else {
                0
            };
            let o = ORDER[rotation];
            let (a, b, c) = (t[o[0]], t[o[1]], t[o[2]]);
            let mut reset = false;
            if a == 0 && b == 1 && c == 2 && next > 0 {
                reset = true;
                next = 0;
                // the old vertices must not be named again once the count starts over
                verts = [u32::MAX; 16];
            }
            let fb = get_vert(&verts, vert_at, b);
            let fc = get_vert(&verts, vert_at, c);
            let fea = if a == next {
                next += 1;
                0
            } else {
                15
            };
            let feb = if (0..14).contains(&fb) {
                fb + 1
            } else if b == next {
                next += 1;
                0
            } else {
                15
            };
            let fec = if (0..14).contains(&fc) {
                fc + 1
            } else if c == next {
                next += 1;
                0
            } else {
                15
            };
            let aux = ((feb << 4) | fec) as u8;
            let aux_at = AUX.iter().position(|x| *x == aux);
            match aux_at {
                Some(k) if fea == 0 && k < 14 && !reset => code.push(0xf0 | k as u8),
                _ => {
                    code.push(0xf0 | 14 | fea as u8);
                    data.push(aux);
                }
            }
            for (f, v) in [(fea, a), (feb, b), (fec, c)] {
                if f == 15 {
                    write_index(&mut data, v, last);
                    last = v;
                }
            }
            for (f, v) in [(fea, a), (feb, b), (fec, c)] {
                if f == 0 || f == 15 {
                    verts[vert_at] = v;
                    vert_at = (vert_at + 1) & 15;
                }
            }
            for e in [[b, a], [c, b], [a, c]] {
                edges[edge_at] = e;
                edge_at = (edge_at + 1) & 15;
            }
        }
    }
    let mut out = Vec::with_capacity(1 + code.len() + data.len() + 16);
    out.push(0xe1);
    out.extend_from_slice(&code);
    out.extend_from_slice(&data);
    out.extend_from_slice(&AUX);
    Ok(out)
}

#[cfg(test)]
mod index_tests {
    /// The bytes the `meshoptimizer` package's encodeIndexBuffer gives for the same triangles.
    #[test]
    fn triangles_come_out_as_meshoptimizer_writes_them() {
        let a = super::encode_index_buffer(&[0, 1, 2, 2, 1, 3, 4, 5, 6, 7, 8, 9, 3, 1, 10, 0, 1, 2]).unwrap();
        assert_eq!(
            a,
            vec![
                225, 240, 16, 240, 240, 112, 254, 0, 0, 118, 135, 86, 103, 120, 169, 134, 101, 137, 104, 152, 1, 105,
                0, 0
            ]
        );
        let b = super::encode_index_buffer(&[5, 9, 2, 2, 9, 100, 70000, 3, 2, 1, 2, 3]).unwrap();
        assert_eq!(
            b,
            vec![
                225, 255, 31, 255, 31, 255, 10, 8, 13, 196, 1, 242, 152, 196, 8, 217, 197, 8, 3, 0, 118, 135, 86, 103,
                120, 169, 134, 101, 137, 104, 152, 1, 105, 0, 0
            ]
        );
        assert!(super::encode_index_buffer(&[1, 2]).is_err());
    }
}
