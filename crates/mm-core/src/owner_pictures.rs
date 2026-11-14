//! A picture for every tile (src/ipc-game.ts, the cosmetics and preview channels). A tile asks
//! with a chain of sources, best first ("modart:pak54_dir.vpk|hero:Brewmaster"), and gets the
//! first that has one: the mod's own files, then the game's own pictures, then the wiki. A clip
//! a mod carries is decoded by the window, which already has the decoder; its bytes go there and
//! the frame comes back to be judged and kept.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::mod_preview::{ModPreviews, ART, TEX, VID};
use crate::owner::{arg, Core, Owner, R};

pub const CHANNELS: &[&str] =
    &["cosmetics:heroPortraits", "cosmetics:heroPortraitsByName", "cosmetics:icons", "preview:video", "preview:frame"];

pub fn handle(o: &Owner, channel: &str, args: &[Value]) -> Option<R> {
    CHANNELS.contains(&channel).then(|| Ok(answer(o, channel, args)))
}

fn vrf(c: &Core) -> Option<std::path::PathBuf> {
    crate::toolchain::Toolchain::new(&c.user_data, None).path_of("vrf")
}

type Lines = Arc<Mutex<Vec<String>>>;

/// The mods' previews over the mod folder as it is now; their lines land in `lines`.
pub fn previews(c: &Core, lines: &Lines) -> ModPreviews {
    let tool = vrf(c);
    let mut files: HashMap<String, std::path::PathBuf> = HashMap::new();
    for rec in c.library.list() {
        for f in rec.get("files").and_then(Value::as_array).into_iter().flatten() {
            if f.get("root").and_then(Value::as_str) != Some("lang") {
                continue;
            }
            let Some(rel) = f.get("relPath").and_then(Value::as_str) else { continue };
            if let Ok(p) = c.installer.lang_file_on_disk(rel) {
                files.insert(rel.to_string(), p);
            }
        }
    }
    let out = lines.clone();
    ModPreviews::new(
        &c.user_data,
        Box::new(move || tool.clone()),
        Box::new(move |rel| files.get(rel).cloned()),
        Box::new(crate::mod_preview::PngImages),
        Box::new(|exe, args| crate::owner_tools::run_tool(&exe.to_string_lossy(), args)),
        Box::new(move |m| out.lock().unwrap_or_else(|e| e.into_inner()).push(m.to_string())),
    )
}

fn flush(o: &Owner, lines: &Lines) {
    for l in std::mem::take(&mut *lines.lock().unwrap_or_else(|e| e.into_inner())) {
        o.diag(&l);
    }
}

fn first(v: &Value, max: usize) -> Vec<Value> {
    v.as_array().map(|a| a.iter().take(max).cloned().collect()).unwrap_or_default()
}

fn to_object(m: IndexMap<String, String>) -> Value {
    Value::Object(m.into_iter().map(|(k, v)| (k, json!(v))).collect())
}

fn is_mod(s: &str) -> bool {
    s.starts_with(VID) || s.starts_with(ART) || s.starts_with(TEX)
}

fn key_of(v: &Value) -> String {
    if crate::js::truthy(v) {
        crate::js::string(v)
    } else {
        String::new()
    }
}

