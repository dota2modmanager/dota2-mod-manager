// The item builder (src/item-builder.ts): a hero's stock item built from one of its wearables,
// with an effect on top. Written with the feature by h6rd (#117); moved here from
// schema.test.js when the builder got a module of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as schema from '../src/schema.ts';
import * as builder from '../src/item-builder.ts';
import * as vpk from '../src/vpk.ts';
import { Library } from '../src/library.ts';
import { createSchemaService, type SchemaInstaller } from '../src/schema-service.ts';
import type { Settings } from '../src/settings.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { at, model } from './helpers/kv3-build.ts';

/** A model's animation clips, with what each plays (as test/arcana.test.ts reads them). */
const clips = (file: Buffer) => (at(readKv3(resourceBlock(file, 'ANIM').data).root, 'm_animArray') as Extract<Kv3Node, { kind: 'array' }>).items
  .map((x) => [(at(x, 'm_name') as { value: string }).value, (at(x, 'm_activityArray') as Extract<Kv3Node, { kind: 'array' }>).items.map((a) => (at(a, 'm_name') as { value: string }).value)]);

/** Settings kept in `values`; `onSet` sees every write. */
function settingsIn(values: Record<string, unknown>, onSet: (key: string) => void = () => {}) {
  return {
    get: (k: string) => values[k],
    set: (k: string, v: unknown) => { onSet(k); values[k] = v; },
  } as unknown as Pick<Settings, 'get' | 'set'>;
}

/** For the tests that never reach the installer: a call here fails the test. */
const NO_INSTALLER: SchemaInstaller = {
  analyzeRecord: () => { throw new Error('the installer was not meant to be asked'); },
  harvestSchema: () => { throw new Error('the installer was not meant to be asked'); },
  splitVpkFile: () => { throw new Error('the installer was not meant to be asked'); },
  remove: () => { throw new Error('the installer was not meant to be asked'); },
  installedSize: () => { throw new Error('the installer was not meant to be asked'); },
};

const item = (id: string | number, name: string, extra = '') => `		"${id}"
		{
			"name"		"${name}"
			"prefab"		"default_item"
${extra}		}
`;

/** A small but structurally real items_game.txt. */
const small = (ids = [['1', 'One'], ['2', 'Two'], ['3', 'Three']]) => `"items_game"
{
	"items"
	{
${ids.map(([id, name]) => item(id, name)).join('')}	}
}
`;

/** Big enough to clear validateSchema's "did we just lose the whole table" floor. */
function large(count = 1200, mark = 'Item') {
  const ids = Array.from({ length: count }, (_, i) => [String(i + 1), `${mark} ${i + 1}`]);
  return small(ids);
}

const table = (blocks: string[]) => `"items_game"
{
	"items"
	{
${blocks.join('')}	}
}
`;

/** One inline-data entry in the shape buildVpk() wants. */
function entry(relPath: string, body: string | Buffer) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const lower = relPath.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const file = slash === -1 ? lower : lower.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    ext: dot === -1 ? ' ' : file.slice(dot + 1),
    folder: slash === -1 ? ' ' : lower.slice(0, slash),
    name: dot === -1 ? file : file.slice(0, dot),
    data,
    preload: Buffer.alloc(0),
    crc: vpk.crc32(data),
  };
}

