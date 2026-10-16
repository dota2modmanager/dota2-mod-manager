/* The item-schema service (src/schema-service.ts) against a throwaway game folder.
 *
 * It is the one place that edits files of the game install itself: the search-path patch in
 * gameinfo, its line in dota.signatures, and the built item table in the mod folder. Until these
 * tests it was exercised only through two item-builder tests, at 46% of its lines, while it
 * decides when the game is written to and how a Dota update is repaired. Three promises matter
 * most: nothing reaches the game until the user switches the patch on; switching it off puts
 * Valve's files back byte for byte; and the table is always rebuilt from the game's own.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as patcher from '../src/patcher.ts';
import * as schema from '../src/schema.ts';
import { entryAt, readVpkEntryFile } from '../src/vpk.ts';
import { encodeKv3, resource } from './helpers/kv3-build.ts';
import { Library } from '../src/library.ts';
import { buildBar, builderStamp, createSchemaService, type BuildStep, type SchemaInstaller } from '../src/schema-service.ts';
import type { Settings } from '../src/settings.ts';
import type { LibFile, LibRecord } from '../src/types.ts';

const GAMEINFO = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_AudioLanguage	dota_*LANGUAGE*
			Game				dota
			Game				core
			Mod					dota
			Write				dota
		}
	}
}
`;
const BRANCH = Buffer.from('"GameInfo"\r\n{\r\n\tgame \t\t"Dota 2"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t}\r\n}\r\n', 'latin1');

const item = (id: string, lines: string[]) => [`\t\t"${id}"`, '\t\t{', ...lines.map((l) => `\t\t\t${l}`), '\t\t}'].join('\n');
const table = (blocks: string[]) => ['"items_game"', '{', '\t"items"', '\t{', ...blocks, '\t}', '}', ''].join('\n');
const WEATHER = item('555', ['"name"\t\t"Default Weather"', '"prefab"\t\t"weather"', '"baseitem"\t\t"1"']);
const SNOW = item('4000', ['"name"\t\t"Weather Snow"', '"prefab"\t\t"weather"', '"visuals"', '{', '}']);
const RIFLE = item('100', ['"name"\t\t"Sniper\'s Rifle"', '"prefab"\t\t"default_item"']);
// The merge refuses a table of fewer than a thousand items before it reaches the game, as a cut
// short or mangled one would be; the real one holds about twenty-five thousand.
const FILLER = Array.from({ length: 1000 }, (_, i) => item(String(10000 + i), [`"name"\t\t"Filler ${i}"`, '"prefab"\t\t"wearable"']));
const GAME_TABLE = table([WEATHER, SNOW, RIFLE, ...FILLER]);

/** A mod's change to the rifle, as the importer lifts it out of the mod's own table. */
const riflePatch = (model: string) => ({
  id: '100', name: "Sniper's Rifle",
  block: `"100"\r\n{\r\n\t"name"\t\t"Sniper's Rifle"\r\n\t"prefab"\t\t"default_item"\r\n\t"model_player"\t\t"${model}"\r\n}`,
});

/** A game folder in the Windows shape, its signature list naming the branch file as Valve shipped it. */
function game(t: TestContext, text = GAME_TABLE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-schemasvc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'game');
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'gameinfo.gi'), GAMEINFO);
  fs.writeFileSync(patcher.paths(dir).branch, BRANCH);
  const { sha1, crc } = patcher.fileHashes(BRANCH);
  const sig = patcher.paths(dir).signatures;
  fs.mkdirSync(path.dirname(sig), { recursive: true });
  fs.writeFileSync(sig, `..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}\r\nDIGEST:${'C'.repeat(40)}\r\n`);
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(text));
  return { root, game: dir, userData: path.join(root, 'userdata') };
}

const bytes = (file: string) => fs.readFileSync(file);
const deployedTable = (g: string) => {
  const hit = readVpkEntryFile(path.join(g, patcher.FOLDER, schema.SCHEMA_VPK), schema.SCHEMA_REL);
  return hit ? hit.data.toString('latin1') : null;
};

function settingsIn(values: Record<string, unknown>) {
  return {
    get: (k: string) => values[k],
    set: (k: string, v: unknown) => { values[k] = v; },
  } as unknown as Pick<Settings, 'get' | 'set'>;
}

const NO_INSTALLER: SchemaInstaller = {
  analyzeRecord: () => { throw new Error('the installer was not meant to be asked'); },
  harvestSchema: () => { throw new Error('the installer was not meant to be asked'); },
  splitVpkFile: () => { throw new Error('the installer was not meant to be asked'); },
  remove: () => { throw new Error('the installer was not meant to be asked'); },
  installedSize: () => { throw new Error('the installer was not meant to be asked'); },
};

