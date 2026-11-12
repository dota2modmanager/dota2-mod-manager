# Bundled renderer provenance

- Upstream: https://github.com/justkiddingxd/dota-loadout, npm 0.1.0 (MIT).
- Patched source: HarlordLeg/Effect-studio, commit 576729e, `vendor/dota-loadout/src`.
- Studio adapters: `public/viewer/{scene-source,scene-animations,snapshot-data,snapshot-bindings}.mjs` and `public/particles/recolor.mjs` from the same revision.
- Import paths have been relocated so this package is self-contained. Rendering algorithms are retained.
- The port author contributed their modifications to this GPL-3.0-or-later application. Upstream MIT notices are retained in LICENSE and the source headers.
- Game assets are read locally and are not included. No upstream hosted asset service is used by the desktop adapter.

Desktop integration changes: export buildHero for headless regression checks; honor explicit parent attachment drivers. The pedestal asset was contributed by the port author.
