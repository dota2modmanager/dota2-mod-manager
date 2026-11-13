//! The models of a hero as the item builder dresses it, for the 3D preview in the hero's window
//! (src/hero-preview.ts): the body, and for each slot the item picked there, or the stock item
//! where none is. `plan` reads all of it out of the game's files and the table; `models` exports
//! what the plan names and hands the window each model's bytes with its pictures inside.

use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};

use crate::hero_preview_picks as picks;
use crate::item_builder_assets::normalize_asset_path as norm;
use crate::model_loadout::{self as loadout, Motion};

type R<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

/// The clip a body without a loadout sequence stands in (Lone Druid, Magnus).
const IDLE: &str = "idle";

/// One worn model of the plan.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanPart {
    pub slot: String,
    pub name: String,
    pub model: String,
    pub skin: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_base_style: Option<bool>,
    /// Some(None) where the part is the Crest and the game has no golden rig for it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crest_rig: Option<Option<String>>,
    pub fx: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacements: Option<IndexMap<String, String>>,
    pub clip: Option<String>,
    pub hidden: Vec<String>,
}

/// What the preview shows of a hero, before anything exports.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub body: String,
    pub body_skin: f64,
    pub body_fx: Vec<String>,
    pub replacements: IndexMap<String, String>,
    pub clip: Option<String>,
    pub idle: String,
    pub motions: Vec<Motion>,
    pub stage: Value,
    pub hero_fx: Vec<String>,
    #[serde(skip)]
    pub bindings: IndexMap<String, Value>,
    pub parts: Vec<PlanPart>,
    /// the body's meshes the items worn turn off
    pub hidden: Vec<String>,
}

fn compiled(model: &str) -> String {
    match model.len().checked_sub(5).and_then(|i| model.get(i..)) {
        Some(end) if end.eq_ignore_ascii_case(".vmdl") => format!("{}.vmdl_c", &model[..model.len() - 5]),
        _ => model.to_string(),
    }
}

fn ends_vmdl(m: &str) -> bool {
    m.len() >= 5 && m.get(m.len() - 5..).is_some_and(|e| e.eq_ignore_ascii_case(".vmdl"))
}

fn truthy_str(v: Option<&Value>) -> Option<String> {
    v.filter(|x| crate::js::truthy(x)).map(crate::js::string)
}

/// `String(x)` as JavaScript writes it, "undefined" for a missing key.
fn js_str(v: Option<&Value>) -> String {
    v.map_or("undefined".into(), crate::js::string)
}

fn ids_of(key: Option<&str>) -> Vec<String> {
    key.unwrap_or("").split(',').map(String::from).collect()
}

/// An item's block as the TypeScript's findItem hands it.
struct Found {
    id: String,
    start: usize,
    end: usize,
}

fn find(text: &[u8], id: &str) -> R<Option<Found>> {
    Ok(crate::schema::find_item(text, id, None).map_err(err)?.map(|(start, end)| Found { id: id.into(), start, end }))
}

struct Fields(Vec<(String, String)>);

impl Fields {
    fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
    }
    /// `get(k) || ''`, an empty value as none
    fn some(&self, k: &str) -> Option<&str> {
        self.get(k).filter(|v| !v.is_empty())
    }
}

fn fields(text: &[u8], f: &Found) -> R<Fields> {
    Ok(Fields(crate::schema::item_fields(text, f.start).map_err(err)?))
}

struct Row {
    slot: String,
    rec: Option<Value>,
    stock: Option<Fields>,
    picked: Option<Value>,
    block: Option<Found>,
    worn: Option<Found>,
    visuals: Option<Vec<u8>>,
    raw_model: String,
    chosen_style: u64,
    explicit_base_style: bool,
}

fn io_body(model: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)/(?:io_ti7|io_calavera|dark_carnival_io)\.vmdl$").unwrap())
        .is_match(&norm(model))
}

fn explicit_base(key: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|,)style-0(?:,|$)").unwrap()).is_match(key)
}

/// `Number(x) || 0` for a field's text.
fn number_or_zero(v: Option<&str>) -> f64 {
    let n = v.map_or(0.0, |s| crate::js::to_number(&json!(s)));
    if n.is_nan() {
        0.0
    } else {
        n
    }
}

fn skin_u64(n: f64) -> u64 {
    if n.is_finite() && n > 0.0 {
        n as u64
    } else {
        0
    }
}

