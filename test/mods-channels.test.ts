/* The two channels My mods and the catalog lean on most (src/ipc-mods.ts): mods:list, which every
 * screen calls after anything changes, and mods:install.
 *
 * mods:list does more than list. It drops a mod whose files were deleted from the game folder,
 * names a foreign file that is a leftover copy of a library mod, recognises catalog mods, gives
 * an import still called "pakNN" a real name, works out which switched-on mod hides another's
 * files, keeps the item blocks in the main process and rewrites the ownership note. One test
 * looked at it before these, and only at the load-order part.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { registerModsIpc } from '../src/ipc-mods.ts';
import { buildVpk, fingerprintVpk, readVpkIndexFile } from '../src/vpk.ts';
import type { CatalogIdentity } from '../src/fingerprints.ts';
import type { LibFile, LibRecord } from '../src/types.ts';
import { entry } from './helpers/vpk-entry.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

type Row = Record<string, unknown> & { id?: string; key?: string; name: string };

function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-mods-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const matches = new Map<string, CatalogIdentity[]>();
  const fingerprints = { hasData: () => true, match: (fp?: string | null) => (fp && matches.get(fp)) || null, fonts: [], matchFonts: () => [] };
  let schemaOn = false;
  let harvest: { deltas: number } | null = null;
  let refreshed = 0;
  const progress: { type: string; label: string }[] = [];
  const calls: string[] = [];
  let blockedWith: { error: string } | null = null;
  const reached = new Map<string, { since: string | null; changed: string[]; removed: string[]; sig: string }>();
  const channels = registerAgainst(() => registerModsIpc({
    applyMasterToCursors: (on: boolean) => calls.push(`cursors ${on}`), blocked: () => blockedWith, catalog: {},
    diag: () => {}, disableOtherCursors: () => { calls.push('other cursors off'); return ['Old cursors']; }, fingerprints,
    importVpkBuffers: () => {}, importVpkPaths: () => {}, installer, isCursorRecord: () => false, library,
    refreshPresence: () => calls.push('presence'),
    schemaService: { state: () => ({ enabled: schemaOn }), harvest: () => harvest, refresh: () => { refreshed++; } },
    sendProgress: (p: { type: string; label: string }) => progress.push(p), verifyStuck: () => [], win: () => null,
    updateImpact: { marked: () => reached },
  } as never));
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  /** A pak in the language folder holding these files, and (unless `foreign`) the record that owns it. */
  const pak = (slot: string, files: [string, string][], rec: Partial<LibRecord> = {}) => {
    fs.writeFileSync(path.join(lang, `${slot}_dir.vpk`), buildVpk(files.map(([p, b]) => entry(p, b))));
    if (rec === null) return null;
    return library.add({ name: `${slot} mod`, categoryId: 'heroes', fileRef: slot, files: [{ root: 'lang', relPath: `${slot}_dir.vpk` }], ...rec } as never);
  };
  const fpOf = (slot: string) => fingerprintVpk(readVpkIndexFile(path.join(lang, `${slot}_dir.vpk`)));
  const list = async () => (await call('mods:list')) as { installed: Row[]; external: Row[]; slots: number };
  return {
    lang, installer, library, matches, call, pak, fpOf, list, progress, calls,
    schema: (on: boolean) => { schemaOn = on; },
    harvestGives: (h: typeof harvest) => { harvest = h; },
    refreshed: () => refreshed,
    block: (b: typeof blockedWith) => { blockedWith = b; },
    reached,
  };
}

const PUDGE: [string, string][] = [['models/heroes/pudge/pudge.vmdl_c', 'a pudge model']];

test('a mod whose files were deleted from the game folder drops out of the list and the library', async (t) => {
  const s = stand(t);
  const kept = s.pak('pak30', PUDGE)!;
  const gone = s.pak('pak31', [['models/heroes/axe/axe.vmdl_c', 'an axe model']])!;
  fs.rmSync(path.join(s.lang, 'pak31_dir.vpk'));
  const pack = s.library.add({ kind: 'pack', name: 'A pack', categoryId: 'pack', fileRef: 'p', files: [{ root: 'lang', relPath: 'pak40_dir.vpk' }] } as never);
  const packsRemoved: string[] = [];
  s.installer.removePackFully = ((rec: LibRecord) => { packsRemoved.push(rec.id); }) as never;

  const { installed } = await s.list();
  assert.deepEqual(installed.map((r) => r.id), [kept.id]);
  assert.equal(s.library.find(gone.id), null);
  assert.equal(s.library.find(pack.id), null);
  assert.deepEqual(packsRemoved, [pack.id], 'a pack whose files are gone has its leftovers cleared too');
});

