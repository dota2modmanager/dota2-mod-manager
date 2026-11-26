//! Two models as one file: the mesh of a second model carried inside the first.
//! An item can wear a second model (`additional_wearable`), which the game
//! makes from its table; a pick that goes as files has only its slot's stock path. A compiled model
//! keeps its meshes inside itself, each a pair of blocks `CTRL.embedded_meshes` names, so the second
//! model's blocks come along: named in CTRL under the next mesh index, given lines in DATA's group
//! and LOD masks like the first mesh's, its bones joined to the skeleton (a vertex names its bones
//! through `m_remappingTable`, so only that table is rewritten), its materials in every material set.
//! Rows of both mesh layouts go together (a hero's body names its fields `m_n...`, most items the
//! older way), every block a row names comes along, and a morph is fitted to the first model's face
//! controllers, as Effect Studio merges models (patcher/ModelMerge.cs).

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
            // scale and radius are optional in a compiled skeleton: none means 1 and 0
            let optional = field == "m_boneScaleParent" || field == "m_boneSphere";
            if optional && list.is_empty() {
                continue;
            }
            let Some(own) = items(b.and_then(|b| b.get(field))).get(i) else {
                let first = list.first()?.clone();
                if !optional {
                    return None;
                }
                list.push(number_like(&first, if field == "m_boneScaleParent" { 1.0 } else { 0.0 }));
                continue;
            };
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

/// A mesh row's field by the name the newer layout gives it (`m_nMeshIndex`, a hero's body) or the
/// older one (`mesh_index`, most items): one file can hold rows of both once a mesh joins it.
fn field<'a>(row: &'a Node, modern: &str, legacy: &str) -> Option<&'a Node> {
    row.get(modern).or_else(|| row.get(legacy))
}

/// The keys of a mesh row, at any depth, that hold a block's number: the newer layout lists its
/// vertex and index buffers (MVTX, MIDX) under `m_nBlockIndex`, the older one a VBIB.
const BLOCK_FIELDS: [&str; 9] = [
    "m_nDataBlock",
    "m_nMorphBlock",
    "m_nVBIBBlock",
    "m_nToolsVBBlock",
    "m_nBlockIndex",
    "tools_vb_block",
    "data_block",
    "vbib_block",
    "morph_block",
];

/// Each block number a row names, renumbered by `carry` (a number below 0 names no block).
fn carry_blocks(kv: &Block, n: &mut Node, carry: &mut dyn FnMut(f64) -> f64) {
    match &mut n.value {
        Value::Object(m) => {
            for (k, v) in m.iter_mut() {
                if BLOCK_FIELDS.contains(&k.as_str()) && matches!(v.value, Value::Number { .. }) {
                    let old = int(kv, Some(v));
                    if old >= 0.0 {
                        *v = number_like(v, carry(old));
                    }
                } else {
                    carry_blocks(kv, v, carry);
                }
            }
        }
        Value::Array { items, .. } => {
            for x in items.iter_mut() {
                carry_blocks(kv, x, carry);
            }
        }
        _ => {}
    }
}

fn name_of(n: &Node, key: &str) -> String {
    n.get(key).and_then(Node::as_str).unwrap_or_default().to_string()
}

