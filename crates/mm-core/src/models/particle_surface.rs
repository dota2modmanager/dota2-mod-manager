//! An effect made to spread over a wearable's surface, replacing src/particle-surface.ts.
//!
//! The game's unusual effects start with C_INIT_CreateOnModel reading the model's mesh, which it
//! keeps only for the hero's own body: on a wearable the same system piles up at the model's
//! origin. So each system of the tree is copied under a folder of its own (`Scope`), its emitters
//! reading the boxes model_hitboxes.rs lays in the scope's set, and the operators that skin or pin
//! a particle swapped for one that holds it to the box it started in, since the item moves with the
//! hero's bones. Every pick has a scope of its own (item_files.rs), so that its effect spreads over
//! that item and not over another one sewn into the same body.
//! Crownfall's feathers (Ravenblight) are models with a motion of their own and a glow that follows
//! the particle's normal: pinned to a box they would not fly off, so they keep their operators and
//! their normal is turned to the control point.

use std::collections::HashSet;

use crate::kv3::{self, Node, Value};
use crate::resource;

/// The folder of a pick's own copies, and the start of its hitbox set's name (item_scope).
const PICK_FOLDER: &str = "particles/mm_fx/";
const PICK_SET: &str = "mm_fx_";
/// The model Crownfall's feathers are drawn with.
const FEATHER: &str = "models/particle/crownfall_feather.vmdl";
/// What skins a particle to the mesh or pins it to a bone: the box lock takes their place.
const PINNING: [&str; 4] =
    ["C_OP_SnapshotSkinToBones", "C_OP_SnapshotRigidSkinToBones", "C_OP_MovementRigidAttachToCP", "C_OP_LockToBone"];
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

/// Where a system's surface copies go and the hitbox set they read.
#[derive(Debug, Clone, PartialEq)]
pub struct Scope {
    pub set: String,
    pub folder: String,
}

/// A pick's own scope, by a token that tells it from the others (letters and digits).
pub fn item_scope(token: &str) -> Scope {
    Scope { set: format!("{PICK_SET}{token}"), folder: format!("{PICK_FOLDER}{token}/") }
}

