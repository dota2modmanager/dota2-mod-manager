# Privacy

Dota 2 Mod Manager collects nothing, sends nothing about you anywhere, and has no account you
need. This page says exactly what that means, and lists every address the app can contact and
why, so the claim is checkable rather than a promise.

Everything below is read off the source in this repository. The file it came from is named on
each line; if any of this stops being true, that file changed and this page is wrong.

## What is not collected

- **No telemetry, analytics or usage statistics.** Nothing counts what you install, what you
  switch on, how long the app is open, or that it was opened at all.
- **No identifiers.** Your Steam ID, Dota account, machine name, hardware and IP are never read
  by the app and never sent anywhere by it.
- **No crash reporting service.** Errors are written to a log file on your own disk and stay
  there. Sending one is a thing you do by hand (see *The diagnostic report* below).
- **No advertising, no third-party trackers, no cookies.** There is no tracking script in the
  app, and there is none on [dota2modmanager.com](https://dota2modmanager.com) either.
- **No account.** You do not sign in to use any feature. The one optional sign-in is described
  below and it stores no credentials.

The download counts quoted on the site and in the README come from GitHub's own release API,
which counts files, not people. Nothing in the app reports back.

## Where the app connects, and why

Every request the app makes is to fetch something public. None of them carries information
about you beyond what any HTTP request unavoidably reveals to the host it is sent to.

| Host | What for | Where in the code |
|---|---|---|
| `raw.githubusercontent.com` | The mod catalog (`Dota2PornFxWeb`), the fingerprint map, and the remote config that lets a broken feature be switched off without a release | `src/catalog.ts`, `src/fingerprints.ts`, `src/remote-config.ts` |
| `github.com` | Update checks and downloading a new version from Releases | `electron-updater`, `main.js`, `src/portable-update.ts` |
| `cdn.dota2modmanager.com` | A copy of the catalog's mod archives and their preview pictures, the pinned toolchain, and since 2.6.5 the app's own updates, so all of that still works when GitHub is unreachable | `src/net.ts`, `renderer/ui/media.js`, `src/portable-update.ts` |
| `huggingface.co` | Another copy of the catalog's mod archives, kept by the catalog's author, tried after `cdn.dota2modmanager.com`. It is named in the signed remote config rather than in the app, and a download from it counts only if it matches the hash the catalog publishes | `config/app.json`, `src/remote-config.ts`, `src/net.ts` |
| `dota2modmanager.com` | A mirror of the small catalog files, same reason, and the one copy where a file and its signature are always from the same moment | `src/net.ts`, `src/catalog.ts` |
| `cdn.jsdelivr.net`, `ghproxy.net`, `gh-proxy.com`, `ghfast.top` | Public GitHub mirrors, tried only when the ones above fail. The list itself is remote config, so a mirror that misbehaves can be dropped without a release | `src/net.ts` |
| `dota2.fandom.com`, `liquipedia.net` | Item and hero pictures for the free-cosmetics screen, when the game's own files do not have one | `src/icons.js` |
| `discord.com`, `cdn.discordapp.com` | **Only** if you press *Sign in with Discord*, and only to read your name and avatar | `src/discord-auth.ts` |

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
| `catalog-cache/`, `icons/`, `fingerprints.json` | Copies of public data, so the app works offline |

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
