//! Hitboxes laid over a wearable's surface, so an effect started on it spreads over the item,
//! replacing src/model-hitboxes.ts.
//!
//! A wearable has no hitboxes, and the mesh the game's effects read instead it keeps only for a
//! hero's body, so on an item the same system piles up at the model's origin. Boxes made from the
//! item's own vertices, in a set the particle points at (particle_surface.rs), answer that. Each
//! vertex goes to its heaviest bone and into the bone's own space, and the vertices of a bone are
//! gathered into cells, one box per cell, at most MAX_BOXES of them.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde::Serialize;

use crate::kv3::{self, Block, Element, Node, Value};
use crate::meshopt;
use crate::resource;

const MAX_BOXES: usize = 256;
/// The set the boxes go in, which a system made to spread over them names.
pub const SURFACE_SET: &str = "mm_surface";
const FLOAT3: f64 = 6.0; // DXGI_FORMAT_R32G32B32_FLOAT, every wearable's positions
const HITBOX_BONE: i64 = 0x100; // a bone's flag that the game computes it for hitboxes
const SHELL: f64 = 1.5; // how far a box stands off the points it was made from

/// The 32-bit MurmurHash2 the game keeps its names by: a lowercase name, seed 0x31415926.
pub fn name_hash(name: &str) -> u32 {
    crate::material::attribute_token(name)
}

/// One box: the bone it follows, its corners in that bone's space.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SurfaceBox {
    pub bone: String,
    pub min: [f64; 3],
    pub max: [f64; 3],
}

fn num(kv: &Block, n: Option<&Node>) -> f64 {
    match n {
        Some(n @ Node { value: Value::Number { .. }, .. }) => kv.number_of(n).unwrap_or(f64::NAN),
        _ => -1.0,
    }
}

fn text(n: Option<&Node>) -> &str {
    n.and_then(Node::as_str).unwrap_or("")
}

fn items(n: Option<&Node>) -> &[Node] {
    n.map(Node::items).unwrap_or(&[])
}

fn truth(n: Option<&Node>) -> bool {
    matches!(n, Some(Node { value: Value::Other { ty: 13, .. }, .. }))
}

fn either<'a>(n: Option<&'a Node>, a: &str, b: &str) -> Option<&'a Node> {
    n.and_then(|n| n.get(a).or_else(|| n.get(b)))
}

fn u32_at(b: &[u8], at: usize) -> Result<usize, String> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()) as usize)
        .ok_or_else(|| "hitboxes: a read past the block".into())
}

/// One vertex buffer's layout, however the model stores it.
struct Layout {
    count: usize,
    size: usize,
    bytes: Vec<u8>,
    compressed: bool,
    position: i64,
    indices: i64,
    weights: i64,
}

/// Layouts of an MBUF or VBIB block: 24-byte buffer headers, 56-byte attributes.
fn vbib_layouts(b: &[u8]) -> Result<Vec<Layout>, String> {
    let first = u32_at(b, 0)?;
    let mut out = Vec::new();
    for i in 0..u32_at(b, 4)? {
        let h = first + i * 24;
        let count = u32_at(b, h)?;
        let size = u32_at(b, h + 4)? & 0x3ff_ffff;
        let attrs = h + 8 + u32_at(b, h + 8)?;
        let mut at: HashMap<String, (usize, usize)> = HashMap::new();
        for a in 0..u32_at(b, h + 12)? {
            let p = attrs + a * 56;
            let name = b.get(p..p + 32).ok_or("hitboxes: a read past the block")?;
            let name: String = name.iter().take_while(|c| **c != 0).map(|c| *c as char).collect();
            at.insert(name, (u32_at(b, p + 40)?, u32_at(b, p + 36)?));
        }
        let data_at = h + 16 + u32_at(b, h + 16)?;
        let length = u32_at(b, h + 20)?;
        let bytes = b[data_at.min(b.len())..(data_at + length).min(b.len())].to_vec();
        let offset = |n: &str| at.get(n).map_or(-1, |a| a.0 as i64);
        out.push(Layout {
            count,
            size,
            bytes,
            compressed: length != count * size,
            position: at.get("POSITION").filter(|p| p.1 as f64 == FLOAT3).map_or(-1, |p| p.0 as i64),
            indices: offset("BLENDINDICES"),
            weights: if at.contains_key("BLENDWEIGHT") { offset("BLENDWEIGHT") } else { offset("BLENDWEIGHTS") },
        });
    }
    Ok(out)
}

fn block_of(file: &[u8], index: f64) -> Result<Vec<u8>, String> {
    let blocks = resource::blocks(file).map_err(|e| e.to_string())?;
    let at = (index >= 0.0 && index.fract() == 0.0)
        .then_some(index as usize)
        .filter(|i| *i < blocks.len())
        .ok_or("hitboxes: no such block")?;
    let nth = blocks[..at].iter().filter(|b| b.name == blocks[at].name).count();
    resource::data(file, &blocks[at].name, nth).map(<[u8]>::to_vec).map_err(|e| e.to_string())
}

