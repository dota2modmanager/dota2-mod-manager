# Architecture

How the app is put together, and why it is put together that way. Written for somebody who wants
to change it. The individual files carry the fine detail in their header comments; this is the map
between them.

## The shape

Electron, three processes, one bridge.

```
main.js          Electron lifecycle, the window, every ipcMain handler, auto-update, deep links
  └─ src/*.js    everything that touches disk, network or the game folder
preload.js       the only channel between the two sides: window.api, built with contextBridge
renderer/        the interface: plain HTML, CSS and JavaScript, no build step, no framework
```

The renderer can do nothing on its own. It has no Node integration, no file access and no network
beyond what `window.api` exposes, and the window refuses to navigate away from its own page. That
is not ceremony: the app renders guide text and mod names that come from a repository we do not
control, so the renderer is treated as a place where hostile strings end up.

## Where a feature lives

Anything a user can do to a mod touches three files, in this order:

1. `main.js` gets an `ipcMain.handle('mods:something', ...)` that calls into `src/`
2. `preload.js` exposes it as `api.mods.something`
3. `renderer/views/*.js` calls it and draws the result

Miss the middle one and the button exists but does nothing. The renderer is split by view
(`catalog.js`, `library.js`, `presets.js`, `settings.js`) with shared pieces under `renderer/ui/`.

## Where mods end up

Dota mounts one folder named after the language of its **voices**, and that folder is mounted
before the game's own content, which is what makes mods possible at all. The name comes from
`AudioLanguage` in `game/dota/cfg/boot.vcfg`, so `src/gamelang.js` reads that file rather than
guessing. A launch option cannot change it: `-language` sets a preference inside the game, and the
invented values older guides recommend (`dota_123`, `-language mods`) stopped mounting anything in
July 2026.

Inside that folder:

| What | Where it goes |
|---|---|
| A normal mod | `pakNN_dir.vpk`, slots 10 to 99 |
| A mod whose category must load early (trees, river, shaders, hero fx, ranged attack, hero items, optimization) | slots `pak02` to `pak09`, because a lower number wins |
| A terrain | its paks, plus the `maps/` folder it ships |
| A font | `game/dota/panorama/fonts`, originals backed up |
| A cursor | `game/dota/resource/cursor`, originals backed up |

Switching a mod off renames its file to `.off`, so the game skips it and the bytes stay. The
master switch uses a separate `.moff` suffix, on purpose: one state must never clobber the other,
or turning mods back on would resurrect the ones you had deliberately switched off.

## Installing one mod

`src/installer.js`, roughly in order:

1. Resolve the catalog entry to a URL and a file name. The name comes from a repository we do not
   own, so it is treated as a name and can never become a path.
2. Download through `src/net.js`, which tries mirrors when `raw.githubusercontent.com` is
   unreachable, and keeps the archive in the download cache keyed by that name. A second install of
   the same mod never leaves the disk. The built-in chain can be extended after a build has
   shipped: the signed `config/app.json` may name other places the archives are kept, which join
   the chain after our own copy and before the proxies. None of them is ever the origin, so what a
   host named there can do is serve a download or fail its checksum.
3. Open the archive through `src/safe-zip.js`, the single door every foreign zip comes through.
4. Compare its contents against what is already installed and report conflicts (see below).
5. Pick a free slot: low ones for categories that must load early, otherwise the first free number
   from 10 up. Combined packs exist for the same reason and are described in `src/vpk.js`.
6. Write everything through `src/file-tx.ts`.
7. Record it in `manifest.json` through `src/library.ts`.

## All of it or none of it

`src/file-tx.ts` is the reason the app can be trusted with a game folder. One install is five or
six writes, a removal is as many deletes, and switching a mod off renames every file it owns.
A failure halfway through, a locked file because Dota just started, a full disk, an antivirus
holding a handle, used to leave the folder in a state the game would happily load half of.

