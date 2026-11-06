/* The models of a hero as the item builder dresses it, for the 3D preview (src/hero-preview.ts):
 * the body out of the hero's script, each slot's pick or its stock item, an arcana's own body,
 * and why there is nothing to show when there is not. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { writeGlb, readGlb } from '../src/glb-embed.ts';
import { createHeroPreview, entityModel } from '../src/hero-preview.ts';

const jugg = `\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_juggernaut"\t\t"1"\n\t\t\t}\n`;
const block = (id: string, fields: [string, string][], visuals = '') =>
  `\t\t"${id}"\n\t\t{\n${fields.map(([k, v]) => `\t\t\t"${k}"\t\t"${v}"\n`).join('')}${jugg}${visuals}\t\t}\n`;
const TABLE = `"items_game"\n{\n\t"items"\n\t{\n${[
  block('811', [['name', 'Juggernaut’s Base'], ['prefab', 'default_item'], ['item_slot', 'hero_base']]),
  block('812', [['name', 'Juggernaut’s Mask'], ['prefab', 'default_item'], ['item_slot', 'head'], ['model_player', 'models/heroes/juggernaut/jugg_mask.vmdl']],
    '\t\t\t"visuals"\n\t\t\t{\n\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"particle_create"\n'
    + '\t\t\t\t\t"modifier"\t\t"particles/units/heroes/hero_juggernaut/jugg_mask_glow.vpcf"\n\t\t\t\t}\n\t\t\t}\n'),
  block('5000', [['name', 'Paid Mask'], ['prefab', 'wearable'], ['item_slot', 'head'], ['model_player', 'models/items/juggernaut/paid_mask/paid_mask.vmdl']]),
  block('9059', [['name', 'Bladeform Legacy'], ['prefab', 'wearable'], ['item_rarity', 'arcana'], ['item_slot', 'hero_base']],
    '\t\t\t"visuals"\n\t\t\t{\n\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"entity_model"\n\t\t\t\t\t"asset"\t\t"npc_dota_hero_juggernaut"\n'
    + '\t\t\t\t\t"modifier"\t\t"models/heroes/juggernaut/juggernaut_arcana.vmdl"\n\t\t\t\t}\n\t\t\t}\n'),
].join('')}\t}\n}\n`;
const SLOTS = [{ slot: 'item:juggernaut:head', stock: '812' }, { slot: 'item:juggernaut:hero_base', stock: '811' }];

function game(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-hero3d-'));
  fs.mkdirSync(path.join(root, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/npc/heroes/npc_dota_hero_juggernaut.txt', Buffer.from('"DOTAHeroes"\n{\n\t"Model"\t\t"models/heroes/juggernaut/juggernaut.vmdl"\n\t"LoadoutScale"\t\t"0.85"\n'
      + '\t"RenderablePortrait"\n\t{\n\t\t"Particles"\n\t\t{\n\t\t\t"particles/units/heroes/hero_juggernaut/jugg_loadout.vpcf"\t\t"loadout"\n\t\t}\n\t}\n}\n')),
    entryAt('scripts/npc/portraits_showcase.txt', Buffer.from('"Portraits"\n{\n\t"npc_dota_hero_juggernaut"\n\t{\n\t\t"PortraitBackgroundColor1"\t\t"0.5 0 0.1"\n'
      + '\t\t"PortraitBackgroundModel"\t\t"models/heroes/pedestal/pedestal_1_small.vmdl"\n\t}\n}\n')),
  ]));
  return root;
}

type Pick = { slot: string; itemId: string; name: string };
type Opts = { gamePath?: string | null; have?: (model: string) => boolean };
function preview(picks: Pick[] = [], { gamePath = game(), have = () => true }: Opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-glbs-'));
  const asked: { models: string[]; clips: string[] | 'all' }[] = [];
  const glb = {
    glbs: async (models: string[], clips: string[] | 'all' = []) => {
      asked.push({ models, clips });
      return Object.fromEntries(models.map((m, i) => {
        if (!have(m)) return [m, null];
        const file = path.join(dir, `${asked.length}-${i}.glb`);
        fs.writeFileSync(file, writeGlb({ asset: m } as never, Buffer.alloc(0)));
        return [m, file];
      }));
    },
  };
  const library = { list: () => picks.map((p) => ({ categoryId: 'cosmetic', enabled: true, ...p })) } as never;
  return { hp: createHeroPreview({ glb, library, gamePath: () => gamePath, vanilla: () => TABLE }), asked };
}

test('the body comes out of the hero’s script, and each slot wears its stock item until one is picked', () => {
  const { hp } = preview();
  const p = hp.plan('juggernaut', SLOTS)!;
  assert.equal(p.body, 'models/heroes/juggernaut/juggernaut.vmdl');
  assert.deepEqual(p.parts, [{ slot: 'item:juggernaut:head', name: 'Juggernaut’s Mask', model: 'models/heroes/juggernaut/jugg_mask.vmdl',
    fx: ['particles/units/heroes/hero_juggernaut/jugg_mask_glow.vpcf'] }]);
});

test('the hero is staged as its script and its showcase entry say, with its own loadout particles', () => {
  const p = preview().hp.plan('juggernaut', SLOTS)!;
  assert.equal(p.stage.scale, 0.85);
  assert.deepEqual(p.stage.background, [0.5, 0, 0.1]);
  assert.equal(p.stage.pedestal, 'models/heroes/pedestal/pedestal_1_small.vmdl');
  assert.deepEqual(p.heroFx, ['particles/units/heroes/hero_juggernaut/jugg_loadout.vpcf']);
  // a body the reader cannot take has no sequences: the window falls back to its idle
  assert.equal(p.clip, null);
});

test('a pick wears its own model, and an arcana that swaps the hero brings its body', () => {
  const { hp } = preview([{ slot: 'item:juggernaut:head', itemId: '5000', name: 'Paid Mask' }, { slot: 'item:juggernaut:hero_base', itemId: '9059', name: 'Bladeform Legacy' }]);
  const p = hp.plan('npc_dota_hero_juggernaut', SLOTS)!;
  assert.equal(p.body, 'models/heroes/juggernaut/juggernaut_arcana.vmdl');
  assert.deepEqual(p.parts.map((x) => x.model), ['models/items/juggernaut/paid_mask/paid_mask.vmdl']);
});

test('the body is exported with its idle, the items without clips, and a model the game lacks is named', async () => {
  const { hp, asked } = preview([], { have: (m) => !m.includes('jugg_mask') });
  const r = await hp.models('juggernaut', SLOTS, true);
  assert.ok(r.ok);
  // the pedestal the showcase names comes with the items
  assert.deepEqual(asked, [{ models: ['models/heroes/juggernaut/juggernaut.vmdl'], clips: ['idle'] },
    { models: ['models/heroes/juggernaut/jugg_mask.vmdl', 'models/heroes/pedestal/pedestal_1_small.vmdl'], clips: [] }]);
  assert.equal((readGlb(Buffer.from(r.body)).json as { asset?: string }).asset, 'models/heroes/juggernaut/juggernaut.vmdl');
  assert.deepEqual(r.parts, []);
  assert.deepEqual(r.missing, ['Juggernaut’s Mask']);
  assert.ok(r.pedestal);
  // particle files the game lacks are left out, not an error
  assert.deepEqual(r.particles, []);
});

test('nothing to show says why: no toolchain, no game, no body', async () => {
  assert.deepEqual(await preview().hp.models('juggernaut', SLOTS, false), { ok: false, reason: 'no-tool' });
  assert.deepEqual(await preview([], { gamePath: null }).hp.models('juggernaut', SLOTS, true), { ok: false, reason: 'no-game' });
  assert.deepEqual(await preview([], { have: () => false }).hp.models('juggernaut', SLOTS, true), { ok: false, reason: 'no-body' });
  assert.deepEqual(await preview().hp.models('nobody', SLOTS, true), { ok: false, reason: 'no-body' });
});

test('a persona puts the hero in the body its "entity_model" names, and only for that hero', () => {
  const block = '"visuals"\n{\n\t"asset_modifier0" { "type" "persona" "persona" "1" }\n'
    + '\t"asset_modifier1" { "type" "entity_model" "asset" "npc_dota_hero_crystal_maiden" "modifier" "models/heroes/crystal_maiden_persona/crystal_maiden_persona.vmdl" }\n}';
  assert.equal(entityModel(block, 'npc_dota_hero_crystal_maiden'), 'models/heroes/crystal_maiden_persona/crystal_maiden_persona.vmdl');
  assert.equal(entityModel(block, 'npc_dota_hero_lina'), null);
  assert.equal(entityModel('"asset_modifier" { "type" "entity_model" "asset" "npc_dota_hero_lina" "modifier" "particles/x.vpcf" }', 'npc_dota_hero_lina'), null, 'a body is a model');
});

test('every clip of a body comes as its file, and a body the game lacks as null', async () => {
  const { hp, asked } = preview([], { have: (m) => m === 'models/heroes/axe/axe.vmdl' });
  const bytes = await hp.motions('models/heroes/axe/axe.vmdl');
  assert.ok(bytes && bytes.length > 0);
  assert.equal(asked.at(-1)?.clips, 'all');
  assert.equal(await hp.motions('models/heroes/nobody/nobody.vmdl'), null);
});
