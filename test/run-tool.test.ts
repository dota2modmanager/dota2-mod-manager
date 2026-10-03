/* Opening a tool the catalog installed (misc:runTool, src/ipc-misc.ts).
 *
 * The channel runs the first .exe it finds in a folder, so which folder is the whole question. It
 * once joined the name unchecked, and "../../.." pointed it at any folder on the disk. It now takes
 * only a name an installed tool's record carries, and only a folder directly under the tools
 * folder. None of that had a test.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerMiscIpc } from '../src/ipc-misc.ts';
import { t as say } from '../src/i18n.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

function stand(t: TestContext, toolRecords: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const toolsDir = path.join(dir, 'userdata', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  const opened: string[] = [];
  const library = { list: () => toolRecords.map((relPath) => ({ id: relPath, files: [{ root: 'tools', relPath }] })) };
  const installer = { toolsDir, downloadCacheSize: () => 0, clearDownloadCache: () => {} };
  const channels = registerAgainst(() => registerMiscIpc({ installer, library } as never), {
    shell: { openPath: (p: string) => { opened.push(p); return Promise.resolve(''); }, openExternal: () => {} },
  });
  const run = (name: unknown) => channels.get('misc:runTool')!({}, name);
  return { dir, toolsDir, opened, run };
}

test('the first program found in an installed tool\'s folder is opened, nested folders included', async (t) => {
  const s = stand(t, ['Some Tool']);
  fs.mkdirSync(path.join(s.toolsDir, 'Some Tool', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(s.toolsDir, 'Some Tool', 'readme.txt'), 'read me');
  fs.writeFileSync(path.join(s.toolsDir, 'Some Tool', 'bin', 'Tool.EXE'), 'MZ');
  assert.deepEqual(await s.run('Some Tool'), { ok: true });
  assert.deepEqual(s.opened, [path.join(s.toolsDir, 'Some Tool', 'bin', 'Tool.EXE')]);
});

test('a name no installed tool carries is refused, and nothing is opened', async (t) => {
  const s = stand(t, ['Some Tool']);
  fs.mkdirSync(path.join(s.toolsDir, 'Other'), { recursive: true });
  fs.writeFileSync(path.join(s.toolsDir, 'Other', 'other.exe'), 'MZ');
  for (const name of ['Other', '..', '../..', '', null, 42]) {
    assert.deepEqual(await s.run(name), { error: say('Инструмент не найден') }, String(name));
  }
  assert.deepEqual(s.opened, []);
});

test('a record that names a path out of the tools folder is refused even though the library lists it', async (t) => {
  // a manifest edited by hand, or written by something other than this app
  const s = stand(t, ['../..', '../outside', 'Some Tool/../../outside']);
  fs.mkdirSync(path.join(s.dir, 'outside'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'outside', 'evil.exe'), 'MZ');
  for (const name of ['../..', '../outside', 'Some Tool/../../outside']) {
    assert.deepEqual(await s.run(name), { error: say('Инструмент не найден') }, name);
  }
  assert.deepEqual(s.opened, []);
});

test('a tool folder with no program in it, or gone from the disk, says so', async (t) => {
  const s = stand(t, ['Empty', 'Gone']);
  fs.mkdirSync(path.join(s.toolsDir, 'Empty'), { recursive: true });
  fs.writeFileSync(path.join(s.toolsDir, 'Empty', 'notes.txt'), 'no program here');
  assert.deepEqual(await s.run('Empty'), { error: say('exe не найден в папке инструмента') });
  const gone = await s.run('Gone');
  assert.ok(gone.error && /ENOENT|no such file/i.test(gone.error), gone.error);
  assert.deepEqual(s.opened, []);
});
