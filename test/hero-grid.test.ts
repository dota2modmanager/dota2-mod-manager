// Hero grids out of OpenDota's heroStats (src/hero-grid.ts, issue #428). The stats are a real
// answer of 2026-11-03 cut to the fields the grid reads; the grid file has the shape the game
// writes (version 3, configs of categories with pixel positions and hero ids).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildGrid, createHeroGrids, gridFile, gridsIn, GRID_PREFIX, mergeGrids, type HeroStat } from '../src/hero-grid.ts';

const STATS = JSON.parse(fs.readFileSync(new URL('./fixtures/hero-stats.json', import.meta.url), 'utf-8')) as HeroStat[];

// as the game writes it: tabs, six decimals, the user's own grid
const GAME_FILE = `{
\t"version": 3,
\t"configs":
\t[
\t\t{
\t\t\t"config_name": "supports",
\t\t\t"categories":
\t\t\t[
\t\t\t\t{
\t\t\t\t\t"category_name": "5 pos",
\t\t\t\t\t"x_position": 0.000000,
\t\t\t\t\t"y_position": 0.000000,
\t\t\t\t\t"width": 1279.130493,
\t\t\t\t\t"height": 115.652176,
\t\t\t\t\t"hero_ids":
\t\t\t\t\t[
\t\t\t\t\t\t111,
\t\t\t\t\t\t53
\t\t\t\t\t]
\t\t\t\t}
\t\t\t]
\t\t}
\t]
}`;

const ids = (c: ReturnType<typeof buildGrid>) => c.categories.flatMap((k) => k.hero_ids);

test('each grid holds every hero once, on bands that do not overlap', () => {
  for (const kind of ['winrate', 'attribute', 'popular'] as const) {
    const grid = buildGrid(STATS, kind);
    assert.ok(grid.config_name.startsWith(GRID_PREFIX), kind);
    const all = ids(grid);
    assert.equal(new Set(all).size, all.length, `${kind}: no hero twice`);
    assert.equal(all.length, STATS.length, `${kind}: every hero somewhere`);
    for (let i = 1; i < grid.categories.length; i++) {
      const prev = grid.categories[i - 1];
      assert.ok(grid.categories[i].y_position >= prev.y_position + prev.height, `${kind}: band ${i} starts under the one above`);
    }
    const last = grid.categories.at(-1)!;
    assert.ok(last.y_position + last.height <= 600, `${kind}: the grid fits the pick screen`);
  }
});

test('the win-rate grid puts the better hero first, and its top band is above 53%', () => {
  const grid = buildGrid(STATS, 'winrate');
  const rate = (id: number) => { const h = STATS.find((x) => x.id === id)!; return h.pub_win! / h.pub_pick!; };
  for (const cat of grid.categories) {
    for (let i = 1; i < cat.hero_ids.length; i++) assert.ok(rate(cat.hero_ids[i - 1]) >= rate(cat.hero_ids[i]));
  }
  const top = grid.categories[0];
  if (top.category_name.includes('53')) for (const id of top.hero_ids) assert.ok(rate(id) >= 0.53);
});

test('the attribute grid has four bands and puts each hero under its own attribute', () => {
  const grid = buildGrid(STATS, 'attribute');
  assert.equal(grid.categories.length, 4);
  const str = new Set(grid.categories[0].hero_ids);
  assert.ok(str.has(2), 'Axe is strength');
  assert.ok(!str.has(1), 'Anti-Mage is not');
});

test('stats without pub_pick are summed over the brackets', () => {
  const bare = STATS.map(({ pub_pick, pub_win, ...rest }) => rest as HeroStat);
  const picks = (id: number) => { const h = bare.find((x) => x.id === id)!; let n = 0; for (let b = 1; b <= 8; b++) n += Number(h[`${b}_pick`]) || 0; return n; };
  const order = ids(buildGrid(bare, 'popular'));
  assert.equal(order.length, STATS.length);
  for (let i = 1; i < order.length; i++) assert.ok(picks(order[i - 1]) >= picks(order[i]));
});

test('merging keeps the user\'s grid, swaps the app\'s old ones, and reads back as the game\'s format', () => {
  const once = mergeGrids(GAME_FILE, [buildGrid(STATS, 'winrate'), buildGrid(STATS, 'popular')]);
  const twice = mergeGrids(once, [buildGrid(STATS, 'attribute')]);
  const file = JSON.parse(twice);
  assert.equal(file.version, 3);
  assert.deepEqual(file.configs.map((c: { config_name: string }) => c.config_name), ['supports', buildGrid(STATS, 'attribute').config_name]);
  assert.deepEqual(file.configs[0].categories[0].hero_ids, [111, 53]);
  assert.deepEqual(gridsIn(mergeGrids(twice, [])), [], 'removing leaves only the user\'s');
  assert.throws(() => mergeGrids('{"no":"configs"}', []), /сеток|grid/i);
});

function account(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-428-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'userdata', '12345');
  return { root, dir, data: path.join(root, 'appdata') };
}

const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('apply writes the grid next to the user\'s, keeps a backup of the first file, and remove takes only ours', async (t) => {
  const a = account(t);
  fs.mkdirSync(path.dirname(gridFile(a.dir)), { recursive: true });
  fs.writeFileSync(gridFile(a.dir), GAME_FILE);
  const grids = createHeroGrids({ dataDir: a.data, accountDir: () => a.dir, fetch: answer(STATS) as never, now: () => 42 });

  const res = await grids.apply(['winrate']);
  assert.equal(res.statsAt, 42);
  assert.deepEqual(res.kinds, ['winrate']);
  assert.deepEqual(grids.state(), { account: true, kinds: ['winrate'], statsAt: 42 });
  assert.equal(fs.readFileSync(path.join(a.data, 'hero_grid_config.12345.backup.json'), 'utf-8'), GAME_FILE);

  await grids.apply(['attribute']);
  assert.equal(fs.readFileSync(path.join(a.data, 'hero_grid_config.12345.backup.json'), 'utf-8'), GAME_FILE, 'the backup is the file before the app ever wrote');

  grids.remove();
  const left = JSON.parse(fs.readFileSync(gridFile(a.dir), 'utf-8'));
  assert.deepEqual(left.configs.map((c: { config_name: string }) => c.config_name), ['supports']);
});

test('a down API falls back to the numbers from last time, and with none says so', async (t) => {
  const a = account(t);
  const up = createHeroGrids({ dataDir: a.data, accountDir: () => a.dir, fetch: answer(STATS) as never, now: () => 7 });
  await up.apply(['popular']);
  const down = createHeroGrids({ dataDir: a.data, accountDir: () => a.dir, fetch: answer({ error: 'rate limited' }, 429) as never });
  assert.equal((await down.apply(['popular'])).statsAt, 7);

  const fresh = account(t);
  const none = createHeroGrids({ dataDir: fresh.data, accountDir: () => fresh.dir, fetch: answer('nope', 500) as never });
  await assert.rejects(none.apply(['popular']), /OpenDota/);
  assert.equal(fs.existsSync(gridFile(fresh.dir)), false, 'nothing was written');
});

test('without a Steam account the apply is refused and the state says so', async (t) => {
  const a = account(t);
  const grids = createHeroGrids({ dataDir: a.data, accountDir: () => null, fetch: answer(STATS) as never });
  assert.deepEqual(grids.state(), { account: false, kinds: [], statsAt: null });
  await assert.rejects(grids.apply(['winrate']), /Steam/);
});
