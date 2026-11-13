//! An arcana as a mod, built from the game's own files (issue #118), replacing src/arcana.ts: the
//! arcana's models under the hero's own names, playing without the item what they played with it;
//! a particle the hero already creates, taken from the arcana's version, with the arcana's own
//! particles hung on it as children; its portraits and ability icons and its versions of other
//! items' particles under the plain ones' names; and its colour written in, since there is no gem.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashSet;

use crate::kv3::{self, Block, Node, Value};
use crate::recolor::{recolor_files, recolor_resource, recolor_set, Failed, Options, Rgb};
use crate::resource;
use crate::vpk::{self, Index};

fn name_of(n: &Node) -> &str {
    n.get("m_name").and_then(Node::as_str).unwrap_or("")
}

fn activities_mut(x: &mut Node) -> Option<&mut Vec<Node>> {
    match x.get_mut("m_activityArray").map(|a| &mut a.value) {
        Some(Value::Array { items, .. }) => Some(items),
        _ => None,
    }
}

fn activities(x: &Node) -> Option<&[Node]> {
    match x.get("m_activityArray").map(|a| &a.value) {
        Some(Value::Array { items, .. }) => Some(items),
        _ => None,
    }
}

/// In a list of sequences or animation clips, the ones that need `modifier` made the ones their
/// activities play: the modifier taken off them, and their activity off the plain ones beside them.
fn play_without(list: &mut [Node], modifier: &str) -> bool {
    let is_act = |a: &Node| name_of(a).starts_with("ACT_");
    let mut needed = HashSet::new();
    let mut taken: HashSet<String> = HashSet::new();
    for (i, x) in list.iter_mut().enumerate() {
        let Some(acts) = activities_mut(x) else { continue };
        if !acts.iter().any(|a| name_of(a) == modifier) {
            continue;
        }
        needed.insert(i);
        for a in acts.iter() {
            if is_act(a) {
                taken.insert(name_of(a).to_string());
            }
        }
        acts.retain(|a| name_of(a) != modifier);
    }
    for (i, x) in list.iter_mut().enumerate() {
        if needed.contains(&i) || activities(x).is_none_or(|acts| acts.iter().any(|a| !is_act(a))) {
            continue;
        }
        if let Some(acts) = activities_mut(x) {
            acts.retain(|a| !taken.contains(name_of(a)));
        }
    }
    !needed.is_empty()
}

/// A model put under another path that plays without the item what it played with it.
pub fn as_model(file: &[u8], modifier: Option<&str>) -> Result<Vec<u8>, String> {
    let Some(modifier) = modifier.filter(|m| !m.is_empty()) else { return Ok(file.to_vec()) };
    let mut out = file.to_vec();
    for (name, key) in [("ASEQ", "m_localS1SeqDescArray"), ("ANIM", "m_animArray")] {
        if !resource::blocks(&out).map_err(|e| e.to_string())?.iter().any(|b| b.name == name) {
            continue;
        }
        let mut kv = kv3::read(resource::data(&out, name, 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let changed = match kv.root.get_mut(key).map(|l| &mut l.value) {
            Some(Value::Array { items, .. }) => play_without(items, modifier),
            _ => false,
        };
        if changed {
            let next = kv3::write(&kv).map_err(|e| e.to_string())?;
            out = resource::replace(&out, name, 0, &next).map_err(|e| e.to_string())?;
        }
    }
    Ok(out)
}

/// A particle to hang on another, and the model attachment it is drawn at (none: its parent's first point).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Child {
    pub path: String,
    #[serde(default)]
    pub attachment: Option<String>,
}

/// A model to put under another name, and the activity modifier whose animations are to play without it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ModelFrom {
    pub from: String,
    #[serde(default)]
    pub modifier: Option<String>,
}

/// Images whose name with `mark` removed is the plain one.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Images {
    pub under: Vec<String>,
    pub mark: String,
    pub hero: String,
}

