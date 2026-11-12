//! mm-core's functions by name, with JSON in and out: what test/rust-calls.test.ts compares with
//! the TypeScript function of the same name, and what the Tauri host can ask of Rust while the
//! module that calls it is still TypeScript. Each name is the TypeScript module and export.

use serde_json::{json, Value};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::kv::latin1;
use crate::{
    ability_sounds, cosmetic_names, effect_edit, hero_names, i18n, item_builder_donor as donor,
    item_builder_effects as effects, item_builder_styles as styles, item_skin, item_sounds, item_visuals, material,
    model_attachments, model_cloth, model_hitboxes, model_sequences, model_skin, particle_snapshot, particle_spec,
    particle_surface, recolor, unusual_effects,
};

/// A text argument as items_game's latin1 bytes: a string one byte per char, or {"$file": path}
/// for a file read once (the whole table, which would be slow to send as JSON every call).
fn b(args: &[Value], i: usize) -> Result<Arc<Vec<u8>>, String> {
    static FILES: OnceLock<Mutex<HashMap<String, Arc<Vec<u8>>>>> = OnceLock::new();
    match args.get(i) {
        Some(Value::Object(o)) if o.contains_key("$file") => {
            let path = o["$file"].as_str().unwrap_or("").to_string();
            let mut files = FILES.get_or_init(Default::default).lock().unwrap();
            if let Some(f) = files.get(&path) {
                return Ok(f.clone());
            }
            let f = Arc::new(std::fs::read(&path).map_err(|e| e.to_string())?);
            files.insert(path, f.clone());
            Ok(f)
        }
        _ => Ok(Arc::new(s(args, i).chars().map(|c| c as u32 as u8).collect())),
    }
}

fn opt_b(args: &[Value], i: usize) -> Result<Option<Arc<Vec<u8>>>, String> {
    match args.get(i) {
        None | Some(Value::Null) => Ok(None),
        _ => b(args, i).map(Some),
    }
}

fn n(args: &[Value], i: usize) -> f64 {
    args.get(i).and_then(Value::as_f64).unwrap_or(0.0)
}

/// A file made by a call, as its sha1 in hex (null for none): what the test compares.
fn sha(file: Option<Vec<u8>>) -> Value {
    use sha1::{Digest, Sha1};
    file.map_or(Value::Null, |f| json!(Sha1::digest(&f).iter().map(|b| format!("{b:02x}")).collect::<String>()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(v: &str) -> Vec<u8> {
    (0..v.len() / 2).filter_map(|i| u8::from_str_radix(&v[2 * i..2 * i + 2], 16).ok()).collect()
}

fn floats(args: &[Value], i: usize) -> Vec<f64> {
    args.get(i)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|v| v.as_f64().unwrap_or(f64::NAN)).collect())
        .unwrap_or_default()
}

fn rgb(args: &[Value], i: usize) -> recolor::Rgb {
    let f = floats(args, i);
    [0, 1, 2].map(|c| f.get(c).copied().unwrap_or(f64::NAN))
}

/// The game's pak01 index at this path, opened once.
fn pak(path: &str) -> Result<Arc<crate::vpk::Index>, String> {
    static OPEN: OnceLock<Mutex<HashMap<String, Arc<crate::vpk::Index>>>> = OnceLock::new();
    let mut open = OPEN.get_or_init(Default::default).lock().unwrap();
    if let Some(ix) = open.get(path) {
        return Ok(ix.clone());
    }
    let ix = Arc::new(crate::vpk::Index::open(std::path::Path::new(path)).map_err(|e| e.to_string())?);
    open.insert(path.to_string(), ix.clone());
    Ok(ix)
}

fn particle_def_in(pak_path: &str, system: &str) -> Result<Value, String> {
    let ix = pak(pak_path)?;
    let mut read = |p: &str| ix.read(p).ok().flatten();
    let mut budget = 128;
    Ok(particle_spec::particle_def(&mut read, system, &mut budget, 0, &HashMap::new()).unwrap_or(Value::Null))
}

fn kv_err(e: crate::kv::KvError) -> String {
    e.to_string()
}

fn s(args: &[Value], i: usize) -> String {
    match args.get(i) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) => crate::js::string(v),
    }
}

