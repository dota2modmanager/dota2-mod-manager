# Pressing Install did nothing

| Field | Value |
| --- | --- |
| Date | 2026-09-10 |
| Versions | 2.6.5 and 2.6.6; opening a shared preset also in 2.6.7 |
| Fixed in | 2.6.7 (Install), 2.6.8 (shared presets) |
| Impact | No mod could be installed, by anyone. The button sat on "Installing..." and nothing reached the disk. |

## What happened

On 6 September the main-process handlers were split into one file per subject, and 2.6.5 was the
first release with the split. The `mods:install` handler starts by asking whether installing has
been switched off remotely. That call moved to `ipc-mods.js`, and the `blocked` helper it calls
stayed in `ipc-game.js`. Every click threw `ReferenceError: blocked is not defined` before a byte
was downloaded.

The window awaited a promise that had already rejected and showed nothing, so a plain error looked
like a hang for two releases. Opening a preset file from another player broke the same way, one
line before the mods were switched on. The contract tests written for the Install fix found that
one, and 2.6.8 fixed it.

## Why

The split moved a call without the function it calls. JavaScript looks a name up when the line
runs, so the file loaded and every handler registered.

## Why nothing caught it

- The IPC tests read the source files as text and checked that each channel name was present. All
  of them were.
- The repository had no linter. ESLint's `no-undef` names this bug without running any code.
- No test pressed Install. The Linux job started the app against the sandbox and took a
  screenshot, and a window that cannot install looks like one that can.
- A rejected call wrote its reason to the log file and nowhere on screen.

## What catches it now

- `src/feature-gate.ts`: the remote switch has one definition, handed to every module that asks
  it, so there is no second copy to leave behind.
- `eslint.config.js` "no-undef": an undefined name in a JavaScript file fails `npm run verify` and CI.
- `tools/typecheck.mjs`: the same for the TypeScript modules, the IPC handlers among them. A name
  that is not there does not type-check, and a new type error fails `npm run verify` and CI.
- `test/ipc-handlers-run.test.ts` "every handler runs far enough to prove its own names exist":
  registers every handler for real and calls it.
- `test/ipc-contract.test.js` "every ipc module is handed everything it unpacks"
- `tools/e2e.mjs`: installs, switches off, switches on and removes a mod by clicking, and checks
  the game folder after each step. On the 2.6.6 code it stops at Install with this exact error.
- `.github/workflows/e2e.yml` "Install a mod through the window": runs it on Linux and Windows
  for every pull request, as a required check.
- `.github/workflows/release.yml` "Install a mod with the installer on the draft": a release stays
  a draft until the built installer and AppImage have both installed a mod.
