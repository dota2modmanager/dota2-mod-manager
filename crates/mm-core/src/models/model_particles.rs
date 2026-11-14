//! Particles a model brings by itself, with no item table to create them (src/model-particles.ts).
//! A model's key values can list particles (`particle_cfg_list`): each row names a system and the
//! control point configuration to start it with, "preview" the one pointed at the model's
//! attachments. The key values are KV3 text in the model's DATA block, and a system named there
//! must also be in the file's reference list or the game does not load it.

use std::sync::OnceLock;

use regex::Regex;

use crate::kv3::{self, Node, Value};

/// JavaScript's \s.
const WS: &str = r"[\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]";

fn list_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(&format!(r"(^|{WS}|[{{,])particle_cfg_list{WS}*={WS}*\[(?s:.)*?\n?{WS}*\]{WS}*,?")).unwrap()
    })
}

/// The key values' list of these systems, as the game's own models write it.
fn list_text(paths: &[&str]) -> String {
    let rows: String = paths
        .iter()
        .map(|p| format!("\t\t{{\n\t\t\tname = resource:\"{p}\"\n\t\t\tconfig = \"preview\"\n\t\t}},\n"))
        .collect();
    format!("particle_cfg_list = \n\t[\n{rows}\t]")
}

/// `text` with its particle list replaced by these systems; a text of the KV3 kind stays one.
pub fn key_values_with_particles(text: &str, paths: &[&str]) -> String {
    let list = list_text(paths);
    if let Some(c) = list_re().captures(text) {
        let (m, before) = (c.get(0).unwrap(), c.get(1).map_or("", |b| b.as_str()));
        return format!("{}{before}{list}{}", &text[..m.start()], &text[m.end()..]);
    }
    match text.rfind('}') {
        None => format!(
            "<!-- kv3 encoding:text:version{{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d}} format:generic:version{{7412167c-06e9-4698-aff2-e63eb59037e7}} -->\n{{\n\t{list}\n}}\n"
        ),
        Some(open) => format!("{}\t{list}\n{}", &text[..open], &text[open..]),
    }
}

/// An ambient system a model's key values list.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Listed {
    pub path: String,
    pub config: String,
}

/// The authored ambient list, read out of the model's KV3 text.
pub fn key_value_particles(text: &str) -> Vec<Listed> {
    static ROW: OnceLock<Regex> = OnceLock::new();
    static NAME: OnceLock<Regex> = OnceLock::new();
    static CONFIG: OnceLock<Regex> = OnceLock::new();
    let row = ROW.get_or_init(|| Regex::new(r"\{([^{}]*)\}").unwrap());
    let name = NAME.get_or_init(|| {
        Regex::new(&format!(
            r#"(?i)(?-u:\b)name{WS}*={WS}*(?:resource{WS}*:{WS}*)?"(particles/[A-Za-z0-9_/.\-]+\.vpcf)""#
        ))
        .unwrap()
    });
    let config = CONFIG.get_or_init(|| Regex::new(&format!(r#"(?i)(?-u:\b)config{WS}*={WS}*"([^"]*)""#)).unwrap());
    let list = list_re().find(text).map_or("", |m| m.as_str());
    row.captures_iter(list)
        .filter_map(|c| {
            let r = c.get(1).map_or("", |m| m.as_str());
            let path = name.captures(r)?.get(1)?.as_str().to_lowercase();
            let config = config.captures(r).and_then(|c| c.get(1)).map_or("", |m| m.as_str()).to_string();
            Some(Listed { path, config })
        })
        .collect()
}

fn key_value_text(root: &Node) -> Option<&str> {
    root.get("m_modelInfo")?.get("m_keyValueText")?.as_str()
}

/// The ambient systems authored on a compiled model.
pub fn model_particle_entries(model: Option<&[u8]>) -> Vec<Listed> {
    let Some(model) = model else { return Vec::new() };
    let Ok(data) = crate::resource::data_block(model) else { return Vec::new() };
    let Ok(kv) = kv3::read(data) else { return Vec::new() };
    key_value_text(&kv.root).map(key_value_particles).unwrap_or_default()
}

/// `model` with these particle systems of its own (`.vpcf` paths; the ones listed before are
/// replaced), or None for a model whose block this cannot change.
pub fn with_particles(model: &[u8], paths: &[&str]) -> Option<Vec<u8>> {
    let mut kv = kv3::read(crate::resource::data_block(model).ok()?).ok()?;
    let node = kv.root.get_mut("m_modelInfo")?.get_mut("m_keyValueText")?;
    let Value::Str(text) = &node.value else { return None };
    node.value = Value::Str(key_values_with_particles(text, paths));
    let next = kv3::write(&kv).ok()?;
    let out = crate::resource::replace(model, "DATA", 0, &next).ok()?;
    crate::resource::with_references(&out, paths).ok()
}