test('a file somebody left in the folder that is byte for byte a library mod is called a copy of it', async (t) => {
  const s = stand(t);
  s.pak('pak30', PUDGE, { name: 'Arcana Pudge' });
  fs.copyFileSync(path.join(s.lang, 'pak30_dir.vpk'), path.join(s.lang, 'pak50_dir.vpk'));
  s.pak('pak51', [['models/heroes/axe/axe.vmdl_c', 'nobody knows this one']], null as never);

  const { external } = await s.list();
  const copy = external.find((f) => f.key === 'pak50_dir.vpk' || String(f.name).includes('pak50'));
  assert.ok(copy, JSON.stringify(external.map((f) => f.key)));
  assert.equal(copy.duplicateOf, 'Arcana Pudge');
  const stranger = external.find((f) => f !== copy);
  assert.ok(stranger, 'a file nobody recognises is still listed: it is in the folder the game mounts');
  assert.equal(stranger.duplicateOf, undefined);
});

test('a foreign file the catalog knows is listed with the catalog mod it is', async (t) => {
  const s = stand(t);
  s.pak('pak50', PUDGE, null as never);
  s.matches.set(s.fpOf('pak50'), [{ name: 'Arcana Pudge', categoryId: 'heroes' }]);
  const { external } = await s.list();
  assert.deepEqual(external.map((f) => (f.match as CatalogIdentity[] | null)?.[0]?.name), ['Arcana Pudge']);
});

test('an import still called pakNN gets the catalog name if the catalog knows it, otherwise the name its content gives', async (t) => {
  const s = stand(t);
  const known = s.pak('pak30', PUDGE, { name: 'pak30', categoryId: 'imported' })!;
  s.matches.set(s.fpOf('pak30'), [{ name: 'Arcana Pudge', categoryId: 'heroes' }]);
  const unknown = s.pak('pak31', [['models/heroes/axe/axe.vmdl_c', 'an axe']], { name: 'pak31', categoryId: 'imported' })!;
  s.installer.displayNameForFile = (() => 'Axe: a set') as never;
  const named = s.pak('pak32', [['models/heroes/lina/lina.vmdl_c', 'lina']], { name: 'My own name', categoryId: 'imported' })!;

  const { installed } = await s.list();
  const nameOf = (id: string) => installed.find((r) => r.id === id)!.name;
  assert.equal(nameOf(known.id), 'Arcana Pudge');
  assert.equal(nameOf(unknown.id), 'Axe: a set');
  assert.equal(nameOf(named.id), 'My own name', 'a name somebody gave it is kept');
  assert.equal(s.library.find(known.id)!.name, 'Arcana Pudge', 'and the new name is saved, so it happens once');
  assert.deepEqual((installed.find((r) => r.id === known.id)!.match as CatalogIdentity[])[0].name, 'Arcana Pudge');
});

test('a switched-on mod that hides another one\'s files is named on that row, and a switched-off one hides nothing', async (t) => {
  const s = stand(t);
  const first = s.pak('pak30', [['models/heroes/pudge/pudge.vmdl_c', 'version one']], { name: 'First' })!;
  const second = s.pak('pak31', [['models/heroes/pudge/pudge.vmdl_c', 'version two']], { name: 'Second' })!;
  let { installed } = await s.list();
  assert.deepEqual(installed.find((r) => r.id === second.id)!.coveredBy, [{ name: 'First', files: 1 }]);
  assert.equal(installed.find((r) => r.id === first.id)!.coveredBy, undefined, 'the game mounts the lower slot first, so it wins');

  s.installer.setEnabled(first.files, false, first.id);
  s.library.setEnabled(first.id, false);
  ({ installed } = await s.list());
  assert.equal(installed.find((r) => r.id === second.id)!.coveredBy, undefined);
});

test('the item blocks stay in the main process: the row says how many there are and whether the patch is on', async (t) => {
  const s = stand(t);
  const rec = s.pak('pak30', PUDGE)!;
  // the blocks are stored the way the schema service stores them after lifting
  s.library.update(rec.id, { schema: ['"1" { }', '"2" { }'] } as never);
  s.schema(true);
  const { installed } = await s.list();
  const row = installed.find((r) => r.id === rec.id)!;
  assert.equal(row.schema, undefined);
  assert.equal(row.schemaCount, 2);
  assert.equal(row.schemaLive, true);
  assert.equal((s.library.find(rec.id) as unknown as { schema: string[] }).schema.length, 2, 'the stored record keeps them');
});

