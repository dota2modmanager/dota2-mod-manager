# Security

## Reporting a vulnerability

Open a private advisory:
[github.com/dota2modmanager/dota2-mod-manager/security/advisories/new](https://github.com/dota2modmanager/dota2-mod-manager/security/advisories/new)

Or write to **security@dota2modmanager.com**, which needs no GitHub account and is read by the
same one person. Say in the first line that it is a security report.

Either reaches the author and nobody else. Do not open a public issue for something exploitable.

Tell me what you did and what happened. A rough description beats none, and a way to reproduce
it beats everything. I will answer, and I will say plainly whether I think it is a problem.

A first reply comes within 48 hours.

## What the app is, in terms of what can go wrong

It runs on your machine, keeps no server of its own and holds no account. What it does touch:

- **The Dota folder.** It writes mod archives into the language folder the game mounts, and can
  patch `gameinfo_branchspecific.gi` when the cosmetics feature is switched on. It copies
  Valve's files before the first write and puts them back byte for byte on revert.
- **The network.** It reads the mod catalogue and the mods themselves from
  [h6rd/Dota2PornFxWeb](https://github.com/h6rd/Dota2PornFxWeb), through public mirrors when
  GitHub is unreachable, and it downloads one MIT-licensed tool from its own project's
  releases, pinned by SHA-256.

  None of that route is trusted. The catalogue files carry an ed25519 signature by their author
  and the app refuses bytes that do not verify against a pinned key; each mod archive is checked
  against a SHA-256 from that signed list; and the file that can switch a feature off after a
  release is signed by this project's own key and ignored when it does not verify. The whole
  chain, including what each failure costs and what it does not cover, is written out in
  [ARCHITECTURE.md](docs/ARCHITECTURE.md) under "Who is allowed to have written this".
- **Files you hand it.** Mod archives, preset files that travel between strangers, and folders
  you drop on the window.

Anything that gets code running, writes outside those places, or turns catalogue data into an
instruction is worth reporting. So is anything that makes the app fetch from somewhere it was
not asked to.

## What you can expect, and what you cannot

The promises this app makes, so that a broken one is a bug you can name.

**You can expect that nothing reaches your game folder unchecked.** Every mod archive is measured
against a sha256 from a list its author signed, and bytes that do not match never get written.

**You can expect Valve's own files back.** Anything the app replaces or patches is copied first
and restored byte for byte, and a Dota patch that takes files back is noticed and repaired rather
than left to you.

**You can expect an archive to stay inside the folders the app owns.** A name inside a zip is a
name, not a path: absolute paths, parent traversal and links are refused before anything is
written.

**You can expect the app never to run code it downloaded.** Mods are data. The single executable
it can fetch is a published tool, pinned by version and hash, and only when you ask for it.

**You can expect it to keep no secret of yours.** There is no password anywhere, no token is
stored, and signing in with Discord keeps a name, an id and an avatar. Every address the app can
reach is listed in [PRIVACY.md](docs/PRIVACY.md).

**You can expect a release to be traceable to its source.** `SHA256SUMS` and a Sigstore
attestation tie every published file to the commit it was built from, which you can check
yourself with the commands below.

**You cannot expect a mod to be reviewed.** The app checks who published a file and that the
bytes are theirs. It does not judge what a mod does to the game's look, and a mod can be ugly,
broken or a copyright argument waiting to happen.

**You cannot expect protection from somebody who already has your machine.** Anything running as
you can undo anything this app does.

**You cannot expect a signed installer yet.** It is not code-signed, and SmartScreen says so.

**You cannot expect us to speak for Valve.** What this app changes is client-side and cosmetic,
and what Valve permits is their decision, not a property of this code.

The argument behind these, with the trust boundaries and what each one is enforced by, is in
[docs/assurance-case.md](docs/assurance-case.md). What is signed, by whom, and what you can check
yourself is in [docs/code-signing-policy.md](docs/code-signing-policy.md).

## Scope

In scope: this repository, and the installers published from it.

Out of scope: the mods themselves and the catalogue that hosts them, which belong to h6rd and
to the mod authors. Report those to them. Also out of scope: whether modding Dota is a good
idea, which is a question for you and not a vulnerability.

## Versions

The current release is the one that gets fixed. The app updates itself, so there is no line of
older versions to patch.

## Checking a download

Each release carries `SHA256SUMS`, a list of every file on it with its SHA-256, and a provenance
attestation for that list, signed through Sigstore by `.github/workflows/release.yml` at the tagged
commit. `gh attestation verify <file> --repo dota2modmanager/dota2-mod-manager` confirms a file came out of
that workflow; the README shows the commands. Releases up to 2.7.0 were signed before the
repository moved from TheFleece/dota2-mod-manager, and their attestations name that address, so
check those with `--repo TheFleece/dota2-mod-manager`. The signed bundle is on the release as
`SHA256SUMS.intoto.jsonl`, and a CycloneDX SBOM of what the app ships is beside it as
`dota2-mod-manager.cdx.json`. A file that fails the check did not come from this repository's
release job, whatever page it was downloaded from.
