//! Finding an effect by what it is, not by its file: a hero, his abilities, and the effects that
//! belong to each (src/effect-finder.ts). What belongs to an ability is read off the game's file
//! names, as a hero's recolour reads it (`recolor_layers`). An ability's files include what its
//! effects create, so a file another one in the group brings along is left out of the list.

use std::collections::HashSet;

use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;

use crate::recolor_layers::{hero_abilities, hero_layers};
use crate::vpk::Index;

/// One line of a hero's effects: an ability's, his other ones, or his items'.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectGroup {
    pub id: String,
    pub kind: &'static str,
    pub ability: Option<String>,
    pub name: Option<String>,
    pub paths: Vec<String>,
}

/// An ability a search found.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AbilityHit {
    pub hero: String,
    pub ability: String,
    pub name: String,
}

/// An ability as one thing to change: what it plays, and all the files it may call on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AbilityEffects {
    pub name: Option<String>,
    pub paths: Vec<String>,
    pub files: Vec<String>,
}

/// How many item effects a hero's list holds: some heroes have thousands of files.
const ITEMS_SHOWN: usize = 200;
const HITS_SHOWN: usize = 12;

fn vpcf(p: &str) -> String {
    match p.strip_suffix(".vpcf_c") {
        Some(s) => format!("{s}.vpcf"),
        None => p.to_string(),
    }
}

fn lang_file(lang: &str) -> &'static str {
    match lang {
        "ru" => "russian",
        "zh-CN" => "schinese",
        _ => "english",
    }
}

/// The files of a group that no other file of it brings along.
fn roots(ix: &Index, files: &[String]) -> Vec<String> {
    let mut inside = HashSet::new();
    for f in files {
        let Ok(Some(data)) = ix.read(f) else { continue };
        let Ok(refs) = crate::resource::references(&data) else { continue };
        for r in refs {
            let r = r.to_lowercase();
            let child = r.strip_suffix("_c").unwrap_or(&r);
            let compiled = format!("{child}_c");
            if &compiled != f {
                inside.insert(compiled);
            }
        }
    }
    let top: Vec<String> = files.iter().filter(|f| !inside.contains(*f)).cloned().collect();
    if top.is_empty() {
        files.to_vec()
    } else {
        top
    }
}

/// The finder over the game's pak, with what it read kept: the ability names per language, the
/// ability list per language, and the item table's particle swaps per table.
#[derive(Default)]
pub struct EffectFinder {
    names: Option<(String, IndexMap<String, String>)>,
    abilities: Option<(String, Vec<AbilityHit>)>,
    swaps: Option<(String, IndexMap<String, Vec<String>>)>,
}

fn script_of(ix: &Index, hero: &str) -> Option<String> {
    let ok = Regex::new(r"^[a-z0-9_]{2,40}$").expect("a fixed pattern");
    if !ok.is_match(hero) {
        return None;
    }
    let data = ix.read(&format!("scripts/npc/heroes/npc_dota_hero_{hero}.txt")).ok()??;
    Some(String::from_utf8_lossy(&data).into_owned())
}

impl EffectFinder {
    fn name_of(&mut self, ix: &Index, lang: &str, ability: &str) -> Option<String> {
        if self.names.as_ref().map(|n| n.0.as_str()) != Some(lang) {
            let file = format!("resource/localization/abilities_{}.txt", lang_file(lang));
            let map = match ix.read(&file) {
                Ok(Some(data)) => crate::cosmetic_names::localization_tokens(&data),
                _ => IndexMap::new(),
            };
            self.names = Some((lang.to_string(), map));
        }
        let names = &self.names.as_ref().expect("just set").1;
        names.get(&format!("dota_tooltip_ability_{ability}")).filter(|n| !n.is_empty()).cloned()
    }

