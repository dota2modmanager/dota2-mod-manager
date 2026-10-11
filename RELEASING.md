# Releasing

How a version goes out, what stops it on the way, and what to do when one that went out is wrong.

## The path

1. Both changelogs get a section for the new version, `CHANGELOG.md` and `CHANGELOG.ru.md`, covering
   everything since the last tag. `test/release-contract.test.js` fails the pull request if the
   version in `package.json` has no section or an empty one.
2. The version in `package.json` goes up in the same pull request, which merges like any other.
3. A maintainer tags the merged commit `vX.Y.Z` and pushes the tag. Nothing else starts a release,
   and the `gate` job refuses a tag on a commit that is not on main.

The tag starts `.github/workflows/release.yml`:

| Job | What it does | Who can see it |
|---|---|---|
| `gate` | Refuses a tagged commit that is not on main, then waits until it has passed every check in `.github/required-checks.json`, and fails if one failed. Then `tools/release-preflight.mjs` checks what the jobs after `publish` will need: `package.json` carries the tag's version, the tag is not published already, both changelogs have the section, the Discord webhook answers, the mirror's bucket takes the keys, and `virustotal.yml` and `release-watch.yml` are switched on | nobody |
| `build` | Opens the release as a draft with its changelog section, builds the installer and the portable exe into it, and checks the draft is the only release on the tag | the maintainer |
| `linux` | Builds the AppImage into the same draft | the maintainer |
| `checksums` | Downloads every file on the draft, copies `latest.yml` and `latest-linux.yml` to `beta.yml` and `beta-linux.yml` for the beta channel, writes `SHA256SUMS` and an SBOM, attests the build provenance of every file and the SBOM through Sigstore, and puts all of it on the draft | the maintainer |
| `try-windows` | Downloads the installer from the draft, checks it against `SHA256SUMS`, installs it, and runs `tools/e2e.mjs` against the installed app | the maintainer |
| `try-linux` | Downloads the AppImage from the draft, checks it against `SHA256SUMS`, unpacks it, and runs `tools/e2e.mjs` against it | the maintainer |
| `try-update` | Installs the last published stable release, gives it a mod and a favourite, runs the draft's installer over it with `/S` the way an update arrives, checks the new version has them (`tools/e2e.mjs --upgrade`), answers the removal window three ways, and removes the app with its own uninstaller | the maintainer |
| `publish` | Checks the draft carries every file in `tools/release-state.js`, takes it out of draft, then checks it is the latest | everybody |
| `antivirus` | Asks `virustotal.yml` to scan the release and put the verdict in its notes | everybody |
| `mirror-update` | Brings the update mirror to what GitHub serves, the release and a newer beta together, and reads back each file's version and size | everybody |
| `notify` | Posts the changelog section to Discord, whatever `mirror-update` did, and notes in the release that it was announced | everybody |

Installed copies look for updates at `/releases/latest`, and a draft never shows up there. So nobody
receives a version before both builds of it installed a mod and removed it, and after `publish`
everybody receives it together.

Releases are **immutable**: once one is published its files and its tag are fixed, and its tag
cannot be used again, even after the release is deleted. That is why every file goes on the draft
and the draft is checked for all of them before `publish`. Nothing after `publish` adds a file, and
`test/workflows.test.js` fails a pull request that tries. A published release that turns out wrong
is followed by a new version, never replaced under the same number.

## After the release: `release-watch.yml`

The three jobs after `publish` do not wait on each other succeeding, and a failure in one is a red
job, not a skipped release. What they leave undone, `release-watch.yml` does. It runs when a release
run ends and every three hours, and `tools/release-watch.mjs` checks:

- the release and the beta the updater reads carry every file;
- the update mirror serves the same versions and the same sizes as GitHub, and if not, brings it up
  to date with `tools/r2-release.mjs --current`;
- the release was announced in Discord, and if the release run did not post it, posts it once;
- the antivirus report is in the notes, and if nothing ran the check, asks for it.

What it cannot put right turns its run red and shows on the radar: a published release missing a
file, a webhook Discord keeps refusing, a check that ran and wrote nothing. Releases published before
2026-09-26 are held to the mirror only.

To see where the mirror stands without changing anything:

```bash
node tools/r2-release.mjs --check
```

## Betas

A beta is a tag with a prerelease part: `v2.7.0-beta.1`. It goes through the same `gate`, the same
builds and the same `try-windows`, `try-linux` and `try-update` install runs, because a build nobody has
installed is not worth handing to a tester either. After that it parts company with a release:

- it stays a **prerelease** and never becomes `/releases/latest`, which is the endpoint every copy
  on the stable channel follows;
- it carries `beta.yml` and `beta-linux.yml`, and that is what the app reads for somebody on the
  beta channel. It carries the `latest` pair too, because electron-builder writes it for every
  version, and nobody on the stable channel reads a prerelease;
