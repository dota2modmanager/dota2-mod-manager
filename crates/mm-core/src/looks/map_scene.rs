//! The whole map in 3D for the Optimization window: the map's world exported once per game build
//! by the Source 2 toolchain (model_glb.rs runs it), then made light enough for a window to hold.
//!
//! The toolchain's export of maps/dota.vpk's world is ~160 MB of geometry with ~500 pictures
//! beside it (normal maps, masks, every texture at full size). The window needs the shapes, their
//! colours and which material each part wears, so the light copy keeps each primitive's position,
//! normal and first UV, each material's colour picture shrunk to `max_px`, and the material's own
//! path (the toolchain writes it in the material's extras), which is how the window knows what a
//! group takes away. Skins, animations, tangents, the other UVs and every other picture go. The
//! pictures go inside the GLB, so the window loads one file.
//!
//! The light copy goes to the window as raw bytes (decor:map): an answer that is bytes alone leaves
//! the shell without a JSON or base64 pass on the page's side (src-tauri/src/main.rs answer).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{json, Map, Value};

use crate::glb_embed::{read_glb, write_glb};
use crate::png_paint::{decode_rgba, encode_rgba};

/// The light copy's file in the cache; its number goes up when what goes into it changes, so a
/// copy made the old way is made again (2: tints, water, EXT_meshopt_compression; 3: terrain layers;
/// 4: the layers' blend softness and tint masks; 5: each copy's tint; 6: the clouds' picture;
/// 7: the swaying materials' wind masks and noise).
pub const LIGHT_FILE: &str = "world-7.glb";

/// The toolchain's arguments for the world of `map_vpk` into `out` (a .glb), with its materials.
pub fn export_args(map_vpk: &str, out: &str) -> Vec<String> {
    [
        "-i",
        map_vpk,
        "-f",
        "maps/dota/world.vwrld_c",
        "-o",
        out,
        "-d",
        "--gltf_export_format",
        "glb",
        "--gltf_export_materials",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// RGBA halved (2x2 averaged) until neither side is over `max`.
pub fn shrink(mut rgba: Vec<u8>, mut w: u32, mut h: u32, max: u32) -> (Vec<u8>, u32, u32) {
    while w > max || h > max {
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let mut sum = 0u32;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let sx = (x * 2 + dx).min(w - 1);
                        let sy = (y * 2 + dy).min(h - 1);
                        sum += rgba[((sy * w + sx) * 4 + c) as usize] as u32;
                    }
                    out[((y * nw + x) * 4 + c) as usize] = (sum / 4) as u8;
                }
            }
        }
        rgba = out;
        w = nw;
        h = nh;
    }
    (rgba, w, h)
}

/// The tint the game lays over a material's grey colour picture (`image`, as the export names it):
/// the `g_vColorTint` that goes with whichever `g_tColor` the picture is (a terrain blend has four,
/// numbered), as a linear factor. None for a material with no tint, or a white one.
pub fn tint_of(material: &Value, image: &str) -> Option<[f64; 3]> {
    let vmat = material.pointer("/extras/vmat")?;
    let stem = |p: &str| p.rsplit('/').next().unwrap_or(p).to_lowercase();
    let image = stem(image);
    let suffix = vmat
        .get("TextureParams")
        .and_then(Value::as_object)
        .and_then(|t| {
            t.iter().find_map(|(k, v)| {
                let n = k.strip_prefix("g_tColor")?;
                (v.as_str().map(stem).as_deref() == Some(image.as_str())).then(|| n.to_string())
            })
        })
        .unwrap_or_default();
    let v = vmat.get("VectorParams")?.get(format!("g_vColorTint{suffix}"))?.as_array()?;
    let c: Vec<f64> = v.iter().take(3).filter_map(Value::as_f64).collect();
    if c.len() < 3 || c.iter().all(|x| (x - 1.0).abs() < 1e-3) {
        return None;
    }
    // the material's numbers are colours as picked (sRGB); glTF multiplies in linear light
    let lin = |x: f64| if x <= 0.04045 { x / 12.92 } else { ((x + 0.055) / 1.055).powf(2.4) };
    Some([lin(c[0]), lin(c[1]), lin(c[2])])
}

/// A terrain blend's colour layers (multiblend.vfx: up to four, g_tColor0..3), each as the texture
/// of the export that holds its picture, its tint as a linear factor and its UV scale. Empty for a
/// material that is no blend, or one whose pictures the export left out.
pub fn blend_layers(material: &Value, textures: &[Value], images: &[Value]) -> Vec<(usize, [f64; 3], f64)> {
    let Some(vmat) = material.pointer("/extras/vmat") else { return vec![] };
    if !vmat.get("ShaderName").and_then(Value::as_str).unwrap_or("").contains("multiblend") {
        return vec![];
    }
    let stem = |p: &str| p.rsplit('/').next().unwrap_or(p).to_lowercase();
    let texture_of = |vtex: &str| -> Option<usize> {
        let want = stem(vtex);
        textures.iter().position(|t| {
            t.get("source")
                .and_then(idx)
                .and_then(|i| images.get(i))
                .and_then(|i| i.get("name"))
                .and_then(Value::as_str)
                .is_some_and(|n| stem(n) == want)
        })
    };
    let lin = |x: f64| if x <= 0.04045 { x / 12.92 } else { ((x + 0.055) / 1.055).powf(2.4) };
    let mut out = Vec::new();
    for k in 0..4 {
        let Some(vtex) = vmat.pointer(&format!("/TextureParams/g_tColor{k}")).and_then(Value::as_str) else { break };
        let Some(t) = texture_of(vtex) else { return vec![] };
        let tint = vmat
            .pointer(&format!("/VectorParams/g_vColorTint{k}"))
            .and_then(Value::as_array)
            .map(|v| v.iter().take(3).filter_map(Value::as_f64).collect::<Vec<_>>())
            .filter(|v| v.len() == 3)
            .map_or([1.0; 3], |v| [lin(v[0]), lin(v[1]), lin(v[2])]);
        let scale = vmat.pointer(&format!("/FloatParams/g_flTexCoordScale{k}")).and_then(Value::as_f64).unwrap_or(1.0);
        out.push((t, tint, scale));
    }
    out
}

