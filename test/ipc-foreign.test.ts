/* Files the app did not put there, through the channels the window calls (src/ipc-foreign.ts):
 * switching one off and on, removing it, taking it into the library, recognising a cursor set or
 * a font somebody installed by hand, and cutting a file with several heroes into one mod each.
 *
 * Each of these renames or deletes files in the game folder that the library has no record of,
 * so the line that matters is the one between the file asked about and its neighbours. Until
 * these tests only two of the eight channels had one, inside the load-order tests.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Installer } from '../src/installer.ts';
import { buildVpk, fingerprintVpk, readVpkIndexFile } from '../src/vpk.ts';
import { Library } from '../src/library.ts';
import { registerForeignIpc } from '../src/ipc-foreign.ts';
import type { CatalogIdentity } from '../src/fingerprints.ts';
import type { LibFile } from '../src/types.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

/** A game folder with an installer and a library over it, and the channels. */
function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-foreign-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  let gamePath: string | null = game;
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => gamePath, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  // what the catalog would recognise, whatever it is asked about; the fingerprints asked are kept
  let known: CatalogIdentity[] | null = null;
  const asked: string[] = [];
  let fonts: (CatalogIdentity & { files: Record<string, string> })[] = [];
  const fingerprints = {
    match: (fp: string) => { asked.push(fp); return known; },
    matchFonts: () => fonts,
  };
  let refreshed = 0;
  let harvest: { deltas: number } | null = null;
  const schemaService = { harvest: () => harvest, refresh: () => { refreshed++; }, split: () => [] as unknown[] };
  const channels = registerAgainst(() => registerForeignIpc({ fingerprints, installer, library, schemaService } as never));
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  const put = (rel: string, body: string | Buffer = rel) => {
    const f = path.join(lang, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  const files = () => fs.readdirSync(lang).sort();
  return {
    game, lang, installer, library, schemaService, call, put, files, asked,
    recognise: (as: CatalogIdentity[] | null) => { known = as; },
    fonts: (list: typeof fonts) => { fonts = list; },
    harvestGives: (h: typeof harvest) => { harvest = h; },
    refreshed: () => refreshed,
    noGame: () => { gamePath = null; },
  };
}

test('switching a foreign file off renames only that file, and switching it on puts the same name back', async (t) => {
  const s = stand(t);
  s.put('pak05_dir.vpk');
  s.put('pak05_000.vpk');
  s.put('pak06_dir.vpk');

  assert.deepEqual(await s.call('mods:externalSetEnabled', 'pak05_dir.vpk', false), { ok: true });
  assert.deepEqual(s.files(), ['pak05_000.vpk', 'pak05_dir.vpk.off', 'pak06_dir.vpk'],
    'the game mounts through the index, so the index is what goes off');

  // the screen names a switched-off file by what is on disk
  assert.deepEqual(await s.call('mods:externalSetEnabled', 'pak05_dir.vpk.off', true), { ok: true });
  assert.deepEqual(s.files(), ['pak05_000.vpk', 'pak05_dir.vpk', 'pak06_dir.vpk']);

  // asked for the state it is already in, nothing moves
  await s.call('mods:externalSetEnabled', 'pak05_dir.vpk', true);
  assert.deepEqual(s.files(), ['pak05_000.vpk', 'pak05_dir.vpk', 'pak06_dir.vpk']);
});

test('removing a foreign file takes its data volumes in either state, and leaves a file whose name only starts the same', async (t) => {
  const s = stand(t);
  s.put('pak05_dir.vpk.off');
  s.put('pak05_000.vpk');
  s.put('pak05_001.vpk.off');
  s.put('pak050_dir.vpk');
  s.put('pak050_000.vpk');

  assert.deepEqual(await s.call('mods:externalRemove', 'pak05_dir.vpk.off'), { ok: true });
  assert.deepEqual(s.files(), ['pak050_000.vpk', 'pak050_dir.vpk']);
});

test('cutting a foreign file by hero deletes it and its volumes, and nothing that merely looks like them', async (t) => {
  const s = stand(t);
  // brackets and a dot in the name: read as a pattern, "(1)" would match a plain "1"
  s.put('skins (1).x_dir.vpk');
  s.put('skins (1).x_000.vpk.off');
  s.put('skins 1.x_000.vpk');
  s.put('skins (1)Ax_000.vpk');
  s.put('pak30_dir.vpk');
  s.put('pak31_dir.vpk');
  const parts: { name: string; files: LibFile[] }[] = [
    { name: 'Juggernaut', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }] },
    { name: 'Pudge', files: [{ root: 'lang', relPath: 'pak31_dir.vpk' }] },
  ];
  let cut = '';
  s.installer.splitVpkFile = ((base: string) => { cut = base; return parts; }) as never;

  const r = await s.call('mods:splitExternal', 'skins (1).x_dir.vpk');
  assert.deepEqual(r, { ok: true, count: 2, names: ['Juggernaut', 'Pudge'] });
  assert.equal(cut, 'skins (1).x_dir.vpk');
  assert.deepEqual(s.files(), ['pak30_dir.vpk', 'pak31_dir.vpk', 'skins (1)Ax_000.vpk', 'skins 1.x_000.vpk']);
  const recs = s.library.list();
  assert.deepEqual(recs.map((x) => [x.name, x.categoryId, x.fileRef, x.files[0].relPath]), [
    ['Juggernaut', 'imported', 'skins (1).x_dir.vpk', 'pak30_dir.vpk'],
    ['Pudge', 'imported', 'skins (1).x_dir.vpk', 'pak31_dir.vpk'],
  ]);
});

