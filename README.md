<div align="center">

<img src=".github/banner.svg" alt="Dota 2 Mod Manager" width="900">

<p>
  <img src="https://img.shields.io/badge/English-8b6ff0?style=for-the-badge&labelColor=8b6ff0&logoColor=white" alt="You are reading the English version">
  <a href="README.ru.md"><img src="https://img.shields.io/badge/%D0%BF%D0%BE%E2%80%91%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8-211f26?style=for-the-badge&labelColor=211f26" alt="Читать по-русски"></a>
</p>

<p>
  <a href="https://github.com/dota2modmanager/dota2-mod-manager/releases/latest/download/Dota-2-Mod-Manager-Setup.exe">
    <img src="https://img.shields.io/github/v/release/dota2modmanager/dota2-mod-manager?style=for-the-badge&color=8b6ff0&label=Download&logo=github&logoColor=white" alt="Download the latest release"></a>
  <img src="https://img.shields.io/github/downloads/dota2modmanager/dota2-mod-manager/Dota-2-Mod-Manager-Setup.exe?style=for-the-badge&color=4f378b&label=Installs" alt="Installer downloads">
  <img src="https://img.shields.io/badge/Windows%20%7C%20Linux-211f26?style=for-the-badge&logo=windows&logoColor=d0bcff" alt="Windows and Linux">
</p>

<p>
  <a href="https://github.com/dota2modmanager/dota2-mod-manager/actions/workflows/test.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/dota2modmanager/dota2-mod-manager/test.yml?style=flat-square&label=tests&labelColor=211f26&color=2bffa3" alt="Test status"></a>
  <a href="https://github.com/dota2modmanager/dota2-mod-manager/actions/workflows/codeql.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/dota2modmanager/dota2-mod-manager/codeql.yml?style=flat-square&label=codeql&labelColor=211f26&color=2bffa3" alt="CodeQL status"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/dota2modmanager/dota2-mod-manager">
    <img src="https://img.shields.io/ossf-scorecard/github.com/dota2modmanager/dota2-mod-manager?style=flat-square&label=openssf%20scorecard&labelColor=211f26" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/en/projects/14721">
    <img src="https://img.shields.io/cii/level/14721?style=flat-square&label=openssf%20best%20practices&labelColor=211f26&color=2bffa3" alt="OpenSSF Best Practices silver badge"></a>
  <a href="https://dota2modmanager.betteruptime.com">
    <img src="https://uptime.betterstack.com/status-badges/v1/monitor/2y6jv.svg" alt="Update feed status"></a>
  <img src="https://img.shields.io/github/last-commit/dota2modmanager/dota2-mod-manager?style=flat-square&label=last%20commit&labelColor=211f26&color=8b6ff0" alt="Last commit">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-c4b5fd?style=flat-square&labelColor=211f26" alt="License"></a>
  <a href="https://dota2modmanager.com"><img src="https://img.shields.io/badge/site-dota2modmanager.com-c4b5fd?style=flat-square&labelColor=211f26" alt="Website"></a>
  <a href="mailto:hello@dota2modmanager.com"><img src="https://img.shields.io/badge/email-hello%40dota2modmanager.com-c4b5fd?style=flat-square&labelColor=211f26" alt="Email: hello@dota2modmanager.com"></a>
  <a href="https://discord.gg/PBvG8D9MxT"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2FPBvG8D9MxT%3Fwith_counts%3Dtrue&query=%24.approximate_presence_count&label=discord&suffix=%20online&style=flat-square&labelColor=211f26&color=5865f2&logo=discord&logoColor=white" alt="Discord: people online on the D2PFX catalog's server, where the app has its own channel"></a>
  <a href="https://discord.gg/PBvG8D9MxT"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2FPBvG8D9MxT%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&label=members&style=flat-square&labelColor=211f26&color=5865f2" alt="Discord: members of the D2PFX catalog's server"></a>
