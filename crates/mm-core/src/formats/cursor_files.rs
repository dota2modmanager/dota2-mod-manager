//! The files Dota's cursors are made of, in game\dota\resource\cursor: no compiler, no pak.
//!
//! Each cursor ("cursor_default", "cursor_spell_enemy"...) is a `.ani` (a RIFF ACON with one
//! 32x32 frame, the hotspot in its icon entry), a `.bmp` of 32x32, or four `_vsz0..3.bmp` of 32,
//! 48, 72 and 96 for the cursor sizes in the game's settings. The BMPs are 32-bit BGRA bottom-up
//! with straight alpha. Their hotspots are in `cursor.res`, by the BMP's name without the extension,
//! or by the cursor's own name for every size at once.

use std::collections::BTreeMap;

/// The pixel sizes of `_vsz0` to `_vsz3`.
pub const VSZ: [u32; 4] = [32, 48, 72, 96];

/// RGBA, top row first, as a 32-bit BMP the way Valve's are written.
pub fn bmp_from_rgba(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let image = (w * h * 4) as usize;
    let mut out = Vec::with_capacity(54 + image);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(54 + image as u32).to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&info_header(w, h, image as u32));
    out.extend_from_slice(&bgra_bottom_up(rgba, w, h));
    out
}

fn info_header(w: u32, h: u32, image: u32) -> [u8; 40] {
    let mut b = [0u8; 40];
    b[0..4].copy_from_slice(&40u32.to_le_bytes());
    b[4..8].copy_from_slice(&(w as i32).to_le_bytes());
    b[8..12].copy_from_slice(&(h as i32).to_le_bytes());
    b[12..14].copy_from_slice(&1u16.to_le_bytes());
    b[14..16].copy_from_slice(&32u16.to_le_bytes());
    b[20..24].copy_from_slice(&image.to_le_bytes());
    b[24..28].copy_from_slice(&2835u32.to_le_bytes());
    b[28..32].copy_from_slice(&2835u32.to_le_bytes());
    b
}

fn bgra_bottom_up(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let row = (w * 4) as usize;
    let mut out = Vec::with_capacity(row * h as usize);
    for y in (0..h as usize).rev() {
        for p in rgba[y * row..(y + 1) * row].as_chunks::<4>().0 {
            out.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
        }
    }
    out
}

fn u32_at(d: &[u8], at: usize) -> Option<u32> {
    d.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn u16_at(d: &[u8], at: usize) -> Option<u16> {
    d.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

/// A 32-bit (or 24-bit) uncompressed BMP back to RGBA, top row first, with its size.
pub fn rgba_from_bmp(d: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    if d.get(0..2) != Some(b"BM") {
        return Err("not a BMP".into());
    }
    let off = u32_at(d, 10).ok_or("short BMP")? as usize;
    let dib = &d[14..];
    let (w, h) = (u32_at(dib, 4).ok_or("short BMP")? as i32, u32_at(dib, 8).ok_or("short BMP")? as i32);
    let bpp = u16_at(dib, 14).ok_or("short BMP")?;
    let comp = u32_at(dib, 16).ok_or("short BMP")?;
    if w <= 0 || h == 0 || w > 4096 || h.abs() > 4096 || !(comp == 0 || comp == 3) || !(bpp == 32 || bpp == 24) {
        return Err(format!("a BMP this app cannot read ({w}x{h}, {bpp} bits, compression {comp})"));
    }
    let (w, top_down, h) = (w as u32, h < 0, h.unsigned_abs());
    let px = (bpp / 8) as usize;
    let stride = (w as usize * px).div_ceil(4) * 4;
    let mut out = vec![0u8; (w * h * 4) as usize];
    let mut any_alpha = false;
    for y in 0..h as usize {
        let src_y = if top_down { y } else { h as usize - 1 - y };
        let row = d.get(off + src_y * stride..off + src_y * stride + w as usize * px).ok_or("short BMP")?;
        for x in 0..w as usize {
            let p = &row[x * px..x * px + px];
            let a = if px == 4 { p[3] } else { 255 };
            any_alpha |= a != 0;
            out[(y * w as usize + x) * 4..][..4].copy_from_slice(&[p[2], p[1], p[0], a]);
        }
    }
    // a 32-bit BMP with nothing in its alpha byte is an opaque picture
    if !any_alpha {
        out.as_chunks_mut::<4>().0.iter_mut().for_each(|p| p[3] = 255);
    }
    Ok((out, w, h))
}

/// One frame, as a .cur: the icon directory, the DIB with its doubled height, and the AND mask.
fn cur(rgba: &[u8], size: u32, hot: (u32, u32)) -> Vec<u8> {
    let image = size * size * 4;
    let mask_row = size.div_ceil(32) * 4;
    let mask = mask_row * size;
    let dib_len = 40 + image + mask;
    let mut out = Vec::with_capacity(22 + dib_len as usize);
    out.extend_from_slice(&[0, 0, 2, 0, 1, 0]);
    out.push(if size >= 256 { 0 } else { size as u8 });
    out.push(if size >= 256 { 0 } else { size as u8 });
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&(hot.0.min(size - 1) as u16).to_le_bytes());
    out.extend_from_slice(&(hot.1.min(size - 1) as u16).to_le_bytes());
    out.extend_from_slice(&dib_len.to_le_bytes());
    out.extend_from_slice(&22u32.to_le_bytes());
    let mut header = info_header(size, size * 2, image + mask);
    header[24..32].fill(0);
    out.extend_from_slice(&header);
    out.extend_from_slice(&bgra_bottom_up(rgba, size, size));
    // the AND mask: a set bit is see-through, bottom row first
    for y in (0..size as usize).rev() {
        let mut row = vec![0u8; mask_row as usize];
        for x in 0..size as usize {
            if rgba[(y * size as usize + x) * 4 + 3] == 0 {
                row[x / 8] |= 0x80 >> (x % 8);
            }
        }
        out.extend_from_slice(&row);
    }
    out
}

fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + body.len() + 1);
    out.extend_from_slice(id);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    if body.len() % 2 == 1 {
        out.push(0);
    }
    out
}

