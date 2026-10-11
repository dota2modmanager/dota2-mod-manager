/* manifest.json and settings.json are replaced in one step (src/atomic-file.ts), so a process
 * killed mid-save leaves the old file or the new one. A cut-off manifest used to load as an empty
 * library, and every installed mod showed up as somebody else's file. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic } from '../src/atomic-file.ts';
import { Library } from '../src/library.ts';
import { Settings } from '../src/settings.ts';

function dir(t: TestContext): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-atomic-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Refuse fs.renameSync with `code` for the next `times` calls. */
function refuseRename(t: TestContext, code: string, times: number): () => number {
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    calls++;
    if (calls <= times) throw Object.assign(new Error(`${code}: refused`), { code });
    return real(from, to);
  }) as typeof fs.renameSync;
  t.after(() => { fs.renameSync = real; });
  return () => calls;
}

test('a write replaces the file and leaves nothing beside it', (t) => {
  const d = dir(t);
  const file = path.join(d, 'nested', 'settings.json');
  writeFileAtomic(file, 'first');
  writeFileAtomic(file, Buffer.from('second'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a rename refused for a moment by somebody holding the file is tried again', (t) => {
  const d = dir(t);
  const file = path.join(d, 'manifest.json');
  fs.writeFileSync(file, 'old');
  const calls = refuseRename(t, 'EBUSY', 2);
  writeFileAtomic(file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(calls(), 3);
  assert.deepEqual(fs.readdirSync(d), ['manifest.json']);
});

test('a file that stays held is written in place rather than not written at all', (t) => {
  const d = dir(t);
  const file = path.join(d, 'manifest.json');
  fs.writeFileSync(file, 'old');
  refuseRename(t, 'EPERM', 99);
  writeFileAtomic(file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(d), ['manifest.json']);
});

test('any other failure leaves the old file whole, takes the temporary one away and says so', (t) => {
  const d = dir(t);
  const file = path.join(d, 'manifest.json');
  fs.writeFileSync(file, 'old and whole');
  refuseRename(t, 'EIO', 1);
  assert.throws(() => writeFileAtomic(file, 'new'), /EIO/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old and whole');
  assert.deepEqual(fs.readdirSync(d), ['manifest.json']);
});

test('the library and the settings save through it', (t) => {
  const d = dir(t);
  const library = new Library(d);
  library.add({ name: 'kept', categoryId: 'heroes', files: [] });
  const settings = new Settings(d);
  settings.set('uiLang', 'en');
  const manifest = fs.readFileSync(path.join(d, 'manifest.json'), 'utf8');
  const saved = fs.readFileSync(path.join(d, 'settings.json'), 'utf8');
  refuseRename(t, 'EIO', 2);
  assert.throws(() => library.add({ name: 'lost', categoryId: 'heroes', files: [] }), /EIO/);
  assert.throws(() => settings.set('uiLang', 'ru'), /EIO/);
  assert.equal(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'), manifest, 'the manifest on disk is the last whole one');
  assert.equal(fs.readFileSync(path.join(d, 'settings.json'), 'utf8'), saved);
});
