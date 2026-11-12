// Work a step at a time (src/steps.ts): drain, runSteps, and stopping runSteps between two steps (issue #425).
import test from 'node:test';
import assert from 'node:assert/strict';

import { drain, runSteps, PAUSE } from '../src/steps.ts';

function* count(to: number, seen: number[], closed: { yes: boolean }) {
  try {
    for (let i = 1; i <= to; i++) {
      seen.push(i);
      yield PAUSE;
    }
    return seen.length;
  } finally {
    closed.yes = true;
  }
}

test('drain and runSteps give the same answer', async () => {
  assert.equal(drain(count(3, [], { yes: false })), 3);
  assert.equal(await runSteps(count(3, [], { yes: false })), 3);
});

test('an abort stops between steps, closes the generator and rejects with the reason', async () => {
  const seen: number[] = [];
  const closed = { yes: false };
  const ctl = new AbortController();
  const run = runSteps(count(1000, seen, closed), ctl.signal);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  ctl.abort(new Error('cancelled by the user'));
  await assert.rejects(run, /cancelled by the user/);
  assert.ok(seen.length > 0 && seen.length < 1000, `stopped part way, after ${seen.length}`);
  assert.equal(closed.yes, true, 'its finally ran, so a journal inside it can roll back');
});

test('a signal aborted before the start runs no step at all', async () => {
  const seen: number[] = [];
  const closed = { yes: false };
  await assert.rejects(runSteps(count(5, seen, closed), AbortSignal.abort()), { name: 'AbortError' });
  assert.deepEqual(seen, []);
});

test('a signal that never fires changes nothing', async () => {
  assert.equal(await runSteps(count(4, [], { yes: false }), new AbortController().signal), 4);
});

test('a build that holds a write journal across steps leaves nothing behind when aborted', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { FileTx } = await import('../src/file-tx.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steps-425-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pak = path.join(dir, 'pak40_dir.vpk');

  function* build() {
    const tx = new FileTx();
    try {
      tx.write(pak, Buffer.from('half a pak'));
      yield PAUSE;
      yield PAUSE;
      tx.write(pak, Buffer.from('the whole pak'));
      tx.commit();
    } finally {
      if (!tx.done) tx.rollback();
    }
  }
  const ctl = new AbortController();
  const run = runSteps(build(), ctl.signal);
  await new Promise((r) => setImmediate(r));
  assert.equal(fs.existsSync(pak), true, 'the first step wrote');
  ctl.abort();
  await assert.rejects(run, { name: 'AbortError' });
  assert.equal(fs.existsSync(pak), false, 'the rollback took the half-written pak away');
});
