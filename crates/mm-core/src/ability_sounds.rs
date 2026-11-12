//! A sound of the user's own on one of a hero's sound events, replacing src/ability-sounds.ts: the
//! hero's events file out of the game, each chosen event made to play the user's sound instead of
//! Valve's or on top of it, written back as the KV3 text Valve's resourcecompiler reads.
//!
//! Text, not binary: an events file written back as binary KV3 is dropped by the game in silence.
//! A replaced event keeps its template's type, level and mix group and loses its layers and length;
//! a layered event gets a new event of the user's sound in its first free soundevent_layer.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::js::{number, to_fixed};
use crate::kv3::{Block, Node, Value};

/// One event given a sound of the user's own. `sound` names the stored WAV (its sha1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundEdit {
    pub event: String,
    pub mode: String,
    pub volume: f64,
    pub sound: String,
    #[serde(default)]
    pub name: String,
}

/// An event of the hero's, as the window lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeroEvent {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub files: usize,
}

/// The hero's events file in pak01.
pub fn events_file(hero: &str) -> String {
    format!("soundevents/game_sounds_heroes/game_sounds_{hero}.vsndevts_c")
}

/// Where a sound of the user's goes, compiled: one folder of ours per hero.
pub fn sound_path(hero: &str, sound: &str) -> String {
    let head: String = sound.chars().take(16).collect();
    format!("sounds/mods/d2mm/{hero}/{head}.vsnd")
}

/// The heroes whose events file leaves out the underscores of their own id.
const SOUND_HERO: [(&str, &str); 9] = [
    ("crystalmaiden", "crystal_maiden"),
    ("doombringer", "doom_bringer"),
    ("drowranger", "drow_ranger"),
    ("nightstalker", "night_stalker"),
    ("sandking", "sand_king"),
    ("shadowshaman", "shadow_shaman"),
    ("skeletonking", "skeleton_king"),
    ("stormspirit", "storm_spirit"),
    ("witchdoctor", "witch_doctor"),
];

/// The hero's own id for an events file's name: "crystalmaiden" is "crystal_maiden".
pub fn sound_hero(file: &str) -> String {
    SOUND_HERO.iter().find(|(k, _)| *k == file).map_or(file, |(_, v)| v).to_string()
}

/// The heroes that have an events file, by the file's name.
pub fn heroes_with_sounds<'a>(paths: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = paths
        .filter_map(|p| p.strip_prefix("soundevents/game_sounds_heroes/game_sounds_")?.strip_suffix(".vsndevts_c"))
        .filter(|m| !m.is_empty() && m.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_'))
        .filter(|m| !m.ends_with("_release_event"))
        .map(str::to_string)
        .collect();
    out.sort();
    out
}

/// A tree to write as text: the file's own nodes, and what is made here.
#[derive(Debug, Clone)]
enum T {
    Node(Node),
    Obj(IndexMap<String, T>),
    Arr(Vec<T>),
    Str(String),
    /// Text put in the file as it is: a number written the way Valve writes it.
    Lit(String),
}

impl T {
    fn get(&self, key: &str) -> Option<T> {
        match self {
            T::Obj(m) => m.get(key).cloned(),
            T::Node(n) => n.get(key).cloned().map(T::Node),
            _ => None,
        }
    }
    fn members(&self) -> Option<IndexMap<String, T>> {
        match self {
            T::Obj(m) => Some(m.clone()),
            T::Node(Node { value: Value::Object(m), .. }) => {
                Some(m.iter().map(|(k, v)| (k.clone(), T::Node(v.clone()))).collect())
            }
            _ => None,
        }
    }
    fn as_str(&self) -> Option<&str> {
        match self {
            T::Str(s) => Some(s),
            T::Node(n) => n.as_str(),
            _ => None,
        }
    }
}

fn files_of(ev: Option<&T>) -> Vec<String> {
    let Some(f) = ev.and_then(|e| e.get("vsnd_files")) else { return vec![] };
    match &f {
        T::Arr(items) => items.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        T::Node(Node { value: Value::Array { items, .. }, .. }) => {
            items.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
        }
        _ => f.as_str().map(|s| vec![s.to_string()]).unwrap_or_default(),
    }
}

/// The events a sound can be put on: those that play one. An event of ours made by a layer is left out.
pub fn hero_events(kv: &Block) -> Vec<HeroEvent> {
    let Value::Object(m) = &kv.root.value else { return vec![] };
    m.iter()
        .filter_map(|(name, ev)| {
            let t = T::Node(ev.clone());
            let files = files_of(Some(&t)).len();
            (files > 0 && !name.contains(".d2mm_")).then(|| HeroEvent {
                name: name.clone(),
                ty: ev.get("type").and_then(Node::as_str).unwrap_or("").to_string(),
                files,
            })
        })
        .collect()
}

/// An event playing only `vsnd`, made from `template` (its type, level, mix group...).
fn event_for(template: &IndexMap<String, T>, vsnd: &str, volume: f64) -> T {
    let mut m = template.clone();
    let single = m.get("vsnd_files").is_some_and(|f| f.as_str().is_some());
    m.insert("vsnd_files".into(), if single { T::Str(vsnd.into()) } else { T::Arr(vec![T::Str(vsnd.into())]) });
    m.retain(|k, _| k != "vsnd_duration" && !k.starts_with("soundevent_layer"));
    m.insert("volume".into(), T::Lit(to_fixed(volume, 2)));
    T::Obj(m)
}

