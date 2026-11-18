//! A picked item written over another item of the same slot instead of the hero's default one
//! (#679). The target has to be a wearable the builder lists for that very slot, never a persona's
//! or an ability's effects slot, and never the item itself: anything else would write an item over
//! a block the game uses for something else.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::i18n::t;

/// Checks targets against one items_game, reading its slots once, on the first target asked about.
pub struct Replacements<'a> {
    text: &'a [u8],
    wearable: Option<HashMap<String, HashSet<String>>>,
    free: Option<HashSet<String>>,
}

impl<'a> Replacements<'a> {
    pub fn new(text: &'a [u8]) -> Self {
        Replacements { text, wearable: None, free: None }
    }

    /// The target as it is kept on the record: empty for none (absent, null or ""), the id when
    /// the item may replace it in that slot, an error otherwise.
    pub fn check(&mut self, slot: &str, item_id: &str, target: Option<&Value>) -> Result<String, String> {
        let refuse = |target: &str| {
            t("Предметом {0} нельзя заменить предмет {1} в этом слоте", &[Value::from(item_id), Value::from(target)])
        };
        let target = match target {
            None | Some(Value::Null) => return Ok(String::new()),
            Some(Value::String(s)) if s.is_empty() => return Ok(String::new()),
            Some(Value::String(s)) => s.as_str(),
            Some(other) => return Err(refuse(&crate::js::string(other))),
        };
        let options = if slot == "items" {
            if self.free.is_none() {
                let items = crate::schema::items_of(self.text).map_err(|e| e.to_string())?;
                self.free = Some(crate::schema::cosmetic_options(&items, slot).into_iter().map(|(id, _)| id).collect());
            }
            self.free.as_ref()
        } else if slot.starts_with("item:") {
            if self.wearable.is_none() {
                let slots = crate::item_builder_slots::item_slots(self.text).map_err(|e| e.to_string())?;
                self.wearable = Some(
                    slots
                        .into_iter()
                        .filter(|s| s.persona.is_none() && s.ability_fx.is_none())
                        .map(|s| (s.slot, s.options.into_iter().map(|o| o.id).collect()))
                        .collect(),
                );
            }
            self.wearable.as_ref().and_then(|w| w.get(slot))
        } else {
            None
        };
        match options {
            Some(o) if o.contains(item_id) && o.contains(target) && item_id != target => Ok(target.to_string()),
            _ => Err(refuse(target)),
        }
    }
}

/// One target checked, the items_game read only when there is a target to check.
pub fn checked_target(
    text: impl FnOnce() -> Result<Vec<u8>, String>,
    slot: &str,
    item_id: &str,
    target: Option<&Value>,
) -> Result<String, String> {
    if target.is_none_or(|v| v.is_null() || v.as_str() == Some("")) {
        return Ok(String::new());
    }
    let text = text()?;
    Replacements::new(&text).check(slot, item_id, target)
}

#[cfg(test)]
#[path = "item_replacement_tests.rs"]
mod tests;
