<!--
Thanks for this. CONTRIBUTING.md has the details; this is the short version.
Delete anything that does not apply.
-->

## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How to see it work

<!--
What a reviewer should click. "Install two skins for the same hero, look at the library banner"
saves twenty minutes of hunting.
-->

## Checks

- [ ] `npm test` is green
- [ ] Tried it in the sandbox (`npm run sandbox:seed`, `npm run start:sandbox`), not against a real Dota install
- [ ] New user-facing strings exist in both Russian and English (`renderer/i18n.js`, `src/i18n.ts`)
- [ ] Screenshots below, if anything visual changed
- [ ] Behaviour in `patcher`, `vpk`, `gamelang` or `schema` brings its own test
