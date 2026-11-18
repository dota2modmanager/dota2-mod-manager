//! The item builder's picks as files alone (src/item-files.ts): a look the game takes from a pak in
//! the language folder, with no edit of the game's files and no line in its item table. The item's
//! effects go into the wearable's key values with hitboxes on its surface, its material set becomes
//! the model's default, its motions are taken off the hero's body, the hero parts it hides become
//! the default of the model that has them, and a second model it wears goes inside its first. What
//! is left needs the table, and a pick with such a part says what it lost (`left`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use indexmap::{IndexMap, IndexSet};

use crate::item_builder_assets::{hero_model_path, normalize_asset_path};
use crate::kv::{self, latin1, KvError};
use crate::schema_build::{FilesShared, TablePatch};
use crate::vpk::{entry_at, Entry};

/// What of an item a file cannot say, by the type of its asset_modifier, with the word the log uses.
const TABLE_ONLY: [(&str, &str); 9] = [
    ("entity_scale", "its size"),
    ("hero_scale", "its size"),
    ("custom_kill_effect", "its kill effect"),
    ("particle_combined", "its paired effects"),
    ("particle_control_point", "its effect points"),
    ("hex_model", "its hex model"),
    ("buff_modifier", "its buff effect"),
    ("arcana_level", "its arcana levels"),
    ("pet", "its pet"),
];

type Fields = IndexMap<String, String>;

fn is_modifier_key(key: &[u8]) -> bool {
    static RE: OnceLock<regex::bytes::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::bytes::Regex::new(r"(?i-u)^asset_modifier[0-9]*$").unwrap()).is_match(key)
}

/// The fields of each asset_modifier of the first style in an item block's visuals.
fn modifiers(block: &[u8]) -> Result<Vec<Fields>, KvError> {
    let mut out = Vec::new();
    for c in kv::children(block, kv::block_bounds(block, 0)?)? {
        let Some(body) = c.body.filter(|_| c.key.eq_ignore_ascii_case(b"visuals")) else { continue };
        for m in kv::children(block, body)? {
            let Some(mb) = m.body.filter(|_| is_modifier_key(m.key)) else { continue };
            let mut fields = Fields::new();
            for f in kv::children(block, mb)? {
                if let Some(v) = f.value.filter(|_| !f.is_block()) {
                    fields.insert(latin1(f.key).to_lowercase(), latin1(v));
                }
            }
            if fields.get("style").is_none_or(|s| s.is_empty() || s == "0") {
                out.push(fields);
            }
        }
    }
    Ok(out)
}

fn of_type<'a>(mods: &'a [Fields], ty: &str) -> impl Iterator<Item = &'a Fields> + 'a {
    let ty = ty.to_string();
    mods.iter().filter(move |f| f.get("type").map(|t| t.to_lowercase()).unwrap_or_default() == ty)
}

fn truthy(v: Option<&String>) -> Option<&String> {
    v.filter(|s| !s.is_empty())
}

/// The visuals block alone.
fn visuals_of(block: &[u8]) -> Result<Vec<u8>, KvError> {
    let mut out = Vec::new();
    for c in kv::children(block, kv::block_bounds(block, 0)?)? {
        if c.is_block() && c.key.eq_ignore_ascii_case(b"visuals") {
            out = block[c.start..c.end].to_vec();
        }
    }
    Ok(out)
}

/// The set a pick wears its model in, 0 for the first: the model_skin modifier's, the first
/// style's, and last the one the visuals name by themselves.
fn skin_of(block: &[u8], mods: &[Fields]) -> Result<f64, KvError> {
    let visuals = visuals_of(block)?;
    let named = match of_type(mods, "model_skin").next() {
        Some(f) if f.contains_key("skin") => f.get("skin").cloned(),
        _ if !visuals.is_empty() => crate::item_skin::first_style_skin(&visuals)?.map(|s| latin1(&s)),
        _ => None,
    };
    let n = match named {
        Some(s) => crate::js::to_number(&serde_json::Value::String(s)),
        None if !visuals.is_empty() => crate::item_skin::worn_skin(&visuals, 0, None)? as f64,
        None => 0.0,
    };
    Ok(if n.is_nan() { 0.0 } else { n })
}

/// A choice of a body group an item makes, on the model that has the group.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BodyGroup {
    pub model: String,
    pub group: String,
    pub value: f64,
}

