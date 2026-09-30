/* Bytes under a folder (src/folder-size.ts): what Settings shows beside each cache and the removal
 * window beside the app's data. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { folderSize } from '../src/folder-size.ts';

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('files at every depth count, and folders themselves count nothing', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.png'), Buffer.alloc(10));
  fs.mkdirSync(path.join(dir, 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'deep', 'b.zip'), Buffer.alloc(200));
  fs.writeFileSync(path.join(dir, 'deep', 'deeper', 'c.vpk'), Buffer.alloc(3000));
  fs.mkdirSync(path.join(dir, 'empty'));
  assert.equal(folderSize(dir), 3210);
});

test('a folder that is not there holds nothing, and a file in its place is not a folder', (t) => {
  const dir = tmp(t);
  assert.equal(folderSize(path.join(dir, 'never-made')), 0);
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  assert.equal(folderSize(file), 0);
});
