//! The game's own prismatic gem colours, read out of items_game.txt (src/gem-colors.ts): its
//! "colors" section, one block per gem with a color_name and a hex_color. The section is found by
//! its line rather than by walking every block before it.

use regex::Regex;
use serde::Serialize;

use crate::kv::{self, KvError};
use crate::vpk::Index;
use crate::vtex::{data_url, png_from_vtex};

/// One prismatic gem colour.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GemColor {
    pub key: String,
    pub name: String,
    pub rgb: [u8; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}

/// The shared prismatic socket artwork and its colour overlay, from the installed game.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GemArt {
    pub image: String,
    pub mask: Option<String>,
}

fn socket(ix: &Index, name: &str) -> Option<String> {
    let data = ix.read(&format!("panorama/images/econ/sockets/{name}_png.vtex_c")).ok().flatten()?;
    png_from_vtex(&data).map(data_url)
}

/// The shared socket art, or None when the game has none.
pub fn prismatic_gem_art(ix: &Index) -> Option<GemArt> {
    let image = socket(ix, "gem_color")?;
    Some(GemArt { image, mask: socket(ix, "gem_color_mask") })
}

/// The gems with their own socket art, where the game ships it.
pub fn prismatic_gem_pictures(gems: &[GemColor], ix: &Index) -> Vec<GemColor> {
    gems.iter()
        .map(|gem| {
            let slug = gem.key.strip_prefix("unusual_").unwrap_or(&gem.key);
            for name in [format!("gem_color_{slug}"), format!("gem_color_{}", gem.key)] {
                let path = format!("panorama/images/econ/sockets/{name}_png.vtex_c");
                if !ix.has(&path) {
                    continue;
                }
                if let Some(url) = ix.read(&path).ok().flatten().as_deref().and_then(png_from_vtex).map(data_url) {
                    return GemColor { picture: Some(url), ..gem.clone() };
                }
            }
            gem.clone()
        })
        .collect()
}

/// "UnusualCreatorsLight" as "Creators Light"; digits stay one word: "International 2012".
pub fn gem_name(color_name: &str) -> String {
    let s = color_name.strip_prefix("Unusual").unwrap_or(color_name);
    let s = Regex::new(r"([a-z])([A-Z0-9])").expect("a fixed pattern").replace_all(s, "$1 $2");
    let s = Regex::new(r"([0-9])([A-Z])").expect("a fixed pattern").replace_all(&s, "$1 $2");
    crate::js::trim(&s).to_string()
}

/// "#FFAF00" as [255, 175, 0], or None.
pub fn rgb_of(hex: &str) -> Option<[u8; 3]> {
    let m = Regex::new(r"(?i)^#?([0-9a-f]{6})$").expect("a fixed pattern");
    let c = m.captures(crate::js::trim(hex))?;
    let h = &c[1];
    let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// Every prismatic gem colour in the table, in the table's order.
pub fn gem_colors(text: &[u8]) -> Result<Vec<GemColor>, KvError> {
    let at = regex::bytes::Regex::new(r#"(?-u)\n\t"colors"[\t-\r \xA0]*\n"#).expect("a fixed pattern");
    let Some(m) = at.find(text) else { return Ok(vec![]) };
    let section = kv::block_bounds(text, m.end() - 1)?;
    let mut out = Vec::new();
    let mut err = None;
    kv::each_child(text, section, |c| {
        let Some(body) = c.body else { return true };
        if !c.key.starts_with(b"unusual_") {
            return true;
        }
        let (mut name, mut rgb) = (String::new(), None);
        let r = kv::each_child(text, body, |f| {
            if let Some(v) = f.value.filter(|_| f.body.is_none()) {
                if f.key == b"color_name" {
                    name = gem_name(&kv::latin1(v));
                }
                if f.key == b"hex_color" {
                    rgb = rgb_of(&kv::latin1(v));
                }
            }
            true
        });
        if let Err(e) = r {
            err = Some(e);
            return false;
        }
        if let (false, Some(rgb)) = (name.is_empty(), rgb) {
            out.push(GemColor { key: kv::latin1(c.key), name, rgb, picture: None });
        }
        true
    })?;
    match err {
        Some(e) => Err(e),
        None => Ok(out),
    }
}

/// The gem whose key or name this is, ignoring case, spaces and an apostrophe; or None.
pub fn find_gem<'a>(gems: &'a [GemColor], what: &str) -> Option<&'a GemColor> {
    let sep = Regex::new(&format!(r"(?:{}|[_'’-])+", crate::js::SPACE_CLASS)).expect("a fixed pattern");
    let norm = |s: &str| {
        let low = s.to_lowercase();
        let low = low.strip_prefix("unusual_").unwrap_or(&low).to_string();
        sep.replace_all(&low, "").into_owned()
    };
    let want = norm(what);
    gems.iter().find(|g| norm(&g.key) == want || norm(&g.name) == want)
}
