//! The map's ground as flat triangles, the "low poly" look: each ground picture is laid under a
//! mesh of triangles and every triangle is filled with the average colour of the picture under it,
//! so grass stays green and paths brown, only in facets. The mesh is a grid whose points are moved
//! a little at random; the points on one edge are the points on the opposite edge, so the picture
//! still tiles across the map as the game repeats it. Each triangle is shaded a little lighter or
//! darker on top of its average, which is what makes the facets read on flat ground.
//!
//! A tint (`Style::tint`) is the ground's colour multiplied, set in the material, not in pictures.

use crate::png_paint::{decode_rgba, encode_rgba};

/// How big the facets are: how many cells across a picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Facets {
    Large,
    Small,
}

impl Facets {
    pub fn parse(s: &str) -> Option<Facets> {
        match s {
            "large" => Some(Facets::Large),
            "small" => Some(Facets::Small),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Facets::Large => "large",
            Facets::Small => "small",
        }
    }
    fn cells(self) -> u32 {
        match self {
            Facets::Large => 3,
            Facets::Small => 6,
        }
    }
}

/// The ground's look as the window and the record name it: "tint:rrggbb", "facets:small".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Style {
    pub tint: Option<[u8; 3]>,
    pub facets: Option<Facets>,
}

impl Style {
    /// The style out of the record's names; anything malformed is left out.
    pub fn of<'a>(names: impl IntoIterator<Item = &'a str>) -> Style {
        let mut s = Style::default();
        for n in names {
            if let Some(hex) = n.strip_prefix("tint:") {
                s.tint = tint_of(hex);
            } else if let Some(f) = n.strip_prefix("facets:") {
                s.facets = Facets::parse(f);
            }
        }
        s
    }
    pub fn is_plain(&self) -> bool {
        self.tint.is_none() && self.facets.is_none()
    }
}

/// "rrggbb" as a colour; white is no tint at all.
pub fn tint_of(hex: &str) -> Option<[u8; 3]> {
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    let c = [v(0)?, v(2)?, v(4)?];
    (c != [255, 255, 255]).then_some(c)
}

/// A tint as the material's colour factor: sRGB to linear, as the game's tint vectors are.
pub fn tint_factor(c: [u8; 3]) -> [f64; 3] {
    c.map(|x| {
        let s = f64::from(x) / 255.0;
        if s <= 0.04045 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    })
}

/// A small fixed random sequence: the same picture gives the same facets every build.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// The grid's points, `n + 1` a side, moved by up to a third of a cell; the last row and column are
/// the first again, a picture's width or height on, so the facets meet across a tile's edge.
fn points(n: u32, rng: &mut Rng) -> Vec<Vec<(f64, f64)>> {
    let n = n as usize;
    let mut base = vec![vec![(0.0, 0.0); n]; n];
    for row in base.iter_mut() {
        for p in row.iter_mut() {
            *p = ((rng.next() - 0.5) * 0.66, (rng.next() - 0.5) * 0.66);
        }
    }
    (0..=n)
        .map(|y| {
            (0..=n)
                .map(|x| {
                    let (dx, dy) = base[y % n][x % n];
                    (x as f64 + dx, y as f64 + dy)
                })
                .collect()
        })
        .collect()
}

/// The triangles of the grid, each as three points in cell units, the diagonals alternating.
fn triangles(n: u32, rng: &mut Rng) -> Vec<[(f64, f64); 3]> {
    let p = points(n, rng);
    let mut out = Vec::new();
    for y in 0..n as usize {
        for x in 0..n as usize {
            let (a, b, c, d) = (p[y][x], p[y][x + 1], p[y + 1][x + 1], p[y + 1][x]);
            if (x + y) % 2 == 0 {
                out.push([a, b, c]);
                out.push([a, c, d]);
            } else {
                out.push([a, b, d]);
                out.push([b, c, d]);
            }
        }
    }
    out
}

fn edge(a: (f64, f64), b: (f64, f64), p: (f64, f64)) -> f64 {
    (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0)
}

fn inside(t: &[(f64, f64); 3], p: (f64, f64)) -> bool {
    let (e0, e1, e2) = (edge(t[0], t[1], p), edge(t[1], t[2], p), edge(t[2], t[0], p));
    (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0)
}

