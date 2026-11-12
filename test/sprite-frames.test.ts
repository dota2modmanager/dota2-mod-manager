import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spriteFrames } from '../src/sprite-frames.ts';

test('sheet export keeps all sequences and sorts frames numerically', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-frames-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'materials'));
  for (const file of ['arc_seq0_10.png', 'arc_seq0_2.png', 'arc_seq1.png', 'arcane_seq0_1.png', 'arc.png']) fs.writeFileSync(path.join(root, 'materials', file), 'png');
  assert.deepEqual(spriteFrames(root, 'materials/arc.vtex').map((entry) => entry.key), [
    'materials/arc.vtex#seq=0&frame=2', 'materials/arc.vtex#seq=0&frame=10', 'materials/arc.vtex#seq=1&frame=0',
  ]);
});
