//! A pedestal of its own for one hero, sewn into the hero's loadout animation. The game draws one
//! pedestal under every hero on its loadout screen (BASE_PEDESTAL, named in its own code) and
//! only an item worn can swap it, through items_game. Here the hero's model brings it: each
//! loadout clip of the model (ANIM) gets an event on its first frame that creates a particle
//! drawing the chosen pedestal model where the hero stands, turned with the hero. Outside the
//! loadout no clip of these plays, so a match never sees it.
//!
//! The clips loop, and an event fires on each pass: the particle lives as long as one pass of
//! its clip and a little more, so the next pass takes over with no gap and copies do not pile up.
//! Every length of clip gets a particle of its own.
//!
//! The particle is a copy of one of the game's that draws a model (PARTICLE_BASE), cut down to a
//! single particle at the hero's origin. Tried in the game on 2026-11-20: the pedestal stands
//! under the hero on the loadout screen and turns with it.

use serde_json::{json, Value as Json};

use crate::{kv3, resource};

/// The pedestal the game puts under every hero on the loadout screen.
pub const BASE_PEDESTAL: &str = "models/heroes/pedestal/loadout_pedestal_2023.vmdl";
/// A model that draws nothing, which the game itself puts in a pedestal's place (a style of
/// Vengeful Spirit's arcana): the base pedestal hidden.
pub const EMPTY_MODEL: &str = "models/development/invisiblebox.vmdl";
/// A particle of the game that draws one model, the one each pedestal's particle is made from.
pub const PARTICLE_BASE: &str =
    "particles/econ/items/arc_warden/arc_warden_ti9_immortal/arc_warden_ti9_wraith_prj_model.vpcf_c";
/// The control point setup the event asks for by name: the particle at the hero's feet.
const CONFIG: &str = "mm_pedestal";
/// How much longer than its clip a pedestal stays, so the next pass of the clip takes over.
const OVERLAP: f64 = 0.15;
/// Pedestal models face away from where a hero looks: turned round to face the camera with it.
const TURN: f64 = 180.0;

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn int32(n: i32) -> Json {
    json!({ "kind": "number", "type": 11, "raw": hex::encode(n.to_le_bytes()) })
}

fn double(n: f64) -> Json {
    json!({ "kind": "number", "type": 5, "raw": hex::encode(n.to_le_bytes()) })
}

fn boolean(b: bool) -> Json {
    json!({ "kind": "other", "type": if b { 13 } else { 14 } })
}

fn text(s: &str) -> Json {
    json!({ "kind": "string", "value": s })
}

/// A string that names a resource.
fn resource_name(s: &str) -> Json {
    json!({ "kind": "string", "value": s, "flag": 1 })
}

fn object(members: Vec<(&str, Json)>) -> Json {
    json!({ "kind": "object", "members": members.into_iter().map(|(k, v)| json!([k, v])).collect::<Vec<_>>() })
}

/// A member of an object node of `Block::tree`.
fn get<'a>(o: &'a Json, key: &str) -> Option<&'a Json> {
    o.get("members")?.as_array()?.iter().find(|m| m[0] == key).map(|m| &m[1])
}

fn get_mut<'a>(o: &'a mut Json, key: &str) -> Option<&'a mut Json> {
    o.get_mut("members")?.as_array_mut()?.iter_mut().find(|m| m[0] == key).map(|m| &mut m[1])
}

fn set(o: &mut Json, key: &str, v: Json) {
    match get_mut(o, key) {
        Some(at) => *at = v,
        None => {
            if let Some(m) = o.get_mut("members").and_then(Json::as_array_mut) {
                m.push(json!([key, v]));
            }
        }
    }
}

fn items(o: &Json) -> &[Json] {
    o.get("items").and_then(Json::as_array).map_or(&[], Vec::as_slice)
}

fn items_mut(o: &mut Json) -> Option<&mut Vec<Json>> {
    o.get_mut("items").and_then(Json::as_array_mut)
}

fn string_of(o: Option<&Json>) -> &str {
    o.and_then(|v| v.get("value")).and_then(Json::as_str).unwrap_or("")
}