/// A one-frame animated cursor as Valve writes theirs: RIFF ACON, anih, LIST fram, one icon.
pub fn ani_from_rgba(rgba: &[u8], size: u32, hot: (u32, u32)) -> Vec<u8> {
    let anih: Vec<u8> = [36u32, 1, 1, 0, 0, 0, 0, 10, 1].iter().flat_map(|v| v.to_le_bytes()).collect();
    let mut fram = b"fram".to_vec();
    fram.extend(chunk(b"icon", &cur(rgba, size, hot)));
    let mut body = b"ACON".to_vec();
    body.extend(chunk(b"anih", &anih));
    body.extend(chunk(b"LIST", &fram));
    chunk(b"RIFF", &body)
}

/// The hotspot of an .ani's first frame, as its icon entry gives it.
pub fn ani_hotspot(d: &[u8]) -> Option<(u32, u32)> {
    let at = memchr::memmem::find(d, b"icon")?;
    let ico = d.get(at + 8..)?;
    (u16_at(ico, 2)? == 2).then_some((u16_at(ico, 10)? as u32, u16_at(ico, 12)? as u32))
}

/// cursor.res: every block with a hotx and a hoty, by name, in the file's order of names.
pub fn parse_res(text: &str) -> BTreeMap<String, (u32, u32)> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r#"(?s)"?([A-Za-z0-9_]+)"?\s*\{\s*"hotx"\s*"(-?\d+)"\s*"hoty"\s*"(-?\d+)"\s*\}"#).unwrap()
    });
    re.captures_iter(text)
        .filter_map(|c| {
            Some((c[1].to_string(), (c[2].parse::<i64>().ok()?.max(0) as u32, c[3].parse::<i64>().ok()?.max(0) as u32)))
        })
        .collect()
}

/// cursor.res written back, the names sorted.
pub fn write_res(spots: &BTreeMap<String, (u32, u32)>) -> String {
    let mut out = String::from(
        "// This file is only needed when using SDL, since it opens the cursors\n// as BMP files instead of loading .ani files.\n\"resource/cursor/cursor.res\"\n{\n",
    );
    for (name, (x, y)) in spots {
        out.push_str(&format!("\t{name}\n\t{{\n\t\t\"hotx\"\t\t\"{x}\"\n\t\t\"hoty\"\t\t\"{y}\"\n\t}}\n\n"));
    }
    out.push_str("}\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(size: u32) -> Vec<u8> {
        (0..size * size)
            .flat_map(|i| [(i % 251) as u8, (i % 13) as u8, 200, if i % 3 == 0 { 0 } else { 255 }])
            .collect()
    }

    #[test]
    fn a_bmp_reads_back_what_was_written() {
        let px = picture(48);
        let bmp = bmp_from_rgba(&px, 48, 48);
        assert_eq!(bmp.len(), 54 + 48 * 48 * 4);
        let (back, w, h) = rgba_from_bmp(&bmp).unwrap();
        assert_eq!((w, h), (48, 48));
        assert_eq!(back, px);
    }

    #[test]
    fn the_bmp_is_bottom_up_bgra() {
        let mut px = vec![0u8; 2 * 2 * 4];
        px[0..4].copy_from_slice(&[10, 20, 30, 40]); // top left
        let bmp = bmp_from_rgba(&px, 2, 2);
        // the top row is written last: its first pixel is at the start of the second row
        assert_eq!(&bmp[54 + 8..54 + 12], &[30, 20, 10, 40]);
    }

    #[test]
    fn an_ani_carries_one_frame_and_its_hotspot() {
        let px = picture(32);
        let ani = ani_from_rgba(&px, 32, (16, 15));
        assert_eq!(&ani[0..4], b"RIFF");
        assert_eq!(&ani[8..12], b"ACON");
        assert_eq!(u32::from_le_bytes(ani[4..8].try_into().unwrap()) as usize, ani.len() - 8);
        // Valve's own one-frame cursors are 4362 bytes: the same layout
        assert_eq!(ani.len(), 4362);
        assert_eq!(ani_hotspot(&ani), Some((16, 15)));
    }

    #[test]
    fn cursor_res_parses_and_writes_back() {
        let text = "\"resource/cursor/cursor.res\"\n{\n\tcursor_buy\n\t{\n\t\t\"hotx\"\t\t\"14\"\n\t\t\"hoty\"\t\t\"14\"\n\t}\n\n\tcursor_spell_default_vsz3\n\t{\n\t\t\"hotx\" \"48\"\n\t\t\"hoty\" \"48\"\n\t}\t\n}\n";
        let spots = parse_res(text);
        assert_eq!(spots.get("cursor_buy"), Some(&(14, 14)));
        assert_eq!(spots.get("cursor_spell_default_vsz3"), Some(&(48, 48)));
        assert_eq!(parse_res(&write_res(&spots)), spots);
    }
}
