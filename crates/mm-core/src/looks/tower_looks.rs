//! Tower looks as a file mod (src/tower-looks.ts, issue #446). The items that dress the towers say
//! in their visuals which model the tower entity wears, which model stands in for each stage of its
//! destruction, and which particles it swaps. Those are files, so a pak can put them under the
//! default tower's names, for one side or both, with safe mode on. What a file cannot carry (a
//! particle the item creates, its sounds, level activities, skins) is left out and said.

use std::collections::HashMap;
use std::path::Path;

use indexmap::{IndexMap, IndexSet};
use regex::bytes::Regex as BytesRegex;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::item_visuals::{item_visuals, AssetModifier};
use crate::kv3::{Node, Value as Kv};
use crate::tree_sets::Planned;

/// The model every tower of a side wears; the map's tower entities name it.
pub fn default_tower(side: &str) -> &'static str {
    if side == "dire" {
        "models/props_structures/dire_tower002.vmdl"
    } else {
        "models/props_structures/radiant_tower002.vmdl"
    }
}

fn re(p: &str) -> Regex {
    Regex::new(p).expect("a fixed pattern")
}

fn is_entity(ty: &str) -> bool {
    re("^entity(_clientside)?_model$").is_match(ty)
}

/// The side an asset belongs to, by its name: the game names them for Radiant and Dire.
fn side_of(asset: &str) -> Option<&'static str> {
    if let Some(m) = re("^npc_dota_(goodguys|badguys)_tower").captures(asset) {
        return Some(if &m[1] == "goodguys" { "radiant" } else { "dire" });
    }
    if re("radiant|_good|good_|goodguys").is_match(asset) {
        return Some("radiant");
    }
    if re("dire|_bad|bad_|badguys").is_match(asset) {
        return Some("dire");
    }
    None
}

/// String.prototype.lastIndexOf: the last place at or before `from` where `needle` starts.
fn last_index_of(text: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    let end = (from + needle.len()).min(text.len());
    text[..end].windows(needle.len()).rposition(|w| w == needle)
}

