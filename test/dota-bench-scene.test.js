/* Where the bench finds the hero, the dummy and the enemy (tools/dota-bench/scene.mjs), on the bars
 * bars.ps1 read from the Necrophos bench's pictures, and how it reads the abilities to cast. */
const test = require('node:test');
const assert = require('node:assert/strict');

test('the dummy is the red bar that came with the spawn; the enemy is told from it by where each stands', async () => {
  const { readBars, spawned, follow, bodyOf } = await import('../tools/dota-bench/scene.mjs');
  // 01-idle and 02-attack of the Necrophos bench: the hero alone, then the dummy beside it
  const alone = readBars('green 906 1012 356\r\n');
  const withDummy = readBars('green 906 983 356\r\nred 1001 1099 360\r\nnoise\r\n');
  assert.deepEqual(alone, [{ kind: 'green', x0: 906, x1: 1012, y: 356, x: 959 }]);
  const dummy = spawned(alone, withDummy);
  assert.equal(dummy.x, 1050);
  assert.equal(spawned(withDummy, withDummy), null, 'nothing new, no spawn');
  // the enemy comes next to the hero after it walked off; the dummy keeps its place
  const withEnemy = readBars('green 500 590 520\nred 600 700 515\nred 1001 1099 360\n');
  const enemy = spawned(withDummy, withEnemy);
  assert.equal(enemy.x, 650);
  assert.equal(follow(withEnemy, { x: 640, y: 520 }, 'red', [dummy]).x, 650);
  assert.equal(follow(withEnemy, enemy, 'red', [enemy, dummy]), null, 'all reds skipped');
  assert.equal(follow(withEnemy, alone[0], 'green').x, 545);
  assert.deepEqual(bodyOf(dummy, 700), [1050, 470]);
  assert.deepEqual(bodyOf(dummy, 1400), [1050, 415], 'farther camera, shorter hero');
});

test('a frame takes in its points, is never smaller than asked and stays in the window', async () => {
  const { frame } = await import('../tools/dota-bench/scene.mjs');
  assert.deepEqual(frame([[960, 540]], { pad: 0, min: [100, 50] }), [910, 515, 100, 50]);
  assert.deepEqual(frame([[500, 500], [1300, 600]], { pad: 100, min: [0, 0] }), [400, 400, 1000, 300]);
  assert.deepEqual(frame([[20, 1070]], { pad: 0, min: [400, 300] }), [0, 780, 400, 300], 'pushed back inside');
  assert.deepEqual(frame([[0, 0], [5000, 5000]], { pad: 0 }), [0, 0, 1920, 1080], 'no bigger than the window');
});

test("the player's keys: the backslash console of dotakeys_personal.lst, which writes it with no escape", async () => {
  const { bindOf, SCAN } = await import('../tools/dota-bench/scene.mjs');
  const lst = '\t\t"InspectHeroInWorld"\n\t\t{\n\t\t\t"Key"\t\t"I"\n\t\t}\n\t\t"Console"\n\t\t{\n\t\t\t"Key"\t\t"\\"\n\t\t\t"Mode"\t\t"0"\n\t\t}\n\t\t"AbilityUltimate"\n\t\t{\n\t\t\t"Mode"\t\t"2"\n\t\t}\n';
  assert.equal(bindOf(lst, 'Console'), '\\');
  assert.equal(SCAN[bindOf(lst, 'Console')], 0x2B);
  assert.equal(bindOf(lst, 'InspectHeroInWorld'), 'I');
  assert.equal(bindOf(lst, 'AbilityUltimate'), null, 'a block with no key');
  assert.equal(bindOf('', 'Console'), null);
});

test('abilities: a key each, aimed at the enemy with @enemy, anything else refused', async () => {
  const { readSkills, SKILLS, DEFAULT_SKILLS } = await import('../tools/dota-bench/scene.mjs');
  assert.deepEqual(readSkills('q, w,R@enemy'), [{ key: 'q', enemy: false }, { key: 'w', enemy: false }, { key: 'r', enemy: true }]);
  assert.throws(() => readSkills('qq'), /not a key/);
  assert.throws(() => readSkills('r@ally'), /only target/);
  for (const spec of [...Object.values(SKILLS), DEFAULT_SKILLS]) assert.ok(readSkills(spec).length);
  assert.ok(readSkills(SKILLS.necrolyte).some((s) => s.key === 'd' && s.enemy), "the Scepter's Death Seeker is aimed");
});

test('a batch of console commands fails on the ones the retail game does not know', async () => {
  const { unknownCommands } = await import('../tools/dota-bench/scene.mjs');
  // console.log of the Necrophos bench: the developers' camera commands are not in the retail game
  const log = '10/24 16:16:49 Unknown command: d2mm_bench_1\r\n10/24 16:16:50 Unknown command: dota_camera_yaw\r\n10/24 16:16:50 Unknown command: dota_camera_center_on_hero\r\n';
  assert.deepEqual(unknownCommands(log, ['dota_camera_yaw 90', 'dota_camera_center_on_hero']), ['dota_camera_yaw', 'dota_camera_center_on_hero']);
  assert.deepEqual(unknownCommands(log, ['dota_ability_debug_enable']), [], 'the -wtf one is known');
  assert.deepEqual(unknownCommands(log, ['dota_camera']), [], 'a name is matched whole, not as the start of another');
});
