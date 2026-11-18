//! The particles of a hero's 3D preview, out of the game's files alone (src/hero-preview-fx.ts):
//! each worn part's, the body's and the hero's own. They need no exported model, so they are
//! gathered before the models export; a part is named by its place in the plan's parts, and
//! `for_parts` moves each to its place among those that exported.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::hero_particle_styles::{blade_snapshots, replace_terrorblade_blade_fx, style_particle_roots};
use crate::hero_preview_picks::preview_particle_read;
use crate::model_particles::model_particle_entries;
use crate::particle_spec::{bind_item_particle, model_attachments, particle_def};

/// One worn part of the plan.
#[derive(Debug, Clone, Default)]
pub struct FxPart {
    pub slot: String,
    pub model: String,
    pub style: f64,
    pub fx: Vec<String>,
    pub replacements: Option<IndexMap<String, String>>,
}

/// What of the plan the particles read (src/hero-preview.ts plan).
pub struct FxPlan<'a> {
    pub body: String,
    pub body_fx: Vec<String>,
    pub hero_fx: Vec<String>,
    pub replacements: IndexMap<String, String>,
    /// an unusual effect bound to a system, by the system's path
    pub bindings: IndexMap<String, Value>,
    pub read: &'a dyn Fn(&str) -> Option<Vec<u8>>,
    pub parts: Vec<FxPart>,
}

/// One particle: on a part by its place in the plan's parts, on the body (-1), or the hero's own (-2).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PlannedFx {
    pub part: i64,
    pub def: Value,
}

fn compiled(model: &str) -> String {
    match model.len().checked_sub(5).and_then(|i| model.get(i..)) {
        Some(end) if end.eq_ignore_ascii_case(".vmdl") => format!("{}.vmdl_c", &model[..model.len() - 5]),
        _ => model.to_string(),
    }
}

/// What a system was loaded as, for the MM_PREVIEW_FX log.
pub fn particle_report(def: &Value) -> Value {
    let mut out = Map::new();
    out.insert("path".into(), def.get("path").cloned().unwrap_or(Value::Null));
    if let Some(n) = def.get("snapshot").and_then(Value::as_array).map(Vec::len) {
        out.insert("snapshotPoints".into(), json!(n));
    }
    let snaps: Map<String, Value> = def
        .get("snapshots")
        .and_then(Value::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), json!(v.as_array().map_or(0, Vec::len)))).collect())
        .unwrap_or_default();
    out.insert("snapshots".into(), Value::Object(snaps));
    for k in ["delay", "endcap", "childGroup", "tree"] {
        if let Some(v) = def.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    let children = def
        .get("children")
        .and_then(Value::as_array)
        .map(|c| c.iter().map(particle_report).collect())
        .unwrap_or_default();
    out.insert("children".into(), Value::Array(children));
    Value::Object(out)
}

/// Every particle the preview plays for the plan, at most 256 systems in all.
pub fn preview_particles(p: &FxPlan, log: Option<&dyn Fn(&str)>) -> Result<Vec<PlannedFx>, String> {
    let mut particles: Vec<PlannedFx> = Vec::new();
    let mut budget: i64 = 256;
    let none = HashMap::new();
    let suppress = p.parts.iter().any(|part| {
        let fx: Vec<String> =
            part.fx.iter().map(|f| part.replacements.as_ref().and_then(|r| r.get(f)).unwrap_or(f).clone()).collect();
        part.slot.ends_with(":weapon") && replace_terrorblade_blade_fx(&p.body, &part.model, &fx)
    });
    let empty = IndexMap::new();
    for (index, x) in p.parts.iter().enumerate() {
        let Some(model) = (p.read)(&compiled(&x.model)) else { continue };
        let entries: Vec<(String, String)> =
            model_particle_entries(Some(&model)).into_iter().map(|l| (l.path, l.config)).collect();
        let roots = style_particle_roots(&entries, &x.fx, x.style);
        let mut resolved: IndexMap<String, ()> = IndexMap::new();
        let own = x.replacements.as_ref();
        let mut read_part = |f: &str| preview_particle_read(p.read, &p.replacements, own, suppress, f);
        for (path, config) in &roots {
            let replacement =
                own.and_then(|r| r.get(path)).or_else(|| p.replacements.get(path)).unwrap_or(path).clone();
            if resolved.contains_key(&replacement) {
                continue;
            }
            resolved.insert(replacement.clone(), ());
            if let Some(def) = particle_def(&mut read_part, &replacement, &mut budget, 0, &none) {
                let def = blade_snapshots(&def, own.unwrap_or(&empty))?;
                let binding = p.bindings.get(&replacement).or_else(|| p.bindings.get(path));
                particles.push(PlannedFx { part: index as i64, def: bind_item_particle(&def, binding, config) });
            }
        }
        if let Some(log) = log.filter(|_| std::env::var_os("MM_PREVIEW_FX").is_some_and(|v| !v.is_empty())) {
            let attachments: Vec<Value> =
                model_attachments(Some(&model)).iter().map(|a| json!([a["name"], a["bone"]])).collect();
            let loaded: Vec<Value> =
                particles.iter().filter(|e| e.part == index as i64).map(|e| particle_report(&e.def)).collect();
            let requested: Vec<&String> = resolved.keys().collect();
            let line = json!({ "slot": x.slot, "model": x.model, "attachments": attachments, "requested": requested, "loaded": loaded });
            log(&format!("preview fx: {}", crate::js::stringify(&line, "")));
        }
    }
    let mut roots: HashSet<String> = HashSet::new();
    let mut read_particle = |f: &str| preview_particle_read(p.read, &p.replacements, None, suppress, f);
    let mut own = |part: i64, paths: &[String], particles: &mut Vec<PlannedFx>| {
        for root in paths {
            let particle = p.replacements.get(root).unwrap_or(root).clone();
            if !roots.insert(particle.clone()) {
                continue;
            }
            if let Some(def) = particle_def(&mut read_particle, &particle, &mut budget, 0, &none) {
                let binding = p.bindings.get(&particle).or_else(|| p.bindings.get(root));
                particles.push(PlannedFx { part, def: bind_item_particle(&def, binding, "preview") });
            }
        }
    };
    let body: Vec<String> =
        model_particle_entries((p.read)(&compiled(&p.body)).as_deref()).into_iter().map(|l| l.path).collect();
    own(-1, &body, &mut particles);
    let hero: Vec<String> = p.body_fx.iter().chain(&p.hero_fx).cloned().collect();
    own(-2, &hero, &mut particles);
    if particles.is_empty() && p.body.to_lowercase().ends_with("/wisp/wisp.vmdl") {
        own(-2, &["particles/units/heroes/hero_wisp/wisp_ambient.vpcf".to_string()], &mut particles);
    }
    Ok(particles)
}

/// The particles with each part's place among the parts that exported; a part whose model did not
/// come takes its particles with it. `placed`: for each part of the plan, its place, or -1.
pub fn for_parts(particles: Vec<PlannedFx>, placed: &[i64]) -> Vec<PlannedFx> {
    if placed.iter().enumerate().all(|(i, &at)| at == i as i64) {
        return particles;
    }
    particles
        .into_iter()
        .filter_map(|x| {
            if x.part < 0 {
                return Some(x);
            }
            match placed.get(x.part as usize) {
                Some(&at) if at >= 0 => Some(PlannedFx { part: at, ..x }),
                _ => None,
            }
        })
        .collect()
}
