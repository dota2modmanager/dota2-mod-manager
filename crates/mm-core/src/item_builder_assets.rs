//! What an item builder pick needs beyond its block in items_game, replacing
//! src/item-builder-assets.ts: the game's files it puts under the plain paths (models, particles,
//! pictures, the hero's own model), and the sounds and voice it makes the hero's own.

use indexmap::IndexMap;
use regex::bytes::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::arcana::as_model;
use crate::i18n::t;
use crate::item_builder_slots::stock_models;
use crate::item_sounds::{SoundSwap, VoiceCue};
use crate::kv::{self, KvError};
use crate::model_attachments::attached_as;
use crate::model_cloth::{without_cloth, ClothDragger};
use crate::model_sequences::numbered_as;
use crate::model_skin::with_skin;

/// A file of the game's archive staged under another path in the built VPK.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AssetCopy {
    /// a hero's own model: where it lives is in the hero's script, and it goes in with the item's
    /// activity modifiers taken off
    Hero {
        #[serde(default)]
        from: String,
        hero: String,
        #[serde(default)]
        activities: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skin: Option<u64>,
    },
    /// a summon's model, under its unit's plain model, numbered as the plain one
    Unit {
        from: String,
        to: String,
        unit: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skin: Option<u64>,
    },
    /// any other file; an `optional` one is left out when the game has not got it, a `form` is a
    /// hero's other body an item swaps in, which keeps its own cloth
    Path {
        from: String,
        to: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        optional: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skin: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        form: Option<bool>,
    },
}

/// A sprite of the game's sprite sheets shown in place of another.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SpriteSwap {
    pub sprite: String,
    #[serde(rename = "as")]
    pub as_: String,
}

/// A hero model whose HUD portrait settings go under the hero's own model's path.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PortraitSwap {
    pub model: String,
    pub hero: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
}

/// What a pick asks of the game's files, beside its block.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAssets {
    pub asset_copies: Vec<AssetCopy>,
    pub sounds: Vec<SoundSwap>,
    pub voices: Vec<VoiceCue>,
    pub portraits: Vec<PortraitSwap>,
    pub sprites: Vec<SpriteSwap>,
}

/// The folders under panorama/images each kind of picture swap is shown from.
const PICTURES: [(&str, &[&str]); 3] = [
    ("icon_replacement_hero", &["heroes", "heroes/selection"]),
    ("icon_replacement_hero_minimap", &["heroes/icons"]),
    ("ability_icon", &["spellicons"]),
];

pub fn normalize_asset_path(p: &str) -> String {
    crate::item_skin::normalize_asset_path(p)
}

pub fn compiled_asset_path(p: &str) -> String {
    let clean = normalize_asset_path(p);
    if clean.ends_with("_c") {
        clean
    } else {
        format!("{clean}_c")
    }
}

fn picture(folder: &str, name: &str) -> String {
    format!("panorama/images/{folder}/{}_png.vtex_c", normalize_asset_path(name))
}

/// The attack a persona's owner sees, which nothing in items_game or the hero's script swaps.
fn persona_attacks(hero: &str) -> &'static [(&'static str, &'static str)] {
    match hero {
        "npc_dota_hero_invoker" => &[(
            "particles/units/heroes/hero_invoker_kid/invoker_kid_base_attack_all.vpcf",
            "particles/units/heroes/hero_invoker/invoker_base_attack.vpcf",
        )],
        _ => &[],
    }
}

/// The plain model of a unit the item swaps for `model`, when the unit is one of these heroes'
/// summons and `model` can be numbered as the plain one; or None.
pub type SummonModels<'a> = dyn FnMut(&str, &[String], &str) -> Option<String> + 'a;

type Fields = IndexMap<String, String>;

fn is_modifier_key(key: &[u8]) -> bool {
    key.len() >= 14 && key[..14].eq_ignore_ascii_case(b"asset_modifier") && key[14..].iter().all(u8::is_ascii_digit)
}

fn js_number(s: &str) -> f64 {
    crate::js::to_number(&serde_json::Value::String(s.to_string()))
}

