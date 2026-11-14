//! Guards the VPK reader and writer. Everything the app knows about a mod comes through here: what
//! it contains, which hero it touches, and the content fingerprint that recognises a foreign file
//! as a catalog mod. The writer is exercised against the reader, so a change that breaks the round
//! trip fails here instead of producing paks the game silently ignores. The second half holds the
//! tree walkers to one bar on files somebody else wrote: whatever the bytes are, a walker either
//! parses them or refuses with a `VpkError`, in bounded time, and never panics.
//!
//! Replaces test/vpk.test.ts and test/vpk-fuzz.test.ts. Every file a test writes lives in a
//! throwaway folder of its own under the system temp directory.

use std::collections::BTreeMap;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mm_core::hero_names;
use mm_core::installer_repack::split_by_hero;
use mm_core::vpk::{self, Bytes, Entry, VpkError};
use mm_core::vpk_analyze::{analyze_vpk_paths, describe_analysis, name_from_analysis, subject_heroes};
use mm_core::vpk_shared::shared_index;

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// A folder of its own under the temp directory, removed when dropped.
struct Temp(PathBuf);

impl Temp {
    fn new(tag: &str) -> Temp {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("d2mm-vpk-{tag}-{}-{nanos}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn bytes(s: &str) -> Bytes {
    Arc::from(s.as_bytes())
}

fn entry(path: &str, body: &str) -> Entry {
    vpk::entry_at(path, bytes(body))
}

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

const SAMPLE: [(&str, &str); 5] = [
    ("models/heroes/crystal_maiden/crystal_maiden.vmdl_c", "base model"),
    ("models/items/crystal_maiden/cm_screeauk/cm_screeauk_head.vmdl_c", "head piece"),
    ("materials/models/heroes/crystal_maiden/crystal_maiden.vmat_c", "material"),
    ("particles/econ/items/crystal_maiden/frost_arcana.vpcf_c", "particles"),
    ("scripts/items/items_game.txt", "\"items_game\" { }"),
];

fn build_sample() -> Vec<u8> {
    vpk::build(&SAMPLE.iter().map(|(p, b)| entry(p, b)).collect::<Vec<_>>())
}

fn sample_paths() -> Vec<String> {
    SAMPLE.iter().map(|(p, _)| p.to_string()).collect()
}

/// What `read_entries` gives for an in-memory single-file VPK; an external volume is refused.
fn read_mem(buf: &[u8]) -> vpk::Result<Vec<Entry>> {
    let refuse = |_: u16| -> vpk::Result<PathBuf> { Err(VpkError::NotSingle) };
    vpk::read_entries(buf, Path::new("mem"), Some(&refuse))
}

// ---- writer against reader ----

#[test]
fn a_built_vpk_reads_back_with_every_path_intact() {
    let paths = vpk::list_paths(&build_sample()).unwrap();
    assert_eq!(sorted(paths), sorted(sample_paths()));
}

#[test]
fn a_built_vpk_reads_back_with_every_file_byte_for_byte() {
    let entries = read_mem(&build_sample()).unwrap();
    let by_path: BTreeMap<String, Vec<u8>> = entries.iter().map(|e| (e.path(), e.data.to_vec())).collect();
    assert_eq!(by_path.len(), SAMPLE.len());
    for (p, body) in SAMPLE {
        assert_eq!(by_path.get(p).map(Vec::as_slice), Some(body.as_bytes()), "{p}");
    }
}

#[test]
fn the_entries_read_back_in_the_order_the_tree_groups_them() {
    // the tree is grouped by extension, then folder, each in first-seen order
    let buf = vpk::build(&[
        entry("a/one.txt", "1"),
        entry("b/two.vmdl_c", "2"),
        entry("a/three.txt", "3"),
        entry("c/four.txt", "4"),
        entry("b/five.vmdl_c", "5"),
    ]);
    assert_eq!(
        vpk::list_paths(&buf).unwrap(),
        strings(&["a/one.txt", "a/three.txt", "c/four.txt", "b/two.vmdl_c", "b/five.vmdl_c"])
    );
    let back: Vec<String> = read_mem(&buf).unwrap().iter().map(Entry::path).collect();
    assert_eq!(back, vpk::list_paths(&buf).unwrap());
}

#[test]
fn a_file_at_the_archive_root_survives_the_round_trip() {
    let buf = vpk::build(&[entry("readme.txt", "top level")]);
    assert_eq!(vpk::list_paths(&buf).unwrap(), strings(&["readme.txt"]));
    assert_eq!(&*read_mem(&buf).unwrap()[0].data, b"top level");
}

#[test]
fn a_file_with_no_extension_is_listed_by_its_bare_name_not_with_a_stray_dot() {
    // The tree stores "no extension" as a single space. Dota 2 Skinchanger writes whole decoy
    // trees of extension-less entries, which once came out as "name. ", a path no game file has.
    let buf = vpk::build(&[entry("models/heroes/pudge/decoy", "x"), entry("LICENSE", "y")]);
    let want = strings(&["license", "models/heroes/pudge/decoy"]);
    assert_eq!(sorted(vpk::list_paths(&buf).unwrap()), want);
    assert_eq!(sorted(vpk::list_path_crcs(&buf).unwrap().keys().cloned().collect()), want);
    assert_eq!(sorted(vpk::list_entries(&buf).unwrap().into_iter().map(|(p, _)| p).collect()), want);
}

#[test]
fn an_empty_file_survives_the_round_trip() {
    let buf = vpk::build(&[entry("materials/blank.vtex_c", "")]);
    assert_eq!(vpk::list_paths(&buf).unwrap(), strings(&["materials/blank.vtex_c"]));
    assert_eq!(read_mem(&buf).unwrap()[0].data.len(), 0);
}

#[test]
fn one_buffer_under_many_paths_is_written_once_and_read_back_under_each() {
    let shared = bytes("the same model bytes");
    let buf = vpk::build(&[
        vpk::entry_at("models/heroes/axe/axe.vmdl_c", shared.clone()),
        vpk::entry_at("models/heroes/axe/axe_alt.vmdl_c", shared.clone()),
    ]);
    assert_eq!(buf.windows(shared.len()).filter(|w| *w == &*shared).count(), 1);
    for e in read_mem(&buf).unwrap() {
        assert_eq!(&*e.data, &*shared, "{}", e.path());
    }
}

#[test]
fn the_recorded_crc_is_the_crc_of_the_bytes() {
    for (p, crc) in vpk::list_entries(&build_sample()).unwrap() {
        let (_, body) = SAMPLE.iter().find(|(s, _)| *s == p).unwrap_or_else(|| panic!("{p} is not in the sample"));
        assert_eq!(crc, crc32fast::hash(body.as_bytes()), "{p}");
        assert_eq!(crc, vpk::crc32(body.as_bytes()), "{p}");
    }
}

#[test]
fn anything_that_is_not_a_vpk_is_rejected_rather_than_parsed() {
    assert!(matches!(vpk::list_paths(b"not a vpk at all"), Err(VpkError::Signature)));
    assert!(matches!(vpk::list_paths(&[0u8; 4]), Err(VpkError::Signature)));
    assert!(read_mem(b"not a vpk at all").is_err());
    assert!(vpk::fingerprint_vpk(&[0u8; 4]).is_err());
}

// ---- multi-part archives ----

#[test]
fn a_multi_part_vpk_is_read_out_of_its_numbered_volumes_by_every_reader() {
    // The game's own pak01 and most packs keep their bytes in <base>_000.vpk, _001.vpk and on,
    // named with three digits. A reader that looks for any other name finds nothing.
    let dir = Temp::new("volumes");
    let a = vpk::build(&[entry("models/heroes/pudge/pudge.vmdl_c", "first volume")]);
    let b = vpk::build(&[entry("models/heroes/axe/axe.vmdl_c", "second volume")]);
    // a cap smaller than either file puts each one in a volume of its own
    let out = vpk::combine_to_files(&[("a".into(), a), ("b".into(), b)], dir.path(), "pak07", 4).unwrap();
    assert_eq!(out.parts, strings(&["pak07_000.vpk", "pak07_001.vpk"]));
    assert!(out.conflicts.is_empty());
    let index = dir.path().join(&out.dir);

    let (axe, _) = vpk::read_entry_file(&index, "models/heroes/axe/axe.vmdl_c").unwrap().unwrap();
    assert_eq!(axe, b"second volume");
    let ix = vpk::Index::open(&index).unwrap();
    assert_eq!(ix.read("models/heroes/pudge/pudge.vmdl_c").unwrap().unwrap(), b"first volume");
    let all = vpk::read_entries(&fs::read(&index).unwrap(), &index, None).unwrap();
    let mut bodies: Vec<String> = all.iter().map(|e| String::from_utf8(e.data.to_vec()).unwrap()).collect();
    bodies.sort();
    assert_eq!(bodies, strings(&["first volume", "second volume"]));
    let single = vpk::merge_to_single(&index).unwrap();
    assert_eq!(
        sorted(vpk::list_paths(&single).unwrap()),
        strings(&["models/heroes/axe/axe.vmdl_c", "models/heroes/pudge/pudge.vmdl_c"])
    );
}

#[test]
fn a_combined_pack_keeps_crcs_and_the_merged_single_file_has_the_same_fingerprint() {
    let dir = Temp::new("combine-crc");
    let a = build_sample();
    let b = vpk::build(&[entry("sounds/weapons/hit.vsnd_c", "a sound"), entry("panorama/x.vtex_c", "")]);
    let out =
        vpk::combine_to_files(&[("a".into(), a.clone()), ("b".into(), b.clone())], dir.path(), "pak09", 16).unwrap();
    assert!(out.parts.len() > 2, "a small cap spreads the files across volumes: {:?}", out.parts);
    for part in &out.parts {
        assert!(dir.path().join(part).is_file(), "{part}");
    }
    let index = dir.path().join(&out.dir);
    let mut want = vpk::list_entries(&a).unwrap();
    want.extend(vpk::list_entries(&b).unwrap());
    let dir_buf = fs::read(&index).unwrap();
    assert_eq!(vpk::fingerprint_vpk(&dir_buf).unwrap(), vpk::fingerprint_entries(&want));
    let single = vpk::merge_to_single(&index).unwrap();
    assert_eq!(vpk::fingerprint_vpk(&single).unwrap(), vpk::fingerprint_entries(&want));
    for e in read_mem(&single).unwrap() {
        assert_eq!(e.crc, vpk::crc32(&e.data), "{}", e.path());
    }
}

#[test]
fn combining_two_mods_that_ship_the_same_path_keeps_the_first_and_lists_the_second_as_a_conflict() {
    let dir = Temp::new("combine-conflict");
    let a = vpk::build(&[entry("models/a.vmdl_c", "from a")]);
    let b = vpk::build(&[entry("models/a.vmdl_c", "from b"), entry("models/b.vmdl_c", "only b")]);
    let out = vpk::combine_to_files(&[("a".into(), a), ("b".into(), b)], dir.path(), "pak03", 1 << 20).unwrap();
    assert_eq!(out.conflicts, vec![("b".to_string(), "models/a.vmdl_c".to_string())]);
    assert_eq!(out.member_paths["a"], strings(&["models/a.vmdl_c"]));
    assert_eq!(out.member_paths["b"], strings(&["models/b.vmdl_c"]));
    let index = dir.path().join(&out.dir);
    assert_eq!(vpk::read_entry_file(&index, "models/a.vmdl_c").unwrap().unwrap().0, b"from a");
}

#[test]
fn a_member_that_is_itself_multi_part_is_refused_by_combine() {
    let dir = Temp::new("combine-refuse");
    let multi = vpk::build_dir(&[vpk::DirEntry {
        ext: "txt".into(),
        folder: "a".into(),
        name: "b".into(),
        crc: 0,
        preload: vpk::empty(),
        archive_index: 0,
        offset: 0,
        length: 5,
    }]);
    let r = vpk::combine_to_files(&[("m".into(), multi)], dir.path(), "pak04", 1 << 20);
    assert!(matches!(r, Err(VpkError::NotSingle)), "{:?}", r.err());
}

#[test]
fn volume_names_take_three_digits_after_the_base() {
    assert_eq!(vpk::volume_path(Path::new("x/pak01_dir.vpk"), 7), PathBuf::from("x/pak01_007.vpk"));
    assert_eq!(vpk::volume_path(Path::new("x/PAK02_DIR.VPK"), 123), PathBuf::from("x/PAK02_123.vpk"));
}

// ---- fingerprints ----

#[test]
fn the_fingerprint_ignores_packaging_and_depends_only_on_content() {
    let forward = build_sample();
    let reversed = vpk::build(&SAMPLE.iter().rev().map(|(p, b)| entry(p, b)).collect::<Vec<_>>());
    // same files, different order inside the archive: the same mod, so the same fingerprint
    assert_eq!(vpk::fingerprint_vpk(&forward).unwrap(), vpk::fingerprint_vpk(&reversed).unwrap());
}

#[test]
fn the_fingerprint_changes_when_any_file_content_changes() {
    let tweaked = vpk::build(
        &SAMPLE
            .iter()
            .map(|(p, b)| if p.ends_with(".vmat_c") { entry(p, &format!("{b} edited")) } else { entry(p, b) })
            .collect::<Vec<_>>(),
    );
    assert_ne!(vpk::fingerprint_vpk(&build_sample()).unwrap(), vpk::fingerprint_vpk(&tweaked).unwrap());
}

#[test]
fn loose_file_fingerprints_are_order_independent() {
    let files: Vec<(String, &[u8])> = vec![("cursor/arrow.ani".into(), b"a"), ("cursor/hand.ani".into(), b"b")];
    let reversed: Vec<(String, &[u8])> = files.iter().rev().cloned().collect();
    assert_eq!(vpk::fingerprint_files(&files), vpk::fingerprint_files(&reversed));
    let changed: Vec<(String, &[u8])> = vec![("cursor/arrow.ani".into(), b"a"), ("cursor/hand.ani".into(), b"c")];
    assert_ne!(vpk::fingerprint_files(&files), vpk::fingerprint_files(&changed));
}

// ---- what a mod is about ----

#[test]
fn a_base_hero_model_is_read_as_a_base_override_an_item_as_a_slot() {
    let analysis = analyze_vpk_paths(&sample_paths());
    let cm = analysis.heroes.iter().find(|h| h.id == "crystal_maiden").expect("crystal_maiden should be recognised");
    assert!(cm.base, "models/heroes/<hero>/<hero>.vmdl_c replaces the base model");
    assert!(!cm.slots.is_empty(), "the item piece contributes a slot");
}

#[test]
fn analysis_of_an_empty_path_list_says_so_instead_of_guessing_a_hero() {
    let analysis = analyze_vpk_paths(&[]);
    assert!(analysis.heroes.is_empty());
    assert_eq!(analysis.path_count, 0);
}

#[test]
fn a_hero_whose_folder_only_lent_a_texture_is_not_what_the_mod_is_about() {
    // Authors borrow generic lookup textures out of other heroes' folders; counting each of
    // those as a hero announced a Grimstroke set as a bundle of eight.
    let analysis = analyze_vpk_paths(&strings(&[
        "models/items/grimstroke/gs_armor/gs_armor.vmdl_c",
        "materials/models/heroes/mars/mars_volume_smoke_normal_png_b0f6b990.vtex_c",
        "materials/models/heroes/puck/puck_colorwarp3d_z002_tga_d0a36816.vtex_c",
    ]));
    assert_eq!(analysis.heroes.len(), 3, "all three are still seen");
    assert_eq!(name_from_analysis(&analysis).as_deref(), Some("Grimstroke"));
    assert!(!describe_analysis(&analysis).contains("Mars"));
    let ids: Vec<String> = subject_heroes(&analysis).into_iter().map(|h| h.id).collect();
    assert_eq!(ids, strings(&["grimstroke"]));
}

#[test]
fn a_persona_is_the_hero_it_belongs_to_not_a_hero_of_its_own() {
    // The game files Anti-Mage's Wei persona under models/heroes/antimage_female.
    let analysis = analyze_vpk_paths(&strings(&[
        "models/heroes/antimage/antimage.vmdl_c",
        "models/heroes/antimage_female/am_persona_body.vmdl_c",
        "particles/units/heroes/hero_antimage_female/am_persona_blink.vpcf_c",
    ]));
    let names: Vec<String> = subject_heroes(&analysis).into_iter().map(|h| h.name).collect();
    assert_eq!(names, strings(&["Anti-Mage"]));
    assert_eq!(name_from_analysis(&analysis).as_deref(), Some("Anti-Mage"));
}

fn clinkz_with_a_phoenix_prop() -> Vec<String> {
    strings(&[
        "models/heroes/clinkz/clinkz_head.vmdl_c",
        "models/heroes/clinkz/clinkz_horns.vmdl_c",
        "models/heroes/clinkz/clinkz_pads.vmdl_c",
        "models/items/clinkz/clinkz_ti9_immortal_weapon/clinkz_ti9_immortal_weapon.vmdl_c",
        "models/items/clinkz/clinkz_ti9_immortal_back/clinkz_ti9_immortal_back.vmdl_c",
        "models/items/phoenix/phoenix_ti10_immortal_back/phoenix_ti10_immortal_icarus_dive_fx.vmdl_c",
    ])
}

#[test]
fn a_prop_borrowed_from_another_hero_is_not_a_second_subject() {
    // One model of Phoenix against five of Clinkz's once read as two heroes and split the set.
    let analysis = analyze_vpk_paths(&clinkz_with_a_phoenix_prop());
    assert_eq!(analysis.heroes.len(), 2, "both are still seen");
    let names: Vec<String> = subject_heroes(&analysis).into_iter().map(|h| h.name).collect();
    assert_eq!(names, strings(&["Clinkz"]));
    assert_eq!(name_from_analysis(&analysis).as_deref(), Some("Clinkz"));
}

#[test]
fn two_heroes_a_pack_really_dresses_both_stay_subjects() {
    let analysis = analyze_vpk_paths(&strings(&[
        "models/heroes/pudge/pudge.vmdl_c",
        "models/items/pudge/pudge_arcana/pudge_arcana_head.vmdl_c",
        "models/items/pudge/pudge_arcana/pudge_arcana_belt.vmdl_c",
        "models/heroes/juggernaut/juggernaut.vmdl_c",
        "models/items/juggernaut/jugg_arcana/jugg_arcana_weapon.vmdl_c",
    ]));
    let names = sorted(subject_heroes(&analysis).into_iter().map(|h| h.name).collect());
    assert_eq!(names, strings(&["Juggernaut", "Pudge"]));
}

#[test]
fn splitting_refuses_a_mod_that_only_borrowed_a_prop_from_another_hero() {
    // The split decision has to agree with what the mod is about, or the set comes apart anyway.
    let dir = Temp::new("split");
    let one = dir.path().join("one_dir.vpk");
    let files = [
        "models/heroes/clinkz/clinkz_head.vmdl_c",
        "models/heroes/clinkz/clinkz_horns.vmdl_c",
        "models/heroes/clinkz/clinkz_pads.vmdl_c",
        "models/items/clinkz/ti9_weapon/ti9_weapon.vmdl_c",
        "models/items/clinkz/ti9_back/ti9_back.vmdl_c",
        "models/items/phoenix/ti10_back/ti10_icarus_fx.vmdl_c",
    ];
    let bodies = ["a", "b", "c", "d", "e", "f"];
    fs::write(&one, vpk::build(&files.iter().zip(bodies).map(|(p, b)| entry(p, b)).collect::<Vec<_>>())).unwrap();
    assert!(split_by_hero(&one).unwrap().is_empty(), "one borrowed prop is not a second mod");

    let two = dir.path().join("two_dir.vpk");
    fs::write(
        &two,
        vpk::build(&[
            entry("models/heroes/pudge/pudge.vmdl_c", "a"),
            entry("models/items/pudge/arcana/arcana_head.vmdl_c", "b"),
            entry("models/items/pudge/arcana/arcana_belt.vmdl_c", "c"),
            entry("models/heroes/juggernaut/juggernaut.vmdl_c", "d"),
            entry("models/items/juggernaut/arcana/arcana_weapon.vmdl_c", "e"),
        ]),
    )
    .unwrap();
    let parts = split_by_hero(&two).unwrap();
    assert_eq!(sorted(parts.iter().map(|(n, _, _)| n.clone()).collect()), strings(&["Juggernaut", "Pudge"]));
    for (name, buf, own) in &parts {
        // each part is a VPK of its own that holds the paths it owns
        let inside = vpk::list_paths(buf).unwrap();
        assert!(own.iter().all(|p| inside.contains(p)), "{name}: {own:?} not all in {inside:?}");
    }
}

#[test]
fn folder_names_the_game_kept_from_before_a_rename_resolve_to_the_hero() {
    for (folder, name) in [
        ("bard", "Largo"),
        ("invoker_kid", "Invoker"),
        ("lanaya", "Templar Assassin"),
        ("drow", "Drow Ranger"),
        ("gyro", "Gyrocopter"),
        ("tuskarr", "Tusk"),
        ("pudge_cute", "Pudge"),
    ] {
        assert_eq!(hero_names::display_name(folder), name, "{folder}");
    }
}

#[test]
fn a_mod_that_carries_no_models_at_all_is_still_named_by_what_it_recolours() {
    let analysis =
        analyze_vpk_paths(&strings(&["materials/models/heroes/brewmaster/brewmaster_armor_color_psd_f3d0b44a.vtex_c"]));
    assert_eq!(name_from_analysis(&analysis).as_deref(), Some("Brewmaster"));
}

#[test]
fn folders_the_game_uses_for_non_hero_content_are_not_read_as_heroes() {
    let analysis = analyze_vpk_paths(&strings(&[
        "models/heroes/announcer/announcer.vmdl_c",
        "models/heroes/terrain/terrain.vmdl_c",
    ]));
    assert!(analysis.heroes.is_empty(), "{:?}", analysis.heroes);
}

#[test]
fn a_hero_named_the_way_the_catalog_names_it_finds_the_game_id() {
    for (name, id) in [
        ("Anti-Mage", "antimage"),
        ("Queen of Pain", "queenofpain"),
        ("Nature's Prophet", "furion"),
        ("Natures Prophet", "furion"),
        ("Wraith King", "skeleton_king"),
        ("Io", "wisp"),
        ("Doom", "doom_bringer"),
        ("Monkey King", "monkey_king"),
        ("Abaddon", "abaddon"),
        ("Treant Protector", "treant"),
        ("Centaur", "centaur"),
    ] {
        assert_eq!(hero_names::id_from_name(name).as_deref(), Some(id), "{name}");
    }
    assert_eq!(hero_names::id_from_name(""), None);
}

#[test]
fn two_spellings_of_one_hero_are_one_hero_under_the_name_the_game_uses_whichever_comes_first() {
    // Merged, the hero keeps the game's id, because splitting a pack looks for its files by it.
    let alias = "models/heroes/crystalmaiden/crystalmaiden_arms.vmdl_c".to_string();
    let canonical = "models/heroes/crystal_maiden/crystal_maiden.vmdl_c".to_string();
    for paths in [vec![alias.clone(), canonical.clone()], vec![canonical.clone(), alias.clone()]] {
        let a = analyze_vpk_paths(&paths);
        assert_eq!(a.kind, "hero");
        assert_eq!(a.heroes.len(), 1, "one hero from {paths:?}");
        assert_eq!(a.heroes[0].id, "crystal_maiden");
        assert_eq!(a.heroes[0].name, "Crystal Maiden");
        assert_eq!(a.heroes[0].models, 2);
    }
}

// ---- the seeking index ----

#[test]
fn the_seeking_index_answers_exactly_what_the_one_file_reader_does() {
    // The cosmetics picker pulls item pictures out of the game's pak01 by seek; the index has to
    // agree with read_entry_file down to the byte, or the pictures come from the wrong offsets.
    let dir = Temp::new("index");
    let file = dir.path().join("pak_dir.vpk");
    let bodies = [
        ("panorama/images/econ/items/abaddon/blade/blade_png.vtex_c", "a picture"),
        ("scripts/items/items_game.txt", "the item table"),
        ("models/heroes/pudge/pudge.vmdl_c", "a model"),
        ("sounds/weapons/hit.vsnd_c", ""),
    ];
    fs::write(&file, vpk::build(&bodies.iter().map(|(p, b)| entry(p, b)).collect::<Vec<_>>())).unwrap();

    let ix = vpk::Index::open(&file).unwrap();
    assert_eq!(ix.size(), bodies.len());
    for (p, body) in bodies {
        assert!(ix.has(p), "{p} should be in the index");
        let got = ix.read(p).unwrap().unwrap();
        assert_eq!(got, body.as_bytes(), "{p}");
        let (one, crc) = vpk::read_entry_file(&file, p).unwrap().unwrap();
        assert_eq!(got, one, "{p}");
        assert_eq!(ix.crc(p), Some(crc), "{p}");
    }
    // asked in the case the caller happens to have, not the case the tree stores
    assert_eq!(ix.read("SCRIPTS/Items/Items_Game.TXT").unwrap().unwrap(), b"the item table");
    assert!(!ix.has("models/heroes/pudge/nothing.vmdl_c"));
    assert!(ix.read("models/heroes/pudge/nothing.vmdl_c").unwrap().is_none());
    assert!(vpk::read_entry_file(&file, "models/heroes/pudge/nothing.vmdl_c").unwrap().is_none());
    assert_eq!(ix.paths().map(str::to_string).collect::<Vec<_>>(), vpk::list_paths(&fs::read(&file).unwrap()).unwrap());
}

#[test]
fn the_shared_index_is_one_open_for_a_file_read_in_a_row_and_a_new_open_once_the_file_changed() {
    let dir = Temp::new("sharedix");
    let file = dir.path().join("pak01_dir.vpk");
    fs::write(&file, vpk::build(&[entry("models/a.vmdl_c", "first")])).unwrap();
    let a = shared_index(&file).unwrap();
    assert!(Arc::ptr_eq(&shared_index(&file).unwrap(), &a), "the same file: the same index");
    assert_eq!(a.read("models/a.vmdl_c").unwrap().unwrap(), b"first");
    fs::write(&file, vpk::build(&[entry("models/a.vmdl_c", "second, longer")])).unwrap();
    let b = shared_index(&file).unwrap();
    assert!(!Arc::ptr_eq(&a, &b), "a changed file is opened again");
    assert_eq!(b.read("models/a.vmdl_c").unwrap().unwrap(), b"second, longer");
}

#[test]
fn an_index_file_that_is_not_a_vpk_or_is_cut_short_is_refused_on_open() {
    let dir = Temp::new("index-bad");
    let junk = dir.path().join("junk_dir.vpk");
    fs::write(&junk, b"not a vpk at all").unwrap();
    assert!(matches!(vpk::Index::open(&junk), Err(VpkError::Signature)));
    let buf = build_sample();
    let (h, t) = vpk::header(&buf).unwrap();
    let cut = dir.path().join("cut_dir.vpk");
    for len in [0, 11, 27, h + t - 1] {
        fs::write(&cut, &buf[..len]).unwrap();
        assert!(vpk::Index::open(&cut).is_err(), "{len} bytes");
        assert!(vpk::read_entry_file(&cut, SAMPLE[0].0).is_err(), "{len} bytes");
    }
}

// ---- files somebody else wrote ----

/// A small valid VPK with entries of different shapes, to cut up.
fn fuzz_sample() -> Vec<u8> {
    let file = |folder: &str, name: &str, ext: &str, body: &str| Entry {
        ext: ext.into(),
        folder: folder.into(),
        name: name.into(),
        crc: vpk::crc32(body.as_bytes()),
        preload: vpk::empty(),
        data: bytes(body),
    };
    vpk::build(&[
        file("materials/models/heroes/wisp", "wisp_color", "vtex_c", "colour bytes"),
        file("panorama/images/heroes", "npc_dota_hero_wisp_png", "vtex_c", "portrait"),
        file(" ", "root_file", "txt", "at the archive root"),
    ])
}

/// Deterministic noise (xorshift32, the generator the TypeScript fuzz test used): a failure has
/// to be the same failure tomorrow.
struct Prng(u32);

impl Prng {
    fn next(&mut self) -> f64 {
        let mut s = self.0;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.0 = s;
        f64::from(s) / 4_294_967_296.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
}

type Walker = fn(&[u8]) -> Result<(), VpkError>;

const WALKERS: [(&str, Walker); 5] = [
    ("list_paths", |b| vpk::list_paths(b).map(drop)),
    ("list_path_crcs", |b| vpk::list_path_crcs(b).map(drop)),
    ("list_entries", |b| vpk::list_entries(b).map(drop)),
    ("read_entries", |b| read_mem(b).map(drop)),
    ("fingerprint_vpk", |b| vpk::fingerprint_vpk(b).map(drop)),
];

/// Run one walker over one buffer: None when it parsed or refused in time, else what went wrong.
fn attempt(walker: Walker, buf: &[u8]) -> Option<String> {
    let started = Instant::now();
    let outcome = catch_unwind(AssertUnwindSafe(|| walker(buf)));
    let took = started.elapsed();
    if outcome.is_err() {
        return Some("panicked".into());
    }
    // generous on purpose: a guard against a walk that never ends, not a speed measurement
    if took > Duration::from_secs(2) {
        return Some(format!("took {took:?}"));
    }
    None
}

#[test]
fn a_valid_vpk_still_reads_so_refusing_everything_cannot_pass_these_tests() {
    let buf = fuzz_sample();
    assert_eq!(
        sorted(vpk::list_paths(&buf).unwrap()),
        strings(&[
            "materials/models/heroes/wisp/wisp_color.vtex_c",
            "panorama/images/heroes/npc_dota_hero_wisp_png.vtex_c",
            "root_file.txt",
        ])
    );
    assert_eq!(vpk::list_path_crcs(&buf).unwrap().len(), 3);
    assert_eq!(vpk::list_entries(&buf).unwrap().len(), 3);
    assert_eq!(read_mem(&buf).unwrap().len(), 3);
    for (name, walker) in WALKERS {
        assert!(walker(&buf).is_ok(), "{name}");
    }
}

#[test]
fn every_truncation_of_a_valid_vpk_is_refused_not_crashed_on() {
    let buf = fuzz_sample();
    let (h, t) = vpk::header(&buf).unwrap();
    let mut bad = Vec::new();
    for cut in 0..buf.len() {
        for (name, walker) in WALKERS {
            if let Some(why) = attempt(walker, &buf[..cut]) {
                bad.push(format!("{name} at {cut} bytes: {why}"));
            }
            // a cut through the tree is a refusal, never a short list read as complete
            if cut < h + t {
                assert!(walker(&buf[..cut]).is_err(), "{name} accepted a tree cut at {cut} of {}", h + t);
            }
        }
    }
    assert!(bad.is_empty(), "{} truncation(s) escaped: {:?}", bad.len(), &bad[..bad.len().min(8)]);
}

#[test]
fn a_forged_entry_record_is_refused_not_crashed_on() {
    let buf = fuzz_sample();
    let (h, t) = vpk::header(&buf).unwrap();
    // the last record ends three terminators before the end of the tree; its preload length
    // is four bytes in. 65535 preload bytes in a file that has nothing like that left in it.
    let record = h + t - 3 - 18;
    let mut forged = buf.clone();
    forged[record + 4..record + 6].copy_from_slice(&0xffffu16.to_le_bytes());
    for (name, walker) in WALKERS {
        assert_eq!(attempt(walker, &forged), None, "{name}");
        assert!(matches!(walker(&forged), Err(VpkError::Tree)), "{name}");
    }
    // the same field the TypeScript test forged: eight bytes from the end of the file
    let mut tail = buf.clone();
    let at = tail.len() - 8;
    tail[at..at + 2].copy_from_slice(&0xffffu16.to_le_bytes());
    for (name, walker) in WALKERS {
        assert_eq!(attempt(walker, &tail), None, "{name}");
    }
}

#[test]
fn a_forged_tree_size_or_offset_does_not_read_past_the_buffer() {
    let buf = fuzz_sample();
    let (h, t) = vpk::header(&buf).unwrap();
    let record = h + t - 3 - 18;
    // an inline offset far past the end, and a length to match: the reader clamps, never panics
    let mut far = buf.clone();
    far[record + 8..record + 12].copy_from_slice(&0x7fff_fff0u32.to_le_bytes());
    far[record + 12..record + 16].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    assert_eq!(attempt(WALKERS[3].1, &far), None);
    // a tree size bigger than the file
    let mut huge = buf.clone();
    huge[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
    for (name, walker) in WALKERS {
        assert_eq!(attempt(walker, &huge), None, "{name}");
    }
}

/// A record claiming 4 GiB of data in a file of a few hundred bytes is refused by the readers that
/// go to disk, before they make a buffer that size.
#[test]
fn a_record_claiming_more_than_its_file_holds_is_refused_on_disk_without_the_buffer() {
    let buf = fuzz_sample();
    let (h, t) = vpk::header(&buf).unwrap();
    let record = h + t - 3 - 18;
    let mut forged = buf.clone();
    forged[record + 12..record + 16].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    let dir = Temp::new("claims");
    let file = dir.path().join("pak01_dir.vpk");
    fs::write(&file, &forged).unwrap();
    let index = vpk::Index::open(&file).unwrap();
    let last = index.paths().last().unwrap().to_string();
    let started = std::time::Instant::now();
    assert!(matches!(index.read(&last), Err(VpkError::Tree)));
    assert!(matches!(vpk::read_entry_file(&file, &last), Err(VpkError::Tree)));
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn seeded_byte_noise_in_the_tree_is_refused_not_crashed_on() {
    let buf = fuzz_sample();
    let mut random = Prng(20260916);
    let mut bad = Vec::new();
    for i in 0..400 {
        let mut copy = buf.clone();
        // only the tree, never the signature: a broken signature is already refused
        let flips = 1 + random.below(3);
        for _ in 0..flips {
            let at = 12 + random.below(copy.len() - 12);
            copy[at] = random.below(256) as u8;
        }
        for (name, walker) in WALKERS {
            if let Some(why) = attempt(walker, &copy) {
                bad.push(format!("{name} on mutation {i}: {why}"));
            }
        }
    }
    assert!(bad.is_empty(), "{} mutation(s) escaped: {:?}", bad.len(), &bad[..bad.len().min(8)]);
}

#[test]
fn any_set_of_entries_the_writer_is_given_reads_back_exactly_byte_for_byte() {
    // empty files, files at the archive root, a few thousand bytes, up to twenty entries at once,
    // all from a seed so a failure replays exactly
    let mut random = Prng(20260916);
    const FOLDERS: [&str; 6] = [
        " ",
        "models",
        "materials/models/heroes/wisp",
        "panorama/images/heroes",
        "particles/econ/items/pudge",
        "scripts/items",
    ];
    const EXTS: [&str; 6] = ["vtex_c", "vmdl_c", "vpcf_c", "txt", "vmat_c", "vsnd_c"];
    for round in 0..60 {
        let mut want: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut files = Vec::new();
        for _ in 0..1 + random.below(20) {
            let folder = FOLDERS[random.below(FOLDERS.len())];
            let name = format!("f{}", random.below(1_000_000));
            let ext = EXTS[random.below(EXTS.len())];
            let rel = if folder == " " { format!("{name}.{ext}") } else { format!("{folder}/{name}.{ext}") };
            if want.contains_key(&rel) {
                continue;
            }
            let data: Vec<u8> = (0..random.below(3000)).map(|_| random.below(256) as u8).collect();
            files.push(Entry {
                ext: ext.into(),
                folder: folder.into(),
                name,
                crc: vpk::crc32(&data),
                preload: vpk::empty(),
                data: Arc::from(data.as_slice()),
            });
            want.insert(rel, data);
        }
        let buf = vpk::build(&files);
        let back = read_mem(&buf).unwrap();
        assert_eq!(
            sorted(back.iter().map(Entry::path).collect()),
            want.keys().cloned().collect::<Vec<_>>(),
            "round {round}: paths"
        );
        for e in &back {
            let expected = &want[&e.path()];
            assert_eq!(&*e.data, expected.as_slice(), "round {round}: {} came back different", e.path());
            assert_eq!(e.crc, crc32fast::hash(expected), "round {round}: {} has the wrong CRC", e.path());
        }
        // and the same set spread over volumes reads back the same
        let dir = Temp::new("fuzz-combine");
        let out =
            vpk::combine_to_files(&[("m".into(), buf.clone())], dir.path(), "pak05", 1 + random.below(4000)).unwrap();
        let single = vpk::merge_to_single(&dir.path().join(&out.dir)).unwrap();
        assert_eq!(vpk::fingerprint_vpk(&single).unwrap(), vpk::fingerprint_vpk(&buf).unwrap(), "round {round}");
        for e in read_mem(&single).unwrap() {
            assert_eq!(&*e.data, want[&e.path()].as_slice(), "round {round}: {} through volumes", e.path());
        }
    }
}