    /// The table's `particle` modifiers: a file of the game, and what items put in its place.
    fn swapped(&mut self, table: Option<&str>) -> IndexMap<String, Vec<String>> {
        let Some(text) = table.filter(|t| !t.is_empty()) else { return IndexMap::new() };
        if let Some((t, map)) = &self.swaps {
            if t == text {
                return map.clone();
            }
        }
        let sp = crate::js::SPACE_CLASS;
        let block =
            Regex::new(&format!(r#"(?i)"asset_modifier[0-9]*"{sp}*\{{([^{{}}]*)\}}"#)).expect("a fixed pattern");
        let particle = Regex::new(&format!(r#"(?i)"type"{sp}*"particle""#)).expect("a fixed pattern");
        let field = |k: &str| Regex::new(&format!(r#"(?i)"{k}"{sp}*"([^"]+\.vpcf)""#)).expect("a fixed pattern");
        let (asset, modifier) = (field("asset"), field("modifier"));
        let clean = |s: &str| s.to_lowercase().replace('\\', "/");
        let mut map: IndexMap<String, Vec<String>> = IndexMap::new();
        for m in block.captures_iter(text) {
            let body = &m[1];
            if !particle.is_match(body) {
                continue;
            }
            let from = asset.captures(body).map(|c| clean(&c[1]));
            let to = modifier.captures(body).map(|c| clean(&c[1]));
            if let (Some(from), Some(to)) = (from, to) {
                if from != to {
                    let list = map.entry(from).or_default();
                    if !list.contains(&to) {
                        list.push(to);
                    }
                }
            }
        }
        self.swaps = Some((text.to_string(), map.clone()));
        map
    }

    /// One ability of a hero, or None when he has no effects for it.
    pub fn ability(&mut self, ix: &Index, lang: &str, hero: &str, ability: &str) -> Option<AbilityEffects> {
        let script = script_of(ix, hero)?;
        let paths: Vec<&str> = ix.paths().collect();
        let layer = hero_layers(&paths, hero, &hero_abilities(&script), &[], None)
            .into_iter()
            .find(|l| l.kind == "ability" && l.name.as_deref() == Some(ability))?;
        Some(AbilityEffects {
            name: self.name_of(ix, lang, ability),
            paths: roots(ix, &layer.files).iter().map(|p| vpcf(p)).collect(),
            files: layer.files.iter().map(|p| vpcf(p)).collect(),
        })
    }

    /// The effects items play in place of these files, as far as the game has them.
    pub fn variants(&mut self, ix: &Index, table: Option<&str>, files: &[String]) -> Vec<String> {
        let map = self.swapped(table);
        let mut out: Vec<String> = Vec::new();
        for f in files {
            for v in map.get(f).into_iter().flatten() {
                if !out.contains(v) {
                    out.push(v.clone());
                }
            }
        }
        out.retain(|p| matches!(ix.read(&format!("{p}_c")), Ok(Some(_))));
        out.sort_by(|a, b| crate::js::cmp_utf16(a, b));
        out
    }

    /// A hero's effects, ability by ability, in his script's order.
    pub fn hero(&mut self, ix: &Index, lang: &str, hero: &str) -> Vec<EffectGroup> {
        let Some(script) = script_of(ix, hero) else { return vec![] };
        let paths: Vec<&str> = ix.paths().collect();
        let mut out = Vec::new();
        for l in hero_layers(&paths, hero, &hero_abilities(&script), &[], None) {
            match (l.kind, &l.name) {
                ("ability", Some(name)) => out.push(EffectGroup {
                    id: l.id.clone(),
                    kind: "ability",
                    ability: Some(name.clone()),
                    name: self.name_of(ix, lang, name),
                    paths: roots(ix, &l.files).iter().map(|p| vpcf(p)).collect(),
                }),
                ("effects", _) => out.push(EffectGroup {
                    id: l.id.clone(),
                    kind: "effects",
                    ability: None,
                    name: None,
                    paths: roots(ix, &l.files).iter().map(|p| vpcf(p)).collect(),
                }),
                _ => {}
            }
        }
        let flat = hero.replace('_', "");
        let (a, b) = (format!("particles/econ/items/{hero}/"), format!("particles/econ/items/{flat}/"));
        let mut items: Vec<&str> = paths
            .iter()
            .copied()
            .filter(|p| p.ends_with(".vpcf_c") && (p.starts_with(&a) || p.starts_with(&b)))
            .collect();
        if !items.is_empty() {
            items.sort_by_key(|p| p.encode_utf16().count());
            out.push(EffectGroup {
                id: "items".into(),
                kind: "items",
                ability: None,
                name: None,
                paths: items.iter().take(ITEMS_SHOWN).map(|p| vpcf(p)).collect(),
            });
        }
        out
    }

    /// The abilities with every word of `query` in their name, in the app's language or the game's
    /// id; `heroes` are the npc names, in the order the window lists them.
    pub fn abilities(&mut self, ix: &Index, lang: &str, heroes: &[String], query: &str) -> Vec<AbilityHit> {
        let words: Vec<String> =
            query.to_lowercase().split(crate::js::is_space).filter(|w| !w.is_empty()).map(str::to_string).collect();
        if words.is_empty() {
            return vec![];
        }
        if self.abilities.as_ref().map(|a| a.0.as_str()) != Some(lang) {
            let mut list = Vec::new();
            for hero in heroes {
                if let Some(script) = script_of(ix, hero) {
                    for ability in hero_abilities(&script) {
                        let name = self.name_of(ix, lang, &ability).unwrap_or_else(|| ability.clone());
                        list.push(AbilityHit { hero: hero.clone(), ability, name });
                    }
                }
            }
            self.abilities = Some((lang.to_string(), list));
        }
        let list = &self.abilities.as_ref().expect("just set").1;
        list.iter()
            .filter(|a| {
                words.iter().all(|w| a.name.to_lowercase().contains(w.as_str()) || a.ability.contains(w.as_str()))
            })
            .take(HITS_SHOWN)
            .cloned()
            .collect()
    }
}
