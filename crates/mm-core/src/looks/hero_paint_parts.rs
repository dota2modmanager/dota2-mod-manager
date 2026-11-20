//! The parts of a hero's model in the recolour (hero_paint_service.rs, paint_recipe.rs): each
//! colour texture is a part, the materials drawn from it carry its masks (the material: metalness,
//! gloss, shine, rim), and the window shows each part as a small picture with the colour zones in it.

use std::collections::HashSet;

use base64::Engine;
use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::paint_recipe::{part_of, zone_shares, ZONES};
use crate::vpk::Index;

/// A material drawn from a colour texture: its file (no _c, as the 3D preview names it) and its
/// masks, as compiled paths; None where it has none and so no material to change.
#[derive(Debug, Clone, PartialEq)]
pub struct MaterialOf {
    pub vmat: String,
    pub masks1: Option<String>,
    pub masks2: Option<String>,
}

fn compiled(p: &str) -> String {
    let p = p.to_lowercase().replace('\\', "/");
    if p.ends_with("_c") {
        p
    } else {
        format!("{p}_c")
    }
}

/// The folder of a path, with its slash.
pub fn dir_of(p: &str) -> &str {
    p.rfind('/').map_or("", |i| &p[..=i])
}

/// A compressed picture read out as a PNG.
pub type DecodeOne<'a> = dyn FnMut(&[u8]) -> Result<Vec<u8>, String> + 'a;

/// The materials beside each colour texture that are drawn from it: a model's materials sit in the
/// folder of their textures.
pub fn materials_by_color(index: &Index, colors: &[String]) -> IndexMap<String, Vec<MaterialOf>> {
    let want: HashSet<&str> = colors.iter().map(String::as_str).collect();
    let dirs: HashSet<&str> = colors.iter().map(|c| dir_of(c)).filter(|d| !d.is_empty()).collect();
    let mut out: IndexMap<String, Vec<MaterialOf>> = IndexMap::new();
    let vmats: Vec<String> =
        index.paths().filter(|p| p.ends_with(".vmat_c") && dirs.contains(dir_of(p))).map(str::to_string).collect();
    for p in vmats.into_iter().take(400) {
        let Some(m) = crate::loadout_material::read_loadout_material(index.read(&p).ok().flatten().as_deref()) else {
            continue;
        };
        let tex = |k: &str| m.textures.get(k).filter(|t| !t.is_empty()).map(|t| compiled(t));
        let Some(color) = tex("g_tColor").filter(|c| want.contains(c.as_str())) else { continue };
        out.entry(color).or_default().push(MaterialOf {
            vmat: p.strip_suffix("_c").unwrap_or(&p).to_string(),
            masks1: tex("g_tMasks1"),
            masks2: tex("g_tMasks2"),
        });
    }
    out
}

/// The parts of a model layer as the window lists them: each texture's part, its file, the
/// materials drawn from it (for the 3D preview to paint) and whether it has masks to change. Two
/// textures of one name (a hero's two blade_color, a style's copy) are one part, as the build paints
/// them: the first one's picture, the materials of both.
pub fn parts_view(files: &[String], mats: &IndexMap<String, Vec<MaterialOf>>) -> Value {
    let mut parts: IndexMap<String, (String, Vec<String>, bool)> = IndexMap::new();
    for f in files {
        let own = mats.get(f).map(Vec::as_slice).unwrap_or_default();
        let part = parts.entry(part_of(f)).or_insert_with(|| (f.clone(), vec![], false));
        for m in own {
            if !part.1.contains(&m.vmat) {
                part.1.push(m.vmat.clone());
            }
        }
        part.2 |= own.iter().any(|m| m.masks1.is_some() || m.masks2.is_some());
    }
    Value::Array(
        parts
            .into_iter()
            .map(|(id, (file, materials, masks))| json!({ "id": id, "file": file, "materials": materials, "masks": masks }))
            .collect(),
    )
}

/// Each colour texture as a small picture, and the zones in it: { file: { picture, zones:
/// [[zone, share, '#rrggbb']] } }. A texture it could not read is left out.
pub fn part_pictures(
    index: &Index,
    files: &[String],
    decode: &mut DecodeOne<'_>,
    log: &mut dyn FnMut(String),
) -> Value {
    let mut out = Map::new();
    for f in files.iter().filter(|f| f.starts_with("materials/") && f.ends_with(".vtex_c")).take(32) {
        let made = (|| -> Result<Value, String> {
            let file = index.read(f).map_err(|e| e.to_string())?.ok_or("not in the game")?;
            let png = match crate::vtex::png_from_vtex(&file) {
                Some(p) => p.to_vec(),
                None => decode(&file)?,
            };
            let small = crate::png_paint::shrink(&png, 256).unwrap_or(png);
            let (px, _, _) = crate::png_paint::decode_rgba(&small)?;
            let zones: Vec<Value> =
                zone_shares(&px).into_iter().map(|(z, share, hex)| json!([ZONES[z], share, hex])).collect();
            let picture = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&small));
            Ok(json!({ "picture": picture, "zones": zones }))
        })();
        match made {
            Ok(v) => {
                out.insert(f.clone(), v);
            }
            Err(e) => log(format!("hero paint: no picture of {f}: {e}")),
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_part_lists_its_materials_and_masks() {
        let mut mats = IndexMap::new();
        mats.insert(
            "materials/x/helmet_color_tga_1.vtex_c".to_string(),
            vec![MaterialOf {
                vmat: "materials/x/helmet.vmat".into(),
                masks1: Some("materials/x/helmet_detailmask_tga_2.vtex_c".into()),
                masks2: None,
            }],
        );
        let v = parts_view(
            &["materials/x/helmet_color_tga_1.vtex_c".into(), "materials/x/belt_color_tga_3.vtex_c".into()],
            &mats,
        );
        assert_eq!(v[0]["id"], "helmet_color");
        assert_eq!(v[0]["materials"][0], "materials/x/helmet.vmat");
        assert_eq!(v[0]["masks"], true);
        assert_eq!(v[1]["masks"], false, "no material found: nothing to change");
        let twice = parts_view(
            &["materials/x/blade_color_psd_1.vtex_c".into(), "materials/x/blade_color_psd_2.vtex_c".into()],
            &mats,
        );
        assert_eq!(twice.as_array().unwrap().len(), 1, "one name, one part");
        assert_eq!(compiled("Materials\\X\\a.vtex"), "materials/x/a.vtex_c");
    }
}