Every change to the game folder now goes through one transaction that either lands completely or
rolls back completely, including files that were displaced to make room. Nothing writes there
while `dota2.exe` is running, and the app checks that the game files are actually present before
it downloads anything, after a user moved his Steam library and had the app cheerfully install
forty three mods into the empty folder Steam left behind.

## VPK

`src/vpk.js` is a full reader and writer for Valve's v1 and v2 pack format, written here rather
than pulled in, and it is the piece most worth reading first. It parses the directory tree, reads
entries with their CRCs, writes single and multi-volume archives, merges a multi-volume mod into
one file, splits an archive that carries two heroes into one file per hero, and combines several
mods into a single pak so a hundred mods can share the slots.

Everything it writes is verified round trip in the tests, byte for byte, against real catalog
archives rather than synthetic ones.

## Knowing what a file is

Two mechanisms, for two different questions.

**What is in this archive?** `analyzeVpkPaths` reads the canonical paths inside a VPK and works
out which hero it changes and which equipment slots it replaces, so an imported file shows up as
"Nyx Assassin (model, arms, head, weapon)" instead of "unknown file".

**Is this the mod I think it is?** `fingerprintVpk` hashes the sorted list of `path:crc` pairs
from the index, which is independent of how the archive was packed, so the same mod downloaded
from the site and installed by hand produces the same fingerprint as ours. A published
`fingerprints.json`, regenerated by a scheduled workflow, maps fingerprints to catalog identities.
That is what lets the app adopt a file a friend installed by hand instead of demanding it be
deleted and downloaded again.

## Conflicts

Two mods that carry the same file cannot both win, and the game silently picks by slot number. The
app compares **contents, not paths**: a shared path only counts as a conflict when the CRCs
differ. Without that, every pair of mods looked like a conflict, because Valve's compiler bakes
the same stock materials into every VPK and authors carry the same filler particles between their
own mods. Paths were the first attempt, a blocklist of stock paths was the second, CRC comparison
is the one that works.

## The item schema and safe mode

Some things cannot be done from a language folder at all. The engine reads
`scripts/items/items_game.txt` through the MOD path only, so skinchanger-style sets with their own
effects and the free cosmetics the game already ships do nothing from where mods normally live.

Supporting them means registering another folder ahead of the game's content, which means editing
`gameinfo_branchspecific.gi` and re-signing it in `dota.signatures`. That is a change to Valve's
own files, so it is off until the user agrees to it once, which is what the safe mode switch in
the status bar means. `src/patcher.js` performs it and reverses it byte for byte, and
`src/schema-service.js` decides when the schema is rebuilt: always from the installed game's own
item table, never from a copy a mod happened to ship.

## Presets

A preset is the set of enabled mods, and it travels two ways.

**As a link.** `src/preset-link.js` encodes catalog identities, not file names, into
`d2mm://preset/<code>`: deflate, base64url, a code short enough for a chat message. Catalog file
names change when their author renames them; the identity triple does not. The clickable form is
an https page that hands the code to the app, because chat clients only linkify http and https.

**As a file.** `src/preset-share.js` writes `.d2mm`, a zip holding the manifest and, for anything
with no catalog identity, the mod itself. It is parsed as if it came from a stranger over Discord,
because it did: paths are matched against a strict pattern, a record that does not parse is
dropped whole rather than half trusted, and a buffer is validated as a VPK before it reaches the
game folder.

## The catalog is somebody else's

