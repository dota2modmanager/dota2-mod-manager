/* The preset channels past applying one (src/ipc-presets.ts): what the Presets screen is shown,
 * and turning a received preset into an ordinary one.
 *
 * A received .d2mm is a wish list: some lines name catalog mods, some carry the sender's own file,
 * some are free cosmetic picks, and some are only a name the sender could not include. Resolving
 * it installs what can be installed and then forgets the wish list, so from that moment the preset
 * is a build like any other. What it must not do is fold the cosmetic picks into the build (they
 * are not mods, see Library.inPreset), or drop the lines it could not resolve without saying so.
 *
 * The library is the real one in a temporary folder; the catalog and the installer are fakes that
 * record what they were asked.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library } from '../src/library.ts';
import { registerPresetsIpc } from '../src/ipc-presets.ts';
import type { ModIdentity, Preset, PresetEntry } from '../src/types.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const catalogLine = (name: string): PresetEntry => ({ kind: 'catalog', categoryId: 'heroes', name, styleLabel: null, fp: null });

function stand(t: TestContext, { catalogHas = [] as string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-ipc-presets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const log: string[] = [];
  const fpIndex = new Map<string, string>();

  const channels = registerAgainst(() => registerPresetsIpc({
    win: () => null,
    settings: { get: (k: string) => (k === 'account' ? { id: '1', username: 'misha' } : null) },
    catalog: {},
    library,
    installer: {
      install: async ({ categoryId, modName }: { categoryId: string; modName: string }) => {
        log.push(`install ${modName}`);
        return [{ root: 'lang', relPath: `${categoryId}-${modName}.vpk` }];
      },
      ensureCursorStore: () => {},
    },
    schemaService: {
      pickCosmetic: (slot: string, itemId: string, name: string) => library.add({ name, categoryId: 'cosmetic', files: [] }),
      refresh: () => log.push('schema'),
    },
    presets: {
      catalogIndex: async () => ({
        lookup: (categoryId: string, name: string) => (catalogHas.includes(name)
          ? { categoryId, name, styleLabel: null, fileRef: `${name}.zip` }
          : null),
      }),
      sharedPresetStatus: async (p: Preset) => ({ lines: p.wanted!.length }),
      presetLinkMods: (p: Preset) => ({ mods: (p.mods || []).filter((m) => m.categoryId !== 'imported'), skipped: 0 }),
      installedFpIndex: () => fpIndex,
      packFromRecords: (name: string, ids: string[]) => {
        log.push(`pack ${name} of ${ids.length}`);
        return library.add({ name, categoryId: 'combined', kind: 'pack', files: [], members: [] });
      },
      applyPreset: (p: Preset) => { log.push(`apply ${p.name}`); return []; },
      dropSharedPresetFile: () => log.push('drop file'),
    },
    adoptImportedFiles: () => ({ records: [] }),
    afterDeployMaster: () => log.push('master'),
    disableOtherCursors: () => {},
    sendProgress: () => {},
  } as never));
  const call = (channel: string, ...args: unknown[]) => channels.get(channel)!({}, ...args);

  const received = (wanted: PresetEntry[]) => library.addSharedPreset({ name: 'From a friend', wanted });
  return { call, library, log, fpIndex, received };
}

test('a build lists the mods it has here and names the ones it does not', async (t) => {
  const s = stand(t);
  const here = s.library.add({ name: 'Here', categoryId: 'heroes', files: [] });
  const gone: ModIdentity = { categoryId: 'heroes', name: 'Gone', styleLabel: null, fp: null };
  s.library.data.presets.push({ id: 'p1', name: 'Build', mods: [Library.identityOf(here), gone], updatedAt: 0 });

  const [row] = await s.call('presets:list');

  assert.deepEqual(row.modIds, [here.id]);
  assert.deepEqual(row.absent, [gone]);
  assert.deepEqual(row.link, { count: 2, skipped: 0 }, 'and how much of it a link could carry');
});

test('a received preset is listed with what installing it would take', async (t) => {
  const s = stand(t);
  s.received([catalogLine('A'), catalogLine('B')]);
  const [row] = await s.call('presets:list');
  assert.deepEqual(row.status, { lines: 2 });
  assert.equal(row.absent, undefined, 'the member view is for builds, not wish lists');
});

test('resolving installs what the catalog has, keeps what is already here, and becomes a build', async (t) => {
  const s = stand(t, { catalogHas: ['From Catalog'] });
  const onDisk = s.library.add({ name: 'Mine', categoryId: 'imported', files: [] });
  s.fpIndex.set('fp-mine', onDisk.id);
  const preset = s.received([
    catalogLine('From Catalog'),
    { kind: 'embedded', name: 'Mine', file: 'mods/0.vpk', categoryId: 'imported', size: 1, fp: 'fp-mine', info: '' },
    { kind: 'cosmetic', name: 'Golden Courier', slot: 'courier', itemId: '1', effectId: null } as unknown as PresetEntry,
    { kind: 'missing', name: 'Too Big', reason: 'the sender left it out' },
  ]);

  const r = await s.call('presets:resolve', preset.id);

  assert.equal(r.ok, true);
  assert.deepEqual(s.log.filter((l) => l.startsWith('install')), ['install From Catalog']);
  const now = s.library.getPreset(preset.id)!;
  assert.equal(now.wanted, undefined, 'the wish list is gone: this is an ordinary preset now');
  assert.deepEqual(now.mods!.map((m) => m.name).sort(), ['From Catalog', 'Mine'], 'the courier pick is made but is not a mod of the build');
  assert.ok(s.library.list().some((x) => x.name === 'Golden Courier'), 'the pick itself was made');
  assert.deepEqual(r.errors, ['Too Big: the sender left it out'], 'the line that could not be resolved is named');
  assert.ok(s.log.includes('apply From a friend') && s.log.includes('master'));
});

test('a sender\'s own file that did not come with the preset is named, not skipped', async (t) => {
  const s = stand(t);
  const preset = s.received([
    { kind: 'embedded', name: 'Their Pak', file: 'mods/0.vpk', categoryId: 'imported', size: 1, fp: 'fp-theirs', info: '' },
  ]);
  const r = await s.call('presets:resolve', preset.id);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^Their Pak: /);
  assert.equal(r.installed, 0);
});

test('a pack line is built into a pack from the mods it names', async (t) => {
  const s = stand(t, { catalogHas: ['One', 'Two'] });
  const preset = s.received([{ kind: 'pack', name: 'Duo', members: [catalogLine('One'), catalogLine('Two')] } as PresetEntry]);
  const r = await s.call('presets:resolve', preset.id);
  assert.equal(r.ok, true);
  assert.ok(s.log.includes('pack Duo of 2'));
  assert.deepEqual(s.library.getPreset(preset.id)!.mods!.map((m) => m.name), ['Duo']);
});

test('only a received preset can be resolved', async (t) => {
  const s = stand(t);
  s.library.data.presets.push({ id: 'own', name: 'Own', mods: [], updatedAt: 0 });
  assert.ok((await s.call('presets:resolve', 'own')).error);
  assert.ok((await s.call('presets:resolve', 'nope')).error);
});

test('a name is trimmed and kept short, and an empty one is refused', async (t) => {
  const s = stand(t);
  s.library.data.presets.push({ id: 'p1', name: 'Old', mods: [], updatedAt: 0 });
  assert.deepEqual(await s.call('presets:rename', 'p1', `  ${'x'.repeat(200)}  `), { ok: true, name: 'x'.repeat(120) });
  assert.ok((await s.call('presets:rename', 'p1', '   ')).error);
  assert.ok((await s.call('presets:rename', 'nope', 'Name')).error);
});

test('a link carries the catalog mods and says who sent it; a build of only own mods gets none', async (t) => {
  const s = stand(t);
  s.library.data.presets.push({ id: 'cat', name: 'Catalog build', mods: [{ categoryId: 'heroes', name: 'A', styleLabel: null, fp: null }], updatedAt: 0 });
  s.library.data.presets.push({ id: 'own', name: 'Own build', mods: [{ categoryId: 'imported', name: 'Mine', styleLabel: null, fp: null }], updatedAt: 0 });

  const r = await s.call('presets:shareLink', 'cat');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(typeof r.code, 'string');
  assert.ok((await s.call('presets:shareLink', 'own')).error, 'a link cannot carry a file, and says so');
});
