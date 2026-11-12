/* A build step that held the window too long is told to the log (src/background-builds.ts).
 *
 * The promise: a step past the limit is reported with what came before it, so a diagnostics log
 * names the piece to split; a step under it says nothing. And an arcana's files are read a pause
 * apart (src/item-builder-assets.ts gameAssetEntriesSteps), not in one piece. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackgroundBuilds } from '../src/background-builds.ts';
import { PAUSE } from '../src/steps.ts';

test('a step past the limit is logged with the step before it', async () => {
  let clock = 0;
  const costs = [10, 500, 20, 300];
  const steps = function* () {
    clock += costs[0]; yield { done: 1, total: 2 };
    clock += costs[1]; yield PAUSE;
    clock += costs[2]; yield { stage: 'merged' as const };
    clock += costs[3]; return { ok: true };
  };
  const slow: string[] = [];
  const builds = createBackgroundBuilds(steps as never, () => {}, { slow: (ms, after) => slow.push(`${ms} after ${after}`), now: () => clock });
  assert.deepEqual(await builds.inBackground(), { ok: true });
  assert.deepEqual(slow, ['500 after pick 1/2', '300 after stage merged']);
});
