# Updating put the removal window on screen, with boxes ticked

| Field | Value |
| --- | --- |
| Date | 2026-08-31 |
| Versions | 2.6.1 |
| Fixed in | 2.6.2 |
| Impact | Everybody who updated to 2.6.1 was shown "Remove Dota 2 Mod Manager" in the middle of the update, with deleting their mods and their settings already ticked. Nothing was deleted without confirming the window, and cancelling left everything alone. |

## What happened

2.6.1 gave the uninstaller something it had never had: a set of questions. Removing the app used
to leave the mods sitting in the game's language folder, the app's own folder behind, and, if
safe mode had been switched off, the game's `gameinfo_branchspecific.gi` and `dota.signatures`
still carrying an edit that only this program knew how to undo. So the uninstaller now starts
the app once with `--uninstall`, the app puts the questions on screen and answers with its exit
code.

An update starts that same uninstaller. electron-builder replaces a version by running the old
one first, and the app came up with the questions in front of somebody who was only updating.
The two destructive answers, delete the mods and delete the app's data, were ticked.

## Why

`customUnInit` runs in `un.onInit`, which happens for every uninstall. An update is an uninstall.
Nothing in that macro looked at why it had been started.

The trap underneath it is that the obvious test does not work. `${Silent}` cannot tell the two
apart: the one-click uninstaller turns silent mode on itself the moment the person confirms, so
by the time anything runs it is on in both cases. Only the command line separates them, and an
update's is

```
old-uninstaller.exe /S /KEEP_APP_DATA --updated _?=<dir>
```

(`app-builder-lib/templates/nsis/include/installUtil.nsh`, `uninstallOldVersion`), while the
entry in Windows' own list of installed programs passes no arguments at all.

## Why nothing caught it

- The uninstaller was checked by removing the app, which is the case that worked. Updating over
  an installed copy was never run.
- Nothing in the repository could be run against a command line at all: the decision lived as an
  expression inside `main.js`, evaluated once from `process.argv` of whatever process was
  running.
- The window is drawn by NSIS calling the app, so neither the unit tests nor the window test ever
  reach it.

## What catches it now

- `crates/mm-core/src/install/uninstall.rs`: the decision takes a command line instead of reading
  the process, and names the flags that mean an update rather than a removal.
- `crates/mm-core/src/install/uninstall.rs` "an_update_is_not_a_removal"
- `src-tauri/windows/hooks.nsh`: the installer side, which the Tauri build runs on an update.
- `renderer/uninstall.js`: deleting mods and deleting app data are no longer ticked in advance.
  Putting the game's files back still is, because a game left carrying an edit after the program
  that undoes it is gone is the one outcome nobody can fix afterwards.
- `.github/workflows/tauri-handover.yml`: runs the Tauri installer over an installed copy the way
  an update does.