function service(t: TestContext, { values = {}, installer = NO_INSTALLER, text = GAME_TABLE, bases, onBuild } = {} as {
  values?: Record<string, unknown>; installer?: SchemaInstaller; text?: string; bases?: Parameters<typeof createSchemaService>[0]['bases'];
  onBuild?: Parameters<typeof createSchemaService>[0]['onBuild'];
}) {
  const g = game(t, text);
  fs.mkdirSync(g.userData, { recursive: true });
  const library = new Library(g.userData);
  const settings = settingsIn({ dotaGamePath: g.game, schemaPatch: false, ...values });
  const said: string[] = [];
  const svc = createSchemaService({ settings, library, installer, userDataDir: g.userData, log: (m) => said.push(m), bases, onBuild });
  return { ...g, library, settings, svc, said };
}

const VPK_FILE: LibFile = { root: 'lang', relPath: 'pak30_dir.vpk' };

/** A mod in the library whose item blocks were lifted on install. */
function modWith(library: Library, name: string, blocks: ReturnType<typeof riflePatch>[]) {
  const rec = library.add({ name, categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: [VPK_FILE] });
  return library.update(rec.id, { schema: blocks }) as LibRecord;
}

// ---------- the game is written only when the user asked ----------

test('nothing reaches the game while the patch is off, whatever the library holds', (t) => {
  const s = service(t);
  modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  const before = { info: bytes(path.join(s.game, 'dota', 'gameinfo.gi')), branch: bytes(patcher.paths(s.game).branch) };

  assert.deepEqual(s.svc.refresh(), { ok: true, deployed: false, patches: 0 });
  assert.equal(schema.isDeployed(s.game, patcher.FOLDER), false);
  assert.deepEqual(bytes(path.join(s.game, 'dota', 'gameinfo.gi')), before.info);
  assert.deepEqual(bytes(patcher.paths(s.game).branch), before.branch);
});

test('switching the patch on builds the table from the game\'s own, and off puts Valve\'s files back byte for byte', (t) => {
  const s = service(t);
  modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  const sig = patcher.paths(s.game).signatures;
  const before = { info: bytes(path.join(s.game, 'dota', 'gameinfo.gi')), branch: bytes(patcher.paths(s.game).branch), sig: bytes(sig) };

  const on = s.svc.setEnabled(true) as { ok: boolean; deployed?: boolean; patches?: number };
  assert.equal(on.ok, true);
  assert.equal(on.deployed, true);
  assert.equal(on.patches, 1);
  const st = s.svc.state();
  assert.equal(st.enabled, true);
  assert.equal(st.patched, true);
  assert.equal(st.signed, true, 'the patch is signed into the list the build shipped');
  assert.equal(st.deployed, true);
  assert.equal(st.stale, false);
  assert.equal(st.mods, 1);
  // the mod's block, in the game's whole table: the other items are still there
  const built = deployedTable(s.game) as string;
  assert.match(built, /models\/mod\/rifle\.vmdl/);
  const ids = schema.listItems(built).map((i) => i.id);
  assert.equal(ids.length, 1003);
  assert.ok(['100', '4000', '555'].every((id) => ids.includes(id)));

  assert.deepEqual(s.svc.setEnabled(false), { ok: true, deployed: false });
  assert.equal(schema.isDeployed(s.game, patcher.FOLDER), false);
  assert.deepEqual(bytes(path.join(s.game, 'dota', 'gameinfo.gi')), before.info);
  assert.deepEqual(bytes(patcher.paths(s.game).branch), before.branch);
  assert.deepEqual(bytes(sig), before.sig);
  assert.equal(s.settings.get('schemaPatch'), false);
  assert.equal(s.settings.get('schemaStamp'), null);
});

test('a mod switched off leaves the table, and with nothing left the table goes', (t) => {
  const s = service(t, { values: { schemaPatch: true } });
  const a = modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  s.svc.setEnabled(true);
  assert.equal(schema.isDeployed(s.game, patcher.FOLDER), true);

  s.library.setEnabled(a.id, false);
  assert.deepEqual(s.svc.refresh(), { ok: true, deployed: false, patches: 0 });
  assert.equal(schema.isDeployed(s.game, patcher.FOLDER), false, 'an empty table is not written');
  assert.equal(s.svc.state().mods, 0);
});

// ---------- a Dota update ----------