/// A number node's value, from its bytes (a 0 or 1 stored as its type alone reads as 0).
fn number_of(o: Option<&Json>) -> f64 {
    let Some(raw) = o.and_then(|v| v.get("raw")).and_then(Json::as_str).and_then(|r| hex::decode(r).ok()) else {
        return 0.0;
    };
    let ty = o.and_then(|v| v.get("type")).and_then(Json::as_u64).unwrap_or(0);
    match (raw.len(), ty) {
        (8, 5 | 19) => f64::from_le_bytes(raw.try_into().unwrap_or_default()),
        (4, 5 | 19) => f32::from_le_bytes(raw.try_into().unwrap_or_default()) as f64,
        (4, _) => i32::from_le_bytes(raw.try_into().unwrap_or_default()) as f64,
        (8, _) => i64::from_le_bytes(raw.try_into().unwrap_or_default()) as f64,
        (2, _) => i16::from_le_bytes(raw.try_into().unwrap_or_default()) as f64,
        (1, _) => raw[0] as f64,
        _ => 0.0,
    }
}

/// Whether a clip is one the loadout plays: its activity is the loadout's, or the hero's
/// entrance (ACT_DOTA_SPAWN) with the loadout modifier. The statue's still pose is not.
fn is_loadout(acts: &[String]) -> bool {
    match acts.first().map(String::as_str) {
        Some("ACT_DOTA_LOADOUT") => true,
        Some("ACT_DOTA_SPAWN") => acts.iter().any(|a| a.eq_ignore_ascii_case("loadout")),
        _ => false,
    }
}

/// The names of the sequences the loadout plays, out of the model's sequence list (ASEQ), for a
/// model whose clips carry no activity of their own.
fn loadout_sequences(model: &[u8]) -> Vec<String> {
    crate::model_loadout::model_sequences(Some(model))
        .into_iter()
        .filter(|s| is_loadout(&s.acts))
        .map(|s| s.name.to_lowercase())
        .collect()
}

/// The event that creates `particle` on a clip's first frame.
fn event(particle: &str) -> Json {
    object(vec![
        ("m_nFrame", int32(0)),
        ("m_nEndFrame", int32(-1)),
        ("m_flCycle", double(0.0)),
        ("m_flDuration", double(0.0)),
        (
            "m_EventData",
            object(vec![
                ("name", resource_name(particle)),
                ("detach_from_owner", boolean(false)),
                ("always_run", boolean(false)),
                ("stop_on_seq_change", boolean(false)),
                ("stop_immediately", boolean(false)),
                ("use_layer_sequence", boolean(false)),
                ("tags", text("")),
                ("config", text(CONFIG)),
                ("aggregate", boolean(false)),
            ]),
        ),
        ("m_sOptions", text("")),
        ("m_sEventName", text("AE_CL_CREATE_PARTICLE_EFFECT_CFG")),
    ])
}

/// A particle the sewn model creates: its path, and how long the clips that create it last.
#[derive(Debug, Clone, PartialEq)]
pub struct PedestalParticle {
    pub path: String,
    pub seconds: f64,
}

/// What sewing a pedestal into a hero's model made: the model, and the particles it creates.
#[derive(Debug, Clone, PartialEq)]
pub struct Sewn {
    pub model: Vec<u8>,
    pub particles: Vec<PedestalParticle>,
}

/// The hero's compiled model with an event on the first frame of each loadout clip, creating the
/// particle `particle_of(frames)` names for a clip that many frames long. None: the model has no
/// loadout clip, or none this code can read.
pub fn sew_into_loadout(model: &[u8], particle_of: &dyn Fn(i64) -> String) -> Result<Option<Sewn>, String> {
    if !resource::blocks(model).map_err(err)?.iter().any(|b| b.name == "ANIM") {
        return Ok(None);
    }
    let mut kv = kv3::read(resource::data(model, "ANIM", 0).map_err(err)?).map_err(err)?;
    let mut tree = kv.tree();
    let by_sequence = loadout_sequences(model);
    let mut particles: Vec<PedestalParticle> = Vec::new();
    let Some(anims) = get_mut(&mut tree, "m_animArray").and_then(items_mut) else { return Ok(None) };
    for anim in anims.iter_mut() {
        let name = string_of(get(anim, "m_name")).to_lowercase();
        let acts: Vec<String> = get(anim, "m_activityArray")
            .map(items)
            .unwrap_or(&[])
            .iter()
            .map(|a| string_of(get(a, "m_name")).to_string())
            .collect();
        if !is_loadout(&acts) && !(acts.is_empty() && by_sequence.contains(&name)) {
            continue;
        }
        let frames = get(anim, "m_pData").map(|d| number_of(get(d, "m_nFrames"))).unwrap_or(0.0) as i64;
        let fps = number_of(get(anim, "fps"));
        if frames <= 0 || fps.is_nan() || fps <= 0.0 {
            continue;
        }
        let path = particle_of(frames);
        let Some(events) = get_mut(anim, "m_eventArray").and_then(items_mut) else { continue };
        // a model sewn before keeps one pedestal event
        events.retain(|e| get(e, "m_EventData").map(|d| get(d, "config")).is_none_or(|c| string_of(c) != CONFIG));
        events.insert(0, event(&path));
        if !particles.iter().any(|p| p.path == path) {
            particles.push(PedestalParticle { path, seconds: frames as f64 / fps });
        }
    }
    if particles.is_empty() {
        return Ok(None);
    }
    kv.set_tree(&tree).map_err(err)?;
    let out = resource::replace(model, "ANIM", 0, &kv3::write(&kv).map_err(err)?).map_err(err)?;
    let refs: Vec<String> = particles.iter().map(|p| format!("{}_c", p.path)).collect();
    let refs: Vec<&str> = refs.iter().map(String::as_str).collect();
    let model = resource::with_references(&out, &refs).map_err(err)?;
    Ok(Some(Sewn { model, particles }))
}

