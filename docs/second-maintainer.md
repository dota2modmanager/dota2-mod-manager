# The second maintainer

What the role is, what it is not, and what to do on the day it matters.

Most of this project is written by one person. That is fine for the code, which is public and
licensed so anybody may carry it on, and it is not fine for everything around the code: releases,
the update feed people's copies read, the issues somebody has to close. Those need a person with
rights, and rights have to be given before they are needed rather than after.

So the project keeps a second maintainer. Who that is at any time is named in
[GOVERNANCE.md](../GOVERNANCE.md); this file is what the role means.

## What you get

**Owner of the [dota2modmanager](https://github.com/dota2modmanager) organization.** The
repository lives there, and both maintainers own it, so on GitHub you have the same rights as the
maintainer: merge pull requests, push tags, manage issues, labels and releases, change the branch
rule, and replace the repository's secrets. Nobody can read a secret back, you included.

That is more than day-to-day work needs, and it is on purpose: it is what lets the project carry on
if the other owner is gone.

Turn on two-factor authentication for your account. It can push a tag, and a tag ships to every
copy of the app.

## What is asked of you

**Review the maintainer's pull requests.** Since 2026-09-23 a pull request needs an approval from
a maintainer who did not write it before it can merge into main, so the maintainer's own changes
wait for you. GitHub asks you for the review by itself, through
[`.github/CODEOWNERS`](../.github/CODEOWNERS). A day or two is normal. If a week goes by, say so.

**Approve Dependabot's minor and patch updates** once their checks are green. They used to merge
themselves, and now they wait for the same approval as everything else. A major update carries the
`major-update` label and stays the maintainer's call.

**Be reachable.** If the maintainer stops answering for weeks, somebody should be able to write to
you and get an answer.

## What is not asked of you

You are not asked to write code, to fix bugs, to answer users, to be on call, or to be responsible
for anything shipping on time. Tell the maintainer you would rather stop, and it ends: this file
and GOVERNANCE.md change to match, the approval rule comes off in the same pull request, and
nothing else is said about it.

## A review here, in practice

The checks already cover what a machine can see: the suite on two systems, lint, types, coverage,
CodeQL, installing a mod through the window. Your approval covers what they cannot. Read the
description and the diff, and ask:

- does the pull request do what its title says, and nothing its title leaves out?
- could you follow this code in half a year, with the author gone?
- where the code looks wrong on purpose, does a comment say why?
- does a fix bring a test that fails without it, or a `No-Test-Because:` line you believe?

Read hardest where a mistake costs a user something:

- anything that writes into the game folder (`src/patcher.js`, `src/vpk.js`, `src/gamelang.js`,
  `src/schema.js`, `src/file-tx.ts`, `src/overlays.js`),
- anything that decides what gets downloaded or whether it is trusted (`src/net.ts`,
  `src/catalog-signature.ts`, `src/remote-config.ts`),
- the workflows, the release workflow above all,
- and any text a user reads, where a second reader catches what the first stopped seeing.

Approve when you would be fine answering for the change yourself. When you are unsure, ask in the
review: one honest question beats a polite approval. Request changes for something wrong, and
leave alone a style you would not have picked.

When the pull request is yours, the maintainer reviews it the same way.
[CONTRIBUTING.md](../CONTRIBUTING.md) says what a change has to carry, and
[ARCHITECTURE.md](../ARCHITECTURE.md) says how the thing is put together.

## If the maintainer disappears

The point of the role. In order:

1. **Give it a couple of weeks.** People come back.
2. **Say so in the open**, in an issue, so users and contributors are not guessing.
3. **Keep the project moving.** Approve and merge what contributors send once it is ready, close
   what is finished. Every pull request runs the same checks; a green one is as safe in your hands
   as in his.
4. **Release when there is something to release.** [RELEASING.md](../RELEASING.md) is the whole
   procedure: a changelog section in both languages, a version bump, a tag on main. CI builds the
   installer, signs the provenance, publishes the release and updates the mirror. No key of the
   maintainer's is needed for any of it.

What you will not be able to do, and what it costs:

- **Merge a change you wrote without switching the approval rule off first.** The rule wants an
  approval from somebody other than the author. Left alone, you turn it off in the repository's
  rulesets, say so in the issue from step 2, and turn it back on once there is somebody to review.
- **Sign `config/app.json`.** The private key stays with the maintainer. That file can switch a
  broken feature off after a release; without the key it cannot change, and every copy of the app carries on with the last signed version, which
  is the same as it being unreachable. Nothing breaks, and one emergency handle is gone.
- **Touch the site, the domain or the mirror bucket.** They keep serving what is already on them.
  The app falls back to GitHub when the mirror does not answer, which it already does whenever
  the mirror is behind.

So: releases keep coming, and two conveniences stop. That is the difference
between a project that stops dead and one that carries a dent.

## Granting the role

For the maintainer, when somebody accepts:

1. **The organization's People page, Invite member**, then change their role to **Owner**.
2. Add their handle in [`.github/CODEOWNERS`](../.github/CODEOWNERS), so GitHub asks them for a
   review on its own instead of somebody remembering to.
3. Add their name to the maintainers list in [GOVERNANCE.md](../GOVERNANCE.md). A test fails if
   the two disagree, so neither can quietly go stale.
4. Answer `access_continuity` on the
   [OpenSSF entry](https://www.bestpractices.dev/en/projects/14721) with what is now true, and
   update `.bestpractices.json` to match.
5. Point them at this file and at [RELEASING.md](../RELEASING.md). Nothing else has to be handed
   over.

Taking it back is the same list in reverse, plus the approval rule coming off while one maintainer
is left. It is not an accusation: an account that has gone quiet for a year is a key nobody is
holding.
