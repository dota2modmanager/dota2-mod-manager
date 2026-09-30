/* The app's log (src/app-log.ts): it keeps to its size, it copies to the mirror, and it never
 * throws at the code that calls it, whatever the disk says. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAppLog, LOG_MAX_BYTES } from '../src/app-log.ts';

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const at = () => new Date('2026-09-30T12:00:00.000Z');

test('a line lands in logs/app.log under userData, stamped with the time', (t) => {
  const dir = tmp(t);
  const log = createAppLog({ dir: () => dir, now: at });
  log.diag('whenReady');
  assert.equal(log.file(), path.join(dir, 'logs', 'app.log'));
  assert.equal(fs.readFileSync(log.file(), 'utf8'), '2026-09-30T12:00:00.000Z whenReady\n');
});

test('the folder is asked for on first use, not when the log is made', (t) => {
  const dir = tmp(t);
  let asked = 0;
  const log = createAppLog({ dir: () => { asked++; return dir; } });
  assert.equal(asked, 0, 'a portable copy moves userData after this is created');
  log.diag('one');
  log.diag('two');
  assert.equal(asked, 1);
});

test('past a megabyte the log moves aside and starts again', (t) => {
  const dir = tmp(t);
  const log = createAppLog({ dir: () => dir, now: at });
  fs.mkdirSync(path.dirname(log.file()), { recursive: true });
  fs.writeFileSync(log.file(), 'x'.repeat(LOG_MAX_BYTES + 1));
  log.diag('fresh');
  assert.equal(fs.statSync(`${log.file()}.1`).size, LOG_MAX_BYTES + 1, 'the old one is kept once');
  assert.equal(fs.readFileSync(log.file(), 'utf8'), '2026-09-30T12:00:00.000Z fresh\n');
});

test('every line is copied to the mirror', (t) => {
  const dir = tmp(t);
  const mirror = path.join(dir, 'mirror.log');
  const log = createAppLog({ dir: () => dir, mirror, now: at });
  log.diag('a');
  log.diag('b');
  assert.equal(fs.readFileSync(mirror, 'utf8'), fs.readFileSync(log.file(), 'utf8'));
});

test('a log that cannot be written is silence, not a crash', (t) => {
  const dir = tmp(t);
  const blocked = path.join(dir, 'a-file');
  fs.writeFileSync(blocked, 'not a folder');
  const log = createAppLog({ dir: () => blocked, mirror: path.join(blocked, 'nope.log') });
  assert.doesNotThrow(() => log.diag('still here'));
});
