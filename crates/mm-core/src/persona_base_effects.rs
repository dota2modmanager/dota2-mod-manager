//! What of a persona's base the build takes: its persona's own effects, not another item's
//! (src/persona-base-effects.ts). An effect folder under particles/econ/items/ that none of the
//! persona's own items names is another item's: its files go, and so does a particle that leads
//! into it.

use std::collections::HashSet;

use crate::item_builder_personas::ReadyBase;
use crate::kv::KvError;

fn folder(p: &str) -> String {
    p.to_lowercase().split('/').take(5).collect::<Vec<_>>().join("/")
}

/// The bases with another item's effects taken out of each persona's.
pub fn without_others_effects(text: &[u8], ready: Vec<ReadyBase>) -> Result<Vec<ReadyBase>, KvError> {
    let mut out = Vec::with_capacity(ready.len());
    for r in ready {
        if r.base.persona != Some(true) {
            out.push(r);
            continue;
        }
        let layouts = crate::item_builder_slots::persona_layouts(text)?;
        let Some(layout) = layouts.get(&r.base.hero) else {
            out.push(r);
            continue;
        };
        let own: String = layout
            .personas
            .iter()
            .chain(layout.parts.iter().filter_map(|p| p.given.as_ref()))
            .map(|i| crate::kv::latin1(&text[i.start..i.end]))
            .collect::<Vec<_>>()
            .join("\n");
        let mut others: Vec<String> = Vec::new();
        for e in &r.entries {
            let p = e.path();
            if p.to_lowercase().starts_with("particles/econ/items/") {
                let f = folder(&p);
                if !own.contains(&format!("{f}/")) && !others.contains(&f) {
                    others.push(f);
                }
            }
        }
        if others.is_empty() {
            out.push(r);
            continue;
        }
        let set: HashSet<&str> = others.iter().map(String::as_str).collect();
        let entries: Vec<_> = r
            .entries
            .into_iter()
            .filter(|e| {
                let p = e.path().to_lowercase();
                if set.contains(folder(&p).as_str()) {
                    return false;
                }
                let said =
                    if p.ends_with(".vpcf_c") { crate::kv::latin1(&e.data).to_lowercase() } else { String::new() };
                !others.iter().any(|f| said.contains(&format!("{f}/")))
            })
            .collect();
        out.push(ReadyBase::new(r.base, entries));
    }
    Ok(out)
}
