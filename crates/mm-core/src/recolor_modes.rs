//! How a picture takes its layer's colour in the hero's recolour (src/recolor-modes.ts): the
//! window, the 3D preview and the build move a pixel by the same rule.
//!
//!   tint   greys stay; the rest take the hue, saturation and brightness scaled by the colour's
//!   keep   greys stay; the rest take the hue alone
//!   full   every pixel takes the hue and the colour's saturation, greys too
//!   rgb    greys stay; the hue runs once round the wheel across the texture
//!
//! A layer's colour travels as '#rrggbb' or '#rrggbb:mode'; the plain form is tint.

use regex::Regex;
use serde_json::Value;

use crate::recolor::Rgb;

/// The modes in the order the window offers them.
pub const PAINT_MODES: [&str; 4] = ["tint", "keep", "full", "rgb"];

/// A layer's colour and mode out of '#rrggbb[:mode]'; None for anything else.
pub fn parse_paint(value: &Value) -> Option<(String, &'static str)> {
    let s = value.as_str()?;
    let c = Regex::new(r"(?i)^(#[0-9a-f]{6})(?::(tint|keep|full|rgb))?$").expect("a fixed pattern").captures(s)?;
    let mode = c.get(2).map(|m| m.as_str().to_ascii_lowercase());
    let mode = PAINT_MODES.iter().find(|&&m| Some(m) == mode.as_deref()).copied().unwrap_or("tint");
    Some((c[1].to_ascii_lowercase(), mode))
}

/// '#rrggbb' for tint, '#rrggbb:mode' for the rest.
pub fn paint_value(hex: &str, mode: &str) -> String {
    let hex = hex.to_lowercase();
    if mode == "tint" {
        hex
    } else {
        format!("{hex}:{mode}")
    }
}

/// '#rrggbb' as its three channels (NaN where a pair is not hex, as parseInt has it).
pub fn rgb_of_hex(hex: &str) -> Rgb {
    // parseInt(pair, 16): the hex digits it starts with, NaN for none
    let ch = |i: usize| {
        let pair: String = hex.chars().skip(i).take(2).take_while(char::is_ascii_hexdigit).collect();
        u8::from_str_radix(&pair, 16).map_or(f64::NAN, f64::from)
    };
    [ch(1), ch(3), ch(5)]
}

/// h in [0, 1), s and v in [0, 1].
pub fn hsv([r, g, b]: Rgb) -> Rgb {
    let (r, g, b) = (r / 255.0, g / 255.0, b / 255.0);
    let max = r.max(g).max(b);
    let d = max - r.min(g).min(b);
    let mut h = 0.0;
    if d != 0.0 {
        h = if max == r {
            ((g - b) / d + 6.0) % 6.0
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
    }
    [h / 6.0, if max != 0.0 { d / max } else { 0.0 }, max]
}

/// A colour out of `hsv`'s h, s and v, back to 0-255 channels.
pub fn from_hsv([h, s, v]: Rgb) -> Rgb {
    let k = |n: f64| (n + h * 6.0) % 6.0;
    let f = |n: f64| v - v * s * 0f64.max(k(n).min(4.0 - k(n)).min(1.0));
    [f(5.0), f(3.0), f(1.0)].map(|x| crate::js::round(x * 255.0))
}

/// One pixel in the colour, by the mode; None where it stays as it is.
pub fn paint_pixel(from: Rgb, target: Rgb, mode: &str, u: f64, v: f64) -> Option<Rgb> {
    let [_, s, val] = hsv(from);
    let [th, ts, tv] = target;
    if mode == "full" {
        return Some(from_hsv([th, ts, 1f64.min(val * tv)]));
    }
    if s < 0.1 {
        return None;
    }
    Some(match mode {
        "keep" => from_hsv([th, s, val]),
        "rgb" => from_hsv([(th + (u % 1.0 + v % 1.0) * 0.5) % 1.0, s.max(0.6), 1f64.min(val * tv.max(0.5) * 1.2)]),
        _ => from_hsv([th, 1f64.min(s * ts), 1f64.min(val * tv)]),
    })
}

/// A bitmap moved to the colour in place, four bytes a pixel; `bgra` says red and blue are
/// swapped. Answers how many pixels changed.
pub fn paint_pixels(pixels: &mut [u8], width: usize, color: Rgb, mode: &str, bgra: bool) -> usize {
    let (r, b) = if bgra { (2, 0) } else { (0, 2) };
    let target = hsv(color);
    let w = width.max(1);
    let height = ((pixels.len() / 4) / w).max(1);
    let clamp = |x: f64| if x.is_nan() { 0 } else { x.clamp(0.0, 255.0) as u8 };
    let mut changed = 0;
    let mut i = 0;
    while i + 3 < pixels.len() {
        if pixels[i + 3] != 0 {
            let at = i / 4;
            let px = [pixels[i + r] as f64, pixels[i + 1] as f64, pixels[i + b] as f64];
            let u = ((at % width.max(1)) as f64 + 0.5) / width as f64;
            let v = ((at / width.max(1)) as f64 + 0.5) / height as f64;
            if let Some(to) = paint_pixel(px, target, mode, u, v) {
                let to = to.map(clamp);
                if !(to[0] == pixels[i + r] && to[1] == pixels[i + 1] && to[2] == pixels[i + b]) {
                    pixels[i + r] = to[0];
                    pixels[i + 1] = to[1];
                    pixels[i + b] = to[2];
                    changed += 1;
                }
            }
        }
        i += 4;
    }
    changed
}
