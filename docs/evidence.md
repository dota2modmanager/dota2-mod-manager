# Checking what this project claims

The README, the assurance case and the accessibility page make claims. This page is for someone who
would rather not take them on trust: each claim, the file that holds its evidence, the CI job that
runs it on every change, and the command that runs it on your own machine.

Everything below runs from a clone with Node 24 and `npm ci`. Nothing here touches a real Dota 2
install: the commands that need a game build a throwaway one first (`npm run sandbox:seed`, see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

## Correctness

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| The code does what its tests say: more than 1,300 tests in 150 files | `test/` | Tests: `test` (Linux), `windows` | `npm test` |
| Coverage does not go backwards: lines 92.9%, branches 86.9%, functions 91.6% on 2026-10-11 | `.github/coverage-baseline.json`, a floor that only rises | Tests | `npm run verify` |
| The tests catch real breakage, not only run the code | 206 deliberate breakages in `.github/mutants.json`, each with the test file that has to go red | Mutants, weekly; `test/mutate.test.js` holds every entry against today's source on every push | `npm run mutate` |
| Malformed archives and VPK files are refused, not trusted | `test/safe-zip-fuzz.test.js`, `test/vpk-fuzz.test.ts` | Tests | `npm run fuzz` |
| An install interrupted at any point leaves the game folder whole | `test/file-tx-crash.test.ts` kills a child process with SIGKILL at every write in turn and checks what it left | Tests | `node --test test/file-tx-crash.test.ts` |

## The app as people use it

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| A mod installs, switches and uninstalls through the real window, and the game folder ends byte for byte as it started | `tools/e2e.mjs` presses the buttons in the real window over a sandbox game tree, with a fixed catalog so the check does not depend on the live one | Window: "Install a mod through the window", on Linux and on Windows | `npm run e2e` |
| It works on the screens and renderers people have: 1366x768 to 4K, scales from 100% to 200%, software rendering, no GPU raster | `tools/sim/`, the profiles in `tools/sim/profiles.json` | Simulation: one screen per system on every pull request, the full set nightly | `npm run sim` |
| An update keeps your mods, your favourites and your settings | `.github/workflows/update.yml` installs the last release, uses it, runs a freshly built installer over it the way an update arrives, and checks everything is still there | Update, on pull requests that touch the path and weekly | in CI only: it installs software |
| The keyboard and a screen reader can do what a mouse can | [docs/accessibility.md](accessibility.md): each promise with the check behind it | Simulation, the a11y scenario | `npm run sim -- --scenario a11y` |

## Security

| Claim | Evidence | Runs in CI as | Run it yourself |
|---|---|---|---|
| Every threat the project knows about has an answer and a test | [docs/assurance-case.md](assurance-case.md), a claim per threat with the test that holds it | Tests | read it, then run the tests it names |
| The window can only ask the main process for what the UI offers | `test/ipc-contract.test.js`, `test/window-guard.test.ts` | Tests | `npm test` |
| The packaged app cannot be run as plain Node or have a debugger attached | `build.electronFuses` in `package.json`, held by `test/electron-fuses.test.js` | Tests; the Update job runs the fused build | `npm test` |
| No known weakness pattern in the code | CodeQL; no open alerts on 2026-10-11 | CodeQL: "Analyse JavaScript and TypeScript", required | the Security tab |
| The project follows OpenSSF practice | [Scorecard](https://scorecard.dev/viewer/?uri=github.com/dota2modmanager/dota2-mod-manager), [Best Practices silver](https://www.bestpractices.dev/projects/14721); [docs/openssf-answers.md](openssf-answers.md) has the answers given | Scorecard, weekly | the links |

## The download

| Claim | Evidence | Run it yourself |
|---|---|---|
| The installer you downloaded is the one this repository's CI built | `SHA256SUMS` and a Sigstore provenance attestation on every release | `gh attestation verify Dota-2-Mod-Manager-Setup.exe --repo dota2modmanager/dota2-mod-manager` |
| You can see what ships inside it | a CycloneDX SBOM on every release, `dota2-mod-manager.cdx.json` | open it |
| What antivirus engines say about it | the VirusTotal verdict per file, written into each release's notes | the links in the notes |
| A release cannot come from a commit that skipped the checks | `tools/release-gate.mjs` refuses a tag outside `main` or without the release checks in `.github/required-checks.json` | read the Release workflow's first job |

## How changes get in

Every change reaches `main` through a pull request and a merge queue, and merges only when every
check in `.github/required-checks.json` is green on top of the newest `main`. A pull request that
fixes something brings a test or says why it cannot (`No-Test-Because:`), and the required check
"A fix brings its test" holds it to that. [GOVERNANCE.md](../GOVERNANCE.md) says who decides what, and
[DECISIONS.md](../DECISIONS.md) records the decisions with their reasons.

## What none of this proves

- **The real game.** CI has no Dota 2. The sandbox is assembled from the game's own files and real
  catalog mods, so the app's side of an install is tested end to end, but whether the game then
  shows the mod is checked on a maintainer's machine (`npm run dota:bench`). The Dota updates
  workflow watches every new game build and says which catalog mods touch the files it changed.
- **Code signing.** The installer is not signed, and SmartScreen says so. The attestation above is
  what stands in for it; [the code-signing policy](code-signing-policy.md) says what would change.
- **A person with a screen reader.** The accessibility tree is checked on every change; a person
  listening to it is not. [docs/accessibility.md](accessibility.md) lists what that pass covers.