Mods, previews and guides come from [Dota2PornFxWeb](https://github.com/h6rd/Dota2PornFxWeb), and
when GitHub is unreachable they come through public proxies. That whole path is untrusted: guide
HTML goes through an allowlist of tags, and a file name from a catalog record is a name and not a
path. Who is allowed to have written the bytes in the first place is the next section.

## Who is allowed to have written this

Everything the app downloads travels a route it does not control. `raw.githubusercontent.com` is
slow or blocked for a good part of the userbase, so `src/net.js` falls back to public proxies,
and a proxy is a stranger handing over bytes that claim to be GitHub's. TLS proves you reached
the proxy. It says nothing about where the proxy got the file.

So each thing carries its own proof, and each has a different answer to a proof that fails.

| What | Proof | A failed check means |
|---|---|---|
| Catalog data: `mods.json`, `constants.json`, `guides.json`, `mod-hashes.json` | ed25519 signature by the catalog's author, public key pinned in `src/catalog-signature.ts` | keep the last good copy; on a first run, no catalog and an error |
| A mod archive | sha256 from the signed `mod-hashes.json` | drop that mirror's copy, delete the part file and ask the next mirror; refuse the mod only when every mirror fails the same check |
| `config/app.json`, the switches and notices this project can change after a release | ed25519 signature by this project's own key, pinned in `src/remote-config.js` | ignore the file, exactly as if it were unreachable |
| The Source 2 toolchain executable | version and sha256 pinned in `src/toolchain.js`, checked before anything is unpacked | do not unpack it; item icons fall back to the wiki |

The three answers differ because what each file costs differs. Without a catalog there is nothing
to show, so the app keeps yesterday's rather than nothing. Bytes that fail their hash never reach
a game folder. The switches are an improvement on knowing nothing, so a copy that cannot be
trusted is worth exactly as much as no copy, and the app carries on without it.

### A mirror can be wrong about a mod without the mod being wrong

A failed checksum says one host handed over the wrong bytes. It does not say the mod is bad, and
for the first day of hash checking the app treated the two as the same thing: the download
stopped on the first mismatch and the other mirrors, which had the right file, were never asked.

The bucket had gone stale to make that visible. `tools/r2-sync.mjs` skipped any object already
there under the same name, so 24 archives their author had replaced still sat in the bucket in
their old versions - one of them since August. Anybody who cannot reach GitHub is served from the
bucket first, got the old bytes, and watched the install stop with a checksum error while three
proxies carried the current file.

So `downloadFile` in `src/net.js` now spends the mirror rather than the mod: a wrong checksum
stands that host down for this file, the part file goes, and the next mirror is asked from the
start. Only a file that every mirror disowns is refused. And the sync compares what is here
against the size upstream reports, then measures the bytes it fetched against the published
checksum before uploading, so this bucket cannot be the reason a check fails.

*Check:* `test/net.test.js`, "a mirror serving a stale copy costs that mirror its turn".

### And the list can be wrong about the file

`mod-hashes.json` is rebuilt by a bot in the catalog's repository. On 2026-09-10 it named a hash
for `heroes/Axe Kratos.zip` that no copy of that archive has ever had - not GitHub's, not the
API's, not any proxy's - so that mod was refused for everybody, working GitHub included. One mod
in 1,178 checked, and complete for that one.

A published hash is worth having because a proxy is a stranger, and it proves the bytes are the
ones the catalog's author signed for. It proves nothing about GitHub itself: the list lives in
the same repository as the archives, so whoever could rewrite one could rewrite the other. So
when no copy matches, the file the catalog's own host serves is taken and the result is marked
unverified, rather than the mod being refused over a list that has not caught up.

The guarantee that survives, and the one that was actually worth having: no proxy can get bytes
installed that the catalog's own host did not serve. A mod hosted somewhere else entirely (the
catalog keeps its heaviest on Hugging Face) gets no such waiver, because there the published hash
is the only thing tying those bytes to the catalog. Neither does the app's own update or the
Source 2 toolchain: those hashes are pinned in this repository, and a mismatch there is the thing
being guarded against.

*Check:* `test/net.test.js`, "a published hash no copy matches is a stale list, and the origin
wins", next to the three tests that say who does not get that treatment.

### And the cache in front of the mirror has its own copy

Writing a new object into R2 does not change what Cloudflare has already handed out, and `.zip`
and `.vpk` are among the extensions it caches without being asked. So a replaced archive keeps
arriving from the edge in its old form until that entry expires: measured on 2026-09-10, one of
the twenty-three archives refreshed that day was still being served in its 28 August version an
hour later.

