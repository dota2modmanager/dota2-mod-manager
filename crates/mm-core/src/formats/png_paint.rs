//! A picture moved to a colour: the PNG decoded, its pixels
//! painted by crates/mm-core/src/looks/recolor_modes.rs, and written back as a PNG.

/// The PNG's pixels as RGBA, with its width.
pub fn decode_rgba(png: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(png));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let size = reader.output_buffer_size().ok_or("a picture too large to hold")?;
    let mut buf = vec![0; size];
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

/// The picture halved (each pixel the mean of four) until neither side is over `max`; None when it
/// fits already or is no PNG. A model's 4096-pixel pictures were a creep's 65 MB on a stage of 600.
pub fn shrink(png: &[u8], max: u32) -> Option<Vec<u8>> {
    let (w, h) = {
        let dec = png::Decoder::new(std::io::Cursor::new(png));
        let r = dec.read_info().ok()?;
        (r.info().width, r.info().height)
    };
    if w.max(h) <= max {
        return None;
    }
    let (mut px, mut w, mut h) = decode_rgba(png).ok()?;
    while w.max(h) > max && w >= 2 && h >= 2 {
        let (nw, nh) = (w / 2, h / 2);
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        let row = (w * 4) as usize;
        for y in 0..nh as usize {
            for x in 0..nw as usize {
                let a = y * 2 * row + x * 8;
                for c in 0..4 {
                    let s =
                        px[a + c] as u32 + px[a + 4 + c] as u32 + px[a + row + c] as u32 + px[a + row + 4 + c] as u32;
                    out[(y * nw as usize + x) * 4 + c] = ((s + 2) / 4) as u8;
                }
            }
        }
        (px, w, h) = (out, nw, nh);
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(&px).ok()?;
    }
    Some(out)
}

/// Fits `hero_paint_service::Repaint`: the picture by a recipe, its zones each in their colour.
pub fn repaint(png: &[u8], recipe: &crate::paint_recipe::Recipe) -> Result<Vec<u8>, String> {
    let (mut px, w, h) = decode_rgba(png)?;
    crate::paint_recipe::paint_texture(&mut px, w as usize, recipe);
    encode_rgba(&px, w, h)
}

/// One channel of an RGBA picture as a grey PNG: a mask's channel, for the compiler to pack again.
pub fn channel_png(rgba: &[u8], width: u32, height: u32, channel: usize) -> Result<Vec<u8>, String> {
    let grey: Vec<u8> = rgba.as_chunks::<4>().0.iter().map(|p| p[channel]).collect();
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(&grey).map_err(|e| e.to_string())?;
    }
    Ok(out)
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
        let out = repaint(&png, &crate::paint_recipe::Recipe::plain([0.0, 0.0, 255.0], "tint")).unwrap();
        let (painted, _, _) = decode_rgba(&out).unwrap();
        assert_eq!(painted[7], 0, "a clear pixel stays clear");
        let grey = channel_png(&px, 2, 1, 0).unwrap();
        let (g, _, _) = decode_rgba(&grey).unwrap();
        assert_eq!((g[0], g[4]), (200, 0), "a channel comes out as grey");
    }

    #[test]
    fn a_big_picture_is_halved_until_it_fits() {
        let px: Vec<u8> = (0..8 * 4 * 4).map(|i| if i % 4 == 3 { 255 } else { (i % 200) as u8 }).collect();
        let png = encode_rgba(&px, 8, 4).unwrap();
        assert!(shrink(&png, 8).is_none(), "one that fits stays as it is");
        let (small, w, h) = decode_rgba(&shrink(&png, 3).unwrap()).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(small.len(), 8);
        assert_eq!(small[3], 255);
    }
}
