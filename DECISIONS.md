# Decisions, gaps and repeated claims

Reviews of this repository, by people and by models, keep arriving with the same three problems.
They file a deliberate trade-off as a flaw. They miss a real weakness because nothing points at
it. They repeat something that was true in August and stopped being true in September.

So this file carries three lists: what was decided on purpose and what the alternative cost, what
is genuinely missing, and which claims keep coming back with the command that settles them.

**Every entry ends with a check you can run.** Nothing here asks to be believed. If a check
disagrees with what is written above it, the check is right and the text is stale, and an issue
saying so is welcome.

The countable claims are held to the code by `test/decisions.test.js`, and the wider ones by
`test/docs-current.test.js`: between them they fail when this file and the repository disagree
about how long the main process's entry file is, how many test files there are, what the app depends on, where the
fingerprint index is fetched from, whether there is a linter, which npm scripts exist, or whether
a link in any document points at a file that is gone. The date below is left out of that on
purpose: it records when a person last read the whole file, and a test that kept it current would
be forging a review nobody did.

Last gone over on 2026-09-10, at version 2.6.8.

---

## Decided on purpose

### The linter looks for code that cannot run, and never for style

`eslint.config.js` turns on `no-undef`, `no-unused-vars` and about fifteen other rules that all
answer one question: will this line throw the first time somebody reaches it. No formatting
rules, no opinions about spacing or quotes. `.editorconfig` covers indentation and
`.gitattributes` covers line endings, and nothing enforces shape beyond that.

That split is the whole decision. A full style config would produce a reformatting commit nobody
can review, and a CI gate that fails on spacing teaches people to skim CI - and a lint run people
skim is worth nothing on the day it has something to say. This one had something to say on the
day it arrived: it named two live bugs, one of which had already shipped in two releases.

Until 2026-09-10 there was no linter at all and this entry argued for that. What changed it:
splitting a file left a call to `blocked('install')` in a module where `blocked` was not, every
test passed, and nobody could install a mod in 2.6.5 or 2.6.6.

*Check:* `npm run lint`, `eslint.config.js` for the rule list, and `.github/workflows/test.yml`,
where it runs before the suite.

### The app ships two dependencies

`adm-zip` and `electron-updater` ship inside it; `electron`, `electron-builder`, `eslint`,
`typescript` and `fast-check` only build and check it, and never reach a user's machine. The VPK reader and writer, the
KeyValues parser, the zip guards, the mirror logic and the update checks are written here,
because every dependency is a stranger with write access to a game folder on tens of thousands
of machines. That is a bias rather than a ban: a pull request adding one has to say what it
replaces and why writing it here is worse.

`eslint` was added on 2026-09-10 and is the one case where writing it here would have been the
wrong answer. Two releases shipped in which no mod could be installed, because splitting a file
left a function call pointing at a function that had stayed behind. Every test passed: they read
the files as text, or never loaded a module that needs Electron. `no-undef` names that in under
a second, and a scope analyser is exactly the kind of thing not to write by hand - the version
attempted here first reported 240 problems, of which one was real.

`typescript` was added on 2026-09-16 for the same kind of reason, and the app is still plain
JavaScript: nothing is compiled and nothing is emitted. It reads the JSDoc already written here
and says where the code and its own documentation disagree. Its first run found a `require` that
had never resolved, which had been answering two features with "Cannot find module" for as long as
they existed, and three functions whose JSDoc described a different signature than the code below
it. Inferring types across thirty thousand lines is not something to write by hand either. What is
left is counted per file in `.github/typecheck-baseline.json`, and `tools/typecheck.mjs` refuses a
run where that count grows.

`fast-check` was added on 2026-09-20, and it replaces something written here rather than adding a
habit. The parsers were already fuzzed with generators of our own (`tools/fuzz-parsers.mjs`,
`test/safe-zip-fuzz.test.js`), and those have one flaw that cannot be written around cheaply: when
they find something they hand over the four kilobytes of rubbish that broke it instead of the two
bytes that mattered. fast-check shrinks a failure to the smallest input that still fails, which is
the difference between "an archive broke it" and "a name of one dot breaks it". Its properties are
in `test/properties.test.js`, and the first of them already earns its keep: our hand-written crc32
is checked against `zlib.crc32` on random bytes rather than on the cases somebody chose.