/// What holds a particle to its box as the item moves.
fn lock_to_box(set: &str) -> Node {
    object(vec![
        ("_class", word("C_OP_LockToBone")),
        ("m_HitboxSetName", word(set)),
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
fn copy_of(system: &str, folder: &str) -> String {
    let lower = system.to_lowercase();
    let rest = lower.strip_prefix("particles/").unwrap_or(&lower);
    let rest = rest.strip_suffix("_c").unwrap_or(rest);
    format!("{folder}{rest}")
}

/// Whether an emitter reads another model than the one the effect is on: its model comes from
/// elsewhere than control point 0. Boxes of this item are not that model's, so it stays as it is.
fn samples_elsewhere(number: &dyn Fn(&Node) -> Option<f64>, op: &Node) -> bool {
    let Some(input) = op.get("m_modelInput") else { return false };
    let ty = input.get("m_nType").and_then(Node::as_str);
    let point = input.get("m_nControlPoint").and_then(number);
    ty.is_some_and(|t| t != "PM_TYPE_CONTROL_POINT") || point.is_some_and(|p| p != 0.0)
}

/// Whether a system draws Crownfall's feathers.
fn draws_feathers(root: &Node) -> bool {
    let feather = |m: &Node| {
        m.get("m_model").and_then(Node::as_str).is_some_and(|p| {
            let p = p.to_lowercase().replace('\\', "/");
            p.strip_suffix("_c").unwrap_or(&p) == FEATHER
        })
    };
    let list = |n: Option<&Node>| n.map(Node::items).unwrap_or(&[]).to_vec();
    list(root.get("m_Renderers")).iter().any(|r| list(r.get("m_ModelList")).iter().any(feather))
}

/// Its emitters turned to the boxes of `set`; whether any was on the model.
fn to_surface(number: &dyn Fn(&Node) -> Option<f64>, root: &mut Node, set: &str) -> bool {
    let mut any = false;
    let feathers = draws_feathers(root);
    if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_Initializers") {
        for op in items.iter_mut() {
            if class_of(op) != "C_INIT_CreateOnModel" || samples_elsewhere(number, op) {
                continue;
            }
            let Value::Object(m) = &mut op.value else { continue };
            m.insert("m_bUseMesh".into(), no());
            m.insert("m_bUseBones".into(), no());
            m.insert("m_HitboxSetName".into(), word(set));
            m.insert(
                "m_flShellSize".into(),
                object(vec![("m_nType", word("PF_TYPE_LITERAL")), ("m_flLiteralValue", double(SHELL))]),
            );
            any = true;
        }
        // a feather flies off by itself: turned to the control point, its glow faces the right way
        if any && feathers && !items.iter().any(|op| class_of(op) == "C_INIT_NormalAlignToCP") {
            items.push(object(vec![("_class", word("C_INIT_NormalAlignToCP")), ("m_nControlPointNumber", int(0))]));
        }
    }
    // last, so that it holds what the operators before it moved; a feather keeps its own motion
    if any && !feathers {
        match root.get_mut("m_Operators") {
            Some(Node { value: Value::Array { items, .. }, .. }) => {
                items.retain(|op| !PINNING.contains(&class_of(op)));
                items.push(lock_to_box(set));
            }
            _ => {
                if let Value::Object(m) = &mut root.value {
                    let ops = Value::Array { items: vec![lock_to_box(set)], element: None, ty: 0 };
                    m.insert("m_Operators".into(), Node::new(ops));
                }
            }
        }
    }
    any
}

/// A system launched by the hero's body for an item sewn into it, as dota-studio's tester build
/// does it: a point of the item's (`renamed`, the names it had) goes by its new name `prefix` +
/// name, the item (`self`) and the hero (`parent`) are both the body now, and nothing hands the
/// parent's points down to it. Whether anything changed.
fn on_body(root: &mut Node, renamed: &HashSet<String>, prefix: &str) -> bool {
    let mut any = false;
    if let Some(Node { value: Value::Array { items: configs, .. }, .. }) = root.get_mut("m_controlPointConfigurations")
    {
        for config in configs.iter_mut() {
            let Some(Node { value: Value::Array { items: drivers, .. }, .. }) = config.get_mut("m_drivers") else {
                continue;
            };
            for driver in drivers.iter_mut() {
                let Value::Object(m) = &mut driver.value else { continue };
                let point = m.get("m_attachmentName").and_then(Node::as_str).unwrap_or("").to_string();
                let entity = m.get("m_entityName").and_then(Node::as_str).unwrap_or("").to_string();
                if renamed.contains(&point.to_lowercase()) && entity != "parent" {
                    m.insert("m_attachmentName".into(), word(&format!("{prefix}{point}")));
                    m.insert("m_entityName".into(), word("self"));
                    any = true;
                } else if entity == "parent" {
                    m.insert("m_entityName".into(), word("self"));
                    any = true;
                }
            }
        }
    }
    if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_PreEmissionOperators") {
        let before = items.len();
        items.retain(|op| class_of(op) != "C_OP_SetParentControlPointsToChildCP");
        any |= items.len() != before;
    }
    any
}

/// What a copy of a system tree does to each system.
#[derive(Debug, Clone, Default)]
pub struct Rework {
    /// spread its emitters over the scope's boxes (an effect the person added)
    pub spread: bool,
    /// launched by the hero's body (on_body): the item's points by the names they had, lowercased
    pub body: Option<(HashSet<String>, String)>,
}

/// A surface copy's root path, and its files as (path, bytes).
pub type Surface = (String, Vec<(String, Vec<u8>)>);

/// The copies of `system` and its children that spread over a surface, or None where no system of
/// the tree starts on the model (it hangs on attachment points, and goes on as it is): the root's
/// path, and the files to put in the pak as (path, bytes). The copies go in `scope`'s folder and read
/// its set.
pub fn surface_system_in(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    system: &str,
    scope: &Scope,
) -> Result<Option<Surface>, String> {
    scoped_system(read, system, scope, &Rework { spread: true, body: None })
}

/// The copies of `system` and its children reworked as `rework` says, in `scope`'s folder, or None
/// where no system of the tree changed (it goes on as it is).
pub fn scoped_system(
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    system: &str,
    scope: &Scope,
    rework: &Rework,
) -> Result<Option<Surface>, String> {
    struct Walk<'a> {
        rework: &'a Rework,
        scope: &'a Scope,
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
        if w.rework.spread && to_surface(&|n| kv.number_of(n), &mut root, &w.scope.set) {
            w.any = true;
        }
        if let Some((renamed, prefix)) = &w.rework.body {
            w.any |= on_body(&mut root, renamed, prefix);
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
                let to = copy_of(&r, &w.scope.folder);
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
        w.entries.push((format!("{}_c", copy_of(&from, &w.scope.folder)), out));
        Ok(())
    }
    let mut w = Walk { rework, scope, read, seen: HashSet::new(), entries: Vec::new(), any: false };
    copy(&mut w, system)?;
    Ok(w.any.then(|| (copy_of(system, &scope.folder), w.entries)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: Vec<Node>) -> Node {
        Node::new(Value::Array { items, element: None, ty: 0 })
    }

    fn op(class: &str) -> Node {
        object(vec![("_class", word(class))])
    }

    fn system(renderers: Vec<Node>, operators: Vec<Node>) -> Node {
        object(vec![
            ("m_Initializers", list(vec![op("C_INIT_CreateOnModel")])),
            ("m_Operators", list(operators)),
            ("m_Renderers", list(renderers)),
        ])
    }

    fn classes(root: &Node, key: &str) -> Vec<String> {
        root.get(key).unwrap().items().iter().map(|o| class_of(o).to_string()).collect()
    }

    #[test]
    fn an_emitter_reads_the_picks_own_set_and_every_pin_gives_way_to_the_box_lock() {
        let mut root =
            system(vec![], vec![op("C_OP_SnapshotRigidSkinToBones"), op("C_OP_LockToBone"), op("C_OP_Decay")]);
        assert!(to_surface(&|_| None, &mut root, "mm_fx_ab12"));
        let init = &root.get("m_Initializers").unwrap().items()[0];
        assert_eq!(init.get("m_HitboxSetName").and_then(Node::as_str), Some("mm_fx_ab12"));
        assert_eq!(classes(&root, "m_Operators"), ["C_OP_Decay", "C_OP_LockToBone"]);
        let lock = root.get("m_Operators").unwrap().items().last().unwrap();
        assert_eq!(lock.get("m_HitboxSetName").and_then(Node::as_str), Some("mm_fx_ab12"));
    }

    #[test]
    fn crownfall_feathers_keep_their_motion_and_face_the_control_point() {
        let feather = object(vec![("m_ModelList", list(vec![object(vec![("m_model", word(FEATHER))])]))]);
        let mut root = system(vec![feather], vec![op("C_OP_MovementRigidAttachToCP")]);
        assert!(to_surface(&|_| None, &mut root, "mm_fx_ab12"));
        assert_eq!(classes(&root, "m_Operators"), ["C_OP_MovementRigidAttachToCP"]);
        assert_eq!(classes(&root, "m_Initializers"), ["C_INIT_CreateOnModel", "C_INIT_NormalAlignToCP"]);
        // twice does not add it twice
        assert!(to_surface(&|_| None, &mut root, "mm_fx_ab12"));
        assert_eq!(classes(&root, "m_Initializers").len(), 2);
    }

    #[test]
    fn an_emitter_on_another_model_stays_as_it_is() {
        let mut root = object(vec![(
            "m_Initializers",
            list(vec![object(vec![
                ("_class", word("C_INIT_CreateOnModel")),
                ("m_modelInput", object(vec![("m_nType", word("PM_TYPE_NAMED_VALUE"))])),
            ])]),
        )]);
        assert!(!to_surface(&|_| None, &mut root, "mm_fx_ab12"));
    }

    #[test]
    fn a_system_the_body_launches_looks_for_the_items_points_by_their_new_names() {
        let driver =
            |point: &str, entity: &str| object(vec![("m_attachmentName", word(point)), ("m_entityName", word(entity))]);
        let mut root = object(vec![
            (
                "m_controlPointConfigurations",
                list(vec![object(vec![(
                    "m_drivers",
                    list(vec![
                        driver("attach_attack1", "self"),
                        driver("attach_hitloc", "parent"),
                        driver("attach_attack1", "parent"),
                    ]),
                )])]),
            ),
            ("m_PreEmissionOperators", list(vec![op("C_OP_SetParentControlPointsToChildCP"), op("C_OP_Decay")])),
        ]);
        let renamed: HashSet<String> = ["attach_attack1".to_string()].into();
        assert!(on_body(&mut root, &renamed, "mm_ab12_"));
        let drivers = root.get("m_controlPointConfigurations").unwrap().items()[0].get("m_drivers").unwrap().items();
        let seen: Vec<(&str, &str)> = drivers
            .iter()
            .map(|d| {
                (
                    d.get("m_attachmentName").and_then(Node::as_str).unwrap(),
                    d.get("m_entityName").and_then(Node::as_str).unwrap(),
                )
            })
            .collect();
        // the item's point by its new name; the hero's points stay the hero's, and the hero is the body
        assert_eq!(seen, [("mm_ab12_attach_attack1", "self"), ("attach_hitloc", "self"), ("attach_attack1", "self")]);
        assert_eq!(classes(&root, "m_PreEmissionOperators"), ["C_OP_Decay"]);
        // nothing of the item's and no parent: nothing to change
        let mut plain = object(vec![("m_controlPointConfigurations", list(vec![]))]);
        assert!(!on_body(&mut plain, &renamed, "mm_ab12_"));
    }

    #[test]
    fn a_picks_scope_is_its_own_and_names_no_one() {
        let s = item_scope("ab12");
        assert_eq!((s.set.as_str(), s.folder.as_str()), ("mm_fx_ab12", "particles/mm_fx/ab12/"));
        assert_eq!(copy_of("particles/econ/fire.vpcf_c", &s.folder), "particles/mm_fx/ab12/econ/fire.vpcf");
    }
}
