/* Combined packs through the channels the window calls (src/ipc-packs.ts).
 *
 * test/packs.test.ts proves the installer builds and takes apart a pack archive. This is the
 * layer above it, where the library has to follow: combining removes the standalone records it
 * absorbed, taking a member out puts one back, and a pack left with no members stops existing
 * instead of lingering as an empty row. A slip here loses a user's mod from the list while its
 * bytes sit in the store, or leaves two records claiming one file.
 *
 * The installer and the library are the real ones over a temporary game folder, and the pack is
 * deployed the way main.js deploys it.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as vpk from '../src/vpk.ts';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { registerPacksIpc } from '../src/ipc-packs.ts';
import type { LibRecord } from '../src/types.ts';
import { entry } from './helpers/vpk-entry.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const HOOK = 'models/items/pudge/hook/hook.vmdl_c';
const BLADE = 'models/items/juggernaut/blade/blade.vmdl_c';
const WINGS = 'models/items/queenofpain/wings/wings.vmdl_c';

function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-ipc-packs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'the game\'s own archive');
  const userData = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userData, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userData);
  let masterSweeps = 0;

  // as main.js does it: build the archive, keep what it wrote on the record
  const deployAndApply = (pack: LibRecord) => {
    const { files, conflicts } = installer.deployPack(pack);
    library.update(pack.id, { files, members: pack.members });
    return conflicts;
  };
  const channels = registerAgainst(() => registerPacksIpc({
    afterDeployMaster: () => { masterSweeps++; }, deployAndApply, installer, library,
  } as never));
  const call = (channel: string, ...args: unknown[]) => channels.get(channel)!({}, ...args);

  /** An installed standalone mod: its archive in the language folder, and its library record. */
  const put = (slot: string, name: string, inner: string) => {
    fs.writeFileSync(path.join(lang, `${slot}_dir.vpk`), vpk.buildVpk([entry(inner, `${name} bytes`)]));
    return library.add({ name, categoryId: 'heroes', fileRef: name, files: [{ root: 'lang', relPath: `${slot}_dir.vpk` }] });
  };

  /** Inner paths the game would find in a mod's deployed archive, volumes and all. */
  const innerPaths = (rec: LibRecord) => {
    const dirFile = rec.files.find((f) => /_dir\.vpk$/i.test(f.relPath))!.relPath;
    const base = dirFile.replace(/_dir\.vpk$/i, '');
    const merged = vpk.mergeVpkToSingle(
      path.join(lang, dirFile),
      (i) => path.join(lang, `${base}_${String(i).padStart(3, '0')}.vpk`),
    );
    return vpk.readVpkEntries(merged, 'mem').map((e) => vpk.entryPath(e)).sort();
  };

  const packs = () => library.list().filter((r) => r.kind === 'pack');
  const names = () => library.list().filter((r) => r.kind !== 'pack').map((r) => r.name).sort();
  return { call, put, innerPaths, library, packs, names, masterSweeps: () => masterSweeps };
}

test('combining two mods leaves one pack in the library, holding both, and no standalone copies', async (t) => {
  const s = stand(t);
  const hook = s.put('pak10', 'Pudge Hook', HOOK);
  const blade = s.put('pak11', 'Jugg Blade', BLADE);

  const r = await s.call('packs:combine', { modIds: [hook.id, blade.id], name: '  My pack  ' });

  assert.equal(r.ok, true, r.error);
  assert.equal(r.pack.name, 'My pack', 'the name is trimmed');
  assert.deepEqual(s.names(), [], 'the two standalone records are gone');
  assert.equal(s.packs().length, 1);
  assert.deepEqual(s.packs()[0].members!.map((m) => m.name).sort(), ['Jugg Blade', 'Pudge Hook']);
  assert.deepEqual(s.innerPaths(s.packs()[0]), [BLADE, HOOK].sort(), 'the game finds both mods in the one slot');
});

test('one mod is not a pack', async (t) => {
  const s = stand(t);
  const hook = s.put('pak10', 'Pudge Hook', HOOK);
  const r = await s.call('packs:combine', { modIds: [hook.id, 'no-such-id'] });
  assert.ok(r.error, 'refused');
  assert.deepEqual(s.names(), ['Pudge Hook'], 'and nothing was touched');
});