It also flips a check on the OpenSSF Scorecard, which recognises fuzzing in JavaScript only
through a short list of libraries and not through generators of our own. That is a real reason and
not the reason: the shrinking is.

Seven more came on 2026-09-27 with the decision below, twelve devDependencies in all. `vite` and
`@vitejs/plugin-react` build the window's page. `react`, `react-dom` and `motion` are written into
that page once a screen imports them, which makes them part of the app in every sense but the
installer's: Vite copies their code into `out/renderer`, and the packages themselves stay behind.
`@types/react` and `@types/react-dom` only check it. The facts block in the README names which of
them the window imports (`tools/gen-doc-facts.js` reads `renderer/` for that).

*Check:* `node -e "const p=require('./package.json');console.log(p.dependencies,p.devDependencies)"`
and `npm run typecheck`

### Valve's `vpk.exe` is deliberately absent

It is proprietary, and a project that bundles it is not open source in the sense a code-signing
programme means. Reading and writing VPK archives is this repository's own code.

*Check:* `src/vpk.ts`, and `test/vpk.test.ts`, which runs the writer against the reader.

### The window is built by Vite, and moves to TypeScript and React

Until 2026-09-27 the renderer was plain JavaScript with no build step, so that a reviewer reading
renderer/app.js read the program itself. That cost more every month. The catalog screen reached
1,699 lines and the library 1,374, a redesign meant editing strings of HTML inside them, and an
animation meant timing code written by hand. The size budget stopped the growth; it could not
undo it.

The page is now built by Vite into `out/renderer`, and the screens move to TypeScript and React
one at a time, with Motion for animation: one component per file, and no new file past 300 lines.
Types catch a wrong property before a run does, and the model that writes most of this code makes
fewer mistakes in TypeScript and React than in anything else, because that is what it has read the
most of. `npm run dev` serves the page with hot reload.

Tauri was weighed and not taken. On Windows its window is the same Chromium, but its back end is
Rust: the VPK writer, the patcher and everything else that writes to a game folder would be
rewritten, with 900 tests and the release pipeline, to make a 108 MB download about ten times
smaller. 97% of downloads are the Windows installer, and nobody has asked for a smaller one.

The build had to show first that it costs nothing. The same window built by Vite and loaded as
written, on the same Electron, three runs each in the sandbox, alternating: opening Heroes (611
cards), scrolling 14,400 px, a search and memory came out the same within noise, about 40 ms,
150 fps, 190 ms and 690 MB for both. Each screen that moves is measured the same way before it
reaches `main`.

The uninstall window still loads `renderer/uninstall.html` as written. The documentation site
under `site/` is a separate package, built by Astro.

*Check:* `npm run build:ui`, `vite.config.mjs`, and `src/app-page.ts`, which names the only page the
window loads.

### The documentation site lives in this repository

The site's numbers come from the app's own version and from the catalog at build time, so a page
cannot claim a version the repository does not have. Typed-in numbers had already drifted once,
in August 2026, when the landing said 1,150 mods against a catalog holding 1,090.

*Check:* `site/src/lib/stats.ts`, and the fact sheet at <https://dota2modmanager.com/facts/>.

### The catalog job commits to a branch of its own

A workflow checks the upstream catalog every thirty minutes and writes what it found:
`fingerprints.json`, `hero-index.json`, and the site's hero and category data with the mod
previews. Until October 2026 it committed them to `main`, more than a quarter of all commits,
through a deploy key on the branch rule's bypass list. Those commits went through no pull request,
which is what OpenSSF Scorecard's Code-Review check counts against, and the bypass is what its
Branch-Protection check reads as a rule that does not hold for everybody.

