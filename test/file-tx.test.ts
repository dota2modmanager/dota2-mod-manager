// The transaction is the thing standing between a failed install and somebody else's game
// folder, so it is pinned on the case that matters: a step throws halfway through, and the
// folder has to look exactly as it did before the first step. Both directions count - a
// rollback that misses a file leaves rubbish, and a commit that misses one leaves .mmtx
// files sitting in the game folder forever.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileTx, copyInto, writeInto } from '../src/file-tx.ts';

function tree(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-tx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Everything under a folder as "relative path -> contents", so two states can be compared. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(full); }
      else out[rel] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(root);
  return out;
}

const put = (root: string, rel: string, text: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};

test('a committed write stays, and leaves no .mmtx behind', (t) => {
  const root = tree(t);
  put(root, 'pak10_dir.vpk', 'old');
  FileTx.run((tx) => {
    tx.write(path.join(root, 'pak10_dir.vpk'), Buffer.from('new'));
    tx.write(path.join(root, 'pak11_dir.vpk'), Buffer.from('fresh'));
  });
  assert.deepEqual(snapshot(root), { 'pak10_dir.vpk': 'new', 'pak11_dir.vpk': 'fresh' });
});

test('a failure halfway through leaves the folder exactly as it was', (t) => {
  const root = tree(t);
  put(root, 'pak10_dir.vpk', 'first mod');
  put(root, 'keep/me.txt', 'untouched');
  const before = snapshot(root);

  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'pak10_dir.vpk'), Buffer.from('overwritten'));
    tx.write(path.join(root, 'pak11_dir.vpk'), Buffer.from('brand new'));
    tx.write(path.join(root, 'deep/nested/pak12_dir.vpk'), Buffer.from('deeper'));
    throw new Error('disk full');
  }), /disk full/);

  assert.deepEqual(snapshot(root), before);
});

test('switching a mod off is all its files or none of them', (t) => {
  const root = tree(t);
  for (const n of ['pak10_dir.vpk', 'pak10_000.vpk', 'pak10_001.vpk']) put(root, n, n);
  const before = snapshot(root);

  assert.throws(() => FileTx.run((tx) => {
    tx.move(path.join(root, 'pak10_dir.vpk'), path.join(root, 'pak10_dir.vpk.off'));
    tx.move(path.join(root, 'pak10_000.vpk'), path.join(root, 'pak10_000.vpk.off'));
    throw new Error('Dota locked the third one');
  }), /locked/);

  assert.deepEqual(snapshot(root), before, 'no half-disabled mod');
});

test('a removed file comes back on rollback and is really gone on commit', (t) => {
  const root = tree(t);
  put(root, 'pak10_dir.vpk', 'the mod');
  const before = snapshot(root);

  assert.throws(() => FileTx.run((tx) => {
    tx.remove(path.join(root, 'pak10_dir.vpk'));
    throw new Error('manifest write failed');
  }), /manifest/);
  assert.deepEqual(snapshot(root), before);

  FileTx.run((tx) => tx.remove(path.join(root, 'pak10_dir.vpk')));
  assert.deepEqual(snapshot(root), {});
});

test('a whole folder can be taken out and put back', (t) => {
  const root = tree(t);
  put(root, 'tools/Compiler/compiler.exe', 'binary');
  put(root, 'tools/Compiler/data/x.txt', 'data');
  const before = snapshot(root);

  assert.throws(() => FileTx.run((tx) => {
    tx.remove(path.join(root, 'tools', 'Compiler'));
    throw new Error('nope');
  }), /nope/);
  assert.deepEqual(snapshot(root), before);
});

test('folders the transaction created are taken back down', (t) => {
  const root = tree(t);
  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'a/b/c/file.vpk'), Buffer.from('x'));
    throw new Error('later step failed');
  }), /later step/);
  assert.deepEqual(snapshot(root), {}, 'a, a/b and a/b/c are gone too');
});