/// The ids of the items whose visuals put a model on a tower, in the table's order.
pub fn tower_look_ids(text: &[u8]) -> Vec<String> {
    let asset = BytesRegex::new(r#"(?-u)"asset"[\t-\r \xA0]+"npc_dota_(?:goodguys|badguys)_tower[A-Za-z0-9_]*""#)
        .expect("a fixed pattern");
    let head = BytesRegex::new(r#"(?-u)^\n\t\t"([0-9]+)"[\t-\r \xA0]*\{"#).expect("a fixed pattern");
    let needle = b"\n\t\t\"";
    let mut ids: Vec<String> = Vec::new();
    for m in asset.find_iter(text) {
        // the item this modifier sits in: the nearest item key before it, two tabs in
        let mut id = String::new();
        let mut at = last_index_of(text, needle, m.start());
        while let Some(a) = at.filter(|&a| a > 0 && id.is_empty()) {
            if let Some(c) = head.captures(&text[a..]) {
                id = String::from_utf8_lossy(&c[1]).into_owned();
            }
            at = last_index_of(text, needle, a - 1);
        }
        if !id.is_empty() && !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

/// Every look the table has, with the sides each dresses and the tower model it puts on each.
pub fn tower_looks(text: &[u8]) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for id in tower_look_ids(text) {
        let v = item_visuals(text, &id).map_err(|e| e.to_string())?;
        let mut sides: IndexSet<&str> = IndexSet::new();
        let mut models = Map::new();
        for m in v.as_ref().map(|v| v.modifiers.as_slice()).unwrap_or(&[]) {
            if !is_entity(&m.ty) {
                continue;
            }
            if let Some(s) = side_of(&m.asset) {
                sides.insert(s);
                if !m.modifier.is_empty() && !models.contains_key(s) {
                    models.insert(s.into(), json!(m.modifier));
                }
            }
        }
        let name = v.as_ref().map(|v| v.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone());
        let sides: Vec<&str> = ["radiant", "dire"].into_iter().filter(|s| sides.contains(s)).collect();
        if !sides.is_empty() {
            out.push(json!({ "id": id, "name": name, "sides": sides, "models": models }));
        }
    }
    Ok(out)
}

fn compiled(p: &str) -> String {
    let ext = re(r"(?i)\.(vmdl|vpcf)$");
    format!("{}_c", ext.replace(p, |c: &regex::Captures| c[0].to_lowercase()))
}

/// What a look's visuals put under which name for one side, and what it leaves out.
pub fn tower_plan(modifiers: &[AssetModifier], side: &str) -> (Vec<Planned>, Vec<String>) {
    let mut files: IndexMap<String, String> = IndexMap::new();
    let mut skipped: IndexSet<String> = IndexSet::new();
    for m in modifiers {
        if is_entity(&m.ty) {
            // one model for all ten towers of the side: the last one named wins, as they are all the same
            if side_of(&m.asset) == Some(side) && !m.modifier.is_empty() {
                files.insert(compiled(default_tower(side)), compiled(&m.modifier));
            }
        } else if m.ty == "model" || m.ty == "particle" || m.ty == "particle_clientside" {
            if !m.asset.is_empty() && !m.modifier.is_empty() && side_of(&m.asset) == Some(side) {
                files.insert(compiled(&m.asset), compiled(&m.modifier));
            }
        } else if side_of(if m.asset.is_empty() { &m.modifier } else { &m.asset }).unwrap_or(side) == side {
            // named for the other side: that side's pak says it
            let what = if m.modifier.is_empty() { m.ty.clone() } else { format!("{} {}", m.ty, m.modifier) };
            skipped.insert(what);
        }
    }
    (files.into_iter().map(|(at, from)| Planned { at, from }).collect(), skipped.into_iter().collect())
}

/// What building towers made: the pak, the looks' names, how many files, what the game lacked, and
/// what a file cannot carry.
#[derive(Debug, Clone)]
pub struct Towers {
    pub vpk: Vec<u8>,
    pub names: Vec<String>,
    pub files: usize,
    pub missing: Vec<String>,
    pub skipped: Vec<String>,
}

/// Each side's towers in a look of its own, or as they are where its id is None: one VPK out of pak01.
pub fn build_towers(pak01: &Path, text: &[u8], radiant: Option<&str>, dire: Option<&str>) -> Result<Towers, String> {
    let mut files: Vec<Planned> = Vec::new();
    let mut skipped: IndexSet<String> = IndexSet::new();
    let mut names: Vec<String> = Vec::new();
    for (side, id) in [("radiant", radiant), ("dire", dire)] {
        let Some(id) = id.filter(|i| !i.is_empty()) else { continue };
        let v = item_visuals(text, id).map_err(|e| e.to_string())?.ok_or_else(|| format!("towers: no item {id}"))?;
        let (plan, left) = tower_plan(&v.modifiers, side);
        if !plan.iter().any(|f| f.at == compiled(default_tower(side))) {
            return Err(format!("towers: {} has no {side} tower", v.name));
        }
        files.extend(plan);
        skipped.extend(left);
        if !names.contains(&v.name) {
            names.push(v.name);
        }
    }
    if files.is_empty() {
        return Err("towers: pick a look for Radiant or Dire".into());
    }
    let index = crate::vpk_shared::shared_index(pak01).map_err(|e| e.to_string())?;
    let towers = [compiled(default_tower("radiant")), compiled(default_tower("dire"))];
    let mut entries = Vec::new();
    let mut missing = Vec::new();
    for f in files {
        let data = index.read(&f.from).map_err(|e| e.to_string())?;
        let plain = if towers.contains(&f.at) { index.read(&f.at).map_err(|e| e.to_string())? } else { None };
        match data {
            Some(d) => {
                let bytes = match plain {
                    Some(p) => as_tower(&d, &p),
                    None => d,
                };
                entries.push(crate::vpk::entry_at(&f.at, std::sync::Arc::from(bytes)));
            }
            None => missing.push(f.from),
        }
    }
    let n = entries.len();
    Ok(Towers { vpk: crate::vpk::build(&entries), names, files: n, missing, skipped: skipped.into_iter().collect() })
}

/// The activities a look's tower plays while the item is on, and the plain tower's for each.
fn plain_act(name: &str) -> Option<&'static str> {
    match name {
        "ACT_DOTA_CUSTOM_TOWER_IDLE" => Some("ACT_DOTA_IDLE"),
        "ACT_DOTA_CUSTOM_TOWER_IDLE_RARE" => Some("ACT_DOTA_IDLE_RARE"),
        "ACT_DOTA_CUSTOM_TOWER_ATTACK" => Some("ACT_DOTA_ATTACK"),
        "ACT_DOTA_CUSTOM_TOWER_DIE" => Some("ACT_DOTA_DIE"),
        _ => None,
    }
}

/// A look's tower model made to play as the plain tower: the plain activity on the middle part of
/// the item's aim matrix (facing forward), the sequences numbered as the plain tower's, and so are
/// the attachments its projectile leaves from.
pub fn as_tower(model: &[u8], plain: &[u8]) -> Vec<u8> {
    let acted = plain_activities(model);
    let numbered = crate::model_sequences::numbered_as(&acted, plain).unwrap_or(acted);
    crate::model_attachments::attached_as(&numbered, plain)
}

fn text_of(n: Option<&Node>) -> String {
    n.and_then(Node::as_str).unwrap_or("").to_string()
}

fn plain_activities(model: &[u8]) -> Vec<u8> {
    let run = || -> Option<Vec<u8>> {
        if !crate::resource::blocks(model).ok()?.iter().any(|b| b.name == "ASEQ") {
            return None;
        }
        let mut kv = crate::kv3::read(crate::resource::data(model, "ASEQ", 0).ok()?).ok()?;
        let names: Vec<String> = kv
            .root
            .get("m_localSequenceNameArray")
            .map(|n| n.items().iter().map(|x| text_of(Some(x))).collect())
            .unwrap_or_default();
        let count = kv.root.get("m_localS1SeqDescArray").map_or(0, |n| n.items().len());
        let mut by_name: HashMap<String, usize> = HashMap::new();
        for (i, d) in kv.root.get("m_localS1SeqDescArray")?.items().iter().enumerate() {
            by_name.insert(text_of(d.get("m_sName")), i);
        }
        let mut changed = false;
        for i in 0..count {
            let d = kv.root.get("m_localS1SeqDescArray")?.items()[i].clone();
            let Some(acts) = d.get("m_activityArray").filter(|a| matches!(a.value, Kv::Array { .. })) else { continue };
            let Some(first) = acts.items().iter().find(|a| plain_act(&text_of(a.get("m_name"))).is_some()) else {
                continue;
            };
            if !matches!(first.value, Kv::Object(_)) {
                continue;
            }
            let refs: Vec<String> = d
                .get("m_fetch")
                .and_then(|f| f.get("m_localReferenceArray"))
                .map(|r| r.items())
                .unwrap_or(&[])
                .iter()
                .map(|r| match &r.value {
                    Kv::Number { .. } => kv
                        .number_of(r)
                        .filter(|n| *n >= 0.0 && n.fract() == 0.0)
                        .and_then(|n| names.get(n as usize))
                        .cloned()
                        .unwrap_or_default(),
                    _ => String::new(),
                })
                .collect();
            let part = if refs.len() > 1 {
                let neutral = re("(?i)neutral");
                let pick = refs.iter().find(|n| neutral.is_match(n)).unwrap_or(&refs[refs.len() / 2]);
                match by_name.get(pick) {
                    Some(&j) => j,
                    None => continue,
                }
            } else {
                i
            };
            let mut act = first.clone();
            if let Kv::Object(m) = &mut act.value {
                let wanted = plain_act(&text_of(m.get("m_name"))).unwrap_or("");
                m.insert("m_name".into(), Node::new(Kv::Str(wanted.into())));
            }
            let mut list = acts.clone();
            if let Kv::Array { items, .. } = &mut list.value {
                *items = vec![act];
            }
            let descs = kv.root.get_mut("m_localS1SeqDescArray")?;
            let Kv::Array { items, .. } = &mut descs.value else { return None };
            let Kv::Object(target) = &mut items[part].value else { continue };
            target.insert("m_activityArray".into(), list);
            changed = true;
        }
        if !changed {
            return None;
        }
        let next = crate::kv3::write(&kv).ok()?;
        crate::resource::replace(model, "ASEQ", 0, &next).ok()
    };
    run().unwrap_or_else(|| model.to_vec())
}
