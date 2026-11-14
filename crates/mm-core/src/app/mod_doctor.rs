//! The mod doctor (src/mod-doctor.ts, issue #118): what is wrong with a mod, found in its files and
//! the game's, before anybody starts the game to see it.
//!
//! Every check is a bug that reached the game once and took a person playing it to find: a model
//! whose animations need an activity modifier only an item turns on, a model whose sequences are
//! in another order than the game's model at that path, a particle that hangs more children on
//! itself than it hands control points to, and a particle child that neither the mod nor the game
//! has, or that its RERL block does not name. Each finding names the file, says what happens in
//! the game, and how sure it is.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use crate::kv3::{self, Block, Node};

/// One thing the doctor found.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Finding {
    pub file: String,
    /// an error breaks something in the game, a warning may, a note is worth knowing
    pub level: &'static str,
    pub what: String,
}

fn text(n: Option<&Node>) -> String {
    n.and_then(Node::as_str).unwrap_or("").to_string()
}

fn items(n: Option<&Node>) -> &[Node] {
    n.map_or(&[], Node::items)
}

/// A sequence or a clip: its name, the activity it plays and the modifiers it needs.
#[derive(Debug, Clone)]
pub struct Playable {
    pub name: String,
    pub acts: Vec<String>,
    pub mods: Vec<String>,
}

fn has_block(file: &[u8], name: &str) -> Result<bool, String> {
    Ok(crate::resource::blocks(file).map_err(|e| e.to_string())?.iter().any(|b| b.name == name))
}

fn block(file: &[u8], name: &str) -> Result<Block, String> {
    let data = crate::resource::data(file, name, 0).map_err(|e| e.to_string())?;
    kv3::read(data).map_err(|e| e.to_string())
}

fn playables(file: &[u8], name: &str, list_key: &str, name_key: &str) -> Result<Vec<Playable>, String> {
    if !has_block(file, name)? {
        return Ok(vec![]);
    }
    let kv = block(file, name)?;
    Ok(items(kv.root.get(list_key))
        .iter()
        .map(|x| {
            // the first activity is the one played, every other entry a modifier
            let names: Vec<String> = items(x.get("m_activityArray")).iter().map(|a| text(a.get("m_name"))).collect();
            let at = names.iter().position(|n| n.starts_with("ACT_"));
            Playable {
                name: text(x.get(name_key)),
                acts: at.map(|i| vec![names[i].clone()]).unwrap_or_default(),
                mods: names.iter().enumerate().filter(|(i, _)| Some(*i) != at).map(|(_, n)| n.clone()).collect(),
            }
        })
        .collect())
}

/// A model's sequences: name, the activities it plays and the modifiers it needs.
pub fn sequences_of(file: &[u8]) -> Result<Vec<Playable>, String> {
    playables(file, "ASEQ", "m_localS1SeqDescArray", "m_sName")
}

/// The names behind a model's sequence numbers, which the server sends online: every sequence and
/// every clip played only through one. Older files without the list number their sequences alone.
pub fn sequence_numbers_of(file: &[u8]) -> Result<Vec<String>, String> {
    if !has_block(file, "ASEQ")? {
        return Ok(vec![]);
    }
    let kv = block(file, "ASEQ")?;
    match kv.root.get("m_localSequenceNameArray") {
        Some(list) => Ok(list.items().iter().map(|n| text(Some(n))).collect()),
        None => Ok(sequences_of(file)?.into_iter().map(|s| s.name).collect()),
    }
}

/// A model's animation clips, the same way: the lists the game picks by.
pub fn clips_of(file: &[u8]) -> Result<Vec<Playable>, String> {
    playables(file, "ANIM", "m_animArray", "m_name")
}

/// Activity modifiers the game itself turns on for a hero, with no item: these need no warning.
const GAME_MODIFIERS: [&str; 12] = [
    "injured",
    "haste",
    "loadout",
    "run",
    "walk",
    "aggressive",
    "odachi",
    "fast",
    "faster",
    "fastest",
    "slow",
    "arcana_level_2",
];

fn game_modifier(m: &str) -> bool {
    GAME_MODIFIERS.contains(&m)
}

