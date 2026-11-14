//! The animation a hero plays on the game's loadout screen, for the 3D preview
//! (src/model-loadout.ts, issue #417).
//!
//! A hero's model lists its sequences in its ASEQ block, each with the activities it answers to:
//! the first is an ACT_ name, the rest are modifiers an item can switch on. The loadout plays the
//! sequence for ACT_DOTA_LOADOUT; the names differ per hero (Abaddon's loadout_anim, Juggernaut's
//! loadout_default_anim, Pudge's pudge_loadout), so they are read out of the model, not guessed.
//!
//! An item can bring its own: Pudge's Dragonclaw Hook plays pudge_loadout under "whalehook". The
//! sequence picked is the one whose modifiers are all among the items worn, with the most of them;
//! with none worn, the plain one with no modifier at all. ACT_DOTA_LOADOUT_STATUE is a still pose
//! for statues and is not the loadout.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::kv3::Node;

/// A sequence's name and every activity it answers to, the ACT_ one and its modifiers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    pub name: String,
    pub acts: Vec<String>,
}

fn text(n: Option<&Node>) -> String {
    n.and_then(Node::as_str).unwrap_or("").to_string()
}

fn items(n: Option<&Node>) -> &[Node] {
    n.map_or(&[], Node::items)
}

/// The model's sequences, or none when the file has no sequence block or one this reader cannot take.
pub fn model_sequences(model: Option<&[u8]>) -> Vec<Sequence> {
    let read = || -> Option<Vec<Sequence>> {
        let data = crate::resource::data(model?, "ASEQ", 0).ok()?;
        let kv = crate::kv3::read(data).ok()?;
        Some(
            items(kv.root.get("m_localS1SeqDescArray"))
                .iter()
                .map(|d| Sequence {
                    name: text(d.get("m_sName")),
                    acts: items(d.get("m_activityArray"))
                        .iter()
                        .map(|a| text(a.get("m_name")))
                        .filter(|a| !a.is_empty())
                        .collect(),
                })
                .filter(|s| !s.name.is_empty())
                .collect(),
        )
    };
    read().unwrap_or_default()
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a valid pattern"))
}

/// String.prototype.slice on UTF-16 units: a negative end counts from the end.
fn js_slice(units: &[u16], start: i64, end: i64) -> String {
    let len = units.len() as i64;
    let at = |i: i64| if i < 0 { (len + i).max(0) } else { i.min(len) } as usize;
    let (s, e) = (at(start), at(end));
    if s >= e {
        return String::new();
    }
    String::from_utf16_lossy(&units[s..e])
}

fn find_from(units: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    (from..units.len().saturating_sub(needle.len()) + 1).find(|&i| units[i..].starts_with(needle))
}

/// Every activity modifier any item switches on, in lower case, from items_game; found once per table.
pub fn item_modifiers(text: &str) -> HashSet<String> {
    static KNOWN: Mutex<Option<(String, HashSet<String>)>> = Mutex::new(None);
    if let Ok(k) = KNOWN.lock() {
        if let Some((_, set)) = k.as_ref().filter(|(t, _)| t == text) {
            return set.clone();
        }
    }
    static MOD: OnceLock<Regex> = OnceLock::new();
    let modifier = re(&MOD, r#"(?i)"modifier"\s+"([^"]+)""#);
    let units: Vec<u16> = text.encode_utf16().collect();
    let needle: Vec<u16> = "\"activity\"".encode_utf16().collect();
    let mut out = HashSet::new();
    let mut at = find_from(&units, &needle, 0);
    while let Some(a) = at {
        let end = find_from(&units, &[b'}' as u16], a).map_or(-1, |e| e as i64);
        let start = units[..=a].iter().rposition(|&c| c == b'{' as u16).map_or(-1, |s| s as i64);
        if let Some(m) = modifier.captures(&js_slice(&units, start, end)).and_then(|c| c.get(1)) {
            out.insert(m.as_str().to_lowercase());
        }
        at = find_from(&units, &needle, a + 10);
    }
    if let Ok(mut k) = KNOWN.lock() {
        *k = Some((text.to_string(), out.clone()));
    }
    out
}

/// The kinds of motion the 3D preview's list goes by, in its order.
const MOTION_GROUPS: [&str; 7] = ["stance", "idle", "run", "attack", "ability", "emote", "other"];

fn starts_any(act: &str, prefix: &str, alts: &[&str]) -> bool {
    act.strip_prefix(prefix).is_some_and(|r| alts.iter().any(|a| r.starts_with(a)))
}

fn motion_group(act: &str) -> &'static str {
    if starts_any(act, "ACT_DOTA_", &["LOADOUT", "SPAWN"]) {
        "stance"
    } else if act.starts_with("ACT_DOTA_IDLE") {
        "idle"
    } else if starts_any(act, "ACT_DOTA_", &["RUN", "WALK"]) {
        "run"
    } else if act.starts_with("ACT_DOTA_ATTACK") {
        "attack"
    } else if starts_any(act, "ACT_DOTA_", &["CAST", "OVERRIDE_ABILITY", "GENERIC_CHANNEL", "CHANNEL"]) {
        "ability"
    } else if starts_any(act, "ACT_DOTA_", &["TAUNT", "VICTORY"]) {
        "emote"
    } else {
        "other"
    }
}

