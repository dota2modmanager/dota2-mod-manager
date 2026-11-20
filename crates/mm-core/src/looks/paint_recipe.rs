//! A hero's paint finer than a layer: what each pixel of a texture gets (hero_paint_service.rs).
//!
//! A layer's key can name one part of its model and one colour zone of its texture:
//!
//!   body                  the whole layer
//!   body@helmet_color     one part: the model's meshes drawn from one colour texture (a hero is
//!                         made of several: a helmet, pauldrons, a sword and a belt may each have theirs)
//!   body~light            one zone: the pixels of the texture whose own colour falls in it
//!   body@helmet_color~yellow   both
//!
//! The more precise key wins, zone over part over layer. A value is a colour and how it is taken,
//! as before ('#rrggbb' or '#rrggbb:mode', recolor_modes.rs), or `keep` for the texture's own,
//! and then the material, each 0 to 100, where the game's own stays when it is not given:
//!
//!   m  metalness        shows the world's reflection in place of its own colour (masks 1, blue):
//!                       silver and chrome. A gold plate at full metalness came out as the white cube
//!                       map in the game; a coloured shine is gloss and shine with no metalness
//!   g  gloss            how sharp the highlight is: the specular exponent (masks 2, alpha)
//!   s  shine            how bright the highlight is: the specular mask (masks 2, red)
//!   r  rim light        the light along the edges (masks 2, green)
//!   d  detail           how much of the detail texture lies over the colour: an arcana's glowing
//!                       pattern, a scrolling fire (masks 1, red); 0 leaves the painted colour alone
//!
//! The mode `grad` is a gradient map: a pixel's brightness picks between the colour (dark) and a
//! second one, `t=rrggbb` (light and highlights), so engraving and edges keep their drawing; `b=0..100`
//! is where between dark and light the two meet (50 by default):
//! '#101014:grad;t=ffb020' is black with gold where the texture is light.
//!
//! Zones meet softly: a pixel near a border belongs to both by a weight (zone_weights), so a
//! gradient across a border does not break into patches of two colours.
//!
//! '#202020:full;m=100;g=90;s=100' is black chrome. The hero shader's masks are the material
//! (vendor/dota-loadout/src/material.js reads them the same way): the build writes them again
//! for the textures a material is set on, and the 3D preview draws the same rule.

use regex::Regex;
use serde_json::{Map, Value};

use crate::recolor::Rgb;
use crate::recolor_modes::{hsv, paint_pixel, parse_paint, rgb_of_hex};

/// The colour zones of a texture, by its own colour: near black, grey (metal, bone, white), and
/// seven hues. The window offers those a texture has.
pub const ZONES: [&str; 9] = ["dark", "light", "red", "orange", "yellow", "green", "cyan", "blue", "purple"];

/// The material's channels, in the order a value names them and the shader reads them.
pub const MATS: [char; 5] = ['m', 'g', 's', 'r', 'd'];

/// The zone a pixel's own colour (0-255 channels) is in. The shader (material.js, paintZone)
/// draws by the same thresholds.
pub fn zone_of(px: Rgb) -> usize {
    let [h, s, v] = hsv(px);
    if v < 0.2 {
        return 0;
    }
    if s < 0.18 {
        return 1;
    }
    match h {
        h if !(0.042..0.92).contains(&h) => 2,
        h if h < 0.11 => 3,
        h if h < 0.19 => 4,
        h if h < 0.45 => 5,
        h if h < 0.53 => 6,
        h if h < 0.72 => 7,
        _ => 8,
    }
}