test('a game update is noticed, and repaired: the patch put back and the table rebuilt on the new one', (t) => {
  const s = service(t);
  modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  s.svc.setEnabled(true);

  // the update: a new item table, and gameinfo rewritten without our line
  const AXE = item('200', ['"name"\t\t"Axe\'s Axe"', '"prefab"\t\t"default_item"']);
  fs.writeFileSync(path.join(s.game, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(table([WEATHER, SNOW, RIFLE, AXE, ...FILLER])));
  fs.writeFileSync(path.join(s.game, 'dota', 'gameinfo.gi'), GAMEINFO);
  fs.writeFileSync(patcher.paths(s.game).branch, BRANCH);
  assert.equal(s.svc.state().stale, true, 'the built table no longer matches the game');

  const healed = s.svc.heal();
  assert.equal(healed.ok, true);
  assert.deepEqual(healed.healed, ['patch', 'schema']);
  const st = s.svc.state();
  assert.equal(st.patched, true);
  assert.equal(st.stale, false);
  const built = deployedTable(s.game) as string;
  assert.ok(schema.listItems(built).some((i) => i.id === '200'), 'rebuilt on the new table, with the item the update added');
  assert.match(built, /models\/mod\/rifle\.vmdl/, 'and the mod still in it');

  assert.deepEqual(s.svc.heal(), { ok: true, healed: [] }, 'a second look finds nothing to do');
});

test('a table built by older code is rebuilt at the next start or launch, the game unchanged', (t) => {
  // the picks kept the files the old item builder made, until each was taken off and picked again
  const s = service(t);
  modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  s.svc.setEnabled(true);
  assert.deepEqual(s.svc.heal(), { ok: true, healed: [] });
  const built = String(s.settings.get('schemaStamp'));
  assert.ok(built.endsWith(`|${builderStamp()}`), 'the stamp names the code as well as the game');
  s.settings.set('schemaStamp', built.replace(/\|[^|]+$/, '|older'));
  assert.equal(s.svc.state().stale, true);
  assert.deepEqual(s.svc.heal(), { ok: true, healed: ['schema'] });
  assert.equal(s.settings.get('schemaStamp'), built);
});

test("the code's fingerprint follows its files", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-code-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'not code');
  const before = builderStamp(dir);
  fs.writeFileSync(path.join(dir, 'notes.md'), 'still not code');
  assert.equal(builderStamp(dir), before);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'two');
  assert.notEqual(builderStamp(dir), before);
  assert.equal(builderStamp(path.join(dir, 'missing')), null, 'unreadable: nothing to compare, nothing rebuilt for it');
});

test('a signed patch built from an older gameinfo.gi is rebuilt from the new one', (t) => {
  // Build 6946: gameinfo.gi renamed the language key, the branch file was not in the update, and
  // the signature list did not lose our line. Nothing but the search paths themselves changed.
  const s = service(t, { values: { schemaPatch: true } });
  fs.writeFileSync(path.join(s.game, 'dota', 'gameinfo.gi'), GAMEINFO.replace('Game_AudioLanguage\t', 'Game_Language\t\t'));
  modWith(s.library, 'Rifle mod', [riflePatch('models/mod/rifle.vmdl')]);
  s.svc.setEnabled(true);
  fs.writeFileSync(path.join(s.game, 'dota', 'gameinfo.gi'), GAMEINFO);
  assert.equal(s.svc.state().signed, true);
  assert.equal(patcher.state(s.game, patcher.FOLDER).outdated, true);

  assert.deepEqual(s.svc.heal(), { ok: true, healed: ['patch'] });
  assert.match(fs.readFileSync(patcher.paths(s.game).branch, 'latin1'), /Game_AudioLanguage/);
  assert.equal(patcher.state(s.game, patcher.FOLDER).outdated, false);
  assert.deepEqual(s.svc.heal(), { ok: true, healed: [] }, 'and then there is nothing left to do');
});

test('in safe mode a branch file that is not what Valve signed is put back from the backup', (t) => {
  const s = service(t);
  const branch = patcher.paths(s.game).branch;
  const original = bytes(branch);
  // The patch was on once, so the backup of Valve's file exists. An older version of the app
  // then put the file back a tab short, and the client refuses an install it cannot verify.
  patcher.apply({ gamePath: s.game, folder: patcher.FOLDER, backupDir: s.svc.backupDir });
  fs.writeFileSync(branch, Buffer.from(BRANCH.toString('latin1').replace('\r\n\t}\r\n}\r\n', '\r\n}\r\n}\r\n'), 'latin1'));
  assert.equal(patcher.state(s.game, patcher.FOLDER).vanillaOk, false);

  assert.deepEqual(s.svc.heal(), { ok: true, healed: ['vanilla'] });
  assert.deepEqual(bytes(patcher.paths(s.game).branch), original);
  assert.deepEqual(s.svc.heal(), { ok: true, healed: [] }, 'nothing left to repair');
});

