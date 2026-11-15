// A hero's or a hero item's catalog mod in 3D in its window (renderer/catalog/modal/stage.ts), and
// the creator line under it (creator-of.ts). The mods are shaped as the catalog had them on
// 2026-11-15: heroes is a flat list, hero-items is grouped by hero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modStage, stockSlots } from '../renderer/catalog/modal/stage.ts';
import { creatorOf } from '../renderer/catalog/modal/creator-of.ts';

const author = (url: string) => ({ type: 'author', url });

test('a hero mod and a hero item mod are staged; the rest of the catalog is not', () => {
  const io = { name: 'IO Purple', file: 'IO Purple.zip', links: [author('hrdq')] };
  assert.deepEqual(modStage('heroes', io, io.file), { category: 'heroes', file: 'IO Purple.zip', hint: 'IO Purple' });
  // an item is named after its set, its group after the hero it is for
  const blades = { name: 'Alchemist Radiance Blades', file: 'Alchemist Radiance Blades.zip', _group: 'Alchemist' };
  assert.equal(modStage('hero-items', blades, blades.file)?.hint, 'Alchemist');
  assert.equal(modStage('terrains', io, io.file), null);
  assert.equal(modStage('heroes', io, 'https://example.com/io'), null, 'a link installs nothing the stage could read');
  assert.equal(modStage('heroes', { ...io, type: 'pack' }, io.file), null);
  assert.equal(modStage('heroes', io, null), null);
});

test('the hero stands in its own slots in their stock items', () => {
  const slots = [
    { slot: 'item:alchemist:weapon', targetId: '9490', heroIds: ['alchemist'] },
    { slot: 'item:alchemist:head', targetId: 9491 as unknown as string, heroIds: ['alchemist'] },
    { slot: 'item:alchemist:ability1', targetId: '1', heroIds: ['alchemist'], abilityFx: 1 },
    { slot: 'item:axe:weapon', targetId: '12', heroIds: ['axe'] },
    { slot: 'item:alchemist:taunt', heroIds: ['alchemist'] },
  ];
  assert.deepEqual(stockSlots(slots, 'npc_dota_hero_alchemist'), [
    { slot: 'item:alchemist:weapon', stock: '9490' },
    { slot: 'item:alchemist:head', stock: '9491' },
  ]);
  assert.deepEqual(stockSlots(slots, 'alchemist').length, 2);
});

test('the creator is the first author, counted in the catalog and in the category', () => {
  const mine = { name: 'A', links: [author('hrdq')] };
  const all = [mine, { name: 'B', links: [author('Hrdq')] }, { name: 'C', links: [author('keeper')] }, { name: 'D', links: [author('hrdq')] }];
  assert.deepEqual(creatorOf(mine, all, all.slice(0, 3)), { name: 'hrdq', mods: 3, here: 2 });
  assert.equal(creatorOf({ name: 'nobody' }, all, all), null);
  // only sent in: the sender did not make it
  assert.equal(creatorOf({ name: 'E', links: [{ type: 'sender', url: 'x' }] }, all, all), null);
});