/// The particle the hero creates, the arcana's version of it, and the arcana's own to hang on it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Host {
    pub at: String,
    pub from: String,
    pub children: Vec<Child>,
    #[serde(default)]
    pub bind: Option<bool>,
}

/// A particle an item of the hero's form creates in the loadout only, hung on one the game creates in that form.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Form {
    pub item: String,
    pub at: String,
    pub child: String,
    pub attachment: String,
}

/// One arcana the app can build (src/arcana-sets.ts ARCANA_SETS).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ArcanaSet {
    pub recolor: String,
    pub models: IndexMap<String, ModelFrom>,
    pub images: Images,
    pub host: Host,
    #[serde(default)]
    pub swaps: Option<IndexMap<String, String>>,
    #[serde(default)]
    pub forms: Option<Vec<Form>>,
}

/// The arcana set of this name.
pub fn arcana_set(name: &str) -> Option<&'static ArcanaSet> {
    crate::data::arcana_sets().iter().find(|(k, _)| k == name).map(|(_, s)| s)
}

/// A whole number made, not read: an INT32 with its bytes.
fn int32(n: i32) -> Node {
    Node::new(Value::Number { ty: 11, cell: None, type_at: None, raw: Some(n.to_le_bytes().to_vec()) })
}

fn class_of(n: &Node) -> &str {
    n.get("_class").and_then(Node::as_str).unwrap_or("")
}

fn is_obj(n: &Node) -> bool {
    matches!(n.value, Value::Object(_))
}

fn is_array(n: &Node) -> bool {
    matches!(n.value, Value::Array { .. })
}

fn members(n: &Node) -> IndexMap<String, Node> {
    match &n.value {
        Value::Object(m) => m.clone(),
        _ => IndexMap::new(),
    }
}

fn items_mut(n: &mut Node) -> Option<&mut Vec<Node>> {
    match &mut n.value {
        Value::Array { items, .. } => Some(items),
        _ => None,
    }
}

fn with_str(n: &Node, value: &str) -> Node {
    Node { value: Value::Str(value.to_string()), flag: n.flag }
}

/// A driver like the host's that binds a control point to an attachment: one naming its point
/// first, else one with an attachment alone (it binds the first point).
fn like_driver(drivers: &[Node]) -> Option<&Node> {
    let binds = |d: &Node, keys: &[&str]| is_obj(d) && keys.iter().all(|k| d.get(k).is_some());
    drivers
        .iter()
        .find(|d| binds(d, &["m_attachmentName", "m_iControlPoint"]))
        .or_else(|| drivers.iter().find(|d| binds(d, &["m_attachmentName"])))
}

fn first_drivers(root: &Node) -> Option<&Node> {
    root.get("m_controlPointConfigurations")?.items().first()?.get("m_drivers").filter(|d| is_array(d))
}

fn first_drivers_mut(root: &mut Node) -> Option<&mut Vec<Node>> {
    let configs = items_mut(root.get_mut("m_controlPointConfigurations")?)?;
    items_mut(configs.first_mut()?.get_mut("m_drivers")?)
}

/// The first child of a host, when it names a file: what new children are copied from.
fn first_child(root: &Node) -> Option<Node> {
    let list = root.get("m_Children").filter(|l| is_array(l))?;
    list.items().first().filter(|f| is_obj(f) && f.get("m_ChildRef").and_then(Node::as_str).is_some()).cloned()
}

