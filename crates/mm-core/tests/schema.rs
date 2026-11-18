//! The item table (items_game.txt) through the public API of `mm_core::schema`: reading it,
//! merging mods' blocks into it, refusing a table that would not load, its exact bytes, and what
//! the deploy writes into a throwaway game folder.
//!
//! items_game.txt is the one file the app rewrites that the client parses itself. A malformed
//! result kills the game on load with ERROR PARSING SCRIPT, and a merge that drops blocks
//! silently removes cosmetics people paid for, so both are pinned here.
//!
//! Replaces test/schema.test.ts, test/schema-bytes.test.ts and the parts of
//! test/schema-service.test.ts that do not need a whole installer, library and patched game.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use mm_core::kv;
use mm_core::schema::{self, SchemaItem};
use mm_core::schema_deploy::{self, SCHEMA_VPK};
use mm_core::schema_merge::{self, Applied, Conflict, MergeError, Patch};
use mm_core::vpk;
use serde_json::json;

// ---------------------------------------------------------------- tables to work on

fn item(id: &str, name: &str) -> String {
    format!("\t\t\"{id}\"\n\t\t{{\n\t\t\t\"name\"\t\t\"{name}\"\n\t\t\t\"prefab\"\t\t\"default_item\"\n\t\t}}\n")
}

fn table_of(ids: &[(String, String)]) -> Vec<u8> {
    let body: String = ids.iter().map(|(id, name)| item(id, name)).collect();
    format!("\"items_game\"\n{{\n\t\"items\"\n\t{{\n{body}\t}}\n}}\n").into_bytes()
}

/// A small but structurally real items_game.txt.
fn small() -> Vec<u8> {
    table_of(&[("1".into(), "One".into()), ("2".into(), "Two".into()), ("3".into(), "Three".into())])
}

/// Big enough to clear validate's "did we just lose the whole table" floor.
fn large(count: usize) -> Vec<u8> {
    let ids: Vec<(String, String)> = (1..=count).map(|i| (i.to_string(), format!("Item {i}"))).collect();
    table_of(&ids)
}

fn patch(id: &str, block: &str, source: &str) -> Patch {
    Patch { id: id.into(), block: block.as_bytes().to_vec(), source: source.into() }
}

fn has(hay: &[u8], needle: &str) -> bool {
    has_bytes(hay, needle.as_bytes())
}

