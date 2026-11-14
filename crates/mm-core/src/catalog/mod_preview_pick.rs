//! Which picture a mod gives, and whether it is worth showing (src/mod-preview-pick.ts; the
//! picture is made and cached by mod_preview.rs).
//!
//! What to show: art drawn to be looked at (panorama) beats a model's texture, which is a UV
//! layout and reads as a coloured smear; the two are kept apart as "art" and "texture" so the
//! caller can put the wiki's hero portrait between them. Whether it is worth showing at all: a mod
//! that strips a hero's armour ships an empty texture, which decodes fine and shows nothing, so
//! the decoded pixels are judged before anything is cached.

/// The three kinds of picture a mod can give: drawn art, a model's texture, an animated portrait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Art,
    Texture,
    Video,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "art" => Some(Kind::Art),
            "texture" => Some(Kind::Texture),
            "video" => Some(Kind::Video),
            _ => None,
        }
    }
}

/// One path segment after `prefix` and nothing more: /^prefix[^/]+suffix$/.
fn one(p: &str, prefix: &str, suffix: &str) -> bool {
    p.strip_prefix(prefix).and_then(|r| r.strip_suffix(suffix)).is_some_and(|r| !r.is_empty() && !r.contains('/'))
}

/// Anything after `prefix`: /^prefix.+suffix$/.
fn any(p: &str, prefix: &str, suffix: &str) -> bool {
    p.strip_prefix(prefix).and_then(|r| r.strip_suffix(suffix)).is_some_and(|r| !r.is_empty() && !r.contains('\n'))
}

fn video_rank(p: &str) -> u32 {
    if one(p, "panorama/videos/heroes/", ".webm") {
        100
    } else if any(p, "panorama/videos/", ".webm") {
        80
    } else {
        0
    }
}

// pictures drawn to be looked at, best first: the game draws each somewhere in its own UI
fn art_rank(p: &str) -> u32 {
    let v = ".vtex_c";
    if one(p, "panorama/images/heroes/selection/", v) {
        100 // full-body selection art
    } else if one(p, "panorama/images/heroes/", v) {
        95 // the hero's own portrait
    } else if one(p, "panorama/images/loadingscreens/", v) {
        90
    } else if any(p, "panorama/images/econ/", v) {
        85 // the item's own icon
    } else if one(p, "panorama/images/heroes/icons/", v) {
        60
    } else if one(p, "panorama/images/spellicons/", v) {
        55 // small, but real art
    } else if any(p, "panorama/images/", v) {
        70
    } else {
        0
    }
}

/// Maps the renderer reads as numbers rather than looks at: a normal map is flat lavender noise,
/// a mask grey shapes. They sit beside the colour texture under the same name and would win on
/// tree order (a tree mod offered its normal map first and so ended up with no picture at all).
const DATA_MAP: &[&str] = &[
    "normal",
    "normals",
    "mask",
    "masks",
    "rough",
    "roughness",
    "metal",
    "metalness",
    "ao",
    "spec",
    "specular",
    "gloss",
    "illum",
    "selfillum",
    "detail",
    "flow",
    "noise",
    "ramp",
    "cubemap",
    "height",
    "disp",
    "trans",
    "fresnel",
    "tint",
    "blend",
    "alpha",
];

/// /_(word|...)[_.]/ for these words.
fn has_word(p: &str, words: &[&str]) -> bool {
    p.match_indices('_').any(|(i, _)| {
        let rest = &p[i + 1..];
        words.iter().any(|w| rest.strip_prefix(w).is_some_and(|r| r.starts_with(['_', '.'])))
    })
}

fn texture_rank(p: &str) -> u32 {
    if p.starts_with("panorama/") {
        return 0; // that is art, and art is asked for separately
    }
    if has_word(p, DATA_MAP) {
        return 0;
    }
    // "default_color" and friends are filler the exporter drops in, not the mod's own look
    let filler = ["default/", "dev/"].iter().any(|d| p.starts_with(d) || p.contains(&format!("/{d}")));
    if filler {
        return 5;
    }
    let colour = has_word(p, &["color", "tcolor", "diffuse", "albedo"]);
    match (p.starts_with("materials/models/"), colour) {
        (true, true) => 40,
        (true, false) => 20,
        (false, true) => 30,
        (false, false) => 10,
    }
}

/// Which file inside a mod to show for a kind: `paths` are the mod VPK's lowercased inner paths;
/// a tie goes to the first seen, so the same mod always yields the same picture.
pub fn pick_candidate<'a>(paths: impl IntoIterator<Item = &'a str>, kind: Kind) -> Option<String> {
    let mut best = None;
    let mut best_rank = 0;
    for p in paths {
        if if kind == Kind::Video { !p.ends_with(".webm") } else { !p.ends_with(".vtex_c") } {
            continue;
        }
        let rank = match kind {
            Kind::Video => video_rank(p),
            Kind::Art => art_rank(p),
            Kind::Texture => texture_rank(p),
        };
        if rank > best_rank {
            best_rank = rank;
            best = Some(p.to_string());
        }
    }
    best
}

/// Whether a decoded picture (4 bytes a pixel, alpha last) is worth showing: a mod that removes
/// something ships a texture that is empty or one flat colour.
pub fn worth_showing(width: usize, height: usize, data: &[u8]) -> bool {
    if width < 32 || height < 32 {
        return false;
    }
    let px = width * height;
    if data.len() < px * 4 {
        return false;
    }
    // a grid of at most ~4000 samples: enough to catch "empty" and "one flat colour", cheap
    // enough for a 2048x2048 texture
    let step = ((px as f64 / 4000.0).sqrt().floor() as usize).max(1);
    let (mut seen, mut visible) = (0usize, 0usize);
    let (mut min, mut max) = ([255u8; 3], [0u8; 3]);
    for y in (0..height).step_by(step) {
        for x in (0..width).step_by(step) {
            let i = (y * width + x) * 4;
            seen += 1;
            if data[i + 3] <= 16 {
                continue; // transparent: nothing there to look at
            }
            visible += 1;
            for c in 0..3 {
                min[c] = min[c].min(data[i + c]);
                max[c] = max[c].max(data[i + c]);
            }
        }
    }
    if seen == 0 || (visible as f64) / (seen as f64) < 0.05 {
        return false; // all but empty
    }
    (0..3).map(|c| max[c] as i32 - min[c] as i32).max().unwrap_or(0) >= 12 // not one flat colour
}