/// How much a pixel's own colour (0-255 channels) is in each zone, summing to 1: the borders of
/// `zone_of` softened, so neighbours either side of one blend instead of jumping. The shader
/// (material.js, paintWeights) weighs by the same rule.
pub fn zone_weights(px: Rgb) -> [f64; 9] {
    let [h, s, v] = hsv(px);
    let step = |a: f64, b: f64, x: f64| {
        let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    let dark = 1.0 - step(0.15, 0.25, v);
    let grey = (1.0 - dark) * (1.0 - step(0.12, 0.24, s));
    let hue = 1.0 - dark - grey;
    const BORDERS: [f64; 7] = [0.042, 0.11, 0.19, 0.45, 0.53, 0.72, 0.92];
    let w = 0.025;
    let at: Vec<f64> = BORDERS.iter().map(|b| step(b - w, b + w, h)).collect();
    let mut out = [0.0; 9];
    out[0] = dark;
    out[1] = grey;
    out[2] = hue * ((1.0 - at[0]) + at[6]);
    for i in 0..6 {
        out[3 + i] = hue * (at[i] - at[i + 1]);
    }
    out
}

/// A pixel by a gradient map: its brightness between `dark` and `light` (0-255 channels), the two
/// meeting at `at` (0-1).
pub fn gradient_pixel(from: Rgb, dark: Rgb, light: Rgb, at: f64) -> Rgb {
    let lum = (0.299 * from[0] + 0.587 * from[1] + 0.114 * from[2]) / 255.0;
    let t = ((lum - (at - 0.2)) / 0.4).clamp(0.0, 1.0);
    let t = t * t * (3.0 - 2.0 * t);
    [0, 1, 2].map(|c| dark[c] + (light[c] - dark[c]) * t)
}

/// A colour and how it is taken, and the material: what one key gives.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Look {
    pub color: Option<(Rgb, &'static str)>,
    /// the light end of a gradient map (mode grad), and where its two colours meet, 0-100
    pub to: Option<Rgb>,
    pub at: Option<u8>,
    /// metalness, gloss, shine, rim light and detail, 0 to 100; None: the game's own
    pub mats: [Option<u8>; 5],
}

impl Look {
    pub fn is_empty(&self) -> bool {
        self.color.is_none() && self.mats.iter().all(Option::is_none)
    }

    /// `other` laid over this one: what it sets wins.
    fn over(&mut self, other: &Look) {
        if other.color.is_some() {
            self.color = other.color;
            self.to = other.to;
            self.at = other.at;
        }
        for (a, b) in self.mats.iter_mut().zip(other.mats) {
            if b.is_some() {
                *a = b;
            }
        }
    }
}

/// A value out of the window: '#rrggbb[:mode]' or 'keep', then ';m=80' and the like. None for
/// anything else, and for one that changes nothing.
pub fn parse_look(value: &Value) -> Option<Look> {
    let s = value.as_str()?;
    if s.len() > 80 {
        return None;
    }
    let mut pieces = s.split(';');
    let head = pieces.next()?;
    let mut look = Look::default();
    if head != "keep" {
        let (hex, mode) = parse_paint(&Value::String(head.to_string()))?;
        look.color = Some((rgb_of_hex(&hex), mode));
    }
    for p in pieces {
        let (k, n) = p.split_once('=')?;
        if k == "t" {
            let ok = n.len() == 6 && n.bytes().all(|c| c.is_ascii_hexdigit());
            look.to = Some(rgb_of_hex(&format!("#{}", ok.then_some(n)?)));
            continue;
        }
        if k == "b" {
            look.at = Some(n.parse().ok().filter(|n| *n <= 100)?);
            continue;
        }
        let i = MATS.iter().position(|m| k.len() == 1 && k.starts_with(*m))?;
        let n: u8 = n.parse().ok().filter(|n| *n <= 100)?;
        look.mats[i] = Some(n);
    }
    (!look.is_empty()).then_some(look)
}

/// A key split: its layer, the part of the model, the zone.
#[derive(Debug, PartialEq)]
pub struct Key<'a> {
    pub layer: &'a str,
    pub part: Option<&'a str>,
    pub zone: Option<usize>,
}

pub fn split_key(key: &str) -> Option<Key<'_>> {
    let (rest, zone) = match key.split_once('~') {
        Some((r, z)) => (r, Some(ZONES.iter().position(|x| *x == z)?)),
        None => (key, None),
    };
    let (layer, part) = match rest.split_once('@') {
        Some((l, p)) if is_part(p) => (l, Some(p)),
        Some(_) => return None,
        None => (rest, None),
    };
    (!layer.is_empty()).then_some(Key { layer, part, zone })
}

fn is_part(p: &str) -> bool {
    (1..=80).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// The part a colour texture is, out of its compiled name: helmet_color for
/// materials/models/heroes/knight/helmet_color_tga_72202aee.vtex_c.
pub fn part_of(texture: &str) -> String {
    let name = texture.rsplit('/').next().unwrap_or(texture).to_lowercase();
    let suffix = Regex::new(r"_(psd|tga|png|jpg)_[0-9a-f]+\.vtex_c$").expect("a fixed pattern");
    let stem = suffix.replace(&name, "").replace(".vtex_c", "");
    stem.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).take(80).collect()
}

