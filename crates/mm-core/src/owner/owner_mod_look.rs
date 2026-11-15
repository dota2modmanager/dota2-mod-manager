//! A catalog hero or item mod in 3D before it goes in (models/mod_look.rs): the mod window's stage.
//! The mod's archive is downloaded as an install would, unpacked once per version, and the hero
//! preview of the item builder draws the hero with the mod's files read before the game's.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::hero_preview::{Game, HeroModels, HeroPreview};
use crate::mod_look::{Look, LookExporter};
use crate::owner::{arg, Owner, R};
use crate::owner_preview3d::{has_tool, pack, shown};

pub const CHANNELS: &[&str] = &["preview3d:modHero", "preview3d:modModels"];

/// The catalog's categories whose mods the stage can show: a hero, and an item of a hero.
const SHOWN: [&str; 2] = ["heroes", "hero-items"];

/// one unpacking at a time: the window asks for the hero and then the models of the same mod
static UNPACKING: Mutex<()> = Mutex::new(());

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// The mod unpacked, downloaded the first time and again when the catalog has a new version.
fn look(o: &Owner, category: &str, file: &str) -> Result<Look, String> {
    if !SHOWN.contains(&category) {
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
        _ => Value::Null,
    }
}
