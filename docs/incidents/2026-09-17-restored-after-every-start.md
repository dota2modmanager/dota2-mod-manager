# Fonts and cursors put back at every start

| Field | Value |
| --- | --- |
| Date | 2026-09-17 |
| Versions | 2.0.0 to 2.6.12 |
| Fixed in | pull request #62 |
| Impact | A font or cursor set that ships some of Valve's files unchanged was written over the game again at every start. Removing a font or cursor after such a repair could leave the mod's own files in the game folder. |

## What happened

Since 2.0.0 the app puts back fonts and cursors that Steam's "Verify integrity of game files"
replaced. It decided which ones by comparing each deployed file with the copy of the game's file
it kept at install: a match meant Valve's file was back.

Some mods ship a few of Valve's files unchanged. Nothing Font carries two of them byte for byte,
and one cursor set on a real install matched its kept copy in 66 of 110 files. Each of those mods
looked undone the moment it was installed. On the install where this was found, the log says
"restored after verify" 29 times for the same cursor set between 2 and 21 August.

The repair also rewrote the whole mod, and met the mod's own extra files still on disk. A file
with no kept copy got one at that moment, so the mod's file was kept as the game's original, and
removing the mod later put it back.

It came to light on 2026-09-17, when the first unit tests for the installer restored a font after
a simulated verify.

## Why

"Matches the kept original" stood in for "Steam put the original back". The two differ when the
mod's file and Valve's are the same bytes, and when the kept original is the mod's own file.

## Why nothing caught it

- No unit test called the verify check or the repair.
- The log line read like the feature doing its job.
- The window test installs a mod from the language folder, never a font or a cursor set.

## What catches it now

- `crates/mm-core/src/install/overlays.rs`: every font and cursor write is recorded by hash in
  `backups/written.json`. A file holding what the app wrote is the app's file, whatever else it
  matches, and the repair no longer keeps such a file as the game's original.
- `crates/mm-core/src/install/overlays_tests.rs` "a_file_the_app_wrote_itself_is_not_taken_for_one_a_verify_put_back"
- `crates/mm-core/src/install/overlays_tests.rs` "a_file_holding_valves_bytes_again_is_taken_back_by_a_verify"
- `crates/mm-core/src/install/overlays_tests.rs` "only_enabled_records_whose_files_went_back_are_reported"
- `.github/workflows/rust.yml`: runs the Rust tests on every push.