// ---------- what goes into the table ----------

test('two mods changing one item differently are a conflict; the same change twice is not', (t) => {
  const s = service(t);
  const a = modWith(s.library, 'Mod A', [riflePatch('models/a.vmdl')]);
  modWith(s.library, 'Mod B', [riflePatch('models/b.vmdl')]);
  assert.deepEqual(s.svc.state().conflicts, [{ id: '100', name: "Sniper's Rifle", mods: ['Mod A', 'Mod B'] }]);

  s.library.setEnabled(a.id, false);
  assert.deepEqual(s.svc.state().conflicts, [], 'a switched-off mod argues with nobody');

  // Skinchanger bundles the whole cart into every export, so two packs often carry one block
  modWith(s.library, 'Mod C', [riflePatch('models/b.vmdl')]);
  assert.deepEqual(s.svc.state().conflicts, []);
});

test('a free cosmetic picked before picks were records moves into the library once', (t) => {
  const s = service(t, { values: { cosmetics: { weather: '4000' } } });
  const before = s.svc.cosmeticSlots();
  assert.deepEqual(before.slots.find((x) => x.slot === 'weather')?.options, [{ id: '4000', name: 'Weather Snow' }]);
  assert.equal(before.slots.find((x) => x.slot === 'weather')?.picked, null);

  s.svc.migrateCosmeticSettings();
  const picks = s.library.list().filter((r) => r.categoryId === 'cosmetic');
  assert.deepEqual(picks.map((r) => [r.slot, r.itemId, r.name]), [['weather', '4000', 'Weather Snow']]);
  assert.deepEqual(s.settings.get('cosmetics'), {});
  assert.equal(s.svc.cosmeticSlots().slots.find((x) => x.slot === 'weather')?.picked, '4000');

  // and with the patch on, the pick is the default weather dressed as the snow
  s.svc.setEnabled(true);
  const built = deployedTable(s.game) as string;
  const weather = schema.listItems(built).find((i) => i.id === '555');
  assert.equal(weather?.name, 'Default Weather');
  assert.equal(s.svc.state().cosmeticsPicked, 1);
});

test('a pick whose donor the game no longer has is left out, and the log says which', (t) => {
  const s = service(t);
  const rec = s.library.add({ name: 'Gone Rifle', categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [] });
  s.library.update(rec.id, { slot: 'item:sniper:weapon', itemId: '99999' });
  assert.deepEqual(s.svc.patches(GAME_TABLE, s.game), []);
  assert.equal(s.said.length, 1);
  assert.match(s.said[0], /Gone Rifle left out of the build/);
});

// ---------- a mod's own tables, lifted and split ----------

test('a mod\'s changed blocks are kept on its record, and its original fingerprint with them', (t) => {
  const delta = riflePatch('models/mod/rifle.vmdl');
  let harvested: { deltas: typeof delta[]; stripped: string[] } = { deltas: [delta], stripped: ['pak30_dir.vpk'] };
  const installer: SchemaInstaller = {
    ...NO_INSTALLER,
    analyzeRecord: () => ({ fp: 'fp-before-repack' }),
    harvestSchema: () => harvested,
  };
  const s = service(t, { installer });
  const rec = s.library.add({ name: 'Skinchanger pack', categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: [VPK_FILE] });

  assert.deepEqual(s.svc.harvest(rec), { deltas: 1, stripped: 1 });
  const kept = s.library.find(rec.id) as LibRecord;
  assert.deepEqual(kept.schema, [delta]);
  assert.equal(kept.fpOriginal, 'fp-before-repack', 'repacking changed the file, so the catalog match keeps the old print');

  harvested = { deltas: [], stripped: [] };
  const clean = s.library.add({ name: 'Clean mod', categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: [VPK_FILE] });
  assert.equal(s.svc.harvest(clean), null);
  assert.equal(s.library.find(clean.id)?.schema, undefined);
  assert.equal(s.svc.harvest(null), null);
});