/// The highest and lowest a pedestal is moved from the hero's feet, in the game's units.
pub const LIFT_MAX: f64 = 64.0;

/// A compiled particle drawing `pedestal` (a .vmdl path) at the hero's origin, `lift` units
/// higher (a pedestal's top is made for its own hero's feet: another hero's are set by hand),
/// turned with the hero, for `seconds` and a little more. `base` is PARTICLE_BASE out of the game.
pub fn pedestal_particle(base: &[u8], pedestal: &str, seconds: f64, lift: f64) -> Result<Vec<u8>, String> {
    let mut kv = kv3::read(resource::data(base, "DATA", 0).map_err(err)?).map_err(err)?;
    let mut p = kv.tree();
    let class_of = |o: &Json| string_of(get(o, "_class")).to_string();
    let renderer = get_mut(&mut p, "m_Renderers")
        .and_then(items_mut)
        .and_then(|r| r.first_mut())
        .filter(|r| class_of(r) == "C_OP_RenderModels")
        .ok_or("the particle the pedestal is made from draws no model")?;
    let list = get_mut(renderer, "m_ModelList").and_then(items_mut).ok_or("the particle has no model list")?;
    *list = vec![object(vec![("m_model", resource_name(pedestal))])];
    set(&mut p, "m_nMaxParticles", int32(1));
    set(&mut p, "m_flConstantRadius", double(1.0));
    if let Some(c) = get_mut(&mut p, "m_ConstantColor").and_then(items_mut) {
        *c = vec![int32(255), int32(255), int32(255), int32(255)];
    }
    set(&mut p, "m_nConstantSequenceNumber1", int32(0));
    let operators = vec![
        object(vec![("_class", text("C_OP_Decay"))]),
        object(vec![("_class", text("C_OP_PositionLock")), ("m_nControlPointNumber", int32(0))]),
        object(vec![
            ("_class", text("C_OP_RemapCPOrientationToYaw")),
            ("m_nCP", int32(0)),
            ("m_nFieldOutput", int32(12)),
            ("m_flRotOffset", double(TURN)),
        ]),
    ];
    let life = seconds + OVERLAP;
    let lift = if lift.is_finite() { lift.clamp(-LIFT_MAX, LIFT_MAX) } else { 0.0 };
    let up = || json!({ "kind": "array", "type": 10, "items": [double(0.0), double(0.0), double(lift)], "element": { "type": 5, "flag": 0 } });
    let initializers = vec![
        object(vec![("_class", text("C_INIT_CreateWithinSphere")), ("m_nControlPointNumber", int32(0))]),
        object(vec![("_class", text("C_INIT_PositionOffset")), ("m_OffsetMin", up()), ("m_OffsetMax", up())]),
        object(vec![
            ("_class", text("C_INIT_RandomLifeTime")),
            ("m_fLifetimeMin", double(life)),
            ("m_fLifetimeMax", double(life)),
        ]),
    ];
    let objects =
        |list: Vec<Json>| json!({ "kind": "array", "type": 10, "items": list, "element": { "type": 9, "flag": 0 } });
    set(&mut p, "m_Operators", objects(operators));
    set(&mut p, "m_Initializers", objects(initializers));
    let driver = object(vec![
        ("m_iControlPoint", int32(0)),
        ("m_iAttachType", text("PATTACH_ABSORIGIN_FOLLOW")),
        ("m_entityName", text("self")),
    ]);
    let config = object(vec![("m_name", text(CONFIG)), ("m_drivers", objects(vec![driver]))]);
    set(&mut p, "m_controlPointConfigurations", objects(vec![config]));
    kv.set_tree(&p).map_err(err)?;
    let out = resource::replace(base, "DATA", 0, &kv3::write(&kv).map_err(err)?).map_err(err)?;
    resource::with_references(&out, &[&format!("{pedestal}_c")]).map_err(err)
}

