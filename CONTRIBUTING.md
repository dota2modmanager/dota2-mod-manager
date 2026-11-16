# Contributing

Thanks for looking. Bug reports, translations and pull requests are all welcome, and so is a
question in an issue when something in the code makes no sense.

One thing shapes every rule below: this app writes into somebody else's Dota 2 installation. A
mistake here does not throw a stack trace, it silently breaks a game the person paid nothing for
but plays every day. So the bar for a change is not "it works on my machine", it is "a stranger's
game still works after this".

[ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the app is put together and is worth reading
before a first change.

## Running it

You need Node 24 or newer. The tests use `zlib.crc32`, which arrived in Node 22, and the CI runs
24.

```bash
git clone https://github.com/dota2modmanager/dota2-mod-manager.git
cd dota2-mod-manager
npm install
npm start          # the app, against your real settings
npm test           # the unit tests
cargo test -p mm-core -p mm-cli   # the Rust tests
npm run dist       # the installer for this platform, if you need to check packaging
```

You also need a Rust toolchain (`rustup`, stable). `npm start` builds the window's page with Vite
into `out/renderer-tauri`, then builds and starts the app with Cargo.

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
`steamapps/common/dota 2 beta`. Every launch above passes `--write-jail=sandbox`, so the app refuses
a game folder outside `sandbox/` and will not start with its user data outside it
(`crates/mm-core/src/app/write_jail.rs`). Please keep it that way in your own changes: a test that needs a
real game folder is a test nobody else can run.

## Driving the window from a script

There are two ways, both on the sandbox and both with `--write-jail=sandbox`.

**A picture.** `node tools/dev/tauri-shot.mjs` starts the debug build (`cargo build -p
dota2-mod-manager`), attaches to its window over DevTools, and saves a screenshot with the page's
console errors. It is how a change to a screen is shown in a pull request.

| Option | Takes | What it does |
|---|---|---|
| `--out` | a path to a `.png` | Where the picture goes; `e2e-output/tauri.png` when left out |
| `--click` | selectors split by `\|\|`, or `key:Escape` | Clicks each, or presses the key, in order, before the picture |
| `--wait` | milliseconds | How long the page settles before the clicks; 8000 when left out |
| `--eval` | a JavaScript expression | Printed after the picture |
| `--link` | a `d2mm://` link | Starts the app as a click on that link in a browser does |
| `--uninstall` | | The uninstaller's window, and the exit code it ends with |

A picture of My mods:

```bash
node tools/dev/tauri-shot.mjs --out shot.png --click '[data-view="library"]'
```

Hover states, right-click menus and drags go through the same page: `tools/dev/tauri-window.mjs`
hands a script the playwright-core page to drive.

**A state, without a picture.** Environment variables read in `src-tauri/src/harness.rs` walk the
window to a state and write what a script returns beside a path. A webview cannot photograph
itself, so this mode takes no picture. `tools/dev/e2e.mjs` drives every launch this way, and
`release.yml` runs it against the installed build before it is published. Nothing happens unless
the run is held to a folder with `--write-jail`. The switches run in the order of the table, after
the page has loaded.

| Switch | Takes | What it does |
|---|---|---|
| `MM_SHOT` | a path | Where the answers go: `<path>.eval.json`, or `<path>.err.txt` when something went wrong |
| `MM_QUIET` | `1` | Keeps the window hidden |
| `MM_VIEW` | `catalog`, `library`, `presets` or `settings` | Opens that tab |
| `MM_CAT` | a catalog category id | Picks it in the catalog's rail (`.rail-item[data-cat]`) |
| `MM_SEARCH` | text | Types it into the title-bar search |
| `MM_CLICK` | CSS selectors split by `\|\|` | Clicks each, in order |
| `MM_SCROLL` | a number of pixels | Scrolls the first scrollable pane by it |
| `MM_MODAL` | a mod's name, exactly as its card shows it | Opens that card |
| `MM_PREVIEW` | `1` | With `MM_MODAL`, plays the mod's preview |
| `MM_EVAL` | JavaScript, `await` allowed | Runs in the finished page; what it returns is written to `<path>.eval.json` |

A picture proves a layout. `MM_EVAL` proves the text, the language and the state, and it is the one
that catches real bugs: `MM_EVAL='return document.querySelectorAll(".lib-row").length'` writes the
number of rows to the answers file.

## Tests

```bash
npm test
```

Plain `node:test`, no test framework, no dependencies. They run on every push and on every pull
request, including pull requests from forks.

Four modules get special attention because they are the ones that write into the game folder:

| Module | What its tests hold down |
|---|---|
| `crates/mm-core/src/game/patcher.rs` | The search-path patch and the signature file, byte for byte, both directions |
| `crates/mm-core/src/formats/vpk.rs` | The reader against the writer, round trips, fingerprints |
| `crates/mm-core/src/game/gamelang.rs` | Which folder the game will actually mount |
| `crates/mm-core/src/schema/mod.rs` | Merging and validating `items_game.txt` |

If your change touches any of them, start by finding the test that covers the behaviour you are
about to change, and make new behaviour bring its own test. A red `npm test` is not a formality
here: every one of those tests exists because something in it broke somebody's game once.

## Types

```bash
npm run typecheck
```

The main process is TypeScript with no build step: Node strips the types when it loads a file,
so what you edit is what runs, in development and inside the installer. `test/tsconfig.json` checks
it strictly, `test/tsconfig.json` the tests written in TypeScript, and a new error in either fails
the run. The window is TypeScript and React (DECISIONS.md, "The window is built by Vite"),
checked as strictly by `renderer/tsconfig.json`. The two preload bridges stay JavaScript,
and `tsc --checkJs` reads their JSDoc. Before the main process moved, the same check over
JavaScript found a `require` that had never resolved, and three functions whose JSDoc described a
different signature than the one underneath it.

Errors are counted per file in `.github/typecheck-baseline.json`, which has stood at zero since
2026-09-28, and the check fails when a file goes above its line or when a file that was clean
starts reporting. Fewer is always fine: fix some,
then run `node tools/dev/typecheck.mjs --update` to lower the line. Never raise one to make a run pass.

`tools/` is not covered: the tools are a mix of both module systems, and one configuration that
fits neither would report noise instead of mistakes.

## Fuzzing the parsers

```bash
npm run fuzz
npm run fuzz -- --target zip
npm run fuzz -- --seed 20260916 --iterations 500000
```

A mod's VPK index is written by whoever made the mod, and the app reads it on every start. The
walkers used to trust it: a file cut short came back as a `RangeError` from Buffer rather than a
refusal, in paths that do not catch one. `crates/mm-core/src/formats/vpk.rs` runs a few hundred cases on every
push (truncations, a forged preload length, seeded byte noise, and random sets of entries that have
to read back byte for byte) and the command above runs the same generator for as long as you like.

The generators know the formats; libFuzzer knows the code. `fuzz/` is a cargo-fuzz crate with one
target per parser of other people's files (a VPK's directory, a mod archive, a compiled resource
and its KV3, text KeyValues, a texture), and it follows which branches each input reaches.
`.github/workflows/fuzz.yml` runs every target for five minutes once a week and keeps any crash as
an artifact. On Linux or macOS, with a nightly toolchain:

