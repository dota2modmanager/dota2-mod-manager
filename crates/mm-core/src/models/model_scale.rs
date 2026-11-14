//! A compiled model made bigger about its origin, and how much bigger one model is than another;
//! replacing src/model-scale.ts, which says why a persona's items need it.
//!
//! Scaled: the vertices' positions, the translation of each bone's inverse bind pose, the
//! skeleton's bone positions, and the bounds, hitboxes and attachment offsets. A meshopt-compressed
//! vertex buffer is decoded, scaled and encoded again in version 0, as the TypeScript's
//! `meshoptimizer` WebAssembly encodes it. Not scaled: the item's own animations, physics, morphs.

use crate::kv3::{self, Block, Node, Value};
use crate::meshopt::{decode_vertex_buffer, encode_vertex_buffer_v0};
use crate::resource;
use crate::vpk::{entry_at, Entry};

/// Lengths in a model's blocks, by the key they are under: each number below one is scaled.
const LENGTHS: [&str; 13] = [
    "m_vMinBounds",
    "m_vMaxBounds",
    "m_vecCenter",
    "m_vecSize",
    "m_flSphereRadius",
    "m_vInfluenceOffsets",
    "m_bonePosParent",
    "m_boneSphere",
    "m_vHullMin",
    "m_vHullMax",
    "m_vViewMin",
    "m_vViewMax",
    "m_vEyePosition",
];

/// DXGI_FORMAT_R32G32B32_FLOAT, the only position format the personas' items have.
const FLOAT3: f64 = 6.0;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn num(kv: &Block, n: Option<&Node>) -> f64 {
    match n {
        Some(n @ Node { value: Value::Number { .. }, .. }) => kv.number_of(n).unwrap_or(f64::NAN),
        _ => -1.0,
    }
}

/// A KV3 boolean, which is stored as its type alone: 13 true.
fn truth(n: Option<&Node>) -> bool {
    matches!(n.map(|n| &n.value), Some(Value::Other { ty: 13, .. }))
}

fn scale_one(kv: &mut Block, n: &mut Node, s: f64) -> Result<(), String> {
    if let Some(v) = kv.number_of(n) {
        kv.set_number(n, v * s).map_err(err)?;
    }
    Ok(())
}

