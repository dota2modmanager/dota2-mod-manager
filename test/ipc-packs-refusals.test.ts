/* The pack channels when they have to say no (src/ipc-packs.ts).
 *
 * test/ipc-packs.test.ts walks every pack operation that works, over a real installer and library.
 * What it never reached were the refusals: a pack or a member that is not there, a combine of
 * fewer than two mods, an add with nothing compatible, and a failure in the middle of a rebuild,
 * which has to come back as its reason rather than as an exception in the window. The branches of
 * the module were 59% covered. The library and installer here are stand-ins: the point is which
 * answer comes back, not what reaches the disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { registerPacksIpc } from '../src/ipc-packs.ts';
import { t as say } from '../src/i18n.ts';
import type { LibRecord } from '../src/types.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const mod = (id: string, extra: Partial<LibRecord> = {}): LibRecord => ({
  id, name: id, categoryId: 'heroes', styleLabel: null, fileRef: id, preview: null, enabled: true, installedAt: 0,
  files: [{ root: 'lang', relPath: `${id}_dir.vpk` }], ...extra,
} as LibRecord);

function stand({ failDeploy = false } = {}) {
  const records = new Map<string, LibRecord>([
    ['a', mod('a')], ['b', mod('b')],
    ['font', mod('font', { categoryId: 'fonts', files: [{ root: 'fonts', relPath: 'x.ttf' }] })],
    ['pack', mod('pack', { kind: 'pack', files: [], members: [{ id: 'm1', name: 'Member', categoryId: 'heroes', enabled: true } as never] })],
  ]);
  const library = {
    find: (id: string) => records.get(id) || null,
    add: () => { throw new Error('the disk is full'); },
    removeRecord: (id: string) => { records.delete(id); },
  };
  const installer = {
    packFolder: () => { throw new Error('the disk is full'); },
    packMemberFile: () => 'nowhere',
    addPackMemberFromRecord: () => ({ id: 'new' }),
    remove: () => {},
    removePackFully: () => { throw new Error('a file is held open'); },
    deployMemberAsMod: () => { throw new Error('a file is held open'); },
  };
  const deployAndApply = () => { if (failDeploy) throw new Error('the archive did not build'); return []; };
  const channels = registerAgainst(() => registerPacksIpc({ afterDeployMaster: () => {}, deployAndApply, installer, library } as never));
  return (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
}

test('a pack or a member that is not there is said so by every channel', async () => {
  const call = stand();
  const noPack = { error: say('Пак не найден') };
  for (const [ch, ...args] of [
    ['packs:addMembers', 'nope', ['a']], ['packs:setMemberEnabled', 'nope', 'm1', true], ['packs:removeMember', 'nope', 'm1'],
    ['packs:extractMembers', 'nope', ['m1']], ['packs:disband', 'nope'],
    // a record that is a mod and not a pack is not a pack either
    ['packs:disband', 'a'],
  ] as [string, ...unknown[]][]) {
    assert.deepEqual(await call(ch, ...args), noPack, ch);
  }
  assert.deepEqual(await call('packs:setMemberEnabled', 'pack', 'nobody', true), { error: say('Мод в паке не найден') });
  assert.deepEqual(await call('packs:removeMember', 'pack', 'nobody'), { error: say('Мод в паке не найден') });
});

test('a pack needs two mods, and fonts or cursors are not mods a pack can hold', async () => {
  const call = stand();
  assert.deepEqual(await call('packs:combine', { modIds: ['a'] }), { error: say('Выбери минимум 2 мода (или пак и мод / два пака)') });
  assert.deepEqual(await call('packs:combine', { modIds: ['a', 'font'] }), { error: say('Выбери минимум 2 мода (или пак и мод / два пака)') });
  assert.deepEqual(await call('packs:combine', {}), { error: say('Выбери минимум 2 мода (или пак и мод / два пака)') });
  assert.deepEqual(await call('packs:addMembers', 'pack', ['font', 'nope']), { error: say('Нет совместимых модов для добавления') });
});

test('a failure in the middle of a pack operation comes back as its reason, never as an exception', async () => {
  const call = stand({ failDeploy: true });
  assert.deepEqual(await call('packs:combine', { modIds: ['a', 'b'] }), { error: 'the disk is full' });
  assert.deepEqual(await call('packs:addMembers', 'pack', ['a']), { error: 'the archive did not build' });
  assert.deepEqual(await call('packs:setMemberEnabled', 'pack', 'm1', false), { error: 'the archive did not build' });
  assert.deepEqual(await call('packs:extractMembers', 'pack', ['m1']), { error: 'a file is held open' });
  assert.deepEqual(await call('packs:disband', 'pack'), { error: 'a file is held open' });
  // a fresh pack, so it holds only the one member: taking it out takes the pack with it, and that fails
  assert.deepEqual(await stand({ failDeploy: true })('packs:removeMember', 'pack', 'm1'), { error: 'a file is held open' });
});
