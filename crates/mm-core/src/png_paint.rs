//! A picture moved to a colour (src/services.ts electronRepaint): the PNG decoded, its pixels
//! painted by crates/mm-core/src/recolor_modes.rs, and written back as a PNG.

use crate::recolor::Rgb;

/// The PNG's pixels as RGBA, with its width.
pub fn decode_rgba(png: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(png));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("an indexed picture left unexpanded".into()),
    };
    Ok((rgba, info.width, info.height))
}

pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Fits `hero_paint_service::Repaint`.
pub fn repaint(png: &[u8], color: Rgb, mode: &str) -> Result<Vec<u8>, String> {
    let (mut px, w, h) = decode_rgba(png)?;
    crate::recolor_modes::paint_pixels(&mut px, w as usize, color, mode, false);
    encode_rgba(&px, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_size_and_alpha() {
        let px = vec![200, 10, 10, 255, 0, 0, 0, 0];
        let png = encode_rgba(&px, 2, 1).unwrap();
        let (back, w, h) = decode_rgba(&png).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(back, px);
        let out = repaint(&png, [0.0, 0.0, 255.0], "tint").unwrap();
        let (painted, _, _) = decode_rgba(&out).unwrap();
        assert_eq!(painted[7], 0, "a clear pixel stays clear");
    }
}
