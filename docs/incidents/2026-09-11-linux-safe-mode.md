# Safe mode could not be switched off on Linux

| Field | Value |
| --- | --- |
| Date | 2026-09-11 |
| Versions | 1.12.0 to 2.6.8, Linux build |
| Fixed in | 2.6.9 |
| Impact | On Linux the game could load no mod at all. The switch answered "dota.signatures not found". |

## What happened

To load mods, the app edits `gameinfo_branchspecific.gi` and, on Windows, signs that edit into
`bin/win64/dota.signatures`. `apply()` required all three files. Valve's Linux build ships
`bin/linuxsteamrt64/` with the client and forty shared libraries, and no signature list. A player
reported it with a photograph of that folder.

## Why

The patcher was written against the Windows tree. The Linux folder was a name in a table that no
test or sandbox had ever built the way Valve ships it.

## Why nothing caught it

- `test/patcher.test.ts` pinned the text transforms byte for byte and never called `apply()`,
  `state()` or `revert()`.
- The sandbox wrote a signature list into `bin/linuxsteamrt64` as well, so the Linux CI job ran
  against the only Linux install in the world that had one.

## What catches it now

- `crates/mm-core/src/game/patcher_tests.rs` "an_install_with_no_signature_list_is_still_patched_and_says_it_cannot_be_signed": the
  status bar and the self-heal stop treating a missing list as a failure.
- `crates/mm-core/src/game/patcher_tests.rs` "reverting_puts_both_files_back_exactly_as_they_were": with a list and without one.
- `tools/dev/sandbox.js` "Linux install in the world that had one": the sandbox writes the list only
  where the platform it runs on keeps one.
- `.github/workflows/rust.yml`: runs the Rust tests on every push.
