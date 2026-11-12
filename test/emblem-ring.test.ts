/* The selection ring line an emblem needs (src/emblem-ring.ts).
 *
 * The promise: while an emblem is on, Dota starts with r_draw_selected_ring 1 from autoexec.cfg;
 * when none is, the line is gone; and nothing the user wrote in autoexec is lost or doubled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RING_LINE, RING_MARK, keepRing, withRing } from '../src/emblem-ring.ts';

test('the line goes in under our mark and comes out again, the user lines kept', () => {
  const theirs = 'fps_max 240\r\ncl_showfps 1\r\n';
  const on = withRing(theirs, true);
  assert.equal(on, `fps_max 240\r\ncl_showfps 1\r\n${RING_MARK}\r\n${RING_LINE}\r\n`);
  assert.equal(withRing(on, true), on, 'twice on is once');
  assert.equal(withRing(on, false), theirs);
});

test('a line of the user own that sets the ring is left to do it', () => {
  assert.equal(withRing('r_draw_selected_ring 1\n', true), 'r_draw_selected_ring 1\n');
  assert.equal(withRing('r_draw_selected_ring "1" // emblems\n', true), 'r_draw_selected_ring "1" // emblems\n');
  assert.equal(withRing('r_draw_selected_ring 1\n', false), 'r_draw_selected_ring 1\n', 'not ours to take out');
});

test('autoexec.cfg on disk: made when needed, never made just to stay empty', () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-'));
  const file = path.join(game, 'dota', 'cfg', 'autoexec.cfg');
  try {
    assert.equal(keepRing(game, false), null);
    assert.equal(fs.existsSync(file), false);
    assert.equal(keepRing(game, true), 'added');
    assert.equal(fs.readFileSync(file, 'utf8'), `${RING_MARK}\n${RING_LINE}\n`);
    assert.equal(keepRing(game, true), null, 'nothing to write');
    assert.equal(keepRing(game, false), 'removed');
    assert.equal(fs.readFileSync(file, 'utf8'), '');
  } finally {
    fs.rmSync(game, { recursive: true, force: true });
  }
});
