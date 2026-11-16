//! The particles Optimization may not silence (map_optimize.rs), because something that plays uses
//! them.
//!
//! Optimization takes whole folders of effects out (the events', the couriers', the rain's) and the
//! map's own ambience, each made a particle that shows nothing, in a pak that loads early. A file
//! of those folders is not always ambience: the item table swaps a gameplay effect for one of them
//! (a teleport, the bottle, Mjollnir's shield of an event), an ability's effect names one as a
//! child, and a mod of the catalog builds its abilities out of them. Silenced, the teleport did not
//! show, and a hero mod's abilities played with pieces of their effects missing.
//!
//! So a particle stays when anything outside what is being silenced reaches it, child after child:
//! any other particle of the game, the item table's swap of an effect that is not itself silenced,
//! or a mod the user has installed (its own particles and every particle they name).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;

use crate::vpk::Index;

/// The game's particles and the particles each names, and the item table's swaps of one particle
/// for another; every path compiled ("particles/x.vpcf_c") and in lower case.
#[derive(Default)]
pub struct Graph {
    pub refs: HashMap<String, Vec<String>>,
    pub swaps: Vec<(String, String)>,
}

/// A particle path as the archive holds it.
pub fn compiled(p: &str) -> String {
    let l = p.replace('\\', "/").to_lowercase();
    if l.ends_with(".vpcf") {
        format!("{l}_c")
    } else {
        l
    }
}

fn particles_named(file: &[u8]) -> Vec<String> {
    crate::resource::references(file)
        .unwrap_or_default()
        .into_iter()
        .map(|r| compiled(&r))
        .filter(|r| r.ends_with(".vpcf_c"))
        .collect()
}

/// The item table's "asset" particle swapped for its "modifier" particle.
pub fn swaps_of(items_game: &[u8]) -> Vec<(String, String)> {
    static RE: std::sync::OnceLock<regex::bytes::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::bytes::Regex::new(
            r#"(?i)"asset"\s*"(particles/[^"]+?\.vpcf)"\s*"modifier"\s*"(particles/[^"]+?\.vpcf)""#,
        )
        .unwrap()
    });
    re.captures_iter(items_game)
        .map(|c| (compiled(&String::from_utf8_lossy(&c[1])), compiled(&String::from_utf8_lossy(&c[2]))))
        .collect()
}

/// Every particle of `pak` and what it names, read in parallel.
pub fn graph_of(pak: &Index) -> Graph {
    let paths: Vec<String> = pak.paths().filter(|p| p.ends_with(".vpcf_c")).map(str::to_lowercase).collect();
    let refs: HashMap<String, Vec<String>> = paths
        .par_iter()
        .map(|p| (p.clone(), pak.read(p).ok().flatten().map(|b| particles_named(&b)).unwrap_or_default()))
        .collect();
    let swaps = pak.read("scripts/items/items_game.txt").ok().flatten().map(|t| swaps_of(&t)).unwrap_or_default();
    Graph { refs, swaps }
}

/// The game's graph, read once per version of pak01 (a few seconds; Dota's update makes a new one).
pub fn graph(pak: &Index) -> Arc<Graph> {
    static KEPT: Mutex<Option<(String, Arc<Graph>)>> = Mutex::new(None);
    let dir = pak.dir_path();
    let key = std::fs::metadata(dir)
        .map(|m| format!("{}|{}|{:?}", dir.display(), m.len(), m.modified().ok()))
        .unwrap_or_else(|_| dir.display().to_string());
    if let Some((k, g)) = KEPT.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if *k == key {
            return g.clone();
        }
    }
    let g = Arc::new(graph_of(pak));
    *KEPT.lock().unwrap_or_else(|e| e.into_inner()) = Some((key, g.clone()));
    g
}

/// Of the particles `silenced` would take out, those something else uses: reached from any particle
/// of the game not in it, from the item table's swap of one not in it, or from `more` (a mod's own
/// particles and those they name), and on from each through what it names.
pub fn in_use<'a>(
    graph: &Graph,
    silenced: &HashSet<String>,
    more: impl IntoIterator<Item = &'a String>,
) -> HashSet<String> {
    let mut queue: Vec<&str> = Vec::new();
    for (p, named) in &graph.refs {
        if !silenced.contains(p) {
            queue.extend(named.iter().map(String::as_str).filter(|r| silenced.contains(*r)));
        }
    }
    for (asset, modifier) in &graph.swaps {
        if !silenced.contains(asset) && silenced.contains(modifier) {
            queue.push(modifier);
        }
    }
    let more: Vec<&String> = more.into_iter().collect();
    queue.extend(more.iter().map(|s| s.as_str()).filter(|r| silenced.contains(*r)));
    let mut used: HashSet<String> = HashSet::new();
    while let Some(p) = queue.pop() {
        if !used.insert(p.to_string()) {
            continue;
        }
        if let Some(named) = graph.refs.get(p) {
            queue.extend(named.iter().map(String::as_str).filter(|r| silenced.contains(*r) && !used.contains(*r)));
        }
    }
    used
}

