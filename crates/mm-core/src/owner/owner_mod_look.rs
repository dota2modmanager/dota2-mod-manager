//! A catalog mod in 3D before it goes in: a hero or an item of one (models/mod_look.rs), or a model of
//! the world, a ward, a creep, a tower and the like (models/mod_props.rs). The mod window's stage.
//! The mod's archive is downloaded as an install would, unpacked once per version, and the hero
//! preview of the item builder draws the hero with the mod's files read before the game's.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::hero_preview::{Game, HeroModels, HeroPreview};
use crate::mod_look::{Look, LookExporter};
use crate::owner::{arg, Owner, R};
use crate::owner_preview3d::{has_tool, pack, shown};

pub const CHANNELS: &[&str] = &["preview3d:modHero", "preview3d:modModels", "preview3d:modProps"];

/// The catalog's categories whose mods the stage can show a hero for: a hero, and an item of a hero.
const SHOWN: [&str; 2] = ["heroes", "hero-items"];

/// one unpacking at a time: the window asks for the hero and then the models of the same mod
static UNPACKING: Mutex<()> = Mutex::new(());

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// The mod unpacked, downloaded the first time and again when the catalog has a new version.
fn look(o: &Owner, category: &str, file: &str) -> Result<Look, String> {
    if !SHOWN.contains(&category) && !crate::mod_props::PROPS.contains(&category) {
        return Err(format!("no 3D for {category}"));
    }
    let got = crate::owner_mods::download(o, category, file, file);
    // the download's bar is the install's, which an install closes when it is done; the stage has
    // no install after it, and the bar stood at "0.0 / 0.0 MB" for good
    match &got {
        Ok(_) => o.progress(json!({ "type": "done", "label": file })),
        Err(e) => o.progress(json!({ "type": "error", "label": file, "message": e })),
    }
    let zip = got?;
    let stamp = crate::mod_look::stamp_of(&zip);
    // each version of the archive in a folder of its own: the models exported out of the last one
    // are never taken for this one's, and nothing has to be deleted from under a running export
    let (root, game) = {
        let c = o.core();
        (c.glb.loose_root(&format!("look/{category}/{file}/{stamp}")), c.game())
    };
    let (Some(root), Some(game)) = (root, game) else {
        return Err(crate::i18n::t("Не найдена папка игры", &[]));
    };
    let _one = UNPACKING.lock().unwrap_or_else(|e| e.into_inner());
    let files = match crate::mod_look::listed(&root, &stamp) {
        Some(f) => f,
        None => crate::mod_look::unpack(&zip, &root, &game.join("dota"))?,
    };
    Ok(Look::new(&root, files))
}

fn pak01(o: &Owner) -> Option<std::sync::Arc<crate::vpk::Index>> {
    let game = o.core().game()?;
    crate::vpk_shared::shared_index(&game.join("dota").join("pak01_dir.vpk")).ok()
}

/// (category, file, hint): the hero the mod is for, by its files or else by `hint`, the catalog's
/// name for it; `{hero: "shadow_shaman"}`, `{hero: null}` for a mod of no hero, `{error}`.
fn mod_hero(o: &Owner, args: &[Value]) -> Value {
    let (category, file, hint) =
        (crate::js::string(&arg(args, 0)), crate::js::string(&arg(args, 1)), crate::js::string(&arg(args, 2)));
    let look = match look(o, &category, &file) {
        Ok(l) => l,
        Err(e) => {
            o.diag(&format!("mod look: {e}"));
            return json!({ "error": e });
        }
    };
    let Some(ix) = pak01(o) else {
        return json!({ "error": crate::i18n::t("Не найдена папка игры", &[]) });
    };
    let read = |p: &str| look.read(p).or_else(|| ix.read(p).ok().flatten());
    let game_paths: Vec<String> =
        ix.paths().filter(|p| p.starts_with("scripts/npc/heroes/")).map(String::from).collect();
    let hero = crate::mod_look::hero_of(look.paths(), &game_paths, &read, &hint);
    json!({ "hero": hero.map(|h| h.trim_start_matches("npc_dota_hero_").to_string()) })
}

