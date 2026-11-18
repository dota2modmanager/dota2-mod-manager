//! Panorama's compiled styles (vcss_c) and scripts (vjs_c), read and written without Valve's
//! resourcecompiler (src/panorama-files.ts). A script's DATA block is its JavaScript as it is
//! (from version 4). A style's DATA is a CRC, the pictures it names with their sizes (and a CRC
//! from version 3), then its CSS as text. A picture the new CSS names that the style did not is
//! added to the list and to the style's references, as the compiler does.

use std::collections::{HashMap, HashSet};

use regex::Regex;

use crate::js::SPACE_CLASS;
use crate::resource;

/// A picture a style names: its path (the compiled texture's, without _c), its size and its CRC.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StyleImage {
    pub path: String,
    pub width: u16,
    pub height: u16,
    pub crc: u32,
}

fn version(file: &[u8]) -> Result<u16, String> {
    file.get(6..8)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or_else(|| "panorama: a file too short to be a resource".into())
}
fn u16_at(d: &[u8], at: usize) -> Result<u16, String> {
    d.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).ok_or_else(|| "panorama: read past the end".into())
}
fn u32_at(d: &[u8], at: usize) -> Result<u32, String> {
    d.get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| "panorama: read past the end".into())
}

/// A compiled style's pictures and its CSS; an error when it is not one.
pub fn read_style(file: &[u8]) -> Result<(Vec<StyleImage>, String), String> {
    let d = resource::data(file, "DATA", 0).map_err(|e| e.0)?;
    let with_crc = version(file)? >= 3;
    let mut images = Vec::new();
    let mut at = 6;
    for _ in 0..u16_at(d, 4)? {
        let end = d
            .get(at..)
            .and_then(|r| r.iter().position(|&c| c == 0))
            .map(|i| at + i)
            .ok_or("panorama: a style whose picture list does not end")?;
        let path = String::from_utf8_lossy(&d[at..end]).into_owned();
        at = end + 1;
        let crc = if with_crc { u32_at(d, at + 4)? } else { 0 };
        images.push(StyleImage { path, width: u16_at(d, at)?, height: u16_at(d, at + 2)?, crc });
        at += if with_crc { 8 } else { 4 };
    }
    if at > d.len() {
        return Err("panorama: a style shorter than its picture list".into());
    }
    Ok((images, String::from_utf8_lossy(&d[at..]).into_owned()))
}

/// The pictures CSS names, as compiled textures: s2r://a/b.vtex, and a/b.png as the compiler turns
/// it into a/b_png.vtex.
pub fn css_images(css: &str) -> Vec<String> {
    let url = Regex::new(&format!(
        r#"url\({SPACE_CLASS}*["']?(s2r://|file://\{{images\}}/)?([^"')]+?)["']?{SPACE_CLASS}*\)"#
    ))
    .expect("a fixed pattern");
    let picture = Regex::new(r"\.(png|psd|jpg|tga)$").expect("a fixed pattern");
    let ext = Regex::new(r"\.([A-Za-z0-9_]+)$").expect("a fixed pattern");
    let mut out: Vec<String> = Vec::new();
    for m in url.captures_iter(css) {
        // file://{images}/ is panorama/images/
        let images = m.get(1).is_some_and(|p| p.as_str().starts_with("file"));
        let p =
            format!("{}{}", if images { "panorama/images/" } else { "" }, m[2].trim_start_matches('/')).to_lowercase();
        let p = if p.ends_with(".vtex") {
            p
        } else if picture.is_match(&p) {
            ext.replace(&p, "_${1}.vtex").into_owned()
        } else {
            continue;
        };
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// A texture's width and height, from its DATA block (VTEX: two shorts after the flags and reflectivity).
pub fn texture_size(vtex_c: &[u8]) -> Result<(u16, u16), String> {
    let d = resource::data(vtex_c, "DATA", 0).map_err(|e| e.0)?;
    Ok((u16_at(d, 20)?, u16_at(d, 22)?))
}

/// `file`, a compiled style, with `css` in place of its own. Each picture the CSS names that the
/// style does not list is looked up: `known` from another style that lists it, else its size from
/// `texture` (the compiled texture). One neither has stays out of the list, still named in the CSS.
pub fn write_style(
    file: &[u8],
    css: &str,
    known: &dyn Fn(&str) -> Option<StyleImage>,
    texture: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let (images, _) = read_style(file)?;
    let mut listed: HashSet<String> = images.iter().map(|i| i.path.to_lowercase()).collect();
    let mut added: Vec<StyleImage> = Vec::new();
    for path in css_images(css) {
        if listed.contains(&path) {
            continue;
        }
        let image = known(&path).or_else(|| {
            let tex = texture(&format!("{path}_c"))?;
            texture_size(&tex).ok().map(|(width, height)| StyleImage { path: path.clone(), width, height, crc: 0 })
        });
        if let Some(i) = image {
            added.push(StyleImage { path: path.clone(), ..i });
            listed.insert(path);
        }
    }
    let with_crc = version(file)? >= 3;
    let body = css.as_bytes();
    let mut data = Vec::with_capacity(body.len() + 64);
    data.extend_from_slice(&crate::vpk::crc32(body).to_le_bytes());
    data.extend_from_slice(&((images.len() + added.len()) as u16).to_le_bytes());
    for i in images.iter().chain(&added) {
        data.extend_from_slice(i.path.as_bytes());
        data.push(0);
        data.extend_from_slice(&i.width.to_le_bytes());
        data.extend_from_slice(&i.height.to_le_bytes());
        if with_crc {
            data.extend_from_slice(&i.crc.to_le_bytes());
        }
    }
    data.extend_from_slice(body);
    let mut out = resource::replace(file, "DATA", 0, &data).map_err(|e| e.0)?;
    if !added.is_empty() && resource::blocks(&out).map_err(|e| e.0)?.iter().any(|b| b.name == "RERL") {
        let have: HashSet<String> =
            resource::references(&out).map_err(|e| e.0)?.iter().map(|r| r.to_lowercase()).collect();
        let missing: Vec<&str> = added.iter().map(|i| i.path.as_str()).filter(|p| !have.contains(*p)).collect();
        if !missing.is_empty() {
            out = resource::with_references(&out, &missing).map_err(|e| e.0)?;
        }
    }
    Ok(out)
}

/// A compiled script with `js` as its text: `template`, any of the game's scripts, with its DATA replaced.
pub fn write_script(template: &[u8], js: &str) -> Result<Vec<u8>, String> {
    if version(template)? < 4 {
        return Err("panorama: a script template older than plain text".into());
    }
    resource::replace(template, "DATA", 0, js.as_bytes()).map_err(|e| e.0)
}

/// The pictures of several styles by path, for write_style's `known`.
pub fn images_of(styles: &[&[u8]]) -> impl Fn(&str) -> Option<StyleImage> {
    let mut map: HashMap<String, StyleImage> = HashMap::new();
    for s in styles {
        if let Ok((images, _)) = read_style(s) {
            for i in images {
                map.insert(i.path.to_lowercase(), i);
            }
        }
    }
    move |p: &str| map.get(&p.to_lowercase()).cloned()
}
