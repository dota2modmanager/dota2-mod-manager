//! The item builder's picks as files alone (src/item-files.ts): a look the game takes from a pak in
//! the language folder, with no edit of the game's files and no line in its item table. The item's
//! effects go into the wearable's key values with hitboxes on its surface, its material set becomes
//! the model's default, its motions are taken off the hero's body, the hero parts it hides become
//! the default of the model that has them, and a second model it wears goes inside its first. What
//! is left needs the table, and a pick with such a part says what it lost (`left`).

use std::collections::HashSet;
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

/// A wearable as it goes in: in its material set, carrying its effects. None: the file stays as it was.
pub fn worn_model(model: &[u8], skin: f64, systems: &[&str]) -> Option<Vec<u8>> {
    let out = if skin != 0.0 && !skin.is_nan() {
        crate::model_skin::with_skin(model, skin as usize)?
    } else {
        model.to_vec()
    };
    if systems.is_empty() {
        return Some(out);
    }
    // no boxes (a model this cannot read) leaves the effect at the model's origin, which is still the effect
    let boxed =
        crate::model_hitboxes::with_surface_hitboxes(&out, &[crate::model_hitboxes::SURFACE_SET]).unwrap_or(out);
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
    let mut table: Option<Vec<u8>> = None;
    // the sprite sheet, portraits and soundevents of the item picks alone, in place of the table's copy
    let own: HashSet<String> = shared.map(|s| s.paths.iter().cloned().collect()).unwrap_or_default();
    for en in shared.map(|s| s.entries.as_slice()).unwrap_or(&[]) {
        entries.insert(en.path().to_lowercase(), en.clone());
    }
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
        let Parts { systems, skin, motions, groups, extras, left: mut what } =
            pick_parts(&patch.block, pick_own, patch.unplaced == Some(true)).map_err(e)?;
        for en in patch.assets.as_deref().unwrap_or(&[]) {
            let p = en.path().to_lowercase();
            if !own.contains(&p) && !entries.contains_key(&p) {
                entries.insert(p, en.clone());
            }
        }
        if let Some(own) = pick_own.filter(|_| !systems.is_empty() || skin != 0.0) {
            let at = own.to_lowercase();
            // an effect the person added spreads over the item; the item's own was made for it
            let added: HashSet<String> = patch.added.iter().flatten().map(|s| s.to_lowercase()).collect();
            if let Some(entry) = entries.get(&at).cloned() {
                let mut roots = Vec::new();
                for s in &systems {
                    let copy = if added.contains(&s.to_lowercase()) {
                        let mut r = |p: &str| read(p);
                        crate::particle_surface::surface_system(&mut r, s)?
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
                match worn_model(&entry.data, skin, &refs) {
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
    // a body or a model the picks did not bring is the arcana base's where it has one, then the game's
    let under: std::collections::HashMap<String, Vec<u8>> =
        beneath.iter().map(|en| (en.path().to_lowercase(), en.data.to_vec())).collect();
    let current = |entries: &IndexMap<String, Entry>, at: &str| {
        entries.get(at).map(|en| en.data.to_vec()).or_else(|| under.get(at).cloned()).or_else(|| read(at))
    };
    for (hero, motions) in &bodies {
        let model = hero_model_path(read, hero)?;
        let at = format!("{model}_c").to_lowercase();
        let at = match at.strip_suffix("_c_c") {
            Some(s) => format!("{s}_c"),
            None => at,
        };
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
    for en in beneath {
        let p = en.path().to_lowercase();
        if !entries.contains_key(&p) {
            entries.insert(p, en.clone());
        }
    }
    Ok(ItemFiles { entries: entries.into_values().collect(), left })
}
