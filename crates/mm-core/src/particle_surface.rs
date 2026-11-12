//! An effect made to spread over a wearable's surface, replacing src/particle-surface.ts.
//!
//! The game's unusual effects start with C_INIT_CreateOnModel reading the model's mesh, which it
//! keeps only for the hero's own body: on a wearable the same system piles up at the model's
//! origin. So each system of the tree is copied under SURFACE, its emitters reading the boxes
//! model_hitboxes.rs lays in SURFACE_SET, and a mesh-skinning operator swapped for one that holds a
//! particle to the box it started in, since the item moves with the hero's bones.

use std::collections::HashSet;

use crate::kv3::{self, Node, Value};
use crate::model_hitboxes::SURFACE_SET;
use crate::resource;

const SURFACE: &str = "particles/mm_surface/";
const SHELL: f64 = 4.0; // how far off a box a particle starts: inside the item it would not be seen

fn no() -> Node {
    Node::new(Value::Other { ty: 14, value: None })
}

fn yes() -> Node {
    Node::new(Value::Other { ty: 13, value: None })
}

fn word(v: &str) -> Node {
    Node::new(Value::Str(v.to_string()))
}

fn double(v: f64) -> Node {
    Node::new(Value::Number { ty: 5, cell: None, type_at: None, raw: Some(v.to_le_bytes().to_vec()) })
}

fn int(v: i32) -> Node {
    Node::new(Value::Number { ty: 11, cell: None, type_at: None, raw: Some(v.to_le_bytes().to_vec()) })
}

fn object(members: Vec<(&str, Node)>) -> Node {
    Node::new(Value::Object(members.into_iter().map(|(k, v)| (k.to_string(), v)).collect()))
}

/// What holds a particle to its box as the item moves.
fn lock_to_box() -> Node {
    object(vec![
        ("_class", word("C_OP_LockToBone")),
        ("m_HitboxSetName", word(SURFACE_SET)),
        ("m_bUseBones", no()),
        ("m_bRigid", yes()),
        ("m_flLifeTimeFadeStart", double(1.0)),
        ("m_flLifeTimeFadeEnd", double(1.0)),
        ("m_flJumpThreshold", double(100000.0)),
        ("m_flPrevPosScale", double(1.0)),
        ("m_nFieldOutput", int(0)),
        ("m_nFieldOutputPrev", int(2)),
    ])
}

fn class_of(n: &Node) -> &str {
    n.get("_class").and_then(Node::as_str).unwrap_or("")
}

/// The path of a system's copy.
fn copy_of(system: &str) -> String {
    let lower = system.to_lowercase();
    let rest = lower.strip_prefix("particles/").unwrap_or(&lower);
    let rest = rest.strip_suffix("_c").unwrap_or(rest);
    format!("{SURFACE}{rest}")
}

/// Its emitters turned to the boxes; whether any was on the model.
fn to_surface(root: &mut Node) -> bool {
    let mut any = false;
    if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_Initializers") {
        for op in items.iter_mut() {
            if class_of(op) != "C_INIT_CreateOnModel" {
                continue;
            }
            let Value::Object(m) = &mut op.value else { continue };
            m.insert("m_bUseMesh".into(), no());
            m.insert("m_bUseBones".into(), no());
            m.insert("m_HitboxSetName".into(), word(SURFACE_SET));
            m.insert(
                "m_flShellSize".into(),
                object(vec![("m_nType", word("PF_TYPE_LITERAL")), ("m_flLiteralValue", double(SHELL))]),
            );
            any = true;
        }
    }
    // last, so that it holds what the operators before it moved
    if any {
        if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_Operators") {
            items.retain(|op| class_of(op) != "C_OP_SnapshotSkinToBones");
            items.push(lock_to_box());
        }
    }
    any
}

/// A surface copy's root path, and its files as (path, bytes).
pub type Surface = (String, Vec<(String, Vec<u8>)>);

/// The copies of `system` and its children that spread over a surface, or None where no system of
/// the tree starts on the model (it hangs on attachment points, and goes on as it is): the root's
/// path, and the files to put in the pak as (path, bytes).
pub fn surface_system(read: &mut dyn FnMut(&str) -> Option<Vec<u8>>, system: &str) -> Result<Option<Surface>, String> {
    struct Walk<'a> {
        read: &'a mut dyn FnMut(&str) -> Option<Vec<u8>>,
        seen: HashSet<String>,
        entries: Vec<(String, Vec<u8>)>,
        any: bool,
    }
    fn copy(w: &mut Walk, path: &str) -> Result<(), String> {
        let lower = path.to_lowercase();
        let from = lower.strip_suffix("_c").unwrap_or(&lower).to_string();
        if w.seen.contains(&from) || w.seen.len() > 60 {
            return Ok(());
        }
        w.seen.insert(from.clone());
        let Some(bytes) = (w.read)(&format!("{from}_c")) else { return Ok(()) };
        let mut kv =
            kv3::read(resource::data(&bytes, "DATA", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let mut root = std::mem::replace(&mut kv.root, Node::new(Value::Other { ty: 1, value: None }));
        if to_surface(&mut root) {
            w.any = true;
        }
        let mut children: Vec<String> = Vec::new();
        if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_Children") {
            for c in items.iter_mut() {
                let Some(r) = c.get("m_ChildRef").and_then(Node::as_str).filter(|r| !r.is_empty()).map(str::to_string)
                else {
                    continue;
                };
                let Value::Object(m) = &mut c.value else { continue };
                copy(w, &r)?;
                let to = copy_of(&r);
                children.push(to.clone());
                if let Some(Node { value: Value::Str(s), .. }) = m.get_mut("m_ChildRef") {
                    *s = to;
                }
            }
        }
        kv.root = root;
        let out = resource::replace(&bytes, "DATA", 0, &kv3::write(&kv).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let out = if children.is_empty() {
            out
        } else {
            let refs: Vec<&str> = children.iter().map(String::as_str).collect();
            resource::with_references(&out, &refs).map_err(|e| e.to_string())?
        };
        w.entries.push((format!("{}_c", copy_of(&from)), out));
        Ok(())
    }
    let mut w = Walk { read, seen: HashSet::new(), entries: Vec::new(), any: false };
    copy(&mut w, system)?;
    Ok(w.any.then(|| (copy_of(system), w.entries)))
}