/// (category, file, hero, slots): the hero in the slots' stock items as preview3d:models answers,
/// with the mod's files over the game's. The user's installed looks stay off it: the stage shows
/// this mod alone.
fn mod_models(o: &Owner, args: &[Value]) -> Value {
    let (category, file, hero) =
        (crate::js::string(&arg(args, 0)), crate::js::string(&arg(args, 1)), crate::js::string(&arg(args, 2)));
    let asked = arg(args, 3).as_array().cloned().unwrap_or_default();
    let started = (o.opts.now)();
    let (tool, glb, vanilla) = {
        let mut core = o.core();
        let c = &mut *core;
        let game = c.game();
        let text = game.as_deref().and_then(|g| c.schema.vanilla(g).ok());
        (has_tool(c), c.glb.clone(), text)
    };
    if !tool {
        return json!({ "ok": false, "reason": "no-tool" });
    }
    let look = match look(o, &category, &file) {
        Ok(l) => l,
        Err(e) => {
            o.diag(&format!("mod look: {e}"));
            return json!({ "ok": false, "reason": "no-mod", "error": e });
        }
    };
    let (Some(ix), Some(vanilla)) = (pak01(o), vanilla) else { return json!({ "ok": false, "reason": "no-game" }) };
    let text = look.items_game().unwrap_or_else(|| vanilla.0.clone());
    let slots = stock_slots(&text, &hero).unwrap_or(asked);
    let read = |p: &str| look.read(p).or_else(|| ix.read(p).ok().flatten());
    let has = |p: &str| look.has(p) || ix.has(p);
    let paths = || look.paths().map(String::from).chain(ix.paths().map(String::from)).collect::<Vec<_>>();
    let game = Game { read: &read, has: &has, paths: &paths };
    let exporter = LookExporter { glb: glb.as_ref(), look: &look };
    let lines = Mutex::new(Vec::<String>::new());
    let log = |m: &str| lines.lock().unwrap_or_else(|e| e.into_inner()).push(m.to_string());
    // its own preview: the item builder's keeps the game's models under the same names
    let got = HeroPreview::new().models(&text, Some(&game), &[], &exporter, &hero, &slots, true, &log);
    for l in lines.into_inner().unwrap_or_default() {
        o.diag(&l);
    }
    match got {
        Ok(HeroModels::Shown(s)) => {
            o.diag(&format!("mod look: {file} answered in {} ms", ((o.opts.now)() - started).round()));
            pack(o, shown(&s))
        }
        Ok(HeroModels::Not(r)) => json!({ "ok": false, "reason": r }),
        Err(e) => {
            o.diag(&format!("mod look: {e}"));
            json!({ "ok": false, "reason": "no-body", "error": e })
        }
    }
}