/// A pedestal's GLB for the 3D preview moved `lift` of the game's units up: its scene's roots
/// under one node that moves them (a GLB is in metres, up its y).
pub fn lifted_glb(glb: &[u8], lift: f64) -> Result<Vec<u8>, String> {
    if lift == 0.0 || !lift.is_finite() {
        return Ok(glb.to_vec());
    }
    let u32_at = |at: usize| -> Result<usize, String> {
        glb.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize).ok_or("not a GLB".to_string())
    };
    if glb.get(..4) != Some(b"glTF") || u32_at(16)? != 0x4E4F_534A {
        return Err("not a GLB".into());
    }
    let json_len = u32_at(12)?;
    let rest = glb.get(20 + json_len..).ok_or("not a GLB")?;
    let mut doc: Json = serde_json::from_slice(&glb[20..20 + json_len]).map_err(err)?;
    let scene = doc.get("scene").and_then(Json::as_u64).unwrap_or(0) as usize;
    let roots = doc["scenes"][scene]["nodes"].take();
    let nodes = doc.get_mut("nodes").and_then(Json::as_array_mut).ok_or("a GLB with no nodes")?;
    nodes.push(json!({ "name": "mm_pedestal_lift", "children": roots, "translation": [0.0, lift * 0.0254, 0.0] }));
    let at = nodes.len() - 1;
    doc["scenes"][scene]["nodes"] = json!([at]);
    let mut text = serde_json::to_vec(&doc).map_err(err)?;
    while !text.len().is_multiple_of(4) {
        text.push(b' ');
    }
    let mut out = Vec::with_capacity(glb.len() + 64);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&((20 + text.len() + rest.len()) as u32).to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F_534Au32.to_le_bytes());
    out.extend_from_slice(&text);
    out.extend_from_slice(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lifted_glb_moves_its_roots_up() {
        let doc = br#"{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"name":"a"}]}"#;
        let mut text = doc.to_vec();
        while !text.len().is_multiple_of(4) {
            text.push(b' ');
        }
        let mut glb = b"glTF".to_vec();
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&((20 + text.len()) as u32).to_le_bytes());
        glb.extend_from_slice(&(text.len() as u32).to_le_bytes());
        glb.extend_from_slice(b"JSON");
        glb.extend_from_slice(&text);
        assert_eq!(lifted_glb(&glb, 0.0).unwrap(), glb);
        let up = lifted_glb(&glb, 10.0).unwrap();
        let len = u32::from_le_bytes(up[12..16].try_into().unwrap()) as usize;
        let out: Json = serde_json::from_slice(&up[20..20 + len]).unwrap();
        assert_eq!(out["scenes"][0]["nodes"], json!([1]));
        assert_eq!(out["nodes"][1]["children"], json!([0]));
        assert!((out["nodes"][1]["translation"][1].as_f64().unwrap() - 0.254).abs() < 1e-9);
        assert_eq!(u32::from_le_bytes(up[8..12].try_into().unwrap()) as usize, up.len());
        assert!(lifted_glb(b"nope", 1.0).is_err());
    }

    #[test]
    fn loadout_clips_are_the_loadout_and_its_entrance() {
        let acts = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_loadout(&acts(&["ACT_DOTA_LOADOUT"])));
        assert!(is_loadout(&acts(&["ACT_DOTA_LOADOUT", "faces_mask"])));
        assert!(is_loadout(&acts(&["ACT_DOTA_SPAWN", "loadout"])));
        assert!(!is_loadout(&acts(&["ACT_DOTA_SPAWN"])));
        assert!(!is_loadout(&acts(&["ACT_DOTA_LOADOUT_STATUE"])));
        assert!(!is_loadout(&acts(&["ACT_DOTA_RUN", "loadout"])));
    }

    #[test]
    fn the_event_creates_the_particle_with_its_setup() {
        let e = event("particles/mm_pedestal/x_40.vpcf");
        let data = get(&e, "m_EventData").unwrap();
        assert_eq!(get(data, "name").unwrap()["flag"], 1);
        assert_eq!(string_of(get(data, "name")), "particles/mm_pedestal/x_40.vpcf");
        assert_eq!(string_of(get(data, "config")), CONFIG);
        assert_eq!(string_of(get(&e, "m_sEventName")), "AE_CL_CREATE_PARTICLE_EFFECT_CFG");
        assert_eq!(number_of(get(&e, "m_nEndFrame")), -1.0);
    }

    /// On the game's own files: MM_TEST_PAK01 names pak01_dir.vpk.
    #[test]
    fn sews_juggernaut_and_makes_its_particle() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let model = ix.read("models/heroes/juggernaut/juggernaut.vmdl_c").unwrap().unwrap();
        let sewn =
            sew_into_loadout(&model, &|f| format!("particles/mm_pedestal/juggernaut_{f}.vpcf")).unwrap().unwrap();
        let paths: Vec<&str> = sewn.particles.iter().map(|p| p.path.as_str()).collect();
        assert!(paths.contains(&"particles/mm_pedestal/juggernaut_310.vpcf"), "{paths:?}");
        let refs = resource::references(&sewn.model).unwrap();
        assert!(refs.iter().any(|r| r.contains("juggernaut_310")));
        // sewn twice, one event a clip
        let again =
            sew_into_loadout(&sewn.model, &|f| format!("particles/mm_pedestal/juggernaut_{f}.vpcf")).unwrap().unwrap();
        let kv = kv3::read(resource::data(&again.model, "ANIM", 0).unwrap()).unwrap();
        let tree = kv.tree();
        let anim = items(get(&tree, "m_animArray").unwrap())
            .iter()
            .find(|a| string_of(get(a, "m_name")) == "loadout_default_anim")
            .unwrap();
        assert_eq!(items(get(anim, "m_eventArray").unwrap()).len(), 1);
        let base = ix.read(PARTICLE_BASE).unwrap().unwrap();
        let particle =
            pedestal_particle(&base, "models/heroes/shadow_fiend/shadow_fiend_arcana_pedestal.vmdl", 10.0, -8.0)
                .unwrap();
        let kv = kv3::read(resource::data(&particle, "DATA", 0).unwrap()).unwrap();
        let p = kv.tree();
        assert_eq!(number_of(get(&p, "m_nMaxParticles")), 1.0);
        assert!(resource::references(&particle).unwrap().iter().any(|r| r.contains("shadow_fiend_arcana_pedestal")));
    }
}