/// Which triangle each pixel of a `w` x `h` picture is in. A pixel is tested at the triangles of its
/// own cell and the cells around it (a moved point reaches into its neighbours), wrapped, so the
/// pixels past a moved edge belong to the triangle over the edge.
fn owners(w: u32, h: u32, n: u32, tris: &[[(f64, f64); 3]]) -> Vec<u32> {
    let mut out = vec![0u32; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            let p = ((x as f64 + 0.5) * n as f64 / w as f64, (y as f64 + 0.5) * n as f64 / h as f64);
            let (cx, cy) = (p.0.floor() as i64, p.1.floor() as i64);
            let mut found = None;
            'look: for dy in -1..=1i64 {
                for dx in -1..=1i64 {
                    let (gx, gy) = (cx + dx, cy + dy);
                    let (wx, wy) = (gx.rem_euclid(n as i64), gy.rem_euclid(n as i64));
                    // the neighbour's triangles, moved to where it sits by this pixel
                    let shift = ((gx - wx) as f64, (gy - wy) as f64);
                    let cell = (wy * n as i64 + wx) as usize * 2;
                    for k in 0..2 {
                        let t = tris[cell + k];
                        let moved = t.map(|(a, b)| (a + shift.0, b + shift.1));
                        if inside(&moved, p) {
                            found = Some((cell + k) as u32);
                            break 'look;
                        }
                    }
                }
            }
            out[(y * w + x) as usize] =
                found.unwrap_or(((cy.rem_euclid(n as i64) * n as i64 + cx.rem_euclid(n as i64)) * 2) as u32);
        }
    }
    out
}

/// A ground picture (PNG) as flat triangles of its own colours, the same size, as PNG.
pub fn facet_png(png: &[u8], facets: Facets) -> Result<Vec<u8>, String> {
    let (rgba, w, h) = decode_rgba(png)?;
    if w == 0 || h == 0 {
        return Err("empty picture".into());
    }
    let n = facets.cells();
    // seeded by the picture's size and first bytes: another picture, other facets
    let seed = rgba
        .iter()
        .take(64)
        .fold(0x9e37_79b9_7f4a_7c15u64 ^ u64::from(w * 31 + h), |s, b| s.rotate_left(5) ^ u64::from(*b));
    let mut rng = Rng(seed | 1);
    let tris = triangles(n, &mut rng);
    let own = owners(w, h, n, &tris);
    let mut sum = vec![[0f64; 4]; tris.len()];
    for (i, t) in own.iter().enumerate() {
        let s = &mut sum[*t as usize];
        for c in 0..3 {
            s[c] += f64::from(rgba[i * 4 + c]);
        }
        s[3] += 1.0;
    }
    // each facet a little lighter or darker, as if lit from one side
    let shade: Vec<f64> = (0..tris.len()).map(|_| 0.74 + rng.next() * 0.4).collect();
    let mut out = rgba.clone();
    for (i, t) in own.iter().enumerate() {
        let s = sum[*t as usize];
        if s[3] == 0.0 {
            continue;
        }
        for c in 0..3 {
            out[i * 4 + c] = (s[c] / s[3] * shade[*t as usize]).round().clamp(0.0, 255.0) as u8;
        }
    }
    encode_rgba(&out, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgba.extend(f(x, y));
            }
        }
        encode_rgba(&rgba, w, h).unwrap()
    }

    #[test]
    fn a_style_from_its_names() {
        assert_eq!(
            Style::of(["grass", "tint:ff8000", "facets:small"]),
            Style { tint: Some([255, 128, 0]), facets: Some(Facets::Small) }
        );
        assert!(Style::of(["tint:ffffff", "facets:huge", "tint:zz"]).is_plain());
    }

    #[test]
    fn facets_are_flat_and_keep_the_colours() {
        // left half green, right half brown: facets of both, few colours, same size
        let png = picture(64, 64, |x, _| if x < 32 { [40, 160, 40, 255] } else { [150, 100, 50, 255] });
        let (out, w, h) = decode_rgba(&facet_png(&png, Facets::Large).unwrap()).unwrap();
        assert_eq!((w, h), (64, 64));
        let colours: std::collections::HashSet<[u8; 3]> = out.chunks(4).map(|p| [p[0], p[1], p[2]]).collect();
        assert!(colours.len() <= 50, "{} colours", colours.len());
        let green = out.chunks(4).filter(|p| p[1] > p[0]).count();
        assert!(green > 64 * 64 / 4 && green < 64 * 64 * 3 / 4, "{green}");
    }

    #[test]
    fn every_pixel_has_a_triangle_and_the_picture_tiles() {
        let mut rng = Rng(7);
        let tris = triangles(5, &mut rng);
        let own = owners(40, 40, 5, &tris);
        assert!(own.iter().all(|t| (*t as usize) < tris.len()));
        // the grid's edges are its opposite edges: the moved points match across the seam
        let p = points(5, &mut Rng(9));
        for (i, row) in p.iter().enumerate().take(6) {
            assert!((row[5].0 - row[0].0 - 5.0).abs() < 1e-9 && (p[5][i].1 - p[0][i].1 - 5.0).abs() < 1e-9);
        }
    }

    #[test]
    fn a_tint_is_linear() {
        assert_eq!(tint_factor([255, 0, 255]), [1.0, 0.0, 1.0]);
        assert!((tint_factor([128, 128, 128])[0] - 0.2158).abs() < 0.001);
    }
}
