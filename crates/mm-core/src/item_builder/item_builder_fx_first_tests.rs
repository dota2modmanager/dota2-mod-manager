//! The effect picked for an ability wins over the worn item's: the worn item loses its swap of
//! that particle, and keeps everything else.

use std::collections::HashSet;

use super::*;

/// Two Juggernaut immortals: both replace Blade Fury's particle, the first also his healing ward's.
const TABLE: &[u8] = br#""items_game"
{
    "items"
    {
        "1" { "name" "Jugg Weapon" "prefab" "default_item" "item_slot" "weapon" "visuals" { } }
        "10" { "name" "Bladeform" "prefab" "wearable" "item_slot" "weapon"
            "visuals"
            {
                "asset_modifier0" { "type" "particle" "asset" "particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf" "modifier" "particles/a/fury.vpcf" }
                "asset_modifier1" { "type" "particle" "asset" "particles/units/heroes/hero_juggernaut/juggernaut_healing_ward.vpcf" "modifier" "particles/a/ward.vpcf" }
            }
        }
        "11" { "name" "Golden Fury" "prefab" "wearable" "item_slot" "weapon"
            "visuals"
            {
                "asset_modifier" { "type" "particle" "asset" "Particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf" "modifier" "particles/b/fury.vpcf" }
            }
        }
        "12" { "name" "Other Hero" "prefab" "wearable" "item_slot" "weapon"
            "visuals" { "asset_modifier" { "type" "particle" "asset" "particles/units/heroes/hero_lina/lina_dragon_slave.vpcf" "modifier" "particles/c/x.vpcf" } }
        }
    }
}
"#;

/// What the ability effects slot carries once Golden Fury is picked for Blade Fury.
const FX: &[u8] = br#""5001"
{
    "prefab" "default_item"
    "visuals"
    {
        "asset_modifier" { "type" "particle" "asset" "particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf" "modifier" "particles/b/fury.vpcf" }
    }
}"#;

#[test]
fn the_picked_effect_takes_its_particle_out_of_every_other_item() {
    let taken = fx_particles(FX).unwrap();
    assert_eq!(taken, HashSet::from(["particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf".to_string()]));
    let over = items_over(TABLE, &taken, &HashSet::new()).unwrap();
    let ids: Vec<&str> = over.iter().map(|(id, _)| id.as_str()).collect();
    // the stock weapon has nothing to give up; Lina's item replaces none of them
    assert_eq!(ids, ["10", "11"]);
    let bladeform = String::from_utf8_lossy(&over[0].1);
    assert!(!bladeform.contains("particles/a/fury.vpcf"), "{bladeform}");
    assert!(bladeform.contains("particles/a/ward.vpcf"), "the ward is not the pick's: it stays");
    assert!(crate::kv::block_bounds(&over[0].1, 0).is_ok(), "still a block");
}

#[test]
fn a_patch_already_in_the_build_is_left_to_the_build() {
    let taken = fx_particles(FX).unwrap();
    let over = items_over(TABLE, &taken, &HashSet::from(["10".to_string()])).unwrap();
    assert_eq!(over.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), ["11"]);
    assert!(without_particles(b"\"x\" { }", &taken).unwrap().is_none(), "nothing to give up");
}

/// MM_ITEMS_GAME: the game's items_game.txt. How many items give up Blade Fury, and how long it takes.
#[test]
#[ignore]
fn on_the_real_table() {
    let text = std::fs::read(std::env::var("MM_ITEMS_GAME").unwrap()).unwrap();
    let taken = HashSet::from(["particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf".to_string()]);
    crate::schema::items_of(&text).unwrap();
    let t = std::time::Instant::now();
    let over = items_over(&text, &taken, &HashSet::new()).unwrap();
    let names: Vec<String> = over
        .iter()
        .map(|(id, b)| {
            format!("{id} {}", String::from_utf8_lossy(&b[..b.len().min(60)]).replace(['\r', '\n', '\t'], " "))
        })
        .collect();
    println!("{} items in {:?}: {names:#?}", over.len(), t.elapsed());
}

#[test]
fn the_slots_icon_and_sound_go_over_the_worn_items() {
    // Rollermawster on the head swaps March of the Machines' icon and sound; the slot's pick does too
    let fx = br#""5002" { "prefab" "default_item" "visuals" {
        "asset_modifier" { "type" "ability_icon" "asset" "tinker_march_of_the_machines" "modifier" "tinker/cosmic/march" }
        "asset_modifier" { "type" "sound" "asset" "Hero_Tinker.March_of_the_Machines" "modifier" "Hero_Tinker.March_of_the_Machines.Cosmic" }
    } }"#;
    let head = br#""7143" { "prefab" "wearable" "visuals" {
        "asset_modifier" { "type" "ability_icon" "asset" "tinker_march_of_the_machines" "modifier" "tinker/rollermawster/march" }
        "asset_modifier" { "type" "sound" "asset" "Hero_Tinker.March_of_the_Machines.Cast" "modifier" "Hero_Tinker.March_of_the_Machines.Cast.Rollermawster" }
    } }"#;
    let taken = fx_particles(fx).unwrap();
    let out = String::from_utf8_lossy(&without_particles(head, &taken).unwrap().unwrap()).into_owned();
    assert!(!out.contains("tinker/rollermawster/march"), "the head's icon gives way: {out}");
    assert!(out.contains("Cast.Rollermawster"), "a sound of another event stays: {out}");
}
