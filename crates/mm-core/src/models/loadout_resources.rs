//! Everything the 3D preview's loadout runtime needs for a set of effects and models
//! (src/loadout-resources.ts), shared by the hero and the recolour views: the effects' snapshots,
//! materials, sprite sheets and drawn models, and each model's GLB with the game's own material
//! inputs in its extras.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::glb_embed::{embed_glb, read_glb, write_glb};
use crate::loadout_material::{loadout_descriptor, read_loadout_material, NativeMaterial, LOADOUT_MASKS};
use crate::model_glb::{Clips, ModelGlb};

/// What exports the models and the pictures: model_glb.rs, or a stand-in.
pub trait Exporter {
    fn glbs(&self, models: &[String], clips: &Clips, materials: bool) -> IndexMap<String, Option<PathBuf>>;
    /// None where this exporter makes no pictures.
    fn sprites(&self, textures: &[String]) -> Option<IndexMap<String, Option<Vec<u8>>>>;
}

impl Exporter for ModelGlb {
    fn glbs(&self, models: &[String], clips: &Clips, materials: bool) -> IndexMap<String, Option<PathBuf>> {
        ModelGlb::glbs(self, models, clips, materials)
    }
    fn sprites(&self, textures: &[String]) -> Option<IndexMap<String, Option<Vec<u8>>>> {
        Some(ModelGlb::sprites(self, textures))
    }
}

/// Reads a game file by its compiled path.
pub type Read<'a> = &'a dyn Fn(&str) -> Option<Vec<u8>>;

fn plain(p: &str) -> String {
    let l = p.to_lowercase();
    l.strip_suffix("_c").map(String::from).unwrap_or(l)
}

/// /^(?:models|materials|particles)\/[\w/.-]+\.(?:vpcf|vmat|vtex|vmdl|vsnap|vmesh)$/ and no `..` part.
fn safe(p: &str) -> bool {
    let Some(rest) = ["models/", "materials/", "particles/"].iter().find_map(|r| p.strip_prefix(r)) else {
        return false;
    };
    let Some(dot) = rest.rfind('.') else { return false };
    let (body, ext) = (&rest[..dot], &rest[dot + 1..]);
    // the greedy [\w/.-]+ gives back to the last dot it can end at
    !body.is_empty()
        && rest.bytes().all(|c| c.is_ascii_alphanumeric() || b"_/.-".contains(&c))
        && ["vpcf", "vmat", "vtex", "vmdl", "vsnap", "vmesh"].contains(&ext)
        && !p.split('/').any(|s| s == "..")
}

/// The native dependency paths a value names, without arbitrary files or parent-directory steps.
pub fn resource_paths(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => {
            let p = plain(s);
            if safe(&p) {
                vec![p]
            } else {
                vec![]
            }
        }
        Value::Array(a) => a.iter().flat_map(resource_paths).collect(),
        Value::Object(o) => crate::js::keys(o).into_iter().flat_map(|k| resource_paths(&o[k])).collect(),
        _ => vec![],
    }
}

fn children(def: &Value) -> &[Value] {
    def.get("children").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// The models the effects' renderers draw. Others a tree names (a hero's body to emit from) cost
/// a full export and draw nothing.
pub fn drawn_models(defs: &[Value]) -> indexmap::IndexSet<String> {
    fn visit(def: &Value, out: &mut indexmap::IndexSet<String>) {
        if let Some(renderers) = def.get("tree").and_then(|t| t.get("m_Renderers")).and_then(Value::as_array) {
            for r in renderers {
                if r.get("_class").and_then(Value::as_str) != Some("C_OP_RenderModels") {
                    continue;
                }
                for row in r.get("m_ModelList").and_then(Value::as_array).into_iter().flatten() {
                    if let Some(m) = row.get("m_model").and_then(Value::as_str) {
                        out.insert(plain(m));
                    }
                }
            }
        }
        for c in children(def) {
            visit(c, out);
        }
    }
    let mut out = indexmap::IndexSet::new();
    for d in defs {
        visit(d, &mut out);
    }
    out
}

fn snapshot_of(file: &[u8]) -> Option<Value> {
    let data = Value::Object(crate::particle_spec::data_tree(Some(file))?);
    let points = crate::particle_snapshot::snapshot_points(file, &data).ok()?;
    if points.is_empty() {
        return None;
    }
    let mut snap = Map::new();
    snap.insert(
        "position".into(),
        Value::Array(points.iter().map(|p| p.get("position").cloned().unwrap_or(Value::Null)).collect()),
    );
    snap.insert(
        "skinning".into(),
        Value::Array(points.iter().map(|p| p.get("weights").cloned().unwrap_or(Value::Null)).collect()),
    );
    for (key, fallback) in
        [("color", json!([1, 1, 1])), ("normal", json!([0, 0, 1])), ("alpha", json!(1)), ("radius", json!(1))]
    {
        if points.iter().any(|p| p.get(key).is_some()) {
            let row =
                points.iter().map(|p| p.get(key).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| fallback.clone()));
            snap.insert(key.into(), Value::Array(row.collect()));
        }
    }
    Some(Value::Object(snap))
}

