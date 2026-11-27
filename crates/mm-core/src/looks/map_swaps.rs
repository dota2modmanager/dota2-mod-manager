//! The materials the map's world node swaps in for one draw of one copy (`m_materialOverrides`),
//! which the toolchain's export leaves out: read from the world node and laid on the export
//! before map_scene.rs makes its light copy.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// One draw of one copy that the world node paints with a material of its own instead of its
/// model's (`m_materialOverrides`): the export draws the model's. The Dire's pit haze is one, its
/// model's fountain_dire_00 (an orange picture) swapped for fountain_dire_01 (a grey one with
/// bright streaks, scrolling at 0.66 not 1.25) under the copy's orange tint, so the game's haze is
/// bright orange where the model's own stood dim red. `copy` counts the copies of `model` before
/// this one, as [`crate::map_scene::instance_tints`] does.
#[derive(Debug, Clone, PartialEq)]
pub struct MaterialSwap {
    pub model: String,
    pub copy: usize,
    pub draw: usize,
    pub material: String,
}

/// The world node's material swaps (`m_materialOverrides[]`: the scene object's index, the draw
/// call and the material); a swap on a sub-object (an aggregate's fragment) is left out.
pub fn material_swaps(vwnod: &[u8]) -> Vec<MaterialSwap> {
    let Ok(data) = crate::resource::data(vwnod, "DATA", 0) else { return Vec::new() };
    let Ok(kv) = crate::kv3::read(data) else { return Vec::new() };
    let objects = kv.root.get("m_sceneObjects").map(|n| n.items()).unwrap_or(&[]);
    let stem = |o: &crate::kv3::Node| -> Option<String> {
        let path = o.get("m_renderableModel")?.as_str()?;
        let file = path.rsplit('/').next()?;
        Some(file.strip_suffix(".vmdl").unwrap_or(file).to_string())
    };
    let mut out = Vec::new();
    for s in kv.root.get("m_materialOverrides").map(|n| n.items()).unwrap_or(&[]) {
        let num = |k: &str| s.get(k).and_then(|n| kv.number_of(n));
        let (Some(at), Some(draw)) = (num("m_nSceneObjectIndex"), num("m_nDrawCallIndex")) else { continue };
        if num("m_nSubSceneObject").unwrap_or(0.0) != 0.0 || at < 0.0 || draw < 0.0 {
            continue;
        }
        let Some(material) = s.get("m_pMaterial").and_then(|n| n.as_str()) else { continue };
        let Some(model) = objects.get(at as usize).and_then(stem) else { continue };
        let copy = objects[..at as usize].iter().filter(|o| stem(o).as_deref() == Some(model.as_str())).count();
        out.push(MaterialSwap { model, copy, draw: draw as usize, material: material.to_string() });
    }
    out
}

/// The material at `path` as the toolchain's export carries it (`extras.vmat`): its name (the window
/// draws a part whose material has none as plain grey), its shader and its params by kind, the
/// switches as whole numbers and the textures by file name.
pub fn vmat_json(path: &str, m: &crate::loadout_material::NativeMaterial) -> Value {
    let file = |p: &String| p.rsplit('/').next().unwrap_or(p).to_string();
    json!({
        "Name": path,
        "ShaderName": m.shader,
        "IntParams": m.ints.iter().map(|(k, v)| (k.clone(), json!(*v as i64))).collect::<Map<_, _>>(),
        "FloatParams": m.floats,
        "VectorParams": m.vectors,
        "TextureParams": m.textures.iter().map(|(k, v)| (k.clone(), json!(file(v)))).collect::<Map<_, _>>(),
    })
}

/// The swaps laid on the export: the copy's draw takes a material of its own, the model's with
/// `extras.vmat` the swap's (`materials`: the swap's vmat path to its vmat and the uri of its
/// colour picture, written beside the GLB). The copy's mesh is copied first, so the model's other
/// copies keep theirs. A swap whose material, node or draw is not there is left out.
pub fn swap_materials(json: &mut Value, swaps: &[MaterialSwap], materials: &BTreeMap<String, (Value, String)>) {
    for s in swaps {
        let Some((vmat, uri)) = materials.get(&s.material) else { continue };
        // the copy's node: the k-th of its name, as map_scene.rs tint_nodes counts
        let mut seen: BTreeMap<String, usize> = BTreeMap::new();
        let mut found = Vec::new();
        for (i, n) in json.get("nodes").and_then(Value::as_array).cloned().unwrap_or_default().iter().enumerate() {
            let Some(name) = n.get("name").and_then(Value::as_str) else { continue };
            let k = seen.entry(name.to_string()).or_default();
            if name.split('.').next() == Some(s.model.as_str()) && *k == s.copy {
                found.push(i);
            }
            *k += 1;
        }
        for node in found {
            let Some(mesh) = json["nodes"][node].get("mesh").and_then(Value::as_u64).map(|i| i as usize) else {
                continue;
            };
            let mut copy = json["meshes"][mesh].clone();
            let Some(old) =
                copy.pointer(&format!("/primitives/{}/material", s.draw)).and_then(Value::as_u64).map(|i| i as usize)
            else {
                continue;
            };
            let Some(mut material) = json.pointer(&format!("/materials/{old}")).cloned() else { continue };
            let colour = vmat.pointer("/TextureParams/g_tColor").and_then(Value::as_str).unwrap_or("");
            let name = colour.rsplit('/').next().unwrap_or(colour);
            let push = |json: &mut Value, key: &str, v: Value| -> usize {
                let list = json.as_object_mut().map(|o| o.entry(key).or_insert_with(|| json!([])));
                match list.and_then(Value::as_array_mut) {
                    Some(l) => {
                        l.push(v);
                        l.len() - 1
                    }
                    None => 0,
                }
            };
            let image = push(json, "images", json!({ "uri": uri, "name": name }));
            push(json, "textures", json!({ "source": image }));
            let label = s.material.rsplit('/').next().unwrap_or(&s.material);
            material["name"] = json!(label.strip_suffix(".vmat").unwrap_or(label));
            material["extras"]["vmat"] = vmat.clone();
            let swapped = push(json, "materials", material);
            copy["primitives"][s.draw]["material"] = json!(swapped);
            let at = push(json, "meshes", copy);
            json["nodes"][node]["mesh"] = json!(at);
        }
    }
}
