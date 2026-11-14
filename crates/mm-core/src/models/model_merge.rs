//! Two models as one file: the mesh of a second model carried inside the first
//! (src/model-merge.ts). An item can wear a second model (`additional_wearable`), which the game
//! makes from its table; a pick that goes as files has only its slot's stock path. A compiled model
//! keeps its meshes inside itself, each a pair of blocks `CTRL.embedded_meshes` names, so the second
//! model's blocks come along: named in CTRL under the next mesh index, given lines in DATA's group
//! and LOD masks like the first mesh's, its bones joined to the skeleton (a vertex names its bones
//! through `m_remappingTable`, so only that table is rewritten), its materials in every material set.
//! A second model with morphs is refused, as is the older mesh layout.

use crate::item_sounds::detached;
use crate::kv3::{self, Block, Node, Value};

/// KV3's type of a plain 32-bit number.
const INT32: u8 = 11;

fn align16(n: usize) -> usize {
    n.div_ceil(16) * 16
}

fn int(kv: &Block, n: Option<&Node>) -> f64 {
    match n {
        Some(n @ Node { value: Value::Number { .. }, .. }) => kv.number_of(n).unwrap_or(0.0),
        _ => 0.0,
    }
}

fn items(n: Option<&Node>) -> &[Node] {
    match n.map(|n| &n.value) {
        Some(Value::Array { items, .. }) => items,
        _ => &[],
    }
}

fn array_mut(n: Option<&mut Node>) -> Option<&mut Vec<Node>> {
    match n.map(|n| &mut n.value) {
        Some(Value::Array { items, .. }) => Some(items),
        _ => None,
    }
}

fn is_number(n: Option<&Node>) -> bool {
    matches!(n.map(|n| &n.value), Some(Value::Number { .. }))
}

