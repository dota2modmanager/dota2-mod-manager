//! The picture inside a compiled Source 2 texture, when it is already a picture (src/vtex.ts).
//! Most panorama images are compiled with the format left as PNG: the .vtex_c is a small resource
//! header with the untouched PNG appended, and the header's first field is where it starts. A
//! block-compressed texture answers None rather than a guess.

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// The PNG file a .vtex_c carries, or None when it carries pixels instead.
pub fn png_from_vtex(buf: &[u8]) -> Option<&[u8]> {
    if buf.len() < 16 {
        return None;
    }
    let header = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    if header == 0 || header + PNG_SIGNATURE.len() >= buf.len() {
        return None;
    }
    if buf[header..header + PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return None;
    }
    let png = &buf[header..];
    // a tail that does not end on IEND is not a whole file, whatever its first bytes say
    let end = png.windows(4).rposition(|w| w == b"IEND")?;
    (end + 8 == png.len()).then_some(png)
}

// The few panorama images that are not a PNG inside (src/vtex.ts rgbaFromVtex): DXT1 or DXT5 of
// one mip with nothing packed around it, the newest heroes' portraits among them, their colour
// stored as scaled YCoCg. Anything else answers None. The arithmetic is the TypeScript's, in f64
// and in the same order, so both give the same pixels.
const DXT1: u8 = 1;
const DXT5: u8 = 2;
/// uncompressed, blue first: 81 item icons of the game, which went to the decoder one launch each
const BGRA8888: u8 = 28;

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}
fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}
fn round(v: f64) -> u8 {
    // JavaScript's Math.round for the 0..=255 this is used on
    (v + 0.5).floor() as u8
}

fn colour_block(b: &[u8], at: usize, out: &mut [u8; 64], alpha_from_colour: bool) {
    let c0 = u16_at(b, at);
    let c1 = u16_at(b, at + 2);
    let rgb = |c: u16| -> [f64; 3] {
        [((c >> 11) & 31) as f64 * 255.0 / 31.0, ((c >> 5) & 63) as f64 * 255.0 / 63.0, (c & 31) as f64 * 255.0 / 31.0]
    };
    let (p0, p1) = (rgb(c0), rgb(c1));
    let four = !alpha_from_colour || c0 > c1;
    let mix = |f: &dyn Fn(f64, f64) -> f64| [f(p0[0], p1[0]), f(p0[1], p1[1]), f(p0[2], p1[2])];
    let pal = [
        p0,
        p1,
        if four { mix(&|v, w| (2.0 * v + w) / 3.0) } else { mix(&|v, w| (v + w) / 2.0) },
        if four { mix(&|v, w| (v + 2.0 * w) / 3.0) } else { [0.0; 3] },
    ];
    let bits = u32_at(b, at + 4);
    for i in 0..16 {
        let k = ((bits >> (2 * i)) & 3) as usize;
        out[i * 4] = round(pal[k][0]);
        out[i * 4 + 1] = round(pal[k][1]);
        out[i * 4 + 2] = round(pal[k][2]);
        out[i * 4 + 3] = if alpha_from_colour && !four && k == 3 { 0 } else { 255 };
    }
}

fn alpha_block(b: &[u8], at: usize, out: &mut [u8; 64]) {
    let (a0, a1) = (b[at] as f64, b[at + 1] as f64);
    let mut pal = vec![a0, a1];
    if b[at] > b[at + 1] {
        for i in 1..7 {
            pal.push(((7 - i) as f64 * a0 + i as f64 * a1) / 7.0);
        }
    } else {
        for i in 1..5 {
            pal.push(((5 - i) as f64 * a0 + i as f64 * a1) / 5.0);
        }
        pal.push(0.0);
        pal.push(255.0);
    }
    let lo = u32::from_le_bytes([b[at + 2], b[at + 3], b[at + 4], 0]);
    let hi = u32::from_le_bytes([b[at + 5], b[at + 6], b[at + 7], 0]);
    for i in 0..16 {
        let k = if i < 8 { (lo >> (3 * i)) & 7 } else { (hi >> (3 * (i - 8))) & 7 };
        out[i * 4 + 3] = round(pal[k as usize]);
    }
}

