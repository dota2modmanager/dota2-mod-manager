/* A process killed in the middle of a change, at every point it could be killed at.
 *
 * test/file-tx.test.ts pins what happens when a step throws: the transaction is still running
 * and puts the folder back itself. This pins the other case, the one nothing in the process can
 * answer: the process is gone. Task Manager, Windows Update, a power cut. What is left is a
 * folder with some steps taken and a journal saying which ones (src/file-tx-journal.ts), and the
 * next start has to turn that into one whole state.
 *
 * Each scenario is one of the changes the app makes - an install with its record, switching a
 * mod off and on, removing one, trading two slots, laying the library out - run by
 * test/helpers/tx-crash-child.ts and killed with SIGKILL at point 1, then 2, and so on until a
 * run gets to the end. After every kill the folder is recovered the way src/services.ts does on
 * start, and has to be byte for byte the folder before the change if the kill came before the
 * commit line, and the folder after it if it came at or after. Game folder and library both:
 * paks without a record, or a record for paks that are not there, fail it the same as a lost pak.
 * Recovery is then run a second time and must change nothing; and recovery itself is killed at
 * each of its own points and run again, which must still end in that same state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { recoverJournals, readJournal } from '../src/file-tx-journal.ts';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'tx-crash-child.ts');
const SCENARIOS = ['steps', 'install', 'disable', 'enable', 'remove', 'swap', 'layout'];
const PARALLEL = Math.max(2, Math.min(8, os.availableParallelism()));

type Run = { code: number | null; out: string; err: string };

function child(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', CHILD, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

/** What a finished run said about itself, or null for a run that was killed. */
function report(run: Run): { points: number; commitAt: number } | null {
  if (run.code === 2) throw new Error(run.err);
  const line = run.out.trim().split('\n').pop() || '';
  return line.startsWith('{') ? JSON.parse(line) : null;
}

/** Every file under a folder with its bytes, except the journals and the download cache. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set(['userdata/tx', 'userdata/downloads']);
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (skip.has(rel)) continue;
      if (e.isDirectory()) { out[`${rel}/`] = ''; walk(full); } else out[rel] = fs.readFileSync(full, 'latin1');
    }
  };
  walk(root);
  return out;
}

async function pool<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }));
  return results;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-crash-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

let seeded: string | null = null;
async function seedOnce(): Promise<string> {
  if (seeded) return seeded;
  const dir = path.join(work, 'seed');
  const run = await child(['seed', dir]);
  assert.equal(run.code, 0, run.err);
  seeded = dir;
  return dir;
}

let copies = 0;
async function fresh(): Promise<string> {
  const dir = path.join(work, `run${copies++}`);
  fs.cpSync(await seedOnce(), dir, { recursive: true });
  return dir;
}

for (const scenario of SCENARIOS) {
  test(`${scenario}: killed at any point, the next start leaves the folder and the library as before or as after`, async () => {
    const before = snapshot(await seedOnce());
    const whole = await fresh();
    const done = report(await child([scenario, whole, '0']));
    assert.ok(done, `${scenario} ran to the end`);
    const after = snapshot(whole);
    assert.notDeepEqual(after, before, `${scenario} changed something, so there is something to lose`);
    assert.ok(done.commitAt > 0, `${scenario} went through one transaction`);
    assert.ok(done.points >= 6, `${scenario} passed ${done.points} points, enough to kill it in the middle`);

    const outcomes = await pool(Array.from({ length: done.points }, (_, i) => async () => {
      const at = i + 1;
      const dir = await fresh();
      const killed = await child([scenario, dir, String(at)]);
      assert.equal(report(killed), null, `${scenario} was killed at point ${at}`);
      const journals = path.join(dir, 'userdata', 'tx');
      const pending = fs.existsSync(journals) ? fs.readdirSync(journals) : [];
      recoverJournals(journals);
      const once = snapshot(dir);
      recoverJournals(journals);
      assert.deepEqual(snapshot(dir), once, `${scenario} at ${at}: a second recovery changes nothing`);
      return { at, once, pending: pending.length };
    }));

    for (const { at, once } of outcomes) {
      const want: 'before' | 'after' = at < done.commitAt ? 'before' : 'after';
      assert.deepEqual(once, want === 'before' ? before : after,
        `${scenario} killed at point ${at} of ${done.points} (commit at ${done.commitAt}) should recover to ${want}`);
    }
    // the kills right before and right at the commit line are the ones that decide: both must
    // have left a journal, or the comparison above proved nothing about recovery
    assert.ok(outcomes.filter((o) => o.at >= done.commitAt - 1 && o.at <= done.commitAt).every((o) => o.pending === 1));
  });
}

test('recovery killed at any of its own points ends in the same state when it runs again', async () => {
  // A journal names absolute paths, so a killed folder cannot be copied and recovered elsewhere:
  // every attempt kills the change afresh in a folder of its own, then kills recovery in it.
  const killedAt = async (scenario: string, at: number) => {
    const dir = await fresh();
    assert.equal(report(await child([scenario, dir, String(at)])), null);
    return dir;
  };
  const before = snapshot(await seedOnce());
  for (const scenario of ['install', 'swap']) {
    const whole = await fresh();
    const done = report(await child([scenario, whole, '0']));
    assert.ok(done);
    const after = snapshot(whole);
    // the last point before the commit (undo everything) and the commit itself (finish everything)
    for (const [at, want] of [[done.commitAt - 1, before], [done.commitAt, after]] as const) {
      const full = report(await child(['recover', await killedAt(scenario, at), '0']));
      assert.ok(full && full.points >= 4, 'recovery has points to be killed at');
      await pool(Array.from({ length: full.points }, (_, i) => async () => {
        const k = i + 1;
        const dir = await killedAt(scenario, at);
        assert.equal(report(await child(['recover', dir, String(k)])), null, `recovery killed at ${k}`);
        recoverJournals(path.join(dir, 'userdata', 'tx'));
        assert.deepEqual(snapshot(dir), want, `${scenario} at ${at}, recovery killed at ${k} of ${full.points}`);
      }));
    }
  }
});

test('a journal line cut short by a power failure ends the journal there', () => {
  const dir = fs.mkdtempSync(path.join(work, 'torn-'));
  const file = path.join(dir, 'x.txlog');
  const a = path.join(dir, 'a.vpk');
  fs.writeFileSync(file, `${JSON.stringify({ what: 'unwrite', dest: a, parked: null })}\n{"what":"unwr`);
  assert.deepEqual(readJournal(file), { steps: [{ what: 'unwrite', dest: a, parked: null }], committed: false });
  fs.writeFileSync(a, 'half written');
  assert.deepEqual(recoverJournals(dir), { undone: 1, finished: 0 });
  assert.equal(fs.existsSync(a), false, 'the step the whole line described is undone');
  assert.deepEqual(fs.readdirSync(dir), [], 'and the journal is gone');
});

test('no journal folder, or an empty one, is nothing to recover', () => {
  assert.deepEqual(recoverJournals(path.join(work, 'missing')), { undone: 0, finished: 0 });
  assert.deepEqual(recoverJournals(null), { undone: 0, finished: 0 });
});
