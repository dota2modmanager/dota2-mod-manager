//! A hero's other forms and the creatures he summons, stood beside him on the 3D stage: Lone
//! Druid's Spirit Bear and true form, Dragon Knight's dragon, Lycan's wolves, Brewmaster's spirits.
//!
//! The game names no list of them. What it does name: the unit scripts (npc_units.txt) give each
//! summon its model, and a hero's own script names the models his abilities turn him into. Those
//! that live in the hero's own model folder are his; a persona's folder is another hero's look.
//! Each stands in its loadout, or its idle, as the hero does.

use std::path::PathBuf;
use std::sync::OnceLock;

use regex::bytes::Regex;
use serde::Serialize;

use crate::loadout_resources::{loadout_models, Exporter, Wanted};
use crate::model_glb::Clips;
use crate::model_loadout as loadout;

/// How many stand beside the hero: Brewmaster's four spirits fit, a crowd would not.
pub const MOST: usize = 4;

/// The model an item puts on a summon: the unit's model its visuals swap in ("entity_model", how
/// the game dresses the Spirit Bear), else the item's own model.
pub fn summon_model(block: &[u8]) -> Option<String> {
    static ENTITY: OnceLock<Regex> = OnceLock::new();
    static PLAYER: OnceLock<Regex> = OnceLock::new();
    let entity = ENTITY.get_or_init(|| {
        Regex::new(r#"(?is)"type"\s+"entity_model"\s+"asset"\s+"[^"]*"\s+"modifier"\s+"([^"]+\.vmdl)""#).unwrap()
    });
    let player = PLAYER.get_or_init(|| Regex::new(r#"(?i)"model_player"\s+"([^"]+\.vmdl)""#).unwrap());
    entity.captures(block).or_else(|| player.captures(block)).map(|c| norm(&String::from_utf8_lossy(&c[1])))
}

/// What the item builder's summon slot has on: the item tried on, else the one put on (the
/// library's record of that slot); its model, or None for the stock summon.
pub fn summon_pick(text: &[u8], slots: &[serde_json::Value], library: &[serde_json::Value]) -> Option<String> {
    let slot = slots.iter().find(|s| s.get("slot").and_then(|v| v.as_str()).is_some_and(|s| s.ends_with(":summon")))?;
    let name = slot.get("slot").and_then(|v| v.as_str())?;
    let tried = slot.get("tryOn").and_then(|t| t.get("itemId")).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let worn = || {
        library
            .iter()
            .find(|r| {
                r.get("slot").and_then(|v| v.as_str()) == Some(name)
                    && r.get("enabled") != Some(&serde_json::Value::Bool(false))
            })
            .and_then(|r| r.get("itemId"))
            .map(crate::js::string)
    };
    let id = tried.map(str::to_string).or_else(worn)?;
    let (start, end) = crate::schema::find_item(text, &id, None).ok()??;
    summon_model(&text[start..end])
}

/// One of them as the window takes it: its model dressed with its materials, and the clip it stands in.
#[derive(Debug, Clone, Serialize)]
pub struct Companion {
    pub model: String,
    pub clip: Option<String>,
    #[serde(skip)]
    pub glb: Vec<u8>,
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim().to_lowercase()
}

/// Every model path a script names, in order, each once.
fn models_in(text: &[u8]) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?i)"(models/[A-Za-z0-9_/.\-]+\.vmdl)""#).unwrap());
    let mut out: Vec<String> = Vec::new();
    for c in re.captures_iter(text) {
        let m = norm(&String::from_utf8_lossy(&c[1]));
        if !out.contains(&m) {
            out.push(m);
        }
    }
    out
}

/// The hero's other forms and summons, by model path: those his script and the unit scripts name
/// in his own model folder, but not his body, not what he wears (`worn`), not a persona's, and
/// only those the game has (`has`, compiled paths). His forms first, then his summons.
/// `summoned`: what the item builder's summon slot puts on (a Spirit Bear set), which stands in
/// for the first of his summons, as the game swaps that unit's model.
pub fn companion_models(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    has: &dyn Fn(&str) -> bool,
    hero: &str,
    body: &str,
    worn: &[String],
    summoned: Option<&str>,
) -> Vec<String> {
    let mut list = found(read, has, hero, body, worn);
    if let Some(s) = summoned.filter(|s| !s.is_empty()) {
        match list.iter().position(|(_, unit)| *unit) {
            Some(at) => list[at].0 = norm(s),
            None if list.len() < MOST => list.push((norm(s), true)),
            None => {}
        }
    }
    list.into_iter().map(|(m, _)| m).collect()
}

/// The forms and summons with whether each is a unit of its own (a summon) or a form of his.
fn found(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    has: &dyn Fn(&str) -> bool,
    hero: &str,
    body: &str,
    worn: &[String],
) -> Vec<(String, bool)> {
    let full = if hero.starts_with("npc_dota_hero_") { hero.to_string() } else { format!("npc_dota_hero_{hero}") };
    let Ok(own) = crate::item_builder_assets::hero_model_path(read, &full) else { return vec![] };
    let own = norm(&own);
    let Some((folder, _)) = own.rsplit_once('/') else { return vec![] };
    let folder = format!("{folder}/");
    let skip: Vec<String> = worn.iter().map(|w| norm(w)).chain([own.clone(), norm(body)]).collect();
    let script = read(&format!("scripts/npc/heroes/{full}.txt")).unwrap_or_default();
    let units = read("scripts/npc/npc_units.txt").unwrap_or_default();
    let mut out: Vec<(String, bool)> = Vec::new();
    let forms = models_in(&script).into_iter().map(|m| (m, false));
    for (m, unit) in forms.chain(models_in(&units).into_iter().map(|m| (m, true))) {
        if out.len() >= MOST {
            break;
        }
        let ok = m.starts_with(&folder)
            && !m.contains("persona")
            && !skip.contains(&m)
            && !out.iter().any(|(o, _)| *o == m)
            && has(&format!("{m}_c"));
        if ok {
            out.push((m, unit));
        }
    }
    out
}

/// What a companion stands in: its loadout, else its idle.
fn stance(file: Option<&[u8]>) -> Option<String> {
    let seqs = loadout::model_sequences(file);
    loadout::loadout_sequence(&seqs, &[]).or_else(|| loadout::idle_sequence(&seqs))
}

/// Each companion exported with its stance and dressed in its materials, side by side; one that
/// cannot be had is left out.
pub fn companions(
    models: &[String],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    glb: &(dyn Exporter + Sync),
) -> Vec<Companion> {
    let clips: Vec<Option<String>> = models.iter().map(|m| stance(read(&format!("{m}_c")).as_deref())).collect();
    let files: Vec<Option<PathBuf>> = std::thread::scope(|sc| {
        let jobs: Vec<_> = models
            .iter()
            .zip(&clips)
            .map(|(m, c)| {
                sc.spawn(move || {
                    let list: Vec<String> = c.iter().cloned().collect();
                    glb.glbs(std::slice::from_ref(m), &Clips::Some(list), false).get(m).cloned().flatten()
                })
            })
            .collect();
        jobs.into_iter().map(|j| j.join().ok().flatten()).collect()
    });
    let mut out = Vec::new();
    for ((model, clip), file) in models.iter().zip(clips).zip(files) {
        let Some(file) = file else { continue };
        let wanted = [Wanted { file, model: model.clone(), skin: 0 }];
        let Ok(mut dressed) = loadout_models(&wanted, read, glb, None) else { continue };
        if let Some(Some(bytes)) = dressed.pop() {
            out.push(Companion { model: model.clone(), clip, glb: bytes });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bear_set_names_its_bear_by_the_unit_it_swaps() {
        let block = b"\"visuals\"
{
	\"asset_modifier0\"
	{
		\"type\"		\"entity_model\"
		\"asset\"		\"npc_dota_lone_druid_bear\"
		\"modifier\"		\"models/items/lone_druid/viciouskraitpanda/viciouskrait_panda.vmdl\"
	}
}
";
        assert_eq!(
            summon_model(block).as_deref(),
            Some("models/items/lone_druid/viciouskraitpanda/viciouskrait_panda.vmdl")
        );
        assert_eq!(
            summon_model(b"\"model_player\"	\"models/items/x/y.vmdl\"").as_deref(),
            Some("models/items/x/y.vmdl")
        );
        assert_eq!(summon_model(b"\"item_slot\"	\"summon\""), None);
    }

    fn script(model: &str, more: &str) -> Vec<u8> {
        format!(
            "\"DOTAHeroes\"\n{{\n\t\"npc_dota_hero_lone_druid\"\n\t{{\n\t\t\"Model\"\t\"{model}\"\n{more}\t}}\n}}\n"
        )
        .into_bytes()
    }

    #[test]
    fn the_bear_and_the_true_form_stand_beside_the_druid() {
        let hero = script(
            "models/heroes/lone_druid/lone_druid.vmdl",
            "\t\t\"model\"\t\"models/heroes/lone_druid/true_form.vmdl\"\n\t\t\"x\"\t\"models/heroes/lone_druid/lone_druid.vmdl\"\n",
        );
        let units = b"\"DOTAUnits\"\n{\n\t\"npc_dota_lone_druid_bear1\"\n\t{\n\t\t\"Model\"\t\"models/heroes/lone_druid/spirit_bear.vmdl\"\n\t}\n\t\"npc_dota_lone_druid_bear2\"\n\t{\n\t\t\"Model\"\t\"models/heroes/lone_druid/spirit_bear.vmdl\"\n\t}\n\t\"npc_dota_creep\"\n\t{\n\t\t\"Model\"\t\"models/creeps/lane_creeps/creep_radiant_melee.vmdl\"\n\t}\n\t\"npc_persona\"\n\t{\n\t\t\"Model\"\t\"models/heroes/lone_druid/lone_druid_persona.vmdl\"\n\t}\n}\n".to_vec();
        let read = |p: &str| match p {
            "scripts/npc/heroes/npc_dota_hero_lone_druid.txt" => Some(hero.clone()),
            "scripts/npc/npc_units.txt" => Some(units.clone()),
            _ => None,
        };
        let has = |p: &str| p.ends_with(".vmdl_c");
        let body = "models/heroes/lone_druid/lone_druid.vmdl";
        let got = companion_models(&read, &has, "lone_druid", body, &[], None);
        assert_eq!(got, vec!["models/heroes/lone_druid/true_form.vmdl", "models/heroes/lone_druid/spirit_bear.vmdl"]);
        // what the hero wears is not beside him, nor what the game has not got
        let worn = ["models/heroes/lone_druid/true_form.vmdl".to_string()];
        assert_eq!(
            companion_models(&read, &has, "lone_druid", body, &worn, None),
            vec!["models/heroes/lone_druid/spirit_bear.vmdl"]
        );
        assert!(companion_models(&read, &|_| false, "lone_druid", "x", &[], None).is_empty());
        // a bear set picked stands in for the bear, not for his true form
        let panda = "models/items/lone_druid/bear/spirit_of_calm/spirit_of_calm.vmdl";
        assert_eq!(
            companion_models(&read, &has, "lone_druid", body, &[], Some(panda)),
            vec!["models/heroes/lone_druid/true_form.vmdl", panda]
        );
    }
}