/// The effects and their children as a packet of local resources: snapshots, materials, models,
/// sheets, and what could not be had.
pub fn loadout_resources(defs: &[Value], read: Read, glb: &dyn Exporter) -> Value {
    let (mut snapshots, mut materials, mut models_out, mut sheets) = (Map::new(), Map::new(), Map::new(), Map::new());
    let mut missing: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: Vec<String> = Vec::new();
    let mut models: Vec<String> = Vec::new();
    let drawn = drawn_models(defs);
    fn visit(def: &Value, queue: &mut Vec<String>) {
        queue.extend(resource_paths(def.get("tree").unwrap_or(&Value::Null)));
        for c in children(def) {
            visit(c, queue);
        }
    }
    for d in defs {
        visit(d, &mut queue);
    }
    let mut i = 0;
    while i < queue.len() {
        let p = plain(&queue[i]);
        i += 1;
        if !safe(&p) || seen.contains(&p) || (p.ends_with(".vmdl") && !drawn.contains(&p)) {
            continue;
        }
        seen.insert(p.clone());
        if seen.len() > 1024 {
            missing.push("Effect dependency limit exceeded".into());
            break;
        }
        let Some(file) = read(&format!("{p}_c")) else {
            missing.push(p);
            continue;
        };
        if p.ends_with(".vsnap") {
            match snapshot_of(&file) {
                Some(s) => {
                    snapshots.insert(p.clone(), s);
                }
                None => {
                    missing.push(p);
                    continue;
                }
            }
        } else if p.ends_with(".vtex") {
            sheets.insert(p.clone(), crate::loadout_sheet::loadout_sheet(Some(&file)));
        } else if p.ends_with(".vmat") {
            match read_loadout_material(Some(&file)) {
                Some(m) => {
                    queue.extend(m.textures.values().cloned());
                    materials.insert(p.clone(), json!(m));
                }
                None => missing.push(p.clone()),
            }
        } else if p.ends_with(".vmdl") {
            models.push(p.clone());
        }
        // the definitions above carry most references already
        if let Ok(refs) = crate::resource::references(&file) {
            queue.extend(refs.iter().map(|r| plain(r)).filter(|r| safe(r) && !r.ends_with(".vmdl")));
        }
    }
    if !models.is_empty() {
        let files = glb.glbs(&models, &Clips::All, true);
        let mut available = Vec::new();
        for m in &models {
            match files.get(m).cloned().flatten() {
                Some(file) => available.push(Wanted { file, model: m.clone(), skin: 0 }),
                None => missing.push(m.clone()),
            }
        }
        let mut lost = Vec::new();
        let prepared =
            loadout_models(&available, read, glb, Some(&mut |m: &str| lost.push(m.to_string()))).unwrap_or_default();
        missing.extend(lost);
        for (w, bytes) in available.iter().zip(prepared) {
            if let Some(b) = bytes {
                models_out
                    .insert(w.model.clone(), json!({ "data": base64::engine::general_purpose::STANDARD.encode(b) }));
            }
        }
    }
    json!({ "snapshots": snapshots, "materials": materials, "models": models_out, "sheets": sheets, "missing": missing })
}

