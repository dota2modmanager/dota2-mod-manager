# Incidents

What broke for players, or came close, and what now stops it from happening again. One file per
incident, named by the day it was found.

| Found | Incident | Versions | Fixed in |
| --- | --- | --- | --- |
| 2026-08-31 | [Updating put the removal window on screen, with boxes ticked](2026-08-31-uninstaller-during-update.md) | 2.6.1 | 2.6.2 |
| 2026-09-10 | [Mods refused after the checksum check arrived](2026-09-10-downloads-refused.md) | 2.6.5 | 2.6.6 |
| 2026-09-10 | [Pressing Install did nothing](2026-09-10-install-did-nothing.md) | 2.6.5 and 2.6.6; opening a shared preset also in 2.6.7 | 2.6.7 (Install), 2.6.8 (shared presets) |
| 2026-09-11 | [Safe mode could not be switched off on Linux](2026-09-11-linux-safe-mode.md) | 1.12.0 to 2.6.8, Linux build | 2.6.9 |
| 2026-09-11 | [The update mirror carried nothing for Linux](2026-09-11-linux-update-files-missing.md) | 2.6.5 to 2.6.8 | release.yml on 2026-09-11, first used by 2.6.9 |
| 2026-09-11 | [Matchmaking refused after a Dota update](2026-09-11-matchmaking-after-update.md) | 1.12.0 to 2.6.9 | 2.6.10 |
| 2026-09-15 | [2.6.11 was built from a commit with a failing test](2026-09-15-release-from-red-commit.md) | 2.6.11 | pull request #21 (release gate) |
| 2026-09-15 | [The site built as version 0.0.0 (near miss)](2026-09-15-site-built-as-0.0.0.md) | the site, on Dependabot's Astro 7 update (pull request #12) | commit 53416db, before #12 was merged |
| 2026-09-17 | [Fonts and cursors put back at every start](2026-09-17-restored-after-every-start.md) | 2.0.0 to 2.6.12 | pull request #62 |
| 2026-09-20 | [The antivirus check never ran](2026-09-20-antivirus-check-never-ran.md) | 2.7.0 | unreleased |
## Writing one

Copy the shape of any file above: a title, a table with `Date`, `Versions`, `Fixed in` and
`Impact` (add `Issue` with the issue number when there is one), then four sections in this order.

1. **What happened**, as a player or a maintainer saw it.
2. **Why**, in a sentence or two.
3. **Why nothing caught it**: each check that existed and what it missed.
4. **What catches it now**: one bullet per guard, starting with the path in backticks. When the
   guard is one test or one workflow step, give its title in double quotes after the path.

`test/incidents.test.js` holds every file here to the repository as it is. A path that no longer
exists, a quoted test title that no test carries any more, or a file missing from the table above
fails the suite. Deleting a guard means editing its incident in the same change, and saying what
replaced it.

An issue labelled `regression` gets a file here. The radar lists a closed one that no file names
in its `Issue` row.