/// Layouts of a mesh that keeps each buffer in an MVTX block and says how in CTRL.
fn ctrl_layouts(file: &[u8], ctrl: &Block, mesh: Option<&Node>) -> Result<Vec<Layout>, String> {
    let mut out = Vec::new();
    for vb in items(mesh.and_then(|m| m.get("m_vertexBuffers"))) {
        if truth(vb.get("m_bCompressedZSTD")) {
            continue;
        }
        let fields = items(vb.get("m_inputLayoutFields"));
        let field = |name: &str| fields.iter().find(|f| text(f.get("m_pSemanticName")) == name);
        let Some(pos) = field("POSITION") else { continue };
        if num(ctrl, pos.get("m_Format")) != FLOAT3 {
            continue;
        }
        let offset = |f: Option<&Node>| f.map_or(-1, |f| num(ctrl, f.get("m_nOffset")) as i64);
        out.push(Layout {
            count: num(ctrl, vb.get("m_nElementCount")) as usize,
            size: num(ctrl, vb.get("m_nElementSizeInBytes")) as usize,
            bytes: block_of(file, num(ctrl, vb.get("m_nBlockIndex")))?,
            compressed: truth(vb.get("m_bMeshoptCompressed")),
            position: offset(Some(pos)),
            indices: offset(field("BLENDINDICES")),
            weights: offset(field("BLENDWEIGHT").or_else(|| field("BLENDWEIGHTS"))),
        });
    }
    Ok(out)
}

fn raw(l: &Layout) -> Result<Vec<u8>, String> {
    if l.compressed {
        meshopt::decode_vertex_buffer(l.count, l.size, &l.bytes)
    } else {
        Ok(l.bytes.clone())
    }
}

/// A mesh's inverse bind poses, 3x4 rows by bone name, from its skeleton.
fn bind_poses(mesh: &Block) -> HashMap<String, Vec<f64>> {
    let mut out = HashMap::new();
    for b in items(mesh.root.get("m_skeleton").and_then(|s| s.get("m_bones"))) {
        let pose: Vec<f64> = items(b.get("m_invBindPose")).iter().map(|n| num(mesh, Some(n))).collect();
        if pose.len() == 12 {
            out.insert(text(b.get("m_boneName")).to_string(), pose);
        }
    }
    out
}

fn apply(m: &[f64], p: [f64; 3]) -> [f64; 3] {
    [0, 4, 8].map(|r| m[r] * p[0] + m[r + 1] * p[1] + m[r + 2] * p[2] + m[r + 3])
}

fn f32_at(b: &[u8], at: usize) -> Result<f64, String> {
    b.get(at..at + 4)
        .map(|s| f32::from_le_bytes(s.try_into().unwrap()) as f64)
        .ok_or_else(|| "hitboxes: a vertex past its buffer".into())
}

/// Every vertex of the first mesh as its heaviest bone and its place in that bone's space.
fn surface(file: &[u8], ctrl: &Block, data: &Block) -> Result<Vec<(String, [f64; 3])>, String> {
    let mesh = items(ctrl.root.get("embedded_meshes")).first();
    let vbib = num(ctrl, either(mesh, "m_nVBIBBlock", "vbib_block"));
    let layouts = if vbib >= 0.0 { vbib_layouts(&block_of(file, vbib)?)? } else { ctrl_layouts(file, ctrl, mesh)? };
    let poses = bind_poses(
        &kv3::read(&block_of(file, num(ctrl, either(mesh, "m_nDataBlock", "data_block")))?)
            .map_err(|e| e.to_string())?,
    );
    let names: Vec<&str> = items(data.root.get("m_modelSkeleton").and_then(|s| s.get("m_boneName")))
        .iter()
        .map(|n| text(Some(n)))
        .collect();
    let table: Vec<f64> = items(data.root.get("m_remappingTable")).iter().map(|n| num(data, Some(n))).collect();
    let mesh_index = num(ctrl, either(mesh, "m_nMeshIndex", "mesh_index"));
    let starts = items(data.root.get("m_remappingTableStarts"));
    let start =
        (mesh_index >= 0.0).then(|| starts.get(mesh_index as usize)).flatten().map_or(-1.0, |n| num(data, Some(n)));
    let bone = |i: usize| -> String {
        let at = start.max(0.0) as usize + i;
        let by = table.get(at).map_or(i as f64, |v| *v);
        let named = (by >= 0.0 && by.fract() == 0.0).then(|| names.get(by as usize)).flatten();
        named.or(names.first()).copied().unwrap_or("").to_string()
    };
    let mut out = Vec::new();
    for l in &layouts {
        if l.position < 0 {
            continue;
        }
        let b = raw(l)?;
        let (pos, ix, wt) = (l.position as usize, l.indices, l.weights);
        for v in 0..l.count {
            let at = v * l.size;
            let p = [f32_at(&b, at + pos)?, f32_at(&b, at + pos + 4)?, f32_at(&b, at + pos + 8)?];
            let mut heaviest = 0;
            if ix >= 0 && wt >= 0 {
                let mut w = -1i32;
                for k in 0..4 {
                    if let Some(&x) = b.get(at + wt as usize + k) {
                        if x as i32 > w {
                            w = x as i32;
                            heaviest = k;
                        }
                    }
                }
            }
            let index = if ix >= 0 {
                *b.get(at + ix as usize + heaviest).ok_or("hitboxes: a vertex past its buffer")? as usize
            } else {
                0
            };
            let name = bone(index);
            let at = poses.get(&name).map_or(p, |pose| apply(pose, p));
            out.push((name, at));
        }
    }
    Ok(out)
}