/// A model to dress: its exported GLB, its game path, and the material set it wears (0 the first).
#[derive(Debug, Clone)]
pub struct Wanted {
    pub file: PathBuf,
    pub model: String,
    pub skin: usize,
}

/// One exported GLB with the game's material inputs in its extras.
pub fn loadout_model(file: &Path, model: &str, read: Read, glb: &dyn Exporter) -> Result<Vec<u8>, String> {
    let w = Wanted { file: file.to_path_buf(), model: model.into(), skin: 0 };
    loadout_models(&[w], read, glb, None)?.pop().flatten().ok_or_else(|| "no model".into())
}

/// The materials a model's meshes reference, by path.
fn model_materials(model: &str, read: Read) -> IndexMap<String, NativeMaterial> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue = vec![plain(model)];
    let mut found = IndexMap::new();
    let mut i = 0;
    while i < queue.len() && seen.len() < 256 {
        let p = plain(&queue[i]);
        i += 1;
        if !safe(&p) || seen.contains(&p) {
            continue;
        }
        seen.insert(p.clone());
        let Some(bytes) = read(&format!("{p}_c")) else { continue };
        if p.ends_with(".vmat") {
            if let Some(m) = read_loadout_material(Some(&bytes)) {
                found.insert(p, m);
            }
        } else if let Ok(refs) = crate::resource::references(&bytes) {
            let wanted = |x: &str| [".vmat", ".vmesh", ".vmat_c", ".vmesh_c"].iter().any(|e| x.ends_with(e));
            queue.extend(refs.into_iter().filter(|x| wanted(x)));
        }
    }
    found
}

fn key(name: &str) -> String {
    let k = plain(&name.replace('\\', "/"));
    k.strip_suffix(".vmat").map(String::from).unwrap_or(k)
}

fn base(name: &str) -> String {
    key(name).rsplit('/').next().unwrap_or("").to_string()
}

fn roles(recover_color: bool) -> Vec<(&'static str, &'static str)> {
    let mut r = LOADOUT_MASKS.to_vec();
    if recover_color {
        r.push(("color", "g_tColor"));
    }
    r
}

fn texture<'a>(m: &'a NativeMaterial, key: &str) -> Option<&'a String> {
    m.textures.get(key).filter(|t| !t.is_empty())
}

struct Prepared {
    model: String,
    json: Value,
    bin: Vec<u8>,
    materials: IndexMap<String, NativeMaterial>,
    missing_color: HashSet<String>,
}

fn prepare(w: &Wanted, read: Read) -> Result<Prepared, String> {
    let (json, bin) = read_glb(&embed_glb(&w.file)?)?;
    let mut materials = model_materials(&w.model, read);
    let mut missing_color = HashSet::new();
    let swaps = if w.skin != 0 {
        crate::model_skin::model_skin_materials(read(&format!("{}_c", plain(&w.model))).as_deref(), w.skin)
    } else {
        IndexMap::new()
    };
    let mut names: Vec<String> = Vec::new();
    for n in materials.keys().cloned().chain(swaps.keys().map(|k| plain(k))) {
        if !names.contains(&n) {
            names.push(n);
        }
    }
    let list = json.get("materials").and_then(Value::as_array).cloned().unwrap_or_default();
    for material in &list {
        let index =
            material.get("pbrMetallicRoughness").and_then(|p| p.get("baseColorTexture")).and_then(|b| b.get("index"));
        let tex = index.and_then(|i| json.get("textures")?.get(i.as_u64()? as usize));
        let image = tex.and_then(|t| {
            t.get("extensions")
                .and_then(|e| e.get("EXT_texture_webp"))
                .and_then(|w| w.get("source"))
                .filter(|s| !s.is_null())
                .or_else(|| t.get("source"))
        });
        let has_image = image
            .and_then(Value::as_f64)
            .filter(|n| *n >= 0.0 && n.fract() == 0.0)
            .and_then(|n| json.get("images")?.get(n as usize))
            .is_some_and(crate::js::truthy);
        let name = material.get("name").filter(|n| !n.is_null()).map(crate::js::string).unwrap_or_default();
        let aliases: Vec<&String> = names.iter().filter(|p| base(p) == base(&name)).collect();
        let found =
            names.iter().find(|p| key(p) == key(&name)).or(if aliases.len() == 1 { Some(aliases[0]) } else { None });
        let Some(found) = found.cloned() else { continue };
        let alternate = swaps.get(&found).or_else(|| swaps.get(&format!("{found}_c")));
        let path = alternate.map(|a| plain(a));
        let native = path.filter(|p| safe(p)).and_then(|p| read_loadout_material(read(&format!("{p}_c")).as_deref()));
        match native.filter(|n| texture(n, "g_tColor").is_some()) {
            Some(n) => {
                materials.insert(found.clone(), n);
                missing_color.insert(found);
            }
            None if !has_image => {
                missing_color.insert(found);
            }
            None => {}
        }
    }
    // a model's references name every material set it has; the masks of the sets it does not
    // wear were most of a body's weight
    let worn: HashSet<String> = list
        .iter()
        .map(|m| base(&m.get("name").filter(|n| !n.is_null()).map(crate::js::string).unwrap_or_default()))
        .collect();
    materials.retain(|p, _| worn.contains(&base(p)));
    Ok(Prepared { model: w.model.clone(), json, bin, materials, missing_color })
}