test('a pack of two heroes splits in two, each part keeping only the blocks about its own files', (t) => {
  const grim = { id: '300', name: 'Grimstroke Brush', block: '"300"\r\n{\r\n\t"model_player"\t\t"models/heroes/grimstroke/brush.vmdl"\r\n}' };
  const morph = { id: '301', name: 'Morphling Arm', block: '"301"\r\n{\r\n\t"model_player"\t\t"models/heroes/morphling/arm.vmdl"\r\n}' };
  const removed: LibFile[][] = [];
  const installer: SchemaInstaller = {
    ...NO_INSTALLER,
    splitVpkFile: () => [
      { name: 'Grimstroke', files: [{ root: 'lang', relPath: 'pak31_dir.vpk' }], paths: ['models/heroes/grimstroke/brush.vmdl_c'] },
      { name: 'Morphling', files: [{ root: 'lang', relPath: 'pak32_dir.vpk' }], paths: ['models/heroes/morphling/arm.vmdl_c'] },
    ],
    remove: (files) => { removed.push(files); },
  };
  const s = service(t, { installer });
  const pack = s.library.add({ name: 'Cart export', categoryId: 'imported', styleLabel: null, fileRef: 'cart.vpk', preview: null, files: [VPK_FILE] });
  s.library.update(pack.id, { schema: [grim, morph], fpOriginal: 'fp-of-the-pack' });

  const parts = s.svc.split(s.library.find(pack.id) as LibRecord) as LibRecord[];
  assert.deepEqual(parts.map((p) => [p.name, (p.schema || []).map((b) => b.id)]), [['Grimstroke', ['300']], ['Morphling', ['301']]]);
  assert.ok(parts.every((p) => p.schemaChecked && p.fpOriginal === 'fp-of-the-pack'));
  assert.equal(s.library.find(pack.id), null, 'the pack itself is gone');
  assert.deepEqual(removed, [[VPK_FILE]], 'and so are its files');

  const noVpk = s.library.add({ name: 'Font', categoryId: 'fonts', styleLabel: null, fileRef: null, preview: null, files: [{ root: 'fonts', relPath: 'a.ttf' }] });
  assert.equal(s.svc.split(noVpk), null, 'a record with no VPK has nothing to split');
});

test('mods from before the harvest are swept once, and a clean one is not looked at again', (t) => {
  let sizes = [10 * 1048576, 4 * 1048576];
  const asked: string[] = [];
  const installer: SchemaInstaller = {
    ...NO_INSTALLER,
    analyzeRecord: () => ({ fp: null }),
    harvestSchema: (files) => {
      asked.push(files[0].relPath);
      return files[0].relPath === 'pak30_dir.vpk' ? { deltas: [riflePatch('models/m.vmdl')], stripped: ['pak30_dir.vpk'] } : { deltas: [], stripped: [] };
    },
    installedSize: () => sizes.shift() ?? 0,
  };
  const s = service(t, { installer });
  const add = (name: string, relPath: string) => s.library.add({ name, categoryId: 'imported', styleLabel: null, fileRef: null, preview: null, files: [{ root: 'lang', relPath }] });
  const old = add('Old export', 'pak30_dir.vpk');
  const clean = add('Clean mod', 'pak31_dir.vpk');
  add('Not a VPK', 'readme.txt');

  assert.deepEqual(s.svc.migrate(), { scanned: 2, changed: 1, deltas: 1, freedMB: 6 });
  assert.equal(s.library.find(old.id)?.schemaChecked, true);
  assert.equal(s.library.find(clean.id)?.schemaChecked, true);
  sizes = [];
  asked.length = 0;
  assert.deepEqual(s.svc.migrate(), { scanned: 0, changed: 0, deltas: 0, freedMB: 0 });
  assert.deepEqual(asked, [], 'nothing is read a second time');
});

// ---------- without a game ----------

test('without a game path nothing is attempted, and the answers say so', (t) => {
  const s = service(t, { values: { dotaGamePath: null } });
  assert.deepEqual(s.svc.refresh(), { ok: false, reason: 'no-game-path' });
  assert.deepEqual(s.svc.heal(), { ok: true, healed: [] });
  assert.deepEqual(s.svc.setEnabled(true), { error: 'no-game-path' });
  assert.deepEqual(s.svc.cosmeticSlots(), { slots: [], sets: [] });
  assert.deepEqual(s.svc.migrate(), { scanned: 0, changed: 0, deltas: 0, freedMB: 0 });
  const st = s.svc.state();
  assert.equal(st.deployed, false);
  assert.equal(st.patched, false);
});

// ---------- an item's sounds, voice and styles ----------

