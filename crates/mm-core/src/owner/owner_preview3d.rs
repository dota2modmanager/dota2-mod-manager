//! The 3D preview in the item builder's hero window (src/ipc-preview3d.ts): the hero's body and
//! each slot's model as GLB bytes, an effect's particle system for its picture, a map prop alone.
//! The exports run in the toolchain's own process, a few at a time, and are kept per game build;
//! the work runs without the state's lock, which it holds only to read what it needs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine;
use serde_json::{json, Map, Value};

use crate::hero_preview::{Game, HeroModels};
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] = &[
    "preview3d:slice",
    "preview3d:models",
    "preview3d:warm",
    "preview3d:prefetch",
    "preview3d:motions",
    "preview3d:effect",
    "preview3d:model",
    "decor:scene",
    "decor:map",
    "decor:ground",
    "decor:modTrees",
    "decor:paint",
    "decor:modModel",
];

/// one warm-up at a time: a second would only queue behind the first's exports
static WARMING: AtomicBool = AtomicBool::new(false);

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

/// The light copy of a map the window shows: the default one, a game terrain's ("winter" or
/// "game:winter"), or a catalog terrain's ("catalog:LowPoly.zip"), downloaded as an install would
/// the first time when `fetch`.
fn world_of(o: &Owner, a0: &Value, fetch: bool) -> Option<std::path::PathBuf> {
    let name = Some(crate::js::string(a0)).filter(|w| !w.is_empty() && w != "undefined" && w != "null");
    let (glb, ud, game) = {
        let c = o.core();
        (c.glb.clone(), c.user_data.clone(), c.game())
    };
    let base = name
        .as_deref()
        .map(|n| crate::map_base::Base::parse(n).unwrap_or_else(|| crate::map_base::Base::Game(n.to_string())));
    match base {
        None => glb.map_world(None),
        Some(crate::map_base::Base::Game(w)) => glb.map_world(Some(&w)),
        Some(crate::map_base::Base::Catalog(f)) => {
            let file = crate::map_base::catalog_map(&ud, &f);
            if !crate::map_base::catalog_kept(&ud, &f) && fetch {
                let got = crate::owner_mods::download(o, "terrains", &f, &f)
                    .and_then(|zip| crate::map_base::take_catalog_map(&zip, &file));
                if let Err(e) = got {
                    o.diag(&format!("decor scene: {e}"));
                    return None;
                }
            }
            let game = game?;
            crate::map_base::point_at_game(&game, &ud, &f);
            // "2": the copies made before the gameinfo.gi had no materials
            let key = format!("map-cat2-{}", file.parent()?.file_name()?.to_string_lossy());
            // a pak of materials draws on the default map, in its materials
            if !file.is_file() {
                let preview = crate::map_base::catalog_preview(&game, &ud, &f)?;
                return glb.map_world_at(&preview, &key);
            }
            glb.map_world_at(&file, &key)
        }
    }
}

fn b64(b: &[u8]) -> Value {
    json!({ "$b64": base64::engine::general_purpose::STANDARD.encode(b) })
}

pub(crate) fn has_tool(c: &Core) -> bool {
    crate::toolchain::Toolchain::new(&c.user_data, None).path_of("vrf").is_some()
}

/// What the preview reads, taken under the lock: the item table, the library, the game's pak01.
struct Inputs {
    text: Option<Arc<(Vec<u8>, String)>>,
    library: Vec<Value>,
    index: Option<Arc<crate::vpk::Index>>,
    glb: Arc<crate::model_glb::ModelGlb>,
    preview: Arc<crate::hero_preview::HeroPreview>,
    tool: bool,
}

fn inputs(o: &Owner) -> Inputs {
    let mut core = o.core();
    let c = &mut *core;
    let game = c.game();
    let text = game.as_deref().and_then(|g| c.schema.vanilla(g).ok());
    let index =
        game.as_deref().and_then(|g| crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).ok());
    Inputs {
        text,
        library: c.library.list().to_vec(),
        index,
        glb: c.glb.clone(),
        preview: c.hero_preview.clone(),
        tool: has_tool(c),
    }
}

pub(crate) fn pack(o: &Owner, v: Value) -> Value {
    let now = (o.opts.now)();
    o.core().large.pack(v, now)
}

