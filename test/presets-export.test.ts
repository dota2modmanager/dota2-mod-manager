/* Sending a preset as a file, and taking one in through the dialog (src/ipc-presets.ts).
 *
 * test/ipc-presets.test.ts and test/presets-apply.test.ts cover listing, resolving and applying.
 * Writing a .d2mm through the save dialog had no test at all: a cancelled dialog, a mod the user
 * unticked because it was too big, the bytes pulled only for what stays ticked, and a failure
 * half-way that has to reach the progress bar as well as the window. The presets service and the
 * library are stand-ins here; the file written is real and read back with the real reader.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerPresetsIpc } from '../src/ipc-presets.ts';
import { readPresetFile } from '../src/preset-share.ts';
import { t as say } from '../src/i18n.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const PRESET = { id: 'p1', name: 'My build: <best>', mods: [] };

function stand(t: TestContext, { savePath = null as string | null, openPath = null as string | null, entries = null as unknown[] | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const progress: { type: string; label?: string; message?: string }[] = [];
  const loaded: string[] = [];
  const asked: string[] = [];
  const shareEntries = entries || [
    { kind: 'catalog', categoryId: 'heroes', name: 'Arcana', styleLabel: null, fp: 'abc', size: 0 },
    { kind: 'embedded', name: 'Own small', categoryId: 'imported', info: '', fp: 'f1', size: 5, loadData: () => { loaded.push('small'); return Buffer.from('small'); } },
    { kind: 'embedded', name: 'Own huge', categoryId: 'imported', info: '', fp: 'f2', size: 9e8, loadData: () => { loaded.push('huge'); return Buffer.from('huge'); } },
    { kind: 'pack', name: 'Pack', members: [{ kind: 'embedded', name: 'Member', categoryId: 'imported', info: '', fp: 'f3', size: 6, loadData: () => { loaded.push('member'); return Buffer.from('member'); } }] },
  ];
  const presets = {
    presetShareEntries: async () => shareEntries,
    planShape: (e: unknown[]) => e.map((x, i) => ({ key: String(i), name: (x as { name: string }).name })),
    importPresetFile: (file: string) => { asked.push(`import ${path.basename(file)}`); return { ok: true }; },
    catalogIndex: async () => new Map(),
  };
  const library = { getPreset: (id: string) => (id === 'p1' ? PRESET : id === 'received' ? { ...PRESET, id, wanted: [], source: { file: path.join(dir, 'stash.d2mm') } } : null) };
  const channels = registerAgainst(() => registerPresetsIpc({
    win: () => null, settings: { get: () => null }, catalog: { cacheInfo: () => ({ fetchedAt: 1700000000000 }) },
    installer: {}, library, schemaService: {}, presets, adoptImportedFiles: () => ({ records: [] }),
    afterDeployMaster: () => {}, disableOtherCursors: () => [], sendProgress: (p: never) => progress.push(p),
  } as never), {
    app: { getVersion: () => '2.8.0' },
    dialog: {
      showSaveDialog: async (_w: unknown, o: { defaultPath: string }) => { asked.push(`save as ${o.defaultPath}`); return savePath ? { canceled: false, filePath: path.join(dir, savePath) } : { canceled: true }; },
      showOpenDialog: async () => (openPath ? { canceled: false, filePaths: [path.join(dir, openPath)] } : { canceled: true, filePaths: [] }),
    },
  });
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  return { dir, call, progress, loaded, asked };
}

test('a preset goes into a file with catalog mods by name, the user\'s own as bytes, and an unticked one named but not carried', async (t) => {
  const s = stand(t, { savePath: 'out.d2mm' });
  const r = await s.call('presets:export', 'p1', { skip: ['2'], note: 'for ranked', author: 'Misha' });
  assert.equal(r.ok, true);
  assert.deepEqual(s.asked, ['save as My build_ _best_.d2mm'], 'a name with characters a file cannot hold is made safe');
  assert.deepEqual(s.loaded.sort(), ['member', 'small'], 'the huge one was unticked, so its bytes were never read');

  const { manifest, readMod } = readPresetFile(r.path);
  assert.equal(manifest.note, 'for ranked');
  assert.equal(manifest.author, 'Misha');
  assert.equal(manifest.app, '2.8.0');
  assert.deepEqual(manifest.mods.map((m) => m.kind), ['catalog', 'embedded', 'missing', 'pack']);
  const own = manifest.mods[1];
  assert.equal(own.kind === 'embedded' && readMod(own.file).toString(), 'small');
  const pack = manifest.mods[3];
  assert.equal(pack.kind === 'pack' && pack.members[0].kind, 'embedded');
  assert.deepEqual(s.progress.map((p) => p.type), ['stage', 'done']);
});

test('a cancelled save writes nothing and reads no bytes, and an unknown preset is refused', async (t) => {
  const s = stand(t);
  assert.deepEqual(await s.call('presets:export', 'p1', {}), { cancelled: true });
  assert.deepEqual(s.loaded, []);
  assert.deepEqual(s.progress, []);
  assert.deepEqual(await s.call('presets:export', 'nope', {}), { error: say('Пресет не найден') });
  assert.deepEqual(await s.call('presets:exportPlan', 'nope'), { error: say('Пресет не найден') });
});

test('a mod that cannot be read half-way stops the file, and the bar and the window both hear why', async (t) => {
  const s = stand(t, {
    savePath: 'out.d2mm',
    entries: [{ kind: 'embedded', name: 'Locked', categoryId: 'imported', info: '', fp: null, size: 1, loadData: () => { throw new Error('the file is held open'); } }],
  });
  assert.deepEqual(await s.call('presets:export', 'p1', {}), { error: 'the file is held open' });
  assert.deepEqual(s.progress.at(-1), { type: 'error', label: PRESET.name, message: 'the file is held open' });
});

test('the export plan lists what would travel, and a failure building it is the reason', async (t) => {
  const s = stand(t);
  const plan = await s.call('presets:exportPlan', 'p1');
  assert.equal(plan.name, PRESET.name);
  assert.deepEqual(plan.entries.map((e: { name: string }) => e.name), ['Arcana', 'Own small', 'Own huge', 'Pack']);
  // a catalog that cannot be read is the plan failing, not the window
  const ch = registerAgainst(() => registerPresetsIpc({
    win: () => null, settings: {}, catalog: {}, installer: {}, library: { getPreset: () => PRESET }, schemaService: {},
    presets: { presetShareEntries: async () => { throw new Error('catalog unreadable'); } },
    adoptImportedFiles: () => ({}), afterDeployMaster: () => {}, disableOtherCursors: () => [], sendProgress: () => {},
  } as never));
  assert.deepEqual(await ch.get('presets:exportPlan')!({}, 'p1'), { error: 'catalog unreadable' });
});

test('a preset file picked in the dialog is taken in, and a cancelled dialog takes nothing', async (t) => {
  assert.deepEqual(await stand(t).call('presets:importDialog'), { cancelled: true });
  const s = stand(t, { openPath: 'from-a-friend.d2mm' });
  assert.deepEqual(await s.call('presets:importDialog'), { ok: true });
  assert.deepEqual(s.asked, ['import from-a-friend.d2mm']);
});

test('a received preset whose kept file is damaged says so instead of installing half of it', async (t) => {
  const s = stand(t);
  fs.writeFileSync(path.join(s.dir, 'stash.d2mm'), 'not a zip any more');
  const r = await s.call('presets:resolve', 'received');
  assert.ok(r.error, 'refused with a reason');
  assert.match(r.error, /stash\.d2mm/);
});
