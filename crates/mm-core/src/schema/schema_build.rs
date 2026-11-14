//! What goes into the item table (src/schema-build.ts createTableBuild): every enabled record's
//! patches, each pick of the item builder built once and kept. A pick is kept by item and effects
//! for as long as the game's table and the game are the ones it was built from; the sounds and
//! portraits, made from all the picks at once, for as long as the picks ask for the same ones.
//!
//! The TypeScript runs this as a generator a step at a time so the main process can draw between
//! the steps; here the shell runs the whole build off its main thread, so it is one call, with the
//! bar's count handed to `progress`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

use crate::arcana_base_color::{window_color, ColoredBases};
use crate::arcana_bases::{bases_attached, bases_here, without_base_files, BasePick, BaseSource};
use crate::courier_models::{look_patch, LookPick};
use crate::i18n::t;
use crate::item_builder::{effect_key, item_effect_patch, item_voices};
use crate::item_builder_ability_fx::{fx_slot_of, merge_fx_patches, FxJoin};
use crate::item_builder_assets::{game_asset_entries, ItemAssets, PortraitSwap, SpriteSwap, Summons};
use crate::item_builder_fx_patch::ability_fx_patch;
use crate::item_builder_personas::{
    is_selector_slot, left_out, persona_assets, persona_records, persona_scale_of, persona_scales, personas_on,
    ReadyBase,
};
use crate::item_builder_refits::{pick_models, refits_of};
use crate::item_builder_styles::style_of;
use crate::item_sounds::{sound_entries, SoundSwap, VoiceCue};
use crate::vpk::{entry_at, Entry, Index};

/// A patch of the table as a build makes it: the fields past `source` are an item builder pick's.
#[derive(Debug, Clone)]
pub struct TablePatch {
    pub id: String,
    pub block: Vec<u8>,
    pub assets: Option<Vec<Entry>>,
    pub source: String,
    pub own: Option<String>,
    pub added: Option<Vec<String>>,
    pub unplaced: Option<bool>,
    /// worn as an item: a persona whose base is not here is worn only through the table
    pub item: Option<bool>,
    fx: bool,
}

impl FxJoin for TablePatch {
    fn id(&self) -> &str {
        &self.id
    }
    fn block_mut(&mut self) -> &mut Vec<u8> {
        &mut self.block
    }
    fn take_assets(&mut self) -> Vec<Entry> {
        self.assets.take().unwrap_or_default()
    }
    fn add_assets(&mut self, more: Vec<Entry>) {
        self.assets.get_or_insert_with(Vec::new).extend(more);
    }
    fn source_mut(&mut self) -> &mut String {
        &mut self.source
    }
}

/// The shared files as the picks' pak takes them: `paths` the ones the table's copy carries,
/// `entries` the pak's own, made of the item picks alone.
#[derive(Debug, Clone, Default)]
pub struct FilesShared {
    pub paths: Vec<String>,
    pub entries: Vec<Entry>,
}

/// What a build gives: the patches, the files every patch's own win over, and the shared files.
#[derive(Debug, Clone, Default)]
pub struct Built {
    pub list: Vec<TablePatch>,
    pub beneath: Vec<Entry>,
    pub files_shared: FilesShared,
}

/// A pick of the item builder as built: its block, and the game's files under the plain paths.
struct ItemPick {
    id: String,
    block: Vec<u8>,
    own: Option<String>,
    added: Vec<String>,
    unplaced: bool,
    kinetic: Vec<String>,
    heroes: Vec<String>,
    swaps: ItemAssets,
    assets: Vec<Entry>,
}

fn text_of(rec: &Value, key: &str) -> String {
    match rec.get(key) {
        None => "undefined".into(),
        Some(v) => crate::js::string(v),
    }
}

/// `String(rec.slot || '')`.
fn slot_of(rec: &Value) -> String {
    rec.get("slot").filter(|v| crate::js::truthy(v)).map(crate::js::string).unwrap_or_default()
}

fn name_of(rec: &Value) -> String {
    rec.get("name").map(crate::js::string).unwrap_or_else(|| "undefined".into())
}

fn enabled(rec: &Value) -> bool {
    rec.get("enabled") != Some(&Value::Bool(false))
}

fn persona_of(rec: &Value) -> Option<&Value> {
    rec.get("persona").filter(|p| crate::js::truthy(p))
}