/// (category, file, index): a catalog mod of the world as the hero stage answers preview3d:models
/// (models/mod_props.rs): the model at `index` of the mod's models stands as the body, in its idle,
/// dressed with its pictures (the mod's over the game's), with its attachments and the particles
/// its model lists (a ward's glow, an ancient's ambience); the others stand beside it. `models`
/// names them all, for the window's tabs.
fn mod_props(o: &Owner, args: &[Value]) -> Value {
    let (category, file) = (crate::js::string(&arg(args, 0)), crate::js::string(&arg(args, 1)));
    let index = arg(args, 2).as_u64().unwrap_or(0) as usize;
    if !crate::mod_props::PROPS.contains(&category.as_str()) {
        return json!({ "ok": false, "reason": "no-mod", "error": format!("no 3D for {category}") });
    }
    let started = (o.opts.now)();
    let (tool, glb) = {
        let c = o.core();
        (has_tool(&c), c.glb.clone())
    };
    if !tool {
        return json!({ "ok": false, "reason": "no-tool" });
    }
    let look = match look(o, &category, &file) {
        Ok(l) => l,
        Err(e) => {
            o.diag(&format!("mod look: {e}"));
            return json!({ "ok": false, "reason": "no-mod", "error": e });
        }
    };
    let Some(ix) = pak01(o) else { return json!({ "ok": false, "reason": "no-game" }) };
    let read = |p: &str| look.read(p).or_else(|| ix.read(p).ok().flatten());
    let units = ix.read("scripts/npc/npc_units.txt").ok().flatten();
    let models =
        crate::mod_props::distinct(crate::mod_props::models_for(&category, look.paths(), units.as_deref()), &read);
    if models.is_empty() {
        return json!({ "ok": false, "reason": "no-models" });
    }
    let groups = crate::mod_props::groups_of(&category, &models);
    let index = index.min(groups.len() - 1);
    let exporter = LookExporter { glb: glb.as_ref(), look: &look };
    // one model after another: two models of one mod share pictures, and the toolchain exporting
    // both at once wrote the same files from two processes and failed on them
    let dressed: Vec<Option<(Option<String>, Vec<u8>)>> = models
        .iter()
        .map(|model| {
            let clip = crate::mod_props::clip_of(read(&format!("{model}_c")).as_deref());
            let clips = crate::model_glb::Clips::Some(clip.iter().cloned().collect());
            let file = crate::loadout_resources::Exporter::glbs(&exporter, std::slice::from_ref(model), &clips, false)
                .get(model)
                .cloned()
                .flatten()?;
            let wanted = crate::loadout_resources::Wanted { file, model: model.clone(), skin: 0 };
            let got = crate::loadout_resources::loadout_models(&[wanted], &read, &exporter, Some(&mut |_| {})).ok()?;
            Some((clip, got.into_iter().next().flatten()?))
        })
        .collect();
    let at = |m: &String| models.iter().position(|x| x == m).and_then(|i| dressed[i].clone());
    let group = &groups[index];
    let Some((clip, body)) = at(&group[0]) else { return json!({ "ok": false, "reason": "no-models" }) };
    let body_file = read(&format!("{}_c", group[0]));
    // the particles the body's model lists, read with the mod's files over the game's
    let mut budget: i64 = 256;
    let none = std::collections::HashMap::new();
    let mut read_fx = |p: &str| read(p);
    // the ones its model lists, and the category's and the mod's at the game's paths (mod_props.rs)
    let named = |p: &str| {
        read(&format!("{p}_c"))
            .map(|b| {
                crate::resource::references(&b)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| r.ends_with(".vpcf"))
                    .collect()
            })
            .unwrap_or_default()
    };
    let has = |p: &str| ix.has(p);
    let more = crate::mod_props::effects_for(&category, &group[0], look.paths(), &has, &named);
    let listed = crate::model_particles::model_particle_entries(body_file.as_deref())
        .into_iter()
        .chain(more.into_iter().map(|path| crate::model_particles::Listed { path, config: String::new() }))
        .filter(|_| !crate::mod_props::no_effects(&category));
    let particles: Vec<crate::hero_preview_fx::PlannedFx> = listed
        .filter_map(|l| {
            let def = crate::particle_spec::particle_def(&mut read_fx, &l.path, &mut budget, 0, &none)?;
            Some(crate::hero_preview_fx::PlannedFx {
                part: -1,
                def: crate::particle_spec::bind_item_particle(&def, None, &l.config),
            })
        })
        .collect();
    let defs: Vec<Value> = particles.iter().map(|x| x.def.clone()).collect();
    let resources = crate::loadout_resources::loadout_resources(&defs, &read, &exporter);
    let sprites = crate::hero_preview::sprites_of(&defs, &resources, &exporter);
    // the rest of its group in its place, the other groups' first models beside it
    let parts: Vec<crate::hero_preview::ShownPart> = group[1..]
        .iter()
        .filter_map(|m| {
            let (_, glb) = at(m)?;
            Some(crate::hero_preview::ShownPart {
                slot: "prop".into(),
                name: m.clone(),
                glb,
                attachments: crate::particle_spec::model_attachments(read(&format!("{m}_c")).as_deref()),
                hidden: vec![],
            })
        })
        .collect();
    let companions: Vec<crate::hero_companions::Companion> = groups
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .filter_map(|(_, g)| {
            let (clip, glb) = at(&g[0])?;
            Some(crate::hero_companions::Companion { model: g[0].clone(), clip, glb })
        })
        .collect();
    let shown_now = crate::hero_preview::Shown {
        body,
        clip: clip.unwrap_or_default(),
        stage: crate::hero_showcase::hero_stage(None, None, &[]),
        pedestal: None,
        model: group[0].clone(),
        motions: vec![],
        parts,
        missing: vec![],
        hidden: vec![],
        attachments: crate::particle_spec::model_attachments(body_file.as_deref()),
        particles,
        sprites,
        resources,
        companions,
    };
    o.diag(&format!(
        "mod look: {file}, group {} of {} ({} models), {} effects, in {} ms",
        index + 1,
        groups.len(),
        group.len(),
        shown_now.particles.len(),
        ((o.opts.now)() - started).round()
    ));
    let mut answer = shown(&shown_now);
    // the window's tabs: each group by its first model
    answer["models"] = json!(groups.iter().map(|g| g[0].clone()).collect::<Vec<_>>());
    answer["index"] = json!(index);
    pack(o, answer)
}

/// Every slot of the hero in its stock item, out of the item table. The item builder's slots leave
/// out a hero with nothing to pick (one with no paid items yet): there the stage had no weapon,
/// and a mod of that weapon showed nothing.
fn stock_slots(text: &[u8], hero: &str) -> Option<Vec<Value>> {
    let short = hero.trim_start_matches("npc_dota_hero_");
    let all = crate::item_builder_slots::stock_item_slots(text).ok()?;
    let mine: Vec<Value> = all
        .iter()
        .filter(|s| s.ability_fx.is_none() && !s.target_id.is_empty() && s.hero_ids.iter().any(|h| h == short))
        .map(|s| json!({ "slot": s.slot, "stock": s.target_id }))
        .collect();
    (!mine.is_empty()).then_some(mine)
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    match channel {
        "preview3d:modHero" => mod_hero(o, args),
        "preview3d:modModels" => mod_models(o, args),
        "preview3d:modProps" => mod_props(o, args),
        _ => Value::Null,
    }
}
