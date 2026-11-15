# The antivirus check never ran

| Field | Value |
| --- | --- |
| Date | 2026-09-20 |
| Versions | 2.7.0 |
| Fixed in | unreleased |
| Impact | The first release after the check was built went out without it, under release notes saying every release is scanned. No user was at risk; the answer to a false positive was missing. |

## What happened

`virustotal.yml` was added on 2026-09-17 to look up every published file on VirusTotal and put
the verdict in the release notes, because two false positives had reached people and there was
nothing to point them at.

Its first chance was 2.7.0 on 2026-09-20. It did not take it. The release was public, the
changelog said "Every release is scanned, and the result is published", and the workflow had no
runs at all, not one, since the day it was written. It was started by hand afterwards.

## Why

The workflow listens for `release: published`. That event is never raised here, because the
release is published by `release.yml` using `GITHUB_TOKEN`, and GitHub deliberately refuses to
start workflows from events created with its own token. Without that rule a workflow could
publish a release that started itself for ever.

So the trigger was correct for a release published by a person, and wrong for the only way this
project publishes one.

## Why nothing caught it

- **Nothing was red.** The workflow was active, its YAML was valid, its secret was set and checked
  every morning, and its tests passed. A workflow that never starts fails nothing.
- **The radar looks for lateness, and lateness needs a schedule.** It reports a scheduled workflow
  that has not run for twice its interval, and a workflow whose last run failed. This one has no
  schedule and no last run, so both rules passed over it.
- **The release workflow checked what it produced, not what it asked for.** It verifies that the
  release is single, is the latest, and carries every file an updater reads. Nobody had written
  down that it also owes a scan.

## What catches it now

- `.github/workflows/release.yml` "Ask for the antivirus check on this tag": `publish` starts
  `virustotal.yml` by name with `gh workflow run`, which is an API call rather than an event, and
  the job now asks for `actions: write` to be allowed to.
- `test/workflows.test.js` "the release asks for the antivirus check by name, because the event
  never comes"
- `tools/ops/radar.mjs`: a workflow with no schedule that runs on a release and has never run once is
  red on the status issue, with what to do about it.
- `test/radar.test.js` "a workflow that only runs on a release, and never has, is red"