/// A record's effect ids as the builder takes them: a list, or a comma list.
fn effect_ids(rec: &Value) -> Vec<String> {
    match rec.get("effectId") {
        Some(Value::Array(a)) => a.iter().map(crate::js::string).collect(),
        Some(v) if crate::js::truthy(v) => crate::js::string(v).split(',').map(String::from).collect(),
        _ => vec![],
    }
}

/// Whether a record is a pick of the item builder.
pub fn is_item_pick(rec: &Value) -> bool {
    let slot = slot_of(rec);
    rec.get("categoryId").and_then(Value::as_str) == Some("cosmetic") && (slot == "items" || slot.starts_with("item:"))
}

/// Which files a base fills, as a short name: a new version of a base builds its own parts again.
fn base_signature(r: &ReadyBase) -> String {
    let mut paths: Vec<&String> = r.paths.iter().collect();
    paths.sort();
    let joined: Vec<&str> = paths.iter().map(|p| p.as_str()).collect();
    let hex = format!("{:x}", Sha1::digest(joined.join("\n").as_bytes()));
    hex[..10].to_string()
}

fn own_base<'a>(rec: &Value, ready: &'a [ReadyBase]) -> Option<&'a ReadyBase> {
    let id = text_of(rec, "itemId");
    ready.iter().find(|r| r.base.parts.contains(&id))
}

/// A pick by item and effects, by the base of its own arcana set when one is here, by the refit
/// another pick makes of its model, and by how much bigger a persona's body makes its models.
fn pick_key(rec: &Value, ready: &[ReadyBase], refit: Option<&str>, scale: Option<f64>) -> String {
    let mut key = format!("{}|{}", text_of(rec, "itemId"), effect_key(&effect_ids(rec)));
    let fx = fx_slot_of(&slot_of(rec));
    if fx != 0 {
        key += &format!("#fx{fx}");
    }
    if let Some(own) = own_base(rec, ready) {
        key += &format!("|{}:{}", own.base.id, base_signature(own));
    }
    if let Some(p) = persona_of(rec) {
        key += &format!("@{}", p.get("target").map(crate::js::string).unwrap_or_else(|| "undefined".into()));
    }
    if let Some(r) = refit.filter(|r| !r.is_empty()) {
        key += &format!("~{r}");
    }
    if let Some(s) = scale.filter(|&s| s != 0.0 && !s.is_nan()) {
        key += &format!("*{}", crate::js::number(s));
    }
    key
}

/// A swap of the shared files, and whether a persona asked for it (the picks' pak leaves those out).
type Asked<T> = Vec<(T, bool)>;

fn mine<T: Clone>(swaps: &Asked<T>) -> Vec<T> {
    swaps.iter().filter(|(_, p)| !p).map(|(s, _)| s.clone()).collect()
}

fn all<T: Clone>(swaps: &Asked<T>) -> Vec<T> {
    swaps.iter().map(|(s, _)| s.clone()).collect()
}

/// A file out of the game's pak01.
type Read = dyn Fn(&str) -> Option<Vec<u8>>;

/// The game's pak01, opened once for a build.
struct Pak {
    path: PathBuf,
    index: Option<Arc<Index>>,
}

impl Pak {
    fn exists(&self) -> bool {
        self.path.exists()
    }
    /// The index; "Не найден" for a game without the pak, as gameAssetEntries throws.
    fn index(&mut self) -> Result<Arc<Index>, String> {
        if let Some(ix) = &self.index {
            return Ok(ix.clone());
        }
        if !self.exists() {
            return Err(t("Не найден {0}", &[json!(self.path.to_string_lossy())]));
        }
        let ix = crate::vpk_shared::shared_index(&self.path).map_err(|e| e.to_string())?;
        self.index = Some(ix.clone());
        Ok(ix)
    }
}

fn reader(ix: Arc<Index>) -> impl Fn(&str) -> Option<Vec<u8>> {
    move |p: &str| ix.read(p).ok().flatten()
}

/// What goes into the table: every enabled record's patches, each item builder pick built once.
#[derive(Default)]
pub struct TableBuild {
    built: HashMap<String, Arc<ItemPick>>,
    shared: HashMap<String, (String, Vec<Entry>)>,
    built_from: Option<(usize, u32)>,
    built_game: Option<PathBuf>,
    colored: ColoredBases,
}

impl TableBuild {
    pub fn new() -> Self {
        Self::default()
    }

