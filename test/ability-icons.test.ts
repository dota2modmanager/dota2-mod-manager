/* A hero's ability icons picked from his own cosmetics' (src/ability-icons.ts and its service): what
 * there is to pick is read off the item table's ability_icon modifiers, only of the hero's items and
 * of the shared sets for his abilities; a pick is the picked icon's file copied to the ability's own
 * path; one record per hero, the last pick taken off with the record. On a table and a game folder
 * made here, shaped as the game of 2026-11-07 has them (Earthshaker's Fissure has a dozen icons). */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, sharedVpkIndex } from '../src/vpk.ts';
import { listItems } from '../src/schema-items.ts';
import { forcedFiles, heroIconChoices, iconEntries, iconFile, iconModifiers, modifierSets, setLabel } from '../src/ability-icons.ts';
import { writePak } from '../src/generated-pak.ts';
import { createAbilityIcons } from '../src/ability-icons-service.ts';

const mod = (asset: string, modifier: string, style?: number) => `
				"asset_modifier${style ?? 0}"
				{
					"type"		"ability_icon"
					"asset"		"${asset}"
					"modifier"		"${modifier}"${style == null ? '' : `\n\t\t\t\t\t"style"		"${style}"`}
				}`;
const item = (id: string, name: string, hero: string, mods: string) => `
		"${id}"
		{
			"name"		"${name}"
			"prefab"		"wearable"
			"used_by_heroes"
			{
				"npc_dota_hero_${hero}"		"1"
			}
			"visuals"
			{${mods}
			}
		}`;

const TABLE = `"items_game"
{
	"items"
	{${item('6402', 'Totem of Deep Magma', 'earthshaker',
    mod('earthshaker_fissure', 'earthshaker/deep_magma/deep_magma_default/deep_magma_default_fissure', 1) +
    mod('earthshaker_fissure', 'earthshaker/deep_magma/deep_magma_cyan/deep_magma_cyan_fissure', 2))}${
  item('7000', 'Golden Gravelmaw', 'earthshaker', mod('earthshaker_fissure', 'earthshaker_fissure_alt_gold'))}${
  // the same picture a second time, from another item: offered once
  item('7001', 'Gravelmaw Again', 'earthshaker', mod('earthshaker_fissure', 'earthshaker_fissure_alt_gold'))}${
  // a picture the game does not have: not offered
  item('7002', 'Lost Totem', 'earthshaker', mod('earthshaker_enchant_totem', 'earthshaker/lost/lost_totem'))}${
  // another hero's: never Earthshaker's
  item('8000', 'Lion Thing', 'lion', mod('lion_finger_of_death', 'lion/demon/finger'))}
	}
	"asset_modifiers"
	{
		"124"
		{
			"name"		"tine_of_the_behemoth_icons"
			"loc_key"		"#DOTA_Asset_Mod_Tine_Of_The_Behemoth_Icons"
			"asset_modifier0"
			{
				"modifier"		"earthshaker/sltv/earthshaker_fissure"
				"type"		"ability_icon"
				"asset"		"earthshaker_fissure"
			}
			"asset_modifier1"
			{
				"type"		"ability_icon"
				"asset"		"lion_impale"
				"modifier"		"lion/sltv/lion_impale"
			}
		}
	}
}
`;

const SCRIPT = `"DOTAHeroes"
{
	"npc_dota_hero_earthshaker"
	{
		"Model"		"models/heroes/earthshaker/earthshaker.vmdl"
		"Ability1"		"earthshaker_fissure"
		"Ability2"		"earthshaker_enchant_totem"
		"Ability4"		"generic_hidden"
		"Ability10"		"special_bonus_unique_earthshaker"
	}
}`;

const ICONS = ['earthshaker_fissure', 'earthshaker_enchant_totem', 'earthshaker/deep_magma/deep_magma_default/deep_magma_default_fissure',
  'earthshaker/deep_magma/deep_magma_cyan/deep_magma_cyan_fissure', 'earthshaker_fissure_alt_gold', 'earthshaker/sltv/earthshaker_fissure',
  'lion_finger_of_death', 'lion/demon/finger', 'lion_impale', 'lion/sltv/lion_impale'];
const picture = (icon: string) => Buffer.from(`picture of ${icon}`);
const has = (f: string) => ICONS.some((i) => iconFile(i) === f);
const sources = () => [...listItems(TABLE), ...modifierSets(TABLE)];

