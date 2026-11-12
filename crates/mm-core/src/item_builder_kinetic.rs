//! Kinetic gems on any item, replacing src/item-builder-kinetic.ts: the game's animation gems
//! (Fishstick, Rampant, Twister), which the table's "asset_modifiers" section names with an
//! activity (or ALL) and the modifier the hero's animations for it are marked with. A gem rides in
//! the pick's effect string as `kinetic-<name>`; it goes in the table for hero demo, and in the
//! hero's model under its own path with the modifier taken off (kinetic_entries).

use indexmap::IndexMap;
use regex::bytes::Regex;
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};

use crate::item_builder_assets::{game_asset_entries, AssetCopy};
use crate::item_builder_donor::with_modifiers;
use crate::kv::{self, latin1, KvError};

/// One gem of the table: its name, the token of the name the game shows, and (activity, modifier) pairs.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KineticGem {
    pub name: String,
    pub token: String,
    pub activities: Vec<(String, String)>,
}

/// One gem the picker offers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferedGem {
    pub id: String,
    pub name_token: String,
    pub fallback: String,
}

/// The heroes whose models hold each gem's animations, found by reading every hero's model
/// (2026-11-08): the table does not say whose a gem is.
const GEM_HEROES: &[(&str, &[&str])] = &[
    ("silent_ripper", &["slark"]),
    ("pyre", &["doom_bringer"]),
    ("eyeoffetizu", &["doom_bringer"]),
    ("odachi", &["juggernaut"]),
    ("bladebiter", &["kunkka"]),
    ("deadwinter_soul", &["lich"]),
    ("death_protest", &["necrolyte"]),
    ("dizzying_punch", &["tusk"]),
    ("wraith_spin", &["skeleton_king"]),
    ("serene_honor", &["phantom_lancer"]),
    ("red_moon", &["lycan"]),
    ("turbulent_teleport", &["furion"]),
    ("dagger_twirl", &["queenofpain"]),
    ("impatient_maiden", &["crystal_maiden"]),
    ("obeisance_of_the_keeper", &["keeper_of_the_light"]),
    ("when_nature_attacks", &["furion"]),
    ("twister", &["lina"]),
    ("salvaged_sword", &["skeleton_king"]),
    ("triumphant_timelord", &["faceless_void"]),
    ("ss_fortune", &["storm_spirit"]),
    ("es_prosperity", &["ember_spirit"]),
    ("swordonshoulder", &["dragon_knight"]),
    ("lucentyr", &["luna"]),
    ("f2p_doom", &["doom_bringer"]),
    ("fear", &["sven", "rubick"]),
    ("bot", &["tinker"]),
    ("ftp_dendi_back", &["pudge"]),
    ("telebolt", &["rattletrap"]),
    ("glory", &["warlock"]),
    ("mgc", &["sniper"]),
    ("moth", &["death_prophet"]),
    ("windy", &["windrunner"]),
    ("iron", &["dragon_knight"]),
    ("everlasting_array", &["lina"]),
    ("fishstick", &["lion"]),
    ("glacier", &["crystal_maiden"]),
    ("rampant", &["axe"]),
    ("lodestar", &["enchantress"]),
    ("emp", &["invoker", "skywrath_mage"]),
    ("burning_fiend", &["doom_bringer"]),
    ("harlequin", &["rubick"]),
    ("dc_centaur_double_edge", &["centaur"]),
    ("moon_griffon", &["mirana"]),
    ("trapper", &["pudge"]),
];

