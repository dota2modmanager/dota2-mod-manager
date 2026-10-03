/* The channels that switch, remove and inspect mods already installed (src/ipc-library.ts), against
 * a real Installer and Library over a temp game folder.
 *
 * The load order had its tests (test/load-order.test.ts); the rest of the module had almost none,
 * and its branches were 62% covered. These hold what a click there promises: one cursor set and one
 * look per cosmetic slot live at a time, a selection that touches the item table rebuilding it once
 * and not once per mod, a failed mod named while the others still go, and the map archive's owner
 * named before a terrain replaces it.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { registerLibraryIpc } from '../src/ipc-library.ts';
import { buildVpk } from '../src/vpk.ts';
import { t as say } from '../src/i18n.ts';
import type { LibRecord } from '../src/types.ts';
import { entry } from './helpers/vpk-entry.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-libch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const calls: string[] = [];
  let refreshed = 0;
  const channels = registerAgainst(() => registerLibraryIpc({
    applyMasterToCursors: (on: boolean) => calls.push(`master cursors ${on}`),
    disableOtherCosmetics: (rec: LibRecord) => { calls.push(`other looks off for ${rec.name}`); return ['Old look']; },
    disableOtherCursors: (id: string) => { calls.push(`other cursors off for ${id}`); return ['Old cursors']; },
    installer, isCursorRecord: (rec: LibRecord) => rec.categoryId === 'cursors', library,
    refreshPresence: () => calls.push('presence'),
    schemaService: { refresh: () => { refreshed++; } },
  } as never));
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  /** A mod of ours in the language folder. */
  const mod = (slot: string, extra: Partial<LibRecord> = {}) => {
    fs.writeFileSync(path.join(lang, `${slot}_dir.vpk`), buildVpk([entry(`models/${slot}.vmdl_c`, slot)]));
    return library.add({ name: `${slot} mod`, categoryId: 'heroes', fileRef: slot, files: [{ root: 'lang', relPath: `${slot}_dir.vpk` }], ...extra } as never);
  };
  /** A record whose item blocks reach the table, so changing it means a rebuild. */
  const withBlocks = (rec: LibRecord) => { library.update(rec.id, { schema: ['"1" { }'] } as never); return library.find(rec.id)!; };
  const files = () => fs.readdirSync(lang).sort();
  return { lang, installer, library, call, mod, withBlocks, files, calls, refreshed: () => refreshed };
}

test('switching a mod off renames it, switching it on puts it back, and a mod nobody has is an error', async (t) => {
  const s = stand(t);
  const rec = s.mod('pak30');
  assert.deepEqual(await s.call('mods:setEnabled', rec.id, false), { ok: true, replaced: [] });
  assert.deepEqual(s.files(), ['pak30_dir.vpk.off']);
  assert.equal(s.library.find(rec.id)!.enabled, false);
  await s.call('mods:setEnabled', rec.id, true);
  assert.deepEqual(s.files(), ['pak30_dir.vpk']);
  assert.equal(s.refreshed(), 0, 'a mod without item blocks leaves the table alone');
  assert.deepEqual(await s.call('mods:setEnabled', 'no-such-id', true), { error: say('Мод не найден') });
});

test('a cursor set or a cosmetic look switched on takes the place of the one that was on, and says which', async (t) => {
  const s = stand(t);
  const cursor = s.library.add({ name: 'Gold', categoryId: 'cursors', fileRef: 'g', files: [] } as never);
  const look = s.library.add({ name: 'Blue sword', categoryId: 'cosmetic', fileRef: 'c', files: [] } as never);
  assert.deepEqual((await s.call('mods:setEnabled', cursor.id, true)).replaced, ['Old cursors']);
  assert.deepEqual((await s.call('mods:setEnabled', look.id, true)).replaced, ['Old look']);
  assert.deepEqual(s.calls, [`other cursors off for ${cursor.id}`, 'other looks off for Blue sword']);
  assert.equal(s.refreshed(), 1, 'a cosmetic look lives in the item table');
  // switching off replaces nothing
  assert.deepEqual((await s.call('mods:setEnabled', cursor.id, false)).replaced, []);
});

test('a switch that fails comes back as the reason, and the record keeps its state', async (t) => {
  const s = stand(t);
  const rec = s.mod('pak30');
  s.installer.setEnabled = (() => { throw new Error('Dota holds the file'); }) as never;
  assert.deepEqual(await s.call('mods:setEnabled', rec.id, false), { error: 'Dota holds the file' });
  assert.equal(s.library.find(rec.id)!.enabled, true);
});

