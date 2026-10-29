# Privacy

Dota 2 Mod Manager sends nothing about you anywhere and has no account you need. The one thing it
reports is a count: installing a catalog mod adds one to that mod's download number, and you can
switch that off. This page says exactly what that means, and lists every address the app can
contact and why, so the claim is checkable rather than a promise.

Everything below is read off the source in this repository. The file it came from is named on
each line; if any of this stops being true, that file changed and this page is wrong.

## What is not collected

- **No telemetry or analytics about you.** Nothing records what you switch on, how long the app
  is open, or that it was opened at all. The one count there is, of catalog downloads, is
  described in *The download counter* below, and it carries no identifier.
- **No identifiers.** Your Steam ID, Dota account, machine name, hardware and IP are never read
  by the app and never sent anywhere by it.
- **No crash reporting service.** Errors are written to a log file on your own disk and stay
  there. Sending one is a thing you do by hand (see *The diagnostic report* below).
- **No advertising, no third-party trackers, no cookies.** There is no tracking script in the
  app, and there is none on [dota2modmanager.com](https://dota2modmanager.com) either.
- **No account.** You do not sign in to use any feature. The one optional sign-in is described
  below and it stores no credentials.

The download counts of the app itself, quoted on the site and in the README, come from GitHub's
own release API, which counts files, not people.

## The download counter

The numbers on the catalog's cards (how many times each mod was downloaded) come from a counter
the catalog's author runs as a Cloudflare Worker, the same one the catalog site counts with.

- **What goes up.** When you install a mod from the catalog, the app sends the counter that mod's
  key, for example `heroes/Spectre Arcana/II`: category, group, name, and the look you picked.
  Several installs close together leave as one request. Nothing else is in it: no id, no
  machine, no settings, no list of what else you have.
- **What comes down.** The public list of counts, `downloads.json`, at most every few minutes,
  kept on disk so the cards still have numbers offline.
- **Switching it off.** Settings → Catalog → *Count my downloads*. Off, nothing goes up; the
  numbers still come down.
- **What the counter sees.** The key above, and what any host sees of any request, your IP
  among it. What the Worker keeps is up to the catalog's author; the app sends it nothing more.
- **If it is down.** Nothing changes: an install never waits for the counter, and a request
  that fails is dropped, not retried.

The code is `src/download-stats.ts`. A build only counts when it carries the counter's token,
which the release workflow puts in from a repository secret (`tools/stats-token.mjs`); a build
you make yourself counts nothing.

## Where the app connects, and why

Every request the app makes is to fetch something public, except the one download count above.
None of them carries information about you beyond what any HTTP request unavoidably reveals to
the host it is sent to.

| Host | What for | Where in the code |
|---|---|---|
| `raw.githubusercontent.com` | The mod catalog (`Dota2PornFxWeb`), the fingerprint map, and the remote config that lets a broken feature be switched off without a release | `src/catalog.ts`, `src/fingerprints.ts`, `src/remote-config.ts` |
| `github.com` | Update checks and downloading a new version from Releases | `electron-updater`, `src/updater.ts`, `src/portable-update.ts` |
| `cdn.dota2modmanager.com` | A copy of the catalog's mod archives and their preview pictures, the pinned toolchain, and since 2.6.5 the app's own updates, so all of that still works when GitHub is unreachable | `src/net.ts`, `renderer/ui/media.ts`, `src/portable-update.ts` |
| `huggingface.co` | Another copy of the catalog's mod archives, kept by the catalog's author, tried after `cdn.dota2modmanager.com`. It is named in the signed remote config rather than in the app, and a download from it counts only if it matches the hash the catalog publishes | `config/app.json`, `src/remote-config.ts`, `src/net.ts` |
| `dota2modmanager.com` | A mirror of the small catalog files, same reason, and the one copy where a file and its signature are always from the same moment | `src/net.ts`, `src/catalog.ts` |
| `cdn.jsdelivr.net`, `ghproxy.net`, `gh-proxy.com`, `ghfast.top` | Public GitHub mirrors, tried only when the ones above fail. The list itself is remote config, so a mirror that misbehaves can be dropped without a release | `src/net.ts` |
| `dota2.fandom.com`, `liquipedia.net` | Item and hero pictures for the free-cosmetics screen, when the game's own files do not have one | `src/icons.ts` |
| `d2pfx-counter.hrdqfck.workers.dev` | The catalog's download counter: the counts on the cards, and one hit per catalog install unless you switch counting off (see above). Through the download proxy when one is set | `src/download-stats.ts` |
| `discord.com`, `cdn.discordapp.com` | **Only** if you press *Sign in with Discord*, and only to read your name and avatar | `src/discord-auth.ts` |

**A download proxy, if you set one.** Settings has a field for an HTTP or HTTPS proxy, empty by
default. When it is set, the catalog, the fingerprint map, mod archives, the remote config, the
toolchain and the portable build's updates go through it, so the proxy learns which of the hosts
above the app asks and when. What it carries is still HTTPS end to end and still checked against
the catalog's signed hashes, so it cannot change a file unnoticed. The installed app's own updates,
the Discord sign-in and the item pictures do not use it (`src/download-proxy.ts`).

The app never contacts Valve or Steam, and never touches your Steam account. It reads Steam's
own configuration files on disk to find where Dota is installed and which language it is set
to; nothing is written to them except the game's language setting, and only when you ask.

## The optional Discord sign-in

It exists for one reason: to put your name on a preset you share, so the person receiving it
knows who made it. Everything else works without it.

- The password is typed into **your own browser on discord.com**. The app never sees it.
- The token comes back in the URL fragment, which browsers do not send to a server.
- There is **no refresh token**, and the app does not want one. The token is used once to read
  your name and avatar and is then dropped. Nothing long-lived is stored, so there is nothing
  here for malware to lift later.
- What is kept in `settings.json` afterwards: your Discord id, username, and the avatar as a small embedded picture rather than a link back to Discord. Signing
  out deletes them.

## Your Discord status

While the app is open, it tells the Discord client on your own computer what to put on your
profile: the app's name, which tab you have open, how many mods are switched on, when the session
started, and a button that opens dota2modmanager.com. The app sends that over the local
connection Discord opens for games (a named pipe on Windows, a socket on Linux), not over the
internet. Discord then shows it to the people who can see your profile, the way it shows any game
you play. It is on unless you switch it off in Settings, and switching it off closes the
connection. The code is `src/discord-presence.ts`.

## Preset links

A shared preset link carries the preset after the `#` in the address. Browsers never send that
part to a server, so the page that opens the link on dota2modmanager.com does not learn which
mods anybody shared.

## Children

The app is not directed at children under 13.

## What is stored on your computer

All of it in `%APPDATA%\Dota 2 Mod Manager` on Windows, `~/.config/Dota 2 Mod Manager` on Linux.
Nothing leaves that folder unless you send it.

| File | What is in it |
|---|---|
| `settings.json` | Your preferences: game path, language, scale, theme, favourites, and the Discord name if you signed in |
| `manifest.json` | Which mods you installed and which presets you saved |
| `downloads/` | The mod archives you downloaded, kept so a reinstall needs no network |
| `logs/` | What the app did, on your disk only |
| `catalog-cache/`, `icons/`, `fingerprints.json`, `download-counts.json` | Copies of public data, so the app works offline |

Uninstalling offers to remove this folder. Removing it by hand is enough on its own.

## What the app writes into the game

Not a privacy question, but people ask it here, so: the app puts `.vpk` files into Dota's own
mod folder and can put fonts and cursors in the game's folders with the originals backed up
first. **Safe mode**, on by default, means it touches none of Dota's own files. Turning it off
adds one line to `gameinfo_branchspecific.gi` and a signature to `dota.signatures`, both backed
up before the first edit and restored byte for byte when it goes back on.
[The whole picture](https://dota2modmanager.com/docs/safe/).

## The diagnostic report

**Settings → Diagnostics → Export report** writes a zip **to a location you choose**. Nothing is
uploaded. It holds your game path, the list of installed mods, your settings, your displays and
their sizes, and the tail of the log — which is what somebody needs to answer a bug report, and
which is why you should look at it before sending it to anyone.

## The website

[dota2modmanager.com](https://dota2modmanager.com) is a static site on Cloudflare Pages with no
analytics, no tag manager and no cookies. Fonts, styles and scripts are served from the site
itself. Cloudflare keeps request logs the way any host does; nothing beyond that is collected,
and there is nothing on the site that could identify a visitor to us.

## Writing to hello@ or security@

Both addresses are Cloudflare Email Routing, and a letter to either is handled in two steps, in
this order. It is forwarded whole to the maintainer's own mailbox, so nothing is lost or
rewritten on the way. Then a line about it is posted to a private channel the maintainer reads,
so it is seen the same day rather than in a week.

That line carries the headers and nothing else: who it is from, who it was addressed to, the
subject, the size, and whether SPF and DKIM passed. Not the body, not attachments. The code is
`tools/email-worker/worker.js` in this repository, which is the whole of it.

The letter itself is in a Gmail mailbox after that, and Google's terms apply to it the way they
apply to any mail sent to any Gmail address. If that matters for what you are writing, say so and
ask for another way to continue.

## Changes

This file changes when the app does. Its history is in this repository, so what it said on any
date is a matter of record rather than of memory.

Questions: [an issue](https://github.com/dota2modmanager/dota2-mod-manager/issues), or the
[Discord](https://discord.gg/PBvG8D9MxT). Security reports go through [SECURITY.md](SECURITY.md)
instead, privately.