test('a foreign file with one hero in it is left whole', async (t) => {
  const s = stand(t);
  s.put('solo_dir.vpk');
  s.installer.splitVpkFile = (() => []) as never;
  const r = await s.call('mods:splitExternal', 'solo_dir.vpk');
  assert.ok(r.error, 'says why it did nothing');
  assert.deepEqual(s.files(), ['solo_dir.vpk']);
  assert.equal(s.library.list().length, 0);
});

test('a foreign file taken in while switched off joins switched off, with its volumes, under the name its content gives', async (t) => {
  const s = stand(t);
  s.put('pak05_dir.vpk.off');
  s.put('pak05_000.vpk');
  s.installer.displayNameForFile = (() => 'Pudge') as never;
  s.harvestGives({ deltas: 2 });

  const r = await s.call('mods:adoptExternal', 'pak05_dir.vpk.off', null);
  assert.deepEqual(r, { ok: true, name: 'Pudge', matched: false });
  const [rec] = s.library.list();
  assert.equal(rec.enabled, false, 'it arrived switched off and stays that way');
  assert.equal(rec.categoryId, 'imported');
  assert.equal(rec.fileRef, 'pak05_dir.vpk.off');
  assert.equal(rec.files.length, 2, 'the index and its data volume are one mod');
  assert.equal(s.refreshed(), 1, 'item blocks lifted out of it reach the table');
});

test('a foreign file the catalog knows joins under the catalog\'s name, category and picture', async (t) => {
  const s = stand(t);
  const data = Buffer.from('a model');
  s.put('pak05_dir.vpk', buildVpk([{ ext: 'vmdl_c', folder: 'models/heroes/pudge', name: 'pudge', data, preload: Buffer.alloc(0), crc: zlib.crc32(data) }]));
  const fp = fingerprintVpk(readVpkIndexFile(path.join(s.lang, 'pak05_dir.vpk')));
  s.recognise([{ name: 'Arcana Pudge', categoryId: 'heroes', styleLabel: 'Classic' }]);
  const r = await s.call('mods:adoptExternal', 'pak05_dir.vpk', 'https://example.test/pudge.webp');
  assert.deepEqual(r, { ok: true, name: 'Arcana Pudge', matched: true });
  assert.deepEqual(s.asked, [fp], 'recognised by what the file holds');
  assert.deepEqual(s.files(), ['pak30_dir.vpk'], 'a hero mod moves out of the slots that load first');
  const [rec] = s.library.list();
  assert.deepEqual([rec.name, rec.categoryId, rec.styleLabel, rec.preview], ['Arcana Pudge', 'heroes', 'Classic', 'https://example.test/pudge.webp']);
  assert.equal(s.refreshed(), 0, 'nothing lifted, nothing to rebuild');
});

