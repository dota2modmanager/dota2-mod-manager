# Moving to Rust and Tauri

The app is moving from Electron + a TypeScript main process to Tauri 2 + Rust. This file is the
map: what the end state is, how the two halves run together until then, what has moved, and how
to move the next piece. Anyone picking the work up starts here.

## Why

Electron's main process both draws the window and runs the app. A long synchronous step (a pak
written, the item table rebuilt, pak01's 388 000-entry index walked) froze the window, which is
why `CLAUDE.md`-era rules say "never hold the main process longer than ~100 ms" and why
`src/steps.ts` exists (issue #286). The item builder, the 3D preview and the Workshop editors all
want more speed than that budget allows. Rust gives:

- the CPU work (VPK, KeyValues, items_game, hashing, builds) several times faster, and parallel;
- a window that never waits on it: Tauri commands run on a thread pool, the webview stays free;
- a ~10-15 MB installer instead of ~100 MB, less memory, a faster start.

What Rust does **not** change by itself: scrolling, view switches and the 3D preview are drawn by
WebView2, which is Chromium, the same engine as Electron's. Jank there is the page's own work
(re-renders, layers, animations) and is fixed in `renderer/`, whichever shell runs it.

## The end state

```
src-tauri/          the Tauri shell: window, commands, plugins (Rust)
crates/mm-core/     everything that reads or writes the game's files (Rust, no Tauri)
renderer/           the window's page, unchanged (React + Motion + Vite)
preload.js          window.api, kept as the one description of the API the page calls
```

No Node, no Electron, no `src/*.ts`. Every IPC channel answered in Rust.

## How it runs during the move

```
renderer (WebView2)
   │ window.api.*  (preload.js, run against src-tauri/src/bridge.js)
   ▼
Tauri command mm_invoke(channel, args)
   ├─ src-tauri/src/native.rs, ported.rs   channels Rust owns
   └─ src-tauri/src/sidecar.rs             everything else ─► node src-tauri/host/host.ts
                                                              └─ imports src/main.ts unchanged,
                                                                 with a stand-in for Electron
```

- `preload.js` is injected into the page as Tauri's initialization script with a stand-in
  `require('electron')` (`bridge.js`). The page gets the exact `window.api` it gets in Electron.
- `host.ts` runs the whole TypeScript main process under plain Node. `src/electron.ts` resolves
  Electron on each use, so the host answers that `require` with its own `app`, `ipcMain`,
  `BrowserWindow`, `dialog`, `shell`... Dialogs, links and the window itself are asked of Rust
  (`src-tauri/src/shell.rs`). Wire format: top of `host.ts`.
- Bytes cross both boundaries as `{ "$b64": "..." }`. An answer that is only bytes (a 3D
  preview slice, a video) leaves Rust raw (`tauri::ipc::Response`), and the page gets it as a
  `Uint8Array` without a second base64 pass.
- The host writes an invoke's answer on a line of its own (`R <id> j|b|e <json>`, `writeResult` in
  `host.ts`), and Rust hands the JSON text to the page without parsing it; only an answer with
  bytes inside is decoded again in the page. For `cosmetics:slots` (3.8 MB, every start of the item
  builder) that took the bridge from ~250 ms to ~50 ms on top of the host's own ~270 ms.
  `MM_TRACE=1` prints each answer's work and send time on the host's stderr
  (`tools/tauri-shot.mjs` passes it through).
- So the Tauri build works in full from the first commit, and every channel moved to Rust is a
  channel the host no longer answers. When the count reaches all of them, the host, Node and
  `src/` go.

The Electron build stays the one users get until the Tauri build covers everything and has
been through the sandbox and the e2e run. Both build from the same `renderer/`.

## Comparing a pure function

`crates/mm-core/src/calls.rs` names every ported function as `module.export` and takes its
arguments as JSON (a string of items_game text is its latin1 bytes; `{"$file": path}` reads a
file once). `mm-cli call list.json` answers a list of `[name, ...args]`, and
`test/rust-calls.test.ts` runs each case on both sides and compares. A new port adds its name
to `calls.rs` and its cases to the test: that is the whole parity check. The workspace builds
`serde_json` with `float_roundtrip`: without it a number like 93.33333333333333 is read a bit off,
and every answer computed from it differs from the TypeScript in the last place. The same entry point is
how the Tauri host can ask Rust for a function while its caller is still TypeScript.

