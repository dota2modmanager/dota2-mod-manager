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
import { Library } from '../src/library.ts';

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
  const parked = tx.staged.find((p) => path.basename(p).startsWith('pak10_dir.vpk.'));
  assert.ok(parked);
  fs.rmSync(parked, { force: true });

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

/** Make one fs call fail the way a full disk or a held file does, once, then behave again. */
function failOnce(t: TestContext, name: 'writeFileSync' | 'copyFileSync' | 'renameSync', code: string, when: (args: unknown[]) => boolean) {
  const live = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const real = live[name];
  let fired = false;
  live[name] = (...args: unknown[]) => {
    if (!fired && when(args)) {
      fired = true;
      throw Object.assign(new Error(`${code}: refused`), { code });
    }
    return real.apply(fs, args);
  };
  t.after(() => { live[name] = real; });
}

test('a write that fails after the original was parked brings the original back', (t) => {
  /* The undo used to be recorded after the write. A write refused halfway - the disk filled up
     on the new pak - had already renamed the original to .mmtx and had no undo to bring it back,
     so the rollback meant for exactly that failure left the mod under its parked name. */
  const root = tree(t);
  put(root, 'pak10_dir.vpk', 'the mod that was there');
  const before = snapshot(root);
  failOnce(t, 'writeFileSync', 'ENOSPC', (a) => String(a[0]).endsWith('pak10_dir.vpk'));
  assert.throws(() => FileTx.run((tx) => tx.write(path.join(root, 'pak10_dir.vpk'), 'new bytes')), /ENOSPC/);
  assert.deepEqual(snapshot(root), before);
});

test('a copy that fails after the original was parked brings the original back', (t) => {
  const root = tree(t);
  const src = put(root, 'incoming/mod.vpk', 'new');
  put(root, 'lang/pak10_dir.vpk', 'old');
  const before = snapshot(root);
  failOnce(t, 'copyFileSync', 'ENOSPC', () => true);
  assert.throws(() => FileTx.run((tx) => tx.copy(src, path.join(root, 'lang', 'pak10_dir.vpk'))), /ENOSPC/);
  assert.deepEqual(snapshot(root), before);
});

test('a move refused after its target was parked brings the target back and leaves the source', (t) => {
  const root = tree(t);
  put(root, 'a.vpk', 'moving');
  put(root, 'b.vpk', 'in the way');
  const before = snapshot(root);
  // the first rename parks b.vpk, the second is the move itself
  failOnce(t, 'renameSync', 'EBUSY', (a) => String(a[0]).endsWith('a.vpk'));
  assert.throws(() => FileTx.run((tx) => tx.move(path.join(root, 'a.vpk'), path.join(root, 'b.vpk'))), /EBUSY/);
  assert.deepEqual(snapshot(root), before);
});

test('a move from a source that is not there changes nothing at all', (t) => {
  const root = tree(t);
  put(root, 'b.vpk', 'would have been parked');
  const before = snapshot(root);
  assert.throws(() => FileTx.run((tx) => tx.move(path.join(root, 'gone.vpk'), path.join(root, 'b.vpk'))), /ENOENT/);
  assert.deepEqual(snapshot(root), before);
});

test('one file written twice in one change rolls back to the original, not to the first new version', (t) => {
  const root = tree(t);
  put(root, 'manifest.json', 'original');
  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'manifest.json'), 'first');
    tx.write(path.join(root, 'manifest.json'), 'second');
    throw new Error('later');
  }), /later/);
  assert.deepEqual(snapshot(root), { 'manifest.json': 'original' });

  FileTx.run((tx) => {
    tx.write(path.join(root, 'manifest.json'), 'first');
    tx.write(path.join(root, 'manifest.json'), 'second');
  });
  assert.deepEqual(snapshot(root), { 'manifest.json': 'second' }, 'and a commit leaves neither parked copy');
});

test('a change inside a change joins it, and undoes only its own steps when it throws', (t) => {
  /* A caller may catch an inner failure and carry on (src/ipc-packs.ts does, switching members
     off). The inner block has to leave the folder as it found it, and the outer one still commits. */
  const root = tree(t);
  put(root, 'kept.vpk', 'old');
  let inner: FileTx | null = null;
  FileTx.run((outer) => {
    outer.write(path.join(root, 'kept.vpk'), 'outer change');
    assert.throws(() => FileTx.run((tx) => {
      inner = tx;
      tx.write(path.join(root, 'inner.vpk'), 'inner change');
      throw new Error('inner refused');
    }), /inner refused/);
    assert.equal(inner, outer, 'the inner block ran in the outer change');
    assert.equal(fs.existsSync(path.join(root, 'inner.vpk')), false, 'its own step is undone at once');
  });
  assert.deepEqual(snapshot(root), { 'kept.vpk': 'outer change' });
});

test('an inner change that succeeds rolls back with the outer one', (t) => {
  const root = tree(t);
  assert.throws(() => FileTx.run(() => {
    FileTx.run((tx) => tx.write(path.join(root, 'a.vpk'), 'a'));
    throw new Error('outer refused');
  }), /outer refused/);
  assert.deepEqual(snapshot(root), {});
});

test('a library record written inside a change goes back with the files, on disk and in memory', (t) => {
  const root = tree(t);
  const userData = path.join(root, 'userdata');
  const library = new Library(userData);
  library.add({ name: 'kept', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }] });
  const manifest = fs.readFileSync(path.join(userData, 'manifest.json'), 'utf8');
  assert.throws(() => FileTx.run((tx) => {
    tx.write(path.join(root, 'lang', 'pak31_dir.vpk'), 'new mod');
    library.add({ name: 'new', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak31_dir.vpk' }] });
    throw new Error('the next pak was refused');
  }), /refused/);
  assert.deepEqual(library.list().map((r) => r.name), ['kept'], 'the record in memory is gone');
  assert.equal(fs.readFileSync(path.join(userData, 'manifest.json'), 'utf8'), manifest, 'and on disk');
  assert.equal(fs.existsSync(path.join(root, 'lang', 'pak31_dir.vpk')), false);
});

test('a change refuses a block that returns a promise, before it could commit half of it', (t) => {
  const root = tree(t);
  assert.throws(() => FileTx.run(async (tx) => { tx.write(path.join(root, 'a.vpk'), 'a'); }), /synchronous/);
  assert.deepEqual(snapshot(root), {});
});

test('with a journal folder set, a change that commits or rolls back leaves no journal behind', (t) => {
  const root = tree(t);
  const journals = path.join(root, 'tx');
  FileTx.journalDir = journals;
  t.after(() => { FileTx.journalDir = null; });
  FileTx.run((tx) => tx.write(path.join(root, 'game', 'a.vpk'), 'a'));
  assert.throws(() => FileTx.run((tx) => { tx.write(path.join(root, 'game', 'b.vpk'), 'b'); throw new Error('no'); }), /no/);
  FileTx.run(() => {}); // a change with no steps opens no journal at all
  assert.deepEqual(fs.existsSync(journals) ? fs.readdirSync(journals) : [], []);
  assert.deepEqual(snapshot(path.join(root, 'game')), { 'a.vpk': 'a' });
});