/// The files, sounds, voice, portraits and sprites an item's visuals swap, its first style's.
/// `text` is items_game, for the heroes' stock models; `heroes` the item's, npc_dota_hero_*.
pub fn item_assets(
    text: &[u8],
    visuals: &[u8],
    heroes: &[String],
    summon: Option<&mut SummonModels>,
) -> Result<ItemAssets, KvError> {
    let mut mods: Vec<Fields> = Vec::new();
    for c in kv::children(visuals, kv::block_bounds(visuals, 0)?)? {
        let Some(body) = c.body else { continue };
        if !is_modifier_key(c.key) {
            continue;
        }
        let mut f = Fields::new();
        for x in kv::children(visuals, body)? {
            if let Some(v) = x.value {
                f.insert(kv::latin1(x.key).to_lowercase(), kv::latin1(v));
            }
        }
        if f.get("style").is_none_or(|s| s.is_empty() || s == "0") {
            mods.push(f);
        }
    }
    let typed = |ty: &str, keys: &[&str]| -> Vec<&Fields> {
        mods.iter()
            .filter(|f| f.get("type").map_or("", String::as_str).to_lowercase() == ty)
            .filter(|f| keys.iter().all(|k| f.get(*k).is_some_and(|v| !v.is_empty())))
            .collect()
    };
    let get = |f: &Fields, k: &str| f.get(k).cloned().unwrap_or_default();
    let mut activities: Vec<String> = Vec::new();
    for f in typed("activity", &["modifier"]) {
        let m = get(f, "modifier");
        if !activities.contains(&m) {
            activities.push(m);
        }
    }
    // the material set the item wears its hero's body in, which the server leaves at the first
    let skin_text = match typed("model_skin", &["skin"]).first() {
        Some(f) => Some(get(f, "skin")),
        None => crate::item_skin::first_style_skin(visuals)?.map(|s| kv::latin1(&s)),
    };
    let skin = skin_text.map_or(0.0, |s| js_number(&s));
    let skin = if skin.is_nan() || skin == 0.0 { None } else { Some(skin as u64) };
    let stock: HashSet<String> = stock_models(text, heroes)?.iter().map(|m| normalize_asset_path(m)).collect();
    let entity = typed("entity_model", &["asset", "modifier"]);
    let is_hero = |f: &&Fields| heroes.contains(&get(f, "asset").to_lowercase());
    let models: Vec<&Fields> = entity.iter().copied().filter(is_hero).collect();
    let others: Vec<&Fields> = entity.iter().copied().filter(|f| !is_hero(f)).collect();
    let summons = summon_copies(&others, heroes, summon);
    let swapped = |ty: &str, folders: &[&str]| -> Vec<AssetCopy> {
        typed(ty, &["asset", "modifier"])
            .iter()
            .flat_map(|f| {
                folders.iter().map(|folder| AssetCopy::Path {
                    from: picture(folder, &get(f, "modifier")),
                    to: picture(folder, &get(f, "asset")),
                    optional: Some(true),
                    skin: None,
                    form: None,
                })
            })
            .collect()
    };
    let mut pictures: Vec<AssetCopy> = PICTURES.iter().flat_map(|(ty, folders)| swapped(ty, folders)).collect();
    let persona = !typed("persona", &[]).is_empty();
    if persona && typed("icon_replacement_hero", &["asset", "modifier"]).is_empty() {
        pictures.extend(swapped("icon_replacement_hero_minimap", PICTURES[0].1));
    }
    if persona {
        for hero in heroes {
            pictures.extend(persona_attacks(hero).iter().map(|(from, to)| AssetCopy::Path {
                from: from.to_string(),
                to: to.to_string(),
                optional: Some(true),
                skin: None,
                form: None,
            }));
        }
    }
    let path = |f: &&Fields, form: bool| AssetCopy::Path {
        from: get(f, "modifier"),
        to: get(f, "asset"),
        optional: None,
        skin: None,
        form: form.then_some(true),
    };
    let mut copies: Vec<AssetCopy> = models
        .iter()
        .map(|f| AssetCopy::Hero {
            from: get(f, "modifier"),
            hero: get(f, "asset").to_lowercase(),
            activities: activities.clone(),
            skin,
        })
        .collect();
    copies.extend(summons);
    copies.extend(
        typed("model", &["asset", "modifier"])
            .iter()
            .filter(|f| stock.contains(&normalize_asset_path(&get(f, "asset"))))
            .map(|f| path(f, false)),
    );
    copies.extend(
        typed("hero_model_change", &["asset", "modifier"])
            .iter()
            .filter(|f| normalize_asset_path(&get(f, "asset")).starts_with("models/heroes/"))
            .map(|f| path(f, true)),
    );
    copies.extend(typed("particle", &["asset", "modifier"]).iter().map(|f| path(f, false)));
    copies.extend(pictures);
    Ok(ItemAssets {
        asset_copies: copies,
        sounds: typed("sound", &["asset", "modifier"])
            .iter()
            .map(|f| SoundSwap { sound: get(f, "asset"), as_: get(f, "modifier") })
            .collect(),
        // a persona's criterion "is_target" is said of the hero it targets, not of the one wearing it
        voices: typed("response_criteria", &["asset"])
            .iter()
            .filter(|f| f.get("is_target").is_none_or(String::is_empty))
            .flat_map(|f| {
                let key =
                    f.get("modifier").filter(|m| !m.is_empty()).cloned().unwrap_or_else(|| "customresponse".into());
                heroes.iter().map(move |hero| VoiceCue {
                    hero: hero.clone(),
                    key: key.clone(),
                    value: get(f, "asset"),
                    whole: false,
                })
            })
            .collect(),
        portraits: models
            .iter()
            .map(|f| PortraitSwap { model: get(f, "modifier"), hero: get(f, "asset").to_lowercase(), scale: None })
            .collect(),
        sprites: typed("icon_replacement_hero_minimap", &["asset", "modifier"])
            .iter()
            .map(|f| SpriteSwap {
                sprite: format!("minimap_heroicon_{}", get(f, "asset")),
                as_: format!("minimap_heroicon_{}", get(f, "modifier")),
            })
            .collect(),
    })
}

