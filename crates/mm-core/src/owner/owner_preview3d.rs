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
];

/// one warm-up at a time: a second would only queue behind the first's exports
static WARMING: AtomicBool = AtomicBool::new(false);

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn b64(b: &[u8]) -> Value {
    json!({ "$b64": base64::engine::general_purpose::STANDARD.encode(b) })
}

fn has_tool(c: &Core) -> bool {
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

fn pack(o: &Owner, v: Value) -> Value {
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

fn shown(m: &crate::hero_preview::Shown) -> Value {
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