/** Earthshaker's stock arms and an immortal for them with two styles, a sound swap and a voice. */
const ES = ['"used_by_heroes"', '{', '\t"npc_dota_hero_earthshaker"\t\t"1"', '}'];
const STYLED_TABLE = table([
  item('700', ['"name"\t\t"Earthshaker\'s Bracers"', '"prefab"\t\t"default_item"', '"item_slot"\t\t"arms"', ...ES]),
  item('7293', ['"name"\t\t"Bracers of the Cavern Luminar"', '"prefab"\t\t"wearable"', '"item_slot"\t\t"arms"', ...ES, '"visuals"', '{',
    '\t"styles"', '\t{', '\t\t"0"', '\t\t{', '\t\t\t"name"\t\t"#DOTA_Style_Luminar_0"', '\t\t}', '\t\t"1"', '\t\t{', '\t\t\t"name"\t\t"#DOTA_Style_Gone"', '\t\t}', '\t}',
    '\t"asset_modifier"', '\t{', '\t\t"type"\t\t"sound"', '\t\t"asset"\t\t"Hero_EarthShaker.Totem"', '\t\t"modifier"\t\t"Hero_EarthShaker.Totem.Immortal"', '\t}',
    '\t"asset_modifier"', '\t{', '\t\t"type"\t\t"response_criteria"', '\t\t"asset"\t\t"luminar"', '\t}',
    '}']),
  ...FILLER,
]);
const soundFile = (events: [string, string][]) => resource([['DATA', encodeKv3({ obj: events.map(([name, file]) => [name, { obj: [['vsnd_files', { arr: [{ str: file }] }]] }]) })]]);

