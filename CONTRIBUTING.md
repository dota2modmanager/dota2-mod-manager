# Contributing

Thanks for looking. Bug reports, translations and pull requests are all welcome, and so is a
question in an issue when something in the code makes no sense.

One thing shapes every rule below: this app writes into somebody else's Dota 2 installation. A
mistake here does not throw a stack trace, it silently breaks a game the person paid nothing for
but plays every day. So the bar for a change is not "it works on my machine", it is "a stranger's
game still works after this".

[ARCHITECTURE.md](ARCHITECTURE.md) explains how the app is put together and is worth reading
before a first change.

## Running it

You need Node 24 or newer. The tests use `zlib.crc32`, which arrived in Node 22, and the CI runs
24.

```bash
git clone https://github.com/dota2modmanager/dota2-mod-manager.git
cd dota2-mod-manager
npm install
npm start          # the app, against your real settings
npm run dev        # the same, with the window served by Vite: an edit shows without a restart
npm test           # the unit tests
npm run dist       # the Windows installer, if you need to check packaging
```

The window's page is built by Vite into `out/renderer`. `npm start` rebuilds it when a source file
is newer than the build, and `npm run dev` serves it with hot reload, so a change to a style, a
component or an animation shows in the open window.

## Do not test against your own game

There is a throwaway Dota tree for exactly this:

```bash
npm run sandbox:seed     # build sandbox/ and download real catalog mods into it
npm run start:sandbox    # run the app against that tree, with its own settings
npm run sandbox:status   # what is on disk right now
npm run sandbox:reset    # back to a clean state
npm run e2e              # install, switch and remove a mod by clicking through the window
```

The seeder copies `gameinfo.gi` out of your real installation and builds a `pak01_dir.vpk` with
the game's own `items_game.txt`, so slot allocation, load order, the schema patch and language
folders behave the way they do in a real install. It downloads around fourteen real mods from the
catalog, because synthetic VPKs agree with our own parser and prove nothing.

`npm run e2e` needs none of those downloads and no network. It writes a fixture mod into the
app's caches, starts the app twice, clicks through install, switch off, switch on and remove, and
after each launch compares the language folder on disk with what it should hold. Screenshots, the
window's own report and the app log land in `e2e-output/`. It rebuilds `sandbox/` as it runs, so
anything you set up there by hand is gone afterwards. CI runs the same script on Linux and on
Windows, and a pull request cannot merge until both pass.

Nothing in `sandbox/` is committed, and nothing in it touches
`steamapps/common/dota 2 beta`. Please keep it that way in your own changes: a test that needs a
real game folder is a test nobody else can run.

## Tests

```bash
npm test
```

Plain `node:test`, no test framework, no dependencies. They run on every push and on every pull
request, including pull requests from forks.

Four modules get special attention because they are the ones that write into the game folder:

| Module | What its tests hold down |
|---|---|
| `src/patcher.js` | The search-path patch and the signature file, byte for byte, both directions |
| `src/vpk.js` | The reader against the writer, round trips, fingerprints |
| `src/gamelang.js` | Which folder the game will actually mount |
| `src/schema.js` | Merging and validating `items_game.txt` |

If your change touches any of them, start by finding the test that covers the behaviour you are
about to change, and make new behaviour bring its own test. A red `npm test` is not a formality
here: every one of those tests exists because something in it broke somebody's game once.

## Coverage

```bash
npm run test:coverage
```

The same suite, with two lines held: the aggregate floor on every platform, and the coverage of
each file against the numbers `.github/coverage-baseline.json` holds for the platform you are on.
A platform with no measurement of its own is held to the aggregate and says so; the Linux numbers
come from running the manual `coverage-baseline` job in `.github/workflows/test.yml` and
committing what it uploads. A file that drops more than half
a point below its line fails the run, and so does a file that was measured and is no longer
measured: node reports only files a test loaded, so deleting the last test that touches a module
would otherwise pass quietly.

Per file, because one number hides the answer: the aggregate read 76.10% on the day this was
written, while `src/presets-service.js` sat at 13.8% of its lines. Write tests, then
`node tools/coverage.mjs --update` to raise the lines. Never lower one to make a run green.

A drop in a file your change did not touch usually means the file's own tests never reached
those lines. Node merges coverage from every test process, and a line that no test runs can
still come out covered in one run and uncovered in the next. `src/safe-zip.js` did this in
September 2026: 100% on one Linux run, 98.8% on the next, and no test at all for an archive in
memory that is over the size limit. To see what a file's own tests cover, run them alone:

```bash
node --test --experimental-test-coverage test/safe-zip.test.js
```

## File size

```bash
npm run size
```

A file in `src/` or `renderer/` fails the check once it crosses 300 lines. The files that were
already longer when that mark came down from 800, on 2026-09-27, are in `.github/size-budget.json`
at their length, and the check fails when one of them grows.

If your change makes one of them longer, split something out of it rather than raising the number.
`node tools/size-budget.mjs --update` writes measurements back and refuses to raise any of them; a
budget only goes up by editing that file by hand, in a commit that says why.

## Types

```bash
npm run typecheck
```