/// A terrain blend's tint mask (multiblend.vfx g_tTintMasks under F_TINT_MASK): the texture of the
/// export whose channel k picks, per pixel, between layer k's two tints (g_vColorTintB{k} at 0,
/// g_vColorTint{k} at 1). None for a blend without one, or one the export left out.
pub fn tint_mask(material: &Value, textures: &[Value], images: &[Value]) -> Option<usize> {
    let vmat = material.pointer("/extras/vmat")?;
    if vmat.pointer("/IntParams/F_TINT_MASK").and_then(Value::as_i64) != Some(1) {
        return None;
    }
    let vtex = vmat.pointer("/TextureParams/g_tTintMasks").and_then(Value::as_str)?;
    let stem = |p: &str| p.rsplit('/').next().unwrap_or(p).to_lowercase();
    let want = stem(vtex);
    textures.iter().position(|t| {
        t.get("source")
            .and_then(idx)
            .and_then(|i| images.get(i))
            .and_then(|i| i.get("name"))
            .and_then(Value::as_str)
            .is_some_and(|n| stem(n) == want)
    })
}

/// The export's texture whose picture is this vtex (matched by file name), if the export kept it.
fn texture_named(vtex: &str, textures: &[Value], images: &[Value]) -> Option<usize> {
    let stem = |p: &str| p.rsplit('/').next().unwrap_or(p).to_lowercase();
    let want = stem(vtex);
    textures.iter().position(|t| {
        t.get("source")
            .and_then(idx)
            .and_then(|i| images.get(i))
            .and_then(|i| i.get("name"))
            .and_then(Value::as_str)
            .is_some_and(|n| stem(n) == want)
    })
}

/// A swaying material's wind pictures (global_lit_simple.vfx under F_ENABLE_WIND): the mask whose
/// red and green say how much of the slow and the quick sway each part takes (a trunk none, the
/// leaves all), and the two-channel noise the sway is varied by. Each is the texture of the export
/// that holds it, or None where the export left it out; None for a material that does not sway.
pub fn wind_pictures(material: &Value, textures: &[Value], images: &[Value]) -> Option<(Option<usize>, Option<usize>)> {
    let vmat = material.pointer("/extras/vmat")?;
    if vmat.pointer("/IntParams/F_ENABLE_WIND").and_then(Value::as_i64) != Some(1) {
        return None;
    }
    let of = |k: &str| {
        vmat.pointer(&format!("/TextureParams/{k}")).and_then(Value::as_str).and_then(|v| texture_named(v, textures, images))
    };
    Some((of("g_tWindMask"), of("g_tWindNoise")))
}

/// A span of a view's bytes one accessor reads: view, offset, length, what it holds, its stride.
type SpanKey = (usize, usize, u64, String, usize);