function itemWearableTable() {
  return table([
    `\t\t"10"
\t\t{
\t\t\t"name"\t\t"Default Weather"
\t\t\t"prefab"\t\t"weather"
\t\t\t"baseitem"\t\t"1"
\t\t}`,
    `\t\t"282"
\t\t{
\t\t\t"name"\t\t"Sniper's Cape"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"back"
\t\t\t"model_player"\t\t"models/heroes/sniper/cape.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_stock_should_be_replaced.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster_stock_should_be_replaced.vpcf"
\t\t\t\t}
\t\t\t}
\t\t}`,
    `\t\t"400"
\t\t{
\t\t\t"name"\t\t"Sniper default with visuals"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"head"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"500"
\t\t{
\t\t\t"name"\t\t"Bloodseeker weapon default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"image_inventory"\t\t"econ/heroes/blood_seeker/weapon"
\t\t\t"model_player"\t\t"models/heroes/blood_seeker/weapon.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"501"
\t\t{
\t\t\t"name"\t\t"Bloodseeker offhand default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"offhand_weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9455"
\t\t{
\t\t\t"name"\t\t"Golden Full-Bore Bonanza"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"model_player"\t\t"models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl"
\t\t\t"item_name"\t\t"#DOTA_Item_Golden_FullBore_Bonanza"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle_create"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_ambient.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"ability_icon"
\t\t\t\t\t"asset"\t\t"sniper_headshot"
\t\t\t\t\t"modifier"\t\t"sniper_headshot_immortal_gold"
\t\t\t\t\t"apply_when_equipped_in_ability_effects_slot"\t\t"2"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf"
\t\t\t\t}
\t\t\t\t"styles"
\t\t\t\t{
\t\t\t\t\t"0"
\t\t\t\t\t{
\t\t\t\t\t\t"unlock"
\t\t\t\t\t\t{
\t\t\t\t\t\t\t"item_def"\t\t"123"
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}`,
    `\t\t"9456"
\t\t{
\t\t\t"name"\t\t"Unsupported back"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9500"
\t\t{
\t\t\t"name"\t\t"Bundle that must stay hidden"
\t\t\t"prefab"\t\t"bundle"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9700"
\t\t{
\t\t\t"name"\t\t"Io Ball"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"ambient"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_wisp"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9701"
\t\t{
\t\t\t"name"\t\t"Io Ambient"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"ambient"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_wisp"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9457"
\t\t{
\t\t\t"name"\t\t"No visuals here"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"head"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t}`,
    `\t\t"9600"
\t\t{
\t\t\t"name"\t\t"Bloodseeker main blade"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9601"
\t\t{
\t\t\t"name"\t\t"Bloodseeker offhand blade"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"offhand_weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9800"
\t\t{
\t\t\t"name"\t\t"Tidehunter's Anchor"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"image_inventory"\t\t"econ/heroes/tidehunter/tidehunter_anchor"
\t\t\t"model_player"\t\t"models/heroes/tidehunter/tidehunter_anchor.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_tidehunter"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9801"
\t\t{
\t\t\t"name"\t\t"Tidehunter bonus anchor"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_tidehunter"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9900"
\t\t{
\t\t\t"name"\t\t"Sniper Persona Default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"weapon_persona_1"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9901"
\t\t{
\t\t\t"name"\t\t"Sniper Persona Gun"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon_persona_1"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9902"
\t\t{
\t\t\t"name"\t\t"Axe Arcana Back"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9903"
\t\t{
\t\t\t"name"\t\t"Axe Arcana Cape"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
  ]);
}

test('item cosmetics build one slot per hero part, infer missing stock slots, offer arcanas and hide personas', () => {
  const text = itemWearableTable();
  const slots = builder.itemSlots(text);
  assert.deepEqual(slots.map((s) => [s.slot, s.equipSlot, s.slotLabel, s.options.map((o) => o.id)]), [
    // a stock item with "Arcana" in its name used to take its slot out of the builder
    ['item:axe:back', 'back', 'Back', ['9903', '9456']],
    ['item:bloodseeker:weapon', 'weapon', 'Weapon', ['9600']],
    ['item:bloodseeker:offhand_weapon', 'offhand_weapon', 'Offhand weapon', ['9601']],
    // Io was left out of the builder from its first day, with no reason written down; it is offered
    // now, its items marked as not checked in the game (src/arcana-notes.ts)
    ['item:wisp:ambient', 'ambient', 'Effects', ['9701']],
    ['item:sniper:head', 'head', 'Head', ['9457']],
    ['item:sniper:back', 'back', 'Back', ['9455']],
    ['item:tidehunter:weapon', 'weapon', 'Weapon', ['9801']],
  ]);
  const blade = slots.find((s) => s.slot === 'item:bloodseeker:weapon');
  assert.equal(blade?.label.includes('Bloodseeker'), true);
  assert.equal(blade?.label.includes('Weapon'), true);
  assert.equal(slots.find((s) => s.slot === 'item:wisp:ambient')?.options[0].note, undefined, 'Io was played since and works');
  assert.equal(blade?.options[0].note, undefined, 'an item nobody has reported on, and no arcana, carries no note');
  assert.equal(slots.some((s) => /persona/i.test(`${s.slot} ${s.label}`)), false);
  assert.deepEqual(builder.itemOptions(text), [
    { id: '9903', name: 'Axe Arcana Cape' },
    { id: '9456', name: 'Unsupported back' },
    { id: '9600', name: 'Bloodseeker main blade' },
    { id: '9601', name: 'Bloodseeker offhand blade' },
    { id: '9701', name: 'Io Ambient' },
    { id: '9457', name: 'No visuals here' },
    { id: '9455', name: 'Golden Full-Bore Bonanza' },
    { id: '9801', name: 'Tidehunter bonus anchor' },
  ]);
  assert.deepEqual(builder.itemEffects(), [
    { id: '', name: 'No effect' },
    { id: 'fire', name: 'Fire' },
    { id: 'lightnings', name: 'Lightnings' },
    { id: 'frostbloom', name: 'Frostbloom' },
    { id: 'snow', name: 'Snow' },
    { id: 'bubbles', name: 'Bubbles' },
    { id: 'sand-storm', name: 'Sand Storm' },
    { id: 'ghost', name: 'Ghost' },
  ]);
});

test('a wearable resolves to the matching default item by hero and slot', () => {
  const text = itemWearableTable();
  const hit = builder.defaultItemForWearable(text, '9455');
  assert.ok(hit, 'default item should be found');
  assert.equal(hit.id, '282');
  assert.equal(hit.name, "Sniper's Cape");

  const offhand = builder.defaultItemForWearable(text, '9601');
  assert.ok(offhand, 'offhand alias should resolve too');
  assert.equal(offhand.id, '501');
  assert.equal(offhand.name, 'Bloodseeker offhand default');

  const inferred = builder.defaultItemForWearable(text, '9801');
  assert.ok(inferred, 'weapon-like default without item_slot should still resolve');
  assert.equal(inferred.id, '9800');
  assert.equal(inferred.name, "Tidehunter's Anchor");

  assert.equal(builder.defaultItemForWearable(text, '9901'), null, 'persona items stay hidden');
  assert.equal(builder.defaultItemForWearable(text, '9903')?.id, '9902', 'an arcana dresses its stock item like any wearable');
});

test('item effects keep the donor body, rewrite only the stock header and collect asset copies', () => {
  const text = itemWearableTable();
  const plain = builder.itemEffectPatch(text, '9455', '');
  assert.doesNotMatch(plain.block, /seasonal_ambient_silver\.vpcf/);

  const modelOnly = builder.itemEffectPatch(text, '9457', '');
  assert.equal(modelOnly.id, '400');
  assert.match(modelOnly.block, /^"400"/);
  assert.match(modelOnly.block, /"prefab"\s+"default_item"/);
  assert.match(modelOnly.block, /"visuals"\s*\{\s*\}/);


  const patched = builder.itemEffectPatch(text, '9455', 'frostbloom');

  assert.equal(patched.id, '282');
  assert.match(patched.block, /^"282"/);
  assert.match(patched.block, /"name"\s+"Sniper's Cape"/);
  assert.match(patched.block, /"prefab"\s+"default_item"/);
  assert.match(patched.block, /"item_name"\s+"#DOTA_Item_Golden_FullBore_Bonanza"/);
  // the stock path, which the VPK fills with the cape: a reconnect wears only what the server's table
  // loads, and the paid path became an ERROR model (src/item-builder.ts withoutFileSwaps)
  assert.match(patched.block, /"model_player"\s+"models\/heroes\/sniper\/cape\.vmdl"/);
  assert.doesNotMatch(patched.block, /sniper_cape_immortal\.vmdl/);
  assert.match(patched.block, /"modifier"\s+"particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_headshot_slow\.vpcf"/);
  assert.match(patched.block, /"modifier"\s+"particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_headshot_slow_caster\.vpcf"/);
  assert.match(patched.block, /particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_ambient\.vpcf/);
  assert.match(patched.block, /"type"\s+"ability_icon"/);
  assert.match(patched.block, /"modifier"\s+"sniper_headshot_immortal_gold"/);
  assert.match(patched.block, /particles\/econ\/seasonal\/seasonal_ambient_silver\.vpcf/);
  assert.ok(patched.block.indexOf('sniper_immortal_cape_golden_ambient.vpcf') < patched.block.indexOf('seasonal_ambient_silver.vpcf'));
  assert.ok(patched.block.indexOf('seasonal_ambient_silver.vpcf') < patched.block.indexOf('sniper_headshot_slow_caster.vpcf'));
  assert.doesNotMatch(patched.block, /"unlock"/);
  assert.doesNotMatch(patched.block, /"styles"/);
  assert.deepEqual(patched.assetCopies, [
    {
      from: 'models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl',
      to: 'models/heroes/sniper/cape.vmdl',
    },
    {
      from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf',
      to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf',
    },
    {
      from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf',
      to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf',
    },
    // the immortal's Headshot icon over the plain one, as an arcana's ability icons go
    {
      from: 'panorama/images/spellicons/sniper_headshot_immortal_gold_png.vtex_c',
      to: 'panorama/images/spellicons/sniper_headshot_png.vtex_c',
      optional: true,
    },
  ]);

  const out = schema.mergeSchema(text, [{ id: patched.id, block: patched.block, source: 'items' }]);
  assert.equal(out.applied.length, 1);
  const merged = schema.findItem(out.text, '282');
  assert.ok(merged);
  assert.match(merged.text, /seasonal_ambient_silver\.vpcf/);
  assert.match(merged.text, /"model_player"\s+"models\/heroes\/sniper\/cape\.vmdl"/);
});

test('game asset entries read donor bytes from pak01 and buildSchemaVpk packs them under stock paths', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([
    entry('models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl_c', 'donor model bytes'),
    entry('particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf_c', 'slow bytes'),
    entry('particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf_c', 'caster bytes'),
  ]));

  const extras = builder.gameAssetEntries(dir, [
    { from: 'models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl', to: 'models/heroes/sniper/cape.vmdl' },
    { from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf', to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf' },
    { from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf', to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf' },
    // a picture the game has not got in that folder: left out, the pick still builds
    { from: 'panorama/images/spellicons/sniper_headshot_immortal_gold_png.vtex_c', to: 'panorama/images/spellicons/sniper_headshot_png.vtex_c', optional: true },
  ]);
  assert.deepEqual(extras.map((en) => vpk.entryPath(en)), [
    'models/heroes/sniper/cape.vmdl_c',
    'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c',
    'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c',
  ]);

  const buf = schema.buildSchemaVpk(large(1200), extras);
  const paths = vpk.listVpkPaths(buf).sort();
  assert.ok(paths.includes('scripts/items/items_game.txt'));
  assert.ok(paths.includes('models/heroes/sniper/cape.vmdl_c'));
  assert.ok(paths.includes('particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c'));
  assert.ok(paths.includes('particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c'));

  const packed = new Map(vpk.readVpkEntries(buf, 'mem').map((en) => [vpk.entryPath(en), en.data.toString('latin1')]));
  assert.equal(packed.get('models/heroes/sniper/cape.vmdl_c'), 'donor model bytes');
  assert.equal(packed.get('particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c'), 'slow bytes');
  assert.equal(packed.get('particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c'), 'caster bytes');
});

test('a pick carries several effects in one order, and an effect nobody offers refuses it', () => {
  // The window offers several ("Effects (you can pick several)") and sent them as "fire,snow" to
  // a build that looked for one effect by that name. The pick failed there, and the failure was
  // swallowed with the other free cosmetics' ones: the window said installed, the game got nothing.
  const text = itemWearableTable();
  assert.equal(builder.effectKey('snow,fire'), 'fire,snow', 'the order the list offers them in');
  assert.equal(builder.effectKey(['FIRE', ' fire ', 'snow']), 'fire,snow', 'each once, whatever the case');
  assert.equal(builder.effectKey(''), '');
  assert.equal(builder.effectKey(null), '');

  const both = builder.itemEffectPatch(text, '9455', 'snow,fire');
  const count = (needle: string) => both.block.split(needle).length - 1;
  assert.equal(count('courier_trail_lava.vpcf'), 1, 'fire, once');
  assert.equal(count('seasonal_ambient_snow.vpcf'), 1, 'snow, once');
  assert.throws(() => builder.itemEffectPatch(text, '9455', 'fire,sparkles'), /sparkles/);
});

test('choosing other effects for the same item changes its row instead of adding one', (t) => {
  // My mods showed three rows reading "Blightfall - Head" for one item picked with fire, then
  // snow, then nothing, and nothing on them said which was which.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-picks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const settings = settingsIn({ dotaGamePath: null }); // no game: the pick is recorded, nothing is written
  const service = createSchemaService({ settings, library, installer: NO_INSTALLER, userDataDir: dir });
  const slot = 'item:abaddon:head';
  const picks = () => library.list().filter((r) => r.categoryId === 'cosmetic');

  const first = service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'fire');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'snow,fire');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', '');
  assert.equal(picks().length, 1, 'one row for one item');
  assert.equal(picks()[0].id, first?.id);
  assert.equal(picks()[0].effectId, undefined, 'its effects are the last ones chosen');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'snow,fire');
  assert.equal(picks()[0].effectId, 'fire,snow');

  // another item for the same slot is another pick, and the first one waits switched off
  service.pickCosmetic(slot, '7365', 'Compendium Rider of Avarice Helmet', 'ghost');
  assert.deepEqual(picks().map((r) => [r.itemId, r.enabled !== false, r.effectId || '']).sort(),
    [['19416', false, 'fire,snow'], ['7365', true, 'ghost']]);
  // back to the first: its row again, with the effects asked for now
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'bubbles');
  assert.equal(picks().length, 2);
  assert.deepEqual(picks().find((r) => r.itemId === '19416'), { ...picks().find((r) => r.itemId === '19416'), enabled: true, effectId: 'bubbles' });
});

/** The builder's table with sets on top: what a set holds, as items_game lists it. */
function itemSetTable() {
  const block = (id: string, name: string, prefab: string, hero: string, extra = '') => `\t\t"${id}"
\t\t{
\t\t\t"name"\t\t"${name}"
\t\t\t"prefab"\t\t"${prefab}"
${extra}\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_${hero}"\t\t"1"
\t\t\t}
\t\t}
`;
  const bundle = (id: string, name: string, hero: string, pieces: string[]) => block(id, name, 'bundle', hero,
    `\t\t\t"bundle"\n\t\t\t{\n${pieces.map((p) => `\t\t\t\t"${p}"\t\t"1"\n`).join('')}\t\t\t}\n`);
  return itemWearableTable().replace(/\t}\n}\n$/, [
    block('9951', 'Sniper Spare Cape', 'wearable', 'sniper', '\t\t\t"item_slot"\t\t"back"\n'),
    block('9952', 'Sniper Loading Screen', 'loading_screen', 'sniper'),
    block('9954', 'Sniper Third Cape', 'wearable', 'sniper', '\t\t\t"item_slot"\t\t"back"\n'),
    // no item_slot, and a name that reads like a helmet: the game puts it in the hand
    block('9953', 'Bloodseeker Headmaster Wand', 'wearable', 'bloodseeker'),
    // Axe has no stock belt, so the builder has nowhere to put it
    block('9955', 'Axe Belt', 'wearable', 'axe', '\t\t\t"item_slot"\t\t"belt"\n'),
    bundle('9960', 'Sniper Set', 'sniper',
      ['Golden Full-Bore Bonanza', 'No visuals here', 'Sniper Persona Gun', 'Sniper Loading Screen', 'Sniper Spare Cape']),
    bundle('9961', 'Bloodseeker Set', 'bloodseeker', ['Bloodseeker Headmaster Wand']),
    bundle('9962', 'Axe Set', 'axe', ['Axe Belt']),
    // a store bundle of several sets: more pieces want a taken slot than fit
    bundle('9963', 'Sniper Big Bundle', 'sniper', ['Golden Full-Bore Bonanza', 'Sniper Spare Cape', 'Sniper Third Cape']),
    bundle('9964', 'Sniper Set DO NOT USE', 'sniper', ['Golden Full-Bore Bonanza']),
  ].join('') + '\t}\n}\n');
}

test('a wearable that names no slot is a weapon, as the game reads it', () => {
  // Guessed from its words, Oblivion Headmaster Wand went on the head and Emerald Frenzy
  // Flail on the back, and 99 weapons went nowhere. The game's "wearable" prefab says weapon.
  const text = itemSetTable();
  const wand = schema.listItems(text).find((i) => i.name === 'Bloodseeker Headmaster Wand');
  assert.equal(schema.inferredItemSlot(wand), 'weapon');
  const slot = builder.itemSlots(text).find((s) => s.options.some((o) => o.id === '9953'));
  assert.equal(slot?.slot, 'item:bloodseeker:weapon');
});

test('a set lists the hero items the builder puts on, and says why it leaves one out', () => {
  const sets = builder.itemSets(itemSetTable());
  assert.deepEqual(sets.map((s) => s.name), ['Bloodseeker Set', 'Sniper Set'],
    'left out: a set with nothing to put on, a bundle of several sets, one Valve marks DO NOT USE');
  const sniper = sets.find((s) => s.name === 'Sniper Set');
  assert.ok(sniper, 'the Sniper set is not listed');
  assert.equal(sniper.heroLabel, 'Sniper');
  assert.equal(sniper.fit, 2);
  // the loading screen is not a hero item: not listed, not counted
  assert.deepEqual(sniper.pieces.map((p) => [p.name, p.fits, p.fits ? p.slot : p.reason]), [
    ['Golden Full-Bore Bonanza', true, 'item:sniper:back'],
    ['No visuals here', true, 'item:sniper:head'],
    ['Sniper Persona Gun', false, 'a persona: the builder leaves those alone'],
    ['Sniper Spare Cape', false, 'a second item for the same slot'],
  ]);
  assert.equal(builder.itemSlots(itemSetTable()).some((s) => s.equipSlot === 'bundle'), false, 'a set is not a slot');
});

test('a whole set goes on in one write, a row per piece, and a piece already on keeps its effects', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-sets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([entry(schema.SCHEMA_REL, itemSetTable())]));
  const library = new Library(path.join(dir, 'lib'));
  // schemaPatch off: every write the service makes takes the table away and clears the stamp
  let writes = 0;
  const settings = settingsIn({ dotaGamePath: game, schemaPatch: false }, (k) => { if (k === 'schemaStamp') writes++; });
  const service = createSchemaService({ settings, library, installer: NO_INSTALLER, userDataDir: dir });
  const picks = () => library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false);

  service.pickCosmetic('item:sniper:head', '9457', 'No visuals here', 'fire,snow');
  service.pickCosmetic('item:sniper:back', '9951', 'Sniper Spare Cape', 'ghost');
  writes = 0;
  const res = service.pickSet('9960');
  assert.deepEqual(res, { applied: 2, pieces: 4 });
  assert.equal(writes, 1, 'one write for the whole set');
  assert.deepEqual(picks().map((r) => [r.slot, r.itemId, r.effectId || '']).sort(), [
    ['item:sniper:back', '9455', ''], // the set's cape in place of the spare one, and no effects with it
    ['item:sniper:head', '9457', 'fire,snow'], // already on: keeps what it had
  ]);
  assert.throws(() => service.pickSet('404'), /Set not found/);
});

/** A hero's stock base and its arcana, as items_game has Juggernaut's: a whole other hero model,
 *  an activity modifier, two styles, and a swap for another unit's model that is not the hero's. */
function arcanaTable() {
  const jugg = `\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_juggernaut"\t\t"1"\n\t\t\t}\n`;
  const mod = (type: string, asset: string, modifier: string, style = '', key = 'asset_modifier') => `\t\t\t\t"${key}"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"${type}"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n${style ? `\t\t\t\t\t"style"\t\t"${style}"\n` : ''}\t\t\t\t}\n`;
  return table([
    `\t\t"811"\n\t\t{\n\t\t\t"name"\t\t"Juggernaut's Base"\n\t\t\t"prefab"\t\t"default_item"\n\t\t\t"item_slot"\t\t"hero_base"\n${jugg}\t\t}\n`,
    `\t\t"812"\n\t\t{\n\t\t\t"name"\t\t"Juggernaut's Mask"\n\t\t\t"prefab"\t\t"default_item"\n\t\t\t"item_slot"\t\t"head"\n\t\t\t"model_player"\t\t"models/heroes/juggernaut/jugg_mask.vmdl"\n${jugg}\t\t}\n`,
    `\t\t"9059"\n\t\t{\n\t\t\t"name"\t\t"Bladeform Legacy"\n\t\t\t"prefab"\t\t"wearable"\n\t\t\t"item_rarity"\t\t"arcana"\n\t\t\t"item_slot"\t\t"hero_base"\n${jugg}`
      + `\t\t\t"visuals"\n\t\t\t{\n`
      + mod('entity_model', 'npc_dota_hero_juggernaut', 'models/heroes/juggernaut/juggernaut_arcana.vmdl', '0')
      + mod('entity_model', 'npc_dota_hero_juggernaut', 'models/heroes/juggernaut/juggernaut_arcana.vmdl', '1')
      + mod('activity', 'ALL', 'arcana')
      + mod('activity', 'ALL', 'red', '1')
      + mod('particle', 'particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf', 'particles/econ/items/juggernaut/jugg_arcana/blade_fury.vpcf', '0')
      + mod('particle', 'particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf', 'particles/econ/items/juggernaut/jugg_arcana/blade_fury_red.vpcf', '1')
      // numbered, as Zeus's and Phantom Assassin's arcanas write theirs
      + mod('model', 'models/heroes/juggernaut/jugg_mask.vmdl', 'models/development/invisiblebox.vmdl', '', 'asset_modifier0')
      + mod('model', 'models/items/juggernaut/paid_mask/paid_mask.vmdl', 'models/items/juggernaut/paid_mask/paid_mask_arcana_refit.vmdl')
      + mod('entity_model', 'npc_dota_lone_druid_bear1', 'models/heroes/lone_druid/spirit_bear_rubick.vmdl')
      + mod('icon_replacement_hero', 'npc_dota_hero_juggernaut', 'npc_dota_hero_juggernaut_alt1', '0')
      + mod('icon_replacement_hero', 'npc_dota_hero_juggernaut', 'npc_dota_hero_juggernaut_alt2', '1')
      + mod('icon_replacement_hero_minimap', 'npc_dota_hero_juggernaut', 'npc_dota_hero_juggernaut_alt1')
      + mod('ability_icon', 'juggernaut_blade_fury', 'juggernaut_blade_fury_arcana')
      + mod('inventory_icon', 'blink', 'blink_jugg_arcana')
      + `\t\t\t\t"styles"\n\t\t\t\t{\n\t\t\t\t}\n\t\t\t}\n\t\t}\n`,
    // a persona in an ordinary slot: only the rule keeps it out, a persona slot has no stock item anyway
    `\t\t"9070"\n\t\t{\n\t\t\t"name"\t\t"Juggernaut Persona Base"\n\t\t\t"prefab"\t\t"wearable"\n\t\t\t"item_slot"\t\t"hero_base"\n${jugg}\t\t}\n`,
  ]);
}

test('an arcana is offered and dresses the stock item of its slot, the hero base most of them sit in', () => {
  /* Arcanas used to be left out by their name, and hero_base with them: twelve heroes have a stock
     "<Hero>'s Base" for an arcana to dress, and none of it was offered. */
  const text = arcanaTable();
  const slot = builder.itemSlots(text).find((s) => s.equipSlot === 'hero_base');
  assert.equal(slot?.slot, 'item:juggernaut:hero_base');
  assert.equal(slot?.slotLabel, 'Hero base');
  // the arcana, and not the persona beside it; with no note, as its base fixes what J0nathan550's
  // pass found (src/arcana-bases.ts)
  assert.deepEqual(slot?.options, [{ id: '9059', name: 'Bladeform Legacy' }], 'the arcana, and not the persona beside it');
  assert.equal(builder.defaultItemForWearable(text, '9059')?.id, '811');
  assert.equal(builder.defaultItemForWearable(text, '9070'), null, 'a persona does not dress the stock base');
});

test("an arcana's patch brings its hero model under the plain hero's, with its first style's swaps, pictures and portrait", () => {
  const patched = builder.itemEffectPatch(arcanaTable(), '9059', '');
  const picture = (folder: string, name: string) => `panorama/images/${folder}/${name}_png.vtex_c`;
  const pictureCopy = (folder: string, from: string, to: string) => ({ from: picture(folder, from), to: picture(folder, to), optional: true });
  assert.equal(patched.id, '811');
  // the VPK puts the arcana under the hero's path and the box under the mask's, so the table names
  // neither: a swap to a path the server's table does not load is an ERROR model after a reconnect
  assert.doesNotMatch(patched.block, /"npc_dota_hero_juggernaut"\s+"modifier"\s+"models\/heroes\/juggernaut\/juggernaut_arcana\.vmdl"/, "no swap of the hero's model");
  assert.doesNotMatch(patched.block, /invisiblebox/, 'no swap of the stock mask');
  assert.match(patched.block, /spirit_bear_rubick\.vmdl/, "another unit's swap stays: nothing puts it under a path");
  assert.match(patched.block, /paid_mask_arcana_refit\.vmdl/, "and so does a paid mask's refit");
  assert.deepEqual(patched.assetCopies, [
    // the hero's own, once, with what the item switches on in every style: "red" is the second style's
    { from: 'models/heroes/juggernaut/juggernaut_arcana.vmdl', hero: 'npc_dota_hero_juggernaut', activities: ['arcana'] },
    // the stock mask hidden, as the arcana's body has its own; a paid mask's refit is not the hero's to change
    { from: 'models/development/invisiblebox.vmdl', to: 'models/heroes/juggernaut/jugg_mask.vmdl' },
    // the second style's version of the same particle would have won
    { from: 'particles/econ/items/juggernaut/jugg_arcana/blade_fury.vpcf', to: 'particles/units/heroes/hero_juggernaut/juggernaut_blade_fury.vpcf' },
    // the portrait of the top bar and of the hero picker, the minimap icon, an ability's; not the
    // Blink Dagger's picture, which is every hero's
    pictureCopy('heroes', 'npc_dota_hero_juggernaut_alt1', 'npc_dota_hero_juggernaut'),
    pictureCopy('heroes/selection', 'npc_dota_hero_juggernaut_alt1', 'npc_dota_hero_juggernaut'),
    pictureCopy('heroes/icons', 'npc_dota_hero_juggernaut_alt1', 'npc_dota_hero_juggernaut'),
    pictureCopy('spellicons', 'juggernaut_blade_fury_arcana', 'juggernaut_blade_fury'),
  ], "and the spirit bear's swap left alone: it is not Juggernaut's");
  assert.deepEqual(patched.portraits, [{ model: 'models/heroes/juggernaut/juggernaut_arcana.vmdl', hero: 'npc_dota_hero_juggernaut' }],
    "the HUD portrait's camera and lights come with the hero model");
  assert.deepEqual(patched.sprites, [{ sprite: 'minimap_heroicon_npc_dota_hero_juggernaut', as: 'minimap_heroicon_npc_dota_hero_juggernaut_alt1' }],
    'the minimap draws hero icons out of its sprite sheet too');
});

test("an arcana's hero model goes in under the path the hero's script names, playing without the item's modifier", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-arcana-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  const arcana = model('models/heroes/juggernaut/juggernaut_arcana.vmdl', [
    ['attack', ['ACT_DOTA_ATTACK', 'arcana']],
    ['attack_plain', ['ACT_DOTA_ATTACK']],
  ]);
  // the ward's Model comes after the hero's
  const script = '"DOTAHeroes"\n{\n\t"npc_dota_hero_juggernaut"\n\t{\n\t\t"Model"\t\t"models/heroes/juggernaut/juggernaut.vmdl"\n\t\t"Ward"\n\t\t{\n\t\t\t"Model"\t\t"models/heroes/juggernaut/jugg_healing_ward.vmdl"\n\t\t}\n\t}\n}\n';
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([
    entry('scripts/npc/heroes/npc_dota_hero_juggernaut.txt', script),
    entry('models/heroes/juggernaut/juggernaut_arcana.vmdl_c', arcana),
  ]));
  const entries = builder.gameAssetEntries(dir, [
    { from: 'models/heroes/juggernaut/juggernaut_arcana.vmdl', hero: 'npc_dota_hero_juggernaut', activities: ['arcana'] },
    { from: 'models/heroes/juggernaut/juggernaut_arcana.vmdl', hero: 'npc_dota_hero_juggernaut', activities: ['arcana'] },
  ]);
  assert.deepEqual(entries.map((en) => vpk.entryPath(en)), ['models/heroes/juggernaut/juggernaut.vmdl_c'], 'once, at the hero path');
  assert.deepEqual(clips(entries[0].data), [['attack', ['ACT_DOTA_ATTACK']], ['attack_plain', []]],
    'the arcana attack is the one played with no item to switch it on');
  assert.throws(() => builder.gameAssetEntries(dir, [{ from: 'models/heroes/juggernaut/juggernaut_arcana.vmdl', hero: 'npc_dota_hero_nobody', activities: [] }]),
    /model of hero npc_dota_hero_nobody/);
});