#[cfg(test)]
mod every_hero {
    use super::*;

    /// On the game's own files: every hero's model has a loadout clip to carry a pedestal.
    #[test]
    fn every_hero_can_carry_a_pedestal() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let read = |p: &str| ix.read(p).ok().flatten();
        let heroes: Vec<String> = ix
            .paths()
            .filter_map(|p| p.strip_prefix("scripts/npc/heroes/npc_dota_hero_")?.strip_suffix(".txt").map(String::from))
            // the script every hero is based on, and the dummy to hit, are no heroes
            .filter(|h| h != "base" && h != "target_dummy")
            .collect();
        assert!(heroes.len() > 100, "{}", heroes.len());
        let mut without = Vec::new();
        for hero in &heroes {
            let Ok(at) = crate::item_builder_assets::hero_model_path(&read, &format!("npc_dota_hero_{hero}")) else {
                without.push(format!("{hero}: no model"));
                continue;
            };
            let at = format!("{}_c", at.to_lowercase());
            let Some(model) = read(&at) else {
                without.push(format!("{hero}: {at} missing"));
                continue;
            };
            match sew_into_loadout(&model, &|f| format!("particles/mm_pedestal/{hero}_{f}.vpcf")) {
                Ok(Some(_)) => {}
                Ok(None) => without.push(format!("{hero}: no loadout clip")),
                Err(e) => without.push(format!("{hero}: {e}")),
            }
        }
        // Dawnbreaker's and Kez's clips hold more objects than the version this writer writes can
        // number (kv3::write): they keep the game's pedestal
        without.retain(|w| !w.starts_with("dawnbreaker:") && !w.starts_with("kez:"));
        assert!(without.is_empty(), "{} of {}: {without:#?}", without.len(), heroes.len());
    }
}
