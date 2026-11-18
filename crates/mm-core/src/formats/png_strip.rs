//! A cube map's six faces as one strip, for the 3D preview's hero shader (src/png-strip.ts), which
//! reads a cube from a row of six square faces (vendor/dota-loadout/src/viewer.js cubeOf).
//! ValveResourceFormat writes a cube texture as six PNGs, name_rt, _lf, _bk, _ft, _up and _dn: the
//! cube's faces in their order, +X, -X, +Y, -Y, +Z, -Z in the game's axes. Without them a metal
//! the game shows by its cube map (Razor's Severing Crest, Terrorblade's blades) came out black.
//!
//! A codec for what the toolchain writes: 8-bit, not interlaced, grey, grey with alpha, RGB or RGBA.

use std::io::{Read, Write};

/// The faces' suffixes, in the order the strip lays them out.
pub const CUBE_FACES: [&str; 6] = ["rt", "lf", "bk", "ft", "up", "dn"];

const SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Pixels as RGBA.
#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// A PNG's pixels as RGBA, or None for one this does not read.
pub fn decode_png(png: &[u8]) -> Option<Image> {
    if png.len() < 33 || png[..8] != SIGNATURE {
        return None;
    }
    let (mut at, mut width, mut height, mut ty, mut depth, mut interlace) = (8usize, 0u32, 0u32, -1i32, 0u8, 0u8);
    let mut data = Vec::new();
    while at + 8 <= png.len() {
        let length = be32(png, at)? as usize;
        let kind = &png[at + 4..at + 8];
        let body = &png[(at + 8).min(png.len())..(at + 8 + length).min(png.len())];
        match kind {
            b"IHDR" => {
                width = be32(body, 0)?;
                height = be32(body, 4)?;
                depth = *body.get(8)?;
                ty = *body.get(9)? as i32;
                interlace = *body.get(12)?;
            }
            b"IDAT" => data.extend_from_slice(body),
            b"IEND" => break,
            _ => {}
        }
        at += 12 + length;
    }
    let channels = match ty {
        0 => 1,
        2 => 3,
        4 => 2,
        6 => 4,
        _ => return None,
    };
    if depth != 8 || interlace != 0 || width == 0 || height == 0 {
        return None;
    }
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(&data[..]).read_to_end(&mut raw).ok()?;
    let (w, h) = (width as usize, height as usize);
    let stride = w * channels;
    let mut px = vec![0u8; stride * h];
    for y in 0..h {
        let row = y * (stride + 1);
        let filter = raw.get(row).copied().unwrap_or(0);
        for x in 0..stride {
            let left = if x >= channels { px[y * stride + x - channels] as i32 } else { 0 };
            let up = if y > 0 { px[(y - 1) * stride + x] as i32 } else { 0 };
            let corner = if y > 0 && x >= channels { px[(y - 1) * stride + x - channels] as i32 } else { 0 };
            // past the end of a short stream the byte is undefined in JS, and every sum with it 0
            let Some(&byte) = raw.get(row + 1 + x) else {
                px[y * stride + x] = 0;
                continue;
            };
            let mut v = byte as i32;
            match filter {
                1 => v += left,
                2 => v += up,
                3 => v += (left + up) >> 1,
                4 => {
                    let p = left + up - corner;
                    let (pa, pb, pc) = ((p - left).abs(), (p - up).abs(), (p - corner).abs());
                    v += if pa <= pb && pa <= pc {
                        left
                    } else if pb <= pc {
                        up
                    } else {
                        corner
                    };
                }
                _ => {}
            }
            px[y * stride + x] = (v & 255) as u8;
        }
    }
    let mut rgba = vec![0u8; w * h * 4];
    for i in 0..w * h {
        let s = i * channels;
        let (r, g, b) = if channels >= 3 { (px[s], px[s + 1], px[s + 2]) } else { (px[s], px[s], px[s]) };
        rgba[i * 4..i * 4 + 3].copy_from_slice(&[r, g, b]);
        rgba[i * 4 + 3] = match channels {
            4 => px[s + 3],
            2 => px[s + 1],
            _ => 255,
        };
    }
    Some(Image { width, height, rgba })
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    let mut h = crc32fast::Hasher::new();
    h.update(kind);
    h.update(body);
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    out.extend_from_slice(&h.finalize().to_be_bytes());
}

/// RGBA pixels as a PNG.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    let row = width as usize * 4;
    let mut raw = vec![0u8; (row + 1) * height as usize];
    for y in 0..height as usize {
        let src = rgba.get(y * row..(y + 1) * row).unwrap_or(&[]);
        raw[y * (row + 1) + 1..y * (row + 1) + 1 + src.len()].copy_from_slice(src);
    }
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    let _ = z.write_all(&raw);
    let idat = z.finish().unwrap_or_default();
    let mut out = SIGNATURE.to_vec();
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &idat);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// Six square faces of one size, in CUBE_FACES order, as one strip; None where they are not that.
pub fn cube_strip(faces: &[Vec<u8>]) -> Option<Vec<u8>> {
    if faces.len() != 6 {
        return None;
    }
    let decoded: Vec<Option<Image>> = faces.iter().map(|f| decode_png(f)).collect();
    let size = decoded[0].as_ref()?.width;
    if decoded.iter().any(|f| f.as_ref().is_none_or(|f| f.width != size || f.height != size)) {
        return None;
    }
    let s = size as usize;
    let mut strip = vec![0u8; s * 6 * s * 4];
    for (i, face) in decoded.iter().flatten().enumerate() {
        for y in 0..s {
            let to = (y * s * 6 + i * s) * 4;
            strip[to..to + s * 4].copy_from_slice(&face.rgba[y * s * 4..(y + 1) * s * 4]);
        }
    }
    Some(encode_png(size * 6, size, &strip))
}