    /// Everything kept, let go: the game was patched, and a pick's files can change with its block the same.
    pub fn forget(&mut self) {
        self.built.clear();
        self.shared.clear();
    }

    /// The item builder's enabled picks, for which arcana bases they put on: not a plain one of
    /// a hero with a persona on, which the build leaves out.
    pub fn picks(records: &[Value]) -> Vec<BasePick> {
        let on: Vec<Value> = records.iter().filter(|r| enabled(r) && is_item_pick(r)).cloned().collect();
        let personas = personas_on(&on);
        on.iter()
            .filter(|r| left_out(r, &personas).is_none())
            .map(|r| BasePick { item_id: text_of(r, "itemId"), style: style_of(&effect_key(&effect_ids(r))) })
            .collect()
    }

    fn shared_entries(
        &mut self,
        name: &str,
        inputs: Value,
        make: impl FnOnce() -> Result<Vec<Entry>, String>,
    ) -> Result<Vec<Entry>, String> {
        let key = inputs.to_string();
        if let Some((k, entries)) = self.shared.get(name) {
            if *k == key {
                return Ok(entries.clone());
            }
        }
        let entries = make()?;
        self.shared.insert(name.to_string(), (key, entries.clone()));
        Ok(entries)
    }

    /// The soundevents, portrait settings and sprite sheet every pick rewrites, as one copy of each.
    #[allow(clippy::too_many_arguments)]
    fn shared_files(
        &mut self,
        pak: &mut Pak,
        tag: &str,
        sounds: Vec<SoundSwap>,
        voices: Vec<VoiceCue>,
        portraits: Vec<PortraitSwap>,
        sprites: Vec<SpriteSwap>,
        log: &mut dyn FnMut(String),
    ) -> Vec<Entry> {
        let mut out = Vec::new();
        let r = self.shared_entries(&format!("portraits{tag}"), json!([portraits, sprites]), || {
            if portraits.is_empty() && sprites.is_empty() {
                return Ok(Vec::new());
            }
            let ix = pak.index()?;
            // the build gives the portraits no log of their own, as the TypeScript does not
            Ok(crate::item_portraits::portrait_entries(&reader(ix.clone()), &portraits, &sprites, &mut |_| {}))
        });
        match r {
            Ok(e) => out.extend(e),
            Err(e) => log(format!("schema: the heroes' portraits left out of the build: {e}")),
        }
        let r = self.shared_entries(&format!("sounds{tag}"), json!([sounds, voices]), || {
            if sounds.is_empty() && voices.is_empty() {
                return Ok(Vec::new());
            }
            let ix = pak.index()?;
            Ok(sound_entries(&ix, &sounds, &voices).into_iter().map(|(p, d)| entry_at(&p, d.into())).collect())
        });
        match r {
            Ok(e) => out.extend(e),
            Err(e) => log(format!("schema: the items' sounds left out of the build: {e}")),
        }
        out
    }

    /// A pick built, or the one built before for the same key.
    #[allow(clippy::too_many_arguments)]
    fn built_pick(
        &mut self,
        vanilla: &[u8],
        pak: &mut Pak,
        key: &str,
        rec: &Value,
        own: Option<&ReadyBase>,
        refit: Option<&str>,
        scale: Option<f64>,
        log: &mut dyn FnMut(String),
    ) -> Result<Arc<ItemPick>, String> {
        if let Some(p) = self.built.get(key) {
            return Ok(p.clone());
        }
        // a summon's plain model, from the game's unit scripts: read only for an item that swaps one
        let mut summons: Option<Summons> = None;
        let pak_path = pak.path.clone();
        let mut resolve = |u: &str, h: &[String], m: &str| -> Option<String> {
            if summons.is_none() {
                let ix = crate::vpk_shared::shared_index(&pak_path).ok()?;
                summons = Some(Summons::new(move |p: &str| ix.read(p).ok().flatten()));
            }
            summons.as_mut()?.resolve(u, h, m)
        };
        let item_id = text_of(rec, "itemId");
        let ids = effect_ids(rec);
        // in an ability effects slot the item gives its effects for that ability and no model
        let fx = fx_slot_of(&slot_of(rec));
        let mut pick = if fx != 0 {
            let p = ability_fx_patch(vanilla, &item_id, &ids, fx, Some(&mut resolve))?;
            ItemPick {
                id: p.id,
                block: p.block,
                own: p.own,
                added: p.added,
                unplaced: p.unplaced,
                kinetic: vec![],
                heroes: vec![],
                swaps: p.assets,
                assets: vec![],
            }
        } else {
            let target = persona_of(rec).and_then(|p| p.get("target")).and_then(Value::as_str);
            let p = item_effect_patch(vanilla, &item_id, &ids, target, Some(&mut resolve), refit)?;
            ItemPick {
                id: p.id,
                block: p.block,
                own: p.own,
                added: p.added,
                unplaced: p.unplaced,
                kinetic: p.kinetic,
                heroes: p.heroes,
                swaps: p.assets,
                assets: vec![],
            }
        };
        let ix = pak.index()?;
        let skip = |p: &str| own.is_some_and(|o| o.paths.contains(p));
        let files = game_asset_entries(&reader(ix.clone()), &pick.swaps.asset_copies, &skip)?;
        let entries = files.into_iter().map(|(p, d)| entry_at(&p, d.into())).collect();
        let name = name_of(rec);
        pick.assets = crate::model_scale::scaled_models(entries, scale, &mut |p, why| {
            log(format!("schema: {name}: {p} left at its own size: {why}"))
        });
        let pick = Arc::new(pick);
        self.built.insert(key.to_string(), pick.clone());
        Ok(pick)
    }

