//! mm-core's functions by name, with JSON in and out: what test/rust-calls.test.ts compares with
//! the TypeScript function of the same name, and what the Tauri host can ask of Rust while the
//! module that calls it is still TypeScript. Each name is the TypeScript module and export.

use serde_json::{json, Value};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::kv::latin1;
use crate::{
    cosmetic_names, hero_names, i18n, item_builder_donor as donor, item_builder_effects as effects,
    item_builder_styles as styles, item_skin, item_sounds, item_visuals, model_attachments, model_cloth,
    model_sequences, model_skin, unusual_effects,
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
