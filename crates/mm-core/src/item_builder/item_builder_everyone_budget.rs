//! How much of everybody's look (crate::item_builder_everyone) the game can take, and whose.
//!
//! The look on everybody puts one of the user's models under the path of every other item of a
//! hero's slot, so a big library writes thousands of paths over a few hundred models: 583 picks
//! dressed 9,082 items under 9,706 paths (reported 2026-11-03). Past somewhere between 5,462 and
//! 6,574 entries in the mod folder's paks, the game started handing out wrong models: Skywrath
//! Mage's Arcane Bolt and Concussive Shot flew with a stranger's hands or chest on them, a
//! different one for a different half of the items (#414). It is the count and not any one file:
//! two halves with no item in common both broke, and either alone at 5,464 entries did not; and
//! it is not the pak, since the same files spread over pak02 to pak05 broke the same way.
//!
//! So every hero the user built is dressed except those they leave out in Settings, and a hero
//! goes in whole or not at all, the one built most lately first, while the table's whole pak stays
//! under a budget a thousand entries short of the last count seen working. Those left out are
//! named in Settings, so a long list never breaks the game in silence.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::item_builder_everyone::SchemaPatch;
use crate::vpk::Entry;

/// Entries the mod folder's paks may hold with everybody's look in them: 5,462 was seen working.
pub const EVERYONE_ENTRY_BUDGET: usize = 4500;

/// The heroes of the user's item builder picks (skywrath_mage), the one picked most lately first.
/// A switched-off pick does not count; ties go by name.
pub fn heroes_by_recency(records: &[Value]) -> Vec<String> {
    let mut last: HashMap<String, f64> = HashMap::new();
    for r in records {
        let Some(hero) = r.get("slot").and_then(Value::as_str).and_then(|s| s.strip_prefix("item:")) else {
            continue;
        };
        let Some((hero, _)) = hero.split_once(':') else { continue };
        if hero.is_empty() || r.get("enabled") == Some(&Value::Bool(false)) {
            continue;
        }
        let at = r.get("installedAt").and_then(Value::as_f64).unwrap_or(0.0);
        let e = last.entry(hero.to_string()).or_insert(at);
        *e = e.max(at);
    }
    let mut out: Vec<(String, f64)> = last.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out.into_iter().map(|(h, _)| h).collect()
}

/// What the budget kept and whom it left out.
#[derive(Debug, Default)]
pub struct Budgeted {
    pub patches: Vec<SchemaPatch>,
    /// heroes (skywrath_mage) that had something to dress and did not fit
    pub left: Vec<String>,
}