/// What one texture gets: the look of its layer and part, and the look of each zone over it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Recipe {
    pub base: Look,
    pub zones: [Look; 9],
}

impl Recipe {
    /// A colour alone, for the whole picture.
    #[cfg(test)]
    pub fn plain(color: Rgb, mode: &'static str) -> Recipe {
        Recipe { base: Look { color: Some((color, mode)), to: None, at: None, mats: [None; 5] }, ..Default::default() }
    }

    /// What the window's values give the texture `part` of `layer`.
    pub fn of(values: &Map<String, Value>, layer: &str, part: &str) -> Recipe {
        let mut r = Recipe::default();
        for (k, v) in values {
            let Some(key) = split_key(k).filter(|key| key.layer == layer) else { continue };
            if key.part.is_some_and(|p| p != part) {
                continue;
            }
            let Some(look) = parse_look(v) else { continue };
            // the part's own goes over the layer's
            let precise = key.part.is_some();
            match key.zone {
                None if precise => r.base.over(&look),
                None if r.base.is_empty() => r.base = look,
                None => {
                    let mut l = look;
                    l.over(&r.base);
                    r.base = l;
                }
                Some(z) if precise => r.zones[z].over(&look),
                Some(z) => {
                    let mut l = look;
                    l.over(&r.zones[z]);
                    r.zones[z] = l;
                }
            }
        }
        r
    }

    pub fn is_empty(&self) -> bool {
        self.base.is_empty() && self.zones.iter().all(Look::is_empty)
    }

    pub fn has_color(&self) -> bool {
        self.base.color.is_some() || self.zones.iter().any(|z| z.color.is_some())
    }

    pub fn has_mats(&self) -> bool {
        std::iter::once(&self.base).chain(&self.zones).any(|l| l.mats.iter().any(Option::is_some))
    }

    /// The colour of a pixel in zone `z`, and whether the zone asked for it: a zone's own colour
    /// takes its greys too, where a layer's leaves them as they are in the plain modes.
    pub fn color_at(&self, z: usize) -> Option<(Rgb, &'static str, bool)> {
        match self.zones[z].color {
            Some((c, m)) => Some((c, m, true)),
            None => self.base.color.map(|(c, m)| (c, m, false)),
        }
    }

    /// The light end of the gradient a pixel in zone `z` takes (its zone's, or the layer's), and
    /// where its colours meet, 0-1.
    pub fn to_at(&self, z: usize) -> (Option<Rgb>, f64) {
        let l = if self.zones[z].color.is_some() { &self.zones[z] } else { &self.base };
        (l.to, l.at.unwrap_or(50) as f64 / 100.0)
    }

    /// A material channel of a pixel in zone `z`, 0 to 100.
    pub fn mat_at(&self, z: usize, i: usize) -> Option<u8> {
        self.zones[z].mats[i].or(self.base.mats[i])
    }
}