test('a hero model the reader cannot open goes in as it is rather than taking the arcana out of the build', (t) => {
  // Phantom Assassin's arcana model is KV3 compressed with zstd before version 5, which the reader refuses
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-arcana-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([
    entry('scripts/npc/heroes/npc_dota_hero_phantom_assassin.txt', '"npc_dota_hero_phantom_assassin"\n{\n\t"Model"\t\t"models/heroes/phantom_assassin/phantom_assassin.vmdl"\n}\n'),
    entry('models/heroes/phantom_assassin/pa_arcana.vmdl_c', 'bytes the reader cannot open'),
  ]));
  const [only] = builder.gameAssetEntries(dir, [{ from: 'models/heroes/phantom_assassin/pa_arcana.vmdl', hero: 'npc_dota_hero_phantom_assassin', activities: ['arcana'] }]);
  assert.equal(vpk.entryPath(only), 'models/heroes/phantom_assassin/phantom_assassin.vmdl_c');
  assert.equal(only.data.toString('latin1'), 'bytes the reader cannot open');
});

test('a wearable finds its stock item under the other spelling of its slot', () => {
  /* The table writes some slots two ways: a wearable on "shoulder" belongs where the stock item says
     "shoulders". With no stock item under the wearable's own spelling, the alias is what finds it. */
  const pudge = `\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_pudge"\t\t"1"
\t\t\t}`;
  const text = table([
    `\t\t"600"
\t\t{
\t\t\t"name"\t\t"Pudge shoulders default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"shoulders"
${pudge}
\t\t}`,
    `\t\t"9700"
\t\t{
\t\t\t"name"\t\t"Pudge shoulder chains"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"shoulder"
${pudge}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9701"
\t\t{
\t\t\t"name"\t\t"Pudge shoulder hooks"
\t\t\t"item_slot"\t\t"shoulder"
${pudge}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
  ]);
  assert.equal(builder.defaultItemForWearable(text, '9700')?.id, '600');

  // a donor block that names no prefab gets one, written before its closing brace
  const { block } = builder.itemEffectPatch(text, '9701', '');
  assert.equal(block.split('"prefab"').length - 1, 1, 'the prefab is added once');
  assert.match(block, /"prefab"\t\t"default_item"\r?\n\}\s*$/);
  assert.match(block, /^"600"/, 'under the stock item\'s id');
});

/** Earthshaker's stock bracers and an immortal for them with three styles, as items_game writes
 *  Bracers of the Cavern Luminar: a skin and an unlock per style, a particle per style, a sound
 *  swap and a response criterion for every style, and a third style with a model of its own. */
function styledTable() {
  const es = '\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_earthshaker"\t\t"1"\n\t\t\t}\n';
  const mod = (fields: [string, string][]) => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n${fields.map(([k, v]) => `\t\t\t\t\t"${k}"\t\t"${v}"\n`).join('')}\t\t\t\t}\n`;
  const totem = 'particles/units/heroes/hero_earthshaker/earthshaker_totem_buff.vpcf';
  return table([
    `\t\t"700"\n\t\t{\n\t\t\t"name"\t\t"Earthshaker's Bracers"\n\t\t\t"prefab"\t\t"default_item"\n\t\t\t"item_slot"\t\t"arms"\n\t\t\t"model_player"\t\t"models/heroes/earthshaker/bracers.vmdl"\n${es}\t\t}\n`,
    `\t\t"7293"\n\t\t{\n\t\t\t"name"\t\t"Bracers of the Cavern Luminar"\n\t\t\t"prefab"\t\t"wearable"\n\t\t\t"item_slot"\t\t"arms"\n\t\t\t"model_player"\t\t"models/items/earthshaker/ti6_bracer.vmdl"\n${es}`
      + '\t\t\t"visuals"\n\t\t\t{\n'
      + '\t\t\t\t"styles"\n\t\t\t\t{\n'
      + '\t\t\t\t\t"0"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"#Style_Luminar_0"\n\t\t\t\t\t\t"skin"\t\t"0"\n\t\t\t\t\t}\n'
      + '\t\t\t\t\t"1"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"#Style_Luminar_1"\n\t\t\t\t\t\t"skin"\t\t"1"\n\t\t\t\t\t\t"unlock"\n\t\t\t\t\t\t{\n\t\t\t\t\t\t\t"gem"\n\t\t\t\t\t\t\t{\n\t\t\t\t\t\t\t\t"def_index"\t\t"3023"\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n'
      + '\t\t\t\t\t"2"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"#Style_Luminar_2"\n\t\t\t\t\t\t"model_player"\t\t"models/items/earthshaker/ti6_bracer_gold.vmdl"\n\t\t\t\t\t\t"price"\t\t"100"\n\t\t\t\t\t}\n'
      + '\t\t\t\t}\n'
      + mod([['type', 'particle'], ['asset', totem], ['modifier', 'particles/econ/ti6/totem_buff.vpcf'], ['style', '0']])
      + mod([['type', 'particle'], ['asset', totem], ['modifier', 'particles/econ/ti6/totem_buff_v2.vpcf'], ['style', '1']])
      + mod([['type', 'sound'], ['asset', 'Hero_EarthShaker.Totem'], ['modifier', 'Hero_EarthShaker.Totem.Immortal']])
      + mod([['type', 'response_criteria'], ['asset', 'luminar']])
      + '\t\t\t}\n\t\t}\n',
  ]);
}

test("an item's styles are offered with it, by their names' tokens", () => {
  const option = builder.itemSlots(styledTable()).flatMap((s) => s.options).find((o) => o.id === '7293');
  assert.deepEqual(option?.styles, ['#Style_Luminar_0', '#Style_Luminar_1', '#Style_Luminar_2']);
  assert.equal(builder.effectKey('style-2,fire'), 'fire,style-2', 'a style rides last in the pick, after its effects');
  assert.equal(builder.effectKey('fire,style-0'), 'fire', 'the first style is no token: a pick made before styles is the same pick');
});

test('a pick in its first style is written as before, with what that style swaps, its sound and its voice', () => {
  const first = builder.itemEffectPatch(styledTable(), '7293', '');
  assert.equal(first.id, '700');
  assert.doesNotMatch(first.block, /"styles"/);
  assert.deepEqual(first.assetCopies, [
    { from: 'models/items/earthshaker/ti6_bracer.vmdl', to: 'models/heroes/earthshaker/bracers.vmdl' },
    { from: 'particles/econ/ti6/totem_buff.vpcf', to: 'particles/units/heroes/hero_earthshaker/earthshaker_totem_buff.vpcf' },
  ]);
  // the server switches these for the item's owner only; the build rewrites the events (src/item-sounds.ts)
  assert.deepEqual(first.sounds, [{ sound: 'Hero_EarthShaker.Totem', as: 'Hero_EarthShaker.Totem.Immortal' }]);
  assert.deepEqual(first.voices, [{ hero: 'npc_dota_hero_earthshaker', key: 'customresponse', value: 'luminar' }]);
});

test("a pick in another style is the item with that style as its only one, and that style's files", () => {
  const second = builder.itemEffectPatch(styledTable(), '7293', 'style-1');
  const styles = /"styles"\s*\{\s*"0"\s*\{([^}]*)\}\s*\}/.exec(second.block);
  assert.ok(styles, 'one style, numbered 0, as a stock item can wear');
  assert.match(styles[1], /"skin"\s+"1"/, "the second style's material");
  assert.doesNotMatch(second.block, /"unlock"|#Style_Luminar_0|ti6\/totem_buff\.vpcf"/, "no unlock, and the first style's particle is gone");
  assert.match(second.block, /totem_buff_v2\.vpcf"\s*"style"\s+"0"/, "the second style's particle, now the first style's");
  assert.deepEqual(second.assetCopies.map((c) => c.from), ['models/items/earthshaker/ti6_bracer.vmdl', 'particles/econ/ti6/totem_buff_v2.vpcf']);

  const third = builder.itemEffectPatch(styledTable(), '7293', 'style-2');
  assert.match(third.block, /"model_player"\s+"models\/items\/earthshaker\/ti6_bracer_gold\.vmdl"/, "the third style's own model is worn");
  assert.doesNotMatch(third.block, /"price"/);
  assert.deepEqual(third.assetCopies[0], { from: 'models/items/earthshaker/ti6_bracer_gold.vmdl', to: 'models/heroes/earthshaker/bracers.vmdl' });
  assert.deepEqual(builder.itemEffectPatch(styledTable(), '7293', 'style-9').block, builder.itemEffectPatch(styledTable(), '7293', '').block,
    'a style the item has not got is its first');
});

test("the builder's slots made a pause at a time are the slots made at once", async () => {
  const { drain, PAUSE } = await import('../src/steps.ts');
  const { itemSlots, itemSlotsSteps } = await import('../src/item-builder-slots.ts');
  const text = `${itemWearableTable()} `;
  let pauses = 0;
  const steps = itemSlotsSteps(text);
  let r = steps.next();
  for (; !r.done; r = steps.next()) if (r.value === PAUSE) pauses++;
  assert.ok(pauses >= 1);
  assert.deepEqual(r.value, itemSlots(text));
  assert.deepEqual(drain(itemSlotsSteps(text)), r.value);
});

/* A reconnect wears only what the server's own item table loaded, and a slot whose stock item has
 * no model has nothing loaded to put a pick under: Earthshaker's cosmic head was an ERROR model
 * after every reconnect (2026-10-18). The picker says so before the pick, not the game after it. */
test('a pick for a slot whose stock item has no model is marked as lasting until a reconnect', () => {
  const es = '\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_earthshaker"\t\t"1"\n\t\t\t}\n';
  const stock = (id: string, name: string, slot: string, model = '') => `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"default_item"\n\t\t\t"item_slot"\t\t"${slot}"\n${model ? `\t\t\t"model_player"\t\t"${model}"\n` : ''}${es}\t\t}\n`;
  const wearable = (id: string, name: string, slot: string, model = '') => `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"wearable"\n\t\t\t"item_slot"\t\t"${slot}"\n${model ? `\t\t\t"model_player"\t\t"${model}"\n` : ''}${es}\t\t}\n`;
  const text = table([
    stock('8655', "Earthshaker's Uncoiffed Head", 'head'),
    stock('460', "Earthshaker's Bracers", 'arms', 'models/heroes/earthshaker/bracers.vmdl'),
    wearable('34310', 'Intergalactic Orbliterator Head', 'head', 'models/items/earthshaker/es_cosmic/es_cosmic_head.vmdl'),
    wearable('34311', 'Head With Nothing To Wear', 'head'),
    wearable('34308', 'Intergalactic Orbliterator Arms', 'arms', 'models/items/earthshaker/es_cosmic/es_cosmic_arms.vmdl'),
  ]);
  const options = new Map(builder.itemSlots(text).flatMap((s) => s.options.map((o) => [o.id, o])));
  assert.equal(options.get('34310')?.note?.status, 'issues');
  assert.match(options.get('34310')?.note?.text || '', /ERROR/);
  assert.equal(options.get('34311')?.note, undefined, 'no model of its own, nothing to lose');
  assert.equal(options.get('34308')?.note, undefined, 'the bracers have a stock path to go under');
});

/* A hero's other form, swapped by hero_model_change, names a model only the paid item loads: left
 * to the game, Rictus Ripper's demon was the plain one, or the arcana's another mod put at
 * demon.vmdl (2026-10-19). It goes under the form's own path, like a stock item's model. */
test("a pick that changes the hero's other form puts the form's model under its path", () => {
  const tb = '\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_terrorblade"\t\t"1"\n\t\t\t}\n';
  const swap = (type: string, asset: string, modifier: string) => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"${type}"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n\t\t\t\t}\n`;
  const text = table([
    `\t\t"5960"\n\t\t{\n\t\t\t"name"\t\t"Terrorblade's Metamorphosis"\n\t\t\t"prefab"\t\t"default_item"\n\t\t\t"item_slot"\t\t"ability3"\n${tb}\t\t}\n`,
    `\t\t"31410"\n\t\t{\n\t\t\t"name"\t\t"Rictus Ripper - Demon"\n\t\t\t"prefab"\t\t"wearable"\n\t\t\t"item_slot"\t\t"ability3"\n${tb}\t\t\t"visuals"\n\t\t\t{\n`
      + swap('hero_model_change', 'models/heroes/terrorblade/demon.vmdl', 'models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl')
      + swap('ability_icon', 'terrorblade_metamorphosis', 'terrorblade/dreadhunt/default/dreadhunt_metamorphosis')
      + swap('hero_model_change', 'models/creeps/neutral_creeps/n_creep_ogre_med/n_creep_ogre_med.vmdl', 'models/items/x/ogre.vmdl')
      + '\t\t\t}\n\t\t}\n',
  ]);
  const pick = builder.itemEffectPatch(text, '31410', '');
  assert.equal(pick.id, '5960');
  assert.deepEqual(pick.assetCopies.filter((c) => 'to' in c && c.to.endsWith('.vmdl')),
    [{ from: 'models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl', to: 'models/heroes/terrorblade/demon.vmdl' }]);
  assert.doesNotMatch(pick.block, /dreadhunt_demon\.vmdl/, 'the swap is the file now, not the table');
  assert.match(pick.block, /"type"\s+"ability_icon"/, 'the rest of the visuals stay');
  assert.match(pick.block, /n_creep_ogre_med/, 'only a form under models/heroes/ is staged; anything else stays for the game');
});