/// Every number under `n`, each times `s`; an inverse bind pose's translation alone (a 3x4 row-major matrix).
fn scale_numbers(kv: &mut Block, n: &mut Node, s: f64, all: bool) -> Result<(), String> {
    match &mut n.value {
        Value::Number { .. } => {
            if all {
                scale_one(kv, n, s)?;
            }
        }
        Value::Array { items, .. } => {
            for x in items {
                scale_numbers(kv, x, s, all)?;
            }
        }
        Value::Object(m) => {
            for (key, v) in m.iter_mut() {
                let pose =
                    key == "m_invBindPose" && matches!(&v.value, Value::Array { items, .. } if items.len() == 12);
                if pose {
                    let Value::Array { items, .. } = &mut v.value else { unreachable!() };
                    for i in [3, 7, 11] {
                        if matches!(items[i].value, Value::Number { .. }) {
                            scale_one(kv, &mut items[i], s)?;
                        }
                    }
                } else {
                    scale_numbers(kv, v, s, all || LENGTHS.contains(&key.as_str()))?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// A KV3 block of a model with its lengths times `s`.
fn scaled_kv3(data: &[u8], s: f64) -> Result<Vec<u8>, String> {
    let mut kv = kv3::read(data).map_err(err)?;
    let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Blob(0)));
    scale_numbers(&mut kv, &mut root, s, false)?;
    kv.root = root;
    kv.encode().map_err(err)
}

/// One vertex buffer's bytes with each position times `s`: float3 at `offset` in each `size`-byte vertex.
fn scaled_vertices(
    data: &[u8],
    count: usize,
    size: usize,
    offset: usize,
    compressed: bool,
    s: f64,
) -> Result<Vec<u8>, String> {
    let mut raw = if compressed {
        decode_vertex_buffer(count, size, data)?
    } else {
        let mut raw = vec![0u8; count * size];
        let n = data.len().min(raw.len());
        raw[..n].copy_from_slice(&data[..n]);
        raw
    };
    for v in 0..count {
        for c in 0..3 {
            let at = v * size + offset + 4 * c;
            let Some(b) = raw.get(at..at + 4) else { return Err("model-scale: a position past its vertex".into()) };
            let x = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            raw[at..at + 4].copy_from_slice(&((x as f64 * s) as f32).to_le_bytes());
        }
    }
    if compressed {
        encode_vertex_buffer_v0(&raw, count, size)
    } else {
        Ok(raw)
    }
}

fn u32_at(b: &[u8], at: usize) -> Result<usize, String> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize)
        .ok_or_else(|| "model-scale: a block cut short".into())
}

fn put_u32(b: &mut [u8], at: usize, v: usize) {
    b[at..at + 4].copy_from_slice(&(v as u32).to_le_bytes());
}

/// An MBUF (or VBIB) block with its vertex buffers' positions scaled: a header of where the vertex
/// and index buffer headers are, each 24 bytes, the attributes 56 bytes each. A compressed buffer
/// is one whose length is not count times size. The data after a buffer that grew moves, and every
/// offset that points past it with it.
fn scaled_vbib(block: &[u8], s: f64) -> Result<Vec<u8>, String> {
    let mut out = block.to_vec();
    let vb_at = u32_at(&out, 0)?;
    let data_fields = |out: &[u8]| -> Result<Vec<usize>, String> {
        let ib_at = 8 + u32_at(out, 8)?;
        let mut f = Vec::new();
        for (first, n) in [(vb_at, u32_at(out, 4)?), (ib_at, u32_at(out, 12)?)] {
            f.extend((0..n).map(|k| first + k * 24 + 16));
        }
        Ok(f)
    };
    let buffers = u32_at(&out, 4)?;
    for i in 0..buffers {
        let h = vb_at + i * 24;
        let count = u32_at(&out, h)?;
        let size = u32_at(&out, h + 4)? & 0x3ffffff;
        let attrs = h + 8 + u32_at(&out, h + 8)?;
        let mut position = None;
        for a in 0..u32_at(&out, h + 12)? {
            let at = attrs + a * 56;
            let name = out.get(at..at + 32).ok_or("model-scale: a block cut short")?;
            let name = &name[..name.iter().position(|&c| c == 0).unwrap_or(32)];
            if name != b"POSITION" {
                continue;
            }
            let format = u32_at(&out, at + 36)?;
            if format as f64 != FLOAT3 {
                return Err(format!("model-scale: positions in format {format}"));
            }
            position = Some(u32_at(&out, at + 40)?);
        }
        let Some(position) = position else { continue };
        let data_at = h + 16 + u32_at(&out, h + 16)?;
        let length = u32_at(&out, h + 20)?;
        let data = out.get(data_at..data_at + length).ok_or("model-scale: a block cut short")?;
        let next = scaled_vertices(data, count, size, position, length != count * size, s)?;
        // the room up to the data after this one, grown by a multiple of 16 where the bytes need more
        let mut later = Vec::new();
        for f in data_fields(&out)? {
            let to = f + u32_at(&out, f)?;
            if to > data_at {
                later.push(to);
            }
        }
        let gap = later.into_iter().min().unwrap_or(data_at + length) - data_at;
        let room = if next.len() <= gap { gap } else { gap + (next.len() - gap).div_ceil(16) * 16 };
        let mut grown = Vec::with_capacity(out.len() + room - gap);
        grown.extend_from_slice(&out[..data_at]);
        grown.extend_from_slice(&next);
        grown.resize(grown.len() + room - next.len(), 0);
        grown.extend_from_slice(out.get(data_at + gap..).unwrap_or(&[]));
        out = grown;
        put_u32(&mut out, h + 20, next.len());
        for f in data_fields(&out)? {
            let v = u32_at(&out, f)?;
            if f + v > data_at {
                put_u32(&mut out, f, v + room - gap);
            }
        }
    }
    Ok(out)
}

fn member<'a>(n: Option<&'a Node>, key: &str) -> Option<&'a Node> {
    n?.get(key)
}

fn items(n: Option<&Node>) -> &[Node] {
    n.map(Node::items).unwrap_or(&[])
}

enum Swap {
    Kv3,
    Vbib,
    Vertices { count: usize, size: usize, offset: usize, compressed: bool },
}

