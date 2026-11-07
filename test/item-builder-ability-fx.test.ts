/* An item's ability effects without its model (src/item-builder-ability-fx.ts): Earthshaker in the
 * Intergalactic Orbliterator's arms with the Enchant Totem of Bracers of the Cavern Luminar, as
 * the game's hidden ability_effects slots wear it. The table is Earthshaker's in small: his stock
 * bracers, the Luminar with its slot-2 effects in two styles and an ambient of its own, Totem of
 * Deep Magma for slots 1 and 2 in the attribute's other form, an item that names a slot and gives
 * it nothing, Puck's for the same slot number, and the stock items every hero wears there. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as schema from '../src/schema.ts';
import { itemSlots } from '../src/item-builder-slots.ts';
import { itemSets } from '../src/item-builder-sets.ts';
import { fxSlotOf, fxSlotsOf, mergeFxPatches, namedFxSlots } from '../src/item-builder-ability-fx.ts';
import { abilityFxPatch } from '../src/item-builder-fx-patch.ts';
import { createTableBuild } from '../src/schema-build.ts';
import { createSchemaService, type SchemaInstaller } from '../src/schema-service.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryPath } from '../src/vpk.ts';
import { drain } from '../src/steps.ts';
import type { Settings } from '../src/settings.ts';
import type { LibRecord } from '../src/types.ts';
import { entry } from './helpers/vpk-entry.ts';

const TOTEM = 'particles/units/heroes/hero_earthshaker/earthshaker_totem_buff.vpcf';
const LUMINAR = 'particles/econ/items/earthshaker/earthshaker_totem_ti6/earthshaker_totem_ti6_buff.vpcf';
const FISSURE = 'particles/units/heroes/hero_earthshaker/earthshaker_fissure.vpcf';

const mod = (type: string, asset: string, modifier: string, slot: string, style = '') => `
				"asset_modifier"
				{
					"type"		"${type}"
					"asset"		"${asset}"
					"modifier"		"${modifier}"${slot ? `\n\t\t\t\t\t"apply_when_equipped_in_ability_effects_slot"\t\t"${slot}"` : ''}${style ? `\n\t\t\t\t\t"style"\t\t"${style}"` : ''}
				}`;

const item = (id: string, name: string, fields: string, hero = 'earthshaker', visuals = '') => `
		"${id}"
		{
			"name"		"${name}"${fields}
			"used_by_heroes"
			{
				"${hero}"		"1"
			}${visuals ? `\n\t\t\t"visuals"\n\t\t\t{${visuals}\n\t\t\t}` : ''}
		}`;

const field = (k: string, v: string) => `\n\t\t\t"${k}"\t\t"${v}"`;
const scalar = (...slots: number[]) => `\n\t\t\t"static_attributes"\n\t\t\t{${slots.map((n) => `\n\t\t\t\t"can_equip_as_ability_effects"\t\t"${n}"`).join('')}\n\t\t\t}`;
const blockForm = (n: number) => `\n\t\t\t"static_attributes"\n\t\t\t{\n\t\t\t\t"can_equip_as_ability_effects"\n\t\t\t\t{\n\t\t\t\t\t"attribute_class"\t\t"can_equip_as_ability_effects"\n\t\t\t\t\t"value"\t\t"${n}"\n\t\t\t\t}\n\t\t\t}`;
const stockFx = (id: string, n: number) => item(id, `All Heroes' Default Ability Effects ${n}`, field('prefab', 'default_item') + field('item_slot', `ability_effects_${n}`) + blockForm(n), 'all');

const LUMINAR_VISUALS = [
  mod('particle_create', '', 'particles/econ/items/earthshaker/luminar_ambient.vpcf', ''),
  mod('particle', TOTEM, LUMINAR, '2', '0'),
  mod('particle', TOTEM, 'particles/econ/items/earthshaker/earthshaker_totem_ti6/earthshaker_totem_ti6_buff_v2.vpcf', '2', '1'),
  mod('sound', 'Hero_EarthShaker.Totem', 'Hero_EarthShaker.Totem.Immortal', '2'),
  mod('ability_icon', 'earthshaker_enchant_totem', 'earthshaker/bracers_of_the_cavern_luminar/earthshaker_enchant_totem', '2'),
].join('') + `
				"styles"
				{
					"0"
					{
						"name"		"#Luminar_0"
					}
					"1"
					{
						"name"		"#Luminar_1"
					}
				}`;

const TABLE = `"items_game"
{
	"items"
	{${stockFx('790', 1)}${stockFx('791', 2)}${item('101', "Earthshaker's Bracers", field('prefab', 'default_item') + field('item_slot', 'arms') + field('model_player', 'models/heroes/earthshaker/bracers.vmdl'), 'npc_dota_hero_earthshaker')}${
  item('7293', 'Bracers of the Cavern Luminar', field('prefab', 'wearable') + field('item_slot', 'arms') + field('model_player', 'models/items/earthshaker/ti6_immortal_bracer.vmdl') + scalar(2), 'npc_dota_hero_earthshaker', LUMINAR_VISUALS)}${
  item('6402', 'Totem of Deep Magma', field('prefab', 'wearable') + field('item_slot', 'weapon') + blockForm(1).replace(/\n\t\t\t\}$/, '') + `\n\t\t\t\t"can_equip_as_ability_effects"\t\t"2"\n\t\t\t}`, 'npc_dota_hero_earthshaker',
    mod('particle', FISSURE, 'particles/econ/items/earthshaker/deep_magma/fissure.vpcf', '1', 'default') + mod('particle', TOTEM, 'particles/econ/items/earthshaker/deep_magma/totem.vpcf', '2', 'default'))}${
  item('9001', 'Promises Nothing', field('prefab', 'wearable') + field('item_slot', 'head') + scalar(1), 'npc_dota_hero_earthshaker', mod('particle_create', '', 'particles/nothing.vpcf', ''))}${
  item('9100', 'Orbliterator Arms', field('prefab', 'wearable') + field('item_slot', 'arms') + field('model_player', 'models/items/earthshaker/es_cosmic_arms.vmdl'), 'npc_dota_hero_earthshaker')}${
  item('9200', "Puck's Dream", field('prefab', 'wearable') + field('item_slot', 'back') + scalar(2), 'npc_dota_hero_puck',
    mod('particle', 'particles/units/heroes/hero_puck/puck_phase_shift.vpcf', 'particles/econ/items/puck/dream/phase_shift.vpcf', '2'))}${
  item('9300', 'Orbliterator', field('prefab', 'bundle') + '\n\t\t\t"bundle"\n\t\t\t{\n\t\t\t\t"Bracers of the Cavern Luminar"\t\t"1"\n\t\t\t\t"Totem of Deep Magma"\t\t"1"\n\t\t\t}', 'npc_dota_hero_earthshaker')}
	}
}
`;

const pick = (hero: string, slot: string, itemId: string, effectId = ''): LibRecord => ({
  id: `${hero}-${slot}`, name: `pick ${itemId}`, categoryId: 'cosmetic', slot: `item:${hero}:${slot}`, itemId, enabled: true, ...(effectId ? { effectId } : {}),
} as LibRecord);

test('an ability effects slot is told by its name or by a builder slot, and an item says which it fits in either form', () => {
  assert.equal(fxSlotOf('ability_effects_2'), 2);
  assert.equal(fxSlotOf('item:earthshaker:ability_effects_4'), 4);
  assert.equal(fxSlotOf('item:earthshaker:arms'), 0);
  assert.equal(fxSlotOf('ability_effects_1_persona_1'), 0, 'a persona slot is not offered');
  const block = schema.findItem(TABLE, '6402')!.text;
  assert.deepEqual(fxSlotsOf(block), [1, 2]);
  assert.deepEqual(fxSlotsOf(schema.findItem(TABLE, '7293')!.text), [2]);
});

test("the builder offers each slot an item of the hero's fits, under the stock item all heroes wear there", () => {
  const slots = itemSlots(TABLE);
  const fx2 = slots.find((s) => s.slot === 'item:earthshaker:ability_effects_2');
  assert.ok(fx2);
  assert.deepEqual([fx2.targetId, fx2.abilityFx, fx2.heroIds], ['791', 2, ['earthshaker']]);
  assert.deepEqual(fx2.options.map((o) => o.name), ['Bracers of the Cavern Luminar', 'Totem of Deep Magma']);
  assert.equal(fx2.options.some((o) => o.fx), false, 'no donors: the slot has no model to wear them on');
  assert.deepEqual(fx2.options.find((o) => o.id === '7293')?.styles?.length, 2);
  assert.deepEqual(slots.find((s) => s.slot === 'item:earthshaker:ability_effects_1')?.options.map((o) => o.id), ['6402'], 'an item that gives the slot nothing is not offered');
  assert.ok(slots.find((s) => s.slot === 'item:earthshaker:arms')?.options.some((o) => o.id === '7293'), 'still offered in its own slot');
  assert.equal(slots.find((s) => s.slot === 'item:puck:ability_effects_2')?.targetId, '791', 'one stock item for every hero');
  const order = slots.filter((s) => s.heroIds[0] === 'earthshaker').map((s) => s.equipSlot);
  assert.deepEqual(order, ['arms', 'ability_effects_1', 'ability_effects_2'], 'after the slots with a model');
});

test("a set's pieces stay in their own slots, not the effects slots that also offer them", () => {
  const set = itemSets(TABLE).find((s) => s.name === 'Orbliterator');
  assert.deepEqual(set?.pieces.filter((p) => p.fits).map((p) => p.slot), ['item:earthshaker:arms']);
});

test('a pick writes the stock item of the slot with what the slot takes of the item: no model, no ambient, its style', () => {
  const p = abilityFxPatch(TABLE, '7293', '', 2);
  assert.equal(p.id, '791');
  assert.equal(p.own, null);
  assert.match(p.block, /^\s*"791"/);
  assert.match(p.block, /"item_slot"\s+"ability_effects_2"/);
  assert.doesNotMatch(p.block, /model_player|luminar_ambient|_v2\.vpcf|"style"|"styles"/);
  assert.ok(p.block.includes(LUMINAR));
  assert.deepEqual(p.assetCopies.find((c) => 'to' in c && c.to === TOTEM), { from: LUMINAR, to: TOTEM });
  assert.deepEqual(p.sounds, [{ sound: 'Hero_EarthShaker.Totem', as: 'Hero_EarthShaker.Totem.Immortal' }]);
  assert.ok(p.assetCopies.some((c) => 'to' in c && c.to.endsWith('spellicons/earthshaker_enchant_totem_png.vtex_c')), 'the icon of the ability comes along');

  const second = abilityFxPatch(TABLE, '7293', 'style-1', 2);
  assert.ok(second.block.includes('earthshaker_totem_ti6_buff_v2.vpcf'), 'the second style');
  assert.ok(!second.block.includes(LUMINAR));
  // Valve's "default" is the first style, and the modifiers of another slot stay out
  const magma = abilityFxPatch(TABLE, '6402', '', 2);
  assert.ok(magma.block.includes('deep_magma/totem.vpcf') && !magma.block.includes('deep_magma/fissure.vpcf'));
  assert.throws(() => abilityFxPatch(TABLE, '9001', '', 1), /no effects for this ability/);
  assert.throws(() => abilityFxPatch(TABLE, '404', '', 2), /404/);
});

test("the picks of two heroes in one slot share the stock item's block, with both their effects", () => {
  const es = abilityFxPatch(TABLE, '7293', '', 2);
  const puck = abilityFxPatch(TABLE, '9200', '', 2);
  const other = { id: '101', block: '"101"{}', source: 'arms' };
  const fx = new Set<object>();
  const list = [{ id: es.id, block: es.block, source: 'es' }, other, { id: puck.id, block: puck.block, source: 'puck' }];
  list.forEach((p) => { if (p !== other) fx.add(p); });
  const merged = mergeFxPatches(list, (p) => fx.has(p));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, '791');
  assert.ok(merged[0].block.includes(LUMINAR) && merged[0].block.includes('puck/dream/phase_shift.vpcf'));
  assert.equal(merged[0].source, 'es, puck');
  assert.equal(merged[1], other);
  assert.equal((schema.mergeSchema(TABLE, merged).conflicts || []).length, 0);
});

test('the slots are named by their ability, and a slot the hero has not got goes', () => {
  const script = '"DOTAHeroes"{"npc_dota_hero_earthshaker"{"ItemSlots"{"6"{"SlotIndex" "6"\n"SlotName" "ability_effects_1"\n"SlotText" "earthshaker_fissure"}"7"{"SlotIndex" "7"\n"SlotName"\t"ability_effects_2"\n\t"SlotText"\t"earthshaker_enchant_totem"}}}}';
  const words = '"lang"{"Language" "english" "Tokens"{"DOTA_Tooltip_ability_earthshaker_enchant_totem" "Enchant Totem"}}';
  const files: Record<string, string> = {
    'scripts/npc/heroes/npc_dota_hero_earthshaker.txt': script,
    'resource/localization/abilities_english.txt': words,
  };
  const read = (f: string) => (f in files ? Buffer.from(files[f]) : null);
  const named = namedFxSlots(itemSlots(TABLE), read, 'en');
  const label = (slot: string) => named.find((s) => s.slot === slot)?.slotLabel;
  assert.equal(label('item:earthshaker:ability_effects_2'), 'Effects: Enchant Totem');
  assert.equal(label('item:earthshaker:ability_effects_1'), 'Ability effects 1', 'no word for it: its number');
  assert.equal(label('item:earthshaker:arms'), 'Arms');
  assert.equal(label('item:puck:ability_effects_2'), 'Ability effects 2', 'no script read: kept as it is');
  const without = namedFxSlots(itemSlots(TABLE), (f) => (f.includes('earthshaker') ? Buffer.from('"x"{}') : null), 'en');
  assert.equal(without.some((s) => s.slot.startsWith('item:earthshaker:ability_effects')), false);
});

/** A game folder whose pak has the particles as files saying which they are. */
function game(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-abilityfx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  const files = [LUMINAR, 'particles/econ/items/earthshaker/deep_magma/totem.vpcf', 'models/items/earthshaker/es_cosmic_arms.vmdl', 'models/items/earthshaker/ti6_immortal_bracer.vmdl'];
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([...files.map((f) => entry(`${f}_c`, path.basename(f))), entry(schema.SCHEMA_REL, TABLE)]));
  return dir;
}

