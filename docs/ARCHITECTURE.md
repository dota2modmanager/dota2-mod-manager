# Architecture

How the app is put together, and why it is put together that way. Written for somebody who wants
to change it. The individual files carry the fine detail in their header comments; this is the map
between them.

## The shape

Tauri, one Rust core, one bridge.

```
src-tauri/src/     the app around the core: the window, the tray, updates, dialogs, the bridge
  └─ crates/mm-core/src/owner/   the state the window talks to, and every channel it answers
       └─ crates/mm-core/src/    everything that touches disk, network or the game folder
preload.js         window.api, run in the page against src-tauri/src/bridge.js
renderer/          the window: TypeScript and React, built by Vite into out/renderer-tauri
crates/mm-cli/     the same Rust functions from the command line, for the tests and the tools
```

Many Rust files name the TypeScript they were ported from, as `(src/gamelang.ts)` or
`src/services.ts electronRepaint`. That code left the tree in 4.0. It is at the tag `v3.8.0`:
`git show v3.8.0:src/gamelang.ts`.

The renderer can do nothing on its own. It has no file access and no network beyond what
`window.api` exposes, and the window may show only its own page. That is not ceremony: the app
renders guide text and mod names that come from a repository we do not control, so the renderer is
treated as a place where hostile strings end up.

So the core does not trust it either. Every call arrives as one Tauri command and is answered by
the owner only when its arguments fit the channel's entry in
`crates/mm-core/src/owner/channel_args.rs`: types, sizes, the keys of an object, and for
`settings:set` the eight settings the window has a control for, so the game folder and the Discord
account are not one call away from a script. A channel with no entry there is refused.
`src-tauri/capabilities/main.json` grants the page the few Tauri permissions it needs and nothing
else, and the window e2e fails on any refusal in the app's log.

### The Rust code by folder

`crates/mm-core/src` is grouped by subject. Each folder's `mod.rs` says what belongs there, and
`lib.rs` re-exports every module under its old name, so `mm_core::vpk` and `crate::kv` keep working.

| Folder | Files | What is in it |
|---|---|---|
| `app/` | 22 | The app itself: settings, language, its window and tray, updates, logs, support and Discord. |
| `arcana/` | 11 | Arcanas, personas and their bases, gems and the rank look. |
| `catalog/` | 15 | The mod catalog and everything fetched over the network: mirrors, the remote config, pictures, counters, links. |
| `formats/` | 19 | File formats the game and the tools speak: KeyValues, VPK, compiled resources, textures, images, archives. |
| `game/` | 18 | Dota on this machine: finding it, its language folders, gameinfo and signatures, watching it run and patch. |
| `install/` | 21 | Putting mods into the game and keeping the record of them: the installer, the library, imports and removal. |
| `item_builder/` | 25 | The item builder: what a pick writes, its effects, styles, sets, sounds and the look on everybody. |
| `looks/` | 33 | Looks beyond items: the menu, the map, the HUD, cursors, recolours, effect edits. |
| `models/` | 30 | Models, particles and the 3D preview. |
| `owner/` | 30 | The state the window talks to: one owner of settings, the library and the services, and its channels. |
| `presets/` | 8 | Presets: links, .d2mm files, the plan, ready-made sets. |
| `schema/` | 13 | The item table (items_game): reading, merging, building and deploying it, and undoing a build. |
| `tools/` | 7 | Valve's tools and the programs the app runs: the resource compiler, Wine, Workshop Tools, the creator. |
| `util/` | 4 | Small helpers shared by everything: JavaScript-compatible behaviour, memoising, bundled data. |

## Where a feature lives

Anything a user can do to a mod touches four places, in this order:

1. A `crates/mm-core/src/owner/owner_*.rs` module answers the channel (`mods:something`) by
   calling into `crates/mm-core/src/`, and `crates/mm-core/src/owner/channel_args.rs` says what it
   may be handed
2. `preload.js` exposes it as `api.mods.something`
3. `renderer/api/` gives it a type: what it takes and what its handler answers
4. `renderer/views/` calls it and draws the result

Miss the second and the button exists but does nothing; miss the third and TypeScript refuses the
call. The renderer is split by view
(`catalog.ts`, `library.ts`, `presets.ts` and `settings.ts`, the larger ones with their parts in a
folder of the same name) with shared pieces under `renderer/ui/`. Each draws with React components
from the folder of its name under `renderer/`: `catalog/`, `library/`, `presets/`, `settings/`,
`studio/`.

