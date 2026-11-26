//! The light copy of the map (map_scene.rs): its tints, pictures and materials, on small made-up exports.

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
    assert_eq!(j["nodes"][3]["extras"], json!({ "x": 1, "tint": [0.5, 0.5, 0.5] }), "the third copy, the third tint");
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
    assert_eq!(
        wind_pictures(&m(1), &textures[..1], &images),
        Some((Some(0), None)),
        "a picture the export left out is none"
    );
}

#[test]
fn a_bumpy_prop_keeps_its_normal_picture() {
    let mut bin = Vec::new();
    for f in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    let json = json!({
        "scene": 0, "scenes": [{ "nodes": [0] }], "nodes": [{ "mesh": 0 }],
        "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }] }],
        "materials": [{ "extras": { "vmat": { "ShaderName": "global_lit_simple.vfx", "IntParams": { "F_NORMAL_MAP": 1 } } },
            "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } }, "normalTexture": { "index": 1 } }],
        "textures": [{ "source": 0, "sampler": 0 }, { "source": 1, "sampler": 0 }],
        "images": [{ "uri": "color.png" }, { "uri": "normal.png" }],
        "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" }],
        "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 36 }],
        "buffers": [{ "byteLength": 36 }],
    });
    let png = encode_rgba(&[128u8; 4 * 4 * 4], 4, 4).unwrap();
    let out = slim_glb(&json, &bin, &|_: &str| Some(png.clone()), 2, None).unwrap();
    let (j, _) = read_glb(&out).unwrap();
    let n = j["materials"][0]["normalTexture"]["index"].as_u64().expect("the normal picture is kept");
    assert_ne!(Some(n), j["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"].as_u64());
    assert_eq!(j["textures"].as_array().unwrap().len(), 2);
}

#[test]
fn a_prop_names_its_tint_mask_and_drops_the_exports_colour() {
    let mut bin = Vec::new();
    for f in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    let vmat = |mask: bool| {
        let mut v = json!({ "ShaderName": "global_lit_simple.vfx", "VectorParams": { "g_vColorTint": [0.5, 0.5, 0.5, 0] },
            "TextureParams": { "g_tColor": "color.vtex", "g_tTintMask": "mask.vtex" } });
        if mask {
            v["IntParams"] = json!({ "F_TINT_MASK": 1 });
        }
        v
    };
    let json = json!({
        "scene": 0, "scenes": [{ "nodes": [0] }], "nodes": [{ "mesh": 0 }],
        "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }, { "attributes": { "POSITION": 0 }, "material": 1 }, { "attributes": { "POSITION": 0 }, "material": 2 }, { "attributes": { "POSITION": 0 }, "material": 3 }] }],
        "materials": [
            { "extras": { "vmat": vmat(true) }, "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "baseColorFactor": [0.03, 0.05, 0.03, 1] } },
            { "extras": { "vmat": vmat(false) }, "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "baseColorFactor": [0.03, 0.05, 0.03, 1] } },
            { "extras": { "vmat": { "ShaderName": "global_lit_simple.vfx" } }, "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "baseColorFactor": [0.27, 0.3, 0.19, 1] } },
            { "extras": { "vmat": { "ShaderName": "global_lit_simple.vfx", "IntParams": { "F_OVERLAY": 1 } } }, "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 }, "baseColorFactor": [0.0032, 0.0049, 0.0032, 1] } }],
        "textures": [{ "source": 0, "sampler": 0 }, { "source": 1, "sampler": 0 }],
        "images": [{ "uri": "color.png", "name": "color.vtex" }, { "uri": "mask.png", "name": "mask.vtex" }],
        "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" }],
        "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 36 }],
        "buffers": [{ "byteLength": 36 }],
    });
    let png = encode_rgba(&[128u8; 4 * 4 * 4], 4, 4).unwrap();
    let out = slim_glb(&json, &bin, &|_: &str| Some(png.clone()), 2, None).unwrap();
    let (j, _) = read_glb(&out).unwrap();
    let masked = &j["materials"][0];
    assert!(masked["extras"]["propTintMask"].as_u64().is_some(), "the mask is kept and named");
    assert!(masked["pbrMetallicRoughness"].get("baseColorFactor").is_none(), "the masked tint is the window's");
    assert!(masked["extras"].get("copyTint").is_none(), "a material with a tint of its own has no copy's");
    let plain = &j["materials"][1];
    assert!(plain["extras"].get("propTintMask").is_none());
    let f = plain["pbrMetallicRoughness"]["baseColorFactor"].as_array().expect("the material's own tint");
    assert!((f[0].as_f64().unwrap() - 0.214).abs() < 0.01, "g_vColorTint, not the export's colour: {f:?}");
    let copy = &j["materials"][2];
    assert_eq!(copy["extras"]["copyTint"], json!([0.27, 0.3, 0.19]), "the export's colour is its copy's tint");
    assert!(copy["pbrMetallicRoughness"].get("baseColorFactor").is_none(), "not a colour as well");
    // an overlay's tint is its draw call's, linear already: the export's second linearisation undone
    let overlay = j["materials"][3]["extras"]["copyTint"].as_array().expect("the overlay's tint");
    assert!((overlay[0].as_f64().unwrap() - 0.0415).abs() < 0.002, "{overlay:?}");
}

#[test]
fn the_water_names_its_normal_and_noise() {
    let textures = vec![json!({ "source": 0 }), json!({ "source": 1 })];
    let images = vec![
        json!({ "name": "water_river_normal_sharp_temp_normal_tga_4ab60bd5.vtex" }),
        json!({ "name": "water_noise_000_tga_d68b7ee6.vtex" }),
    ];
    let m = |shader: &str| {
        json!({ "extras": { "vmat": { "ShaderName": shader, "TextureParams": {
            "g_tNormal": "materials/water/water_river_normal_sharp_temp_normal_tga_4ab60bd5.vtex",
            "g_tNoise": "materials/water/water_noise_000_tga_d68b7ee6.vtex" } } } })
    };
    assert_eq!(water_pictures(&m("water_dota.vfx"), &textures, &images), Some((Some(0), Some(1))));
    assert_eq!(water_pictures(&m("global_lit_simple.vfx"), &textures, &images), None, "only the water");
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
    let pos = &j["bufferViews"][j["accessors"][prim["attributes"]["POSITION"].as_u64().unwrap() as usize]["bufferView"]
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

#[test]
fn a_shiny_prop_names_its_specular_picture() {
    let textures = vec![json!({ "source": 0 })];
    let images = vec![json!({ "name": "rock_refl_psd_1.vtex" })];
    let m = |shader: &str, spec: i64| {
        json!({ "extras": { "vmat": { "ShaderName": shader, "IntParams": { "F_SPECULAR": spec },
            "TextureParams": { "g_tSpecular": "materials/rock_refl_psd_1.vtex" } } } })
    };
    assert_eq!(prop_specular(&m("global_lit_simple.vfx", 1), &textures, &images), Some(0));
    assert_eq!(prop_specular(&m("global_lit_simple.vfx", 0), &textures, &images), None, "no F_SPECULAR, no shine");
    assert_eq!(prop_specular(&m("multiblend.vfx", 1), &textures, &images), None, "the ground shines its own way");
    assert_eq!(prop_specular(&m("global_lit_simple.vfx", 1), &[], &images), None, "a picture the export left out");
}