/** What a build of these picks puts at a path, as schema.deploy keeps it (the first file), and its list. */
function built(dir: string, recs: LibRecord[]) {
  const { list } = drain(createTableBuild({ library: { list: () => recs }, log: () => {} }).buildSteps(TABLE, dir));
  const at = (p: string) => list.flatMap((x) => x.assets || []).find((e) => entryPath(e) === `${p}_c`)?.data.toString();
  return { list, at };
}

test("the Orbliterator's arms keep their model and wear the Luminar's totem, and not the Luminar", (t) => {
  const { list, at } = built(game(t), [pick('earthshaker', 'arms', '9100'), pick('earthshaker', 'ability_effects_2', '7293')]);
  assert.equal(list[0].id, '791', 'the slot first');
  assert.equal(at(TOTEM), path.basename(LUMINAR));
  assert.equal(at('models/heroes/earthshaker/bracers.vmdl'), 'es_cosmic_arms.vmdl', 'the arms are the picked ones');
  assert.equal(list.some((p) => p.assets?.some((e) => entryPath(e).includes('ti6_immortal_bracer'))), false, "the Luminar's model stays out");
});

test("the slot's effect wins over the one of the item worn, whichever was picked first, as in the game", (t) => {
  const dir = game(t);
  const magma = path.basename('particles/econ/items/earthshaker/deep_magma/totem.vpcf');
  assert.equal(built(dir, [pick('earthshaker', 'arms', '7293'), pick('earthshaker', 'ability_effects_2', '6402')]).at(TOTEM), magma);
  assert.equal(built(dir, [pick('earthshaker', 'ability_effects_2', '6402'), pick('earthshaker', 'arms', '7293')]).at(TOTEM), magma);
  assert.equal(built(dir, [pick('earthshaker', 'arms', '7293')]).at(TOTEM), path.basename(LUMINAR), 'the Luminar alone wears its own');
});