test('taking in a file that is no longer there says so and adds nothing', async (t) => {
  const s = stand(t);
  const r = await s.call('mods:adoptExternal', 'gone_dir.vpk', null);
  assert.ok(r.error);
  assert.equal(s.library.list().length, 0);
});

test('a cursor set somebody installed by hand joins with every file in it, nested ones by a forward-slash path', async (t) => {
  const s = stand(t);
  const cursor = path.join(s.game, 'dota', 'resource', 'cursor');
  fs.mkdirSync(path.join(cursor, 'Busy'), { recursive: true });
  fs.writeFileSync(path.join(cursor, 'Arrow.cur'), 'arrow');
  fs.writeFileSync(path.join(cursor, 'Busy', 'wait.ani'), 'wait');
  s.recognise([{ name: 'Gold cursors', categoryId: 'cursors' }]);
  let stored: { id: string; files: LibFile[] } | null = null;
  s.installer.ensureCursorStore = ((id: string, files: LibFile[]) => { stored = { id, files }; }) as never;

  const r = await s.call('mods:adoptCursor', null);
  assert.deepEqual(r, { ok: true, name: 'Gold cursors' });
  const [rec] = s.library.list();
  assert.deepEqual(rec.files.map((f) => `${f.root}:${f.relPath}`).sort(), ['cursor:Arrow.cur', 'cursor:Busy/wait.ani']);
  assert.deepEqual(stored, { id: rec.id, files: rec.files }, 'a copy is kept so the set can be switched off and on');
  assert.equal(s.asked.length, 1, 'the set is recognised as one fingerprint');
});

test('a cursor set the catalog does not know, or no cursor folder, or no game, adds nothing', async (t) => {
  const s = stand(t);
  assert.ok((await s.call('mods:adoptCursor', null)).error, 'no cursor folder');
  fs.mkdirSync(path.join(s.game, 'dota', 'resource', 'cursor'), { recursive: true });
  assert.ok((await s.call('mods:adoptCursor', null)).error, 'nothing the catalog knows');
  s.noGame();
  assert.ok((await s.call('mods:adoptCursor', null)).error, 'no game');
  assert.equal(s.library.list().length, 0);
});

test('a font somebody installed by hand joins as the catalog mod of that name, with the catalog\'s files', async (t) => {
  const s = stand(t);
  s.installer.fontFolderHashes = (() => ({ 'radiance.ttf': 'aa' })) as never;
  s.fonts([
    { name: 'Other font', categoryId: 'fonts', files: { 'other.ttf': 'bb' } },
    { name: 'Radiance', categoryId: 'fonts', files: { 'radiance.ttf': 'aa', 'radiance-bold.ttf': 'cc' } },
  ]);
  assert.deepEqual(await s.call('mods:adoptFont', 'Radiance', null), { ok: true, name: 'Radiance' });
  const [rec] = s.library.list();
  assert.deepEqual(rec.files, [{ root: 'fonts', relPath: 'radiance.ttf' }, { root: 'fonts', relPath: 'radiance-bold.ttf' }]);
  assert.ok((await s.call('mods:adoptFont', 'Nobody', null)).error, 'a name the match did not give');
  assert.equal(s.library.list().length, 1);
});

test('cutting a library mod by hero needs an index in the language folder, and more than one hero in it', async (t) => {
  const s = stand(t);
  const fontOnly = s.library.add({ name: 'A font', categoryId: 'fonts', fileRef: 'a', files: [{ root: 'fonts', relPath: 'a.ttf' }] });
  assert.ok((await s.call('mods:splitMod', fontOnly.id)).error);
  const one = s.library.add({ name: 'One hero', categoryId: 'imported', fileRef: 'b', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }] });
  assert.ok((await s.call('mods:splitMod', one.id)).error, 'the service found fewer than two heroes');
  assert.equal(s.refreshed(), 0);

  s.schemaService.split = (() => [{ name: 'Juggernaut', schema: [] }, { name: 'Pudge', schema: ['block'] }]) as never;
  assert.deepEqual(await s.call('mods:splitMod', one.id), { ok: true, count: 2, names: ['Juggernaut', 'Pudge'] });
  assert.equal(s.refreshed(), 1, 'a part that took item blocks with it rebuilds the table');
  assert.ok((await s.call('mods:splitMod', 'no-such-id')).error);
});