Since 2.8.0 it commits to `catalog-data`, a branch that holds those files at the same paths and
nothing else. The app reads `fingerprints.json` from there, the site's mirror copies it from
there, and the site build copies the rest in before it builds. Copies of the app before 2.8.0
read the file from `main`, so for the first days after that release the job wrote it there too.
That stopped on 2026-10-07: the job no longer writes to `main` at all, the deploy key came off
the bypass list, and `main` holds code and documents only. The copies on `main` stay as they
were that day, so a copy that never updates keeps reading them and still runs: it only stops
recognising mods added to the catalog after that.

*Check:* `src/fingerprints.ts`, the `FP_URL` constant, `ref: catalog-data` in
`.github/workflows/fingerprints.yml`, and `test/decisions.test.js`, which fails if that job
pushes from anywhere but the catalog-data checkout.

### The catalog job commits every thirty minutes, and its commits stay readable

The job above commits when the catalog moved. They are not squashed away and the interval is not
lowered: freshness is the point, and since 2026-09-08 the files are written one record per line
with a subject naming what arrived or left, so the commits can be read like any other. They live
on `catalog-data` now, and `git log catalog-data` reads them.

*Check:* `git log --oneline catalog-data` for the subjects, `tools/json-lines.js` and `tools/index-delta.js`
for how they are produced, and `test/json-lines.test.js` for what the formatter guarantees.

### Dota's builds are read from GameTracking-Dota2, and only by this repository's checks