/// What a zone paints a pixel with: its colour, that colour as HSV, the mode, whether the zone
/// asked for it, and the light end of a gradient.
type Target = (Rgb, Rgb, &'static str, bool, (Option<Rgb>, f64));

/// A colour texture (four bytes a pixel, RGBA) painted by the recipe, in place. Answers how many
/// pixels changed.
pub fn paint_texture(pixels: &mut [u8], width: usize, recipe: &Recipe) -> usize {
    let w = width.max(1);
    let height = ((pixels.len() / 4) / w).max(1);
    let targets: Vec<Option<Target>> =
        (0..ZONES.len()).map(|z| recipe.color_at(z).map(|(c, m, f)| (c, hsv(c), m, f, recipe.to_at(z)))).collect();
    if targets.iter().all(Option::is_none) {
        return 0;
    }
    let clamp = |x: f64| if x.is_nan() { 0 } else { x.clamp(0.0, 255.0) as u8 };
    let mut changed = 0;
    for (at, px) in pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        if px[3] == 0 {
            continue;
        }
        let from = [px[0] as f64, px[1] as f64, px[2] as f64];
        let u = ((at % w) as f64 + 0.5) / w as f64;
        let v = ((at / w) as f64 + 0.5) / height as f64;
        // each zone's paint of the pixel, by how much the pixel is in it
        let mut sum = [0.0; 3];
        let mut moved = false;
        for (z, weight) in zone_weights(from).into_iter().enumerate() {
            if weight < 0.001 {
                continue;
            }
            let own = match targets[z] {
                Some((rgb, _, "grad", _, (light, at))) => Some(gradient_pixel(from, rgb, light.unwrap_or(rgb), at)),
                Some((_, target, mode, forced, _)) => paint_pixel(from, target, mode, u, v)
                    .or_else(|| forced.then(|| paint_pixel(from, target, "full", u, v)).flatten()),
                None => None,
            };
            moved |= own.is_some();
            let c = own.unwrap_or(from);
            for i in 0..3 {
                sum[i] += c[i] * weight;
            }
        }
        if let Some(to) = moved.then_some(sum).map(|t| t.map(clamp)) {
            if to[..] != px[..3] {
                px[..3].copy_from_slice(&to);
                changed += 1;
            }
        }
    }
    changed
}

/// Which channel of a mask each material channel is: masks 1 (detail, diffuse warp, metalness,
/// self-illumination) and masks 2 (specular, rim, tint by base, exponent).
pub fn mask_channels(kind: u8) -> &'static [(usize, usize)] {
    match kind {
        1 => &[(0, 2), (4, 0)],
        _ => &[(2, 0), (3, 1), (1, 3)],
    }
}

/// A mask of the hero shader (RGBA, `mw` wide) set by the recipe where its colour texture's pixel
/// (`color`, RGBA, `cw` wide) is in a zone with a material: the two pictures need not be one size.
pub fn edit_mask(mask: &mut [u8], mw: usize, kind: u8, color: &[u8], cw: usize, recipe: &Recipe) -> usize {
    let (mw, cw) = (mw.max(1), cw.max(1));
    let (mh, ch) = ((mask.len() / 4 / mw).max(1), (color.len() / 4 / cw).max(1));
    // per channel of the mask, each zone's value (0-255), None for the game's own
    let channels: Vec<(usize, [Option<f64>; 9])> = mask_channels(kind)
        .iter()
        .map(|&(mat, ch)| (ch, std::array::from_fn(|z| recipe.mat_at(z, mat).map(|n| n as f64 * 255.0 / 100.0))))
        .filter(|(_, by)| by.iter().any(Option::is_some))
        .collect();
    let mut changed = 0;
    for (at, px) in mask.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let (x, y) = (at % mw, at / mw);
        let ci = ((y * ch / mh).min(ch - 1) * cw + (x * cw / mw).min(cw - 1)) * 4;
        let Some(c) = color.get(ci..ci + 3) else { continue };
        let weights = zone_weights([c[0] as f64, c[1] as f64, c[2] as f64]);
        for (channel, by) in &channels {
            let own = px[*channel] as f64;
            let value: f64 = weights.iter().zip(by).map(|(w, v)| w * v.unwrap_or(own)).sum();
            let value = value.round().clamp(0.0, 255.0) as u8;
            if px[*channel] != value {
                px[*channel] = value;
                changed += 1;
            }
        }
    }
    changed
}

