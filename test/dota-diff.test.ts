/* The Dota update watcher's per-hero rows.
 *
 * tools/mods/dota-diff.mjs names heroes through mm-cli's `call`. #687 removed the two hero-name
 * functions from the core's call list as unused, the calls then answered { error }, and every
 * report put all the heroes in one row called "undefined". Nothing failed, so nobody noticed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { byHero } from '../tools/mods/dota-diff.mjs';

test('a Dota update is grouped by hero under the names people know', () => {
  const rows = byHero({
    added: ['models/heroes/nerubian_assassin/nerubian_assassin.vmdl_c', 'particles/econ/items/nyx_assassin/a.vpcf_c'],
    modified: ['models/heroes/queenofpain/queenofpain.vmdl_c'],
    removed: [],
  });
  assert.ok(rows.every((r) => typeof r.hero === 'string' && r.hero && r.hero !== 'undefined'), JSON.stringify(rows));
  // Nyx Assassin's model and item folders are spelled differently and still make one row
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.deepEqual(rows[0], { hero: rows[0].hero, added: 2, modified: 0, removed: 0 });
});