## Where mods end up

Dota mounts one folder named after the language of its **voices**, and that folder is mounted
before the game's own content, which is what makes mods possible at all. The name comes from
`AudioLanguage` in `game/dota/cfg/boot.vcfg`, so `crates/mm-core/src/game/gamelang.rs` reads that file rather than
guessing. A `-language X` in Steam's launch options overrides it: when X is a language Dota knows,
the engine mounts `dota_X` whatever boot.vcfg says, and the app follows it rather than fight it
(`modFolderFor` in `crates/mm-core/src/game/gamelang.rs`). The invented values older guides recommend (`dota_123`,
`-language mods`) stopped mounting anything in July 2026.

Inside that folder:

| What | Where it goes |
|---|---|
| A normal mod | `pakNN_dir.vpk`, slots 30 to 99 |
| A mod whose category must load early (trees, river, shaders, hero fx, ranged attack, hero items, optimization) | slots `pak02` to `pak29`, because a lower number wins; when those are full, the first free slot after them |
| The app's own pak | `pak64_dir.vpk`, the game's anti-cheat notice in plain words (`crates/mm-core/src/app/notice_text.rs`), never given to a mod |
| Minify's | `pak65` to `pak67` stay Minify's, so the two apps can share one folder |
| A terrain | its paks, plus the `maps/` folder it ships |
| A font | `game/dota/panorama/fonts`, originals backed up |
| A cursor | `game/dota/resource/cursor`, originals backed up |

Switching a mod off renames its file to `.off`, so the game skips it and the bytes stay. The
master switch uses a separate `.moff` suffix, on purpose: one state must never clobber the other,
or turning mods back on would resurrect the ones you had deliberately switched off.

## Installing one mod

`crates/mm-core/src/install/installer.rs`, roughly in order:

1. Resolve the catalog entry to a URL and a file name. The name comes from a repository we do not
   own, so it is treated as a name and can never become a path.
2. Download through `crates/mm-core/src/catalog/net_fetch.rs`, which tries mirrors when `raw.githubusercontent.com` is
   unreachable, and keeps the archive in the download cache keyed by that name. A second install of
   the same mod never leaves the disk. The built-in chain can be extended after a build has
   shipped: the signed `config/app.json` may name other places the archives are kept, which join
   the chain after our own copy and before the proxies. None of them is ever the origin, so what a
   host named there can do is serve a download or fail its checksum.
3. Open the archive through `crates/mm-core/src/formats/safe_zip.rs`, the single door every foreign zip comes through.
4. Compare its contents against what is already installed and report conflicts (see below).
5. Pick a free slot: 02 to 29 for categories that must load early, otherwise the first free number
   from 30 up (`crates/mm-core/src/install/slot_zones.rs`). Combined packs exist for the same reason and are described in `crates/mm-core/src/formats/vpk_pack.rs`.
6. Write everything through `crates/mm-core/src/install/file_tx.rs`.
7. Record it in `manifest.json` through `crates/mm-core/src/install/library.rs`, inside the same transaction as the files.

## All of it or none of it

`crates/mm-core/src/install/file_tx.rs` is the reason the app can be trusted with a game folder. One install is five or
six writes, a removal is as many deletes, and switching a mod off renames every file it owns.
A failure halfway through, a locked file because Dota just started, a full disk, an antivirus
holding a handle, used to leave the folder in a state the game would happily load half of.

Every install, removal, switch and move between slots goes through one transaction that either
lands completely or rolls back completely, including files that were displaced to make room. Moves
between slots joined on 2026-10-01, after a test that refused each rename in turn found a swap that
could write one mod over another. The master switch is the one sweep outside: it only ever adds or
strips its own suffix, so a sweep that stops half way is finished by the next press. Nothing writes
there while `dota2.exe` is running, and the app checks that the game files are actually present
before it downloads anything, after a user moved their Steam library and had the app cheerfully
install forty three mods into the empty folder Steam left behind.

A transaction also outlives the process that ran it. Each step is written to a journal in
`userData/tx/` before it is taken (`crates/mm-core/src/install/file_tx.rs`), so an app killed halfway, from Task
Manager, by Windows Update or by a power cut, is undone on the next start before anything reads the
library or touches the folder; one killed after its commit line is finished instead. The library
record is a step of the same transaction, so an install cannot leave paks without a record or a
record without its paks. `crates/mm-core/src/install/file_tx.rs` kills each kind of change at every write the
process makes, recovers, and checks the game folder and the library byte for byte against the state
before the change and after it. `manifest.json` and `settings.json` outside a transaction are
replaced in one rename (`crates/mm-core/src/install/atomic_file.rs`), so a save cut short leaves the old file whole.