test('every ability_icon modifier is read, whichever order its fields come in', () => {
  const mods = iconModifiers(TABLE);
  assert.equal(mods.length, 8);
  const sltv = mods.find((m) => m.modifier === 'earthshaker/sltv/earthshaker_fissure');
  assert.equal(sltv?.asset, 'earthshaker_fissure', '"modifier" before "asset", as Wraith King’s Frostivus one has it');
  assert.equal(mods.find((m) => m.modifier.endsWith('cyan_fissure'))?.style, 2);
});

test('a shared set is named from its own name when the game has no text for it', () => {
  assert.equal(setLabel('tine_of_the_behemoth_icons'), 'Tine of the Behemoth');
  assert.equal(setLabel('ravening_ability_icons'), 'Ravening');
  const [set] = modifierSets(TABLE);
  assert.deepEqual([set.id, set.name, set.locKey, set.shared], ['set:124', 'Tine of the Behemoth', 'DOTA_Asset_Mod_Tine_Of_The_Behemoth_Icons', true]);
});

test('a hero is offered the icons of his own items and of the shared sets for his abilities, nobody else’s', () => {
  const got = heroIconChoices(TABLE, sources(), 'earthshaker', ['earthshaker_fissure', 'earthshaker_enchant_totem'], has);
  assert.deepEqual(got.map((a) => a.ability), ['earthshaker_fissure'], 'the totem’s only icon is not in the game: no row');
  assert.deepEqual(got[0].choices.map((c) => c.icon), [
    'earthshaker/deep_magma/deep_magma_default/deep_magma_default_fissure',
    'earthshaker/deep_magma/deep_magma_cyan/deep_magma_cyan_fissure',
    'earthshaker_fissure_alt_gold',
    'earthshaker/sltv/earthshaker_fissure',
  ], 'the gold one once, though two items show it');
  assert.equal(got[0].choices[3].locKey, 'DOTA_Asset_Mod_Tine_Of_The_Behemoth_Icons');
  const lion = heroIconChoices(TABLE, sources(), 'lion', ['lion_impale', 'lion_finger_of_death'], has);
  assert.deepEqual(lion.map((a) => [a.ability, a.choices.map((c) => c.icon)]), [
    ['lion_impale', ['lion/sltv/lion_impale']],
    ['lion_finger_of_death', ['lion/demon/finger']],
  ], 'in his script’s order');
  assert.ok(lion.every((a) => a.choices.every((c) => !c.icon.startsWith('earthshaker'))));
});

test('a pick is the picked icon’s file under the ability’s own path; one gone from the game is said', () => {
  const read = (f: string) => { const i = ICONS.find((x) => iconFile(x) === f); return i ? picture(i) : null; };
  const { entries, gone } = iconEntries(read, { earthshaker_fissure: 'earthshaker_fissure_alt_gold', earthshaker_aftershock: 'earthshaker/gone/aftershock', '../x': 'earthshaker_fissure_alt_gold' });
  assert.deepEqual(entries.map((e) => `${e.folder}/${e.name}.${e.ext}`), ['panorama/images/spellicons/earthshaker_fissure_png.vtex_c']);
  assert.deepEqual(entries[0].data, picture('earthshaker_fissure_alt_gold'));
  assert.deepEqual(gone, ['earthshaker_aftershock', '../x']);
});

test('a pick covers every picture a worn cosmetic would draw for the ability, and leaves its own alone', () => {
  const mods = iconModifiers(TABLE);
  const files = forcedFiles('earthshaker_fissure', 'earthshaker_fissure_alt_gold', mods);
  assert.deepEqual(files, [
    'earthshaker_fissure',
    'earthshaker/deep_magma/deep_magma_default/deep_magma_default_fissure',
    'earthshaker/deep_magma/deep_magma_cyan/deep_magma_cyan_fissure',
    'earthshaker/sltv/earthshaker_fissure',
  ].map(iconFile), 'the Deep Magma totem on, Fissure is still the gold one');
  const read = (f: string) => { const i = ICONS.find((x) => iconFile(x) === f); return i ? picture(i) : null; };
  const { entries } = iconEntries(read, { earthshaker_fissure: 'earthshaker_fissure_alt_gold' }, mods, has);
  assert.equal(entries.length, 4);
  assert.ok(entries.every((e) => e.data.equals(picture('earthshaker_fissure_alt_gold'))));
});

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-ability-icons-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/npc/heroes/npc_dota_hero_earthshaker.txt', Buffer.from(SCRIPT)),
    entryAt('scripts/npc/heroes/npc_dota_hero_axe.txt', Buffer.from('"Ability1" "axe_berserkers_call"')),
    entryAt('resource/localization/abilities_english.txt', Buffer.from('"lang" { "Tokens" { "DOTA_Tooltip_ability_earthshaker_fissure" "Fissure" } }')),
    ...ICONS.map((i) => entryAt(iconFile(i), picture(i))),
  ]));
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const service = createAbilityIcons({ gamePath: () => game, installer, library, vanilla: () => TABLE });
  const pak = (rec: { files: { relPath: string }[] }) => sharedVpkIndex(path.join(lang, rec.files[0].relPath));
  return { lang, library, installer, service, pak };
}

