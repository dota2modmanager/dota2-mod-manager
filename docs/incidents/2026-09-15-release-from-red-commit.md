# 2.6.11 was built from a commit with a failing test

| Field | Value |
| --- | --- |
| Date | 2026-09-15 |
| Versions | 2.6.11 |
| Fixed in | pull request #21 (release gate) |
| Impact | None for players: the failing test checked a document, and the app code matched a green commit. A broken app would have shipped the same way. |

## What happened

v2.6.11 pointed at a commit where `test/docs-current.test.js` failed: `MENTIONS.md` named a file
from the catalog repository in backticks, and the test reads a backticked path as a file in this
one. `release.yml` built and published the installer, the AppImage and the update feed while the
Tests run on the same commit was red. The next commit fixed the document.

## Why

Tests and releases ran as two workflows on the same push, and nothing connected them. Before
tagging, the command chain checked the test summary with `grep`, which succeeds on `fail 1` as
well as on `fail 0`.

## Why nothing caught it

- `release.yml` never looked at the tests. On 2026-09-10 the same gap let four releases out in one
  evening, and it held because those commits happened to be green.
- Pushing to main needed no passing checks.

## What catches it now

- `tools/release/release-gate.mjs`: the first job of `release.yml` reads the check runs GitHub recorded for
  the tagged commit, waits for the required ones and fails on any failure.
- `test/release-gate.test.js` "the 2.6.11 case: Tests failed on the tagged commit, so nothing is
  built"
- `test/workflows.test.js` "release.yml builds nothing before the gate says the commit passed"
- `.github/required-checks.json`: the checks the gate waits for. The branch rule on main requires
  the same list, so a change reaches main only through a pull request that passed them.
- `test/workflows.test.js` "every required check is a job that exists, under the name GitHub will
  show"