`tools/r2-sync.mjs` now purges every object it replaced, and only those - an object nobody could
have downloaded yet is in no cache. It needs `CLOUDFLARE_ZONE_ID` and a token allowed to purge
that zone; without them the run says which objects wanted purging and finishes green, because a
sync that copied everything correctly is not a failed sync.

The app is not relying on any of this. A copy that fails its checksum costs the mirror its turn
either way. This is so the mirror stops being wrong, not so the app stops coping.

*Check:* `test/r2-purge.test.js`, and `curl -sI https://cdn.dota2modmanager.com/assets/files/<a
recently changed archive> | grep cf-cache-status`.

### The archives the list has not caught up with

`mod-hashes.json` is rebuilt by a bot after mods are added, so the newest archives are not in it
yet: 21 of 992 on the day it arrived. Those fall back to what the app did before the list
existed, which is to remember the sha256 of the first copy it ever downloaded and refuse
different bytes under that name afterwards. That catches a substitution on every download except
the first. Refusing them instead would break the newest mods for everyone until somebody else's
bot ran.

### Data and its signature can arrive from different moments

The catalog writes a file and its signature in one commit, so the repository is never
inconsistent. `raw.githubusercontent.com` is: it caches and purges per file, and on 2026-09-10 it
served this project its own config from one commit and that config's signature from the one
before, for minutes after the push. A cache-busting query string does not shake it loose.

To a signature check that looks exactly like a forgery. So `Catalog.fetchSigned` asks again from
the one source that cannot be half-updated: the site's own copy at `dota2modmanager.com/mirror/`,
which goes out in a single deploy. It can be a day behind, and a day-old catalog that verifies
beats no catalog at all. Whoever rewrote a proxy did not write the site, so a real forgery fails
there too.

### Where the keys are

Two pinned public keys, both in the source and both meant to be read: the catalog's author holds
the private half of the first, this project holds the private half of the second outside the
repository. `*.pem` is in `.gitignore` and a test walks the tree to make sure neither private
half was ever committed. `tools/sign-catalog.js` is the whole signing side, has no dependencies,
and is what the catalog's author runs.

Editing `config/app.json` without re-signing it would publish a file every client quietly
refuses, and nobody would notice until a switch was needed. `test/remote-config-signature.test.js`
fails the build instead, and prints the command that re-signs it.

What none of this covers is in [DECISIONS.md](DECISIONS.md) under Known gaps, including the one
that matters most to a new user: the installer itself carries no code-signing certificate.

## Surviving a patch

A game update overwrites the search-path patch and moves the item table underneath the built
schema. `src/patch-watch.js` notices the update while the app is open, because Steam patches in
the background and most people press Play in Steam, and the repair runs by itself.

## Updates

The installed build updates through `electron-updater` from GitHub Releases. The portable build
deliberately does not: an unsigned executable that renames and relaunches itself is the shape
antivirus vendors flag, and this project has already had one false positive. It downloads the new
build next to the old one instead and says so (`src/portable-update.js`).

## Checks, tests and the sandbox

`npm run lint` is eslint with no style rules at all: `no-undef` and a short list of others that
answer whether a line will throw the first time somebody reaches it. It runs before the suite,
because when it fails there is nothing below it worth reading.

`npm test` is plain `node:test`, no framework, more than 80 files, run on every push and every pull request
on Linux and on Windows. Five of them hold this project against itself rather than testing a
module: the IPC contract (every channel has a handler, every handler runs, and `main.js` passes
what each module unpacks), the renderer's imports, the release contract, `DECISIONS.md`
against the repository it describes, and the write-ups in `docs/incidents/` against the tests
and workflow steps they name as guards.

`tools/sandbox.js` builds a throwaway Dota tree with the real game's `gameinfo.gi` and a
`pak01_dir.vpk` built from its own item table, then downloads real catalog mods into it. Install,
load order, packs, the schema patch and language folders are tested there rather than against
anybody's actual installation. See [CONTRIBUTING.md](CONTRIBUTING.md).