Dota build 6946 (2026-10-07) renamed the search-path key the language folder is mounted by,
`Game_Language` to `Game_AudioLanguage`. Search-path patches written before it kept the old name,
and mods in the language folder stopped loading behind them. SteamTracking's
[GameTracking-Dota2](https://github.com/SteamTracking/GameTracking-Dota2) had the change in a
public commit within the hour. This project heard about it from a Discord announcement that
evening.

So the project reads that repository instead of building a tracker of its own. It is the one
public source with every build as text: the `pak01` listing with CRCs, `gameinfo.gi`, the strings
of the binaries, a commit per build. SteamDB has build numbers but no file contents and no API.
Fetching the depots in CI ourselves would put a Steam account into a workflow secret.

Only the checks depend on it: the [Dota updates](https://github.com/dota2modmanager/dota2-mod-manager/issues/225)
issue and `npm run dota:diff`. The app reads the game on the player's disk and never asks
GameTracking anything: the patch is rebuilt from the `gameinfo.gi` it finds there, and the
pre-patch mark works from the game's own index. If GameTracking stops, the issue goes quiet and no
player notices.

GameTracking states no licence. Nothing from it is copied into this repository. The tools read it
over the network, and the issue quotes counts, folder names and the few search-path lines that
changed.

*Check:* `tools/dota-diff.mjs`, `tools/dota-watch.mjs` and `.github/workflows/dota-watch.yml`
are the only code that reads GameTracking, and nothing under `src/` names it.

### The source is mirrored, and the workflow does not name where

A copy of `main` and every tag goes to <https://gitlab.com/TheFleece/dota2-mod-manager>. This is
a Dota modding tool: the realistic ways it disappears are a takedown, a suspended account, or a
decision about the catalog it installs from, and none of those give notice. The mirror carries no
issues and no merge requests, because it is a copy rather than a second place to work.

The workflow does not name the host. A mirror was set up on Codeberg on 2026-09-08 and stood down
the same day, when their terms of use turned out to ask projects written with heavy use of
language models not to host there, and moving cost a code change it should not have cost. It now
pushes wherever the `MIRROR_PUSH_URL` secret points and exits green saying nothing is configured
when it points nowhere, so the next move is a secret and not a commit.

*Check:* `git ls-remote https://gitlab.com/TheFleece/dota2-mod-manager.git`, which needs no
account and should answer with the same commit on `main` and the same tags as this repository.

### This project is written with Claude Code, and says so

Since the first commit, on 20 July 2026. Commits carry a `Co-Authored-By` trailer, `README.md`
has a section about it above the dependency table, and `AGENTS.md` asks anyone sending a change
to keep the trailer on theirs.

Two entries used to stand here instead. One explained why eleven commits from August had a
trailer nobody had cleaned out of them. The other said that working with an assistant was
"stated rather than hidden", while `AGENTS.md` on the same day asked contributors not to state
it. Together they read as a project embarrassed by a tool it uses every day, which was never the
position and is not worth the room.

So nobody has to open a review with "was this AI-generated". Yes, it is on the front page, and
every question worth asking after that one is answered elsewhere in this file with a command.

*Check:* `git log --grep='Co-Authored-By' --format='%h %ad %s' --date=short`, the "Written with
Claude Code" section of `README.md`, and **Attribution** in `AGENTS.md`.

### Every change reaches `main` through a pull request, the maintainer's own included

Until 15 September the maintainer pushed straight to `main`, on the grounds that a solo project
gains nothing from reviewing itself in a web form. What it gains is the gate. Four releases went
out in one evening on 10 September, and 2.6.11 was built from a commit whose suite was red. The
ruleset now requires a pull request and every check in `.github/required-checks.json`.

Since 17 September it also requires a CodeQL result with no new alert at High or higher. Pull
request #62 had merged itself the day before with one, because the rule asked for the analysis to
run and nothing about what it found. The deploy key the catalog bot pushes its index with is the
one bypass: those commits are data, and they never touch code.

From 23 September to 2 October it also required an approving review from a maintainer who did not
write the change, and a fresh one after every new push. A second maintainer had joined, and OpenSSF
Scorecard's Code-Review and Branch-Protection checks measure exactly that. It cost more than it
caught. One person writes nearly all of the code, so every change waited a day or more for the
other maintainer, and a conflict fixed after an approval threw that approval away: the same pull
request was approved two and three times before it merged. Since 2 October no approval is
required. The checks above still gate every merge, a pull request is still the only way into
main, and a change from outside the project still needs a maintainer to merge it. The two
Scorecard checks that count approvals score lower for it, and that is the price.

A pull request also goes through a merge queue since the repository moved into an organization,
which is where GitHub offers one. The queue puts the change on top of the newest main, runs the
required checks there once more, and only then lands it. That is what lets the rule require a
branch to be up to date without the cost it had before: the catalog bot pushes to main several
times a day, and without the queue every open pull request would have had to be updated and
rerun by hand after each push. A probe repository showed a pull request left behind by such a push
going through the queue on its own, with CodeQL, the code scanning rule and a skipped
pull-request-only check in the way.

The same day the release gate started refusing a tag on a commit that is not on main. Checks run
on pull request branches as well, so without that a tag on a green branch that never merged
would ship it.

*Check:* `curl https://api.github.com/repos/dota2modmanager/dota2-mod-manager/rules/branches/main`, which
needs no token, or `gh api repos/dota2modmanager/dota2-mod-manager/rulesets`. `tools/radar.mjs` compares
that answer with `.github/required-checks.json` every morning and reports a rule that drifted.
Note that `gh api repos/dota2modmanager/dota2-mod-manager/branches/main/protection` answers **404 Branch
not protected**, because this is a ruleset and not classic branch protection. Reviewers have read
that 404 as an unguarded branch.

### The coverage numbers are a floor, not a target

They sit just under what the suite reaches, so the gate does not fail on the state it was written
in and does fail the moment somebody adds code nothing exercises. Node only reports files a test
loaded, so a module with no test at all is invisible here rather than counted as zero. The gate
holds the line; it does not claim the line is where it should be.

*Check:* the `test:coverage` script in `package.json`, and the comment above the step in
`.github/workflows/test.yml`.

### The catalog is verified, and the key was pinned later than it arrived

`src/catalog-signature.ts` checks an ed25519 signature over every catalog file the app reads, so
a proxy handing over a rewritten `mods.json` fails here rather than at the point where somebody's
machine acts on it. The catalog's author holds the private half.

The key arrived on 2026-09-09 and was pinned on the 10th. In between, the catalog published its
data and its signatures in separate commits, which left one to eight minutes after every update
where the published files disagreed with their own signatures - indistinguishable here from an
attack, and really a bot that had not run yet. Existing users would have kept their cached
catalog; anyone installing the app in those minutes would have had none at all, about five times
a day. The author now writes data and signatures in one commit, so the disagreement has no moment
to happen in.

The whole chain this belongs to - what carries a proof, what each failed check costs, and what
none of it covers - is written out in [ARCHITECTURE.md](ARCHITECTURE.md) under "Who is allowed
to have written this".

*Check:* `src/catalog-signature.ts`, `test/catalog-signature.test.ts`, and, in the catalog's own
repository, [update-catalog.yml](https://github.com/h6rd/Dota2PornFxWeb/blob/main/.github/workflows/update-catalog.yml),
where one `git add` stages the data and the signatures.

### The switches this project can pull are signed too, and a failed check ignores them

`config/app.json` can turn a feature off after a release and put a notice in front of everyone
who opens the app, and it travels the same public proxies as everything else. It is signed with a
key of this project's own, pinned in `src/remote-config.ts`.

A copy that does not verify is treated as no file at all, which is what that module already does
with every other failure. Refusing to start would be the wrong trade: the worst an attacker gets
from breaking the signature is that the notices stop arriving, and dropping the request achieved
that already. What they no longer get is to put words on the screen in this project's name.

*Check:* `test/remote-config-signature.test.ts`, which fails the build when the committed file
and its signature disagree - the failure an unsigned edit would otherwise cause in silence, on
the day somebody reached for a switch and it did not work.

### Nothing is collected, and that is enforced by review rather than by a setting

There is no telemetry, no analytics, no crash reporting and no opt-out to configure, because
there is nothing to opt out of. `PRIVACY.md` lists every address the app can contact and what it
stores on disk.

*Check:* `PRIVACY.md`, and grep the source for an outbound call: `grep -rn "fetch\|https.get" src/`.

### The catalog's preview images are committed, and stay committed

`site/public/mods/` is 1,324 files and 47.3 MB of a 57.2 MB pack once history is counted in: 83%
of it. It grows by five to ten files a day, and the generated JSON at the root that reviews
usually blame for the size is 1.3 MB, so this is where the weight is.

It stays. The two alternatives both cost more than they save. Fetching the pictures during the
site build makes every build depend on the catalog being up, for files that are written once and
almost never rewritten. Moving them to the R2 bucket changes their public addresses, and those
addresses are indexed: the catalog and hero pages are what the site is found by, and trading a
settled position in search for repository size is a bad trade for a project whose whole problem
is that too few people know it exists.

What makes it affordable is that these files are append-only. A picture arrives, and that is the
last time it is written, so the pack grows by what the catalog gains rather than by what anyone
edits.

*Check:*
```
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize:disk) %(rest)' | awk '$1=="blob"&&$4~/^site\/public\/mods\//{n+=$3} END{print n/1048576" MB"}'
```

### TypeScript stays on 5.x

The type check here is not a compiler step. Nothing is emitted; it reads the JSDoc the code
already carries and counts what disagrees, and `.github/typecheck-baseline.json` holds that count
so it can only fall.

TypeScript 7, the Go rewrite, reads `@param {object}` far more strictly than 5.x does. The same
tree goes from 66 known errors to 303, nearly all of them `Property does not exist on type
'object'`. Measured on 2026-09-22, and the module-resolution change that 7 also forces was ruled
out separately: 5.9.3 on those same settings gives 64.

Taking 7 means writing out the shapes behind those annotations first, across forty-one files.
That is worth doing, and it is a piece of work rather than a dependency bump, so the bot is told
to stop offering the major version until somebody does it.

*Check:* `.github/dependabot.yml`, the `ignore` block for the app's dependencies.

### The main process is TypeScript, with no build step

Every file of the main process is TypeScript since 2026-10-01, the entry included: package.json
starts `src/main.ts`. Nothing compiles it. Electron 44 runs on Node 24, which strips the types
itself when it loads a `.ts` file, and it does so from inside `app.asar` as well: checked with a
packed test app before the first module moved, and again with the installer built from the last
one, which installed, switched and removed a mod through the window. So the installer, the updater
and the release pipeline see the same kind of files they always did, and there is no build output
that can drift from the source.

That rules some TypeScript out. Only syntax that can simply be erased is allowed (no enums, no
namespaces, `erasableSyntaxOnly`), and imports name the `.ts` file, because that is the path Node
loads. The modules are ES modules, and `src/package.json` says so, so Node reads each one once
instead of trying CommonJS first. A CommonJS `.ts` file has no way to type a `require` without
syntax that would need compiling.

The compiler is also the lint for these files. `eslint.config.js` reads the JavaScript; for the
TypeScript, `src/tsconfig.json` turns on what strict leaves out: a name nobody reads, code nothing
reaches, a switch case falling into the next. Adding `typescript-eslint` instead would be a second
parser for rules the compiler already holds.

The preload bridges stay JavaScript, because Electron runs them in the sandbox as CommonJS before
the page. The tools and most tests stay JavaScript too. Neither ships, and rewriting them would be
a diff nobody can review for no change in what runs. The exception is the tests of a module: they
are `.test.ts` importing it, because Node's coverage leaves out a `.ts` file that was only ever
loaded through `require`, and a module tested that way would drop out of the coverage baseline
without anything else changing.

*Check:* `src/tsconfig.json` and `test/tsconfig.json`, both strict and with nothing in the
baseline, run by `npm run typecheck`; `ls src/*.js` finds nothing.

### The anti-cheat notice is rewritten, and there is no switch for it

When Dota cannot verify the game before matchmaking, Valve's window says the anti-cheat "was
unable to verify that your machine is secure". Players with mods read that as a ban coming, open
issues with a screenshot of it, and the usual cause is a damaged install or a Steam that needs a
restart. The app replaces the four strings of that window with text that says what to do,
in all 28 languages the game ships, through its own `pak64` in the language folder.

It has no setting. A switch would be one more thing to explain for text that only ever says what
to do next, and turning it off would put back the wording that caused the issues. The pak is
never listed as a mod either, so nobody removes it by accident; the site says it is there, and
the uninstaller takes it out.

*Check:* `node --test test/notice-text.test.ts`, and `src/notice-texts.ts` for every word of it.

---

## Known gaps

Real ones. Listed here so a review does not have to find them and so the answer is the same
whoever asks.

### The installer is not signed

Windows SmartScreen says "unknown publisher" on first run. SignPath Foundation, which signs open
source for free, turned the application down in August 2026 for not having enough public
visibility yet; a commercial certificate runs a few hundred dollars a year against a program
nobody pays for. What stands in for a signature: every binary is built by a public workflow from
a public commit, and the update metadata beside it carries a SHA-512 of the file.

*Check:* the run that produced any release under
<https://github.com/dota2modmanager/dota2-mod-manager/actions/workflows/release.yml>, and `latest.yml`
in the release assets.

### Two maintainers, and one of them holds the keys

One person writes nearly all of it. Since 2026-09-23 a second maintainer co-owns the
[dota2modmanager](https://github.com/dota2modmanager) organization the repository moved into that
day, so either can release without the other. They read changes when they choose to; since
2026-10-02 a merge needs no approval (see the branch rule above). What still sits with one
person: the knowledge of how the app keeps up with a game update, and the keys outside GitHub
(the `config/app.json` signing key, the domain, the mirror bucket).
[GOVERNANCE.md](GOVERNANCE.md) says what losing those costs.

*Check:* `git shortlog -sne HEAD`, `.github/CODEOWNERS`, and the "Who can merge" table in
GOVERNANCE.md.

### The coverage floor is measured on one platform only

The suite runs on both since 2026-09-09, which is what issue
[#5](https://github.com/dota2modmanager/dota2-mod-manager/issues/5) asked for: `ubuntu-latest` carries
the coverage gate, `windows-latest` runs the same tests for correctness, and that job earned
itself on its first run by finding a libuv abort Linux cannot see.

What is still one-sided is the floor. `src/steam.ts` takes a different half of itself on each
operating system, so the two platforms report different figures, and a number calibrated against
one of them fails on the other.

Since 2026-09-16 the gate is two things. `tools/coverage.mjs` reads the suite's own lcov and holds
the aggregate floor in `.github/coverage-baseline.json` on every platform, because a floor that
sits under both is honest everywhere. The per-file lines are held per platform, in a map keyed by
the operating system they were measured on: a line measured on one machine is not evidence about
another, but it is evidence about that machine, and holding only one of them left the per-file
half of the ratchet unenforced everywhere in CI. A platform with no measurement of its own is held
to the aggregate and nothing else, and says so. The Linux numbers are taken by running the
`coverage-baseline` job in `.github/workflows/test.yml` by hand and committing what it uploads;
that is manual because a baseline that rewrites itself on every push is not a ratchet.

Per file, because the aggregate hid the thing worth catching: it read 76.10% on the day this
changed, while `src/presets-service.ts` sat at 13.8% of its lines and `src/installer.ts` at 48.5%,
and a new module with no tests at all moves the aggregate by a fraction of a point.

*Check:* `.github/coverage-baseline.json`, `tools/coverage.mjs`, and the `test:coverage` script in
`package.json`.

### A mod the published hash list is wrong about is installed anyway

Since 2026-09-09 the catalog publishes a signed sha256 for every archive. A copy that does not
match it is refused and the next mirror is asked instead. When no mirror matches, the file the
catalog's own host serves is taken and marked unverified, rather than the mod being refused.

That last part is a deliberate hole, and it is there because the list is not always right. On
2026-09-10 it named a hash for one archive that no copy of that file has ever had - one wrong in
1,178 checked - and until this changed, that mod was uninstallable for everybody, whatever their
connection. The list is built by a bot in the same repository as the archives, so it can prove
nothing about that repository in the first place. What it does prove is that bytes handed over by
a proxy are the ones the catalog's author signed for, and that is the part worth keeping.

Mods the list has not caught up with at all are a smaller version of the same thing: they fall
back to the hash remembered from the first download.

*Check:* `src/net.ts`, `downloadFile`, and `test/net.test.ts` for the four cases it separates - a
stale mirror, a stale list, a proxy inventing bytes, and a hash pinned in this repository, which
is never waived.

### The five biggest files are split, and a budget keeps them that way

`main.js` was the first file on this list. It went from 3,102 lines to about 1,300 when the IPC
handlers moved into `src/ipc-*.ts`, and to about 1,150 on 2026-09-16, when the cursor rules went to
`src/cursors.ts` and everything a freshly landed VPK goes through before it counts as a mod went to
`src/adopt.ts`. On 2026-09-30 the log, the "What's new" text, the Discord status, d2mm:// links,
the window, the screenshot harness and the upkeep of the game folder went to modules of their own,
each with tests, which took it to about 450. What was left moved to `src/main.ts` the same day,
TypeScript like the rest of the main process: the order the app starts in, which services exist,
what each one is handed, and auto-update. That is one subject, and main.js no longer exists.

On 2026-09-16 it was one of five files carrying 6,754 lines between them while the median module
in `src/` was 171: src/installer.js, renderer/views/catalog.js, renderer/views/library.js, this one
and src/vpk.js. All five have since been split along their subjects: the installer into
`src/installer.ts` and `src/installer-*.ts`, the VPK code into `src/vpk-*.ts`, the two screens into
`renderer/views/catalog/` and `renderer/views/library/` on 2026-09-28, and this file as told above.
None of them arrived that size; each grew a hundred lines at a time with nobody deciding to. Each
has its length written in `.github/size-budget.json`, and `tools/size-budget.mjs` fails a run
where one grows, or where a file nobody listed crosses 300 lines. The budget does not split
anything: it stops the drift, and every split shows up in it as a number going down.

*Check:* `npm run size`, `.github/size-budget.json`, and `ARCHITECTURE.md` for what is supposed to
live where.

### CI clicks through one mod, and only one

`.github/workflows/linux.yml` runs Electron against the sandbox under xvfb on every change to the
code, photographs the first window and fails on `unhandledrejection`, `is not defined` or
`is not a function` in the app's log. Since 2026-09-15 `.github/workflows/e2e.yml` runs
`tools/e2e.mjs` on Linux and on Windows: it presses Install on a fixture mod, switches it off,
restarts the app, switches it on and removes it, and compares the language folder on disk after
each launch. Run against the 2.6.6 code it stops at Install with `blocked is not defined`, the
error that left installing dead in 2.6.5 and 2.6.6
([#19](https://github.com/dota2modmanager/dota2-mod-manager/issues/19)). These jobs are required before
a pull request merges and before a release builds.

What it still does not cover: one mod of one shape, a zip holding a single VPK, in one category.
Packs, load order, cursors, the schema patch, presets and imports are never driven through the
window. A pull request tries the source tree; the installer and the AppImage are tried only on a
tag, by `.github/workflows/release.yml` against the draft release, so a packaging mistake is found
at release time rather than at merge time.

*Check:* `.github/workflows/e2e.yml` and the `e2e-linux` and `e2e-windows` artifacts it uploads:
a screenshot per launch, the window's own step report and the app log.

### No macOS build, and the Linux one is young

Windows has a year behind it. Linux has shipped an AppImage since 2.4.0 and is started against a
game tree by CI, but it has a fraction of the running time. macOS is not built at all, and Dota's
own layout there has never been tested here.

*Check:* the assets on any release, and `.github/workflows/linux.yml`.

---

## Open questions

Weighed, not settled. Listed so nobody files them as an oversight.

### Applying to SignPath again

The first application was turned down for public visibility rather than for anything in the code.
The picture has changed since: 43 releases, tens of thousands of installs, a community around the
catalog, and a comparable tool in the same ecosystem already signed by the same programme. Not
resubmitted yet.

*Check:* download the installer from the latest release and ask Windows who signed it:
`Get-AuthenticodeSignature .\Dota-2-Mod-Manager-Setup.exe`. It answers `NotSigned` today, and
the day it stops, this entry is out of date.

---

## Claims that keep coming back

Each of these has arrived in a review. Each is answered by one command.

| Claim | What is true | Check |
|---|---|---|
| "The repository cannot be opened, so the open-source promise is unverifiable" | It is public and has been. A fetch failing at one moment is not a private repository | `gh repo view dota2modmanager/dota2-mod-manager --json visibility` |
| "`main.js` is a 3,100 line monolith" | It is gone. The main process starts from `src/main.ts`, about 290 lines; since 2026-09-06 the IPC handlers went to `src/ipc-*.ts` and every other job to a module of its own, each with tests | `wc -l src/main.ts` |
| "The catalog counts on the site disagree between pages" | They are counted when each page is built. Two pages built an hour apart show two numbers, and both were right when they were made | `site/src/lib/stats.ts` |
| "The state files in the root are why the repository is 61 MB" | The generated JSON at the root is 1.3 MB of the pack. The preview images are 47.3 MB of 57.2 MB | the command under the open question above |
| "It is a Windows-only app" | Every release since 2.4.0 also carries a Linux AppImage | `gh release view --json assets` |
| "`main` is unprotected" | It is guarded by a ruleset, which the branch-protection endpoint does not report | `gh api repos/dota2modmanager/dota2-mod-manager/rulesets` |
| "There are 25 test files" | More than 40 of them, run on Linux and on Windows on every push | `ls test/*.test.js \| wc -l` then `npm test` |
| "An open issue asks for tests that already exist" | Issue #4 was closed on 2026-09-08 when that was pointed out, and `#5` on 2026-09-09 when Windows CI landed. `#3`, `#6`, `#7` and `#9` are open and really are open | `gh issue list --state open` |
| "There is no static analysis, only tests" | `eslint` runs before the suite in CI and again in the commit guard, with rules about code that cannot run rather than about style | `npm run lint` |

---

## Reviewing this project

Nothing here is off limits and a finding that is uncomfortable is still welcome. Two requests.
Say which commit or release you looked at, because this repository moves quickly and a review of
last month's tree reads as wrong rather than as dated. And run the check next to a claim before
filing it, because most of what arrives has one.

Where to put it: an [issue](https://github.com/dota2modmanager/dota2-mod-manager/issues) for anything
public, and a [private advisory](SECURITY.md) for anything exploitable.