## VPK

`crates/mm-core/src/formats/vpk.rs` is a full reader and writer for Valve's v1 and v2 pack format, written here rather
than pulled in, and it is the piece most worth reading first. Every caller imports it from there;
the code sits in the files behind it: `crates/mm-core/src/formats/vpk.rs` (the index and entries), `crates/mm-core/src/catalog/fingerprints.rs`
(what a mod is, whatever it is packed as),
`crates/mm-core/src/formats/vpk_pack.rs` (building, packing a folder, combining, merging, splitting) and
`crates/mm-core/src/formats/vpk_analyze.rs` (which heroes and slots a mod's paths touch). It parses the directory tree, reads
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
`fingerprints.json`, regenerated by a scheduled workflow on the `catalog-data` branch, maps
fingerprints to catalog identities.
That is what lets the app adopt a file a friend installed by hand instead of demanding it be
deleted and downloaded again.

## Conflicts

Two mods that carry the same file cannot both win, and the game silently picks by slot number. The
app compares **contents, not paths**: a shared path only counts as a conflict when the CRCs
differ. Without that, every pair of mods looked like a conflict, because Valve's compiler bakes
the same stock materials into every VPK and authors carry the same filler particles between their
own mods. Paths were the first attempt, a blocklist of stock paths was the second, CRC comparison
is the one that works.

## The item schema and the item table switch

Some things cannot be done from a language folder at all. The engine reads
`scripts/items/items_game.txt` through the MOD path only, so skinchanger-style sets with their own
effects and the free cosmetics the game already ships do nothing from where mods normally live.

Supporting them means registering another folder ahead of the game's content, which means editing
`gameinfo_branchspecific.gi` and re-signing it in `dota.signatures`. That is a change to Valve's
own files, so it is off until the user agrees to it once. Since 3.0 there is no switch in the
status bar: the first look, set or preset that needs the table asks (`renderer/ui/game-files.ts`),
and Settings, Game files turns it back off. `crates/mm-core/src/game/patcher.rs` performs it and reverses it byte for byte, and
`crates/mm-core/src/schema/schema_service.rs` decides when the schema is rebuilt: always from the installed game's own
item table, never from a copy a mod happened to ship.

It is rebuilt on every pick, switch and removal, so `crates/mm-core/src/schema/schema_build.rs` keeps each item builder
pick as it was built, by item and effects, until the game or the app changes, and builds from the
window run on a worker thread, so the window keeps drawing while one runs (a build that held the
window's thread for seconds left it black after an update, issue #286). A newer request stops an
older build before it writes (`refresh_schema_in_background` in `crates/mm-core/src/owner/mod.rs`),
and Play waits for the last build. At start and after a Dota patch the repair builds behind the open window.

### Compiling what has no base

An arcana base (`crates/mm-core/src/arcana/arcana_bases.rs`) is the arcana taken apart and compiled again by hand, so
that every file sits at a path the plain hero reads. An arcana nobody has made one for can go
through the same compiler, Valve's `resourcecompiler.exe` from the Workshop Tools, and
`crates/mm-core/src/tools/resource_compiler.rs` runs it: sources are written into an addon of ours,
`content/dota_addons/d2mm_<id>/` of the install the compiler belongs to, compiled one at a time
into `game/dota_addons/d2mm_<id>/`, read back as VPK entries, and both folders are deleted whether
the compile worked or not. The compiler is never downloaded, because it is Valve's and not open
source: it is the game's own (`game/bin/win64`), or one picked in Settings through a dialog of the
main process, never a path from the window. The tools exist only for the Windows build of Dota:
on Linux Steam installs them while Dota runs through Proton, and the compiler runs under Wine, in a
prefix of the app's own in `userData/wine` made once with `wineboot` (`crates/mm-core/src/tools/wine.rs`). Going back to
the Linux build to play, Steam deletes the Windows files and the compiler with them, so once the app
has seen the tools it copies what only the Windows build has into `userData/workshop-tools`:
`game/bin` (about 700 MB), and of `game/dota` and `game/core` their `bin/win64`, DX11 shaders,
`.fgd` files and tools asset list (456 MB more; the whole difference between the two builds there).
Every other entry of those two is a link to the user's game, made again on each use, and the copy
runs whenever the game's own is gone (`crates/mm-core/src/tools/workshop_tools.rs`). The Check
button in Settings compiles an empty model through all of it, counting its steps on the bar at the
bottom, and the answer is kept until another compiler is picked or a patch replaces it. Taking the item's model apart into
those sources (Source 2 Viewer's export) is the next half and is not here yet.

## Presets

A preset is the set of enabled mods, and the looks from the game that were on, kept slot by slot
(`crates/mm-core/src/install/library.rs` picksOn). Applying one switches its mods on and every other mod off, and the same
for the looks: each of its own on in its slot, every other one off, kept in My mods. A preset of 20
is 20 whatever was on before. It travels two ways.

**As a link.** `crates/mm-core/src/presets/preset_link.rs` encodes catalog identities, not file names, into
`d2mm://preset/<code>`, and a look as its slot and item: deflate, base64url, a code short enough for a chat message. Catalog file
names change when their author renames them; the identity triple does not. The clickable form is
an https page that hands the code to the app, because chat clients only linkify http and https.

**As a file.** `crates/mm-core/src/presets/preset_share.rs` writes `.d2mm`, a zip holding the manifest and, for anything
with no catalog identity, the mod itself. It is parsed as if it came from a stranger over Discord,
because it did: paths are matched against a strict pattern, a record that does not parse is
dropped whole rather than half trusted, and a buffer is validated as a VPK before it reaches the
game folder.

A single mod has a link of its own, `d2mm://mod/<category>/<name>[/<look>]`, each part
URL-encoded (`crates/mm-core/src/catalog/deep_links.rs` parseModLink). It installs nothing either: the window opens the
catalog on the mod's category with the mod's window on top, on the look the link names. A link
that started the app waits in `renderer/views/catalog.ts` until the catalog has loaded, and a mod
behind the adult question stays behind it.

## The catalog is somebody else's

Chinese item labels are resolved from Valve's installed localization by `crates/mm-core/src/item_builder/cosmetic_names.rs`.
The renderer's `renderer/ui/cosmetic-name.ts` uses these labels for display and bilingual search,
keeping canonical names for icon lookup, favourites and saved picks. Missing names keep English.

Mods, previews and guides come from [Dota2PornFxWeb](https://github.com/h6rd/Dota2PornFxWeb), and
when GitHub is unreachable they come through public proxies. That whole path is untrusted: guide
HTML goes through an allowlist of tags, and a file name from a catalog record is a name and not a
path. Who is allowed to have written the bytes in the first place is the next section.

In Chinese, `renderer/ui/catalog-name.ts` supplies display labels for catalog titles, styles and
groups from the locale JSON dictionaries. Search accepts both labels and original names; record
keys, downloads and saved styles remain canonical. `renderer/ui/guide-name.ts` translates known
guide strings by exact match before the existing HTML sanitizer, preserving commands and links.

## Who is allowed to have written this

Everything the app downloads travels a route it does not control. `raw.githubusercontent.com` is
slow or blocked for a good part of the userbase, so `crates/mm-core/src/catalog/net_fetch.rs` falls back to public proxies,
and a proxy is a stranger handing over bytes that claim to be GitHub's. TLS proves you reached
the proxy. It says nothing about where the proxy got the file.

So each thing carries its own proof, and each has a different answer to a proof that fails.

| What | Proof | A failed check means |
|---|---|---|
| Catalog data: `mods.json`, `constants.json`, `guides.json`, `mod-hashes.json` | ed25519 signature by the catalog's author, public key pinned in `crates/mm-core/src/catalog/catalog_signature.rs` | keep the last good copy; on a first run, no catalog and an error |
| A mod archive | sha256 from the signed `mod-hashes.json` | drop that mirror's copy, delete the part file and ask the next mirror; refuse the mod only when every mirror fails the same check |
| `config/app.json`, the switches and notices this project can change after a release | ed25519 signature by this project's own key, pinned in `crates/mm-core/src/catalog/remote_config.rs` | ignore the file, exactly as if it were unreachable |
| `config/presets.json`, the ready-made presets the Presets screen offers | ed25519 signature by the same key, checked in `crates/mm-core/src/presets/ready_presets.rs` | keep the last good list, or show none |
| The item builder's hero bases: `manifest.json` in `dota2modmanager/hero-base-fixes` | ed25519 signature by the bases' author, a key of its own pinned in `crates/mm-core/src/arcana/arcana_base_store.rs` | keep the last good list and the bases already here; a base not here yet is built from the game's files |
| A hero base's file | git's hash of it, from that signed manifest | the base is not ready; asked for again in five minutes |
| The Source 2 toolchain executable | version and sha256 pinned in `crates/mm-core/src/tools/toolchain.rs`, checked before anything is unpacked | do not unpack it; item icons fall back to the wiki |

The three answers differ because what each file costs differs. Without a catalog there is nothing
to show, so the app keeps yesterday's rather than nothing. Bytes that fail their hash never reach
a game folder. The switches are an improvement on knowing nothing, so a copy that cannot be
trusted is worth exactly as much as no copy, and the app carries on without it.

### A mirror can be wrong about a mod without the mod being wrong

A failed checksum says one host handed over the wrong bytes. It does not say the mod is bad, and
for the first day of hash checking the app treated the two as the same thing: the download
stopped on the first mismatch and the other mirrors, which had the right file, were never asked.

The bucket had gone stale to make that visible. `tools/catalog/r2-sync.mjs` skipped any object already
there under the same name, so 24 archives their author had replaced still sat in the bucket in
their old versions - one of them since August. Anybody who cannot reach GitHub is served from the
bucket first, got the old bytes, and watched the install stop with a checksum error while three
proxies carried the current file.

So `downloadFile` in `crates/mm-core/src/catalog/net_fetch.rs` now spends the mirror rather than the mod: a wrong checksum
stands that host down for this file, the part file goes, and the next mirror is asked from the
start. Only a file that every mirror disowns is refused. And the sync compares what is here
against the size upstream reports, then measures the bytes it fetched against the published
checksum before uploading, so this bucket cannot be the reason a check fails.

*Check:* `crates/mm-core/src/catalog/net_fetch.rs`, "a mirror serving a stale copy costs that mirror its turn".

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

*Check:* `crates/mm-core/src/catalog/net_fetch.rs`, "a published hash no copy matches is a stale list, and the origin
wins", next to the three tests that say who does not get that treatment.

### And the cache in front of the mirror has its own copy

Writing a new object into R2 does not change what Cloudflare has already handed out, and `.zip`
and `.vpk` are among the extensions it caches without being asked. So a replaced archive keeps
arriving from the edge in its old form until that entry expires: measured on 2026-09-10, one of
the twenty-three archives refreshed that day was still being served in its 28 August version an
hour later.

`tools/catalog/r2-sync.mjs` now purges every object it replaced, and only those - an object nobody could
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
half was ever committed. `tools/catalog/sign-catalog.js` is the whole signing side, has no dependencies,
and is what the catalog's author runs.

Editing `config/app.json` without re-signing it would publish a file every client quietly
refuses, and nobody would notice until a switch was needed. `crates/mm-core/src/catalog/remote_config.rs`
fails the build instead, and prints the command that re-signs it.

What none of this covers is in [DECISIONS.md](DECISIONS.md) under Known gaps, including the one
that matters most to a new user: the installer itself carries no code-signing certificate.

## Surviving a patch

A game update overwrites the search-path patch and moves the item table underneath the built
schema. `crates/mm-core/src/game/patch_watch.rs` notices the update while the app is open, because Steam patches in
the background and most people press Play in Steam, and the repair runs by itself. The patch is
also rebuilt when it was copied from an older `gameinfo.gi` than the game has: build 6946 renamed
the language path key, and a patch from the day before stopped mounting the language folder.

The built table is rebuilt the same way when the app's own code changed, at the next start or press
of Play. Picks are kept as records and built from the game's files, so their models, sounds and
pictures are only as right as the code that built them: the stamp in settings names both the game's
item table and a fingerprint of `crates/mm-core/src/` (`builderStamp`). Before it, a fix to the item builder never
reached a pick until the pick was taken off and made again.

After the repair, `crates/mm-core/src/game/update_impact.rs` compares Valve's files that installed mods replace with
what the update shipped. A mod whose copies the patch changed or removed is marked "pre-patch" in
My mods and named in the banner about the update: it now puts old files back over new ones.

The game's own index only describes the build on disk: the one before it is gone the moment Steam
writes the new one. So the module keeps a note, `update-impact.json` in userData, of Valve's CRC
for every path an installed mod replaces. That is thousands of paths, not the 388 000 in the index,
and the index is read again only when it changed or a new mod brought paths the note lacks. The
mark stays until the mod's own file changes, or until its owner takes it off from the row's menu.
Nothing here goes over the network.

## Watching Dota updates

The app learns about a patch when it lands on the player's disk. This repository learns about it
when it ships, from [SteamTracking/GameTracking-Dota2](https://github.com/SteamTracking/GameTracking-Dota2),
which commits every Dota build as text within the hour: `steam.inf` with the build number,
`gameinfo.gi`, a listing of every file in `pak01` with its CRC and size, and the strings of the
game's binaries. Build 6946 renamed a search-path key in a public commit there the same hour;
this project heard about it from a Discord announcement that evening.

- `tools/mods/dota-diff.mjs` (`npm run dota:diff`) compares two builds. It leads with what the app's
  patch depends on: the search paths in `gameinfo.gi`, the search-path keys the engine reads
  (`engine2_strings.txt`), `gameinfo_branchspecific.gi` and the item table. Then the `pak01` diff
  by folder and by hero, and with `--mods`, which files of the given mods the update reached.
- `.github/workflows/dota-watch.yml` runs `tools/ops/dota-watch.mjs` twice an hour. A build the
  [Dota updates](https://github.com/dota2modmanager/dota2-mod-manager/issues/225) issue has not
  reported becomes a comment there, and the issue body remembers the last one. A change to what
  the patch is built from also messages the maintainer on Discord.
- The comment names the catalog mods that replace files the build changed or removed. Their file
  lists come from `mod-paths.json`, which the fingerprint job (`tools/catalog/gen-fingerprints.js`) writes
  to the `catalog-data` branch out of the archives it already downloads.

The app never asks GameTracking anything. If it goes away, the issue goes quiet and nothing a
player has changes ([DECISIONS.md](DECISIONS.md)).

## Updates

The installed build updates through Tauri's updater from GitHub Releases (`src-tauri/src/update.rs`, driven by `crates/mm-core/src/app/updater.rs`). The portable build
deliberately does not: an unsigned executable that renames and relaunches itself is the shape
antivirus vendors flag, and this project has already had one false positive. It downloads the new
build next to the old one instead and says so (`crates/mm-core/src/app/portable_update.rs`).

## Checks, tests and the sandbox

`npm run lint` is eslint with no style rules at all: `no-undef` and a short list of others that
answer whether a line will throw the first time somebody reaches it. It runs before the suite,
because when it fails there is nothing below it worth reading.

`npm test` is plain `node:test`, no framework, more than 80 files, run on every push and every pull request
on Linux and on Windows. Five of them hold this project against itself rather than testing a
module: the IPC contract (every channel has a handler, every handler runs, and `crates/mm-core/src/owner/mod.rs` hands each
module what it unpacks), the renderer's imports, the release contract, `DECISIONS.md`
against the repository it describes, and the write-ups in `docs/incidents/` against the tests
and workflow steps they name as guards.

`test/workflows.test.js` fails on a job with no `timeout-minutes`, so a hung step fails within its
limit instead of holding a check "pending" for GitHub's six hours. The e2e fails a launch whose
window script reported no steps.

`tools/dev/sandbox.js` builds a throwaway Dota tree with the real game's `gameinfo.gi` and a
`pak01_dir.vpk` built from its own item table, then downloads real catalog mods into it. Install,
load order, packs, the schema patch and language folders are tested there rather than against
anybody's actual installation. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Every launch against it is held to it. `npm run start:sandbox`, the e2e and the simulator start
the app with `--write-jail=sandbox`, and `crates/mm-core/src/app/write_jail.rs` then refuses every Node call that
would change the disk anywhere else (a write, either end of a rename, a delete, a folder, a file
opened for writing), judged by the real path, so `..` or a junction inside the sandbox pointing
out of it does not get past. Steam's detection is held to the same folders, so the app never sees
the real game in the first place. On 2026-10-03 a sandbox whose saved path had gone stale wrote
into the real game; `crates/mm-core/src/app/write_jail.rs` replays that with the folder check broken on purpose
and checks that the real game stays byte for byte as it was, and the e2e fails unless every launch
logged that it was held and none logged a refused write.

`tools/dev/e2e.mjs` drives the app in that tree the way a player does. It writes a fixture catalog and
a fixture archive into the app's caches, starts the app twice, and clicks: install, switch off,
restart, switch on, remove. Then it starts the app the way the uninstaller does and answers the
removal window three ways: Cancel (exit 3, nothing touched), nothing ticked (exit 0, the mod
stays), everything ticked (exit 4, the language folder and the game's own gameinfo files byte for
byte as before the first launch). After each launch it compares the disk with what should be
there. No network is involved. `.github/workflows/e2e.yml` runs it on Linux and on Windows, and both
jobs have to pass before a pull request merges and before a release builds.

The update is checked on the packages people install, not on the source tree. `release.yml`'s
`try-update` installs the last published release, gives it a mod and a favourite through its own
`window.api`, runs the draft's installer over it with `/S` as an update does, and runs
`tools/dev/e2e.mjs --upgrade`, which requires the new version to report itself and to find the mod, its
state and the favourite where the old one left them; then the uninstaller the new version installed
removes it. `.github/workflows/tauri-handover.yml` does the same with an installer built from the commit, on
a pull request that touches what an update goes through and weekly, so the release step has run
before a release depends on it.

The simulator that drove the Electron window on simulated machines went with
Electron in 4.0. The window is held by the end-to-end run above on every pull request.

## On disk

```
%APPDATA%/Dota 2 Mod Manager/
  settings.json      the game path, the language folder, UI preferences
  manifest.json      installed mods, pack members, presets
  downloads/         the archive cache, keyed by catalog file name
  packs/             the source VPK of each member of a combined pack
  backups/           the originals of any Valve file the app replaced
  tools/             external tools, downloaded on demand
  wine/              on Linux, the Wine prefix resourcecompiler.exe runs in
  workshop-tools/    on Linux, the copy of the Workshop Tools kept after Steam removes them
```

The portable build puts the same tree next to its executable, and falls back to `%APPDATA%` when
that location is not writable.

## File map

The Rust core is mapped by folder above (*The Rust code by folder*); each file's header comment
says what it owns. The rest:

| File | What it owns |
|---|---|
| `src-tauri/src/*.rs` | The app around the core: the window and tray, the updater, dialogs, the command line, the screenshot switches (`harness.rs`) |
| `src-tauri/src/bridge.js` | What `preload.js` runs against in the page: one Tauri command for every call, one event for everything the core sends |
| `crates/mm-cli/src/*.rs` | The core's functions from the command line: `mm-cli call`, the sandbox's builds and the mod kit |
| `preload.js` | The `window.api` surface, and nothing else crosses |
| `tools/catalog/sign-catalog.js` | The signing side, for whoever holds a private key |
| `renderer/settings/PreviewCacheBlock.tsx` | Optional per-hero preparation of the GLB and particle-resource disk cache via `preview3d:warm` |
| `renderer/app.ts`, `renderer/shell/*` | The window's start, and its own elements every screen reaches: the title bar, search, the switches, progress, drops, updates |
| `renderer/api/*` | What every channel the window calls takes and answers |
| `renderer/i18n.js`, `renderer/locales/*` | Russian, English and Simplified Chinese for the window; the core's own strings are `crates/mm-core/src/app/i18n.rs` |
| `renderer/catalog/*`, `renderer/library/*`, `renderer/presets/*`, `renderer/settings/*`, `renderer/studio/*`, `renderer/home/*` | The screens, in React; Home is where the window opens and where the name in the title bar leads; Items is the catalog screen with the game's looks (`renderer/views/catalog/sections.ts`), the Workshop gathers the tools built from the game's own files |
| `renderer/creator/*` | The author's window: drafts of mods for the catalog, the upload terms, and the submissions the catalog reports back, opened from the account menu |
| `tools/release/uploader-token.mjs` | The catalog uploader's token, encrypted into `build/stats/uploader-token.bin` for a release build and never committed |
| `renderer/views/*` | What each screen reads and does around its components |
| `renderer/ui/*` | Dialogs, toasts, the media player, the install queue, shared chrome |
| `renderer/core/*` | What the screens share: the store, the router, the records, the categories, the 18+ question |
| `renderer/motion/*` | How things move: travel, fold, swap, reveal |
| `renderer/styles/*`, `renderer/fonts/*` | The tokens every size and colour comes from, and the faces |
| `renderer/uninstall.html`, `renderer/uninstall.js`, `renderer/uninstall-bridge.d.ts` | The removal window, a classic script loaded without a build, and the types of the bridge its preload gives it |
| `tools/dev/sandbox.js` | The throwaway game tree |
| `tools/dev/e2e.mjs`, `test/fixtures/e2e/*` | Installing, switching and removing a mod by clicking through the real window, offline, in the sandbox |
| `tools/catalog/r2-sync.mjs`, `tools/release/r2-release.mjs`, `tools/catalog/r2-client.js`, `tools/catalog/mirror-plan.js` | The picture mirror, the update mirror, the signing they share, and which pictures the mirror copies again or refuses |
| `tools/catalog/gen-fingerprints.js` | Regenerating the published fingerprint map, and `mod-paths.json`, the files each pak mod replaces |
| `tools/mods/dota-diff.mjs`, `tools/ops/dota-watch.mjs` | What a Dota build changed, read from GameTracking-Dota2: by hand with `npm run dota:diff`, and twice an hour in the "Dota updates" issue |
| `tools/mods/recolor.mjs` | `npm run recolor`: the recolour, or with `--arcana` the whole arcana, as a VPK to import, before the window offers it |
| `tools/mods/clean-arcana-bases.mjs` | A compiled arcana base stripped to models, materials and particles, the editor's files, sounds, pictures and particles every hero shares moved aside |
| `tools/mods/pack-arcana-vpks.mjs` | Every base in a folder packed into a VPK with VPKTool, one at a time, each checked against the files it was made from |
| `tools/mods/arcana-bases-manifest.mjs` | manifest.json and its signature for the bases' repository: the only list of files and hashes the app takes, written and signed in one step |
| `tools/mods/dota-bench.mjs`, `tools/mods/dota-bench/*.ps1` | `npm run dota:bench -- --vpk <mod_dir.vpk>`: a mod tried in the real game on Windows with nobody at the keyboard: hero demo started with the mod in a free slot, the hero levelled, set on a dummy, its abilities pressed, and pictures taken, a burst of them through the swing, and whether the attack swings (`tools/mods/dota-bench/verdict.mjs`); a build's item table tried through `dota_mods` (`schema.mjs`), and a sound heard in what the game played (`record.ps1`, `hear.mjs`) |
| `tools/site/seo-report.mjs`, `tools/site/seo-state.mjs` | The weekly reach and search report posted to [issue #3](https://github.com/dota2modmanager/dota2-mod-manager/issues/3), and the numbers it carries from one week to the next inside the comment |
| `tools/release/release-gate.mjs` | First job of every release: waits until the tagged commit has passed the checks in `.github/required-checks.json`, and refuses it otherwise |
| `tools/ops/check-credentials.mjs`, `tools/ops/google-auth.mjs` | Every morning before the radar: tries each secret against its service and writes what works, what fails and when each expires, for the radar to report |
| `tools/release/virustotal.mjs` | Reads what the antivirus engines say about each published release and writes the report into its notes; skipped when no key is set |
| `tools/ops/radar.mjs` | The daily "Project status" issue and the maintainer's overdue alerts; reads expiry dates from `.github/credentials.json` and lists a closed `regression` issue that no file in `docs/incidents/` names |
| `tools/dev/gen-doc-facts.js` | Writes the sentences in the READMEs that come from `package.json`, between `facts:` markers |
| `tools/ops/sync-labels.mjs` | Makes the repository's labels match `.github/labels.json` |
| `tools/dev/typecheck.mjs` | Runs `tsc` over the four projects (the two preloads through their JSDoc, then the main process, the tests and the window, all three strict) and holds the error count per file at or below `.github/typecheck-baseline.json` |
| `tools/dev/fuzz-parsers.mjs` | Throws damaged VPK indexes at the tree walkers and damaged zips at the archive door for as long as you let it, from a seed, and keeps anything they mishandle |
| `tools/release/rollback.mjs` | Switches a feature off for the broken releases only, or everywhere, writes and signs `config/app.json`, and refuses a range old copies cannot read or a key the app does not pin |

### 3D loadout renderer

The preview uses `vendor/dota-loadout` as a local npm dependency, with desktop integration maintained in this repository. The TypeScript modules `renderer/catalog/preview3d/scene.ts`, `loadout-source.ts`, `loadout-textures.ts` and `loadout-controls.ts` own desktop data adaptation, cancellation and input. The vendored engine owns animation, bone merging, particles, material shading and HDR. `EffectStage.tsx` and effect thumbnails share that engine. The older independent runtime is retained for its existing regression tests, but is not used to render these views. No remote assets or iframe are used. See `vendor/dota-loadout/PROVENANCE.md`.