/// What a pick's block asks of its files.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Parts {
    pub systems: Vec<String>,
    pub skin: f64,
    pub motions: Vec<String>,
    pub groups: Vec<BodyGroup>,
    pub extras: Vec<String>,
    pub left: Vec<String>,
}

fn unique(it: impl Iterator<Item = String>) -> Vec<String> {
    it.collect::<IndexSet<String>>().into_iter().collect()
}

/// What a pick's block asks of its files: its effects, material set and motions, and what it asks
/// that a file cannot say.
pub fn pick_parts(block: &[u8], own: Option<&str>, unplaced: bool) -> Result<Parts, KvError> {
    let mods = modifiers(block)?;
    let words = |ty: &str| unique(of_type(&mods, ty).filter_map(|f| truthy(f.get("modifier")).cloned()));
    // not an effect only the item's showcase has: written into the model it would play in the match too
    let systems = unique(
        of_type(&mods, "particle_create")
            .filter(|f| f.get("spawn_in_loadout_only").map(String::as_str) != Some("1"))
            .filter_map(|f| truthy(f.get("modifier")).cloned()),
    );
    let mut left = unique(mods.iter().filter_map(|f| {
        let ty = f.get("type").map(|t| t.to_lowercase()).unwrap_or_default();
        TABLE_ONLY.iter().find(|(k, _)| *k == ty).map(|(_, w)| w.to_string())
    }));
    if unplaced {
        left.push("its model".into());
    }
    if !systems.is_empty() && own.is_none_or(str::is_empty) {
        left.push("its effect".into());
    }
    let groups = of_type(&mods, "bodygroup_visibility")
        .filter_map(|f| {
            let (asset, modifier) = (truthy(f.get("asset"))?, truthy(f.get("modifier"))?);
            let v = f.get("value").map_or(0.0, |v| crate::js::to_number(&serde_json::Value::String(v.clone())));
            Some(BodyGroup {
                model: normalize_asset_path(asset),
                group: modifier.to_lowercase(),
                value: if v.is_nan() { 0.0 } else { v },
            })
        })
        .collect();
    Ok(Parts {
        systems,
        skin: skin_of(block, &mods)?,
        motions: words("activity"),
        groups,
        extras: extras_of_mods(&mods),
        left,
    })
}

fn extras_of_mods(mods: &[Fields]) -> Vec<String> {
    unique(of_type(mods, "additional_wearable").filter_map(|f| truthy(f.get("asset")).map(|a| normalize_asset_path(a))))
}

/// The second models of a block, as paths.
pub fn extras_of(block: &[u8]) -> Result<Vec<String>, KvError> {
    Ok(extras_of_mods(&modifiers(block)?))
}

/// A second model's place: under a stock second model's path, with the model to put there (None:
/// that path goes empty).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Under {
    pub path: String,
    pub model: Option<String>,
}

/// Where a pick's second models go: the pick's own take the stock item's paths, and with none left
/// that path goes empty; one the stock item has no path for rides inside the first model.
pub fn extra_places(stock: &[String], extras: &[String]) -> (Vec<Under>, Vec<String>) {
    // each stock place takes the next merged model, and what is left over stays merged (shift() in the TypeScript)
    let mut queue: std::collections::VecDeque<String> = extras.iter().filter(|x| !stock.contains(x)).cloned().collect();
    let under = stock
        .iter()
        .filter(|s| !extras.contains(s))
        .map(|path| Under { path: path.clone(), model: queue.pop_front() })
        .collect();
    (under, queue.into_iter().collect())
}

/// A wearable as it goes in: in its material set, carrying its effects over the boxes of `set`. None: the
/// file stays as it was.
pub fn worn_model(model: &[u8], skin: f64, systems: &[&str], set: &str) -> Option<Vec<u8>> {
    // a set the model has not got (a coronet of no material sets asked for set 2) leaves it as the
    // game shows it, in its own; it took the effect down with it once
    let out = if skin != 0.0 && !skin.is_nan() {
        crate::model_skin::with_skin(model, skin as usize).unwrap_or_else(|| model.to_vec())
    } else {
        model.to_vec()
    };
    if systems.is_empty() {
        return Some(out);
    }
    // no boxes (a model this cannot read) leaves the effect at the model's origin, which is still the effect
    let boxed = crate::model_hitboxes::with_surface_hitboxes(&out, &[set]).unwrap_or(out);
    crate::model_particles::with_particles(&boxed, systems)
}

/// One source and what of it stays behind without the table.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LeftBehind {
    pub source: String,
    pub what: Vec<String>,
}

