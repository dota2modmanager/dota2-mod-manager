//! A wearable's model without its cloth, replacing src/model-cloth.ts. Copied under a stock path
//! of a hero whose own cloth has a local force other than 1 (Centaur's 1.5), a wearable's cloth
//! trails behind him; such a copy goes in with m_pFeModel null and the rest of PHYS as it was.

use std::collections::HashMap;

use crate::kv3::{self, Block, Node, Value};
use crate::resource;

fn fe_model(model: &[u8]) -> Result<Option<Block>, String> {
    if !resource::blocks(model).map_err(|e| e.to_string())?.iter().any(|b| b.name == "PHYS") {
        return Ok(None);
    }
    let kv = kv3::read(resource::data(model, "PHYS", 0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let is_obj = matches!(kv.root.get("m_pFeModel"), Some(Node { value: Value::Object(_), .. }));
    Ok(is_obj.then_some(kv))
}

/// The model with its cloth simulation taken out; the same bytes when it has none or cannot be read.
pub fn without_cloth(model: &[u8]) -> Vec<u8> {
    let take = || -> Option<Vec<u8>> {
        let mut kv = fe_model(model).ok()??;
        let Value::Object(m) = &mut kv.root.value else { return None };
        // null in KV3 is a type alone, which is how the game writes a model with no cloth
        m.insert("m_pFeModel".into(), Node::new(Value::Other { ty: 1, value: None }));
        resource::replace(model, "PHYS", 0, &kv3::write(&kv).ok()?).ok()
    };
    take().unwrap_or_else(|| model.to_vec())
}

/// Whether a model carries a cloth simulation.
pub fn has_cloth(model: &[u8]) -> bool {
    matches!(fe_model(model), Ok(Some(_)))
}

/// Whether a hero's body drags the cloth of the wearables under its stock paths: its own cloth's
/// local force is not 1.
pub fn drags_cloth(body: Option<&[u8]>) -> bool {
    let Some(Ok(Some(kv))) = body.map(fe_model) else { return false };
    let Some(force) = kv.root.get("m_pFeModel").and_then(|fe| fe.get("m_flLocalForce")) else { return false };
    matches!(force.value, Value::Number { .. }) && kv.number_of(force).is_some_and(|f| (f - 1.0).abs() > 1e-3)
}

/// Whether a wearable copied to `to` would trail: a path in models/heroes/<folder>/ whose body,
/// <folder>/<folder>.vmdl_c, drags cloth. Asked once per folder.
pub struct ClothDragger<F: FnMut(&str) -> Option<Vec<u8>>> {
    read: F,
    bodies: HashMap<String, bool>,
}

impl<F: FnMut(&str) -> Option<Vec<u8>>> ClothDragger<F> {
    pub fn new(read: F) -> Self {
        ClothDragger { read, bodies: HashMap::new() }
    }
    pub fn drags(&mut self, to: &str) -> bool {
        let lower = to.to_lowercase();
        let Some(rest) = lower.strip_prefix("models/heroes/") else { return false };
        let Some(folder) = rest.split('/').next().filter(|f| !f.is_empty() && rest.len() > f.len()) else {
            return false;
        };
        if let Some(&d) = self.bodies.get(folder) {
            return d;
        }
        let body = (self.read)(&format!("models/heroes/{folder}/{folder}.vmdl_c"));
        let d = drags_cloth(body.as_deref());
        self.bodies.insert(folder.to_string(), d);
        d
    }
}