/// Run `name` on `args`.
pub fn call(name: &str, args: &[Value]) -> Result<Value, String> {
    Ok(match name {
        // [lang, ru, ...values]
        "i18n.t" => json!(i18n::t_in(i18n::Lang::parse(&s(args, 0)), &s(args, 1), args.get(2..).unwrap_or(&[]))),
        "hero-names.heroDisplayName" => json!(hero_names::display_name(&s(args, 0))),
        "hero-names.heroIdFromName" => json!(hero_names::id_from_name(&s(args, 0))),
        "hero-names.heroKey" => json!(hero_names::key(&s(args, 0))),
        "item-builder-styles.styleTokens" => {
            let v = opt_b(args, 0)?;
            json!(styles::style_tokens(v.as_deref().map(Vec::as_slice))
                .map_err(kv_err)?
                .iter()
                .map(|t| latin1(t))
                .collect::<Vec<_>>())
        }
        "item-builder-styles.styleOf" => json!(styles::style_of(&s(args, 0))),
        "item-builder-styles.withStyle" => {
            let (visuals, model, applied) = styles::with_style(&b(args, 0)?, n(args, 1) as u64).map_err(kv_err)?;
            json!({ "visuals": latin1(&visuals), "model": model.map(|m| latin1(&m)), "applied": applied })
        }
        "item-builder-styles.inEveryStyle" => {
            json!(latin1(&styles::in_every_style(&b(args, 0)?, n(args, 1) as usize).map_err(kv_err)?))
        }
        "item-builder-styles.blockInEveryStyle" => {
            json!(latin1(&styles::block_in_every_style(&b(args, 0)?, &b(args, 1)?).map_err(kv_err)?))
        }
        "item-builder-donor.donorOf" => json!(donor::donor_of(&s(args, 0))),
        "item-builder-donor.hasOwnEffect" => {
            let v = opt_b(args, 1)?;
            json!(donor::has_own_effect(&b(args, 0)?, v.as_deref().map(Vec::as_slice)).map_err(kv_err)?)
        }
        "item-builder-donor.donorAdditions" => {
            json!(donor::donor_additions(&b(args, 0)?, &b(args, 1)?, &s(args, 2))?
                .iter()
                .map(|t| latin1(t))
                .collect::<Vec<_>>())
        }
        "item-builder-donor.withModifiers" => {
            let add: Vec<Vec<u8>> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| a.iter().map(|x| x.as_str().unwrap_or("").chars().map(|c| c as u32 as u8).collect()).collect())
                .unwrap_or_default();
            json!(latin1(&donor::with_modifiers(&b(args, 0)?, &add)))
        }
        "item-builder-donor.withDonorEffects" => {
            json!(latin1(&donor::with_donor_effects(&b(args, 0)?, &b(args, 1)?, &s(args, 2))?))
        }
        "item-builder-effects.itemEffects" => json!(effects::item_effects()
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()),
        "item-builder-effects.appendItemEffect" => {
            let effect: effects::ItemEffect =
                serde_json::from_value(args.get(1).cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            json!(latin1(&effects::append_item_effect(&b(args, 0)?, &effect).map_err(kv_err)?))
        }
        "unusual-effects.effectNames" => {
            let mut names: Vec<(u64, String)> = unusual_effects::effect_names(&s(args, 0)).into_iter().collect();
            names.sort();
            json!(names)
        }
        "unusual-effects.unusualEffects" => {
            json!(unusual_effects::unusual_effects(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?)
        }
        "item-builder-unusual.offeredUnusual" => {
            let named: Vec<f64> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default();
            json!(unusual_effects::offered_unusual(&b(args, 0)?, |id| named.contains(&id)).map_err(kv_err)?)
        }
        "item-builder-unusual.unusualItemEffect" => {
            json!(unusual_effects::unusual_item_effect(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?)
        }
        "cosmetic-names.localizationTokens" => {
            json!(cosmetic_names::localization_tokens(&b(args, 0)?).into_iter().collect::<Vec<_>>())
        }
        "cosmetic-names.cosmeticNameTable" => {
            let items: Vec<(String, String)> = args
                .first()
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|i| {
                            (
                                i["name"].as_str().unwrap_or("").to_string(),
                                i["itemName"].as_str().unwrap_or("").to_string(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            let tokens: indexmap::IndexMap<String, String> = args
                .get(1)
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|p| (p[0].as_str().unwrap_or("").to_string(), p[1].as_str().unwrap_or("").to_string()))
                        .collect()
                })
                .unwrap_or_default();
            json!(cosmetic_names::cosmetic_name_table(items.iter().map(|(a, b)| (a.as_str(), b.as_str())), &tokens))
        }
        "model-skin.modelSkinMaterials" => {
            let m =
                model_skin::model_skin_materials(opt_b(args, 0)?.as_deref().map(Vec::as_slice), n(args, 1) as usize);
            json!(m.into_iter().collect::<Vec<_>>())
        }
        "model-skin.withSkin" => sha(model_skin::with_skin(&b(args, 0)?, n(args, 1) as usize)),
        "model-cloth.withoutCloth" => sha(Some(model_cloth::without_cloth(&b(args, 0)?))),
        "model-cloth.hasCloth" => json!(model_cloth::has_cloth(&b(args, 0)?)),
        "model-cloth.dragsCloth" => json!(model_cloth::drags_cloth(opt_b(args, 0)?.as_deref().map(Vec::as_slice))),
        "model-attachments.attachmentNames" => json!(model_attachments::attachment_names(&b(args, 0)?)),
        "model-attachments.attachedAs" => sha(Some(model_attachments::attached_as(&b(args, 0)?, &b(args, 1)?))),
        "model-sequences.numberedAs" => sha(model_sequences::numbered_as(&b(args, 0)?, &b(args, 1)?)),
        "item-skin.firstStyleSkin" => {
            json!(item_skin::first_style_skin(&b(args, 0)?).map_err(kv_err)?.map(|v| latin1(&v)))
        }
        "item-skin.wornSkin" => {
            let fallback = if args.get(1).is_some_and(|v| !v.is_null()) { n(args, 1) as u64 } else { 0 };
            let model = args.get(2).and_then(Value::as_str);
            json!(item_skin::worn_skin(&b(args, 0)?, fallback, model).map_err(kv_err)?)
        }
        "item-sounds.voiceSwaps" => {
            let rules = crate::kv3::read(crate::resource::data_block(&b(args, 0)?).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let cue: item_sounds::VoiceCue =
                serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(item_sounds::voice_swaps(&rules.root, &cue.key, &cue.value, cue.whole))
        }
        "item-sounds.soundEntries" => {
            let ix =
                crate::vpk::Index::open(std::path::Path::new(&s(args, 0)).join("dota").join("pak01_dir.vpk").as_path())
                    .map_err(|e| e.to_string())?;
            let swaps: Vec<item_sounds::SoundSwap> =
                serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let cues: Vec<item_sounds::VoiceCue> =
                serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(item_sounds::sound_entries(&ix, &swaps, &cues)
                .into_iter()
                .map(|(p, f)| json!([p, sha(Some(f))]))
                .collect::<Vec<_>>())
        }
        "material.attributeToken" => json!(material::attribute_token(&s(args, 0))),
        "material.constantExpression" => json!(hex(&material::constant_expression(&floats(args, 0)))),
        "material.constantOf" => json!(material::constant_of(&unhex(&s(args, 0)))),
        "material.withConstant" => {
            json!(material::with_constant(&unhex(&s(args, 0)), n(args, 1) as u32, &floats(args, 2))?.map(|c| hex(&c)))
        }
        "material.materialExpressions" => {
            json!(material::material_expressions(&b(args, 0)?)?
                .iter()
                .map(|e| json!({ "name": e.name, "code": hex(&e.code) }))
                .collect::<Vec<_>>())
        }
        "material.rewriteWithConstant" => {
            let (token, value) = (material::attribute_token(&s(args, 1)), floats(args, 2));
            let (file, changed) =
                material::rewrite_expressions(&b(args, 0)?, |e| material::with_constant(&e.code, token, &value))?;
            json!([sha(Some(file)), changed])
        }
        "recolor.shade" => {
            let from = args.get(2).filter(|v| v.is_array()).map(|_| rgb(args, 2));
            json!(recolor::shade(rgb(args, 0), rgb(args, 1), from))
        }
        "recolor.recolorResource" => {
            let o: recolor::Options =
                serde_json::from_value(args.get(2).cloned().unwrap_or(json!({}))).map_err(|e| e.to_string())?;
            let (file, n) = recolor::recolor_resource(&b(args, 0)?, rgb(args, 1), &o)?;
            json!([sha(Some(file)), n.changed, n.skipped])
        }
        "recolor.recolorMaterial" => {
            let bake = args.get(2).and_then(|o| o.get("bake")).and_then(Value::as_bool).unwrap_or(false);
            let (file, changed) = recolor::recolor_material(&b(args, 0)?, rgb(args, 1), bake)?;
            json!([sha(Some(file)), changed])
        }
        "recolor.liftForMod2x" => {
            let share = args.get(1).and_then(Value::as_f64).unwrap_or(0.3);
            let (file, changed) = recolor::lift_for_mod2x(&b(args, 0)?, share)?;
            json!([sha(Some(file)), changed])
        }
        "recolor.buildRecolor" => {
            let ix = crate::vpk::Index::open(std::path::Path::new(&s(args, 0))).map_err(|e| e.to_string())?;
            let (vpk, r) = recolor::build_recolor(&ix, &s(args, 1), rgb(args, 2), |_| false)?;
            let failed: Vec<&str> = r.failed.iter().map(|f| f.path.as_str()).collect();
            json!([sha(Some(vpk)), r.files.len(), r.changed, r.skipped, failed])
        }
        "particle-spec.dataTree" => json!(particle_spec::data_tree(opt_b(args, 0)?.as_deref().map(Vec::as_slice))),
        "particle-spec.particleDef" => particle_def_in(&s(args, 0), &s(args, 1))?,
        "particle-spec.particleTextures" => {
            let def = particle_def_in(&s(args, 0), &s(args, 1))?;
            if def.is_null() {
                Value::Null
            } else {
                json!(particle_spec::particle_textures(&def))
            }
        }
        "particle-spec.bindItemParticle" => {
            let def = particle_def_in(&s(args, 0), &s(args, 1))?;
            if def.is_null() {
                Value::Null
            } else {
                particle_spec::bind_item_particle(&def, args.get(2), &s(args, 3))
            }
        }
        "particle-spec.itemParticles" => json!(particle_spec::item_particles(&b(args, 0)?)),
        "particle-spec.heroLoadoutParticles" => {
            json!(particle_spec::hero_loadout_particles(&b(args, 0)?).map_err(kv_err)?)
        }
        "particle-spec.modelAttachments" => {
            json!(particle_spec::model_attachments(opt_b(args, 0)?.as_deref().map(Vec::as_slice)))
        }
        "particle-snapshot.snapshotPoints" => {
            let file = b(args, 0)?;
            let data = particle_spec::data_tree(Some(&file)).ok_or("snapshot: no DATA tree")?;
            json!(particle_snapshot::snapshot_points(&file, &Value::Object(data))?)
        }
        "model-hitboxes.nameHash" => json!(model_hitboxes::name_hash(&s(args, 0))),
        "model-hitboxes.surfaceBoxes" => json!(model_hitboxes::surface_boxes(&b(args, 0)?)?
            .iter()
            .map(|b| json!({ "bone": b.bone, "min": b.min.map(crate::js::json_number), "max": b.max.map(crate::js::json_number) }))
            .collect::<Vec<_>>()),
        "model-hitboxes.withSurfaceHitboxes" => {
            let names: Vec<String> = match args.get(1).and_then(Value::as_array) {
                Some(a) => a.iter().map(crate::js::string).collect(),
                None => vec![model_hitboxes::SURFACE_SET.to_string()],
            };
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            sha(model_hitboxes::with_surface_hitboxes(&b(args, 0)?, &names))
        }
        "particle-surface.surfaceSystem" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            match particle_surface::surface_system(&mut read, &s(args, 1))? {
                None => Value::Null,
                Some((root, entries)) => json!([root, entries.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>()]),
            }
        }
        "ability-sounds.eventsFile" => json!(ability_sounds::events_file(&s(args, 0))),
        "ability-sounds.soundPath" => json!(ability_sounds::sound_path(&s(args, 0), &s(args, 1))),
        "ability-sounds.soundHero" => json!(ability_sounds::sound_hero(&s(args, 0))),
        "ability-sounds.heroesWithSounds" => json!(ability_sounds::heroes_with_sounds(pak(&s(args, 0))?.paths())),
        "ability-sounds.heroEvents" => {
            let kv = crate::kv3::read(crate::resource::data(&b(args, 0)?, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            json!(ability_sounds::hero_events(&kv))
        }
        "ability-sounds.editedEvents" => {
            let kv = crate::kv3::read(crate::resource::data(&b(args, 0)?, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let edits: Vec<ability_sounds::SoundEdit> = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let (text, gone) = ability_sounds::edited_events(&kv, &s(args, 1), &edits)?;
            json!({ "text": text, "gone": gone })
        }
        "ability-sounds.wavProblem" => json!(ability_sounds::wav_problem(&b(args, 0)?)),
        "js.toFixed" => json!(crate::js::to_fixed(n(args, 0), n(args, 1) as usize)),
        "hero-showcase.heroStage" => {
            let keys: Vec<String> = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let (sc, sp) = (opt_b(args, 0)?, opt_b(args, 1)?);
            crate::hero_showcase::hero_stage(sc.as_ref().map(|v| v.as_slice()), sp.as_ref().map(|v| v.as_slice()), &keys)
        }
        "hero-showcase.showcaseEntry" => {
            let keys: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::hero_showcase::showcase_entry(&b(args, 0)?, &keys).map(|m| m.into_iter().collect::<std::collections::BTreeMap<_, _>>()))
        }
        "hero-showcase.forward" => {
            let f = crate::hero_showcase::forward([n(args, 0), n(args, 1), n(args, 2)]);
            json!(f.iter().map(|x| crate::js::json_number(*x)).collect::<Vec<_>>())
        }
        "vpk-pack.findContentRoot" => json!(crate::vpk_pack::find_content_root(std::path::Path::new(&s(args, 0)), 0).map(|p| p.to_string_lossy().into_owned())),
        "vpk-pack.packFolder" => json!(sha(Some(crate::vpk_pack::pack_folder(std::path::Path::new(&s(args, 0)))?))),
        "arcana-notes.itemNote" => {
            let heroes: Vec<String> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let id = args.get(2).and_then(Value::as_str);
            json!(crate::arcana_notes::item_note(&heroes, &b(args, 1)?, id))
        }
        "arcana-notes.isArcanaBlock" => json!(crate::arcana_notes::is_arcana_block(&b(args, 0)?)),
        "arcana-bases.hasBase" => json!(crate::arcana_notes::has_base(&s(args, 0))),
        "item-builder-details.itemFacts" => json!(crate::item_builder_details::item_facts(&b(args, 0)?)),
        "item-builder-details.heroAttributes" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            let ids: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::item_builder_details::hero_attributes(&mut read, &ids))
        }
        "item-builder-details.eventNames" => {
            let tokens: Vec<(String, String)> = serde_json::from_value(args.first().cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let names = crate::item_builder_details::event_names(tokens.iter().map(|(k, v)| (k.as_str(), v.as_str())));
            json!(names.into_iter().collect::<std::collections::BTreeMap<_, _>>())
        }
        "item-builder-details.eventName" => {
            let tokens: Vec<(String, String)> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            let names = crate::item_builder_details::event_names(tokens.iter().map(|(k, v)| (k.as_str(), v.as_str())));
            json!(crate::item_builder_details::event_name(&s(args, 0), &names))
        }
        "item-builder-details.plainText" => json!(crate::item_builder_details::plain_text(&s(args, 0))),
        "item-builder-ability-fx.fxSlotOf" => json!(crate::item_builder_ability_fx::fx_slot_of(&s(args, 0))),
        "item-builder-ability-fx.fxSlotsOf" => json!(crate::item_builder_ability_fx::fx_slots_of(&b(args, 0)?)),
        "item-builder-ability-fx.fxVisuals" => {
            json!(latin1(&crate::item_builder_ability_fx::fx_visuals(&b(args, 0)?, n(args, 1) as u64).map_err(kv_err)?))
        }
        "item-builder-ability-fx.hasModifiers" => json!(crate::item_builder_ability_fx::has_modifiers(&b(args, 0)?)),
        "item-builder-ability-fx.fxTarget" => {
            let items = crate::schema::items_of(&b(args, 0)?).map_err(kv_err)?;
            json!(crate::item_builder_ability_fx::fx_target(&items, n(args, 1) as u64).map(|i| i.id.clone()))
        }
        "js.localeCompare" => json!(crate::js::locale_compare(&s(args, 0), &s(args, 1)) as i8),
        "item-builder-slots.itemSlots" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::item_builder_slots::item_slots(&b(args, 1)?).map_err(kv_err)?)
        }
        "item-builder-slots.stockModels" => {
            let heroes: Vec<String> = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(crate::item_builder_slots::stock_models(&b(args, 0)?, &heroes).map_err(kv_err)?)
        }
        "item-builder-slots.canonicalHeroId" => json!(crate::item_builder_slots::canonical_hero_id(&s(args, 0))),
        "item-builder-slots.matchItemSlot" => json!(crate::item_builder_slots::match_item_slot(&s(args, 0))),
        "item-builder-slots.slotDisplayLabel" => {
            crate::i18n::set_lang(crate::i18n::Lang::parse(&s(args, 0)));
            json!(crate::item_builder_slots::slot_display_label(&s(args, 1)))
        }
        "item-builder-slots.itemSlotIcon" => json!(crate::item_builder_slots::item_slot_icon(&s(args, 0))),
        "effect-edit.cleanEdits" => json!(effect_edit::clean_edits(args.first().unwrap_or(&Value::Null))),
        "effect-edit.systemsOf" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            json!(effect_edit::systems_of(&mut read, &s(args, 1)).into_iter().map(|(path, depth)| json!({ "path": path, "depth": depth })).collect::<Vec<_>>())
        }
        "effect-edit.editedEntries" => {
            let ix = pak(&s(args, 0))?;
            let mut read = |p: &str| ix.read(p).ok().flatten();
            let edits: effect_edit::EffectEdits = serde_json::from_value(args.get(2).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            json!(effect_edit::edited_entries(&mut read, &s(args, 1), &edits)?.into_iter().map(|(p, f)| json!([p, sha(Some(f))])).collect::<Vec<_>>())
        }
        "item-visuals.itemVisuals" => json!(item_visuals::item_visuals(&b(args, 0)?, &s(args, 1)).map_err(kv_err)?),
        "item-visuals.findItems" => json!(item_visuals::find_items(&b(args, 0)?, &s(args, 1))
            .map_err(kv_err)?
            .into_iter()
            .map(|(id, name)| json!({ "id": id, "name": name }))
            .collect::<Vec<_>>()),
        "item-visuals.defaultItem" => json!(item_visuals::default_item(&b(args, 0)?, &s(args, 1), &s(args, 2))
            .map_err(kv_err)?
            .map(|(id, model)| json!({ "id": id, "model": model }))),
        "item-visuals.buildPlan" => {
            let text = b(args, 0)?;
            match item_visuals::item_visuals(&text, &s(args, 1)).map_err(kv_err)? {
                Some(v) => json!(item_visuals::build_plan(&text, &v).map_err(kv_err)?),
                None => Value::Null,
            }
        }
        _ => return Err(format!("no function {name}")),
    })
}

/// Every call in a list of [name, ...args], each answered {ok} or {error}.
pub fn call_all(list: &[Value]) -> Vec<Value> {
    list.iter()
        .map(|c| {
            let parts = c.as_array().map(Vec::as_slice).unwrap_or(&[]);
            let name = parts.first().and_then(Value::as_str).unwrap_or("");
            match call(name, parts.get(1..).unwrap_or(&[])) {
                Ok(v) => json!({ "ok": v }),
                Err(e) => json!({ "error": e }),
            }
        })
        .collect()
}