</p>

<p>
  <b>
  <a href="#what-it-does">What it does</a> &nbsp;·&nbsp;
  <a href="#install">Install</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a> &nbsp;·&nbsp;
  <a href="#alongside-dota2-minify">Alongside Minify</a> &nbsp;·&nbsp;
  <a href="#documentation">Docs</a> &nbsp;·&nbsp;
  <a href="#report-a-problem">Report a problem</a> &nbsp;·&nbsp;
  <a href="#project-activity">Activity</a>
  </b>
</p>

<img src="site/public/screenshots/dota-2-mod-manager-catalog-en.webp" alt="The catalog" width="100%">

</div>

> [!NOTE]
> Not affiliated with Valve. Every mod here is client-side: nobody else sees them, and no other
> player's game is touched. Safe mode is on by default and keeps the app out of Dota's own files
> entirely; the one feature that changes them asks first and reverts byte for byte.

> **Why not just copy the files yourself?** You can, and people do. What the app adds is
> everything after that: switching a mod off before a match without deleting it, a weather effect
> or a courier your account never bought drawn on your own screen, a setup you send as one link,
> and a game that still works after a Dota patch.

<br>

## What it does

<table>
<tr><td width="210"><b>The whole catalog</b></td><td>1000+ mods in 41 categories, read live from the <a href="https://github.com/h6rd/Dota2PornFxWeb">D2PFX</a> repository, so a mod added today installs today</td></tr>
<tr><td><b>One click in, one click out</b></td><td>The app downloads it, picks a free pak slot and cleans up after itself. Categories that must load early get low slots by themselves</td></tr>
<tr><td><b>Switch off, don't delete</b></td><td>Turn a mod off before a match and back on after. Your library stays, the game folder stays clean</td></tr>
<tr><td><b>Looks for the default items</b></td><td>Weather, couriers, wards, loading screens, announcers, mega-kills: the default item every account has is drawn as any other item in the game, on your screen and nobody else's. The list comes from the game's own item table, so anything Valve adds appears by itself</td></tr>
<tr><td><b>It says when mods collide</b></td><td>Two mods carrying the same file cannot both win. The app names the file, says which mod the game loads it from, and lets you reorder</td></tr>
<tr><td><b>Setups by link</b></td><td>Save what you run as a preset and send it in one message. The other side opens it and gets the same look</td></tr>
<tr><td><b>It survives Dota patches</b></td><td>The app notices a game update when it lands and puts back what the patch wiped, without ever writing while Dota is running</td></tr>
</table>

<details>
<summary><b>And the rest</b></summary>
<br>
<table>
<tr><td width="210"><b>An install list</b></td><td>Put mods aside while you browse and install them all at once. The list has its own search, because people were installing eighty mods one at a time</td></tr>
<tr><td><b>Filters and search</b></td><td>Chips for what a mod changes, a dropdown for the item slot, a list of heroes, and one search across the whole catalog</td></tr>
<tr><td><b>Fonts and cursors</b></td><td>Installed into the game files with a backup of the originals; removing them restores vanilla</td></tr>
<tr><td><b>Combined packs</b></td><td>Merge several mods into one pak slot, and take them apart again</td></tr>
<tr><td><b>Your own files</b></td><td>Import a <code>.vpk</code>, or adopt what somebody else's tool left in the folder. The app fingerprints it against the catalog and tells you what it is</td></tr>
<tr><td><b>Auto-updates</b></td><td>The app checks GitHub Releases and installs new versions itself</td></tr>
<tr><td><b>Windows and Linux</b></td><td>Both ship with every release: an installer and a portable build for Windows, an AppImage for Linux. Steam is found wherever your distribution keeps it, flatpak included</td></tr>
<tr><td><b>No account, no telemetry</b></td><td>Nothing is collected and nothing is sent. Signing in with Discord is optional and only puts your name on a setup you share</td></tr>
</table>
</details>