/// Pictures for the tiles' chains, and the clips still worth a frame from the window.
fn icons(o: &Owner, names: &Value) -> Value {
    let wanted: Vec<String> = first(names, 60).iter().map(crate::js::string).collect();
    let chains: Vec<(String, Vec<String>)> = wanted
        .iter()
        .map(|n| (n.clone(), n.split('|').filter(|s| !s.is_empty()).map(String::from).collect()))
        .collect();
    let mut sources: Vec<String> = Vec::new();
    for (_, chain) in &chains {
        for s in chain {
            if !sources.contains(s) {
                sources.push(s.clone());
            }
        }
    }
    let lines: Lines = Arc::new(Mutex::new(Vec::new()));
    let (prev, game, tool, game_icons, wiki) = {
        let c = o.core();
        (previews(&c, &lines), c.game(), vrf(&c), c.game_icons.clone(), c.wiki.clone())
    };
    let mut found: HashMap<String, Option<String>> = HashMap::new();
    let mods: Vec<String> = sources.iter().filter(|s| is_mod(s)).cloned().collect();
    for (k, v) in prev.get_many(&mods) {
        found.insert(k, Some(v));
    }
    let for_icons: Vec<String> =
        sources.iter().filter(|s| !is_mod(s) && found.get(*s).is_none_or(Option::is_none)).cloned().collect();
    if !for_icons.is_empty() {
        let mut log = |m: String| lines.lock().unwrap_or_else(|e| e.into_inner()).push(m);
        let from_game = game_icons.get_many(game.as_deref(), tool.as_deref(), &for_icons, &mut log);
        let left: Vec<String> = for_icons.iter().filter(|n| !from_game.contains_key(*n)).cloned().collect();
        if !left.is_empty() {
            for (k, v) in wiki.get_many(&left) {
                found.insert(k, v);
            }
        }
        for (k, v) in from_game {
            found.insert(k, Some(v));
        }
    }
    let hit = |s: &String| found.get(s).and_then(Clone::clone);
    let mut pictures = Map::new();
    let mut decode: Vec<String> = Vec::new();
    for (key, chain) in &chains {
        if let Some(p) = chain.iter().find_map(hit) {
            pictures.insert(key.clone(), json!(p));
        }
        // a clip beats everything a mod can be pictured by, but only the window can open one
        if let Some(clip) = chain.iter().find(|s| s.starts_with(VID)) {
            if hit(clip).is_none() && prev.has_video(clip) && !decode.contains(clip) {
                decode.push(clip.clone());
            }
        }
    }
    flush(o, &lines);
    json!({ "pictures": pictures, "decode": decode })
}

/// Heroes' portraits out of the game, by id.
fn portraits(o: &Owner, ids: &[Value], tall: bool) -> IndexMap<String, String> {
    let (game, tool, gi) = {
        let c = o.core();
        (c.game(), vrf(&c), c.game_icons.clone())
    };
    let mut lines = Vec::new();
    let got = gi.hero_portraits(game.as_deref(), tool.as_deref(), ids, tall, &mut |m| lines.push(m));
    for l in lines {
        o.diag(&l);
    }
    got
}

fn answer(o: &Owner, channel: &str, args: &[Value]) -> Value {
    let a0 = arg(args, 0);
    match channel {
        "cosmetics:heroPortraits" => to_object(portraits(o, &first(&a0, 300), arg(args, 1) == Value::Bool(true))),
        "cosmetics:heroPortraitsByName" => {
            let names: Vec<String> = first(&a0, 300).iter().map(crate::js::string).collect();
            let id_of: Vec<(String, Option<String>)> =
                names.iter().map(|n| (n.clone(), crate::hero_names::id_from_name(n))).collect();
            let mut ids: Vec<Value> = Vec::new();
            for id in id_of.iter().filter_map(|(_, id)| id.clone()) {
                if !ids.contains(&json!(id)) {
                    ids.push(json!(id));
                }
            }
            let got = portraits(o, &ids, false);
            let mut out = Map::new();
            for (n, id) in id_of {
                if let Some(p) = id.and_then(|id| got.get(&id).cloned()) {
                    out.insert(n, json!(p));
                }
            }
            Value::Object(out)
        }
        "cosmetics:icons" => icons(o, &a0),
        "preview:video" => {
            let lines: Lines = Arc::new(Mutex::new(Vec::new()));
            let prev = previews(&o.core(), &lines);
            let got = prev.video_bytes(&key_of(&a0));
            flush(o, &lines);
            match got {
                Some(b) => json!({ "$b64": base64::engine::general_purpose::STANDARD.encode(b) }),
                None => Value::Null,
            }
        }
        "preview:frame" => {
            let png = match crate::owner::bytes_of(&arg(args, 1)) {
                Ok(b) => b.unwrap_or_default(),
                Err(e) => {
                    o.diag(&format!("mod preview frame failed: {e}"));
                    return Value::Null;
                }
            };
            let lines: Lines = Arc::new(Mutex::new(Vec::new()));
            let prev = previews(&o.core(), &lines);
            let got = prev.save_frame(&key_of(&a0), Some(&png));
            flush(o, &lines);
            got.map(Value::String).unwrap_or(Value::Null)
        }
        _ => json!({ "error": format!("no handler for {channel}") }),
    }
}