/// The game's pieces the plan reads.
pub struct Game<'a> {
    pub read: &'a dyn Fn(&str) -> Option<Vec<u8>>,
    pub has: &'a dyn Fn(&str) -> bool,
    pub paths: &'a dyn Fn() -> Vec<String>,
}

/// What the preview shows of `name` in `slots`, with the library's installed cosmetics worn
/// where the slots pick nothing.
pub fn plan(text: &[u8], game: &Game, library: &[Value], name: &str, slots: &[Value], log: &dyn Fn(&str)) -> R<Plan> {
    let hero = if name.starts_with("npc_dota_hero_") { name.to_string() } else { format!("npc_dota_hero_{name}") };
    let short = hero.strip_prefix("npc_dota_hero_").unwrap_or(&hero).to_string();
    let read = game.read;
    let mut body = norm(&crate::item_builder_assets::hero_model_path(read, &hero)?);
    let mut parts: Vec<PlanPart> = Vec::new();
    let mut hides: IndexMap<String, IndexMap<String, f64>> = IndexMap::new();
    let (mut modifiers, mut body_fx): (Vec<String>, Vec<String>) = (vec![], vec![]);
    let mut replacements: IndexMap<String, String> = IndexMap::new();
    let mut authored_body_skin: Option<f64> = None;
    let mut body_skin_visuals: Vec<(Vec<u8>, String)> = vec![];
    let mut swaps: IndexMap<String, IndexMap<String, String>> = IndexMap::new();
    let layouts = crate::item_builder_slots::persona_layouts(text).map_err(err)?;
    let given: IndexMap<String, Option<String>> = layouts
        .get(&short)
        .map(|l| l.parts.iter().map(|x| (x.slot.clone(), x.given.as_ref().map(|g| g.id.clone()))).collect())
        .unwrap_or_default();
    let installed: Vec<Value> = library
        .iter()
        .filter(|r| {
            r.get("categoryId").and_then(Value::as_str) == Some("cosmetic")
                && r.get("enabled") != Some(&Value::Bool(false))
                && r.get("itemId").is_some_and(crate::js::truthy)
        })
        .cloned()
        .collect();
    let equipped = picks::preview_equipment(text, &installed, slots)?;
    let slots = picks::persona_preview_slots(text, &hero, slots, &equipped)?;
    let crown = picks::monkey_king_crown(text, &hero, &equipped)?;
    let crown = (!crown.is_null()).then(|| Found {
        id: crate::js::string(&crown["id"]),
        start: crown["start"].as_u64().unwrap_or(0) as usize,
        end: crown["end"].as_u64().unwrap_or(0) as usize,
    });
    let arcana = crown.as_ref().and_then(|_| equipped.iter().find(|r| js_str(r.get("itemId")) == "9050"));
    let slot_of = |s: &Value| s.get("slot").map(crate::js::string).unwrap_or_default();

    let mut rows: Vec<Row> = Vec::new();
    for s in &slots {
        let slot = slot_of(s);
        let rec = equipped.iter().find(|r| r.get("slot") == Some(&json!(slot))).cloned();
        let crowned = rec.is_none() && slot.ends_with(":head") && crown.is_some();
        let stock_item = if crowned {
            crown.as_ref().map(|c| Found { id: c.id.clone(), start: c.start, end: c.end })
        } else {
            let last = slot.rsplit(':').next().unwrap_or("");
            let id =
                given.get(last).cloned().flatten().filter(|g| !g.is_empty()).unwrap_or_else(|| js_str(s.get("stock")));
            find(text, &id)?
        };
        let stock = stock_item.as_ref().map(|f| fields(text, f)).transpose()?;
        let rec_id = rec.as_ref().map(|r| js_str(r.get("itemId")));
        let effect = rec.as_ref().and_then(|r| r.get("effectId")).filter(|v| !v.is_null()).map(crate::js::string);
        let picked = match &rec_id {
            Some(id) => Some(picks::item_model(
                text,
                id,
                effect.as_deref(),
                &hero,
                stock.as_ref().and_then(|f| f.some("model_player")),
            )?),
            None => None,
        };
        let block = match &rec_id {
            Some(id) => find(text, id)?,
            None => None,
        };
        let worn =
            block.as_ref().or(stock_item.as_ref()).map(|f| Found { id: f.id.clone(), start: f.start, end: f.end });
        let visuals = match &worn {
            Some(w) => crate::item_builder::item_visuals(text, w.start).map_err(err)?,
            None => None,
        };
        let raw_model = picked
            .as_ref()
            .and_then(|p| p.get("model"))
            .filter(|m| crate::js::truthy(m))
            .map(crate::js::string)
            .or_else(|| stock.as_ref().and_then(|f| f.some("model_player")).map(String::from))
            .unwrap_or_default();
        let key = match rec.as_ref().and_then(|r| r.get("effectId")).filter(|v| !v.is_null()) {
            Some(v) => crate::js::string(v),
            None if crowned => arcana
                .and_then(|a| a.get("effectId"))
                .filter(|v| !v.is_null())
                .map(crate::js::string)
                .unwrap_or_default(),
            None => String::new(),
        };
        let chosen_style = crate::item_builder_styles::style_of(&key);
        let explicit_base_style =
            explicit_base(&truthy_str(rec.as_ref().and_then(|r| r.get("effectId"))).unwrap_or_default());
        rows.push(Row { slot, rec, stock, picked, block, worn, visuals, raw_model, chosen_style, explicit_base_style });
    }
    let mut family_styles: IndexMap<String, u64> = IndexMap::new();
    for row in &rows {
        let family = crate::model_style_meshes::style_family(&row.raw_model);
        if !family.is_empty() && row.chosen_style > 0 {
            family_styles.insert(family, row.chosen_style);
        }
    }
    for row in &rows {
        let Row { slot, rec, stock, picked, block, worn, visuals, raw_model, explicit_base_style, .. } = row;
        let family = crate::model_style_meshes::style_family(raw_model);
        let chosen_style = if *explicit_base_style {
            0
        } else if row.chosen_style > 0 {
            row.chosen_style
        } else {
            family_styles.get(&family).copied().unwrap_or(0)
        };
        let styled = match visuals {
            Some(v) => Some(crate::item_builder_styles::with_style(v, chosen_style).map_err(err)?),
            None => None,
        };
        let styled_model = styled.as_ref().and_then(|s| s.1.as_ref()).map(|m| latin1(m));
        let model = styled_model.filter(|m| !m.is_empty() && ends_vmdl(m)).unwrap_or_else(|| raw_model.clone());
        let rec_id = rec.as_ref().map(|r| js_str(r.get("itemId")));
        let id = rec_id.clone().unwrap_or_default();
        let is_io = hero == "npc_dota_hero_wisp" && rec.is_some() && io_body(&model);
        let body_slot = slot.ends_with(":hero_base");
        let styled_visuals = styled.as_ref().map(|s| latin1(&s.0));
        let applied = styled.as_ref().is_some_and(|s| s.2);
        let swap = styled_visuals
            .as_deref()
            .and_then(|v| picks::entity_model(v, &hero))
            .filter(|m| !m.is_empty())
            .or_else(|| {
                picked.as_ref().and_then(|p| p.get("body")).filter(|b| crate::js::truthy(b)).map(crate::js::string)
            })
            .or_else(|| (is_io || (body_slot && rec.is_some())).then(|| model.clone()).filter(|m| !m.is_empty()));
        if let Some(sw) = &swap {
            body = norm(sw);
        }
        if let (Some(_), Some(v)) = (rec, styled.as_ref().map(|s| &s.0).filter(|v| !v.is_empty())) {
            body_skin_visuals.push((v.clone(), id.clone()));
        }
        if let Some(b) = block {
            let source =
                if applied { styled_visuals.clone().unwrap_or_default() } else { latin1(&text[b.start..b.end]) };
            modifiers.extend(crate::razor_crest_preview::crest_activities(text, &id, &source)?);
            if id == "7571" {
                modifiers.push("aeons".into());
            }
        }
        let fx_source: Vec<u8> = if applied {
            styled.as_ref().map(|s| s.0.clone()).unwrap_or_default()
        } else if let Some(b) =
            picked.as_ref().and_then(|p| p.get("block")).and_then(Value::as_str).filter(|b| !b.is_empty())
        {
            b.chars().map(|c| c as u8).collect()
        } else {
            worn.as_ref().map(|w| text[w.start..w.end].to_vec()).unwrap_or_default()
        };
        let roots = crate::particle_spec::item_particles(&fx_source);
        // the pak's whole listing only for the Crest, which looks there for its glow
        let paths = if id == "6646" { (game.paths)() } else { vec![] };
        let fx = picks::preview_crest_particles(&roots, &model, &id, paths.iter().map(String::as_str));
        let fallback_skin = match worn {
            Some(w) => number_or_zero(fields(text, w)?.get("skin")),
            None => 0.0,
        };
        let skin = match &styled {
            Some(s) => {
                crate::item_skin::worn_skin(&s.0, skin_u64(fallback_skin), Some(&norm(&model))).map_err(err)? as f64
            }
            None => fallback_skin,
        };
        let (style, explicit) = if chosen_style > 0 {
            (Some(chosen_style as f64), None)
        } else if *explicit_base_style {
            (None, Some(true))
        } else {
            (None, None)
        };
        if body_slot || swap.is_some() || is_io || id == "34368" {
            if let Some(s) = &styled {
                replacements.extend(picks::preview_particle_replacements(&s.0, false)?);
            }
            if is_io {
                if let Some(r) = picked.as_ref().and_then(|p| p.get("replacements")).and_then(Value::as_object) {
                    for (k, v) in r {
                        replacements.insert(k.clone(), crate::js::string(v));
                    }
                }
            }
            if rec.is_some() && (body_slot || swap.is_some()) {
                let fb = if fallback_skin != 0.0 {
                    fallback_skin
                } else if id == "7247" {
                    chosen_style as f64
                } else {
                    0.0
                };
                let v = styled.as_ref().map(|s| s.0.as_slice()).unwrap_or(b"");
                authored_body_skin = Some(crate::item_skin::worn_skin(v, skin_u64(fb), None).map_err(err)? as f64);
            }
        }
        let name = rec
            .as_ref()
            .and_then(|r| truthy_str(r.get("name")))
            .or_else(|| stock.as_ref().and_then(|f| f.some("name")).map(String::from))
            .unwrap_or_default();
        if model.is_empty() || is_io || body_slot || norm(&model) == body {
            body_fx.extend(fx);
        } else {
            let picked_reps: Option<IndexMap<String, String>> = picked
                .as_ref()
                .and_then(|p| p.get("replacements"))
                .and_then(Value::as_object)
                .map(|o| o.iter().map(|(k, v)| (k.clone(), crate::js::string(v))).collect());
            let reps = if hero == "npc_dota_hero_terrorblade" && slot.ends_with(":weapon") {
                picks::preview_blade_replacements(picked_reps.as_ref(), styled.as_ref().map(|s| s.0.as_slice()))?
            } else {
                picked_reps.filter(|r| !r.is_empty())
            };
            let crest_rig = (id == "6646")
                .then(|| crate::razor_crest_preview::golden_crest_model(text, &norm(&model), "6646"))
                .transpose()?;
            parts.push(PlanPart {
                slot: slot.clone(),
                name: name.clone(),
                model: norm(&model),
                skin,
                style,
                explicit_base_style: explicit,
                crest_rig,
                fx,
                replacements: reps,
                clip: None,
                hidden: vec![],
            });
        }
        if worn.is_some() {
            let source = styled_visuals
                .clone()
                .filter(|v| !v.is_empty())
                .or_else(|| visuals.as_ref().map(|v| latin1(v)).filter(|v| !v.is_empty()))
                .unwrap_or_else(|| worn.as_ref().map(|w| latin1(&text[w.start..w.end])).unwrap_or_default());
            let also = picks::worn_extras(&source);
            for extra in also["models"].as_array().into_iter().flatten() {
                parts.push(PlanPart {
                    slot: slot.clone(),
                    name: name.clone(),
                    model: crate::js::string(extra),
                    style,
                    explicit_base_style: explicit,
                    ..Default::default()
                });
            }
            for g in also["groups"].as_array().into_iter().flatten() {
                hides
                    .entry(crate::js::string(&g["model"]))
                    .or_default()
                    .insert(crate::js::string(&g["group"]), g["value"].as_f64().unwrap_or(0.0));
            }
        }
        if let Some(id) = rec_id {
            let effect = rec.as_ref().and_then(|r| r.get("effectId")).filter(|v| !v.is_null()).map(crate::js::string);
            let made = crate::item_builder_refits::pick_models(text, &id, &ids_of(effect.as_deref())).map_err(err)?;
            swaps.insert(slot.clone(), made.map(|m| m.swaps).unwrap_or_default());
        }
    }
    if let Some(to) = swaps.values().find_map(|made| made.get(&body).cloned()) {
        body = to;
    }
    let head_slot = slots.iter().map(slot_of).find(|s| s.ends_with(":head"));
    let hat = head_slot.as_ref().is_some_and(|h| equipped.iter().any(|r| r.get("slot") == Some(&json!(h))));
    let stock_head = picks::preview_stock_head(text, &hero, &body, game.has, hat)?;
    if let Some(head) = stock_head {
        if !parts.iter().any(|p| p.slot.ends_with(":body_head") || p.model == head) {
            parts.push(PlanPart { slot: "body_head".into(), name: "Head".into(), model: head, ..Default::default() });
        }
    }
    let body_family = crate::model_style_meshes::style_family(&body);
    let mut targeted: Option<f64> = None;
    for (visuals, item) in &body_skin_visuals {
        let implicit = hero == "npc_dota_hero_primal_beast" && item == "24736";
        if let Some(s) = picks::body_skin_for(visuals, &hero, &body, implicit)? {
            targeted = Some(s);
        }
    }
    let body_skin = match targeted {
        Some(s) => s,
        None if !body_family.is_empty() && family_styles.contains_key(&body_family) => {
            family_styles[&body_family] as f64
        }
        None => authored_body_skin.unwrap_or(0.0),
    };
    for x in parts.iter_mut() {
        for (slot, made) in &swaps {
            if *slot != x.slot {
                x.model = norm(made.get(&x.model).filter(|m| !m.is_empty()).unwrap_or(&x.model));
            }
        }
        let file = read(&compiled(&x.model));
        x.clip = loadout::wearable_clip(&loadout::model_sequences(file.as_deref()));
        if let (Some(off), Some(f)) = (hides.get(&x.model), &file) {
            x.hidden = crate::model_bodygroups::hidden_meshes(f, off)?;
        }
    }
    let body_file = read(&compiled(&body));
    let hidden = match (hides.get(&body), &body_file) {
        (Some(off), Some(f)) => crate::model_bodygroups::hidden_meshes(f, off)?,
        _ => vec![],
    };
    let seqs = loadout::model_sequences(body_file.as_deref());
    let clip = loadout::loadout_sequence(&seqs, &modifiers).or_else(|| {
        if hero == "npc_dota_hero_wisp" {
            loadout::wearable_clip(&seqs)
        } else {
            None
        }
    });
    let idle = loadout::idle_sequence(&seqs).filter(|s| !s.is_empty()).unwrap_or_else(|| IDLE.into());
    let script = read(&format!("scripts/npc/heroes/{hero}.txt"));
    let stage = crate::hero_showcase::hero_stage(
        read("scripts/npc/portraits_showcase.txt").as_deref(),
        script.as_deref(),
        &[body.clone(), hero.clone()],
    );
    let bindings: IndexMap<String, Value> = crate::unusual_effects::effects_of(text)
        .map_err(err)?
        .iter()
        .map(|e| (e.system.to_lowercase(), serde_json::to_value(e).unwrap_or(Value::Null)))
        .collect();
    if hero == "npc_dota_hero_razor" && std::env::var_os("MM_PREVIEW_FX").is_some_and(|v| !v.is_empty()) {
        let head: Vec<&PlanPart> = parts.iter().filter(|p| p.slot.ends_with(":head")).collect();
        log(&format!(
            "razor preview plan: {}",
            crate::js::stringify(
                &json!({ "body": body, "clip": clip, "idle": idle, "modifiers": modifiers, "head": head }),
                ""
            )
        ));
    }
    let item_mods = loadout::item_modifiers(&latin1(text));
    let motions = loadout::motion_list(&seqs, &modifiers, &item_mods);
    let stock_weapon = !rows.iter().any(|r| r.slot.ends_with(":weapon") && r.rec.is_some());
    let hero_fx = picks::preview_hero_particles(script.as_deref(), &hero, stock_weapon, game.has)?;
    Ok(Plan { body, body_skin, body_fx, replacements, clip, idle, motions, stage, hero_fx, bindings, parts, hidden })
}