/// A compiled model (vmdl_c) `s` times bigger about its origin. Its meshes are named in CTRL: the
/// older models keep their buffers in one MBUF block per mesh (vbib_block), the newer in an MVTX
/// block per buffer with the layout in CTRL itself (m_vertexBuffers).
pub fn scale_model(file: &[u8], s: f64) -> Result<Vec<u8>, String> {
    if s == 1.0 {
        return Ok(file.to_vec());
    }
    let blocks = resource::blocks(file).map_err(err)?;
    let ctrl = kv3::read(resource::data(file, "CTRL", 0).map_err(err)?).map_err(err)?;
    let nth = |index: usize| blocks[..index].iter().filter(|b| b.name == blocks[index].name).count();
    let mut swaps: Vec<(f64, Swap)> = Vec::new();
    for mesh in items(member(Some(&ctrl.root), "embedded_meshes")) {
        let mesh = Some(mesh);
        let data = num(&ctrl, member(mesh, "m_nDataBlock").or_else(|| member(mesh, "data_block")));
        if data >= 0.0 {
            swaps.push((data, Swap::Kv3));
        }
        let vbib = num(&ctrl, member(mesh, "m_nVBIBBlock").or_else(|| member(mesh, "vbib_block")));
        if vbib >= 0.0 {
            swaps.push((vbib, Swap::Vbib));
            continue;
        }
        for vb in items(member(mesh, "m_vertexBuffers")) {
            let vb = Some(vb);
            if truth(member(vb, "m_bCompressedZSTD")) {
                return Err("model-scale: a zstd vertex buffer".into());
            }
            let pos = items(member(vb, "m_inputLayoutFields"))
                .iter()
                .find(|f| f.get("m_pSemanticName").and_then(Node::as_str) == Some("POSITION"));
            let Some(pos) = pos else { continue };
            let format = num(&ctrl, member(Some(pos), "m_Format"));
            if format != FLOAT3 {
                return Err(format!("model-scale: positions in format {}", crate::js::number(format)));
            }
            let count = num(&ctrl, member(vb, "m_nElementCount")) as usize;
            let size = num(&ctrl, member(vb, "m_nElementSizeInBytes")) as usize;
            let offset = num(&ctrl, member(Some(pos), "m_nOffset")) as usize;
            let compressed = truth(member(vb, "m_bMeshoptCompressed"));
            swaps.push((num(&ctrl, member(vb, "m_nBlockIndex")), Swap::Vertices { count, size, offset, compressed }));
        }
    }
    let mut out = file.to_vec();
    for (index, swap) in swaps {
        if index < 0.0 || index.fract() != 0.0 {
            return Err("model-scale: a mesh names a block the model has not".into());
        }
        let index = index as usize;
        let at = blocks.get(index).ok_or("model-scale: a mesh names a block the model has not")?;
        let k = nth(index);
        let data = resource::data(&out, &at.name, k).map_err(err)?;
        let next = match swap {
            Swap::Kv3 => scaled_kv3(data, s)?,
            Swap::Vbib => scaled_vbib(data, s)?,
            Swap::Vertices { count, size, offset, compressed } => {
                scaled_vertices(data, count, size, offset, compressed, s)?
            }
        };
        out = resource::replace(&out, &at.name, k, &next).map_err(err)?;
    }
    let data = scaled_kv3(resource::data_block(&out).map_err(err)?, s)?;
    resource::replace(&out, "DATA", 0, &data).map_err(err)
}

/// A model's bones by name, each with its distance from its parent, in the skeleton's order.
fn bone_lengths(file: &[u8]) -> Result<indexmap::IndexMap<String, f64>, String> {
    let kv = kv3::read(resource::data_block(file).map_err(err)?).map_err(err)?;
    let skeleton = member(Some(&kv.root), "m_modelSkeleton");
    let names = items(member(skeleton, "m_boneName"));
    let mut out = indexmap::IndexMap::new();
    for (i, p) in items(member(skeleton, "m_bonePosParent")).iter().enumerate() {
        let Some(name) = names.get(i).and_then(Node::as_str) else { continue };
        let xs: Vec<f64> = p.items().iter().map(|x| kv.number_of(x).unwrap_or(f64::NAN)).collect();
        out.insert(name.to_string(), crate::js::hypot(&xs));
    }
    Ok(out)
}

/// How much bigger `model` is than `reference`, from the bones they share: their total distance
/// from their parents, one over the other. None where they share no bone.
pub fn model_scale_against(model: &[u8], reference: &[u8]) -> Result<Option<f64>, String> {
    let mine = bone_lengths(model)?;
    let (mut a, mut b) = (0.0, 0.0);
    for (name, length) in bone_lengths(reference)? {
        if let Some(other) = mine.get(&name) {
            a += other;
            b += length;
        }
    }
    Ok((b > 1.0).then(|| a / b))
}

/// A pick's files with its models `scale` times bigger (a persona's items). A model that cannot be
/// is left at its own size, and `skipped` is told which and why.
pub fn scaled_models(entries: Vec<Entry>, scale: Option<f64>, skipped: &mut dyn FnMut(&str, &str)) -> Vec<Entry> {
    let Some(scale) = scale.filter(|&s| s != 0.0 && !s.is_nan()) else { return entries };
    entries
        .into_iter()
        .map(|e| {
            let p = e.path();
            if !p.to_lowercase().ends_with(".vmdl_c") {
                return e;
            }
            match scale_model(&e.data, scale) {
                Ok(f) => entry_at(&p, f.into()),
                Err(why) => {
                    skipped(&p, &why);
                    e
                }
            }
        })
        .collect()
}