/// How much of a texture (RGBA) each zone covers, and its mean colour there, for the zones that
/// cover at least a hundredth of what is drawn: [(zone, share, '#rrggbb')].
pub fn zone_shares(pixels: &[u8]) -> Vec<(usize, f64, String)> {
    let mut sum = [[0f64; 4]; 9];
    let mut total = 0f64;
    for px in pixels.as_chunks::<4>().0.iter().filter(|p| p[3] > 8) {
        let z = zone_of([px[0] as f64, px[1] as f64, px[2] as f64]);
        for c in 0..3 {
            sum[z][c] += px[c] as f64;
        }
        sum[z][3] += 1.0;
        total += 1.0;
    }
    (0..ZONES.len())
        .filter(|&z| total > 0.0 && sum[z][3] / total >= 0.01)
        .map(|z| {
            let n = sum[z][3];
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                (sum[z][0] / n).round() as u8,
                (sum[z][1] / n).round() as u8,
                (sum[z][2] / n).round() as u8
            );
            (z, crate::js::round(sum[z][3] / total * 1000.0) / 1000.0, hex)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_value_carries_colour_mode_and_material() {
        let l = parse_look(&json!("#ff0000:full;m=100;g=80")).unwrap();
        assert_eq!(l.color, Some(([255.0, 0.0, 0.0], "full")));
        assert_eq!(l.mats, [Some(100), Some(80), None, None, None]);
        assert_eq!(parse_look(&json!("keep;d=0")).unwrap().mats[4], Some(0), "the detail off");
        let keep = parse_look(&json!("keep;s=0")).unwrap();
        assert!(keep.color.is_none());
        assert_eq!(keep.mats[2], Some(0));
        assert!(parse_look(&json!("keep")).is_none(), "nothing to change");
        assert!(parse_look(&json!("#ff0000;m=101")).is_none());
        assert!(parse_look(&json!("#ff0000;x=1")).is_none());
        assert_eq!(parse_look(&json!("#00ff00")).unwrap().color.unwrap().1, "tint", "the old form still reads");
    }

    #[test]
    fn keys_name_a_part_and_a_zone() {
        assert_eq!(split_key("body"), Some(Key { layer: "body", part: None, zone: None }));
        assert_eq!(
            split_key("itemModel:4521@helmet_color~light"),
            Some(Key { layer: "itemModel:4521", part: Some("helmet_color"), zone: Some(1) })
        );
        assert_eq!(split_key("body~nope"), None);
        assert_eq!(split_key("body@Bad/Part"), None);
        assert_eq!(part_of("materials/models/heroes/knight/helmet_color_tga_72202aee.vtex_c"), "helmet_color");
        assert_eq!(part_of("materials/models/heroes/knight/blade_color_psd_15c5096.vtex_c"), "blade_color");
    }

    #[test]
    fn zones_meet_softly_and_weigh_to_one() {
        for px in
            [[10.0, 10.0, 12.0], [180.0, 180.0, 185.0], [200.0, 20.0, 20.0], [150.0, 160.0, 230.0], [40.0, 41.0, 60.0]]
        {
            let w = zone_weights(px);
            assert!((w.iter().sum::<f64>() - 1.0).abs() < 1e-9, "{px:?}");
            assert_eq!(w.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0, zone_of(px), "{px:?}");
        }
        // a pale blue right on the grey border is in both
        let w = zone_weights([170.0, 175.0, 210.0]);
        assert!(w[1] > 0.1 && w[7] > 0.1, "{w:?}");
    }

    #[test]
    fn a_gradient_takes_dark_to_one_colour_and_light_to_the_other() {
        let look = parse_look(&json!("#101014:grad;t=ffb020;m=0")).unwrap();
        assert_eq!(look.color.unwrap().1, "grad");
        assert_eq!(look.to, Some([255.0, 176.0, 32.0]));
        assert!(parse_look(&json!("#101014:grad;t=xyz")).is_none());
        let dark = gradient_pixel([20.0, 20.0, 20.0], [16.0, 16.0, 20.0], [255.0, 176.0, 32.0], 0.5);
        let light = gradient_pixel([240.0, 240.0, 250.0], [16.0, 16.0, 20.0], [255.0, 176.0, 32.0], 0.5);
        // the meeting point moved up: a mid grey stays on the dark side
        assert_eq!(gradient_pixel([128.0, 128.0, 128.0], [0.0; 3], [255.0; 3], 0.8), [0.0; 3]);
        assert_eq!(parse_look(&json!("#000000:grad;t=ffffff;b=70")).unwrap().at, Some(70));
        assert_eq!(dark, [16.0, 16.0, 20.0]);
        assert_eq!(light, [255.0, 176.0, 32.0]);
        let mut px = vec![20, 20, 20, 255, 240, 240, 250, 255];
        let r = Recipe { base: look, ..Default::default() };
        assert_eq!(paint_texture(&mut px, 2, &r), 2);
        assert_eq!(&px[4..7], &[255, 176, 32], "light to gold");
    }

    #[test]
    fn zones_follow_the_pixels_own_colour() {
        assert_eq!(ZONES[zone_of([10.0, 10.0, 12.0])], "dark");
        assert_eq!(ZONES[zone_of([180.0, 180.0, 185.0])], "light");
        assert_eq!(ZONES[zone_of([200.0, 20.0, 20.0])], "red");
        assert_eq!(ZONES[zone_of([210.0, 170.0, 40.0])], "yellow");
        assert_eq!(ZONES[zone_of([40.0, 60.0, 200.0])], "blue");
    }

    #[test]
    fn the_precise_key_wins() {
        let v = json!({
            "body": "#ff0000;m=10",
            "body@helmet_color": "#00ff00",
            "body~light": "#0000ff:full;g=90",
            "body@blade_color~light": "keep;m=100",
        });
        let v = v.as_object().unwrap();
        let helmet = Recipe::of(v, "body", "helmet_color");
        assert_eq!(helmet.base.color.unwrap().0, [0.0, 255.0, 0.0], "the part over the layer");
        assert_eq!(helmet.base.mats[0], Some(10), "the layer's material where the part has none");
        assert_eq!(helmet.color_at(1).unwrap().0, [0.0, 0.0, 255.0]);
        assert_eq!(helmet.mat_at(1, 1), Some(90));
        assert_eq!(helmet.mat_at(4, 0), Some(10));
        let blade = Recipe::of(v, "body", "blade_color");
        assert_eq!(blade.mat_at(1, 0), Some(100), "the part's zone over the layer's");
        assert_eq!(blade.color_at(1).unwrap().0, [0.0, 0.0, 255.0], "the layer's zone colour stays");
        assert!(Recipe::of(v, "itemModel:1", "x").is_empty());
    }

    #[test]
    fn a_zone_paints_its_greys_too() {
        // a grey pixel and a red one
        let mut px = vec![150, 150, 150, 255, 200, 30, 30, 255];
        let mut r = Recipe::plain([0.0, 0.0, 255.0], "tint");
        assert_eq!(paint_texture(&mut px.clone(), 2, &r), 1, "the layer's tint leaves the grey");
        r.zones[1].color = Some(([0.0, 0.0, 255.0], "tint"));
        assert_eq!(paint_texture(&mut px, 2, &r), 2, "the grey zone's own colour takes it");
        assert!(px[2] > px[0], "now blue");
    }

    #[test]
    fn a_mask_takes_the_material_where_its_zone_says() {
        // colour: a grey pixel, a red one; mask 2 is the same size
        let color = vec![150, 150, 150, 255, 200, 30, 30, 255];
        let mut mask = vec![10, 10, 10, 10, 10, 10, 10, 10];
        let mut r = Recipe::default();
        r.zones[1].mats = [Some(100), Some(100), Some(0), None, None];
        assert_eq!(edit_mask(&mut mask, 2, 2, &color, 2, &r), 2);
        assert_eq!(&mask[..4], &[0, 10, 10, 255], "shine to 0, gloss to 255, rim as it was");
        assert_eq!(&mask[4..], &[10, 10, 10, 10], "the red pixel keeps its own");
        let mut m1 = vec![0, 0, 0, 0, 0, 0, 0, 0];
        edit_mask(&mut m1, 2, 1, &color, 2, &r);
        assert_eq!(m1, vec![0, 0, 255, 0, 0, 0, 0, 0], "metalness is masks 1's blue");
        r.zones[1].mats[4] = Some(0);
        let mut m1 = vec![200, 0, 0, 0, 200, 0, 0, 0];
        edit_mask(&mut m1, 2, 1, &color, 2, &r);
        assert_eq!((m1[0], m1[4]), (0, 200), "the detail is masks 1's red, off where the zone says");
        // a mask of another size reads the colour where its pixel falls
        let mut small = vec![0, 0, 0, 0];
        r.zones[2].mats[0] = Some(50);
        edit_mask(&mut small, 1, 1, &color, 2, &r);
        assert_eq!(small[2], 255, "the first colour pixel is grey: full metal");
    }

    #[test]
    fn shares_list_the_zones_a_texture_has() {
        let px = vec![150, 150, 150, 255, 200, 30, 30, 255, 200, 30, 30, 255, 0, 0, 0, 0];
        let s = zone_shares(&px);
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].0, s[1].0), (1, 2));
        assert!((s[1].1 - 0.667).abs() < 0.001);
        assert_eq!(s[1].2, "#c81e1e");
    }
}
