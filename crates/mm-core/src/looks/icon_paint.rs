//! What a hero's ability icon layer paints, past what the file names say (recolor_layers.rs).
//!
//! Two kinds of icon slipped by in Discord after 4.5.0. A cosmetic's icon whose name is not the
//! ability's: Phoenix's TI10 immortal draws `phoenix_ti10_immortal_fire_spirit` for
//! `phoenix_fire_spirits`, one letter short, so Fire Spirits stayed orange on a white Phoenix. The
//! item table says which ability each such picture stands for (its ability_icon modifiers), so the
//! layer takes those too. And an icon the player picked in Ability icons: that record copies the
//! picked picture over the ability's files and sits ahead of the paint in the load order, so the
//! paint never showed. The layer now paints the picked picture onto those same files, and the paint
//! record goes ahead of that hero's icon record.

use indexmap::IndexMap;

use crate::ability_icons::{forced_files, icon_file, IconModifier};
use crate::recolor_layers::RecolorLayer;

/// Each icon layer with every picture the item table draws for its ability, and, for an ability
/// the player picked an icon for, the files that pick covers. The answer is the file each painted
/// file is read from, where that is not the file itself.
pub fn widen_icon_layers(
    layers: &mut [RecolorLayer],
    modifiers: &[IconModifier],
    picks: &IndexMap<String, String>,
    has: &dyn Fn(&str) -> bool,
) -> IndexMap<String, String> {
    let mut from = IndexMap::new();
    for l in layers.iter_mut().filter(|l| l.kind == "abilityIcon") {
        let Some(ability) = l.name.clone() else { continue };
        let add = |f: String, files: &mut Vec<String>| {
            if !files.contains(&f) && has(&f) {
                files.push(f);
            }
        };
        for m in modifiers.iter().filter(|m| m.asset == ability) {
            add(icon_file(&m.modifier), &mut l.files);
        }
        let Some(pick) = picks.get(&ability).filter(|p| has(&icon_file(p))) else { continue };
        let source = icon_file(pick);
        for f in forced_files(&ability, pick, modifiers) {
            add(f.clone(), &mut l.files);
            if f != source && l.files.contains(&f) {
                from.insert(f, source.clone());
            }
        }
    }
    from
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(ability: &str, files: &[&str]) -> RecolorLayer {
        RecolorLayer {
            id: format!("abilityIcon:{ability}"),
            kind: "abilityIcon",
            name: Some(ability.into()),
            files: files.iter().map(|f| icon_file(f)).collect(),
        }
    }

    fn modifier(asset: &str, modifier: &str) -> IconModifier {
        IconModifier { asset: asset.into(), modifier: modifier.into(), style: None, at: 0 }
    }

    const IMMORTAL: &str = "phoenix/phoenix_ti10_immortal_ability_icon/phoenix_ti10_immortal_fire_spirit";

    #[test]
    fn a_cosmetic_icon_named_otherwise_is_painted_with_its_ability() {
        let mut layers = vec![layer("phoenix_fire_spirits", &["phoenix_fire_spirits"])];
        let mods = [modifier("phoenix_fire_spirits", IMMORTAL), modifier("phoenix_supernova", "gone/icon")];
        let has = |f: &str| f != icon_file("gone/icon");
        let from = widen_icon_layers(&mut layers, &mods, &IndexMap::new(), &has);
        assert_eq!(layers[0].files, [icon_file("phoenix_fire_spirits"), icon_file(IMMORTAL)]);
        assert!(from.is_empty());
    }

    #[test]
    fn a_picked_icon_is_what_the_layer_paints_over_the_abilitys_files() {
        let mut layers = vec![layer("tinker_march_of_the_machines", &["tinker_march_of_the_machines"])];
        let mods = [
            modifier("tinker_march_of_the_machines", "tinker/rollermawster/march"),
            modifier("tinker_march_of_the_machines", "tinker/astrarium/march"),
        ];
        let picks: IndexMap<String, String> =
            [("tinker_march_of_the_machines".to_string(), "tinker/astrarium/march".to_string())].into();
        let from = widen_icon_layers(&mut layers, &mods, &picks, &|_| true);
        let src = icon_file("tinker/astrarium/march");
        assert_eq!(from.get(&icon_file("tinker_march_of_the_machines")), Some(&src));
        assert_eq!(from.get(&icon_file("tinker/rollermawster/march")), Some(&src));
        // the picked picture itself is painted from itself
        assert!(layers[0].files.contains(&src) && !from.contains_key(&src));
    }

    #[test]
    fn a_pick_the_game_no_longer_has_changes_nothing() {
        let mut layers = vec![layer("a_b", &["a_b"])];
        let picks: IndexMap<String, String> = [("a_b".to_string(), "x/y".to_string())].into();
        let from = widen_icon_layers(&mut layers, &[], &picks, &|f| f == icon_file("a_b"));
        assert!(from.is_empty());
        assert_eq!(layers[0].files, [icon_file("a_b")]);
    }
}
