//! A model with one of its material sets made the one it wears by default, replacing
//! src/model-skin.ts. An item can wear its model in another material set ("skin" in its
//! visuals), and a model put under a plain unit's path is worn in set 0 online. So the meshes draw
//! with the set's materials, matched to set 0's by place, and set 0 takes the set's list.

use indexmap::IndexMap;

use crate::kv3::{self, Node, Value};
use crate::resource;

fn strings(n: Option<&Node>) -> Vec<String> {
    n.map(|n| n.items().iter().map(|x| x.as_str().unwrap_or("").to_string()).collect()).unwrap_or_default()
}

fn material_swaps(groups: &[Node], skin: usize) -> IndexMap<String, String> {
    let plain = strings(groups.first().and_then(|g| g.get("m_materials")));
    let chosen = strings(groups.get(skin).and_then(|g| g.get("m_materials")));
    let mut out = IndexMap::new();
    for (i, material) in plain.iter().enumerate() {
        if let Some(c) = chosen.get(i).filter(|c| !c.is_empty() && c.to_lowercase() != material.to_lowercase()) {
            out.insert(material.to_lowercase(), c.clone());
        }
    }
    out
}

/// The material substitutions of a preview skin: set 0's material (lower case) to the set's.
pub fn model_skin_materials(model: Option<&[u8]>, skin: usize) -> IndexMap<String, String> {
    let (Some(model), true) = (model, skin != 0) else { return IndexMap::new() };
    let read = || -> Option<IndexMap<String, String>> {
        let kv = kv3::read(resource::data_block(model).ok()?).ok()?;
        Some(material_swaps(kv.root.get("m_materialGroups").map(Node::items).unwrap_or(&[]), skin))
    };
    read().unwrap_or_default()
}

/// Every m_material string under a node swapped by `swap`; whether any was.
fn swap_materials(n: &mut Node, swap: &IndexMap<String, String>) -> bool {
    let mut hit = false;
    match &mut n.value {
        Value::Object(m) => {
            for (k, v) in m.iter_mut() {
                if k == "m_material" {
                    if let Value::Str(s) = &mut v.value {
                        if let Some(to) = swap.get(&s.to_lowercase()) {
                            *s = to.clone();
                            hit = true;
                        }
                        continue;
                    }
                }
                hit |= swap_materials(v, swap);
            }
        }
        Value::Array { items, .. } => {
            for v in items {
                hit |= swap_materials(v, swap);
            }
        }
        _ => {}
    }
    hit
}

/// `model` wearing material set `skin` by default; None where it has no such set or the model
/// cannot be read. Set 0 gives the model back as it is.
pub fn with_skin(model: &[u8], skin: usize) -> Option<Vec<u8>> {
    if skin == 0 {
        return Some(model.to_vec());
    }
    let mut data = kv3::read(resource::data_block(model).ok()?).ok()?;
    let groups = match data.root.get("m_materialGroups") {
        Some(Node { value: Value::Array { items, .. }, .. }) => items.clone(),
        _ => return None,
    };
    if skin >= groups.len() {
        return None;
    }
    let swap = material_swaps(&groups, skin);
    if swap.is_empty() {
        return Some(model.to_vec());
    }
    let mut out = model.to_vec();
    let meshes = resource::blocks(model).ok()?.iter().filter(|b| b.name == "MDAT").count();
    for k in 0..meshes {
        let Ok(block) = resource::data(&out, "MDAT", k) else { return None };
        // a mesh of the older binary kind is left as it is
        let Ok(mut kv) = kv3::read(block) else { continue };
        let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Other { ty: 1, value: None }));
        let hit = swap_materials(&mut root, &swap);
        kv.root = root;
        if hit {
            out = resource::replace(&out, "MDAT", k, &kv3::write(&kv).ok()?).ok()?;
        }
    }
    // even with external meshes, the material groups in DATA decide the look
    let set = groups[skin].get("m_materials")?.clone();
    let Some(Node { value: Value::Array { items, .. }, .. }) = data.root.get_mut("m_materialGroups") else {
        return None;
    };
    let Value::Object(first) = &mut items.first_mut()?.value else { return None };
    first.insert("m_materials".into(), set);
    resource::replace(&out, "DATA", 0, &kv3::write(&data).ok()?).ok()
}