/// A motion in that list: its sequence, its kind, its activity and modifiers for a label, and whether it ends.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Motion {
    pub name: String,
    pub group: &'static str,
    pub act: String,
    pub mods: Vec<String>,
    pub once: bool,
}

/// What goes on until something else starts: standing, moving, holding a spell, being held. A swing has an end.
fn lasts(act: &str) -> bool {
    starts_any(
        act,
        "ACT_DOTA_",
        &["IDLE", "RUN", "WALK", "LOADOUT", "CAPTURE", "DISABLED", "FLAIL", "GENERIC_CHANNEL", "CHANNEL"],
    )
}

/// What the body can be shown doing, by kind. A sequence with no activity is a layer of another
/// one ("@counter_helix") or the bind pose, and a statue's activity is the same motion again.
///
/// An item's modifier changes more than the loadout: Dragonclaw Hook's Pudge runs and swings by
/// "whalehook" too. So the game's own rule for the loadout goes for each motion: of the sequences
/// that differ only in the modifiers worn, those with the most of them stand for the rest. A
/// sequence that needs an item the hero does not wear is not one it can do.
/// `modifiers` are the worn items' activity modifiers; `of_items` every one some item switches on.
pub fn motion_list(seqs: &[Sequence], modifiers: &[String], of_items: &HashSet<String>) -> Vec<Motion> {
    let worn: HashSet<String> = modifiers.iter().map(|m| m.to_lowercase()).collect();
    let possible = |s: &Sequence| {
        s.acts
            .iter()
            .all(|a| a.starts_with("ACT_") || worn.contains(&a.to_lowercase()) || !of_items.contains(&a.to_lowercase()))
    };
    struct Listed<'a> {
        s: &'a Sequence,
        mods: Vec<String>,
        key: String,
        fits: usize,
    }
    let listed: Vec<Listed> = seqs
        .iter()
        .filter(|s| !s.acts.is_empty() && !s.acts[0].contains("_STATUE") && possible(s))
        .map(|s| {
            let mods: Vec<String> = s.acts[1..].iter().filter(|a| !a.starts_with("ACT_")).cloned().collect();
            let mut own: Vec<String> =
                mods.iter().filter(|m| !worn.contains(&m.to_lowercase())).map(|m| m.to_lowercase()).collect();
            own.sort_by(|a, b| crate::js::cmp_utf16(a, b));
            let key = std::iter::once(s.acts[0].clone()).chain(own.iter().cloned()).collect::<Vec<_>>().join(" ");
            let fits = mods.len() - own.len();
            Listed { s, mods, key, fits }
        })
        .collect();
    let mut best: HashMap<&str, usize> = HashMap::new();
    for m in &listed {
        let b = best.entry(&m.key).or_insert(0);
        *b = (*b).max(m.fits);
    }
    let out: Vec<Motion> = listed
        .iter()
        .filter(|m| best.get(m.key.as_str()) == Some(&m.fits))
        .map(|m| Motion {
            name: m.s.name.clone(),
            group: motion_group(&m.s.acts[0]),
            act: m.s.acts[0].clone(),
            mods: m.mods.clone(),
            once: !lasts(&m.s.acts[0]),
        })
        .collect();
    MOTION_GROUPS.iter().flat_map(|g| out.iter().filter(move |m| m.group == *g).cloned()).collect()
}

