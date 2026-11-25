//! The backdrop behind a hero on the game's hero page, for the 3D preview: not part of the 3D
//! scene but 2D panels under it, styled per hero in panorama/styles/hero_loadout_background_images
//! (the compiled .vcss_c keeps the stylesheet's text). A container with a top-to-bottom gradient,
//! over it a painted picture (a 4K JPEG inside a .vtex_c) washed with a colour and shown at 0.3,
//! and dark edges. The window composes them (renderer/catalog/preview3d/backdrop.ts).

use serde_json::{json, Value};

/// The stylesheet, in pak01.
pub const STYLE: &str = "panorama/styles/hero_loadout_background_images.vcss_c";
/// The picture's opacity on the hero page (dashboard_page_hero_new_v2.css #HeroLoadoutBackgroundImage).
const OPACITY: f64 = 0.3;

/// "#163b39" or "#163b39ff" as 0-255 numbers.
fn hex(s: &str) -> Option<[f64; 4]> {
    let h = s.trim().strip_prefix('#')?;
    let n = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok().map(f64::from);
    match h.len() {
        6 => Some([n(0)?, n(2)?, n(4)?, 255.0]),
        8 => Some([n(0)?, n(2)?, n(4)?, n(6)?]),
        _ => None,
    }
}

/// The rules of a stylesheet: (selector, body), comments and @define lines left out.
fn rules(css: &str) -> Vec<(String, String)> {
    css.split('}')
        .filter_map(|chunk| {
            let (sel, body) = chunk.split_once('{')?;
            let sel = sel.rsplit(';').next().unwrap_or(sel);
            Some((sel.split_whitespace().collect::<Vec<_>>().join(" "), body.to_string()))
        })
        .collect()
}

/// A property's value in a rule body.
fn prop<'a>(body: &'a str, name: &str) -> Option<&'a str> {
    body.split(';').find_map(|p| {
        let (k, v) = p.split_once(':')?;
        (k.trim() == name).then(|| v.trim())
    })
}

/// A colour as the sheet writes it: "#rrggbb", or a name it @defines; "&66" after it is its alpha.
fn colour(v: &str, css: &str) -> Option<[f64; 4]> {
    let (name, alpha) = match v.split_once('&') {
        Some((n, a)) => (n.trim(), u8::from_str_radix(a.trim(), 16).ok().map(f64::from)),
        None => (v.trim(), None),
    };
    let mut c = hex(name).or_else(|| {
        css.split(';').find_map(|line| {
            let rest = line.trim().strip_prefix("@define ")?;
            let (k, val) = rest.split_once(':')?;
            (k.trim() == name).then(|| hex(val)).flatten()
        })
    })?;
    if let Some(a) = alpha {
        c[3] = a;
    }
    Some(c)
}

/// The backdrop of a hero (`npc_dota_hero_tidehunter` or `tidehunter`) from the stylesheet's text;
/// Null when the sheet says nothing of it.
pub fn backdrop(css: &str, hero: &str) -> Value {
    let short = hero.strip_prefix("npc_dota_hero_").unwrap_or(hero);
    let container = "#HeroLoadoutBackgroundImageContainer";
    let mine = |sel: &str, tail: &str| sel.split(',').any(|s| s.trim() == format!(".{short} {container}{tail}"));
    let (mut top, mut bottom, mut image, mut wash, mut opacity) = (None, None, None, None, OPACITY);
    for (sel, body) in rules(css) {
        if mine(&sel, "") {
            if let Some(g) = prop(&body, "background-color") {
                let stops: Vec<[f64; 4]> = ["from(", "to("]
                    .iter()
                    .filter_map(|k| g.split(k).nth(1).and_then(|r| r.split(')').next()).and_then(|c| colour(c, css)))
                    .collect();
                if stops.len() == 2 {
                    (top, bottom) = (Some(stops[0]), Some(stops[1]));
                }
            }
        } else if mine(&sel, " #HeroLoadoutBackgroundImage") {
            if let Some(u) = prop(&body, "background-image") {
                let path = u.split('"').nth(1).and_then(|p| p.strip_prefix("s2r://")).map(|p| format!("{p}_c"));
                image = path.filter(|p| p.starts_with("panorama/images/") && p.ends_with(".vtex_c"));
            }
            if let Some(w) = prop(&body, "wash-color") {
                wash = colour(w, css);
            }
            if let Some(o) = prop(&body, "opacity").and_then(|o| o.parse::<f64>().ok()) {
                opacity = o;
            }
        }
    }
    if top.is_none() && image.is_none() {
        return Value::Null;
    }
    let rgb = |c: Option<[f64; 4]>| c.map_or(Value::Null, |c| json!([c[0], c[1], c[2]]));
    json!({
        "top": rgb(top),
        "bottom": rgb(bottom),
        "image": image,
        "wash": wash.map_or(Value::Null, |c| json!([c[0], c[1], c[2], (c[3] / 255.0 * 1000.0).round() / 1000.0])),
        "opacity": opacity,
    })
}