/// The GLBs dressed with the game's material inputs, all their pictures exported together so the
/// toolchain opens the game's archive once. A model that cannot be dressed goes to `on_missing`
/// as None, or fails the whole call when there is no `on_missing`.
pub fn loadout_models(
    models: &[Wanted],
    read: Read,
    glb: &dyn Exporter,
    mut on_missing: Option<&mut dyn FnMut(&str)>,
) -> Result<Vec<Option<Vec<u8>>>, String> {
    let mut prepared = Vec::with_capacity(models.len());
    for w in models {
        match prepare(w, read) {
            Ok(p) => prepared.push(Some(p)),
            Err(e) => match on_missing.as_mut() {
                Some(f) => {
                    f(&w.model);
                    prepared.push(None);
                }
                None => return Err(e),
            },
        }
    }
    let mut wanted: Vec<String> = Vec::new();
    for row in prepared.iter().flatten() {
        for (path, m) in &row.materials {
            for (_, k) in roles(row.missing_color.contains(path)) {
                if let Some(t) = texture(m, k) {
                    let t = plain(t);
                    if !wanted.contains(&t) {
                        wanted.push(t);
                    }
                }
            }
        }
    }
    let pictures = if wanted.is_empty() { None } else { glb.sprites(&wanted) }.unwrap_or_default();
    Ok(prepared
        .into_iter()
        .map(|row| {
            let mut row = row?;
            let mut mats = Map::new();
            for (path, m) in &row.materials {
                let mut images = Map::new();
                for (field, k) in roles(row.missing_color.contains(path)) {
                    if let Some(bytes) = texture(m, k).and_then(|t| pictures.get(&plain(t)).cloned().flatten()) {
                        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                        images.insert(field.into(), json!({ "mime": "image/png", "data": data }));
                    }
                }
                mats.insert(path.clone(), json!({ "descriptor": loadout_descriptor(m), "images": images }));
            }
            let studio = json!({ "sourceModel": row.model, "materials": mats });
            let mut extras = row.json.get("extras").and_then(Value::as_object).cloned().unwrap_or_default();
            extras.insert("dotaStudio".into(), studio);
            row.json["extras"] = Value::Object(extras);
            Some(write_glb(&row.json, &row.bin))
        })
        .collect())
}

/// Every texture the preview's materials of these models sample, colour included, as the sprites
/// export names them; read off the game's own materials before any model is exported, so the
/// pictures can be fetched while the models are.
pub fn loadout_texture_paths(models: &[String], read: Read) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for model in models {
        for m in model_materials(model, read).values() {
            for (_, k) in roles(true) {
                if let Some(t) = texture(m, k) {
                    let t = plain(t);
                    if !out.contains(&t) {
                        out.push(t);
                    }
                }
            }
        }
    }
    out
}