const LOADOUT: &str = "ACT_DOTA_LOADOUT";
const IDLE: &str = "ACT_DOTA_IDLE";

/// The plain idle: the sequence named "idle", else an idle with no modifier ("arcana_idle_anim").
pub fn idle_sequence(seqs: &[Sequence]) -> Option<String> {
    seqs.iter()
        .find(|s| s.name == "idle")
        .or_else(|| seqs.iter().find(|s| s.acts.len() == 1 && s.acts[0] == IDLE))
        .map(|s| s.name.clone())
}

/// The loadout sequence for what the hero wears (the worn items' activity modifiers), or None
/// for a model that has none.
pub fn loadout_sequence(seqs: &[Sequence], modifiers: &[String]) -> Option<String> {
    let worn: HashSet<String> = modifiers.iter().map(|m| m.to_lowercase()).collect();
    let mods =
        |s: &Sequence| s.acts.iter().filter(|a| !a.starts_with("ACT_")).map(|a| a.to_lowercase()).collect::<Vec<_>>();
    let mut loadouts: Vec<(String, Vec<String>)> =
        seqs.iter().filter(|s| s.acts.iter().any(|a| a == LOADOUT)).map(|s| (s.name.clone(), mods(s))).collect();
    // a body of its own (Crystal Maiden's arcana) writes its loadout as an idle with the "loadout" modifier
    if loadouts.is_empty() {
        loadouts = seqs
            .iter()
            .filter(|s| s.acts.iter().any(|a| a == IDLE) && mods(s).iter().any(|m| m == "loadout"))
            .map(|s| (s.name.clone(), mods(s).into_iter().filter(|m| m != "loadout").collect()))
            .collect();
    }
    let mut fits: Vec<&(String, Vec<String>)> =
        loadouts.iter().filter(|(_, m)| !m.is_empty() && m.iter().all(|x| worn.contains(x))).collect();
    fits.sort_by_key(|f| std::cmp::Reverse(f.1.len()));
    fits.first()
        .copied()
        .or_else(|| loadouts.iter().find(|(_, m)| m.is_empty()))
        .or(loadouts.first())
        .map(|(n, _)| n.clone())
}

/// What a wearable does on its own while the hero stands: its loadout, else its idle, else a clip
/// named for standing. About a third of the worn models in the game have one (a cape, a tail, a
/// mount's head); the rest are bones that follow the body and nothing else.
pub fn wearable_clip(seqs: &[Sequence]) -> Option<String> {
    static BIND: OnceLock<Regex> = OnceLock::new();
    static STAND: OnceLock<Regex> = OnceLock::new();
    let plain: Vec<Sequence> =
        seqs.iter().filter(|s| !re(&BIND, r"(?i)bind_?pose|^@").is_match(&s.name)).cloned().collect();
    loadout_sequence(&plain, &[])
        .or_else(|| idle_sequence(&plain))
        .or_else(|| plain.iter().find(|s| re(&STAND, r"(?i)idle|loadout").is_match(&s.name)).map(|s| s.name.clone()))
}

/// The activity modifiers an item's visuals switch on: Dragonclaw Hook's "whalehook".
pub fn item_activities(block: &str) -> Vec<String> {
    static ASSET: OnceLock<Regex> = OnceLock::new();
    static TYPE: OnceLock<Regex> = OnceLock::new();
    static STYLE: OnceLock<Regex> = OnceLock::new();
    static MOD: OnceLock<Regex> = OnceLock::new();
    let mut out = Vec::new();
    for m in re(&ASSET, r#"(?i)"asset_modifier[0-9]*"\s*\{([^{}]*)\}"#).captures_iter(block) {
        let body = &m[1];
        if !re(&TYPE, r#"(?i)"type"\s+"activity""#).is_match(body) {
            continue;
        }
        let style = re(&STYLE, r#"(?i)"style"\s+"([0-9]+)""#).captures(body).map(|c| c[1].to_string());
        let modifier = re(&MOD, r#"(?i)"modifier"\s+"([^"]+)""#).captures(body).map(|c| c[1].to_string());
        if let Some(md) = modifier {
            if style.as_deref().is_none_or(|s| s == "0") {
                out.push(md);
            }
        }
    }
    out
}
