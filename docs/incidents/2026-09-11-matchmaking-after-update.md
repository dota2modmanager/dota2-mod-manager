# Matchmaking refused after a Dota update

| Field | Value |
| --- | --- |
| Date | 2026-09-11 |
| Versions | 1.12.0 to 2.6.9 |
| Fixed in | 2.6.10 |
| Impact | With mods on, the game could refuse to queue after a Dota update until the player verified the game files. The app reported the patch as on, signed and in order. |

## What happened

Dota ships a new `dota.signatures` with every build: a hash for each file the client checks, and a
DIGEST over the lot. The app appends one line for the file it edits. It built the rest of the list
from a backup taken the first time the patch was applied. On the machine where this was found, the
backup dated from 29 July, thirteen builds back: it gave `dota2.exe` a SHA-1 starting `0A281119`,
where the game's own list said `72ED2906`. After an update the app wrote the July list back, the
client measured its current files against six-week-old hashes, and refused to queue.

## Why

A copy of a file that changes with every build served as the truth for the build after it. The
list the game has on disk, minus our one line, is by construction the list this build shipped.

## Why nothing caught it

- `state()` asked only whether our own line was in the list. Patched, signed and vanilla all read
  true while the game would not queue, so it looked like a Dota bug.
- The tests covered the text transforms. None of them moved the game to a new build between two
  applies.

## What catches it now

- `crates/mm-core/src/game/patcher_tests.rs` "the_patch_is_signed_into_the_list_the_installed_build_shipped_not_an_older_one":
  patches build A, moves the game to build B, patches again, and expects B's list.
- `crates/mm-core/src/game/patcher_tests.rs` "a_backup_from_an_older_build_is_replaced_or_reverting_would_put_the_old_build_back"
- `crates/mm-core/src/game/patcher_tests.rs` "a_signature_line_is_the_path_sha1_and_little_endian_crc_the_game_expects": the expected
  line comes from a public check value, not from our own hash function.
- `.github/workflows/rust.yml`: runs the Rust tests on every push.
