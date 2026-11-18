// The bench's --skills: an ability that waits for a click has to be aimed, or it goes off only
// after the pictures; Sprout's trees are gone before Nature's Call unless the two go together.
const test = require('node:test');
const assert = require('node:assert');

test('the bench aims at the hero itself and casts a "+" pair one right after the other', async () => {
  const { readSkills, SKILLS } = await import('../tools/mods/dota-bench/scene.mjs');
  const [pair, tp] = readSkills('q@self+e@self,w');
  assert.deepStrictEqual(pair.casts.map((c) => [c.key, c.self, c.enemy]), [['q', true, false], ['e', true, false]]);
  assert.strictEqual(pair.key, 'qe');
  assert.deepStrictEqual(tp.casts.map((c) => [c.key, c.self]), [['w', false]]);
  assert.throws(() => readSkills('q@tree'), /targets are @enemy and @self/);
  assert.match(SKILLS.furion, /q@self\+e@self/);
});