fn has_bytes(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

fn applied(id: &str, source: &str) -> Applied {
    Applied { id: id.into(), source: source.into() }
}

fn names(text: &[u8]) -> Vec<(String, String)> {
    schema::list_items(text).unwrap().into_iter().map(|i| (i.id, i.name)).collect()
}

fn find_text(text: &[u8], id: &str) -> Option<Vec<u8>> {
    schema::find_item(text, id, None).unwrap().map(|(s, e)| text[s..e].to_vec())
}

/// A folder under the system temp dir, gone when the test ends.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("mm-schema-test-{label}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A game folder whose pak01 carries this items_game.txt.
fn game_with(label: &str, text: &[u8]) -> TempDir {
    let dir = TempDir::new(label);
    std::fs::create_dir_all(dir.0.join("dota")).unwrap();
    std::fs::write(dir.0.join("dota").join("pak01_dir.vpk"), schema_deploy::build_schema_vpk(text, &[])).unwrap();
    dir
}

/// Deploy as the TypeScript `schema.deploy` did: the base read from the game itself.
fn deploy(game: &Path, patches: &[Patch], assets: &[&[vpk::Entry]]) -> Result<schema_deploy::Deployed, String> {
    let (base, stamp) = schema::read_game_schema(game)?;
    schema_deploy::deploy(game, "dota_mods", patches, assets, (&base, &stamp), &|| false)
        .map(|d| d.expect("nothing asked the build to stop"))
}

fn listing(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> =
        std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    out.sort();
    out
}

// ---------------------------------------------------------------- reading (schema.test.ts)

#[test]
fn every_item_in_the_table_is_listed() {
    assert_eq!(schema::list_items(&small()).unwrap().len(), 3);
    assert_eq!(schema::list_items(&large(1200)).unwrap().len(), 1200);
}

#[test]
fn an_item_is_found_by_id_and_a_missing_one_reports_missing_rather_than_failing() {
    let text = small();
    let hit = find_text(&text, "2").expect("id 2 exists");
    assert!(has(&hit, "\"Two\""));
    assert_eq!(schema::find_item(&text, "9999", None).unwrap(), None);
}

#[test]
fn comments_and_bare_words_are_read_the_way_the_game_reads_them() {
    let text = [
        "// written by a tool",
        "\"items_game\"",
        "{",
        "\t// the items",
        "\t\"items\"",
        "\t{",
        "\t\t\"7\"",
        "\t\t{",
        "\t\t\tname\tBare\t\t// a bare key and value",
        "\t\t\t\"prefab\"\t\"default_item\"",
        "\t\t}",
        "\t}",
        "}",
        "",
    ]
    .join("\n");
    let text = text.as_bytes();
    let items = schema::list_items(text).unwrap();
    assert_eq!(items[0].name, "Bare");
    let (start, _) = schema::find_item(text, "7", None).unwrap().expect("item 7");
    assert_eq!(
        schema::item_fields(text, start).unwrap(),
        [("name".to_string(), "Bare".to_string()), ("prefab".to_string(), "default_item".to_string())]
    );
}

#[test]
fn a_comment_that_runs_to_the_end_of_the_file_ends_the_walk_instead_of_reading_past_it() {
    let cut = b"\"items_game\"\n{\n\"items\"\n{\n\"1\"\n{\n\"name\" \"x\" // no newline after this}}}";
    assert_eq!(schema::list_items(cut).unwrap()[0].name, "x");
}

#[test]
fn a_block_that_never_closes_is_refused_by_name() {
    let err = schema::list_items(b"\"items_game\"\n{\n\t\"items\"\n\t{\n\t\t\"1\"\n\t\t{\n").unwrap_err();
    assert!(err.to_string().contains("items_game"), "{err}");
}

#[test]
fn a_bundle_lists_the_items_it_holds() {
    let text = String::from_utf8(table_of(&[("1".into(), "Stock".into())])).unwrap().replace(
        "\t}\n}",
        "\t\t\"20010\"\n\t\t{\n\t\t\t\"name\"\t\t\"Garments Set\"\n\t\t\t\"prefab\"\t\t\"bundle\"\n\t\t\t\"bundle\"\n\t\t\t{\n\t\t\t\t\"Garments Head\"\t\t\"1\"\n\t\t\t\t\"Garments Arms\"\t\t\"1\"\n\t\t\t\t\"Not in it\"\t\t\"0\"\n\t\t\t}\n\t\t}\n\t}\n}",
    );
    let items = schema::list_items(text.as_bytes()).unwrap();
    let set = items.iter().find(|i| i.id == "20010").expect("the set");
    assert_eq!(set.bundle_items, ["Garments Head", "Garments Arms"]);
}

#[test]
fn the_item_list_stays_right_when_two_tables_are_read_in_turn() {
    // A rebuild alternates between the game's table and the merged one, and the parsed lists are
    // cached: the danger is handing back the other table's list.
    let game = [
        "\"items_game\"",
        "{",
        "  \"items\"",
        "  {",
        "    \"1\"",
        "    {",
        "      \"name\"",
        "\"only_in_game\"",
        "    }",
        "    \"2\"",
        "    {",
        "      \"name\"",
        "\"in_both\"",
        "    }",
        "  }",
        "}",
    ]
    .join("\n");
    let merged = game.replace("\"only_in_game\"", "\"renamed_in_merged\"");
    let (game, merged) = (game.as_bytes(), merged.as_bytes());
    let name_of = |list: &[SchemaItem]| list.iter().find(|i| i.id == "1").unwrap().name.clone();

    let a1 = schema::items_of(game).unwrap();
    let b1 = schema::items_of(merged).unwrap();
    let b2 = schema::items_of(merged).unwrap();
    let a2 = schema::items_of(game).unwrap();
    assert_eq!(name_of(&a1), "only_in_game");
    assert_eq!(name_of(&b1), "renamed_in_merged");
    assert_eq!(name_of(&a2), "only_in_game", "the game table came back as the merged one");
    assert_eq!(name_of(&b2), "renamed_in_merged");

    // the lookup by id answers off a kept list too, and has to be right about which table it read
    let by_game = schema_merge::items_by_id(game).unwrap();
    let by_merged = schema_merge::items_by_id(merged).unwrap();
    let (s, e) = by_game.find(game, "1").unwrap().unwrap();
    assert!(has(&game[s..e], "only_in_game"));
    let (s, e) = by_merged.find(merged, "1").unwrap().unwrap();
    assert!(has(&merged[s..e], "renamed_in_merged"));
    assert_eq!(schema_merge::items_by_id(game).unwrap().find(game, "404").unwrap(), None);
}

#[test]
fn the_walk_skips_exactly_the_bytes_a_regular_expression_calls_space() {
    // /\s/ on a latin1 string: tab to carriage return, space, and the non-breaking space
    for c in 0u8..=255 {
        if c == b'/' {
            continue; // a comment's first half, not a space
        }
        let want = usize::from(c == b' ' || (9..=13).contains(&c) || c == 0xa0);
        assert_eq!(kv::skip_gap(&[c, b'x'], 0), want, "byte {c:#04x}");
    }
    assert_eq!(kv::skip_gap(b"  // a comment\n\t\"key\"", 0), 16, "a comment is a gap too");
}

#[test]
fn counting_the_items_is_listing_them_and_a_merge_of_many_patches_is_the_same_table_as_merging_them_one_at_a_time() {
    let block = |id: usize, i: usize| {
        format!("\t\t\"{id}\"\n\t\t{{\n\t\t\t\"name\"\t\t\"Item {i}\"\n\t\t\t\"visuals\"\n\t\t\t{{\n\t\t\t\t\"asset_modifier\" {{ \"type\" \"particle\" }}\n\t\t\t}}\n\t\t}}")
    };
    let mut lines = vec![
        "\"items_game\"".to_string(),
        "{".into(),
        "\t\"items\"".into(),
        "\t{".into(),
        "\t\t\"default\" { \"name\" \"not a number\" }".into(),
    ];
    lines.extend((0..1200).map(|i| block(100 + i, i)));
    lines.extend(["\t}".to_string(), "}".into(), String::new()]);
    let text = lines.join("\n").into_bytes();

    assert_eq!(schema::count_items(&text).unwrap(), schema::list_items(&text).unwrap().len());
    let mut spaced = text.clone();
    spaced.push(b' ');
    assert_eq!(schema::count_items(&spaced).unwrap(), 1200);
    let (s, _) = schema::find_item(&text, "default", None).unwrap().expect("a key that is not a number");
    assert!(text[s..].starts_with(b"\"default\""));
    assert!(has(&find_text(&text, "1250").unwrap(), "Item 1150"));

    let patches: Vec<Patch> = ["150", "120", "1290", "100", "777"]
        .iter()
        .map(|id| patch(id, &format!("\"{id}\"\n{{\n\t\"name\"\t\t\"Patched {id}\"\n}}"), id))
        .collect();
    let once = schema_merge::merge(&text, &patches).unwrap().text;
    let mut one_by_one = text.clone();
    for p in &patches {
        one_by_one = schema_merge::merge(&one_by_one, std::slice::from_ref(p)).unwrap().text;
    }
    assert_eq!(once, one_by_one);
    assert!(has(&once, "\"Patched 1290\""));
    assert_eq!(schema::count_items(&once).unwrap(), 1200);
}

// ---------------------------------------------------------------- merging (schema.test.ts)

#[test]
fn a_block_replaces_the_item_with_that_id_and_leaves_its_neighbours_untouched() {
    let block = "\"2\"\n{\n\t\"name\"\t\t\"Replaced\"\n\t\"prefab\"\t\t\"default_item\"\n}";
    let out = schema_merge::merge(&small(), &[patch("2", block, "mod A")]).unwrap();
    assert_eq!(out.applied, [applied("2", "mod A")]);
    assert!(out.missing.is_empty());
    assert!(out.conflicts.is_empty());
    assert!(has(&out.text, "\"Replaced\""));
    assert!(!has(&out.text, "\"Two\""), "the old block is gone");
    assert!(has(&out.text, "\"One\"") && has(&out.text, "\"Three\""), "neighbours survive");
    assert_eq!(schema::list_items(&out.text).unwrap().len(), 3, "no item is lost or duplicated");
}

#[test]
fn several_blocks_all_land_not_just_the_last_one() {
    // spliced from the tail so earlier offsets stay valid; head-first would corrupt every later edit
    let block = |id: &str, name: &str| format!("\"{id}\"\n{{\n\t\"name\"\t\t\"{name}\"\n}}");
    let out =
        schema_merge::merge(&small(), &[patch("1", &block("1", "First"), "a"), patch("3", &block("3", "Third"), "b")])
            .unwrap();
    assert_eq!(out.applied.len(), 2);
    assert!(has(&out.text, "\"First\""));
    assert!(has(&out.text, "\"Third\""));
    assert!(has(&out.text, "\"Two\""), "the untouched item is still there");
    assert_eq!(schema::list_items(&out.text).unwrap().len(), 3);
}

#[test]
fn a_block_for_an_item_the_game_does_not_have_is_reported_not_invented() {
    let out = schema_merge::merge(&small(), &[patch("4242", "\"4242\"\n{\n}", "mod")]).unwrap();
    assert_eq!(out.missing, ["4242"]);
    assert!(out.applied.is_empty());
    assert_eq!(schema::list_items(&out.text).unwrap().len(), 3);
}

#[test]
fn the_same_block_shipped_by_two_mods_is_not_a_conflict() {
    // Skinchanger bakes the whole cart into every export, so identical copies are the norm
    let block = "\"2\"\n{\n\t\"name\"\t\t\"Shared\"\n}";
    let out = schema_merge::merge(
        &small(),
        &[patch("2", block, "mod A"), patch("2", &block.replace("\n\t", "\n \t "), "mod B")],
    )
    .unwrap();
    assert!(out.conflicts.is_empty(), "whitespace-only differences are the same block");
    assert_eq!(out.applied.len(), 1);
}

#[test]
fn two_mods_changing_one_item_differently_is_reported_as_a_conflict() {
    let out = schema_merge::merge(
        &small(),
        &[
            patch("2", "\"2\"\n{\n\t\"name\"\t\t\"From A\"\n}", "mod A"),
            patch("2", "\"2\"\n{\n\t\"name\"\t\t\"From B\"\n}", "mod B"),
        ],
    )
    .unwrap();
    assert_eq!(out.conflicts, [Conflict { id: "2".into(), a: "mod A".into(), b: "mod B".into() }]);
    assert!(has(&out.text, "\"From B\""), "the later patch wins");
}

#[test]
fn merging_nothing_changes_nothing() {
    let base = small();
    assert_eq!(schema_merge::merge(&base, &[]).unwrap().text, base);
}

// ---------------------------------------------------------------- validating (schema.test.ts)

#[test]
fn a_well_formed_table_of_the_right_size_passes_validation() {
    let text = large(1200);
    assert_eq!(schema_merge::validate(&text, None).unwrap(), (1200, text.len()));
}

#[test]
fn an_unbalanced_block_is_refused_instead_of_shipped() {
    let mut open = large(1200);
    open.push(b'{');
    assert_eq!(schema_merge::validate(&open, None), Err(MergeError::Unclosed));

    let text = String::from_utf8(large(1200)).unwrap().replacen("}\n", "", 1);
    assert!(schema_merge::validate(text.as_bytes(), None).is_err());

    let mut close = b"}".to_vec();
    close.extend(large(1200));
    assert_eq!(schema_merge::validate(&close, None), Err(MergeError::ExtraClose));
}

#[test]
fn an_unclosed_quote_is_refused() {
    let mut text = large(1200);
    text.extend_from_slice(b"\"oops");
    assert_eq!(schema_merge::validate(&text, None), Err(MergeError::Quote));
}

#[test]
fn a_table_that_lost_most_of_its_items_is_refused() {
    // a merge that empties the table makes a file the game loads happily, every cosmetic gone
    assert_eq!(schema_merge::validate(&small(), None), Err(MergeError::TooFew(3)));
}

#[test]
fn a_table_smaller_than_the_game_shipped_is_refused_even_when_it_is_large() {
    let base = large(1300);
    let shrunk = large(1200);
    assert!(schema_merge::validate(&shrunk, None).is_ok(), "fine on its own");
    assert_eq!(schema_merge::validate(&shrunk, Some(&base)), Err(MergeError::FewerThanGame(1200, 1300)));
}

#[test]
fn merging_into_a_real_sized_table_keeps_it_valid() {
    let base = large(1200);
    let out = schema_merge::merge(&base, &[patch("500", "\"500\"\n{\n\t\"name\"\t\t\"Patched\"\n}", "mod")]).unwrap();
    assert_eq!(out.applied.len(), 1);
    assert!(schema_merge::validate(&out.text, Some(&base)).is_ok());
}

// ---------------------------------------------------------------- what counts as the mod's

fn with_model(id: &str, name: &str, model: &str) -> String {
    format!(
        "\t\t\"{id}\"\n\t\t{{\n\t\t\t\"name\"\t\t\"{name}\"\n\t\t\t\"prefab\"\t\t\"default_item\"\n\t\t\t\"model_player\"\t\t\"{model}\"\n\t\t}}\n"
    )
}

fn table(blocks: &[String]) -> Vec<u8> {
    format!("\"items_game\"\n{{\n\t\"items\"\n\t{{\n{}\t}}\n}}\n", blocks.concat()).into_bytes()
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn a_block_naming_a_file_the_mod_ships_is_lifted() {
    let m = table(&[with_model("1", "Changed", "models/heroes/tinker/tinker_helmet.vmdl")]);
    let base = table(&[with_model("1", "Stock", "models/heroes/tinker/tinker_cape.vmdl")]);
    let out =
        schema_merge::extract_deltas(&m, &paths(&["models/heroes/tinker/tinker_helmet.vmdl_c"]), Some(&base)).unwrap();
    assert_eq!(out.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["1"]);
    assert_eq!(out[0].name, "Changed");
}

#[test]
fn a_block_pointing_a_slot_at_a_valve_model_the_mod_repaints_is_lifted_too() {
    // the cape slot redirected to Valve's Deep Sea Robot back, the mod shipping only its materials
    let m = table(&[with_model(
        "467",
        "Tinker's Cape",
        "models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmdl",
    )]);
    let base = table(&[with_model("467", "Tinker's Cape", "models/heroes/tinker/tinker_cape.vmdl")]);
    let shipped = paths(&["materials/models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmat_c"]);
    let out = schema_merge::extract_deltas(&m, &shipped, Some(&base)).unwrap();
    assert_eq!(out.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["467"]);
}

#[test]
fn a_block_about_an_item_the_mod_never_touches_is_left_alone() {
    let m = table(&[with_model("99", "Someone else", "models/items/pudge/pudge_hook/pudge_hook.vmdl")]);
    let base = table(&[with_model("99", "Someone else", "models/heroes/pudge/pudge_weapon.vmdl")]);
    let shipped = paths(&["materials/models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmat_c"]);
    assert!(schema_merge::extract_deltas(&m, &shipped, Some(&base)).unwrap().is_empty());
}

#[test]
fn a_block_that_matches_the_game_byte_for_byte_is_not_a_delta() {
    let same = table(&[with_model("1", "Stock", "models/heroes/tinker/tinker_helmet.vmdl")]);
    let shipped = paths(&["models/heroes/tinker/tinker_helmet.vmdl_c"]);
    assert!(schema_merge::extract_deltas(&same, &shipped, Some(&same)).unwrap().is_empty());
}

#[test]
fn a_block_belongs_to_a_mod_only_when_it_names_a_file_that_mod_ships() {
    let block = b"\"visuals\" { \"model_player\" \"models/heroes/axe/axe_arcana.vmdl\" }";
    assert!(schema_merge::block_uses_assets(block, &paths(&["models/heroes/axe/axe_arcana.vmdl_c"])));
    assert!(!schema_merge::block_uses_assets(block, &paths(&["models/heroes/lina/lina_arcana.vmdl_c"])));
}

#[test]
fn a_mods_lifted_blocks_travel_as_a_table_the_game_can_read_back() {
    let one: &[u8] = b"\"1\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"Lifted\"\r\n\t\t}";
    let two: &[u8] = b"\"2\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"Also lifted\"\r\n\t\t}";
    let t = schema_merge::delta_table(&[one, two]);
    assert_eq!(names(&t), [("1".to_string(), "Lifted".to_string()), ("2".to_string(), "Also lifted".to_string())]);
    assert!(t.starts_with(b"\"items_game\"\r\n{\r\n\t\"items\"\r\n\t{\r\n\t\t\"1\""), "CRLF, as the game's own");
    assert!(t.ends_with(b"\r\n\t}\r\n}\r\n"));
    assert!(names(&schema_merge::delta_table(&[])).is_empty());
}

// ---------------------------------------------------------------- the free-cosmetics picker

/// The weather table, CRLF as the game ships it.
fn weather() -> Vec<u8> {
    [
        "\"items_game\"",
        "{",
        "\t\"items\"",
        "\t{",
        "\t\t\"555\"",
        "\t\t{",
        "\t\t\t\"name\"\t\t\"Default Weather\"",
        "\t\t\t\"prefab\"\t\t\"weather\"",
        "\t\t\t\"baseitem\"\t\t\"1\"",
        "\t\t}",
        "\t\t\"4000\"",
        "\t\t{",
        "\t\t\t\"name\"\t\t\"Weather Snow\"",
        "\t\t\t\"prefab\"\t\t\"weather\"",
        "\t\t\t\"visuals\"",
        "\t\t\t{",
        "\t\t\t\t\"asset_modifier\"",
        "\t\t\t\t{",
        "\t\t\t\t\t\"type\"\t\t\"particle_snapshot\"",
        "\t\t\t\t}",
        "\t\t\t\t\"styles\"",
        "\t\t\t\t{",
        "\t\t\t\t\t\"1\"",
        "\t\t\t\t\t{",
        "\t\t\t\t\t\t\"unlock\"",
        "\t\t\t\t\t\t{",
        "\t\t\t\t\t\t\t\"price\"\t\t\"100\"",
        "\t\t\t\t\t\t}",
        "\t\t\t\t\t}",
        "\t\t\t\t}",
        "\t\t\t}",
        "\t\t}",
        "\t\t\"4002\"",
        "\t\t{",
        // the table is bytes: a UTF-8 name arrives as its raw bytes
        "\t\t\t\"name\"\t\t\"Weather Café\"",
        "\t\t\t\"prefab\"\t\t\"weather\"",
        "\t\t\t\"visuals\"",
        "\t\t\t{",
        "\t\t\t\t\"skin\"\t\t\"2\"",
        "\t\t\t}",
        "\t\t}",
        "\t\t\"4003\"",
        "\t\t{",
        "\t\t\t\"name\"\t\t\"Weather Without Looks\"",
        "\t\t\t\"prefab\"\t\t\"weather\"",
        "\t\t}",
        "\t\t\"5000\"",
        "\t\t{",
        "\t\t\t\"name\"\t\t\"A Hat\"",
        "\t\t\t\"prefab\"\t\t\"wearable\"",
        "\t\t\t\"item_slot\"\t\t\"head\"",
        "\t\t\t\"visuals\"",
        "\t\t\t{",
        "\t\t\t}",
        "\t\t}",
        "\t}",
        "}",
        "",
    ]
    .join("\r\n")
    .into_bytes()
}

fn options(items: &[SchemaItem], slot: &str) -> Vec<(String, String)> {
    schema::cosmetic_options(items, slot)
}

#[test]
fn the_free_cosmetics_picker_offers_what_the_installed_game_has_for_that_slot() {
    let items = schema::list_items(&weather()).unwrap();
    assert_eq!(schema::base_item_for(&items, "weather").unwrap().id, "555");
    assert!(schema::base_item_for(&items, "head").is_none(), "no base item, no picker");
    assert_eq!(
        options(&items, "weather"),
        [("4002".to_string(), "Weather Café".to_string()), ("4000".to_string(), "Weather Snow".to_string())],
        "the base item and an item with no visuals are not options; names are shown as UTF-8"
    );
    assert_eq!(options(&items, "head"), [("5000".to_string(), "A Hat".to_string())]);
}

#[test]
fn a_base_item_is_dressed_in_another_items_visuals_without_the_paid_style_gates() {
    let text = weather();
    let block = schema_merge::base_item_patch(&text, "555", "4000").unwrap();
    assert!(block.starts_with(b"\"555\""));
    assert!(has(&block, "\"asset_modifier\""));
    assert!(!has(&block, "\"unlock\""), "a locked style on a base item is a button that does nothing");
    assert!(!has(&block, "\"price\""));

    let block_str = String::from_utf8(block).unwrap();
    let dressed = schema_merge::merge(&text, &[patch("555", &block_str, "")]).unwrap().text;
    let items = schema::list_items(&dressed).unwrap();
    assert!(items.iter().find(|i| i.id == "555").unwrap().has_visuals);
    // once dressed, the base item has visuals of its own, and is still not an option for itself
    let ids: Vec<String> = options(&items, "weather").into_iter().map(|o| o.0).collect();
    assert_eq!(ids, ["4002", "4000"]);

    // dressing it again replaces the visuals rather than stacking a second block
    let again = schema_merge::base_item_patch(&dressed, "555", "4002").unwrap();
    let again = String::from_utf8(again).unwrap();
    assert_eq!(again.matches("\"visuals\"").count(), 1, "one visuals block");
    assert!(again.contains("\"skin\"") && !again.contains("\"asset_modifier\""));
}

#[test]
fn dressing_a_base_item_names_what_is_missing() {
    let text = weather();
    assert_eq!(schema_merge::base_item_patch(&text, "9", "4000"), Err(MergeError::NoItem("9".into())));
    assert_eq!(schema_merge::base_item_patch(&text, "555", "9"), Err(MergeError::NoItem("9".into())));
    let err = schema_merge::base_item_patch(&text, "555", "4003").unwrap_err();
    assert_eq!(err, MergeError::NoVisuals("4003".into()));
    assert!(err.to_string().contains("4003"));
}

#[test]
fn an_item_that_names_its_slot_is_in_that_slot_and_a_wearable_that_names_none_is_a_weapon() {
    // the "wearable" and "default_item" prefabs both say "item_slot" "weapon" in items_game, and
    // thousands of items lean on that; guessing from the name put a wand on the head
    let it = |slot: &str, prefab: &str, name: &str| SchemaItem {
        slot: slot.into(),
        prefab: prefab.into(),
        name: name.into(),
        ..Default::default()
    };
    assert_eq!(schema::inferred_item_slot(&it("head", "wearable", "")), "head");
    assert_eq!(schema::inferred_item_slot(&it("", "wearable", "Oblivion Headmaster Wand")), "weapon");
    assert_eq!(schema::inferred_item_slot(&it("", "default_item", "")), "weapon");
    assert_eq!(schema::inferred_item_slot(&it("", "courier", "")), "", "a courier is in no hero slot at all");
    assert_eq!(schema::inferred_item_slot(&SchemaItem::default()), "");
}

// ---------------------------------------------------------------- bytes (schema-bytes.test.ts)

/// A table whose ids are prefixes of each other, which is the trap.
fn collision_table() -> Vec<u8> {
    [
        "\"items_game\"",
        "{",
        "\t\"items\"",
        "\t{",
        "\t\t\"12\"\n\t\t{\n\t\t\t\"name\"\t\t\"twelve\"\n\t\t}",
        "\t\t\"123\"\n\t\t{\n\t\t\t\"name\"\t\t\"one two three\"\n\t\t}",
        "\t\t\"1234\"\n\t\t{\n\t\t\t\"name\"\t\t\"one two three four\"\n\t\t}",
        "\t}",
        "}",
        "",
    ]
    .join("\n")
    .into_bytes()
}

#[test]
fn an_id_that_is_the_start_of_another_id_still_finds_its_own_block() {
    // the lazy way to find item 12 is to look for "12", which is inside "123" and "1234" too
    let text = collision_table();
    for (id, name) in [("12", "twelve"), ("123", "one two three"), ("1234", "one two three four")] {
        let found = find_text(&text, id).unwrap_or_else(|| panic!("no block for {id}"));
        assert!(has(&found, &format!("\"{name}\"")), "id {id} matched the wrong block");
        assert!(found.starts_with(format!("\"{id}\"").as_bytes()), "block for {id} does not open with that id");
        let by_id = schema_merge::items_by_id(&text).unwrap();
        let (s, e) = by_id.find(&text, id).unwrap().unwrap();
        assert_eq!(text[s..e], found[..], "the lookup by id agrees with the walk for {id}");
    }
}

#[test]
fn an_id_the_table_does_not_have_is_missing_not_the_nearest_thing_to_it() {
    let text = collision_table();
    assert_eq!(schema::find_item(&text, "99", None).unwrap(), None);
    assert_eq!(schema::find_item(&text, "1", None).unwrap(), None, "a prefix of three real ids is not an id");
    assert_eq!(schema::find_item(&text, "12345", None).unwrap(), None);
}

#[test]
fn listing_sees_each_of_them_once_in_the_order_the_file_has_them() {
    let ids: Vec<String> = schema::list_items(&collision_table()).unwrap().into_iter().map(|i| i.id).collect();
    assert_eq!(ids, ["12", "123", "1234"]);
}

const BYTES_BASE: &str =
    "\"items_game\"\n{\n\t\"items\"\n\t{\n\t\t\"12\"\n\t\t{\n\t\t\t\"name\"\t\t\"vanilla\"\n\t\t}\n\t}\n}\n";

fn merged(block: &[u8]) -> schema_merge::Merged {
    let p = Patch { id: "12".into(), block: block.to_vec(), source: "mod".into() };
    schema_merge::merge(BYTES_BASE.as_bytes(), &[p]).unwrap()
}

#[test]
fn a_block_a_text_editor_gave_crlf_endings_still_lands() {
    let r = merged(b"\"12\"\r\n{\r\n\t\"name\"\t\t\"patched\"\r\n}");
    assert_eq!(r.applied.len(), 1);
    assert!(has(&r.text, "\"patched\""));
    assert!(!has(&r.text, "vanilla"));
    assert_eq!(names(&r.text), [("12".to_string(), "patched".to_string())]);
}

#[test]
fn a_spliced_block_is_written_with_crlf_endings_and_the_tables_indent() {
    // a one-line export (Skinchanger's) is re-indented the way the game's own table is
    let r = merged(b"\"12\" { \"name\" \"patched\" \"visuals\" { \"skin\" \"1\" } }");
    let want = "\t\t\"12\"\r\n\t\t{\r\n\t\t\t\"name\"\t\t\"patched\"\r\n\t\t\t\"visuals\"\r\n\t\t\t{\r\n\t\t\t\t\"skin\"\t\t\"1\"\r\n\t\t\t}\r\n\t\t}\n\t}\n}\n";
    assert!(r.text.ends_with(want.as_bytes()), "{:?}", String::from_utf8_lossy(&r.text));
    assert!(r.text.starts_with(b"\"items_game\"\n{\n\t\"items\"\n\t{\n"), "the game's own bytes around it are kept");
}

#[test]
fn a_byte_order_mark_in_front_of_a_block_does_not_stop_it_landing() {
    // editors on Windows add one without asking, before the opening quote
    let r = merged(b"\xef\xbb\xbf\"12\"\n{\n\t\"name\"\t\t\"patched\"\n}");
    assert_eq!(r.applied.len(), 1, "a leading BOM must not lose the block");
    assert!(has(&r.text, "\"patched\""));
}

#[test]
fn what_a_mod_ships_is_written_through_byte_for_byte_oddities_included() {
    // latin1 in, latin1 out: the real table is ~50 MB with non-UTF-8 bytes in it, and a round
    // trip through a "cleaner" representation is how those get mangled. A curly quote or a
    // non-breaking space reaches the engine as the author wrote it, by decision.
    let smart = merged("\"12\"\n{\n\t\"name\"\t\t“patched”\n}".as_bytes());
    assert!(has(&smart.text, "“patched”"), "curly quotes survive unchanged");

    let nbsp = merged(b"\"12\"\n{\n\t\"name\"\t\t\"pat\xa0ched\"\n}");
    assert!(has_bytes(&nbsp.text, b"pat\xa0ched"), "a latin1 non-breaking space survives unchanged");

    let utf8 = merged("\"12\"\n{\n\t\"name\"\t\t\"pat\u{a0}ched Café\"\n}".as_bytes());
    assert!(has(&utf8.text, "pat\u{a0}ched Café"), "UTF-8 bytes survive unchanged");
    assert_eq!(schema::to_utf8(&schema::list_items(&utf8.text).unwrap()[0].name), "pat\u{a0}ched Café");
}

#[test]
fn the_same_block_from_two_mods_is_one_edit_whatever_whitespace_they_used() {
    let r = schema_merge::merge(
        BYTES_BASE.as_bytes(),
        &[
            patch("12", "\"12\"\n{\n\t\"name\"\t\t\"patched\"\n}", "mod A"),
            patch("12", "\"12\"\r\n{\r\n    \"name\"  \"patched\"\r\n}", "mod B"),
        ],
    )
    .unwrap();
    assert!(r.conflicts.is_empty(), "the same block written two ways is not two mods disagreeing");
}

// ---------------------------------------------------------------- into the game (schema.test.ts)

#[test]
fn the_built_table_is_written_into_the_mod_folder_read_back_the_same_and_taken_away_again() {
    let base = large(1200);
    let g = game_with("deploy", &base);
    let game = &g.0;
    let block = "\"2\"\r\n{\r\n\t\"name\"\t\t\"Patched\"\r\n\t\"prefab\"\t\t\"default_item\"\r\n}";

    let out = deploy(game, &[patch("2", block, "a mod")], &[]).unwrap();
    assert_eq!(out.applied, [applied("2", "a mod")]);
    assert_eq!(out.items, 1200);
    assert_eq!(out.stamp, schema::read_game_schema(game).unwrap().1);
    assert!(schema_deploy::is_deployed(game, "dota_mods"));

    let (text, _) = vpk::read_entry_file(&game.join("dota_mods").join(SCHEMA_VPK), schema::SCHEMA_REL)
        .unwrap()
        .expect("no table in the built pak");
    assert_eq!(out.bytes, text.len());
    assert!(has(&text, "\"Patched\""));
    assert_eq!(schema::list_items(&text).unwrap().len(), 1200);
    let expected = schema_merge::merge(&base, &[patch("2", block, "a mod")]).unwrap().text;
    assert_eq!(text, expected, "the pak holds the merge, byte for byte");
    assert_eq!(listing(&game.join("dota_mods")), [SCHEMA_VPK], "no temporary file left behind");

    // the engine drops empty folders into every path it mounts; those do not keep ours alive
    std::fs::create_dir_all(game.join("dota_mods").join("rpt").join("server")).unwrap();
    schema_deploy::undeploy(game, "dota_mods").unwrap();
    assert!(!schema_deploy::is_deployed(game, "dota_mods"));
    assert!(!game.join("dota_mods").exists());
    schema_deploy::undeploy(game, "dota_mods").unwrap(); // nothing there: nothing to do
}

/// An empty folder that will not go (held open here; on a game on C: remove_dir_all refused one
/// as in use) stays, and taking the table away does not fail on it: a build that switched to the
/// language folder's pak stopped there with "the file is in use".
#[cfg(windows)]
#[test]
fn an_empty_folder_that_will_not_go_does_not_stop_the_table_coming_off() {
    use std::os::windows::fs::OpenOptionsExt;
    let g = game_with("held", &large(1200));
    deploy(&g.0, &[], &[]).unwrap();
    let dir = g.0.join("dota_mods");
    std::fs::remove_file(dir.join(SCHEMA_VPK)).unwrap();
    // FILE_FLAG_BACKUP_SEMANTICS opens a folder; share mode 0 keeps anyone from deleting it
    let held = std::fs::OpenOptions::new().read(true).share_mode(0).custom_flags(0x0200_0000).open(&dir).unwrap();
    schema_deploy::undeploy(&g.0, "dota_mods").unwrap();
    assert!(dir.exists(), "the folder held open stays");
    drop(held);
    schema_deploy::undeploy(&g.0, "dota_mods").unwrap();
    assert!(!dir.exists(), "and goes once it is let go");
}

#[test]
fn taking_the_table_away_leaves_a_folder_that_holds_somebody_elses_file() {
    let g = game_with("foreign", &large(1200));
    deploy(&g.0, &[], &[]).unwrap();
    std::fs::write(g.0.join("dota_mods").join("notes.txt"), "not ours").unwrap();
    schema_deploy::undeploy(&g.0, "dota_mods").unwrap();
    assert_eq!(listing(&g.0.join("dota_mods")), ["notes.txt"]);
}

#[test]
fn a_table_that_would_not_load_is_never_written_into_the_game() {
    let g = game_with("refused", &small());
    let err = deploy(&g.0, &[], &[]).unwrap_err();
    assert!(err.contains("items_game"), "{err}");
    assert!(!g.0.join("dota_mods").join(SCHEMA_VPK).exists());
}

#[test]
fn the_games_own_table_must_be_where_the_game_keeps_it() {
    let empty = TempDir::new("nogame");
    let err = schema::read_game_schema(&empty.0).unwrap_err();
    assert!(err.contains("pak01_dir.vpk"), "{err}");

    std::fs::create_dir_all(empty.0.join("dota")).unwrap();
    let other = vpk::entry_at("scripts/other.txt", Arc::from(&b"not the item table"[..]));
    std::fs::write(empty.0.join("dota").join("pak01_dir.vpk"), vpk::build(&[other])).unwrap();
    let err = schema::read_game_schema(&empty.0).unwrap_err();
    assert!(err.contains("items_game"), "{err}");
}

#[test]
fn the_built_table_carries_the_files_the_item_builder_copies_each_once() {
    // two picks can stage the same stock path: the pak holds it once, the first copy winning
    let g = game_with("assets", &large(1200));
    let asset = |rel: &str, body: &str| vpk::entry_at(rel, Arc::from(body.as_bytes()));
    let block =
        |id: &str| format!("\"{id}\"\r\n{{\r\n\t\"name\"\t\t\"Built {id}\"\r\n\t\"prefab\"\t\t\"default_item\"\r\n}}");
    let head = [asset("models/heroes/abaddon/helmet.vmdl_c", "first")];
    let again = [
        asset("models/heroes/abaddon/helmet.vmdl_c", "second"),
        asset("models/heroes/abaddon/shoulders.vmdl_c", "shoulders"),
    ];
    deploy(&g.0, &[patch("2", &block("2"), "head"), patch("3", &block("3"), "again")], &[&head, &again]).unwrap();

    let pak = g.0.join("dota_mods").join(SCHEMA_VPK);
    let packed = vpk::read_entries(&std::fs::read(&pak).unwrap(), &pak, None).unwrap();
    assert_eq!(packed.len(), 3, "the table and two models, the shared one once");
    let body = |p: &str| packed.iter().find(|e| e.path() == p).map(|e| e.data.to_vec());
    assert_eq!(body("models/heroes/abaddon/helmet.vmdl_c").unwrap(), b"first");
    assert_eq!(body("models/heroes/abaddon/shoulders.vmdl_c").unwrap(), b"shoulders");
    assert!(body(schema::SCHEMA_REL).is_some());
}

#[test]
fn a_build_that_a_newer_one_took_over_writes_nothing() {
    let g = game_with("stopped", &large(1200));
    let (base, stamp) = schema::read_game_schema(&g.0).unwrap();
    let out = schema_deploy::deploy(&g.0, "dota_mods", &[], &[], (&base, &stamp), &|| true).unwrap();
    assert!(out.is_none());
    assert!(!g.0.join("dota_mods").exists());
}

#[test]
fn the_game_update_probe_moves_when_the_item_tables_paks_change_and_only_then() {
    let g = game_with("stamp", &large(1200));
    let dota = g.0.join("dota");
    std::fs::write(dota.join("pak01_000.vpk"), "a volume").unwrap();
    let before = mm_core::pak_stamp::game_schema_stamp(&g.0).unwrap();

    std::fs::write(dota.join("pak02_dir.vpk"), "something else entirely").unwrap();
    std::fs::write(dota.join("readme.txt"), "not a pak").unwrap();
    assert_eq!(
        mm_core::pak_stamp::game_schema_stamp(&g.0).unwrap(),
        before,
        "files that do not carry the table changed nothing"
    );

    // an update rewrites a volume and the index that holds its files' offsets and CRCs
    std::fs::write(dota.join("pak01_000.vpk"), "a volume from the next update").unwrap();
    let mut index = std::fs::read(dota.join("pak01_dir.vpk")).unwrap();
    index.extend_from_slice(&[0u8; 16]);
    std::fs::write(dota.join("pak01_dir.vpk"), index).unwrap();
    assert_ne!(mm_core::pak_stamp::game_schema_stamp(&g.0).unwrap(), before);
}

#[test]
fn a_table_that_cannot_be_moved_into_place_leaves_no_half_written_file_behind() {
    // Written to a temp file and renamed, so the game never loads half a table. The TypeScript
    // mocked a failing rename; here the place is taken by a folder the write cannot replace.
    let g = game_with("busy", &large(1200));
    let blocked = g.0.join("dota_mods").join(SCHEMA_VPK);
    std::fs::create_dir_all(blocked.join("held")).unwrap();
    assert!(deploy(&g.0, &[], &[]).is_err());
    assert_eq!(listing(&g.0.join("dota_mods")), [SCHEMA_VPK], "the temp file stayed in the mod folder");
    assert!(blocked.is_dir());
}

#[test]
fn a_write_another_run_left_half_done_is_taken_away_and_this_runs_own_is_not() {
    let g = game_with("sweep", &large(1200));
    let dir = g.0.join("dota_mods");
    std::fs::create_dir_all(&dir).unwrap();
    let mine = std::process::id();
    let theirs = format!("{SCHEMA_VPK}.{}-1.mmtmp", mine.wrapping_add(1));
    let own = format!("{SCHEMA_VPK}.{mine}-1.mmtmp");
    for f in [&theirs, &own, &"notes.txt".to_string()] {
        std::fs::write(dir.join(f), "x").unwrap();
    }
    assert_eq!(schema_deploy::sweep_unfinished(&g.0, "dota_mods", mine), 1);
    assert_eq!(listing(&dir), ["notes.txt".to_string(), own]);
}

// ---------------------------------------------------------------- the service (schema-service.test.ts)

#[test]
fn two_mods_changing_one_item_differently_are_a_conflict_and_the_same_change_twice_is_not() {
    let rifle = |model: &str| {
        json!({
            "id": "100",
            "name": "Sniper's Rifle",
            "block": format!("\"100\"\r\n{{\r\n\t\"name\"\t\t\"Sniper's Rifle\"\r\n\t\"prefab\"\t\t\"default_item\"\r\n\t\"model_player\"\t\t\"{model}\"\r\n}}"),
        })
    };
    let rec =
        |name: &str, model: &str, enabled: bool| json!({ "name": name, "enabled": enabled, "schema": [rifle(model)] });

    let both = [rec("Mod A", "models/a.vmdl", true), rec("Mod B", "models/b.vmdl", true)];
    assert_eq!(
        mm_core::schema_service::conflicts(&both),
        [json!({ "id": "100", "name": "Sniper's Rifle", "mods": ["Mod A", "Mod B"] })]
    );

    let a_off = [rec("Mod A", "models/a.vmdl", false), rec("Mod B", "models/b.vmdl", true)];
    assert!(mm_core::schema_service::conflicts(&a_off).is_empty(), "a switched-off mod argues with nobody");

    // Skinchanger bundles the whole cart into every export, so two packs often carry one block
    let same = [
        rec("Mod A", "models/a.vmdl", false),
        rec("Mod B", "models/b.vmdl", true),
        rec("Mod C", "models/b.vmdl", true),
    ];
    assert!(mm_core::schema_service::conflicts(&same).is_empty());
}

#[test]
fn the_codes_fingerprint_is_one_stamp_for_the_whole_run() {
    // The TypeScript hashed its sources; the Rust names its version (and CI's commit). A stamp
    // that moved between calls would rebuild every pick on every refresh.
    let stamp = mm_core::schema_service::builder_stamp();
    assert!(stamp.starts_with("rs-"), "{stamp}");
    assert!(stamp.contains(env!("CARGO_PKG_VERSION")));
    assert_eq!(mm_core::schema_service::builder_stamp(), stamp);
}
