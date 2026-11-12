// What the bench's --fps reads out of the game and how two runs are set side by side
// (tools/dota-bench/fps.mjs). The lines are the game's own, from a run on the real map.
const test = require('node:test');
const assert = require('node:assert/strict');

test('the figure is the average of the last 1000 frames that cl_printfps wrote', async () => {
  const { readFps } = await import('../tools/dota-bench/fps.mjs');
  const line = (fps) => `11/06 00:10:01 [Client] 1000 frames: ${fps} fps, avg time: 3.16ms, abs_range:  14.73ms, total frames: 4135`;
  const log = [line('250.0'), '11/06 00:10:01 [Client] 240 frames: 306.3 fps, avg time: 3.26ms', line('316.6'), ''].join('\n');
  assert.equal(readFps(log), 316.6);
  assert.equal(readFps('240 frames: 306.3 fps'), null, 'another window of frames is not the figure');
  assert.equal(readFps(''), null);
});

test('the card counts as busy by its load times its clock, which it lowers when it has time', async () => {
  const { readBusy, mean } = await import('../tools/dota-bench/fps.mjs');
  assert.equal(readBusy('40, 780'), 31.2);
  assert.equal(readBusy('[N/A], 780'), null);
  assert.equal(readBusy(''), null);
  assert.equal(mean([30, 31, null]), 30.5);
  assert.equal(mean([null]), null);
});

test('two runs compare spot by spot, and a spot only one of them has says nothing', async () => {
  const { fpsChange } = await import('../tools/dota-bench/fps.mjs');
  const run = { mid: { fps: 150, busy: 20 }, river: { fps: 100, busy: null }, new: { fps: 90, busy: 10 } };
  const was = { mid: { fps: 300, busy: 16 }, river: { fps: 100, busy: 9 } };
  assert.deepEqual(fpsChange(run, was), {
    mid: { fps: -50, busy: 25 },
    river: { fps: 0, busy: null },
    new: { fps: null, busy: null },
  });
});