The main process and `src/` are plain JavaScript, and the window moves to TypeScript and React
one screen at a time (DECISIONS.md, "The window is built by Vite"). The JavaScript's JSDoc is
checked against it: `tsc --checkJs`
reads the annotations already in `main.js`, `preload.js` and `src/` and reports where the code and
its own documentation disagree. The first run found a `require` that had never resolved, and three
functions whose JSDoc described a different signature than the one underneath it.

Sixty-odd places are still wrong, mostly a factory's `@param` listing half of what it is handed.
They are counted per file in `.github/typecheck-baseline.json`, and the check fails when a file
goes above its line or when a file that was clean starts reporting. Fewer is always fine: fix some,
then run `node tools/typecheck.mjs --update` to lower the line. Never raise one to make a run pass.

`renderer/` and `tools/` are not covered yet. The renderer is ES modules against the DOM and the
tools are a mix of both; each needs settings of its own, and one configuration that fits neither
would report noise instead of mistakes.

## Fuzzing the parsers

```bash
npm run fuzz
npm run fuzz -- --target zip
npm run fuzz -- --seed 20260916 --iterations 500000
```

A mod's VPK index is written by whoever made the mod, and the app reads it on every start. The
walkers used to trust it: a file cut short came back as a `RangeError` from Buffer rather than a
refusal, in paths that do not catch one. `test/vpk-fuzz.test.js` runs a few hundred cases on every
push (truncations, a forged preload length, seeded byte noise, and random sets of entries that have
to read back byte for byte) and the command above runs the same generator for as long as you like.

Every zip the app opens comes through `src/safe-zip.js`, and `--target zip` fuzzes that door.
`test/safe-zip-fuzz.test.js` holds two things on every push: a damaged archive is refused in this
project's words rather than a library's, and no entry name, however it is built, puts a file
outside the folder or hands out a name Windows itself would refuse. The name check writes to the
real filesystem of whichever runner it is on, so Windows and Linux each answer for themselves.

A finding is written to `fuzz-output/` together with the seed that made it. Add it to the test
before touching the parser, so the fix has proof.

## Checking that the tests would catch anything

```bash
npm run mutate
npm run mutate -- deployPack
```

A green suite says the tests ran, not that they would notice a fault. The test asserting that a
rebuilt pack keeps its pak slot passed against code that allocated a new slot every time:
`removePackDeployed` frees the old slot before the allocator runs, so re-allocating handed back the
same number and the assertion held either way.

Each promise worth keeping has a mutant in `.github/mutants.json`: an edit that breaks it, anchored
to the function it belongs to, and the test file that has to go red. The command applies them one
at a time and puts the file back afterwards. A mutant that survives is a test that proves nothing.
A mutant that no longer applies is worse, because the code moved and the check has been passing
against nothing, so both fail the run.

Running them costs a suite run each, which is why this is not part of `npm run verify`. What runs
on every push is `test/mutate.test.js`, holding every mutant against today's source without running
any of them. The whole set runs on Linux every Wednesday (`.github/workflows/mutation.yml`), and on
any pull request that changes the mutants, the tool or that workflow; the radar reports the
workflow if it goes red or quiet. Write the test for something a user would notice losing, then add the mutant that
would have caught its absence.

## When something broke for players

Fix it the way you fix anything else, with a test. Then add a file to
[docs/incidents/](docs/incidents/README.md): what happened, why, why nothing caught it, and what
catches it now. The last section names the tests, workflow steps and files that stand guard.
`test/incidents.test.js` fails when one of them is renamed or deleted and the write-up still
points at it, so removing a guard means saying in the same change what replaced it.

An issue labelled `regression` gets a write-up with its number in the `Issue` row. The radar lists
a closed one that no write-up names.

## Every user-facing string exists twice

The interface ships in Russian and English. Russian text is the key and English is looked up from
it, so a new string is two edits, not one:

- `renderer/i18n.js` for anything in the window
- `src/i18n.js` for native dialogs, menus and tray text

A string with no English twin falls back to Russian, which means an English speaker sees Cyrillic
in the middle of their app and nothing crashes to tell anybody. A checker finds those:

```bash
node tools/check-i18n.js
```

`npm test` runs it too, so a missing translation fails the pull request rather than shipping.

New languages are welcome. Say so in an issue first, so two people do not translate the same file
in the same week.

## Open an issue before you build

For a fix, go straight to a pull request. For anything larger, say what you intend to do first.

It costs one message and it saves the two expensive cases: two people building the same thing in
two different shapes, and a change that gets turned down for a reason that was never written
down anywhere ("the language folder is chosen that way on purpose, and here is the measurement").
An issue also gets you the part of the domain nobody has documented yet, which in this project is
usually the part that matters.

If you are working with a coding assistant, [AGENTS.md](AGENTS.md) is the same ground stated for
it: what the project is, what it refuses, and how work gets signed.

## What a good pull request looks like

- One change. A fix and a refactor in the same branch take three times as long to review.
- A description that says what to click to see it work. "Install two skins for the same hero and
  look at the library banner" saves a reviewer twenty minutes.
