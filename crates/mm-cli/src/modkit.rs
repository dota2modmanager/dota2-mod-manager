//! The app's code that tools/mods/modkit asks for: KV3 blocks as trees and back, a hero's particles
//! recoloured, where Steam put the game, and where a folder's game files start.
//!
//!   kv3-tree <file> <names.json>          {name: tree} of each block named (DATA, ANIM, ASEQ...)
//!   kv3-put <file> <edits.json> <out>     the file with blocks from trees: {blocks: [[name, tree]],
//!                                         references?: [path]} (references added to the file's list)
//!   recolor-files <pak01> <spec.json>     {files, out, target, first?, from?}: each particle of pak01
//!                                         recoloured (in two passes when `first` is given) into `out`
//!   model-fx <model> <paths.json>        the compiled model, in place, with hitboxes over its own
//!                                         vertices (set mm_surface) and these particle systems
//!   find-dota                             the game folder Steam has, or null
//!   content-root <dir>                    where the game's folders start under dir, or null

use std::path::Path;

use mm_core::recolor;
use mm_core::{kv3, resource, vpk};
use serde::Deserialize;
use serde_json::{json, Value};

fn read_json<T: serde::de::DeserializeOwned>(f: &Path) -> Result<T, String> {
    serde_json::from_str(&std::fs::read_to_string(f).map_err(|e| format!("{}: {e}", f.display()))?)
        .map_err(|e| format!("{}: {e}", f.display()))
}

pub fn tree(file: &Path, names: &Path) -> Result<Value, String> {
    let bytes = std::fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let names: Vec<String> = read_json(names)?;
    let mut out = serde_json::Map::new();
    for name in names {
        let data = resource::data(&bytes, &name, 0).map_err(|e| e.to_string())?;
        let kv = kv3::read(data).map_err(|e| e.to_string())?;
        out.insert(name, kv.tree());
    }
    Ok(Value::Object(out))
}

#[derive(Deserialize)]
struct Edits {
    blocks: Vec<(String, Value)>,
    #[serde(default)]
    references: Vec<String>,
}

pub fn put(file: &Path, edits: &Path, out: &Path) -> Result<Value, String> {
    let mut bytes = std::fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let edits: Edits = read_json(edits)?;
    for (name, t) in &edits.blocks {
        let mut kv =
            kv3::read(resource::data(&bytes, name, 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        kv.set_tree(t).map_err(|e| e.to_string())?;
        let next = kv3::write(&kv).map_err(|e| e.to_string())?;
        bytes = resource::replace(&bytes, name, 0, &next).map_err(|e| e.to_string())?;
    }
    if !edits.references.is_empty() {
        let refs: Vec<&str> = edits.references.iter().map(String::as_str).collect();
        bytes = resource::with_references(&bytes, &refs).map_err(|e| e.to_string())?;
    }
    if let Some(dir) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(out, &bytes).map_err(|e| format!("{}: {e}", out.display()))?;
    Ok(json!(bytes.len()))
}

#[derive(Deserialize)]
struct Spec {
    files: Vec<String>,
    out: String,
    target: recolor::Rgb,
    first: Option<recolor::Rgb>,
    from: Option<recolor::Rgb>,
}

/// modkit recolor's loop: the first pass toward `first`, the second toward `target` from `from`,
/// then a MOD2X layer lifted so the ground under it keeps some of every channel.
pub fn recolor_files(pak01: &Path, spec: &Path) -> Result<Value, String> {
    let ix = vpk::Index::open(pak01).map_err(|e| e.to_string())?;
    let s: Spec = read_json(spec)?;
    let own = recolor::Options { own: Some(true), ..Default::default() };
    let (mut n, mut colours, mut lifted, mut failed) = (0, 0, 0, Vec::new());
    for p in &s.files {
        let one = || -> Result<Option<(Vec<u8>, usize, bool)>, String> {
            let Some(raw) = ix.read(p).map_err(|e| e.to_string())? else { return Ok(None) };
            let (file, changed) = match s.first {
                Some(first) => {
                    let (a, ca) = recolor::recolor_resource(&raw, first, &own)?;
                    if ca.changed == 0 {
                        (a, 0)
                    } else {
                        let o = recolor::Options { own: Some(true), from: s.from, ..Default::default() };
                        let (b, cb) = recolor::recolor_resource(&a, s.target, &o)?;
                        (b, cb.changed)
                    }
                }
                None => {
                    let (a, ca) = recolor::recolor_resource(&raw, s.target, &own)?;
                    (a, ca.changed)
                }
            };
            if changed == 0 {
                return Ok(None);
            }
            let (m, l) = recolor::lift_for_mod2x(&file, 0.3)?;
            Ok(Some((m, changed, l > 0)))
        };
        match one() {
            Ok(Some((file, changed, l))) => {
                let to = Path::new(&s.out).join(p);
                if let Some(dir) = to.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                std::fs::write(&to, file).map_err(|e| e.to_string())?;
                n += 1;
                colours += changed;
                lifted += usize::from(l);
            }
            Ok(None) => {}
            Err(e) => failed.push(format!("{p}: {e}")),
        }
    }
    Ok(json!({ "written": n, "colours": colours, "lifted": lifted, "failed": failed }))
}

/// The model with a hitbox set over its own vertices, for effects spread along the item, and these
/// particle systems of its own: what the effect studio does to an unusual's model.
pub fn model_fx(file: &Path, paths: &Path) -> Result<Value, String> {
    use mm_core::{model_hitboxes, model_particles};
    let model = std::fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let paths: Vec<String> = read_json(paths)?;
    let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
    let boxed = model_hitboxes::with_surface_hitboxes(&model, &[model_hitboxes::SURFACE_SET]);
    let out = model_particles::with_particles(boxed.as_deref().unwrap_or(&model), &paths)
        .ok_or_else(|| format!("{}: the model's data block cannot take particles", file.display()))?;
    std::fs::write(file, out).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(json!({ "hitboxes": boxed.is_some(), "particles": paths.len() }))
}