- it goes to the update mirror beside the release, with `-beta` in the name of every binary and
  its two manifests rewritten to ask for those, so it can never stand where the installer
  `latest.yml` describes. A tester whose GitHub is down reads `beta.yml` there;
- `notify` is skipped: the people it is for were picked by name, and the app offers it to them.

Who is offered a beta is a list of Discord accounts in the signed `config/app.json`, as hashes:

```bash
CATALOG_KEY=/path/to/config-key.pem npm run rollback -- invite 123456789012345678
CATALOG_KEY=/path/to/config-key.pem npm run rollback -- uninvite 123456789012345678
npm run rollback -- list
```

The id comes from Discord itself: Developer Mode on, right-click the person, Copy User ID. It is
hashed on the way in, because this file is published here and a list of a dozen people's accounts
is not ours to publish. The file and its `.sig` go in one pull request, like any other change to it.

A tester taken off the list, or signed out of Discord, is back on the stable channel at the next
check without anybody touching their machine, and the switch in their settings disappears.

A release carries `beta.yml` and `beta-linux.yml` too, copies of its own feed, and `mirror-update`
writes the same beside it on the mirror, so a tester moves on to the released version whether they
reach GitHub or the mirror. Once no beta is newer than the release, the beta's binaries leave the
bucket.

A beta that went out wrong is followed by the next number (`-beta.2`): its tag cannot be used again.

## A job before `publish` failed

Nobody outside the repository saw anything. The draft sits on the releases page, visible only to
people with write access.

1. Read why. The two `try-*` jobs upload `e2e-release-windows` and `e2e-release-linux`: a screenshot
   per launch, the window's step report and the app log.
2. Delete the draft:

   ```bash
   gh release delete vX.Y.Z --yes
   ```

3. Delete the tag, here and on GitHub:

   ```bash
   git tag -d vX.Y.Z
   git push origin :refs/tags/vX.Y.Z
   ```

4. Fix it through a pull request and tag the new merge commit with the same version. No copy ever
   received that version, and a draft was never published, so the number is still free.

Do not publish the draft by hand. The jobs that stopped it are the only thing that ran the build
about to go out.

## A published release is broken

Copies that already updated stay on it: the updater never moves anybody to a lower version. You
control how many more copies take it, and what the ones on it are told.

**Ship a fix.** A patch release through the path above is the normal answer, and the only one that
reaches copies already on the broken version.

**Stop the broken version doing damage, and tell its users why.** Every running copy fetches
`config/app.json`, signed with a key that is not in this repository. `tools/rollback.mjs` writes that
file, signs it and refuses the mistakes that matter under pressure:

```bash
npm run rollback -- list
CATALOG_KEY=/path/to/config-key.pem npm run rollback -- block install --versions 2.7.0 --until 2026-09-27 --en "Installing is paused in 2.7.0. Update to 2.7.1." --ru "В 2.7.0 установка на паузе. Обнови до 2.7.1."
```

A **block** switches `install`, `cosmetics` or `voice` off for a range of versions (`2.7.0`, or
`2.7.0-2.7.2`) until a day, and adds a notice for exactly those versions. The release with the fix is
not touched, and the block lets go by itself the day after `--until`. Copies before 2.6.13 do not
read blocks at all, which is what made adding them safe, and the tool refuses a range that reaches
them rather than write a block that does nothing there.

For those older copies, or when the cause is outside the app (a Dota patch), switch the feature off
in **every** version, and restore it once that is safe:

```bash
CATALOG_KEY=/path/to/config-key.pem npm run rollback -- everywhere install --en "…" --ru "…"
CATALOG_KEY=/path/to/config-key.pem npm run rollback -- restore install
```

`lift <id>` takes a block out early, `prune` takes out everything past its day, and `sign` signs the
file as it stands. A key that is not the one the app pins is refused before anything is written,
because every copy would ignore what it signed. Without `CATALOG_KEY` the tool writes the file and
says it is unsigned; `test/remote-config-signature.test.ts` then fails the pull request, so an
unsigned file cannot go out.

`config/app.json` and `config/app.json.sig` go in one pull request, merged through the checks. A
notice hides itself after its day, but copies released before that field existed ignore it, so run
`prune` once the date has passed.

**Stop it spreading, when the build damages game folders.** Mark the release a pre-release.
`/releases/latest` skips pre-releases, so copies that have not updated stop being offered it, and the
files stay on the page for anyone who needs them:

```bash
gh release edit vX.Y.Z --prerelease
gh api repos/dota2modmanager/dota2-mod-manager/releases/latest --jq .tag_name
```

The second command has to print the previous version. `release-watch.yml` then brings the update
mirror back to that version on its next run; start it by hand to have it now:

```bash
gh workflow run release-watch.yml --repo dota2modmanager/dota2-mod-manager
```
