//! The low-poly ground built for the game: each picture the map's grounds paint with, cut into
//! flat triangles of its own colours (ground_facets.rs), compiled by Valve's resource compiler
//! into the game's texture format and put in the Optimization pak under the picture's own path,
//! so every ground that paints with it is in polygons and no material changes. The compiler
//! comes with the Workshop Tools, as for a hero's paint (hero_paint_service.rs), and a picture
//! compiles as the colour of a material of the hero shader: the shader only names it.
//!
//! The pictures come out of the game as PNG through the toolchain (model_glb.rs sprites), the
//! same the Optimization window's 3D map shows, so the build is what the window showed.

use indexmap::IndexMap;

use crate::ground_facets::{facet_png, Facets};
use crate::resource_compiler::{CompileJob, SourceFile};
use crate::vpk::{Entry, Index};

/// Where the pictures are staged for the compiler, and what it names the compiled ones.
const STAGE: &str = "materials/d2mm_ground";

/// The pictures these ground materials paint with (their colour layers), each once, as the
/// material names them ("materials/.../ground_grass.vtex").
/// The toolchain's PNG of each texture asked for, or none where it had none.
pub type Sprites<'a> = dyn Fn(&[String]) -> IndexMap<String, Option<Vec<u8>>> + 'a;

pub fn ground_textures(pak: &Index, materials: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for m in materials {
        let path = if m.ends_with("_c") { m.clone() } else { format!("{m}_c") };
        let file = pak.read(&path).ok().flatten();
        let Some(mat) = crate::loadout_material::read_loadout_material(file.as_deref()) else { continue };
        for (tex, _, _) in crate::map_ground::layers_of(&mat) {
            if !out.contains(&tex) {
                out.push(tex);
            }
        }
    }
    out
}

/// A texture's compiled path: what a material names, with the compiled ending.
pub fn compiled(tex: &str) -> String {
    if tex.ends_with("_c") {
        tex.to_string()
    } else {
        format!("{tex}_c")
    }
}

/// What to stage for one compile of these pictures, and which game texture each staged one stands
/// for: a PNG and a hero-shader material naming it per picture.
pub fn job(pictures: &[(String, Vec<u8>)]) -> (CompileJob, IndexMap<String, String>) {
    let mut files = Vec::new();
    let mut compile = Vec::new();
    let mut names = IndexMap::new();
    for (n, (tex, png)) in pictures.iter().enumerate() {
        let source = format!("{STAGE}/t{n}.png");
        let vmat = format!("{STAGE}/t{n}.vmat");
        let mat = format!("Layer0\n{{\n\tshader \"hero.vfx\"\n\tTextureColor \"{source}\"\n}}\n");
        files.push(SourceFile { path: source, data: png.clone() });
        files.push(SourceFile { path: vmat.clone(), data: mat.into_bytes() });
        compile.push(vmat);
        names.insert(format!("t{n}"), compiled(tex));
    }
    (CompileJob { id: "map_ground".into(), files, compile }, names)
}

/// The compiler's output put under the game's paths: a compiled picture of ours ("t3_png_<hash>")
/// in place of the texture it was cut from; the material the compile needed stays out.
pub fn placed(out: &[Entry], names: &IndexMap<String, String>) -> Vec<Entry> {
    let own = regex::Regex::new(r"^materials/d2mm_ground/(t\d+)_png_[0-9a-f]+\.vtex_c$").expect("a fixed pattern");
    out.iter()
        .filter_map(|e| {
            let p = e.path();
            let c = own.captures(&p)?;
            names.get(&c[1]).map(|to| crate::vpk::entry_at(to, e.data.clone()))
        })
        .collect()
}

/// The pictures of these grounds in polygons, compiled, as entries of the pak; the compiler's
/// error, written for people, when the Workshop Tools are missing.
pub fn faceted(
    pak: &Index,
    materials: &[String],
    facets: Facets,
    sprites: &Sprites<'_>,
    compile: &mut dyn FnMut(&CompileJob) -> Result<Vec<Entry>, String>,
    log: &mut dyn FnMut(String),
) -> Result<Vec<Entry>, String> {
    let textures = ground_textures(pak, materials);
    if textures.is_empty() {
        return Ok(vec![]);
    }
    let pictures: Vec<(String, Vec<u8>)> =
        sprites(&textures).into_iter().filter_map(|(t, png)| Some((t, facet_png(&png?, facets).ok()?))).collect();
    // without the toolchain there are no pictures, and the window had no map to show either
    if pictures.is_empty() {
        log("map ground: no pictures to cut, the toolchain is missing".into());
        return Ok(vec![]);
    }
    let (job, names) = job(&pictures);
    // Valve's compiler now and then dies after it has written its output: one more try
    let out = match compile(&job) {
        Ok(o) => o,
        Err(e) => {
            log(format!("map ground: compiling again after: {}", crate::js::slice_utf16(&e, 200)));
            // the compiler's own words: which Workshop Tools are missing or out of date
            compile(&job)?
        }
    };
    let made = placed(&out, &names);
    log(format!("map ground: {} of {} pictures in polygons", made.len(), textures.len()));
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_stages_a_picture_and_a_material_each_and_maps_them_back() {
        let (job, names) =
            job(&[("materials/terrain/grass.vtex".into(), vec![1]), ("materials/terrain/path.vtex".into(), vec![2])]);
        assert_eq!(job.compile, vec!["materials/d2mm_ground/t0.vmat", "materials/d2mm_ground/t1.vmat"]);
        assert_eq!(job.files.len(), 4);
        let out = vec![
            crate::vpk::entry_at("materials/d2mm_ground/t1_png_0a1b2c3d.vtex_c", vec![9].into()),
            crate::vpk::entry_at("materials/d2mm_ground/t1.vmat_c", vec![8].into()),
        ];
        let got = placed(&out, &names);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path(), "materials/terrain/path.vtex_c");
    }
}
