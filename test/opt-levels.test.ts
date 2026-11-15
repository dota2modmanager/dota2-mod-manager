/* The Optimization window's levels of detail and sliders (renderer/catalog/decor/levels.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_GROUPS, LEVELS, groupsOf, levelOf, stepOf, withStep } from '../renderer/catalog/decor/levels.ts';

test('each level takes out more than the one before, and the last takes out everything', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const before = groupsOf(LEVELS[i - 1]), now = groupsOf(LEVELS[i]);
    assert.ok(before.every((g) => now.includes(g)) && now.length > before.length, LEVELS[i]);
  }
  assert.equal(groupsOf('original').length, 0);
  assert.deepEqual(groupsOf('minimal'), ALL_GROUPS.filter((g) => g !== 'dusk' && g !== 'dark'), 'the dark look is no level of detail');
  assert.equal(levelOf([...groupsOf('low'), 'dark']), 'low', 'and a level is the same with it on');
});

test('a set of groups names its level whatever their order, or is custom', () => {
  assert.equal(levelOf([]), 'original');
  assert.equal(levelOf(['weather', 'eventFx']), 'high');
  assert.equal(levelOf([...groupsOf('low')].reverse()), 'low');
  assert.equal(levelOf(['weather']), 'custom');
});

test('a slider moves its own steps and leaves the others: no waterfalls with the grass kept', () => {
  const g = withStep(groupsOf('original'), 'water', 2);
  assert.deepEqual(g, ['waterfalls', 'river']);
  assert.equal(stepOf('water', g), 2);
  assert.equal(stepOf('plants', g), 0, 'the grass is still there');
  const back = withStep(withStep(g, 'plants', 1), 'water', 1);
  assert.deepEqual(back, ['critters', 'waterfalls']);
  assert.equal(stepOf('plants', ['grass']), 0, "a step counts from the slider's first group");
});
