# Working on this project with an AI assistant

This file is for coding agents, and for the people running them. It is public because the
policy is public: assistants are welcome here, the project is written with one, and pretending
otherwise would help nobody.

There is one hard rule, and it is at the bottom under **Attribution**. Read that first if you
read nothing else.

## What this is

A desktop mod manager for Dota 2. Electron 44 on Node 24. The window's page is built by Vite
(`vite.config.mjs`, into `out/renderer`) and moves screen by screen from plain JavaScript to
**TypeScript and React, with Motion for animation**. New screens and components are written that
way: one component per file, logic that decides things in plain modules with tests, and no file
past 300 lines (`npm run size` fails one). The main process, `preload.js` and `src/` stay
CommonJS JavaScript checked through their JSDoc. DECISIONS.md, "The window is built by Vite",
says why.

```
main.js            app lifecycle, window, auto-update. Nothing else belongs here
preload.js         the only bridge the renderer gets. Every channel is listed once
src/               everything that thinks: installer, vpk, schema, gamelang, catalog…
src/ipc-*.js       one file per group of channels, each naming what it needs
renderer/          the UI. views/ draw screens, ui/ are shared pieces, core/ is state
renderer/catalog/  the catalog's React components, and the rules they draw in .ts with tests
renderer/library/  the same for My mods; renderer/presets/ and renderer/settings/ for the rest
test/              node:test, no framework, no mocks library
tools/             scripts that are not shipped: fingerprints, i18n check, sandbox
site/              the documentation site (Astro). Separate from the app
```

## Before you change anything

**Read `ARCHITECTURE.md`.** It says which file owns which decision, and most wrong changes here
are changes made in the wrong file.

**Read `DECISIONS.md` before you call something a flaw.** It lists what was decided on purpose and
what the rejected alternative cost, what is genuinely missing, and which criticisms keep coming
back after they stopped being true. Every entry carries a command that settles it. If you are
here to review rather than to change something, that file is the whole brief.

**Do not read whole source files to orient yourself.** Find the symbol, then read its slice.
`main.js` and `src/installer.js` are large and reading them end to end wastes more than it
tells you.

**The domain is unusual and the obvious assumption is usually wrong.** Three examples that have
each cost real time:

- Dota mounts **one** language folder, named after the **voice** language, and a `-language` in
  Steam's launch options outranks the game's own setting. `src/gamelang.js` opens with the full
  rule. It is the rule, not a summary of one; change it only by measuring.
- `items_game.txt` is ~50 MB with non-UTF8 bytes in it. `src/schema.js` works on latin1 strings
  on purpose. A round trip through a "cleaner" encoding mangles it.
- A pak slot decides which of two mods the game loads. Lower wins. `src/installer.js` allocates
  them, and 65 to 67 are never handed out because another program writes them.

## How to know your change works

```bash
npm run lint              # eslint: names that do not exist, not style
npm test                  # node:test, no dependencies
npm run test:coverage     # the same with the floor CI enforces
node tools/check-i18n.js  # every Russian string has an English twin
npm run sandbox:seed      # a throwaway game tree with real mods in it
npm run start:sandbox     # the app against that tree, never against a real game
```

**Never point the app at a real Dota installation to test.** The sandbox exists because that
mistake is expensive: `sandbox/` is a disposable copy of the game's folder shape, and
`npm run start:sandbox` runs against it with its own user data.

For a UI change, `MM_SHOT=<path>` takes a screenshot after load; `MM_EVAL=<js>` writes the
answer to a question about the finished DOM beside it. Both are dev-only and documented at the
top of `main.js`. A screenshot proves a layout; `MM_EVAL` proves the text, the language and the
state, and it is the one that catches real bugs.

## What the tests will not let you do

Four of them check the project against itself rather than checking code:

- `test/ipc-contract.test.js` — every channel the renderer can call has a handler, every
  handler is reachable, none registered twice, every `src/ipc-*.js` wired into main.
- `test/release-contract.test.js` — the version, both changelogs and what CI reads all agree.
- `test/coverage.test.js` — which mod supplies a file when two carry the same path.
- `tools/check-i18n.js` — no Russian string without an English one.

If one of these fails, the fix is almost never the test.

## House style

- **Comments say why, not what.** A comment that restates the line below it is noise; a comment
  naming the bug that produced the line is worth more than the line.
- **Both languages, always.** Russian is the source, English is keyed by the exact Russian
  string. A new user-facing string without its twin fails `check-i18n`.
- **Errors are for people.** "Свободных слотов pakNN не осталось" beats "ENOENT".
- **Anything that needs the network fails quietly.** The app has to work offline with what it
  cached. A feature that throws because GitHub is unreachable is a bug.
- **Writing into the game folder is a transaction.** `src/file-tx.js`. If a step fails,
  everything goes back, including files displaced to make room.
- No emoji in code, comments, commits, UI or documentation.

## Pull requests

Open an issue first if the change is more than a fix. It costs a message and saves the case
where two people build the same thing differently, or where the answer was "this is deliberate,
here is why".

A pull request should say what broke and how you know it is fixed. "Fixes the thing" with no
reproduction is a change nobody can review.

Work on a branch of your own, from main, and open your own pull request. Do not push to a
branch that has a pull request you did not open: main takes a change only after the other
maintainer approves its last push, so your push throws away an approval somebody already gave,
and a push from an assistant's account needs one more approval on top.

## Attribution

**Say what wrote it.** If an assistant helped, put a `Co-Authored-By` trailer on the commit.
This project does: it has been written with Claude Code since July 2026, the trailers are in the
history, and the README says so on its front page.

**The author line is still yours, and so is the answer for what it does.** You ran the
assistant, you read the diff, you tested it. An assistant cannot answer a question about a
commit two years from now; you can. The trailer records how the work was done, not who is
accountable for it.

Until 10 September 2026 this file said the opposite and asked for no trailer at all. That was
the wrong call: it made an open project look like it was hiding a tool it uses every day, while
the trailers from August sat in the history anyway.