/// The answer of preview3d:models before packing.
fn models(o: &Owner, hero: &str, slots: &[Value], with_tool: Option<bool>) -> Result<HeroModels, String> {
    let i = inputs(o);
    let tool = with_tool.unwrap_or(i.tool);
    let text: &[u8] = i.text.as_ref().map(|t| t.0.as_slice()).unwrap_or_default();
    let lines = std::sync::Mutex::new(Vec::<String>::new());
    let log = |m: &str| lines.lock().unwrap_or_else(|e| e.into_inner()).push(m.to_string());
    let got = match &i.index {
        Some(ix) => {
            let read = |p: &str| ix.read(p).ok().flatten();
            let has = |p: &str| ix.has(p);
            let paths = || ix.paths().map(String::from).collect::<Vec<_>>();
            let game = Game { read: &read, has: &has, paths: &paths };
            let game = i.text.as_ref().map(|_| game);
            i.preview.models(text, game.as_ref(), &i.library, i.glb.as_ref(), hero, slots, tool, &log)
        }
        None => i.preview.models(text, None, &i.library, i.glb.as_ref(), hero, slots, tool, &log),
    };
    for l in lines.into_inner().unwrap_or_default() {
        o.diag(&l);
    }
    got
}

pub(crate) fn shown(m: &crate::hero_preview::Shown) -> Value {
    let sprites: Map<String, Value> = m.sprites.iter().map(|(k, v)| (k.clone(), b64(v))).collect();
    json!({
        "ok": true,
        "body": b64(&m.body),
        "clip": m.clip,
        "model": m.model,
        "motions": m.motions,
        "stage": m.stage,
        "pedestal": m.pedestal.as_deref().map(b64),
        "parts": m.parts.iter().map(|x| json!({
            "slot": x.slot, "name": x.name, "glb": b64(&x.glb), "attachments": x.attachments, "hidden": x.hidden,
        })).collect::<Vec<_>>(),
        "missing": m.missing,
        "hidden": m.hidden,
        "attachments": m.attachments,
        "particles": m.particles,
        "sprites": sprites,
        "resources": m.resources,
        "companions": m.companions.iter().map(|c| json!({ "model": c.model, "clip": c.clip, "glb": b64(&c.glb) })).collect::<Vec<_>>(),
    })
}

