//! Trees on the map from another of the game's tree sets, one set for Radiant and one for Dire
//! (src/tree-sets.ts, issue #421). Trees name their model by path and the two sides use models of
//! their own, so a pak that puts other models under the default trees' names changes one side's
//! trees and leaves the other alone.

use std::path::Path;

/// The side of the map a tree or a tower stands on.
pub type Side = &'static str;
pub const SIDES: [Side; 2] = ["radiant", "dire"];

/// The models each side's trees wear on the default map, the most used first.
pub const DEFAULT_RADIANT: [&str; 8] = [
    "models/props_tree/tree_pine_01.vmdl",
    "models/props_tree/tree_oak_01b.vmdl",
    "models/props_tree/tree_oak_01.vmdl",
    "models/props_tree/tree_oak_02.vmdl",
    "models/props_tree/tree_pine_02.vmdl",
    "models/props_tree/tree_bamboo_02.vmdl",
    "models/props_tree/tree_pine_03b.vmdl",
    "models/props_tree/tree_bamboo_01.vmdl",
];
pub const DEFAULT_DIRE: [&str; 4] = [
    "models/props_tree/dire_tree004.vmdl",
    "models/props_tree/dire_tree004b.vmdl",
    "models/props_tree/dire_tree008.vmdl",
    "models/props_tree/dire_tree007.vmdl",
];

pub fn default_trees(side: &str) -> &'static [&'static str] {
    if side == "dire" {
        &DEFAULT_DIRE
    } else {
        &DEFAULT_RADIANT
    }
}

/// One of the game's tree sets, named for the terrain it comes from. `tinted`: its terrain tints
/// these models through the map, which the default map does not, so the app does not offer them.
#[derive(Debug, Clone)]
pub struct TreeSet {
    pub id: &'static str,
    pub name: &'static str,
    pub models: Vec<String>,
    pub tinted: bool,
}

fn tree(names: &[&str]) -> Vec<String> {
    names.iter().map(|n| format!("models/props_tree/{n}.vmdl")).collect()
}

/// The sets the terrains use, read out of their entity lumps (2026-11-03).
pub fn tree_sets() -> Vec<TreeSet> {
    let set = |id, name, models, tinted| TreeSet { id, name, models, tinted };
    let own = |m: &[&str]| m.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    vec![
        set("radiant", "Radiant", own(&DEFAULT_RADIANT), false),
        set("dire", "Dire", own(&DEFAULT_DIRE), false),
        set(
            "winter",
            "Winter",
            tree(&["tree_pine_01_heavysnow", "tree_oak_snow_01b", "tree_oak_snow_01", "tree_pine_02_heavysnow"]),
            false,
        ),
        set("autumn", "Autumn", tree(&["tree_oak_autumn_01b", "cornstack/cornstack"]), false),
        set("spring", "Spring", tree(&["tree_oak_spring_01b", "tree_oak_spring_01"]), false),
        set("desert", "Desert", tree(&["palm_03a", "palm_03", "palm_02d", "palm_02e", "palm_02b"]), false),
        set("desert-dire", "Desert Dire", tree(&["dire_tree004_tint", "dire_tree007_tintable"]), true),
        set("jungle", "Jungle", tree(&["palm_02e", "palm_02b"]), false),
        set(
            "coloseum",
            "Coloseum",
            tree(&[
                "olive/tree_oldolive",
                "cypress/tree_cypress010",
                "cypress/tree_cypress008",
                "olive/tree_oldolive2",
                "cypress/tree_cypress009",
            ]),
            true,
        ),
        set("topiary", "Topiary", tree(&["topiary/topiary001", "topiary/topiary002"]), false),
    ]
}

/// One file of a plan: which name it goes under, and which of the game's files it is.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Planned {
    pub at: String,
    pub from: String,
}

/// Which file goes under which name: each default model of the side takes the set's models in turn.
pub fn tree_plan(side: &str, set: &TreeSet) -> Vec<Planned> {
    default_trees(side)
        .iter()
        .enumerate()
        .map(|(i, at)| Planned { at: format!("{at}_c"), from: format!("{}_c", set.models[i % set.models.len()]) })
        .filter(|f| f.at != f.from)
        .collect()
}

/// A pak with each side's trees from its set, out of the game's pak01; a side left out keeps its
/// trees. The pak, how many files it holds, and the game's files that were not there.
pub fn build_trees(
    pak01: &Path,
    radiant: Option<&str>,
    dire: Option<&str>,
) -> Result<(Vec<u8>, usize, Vec<String>), String> {
    let sets = tree_sets();
    let mut plan = Vec::new();
    for (side, id) in [("radiant", radiant), ("dire", dire)] {
        let Some(id) = id.filter(|i| !i.is_empty()) else { continue };
        let set = sets.iter().find(|s| s.id == id).ok_or_else(|| {
            format!("trees: no set \"{id}\"; the game has {}", sets.iter().map(|s| s.id).collect::<Vec<_>>().join(", "))
        })?;
        plan.extend(tree_plan(side, set));
    }
    if plan.is_empty() {
        return Err("trees: pick a set for Radiant or Dire that is not its own".into());
    }
    let index = crate::vpk_shared::shared_index(pak01).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut missing = Vec::new();
    for f in plan {
        match index.read(&f.from).map_err(|e| e.to_string())? {
            Some(data) => entries.push(crate::vpk::entry_at(&f.at, std::sync::Arc::from(data))),
            None => missing.push(f.from),
        }
    }
    let n = entries.len();
    Ok((crate::vpk::build(&entries), n, missing))
}
