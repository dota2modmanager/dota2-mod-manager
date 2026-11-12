//! A model put under another model's path that numbers its sequences as that one does,
//! replacing src/model-sequences.ts.
//!
//! Online the server picks a unit's animation in its own copy of the plain model and sends the
//! client a number: the place of the sequence in the model's name list (ASEQ
//! m_localSequenceNameArray). So the plain model's names come first, in the plain order, each
//! matched to the item's sequence of the same name (any case, with or without underscores) or of
//! the same activity; the rest follow in their own order, and every reference into the list moves
//! with its entry. A plain name with nothing left to stand for it gets a copy of the item's own
//! sequence for that activity under the plain name; a part with no activity holds its place with
//! the item's bind pose. A model with no run or no idle of its own still gets none.

use std::collections::{HashMap, HashSet};

use crate::kv3::{self, Block, Node, Value};
use crate::resource;

fn text(n: Option<&Node>) -> String {
    n.and_then(Node::as_str).unwrap_or("").to_string()
}

fn items(n: Option<&Node>) -> &[Node] {
    n.map(Node::items).unwrap_or(&[])
}

#[derive(Debug, Clone)]
struct Described {
    name: String,
    act: Option<String>,
    /// its place in m_localS1SeqDescArray
    at: usize,
}

/// Each sequence's name and the activity it plays (the first ACT_ of its list), or None.
fn described(root: &Node) -> Vec<Described> {
    items(root.get("m_localS1SeqDescArray"))
        .iter()
        .enumerate()
        .map(|(at, d)| Described {
            name: text(d.get("m_sName")),
            act: items(d.get("m_activityArray")).iter().map(|a| text(a.get("m_name"))).find(|n| n.starts_with("ACT_")),
            at,
        })
        .collect()
}

/// A number in a sequence that points into the name list: an entry of what it fetches, or the
/// reference of one of the layers it plays.
#[derive(Debug, Clone, Copy)]
enum Ptr {
    Fetch(usize),
    Layer(usize),
}

fn pointers(desc: &Node) -> Vec<Ptr> {
    let mut out = Vec::new();
    if let Some(refs) = desc.get("m_fetch").and_then(|f| f.get("m_localReferenceArray")) {
        if let Value::Array { items, .. } = &refs.value {
            out.extend(
                items
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| matches!(r.value, Value::Number { .. }))
                    .map(|(i, _)| Ptr::Fetch(i)),
            );
        }
    }
    for (j, layer) in items(desc.get("m_autoLayerArray")).iter().enumerate() {
        if matches!(layer.value, Value::Object(_))
            && matches!(layer.get("m_nLocalReference").map(|r| &r.value), Some(Value::Number { .. }))
        {
            out.push(Ptr::Layer(j));
        }
    }
    out
}

fn at_ptr(desc: &mut Node, p: Ptr) -> Option<&mut Node> {
    match p {
        Ptr::Fetch(i) => match &mut desc.get_mut("m_fetch")?.get_mut("m_localReferenceArray")?.value {
            Value::Array { items, .. } => items.get_mut(i),
            _ => None,
        },
        Ptr::Layer(j) => match &mut desc.get_mut("m_autoLayerArray")?.value {
            Value::Array { items, .. } => items.get_mut(j)?.get_mut("m_nLocalReference"),
            _ => None,
        },
    }
}

/// Put a new number at a pointer. A fetch list that takes one becomes untyped: a typed array writes
/// its items in its element's storage, and a 0 or 1 stored as a type has none.
fn set_ptr(desc: &mut Node, p: Ptr, n: Node) -> Option<()> {
    if let Ptr::Fetch(_) = p {
        if let Value::Array { element, .. } = &mut desc.get_mut("m_fetch")?.get_mut("m_localReferenceArray")?.value {
            *element = None;
        }
    }
    *at_ptr(desc, p)? = n;
    Some(())
}

/// A number written anew as an int32, for one stored as its type alone.
fn made_int(v: i64) -> Option<Node> {
    let v = i32::try_from(v).ok()?;
    Some(Node::new(Value::Number { ty: 11, cell: None, type_at: None, raw: Some(v.to_le_bytes().to_vec()) }))
}