```bash
cargo +stable install cargo-fuzz --version 0.13.2 --locked
cd fuzz && cargo +nightly fuzz run vpk -- -max_total_time=60
```

libFuzzer does not build for Windows' GNU targets, so on Windows run it under WSL.

Every zip the app opens comes through `crates/mm-core/src/formats/safe_zip.rs`, and `--target zip` fuzzes that door.
`crates/mm-core/src/formats/safe_zip.rs` holds two things on every push: a damaged archive is refused in this
project's words rather than a library's, and no entry name, however it is built, puts a file
outside the folder or hands out a name Windows itself would refuse. The name check writes to the
real filesystem of whichever runner it is on, so Windows and Linux each answer for themselves.

A finding is written to `fuzz-output/` together with the seed that made it. Add it to the test
before touching the parser, so the fix has proof.

## When something broke for players

Fix it the way you fix anything else, with a test. Then add a file to
[docs/incidents/](docs/incidents/README.md): what happened, why, why nothing caught it, and what
catches it now. The last section names the tests, workflow steps and files that stand guard.
Removing a guard means saying in the same change, in the write-up, what replaced it.

An issue labelled `regression` gets a write-up with its number in the `Issue` row. The radar lists
a closed one that no write-up names.

## Every user-facing string has a translation

The interface ships in Russian, English and Simplified Chinese. Russian text remains the key:

- `renderer/i18n.js` for anything in the window
- `crates/mm-core/src/app/i18n.rs` for native dialogs, menus and tray text
- `renderer/locales/zh-CN-*.js` and `crates/mm-core/src/app/i18n.rs` for the matching Chinese text

A string with no English twin falls back to Russian, which means an English speaker sees Cyrillic
in the middle of their app and nothing crashes to tell anybody. A checker finds those:

```bash
node tools/dev/check-i18n.js
```

`npm test` runs it too, and `crates/mm-core/src/app/i18n.rs` checks Chinese coverage and placeholders, so a
missing translation fails the pull request rather than shipping. Catalog mod titles, styles and
groups use the display-only labels in `zh-CN-mod-names.json` and `zh-CN-catalog-words.json` through
`renderer/ui/catalog-name.ts`; original keys, file references and saved records stay unchanged.
`zh-CN-guide-text.json` translates the inspected catalog's guide text by exact source string;
changed instructions fall back to the source, and commands, paths and links remain intact.
Official item/set labels in Chinese resolve their `item_name` tokens from the installed
game's `dota_schinese.txt` and `items_schinese.txt`. Original names remain icon/favourite/save keys;
missing or ambiguous translations keep the original label. Guides and release notes use English
when no Chinese text is available. `crates/mm-core/src/item_builder/cosmetic_names.rs` covers decoding, token lookup,
fallback, game-update invalidation and bilingual search. The complete Valve localization files
are not shipped; only catalog display labels are included.

Chinese hero labels use Valve's [Simplified Chinese hero feed](https://www.dota2.com/datafeed/herolist?language=schinese)
in `renderer/locales/zh-CN-heroes.ts`. `renderer/ui/hero-name.ts` translates display labels only:
filter values, game identifiers, portrait keys and saved equipment keep their original names.
The global search also matches Chinese hero and catalog names alongside the original English.
Check named abilities against the [official hero data](https://www.dota2.com/datafeed/herodata?language=schinese&hero_id=109),
not a literal translation of the English or Russian name. Generic numbered ability slots remain
numbered; they do not identify a particular ability. Use official terms such as 至宝, 身心,
连杀配音 and 连杀特效, distinguishing audio from visuals. Cosmetic terms can be checked in
[Valve's Diretide page](https://www.dota2.com/diretide?l=schinese) and
[workshop requirements](https://www.dota2.com/workshop/requirements/announcers?l=schinese);
痛苦魔方 is also named in the [Chinese official update notes](https://www.dota2.com.cn/wapnews/article/details/20260325/220462.html).

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

The app is one Rust binary, built from what `crates/mm-core/Cargo.toml` and `src-tauri/Cargo.toml`
list: Tauri and its plugins for the window, and crates for the parts that are easy to get wrong,
such as `zip` and `flate2` for archives, `ureq` for the network, `ed25519-dalek` and `sha2` for
signatures. The VPK reader and writer, the KeyValues readers, the search-path patch and the update
logic are written here, because every dependency is a stranger with write access to a game folder
on 27,000 machines.

That is a bias, not a ban. A pull request that adds one needs to say what it replaces and why
writing it ourselves is worse. `react`, `react-dom` and `motion` are devDependencies because Vite
copies their code into the page, so the installer carries that code without the packages. The
tests and the Node tools under `tools/` use a few more, and none of them ship.

Dependabot proposes updates every Monday. A minor or patch update queues itself to merge and goes
in once every required check has passed. A major one gets the
`major-update` label and waits for the maintainer's decision, because a new major version of Tauri or of the site generator can pass every check and still
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

TypeScript in `crates/mm-core/src/`, `renderer/` and most of `test/`, React for the window, JavaScript for the
tools. Comments explain why a thing is the way it is, especially when it looks wrong: most of them
exist because a game update, a VPK edge case or a user's report made the obvious version fail.
Match the surrounding code and the surrounding comment density.

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

Through a pull request, the maintainers' own changes included. Once the required checks are green
it joins a merge queue, which runs the checks again on top of the newest main and then lands it.
No approval is required: the checks are the gate (DECISIONS.md, "Every change reaches `main`
through a pull request"). A pull request from outside the project still needs a maintainer to
merge it, and that is when it is read. The checks: the suite on
Linux and on Windows, CodeQL, the Linux build and its start-up run,
installing a mod through the window on Linux and on Windows. CodeQL has
to come back clean as well: a pull request that adds an alert at High or higher does not merge. A fix for a bug that reached
users brings the test that would have caught it. `npm run verify` runs the same lint and suite on your
machine before you push.

A version goes out from a tag, as a draft that becomes public only after its installer and its
AppImage have each installed a mod. [RELEASING.md](docs/RELEASING.md) has the steps, and what to do when
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
[DECISIONS.md](docs/DECISIONS.md#the-diagnostic-report-carries-two-real-paths).

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
