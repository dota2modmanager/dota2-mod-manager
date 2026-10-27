/* Refits (src/item-builder-refits.ts): a pick worn with an item that makes its model again for
 * another body wears the refit, as the game does, and keeps its stock path over the other item's
 * swap of the stock model there.
 *
 * The report of 2026-10-27: under Faceless Void's arcana his picked arms, shoulders and belt were
 * broken, and Drow's Dread Retribution bow was gone in the menu and shrunk in a match. The table
 * here is Void's in small: his stock bracers, a paid pair, and an arcana that refits both. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as builder from '../src/item-builder.ts';
import { pickModels, refitsOf } from '../src/item-builder-refits.ts';
import { createTableBuild } from '../src/schema-build.ts';
import { buildVpk, entryPath } from '../src/vpk.ts';
import { drain } from '../src/steps.ts';
import type { LibRecord } from '../src/types.ts';
import { entry } from './helpers/vpk-entry.ts';

const VOID = `\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_faceless_void"\t\t"1"\n\t\t\t}\n`;
const STOCK = 'models/heroes/faceless_void/faceless_void_bracer.vmdl';
const PAID = 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons.vmdl';
const mod = (type: string, asset: string, modifier: string, style = '') => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"${type}"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n${style ? `\t\t\t\t\t"style"\t\t"${style}"\n` : ''}\t\t\t\t}\n`;
const item = (id: string, name: string, prefab: string, slot: string, body: string) =>
  `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"${prefab}"\n\t\t\t"item_slot"\t\t"${slot}"\n${body}${VOID}\t\t}\n`;

function voidTable() {
  const styles = `\t\t\t\t"styles"\n\t\t\t\t{\n\t\t\t\t\t"0"\n\t\t\t\t\t{\n\t\t\t\t\t}\n\t\t\t\t\t"1"\n\t\t\t\t\t{\n\t\t\t\t\t}\n\t\t\t\t}\n`;
  return `"items_game"\n{\n\t"items"\n\t{\n${[
    item('901', "Faceless Void's Bracers", 'default_item', 'arms', `\t\t\t"model_player"\t\t"${STOCK}"\n`),
    item('902', "Faceless Void's Head", 'default_item', 'head', `\t\t\t"model_player"\t\t"models/heroes/faceless_void/faceless_void_head.vmdl"\n`),
    item('7816', 'Bracers of Aeons', 'wearable', 'arms', `\t\t\t"model_player"\t\t"${PAID}"\n`),
    item('18033', 'Claszian Apostasy Head', 'wearable', 'head', `\t\t\t"model_player"\t\t"models/heroes/faceless_void/faceless_void_head.vmdl"\n\t\t\t"visuals"\n\t\t\t{\n${
      mod('model', STOCK, 'models/heroes/faceless_void/faceless_void_bracer_refit.vmdl')
      + mod('model', PAID, 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons_refit.vmdl')
      // a swap of the second style only: the first style's pick does not make it
      + mod('model', 'models/items/faceless_void/other/other.vmdl', 'models/items/faceless_void/other/other_refit.vmdl', '1')
      + styles}\t\t\t}\n`),
  ].join('')}\t}\n}\n`;
}

const pick = (itemId: string, slot: string): LibRecord => ({
  id: `pick-${itemId}`, name: `pick ${itemId}`, categoryId: 'cosmetic', slot: `item:faceless_void:${slot}`, itemId, enabled: true,
} as LibRecord);

/** A game folder whose pak has each model as a file saying which it is. */
function gameWithModels(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-refits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  const models = [STOCK, PAID, 'models/heroes/faceless_void/faceless_void_bracer_refit.vmdl', 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons_refit.vmdl'];
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk(models.map((m) => entry(`${m}_c`, path.basename(m)))));
  return dir;
}

/** What the build puts at a path: the file of the first patch that has one, as schema.deploy keeps it. */
function builtAt(text: string, game: string, recs: LibRecord[], at: string): string | undefined {
  const build = createTableBuild({ library: { list: () => recs }, log: () => {} });
  const { list } = drain(build.buildSteps(text, game));
  const hit = list.flatMap((p) => p.assets || []).find((e) => entryPath(e) === at);
  return hit?.data.toString();
}

test("a pick takes the refit another pick makes of its model, not its own item's, and only in that item's style", () => {
  const text = voidTable();
  const models = new Map([['paid', pickModels(text, '7816', null)!], ['arcana', pickModels(text, '18033', null)!]]);
  assert.equal(models.get('paid')!.model, PAID);
  assert.equal(models.get('arcana')!.swaps.has('models/items/faceless_void/other/other.vmdl'), false, "the second style's swap is not the first's");
  assert.equal(pickModels(text, '18033', 'style-1')!.swaps.get('models/items/faceless_void/other/other.vmdl'), 'models/items/faceless_void/other/other_refit.vmdl');
  assert.deepEqual([...refitsOf(models)], [['paid', 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons_refit.vmdl']]);
  assert.equal(refitsOf(new Map([['paid', models.get('paid')!]])).size, 0, 'the bracers alone wear their own model');
});

test('a refit goes under the stock path ahead of the plain model, which stays for a game without it', () => {
  const patched = builder.itemEffectPatch(voidTable(), '7816', null, undefined, undefined, 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons_refit.vmdl');
  assert.equal(patched.own, `${STOCK}_c`);
  assert.deepEqual(patched.assetCopies.slice(0, 2), [
    { from: 'models/items/faceless_void/bracers_of_aeons/bracers_of_aeons_refit.vmdl', to: STOCK, optional: true },
    { from: PAID, to: STOCK },
  ]);
});

test("the picked bracers are worn refitted under the arcana, whichever was picked first, and plain without it", (t) => {
  const text = voidTable();
  const game = gameWithModels(t);
  const at = `${STOCK}_c`;
  const refit = 'bracers_of_aeons_refit.vmdl';
  assert.equal(builtAt(text, game, [pick('18033', 'head'), pick('7816', 'arms')], at), refit, 'not the stock refit the arcana makes');
  assert.equal(builtAt(text, game, [pick('7816', 'arms'), pick('18033', 'head')], at), refit);
  assert.equal(builtAt(text, game, [pick('7816', 'arms')], at), 'bracers_of_aeons.vmdl');
  assert.equal(builtAt(text, game, [pick('18033', 'head')], at), 'faceless_void_bracer_refit.vmdl', 'no bracers picked: the stock ones refitted');
});
