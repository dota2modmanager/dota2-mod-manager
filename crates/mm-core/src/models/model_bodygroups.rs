//! A model with some of its body groups shown differently by default (src/model-bodygroups.ts).
//! Each mesh belongs to a choice of a group, `m_meshGroups` names the choices ("head_@1_#&1" is
//! choice 1 of "head"), and `m_nDefaultMeshGroupMask` holds a bit per choice: a file can make any
//! choice the model's own default, with no line of the item table.

use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;

use crate::kv3::{self, Block, Node, Value};

/// The bits a mask can hold exactly in the number it is read into.
const SAFE_BITS: usize = 52;

fn choice() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(.+?)_@(\d+)_").unwrap())
}

fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// The default mask with these groups set; None when the model has none of them.
fn mask_with(kv: &Block, groups: &IndexMap<String, f64>) -> Option<i128> {
    let names = kv.root.get("m_meshGroups")?;
    let held = kv.root.get("m_nDefaultMeshGroupMask").filter(|n| matches!(n.value, Value::Number { .. }))?;
    let Value::Array { items, .. } = &names.value else { return None };
    if items.len() > SAFE_BITS {
        return None;
    }
    let mut mask = round(kv.number_of(held).unwrap_or(0.0)) as i128;
    let mut did = false;
    for (bit, n) in items.iter().enumerate() {
        let Some(c) = n.as_str().and_then(|s| choice().captures(s)) else { continue };
        let Some(&want) = groups.get(&c[1].to_lowercase()) else { continue };
        let on = 1i128 << bit;
        mask = if c[2].parse::<f64>().unwrap_or(f64::NAN) == want { mask | on } else { mask & !on };
        did = true;
    }
    did.then_some(mask)
}

fn placeholder() -> Node {
    Node::new(Value::Other { ty: 0, value: None })
}

/// The model with these groups set (name and choice), or None when it has none of them.
pub fn with_bodygroups(model: &[u8], groups: &IndexMap<String, f64>) -> Result<Option<Vec<u8>>, String> {
    let e = |e: &dyn std::fmt::Display| e.to_string();
    let mut kv = kv3::read(crate::resource::data_block(model).map_err(|x| e(&x))?).map_err(|x| e(&x))?;
    let Some(mask) = mask_with(&kv, groups) else { return Ok(None) };
    let mut root = std::mem::replace(&mut kv.root, placeholder());
    let ok = match root.get_mut("m_nDefaultMeshGroupMask") {
        Some(held) => kv.set_number(held, mask as f64).map_err(|x| e(&x))?,
        None => false,
    };
    kv.root = root;
    if !ok {
        return Ok(None);
    }
    let next = kv3::write(&kv).map_err(|x| e(&x))?;
    Ok(Some(crate::resource::replace(model, "DATA", 0, &next).map_err(|x| e(&x))?))
}

/// The model with nothing to draw: a stock item's second model comes from the table whatever goes
/// under the item's path, so a pick without one leaves that file empty. None: not a model this reads.
pub fn without_meshes(model: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let e = |e: &dyn std::fmt::Display| e.to_string();
    let mut kv = kv3::read(crate::resource::data_block(model).map_err(|x| e(&x))?).map_err(|x| e(&x))?;
    let is_num = |n: Option<&Node>| n.is_some_and(|n| matches!(n.value, Value::Number { .. }));
    let masks_ok = matches!(kv.root.get("m_refMeshGroupMasks").map(|n| &n.value), Some(Value::Array { .. }));
    if !masks_ok || !is_num(kv.root.get("m_nDefaultMeshGroupMask")) {
        return Ok(None);
    }
    let mut root = std::mem::replace(&mut kv.root, placeholder());
    let mut ok = true;
    if let Some(held) = root.get_mut("m_nDefaultMeshGroupMask") {
        ok &= kv.set_number(held, 0.0).map_err(|x| e(&x))?;
    }
    if ok {
        if let Some(Node { value: Value::Array { items, .. }, .. }) = root.get_mut("m_refMeshGroupMasks") {
            for n in items.iter_mut() {
                // every one a number set to 0, as `all.every(...)` stops at the first that is not
                if !matches!(n.value, Value::Number { .. }) || !kv.set_number(n, 0.0).map_err(|x| e(&x))? {
                    ok = false;
                    break;
                }
            }
        }
    }
    kv.root = root;
    if !ok {
        return Ok(None);
    }
    let next = kv3::write(&kv).map_err(|x| e(&x))?;
    Ok(Some(crate::resource::replace(model, "DATA", 0, &next).map_err(|x| e(&x))?))
}

/// The names of the meshes these groups turn off: the toolchain exports every mesh of a model
/// whatever its mask, so the 3D preview hides them by name.
pub fn hidden_meshes(model: &[u8], groups: &IndexMap<String, f64>) -> Result<Vec<String>, String> {
    let e = |e: &dyn std::fmt::Display| e.to_string();
    let kv = kv3::read(crate::resource::data_block(model).map_err(|x| e(&x))?).map_err(|x| e(&x))?;
    let made = mask_with(&kv, groups);
    let masks = match kv.root.get("m_refMeshGroupMasks").map(|n| &n.value) {
        Some(Value::Array { items, .. }) => items,
        _ => return Ok(Vec::new()),
    };
    let Some(made) = made else { return Ok(Vec::new()) };
    let ctrl = kv3::read(crate::resource::data(model, "CTRL", 0).map_err(|x| e(&x))?).map_err(|x| e(&x))?;
    let Some(Value::Array { items: list, .. }) = ctrl.root.get("embedded_meshes").map(|n| &n.value) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for m in list {
        if !matches!(m.value, Value::Object(_)) {
            continue;
        }
        let field = |a: &str, b: &str| m.get(a).or_else(|| m.get(b));
        let name = field("name", "m_Name").and_then(Node::as_str);
        let index = field("mesh_index", "m_nMeshIndex")
            .filter(|n| matches!(n.value, Value::Number { .. }))
            .map_or(0.0, |n| ctrl.number_of(n).unwrap_or(0.0));
        // an index that is no array index reads nothing, as `items[1.5]` does
        let at = (index >= 0.0 && index.fract() == 0.0).then_some(index as usize);
        let bits = at.and_then(|i| masks.get(i)).filter(|n| matches!(n.value, Value::Number { .. }));
        let (Some(name), Some(bits)) = (name, bits) else { continue };
        // BigInt.asUintN(64, ...) of the mask: a negative one wraps
        let b = round(kv.number_of(bits).unwrap_or(0.0)) as i128 as u64;
        if (b as i128 & made) == 0 {
            out.push(name.to_lowercase());
        }
    }
    Ok(out)
}