/// A build's files, and what of the picks they could not carry.
#[derive(Debug, Clone, Default)]
pub struct ItemFiles {
    pub entries: Vec<Entry>,
    pub left: Vec<LeftBehind>,
}

/// Whether a pick wears its effects on the hero's body alone: it has no model of its own and so
/// no stock path (a body arcana in the base slot, Bladeform Legacy, Demon Eater), and it is not a
/// model the slot has no place for.
fn on_body_alone(block: &[u8], own: Option<&str>, unplaced: bool) -> Result<bool, KvError> {
    if own.is_some() || unplaced {
        return Ok(false);
    }
    let fields = crate::schema::item_fields(block, 0)?;
    Ok(fields.iter().find(|(k, _)| k == "model_player").is_none_or(|(_, v)| v.trim().is_empty()))
}

/// The compiled paths of the free mount models the hero wears (a rider's beast), lowercased: a
/// courier's effect goes on them as on the body.
fn stock_mounts(table: &[u8], hero: &str) -> Result<Vec<String>, KvError> {
    let mut out = Vec::new();
    for item in crate::schema::items_of(table)?.iter() {
        let stock = item.baseitem || item.prefab.eq_ignore_ascii_case("default_item");
        if !stock || item.model.is_empty() || !item.slot.eq_ignore_ascii_case("mount") {
            continue;
        }
        if crate::item_builder_slots::item_heroes(table, item.start)?.iter().any(|h| h == hero) {
            out.push(compiled(&item.model.replace('\\', "/")).to_lowercase());
        }
    }
    Ok(out)
}

/// The compiled path of a hero's body, lowercased.
fn body_path(read: &dyn Fn(&str) -> Option<Vec<u8>>, hero: &str) -> Result<String, String> {
    let at = format!("{}_c", hero_model_path(read, hero)?).to_lowercase();
    Ok(match at.strip_suffix("_c_c") {
        Some(s) => format!("{s}_c"),
        None => at,
    })
}

