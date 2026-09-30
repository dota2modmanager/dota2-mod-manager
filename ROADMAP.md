# Roadmap

What this project intends to do next, and what it will not do at all.

Nothing here is a promise with a date on it. One person writes most of this, and a Dota patch can take
a week that was meant for something else. What the list is good for is knowing whether the thing
you want is coming, is coming later, or was decided against on purpose.

The reasoning behind most of these lives in [DECISIONS.md](DECISIONS.md), which also keeps the
gaps this project admits to. This file is reviewed at every release; if something here has
already shipped or has clearly stalled, that is a bug in this file and worth an issue.

## Next

**A signed Windows installer.** SmartScreen warns about every unsigned download, and that warning
is the first thing a new user sees. The first application to SignPath was turned down for public
visibility rather than for anything in the code, and the picture has changed since. Applying
again is the single change that would most improve how this app arrives on a machine.

**A download route that does not depend on GitHub.** When GitHub was down for three hours in
August 2026, no mod could be installed at all: every fallback in the app was GitHub wearing a
different hostname. There is a mirror of the catalog now, and the app can be told about further
mirrors without a release. Where the archives live for the long run is still being worked out,
because the catalog grows by tens of megabytes a week and somebody has to pay for that.

**A second home for the source.** Mirroring to Codeberg was set up and then withdrawn, for a
reason written out in [DECISIONS.md](DECISIONS.md). A repository this small should exist in more
than one place, and where is still open.

**The OpenSSF gold badge.** Silver was awarded on 2026-09-23, the day two maintainers came to own
the organization the repository lives in. Gold stands at 30%, and its answers are not written
yet: it asks for a bus factor of two, a second significant contributor who is not associated
with the first, reviews on at least half of all changes, and a licence and copyright line in every
source file.

## Later

**An Arch package, when the AUR lets anybody in again.** `tools/gen-aur.js` already builds the
PKGBUILD from a release. Registration at the AUR has been closed since late August 2026 while
they deal with a wave of automated accounts, with no queue and no date, so this is ready and
parked rather than next.

**Linux caught up with Windows.** The AppImage has shipped since 2.4.0 and CI installs a mod
through it on every change, but Windows has a year of people using it and Linux has months.

**The coverage floor measured on both platforms.** Today it is measured on one, which means a
Windows-only path can lose its test without the floor noticing.

## Not planned

**Telemetry, analytics, crash reporting or any other phone home.** The app contacts the catalog,
the update feed and nothing else. Every address it can reach is listed in
[PRIVACY.md](PRIVACY.md), and that list is kept short on purpose.

**An account to use the app.** Signing in with Discord is optional and buys exactly two things: a
name on shared presets and, for a few people, the beta channel. Nothing about installing a mod
will ever need it.

**Paid features.** The app is GPL-3.0 and stays whole. There is no plan for a paid tier, a
donation wall in front of a feature, or a sponsor build.

**A macOS build.** Dota's layout there has never been tested here and there is no machine to test
it on. Saying "not supported" is more honest than shipping something nobody has run.

**Hosting mods as if they were ours.** The mods and the catalog belong to
[h6rd/Dota2PornFxWeb](https://github.com/h6rd/Dota2PornFxWeb) and to the people who made them.
The mirror is a copy that keeps installing working when GitHub is not; it is not a store, and
this project does not decide what is in the catalog.

**Anything that changes how the game plays.** This app replaces models, effects, sounds and
cursors on your own machine. It will not touch matchmaking, game logic, or anything that gives a
player an advantage over another, and a feature request in that direction will be closed rather
than queued.

**Support for a game client that is not Valve's.** If Dota did not come from Steam, this app is
not the reason it does not work.
