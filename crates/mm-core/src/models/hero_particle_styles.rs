//! Which model-born particles the hero preview runs for a chosen style (src/hero-particle-styles.ts).

use indexmap::IndexMap;
use serde_json::{json, Value};

/// `s` with each `<tag>\d+` that a `_` or the closing `.vpcf` follows taken out:
/// /<tag>\d+(?=_|\.vpcf$)/g.
fn drop_numbered(s: &str, tag: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i..].starts_with(tag) {
            let after = i + tag.len();
            let end = after + s[after..].bytes().take_while(u8::is_ascii_digit).count();
            if end > after && (s[end..].starts_with('_') || &s[end..] == ".vpcf") {
                i = end;
                continue;
            }
        }
        let c = s[i..].chars().next().unwrap_or(' ');
        out.push(c);
        i += c.len_utf8();
    }
    out
}

fn canon(path: &str) -> String {
    drop_numbered(&drop_numbered(&path.to_lowercase().replace('\\', "/"), "_v"), "_style")
}

/// The particle roots to run, each with its config: the model's own, except a style-0 root whose
/// override the chosen style supplies (Spectre's *_ambient_v2_*), and then the style's own.
pub fn style_particle_roots(model: &[(String, String)], selected: &[String], style: f64) -> IndexMap<String, String> {
    let over: std::collections::HashSet<String> =
        if style > 0.0 { selected.iter().map(|p| canon(p)).collect() } else { Default::default() };
    let chosen: std::collections::HashSet<String> = selected.iter().map(|p| p.to_lowercase()).collect();
    let mut roots = IndexMap::new();
    for (path, config) in model {
        // only the base sibling of a root the style replaces; independent inherited ones stay
        if over.contains(&canon(path)) && !chosen.contains(&path.to_lowercase()) {
            continue;
        }
        roots.insert(path.clone(), config.clone());
    }
    for path in selected {
        roots.entry(path.clone()).or_insert_with(String::new);
    }
    roots
}

const STOCK_BLADE: &str = "particles/units/heroes/hero_terrorblade/terrorblade_ambient_sword";

/// Whether a particle path is Terrorblade's own sword effect.
pub fn is_stock_terrorblade_blade(path: &str) -> bool {
    let l = path.to_lowercase();
    l.starts_with(STOCK_BLADE) && (l.ends_with(".vpcf") || l.ends_with(".vpcf_c"))
}

/// Whether Terrorblade's stock sword particles go, because a replacement brings its own.
pub fn replace_terrorblade_blade_fx(body: &str, model: &str, roots: &[String]) -> bool {
    body == "models/heroes/terrorblade/terrorblade_arcana.vmdl"
        && model != "models/heroes/terrorblade/weapon.vmdl"
        && roots.iter().any(|p| p != "particles/error/null.vpcf" && !is_stock_terrorblade_blade(p))
}

/// The wearable's own snapshot wherever its particle tree names the stock one.
pub fn blade_snapshots(def: &Value, replacements: &IndexMap<String, String>) -> Result<Value, String> {
    if replacements.is_empty() {
        return Ok(def.clone());
    }
    let tree = def.get("tree").cloned().unwrap_or(Value::Null);
    let chosen = tree.get("m_hSnapshot").and_then(Value::as_str).and_then(|s| {
        let l = s.to_lowercase();
        replacements.get(l.strip_suffix("_c").unwrap_or(&l))
    });
    let tree = match chosen.filter(|c| c.ends_with(".vsnap")) {
        Some(c) => {
            let mut t = tree.clone();
            match t.as_object_mut() {
                Some(o) => {
                    o.insert("m_hSnapshot".into(), json!(c));
                }
                None => t = json!({ "m_hSnapshot": c }),
            }
            t
        }
        None => tree,
    };
    let children = def
        .get("children")
        .and_then(Value::as_array)
        .ok_or("Cannot read properties of undefined (reading 'map')")?
        .iter()
        .map(|c| blade_snapshots(c, replacements))
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = def.as_object().cloned().unwrap_or_default();
    out.insert("tree".into(), tree);
    out.insert("children".into(), Value::Array(children));
    Ok(Value::Object(out))
}
