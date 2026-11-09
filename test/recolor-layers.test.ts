/* A hero's parts to recolour (src/recolor-layers.ts, issue #422): his abilities out of his script,
 * each ability's particles by their names, the rest as his other effects, the icons and portrait
 * that the game has, the particles of the items picked for him with their children, and pictures
 * moved to the chosen colour pixel by pixel. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { heroAbilities, heroLayers, heroModelFolder, heroParticleFolder, itemModelPaths, shadePixels, withChildren, withShares } from '../src/recolor-layers.ts';

const SCRIPT = `"DOTAHeroes"
{
	"npc_dota_hero_invoker"
	{
		"Ability1"		"invoker_quas"
		"Ability2"		"invoker_invoke"
		"Ability3"		"invoker_emp"
		"Ability4"		"generic_hidden"
		"Ability5"		"invoker_emp_ad"
		"Ability10"		"special_bonus_unique_invoker_1"
		"AbilityDraftAbilities"
		{
			"Ability1"	"invoker_quas"
		}
	}
}`;

const H = 'particles/units/heroes/hero_invoker';
const PATHS = [
  `${H}/invoker_quas_orb.vpcf_c`, `${H}/invoker_invoke.vpcf_c`, `${H}/invoker_emp.vpcf_c`, `${H}/invoker_emp_explode.vpcf_c`,
  `${H}/invoker_base_attack.vpcf_c`,
  'panorama/images/spellicons/invoker_quas_png.vtex_c', 'panorama/images/spellicons/invoker_emp_png.vtex_c',
  'panorama/images/heroes/npc_dota_hero_invoker_png.vtex_c', 'panorama/images/heroes/icons/npc_dota_hero_invoker_png.vtex_c',
  'particles/econ/items/invoker/cape/cape_ambient.vpcf_c',
];

test("the hero's abilities: talents, empty slots and Ability Draft copies left out, each once", () => {
  assert.deepEqual(heroAbilities(SCRIPT), ['invoker_quas', 'invoker_invoke', 'invoker_emp']);
});

test("each ability takes the particles named after it; invoke does not take every invoker file", () => {
  const layers = heroLayers(PATHS, 'invoker', heroAbilities(SCRIPT));
  const of = (id: string) => layers.find((l) => l.id === id)?.files.map((p) => p.split('/').pop());
  assert.deepEqual(of('ability:invoker_quas'), ['invoker_quas_orb.vpcf_c']);
  assert.deepEqual(of('ability:invoker_invoke'), ['invoker_invoke.vpcf_c']);
  assert.deepEqual(of('ability:invoker_emp'), ['invoker_emp.vpcf_c', 'invoker_emp_explode.vpcf_c']);
  assert.deepEqual(of('effects'), ['invoker_base_attack.vpcf_c'], 'what no ability names is his other effects');
  assert.deepEqual(layers.filter((l) => l.kind === 'abilityIcon').map((l) => l.name), ['invoker_quas', 'invoker_emp'], 'only icons the game has');
  assert.equal(of('portrait')?.length, 2);
  assert.deepEqual(layers.map((l) => l.id).slice(0, 3), ['ability:invoker_quas', 'ability:invoker_invoke', 'ability:invoker_emp'], "in the script's order");
});

test('a hero whose folder drops his underscores, or has a name of its own, is found', () => {
  assert.equal(heroParticleFolder(['particles/units/heroes/hero_crystalmaiden/maiden_crystal_nova.vpcf_c'], 'crystal_maiden'), 'particles/units/heroes/hero_crystalmaiden/');
  assert.equal(heroParticleFolder([], 'drow_ranger'), 'particles/units/heroes/hero_drow/');
  const cm = heroLayers(['particles/units/heroes/hero_crystalmaiden/maiden_crystal_nova_flash.vpcf_c'], 'crystal_maiden', ['crystal_maiden_crystal_nova']);
  assert.equal(cm[0].id, 'ability:crystal_maiden_crystal_nova', "by the part of the name after the hero's");
});

test("an item picked for him is a layer with the particles its visuals name that the game has", () => {
  const layers = heroLayers(PATHS, 'invoker', [], [
    { id: '7000', name: 'Cape', particles: ['particles/econ/items/invoker/cape/cape_ambient.vpcf', 'particles/econ/items/invoker/cape/gone.vpcf'] },
    { id: '7001', name: 'Plain', particles: [] },
  ]);
  const items = layers.filter((l) => l.kind === 'item');
  assert.deepEqual(items.map((l) => [l.id, l.name, l.files]), [['item:7000', 'Cape', ['particles/econ/items/invoker/cape/cape_ambient.vpcf_c']]]);
});

test('a particle brings the ones it creates, once each, round a loop too', () => {
  const tree: Record<string, string[]> = { 'a.vpcf_c': ['b.vpcf_c', 'mat.vmat_c'], 'b.vpcf_c': ['a.vpcf_c', 'c.vpcf_c'], 'c.vpcf_c': [] };
  assert.deepEqual(withChildren(['a.vpcf_c'], (p) => tree[p] || []), ['a.vpcf_c', 'b.vpcf_c', 'c.vpcf_c']);
});

test('a picture takes the colour pixel by pixel: greys and clear pixels stay, BGRA as Electron has it', () => {
  const px = Buffer.from([200, 40, 40, 255, 128, 128, 128, 255, 200, 40, 40, 0]);
  assert.equal(shadePixels(px, [0, 255, 0]), 1);
  assert.deepEqual([...px.subarray(0, 4)], [40, 200, 40, 255], 'red moved to green, its brightness kept');
  assert.deepEqual([...px.subarray(4)], [128, 128, 128, 255, 200, 40, 40, 0]);
  const bgra = Buffer.from([40, 40, 200, 255]);
  shadePixels(bgra, [0, 0, 255], { bgra: true });
  assert.deepEqual([...bgra], [200, 40, 40, 255], 'red in BGRA moved to blue in BGRA');
});

test("the body is the colour textures in his model's folder, not its masks or a folder below", () => {
  assert.equal(heroModelFolder('"npc_dota_hero_drow_ranger"\n{\n\t"Model"\t\t"models/heroes/drow/drow_base.vmdl"\n}'), 'drow');
  assert.equal(heroModelFolder('"Model" "models/creeps/x.vmdl"'), null);
  const dir = 'materials/models/heroes/juggernaut/';
  const body = heroLayers([`${dir}juggernaut_torso_color_psd_4087f5cf.vtex_c`, `${dir}juggernaut_torso_normal_psd_89f6336d.vtex_c`,
    `${dir}juggernaut_fresnelwarprim_tga_1128410f.vtex_c`, `${dir}old/juggernaut_color_psd_1.vtex_c`, `${dir}juggernaut_sword_color_tga_ab12.vtex_c`], 'juggernaut', [], [], 'juggernaut');
  assert.deepEqual(body.map((l) => [l.id, l.files]), [['body', [`${dir}juggernaut_torso_color_psd_4087f5cf.vtex_c`, `${dir}juggernaut_sword_color_tga_ab12.vtex_c`]]]);
  assert.deepEqual(heroLayers([`${dir}juggernaut_torso_color_psd_4087f5cf.vtex_c`], 'juggernaut', []), [], 'no model folder, no body');
});

test("items drawn from one texture are told of each other, so the window moves them together", () => {
  // Troll Warlord's axes, as the game has them: two items, one texture between them, and the body's too
  const axe = 'materials/models/heroes/troll_warlord/troll_warlord_axe_large_color_psd_903ae5e5.vtex_c';
  const rows = withShares([
    { id: 'body', kind: 'body', files: [axe, 'materials/models/heroes/troll_warlord/troll_body_color.vtex_c'] },
    { id: 'itemModel:373', kind: 'itemModel', name: 'Axe', files: [axe] },
    { id: 'itemModel:374', kind: 'itemModel', name: 'Axe off-hand', files: [axe] },
    { id: 'itemModel:375', kind: 'itemModel', name: 'Head', files: ['materials/models/heroes/troll_warlord/head_color.vtex_c'] },
  ]);
  assert.deepEqual(rows.map((r) => [r.layer.id, r.shares]), [
    ['body', []], ['itemModel:373', ['itemModel:374']], ['itemModel:374', ['itemModel:373']], ['itemModel:375', []],
  ]);
});

test("an item's models: its own and the units it dresses, not a pet, the stock model a style replaces nor its portrait", () => {
  // trimmed from items_game: a Healing Ward, a style that swaps a stock model, an arcana's body, an extra wearable, a pet and a portrait
  const block = `"12770"
{
	"name"		"The Ward of Odocoeleus"
	"model_player"		"models/items/juggernaut/jugg_head/jugg_head.vmdl"
	"portraits" { "models/items/juggernaut/ward/portrait_only.vmdl" { "PortraitFOV" "38" } }
	"visuals"
	{
		"asset_modifier0" { "type" "entity_model" "asset" "npc_dota_juggernaut_healing_ward" "modifier" "models/items/juggernaut/ward/odocoeleus_ward.vmdl" "offsets" { "0" "0 0 0" } }
		"asset_modifier1" { "type" "model" "asset" "models/heroes/juggernaut/jugg_sword.vmdl" "modifier" "models/items/juggernaut/sword_style2.vmdl" }
		"asset_modifier2" { "type" "hero_model_change" "asset" "models/heroes/juggernaut/juggernaut.vmdl" "modifier" "models/heroes/juggernaut/juggernaut_arcana.vmdl" }
		"asset_modifier3" { "type" "additional_wearable" "asset" "models/items/juggernaut/cape_extra.vmdl" }
		"asset_modifier4" { "type" "pet" "asset" "models/items/courier/pet.vmdl" "loadout_offsets" { "0" "0 100 0" } }
		"asset_modifier5" { "type" "portrait_background_model" "asset" "models/ui/background.vmdl" }
	}
}`;
  assert.deepEqual(itemModelPaths(block), [
    'models/items/juggernaut/jugg_head/jugg_head.vmdl', 'models/items/juggernaut/ward/odocoeleus_ward.vmdl', 'models/items/juggernaut/sword_style2.vmdl',
    'models/heroes/juggernaut/juggernaut_arcana.vmdl', 'models/items/juggernaut/cape_extra.vmdl',
  ]);
});