/// The morph of a second model fitted to the first's face controllers, as Effect Studio does it
/// (patcher/ModelMerge.cs): a controller the first has is driven by the first's number for it, its
/// range carried over by a scale and a bias, and one it has not got goes on the end of the first's
/// list, so the first's own numbers, which its animations drive, stay where they are. None where
/// the morph cannot be fitted (a controller of another type, an operator this does not renumber).
fn fitted_morph(host: &mut Block, donor: &mut Block) -> Option<()> {
    let source: Vec<Node> = items(donor.root.get("m_FlexControllers")).iter().map(|c| detached(donor, c)).collect();
    let mut target: Vec<Node> = items(host.root.get("m_FlexControllers")).iter().map(|c| detached(host, c)).collect();
    let names: Vec<String> = source.iter().map(|c| name_of(c, "m_szName")).collect();
    if names.iter().collect::<std::collections::HashSet<_>>().len() != names.len() {
        return None;
    }
    let reader = donor.clone();
    let num = |c: &Node, k: &str| c.get(k).and_then(|n| reader.number_of(n)).unwrap_or(f64::NAN);
    let mut mapping = Vec::new();
    let mut transforms = Vec::new();
    for (i, c) in source.iter().enumerate() {
        let at = match target.iter().position(|t| name_of(t, "m_szName") == names[i]) {
            Some(at) => {
                if name_of(&target[at], "m_szType") != name_of(c, "m_szType") {
                    return None;
                }
                at
            }
            None => {
                target.push(c.clone());
                target.len() - 1
            }
        };
        let (s_min, s_max, t_min, t_max) =
            (num(c, "min"), num(c, "max"), num(&target[at], "min"), num(&target[at], "max"));
        if ![s_min, s_max, t_min, t_max].iter().all(|v| v.is_finite()) || s_max <= s_min || t_max <= t_min {
            return None;
        }
        let scale = (s_max - s_min) / (t_max - t_min);
        transforms.push((scale, s_min - t_min * scale));
        mapping.push(at as f64);
    }
    const ALLOWED: [&str; 10] = [
        "FLEX_OP_CONST",
        "FLEX_OP_FETCH1",
        "FLEX_OP_FETCH2",
        "FLEX_OP_ADD",
        "FLEX_OP_SUB",
        "FLEX_OP_MUL",
        "FLEX_OP_DIV",
        "FLEX_OP_NEG",
        "FLEX_OP_MAX",
        "FLEX_OP_MIN",
    ];
    let mut rules: Vec<Node> = items(donor.root.get("m_FlexRules")).iter().map(|r| detached(donor, r)).collect();
    // a constant to copy the shape of a new operator from: every face the game ships has some
    let constant = rules
        .iter()
        .flat_map(|r| items(r.get("m_FlexOps")))
        .find(|op| name_of(op, "m_OpCode") == "FLEX_OP_CONST")
        .cloned();
    for rule in rules.iter_mut() {
        let ops: Vec<Node> = items(rule.get("m_FlexOps")).to_vec();
        let mut out = Vec::new();
        for mut op in ops {
            let code = name_of(&op, "m_OpCode");
            if !ALLOWED.contains(&code.as_str()) {
                return None;
            }
            if code != "FLEX_OP_FETCH1" {
                out.push(op);
                continue;
            }
            let index = op.get("m_Data").and_then(|n| reader.number_of(n)).unwrap_or(-1.0);
            if index < 0.0 || index.fract() != 0.0 || index as usize >= mapping.len() {
                return None;
            }
            let (scale, bias) = transforms[index as usize];
            let data = op.get("m_Data")?.clone();
            if let Value::Object(m) = &mut op.value {
                m.insert("m_Data".into(), number_like(&data, mapping[index as usize]));
            }
            out.push(op);
            let mut then = |code: &str, v: f64| -> Option<()> {
                let mut c = constant.clone()?;
                let like = c.get("m_Data")?.clone();
                // a number stored as its type alone has no width to write a fraction in
                if !matches!(&like.value, Value::Number { raw: Some(_), .. } | Value::Number { cell: Some(_), .. }) {
                    return None;
                }
                let like_code = c.get("m_OpCode")?.clone();
                if let Value::Object(m) = &mut c.value {
                    m.insert("m_OpCode".into(), Node { value: Value::Str(code.into()), flag: like_code.flag });
                    m.insert("m_Data".into(), number_like(&like, v));
                }
                out.push(c);
                Some(())
            };
            if scale != 1.0 {
                then("FLEX_OP_CONST", scale)?;
                then("FLEX_OP_MUL", 0.0)?;
            }
            if bias != 0.0 {
                then("FLEX_OP_CONST", bias)?;
                then("FLEX_OP_ADD", 0.0)?;
            }
        }
        if let Some(list) = array_mut(rule.get_mut("m_FlexOps")) {
            *list = out;
        }
    }
    if let Some(list) = array_mut(donor.root.get_mut("m_FlexRules")) {
        *list = rules;
    }
    if let Some(list) = array_mut(donor.root.get_mut("m_FlexControllers")) {
        *list = target.clone();
    }
    if let Some(list) = array_mut(host.root.get_mut("m_FlexControllers")) {
        *list = target;
    }
    Some(())
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
    let like = match field(&sample, "m_nMeshIndex", "mesh_index") {
        Some(l) => l.clone(),
        None => return Ok(None),
    };
    if meshes_b.is_empty() || !meshes_b.iter().all(|m| field(m, "m_nMeshIndex", "mesh_index").is_some()) {
        return Ok(None);
    }
    let mut index =
        meshes_a.iter().map(|m| int(&ctrl_a, field(m, "m_nMeshIndex", "mesh_index"))).fold(f64::NEG_INFINITY, f64::max)
            + 1.0;

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

    let blocks_a = crate::resource::blocks(first).map_err(err)?;
    let blocks_b = crate::resource::blocks(second).map_err(err)?;
    // the second's morph, fitted to the first's face controllers where their lists differ: a hat
    // with a beard (Brewmaster's) moves its beard with the face it sits on
    let mut morphs_b: std::collections::HashMap<usize, Vec<u8>> = std::collections::HashMap::new();
    let mut host_morph: Option<Vec<u8>> = None;
    let mut morph_a = match crate::resource::data(first, "MRPH", 0) {
        Ok(b) => Some(kv3::read(b).map_err(err)?),
        Err(_) => None,
    };
    for m in &meshes_b {
        let at = int(&ctrl_b, field(m, "m_nMorphBlock", "morph_block"));
        if at < 0.0 || at.fract() != 0.0 || morphs_b.contains_key(&(at as usize)) {
            continue;
        }
        let Some(b) = blocks_b.get(at as usize).filter(|b| b.name == "MRPH") else { return Ok(None) };
        let mut morph = kv3::read(&second[b.at..b.at + b.size]).map_err(err)?;
        let own: Vec<String> =
            items(morph.root.get("m_FlexControllers")).iter().map(|c| name_of(c, "m_szName")).collect();
        match &mut morph_a {
            // the first has no face of its own: the second's list is the one its rules read
            None => {
                morph_a = Some(morph);
                continue;
            }
            Some(host) => {
                let theirs: Vec<String> =
                    items(host.root.get("m_FlexControllers")).iter().map(|c| name_of(c, "m_szName")).collect();
                if theirs.len() >= own.len() && theirs[..own.len()] == own[..] {
                    continue;
                }
                let before = theirs.len();
                if fitted_morph(host, &mut morph).is_none() {
                    return Ok(None);
                }
                morphs_b.insert(at as usize, kv3::write(&morph).map_err(err)?);
                if items(host.root.get("m_FlexControllers")).len() != before {
                    host_morph = Some(kv3::write(host).map_err(err)?);
                }
            }
        }
    }

    let Some(bones) = join_skeleton(&mut data_a, &data_b) else { return Ok(None) };

    let mut moved: Vec<(String, Vec<u8>)> = Vec::new();
    let mut carried: std::collections::HashMap<usize, f64> = std::collections::HashMap::new();
    let mut carry = |index: f64| -> f64 {
        if index < 0.0 || index.fract() != 0.0 {
            return -1.0;
        }
        let i = index as usize;
        if let Some(&n) = carried.get(&i) {
            return n;
        }
        let Some(b) = blocks_b.get(i) else { return -1.0 };
        let bytes = morphs_b.get(&i).cloned().unwrap_or_else(|| second[b.at..b.at + b.size].to_vec());
        moved.push((b.name.clone(), bytes));
        let n = (blocks_a.len() + moved.len() - 1) as f64;
        carried.insert(i, n);
        n
    };
    let old_table = items(data_b.root.get("m_remappingTable"));
    let old_starts = items(data_b.root.get("m_remappingTableStarts"));
    let old_lods = items(data_b.root.get("m_refLODGroupMasks"));
    let mut made_meshes = Vec::new();
    let (mut groups, mut lods, mut starts, mut table) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut table_len = items(data_a.root.get("m_remappingTable")).len();
    for m in &meshes_b {
        let own = int(&ctrl_b, field(m, "m_nMeshIndex", "mesh_index"));
        // an older model keeps a stale tail of its palette between two meshes' starts: only as many
        // as its mesh's own skeleton has are the mesh's (Effect Studio, RemapMeshBones)
        let data_at = int(&ctrl_b, field(m, "m_nDataBlock", "data_block"));
        let palette = (data_at >= 0.0 && data_at.fract() == 0.0)
            .then(|| blocks_b.get(data_at as usize))
            .flatten()
            .and_then(|b| kv3::read(&second[b.at..b.at + b.size]).ok())
            .and_then(|mesh| mesh.root.get("m_skeleton").and_then(|s| s.get("m_bones")).map(|b| b.items().len()));
        let mut made = detached(&ctrl_b, m);
        carry_blocks(&ctrl_b, &mut made, &mut carry);
        let Value::Object(fields) = &mut made.value else { return Ok(None) };
        let key = if fields.contains_key("m_nMeshIndex") { "m_nMeshIndex" } else { "mesh_index" };
        fields.insert(key.into(), number_like(&like, index));
        made_meshes.push(made);
        groups.push(group0.clone());
        // its own level of detail: a second model's lower one drawn beside its first doubled it
        let at = |k: f64| (k >= 0.0 && k.fract() == 0.0).then(|| old_lods.get(k as usize)).flatten();
        lods.push(at(own).map(|l| number_like(&lod0, int(&data_b, Some(l)))).unwrap_or_else(|| lod0.clone()));
        starts.push(number_like(&start_at, table_len as f64));
        let at = |k: f64| (k >= 0.0 && k.fract() == 0.0).then(|| old_starts.get(k as usize)).flatten();
        let from = int(&data_b, at(own));
        let mut to =
            if own + 1.0 < old_starts.len() as f64 { int(&data_b, at(own + 1.0)) } else { old_table.len() as f64 };
        if let Some(n) = palette {
            to = to.min(from + n as f64);
        }
        for n in slice(old_table, from, to) {
            let k = int(&data_b, Some(n));
            let bone = (k >= 0.0 && k.fract() == 0.0).then(|| bones.get(k as usize).copied()).flatten().unwrap_or(0.0);
            table.push(number_like(&row, bone));
            table_len += 1;
        }
        index += 1.0;
    }
    let new_meshes = made_meshes.len();
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
    // an older model names an empty external mesh per embedded one: the new ones get theirs
    if let Some(list) = array_mut(data_a.root.get_mut("m_refMeshes")) {
        if let Some(one) = list.first().cloned() {
            list.extend(std::iter::repeat_n(one, new_meshes));
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
    let out = match host_morph {
        Some(m) => crate::resource::replace(&out, "MRPH", 0, &m).map_err(err)?,
        None => out,
    };
    let refs: Vec<&str> = materials.iter().map(String::as_str).collect();
    Ok(Some(crate::resource::with_references(&out, &refs).map_err(err)?))
}