/// A gem's name out of its token, `kinetic-<word chars and dashes>`.
pub fn kinetic_name(token: &str) -> Option<&str> {
    let name = token.strip_prefix("kinetic-")?;
    (!name.is_empty() && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')).then_some(name)
}

type Gems = IndexMap<String, KineticGem>;

/// Every gem in the table, by its name in lower case.
pub fn kinetic_gems(text: &[u8]) -> Result<Arc<Gems>, KvError> {
    static SLOT: crate::memo::Slot<Gems> = Mutex::new(None);
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?-u)\n\t"asset_modifiers"[\t\n\x0B\x0C\r \xA0]*\n"#).unwrap());
    crate::memo::per_text(&SLOT, text, |text| {
        let mut gems = Gems::new();
        let Some(at) = re.find(text) else { return Ok(gems) };
        for entry in kv::children(text, kv::block_bounds(text, at.end() - 1)?)? {
            let Some(body) = entry.body else { continue };
            let mut gem = KineticGem { name: String::new(), token: String::new(), activities: vec![] };
            for f in kv::children(text, body)? {
                match (f.value, f.body) {
                    (Some(v), _) if f.key == b"name" => gem.name = latin1(v),
                    (Some(v), _) if f.key == b"loc_key" => gem.token = latin1(v),
                    (_, Some(b)) => {
                        let mut ty = String::new();
                        let mut asset = String::new();
                        let mut modifier = String::new();
                        for x in kv::children(text, b)? {
                            let Some(v) = x.value else { continue };
                            match latin1(x.key).to_lowercase().as_str() {
                                "type" => ty = latin1(v),
                                "asset" => asset = latin1(v),
                                "modifier" => modifier = latin1(v),
                                _ => {}
                            }
                        }
                        if ty.to_lowercase() == "activity" && !modifier.is_empty() {
                            gem.activities.push((if asset.is_empty() { "ALL".into() } else { asset }, modifier));
                        }
                    }
                    _ => {}
                }
            }
            if !gem.name.is_empty() && !gem.activities.is_empty() {
                gems.insert(gem.name.to_lowercase(), gem);
            }
        }
        Ok(gems)
    })
}

/// The gems a hero's model can play, as the picker offers them. `heroes`: npc_dota_hero_*.
pub fn offered_kinetic(text: &[u8], heroes: &[String]) -> Result<Vec<OfferedGem>, KvError> {
    let short: Vec<&str> = heroes.iter().map(|h| h.strip_prefix("npc_dota_hero_").unwrap_or(h)).collect();
    Ok(kinetic_gems(text)?
        .iter()
        .filter(|(name, _)| {
            GEM_HEROES.iter().find(|(g, _)| g == name).is_some_and(|(_, hs)| hs.iter().any(|h| short.contains(h)))
        })
        .map(|(name, gem)| {
            let spaced = name.replace('_', " ");
            let mut chars = spaced.chars();
            let fallback = match chars.next() {
                Some(c) if c.is_ascii_alphanumeric() || c == '_' => c.to_uppercase().chain(chars).collect(),
                _ => spaced.clone(),
            };
            OfferedGem { id: format!("kinetic-{name}"), name_token: gem.token.clone(), fallback }
        })
        .collect())
}

/// The gems among a pick's effects; an error when the table has no such gem.
pub fn picks_gems(text: &[u8], effect_key: &str) -> Result<Vec<KineticGem>, String> {
    let gems = kinetic_gems(text).map_err(|e| e.to_string())?;
    effect_key
        .split(',')
        .filter_map(|id| kinetic_name(id).map(|n| (id, n)))
        .map(|(id, name)| gems.get(name).cloned().ok_or_else(|| format!("items_game: {id}")))
        .collect()
}

/// The visuals wearing these gems' activity modifiers, for hero demo.
pub fn with_kinetics(visuals: &[u8], gems: &[KineticGem]) -> Vec<u8> {
    let add: Vec<Vec<u8>> = gems
        .iter()
        .flat_map(|g| g.activities.iter())
        .map(|(asset, modifier)| {
            kv::to_latin1(&format!(
                "\"asset_modifier\"\r\n{{\r\n\t\"type\"\t\t\"activity\"\r\n\t\"asset\"\t\t\"{asset}\"\r\n\t\"modifier\"\t\t\"{modifier}\"\r\n}}"
            ))
        })
        .collect();
    with_modifiers(visuals, &add)
}

/// Each hero's model with the modifiers of all the gems the hero wears taken off. `worn`: hero -> modifiers.
pub fn kinetic_entries(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    worn: &IndexMap<String, Vec<String>>,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let copies: Vec<AssetCopy> = worn
        .iter()
        .map(|(hero, modifiers)| AssetCopy::Hero {
            from: String::new(),
            hero: hero.clone(),
            activities: modifiers.clone(),
            skin: None,
        })
        .collect();
    game_asset_entries(read, &copies, &|_| false)
}