/// `v` as a number of the same type and width as `like`, which a typed array's lane needs.
fn made_like(like: &Node, v: i64) -> Option<Node> {
    let Value::Number { ty, cell, raw, .. } = &like.value else { return made_int(v) };
    let width = cell.map(|c| c.width as usize).or(raw.as_ref().map(Vec::len)).unwrap_or(0);
    if width == 0 {
        return made_int(v);
    }
    let bytes = match width {
        8 => v.to_le_bytes().to_vec(),
        w if w <= 6 => {
            // writeIntLE: a signed value that must fit in w bytes
            let bits = (w * 8) as u32;
            let (lo, hi) = (-(1i64 << (bits - 1)), (1i64 << (bits - 1)) - 1);
            if v < lo || v > hi {
                return None;
            }
            v.to_le_bytes()[..w].to_vec()
        }
        _ => return None,
    };
    Some(Node::new(Value::Number { ty: *ty, cell: None, type_at: None, raw: Some(bytes) }))
}

/// The "<word>_" every one of these names starts with ("donkey_", "donkey_wings_"), or "".
fn name_prefix(names: &[String]) -> String {
    if names.is_empty() {
        return String::new();
    }
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut prefix = lower[0][..lower[0].rfind('_').map_or(0, |i| i + 1)].to_string();
    while !prefix.is_empty() && !lower.iter().all(|n| n.starts_with(&prefix)) {
        let search = &prefix[..prefix.len().saturating_sub(1)];
        let next = search.rfind('_').map_or(0, |i| i + 1);
        if next >= prefix.len() {
            return String::new();
        }
        prefix.truncate(next);
    }
    prefix
}

/// A sequence that plays no activity, found by its name without the plain model's own prefix.
fn same_rest(names: &[String], used: &HashSet<usize>, name: &str, prefix: &str) -> Option<usize> {
    let at = if name.starts_with('@') { "@" } else { "" };
    let rest = name[at.len()..].to_lowercase();
    if prefix.is_empty() || !rest.starts_with(prefix) || rest == prefix {
        return None;
    }
    let tail = &rest[prefix.len()..];
    let free: Vec<(String, usize)> = names
        .iter()
        .enumerate()
        .map(|(i, n)| (n.to_lowercase(), i))
        .filter(|(n, i)| !used.contains(i) && n.starts_with('@') == !at.is_empty())
        .collect();
    let whole = free.iter().find(|(n, _)| n.get(at.len()..) == Some(tail));
    let end = format!("_{tail}");
    whole.or_else(|| free.iter().find(|(n, _)| n.ends_with(&end))).map(|(_, i)| *i)
}

/// Any sequence left over, for a plain one that plays no activity and has no namesake.
fn spare(names: &[String], used: &HashSet<usize>, name: &str) -> Option<usize> {
    let free: Vec<(usize, &String)> = names.iter().enumerate().filter(|(i, _)| !used.contains(i)).collect();
    free.iter().find(|(_, n)| n.starts_with('@') == name.starts_with('@')).or(free.first()).map(|(i, _)| *i)
}

fn is_bind_pose(name: &str) -> bool {
    let l = name.to_lowercase();
    l == "bindpose" || l == "bind_pose"
}

/// The item's sequence to copy for a plain one that has nothing left.
fn stand_in<'a>(seqs: &'a [Described], act: Option<&str>) -> Option<&'a Described> {
    let Some(act) = act.filter(|a| !a.is_empty()) else {
        return seqs.iter().find(|s| s.act.is_none() && is_bind_pose(&s.name));
    };
    let by = |a: &str| {
        seqs.iter()
            .find(|s| s.act.as_deref() == Some(a) && !s.name.starts_with('@'))
            .or_else(|| seqs.iter().find(|s| s.act.as_deref() == Some(a)))
    };
    let common = act.strip_suffix("_RARE").unwrap_or(act);
    by(act).or_else(|| by(common)).or_else(|| {
        if common == "ACT_DOTA_RUN" || common == "ACT_DOTA_IDLE" {
            None
        } else {
            by("ACT_DOTA_IDLE")
        }
    })
}

