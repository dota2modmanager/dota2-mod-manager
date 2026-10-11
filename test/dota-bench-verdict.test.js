/* The bench's verdict on an attack (tools/dota-bench/verdict.mjs), on the differences measured in
 * the bursts of issue #118: the plain hero and the fixed arcana swing, the broken builds stand. */
const test = require('node:test');
const assert = require('node:assert/strict');

test('a burst that changes every picture swings; one that changes around the dummy only, or in a short fidget, does not', async () => {
  const { attackVerdict, readDiffs } = await import('../tools/dota-bench/verdict.mjs');
  // the plain hero (base2) and a still arcana with a fidget at the end (v6), as burst.ps1 printed them
  const swinging = [14.2, 15.1, 13.9, 14.7, 16.0, 14.5, 12.8, 15.3, 14.9, 14.0, 15.8, 13.6, 14.4, 16.2, 14.8];
  const fidget = [6.1, 6.4, 5.9, 6.3, 6.0, 6.6, 6.2, 6.5, 5.8, 6.4, 18.9, 19.7, 17.3, 15.2, 6.1];
  assert.deepEqual(attackVerdict(swinging), { median: 14.7, swings: true });
  assert.equal(attackVerdict(fidget).swings, false, 'four pictures of a fidget are no swing');
  assert.equal(attackVerdict([]).swings, null, 'nothing measured, nothing said');
  assert.deepEqual(readDiffs('16 in 1290 ms\r\ndiffs: 6.10 14.25 7.00'), [6.1, 14.25, 7]);
});