/// `ev` with the event `layer` played on top of it, in its first free layer (Valve's start at 2).
fn with_layer(ev: &IndexMap<String, T>, layer: &str) -> T {
    let mut n = 2;
    while ev.contains_key(&format!("soundevent_layer{n}")) {
        n += 1;
    }
    let mut m = ev.clone();
    m.insert(format!("soundevent_layer{n}"), T::Str(layer.into()));
    m.insert(format!("soundevent_layer{n}_on"), T::Lit("1".into()));
    T::Obj(m)
}

const HEADER: &str = "<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->";

/// The hero's events with the user's sounds on them, as the KV3 text the compiler reads, and the
/// events the game no longer has, passed over.
pub fn edited_events(kv: &Block, hero: &str, edits: &[SoundEdit]) -> Result<(String, Vec<String>), String> {
    let Value::Object(root) = &kv.root.value else { return Err("the events file has no events".into()) };
    let mut events: IndexMap<String, T> = root.iter().map(|(k, v)| (k.clone(), T::Node(v.clone()))).collect();
    let mut gone = Vec::new();
    for e in edits {
        let ev = events.get(&e.event).cloned();
        let members = ev.as_ref().and_then(T::members);
        let Some(members) = members.filter(|_| !files_of(ev.as_ref()).is_empty()) else {
            gone.push(e.event.clone());
            continue;
        };
        let vsnd = sound_path(hero, &e.sound);
        if e.mode == "replace" {
            events.insert(e.event.clone(), event_for(&members, &vsnd, e.volume));
            continue;
        }
        let head: String = e.sound.chars().take(8).collect();
        let name = format!("{}.d2mm_{head}", e.event);
        events.insert(name.clone(), event_for(&members, &vsnd, e.volume));
        events.insert(e.event.clone(), with_layer(&members, &name));
    }
    Ok((format!("{HEADER}\n{}\n", text(kv, &T::Obj(events), 0)?), gone))
}

fn is_ident(k: &str) -> bool {
    let mut b = k.bytes();
    b.next().is_some_and(|c| c.is_ascii_alphabetic() || c == b'_') && b.all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

fn quoted(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

fn object(kv: &Block, members: &mut dyn Iterator<Item = (&String, T)>, ind: usize) -> Result<String, String> {
    let t = "\t".repeat(ind);
    let mut out = String::from("{\n");
    for (k, v) in members {
        let key = if is_ident(k) { k.clone() } else { quoted(k) };
        out += &format!("{t}\t{key} = {}\n", text(kv, &v, ind + 1)?);
    }
    Ok(out + &t + "}")
}

fn array(kv: &Block, items: &mut dyn Iterator<Item = T>, ind: usize) -> Result<String, String> {
    let t = "\t".repeat(ind);
    let mut out = String::from("[\n");
    for v in items {
        out += &format!("{t}\t{},\n", text(kv, &v, ind + 1)?);
    }
    Ok(out + &t + "]")
}

/// KV3 text of a node, the way Valve's own sources are written.
fn text(kv: &Block, n: &T, ind: usize) -> Result<String, String> {
    match n {
        T::Lit(s) => Ok(s.clone()),
        T::Str(s) => Ok(quoted(s)),
        T::Obj(m) => object(kv, &mut m.iter().map(|(k, v)| (k, v.clone())), ind),
        T::Arr(items) => array(kv, &mut items.iter().cloned(), ind),
        T::Node(node) => match &node.value {
            Value::Object(m) => object(kv, &mut m.iter().map(|(k, v)| (k, T::Node(v.clone()))), ind),
            Value::Array { items, .. } => array(kv, &mut items.iter().map(|v| T::Node(v.clone())), ind),
            Value::Str(s) => Ok(quoted(s)),
            Value::Number { cell, .. } => {
                let v = kv.number_of(node).unwrap_or(f64::NAN);
                Ok(if cell.is_some_and(|c| c.float) {
                    if v.is_finite() && v.fract() == 0.0 {
                        to_fixed(v, 1)
                    } else {
                        number(to_fixed(v, 6).parse::<f64>().unwrap_or(f64::NAN))
                    }
                } else {
                    number(v)
                })
            }
            Value::Other { ty: 2, value } => Ok(if value.unwrap_or(0) != 0 { "true" } else { "false" }.into()),
            // the same two answers, as a type of their own and with no value
            Value::Other { ty: 13, .. } => Ok("true".into()),
            Value::Other { ty: 14, .. } => Ok("false".into()),
            Value::Other { ty: 1, .. } => Ok("null".into()),
            Value::Other { ty, .. } => Err(format!("no KV3 text for a other of type {ty}")),
            Value::Blob(_) => Err("no KV3 text for a blob of type ?".into()),
        },
    }
}

/// Is this a WAV the compiler takes: plain 16-bit PCM at a rate the game plays. None when it is.
pub fn wav_problem(buf: &[u8]) -> Option<String> {
    if buf.len() < 12 || &buf[0..4] != b"RIFF" || &buf[8..12] != b"WAVE" {
        return Some("not a WAV file".into());
    }
    let u16_at = |at: usize| u16::from_le_bytes([buf[at], buf[at + 1]]);
    let u32_at = |at: usize| u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]);
    let mut at = 12usize;
    while at + 8 <= buf.len() {
        let size = u32_at(at + 4) as usize;
        if &buf[at..at + 4] == b"fmt " && at + 24 <= buf.len() {
            let format = u16_at(at + 8);
            let rate = u32_at(at + 12);
            let bits = u16_at(at + 22);
            if format != 1 {
                return Some("not plain PCM".into());
            }
            if bits != 16 {
                return Some(format!("{bits}-bit, the compiler wants 16-bit"));
            }
            return if [22050, 44100, 48000].contains(&rate) { None } else { Some(format!("{rate} Hz, use 44100")) };
        }
        at += 8 + size + (size & 1);
    }
    Some("no fmt chunk".into())
}