test('a mod a Dota update reached carries how many of its files changed and how many are gone', async (t) => {
  const s = stand(t);
  const hud = s.pak('pak30', [['panorama/layout/hud/dota_hud.vxml_c', 'old hud']])!;
  const axe = s.pak('pak31', [['models/heroes/axe/axe.vmdl_c', 'an axe model']])!;
  s.reached.set(hud.id, { since: '6946', changed: ['a', 'b'], removed: ['c'], sig: 'x' });
  const rows = (await s.list()).installed;
  assert.deepEqual(rows.find((r) => r.id === hud.id)?.prePatch, { since: '6946', changed: 2, removed: 1 });
  assert.equal('prePatch' in (rows.find((r) => r.id === axe.id) || {}), false);
});

test('listing rewrites the ownership note with exactly the library\'s files, and the status line hears about it', async (t) => {
  const s = stand(t);
  s.pak('pak30', PUDGE);
  s.pak('pak50', [['models/heroes/axe/axe.vmdl_c', 'foreign']], null as never);
  const { slots } = await s.list();
  const note = JSON.parse(fs.readFileSync(path.join(s.lang, 'dota2modmanager.json'), 'utf8'));
  assert.deepEqual(note.files, ['pak30_dir.vpk']);
  assert.ok(slots >= 1);
  assert.ok(s.calls.includes('presence'));
});

test('install refuses while the feature is switched off remotely, and downloads nothing', async (t) => {
  const s = stand(t);
  let asked = 0;
  s.installer.install = (async () => { asked++; return []; }) as never;
  s.block({ error: 'switched off today' });
  assert.deepEqual(await s.call('mods:install', { categoryId: 'heroes', name: 'X', fileRef: 'x.vpk' }), { error: 'switched off today' });
  assert.equal(asked, 0);
});

test('installing what is already installed says so, and downloads nothing', async (t) => {
  const s = stand(t);
  s.library.add({ name: 'Arcana Pudge', categoryId: 'heroes', styleLabel: null, fileRef: 'a.vpk', files: [] } as never);
  let asked = 0;
  s.installer.install = (async () => { asked++; return []; }) as never;
  const r = await s.call('mods:install', { categoryId: 'heroes', name: 'Arcana Pudge', styleLabel: null, fileRef: 'a.vpk' });
  assert.equal(r.already, true);
  assert.equal(asked, 0);
});

test('a cursor set steps the one that is on aside first, and keeps a copy of itself', async (t) => {
  const s = stand(t);
  const files: LibFile[] = [{ root: 'cursor', relPath: 'arrow.cur' }];
  s.installer.install = (async () => files) as never;
  let stored: string | null = null;
  s.installer.ensureCursorStore = ((id: string) => { stored = id; }) as never;
  const r = await s.call('mods:install', { categoryId: 'cursors', name: 'Gold', fileRef: 'gold.zip' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.replaced, ['Old cursors']);
  assert.equal(s.calls[0], 'other cursors off', 'before the new set is written over it');
  assert.equal(stored, r.record.id);
  assert.deepEqual(s.progress.at(-1), { type: 'done', label: 'Gold' });
});

test('a mod installed while the master switch is off goes off with the rest', async (t) => {
  const s = stand(t);
  s.installer.install = (async () => [{ root: 'lang', relPath: 'pak30_dir.vpk' }]) as never;
  s.installer.masterIsOff = (() => true) as never;
  const masters: boolean[] = [];
  s.installer.setMasterEnabled = ((on: boolean) => { masters.push(on); }) as never;
  await s.call('mods:install', { categoryId: 'heroes', name: 'X', fileRef: 'x.vpk' });
  assert.deepEqual(masters, [false]);
  assert.ok(s.calls.includes('cursors false'));
});

test('item blocks lifted at install rebuild the table once; a failed install adds nothing and says why', async (t) => {
  const s = stand(t);
  s.installer.install = (async () => [{ root: 'lang', relPath: 'pak30_dir.vpk' }]) as never;
  s.harvestGives({ deltas: 3 });
  await s.call('mods:install', { categoryId: 'heroes', name: 'With effects', fileRef: 'e.vpk' });
  assert.equal(s.refreshed(), 1);

  s.installer.install = (async () => { throw new Error('the mirror said no'); }) as never;
  const r = await s.call('mods:install', { categoryId: 'heroes', name: 'Broken', fileRef: 'b.vpk' });
  assert.match(r.error, /the mirror said no/);
  assert.equal(s.library.list().some((x) => x.name === 'Broken'), false);
  assert.deepEqual(s.progress.at(-1), { type: 'error', label: 'Broken', message: 'the mirror said no' });
});
