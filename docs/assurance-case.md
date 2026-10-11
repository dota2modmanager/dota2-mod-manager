# Assurance case

Why this app is safe enough to point at a game folder, argued rather than asserted.

[SECURITY.md](../SECURITY.md) says what you can and cannot expect from it, and
[ARCHITECTURE.md](../ARCHITECTURE.md) says how it is put together. This file is the argument
between the two: what could go wrong, what stops it, and how you can check that for yourself
instead of taking it on trust.

## What is being protected

**Somebody's Dota installation.** The app writes into a folder a person paid nothing for and
plays every day. A mistake here does not throw a stack trace, it quietly breaks a game.

**Their machine.** The app opens archives written by strangers, renders text written by
strangers, and downloads files over a route it does not control.

**Their privacy.** No account is required, nothing is collected, and the list of addresses the
app can reach is short and public ([PRIVACY.md](../PRIVACY.md)).

## Trust boundaries

| # | Boundary | What crosses it | Where it is enforced |
|---|---|---|---|
| 1 | The network and the app | Catalog data, mod archives, the switches file, one external tool | `src/net.ts`, `src/catalog-signature.ts`, `src/remote-config.ts`, `src/toolchain.ts` |
| 2 | Foreign archives and the disk | Zip and VPK contents, file names, paths | `src/safe-zip.ts`, `src/vpk.ts`, `src/file-tx.ts` |
| 3 | The main process and the window | Every action the UI can ask for | `preload.js` and the `src/ipc-*.ts` modules |
| 4 | The app and the game folder | Mod packs, loose fonts and cursors, one patched text file | `src/installer.ts`, `src/overlays.ts`, `src/patcher.ts` |
| 5 | The user and everything above | Files they drop, presets from other people | `src/import.ts`, `src/preset-share.ts`, `src/adopt.ts` |

Each boundary has one door. That is the design: there is a single place where a foreign zip is
opened, a single place where a download is fetched, a single place where a mod becomes a record
in the library. A door you can name is a door you can test.

## The threats, and what answers them

**A stranger in the middle of the download.** Much of the userbase cannot reach
`raw.githubusercontent.com`, so the app falls back to public proxies, and a proxy is somebody
handing over bytes that claim to be GitHub's. TLS proves you reached the proxy and says nothing
about where the proxy got the file. So nothing arrives on trust: catalog data carries an ed25519
signature by its author against a key pinned in the app, every mod archive is checked against a
sha256 from that signed list, and the external tool is pinned by version and hash before anything
is unpacked. What a failed check costs is decided per file and written out in ARCHITECTURE.md
under "Who is allowed to have written this".
*Check:* `test/catalog-signature.test.ts`, `test/net.test.ts`, `test/toolchain.test.ts`.

**A mirror that is wrong about one file.** A failed checksum means one host handed over the wrong
bytes, not that the mod is bad. The download spends the mirror rather than the mod: that host is
stood down for this file and the next one is asked from the start. Only a file every mirror
disowns is refused.
*Check:* `test/net.test.ts`, "a mirror serving a stale copy costs that mirror its turn".

**An archive that wants to write somewhere else.** A file name inside a zip is a name, never a
path. Everything foreign comes through `src/safe-zip.ts`, which refuses absolute paths, parent
traversal, links, and sizes that do not fit the budget it was given. A mod's own catalog record
cannot turn into a path either.
*Check:* `test/safe-zip.test.ts` and `test/safe-zip-fuzz.test.js`, which throws malformed
archives at it rather than only the ones somebody thought of.

**An install that stops half way.** Power cuts, full disks and antivirus locks all land in the
middle of writing. Writes go through `src/file-tx.ts`, which stages and then commits, so the game
folder is either as it was or as it should be, and the library record is part of the same change.
Each step is journaled before it is taken (`src/file-tx-journal.ts`), so a process killed
halfway is undone, or finished if it got past its commit, on the next start. Valve's own files
are copied before the first write and put back byte for byte on revert.
*Check:* `test/file-tx.test.ts`, `test/file-tx-crash.test.ts` (each change killed at every write
it makes, then recovered and compared byte for byte), `test/patcher.test.ts` (the patch
round-trips byte for byte).