fn ycocg(rgba: &mut [u8]) {
    let clamp = |v: f64| {
        if v < 0.0 {
            0
        } else if v > 255.0 {
            255
        } else {
            round(v)
        }
    };
    for px in rgba.as_chunks_mut::<4>().0 {
        let scale = ((px[2] >> 3) + 1) as f64;
        let co = (px[0] as f64 - 128.0) / scale;
        let cg = (px[1] as f64 - 128.0) / scale;
        let y = px[3] as f64;
        px[0] = clamp(y + co - cg);
        px[1] = clamp(y + cg);
        px[2] = clamp(y - co - cg);
        px[3] = 255;
    }
}

/// A DXT1, DXT5 or BGRA8888 texture of one mip as (width, height, RGBA); None for anything else.
pub fn rgba_from_vtex(buf: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if buf.len() < 16 {
        return None;
    }
    let header = u32_at(buf, 0) as usize;
    let blocks_at = 8 + u32_at(buf, 8) as usize;
    let count = u32_at(buf, 12) as usize;
    let mut data = None;
    for i in 0..count {
        let at = blocks_at + i * 12;
        if at + 12 > buf.len() {
            break;
        }
        if &buf[at..at + 4] == b"DATA" {
            data = Some(at + 4 + u32_at(buf, at + 4) as usize);
        }
    }
    let data = data?;
    if data + 28 > buf.len() {
        return None;
    }
    let (width, height, depth) =
        (u16_at(buf, data + 20) as usize, u16_at(buf, data + 22) as usize, u16_at(buf, data + 24));
    let (format, mips) = (buf[data + 26], buf[data + 27]);
    if (format != DXT1 && format != DXT5 && format != BGRA8888) || mips != 1 || depth > 1 || width == 0 || height == 0 {
        return None;
    }
    if format == BGRA8888 {
        let body = buf.get(header..)?;
        if body.len() != width * height * 4 {
            return None;
        }
        let mut rgba = body.to_vec();
        for px in rgba.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        return Some((width as u32, height as u32, rgba));
    }
    let size = if format == DXT1 { 8 } else { 16 };
    let (across, down) = (width.div_ceil(4), height.div_ceil(4));
    if header + across * down * size != buf.len() {
        return None;
    }
    let mut rgba = vec![0u8; width * height * 4];
    let mut block = [0u8; 64];
    for by in 0..down {
        for bx in 0..across {
            let at = header + (by * across + bx) * size;
            colour_block(buf, if format == DXT1 { at } else { at + 8 }, &mut block, format == DXT1);
            if format == DXT5 {
                alpha_block(buf, at, &mut block);
            }
            for y in 0..4 {
                if by * 4 + y >= height {
                    break;
                }
                for x in 0..4 {
                    if bx * 4 + x >= width {
                        break;
                    }
                    let to = ((by * 4 + y) * width + bx * 4 + x) * 4;
                    let from = (y * 4 + x) * 4;
                    rgba[to..to + 4].copy_from_slice(&block[from..from + 4]);
                }
            }
        }
    }
    // the compiler's "Image YCoCg Conversion" step: brightness in alpha, colour scaled into RGB
    if buf[..header.min(buf.len())].windows(10).any(|w| w == b"YCoCg Conv") {
        ycocg(&mut rgba);
    }
    Some((width as u32, height as u32, rgba))
}

/// The picture a .vtex_c carries: its PNG, or a one-mip DXT texture turned into one.
pub fn picture_from_vtex(buf: &[u8]) -> Option<Vec<u8>> {
    if let Some(png) = png_from_vtex(buf) {
        return Some(png.to_vec());
    }
    let (w, h, rgba) = rgba_from_vtex(buf)?;
    let (width, height) = (w as usize, h as usize);
    match fill_size(buf).filter(|&(fw, fh)| fw <= width && fh <= height && (fw, fh) != (width, height)) {
        Some((fw, fh)) => {
            let mut cut = Vec::with_capacity(fw * fh * 4);
            for y in 0..fh {
                cut.extend_from_slice(&rgba[y * width * 4..(y * width + fw) * 4]);
            }
            Some(crate::png_strip::encode_png(fw as u32, fh as u32, &cut))
        }
        None => Some(crate::png_strip::encode_png(w, h, &rgba)),
    }
}