test("a pick's sounds go into the built table's pak, its styles are named from the game, and a broken file costs only the sounds", (t) => {
  const s = service(t, { values: { schemaPatch: true }, text: STYLED_TABLE });
  const pak = (rules: Buffer) => fs.writeFileSync(path.join(s.game, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(STYLED_TABLE, [
    entryAt('resource/localization/dota_english.txt', Buffer.from('"lang"\n{\n\t"Tokens"\n\t{\n\t\t"DOTA_Style_Luminar_0"\t"Celestial Wisdom"\n\t}\n}\n')),
    entryAt('soundevents/game_sounds_heroes/game_sounds_earthshaker.vsndevts_c', soundFile([['Hero_EarthShaker.Totem', 'sounds/totem.vsnd']])),
    entryAt('soundevents/game_sounds_items.vsndevts_c', soundFile([['Hero_EarthShaker.Totem.Immortal', 'sounds/totem_immortal.vsnd']])),
    entryAt('scripts/talker/response_rules_earthshaker.vrr_c', rules),
  ]));
  pak(resource([['DATA', encodeKv3({ obj: [['m_Requirements', { arr: [] }], ['m_ResponseGroups', { arr: [] }]] })]]));

  const bracers = s.svc.cosmeticSlots().slots.flatMap((x) => x.options as { id: string; styles?: string[] }[]).find((o) => o.id === '7293');
  assert.deepEqual(bracers?.styles, ['Celestial Wisdom', 'Style 2'], "the game's name, or the style's number where the game has none");

  s.svc.pickCosmetic('item:earthshaker:arms', '7293', 'Bracers of the Cavern Luminar', 'style-1');
  const built = path.join(s.game, patcher.FOLDER, schema.SCHEMA_VPK);
  const totem = readVpkEntryFile(built, 'soundevents/game_sounds_heroes/game_sounds_earthshaker.vsndevts_c');
  assert.ok(totem, 'the hero sound file goes in beside the table');
  assert.match(totem.data.toString('latin1'), /totem_immortal\.vsnd/, 'its totem plays the immortal one');

  // a rules file the reader cannot open: the pick still goes on, without its sounds, and the log says so
  pak(Buffer.from('not a resource'));
  s.svc.pickCosmetic('item:earthshaker:arms', '7293', 'Bracers of the Cavern Luminar', '');
  assert.equal(readVpkEntryFile(built, 'soundevents/game_sounds_heroes/game_sounds_earthshaker.vsndevts_c'), null);
  assert.match(deployedTable(s.game) as string, /Bracers of the Cavern Luminar/);
  assert.ok(s.said.some((m) => /sounds left out of the build/.test(m)), s.said.join('\n'));
});

// ---------- an arcana base under the picks ----------

/** Juggernaut's stock body, mask and sword, Bladeform Legacy (9059), its mask (30261) and another sword (4015). */
const JUGG = ['"used_by_heroes"', '{', '\t"npc_dota_hero_juggernaut"\t\t"1"', '}'];
const wear = (id: string, name: string, prefab: string, slot: string, model: string) =>
  item(id, [`"name"\t\t"${name}"`, `"prefab"\t\t"${prefab}"`, `"item_slot"\t\t"${slot}"`, `"model_player"\t\t"${model}"`, ...JUGG]);
const ARCANA_TABLE = table([
  wear('800', "Juggernaut's Body", 'default_item', 'body', 'models/heroes/juggernaut/juggernaut_body.vmdl'),
  wear('801', "Juggernaut's Mask", 'default_item', 'head', 'models/heroes/juggernaut/jugg_mask.vmdl'),
  wear('802', "Juggernaut's Sword", 'default_item', 'weapon', 'models/heroes/juggernaut/jugg_sword.vmdl'),
  wear('9059', 'Bladeform Legacy', 'wearable', 'body', 'models/items/juggernaut/arcana_body.vmdl'),
  wear('30261', 'Bladeform Legacy - Mask', 'wearable', 'head', 'models/items/juggernaut/arcana_mask.vmdl'),
  wear('4015', 'Four-Fangs the Swordbreaker', 'wearable', 'weapon', 'models/items/juggernaut/four_fangs.vmdl'),
  ...FILLER,
]);
const VALVE = {
  'models/items/juggernaut/arcana_body.vmdl_c': "Valve's arcana body",
  'models/items/juggernaut/arcana_mask.vmdl_c': "Valve's arcana mask",
  'models/items/juggernaut/four_fangs.vmdl_c': 'Four-Fangs',
};
const BASE = {
  'models/heroes/juggernaut/juggernaut_body.vmdl_c': 'fixed body',
  'models/heroes/juggernaut/jugg_mask.vmdl_c': 'fixed mask',
  'models/heroes/juggernaut/jugg_sword.vmdl_c': "the arcana's sword",
};

test('an arcana picked puts its base on once it is here, its own part takes the fixed one, and another item wins its slot', (t) => {
  let here = false;
  const wanted: string[] = [];
  const bases = {
    entries: (id: string) => (here && id === 'bladeform_legacy' ? Object.entries(BASE).map(([p, d]) => entryAt(p, Buffer.from(d))) : null),
    want: async (id: string) => { wanted.push(id); return false; },
  };
  const s = service(t, { values: { schemaPatch: true }, text: ARCANA_TABLE, bases });
  fs.writeFileSync(path.join(s.game, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(ARCANA_TABLE,
    Object.entries(VALVE).map(([p, d]) => entryAt(p, Buffer.from(d)))));
  const built = (p: string) => readVpkEntryFile(path.join(s.game, patcher.FOLDER, schema.SCHEMA_VPK), p)?.data.toString() ?? null;

  s.svc.pickCosmetic('item:juggernaut:body', '9059', 'Bladeform Legacy', '');
  assert.deepEqual(wanted, ['bladeform_legacy'], 'asked for');
  assert.equal(built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), "Valve's arcana body", "not here yet: the game's files, no waiting");
  assert.ok(s.said.some((m) => /bladeform_legacy is not here yet/.test(m)));

  here = true;
  s.svc.pickCosmetic('item:juggernaut:head', '30261', 'Bladeform Legacy - Mask', '');
  assert.equal(built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), 'fixed body');
  assert.equal(built('models/heroes/juggernaut/jugg_mask.vmdl_c'), 'fixed mask', "the arcana's own part: the base's, not Valve's");
  assert.equal(built('models/heroes/juggernaut/jugg_sword.vmdl_c'), "the arcana's sword", 'a slot nothing was picked for: the base fills it');

  s.svc.pickCosmetic('item:juggernaut:weapon', '4015', 'Four-Fangs the Swordbreaker', '');
  assert.equal(built('models/heroes/juggernaut/jugg_sword.vmdl_c'), 'Four-Fangs', 'another item for a slot: the user picked it');
  assert.equal(built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), 'fixed body', 'and the arcana stays under it');

  s.library.setEnabled(s.library.list().find((r) => r.itemId === '9059')!.id, false);
  s.svc.refresh();
  assert.equal(built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), null, 'the arcana off: its base goes with it');
  assert.equal(built('models/heroes/juggernaut/jugg_mask.vmdl_c'), "Valve's arcana mask", 'and the mask alone is Valve\'s again');
});

// ---------- building in the background ----------