/// Vertices gathered into cells of `size`, a box per cell.
fn cells(points: &[(String, [f64; 3])], size: f64) -> Vec<SurfaceBox> {
    let mut boxes: IndexMap<(String, [i64; 3]), SurfaceBox> = IndexMap::new();
    for (bone, at) in points {
        let key = (bone.clone(), at.map(|c| (c / size).floor() as i64));
        match boxes.get_mut(&key) {
            None => {
                boxes.insert(key, SurfaceBox { bone: bone.clone(), min: *at, max: *at });
            }
            Some(b) => {
                for ((lo, hi), v) in b.min.iter_mut().zip(b.max.iter_mut()).zip(at) {
                    *lo = lo.min(*v);
                    *hi = hi.max(*v);
                }
            }
        }
    }
    boxes.into_values().collect()
}

/// The boxes for a model's surface: as fine as MAX_BOXES lets them be. None for a model with no vertices.
pub fn surface_boxes(file: &[u8]) -> Result<Vec<SurfaceBox>, String> {
    let read = |name: &str| -> Result<Block, String> {
        kv3::read(resource::data(file, name, 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let ctrl = read("CTRL")?;
    Ok(fit_boxes(&surface(file, &ctrl, &read("DATA")?)?))
}

/// Vertices as boxes, as fine as MAX_BOXES lets them be: the cells grow until there are few
/// enough, and once a cell is wider than the model reaches from its origin, growing it changes
/// nothing more, so the boxes go straight to one per bone (src/model-hitboxes.ts fitBoxes says
/// what the long way there cost). A model with more bones than MAX_BOXES keeps a box per bone.
pub fn fit_boxes(points: &[(String, [f64; 3])]) -> Vec<SurfaceBox> {
    if points.is_empty() {
        return vec![];
    }
    // the span of the first 200 000 points, as the TypeScript measures it
    let span = |c: usize| {
        let v = points.iter().take(200_000).map(|p| p.1[c]);
        v.clone().fold(f64::NEG_INFINITY, f64::max) - v.fold(f64::INFINITY, f64::min)
    };
    let mut size = (crate::js::hypot(&[span(0), span(1), span(2)]) / 24.0).max(2.0);
    // Math.max: a NaN anywhere makes it NaN, and no size is past it
    let reach =
        points
            .iter()
            .flat_map(|p| p.1)
            .fold(0.0, |m: f64, c| if m.is_nan() || c.is_nan() { f64::NAN } else { m.max(c.abs()) });
    let mut boxes = cells(points, size);
    while boxes.len() > MAX_BOXES {
        if size > reach {
            boxes = cells(points, f64::INFINITY);
            break;
        }
        size *= 1.3;
        boxes = cells(points, size);
    }
    boxes
        .into_iter()
        .map(|b| SurfaceBox { bone: b.bone, min: b.min.map(|v| v - SHELL), max: b.max.map(|v| v + SHELL) })
        .collect()
}

fn raw_number(ty: u8, bytes: Vec<u8>) -> Node {
    Node::new(Value::Number { ty, cell: None, type_at: None, raw: Some(bytes) })
}

fn double(v: f64) -> Node {
    raw_number(5, v.to_le_bytes().to_vec())
}

fn int(v: i32) -> Node {
    raw_number(11, v.to_le_bytes().to_vec())
}

fn uint(v: u32) -> Node {
    raw_number(12, v.to_le_bytes().to_vec())
}

fn word(v: &str) -> Node {
    Node::new(Value::Str(v.to_string()))
}

fn typed(items: Vec<Node>, ty: u8) -> Node {
    Node::new(Value::Array { items, element: Some(Element { ty, flag: 0 }), ty: 0 })
}

fn object(members: Vec<(&str, Node)>) -> Node {
    Node::new(Value::Object(members.into_iter().map(|(k, v)| (k.to_string(), v)).collect()))
}

fn hitbox(b: &SurfaceBox, index: usize) -> Node {
    object(vec![
        ("m_name", word(&format!("surface_{index}"))),
        ("m_sSurfaceProperty", word("default")),
        ("m_sBoneName", word(&b.bone)),
        ("m_vMinBounds", typed(b.min.iter().map(|v| double(*v)).collect(), 5)),
        ("m_vMaxBounds", typed(b.max.iter().map(|v| double(*v)).collect(), 5)),
        ("m_flShapeRadius", double(0.0)),
        ("m_nBoneNameHash", uint(name_hash(&b.bone))),
        ("m_nGroupId", int(0)),
        ("m_nShapeType", int(0)),
        ("m_bTranslationOnly", Node::new(Value::Other { ty: 14, value: None })),
        ("m_CRC", uint(0)),
        ("m_cRenderColor", typed((0..4).map(|_| int(0)).collect(), 11)),
        ("m_nHitBoxIndex", int(index as i32)),
    ])
}

fn hitbox_set(name: &str, boxes: &[SurfaceBox]) -> Node {
    object(vec![
        ("key", word(name)),
        (
            "value",
            object(vec![
                ("m_name", word(name)),
                ("m_nNameHash", uint(name_hash(name))),
                ("m_HitBoxes", typed(boxes.iter().enumerate().map(|(i, b)| hitbox(b, i)).collect(), 9)),
            ]),
        ),
    ])
}

/// The model's bones under these boxes flagged for hitboxes. Stock items have the flag, a store
/// weapon's one bone may not.
fn flagged(model: &[u8], boxes: &[SurfaceBox]) -> Result<Vec<u8>, String> {
    let mut kv = kv3::read(resource::data_block(model).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let used: HashSet<&str> = boxes.iter().map(|b| b.bone.as_str()).collect();
    let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Other { ty: 1, value: None }));
    if let Some(skeleton) = root.get_mut("m_modelSkeleton") {
        let names: Vec<String> = items(skeleton.get("m_boneName")).iter().map(|n| text(Some(n)).to_string()).collect();
        if let Some(Node { value: Value::Array { items: flags, .. }, .. }) = skeleton.get_mut("m_nFlag") {
            for (i, name) in names.iter().enumerate() {
                let Some(flag) = flags.get_mut(i).filter(|f| matches!(f.value, Value::Number { .. })) else { continue };
                if used.contains(name.as_str()) {
                    let v = kv.number_of(flag).unwrap_or(0.0);
                    // JavaScript's | works on 32 bits
                    let next = ((v as i64 as i32) | HITBOX_BONE as i32) as f64;
                    kv.set_number(flag, next).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    kv.root = root;
    let next = kv.encode().map_err(|e| e.to_string())?;
    resource::replace(model, "DATA", 0, &next).map_err(|e| e.to_string())
}

/// `model` with its surface boxes as a hitbox set under each of `names` on each of its meshes, or
/// None for a model this cannot read or that has no vertices of its own. A set it already has stays.
pub fn with_surface_hitboxes(model: &[u8], names: &[&str]) -> Option<Vec<u8>> {
    let run = || -> Result<Option<Vec<u8>>, String> {
        let boxes = surface_boxes(model)?;
        if boxes.is_empty() {
            return Ok(None);
        }
        let ctrl =
            kv3::read(resource::data(model, "CTRL", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let blocks = resource::blocks(model).map_err(|e| e.to_string())?;
        let mut out = model.to_vec();
        for mesh in items(ctrl.root.get("embedded_meshes")) {
            let index = num(&ctrl, mesh.get("m_nDataBlock").or_else(|| mesh.get("data_block")));
            if index < 0.0 {
                continue;
            }
            let at = index as usize;
            if at >= blocks.len() {
                return Err("hitboxes: no such block".into());
            }
            let (name, nth) = (&blocks[at].name, blocks[..at].iter().filter(|b| b.name == blocks[at].name).count());
            let mut kv =
                kv3::read(resource::data(&out, name, nth).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let Value::Object(members) = &mut kv.root.value else { return Ok(None) };
            let old = members.get("m_hitboxsets").map(|s| s.items().to_vec()).unwrap_or_default();
            let have: HashSet<String> = old.iter().map(|s| text(s.get("key")).to_lowercase()).collect();
            let mut sets = old;
            sets.extend(names.iter().filter(|n| !have.contains(&n.to_lowercase())).map(|n| hitbox_set(n, &boxes)));
            members.insert("m_hitboxsets".into(), typed(sets, 9));
            out = resource::replace(&out, name, nth, &kv3::write(&kv).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        flagged(&out, &boxes).map(Some)
    };
    run().ok().flatten()
}