/// The summons' copies, one per plain model; two swaps onto one plain model with different models
/// are both left to the table.
fn summon_copies(swaps: &[&Fields], heroes: &[String], summon: Option<&mut SummonModels>) -> Vec<AssetCopy> {
    let Some(summon) = summon else { return vec![] };
    let mut by_path: IndexMap<String, Vec<(String, String, String)>> = IndexMap::new();
    for f in swaps {
        let unit = f.get("asset").cloned().unwrap_or_default().to_lowercase();
        let from = f.get("modifier").cloned().unwrap_or_default();
        let Some(to) = summon(&unit, heroes, &from) else { continue };
        by_path.entry(normalize_asset_path(&to)).or_default().push((from, to, unit));
    }
    by_path
        .into_values()
        .filter(|all| all.iter().map(|(from, ..)| normalize_asset_path(from)).collect::<HashSet<_>>().len() == 1)
        .flatten()
        .map(|(from, to, unit)| AssetCopy::Unit { from, to, unit, skin: None })
        .collect()
}

/// Where a hero's own model lives: the first "Model" in its script.
pub fn hero_model_path(read: &dyn Fn(&str) -> Option<Vec<u8>>, hero: &str) -> Result<String, String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        let s = r"[\t\n\x0B\x0C\r \xA0]";
        Regex::new(&format!(r#"(?mi-u)^{s}*"Model"{s}+"([^"]+)""#)).unwrap()
    });
    let script = read(&format!("scripts/npc/heroes/{hero}.txt"));
    script
        .and_then(|s| re.captures(&s).map(|c| kv::latin1(&c[1])))
        .ok_or_else(|| t("Не найдена модель героя {0}", &[serde_json::json!(hero)]))
}

fn dirname(p: &str) -> &str {
    match p.rfind('/') {
        Some(0) => "/",
        Some(i) => &p[..i],
        None => ".",
    }
}

/// What reads a file of the game's archive by its path.
pub type Reader = dyn Fn(&str) -> Option<Vec<u8>> + Send;

/// Where the plain models of a hero's own summons live, read out of the game's unit scripts.
pub struct Summons {
    read: Box<Reader>,
    units: Option<IndexMap<String, Option<String>>>,
    folders: HashMap<String, Option<String>>,
    numbered: HashMap<String, bool>,
}

impl Summons {
    /// One per game index: it keeps what it has read, as the TypeScript keeps one per VpkIndex.
    pub fn new(read: impl Fn(&str) -> Option<Vec<u8>> + Send + 'static) -> Self {
        Summons { read: Box::new(read), units: None, folders: HashMap::new(), numbered: HashMap::new() }
    }

    fn units(&mut self) -> &IndexMap<String, Option<String>> {
        if self.units.is_none() {
            let mut units = IndexMap::new();
            if let Some(text) = (self.read)("scripts/npc/npc_units.txt") {
                if let Ok(b) = kv::block_bounds(&text, 0) {
                    let _ = kv::each_child(&text, b, |c| {
                        if let Some(body) = c.body {
                            let mut model = None;
                            let _ = kv::each_child(&text, body, |f| {
                                if f.value.is_some() && f.key.eq_ignore_ascii_case(b"model") {
                                    model = f.value.map(kv::latin1);
                                }
                                true
                            });
                            units.insert(kv::latin1(c.key).to_lowercase(), model);
                        }
                        true
                    });
                }
            }
            self.units = Some(units);
        }
        self.units.as_ref().unwrap()
    }

    fn folder_of(&mut self, hero: &str) -> Option<String> {
        if !self.folders.contains_key(hero) {
            let f = hero_model_path(&*self.read, hero).ok().map(|m| format!("{}/", dirname(&normalize_asset_path(&m))));
            self.folders.insert(hero.to_string(), f);
        }
        self.folders[hero].clone()
    }

