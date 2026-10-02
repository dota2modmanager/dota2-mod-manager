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
import { readVpkEntryFile } from '../src/vpk.ts';
import { Library } from '../src/library.ts';
import { createSchemaService, type SchemaInstaller } from '../src/schema-service.ts';
import type { Settings } from '../src/settings.ts';
import type { LibFile, LibRecord } from '../src/types.ts';

const GAMEINFO = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_Language		dota_*LANGUAGE*
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

function service(t: TestContext, { values = {}, installer = NO_INSTALLER, text = GAME_TABLE } = {} as {
  values?: Record<string, unknown>; installer?: SchemaInstaller; text?: string;
}) {
  const g = game(t, text);
  fs.mkdirSync(g.userData, { recursive: true });
  const library = new Library(g.userData);
  const settings = settingsIn({ dotaGamePath: g.game, schemaPatch: false, ...values });
  const said: string[] = [];
  const svc = createSchemaService({ settings, library, installer, userDataDir: g.userData, log: (m) => said.push(m) });
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
