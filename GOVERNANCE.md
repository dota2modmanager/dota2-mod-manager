# Governance

Who decides what happens to this project, and how you can tell.

## The model

One maintainer decides, in public, through pull requests, and a second one reads every change
before it lands. That is the whole model, and it is written down here because "one person
decides" is only honest when everybody can see where the deciding happens.

Every change to the program goes through a pull request against `main`, including the
maintainers' own. A branch rule closes direct pushes to `main`, and the same checks run for
everybody: tests on Linux and Windows, lint, the type-error ceiling, the coverage floor, the size
budget, CodeQL, the English twin for every Russian string, and the rule that a fix carries a test
or says in the commit why it does not. A pull request merges when those checks are green. No
approval is required since 2026-10-02, and [DECISIONS.md](DECISIONS.md) says why; a pull request
from outside the project still needs a maintainer to merge it.

Decisions that shape the project, rather than the code, go in [DECISIONS.md](DECISIONS.md) with
the reason and the date. A decision you can read is a decision you can argue with.

## Roles

**Maintainer: TheFleece ([@TheFleece](https://github.com/TheFleece)).** Reviews and merges
pull requests, cuts releases, answers security reports within 48 hours, keeps the app working
against a game that changes under it, and holds the keys that live outside GitHub: the signing
key for `config/app.json`, the domain and the mirror bucket. Nobody else has those, and
[Continuity](#continuity) says what that costs.

**Second maintainer: Nersaa ([@Nersaa](https://github.com/Nersaa)).** An owner of the
[dota2modmanager](https://github.com/dota2modmanager) organization the repository lives in, with
the same rights on GitHub as the maintainer: merge, tag, release, change the repository's
settings and replace its secrets. They read the maintainer's pull requests when they want to and
send their own; neither needs the other's approval to merge. They are also the answer to the
question "what happens if one person stops".
[docs/second-maintainer.md](docs/second-maintainer.md) is the whole of it, including what to do on
the day it matters.

**Contributors.** Anybody who opens an issue, a pull request or a translation.
[CONTRIBUTING.md](CONTRIBUTING.md) says what a change has to carry; nothing else is expected, and
no agreement has to be signed. Opening a pull request means the change ships under GPL-3.0 as
part of this program.

**Catalog authors.** The mods and the catalog belong to
[h6rd/Dota2PornFxWeb](https://github.com/h6rd/Dota2PornFxWeb) and to the people who made the
mods. They are not part of this project and have no say in it, and it has none in theirs. The app
reads what they publish and checks the signature on it. A problem with a mod goes to them.

## How a disagreement ends

In the issue, in writing. If it does not end there, the maintainer decides and records the
decision with its reason in [DECISIONS.md](DECISIONS.md). There is no committee and no vote:
two people voting only ever tie.

## Who can merge

<!-- Every handle here must also be in .github/CODEOWNERS, and the other way round;
     test/docs-current.test.js fails when they disagree. -->

| Person | Role | Since |
| --- | --- | --- |
| [@TheFleece](https://github.com/TheFleece) | Maintainer | 2026-07-20 |
| [@Nersaa](https://github.com/Nersaa) | Second maintainer | 2026-09-23 |

Land changes over time, show the care this project asks for, and you can be invited. The
maintainer invites, the row goes in this table, so the list of people who can merge is the same
list everybody can read.

## Continuity

A project one person can merge into is a project that stops when that person does. The answer
here is a second maintainer with rights given before they are needed, described in
[docs/second-maintainer.md](docs/second-maintainer.md). Since 2026-09-23 the repository belongs
to an organization with both maintainers as owners, so either of them can merge, tag, release and
change the branch rule without the other.

What survives either way: the code. It is GPL-3.0 and public, so anybody may fork it and carry
on, and every release carries a provenance attestation that ties its files to the commit they
were built from.

What a second maintainer adds: releases keep coming. Every pull request runs the same checks, CI
builds and signs and publishes from a tag, and none of that needs a key the maintainer holds
personally.

What stays with the maintainer whatever happens: the private key that signs `config/app.json`,
the domain and the mirror bucket. Losing those costs two conveniences rather than the project.
The switches file stays at its last signed version, which every copy treats exactly as it treats
an unreachable one, and the app falls back to GitHub when the mirror does not answer.

So "can this project keep releasing if one person disappears" gets a yes, and the project's
[OpenSSF Best Practices entry](https://www.bestpractices.dev/en/projects/14721) answers it that
way. A maintainer left alone needs nobody's approval to merge or to release.

The knowledge of how the app keeps up with a game update still sits mostly with one person as
well. Reading the changes as they land is how that moves.