/** The Juggernaut table with Valve's files in the game's pak, for the builder's picks. */
function juggernaut(t: TestContext) {
  const steps: (BuildStep | null)[] = [];
  const s = service(t, { values: { schemaPatch: true }, text: ARCANA_TABLE, onBuild: (step) => steps.push(step) });
  fs.writeFileSync(path.join(s.game, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(ARCANA_TABLE,
    Object.entries(VALVE).map(([p, d]) => entryAt(p, Buffer.from(d)))));
  const built = (p: string) => readVpkEntryFile(path.join(s.game, patcher.FOLDER, schema.SCHEMA_VPK), p)?.data.toString() ?? null;
  const counts = () => steps.filter((x) => x && 'total' in x);
  const writes = () => steps.filter((x) => x && 'stage' in x && x.stage === 'packed').length;
  const pick = (slot: string, id: string) => s.svc.pickCosmetic(`item:juggernaut:${slot}`, id, id, '', { write: false });
  return { ...s, steps, built, counts, writes, pick };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a build in the background builds only the picks it has not built yet, says how far it is, and answers once the table is written', async (t) => {
  const s = juggernaut(t);
  s.pick('body', '9059');
  const r = await s.svc.refreshInBackground();
  assert.equal(r.ok, true);
  assert.equal(r.deployed, true);
  assert.equal(s.built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), "Valve's arcana body", 'written by the time it answers');
  assert.deepEqual(s.counts(), [{ done: 1, total: 1 }]);
  assert.deepEqual(s.steps.slice(-4), [{ stage: 'merged' }, { stage: 'checked' }, { stage: 'packed' }, null], 'the write in stages, then the end');

  s.steps.length = 0;
  s.pick('weapon', '4015');
  await s.svc.refreshInBackground();
  assert.deepEqual(s.counts(), [{ done: 1, total: 1 }], 'the body was built before: only the sword is built now');
  assert.equal(s.built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), "Valve's arcana body", 'and the body is still in the table');
  assert.equal(s.built('models/heroes/juggernaut/jugg_sword.vmdl_c'), 'Four-Fangs');

  s.steps.length = 0;
  await s.svc.refreshInBackground();
  assert.deepEqual(s.counts(), [], 'nothing new picked: nothing built again');
  assert.equal(s.writes(), 1, 'the table is still written');
});

test('a build asked for while one runs stops that one before it writes, and both answers are the build that wrote', async (t) => {
  const s = juggernaut(t);
  s.pick('body', '9059');
  const first = s.svc.refreshInBackground();
  await tick(); // the first build has taken its first step
  s.pick('weapon', '4015');
  const second = s.svc.refreshInBackground();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, 'one answer for both');
  assert.equal(s.writes(), 1, 'the out-of-date build wrote nothing');
  assert.equal(s.built('models/heroes/juggernaut/juggernaut_body.vmdl_c'), "Valve's arcana body");
  assert.equal(s.built('models/heroes/juggernaut/jugg_sword.vmdl_c'), 'Four-Fangs', 'the build that wrote has the second pick');
});

test('a refresh while a build runs in the background answers the build, and the Play button waits for the last one', async (t) => {
  const s = juggernaut(t);
  s.pick('body', '9059');
  const waiting = s.svc.refreshInBackground();
  await tick();
  const now = s.svc.refresh();
  assert.equal(await waiting, now, 'the refresh wrote the same library: its result is the answer');
  assert.equal(s.writes(), 0, 'the build in the background stopped before writing');

  s.pick('weapon', '4015');
  void s.svc.refreshInBackground();
  assert.equal(s.built('models/heroes/juggernaut/jugg_sword.vmdl_c'), null, 'asked for, not built yet');
  await s.svc.settled();
  assert.equal(s.built('models/heroes/juggernaut/jugg_sword.vmdl_c'), 'Four-Fangs', 'settled resolves once the table is written');
});

test('the bar shows a build only once it has run long enough to be seen, and counts the picks built anew', () => {
  const sent: unknown[] = [];
  let clock = 0;
  const bar = buildBar((evt) => sent.push(evt), () => 'Building items', 400, () => clock);

  bar({ done: 1, total: 3 });
  clock = 200;
  bar({ done: 2, total: 3 });
  assert.deepEqual(sent, [], 'a fifth of a second in: nothing');
  clock = 500;
  bar({ done: 3, total: 3 });
  bar({ stage: 'packed' });
  bar(null);
  assert.deepEqual(sent, [
    { type: 'count', label: 'Building items', done: 3, total: 3 },
    { type: 'count', label: 'Building items', done: 3, total: 3 },
    { type: 'done' },
  ], 'past the wait: the count, full while the pak is written, then the end');

  sent.length = 0;
  clock = 1000;
  bar({ done: 1, total: 1 });
  bar(null);
  assert.deepEqual(sent, [], 'a quick build after it: no bar, and no end for a bar that never showed');

  clock = 2000;
  bar({ stage: 'merged' });
  clock = 3000;
  bar({ stage: 'packed' });
  bar(null);
  assert.deepEqual(sent, [], 'nothing to build anew, only the write: nothing to count');
});
