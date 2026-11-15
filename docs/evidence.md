# Checking what this project claims

The README and the assurance case make claims. This page is for someone who
would rather not take them on trust: each claim, the file that holds its evidence, the CI job that
runs it on every change, and the command that runs it on your own machine.

Everything below runs from a clone with Node 24 and `npm ci`. Nothing here touches a real Dota 2
install: the commands that need a game build a throwaway one first (`npm run sandbox:seed`, see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

## Correctness

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| The code does what its tests say: the Rust core's own tests beside its code, and the rest in 100 files | `crates/`, `test/` | Rust, Tests: `test` (Linux), `windows` | `cargo test -p mm-core -p mm-cli`, `npm test` |
| Malformed archives and VPK files are refused, not trusted | `crates/mm-core/src/formats/safe_zip.rs`, `crates/mm-core/src/formats/vpk.rs` | Tests | `npm run fuzz` |

## The app as people use it

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| A mod installs, switches and uninstalls through the real window, and the game folder ends byte for byte as it started | `tools/dev/e2e.mjs` presses the buttons in the real window over a sandbox game tree, with a fixed catalog so the check does not depend on the live one | Window: "Install a mod through the window", on Linux and on Windows | `npm run e2e` |
| An update keeps your mods, your favourites and your settings | `.github/workflows/tauri-handover.yml` installs the last release, uses it, runs a freshly built installer over it the way an update arrives, and checks everything is still there | Tauri handover, on pull requests that touch the path and weekly | in CI only: it installs software |

## Security

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| Every threat the project knows about has an answer and a test | [docs/assurance-case.md](assurance-case.md), a claim per threat with the test that holds it | Tests | read it, then run the tests it names |
| The window can only ask the main process for what the UI offers | `crates/mm-core/src/owner/channel_args.rs` | Tests | `npm test` |
| The packaged app takes no debugger and no other browser from the environment | `webview_switch` in `src-tauri/src/main.rs`; the `tauri` crate is built without `devtools` | Tests (the shell's, on Windows) | `cargo test -p dota2-mod-manager` |
| No known weakness pattern in the code | CodeQL; no open alerts on 2026-10-11 | CodeQL: "Analyse JavaScript and TypeScript", required | the Security tab |
| The project follows OpenSSF practice | [Scorecard](https://scorecard.dev/viewer/?uri=github.com/dota2modmanager/dota2-mod-manager), [Best Practices silver](https://www.bestpractices.dev/projects/14721); [docs/openssf-answers.md](openssf-answers.md) has the answers given | Scorecard, weekly | the links |

## The download

| Claim | Evidence | Run it yourself |
|---|---|---|
| The installer you downloaded is the one this repository's CI built | `SHA256SUMS` and a Sigstore provenance attestation on every release | `gh attestation verify Dota-2-Mod-Manager-Setup.exe --repo dota2modmanager/dota2-mod-manager` |
| You can see what ships inside it | a CycloneDX SBOM on every release, `dota2-mod-manager.cdx.json` | open it |
| What antivirus engines say about it | the VirusTotal verdict per file, written into each release's notes | the links in the notes |
| A release cannot come from a commit that skipped the checks | `tools/release/release-gate.mjs` refuses a tag outside `main` or without the release checks in `.github/required-checks.json` | read the Release workflow's first job |

## How changes get in

Every change reaches `main` through a pull request and a merge queue, and merges only when every
check in `.github/required-checks.json` is green on top of the newest `main`. [GOVERNANCE.md](GOVERNANCE.md) says who decides what, and
[DECISIONS.md](DECISIONS.md) records the decisions with their reasons.

## What none of this proves

- **The real game.** CI has no Dota 2. The sandbox is assembled from the game's own files and real
  catalog mods, so the app's side of an install is tested end to end, but whether the game then
  shows the mod is checked on a maintainer's machine (`npm run dota:bench`). The Dota updates
  workflow watches every new game build and says which catalog mods touch the files it changed.
- **Code signing.** The installer is not signed, and SmartScreen says so. The attestation above is
  what stands in for it; [the code-signing policy](code-signing-policy.md) says what would change.