<div align="center">
  <img src="site/public/screenshots/dota-2-mod-manager-heroes-en.webp" alt="Mods grouped hero by hero" width="49%">
  <img src="site/public/screenshots/dota-2-mod-manager-my-mods-en.webp" alt="Installed mods, with the load order" width="49%">
</div>

<br>

## Install

1. Download **[Dota 2 Mod Manager Setup](https://github.com/dota2modmanager/dota2-mod-manager/releases/latest/download/Dota-2-Mod-Manager-Setup.exe)** — direct link, always the latest version
2. Run it. The app installs, creates a shortcut and starts
3. It finds Dota on its own. No launch options, no Steam properties to edit

**On Linux** the same app ships as an
[AppImage](https://github.com/dota2modmanager/dota2-mod-manager/releases/latest/download/Dota-2-Mod-Manager.AppImage):
`chmod +x` it and run it.

> [!IMPORTANT]
> Windows will call the publisher unknown, because the installer carries no paid signature.
> Click **More info**, then **Run anyway**. Every release is built from this source by a
> [public workflow](https://github.com/dota2modmanager/dota2-mod-manager/actions/workflows/release.yml)
> rather than uploaded from anybody's desktop, and the build log for the exact file you
> downloaded is open to read.

Every file on a release is listed with its SHA-256 in `SHA256SUMS`, and the release workflow signs
that list through Sigstore. To check that a download came out of that workflow, with the GitHub CLI:

```bash
gh attestation verify Dota-2-Mod-Manager-Setup.exe --repo dota2modmanager/dota2-mod-manager
```

Or against the list alone, in a folder holding both files:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

On Windows without the GitHub CLI, `Get-FileHash Dota-2-Mod-Manager-Setup.exe` in PowerShell prints
the hash to compare with its line in `SHA256SUMS`. Releases published before this check existed
have no `SHA256SUMS`.

<br>

## How it works

Nothing is injected into Dota's process, and no file of the game is opened while it runs.

- Dota mounts **one** folder, named after its **voice** language. The app sets that language in
  the game's own settings and installs there — **no launch option involved**, which is the part
  worth reading twice. [Why that works](https://dota2modmanager.com/docs/language/)
- VPK mods go in as `pakNN_dir.vpk`, slots 10 to 99. Categories that must load first get
  `pak02` to `pak09`. [Slots and load order](https://dota2modmanager.com/docs/vpk/)
- Switching a mod off renames its file to `.off`. The game skips it, the file stays
- Fonts and cursors go into the game's own folders, with the originals backed up first
- Everything that writes to the game folder is one transaction: if a step fails, the whole
  change rolls back, displaced files included
- Safe mode, on by default, means the app never touches Dota's own files. Turning it off adds
  one line to `gameinfo_branchspecific.gi` and a signature to `dota.signatures` — both backed up
  before the first edit, both restored byte for byte when it goes back on.
  [What that buys and costs](https://dota2modmanager.com/docs/safe/)

Downloads live in `%APPDATA%/dota2-mod-manager/downloads`, the install manifest beside them.
The full picture is in [ARCHITECTURE.md](ARCHITECTURE.md), and every module is listed in
[docs/API.md](docs/API.md), which is generated from the source rather than written.

<br>

## Alongside Dota2 Minify

[Dota2 Minify](https://github.com/Egezenn/dota2-minify) is a different kind of tool by a
different author: it builds mods by patching the game where this installs finished ones from a
catalog. **Run both.** This app installs into whichever folder the game will really mount —
including the one Minify picked — never hands out the pak slots Minify writes, and leaves its
files alone. Minify since v1.14rc7 checks ownership before clearing the map folder, so a terrain
installed here survives its uninstall.

[What Minify is, and how the two share a game](https://dota2modmanager.com/docs/minify/).

<br>

## Documentation

| | |
|---|---|
| [Installing mods](https://dota2modmanager.com/docs/install/) | The whole route, by hand and with the app |
| [The language folder](https://dota2modmanager.com/docs/language/) | Why `-language` is not needed, and what it does when it is there |
| [VPK and load order](https://dota2modmanager.com/docs/vpk/) | Pak slots, which mod wins, and `gameinfo.gi` |
| [Safe mode](https://dota2modmanager.com/docs/safe/) | What the app writes into the game, and what it does not |
| [Free cosmetics](https://dota2modmanager.com/docs/cosmetics/) | The item table, and what it can and cannot give you |
| [After a Dota patch](https://dota2modmanager.com/docs/troubleshooting/) | What breaks, and what the app puts back |
| [Every fact, checkable](https://dota2modmanager.com/facts/) | Version, platforms, counts, and how to verify each one |
| [ARCHITECTURE.md](ARCHITECTURE.md) · [docs/API.md](docs/API.md) | Which file owns which decision, and every module's exports |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) · [SECURITY.md](SECURITY.md) | How to work on it, with or without an assistant, and how to report a hole |
| [docs/assurance-case.md](docs/assurance-case.md) | What could go wrong, what stops it, and the test that proves each answer |
| [TRADEMARK.md](TRADEMARK.md) · [docs/code-signing-policy.md](docs/code-signing-policy.md) | What the licence gives you and what it does not, and what is signed today |
| [Status](https://dota2modmanager.betteruptime.com) | Whether the update feed, the mirror, the catalog and the site are answering right now |
| [PRIVACY.md](PRIVACY.md) | What is collected (nothing), and every address the app can contact |
| [DECISIONS.md](DECISIONS.md) | What was decided on purpose, what is genuinely missing, and the command that checks each one |
| [GOVERNANCE.md](GOVERNANCE.md) | Who decides what, how a change is accepted, and what happens to the project without its maintainer |
| [docs/second-maintainer.md](docs/second-maintainer.md) | The second pair of hands: what the role is, and what to do on the day it matters |
| [ROADMAP.md](ROADMAP.md) | What is coming next, what comes later, and what this project will not do |
| [CHANGELOG.md](CHANGELOG.md) · [CHANGELOG.ru.md](CHANGELOG.ru.md) | What changed in each release |

<br>

## Report a problem

| | |
|---|---|
| [Bug report](https://github.com/dota2modmanager/dota2-mod-manager/issues/new?template=bug_report.yml) | Something is broken. **Settings → Diagnostics → Export report** puts everything needed in one file |
| [Feature request](https://github.com/dota2modmanager/dota2-mod-manager/issues/new?template=feature_request.yml) | An idea for how the app should work |
| [Discussions](https://github.com/dota2modmanager/dota2-mod-manager/discussions) | Questions, setups worth showing, and anything that is not yet a bug |
| [Discord](https://discord.gg/PBvG8D9MxT) | Quick help in the Mod Manager post under #utilities on the D2PFX catalog's server, and new versions in #mod-manager. The maintainer is there as Fleece, with the Dota 2 Mod Manager Dev role and this GitHub account linked on the profile. The server's [widget](https://discord.com/widget?id=1488030765429166163) lists who is online, no account needed |
| [Security](SECURITY.md) | Vulnerabilities, privately — never a public issue |
| [hello@dota2modmanager.com](mailto:hello@dota2modmanager.com) | Anything that does not fit a public tracker: press, licensing, a company asking questions |

Two things first: make sure you are on the latest version, and if Dota updated recently, open
the app and let it put the patch back.

<br>

## Project activity

<div align="center">
  <img src="https://dota2modmanager.com/activity.svg" alt="Commits per day over the last 60, split between work done by hand and work done by CI, with release days marked" width="100%">
</div>

Drawn from this repository's own `git log` when [the site](https://dota2modmanager.com) rebuilds,
which it does daily and after every release. No third-party widget, so nobody reading this page
is loading a tracker, and nothing has to be committed for the picture to move.

**What runs on every push:**

| | |
|---|---|
| [Tests](.github/workflows/test.yml) | eslint first, then the full suite with a coverage floor, on Linux and on Windows. Several of the tests hold the project against itself rather than testing a module: every IPC channel has a handler and every handler runs, every renderer import resolves, every Russian string has an English twin, the version and both changelogs agree, `docs/API.md` still matches the source, and `DECISIONS.md` still matches the repository |
| [CodeQL](.github/workflows/codeql.yml) | Security and quality analysis, plus a weekly scheduled run |
| [Linux](.github/workflows/linux.yml) | Builds the AppImage, starts the app against the sandbox, photographs the first window and reads the log for code that could not run |
| [Window](.github/workflows/e2e.yml) | On Linux and on Windows: installs a mod, switches it off and on and removes it by clicking in the window, checking the game folder on disk after each launch. Offline, with a fixture catalog |
| [Release](.github/workflows/release.yml) | On a tag only: builds the Windows installer, the portable build and the Linux AppImage from that commit into a draft release, installs the installer and the AppImage from the draft and clicks a mod through each, and publishes the release with its changelog section only when both pass |
| [Site](.github/workflows/site.yml) | Rebuilds the documentation site so its counts, its version and this card stay true. On a pull request it only builds the site and checks the output |
| [Mirror](.github/workflows/mirror.yml) | Pushes the same history to [GitLab](https://gitlab.com/TheFleece/dota2-mod-manager), so the code outlives this repository |
| [Search report](.github/workflows/seo.yml) | Weekly, not per push: downloads, update checks, and visits from Google, Bing and Yandex, posted to [one public issue](https://github.com/dota2modmanager/dota2-mod-manager/issues/3) with every earlier week above it |
| [Radar](.github/workflows/radar.yml) | Daily, not per push: rewrites the pinned "Project status" issue with what waits on a decision, what is red and what is about to expire, and messages the maintainer about anything overdue |
| [Pull request rules](.github/workflows/pull-request.yml) | On every pull request: a change that fixes something changes a test too, or says in a `No-Test-Because:` line why it cannot |
| [Labels](.github/workflows/labels.yml) | Keeps the repository's labels equal to `.github/labels.json` |
| [Dependency updates](.github/workflows/dependency-updates.yml) | On Dependabot's pull requests: a minor or patch update queues itself to merge, and goes in once every required check passes and a maintainer approves it; anything bigger gets a label and waits for the maintainer |
| [Scorecard](.github/workflows/scorecard.yml) | Weekly and on every change to main: OpenSSF Scorecard grades how the repository is kept (pinned actions, token permissions, branch protection, signed releases) and publishes the score behind the badge above |

Nothing here commits back to `main`. Workflows that need to remember something between runs
keep it in the Actions cache, or, for the weekly report, at the end of its own comment, because
a bot commit per run is how a log stops being readable.

<br>

## Development

```bash
npm install
npm start                 # run the app
npm test                  # the whole suite, no framework, no mocks library
npm run test:coverage     # the same with the floor CI enforces
npm run docs              # regenerate docs/API.md from src/
npm run sandbox:seed      # a throwaway game tree with real mods in it
npm run start:sandbox     # the app against it, never your own game
```

Node 24, Electron 44, no bundler — the renderer is plain HTML, CSS and JavaScript. Every release
is produced by [`release.yml`](.github/workflows/release.yml) from the commit its tag names.

**Open an issue before building anything larger than a fix.** It costs one message and saves the
case where two people solve the same thing twice, or where the answer was "that is deliberate,
and here is why". [CONTRIBUTING.md](CONTRIBUTING.md) has the rest;
[AGENTS.md](AGENTS.md) is the same ground for anyone working with a coding assistant.

<br>

## Written with Claude Code

This project has been written with [Claude Code](https://claude.com/claude-code) since its first
commit on 20 July 2026, and still is. Commits carry a `Co-Authored-By` trailer saying so.

It says so here because guessing is worse. Everything that would tell you whether the code is any
good is already in the open: every commit, more than forty test files, a linter and a coverage
floor that CI enforces on two operating systems, and
[DECISIONS.md](DECISIONS.md), which answers the questions reviewers keep asking with a command
you can run yourself.

Send a change written with an assistant and keep the trailer on it. [AGENTS.md](AGENTS.md) is
what the project asks for in return.

<br>

## What it is built on

Everything third-party the app ships or fetches, with the licence it comes under. The
[NOTICE](NOTICE) file has the full text and the two additional terms this project adds under
section 7 of the GPL.

| | What for | Licence |
|---|---|---|
| [Electron](https://github.com/electron/electron) | The window and the process behind it | MIT |
| [electron-updater](https://github.com/electron-userland/electron-builder) | Update checks and installing them | MIT |
| [adm-zip](https://github.com/cthackers/adm-zip) | Reading mod archives, behind our own size and path guards | MIT |
| [Source 2 Viewer](https://github.com/ValveResourceFormat/ValveResourceFormat) | Decoding Dota's own textures for item icons. Downloaded on demand, never bundled | MIT |
| [Inter](https://github.com/rsms/inter), [Exo 2](https://github.com/NDISCOVER/Exo-2.0), [Material Symbols](https://github.com/google/material-design-icons) | The typefaces and icons, shipped inside the app rather than fetched | OFL-1.1, Apache-2.0 |
| [Astro](https://github.com/withastro/astro) | The documentation site, not the app | MIT |

<!-- facts:deps-en -->
`package.json` lists seven: `adm-zip` and `electron-updater` ship inside the app, `electron`, `electron-builder`, `eslint`, `fast-check` and `typescript` only build or check it.
<!-- /facts:deps-en -->
The tests and everything under `tools/` use no dependencies at all. The VPK reader and writer, the KeyValues parser, the zip guards and the
update logic are written here, because every dependency is a stranger with write access to a
game folder on tens of thousands of machines.

Valve's own `vpk.exe` is deliberately **not** here and must not be added: it is proprietary, and
a project that bundles it is not open source in the sense SignPath's terms mean. Reading and
writing VPK archives is done by this repository's own code, which is why `src/vpk.js` exists.

<br>

## Credits

- **All mods, previews, guides and catalog data** come from the open-source
  [**D2PFX**](https://github.com/h6rd/Dota2PornFxWeb) repository by [h6rd](https://github.com/h6rd)
  and the Dota 2 modding community. This app is a desktop client for their catalog, and every mod
  card in it credits its author.
- Community tools (VPKMerge, Background Changer, Compiler, ItemsFix) belong to their authors.
- **[hanta](https://www.youtube.com/@hqnta)** filmed a
  [walkthrough](https://www.youtube.com/watch?v=Z_yalpuP6pA) in Russian, which answers more
  questions than this page does for anyone who would rather watch than read.

Every other page that links here, from the catalog's README to the projects built from this
code, is listed with dates in [MENTIONS.md](MENTIONS.md). The few the maintainer wrote are in a
list of their own.

<br>

## License

[GPL-3.0](LICENSE). Copyright (C) 2026 TheFleece.

Fork it, change it, ship your own. GPL-3.0 asks you to keep the copyright line, to say that you
changed the code and when, and to open your version under the same license. Section 7 lets an
author add two more, and this repository does: keep the credit the app shows, and pick your own
name for your version. [NOTICE](NOTICE) puts all of it in plain words.

Catalog content belongs to [h6rd](https://github.com/h6rd/Dota2PornFxWeb) and the mod authors,
under the license in their repository.

<div align="center">
<sub>Not affiliated with Valve Corporation. You modify game files at your own risk.</sub>
</div>