fn arr(v: &Value, k: &str) -> Vec<Value> {
    v.get(k).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn idx(v: &Value) -> Option<usize> {
    v.as_u64().map(|n| n as usize)
}

/// The light copy of an exported world: `json` and `bin` of the toolchain's GLB, `picture` reading
/// an image's file by its uri (beside the GLB). The picture of the map's clouds (a PNG), if given,
/// goes inside as a texture of its own, named in the file's extras (`clouds`): map-light.ts casts
/// their shadows over the ground with it.
pub fn slim_glb(
    json: &Value,
    bin: &[u8],
    picture: &dyn Fn(&str) -> Option<Vec<u8>>,
    max_px: u32,
    clouds: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    const KEEP: [&str; 3] = ["POSITION", "NORMAL", "TEXCOORD_0"];
    // a terrain blend's layer weights, how soft each layer's edge is and its painted tint:
    // without them the paths are gone
    const KEEP_BLEND: [&str; 3] = ["_TEXCOORD_1", "_TEXCOORD_2", "_TEXCOORD_3"];
    let accessors = arr(json, "accessors");
    let views = arr(json, "bufferViews");
    let textures = arr(json, "textures");
    let images = arr(json, "images");

    // the materials with their colour picture alone, and the textures that picture is
    let mut used_tex: BTreeSet<usize> = BTreeSet::new();
    let mut materials = arr(json, "materials");
    // a terrain blend's four layers: (texture, tint, scale) each, by the material's number
    let mut layers_of: BTreeMap<usize, Vec<(usize, [f64; 3], f64)>> = BTreeMap::new();
    // and its tint mask, by the material's number
    let mut masks_of: BTreeMap<usize, usize> = BTreeMap::new();
    // a swaying material's wind mask and noise, by the material's number
    let mut winds_of: BTreeMap<usize, (Option<usize>, Option<usize>)> = BTreeMap::new();
    for (mi, m) in materials.iter_mut().enumerate() {
        if let Some((mask, noise)) = wind_pictures(m, &textures, &images) {
            used_tex.extend(mask.iter().chain(noise.iter()));
            winds_of.insert(mi, (mask, noise));
        }
        let layers = blend_layers(m, &textures, &images);
        if !layers.is_empty() {
            used_tex.extend(layers.iter().map(|l| l.0));
            layers_of.insert(mi, layers);
            if let Some(t) = tint_mask(m, &textures, &images) {
                used_tex.insert(t);
                masks_of.insert(mi, t);
            }
        }
        let mut out = Map::new();
        for k in ["name", "extras", "alphaMode", "alphaCutoff", "doubleSided"] {
            if let Some(v) = m.get(k) {
                out.insert(k.into(), v.clone());
            }
        }
        let mut pbr = Map::new();
        if let Some(f) = m.pointer("/pbrMetallicRoughness/baseColorFactor") {
            pbr.insert("baseColorFactor".into(), f.clone());
        }
        let base = m.pointer("/pbrMetallicRoughness/baseColorTexture/index").and_then(idx);
        let image = base
            .and_then(|t| textures.get(t))
            .and_then(|t| t.get("source"))
            .and_then(idx)
            .and_then(|i| images.get(i))
            .and_then(|i| i.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if let Some(t) = tint_of(m, image) {
            pbr.insert("baseColorFactor".into(), json!([t[0], t[1], t[2], 1]));
        }
        // the game draws water with a shader of its own and no colour picture: give it the river's colour
        let shader = m.pointer("/extras/vmat/ShaderName").and_then(Value::as_str).unwrap_or("");
        if base.is_none() && shader.contains("water") {
            pbr.insert("baseColorFactor".into(), json!([0.035, 0.12, 0.16, 0.8]));
            out.insert("alphaMode".into(), json!("BLEND"));
        }
        if let Some(t) = m.pointer("/pbrMetallicRoughness/baseColorTexture/index").and_then(idx) {
            used_tex.insert(t);
            pbr.insert("baseColorTexture".into(), json!({ "index": t }));
        }
        pbr.insert("metallicFactor".into(), json!(0));
        pbr.insert("roughnessFactor".into(), json!(1));
        out.insert("pbrMetallicRoughness".into(), Value::Object(pbr));
        *m = Value::Object(out);
    }

    // the accessors the kept attributes and the indices use
    let mut meshes = arr(json, "meshes");
    let mut used_acc: BTreeSet<usize> = BTreeSet::new();
    let mut index_acc: BTreeSet<usize> = BTreeSet::new();
    for mesh in meshes.iter_mut() {
        let Some(prims) = mesh.get_mut("primitives").and_then(Value::as_array_mut) else { continue };
        for p in prims.iter_mut() {
            let blend = p.get("material").and_then(idx).is_some_and(|m| layers_of.contains_key(&m));
            if let Some(a) = p.get_mut("attributes").and_then(Value::as_object_mut) {
                a.retain(|k, _| KEEP.contains(&k.as_str()) || (blend && KEEP_BLEND.contains(&k.as_str())));
                used_acc.extend(a.values().filter_map(idx));
            }
            if let Some(i) = p.get("indices").and_then(idx) {
                used_acc.insert(i);
                index_acc.insert(i);
            }
            if let Some(o) = p.as_object_mut() {
                o.remove("targets");
            }
        }
    }

    let mut out_bin: Vec<u8> = Vec::new();
    let mut out_views: Vec<Value> = Vec::new();
    let mut push_view = |data: &[u8], target: Option<&Value>, stride: Option<&Value>| -> usize {
        while !out_bin.len().is_multiple_of(4) {
            out_bin.push(0);
        }
        let mut v = json!({ "buffer": 0, "byteOffset": out_bin.len(), "byteLength": data.len() });
        if let Some(t) = target {
            v["target"] = t.clone();
        }
        if let Some(t) = stride {
            v["byteStride"] = t.clone();
        }
        out_bin.extend_from_slice(data);
        out_views.push(v);
        out_views.len() - 1
    };

    // The toolchain writes a mesh's vertices interleaved (position, normal, tangent, four UVs) in
    // one view many accessors point into. Each accessor kept is taken out on its own and packed
    // tight, once per span of the same data, so the tangents and the other UVs stay behind.
    let mut span_map: BTreeMap<SpanKey, (usize, bool)> = BTreeMap::new();
    let mut acc_map: BTreeMap<usize, usize> = BTreeMap::new();
    let mut out_acc: Vec<Value> = Vec::new();
    for a in &used_acc {
        let Some(acc) = accessors.get(*a) else { return Err(format!("map: no accessor {a}")) };
        let ty = acc.get("type").and_then(Value::as_str).unwrap_or("SCALAR").to_string();
        let comp = acc.get("componentType").and_then(Value::as_u64).unwrap_or(5126);
        let count = acc.get("count").and_then(idx).unwrap_or(0);
        let (Some(v), true) = (acc.get("bufferView").and_then(idx), acc.get("sparse").is_none()) else {
            acc_map.insert(*a, out_acc.len());
            out_acc.push(acc.clone());
            continue;
        };
        let at = acc.get("byteOffset").and_then(idx).unwrap_or(0);
        let key = (v, at, comp, ty.clone(), count);
        let n = match span_map.get(&key) {
            Some(n) => *n,
            None => {
                let parts = match ty.as_str() {
                    "VEC2" => 2,
                    "VEC3" => 3,
                    "VEC4" | "MAT2" => 4,
                    "MAT3" => 9,
                    "MAT4" => 16,
                    _ => 1,
                };
                let width = match comp {
                    5120 | 5121 => 1,
                    5122 | 5123 => 2,
                    _ => 4,
                };
                let elem = parts * width;
                let view = views.get(v).ok_or_else(|| format!("map: no buffer view {v}"))?;
                let off = view.get("byteOffset").and_then(idx).unwrap_or(0);
                let stride = view.get("byteStride").and_then(idx).filter(|s| *s > 0).unwrap_or(elem);
                let mut data = Vec::with_capacity(count * elem);
                for i in 0..count {
                    let s = off + at + i * stride;
                    data.extend_from_slice(bin.get(s..s + elem).ok_or("map: an accessor past the end")?);
                }
                // 32-bit indices that all fit in 16 bits take half the room
                let narrow = comp == 5125
                    && index_acc.contains(a)
                    && data.as_chunks::<4>().0.iter().all(|c| u32::from_le_bytes(*c) < 65536);
                if narrow {
                    data = data.as_chunks::<4>().0.iter().flat_map(|c| [c[0], c[1]]).collect();
                }
                let n = push_view(&data, view.get("target"), None);
                span_map.insert(key, (n, narrow));
                (n, narrow)
            }
        };
        let (n, narrow) = n;
        let mut acc = acc.clone();
        acc["bufferView"] = json!(n);
        if narrow {
            acc["componentType"] = json!(5123);
        }
        if let Some(o) = acc.as_object_mut() {
            o.remove("byteOffset");
        }
        acc_map.insert(*a, out_acc.len());
        out_acc.push(acc);
    }
    for mesh in meshes.iter_mut() {
        let Some(prims) = mesh.get_mut("primitives").and_then(Value::as_array_mut) else { continue };
        for p in prims.iter_mut() {
            if let Some(a) = p.get_mut("attributes").and_then(Value::as_object_mut) {
                for v in a.values_mut() {
                    if let Some(n) = idx(v).and_then(|i| acc_map.get(&i)) {
                        *v = json!(n);
                    }
                }
            }
            if let Some(n) = p.get("indices").and_then(idx).and_then(|i| acc_map.get(&i)) {
                p["indices"] = json!(n);
            }
        }
    }

    // the colour pictures, shrunk, inside the file; a picture that will not read is left out
    let mut tex_map: BTreeMap<usize, usize> = BTreeMap::new();
    let mut img_map: BTreeMap<usize, usize> = BTreeMap::new();
    let mut out_tex: Vec<Value> = Vec::new();
    let mut out_img: Vec<Value> = Vec::new();
    for t in &used_tex {
        let Some(src) = textures.get(*t).and_then(|x| x.get("source")).and_then(idx) else { continue };
        let ni = match img_map.get(&src) {
            Some(n) => *n,
            None => {
                let uri = images.get(src).and_then(|i| i.get("uri")).and_then(Value::as_str).unwrap_or("");
                let Some(png) = picture(uri) else { continue };
                let Ok((rgba, w, h)) = decode_rgba(&png) else { continue };
                let (rgba, w, h) = shrink(rgba, w, h, max_px);
                let small = encode_rgba(&rgba, w, h)?;
                let v = push_view(&small, None, None);
                out_img.push(json!({ "bufferView": v, "mimeType": "image/png" }));
                img_map.insert(src, out_img.len() - 1);
                out_img.len() - 1
            }
        };
        tex_map.insert(*t, out_tex.len());
        out_tex.push(json!({ "source": ni, "sampler": 0 }));
    }
    for (mi, layers) in &layers_of {
        let list: Vec<Value> = layers
            .iter()
            .filter_map(|(t, tint, scale)| {
                tex_map.get(t).map(|n| json!({ "texture": n, "tint": tint, "scale": scale }))
            })
            .collect();
        if list.len() == layers.len() {
            if let Some(e) = materials[*mi].get_mut("extras").and_then(Value::as_object_mut) {
                e.insert("layers".into(), json!(list));
                if let Some(n) = masks_of.get(mi).and_then(|t| tex_map.get(t)) {
                    e.insert("tintMask".into(), json!(n));
                }
            }
        }
    }
    for (mi, (mask, noise)) in &winds_of {
        if let Some(e) = materials[*mi].get_mut("extras").and_then(Value::as_object_mut) {
            if let Some(n) = mask.and_then(|t| tex_map.get(&t)) {
                e.insert("windMask".into(), json!(n));
            }
            if let Some(n) = noise.and_then(|t| tex_map.get(&t)) {
                e.insert("windNoise".into(), json!(n));
            }
        }
    }
    for m in materials.iter_mut() {
        let t = m.pointer("/pbrMetallicRoughness/baseColorTexture/index").and_then(idx);
        match t.and_then(|t| tex_map.get(&t)) {
            Some(n) => m["pbrMetallicRoughness"]["baseColorTexture"] = json!({ "index": n }),
            None => {
                if let Some(p) = m.get_mut("pbrMetallicRoughness").and_then(Value::as_object_mut) {
                    p.remove("baseColorTexture");
                }
            }
        }
    }

    let mut nodes = arr(json, "nodes");
    for n in nodes.iter_mut() {
        if let Some(o) = n.as_object_mut() {
            o.remove("skin");
        }
    }
    let mut extras = Map::new();
    if let Some(png) = clouds {
        let v = push_view(png, None, None);
        out_img.push(json!({ "bufferView": v, "mimeType": "image/png" }));
        out_tex.push(json!({ "source": out_img.len() - 1, "sampler": 0 }));
        extras.insert("clouds".into(), json!(out_tex.len() - 1));
    }
    let mut out = json!({
        "asset": { "version": "2.0", "generator": "dota2-mod-manager map_scene" },
        "scene": json.get("scene").cloned().unwrap_or(json!(0)),
        "scenes": arr(json, "scenes"),
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": out_acc,
        "bufferViews": out_views,
        "buffers": [{ "byteLength": out_bin.len() }],
    });
    if !extras.is_empty() {
        out["extras"] = Value::Object(extras);
    }
    if !out_tex.is_empty() {
        out["textures"] = json!(out_tex);
        out["images"] = json!(out_img);
        out["samplers"] = json!([{ "magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497 }]);
    }
    let (out, bin) = meshopt_compress(out, out_bin)?;
    Ok(write_glb(&out, &bin))
}

/// The geometry squeezed with EXT_meshopt_compression, which three.js's MeshoptDecoder reads: each
/// vertex attribute's view in meshoptimizer's vertex codec, each index view in its triangle codec
/// (meshopt.rs). About 102 MB of the map's geometry and pictures come to about 60. A view the codecs
/// cannot take (a vertex not a multiple of 4 bytes) and the pictures stay as they are. The views
/// keep their size in a fallback buffer with no bytes, as the extension has it.
pub fn meshopt_compress(mut json: Value, bin: Vec<u8>) -> Result<(Value, Vec<u8>), String> {
    let accessors = arr(&json, "accessors");
    // each view's use: (indices?, element size, count)
    let mut uses: BTreeMap<usize, (bool, usize, usize)> = BTreeMap::new();
    for mesh in arr(&json, "meshes") {
        for p in mesh.get("primitives").and_then(Value::as_array).cloned().unwrap_or_default() {
            let mut mark = |a: Option<usize>, indices: bool| {
                let Some(acc) = a.and_then(|a| accessors.get(a)) else { return };
                let Some(v) = acc.get("bufferView").and_then(idx) else { return };
                let parts = match acc.get("type").and_then(Value::as_str) {
                    Some("VEC2") => 2,
                    Some("VEC3") => 3,
                    Some("VEC4") => 4,
                    _ => 1,
                };
                let width = match acc.get("componentType").and_then(Value::as_u64) {
                    Some(5120 | 5121) => 1,
                    Some(5122 | 5123) => 2,
                    _ => 4,
                };
                let count = acc.get("count").and_then(idx).unwrap_or(0);
                uses.insert(v, (indices, parts * width, count));
            };
            let attrs: Vec<Value> = p
                .get("attributes")
                .and_then(Value::as_object)
                .map(|o| o.values().cloned().collect())
                .unwrap_or_default();
            for a in &attrs {
                mark(idx(a), false);
            }
            mark(p.get("indices").and_then(idx), true);
        }
    }
    let mut views = arr(&json, "bufferViews");
    let mut out: Vec<u8> = Vec::new();
    let mut fallback = 0usize;
    for (i, view) in views.iter_mut().enumerate() {
        let off = view.get("byteOffset").and_then(idx).unwrap_or(0);
        let len = view.get("byteLength").and_then(idx).unwrap_or(0);
        let data = bin.get(off..off + len).ok_or("map: a buffer view past the end")?;
        let packed = match uses.get(&i) {
            Some((true, width, count)) if (*width == 2 || *width == 4) && count % 3 == 0 && *count > 0 => {
                let list: Vec<u32> = if *width == 2 {
                    data.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c) as u32).collect()
                } else {
                    data.as_chunks::<4>().0.iter().map(|c| u32::from_le_bytes(*c)).collect()
                };
                Some((crate::meshopt::encode_index_buffer(&list)?, *width, *count, "TRIANGLES"))
            }
            Some((false, size, count)) if size % 4 == 0 && *size <= 256 && *count > 0 => {
                Some((crate::meshopt::encode_vertex_buffer_v0(data, *count, *size)?, *size, *count, "ATTRIBUTES"))
            }
            _ => None,
        };
        while !out.len().is_multiple_of(4) {
            out.push(0);
        }
        match packed {
            Some((bytes, stride, count, mode)) => {
                let at = out.len();
                out.extend_from_slice(&bytes);
                let mut v = json!({
                    "buffer": 1, "byteOffset": fallback, "byteLength": len,
                    "extensions": { "EXT_meshopt_compression": {
                        "buffer": 0, "byteOffset": at, "byteLength": bytes.len(),
                        "byteStride": stride, "count": count, "mode": mode } },
                });
                if mode == "ATTRIBUTES" {
                    v["byteStride"] = json!(stride);
                }
                if let Some(t) = view.get("target") {
                    v["target"] = t.clone();
                }
                fallback += len.div_ceil(4) * 4;
                *view = v;
            }
            None => {
                view["buffer"] = json!(0);
                view["byteOffset"] = json!(out.len());
                out.extend_from_slice(data);
            }
        }
    }
    json["bufferViews"] = json!(views);
    json["buffers"] = json!([
        { "byteLength": out.len() },
        { "byteLength": fallback, "extensions": { "EXT_meshopt_compression": { "fallback": true } } },
    ]);
    json["extensionsUsed"] = json!(["EXT_meshopt_compression"]);
    json["extensionsRequired"] = json!(["EXT_meshopt_compression"]);
    Ok((json, out))
}

/// The world node the map's static props are laid out in, inside the map's archive.
pub const WORLD_NODE: &str = "maps/dota/worldnodes/n0.vwnod_c";

/// A Source colour channel (0-1, sRGB) in linear light.
fn to_linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Each copy's tint by the name the export gives its node, in the order the copies come: the map
/// paints one rock model in a dozen greys and greens, one per copy, in its world node
/// (`m_sceneObjects[].m_vTintColor`, 0-1, and each fragment of an aggregate,
/// `m_aggregateSceneObjects[].m_aggregateMeshes[].m_vTintColor`, 0-255), and the export drops it.
/// A node is named after its model's file (`n0_lr0_agg_prop_cliff_wall001_0`, one per fragment),
/// a scene object's after its model and mesh set (`..._overlay0.meshset_0`). The colour's alpha is
/// how strongly it tints; the tints come linear, white mixed in by that.
pub fn instance_tints(vwnod: &[u8]) -> BTreeMap<String, Vec<[f64; 3]>> {
    let mut out: BTreeMap<String, Vec<[f64; 3]>> = BTreeMap::new();
    let Ok(data) = crate::resource::data(vwnod, "DATA", 0) else { return out };
    let Ok(kv) = crate::kv3::read(data) else { return out };
    let stem = |n: &crate::kv3::Node| -> Option<String> {
        let path = n.get("m_renderableModel")?.as_str()?;
        let file = path.rsplit('/').next()?;
        Some(file.strip_suffix(".vmdl").unwrap_or(file).to_string())
    };
    let tint = |n: Option<&crate::kv3::Node>, scale: f64| -> [f64; 3] {
        let items = n.map(|n| n.items()).unwrap_or(&[]);
        let c = |i: usize| items.get(i).and_then(|x| kv.number_of(x)).map_or(1.0, |v| (v / scale).clamp(0.0, 1.0));
        // the fourth number is how much of the tint the copy takes (a temple stair's dark green at 48
        // of 255 leaves it a light grey), all of it where there is none
        let amount = c(3);
        [0, 1, 2].map(|i| 1.0 + (to_linear(c(i)) - 1.0) * amount)
    };
    for o in kv.root.get("m_sceneObjects").map(|n| n.items()).unwrap_or(&[]) {
        if let Some(s) = stem(o) {
            out.entry(s).or_default().push(tint(o.get("m_vTintColor"), 1.0));
        }
    }
    for o in kv.root.get("m_aggregateSceneObjects").map(|n| n.items()).unwrap_or(&[]) {
        let Some(s) = stem(o) else { continue };
        let list = out.entry(s).or_default();
        for m in o.get("m_aggregateMeshes").map(|n| n.items()).unwrap_or(&[]) {
            list.push(tint(m.get("m_vTintColor"), 255.0));
        }
    }
    out
}

/// The tints on the export's nodes, in their extras (`tint`), the k-th node of a name taking the
/// k-th tint of its model; white is left off.
pub fn tint_nodes(json: &mut Value, tints: &BTreeMap<String, Vec<[f64; 3]>>) {
    let Some(nodes) = json.get_mut("nodes").and_then(Value::as_array_mut) else { return };
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for n in nodes.iter_mut() {
        let Some(name) = n.get("name").and_then(Value::as_str).map(str::to_string) else { continue };
        let k = seen.entry(name.clone()).or_default();
        let at = *k;
        *k += 1;
        let model = name.split('.').next().unwrap_or(&name);
        let Some(t) = tints.get(model).and_then(|l| l.get(at)) else { continue };
        if t.iter().all(|c| *c >= 0.999) {
            continue;
        }
        let Some(o) = n.as_object_mut() else { continue };
        let extras = o.entry("extras").or_insert_with(|| json!({}));
        if let Some(e) = extras.as_object_mut() {
            e.insert("tint".into(), json!(t.map(|c| (c * 10000.0).round() / 10000.0)));
        }
    }
}

/// The light copy of the toolchain's GLB at `world`, its pictures read beside it, each copy of a
/// model in the tint `vwnod` (the map's world node) gives it.
pub fn slim(world: &Path, vwnod: Option<&[u8]>, clouds: Option<&[u8]>, max_px: u32) -> Result<Vec<u8>, String> {
    let buf = std::fs::read(world).map_err(|e| e.to_string())?;
    let (mut json, bin) = read_glb(&buf)?;
    if let Some(v) = vwnod {
        tint_nodes(&mut json, &instance_tints(v));
    }
    let dir = world.parent().map(Path::to_path_buf).unwrap_or_default();
    let picture = |uri: &str| -> Option<Vec<u8>> {
        let plain = crate::installer_downloads::decode_uri_component(uri)?;
        if plain.is_empty() || plain.contains("..") || plain.contains(':') {
            return None;
        }
        std::fs::read(dir.join(plain)).ok()
    };
    slim_glb(&json, &bin, &picture, max_px, clouds)
}

/// The clouds' picture (a PNG the toolchain wrote) at most 512 pixels across.
pub fn cloud_png(png: &[u8]) -> Option<Vec<u8>> {
    let (rgba, w, h) = decode_rgba(png).ok()?;
    let (rgba, w, h) = shrink(rgba, w, h, 512);
    encode_rgba(&rgba, w, h).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_copy_of_a_model_takes_its_own_tint() {
        let tints: BTreeMap<String, Vec<[f64; 3]>> = [
            ("n0_lr0_agg_rocks_0".to_string(), vec![[0.2, 0.3, 0.4], [1.0, 1.0, 1.0], [0.5, 0.5, 0.5]]),
            ("overlay0".to_string(), vec![[0.1, 0.1, 0.1]]),
        ]
        .into();
        let mut j = json!({ "nodes": [
            { "name": "n0_lr0_agg_rocks_0" }, { "name": "n0_lr0_agg_rocks_0" }, { "name": "overlay0.meshset_0" },
            { "name": "n0_lr0_agg_rocks_0", "extras": { "x": 1 } }, { "name": "dire_tree1.dire_tree1_model" } ] });
        tint_nodes(&mut j, &tints);
        assert_eq!(j["nodes"][0]["extras"]["tint"], json!([0.2, 0.3, 0.4]));
        assert!(j["nodes"][1].get("extras").is_none(), "white is left off");
        assert_eq!(j["nodes"][2]["extras"]["tint"], json!([0.1, 0.1, 0.1]), "a mesh set takes its object's tint");
        assert_eq!(
            j["nodes"][3]["extras"],
            json!({ "x": 1, "tint": [0.5, 0.5, 0.5] }),
            "the third copy, the third tint"
        );
        assert!(j["nodes"][4].get("extras").is_none());
        assert!((to_linear(115.0 / 255.0) - 0.171).abs() < 0.001);
    }

    #[test]
    fn a_grey_picture_takes_the_tint_of_its_layer() {
        let m = json!({ "extras": { "vmat": {
            "TextureParams": { "g_tColor0": "materials/nature/sand_color.vtex", "g_tColor1": "materials/nature/grass_color.vtex" },
            "VectorParams": { "g_vColorTint0": [1, 1, 1, 0], "g_vColorTint1": [0.5, 1, 0, 1] } } } });
        let t = tint_of(&m, "grass_color.vtex").unwrap();
        assert!((t[0] - 0.214).abs() < 0.01 && (t[1] - 1.0).abs() < 1e-9 && t[2] == 0.0);
        assert_eq!(tint_of(&m, "sand_color.vtex"), None, "white is no tint");
        let plain = json!({ "extras": { "vmat": { "TextureParams": { "g_tColor": "a/rock.vtex" }, "VectorParams": { "g_vColorTint": [0.2, 0.2, 0.2, 0] } } } });
        assert!(tint_of(&plain, "rock.vtex").is_some());
        assert_eq!(tint_of(&json!({}), "x"), None);
    }

    #[test]
    fn a_picture_is_halved_until_it_fits() {
        let px = vec![255u8; 8 * 4 * 4];
        let (out, w, h) = shrink(px, 8, 4, 3);
        assert_eq!((w, h), (2, 1));
        assert_eq!(out.len(), 2 * 4);
        assert!(out.iter().all(|&b| b == 255));
        let (same, w, h) = shrink(vec![1, 2, 3, 4], 1, 1, 256);
        assert_eq!((same, w, h), (vec![1, 2, 3, 4], 1, 1));
    }

    #[test]
    fn a_blend_with_a_tint_mask_names_its_texture() {
        let textures = vec![json!({ "source": 0 }), json!({ "source": 1 })];
        let images =
            vec![json!({ "name": "sand_color_psd_1.vtex" }), json!({ "name": "sand_path002_mask_psd_52b589c0.vtex" })];
        let m = |on: i64| {
            json!({ "extras": { "vmat": { "IntParams": { "F_TINT_MASK": on },
                "TextureParams": { "g_tTintMasks": "materials/sand_path002_mask_psd_52b589c0.vtex" } } } })
        };
        assert_eq!(tint_mask(&m(1), &textures, &images), Some(1));
        assert_eq!(tint_mask(&m(0), &textures, &images), None, "the mask is read only where the blend uses it");
    }

    #[test]
    fn a_swaying_material_names_its_wind_mask_and_noise() {
        let textures = vec![json!({ "source": 0 }), json!({ "source": 1 })];
        let images = vec![
            json!({ "name": "armandpine_mask_psd_53929b27.vtex" }),
            json!({ "name": "two_channel_noise_psd_93f8d443.vtex" }),
        ];
        let m = |on: i64| {
            json!({ "extras": { "vmat": { "IntParams": { "F_ENABLE_WIND": on }, "TextureParams": {
                "g_tWindMask": "materials/models/props_tree/armandpine/armandpine_mask_psd_53929b27.vtex",
                "g_tWindNoise": "materials/dev/two_channel_noise_psd_93f8d443.vtex" } } } })
        };
        assert_eq!(wind_pictures(&m(1), &textures, &images), Some((Some(0), Some(1))));
        assert_eq!(wind_pictures(&m(0), &textures, &images), None, "a material that does not sway has none");
        assert_eq!(wind_pictures(&m(1), &textures[..1], &images), Some((Some(0), None)), "a picture the export left out is none");
    }

    #[test]
    fn the_light_copy_keeps_shapes_and_colour_and_drops_the_rest() {
        // one triangle: positions (accessor 0), tangents (1), indices (2); a material with a colour and a normal picture
        let mut bin = Vec::new();
        for f in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
            bin.extend_from_slice(&f.to_le_bytes());
        }
        for f in [1f32; 12] {
            bin.extend_from_slice(&f.to_le_bytes());
        }
        for i in [0u16, 1, 2, 0] {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        let json = json!({
            "scene": 0, "scenes": [{ "nodes": [0] }], "nodes": [{ "mesh": 0, "skin": 0 }], "skins": [{}],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0, "TANGENT": 1 }, "indices": 2, "material": 0 }] }],
            "materials": [{ "name": "grass", "extras": { "vmat": { "Name": "materials/nature/card_grass.vmat" } },
                "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "metallicRoughnessTexture": { "index": 1 } },
                "normalTexture": { "index": 1 } }],
            "textures": [{ "source": 0, "sampler": 0 }, { "source": 1, "sampler": 0 }],
            "images": [{ "uri": "color.png" }, { "uri": "normal.png" }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
                { "bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC4" },
                { "bufferView": 2, "componentType": 5123, "count": 3, "type": "SCALAR" },
            ],
            "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 36 },
                { "buffer": 0, "byteOffset": 36, "byteLength": 48 },
                { "buffer": 0, "byteOffset": 84, "byteLength": 8 },
            ],
            "buffers": [{ "byteLength": 92 }],
        });
        let color = encode_rgba(&[10u8; 4 * 4 * 4], 4, 4).unwrap();
        let asked = std::cell::RefCell::new(Vec::new());
        let picture = |u: &str| {
            asked.borrow_mut().push(u.to_string());
            (u == "color.png").then(|| color.clone())
        };
        let out = slim_glb(&json, &bin, &picture, 2, None).unwrap();
        let (j, b) = read_glb(&out).unwrap();
        let prim = &j["meshes"][0]["primitives"][0];
        assert_eq!(prim["attributes"].as_object().unwrap().keys().collect::<Vec<_>>(), vec!["POSITION"]);
        assert_eq!(j["accessors"].as_array().unwrap().len(), 2, "the tangents' accessor is gone");
        assert!(j["nodes"][0].get("skin").is_none() && j.get("skins").is_none());
        assert_eq!(j["materials"][0]["extras"]["vmat"]["Name"], "materials/nature/card_grass.vmat");
        assert!(j["materials"][0].get("normalTexture").is_none());
        assert_eq!(j["images"].as_array().unwrap().len(), 1);
        assert_eq!(*asked.borrow(), vec!["color.png".to_string()], "only the colour picture is read");
        // the positions came across byte for byte
        let pos = &j["bufferViews"][j["accessors"][prim["attributes"]["POSITION"].as_u64().unwrap() as usize]
            ["bufferView"]
            .as_u64()
            .unwrap() as usize];
        let m = &pos["extensions"]["EXT_meshopt_compression"];
        assert_eq!(m["mode"], "ATTRIBUTES");
        let (off, len) = (m["byteOffset"].as_u64().unwrap() as usize, m["byteLength"].as_u64().unwrap() as usize);
        let back = crate::meshopt::decode_vertex_buffer(3, 12, &b[off..off + len]).unwrap();
        assert_eq!(&back[..], &bin[..36]);
        assert_eq!(j["extensionsRequired"][0], "EXT_meshopt_compression");
        // the triangle came through its codec as the same three indices
        let iv = &j["bufferViews"]
            [j["accessors"][prim["indices"].as_u64().unwrap() as usize]["bufferView"].as_u64().unwrap() as usize];
        assert_eq!(iv["extensions"]["EXT_meshopt_compression"]["mode"], "TRIANGLES");
    }
}

#[cfg(test)]
mod real {
    /// The toolchain's export of the real map made light, when one is at MM_TEST_WORLD.
    #[test]
    fn the_real_world_comes_out_light() {
        let Ok(p) = std::env::var("MM_TEST_WORLD") else { return };
        let t = std::time::Instant::now();
        let out = super::slim(std::path::Path::new(&p), None, None, 256).expect("slim");
        eprintln!("light copy: {:.1} MB in {:?}", out.len() as f64 / 1e6, t.elapsed());
        if let Ok(to) = std::env::var("MM_TEST_WORLD_OUT") {
            std::fs::write(to, &out).unwrap();
        }
    }
}
