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
to `calls.rs` and its cases to the test: that is the whole parity check. The same entry point is
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
| the readers on top of KV3 (`material.ts`, `recolor.ts`, `model-*.ts`, `particle-*.ts`) and the rest of the item builder | - | - | next |
| settings, library/manifest, installer, patcher, gamelang | - | - | the `mods:*` channels |
| catalog, network, previews (`mm-preview://`) | - | - | `reqwest`; the picture redirect (`src/preview-cache.ts`) has no Tauri twin yet |
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