const NO_INSTALLER: SchemaInstaller = {
  analyzeRecord: () => { throw new Error('not asked'); },
  harvestSchema: () => { throw new Error('not asked'); },
  splitVpkFile: () => { throw new Error('not asked'); },
  remove: () => { throw new Error('not asked'); },
  installedSize: () => { throw new Error('not asked'); },
};

test('a set put on leaves the ability effects slots as they are, as the game does', (t) => {
  const dir = game(t);
  const values: Record<string, unknown> = { dotaGamePath: dir, schemaPatch: false };
  const settings = { get: (k: string) => values[k], set: (k: string, v: unknown) => { values[k] = v; } } as unknown as Pick<Settings, 'get' | 'set'>;
  const library = new Library(path.join(dir, 'lib'));
  const service = createSchemaService({ settings, library, installer: NO_INSTALLER, userDataDir: dir });
  service.pickCosmetic('item:earthshaker:ability_effects_2', '6402', 'Totem of Deep Magma');
  service.pickCosmetic('item:earthshaker:arms', '9100', 'Orbliterator Arms');
  service.pickSet('9300');
  const on = library.list().filter((r) => r.enabled !== false).map((r) => [r.slot, r.itemId]).sort();
  assert.deepEqual(on, [['item:earthshaker:ability_effects_2', '6402'], ['item:earthshaker:arms', '7293']]);
});