fn list(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "preview3d:slice" => {
            let id = crate::js::to_number(&a0);
            let offset = crate::js::to_number(&arg(args, 1));
            if !(id.is_finite() && offset.is_finite() && id >= 0.0 && offset >= 0.0) {
                return Value::Null;
            }
            match o.core().large.slice(id as u64, offset as usize) {
                Some(b) => b64(&b),
                None => Value::Null,
            }
        }
        "preview3d:models" => {
            let started = (o.opts.now)();
            let hero = crate::js::string(&a0);
            match models(o, &hero, &list(&arg(args, 1)), None) {
                Ok(m) => {
                    // how long the window waited on this side, against how long it waited in all
                    o.diag(&format!("preview 3d: {hero} answered in {} ms", ((o.opts.now)() - started).round()));
                    match m {
                        HeroModels::Not(r) => json!({ "ok": false, "reason": r }),
                        HeroModels::Shown(s) => pack(o, shown(&s)),
                    }
                }
                Err(e) => {
                    // the window says only that the model could not be had; the reason goes to the log
                    o.diag(&format!("preview 3d: {e}"));
                    json!({ "ok": false, "reason": "no-body", "error": e })
                }
            }
        }
        "preview3d:warm" => {
            if !has_tool(&o.core()) || WARMING.swap(true, Ordering::SeqCst) {
                return json!({ "ok": false });
            }
            let out = match models(o, &crate::js::string(&a0), &list(&arg(args, 1)), Some(true)) {
                Ok(HeroModels::Shown(s)) => {
                    let res = s.resources.get("missing").and_then(Value::as_array).map_or(0, Vec::len);
                    json!({ "ok": true, "missing": s.missing.len() + res })
                }
                Ok(HeroModels::Not(_)) => json!({ "ok": false }),
                Err(e) => {
                    o.diag(&format!("preview 3d warm: {e}"));
                    json!({ "ok": false })
                }
            };
            WARMING.store(false, Ordering::SeqCst);
            out
        }
        "preview3d:prefetch" => {
            let i = inputs(o);
            let (Some(text), Some(ix), true) = (&i.text, &i.index, i.tool) else { return json!(0) };
            let read = |p: &str| ix.read(p).ok().flatten();
            let has = |p: &str| ix.has(p);
            let paths = || ix.paths().map(String::from).collect::<Vec<_>>();
            let game = Game { read: &read, has: &has, paths: &paths };
            let items: Vec<String> = list(&arg(args, 3)).iter().map(crate::js::string).collect();
            json!(crate::hero_preview::prefetch(
                &text.0,
                &game,
                &i.library,
                i.glb.as_ref(),
                &crate::js::string(&a0),
                &list(&arg(args, 1)),
                &crate::js::string(&arg(args, 2)),
                &items,
            ))
        }
        "preview3d:motions" => {
            let i = inputs(o);
            if !i.tool {
                return Value::Null;
            }
            match crate::hero_preview::motions(i.glb.as_ref(), &crate::js::string(&a0)) {
                Some(b) => pack(o, b64(&b)),
                None => Value::Null,
            }
        }
        "preview3d:effect" => {
            let i = inputs(o);
            let Some(text) = &i.text else { return Value::Null };
            let read = i.index.as_ref().map(|ix| move |p: &str| ix.read(p).ok().flatten());
            let read_ref = read.as_ref().map(|r| r as &dyn Fn(&str) -> Option<Vec<u8>>);
            match crate::hero_preview::effect(&text.0, read_ref, i.glb.as_ref(), &crate::js::string(&a0)) {
                Ok(Some(e)) => {
                    let sprites: Map<String, Value> = e.sprites.iter().map(|(k, v)| (k.clone(), b64(v))).collect();
                    pack(o, json!({ "def": e.def, "sprites": sprites, "resources": e.resources }))
                }
                Ok(None) => Value::Null,
                Err(e) => {
                    o.diag(&format!("preview 3d effect: {e}"));
                    Value::Null
                }
            }
        }
        // the game's whole map for the Optimization window: exported and made light once per build
        // (minutes the first time), then served on the mm-map scheme
        "decor:scene" => {
            let tool = has_tool(&o.core());
            if !tool {
                return json!({ "ready": false, "tool": false });
            }
            match world_of(o, &a0, true) {
                Some(p) => {
                    let size = std::fs::metadata(&p).map_or(0, |m| m.len());
                    json!({ "ready": true, "tool": true, "size": size })
                }
                None => json!({ "ready": false, "tool": true }),
            }
        }
        // the light map decor:scene made, as bytes alone: the shell hands those to the page raw
        "decor:map" => match world_of(o, &a0, false).and_then(|p| std::fs::read(p).ok()) {
            Some(b) => b64(&b),
            None => Value::Null,
        },
        // a catalog terrain for the map's 3D view: a whole map ({kind: "map"}, decor:scene draws it), or
        // a pak of materials put on the default map in place: what it hides, each other material's
        // picture and tint, the ground's layers (map_paint.rs). Its pictures come out side by side.
        "decor:paint" => {
            let file = crate::js::string(&a0);
            let (ud, game, glb) = {
                let c = o.core();
                (c.user_data.clone(), c.game(), c.glb.clone())
            };
            let Some(game) = game else { return Value::Null };
            if !crate::map_base::catalog_kept(&ud, &file) {
                let to = crate::map_base::catalog_map(&ud, &file);
                if let Err(e) = crate::owner_mods::download(o, "terrains", &file, &file)
                    .and_then(|zip| crate::map_base::take_catalog_map(&zip, &to))
                {
                    return json!({ "error": e });
                }
            }
            let pak = crate::map_base::catalog_pak(&ud, &file);
            if !pak.is_file() {
                return json!({ "kind": "map" });
            }
            crate::map_base::point_at_game(&game, &ud, &file);
            let Ok(ix) = crate::vpk::Index::open(&pak) else { return Value::Null };
            let look = crate::map_paint::pak_look(&ix);
            let key =
                pak.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let pictures = glb.sprites_in(&pak, &key, &look.textures());
            let png = |t: &str| pictures.get(t).cloned().flatten().map(|b| b64(&b));
            let plain: Map<String, Value> = look
                .plain
                .iter()
                .map(|(n, (t, tint))| (n.clone(), json!({ "png": t.as_deref().and_then(png), "tint": tint })))
                .collect();
            let grounds: Map<String, Value> = look
                .grounds
                .iter()
                .filter_map(|(n, layers)| {
                    let list: Vec<Value> = layers
                        .iter()
                        .filter_map(|(t, tint, scale)| Some(json!({ "png": png(t)?, "tint": tint, "scale": scale })))
                        .collect();
                    (list.len() == layers.len()).then(|| (n.clone(), Value::Array(list)))
                })
                .collect();
            pack(o, json!({ "kind": "pak", "hidden": look.hidden, "plain": plain, "grounds": grounds }))
        }
        // a catalog Trees mod for the map's 3D view: its archive downloaded as an install would,
        // its models unpacked (map_mod_trees.rs), and the tree models it brings
        "decor:modTrees" => {
            let file = crate::js::string(&a0);
            let (root, game) = {
                let c = o.core();
                (c.glb.loose_root(&format!("trees/{file}")), c.game())
            };
            let (Some(root), Some(game)) = (root, game) else { return Value::Null };
            if let Some(models) = crate::map_mod_trees::listed(&root) {
                return json!({ "models": models });
            }
            let zip = match crate::owner_mods::download(o, "trees", &file, &file) {
                Ok(p) => p,
                Err(e) => return json!({ "error": e }),
            };
            match crate::map_mod_trees::unpack(&zip, &root, &game.join("dota")) {
                Ok(models) => json!({ "models": models }),
                Err(e) => {
                    o.diag(&format!("decor mod trees: {e}"));
                    json!({ "error": e })
                }
            }
        }
        // one of those models as a GLB, its pictures inside
        "decor:modModel" => {
            let (file, model) = (crate::js::string(&a0), crate::js::string(args.get(1).unwrap_or(&Value::Null)));
            let glb = o.core().glb.clone();
            let Some(root) = glb.loose_root(&format!("trees/{file}")) else { return Value::Null };
            match glb.loose(&root, &model).map(|p| crate::glb_embed::embed_glb(&p)) {
                Some(Ok(b)) => pack(o, b64(&b)),
                Some(Err(e)) => {
                    o.diag(&format!("decor mod model: {e}"));
                    Value::Null
                }
                None => Value::Null,
            }
        }
        // another map's ground for the map's 3D view: for each of the map's grounds it has one for,
        // that ground's layers, each picture as a PNG out of the toolchain, its tint and its scale
        // (word, facets): an empty word is this map's own ground; facets ("small", "large") turn each
        // picture into flat triangles of its own colours (ground_facets.rs), as the build does
        "decor:ground" => {
            let word = Some(crate::js::string(&a0)).filter(|w| !w.is_empty() && w != "undefined" && w != "null");
            let facets = args.get(1).and_then(Value::as_str).and_then(crate::ground_facets::Facets::parse);
            let (pairs, pak, glb) = {
                let c = o.core();
                let game = c.game();
                let decor = crate::map_decor::MapDecor::new(game.clone());
                let pairs = match &word {
                    Some(w) => decor.ground_pairs_of(&c.installer, w).unwrap_or_default(),
                    None => decor
                        .own_grounds(&c.installer)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|m| (m.clone(), m))
                        .collect(),
                };
                let pak =
                    game.and_then(|g| crate::vpk_shared::shared_index(&g.join("dota").join("pak01_dir.vpk")).ok());
                (pairs, pak, c.glb.clone())
            };
            let Some(pak) = pak else { return Value::Null };
            let mut rows = Vec::new();
            let mut textures: Vec<String> = Vec::new();
            for (ours, theirs) in &pairs {
                let file = pak.read(&format!("{theirs}_c")).ok().flatten();
                let Some(m) = crate::loadout_material::read_loadout_material(file.as_deref()) else { continue };
                let layers = crate::map_ground::layers_of(&m);
                for l in &layers {
                    if !textures.contains(&l.0) {
                        textures.push(l.0.clone());
                    }
                }
                rows.push((ours.clone(), layers));
            }
            let mut pictures = glb.sprites(&textures);
            if let Some(f) = facets {
                for png in pictures.values_mut().flatten() {
                    if let Ok(made) = crate::ground_facets::facet_png(png, f) {
                        *png = made;
                    }
                }
            }
            let mut out = Map::new();
            for (ours, layers) in rows {
                let list: Vec<Value> = layers
                    .iter()
                    .filter_map(|(t, tint, scale)| {
                        let png = pictures.get(t).cloned().flatten()?;
                        Some(json!({ "png": b64(&png), "tint": tint, "scale": scale }))
                    })
                    .collect();
                if !list.is_empty() && list.len() == layers.len() {
                    out.insert(ours, Value::Array(list));
                }
            }
            pack(o, json!({ "materials": out }))
        }
        "preview3d:model" => {
            let i = inputs(o);
            if !i.tool {
                return Value::Null;
            }
            match crate::hero_preview::model(i.glb.as_ref(), &crate::js::string(&a0)) {
                Ok(Some(b)) => pack(o, b64(&b)),
                Ok(None) => Value::Null,
                Err(e) => {
                    o.diag(&format!("preview 3d model: {e}"));
                    Value::Null
                }
            }
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}
