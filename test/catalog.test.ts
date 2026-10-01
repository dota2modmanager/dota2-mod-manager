// The shape of the upstream catalog, which we do not control. A mod's links come in two
// spellings and 26 previews live in the older one - the whole TI battle-pass row showed up
// with no preview button for exactly that reason.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCatalog } from '../src/catalog.ts';

/** A mod as mods.json writes it, in either spelling of its links. */
type Mod = { name: string; linkType?: string; linkUrl?: string; senderName?: string; links?: { type?: string; url?: string; name?: string }[] };

test('the older link spelling becomes a links array', () => {
  const data: { modsData: Record<string, Mod[]> } = {
    modsData: {
      'ti-bp-effects': [
        { name: 'TI 2019 Battle Pass', linkType: 'preview', linkUrl: 'assets/previews/ti/x.mp4' },
      ],
    },
  };
  normalizeCatalog(data);
  assert.deepEqual(data.modsData['ti-bp-effects'][0].links, [
    { type: 'preview', url: 'assets/previews/ti/x.mp4' },
  ]);
});

test('a sender name rides along as the link label', () => {
  const data: { modsData: Record<string, Mod[]> } = { modsData: { other: [{ name: 'M', linkType: 'sender', linkUrl: 'u', senderName: 'Someone' }] } };
  normalizeCatalog(data);
  assert.deepEqual(data.modsData.other[0].links, [{ type: 'sender', url: 'u', name: 'Someone' }]);
});

test('mods inside hero groups are reached too', () => {
  const data: { modsData: Record<string, { groups: { id: string; mods: Mod[] }[] }> } = {
    modsData: {
      'hero-items': { groups: [{ id: 'lion', mods: [{ name: 'X', linkType: 'preview', linkUrl: 'p.mp4' }] }] },
    },
  };
  normalizeCatalog(data);
  assert.equal(data.modsData['hero-items'].groups[0].mods[0].links?.[0].url, 'p.mp4');
});

test('an existing links array is added to, not replaced', () => {
  const data: { modsData: Record<string, Mod[]> } = {
    modsData: {
      heroes: [{ name: 'X', links: [{ type: 'author', url: 'a' }], linkType: 'preview', linkUrl: 'p.mp4' }],
    },
  };
  normalizeCatalog(data);
  assert.deepEqual(data.modsData.heroes[0].links?.map((l) => l.type), ['author', 'preview']);
});

test('the same link twice stays one link', () => {
  const data: { modsData: Record<string, Mod[]> } = {
    modsData: {
      heroes: [{ name: 'X', links: [{ type: 'preview', url: 'p.mp4' }], linkType: 'preview', linkUrl: 'p.mp4' }],
    },
  };
  normalizeCatalog(data);
  assert.equal(data.modsData.heroes[0].links?.length, 1);
});

test('a catalog with neither spelling survives the walk', () => {
  const data: { modsData: { heroes: Mod[]; packs: null; tools: { groups: never[] } } } = { modsData: { heroes: [{ name: 'X' }], packs: null, tools: { groups: [] } } };
  assert.doesNotThrow(() => normalizeCatalog(data));
  assert.equal(data.modsData.heroes[0].links, undefined);
  assert.doesNotThrow(() => normalizeCatalog({}));
  assert.doesNotThrow(() => normalizeCatalog(undefined));
});
