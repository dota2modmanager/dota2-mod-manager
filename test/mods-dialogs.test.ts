/* The mod channels that go through a file dialog (src/ipc-mods.ts): saving a mod as one file,
 * unpacking it into a folder, and picking files or a folder to import.
 *
 * test/mods-channels.test.ts covers listing and installing. These had no test: what a cancelled
 * dialog answers, the name a mod is saved under when its own has characters a file cannot hold, a
 * cursor set leaving as the zip the catalog ships instead of a pak, and a failure coming back as
 * its reason. The installer is a stand-in that records what it was asked; the files written are
 * real.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerModsIpc } from '../src/ipc-mods.ts';
import { t as say } from '../src/i18n.ts';
import type { LibRecord } from '../src/types.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

function stand(t: TestContext, { save = null as string | null, open = null as string[] | null, failMerge = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-moddlg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const records = new Map<string, Partial<LibRecord>>([
    ['mod', { id: 'mod', name: 'Arcana: "Pudge" <v2>', categoryId: 'heroes', files: [], schema: ['"1" { }'] } as never],
    ['cursor', { id: 'cursor', name: 'Gold', categoryId: 'cursors', files: [] }],
  ]);
  const asked: string[] = [];
  const installer = {
    downloadsDir: path.join(dir, 'downloads'), getGamePath: () => null, langFolder: () => dir,
    mergeToSingleVpk: (rec: LibRecord, schema: unknown) => {
      if (failMerge) throw new Error('a volume is missing');
      asked.push(`merge ${rec.id} with ${(schema as unknown[]).length} block(s)`);
      return Buffer.from('one vpk');
    },
    cursorZip: (rec: LibRecord) => { asked.push(`zip ${rec.id}`); return Buffer.from('a zip'); },
    unpackToFolder: (rec: LibRecord, dest: string) => { asked.push(`unpack ${rec.id} into ${path.basename(dest)}`); return { files: 3, bytes: 30 }; },
  };
  const imported: unknown[] = [];
  const channels = registerAgainst(() => registerModsIpc({
    applyMasterToCursors: () => {}, blocked: () => null, catalog: {}, diag: () => {}, disableOtherCursors: () => [],
    fingerprints: {}, importVpkBuffers: (items: unknown) => ({ buffers: items }), importVpkPaths: (paths: string[]) => { imported.push(paths); return { ok: true, count: paths.length }; },
    installer, isCursorRecord: (rec: LibRecord) => rec.categoryId === 'cursors', library: { find: (id: string) => records.get(id) || null },
    refreshPresence: () => {}, schemaService: {}, sendProgress: () => {}, verifyStuck: () => [], win: () => null,
  } as never), {
    dialog: {
      showSaveDialog: async (_w: unknown, o: { defaultPath: string; filters: { extensions: string[] }[] }) => {
        asked.push(`save as ${o.defaultPath} (${o.filters[0].extensions[0]})`);
        return save ? { canceled: false, filePath: path.join(dir, save) } : { canceled: true };
      },
      showOpenDialog: async () => (open ? { canceled: false, filePaths: open.map((p) => path.join(dir, p)) } : { canceled: true, filePaths: [] }),
    },
  });
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  return { dir, call, asked, imported };
}

test('a mod is saved as one .vpk with its item blocks, under a name a file can hold', async (t) => {
  const s = stand(t, { save: 'out.vpk' });
  const r = await s.call('mods:exportSingle', 'mod');
  assert.deepEqual(r, { ok: true, path: path.join(s.dir, 'out.vpk'), size: 7 });
  assert.equal(fs.readFileSync(path.join(s.dir, 'out.vpk'), 'utf8'), 'one vpk');
  assert.deepEqual(s.asked, ['merge mod with 1 block(s)', 'save as Arcana_ _Pudge_ _v2_.vpk (vpk)']);
});

test('a cursor set leaves as the zip the catalog ships, not as a pak', async (t) => {
  const s = stand(t, { save: 'gold.zip' });
  assert.equal((await s.call('mods:exportSingle', 'cursor')).ok, true);
  assert.deepEqual(s.asked, ['zip cursor', 'save as Gold.zip (zip)']);
});

test('a cancelled save writes nothing, an unknown mod is refused, and a failure is the reason', async (t) => {
  const s = stand(t);
  assert.deepEqual(await s.call('mods:exportSingle', 'mod'), { cancelled: true });
  assert.deepEqual(fs.readdirSync(s.dir), []);
  assert.deepEqual(await s.call('mods:exportSingle', 'nope'), { error: say('Мод не найден') });
  assert.deepEqual(await stand(t, { save: 'x.vpk', failMerge: true }).call('mods:exportSingle', 'mod'), { error: 'a volume is missing' });
});

test('a mod unpacks into a folder of its own name inside the one picked', async (t) => {
  const s = stand(t, { open: ['picked'] });
  const r = await s.call('mods:unpackToFolder', 'mod');
  assert.deepEqual(r, { ok: true, path: path.join(s.dir, 'picked', 'Arcana_ _Pudge_ _v2_'), files: 3, bytes: 30 });
  assert.ok(fs.statSync(r.path).isDirectory());
  assert.deepEqual(await stand(t).call('mods:unpackToFolder', 'mod'), { cancelled: true });
  assert.deepEqual(await s.call('mods:unpackToFolder', 'nope'), { error: say('Мод не найден') });
});

test('files or a folder picked to import go to the importer, and a cancelled pick imports nothing', async (t) => {
  const s = stand(t, { open: ['a.vpk', 'b.zip'] });
  assert.deepEqual(await s.call('mods:importDialog'), { ok: true, count: 2 });
  assert.deepEqual(await s.call('mods:importFolderDialog'), { ok: true, count: 2 });
  const none = stand(t);
  assert.deepEqual(await none.call('mods:importDialog'), { cancelled: true });
  assert.deepEqual(await none.call('mods:importFolderDialog'), { cancelled: true });
  assert.deepEqual(none.imported, []);
  // a drop that is not a list is an empty one, not an exception
  assert.deepEqual(await none.call('mods:importPaths', 'C:/one/path'), { ok: true, count: 0 });
});