    /// Enabled mods' lifted item blocks and the free cosmetics the user picked. `records` is the
    /// whole library; `progress` gets (done, total) after each pick built anew.
    pub fn build(
        &mut self,
        vanilla: &[u8],
        game: &Path,
        records: &[Value],
        bases: Option<&dyn BaseSource>,
        progress: &mut dyn FnMut(usize, usize),
        log: &mut dyn FnMut(String),
    ) -> Result<Built, String> {
        let from = (vanilla.len(), crc32fast::hash(vanilla));
        if self.built_from != Some(from) || self.built_game.as_deref() != Some(game) {
            self.forget();
            self.built_from = Some(from);
            self.built_game = Some(game.to_path_buf());
        }
        let mut pak = Pak { path: game.join("dota").join("pak01_dir.vpk"), index: None };
        let mut used: HashSet<String> = HashSet::new();
        // the bases with their models' attachments numbered as the game's
        let here = match bases {
            Some(store) => {
                let here = bases_here(&Self::picks(records), store, log);
                if here.is_empty() || !pak.exists() {
                    here
                } else {
                    let ix = pak.index()?;
                    bases_attached(here, &reader(ix.clone()))
                }
            }
            None => Vec::new(),
        };
        // Terrorblade's in the arcana window's colour while its record is on, the persona bases
        // without another item's effects
        let colored = self.colored.apply(here, window_color(records), log);
        let ready = crate::persona_base_effects::without_others_effects(vanilla, colored).map_err(|e| e.to_string())?;
        let mut sounds: Asked<SoundSwap> = Vec::new();
        let mut voices: Asked<VoiceCue> = Vec::new();
        let mut portraits: Asked<PortraitSwap> = Vec::new();
        let mut sprites: Asked<SpriteSwap> = Vec::new();
        // a persona whose base is here is on without the table too: the base is its body
        let worn = |rec: &Value| {
            persona_of(rec).is_none()
                || ready.iter().any(|r| {
                    r.base.persona == Some(true) && slot_of(rec).starts_with(&format!("item:{}:", r.base.hero))
                })
        };
        let mut gems: IndexMap<String, IndexSet<String>> = IndexMap::new();
        let on_records: Vec<Value> = records.iter().filter(|r| enabled(r)).cloned().collect();
        let (all_records, left) = persona_records(&on_records, vanilla).map_err(|e| e.to_string())?;
        // the ability effects slots' picks first: the build keeps the first file of a path and
        // the first sound swap, and in the game the slot's effects win over those of the item worn
        let is_fx = |r: &Value| fx_slot_of(&slot_of(r)) != 0;
        let recs: Vec<Value> =
            all_records.iter().filter(|r| is_fx(r)).chain(all_records.iter().filter(|r| !is_fx(r))).cloned().collect();
        for (rec, why) in &left {
            log(format!("schema: {} left out of the build: {why}", name_of(rec)));
        }
        let mut models = IndexMap::new();
        for (k, rec) in recs.iter().enumerate() {
            if is_item_pick(rec) && !is_fx(rec) {
                if let Some(m) =
                    pick_models(vanilla, &text_of(rec, "itemId"), &effect_ids(rec)).map_err(|e| e.to_string())?
                {
                    models.insert(k, m);
                }
            }
        }
        let refits = refits_of(&models);
        // a persona's body compiled bigger than Valve's makes its items as big, and its voice
        let on = personas_on(&recs);
        for hero in on.keys() {
            let layouts = crate::item_builder_slots::persona_layouts(vanilla).map_err(|e| e.to_string())?;
            let cues: Vec<VoiceCue> = match layouts.get(hero).and_then(|l| l.voice.as_ref()) {
                Some(v) => item_voices(vanilla, v.start)
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|c| VoiceCue { whole: true, ..c })
                    .collect(),
                None => vec![],
            };
            let selector = recs.iter().find(|r| {
                let slot = slot_of(r);
                is_selector_slot(&slot) && persona_of(r).is_some() && slot.starts_with(&format!("item:{hero}:"))
            });
            let persona = selector.is_some_and(|s| !worn(s));
            voices.extend(cues.into_iter().map(|c| (c, persona)));
        }
        let scales = if !on.is_empty() && pak.exists() {
            let ix = pak.index()?;
            persona_scales(&on, &ready, &reader(ix.clone()))
        } else {
            IndexMap::new()
        };
        let keys: Vec<Option<String>> = recs
            .iter()
            .enumerate()
            .map(|(k, r)| {
                is_item_pick(r)
                    .then(|| pick_key(r, &ready, refits.get(&k).map(String::as_str), persona_scale_of(r, &scales)))
            })
            .collect();
        let total = keys.iter().flatten().filter(|k| !self.built.contains_key(*k)).count();
        let mut done = 0;
        let mut out: Vec<TablePatch> = Vec::new();
        // each item pick's patch, by where it is in `out`, and its own model
        let mut owned: Vec<(usize, Option<String>)> = Vec::new();
        for (k, rec) in recs.iter().enumerate() {
            if rec.get("categoryId").and_then(Value::as_str) == Some("cosmetic") {
                let fresh = keys[k].as_ref().is_some_and(|key| !self.built.contains_key(key));
                let name = name_of(rec);
                let r: Result<(), String> = (|| {
                    if let Some(key) = &keys[k] {
                        let scale = persona_scale_of(rec, &scales);
                        let refit = refits.get(&k).map(String::as_str);
                        let pick =
                            self.built_pick(vanilla, &mut pak, key, rec, own_base(rec, &ready), refit, scale, log)?;
                        used.insert(key.clone());
                        let item_id = text_of(rec, "itemId");
                        let assets = if persona_of(rec).is_some() && !is_selector_slot(&slot_of(rec)) {
                            persona_assets(rec, pick.assets.clone(), &ready)
                        } else {
                            without_base_files(&item_id, pick.assets.clone(), &ready)
                        };
                        let is_worn = worn(rec);
                        owned.push((out.len(), pick.own.clone()));
                        out.push(TablePatch {
                            id: pick.id.clone(),
                            block: pick.block.clone(),
                            assets: Some(assets),
                            source: name.clone(),
                            own: pick.own.clone(),
                            added: Some(pick.added.clone()),
                            unplaced: Some(pick.unplaced),
                            item: Some(is_worn),
                            fx: is_fx(rec),
                        });
                        let persona = !is_worn;
                        sounds.extend(pick.swaps.sounds.iter().map(|s| (s.clone(), persona)));
                        voices.extend(pick.swaps.voices.iter().map(|s| (s.clone(), persona)));
                        // a persona's body bigger than Valve's is framed as much further off
                        portraits.extend(pick.swaps.portraits.iter().map(|p| {
                            let hero = p.hero.strip_prefix("npc_dota_hero_").unwrap_or(&p.hero);
                            let mut p = p.clone();
                            if let Some(&s) = scales.get(hero).filter(|s| **s != 0.0) {
                                p.scale = Some(s);
                            }
                            (p, persona)
                        }));
                        sprites.extend(pick.swaps.sprites.iter().map(|s| (s.clone(), persona)));
                        if !pick.kinetic.is_empty() {
                            for hero in &pick.heroes {
                                gems.entry(hero.clone()).or_default().extend(pick.kinetic.iter().cloned());
                            }
                        }
                    } else {
                        let ix = pak.index().ok();
                        let none = |_: &str| None;
                        let read: Box<Read> = match &ix {
                            Some(ix) => Box::new(reader(ix.clone())),
                            None => Box::new(none),
                        };
                        let look = LookPick { name: &name, slot: &slot_of(rec), item_id: &text_of(rec, "itemId") };
                        if let Some(p) = look_patch(vanilla, &read, &look, log)? {
                            out.push(TablePatch {
                                id: p.id,
                                block: p.block,
                                assets: (!p.assets.is_empty()).then_some(p.assets),
                                source: p.source,
                                own: None,
                                added: None,
                                unplaced: None,
                                item: None,
                                fx: false,
                            });
                        }
                    }
                    Ok(())
                })();
                // a donor Valve removed drops out of the build, and so does a pick the builder refuses
                if let Err(e) = r {
                    log(format!("schema: {name} left out of the build: {e}"));
                }
                if fresh {
                    done += 1;
                    progress(done, total);
                }
                continue;
            }
            let Some(list) = rec.get("schema").and_then(Value::as_array) else { continue };
            for d in list {
                out.push(TablePatch {
                    id: d.get("id").map(crate::js::string).unwrap_or_else(|| "undefined".into()),
                    block: crate::kv::to_latin1(&d.get("block").map(crate::js::string).unwrap_or_default()),
                    assets: None,
                    source: name_of(rec),
                    own: None,
                    added: None,
                    unplaced: None,
                    item: None,
                    fx: false,
                });
            }
        }
        // a pick's own model keeps its stock path: another pick's file at that path is taken out
        let taken: HashSet<String> = owned.iter().filter_map(|(_, o)| o.clone().filter(|o| !o.is_empty())).collect();
        if !taken.is_empty() {
            for (at, own) in &owned {
                if let Some(assets) = &mut out[*at].assets {
                    assets.retain(|e| {
                        let p = e.path().to_lowercase();
                        own.as_deref() == Some(p.as_str()) || !taken.contains(&p)
                    });
                }
            }
        }
        // every hero's picks in one ability effects slot dress the one stock item all heroes wear there
        let mut list = merge_fx_patches(out, |p| p.fx).map_err(|e| e.to_string())?;
        // the soundevents, portraits and sprites of every pick go into one copy of each, ahead of
        // all other files, on an item pick where there is one
        let first = list
            .iter()
            .position(|p| p.assets.is_some() && p.item == Some(true))
            .or_else(|| list.iter().position(|p| p.assets.is_some()));
        let made = match first {
            Some(_) => self.shared_files(&mut pak, "", all(&sounds), all(&voices), all(&portraits), all(&sprites), log),
            None => Vec::new(),
        };
        if let Some(at) = first {
            let mut assets = made.clone();
            assets.extend(list[at].assets.take().unwrap_or_default());
            list[at].assets = Some(assets);
        }
        // the picks' pak, without the table, carries no persona
        let from_persona = sounds.iter().any(|x| x.1)
            || voices.iter().any(|x| x.1)
            || portraits.iter().any(|x| x.1)
            || sprites.iter().any(|x| x.1);
        let paths = made.iter().map(|e| e.path().to_lowercase()).collect();
        let entries = if from_persona {
            self.shared_files(&mut pak, "-items", mine(&sounds), mine(&voices), mine(&portraits), mine(&sprites), log)
        } else {
            made
        };
        // a pick taken off lets its files go
        self.built.retain(|k, _| used.contains(k));
        let worn_gems: Vec<(String, Vec<String>)> = gems
            .iter()
            .map(|(hero, on)| {
                let mut on: Vec<String> = on.iter().cloned().collect();
                on.sort_by(|a, b| crate::js::cmp_utf16(a, b));
                (hero.clone(), on)
            })
            .collect();
        let moves = self.shared_entries("kinetic", json!(worn_gems), || {
            let ix = pak.index()?;
            let worn: IndexMap<String, Vec<String>> =
                gems.iter().map(|(h, on)| (h.clone(), on.iter().cloned().collect())).collect();
            let files = crate::item_builder_kinetic::kinetic_entries(&reader(ix.clone()), &worn)?;
            Ok(files.into_iter().map(|(p, d)| entry_at(&p, d.into())).collect())
        });
        let moves = moves.unwrap_or_else(|e| {
            log(format!("schema: the kinetic gems' animations left out of the build: {e}"));
            Vec::new()
        });
        let mut beneath: Vec<Entry> = ready.into_iter().flat_map(|r| r.entries).collect();
        beneath.extend(moves);
        Ok(Built { list, beneath, files_shared: FilesShared { paths, entries } })
    }
}
