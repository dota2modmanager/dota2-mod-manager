/* Decision logic for the custom dropdown menu: keyboard step navigation,
 * option list resolution, and upward vs downward placement. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findOptionIndex,
  resolveOptions,
  shouldOpenUpward,
  stepIndex,
} from '../renderer/ui/dropdown-logic.ts';

test('resolveOptions prepends the first entry when supplied', () => {
  const options = [{ value: 'en', label: 'English' }, { value: 'ru', label: 'Russian' }];
  const withFirst = resolveOptions(options, 'All languages');
  assert.equal(withFirst.length, 3);
  assert.deepEqual(withFirst[0], { value: '', label: 'All languages' });
  assert.deepEqual(withFirst[1], options[0]);

  const withoutFirst = resolveOptions(options);
  assert.equal(withoutFirst.length, 2);
  assert.deepEqual(withoutFirst, options);
});

test('findOptionIndex returns the matching index or -1', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
  assert.equal(findOptionIndex(options, 'b'), 1);
  assert.equal(findOptionIndex(options, 'c'), -1);
});

test('stepIndex steps forward and backward with optional looping', () => {
  const count = 3;

  // Forward looping
  assert.equal(stepIndex(0, count, 1, true), 1);
  assert.equal(stepIndex(1, count, 1, true), 2);
  assert.equal(stepIndex(2, count, 1, true), 0);

  // Forward non-looping
  assert.equal(stepIndex(1, count, 1, false), 2);
  assert.equal(stepIndex(2, count, 1, false), 2);

  // Backward looping
  assert.equal(stepIndex(2, count, -1, true), 1);
  assert.equal(stepIndex(1, count, -1, true), 0);
  assert.equal(stepIndex(0, count, -1, true), 2);

  // Backward non-looping
  assert.equal(stepIndex(1, count, -1, false), 0);
  assert.equal(stepIndex(0, count, -1, false), 0);

  // Empty count
  assert.equal(stepIndex(0, 0, 1, true), -1);
});

test('shouldOpenUpward detects when space below is tighter than space above', () => {
  // Height 800, element at bottom: 650 (bottom), spaceBelow = 150 < 240, spaceAbove = 618 > 150 -> true
  assert.equal(shouldOpenUpward({ top: 618, bottom: 650 }, 800, 240), true);

  // Element at top: 50 (bottom), spaceBelow = 750 > 240 -> false
  assert.equal(shouldOpenUpward({ top: 18, bottom: 50 }, 800, 240), false);
});