fn read_data(file: &[u8]) -> Result<Block, String> {
    kv3::read(resource::data_block(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn finish(file: &[u8], kv: &Block, children: &[&str]) -> Result<Vec<u8>, String> {
    let next = kv3::write(kv).map_err(|e| e.to_string())?;
    let replaced = resource::replace(file, "DATA", 0, &next).map_err(|e| e.to_string())?;
    resource::with_references(&replaced, children).map_err(|e| e.to_string())
}

/// A particle with more children: each new entry in `m_Children` is a copy of the first one there,
/// pointing at another file, and the file names them in RERL. A child with an attachment gets a
/// control point of its own: the parent hands point k to child k (C_OP_SetParentControlPointsToChildCP)
/// and binds its points to attachments in its first configuration, so both grow by one.
pub fn with_children(file: &[u8], children: &[Child]) -> Result<Vec<u8>, String> {
    let mut kv = read_data(file)?;
    let Some(first) = first_child(&kv.root) else { return Err("arcana: the host has no children to copy".into()) };
    let reference = first.get("m_ChildRef").cloned().unwrap();
    for child in children {
        if let Some(attachment) = child.attachment.as_deref().filter(|a| !a.is_empty()) {
            let k = kv.root.get("m_Children").map_or(0, |l| l.items().len());
            let pre: &[Node] = kv.root.get("m_PreEmissionOperators").map(Node::items).unwrap_or(&[]);
            let spread = pre.iter().position(|o| is_obj(o) && class_of(o) == "C_OP_SetParentControlPointsToChildCP");
            let count = spread
                .and_then(|i| pre[i].get("m_nNumControlPoints"))
                .filter(|c| matches!(c.value, Value::Number { .. }))
                .and_then(|c| kv.number_of(c));
            let drivers = first_drivers(&kv.root);
            if drivers.is_none() || count != Some(k as f64) || drivers.map_or(0, |d| d.items().len()) != k {
                return Err("arcana: the host does not hand its children control points one by one".into());
            }
            let like = like_driver(drivers.unwrap().items())
                .filter(|l| l.get("m_attachmentName").and_then(Node::as_str).is_some())
                .cloned();
            let Some(like) = like else {
                return Err("arcana: the host binds no control point to an attachment".into());
            };
            let mut driver = members(&like);
            driver.insert("m_iControlPoint".into(), int32(k as i32));
            driver.insert("m_attachmentName".into(), with_str(like.get("m_attachmentName").unwrap(), attachment));
            first_drivers_mut(&mut kv.root).unwrap().push(Node::new(Value::Object(driver)));
            let pre = items_mut(kv.root.get_mut("m_PreEmissionOperators").unwrap()).unwrap();
            if let Value::Object(m) = &mut pre[spread.unwrap()].value {
                m.insert("m_nNumControlPoints".into(), int32(k as i32 + 1));
            }
        }
        let mut copy = members(&first);
        copy.insert("m_ChildRef".into(), with_str(&reference, &child.path));
        items_mut(kv.root.get_mut("m_Children").unwrap()).unwrap().push(Node::new(Value::Object(copy)));
    }
    let paths: Vec<&str> = children.iter().map(|c| c.path.as_str()).collect();
    finish(file, &kv, &paths)
}

/// Whether a member names a control point: /^m_n\w*(CP|ControlPoint)\w*$/.
fn names_point(key: &str) -> bool {
    key.strip_prefix("m_n").is_some_and(|rest| {
        rest.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            && (rest.contains("CP") || rest.contains("ControlPoint"))
    })
}

/// Math.max as JavaScript has it: NaN wins.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// The highest control point the operators name, -1 for none. A point set with no number is 1.
fn used_points(kv: &Block, ops: &[&Node]) -> f64 {
    let mut top = -1f64;
    for o in ops {
        if class_of(o) == "C_OP_SetSingleControlPointPosition" && o.get("m_nCP1").is_none() {
            top = js_max(top, 1.0);
        }
        if let Value::Object(m) = &o.value {
            for (key, v) in m {
                if matches!(v.value, Value::Number { .. }) && names_point(key) {
                    top = js_max(top, kv.number_of(v).unwrap_or(f64::NAN));
                }
            }
        }
    }
    top
}

/// A particle with one more child, drawn at an attachment its parent did not bind: the host binds
/// a new control point to it in its first configuration, and hands that point to the child as its
/// first (C_OP_SetParentControlPointsToChildCP counts children from the first, so the new one goes
/// first and the others keep the points they had). For a host with_children cannot extend.
pub fn with_child_at(file: &[u8], child: &str, attachment: &str) -> Result<Vec<u8>, String> {
    let mut kv = read_data(file)?;
    let unbound = || "arcana: the host binds no control point to an attachment".to_string();
    let Some(first) = first_child(&kv.root) else { return Err(unbound()) };
    let Some(drivers) = first_drivers(&kv.root) else { return Err(unbound()) };
    let like = like_driver(drivers.items()).filter(|l| l.get("m_attachmentName").and_then(Node::as_str).is_some());
    let Some(like) = like.cloned() else { return Err(unbound()) };
    let driver_count = drivers.items().len();
    let has_pre = kv.root.get("m_PreEmissionOperators").is_some_and(is_array);
    let ops: Vec<&Node> =
        kv.root.get("m_PreEmissionOperators").map(Node::items).unwrap_or(&[]).iter().filter(|o| is_obj(o)).collect();
    if ops.iter().any(|o| class_of(o) == "C_OP_SetParentControlPointsToChildCP") {
        return Err("arcana: the host already hands its children points".into());
    }
    // a point nobody uses: the host's own operators may place points it never binds
    let point = js_max(driver_count as f64, used_points(&kv, &ops) + 1.0) as i32;
    let mut driver = members(&like);
    driver.insert("m_iControlPoint".into(), int32(point));
    driver.insert("m_attachmentName".into(), with_str(like.get("m_attachmentName").unwrap(), attachment));
    first_drivers_mut(&mut kv.root).unwrap().push(Node::new(Value::Object(driver)));
    let mut copy = members(&first);
    copy.insert("m_ChildRef".into(), with_str(first.get("m_ChildRef").unwrap(), child));
    let list = kv.root.get_mut("m_Children").unwrap();
    items_mut(list).unwrap().insert(0, Node::new(Value::Object(copy)));
    let mut shape = list.clone();
    let mut hand = IndexMap::new();
    hand.insert("_class".to_string(), Node::new(Value::Str("C_OP_SetParentControlPointsToChildCP".into())));
    hand.insert("m_nNumControlPoints".to_string(), int32(1));
    hand.insert("m_nFirstSourcePoint".to_string(), int32(point));
    let hand = Node::new(Value::Object(hand));
    if has_pre {
        items_mut(kv.root.get_mut("m_PreEmissionOperators").unwrap()).unwrap().push(hand);
    } else {
        *items_mut(&mut shape).unwrap() = vec![hand];
        if let Value::Object(m) = &mut kv.root.value {
            m.insert("m_PreEmissionOperators".into(), shape);
        }
    }
    finish(file, &kv, &[child])
}

fn baked(def: &ArcanaSet) -> Result<Options, String> {
    let gem = recolor_set(&def.recolor).ok_or_else(|| format!("recolor: no set {}", def.recolor))?.gem;
    Ok(Options { gem: Some(gem), bake: true, ..Default::default() })
}

fn read(index: &Index, p: &str) -> Result<Option<Vec<u8>>, String> {
    index.read(p).map_err(|e| e.to_string())
}

/// The forms' particles for the items among `items` (the builder's picks): each host from `files`
/// (a base's, in colour) or the game, with the item's particle hung on it, and that particle in the
/// chosen colour under its own path. A host that cannot take it stays as it was.
pub fn arcana_forms(
    index: &Index,
    set: &str,
    target: Rgb,
    items: &[String],
    files: &mut IndexMap<String, Vec<u8>>,
    log: &mut dyn FnMut(String),
) -> Result<(), String> {
    let Some(def) = arcana_set(set) else { return Ok(()) };
    for f in def.forms.iter().flatten() {
        if !items.contains(&f.item) {
            continue;
        }
        let host = match files.get(&f.at) {
            Some(h) => Some(h.clone()),
            None => read(index, &f.at)?,
        };
        let child = read(index, &format!("{}_c", f.child))?;
        let (Some(host), Some(child)) = (host, child) else { continue };
        let hung = with_child_at(&host, &f.child, &f.attachment)
            .and_then(|h| Ok((h, recolor_resource(&child, target, &baked(def)?)?.0)));
        match hung {
            Ok((h, c)) => {
                files.insert(f.at.clone(), h);
                files.insert(format!("{}_c", f.child), c);
            }
            Err(err) => log(format!("arcana: {} not hung on {}: {err}", f.child, f.at)),
        }
    }
    Ok(())
}

/// The arcana's portraits and ability icons out of pak01, under the plain ones' names.
pub fn arcana_pictures(index: &Index, set: &str) -> Result<IndexMap<String, Vec<u8>>, String> {
    let def = arcana_set(set).ok_or_else(|| format!("arcana: no set {set}"))?;
    let have: HashSet<&str> = index.paths().collect();
    let mut files = IndexMap::new();
    let Images { under, mark, hero } = &def.images;
    for p in index.paths() {
        if !under.iter().any(|u| p.starts_with(u.as_str())) || !p.contains(hero.as_str()) || !p.contains(mark.as_str())
        {
            continue;
        }
        let plain = p.replacen(mark.as_str(), "", 1);
        if have.contains(plain.as_str()) {
            files.insert(plain, read(index, p)?.unwrap_or_default());
        }
    }
    Ok(files)
}

/// The arcana's versions of other items' particles, under those items' paths and in the chosen
/// colour: nothing in the game swaps them without the item.
pub fn arcana_swaps(index: &Index, set: &str, target: Rgb) -> Result<IndexMap<String, Vec<u8>>, String> {
    let mut files = IndexMap::new();
    let Some(def) = arcana_set(set) else { return Ok(files) };
    for (at, from) in def.swaps.iter().flatten() {
        if let Some(data) = read(index, from)? {
            files.insert(at.clone(), recolor_resource(&data, target, &baked(def)?)?.0);
        }
    }
    Ok(files)
}

/// What build_arcana made: the VPK, how many files went in, how many colours changed, and the
/// files that failed to recolour.
pub struct Built {
    pub vpk: Vec<u8>,
    pub files: usize,
    pub changed: usize,
    pub failed: Vec<Failed>,
}

/// The arcana in the chosen colour, as one VPK from the game's pak01 (but the paths `skip` names, lowercased).
pub fn build_arcana(
    index: &Index,
    set: &str,
    target: Rgb,
    skip: &dyn Fn(&str) -> bool,
    forms: &[String],
) -> Result<Built, String> {
    let def = arcana_set(set).ok_or_else(|| format!("arcana: no set {set}"))?;
    let r = recolor_files(index, &def.recolor, target, true)?;
    let mut files = r.files;
    for (to, m) in &def.models {
        let model = read(index, &m.from)?.ok_or_else(|| format!("arcana: no {}", m.from))?;
        files.insert(to.clone(), as_model(&model, m.modifier.as_deref())?);
    }
    files.extend(arcana_pictures(index, set)?);
    files.extend(arcana_swaps(index, set, target)?);
    let from = read(index, &def.host.from)?.ok_or_else(|| format!("arcana: no {}", def.host.from))?;
    let host = if def.host.bind == Some(true) {
        def.host
            .children
            .iter()
            .try_fold(from, |f, c| with_child_at(&f, &c.path, c.attachment.as_deref().unwrap_or("")))?
    } else {
        with_children(&from, &def.host.children)?
    };
    files.insert(def.host.at.clone(), recolor_resource(&host, target, &baked(def)?)?.0);
    arcana_forms(index, set, target, forms, &mut files, &mut |_| {})?;
    files.retain(|p, _| !skip(&p.to_lowercase()));
    let entries: Vec<vpk::Entry> = files.iter().map(|(p, f)| vpk::entry_at(p, f.clone().into())).collect();
    Ok(Built { vpk: vpk::build(&entries), files: files.len(), changed: r.changed, failed: r.failed })
}
