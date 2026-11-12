/* A courier look's models (src/courier-models.ts): the paid courier's own under the Default
 * Courier's paths, since the server sets the unit's model from its own table. Before this a courier
 * picked in unsafe mode came out as the donkey with the paid courier's particles on it. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { courierCopies } from '../src/courier-models.ts';
import { createTableBuild } from '../src/schema-build.ts';
import { buildVpk, entryAt, entryPath } from '../src/vpk.ts';
import { drain } from '../src/steps.ts';
import type { LibRecord } from '../src/types.ts';
import { encodeKv3, resource } from './helpers/kv3-build.ts';

const mod = (type: string, asset: string, modifier: string, style = '') => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"${type}"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n${style ? `\t\t\t\t\t"style"\t\t"${style}"\n` : ''}\t\t\t\t}\n`;
const item = (id: string, name: string, extra: string, visuals: string) =>
  `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"courier"\n${extra}\t\t\t"visuals"\n\t\t\t{\n${visuals}\t\t\t}\n\t\t}\n`;

const DONKEY = 'models/props_gameplay/donkey.vmdl';
const DONKEY_DIRE = 'models/props_gameplay/donkey_dire.vmdl';
const WINGS = 'models/props_gameplay/donkey_wings.vmdl';
const DRODO = 'models/courier/drodo/drodo.vmdl';
const DRODO_FLYING = 'models/courier/drodo/drodo_flying.vmdl';
const ROSH = 'models/courier/baby_rosh/babyroshan_alt.vmdl';

const TABLE = `"items_game"\n{\n\t"items"\n\t{\n${[
  item('595', 'Default Courier', '\t\t\t"baseitem"\t\t"1"\n',
    mod('courier', 'radiant', DONKEY) + mod('courier', 'dire', DONKEY_DIRE) + mod('courier_flying', 'radiant', WINGS)),
  item('10001', 'Drodo the Druffin', '',
    mod('courier', 'radiant', DRODO) + mod('courier', 'dire', DRODO)
    + mod('courier_flying', 'radiant', DRODO_FLYING)
    // a second style's model is not the first's
    + mod('courier', 'radiant', 'models/courier/drodo/drodo_golden.vmdl', '1')
    + '\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"particle_create"\n\t\t\t\t\t"modifier"\t\t"particles/econ/courier/courier_drodo/courier_drodo_ambient.vpcf"\n\t\t\t\t}\n'),
  // Collector's Baby Roshan 2018: the alt Baby Roshan's model, silver for every style
  item('13481', "Collector's Baby Roshan 2018", '', mod('courier', 'radiant', ROSH) + '\t\t\t\t"skin"\t\t"2"\n'),
  // a skin of its first style's outranks the one for every style
  item('13482', 'Styled', '', mod('courier', 'radiant', ROSH) + '\t\t\t\t"skin"\t\t"1"\n'
    + '\t\t\t\t"styles"\n\t\t\t\t{\n\t\t\t\t\t"0"\n\t\t\t\t\t{\n\t\t\t\t\t\t"skin"\t\t"3"\n\t\t\t\t\t}\n\t\t\t\t}\n'),
].join('')}\t}\n}\n`;

/** A model with a name list and nothing else numbering reads: the donkey's, as the courier's is. */
const model = (names: string[]) => resource([
  ['ASEQ', encodeKv3({ obj: [
    ['m_localSequenceNameArray', { arr: names.map((n) => ({ str: n })) }],
    ['m_localS1SeqDescArray', { objs: [] }],
  ] })],
  ['DATA', encodeKv3({ obj: [['m_name', { str: names.join(' ') }]] })],
]);
const SEQS = ['bindpose', 'donkey_idle', 'donkey_run'];

function game(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-courier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt(`${DONKEY}_c`, model(SEQS)),
    entryAt(`${DONKEY_DIRE}_c`, model(SEQS)),
    entryAt(`${WINGS}_c`, model(SEQS)),
    entryAt(`${DRODO}_c`, model([...SEQS, 'drodo'])),
    // a flying model that plays nothing the donkey's wings do: numbered it cannot be
    entryAt(`${DRODO_FLYING}_c`, model(['fly'])),
  ]));
  return dir;
}

const look: LibRecord = { id: 'look', name: 'Drodo', categoryId: 'cosmetic', slot: 'courier', itemId: '10001', enabled: true } as LibRecord;

test("a courier's models go where Default Courier has the same kind for the same team, its first style's only", () => {
  assert.deepEqual(courierCopies(TABLE, '595', '10001'), [
    { from: DRODO, to: DONKEY, unit: 'courier' },
    { from: DRODO, to: DONKEY_DIRE, unit: 'courier' },
    { from: DRODO_FLYING, to: WINGS, unit: 'courier' },
  ]);
  assert.deepEqual(courierCopies(TABLE, '595', '595'), [], 'the donkey under its own paths is nothing to copy');
});

test('a courier worn in another material set takes it along, its first style\'s over the one for all', () => {
  assert.deepEqual(courierCopies(TABLE, '595', '13481'), [{ from: ROSH, to: DONKEY, unit: 'courier', skin: 2 }]);
  assert.deepEqual(courierCopies(TABLE, '595', '13482'), [{ from: ROSH, to: DONKEY, unit: 'courier', skin: 3 }]);
});

test("a courier look carries its models under the donkey's paths, and one that cannot be numbered stays the donkey", (t) => {
  const logs: string[] = [];
  const build = createTableBuild({ library: { list: () => [look] }, log: (m) => logs.push(m) });
  const { list } = drain(build.buildSteps(TABLE, game(t)));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, '595');
  assert.ok(list[0].block.includes('courier_drodo_ambient.vpcf'), 'the particles come along in the block, as they did');
  assert.deepEqual(list[0].assets!.map(entryPath).sort(), [`${DONKEY}_c`, `${DONKEY_DIRE}_c`].sort());
  assert.ok(list[0].assets![0].data.includes(Buffer.from('drodo')), "the courier's own model, not the donkey's");
  assert.ok(logs.some((m) => /1 of its 3 models/.test(m)), logs.join('\n'));
});

test('without the game files to read, a courier look still puts its block on', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-courier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const build = createTableBuild({ library: { list: () => [look] }, log: () => {} });
  const { list } = drain(build.buildSteps(TABLE, dir));
  assert.equal(list.length, 1);
  assert.equal(list[0].assets, undefined);
});