/// The particles the user's installed mods bring and name: each of their VPKs (`paks`) read for its
/// particles' paths and the particles those name. A pak that cannot be read gives nothing.
pub fn mods_particles(paks: &[PathBuf]) -> HashSet<String> {
    paks.par_iter()
        .flat_map_iter(|p| {
            let Ok(ix) = Index::open(Path::new(p)) else { return Vec::new() };
            let own: Vec<String> = ix.paths().filter(|x| x.ends_with(".vpcf_c")).map(str::to_lowercase).collect();
            let mut out = own.clone();
            for x in &own {
                if let Ok(Some(b)) = ix.read(x) {
                    out.extend(particles_named(&b));
                }
            }
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(refs: &[(&str, &[&str])], swaps: &[(&str, &str)]) -> Graph {
        Graph {
            refs: refs.iter().map(|(p, r)| (p.to_string(), r.iter().map(|x| x.to_string()).collect())).collect(),
            swaps: swaps.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
        }
    }

    fn set(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn an_effect_an_ability_names_stays_with_its_children_and_pure_ambience_goes() {
        let g = graph(
            &[
                ("particles/units/heroes/hero_x/arrow.vpcf_c", &["particles/econ/events/a/trail.vpcf_c"]),
                ("particles/econ/events/a/trail.vpcf_c", &["particles/econ/events/a/spark.vpcf_c"]),
                ("particles/econ/events/a/spark.vpcf_c", &[]),
                ("particles/econ/events/b/hat_ambient.vpcf_c", &["particles/econ/events/b/glow.vpcf_c"]),
                ("particles/econ/events/b/glow.vpcf_c", &[]),
            ],
            &[],
        );
        let silenced = set(&[
            "particles/econ/events/a/trail.vpcf_c",
            "particles/econ/events/a/spark.vpcf_c",
            "particles/econ/events/b/hat_ambient.vpcf_c",
            "particles/econ/events/b/glow.vpcf_c",
        ]);
        let used = in_use(&g, &silenced, std::iter::empty());
        assert_eq!(used, set(&["particles/econ/events/a/trail.vpcf_c", "particles/econ/events/a/spark.vpcf_c"]));
    }

    #[test]
    fn a_gameplay_effects_swap_for_an_events_one_stays_and_an_ambience_swap_does_not_save_it() {
        let g = graph(
            &[("particles/econ/events/ti7/tp_start.vpcf_c", &[]), ("particles/econ/events/x/hat2.vpcf_c", &[])],
            &[
                ("particles/items2_fx/teleport_start.vpcf_c", "particles/econ/events/ti7/tp_start.vpcf_c"),
                ("particles/econ/events/x/hat1.vpcf_c", "particles/econ/events/x/hat2.vpcf_c"),
            ],
        );
        let silenced = set(&[
            "particles/econ/events/ti7/tp_start.vpcf_c",
            "particles/econ/events/x/hat1.vpcf_c",
            "particles/econ/events/x/hat2.vpcf_c",
        ]);
        assert_eq!(in_use(&g, &silenced, std::iter::empty()), set(&["particles/econ/events/ti7/tp_start.vpcf_c"]));
    }

    #[test]
    fn what_an_installed_mod_uses_stays() {
        let g = graph(&[("particles/econ/events/c/glow.vpcf_c", &["particles/econ/events/c/spark.vpcf_c"])], &[]);
        let silenced = set(&["particles/econ/events/c/glow.vpcf_c", "particles/econ/events/c/spark.vpcf_c"]);
        let mods = vec!["particles/econ/events/c/glow.vpcf_c".to_string()];
        assert_eq!(in_use(&g, &silenced, &mods), silenced);
    }

    /// On the game's own files (MM_TEST_MAP, MM_TEST_PAK01): Optimization's plan keeps no particle
    /// a gameplay effect is swapped for, nor one any other particle of the game names.
    #[test]
    fn the_real_plan_silences_nothing_the_game_plays() {
        let (Ok(map), Ok(pak)) = (std::env::var("MM_TEST_MAP"), std::env::var("MM_TEST_PAK01")) else { return };
        let map = Index::open(Path::new(&map)).unwrap();
        let pak = Index::open(Path::new(&pak)).unwrap();
        let plan = crate::map_optimize::plan(&map, &pak).unwrap();
        let silenced: HashSet<String> = plan
            .values()
            .flatten()
            .filter(|(_, f)| *f == crate::map_optimize::Fill::Particle)
            .map(|(p, _)| p.to_lowercase())
            .collect();
        let g = super::graph(&pak);
        for (asset, modifier) in &g.swaps {
            assert!(silenced.contains(asset) || !silenced.contains(modifier), "{asset} -> {modifier}");
        }
        for (p, named) in &g.refs {
            if !silenced.contains(p) {
                assert!(named.iter().all(|n| !silenced.contains(n)), "{p} names a silenced particle");
            }
        }
        assert!(!silenced.contains("particles/econ/events/ti7/mekanism_recipient_ti7.vpcf_c"));
        // the ambience still goes: a hat's ambient effect of an event
        assert!(silenced.iter().any(|p| p.contains("_hat_ambient_")), "{}", silenced.len());
    }

    #[test]
    fn the_item_tables_particle_swaps_are_read() {
        let text = b"\"asset\"\t\t\"particles/items2_fx/teleport_end.vpcf\"\n\t\t\t\t\"modifier\"\t\t\"particles/econ/events/ti7/tp_end.vpcf\"";
        assert_eq!(
            swaps_of(text),
            [(
                "particles/items2_fx/teleport_end.vpcf_c".to_string(),
                "particles/econ/events/ti7/tp_end.vpcf_c".to_string()
            )]
        );
    }
}