/// The picture's own size when the compiler filled it out to a power of two: the texture's
/// "fill to power of two" extra data (type 3: a u16, then width and height, as Source 2 Viewer
/// reads it). An item icon is 256x170 kept in a 256x256 texture; drawn whole, the 86 rows under
/// the item were a smear of whatever the compressor left there.
fn fill_size(buf: &[u8]) -> Option<(usize, usize)> {
    const FILL_TO_POWER_OF_TWO: u32 = 3;
    if buf.len() < 16 {
        return None;
    }
    let blocks_at = 8 + u32_at(buf, 8) as usize;
    let data = (0..u32_at(buf, 12) as usize).find_map(|i| {
        let at = blocks_at + i * 12;
        (at + 12 <= buf.len() && &buf[at..at + 4] == b"DATA").then(|| at + 4 + u32_at(buf, at + 4) as usize)
    })?;
    if data + 40 > buf.len() {
        return None;
    }
    let first = data + 32 + u32_at(buf, data + 32) as usize;
    for i in 0..u32_at(buf, data + 36).min(16) as usize {
        let e = first + i * 12;
        if e + 12 > buf.len() {
            return None;
        }
        if u32_at(buf, e) != FILL_TO_POWER_OF_TWO {
            continue;
        }
        let at = e + 4 + u32_at(buf, e + 4) as usize;
        if at + 6 > buf.len() {
            return None;
        }
        let (w, h) = (u16_at(buf, at + 2) as usize, u16_at(buf, at + 4) as usize);
        return (w > 0 && h > 0).then_some((w, h));
    }
    None
}

/// A PNG as a data: URL.
pub fn data_url(png: &[u8]) -> String {
    use base64::Engine;
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

#[cfg(test)]
mod tests {
    /// On the game's own files (MM_TEST_PAK01 = a pak01_dir.vpk): an item icon kept in a texture
    /// filled out to 256x256 comes out at the 256x170 the game shows. Skipped without the game.
    #[test]
    fn an_item_icon_is_cut_to_its_own_size() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let paths: Vec<String> = ix
            .paths()
            .filter(|p| p.starts_with("panorama/images/econ/items/") && p.ends_with("_png.vtex_c"))
            .map(String::from)
            .collect();
        let filled = paths
            .iter()
            .filter_map(|p| ix.read(p).ok().flatten())
            .find(|t| {
                super::png_from_vtex(t).is_none()
                    && super::rgba_from_vtex(t).is_some_and(|(w, h, _)| (w, h) == (256, 256))
                    && super::fill_size(t).is_some()
            })
            .expect("an item icon filled out to a power of two");
        let png = super::picture_from_vtex(&filled).unwrap();
        let size =
            (u32::from_be_bytes(png[16..20].try_into().unwrap()), u32::from_be_bytes(png[20..24].try_into().unwrap()));
        assert_eq!(size, (256, 170));
    }

    /// An uncompressed texture stored blue first, as 81 of the game's item icons are, comes out
    /// red first, and one whose size does not add up is not guessed at.
    #[test]
    fn a_bgra_texture_is_read_red_first() {
        let (w, h) = (2usize, 1usize);
        let mut buf = vec![0u8; 64];
        buf[0..4].copy_from_slice(&64u32.to_le_bytes());
        buf[8..12].copy_from_slice(&8u32.to_le_bytes());
        buf[12..16].copy_from_slice(&1u32.to_le_bytes());
        buf[16..20].copy_from_slice(b"DATA");
        buf[20..24].copy_from_slice(&4u32.to_le_bytes());
        let data = 24;
        buf[data + 20..data + 22].copy_from_slice(&(w as u16).to_le_bytes());
        buf[data + 22..data + 24].copy_from_slice(&(h as u16).to_le_bytes());
        buf[data + 24..data + 26].copy_from_slice(&1u16.to_le_bytes());
        buf[data + 26] = super::BGRA8888;
        buf[data + 27] = 1;
        buf.extend_from_slice(&[10, 20, 30, 255, 1, 2, 3, 128]);
        let (gw, gh, rgba) = super::rgba_from_vtex(&buf).expect("a BGRA texture");
        assert_eq!((gw, gh), (2, 1));
        assert_eq!(rgba, vec![30, 20, 10, 255, 3, 2, 1, 128]);
        buf.pop();
        assert!(super::rgba_from_vtex(&buf).is_none());
    }
}