**Catalog text rendered as code.** Guides are HTML written by people who are not us. They go
through an allowlist of tags, and the window runs under a content security policy with no remote
scripts, no node integration and context isolation on, so text that got through would still have
nothing to reach.
*Check:* `renderer/ui/guide.ts` (`sanitizeGuideHtml`), `renderer/index.html` (the policy itself),
`src/main-window.ts` (`contextIsolation: true`, `nodeIntegration: false`).

**The window asking for something the app should not do.** The renderer cannot touch the
filesystem or start a process, and the policy limits what it may fetch to pictures from two
hosts. Everything else it does is a channel `preload.js` exposes. Every channel sits behind
`src/window-guard.ts`: a call is answered only from the top frame of the app's own page and only
with arguments that fit its entry in `src/channel-args.ts`, and the window may change only the
settings it has a control for. Both windows run sandboxed, the page gets two browser permissions,
and no web contents may open a window, attach a webview or leave the app's pages.
*Check:* `test/window-guard.test.ts` (every channel has a check, one real call of each passes, a
list of hostile ones does not, no check throws on any input), `test/ipc-contract.test.js`, and the
window e2e, which fails on any call the guard refused.

**Us, after the release.** The one thing this project can change on a machine without shipping a
new version is `config/app.json`: a feature switched off, a notice, the beta list, a mirror. It
is signed with this project's own key against a key pinned in the app, and a file that does not
verify is ignored exactly as if it were unreachable. It can only take capability away or point at
a host whose bytes are checked anyway; it cannot add code.
*Check:* `test/remote-config-signature.test.ts`, `test/remote-config.test.ts`.

**A release that is not ours.** Each release carries `SHA256SUMS` and a Sigstore provenance
attestation over that list, signed by the release workflow at the tagged commit, so
`gh attestation verify` ties a download to a commit in this repository. The installer itself is
not code-signed yet, which is stated plainly rather than hidden.
*Check:* `test/workflows.test.js`, which fails if the attestation stops covering every file in
`SHA256SUMS`, and the commands in SECURITY.md.

**Secrets in the build.** Nothing signs or publishes from a developer machine. The signing key
for `config/app.json` is not in this repository, the workflows name every secret they use, and a
test fails the pull request when a workflow asks for one that is not registered.
*Check:* `test/credentials-check.test.js`, `test/workflows.test.js`.

## Secure design, applied

**Least privilege.** The renderer gets no ambient authority. The app asks for no elevation, and
it writes in two places: its own data folder, and the game folder, where it touches the language
folder it installs into, the loose fonts and cursors it is asked for, and one text file it
patches and can put back byte for byte.

**One door per dangerous thing.** One zip reader, one download path, one transaction for writes,
one route into the library. New code reuses the door rather than opening another.

**Fail in the direction that costs least, on purpose.** Without a catalog there is nothing to
show, so yesterday's copy is kept. Bytes that fail their hash never reach the game folder. A
switches file that fails its signature is dropped, because a switch is an improvement on knowing
nothing and a forged one is worse than none. Those three choices differ deliberately, and the
reasoning is in ARCHITECTURE.md.

**No code from the network, ever.** Mods are data: packs, textures, sounds, fonts and cursors.
The app never downloads and runs a script, and the one executable it can fetch is a published
tool pinned by hash that the user asks for.

**Defence that does not depend on one check.** A mod archive is checked against a signed hash,
opened by a reader that refuses paths, and written through a transaction that can be undone. Any
one of those failing does not put a file where it should not be.

## What this case does not claim

It does not claim a mod is good. The app checks who published a file and that the bytes match
what they published, not what the mod does to the game's look.

It does not claim protection from somebody who already controls the machine, or from a user who
chooses to run something.

It does not claim the installer is signed. It is not, and SmartScreen says so.

It does not speak for Valve. Modding is client-side and cosmetic here, and what Valve permits is
their decision, not a property of this code.

## Keeping this honest

Every claim above names a file or a test, so a claim that stops being true breaks something.
`test/decisions.test.js` and `test/docs-current.test.js` hold the documents against the
repository, and this file is reviewed whenever a boundary above moves.