/// A number of the same kind as `like`, holding `v`.
fn number_like(like: &Node, v: f64) -> Node {
    let (ty, cell, raw) = match &like.value {
        Value::Number { ty, cell, raw, .. } => (*ty, *cell, raw.clone()),
        _ => (INT32, None, None),
    };
    // a 0 or a 1 written as a type alone holds no bytes to copy the width of
    if cell.is_none() && raw.is_none() {
        let raw = Some((v as i32).to_le_bytes().to_vec());
        return Node::new(Value::Number { ty: INT32, cell: None, type_at: None, raw });
    }
    let width = cell.map(|c| c.width as usize).or(raw.as_ref().map(Vec::len)).unwrap_or(4);
    let bytes = if cell.is_some_and(|c| c.float) {
        if width == 4 {
            (v as f32).to_le_bytes().to_vec()
        } else {
            v.to_le_bytes().to_vec()
        }
    } else {
        match width {
            1 => (v as i8).to_le_bytes().to_vec(),
            2 => (v as i16).to_le_bytes().to_vec(),
            4 => (v as i32).to_le_bytes().to_vec(),
            _ => (v as i64).to_le_bytes().to_vec(),
        }
    };
    Node { value: Value::Number { ty, cell: None, type_at: None, raw: Some(bytes) }, flag: like.flag }
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn put_u32(b: &mut [u8], at: usize, v: u32) {
    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
}

/// The file with these blocks after its own, each on a 16-byte line, as the compiler lays them.
pub fn with_blocks(file: &[u8], blocks: &[(String, Vec<u8>)]) -> Vec<u8> {
    let table = 8 + u32_at(file, 8) as usize;
    let count = u32_at(file, 12) as usize;
    let end = table + count * 12;
    let shift = align16(blocks.len() * 12);
    let mut at = align16(file.len() + shift);
    let mut entries = vec![0u8; shift];
    let mut tail = vec![0u8; at - (file.len() + shift)];
    for (i, (name, data)) in blocks.iter().enumerate() {
        let e = i * 12;
        for (k, c) in name.bytes().take(4).enumerate() {
            entries[e + k] = c;
        }
        put_u32(&mut entries, e + 4, (at - (end + e + 4)) as u32);
        put_u32(&mut entries, e + 8, data.len() as u32);
        let room = if i == blocks.len() - 1 { data.len() } else { align16(data.len()) };
        tail.extend_from_slice(data);
        tail.resize(tail.len() + room - data.len(), 0);
        at += room;
    }
    let mut out = Vec::with_capacity(file.len() + shift + tail.len());
    out.extend_from_slice(&file[..end]);
    out.extend_from_slice(&entries);
    out.extend_from_slice(&file[end..]);
    out.extend_from_slice(&tail);
    for k in 0..count {
        let p = table + k * 12 + 4;
        let v = u32_at(&out, p) + shift as u32;
        put_u32(&mut out, p, v);
    }
    put_u32(&mut out, 12, (count + blocks.len()) as u32);
    let len = out.len() as u32;
    put_u32(&mut out, 0, len);
    out
}

fn lower_name(n: &Node) -> String {
    n.as_str().map(str::to_lowercase).unwrap_or_default()
}

/// The skeleton's arrays joined: bones of `from` that `to` lacks go on the end. A bone's new number,
/// by its number in `from`.
fn join_skeleton(to: &mut Block, from: &Block) -> Option<Vec<f64>> {
    let b = from.root.get("m_modelSkeleton");
    let added: Vec<Node> = items(b.and_then(|b| b.get("m_boneName"))).to_vec();
    let a = to.root.get_mut("m_modelSkeleton")?;
    let Value::Object(members) = &mut a.value else { return None };
    let names = match members.get("m_boneName").map(|n| &n.value) {
        Some(Value::Array { items, .. }) => items.clone(),
        _ => return None,
    };
    let first = match members.get("m_nParent").map(|n| &n.value) {
        Some(Value::Array { items, .. }) => items.first().filter(|n| matches!(n.value, Value::Number { .. }))?.clone(),
        _ => return None,
    };
    let mut known: std::collections::HashMap<String, usize> =
        names.iter().enumerate().map(|(i, n)| (lower_name(n), i)).collect();
    let mut count = names.len();
    let mut out: Vec<f64> = Vec::new();
    for (i, n) in added.iter().enumerate() {
        let key = lower_name(n);
        if let Some(&had) = known.get(&key) {
            out.push(had as f64);
            continue;
        }
        let at = count;
        for (field, list) in members.iter_mut() {
            let Value::Array { items: list, .. } = &mut list.value else { continue };
            let own = items(b.and_then(|b| b.get(field))).get(i)?;
            let parent = int(from, Some(own));
            list.push(if field == "m_nParent" {
                let p = if parent < 0.0 {
                    -1.0
                } else {
                    (parent.fract() == 0.0).then(|| out.get(parent as usize).copied()).flatten().unwrap_or(-1.0)
                };
                number_like(&first, p)
            } else {
                detached(from, own)
            });
            if field == "m_boneName" {
                count += 1;
            }
        }
        known.insert(key, at);
        out.push(at as f64);
    }
    Some(out)
}

/// The hints of how much a model takes in memory, grown by the other's.
fn grow(to: &mut Block, from: &Block) {
    for key in ["pool_size_hint_mesh", "pool_size_hint"] {
        let Some(held) = to.root.get(key).filter(|n| matches!(n.value, Value::Number { .. })) else { continue };
        let v = int(to, Some(held)) + int(from, from.root.get(key));
        let next = number_like(held, v);
        if let Value::Object(m) = &mut to.root.value {
            m.insert(key.to_string(), next);
        }
    }
}

/// `items.slice(from, to)` with whole numbers.
fn slice(list: &[Node], from: f64, to: f64) -> &[Node] {
    let len = list.len() as f64;
    let clamp = |x: f64| if x < 0.0 { (len + x).max(0.0) } else { x.min(len) } as usize;
    let (f, t) = (clamp(from.trunc()), clamp(to.trunc()));
    if f >= t {
        &[]
    } else {
        &list[f..t]
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The first model with the second's meshes in it, or None where the two cannot go together.
pub fn merged_model(first: &[u8], second: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let mut ctrl_a = kv3::read(crate::resource::data(first, "CTRL", 0).map_err(err)?).map_err(err)?;
    let ctrl_b = kv3::read(crate::resource::data(second, "CTRL", 0).map_err(err)?).map_err(err)?;
    let mut data_a = kv3::read(crate::resource::data(first, "DATA", 0).map_err(err)?).map_err(err)?;
    let data_b = kv3::read(crate::resource::data(second, "DATA", 0).map_err(err)?).map_err(err)?;
    let meshes_b: Vec<Node> = items(ctrl_b.root.get("embedded_meshes")).to_vec();
    let Some(Value::Array { items: meshes_a, .. }) = ctrl_a.root.get("embedded_meshes").map(|n| &n.value) else {
        return Ok(None);
    };
    let Some(sample) = meshes_a.first().cloned() else { return Ok(None) };
    let like = match sample.get("mesh_index") {
        Some(l) => l.clone(),
        None => return Ok(None),
    };
    if meshes_b.is_empty()
        || !meshes_b.iter().all(|m| m.get("mesh_index").is_some() && int(&ctrl_b, m.get("morph_block")) < 0.0)
    {
        return Ok(None);
    }
    let mut index = meshes_a.iter().map(|m| int(&ctrl_a, m.get("mesh_index"))).fold(f64::NEG_INFINITY, f64::max) + 1.0;

    let group0 = items(data_a.root.get("m_refMeshGroupMasks")).first().cloned();
    let lod0 = items(data_a.root.get("m_refLODGroupMasks")).first().cloned();
    let row = items(data_a.root.get("m_remappingTable")).first().cloned();
    let start_at = items(data_a.root.get("m_remappingTableStarts")).first().cloned();
    let arrays = ["m_refMeshGroupMasks", "m_refLODGroupMasks", "m_remappingTable", "m_remappingTableStarts"]
        .iter()
        .all(|k| matches!(data_a.root.get(k).map(|n| &n.value), Some(Value::Array { .. })));
    let (Some(group0), Some(lod0), Some(row), Some(start_at), true) = (group0, lod0, row, start_at, arrays) else {
        return Ok(None);
    };
    if !is_number(Some(&row)) || !is_number(Some(&start_at)) {
        return Ok(None);
    }

    let Some(bones) = join_skeleton(&mut data_a, &data_b) else { return Ok(None) };

    let blocks_a = crate::resource::blocks(first).map_err(err)?.len();
    let blocks_b = crate::resource::blocks(second).map_err(err)?;
    let mut moved: Vec<(String, Vec<u8>)> = Vec::new();
    let mut carry = |index: f64| -> f64 {
        let b = (index >= 0.0 && index.fract() == 0.0).then(|| blocks_b.get(index as usize)).flatten();
        let Some(b) = b else { return -1.0 };
        moved.push((b.name.clone(), second[b.at..b.at + b.size].to_vec()));
        (blocks_a + moved.len() - 1) as f64
    };
    let old_table = items(data_b.root.get("m_remappingTable"));
    let old_starts = items(data_b.root.get("m_remappingTableStarts"));
    let mut made_meshes = Vec::new();
    let (mut groups, mut lods, mut starts, mut table) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut table_len = items(data_a.root.get("m_remappingTable")).len();
    for m in &meshes_b {
        let own = int(&ctrl_b, m.get("mesh_index"));
        let mut made = detached(&ctrl_b, m);
        let Value::Object(fields) = &mut made.value else { return Ok(None) };
        fields.insert("mesh_index".into(), number_like(&like, index));
        let data_block = carry(int(&ctrl_b, m.get("data_block")));
        fields.insert("data_block".into(), number_like(&like, data_block));
        let vbib_block = carry(int(&ctrl_b, m.get("vbib_block")));
        fields.insert("vbib_block".into(), number_like(&like, vbib_block));
        fields.insert("morph_block".into(), number_like(&like, -1.0));
        made_meshes.push(made);
        groups.push(group0.clone());
        lods.push(lod0.clone());
        starts.push(number_like(&start_at, table_len as f64));
        let at = |k: f64| (k >= 0.0 && k.fract() == 0.0).then(|| old_starts.get(k as usize)).flatten();
        let from = int(&data_b, at(own));
        let to = if own + 1.0 < old_starts.len() as f64 { int(&data_b, at(own + 1.0)) } else { old_table.len() as f64 };
        for n in slice(old_table, from, to) {
            let k = int(&data_b, Some(n));
            let bone = (k >= 0.0 && k.fract() == 0.0).then(|| bones.get(k as usize).copied()).flatten().unwrap_or(0.0);
            table.push(number_like(&row, bone));
            table_len += 1;
        }
        index += 1.0;
    }
    if let Some(list) = array_mut(ctrl_a.root.get_mut("embedded_meshes")) {
        list.extend(made_meshes);
    }
    for (key, more) in [
        ("m_refMeshGroupMasks", groups),
        ("m_refLODGroupMasks", lods),
        ("m_remappingTableStarts", starts),
        ("m_remappingTable", table),
    ] {
        if let Some(list) = array_mut(data_a.root.get_mut(key)) {
            list.extend(more);
        }
    }
    grow(&mut ctrl_a, &ctrl_b);

    let materials: Vec<String> = crate::resource::references(second)
        .map_err(err)?
        .into_iter()
        .filter(|p| p.to_lowercase().ends_with(".vmat"))
        .collect();
    if let Some(sets) = array_mut(data_a.root.get_mut("m_materialGroups")) {
        for set in sets.iter_mut() {
            let Some(list) = array_mut(set.get_mut("m_materials")) else { continue };
            let Some(one) = list.first().filter(|n| n.as_str().is_some()).cloned() else { continue };
            for p in &materials {
                list.push(Node { value: Value::Str(p.clone()), flag: one.flag });
            }
        }
    }

    let out = with_blocks(first, &moved);
    let out = crate::resource::replace(&out, "CTRL", 0, &kv3::write(&ctrl_a).map_err(err)?).map_err(err)?;
    let out = crate::resource::replace(&out, "DATA", 0, &kv3::write(&data_a).map_err(err)?).map_err(err)?;
    let refs: Vec<&str> = materials.iter().map(String::as_str).collect();
    Ok(Some(crate::resource::with_references(&out, &refs).map_err(err)?))
}
