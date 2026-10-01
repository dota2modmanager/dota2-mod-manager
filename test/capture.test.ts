/* The screenshot harness trying again when the compositor has no frame yet (src/capture.ts).
 *
 * The Linux start check failed once with UnknownVizError on a change that did not touch the app.
 * These hold the retry to what it promises: a picture when a later try works, the real error when
 * none does, a log line for every failure, and no delay when the first try works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { captureWithRetry } from '../src/capture.ts';

const noWait = () => Promise.resolve();

test('a capture that fails twice with UnknownVizError and then works returns the picture', async () => {
  let calls = 0;
  const said: string[] = [];
  const img = await captureWithRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('UnknownVizError');
    return 'picture';
  }, { tries: 3, log: (m) => said.push(m), sleep: noWait });
  assert.equal(img, 'picture');
  assert.equal(calls, 3);
  assert.equal(said.length, 2, 'each failed try is logged, so a capture that keeps failing stays visible');
  assert.match(said[0], /attempt 1 of 3 failed: UnknownVizError/);
});

test('a capture that never works still fails, with the last error', async () => {
  let calls = 0;
  await assert.rejects(
    captureWithRetry(async () => { calls++; throw new Error(`UnknownVizError ${calls}`); }, { tries: 3, sleep: noWait }),
    /UnknownVizError 3/,
  );
  assert.equal(calls, 3, 'it stops after the tries it was given');
});

test('a capture that works the first time is not delayed', async () => {
  let waited = 0;
  const img = await captureWithRetry(async () => 'picture', { sleep: async () => { waited++; } });
  assert.equal(img, 'picture');
  assert.equal(waited, 0);
});

test('main.js takes its screenshots through the retry', () => {
  const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /captureWithRetry\(\(\) => win\.webContents\.capturePage\(\)/,
    'the harness calls capturePage directly again, and one missing frame fails the check');
});
