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

- `test/patcher-tree.test.ts` "an install that ships no signature list is still patched"
- `test/patcher-tree.test.ts` "an install with no list reports that, rather than reporting an
  unsigned patch": the status bar and the self-heal stop treating a missing list as a failure.
- `test/patcher-tree.test.ts` "reverting puts both files back exactly as they were": with a list
  and without one.
- `tools/sandbox.js` "Linux install in the world that had one": the sandbox writes the list only
  where the platform it runs on keeps one.
- `.github/mutants.json` "an install with no signature list is refused": the weekly mutation run
  puts the old refusal back and expects these tests to fail.
