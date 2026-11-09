/* The 3D preview's particles gathered before the models export (src/hero-preview-fx.ts): once the
 * models are in, each part's particles move to its place among the parts that came. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { forParts, type PlannedFx } from '../src/hero-preview-fx.ts';
import type { ParticleDef } from '../src/particle-spec.ts';

const fx = (part: number, name: string): PlannedFx => ({ part, def: { path: name, tree: {}, children: [] } as unknown as ParticleDef });

test('every part came: the same list, so the resources fetched for it early are used as they are', () => {
  const planned = [fx(0, 'a'), fx(1, 'b'), fx(-1, 'body'), fx(-2, 'hero')];
  assert.equal(forParts(planned, [0, 1]), planned);
});

test("a part whose model did not come takes its particles with it, and the next ones move up", () => {
  const planned = [fx(0, 'head'), fx(1, 'weapon'), fx(2, 'back'), fx(-1, 'body')];
  assert.deepEqual(forParts(planned, [0, -1, 1]).map((x) => [x.part, x.def.path]), [[0, 'head'], [1, 'back'], [-1, 'body']]);
});
