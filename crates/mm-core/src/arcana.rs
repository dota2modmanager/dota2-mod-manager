//! Arcanas: a hero model put under the plain hero's path that plays without the item what it
//! played with it. Replacing the model half of src/arcana.ts (asModel); the rest of it follows.

use std::collections::HashSet;

use crate::kv3::{self, Node, Value};
use crate::resource;

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