fn unique(v: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in v {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

fn said(s: &Playable) -> String {
    let mut mods = s.mods.clone();
    mods.sort_by(|a, b| crate::js::cmp_utf16(a, b));
    let all: Vec<String> = s.acts.iter().cloned().chain(mods).collect();
    if all.is_empty() {
        "nothing".into()
    } else {
        all.join(" ")
    }
}

fn check_model(path: &str, file: &[u8], game: Option<&[u8]>) -> Result<Vec<Finding>, String> {
    let mut out = Vec::new();
    let data = crate::resource::data_block(file).map_err(|e| e.to_string())?;
    let kv = kv3::read(data).map_err(|e| e.to_string())?;
    let name = text(kv.root.get("m_name"));
    let wanted = path.strip_suffix("_c").unwrap_or(path);
    if !name.is_empty() && name != wanted {
        out.push(Finding {
            file: path.into(),
            level: "note",
            what: format!("named \"{name}\" inside, put under \"{wanted}\""),
        });
    }
    let seqs = sequences_of(file)?;
    let clips = clips_of(file)?;
    for (kind, list) in [("clips", &clips), ("sequences", &seqs)] {
        for act in unique(list.iter().flat_map(|s| s.acts.clone())) {
            let playing: Vec<&Playable> = list.iter().filter(|s| s.acts.contains(&act)).collect();
            // a hero standing healthy has no modifier on: one has to play with none at all
            if playing.iter().any(|s| s.mods.is_empty()) {
                continue;
            }
            let need = unique(playing.iter().flat_map(|s| s.mods.iter().filter(|m| !game_modifier(m)).cloned()));
            if need.is_empty() {
                continue;
            }
            let need: Vec<String> = need.iter().map(|m| format!("\"{m}\"")).collect();
            out.push(Finding {
                file: path.into(),
                level: "error",
                what: format!(
                    "{act} plays only with the modifier {} in its {kind}, which an item turns on: without it, nothing or the wrong animation plays",
                    need.join(" or ")
                ),
            });
        }
    }
    if let Some(game) = game {
        let theirs = sequence_numbers_of(game)?;
        let ours = sequence_numbers_of(file)?;
        if let Some(at) = theirs.iter().enumerate().position(|(i, n)| ours.get(i) != Some(n)) {
            out.push(Finding {
                file: path.into(),
                level: "warning",
                what: format!(
                    "sequence {at} is \"{}\" here and \"{}\" in the game's model: if the server online picks by number from its own, from there on other animations play",
                    ours.get(at).map_or("none", String::as_str),
                    theirs[at]
                ),
            });
        }
        // online the server picks by the game's model, so each sequence it can pick for a hero
        // with no item has to stay what the game's is to the picking
        let mine: std::collections::HashMap<&str, &Playable> = seqs.iter().map(|s| (s.name.as_str(), s)).collect();
        let moved: Vec<Playable> = sequences_of(game)?
            .into_iter()
            .filter(|s| {
                s.mods.iter().all(|m| game_modifier(m)) && mine.get(s.name.as_str()).is_some_and(|m| said(m) != said(s))
            })
            .collect();
        if let Some(s) = moved.first() {
            let more = if moved.len() > 1 { format!(" (and {} more)", moved.len() - 1) } else { String::new() };
            let number = theirs.iter().position(|n| *n == s.name).map_or(-1, |i| i as i64);
            out.push(Finding {
                file: path.into(),
                level: "warning",
                what: format!(
                    "sequence {number} \"{}\" is {} in the game's model and plays as {} here{more}: online the server picks it by the game's model, and your client plays something else. Keep the game's activities and put your clip behind them",
                    s.name,
                    said(s),
                    said(mine[s.name.as_str()])
                ),
            });
        }
    }
    Ok(out)
}

/// The attachment a particle's first configuration puts control point 0 on (its preview).
fn first_attachment(file: &[u8]) -> Result<String, String> {
    let data = crate::resource::data_block(file).map_err(|e| e.to_string())?;
    let kv = kv3::read(data).map_err(|e| e.to_string())?;
    let configs = items(kv.root.get("m_controlPointConfigurations"));
    let drivers = items(configs.first().and_then(|c| c.get("m_drivers")));
    let first = drivers.iter().find(|d| match d.get("m_iControlPoint") {
        None => true,
        Some(cp) => matches!(cp.value, kv3::Value::Number { .. }) && kv.number_of(cp) == Some(0.0),
    });
    Ok(text(first.and_then(|f| f.get("m_attachmentName"))))
}

fn check_particle(
    path: &str,
    file: &[u8],
    exists: &dyn Fn(&str) -> bool,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Vec<Finding>, String> {
    let mut out = Vec::new();
    let data = crate::resource::data_block(file).map_err(|e| e.to_string())?;
    let kv = kv3::read(data).map_err(|e| e.to_string())?;
    let children: Vec<String> =
        items(kv.root.get("m_Children")).iter().map(|c| text(c.get("m_ChildRef"))).filter(|c| !c.is_empty()).collect();
    if children.is_empty() {
        return Ok(out);
    }
    let named: HashSet<String> = crate::resource::references(file).map_err(|e| e.to_string())?.into_iter().collect();
    for c in unique(children.iter().cloned()) {
        if !exists(&format!("{c}_c")) {
            out.push(Finding {
                file: path.into(),
                level: "error",
                what: format!("child {c} is in neither the mod nor the game"),
            });
        } else if !named.contains(&c) {
            out.push(Finding {
                file: path.into(),
                level: "note",
                what: format!("child {c} is not named in RERL, so the game may not load it ahead"),
            });
        }
    }
    let spread = items(kv.root.get("m_PreEmissionOperators"))
        .iter()
        .find(|o| text(o.get("_class")) == "C_OP_SetParentControlPointsToChildCP");
    if let Some(count) = spread.and_then(|s| s.get("m_nNumControlPoints")) {
        if matches!(count.value, kv3::Value::Number { .. }) {
            // children past the ones handed a point of their own share the parent's first point;
            // wrong only where the child is made for another attachment than that point is on
            let n = kv.number_of(count).unwrap_or(0.0);
            // Array.prototype.slice(n): whole numbers toward zero, a negative one counted from the end
            let len = children.len() as f64;
            let n = if n.is_nan() { 0.0 } else { n.trunc() };
            let skip = if n < 0.0 { (len + n).max(0.0) } else { n.min(len) } as usize;
            let parent_at = first_attachment(file)?;
            for c in &children[skip..] {
                let child_at = match read(&format!("{c}_c")) {
                    Some(child) => first_attachment(&child)?,
                    None => String::new(),
                };
                if !parent_at.is_empty() && !child_at.is_empty() && child_at != parent_at {
                    out.push(Finding {
                        file: path.into(),
                        level: "error",
                        what: format!("child {c} is made for {child_at} but gets the parent's first point, on {parent_at}: it is drawn there"),
                    });
                }
            }
        }
    }
    Ok(out)
}

/// Everything the doctor finds in a mod's VPK, against the game's pak01.
pub fn examine(module: &Path, pak01: &Path) -> Result<Vec<Finding>, String> {
    let ours = crate::vpk::Index::open(module).map_err(|e| e.to_string())?;
    let game = crate::vpk_shared::shared_index(pak01).map_err(|e| e.to_string())?;
    let mine: Vec<String> = ours.paths().map(String::from).collect();
    let mine_set: HashSet<&str> = mine.iter().map(String::as_str).collect();
    let theirs: HashSet<&str> = game.paths().collect();
    let exists = |p: &str| mine_set.contains(p) || theirs.contains(p);
    // the mod's copy first, as the game mounts it
    let read = |p: &str| -> Option<Vec<u8>> {
        if mine_set.contains(p) {
            ours.read(p).ok().flatten()
        } else if theirs.contains(p) {
            game.read(p).ok().flatten()
        } else {
            None
        }
    };
    let mut out = Vec::new();
    for p in &mine {
        let found = (|| -> Result<Vec<Finding>, String> {
            let file = ours.read(p).map_err(|e| e.to_string())?.unwrap_or_default();
            if p.ends_with(".vmdl_c") {
                let theirs_file =
                    if theirs.contains(p.as_str()) { game.read(p).map_err(|e| e.to_string())? } else { None };
                check_model(p, &file, theirs_file.as_deref())
            } else if p.ends_with(".vpcf_c") {
                check_particle(p, &file, &exists, &read)
            } else {
                Ok(vec![])
            }
        })();
        match found {
            Ok(f) => out.extend(f),
            Err(why) => out.push(Finding { file: p.clone(), level: "note", what: format!("not read: {why}") }),
        }
    }
    let rank = |l: &str| match l {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    };
    out.sort_by(|a, b| rank(a.level).cmp(&rank(b.level)).then_with(|| crate::js::locale_compare(&a.file, &b.file)));
    Ok(out)
}
