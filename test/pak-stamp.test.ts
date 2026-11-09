/* The probe of whether the game's paks changed (src/pak-stamp.ts): the listing of all 679 pak01
 * files is made again only when pak01_dir.vpk, which an update always rewrites, has changed. The
 * item builder's 3D preview asked on every slot shown, and the window froze for seconds of stats. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gameSchemaStamp, pakFiles } from '../src/pak-stamp.ts';

function game(t: test.TestContext): { root: string; pak: (name: string, bytes: number) => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-stamp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dota'));
  return { root, pak: (name, bytes) => fs.writeFileSync(path.join(root, 'dota', name), Buffer.alloc(bytes)) };
}

test('the paks are listed again only when pak01_dir.vpk changed', (t) => {
  const g = game(t);
  g.pak('pak01_dir.vpk', 10);
  g.pak('pak01_000.vpk', 20);
  g.pak('pak02_dir.vpk', 5);
  const first = gameSchemaStamp(g.root);
  assert.match(first, /^pak01_000\.vpk:20:\d+\|pak01_dir\.vpk:10:\d+$/, 'every pak01 file, in name order, and no other pak');
  g.pak('pak01_001.vpk', 30);
  assert.equal(gameSchemaStamp(g.root), first, 'the index as it was: the listing kept');
  g.pak('pak01_dir.vpk', 11);
  assert.match(gameSchemaStamp(g.root), /pak01_001\.vpk:30:\d+\|pak01_dir\.vpk:11:/, 'an update rewrote the index: listed again');
});

test('each kind of listing keeps its own, and a game without its index cannot be probed', (t) => {
  const g = game(t);
  g.pak('pak01_dir.vpk', 10);
  assert.equal(pakFiles(g.root, 'sizes', (st) => String(st.size)), 'pak01_dir.vpk:10');
  assert.match(pakFiles(g.root, 'stamp', (st) => `${st.size}:${Math.floor(st.mtimeMs)}`), /^pak01_dir\.vpk:10:\d+$/);
  fs.rmSync(path.join(g.root, 'dota', 'pak01_dir.vpk'));
  assert.throws(() => gameSchemaStamp(g.root));
});