`tools/e2e.mjs` drives the app in that tree the way a player does. It writes a fixture catalog and
a fixture archive into the app's caches, starts the app twice, and clicks: install, switch off,
restart, switch on, remove. After each launch it compares the language folder on disk with what
should be there. No network is involved. `.github/workflows/e2e.yml` runs it on Linux and on
Windows, and both jobs have to pass before a pull request merges and before a release builds.

`tools/sim/` runs the app on simulated machines. A machine is a screen (the work area and the
scale Windows would give the window) and a renderer (the Chromium switches that decide how the page
reaches the graphics card), both listed in `tools/sim/profiles.json`. Scenarios drive the real
window with real input events and check what a person would see: `scroll` flicks through the
463 hero mods, then compares each resting frame with a forced repaint of it, which is how stale
tiles on some graphics drivers show up, and checks that the end of the list is inside the window
and the window inside the screen. `browse` visits every section, category, the search and the mod
window. `mods` installs seven real mods from their cards, reorders two that replace the same file,
switches them off and removes them. `presets` saves a preset, applies it over a changed state and
again after one of its mods was deleted. `import` picks renamed catalog mods in the file dialog
and a folder of them (the dialog's answer is played by `tools/sim/steps.js`), checks the app
recognises and links them, and cancels once. `settings` switches the language and reads every screen
for text left in the other one, and changes the scale and the switches. `game-session` plays the
game starting, quitting and being updated or checked by Steam (`tools/sim/world.js`). The first
machine of a set runs every scenario; the others run the ones a screen or a renderer can change
(`looks` in the profiles). `tools/sim/dota.js` is a model of the game's
loader, run over the sandbox after each step: what it mounts, which pack wins each file, whether
our packs' bytes match their CRCs, and whether the item schema points at files the game can load.
Every scenario also fails on an error in the page's console. `npm run sim` runs the set for this
system and writes `e2e-output/sim/index.html`.

## On disk

```
%APPDATA%/Dota 2 Mod Manager/
  settings.json      the game path, the language folder, UI preferences
  manifest.json      installed mods, pack members, presets
  downloads/         the archive cache, keyed by catalog file name
  packs/             the source VPK of each member of a combined pack
  backups/           the originals of any Valve file the app replaced
  tools/             external tools, downloaded on demand
```

The portable build puts the same tree next to its executable, and falls back to `%APPDATA%` when
that location is not writable.

## File map

| File | What it owns |
|---|---|
| `main.js` | Electron lifecycle, window, deep links, auto-update, and wiring the rest together |
| `src/ipc-*.js` | The IPC handlers, one file per group of channels, each naming what it needs |
| `src/feature-gate.js` | Whether a feature has been switched off from `config/app.json`, asked once |
| `preload.js` | The `window.api` surface, and nothing else crosses |
| `src/installer.js` | Download, slots, install, enable, remove, packs |
| `src/beta.ts` | Who the beta channel is offered to, from the signed list of Discord accounts, and which update feed a copy reads |
| `src/overlays.js` | Fonts and cursors: files written over the game's own, their kept originals, and putting them back after Steam's file check |
| `src/import.js` | Taking a mod in: a `.vpk`, a `.zip`, an author's folder, or bytes off a drop |
| `src/cursors.ts` | Which cursor set is live, which look a slot wears, and the repair at startup |
| `src/adopt.js` | What a VPK goes through before it counts as a mod: named, harvested, split |
| `src/updater.js` | Where an installed copy looks for a new version: the two feeds, and the channel it reads |
| `src/vpk.js` | The VPK format: read, write, merge, split, combine, fingerprint |
| `src/file-tx.ts` | One transaction per change to the game folder |
| `src/library.ts` | `manifest.json`: installed records and presets |
| `src/settings.ts` | `settings.json` and its defaults |
| `src/catalog.js`, `src/catalog-signature.ts` | Catalog data and who is allowed to change it |
| `src/net.js` | Downloads, mirrors, backoff |
| `src/remote-config.js` | The switches and notices this project can change after a release, the version ranges a switch can be held to, and the signature over them |
| `tools/sign-catalog.js` | The signing side, for whoever holds a private key |
| `src/safe-zip.js` | Every foreign archive comes through here |
| `src/steam.ts` | Finding Steam and the game, and proving the folder is really a game |
| `src/gamelang.js` | Which folder Dota will mount, and moving mods across when that changes |
| `src/patcher.js`, `src/schema.js`, `src/schema-service.js` | Search-path patch, signatures, item schema |
| `src/patch-watch.js` | Noticing a game update and repairing after it |
| `src/fingerprints.js` | Recognising a file somebody else installed |
| `src/preset-link.js`, `src/preset-share.js` | Presets as a link and as a file |
| `src/portable-update.js` | Updating the portable build without self-overwrite |
| `src/diagnostics.js` | The diagnostic archive a bug report should carry |
| `src/i18n.js`, `renderer/i18n.js` | Russian and English, for the main process and the window |
| `renderer/views/*` | Catalog, My mods, Presets, Settings |
| `renderer/ui/*` | Dialogs, toasts, the media player, the install queue, shared chrome |
| `tools/sandbox.js` | The throwaway game tree |
| `tools/e2e.mjs`, `test/fixtures/e2e/*` | Installing, switching and removing a mod by clicking through the real window, offline, in the sandbox |
| `tools/r2-sync.mjs`, `tools/r2-release.mjs`, `tools/r2-client.js`, `tools/mirror-plan.js` | The archive mirror, the update mirror, the signing they share, and which archives the mirror copies again or refuses |
| `tools/gen-fingerprints.js` | Regenerating the published fingerprint map |
| `tools/seo-report.mjs`, `tools/seo-state.mjs` | The weekly reach and search report posted to [issue #3](https://github.com/dota2modmanager/dota2-mod-manager/issues/3), and the numbers it carries from one week to the next inside the comment |
| `tools/release-gate.mjs` | First job of every release: waits until the tagged commit has passed the checks in `.github/required-checks.json`, and refuses it otherwise |
| `tools/check-credentials.mjs`, `tools/google-auth.mjs` | Every morning before the radar: tries each secret against its service and writes what works, what fails and when each expires, for the radar to report |
| `tools/virustotal.mjs` | Reads what the antivirus engines say about each published release and writes the report into its notes; skipped when no key is set |
| `tools/radar.mjs` | The daily "Project status" issue and the maintainer's overdue alerts; reads expiry dates from `.github/credentials.json` and lists a closed `regression` issue that no file in `docs/incidents/` names |
| `tools/pr-test-rule.mjs` | The pull request check that a fix changes a test or says why it cannot |
| `tools/gen-doc-facts.js` | Writes the sentences in the READMEs that come from `package.json`, between `facts:` markers |
| `tools/sync-labels.mjs` | Makes the repository's labels match `.github/labels.json` |
| `tools/typecheck.mjs` | Runs `tsc --checkJs` over the JSDoc and holds the error count per file at or below `.github/typecheck-baseline.json` |
| `tools/fuzz-parsers.mjs` | Throws damaged VPK indexes at the tree walkers and damaged zips at the archive door for as long as you let it, from a seed, and keeps anything they mishandle |
| `tools/coverage.mjs` | Runs the suite and holds coverage per file and per platform against `.github/coverage-baseline.json`, plus the aggregate floor everywhere |
| `tools/size-budget.mjs` | Holds the five largest files at the length in `.github/size-budget.json`, and stops a sixth crossing 800 lines unnoticed |
| `tools/mutate.mjs` | Breaks one promise at a time from `.github/mutants.json` and fails where no test goes red, or where the mutant no longer applies to the code it names |
| `tools/rollback.mjs` | Switches a feature off for the broken releases only, or everywhere, writes and signs `config/app.json`, and refuses a range old copies cannot read or a key the app does not pin |