test('the window is offered the heroes with a choice, and a hero’s abilities in the game’s words', (t) => {
  const { service } = world(t);
  assert.deepEqual(service.heroes(), [{ hero: 'earthshaker', name: 'Earthshaker' }], 'Axe’s items change no icon here');
  const es = service.hero('earthshaker');
  assert.equal(es.abilities[0].name, 'Fissure');
  assert.equal(es.abilities[0].choices.length, 4);
  assert.deepEqual([es.picks, es.recId, es.vrf], [{}, null, false]);
  assert.throws(() => service.hero('../axe'), /героя|hero/i);
});

test('a pick goes on as one record for the hero, another replaces it in place, the last off takes the record', (t) => {
  const { library, service, pak } = world(t);
  const rec = service.set('earthshaker', 'earthshaker_fissure', 'earthshaker_fissure_alt_gold');
  assert.ok(rec);
  assert.equal(rec.categoryId, 'hero-items', 'early in the load order, with the hero items');
  assert.deepEqual(rec.generated, { abilityIcons: 'earthshaker', picks: { earthshaker_fissure: 'earthshaker_fissure_alt_gold' } });
  assert.deepEqual(pak(rec).read(iconFile('earthshaker_fissure')), picture('earthshaker_fissure_alt_gold'));
  assert.deepEqual(service.hero('earthshaker').picks, { earthshaker_fissure: 'earthshaker_fissure_alt_gold' });

  const again = service.set('earthshaker', 'earthshaker_fissure', 'earthshaker/sltv/earthshaker_fissure');
  assert.equal(again?.id, rec.id, 'the same record');
  assert.equal(library.list().length, 1);
  assert.deepEqual(pak(again!).read(iconFile('earthshaker_fissure')), picture('earthshaker/sltv/earthshaker_fissure'));

  assert.equal(service.set('earthshaker', 'earthshaker_fissure', null), null);
  assert.equal(library.list().length, 0, 'nothing picked, nothing in My mods');
});

test('an icon the hero is not offered is refused before anything is written', (t) => {
  const { library, service } = world(t);
  assert.throws(() => service.set('earthshaker', 'earthshaker_fissure', 'lion/demon/finger'), /иконки|icon/i, 'another hero’s');
  assert.throws(() => service.set('earthshaker', 'earthshaker_echo_slam', 'earthshaker_fissure_alt_gold'), /способности|ability/i);
  assert.equal(library.list().length, 0);
});

test('after a Dota update the record is built again from the game’s pictures, and said done', (t) => {
  const { service, library } = world(t);
  const rec = service.set('earthshaker', 'earthshaker_fissure', 'earthshaker_fissure_alt_gold')!;
  assert.deepEqual(service.rebuild([rec.id, 'another']), [rec.id]);
  assert.equal(library.list().length, 1);
  assert.equal(service.clear('earthshaker'), null);
  assert.equal(library.list().length, 0);
});

test('a mod that carries the same icon from a lower slot (an item builder pick) is overtaken', (t) => {
  const { library, installer, service, pak } = world(t);
  // the builder puts the Deep Magma totem's Fissure under the plain path, in the early zone
  const builder = library.add({ name: 'Totem of Deep Magma', categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null,
    files: writePak(installer, buildVpk([entryAt(iconFile('earthshaker_fissure'), picture('earthshaker/deep_magma/deep_magma_default/deep_magma_default_fissure'))])) });
  assert.equal(builder.files[0].relPath, 'pak02_dir.vpk');
  const rec = service.set('earthshaker', 'earthshaker_fissure', 'earthshaker_fissure_alt_gold')!;
  const slot = (id: string) => library.list().find((r) => r.id === id)!.files[0].relPath;
  assert.equal(slot(rec.id), 'pak02_dir.vpk', 'the icons load first, so the pick is what the game draws');
  assert.equal(slot(builder.id), 'pak03_dir.vpk', 'the pick of the builder keeps its files, a slot later');
  assert.deepEqual(pak(rec).read(iconFile('earthshaker_fissure')), picture('earthshaker_fissure_alt_gold'));
  // switched off, it does not count: nothing moves
  library.update(builder.id, { enabled: false });
  const again = service.set('earthshaker', 'earthshaker_fissure', 'earthshaker/sltv/earthshaker_fissure')!;
  assert.equal(slot(again.id), 'pak02_dir.vpk');
});