test('a folder that already had something in it is left alone', (t) => {
  const root = tree(t);
  put(root, 'a/b/other.txt', 'somebody else lives here');
  const before = snapshot(root);
  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'a/b/mine.vpk'), Buffer.from('x'));
    throw new Error('fail');
  }), /fail/);
  assert.deepEqual(snapshot(root), before);
});

test('overwriting restores the original bytes, not just the name', (t) => {
  const root = tree(t);
  put(root, 'fonts/Radiance.ttf', 'valve original');
  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'fonts/Radiance.ttf'), Buffer.from('mod font'));
    throw new Error('second font failed');
  }), /second font/);
  assert.equal(fs.readFileSync(path.join(root, 'fonts/Radiance.ttf'), 'utf-8'), 'valve original');
});

test('rollback does not throw when the world moved under it', (t) => {
  const root = tree(t);
  put(root, 'pak10_dir.vpk', 'mod');
  const logged: string[] = [];
  const tx = new FileTx((m) => logged.push(m));
  tx.write(path.join(root, 'pak11_dir.vpk'), Buffer.from('x'));
  tx.remove(path.join(root, 'pak10_dir.vpk'));
  // somebody deleted what we parked (an antivirus, a cleaner, the user)
  fs.rmSync(path.join(root, `pak10_dir.vpk.${tx.id}.mmtx`), { force: true });

  assert.doesNotThrow(() => tx.rollback());
  assert.equal(fs.existsSync(path.join(root, 'pak11_dir.vpk')), false, 'what could be undone was');
  assert.equal(logged.length, 1, 'and what could not be is written down');
});

test('commit and rollback are each once', (t) => {
  const root = tree(t);
  put(root, 'a.vpk', 'a');
  const tx = new FileTx();
  tx.write(path.join(root, 'a.vpk'), Buffer.from('b'));
  tx.commit();
  tx.rollback(); // a late rollback after a good commit must not undo the change
  assert.equal(fs.readFileSync(path.join(root, 'a.vpk'), 'utf-8'), 'b');
});

test('a copy over an existing file is undone to the original, and a copy into a new folder takes the folder too', (t) => {
  const root = tree(t);
  const src = put(root, 'incoming/mod.vpk', 'new');
  put(root, 'lang/pak10_dir.vpk', 'old');
  const before = snapshot(root);
  assert.throws(() => FileTx.run((tx) => {
    tx.copy(src, path.join(root, 'lang', 'pak10_dir.vpk'));
    tx.copy(src, path.join(root, 'fresh', 'deep', 'pak11_dir.vpk'));
    assert.equal(fs.readFileSync(path.join(root, 'lang', 'pak10_dir.vpk'), 'utf-8'), 'new');
    throw new Error('the disk filled up');
  }), /the disk filled up/);
  assert.deepEqual(snapshot(root), before, 'the original is back and the folder made for the copy is gone');
});

test('copyInto and writeInto go through a transaction when handed one, and straight to disk when not', (t) => {
  const root = tree(t);
  const src = put(root, 'incoming/mod.vpk', 'bytes');

  copyInto(src, path.join(root, 'direct', 'a.vpk'));
  writeInto('written', path.join(root, 'direct', 'b.vpk'));
  assert.equal(fs.readFileSync(path.join(root, 'direct', 'a.vpk'), 'utf-8'), 'bytes');
  assert.equal(fs.readFileSync(path.join(root, 'direct', 'b.vpk'), 'utf-8'), 'written');

  const before = snapshot(root);
  assert.throws(() => FileTx.run((tx) => {
    copyInto(src, path.join(root, 'tx', 'c.vpk'), tx);
    writeInto('written', path.join(root, 'tx', 'd.vpk'), tx);
    throw new Error('stop');
  }));
  assert.deepEqual(snapshot(root), before, 'both were part of the change that was taken back');
});