test('removing a selection rebuilds the item table once, skips ids it does not know, and names a failure while the rest go', async (t) => {
  const s = stand(t);
  const a = s.withBlocks(s.mod('pak30'));
  const b = s.withBlocks(s.mod('pak31'));
  const c = s.mod('pak32');
  const stuck = s.mod('pak33');
  const remove = s.installer.remove.bind(s.installer);
  s.installer.remove = ((files: { relPath: string }[], opts: unknown) => {
    if (files[0]?.relPath === 'pak33_dir.vpk') throw new Error('in use');
    return remove(files as never, opts as never);
  }) as never;

  const r = await s.call('mods:removeMany', [a.id, b.id, 'no-such-id', c.id, stuck.id]);
  assert.deepEqual(r, { ok: true, removed: 3, errors: ['pak33 mod: in use'] });
  assert.equal(s.refreshed(), 1, 'one rebuild for the batch');
  assert.deepEqual(s.files(), ['pak33_dir.vpk']);
  assert.deepEqual(s.library.list().map((x) => x.id), [stuck.id], 'the one that failed stays listed');
  assert.deepEqual(await s.call('mods:removeMany', 'not a list'), { ok: true, removed: 0, errors: [] });
});

test('switching a selection skips what is already there, rebuilds once, and names a failure', async (t) => {
  const s = stand(t);
  const a = s.withBlocks(s.mod('pak30'));
  const b = s.mod('pak31');
  s.library.setEnabled(b.id, false);
  fs.renameSync(path.join(s.lang, 'pak31_dir.vpk'), path.join(s.lang, 'pak31_dir.vpk.off'));
  const stuck = s.mod('pak32');
  const setEnabled = s.installer.setEnabled.bind(s.installer);
  s.installer.setEnabled = ((files: { relPath: string }[], on: boolean, id: string) => {
    if (files[0]?.relPath === 'pak32_dir.vpk') throw new Error('in use');
    return setEnabled(files as never, on, id);
  }) as never;

  const r = await s.call('mods:setEnabledMany', [a.id, b.id, stuck.id, 'no-such-id'], false);
  assert.deepEqual(r, { ok: true, changed: 1, errors: ['pak32 mod: in use'] }, 'b was off already');
  assert.equal(s.refreshed(), 1);
  assert.deepEqual(s.files(), ['pak30_dir.vpk.off', 'pak31_dir.vpk.off', 'pak32_dir.vpk']);
});

test('removing one mod takes its files and its record; a pack goes whole; a failure is the reason', async (t) => {
  const s = stand(t);
  const rec = s.withBlocks(s.mod('pak30'));
  assert.deepEqual(await s.call('mods:remove', rec.id), { ok: true });
  assert.deepEqual(s.files(), []);
  assert.equal(s.refreshed(), 1);

  const pack = s.library.add({ kind: 'pack', name: 'Pack', categoryId: 'combined', fileRef: null, files: [] } as never);
  const packs: string[] = [];
  s.installer.removePackFully = ((p: LibRecord) => { packs.push(p.id); }) as never;
  assert.deepEqual(await s.call('mods:remove', pack.id), { ok: true });
  assert.deepEqual(packs, [pack.id]);

  const stuck = s.mod('pak31');
  s.installer.remove = (() => { throw new Error('in use'); }) as never;
  assert.deepEqual(await s.call('mods:remove', stuck.id), { error: 'in use' });
  assert.ok(s.library.find(stuck.id), 'still listed');
  assert.deepEqual(await s.call('mods:remove', 'no-such-id'), { error: say('Мод не найден') });
});

test('before a terrain goes in, the map archive already there is named as ours, Minify\'s or somebody else\'s', async (t) => {
  const s = stand(t);
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: false }, 'no maps folder');
  const maps = path.join(s.lang, 'maps');
  fs.mkdirSync(maps);
  fs.writeFileSync(path.join(maps, 'readme.txt'), 'not a pak');
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: false });

  fs.writeFileSync(path.join(maps, 'dota.vpk'), buildVpk([entry('maps/dota.vpk_c', 'a terrain')]));
  s.library.add({ name: 'Our terrain', categoryId: 'terrains', fileRef: 'x', files: [{ root: 'lang', relPath: 'maps\\dota.vpk' }] } as never);
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: false }, 'ours, by the library, whatever its slashes');

  fs.writeFileSync(path.join(maps, 'other.vpk'), buildVpk([entry('maps/other.vmap_c', 'somebody\'s')]));
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: true, owner: 'unknown', file: 'other.vpk' });

  fs.writeFileSync(path.join(maps, 'minify.vpk'), buildVpk([entry('minify_version.txt', '1.0'), entry('maps/dota.vmap_c', 'x')]));
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: true, owner: 'minify', file: 'minify.vpk' }, 'Minify is named over an unknown file');

  s.installer.langFolder = (() => { throw new Error('no game path'); }) as never;
  assert.deepEqual(await s.call('mods:mapsOwner'), { present: false });
});