fn place_of(map: &HashMap<usize, usize>, old: f64) -> Option<usize> {
    (old >= 0.0 && old.fract() == 0.0).then(|| map.get(&(old as usize)).copied()).flatten()
}

fn at_ref(desc: &Node, p: Ptr) -> Option<&Node> {
    match p {
        Ptr::Fetch(i) => desc.get("m_fetch")?.get("m_localReferenceArray")?.items().get(i),
        Ptr::Layer(j) => desc.get("m_autoLayerArray")?.items().get(j)?.get("m_nLocalReference"),
    }
}

fn desc_list(root: &mut Node) -> Option<&mut Vec<Node>> {
    match &mut root.get_mut("m_localS1SeqDescArray")?.value {
        Value::Array { items, .. } => Some(items),
        _ => None,
    }
}

/// A stand-in with its tree and the old numbers of its references.
type Copy = (StandIn, Node, Vec<(Ptr, f64)>);

struct StandIn {
    place: usize,
    name: String,
    act: Option<String>,
    from: Described,
}

/// `model` with its sequences numbered as `plain` numbers its own, or None where that cannot be
/// done: a plain run or idle with nothing to play it, a list either has not got, or sequences of
/// kinds whose references this does not move (multi, synth, command).
pub fn numbered_as(model: &[u8], plain: &[u8]) -> Option<Vec<u8>> {
    for f in [model, plain] {
        if !resource::blocks(f).ok()?.iter().any(|b| b.name == "ASEQ") {
            return None;
        }
    }
    let theirs = kv3::read(resource::data(plain, "ASEQ", 0).ok()?).ok()?;
    let mut kv: Block = kv3::read(resource::data(model, "ASEQ", 0).ok()?).ok()?;
    let is_list = |n: Option<&Node>| matches!(n.map(|n| &n.value), Some(Value::Array { .. }));
    if !is_list(kv.root.get("m_localSequenceNameArray")) || !is_list(theirs.root.get("m_localSequenceNameArray")) {
        return None;
    }
    for key in ["m_localMultiSeqDescArray", "m_localSynthAnimDescArray", "m_localCmdSeqDescArray"] {
        if !items(kv.root.get(key)).is_empty() {
            return None;
        }
    }
    let names: Vec<String> = items(kv.root.get("m_localSequenceNameArray")).iter().map(|n| text(Some(n))).collect();
    let wanted: Vec<String> =
        items(theirs.root.get("m_localSequenceNameArray")).iter().map(|n| text(Some(n))).collect();
    if names == wanted {
        return Some(model.to_vec());
    }

    // a name described twice plays what its last description does, in the place of its first
    let mut plain_acts: HashMap<String, Option<String>> = HashMap::new();
    let mut plain_order: Vec<String> = Vec::new();
    for s in described(&theirs.root) {
        if !plain_acts.contains_key(&s.name) {
            plain_order.push(s.name.clone());
        }
        plain_acts.insert(s.name, s.act);
    }
    let act_of = |name: &str| plain_acts.get(name).cloned().flatten();
    let seqs = described(&kv.root);
    let mut used: HashSet<usize> = HashSet::new();
    let mut stand_ins: Vec<StandIn> = Vec::new();
    let mut order: Vec<Option<usize>> = Vec::new();
    // "bindPose" is "bind_pose" in half of Invoker's spirits, and it plays no activity to find it by
    let loose = |n: &str| -> String {
        n.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '@').collect()
    };
    let index_of = |n: &str| names.iter().position(|x| x == n);
    let acted: Vec<String> = plain_order.iter().filter(|n| act_of(n).is_some()).cloned().collect();
    let prefix = name_prefix(&acted);
    for name in &wanted {
        let act = act_of(name);
        let mut at = index_of(name).filter(|i| !used.contains(i));
        if at.is_none() {
            let ln = loose(name);
            at = names.iter().enumerate().position(|(i, n)| !used.contains(&i) && loose(n) == ln);
        }
        if at.is_none() {
            // a sequence of its own name before one played through another ("@forge_spirit_runx")
            let same: Vec<&Described> = match &act {
                Some(a) => seqs
                    .iter()
                    .filter(|s| s.act.as_ref() == Some(a) && index_of(&s.name).is_none_or(|i| !used.contains(&i)))
                    .collect(),
                None => vec![],
            };
            let pick = same.iter().find(|s| !s.name.starts_with('@')).or(same.first());
            at = pick.and_then(|p| index_of(&p.name));
        }
        if at.is_none() {
            at = same_rest(&names, &used, name, &prefix);
        }
        if at.is_none() && act.is_none() {
            at = spare(&names, &used, name);
        }
        match at {
            Some(i) => {
                used.insert(i);
                order.push(Some(i));
            }
            None => {
                let from = stand_in(&seqs, act.as_deref())?.clone();
                let written = if names.contains(name) { format!("{name}_d2mm") } else { name.clone() };
                stand_ins.push(StandIn { place: order.len(), name: written, act, from });
                order.push(None);
            }
        }
    }
    for i in 0..names.len() {
        if !used.contains(&i) {
            order.push(Some(i));
        }
    }
    let place_map: HashMap<usize, usize> =
        order.iter().enumerate().filter_map(|(place, old)| old.map(|o| (o, place))).collect();

    let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Other { ty: 1, value: None }));
    // the copies' references, read before any original is renumbered: they share its cells
    let mut copies: Vec<Copy> = Vec::new();
    for s in stand_ins {
        let desc = items(root.get("m_localS1SeqDescArray")).get(s.from.at)?.clone();
        let refs: Vec<(Ptr, f64)> = pointers(&desc)
            .into_iter()
            .map(|p| (p, at_ref(&desc, p).and_then(|n| kv.number_of(n)).unwrap_or(f64::NAN)))
            .collect();
        copies.push((s, desc, refs));
    }
    if let Some(descs) = desc_list(&mut root) {
        for s in &seqs {
            let desc = descs.get_mut(s.at)?;
            for p in pointers(desc) {
                let node = at_ptr(desc, p)?;
                let old = kv.number_of(node)?;
                if old < 0.0 {
                    continue;
                }
                let place = place_of(&place_map, old)?;
                if place as f64 != old && !kv.set_number(node, place as f64).ok()? {
                    set_ptr(desc, p, made_int(place as i64)?)?;
                }
            }
        }
    }
    if !copies.is_empty() && desc_list(&mut root).is_none() {
        return None;
    }
    let mut copy_names: HashMap<usize, String> = HashMap::new();
    for (s, mut desc, refs) in copies {
        for (p, old) in refs {
            let place = place_of(&place_map, old)?;
            let like = at_ref(&desc, p)?.clone();
            set_ptr(&mut desc, p, made_like(&like, place as i64)?)?;
        }
        let Value::Object(members) = &mut desc.value else { return None };
        members.insert("m_sName".into(), Node::new(Value::Str(s.name.clone())));
        // played for the plain activity: a courier's idle standing in for the donkey's rare one is
        // its rare one now, as the donkey's was
        if let Some(act) = s.act.as_ref().filter(|a| Some(*a) != s.from.act.as_ref()) {
            if let Some(Node { value: Value::Array { items: acts, .. }, .. }) = members.get_mut("m_activityArray") {
                for a in acts.iter_mut() {
                    if !text(a.get("m_name")).starts_with("ACT_") {
                        continue;
                    }
                    if let Value::Object(m) = &mut a.value {
                        m.insert("m_name".into(), Node::new(Value::Str(act.clone())));
                        break;
                    }
                }
            }
        }
        desc_list(&mut root)?.push(desc);
        copy_names.insert(s.place, s.name);
    }
    if let Some(Node { value: Value::Array { items: list, .. }, .. }) = root.get_mut("m_localSequenceNameArray") {
        let old = std::mem::take(list);
        *list = order
            .iter()
            .enumerate()
            .map(|(place, i)| match i {
                Some(i) => old[*i].clone(),
                None => Node::new(Value::Str(copy_names.get(&place).cloned().unwrap_or_default())),
            })
            .collect();
    }
    kv.root = root;
    resource::replace(model, "ASEQ", 0, &kv3::write(&kv).ok()?).ok()
}