## Status

`node tools/rust-progress.mjs` prints the live count and the channels left by group.

| Piece | Rust | Wired into the shell | Notes |
|---|---|---|---|
| Tauri shell, window, single instance, dialogs, links | done | yes | `src-tauri/` |
| Bridge (preload.js in the webview) | done | yes | `bridge.js` |
| TypeScript host behind the shell | done | yes | `src-tauri/host/` |
| `win:*` channels | done | yes | `native.rs` |
| VPK read/write/fingerprint (`src/vpk-read.ts`, `vpk-write.ts`, `vpk-fingerprint.ts`) | done | no | `crates/mm-core/src/vpk.rs`, parity test `test/rust-parity.test.js` |
| items_game reader (`src/schema-kv.ts`, `schema-items.ts`) | done | no | `crates/mm-core/src/kv.rs`, `schema.rs`; parity: all ~26 000 items equal, byte ranges included |
| items_game merge and check (`schema-merge.ts`) | done | no | `crates/mm-core/src/schema_merge.rs`; parity: real patches merge to the same bytes, conflicts and `validate` agree |
| KV3 read, numbers in place, blobs, write anew (`src/kv3*.ts`, `lz4.ts`) | done | no | `crates/mm-core/src/kv3.rs`, `lz4.rs`; parity `test/rust-parity-kv3.test.ts`: built blocks of versions 1, 2, 5 and ~200 of the game's particles, materials, models, sounds and animations give the same tree, the same bytes encoded back and written anew (zstd blocks: the same tree read back, since `ruzstd` compresses differently from Node) |
| compiled resources: blocks, RERL (`src/resource.ts`) | done | no | `crates/mm-core/src/resource.rs`; same parity test |
| strings and data tables (`i18n.ts`, `hero-names.ts`, the item builder's effects) | done | no | `i18n.rs`, `hero_names.rs`, `data.rs`; the tables are JSON in `crates/mm-core/data/`, written from the TypeScript by `node tools/rust-data.mjs` and checked by `test/rust-data.test.ts` |
| item builder: styles, donor effects, own and unusual effects, item visuals, localization tokens (`item-builder-styles.ts`, `-donor.ts`, `-effects.ts`, `-unusual.ts`, `unusual-effects.ts`, `item-visuals.ts`, `cosmetic-names.ts` pure part) | done | no | parity through `calls.rs`: `test/rust-calls.test.ts` runs every function on both sides over the sandbox's real items_game (and the game's localization when installed) |
| models: material set, cloth, attachments, sequence numbering (`model-skin.ts`, `model-cloth.ts`, `model-attachments.ts`, `model-sequences.ts`) | done | no | `model_*.rs`; parity: the same bytes (sha1) on ~200 of the game's item, courier and hero models, the courier numbering against all four donkeys |
| an item's material set, sounds and voice (`item-skin.ts`, `item-sounds.ts`) | done | no | `item_skin.rs`, `item_sounds.rs`; parity: every hero's response rules, real sound swaps from items_game, the soundevents files written alike |
| material expressions and recolouring (`material.ts`, `recolor.ts`, `recolor-sets.ts`) | done | no | `material.rs`, `recolor.rs`, sets in `data/recolor-sets.json`; parity: ~300 materials, ~400 particles in five modes, the whole VPK of each set |
| particle systems: the tree of a system, snapshots, attachment points (`particle-spec.ts`, `particle-snapshot.ts`) | done | no | `particle_spec.rs`, `particle_snapshot.rs`; parity: ~180 systems bound four ways, every hero script, ~40 snapshots (~8 000 points) |
| surface hitboxes and effects spread over them (`model-hitboxes.ts`, `particle-surface.ts`) | done | no | `model_hitboxes.rs`, `particle_surface.rs`, and `meshopt.rs`, meshoptimizer's vertex decoder (format versions 0 and 1); parity: 60 item models, 80 unusual effects, same bytes |
| effect edits, hero sound events, the loadout stage, packing a folder (`effect-edit.ts`, `ability-sounds.ts`, `hero-showcase.ts`, `vpk-pack.ts`) | done | no | `effect_edit.rs`, `ability_sounds.rs`, `hero_showcase.rs`, `vpk_pack.rs`; parity: ~120 systems edited two ways, every hero's events file written back as text; the stage's directions are within 4 ulps (V8 takes sine and cosine from glibc, Rust from fdlibm) |
| persona items made bigger and the persona scales (`model-scale.ts`, `personaScales`) | done | no | `model_scale.rs`, `item_builder_personas.rs`, and meshoptimizer's version 0 encoder in `meshopt.rs` (a tie between widths keeps the group before's, as `vertexcodec.cpp` does); parity: ~90 item and hero models at four scales, the same bytes as the WebAssembly's, and bodies compiled bigger measured alike |
| the item builder's offer: slots, persona slots, ability effects slots, arcana notes, item facts (`item-builder-slots.ts`, the slot halves of `-personas.ts` and `-ability-fx.ts`, `arcana-notes.ts`, `item-builder-details.ts`) | done | no | `item_builder_slots.rs`, `item_builder_ability_fx.rs`, `arcana_notes.rs`, `item_builder_details.rs`, bases in `data/arcana-bases.json`; names sort with ICU's root collation (`icu_collator`), as `localeCompare` does in Node; parity: the whole offer in ru and en, equal |
| what a pick writes: its block, its files out of pak01, ability effects picks, sets, kinetic gems, refits (`item-builder.ts`, `-assets.ts`, `-fx-patch.ts`, `-sets.ts`, `-kinetic.ts`, `-refits.ts`, `arcana.ts` asModel) | done | no | `item_builder.rs`, `item_builder_assets.rs`, `item_builder_fx_patch.rs`, `item_builder_sets.rs`, `item_builder_kinetic.rs`, `item_builder_refits.rs`, `arcana.rs`; a summon's plain model is resolved once per pak (`Summons`); parity: patches with effects, gems, donors, styles and targets, and the staged files compared by hash on the game's own pak01 |
| the rest of the item builder: everybody wearing the user's look, a persona's build records, ability effects slot names and merged picks (`item-builder-everyone.ts`, the build half of `-personas.ts`, `namedFxSlots`, `mergeFxPatches`) | done | no | `item_builder_everyone.rs`, `item_builder_personas.rs`, `item_builder_ability_fx.rs`; parity: six heroes dressed three ways, staged files by hash |
| arcana builds (`arcana.ts`, `arcana-sets.ts`) | done | no | `arcana.rs`, sets in `data/arcana-sets.json`; parity: every host with its children hung both ways, the forms, pictures, swaps and the whole VPK of each set in three colours, plus 60 particles that are no hosts, errors included |
| what a mod changes, read from its paths; pak01 stamps (`vpk-analyze.ts`, `pak-stamp.ts`) | done | no | `vpk_analyze.rs`, `pak_stamp.rs`; parity: the sandbox mods and slices of pak01 in ru, en and zh-CN |
| the game's own text: its tokens, style names, the Chinese cosmetic names (`cosmetic-names.ts`) | done | no | `cosmetic_names.rs`; parity: every language file of the sandbox and the game, read once per build |
| the gameinfo patch and the signature list as text (`patcher-gameinfo.ts`, `patcher-signatures.ts`) | done | no | `patcher_gameinfo.rs`, `patcher_signatures.rs`; parity: the sandbox's and the game's files patched, patched twice, stripped and restored against Valve's hashes, with a dozen broken variants of each |
| the game's language and Minify beside us (`gamelang.ts`, `gamelang-steam.ts`, `gamelang-folders.ts`, `minify.ts`) | done | no | `gamelang.rs`, `minify.rs`; parity: nine made-up Steam libraries (boot.vcfg, appmanifest, loginusers, launch options per account, language folders), and boot.vcfg written and mods moved on two copies of one tree, compared file by file |
| settings.json, manifest.json, writes that commit or roll back (`settings.ts`, `library.ts`, `file-tx.ts`, `file-tx-journal.ts`, `atomic-file.ts`) | done | no | `settings.rs`, `library.rs`, `file_tx.rs`, `atomic_file.rs`; the files come out byte for byte (`js::stringify` keeps JavaScript's key order, so serde_json has `preserve_order`), and a journal left by either side is recovered by the other; parity: broken and odd files, a script of every library step, folder changes run, failed, caught at a savepoint and killed halfway |
| the load order: slots handed out, planned, moved, swapped, laid out in two parts, who covers whom (`installer-slots.ts`, `slot-zones.ts`, `installer-files.ts`) | done | no | `installer.rs` (the folder it works in), `installer_slots.rs`, `slot_zones.rs`, `installer_files.rs`; parity: one language folder with volumes, switched-off and master-off paks, Minify's and the app's slots and legacy `!pak` names, run through every step on two copies and compared file by file |
| the language folder as a whole: the master switch, the note on which files are ours, parked files left by a killed write, foreign files (`installer-folder.ts`) | done | no | `installer_folder.rs`; the catalog guess for a foreign pak is a hook (`Installer::identify`) until the catalog moves; parity: one folder with Valve's, Minify's, master-off, parked, broken and map paks, run through every step on two copies and compared file by file |
| foreign archives and the room on the disk (`safe-zip.ts`, `disk-space.ts`) | done | no | `safe_zip.rs` (the `zip` crate, with the same budgets for size, entry count and compression ratio, and the same names refused), `disk_space.rs` (`fs4`); parity: a real mod, a bomb, a damaged file, an archive naming `..`, `CON` and a folder, each budget lowered in turn |
| fonts and cursors over the game's own files, kept originals, what a Steam verify undid (`overlays.ts`, `overlays-cursor.ts`) | done | no | `overlays.rs`; `backups\written.json` comes out byte for byte |
| writing a mod in and taking it out: archives, single paks, tools, switching on and off, removing (`installer-write.ts`) | done | no | `installer_write.rs`; one change per step as in TypeScript |
| the download cache on disk: names, the hash index, the list Settings shows (`installer-downloads.ts` without the fetch) | done | no | `installer_downloads.rs`; the fetch itself moves with the catalog and the network |
| what is installed, rewritten: merged, unpacked, whole-game tables stripped, heroes split, old volume sets folded, combined packs (`installer-repack.ts`, `installer-packs.ts`) | done | no | `installer_repack.rs`; `drop_item_icons` (`item-icons-drop.ts`) too; parity for all of the above: one script of ~95 steps over two copies of a game, a userData and a library, every answer and every file compared |
| the write jail's question (`write-jail.ts` `insideJail`) | done | no | `write_jail.rs`: the real-path check; holding every Rust write to it is the shell's part when Rust starts writing for the window |
| the patch on disk: state, apply, revert, the backups and the atomic write (`patcher.ts`) | done | no | `patcher.rs`; parity: the sandbox's gameinfo files and a signature list shaped like Valve's, patched, re-patched, tampered with by another patcher, reverted, without a list and without a gameinfo, every file compared after each step |
| importing VPKs, folders and archives the user picked (`import.ts`) | done | no | `import.rs`; parity: a split pak set, a stray part, a loose pak, a game tree, an author's loose folder, an empty folder, a pack zip, a zip without a pak, a damaged zip, and the same from buffers |
| the fingerprint index without the fetch (`fingerprints.ts`) | done | no | `fingerprints.rs`; parity: no cache, a stored map, lists and single identities, prints by mod, font matching, a broken file. Found and fixed in the TypeScript: `printsOf` on a fresh index lost the map it was building |
| updating a catalog mod in its slot (`mod-update.ts`) | done | no | `mod_update.rs`; the download is the caller's; parity: what can update, behind or current, a repacked pak, a mod the index does not know, an update in place of a split pak |
| the emblem ring line in autoexec (`emblem-ring.ts`) | done | no | `emblem_ring.rs`; parity: empty, CRLF, a line of ours, the user's own line, added and removed on disk |
| whole-map terrains and the game's map (`terrain-age.ts`) | done | no | `terrain_age.rs`; a zip's DOS time is read as local time with the same roll-over as `new Date(...)` (`chrono`); parity: archives with and without a map, a tail, the margin, the once-per-map switch-off, the catalog cache by hash |
| which mods a Dota update reached (`update-impact.ts`) | done | no | `update_impact.rs`; parity: the first note, a patch that changes, removes and adds files under a mod, the mark cleared and set again by the next patch |
| the anti-cheat notice pak (`notice-text.ts`, texts in `data/notice-texts.json`) | done | no | `notice_text.rs`; parity: the language, the tokens put in and replaced, the plan, the write, up to date, the refresh |
| the pumpkin's mod guard (`scream-guard.ts`) | done | no | `scream_guard.rs` |
| the mods:list answer (`mods-listing.ts`) | done | no | `mods_listing.rs`; the work after the answer (notice refresh, Discord, ring line) is the caller's; parity: a record deleted by hand, a stale terrain, a copy of the pumpkin's mod, an import named by its content, a foreign pak the catalog knows, a leftover copy, a mod an update reached, the ownership note |
| what goes into the item table: each pick built once and kept, arcana bases (Terrorblade's in the window's colour, personas without other items' effects, attachments numbered as the game's), courier looks, portraits and sprites, shared sounds (`schema-build.ts` `createTableBuild`, `arcana-bases.ts`, `arcana-base-color.ts`, `persona-base-effects.ts`, `courier-models.ts`, `item-portraits.ts`, `vpk-shared.ts`) | done | no | `schema_build.rs`, `arcana_bases.rs`, `arcana_base_color.rs`, `persona_base_effects.rs`, `courier_models.rs`, `item_portraits.rs`, `vpk_shared.rs`; one call, not a generator: the shell runs it off its main thread and gets the bar's count by callback; parity: five builds of one table in a row over the real game (45 patches, ~390 files, bases held and missing, a persona, ability effects slots, couriers and wards, a mod's blocks, the window record in two colours, a rebuild after `forget`), every file's sha1, the log and the bar's count alike |
| a look as files alone, without the table: an item's effects and material set on its own model, second models under their stock paths or merged into the first, the hero parts an item hides, motions on the hero's body (`item-files.ts` `itemFilesSteps`, `model-particles.ts`, `model-bodygroups.ts`, `model-merge.ts`) | done | no | `item_files.rs`, `model_particles.rs`, `model_bodygroups.rs`, `model_merge.rs`; parity: the files after two of the five table builds above (~480 files, every sha1, what each pick leaves behind), plus each piece alone over real models (particle lists in and out, body group masks, merged pairs, worn models in three skins); the TypeScript side waits for the meshopt decoder first, as the app has it by the time a build runs |
| Cancel on the item table's bar: the picture of the library as of the last table, and putting back what changed since (`build-undo.ts`) | done | no | `build_undo.rs`; stopping the build is a closure the caller passes; parity: a scripted run over a twin game folder (picks added and gone, a look changed, mods switched on and off, a mod added and one gone with its files, the master switch and `everyoneWearsMine` flipped), every answer, the library and the game folder alike |
| a mod's own item blocks: lifted on install, whole-game tables dropped, a pack of several heroes split per hero, the one-time sweep of old mods; the picks' pak, one generated record built again in its slot (`schema-harvest.ts`, `item-files-service.ts`, `generated-pak.ts`) | done | no | `schema_harvest.rs`, `item_files_service.rs`, `generated_pak.rs`; parity: a scripted run over a twin game folder (a mod with a changed block and a stale localization, a two-hero pack split in two, a clean mod and a looked-at one, the sweep run twice, the pak written, rebuilt switched off and cleared), every answer, the library with its generated ids lined up, and the game folder byte for byte |
| the table written into the game: merged, checked, packed with the patches' and the bases' files, swapped in with one rename; taken away with its folder; another run's half-done writes swept (`schema.ts` `deploySteps`, `undeploy`, `sweepUnfinished`, `isDeployed`) | done | no | `schema_deploy.rs`; the write is not handed back to the caller as in the TypeScript, since the whole build already runs on a worker thread; `stop` is asked before it; parity: a scripted run over twin copies of the sandbox's game (eight blocks with files, a later and an identical one, a missing id, a broken block refused, a stopped build, sweeps of this and other runs), every answer and the pak's sha1 |
| builds in the background, one at a time: a newer one stops the running one before it writes, a build in place answers those waiting, Cancel answers them with `cancelled`, `settled` for Play (`background-builds.ts`) | done | no | `background_builds.rs`; one worker thread, a generation counter, `stop` handed to the build; unit tests on the four behaviours (asynchronous in both, so no parity run); unlike the TypeScript, an overtaken build finishes the picks it is on (they are kept) and stops at the write |
| the item table's service: refresh (the table with the patch on, the picks' pak with it off, nothing with the mods switched off), heal after a game update, the patch switch, conflicts, the state Settings shows (`schema-service.ts`) | done | no | `schema_service.rs`; the installer, library and settings are handed to each call; heal in the background answers `rebuild` for the shell to queue; the builder's stamp is the crate version (and `MM_BUILD_SHA` from CI) where the TypeScript hashes its sources; asking for arcana bases at start is not in yet; parity: a scripted run over twin sandbox games (picks as a pak, the patch on and off, everyone wears mine, a stale stamp healed, the master switch, two mods disagreeing on a block, every pick taken off), every answer, the paths each write fills, the settings, the library and the game folder's sha1s |
| the free cosmetics and the item builder's picks: the slots with what fits each (style, ability and set names in the game's words, effects, each hero's attribute, Chinese item names), a pick, a whole set at a chosen style, a saved look, the one-time move of picks out of settings.json (`schema-cosmetics.ts`) | done | no | `schema_cosmetics.rs`; each call answers and leaves the table build to the caller (`background_builds.rs`) where the TypeScript took `write`; `set_details` (`item-builder-details.ts`) comes with it; the free slots' options now sort with ICU `localeCompare` (an apostrophe before the letters), as the TypeScript does; parity: a scripted run on the sandbox's real table (old settings moved, picks with effects and styles, the weather, a persona, a set at three styles, a look with picks that are not the hero's, a missing set and look), every answer and the library after, then the whole slots answer |
| presets as a link, as a .d2mm file and the ready-made list's format: `d2mm://` and web links in every pasted form, the manifest checked line by line, embedded mods read by an exact name (`preset-link.ts`, `preset-share.ts`, `ready-presets-format.ts`) | done | no | `preset_link.rs`, `preset_share.rs`, `ready_presets_format.rs`; raw deflate is miniz's (`flate2`), so a link Rust makes is another string than the TypeScript's for the same preset, and each reads the other's;  parity: links made on both sides read on both, pasted wrapped, truncated, too long, too many mods and hand-made payloads with odd entries, the ready list's edge cases, manifests that lie, and .d2mm files written by each side read by both, with zips that are not presets, broken JSON and a missing embedded file |
| what travels when a preset is shared and what receiving one would do, receiving a file or a link as a wish list, applying a preset (mods off then on, its looks and no other), which preset you are in, packing a received preset's mods (`preset-plan.ts`, `presets-service.ts`) | done | no | `preset_plan.rs`, `presets_service.rs`; the catalog comes in as the data it loaded (fetching it moves with the catalog); `apply_preset` says whether the item table needs a build, where the TypeScript started it; parity: twin games with catalog, grouped-catalog, own, switched-off, font, pack (a member in the catalog, one of the user's, one gone) and look records, the share plan with every embedded mod's bytes, the link's mods and what it leaves out, a received preset's card, three applies and the state of each preset after, links and .d2mm files with and without bytes, empty and not presets, packing, the library and the game folder |
| putting a preset on: an own one whose mods have gone (whatever the catalog has fetched, the user's own named as missing), a received one resolved into an ordinary preset (catalog mods, embedded mods by fingerprint or from the parked file, looks, packs rebuilt); what a VPK goes through to become a mod (a name from its content, its item blocks lifted, a small multi-hero pack split); one cursor set at a time and the start-up cursor repair (`preset-install.ts`, `adopt.ts`, `cursors.ts`) | done | no | `preset_install.rs`, `adopt.rs`, `cursors.rs`; the catalog download is handed in (`Deps::fetch`) until the catalog moves; the answer says whether the item table needs a build and whether what follows the master switch has to run; parity: twin games with a catalog of downloads, an own preset with a mod in the catalog, one gone, one with no file and one of the user's, a received link (a cursor set, a look, an unknown, an embedded mod with no file), a parked .d2mm (a two-hero pack split, a mod already on disk by fingerprint, a pack with a catalog member), one whose file is gone, imports with errors, every answer, the progress lines, the packs rebuilt, the library, the presets and both folders |
| `settings:testProxy`, `misc:cacheSize`, `misc:cacheList` in the Tauri shell | done | yes | `src-tauri/src/ported.rs`; none of them holds state the host also holds: the proxy test is one request, the cache is read off the disk on each call as the TypeScript does; `ported::UserData` is the userData folder main.rs settled on; checked in the shell on the sandbox with `tools/tauri-shot.mjs --eval` |
| the `mods:*` channels in the Tauri shell | - | - | next |
| the mirror chain, requests and downloads, the catalog signature (`net-mirrors.ts`, `net-fetch.ts`, `net-download.ts`, `catalog-signature.ts`) | done | no | `net_mirrors.rs`, `net_fetch.rs`, `catalog_signature.rs`; `ureq` with native-tls (SChannel on Windows, nothing compiled from C), `ed25519-dalek`; one `Net` holds the chain, the health and the proxy where the TypeScript keeps module globals; the wait for an answer's headers is bounded and the body is cut after 30 seconds of silence (read on its own thread, so a read that never returns can be given up on); parity on local servers: the chain for raw, release, outside and our-site URLs, configured hosts well formed or not, health and standing down, a 503 origin, mirrors with no copy, a refused port, excluded and trusted-only requests, downloads that verify, fall through a wrong copy, take the origin's copy, fail the checksum, resume, restart when Range is ignored, and signatures good, damaged, wrapped in whitespace, empty and unkeyed; the body budget is checked in Rust alone |
| the catalog (three signed files, the site's snapshot when GitHub's copies disagree, the last good copy, the published archive hashes), the remote config (its format and checks, switches, blocks by version, dated notices, the beta list, extra mirrors, marked mods) and the ready presets (`catalog.ts`, `remote-config.ts`, `remote-config-format.ts`, `ready-presets.ts`) | done | no | `catalog.rs`, `remote_config.rs`, `ready_presets.rs`; the clock is handed in; parity on one local server whose folders are states of the world (all good, torn between commits, forged, no hash list with a config that is not JSON, data that is signed but not JSON, down), two builds on two days: every load, refresh, log line, switch, notice, issue, the beta list, the mirrors, the hashes and the files kept on disk; a parse error's wording is each JSON reader's own |
| a catalog mod's archive into the download cache (reused while it is what arrived, fetched again when cut short or when the catalog disowns it, the published hash first and the first copy's second), the proxy setting checked (`installer-downloads.ts` `download`, `download-proxy.ts` `validateDownloadProxy`) | done | no | `Installer::download` in `installer_downloads.rs`, `validate_download_proxy` in `net_fetch.rs`; the catalog's hash is handed in; parity in the network test: fetched, reused, cut short, disowned, every copy wrong, a 503, a name that tries to climb out, a link of its own with a query, and 24 proxy addresses; progress is compared by its stages and last line, since each side reads the body in its own chunks |
| download counts and install hits (`download-stats.ts`) | done | no | `download_stats.rs`; requests go through `Net::direct` (one URL, the user's proxy, eight seconds in all); the two-second wait before hits leave is a thread that a later install or a flush cancels; parity: the keys of a mod with and without looks in every shape of category, look names, the build's token file, and a counter against a server answering each side's requests in the same order (counts with bad entries, 204, 503, not JSON, a 500 to a hit, an array), the clock moved past the five minutes, a key capped at five, counting switched off, a build with no token offline: every answer, every log line, every request with its headers and body, and the counts kept on disk |
| the catalog's pictures on `mm-preview://`: which addresses are catalog pictures, what the bytes really are, the hosts in turn with a 1.5 s head start each, kept on disk, rechecked with If-Modified-Since after a week, the rest fetched ahead three at a time (`preview-cache.ts`) | done | yes | `preview_cache.rs`; the Tauri shell answers the scheme (`Previews` in `src-tauri/src/ported.rs`, registered in main.rs) from the same `preview-cache` folder the host still warms, which is safe because both sides write a picture under a temporary name and rename it; the proxy is read off settings.json when the file changes; a webview has no request redirect, so `bridge.js` rewrites an image's address as the page sets it (WebView2 serves the scheme as `http://mm-preview.localhost/`, now in the page's CSP); extra mirrors from the remote config are not in the shell's chain yet; parity: ~14 addresses, the magic bytes, the catalog walk, and a store against one server playing the mirror, GitHub and jsDelivr (a slow host overtaken, an error page, nobody, two asks sharing one fetch, a 304 and a changed picture after a week, warming), every answer, the requests and the files on disk; in the shell on the sandbox the home screen's pictures come from Rust, and one removed from the cache is fetched again and kept |
| item builder, arcana, Workshop editors | - | - | |
| 3D preview (`preview3d:*`) | - | - | binary answers already go back raw (`answer` in `src-tauri/src/main.rs`) |
| tray, autostart, updater, deep links, uninstall | - | - | Tauri plugins: tray-icon, autostart, updater, deep-link |

### Speed so far

`node tools/rust-bench.mjs --game "<...>\dota 2 beta\game"` (release mm-cli, best of 3, the real
game of 2026-11-12, read only):

| Step | TypeScript | Rust | Faster |
|---|---|---|---|
| open pak01's index (388 000 entries) | 231 ms | 92 ms | 2.5x |
| list items_game's items | 264 ms | 41 ms | 6.4x |
| count items_game's items | 191 ms | 27 ms | 7.1x |
| fingerprint pak01's index | 258 ms | 159 ms | 1.6x |

The items_game walks gain most from indexing every brace once (`kv::Braces`) instead of scanning
each block again at every level, and from reading the items on every core (rayon).

Known gaps of the Tauri build today (all inside the host, so they close as channels move):

- `nativeImage` (`src-tauri/host/images.ts`) reads and writes PNG only, through `src/png-strip.ts`:
  a palette PNG or a JPEG comes back empty, where Electron would decode it.
- Catalog pictures are not redirected to the local cache (`session.webRequest` has no Tauri twin):
  the page loads them straight from the network.
- Dropped files: `webUtils.getPathForFile` maps a dropped file to the path Tauri reported for the
  last drop, by name.
- The tray, autostart, the updater and the uninstaller are not wired.

## Moving a piece

1. Port the TypeScript module into `crates/mm-core` (no Tauri types there). Same behaviour, same
   rules, same edge cases; the TypeScript tests are the reference. Errors are refusals, never
   panics: a truncated file from a user's disk must not take the app down.
2. Prove it is the same: a parity test in `test/rust-parity.test.js` runs the TypeScript and the
   Rust (`mm-cli`) on the same input, the sandbox's real mods where there are any, and compares.
3. Answer the channel in `src-tauri/src/ported.rs` with the same arguments and the same answer
   shape the TypeScript handler had. The window must not be able to tell.
4. `node tools/rust-progress.mjs`, `cargo test --workspace`, `npm test`, and the Tauri build on
   the sandbox: `node tools/tauri-shot.mjs`.
5. Update the table above.

A channel that writes into the game folder goes through the same checks as in TypeScript:
`--write-jail` (`src/write-jail.ts`) has to hold in Rust too before such a channel moves.

## Building

Windows, no Visual Studio needed:

- Rust via rustup, toolchain `stable-x86_64-pc-windows-gnullvm`;
- [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) unpacked anywhere, its `bin` on `PATH`
  (the linker and `dlltool`);
- `.cargo/config.toml` links the C runtime statically, so the exe needs no libunwind.dll.

With Visual Studio Build Tools the default MSVC toolchain works as well; CI uses that.

```bash
node tools/ui-build.mjs --tauri          # the page, into out/renderer-tauri
cargo build -p dota2-mod-manager         # the shell, target/debug/dota2-mod-manager.exe
cargo test --workspace                   # the Rust tests
node tools/tauri-shot.mjs                # on the sandbox: a screenshot and the console errors
```

The debug build runs the host from this checkout (`src-tauri/host/host.ts`) with the `node` on
`PATH` (or `MM_NODE`). Pass the same switches as the Electron build: `--user-data-dir=`,
`--write-jail=`.
