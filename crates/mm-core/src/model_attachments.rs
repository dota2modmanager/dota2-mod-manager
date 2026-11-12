//! A model put under a plain hero's path with its attachments in the plain model's order,
//! replacing src/model-attachments.ts. Online the server names an attachment by its number in the
//! plain model's list, so each plain number gets the model's own attachment of that name, a
//! stand-in (attach_hitloc, or the first) under the plain name where it has none, and the model's
//! others after them.

use std::collections::HashMap;

use crate::kv3::{self, Node, Value};
use crate::resource;

fn name_of(a: &Node) -> String {
    a.get("key").and_then(Node::as_str).unwrap_or("").to_string()
}

/// The names of a model's attachments, in order; empty when it has none or cannot be read.
pub fn attachment_names(model: &[u8]) -> Vec<String> {
    let read = || -> Option<Vec<String>> {
        if !resource::blocks(model).ok()?.iter().any(|b| b.name == "MDAT") {
            return Some(vec![]);
        }
        let kv = kv3::read(resource::data(model, "MDAT", 0).ok()?).ok()?;
        Some(match kv.root.get("m_attachments") {
            Some(Node { value: Value::Array { items, .. }, .. }) => items.iter().map(name_of).collect(),
            _ => vec![],
        })
    };
    read().unwrap_or_default()
}

/// An attachment under another name: the same place on the body.
fn renamed(a: &Node, name: &str) -> Node {
    let Value::Object(members) = &a.value else { return a.clone() };
    let mut members = members.clone();
    members.insert("key".into(), Node::new(Value::Str(name.into())));
    if let Some(Node { value: Value::Object(inner), flag }) = members.get("value").cloned() {
        let mut inner = inner;
        inner.insert("m_name".into(), Node::new(Value::Str(name.into())));
        members.insert("value".into(), Node { value: Value::Object(inner), flag });
    }
    Node { value: Value::Object(members), flag: a.flag }
}

/// `model` with its attachments numbered as `plain` numbers them; the model as it is when they
/// are in that order already, or when either cannot be read.
pub fn attached_as(model: &[u8], plain: &[u8]) -> Vec<u8> {
    let wanted = attachment_names(plain);
    if wanted.is_empty() {
        return model.to_vec();
    }
    let run = || -> Option<Vec<u8>> {
        let mut out = model.to_vec();
        let blocks = resource::blocks(model).ok()?.iter().filter(|b| b.name == "MDAT").count();
        for nth in 0..blocks {
            let mut kv = kv3::read(resource::data(&out, "MDAT", nth).ok()?).ok()?;
            let Some(Node { value: Value::Array { items, .. }, .. }) = kv.root.get_mut("m_attachments") else {
                continue;
            };
            if items.is_empty() {
                continue;
            }
            let names: Vec<String> = items.iter().map(name_of).collect();
            if wanted.iter().enumerate().all(|(i, n)| names.get(i) == Some(n)) {
                continue;
            }
            let own: HashMap<String, &Node> = items.iter().map(|a| (name_of(a), a)).collect();
            let stand_in = own.get("attach_hitloc").copied().unwrap_or(&items[0]);
            let mut next: Vec<Node> = wanted
                .iter()
                .map(|n| own.get(n).map(|a| (*a).clone()).unwrap_or_else(|| renamed(stand_in, n)))
                .collect();
            next.extend(items.iter().filter(|a| !wanted.contains(&name_of(a))).cloned());
            *items = next;
            out = resource::replace(&out, "MDAT", nth, &kv3::write(&kv).ok()?).ok()?;
        }
        Some(out)
    };
    run().unwrap_or_else(|| model.to_vec())
}
