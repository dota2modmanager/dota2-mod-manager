import test from 'node:test';
import assert from 'node:assert/strict';
import { RECOLOR_SETS } from '../src/recolor-sets.ts';
import { gemColor, gemSetOf, type PreviewGem } from '../renderer/catalog/builder/gems.ts';
import { loadoutGem, loadoutMaterialGem } from '../renderer/catalog/preview3d/loadout-gems.ts';
import { loadoutDescriptor } from '../src/loadout-material.ts';

test('each Workshop recolor is available in the item builder', () => {
  assert.equal(Object.keys(RECOLOR_SETS).length, 5);
  for (const [set, entry] of Object.entries(RECOLOR_SETS)) assert.equal(gemSetOf(entry.name), set);
  assert.equal(gemSetOf('Another item'), undefined);
});

test('an explicit Scythes gem overrides the inherited arcana tint without recoloring other effects', () => {
  const arcana: PreviewGem = { set: 'terrorblade-arcana', slot: 'tb:hero_base', color: [255, 0, 0], rules: { ...RECOLOR_SETS['terrorblade-arcana'], bake: false } };
  const scythes: PreviewGem = { set: 'terrorblade-scythes', slot: 'tb:weapon', color: [0, 255, 0], rules: { ...RECOLOR_SETS['terrorblade-scythes'], bake: true } };
  const weapon = RECOLOR_SETS[scythes.set].own[0] + 'ambient.vpcf';
  assert.deepEqual(loadoutGem(weapon, [arcana]), { color: arcana.color, bake: false, own: true });
  assert.deepEqual(loadoutGem(weapon, [arcana, scythes]), { color: scythes.color, bake: true, own: true });
  assert.equal(loadoutGem('particles/econ/courier/ambient.vpcf', [arcana, scythes]), undefined);
  assert.equal(loadoutMaterialGem('materials/models/heroes/terrorblade/glow.vmat', undefined, [arcana]), arcana);
});

test('only authored gem-driven shader inputs are exposed to the live preview', () => {
  const base = { shader: 'hero.vfx', ints: {}, floats: {}, vectors: {}, textures: {} };
  assert.equal(loadoutDescriptor(base).detailGem, undefined);
  assert.equal(loadoutDescriptor({ ...base, gemParams: ['g_vDetail1ColorTint'] }).detailGem, true);
});

test('a custom arcana gem follows onto ordinary Terrorblade cosmetics and a local pick wins', () => {
  const arcana: PreviewGem = { set: 'terrorblade-arcana', slot: 'tb:hero_base', color: [80, 0, 255], rules: { ...RECOLOR_SETS['terrorblade-arcana'], bake: false } };
  const weapon: PreviewGem = { set: 'terrorblade-scythes', slot: 'tb:weapon', color: [0, 220, 80], rules: { ...RECOLOR_SETS['terrorblade-scythes'], bake: true } };
  const path = 'materials/models/items/terrorblade/marauder/glow.vmat';
  assert.deepEqual(loadoutGem('particles/econ/items/terrorblade/marauder/glow.vpcf', [arcana]), { color: arcana.color, own: true, bake: false });
  assert.equal(loadoutMaterialGem(path, 'tb:weapon', [arcana]), arcana);
  assert.equal(loadoutMaterialGem(path, 'tb:weapon', [arcana, weapon]), weapon);
  assert.equal(loadoutMaterialGem(path, 'tb:weapon', [weapon, arcana]), weapon);
});

test('the item picker shows inherited arcana color until an item has a draft or enabled saved color', () => {
  const base = { available: true, picture: null, colorOnly: false, installed: null };
  const arcana = 'terrorblade-arcana', span = 'terrorblade-span';
  const palette = [arcana, span].map(set => ({ ...base, set, name: RECOLOR_SETS[set].name, preview: { ...RECOLOR_SETS[set], bake: set === span } }));
  const worn = { [arcana]: 'tb:hero_base', [span]: 'tb:back' };
  const purple: [number, number, number] = [110, 12, 255], green: [number, number, number] = [12, 220, 30];
  assert.deepEqual(gemColor(span, palette, { [arcana]: purple }, worn), { color: purple, inherited: true, explicit: false });
  assert.deepEqual(gemColor(span, palette, { [arcana]: purple, [span]: green }, worn), { color: green, inherited: false, explicit: true });
  assert.deepEqual(gemColor(span, palette, { [arcana]: purple }, {}).color, RECOLOR_SETS[span].gem);
});

test("a gem picked on Terrorblade's arcana reaches his own blades too, which bake their red into their colours", () => {
  const rules = { ...RECOLOR_SETS['terrorblade-arcana'], bake: false };
  const blue: PreviewGem = { set: 'terrorblade-arcana', slot: 'tb:hero_base', color: [0, 151, 206], rules };
  const sword = 'particles/units/heroes/hero_terrorblade/terrorblade_ambient_sword_blade.vpcf';
  assert.deepEqual(loadoutGem(sword, [blue]), { color: blue.color, bake: false, own: true }, 'repainted live, not left red until the weapon goes on again');
  const stock: PreviewGem = { ...blue, color: RECOLOR_SETS['terrorblade-arcana'].gem as [number, number, number], stock: true };
  assert.deepEqual(loadoutGem(sword, [stock]), { color: stock.color, bake: false, own: false }, 'the stock gem leaves the blades as they were made');
});