    fn fits(&mut self, model: &str, plain: &str) -> bool {
        let key = format!("{model}|{plain}");
        if let Some(&f) = self.numbered.get(&key) {
            return f;
        }
        let a = (self.read)(&compiled_asset_path(model));
        let b = (self.read)(&compiled_asset_path(plain));
        let f = matches!((a, b), (Some(a), Some(b)) if numbered_as(&a, &b).is_some());
        self.numbered.insert(key, f);
        f
    }

    /// The plain model `model` goes under for `unit`, or None.
    pub fn resolve(&mut self, unit: &str, heroes: &[String], model: &str) -> Option<String> {
        let units = self.units();
        let named: Vec<Option<String>> = match units.get(unit) {
            Some(m) => vec![m.clone()],
            None => units.iter().filter(|(name, _)| name.starts_with(unit)).map(|(_, m)| m.clone()).collect(),
        };
        let mut models: Vec<String> = Vec::new();
        for m in named.into_iter().flatten().filter(|m| !m.is_empty()) {
            let m = normalize_asset_path(&m);
            if !models.contains(&m) {
                models.push(m);
            }
        }
        if models.len() != 1 {
            return None;
        }
        let own = heroes.iter().any(|h| self.folder_of(h).is_some_and(|f| models[0].starts_with(&f)));
        (own && self.fits(model, &models[0])).then(|| models[0].clone())
    }
}

/// A hero model as it goes under the plain hero's path: its animations that need the item's
/// activity modifiers made the ones it plays without them. One the reader cannot open goes in as
/// it is.
fn hero_model_bytes(data: Vec<u8>, activities: &[String]) -> Vec<u8> {
    let mut model = data.clone();
    for m in activities {
        match as_model(&model, Some(m)) {
            Ok(next) => model = next,
            Err(_) => return data,
        }
    }
    model
}

/// The compiled files of `copies` read out of pak01 and staged under their plain paths, as
/// (path, bytes). `skip`: the paths, lowercased, something else fills.
pub fn game_asset_entries(
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    copies: &[AssetCopy],
    skip: &dyn Fn(&str) -> bool,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut dragger = ClothDragger::new(|p: &str| read(p));
    for copy in copies {
        let to = match copy {
            AssetCopy::Hero { hero, .. } => compiled_asset_path(&hero_model_path(read, hero)?),
            AssetCopy::Unit { to, .. } | AssetCopy::Path { to, .. } => compiled_asset_path(to),
        };
        let from = match copy {
            // a hero's copy from nowhere is the hero's own model, with its modifiers off
            AssetCopy::Hero { from, .. } if from.is_empty() => to.clone(),
            AssetCopy::Hero { from, .. } | AssetCopy::Unit { from, .. } | AssetCopy::Path { from, .. } => {
                compiled_asset_path(from)
            }
        };
        if from.is_empty() || to.is_empty() || seen.contains(&to) || skip(&to.to_lowercase()) {
            continue;
        }
        let data = read(&from);
        let Some(data) = data else {
            if matches!(copy, AssetCopy::Path { optional: Some(true), .. }) {
                continue;
            }
            return Err(t("Не найден {0}", &[serde_json::json!(from)]));
        };
        let skin = match copy {
            AssetCopy::Hero { skin, .. } | AssetCopy::Unit { skin, .. } | AssetCopy::Path { skin, .. } => {
                skin.unwrap_or(0) as usize
            }
        };
        // in the item's material set first: a unit is left out if it has not got it, a hero's body
        // or an item goes in as it is, since the wrong colours beat the plain model
        let worn = match copy {
            AssetCopy::Unit { .. } if skin != 0 => with_skin(&data, skin),
            _ if skin != 0 => Some(with_skin(&data, skin).unwrap_or(data)),
            _ => Some(data),
        };
        let bytes = match copy {
            AssetCopy::Unit { .. } => worn.and_then(|w| numbered_as(&w, &read(&to).unwrap_or_default())),
            AssetCopy::Hero { activities, .. } => {
                worn.map(|w| attached_as(&hero_model_bytes(w, activities), &read(&to).unwrap_or_default()))
            }
            AssetCopy::Path { form, .. } => {
                let drags = to.ends_with(".vmdl_c") && form != &Some(true) && dragger.drags(&to);
                worn.map(|w| if drags { without_cloth(&w) } else { w })
            }
        };
        let Some(bytes) = bytes else { continue };
        out.push((to.clone(), bytes));
        seen.insert(to);
    }
    Ok(out)
}
