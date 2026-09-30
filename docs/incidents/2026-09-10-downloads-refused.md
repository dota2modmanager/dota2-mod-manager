# Mods refused after the checksum check arrived

| Field | Value |
| --- | --- |
| Date | 2026-09-10 |
| Versions | 2.6.5 |
| Fixed in | 2.6.6 |
| Impact | 24 mods failed for players served by the R2 mirror first, and one mod failed for everybody. |

## What happened

2.6.5 started checking every mod archive against the SHA-256 the catalog publishes in
`mod-hashes.json`, and refused an archive that did not match. Three faults met it on the same day.

1. The R2 mirror held old copies. `tools/r2-sync.mjs` skipped any object already in the bucket
   under the same name, so a mod its author had replaced kept its old bytes there: 24 of them, one
   since August. A player who cannot reach GitHub is served from that mirror first.
2. A download ended at the first mirror whose bytes did not match. The three sources holding the
   current file were never asked.
3. The catalog bot published a hash for one mod that no copy of that file has ever had.

## Why

The check believed two things nobody had measured: that the mirror carried what the catalog
serves, and that the published list described either of them.

## Why nothing caught it

- The download tests served every file from one fake server holding the right bytes.
- The mirror job counted what it copied and skipped, and never compared contents.
- Nobody downloaded through the mirror before the release went out.

## What catches it now

- `tools/mirror-plan.js`: the two decisions the mirror job was missing. It measures each file
  against the published hash before copying it, and copies again an object whose size no longer
  matches the source.
- `test/mirror-plan.test.js` "a mod its author replaced is copied again, and one that did not
  change is left alone"
- `test/mirror-plan.test.js` "bytes that do not match the published hash are not uploaded"
- `test/r2-purge.test.js` "the replaced urls go to the zone, once each": a replaced copy is also
  dropped from the cache in front of the mirror.
- `test/net.test.ts` "a mirror serving a stale copy costs that mirror its turn, not the mod"
- `test/net.test.ts` "half a file from a stale mirror is not resumed from the next one"
- `test/net.test.ts` "a published hash no copy matches is a stale list, and the origin wins"
- `test/net.test.ts` "a file every mirror disowns is still refused": the fallback in 2.6.6 does
  not turn into accepting anything.
- `test/net.test.ts` "a hash this project pinned itself is never waived": app updates and the
  toolchain stay held to their pinned hashes.