/// Everybody's look as far as the budget goes: whole heroes in `order`, each taken only if the
/// paths it adds fit beside those already in. `own` and `beneath` are the build's own files, in
/// the pak whatever happens. A hero with something to dress that `order` does not name goes last,
/// in the table's order.
pub fn within_budget(
    patches: Vec<(String, SchemaPatch)>,
    own: &[SchemaPatch],
    beneath: &[Entry],
    order: &[String],
    budget: usize,
) -> Budgeted {
    let key = |en: &Entry| en.path().to_lowercase();
    // the table itself, and every file of the build's own
    let mut taken: HashSet<String> = HashSet::from(["scripts/items/items_game.txt".to_string()]);
    taken.extend(own.iter().flat_map(|p| p.assets.iter()).chain(beneath).map(key));
    let mut by_hero: Vec<(String, Vec<SchemaPatch>)> = Vec::new();
    for (hero, p) in patches {
        let hero = hero.strip_prefix("npc_dota_hero_").unwrap_or(&hero).to_string();
        match by_hero.iter_mut().find(|(h, _)| *h == hero) {
            Some((_, list)) => list.push(p),
            None => by_hero.push((hero, vec![p])),
        }
    }
    let rank = |h: &str| order.iter().position(|o| o == h).unwrap_or(usize::MAX);
    // stable: the unnamed keep the table's order behind the named
    by_hero.sort_by_key(|(h, _)| rank(h));
    let mut out = Budgeted::default();
    for (hero, mine) in by_hero {
        let adds: HashSet<String> =
            mine.iter().flat_map(|p| p.assets.iter()).map(key).filter(|k| !taken.contains(k)).collect();
        if taken.len() + adds.len() > budget {
            out.left.push(hero);
            continue;
        }
        taken.extend(adds);
        out.patches.extend(mine);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vpk::{empty, entry_at};
    use serde_json::json;

    fn patch(id: &str, files: &[&str]) -> SchemaPatch {
        SchemaPatch {
            id: id.into(),
            block: Vec::new(),
            assets: files.iter().map(|f| entry_at(f, empty())).collect(),
            source: String::new(),
        }
    }
    fn hero(h: &str, id: &str, files: &[&str]) -> (String, SchemaPatch) {
        (format!("npc_dota_hero_{h}"), patch(id, files))
    }
    fn ids(b: &Budgeted) -> Vec<&str> {
        b.patches.iter().map(|p| p.id.as_str()).collect()
    }

    #[test]
    fn heroes_come_last_picked_first_without_switched_off_picks() {
        let recs = vec![
            json!({ "slot": "item:axe:weapon", "installedAt": 10 }),
            json!({ "slot": "item:skywrath_mage:head", "installedAt": 30 }),
            json!({ "slot": "item:axe:armor", "installedAt": 50 }),
            json!({ "slot": "item:pudge:weapon", "installedAt": 99, "enabled": false }),
            json!({ "slot": "hud", "installedAt": 100 }),
            json!({ "slot": "item:lina:head" }),
        ];
        assert_eq!(heroes_by_recency(&recs), ["axe", "skywrath_mage", "lina"]);
    }

    #[test]
    fn everything_fits_in_a_roomy_budget() {
        let all = vec![hero("axe", "1", &["a/1.vmdl_c"]), hero("lina", "2", &["l/1.vmdl_c"])];
        let b = within_budget(all, &[], &[], &["lina".into(), "axe".into()], 100);
        assert_eq!(ids(&b), ["2", "1"]);
        assert!(b.left.is_empty());
    }

    #[test]
    fn a_hero_goes_in_whole_or_not_at_all_in_the_order_asked() {
        // table + own file = 2 taken; budget 5 leaves room for three more paths
        let all = vec![
            hero("axe", "1", &["a/1.vmdl_c", "a/2.vmdl_c"]),
            hero("lina", "2", &["l/1.vmdl_c"]),
            hero("axe", "3", &["a/3.vmdl_c"]),
            hero("pudge", "4", &["p/1.vmdl_c"]),
        ];
        let own = [patch("own", &["own/1.vmdl_c"])];
        let b = within_budget(all, &own, &[], &["lina".into(), "axe".into(), "pudge".into()], 5);
        // lina (1) fits, axe (3) would make 6, pudge (1) still fits
        assert_eq!(ids(&b), ["2", "4"]);
        assert_eq!(b.left, ["axe"]);
    }

    #[test]
    fn paths_already_in_the_pak_cost_nothing() {
        let all = vec![hero("axe", "1", &["Own/1.vmdl_c", "under/b.vmdl_c"])];
        let beneath = [entry_at("under/b.vmdl_c", empty())];
        let own = [patch("own", &["own/1.vmdl_c"])];
        // taken: table, own/1, under/b = 3, the hero adds nothing new
        let b = within_budget(all, &own, &beneath, &[], 3);
        assert_eq!(ids(&b), ["1"]);
    }

    #[test]
    fn heroes_the_order_does_not_name_go_last_in_table_order() {
        let all = vec![hero("pudge", "1", &["p"]), hero("axe", "2", &["a"]), hero("lina", "3", &["l"])];
        let b = within_budget(all, &[], &[], &["lina".into()], 3);
        assert_eq!(ids(&b), ["3", "1"]);
        assert_eq!(b.left, ["axe"]);
    }
}
