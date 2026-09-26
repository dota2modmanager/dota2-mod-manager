# Code signing policy

What is signed, by whom, and what a person downloading this program can check for themselves.

## The Windows installer

Today the installer carries no Authenticode signature, and Windows SmartScreen warns about it on
first run. A certificate costs money this project does not take in. This project has applied to
the SignPath Foundation, which signs open-source software for free. Once the certificate is
issued, the installer and the portable build will be signed through SignPath, and this page will
carry the credit that programme asks for: "Free code signing provided by SignPath.io, certificate
by SignPath Foundation".

Only files this repository's release workflow builds from its own source are sent for signing.
Nothing built on a developer's machine, and nothing written by somebody else, is signed under this
project's name.

## Team roles

| Role | Who | What they do |
|---|---|---|
| Committers | [@TheFleece](https://github.com/TheFleece), [@Nersaa](https://github.com/Nersaa) | Write changes. A change reaches `main` only through a pull request, the maintainers' own included |
| Reviewers | [@TheFleece](https://github.com/TheFleece), [@Nersaa](https://github.com/Nersaa) | Approve pull requests. The author's own approval does not count, and a new push dismisses an approval that came before it. A change from outside the project is reviewed by a maintainer |
| Approvers | [@TheFleece](https://github.com/TheFleece), [@Nersaa](https://github.com/Nersaa) | Tag a release on a commit of `main`, and approve each signing request once signing is in place |

Both are owners of the [dota2modmanager](https://github.com/dota2modmanager) organization, which
requires two-factor authentication of every member. They use it on every service that can publish
anything. [GOVERNANCE.md](../GOVERNANCE.md) says who decides what.

## How a release is built

Releases are built only by GitHub Actions, from a tag on a commit of `main`, never on a developer
machine. The commit has to have passed every check in
[`.github/required-checks.json`](../.github/required-checks.json), the same list a pull request
needs before it can merge. The release opens as a draft that nobody outside the project can see.
The installer and the AppImage on it are installed on Windows and Linux by CI and used to install a
mod before the release is published, and a published release cannot be changed afterwards.
[RELEASING.md](../RELEASING.md) is the whole procedure.

## What is signed today

**Every published file, by the build itself.** Each release carries `SHA256SUMS`, the SHA-256 of
every file on it, and a Sigstore provenance attestation over that list, made by the release
workflow at the tagged commit. There is no private key on anybody's machine: Sigstore issues a
short-lived certificate to the workflow and records the signature in a public transparency log.

```
gh attestation verify Dota-2-Mod-Manager-Setup.exe --repo dota2modmanager/dota2-mod-manager
```

**The catalog the app reads**, by its author. Mod data carries an ed25519 signature made by the
catalog's own author, against a public key pinned inside the app. An archive is checked against a
SHA-256 from that signed list before it reaches a game folder.

**The file that can change the app after a release**, by this project. `config/app.json` switches
a feature off, shows a notice, names the beta testers and can add a download mirror. It is signed
with an ed25519 key held by [@TheFleece](https://github.com/TheFleece) and pinned in the app; a
copy that does not verify is ignored exactly as if it were unreachable.

## Privacy

This program sends no information about you, your machine or your games. There is no telemetry and
no account. It contacts the mod catalog and the update feed; every address it can contact, what for
and when, is listed in [PRIVACY.md](../PRIVACY.md).

## What the program does to a machine

It writes in two places: its own data folder, and the Dota 2 folder, where it adds mod archives to
the language folder the game mounts, can write loose fonts and cursors, and can patch one text
file. Anything it replaces is copied first and restored byte for byte on removal. It asks before
it touches the game folder the first time, and the uninstaller asks what should go with it.

There is no bundled software. [SECURITY.md](../SECURITY.md) says what the program promises and
what it refuses to promise; [docs/assurance-case.md](assurance-case.md) is the argument behind
those promises.

## Third-party components

The app ships two runtime dependencies from npm and three typefaces, all listed in
[NOTICE](../NOTICE) with their licences, and a CycloneDX SBOM of what each release contains is
published beside the installer. One external tool, Source2Viewer-CLI (MIT), is downloaded only
when a feature needs it, pinned by version and SHA-256, and never bundled.
