// Room on the disk before a mod is written (src/disk-space.ts, issue #426).
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { ensureSpace, freeBytes, SPACE_MARGIN } from '../src/disk-space.ts';

const MB = 1024 * 1024;
const disk = (free: number) => () => ({ bavail: free / 4096, bsize: 4096 });

test('freeBytes multiplies free blocks by block size', () => {
  assert.equal(freeBytes(os.tmpdir(), disk(800 * MB)), 800 * MB);
});

test('freeBytes asks the nearest folder that exists', () => {
  const asked: string[] = [];
  const missing = path.join(os.tmpdir(), 'no-such-dir-426', 'deeper');
  const free = freeBytes(missing, (p) => {
    asked.push(p);
    if (p.includes('no-such-dir-426')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { bavail: 10, bsize: 4096 };
  });
  assert.equal(free, 40960);
  assert.equal(asked.at(-1), path.resolve(os.tmpdir()));
});

test('freeBytes is null when no folder up to the root answers', () => {
  assert.equal(freeBytes(os.tmpdir(), () => { throw new Error('ENOSYS'); }), null);
});

test('ensureSpace lets a write through when need plus the margin fits', () => {
  assert.doesNotThrow(() => ensureSpace(os.tmpdir(), 100 * MB, disk(100 * MB + SPACE_MARGIN)));
});

test('ensureSpace says how many megabytes are missing', () => {
  assert.throws(() => ensureSpace(os.tmpdir(), 500 * MB, disk(200 * MB)),
    (e: Error) => e.message.includes(String(300 + SPACE_MARGIN / MB)));
});

test('ensureSpace accepts bigint statfs values', () => {
  assert.doesNotThrow(() => ensureSpace(os.tmpdir(), MB, () => ({ bavail: 10n ** 6n, bsize: 4096n })));
});

test('ensureSpace lets the write through when the drive cannot be asked', () => {
  assert.doesNotThrow(() => ensureSpace(os.tmpdir(), 10 ** 12, () => { throw new Error('ENOSYS'); }));
});
