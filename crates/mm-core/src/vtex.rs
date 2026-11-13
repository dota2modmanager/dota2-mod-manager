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

/// A PNG as a data: URL.
pub fn data_url(png: &[u8]) -> String {
    use base64::Engine;
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}