- Screenshots for anything visual, both languages if the text changed.
- No reformatting of code you did not otherwise touch. A diff where the change hides among two
  hundred moved brackets will be sent back.

## Dependencies

The app ships two of them, `adm-zip` and `electron-updater`. Everything else, including the VPK
parser and writer, the KeyValues reader and the update logic, is written here, because every
dependency is a stranger with write access to a game folder on 27,000 machines.

That is a bias, not a ban. A pull request that adds one needs to say what it replaces and why
writing it ourselves is worse. The tests use no dependencies at all, and `tools/` uses one, `vite`,
to build the window. `react`, `react-dom` and `motion` are devDependencies because Vite copies
their code into the page, so the installer carries that code without the packages.

Dependabot proposes updates every Monday. A minor or patch update queues itself to merge and goes
in once every required check has passed and a maintainer has approved it. A major one gets the
`major-update` label and waits for the maintainer's decision, because a new major version of Electron or of the site generator can pass every check and still
ship something broken.

## What will not be merged

- Telemetry, analytics, crash reporting, "anonymous usage statistics". The app phones no home and
  that is a feature.
- Anything that downloads and runs an executable from somewhere other than that program's own
  releases.
- Writes to the game folder that skip the transaction helper. If it cannot be rolled back, it does
  not go in.
- Mods. The catalog belongs to [h6rd](https://github.com/h6rd/Dota2PornFxWeb) and its authors; a
  new mod goes to them, not here.
- Whole-project reformatting, style rules added to the linter config, or a framework rewrite of
  the renderer.

## Style

Plain JavaScript, no framework, no transpiler. Comments explain why a thing is the way it is,
especially when it looks wrong: most of them exist because a game update, a VPK edge case or a
user's report made the obvious version fail. Match the surrounding code and the surrounding
comment density.

`.editorconfig` covers indentation and `.gitattributes` covers line endings. `npm run lint` runs
eslint, and its config carries no style rules on purpose - only rules that answer whether a line
will throw the first time somebody reaches it, `no-undef` chief among them. A run over thirty
thousand lines with formatting rules on would produce a reformatting commit nobody can review,
and a CI gate that fails on spacing teaches people to skim CI, which is worth nothing on the day
it has something real to say. Send a change that fails `npm run lint` and CI will stop it before
the suite even runs; send one with unusual spacing and nothing will.

**Anything that needs the network fails quietly.** The catalog, the fingerprint index, the
update check, the icon toolchain: every one of them has to leave a working app behind when it
cannot reach anything. A user with no connection still has the mods already on disk, and a
feature that throws because GitHub is unreachable is a bug rather than an outage. Cache what
came back, use the cache when nothing comes back, and say so in the interface rather than in a
dialog nobody can act on.

## How a change reaches main

Through a pull request, the maintainers' own changes included. It needs an approving review from
a maintainer who did not write it, and a fresh one after any later push; the maintainers review
each other. Once that approval is on it and the required checks are green, it joins a merge queue,
which runs the checks again on top of the newest main and then lands it. The checks: the suite on
Linux and on Windows, CodeQL, the Linux build and its start-up run,
installing a mod through the window on Linux and on Windows, and one rule of its own. CodeQL has
to come back clean as well: a pull request that adds an alert at High or higher does not merge. A pull
request that fixes something changes a test as well, or carries a line `No-Test-Because: <reason>`
in a commit message or in its description. `npm run verify` runs the same lint and suite on your
machine before you push.

A version goes out from a tag, as a draft that becomes public only after its installer and its
AppImage have each installed a mod. [RELEASING.md](RELEASING.md) has the steps, and what to do when
a release goes wrong.

## Response times

An issue gets a first reply from the project within 72 hours. A pull request is looked at within
3 days: merged, sent back with what to change, or closed with the reason. A report sent the way
[SECURITY.md](SECURITY.md) describes gets a reply within 48 hours.

These are checked rather than hoped for. Every morning a workflow reads what is open and rewrites
the pinned "Project status" issue, and anything past these times is marked overdue there and
sent to the maintainer.

## Reporting a bug

The app writes a diagnostic archive: Settings, Diagnostics, Export report. It holds the app log, the manifest,
the load order and what the app thinks about your installation. Attaching it turns most reports
into a five minute fix.

Read it before you send it. It names your game folder and the app's own folder, and on Windows
the second one contains your account name. Nothing else about you is in there, and you are the
one attaching the file, but a path is still a path. Masking those two is listed in
[DECISIONS.md](DECISIONS.md#the-diagnostic-report-carries-two-real-paths).

Security problems go to [SECURITY.md](SECURITY.md) instead of a public issue.

## Licence

GPL-3.0. Opening a pull request means your change ships under it as part of this program.

Two extra terms are allowed by section 7 of that licence and this repository uses both: keep the
credit the app shows, and give your own version its own name. [NOTICE](NOTICE) says it in plain
words. Neither one restricts what you may do with the code; they restrict passing it off as
something else.

## Where to ask

Open an issue, or find the `#mod-manager` channel in the catalog's
[Discord](https://discord.gg/PBvG8D9MxT).