test('a pack combined with another takes in its members, and the other pack is gone', async (t) => {
  const s = stand(t);
  const a = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id], name: 'A' });
  const wings = s.put('pak12', 'QoP Wings', WINGS);
  const lone = s.put('pak13', 'Second', 'models/items/lina/arm/arm.vmdl_c');
  const b = await s.call('packs:combine', { modIds: [wings.id, lone.id], name: 'B' });

  const r = await s.call('packs:combine', { modIds: [a.pack.id, b.pack.id] });

  assert.equal(r.ok, true, r.error);
  assert.equal(s.packs().length, 1, 'the second pack was absorbed');
  assert.equal(s.packs()[0].id, a.pack.id, 'into the first one selected');
  assert.equal(s.packs()[0].members!.length, 4);
  assert.ok(s.innerPaths(s.packs()[0]).includes(WINGS));
});

test('adding a mod to a pack moves it in, and the standalone record goes', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id] });
  const wings = s.put('pak12', 'QoP Wings', WINGS);

  const r = await s.call('packs:addMembers', made.pack.id, [wings.id]);

  assert.equal(r.ok, true, r.error);
  assert.equal(r.added, 1);
  assert.deepEqual(s.names(), []);
  assert.ok(s.innerPaths(s.packs()[0]).includes(WINGS));
  assert.ok((await s.call('packs:addMembers', 'no-such-pack', [wings.id])).error, 'an unknown pack is refused');
});

test('switching a member off rebuilds the pack without it, and on again with it', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id] });
  const hookMember = made.pack.members.find((m: { name: string }) => m.name === 'Pudge Hook');

  assert.equal((await s.call('packs:setMemberEnabled', made.pack.id, hookMember.id, false)).ok, true);
  assert.deepEqual(s.innerPaths(s.packs()[0]), [BLADE]);
  assert.equal((await s.call('packs:setMemberEnabled', made.pack.id, hookMember.id, true)).ok, true);
  assert.deepEqual(s.innerPaths(s.packs()[0]), [BLADE, HOOK].sort());
  assert.ok((await s.call('packs:setMemberEnabled', made.pack.id, 'no-such-member', true)).error);
});

test('taking out the last member removes the pack itself', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id] });
  const [first, second] = made.pack.members;

  assert.deepEqual(await s.call('packs:removeMember', made.pack.id, first.id), { ok: true });
  assert.equal(s.packs()[0].members!.length, 1);
  assert.deepEqual(await s.call('packs:removeMember', made.pack.id, second.id), { ok: true, removedPack: true });
  assert.deepEqual(s.packs(), [], 'no empty pack is left behind');
});

test('extracting a member makes it a mod of its own again, and the rest stays packed', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id, s.put('pak12', 'QoP Wings', WINGS).id] });
  const hookMember = made.pack.members.find((m: { name: string }) => m.name === 'Pudge Hook');

  const r = await s.call('packs:extractMembers', made.pack.id, [hookMember.id]);

  assert.deepEqual(r, { ok: true, count: 1, names: ['Pudge Hook'] });
  assert.deepEqual(s.names(), ['Pudge Hook']);
  const hook = s.library.list().find((x: LibRecord) => x.name === 'Pudge Hook')!;
  assert.deepEqual(s.innerPaths(hook), [HOOK], 'deployed as its own archive');
  assert.deepEqual(s.innerPaths(s.packs()[0]), [BLADE, WINGS].sort());
});

test('extracting every member is the same as taking the pack apart', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id] });
  const sweeps = s.masterSweeps();
  const r = await s.call('packs:extractMembers', made.pack.id, made.pack.members.map((m: { id: string }) => m.id));
  assert.equal(r.removedPack, true);
  assert.deepEqual(s.packs(), []);
  assert.deepEqual(s.names(), ['Jugg Blade', 'Pudge Hook']);
  assert.ok(s.masterSweeps() > sweeps, 'the master switch gets its say over the files written');
});

test('disbanding puts every member back as a mod, a switched-off one still off', async (t) => {
  const s = stand(t);
  const made = await s.call('packs:combine', { modIds: [s.put('pak10', 'Pudge Hook', HOOK).id, s.put('pak11', 'Jugg Blade', BLADE).id] });
  const blade = made.pack.members.find((m: { name: string }) => m.name === 'Jugg Blade');
  await s.call('packs:setMemberEnabled', made.pack.id, blade.id, false);

  const r = await s.call('packs:disband', made.pack.id);

  assert.deepEqual(r, { ok: true, count: 2, names: r.names });
  assert.deepEqual(r.names.sort(), ['Jugg Blade', 'Pudge Hook']);
  assert.deepEqual(s.packs(), []);
  const back = Object.fromEntries(s.library.list().map((x: LibRecord) => [x.name, x.enabled !== false]));
  assert.deepEqual(back, { 'Pudge Hook': true, 'Jugg Blade': false });
  assert.ok((await s.call('packs:disband', made.pack.id)).error, 'a pack that is gone is refused');
});