/// A pick with an effect the person added, sewn into its hero's body (item_in_body.rs): the body's
/// path and what sewing made, or None where the pick is not one hero's or its models do not join
/// (it keeps the effect on itself then). The caller asks first whether the item has to stay a
/// wearable of its own (`stays_apart`). The body is the one the picks before made, if any.
#[allow(clippy::too_many_arguments)]
fn sew_in(
    block: &[u8],
    id: &str,
    at: &str,
    item: &Entry,
    skin: f64,
    systems: &[String],
    added: &HashSet<String>,
    entries: &IndexMap<String, Entry>,
    under: &HashMap<String, Vec<u8>>,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Option<(String, crate::item_in_body::Sewn)>, String> {
    let heroes = crate::item_builder_slots::item_heroes(block, 0).map_err(|e| e.to_string())?;
    let [hero] = heroes.as_slice() else { return Ok(None) };
    let Ok(body_at) = body_path(read, hero) else { return Ok(None) };
    let body = entries
        .get(&body_at)
        .map(|en| en.data.to_vec())
        .or_else(|| under.get(&body_at).cloned())
        .or_else(|| read(&body_at));
    let Some(body) = body else { return Ok(None) };
    let token = crate::item_in_body::pick_token(id, at);
    let sewn = crate::item_in_body::sewn_into_body(&body, &item.data, skin, systems, added, &token, read)?;
    Ok(sewn.map(|s| (body_at, s)))
}

fn compiled(p: &str) -> String {
    format!("{}_c", p.strip_suffix("_c").unwrap_or(p))
}

/// The list a table build made, as one pak's files. `read`: a file of the game's pak01, for the
/// models the picks did not already copy; `beneath`: files that go in after the picks' (the bases).
pub fn item_files(
    list: &[TablePatch],
    beneath: &[Entry],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    shared: Option<&FilesShared>,
) -> Result<ItemFiles, String> {
    let e = |x: KvError| x.to_string();
    let mut entries: IndexMap<String, Entry> = IndexMap::new();
    let mut left: Vec<LeftBehind> = Vec::new();
    let mut bodies: IndexMap<String, Vec<String>> = IndexMap::new();
    let mut hidden: IndexMap<String, IndexMap<String, f64>> = IndexMap::new();
    // couriers' effects the person added, by hero: they go on the body (and its mount), as a
    // courier wears them, where dota-studio puts them too
    let mut hero_fx: IndexMap<String, Vec<String>> = IndexMap::new();
    // the effects of a pick with no stock path (a body arcana), by hero: they go on the body alone
    let mut body_fx: IndexMap<String, Vec<String>> = IndexMap::new();
    // the stock paths an item sewn into its body left with nothing to draw
    let mut emptied: HashSet<String> = HashSet::new();
    let mut table: Option<Vec<u8>> = None;
    // the sprite sheet, portraits and soundevents of the item picks alone, in place of the table's copy
    let own: HashSet<String> = shared.map(|s| s.paths.iter().cloned().collect()).unwrap_or_default();
    for en in shared.map(|s| s.entries.as_slice()).unwrap_or(&[]) {
        entries.insert(en.path().to_lowercase(), en.clone());
    }
    // a body or a model the picks did not bring is the arcana base's where it has one, then the game's
    let under: HashMap<String, Vec<u8>> =
        beneath.iter().map(|en| (en.path().to_lowercase(), en.data.to_vec())).collect();
    for patch in list {
        let source = if patch.source.is_empty() { patch.id.clone() } else { patch.source.clone() };
        // a persona, worn through the table; what is not a pick at all, a mod's block, the caller counts itself
        if patch.item != Some(true) {
            if patch.added.is_some() {
                left.push(LeftBehind { source, what: vec!["its persona".into()] });
            }
            continue;
        }
        let pick_own = patch.own.as_deref().filter(|o| !o.is_empty());
        let Parts { mut systems, skin, motions, groups, extras, left: mut what } =
            pick_parts(&patch.block, pick_own, patch.unplaced == Some(true)).map_err(e)?;
        for en in patch.assets.as_deref().unwrap_or(&[]) {
            let p = en.path().to_lowercase();
            if !own.contains(&p) && !entries.contains_key(&p) {
                entries.insert(p, en.clone());
            }
        }
        // a courier's effect the person added goes on the hero's whole body, not on the item
        let added_all: HashSet<String> = patch.added.iter().flatten().map(|s| s.to_lowercase()).collect();
        // and a pick with no stock path of its own (a body arcana in the hero's base slot) wears all
        // of its effects there: by the table the game hangs them on the hero, and without a path
        // they were left out ("without the table has not got its effect"), the arcana's aura lost
        if !systems.is_empty() && on_body_alone(&patch.block, pick_own, patch.unplaced == Some(true)).map_err(e)? {
            what.retain(|w| w != "its effect");
            for hero in crate::item_builder_slots::item_heroes(&patch.block, 0).map_err(e)? {
                let list = body_fx.entry(hero).or_default();
                for s in &systems {
                    if !list.contains(s) {
                        list.push(s.clone());
                    }
                }
            }
            systems.clear();
        }
        let courier: Vec<String> = systems
            .iter()
            .filter(|s| added_all.contains(&s.to_lowercase()) && crate::item_in_body::on_hero(s))
            .cloned()
            .collect();
        if !courier.is_empty() {
            systems.retain(|s| !courier.contains(s));
            for hero in crate::item_builder_slots::item_heroes(&patch.block, 0).map_err(e)? {
                let list = hero_fx.entry(hero).or_default();
                for s in &courier {
                    if !list.contains(s) {
                        list.push(s.clone());
                    }
                }
            }
        }
        if let Some(own) = pick_own.filter(|_| !systems.is_empty() || skin != 0.0) {
            let at = own.to_lowercase();
            // an effect the person added spreads over the item; the item's own was made for it
            let added: HashSet<String> = patch.added.iter().flatten().map(|s| s.to_lowercase()).collect();
            let entry = entries.get(&at).cloned();
            let sewn = match &entry {
                Some(en) if systems.iter().any(|s| added.contains(&s.to_lowercase())) => {
                    // what the item does is in its own entry: the pick's block went without the file swaps
                    if table.is_none() {
                        table = read(crate::schema::SCHEMA_REL);
                    }
                    let apart = match (&table, &patch.item_id) {
                        (Some(t), Some(id)) => {
                            match crate::schema_merge::items_by_id(t).map_err(e)?.find(t, id).map_err(e)? {
                                Some((s, end)) => crate::item_in_body::stays_apart(&t[s..end]),
                                None => true,
                            }
                        }
                        _ => crate::item_in_body::stays_apart(&patch.block),
                    };
                    if apart {
                        None
                    } else {
                        sew_in(&patch.block, &patch.id, &at, en, skin, &systems, &added, &entries, &under, read)?
                    }
                }
                _ => None,
            };
            if let Some((body_at, sewn)) = sewn {
                for (p, d) in sewn.files {
                    entries.insert(p.to_lowercase(), entry_at(&p, d.into()));
                }
                entries.insert(body_at.clone(), entry_at(&body_at, sewn.body.into()));
                emptied.insert(at.clone());
                entries.insert(at, entry_at(own, sewn.empty_item.into()));
            } else if let Some(entry) = entry {
                let mut roots = Vec::new();
                // a set of this pick alone, as one sewn into the body has: a moving item keeps its own model
                let scope = crate::particle_surface::item_scope(&crate::item_in_body::pick_token(&patch.id, &at));
                for s in &systems {
                    let copy = if added.contains(&s.to_lowercase()) {
                        let mut r = |p: &str| read(p);
                        crate::particle_surface::surface_system_in(&mut r, s, &scope)?
                    } else {
                        None
                    };
                    match copy {
                        Some((root, files)) => {
                            for (p, d) in files {
                                entries.insert(p.to_lowercase(), entry_at(&p, d.into()));
                            }
                            roots.push(root);
                        }
                        None => roots.push(s.clone()),
                    }
                }
                let refs: Vec<&str> = roots.iter().map(String::as_str).collect();
                match worn_model(&entry.data, skin, &refs, &scope.set) {
                    Some(worn) => {
                        entries.insert(at, entry_at(&entry.path(), worn.into()));
                    }
                    None if !systems.is_empty() => what.push("its effect".into()),
                    None => {}
                }
            } else if !systems.is_empty() {
                what.push("its effect".into());
            }
        }
        if pick_own.is_some() && table.is_none() {
            let t = read(crate::schema::SCHEMA_REL).ok_or_else(|| "the game has no item table".to_string())?;
            table = Some(t);
        }
        let stock = match (pick_own, &table) {
            (Some(_), Some(t)) => {
                match crate::schema_merge::items_by_id(t).map_err(e)?.find(t, &patch.id).map_err(e)? {
                    Some((s, end)) => extras_of(&t[s..end]).map_err(e)?,
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        };
        let (under, merged) = extra_places(&stock, &extras);
        for u in under {
            let at = compiled(&u.path).to_lowercase();
            let file = read(&u.model.as_deref().map_or(at.clone(), compiled));
            let put = match (file, &u.model) {
                (Some(f), Some(_)) => Some(f),
                (Some(f), None) => crate::model_bodygroups::without_meshes(&f)?,
                (None, _) => None,
            };
            match put {
                Some(p) => {
                    entries.insert(at.clone(), entry_at(&at, p.into()));
                }
                None => what.push("a second model".into()),
            }
        }
        if !merged.is_empty() {
            let at = pick_own.map(str::to_lowercase);
            let entry = at.as_ref().and_then(|a| entries.get(a)).cloned();
            for extra in &merged {
                let second = read(&compiled(extra));
                let current = at.as_ref().and_then(|a| entries.get(a));
                // a model this cannot read stays out, and the window says so
                let joined = match (current, &second) {
                    (Some(c), Some(s)) => crate::model_merge::merged_model(&c.data, s).ok().flatten(),
                    _ => None,
                };
                match (joined, &at, &entry) {
                    (Some(j), Some(a), Some(en)) => {
                        entries.insert(a.clone(), entry_at(&en.path(), j.into()));
                    }
                    _ => what.push("a second model".into()),
                }
            }
        }
        if !motions.is_empty() {
            for hero in crate::item_builder_slots::item_heroes(&patch.block, 0).map_err(e)? {
                let list = bodies.entry(hero).or_default();
                for m in &motions {
                    if !list.contains(m) {
                        list.push(m.clone());
                    }
                }
            }
        }
        if !groups.is_empty() {
            let fields = crate::schema::item_fields(&patch.block, 0).map_err(e)?;
            let mine = normalize_asset_path(fields.iter().find(|(k, _)| k == "model_player").map_or("", |(_, v)| v));
            for g in &groups {
                // the item's own model goes under its stock path; a hero's body, or an arcana's, stays where it is
                let model = match pick_own {
                    Some(o) if g.model == mine => o.to_string(),
                    _ => g.model.clone(),
                };
                let at = compiled(&model.to_lowercase());
                hidden.entry(at).or_default().insert(g.group.clone(), g.value);
            }
        }
        if !what.is_empty() {
            left.push(LeftBehind { source, what });
        }
    }
    let current = |entries: &IndexMap<String, Entry>, at: &str| {
        entries.get(at).map(|en| en.data.to_vec()).or_else(|| under.get(at).cloned()).or_else(|| read(at))
    };
    for (hero, motions) in &bodies {
        let at = body_path(read, hero)?;
        let Some(body) = current(&entries, &at) else { continue };
        let mut made = Ok(body);
        for m in motions {
            made = made.and_then(|b| crate::arcana::as_model(&b, Some(m)));
        }
        match made {
            Ok(b) => {
                entries.insert(at.clone(), entry_at(&at, b.into()));
            }
            Err(_) => left.push(LeftBehind { source: hero.clone(), what: vec!["its motions".into()] }),
        }
    }
    for (at, groups) in &hidden {
        let shown = match current(&entries, at) {
            Some(model) => crate::model_bodygroups::with_bodygroups(&model, groups)?,
            None => None,
        };
        match shown {
            Some(s) => {
                entries.insert(at.clone(), entry_at(at, s.into()));
            }
            None => left.push(LeftBehind { source: at.clone(), what: vec!["the hero parts it hides".into()] }),
        }
    }
    // couriers' effects on the body, and on the hero's stock mount unless an item sewn in took its place
    for (hero, systems) in &hero_fx {
        let mut hosts = vec![body_path(read, hero)?];
        if table.is_none() {
            table = read(crate::schema::SCHEMA_REL);
        }
        if let Some(t) = &table {
            hosts.extend(stock_mounts(t, hero).map_err(e)?.into_iter().filter(|m| !emptied.contains(m)));
        }
        let refs: Vec<&str> = systems.iter().map(String::as_str).collect();
        for at in hosts {
            let Some(model) = current(&entries, &at) else { continue };
            match crate::model_particles::with_more_particles(&model, &refs) {
                Some(m) => {
                    entries.insert(at.clone(), entry_at(&at, m.into()));
                }
                None => left.push(LeftBehind { source: hero.clone(), what: vec!["its courier effect".into()] }),
            }
        }
    }
    // a body arcana's own effects on the body
    for (hero, systems) in &body_fx {
        let at = body_path(read, hero)?;
        let Some(model) = current(&entries, &at) else { continue };
        let refs: Vec<&str> = systems.iter().map(String::as_str).collect();
        match crate::model_particles::with_more_particles(&model, &refs) {
            Some(m) => {
                entries.insert(at.clone(), entry_at(&at, m.into()));
            }
            None => left.push(LeftBehind { source: hero.clone(), what: vec!["its effect".into()] }),
        }
    }
    for en in beneath {
        let p = en.path().to_lowercase();
        if !entries.contains_key(&p) {
            entries.insert(p, en.clone());
        }
    }
    Ok(ItemFiles { entries: entries.into_values().collect(), left })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_body_arcana_with_no_model_wears_its_effects_on_the_body() {
        let body_arcana = b"\"9059\"\n{\n\t\"item_slot\"\t\t\"hero_base\"\n\t\"prefab\"\t\t\"wearable\"\n}";
        let wearable = b"\"9021\"\n{\n\t\"item_slot\"\t\t\"head\"\n\t\"model_player\"\t\t\"models/items/x/x.vmdl\"\n}";
        assert!(on_body_alone(body_arcana, None, false).unwrap());
        // an item with a model keeps its effects on its model, wherever that goes
        assert!(!on_body_alone(wearable, None, false).unwrap());
        assert!(!on_body_alone(wearable, Some("models/heroes/x/x_head.vmdl_c"), false).unwrap());
        // a model the slot has no place for is reported as such, not moved to the body
        assert!(!on_body_alone(body_arcana, None, true).unwrap());
    }

    /// On the game's own files (MM_TEST_PAK01): a rider's free mount is found for the courier's
    /// effect to go on it as on the body; a hero with no mount has none.
    #[test]
    fn a_riders_free_mount_takes_the_couriers_effect_too() {
        let Ok(pak) = std::env::var("MM_TEST_PAK01") else { return };
        let ix = crate::vpk::Index::open(std::path::Path::new(&pak)).unwrap();
        let text = ix.read(crate::schema::SCHEMA_REL).unwrap().unwrap();
        let mounts = stock_mounts(&text, "npc_dota_hero_batrider").unwrap();
        assert!(!mounts.is_empty(), "the rider has a mount");
        assert!(mounts.iter().all(|m| m.ends_with(".vmdl_c") && ix.read(m).unwrap().is_some()), "{mounts:?}");
        assert!(stock_mounts(&text, "npc_dota_hero_lina").unwrap().is_empty());
    }
}
