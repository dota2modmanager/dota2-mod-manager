//! A picture from the game cut down to the size a tile draws it at.
//!
//! An item icon is 256x170, but the game keeps its loading screens at 1920x1080 and up: a PNG
//! of one to twelve megabytes for a tile 250 pixels wide. A slot of two thousand of them made a
//! cache of 2.3 GB, every batch of twelve sent the window tens of megabytes, and the webview
//! decoded full frames while the list scrolled, which is where pictures came seconds late and
//! the scroll caught. What is kept now is the picture at twice the widest tile, as a JPEG when
//! it has no transparency (a tenth of the PNG) and a PNG when it does.

/// The width a kept picture is cut down to: a tile at two device pixels per pixel.
pub const TILE_WIDTH: u32 = 640;

/// JPEG quality of a cut-down picture with no transparency.
const QUALITY: u8 = 86;

fn width_of(png: &[u8]) -> Option<u32> {
    // the IHDR chunk sits right after the signature: its first field is the width
    (png.len() >= 24 && png.starts_with(b"\x89PNG\r\n\x1a\n") && &png[12..16] == b"IHDR")
        .then(|| u32::from_be_bytes([png[16], png[17], png[18], png[19]]))
}

/// The picture, smaller, when it is wider than `max_w`; None when it already fits or is not a
/// PNG this can read.
pub fn shrink(png: &[u8], max_w: u32) -> Option<Vec<u8>> {
    if width_of(png)? <= max_w {
        return None;
    }
    let (rgba, w, h) = crate::png_paint::decode_rgba(png).ok()?;
    let (dw, dh) = (max_w, ((h as u64 * max_w as u64 + w as u64 / 2) / w as u64).max(1) as u32);
    let small = box_down(&rgba, w, h, dw, dh);
    if small.as_chunks::<4>().0.iter().all(|p| p[3] == 255) {
        let rgb: Vec<u8> = small.as_chunks::<4>().0.iter().flat_map(|p| [p[0], p[1], p[2]]).collect();
        let mut out = Vec::new();
        let enc = jpeg_encoder::Encoder::new(&mut out, QUALITY);
        enc.encode(&rgb, dw as u16, dh as u16, jpeg_encoder::ColorType::Rgb).ok()?;
        return Some(out);
    }
    Some(crate::png_strip::encode_png(dw, dh, &small))
}

/// Each pixel of the smaller picture as the average of the pixels it covers.
fn box_down(rgba: &[u8], w: u32, h: u32, dw: u32, dh: u32) -> Vec<u8> {
    let (w, h, dw, dh) = (w as usize, h as usize, dw as usize, dh as usize);
    let span = |i: usize, n: usize, dn: usize| (i * n / dn, ((i + 1) * n / dn).max(i * n / dn + 1).min(n));
    let mut out = vec![0u8; dw * dh * 4];
    for y in 0..dh {
        let (y0, y1) = span(y, h, dh);
        for x in 0..dw {
            let (x0, x1) = span(x, w, dw);
            let mut sum = [0u64; 4];
            for row in y0..y1 {
                for p in rgba[(row * w + x0) * 4..(row * w + x1) * 4].as_chunks::<4>().0 {
                    for c in 0..4 {
                        sum[c] += p[c] as u64;
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            for c in 0..4 {
                out[(y * dw + x) * 4 + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    out
}

/// The media type of a kept picture, by its first bytes.
pub fn media_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else {
        "image/png"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, alpha: u8) -> Vec<u8> {
        // a gradient, as a picture is: noise is what a JPEG keeps worst
        let rgba: Vec<u8> = (0..w * h).flat_map(|i| [(i % w * 255 / w) as u8, 90, 200, alpha]).collect();
        crate::png_strip::encode_png(w, h, &rgba)
    }

    #[test]
    fn a_loading_screen_comes_down_to_a_tile_as_a_jpeg() {
        let big = png(1920, 1080, 255);
        let small = shrink(&big, TILE_WIDTH).unwrap();
        assert_eq!(media_type(&small), "image/jpeg");
        assert!(small.len() * 5 < big.len(), "{} of {}", small.len(), big.len());
    }

    #[test]
    fn a_picture_with_transparency_stays_a_png_and_keeps_its_shape() {
        let small = shrink(&png(1280, 720, 128), TILE_WIDTH).unwrap();
        assert_eq!(media_type(&small), "image/png");
        let (rgba, w, h) = crate::png_paint::decode_rgba(&small).unwrap();
        assert_eq!((w, h), (640, 360));
        assert!(rgba.as_chunks::<4>().0.iter().all(|p| p[3] == 128 && p[1] == 90 && p[2] == 200));
    }

    #[test]
    fn an_item_icon_is_left_as_it_is() {
        assert!(shrink(&png(256, 170, 255), TILE_WIDTH).is_none());
        assert!(shrink(b"not a picture", TILE_WIDTH).is_none());
    }
}