/// A hero's backdrop out of the game's files (`read` takes a pak01 path).
pub fn of(read: &dyn Fn(&str) -> Option<Vec<u8>>, hero: &str) -> Value {
    read(STYLE).map_or(Value::Null, |b| backdrop(&crate::kv::latin1(&b), hero))
}

/// The JPEG a .vtex_c carries (the loadout backgrounds are kept that way), or None.
pub fn jpeg_from_vtex(buf: &[u8]) -> Option<&[u8]> {
    let at = u32::from_le_bytes(buf.get(..4)?.try_into().ok()?) as usize;
    let jpeg = buf.get(at..)?;
    (jpeg.starts_with(&[0xff, 0xd8, 0xff]) && jpeg.ends_with(&[0xff, 0xd9])).then_some(jpeg)
}

/// Where the window's small copy of a backdrop picture is kept.
pub fn kept_path(user_data: &std::path::Path, image: &str) -> Option<std::path::PathBuf> {
    let name = image.rsplit('/').next()?.strip_suffix(".vtex_c")?;
    (!name.is_empty() && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'))
        .then(|| user_data.join("preview-backdrops").join(format!("{name}.webp")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSS: &str = "@define teal: #00E0FF;\n@define royalBlue: #0029FF;\n\
        #HeroLoadoutBackgroundImageContainer #HeroLoadoutBackgroundImage{opacity-mask: url(\"x\");}\
        .tidehunter #HeroLoadoutBackgroundImageContainer #HeroLoadoutBackgroundImage{background-image: url(\"s2r://panorama/images/loadout_backgrounds/loadout_bg_water_002_jpg.vtex\");wash-color: teal&66;}\
        .broodmother #HeroLoadoutBackgroundImage{opacity: 0;}\
        .tidehunter #HeroLoadoutBackgroundImageContainer{background-color: gradient( linear, 0% 0%, 0% 100%, from( #163b39 ), to( #06120d ) );}";

    #[test]
    fn a_heroes_backdrop_comes_out_of_the_stylesheet() {
        let b = backdrop(CSS, "npc_dota_hero_tidehunter");
        assert_eq!(b["top"], json!([22.0, 59.0, 57.0]));
        assert_eq!(b["bottom"], json!([6.0, 18.0, 13.0]));
        assert_eq!(b["image"], json!("panorama/images/loadout_backgrounds/loadout_bg_water_002_jpg.vtex_c"));
        assert_eq!(b["wash"], json!([0.0, 224.0, 255.0, 0.4]));
        assert_eq!(b["opacity"], json!(0.3));
        assert!(backdrop(CSS, "npc_dota_hero_axe").is_null());
    }

    #[test]
    fn the_jpeg_inside_a_texture() {
        let mut v = vec![8, 0, 0, 0, 0, 0, 0, 0];
        v.extend([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
        assert_eq!(jpeg_from_vtex(&v), Some(&v[8..]));
        assert_eq!(jpeg_from_vtex(&v[..10]), None);
        assert!(kept_path(std::path::Path::new("u"), "panorama/images/a/x-y.vtex_c").is_none());
    }
}
